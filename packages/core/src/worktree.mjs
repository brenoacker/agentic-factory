import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { syncSkills } from '../../../scripts/lib/skills-sync.mjs';

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
