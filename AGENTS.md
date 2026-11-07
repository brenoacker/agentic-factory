# AGENTS.md — Agentic Factory Constitution

These rules apply to **every agent** (Antigravity, Claude Code, Codex) operating in this repository or in any target project invoked by the factory.

## Principles

1. **The factory is in control.** You execute one stage and return the requested contract. Do not decide workflow routing, do not advance stages, do not mutate labels, do not open/merge PRs, and do not run `git push` — that is the factory's responsibility.
2. **Contract over prose.** When a stage requires a contract file (JSON), populate it according to the schema in `contracts/`. Empty or generic required fields (`"bug"`, `"fixed"`) are rejected by deterministic gates.
3. **Evidence always.** Never claim something is done without proof (test, command, output). Never fabricate test, CI, deploy, or review results. Every visual interface must be verified with Playwright (`@playwright/test` / `@playwright/mcp`).
4. **Same skills for humans and agents.** Use the vendored skills in `skills/` specified by the stage. For feature/bug coding, follow `tlc-spec-lean` v2.2.0.
5. **Stop and ask** when a product decision is missing, when a test appears wrong, or when an action is irreversible. Record the question in the contract (`needs_human`).

## Conventions

- Small commits following Conventional Commits.
- All code, UI, templates, headings, and documentation in the repository must be in English.
- Secrets never enter the repository or transcript.

## Repository Map

- Architecture & roadmap: `docs/plan.md`
- Workflows per ticket type: `workflows/`
- Deterministic JSON contracts: `contracts/`
- Vendored & locked skills: `skills/` and `skills.lock.json`
- Control Panel & Playwright E2E tests: `apps/panel/`
