import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const GENERIC_ROOT_CAUSES = new Set(['bug', 'erro', 'error', 'fix', 'corrigido', 'fixed', 'issue', 'problema', 'unknown', 'n/a', 'none']);
const VALID_TYPES = new Set(['feature', 'bug', 'investigation', 'discovery', 'chore']);
const VALID_IMPACTS = new Set(['low', 'medium', 'high']);
const VALID_VERDICTS = new Set(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']);
const SHA_RE = /^[0-9a-f]{7,40}$/;

/**
 * Validates an agent contract payload (`task`, `triage`, `investigation-report`, `review`)
 * against the JSON schema and deterministic semantic rules from Live 02.
 */
export function validateContract(kind, payload, context = {}) {
  const errors = [];
  const ruleCodes = [];
  const fail = (code, msg) => {
    ruleCodes.push(code);
    errors.push(`${code}: ${msg}`);
  };

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('invalid_payload', 'Contract payload must be a JSON object');
    return { ok: false, kind, ruleCodes, errors };
  }

  if (kind === 'task') {
    if (!Number.isInteger(payload.issue_number) || payload.issue_number < 1) {
      fail('invalid_issue_number', 'issue_number must be a positive integer');
    }
    if (typeof payload.repo !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(payload.repo)) {
      fail('invalid_repo', 'repo must match owner/name');
    }
    if (typeof payload.title !== 'string' || payload.title.trim().length < 5) {
      fail('title_too_short', 'title must be at least 5 characters');
    }
    if (!VALID_TYPES.has(payload.type)) {
      fail('invalid_ticket_type', `type must be one of ${Array.from(VALID_TYPES).join(', ')}`);
    }
    if (typeof payload.body !== 'string' || payload.body.trim().length < 10) {
      fail('body_too_short', 'body must be at least 10 characters');
    }
  } else if (kind === 'triage') {
    if (!Number.isInteger(payload.issue_number) || payload.issue_number < 1) {
      fail('invalid_issue_number', 'issue_number must be a positive integer');
    }
    if (!VALID_TYPES.has(payload.type)) {
      fail('invalid_ticket_type', `type must be one of ${Array.from(VALID_TYPES).join(', ')}`);
    }
    if (!VALID_IMPACTS.has(payload.impact)) {
      fail('invalid_impact', 'impact must be low, medium, or high');
    }
    const rc = typeof payload.root_cause === 'string' ? payload.root_cause.trim() : '';
    if (GENERIC_ROOT_CAUSES.has(rc.toLowerCase())) {
      fail('generic_root_cause', `root_cause "${rc}" is generic and refused by the factory`);
    }
    if (rc.length < 20) {
      fail('root_cause_too_short', 'root_cause must be at least 20 characters');
    }
    const ev = typeof payload.evidence === 'string' ? payload.evidence.trim() : '';
    if (ev.length < 15) {
      fail('evidence_too_short', 'evidence must be non-empty and at least 15 characters');
    }
    if (!Array.isArray(payload.affected_paths) || payload.affected_paths.length === 0) {
      fail('missing_affected_paths', 'affected_paths must be a non-empty array');
    }
    if (typeof payload.needs_human !== 'boolean') {
      fail('missing_needs_human', 'needs_human must be a boolean');
    }
  } else if (kind === 'investigation-report') {
    if (!Number.isInteger(payload.issue_number) || payload.issue_number < 1) {
      fail('invalid_issue_number', 'issue_number must be a positive integer');
    }
    if (typeof payload.question !== 'string' || payload.question.trim().length < 10) {
      fail('question_too_short', 'question must be at least 10 characters');
    }
    if (typeof payload.answer_summary !== 'string' || payload.answer_summary.trim().length < 30) {
      fail('answer_summary_too_short', 'answer_summary must be at least 30 characters');
    }
    if (
      !Array.isArray(payload.evidence) ||
      payload.evidence.length === 0 ||
      payload.evidence.some((e) => typeof e !== 'string' || e.trim().length < 15)
    ) {
      fail('evidence_too_short', 'evidence must contain at least one item >= 15 characters');
    }
    if (!Array.isArray(payload.options_compared) || payload.options_compared.length === 0) {
      fail('missing_options_compared', 'options_compared must be a non-empty array');
    }
    if (typeof payload.recommendation !== 'string' || payload.recommendation.trim().length < 15) {
      fail('recommendation_too_short', 'recommendation must be at least 15 characters');
    }
    if (!Array.isArray(payload.follow_up_tickets)) {
      fail('missing_follow_up_tickets', 'follow_up_tickets must be an array');
    }
    if (typeof payload.needs_human !== 'boolean') {
      fail('missing_needs_human', 'needs_human must be a boolean');
    }
  } else if (kind === 'review') {
    const maxRounds = context.maxReviewRounds ?? 3;
    if (!Number.isInteger(payload.issue_number) || payload.issue_number < 1) {
      fail('invalid_issue_number', 'issue_number must be a positive integer');
    }
    if (!Number.isInteger(payload.pr_number) || payload.pr_number < 1) {
      fail('invalid_pr_number', 'pr_number must be a positive integer');
    }
    if (typeof payload.commit_sha !== 'string' || !SHA_RE.test(payload.commit_sha)) {
      fail('invalid_commit_sha', 'commit_sha must be a 7-40 char lowercase hex SHA');
    }
    if (!Number.isInteger(payload.round) || payload.round < 1) {
      fail('invalid_round', 'round must be a positive integer');
    } else if (payload.round > maxRounds) {
      fail(
        'max_review_rounds_exceeded',
        `review round ${payload.round} exceeds maxReviewRounds (${maxRounds})`,
      );
    }
    if (!VALID_VERDICTS.has(payload.verdict)) {
      fail('invalid_verdict', 'verdict must be APPROVE, REQUEST_CHANGES, or COMMENT');
    }
    if (
      payload.verdict === 'APPROVE' &&
      context.head_sha &&
      !context.head_sha.startsWith(payload.commit_sha) &&
      !payload.commit_sha.startsWith(context.head_sha)
    ) {
      fail(
        'commit_sha_mismatch',
        `reviewed commit_sha (${payload.commit_sha}) does not match current head_sha (${context.head_sha})`,
      );
    }
    if (typeof payload.summary !== 'string' || payload.summary.trim().length < 15) {
      fail('summary_too_short', 'summary must be at least 15 characters');
    }
    if (!Array.isArray(payload.findings)) {
      fail('missing_findings', 'findings must be an array');
    }
    if (typeof payload.needs_human !== 'boolean') {
      fail('missing_needs_human', 'needs_human must be a boolean');
    }
  } else {
    fail('unknown_contract_kind', `Unknown contract kind: ${kind}`);
  }

  return {
    ok: errors.length === 0,
    kind,
    ruleCodes,
    errors,
  };
}

/**
 * Verifies that all 4 contract JSON Schema files exist and parse as valid JSON Schema objects.
 */
export function verifyContractSchemasOnDisk(rootDir) {
  const root = resolve(rootDir);
  const schemas = ['task', 'triage', 'investigation-report', 'review'];
  const errors = [];
  for (const name of schemas) {
    const file = join(root, 'contracts', `${name}.schema.json`);
    if (!existsSync(file)) {
      errors.push(`Missing contract schema: contracts/${name}.schema.json`);
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (parsed.type !== 'object' || !Array.isArray(parsed.required)) {
        errors.push(`contracts/${name}.schema.json: invalid schema root`);
      }
    } catch (e) {
      errors.push(`contracts/${name}.schema.json: ${e.message}`);
    }
  }
  return { ok: errors.length === 0, schemasChecked: schemas.length, errors };
}
