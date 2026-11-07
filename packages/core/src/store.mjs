import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Computes USD cost from token counts and `config/prices.yaml` when the runtime does not supply an explicit USD cost.
 */
export function calculateUsageCostUsd({ model, inputTokens = 0, outputTokens = 0, cachedTokens = 0, explicitCostUsd = null }, pricesConfig) {
  if (typeof explicitCostUsd === 'number' && !Number.isNaN(explicitCostUsd) && explicitCostUsd >= 0) {
    return Number(explicitCostUsd.toFixed(6));
  }
  const models = pricesConfig?.models || {};
  const rate = models[model] || { inputPerMillionUsd: 3.0, outputPerMillionUsd: 15.0, cachedInputPerMillionUsd: 0.3 };
  const uncachedInput = Math.max(0, inputTokens - cachedTokens);
  const cost =
    (uncachedInput / 1_000_000) * (rate.inputPerMillionUsd || 0) +
    (cachedTokens / 1_000_000) * (rate.cachedInputPerMillionUsd || 0) +
    (outputTokens / 1_000_000) * (rate.outputPerMillionUsd || 0);
  return Number(cost.toFixed(6));
}

export class FactoryStore {
  constructor(dbPath = ':memory:') {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(resolve(dbPath)), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.#initSchema();
  }

