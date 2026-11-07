import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildAdapterCommand,
  parseAdapterOutput,
  selectRuntime,
  recordRuntimeFailure,
  pollIssuesWithEtag,
  hasHumanApprovalComment,
  prepareWorktree,
  dispatchTask,
  loadAndValidateFactory,
  FactoryStore,
} from '../index.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

test('C1: buildAdapterCommand and parseAdapterOutput handle antigravity, claude-code, and codex', () => {
  // Antigravity command
  const agyCmd = buildAdapterCommand('antigravity', {
    prompt: 'Execute triage',
    model: 'claude-opus',
    schemaPath: '/tmp/triage.schema.json',
    cwd: '/tmp/work',
  });
  assert.equal(agyCmd.command, 'agy');
  assert.deepEqual(agyCmd.args, [
    '-p',
    'Execute triage',
    '--output-format',
    'json',
    '--mode',
    'auto',
    '--model',
    'claude-opus',
    '--json-schema',
    '/tmp/triage.schema.json',
  ]);

  // Claude Code command
  const claudeCmd = buildAdapterCommand('claude-code', {
    prompt: 'Execute review',
    model: 'claude-sonnet',
    schemaJson: { type: 'object' },
  });
  assert.equal(claudeCmd.command, 'claude');
  assert.deepEqual(claudeCmd.args, [
    '-p',
    'Execute review',
    '--output-format',
    'json',
    '--dangerously-skip-permissions',
    '--model',
    'claude-sonnet',
    '--json-schema',
    '{"type":"object"}',
  ]);

  // Codex command
  const codexCmd = buildAdapterCommand('codex', {
    prompt: 'Fix lint',
    model: 'gpt-5-codex',
    schemaPath: '/tmp/task.schema.json',
  });
  assert.equal(codexCmd.command, 'codex');
  assert.deepEqual(codexCmd.args, [
    'exec',
    '--json',
    '--full-auto',
    '-m',
    'gpt-5-codex',
    '--output-schema',
    '/tmp/task.schema.json',
    'Fix lint',
  ]);

  // Parse Antigravity / Claude Code JSON output with usage and cost
  const agyParsed = parseAdapterOutput(
    'antigravity',
    JSON.stringify({
      structured_output: { issue_number: 5, impact: 'high' },
      usage: { input_tokens: 1200, output_tokens: 350, cache_read_input_tokens: 400 },
      total_cost_usd: 0.042,
    }),
  );
  assert.deepEqual(agyParsed.contract, { issue_number: 5, impact: 'high' });
  assert.deepEqual(agyParsed.usage, {
    inputTokens: 1200,
    outputTokens: 350,
    cachedTokens: 400,
    explicitCostUsd: 0.042,
    estimated: false,
  });

  // Parse Codex NDJSON stream output
  const codexStream = [
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 800, output_tokens: 200, cached_input_tokens: 100 },
      result: { issue_number: 6, verdict: 'APPROVE' },
    }),
  ].join('\n');
  const codexParsed = parseAdapterOutput('codex', codexStream);
  assert.deepEqual(codexParsed.contract, { issue_number: 6, verdict: 'APPROVE' });
  assert.deepEqual(codexParsed.usage, {
    inputTokens: 800,
    outputTokens: 200,
    cachedTokens: 100,
    explicitCostUsd: null,
    estimated: false,
  });
});

