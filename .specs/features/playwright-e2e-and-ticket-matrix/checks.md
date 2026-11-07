# English Localization, Multi-Repo Issue Monitoring, 5-Type Ticket Pipeline, and Playwright Suite checks

Build: `node --check apps/panel/server.mjs; node --check packages/core/cli.mjs`
Run unit: `node --test packages/core/__test__/pipeline.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/playwright-e2e-and-ticket-matrix/plan.md`

8 checks in 1 slice · 3 one-way doors · 0 open, of which 0 block

## Checks

### S1 - English Localization, Multi-Repo Issue Monitoring, 5-Type Ticket Pipeline, and Playwright Suite

**C1** - `classifyTicketType` and `POST /api/tickets/intake` classify diverse tickets into `feature`, `bug`, `investigation`, `discovery`, and `chore` with `201` and `initialStage: "triage"`, return `400` on missing `issue_number` or `title`, and return `409` on duplicate active ticket (AC 2)
Proof: run unit | ✔ C1: classifyTicketType and POST /api/tickets/intake classify all 5 ticket types with 201, return 400 on missing fields, and 409 on duplicate

**C2** - `POST /api/tickets/:key/dispatch` drives all 5 ticket types (`feature`, `bug`, `investigation`, `discovery`, `chore`) through their exact workflow stages in order, pauses at human gates until approved, extracts follow-up tickets on `investigation`, reaches `stage: "done"`, and returns `404` for unknown task key (AC 3)
Proof: run unit | ✔ C2: POST /api/tickets/:key/dispatch executes full stage lifecycles for feature, bug, investigation, discovery, and chore to done and returns 404 for unknown key

**C7** - `GET /api/projects`, `POST /api/projects`, `DELETE /api/projects/:repo`, and `POST /api/projects/sync` add external GitHub repositories (`201`), update existing (`200`), reject invalid `owner/repo` (`400`), delete (`200` / `404`), and poll issues across multiple unpaused repositories with per-repo `ETag` caching (AC 4)
Proof: run unit | ✔ C7: multi-repo endpoints GET/POST/DELETE /api/projects and POST /api/projects/sync manage external repos and sync issues with per-repo ETag caching

**C3** - The Control Panel UI (`GET /`) renders in Chromium with `lang="en"`, English navigation tabs, headings, KPI cards, tables, and buttons across all 6 tabs, and contains zero Portuguese UI strings (AC 1, AC 5)
Proof: run e2e | ok 1 [chromium] › C3: Control Panel renders 100% in English across all 6 tabs with zero Portuguese strings

**C4** - Playwright visual & component tests verify the KPI telemetry cards, Runtime & Model usage tables, Circuit Breaker reset button, 7 Specialist Agents catalog, 23 Locked Skills table, and Brain memory cards, and save visual screenshots (AC 1, AC 5)
Proof: run e2e | ok 2 [chromium] › C4: Playwright visual and component tests verify KPIs, Runtimes, Circuit Breaker, 7 Agents, 23 Skills, and Brain

**C5** - Playwright integration tests verify workflow-as-code validation (`422` on unlocked skill, `200` on valid workflow save), operational controls update (`killSwitch`, `dailyBudgetUsd`, `autonomy`), and post-deploy verification with automatic rollback to `last_good_sha` in the browser (AC 5)
Proof: run e2e | ok 3 [chromium] › C5: Playwright integration tests verify Workflow editor, Operational Controls, and Post-Deploy Rollback

**C6** - Playwright E2E multi-ticket workflow test intakes 5 diverse tickets (`feature`, `bug`, `investigation`, `discovery`, `chore`) through the Panel UI, verifies each ticket is identified and placed on the Kanban board, advances stages and approves human gates in 1 click, and drives all 5 tickets to `done` (AC 2, AC 3, AC 5)
Proof: run e2e | ok 4 [chromium] › C6: Playwright E2E test triages, advances, approves human gates, and completes all 5 ticket types in the browser

**C8** - Playwright E2E multi-repository test adds an external GitHub repository (`brenoacker/external-webapp`) in the Control Panel UI, syncs its open issues onto the Kanban board, and verifies the external repository's ticket is classified and executed (AC 4, AC 5)
Proof: run e2e | ok 5 [chromium] › C8: Playwright E2E test configures an external GitHub repository in the UI and syncs its issues onto the board

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (3) | Door 1 (Multi-repository registry & per-repo ETag store) C7, C8 · Door 2 (Multi-ticket classification & stage pipeline API) C1, C2, C6 · Door 3 (Playwright visual/component/E2E harness + MCP config) C3, C4, C5, C6, C8 | - |
| `GET /api/projects` statuses (1) | `200` C7 | - |
| `POST /api/projects` statuses (3) | `200` C7 · `201` C7, C8 · `400` C7 | - |
| `DELETE /api/projects/:repo` statuses (2) | `200` C7 · `404` C7 | - |
| `POST /api/projects/sync` statuses (1) | `200` C7, C8 | - |
| `POST /api/tickets/intake` statuses (3) | `201` C1 · `400` C1 · `409` C1 | - |
| `POST /api/tickets/:key/dispatch` statuses (2) | `200` C2 · `404` C2 | - |
| Ticket types classified & executed end-to-end (5) | `feature` C1, C2, C6 · `bug` C1, C2, C6 · `investigation` C1, C2, C6 · `discovery` C1, C2, C6 · `chore` C1, C2, C6 | - |
| Control Panel navigation tabs in English (6) | `Overview & Telemetry` C3 · `Board & Needs Human` C3 · `Workflows (Factory as Code)` C3 · `Runtimes, Router & Circuit Breaker` C3 · `Agents & Locked Skills (23)` C3 · `Controls, Deploy & Brain` C3 | - |
| Stored entities (5) | `REPO_ETAG` C7, C8 · `TASK` C1, C2, C6, C7, C8 · `TELEMETRY_EVENT` C2, C5 · `DEPLOYMENT` C5 · `RUNTIME_HEALTH` C4, C5 | - |

## Swept

- validation: C1, C5, C7
- failure modes: C1, C2, C5, C7
- idempotency: C1, C2, C7
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C1, C2, C7
- data lifecycle: C2, C5, C6, C7
- dependency failure: C5, C7
- state transitions: C1, C2, C6, C8
- observability: C2, C4, C5, C6

## Handoff

- **Settled mid-build:** user requested configuring and monitoring external GitHub repositories via UI/config so the factory is a standalone tool decoupled from its own repository
- **Dispatched:** none
- **Boundary:** none yet
- **Abandoned:** none
- **Walked:** pending browser E2E run
