import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Computes a deterministic SHA-256 hex digest over all files in a skill directory.
 * Normalizes relative paths to POSIX `/` and normalizes text line endings (`\r\n` -> `\n`)
 * on `.md`, `.py`, `.json`, `.yml`, `.yaml`, `.txt`, `.mjs`, `.js`, `.ts`, `.sh` files
 * so digests remain identical across Windows and POSIX checkouts.
 */
export function computeSkillDigest(skillDir) {
  const absRoot = resolve(skillDir);
  if (!existsSync(absRoot) || !statSync(absRoot).isDirectory()) {
    throw new Error(`Skill directory does not exist: ${skillDir}`);
  }

  const files = [];
  const walk = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      if (entry.name === '__pycache__' || entry.name === '.DS_Store') continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const relPosix = relative(absRoot, fullPath).split('\\').join('/');
        files.push({ fullPath, relPosix });
      }
    }
  };
  walk(absRoot);
  files.sort((a, b) => a.relPosix.localeCompare(b.relPosix));

  const hash = createHash('sha256');
  const textExt = /\.(md|py|json|ya?ml|txt|m?js|ts|sh|html|css|svg)$/i;
  for (const { fullPath, relPosix } of files) {
    hash.update(`file:${relPosix}\0`, 'utf8');
    if (textExt.test(relPosix)) {
      const normalized = readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n');
      hash.update(normalized, 'utf8');
    } else {
      hash.update(readFileSync(fullPath));
    }
    hash.update('\0', 'utf8');
  }
  return hash.digest('hex');
}

/**
 * Extracts frontmatter `name`, `version`, and `license` from a SKILL.md content string.
 */
export function parseSkillFrontmatter(markdown) {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name: null, version: null, license: null };
  const fm = match[1];
  const nameMatch = fm.match(/^name:\s*['"]?([^\s'"]+)['"]?/m);
  const versionMatch = fm.match(/^\s*version:\s*['"]?([^'"\n]+)['"]?/m);
  const licenseMatch = fm.match(/^license:\s*['"]?([^'"\n]+)['"]?/m);
  return {
    name: nameMatch ? nameMatch[1].trim() : null,
    version: versionMatch ? versionMatch[1].trim() : null,
    license: licenseMatch ? licenseMatch[1].trim() : null,
  };
}

function parseMajorVersion(versionStr) {
  if (!versionStr || typeof versionStr !== 'string') return NaN;
  const m = versionStr.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? Number(m[1]) : NaN;
}

/**
 * Verifies every entry in a parsed skills.lock.json object against the filesystem under `root`.
 */
export function verifySkillLock({ root, lock }) {
  if (!lock || typeof lock !== 'object' || lock.schemaVersion !== 1 || !Array.isArray(lock.skills)) {
    return { ok: false, errors: ['Invalid skills.lock.json structure (expected schemaVersion 1 and skills array)'] };
  }

  const errors = [];
  const seen = new Set();

  for (const entry of lock.skills) {
    if (!entry || !entry.name || !entry.path || !entry.sha256) {
      errors.push(`Invalid skill entry in lock: ${JSON.stringify(entry)}`);
      continue;
    }
    if (seen.has(entry.name)) {
      errors.push(`Duplicate skill entry in lock: ${entry.name}`);
      continue;
    }
    seen.add(entry.name);

    const skillDir = resolve(root, entry.path);
    const skillMdPath = join(skillDir, 'SKILL.md');
    if (!existsSync(skillDir) || !existsSync(skillMdPath)) {
      errors.push(`Skill "${entry.name}": missing directory or SKILL.md at ${entry.path}`);
      continue;
    }

    const fm = parseSkillFrontmatter(readFileSync(skillMdPath, 'utf8'));
    if (fm.version && entry.version && fm.version !== entry.version) {
      errors.push(
        `Skill "${entry.name}": version mismatch (lock has ${entry.version}, SKILL.md has ${fm.version})`,
      );
      continue;
    }

    if (entry.name === 'tlc-spec-lean') {
      const lockMajor = parseMajorVersion(entry.version);
      const mdMajor = parseMajorVersion(fm.version);
      if (Number.isNaN(lockMajor) || lockMajor < 2 || Number.isNaN(mdMajor) || mdMajor < 2) {
        errors.push(
          `Skill "tlc-spec-lean": tlc-spec-lean version must be >= 2.0.0 (got lock=${entry.version}, SKILL.md=${fm.version})`,
        );
        continue;
      }
    }

    const actualSha = computeSkillDigest(skillDir);
    if (actualSha !== entry.sha256) {
      errors.push(
        `Skill "${entry.name}": sha256 mismatch (expected ${entry.sha256}, got ${actualSha})`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    verifiedCount: lock.skills.length,
    errors,
  };
}

/**
 * Verifies the lock and, when `verifyOnly` is false, copies all locked skills into
 * `<target>/.agents/skills/<name>` (Antigravity & Codex) and `<target>/.claude/skills/<name>` (Claude Code).
 */
export function syncSkills({ root, lockPath, target, verifyOnly = false }) {
  const resolvedLockPath = lockPath ? resolve(lockPath) : join(resolve(root), 'skills.lock.json');
  if (!existsSync(resolvedLockPath)) {
    return {
      ok: false,
      verifiedCount: 0,
      syncedCount: 0,
      errors: [`Missing lock file at ${resolvedLockPath}`],
    };
  }

  const lock = JSON.parse(readFileSync(resolvedLockPath, 'utf8'));
  const verification = verifySkillLock({ root, lock });
  if (!verification.ok) {
    return {
      ok: false,
      verifiedCount: 0,
      syncedCount: 0,
      errors: verification.errors,
    };
  }

  if (verifyOnly) {
    return {
      ok: true,
      verifiedCount: verification.verifiedCount,
      syncedCount: 0,
      errors: [],
    };
  }

  const targetRoot = resolve(target || root);
  const runtimeDirs = [
    join(targetRoot, '.agents', 'skills'),
    join(targetRoot, '.claude', 'skills'),
  ];

  for (const base of runtimeDirs) {
    mkdirSync(base, { recursive: true });
  }

  for (const entry of lock.skills) {
    const srcDir = resolve(root, entry.path);
    for (const base of runtimeDirs) {
      const destDir = join(base, entry.name);
      rmSync(destDir, { recursive: true, force: true });
      cpSync(srcDir, destDir, {
        recursive: true,
        filter: (src) => !src.includes('__pycache__') && !src.endsWith('.DS_Store'),
      });
    }
  }

  return {
    ok: true,
    verifiedCount: verification.verifiedCount,
    syncedCount: lock.skills.length,
    target: targetRoot,
    runtimePaths: ['.agents/skills', '.claude/skills'],
    errors: [],
  };
}
