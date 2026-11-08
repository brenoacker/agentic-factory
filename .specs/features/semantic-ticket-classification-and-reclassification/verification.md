# Semantic Ticket Classification and Dynamic Reclassification verification

**Verdict**: PASS
**Proofs**: `proofs.md` at `f92f976`
**Verifier**: independent verification

## Checks

| Check | Test | Holds |
| --- | --- | --- |
| C1 | `apps/panel/__test__/control-panel.test.mjs` › `C35: classifyTicketType uses deliverable-oriented weighted scoring, discounts repository stopwords, and prioritizes engineering sections` | yes |
| C2 | `apps/panel/__test__/control-panel.test.mjs` › `C36: POST /api/tickets/:key/reclassify updates task type, resets deliverable rules, and rejects invalid types` | yes |
| C3 | `apps/panel/e2e/panel.spec.mjs:1634` › `C32: Playwright E2E verifies interactive workflow reclassification from Kanban card` | yes |

## Findings

None - All criteria (AC 1 through AC 11), landing doors, and regression checks verified:
- **Door 1 (Deliverable-Oriented Weighted Scoring - AC 1, AC 2, AC 3, AC 4, AC 5)**: `classifyTicketType` in `packages/core/src/pipeline.mjs` uses multi-factor weighted scoring and markdown AST / structural analysis. Verified that title prefixes (`Spec:`, `[Spec]`, `Feature:`) immediately classify as `feature` (AC 1), explicit engineering sections (`## User Stories`, `## Acceptance Criteria`) score as `feature` even when keywords like "investigation" exist in project or body (AC 2), repository name tokens (`incident-investigator`) are discounted as repository stop-words preventing false-positive investigation triggers (AC 3), reproduction steps / errors / stack traces classify as `bug` (AC 4), and exploratory questions without implementation sections route to `investigation` (AC 5).
- **Door 2 (Dedicated Reclassification Endpoint & Workflow Realignment - AC 6, AC 7, AC 8, AC 9)**: `POST /api/tickets/:key/reclassify` in `apps/panel/server.mjs` updates `st.tasks` via `reclassifyTaskType`. Verified that valid types update the task type to `feature` and return 200 (AC 6), invalid workflow types return 400 (AC 7), missing execution keys return 404 (AC 8), and tasks transitioning from `investigation` to `feature` have their deliverable expectations reset so that code pull request deliverables are enforced before reaching `done` (AC 9).
- **Door 3 (Interactive Kanban Reclassification UI & Visual Proof - AC 10, AC 11)**: On the Control Panel Kanban cards (`#kanban-board`), each card renders an interactive `<Select>` (`data-testid="reclassify-select-${issueNumber}"`) (AC 10). Verified via Playwright E2E test `C32` that changing the dropdown value from `investigation` to `feature` dispatches the reclassification API call, immediately updates the visible type badge to `feature` without page reload, and persists the new type to SQLite `factory.db` (AC 11). Hermetic visual proof screenshots captured before and after transition (`reclassify-before-change.png` and `reclassify-after-change.png`) in `.specs/features/semantic-ticket-classification-and-reclassification/captures/` and `runs/screenshots/`.
