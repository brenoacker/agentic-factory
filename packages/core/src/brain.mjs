import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateContract } from './contracts.mjs';

/**
 * Loads all specialist agent definitions from `agents/*.json`.
 */
export function listAgentsCatalog(rootDir) {
  const agentsDir = join(resolve(rootDir), 'agents');
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(agentsDir, f), 'utf8')));
}

/**
 * Loads the factory's long-term memory documents (`brain/*.md`, `.specs/STATE.md`, `.specs/LESSONS.md`).
 */
export function loadBrainEntries(rootDir) {
  const root = resolve(rootDir);
  const entries = [];

  const brainDir = join(root, 'brain');
  if (existsSync(brainDir)) {
    for (const file of readdirSync(brainDir).filter((f) => f.endsWith('.md')).sort()) {
      entries.push({
        source: `brain/${file}`,
        kind: 'brain',
        content: readFileSync(join(brainDir, file), 'utf8'),
      });
    }
  }

  for (const specDoc of ['.specs/STATE.md', '.specs/LESSONS.md']) {
    const full = join(root, specDoc);
    if (existsSync(full)) {
      entries.push({
        source: specDoc,
        kind: specDoc.includes('STATE') ? 'decisions' : 'lessons',
        content: readFileSync(full, 'utf8'),
      });
    }
  }

  return entries;
}

/**
 * Searches the factory's brain entries by case-insensitive keyword query.
 */
export function queryBrain(rootDir, query = '') {
  const entries = loadBrainEntries(rootDir);
  const q = (query || '').trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) => e.source.toLowerCase().includes(q) || e.content.toLowerCase().includes(q),
  );
}

/**
 * Validates an `investigation-report` contract and converts its `follow_up_tickets` into
 * ready-to-intake task payloads for the factory.
 */
export function extractFollowUpTickets(reportPayload, defaultRepo = 'brenoacker/agentic-factory') {
  const check = validateContract('investigation-report', reportPayload);
  if (!check.ok) {
    throw new Error(`Invalid investigation-report contract: ${check.errors.join('; ')}`);
  }
  return (reportPayload.follow_up_tickets || []).map((t, idx) => ({
    parent_issue: reportPayload.issue_number,
    sequence: idx + 1,
    repo: defaultRepo,
    title: `[${t.type}] ${t.title}`,
    type: t.type,
    body: t.description,
    labels: [`type:${t.type}`, 'stage:triage'],
  }));
}

/**
 * Evaluates whether a task in `merge` stage can be merged automatically without human intervention
 * under the `auto-low` autonomy level (requires `impact == 'low'`, `verdict == 'APPROVE'`, and `commit_sha == head_sha`).
 */
export function canAutoMergeTask({ autonomy, impact, reviewContract, headSha }) {
  if (autonomy !== 'auto-low') return false;
  if (impact !== 'low') return false;
  if (!reviewContract || reviewContract.verdict !== 'APPROVE') return false;
  if (!headSha || !reviewContract.commit_sha) return false;
  return (
    headSha.startsWith(reviewContract.commit_sha) ||
    reviewContract.commit_sha.startsWith(headSha)
  );
}
