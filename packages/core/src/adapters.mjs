import { spawnSync } from 'node:child_process';

/**
 * Builds the non-interactive CLI command and arguments for Antigravity, Claude Code, or Codex (Door 3).
 */
export function buildAdapterCommand(runtime, { prompt, model, schemaPath, schemaJson, cwd } = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Adapter prompt must be a non-empty string');
  }

  if (runtime === 'antigravity') {
    const args = ['-p', prompt, '--output-format', 'json', '--mode', 'auto'];
    if (model) args.push('--model', model);
    if (schemaPath) args.push('--json-schema', schemaPath);
    return { command: 'agy', args, cwd };
  }

  if (runtime === 'claude-code') {
    const args = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];
    if (model) args.push('--model', model);
    if (schemaJson) {
      args.push('--json-schema', typeof schemaJson === 'string' ? schemaJson : JSON.stringify(schemaJson));
    }
    return { command: 'claude', args, cwd };
  }

  if (runtime === 'codex') {
    const args = ['exec', '--json', '--full-auto'];
    if (model) args.push('-m', model);
    if (schemaPath) args.push('--output-schema', schemaPath);
    args.push(prompt);
    return { command: 'codex', args, cwd };
  }

  throw new Error(`Unsupported runtime: ${runtime}`);
}

/**
 * Parses stdout from `agy -p --output-format json`, `claude -p --output-format json`, or `codex exec --json`.
 * Extracts the structured contract object and token usage, falling back to deterministic char-based token
 * estimation if the CLI omitted token counters.
 */
export function parseAdapterOutput(runtime, stdout, promptText = '') {
  const raw = (stdout || '').trim();
  if (!raw) {
    throw new Error(`Empty output from runtime ${runtime}`);
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let explicitCostUsd = null;
  let contract = null;
  let estimated = false;

  const lines = raw.split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
  if (runtime === 'codex' && lines.length > 1) {
    // Codex NDJSON stream: scan events for usage and final message/contract
    for (const line of lines) {
      const evt = JSON.parse(line);
      if (evt.usage) {
        inputTokens += Number(evt.usage.input_tokens ?? evt.usage.prompt_tokens ?? 0);
        outputTokens += Number(evt.usage.output_tokens ?? evt.usage.completion_tokens ?? 0);
        cachedTokens += Number(evt.usage.cached_input_tokens ?? evt.usage.cache_read_input_tokens ?? 0);
      }
      if (evt.contract && typeof evt.contract === 'object') {
        contract = evt.contract;
      } else if (evt.result && typeof evt.result === 'object') {
        contract = evt.result;
      } else if (typeof evt.text === 'string' && evt.text.trim().startsWith('{')) {
        try {
          contract = JSON.parse(evt.text.trim());
        } catch {
          // keep scanning
        }
      }
    }
  } else {
    const parsed = JSON.parse(raw);
    const usageObj = parsed.usage || parsed.metadata?.usage || null;
    if (usageObj) {
      inputTokens = Number(usageObj.input_tokens ?? usageObj.prompt_tokens ?? 0);
      outputTokens = Number(usageObj.output_tokens ?? usageObj.completion_tokens ?? 0);
      cachedTokens = Number(usageObj.cache_read_input_tokens ?? usageObj.cached_input_tokens ?? 0);
    }
    if (typeof parsed.total_cost_usd === 'number') {
      explicitCostUsd = parsed.total_cost_usd;
    } else if (typeof parsed.cost_usd === 'number') {
      explicitCostUsd = parsed.cost_usd;
    }

    if (parsed.structured_output && typeof parsed.structured_output === 'object') {
      contract = parsed.structured_output;
    } else if (parsed.contract && typeof parsed.contract === 'object') {
      contract = parsed.contract;
    } else if (parsed.result && typeof parsed.result === 'object') {
      contract = parsed.result;
    } else if (typeof parsed.result === 'string' && parsed.result.trim().startsWith('{')) {
      contract = JSON.parse(parsed.result.trim());
    } else if (typeof parsed.response === 'string' && parsed.response.trim().startsWith('{')) {
      contract = JSON.parse(parsed.response.trim());
    } else {
      contract = parsed;
    }
  }

  if (inputTokens === 0 && outputTokens === 0) {
    estimated = true;
    inputTokens = Math.max(1, Math.ceil((promptText || '').length / 4));
    outputTokens = Math.max(1, Math.ceil(raw.length / 4));
  }

  return {
    contract,
    usage: {
      inputTokens,
      outputTokens,
      cachedTokens,
      explicitCostUsd,
      estimated,
    },
  };
}

/**
 * Executes a runtime adapter (or uses an injected `runner` in tests).
 */
export function invokeRuntimeAdapter({ runtime, prompt, model, schemaPath, schemaJson, cwd, timeoutMs = 1800000, runner = null }) {
  const spec = buildAdapterCommand(runtime, { prompt, model, schemaPath, schemaJson, cwd });
  const start = Date.now();

  if (runner) {
    const res = runner({ runtime, ...spec, prompt, model, cwd });
    const durationMs = res.durationMs ?? Date.now() - start;
    if (!res.ok) {
      return {
        ok: false,
        errorCode: res.errorCode || 'execution_error',
        stderr: res.stderr || '',
        durationMs,
      };
    }
    const parsed = parseAdapterOutput(runtime, res.stdout, prompt);
    return {
      ok: true,
      contract: parsed.contract,
      usage: parsed.usage,
      durationMs,
    };
  }

  const proc = spawnSync(spec.command, spec.args, {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
    timeout: timeoutMs,
  });

  const durationMs = Date.now() - start;
  if (proc.error && proc.error.code === 'ETIMEDOUT') {
    return { ok: false, errorCode: 'timeout', stderr: 'Stage timed out', durationMs };
  }
  const combinedErr = `${proc.stderr || ''} ${proc.stdout || ''}`;
  if (proc.status !== 0) {
    let errorCode = 'execution_error';
    if (/429|rate[_\s-]?limit/i.test(combinedErr)) errorCode = '429';
    else if (/500|internal server error|overloaded/i.test(combinedErr)) errorCode = '500';
    return { ok: false, errorCode, stderr: proc.stderr || proc.stdout || '', durationMs };
  }

  const parsed = parseAdapterOutput(runtime, proc.stdout, prompt);
  return {
    ok: true,
    contract: parsed.contract,
    usage: parsed.usage,
    durationMs,
  };
}
