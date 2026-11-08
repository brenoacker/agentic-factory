import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadAndValidateFactory } from './config.mjs';
import { SUPPORTED_PROVIDERS, normalizeTriggerRules, pollProjectTracker, syncTaskStateToTracker } from './trackers.mjs';
import { intakeAndTriageTicket, advanceTicketInPanel } from './pipeline.mjs';
import { checkGitHubPullRequest, commentOnGitHubIssue, closeGitHubIssue, updateGitHubIssue } from './github.mjs';
import { cleanupTaskWorkspace } from './worktree.mjs';

const REPO_RE = /^[^/\s]+\/[^/\s]+$/;

function saveFactoryYaml(rootDir, factoryConfig) {
  const filePath = join(resolve(rootDir), 'factory.yaml');
  writeFileSync(
    filePath,
    `# Factory as Code configuration (YAML 1.2 JSON-compatible subset)\n${JSON.stringify(factoryConfig, null, 2)}\n`,
    'utf8',
  );
}

/**
 * Returns the list of monitored projects from `factory.yaml` (`factory.projects`).
 */
export function listMonitoredProjects(rootDir) {
  const cfg = loadAndValidateFactory(rootDir);
  const raw = Array.isArray(cfg.factoryConfig?.factory?.projects) ? cfg.factoryConfig.factory.projects : [];
  return raw.map((p) => ({
    ...p,
    provider: p.provider || 'github',
    trackerConfig: p.trackerConfig || {},
  }));
}

/**
 * Adds or updates a monitored project (`github`, `jira`, or `asana`) in `factory.yaml`.
 */
export function upsertMonitoredProject(
  rootDir,
  {
    repo,
    id = null,
    provider = 'github',
    defaultBranch = 'main',
    localPath = '',
    trackerConfig = {},
    paused = false,
  } = {},
) {
  const cleanRepo = String(repo || '').trim();
  if (!REPO_RE.test(cleanRepo)) {
    return {
      ok: false,
      status: 400,
      error: 'repo must match "owner/name" format (e.g. "brenoacker/my-app")',
    };
  }

  const cleanProvider = String(provider || 'github').trim().toLowerCase();
  if (!SUPPORTED_PROVIDERS.includes(cleanProvider)) {
    return {
      ok: false,
      status: 400,
      error: `Unsupported provider "${provider}". Must be one of: ${SUPPORTED_PROVIDERS.join(', ')}`,
    };
  }

  const normalizedTrackerConfig =
    trackerConfig && typeof trackerConfig === 'object' ? { ...trackerConfig } : {};
  const triggerRules = normalizeTriggerRules(normalizedTrackerConfig, cleanProvider);

  if (cleanProvider === 'jira') {
    const projectKey = String(normalizedTrackerConfig.projectKey || '').trim();
    const jql = String(normalizedTrackerConfig.jql || '').trim();
    if (!projectKey && !jql) {
      return {
        ok: false,
        status: 400,
        error: 'Jira provider requires trackerConfig.projectKey (e.g. "FAC") or trackerConfig.jql',
      };
    }
    normalizedTrackerConfig.projectKey = projectKey || 'JIRA';
  } else if (cleanProvider === 'asana') {
    const projectGid = String(normalizedTrackerConfig.projectGid || '').trim();
    if (!projectGid) {
      return {
        ok: false,
        status: 400,
        error: 'Asana provider requires trackerConfig.projectGid (e.g. "120055")',
      };
    }
    normalizedTrackerConfig.projectGid = projectGid;
  } else if (cleanProvider === 'linear') {
    const projectKey = String(
      normalizedTrackerConfig.projectKey ||
        normalizedTrackerConfig.projectId ||
        cleanRepo.split('/')[1] ||
        cleanRepo,
    ).trim();
    normalizedTrackerConfig.projectKey = projectKey;
  }

  if (triggerRules.statuses.length > 0) {
    normalizedTrackerConfig.statuses = triggerRules.statuses;
    normalizedTrackerConfig.statusFilter = triggerRules.statusFilter;
  }
  if (triggerRules.requiredLabels.length > 0) {
    normalizedTrackerConfig.requiredLabels = triggerRules.requiredLabels;
  }
  if (triggerRules.excludedLabels.length > 0) {
    normalizedTrackerConfig.excludedLabels = triggerRules.excludedLabels;
  }
  if (Object.keys(triggerRules.requiredCustomFields).length > 0) {
    normalizedTrackerConfig.requiredCustomFields = triggerRules.requiredCustomFields;
  }
  if (triggerRules.assigneeFilter && triggerRules.assigneeFilter !== 'any') {
    normalizedTrackerConfig.assigneeFilter = triggerRules.assigneeFilter;
  }

  const cfg = loadAndValidateFactory(rootDir);
  const updatedCfg = structuredClone(cfg.factoryConfig);
  if (!Array.isArray(updatedCfg.factory.projects)) {
    updatedCfg.factory.projects = [];
  }

  const derivedId = String(id || `${cleanProvider}-${cleanRepo.split('/')[1] || cleanRepo}`).trim();
  const existingIdx = updatedCfg.factory.projects.findIndex(
    (p) =>
      (p.repo.toLowerCase() === cleanRepo.toLowerCase() &&
        String(p.provider || 'github').toLowerCase() === cleanProvider) ||
      p.id === derivedId,
  );

  const projectEntry = {
    id: id ? String(id).trim() : existingIdx >= 0 ? updatedCfg.factory.projects[existingIdx].id : cleanRepo.split('/')[1] || derivedId,
    repo: cleanRepo,
    provider: cleanProvider,
    defaultBranch: String(defaultBranch || 'main').trim(),
    ...(localPath ? { localPath: String(localPath).trim() } : {}),
    ...(Object.keys(normalizedTrackerConfig).length > 0
      ? { trackerConfig: normalizedTrackerConfig }
      : {}),
    paused: Boolean(paused),
  };

  let status = 201;
  if (existingIdx >= 0) {
    updatedCfg.factory.projects[existingIdx] = {
      ...updatedCfg.factory.projects[existingIdx],
      ...projectEntry,
    };
    status = 200;
  } else {
    updatedCfg.factory.projects.push(projectEntry);
  }

  saveFactoryYaml(rootDir, updatedCfg);
  return {
    ok: true,
    status,
    project: projectEntry,
    projects: updatedCfg.factory.projects,
  };
}

