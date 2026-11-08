# Tracker Lifecycle Sync and Autonomous Pipeline checks

Build: `node scripts/build-panel.mjs; node --check apps/panel/server.mjs; node --check packages/core/src/trackers.mjs; node --check packages/core/src/pipeline.mjs`
Run unit: `node --test apps/panel/__test__/control-panel.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/tracker-lifecycle-sync-and-autonomous-pipeline/plan.md`

3 checks in 3 slices · 3 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Autonomous Plan Execution for Well-Described Tasks

**C1** - Task with well-described plan (`needs_human: false`) advances autonomously to `checks_and_build`, while ambiguous plan (`needs_human: true`) pauses for human input (AC 1, AC 2, AC 3)
Proof: run unit | C26: Autonomous plan progression for well-described tasks and conditional human gating

### S2 - Deduplicated Tracker Lifecycle Sync & PR Notification

**C2** - `syncTaskStateToTracker` posts stage updates, attaches PR link to source ticket, updates status to `In Review` in stage `merge`, and suppresses duplicate comments on repeated calls (AC 4, AC 5, AC 6, AC 7)
Proof: run unit | C27: Deduplicated tracker lifecycle updates and PR notifications across GitHub and Linear

### S3 - Automatic Completion for Research and Post-Merge Tasks

**C3** - Research workflows close upon document delivery, while code workflows remain open in review and only close after verified PR merge (AC 8, AC 9, AC 10)
Proof: run e2e | C26: Playwright E2E verifies tracker status badges and PR notification in Kanban and Waiting Human

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (3) | Door 1 (Autonomous Plan Advancement) C1 · Door 2 (Deduplicated Tracker Lifecycle Syncing) C2 · Door 3 (Genuine PR Verification & No Premature Closing) C3 | - |
| `POST /api/tickets/:key/dispatch` statuses (3) | `200` C1, C2, C3 · `404` C1 · `422` C1, C3 | - |
| `POST /api/tasks/:key/check-pr` statuses (2) | `200` C2, C3 · `404` C3 | - |
| `POST /api/projects/sync` statuses (2) | `200` C2, C3 · `500` C2 | - |
| Stored entities (3) | `TASK` C1, C2, C3 · `TRACKER_SYNC_EVENT` C2 · `PULL_REQUEST` C2, C3 | - |

## Swept

- validation: C1, C2, C3
- failure modes: C1, C2, C3
- idempotency: C1, C2, C3
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C1, C2, C3
- data lifecycle: C1, C2, C3
- dependency failure: C1, C2, C3
- state transitions: C1, C2, C3
- observability: C1, C2, C3

## Handoff

- **Settled mid-build:** none
- **Dispatched:** Independent Feature Verifier at fac46df
- **Boundary:** pending
- **Abandoned:** none
- **Walked:** pending
