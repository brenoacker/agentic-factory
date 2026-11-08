import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createPanelServer } from '../../../apps/panel/server.mjs';
import { classifyTicketType, evaluateTicketPickupTriggers } from '../index.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function makeTempFactoryClone() {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-factory-pipeline-'));
  for (const item of ['factory.yaml', 'skills.lock.json', 'config', 'workflows', 'contracts', 'brain', 'agents']) {
    cpSync(join(REPO_ROOT, item), join(dir, item), { recursive: true });
  }
  return dir;
}

async function startTestServer(rootDir, dbPath, issuePollRunner = null) {
  const runner = issuePollRunner || ((args) => {
    if (args?.action === 'check_pr') {
      return { ok: true, merged: true, prNumber: 1, state: 'MERGED', url: 'https://github.com/brenoacker/agentic-factory/pull/1' };
    }
    return { status: 0, stdout: '[]' };
  });
  const panel = createPanelServer({ rootDir, dbPath, issuePollRunner: runner });
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

    // 1. Feature workflow: triage -> plan (autonomous) -> checks_and_build -> verify -> review -> merge (human stage pause) -> done
    const featKey = encodeURIComponent('brenoacker/agentic-factory#201');
    let res = await (await fetch(`${baseUrl}/api/tickets/${featKey}/dispatch`, { method: 'POST', body: '{}' })).json();
    assert.deepEqual(res.stepsExecuted, ['triage', 'plan', 'checks_and_build', 'verify', 'review']);
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

    // 3. Investigation workflow: triage -> investigate -> done (autonomous non-code research workflow)
    const invKey = encodeURIComponent('brenoacker/agentic-factory#203');
    res = await (await fetch(`${baseUrl}/api/tickets/${invKey}/dispatch`, { method: 'POST', body: '{}' })).json();
    assert.deepEqual(res.stepsExecuted, ['triage', 'investigate']);
    assert.equal(res.stage, 'done');
    assert.equal(res.followUpTickets.length, 2);

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
    if (repo === 'brenoacker/external-service' && etag !== undefined) {
      callCount += 1;
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

    // 4. Sync issues across unpaused monitored repositories
    const sync1 = await (await fetch(`${baseUrl}/api/projects/sync`, { method: 'POST' })).json();
    assert.equal(sync1.ok, true);
    assert.equal(sync1.polledRepos, 3);
    assert.equal(sync1.newTasksCount, 2);
    assert.equal(panel.store.getTask('brenoacker/external-service#12').type, 'bug');
    assert.equal(panel.store.getTask('brenoacker/external-service#15').type, 'feature');

    // 5. Second sync uses cached ETag W/"etag-ext-1" and receives 304 Not Modified
    const sync2 = await (await fetch(`${baseUrl}/api/projects/sync`, { method: 'POST' })).json();
    assert.equal(sync2.skippedNotModified, 1);
    assert.equal(sync2.newTasksCount, 0);
    assert.equal(callCount, 2);

    // 6. GET /api/projects lists all projects and saved ETag
    const listData = await (await fetch(`${baseUrl}/api/projects`)).json();
    assert.equal(listData.projects.length, 4);
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

test('C10: Multi-provider tracker adapter configures and polls GitHub, Jira, and Asana projects with status filtering and returns 400 on invalid provider config', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');

  const mockMultiTrackerRunner = ({ provider, repo, jql, statusFilter }) => {
    if (provider === 'jira' && repo === 'brenoacker/jira-payments') {
      assert.ok(jql.includes('project = "FAC"'));
      assert.ok(jql.includes('status = "Ready for Agent"'));
      return {
        status: 200,
        etag: 'W/"jira-fac-1"',
        body: {
          issues: [
            {
              key: 'FAC-701',
              fields: {
                summary: 'TypeError crash when refunding partial invoice in Jira',
                description: 'Steps to reproduce in billing worker',
                status: { name: 'Ready for Agent' },
                issuetype: { name: 'Bug' },
                labels: [],
              },
            },
            {
              key: 'FAC-702',
              fields: {
                summary: 'Backlog ticket that should be skipped by status filter',
                description: 'Still in backlog',
                status: { name: 'Backlog' },
                issuetype: { name: 'Story' },
                labels: [],
              },
            },
          ],
        },
      };
    }

    if (provider === 'asana' && repo === 'brenoacker/asana-growth') {
      assert.equal(statusFilter, 'Ready for Agent');
      return {
        status: 200,
        etag: 'W/"asana-1"',
        body: {
          data: [
            {
              gid: '1200703',
              name: '[feature] Add onboarding funnel analytics event from Asana',
              notes: 'Track signup completion step',
              completed: false,
              memberships: [{ section: { name: 'Ready for Agent' } }],
              tags: [{ name: 'type:feature' }],
            },
            {
              gid: '1200704',
              name: 'Draft task in Doing section that should not be intaked',
              notes: 'Not in target section',
              completed: false,
              memberships: [{ section: { name: 'In Progress' } }],
              tags: [],
            },
          ],
        },
      };
    }

    return { status: 200, etag: 'W/"gh-default"', body: [] };
  };

  const panel = createPanelServer({ rootDir: tmpDir, dbPath, issuePollRunner: mockMultiTrackerRunner });
  await new Promise((resolveListen) => panel.server.listen(0, '127.0.0.1', resolveListen));
  const baseUrl = `http://127.0.0.1:${panel.server.address().port}`;

  try {
    // 1. Invalid provider -> 400
    const badProviderRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'brenoacker/trello-app', provider: 'trello' }),
    });
    assert.equal(badProviderRes.status, 400);

    // 2. Jira without projectKey or jql -> 400
    const badJiraRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'brenoacker/jira-payments', provider: 'jira', trackerConfig: {} }),
    });
    assert.equal(badJiraRes.status, 400);

    // 3. Valid Jira project -> 201
    const okJiraRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: 'brenoacker/jira-payments',
        provider: 'jira',
        defaultBranch: 'main',
        trackerConfig: {
          projectKey: 'FAC',
          statusFilter: 'Ready for Agent',
        },
      }),
    });
    assert.equal(okJiraRes.status, 201);

    // 4. Valid Asana project -> 201
    const okAsanaRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: 'brenoacker/asana-growth',
        provider: 'asana',
        defaultBranch: 'main',
        trackerConfig: {
          projectGid: '120055',
          statusFilter: 'Ready for Agent',
        },
      }),
    });
    assert.equal(okAsanaRes.status, 201);

    // 5. Sync across all 5 providers (factory projects + jira + asana)
    const syncRes = await (await fetch(`${baseUrl}/api/projects/sync`, { method: 'POST' })).json();
    assert.equal(syncRes.ok, true);
    assert.equal(syncRes.polledRepos, 5);
    assert.equal(syncRes.newTasksCount, 2);

    const jiraTask = panel.store.getTask('brenoacker/jira-payments#701');
    assert.ok(jiraTask);
    assert.equal(jiraTask.type, 'bug');
    assert.ok(jiraTask.title.includes('[FAC-701]'));
    assert.equal(panel.store.getTask('brenoacker/jira-payments#702'), null);

    const asanaTask = panel.store.getTask('brenoacker/asana-growth#1200703');
    assert.ok(asanaTask);
    assert.equal(asanaTask.type, 'feature');
    assert.ok(asanaTask.title.includes('[Asana-1200703]'));
    assert.equal(panel.store.getTask('brenoacker/asana-growth#1200704'), null);
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C11: POST /api/scheduler configures periodic polling loop, executes immediate multi-provider sync, and returns 400 on invalid intervalSeconds', async () => {
  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');

  const mockRunner = () => ({
    status: 200,
    etag: 'W/"sched-1"',
    body: [
      {
        number: 750,
        title: '[chore] Scheduled cron sync verification ticket',
        body: 'Picked up by periodic scheduler',
        labels: [{ name: 'type:chore' }],
      },
    ],
  });

  const panel = createPanelServer({ rootDir: tmpDir, dbPath, issuePollRunner: mockRunner });
  await new Promise((resolveListen) => panel.server.listen(0, '127.0.0.1', resolveListen));
  const baseUrl = `http://127.0.0.1:${panel.server.address().port}`;

  try {
    // 1. Invalid intervalSeconds (< 5) -> 400
    const badRes = await fetch(`${baseUrl}/api/scheduler`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, intervalSeconds: 1 }),
    });
    assert.equal(badRes.status, 400);

    // 2. Enable scheduler with runImmediately: true -> 200 and polls immediately
    const okRes = await fetch(`${baseUrl}/api/scheduler`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, intervalSeconds: 60, runImmediately: true }),
    });
    assert.equal(okRes.status, 200);
    const data = await okRes.json();
    assert.equal(data.ok, true);
    assert.equal(data.scheduler.enabled, true);
    assert.equal(data.scheduler.intervalSeconds, 60);
    assert.ok(data.scheduler.pollCount >= 1);
    assert.ok(data.scheduler.lastPollAt);
    assert.equal(panel.store.getTask('brenoacker/agentic-factory#750').type, 'chore');
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('C12: evaluateTicketPickupTriggers and POST /api/projects/sync enforce combinable stage, required flags, excluded blocker flags, custom fields, and assignee triggers for Jira and Asana', async () => {
  const triggerConfig = {
    projectKey: 'DEV',
    statusFilter: 'Ready to be Developed, Ready for Agent',
    requiredLabels: ['agent-ready', 'approved'],
    excludedLabels: ['blocked', 'manual-only'],
    requiredCustomFields: { AI_Allowed: 'true', Priority: 'High' },
    assigneeFilter: 'unassigned',
  };

  // Direct unit evaluation of combinable rules
  const eligibleCheck = evaluateTicketPickupTriggers(
    {
      key: 'DEV-901',
      fields: {
        status: { name: 'Ready to be Developed' },
        labels: ['agent-ready', 'approved'],
        priority: { name: 'High' },
        customFields: { AI_Allowed: 'true' },
        assignee: null,
      },
    },
    triggerConfig,
    'jira',
  );
  assert.equal(eligibleCheck.eligible, true);
  assert.equal(eligibleCheck.blockedReason, null);

  const blockedFlagCheck = evaluateTicketPickupTriggers(
    {
      key: 'DEV-902',
      fields: {
        status: { name: 'Ready to be Developed' },
        labels: ['agent-ready', 'approved', 'blocked'],
        priority: { name: 'High' },
        customFields: { AI_Allowed: 'true' },
        assignee: null,
      },
    },
    triggerConfig,
    'jira',
  );
  assert.equal(blockedFlagCheck.eligible, false);
  assert.equal(blockedFlagCheck.blockedReason, 'excluded_flag:blocked');

  const tmpDir = makeTempFactoryClone();
  const dbPath = join(tmpDir, 'factory.db');

  const mockTriggerRunner = ({ provider, repo }) => {
    if (provider === 'jira' && repo === 'brenoacker/jira-triggers') {
      return {
        status: 200,
        etag: 'W/"jira-trig-1"',
        body: {
          issues: [
            {
              key: 'DEV-901',
              fields: {
                summary: '[feature] Implement multi-flag triggered Jira checkout flow',
                description: 'Matches all combinable triggers',
                status: { name: 'Ready to be Developed' },
                labels: ['agent-ready', 'approved'],
                priority: { name: 'High' },
                customFields: { AI_Allowed: 'true' },
                assignee: null,
              },
            },
            {
              key: 'DEV-902',
              fields: {
                summary: 'Blocked Jira ticket that must be skipped',
                description: 'Has blocked flag',
                status: { name: 'Ready to be Developed' },
                labels: ['agent-ready', 'approved', 'blocked'],
                priority: { name: 'High' },
                customFields: { AI_Allowed: 'true' },
                assignee: null,
              },
            },
            {
              key: 'DEV-903',
              fields: {
                summary: 'Jira ticket missing AI_Allowed=true custom field',
                description: 'Custom field is false',
                status: { name: 'Ready to be Developed' },
                labels: ['agent-ready', 'approved'],
                priority: { name: 'High' },
                customFields: { AI_Allowed: 'false' },
                assignee: null,
              },
            },
          ],
        },
      };
    }

    if (provider === 'asana' && repo === 'brenoacker/asana-triggers') {
      return {
        status: 200,
        etag: 'W/"asana-trig-1"',
        body: {
          data: [
            {
              gid: '1200904',
              name: 'TypeError in Asana webhook handler when payload is empty',
              notes: 'Matches section + required tag + custom field',
              completed: false,
              assignee: null,
              memberships: [{ section: { name: 'Ready to be Developed' } }],
              tags: [{ name: 'agent-ready' }],
              custom_fields: [{ name: 'AI_Allowed', display_value: 'true' }],
            },
            {
              gid: '1200905',
              name: 'Asana task missing agent-ready tag',
              notes: 'Should be skipped because required tag is missing',
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

  const panel = createPanelServer({ rootDir: tmpDir, dbPath, issuePollRunner: mockTriggerRunner });
  await new Promise((resolveListen) => panel.server.listen(0, '127.0.0.1', resolveListen));
  const baseUrl = `http://127.0.0.1:${panel.server.address().port}`;

  try {
    // 1. Register Jira project with combinable triggers -> 201
    const jiraRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: 'brenoacker/jira-triggers',
        provider: 'jira',
        defaultBranch: 'main',
        trackerConfig: triggerConfig,
      }),
    });
    assert.equal(jiraRes.status, 201);

    // 2. Register Asana project with combinable triggers -> 201
    const asanaRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: 'brenoacker/asana-triggers',
        provider: 'asana',
        defaultBranch: 'main',
        trackerConfig: {
          projectGid: '120099',
          statusFilter: 'Ready to be Developed',
          requiredLabels: 'agent-ready',
          excludedLabels: 'blocked',
          requiredCustomFields: 'AI_Allowed=true',
          assigneeFilter: 'unassigned',
        },
      }),
    });
    assert.equal(asanaRes.status, 201);

    // 3. Update existing project triggers -> 200
    const updateRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: 'brenoacker/asana-triggers',
        provider: 'asana',
        defaultBranch: 'main',
        trackerConfig: {
          projectGid: '120099',
          statusFilter: 'Ready to be Developed',
          requiredLabels: 'agent-ready',
          excludedLabels: 'blocked, manual-only',
          requiredCustomFields: 'AI_Allowed=true',
          assigneeFilter: 'unassigned',
        },
      }),
    });
    assert.equal(updateRes.status, 200);

    // 4. Invalid project missing GID -> 400
    const badAsana = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: 'brenoacker/asana-bad',
        provider: 'asana',
        trackerConfig: { statusFilter: 'Ready to be Developed' },
      }),
    });
    assert.equal(badAsana.status, 400);

    // 5. Sync projects -> picks up only DEV-901 and 1200904, skipping DEV-902, DEV-903, and 1200905 (3 skipped by triggers)
    const syncData = await (await fetch(`${baseUrl}/api/projects/sync`, { method: 'POST' })).json();
    assert.equal(syncData.ok, true);
    assert.equal(syncData.newTasksCount, 2);
    assert.equal(syncData.skippedByTriggersCount, 3);

    assert.ok(panel.store.getTask('brenoacker/jira-triggers#901'));
    assert.equal(panel.store.getTask('brenoacker/jira-triggers#902'), null);
    assert.equal(panel.store.getTask('brenoacker/jira-triggers#903'), null);

    assert.ok(panel.store.getTask('brenoacker/asana-triggers#1200904'));
    assert.equal(panel.store.getTask('brenoacker/asana-triggers#1200904').type, 'bug');
    assert.equal(panel.store.getTask('brenoacker/asana-triggers#1200905'), null);
  } finally {
    await panel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});


