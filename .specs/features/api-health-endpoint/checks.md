# Control Panel Healthcheck Endpoint checks

Build: `node --check apps/panel/server.mjs; node --check packages/core/src/store.mjs`
Run unit: `node --test apps/panel/__test__/control-panel.test.mjs`
Plan: `.specs/features/api-health-endpoint/plan.md`

2 checks in 1 slice · 1 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Control Panel Healthcheck Endpoint

**C1** - `GET /api/health` returns status `200` with JSON payload containing `status: "healthy"`, `version: "1.0.0"`, `uptimeSeconds` as a positive number, and `database: "connected"` when database is connected (AC 1)
Proof: run unit | ✔ C1: GET /api/health returns 200 with status healthy, version 1.0.0, uptimeSeconds, and database connected

**C2** - `GET /api/health` returns status `503` with JSON payload containing `status: "unhealthy"` and `database: "disconnected"` when the database connection query fails (AC 2)
Proof: run unit | ✔ C2: GET /api/health returns 503 with status unhealthy and database disconnected when database fails

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (1) | Door 1 (Healthcheck contract response) C1, C2 | - |
| `GET /api/health` statuses (2) | `200` C1 · `503` C2 | - |
| Database connectivity, AC 2 (2 examples) | connected C1 · disconnected C2 | - |

## Swept

- validation: n/a - GET request takes no body or query parameters
- failure modes: C2
- idempotency: C1
- authorization: n/a - local single-operator control plane healthcheck bound to 127.0.0.1
- concurrency: C1
- data lifecycle: n/a - read-only endpoint with no data retention or persistence
- dependency failure: C2
- state transitions: n/a - read-only query that does not mutate task or system state
- observability: C1

## Handoff

- **Settled mid-build:** none
- **Dispatched:** none
- **Boundary:** none
- **Abandoned:** none
