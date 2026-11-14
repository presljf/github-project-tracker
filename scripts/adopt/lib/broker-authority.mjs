/**
 * Broker authority records (P0.1): approvals, plans, grants, leases, revocations, idempotency.
 *
 * A grant is human-approved and scoped to one tier/repo/project with an explicit tool allowlist,
 * task scope, limits, and expiry. A lease derives from an active grant and binds one tool call to
 * an args hash and (optionally) one task, with its own expiry, revocation, and use budget. Every
 * apply calls `useLease`, which re-checks expiry, revocation, tool, args hash, and uses.
 */
import { LIMIT_KEYS, TIERS } from './broker-policy.mjs';
import { assertNoSecrets, newId, nowIso, withTransaction } from './broker-store.mjs';

const GRANT_KEYS = [
  'tier',
  'repo',
  'project',
  'tools',
  'tasks',
  'limits',
  'approvalId',
  'issuedBy',
  'expiresAt',
  'ttlMinutes',
];
const LEASE_KEYS = ['grantId', 'tool', 'task', 'argsHash', 'expiresAt', 'ttlMinutes', 'maxUses'];
const APPROVAL_KEYS = ['approvedBy', 'channel', 'planId', 'signature', 'expiresAt'];
const PLAN_KEYS = ['tool', 'argsHash', 'plan', 'expiresAt'];
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function assertKnownKeys(value, allowed, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label}.${key} is not a known field`);
  }
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value;
}

function parseIso(value, label) {
  const ms = Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) throw new Error(`${label} must be an ISO timestamp`);
  return ms;
}

function plannedExpiry({ expiresAt, ttlMinutes, now, label }) {
  if (expiresAt !== undefined) return nowIso(parseIso(expiresAt, label));
  if (ttlMinutes !== undefined) {
    if (!Number.isInteger(ttlMinutes) || ttlMinutes <= 0)
      throw new Error(`${label}TtlMinutes must be a positive integer`);
    return nowIso(now + ttlMinutes * 60_000);
  }
  return null;
}

function requireFuture(iso, now, label) {
  if (Date.parse(iso) <= now) throw new Error(`${label} must be in the future`);
  return iso;
}

function positiveInt(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  return JSON.parse(value);
}

function grantRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    tier: row.tier,
    repo: row.repo,
    project: row.project,
    tools: parseJson(row.tools_json, []),
    tasks: parseJson(row.tasks_json, []),
    limits: parseJson(row.limits_json, {}),
    approvalId: row.approval_id,
    issuedBy: row.issued_by,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at || null,
    createdAt: row.created_at,
  };
}

function leaseRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    grantId: row.grant_id,
    tool: row.tool,
    task: row.task ?? null,
    argsHash: row.args_hash,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    maxUses: row.max_uses ?? null,
    uses: row.uses,
    revokedAt: row.revoked_at || null,
  };
}

function approvalRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    planId: row.plan_id || null,
    approvedBy: row.approved_by,
    channel: row.channel,
    signature: row.signature || null,
    approvedAt: row.approved_at,
    expiresAt: row.expires_at || null,
  };
}

export function createApproval(store, input = {}) {
  assertKnownKeys(input, APPROVAL_KEYS, 'approval');
  const approvedBy = requireString(input.approvedBy, 'approval.approvedBy');
  const channel = requireString(input.channel, 'approval.channel');
  const now = store.now();
  const expiresAt =
    input.expiresAt === undefined
      ? null
      : requireFuture(nowIso(parseIso(input.expiresAt, 'approval.expiresAt')), now, 'approval.expiresAt');
  assertNoSecrets(input, 'approval');
  const id = newId();
  store.db
    .prepare(
      'INSERT INTO approvals (id, plan_id, approved_by, channel, signature, approved_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, input.planId || null, approvedBy, channel, input.signature || null, nowIso(now), expiresAt);
  return approvalRow(store.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id));
}

export function getApproval(store, id) {
  return approvalRow(store.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id));
}

export function savePlan(store, input = {}) {
  assertKnownKeys(input, PLAN_KEYS, 'plan');
  const tool = requireString(input.tool, 'plan.tool');
  const argsHash = requireString(input.argsHash, 'plan.argsHash');
  if (input.plan === null || typeof input.plan !== 'object' || Array.isArray(input.plan)) {
    throw new Error('plan.plan must be an object');
  }
  assertNoSecrets(input.plan, 'plan');
  const now = store.now();
  const expiresAt =
    input.expiresAt === undefined
      ? null
      : requireFuture(nowIso(parseIso(input.expiresAt, 'plan.expiresAt')), now, 'plan.expiresAt');
  const id = newId();
  store.db
    .prepare('INSERT INTO plans (id, tool, args_hash, plan_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, tool, argsHash, JSON.stringify(input.plan), nowIso(now), expiresAt);
  return { id, tool, argsHash, plan: input.plan, createdAt: nowIso(now), expiresAt };
}

export function getPlan(store, id) {
  const row = store.db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    tool: row.tool,
    argsHash: row.args_hash,
    plan: JSON.parse(row.plan_json),
    createdAt: row.created_at,
    expiresAt: row.expires_at || null,
  };
}

export function issueGrant(store, input = {}) {
  assertKnownKeys(input, GRANT_KEYS, 'grant');
  if (!TIERS.includes(input.tier)) throw new Error(`grant.tier must be one of ${TIERS.join(', ')}`);
  if (typeof input.repo !== 'string' || !REPO_PATTERN.test(input.repo))
    throw new Error('grant.repo must be owner/repository');
  positiveInt(input.project, 'grant.project');
  if (!Array.isArray(input.tools) || !input.tools.length) throw new Error('grant.tools must be a non-empty array');
  for (const tool of input.tools) requireString(tool, 'grant.tools[]');
  if (input.tasks !== undefined) {
    if (!Array.isArray(input.tasks)) throw new Error('grant.tasks must be an array of issue numbers');
    for (const task of input.tasks) positiveInt(task, 'grant.tasks[]');
  }
  if (input.limits !== undefined) {
    if (input.limits === null || typeof input.limits !== 'object' || Array.isArray(input.limits)) {
      throw new Error('grant.limits must be an object');
    }
    for (const key of Object.keys(input.limits)) {
      if (!LIMIT_KEYS.includes(key)) throw new Error(`grant.limits.${key} is not a known field`);
    }
    for (const [key, value] of Object.entries(input.limits)) {
      if (!Number.isInteger(value) || value < 0) throw new Error(`grant.limits.${key} must be a non-negative integer`);
    }
  }
  const issuedBy = requireString(input.issuedBy, 'grant.issuedBy');
  const approvalId = requireString(input.approvalId, 'grant.approvalId');
  const approval = getApproval(store, approvalId);
  if (!approval) throw new Error(`grant.approvalId ${approvalId} does not exist; grants require a recorded approval`);
  const now = store.now();
  if (approval.expiresAt && Date.parse(approval.expiresAt) <= now) throw new Error('grant approval has expired');
  const expiresAt = plannedExpiry({
    expiresAt: input.expiresAt,
    ttlMinutes: input.ttlMinutes ?? 60,
    now,
    label: 'grant.',
  });
  requireFuture(expiresAt, now, 'grant.expiresAt');
  assertNoSecrets(input, 'grant');
  const id = newId();
  store.db
    .prepare(
      `INSERT INTO grants (id, tier, repo, project, tools_json, tasks_json, limits_json, approval_id, issued_by, issued_at, expires_at, revoked_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(
      id,
      input.tier,
      input.repo,
      input.project,
      JSON.stringify(input.tools),
      JSON.stringify(input.tasks || []),
      JSON.stringify(input.limits || {}),
      approvalId,
      issuedBy,
      nowIso(now),
      expiresAt,
      nowIso(now),
    );
  return getGrant(store, id);
}

