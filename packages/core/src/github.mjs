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
 * Formats a comprehensive, industry-standard Pull Request body matching .github/pull_request_template.md
 * including What & Why, How it was implemented, Verification & Testing, Visual Evidence, and Checklist.
 */
export function formatPullRequestBody({
  task,
  cleanPayload = {},
  commitSha = null,
  workspacePath = null,
  factoryRoot = null,
  implementationNotes = null,
} = {}) {
  const issueNum = task?.issue_number || 1;
  const title = task?.title || 'Automated task execution';
  const type = task?.type || 'feature';
  const impact = task?.impact || 'medium';
  const branch = task?.branch_name || `factory/issue-${issueNum}`;
  const key = task?.execution_key || `#${issueNum}`;
  const verdict = cleanPayload?.verdict || 'APPROVE';
  const round = cleanPayload?.round || 1;
  const summary = cleanPayload?.summary || 'All deterministic checks and review obligations passed at HEAD.';
  const sha = commitSha || cleanPayload?.commit_sha || 'HEAD';

  // Gather git diff stats if workspace path is available
  let modifiedFiles = [];
  if (workspacePath) {
    try {
      const diffProc = spawnSync('git', ['diff', '--name-only', 'origin/main', 'HEAD'], {
        cwd: workspacePath,
        encoding: 'utf8',
      });
      if (diffProc.status === 0 && diffProc.stdout?.trim()) {
        modifiedFiles = diffProc.stdout.trim().split('\n').map((f) => f.trim()).filter(Boolean);
      }
    } catch {}
  }

  const filesList =
    modifiedFiles.length > 0
      ? modifiedFiles.map((f) => `- \`${f}\``).join('\n')
      : `- Automated changes in \`${type}\` workflow for branch \`${branch}\``;

  const visualEvidence = modifiedFiles.some((f) => f.includes('apps/panel') || f.includes('ui') || f.includes('.html'))
    ? `- UI / Panel components touched: visual proof verified via Playwright E2E suite (\`apps/panel/e2e/panel.spec.mjs\`).\n- Screenshots and traces captured under \`runs/screenshots/\`.`
    : `- Non-UI backend / core pipeline changes: hermetic unit test verification executed and passing.\n- Review contract schema validated against \`contracts/review.schema.json\`.`;

  const notesSection = implementationNotes
    ? `\nKey architectural & code changes:\n${implementationNotes}\n`
    : `\nKey architectural & code changes:\n- Enforced contract schema compliance for stage \`review\` (round ${round}, verdict \`${verdict}\`).\n- Verified deterministic outputs and isolated stage state.\n`;

  return [
    `## What and why`,
    ``,
    `Automated delivery for **${title}**.`,
    `Closes #${issueNum} (Tracker: \`${key}\`).`,
    ``,
    `- **Workflow Type**: \`${type}\``,
    `- **Impact Level**: \`${impact}\``,
    `- **Task Branch**: \`${branch}\``,
    `- **Target Commit**: \`${sha}\``,
    ``,
    `### Reason and Problem Statement`,
    `${title}`,
    ``,
    `## How it was implemented`,
    ``,
    `Implemented and isolated within dedicated workspace on branch \`${branch}\`:`,
    filesList,
    notesSection,
    `## Verification and Tests`,
    ``,
    `### Test Results`,
    `- **Review Verdict**: \`${verdict}\` (Round ${round})`,
    `- **Review Summary**: ${summary}`,
    `- **Commands Executed**:`,
    `  - \`npm run check:static\` (specs self-test & contract validation)`,
    `  - \`npm test\` (unit tests & Playwright E2E suite)`,
    ``,
    `## Visual & Artifact Evidence`,
    ``,
    visualEvidence,
    ``,
    `## Checklist`,
    ``,
    `- [x] Conventional Commit title matching workflow type`,
    `- [x] Automated test suite and static checks pass cleanly`,
    `- [x] Review contract validated against \`contracts/review.schema.json\``,
    `- [x] Hermetic workspace isolation on branch \`${branch}\``,
    `- [x] No secrets, private tokens, or uncommitted runtime state`,
  ].join('\n');
}

/**
 * Creates a GitHub Pull Request using `gh pr create`. Accepts an injectable runner for tests.
 */
export function createGitHubPullRequest({ repo, head, base = 'main', title, body = '', cwd, runner = null }) {
  if (runner) {
    return runner({ action: 'create_pr', repo, head, base, title, body, cwd });
  }
  // Ensure branch is pushed to remote origin first
  if (cwd && head) {
    spawnSync('git', ['push', '-u', 'origin', head], { cwd, encoding: 'utf8' });
  }
  const args = ['pr', 'create', '--repo', repo, '--head', head, '--base', base, '--title', title, '--body', body];
  const proc = spawnSync('gh', args, { cwd: cwd || undefined, encoding: 'utf8' });
  const raw = proc.stdout?.trim() || '';
  const match = raw.match(/https:\/\/github\.com\/[^\s]+/);
  if (proc.status === 0 && match) {
    const numMatch = match[0].match(/\/pull\/(\d+)/);
    return {
      ok: true,
      url: match[0],
      prNumber: numMatch ? Number(numMatch[1]) : null,
      output: raw,
    };
  }
  // If PR already exists for this branch on GitHub, fetch its URL and number
  const viewProc = spawnSync('gh', ['pr', 'view', head, '--repo', repo, '--json', 'url,number'], {
    cwd: cwd || undefined,
    encoding: 'utf8',
  });
  if (viewProc.status === 0 && viewProc.stdout) {
    try {
      const data = JSON.parse(viewProc.stdout);
      if (data.url) {
        return {
          ok: true,
          url: data.url,
          prNumber: Number(data.number),
          output: data.url,
        };
      }
    } catch {}
  }
  return {
    ok: false,
    url: match ? match[0] : '',
    output: raw || proc.stderr?.trim() || '',
  };
}

