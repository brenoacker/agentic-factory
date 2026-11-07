# linear-integration-and-tracker-lifecycle verification

**Verdict**: PASS
**Proofs**: `proofs.md` at 16ca24a
**Verifier**: independent sub-agent (author != verifier)

## Checks

| Check | Test | Holds |
| --- | --- | --- |
| C1 | `control-panel.test.mjs` `C8: Linear tracker poller queries GraphQL API, applies combinable pickup triggers, and handles missing API key` | yes |
| C2 | `control-panel.test.mjs` `C9: Tracker lifecycle updates status to in-progress, posts pickup comment, and closes with completion proof` | yes |
| C3 | `panel.spec.mjs` `C13: Playwright E2E test configures Linear tracker in Cloudscape UI, syncs issues, and verifies automated lifecycle feedback and close` | yes |

## Findings

| Finding | Evidence | Fix | Closed |
| --- | --- | --- | --- |
| Linear ticket lifecycle feedback routes to GitHub comment/close instead of Linear | `packages/core/src/pipeline.mjs:331` and `intakeAndTriageTicket:242` use `if (trackerRunner or ...)` and evaluate `existing` without looking up project provider from `factoryConfig.factory.projects`. In throwaway node test, a Linear ticket returned `trackerFeedback: { closed: true, tracker: 'github' }` and never called `updateLinearIssueStatus`. | In `packages/core/src/pipeline.mjs`, resolve project provider from `issue.provider` or `factoryConfig.factory.projects.find(p => p.repo === existing.repo)?.provider`; call `updateLinearIssueStatus` when provider is `linear` even when `trackerRunner` is passed; add unit test asserting Linear lifecycle feedback. | 16ca24a |
| C3 E2E test does not verify Linear completion feedback | `apps/panel/e2e/panel.spec.mjs:724` asserts `task-stage-901` is `'done'`, but does not verify that Linear issue was updated/closed via tracker mock runner. | Assert that mock tracker runner receives `action: 'linear_update'` with `stateName: 'Done'` or assert the dispatch response `trackerFeedback.tracker === 'linear'`. | 16ca24a |
