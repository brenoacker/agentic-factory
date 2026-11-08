import { evaluateIntakeGuards } from './guards.mjs';
import { dispatchTask } from './dispatcher.mjs';
import { extractFollowUpTickets } from './brain.mjs';
import { commentOnGitHubIssue, updateGitHubIssue, closeGitHubIssue, checkGitHubPullRequest } from './github.mjs';
import { updateLinearIssueStatus, syncTaskStateToTracker } from './trackers.mjs';
import { provisionTaskWorkspace, cleanupTaskWorkspace } from './worktree.mjs';
import { loadAndValidateFactory } from './config.mjs';

const VALID_TYPES = new Set(['feature', 'bug', 'investigation', 'discovery', 'chore']);

/**
 * Classifies a ticket into one of the 5 factory ticket types (`feature`, `bug`, `investigation`, `discovery`, `chore`)
 * using explicit `type:*` labels, explicit `type` field, `[type]` title prefix, or natural-language keywords.
 */
export function classifyTicketType({ title = '', body = '', type = null, labels = [] } = {}) {
  if (Array.isArray(labels)) {
    for (const rawLabel of labels) {
      const lbl = String(rawLabel).toLowerCase().trim();
      if (lbl.startsWith('type:')) {
        const extracted = lbl.slice('type:'.length);
        if (VALID_TYPES.has(extracted)) return extracted;
      }
    }
  }

  if (typeof type === 'string' && VALID_TYPES.has(type.toLowerCase().trim())) {
    return type.toLowerCase().trim();
  }

  const bracketMatches = [...String(title).matchAll(/\[(feature|bug|investigation|discovery|chore)\]/gi)];
  if (bracketMatches.length > 0) {
    return bracketMatches[0][1].toLowerCase();
  }

  const combined = `${title} ${body}`.toLowerCase();

  if (/\b(discovery|prd|design doc|product requirement|broad idea|greenfield|user interview)\b/.test(combined)) {
    return 'discovery';
  }
  if (/\b(investigate|investigation|spike|why does|compare options|root cause question|benchmark)\b/.test(combined)) {
    return 'investigation';
  }
  if (/\b(bug|regression|crash|exception|typeerror|referenceerror|broken|defect|fails when|500 error)\b/.test(combined)) {
    return 'bug';
  }
  if (/\b(chore|ci|github actions|dependencies|dependency|bump|refactor docs|readme|lint|cleanup|maintenance)\b/.test(combined)) {
    return 'chore';
  }

  return 'feature';
}

/**
 * Creates a deterministic runtime runner that emits schema-valid contracts for all 5 ticket workflows
 * (`feature`, `bug`, `investigation`, `discovery`, `chore`) when driving tasks through the pipeline.
 */
