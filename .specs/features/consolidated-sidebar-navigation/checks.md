# Consolidated SideNavigation and Removal of Redundant Top Tab Bar checks

Build: `node scripts/build-panel.mjs; node --check apps/panel/server.mjs; node --check packages/core/src/config.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/consolidated-sidebar-navigation/plan.md`

1 check in 1 slice · 1 one-way door · 0 open, of which 0 block

## Checks

### S1 - Consolidated SideNavigation, Clean Header & Playwright E2E Migration

**C1** - Playwright E2E tests verify that the Control Panel renders `Agentic Factory Control Plane` in TopNavigation without utility pills, eliminates `#tabs` entirely, navigates across all 6 tabs exclusively through `SideNavigation`, and triggers telemetry reloads via the Cloudscape Refresh Telemetry button in the ContentLayout header (AC 1, AC 2, AC 3, AC 4, AC 5, AC 6)
Proof: run e2e | 1 [chromium] C3: Control Panel renders 100% in English across all 6 tabs with zero Portuguese strings

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (1) | Door 1 (Single SideNavigation Drawer & Clean Header Refresh) C1 | - |
| Routes (2) | `GET /` C1 · `GET /api/dashboard` C1 | - |

## Swept

- validation: C1
- failure modes: C1
- idempotency: C1
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C1
- data lifecycle: C1
- dependency failure: C1
- state transitions: C1
- observability: C1

## Handoff

- **Settled mid-build:** none
- **Dispatched:** pending
- **Boundary:** pending
- **Abandoned:** none
- **Walked:** pending
