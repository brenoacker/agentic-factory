# skills-sync proofs

**HEAD**: 64e6a79
**Tree**: clean
**Shell**: C:/Program Files/Git\bin\bash.exe
**Result**: 8 pass, 0 fail

| Check | Proof | Result |
| --- | --- | --- |
| C1 | `run unit / ✔ C1: skills.lock.json pins tlc-spec-lean 2.2.0 and all 23 skills with valid sha256 digests` | pass |
| C2 | `run unit / ✔ C2: --verify-only exits 0 and outputs ok:true and verifiedCount:23` | pass |
| C3 | `run unit / ✔ C3: exits 1 naming the skill on sha256 mismatch, missing directory, or version mismatch` | pass |
| C4 | `run unit / ✔ C4: enforces tlc-spec-lean version >= 2.0.0 (rejects 1.9.0, accepts 2.0.0 and 2.2.0)` | pass |
| C5 | `run unit / ✔ C5: --target copies all locked skills to .agents/skills and .claude/skills with matching digests` | pass |
| C6 | `run unit / ✔ C6: unknown CLI flag exits 2 without writing files` | pass |
| Build | `node --check scripts/sync-skills.mjs` | pass |
| Build | `node --check scripts/lib/skills-sync.mjs` | pass |

## Output

`Run unit` - exit 0

```
✔ C1: skills.lock.json pins tlc-spec-lean 2.2.0 and all 23 skills with valid sha256 digests (134.7176ms)
✔ C2: --verify-only exits 0 and outputs ok:true and verifiedCount:23 (141.7461ms)
✔ C3: exits 1 naming the skill on sha256 mismatch, missing directory, or version mismatch (146.1759ms)
✔ C4: enforces tlc-spec-lean version >= 2.0.0 (rejects 1.9.0, accepts 2.0.0 and 2.2.0) (151.4204ms)
✔ C5: --target copies all locked skills to .agents/skills and .claude/skills with matching digests (621.3837ms)
✔ C6: unknown CLI flag exits 2 without writing files (45.9716ms)
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1328.7752
```