  #initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        execution_key TEXT PRIMARY KEY,
        issue_number INTEGER NOT NULL,
        repo TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        stage TEXT NOT NULL,
        impact TEXT NOT NULL DEFAULT 'medium',
        runtime TEXT NOT NULL DEFAULT 'antigravity',
        model TEXT NOT NULL DEFAULT 'claude-sonnet',
        review_rounds INTEGER NOT NULL DEFAULT 0,
        approved_first_round INTEGER NOT NULL DEFAULT 0,
        needs_human INTEGER NOT NULL DEFAULT 0,
        human_question TEXT NOT NULL DEFAULT '',
        cost_usd REAL NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        deliverable_type TEXT NOT NULL DEFAULT '',
        deliverable_url TEXT NOT NULL DEFAULT '',
        deliverable_ref TEXT NOT NULL DEFAULT '',
        workspace_path TEXT NOT NULL DEFAULT '',
        branch_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stage_tokens (
        token TEXT PRIMARY KEY,
        execution_key TEXT NOT NULL,
        stage TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS telemetry_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_key TEXT NOT NULL,
        issue_number INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        stage TEXT NOT NULL DEFAULT '',
        runtime TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runtime_health (
        runtime TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'closed',
        quota_remaining INTEGER NOT NULL DEFAULT 100,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT NOT NULL DEFAULT '',
        tripped_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS deployments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_key TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        status TEXT NOT NULL,
        last_good_sha TEXT NOT NULL DEFAULT '',
        violation_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS repo_etags (
        repo TEXT PRIMARY KEY,
        etag TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
    `);

    // Migrate existing tasks table columns if absent
    const tableInfo = this.db.prepare('PRAGMA table_info(tasks)').all();
    const existingCols = new Set(tableInfo.map((c) => c.name));
    for (const col of [
      { name: 'deliverable_type', type: "TEXT NOT NULL DEFAULT ''" },
      { name: 'deliverable_url', type: "TEXT NOT NULL DEFAULT ''" },
      { name: 'deliverable_ref', type: "TEXT NOT NULL DEFAULT ''" },
      { name: 'workspace_path', type: "TEXT NOT NULL DEFAULT ''" },
      { name: 'branch_name', type: "TEXT NOT NULL DEFAULT ''" },
    ]) {
      if (!existingCols.has(col.name)) {
        this.db.exec(`ALTER TABLE tasks ADD COLUMN ${col.name} ${col.type}`);
      }
    }

    const defaultRuntimes = ['antigravity', 'claude-code', 'codex'];
    const insertRt = this.db.prepare(
      'INSERT OR IGNORE INTO runtime_health (runtime, status, quota_remaining, consecutive_failures, last_error_code, tripped_at) VALUES (?, ?, ?, 0, ?, ?)',
    );
    for (const rt of defaultRuntimes) {
      insertRt.run(rt, 'closed', 100, '', '');
    }
  }

  close() {
    this.db.close();
  }

  getRuntimeHealth(runtime) {
    return this.db.prepare('SELECT * FROM runtime_health WHERE runtime = ?').get(runtime) || null;
  }

  listRuntimeHealth() {
    return this.db.prepare('SELECT * FROM runtime_health ORDER BY runtime ASC').all();
  }

  setRuntimeQuota(runtime, quotaRemaining) {
    this.db
      .prepare('UPDATE runtime_health SET quota_remaining = ? WHERE runtime = ?')
      .run(quotaRemaining, runtime);
    return this.getRuntimeHealth(runtime);
  }

  tripRuntimeCircuit(runtime, errorCode, now = new Date().toISOString()) {
    this.db
      .prepare(`
        UPDATE runtime_health
        SET status = 'open',
            consecutive_failures = consecutive_failures + 1,
            last_error_code = ?,
            tripped_at = ?
        WHERE runtime = ?
      `)
      .run(String(errorCode), now, runtime);
    return this.getRuntimeHealth(runtime);
  }

  resetRuntimeCircuit(runtime) {
    this.db
      .prepare(`
        UPDATE runtime_health
        SET status = 'closed',
            consecutive_failures = 0,
            last_error_code = '',
            tripped_at = ''
        WHERE runtime = ?
      `)
      .run(runtime);
    return this.getRuntimeHealth(runtime);
  }

  getLastGoodDeploySha() {
    const row = this.db
      .prepare("SELECT commit_sha FROM deployments WHERE status = 'healthy' ORDER BY id DESC LIMIT 1")
      .get();
    return row ? row.commit_sha : '';
  }

  listDeployments() {
    return this.db.prepare('SELECT * FROM deployments ORDER BY id DESC').all();
  }

  getRepoEtag(repo) {
    const row = this.db.prepare('SELECT etag FROM repo_etags WHERE repo = ?').get(repo);
    return row ? row.etag : null;
  }

  setRepoEtag(repo, etag, now = new Date().toISOString()) {
    this.db
      .prepare(`
        INSERT INTO repo_etags (repo, etag, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(repo) DO UPDATE SET etag = excluded.etag, updated_at = excluded.updated_at
      `)
      .run(repo, String(etag || ''), now);
    return this.db.prepare('SELECT * FROM repo_etags WHERE repo = ?').get(repo);
  }

  listRepoEtags() {
    return this.db.prepare('SELECT * FROM repo_etags ORDER BY repo ASC').all();
  }

  /**
   * Evaluates all active tasks (`stage != 'done'` and `stage != 'aborted'`) against `stallThresholdMinutes`.
   * Records a deduplicated `task_stalled_alarm` telemetry event when a task crosses the stall threshold.
   */
  evaluateStalledTasks({ stallThresholdMinutes = 30, now = new Date() } = {}) {
    const threshold = Number(stallThresholdMinutes);
    if (!Number.isFinite(threshold) || threshold <= 0) {
      throw new Error('stallThresholdMinutes must be a positive number');
    }
    const nowDate = now instanceof Date ? now : new Date(now);
    const nowMs = nowDate.getTime();
    const nowIso = nowDate.toISOString();

    const activeTasks = this.db
      .prepare("SELECT * FROM tasks WHERE stage != 'done' AND stage != 'aborted' ORDER BY issue_number ASC")
      .all();

    const stalledTasks = [];
    for (const t of activeTasks) {
      const updatedMs = new Date(t.updated_at).getTime();
      const idleMinutes = Math.max(0, Math.floor((nowMs - updatedMs) / 60000));
      if (idleMinutes >= threshold) {
        const severity = idleMinutes >= threshold * 2 ? 'critical' : 'warning';
        const reason =
          t.needs_human === 1
            ? `Waiting for human gate approval at stage "${t.stage}" (${idleMinutes}m >= ${threshold}m)`
            : `Task stalled in stage "${t.stage}" without progress (${idleMinutes}m >= ${threshold}m)`;

        const existingAlarm = this.db
          .prepare(
            "SELECT id FROM telemetry_events WHERE execution_key = ? AND event_type = 'task_stalled_alarm' AND created_at >= ?",
          )
          .get(t.execution_key, t.updated_at);

        if (!existingAlarm) {
          this.recordEvent({
            executionKey: t.execution_key,
            issueNumber: t.issue_number,
            eventType: 'task_stalled_alarm',
            stage: t.stage,
            runtime: t.runtime,
            model: t.model,
            payload: { idleMinutes, stallThresholdMinutes: threshold, severity, reason },
            now: nowIso,
          });
        }

        stalledTasks.push({
          executionKey: t.execution_key,
          issueNumber: t.issue_number,
          repo: t.repo,
          title: t.title,
          type: t.type,
          stage: t.stage,
          needsHuman: Boolean(t.needs_human),
          idleMinutes,
          stallThresholdMinutes: threshold,
          severity,
          reason,
          updatedAt: t.updated_at,
        });
      }
    }

    return stalledTasks;
  }

  /**
   * Acknowledges / snoozes a stalled task alarm by refreshing `updated_at` and recording `alarm_acknowledged`.
   */
  acknowledgeTaskAlarm(
    executionKey,
    { actor = 'operator', note = 'Alarm acknowledged / snoozed', now = new Date().toISOString() } = {},
  ) {
    const task = this.getTask(executionKey);
    if (!task) return null;
    this.db.prepare('UPDATE tasks SET updated_at = ? WHERE execution_key = ?').run(now, executionKey);
    this.recordEvent({
      executionKey,
      issueNumber: task.issue_number,
      eventType: 'alarm_acknowledged',
      stage: task.stage,
      runtime: task.runtime,
      model: task.model,
      payload: { actor, note },
      now,
    });
    return this.getTask(executionKey);
  }

  verifyDeployment({
    executionKey,
    commitSha,
    errorRate = 0,
    maxErrorRate = 1.0,
    now = new Date().toISOString(),
  }) {
    const previousGoodSha = this.getLastGoodDeploySha();
    if (errorRate > maxErrorRate) {
      const reason = `error_rate ${errorRate}% exceeded threshold ${maxErrorRate}%`;
      this.db
        .prepare(
          'INSERT INTO deployments (execution_key, commit_sha, status, last_good_sha, violation_reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(executionKey, commitSha, 'rolled_back', previousGoodSha, reason, now);
      this.recordEvent({
        executionKey,
        eventType: 'deploy_rollback',
        stage: 'merge',
        payload: { commitSha, revertedToSha: previousGoodSha, errorRate, maxErrorRate, reason },
        now,
      });
      return {
        ok: true,
        status: 'rolled_back',
        rolledBack: true,
        commitSha,
        revertedToSha: previousGoodSha,
        last_good_sha: previousGoodSha,
        violationReason: reason,
      };
    }

    this.db
      .prepare(
        'INSERT INTO deployments (execution_key, commit_sha, status, last_good_sha, violation_reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(executionKey, commitSha, 'healthy', commitSha, '', now);
    this.recordEvent({
      executionKey,
      eventType: 'deploy_healthy',
      stage: 'merge',
      payload: { commitSha, errorRate, maxErrorRate },
      now,
    });
    return {
      ok: true,
      status: 'healthy',
      rolledBack: false,
      commitSha,
      revertedToSha: null,
      last_good_sha: commitSha,
      violationReason: '',
    };
  }

  reopenTaskFromAlert({
    executionKey,
    source = 'sentry',
    message,
    now = new Date().toISOString(),
  }) {
    const task = this.getTask(executionKey);
    if (!task) return null;
    this.recordEvent({
      executionKey,
      issueNumber: task.issue_number,
      eventType: 'production_alert_reopened',
      stage: 'triage',
      runtime: task.runtime,
      model: task.model,
      payload: { source, message },
      now,
    });
    return this.updateTaskStage(executionKey, {
      stage: 'triage',
      needsHuman: false,
      humanQuestion: `[${source}] ${message}`,
      now,
    });
  }

  getTask(executionKey) {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE execution_key = ?');
    return stmt.get(executionKey) || null;
  }

  hasActiveTask(executionKey) {
    const row = this.getTask(executionKey);
    return Boolean(row && row.stage !== 'done' && row.stage !== 'aborted');
  }

  countActiveTasks() {
    const stmt = this.db.prepare("SELECT COUNT(*) AS cnt FROM tasks WHERE stage != 'done' AND stage != 'aborted'");
    const row = stmt.get();
    return Number(row?.cnt || 0);
  }

  countTasksSince(isoTimestamp) {
    const stmt = this.db.prepare('SELECT COUNT(*) AS cnt FROM tasks WHERE created_at >= ?');
    const row = stmt.get(isoTimestamp);
    return Number(row?.cnt || 0);
  }

  sumSpendSince(isoTimestamp) {
    const stmt = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM telemetry_events WHERE created_at >= ?');
    const row = stmt.get(isoTimestamp);
    return Number(row?.total || 0);
  }

  createTask({
    executionKey,
    issueNumber,
    repo,
    title = '',
    type,
    stage = 'triage',
    impact = 'medium',
    runtime = 'antigravity',
    model = 'claude-sonnet',
    now = new Date().toISOString(),
  }) {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        execution_key, issue_number, repo, title, type, stage, impact, runtime, model,
        review_rounds, approved_first_round, needs_human, human_question,
        cost_usd, input_tokens, output_tokens, cached_tokens, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, '', 0, 0, 0, 0, ?, ?)
    `);
    stmt.run(executionKey, issueNumber, repo, title, type, stage, impact, runtime, model, now, now);
    this.recordEvent({
      executionKey,
      issueNumber,
      eventType: 'run_started',
      stage,
      runtime,
      model,
      now,
    });
    return this.getTask(executionKey);
  }

  updateTaskStage(executionKey, {
    stage,
    impact,
    runtime,
    model,
    needsHuman,
    humanQuestion,
    reviewRounds,
    approvedFirstRound,
    deliverableType,
    deliverableUrl,
    deliverableRef,
    workspacePath,
    branchName,
    now = new Date().toISOString(),
  }) {
    const current = this.getTask(executionKey);
    if (!current) throw new Error(`Task not found: ${executionKey}`);
    const nextStage = stage ?? current.stage;
    const nextImpact = impact ?? current.impact;
    const nextRuntime = runtime ?? current.runtime;
    const nextModel = model ?? current.model;
    const nextNeedsHuman = needsHuman !== undefined ? (needsHuman ? 1 : 0) : current.needs_human;
    const nextQuestion = humanQuestion !== undefined ? humanQuestion : current.human_question;
    const nextRounds = reviewRounds ?? current.review_rounds;
    const nextFirstRound = approvedFirstRound !== undefined ? (approvedFirstRound ? 1 : 0) : current.approved_first_round;
    const nextDelType = deliverableType !== undefined ? String(deliverableType || '') : current.deliverable_type;
    const nextDelUrl = deliverableUrl !== undefined ? String(deliverableUrl || '') : current.deliverable_url;
    const nextDelRef = deliverableRef !== undefined ? String(deliverableRef || '') : current.deliverable_ref;
    const nextWsPath = workspacePath !== undefined ? String(workspacePath || '') : current.workspace_path;
    const nextBranch = branchName !== undefined ? String(branchName || '') : current.branch_name;

    this.db
      .prepare(`
        UPDATE tasks
        SET stage = ?, impact = ?, runtime = ?, model = ?, needs_human = ?, human_question = ?,
            review_rounds = ?, approved_first_round = ?, deliverable_type = ?, deliverable_url = ?,
            deliverable_ref = ?, workspace_path = ?, branch_name = ?, updated_at = ?
        WHERE execution_key = ?
      `)
      .run(
        nextStage,
        nextImpact,
        nextRuntime,
        nextModel,
        nextNeedsHuman,
        nextQuestion,
        nextRounds,
        nextFirstRound,
        nextDelType,
        nextDelUrl,
        nextDelRef,
        nextWsPath,
        nextBranch,
        now,
        executionKey,
      );

    return this.getTask(executionKey);
  }

  attachTaskDeliverable(executionKey, { type = '', url = '', ref = '', now = new Date().toISOString() } = {}) {
    this.db
      .prepare('UPDATE tasks SET deliverable_type = ?, deliverable_url = ?, deliverable_ref = ?, updated_at = ? WHERE execution_key = ?')
      .run(String(type || ''), String(url || ''), String(ref || ''), now, executionKey);
    return this.getTask(executionKey);
  }

  attachTaskWorkspace(executionKey, { workspacePath = '', branchName = '', now = new Date().toISOString() } = {}) {
    this.db
      .prepare('UPDATE tasks SET workspace_path = ?, branch_name = ?, updated_at = ? WHERE execution_key = ?')
      .run(String(workspacePath || ''), String(branchName || ''), now, executionKey);
    return this.getTask(executionKey);
  }

  validateTaskDeliverable(task) {
    if (!task) return { ok: false, error: 'Task is required' };
    const taskType = String(task.type || '').toLowerCase();
    const dType = String(task.deliverable_type || '').toLowerCase();
    const dUrl = String(task.deliverable_url || '').trim();

    if (['feature', 'bug', 'chore'].includes(taskType)) {
      if (dType !== 'pull_request' || !dUrl) {
        return {
          ok: false,
          code: 'missing_deliverable',
          error: `Code workflow "${taskType}" requires an open Pull Request deliverable before transitioning to done`,
        };
      }
    } else if (['investigation', 'discovery'].includes(taskType)) {
      if (dType !== 'research_document' || !dUrl) {
        return {
          ok: false,
          code: 'missing_deliverable',
          error: `Analysis workflow "${taskType}" requires a research document or PRD deliverable before transitioning to done`,
        };
      }
    }

    return { ok: true, deliverableType: dType, deliverableUrl: dUrl };
  }

  issueStageToken(executionKey, stage, now = new Date().toISOString()) {
    const token = `st_${randomBytes(16).toString('hex')}`;
    this.db
      .prepare('INSERT INTO stage_tokens (token, execution_key, stage, used, created_at) VALUES (?, ?, ?, 0, ?)')
      .run(token, executionKey, stage, now);
    return token;
  }

  /**
   * Validates and consumes a single-use stage token (Felipe's 6 callback gates: returns 200 on first valid use,
   * 409 on replay or stage/task mismatch without advancing the state machine).
   */
  consumeStageToken({ token, executionKey, stage }) {
    if (!token || typeof token !== 'string') {
      return { status: 401, code: 'missing_token', ok: false };
    }
    const row = this.db.prepare('SELECT * FROM stage_tokens WHERE token = ?').get(token);
    if (!row) {
      return { status: 404, code: 'unknown_token', ok: false };
    }
    if (row.execution_key !== executionKey) {
      return { status: 409, code: 'token_task_mismatch', ok: false };
    }
    if (row.stage !== stage) {
      return { status: 409, code: 'token_stage_mismatch', ok: false };
    }
    if (row.used === 1) {
      return { status: 409, code: 'token_already_used', ok: false };
    }
    this.db.prepare('UPDATE stage_tokens SET used = 1 WHERE token = ?').run(token);
    return { status: 200, code: 'accepted', ok: true };
  }

  recordEvent(
    {
      executionKey,
      issueNumber = 0,
      eventType,
      stage = '',
      runtime = '',
      model = '',
      inputTokens = 0,
      outputTokens = 0,
      cachedTokens = 0,
      explicitCostUsd = null,
      durationMs = 0,
      payload = {},
      now = new Date().toISOString(),
    },
    pricesConfig = null,
  ) {
    const costUsd = calculateUsageCostUsd(
      { model, inputTokens, outputTokens, cachedTokens, explicitCostUsd },
      pricesConfig,
    );

    this.db
      .prepare(`
        INSERT INTO telemetry_events (
          execution_key, issue_number, event_type, stage, runtime, model,
          input_tokens, output_tokens, cached_tokens, cost_usd, duration_ms, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        executionKey,
        issueNumber,
        eventType,
        stage,
        runtime,
        model,
        inputTokens,
        outputTokens,
        cachedTokens,
        costUsd,
        durationMs,
        JSON.stringify(payload || {}),
        now,
      );

    if (inputTokens > 0 || outputTokens > 0 || cachedTokens > 0 || costUsd > 0) {
      this.db
        .prepare(`
          UPDATE tasks
          SET input_tokens = input_tokens + ?,
              output_tokens = output_tokens + ?,
              cached_tokens = cached_tokens + ?,
              cost_usd = ROUND(cost_usd + ?, 6),
              updated_at = ?
          WHERE execution_key = ?
        `)
        .run(inputTokens, outputTokens, cachedTokens, costUsd, now, executionKey);
    }

    return { costUsd, inputTokens, outputTokens, cachedTokens };
  }

  getStatusSummary({ stallThresholdMinutes = 30, now = new Date() } = {}) {
    const tasks = this.db.prepare('SELECT * FROM tasks ORDER BY issue_number ASC').all();
    const events = this.db.prepare('SELECT * FROM telemetry_events ORDER BY id ASC').all();
    const stalledTasks = this.evaluateStalledTasks({ stallThresholdMinutes, now });

    const byStage = {};
    const byType = {};
    const byRuntime = {};
    const byModel = {};
    const needsHumanQueue = [];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCachedTokens = 0;
    let totalCostUsd = 0;
    let reviewedTasksCount = 0;
    let totalReviewRounds = 0;
    let firstRoundApprovedCount = 0;

    for (const t of tasks) {
      byStage[t.stage] = (byStage[t.stage] || 0) + 1;
      byType[t.type] = (byType[t.type] || 0) + 1;
      totalInputTokens += t.input_tokens;
      totalOutputTokens += t.output_tokens;
      totalCachedTokens += t.cached_tokens;
      totalCostUsd += t.cost_usd;

      if (t.review_rounds > 0) {
        reviewedTasksCount += 1;
        totalReviewRounds += t.review_rounds;
        if (t.approved_first_round === 1) {
          firstRoundApprovedCount += 1;
        }
      }

      if (t.needs_human === 1) {
        needsHumanQueue.push({
          executionKey: t.execution_key,
          issueNumber: t.issue_number,
          repo: t.repo,
          type: t.type,
          stage: t.stage,
          question: t.human_question,
        });
      }
    }

    for (const ev of events) {
      if (ev.runtime) {
        const r = byRuntime[ev.runtime] || { events: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0 };
        r.events += 1;
        r.inputTokens += ev.input_tokens;
        r.outputTokens += ev.output_tokens;
        r.cachedTokens += ev.cached_tokens;
        r.costUsd = Number((r.costUsd + ev.cost_usd).toFixed(6));
        byRuntime[ev.runtime] = r;
      }
      if (ev.model) {
        const m = byModel[ev.model] || { events: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0 };
        m.events += 1;
        m.inputTokens += ev.input_tokens;
        m.outputTokens += ev.output_tokens;
        m.cachedTokens += ev.cached_tokens;
        m.costUsd = Number((m.costUsd + ev.cost_usd).toFixed(6));
        byModel[ev.model] = m;
      }
    }

    return {
      ok: true,
      totalTasks: tasks.length,
      activeTasksCount: this.countActiveTasks(),
      byStage,
      byType,
      tokens: {
        input: totalInputTokens,
        output: totalOutputTokens,
        cached: totalCachedTokens,
        total: totalInputTokens + totalOutputTokens,
      },
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      reviewMetrics: {
        reviewedTasks: reviewedTasksCount,
        averageReviewRounds: reviewedTasksCount > 0 ? Number((totalReviewRounds / reviewedTasksCount).toFixed(2)) : 0,
        firstRoundApprovalRate:
          reviewedTasksCount > 0 ? Number(((firstRoundApprovedCount / reviewedTasksCount) * 100).toFixed(2)) : 0,
      },
      byRuntime,
      byModel,
      needsHuman: needsHumanQueue,
      stalledCount: stalledTasks.length,
      stalledTasks,
      tasks,
    };
  }
}