export function getGrant(store, id) {
  return grantRow(store.db.prepare('SELECT * FROM grants WHERE id = ?').get(id));
}

export function listGrants(store, { tier = null } = {}) {
  const rows = tier
    ? store.db.prepare('SELECT * FROM grants WHERE tier = ? ORDER BY created_at ASC').all(tier)
    : store.db.prepare('SELECT * FROM grants ORDER BY created_at ASC').all();
  return rows.map(grantRow);
}

export function isRevoked(store, subjectType, subjectId) {
  return Boolean(
    store.db
      .prepare('SELECT 1 AS hit FROM revocations WHERE subject_type = ? AND subject_id = ?')
      .get(subjectType, subjectId),
  );
}

export function revokeSubject(store, { subjectType, subjectId, reason } = {}) {
  if (!['grant', 'lease'].includes(subjectType)) throw new Error('revocation.subjectType must be grant or lease');
  requireString(subjectId, 'revocation.subjectId');
  const why = requireString(reason, 'revocation.reason');
  assertNoSecrets(why, 'revocation.reason');
  const table = subjectType === 'grant' ? 'grants' : 'leases';
  const existing = store.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(subjectId);
  if (!existing) throw new Error(`${subjectType} ${subjectId} does not exist`);
  const at = nowIso(store.now());
  return withTransaction(store, () => {
    store.db
      .prepare(
        `INSERT INTO revocations (subject_type, subject_id, reason, revoked_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(subject_type, subject_id) DO UPDATE SET reason = excluded.reason, revoked_at = excluded.revoked_at`,
      )
      .run(subjectType, subjectId, why, at);
    store.db.prepare(`UPDATE ${table} SET revoked_at = ? WHERE id = ?`).run(at, subjectId);
    return { subjectType, subjectId, reason: why, revokedAt: at };
  });
}

function assertActiveGrant(store, grant, now) {
  if (!grant) throw new Error('lease grant does not exist');
  if (grant.revokedAt) throw new Error(`grant ${grant.id} is revoked`);
  if (isRevoked(store, 'grant', grant.id)) throw new Error(`grant ${grant.id} is revoked`);
  if (Date.parse(grant.expiresAt) <= now) throw new Error(`grant ${grant.id} has expired`);
}

