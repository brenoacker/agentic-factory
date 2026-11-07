import { test, expect } from '@playwright/test';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createPanelServer } from '../server.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const CAPTURES_DIR = join(REPO_ROOT, 'runs', 'screenshots');

function makeTempFactoryClone() {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-factory-pw-'));
  for (const item of ['factory.yaml', 'skills.lock.json', 'config', 'workflows', 'contracts', 'brain', 'agents']) {
    cpSync(join(REPO_ROOT, item), join(dir, item), { recursive: true });
  }
  return dir;
}

async function startTestServer(rootDir, dbPath, issuePollRunner = null) {
  const panel = createPanelServer({ rootDir, dbPath, issuePollRunner });
  await new Promise((resolveListen) => panel.server.listen(0, '127.0.0.1', resolveListen));
  const { port } = panel.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return { panel, baseUrl };
}

test('C3: Control Panel renders 100% in English across all 6 tabs with zero Portuguese strings', async ({ page }) => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    await page.goto(baseUrl);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#refresh-telemetry-btn')).toHaveText('Refresh Telemetry');

    const tabs = [
      { id: 'overview', label: 'Overview & Telemetry' },
      { id: 'board', label: 'Board & Needs Human' },
      { id: 'workflows', label: 'Workflows (Factory as Code)' },
      { id: 'runtimes', label: 'Runtimes, Router & Circuit Breaker' },
      { id: 'agents', label: 'Agents & Locked Skills (23)' },
      { id: 'controls', label: 'Controls, Deploy & Brain' },
    ];

    const forbiddenPortuguese = [
      'Atualizar Telemetria',
      'Precisa de Mim',
      'Aprovar com 1 Clique',
      'Resetar Disjuntor',
      'Orçamento diário',
      'Fábrica como Código',
      'Nenhum evento registrado',
      'Controles Operacionais',
    ];

    for (const tab of tabs) {
      const btn = page.locator(`#tabs button[data-tab="${tab.id}"]`);
      await expect(btn).toHaveText(tab.label);
      await btn.click();
      await expect(page.locator(`#tab-${tab.id}`)).toBeVisible();

      const bodyText = await page.locator('body').innerText();
      for (const ptToken of forbiddenPortuguese) {
        expect(bodyText).not.toContain(ptToken);
      }
    }
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C4: Playwright visual and component tests verify KPIs, Runtimes, Circuit Breaker, 7 Agents, 23 Skills, and Brain', async ({ page }) => {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    panel.store.tripRuntimeCircuit('codex', '429');
    await page.goto(baseUrl);

    // Overview KPI component assertions
    await expect(page.getByTestId('kpi-total-tickets')).toContainText('Total Tickets');
    await expect(page.getByTestId('kpi-total-cost')).toContainText('Total Cost (USD)');
    await expect(page.getByTestId('kpi-tokens')).toContainText('Consumed Tokens');
    await expect(page.getByTestId('kpi-first-round')).toContainText('First-Round PR Approval');
    await expect(page.getByTestId('kpi-needs-human')).toContainText('Needs Human Queue');
    await page.screenshot({ path: join(CAPTURES_DIR, 'overview-tab.png'), fullPage: true });

    // Runtimes & Circuit Breaker component test
    await page.locator('#tabs button[data-tab="runtimes"]').click();
    const codexRow = page.getByTestId('circuit-row-codex');
    await expect(codexRow).toContainText('OPEN');
    await expect(codexRow).toContainText('429');
    await page.getByTestId('reset-circuit-codex').click();
    await expect(codexRow).toContainText('CLOSED');
    await page.screenshot({ path: join(CAPTURES_DIR, 'runtimes-tab.png'), fullPage: true });

    // Agents & 23 Locked Skills component test
    await page.locator('#tabs button[data-tab="agents"]').click();
    await expect(page.locator('#agents-grid > .card')).toHaveCount(7);
    await expect(page.locator('#skills-table tbody tr')).toHaveCount(23);
    await expect(page.getByTestId('skill-row-tlc-spec-lean')).toContainText('2.2.0');
    await page.screenshot({ path: join(CAPTURES_DIR, 'agents-skills-tab.png'), fullPage: true });
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C5: Playwright integration tests verify Workflow editor, Operational Controls, and Post-Deploy Rollback', async ({ page }) => {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    await page.goto(baseUrl);

    // 1. Workflow-as-Code Editor validation & persistence
    await page.locator('#tabs button[data-tab="workflows"]').click();
    await expect(page.locator('#workflows-list > .card')).toHaveCount(5);

    const invalidWf = {
      id: 'chore',
      label: 'type:chore',
      description: 'Invalid skill test',
      autonomy: 'gated',
      maxReviewRounds: 2,
      stages: [{ id: 'triage', mode: 'auto', agent: 'triager', skills: ['unlocked-skill-xyz'], humanApproval: false, next: 'done' }],
    };
    await page.locator('#wf-editor-select').selectOption('chore');
    await page.locator('#wf-editor-json').fill(JSON.stringify(invalidWf, null, 2));
    await page.locator('#wf-editor-save-btn').click();
    await expect(page.locator('#wf-editor-status')).toContainText('Rejected (422)');

    // Restore valid workflow and save
    const validWf = {
      id: 'chore',
      label: 'type:chore',
      description: 'Verified chore workflow from Playwright integration test',
      autonomy: 'gated',
      maxReviewRounds: 2,
      stages: [
        { id: 'triage', mode: 'auto', agent: 'triager', skills: ['codenavi'], contract: 'contracts/triage.schema.json', humanApproval: false, next: 'checks_and_build' },
        { id: 'checks_and_build', mode: 'auto', agent: 'builder', skills: ['coding-guidelines', 'docs-writer'], humanApproval: false, next: 'review' },
        { id: 'review', mode: 'auto', agent: 'judge', skills: ['the-judge'], contract: 'contracts/review.schema.json', humanApproval: false, next: 'merge' },
        { id: 'merge', mode: 'human', agent: 'ops', skills: ['gh-address-comments'], humanApproval: true, next: 'done' },
      ],
    };
    await page.locator('#wf-editor-json').fill(JSON.stringify(validWf, null, 2));
    await page.locator('#wf-editor-save-btn').click();
    await expect(page.locator('#wf-editor-status')).toContainText('Saved workflow chore (200)');

    // 2. Operational Controls & Post-Deploy Rollback
    await page.locator('#tabs button[data-tab="controls"]').click();
    await page.locator('#ctrl-autonomy').selectOption('auto-low');
    await page.locator('#ctrl-budget').fill('40');
    await page.locator('#save-controls-btn').click();
    await expect(page.locator('#controls-feedback')).toContainText('Controls saved');
    await expect(page.locator('#factory-status-badge')).toContainText('ACTIVE (AUTO-LOW)');

    // Healthy deploy -> saves last_good_sha
    await page.locator('#deploy-sha').fill('good111');
    await page.locator('#deploy-error-rate').fill('0.3');
    await page.locator('#deploy-max-rate').fill('1.0');
    await page.locator('#deploy-verify-btn').click();
    await expect(page.locator('#deploy-feedback')).toContainText('Healthy deploy good111 (last_good_sha: good111)');

    // Bad deploy -> automatic rollback to good111
    await page.locator('#deploy-sha').fill('bad2222');
    await page.locator('#deploy-error-rate').fill('3.8');
    await page.locator('#deploy-verify-btn').click();
    await expect(page.locator('#deploy-feedback')).toContainText('Rolled back bad2222 -> good111');
    await expect(page.getByTestId('deploy-card-bad2222')).toContainText('rolled_back');
    await page.screenshot({ path: join(CAPTURES_DIR, 'controls-deploy-tab.png'), fullPage: true });
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C6: Playwright E2E test triages, advances, approves human gates, and completes all 5 ticket types in the browser', async ({ page }) => {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    await page.goto(baseUrl);
    await page.locator('#tabs button[data-tab="board"]').click();

    const diverseTickets = [
      { num: 301, title: '[feature] Add multi-runtime cost breakdown chart', body: 'New feature on overview tab', expectedType: 'feature' },
      { num: 302, title: 'TypeError crash when stage token is empty string', body: 'Bug regression in store', expectedType: 'bug' },
      { num: 303, title: 'Why does GitHub polling return 304 on ETag match? Investigate latency', body: 'Spike investigation', expectedType: 'investigation' },
      { num: 304, title: 'Discovery PRD and design doc for distributed worker pool', body: 'Broad idea discovery', expectedType: 'discovery' },
      { num: 305, title: 'Chore: bump GitHub Actions CI workflow and cleanup docs', body: 'Maintenance chore', expectedType: 'chore' },
    ];

    // 1. Intake all 5 diverse tickets using the UI form (auto-detecting ticket type!)
    for (const t of diverseTickets) {
      await page.locator('#intake-issue-number').fill(String(t.num));
      await page.locator('#intake-title').fill(t.title);
      await page.locator('#intake-body').fill(t.body);
      await page.locator('#intake-type').selectOption('');
      await page.locator('#intake-submit-btn').click();
      await expect(page.locator('#intake-feedback')).toContainText(`Classified as ${t.expectedType} at stage triage`);
      await expect(page.getByTestId(`task-type-${t.num}`)).toHaveText(t.expectedType);
      await expect(page.getByTestId(`task-stage-${t.num}`)).toHaveText('triage');
    }

    await page.screenshot({ path: join(CAPTURES_DIR, 'board-after-intake.png'), fullPage: true });

    // 2. Drive each of the 5 tickets through every workflow stage to 'done'
    // Feature (#301): triage -> plan (gate) -> checks_and_build -> verify -> review -> merge (gate) -> done
    await page.getByTestId('dispatch-btn-301').click();
    await expect(page.getByTestId('task-stage-301')).toHaveText('plan');
    await expect(page.getByTestId('needs-human-card-301')).toBeVisible();
    await page.getByTestId('approve-btn-301').click();
    await expect(page.getByTestId('task-stage-301')).toHaveText('merge');
    await page.getByTestId('approve-btn-301').click();
    await expect(page.getByTestId('task-stage-301')).toHaveText('done');

    // Bug (#302): triage -> checks_and_build -> verify -> review -> merge (gate) -> done
    await page.getByTestId('dispatch-btn-302').click();
    await expect(page.getByTestId('task-stage-302')).toHaveText('merge');
    await page.getByTestId('approve-btn-302').click();
    await expect(page.getByTestId('task-stage-302')).toHaveText('done');

    // Investigation (#303): triage -> investigate (gate) -> done
    await page.getByTestId('dispatch-btn-303').click();
    await expect(page.getByTestId('task-stage-303')).toHaveText('investigate');
    await page.getByTestId('approve-btn-303').click();
    await expect(page.getByTestId('task-stage-303')).toHaveText('done');

    // Discovery (#304): triage -> discover (gate) -> done
    await page.getByTestId('dispatch-btn-304').click();
    await expect(page.getByTestId('task-stage-304')).toHaveText('discover');
    await page.getByTestId('approve-btn-304').click();
    await expect(page.getByTestId('task-stage-304')).toHaveText('done');

    // Chore (#305): triage -> checks_and_build -> review -> merge (gate) -> done
    await page.getByTestId('dispatch-btn-305').click();
    await expect(page.getByTestId('task-stage-305')).toHaveText('merge');
    await page.getByTestId('approve-btn-305').click();
    await expect(page.getByTestId('task-stage-305')).toHaveText('done');

    await page.screenshot({ path: join(CAPTURES_DIR, 'board-all-5-done.png'), fullPage: true });

    // Verify Overview KPIs reflect 5 completed tickets and positive token/cost telemetry
    await page.locator('#tabs button[data-tab="overview"]').click();
    await expect(page.getByTestId('kpi-total-tickets')).toContainText('5');
    await expect(page.getByTestId('kpi-total-tickets')).toContainText('Completed: 5');
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C8: Playwright E2E test configures an external GitHub repository in the UI and syncs its issues onto the board', async ({ page }) => {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');

  const mockRunner = ({ repo }) => {
    if (repo === 'brenoacker/external-webapp') {
      return {
        status: 200,
        etag: 'W/"ext-webapp-etag"',
        body: [
          {
            number: 401,
            title: 'TypeError exception when checkout cart is empty on mobile',
            body: 'Steps to reproduce: open /checkout with empty cart',
            labels: [],
          },
        ],
      };
    }
    return { status: 200, etag: 'W/"default-etag"', body: [] };
  };

  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockRunner);

  try {
    await page.goto(baseUrl);
    await page.locator('#tabs button[data-tab="board"]').click();

    // 1. Add external GitHub repository in the Control Panel UI
    await page.locator('#proj-repo-input').fill('brenoacker/external-webapp');
    await page.locator('#proj-branch-input').fill('main');
    await page.locator('#proj-add-btn').click();
    await expect(page.locator('#proj-feedback')).toContainText('Monitoring brenoacker/external-webapp (main)');
    await expect(page.getByTestId('project-row-brenoacker/external-webapp')).toContainText('MONITORING');

    // 2. Click "Sync Issues from All Monitored Repos"
    await page.locator('#sync-repos-btn').click();
    await expect(page.locator('#proj-feedback')).toContainText('1 new issue(s) intaked');

    // 3. Verify the issue from brenoacker/external-webapp appears on the Kanban board classified as 'bug'
    await expect(page.getByTestId('task-repo-401')).toHaveText('brenoacker/external-webapp');
    await expect(page.getByTestId('task-type-401')).toHaveText('bug');
    await expect(page.getByTestId('task-stage-401')).toHaveText('triage');

    // 4. Advance the external repository's ticket to completion
    await page.getByTestId('dispatch-btn-401').click();
    await expect(page.getByTestId('task-stage-401')).toHaveText('merge');
    await page.getByTestId('approve-btn-401').click();
    await expect(page.getByTestId('task-stage-401')).toHaveText('done');

    await page.screenshot({ path: join(CAPTURES_DIR, 'multi-repo-synced-and-done.png'), fullPage: true });
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C9: Playwright E2E test verifies stalled feature alarm banner, header badge, Kanban badge, and 1-click resolution', async ({ page }) => {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    const eightyMinAgo = new Date(Date.now() - 80 * 60_000).toISOString();
    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#601',
      issueNumber: 601,
      repo: 'brenoacker/agentic-factory',
      title: '[feature] Stalled payment webhook feature waiting for operator',
      type: 'feature',
      stage: 'plan',
      now: eightyMinAgo,
    });
    panel.store.updateTaskStage('brenoacker/agentic-factory#601', {
      needsHuman: true,
      humanQuestion: 'Approve plan before build',
      now: eightyMinAgo,
    });

    await page.goto(baseUrl);

    // 1. Verify top Stalled Task Alarm Banner and Header Alarm Badge are visible immediately
    await expect(page.getByTestId('header-alarm-badge')).toHaveText('1 STALLED ALARM(S)');
    await expect(page.getByTestId('stalled-alarm-banner')).toBeVisible();
    await expect(page.getByTestId('alarm-item-601')).toContainText('CRITICAL');
    await expect(page.getByTestId('alarm-item-601')).toContainText('Stalled payment webhook feature');

    // 2. Verify Kanban Board shows the red STALLED badge on card #601
    await page.locator('#tabs button[data-tab="board"]').click();
    await expect(page.getByTestId('task-stalled-badge-601')).toContainText('STALLED');
    await page.screenshot({ path: join(CAPTURES_DIR, 'stalled-feature-alarm-active.png'), fullPage: true });

    // 3. Configure Stall Alarm Threshold in Operational Controls
    await page.locator('#tabs button[data-tab="controls"]').click();
    await page.locator('#ctrl-stall-minutes').fill('45');
    await page.locator('#save-controls-btn').click();
    await expect(page.locator('#controls-feedback')).toContainText('Controls saved');

    // 4. Click "Snooze Alarm" on the top Stalled Task Alarm Banner and verify the alarm clears
    await page.getByTestId('alarm-snooze-btn-601').click();
    await expect(page.getByTestId('header-alarm-badge')).toHaveText('0 ALARMS');
    await expect(page.getByTestId('stalled-alarm-banner')).toBeHidden();
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C10: Playwright E2E test verifies AWS Cloudscape Design System components and configures Jira and Asana trackers in the UI', async ({ page }) => {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');

  const mockTrackerRunner = ({ provider, repo }) => {
    if (provider === 'jira' && repo === 'brenoacker/jira-checkout') {
      return {
        status: 200,
        etag: 'W/"jira-checkout-1"',
        body: {
          issues: [
            {
              key: 'PAY-801',
              fields: {
                summary: 'TypeError when payment gateway webhook retries in Jira',
                description: 'Fix webhook retry bug',
                status: { name: 'Ready for Agent' },
                issuetype: { name: 'Bug' },
                labels: [],
              },
            },
          ],
        },
      };
    }
    if (provider === 'asana' && repo === 'brenoacker/asana-portal') {
      return {
        status: 200,
        etag: 'W/"asana-portal-1"',
        body: {
          data: [
            {
              gid: '1200802',
              name: '[feature] Add dark-mode export button from Asana',
              notes: 'Export CSV in portal',
              completed: false,
              memberships: [{ section: { name: 'Ready for Agent' } }],
              tags: [{ name: 'type:feature' }],
            },
          ],
        },
      };
    }
    return { status: 200, etag: 'W/"gh-default"', body: [] };
  };

  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockTrackerRunner);

  try {
    await page.goto(baseUrl);

    // 1. Verify authentic AWS Cloudscape Design System components (awsui_* classes, TopNavigation, Container, Table, Badge)
    await expect(page.getByTestId('cloudscape-app-shell')).toBeVisible();
    const awsuiElementsCount = await page.locator('[class*="awsui_"]').count();
    expect(awsuiElementsCount).toBeGreaterThan(15);
    await page.screenshot({ path: join(CAPTURES_DIR, 'cloudscape-overview.png'), fullPage: true });

    // 2. Navigate to Board & Needs Human tab and configure a Jira tracker source
    await page.locator('#tabs button[data-tab="board"]').click();
    await page.locator('#proj-provider-select').selectOption('jira');
    await page.locator('#proj-repo-input').fill('brenoacker/jira-checkout');
    await page.locator('#proj-branch-input').fill('main');
    await page.locator('#proj-status-filter-input').fill('Ready for Agent');
    await page.locator('#proj-tracker-key-input').fill('PAY');
    await page.locator('#proj-add-btn').click();
    await expect(page.locator('#proj-feedback')).toContainText('Monitoring brenoacker/jira-checkout (main) via JIRA');
    await expect(page.getByTestId('project-row-brenoacker/jira-checkout')).toContainText('JIRA');

    // 3. Configure an Asana tracker source
    await page.locator('#proj-provider-select').selectOption('asana');
    await page.locator('#proj-repo-input').fill('brenoacker/asana-portal');
    await page.locator('#proj-status-filter-input').fill('Ready for Agent');
    await page.locator('#proj-tracker-key-input').fill('120055');
    await page.locator('#proj-add-btn').click();
    await expect(page.locator('#proj-feedback')).toContainText('Monitoring brenoacker/asana-portal (main) via ASANA');
    await expect(page.getByTestId('project-row-brenoacker/asana-portal')).toContainText('ASANA');

    // 4. Enable Periodic Cron Poller & trigger immediate sync across GitHub, Jira, and Asana
    await page.locator('#scheduler-interval-input').fill('45');
    await page.locator('#scheduler-run-btn').click();
    await expect(page.getByTestId('scheduler-status-badge')).toContainText('CRON: ACTIVE (45s · #1)');

    // 5. Verify both Jira (#801 bug) and Asana (#1200802 feature) tickets appear on the Cloudscape Kanban board
    await expect(page.getByTestId('task-repo-801')).toHaveText('brenoacker/jira-checkout');
    await expect(page.getByTestId('task-type-801')).toHaveText('bug');
    await expect(page.getByTestId('task-repo-1200802')).toHaveText('brenoacker/asana-portal');
    await expect(page.getByTestId('task-type-1200802')).toHaveText('feature');

    await page.screenshot({ path: join(CAPTURES_DIR, 'cloudscape-multi-tracker-board.png'), fullPage: true });
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});


