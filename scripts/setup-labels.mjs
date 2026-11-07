#!/usr/bin/env node
// Sincroniza os labels de .github/labels.json com o repositório via gh CLI (idempotente).
// Uso: node scripts/setup-labels.mjs [owner/repo]
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const repo = process.argv[2];
const labels = JSON.parse(readFileSync(new URL('../.github/labels.json', import.meta.url), 'utf8'));
const repoArgs = repo ? ['--repo', repo] : [];

for (const { name, color, description } of labels) {
  execFileSync('gh', ['label', 'create', name, '--color', color, '--description', description, '--force', ...repoArgs], {
    stdio: 'inherit',
  });
}
console.log(`ok: ${labels.length} labels`);
