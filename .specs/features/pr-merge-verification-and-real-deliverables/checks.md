# Pull Request Merge Verification and Real Deliverables checks

Build: `node scripts/build-panel.mjs; node --check apps/panel/server.mjs; node --check packages/core/src/store.mjs; node --check packages/core/src/projects.mjs; node --check packages/core/src/pipeline.mjs; node --check packages/core/src/dispatcher.mjs; node --check packages/core/src/github.mjs`
Run unit: `node --test apps/panel/__test__/control-panel.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/pr-merge-verification-and-real-deliverables/plan.md`

3 checks in 3 slices · 3 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Live GitHub PR Verification and Deliverable Integrity

**C1** - Live GitHub PR verification inspects `state` and `mergedAt` via `gh pr view`, eliminates synthetic fake PR URL fabrication in `advanceTicketInPanel`, and rejects manual transition to `done` with HTTP 409 (`pr_not_merged`) when the Pull Request is unmerged (AC 1, AC 2, AC 3, AC 4)
Proof: run unit | ✔ C18: Live GitHub PR verification and premature done transition rejection

### S2 - Stage Merge Completion Gate

**C2** - Background scheduler runs `syncMergedPullRequests` to inspect active tasks in stage `merge`, detects merged PRs (`merged: true`), auto-advances tasks to `done`, and closes the issue on GitHub citing the merged PR URL (AC 6, AC 7)
Proof: run unit | ✔ C19: Cron scheduler syncMergedPullRequests auto-completes tasks upon PR merge

### S3 - Control Panel Live PR Status and Manual Check Button

**C3** - Playwright E2E verifies that a task in stage `merge` displays its PR URL with waiting status, provides a `#check-pr-btn-{issueNumber}` button, blocks premature approval, and synchronizes state upon click (AC 5, AC 8)
Proof: run e2e | ok 15 [chromium] › apps\panel\e2e\panel.spec.mjs:1189:1 › C20: Playwright E2E verifies PR merge status and check button

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (3) | Door 1 (Live GitHub PR Status Verification) C1, C2, C3 · Door 2 (Cron-Driven Merge Polling & Closing) C1, C2, C3 · Door 3 (Prohibition of Synthetic Deliverable Fabrication) C1, C2, C3 | - |
| `POST /api/tasks/:key/check-pr` statuses (3) | `200` C1, C3 · `404` C1 · `422` C1 | - |
| `POST /api/tasks/:key/approve` statuses (4) | `200` C1 · `400` C1 · `404` C1 · `409` C1, C3 | - |
| `POST /api/scheduler` statuses (2) | `200` C1, C2 · `400` C1 | - |
| Stored entities (4) | `DELIVERABLE` C1, C2, C3 · `GITHUB_ISSUE` C1, C2, C3 · `GITHUB_PR` C1, C2, C3 · `TASK` C1, C2, C3 | - |

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
- **Dispatched:** Independent Feature Verifier at 6a8def2
- **Boundary:** pending
- **Abandoned:** none
- **Walked:** pending
