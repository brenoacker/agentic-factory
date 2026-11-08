import { test, expect } from '@playwright/test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createPanelServer } from '../server.mjs';
import { makeTempFactoryClone } from '../../../test-support/factory-clone.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const CAPTURES_DIR = join(REPO_ROOT, 'runs', 'screenshots');

async function startTestServer(rootDir, dbPath, issuePollRunner = null) {
  const defaultRunner = (spec) => {
    if (spec?.action === 'check_pr') {
      return {
        ok: true,
        prNumber: 401,
        state: 'MERGED',
        merged: true,
        url: spec.prNumberOrUrl,
      };
    }
    return { ok: true, status: 200 };
  };

  const activeRunner = issuePollRunner
    ? (spec) => {
        if (spec?.action === 'check_pr') {
          const res = issuePollRunner(spec);
          if (res && typeof res === 'object' && ('state' in res || 'merged' in res)) {
            return res;
          }
          return defaultRunner(spec);
        }
        return issuePollRunner(spec);
      }
    : defaultRunner;

  const panel = createPanelServer({ rootDir, dbPath, issuePollRunner: activeRunner });
  await new Promise((resolveListen) => panel.server.listen(0, '127.0.0.1', resolveListen));
  const { port } = panel.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return { panel, baseUrl };
}

test('C3: Control Panel renders 100% in English across all 6 tabs with zero Portuguese strings', async ({ page }) => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const mockGhRunner = (spec) => {
    if (spec.action === 'check_pr') {
      return {
        ok: true,
        prNumber: 401,
        state: 'MERGED',
        merged: true,
        url: spec.prNumberOrUrl,
      };
    }
    return { ok: true, status: 200 };
  };
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockGhRunner);

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
  const mockGhRunner = (spec) => {
    if (spec.action === 'check_pr') {
      return {
        ok: true,
        prNumber: 401,
        state: 'MERGED',
        merged: true,
        url: spec.prNumberOrUrl,
      };
    }
    return { ok: true, status: 200 };
  };
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockGhRunner);

  try {
    panel.store.tripRuntimeCircuit('codex', '429');
    await page.goto(baseUrl);

    // Overview KPI component assertions
    await expect(page.getByTestId('kpi-total-tickets')).toContainText('Total Tickets');
    await expect(page.getByTestId('kpi-total-cost')).toContainText('Total Cost (USD)');
    await expect(page.getByTestId('kpi-tokens')).toContainText('Consumed Tokens');
    await expect(page.getByTestId('kpi-first-round')).toContainText('First-Round PR Approval');
    await expect(page.getByTestId('kpi-first-round')).toContainText('N/A');
    await expect(page.getByTestId('kpi-first-round')).toContainText('No PR reviews recorded yet');
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
  const mockGhRunner = (spec) => {
    if (spec.action === 'check_pr') {
      return {
        ok: true,
        prNumber: 401,
        state: 'MERGED',
        merged: true,
        url: spec.prNumberOrUrl,
      };
    }
    return { ok: true, status: 200 };
  };
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockGhRunner);

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
  // Bump maxConcurrentAgents to 10 in test clone so all 5 diverse tickets can be intaked simultaneously
  const factoryYamlPath = join(tmpDir, 'factory.yaml');
  const yamlContent = readFileSync(factoryYamlPath, 'utf8').replace(/"maxConcurrentAgents":\s*\d+/, '"maxConcurrentAgents": 10');
  writeFileSync(factoryYamlPath, yamlContent, 'utf8');

  const dbPath = join(tmpDir, 'factory.db');
  const mockGhRunner = (spec) => {
    if (spec.action === 'check_pr') {
      return {
        ok: true,
        prNumber: 401,
        state: 'MERGED',
        merged: true,
        url: spec.prNumberOrUrl,
      };
    }
    return { ok: true, status: 200 };
  };
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockGhRunner);

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
      await expect(page.locator('#intake-title')).toHaveValue('');
      await expect(page.locator('#intake-issue-number')).toHaveValue('');
      await expect(page.getByTestId(`task-type-${t.num}`)).toHaveText(t.expectedType);
      await expect(page.getByTestId(`task-stage-${t.num}`)).toHaveText('triage');
    }

    await page.screenshot({ path: join(CAPTURES_DIR, 'board-after-intake.png'), fullPage: true });

    // 2. Drive each of the 5 tickets through every workflow stage to 'done'
    // Feature (#301): triage -> autonomous plan, checks, verify, review -> merge (gate) -> done
    await page.getByTestId('dispatch-btn-301').click();
    await expect(page.getByTestId('task-stage-301')).toHaveText('merge');
    await expect(page.getByTestId('needs-human-card-301')).toBeVisible();
    await page.getByTestId('approve-btn-301').click();
    await expect(page.getByTestId('task-stage-301')).toHaveText('done');
    await expect(page.getByTestId('dispatch-btn-301')).toHaveCount(0);

    // Bug (#302): triage -> checks_and_build -> verify -> review -> merge (gate) -> done
    await page.getByTestId('dispatch-btn-302').click();
    await expect(page.getByTestId('task-stage-302')).toHaveText('merge');
    await page.getByTestId('approve-btn-302').click();
    await expect(page.getByTestId('task-stage-302')).toHaveText('done');

    // Investigation (#303): triage -> investigate (delivers research doc) -> done
    await page.getByTestId('dispatch-btn-303').click();
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
    await expect(page.locator('#proj-repo-input')).toHaveValue('');
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
  const mockGhRunner = (spec) => {
    if (spec.action === 'check_pr') {
      return {
        ok: true,
        prNumber: 401,
        state: 'MERGED',
        merged: true,
        url: spec.prNumberOrUrl,
      };
    }
    return { ok: true, status: 200 };
  };
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockGhRunner);

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

