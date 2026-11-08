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
    let parsedBody = [];
    if (bodyText) {
      try {
        parsedBody = JSON.parse(bodyText);
      } catch {
        parsedBody = [];
      }
    }
    response = {
      status,
      etag: newEtag,
      body: parsedBody,
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

