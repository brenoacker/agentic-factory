#!/usr/bin/env node
// Factory Core CLI: validate | status | intake | contract-check
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadAndValidateFactory } from './src/config.mjs';
import { validateContract, verifyContractSchemasOnDisk } from './src/contracts.mjs';
import { evaluateIntakeGuards } from './src/guards.mjs';
import { FactoryStore } from './src/store.mjs';

const args = process.argv.slice(2);
const subcommand = args[0];
let root = resolve(import.meta.dirname, '..', '..');
let dbPath = null;
let kind = null;
let file = null;
let headSha = null;

for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--root' && i + 1 < args.length) {
    root = resolve(args[++i]);
  } else if (arg === '--db' && i + 1 < args.length) {
    dbPath = resolve(args[++i]);
  } else if (arg === '--kind' && i + 1 < args.length) {
    kind = args[++i];
  } else if (arg === '--file' && i + 1 < args.length) {
    file = resolve(args[++i]);
  } else if (arg === '--head-sha' && i + 1 < args.length) {
    headSha = args[++i];
  } else {
    process.stderr.write(`Unknown or incomplete flag: ${arg}\n`);
    process.exit(2);
  }
}

const resolvedDbPath = dbPath || join(root, 'runs', 'factory.db');

if (subcommand === 'validate') {
  const cfg = loadAndValidateFactory(root);
  const schemas = verifyContractSchemasOnDisk(root);
  const errors = [...cfg.errors, ...schemas.errors];
  if (errors.length > 0) {
    for (const err of errors) {
      process.stderr.write(`${err}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      workflowsValidated: cfg.workflowsValidated,
      schemasValidated: schemas.schemasChecked,
      lockedSkillsCount: cfg.lockedSkills.length,
    })}\n`,
  );
} else if (subcommand === 'status') {
  const store = new FactoryStore(resolvedDbPath);
  try {
    const summary = store.getStatusSummary();
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    store.close();
  }
} else if (subcommand === 'contract-check') {
  if (!kind || !file) {
    process.stderr.write('Usage: cli.mjs contract-check --kind <task|triage|investigation-report|review> --file <json>\n');
    process.exit(2);
  }
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  const res = validateContract(kind, payload, { head_sha: headSha });
  if (!res.ok) {
    for (const err of res.errors) {
      process.stderr.write(`${err}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(res)}\n`);
} else if (subcommand === 'intake') {
  if (!file) {
    process.stderr.write('Usage: cli.mjs intake --file <issue.json> [--db <path>]\n');
    process.exit(2);
  }
  const cfg = loadAndValidateFactory(root);
  if (!cfg.ok) {
    for (const err of cfg.errors) process.stderr.write(`${err}\n`);
    process.exit(1);
  }
  const issue = JSON.parse(readFileSync(file, 'utf8'));
  const store = new FactoryStore(resolvedDbPath);
  try {
    const guard = evaluateIntakeGuards(issue, cfg.factoryConfig, store);
    if (!guard.ok) {
      process.stderr.write(`${guard.code}: ${guard.reason}\n`);
      process.exit(1);
    }
    const task = store.createTask({
      executionKey: guard.executionKey,
      issueNumber: issue.issue_number,
      repo: issue.repo,
      title: issue.title || '',
      type: issue.type,
      stage: 'triage',
      runtime: issue.runtime_override || cfg.factoryConfig.factory.defaultRuntime,
    });
    process.stdout.write(`${JSON.stringify({ ok: true, executionKey: guard.executionKey, task })}\n`);
  } finally {
    store.close();
  }
} else {
  process.stderr.write(`Unknown subcommand: ${subcommand || '(none)'}\n`);
  process.exit(2);
}
