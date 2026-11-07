import http from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  loadAndValidateFactory,
  validateWorkflowObject,
  FactoryStore,
  approveTask,
  intakeAndTriageTicket,
  advanceTicketInPanel,
  listMonitoredProjects,
  upsertMonitoredProject,
  removeMonitoredProject,
  syncMonitoredProjectsIssues,
  createPollingScheduler,
} from '../../packages/core/index.mjs';
import { listAgentsCatalog, loadBrainEntries } from '../../packages/core/src/brain.mjs';

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data.trim()) return resolveBody({});
      try {
        resolveBody(JSON.parse(data));
      } catch (err) {
        rejectBody(err);
      }
    });
    req.on('error', rejectBody);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/**
 * Creates the local Control Panel HTTP server (`apps/panel/server.mjs`).
 */
export function createPanelServer({
  rootDir = resolve(import.meta.dirname, '..', '..'),
  dbPath = null,
  issuePollRunner = null,
} = {}) {
  const root = resolve(rootDir);
  const resolvedDbPath = dbPath || join(root, 'runs', 'factory.db');
  const store = new FactoryStore(resolvedDbPath);
  const scheduler = createPollingScheduler({
    rootDir: root,
    store,
    getRunner: () => issuePollRunner,
    defaultIntervalSeconds: 60,
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    try {
      // 1. Static Control Panel HTML UI & AWS Cloudscape Bundle
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        const htmlPath = join(import.meta.dirname, 'public', 'index.html');
        const html = existsSync(htmlPath)
          ? readFileSync(htmlPath, 'utf8')
          : '<!doctype html><html><body><h1>Agentic Factory Control Panel</h1></body></html>';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (req.method === 'GET' && pathname === '/bundle.js') {
        const jsPath = join(import.meta.dirname, 'public', 'bundle.js');
        if (existsSync(jsPath)) {
          res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
          res.end(readFileSync(jsPath));
          return;
        }
      }

      if (req.method === 'GET' && pathname === '/bundle.css') {
        const cssPath = join(import.meta.dirname, 'public', 'bundle.css');
        if (existsSync(cssPath)) {
          res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
          res.end(readFileSync(cssPath));
          return;
        }
      }

      // 2. GET /api/dashboard
      if (req.method === 'GET' && pathname === '/api/dashboard') {
        const cfg = loadAndValidateFactory(root);
        const lockPath = join(root, 'skills.lock.json');
        const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : { skills: [] };
        const stallThresholdMinutes = cfg.factoryConfig?.factory?.limits?.stallThresholdMinutes ?? 30;
        const status = store.getStatusSummary({ stallThresholdMinutes });
        const agents = listAgentsCatalog(root);
        const brain = loadBrainEntries(root);
        const runtimeHealth = store.listRuntimeHealth();
        const deployments = store.listDeployments();
        const projects = listMonitoredProjects(root);
        const repoEtags = store.listRepoEtags();

        sendJson(res, 200, {
          ok: true,
          status,
          factoryConfig: cfg.factoryConfig,
          projects,
          repoEtags,
          scheduler: scheduler.getState(),
          pricesConfig: cfg.pricesConfig,
          workflows: cfg.workflows,
          skills: lock.skills,
          agents,
          brain,
          runtimeHealth,
          deployments,
          integrations: [
            { id: 'github', name: 'GitHub Issues & PRs (Multi-Repo ETag Polling)', status: 'connected' },
            { id: 'jira', name: 'Jira Issues (Custom Project Key, Status & JQL Poller)', status: 'connected' },
            { id: 'asana', name: 'Asana Tasks (Custom Project GID & Section/Status Poller)', status: 'connected' },
            { id: 'sentry', name: 'Sentry Production Alerts Webhook', status: 'ready' },
            { id: 'posthog', name: 'PostHog Post-Deploy Metrics', status: 'ready' },
          ],
        });
        return;
      }

      // 2b. GET / POST / DELETE /api/projects, POST /api/projects/sync & POST /api/scheduler
      if (req.method === 'GET' && pathname === '/api/projects') {
        sendJson(res, 200, {
          ok: true,
          projects: listMonitoredProjects(root),
          etags: store.listRepoEtags(),
          scheduler: scheduler.getState(),
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/projects') {
        const body = await readJsonBody(req);
        const projRes = upsertMonitoredProject(root, {
          repo: body.repo,
          id: body.id,
          provider: body.provider || 'github',
          defaultBranch: body.defaultBranch || 'main',
          localPath: body.localPath || '',
          trackerConfig: body.trackerConfig || {},
          paused: Boolean(body.paused),
        });
        sendJson(res, projRes.status, projRes);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/projects/sync') {
        const syncRes = syncMonitoredProjectsIssues({
          rootDir: root,
          store,
          runner: issuePollRunner,
        });
        sendJson(res, 200, syncRes);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/scheduler') {
        const body = await readJsonBody(req);
        const schedRes = scheduler.configure({
          enabled: body.enabled,
          intervalSeconds: body.intervalSeconds,
          runImmediately: Boolean(body.runImmediately),
        });
        sendJson(res, schedRes.status, schedRes);
        return;
      }

      const delProjMatch = pathname.match(/^\/api\/projects\/(.+)$/);
      if (req.method === 'DELETE' && delProjMatch) {
        const targetRepo = decodeURIComponent(delProjMatch[1]);
        const delRes = removeMonitoredProject(root, targetRepo);
        sendJson(res, delRes.status, delRes);
        return;
      }

      // 3. POST /api/tasks/:key/approve & POST /api/tasks/:key/acknowledge & GET /api/alarms/stalled
      if (req.method === 'GET' && pathname === '/api/alarms/stalled') {
        const cfg = loadAndValidateFactory(root);
        const rawParam = url.searchParams.get('thresholdMinutes');
        const threshold =
          rawParam !== null ? Number(rawParam) : Number(cfg.factoryConfig?.factory?.limits?.stallThresholdMinutes ?? 30);
        if (!Number.isFinite(threshold) || threshold <= 0) {
          sendJson(res, 400, { ok: false, error: 'thresholdMinutes must be a positive number' });
          return;
        }
        const stalledTasks = store.evaluateStalledTasks({ stallThresholdMinutes: threshold });
        sendJson(res, 200, {
          ok: true,
          stallThresholdMinutes: threshold,
          stalledCount: stalledTasks.length,
          stalledTasks,
        });
        return;
      }

      const ackMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/acknowledge$/);
      if (req.method === 'POST' && ackMatch) {
        const executionKey = decodeURIComponent(ackMatch[1]);
        const body = await readJsonBody(req);
        const updated = store.acknowledgeTaskAlarm(executionKey, {
          actor: body.actor || 'panel-operator',
          note: body.note || 'Acknowledged in Control Panel',
        });
        if (!updated) {
          sendJson(res, 404, { ok: false, error: `Task not found: ${executionKey}` });
          return;
        }
        sendJson(res, 200, { ok: true, task: updated });
        return;
      }

      const approveMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/approve$/);
      if (req.method === 'POST' && approveMatch) {
        const executionKey = decodeURIComponent(approveMatch[1]);
        const existing = store.getTask(executionKey);
        if (!existing) {
          sendJson(res, 404, { ok: false, error: `Task not found: ${executionKey}` });
          return;
        }
        const body = await readJsonBody(req);
        const updated = approveTask(store, executionKey, {
          approver: body.approver || 'panel-operator',
          words: body.words || 'approved via control panel',
        });
        sendJson(res, 200, { ok: true, task: updated });
        return;
      }

      // 4. POST /api/alerts/production
      if (req.method === 'POST' && pathname === '/api/alerts/production') {
        const body = await readJsonBody(req);
        if (!body.executionKey || !body.message) {
          sendJson(res, 400, { ok: false, error: 'executionKey and message are required' });
          return;
        }
        const reopened = store.reopenTaskFromAlert({
          executionKey: body.executionKey,
          source: body.source || 'sentry',
          message: body.message,
        });
        if (!reopened) {
          sendJson(res, 404, { ok: false, error: `Task not found: ${body.executionKey}` });
          return;
        }
        sendJson(res, 200, { ok: true, task: reopened });
        return;
      }

      // 5. POST /api/workflows/:id
      const wfMatch = pathname.match(/^\/api\/workflows\/([a-z0-9_-]+)$/i);
      if (req.method === 'POST' && wfMatch) {
        const wfId = wfMatch[1];
        let body;
        try {
          body = await readJsonBody(req);
        } catch {
          sendJson(res, 400, { ok: false, error: 'Malformed JSON body' });
          return;
        }
        if (!body || typeof body.workflow !== 'object' || Array.isArray(body.workflow)) {
          sendJson(res, 400, { ok: false, error: 'Missing workflow object in request body' });
          return;
        }

        const cfg = loadAndValidateFactory(root);
        const lockedSet = new Set(cfg.lockedSkills);
        const check = validateWorkflowObject(body.workflow, lockedSet, `${wfId}.yaml`);
        if (!check.ok) {
          sendJson(res, 422, { ok: false, errors: check.errors });
          return;
        }

        const wfPath = join(root, 'workflows', `${wfId}.yaml`);
        const header = `# ${wfId} ticket workflow (updated via Control Panel)\n`;
        writeFileSync(wfPath, `${header}${JSON.stringify(body.workflow, null, 2)}\n`, 'utf8');

        let committed = false;
        let commitSha = null;
        if (body.commit === true && existsSync(join(root, '.git'))) {
          const msg = body.commitMessage || `chore(workflows): update ${wfId} workflow rules`;
          spawnSync('git', ['add', wfPath], { cwd: root, encoding: 'utf8' });
          const c = spawnSync('git', ['commit', '-m', msg], { cwd: root, encoding: 'utf8' });
          if (c.status === 0) {
            committed = true;
            const shaProc = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' });
            commitSha = (shaProc.stdout || '').trim() || null;
          }
        }

        sendJson(res, 200, {
          ok: true,
          workflow: body.workflow,
          committed,
          commitSha,
        });
        return;
      }

      // 6. POST /api/controls
      if (req.method === 'POST' && pathname === '/api/controls') {
        const body = await readJsonBody(req);
        if (
          (body.maxTasksPerHour !== undefined && (typeof body.maxTasksPerHour !== 'number' || body.maxTasksPerHour <= 0)) ||
          (body.dailyBudgetUsd !== undefined && (typeof body.dailyBudgetUsd !== 'number' || body.dailyBudgetUsd <= 0)) ||
          (body.stallThresholdMinutes !== undefined && (typeof body.stallThresholdMinutes !== 'number' || body.stallThresholdMinutes <= 0))
        ) {
          sendJson(res, 400, { ok: false, error: 'maxTasksPerHour, dailyBudgetUsd, and stallThresholdMinutes must be positive numbers' });
          return;
        }

        const cfg = loadAndValidateFactory(root);
        const updatedCfg = structuredClone(cfg.factoryConfig);
        if (typeof body.killSwitch === 'boolean') {
          updatedCfg.factory.killSwitch = body.killSwitch;
        }
        if (typeof body.maxTasksPerHour === 'number') {
          updatedCfg.factory.limits.maxTasksPerHour = body.maxTasksPerHour;
        }
        if (typeof body.dailyBudgetUsd === 'number') {
          updatedCfg.factory.limits.dailyBudgetUsd = body.dailyBudgetUsd;
        }
        if (typeof body.stallThresholdMinutes === 'number') {
          updatedCfg.factory.limits.stallThresholdMinutes = body.stallThresholdMinutes;
        }
        if (typeof body.autonomy === 'string') {
          updatedCfg.factory.autonomy = body.autonomy;
        }
        if (typeof body.resetRuntime === 'string') {
          store.resetRuntimeCircuit(body.resetRuntime);
        }

        const factoryYamlPath = join(root, 'factory.yaml');
        writeFileSync(
          factoryYamlPath,
          `# Factory as Code configuration (YAML 1.2 JSON-compatible subset)\n${JSON.stringify(updatedCfg, null, 2)}\n`,
          'utf8',
        );

        sendJson(res, 200, {
          ok: true,
          factoryConfig: updatedCfg,
          runtimeHealth: store.listRuntimeHealth(),
        });
        return;
      }

      // 7. POST /api/deploy/verify
      if (req.method === 'POST' && pathname === '/api/deploy/verify') {
        const body = await readJsonBody(req);
        if (!body.commitSha || typeof body.commitSha !== 'string') {
          sendJson(res, 400, { ok: false, error: 'commitSha is required' });
          return;
        }
        const deployRes = store.verifyDeployment({
          executionKey: body.executionKey || 'brenoacker/agentic-factory#0',
          commitSha: body.commitSha,
          errorRate: Number(body.errorRate ?? 0),
          maxErrorRate: Number(body.maxErrorRate ?? 1.0),
        });
        sendJson(res, 200, deployRes);
        return;
      }

      // 8. POST /api/tickets/intake
      if (req.method === 'POST' && pathname === '/api/tickets/intake') {
        const body = await readJsonBody(req);
        const cfg = loadAndValidateFactory(root);
        const intakeRes = intakeAndTriageTicket({
          issue: {
            issue_number: Number(body.issue_number),
            repo: body.repo || cfg.factoryConfig?.factory?.repo || 'brenoacker/agentic-factory',
            title: body.title,
            body: body.body || '',
            type: body.type || null,
            labels: Array.isArray(body.labels) ? body.labels : [],
            runtime_override: body.runtime_override || null,
          },
          factoryConfig: cfg.factoryConfig,
          workflows: cfg.workflows,
          store,
        });
        sendJson(res, intakeRes.status, intakeRes);
        return;
      }

      // 9. POST /api/tickets/:key/dispatch & GET /api/tickets/:key/deliverable
      const delivMatch = pathname.match(/^\/api\/tickets\/([^/]+)\/deliverable$/);
      if (req.method === 'GET' && delivMatch) {
        const executionKey = decodeURIComponent(delivMatch[1]);
        const task = store.getTask(executionKey);
        if (!task) {
          sendJson(res, 404, { ok: false, error: `Task not found: ${executionKey}` });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          executionKey,
          deliverable: {
            type: task.deliverable_type,
            url: task.deliverable_url,
            ref: task.deliverable_ref,
          },
          workspace: {
            path: task.workspace_path,
            branch: task.branch_name,
          },
        });
        return;
      }

      const dispatchMatch = pathname.match(/^\/api\/tickets\/([^/]+)\/dispatch$/);
      if (req.method === 'POST' && dispatchMatch) {
        const executionKey = decodeURIComponent(dispatchMatch[1]);
        const body = await readJsonBody(req);
        const cfg = loadAndValidateFactory(root);
        const dispatchRes = advanceTicketInPanel({
          executionKey,
          factoryRoot: root,
          factoryConfig: cfg.factoryConfig,
          workflows: cfg.workflows,
          pricesConfig: cfg.pricesConfig,
          store,
          approveCurrentStage: Boolean(body.approveCurrentStage),
          impact: body.impact || 'medium',
          verdict: body.verdict || 'APPROVE',
          headSha: body.headSha || '64e6a79',
          deliverable: body.deliverable || null,
          autoAttachDeliverable: body.autoAttachDeliverable !== false,
          trackerRunner: issuePollRunner,
        });
        sendJson(res, dispatchRes.status, dispatchRes);
        return;
      }

      sendJson(res, 404, { ok: false, error: `Not found: ${pathname}` });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
  });

  return {
    server,
    store,
    scheduler,
    close: () =>
      new Promise((resolveClose) => {
        scheduler.stop();
        server.close(() => {
          store.close();
          resolveClose();
        });
      }),
  };
}
