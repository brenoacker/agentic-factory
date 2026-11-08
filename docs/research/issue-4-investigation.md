# Investigation Report #4: Why do concurrent stage callbacks require a single-use stage token in SQLite?

**Date**: 2026-11-08T18:49:34.170Z
**Type**: investigation

## Answer Summary

Single-use stage tokens prevent duplicate state transitions when a worker retries or a stale process reports late.

## Evidence

- packages/core/src/store.mjs#L340-L359 enforces used === 0 before advancing stage
- packages/core/src/dispatcher.mjs#L190-L205 rejects replayed tokens with 409

## Options Compared

| Option | Pros | Cons |
| --- | --- | --- |
| SQLite atomic stage_tokens table | Zero external dependencies and deterministic 409 on replay | Single-node local SQLite scope |

## Recommendation

Keep atomic stage_tokens verification in FactoryStore before recording stage transition.

## Follow-up Tickets

- **[chore]** Add expired stage_token cleanup job: Prune consumed stage tokens older than 30 days from SQLite.
- **[feature]** Expose token rejection counters in dashboard API: Surface 409 token replay counts on the Control Panel security card.

