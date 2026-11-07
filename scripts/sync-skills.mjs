#!/usr/bin/env node
// Verifies skills.lock.json and synchronizes locked skills into .agents/skills (Antigravity/Codex)
// and .claude/skills (Claude Code).
// Usage: node scripts/sync-skills.mjs [--verify-only] [--target <dir>] [--root <dir>] [--lock <file>]
import { resolve } from 'node:path';
import { syncSkills } from './lib/skills-sync.mjs';

const args = process.argv.slice(2);
let verifyOnly = false;
let target = null;
let root = resolve(import.meta.dirname, '..');
let lockPath = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--verify-only') {
    verifyOnly = true;
  } else if (arg === '--target' && i + 1 < args.length) {
    target = args[++i];
  } else if (arg === '--root' && i + 1 < args.length) {
    root = resolve(args[++i]);
  } else if (arg === '--lock' && i + 1 < args.length) {
    lockPath = resolve(args[++i]);
  } else {
    process.stderr.write(`Unknown or incomplete flag: ${arg}\n`);
    process.exit(2);
  }
}

const result = syncSkills({
  root,
  lockPath,
  target: target ? resolve(target) : root,
  verifyOnly,
});

if (!result.ok) {
  for (const err of result.errors) {
    process.stderr.write(`${err}\n`);
  }
  process.exit(1);
}

process.stdout.write(`${JSON.stringify(result)}\n`);