/**
 * Removes a monitored project from `factory.yaml` by `owner/repo` or `id`.
 */
export function removeMonitoredProject(rootDir, repoOrId) {
  const target = String(repoOrId || '').trim().toLowerCase();
  if (!target) {
    return { ok: false, status: 400, error: 'repo or id is required' };
  }

  const cfg = loadAndValidateFactory(rootDir);
  const updatedCfg = structuredClone(cfg.factoryConfig);
  const list = Array.isArray(updatedCfg.factory.projects) ? updatedCfg.factory.projects : [];
  const idx = list.findIndex((p) => p.repo.toLowerCase() === target || String(p.id).toLowerCase() === target);
  if (idx < 0) {
    return { ok: false, status: 404, error: `Monitored repository not found: ${repoOrId}` };
  }

  const [removed] = list.splice(idx, 1);
  updatedCfg.factory.projects = list;
  saveFactoryYaml(rootDir, updatedCfg);

  return {
    ok: true,
    status: 200,
    removed,
    projects: list,
  };
}

/**
 * Polls open issues/tickets across all active (`paused !== true`) monitored projects (`github`, `jira`, `asana`)
 * in `factory.yaml`, caching ETag/cursor state in SQLite (`repo_etags`) and intaking newly discovered tickets.
 */
export function syncMonitoredProjectsIssues({ rootDir, store, runner = null, autoDispatch = false }) {
  const cfg = loadAndValidateFactory(rootDir);
  const projects = Array.isArray(cfg.factoryConfig?.factory?.projects) ? cfg.factoryConfig.factory.projects : [];
  const results = [];
  const newTasks = [];
  let polledRepos = 0;
  let skippedNotModified = 0;
  let skippedByTriggersCount = 0;

  for (const proj of projects) {
    const provider = String(proj.provider || 'github').toLowerCase();
    if (proj.paused === true) {
      results.push({ repo: proj.repo, provider, status: 'paused', intaked: 0, skippedByTriggersCount: 0 });
      continue;
    }

    polledRepos += 1;
    const etagKey = provider === 'github' ? proj.repo : `${provider}:${proj.repo}`;
    const previousEtag = store.getRepoEtag(etagKey);
    const polled = pollProjectTracker({
      project: { ...proj, provider },
      etag: previousEtag,
      runner,
    });

    if (polled.etag) {
      store.setRepoEtag(etagKey, polled.etag);
    }

    if (polled.notModified) {
      skippedNotModified += 1;
      results.push({
        repo: proj.repo,
        provider,
        status: 'not_modified',
        intaked: 0,
        skippedByTriggersCount: 0,
        etag: polled.etag,
      });
      continue;
    }

    const repoSkippedCount = Number(polled.skippedByTriggersCount || 0);
    skippedByTriggersCount += repoSkippedCount;

    let intakedForRepo = 0;
    for (const issue of polled.issues) {
      const hasExplicitTypeLabel = Array.isArray(issue.labels) && issue.labels.some((l) => String(l).startsWith('type:'));
      const intakeRes = intakeAndTriageTicket({
        issue: {
          ...issue,
          type: hasExplicitTypeLabel ? issue.type : null,
          repo: proj.repo,
          provider: proj.provider || issue.provider,
        },
        factoryConfig: cfg.factoryConfig,
        workflows: cfg.workflows,
        store,
        trackerRunner: runner,
      });
      if (intakeRes.ok) {
        intakedForRepo += 1;
        newTasks.push(intakeRes.task);
      }
    }

    results.push({
      repo: proj.repo,
      provider,
      status: 'polled',
      issuesFound: polled.issues.length,
      intaked: intakedForRepo,
      skippedByTriggersCount: repoSkippedCount,
      skippedByTriggers: polled.skippedByTriggers || [],
      etag: polled.etag || '',
    });
  }

  let autoDispatchReport = null;
  if (autoDispatch !== false) {
    try {
      autoDispatchReport = autoDispatchQueuedTasks({ rootDir, store, trackerRunner: runner });
    } catch {
      // Non-blocking fallback
    }
  }

  let mergedReport = null;
  try {
    mergedReport = syncMergedPullRequests({ rootDir, store, runner, trackerRunner: runner });
  } catch {
    // Non-blocking fallback
  }

  return {
    ok: true,
    polledRepos,
    skippedNotModified,
    skippedByTriggersCount,
    newTasksCount: newTasks.length,
    newTasks,
    autoDispatchedCount: autoDispatchReport?.autoDispatchedCount || 0,
    dispatchedTasks: autoDispatchReport?.dispatchedTasks || [],
    mergedTasksCount: mergedReport?.mergedTasksCount || 0,
    mergedTasks: mergedReport?.mergedTasks || [],
    results,
  };
}

