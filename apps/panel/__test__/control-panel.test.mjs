import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  intakeAndTriageTicket,
  advanceTicketInPanel,
  provisionTaskWorkspace,
  FactoryStore,
} from '../../../packages/core/index.mjs';
import { makeTempFactoryClone } from '../../../test-support/factory-clone.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

async function startTestServer(rootDir, dbPath) {
  const panel = createPanelServer({ rootDir, dbPath });
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
      trackerRunner: mockLinearTrackerRunner,
    });

    assert.equal(linearDispatch.ok, true);
    assert.equal(linearDispatch.stage, 'done');
    assert.equal(linearDispatch.trackerFeedback?.tracker, 'linear');
    assert.ok(linearCalls.some((c) => c.action === 'linear_update' && c.stateName === 'Done'));
  } finally {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
