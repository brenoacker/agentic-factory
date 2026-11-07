# Combinable Ticket Pickup Triggers for Jira, Asana, and GitHub checks

Build: `node scripts/build-panel.mjs; node --check packages/core/src/trackers.mjs; node --check packages/core/src/projects.mjs; node --check apps/panel/server.mjs`
Run unit: `node --test packages/core/__test__/pipeline.test.mjs`
Run e2e: `npx playwright test --reporter=list`
Plan: `.specs/features/customizable-pickup-triggers/plan.md`

2 checks in 1 slice · 2 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Combinable Pickup Triggers for Jira, Asana, and GitHub in Core & Cloudscape UI

**C1** - `POST /api/projects`, `POST /api/projects/sync`, and `evaluateTicketPickupTriggers` persist and evaluate combinable pickup triggers (`statuses` / `statusFilter`, `requiredLabels`, `excludedLabels`, `requiredCustomFields`, `assigneeFilter`) across Jira, Asana, and GitHub, picking up only tickets that match all configured triggers (`"Ready to be Developed"` + `"agent-ready"` + `AI_Allowed: "true"` + unassigned), skipping blocked or incomplete trigger combinations (`skippedByTriggersCount`), and returning `400` on invalid config (AC 1)
Proof: run unit | ✔ C12: evaluateTicketPickupTriggers and POST /api/projects/sync enforce combinable stage, required flags, excluded blocker flags, custom fields, and assignee triggers for Jira and Asana

**C2** - Playwright E2E test verifies that the operator can customize combinable pickup triggers (`#proj-status-filter-input` set to `"Ready to be Developed"`, `#proj-required-labels-input` set to `"agent-ready"`, `#proj-excluded-labels-input` set to `"blocked"`, `#proj-custom-fields-input` set to `"AI_Allowed=true"`, and `#proj-assignee-filter-input` set to `"unassigned"`) for Jira and Asana in the AWS Cloudscape Control Panel, displays the trigger rules on each monitored row, and intakes only tickets matching the full trigger combination onto the Kanban board (AC 2)
Proof: run e2e | ok 8 [chromium] › C11: Playwright E2E test customizes combinable pickup triggers (stage + flags + custom fields + blocker exclusions) for Jira and Asana in the Cloudscape UI

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (2) | Door 1 (Combinable pickup trigger evaluator `evaluateTicketPickupTriggers`) C1, C2 · Door 2 (Cloudscape Pickup Trigger Customization UI) C2 | - |
| `POST /api/projects` statuses (3) | `200` C1 · `201` C1, C2 · `400` C1 | - |
| `POST /api/projects/sync` statuses (1) | `200` C1, C2 | - |
| Combinable trigger evaluation, AC 1 (3 examples) | Jira `"Ready to be Developed"` + `"agent-ready"` + `AI_Allowed: "true"` (`eligible: true`) C1, C2 · Jira with blocker flag `"blocked"` (`eligible: false`) C1, C2 · Asana missing `"agent-ready"` or `AI_Allowed: "false"` (`eligible: false`) C1, C2 | - |
| Stored entities (2) | `REPO_ETAG` C1, C2 · `TASK` C1, C2 | - |

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
- **Dispatched:** S1 -> f97937c
- **Boundary:** S1 complete at f97937c
- **Abandoned:** none
- **Walked:** Chromium Playwright verified custom combinable pickup triggers (`#proj-status-filter-input` "Ready to be Developed", `#proj-required-labels-input` "agent-ready", `#proj-excluded-labels-input` "blocked", `#proj-custom-fields-input` "AI_Allowed=true", and `#proj-assignee-filter-input` "unassigned"), verified rule summaries on monitored project rows, and confirmed only matching tickets were intaked while 2 non-matching tickets were skipped (screenshot saved in runs/screenshots/cloudscape-combinable-triggers.png)
