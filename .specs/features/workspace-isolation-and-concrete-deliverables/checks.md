# Workspace Isolation and Concrete Deliverables per Ticket Type checks

Build: `node scripts/build-panel.mjs; node --check apps/panel/server.mjs; node --check packages/core/src/pipeline.mjs; node --check packages/core/src/dispatcher.mjs`
Run unit: `node --test apps/panel/__test__/control-panel.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/workspace-isolation-and-concrete-deliverables/plan.md`

3 checks in 1 slice · 3 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Workspace Isolation and Concrete Deliverables

**C1** - `provisionWorkspace` allocates an isolated workspace directory, clones or checks out the target repository default branch (`main` or `master`), creates a dedicated task branch (`factory/issue-<num>`), and synchronizes locked skills (AC 1)
Proof: run unit | ✔ C10: Workspace provisioner clones or checks out isolated worktree on target default branch with task branch and locked skills

**C2** - Deliverable validation gate requires a verified Pull Request deliverable (`pr_url`, `pr_number`, `branch`, `commit_sha`) for code workflows (`feature`, `bug`, `chore`) and a structured research document (`document_path`, `title`, `content`) for analysis workflows (`investigation`, `discovery`), rejecting `done` transitions without the deliverable (AC 2, AC 3, AC 4)
Proof: run unit | ✔ C11: Deliverable validation gate enforces mandatory PR for code workflows and research document for analysis workflows before done

**C3** - Playwright E2E test dispatches a ticket in AWS Cloudscape Control Panel, verifies isolated workspace path and branch name, validates deliverable gate rejection when deliverable is absent, and displays the deliverable link (Pull Request or research document) upon completion (AC 1, AC 2, AC 3, AC 4, AC 5)
Proof: run e2e | ok 11 [chromium] › C14: Playwright E2E test verifies isolated workspace provisioning, deliverable gate enforcement, and deliverable links in Cloudscape UI

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (3) | Door 1 (Isolated Temporary Workspace per Ticket) C1, C3 · Door 2 (Mandatory Deliverable per Ticket Type) C2, C3 · Door 3 (Deterministic Deliverable Gate before Done) C2, C3 | - |
| `POST /api/tickets/:key/dispatch` statuses (4) | `200` C2, C3 · `400` C2 · `404` C2 · `422` C2, C3 | - |
| `GET /api/tickets/:key/deliverable` statuses (2) | `200` C2, C3 · `404` C2 | - |
| `GET /api/dashboard` statuses (1) | `200` C3 | - |
| Stored entities (2) | `TASK` C1, C2, C3 · `DELIVERABLE` C2, C3 · `WORKSPACE` C1, C3 | - |

## Swept

- validation: C1, C2, C3
- failure modes: C1, C2
- idempotency: C1, C2, C3
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C1
- data lifecycle: C1, C2, C3
- dependency failure: C1
- state transitions: C2, C3
- observability: C1, C2, C3

## Handoff

- **Settled mid-build:** none
- **Dispatched:** pending
- **Boundary:** pending
- **Abandoned:** none
- **Walked:** pending
