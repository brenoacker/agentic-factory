import { spawnSync } from 'node:child_process';

/**
 * Polls GitHub issues using an ETag (`If-None-Match` header) so HTTP 304 responses consume zero API rate limit.
 * Accepts an injectable `runner` in tests; defaults to `gh api`.
 */
export function pollIssuesWithEtag({ repo, etag = null, runner = null }) {
  const endpoint = `repos/${repo}/issues?state=open&per_page=50`;
  const headers = etag ? { 'If-None-Match': etag } : {};

  let response;
  if (runner) {
    response = runner({ endpoint, headers, repo, etag });
  } else {
    const args = ['api', endpoint, '--include'];
    if (etag) {
      args.push('-H', `If-None-Match: ${etag}`);
    }
    const proc = spawnSync('gh', args, { encoding: 'utf8' });
    const raw = proc.stdout || '';
    const statusMatch = raw.match(/^HTTP\/[\d.]+\s+(\d{3})/m);
    const status = statusMatch ? Number(statusMatch[1]) : proc.status === 0 ? 200 : 500;
    const etagMatch = raw.match(/^ETag:\s*(.+)$/im);
    const newEtag = etagMatch ? etagMatch[1].trim() : etag;
    const parts = raw.split(/\r?\n\r?\n/);
    const bodyText = parts.slice(1).join('\n\n').trim();
    response = {
      status,
      etag: newEtag,
      body: bodyText ? JSON.parse(bodyText) : [],
    };
  }

  if (response.status === 304) {
    return {
      notModified: true,
      etag: response.etag || etag,
      issues: [],
    };
  }

  if (response.status !== 200) {
    throw new Error(`GitHub API error (${response.status}) while polling ${repo}`);
  }

  const rawIssues = Array.isArray(response.body) ? response.body : [];
  const issues = rawIssues
    .filter((item) => !item.pull_request)
    .map((item) => {
      const labels = (item.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
      const typeLabel = labels.find((l) => l.startsWith('type:'));
      const stageLabel = labels.find((l) => l.startsWith('stage:'));
      const runtimeLabel = labels.find((l) => l.startsWith('runtime:'));
      return {
        issue_number: item.number,
        repo,
        title: item.title || '',
        body: item.body || '',
        type: typeLabel ? typeLabel.slice('type:'.length) : 'feature',
        stage: stageLabel ? stageLabel.slice('stage:'.length) : 'triage',
        runtime_override: runtimeLabel ? runtimeLabel.slice('runtime:'.length) : null,
        labels,
      };
    });

  return {
    notModified: false,
    etag: response.etag || etag,
    issues,
  };
}

/**
 * Checks issue comments for an explicit `/approve` command from the operator.
 */
export function hasHumanApprovalComment(comments = []) {
  for (const c of comments) {
    const body = (c?.body || '').trim();
    if (/^\/approve\b/im.test(body)) {
      return {
        approved: true,
        approver: c.user?.login || c.author || 'operator',
        approvedAt: c.created_at || new Date().toISOString(),
        words: body,
      };
    }
  }
  return { approved: false, approver: null, approvedAt: null, words: null };
}

/**
 * Posts a comment on a GitHub issue. Accepts an injectable runner for tests.
 */
export function commentOnGitHubIssue({ repo, issueNumber, comment, runner = null }) {
  if (!comment || !comment.trim()) return { ok: false, error: 'Empty comment' };
  if (runner) {
    return runner({ action: 'comment', repo, issueNumber, comment });
  }
  const args = ['issue', 'comment', String(issueNumber), '--body', comment, '-R', repo];
  const proc = spawnSync('gh', args, { encoding: 'utf8' });
  return {
    ok: proc.status === 0,
    status: proc.status === 0 ? 200 : 500,
    output: proc.stdout?.trim() || proc.stderr?.trim() || '',
  };
}

/**
 * Updates status, labels, and assignment on a GitHub issue. Accepts an injectable runner for tests.
 */
export function updateGitHubIssue({
  repo,
  issueNumber,
  labelsToAdd = [],
  labelsToRemove = [],
  assignees = [],
  runner = null,
}) {
  if (runner) {
    return runner({ action: 'update', repo, issueNumber, labelsToAdd, labelsToRemove, assignees });
  }
  const args = ['issue', 'edit', String(issueNumber), '-R', repo];
  if (labelsToAdd.length > 0) {
    args.push('--add-label', labelsToAdd.join(','));
  }
  if (labelsToRemove.length > 0) {
    args.push('--remove-label', labelsToRemove.join(','));
  }
  if (assignees.length > 0) {
    args.push('--add-assignee', assignees.join(','));
  }
  const proc = spawnSync('gh', args, { encoding: 'utf8' });
  return {
    ok: proc.status === 0,
    status: proc.status === 0 ? 200 : 500,
    output: proc.stdout?.trim() || proc.stderr?.trim() || '',
  };
}

/**
 * Closes a GitHub issue as completed with a resolution comment. Accepts an injectable runner for tests.
 */
export function closeGitHubIssue({ repo, issueNumber, comment = '', runner = null }) {
  if (runner) {
    return runner({ action: 'close', repo, issueNumber, comment });
  }
  const args = ['issue', 'close', String(issueNumber), '--reason', 'completed', '-R', repo];
  if (comment) {
    args.push('--comment', comment);
  }
  const proc = spawnSync('gh', args, { encoding: 'utf8' });
  return {
    ok: proc.status === 0,
    status: proc.status === 0 ? 200 : 500,
    output: proc.stdout?.trim() || proc.stderr?.trim() || '',
  };
}

/**
 * Checks live GitHub Pull Request status using `gh pr view`. Accepts an injectable runner for tests.
 */
export function checkGitHubPullRequest({ repo, prNumberOrUrl, runner = null }) {
  if (!prNumberOrUrl) {
    return { ok: false, error: 'PR number or URL is required', state: 'UNKNOWN', merged: false };
  }
  if (runner) {
    return runner({ action: 'check_pr', repo, prNumberOrUrl });
  }

  // Extract PR number or use URL directly
  const target = String(prNumberOrUrl).trim();
  const prMatch = target.match(/\/pull\/(\d+)/i);
  const prNumber = prMatch ? Number(prMatch[1]) : Number.isInteger(Number(target)) ? Number(target) : target;

  const args = ['pr', 'view', String(prNumber), '--json', 'number,title,state,mergedAt,url,headRefName'];
  if (repo) {
    args.push('-R', repo);
  }

  const proc = spawnSync('gh', args, { encoding: 'utf8' });
  if (proc.status !== 0) {
    return {
      ok: false,
      error: proc.stderr?.trim() || proc.stdout?.trim() || 'Failed to inspect PR',
      state: 'UNKNOWN',
      merged: false,
      prNumber: typeof prNumber === 'number' ? prNumber : null,
      url: target,
    };
  }

  try {
    const data = JSON.parse(proc.stdout || '{}');
    const state = String(data.state || 'OPEN').toUpperCase();
    const merged = state === 'MERGED' || Boolean(data.mergedAt);
    return {
      ok: true,
      prNumber: data.number || (typeof prNumber === 'number' ? prNumber : null),
      title: data.title || '',
      state,
      merged,
      mergedAt: data.mergedAt || null,
      url: data.url || target,
      headRefName: data.headRefName || null,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to parse gh output: ${err.message}`,
      state: 'UNKNOWN',
      merged: false,
      url: target,
    };
  }
}

/**
 * Creates a GitHub Pull Request using `gh pr create`. Accepts an injectable runner for tests.
 */
export function createGitHubPullRequest({ repo, head, base = 'main', title, body = '', cwd, runner = null }) {
  if (runner) {
    return runner({ action: 'create_pr', repo, head, base, title, body, cwd });
  }
  const args = ['pr', 'create', '--repo', repo, '--head', head, '--base', base, '--title', title, '--body', body];
  const proc = spawnSync('gh', args, { cwd: cwd || undefined, encoding: 'utf8' });
  const raw = proc.stdout?.trim() || '';
  const match = raw.match(/https:\/\/github\.com\/[^\s]+/);
  return {
    ok: proc.status === 0,
    url: match ? match[0] : raw,
    output: raw || proc.stderr?.trim() || '',
  };
}