test('C2: router selects highest quota healthy runtime and trips circuit breaker on timeout, 500, or 429', () => {
  const store = new FactoryStore(':memory:');
  try {
    const { factoryConfig } = loadAndValidateFactory(ROOT);

    // Default tie at 100 quota -> picks defaultRuntime (`antigravity`)
    const initial = selectRuntime({ impact: 'high', factoryConfig, store });
    assert.equal(initial.ok, true);
    assert.equal(initial.runtime, 'antigravity');
    assert.equal(initial.model, 'claude-opus');

    // Raise claude-code quota to 150 -> router picks claude-code
    store.setRuntimeQuota('claude-code', 150);
    const higherQuota = selectRuntime({ impact: 'medium', factoryConfig, store });
    assert.equal(higherQuota.ok, true);
    assert.equal(higherQuota.runtime, 'claude-code');
    assert.equal(higherQuota.quotaRemaining, 150);

    // Trip claude-code on 429 -> status becomes 'open', router falls back to antigravity (quota 100)
    const tripped429 = recordRuntimeFailure(store, 'claude-code', '429');
    assert.equal(tripped429.status, 'open');
    assert.equal(tripped429.last_error_code, '429');

    const after429 = selectRuntime({ impact: 'medium', factoryConfig, store });
    assert.equal(after429.ok, true);
    assert.equal(after429.runtime, 'antigravity');

    // Trip antigravity on 500 and codex on timeout -> no healthy runtime left
    assert.equal(recordRuntimeFailure(store, 'antigravity', '500').status, 'open');
    assert.equal(recordRuntimeFailure(store, 'codex', 'timeout').status, 'open');

    const noneLeft = selectRuntime({ impact: 'low', factoryConfig, store });
    assert.equal(noneLeft.ok, false);
    assert.equal(noneLeft.code, 'no_healthy_runtime');

    // Manual reset restores antigravity to 'closed'
    const reset = store.resetRuntimeCircuit('antigravity');
    assert.equal(reset.status, 'closed');
    const restored = selectRuntime({ impact: 'low', factoryConfig, store });
    assert.equal(restored.ok, true);
    assert.equal(restored.runtime, 'antigravity');
  } finally {
    store.close();
  }
});

test('C3: pollIssuesWithEtag handles HTTP 304 and HTTP 200 and detects /approve comments', () => {
  // 1. HTTP 304 Not Modified
  const res304 = pollIssuesWithEtag({
    repo: 'brenoacker/agentic-factory',
    etag: 'W/"etag-1"',
    runner: ({ headers }) => {
      assert.equal(headers['If-None-Match'], 'W/"etag-1"');
      return { status: 304, etag: 'W/"etag-1"', body: null };
    },
  });
  assert.equal(res304.notModified, true);
  assert.equal(res304.etag, 'W/"etag-1"');
  assert.deepEqual(res304.issues, []);

  // 2. HTTP 200 with open issue and PR filtered out
  const res200 = pollIssuesWithEtag({
    repo: 'brenoacker/agentic-factory',
    etag: 'W/"etag-1"',
    runner: () => ({
      status: 200,
      etag: 'W/"etag-2"',
      body: [
        {
          number: 11,
          title: '[feature] Add budget widget',
          body: '### Projeto-alvo\nbrenoacker/agentic-factory',
          labels: [{ name: 'type:feature' }, { name: 'stage:triage' }, { name: 'runtime:claude-code' }],
        },
        {
          number: 12,
          title: 'PR should be ignored',
          pull_request: { url: 'https://api.github.com/pulls/12' },
        },
      ],
    }),
  });
  assert.equal(res200.notModified, false);
  assert.equal(res200.etag, 'W/"etag-2"');
  assert.equal(res200.issues.length, 1);
  assert.equal(res200.issues[0].issue_number, 11);
  assert.equal(res200.issues[0].type, 'feature');
  assert.equal(res200.issues[0].stage, 'triage');
  assert.equal(res200.issues[0].runtime_override, 'claude-code');

  // 3. /approve comment detection
  const noApprove = hasHumanApprovalComment([{ body: 'Looking into this', user: { login: 'brenoacker' } }]);
  assert.equal(noApprove.approved, false);

  const yesApprove = hasHumanApprovalComment([
    { body: 'Question first', user: { login: 'brenoacker' } },
    { body: '/approve LGTM go ahead', user: { login: 'brenoacker' }, created_at: '2026-11-07T12:15:00Z' },
  ]);
  assert.equal(yesApprove.approved, true);
  assert.equal(yesApprove.approver, 'brenoacker');
  assert.equal(yesApprove.approvedAt, '2026-11-07T12:15:00Z');
});

