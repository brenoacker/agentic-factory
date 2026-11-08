# Unified Kanban Board Columns proofs

**Commit**: `c2feb1d`
**Status**: All checks passed

## Run Unit

Command: `node --test apps/panel/__test__/control-panel.test.mjs`

```
✔ C1: GET /api/dashboard returns 200 with full factory telemetry, workflows, skills, agents, brain, runtimeHealth, and deployments
✔ C2: POST /api/tasks/:key/approve returns 200 clearing needs_human and 404 for unknown task
✔ C3: POST /api/alerts/production returns 200 reopening task to triage, 400 on missing fields, and 404 on unknown task
✔ C4: POST /api/workflows/:id returns 200 on valid workflow, 422 on unlocked skill, and 400 on malformed body
✔ C5: POST /api/controls returns 200 persisting operational controls and 400 on negative limits
✔ C6: POST /api/deploy/verify saves last_good_sha on healthy deploy, rolls back on threshold violation, and returns 400 on missing sha
✔ C7: queryBrain, extractFollowUpTickets, and canAutoMergeTask enforce brain search, follow-up extraction, and auto-low merge rules
✔ C8: Linear tracker poller queries GraphQL API, applies combinable pickup triggers, and handles missing API key
✔ C9: Tracker lifecycle updates status to in-progress, posts pickup comment, and closes with completion proof
✔ C10: Workspace provisioner clones or checks out isolated worktree on target default branch with task branch and locked skills
✔ C11: Deliverable validation gate enforces mandatory PR for code workflows and research document for analysis workflows before done
✔ C12: Controls API persists maxConcurrentAgents within range 1 to 10 and rejects invalid bounds
✔ C13: Concurrency intake guard bounds active tasks to maxConcurrentAgents defaulting to 3 and rejecting overflow
✔ C14: Executing agent concurrency excludes merge and needs_human tasks, preserves workspace, and filters queued triage from stall alarms
✔ C15: Periodic scheduler auto-dispatches queued triage tasks up to executing concurrency ceiling
✔ C16: Factory store persists ticket_url, provider, and triage contract type mutation, and auto-enables scheduler
✔ C18: Live GitHub PR verification and premature done transition rejection
✔ C19: Cron scheduler syncMergedPullRequests auto-completes tasks upon PR merge
✔ C21: resolveTaskReviewFiles resolves plan documents with vscode:// URIs and openInEditor enforces path containment
✔ C22: POST /api/files/open launches editor and GET /api/files/content returns file contents, rejecting traversal
✔ C26: Autonomous plan progression for well-described tasks and conditional human gating
✔ C27: Deduplicated tracker lifecycle updates and PR notifications across GitHub and Linear
✔ C28: Non-code research workflow auto-close and post-merge closing
✔ C29: Unified 4-column Kanban board preserves 100% of tasks across triage, in_progress, waiting_human, and done (0.4261ms)
✔ C30: In-progress and waiting-human tasks display distinct granular stage badges in unified columns (0.1031ms)
ℹ tests 25
ℹ suites 0
ℹ pass 25
ℹ fail 0
```

## Run E2E

Command: `npx playwright test -g "C31: Playwright E2E verifies 4-column unified Kanban board and stage badge display" --reporter=list`

```
Running 1 test using 1 worker
  ok 1 [chromium] › apps\panel\e2e\panel.spec.mjs:1501:1 › C31: Playwright E2E verifies 4-column unified Kanban board and stage badge display (1.3s)
  1 passed (2.2s)
```
