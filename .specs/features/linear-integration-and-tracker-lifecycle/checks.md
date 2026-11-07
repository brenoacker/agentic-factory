# Linear Integration, Automatic Ticket Lifecycle Feedback, and Closed Status Tracking checks

Build: `node scripts/build-panel.mjs; node --check apps/panel/server.mjs; node --check packages/core/src/trackers.mjs`
Run unit: `node --test apps/panel/__test__/control-panel.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/linear-integration-and-tracker-lifecycle/plan.md`

3 checks in 1 slice · 2 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Linear Integration and Tracker Lifecycle Feedback

**C1** - `pollLinearProject` queries Linear GraphQL API, applies combinable pickup triggers (`statuses`, `requiredLabels`, `excludedLabels`, `assigneeFilter`), skips non-matching issues, and returns a structured error when `LINEAR_API_KEY` is missing without logging secret values (AC 3, AC 5)
Proof: run unit | ✔ C8: Linear tracker poller queries GraphQL API, applies combinable pickup triggers, and handles missing API key

**C2** - Tracker lifecycle feedback automatically updates issue status to `stage:<currentStage>`, assigns operator/agent, posts pickup comment on intake, and on workflow completion (`done`), posts completion comment with commit reference and closes the issue (`state: closed` / `Done`) (AC 1, AC 2)
Proof: run unit | ✔ C9: Tracker lifecycle updates status to in-progress, posts pickup comment, and closes with completion proof

**C3** - Playwright E2E test configures Linear tracker (`brenoack/agentic-factory-80f4e9bb2ce1`) with custom pickup triggers in the AWS Cloudscape Control Panel UI, synchronizes issues from Linear, verifies Linear badge and card on Kanban board, advances ticket through stages, and verifies completion lifecycle feedback (AC 1, AC 2, AC 3, AC 4)
Proof: run e2e | ok 10 [chromium] › C13: Playwright E2E test configures Linear tracker in Cloudscape UI, syncs issues, and verifies automated lifecycle feedback and close

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (2) | Door 1 (Native Linear GraphQL Poller with Combinable Triggers) C1, C3 · Door 2 (Automated Issue Tracker Lifecycle Feedback) C2, C3 | - |
| `POST /api/projects` statuses (3) | `200` C3 · `201` C3 · `400` C1 | - |
| `POST /api/projects/sync` statuses (1) | `200` C1, C3 | - |
| `POST /api/tickets/:key/dispatch` statuses (2) | `200` C2, C3 · `404` C2 | - |
| Stored entities (3) | `PROJECT` C1, C3 · `TASK` C2, C3 · `COMMENT` C2, C3 | - |

## Swept

- validation: C1, C3
- failure modes: C1, C2
- idempotency: C1, C2, C3
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C1
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
