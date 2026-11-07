# Agentic Factory

Fábrica de software agêntica **local**, operada por uma pessoa, versionada como código.

Inspirada na [Live 02 da Tech Leads Club — A Fábrica de Software Agêntica](https://www.youtube.com/watch?v=5UwvjCVPigM)
e construída sobre as skills de [`tech-leads-club/agent-skills`](https://github.com/tech-leads-club/agent-skills).

> **Prosa pede. Contrato garante.** O controle fica na fábrica, não no agente.

## Como funciona

1. Você cria uma **issue neste repositório** usando um dos templates (feature, bug, investigation, discovery, chore)
   e indica o **projeto‑alvo** (um dos seus repositórios).
2. O `factory watch` (local) consulta o GitHub, faz a triagem e escolhe o **workflow** do tipo de ticket.
3. Para cada etapa, a fábrica aciona um **agente CLI** — Antigravity (padrão), Claude Code ou Codex — com as mesmas
   skills vendorizadas aqui. O agente devolve um **contrato JSON** que a fábrica valida.
4. A fábrica para apenas nos **checkpoints humanos** (aprovar o plano, aprovar o merge) — pelo painel ou com
   `/approve` na issue.
5. Tudo vira **telemetria** (etapas, tokens, custo, vereditos) exibida no **painel de controle**.

| Etapa | Skill principal |
| --- | --- |
| Feature / bug (coding) | `tlc-spec-lean` |
| Investigação | `codenavi`, `not-your-babysitter` |
| Discovery | `tlc-prd`, `tlc-discover` |
| Review de PR | `the-judge` |
| CI quebrado | `gh-fix-ci` |

## Estrutura (alvo)

```
AGENTS.md / CLAUDE.md   constituição dos agentes
factory.yaml            fábrica como código (projetos, runtimes, limites, autonomia)
workflows/              um workflow por tipo de ticket
contracts/              JSON Schemas dos contratos agente ↔ fábrica
skills/                 skills vendorizadas (TLC) + custom
packages/core/          orquestrador (TypeScript, Node 24)
apps/panel/             painel de controle
brain/                  memória da fábrica (contexto, ADRs, lessons)
docs/                   plano e arquitetura
```

## Comandos Rápidos

```bash
# Validar factory.yaml, workflows e schemas de contratos
node packages/core/cli.mjs validate

# Sincronizar e verificar as 23 skills vendorizadas (tlc-spec-lean v2.2.0)
node scripts/sync-skills.mjs --verify-only

# Abrir o Painel de Controle local (http://127.0.0.1:4310)
node packages/core/cli.mjs panel --port 4310

# Consultar status da fábrica via CLI
node packages/core/cli.mjs status
```

## Status

Fases 0 a 7 concluídas (`skills-sync`, `factory-core`, `runtime-loop`, `control-panel`). Veja o roadmap completo em [docs/plan.md](docs/plan.md).

## Licença e atribuição

As skills da Tech Leads Club são distribuídas sob CC‑BY‑4.0 — veja [NOTICE](NOTICE).