test('C4: prepareWorktree copies AGENTS.md/CLAUDE.md and syncs all 23 locked skills', () => {
  const tmpWt = mkdirSync(join(tmpdir(), `wt-c4-${Date.now()}`), { recursive: true });
  try {
    const res = prepareWorktree({
      factoryRoot: ROOT,
      worktreePath: tmpWt,
      useGitWorktree: false,
    });
    assert.equal(res.ok, true);
    assert.equal(res.syncedSkills, 23);
    assert.equal(existsSync(join(tmpWt, 'AGENTS.md')), true);
    assert.equal(existsSync(join(tmpWt, 'CLAUDE.md')), true);
    assert.equal(existsSync(join(tmpWt, '.agents', 'skills', 'tlc-spec-lean', 'SKILL.md')), true);
    assert.equal(existsSync(join(tmpWt, '.claude', 'skills', 'tlc-spec-lean', 'SKILL.md')), true);
  } finally {
    rmSync(tmpWt, { recursive: true, force: true });
  }
});

test('C5: dispatchTask executes gated feature workflow, pauses at human gates, and resumes on approval', () => {
  const store = new FactoryStore(':memory:');
  try {
    const { factoryConfig, workflows, pricesConfig } = loadAndValidateFactory(ROOT);
    const execKey = 'brenoacker/agentic-factory#25';
    store.createTask({
      executionKey: execKey,
      issueNumber: 25,
      repo: 'brenoacker/agentic-factory',
      title: '[feature] Telemetry chart',
      type: 'feature',
      stage: 'triage',
    });

    const mockRunner = ({ stage, stageToken }) => {
      if (stage === 'triage') {
        return {
          ok: true,
          stdout: JSON.stringify({
            structured_output: {
              stage_token: stageToken,
              issue_number: 25,
              type: 'feature',
              impact: 'high',
              root_cause: 'Missing telemetry chart component in panel overview screen',
              evidence: 'apps/panel/overview has no token breakdown chart yet',
              affected_paths: ['apps/panel/index.html'],
              needs_human: false,
            },
            usage: { input_tokens: 1000, output_tokens: 250, cache_read_input_tokens: 0 },
          }),
        };
      }
      if (stage === 'review') {
        return {
          ok: true,
          stdout: JSON.stringify({
            structured_output: {
              stage_token: stageToken,
              issue_number: 25,
              pr_number: 30,
              commit_sha: '64e6a79',
              round: 1,
              verdict: 'APPROVE',
              summary: 'All checks and proofs pass at HEAD 64e6a79.',
              findings: [],
              needs_human: false,
            },
            usage: { input_tokens: 2000, output_tokens: 400, cache_read_input_tokens: 500 },
          }),
        };
      }
      return {
        ok: true,
        stdout: JSON.stringify({
          structured_output: { stage_token: stageToken, status: 'ok', stage },
          usage: { input_tokens: 1500, output_tokens: 300, cache_read_input_tokens: 0 },
        }),
      };
    };

    // Pass 1: runs `triage` (sets impact=high -> model=claude-opus) and `plan`, then pauses at `plan` human gate
    const run1 = dispatchTask({
      executionKey: execKey,
      factoryRoot: ROOT,
      factoryConfig,
      workflows,
      pricesConfig,
      store,
      runner: mockRunner,
      headSha: '64e6a79',
    });
    assert.equal(run1.ok, true);
    assert.equal(run1.status, 'paused_for_human');
    assert.equal(run1.stage, 'plan');
    assert.deepEqual(run1.stepsExecuted, ['triage', 'plan']);
    assert.equal(run1.task.impact, 'high');
    assert.equal(run1.task.model, 'claude-opus');
    assert.equal(run1.task.needs_human, 1);

    // Pass 2: operator approves `plan` -> advances through `checks_and_build`, `verify`, `review`, and pauses at `merge`
    const run2 = dispatchTask({
      executionKey: execKey,
      factoryRoot: ROOT,
      factoryConfig,
      workflows,
      pricesConfig,
      store,
      runner: mockRunner,
      headSha: '64e6a79',
      humanApprovedCurrentStage: true,
    });
    assert.equal(run2.ok, true);
    assert.equal(run2.status, 'paused_for_human');
    assert.equal(run2.stage, 'merge');
    assert.deepEqual(run2.stepsExecuted, ['checks_and_build', 'verify', 'review']);
    assert.equal(run2.task.review_rounds, 1);
    assert.equal(run2.task.approved_first_round, 1);
    assert.equal(run2.task.input_tokens, 7500);
    assert.equal(run2.task.output_tokens, 1550);
    assert.equal(run2.task.cost_usd > 0, true);

    // Pass 3: operator approves `merge` -> task completes (`done`)
    const run3 = dispatchTask({
      executionKey: execKey,
      factoryRoot: ROOT,
      factoryConfig,
      workflows,
      pricesConfig,
      store,
      runner: mockRunner,
      headSha: '64e6a79',
      humanApprovedCurrentStage: true,
    });
    assert.equal(run3.ok, true);
    assert.equal(run3.status, 'completed');
    assert.equal(run3.stage, 'done');
    assert.equal(run3.task.needs_human, 0);
  } finally {
    store.close();
  }
});

