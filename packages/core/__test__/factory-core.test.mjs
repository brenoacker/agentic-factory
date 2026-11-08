import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  loadAndValidateFactory,
  validateWorkflowObject,
  validateContract,
  evaluateIntakeGuards,
  FactoryStore,
  validateGitHubWebhookSignature,
} from '../index.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const CLI = join(ROOT, 'packages', 'core', 'cli.mjs');

test('C1: cli validate passes factory.yaml, 5 workflows, prices, skills lock, and contract fixtures', () => {
  const res = spawnSync(process.execPath, [CLI, 'validate'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}: ${res.stderr}`);
  const out = JSON.parse(res.stdout.trim());
  assert.equal(out.ok, true);
  assert.equal(out.workflowsValidated, 5);
  assert.equal(out.schemasValidated, 4);
  assert.equal(out.lockedSkillsCount, 23);
});

test('C2: workflow validation rejects unlocked skill or missing required fields and accepts locked skill', () => {
  const locked = new Set(['tlc-spec-lean', 'the-judge', 'codenavi']);

  // Valid workflow with locked skill
  const validWf = {
    id: 'feature',
    label: 'type:feature',
    stages: [
      { id: 'plan', mode: 'auto', agent: 'planner', skills: ['tlc-spec-lean'] },
    ],
  };
  const okRes = validateWorkflowObject(validWf, locked);
  assert.equal(okRes.ok, true);
  assert.deepEqual(okRes.errors, []);

  // Unknown skill -> rejected naming workflow and skill
  const badSkillWf = {
    id: 'feature',
    label: 'type:feature',
    stages: [
      { id: 'plan', mode: 'auto', agent: 'planner', skills: ['non-existent-skill'] },
    ],
  };
  const badSkillRes = validateWorkflowObject(badSkillWf, locked);
  assert.equal(badSkillRes.ok, false);
  assert.match(badSkillRes.errors[0], /Workflow "feature"/);
  assert.match(badSkillRes.errors[0], /non-existent-skill/);

  // Missing required fields (`label`, `stages`)
  const missingFieldsRes = validateWorkflowObject({ id: 'broken' }, locked);
  assert.equal(missingFieldsRes.ok, false);
  assert.match(missingFieldsRes.errors.join(' '), /missing required field "label"/);
  assert.match(missingFieldsRes.errors.join(' '), /missing required field "stages"/);
});

test('C3: triage contract enforces non-generic root_cause >= 20 chars, evidence >= 15 chars, and valid impact enum', () => {
  // Rejected case from Live 02: root_cause "bug" and empty evidence
  const bad = validateContract('triage', {
    issue_number: 12,
    type: 'bug',
    impact: 'medium',
    root_cause: 'bug',
    evidence: '',
    affected_paths: ['src/index.ts'],
    needs_human: false,
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.ruleCodes.includes('generic_root_cause'), true);
  assert.equal(bad.ruleCodes.includes('root_cause_too_short'), true);
  assert.equal(bad.ruleCodes.includes('evidence_too_short'), true);

  // Invalid impact enum
  const badImpact = validateContract('triage', {
    issue_number: 12,
    type: 'bug',
    impact: 'critical',
    root_cause: 'Connection pool exhaustion on webhook retry handler',
    evidence: 'stack trace at db.ts:44 shows max_connections=20 exceeded',
    affected_paths: ['src/db.ts'],
    needs_human: false,
  });
  assert.equal(badImpact.ok, false);
  assert.deepEqual(badImpact.ruleCodes, ['invalid_impact']);

  // Accepted detailed triage
  const good = validateContract('triage', {
    issue_number: 12,
    type: 'bug',
    impact: 'medium',
    root_cause: 'Connection pool exhaustion on webhook retry handler',
    evidence: 'stack trace at db.ts:44 shows max_connections=20 exceeded',
    affected_paths: ['src/db.ts'],
    needs_human: false,
  });
  assert.equal(good.ok, true);
  assert.deepEqual(good.ruleCodes, []);
});

test('C4: review contract enforces commit_sha == head_sha on APPROVE and round <= maxReviewRounds (3)', () => {
  // 1. Mismatched SHA on APPROVE -> rejected
  const shaMismatch = validateContract(
    'review',
    {
      issue_number: 7,
      pr_number: 15,
      commit_sha: 'aaaaaaa',
      round: 1,
      verdict: 'APPROVE',
      summary: 'All checks and proofs verified cleanly.',
      findings: [],
      needs_human: false,
    },
    { head_sha: 'bbbbbbb', maxReviewRounds: 3 },
  );
  assert.equal(shaMismatch.ok, false);
  assert.deepEqual(shaMismatch.ruleCodes, ['commit_sha_mismatch']);

  // 2. Round 4 exceeds maxReviewRounds (3) -> rejected
  const roundExceeded = validateContract(
    'review',
    {
      issue_number: 7,
      pr_number: 15,
      commit_sha: 'aaaaaaa',
      round: 4,
      verdict: 'REQUEST_CHANGES',
      summary: 'Still failing edge case on null input.',
      findings: [],
      needs_human: true,
    },
    { head_sha: 'aaaaaaa', maxReviewRounds: 3 },
  );
  assert.equal(roundExceeded.ok, false);
  assert.deepEqual(roundExceeded.ruleCodes, ['max_review_rounds_exceeded']);

  // 3. Matching SHA within 3-round limit -> accepted
  const validReview = validateContract(
    'review',
    {
      issue_number: 7,
      pr_number: 15,
      commit_sha: '64e6a79',
      round: 1,
      verdict: 'APPROVE',
      summary: 'All checks and proofs verified cleanly at HEAD.',
      findings: [],
      needs_human: false,
    },
    { head_sha: '64e6a79', maxReviewRounds: 3 },
  );
  assert.equal(validReview.ok, true);
  assert.deepEqual(validReview.ruleCodes, []);
});

test('C5: stage_token gate accepts first use (200) and rejects replay or stage mismatch with 409', () => {
  const store = new FactoryStore(':memory:');
  try {
    const execKey = 'brenoacker/agentic-factory#10';
    store.createTask({
      executionKey: execKey,
      issueNumber: 10,
      repo: 'brenoacker/agentic-factory',
      title: 'Test stage token',
      type: 'feature',
      stage: 'triage',
    });

    const token = store.issueStageToken(execKey, 'triage');

    // Stage mismatch (`review` instead of `triage`) -> 409 without consuming token
    const wrongStage = store.consumeStageToken({
      token,
      executionKey: execKey,
      stage: 'review',
    });
    assert.equal(wrongStage.status, 409);
    assert.equal(wrongStage.code, 'token_stage_mismatch');
    assert.equal(wrongStage.ok, false);

    // First valid use -> 200 accepted
    const firstUse = store.consumeStageToken({
      token,
      executionKey: execKey,
      stage: 'triage',
    });
    assert.equal(firstUse.status, 200);
    assert.equal(firstUse.code, 'accepted');
    assert.equal(firstUse.ok, true);

    // Replay of the same token -> 409 token_already_used
    const secondUse = store.consumeStageToken({
      token,
      executionKey: execKey,
      stage: 'triage',
    });
    assert.equal(secondUse.status, 409);
    assert.equal(secondUse.code, 'token_already_used');
    assert.equal(secondUse.ok, false);
  } finally {
    store.close();
  }
});

test('C6: evaluateIntakeGuards enforces 5 ordered guards and produces deterministic execution_key', () => {
  const store = new FactoryStore(':memory:');
  try {
    const baseConfig = {
      factory: {
        killSwitch: false,
        limits: { maxTasksPerHour: 2, dailyBudgetUsd: 5.0 },
        projects: [{ id: 'agentic-factory', repo: 'brenoacker/agentic-factory', paused: false }],
      },
    };
    const now = new Date('2026-11-07T12:00:00.000Z');

    // 1. Invalid ticket type
    const gType = evaluateIntakeGuards(
      { issue_number: 1, repo: 'brenoacker/agentic-factory', type: 'invalid' },
      baseConfig,
      store,
      now,
    );
    assert.equal(gType.ok, false);
    assert.equal(gType.code, 'invalid_ticket_type');

    // 2. Kill switch active
    const gPaused = evaluateIntakeGuards(
      { issue_number: 1, repo: 'brenoacker/agentic-factory', type: 'feature' },
      { factory: { ...baseConfig.factory, killSwitch: true } },
      store,
      now,
    );
    assert.equal(gPaused.ok, false);
    assert.equal(gPaused.code, 'factory_paused');

    // All clear on issue #42
    const gOk = evaluateIntakeGuards(
      { issue_number: 42, repo: 'brenoacker/agentic-factory', type: 'feature' },
      baseConfig,
      store,
      now,
    );
    assert.equal(gOk.ok, true);
    assert.equal(gOk.executionKey, 'brenoacker/agentic-factory#42');

    // 2b. Paused project check is case-insensitive
    const gPausedCaseInsensitive = evaluateIntakeGuards(
      { issue_number: 99, repo: 'BrenoAcker/Paused-Repo', type: 'feature' },
      { factory: { ...baseConfig.factory, projects: [{ repo: 'brenoacker/paused-repo', paused: true }] } },
      store,
      now,
    );
    assert.equal(gPausedCaseInsensitive.ok, false);
    assert.equal(gPausedCaseInsensitive.code, 'factory_paused');

    // Persist active task #42
    store.createTask({
      executionKey: gOk.executionKey,
      issueNumber: 42,
      repo: 'brenoacker/agentic-factory',
      type: 'feature',
      stage: 'triage',
      now: '2026-11-07T11:30:00.000Z',
    });

    // 3. Duplicate execution for #42
    const gDup = evaluateIntakeGuards(
      { issue_number: 42, repo: 'brenoacker/agentic-factory', type: 'feature' },
      baseConfig,
      store,
      now,
    );
    assert.equal(gDup.ok, false);
    assert.equal(gDup.code, 'duplicate_execution');

    // Create second task within the hour (#43) to hit maxTasksPerHour = 2
    store.createTask({
      executionKey: 'brenoacker/agentic-factory#43',
      issueNumber: 43,
      repo: 'brenoacker/agentic-factory',
      type: 'bug',
      stage: 'triage',
      now: '2026-11-07T11:45:00.000Z',
    });

    // 4. Rate limit exceeded on #44
    const gRate = evaluateIntakeGuards(
      { issue_number: 44, repo: 'brenoacker/agentic-factory', type: 'bug' },
      baseConfig,
      store,
      now,
    );
    assert.equal(gRate.ok, false);
    assert.equal(gRate.code, 'rate_limit_exceeded');

    // 5. Daily budget exceeded when maxTasksPerHour is raised but spend >= $5.00
    store.recordEvent({
      executionKey: 'brenoacker/agentic-factory#43',
      issueNumber: 43,
      eventType: 'usage',
      stage: 'build',
      runtime: 'antigravity',
      model: 'claude-opus',
      explicitCostUsd: 5.25,
      now: '2026-11-07T11:50:00.000Z',
    });

    const gBudget = evaluateIntakeGuards(
      { issue_number: 44, repo: 'brenoacker/agentic-factory', type: 'bug' },
      { factory: { ...baseConfig.factory, limits: { maxTasksPerHour: 10, dailyBudgetUsd: 5.0 } } },
      store,
      now,
    );
    assert.equal(gBudget.ok, false);
    assert.equal(gBudget.code, 'daily_budget_exceeded');
  } finally {
    store.close();
  }
});

test('C7: cli status aggregates tasks, token usage, USD cost, review metrics, and needsHuman queue', () => {
  const tmp = mkdirSync(join(tmpdir(), `factory-core-c7-${Date.now()}`), { recursive: true });
  const dbFile = join(tmp, 'factory.db');
  try {
    const { pricesConfig } = loadAndValidateFactory(ROOT);
    const store = new FactoryStore(dbFile);

    // Task 1: feature approved on round 1, using claude-sonnet
    // 100,000 uncached input ($0.30) + 100,000 cached ($0.03) + 20,000 output ($0.30) = $0.63
    store.createTask({
      executionKey: 'brenoacker/agentic-factory#1',
      issueNumber: 1,
      repo: 'brenoacker/agentic-factory',
      title: 'Feature 1',
      type: 'feature',
      stage: 'done',
      runtime: 'antigravity',
      model: 'claude-sonnet',
    });
    store.updateTaskStage('brenoacker/agentic-factory#1', {
      stage: 'done',
      reviewRounds: 1,
      approvedFirstRound: true,
    });
    store.recordEvent(
      {
        executionKey: 'brenoacker/agentic-factory#1',
        issueNumber: 1,
        eventType: 'usage',
        stage: 'checks_and_build',
        runtime: 'antigravity',
        model: 'claude-sonnet',
        inputTokens: 200_000,
        cachedTokens: 100_000,
        outputTokens: 20_000,
      },
      pricesConfig,
    );

    // Task 2: bug in review (round 3), needs human
    store.createTask({
      executionKey: 'brenoacker/agentic-factory#2',
      issueNumber: 2,
      repo: 'brenoacker/agentic-factory',
      title: 'Bug 2',
      type: 'bug',
      stage: 'review',
      runtime: 'claude-code',
      model: 'claude-opus',
    });
    store.updateTaskStage('brenoacker/agentic-factory#2', {
      stage: 'review',
      reviewRounds: 3,
      approvedFirstRound: false,
      needsHuman: true,
      humanQuestion: 'Max review rounds (3) reached; please inspect PR #19',
    });
    store.recordEvent(
      {
        executionKey: 'brenoacker/agentic-factory#2',
        issueNumber: 2,
        eventType: 'usage',
        stage: 'review',
        runtime: 'claude-code',
        model: 'claude-opus',
        inputTokens: 50_000,
        cachedTokens: 0,
        outputTokens: 10_000,
        explicitCostUsd: 1.5,
      },
      pricesConfig,
    );
    store.close();

    const res = spawnSync(process.execPath, [CLI, 'status', '--db', dbFile], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
    const status = JSON.parse(res.stdout.trim());
    assert.equal(status.ok, true);
    assert.equal(status.totalTasks, 2);
    assert.deepEqual(status.byStage, { done: 1, review: 1 });
    assert.deepEqual(status.byType, { feature: 1, bug: 1 });
    assert.deepEqual(status.tokens, {
      input: 250_000,
      output: 30_000,
      cached: 100_000,
      total: 280_000,
    });
    assert.equal(status.totalCostUsd, 2.13);
    assert.deepEqual(status.reviewMetrics, {
      reviewedTasks: 2,
      averageReviewRounds: 2,
      firstRoundApprovalRate: 50,
    });
    assert.equal(status.needsHuman.length, 1);
    assert.equal(status.needsHuman[0].issueNumber, 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('C21: validateGitHubWebhookSignature validates valid HMAC-SHA256 signatures and rejects mismatches', async () => {
  const secret = 'webhook-super-secret-key';
  const payload = JSON.stringify({ action: 'opened', issue: { number: 11 } });
  
  // Valid signature
  const crypto = await import('node:crypto');
  const hmac = crypto.createHmac('sha256', secret);
  const validSig = `sha256=${hmac.update(payload).digest('hex')}`;
  
  assert.equal(validateGitHubWebhookSignature({ payload, signature: validSig, secret }), true);
  assert.equal(validateGitHubWebhookSignature({ payload, signature: 'sha256=invalid', secret }), false);
  assert.equal(validateGitHubWebhookSignature({ payload, signature: '', secret }), false);
  assert.equal(validateGitHubWebhookSignature({ payload, signature: validSig, secret: '' }), false);
});
