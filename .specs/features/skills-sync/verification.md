# Skills Synchronization and Vendor Lock verification

**Verdict**: PASS
**Proofs**: `proofs.md` at 64e6a79
**Verifier**: independent sub-agent (author != verifier)

## Checks

| Check | Test | Holds |
| --- | --- | --- |
| C1 | `scripts/__test__/skills-sync.test.mjs` `C1: skills.lock.json pins tlc-spec-lean 2.2.0 and all 23 skills with valid sha256 digests` | yes |
| C2 | `scripts/__test__/skills-sync.test.mjs` `C2: --verify-only exits 0 and outputs ok:true and verifiedCount:23` | yes |
| C3 | `scripts/__test__/skills-sync.test.mjs` `C3: exits 1 naming the skill on sha256 mismatch, missing directory, or version mismatch` | yes |
| C4 | `scripts/__test__/skills-sync.test.mjs` `C4: enforces tlc-spec-lean version >= 2.0.0 (rejects 1.9.0, accepts 2.0.0 and 2.2.0)` | yes |
| C5 | `scripts/__test__/skills-sync.test.mjs` `C5: --target copies all locked skills to .agents/skills and .claude/skills with matching digests` | yes |
| C6 | `scripts/__test__/skills-sync.test.mjs` `C6: unknown CLI flag exits 2 without writing files` | yes |

## Findings

None - probed `tlc-spec-lean` version boundaries (`0.0.1`, `1.99.99`, `invalid`, `3.0.0`), nested file tampering inside `references/verify.md`, duplicate skill names in `skills.lock.json`, and incomplete CLI flags (`--target` with no value); all held.
