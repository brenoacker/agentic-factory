# Interactive Human Guidance Dialog and Resume checks

Build: `node scripts/build-panel.mjs; node --check apps/panel/server.mjs; node --check packages/core/src/dispatcher.mjs`
Run unit: `node --test apps/panel/__test__/control-panel.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/human-guidance-dialog-and-resume/plan.md`

2 checks in 1 slice · 1 one-way door · 0 open, of which 0 block

## Checks

### S1 - Interactive Human Guidance Dialog

**C1** - Server endpoint `POST /api/tasks/:key/approve` accepts operator guidance in `{ answer }`, stores it in `tasks.human_guidance`, records `human_guidance_provided` in `telemetry_events`, and enriches the agent prompt upon pipeline resumption (AC 4, AC 5, AC 6)
Proof: run unit | C15: POST /api/tasks/:key/approve accepts operator guidance and injects answer into resumed agent prompt

**C2** - Playwright E2E test verifies that blocked tasks display "Answer & Guide", clicking opens the Cloudscape guidance modal with the agent's question, typing guidance and submitting resumes the task (AC 1, AC 2, AC 3, AC 7)
Proof: run e2e | C15: Playwright E2E test verifies interactive human guidance modal and agent resumption

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (1) | Door 1 (Interactive Guidance Modal and Prompt Injection) C1 · C2 | - |
| Routes (2) | `POST /api/tasks/:key/approve` C1 · `GET /` C2 | - |

## Swept

- validation: C1
- failure modes: C1
- idempotency: C1
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C1
- data lifecycle: C1
- dependency failure: C1
- state transitions: C2
- observability: C1

## Handoff

- **Settled mid-build:** none
- **Dispatched:** pending
- **Boundary:** pending
- **Abandoned:** none
- **Walked:** pending
