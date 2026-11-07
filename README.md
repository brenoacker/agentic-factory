# Agentic Factory

Local, single-operator **Agentic Software Factory**, versioned as code.

Inspired by [Tech Leads Club Live 02 — The Agentic Software Factory](https://www.youtube.com/watch?v=5UwvjCVPigM)
and built on the skills from [`tech-leads-club/agent-skills`](https://github.com/tech-leads-club/agent-skills).

> **Prose asks. Contracts enforce.** Control stays in the factory, not inside the agent.

## How It Works

1. Open an **issue in this repository** using one of the structured templates (`feature`, `bug`, `investigation`, `discovery`, `chore`) and specify the **target project**.
2. `factory watch` (or the Control Panel intake pipeline) polls GitHub with `ETag`, classifies and triages the ticket, and selects the matching **workflow** (`workflows/<type>.yaml`).
3. For each stage, the factory invokes a **CLI runtime** — Antigravity (`agy`, default), Claude Code (`claude`), or Codex (`codex`) — with the locked skills vendored in this repository. The agent returns a **JSON contract** validated deterministically by the factory.
4. The factory pauses only at **human gates** (plan approval, merge approval, discovery interview) — approved with 1 click in the Control Panel or via `/approve` on the GitHub issue.
5. Every stage emits **telemetry** (stages, tokens, USD cost, verdicts, deployments) displayed in the **Control Panel** (`apps/panel`) and tested visually and end-to-end with **Playwright**.

| Stage / Workflow | Primary Skills |
| --- | --- |
| Feature / Bug (coding) | `tlc-spec-lean` (v2.2.0), `coding-guidelines` |
| Investigation | `codenavi`, `not-your-babysitter`, `the-fool` |
| Discovery | `tlc-prd`, `tlc-discover`, `create-technical-design-doc`, `the-jury` |
| PR Review | `the-judge` |
| Broken CI / Review Feedback | `gh-fix-ci`, `gh-address-comments` |

## Repository Structure

```
AGENTS.md / CLAUDE.md   agent constitution (English)
factory.yaml            factory-as-code config (projects, runtimes, limits, autonomy)
workflows/              one workflow definition per ticket type
contracts/              JSON Schemas for agent <-> factory contracts
skills/                 vendored TLC skills (23 locked in skills.lock.json)
packages/core/          orchestrator (Node 24 + native node:sqlite)
apps/panel/             local Control Panel UI/API + Playwright E2E suite
agents/                 7 specialist agent definitions
brain/                  factory long-term memory (context, glossary, ADRs, lessons)
docs/                   architecture and roadmap
```

## Quick Commands

```bash
# Validate factory.yaml, workflows, and contract schemas
node packages/core/cli.mjs validate

# Verify all 23 locked TLC skills (including tlc-spec-lean v2.2.0)
node scripts/sync-skills.mjs --verify-only

# Run unit tests + Playwright visual/component/integration/E2E tests
npm test

# Start the local Control Panel (http://127.0.0.1:4310)
node packages/core/cli.mjs panel --port 4310
```

## Status

All roadmap phases (Phases 0–7) and Playwright E2E verification are complete. See [docs/plan.md](docs/plan.md).

## License & Attribution

Tech Leads Club skills are distributed under CC-BY-4.0 — see [NOTICE](NOTICE).
