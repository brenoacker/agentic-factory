# Concurrency Scheduler Lifecycle and Human Input checks

Build: `node scripts/build-panel.mjs; node --check apps/panel/server.mjs; node --check packages/core/src/store.mjs; node --check packages/core/src/projects.mjs; node --check packages/core/src/pipeline.mjs`
Run unit: `node --test apps/panel/__test__/control-panel.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/concurrency-scheduler-and-human-input/plan.md`

3 checks in 3 slices · 3 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Executing Agents Concurrency and Workspace Preservation

**C1** - `countExecutingAgents()` excludes tasks in `merge` stage and tasks with `needs_human = 1` from active execution count, releases concurrency slots while keeping task open and preserving workspace on disk, and `getStalledTasks()` excludes queued triage tasks from alarms (AC 1, AC 2, AC 3, AC 4, AC 5)
Proof: run unit | ✔ C14: Executing agent concurrency excludes merge and needs_human tasks, preserves workspace, and filters queued triage from stall alarms

### S2 - Cron-Driven Auto-Dispatch of Queued Tasks

**C2** - Polling scheduler computes available executing capacity (`maxConcurrentAgents - countExecutingAgents()`) and auto-dispatches eligible triage tasks during cron cycle and immediate trigger, leaving remainder in triage when capacity is exhausted (AC 6, AC 7, AC 8)
Proof: run unit | ✔ C15: Periodic scheduler auto-dispatches queued triage tasks up to executing concurrency ceiling

### S3 - Interactive Human Clarification Screen

**C3** - Playwright E2E test verifies Cloudscape UI renders "Agents Waiting for Human Input & Clarification" with agent questions, inputs clarification in `#human-reply-input-{issueNumber}`, clicks `#human-reply-btn-{issueNumber}` to resume task, and confirms navigation badges reflect waiting agent count (AC 9, AC 10, AC 11)
Proof: run e2e | ok 13 [chromium] › C16: Playwright E2E test verifies interactive human clarification screen, reply submission, and cron auto-dispatch

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (3) | Door 1 (Executing Agents vs Waiting Tasks Concurrency Model) C1, C3 · Door 2 (Cron-Driven Auto-Dispatch of Ready Tasks) C2, C3 · Door 3 (Interactive Human Clarification Reply & Needs-Human Screen) C3 | - |
| `POST /api/scheduler` statuses (2) | `200` C2, C3 · `400` C2 | - |
| `POST /api/tasks/:key/approve` statuses (3) | `200` C1, C3 · `400` C1 · `404` C1 | - |
| `GET /api/dashboard` statuses (1) | `200` C1, C2, C3 | - |
| `POST /api/tickets/:key/dispatch` statuses (3) | `200` C1, C2, C3 · `404` C1 · `422` C1 | - |
| Stored entities (5) | `FACTORY_CONFIG` C1, C2 · `LIMITS` C1, C2, C3 · `TASK` C1, C2, C3 · `WORKSPACE` C1, C3 · `HUMAN_INPUT` C1, C3 | - |

## Swept

- validation: C1, C2, C3
- failure modes: C1, C2
- idempotency: C1, C2, C3
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C1, C2, C3
- data lifecycle: C1, C2, C3
- dependency failure: C1, C2
- state transitions: C1, C2, C3
- observability: C1, C2, C3

## Handoff

- **Settled mid-build:** none
- **Dispatched:** Independent Feature Verifier at eb91d31
- **Boundary:** pending
- **Abandoned:** none
- **Walked:** pending
