import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { syncSkills } from '../../../scripts/lib/skills-sync.mjs';

/**
 * Safely removes a completed or aborted task workspace from disk and cleans up git worktrees.
 */
export function cleanupTaskWorkspace(workspacePath) {
  if (!workspacePath) return { ok: false, error: 'No workspace path provided' };
  try {
    const resolved = resolve(workspacePath);
    if (existsSync(resolved)) {
      try {
        spawnSync('git', ['worktree', 'remove', '--force', resolved], { encoding: 'utf8' });
      } catch {
        // Best-effort worktree unregistration
      }
      rmSync(resolved, { recursive: true, force: true });
      return { ok: true, deleted: true, path: resolved };
    }
    return { ok: true, deleted: false, reason: 'Path does not exist' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Prepares an isolated workspace directory (or git worktree when `useGitWorktree` is true),
 * copies `AGENTS.md` and `CLAUDE.md` from the factory root, and synchronizes all 23 locked skills
 * into `.agents/skills` and `.claude/skills`.
 */
export function prepareWorktree({
  factoryRoot,
  targetRepoPath = null,
  worktreePath,
  branchName = null,
  useGitWorktree = false,
}) {
  const root = resolve(factoryRoot);
  const dest = resolve(worktreePath);

  if (useGitWorktree && targetRepoPath && existsSync(join(resolve(targetRepoPath), '.git'))) {
    const args = ['worktree', 'add', '--force'];
    if (branchName) {
      args.push('-B', branchName);
    }
    args.push(dest);
    spawnSync('git', args, { cwd: resolve(targetRepoPath), encoding: 'utf8' });
  } else {
    mkdirSync(dest, { recursive: true });
  }

  for (const docFile of ['AGENTS.md', 'CLAUDE.md']) {
    const srcDoc = join(root, docFile);
    if (existsSync(srcDoc)) {
      cpSync(srcDoc, join(dest, docFile), { force: true });
    }
  }

  const syncRes = syncSkills({
    root,
    target: dest,
    verifyOnly: false,
  });

  if (!syncRes.ok) {
    throw new Error(`Failed to sync locked skills into worktree ${dest}: ${syncRes.errors.join('; ')}`);
  }

  return {
    ok: true,
    worktreePath: dest,
    syncedSkills: syncRes.syncedCount,
    runtimePaths: syncRes.runtimePaths,
  };
}

/**
 * Provisions a clean, isolated workspace for a task from the target repository's default branch.
 * For local git repos it leverages git worktree starting cleanly from `origin/<defaultBranch>`;
 * for remote repos it clones depth 1.
 * Always establishes a dedicated task branch `factory/issue-<num>` in an isolated temporary directory
 * and syncs locked skills.
 */
export function provisionTaskWorkspace({
  factoryRoot,
  repo,
  issueNumber,
  defaultBranch = 'main',
  localPath = null,
  branchName = null,
  timestamp = null,
  baseWorkspacesDir = null,
  runner = null,
}) {
  if (runner) {
    return runner({
      action: 'provision_workspace',
      repo,
      issueNumber,
      defaultBranch,
      localPath,
      branchName,
      timestamp,
      baseWorkspacesDir,
    });
  }

  const root = resolve(factoryRoot);
  const safeSlug = String(repo || 'default-repo').replace(/[^a-zA-Z0-9_-]+/g, '_');
  const taskBranch = branchName || `factory/issue-${issueNumber}`;
  const nowStamp = (timestamp || new Date().toISOString()).replace(/[^a-zA-Z0-9]+/g, '-');
  const targetBase = baseWorkspacesDir ? resolve(baseWorkspacesDir) : join(root, 'runs', 'workspaces');
  const workspacePath = join(targetBase, `${safeSlug}-issue-${issueNumber}-${nowStamp}`);

  mkdirSync(workspacePath, { recursive: true });

  const isLocalGit = localPath && existsSync(join(resolve(localPath), '.git'));
  const isFactorySelf = repo && repo.includes('agentic-factory') && existsSync(join(root, '.git'));

  if (isFactorySelf || isLocalGit) {
    const gitSource = isLocalGit ? resolve(localPath) : root;
    try {
      // 1. Fetch latest remote main to guarantee fresh upstream base
      spawnSync('git', ['fetch', 'origin', defaultBranch], { cwd: gitSource, encoding: 'utf8' });

      // 2. Check if origin/<defaultBranch> exists, fallback to <defaultBranch>
      const hasOrigin =
        spawnSync('git', ['rev-parse', '--verify', `origin/${defaultBranch}`], {
          cwd: gitSource,
          encoding: 'utf8',
        }).status === 0;
      const baseCommit = hasOrigin ? `origin/${defaultBranch}` : defaultBranch;

      // 3. Create fresh worktree starting cleanly from baseCommit
      spawnSync('git', ['worktree', 'add', '--force', '-B', taskBranch, workspacePath, baseCommit], {
        cwd: gitSource,
        encoding: 'utf8',
      });
    } catch {
      // fallback handled below
    }
  } else if (repo && repo.includes('/')) {
    // Remote repository
    if (!existsSync(join(workspacePath, '.git'))) {
      const cloneRes = spawnSync(
        'gh',
        ['repo', 'clone', repo, workspacePath, '--', '--depth', '1', '-b', defaultBranch],
        { cwd: root, encoding: 'utf8' },
      );
      if (cloneRes.status !== 0) {
        spawnSync(
          'git',
          ['clone', '--depth', '1', '-b', defaultBranch, `https://github.com/${repo}.git`, workspacePath],
          { cwd: root, encoding: 'utf8' },
        );
      }
    }
    spawnSync('git', ['checkout', '-B', taskBranch], { cwd: workspacePath, encoding: 'utf8' });
  }

  // Synchronize constitution and locked skills
  const prep = prepareWorktree({
    factoryRoot: root,
    targetRepoPath: null,
    worktreePath: workspacePath,
    branchName: taskBranch,
    useGitWorktree: false,
  });

  return {
    ok: true,
    workspacePath,
    branchName: taskBranch,
    defaultBranch,
    repo,
    issueNumber,
    syncedSkills: prep.syncedSkills,
  };
}
