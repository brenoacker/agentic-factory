# Factory Core: Configuration, Workflows, Contracts, Guards, and Store checks

Build: `node --check packages/core/cli.mjs`; `node --check packages/core/src/config.mjs`; `node --check packages/core/src/contracts.mjs`; `node --check packages/core/src/guards.mjs`; `node --check packages/core/src/store.mjs`
Run unit: `node --test packages/core/__test__/factory-core.test.mjs`
Plan: `.specs/features/factory-core/plan.md`

7 checks in 1 slice · 4 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Factory as Code, Contracts, Guards, and SQLite Store

**C1** - `node packages/core/cli.mjs validate` validates `factory.yaml`, all 5 workflow definitions (`feature`, `bug`, `investigation`, `discovery`, `chore`), the pricing configuration, `skills.lock.json` cross-references, and all contract fixtures, exiting `0` with `"ok":true` and `"workflowsValidated":5` (AC 1)
Proof: run unit | ✔ C1: cli validate passes factory.yaml, 5 workflows, prices, skills lock, and contract fixtures

**C2** - Workflow validation rejects unknown skills not in `skills.lock.json` (`"non-existent-skill"`) or missing required fields (`id`, `label`, `stages`) with exit `1` naming the workflow and offending skill/field, while accepting `"tlc-spec-lean"` (AC 2)
Proof: run unit | ✔ C2: workflow validation rejects unlocked skill or missing required fields and accepts locked skill

**C3** - `triage` contract validation rejects generic or short `root_cause` (`"bug"`, `< 20` chars), empty/short `evidence` (`< 15` chars), or invalid `impact` with specific rule codes (`generic_root_cause`, `root_cause_too_short`, `evidence_too_short`), and accepts a valid detailed diagnosis (AC 3)
Proof: run unit | ✔ C3: triage contract enforces non-generic root_cause >= 20 chars, evidence >= 15 chars, and valid impact enum

**C4** - `review` contract validation rejects `APPROVE` when `commit_sha` does not match `head_sha` (`commit_sha_mismatch`) or when `round > maxReviewRounds` (`max_review_rounds_exceeded`), and accepts a matching 7–40 hex SHA within the 3-round limit (AC 4)
Proof: run unit | ✔ C4: review contract enforces commit_sha == head_sha on APPROVE and round <= maxReviewRounds (3)

**C5** - Single-use `stage_token` callback gate accepts the first submission for the matching stage (`200`), rejects token replay with `409` (`token_already_used`), and rejects stage mismatch with `409` (`token_stage_mismatch`) without advancing task state (AC 5)
Proof: run unit | ✔ C5: stage_token gate accepts first use (200) and rejects replay or stage mismatch with 409

**C6** - `evaluateIntakeGuards` evaluates guards in cheapest-first order (`invalid_ticket_type` -> `factory_paused` -> `duplicate_execution` -> `rate_limit_exceeded` -> `daily_budget_exceeded`), returning the exact rejection code or accepting with deterministic `execution_key` `<repo>#<issue_number>` (AC 6)
Proof: run unit | ✔ C6: evaluateIntakeGuards enforces 5 ordered guards and produces deterministic execution_key

**C7** - `node packages/core/cli.mjs status` aggregates SQLite tasks and telemetry events into JSON with counts by stage/type, total tokens (`input`, `output`, `cached`), total cost in USD from model pricing, average review rounds, first-round approval rate, and `needsHuman` queue items (AC 7)
Proof: run unit | ✔ C7: cli status aggregates tasks, token usage, USD cost, review metrics, and needsHuman queue

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (4) | Door 1 (`factory.yaml`) C1 · Door 2 (`workflows/*.yaml`) C1, C2 · Door 3 (`contracts/*.schema.json`) C1, C3, C4 · Door 4 (SQLite schema) C5, C6, C7 | - |
| Ticket workflow definitions (5) | `feature` C1 · `bug` C1 · `investigation` C1 · `discovery` C1 · `chore` C1 | - |
| Agent contract schemas (4) | `task` C1 · `triage` C1, C3 · `investigation-report` C1 · `review` C1, C4 | - |
| Workflow skill cross-reference rule, AC 2 (2 examples) | `"non-existent-skill"` C2 · `"tlc-spec-lean"` C1, C2 | - |
| Triage semantic rule, AC 3 (2 examples) | `root_cause: "bug"` + `evidence: ""` C3 · detailed 35-char root cause + 25-char evidence + `impact: "medium"` C3 | - |
| Review SHA & round rule, AC 4 (3 examples) | `commit_sha` mismatch C4 · `round: 4` (> 3) C4 · matching SHA at `round: 1` C4 | - |
| Stage token rule, AC 5 (3 examples) | first use `200` C5 · replay `409` `token_already_used` C5 · wrong stage `409` `token_stage_mismatch` C5 | - |
| Intake guards ordered rule, AC 6 (5 examples) | `killSwitch: true` C6 · duplicate `<repo>#42` C6 · hourly limit C6 · daily budget C6 · all clear C6 | - |
| Stored entities (3) | `TASK` C6, C7 · `TELEMETRY_EVENT` C6, C7 · `STAGE_TOKEN` C5 | - |

## Swept

- validation: C1, C2, C3, C4
- failure modes: C2, C3, C4, C5, C6
- idempotency: C5, C6
- authorization: C5
- concurrency: C5, C6
- data lifecycle: C7
- dependency failure: n/a - local SQLite and local filesystem with zero external network calls
- state transitions: C4, C5, C6
- observability: C7

## Handoff

- **Settled mid-build:** none
- **Dispatched:** none
- **Boundary:** none yet
- **Abandoned:** none
