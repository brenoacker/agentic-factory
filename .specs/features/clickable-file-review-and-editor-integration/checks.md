# Clickable File Review and Editor Integration checks

Build: `node scripts/build-panel.mjs; node --check apps/panel/server.mjs; node --check packages/core/src/files.mjs; node --check packages/core/src/pipeline.mjs`
Run unit: `node --test apps/panel/__test__/control-panel.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/clickable-file-review-and-editor-integration/plan.md`

3 checks in 3 slices · 3 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Review File Resolution and Editor Launcher

**C1** - Review file resolution inspects task stage, deliverable, workspace, and question text to return evaluation files with `vscode://file/` URIs, and `openInEditor` invokes editor launcher with safe path containment (AC 1, AC 2, AC 3)
Proof: run unit | C21: resolveTaskReviewFiles resolves plan documents with vscode:// URIs and openInEditor enforces path containment

### S2 - Backend File Open & Content Endpoints

**C2** - Backend HTTP endpoints serve `POST /api/files/open` to trigger editor launch and `GET /api/files/content` to stream document text, rejecting path traversal with HTTP 400 or missing files with HTTP 404 (AC 4, AC 5, AC 6)
Proof: run unit | C22: POST /api/files/open launches editor and GET /api/files/content returns file contents, rejecting traversal

### S3 - Control Panel Clickable File Review and Preview Modal

**C3** - Playwright E2E verifies that tasks in stage `plan` display clickable `vscode://file/` links, `#open-editor-btn-{issueNumber}` triggers editor launch, and `#preview-doc-btn-{issueNumber}` renders an inline preview modal with close action (AC 7, AC 8, AC 9)
Proof: run e2e | C23: Playwright E2E verifies clickable vscode:// link, 1-click Open in Editor button, and inline Preview Document modal

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (3) | Door 1 (Dual Protocol + Server Editor Launch) C1, C2, C3 · Door 2 (Safe Path Containment) C1, C2, C3 · Door 3 (Integrated Inline Document Viewer) C1, C2, C3 | - |
| `POST /api/files/open` statuses (3) | `200` C2, C3 · `400` C2 · `404` C2 | - |
| `GET /api/files/content` statuses (3) | `200` C2, C3 · `400` C2 · `404` C2 | - |
| Stored entities (2) | `REVIEW_FILE` C1, C2, C3 · `TASK` C1, C2, C3 | - |

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
- **Dispatched:** Independent Feature Verifier at 5b823a0
- **Boundary:** pending
- **Abandoned:** none
- **Walked:** pending
