import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createPanelServer } from '../../../apps/panel/server.mjs';
import { classifyTicketType } from '../index.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function makeTempFactoryClone() {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-factory-pipeline-'));
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

test('C1: classifyTicketType and POST /api/tickets/intake classify all 5 ticket types with 201, return 400 on missing fields, and 409 on duplicate', async () => {
  // 1. Verify classifier across labels, bracket prefixes, and natural-language descriptions
  assert.equal(classifyTicketType({ title: 'Add OAuth webhook support', labels: ['type:feature'] }), 'feature');
  assert.equal(classifyTicketType({ title: '[bug] Crash when parsing empty YAML' }), 'bug');
  assert.equal(classifyTicketType({ title: 'Why does the worker retry loop spike CPU?', body: 'Please investigate and compare options' }), 'investigation');
  assert.equal(classifyTicketType({ title: 'New greenfield idea: write PRD and design doc for multi-repo runner' }), 'discovery');
  assert.equal(classifyTicketType({ title: 'Bump GitHub Actions CI dependencies and cleanup lint' }), 'chore');

  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    // Missing title -> 400
    const badRes = await fetch(`${baseUrl}/api/tickets/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue_number: 100 }),
    });
    assert.equal(badRes.status, 400);

    const sampleTickets = [
      { issue_number: 101, title: '[feature] Add Prometheus metrics endpoint', expectedType: 'feature' },
      { issue_number: 102, title: 'TypeError regression when review findings array is empty', expectedType: 'bug' },
      { issue_number: 103, title: 'Investigate SQLite WAL contention under 10 concurrent workers', expectedType: 'investigation' },
      { issue_number: 104, title: 'Discovery PRD and design doc for remote cloud sandbox executor', expectedType: 'discovery' },
      { issue_number: 105, title: 'Chore: update CI workflow node version and documentation', expectedType: 'chore' },
    ];

    for (const item of sampleTickets) {
      const res = await fetch(`${baseUrl}/api/tickets/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issue_number: item.issue_number, title: item.title }),
      });
      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.classifiedType, item.expectedType);
      assert.equal(data.initialStage, 'triage');
      assert.equal(data.task.type, item.expectedType);
      assert.equal(data.task.stage, 'triage');
    }

    // Duplicate active task -> 409
    const dupRes = await fetch(`${baseUrl}/api/tickets/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue_number: 101, title: '[feature] Duplicate feature' }),
    });
    assert.equal(dupRes.status, 409);
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C2: POST /api/tickets/:key/dispatch executes full stage lifecycles for feature, bug, investigation, discovery, and chore to done and returns 404 for unknown key', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    // Unknown task key -> 404
    const missingRes = await fetch(`${baseUrl}/api/tickets/${encodeURIComponent('brenoacker/agentic-factory#999')}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(missingRes.status, 404);

    const tickets = [
      { issue_number: 201, title: '[feature] Add token budget alert banner', type: 'feature' },
      { issue_number: 202, title: '[bug] Fix null pointer in adapter stderr parser', type: 'bug' },
      { issue_number: 203, title: '[investigation] Compare ETag polling vs GitHub webhook latency', type: 'investigation' },
      { issue_number: 204, title: '[discovery] Draft PRD for multi-project portfolio view', type: 'discovery' },
      { issue_number: 205, title: '[chore] Update README quickstart commands', type: 'chore' },
    ];

    for (const t of tickets) {
      const intakeRes = await fetch(`${baseUrl}/api/tickets/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(t),
      });
      assert.equal(intakeRes.status, 201);
    }

    // 1. Feature workflow: triage -> plan (humanApproval pause) -> checks_and_build -> verify -> review -> merge (human stage pause) -> done
    const featKey = encodeURIComponent('brenoacker/agentic-factory#201');
    let res = await (await fetch(`${baseUrl}/api/tickets/${featKey}/dispatch`, { method: 'POST', body: '{}' })).json();
    assert.deepEqual(res.stepsExecuted, ['triage', 'plan']);
    assert.equal(res.stage, 'plan');
    assert.equal(res.task.needs_human, 1);

    res = await (await fetch(`${baseUrl}/api/tickets/${featKey}/dispatch`, { method: 'POST', body: JSON.stringify({ approveCurrentStage: true }) })).json();
    assert.deepEqual(res.stepsExecuted, ['checks_and_build', 'verify', 'review']);
    assert.equal(res.stage, 'merge');
    assert.equal(res.task.needs_human, 1);

    res = await (await fetch(`${baseUrl}/api/tickets/${featKey}/dispatch`, { method: 'POST', body: JSON.stringify({ approveCurrentStage: true }) })).json();
    assert.equal(res.stage, 'done');

    // 2. Bug workflow: triage -> checks_and_build -> verify -> review -> merge (human stage pause) -> done
    const bugKey = encodeURIComponent('brenoacker/agentic-factory#202');
    res = await (await fetch(`${baseUrl}/api/tickets/${bugKey}/dispatch`, { method: 'POST', body: '{}' })).json();
    assert.deepEqual(res.stepsExecuted, ['triage', 'checks_and_build', 'verify', 'review']);
    assert.equal(res.stage, 'merge');

    res = await (await fetch(`${baseUrl}/api/tickets/${bugKey}/dispatch`, { method: 'POST', body: JSON.stringify({ approveCurrentStage: true }) })).json();
    assert.equal(res.stage, 'done');

    // 3. Investigation workflow: triage -> investigate (humanApproval pause + followUpTickets) -> done
    const invKey = encodeURIComponent('brenoacker/agentic-factory#203');
    res = await (await fetch(`${baseUrl}/api/tickets/${invKey}/dispatch`, { method: 'POST', body: '{}' })).json();
    assert.deepEqual(res.stepsExecuted, ['triage', 'investigate']);
    assert.equal(res.stage, 'investigate');
    assert.equal(res.followUpTickets.length, 2);

    res = await (await fetch(`${baseUrl}/api/tickets/${invKey}/dispatch`, { method: 'POST', body: JSON.stringify({ approveCurrentStage: true }) })).json();
    assert.equal(res.stage, 'done');

    // 4. Discovery workflow: triage -> discover (humanApproval pause) -> done
    const discKey = encodeURIComponent('brenoacker/agentic-factory#204');
    res = await (await fetch(`${baseUrl}/api/tickets/${discKey}/dispatch`, { method: 'POST', body: '{}' })).json();
    assert.deepEqual(res.stepsExecuted, ['triage', 'discover']);
    assert.equal(res.stage, 'discover');

    res = await (await fetch(`${baseUrl}/api/tickets/${discKey}/dispatch`, { method: 'POST', body: JSON.stringify({ approveCurrentStage: true }) })).json();
    assert.equal(res.stage, 'done');

    // 5. Chore workflow: triage -> checks_and_build -> review -> merge (human stage pause) -> done
    const choreKey = encodeURIComponent('brenoacker/agentic-factory#205');
    res = await (await fetch(`${baseUrl}/api/tickets/${choreKey}/dispatch`, { method: 'POST', body: '{}' })).json();
    assert.deepEqual(res.stepsExecuted, ['triage', 'checks_and_build', 'review']);
    assert.equal(res.stage, 'merge');

    res = await (await fetch(`${baseUrl}/api/tickets/${choreKey}/dispatch`, { method: 'POST', body: JSON.stringify({ approveCurrentStage: true }) })).json();
    assert.equal(res.stage, 'done');
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C7: multi-repo endpoints GET/POST/DELETE /api/projects and POST /api/projects/sync manage external repos and sync issues with per-repo ETag caching', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');

  let callCount = 0;
  const mockIssuePollRunner = ({ repo, etag }) => {
    callCount += 1;
    if (repo === 'brenoacker/external-service') {
      if (etag === 'W/"etag-ext-1"') {
        return { status: 304, etag: 'W/"etag-ext-1"', body: [] };
      }
      return {
        status: 200,
        etag: 'W/"etag-ext-1"',
        body: [
          {
            number: 12,
            title: 'TypeError crash when user session expires on external-service',
            body: 'Stack trace in auth middleware',
            labels: [],
          },
          {
            number: 15,
            title: '[feature] Add rate-limit header to external-service responses',
            body: 'Expose X-RateLimit-Remaining',
            labels: [{ name: 'type:feature' }],
          },
        ],
      };
    }
    return { status: 200, etag: 'W/"etag-default"', body: [] };
  };

  const panel = createPanelServer({ rootDir: tmpDir, dbPath, issuePollRunner: mockIssuePollRunner });
  await new Promise((resolveListen) => panel.server.listen(0, '127.0.0.1', resolveListen));
  const baseUrl = `http://127.0.0.1:${panel.server.address().port}`;

  try {
    // 1. Invalid repo string -> 400
    const badRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'invalid-repo-name' }),
    });
    assert.equal(badRes.status, 400);

    // 2. Add new external repository -> 201
    const addRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'brenoacker/external-service', defaultBranch: 'develop' }),
    });
    assert.equal(addRes.status, 201);
    const addData = await addRes.json();
    assert.equal(addData.project.repo, 'brenoacker/external-service');
    assert.equal(addData.project.defaultBranch, 'develop');

    // 3. Update existing repository (pause/unpause) -> 200
    const updRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'brenoacker/agentic-factory', paused: true }),
    });
    assert.equal(updRes.status, 200);

    // 4. Sync issues across unpaused monitored repositories -> polls only brenoacker/external-service (since agentic-factory is paused)
    const sync1 = await (await fetch(`${baseUrl}/api/projects/sync`, { method: 'POST' })).json();
    assert.equal(sync1.ok, true);
    assert.equal(sync1.polledRepos, 1);
    assert.equal(sync1.newTasksCount, 2);
    assert.equal(panel.store.getTask('brenoacker/external-service#12').type, 'bug');
    assert.equal(panel.store.getTask('brenoacker/external-service#15').type, 'feature');

    // 5. Second sync uses cached ETag W/"etag-ext-1" and receives 304 Not Modified
    const sync2 = await (await fetch(`${baseUrl}/api/projects/sync`, { method: 'POST' })).json();
    assert.equal(sync2.skippedNotModified, 1);
    assert.equal(sync2.newTasksCount, 0);
    assert.equal(callCount, 2);

    // 6. GET /api/projects lists both projects and saved ETag
    const listData = await (await fetch(`${baseUrl}/api/projects`)).json();
    assert.equal(listData.projects.length, 2);
    assert.ok(listData.etags.some((e) => e.repo === 'brenoacker/external-service' && e.etag === 'W/"etag-ext-1"'));

    // 7. DELETE /api/projects/:repo returns 200 on existing and 404 on unknown
    const delRes = await fetch(`${baseUrl}/api/projects/${encodeURIComponent('brenoacker/external-service')}`, {
      method: 'DELETE',
    });
    assert.equal(delRes.status, 200);

    const delMissing = await fetch(`${baseUrl}/api/projects/${encodeURIComponent('brenoacker/unknown-repo')}`, {
      method: 'DELETE',
    });
    assert.equal(delMissing.status, 404);
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C8: evaluateStalledTasks and GET /api/alarms/stalled detect warning/critical stalled tasks, ignore done tasks, and return 400 on invalid threshold', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    const nowMs = Date.now();
    const fortyFiveMinAgo = new Date(nowMs - 45 * 60_000).toISOString();
    const seventyFiveMinAgo = new Date(nowMs - 75 * 60_000).toISOString();
    const twoHoursAgo = new Date(nowMs - 120 * 60_000).toISOString();

    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#501',
      issueNumber: 501,
      repo: 'brenoacker/agentic-factory',
      title: '[feature] Stalled warning feature',
      type: 'feature',
      stage: 'plan',
      now: fortyFiveMinAgo,
    });
    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#502',
      issueNumber: 502,
      repo: 'brenoacker/agentic-factory',
      title: '[feature] Stalled critical feature',
      type: 'feature',
      stage: 'checks_and_build',
      now: seventyFiveMinAgo,
    });
    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#503',
      issueNumber: 503,
      repo: 'brenoacker/agentic-factory',
      title: '[feature] Completed feature ignored by alarm',
      type: 'feature',
      stage: 'done',
      now: twoHoursAgo,
    });

    // Invalid threshold -> 400
    const badRes = await fetch(`${baseUrl}/api/alarms/stalled?thresholdMinutes=-5`);
    assert.equal(badRes.status, 400);

    // Valid evaluation with threshold 30 min -> 200
    const res = await fetch(`${baseUrl}/api/alarms/stalled?thresholdMinutes=30`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.stalledCount, 2);

    const warnTask = data.stalledTasks.find((t) => t.issueNumber === 501);
    const critTask = data.stalledTasks.find((t) => t.issueNumber === 502);
    assert.equal(warnTask.severity, 'warning');
    assert.ok(warnTask.idleMinutes >= 45);
    assert.equal(critTask.severity, 'critical');
    assert.ok(critTask.idleMinutes >= 75);

    // Repeat call deduplicates task_stalled_alarm telemetry events
    await fetch(`${baseUrl}/api/alarms/stalled?thresholdMinutes=30`);
    const alarmEvents = panel.store.db
      .prepare("SELECT * FROM telemetry_events WHERE event_type = 'task_stalled_alarm'")
      .all();
    assert.equal(alarmEvents.length, 2);
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C9: POST /api/tasks/:key/acknowledge clears stalled task alarm with 200 and returns 404 for unknown task', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');
  const { panel, baseUrl } = await startTestServer(tmpDir, dbPath);

  try {
    const sixtyMinAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    panel.store.createTask({
      executionKey: 'brenoacker/agentic-factory#504',
      issueNumber: 504,
      repo: 'brenoacker/agentic-factory',
      title: '[feature] Acknowledge stalled alarm test',
      type: 'feature',
      stage: 'plan',
      now: sixtyMinAgo,
    });

    const before = await (await fetch(`${baseUrl}/api/alarms/stalled?thresholdMinutes=30`)).json();
    assert.equal(before.stalledCount, 1);

    const ackRes = await fetch(
      `${baseUrl}/api/tasks/${encodeURIComponent('brenoacker/agentic-factory#504')}/acknowledge`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor: 'brenoacker', note: 'Snoozing for 30m' }),
      },
    );
    assert.equal(ackRes.status, 200);

    const after = await (await fetch(`${baseUrl}/api/alarms/stalled?thresholdMinutes=30`)).json();
    assert.equal(after.stalledCount, 0);

    const missingRes = await fetch(
      `${baseUrl}/api/tasks/${encodeURIComponent('brenoacker/agentic-factory#9999')}/acknowledge`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    assert.equal(missingRes.status, 404);
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});


