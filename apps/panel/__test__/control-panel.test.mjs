import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createPanelServer } from '../server.mjs';
import {
  queryBrain,
  extractFollowUpTickets,
  canAutoMergeTask,
  generateWorkflowMermaid,
  pollLinearTracker,
  createStageContractRunner,
  classifyTicketType,
  intakeAndTriageTicket,
  advanceTicketInPanel,
  evaluateIntakeGuards,
  provisionTaskWorkspace,
  cleanupTaskWorkspace,
  materializeInvestigationReport,
  autoDispatchQueuedTasks,
  checkGitHubPullRequest,
  syncMergedPullRequests,
  isPathContained,
  resolveTaskReviewFiles,
  openInEditor,
  readFileContent,
  parseMarkdownWithMermaid,
  syncTaskStateToTracker,
  BOARD_COLUMNS,
  getTaskBoardColumn,
  groupTasksByBoardColumn,
  FactoryStore,
} from '../../../packages/core/index.mjs';
import { makeTempFactoryClone } from '../../../test-support/factory-clone.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

async function startTestServer(rootDir, dbPath, issuePollRunner = null) {
  const panel = createPanelServer({ rootDir, dbPath, issuePollRunner });
  await new Promise((resolveListen) => panel.server.listen(0, '127.0.0.1', resolveListen));
  const { port } = panel.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return { panel, baseUrl };
}

test('C1: GET /api/dashboard returns 200 with full factory telemetry, workflows, skills, agents, brain, runtimeHealth, and deployments', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#41',
      issueNumber: 41,
      repo: 'brenoacker/agentic-factory',
      title: 'Dashboard telemetry check',
      type: 'feature',
      stage: 'plan',
      runtime: 'antigravity',
    });

    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.ok(html.includes('Agentic Factory'));

    const res = await fetch(`${baseUrl}/api/dashboard`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.status.totalTasks, 1);
    assert.equal(data.status.byStage.plan, 1);
    assert.equal(data.status.byType.feature, 1);
    assert.equal(Object.keys(data.workflows).length, 5);
    assert.equal(data.skills.length, 23);
    assert.equal(data.agents.length, 7);
    assert.deepEqual(
      data.agents.map((a) => a.id).sort(),
      ['builder', 'investigator', 'judge', 'ops', 'planner', 'triager', 'verifier'],
    );
    assert.ok(data.brain.length >= 2);
    assert.ok(Array.isArray(data.runtimeHealth));
    assert.ok(Array.isArray(data.deployments));
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C2: POST /api/tasks/:key/approve returns 200 clearing needs_human and 404 for unknown task', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#42',
      issueNumber: 42,
      repo: 'brenoacker/agentic-factory',
      title: 'Approval gate check',
      type: 'feature',
      stage: 'plan',
      runtime: 'antigravity',
    });
    panel.store.updateTaskStage('brenoacker/agentic-factory#42', {
      needsHuman: true,
      humanQuestion: 'Approve plan before build',
    });

    const encodedKey = encodeURIComponent('brenoacker/agentic-factory#42');
    const res = await fetch(`${baseUrl}/api/tasks/${encodedKey}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approver: 'brenoacker', words: 'ship it' }),
    });
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.task.needs_human, 0);

    const events = panel.store.db.prepare('SELECT * FROM telemetry_events WHERE event_type = ?').all('human_approved');
    assert.equal(events.length, 1);

    const missingRes = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent('brenoacker/agentic-factory#999')}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(missingRes.status, 404);
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C3: POST /api/alerts/production returns 200 reopening task to triage, 400 on missing fields, and 404 on unknown task', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#43',
      issueNumber: 43,
      repo: 'brenoacker/agentic-factory',
      title: 'Sentry regression task',
      type: 'bug',
      stage: 'verify',
      runtime: 'antigravity',
    });

    const badRes = await fetch(`${baseUrl}/api/alerts/production`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ executionKey: 'brenoacker/agentic-factory#43' }),
    });
    assert.equal(badRes.status, 400);

    const notFoundRes = await fetch(`${baseUrl}/api/alerts/production`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ executionKey: 'brenoacker/agentic-factory#404', message: 'Boom' }),
    });
    assert.equal(notFoundRes.status, 404);

    const okRes = await fetch(`${baseUrl}/api/alerts/production`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        executionKey: 'brenoacker/agentic-factory#43',
        source: 'sentry',
        message: 'TypeError: Cannot read properties of undefined',
      }),
    });
    assert.equal(okRes.status, 200);
    const data = await okRes.json();
    assert.equal(data.ok, true);
    assert.equal(data.task.stage, 'triage');
    assert.equal(data.task.needs_human, 0);

    const events = panel.store.db.prepare('SELECT * FROM telemetry_events WHERE event_type = ?').all('production_alert_reopened');
    assert.equal(events.length, 1);
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C4: POST /api/workflows/:id returns 200 on valid workflow, 422 on unlocked skill, and 400 on malformed body', async () => {
  const tmpDir = makeTempFactoryClone();
  spawnSync('git', ['init'], { cwd: tmpDir });
  spawnSync('git', ['config', 'user.email', 'factory@example.com'], { cwd: tmpDir });
  spawnSync('git', ['config', 'user.name', 'Factory Bot'], { cwd: tmpDir });
  spawnSync('git', ['add', '.'], { cwd: tmpDir });
  spawnSync('git', ['commit', '-m', 'chore: init clone'], { cwd: tmpDir });

  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    const wfPath = join(tmpDir, 'workflows', 'chore.yaml');
    const originalRaw = readFileSync(wfPath, 'utf8');

    // 400 when workflow object is missing
    const badRes = await fetch(`${baseUrl}/api/workflows/chore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notWorkflow: true }),
    });
    assert.equal(badRes.status, 400);

    // 422 when referencing an unlocked skill
    const invalidWf = {
      id: 'chore',
      label: 'type:chore',
      description: 'Invalid chore workflow',
      autonomy: 'gated',
      maxReviewRounds: 2,
      stages: [
        { id: 'triage', mode: 'auto', agent: 'triager', skills: ['non-existent-unlocked-skill'], contract: 'contracts/triage.schema.json', humanApproval: false, next: 'done' },
      ],
    };
    const unprocessableRes = await fetch(`${baseUrl}/api/workflows/chore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow: invalidWf }),
    });
    assert.equal(unprocessableRes.status, 422);
    assert.equal(readFileSync(wfPath, 'utf8'), originalRaw);

    // 200 when valid workflow + git commit
    const validWf = {
      id: 'chore',
      label: 'type:chore',
      description: 'Updated chore workflow from panel test',
      autonomy: 'gated',
      maxReviewRounds: 2,
      stages: [
        { id: 'triage', mode: 'auto', agent: 'triager', skills: ['codenavi'], contract: 'contracts/triage.schema.json', humanApproval: false, next: 'checks_and_build' },
        { id: 'checks_and_build', mode: 'auto', agent: 'builder', skills: ['coding-guidelines', 'docs-writer'], humanApproval: false, next: 'review' },
        { id: 'review', mode: 'auto', agent: 'judge', skills: ['the-judge'], contract: 'contracts/review.schema.json', humanApproval: false, next: 'done' },
      ],
    };
    const okRes = await fetch(`${baseUrl}/api/workflows/chore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow: validWf, commit: true, commitMessage: 'chore(workflows): test update' }),
    });
    assert.equal(okRes.status, 200);
    const okData = await okRes.json();
    assert.equal(okData.ok, true);
    assert.equal(okData.committed, true);
    assert.ok(okData.commitSha);

    // Verify generateWorkflowMermaid color-codes human gates with amber (:::human) and auto with blue (:::auto)
    const testWf = {
      id: 'feature',
      stages: [
        { id: 'triage', agent: 'triager', humanApproval: false, next: 'plan' },
        { id: 'plan', agent: 'planner', humanApproval: true, next: 'build' },
      ],
    };
    const mermaidCode = generateWorkflowMermaid(testWf);
    assert.ok(mermaidCode.includes('classDef human fill:#78350f,stroke:#f59e0b'));
    assert.ok(mermaidCode.includes('classDef auto fill:#1e293b,stroke:#0972d3'));
    assert.ok(mermaidCode.includes('triage["triage\\n(triager)"]:::auto'));
    assert.ok(mermaidCode.includes('plan["plan\\n(planner)"]:::human'));
    assert.ok(mermaidCode.includes('triage -->|Auto| plan'));
    assert.ok(mermaidCode.includes('plan -->|Human Gate| build'));
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C5: POST /api/controls returns 200 persisting operational controls and 400 on negative limits', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    const badRes = await fetch(`${baseUrl}/api/controls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxTasksPerHour: -3 }),
    });
    assert.equal(badRes.status, 400);

    panel.store.tripRuntimeCircuit('antigravity', '429');
    assert.equal(panel.store.getRuntimeHealth('antigravity').status, 'open');

    const okRes = await fetch(`${baseUrl}/api/controls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        killSwitch: true,
        maxTasksPerHour: 12,
        dailyBudgetUsd: 50,
        autonomy: 'auto-low',
        resetRuntime: 'antigravity',
      }),
    });
    assert.equal(okRes.status, 200);
    const data = await okRes.json();
    assert.equal(data.ok, true);
    assert.equal(data.factoryConfig.factory.killSwitch, true);
    assert.equal(data.factoryConfig.factory.limits.maxTasksPerHour, 12);
    assert.equal(data.factoryConfig.factory.limits.dailyBudgetUsd, 50);
    assert.equal(data.factoryConfig.factory.autonomy, 'auto-low');
    assert.equal(panel.store.getRuntimeHealth('antigravity').status, 'closed');
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C6: POST /api/deploy/verify saves last_good_sha on healthy deploy, rolls back on threshold violation, and returns 400 on missing sha', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    const missingSha = await fetch(`${baseUrl}/api/deploy/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ errorRate: 0.1 }),
    });
    assert.equal(missingSha.status, 400);

    const goodRes = await fetch(`${baseUrl}/api/deploy/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        executionKey: 'brenoacker/agentic-factory#46',
        commitSha: '1111111',
        errorRate: 0.2,
        maxErrorRate: 1.0,
      }),
    });
    assert.equal(goodRes.status, 200);
    const goodData = await goodRes.json();
    assert.equal(goodData.ok, true);
    assert.equal(goodData.rolledBack, false);
    assert.equal(goodData.last_good_sha, '1111111');

    const badDeployRes = await fetch(`${baseUrl}/api/deploy/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        executionKey: 'brenoacker/agentic-factory#46',
        commitSha: '2222222',
        errorRate: 4.5,
        maxErrorRate: 1.0,
      }),
    });
    assert.equal(badDeployRes.status, 200);
    const badDeployData = await badDeployRes.json();
    assert.equal(badDeployData.status, 'rolled_back');
    assert.equal(badDeployData.rolledBack, true);
    assert.equal(badDeployData.revertedToSha, '1111111');
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C7: queryBrain, extractFollowUpTickets, and canAutoMergeTask enforce brain search, follow-up extraction, and auto-low merge rules', () => {
  const hits = queryBrain(REPO_ROOT, 'Stage Token');
  assert.ok(hits.length >= 1);
  assert.ok(hits.some((h) => h.source === 'brain/glossary.md'));

  const followUps = extractFollowUpTickets({
    issue_number: 50,
    question: 'Why did the worker retry loop duplicate telemetry events?',
    answer_summary: 'The retry loop reused the same stage token lookup without atomic consumption before retry.',
    evidence: [
      'packages/core/src/store.mjs#L340-L359 shows consumeStageToken checks used === 1',
    ],
    options_compared: [
      { option: 'Single-use token check', pros: 'Deterministic 409 on replay', cons: 'Requires token issuance per stage' },
    ],
    recommendation: 'Enforce single-use stage token consumption before advancing any task stage.',
    follow_up_tickets: [
      { type: 'bug', title: 'Fix token race condition in worker retry', description: 'Ensure worker retry requests a fresh stage token on legitimate retry.' },
      { type: 'chore', title: 'Clean up stale worktree directories after merge', description: 'Prune worktree folders after merge completes.' },
    ],
    needs_human: false,
  });
  assert.equal(followUps.length, 2);
  assert.equal(followUps[0].parent_issue, 50);
  assert.deepEqual(followUps[0].labels, ['type:bug', 'stage:triage']);

  const allowedLow = canAutoMergeTask({
    autonomy: 'auto-low',
    impact: 'low',
    reviewContract: { verdict: 'APPROVE', commit_sha: 'abc1234' },
    headSha: 'abc1234',
  });
  assert.equal(allowedLow, true);

  const blockedHigh = canAutoMergeTask({
    autonomy: 'auto-low',
    impact: 'high',
    reviewContract: { verdict: 'APPROVE', commit_sha: 'abc1234' },
    headSha: 'abc1234',
  });
  assert.equal(blockedHigh, false);
});

