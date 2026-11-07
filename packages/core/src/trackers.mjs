import { spawnSync } from 'node:child_process';
import { pollIssuesWithEtag } from './github.mjs';

export const SUPPORTED_PROVIDERS = ['github', 'jira', 'asana'];

/**
 * Extracts a deterministic positive integer ID from Jira keys (e.g. "FAC-701" -> 701)
 * or Asana GIDs (e.g. "120055" -> 120055).
 */
export function normalizeNumericIssueId(rawId) {
  const str = String(rawId || '').trim();
  const trailingDigits = str.match(/(\d+)$/);
  if (trailingDigits) {
    const num = Number(trailingDigits[1].slice(-9));
    if (Number.isFinite(num) && num > 0) return num;
  }
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) % 100000000;
  }
  return Math.max(1, Math.abs(hash));
}

/**
 * Builds a Jira JQL query from a project's `trackerConfig`.
 */
export function buildJiraJql(trackerConfig = {}) {
  if (trackerConfig.jql && String(trackerConfig.jql).trim()) {
    return String(trackerConfig.jql).trim();
  }
  const projectKey = String(trackerConfig.projectKey || 'PROJ').trim();
  const statusFilter = String(trackerConfig.statusFilter || 'Ready for Agent').trim();
  return `project = "${projectKey}" AND status = "${statusFilter}" ORDER BY updated DESC`;
}

function extractJiraDescription(desc) {
  if (!desc) return '';
  if (typeof desc === 'string') return desc;
  if (typeof desc === 'object' && Array.isArray(desc.content)) {
    const chunks = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        if (typeof n.text === 'string') chunks.push(n.text);
        if (Array.isArray(n.content)) walk(n.content);
      }
    };
    walk(desc.content);
    return chunks.join(' ').trim();
  }
  return JSON.stringify(desc);
}

/**
 * Polls GitHub Issues for a monitored project.
 */
export function pollGitHubTracker({ project, etag = null, runner = null }) {
  const res = pollIssuesWithEtag({
    repo: project.repo,
    etag,
    runner,
  });
  const statusFilter = String(project?.trackerConfig?.statusFilter || '').trim().toLowerCase();
  if (!statusFilter || res.notModified) {
    return res;
  }
  const filteredIssues = res.issues.filter((iss) =>
    (iss.labels || []).some((l) => String(l).toLowerCase() === statusFilter),
  );
  return {
    ...res,
    issues: filteredIssues,
  };
}

/**
 * Polls Jira issues matching the configured `projectKey`, `statusFilter`, or custom `jql`.
 */
export function pollJiraTracker({ project, etag = null, runner = null }) {
  const trackerConfig = project.trackerConfig || {};
  const jql = buildJiraJql(trackerConfig);
  const statusFilter = String(trackerConfig.statusFilter || 'Ready for Agent').trim();
  const endpoint = `/rest/api/3/search?jql=${encodeURIComponent(jql)}`;

  let response;
  if (runner) {
    response = runner({
      provider: 'jira',
      repo: project.repo,
      project,
      jql,
      statusFilter,
      endpoint,
      etag,
    });
  } else {
    const baseUrl = String(trackerConfig.baseUrl || process.env.JIRA_BASE_URL || '').replace(/\/+$/, '');
    const email = process.env.JIRA_EMAIL || '';
    const token = process.env.JIRA_API_TOKEN || '';
    if (!baseUrl || !token) {
      return { notModified: false, etag: etag || '', issues: [] };
    }
    const auth = Buffer.from(`${email}:${token}`).toString('base64');
    const proc = spawnSync(
      'curl',
      ['-sS', '-H', `Authorization: Basic ${auth}`, '-H', 'Accept: application/json', `${baseUrl}${endpoint}`],
      { encoding: 'utf8' },
    );
    const parsed = proc.stdout ? JSON.parse(proc.stdout) : { issues: [] };
    response = { status: proc.status === 0 ? 200 : 500, etag: etag || '', body: parsed };
  }

  if (response?.status === 304) {
    return { notModified: true, etag: response.etag || etag, issues: [] };
  }

  if (response && response.status && response.status !== 200) {
    throw new Error(`Jira API error (${response.status}) while polling ${project.repo}`);
  }

  const rawList = Array.isArray(response?.body?.issues)
    ? response.body.issues
    : Array.isArray(response?.body)
      ? response.body
      : [];

  const issues = rawList
    .filter((item) => {
      if (!statusFilter) return true;
      const itemStatus = String(item?.fields?.status?.name || item?.status || '').trim();
      if (!itemStatus) return true;
      return itemStatus.toLowerCase() === statusFilter.toLowerCase();
    })
    .map((item) => {
      const fields = item.fields || {};
      const key = item.key || `JIRA-${item.id || 1}`;
      const issueNumber = normalizeNumericIssueId(key);
      const rawLabels = Array.isArray(fields.labels) ? fields.labels : Array.isArray(item.labels) ? item.labels : [];
      const labels = rawLabels.map((l) => (typeof l === 'string' ? l : l.name));
      const issueTypeName = String(fields.issuetype?.name || item.issueType || '').toLowerCase();
      if (issueTypeName && !labels.some((l) => l.startsWith('type:'))) {
        if (issueTypeName.includes('bug') || issueTypeName.includes('defect')) labels.push('type:bug');
        else if (issueTypeName.includes('investigat') || issueTypeName.includes('incident')) labels.push('type:investigation');
        else if (issueTypeName.includes('discover') || issueTypeName.includes('spike')) labels.push('type:discovery');
        else if (issueTypeName.includes('chore') || issueTypeName.includes('task')) labels.push('type:chore');
      }
      const summary = fields.summary || item.title || '';
      const title = summary.startsWith(`[${key}]`) ? summary : `[${key}] ${summary}`;
      const body = extractJiraDescription(fields.description ?? item.body ?? '');

      return {
        issue_number: issueNumber,
        external_id: key,
        provider: 'jira',
        repo: project.repo,
        title,
        body,
        type: null,
        stage: 'triage',
        runtime_override: null,
        labels,
      };
    });

  return {
    notModified: false,
    etag: response?.etag || etag || '',
    issues,
  };
}

