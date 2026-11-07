# Runtime Adapters, Router, Dispatcher, and Autonomous Loop checks

Build: `node --check packages/core/cli.mjs`; `node --check packages/core/src/adapters.mjs`; `node --check packages/core/src/router.mjs`; `node --check packages/core/src/github.mjs`; `node --check packages/core/src/worktree.mjs`; `node --check packages/core/src/dispatcher.mjs`
Run unit: `node --test packages/core/__test__/runtime-loop.test.mjs`
Plan: `.specs/features/runtime-loop/plan.md`

6 checks in 1 slice · 3 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Adapters, Router/Circuit-Breaker, Worktrees, and Autonomous Dispatcher

**C1** - `buildAdapterCommand` constructs the exact non-interactive CLI arguments for `"antigravity"` (`agy -p ... --output-format json --mode auto`), `"claude-code"` (`claude -p ... --output-format json --dangerously-skip-permissions`), and `"codex"` (`codex exec --json --full-auto ...`), and `parseAdapterOutput` extracts `{ contract, usage: { inputTokens, outputTokens, cachedTokens, explicitCostUsd } }` across all 3 runtimes (AC 1)
Proof: run unit | ✔ C1: buildAdapterCommand and parseAdapterOutput handle antigravity, claude-code, and codex

**C2** - `selectRuntime` in `"auto"` mode picks the healthy runtime with the highest `quota_remaining`, and `recordRuntimeFailure` trips the circuit breaker to `"open"` on `timeout`, `500`, or `429`, removing that runtime from selection until reset (AC 2)
Proof: run unit | ✔ C2: router selects highest quota healthy runtime and trips circuit breaker on timeout, 500, or 429

**C3** - `pollIssuesWithEtag` sends `If-None-Match` and returns `{ notModified: true, issues: [] }` on HTTP `304` or parsed issues with new ETag on HTTP `200`, and `hasHumanApprovalComment` detects `/approve` comments (AC 3)
Proof: run unit | ✔ C3: pollIssuesWithEtag handles HTTP 304 and HTTP 200 and detects /approve comments

**C4** - `prepareWorktree` prepares an isolated workspace directory, copies `AGENTS.md` and `CLAUDE.md`, and synchronizes all 23 locked skills into `.agents/skills` and `.claude/skills` (AC 4)
Proof: run unit | ✔ C4: prepareWorktree copies AGENTS.md/CLAUDE.md and syncs all 23 locked skills

**C5** - `dispatchTask` runs a `feature` task in `"gated"` mode through `triage` (selecting model from `modelByImpact`) and `plan`, pauses at `plan` with `needs_human: 1` until approved (`approveTask` or `/approve`), then advances through `checks_and_build -> verify -> review` to `merge` with telemetry recorded in SQLite (AC 5)
Proof: run unit | ✔ C5: dispatchTask executes gated feature workflow, pauses at human gates, and resumes on approval

**C6** - When `review` returns `REQUEST_CHANGES`, `dispatchTask` loops back to `checks_and_build` incrementing `review_rounds`, and stops with `needs_human: 1` (`max_review_rounds_reached`) when `review_rounds` reaches `maxReviewRounds` (3) (AC 6)
Proof: run unit | ✔ C6: dispatchTask loops on REQUEST_CHANGES and halts with needs_human at maxReviewRounds (3)

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (3) | Door 1 (GitHub ETag polling) C3 · Door 2 (Router & circuit breaker) C2 · Door 3 (CLI adapter shapes) C1 | - |
| Agent runtimes (3) | `antigravity` C1, C2 · `claude-code` C1, C2 · `codex` C1, C2 | - |
| Circuit breaker trip codes, AC 2 (3 examples) | `429` C2 · `500` C2 · `timeout` C2 · manual reset C2 | - |
| GitHub ETag & approval rule, AC 3 (2 examples) | HTTP `304` C3 · HTTP `200` with `"/approve"` C3 | - |
| Review loop & cap rule, AC 6 (2 examples) | round 1 `REQUEST_CHANGES` -> `checks_and_build` C6 · round 3 `REQUEST_CHANGES` -> `needs_human: 1` C6 | - |
| Stored entities (3) | `TASK` C5, C6 · `TELEMETRY_EVENT` C5 · `RUNTIME_HEALTH` C2 | - |

## Swept

- validation: C1, C5
- failure modes: C2, C6
- idempotency: C3, C4
- authorization: C3, C5
- concurrency: C4
- data lifecycle: C4, C5
- dependency failure: C2, C3
- state transitions: C5, C6
- observability: C1, C5

## Handoff

- **Settled mid-build:** none
- **Dispatched:** Verifier at `957e6a9` - returned (`PASS`)
- **Boundary:** C1-C6 closed at `c4a2c07`
- **Abandoned:** none
