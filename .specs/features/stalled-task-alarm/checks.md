# Stalled Task Alarm and Operator Notification System checks

Build: `node --check apps/panel/server.mjs; node --check packages/core/src/store.mjs`
Run unit: `node --test packages/core/__test__/pipeline.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/stalled-task-alarm/plan.md`

3 checks in 1 slice · 2 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Stalled Task Detector, API Endpoints, and Visual Alarm Banner

**C1** - `evaluateStalledTasks` and `GET /api/alarms/stalled` return `200` with stalled active tasks (`warning` at `>= threshold`, `critical` at `>= 2 * threshold`), record deduplicated `task_stalled_alarm` telemetry events, ignore `done` tasks, and return `400` on invalid `thresholdMinutes` (AC 1)
Proof: run unit | ✔ C8: evaluateStalledTasks and GET /api/alarms/stalled detect warning/critical stalled tasks, ignore done tasks, and return 400 on invalid threshold

**C2** - `POST /api/tasks/:key/acknowledge` returns `200` refreshing `updated_at`, clearing the stalled alarm, and recording `alarm_acknowledged`, and returns `404` for an unknown task key (AC 2)
Proof: run unit | ✔ C9: POST /api/tasks/:key/acknowledge clears stalled task alarm with 200 and returns 404 for unknown task

**C3** - Playwright E2E test verifies that a stalled feature triggers the global `#stalled-alarm-banner`, `#header-alarm-badge`, and Kanban card `STALLED` badge in Chromium, allows updating `stallThresholdMinutes` in `Operational Controls`, and clears the alarm when the operator clicks `Snooze Alarm` or `Act Now` (AC 3)
Proof: run e2e | ok 6 [chromium] › C9: Playwright E2E test verifies stalled feature alarm banner, header badge, Kanban badge, and 1-click resolution

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (2) | Door 1 (Stalled task detection & acknowledgement API) C1, C2 · Door 2 (Visual & audible Stalled Task Alarm UI) C3 | - |
| `GET /api/alarms/stalled` statuses (2) | `200` C1 · `400` C1 | - |
| `POST /api/tasks/:key/acknowledge` statuses (2) | `200` C2, C3 · `404` C2 | - |
| Stall severity classification, AC 1 (3 examples) | `45` min (`warning`) C1 · `75` min (`critical`) C1 · `done` task (`not stalled`) C1 | - |
| Stored entities (2) | `TASK` C1, C2, C3 · `TELEMETRY_EVENT` C1, C2 | - |

## Swept

- validation: C1, C3
- failure modes: C1, C2
- idempotency: C1, C2
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C1, C2
- data lifecycle: C1, C2
- dependency failure: n/a - local SQLite timestamp calculation
- state transitions: C2, C3
- observability: C1, C2, C3

## Handoff

- **Settled mid-build:** none
- **Dispatched:** none
- **Boundary:** none yet
- **Abandoned:** none
- **Walked:** pending browser E2E run