/**
 * Automatically inspects active tasks in stage `merge`, checks live Pull Request status via GitHub,
 * and advances merged PRs to `done`, commenting on and closing the issue on GitHub.
 */
export function syncMergedPullRequests({ rootDir, store, runner = null, trackerRunner = null }) {
  const tasksInMerge = store.db
    .prepare("SELECT * FROM tasks WHERE stage = 'merge' AND deliverable_type = 'pull_request' AND deliverable_url IS NOT NULL")
    .all();

  const activeRunner = trackerRunner || runner;
  const mergedTasks = [];

  for (const task of tasksInMerge) {
    try {
      const prCheck = checkGitHubPullRequest({
        repo: task.repo,
        prNumberOrUrl: task.deliverable_url,
        runner: activeRunner,
      });

      if (prCheck.ok && prCheck.merged) {
        store.updateTaskStage(task.execution_key, {
          stage: 'done',
          needsHuman: false,
          humanQuestion: '',
        });

        store.recordEvent({
          executionKey: task.execution_key,
          issueNumber: task.issue_number,
          eventType: 'pr_merged',
          stage: 'merge',
          runtime: task.runtime,
          model: task.model,
          payload: { prNumber: prCheck.prNumber, prUrl: prCheck.url, mergedAt: prCheck.mergedAt },
        });

        store.recordEvent({
          executionKey: task.execution_key,
          issueNumber: task.issue_number,
          eventType: 'completed',
          stage: 'done',
          runtime: task.runtime,
          model: task.model,
          payload: { deliverableUrl: task.deliverable_url, deliverableType: task.deliverable_type },
        });

        syncTaskStateToTracker({
          task: store.getTask(task.execution_key),
          store,
          runner: activeRunner,
        });

        mergedTasks.push(store.getTask(task.execution_key));

        // Safe lifecycle cleanup: remove temp workspace upon verified PR merge
        if (task.workspace_path) {
          cleanupTaskWorkspace(task.workspace_path);
        }
      }
    } catch {
      // Non-blocking telemetry
    }
  }

  return {
    ok: true,
    checkedCount: tasksInMerge.length,
    mergedTasksCount: mergedTasks.length,
    mergedTasks,
  };
}

/**
 * Automatically dispatches eligible queued tasks in `triage` up to available executing capacity (`maxConcurrentAgents - countExecutingAgents()`).
 */
