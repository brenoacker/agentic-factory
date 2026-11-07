import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const EXPECTED_WORKFLOWS = ['feature', 'bug', 'investigation', 'discovery', 'chore'];
const VALID_AUTONOMY = new Set(['manual', 'triage', 'gated', 'auto-low']);
const VALID_IMPACTS = ['low', 'medium', 'high'];

/**
 * Parses a JSON-compatible YAML file (strips `#` full-line comments and parses strict JSON).
 */
export function parseYamlJsonFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing configuration file: ${filePath}`);
  }
  const raw = readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const stripped = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  try {
    return JSON.parse(stripped);
  } catch (err) {
    throw new Error(`Invalid YAML/JSON syntax in ${filePath}: ${err.message}`);
  }
}

/**
 * Loads and validates factory.yaml, workflows/*.yaml, config/prices.yaml, and skills.lock.json cross-references.
 */
export function loadAndValidateFactory(rootDir) {
  const root = resolve(rootDir);
  const errors = [];

  const lockPath = join(root, 'skills.lock.json');
  let lockedSkills = new Set();
  if (!existsSync(lockPath)) {
    errors.push('Missing skills.lock.json');
  } else {
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (Array.isArray(lock.skills)) {
        lockedSkills = new Set(lock.skills.map((s) => s.name));
      } else {
        errors.push('skills.lock.json: missing skills array');
      }
    } catch (e) {
      errors.push(`skills.lock.json: ${e.message}`);
    }
  }

  let factoryConfig = null;
  try {
    factoryConfig = parseYamlJsonFile(join(root, 'factory.yaml'));
    if (factoryConfig.schemaVersion !== 1 || !factoryConfig.factory) {
      errors.push('factory.yaml: expected schemaVersion 1 and factory object');
    } else {
      const f = factoryConfig.factory;
      if (!f.name || !f.defaultRuntime || !VALID_AUTONOMY.has(f.autonomy)) {
        errors.push('factory.yaml: invalid name, defaultRuntime, or autonomy');
      }
      if (!f.limits || typeof f.limits.maxTasksPerHour !== 'number' || typeof f.limits.dailyBudgetUsd !== 'number') {
        errors.push('factory.yaml: limits must define numeric maxTasksPerHour and dailyBudgetUsd');
      }
      if (
        f.limits?.maxConcurrentAgents !== undefined &&
        (typeof f.limits.maxConcurrentAgents !== 'number' ||
          !Number.isInteger(f.limits.maxConcurrentAgents) ||
          f.limits.maxConcurrentAgents < 1 ||
          f.limits.maxConcurrentAgents > 10)
      ) {
        errors.push('factory.yaml: limits.maxConcurrentAgents must be an integer between 1 and 10');
      }
      for (const imp of VALID_IMPACTS) {
        if (!f.modelByImpact || !f.modelByImpact[imp] || !f.modelByImpact[imp].runtime || !f.modelByImpact[imp].model) {
          errors.push(`factory.yaml: modelByImpact missing mapping for impact "${imp}"`);
        }
      }
    }
  } catch (e) {
    errors.push(e.message);
  }

  let pricesConfig = null;
  try {
    pricesConfig = parseYamlJsonFile(join(root, 'config', 'prices.yaml'));
    if (pricesConfig.schemaVersion !== 1 || !pricesConfig.models || typeof pricesConfig.models !== 'object') {
      errors.push('config/prices.yaml: expected schemaVersion 1 and models map');
    }
  } catch (e) {
    errors.push(e.message);
  }

  const workflowsDir = join(root, 'workflows');
  const workflows = {};
  if (!existsSync(workflowsDir)) {
    errors.push('Missing workflows/ directory');
  } else {
    const files = readdirSync(workflowsDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    for (const file of files) {
      try {
        const wf = parseYamlJsonFile(join(workflowsDir, file));
        const wfCheck = validateWorkflowObject(wf, lockedSkills, file);
        if (!wfCheck.ok) {
          errors.push(...wfCheck.errors);
        } else {
          workflows[wf.id] = wf;
        }
      } catch (e) {
        errors.push(e.message);
      }
    }
    for (const expectedId of EXPECTED_WORKFLOWS) {
      if (!workflows[expectedId]) {
        errors.push(`workflows: missing required workflow "${expectedId}.yaml"`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    workflowsValidated: Object.keys(workflows).length,
    factoryConfig,
    pricesConfig,
    workflows,
    lockedSkills: Array.from(lockedSkills),
    errors,
  };
}

/**
 * Validates a single workflow definition object and checks that every referenced skill is locked.
 */
export function validateWorkflowObject(wf, lockedSkillsSet, sourceName = 'workflow') {
  const errors = [];
  if (!wf || typeof wf !== 'object') {
    return { ok: false, errors: [`${sourceName}: workflow must be an object`] };
  }
  const labelName = wf.id || sourceName;
  for (const reqField of ['id', 'label', 'stages']) {
    if (!wf[reqField]) {
      errors.push(`Workflow "${labelName}": missing required field "${reqField}"`);
    }
  }
  if (wf.autonomy && !VALID_AUTONOMY.has(wf.autonomy)) {
    errors.push(`Workflow "${labelName}": invalid autonomy "${wf.autonomy}"`);
  }
  if (!Array.isArray(wf.stages) || wf.stages.length === 0) {
    errors.push(`Workflow "${labelName}": stages must be a non-empty array`);
    return { ok: false, errors };
  }

  for (const stage of wf.stages) {
    if (!stage.id || !stage.mode || !stage.agent) {
      errors.push(`Workflow "${labelName}": stage missing id, mode, or agent`);
      continue;
    }
    if (!Array.isArray(stage.skills)) {
      errors.push(`Workflow "${labelName}" stage "${stage.id}": skills must be an array`);
      continue;
    }
    for (const skill of stage.skills) {
      if (!lockedSkillsSet.has(skill)) {
        errors.push(
          `Workflow "${labelName}" stage "${stage.id}": unknown skill "${skill}" not found in skills.lock.json`,
        );
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
