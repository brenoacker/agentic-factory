# Agentic Factory

Local, single-operator **Agentic Software Factory**, versioned as code and designed as a **standalone multi-repository orchestrator**.

Inspired by [Tech Leads Club Live 02 — The Agentic Software Factory](https://www.youtube.com/watch?v=5UwvjCVPigM)
and built on the skills from [`tech-leads-club/agent-skills`](https://github.com/tech-leads-club/agent-skills).

> **Prose asks. Contracts enforce.** Control stays in the factory, not inside the agent.

## How It Works

1. **Configure the repositories you want to monitor** (`owner/repo`) in the **Control Panel** (`Board & Needs Human -> Monitored GitHub Repositories`), via the CLI (`node packages/core/cli.mjs projects --action add --repo owner/repo`), or in `factory.yaml` (`factory.projects`). You do **not** need to create issues inside `agentic-factory` — the factory monitors issues directly in your existing GitHub repositories.
2. `factory watch` (or clicking **Sync Issues from All Monitored Repos** in the Control Panel) polls open GitHub issues across every active monitored repository using per-repository `ETag` caching (`304 Not Modified` costs zero GitHub API rate limit).
3. The factory automatically classifies each ticket into one of the 5 workflows (`feature`, `bug`, `investigation`, `discovery`, `chore`) — via `type:*` labels, `[type]` prefixes, or natural-language problem descriptions — and provisions an isolated `git worktree` with `AGENTS.md`, `CLAUDE.md`, and all 23 locked skills.
4. For each stage, the factory invokes a **CLI runtime** — Antigravity (`agy`, default), Claude Code (`claude`), or Codex (`codex`). The agent returns a **JSON contract** validated deterministically by the factory.
5. The factory pauses only at **human gates** (plan approval, merge approval, discovery/investigation review) — approved with 1 click in the Control Panel or via `/approve` on the GitHub issue.
6. Every stage emits **telemetry** (stages, tokens, USD cost, verdicts, deployments) displayed in the **Control Panel** (`apps/panel`) and verified visually and end-to-end with **Playwright**.

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
factory.yaml            factory-as-code config (monitored projects, runtimes, limits, autonomy)
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
# Add an existing GitHub repository to monitor
node packages/core/cli.mjs projects --action add --repo owner/my-repo --branch main

# List monitored GitHub repositories
node packages/core/cli.mjs projects --action list

# Poll all monitored repositories with per-repo ETag caching
node packages/core/cli.mjs watch --once

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

All roadmap phases (Phases 0–7), multi-repository issue monitoring, and Playwright E2E verification are complete. See [docs/plan.md](docs/plan.md).

## License & Attribution

Tech Leads Club skills are distributed under CC-BY-4.0 — see [NOTICE](NOTICE).
