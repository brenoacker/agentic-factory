# Unified Kanban Board Columns checks

Build: `node scripts/build-panel.mjs; node --check apps/panel/server.mjs; node --check packages/core/src/config.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/unified-kanban-board-columns/plan.md`

1 check in 1 slice · 1 one-way door · 0 open, of which 0 block

## Checks

### S1 - Unified 3-Column Kanban Board

**C1** - Playwright E2E tests verify that the Control Panel renders exactly 3 unified columns (`Triage`, `In Progress`, `Done`), distributes task cards according to stage mappings, displays granular stage badges on each card, and reflects stage transitions with visual captures (AC 1, AC 2, AC 3, AC 4, AC 5, AC 6, AC 7)
Proof: run e2e | C1: Kanban board renders 3 unified columns (Triage, In Progress, Done) with accurate stage grouping and badges

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (1) | Door 1 (Unified 3-Column Kanban Board) C1 | - |
| Routes (1) | `GET /` C1 | - |

## Swept

- validation: C1
- failure modes: C1
- idempotency: C1
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C1
- data lifecycle: C1
- dependency failure: C1
- state transitions: C1
- observability: C1

## Handoff

- **Settled mid-build:** none
- **Dispatched:** pending
- **Boundary:** pending
- **Abandoned:** none
- **Walked:** pending
