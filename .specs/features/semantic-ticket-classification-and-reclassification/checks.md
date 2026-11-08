# Semantic Ticket Classification and Dynamic Reclassification checks

Build: `node scripts/build-panel.mjs; node --check apps/panel/server.mjs`
Run unit: `node --test apps/panel/__test__/control-panel.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/semantic-ticket-classification-and-reclassification/plan.md`

3 checks in 3 slices · 3 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Deliverable-Oriented Weighted Classification Engine

**C1** - Deliverable-oriented weighted scoring in `classifyTicketType` classifies structural engineering specifications (`Spec:`, `## User Stories`, `## Acceptance Criteria`) as `feature`, discounts repository stopwords (e.g. `incident`, `investigator`), detects `## Steps to Reproduce` as `bug`, and maps open technical questions to `investigation` (AC 1, AC 2, AC 3, AC 4, AC 5)
Proof: run unit | C35: classifyTicketType uses deliverable-oriented weighted scoring, discounts repository stopwords, and prioritizes engineering sections

### S2 - Reclassification API Endpoint & Workflow Realignment

**C2** - `POST /api/tickets/:key/reclassify` transitions a task's workflow type to the target type, resets deliverable expectations (requiring PR for code workflows), and rejects invalid types with 400 and non-existent tasks with 404 (AC 6, AC 7, AC 8, AC 9)
Proof: run unit | C36: POST /api/tickets/:key/reclassify updates task type, resets deliverable rules, and rejects invalid types

### S3 - Interactive Control Panel Kanban Reclassification

**C3** - Playwright E2E verifies that Kanban cards render the reclassification selector (`data-testid="reclassify-select-${issueNumber}"`), changing the selection dispatches `POST /api/tickets/:key/reclassify`, and updates the visible type badge immediately in the browser (AC 10, AC 11)
Proof: run e2e | C32: Playwright E2E verifies interactive workflow reclassification from Kanban card

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (3) | Door 1 (Deliverable-Oriented Weighted Scoring) C1 · Door 2 (Dedicated Reclassification Endpoint) C2 · Door 3 (Prominent Kanban Reclassification Control) C3 | - |
| Classified workflows (5) | `feature` C1, C2, C3 · `bug` C1, C2, C3 · `chore` C1, C2, C3 · `investigation` C1, C2, C3 · `discovery` C1, C2, C3 | - |
| Surface endpoints (3) | `classifyTicketType(params)` C1 · `POST /api/tickets/:key/reclassify` C2, C3 · `reclassify-select-${issueNumber}` C3 | - |
| Stored entities (3) | `TASK` C1, C2, C3 · `WORKFLOW` C1, C2, C3 · `RECLASSIFY_EVENT` C2, C3 | - |

## Swept

- validation: C1, C2
- failure modes: C1, C2
- idempotency: C1, C2, C3
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C2, C3
- data lifecycle: C2, C3
- dependency failure: C2
- state transitions: C2, C3
- observability: C1, C2, C3

## Handoff

- **Settled mid-build:** none
- **Dispatched:** Independent Feature Verifier
- **Boundary:** pending
- **Abandoned:** none
- **Walked:** pending
