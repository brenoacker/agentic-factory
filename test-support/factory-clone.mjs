// Hermetic factory clone for unit and E2E tests.
//
// Tests must not depend on operator state committed to the live `factory.yaml`
// (e.g. monitored projects added through the panel). The clone copies the real
// config, skills, and workflows, then pins `factory.projects` to a single
// canonical fixture project so assertions stay stable as the operator's config evolves.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

export const REPO_ROOT = resolve(import.meta.dirname, '..');

export const FIXTURE_PROJECTS = [
  { id: 'agentic-factory', repo: 'brenoacker/agentic-factory', defaultBranch: 'main', paused: false },
];

const DEFAULT_ITEMS = ['factory.yaml', 'skills.lock.json', 'config', 'workflows', 'contracts', 'brain', 'agents', 'skills'];

export function makeTempFactoryClone({ prefix = 'agentic-factory-test-', items = DEFAULT_ITEMS } = {}) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  for (const item of items) {
    cpSync(join(REPO_ROOT, item), join(dir, item), { recursive: true });
  }
  pinFixtureProjects(dir);
  return dir;
}

function pinFixtureProjects(dir) {
  const path = join(dir, 'factory.yaml');
  const raw = readFileSync(path, 'utf8');
  const header = raw.split('\n').filter((line) => line.trim().startsWith('#')).join('\n');
  const config = JSON.parse(raw.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n'));
  config.factory.projects = structuredClone(FIXTURE_PROJECTS);
  writeFileSync(path, `${header ? `${header}\n` : ''}${JSON.stringify(config, null, 2)}\n`);
}
