import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { computeSkillDigest, verifySkillLock, syncSkills } from '../lib/skills-sync.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const CLI = join(ROOT, 'scripts', 'sync-skills.mjs');
const LOCK_PATH = join(ROOT, 'skills.lock.json');

const EXPECTED_SKILLS = [
  'codenavi',
  'coding-guidelines',
  'create-adr',
  'create-rfc',
  'create-technical-design-doc',
  'docs-writer',
  'gh-address-comments',
  'gh-fix-ci',
  'harness-eval',
  'mermaid-studio',
  'not-your-babysitter',
  'security-best-practices',
  'security-threat-model',
  'sentry',
  'skill-architect',
  'spec-driven-eval',
  'subagent-creator',
  'the-fool',
  'the-judge',
  'the-jury',
  'tlc-discover',
  'tlc-prd',
  'tlc-spec-lean',
];

test('C1: skills.lock.json pins tlc-spec-lean 2.2.0 and all 23 skills with valid sha256 digests', () => {
  assert.equal(existsSync(LOCK_PATH), true, 'skills.lock.json must exist');
  const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
  assert.equal(lock.schemaVersion, 1);
  assert.equal(lock.upstreamRepo, 'https://github.com/tech-leads-club/agent-skills');
  assert.equal(lock.upstreamCommit, '8658b6658c762b9e5efd3956ed35a51c41bdf6c3');
  assert.equal(Array.isArray(lock.skills), true);

  const names = lock.skills.map((s) => s.name).sort();
  assert.deepEqual(names, EXPECTED_SKILLS);

  const specLean = lock.skills.find((s) => s.name === 'tlc-spec-lean');
  assert.ok(specLean);
  assert.equal(specLean.version, '2.2.0');
  assert.equal(specLean.license, 'CC-BY-4.0');
  assert.equal(specLean.path, 'skills/vendor/tlc-spec-lean');

  for (const entry of lock.skills) {
    assert.match(entry.sha256, /^[0-9a-f]{64}$/, `invalid sha256 format for ${entry.name}`);
    const dir = join(ROOT, entry.path);
    assert.equal(existsSync(join(dir, 'SKILL.md')), true, `missing SKILL.md for ${entry.name}`);
    const actualDigest = computeSkillDigest(dir);
    assert.equal(actualDigest, entry.sha256, `digest mismatch for ${entry.name}`);
  }
});