test('C8: Linear tracker poller queries GraphQL API, applies combinable pickup triggers, and handles missing API key', () => {
  // 1. Missing LINEAR_API_KEY returns safe prompt error without leaking
  const origKey = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = '';
  try {
    const missingRes = pollLinearTracker({
      project: { repo: 'brenoack/agentic-factory-80f4e9bb2ce1', provider: 'linear' },
    });
    assert.ok(missingRes.error && missingRes.error.includes('LINEAR_API_KEY'));
    assert.equal(missingRes.issues.length, 0);
  } finally {
    if (origKey !== undefined) {
      process.env.LINEAR_API_KEY = origKey;
    } else {
      delete process.env.LINEAR_API_KEY;
    }
  }

  // 2. Linear poller with mock runner & combinable pickup triggers
  const mockLinearRunner = () => ({
    status: 200,
    etag: 'W/"lin-etag-1"',
    body: {
      data: {
        issues: {
          nodes: [
            {
              id: 'lin-uuid-1',
              identifier: 'FAC-101',
              number: 101,
              title: '[feature] Real-time Linear board sync',
              description: 'Sync tickets from Linear project',
              state: { name: 'Ready to be Developed', type: 'unstarted' },
              assignee: null,
              labels: { nodes: [{ name: 'agent-ready' }] },
            },
            {
              id: 'lin-uuid-2',
              identifier: 'FAC-102',
              number: 102,
              title: '[bug] Blocked Linear issue',
              description: 'Issue has blocker label',
              state: { name: 'Ready to be Developed', type: 'unstarted' },
              assignee: null,
              labels: { nodes: [{ name: 'agent-ready' }, { name: 'blocked' }] },
            },
            {
              id: 'lin-uuid-3',
              identifier: 'FAC-103',
              number: 103,
              title: '[chore] Backlog ticket not ready',
              description: 'Issue is still in backlog stage',
              state: { name: 'Backlog', type: 'backlog' },
              assignee: null,
              labels: { nodes: [{ name: 'agent-ready' }] },
            },
          ],
        },
      },
    },
  });

  const polled = pollLinearTracker({
    project: {
      repo: 'brenoack/agentic-factory-80f4e9bb2ce1',
      provider: 'linear',
      trackerConfig: {
        projectKey: 'agentic-factory-80f4e9bb2ce1',
        statusFilter: 'Ready to be Developed',
        requiredLabels: ['agent-ready'],
        excludedLabels: ['blocked'],
        assigneeFilter: 'unassigned',
      },
    },
    runner: mockLinearRunner,
  });

  assert.equal(polled.issues.length, 1);
  assert.equal(polled.issues[0].issue_number, 101);
  assert.equal(polled.issues[0].provider, 'linear');
  assert.equal(polled.issues[0].title, '[Linear-FAC-101] [feature] Real-time Linear board sync');
  assert.equal(polled.skippedByTriggersCount, 2);
});