export function issueLease(store, input = {}) {
  assertKnownKeys(input, LEASE_KEYS, 'lease');
  const grantId = requireString(input.grantId, 'lease.grantId');
  const tool = requireString(input.tool, 'lease.tool');
  const argsHash = requireString(input.argsHash, 'lease.argsHash');
  const grant = getGrant(store, grantId);
  const now = store.now();
  assertActiveGrant(store, grant, now);
  if (!grant.tools.includes(tool)) throw new Error(`tool ${JSON.stringify(tool)} is not in grant ${grantId}`);
  let task = null;
  if (input.task !== undefined && input.task !== null) {
    task = positiveInt(input.task, 'lease.task');
    if (grant.tasks.length && !grant.tasks.includes(task)) {
      throw new Error(`task #${task} is outside grant ${grantId} scope (${grant.tasks.join(', ')})`);
    }
  }
  if (input.maxUses !== undefined && input.maxUses !== null) positiveInt(input.maxUses, 'lease.maxUses');
  const expiresAt = plannedExpiry({
    expiresAt: input.expiresAt,
    ttlMinutes: input.ttlMinutes ?? 30,
    now,
    label: 'lease.',
  });
  requireFuture(expiresAt, now, 'lease.expiresAt');
  if (Date.parse(expiresAt) > Date.parse(grant.expiresAt)) {
    throw new Error('lease expiry must not outlive its grant');
  }
  assertNoSecrets(input, 'lease');
  const id = newId();
  store.db
    .prepare(
      `INSERT INTO leases (id, grant_id, tool, task, args_hash, issued_at, expires_at, max_uses, uses, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
    )
    .run(id, grantId, tool, task, argsHash, nowIso(now), expiresAt, input.maxUses ?? null);
  return getLease(store, id);
}

export function getLease(store, id) {
  return leaseRow(store.db.prepare('SELECT * FROM leases WHERE id = ?').get(id));
}

export function listLeases(store, { grantId = null } = {}) {
  const rows = grantId
    ? store.db.prepare('SELECT * FROM leases WHERE grant_id = ? ORDER BY issued_at ASC').all(grantId)
    : store.db.prepare('SELECT * FROM leases ORDER BY issued_at ASC').all();
  return rows.map(leaseRow);
}

/**
 * Consume a lease for one apply. Re-checks revocation, expiry, tool, args hash, and the use budget
 * inside a single write transaction; throws (fail closed) on any mismatch.
 */
export function useLease(store, { leaseId, tool, argsHash } = {}) {
  requireString(leaseId, 'leaseId');
  requireString(tool, 'tool');
  requireString(argsHash, 'argsHash');
  return withTransaction(store, () => {
    const lease = getLease(store, leaseId);
    if (!lease) throw new Error(`lease ${leaseId} does not exist`);
    const now = store.now();
    if (lease.revokedAt || isRevoked(store, 'lease', lease.id)) throw new Error(`lease ${lease.id} is revoked`);
    if (Date.parse(lease.expiresAt) <= now) throw new Error(`lease ${lease.id} has expired`);
    if (lease.tool !== tool)
      throw new Error(`lease tool ${JSON.stringify(lease.tool)} does not match call tool ${JSON.stringify(tool)}`);
    if (lease.argsHash !== argsHash) throw new Error(`lease args hash does not match the call args hash`);
    if (lease.maxUses !== null && lease.uses >= lease.maxUses)
      throw new Error(`lease ${lease.id} exhausted ${lease.maxUses} use(s)`);
    store.db.prepare('UPDATE leases SET uses = uses + 1 WHERE id = ?').run(lease.id);
    return { ...lease, uses: lease.uses + 1 };
  });
}

export function getIdempotent(store, key) {
  const row = store.db.prepare('SELECT * FROM idempotency WHERE key = ?').get(String(key));
  if (!row) return null;
  return { key: row.key, tool: row.tool, result: JSON.parse(row.result_json), createdAt: row.created_at };
}

/** Idempotent write: a duplicate key returns the first recorded result instead of inserting again. */
export function putIdempotent(store, { key, tool, result } = {}) {
  const idKey = requireString(key, 'idempotency.key');
  const idTool = requireString(tool, 'idempotency.tool');
  assertNoSecrets(result, 'idempotency.result');
  return withTransaction(store, () => {
    const existing = getIdempotent(store, idKey);
    if (existing) return { created: false, row: existing };
    const createdAt = nowIso(store.now());
    store.db
      .prepare('INSERT INTO idempotency (key, tool, result_json, created_at) VALUES (?, ?, ?, ?)')
      .run(idKey, idTool, JSON.stringify(result ?? null), createdAt);
    return { created: true, row: { key: idKey, tool: idTool, result: result ?? null, createdAt } };
  });
}