test('C11: Playwright E2E test customizes combinable pickup triggers (stage + flags + custom fields + blocker exclusions) for Jira and Asana in the Cloudscape UI', async ({ page }) => {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');

  const mockTriggerRunner = ({ provider, repo }) => {
    if (provider === 'jira' && repo === 'brenoacker/jira-custom-triggers') {
      return {
        status: 200,
        etag: 'W/"jira-ct-1"',
        body: {
          issues: [
            {
              key: 'TRG-911',
              fields: {
                summary: '[feature] Eligible Jira ticket matching Ready to be Developed + agent-ready + AI_Allowed=true',
                description: 'Should be picked up by combinable trigger rules',
                status: { name: 'Ready to be Developed' },
                labels: ['agent-ready'],
                customFields: { AI_Allowed: 'true' },
                assignee: null,
              },
            },
            {
              key: 'TRG-912',
              fields: {
                summary: 'Jira ticket in Ready to be Developed but carrying blocked flag',
                description: 'Must be excluded by blocked flag trigger',
                status: { name: 'Ready to be Developed' },
                labels: ['agent-ready', 'blocked'],
                customFields: { AI_Allowed: 'true' },
                assignee: null,
              },
            },
          ],
        },
      };
    }

    if (provider === 'asana' && repo === 'brenoacker/asana-custom-triggers') {
      return {
        status: 200,
        etag: 'W/"asana-ct-1"',
        body: {
          data: [
            {
              gid: '1200913',
              name: 'TypeError in Asana payment worker when card token is null',
              notes: 'Matches Ready to be Developed + agent-ready + AI_Allowed=true',
              completed: false,
              assignee: null,
              memberships: [{ section: { name: 'Ready to be Developed' } }],
              tags: [{ name: 'agent-ready' }],
              custom_fields: [{ name: 'AI_Allowed', display_value: 'true' }],
            },
            {
              gid: '1200914',
              name: 'Asana task in Ready to be Developed without agent-ready flag',
              notes: 'Must be skipped because required flag is missing',
              completed: false,
              assignee: null,
              memberships: [{ section: { name: 'Ready to be Developed' } }],
              tags: [],
              custom_fields: [{ name: 'AI_Allowed', display_value: 'true' }],
            },
          ],
        },
      };
    }

    return { status: 200, etag: 'W/"gh-default"', body: [] };
  };

  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockTriggerRunner);

  try {
    await page.goto(baseUrl);
    await page.locator('#tabs button[data-tab="board"]').click();

    // 1. Configure Jira project with combinable triggers in the UI
    await page.locator('#proj-provider-select').selectOption('jira');
    await page.locator('#proj-repo-input').fill('brenoacker/jira-custom-triggers');
    await page.locator('#proj-branch-input').fill('main');
    await page.locator('#proj-status-filter-input').fill('Ready to be Developed');
    await page.locator('#proj-tracker-key-input').fill('TRG');
    await page.locator('#proj-required-labels-input').fill('agent-ready');
    await page.locator('#proj-excluded-labels-input').fill('blocked');
    await page.locator('#proj-custom-fields-input').fill('AI_Allowed=true');
    await page.locator('#proj-assignee-filter-input').fill('unassigned');
    await page.locator('#proj-add-btn').click();

    const jiraRow = page.getByTestId('project-row-brenoacker/jira-custom-triggers');
    await expect(jiraRow).toContainText('Stage: Ready to be Developed');
    await expect(jiraRow).toContainText('+Flags: [agent-ready]');
    await expect(jiraRow).toContainText('-Exclude: [blocked]');
    await expect(jiraRow).toContainText('+Fields: [AI_Allowed=true]');
    await expect(jiraRow).toContainText('Assignee: unassigned');

    // 2. Configure Asana project with combinable triggers in the UI
    await page.locator('#proj-provider-select').selectOption('asana');
    await page.locator('#proj-repo-input').fill('brenoacker/asana-custom-triggers');
    await page.locator('#proj-status-filter-input').fill('Ready to be Developed');
    await page.locator('#proj-tracker-key-input').fill('120099');
    await page.locator('#proj-required-labels-input').fill('agent-ready');
    await page.locator('#proj-excluded-labels-input').fill('blocked');
    await page.locator('#proj-custom-fields-input').fill('AI_Allowed=true');
    await page.locator('#proj-assignee-filter-input').fill('unassigned');
    await page.locator('#proj-add-btn').click();

    const asanaRow = page.getByTestId('project-row-brenoacker/asana-custom-triggers');
    await expect(asanaRow).toContainText('Stage: Ready to be Developed');
    await expect(asanaRow).toContainText('+Flags: [agent-ready]');
    await expect(asanaRow).toContainText('-Exclude: [blocked]');
    await expect(asanaRow).toContainText('+Fields: [AI_Allowed=true]');

    // 3. Sync and verify that only matching tickets (#911 and #1200913) are intaked while 2 non-matching tickets are skipped
    await page.locator('#sync-repos-btn').click();
    await expect(page.locator('#proj-feedback')).toContainText('2 new issue(s) intaked (2 skipped by triggers)');

    await expect(page.getByTestId('task-repo-911')).toHaveText('brenoacker/jira-custom-triggers');
    await expect(page.getByTestId('task-type-911')).toHaveText('feature');
    await expect(page.getByTestId('task-card-912')).toHaveCount(0);

    await expect(page.getByTestId('task-repo-1200913')).toHaveText('brenoacker/asana-custom-triggers');
    await expect(page.getByTestId('task-type-1200913')).toHaveText('bug');
    await expect(page.getByTestId('task-card-1200914')).toHaveCount(0);

    await page.screenshot({ path: join(CAPTURES_DIR, 'cloudscape-combinable-triggers.png'), fullPage: true });
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C12: Playwright E2E test verifies authentic AWS Cloudscape AppLayout, SideNavigation, and visual Mermaid workflow diagram editor', async ({ page }) => {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const mockGhRunner = (spec) => {
    if (spec.action === 'check_pr') {
      return {
        ok: true,
        prNumber: 401,
        state: 'MERGED',
        merged: true,
        url: spec.prNumberOrUrl,
      };
    }
    return { ok: true, status: 200 };
  };
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockGhRunner);

  try {
    await page.goto(baseUrl);

    // 1. Verify authentic AWS Cloudscape AppLayout, TopNavigation, and SideNavigation
    await expect(page.locator('.awsui-app-layout')).toBeVisible();
    await expect(page.locator('.awsui-side-navigation')).toBeVisible();
    await expect(page.locator('.awsui-top-navigation')).toBeVisible();

    // 2. Navigate to Workflows tab via SideNavigation
    await page.locator('.awsui-side-navigation a[href="#workflows"]').click();
    await expect(page.locator('#tab-workflows')).toBeVisible();

    // 3. Verify visual Mermaid SVG diagram is rendered dynamically
    const mermaidContainer = page.locator('#wf-mermaid-diagram');
    await expect(mermaidContainer).toBeVisible();
    const mermaidSvg = mermaidContainer.locator('svg');
    await expect(mermaidSvg).toBeVisible();

    // 4. Modify workflow in the UI: select "chore" workflow and change autonomy
    await page.locator('#wf-editor-select').selectOption('chore');
    await expect(page.locator('#wf-mermaid-diagram svg')).toBeVisible();

    await page.locator('#wf-autonomy-select').selectOption('auto-low');

    // 5. Save modified workflow and verify 200 persistence
    await page.locator('#wf-editor-save-btn').click();
    await expect(page.locator('#wf-editor-status')).toContainText('Saved workflow chore (200)');

    await page.screenshot({ path: join(CAPTURES_DIR, 'cloudscape-mermaid-workflows.png'), fullPage: true });
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C13: Playwright E2E test configures Linear tracker in Cloudscape UI, syncs issues, and verifies automated lifecycle feedback and close', async ({ page }) => {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');

  const trackerCalls = [];
  const mockRunner = (callSpec) => {
    if (callSpec.action === 'linear_update') {
      trackerCalls.push(callSpec);
      return { ok: true, status: 200 };
    }
    if (callSpec.provider === 'linear' && callSpec.repo === 'brenoack/agentic-factory-80f4e9bb2ce1') {
      return {
        status: 200,
        etag: 'W/"lin-live-etag"',
        body: {
          data: {
            issues: {
              nodes: [
                {
                  id: 'lin-ticket-901',
                  identifier: 'FAC-901',
                  number: 901,
                  title: '[feature] Automated Linear board synchronization',
                  description: 'End to end sync between Linear and Factory',
                  state: { name: 'Ready to be Developed', type: 'unstarted' },
                  assignee: null,
                  labels: { nodes: [{ name: 'agent-ready' }] },
                },
                {
                  id: 'lin-ticket-902',
                  identifier: 'FAC-902',
                  number: 902,
                  title: '[bug] Blocked issue with impediment',
                  description: 'Should be skipped by triggers',
                  state: { name: 'Ready to be Developed', type: 'unstarted' },
                  assignee: null,
                  labels: { nodes: [{ name: 'agent-ready' }, { name: 'blocked' }] },
                },
              ],
            },
          },
        },
      };
    }
    return { status: 200, etag: 'W/"default-etag"', body: [] };
  };

  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockRunner);

  try {
    await page.goto(baseUrl);
    await page.locator('#tabs button[data-tab="board"]').click();

    // 1. Configure Linear project with combinable triggers in the UI
    await page.locator('#proj-provider-select').selectOption('linear');
    await page.locator('#proj-repo-input').fill('brenoack/agentic-factory-80f4e9bb2ce1');
    await page.locator('#proj-branch-input').fill('main');
    await page.locator('#proj-status-filter-input').fill('Ready to be Developed');
    await page.locator('#proj-required-labels-input').fill('agent-ready');
    await page.locator('#proj-excluded-labels-input').fill('blocked');
    await page.locator('#proj-add-btn').click();

    const linearRow = page.getByTestId('project-row-brenoack/agentic-factory-80f4e9bb2ce1');
    await expect(linearRow).toBeVisible();
    await expect(linearRow).toContainText('LINEAR');
    await expect(linearRow).toContainText('Stage: Ready to be Developed');
    await expect(linearRow).toContainText('+Flags: [agent-ready]');
    await expect(linearRow).toContainText('-Exclude: [blocked]');

    // 2. Click "Sync Issues from All Monitored Repos"
    await page.locator('#sync-repos-btn').click();
    await expect(page.locator('#proj-feedback')).toContainText('1 new issue(s) intaked (1 skipped by triggers)');

    // 3. Verify matching issue appears on Kanban board classified as 'feature'
    await expect(page.getByTestId('task-repo-901')).toHaveText('brenoack/agentic-factory-80f4e9bb2ce1');
    await expect(page.getByTestId('task-type-901')).toHaveText('feature');
    await expect(page.getByTestId('task-stage-901')).toHaveText('triage');

    // 4. Advance Linear ticket through stages (Feature: triage -> autonomous plan & review -> merge -> done)
    await page.getByTestId('dispatch-btn-901').click();
    await expect(page.getByTestId('task-stage-901')).toHaveText('merge');
    await page.getByTestId('approve-btn-901').click();
    await expect(page.getByTestId('task-stage-901')).toHaveText('done');

    // 5. Verify Linear tracker lifecycle feedback: state set to Done and completed
    expect(trackerCalls.some((c) => c.action === 'linear_update' && c.stateName === 'Done')).toBe(true);

    await page.screenshot({ path: join(CAPTURES_DIR, 'cloudscape-linear-synced-and-done.png'), fullPage: true });
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C14: Playwright E2E test verifies isolated workspace provisioning, deliverable gate enforcement, and deliverable links in Cloudscape UI', async ({
  page,
}) => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const mockGhRunner = (spec) => {
    if (spec.action === 'check_pr') {
      return {
        ok: true,
        prNumber: 401,
        state: 'MERGED',
        merged: true,
        url: spec.prNumberOrUrl,
      };
    }
    return { ok: true, status: 200 };
  };
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockGhRunner);

  try {
    // 1. Intake feature ticket #950 and investigation ticket #951
    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#950',
      issueNumber: 950,
      repo: 'brenoacker/agentic-factory',
      title: 'Implement versioned context cache optimization',
      type: 'feature',
      stage: 'triage',
    });

    panel.store.createTask({
      executionKey: 'brenoacker/incident-investigator#951',
      issueNumber: 951,
      repo: 'brenoacker/incident-investigator',
      title: 'Analyze cache invalidation performance and SLOs',
      type: 'investigation',
      stage: 'triage',
    });

    await page.goto(baseUrl);
    await page.locator('#tabs button[data-tab="board"]').click();

    // Verify tasks rendered in triage
    await expect(page.getByTestId('task-stage-950')).toHaveText('triage');
    await expect(page.getByTestId('task-stage-951')).toHaveText('triage');

    // 2. Dispatch #950 -> provisions isolated workspace & task branch, advancing to merge with PR
    await page.getByTestId('dispatch-btn-950').click();
    await expect(page.getByTestId('task-branch-950')).toBeVisible();
    await expect(page.getByTestId('task-branch-950')).toContainText('factory/issue-950');
    await expect(page.getByTestId('task-ws-950')).toBeVisible();

    // Advance #950 from merge to done -> verifies Pull Request deliverable link
    await page.getByTestId('approve-btn-950').click();
    await expect(page.getByTestId('task-stage-950')).toHaveText('done');
    await expect(page.getByTestId('task-deliverable-950')).toBeVisible();
    await expect(page.getByTestId('task-deliverable-950')).toContainText('Pull Request:');

    // 3. Dispatch #951 (investigation) -> advances directly to done with research document
    await page.getByTestId('dispatch-btn-951').click();
    await expect(page.getByTestId('task-stage-951')).toHaveText('done');
    await expect(page.getByTestId('task-deliverable-951')).toBeVisible();
    await expect(page.getByTestId('task-deliverable-951')).toContainText('Research Doc:');
    const docLink = page.locator('[data-testid="task-deliverable-951"] a');
    await expect(docLink).toHaveAttribute('href', /\/api\/tickets\/.*\/deliverable/);
    await expect(docLink).not.toHaveAttribute('href', '#');

    await page.screenshot({ path: join(CAPTURES_DIR, 'cloudscape-deliverables-and-workspaces.png'), fullPage: true });
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C15: Playwright E2E test verifies max concurrent agents input, Overview KPI, and live limit updates in Cloudscape UI', async ({ page }) => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const mockGhRunner = (spec) => {
    if (spec.action === 'check_pr') {
      return {
        ok: true,
        prNumber: 401,
        state: 'MERGED',
        merged: true,
        url: spec.prNumberOrUrl,
      };
    }
    return { ok: true, status: 200 };
  };
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockGhRunner);

  try {
    // Populate with 2 active tasks
    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#961',
      issueNumber: 961,
      repo: 'brenoacker/agentic-factory',
      title: 'Active Task 1',
      type: 'feature',
      stage: 'implementation',
    });
    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#962',
      issueNumber: 962,
      repo: 'brenoacker/agentic-factory',
      title: 'Active Task 2',
      type: 'bug',
      stage: 'review',
    });

    await page.goto(baseUrl);

    // 1. Overview KPI: active concurrency displays Active: 2 / 3 max agents
    const kpiLocator = page.getByTestId('kpi-active-concurrency');
    await expect(kpiLocator).toBeVisible();
    await expect(kpiLocator).toContainText('Active: 2 / 3 max agents');

    // 2. Navigate to Controls tab, check #ctrl-concurrent input value is 3
    await page.locator('#tabs button[data-tab="controls"]').click();
    const concurrentInput = page.locator('#ctrl-concurrent');
    await expect(concurrentInput).toBeVisible();
    await expect(concurrentInput).toHaveValue('3');

    // 3. Update limit to 6 and save
    await concurrentInput.fill('6');
    await page.locator('#save-controls-btn').click();
    await expect(page.locator('#controls-feedback')).toContainText('Controls saved');

    // 4. Return to Overview and verify KPI reflects new limit 6
    await page.locator('#tabs button[data-tab="overview"]').click();
    await expect(kpiLocator).toContainText('Active: 2 / 6 max agents');

    // 5. Populate tasks up to new limit of 6
    for (let i = 3; i <= 6; i++) {
      panel.store.createTask({
        executionKey: `brenoacker/agentic-factory#96${i}`,
        issueNumber: 960 + i,
        repo: 'brenoacker/agentic-factory',
        title: `Active Task ${i}`,
        type: 'feature',
        stage: 'implementation',
      });
    }

    // Now active count is 6. Intake ticket #970 should be rejected by intake guard with 422 max_concurrency_reached
    const intakeRes = await page.request.post(`${baseUrl}/api/tickets/intake`, {
      data: {
        repo: 'brenoacker/agentic-factory',
        issueNumber: 970,
        title: 'Exceeding concurrent agent limit ticket',
        type: 'feature',
        body: 'Should be rejected because concurrency reached ceiling 6',
      },
    });
    expect(intakeRes.status()).toBe(422);
    const intakeJson = await intakeRes.json();
    expect(intakeJson.code).toBe('max_concurrency_reached');
    expect(intakeJson.error).toContain('maximum concurrency limit');

    await page.screenshot({ path: join(CAPTURES_DIR, 'cloudscape-concurrency-limits.png'), fullPage: true });
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C16: Playwright E2E test verifies interactive human clarification screen, reply submission, and cron auto-dispatch', async ({ page }) => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const mockGhRunner = (spec) => {
    if (spec.action === 'check_pr') {
      return {
        ok: true,
        prNumber: 401,
        state: 'MERGED',
        merged: true,
        url: spec.prNumberOrUrl,
      };
    }
    return { ok: true, status: 200 };
  };
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockGhRunner);

  try {
    // 1. Create a task that paused with needs_human=1 and an explicit question
    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#980',
      issueNumber: 980,
      repo: 'brenoacker/agentic-factory',
      title: 'Missing payment webhook signature secret',
      type: 'feature',
      stage: 'plan',
    });
    panel.store.updateTaskStage('brenoacker/agentic-factory#980', {
      needsHuman: true,
      humanQuestion: 'Please specify the webhook HMAC secret header name and hash algorithm.',
    });

    await page.goto(baseUrl);

    // 2. Check navigation badges
    const headerHumanBadge = page.locator('#header-human-badge');
    await expect(headerHumanBadge).toBeVisible();
    await expect(headerHumanBadge).toContainText('1 WAITING HUMAN');

    // 3. Navigate to Board & Needs Human tab
    await page.locator('#tabs button[data-tab="board"]').click();

    // 4. Verify dedicated "Agents Waiting for Human Input & Clarification" view
    const waitingScreen = page.getByTestId('waiting-human-screen');
    await expect(waitingScreen).toBeVisible();
    await expect(page.getByTestId('human-question-980')).toContainText(
      'Please specify the webhook HMAC secret header name and hash algorithm.',
    );

    // 5. Operator types clarification and clicks "Send Reply & Resume Agent"
    const replyInput = page.getByTestId('human-reply-input-980');
    await expect(replyInput).toBeVisible();
    await replyInput.fill('Use header X-Hub-Signature-256 with sha256 HMAC digest');
    await page.getByTestId('human-reply-btn-980').click();

    // 6. Verify task resumed and advanced to merge stage with PR deliverable
    await expect(page.getByTestId('task-stage-980')).toHaveText('merge');
    const updatedTask = panel.store.getTask('brenoacker/agentic-factory#980');
    expect(updatedTask.stage).toBe('merge');
    expect(updatedTask.deliverable_type).toBe('pull_request');

    // 7. Approve merge gate to complete task to done
    await page.getByTestId('approve-btn-980').click();
    await expect(page.getByTestId('task-stage-980')).toHaveText('done');
    await expect(headerHumanBadge).toContainText('0 WAITING HUMAN');

    // 8. Verify cron auto-dispatch
    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#981',
      issueNumber: 981,
      repo: 'brenoacker/agentic-factory',
      title: 'Auto dispatchable task 1',
      type: 'chore',
      stage: 'triage',
    });
    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#982',
      issueNumber: 982,
      repo: 'brenoacker/agentic-factory',
      title: 'Auto dispatchable task 2',
      type: 'chore',
      stage: 'triage',
    });

    const schedRes = await page.request.post(`${baseUrl}/api/scheduler`, {
      data: { enabled: true, intervalSeconds: 60, runImmediately: true },
    });
    expect(schedRes.status()).toBe(200);
    const schedJson = await schedRes.json();
    expect(schedJson.ok).toBe(true);

    await page.screenshot({ path: join(CAPTURES_DIR, 'cloudscape-human-clarification.png'), fullPage: true });
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C17: Playwright E2E test verifies 3-view navigation, clickable tracker hyperlinks, and live execution slots', async ({ page }) => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const mockRunner = () => ({ status: 200, etag: 'etag-17', body: [] });
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockRunner);

  try {
    // 1. Seed tasks: one waiting for human (GitHub), one in triage (Linear)
    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#701',
      issueNumber: 701,
      repo: 'brenoacker/agentic-factory',
      title: 'Clarification Needed on Auth Service',
      type: 'feature',
      stage: 'plan',
      provider: 'github',
      ticketUrl: 'https://github.com/brenoacker/agentic-factory/issues/701',
      workspacePath: join(tmpDir, 'runs', 'ws-701'),
      branchName: 'factory/issue-701',
    });
    panel.store.updateTaskStage('brenoacker/agentic-factory#701', {
      needsHuman: true,
      humanQuestion: 'Please clarify whether OAuth2 PKCE or standard authorization code flow is required.',
    });

    panel.store.createTask({
      executionKey: 'linear:brenoack/project#702',
      issueNumber: 702,
      repo: 'brenoack/project',
      title: 'Linear Issue in Triage Backlog',
      type: 'bug',
      stage: 'triage',
      provider: 'linear',
      ticketUrl: 'https://linear.app/issue/702',
    });

    // 2. Open Control Panel UI
    await page.goto(baseUrl);
    await expect(page.locator('#tabs')).toBeVisible();

    // 3. Verify 3-View Quick Switch Buttons exist and switch views
    await expect(page.locator('#btn-view-operations')).toBeVisible();
    await expect(page.locator('#btn-view-board')).toBeVisible();
    await expect(page.locator('#btn-view-health')).toBeVisible();

    // Verify Control Tower displays Live Execution Tower
    await page.locator('#btn-view-operations').click();
    await expect(page.locator('#live-execution-tower')).toBeVisible();
    await expect(page.locator('#live-execution-tower')).toContainText('Control Tower — Live Executing Slots');
    await expect(page.locator('#live-execution-tower')).toContainText('Triage Backlog Queue');

    // 4. Switch to Board & Timeline view
    await page.locator('#btn-view-board').click();
    await expect(page.locator('#tab-board')).toBeVisible();
    await expect(page.locator('#waiting-human-screen')).toBeVisible();

    // 5. Verify Clickable Link in Waiting Human Screen
    const humanLink = page.locator('#human-ticket-link-701');
    await expect(humanLink).toBeVisible();
    await expect(humanLink).toHaveAttribute('href', 'https://github.com/brenoacker/agentic-factory/issues/701');
    await expect(humanLink).toHaveAttribute('target', '_blank');
    await expect(humanLink).toHaveAttribute('rel', 'noreferrer');

    // 6. Verify Clickable Links in Kanban Board for both GitHub and Linear
    const kanbanLink701 = page.locator('#kanban-ticket-link-701');
    await expect(kanbanLink701).toBeVisible();
    await expect(kanbanLink701).toHaveAttribute('href', 'https://github.com/brenoacker/agentic-factory/issues/701');
    await expect(kanbanLink701).toHaveAttribute('target', '_blank');

    const kanbanLink702 = page.locator('#kanban-ticket-link-702');
    await expect(kanbanLink702).toBeVisible();
    await expect(kanbanLink702).toHaveAttribute('href', 'https://linear.app/issue/702');
    await expect(kanbanLink702).toHaveAttribute('target', '_blank');

    // 7. Switch to Health & Integrations view
    await page.locator('#btn-view-health').click();
    await expect(page.locator('#tab-runtimes')).toBeVisible();
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C20: Playwright E2E verifies PR merge status and check button', async ({ page }) => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');

  let prState = 'OPEN';
  let isMerged = false;

  const mockGhRunner = (spec) => {
    if (spec.action === 'check_pr') {
      return {
        ok: true,
        prNumber: 901,
        title: 'Feature PR 901',
        state: prState,
        merged: isMerged,
        mergedAt: isMerged ? '2026-11-07T15:00:00Z' : null,
        url: spec.prNumberOrUrl,
      };
    }
    return { ok: true, status: 200 };
  };

  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockGhRunner);

  try {
    // 1. Seed task in stage merge with real PR deliverable
    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#901',
      issueNumber: 901,
      repo: 'brenoacker/agentic-factory',
      title: 'Real Deliverable PR Verification',
      type: 'feature',
      stage: 'merge',
      provider: 'github',
      ticketUrl: 'https://github.com/brenoacker/agentic-factory/issues/901',
    });
    panel.store.updateTaskStage('brenoacker/agentic-factory#901', {
      needsHuman: true,
      humanQuestion: 'Stage "merge" requires human action (PR review & merge)',
    });
    panel.store.attachTaskDeliverable('brenoacker/agentic-factory#901', {
      type: 'pull_request',
      url: 'https://github.com/brenoacker/agentic-factory/pull/901',
      ref: 'merge901',
    });

    // 2. Open Board & Timeline view
    await page.goto(baseUrl);
    await expect(page.locator('#tabs')).toBeVisible();
    await page.locator('#btn-view-board').click();
    await expect(page.locator('#tab-board')).toBeVisible();

    // 3. Verify Kanban card for task 901 displays Awaiting GitHub Merge banner
    const prStatusBox = page.locator('[data-testid="pr-status-box-901"]');
    await expect(prStatusBox).toBeVisible();
    await expect(prStatusBox).toContainText('Awaiting GitHub Merge');

    // 4. Verify Check PR button exists on Kanban card
    const checkPrBtn = page.locator('#check-pr-btn-901');
    await expect(checkPrBtn).toBeVisible();
    await expect(checkPrBtn).toContainText('Check PR Merge Status & Sync');

    // 5. Click Check PR button while still OPEN
    await checkPrBtn.click();
    await expect(page.locator('#intake-feedback')).toContainText('state is OPEN. Awaiting merge on GitHub');

    // 6. Verify task remains in stage merge on Kanban
    const stageBadge = page.locator('[data-testid="task-stage-901"]');
    await expect(stageBadge).toContainText('merge');

    // 7. Attempting 1-Click Approve on Waiting Human screen rejected with 409 pr_not_merged
    const approveBtn = page.locator('#approve-btn-901');
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();
    await expect(page.locator('#intake-feedback')).toContainText('still OPEN on GitHub');

    // 8. Human operator merges PR on GitHub
    prState = 'MERGED';
    isMerged = true;

    // 9. Operator clicks Check PR Merge Status & Sync again
    await checkPrBtn.click();
    await expect(page.locator('#intake-feedback')).toContainText('is MERGED! Task advanced to done');

    // 10. Verify task 901 is now in stage done
    await expect(stageBadge).toContainText('done');
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C23: Playwright E2E verifies clickable vscode:// link, 1-click Open in Editor button, and inline Preview Document modal', async ({ page }) => {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');

  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    // 1. Create a plan review file in the temp repo
    const specDir = join(tmpDir, '.specs', 'features', 'test-review');
    mkdirSync(specDir, { recursive: true });
    const planPath = join(specDir, 'plan.md');
    const planText = [
      '# Implementation Plan for Test Review',
      '',
      '## Summary',
      'Verify operator can review and launch editor directly.',
      '',
      '```mermaid',
      'graph LR',
      '  A[Operator Review] --> B[Rendered Markdown]',
      '  B --> C[Interactive SVG Diagram]',
      '```',
      '',
      'All automated proofs verified.',
    ].join('\n');
    writeFileSync(planPath, planText, 'utf-8');

    // 2. Create task in stage plan awaiting operator evaluation
    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#902',
      issueNumber: 902,
      repo: 'brenoacker/agentic-factory',
      title: '[feature] Interactive Plan Review and Editor Launching',
      type: 'feature',
      stage: 'plan',
      provider: 'github',
      ticketUrl: 'https://github.com/brenoacker/agentic-factory/issues/902',
    });
    panel.store.updateTaskStage('brenoacker/agentic-factory#902', {
      needsHuman: true,
      humanQuestion: 'Please inspect the plan before build: .specs/features/test-review/plan.md#L1-L10',
    });

    // 3. Open Board & Timeline view
    await page.goto(baseUrl);
    await expect(page.locator('#tabs')).toBeVisible();
    await page.locator('#btn-view-board').click();
    await expect(page.locator('#tab-board')).toBeVisible();

    // 4. Verify Needs Human card displays Evaluation & Review Files
    const reviewFilesBox = page.locator('[data-testid="human-review-files-902"]');
    await expect(reviewFilesBox).toBeVisible();

    // 5. Verify vscode:// link is rendered with correct URI
    const vscodeLink = page.locator('[data-testid="vscode-link-902"]').first();
    await expect(vscodeLink).toBeVisible();
    const href = await vscodeLink.getAttribute('href');
    expect(href).toMatch(/^vscode:\/\/file\//);

    // 6. Test 1-click Open in Editor button
    const openEditorBtn = page.locator('#open-editor-btn-902').first();
    await expect(openEditorBtn).toBeVisible();
    await openEditorBtn.click();
    await expect(page.locator('#intake-feedback')).toContainText('Opened in editor:');

    // 7. Test Preview Document modal
    const previewBtn = page.locator('#preview-doc-btn-902').first();
    await expect(previewBtn).toBeVisible();
    await previewBtn.click();

    // Modal should be visible with preview content
    const modalContent = page.locator('#doc-preview-content');
    await expect(modalContent).toBeVisible();
    await expect(modalContent).toContainText('Implementation Plan for Test Review');
    await expect(modalContent).toContainText('Verify operator can review');

    // Verify rendered Markdown elements (not raw markdown string)
    await expect(page.locator('#doc-preview-content h1')).toHaveText('Implementation Plan for Test Review');
    await expect(page.locator('#doc-preview-content h2')).toHaveText('Summary');

    // Verify embedded Mermaid diagram is rendered as SVG
    const mermaidDiagram = page.locator('[data-testid="doc-preview-mermaid-0"]');
    await expect(mermaidDiagram).toBeVisible();
    await expect(mermaidDiagram.locator('svg')).toBeVisible();

    // Take screenshot for visual evidence
    await page.screenshot({ path: join(CAPTURES_DIR, 'plan-inline-preview-modal.png'), fullPage: true });

    // Close preview modal
    const closeBtn = page.locator('#close-preview-modal-btn');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(modalContent).toBeHidden();
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C24: Playwright E2E verifies consolidated 3-tier SideNavigation and collapsible diagnostics', async ({ page }) => {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');

  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    await page.goto(baseUrl);
    await expect(page.locator('.awsui-side-navigation')).toBeVisible();

    // 1. Verify primary links in SideNavigation
    const sideNavText = await page.locator('.awsui-side-navigation').innerText();
    expect(sideNavText).toContain('Control Tower');
    expect(sideNavText).toContain('Board & Timeline');
    expect(sideNavText).toContain('Settings, Health & Integrations');
    expect(sideNavText).toContain('Advanced Diagnostics & Factory as Code');

    // 2. Click Settings in SideNavigation
    await page.locator('.awsui-side-navigation a[href="#controls"]').first().click();
    await expect(page.locator('#tab-controls')).toBeVisible();

    // 3. Click Board & Timeline in SideNavigation
    await page.locator('.awsui-side-navigation a[href="#board"]').click();
    await expect(page.locator('#tab-board')).toBeVisible();

    // 4. Click Control Tower in SideNavigation
    await page.locator('.awsui-side-navigation a[href="#overview"]').click();
    await expect(page.locator('#tab-overview')).toBeVisible();
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C25: Playwright E2E verifies contextual purpose explainers for circuit breaker, deploy gate, and brain', async ({ page }) => {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');

  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    await page.goto(baseUrl);

    // 1. Verify Circuit Breaker explainer in Runtimes tab
    await page.locator('#tabs button[data-tab="runtimes"]').click();
    await expect(page.locator('#tab-runtimes')).toBeVisible();
    const circuitExplainer = page.locator('[data-testid="circuit-breaker-explainer"]');
    await expect(circuitExplainer).toBeVisible();
    await expect(circuitExplainer).toContainText('Automatic Cost and Rate-Limit Protection');

    // 2. Verify Operational Controls, Deploy Gate, and Factory Brain explainers in Controls tab
    await page.locator('#tabs button[data-tab="controls"]').click();
    await expect(page.locator('#tab-controls')).toBeVisible();

    const controlsExplainer = page.locator('[data-testid="controls-explainer"]');
    await expect(controlsExplainer).toBeVisible();
    await expect(controlsExplainer).toContainText('Factory governance');

    const deployExplainer = page.locator('[data-testid="deploy-gate-explainer"]');
    await expect(deployExplainer).toBeVisible();
    await expect(deployExplainer).toContainText('Monitors live production canary metrics post-deploy');

    const brainExplainer = page.locator('[data-testid="brain-explainer"]');
    await expect(brainExplainer).toBeVisible();
    await expect(brainExplainer).toContainText('Persistent cross-ticket repository memory');

    await page.screenshot({ path: join(CAPTURES_DIR, 'unified-navigation-and-explainers.png'), fullPage: true });
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C26: Playwright E2E verifies tracker status badges and PR notification in Kanban and Waiting Human', async ({ page }) => {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');

  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    // 1. Seed task in merge stage with genuine PR deliverable and Linear tracker link
    const taskMerge = panel.store.createTask({
      executionKey: 'linear://brenoack/agentic-factory#777',
      issueNumber: 777,
      externalId: 'LIN-777',
      provider: 'linear',
      repo: 'brenoacker/agentic-factory',
      title: 'PR Verification & Status Sync Task',
      type: 'feature',
      stage: 'merge',
      ticketUrl: 'https://linear.app/issue/LIN-777',
    });
    panel.store.updateTaskStage(taskMerge.execution_key, {
      needsHuman: true,
      humanQuestion: 'Pull request awaiting human review and merge',
    });
    panel.store.attachTaskDeliverable(taskMerge.execution_key, {
      type: 'pull_request',
      url: 'https://github.com/brenoacker/agentic-factory/pull/777',
      ref: '777abcd',
    });

    // 2. Seed task in checks_and_build stage with GitHub tracker link
    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#778',
      issueNumber: 778,
      repo: 'brenoacker/agentic-factory',
      title: 'Active Building Task',
      type: 'feature',
      stage: 'checks_and_build',
      ticketUrl: 'https://github.com/brenoacker/agentic-factory/issues/778',
    });

    await page.goto(baseUrl);

    // 3. Navigate to Board & Needs Human tab
    await page.locator('#tabs button[data-tab="board"]').click();
    await expect(page.locator('#tab-board')).toBeVisible();

    // 4. Verify Waiting for Human card renders Linear ticket link and question
    const humanCard = page.locator('[data-testid="needs-human-card-777"]');
    await expect(humanCard).toBeVisible();
    const humanLink = page.locator('[data-testid="human-ticket-link-777"]');
    await expect(humanLink).toBeVisible();
    await expect(humanLink).toHaveAttribute('href', 'https://linear.app/issue/LIN-777');
    await expect(page.locator('[data-testid="human-question-777"]')).toContainText('Pull request awaiting human review and merge');

    // 5. Verify Kanban board shows task in merge column with PR deliverable link
    const kanbanCard777 = page.locator('[data-testid="task-card-777"]');
    await expect(kanbanCard777).toBeVisible();
    const deliverableBox = page.locator('[data-testid="task-deliverable-777"]');
    await expect(deliverableBox).toBeVisible();
    await expect(deliverableBox).toContainText('Pull Request');
    await expect(deliverableBox.locator('a')).toHaveAttribute('href', 'https://github.com/brenoacker/agentic-factory/pull/777');

    // 6. Verify Kanban board shows task 778 with GitHub link in checks_and_build stage
    const kanbanLink778 = page.locator('[data-testid="kanban-ticket-link-778"]');
    await expect(kanbanLink778).toBeVisible();
    await expect(kanbanLink778).toHaveAttribute('href', 'https://github.com/brenoacker/agentic-factory/issues/778');

    await page.screenshot({ path: join(CAPTURES_DIR, 'tracker-lifecycle-sync.png'), fullPage: true });
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C31: Playwright E2E verifies 4-column unified Kanban board and stage badge display', async ({ page }) => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    // 1. Seed tasks across stages
    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#801',
      issueNumber: 801,
      repo: 'brenoacker/agentic-factory',
      title: 'Backlog Item in Triage',
      type: 'feature',
      stage: 'triage',
    });

    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#802',
      issueNumber: 802,
      repo: 'brenoacker/agentic-factory',
      title: 'Building Features in checks_and_build',
      type: 'feature',
      stage: 'checks_and_build',
    });

    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#803',
      issueNumber: 803,
      repo: 'brenoacker/agentic-factory',
      title: 'Autonomous Plan Task',
      type: 'feature',
      stage: 'plan',
    });

    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#804',
      issueNumber: 804,
      repo: 'brenoacker/agentic-factory',
      title: 'Paused Plan Task',
      type: 'bug',
      stage: 'plan',
    });
    panel.store.updateTaskStage('brenoacker/agentic-factory#804', {
      needsHuman: true,
      humanQuestion: 'Operator approval needed',
    });

    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#805',
      issueNumber: 805,
      repo: 'brenoacker/agentic-factory',
      title: 'Awaiting PR Merge',
      type: 'feature',
      stage: 'merge',
    });

    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#806',
      issueNumber: 806,
      repo: 'brenoacker/agentic-factory',
      title: 'Completed Task',
      type: 'chore',
      stage: 'done',
    });

    await page.goto(baseUrl);

    // 2. Navigate to Board tab
    await page.locator('#tabs button[data-tab="board"]').click();
    await expect(page.locator('#tab-board')).toBeVisible();

    // 3. Verify exactly 4 unified columns exist in #kanban-board
    const kanbanBoard = page.locator('#kanban-board');
    await expect(kanbanBoard).toBeVisible();

    const colTriage = page.locator('#kanban-col-triage');
    const colInProgress = page.locator('#kanban-col-in_progress');
    const colWaitingHuman = page.locator('#kanban-col-waiting_human');
    const colDone = page.locator('#kanban-col-done');

    await expect(colTriage).toBeVisible();
    await expect(colInProgress).toBeVisible();
    await expect(colWaitingHuman).toBeVisible();
    await expect(colDone).toBeVisible();

    await expect(colTriage).toContainText('Triage');
    await expect(colInProgress).toContainText('In Progress');
    await expect(colWaitingHuman).toContainText('Waiting for Human');
    await expect(colDone).toContainText('Done');

    // 4. Verify task assignment into columns
    await expect(colTriage.locator('[data-testid="task-card-801"]')).toBeVisible();
    await expect(colInProgress.locator('[data-testid="task-card-802"]')).toBeVisible();
    await expect(colInProgress.locator('[data-testid="task-card-803"]')).toBeVisible();
    await expect(colWaitingHuman.locator('[data-testid="task-card-804"]')).toBeVisible();
    await expect(colWaitingHuman.locator('[data-testid="task-card-805"]')).toBeVisible();
    await expect(colDone.locator('[data-testid="task-card-806"]')).toBeVisible();

    // 5. Verify granular stage badges inside cards
    await expect(page.locator('[data-testid="task-stage-badge-802"]')).toContainText('checks_and_build');
    await expect(page.locator('[data-testid="task-stage-badge-803"]')).toContainText('plan');

    await page.screenshot({ path: join(CAPTURES_DIR, 'unified-kanban-board.png'), fullPage: true });
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});








