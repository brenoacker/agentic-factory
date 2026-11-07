const CIRCUIT_TRIP_CODES = new Set(['timeout', '500', '429', 500, 429]);

/**
 * Selects an execution runtime and model in manual (`runtimeOverride`) or automatic mode.
 * In automatic mode, filters to enabled runtimes with `status == 'closed'` and `quota_remaining > 0`,
 * picking the one with the highest `quota_remaining` (ties broken by `defaultRuntime`).
 */
export function selectRuntime({
  impact = 'medium',
  runtimeOverride = null,
  factoryConfig,
  store,
}) {
  const f = factoryConfig?.factory || factoryConfig || {};
  const defaultRt = f.defaultRuntime || 'antigravity';
  const impactMap = f.modelByImpact?.[impact] || { runtime: defaultRt, model: 'claude-sonnet' };
  const runtimesCfg = f.runtimes || {
    antigravity: { enabled: true },
    'claude-code': { enabled: true },
    codex: { enabled: true },
  };

  if (runtimeOverride) {
    const health = store ? store.getRuntimeHealth(runtimeOverride) : { status: 'closed', quota_remaining: 100 };
    if (health && health.status === 'open') {
      return {
        ok: false,
        code: 'circuit_open',
        reason: `Requested runtime "${runtimeOverride}" has an open circuit breaker (${health.last_error_code})`,
      };
    }
    return {
      ok: true,
      runtime: runtimeOverride,
      model: impactMap.model,
      mode: 'manual',
    };
  }

  const healthList = store
    ? store.listRuntimeHealth()
    : [
        { runtime: 'antigravity', status: 'closed', quota_remaining: 100 },
        { runtime: 'claude-code', status: 'closed', quota_remaining: 100 },
        { runtime: 'codex', status: 'closed', quota_remaining: 100 },
      ];

  const candidates = healthList.filter((h) => {
    const cfg = runtimesCfg[h.runtime];
    return (!cfg || cfg.enabled !== false) && h.status === 'closed' && h.quota_remaining > 0;
  });

  if (candidates.length === 0) {
    return {
      ok: false,
      code: 'no_healthy_runtime',
      reason: 'All runtimes have open circuit breakers or zero remaining quota',
    };
  }

  const preferredRt = impactMap.runtime || defaultRt;
  candidates.sort((a, b) => {
    if (b.quota_remaining !== a.quota_remaining) {
      return b.quota_remaining - a.quota_remaining;
    }
    if (a.runtime === preferredRt) return -1;
    if (b.runtime === preferredRt) return 1;
    if (a.runtime === defaultRt) return -1;
    if (b.runtime === defaultRt) return 1;
    return a.runtime.localeCompare(b.runtime);
  });

  return {
    ok: true,
    runtime: candidates[0].runtime,
    model: impactMap.model,
    quotaRemaining: candidates[0].quota_remaining,
    mode: 'auto',
  };
}

/**
 * Records a runtime error; if the error code is `timeout`, `500`, or `429`, trips the circuit breaker to `open`.
 */
export function recordRuntimeFailure(store, runtime, errorCode, now = new Date().toISOString()) {
  if (CIRCUIT_TRIP_CODES.has(errorCode) || CIRCUIT_TRIP_CODES.has(String(errorCode))) {
    return store.tripRuntimeCircuit(runtime, String(errorCode), now);
  }
  return store.getRuntimeHealth(runtime);
}
