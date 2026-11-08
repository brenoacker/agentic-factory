import { spawnSync } from 'node:child_process';
import { pollIssuesWithEtag, commentOnGitHubIssue, updateGitHubIssue, closeGitHubIssue } from './github.mjs';

export const SUPPORTED_PROVIDERS = ['github', 'jira', 'asana', 'linear'];

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

function parseListInput(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || '').trim()).filter(Boolean);
  }
  return String(raw)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseCustomFieldsInput(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      const cleanK = String(k || '').trim();
      const cleanV = String(v ?? '').trim();
      if (cleanK && cleanV !== '') out[cleanK] = cleanV;
    }
    return out;
  }
  const out = {};
  const pairs = String(raw)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      const k = pair.slice(0, eqIdx).trim();
      const v = pair.slice(eqIdx + 1).trim();
      if (k && v !== '') out[k] = v;
    }
  }
  return out;
}

/**
 * Normalizes combinable pickup trigger rules (`statuses`, `requiredLabels`, `excludedLabels`,
 * `requiredCustomFields`, `assigneeFilter`) from `trackerConfig`.
 */
export function normalizeTriggerRules(trackerConfig = {}, provider = 'github') {
  const cleanProvider = String(provider || 'github').toLowerCase();
  const explicitStatuses = parseListInput(
    trackerConfig.statuses?.length ? trackerConfig.statuses : trackerConfig.statusFilter || trackerConfig.sectionFilter,
  );
  const statuses =
    explicitStatuses.length > 0
      ? explicitStatuses
      : cleanProvider === 'jira' || cleanProvider === 'asana' || cleanProvider === 'linear'
        ? ['Ready for Agent']
        : [];

  const requiredLabels = parseListInput(trackerConfig.requiredLabels ?? trackerConfig.requiredFlags);
  const excludedLabels = parseListInput(trackerConfig.excludedLabels ?? trackerConfig.excludedFlags);
  const requiredCustomFields = parseCustomFieldsInput(
    trackerConfig.requiredCustomFields ?? trackerConfig.customFieldFilter,
  );
  const assigneeFilter = String(trackerConfig.assigneeFilter || 'any').trim();

  return {
    statuses,
    statusFilter: statuses.join(', '),
    requiredLabels,
    excludedLabels,
    requiredCustomFields,
    assigneeFilter: assigneeFilter || 'any',
  };
}

/**
 * Evaluates whether a candidate ticket from Jira, Asana, or GitHub satisfies all configured
 * pickup triggers (stage/status + required flags/labels + excluded blocker flags + custom fields + assignee).
 */
