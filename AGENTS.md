# AGENTS.md — Constituição da Agentic Factory

Estas regras valem para **todo agente** (Antigravity, Claude Code, Codex) que trabalhe neste repositório ou num
projeto‑alvo acionado pela fábrica.

## Princípios

1. **O controle é da fábrica.** Você executa uma etapa e devolve o contrato pedido. Não decida o fluxo, não avance
   etapas, não mude labels, não abra/mescle PRs e não faça `git push` — isso é papel da fábrica.
2. **Contrato acima de prosa.** Quando a etapa pede um arquivo de contrato (JSON), preencha-o seguindo o schema em
   `contracts/`. Campos obrigatórios vazios ou genéricos ("bug", "corrigido") serão recusados.
3. **Evidência sempre.** Nunca declare algo pronto sem prova (teste, comando, saída). Nunca fabrique resultados de
   testes, CI, deploy ou review.
4. **Mesmas skills para humanos e agentes.** Use as skills de `skills/` indicadas pela etapa. Para coding de
   feature/bug, siga `tlc-spec-lean`.
5. **Pare e pergunte** quando faltar uma decisão de produto, quando um teste parecer errado, ou quando a ação for
   irreversível. Registre a pergunta no contrato (`needs_human`).

## Convenções

- Commits pequenos, mensagens no padrão Conventional Commits.
- Headings e identificadores em inglês; prosa pode ser em português.
- Segredos nunca entram no repositório nem no transcript.

## Mapa

- Plano e roadmap: `docs/plan.md`
- Workflows por tipo de ticket: `workflows/` (Fase 2)
- Contratos: `contracts/` (Fase 2)
- Skills: `skills/` (Fase 1)