test('C2: --verify-only exits 0 and outputs ok:true and verifiedCount:23', () => {
  const res = spawnSync(process.execPath, [CLI, '--verify-only'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}: ${res.stderr}`);
  const out = JSON.parse(res.stdout.trim());
  assert.equal(out.ok, true);
  assert.equal(out.verifiedCount, 23);
  assert.equal(out.syncedCount, 0);
});

test('C3: exits 1 naming the skill on sha256 mismatch, missing directory, or version mismatch', () => {
  const tmp = mkdirSync(join(tmpdir(), `skills-sync-c3-${Date.now()}`), { recursive: true });
  try {
    const skillDir = join(tmp, 'skills', 'vendor', 'the-judge');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      "---\nname: the-judge\ndescription: 'judge'\nlicense: CC-BY-4.0\nmetadata:\n  version: '1.0.0'\n---\n# Judge\n",
      'utf8',
    );
    const validSha = computeSkillDigest(skillDir);

    const makeLock = (overrides = {}) => ({
      schemaVersion: 1,
      upstreamRepo: 'https://github.com/tech-leads-club/agent-skills',
      upstreamCommit: '8658b6658c762b9e5efd3956ed35a51c41bdf6c3',
      skills: [
        {
          name: 'the-judge',
          category: 'quality',
          source: 'vendor',
          version: '1.0.0',
          license: 'CC-BY-4.0',
          path: 'skills/vendor/the-judge',
          sha256: validSha,
          ...overrides,
        },
      ],
    });

    // Intact case -> ok
    const okRes = verifySkillLock({ root: tmp, lock: makeLock() });
    assert.equal(okRes.ok, true);

    // 1. sha256 mismatch on SKILL.md
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      "---\nname: the-judge\ndescription: 'tampered'\nlicense: CC-BY-4.0\nmetadata:\n  version: '1.0.0'\n---\n# Tampered\n",
      'utf8',
    );
    const lockFile = join(tmp, 'skills.lock.json');
    writeFileSync(lockFile, JSON.stringify(makeLock()), 'utf8');
    const cliTampered = spawnSync(process.execPath, [CLI, '--verify-only', '--root', tmp, '--lock', lockFile], {
      encoding: 'utf8',
    });
    assert.equal(cliTampered.status, 1);
    assert.match(cliTampered.stderr, /the-judge/);
    assert.match(cliTampered.stderr, /sha256 mismatch/i);

    // Restore content, test version mismatch
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      "---\nname: the-judge\ndescription: 'judge'\nlicense: CC-BY-4.0\nmetadata:\n  version: '1.0.0'\n---\n# Judge\n",
      'utf8',
    );
    writeFileSync(lockFile, JSON.stringify(makeLock({ version: '9.9.9' })), 'utf8');
    const cliVersion = spawnSync(process.execPath, [CLI, '--verify-only', '--root', tmp, '--lock', lockFile], {
      encoding: 'utf8',
    });
    assert.equal(cliVersion.status, 1);
    assert.match(cliVersion.stderr, /the-judge/);
    assert.match(cliVersion.stderr, /version mismatch/i);

    // 3. missing skill directory
    writeFileSync(
      lockFile,
      JSON.stringify(makeLock({ name: 'missing-skill', path: 'skills/vendor/missing-skill' })),
      'utf8',
    );
    const cliMissing = spawnSync(process.execPath, [CLI, '--verify-only', '--root', tmp, '--lock', lockFile], {
      encoding: 'utf8',
    });
    assert.equal(cliMissing.status, 1);
    assert.match(cliMissing.stderr, /missing-skill/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('C4: enforces tlc-spec-lean version >= 2.0.0 (rejects 1.9.0, accepts 2.0.0 and 2.2.0)', () => {
  const tmp = mkdirSync(join(tmpdir(), `skills-sync-c4-${Date.now()}`), { recursive: true });
  try {
    const skillDir = join(tmp, 'skills', 'vendor', 'tlc-spec-lean');
    mkdirSync(skillDir, { recursive: true });

    const runForVersion = (ver) => {
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---\nname: tlc-spec-lean\ndescription: 'spec'\nlicense: CC-BY-4.0\nmetadata:\n  version: '${ver}'\n---\n# Spec\n`,
        'utf8',
      );
      const sha = computeSkillDigest(skillDir);
      const lockFile = join(tmp, 'skills.lock.json');
      writeFileSync(
        lockFile,
        JSON.stringify({
          schemaVersion: 1,
          upstreamRepo: 'https://github.com/tech-leads-club/agent-skills',
          upstreamCommit: '8658b6658c762b9e5efd3956ed35a51c41bdf6c3',
          skills: [
            {
              name: 'tlc-spec-lean',
              category: 'development',
              source: 'vendor',
              version: ver,
              license: 'CC-BY-4.0',
              path: 'skills/vendor/tlc-spec-lean',
              sha256: sha,
            },
          ],
        }),
        'utf8',
      );
      return spawnSync(process.execPath, [CLI, '--verify-only', '--root', tmp, '--lock', lockFile], {
        encoding: 'utf8',
      });
    };

    const v19 = runForVersion('1.9.0');
    assert.equal(v19.status, 1);
    assert.match(v19.stderr, /tlc-spec-lean version must be >= 2\.0\.0/);

    const v20 = runForVersion('2.0.0');
    assert.equal(v20.status, 0, v20.stderr);

    const v22 = runForVersion('2.2.0');
    assert.equal(v22.status, 0, v22.stderr);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('C5: --target copies all locked skills to .agents/skills and .claude/skills with matching digests', () => {
  const targetDir = mkdirSync(join(tmpdir(), `skills-sync-c5-${Date.now()}`), { recursive: true });
  try {
    const res = spawnSync(process.execPath, [CLI, '--target', targetDir], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, `expected exit 0, got ${res.status}: ${res.stderr}`);
    const out = JSON.parse(res.stdout.trim());
    assert.equal(out.ok, true);
    assert.equal(out.verifiedCount, 23);
    assert.equal(out.syncedCount, 23);

    const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
    for (const entry of lock.skills) {
      const agyDir = join(targetDir, '.agents', 'skills', entry.name);
      const claudeDir = join(targetDir, '.claude', 'skills', entry.name);
      assert.equal(existsSync(join(agyDir, 'SKILL.md')), true, `missing .agents/skills/${entry.name}/SKILL.md`);
      assert.equal(existsSync(join(claudeDir, 'SKILL.md')), true, `missing .claude/skills/${entry.name}/SKILL.md`);
      assert.equal(computeSkillDigest(agyDir), entry.sha256);
      assert.equal(computeSkillDigest(claudeDir), entry.sha256);
    }
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test('C6: unknown CLI flag exits 2 without writing files', () => {
  const targetDir = mkdirSync(join(tmpdir(), `skills-sync-c6-${Date.now()}`), { recursive: true });
  try {
    const res = spawnSync(process.execPath, [CLI, '--unknown-flag', '--target', targetDir], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(res.status, 2);
    assert.equal(existsSync(join(targetDir, '.agents')), false);
    assert.equal(existsSync(join(targetDir, '.claude')), false);
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});
