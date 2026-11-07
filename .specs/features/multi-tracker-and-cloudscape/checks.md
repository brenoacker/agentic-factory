# Multi-Provider Issue Trackers (GitHub, Jira, Asana), Polling Scheduler, and AWS Cloudscape UI checks

Build: `node scripts/build-panel.mjs; node --check packages/core/src/trackers.mjs; node --check packages/core/src/projects.mjs; node --check apps/panel/server.mjs`
Run unit: `node --test packages/core/__test__/pipeline.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/multi-tracker-and-cloudscape/plan.md`

3 checks in 1 slice · 2 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Multi-Provider Trackers (GitHub, Jira, Asana), Polling Scheduler, and AWS Cloudscape Frontend

**C1** - `POST /api/projects` and `POST /api/projects/sync` configure and poll sources across `provider: "github"`, `provider: "jira"` (with custom `projectKey`, `statusFilter`, or `jql`), and `provider: "asana"` (with custom `projectGid` and `statusFilter` / `sectionFilter`), normalizing matching Jira keys (`FAC-701` -> `issue_number: 701`) and Asana task GIDs into classified factory tasks, skipping non-matching statuses, and returning `400` on unsupported provider or missing provider keys (AC 1)
Proof: run unit | ✔ C10: Multi-provider tracker adapter configures and polls GitHub, Jira, and Asana projects with status filtering and returns 400 on invalid provider config

**C2** - `POST /api/scheduler` updates the periodic polling scheduler (`enabled`, `intervalSeconds`, `runImmediately`), returns `200` with active scheduler state (`enabled`, `intervalSeconds`, `pollCount`, `lastPollAt`), executes an immediate multi-provider sync when `runImmediately: true`, and returns `400` when `intervalSeconds < 5` (AC 2)
Proof: run unit | ✔ C11: POST /api/scheduler configures periodic polling loop, executes immediate multi-provider sync, and returns 400 on invalid intervalSeconds

**C3** - Playwright E2E test suite verifies that the Control Panel renders authentic AWS Cloudscape Design System components (`awsui_*` classes, `TopNavigation`, `Alert`, `Tabs`, `Cards`, `Table`, `Container`, `Header`, `Button`, `Badge`, `StatusIndicator`), configures and syncs GitHub, Jira, and Asana trackers and the periodic scheduler in Chromium, and passes all existing E2E checks (`C3`–`C9`) plus `C10` with zero regressions (AC 3)
Proof: run e2e | ok 7 [chromium] › C10: Playwright E2E test verifies AWS Cloudscape Design System components and configures Jira and Asana trackers in the UI

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (2) | Door 1 (Multi-provider tracker adapter & scheduler) C1, C2, C3 · Door 2 (AWS Cloudscape Design System React bundle) C3 | - |
| `POST /api/projects` statuses (3) | `200` C1, C3 · `201` C1, C3 · `400` C1 | - |
| `POST /api/projects/sync` statuses (1) | `200` C1, C2, C3 | - |
| `POST /api/scheduler` statuses (2) | `200` C2, C3 · `400` C2 | - |
| Multi-provider intake & validation, AC 1 (3 examples) | `jira` (`projectKey: "FAC"`, `statusFilter: "Ready for Agent"`) C1, C3 · `asana` (`projectGid: "120055"`, `statusFilter: "Ready for Agent"`) C1, C3 · invalid `provider: "trello"` (`400`) C1 | - |
| Scheduler configuration, AC 2 (2 examples) | `{ enabled: true, intervalSeconds: 60, runImmediately: true }` (`200`) C2, C3 · `{ intervalSeconds: 1 }` (`400`) C2 | - |
| Stored entities (3) | `REPO_ETAG` C1, C2, C3 · `TASK` C1, C2, C3 · `TELEMETRY_EVENT` C1, C2, C3 | - |

## Swept

- validation: C1, C2, C3
- failure modes: C1, C2
- idempotency: C1, C2
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C1, C2
- data lifecycle: C1, C2, C3
- dependency failure: C1
- state transitions: C1, C3
- observability: C1, C2, C3

## Handoff

- **Settled mid-build:** none
- **Dispatched:** S1 -> 5bffce9
- **Boundary:** S1 complete at 5bffce9
- **Abandoned:** none
- **Walked:** Chromium Playwright verified AWS Cloudscape Design System components (`awsui_*`), Jira & Asana tracker configuration, periodic cron scheduler (`POST /api/scheduler`), and all 6 tabs with zero regressions (screenshots saved in runs/screenshots/cloudscape-overview.png and runs/screenshots/cloudscape-multi-tracker-board.png)