export function evaluateTicketPickupTriggers(candidate, trackerConfig = {}, provider = 'github') {
  const rules = normalizeTriggerRules(trackerConfig, provider);
  const matchedTriggers = [];

  // 1. Extract candidate statuses / sections
  const candidateStatuses = new Set();
  if (candidate.status) candidateStatuses.add(String(candidate.status).trim().toLowerCase());
  if (candidate.section) candidateStatuses.add(String(candidate.section).trim().toLowerCase());
  if (candidate.state?.name) candidateStatuses.add(String(candidate.state.name).trim().toLowerCase());
  if (candidate.state?.type) candidateStatuses.add(String(candidate.state.type).trim().toLowerCase());
  if (candidate.fields?.status?.name) {
    candidateStatuses.add(String(candidate.fields.status.name).trim().toLowerCase());
  }
  if (Array.isArray(candidate.memberships)) {
    for (const m of candidate.memberships) {
      if (m?.section?.name) {
        candidateStatuses.add(String(m.section.name).trim().toLowerCase());
      }
    }
  }
  if (Array.isArray(candidate.custom_fields)) {
    for (const cf of candidate.custom_fields) {
      const val = cf?.display_value || cf?.enum_value?.name;
      if (val && (!cf?.name || cf.name.toLowerCase() === 'status' || cf.name.toLowerCase() === 'stage')) {
        candidateStatuses.add(String(val).trim().toLowerCase());
      }
    }
  }

  // Extract candidate labels / tags / flags
  const linearLabels = Array.isArray(candidate.labels?.nodes) ? candidate.labels.nodes : [];
  const rawLabels = [
    ...(Array.isArray(candidate.labels) ? candidate.labels : []),
    ...linearLabels,
    ...(Array.isArray(candidate.tags) ? candidate.tags : []),
    ...(Array.isArray(candidate.flags) ? candidate.flags : []),
    ...(Array.isArray(candidate.fields?.labels) ? candidate.fields.labels : []),
  ];
  const candidateLabelSet = new Set(
    rawLabels
      .map((l) => (typeof l === 'string' ? l : l?.name || ''))
      .map((s) => String(s).trim().toLowerCase())
      .filter(Boolean),
  );

  // If Jira issue is flagged (`fields.flagged` non-empty), treat `'flagged'` and `'impediment'` as active flags
  if (
    candidate.fields?.flagged &&
    ((Array.isArray(candidate.fields.flagged) && candidate.fields.flagged.length > 0) ||
      candidate.fields.flagged === true)
  ) {
    candidateLabelSet.add('flagged');
    candidateLabelSet.add('impediment');
  }

  // Stage / Status check
  if (rules.statuses.length > 0) {
    const allowedLower = rules.statuses.map((s) => s.toLowerCase());
    const matchesStage = allowedLower.some(
      (target) =>
        candidateStatuses.has(target) ||
        (String(provider).toLowerCase() === 'github' && candidateLabelSet.has(target)),
    );
    if (!matchesStage) {
      return {
        eligible: false,
        matchedTriggers,
        blockedReason: `stage_mismatch (expected one of: ${rules.statuses.join(', ')})`,
      };
    }
    matchedTriggers.push(`stage:${rules.statuses.join('|')}`);
  }

  // 2. Excluded flags / labels check (blocker flags)
  for (const excl of rules.excludedLabels) {
    const exclLower = excl.toLowerCase();
    if (candidateLabelSet.has(exclLower)) {
      return {
        eligible: false,
        matchedTriggers,
        blockedReason: `excluded_flag:${excl}`,
      };
    }
  }

  // 3. Required flags / labels / tags check (all must be present)
  for (const req of rules.requiredLabels) {
    const reqLower = req.toLowerCase();
    if (!candidateLabelSet.has(reqLower)) {
      return {
        eligible: false,
        matchedTriggers,
        blockedReason: `missing_required_flag:${req}`,
      };
    }
    matchedTriggers.push(`flag:${req}`);
  }

  // 4. Required custom fields check (key=value)
  const customFieldMap = new Map();
  const fieldsObj = candidate.fields || {};
  for (const [k, v] of Object.entries(fieldsObj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      customFieldMap.set(k.toLowerCase(), String(v).trim().toLowerCase());
    } else if (typeof v === 'object' && typeof v.name === 'string') {
      customFieldMap.set(k.toLowerCase(), v.name.trim().toLowerCase());
    } else if (typeof v === 'object' && typeof v.value === 'string') {
      customFieldMap.set(k.toLowerCase(), v.value.trim().toLowerCase());
    }
  }
  if (fieldsObj.customFields && typeof fieldsObj.customFields === 'object') {
    for (const [k, v] of Object.entries(fieldsObj.customFields)) {
      customFieldMap.set(k.toLowerCase(), String(v ?? '').trim().toLowerCase());
    }
  }
  if (candidate.customFields && typeof candidate.customFields === 'object') {
    for (const [k, v] of Object.entries(candidate.customFields)) {
      customFieldMap.set(k.toLowerCase(), String(v ?? '').trim().toLowerCase());
    }
  }
  if (Array.isArray(candidate.custom_fields)) {
    for (const cf of candidate.custom_fields) {
      if (cf?.name) {
        const val = cf.display_value ?? cf.enum_value?.name ?? cf.text_value ?? cf.number_value ?? '';
        customFieldMap.set(String(cf.name).trim().toLowerCase(), String(val).trim().toLowerCase());
      }
    }
  }

  for (const [expectedKey, expectedVal] of Object.entries(rules.requiredCustomFields)) {
    const actualVal = customFieldMap.get(expectedKey.toLowerCase());
    if (actualVal !== String(expectedVal).trim().toLowerCase()) {
      return {
        eligible: false,
        matchedTriggers,
        blockedReason: `custom_field_mismatch:${expectedKey}=${expectedVal}`,
      };
    }
    matchedTriggers.push(`field:${expectedKey}=${expectedVal}`);
  }

  // 5. Assignee check
  if (rules.assigneeFilter && rules.assigneeFilter.toLowerCase() !== 'any') {
    const rawAssignee =
      candidate.assignee?.name ||
      candidate.assignee?.login ||
      candidate.assignee?.email ||
      (typeof candidate.assignee === 'string' ? candidate.assignee : '') ||
      candidate.fields?.assignee?.displayName ||
      candidate.fields?.assignee?.name ||
      candidate.fields?.assignee?.emailAddress ||
      (typeof candidate.fields?.assignee === 'string' ? candidate.fields.assignee : '');
    const cleanAssignee = String(rawAssignee || '').trim().toLowerCase();
    const targetAssignee = rules.assigneeFilter.toLowerCase();

    if (targetAssignee === 'unassigned') {
      if (cleanAssignee) {
        return {
          eligible: false,
          matchedTriggers,
          blockedReason: `assignee_mismatch:expected_unassigned`,
        };
      }
      matchedTriggers.push('assignee:unassigned');
    } else if (cleanAssignee !== targetAssignee) {
      return {
        eligible: false,
        matchedTriggers,
        blockedReason: `assignee_mismatch:expected_${rules.assigneeFilter}`,
      };
    } else {
      matchedTriggers.push(`assignee:${rules.assigneeFilter}`);
    }
  }

  return {
    eligible: true,
    matchedTriggers,
    blockedReason: null,
  };
}

