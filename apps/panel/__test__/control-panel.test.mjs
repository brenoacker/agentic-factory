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
} from '../../../packages/core/index.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function makeTempFactoryClone() {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-factory-panel-'));
  for (const item of ['factory.yaml', 'skills.lock.json', 'config', 'workflows', 'contracts', 'brain', 'agents']) {
    cpSync(join(REPO_ROOT, item), join(dir, item), { recursive: true });
  }
  return dir;
}

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
