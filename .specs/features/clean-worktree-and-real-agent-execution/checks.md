# Clean Worktree from Latest Main and Real Agent Task Execution checks

Build: `node --check packages/core/src/worktree.mjs; node --check packages/core/src/dispatcher.mjs; node --check packages/core/src/pipeline.mjs`
Run unit: `node --test packages/core/__test__/factory-core.test.mjs packages/core/__test__/pipeline.test.mjs`
Plan: `.specs/features/clean-worktree-and-real-agent-execution/plan.md`

3 checks in 3 slices · 3 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Hermetic Worktree Provisioning from Latest Remote Main

**C1** - `provisionTaskWorkspace` executes `git fetch origin <defaultBranch>` and creates isolated temporary worktrees branched strictly from `origin/<defaultBranch>`, ensuring zero dirty commit contamination and safe concurrent directories (AC 1, AC 2)
Proof: run unit | ✔ C1: provisionTaskWorkspace fetches and branches worktree strictly from origin/main in an isolated directory

### S2 - Real Agent Execution with Enriched Context and Worktree CWD

**C2** - `dispatchTask` constructs prompts containing the full ticket title, body, acceptance criteria, sets `cwd` to `task.workspace_path`, and `advanceTicketInPanel` dispatches via the configured runtime adapter without silent mock fallback (AC 3, AC 4, AC 5)
Proof: run unit | ✔ C2: dispatchTask enriches prompt with full ticket context, sets cwd to workspace, and eliminates silent mock fallback

### S3 - Commit Validation and Multi-Type Verification

**C3** - Review stage gates Pull Request creation on verified commits ahead of `origin/<defaultBranch>`, and executes all 5 ticket workflows (`feature`, `bug`, `investigation`, `discovery`, `chore`) through to clean completion (AC 6, AC 7)
Proof: run unit | ✔ C3: review gates PR creation on commits ahead of origin/main and executes all 5 ticket workflows to completion

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (3) | Door 1 (Hermetic worktrees branched from `origin/<defaultBranch>`) C1 · Door 2 (Full ticket context injection and worktree CWD isolation) C2 · Door 3 (Explicit test mock runner vs production CLI adapter) C2, C3 | - |
| `POST /api/tickets/:key/dispatch` statuses (2) | `200` C2, C3 · `404` C2 | - |
| `POST /api/tickets/intake` statuses (3) | `201` C3 · `400` C3 · `409` C3 | - |
| Ticket workflows verified end-to-end (5) | `feature` C3 · `bug` C3 · `investigation` C3 · `discovery` C3 · `chore` C3 | - |
| Stored entities (2) | `TASK` C1, C2, C3 · `TASK_WORKSPACE` C1, C2, C3 | - |

## Swept

- validation: C1, C2, C3
- failure modes: C1, C2, C3
- idempotency: C1, C2, C3
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C1, C2, C3
- data lifecycle: C1, C2, C3
- dependency failure: C1, C2, C3
- state transitions: C2, C3
- observability: C1, C2, C3

## Handoff

- **Settled mid-build:** none
- **Dispatched:** Feature Implementation
- **Boundary:** pending
- **Abandoned:** none
- **Walked:** pending
