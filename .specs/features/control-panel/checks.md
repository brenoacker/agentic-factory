# Factory Brain, Control Panel, Workflows Control, and Autonomous Daemon checks

Build: `node --check apps/panel/server.mjs; node --check packages/core/src/brain.mjs; node --check packages/core/cli.mjs`
Run unit: `node --test apps/panel/__test__/control-panel.test.mjs`
Plan: `.specs/features/control-panel/plan.md`

7 checks in 1 slice · 3 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Brain, Specialist Agents, Control Panel API/UI, Workflow Editor, and Deploy Rollback

**C1** - `GET /api/dashboard` returns `200` with JSON containing `status` (tasks, `byStage`, `byType`, `tokens`, `totalCostUsd`, `reviewMetrics`, `needsHuman`), `factoryConfig`, all 5 `workflows`, all 23 locked `skills`, the 7 specialist `agents`, `brain` entries, `runtimeHealth`, and `deployments` (AC 1)
Proof: run unit | ✔ C1: GET /api/dashboard returns 200 with full factory telemetry, workflows, skills, agents, brain, runtimeHealth, and deployments

**C2** - `POST /api/tasks/:key/approve` returns `200`, clears `needs_human` to `0`, and records a `human_approved` telemetry event for an existing paused task, and returns `404` for an unknown task key (AC 2)
Proof: run unit | ✔ C2: POST /api/tasks/:key/approve returns 200 clearing needs_human and 404 for unknown task

**C3** - `POST /api/alerts/production` returns `200` and reopens an existing task into `stage: "triage"` with a `production_alert_reopened` telemetry event, returns `400` when `executionKey` or `message` is missing, and returns `404` when the task does not exist (AC 3)
Proof: run unit | ✔ C3: POST /api/alerts/production returns 200 reopening task to triage, 400 on missing fields, and 404 on unknown task

**C4** - `POST /api/workflows/:id` returns `200` and persists a valid workflow definition (and creates a git commit when `commit: true`), returns `422` when a workflow references an unlocked skill or misses required fields without modifying the file, and returns `400` when the `workflow` payload is missing (AC 4)
Proof: run unit | ✔ C4: POST /api/workflows/:id returns 200 on valid workflow, 422 on unlocked skill, and 400 on malformed body

**C5** - `POST /api/controls` returns `200` after persisting `killSwitch`, `maxTasksPerHour`, `dailyBudgetUsd`, `autonomy`, or `resetRuntime`, and returns `400` when numeric limits are negative or invalid (AC 5)
Proof: run unit | ✔ C5: POST /api/controls returns 200 persisting operational controls and 400 on negative limits

**C6** - `POST /api/deploy/verify` returns `200` saving `commitSha` as `last_good_sha` when `errorRate <= maxErrorRate`, triggers automatic rollback to the previous `last_good_sha` (`rolledBack: true`) when `errorRate > maxErrorRate`, and returns `400` when `commitSha` is missing (AC 6)
Proof: run unit | ✔ C6: POST /api/deploy/verify saves last_good_sha on healthy deploy, rolls back on threshold violation, and returns 400 on missing sha

**C7** - `queryBrain`, `extractFollowUpTickets`, and `canAutoMergeTask` return matching brain entries, structured follow-up tickets from an `investigation-report`, and `true` for `auto-low` merge only when `impact == "low"` and `verdict == "APPROVE"` at matching `HEAD` (AC 7)
Proof: run unit | ✔ C7: queryBrain, extractFollowUpTickets, and canAutoMergeTask enforce brain search, follow-up extraction, and auto-low merge rules

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (3) | Door 1 (Control Panel API & `deployments` table) C1, C6 · Door 2 (Workflow-as-Code persistence) C4 · Door 3 (Brain & Agent Catalog layout) C1, C7 | - |
| `GET /api/dashboard` statuses (1) | `200` C1 | - |
| `POST /api/tasks/:key/approve` statuses (2) | `200` C2 · `404` C2 | - |
| `POST /api/alerts/production` statuses (3) | `200` C3 · `400` C3 · `404` C3 | - |
| `POST /api/workflows/:id` statuses (3) | `200` C4 · `400` C4 · `422` C4 | - |
| `POST /api/controls` statuses (2) | `200` C5 · `400` C5 | - |
| `POST /api/deploy/verify` statuses (2) | `200` C6 · `400` C6 | - |
| Specialist agent catalog (7) | `triager` C1 · `planner` C1 · `builder` C1 · `verifier` C1 · `judge` C1 · `investigator` C1 · `ops` C1 | - |
| Auto-low merge rule, AC 7 (2 examples) | `impact: "low"` + `APPROVE` + matching SHA C7 · `impact: "high"` C7 | - |
| Stored entities (3) | `TASK` C1, C2, C3 · `TELEMETRY_EVENT` C2, C3, C6 · `DEPLOYMENT` C1, C6 | - |

## Swept

- validation: C3, C4, C5, C6
- failure modes: C2, C3, C4, C6
- idempotency: C2, C5
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C4, C6
- data lifecycle: C4, C5, C6
- dependency failure: C6
- state transitions: C2, C3, C6, C7
- observability: C1, C2, C3, C6

## Handoff

- **Settled mid-build:** none
- **Dispatched:** none
- **Boundary:** none yet
- **Abandoned:** none
