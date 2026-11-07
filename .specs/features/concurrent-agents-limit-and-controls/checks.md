# Max Concurrent Running Agents Limit and Control Panel Settings checks

Build: `node scripts/build-panel.mjs; node --check apps/panel/server.mjs; node --check packages/core/src/guards.mjs; node --check packages/core/src/config.mjs`
Run unit: `node --test apps/panel/__test__/control-panel.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/concurrent-agents-limit-and-controls/plan.md`

3 checks in 1 slice · 2 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Max Concurrent Running Agents Ceiling

**C1** - `POST /api/controls` validates `maxConcurrentAgents` is an integer between 1 and 10, persists valid values to `factory.yaml`, and rejects out-of-bounds or non-integer values with HTTP 400 (AC 1, AC 2, AC 3)
Proof: run unit | ✔ C12: Controls API persists maxConcurrentAgents within range 1 to 10 and rejects invalid bounds

**C2** - `evaluateIntakeGuards` evaluates active running tasks against `maxConcurrentAgents` (defaulting to 3 if omitted), permitting intake when active count is below limit and rejecting with `max_concurrency_reached` when limit is reached (AC 1, AC 4)
Proof: run unit | ✔ C13: Concurrency intake guard bounds active tasks to maxConcurrentAgents defaulting to 3 and rejecting overflow

**C3** - Playwright E2E test inspects `#ctrl-concurrent` input in Cloudscape UI, verifies default limit of 3, checks active agents KPI display, updates limit to 6 and saves controls, and asserts concurrency intake guard prevents overflow (AC 1, AC 2, AC 4, AC 5)
Proof: run e2e | ok 12 [chromium] › C15: Playwright E2E test verifies max concurrent agents input, Overview KPI, and live limit updates in Cloudscape UI

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (2) | Door 1 (Concurrency Range Ceiling (1 to 10, default 3)) C1, C3 · Door 2 (Deterministic Intake & Dispatch Concurrency Guard) C2, C3 | - |
| `POST /api/controls` statuses (2) | `200` C1, C3 · `400` C1 | - |
| `POST /api/tickets/intake` statuses (4) | `201` C2, C3 · `400` C2 · `409` C2 · `422` C2, C3 | - |
| `GET /api/dashboard` statuses (1) | `200` C3 | - |
| Stored entities (2) | `FACTORY_CONFIG` C1, C3 · `LIMITS` C1, C2, C3 · `TASK` C2, C3 | - |

## Swept

- validation: C1, C2, C3
- failure modes: C1, C2
- idempotency: C1, C2, C3
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C1, C2, C3
- data lifecycle: C1, C2, C3
- dependency failure: C1
- state transitions: C2, C3
- observability: C1, C2, C3

## Handoff

- **Settled mid-build:** none
- **Dispatched:** pending
- **Boundary:** pending
- **Abandoned:** none
- **Walked:** pending
