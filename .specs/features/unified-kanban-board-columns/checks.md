# Unified Kanban Board Columns checks

Build: `node scripts/build-panel.mjs; node --check apps/panel/server.mjs`
Run unit: `node --test apps/panel/__test__/control-panel.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/unified-kanban-board-columns/plan.md`

3 checks in 2 slices · 3 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Unified 4-Column Board Layout & Task Retention

**C1** - Kanban board in `#kanban-board` consolidates into 4 operational columns (`triage`, `in_progress`, `waiting_human`, `done`) and accounts for 100% of tasks in factory store with zero task loss (AC 1, AC 2, AC 3, AC 6)
Proof: run unit | C29: Unified 4-column Kanban board preserves 100% of tasks across triage, in_progress, waiting_human, and done

### S2 - Categorization Rules & Fine-Grained Stage Badges

**C2** - Tasks are categorized correctly into `in_progress` (autonomous `checks_and_build`, `plan`, `verify`, etc. without human block) and `waiting_human` (`needs_human === 1` or `merge`), and each card renders an explicit technical stage badge (`data-testid="task-stage-badge-${issueNumber}"`) (AC 4, AC 5, AC 7, AC 8)
Proof: run unit | C30: In-progress and waiting-human tasks display distinct granular stage badges in unified columns

### S3 - End-to-End Visual Verification

**C3** - Playwright E2E verifies that `#kanban-board` displays 4 column headers and task cards render their stage badges correctly (AC 1, AC 7)
Proof: run e2e | C31: Playwright E2E verifies 4-column unified Kanban board and stage badge display

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (3) | Door 1 (4 Operational Kanban Columns) C1 · Door 2 (Zero Task Loss Guarantee) C1, C2 · Door 3 (Prominent Technical Stage Badging) C2, C3 | - |
| Operational columns (4) | `📥 Triage` C1, C3 · `⚡ In Progress` C1, C2, C3 · `🙋 Waiting for Human` C1, C2, C3 · `✅ Done` C1, C3 | - |
| Technical stages mapped (8) | `triage` C1 · `plan` C2 · `checks_and_build` C2 · `verify` C2 · `review` C2 · `investigate` C1, C2 · `merge` C2 · `done` C1 | - |
| Stored entities (1) | `TASK` C1, C2, C3 | - |

## Swept

- validation: C1, C2
- failure modes: C1, C2
- idempotency: C1, C2, C3
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C1, C2
- data lifecycle: C1, C2
- dependency failure: C1, C2
- state transitions: C1, C2
- observability: C1, C2, C3

## Handoff

- **Settled mid-build:** none
- **Dispatched:** Independent Feature Verifier
- **Boundary:** pending
- **Abandoned:** none
- **Walked:** pending