/**
 * Builds a Jira JQL query from a project's `trackerConfig` including combinable status and label triggers.
 */
export function buildJiraJql(trackerConfig = {}) {
  if (trackerConfig.jql && String(trackerConfig.jql).trim()) {
    return String(trackerConfig.jql).trim();
  }
  const projectKey = String(trackerConfig.projectKey || 'PROJ').trim();
  const rules = normalizeTriggerRules(trackerConfig, 'jira');
  const clauses = [`project = "${projectKey}"`];
  if (rules.statuses.length === 1) {
    clauses.push(`status = "${rules.statuses[0]}"`);
  } else if (rules.statuses.length > 1) {
    clauses.push(`status IN (${rules.statuses.map((s) => `"${s}"`).join(', ')})`);
  }
  for (const reqLabel of rules.requiredLabels) {
    clauses.push(`labels = "${reqLabel}"`);
  }
  for (const exclLabel of rules.excludedLabels) {
    clauses.push(`labels != "${exclLabel}"`);
  }
  return `${clauses.join(' AND ')} ORDER BY updated DESC`;
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
 * Polls GitHub Issues for a monitored project and applies combinable pickup triggers.
 */
export function pollGitHubTracker({ project, etag = null, runner = null }) {
  const res = pollIssuesWithEtag({
    repo: project.repo,
    etag,
    runner,
  });
  if (res.notModified) {
    return { ...res, skippedByTriggers: [], skippedByTriggersCount: 0 };
  }
  const trackerConfig = project?.trackerConfig || {};
  const hasTriggerRules =
    trackerConfig.statusFilter ||
    trackerConfig.statuses?.length ||
    trackerConfig.requiredLabels?.length ||
    trackerConfig.excludedLabels?.length ||
    trackerConfig.assigneeFilter;

  if (!hasTriggerRules) {
    return { ...res, skippedByTriggers: [], skippedByTriggersCount: 0 };
  }

  const eligibleIssues = [];
  const skippedByTriggers = [];
  for (const iss of res.issues) {
    const check = evaluateTicketPickupTriggers(iss, trackerConfig, 'github');
    if (check.eligible) {
      eligibleIssues.push({ ...iss, matchedTriggers: check.matchedTriggers });
    } else {
      skippedByTriggers.push({ id: String(iss.issue_number), reason: check.blockedReason });
    }
  }
  return {
    ...res,
    issues: eligibleIssues,
    skippedByTriggers,
    skippedByTriggersCount: skippedByTriggers.length,
  };
}

/**
 * Polls Jira issues matching the configured `projectKey`, combinable pickup triggers, or custom `jql`.
 */
export function pollJiraTracker({ project, etag = null, runner = null }) {
  const trackerConfig = project.trackerConfig || {};
  const rules = normalizeTriggerRules(trackerConfig, 'jira');
  const jql = buildJiraJql(trackerConfig);
  const statusFilter = rules.statusFilter;
  const endpoint = `/rest/api/3/search?jql=${encodeURIComponent(jql)}`;

  let response;
  if (runner) {
    response = runner({
      provider: 'jira',
      repo: project.repo,
      project,
      jql,
      statusFilter,
      triggerRules: rules,
      endpoint,
      etag,
    });
  } else {
    const baseUrl = String(trackerConfig.baseUrl || process.env.JIRA_BASE_URL || '').replace(/\/+$/, '');
    const email = process.env.JIRA_EMAIL || '';
    const token = process.env.JIRA_API_TOKEN || '';
    if (!baseUrl || !token) {
      return { notModified: false, etag: etag || '', issues: [], skippedByTriggers: [], skippedByTriggersCount: 0 };
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
    return { notModified: true, etag: response.etag || etag, issues: [], skippedByTriggers: [], skippedByTriggersCount: 0 };
  }

  if (response && response.status && response.status !== 200) {
    throw new Error(`Jira API error (${response.status}) while polling ${project.repo}`);
  }

  const rawList = Array.isArray(response?.body?.issues)
    ? response.body.issues
    : Array.isArray(response?.body)
      ? response.body
      : [];

  const issues = [];
  const skippedByTriggers = [];

  for (const item of rawList) {
    const key = item.key || `JIRA-${item.id || 1}`;
    const triggerCheck = evaluateTicketPickupTriggers(item, trackerConfig, 'jira');
    if (!triggerCheck.eligible) {
      skippedByTriggers.push({ id: key, reason: triggerCheck.blockedReason });
      continue;
    }

    const fields = item.fields || {};
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

    issues.push({
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
      matchedTriggers: triggerCheck.matchedTriggers,
    });
  }

  return {
    notModified: false,
    etag: response?.etag || etag || '',
    issues,
    skippedByTriggers,
    skippedByTriggersCount: skippedByTriggers.length,
  };
}

/**
 * Polls Asana tasks in a configured `projectGid` filtered by combinable pickup triggers.
 */
export function pollAsanaTracker({ project, etag = null, runner = null }) {
  const trackerConfig = project.trackerConfig || {};
  const rules = normalizeTriggerRules(trackerConfig, 'asana');
  const projectGid = String(trackerConfig.projectGid || '').trim();
  const statusFilter = rules.statusFilter;
  const endpoint = `/api/1.0/projects/${projectGid}/tasks?opt_fields=gid,name,notes,completed,assignee.name,tags.name,memberships.section.name,custom_fields.name,custom_fields.display_value`;

  let response;
  if (runner) {
    response = runner({
      provider: 'asana',
      repo: project.repo,
      project,
      projectGid,
      statusFilter,
      triggerRules: rules,
      endpoint,
      etag,
    });
  } else {
    const token = process.env.ASANA_ACCESS_TOKEN || '';
    if (!projectGid || !token) {
      return { notModified: false, etag: etag || '', issues: [], skippedByTriggers: [], skippedByTriggersCount: 0 };
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
    return { notModified: true, etag: response.etag || etag, issues: [], skippedByTriggers: [], skippedByTriggersCount: 0 };
  }

  if (response && response.status && response.status !== 200) {
    throw new Error(`Asana API error (${response.status}) while polling ${project.repo}`);
  }

  const rawList = Array.isArray(response?.body?.data)
    ? response.body.data
    : Array.isArray(response?.body)
      ? response.body
      : [];

  const issues = [];
  const skippedByTriggers = [];

  for (const item of rawList) {
    const gid = String(item.gid || item.id || '1');
    if (item.completed === true) {
      skippedByTriggers.push({ id: gid, reason: 'completed_task' });
      continue;
    }
    const triggerCheck = evaluateTicketPickupTriggers(item, trackerConfig, 'asana');
    if (!triggerCheck.eligible) {
      skippedByTriggers.push({ id: gid, reason: triggerCheck.blockedReason });
      continue;
    }

    const issueNumber = normalizeNumericIssueId(gid);
    const rawTags = Array.isArray(item.tags) ? item.tags : Array.isArray(item.labels) ? item.labels : [];
    const labels = rawTags.map((t) => (typeof t === 'string' ? t : t.name));
    const rawTitle = item.name || item.title || '';
    const title = rawTitle.startsWith(`[Asana-${gid}]`) ? rawTitle : `[Asana-${gid}] ${rawTitle}`;
    const body = item.notes || item.body || '';

    issues.push({
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
      matchedTriggers: triggerCheck.matchedTriggers,
    });
  }

  return {
    notModified: false,
    etag: response?.etag || etag || '',
    issues,
    skippedByTriggers,
    skippedByTriggersCount: skippedByTriggers.length,
  };
}

/**
 * Safely resolves Linear API key from process.env or Windows user environment / registry.
 */
export function getLinearApiKey(explicitKey = null) {
  if (explicitKey !== null && explicitKey !== undefined) return explicitKey;
  if (process.env.LINEAR_API_KEY !== undefined) return process.env.LINEAR_API_KEY;
  if (process.platform === 'win32') {
    try {
      const reg = spawnSync('reg', ['query', 'HKCU\\Environment', '/v', 'LINEAR_API_KEY'], { encoding: 'utf8' });
      const match = reg.stdout?.match(/LINEAR_API_KEY\s+REG_SZ\s+(\S+)/);
      if (match && match[1]) {
        process.env.LINEAR_API_KEY = match[1];
        return match[1];
      }
    } catch {}
  }
  return '';
}

/**
 * Polls Linear issues for a monitored project using Linear GraphQL API or mock runner.
 */
export function pollLinearTracker({ project, etag = null, runner = null }) {
  const trackerConfig = project.trackerConfig || {};
  const rules = normalizeTriggerRules(trackerConfig, 'linear');
  const projectSlug = String(project.repo || '').replace(/^linear:\/?\/?/i, '');
  const projectKey = String(trackerConfig.projectKey || trackerConfig.projectId || projectSlug.split('/')[1] || projectSlug).trim();

  let response;
  if (runner) {
    response = runner({
      provider: 'linear',
      projectKey,
      repo: project.repo,
      statusFilter: rules.statusFilter,
      triggerRules: rules,
      etag,
    });
  } else {
    const apiKey = getLinearApiKey();
    if (!apiKey) {
      return {
        notModified: false,
        etag: etag || '',
        issues: [],
        skippedByTriggers: [],
        skippedByTriggersCount: 0,
        error: 'Missing LINEAR_API_KEY. Configure LINEAR_API_KEY in ~/.env or environment using the safe credentials protocol.',
      };
    }
    const cleanedKey = projectKey.replace(/^https?:\/\/linear\.app\/[^\/]+\/project\//i, '').replace(/\/.*$/, '');
    const slugSuffix = cleanedKey.match(/[0-9a-f]{8,}$/i)?.[0] || '';
    const namePart = cleanedKey.replace(/-[0-9a-f]{8,}$/i, '').replace(/[-_]/g, ' ').trim();

    const graphqlQuery = JSON.stringify({
      query: `query GetProjectIssues {
        issues(first: 50) {
          nodes {
            id
            identifier
            number
            title
            description
            project { id name slugId }
            state { id name type }
            assignee { id name }
            labels { nodes { id name } }
          }
        }
      }`,
    });

    const proc = spawnSync(
      'curl',
      [
        '-sS',
        '-X',
        'POST',
        '-H',
        `Authorization: ${apiKey}`,
        '-H',
        'Content-Type: application/json',
        '--data-raw',
        graphqlQuery,
        'https://api.linear.app/graphql',
      ],
      { encoding: 'utf8' },
    );

    const parsed = proc.stdout ? JSON.parse(proc.stdout) : {};
    const allIssues = parsed?.data?.issues?.nodes || [];
    const matchedIssues = allIssues.filter((iss) => {
      if (!iss.project) return true;
      if (slugSuffix && iss.project.slugId?.toLowerCase() === slugSuffix.toLowerCase()) return true;
      if (namePart && iss.project.name?.toLowerCase().includes(namePart.toLowerCase())) return true;
      if (iss.project.id === cleanedKey || iss.project.slugId === cleanedKey) return true;
      return false;
    });

    response = {
      status: proc.status === 0 ? 200 : 500,
      etag: etag || '',
      body: { issues: { nodes: matchedIssues.length > 0 ? matchedIssues : allIssues } },
    };
  }

  if (response?.status === 304) {
    return { notModified: true, etag: response.etag || etag, issues: [], skippedByTriggers: [], skippedByTriggersCount: 0 };
  }

  if (response && response.status && response.status !== 200) {
    throw new Error(`Linear API error (${response.status}) while polling ${project.repo}`);
  }

  const rawList = Array.isArray(response?.body?.data?.issues?.nodes)
    ? response.body.data.issues.nodes
    : Array.isArray(response?.body?.issues?.nodes)
      ? response.body.issues.nodes
      : Array.isArray(response?.body?.data?.project?.issues?.nodes)
        ? response.body.data.project.issues.nodes
        : Array.isArray(response?.body?.data)
          ? response.body.data
          : Array.isArray(response?.body)
            ? response.body
            : [];

  const issues = [];
  const skippedByTriggers = [];

  for (const item of rawList) {
    const rawId = String(item.identifier || item.id || item.number || '1');
    const stateType = String(item.state?.type || '').toLowerCase();
    const stateName = String(item.state?.name || '').toLowerCase();
    if (stateType === 'completed' || stateType === 'canceled' || stateName === 'done' || stateName === 'closed') {
      skippedByTriggers.push({ id: rawId, reason: 'completed_issue' });
      continue;
    }

    const triggerCheck = evaluateTicketPickupTriggers(item, trackerConfig, 'linear');
    if (!triggerCheck.eligible) {
      skippedByTriggers.push({ id: rawId, reason: triggerCheck.blockedReason });
      continue;
    }

    const issueNumber = Number.isFinite(Number(item.number)) && Number(item.number) > 0
      ? Number(item.number)
      : normalizeNumericIssueId(rawId);

    const rawLabels = Array.isArray(item.labels?.nodes)
      ? item.labels.nodes.map((l) => l.name)
      : Array.isArray(item.labels)
        ? item.labels.map((l) => (typeof l === 'string' ? l : l.name))
        : [];

    const rawTitle = item.title || item.name || '';
    const title = rawTitle.startsWith(`[Linear-${item.identifier || rawId}]`)
      ? rawTitle
      : `[Linear-${item.identifier || rawId}] ${rawTitle}`;
    const body = item.description || item.body || item.notes || '';

    issues.push({
      issue_number: issueNumber,
      external_id: item.id || rawId,
      provider: 'linear',
      repo: project.repo,
      title,
      body,
      type: null,
      stage: 'triage',
      runtime_override: null,
      labels: rawLabels,
      matchedTriggers: triggerCheck.matchedTriggers,
    });
  }

  return {
    notModified: false,
    etag: response?.etag || etag || '',
    issues,
    skippedByTriggers,
    skippedByTriggersCount: skippedByTriggers.length,
    ...(response?.error ? { error: response.error } : {}),
  };
}

/**
 * Extracts the canonical Linear issue identifier or UUID from a task.
 */
export function resolveLinearIssueId(task) {
  if (!task) return null;
  const rawExternal = String(task.external_id || '').trim();
  if (rawExternal && !/^\d+$/.test(rawExternal)) {
    return rawExternal;
  }
  const ticketUrl = String(task.ticket_url || '').trim();
  if (ticketUrl) {
    const uuidMatch = ticketUrl.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch) return uuidMatch[0];
    const identMatch = ticketUrl.match(/\/issue\/([A-Za-z0-9]+-\d+)/i);
    if (identMatch) return identMatch[1];
  }
  const title = String(task.title || '').trim();
  if (title) {
    const titleMatch = title.match(/\[Linear-([^\]]+)\]/i);
    if (titleMatch) return titleMatch[1].trim();
  }
  return task.external_id || task.issue_number;
}

/**
 * Updates status and adds comments to a Linear issue. Accepts an injectable runner for tests.
 */
export function updateLinearIssueStatus({ issueId, stateName = 'Done', comment = '', apiKey = '', runner = null }) {
  if (runner) {
    return runner({ action: 'linear_update', issueId, stateName, comment });
  }
  const key = apiKey || getLinearApiKey();
  if (!key) return { ok: false, error: 'Missing LINEAR_API_KEY' };

  try {
    let resolvedIssueId = String(issueId || '').trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedIssueId);
    if (!isUuid && resolvedIssueId) {
      const issueQuery = JSON.stringify({
        query: `{ issue(id: "${resolvedIssueId}") { id } }`,
      });
      const issueProc = spawnSync(
        'curl',
        ['-sS', '-X', 'POST', '-H', `Authorization: ${key}`, '-H', 'Content-Type: application/json', '--data-raw', issueQuery, 'https://api.linear.app/graphql'],
        { encoding: 'utf8' },
      );
      const parsedIssue = issueProc.stdout ? JSON.parse(issueProc.stdout) : {};
      if (parsedIssue?.data?.issue?.id) {
        resolvedIssueId = parsedIssue.data.issue.id;
      }
    }

    // 1. Resolve workflow state id matching requested stateName
    const statesQuery = JSON.stringify({
      query: `{ workflowStates { nodes { id name } } }`,
    });
    const stateProc = spawnSync(
      'curl',
      ['-sS', '-X', 'POST', '-H', `Authorization: ${key}`, '-H', 'Content-Type: application/json', '--data-raw', statesQuery, 'https://api.linear.app/graphql'],
      { encoding: 'utf8' },
    );
    const stateData = stateProc.stdout ? JSON.parse(stateProc.stdout) : {};
    const nodes = stateData?.data?.workflowStates?.nodes || [];
    const matchedState = nodes.find((s) => s.name?.toLowerCase() === stateName.toLowerCase()) || nodes.find((s) => s.name?.toLowerCase().includes(stateName.toLowerCase()));

    if (matchedState?.id && resolvedIssueId) {
      const updateMutation = JSON.stringify({
        query: `mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
            issue { id state { name } }
          }
        }`,
        variables: { id: resolvedIssueId, input: { stateId: matchedState.id } },
      });
      spawnSync(
        'curl',
        ['-sS', '-X', 'POST', '-H', `Authorization: ${key}`, '-H', 'Content-Type: application/json', '--data-raw', updateMutation, 'https://api.linear.app/graphql'],
        { encoding: 'utf8' },
      );
    }

    if (comment && resolvedIssueId) {
      const commentMutation = JSON.stringify({
        query: `mutation CreateComment($input: CommentCreateInput!) {
          commentCreate(input: $input) {
            success
            comment { id }
          }
        }`,
        variables: { input: { issueId: resolvedIssueId, body: comment } },
      });
      spawnSync(
        'curl',
        ['-sS', '-X', 'POST', '-H', `Authorization: ${key}`, '-H', 'Content-Type: application/json', '--data-raw', commentMutation, 'https://api.linear.app/graphql'],
        { encoding: 'utf8' },
      );
    }

    return { ok: true, status: 200, issueId: resolvedIssueId, stateName };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Dispatches polling for a monitored project based on `project.provider` (`github` | `jira` | `asana` | `linear`).
 */
export function pollProjectTracker({ project, etag = null, runner = null }) {
  const provider = String(project?.provider || 'github').toLowerCase();
  if (provider === 'jira') {
    return pollJiraTracker({ project, etag, runner });
  }
  if (provider === 'asana') {
    return pollAsanaTracker({ project, etag, runner });
  }
  if (provider === 'linear') {
    return pollLinearTracker({ project, etag, runner });
  }
  return pollGitHubTracker({ project, etag, runner });
}

/**
 * Synchronizes task lifecycle changes (stage transitions, waiting for human, PR links, completion)
 * to external issue trackers (GitHub, Linear, Jira, Asana) without duplicate comments across polling cycles.
 */
export function syncTaskStateToTracker({
  task,
  store = null,
  runner = null,
  force = false,
} = {}) {
  if (!task) return { ok: false, error: 'Task is required' };

  const stage = String(task.stage || 'triage');
  const needsHuman = Boolean(task.needs_human);
  const delivUrl = String(task.deliverable_url || '');
  const delivType = String(task.deliverable_type || '');
  const question = String(task.human_question || '');

  const rawProvider = String(task.provider || '').toLowerCase();
  const provider =
    rawProvider ||
    (String(task.execution_key || '').startsWith('linear:') || String(task.repo || '').startsWith('linear://')
      ? 'linear'
      : 'github');

  const signature = `${stage}:${needsHuman ? '1' : '0'}:${delivUrl}:${question}`;
  if (!force && task.last_synced_stage && task.last_synced_stage === signature) {
    return {
      ok: true,
      skippedDuplicate: true,
      signature,
      provider,
      statusName: stage === 'done' ? 'Done' : 'In Progress',
      shouldClose: stage === 'done',
    };
  }

  let comment = '';
  let statusName = '';
  let labelsToAdd = [];
  let labelsToRemove = [];
  let shouldClose = false;

  if (stage === 'done') {
    statusName = 'Done';
    const deliverableSummary =
      delivType === 'pull_request'
        ? `Pull Request: ${delivUrl}`
        : delivType === 'research_document'
          ? `Research Document: \`${delivUrl}\``
          : `Deliverable: completed`;

    if (delivType === 'pull_request' && delivUrl) {
      comment = `✅ **Completed via Agentic Factory**: Pull Request ${delivUrl} was merged into default branch. Issue closed as completed.`;
    } else {
      comment = `✅ **Completed via Agentic Factory**: Workflow finished with ${deliverableSummary}. All automated checks and gates passed.`;
    }
    labelsToAdd = ['stage:done'];
    labelsToRemove = ['in-progress', 'waiting-for-human', 'stage:merge', 'stage:review', 'stage:triage'];
    shouldClose = true;
  } else if (stage === 'merge') {
    statusName = 'In Review';
    if (delivUrl) {
      comment = `👀 **Waiting for Human Review**: Pull Request created: ${delivUrl}. Please review and merge the PR.`;
    } else {
      comment = `👀 **Waiting for Human Review**: Task reached stage \`merge\` and awaits operator review.`;
    }
    labelsToAdd = ['waiting-for-human', 'stage:merge'];
    labelsToRemove = ['in-progress', 'stage:triage'];
    shouldClose = false;
  } else if (needsHuman) {
    statusName = 'In Review';
    comment = question
      ? `⚠️ **Human Input Required**: ${question}`
      : `⚠️ **Human Input Required**: Task paused awaiting operator input.`;
    labelsToAdd = ['waiting-for-human'];
    labelsToRemove = ['in-progress'];
    shouldClose = false;
  } else if (stage === 'triage') {
    statusName = 'In Progress';
    comment = `🚀 **Agentic Factory Pickup**: Issue intaked under workflow \`${task.type || 'feature'}\` (initial stage: \`triage\`).`;
    labelsToAdd = ['in-progress', 'stage:triage'];
    labelsToRemove = ['waiting-for-human'];
    shouldClose = false;
  } else if (stage === 'checks_and_build' || stage === 'plan' || stage === 'verify' || stage === 'review') {
    statusName = 'In Progress';
    comment = `🔨 **Stage Transition**: Task advanced to stage \`${stage}\`.`;
    labelsToAdd = ['in-progress', `stage:${stage}`];
    labelsToRemove = ['waiting-for-human', 'stage:triage'];
    shouldClose = false;
  } else {
    statusName = 'In Progress';
    comment = `🔨 **Stage Transition**: Task entered stage \`${stage}\`.`;
    labelsToAdd = ['in-progress', `stage:${stage}`];
    labelsToRemove = ['waiting-for-human'];
    shouldClose = false;
  }

  const result = {
    ok: true,
    provider,
    signature,
    comment,
    statusName,
    labelsToAdd,
    labelsToRemove,
    shouldClose,
  };

  try {
    if (provider === 'linear') {
      const issueId = resolveLinearIssueId(task);
      updateLinearIssueStatus({
        issueId,
        stateName: statusName || 'In Progress',
        comment,
        runner,
      });
    } else if (provider === 'jira') {
      if (runner) {
        runner({
          action: 'jira_update',
          issueKey: task.external_id || task.issue_number,
          statusName,
          comment,
        });
      }
    } else if (provider === 'asana') {
      if (runner) {
        runner({
          action: 'asana_update',
          gid: task.external_id || task.issue_number,
          statusName,
          comment,
        });
      }
    } else {
      // GitHub
      let repo = task.repo;
      if (repo && repo.startsWith('linear://')) {
        repo = repo.replace(/^linear:\/?\/?/i, '');
      }
      const issueNumber = task.issue_number;
      if (repo && repo.includes('/') && issueNumber) {
        if (comment) {
          commentOnGitHubIssue({
            repo,
            issueNumber,
            comment,
            runner,
          });
        }
        if (labelsToAdd.length > 0 || labelsToRemove.length > 0) {
          updateGitHubIssue({
            repo,
            issueNumber,
            labelsToAdd,
            labelsToRemove,
            runner,
          });
        }
        if (shouldClose) {
          const closeComment =
            delivType === 'pull_request' && delivUrl
              ? `Closed as completed by Agentic Factory (Merged PR: ${delivUrl}).`
              : `Closed as completed by Agentic Factory.`;
          closeGitHubIssue({
            repo,
            issueNumber,
            comment: closeComment,
            runner,
          });
        }
      }
    }

    if (store && typeof store.updateTaskLastSyncedStage === 'function') {
      store.updateTaskLastSyncedStage(task.execution_key, signature);
    }
  } catch (err) {
    result.error = err.message;
  }

  return result;
}