/**
 * Polls Asana tasks in a configured `projectGid` filtered by `statusFilter` / `sectionFilter`.
 */
export function pollAsanaTracker({ project, etag = null, runner = null }) {
  const trackerConfig = project.trackerConfig || {};
  const projectGid = String(trackerConfig.projectGid || '').trim();
  const statusFilter = String(trackerConfig.statusFilter || trackerConfig.sectionFilter || 'Ready for Agent').trim();
  const endpoint = `/api/1.0/projects/${projectGid}/tasks?opt_fields=gid,name,notes,completed,tags.name,memberships.section.name,custom_fields.name,custom_fields.display_value`;

  let response;
  if (runner) {
    response = runner({
      provider: 'asana',
      repo: project.repo,
      project,
      projectGid,
      statusFilter,
      endpoint,
      etag,
    });
  } else {
    const token = process.env.ASANA_ACCESS_TOKEN || '';
    if (!projectGid || !token) {
      return { notModified: false, etag: etag || '', issues: [] };
    }
    const proc = spawnSync(
      'curl',
      ['-sS', '-H', `Authorization: Bearer ${token}`, '-H', 'Accept: application/json', `https://app.asana.com${endpoint}`],
      { encoding: 'utf8' },
    );
    const parsed = proc.stdout ? JSON.parse(proc.stdout) : { data: [] };
    response = { status: proc.status === 0 ? 200 : 500, etag: etag || '', body: parsed };
  }

  if (response?.status === 304) {
    return { notModified: true, etag: response.etag || etag, issues: [] };
  }

  if (response && response.status && response.status !== 200) {
    throw new Error(`Asana API error (${response.status}) while polling ${project.repo}`);
  }

  const rawList = Array.isArray(response?.body?.data)
    ? response.body.data
    : Array.isArray(response?.body)
      ? response.body
      : [];

  const issues = rawList
    .filter((item) => {
      if (item.completed === true) return false;
      if (!statusFilter) return true;
      const target = statusFilter.toLowerCase();
      const directStatus = String(item.status || item.section || '').trim().toLowerCase();
      if (directStatus && directStatus === target) return true;
      const membershipMatch = (item.memberships || []).some(
        (m) => String(m?.section?.name || '').trim().toLowerCase() === target,
      );
      if (membershipMatch) return true;
      const customFieldMatch = (item.custom_fields || []).some(
        (cf) => String(cf?.display_value || cf?.enum_value?.name || '').trim().toLowerCase() === target,
      );
      return customFieldMatch;
    })
    .map((item) => {
      const gid = String(item.gid || item.id || '1');
      const issueNumber = normalizeNumericIssueId(gid);
      const rawTags = Array.isArray(item.tags) ? item.tags : Array.isArray(item.labels) ? item.labels : [];
      const labels = rawTags.map((t) => (typeof t === 'string' ? t : t.name));
      const rawTitle = item.name || item.title || '';
      const title = rawTitle.startsWith(`[Asana-${gid}]`) ? rawTitle : `[Asana-${gid}] ${rawTitle}`;
      const body = item.notes || item.body || '';

      return {
        issue_number: issueNumber,
        external_id: gid,
        provider: 'asana',
        repo: project.repo,
        title,
        body,
        type: null,
        stage: 'triage',
        runtime_override: null,
        labels,
      };
    });

  return {
    notModified: false,
    etag: response?.etag || etag || '',
    issues,
  };
}

/**
 * Dispatches polling for a monitored project based on `project.provider` (`github` | `jira` | `asana`).
 */
export function pollProjectTracker({ project, etag = null, runner = null }) {
  const provider = String(project?.provider || 'github').toLowerCase();
  if (provider === 'jira') {
    return pollJiraTracker({ project, etag, runner });
  }
  if (provider === 'asana') {
    return pollAsanaTracker({ project, etag, runner });
  }
  return pollGitHubTracker({ project, etag, runner });
}
