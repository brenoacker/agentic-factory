# English Localization, Multi-Ticket Triage Pipeline, and Playwright Visual/Component/E2E Suite checks

Build: `node --check apps/panel/server.mjs; node --check packages/core/cli.mjs`
Run unit: `node --test packages/core/__test__/pipeline.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/playwright-e2e-and-ticket-matrix/plan.md`

6 checks in 1 slice · 2 one-way doors · 0 open, of which 0 block

## Checks

### S1 - English Localization, Multi-Ticket Pipeline, and Playwright Suite

**C1** - `classifyTicketType` and `POST /api/tickets/intake` classify diverse tickets into `feature`, `bug`, `investigation`, `discovery`, and `chore` with `201` and `initialStage: "triage"`, return `400` on missing `issue_number` or `title`, and return `409` on duplicate active ticket (AC 2)
Proof: run unit | ✔ C1: classifyTicketType and POST /api/tickets/intake classify all 5 ticket types with 201, return 400 on missing fields, and 409 on duplicate

**C2** - `POST /api/tickets/:key/dispatch` drives all 5 ticket types (`feature`, `bug`, `investigation`, `discovery`, `chore`) through their exact workflow stages in order, pauses at human gates until approved, extracts follow-up tickets on `investigation`, reaches `stage: "done"`, and returns `404` for unknown task key (AC 3)
Proof: run unit | ✔ C2: POST /api/tickets/:key/dispatch executes full stage lifecycles for feature, bug, investigation, discovery, and chore to done and returns 404 for unknown key

**C3** - The Control Panel UI (`GET /`) renders in Chromium with `lang="en"`, English navigation tabs, headings, KPI cards, tables, and buttons across all 6 tabs, and contains zero Portuguese UI strings (AC 1, AC 4)
Proof: run e2e | ok 1 [chromium] › C3: Control Panel renders 100% in English across all 6 tabs with zero Portuguese strings

**C4** - Playwright visual & component tests verify the KPI telemetry cards, Runtime & Model usage tables, Circuit Breaker reset button, 7 Specialist Agents catalog, 23 Locked Skills table, and Brain memory cards, and save visual screenshots (AC 1, AC 4)
Proof: run e2e | ok 2 [chromium] › C4: Playwright visual and component tests verify KPIs, Runtimes, Circuit Breaker, 7 Agents, 23 Skills, and Brain

**C5** - Playwright integration tests verify workflow-as-code validation (`422` on unlocked skill, `200` on valid workflow save), operational controls update (`killSwitch`, `dailyBudgetUsd`, `autonomy`), and post-deploy verification with automatic rollback to `last_good_sha` in the browser (AC 4)
Proof: run e2e | ok 3 [chromium] › C5: Playwright integration tests verify Workflow editor, Operational Controls, and Post-Deploy Rollback

**C6** - Playwright E2E multi-ticket workflow test intakes 5 diverse tickets (`feature`, `bug`, `investigation`, `discovery`, `chore`) through the Panel UI, verifies each ticket is identified and placed on the Kanban board, advances stages and approves human gates in 1 click, and drives all 5 tickets to `done` (AC 2, AC 3, AC 4)
Proof: run e2e | ok 4 [chromium] › C6: Playwright E2E test triages, advances, approves human gates, and completes all 5 ticket types in the browser

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (2) | Door 1 (Multi-ticket classification & stage pipeline API) C1, C2, C6 · Door 2 (Playwright visual/component/E2E harness + MCP config) C3, C4, C5, C6 | - |
| `POST /api/tickets/intake` statuses (3) | `201` C1 · `400` C1 · `409` C1 | - |
| `POST /api/tickets/:key/dispatch` statuses (2) | `200` C2 · `404` C2 | - |
| Ticket types classified & executed end-to-end (5) | `feature` C1, C2, C6 · `bug` C1, C2, C6 · `investigation` C1, C2, C6 · `discovery` C1, C2, C6 · `chore` C1, C2, C6 | - |
| Control Panel navigation tabs in English (6) | `Overview & Telemetry` C3 · `Board & Needs Human` C3 · `Workflows (Factory as Code)` C3 · `Runtimes, Router & Circuit Breaker` C3 · `Agents & Locked Skills (23)` C3 · `Controls, Deploy & Brain` C3 | - |
| Stored entities (4) | `TASK` C1, C2, C6 · `TELEMETRY_EVENT` C2, C5 · `DEPLOYMENT` C5 · `RUNTIME_HEALTH` C4, C5 | - |

## Swept

- validation: C1, C5
- failure modes: C1, C2, C5
- idempotency: C1, C2
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C1, C2
- data lifecycle: C2, C5, C6
- dependency failure: C5
- state transitions: C1, C2, C6
- observability: C2, C4, C5, C6

## Handoff

- **Settled mid-build:** none
- **Dispatched:** S1 -> 68248d4
- **Boundary:** S1 complete at 68248d4
- **Abandoned:** none
- **Walked:** Chromium Playwright walked all 6 English tabs, intaked 5 ticket types (#301-#305), approved human gates in 1 click, and completed all 5 to done (screenshots saved in captures/)