export function autoDispatchQueuedTasks({
  rootDir,
  store,
  runner = null,
  trackerRunner = null,
  maxToDispatch = null,
}) {
  const cfg = loadAndValidateFactory(rootDir);
  const maxConcurrent = cfg.factoryConfig?.factory?.limits?.maxConcurrentAgents ?? 3;
  const executingCount =
    typeof store.countExecutingAgents === 'function' ? store.countExecutingAgents() : store.countActiveTasks();

  const availableSlots = Math.max(0, maxConcurrent - executingCount);
  const limit = maxToDispatch !== null ? Math.min(availableSlots, Number(maxToDispatch)) : availableSlots;

  if (limit <= 0) {
    return {
      ok: true,
      autoDispatchedCount: 0,
      dispatchedTasks: [],
      availableSlots,
      executingCount,
    };
  }

  const queuedTasks = store.db
    .prepare(
      "SELECT * FROM tasks WHERE stage IN ('triage', 'plan', 'checks_and_build', 'verify', 'review') AND needs_human = 0 ORDER BY created_at ASC LIMIT ?",
    )
    .all(limit);

  const dispatchedTasks = [];
  for (const t of queuedTasks) {
    const res = advanceTicketInPanel({
      executionKey: t.execution_key,
      factoryRoot: rootDir,
      factoryConfig: cfg.factoryConfig,
      workflows: cfg.workflows,
      pricesConfig: cfg.pricesConfig,
      store,
      approveCurrentStage: false,
      runner,
      trackerRunner,
    });
    if (res.ok) {
      dispatchedTasks.push(res.task);
    }
  }

  return {
    ok: true,
    autoDispatchedCount: dispatchedTasks.length,
    dispatchedTasks,
    availableSlots: Math.max(0, availableSlots - dispatchedTasks.length),
    executingCount:
      typeof store.countExecutingAgents === 'function' ? store.countExecutingAgents() : store.countActiveTasks(),
  };
}

/**
 * Creates a configurable periodic polling scheduler (cron/interval loop) that syncs GitHub, Jira, and Asana projects.
 */
export function createPollingScheduler({
  rootDir,
  store,
  getRunner = null,
  defaultIntervalSeconds = 60,
  defaultEnabled = true,
}) {
  let enabled = defaultEnabled !== undefined ? Boolean(defaultEnabled) : true;
  let intervalSeconds = Number(defaultIntervalSeconds) || 60;
  let pollCount = 0;
  let lastPollAt = null;
  let lastResult = null;
  let timer = null;

  function runOnce() {
    try {
      const runner = typeof getRunner === 'function' ? getRunner() : null;
      const res = syncMonitoredProjectsIssues({ rootDir, store, runner, autoDispatch: true });
      pollCount += 1;
      lastPollAt = new Date().toISOString();
      lastResult = {
        polledRepos: res.polledRepos,
        newTasksCount: res.newTasksCount,
        autoDispatchedCount: res.autoDispatchedCount || 0,
        mergedTasksCount: res.mergedTasksCount || 0,
      };
      return res;
    } catch (err) {
      pollCount += 1;
      lastPollAt = new Date().toISOString();
      lastResult = { error: err.message };
      return null;
    }
  }

  function restartTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (enabled) {
      timer = setInterval(runOnce, intervalSeconds * 1000);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    }
  }

  function getState() {
    return {
      enabled,
      intervalSeconds,
      pollCount,
      lastPollAt,
      lastResult,
    };
  }

  function configure({
    enabled: nextEnabled,
    intervalSeconds: nextInterval,
    runImmediately = false,
  } = {}) {
    if (nextInterval !== undefined) {
      const parsed = Number(nextInterval);
      if (!Number.isFinite(parsed) || parsed < 5 || parsed > 86400) {
        return {
          ok: false,
          status: 400,
          error: 'intervalSeconds must be a number between 5 and 86400',
        };
      }
      intervalSeconds = Math.round(parsed);
    }
    if (nextEnabled !== undefined) {
      enabled = Boolean(nextEnabled);
    }
    restartTimer();
    let syncReport = null;
    if (runImmediately) {
      syncReport = runOnce();
    }
    return {
      ok: true,
      status: 200,
      scheduler: getState(),
      ...(syncReport ? { syncReport } : {}),
    };
  }

  function stop() {
    enabled = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  if (enabled) {
    restartTimer();
  }

  return {
    getState,
    configure,
    runOnce,
    stop,
  };
}
