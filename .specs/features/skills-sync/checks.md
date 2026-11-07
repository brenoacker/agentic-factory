# Skills Synchronization and Vendor Lock checks

Build: `node --check scripts/sync-skills.mjs`; `node --check scripts/lib/skills-sync.mjs`
Run unit: `node --test scripts/__test__/skills-sync.test.mjs`
Plan: `.specs/features/skills-sync/plan.md`

6 checks in 1 slice · 2 one-way doors · 0 open, of which 0 block

## Checks

### S1 - Vendor Lock & Multi-Runtime Sync

**C1** - `skills.lock.json` pins `tlc-spec-lean` at `2.2.0` (`8658b6658c762b9e5efd3956ed35a51c41bdf6c3`) and all 23 core TLC skills with valid 64-hex SHA-256 tree digests (AC 1)
Proof: run unit | ✔ C1: skills.lock.json pins tlc-spec-lean 2.2.0 and all 23 skills with valid sha256 digests

**C2** - `node scripts/sync-skills.mjs --verify-only` exits `0` and prints JSON with `"ok":true` and `"verifiedCount":23` on an intact tree (AC 2)
Proof: run unit | ✔ C2: --verify-only exits 0 and outputs ok:true and verifiedCount:23

**C3** - `sync-skills.mjs` exits `1` naming the offending skill on stderr when a file is modified, a skill directory is missing, or `SKILL.md` version mismatches `skills.lock.json` (AC 3)
Proof: run unit | ✔ C3: exits 1 naming the skill on sha256 mismatch, missing directory, or version mismatch

**C4** - `sync-skills.mjs` enforces `tlc-spec-lean` version `>= 2.0.0`, rejecting `1.9.0` with exit `1` and `tlc-spec-lean version must be >= 2.0.0` while accepting `2.0.0` and `2.2.0` (AC 4)
Proof: run unit | ✔ C4: enforces tlc-spec-lean version >= 2.0.0 (rejects 1.9.0, accepts 2.0.0 and 2.2.0)

**C5** - `node scripts/sync-skills.mjs --target <dir>` copies every locked skill into `<dir>/.agents/skills/<name>` and `<dir>/.claude/skills/<name>` with matching tree digests (AC 5)
Proof: run unit | ✔ C5: --target copies all locked skills to .agents/skills and .claude/skills with matching digests

**C6** - Passing an unknown CLI flag to `scripts/sync-skills.mjs` exits `2` without writing any files (AC 6)
Proof: run unit | ✔ C6: unknown CLI flag exits 2 without writing files

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Landing doors (2) | Door 1 (`skills.lock.json` schema) C1, C2 · Door 2 (`.agents/skills` & `.claude/skills` full copy) C5 | - |
| Core vendored TLC skills (23) | C1, C2, table-driven over all 23 entries in `skills.lock.json` | - |
| Tamper/corruption rule, AC 3 (3 examples) | `sha256` mismatch C3 · missing directory C3 · intact directory C2, C3 | - |
| `tlc-spec-lean` v2 floor rule, AC 4 (3 examples) | `1.9.0` C4 · `2.0.0` C4 · `2.2.0` C4 | - |
| CLI flag validation rule, AC 6 (2 examples) | `--unknown-flag` C6 · `--verify-only` C2, C6 | - |
| Stored entities (2) | `SKILLS_LOCK` C1, C2 · `SKILL_ENTRY` C1, C3, C4 | - |

## Swept

- validation: C3, C4, C6
- failure modes: C3, C6
- idempotency: C5
- authorization: n/a - local CLI script operating on local repository files
- concurrency: n/a - single-process deterministic CLI tool invoked before agent dispatch
- data lifecycle: C5
- dependency failure: n/a - zero external dependencies and no network calls
- state transitions: n/a - stateless file verification and synchronization
- observability: C2, C3

## Handoff

- **Settled mid-build:** none
- **Dispatched:** Verifier at `64e6a79` - returned (`PASS`)
- **Boundary:** C1-C6 closed at `31bf794`
- **Abandoned:** none
