# Isolated Temp Workspaces and Deliverable Materialization checks

Build: `node scripts/build-panel.mjs; node --check packages/core/src/worktree.mjs; node --check packages/core/src/dispatcher.mjs`
Run unit: `node --test apps/panel/__test__/control-panel.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/isolated-temp-workspaces-and-deliverable-materialization/plan.md`

3 checks in 3 slices · 3 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Timestamped Isolated Workspaces & Safe Cleanup

**C1** - `provisionTaskWorkspace` creates timestamped directories under `runs/workspaces/` and `cleanupTaskWorkspace` safely removes completed workspace folders (AC 1, AC 2)
Proof: run unit | C32: provisionTaskWorkspace creates timestamped isolated directories under runs/workspaces and cleanupTaskWorkspace deletes them safely

### S2 - Physical Markdown Report Materialization

**C2** - Dispatching an investigation contract validates data, physically writes formatted Markdown to `<workspace>/docs/research/issue-<num>-investigation.md`, and contains question, summary, evidence, and recommendations (AC 3, AC 4)
Proof: run unit | C33: dispatcher physically materializes investigation and discovery markdown documents with concrete evidence and recommendations

### S3 - Lifecycle Cleanup on Completion

**C3** - When a task finishes with stage `done`, the temporary workspace folder is removed while SQLite retains the record and deliverable link (AC 5)
Proof: run unit | C34: advanceTicketInPanel cleans up temporary workspace when task reaches done

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (3) | Door 1 (Timestamped Isolated Workspaces) C1 · Door 2 (Physical Deliverable Materialization) C2 · Door 3 (Post-Completion Workspace Cleanup) C3 | - |
| Functions (3) | `provisionTaskWorkspace` C1 · `cleanupTaskWorkspace` C1, C3 · `materializeInvestigationReport` C2 | - |
| Stored entities (2) | `TASK` C1, C2, C3 · `RESEARCH_DOCUMENT` C2 | - |

## Swept

- validation: C1, C2
- failure modes: C1, C2, C3
- idempotency: C1, C2, C3
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C1, C2
- data lifecycle: C1, C2, C3
- dependency failure: C1, C2
- state transitions: C1, C2, C3
- observability: C1, C2, C3

## Handoff

- **Settled mid-build:** none
- **Dispatched:** Independent Feature Verifier
- **Boundary:** verified
- **Abandoned:** none
- **Walked:** verified (all 3 checks hold with independent proofs)