test('C6: dispatchTask loops on REQUEST_CHANGES and halts with needs_human at maxReviewRounds (3)', () => {
  const store = new FactoryStore(':memory:');
  try {
    const { factoryConfig, workflows, pricesConfig } = loadAndValidateFactory(ROOT);
    const execKey = 'brenoacker/agentic-factory#99';
    store.createTask({
      executionKey: execKey,
      issueNumber: 99,
      repo: 'brenoacker/agentic-factory',
      title: '[bug] Persistent review failure',
      type: 'bug',
      stage: 'checks_and_build',
    });

    const failingReviewRunner = ({ stage, stageToken, round }) => {
      if (stage === 'review') {
        return {
          ok: true,
          stdout: JSON.stringify({
            structured_output: {
              stage_token: stageToken,
              issue_number: 99,
              pr_number: 40,
              commit_sha: '64e6a79',
              round,
              verdict: 'REQUEST_CHANGES',
              summary: `Round ${round} still missing null check on payload.`,
              findings: [
                {
                  severity: 'major',
                  file: 'src/handler.ts',
                  line: 14,
                  message: 'Missing null guard before dereferencing payload',
                  evidence: 'payload.id throws TypeError on null',
                },
              ],
              needs_human: false,
            },
            usage: { input_tokens: 500, output_tokens: 100, cache_read_input_tokens: 0 },
          }),
        };
      }
      return {
        ok: true,
        stdout: JSON.stringify({
          structured_output: { stage_token: stageToken, status: 'ok', stage },
          usage: { input_tokens: 500, output_tokens: 100, cache_read_input_tokens: 0 },
        }),
      };
    };

    const res = dispatchTask({
      executionKey: execKey,
      factoryRoot: ROOT,
      factoryConfig,
      workflows,
      pricesConfig,
      store,
      runner: failingReviewRunner,
      headSha: '64e6a79',
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 'max_review_rounds_reached');
    assert.equal(res.stage, 'review');
    assert.equal(res.task.review_rounds, 3);
    assert.equal(res.task.needs_human, 1);
    assert.match(res.task.human_question, /max_review_rounds_reached \(3\/3\)/);
    assert.deepEqual(res.stepsExecuted, [
      'checks_and_build',
      'verify',
      'review',
      'checks_and_build',
      'verify',
      'review',
      'checks_and_build',
      'verify',
      'review',
    ]);
  } finally {
    store.close();
  }
});