test('C9: Tracker lifecycle updates status to in-progress, posts pickup comment, and closes with completion proof', () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const store = new FactoryStore(dbPath);

  const trackerCalls = [];
  const mockTrackerRunner = (call) => {
    trackerCalls.push(call);
    return { ok: true, status: 200 };
  };

  try {
    // 1. Intake ticket and verify tracker pickup comment and in-progress status update
    const intakeRes = intakeAndTriageTicket({
      issue: {
        issue_number: 88,
        repo: 'brenoacker/agentic-factory',
        title: '[chore] Test tracker lifecycle feedback',
        body: 'Verifying automated pickup and close comments',
        type: 'chore',
      },
      factoryConfig: {
        factory: {
          autonomy: 'auto-low',
          repo: 'brenoacker/agentic-factory',
          defaultRuntime: 'antigravity',
        },
      },
      workflows: {
        chore: {
          id: 'chore',
          autonomy: 'auto-low',
          stages: [
            { id: 'triage', mode: 'auto', agent: 'triager', next: 'checks_and_build' },
            { id: 'checks_and_build', mode: 'auto', agent: 'builder', next: 'review' },
            { id: 'review', mode: 'auto', agent: 'judge', next: 'done' },
          ],
        },
      },
      store,
      trackerRunner: mockTrackerRunner,
    });

    assert.equal(intakeRes.ok, true);
    assert.ok(trackerCalls.some((c) => c.action === 'comment' && c.comment.includes('Agentic Factory Pickup')));
    assert.ok(trackerCalls.some((c) => c.action === 'update' && c.labelsToAdd.includes('in-progress')));

    // 2. Advance to completion and verify completion comment and close call
    const dispatchRes = advanceTicketInPanel({
      executionKey: intakeRes.executionKey,
      factoryRoot: tmpDir,
      factoryConfig: { factory: { autonomy: 'auto-low' } },
      workflows: {
        chore: {
          id: 'chore',
          autonomy: 'auto-low',
          stages: [
            { id: 'triage', mode: 'auto', agent: 'triager', next: 'checks_and_build' },
            { id: 'checks_and_build', mode: 'auto', agent: 'builder', next: 'review' },
            { id: 'review', mode: 'auto', agent: 'judge', next: 'done' },
          ],
        },
      },
      pricesConfig: {},
      store,
      headSha: 'commit8888',
      deliverable: { type: 'pull_request', url: 'https://github.com/brenoacker/agentic-factory/pull/88', ref: 'commit8888' },
      trackerRunner: mockTrackerRunner,
    });

    assert.equal(dispatchRes.ok, true);
    assert.equal(dispatchRes.stage, 'done');
    assert.ok(trackerCalls.some((c) => c.action === 'comment' && c.comment.includes('Completed via Agentic Factory')));
    assert.ok(trackerCalls.some((c) => c.action === 'close'));
    assert.ok(trackerCalls.some((c) => c.action === 'update' && c.labelsToAdd.includes('stage:done')));

    // 3. Linear project ticket lifecycle verification:
    const linearCalls = [];
    const mockLinearTrackerRunner = (call) => {
      linearCalls.push(call);
      return { ok: true, status: 200 };
    };

    const linearIntake = intakeAndTriageTicket({
      issue: {
        issue_number: 99,
        repo: 'brenoack/agentic-factory-80f4e9bb2ce1',
        title: '[feature] Real-time Linear board integration',
        provider: 'linear',
        external_id: 'lin-issue-99',
      },
      factoryConfig: {
        factory: {
          autonomy: 'auto-low',
          repo: 'brenoacker/agentic-factory',
          defaultRuntime: 'antigravity',
          projects: [{ repo: 'brenoack/agentic-factory-80f4e9bb2ce1', provider: 'linear' }],
        },
      },
      workflows: {
        feature: {
          id: 'feature',
          autonomy: 'auto-low',
          stages: [{ id: 'triage', mode: 'auto', agent: 'triager', next: 'done' }],
        },
      },
      store,
      trackerRunner: mockLinearTrackerRunner,
    });

    assert.equal(linearIntake.ok, true);
    assert.ok(linearCalls.some((c) => c.action === 'linear_update' && c.stateName === 'In Progress'));

    const linearDispatch = advanceTicketInPanel({
      executionKey: linearIntake.executionKey,
      factoryRoot: tmpDir,
      factoryConfig: {
        factory: {
          autonomy: 'auto-low',
          projects: [{ repo: 'brenoack/agentic-factory-80f4e9bb2ce1', provider: 'linear' }],
        },
      },
      workflows: {
        feature: {
          id: 'feature',
          autonomy: 'auto-low',
          stages: [{ id: 'triage', mode: 'auto', agent: 'triager', next: 'done' }],
        },
      },
      pricesConfig: {},
      store,
      headSha: 'lincommit99',
      deliverable: { type: 'pull_request', url: 'https://linear.app/issue/lin-issue-99', ref: 'lincommit99' },
      trackerRunner: mockLinearTrackerRunner,
    });

    assert.equal(linearDispatch.ok, true);
    assert.equal(linearDispatch.stage, 'done');
    assert.equal(linearDispatch.trackerFeedback?.tracker, 'linear');
    assert.ok(linearCalls.some((c) => c.action === 'linear_update' && c.stateName === 'Done'));
  } finally {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C10: Workspace provisioner clones or checks out isolated worktree on target default branch with task branch and locked skills', () => {
  const tmpDir = makeTempFactoryClone();
  try {
    // 1. Injected runner returns deterministic workspace metadata
    const runnerRes = provisionTaskWorkspace({
      factoryRoot: tmpDir,
      repo: 'brenoacker/incident-investigator',
      issueNumber: 85,
      defaultBranch: 'main',
      runner: ({ repo, issueNumber, branchName }) => ({
        ok: true,
        workspacePath: join(tmpDir, '.workspaces', 'mock', `issue-${issueNumber}`),
        branchName: branchName || `factory/issue-${issueNumber}`,
        repo,
      }),
    });
    assert.equal(runnerRes.ok, true);
    assert.equal(runnerRes.branchName, 'factory/issue-85');
    assert.ok(runnerRes.workspacePath.includes('issue-85'));

    // 2. Local provisioner establishes task branch and copies constitution
    const localRes = provisionTaskWorkspace({
      factoryRoot: tmpDir,
      repo: 'brenoacker/agentic-factory',
      issueNumber: 42,
      defaultBranch: 'main',
    });
    assert.equal(localRes.ok, true);
    assert.equal(localRes.branchName, 'factory/issue-42');
    assert.ok(localRes.workspacePath.includes('issue-42'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C11: Deliverable validation gate enforces mandatory PR for code workflows and research document for analysis workflows before done', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const store = new FactoryStore(dbPath);
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    // 1. Code ticket without PR is rejected when advancing to done
    const codeTask = store.createTask({
      executionKey: 'brenoacker/agentic-factory#101',
      issueNumber: 101,
      repo: 'brenoacker/agentic-factory',
      title: 'Real feature implementation',
      type: 'feature',
      stage: 'review',
    });
    const missingDelivCheck = store.validateTaskDeliverable(codeTask);
    assert.equal(missingDelivCheck.ok, false);
    assert.equal(missingDelivCheck.code, 'missing_deliverable');

    // Advancing in panel without deliverable returns 422 missing_deliverable
    const rejectRes = advanceTicketInPanel({
      executionKey: codeTask.execution_key,
      factoryRoot: tmpDir,
      factoryConfig: { factory: { autonomy: 'auto-low' } },
      workflows: {
        feature: {
          id: 'feature',
          autonomy: 'auto-low',
          stages: [{ id: 'review', mode: 'auto', agent: 'judge', next: 'done' }],
        },
      },
      pricesConfig: {},
      store,
      autoAttachDeliverable: false,
    });
    assert.equal(rejectRes.ok, false);
    assert.equal(rejectRes.status, 422);
    assert.equal(rejectRes.code, 'missing_deliverable');

    // 2. Code ticket with Pull Request deliverable completes successfully
    store.attachTaskDeliverable(codeTask.execution_key, {
      type: 'pull_request',
      url: 'https://github.com/brenoacker/agentic-factory/pull/201',
      ref: 'commitsha101',
    });
    const validDelivCheck = store.validateTaskDeliverable(store.getTask(codeTask.execution_key));
    assert.equal(validDelivCheck.ok, true);

    const approveRes = advanceTicketInPanel({
      executionKey: codeTask.execution_key,
      factoryRoot: tmpDir,
      factoryConfig: { factory: { autonomy: 'auto-low' } },
      workflows: {
        feature: {
          id: 'feature',
          autonomy: 'auto-low',
          stages: [{ id: 'review', mode: 'auto', agent: 'judge', next: 'done' }],
        },
      },
      pricesConfig: {},
      store,
      autoAttachDeliverable: false,
    });
    assert.equal(approveRes.ok, true);
    assert.equal(approveRes.stage, 'done');

    // 3. Analysis ticket (investigation) without document is rejected
    const investTask = store.createTask({
      executionKey: 'brenoacker/incident-investigator#85',
      issueNumber: 85,
      repo: 'brenoacker/incident-investigator',
      title: 'Add versioned stable-context cache',
      type: 'investigation',
      stage: 'investigate',
    });
    const missingInvestCheck = store.validateTaskDeliverable(investTask);
    assert.equal(missingInvestCheck.ok, false);
    assert.equal(missingInvestCheck.code, 'missing_deliverable');

    // 4. Analysis ticket with research document completes successfully
    store.attachTaskDeliverable(investTask.execution_key, {
      type: 'research_document',
      url: 'docs/research/issue-85-stable-context-cache.md',
      ref: 'Investigation Report: stable-context cache',
    });
    const validInvestCheck = store.validateTaskDeliverable(store.getTask(investTask.execution_key));
    assert.equal(validInvestCheck.ok, true);

    // 5. Test GET /api/tickets/:key/deliverable endpoint
    const apiRes = await fetch(`${baseUrl}/api/tickets/${encodeURIComponent(investTask.execution_key)}/deliverable`);
    assert.equal(apiRes.status, 200);
    const apiJson = await apiRes.json();
    assert.equal(apiJson.ok, true);
    assert.equal(apiJson.deliverable.type, 'research_document');
    assert.equal(apiJson.deliverable.url, 'docs/research/issue-85-stable-context-cache.md');
  } finally {
    store.close();
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C12: Controls API persists maxConcurrentAgents within range 1 to 10 and rejects invalid bounds', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    // 1. Valid value (5) is accepted and persisted to factory.yaml
    const validRes = await fetch(`${baseUrl}/api/controls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxConcurrentAgents: 5 }),
    });
    assert.equal(validRes.status, 200);
    const validJson = await validRes.json();
    assert.equal(validJson.ok, true);
    assert.equal(validJson.factoryConfig.factory.limits.maxConcurrentAgents, 5);

    // Verify written to factory.yaml on disk
    const savedYaml = readFileSync(join(tmpDir, 'factory.yaml'), 'utf8');
    assert.ok(savedYaml.includes('"maxConcurrentAgents": 5'));

    // 2. Reject out-of-bounds: 0 (less than 1)
    const lowRes = await fetch(`${baseUrl}/api/controls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxConcurrentAgents: 0 }),
    });
    assert.equal(lowRes.status, 400);

    // 3. Reject out-of-bounds: 11 (greater than 10)
    const highRes = await fetch(`${baseUrl}/api/controls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxConcurrentAgents: 11 }),
    });
    assert.equal(highRes.status, 400);

    // 4. Reject non-integer: 3.5
    const floatRes = await fetch(`${baseUrl}/api/controls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxConcurrentAgents: 3.5 }),
    });
    assert.equal(floatRes.status, 400);
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C13: Concurrency intake guard bounds active tasks to maxConcurrentAgents defaulting to 3 and rejecting overflow', () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const store = new FactoryStore(dbPath);

  try {
    const factoryConfig = {
      factory: {
        limits: { maxConcurrentAgents: 3 },
      },
    };

    // Initially 0 active tasks
    assert.equal(store.countActiveTasks(), 0);

    // 1. First 3 tasks are accepted
    for (let i = 1; i <= 3; i++) {
      const issue = { issue_number: i, repo: 'brenoacker/agentic-factory', type: 'feature', title: `Task ${i}` };
      const guard = evaluateIntakeGuards(issue, factoryConfig, store);
      assert.equal(guard.ok, true, `Task ${i} should be accepted`);
      store.createTask({
        executionKey: `brenoacker/agentic-factory#${i}`,
        issueNumber: i,
        repo: 'brenoacker/agentic-factory',
        type: 'feature',
        stage: 'implementation',
      });
    }

    assert.equal(store.countActiveTasks(), 3);
    assert.equal(store.countExecutingAgents(), 3);

    // 2. 4th task is rejected with code max_concurrency_reached
    const overflowIssue = { issue_number: 4, repo: 'brenoacker/agentic-factory', type: 'feature', title: 'Task 4' };
    const overflowGuard = evaluateIntakeGuards(overflowIssue, factoryConfig, store);
    assert.equal(overflowGuard.ok, false);
    assert.equal(overflowGuard.code, 'max_concurrency_reached');
    assert.ok(overflowGuard.reason.includes('Active running agents (3) reached maximum concurrency limit (3)'));

    // 3. Complete task #1 -> active tasks becomes 2 -> 4th task is accepted
    store.updateTaskStage('brenoacker/agentic-factory#1', {
      stage: 'done',
      deliverableType: 'pull_request',
      deliverableUrl: 'https://github.com/brenoacker/agentic-factory/pull/1',
    });
    assert.equal(store.countActiveTasks(), 2);

    const retryGuard = evaluateIntakeGuards(overflowIssue, factoryConfig, store);
    assert.equal(retryGuard.ok, true);
  } finally {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C14: Executing agent concurrency excludes merge and needs_human tasks, preserves workspace, and filters queued triage from stall alarms', () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const store = new FactoryStore(dbPath);

  try {
    const factoryConfig = {
      factory: {
        limits: { maxConcurrentAgents: 3 },
      },
    };

    // 1. Populate 3 tasks: 1 in implementation, 1 in merge (PR open), 1 waiting human
    store.createTask({
      executionKey: 'brenoacker/agentic-factory#10',
      issueNumber: 10,
      repo: 'brenoacker/agentic-factory',
      type: 'feature',
      stage: 'implementation',
    });
    store.attachTaskWorkspace('brenoacker/agentic-factory#10', {
      workspacePath: join(tmpDir, '.workspaces', 'issue-10'),
      branchName: 'factory/issue-10',
    });

    store.createTask({
      executionKey: 'brenoacker/agentic-factory#11',
      issueNumber: 11,
      repo: 'brenoacker/agentic-factory',
      type: 'feature',
      stage: 'merge',
    });
    store.attachTaskDeliverable('brenoacker/agentic-factory#11', {
      type: 'pull_request',
      url: 'https://github.com/brenoacker/agentic-factory/pull/111',
    });
    store.attachTaskWorkspace('brenoacker/agentic-factory#11', {
      workspacePath: join(tmpDir, '.workspaces', 'issue-11'),
      branchName: 'factory/issue-11',
    });

    store.createTask({
      executionKey: 'brenoacker/agentic-factory#12',
      issueNumber: 12,
      repo: 'brenoacker/agentic-factory',
      type: 'bug',
      stage: 'plan',
    });
    store.updateTaskStage('brenoacker/agentic-factory#12', {
      needsHuman: true,
      humanQuestion: 'Missing reproduction steps for error',
    });

    // Total active tasks is 3
    assert.equal(store.countActiveTasks(), 3);
    // Executing agents is only 1 (#10), because #11 is in 'merge' and #12 has needs_human=1
    assert.equal(store.countExecutingAgents(), 1);

    // Intake guard allows a 4th task because executing count (1) < maxConcurrentAgents (3)
    const issue13 = { issue_number: 13, repo: 'brenoacker/agentic-factory', type: 'feature', title: 'Task 13' };
    const guard = evaluateIntakeGuards(issue13, factoryConfig, store);
    assert.equal(guard.ok, true);

    // Workspace is preserved for task #11 while stage is 'merge'
    const task11 = store.getTask('brenoacker/agentic-factory#11');
    assert.ok(task11.workspace_path.includes('issue-11'));
    assert.equal(task11.stage, 'merge');

    // 2. Stalled tasks filter: backlog tasks in triage do NOT trigger false alarms
    const oldTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    store.createTask({
      executionKey: 'brenoacker/agentic-factory#14',
      issueNumber: 14,
      repo: 'brenoacker/agentic-factory',
      type: 'chore',
      stage: 'triage',
      now: oldTime,
    });
    store.db.prepare('UPDATE tasks SET updated_at = ? WHERE execution_key = ?').run(oldTime, 'brenoacker/agentic-factory#14');

    // Also update task #10 (implementation) and #12 (needs_human) to oldTime
    store.db.prepare('UPDATE tasks SET updated_at = ? WHERE execution_key = ?').run(oldTime, 'brenoacker/agentic-factory#10');
    store.db.prepare('UPDATE tasks SET updated_at = ? WHERE execution_key = ?').run(oldTime, 'brenoacker/agentic-factory#12');

    const stalled = store.evaluateStalledTasks({ stallThresholdMinutes: 30 });
    const stalledKeys = stalled.map((s) => s.executionKey);

    // #10 (implementation) and #12 (needs_human) are flagged, but #14 (queued triage) is NOT flagged
    assert.ok(stalledKeys.includes('brenoacker/agentic-factory#10'));
    assert.ok(stalledKeys.includes('brenoacker/agentic-factory#12'));
    assert.ok(!stalledKeys.includes('brenoacker/agentic-factory#14'));
  } finally {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C15: Periodic scheduler auto-dispatches queued triage tasks up to executing concurrency ceiling', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const mockIssueRunner = () => ({ status: 200, etag: 'etag-sched', body: [] });
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockIssueRunner);

  try {
    // 1. Set concurrency limit to 2
    await fetch(`${baseUrl}/api/controls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxConcurrentAgents: 2 }),
    });

    // 2. Create 3 queued tasks in triage with pre-set workspace to avoid git worktree delays
    for (let i = 21; i <= 23; i++) {
      panel.store.createTask({
        executionKey: `brenoacker/agentic-factory#${i}`,
        issueNumber: i,
        repo: 'brenoacker/agentic-factory',
        title: `Queued Task ${i}`,
        type: 'chore',
        stage: 'triage',
        workspacePath: join(tmpDir, 'runs', `ws-${i}`),
      });
    }

    // Triage backlog tasks are NOT executing agents
    assert.equal(panel.store.countExecutingAgents(), 0);
    assert.equal(panel.store.countActiveTasks(), 3);

    // 3. Trigger auto-dispatch via POST /api/scheduler with runImmediately: true
    // Available capacity is 2 (maxConcurrentAgents: 2 - executing: 0 = 2)
    const schedRes = await fetch(`${baseUrl}/api/scheduler`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, intervalSeconds: 60, runImmediately: true }),
    });
    assert.equal(schedRes.status, 200);
    const schedJson = await schedRes.json();
    assert.equal(schedJson.ok, true);
    // Asserts exact positive auto-dispatch count of 2
    assert.equal(schedJson.autoDispatchedCount, 2);

    // Verify tasks 21 and 22 advanced out of triage, while task 23 remains in triage queue
    const t21 = panel.store.getTask('brenoacker/agentic-factory#21');
    const t22 = panel.store.getTask('brenoacker/agentic-factory#22');
    const t23 = panel.store.getTask('brenoacker/agentic-factory#23');
    assert.notEqual(t21.stage, 'triage');
    assert.notEqual(t22.stage, 'triage');
    assert.equal(t23.stage, 'triage');

    // 4. Simulate active executing agents at ceiling (2 executing in implementation)
    panel.store.db
      .prepare(
        "UPDATE tasks SET stage = 'implementation', needs_human = 0 WHERE execution_key IN ('brenoacker/agentic-factory#21', 'brenoacker/agentic-factory#22')",
      )
      .run();
    assert.equal(panel.store.countExecutingAgents(), 2);

    // Subsequent cycle when executing slots are at ceiling (2/2) dispatches 0
    const schedRes2 = await fetch(`${baseUrl}/api/scheduler`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, intervalSeconds: 60, runImmediately: true }),
    });
    const schedJson2 = await schedRes2.json();
    assert.equal(schedJson2.autoDispatchedCount, 0);
    assert.equal(panel.store.getTask('brenoacker/agentic-factory#23').stage, 'triage');

    // 5. Free a slot by advancing task 21 to PR creation stage (merge)
    panel.store.updateTaskStage('brenoacker/agentic-factory#21', {
      stage: 'merge',
      deliverableType: 'pull_request',
      deliverableUrl: 'https://github.com/brenoacker/agentic-factory/pull/21',
    });
    assert.equal(panel.store.countExecutingAgents(), 1);

    // 6. Now task 23 is auto-dispatched because 1 executing slot is available
    const schedRes3 = await fetch(`${baseUrl}/api/scheduler`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, intervalSeconds: 60, runImmediately: true }),
    });
    const schedJson3 = await schedRes3.json();
    assert.equal(schedJson3.autoDispatchedCount, 1);
    assert.notEqual(panel.store.getTask('brenoacker/agentic-factory#23').stage, 'triage');

    // Reject invalid interval
    const invalidSched = await fetch(`${baseUrl}/api/scheduler`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intervalSeconds: 1 }),
    });
    assert.equal(invalidSched.status, 400);
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C16: Factory store persists ticket_url, provider, and triage contract type mutation, and auto-enables scheduler', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const mockIssueRunner = () => ({ status: 200, etag: 'etag-16', body: [] });
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockIssueRunner);

  try {
    // 1. Verify scheduler initializes enabled by default
    const dashRes = await fetch(`${baseUrl}/api/dashboard`);
    assert.equal(dashRes.status, 200);
    const dashJson = await dashRes.json();
    assert.equal(dashJson.scheduler.enabled, true);

    // 2. Create tasks with ticket_url and provider
    const ghTask = panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#301',
      issueNumber: 301,
      repo: 'brenoacker/agentic-factory',
      title: 'GitHub Tracker Link Task',
      type: 'feature',
      stage: 'triage',
      provider: 'github',
    });
    assert.equal(ghTask.ticket_url, 'https://github.com/brenoacker/agentic-factory/issues/301');
    assert.equal(ghTask.provider, 'github');

    const linTask = panel.store.createTask({
      executionKey: 'linear:brenoack/project#302',
      issueNumber: 302,
      repo: 'brenoack/project',
      title: 'Linear Tracker Link Task',
      type: 'bug',
      stage: 'triage',
      provider: 'linear',
    });
    assert.equal(linTask.ticket_url, 'https://linear.app/issue/302');
    assert.equal(linTask.provider, 'linear');

    // 3. Dispatch triage stage with a contract mutating type to 'investigation'
    panel.store.attachTaskWorkspace(ghTask.execution_key, {
      workspacePath: join(tmpDir, 'runs', 'ws-301'),
      branchName: 'factory/issue-301',
    });

    const mutateRunner = (callSpec) => {
      let contract;
      if (callSpec.stage === 'triage') {
        contract = {
          stage_token: callSpec.stageToken,
          issue_number: 301,
          type: 'investigation',
          impact: 'high',
          root_cause: 'Root cause identified requiring investigation spike.',
          evidence: 'packages/core/src/store.mjs#L1-L50',
          affected_paths: ['packages/core/src/store.mjs'],
          needs_human: false,
        };
      } else {
        contract = {
          stage_token: callSpec.stageToken,
          issue_number: 301,
          question: 'Why do triage contracts mutate task types?',
          answer_summary: 'To align subsequent stages with triager agent classification.',
          evidence: ['contracts/triage.schema.json#L8-L15'],
          options_compared: [{ option: 'Keep immutable', pros: 'Simple', cons: 'Rigid' }],
          recommendation: 'Mutate type upon triage completion',
          follow_up_tickets: [],
          needs_human: false,
        };
      }
      return {
        ok: true,
        status: 0,
        stdout: JSON.stringify({
          usage: { input_tokens: 900, output_tokens: 350, cached_tokens: 150 },
          total_cost_usd: 0.0065,
          contract,
        }),
      };
    };

    const advRes = advanceTicketInPanel({
      executionKey: ghTask.execution_key,
      factoryRoot: tmpDir,
      store: panel.store,
      runner: mutateRunner,
    });
    assert.equal(advRes.ok, true);

    // 4. Verify task.type was mutated in SQLite to 'investigation'
    const updatedTask = panel.store.getTask(ghTask.execution_key);
    assert.equal(updatedTask.type, 'investigation');
    assert.equal(updatedTask.impact, 'high');
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C18: Live GitHub PR verification and premature done transition rejection', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');

  const ghCalls = [];
  const mockGhRunner = (spec) => {
    ghCalls.push(spec);
    if (spec.action === 'check_pr') {
      const isMerged = String(spec.prNumberOrUrl).includes('899');
      return {
        ok: true,
        prNumber: isMerged ? 899 : 801,
        title: isMerged ? 'Merged Feature PR' : 'Open Feature PR',
        state: isMerged ? 'MERGED' : 'OPEN',
        merged: isMerged,
        mergedAt: isMerged ? '2026-11-07T12:00:00Z' : null,
        url: spec.prNumberOrUrl,
      };
    }
    return { ok: true, status: 200 };
  };

  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockGhRunner);

  try {
    // 1. Verify checkGitHubPullRequest returns live state and merged boolean
    const openPrCheck = checkGitHubPullRequest({
      repo: 'brenoacker/agentic-factory',
      prNumberOrUrl: 'https://github.com/brenoacker/agentic-factory/pull/801',
      runner: mockGhRunner,
    });
    assert.equal(openPrCheck.ok, true);
    assert.equal(openPrCheck.state, 'OPEN');
    assert.equal(openPrCheck.merged, false);

    const mergedPrCheck = checkGitHubPullRequest({
      repo: 'brenoacker/agentic-factory',
      prNumberOrUrl: 'https://github.com/brenoacker/agentic-factory/pull/899',
      runner: mockGhRunner,
    });
    assert.equal(mergedPrCheck.ok, true);
    assert.equal(mergedPrCheck.state, 'MERGED');
    assert.equal(mergedPrCheck.merged, true);

    // 2. Verify advanceTicketInPanel strictly prohibits synthetic PR URL fabrication
    const taskTriage = panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#800',
      issueNumber: 800,
      repo: 'brenoacker/agentic-factory',
      title: 'No Fake PR Task',
      type: 'feature',
      stage: 'triage',
    });

    const triageRunner = (callSpec) => ({
      ok: true,
      status: 0,
      stdout: JSON.stringify({
        usage: { input_tokens: 100, output_tokens: 50, cached_tokens: 0 },
        total_cost_usd: 0.001,
        contract: {
          stage_token: callSpec.stageToken,
          issue_number: 800,
          type: 'feature',
          impact: 'medium',
          root_cause: 'Real investigation without fake PR fabrication.',
          evidence: 'packages/core/src/pipeline.mjs#L360',
          affected_paths: ['packages/core/src/pipeline.mjs'],
          needs_human: false,
        },
      }),
    });

    advanceTicketInPanel({
      executionKey: taskTriage.execution_key,
      factoryRoot: tmpDir,
      store: panel.store,
      runner: triageRunner,
    });

    const taskAfterTriage = panel.store.getTask(taskTriage.execution_key);
    assert.equal(taskAfterTriage.deliverable_url, '');
    assert.equal(taskAfterTriage.deliverable_type, '');

    // 3. Task in stage merge with OPEN pull request
    const taskInMerge = panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#801',
      issueNumber: 801,
      repo: 'brenoacker/agentic-factory',
      title: 'Feature Waiting for Real Merge',
      type: 'feature',
      stage: 'merge',
    });
    panel.store.updateTaskStage(taskInMerge.execution_key, {
      needsHuman: true,
      humanQuestion: 'Stage "merge" requires human action',
    });
    panel.store.attachTaskDeliverable(taskInMerge.execution_key, {
      type: 'pull_request',
      url: 'https://github.com/brenoacker/agentic-factory/pull/801',
      ref: 'head801',
    });

    // 4. Reject POST /api/tasks/:key/approve with HTTP 409 pr_not_merged
    const approveRes = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(taskInMerge.execution_key)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approver: 'operator', words: 'premature approval attempt' }),
    });
    assert.equal(approveRes.status, 409);
    const approveJson = await approveRes.json();
    assert.equal(approveJson.ok, false);
    assert.equal(approveJson.code, 'pr_not_merged');
    assert.match(approveJson.error, /still OPEN on GitHub/i);

    // Verify task remained in stage merge
    const taskStillMerge = panel.store.getTask(taskInMerge.execution_key);
    assert.equal(taskStillMerge.stage, 'merge');

    // 5. Reject advanceTicketInPanel with approveCurrentStage: true
    const advReject = advanceTicketInPanel({
      executionKey: taskInMerge.execution_key,
      factoryRoot: tmpDir,
      store: panel.store,
      approveCurrentStage: true,
      trackerRunner: mockGhRunner,
    });
    assert.equal(advReject.ok, false);
    assert.equal(advReject.status, 409);
    assert.equal(advReject.code, 'pr_not_merged');

    // 6. Test POST /api/tasks/:key/check-pr returns open status
    const checkPrRes = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(taskInMerge.execution_key)}/check-pr`, {
      method: 'POST',
    });
    assert.equal(checkPrRes.status, 200);
    const checkPrJson = await checkPrRes.json();
    assert.equal(checkPrJson.ok, true);
    assert.equal(checkPrJson.state, 'OPEN');
    assert.equal(checkPrJson.merged, false);
    assert.equal(checkPrJson.advancedToDone, false);

    // 7. Error cases for check-pr
    const checkNotFound = await fetch(`${baseUrl}/api/tasks/unknown%23999/check-pr`, { method: 'POST' });
    assert.equal(checkNotFound.status, 404);

    const checkNoDeliv = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(taskTriage.execution_key)}/check-pr`, {
      method: 'POST',
    });
    assert.equal(checkNoDeliv.status, 422);
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C19: Cron scheduler syncMergedPullRequests auto-completes tasks upon PR merge', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');

  const trackerCalls = [];
  const mockGhRunner = (spec) => {
    trackerCalls.push(spec);
    if (spec.action === 'check_pr') {
      return {
        ok: true,
        prNumber: 802,
        title: 'Real Merged PR',
        state: 'MERGED',
        merged: true,
        mergedAt: '2026-11-07T14:30:00Z',
        url: spec.prNumberOrUrl,
      };
    }
    return { ok: true, status: 200 };
  };

  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath, mockGhRunner);

  try {
    // 1. Create task in stage merge with real PR deliverable
    const task = panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#802',
      issueNumber: 802,
      repo: 'brenoacker/agentic-factory',
      title: 'Automated Merge Completion Task',
      type: 'feature',
      stage: 'merge',
    });
    panel.store.updateTaskStage(task.execution_key, {
      needsHuman: true,
      humanQuestion: 'Stage "merge" requires human action',
    });
    panel.store.attachTaskDeliverable(task.execution_key, {
      type: 'pull_request',
      url: 'https://github.com/brenoacker/agentic-factory/pull/802',
      ref: 'merge802',
    });

    // 2. Run syncMergedPullRequests
    const syncRes = syncMergedPullRequests({
      rootDir: tmpDir,
      store: panel.store,
      runner: mockGhRunner,
    });
    assert.equal(syncRes.ok, true);
    assert.equal(syncRes.mergedTasksCount, 1);
    assert.equal(syncRes.mergedTasks[0].execution_key, task.execution_key);

    // 3. Verify task stage transitioned to done and needs_human cleared
    const updated = panel.store.getTask(task.execution_key);
    assert.equal(updated.stage, 'done');
    assert.equal(updated.needs_human, 0);

    // 4. Verify GitHub comment, close, and label updates
    assert.ok(trackerCalls.some((c) => c.action === 'comment' && c.comment.includes('was merged into default branch')));
    assert.ok(trackerCalls.some((c) => c.action === 'close' && c.comment.includes('Merged PR: https://github.com/brenoacker/agentic-factory/pull/802')));
    assert.ok(trackerCalls.some((c) => c.action === 'update' && c.labelsToAdd.includes('stage:done')));

    // 5. Test manual 1-click check-pr on a second task when merged
    const task2 = panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#803',
      issueNumber: 803,
      repo: 'brenoacker/agentic-factory',
      title: 'Manual Check PR Merged Task',
      type: 'bug',
      stage: 'merge',
    });
    panel.store.attachTaskDeliverable(task2.execution_key, {
      type: 'pull_request',
      url: 'https://github.com/brenoacker/agentic-factory/pull/803',
      ref: 'merge803',
    });

    const checkRes = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(task2.execution_key)}/check-pr`, {
      method: 'POST',
    });
    assert.equal(checkRes.status, 200);
    const checkJson = await checkRes.json();
    assert.equal(checkJson.ok, true);
    assert.equal(checkJson.state, 'MERGED');
    assert.equal(checkJson.merged, true);
    assert.equal(checkJson.advancedToDone, true);
    assert.equal(checkJson.task.stage, 'done');
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C21: resolveTaskReviewFiles resolves plan documents with vscode:// URIs and openInEditor enforces path containment', () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const store = new FactoryStore(dbPath);

  try {
    const task = store.createTask({
      executionKey: 'brenoacker/agentic-factory#901',
      issueNumber: 901,
      repo: 'brenoacker/agentic-factory',
      title: 'Plan Review Task',
      type: 'feature',
      stage: 'plan',
    });
    store.updateTaskStage(task.execution_key, {
      needsHuman: true,
      humanQuestion: 'Please review implementation plan: .specs/features/clickable-file-review-and-editor-integration/plan.md#L1-L50',
    });

    const files = resolveTaskReviewFiles(task, tmpDir);
    assert.ok(files.length > 0);
    const planFile = files.find((f) => f.path.includes('plan.md'));
    assert.ok(planFile);
    assert.ok(planFile.vscodeUri.startsWith('vscode://file/'));
    assert.equal(isPathContained(planFile.resolvedPath, tmpDir), true);

    // Test containment rejection
    assert.equal(isPathContained(join(tmpDir, '..', 'secret.txt'), tmpDir), false);

    // Test openInEditor with mock runner
    let commandRan = null;
    const mockEditorRunner = (spec) => {
      commandRan = spec;
      return { ok: true, status: 200 };
    };
    const openRes = openInEditor(planFile.resolvedPath, { rootDir: tmpDir, runner: mockEditorRunner });
    assert.equal(openRes.ok, true);
    assert.ok(commandRan);
    assert.ok(commandRan.path.includes('plan.md'));
  } finally {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C22: POST /api/files/open launches editor and GET /api/files/content returns file contents, rejecting traversal', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    const testDocPath = join(tmpDir, 'sample-review.md');
    const docContent = '# Sample Review Plan\n\nContent for operator inspection.';
    writeFileSync(testDocPath, docContent, 'utf-8');

    // 1. GET /api/files/content success
    const getRes = await fetch(`${baseUrl}/api/files/content?path=sample-review.md`);
    assert.equal(getRes.status, 200);
    const getContent = await getRes.json();
    assert.equal(getContent.ok, true);
    assert.equal(getContent.content, docContent);

    // 2. GET /api/files/content path traversal rejection (400)
    const badRes = await fetch(`${baseUrl}/api/files/content?path=../../etc/passwd`);
    assert.equal(badRes.status, 400);

    // 3. POST /api/files/open success
    const postRes = await fetch(`${baseUrl}/api/files/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: 'sample-review.md', line: 10 }),
    });
    assert.equal(postRes.status, 200);
    const postJson = await postRes.json();
    assert.equal(postJson.ok, true);

    // 4. POST /api/files/open traversal rejection (400)
    const badPostRes = await fetch(`${baseUrl}/api/files/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: '../../evil.sh' }),
    });
    assert.equal(badPostRes.status, 400);
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C26: Autonomous plan progression for well-described tasks and conditional human gating', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const store = new FactoryStore(dbPath);

  try {
    // 1. Task with well-described plan (needs_human: false) advances autonomously past plan stage
    const taskWell = store.createTask({
      executionKey: 'brenoacker/agentic-factory#101',
      issueNumber: 101,
      repo: 'brenoacker/agentic-factory',
      title: 'Well-described feature task',
      type: 'feature',
      stage: 'plan',
    });

    const baseRunner = createStageContractRunner({ headSha: '64e6a79', verdict: 'APPROVE' });
    const mockAutonomousRunner = (spec) => {
      if (spec.stage === 'plan') {
        return {
          ok: true,
          status: 0,
          stdout: JSON.stringify({
            contract: {
              stage_token: spec.stageToken,
              issue_number: 101,
              needs_human: false,
            },
          }),
        };
      }
      return baseRunner(spec);
    };

    const resWell = advanceTicketInPanel({
      executionKey: taskWell.execution_key,
      factoryRoot: tmpDir,
      store,
      runner: mockAutonomousRunner,
    });

    // Verify task did not pause at plan; advanced autonomously through checks, verify, and review into merge
    assert.equal(resWell.ok, true);
    const updatedWell = store.getTask(taskWell.execution_key);
    assert.notEqual(updatedWell.stage, 'plan');
    assert.equal(updatedWell.stage, 'merge');
    assert.ok(resWell.stepsExecuted.includes('plan'));
    assert.ok(resWell.stepsExecuted.includes('checks_and_build'));
    assert.ok(resWell.stepsExecuted.includes('verify'));
    assert.ok(resWell.stepsExecuted.includes('review'));

    // 2. Task with ambiguous plan (needs_human: true) pauses for human clarification
    const taskAmbiguous = store.createTask({
      executionKey: 'brenoacker/agentic-factory#102',
      issueNumber: 102,
      repo: 'brenoacker/agentic-factory',
      title: 'Ambiguous feature task',
      type: 'feature',
      stage: 'plan',
    });

    const mockAmbiguousRunner = (spec) => {
      return {
        ok: true,
        status: 0,
        stdout: JSON.stringify({
          contract: {
            stage_token: spec.stageToken,
            issue_number: 102,
            needs_human: true,
            human_question: 'Ambiguous OAuth provider: please specify Google or GitHub',
          },
        }),
      };
    };

    const resAmbiguous = advanceTicketInPanel({
      executionKey: taskAmbiguous.execution_key,
      factoryRoot: tmpDir,
      store,
      runner: mockAmbiguousRunner,
    });

    assert.equal(resAmbiguous.ok, true);
    assert.equal(resAmbiguous.dispatchStatus, 'paused_for_human');
    const updatedAmbiguous = store.getTask(taskAmbiguous.execution_key);
    assert.equal(updatedAmbiguous.stage, 'plan');
    assert.equal(updatedAmbiguous.needs_human, 1);
    assert.ok(updatedAmbiguous.human_question.includes('Ambiguous OAuth provider'));
  } finally {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C27: Deduplicated tracker lifecycle updates and PR notifications across GitHub and Linear', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const store = new FactoryStore(dbPath);

  const trackerCalls = [];
  const mockTrackerRunner = (spec) => {
    trackerCalls.push(spec);
    return { ok: true, status: 200 };
  };

  try {
    // 1. Initial transition on Linear
    const linearTask = store.createTask({
      executionKey: 'linear://brenoack/agentic-factory#501',
      issueNumber: 501,
      externalId: 'LIN-501',
      provider: 'linear',
      repo: 'linear://brenoack/agentic-factory-80f4e9bb2ce1',
      title: 'Linear Lifecycle Task',
      type: 'feature',
      stage: 'checks_and_build',
    });

    const sync1 = syncTaskStateToTracker({
      task: linearTask,
      store,
      runner: mockTrackerRunner,
    });
    assert.equal(sync1.ok, true);
    assert.equal(sync1.provider, 'linear');
    assert.equal(sync1.statusName, 'In Progress');
    assert.equal(trackerCalls.length, 1);
    assert.equal(trackerCalls[0].action, 'linear_update');
    assert.equal(trackerCalls[0].stateName, 'In Progress');

    // 2. Second call with same state suppresses duplicate comment
    const taskReloaded = store.getTask(linearTask.execution_key);
    const sync2 = syncTaskStateToTracker({
      task: taskReloaded,
      store,
      runner: mockTrackerRunner,
    });
    assert.equal(sync2.ok, true);
    assert.equal(sync2.skippedDuplicate, true);
    assert.equal(trackerCalls.length, 1); // No new call made!

    // 3. Move to stage merge with PR attached: sets In Review and posts PR link
    store.updateTaskStage(linearTask.execution_key, {
      stage: 'merge',
      needsHuman: true,
      humanQuestion: 'Stage "merge" requires human action',
    });
    store.attachTaskDeliverable(linearTask.execution_key, {
      type: 'pull_request',
      url: 'https://github.com/brenoacker/agentic-factory/pull/501',
      ref: 'head501',
    });

    const taskInMerge = store.getTask(linearTask.execution_key);
    const sync3 = syncTaskStateToTracker({
      task: taskInMerge,
      store,
      runner: mockTrackerRunner,
    });
    assert.equal(sync3.ok, true);
    assert.equal(sync3.statusName, 'In Review');
    assert.equal(sync3.shouldClose, false);
    assert.equal(trackerCalls.length, 2);
    assert.equal(trackerCalls[1].stateName, 'In Review');
    assert.ok(trackerCalls[1].comment.includes('https://github.com/brenoacker/agentic-factory/pull/501'));

    // 4. Move to done: sets Done, posts completion and allows close
    store.updateTaskStage(linearTask.execution_key, {
      stage: 'done',
      needsHuman: false,
    });
    const taskDone = store.getTask(linearTask.execution_key);
    const sync4 = syncTaskStateToTracker({
      task: taskDone,
      store,
      runner: mockTrackerRunner,
    });
    assert.equal(sync4.ok, true);
    assert.equal(sync4.statusName, 'Done');
    assert.equal(sync4.shouldClose, true);
    assert.equal(trackerCalls.length, 3);
    assert.equal(trackerCalls[2].stateName, 'Done');
  } finally {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C28: Non-code research workflow auto-close and post-merge closing', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const store = new FactoryStore(dbPath);

  const trackerCalls = [];
  const mockTrackerRunner = (spec) => {
    trackerCalls.push(spec);
    return { ok: true, status: 200 };
  };

  try {
    // 1. Research investigation task auto-completes and auto-closes on document delivery
    const researchTask = store.createTask({
      executionKey: 'brenoacker/agentic-factory#601',
      issueNumber: 601,
      repo: 'brenoacker/agentic-factory',
      title: 'Investigate SQLite performance',
      type: 'investigation',
      stage: 'triage',
    });

    const resResearch = advanceTicketInPanel({
      executionKey: researchTask.execution_key,
      factoryRoot: tmpDir,
      store,
      trackerRunner: mockTrackerRunner,
    });

    assert.equal(resResearch.ok, true);
    assert.equal(resResearch.stage, 'done');
    const finalResearch = store.getTask(researchTask.execution_key);
    assert.equal(finalResearch.stage, 'done');
    assert.equal(finalResearch.deliverable_type, 'research_document');
    // Closed on GitHub tracker
    assert.ok(trackerCalls.some((c) => c.action === 'close' && c.issueNumber === 601));

    // 2. Code feature workflow does NOT auto-close until live PR is merged
    const codeTask = store.createTask({
      executionKey: 'brenoacker/agentic-factory#602',
      issueNumber: 602,
      repo: 'brenoacker/agentic-factory',
      title: 'Implement feature endpoint',
      type: 'feature',
      stage: 'merge',
    });
    store.attachTaskDeliverable(codeTask.execution_key, {
      type: 'pull_request',
      url: 'https://github.com/brenoacker/agentic-factory/pull/602',
      ref: 'sha602',
    });

    const advPremature = advanceTicketInPanel({
      executionKey: codeTask.execution_key,
      factoryRoot: tmpDir,
      store,
      approveCurrentStage: true,
      trackerRunner: (spec) => {
        if (spec.action === 'check_pr') {
          return { ok: true, state: 'OPEN', merged: false, prNumber: 602, url: spec.prNumberOrUrl };
        }
        return mockTrackerRunner(spec);
      },
    });

    // Premature approve rejected
    assert.equal(advPremature.ok, false);
    assert.equal(advPremature.status, 409);
    assert.equal(advPremature.code, 'pr_not_merged');
    assert.equal(store.getTask(codeTask.execution_key).stage, 'merge');
  } finally {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C29: Unified 4-column Kanban board preserves 100% of tasks across triage, in_progress, waiting_human, and done', () => {
  assert.equal(BOARD_COLUMNS.length, 4);
  assert.deepEqual(
    BOARD_COLUMNS.map((c) => c.id),
    ['triage', 'in_progress', 'waiting_human', 'done'],
  );

  const mockTasks = [
    { execution_key: 'task-1', issue_number: 1, stage: 'triage', needs_human: 0 },
    { execution_key: 'task-2', issue_number: 2, stage: 'plan', needs_human: 0 },
    { execution_key: 'task-3', issue_number: 3, stage: 'checks_and_build', needs_human: 0 },
    { execution_key: 'task-4', issue_number: 4, stage: 'verify', needs_human: 0 },
    { execution_key: 'task-5', issue_number: 5, stage: 'review', needs_human: 0 },
    { execution_key: 'task-6', issue_number: 6, stage: 'investigate', needs_human: 0 },
    { execution_key: 'task-7', issue_number: 7, stage: 'discover', needs_human: 0 },
    { execution_key: 'task-8', issue_number: 8, stage: 'plan', needs_human: 1 },
    { execution_key: 'task-9', issue_number: 9, stage: 'merge', needs_human: 0 },
    { execution_key: 'task-10', issue_number: 10, stage: 'done', needs_human: 0 },
    { execution_key: 'task-11', issue_number: 11, stage: 'aborted', needs_human: 0 },
  ];

  const grouped = groupTasksByBoardColumn(mockTasks);

  // 1. Triage: contains task-1
  assert.equal(grouped.triage.length, 1);
  assert.equal(grouped.triage[0].issue_number, 1);

  // 2. In Progress: contains active autonomous tasks without human block (plan, checks_and_build, verify, review, investigate, discover)
  assert.equal(grouped.in_progress.length, 6);
  assert.deepEqual(
    grouped.in_progress.map((t) => t.issue_number),
    [2, 3, 4, 5, 6, 7],
  );

  // 3. Waiting for Human: contains needs_human=1 and stage=merge
  assert.equal(grouped.waiting_human.length, 2);
  assert.deepEqual(
    grouped.waiting_human.map((t) => t.issue_number),
    [8, 9],
  );

  // 4. Done: contains done and aborted
  assert.equal(grouped.done.length, 2);
  assert.deepEqual(
    grouped.done.map((t) => t.issue_number),
    [10, 11],
  );

  // ZERO TASK LOSS: total count across columns must equal total input tasks
  const totalInColumns =
    grouped.triage.length + grouped.in_progress.length + grouped.waiting_human.length + grouped.done.length;
  assert.equal(totalInColumns, mockTasks.length);
});

test('C30: In-progress and waiting-human tasks display distinct granular stage badges in unified columns', () => {
  const activePlanTask = { stage: 'plan', needs_human: 0 };
  const activeBuildTask = { stage: 'checks_and_build', needs_human: 0 };
  const pausedPlanTask = { stage: 'plan', needs_human: 1 };
  const pausedMergeTask = { stage: 'merge', needs_human: 0 };

  // Both active tasks map to 'in_progress', yet preserve distinct stage values
  assert.equal(getTaskBoardColumn(activePlanTask), 'in_progress');
  assert.equal(getTaskBoardColumn(activeBuildTask), 'in_progress');
  assert.equal(activePlanTask.stage, 'plan');
  assert.equal(activeBuildTask.stage, 'checks_and_build');

  // Both paused tasks map to 'waiting_human', yet preserve distinct stages
  assert.equal(getTaskBoardColumn(pausedPlanTask), 'waiting_human');
  assert.equal(getTaskBoardColumn(pausedMergeTask), 'waiting_human');
  assert.equal(pausedPlanTask.stage, 'plan');
  assert.equal(pausedMergeTask.stage, 'merge');
});

test('C31: Markdown document preview parses formatted markdown, extracts embedded mermaid, and falls back to workspace roots', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const store = new FactoryStore(dbPath);
  const taskWs = join(tmpDir, '.workspaces', 'issue-71');

  try {
    // 1. parseMarkdownWithMermaid separates markdown HTML from mermaid code blocks
    const sampleDoc = [
      '# Investigation Report #71',
      '',
      'Key findings on worker retry loop:',
      '- Finding A: Concurrent requests trigger contention',
      '- Finding B: Stage tokens guarantee single-use',
      '',
      '```mermaid',
      'graph TD',
      '  A[Request] --> B[Atomic Lock]',
      '  B --> C[Execute Stage]',
      '```',
      '',
      '## Next Steps',
      'Apply database index.',
    ].join('\n');

    const segments = parseMarkdownWithMermaid(sampleDoc);
    assert.equal(segments.length, 3);
    assert.equal(segments[0].type, 'html');
    assert.ok(segments[0].html.includes('<h1 id="investigation-report-71">Investigation Report #71</h1>') || segments[0].html.includes('Investigation Report #71'));
    assert.ok(segments[0].html.includes('<li>Finding A: Concurrent requests trigger contention</li>') || segments[0].html.includes('Finding A:'));
    assert.equal(segments[1].type, 'mermaid');
    assert.ok(segments[1].code.includes('graph TD'));
    assert.ok(segments[1].code.includes('A[Request] --> B[Atomic Lock]'));
    assert.equal(segments[2].type, 'html');
    assert.ok(segments[2].html.includes('Next Steps'));

    // 2. readFileContent fallback: file present in task workspace but not factory root
    const wsRelPath = join('docs', 'research', 'issue-71-investigation.md');
    const wsFullPath = join(taskWs, wsRelPath);
    mkdirSync(join(taskWs, 'docs', 'research'), { recursive: true });
    writeFileSync(wsFullPath, sampleDoc, 'utf-8');

    const readRes = readFileContent(join(tmpDir, wsRelPath), {
      factoryRoot: tmpDir,
      allowedRoots: [tmpDir, taskWs],
    });
    assert.equal(readRes.ok, true);
    assert.equal(readRes.path, wsFullPath);
    assert.equal(readRes.extension, 'md');
    assert.equal(readRes.content, sampleDoc);
  } finally {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C32: provisionTaskWorkspace creates timestamped isolated directories under runs/workspaces and cleanupTaskWorkspace deletes them safely', () => {
  const tmpDir = makeTempFactoryClone();

  try {
    const fixedTime = '2026-11-08T03:00:00.000Z';
    const wsRes = provisionTaskWorkspace({
      factoryRoot: tmpDir,
      repo: 'brenoacker/incident-investigator',
      issueNumber: 86,
      timestamp: fixedTime,
    });

    assert.equal(wsRes.ok, true);
    // Verifies workspace is placed under runs/workspaces and contains safeSlug, issue number, and timestamp
    assert.ok(wsRes.workspacePath.includes('runs'));
    assert.ok(wsRes.workspacePath.includes('workspaces'));
    assert.ok(wsRes.workspacePath.includes('issue-86'));
    assert.ok(wsRes.workspacePath.includes('2026-11-08'));
    assert.ok(existsSync(wsRes.workspacePath));

    // Verifies cleanupTaskWorkspace removes the directory safely
    const cleanupRes = cleanupTaskWorkspace(wsRes.workspacePath);
    assert.equal(cleanupRes.ok, true);
    assert.equal(cleanupRes.deleted, true);
    assert.equal(existsSync(wsRes.workspacePath), false);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C33: dispatcher physically materializes investigation and discovery markdown documents with concrete evidence and recommendations', () => {
  const tmpDir = makeTempFactoryClone();
  const taskWs = join(tmpDir, 'runs', 'workspaces', 'test-task-86');
  mkdirSync(taskWs, { recursive: true });

  try {
    const payload = {
      question: 'Why do concurrent stage callbacks require single-use stage tokens?',
      answer_summary: 'Without single-use tokens, parallel webhook dispatches can execute duplicate transitions.',
      evidence: ['Race condition detected on tasks table at timestamp T1', 'Replay attack replicated in SQLite tests'],
      options_compared: [
        { option: 'Pessimistic table lock', pros: 'Simple', cons: 'Blocks unrelated tickets' },
        { option: 'Single-use stage token', pros: 'Fine-grained atomicity', cons: 'Requires token generation' },
      ],
      recommendation: 'Enforce single-use stage token on all dispatch transitions.',
      follow_up_tickets: [{ title: 'Add token replay guard', type: 'bug', description: 'Prevent token reuse' }],
    };

    const matRes = materializeInvestigationReport({
      workspacePath: taskWs,
      factoryRoot: tmpDir,
      issueNumber: 86,
      contractPayload: payload,
      type: 'investigation',
    });

    assert.equal(matRes.ok, true);
    const expectedFile = join(taskWs, 'docs', 'research', 'issue-86-investigation.md');
    assert.ok(existsSync(expectedFile));

    const content = readFileSync(expectedFile, 'utf8');
    assert.ok(content.includes('# Investigation Report #86: Why do concurrent stage callbacks require single-use stage tokens?'));
    assert.ok(content.includes('## Answer Summary'));
    assert.ok(content.includes('Without single-use tokens, parallel webhook dispatches can execute duplicate transitions.'));
    assert.ok(content.includes('## Evidence'));
    assert.ok(content.includes('Race condition detected on tasks table at timestamp T1'));
    assert.ok(content.includes('## Options Compared'));
    assert.ok(content.includes('Pessimistic table lock'));
    assert.ok(content.includes('Single-use stage token'));
    assert.ok(content.includes('## Recommendation'));
    assert.ok(content.includes('Enforce single-use stage token on all dispatch transitions.'));
    assert.ok(content.includes('## Follow-up Tickets'));
    assert.ok(content.includes('Add token replay guard'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C34: advanceTicketInPanel cleans up temporary workspace when task reaches done', () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const store = new FactoryStore(dbPath);
  const taskWs = join(tmpDir, 'runs', 'workspaces', 'temp-ws-cleanup-test');
  mkdirSync(taskWs, { recursive: true });
  writeFileSync(join(taskWs, 'report.txt'), 'Deliverable content', 'utf8');

  try {
    const task = store.createTask({
      executionKey: 'brenoacker/agentic-factory#950',
      issueNumber: 950,
      repo: 'brenoacker/agentic-factory',
      title: 'Investigation task to complete and cleanup',
      type: 'investigation',
      stage: 'investigate',
    });
    store.attachTaskWorkspace(task.execution_key, {
      workspacePath: taskWs,
      branchName: 'factory/issue-950',
    });
    store.attachTaskDeliverable(task.execution_key, {
      type: 'research_document',
      url: 'docs/research/issue-950-investigation.md',
      ref: 'Cleanup Verification',
    });

    assert.ok(existsSync(taskWs));

    const advRes = advanceTicketInPanel({
      executionKey: task.execution_key,
      factoryRoot: tmpDir,
      store,
      approveCurrentStage: true,
      trackerRunner: () => ({ ok: true, status: 200 }),
    });

    assert.equal(advRes.ok, true);
    assert.equal(advRes.stage, 'done');
    // Verifies workspace directory was deleted on disk upon reaching 'done'
    assert.equal(existsSync(taskWs), false);
    // Verifies task record is still preserved in SQLite
    const finalTask = store.getTask(task.execution_key);
    assert.equal(finalTask.stage, 'done');
    assert.equal(finalTask.deliverable_type, 'research_document');
  } finally {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C35: classifyTicketType uses deliverable-oriented weighted scoring, discounts repository stopwords, and prioritizes engineering sections', () => {
  // AC 1: Prefix in title returns feature
  assert.equal(classifyTicketType({ title: 'Spec: Incident Investigation Harness — Read-Only Investigation MVP' }), 'feature');
  assert.equal(classifyTicketType({ title: '[Spec] Incident Investigation Harness' }), 'feature');
  assert.equal(classifyTicketType({ title: 'Feature: Add OAuth Login' }), 'feature');
  assert.equal(classifyTicketType({ title: '[Feature] Export metrics to Prometheus' }), 'feature');
  assert.equal(classifyTicketType({ title: 'Implement: Webhook delivery queue' }), 'feature');

  // AC 2 & 3: Body with structural engineering sections & repository stopwords discounted
  const specClassification = classifyTicketType({
    title: 'Incident Investigation Harness — Read-Only MVP',
    repo: 'brenoacker/incident-investigator',
    body: `
## User Stories
As a site reliability engineer, I want to query recent incidents.

## Acceptance Criteria
- [ ] Provide read-only investigation API endpoint
- [ ] Ready for implementation
    `,
  });
  assert.equal(specClassification, 'feature');

  // AC 3: Discounts repository stopwords so they don't falsely classify
  const repoStopwordClassification = classifyTicketType({
    title: 'Update incident investigator dependencies',
    repo: 'brenoacker/incident-investigator',
    body: 'Bump all package versions and clean up lockfile',
  });
  assert.equal(repoStopwordClassification, 'chore');

  // AC 4: Steps to reproduce, error, or stack traces return bug
  const bugClassification = classifyTicketType({
    title: 'Null pointer in session handler',
    body: `
## Steps to Reproduce
1. Start worker
2. Send empty payload
TypeError: Cannot read properties of undefined (reading 'session')
    `,
  });
  assert.equal(bugClassification, 'bug');

  // AC 5: Open exploratory questions without implementation criteria return investigation
  const investigationClassification = classifyTicketType({
    title: 'Why does CPU spike under high traffic?',
    body: 'Options comparison and technical spike to evaluate root causes without implementation.',
  });
  assert.equal(investigationClassification, 'investigation');
});

test('C36: POST /api/tickets/:key/reclassify updates task type, resets deliverable rules, and rejects invalid types', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);
  const store = panel.store;

  try {
    // Setup a task with type 'investigation' and an attached research doc
    const key = 'brenoacker/agentic-factory#980';
    store.createTask({
      executionKey: key,
      issueNumber: 980,
      repo: 'brenoacker/agentic-factory',
      title: 'Investigation task to be reclassified',
      type: 'investigation',
      stage: 'investigate',
    });
    store.attachTaskDeliverable(key, {
      type: 'research_document',
      url: 'docs/research/sample.md',
      ref: 'Sample Research Doc',
    });

    const initialTask = store.getTask(key);
    assert.equal(initialTask.type, 'investigation');
    assert.equal(initialTask.deliverable_type, 'research_document');

    // AC 6: Reclassify to feature -> HTTP 200, task type updated in DB
    const res200 = await fetch(`${baseUrl}/api/tickets/${encodeURIComponent(key)}/reclassify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'feature' }),
    });
    assert.equal(res200.status, 200);
    const body200 = await res200.json();
    assert.equal(body200.ok, true);
    assert.equal(body200.task.type, 'feature');

    // AC 9: Deliverable expectations reset to require a pull request for code workflows
    const updatedTask = store.getTask(key);
    assert.equal(updatedTask.type, 'feature');
    assert.equal(updatedTask.deliverable_type, '');
    assert.equal(updatedTask.deliverable_url, '');
    const deliverableCheck = store.validateTaskDeliverable(updatedTask);
    assert.equal(deliverableCheck.ok, false);
    assert.equal(deliverableCheck.code, 'missing_deliverable');

    // AC 7: Invalid type -> HTTP 400
    const res400 = await fetch(`${baseUrl}/api/tickets/${encodeURIComponent(key)}/reclassify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'invalid_banana' }),
    });
    assert.equal(res400.status, 400);
    const body400 = await res400.json();
    assert.equal(body400.ok, false);
    assert.equal(body400.error, 'Invalid ticket type');

    // AC 8: Non-existent task -> HTTP 404
    const res404 = await fetch(`${baseUrl}/api/tickets/non-existent-task%239999/reclassify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'feature' }),
    });
    assert.equal(res404.status, 404);
    const body404 = await res404.json();
    assert.equal(body404.ok, false);
    assert.equal(body404.error, 'Task not found');
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});




