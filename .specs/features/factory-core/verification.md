# Factory Core: Configuration, Workflows, Contracts, Guards, and Store verification

**Verdict**: PASS
**Proofs**: `proofs.md` at a5d508b
**Verifier**: independent sub-agent (author != verifier)

## Checks

| Check | Test | Holds |
| --- | --- | --- |
| C1 | `packages/core/__test__/factory-core.test.mjs` `C1: cli validate passes factory.yaml, 5 workflows, prices, skills lock, and contract fixtures` | yes |
| C2 | `packages/core/__test__/factory-core.test.mjs` `C2: workflow validation rejects unlocked skill or missing required fields and accepts locked skill` | yes |
| C3 | `packages/core/__test__/factory-core.test.mjs` `C3: triage contract enforces non-generic root_cause >= 20 chars, evidence >= 15 chars, and valid impact enum` | yes |
| C4 | `packages/core/__test__/factory-core.test.mjs` `C4: review contract enforces commit_sha == head_sha on APPROVE and round <= maxReviewRounds (3)` | yes |
| C5 | `packages/core/__test__/factory-core.test.mjs` `C5: stage_token gate accepts first use (200) and rejects replay or stage mismatch with 409` | yes |
| C6 | `packages/core/__test__/factory-core.test.mjs` `C6: evaluateIntakeGuards enforces 5 ordered guards and produces deterministic execution_key` | yes |
| C7 | `packages/core/__test__/factory-core.test.mjs` `C7: cli status aggregates tasks, token usage, USD cost, review metrics, and needsHuman queue` | yes |

## Findings

None - Probed exact character length boundaries on `triage` (`19` vs `20` chars on `root_cause`, `14` vs `15` chars on `evidence`), `review` boundary rounds (`0` and `3`) and short-SHA prefix matching against a 40-char `head_sha`, `token_task_mismatch` (`409`) on `consumeStageToken`, re-intake after a task reaches `done`, and `investigation-report` semantic validation; all held at `4ed6799`.
