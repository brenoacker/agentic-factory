# Unified Menu and Operator Views checks

Build: `node scripts/build-panel.mjs; node --check apps/panel/server.mjs; node --check packages/core/src/files.mjs`
Run unit: `node --test apps/panel/__test__/control-panel.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/unified-menu-and-operator-views/plan.md`

3 checks in 3 slices · 3 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Consolidated 3-Tier Operator Navigation

**C1** - SideNavigation consolidates into 3 primary operator views (`Control Tower`, `Board & Timeline`, `Settings, Health & Integrations`) with collapsible advanced diagnostics section (AC 1, AC 2, AC 3)
Proof: run e2e | C24: Playwright E2E verifies consolidated 3-tier SideNavigation and collapsible diagnostics

### S2 - Contextual Purpose and Intervention Explainers

**C2** - Interface renders informative context alert cards for Circuit Breakers, Canary Deploy Gates, and Factory Long-Term Brain explaining their purpose, safeguard function, and operator interventions (AC 4, AC 5, AC 6)
Proof: run e2e | C25: Playwright E2E verifies contextual purpose explainers for circuit breaker, deploy gate, and brain

### S3 - Backward-Compatible Navigation Bar & Regression Safety

**C3** - Top bar operator switcher `#btn-view-*` and legacy `#tabs button[data-tab="..."]` buttons activate respective sections with zero regressions across test suites (AC 7, AC 8, AC 9)
Proof: run unit | C1: GET /api/dashboard returns 200 with full factory telemetry

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (3) | Door 1 (Tiered SideNavigation Structure) C1 · Door 2 (Contextual Value Explainers) C2 · Door 3 (Backward-Compatible Dual-Selector) C3 | - |
| Primary operator views (3) | `Control Tower` C1, C3 · `Board & Timeline` C1, C3 · `Settings, Health & Integrations` C1, C2, C3 | - |
| Contextual reliability cards (3) | `Circuit Breaker` C2 · `Deploy Gate` C2 · `Factory Brain` C2 | - |
| `POST /api/controls` statuses (2) | `200` C3 · `400` C3 | - |
| `POST /api/files/open` statuses (3) | `200` C3 · `400` C3 · `404` C3 | - |
| Stored entities (2) | `TASK` C1, C3 · `FACTORY_CONFIG` C1, C2, C3 | - |

## Swept

- validation: C1, C2, C3
- failure modes: C1, C2, C3
- idempotency: C1, C2, C3
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C1, C2, C3
- data lifecycle: C1, C2, C3
- dependency failure: C1, C2, C3
- state transitions: C1, C2, C3
- observability: C1, C2, C3

## Handoff

- **Settled mid-build:** none
- **Dispatched:** Independent Feature Verifier at 65207ce
- **Boundary:** pending
- **Abandoned:** none
- **Walked:** pending
