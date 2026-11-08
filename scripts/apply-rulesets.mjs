#!/usr/bin/env node
// Applies .github/rulesets/*.json to the GitHub repository (create or update by name)
// and the PR-related repository settings. Requires an authenticated `gh` with admin rights.
//
//   node scripts/apply-rulesets.mjs [--repo owner/name] [--dry-run]
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const repoFlag = args.indexOf('--repo');
const repo = repoFlag >= 0 ? args[repoFlag + 1] : readFactoryRepo();

const REPO_SETTINGS = {
  delete_branch_on_merge: true,
  allow_auto_merge: true,
  allow_merge_commit: false,
  allow_squash_merge: true,
  allow_rebase_merge: true,
  squash_merge_commit_title: 'PR_TITLE',
  squash_merge_commit_message: 'PR_BODY',
};

function readFactoryRepo() {
  const raw = readFileSync(join(ROOT, 'factory.yaml'), 'utf8');
  const json = raw.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  return JSON.parse(json).factory.repo;
}

function gh(method, path, body) {
  const cmd = ['api', '-X', method, path, '-H', 'Accept: application/vnd.github+json'];
  if (body) cmd.push('--input', '-');
  if (dryRun && method !== 'GET') {
    console.log(`[dry-run] gh ${cmd.join(' ')}`);
    return null;
  }
  const out = execFileSync('gh', cmd, { input: body ? JSON.stringify(body) : undefined, encoding: 'utf8' });
  return out ? JSON.parse(out) : null;
}

gh('PATCH', `repos/${repo}`, REPO_SETTINGS);
console.log(`repo settings applied to ${repo}`);

const existing = gh('GET', `repos/${repo}/rulesets`) ?? [];
const dir = join(ROOT, '.github', 'rulesets');
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const ruleset = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const match = existing.find((r) => r.name === ruleset.name);
  if (match) {
    gh('PUT', `repos/${repo}/rulesets/${match.id}`, ruleset);
    console.log(`updated ruleset "${ruleset.name}" (#${match.id})`);
  } else {
    const created = gh('POST', `repos/${repo}/rulesets`, ruleset);
    console.log(`created ruleset "${ruleset.name}"${created ? ` (#${created.id})` : ''}`);
  }
}
