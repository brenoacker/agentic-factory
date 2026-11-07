# Visual Mermaid Workflow Designer and Authentic AWS Cloudscape AppLayout checks

Build: `node scripts/build-panel.mjs; node --check apps/panel/server.mjs; node --check packages/core/src/config.mjs`
Run unit: `node --test apps/panel/__test__/control-panel.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/visual-workflow-and-authentic-cloudscape/plan.md`

2 checks in 1 slice · 2 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Authentic AWS Cloudscape AppLayout and Visual Mermaid Workflow Designer

**C1** - `POST /api/workflows/:id` persists modified workflows from the panel editor, verifies that Mermaid diagram syntax generated from workflow stages color-codes human gates with amber style and automated transitions with blue style, and rejects unlocked skills with `422` (AC 1)
Proof: run unit | ✔ C4: POST /api/workflows/:id returns 200 on valid workflow, 422 on unlocked skill, and 400 on malformed body

**C2** - Playwright E2E test verifies authentic AWS Cloudscape `AppLayout` with `SideNavigation`, visual Mermaid SVG flowchart rendering in the Workflows tab (`#wf-mermaid-diagram svg`), interactive modification of workflow stages/autonomy with real-time Mermaid re-rendering, and saving with 200 without regressions across all tabs (AC 1, AC 2)
Proof: run e2e | ok 9 [chromium] › C12: Playwright E2E test verifies authentic AWS Cloudscape AppLayout, SideNavigation, and visual Mermaid workflow diagram editor

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (2) | Door 1 (Visual Mermaid Flowchart & Interactive Workflow Builder) C1, C2 · Door 2 (Full Authentic AWS Console AppLayout) C2 | - |
| `POST /api/workflows/:id` statuses (3) | `200` C1, C2 · `400` C1 · `422` C1 | - |
| Stored entities (2) | `WORKFLOW` C1, C2 · `TASK` C2 | - |

## Swept

- validation: C1, C2
- failure modes: C1
- idempotency: C1, C2
- authorization: n/a - local single-operator control plane bound to `127.0.0.1`
- concurrency: C1
- data lifecycle: C1, C2
- dependency failure: C1
- state transitions: C1, C2
- observability: C1, C2

## Handoff

- **Settled mid-build:** none
- **Dispatched:** pending
- **Boundary:** pending
- **Abandoned:** none
- **Walked:** pending
