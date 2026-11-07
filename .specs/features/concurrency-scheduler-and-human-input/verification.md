# Concurrency scheduler and human input verification

**Verdict**: PASS
**Proofs**: `proofs.md` at 4e70751
**Verifier**: independent sub-agent (author != verifier)

## Checks

| Check | Test | Holds |
| --- | --- | --- |
| C1 | `control-panel.test.mjs` `C14: Executing agent concurrency excludes merge and needs_human tasks, preserves workspace, and filters queued triage from stall alarms` | yes |
| C2 | `control-panel.test.mjs` `C15: Periodic scheduler auto-dispatches queued triage tasks up to executing concurrency ceiling` | yes |
| C3 | `panel.spec.mjs` `C16: Playwright E2E test verifies interactive human clarification screen, reply submission, and cron auto-dispatch` | yes |

## Findings

| Finding | Evidence | Fix | Closed |
| --- | --- | --- | --- |
| C2's test asserts `typeof === 'number'` instead of proving tasks are auto-dispatched | In `control-panel.test.mjs:1012`, `assert.equal(typeof schedJson.autoDispatchedCount, 'number')` passes when `autoDispatchedCount` is 0; neither C15 nor C16 asserts that eligible tasks in triage are auto-dispatched to stage merge/done (AC 6, AC 8) | In C15, assert `schedJson.autoDispatchedCount === 1` (or expected positive count) and assert that the dispatched task advanced out of `triage` | 4e70751 |
| Backlog tasks in `triage` are counted in `countExecutingAgents()`, deadlocking auto-dispatch and blocking intake | `store.countExecutingAgents()` excludes `merge`, but not `triage`. When 3 tasks are queued in `triage`, `countExecutingAgents()` returns 3, causing `autoDispatchQueuedTasks` to calculate `availableSlots = 0` (0 tasks dispatched) and `evaluateIntakeGuards` to reject intake of new tasks with `max_concurrency_reached` | Exclude `stage != 'triage'` from `countExecutingAgents()` (e.g. `stage != 'done' AND stage != 'aborted' AND stage != 'merge' AND stage != 'triage' AND needs_human = 0`) so queued backlog tasks do not occupy execution slots before being dispatched | 4e70751 |
