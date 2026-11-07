# Pull Request Merge Verification and Real Deliverables verification

**Verdict**: PASS
**Proofs**: `proofs.md` at 5b823a0
**Verifier**: independent sub-agent (author != verifier)

## Checks

| Check | Test | Holds |
| --- | --- | --- |
| C1 | `apps/panel/__test__/control-panel.test.mjs` › `C18: Live GitHub PR verification and premature done transition rejection` | yes |
| C2 | `apps/panel/__test__/control-panel.test.mjs` › `C19: Cron scheduler syncMergedPullRequests auto-completes tasks upon PR merge` | yes |
| C3 | `apps/panel/e2e/panel.spec.mjs:1189` › `C20: Playwright E2E verifies PR merge status and check button` | yes |

## Findings

None - All criteria (AC 1 through AC 8), landing doors, and surface routes verified:
- **Door 1 (Live GitHub PR Status Verification)**: `checkGitHubPullRequest({ repo, prNumberOrUrl })` executes `gh pr view --json number,title,state,mergedAt,url,headRefName` and returns `{ ok: true, state: 'OPEN'|'MERGED', merged: boolean }`.
- **Door 2 (Cron-Driven Merge Polling & Closing)**: `syncMergedPullRequests({ rootDir, store })` polls active tasks in stage `merge` during periodic cron cycles (`createPollingScheduler`), automatically advancing verified merged PRs to `done`, commenting with PR confirmation, and closing GitHub issues as completed.
- **Door 3 (Prohibition of Synthetic Deliverable Fabrication)**: Synthetic fake PR URLs (`pull/${existing.issue_number + 100}`) and dummy SHA generation have been eliminated from `packages/core/src/pipeline.mjs`. Code workflows strictly require genuine PR deliverables.
- **Stage Merge Completion Gate**: Premature manual approval via `POST /api/tasks/:key/approve` or `advanceTicketInPanel({ approveCurrentStage: true })` while PR remains open is rejected with HTTP 409 (`pr_not_merged`).
- **Control Panel Cloudscape UI**: Displays `#pr-status-box-{issueNumber}` ("Awaiting GitHub Merge") and provides the interactive `#check-pr-btn-{issueNumber}` ("Check PR Merge Status & Sync") to verify live GitHub state and transition to `done` on demand.
