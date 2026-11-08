## What and why

<!-- One paragraph. Link the issue: Closes #123 -->

## Spec

- Feature folder: `.specs/features/<slug>/` (plan.md · checks.md · verification.md) — or `n/a` for chores
- Verification verdict: PASS / n/a — verifier was an independent sub-agent

## Evidence
<!-- Paste the commands you ran and their summarized output. CI must be green before merge. -->

- [ ] `npm run verify` passes locally
- [ ] UI changes and state transitions are covered by a Playwright test in `apps/panel/e2e/`
- [ ] Visual proofs attached (screenshots / video recorded during Playwright run)
- [ ] Tests are hermetic (no live `factory.yaml` projects, network, or real tokens)
- [ ] No secrets, no Portuguese strings, Conventional Commit title

## Open questions / needs human

<!-- Anything you stopped on instead of guessing. -->
