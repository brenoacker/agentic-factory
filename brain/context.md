# Factory Brain — Context & Operating Rules

## Architecture & Control Plane

- **Prosa pede. Contrato garante**: Every automated stage outputs a JSON contract validated against `contracts/*.schema.json`.
- **Single Funnel**: All tasks enter as GitHub Issues in `brenoacker/agentic-factory` (`type:feature`, `type:bug`, `type:investigation`, `type:discovery`, `type:chore`).
- **Locked Skills**: Coding tasks always run `tlc-spec-lean` v2.2.0 (`PLAN -> CHECKS -> BUILD -> VERIFY`), and code review runs `the-judge` locked to the exact `commit_sha`.
- **Impact Scale (TLC Rule)**:
  - `low`: Single vertical slice, reversible with a simple `git revert`, no schema migration (`gemini-flash`).
  - `medium`: Multiple slices, user-visible UI/API change, additive migration only (`claude-sonnet`).
  - `high`: Breaking change, destructive migration, or security/core boundary (`claude-opus`).
