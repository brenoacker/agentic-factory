# Live Operations Reorganization and Tracker Links checks

Build: `node scripts/build-panel.mjs; node --check apps/panel/server.mjs; node --check packages/core/src/store.mjs; node --check packages/core/src/projects.mjs; node --check packages/core/src/pipeline.mjs; node --check packages/core/src/dispatcher.mjs`
Run unit: `node --test apps/panel/__test__/control-panel.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/live-operations-reorg-and-tracker-links/plan.md`

2 checks in 3 slices · 3 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Clickable External Tracker Links and Canonical URLs

**C1** - Factory store persists `ticket_url`, `provider`, and mutated `type` from triage contract into SQLite, routes workflow according to classified type, scheduler starts enabled by default (`enabled: true`), and resolves canonical URLs for GitHub (`https://github.com/...`) and Linear (`https://linear.app/...`) (AC 3, AC 4, AC 5, AC 6, AC 7)
Proof: run unit | ✔ C16: Factory store persists ticket_url, provider, and triage contract type mutation, and auto-enables scheduler

### S2 - Reorganized 3-View Operator Control Panel

**C2** - Playwright E2E test verifies 3 primary operator views (Control Tower `#btn-view-operations`, Board & Timeline `#btn-view-board`, Health & Integrations `#btn-view-health`), confirms clickable hyperlinks on Kanban cards (`#kanban-ticket-link-*`) and Waiting Human screen (`#human-ticket-link-*`) with `target="_blank"`, and validates real-time execution slots and triage backlog (AC 1, AC 2, AC 8, AC 9, AC 10, AC 11)
Proof: run e2e | ok 14 [chromium] › apps\panel\e2e\panel.spec.mjs:972:1 › C17: Playwright E2E test verifies 3-view navigation, clickable tracker hyperlinks, and live execution slots

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (3) | Door 1 (Canonical External Tracker Hyperlinks) C1, C2 · Door 2 (Default-On Periodic Scheduler) C1, C2 · Door 3 (Triage Contract Type Mutation) C1, C2 | - |
| `GET /api/dashboard` statuses (1) | `200` C1, C2 | - |
| `POST /api/scheduler` statuses (2) | `200` C1, C2 · `400` C1 | - |
| `POST /api/tasks/:key/approve` statuses (3) | `200` C1, C2 · `400` C1 · `404` C1 | - |
| `POST /api/tickets/:key/dispatch` statuses (3) | `200` C1, C2 · `404` C1 · `422` C1 | - |
| Stored entities (4) | `FACTORY_CONFIG` C1, C2 · `SCHEDULER` C1, C2 · `TASK` C1, C2 · `TRACKER_LINK` C1, C2 · `WORKFLOW_TYPE` C1, C2 | - |

## Swept

- validation: C1, C2
- failure modes: C1, C2
- idempotency: C1, C2
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C1, C2
- data lifecycle: C1, C2
- dependency failure: C1, C2
- state transitions: C1, C2
- observability: C1, C2

## Handoff

- **Settled mid-build:** none
- **Dispatched:** Independent Feature Verifier at 6a8def2
- **Boundary:** pending
- **Abandoned:** none
- **Walked:** pending
