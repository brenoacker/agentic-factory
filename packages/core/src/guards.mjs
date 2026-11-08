const VALID_TICKET_TYPES = new Set(['feature', 'bug', 'investigation', 'discovery', 'chore']);

/**
 * Produces a deterministic execution key `<repo>#<issue_number>` for idempotent deduplication.
 */
export function buildExecutionKey(repo, issueNumber) {
  return `${repo}#${issueNumber}`;
}

/**
 * Evaluates intake guards in cheapest-first order (Live 02 / Felipe's 6 intake guards):
 * 1. Valid ticket type
 * 2. Factory killSwitch == false (and target project not paused)
 * 3. Deduplication: no active execution for `<repo>#<issue_number>`
 * 4. Hourly rate limit: tasks started in the last 60 minutes < maxTasksPerHour
 * 5. Daily USD budget: spend in the last 24 hours < dailyBudgetUsd
 */
export function evaluateIntakeGuards(issue, factoryConfig, store, nowDate = new Date()) {
  const f = factoryConfig?.factory || factoryConfig || {};
  const limits = f.limits || {};

  // 1. Valid ticket type
  if (!issue || !VALID_TICKET_TYPES.has(issue.type)) {
    return {
      ok: false,
      code: 'invalid_ticket_type',
      reason: `Unsupported ticket type: ${issue?.type}`,
    };
  }

  // 2. Kill switch
  if (f.killSwitch === true) {
    return {
      ok: false,
      code: 'factory_paused',
      reason: 'Factory killSwitch is active',
    };
  }

  if (Array.isArray(f.projects)) {
    const targetRepo = String(issue.repo || '').toLowerCase();
    const proj = f.projects.find(
      (p) => String(p.repo || '').toLowerCase() === targetRepo || String(p.id || '').toLowerCase() === targetRepo,
    );
    if (proj && proj.paused === true) {
      return {
        ok: false,
        code: 'factory_paused',
        reason: `Project ${issue.repo} is paused`,
      };
    }
  }

  const executionKey = buildExecutionKey(issue.repo, issue.issue_number);

  // 3. Deduplication
  const existing = store ? store.getTask(executionKey) : null;
  if (existing) {
    return {
      ok: false,
      code: 'duplicate_execution',
      executionKey,
      reason:
        existing.stage === 'done' || existing.stage === 'aborted'
          ? `Execution ${executionKey} has already been completed`
          : `Active execution already exists for ${executionKey}`,
    };
  }

  // 4. Hourly rate limit
  const maxPerHour = limits.maxTasksPerHour ?? 10;
  if (store) {
    const oneHourAgo = new Date(nowDate.getTime() - 60 * 60 * 1000).toISOString();
    const recentCount = store.countTasksSince(oneHourAgo);
    if (recentCount >= maxPerHour) {
      return {
        ok: false,
        code: 'rate_limit_exceeded',
        executionKey,
        reason: `Hourly task count (${recentCount}) reached limit (${maxPerHour})`,
      };
    }
  }

  // 5. Daily USD budget
  const dailyBudget = limits.dailyBudgetUsd ?? 25.0;
  if (store) {
    const oneDayAgo = new Date(nowDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const recentSpend = store.sumSpendSince(oneDayAgo);
    if (recentSpend >= dailyBudget) {
      return {
        ok: false,
        code: 'daily_budget_exceeded',
        executionKey,
        reason: `24h spend ($${recentSpend.toFixed(2)}) reached daily budget ($${dailyBudget.toFixed(2)})`,
      };
    }
  }

  // 6. Max concurrent running agents (default 3, range 1 to 10)
  const rawMaxConcurrent = limits.maxConcurrentAgents !== undefined ? limits.maxConcurrentAgents : 3;
  const maxConcurrent = Math.min(10, Math.max(1, Number(rawMaxConcurrent)));
  if (store) {
    const executingCount =
      typeof store.countExecutingAgents === 'function'
        ? store.countExecutingAgents()
        : store.countActiveTasks();
    if (executingCount >= maxConcurrent) {
      return {
        ok: false,
        code: 'max_concurrency_reached',
        executionKey,
        reason: `Active running agents (${executingCount}) reached maximum concurrency limit (${maxConcurrent})`,
      };
    }
  }

  return {
    ok: true,
    code: 'accepted',
    executionKey,
    workflowId: issue.type,
  };
}
