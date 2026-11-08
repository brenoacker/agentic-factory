# AGENTS.md

Rules that are not obvious from reading the code. Everything else: read the code, `docs/plan.md`, and `.specs/`.

## Two modes — know which one you are in

- **Factory stage** (you were dispatched by the factory into a `.workspaces/` checkout with a stage + contract): do only that stage and return the JSON contract from `contracts/`. Do not push, merge, open PRs, change labels, or advance stages — the factory does that. Generic contract values (`"bug"`, `"fixed"`) are rejected.
- **Developing this repo**: follow the delivery loop below.

## Delivery loop

1. `main` is protected. Every change lands through a PR from a short-lived branch (`feat/<slug>`, `fix/<slug>`, `chore/<slug>`). Never push to `main`, never force-push, never bypass checks.
2. Features and bugs use `tlc-spec-lean` v2.2.0 in `.specs/features/<slug>/`: `plan.md` → `checks.md` → build → `verification.md`. The verifier must be a fresh sub-agent that did not write the code. Test titles start with their check ID (`C3: ...`).
3. Done means `npm run verify` is green locally **and** CI is green on the PR. A verification report is invalid if CI on that commit is red. If `main` is red, fixing it comes before any new work.
4. PR title is a Conventional Commit (it becomes the squash commit). Fill the PR template with the commands you actually ran.

## Testing & Visual Proof

- **Visual & behavioral proof is mandatory**: Any UI change or user-visible state transition MUST have a Playwright test in `apps/panel/e2e/`. No feature or UI change is accepted without visual proof (screenshots in `.specs/features/<slug>/captures/` or `runs/screenshots/`, and video on failures).
- **Test state transitions in practice**: If a feature advances stages, moves Kanban columns, or mutates UI state, the Playwright test must exercise the full user journey in the browser, assert on visible roles/labels, and capture the resulting visual proof before and after the transition.
- **Hermetic tests**: Build test state with `test-support/factory-clone.mjs`; run local servers on port `0`; never depend on live `factory.yaml` projects, network, or real tokens.
- **Integrity**: If a test fails or looks wrong, stop and ask — never weaken or edit an assertion just to make it pass.

## Always

- English only in code, UI, docs, and commits.
- Never commit secrets, `.env*`, tokens, or runtime state (`runs/`, `.workspaces/`, `*.db`).
- Never claim a result you did not observe. Stop and ask on missing product decisions or irreversible actions (record `needs_human` in factory stages).
- Record durable decisions in `.specs/STATE.md` and reusable lessons in `brain/`.