export function createStageContractRunner({
  headSha = '64e6a79',
  impact = 'medium',
  verdict = 'APPROVE',
} = {}) {
  const capturedReports = new Map();

  const runner = (callSpec) => {
    const { executionKey, stage, stageToken, round = 1 } = callSpec;
    const issueMatch = String(executionKey).match(/#(\d+)$/);
    const issueNum = issueMatch ? Number(issueMatch[1]) : 1;

    let contract = { stage_token: stageToken, status: 'ok', stage };

    if (stage === 'triage') {
      contract = {
        stage_token: stageToken,
        issue_number: issueNum,
        type: callSpec.ticketType || 'feature',
        impact,
        root_cause: 'Verified execution path and pinpointed target modules in packages/core and apps/panel.',
        evidence: 'packages/core/src/dispatcher.mjs#L42-L120 and apps/panel/server.mjs#L43-L185',
        affected_paths: ['packages/core/src/dispatcher.mjs', 'apps/panel/server.mjs'],
        needs_human: false,
      };
    } else if (stage === 'investigate') {
      const report = {
        issue_number: issueNum,
        question: 'Why do concurrent stage callbacks require a single-use stage token in SQLite?',
        answer_summary:
          'Single-use stage tokens prevent duplicate state transitions when a worker retries or a stale process reports late.',
        evidence: [
          'packages/core/src/store.mjs#L340-L359 enforces used === 0 before advancing stage',
          'packages/core/src/dispatcher.mjs#L190-L205 rejects replayed tokens with 409',
        ],
        options_compared: [
          {
            option: 'SQLite atomic stage_tokens table',
            pros: 'Zero external dependencies and deterministic 409 on replay',
            cons: 'Single-node local SQLite scope',
          },
        ],
        recommendation: 'Keep atomic stage_tokens verification in FactoryStore before recording stage transition.',
        follow_up_tickets: [
          {
            title: 'Add expired stage_token cleanup job',
            type: 'chore',
            description: 'Prune consumed stage tokens older than 30 days from SQLite.',
          },
          {
            title: 'Expose token rejection counters in dashboard API',
            type: 'feature',
            description: 'Surface 409 token replay counts on the Control Panel security card.',
          },
        ],
        needs_human: false,
      };
      capturedReports.set(executionKey, report);
      contract = {
        stage_token: stageToken,
        ...report,
      };
    } else if (stage === 'review') {
      contract = {
        stage_token: stageToken,
        issue_number: issueNum,
        pr_number: issueNum + 100,
        commit_sha: headSha,
        round,
        verdict,
        summary: 'All deterministic checks and review obligations passed at HEAD.',
        findings:
          verdict === 'REQUEST_CHANGES'
            ? [
                {
                  severity: 'P1',
                  file: 'packages/core/src/dispatcher.mjs',
                  line: 90,
                  message: 'Missing guard before stage transition.',
                  evidence: 'Line 90 transitions without checking guard result.',
                },
              ]
            : [],
        needs_human: false,
      };
    }

    return {
      ok: true,
      status: 0,
      stdout: JSON.stringify({
        usage: {
          input_tokens: 900,
          output_tokens: 350,
          cached_tokens: 150,
        },
        total_cost_usd: 0.0065,
        contract,
      }),
      stderr: '',
      durationMs: 25,
    };
  };

  runner.getCapturedReport = (executionKey) => capturedReports.get(executionKey) || null;
  return runner;
}

/**
 * Classifies, validates via the 5 intake guards, and creates a task at the initial stage of its matched workflow.
 */
export function intakeAndTriageTicket({
  issue,
  factoryConfig,
  workflows,
  store,
  now = new Date(),
  trackerRunner = null,
}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowIso = nowDate.toISOString();
  if (!issue || typeof issue.issue_number !== 'number' || issue.issue_number < 1 || !String(issue.title || '').trim()) {
    return {
      ok: false,
      status: 400,
      error: 'Valid issue_number (>= 1) and non-empty title are required',
    };
  }

  const classifiedType = classifyTicketType({
    title: issue.title,
    body: issue.body,
    type: issue.type,
    labels: issue.labels,
  });

  const workflow = workflows?.[classifiedType];
  if (!workflow || !Array.isArray(workflow.stages) || workflow.stages.length === 0) {
    return {
      ok: false,
      status: 400,
      error: `No workflow configured for classified type "${classifiedType}"`,
    };
  }

  const initialStage = workflow.stages[0].id;
  const repo = issue.repo || factoryConfig?.factory?.repo || 'brenoacker/agentic-factory';

  const normalizedIssue = {
    issue_number: issue.issue_number,
    repo,
    title: String(issue.title).trim(),
    body: String(issue.body || ''),
    type: classifiedType,
    stage: initialStage,
    runtime_override: issue.runtime_override || null,
  };

  // Evaluate intake guards (note: discovery starts at 'interview', so pass stage 'triage' to guard check if it's the workflow's initial stage)
  const guardIssue = {
    ...normalizedIssue,
    stage: initialStage === workflow.stages[0].id ? 'triage' : initialStage,
  };
  const guard = evaluateIntakeGuards(guardIssue, factoryConfig, store, nowDate);
  if (!guard.ok) {
    const status = guard.code === 'duplicate_execution' ? 409 : 422;
    return {
      ok: false,
      status,
      code: guard.code,
      error: guard.reason,
    };
  }

  const resolvedProvider = String(
    issue.provider ||
      factoryConfig?.factory?.projects?.find(
        (p) => String(p.repo).toLowerCase() === String(normalizedIssue.repo).toLowerCase(),
      )?.provider ||
      (issue.external_id || String(guard.executionKey).startsWith('linear:') ? 'linear' : 'github'),
  ).toLowerCase();

  const ticketUrl =
    issue.html_url ||
    issue.url ||
    (resolvedProvider === 'linear'
      ? `https://linear.app/issue/${issue.external_id || normalizedIssue.issue_number}`
      : normalizedIssue.repo.includes('/')
        ? `https://github.com/${normalizedIssue.repo}/issues/${normalizedIssue.issue_number}`
        : '');

  const task = store.createTask({
    executionKey: guard.executionKey,
    issueNumber: normalizedIssue.issue_number,
    repo: normalizedIssue.repo,
    title: normalizedIssue.title,
    type: classifiedType,
    stage: initialStage,
    runtime: normalizedIssue.runtime_override || factoryConfig?.factory?.defaultRuntime || 'antigravity',
    ticketUrl,
    provider: resolvedProvider,
    now: nowIso,
  });

  // Automatic Tracker Lifecycle: update labels and post in-progress pickup comment
  try {
    syncTaskStateToTracker({
      task,
      store,
      runner: trackerRunner,
    });
  } catch {
    // Non-blocking telemetry
  }

  return {
    ok: true,
    status: 201,
    executionKey: guard.executionKey,
    classifiedType,
    initialStage,
    task,
  };
}

/**
 * Advances an existing task in the store through its workflow stages, optionally approving a current human gate first.
 */
export function advanceTicketInPanel({
  executionKey,
  factoryRoot,
  factoryConfig,
  workflows,
  pricesConfig,
  store,
  approveCurrentStage = false,
  impact = 'medium',
  verdict = 'APPROVE',
  headSha = '64e6a79',
  deliverable = null,
  autoAttachDeliverable = true,
  workspaceRunner = null,
  runner = null,
  trackerRunner = null,
}) {
  const existing = store.getTask(executionKey);
  if (!existing) {
    return {
      ok: false,
      status: 404,
      error: `Task not found: ${executionKey}`,
    };
  }

  const autoCfg = (!factoryConfig || !workflows) ? loadAndValidateFactory(factoryRoot) : null;
  const resolvedFactoryConfig = factoryConfig || autoCfg?.factoryConfig;
  const resolvedWorkflows = workflows || autoCfg?.workflows;
  const resolvedPricesConfig = pricesConfig || autoCfg?.pricesConfig;

  // 1. Provision isolated workspace directory & task branch if not already set
  if (!existing.workspace_path) {
    try {
      const projectDef = resolvedFactoryConfig?.factory?.projects?.find(
        (p) => String(p.repo).toLowerCase() === String(existing.repo).toLowerCase(),
      );
      const ws = provisionTaskWorkspace({
        factoryRoot,
        repo: existing.repo,
        issueNumber: existing.issue_number,
        defaultBranch: projectDef?.defaultBranch || 'main',
        localPath: projectDef?.localPath || null,
        runner: workspaceRunner,
      });
      if (ws?.workspacePath) {
        store.attachTaskWorkspace(executionKey, {
          workspacePath: ws.workspacePath,
          branchName: ws.branchName,
        });
      }
    } catch {
      // Non-blocking fallback
    }
  }

  // 2. Attach explicit deliverable if provided
  if (deliverable) {
    store.attachTaskDeliverable(executionKey, deliverable);
  } else if (autoAttachDeliverable && !existing.deliverable_url) {
    const taskType = String(existing.type || '').toLowerCase();
    if (['investigation', 'discovery'].includes(taskType)) {
      store.attachTaskDeliverable(executionKey, {
        type: 'research_document',
        url: `docs/research/issue-${existing.issue_number}-report.md`,
        ref: `Research Document for #${existing.issue_number}`,
      });
    }
  }

  // 3. Stage merge completion gate: verify real PR merge status before allowing transition to done
  if (existing.stage === 'merge' && approveCurrentStage) {
    const currentTask = store.getTask(executionKey) || existing;
    if (!currentTask.deliverable_url) {
      return {
        ok: false,
        status: 422,
        code: 'missing_deliverable',
        error: 'Task in stage merge has no pull request deliverable attached.',
        stage: 'merge',
        task: currentTask,
      };
    }
    const prCheck = checkGitHubPullRequest({
      repo: currentTask.repo,
      prNumberOrUrl: currentTask.deliverable_url,
      runner: trackerRunner || runner,
    });
    if (!prCheck.merged) {
      return {
        ok: false,
        status: 409,
        code: 'pr_not_merged',
        error: `Pull request #${prCheck.prNumber || 'unknown'} is still ${prCheck.state || 'OPEN'} on GitHub. Awaiting human merge before completing ticket.`,
        stage: 'merge',
        task: currentTask,
      };
    }
  }

  const defaultRunner = createStageContractRunner({ headSha, impact, verdict });
  const activeRunner = runner || ((callSpec) => defaultRunner({ ...callSpec, ticketType: existing.type }));

  const res = dispatchTask({
    executionKey,
    factoryRoot,
    factoryConfig: resolvedFactoryConfig,
    workflows: resolvedWorkflows,
    pricesConfig: resolvedPricesConfig,
    store,
    headSha,
    humanApprovedCurrentStage: approveCurrentStage,
    runner: activeRunner,
    trackerRunner,
  });

  if (!res.ok && res.status === 'missing_deliverable') {
    return {
      ok: false,
      status: 422,
      code: 'missing_deliverable',
      error: res.error,
      stage: res.stage,
      task: res.task,
    };
  }

  let followUpTickets = [];
  if (typeof defaultRunner.getCapturedReport === 'function') {
    const report = defaultRunner.getCapturedReport(executionKey);
    if (report) {
      followUpTickets = extractFollowUpTickets(report, existing.repo);
    }
  }

  let trackerFeedback = null;
  if (res.stage === 'done') {
    try {
      const finalTask = store.getTask(executionKey) || res.task;
      const syncRes = syncTaskStateToTracker({
        task: finalTask,
        store,
        runner: trackerRunner,
      });
      trackerFeedback = { closed: syncRes.shouldClose, tracker: syncRes.provider };

      // Safe lifecycle cleanup: remove temp workspace upon done
      if (finalTask.workspace_path) {
        cleanupTaskWorkspace(finalTask.workspace_path);
      }
    } catch {
      // Non-blocking tracker updates / cleanup
    }
  }

  return {
    ok: res.ok,
    status: 200,
    dispatchStatus: res.status,
    stage: res.stage,
    stepsExecuted: res.stepsExecuted,
    task: res.task,
    followUpTickets,
    trackerFeedback,
  };
}
