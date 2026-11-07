import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadAndValidateFactory } from './config.mjs';
import { pollIssuesWithEtag } from './github.mjs';
import { intakeAndTriageTicket } from './pipeline.mjs';

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
 * Returns the list of monitored GitHub repositories from `factory.yaml` (`factory.projects`).
 */
export function listMonitoredProjects(rootDir) {
  const cfg = loadAndValidateFactory(rootDir);
  return Array.isArray(cfg.factoryConfig?.factory?.projects) ? cfg.factoryConfig.factory.projects : [];
}

/**
 * Adds a new monitored GitHub repository (`owner/repo`) or updates an existing entry in `factory.yaml`.
 */
export function upsertMonitoredProject(
  rootDir,
  { repo, id = null, defaultBranch = 'main', localPath = '', paused = false } = {},
) {
  const cleanRepo = String(repo || '').trim();
  if (!REPO_RE.test(cleanRepo)) {
    return {
      ok: false,
      status: 400,
      error: 'repo must match "owner/name" format (e.g. "brenoacker/my-app")',
    };
  }

  const cfg = loadAndValidateFactory(rootDir);
  const updatedCfg = structuredClone(cfg.factoryConfig);
  if (!Array.isArray(updatedCfg.factory.projects)) {
    updatedCfg.factory.projects = [];
  }

  const derivedId = String(id || cleanRepo.split('/')[1] || cleanRepo).trim();
  const existingIdx = updatedCfg.factory.projects.findIndex(
    (p) => p.repo.toLowerCase() === cleanRepo.toLowerCase() || p.id === derivedId,
  );

  const projectEntry = {
    id: derivedId,
    repo: cleanRepo,
    defaultBranch: String(defaultBranch || 'main').trim(),
    ...(localPath ? { localPath: String(localPath).trim() } : {}),
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
 * Removes a monitored GitHub repository from `factory.yaml` by `owner/repo` or `id`.
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
 * Polls open GitHub issues across all active (`paused !== true`) monitored repositories in `factory.yaml`,
 * caching ETag headers per repository in SQLite (`repo_etags`) and intaking newly discovered issues.
 */
export function syncMonitoredProjectsIssues({ rootDir, store, runner = null }) {
  const cfg = loadAndValidateFactory(rootDir);
  const projects = Array.isArray(cfg.factoryConfig?.factory?.projects) ? cfg.factoryConfig.factory.projects : [];
  const results = [];
  const newTasks = [];
  let polledRepos = 0;
  let skippedNotModified = 0;

  for (const proj of projects) {
    if (proj.paused === true) {
      results.push({ repo: proj.repo, status: 'paused', intaked: 0 });
      continue;
    }

    polledRepos += 1;
    const previousEtag = store.getRepoEtag(proj.repo);
    const polled = pollIssuesWithEtag({
      repo: proj.repo,
      etag: previousEtag,
      runner,
    });

    if (polled.etag) {
      store.setRepoEtag(proj.repo, polled.etag);
    }

    if (polled.notModified) {
      skippedNotModified += 1;
      results.push({ repo: proj.repo, status: 'not_modified', intaked: 0, etag: polled.etag });
      continue;
    }

    let intakedForRepo = 0;
    for (const issue of polled.issues) {
      const hasExplicitTypeLabel = Array.isArray(issue.labels) && issue.labels.some((l) => String(l).startsWith('type:'));
      const intakeRes = intakeAndTriageTicket({
        issue: {
          ...issue,
          type: hasExplicitTypeLabel ? issue.type : null,
          repo: proj.repo,
        },
        factoryConfig: cfg.factoryConfig,
        workflows: cfg.workflows,
        store,
      });
      if (intakeRes.ok) {
        intakedForRepo += 1;
        newTasks.push(intakeRes.task);
      }
    }

    results.push({
      repo: proj.repo,
      status: 'polled',
      issuesFound: polled.issues.length,
      intaked: intakedForRepo,
      etag: polled.etag || '',
    });
  }

  return {
    ok: true,
    polledRepos,
    skippedNotModified,
    newTasksCount: newTasks.length,
    newTasks,
    results,
  };
}
