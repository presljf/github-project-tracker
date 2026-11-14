/**
 * Broker call log and external audit copy (P0.1).
 *
 * Every call appends one hash-chained row: `hash = sha256(prevHash, at, tool, argsHash, outcome,
 * canonical(detail))`. `verifyCallLog` recomputes the whole chain, so an UPDATE/DELETE or a reorder
 * is detected. Each entry is also appended to a sibling JSONL audit copy for out-of-band review.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertNoSecrets, nowIso, withTransaction } from './broker-store.mjs';

export const GENESIS_HASH = '0'.repeat(64);
export const CALL_OUTCOMES = Object.freeze(['ok', 'error', 'denied', 'planned', 'applied']);
const CALL_KEYS = ['tool', 'argsHash', 'leaseId', 'planId', 'outcome', 'detail'];

function assertKnownKeys(value, allowed, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label}.${key} is not a known field`);
  }
}

/** Deterministic JSON so the hash cannot drift with key order. */
export function canonicalJson(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function chainHash(prevHash, entry) {
  const material = [
    prevHash,
    entry.at,
    entry.tool,
    entry.argsHash ?? '',
    entry.outcome,
    canonicalJson(entry.detail ?? null),
  ].join('\n');
  return crypto.createHash('sha256').update(material).digest('hex');
}

function appendAuditCopy(file, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort; the store directory is already 0700 and the caller owns the file.
  }
}

/**
 * Append one call-log entry. The insert and the audit-copy append happen inside one transaction so a
 * failed write does not leave a database row behind.
 */
export function appendCall(store, input = {}) {
  assertKnownKeys(input, CALL_KEYS, 'call');
  if (typeof input.tool !== 'string' || !input.tool.trim()) throw new Error('call.tool is required');
  const outcome = input.outcome ?? 'ok';
  if (!CALL_OUTCOMES.includes(outcome)) throw new Error(`call.outcome must be one of ${CALL_OUTCOMES.join(', ')}`);
  assertNoSecrets({ tool: input.tool, detail: input.detail ?? null }, 'call');
  return withTransaction(store, () => {
    const previous = store.db.prepare('SELECT hash FROM call_log ORDER BY seq DESC LIMIT 1').get();
    const prevHash = previous?.hash || GENESIS_HASH;
    const entry = {
      at: nowIso(store.now()),
      tool: input.tool,
      argsHash: input.argsHash ?? null,
      leaseId: input.leaseId ?? null,
      planId: input.planId ?? null,
      outcome,
      detail: input.detail ?? null,
    };
    const hash = chainHash(prevHash, entry);
    const inserted = store.db
      .prepare(
        `INSERT INTO call_log (at, tool, args_hash, lease_id, plan_id, outcome, detail_json, prev_hash, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.at,
        entry.tool,
        entry.argsHash,
        entry.leaseId,
        entry.planId,
        entry.outcome,
        entry.detail === null ? null : JSON.stringify(entry.detail),
        prevHash,
        hash,
      );
    const row = { seq: Number(inserted.lastInsertRowid), ...entry, prevHash, hash };
    appendAuditCopy(store.auditPath, row);
    return row;
  });
}

/** Recompute the chain; returns the first broken sequence number instead of trusting stored hashes. */
export function verifyCallLog(store) {
  const rows = store.db.prepare('SELECT * FROM call_log ORDER BY seq ASC').all();
  let prevHash = GENESIS_HASH;
  for (const row of rows) {
    const entry = {
      at: row.at,
      tool: row.tool,
      argsHash: row.args_hash,
      leaseId: row.lease_id,
      planId: row.plan_id,
      outcome: row.outcome,
      detail: row.detail_json ? JSON.parse(row.detail_json) : null,
    };
    const expected = chainHash(prevHash, entry);
    if (row.prev_hash !== prevHash)
      return { ok: false, count: rows.length, brokenAt: row.seq, reason: 'prev_hash mismatch' };
    if (row.hash !== expected) return { ok: false, count: rows.length, brokenAt: row.seq, reason: 'hash mismatch' };
    prevHash = row.hash;
  }
  return { ok: true, count: rows.length };
}

/** Read the append-only audit copy (store object or explicit path). */
export function readAuditCopy(storeOrPath, { limit = 1000 } = {}) {
  const file = typeof storeOrPath === 'string' ? storeOrPath : storeOrPath.auditPath;
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const capped = Math.max(1, Math.min(10_000, Number(limit) || 1000));
  return lines.slice(-capped).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`audit copy is corrupt at line ${index + 1}: ${file}`);
    }
  });
}
