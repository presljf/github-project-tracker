/**
 * Broker mutation outbox (P0.1).
 *
 * Intent is recorded before any GitHub mutation, so a crash cannot leave "the mutation happened but
 * the database says nothing". A startup reconcile asks the caller's checker what happened and marks
 * the row applied/failed/unknown; unknown rows are never blindly retried because retries may not be
 * idempotent.
 */
import { assertNoSecrets, newId, nowIso } from './broker-store.mjs';

export const OUTBOX_STATES = Object.freeze(['pending', 'applied', 'failed', 'unknown']);
const INTENT_KEYS = ['tool', 'argsHash', 'idempotencyKey', 'payload'];
const TERMINAL = new Set(['applied', 'failed']);

function assertKnownKeys(value, allowed, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label}.${key} is not a known field`);
  }
}

function outboxRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    tool: row.tool,
    argsHash: row.args_hash,
    idempotencyKey: row.idempotency_key || null,
    payload: JSON.parse(row.payload_json),
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    detail: row.detail_json ? JSON.parse(row.detail_json) : null,
  };
}

export function recordIntent(store, input = {}) {
  assertKnownKeys(input, INTENT_KEYS, 'intent');
  if (typeof input.tool !== 'string' || !input.tool.trim()) throw new Error('intent.tool is required');
  if (typeof input.argsHash !== 'string' || !input.argsHash.trim()) throw new Error('intent.argsHash is required');
  if (
    input.payload !== undefined &&
    (input.payload === null || typeof input.payload !== 'object' || Array.isArray(input.payload))
  ) {
    throw new Error('intent.payload must be an object');
  }
  assertNoSecrets(input, 'intent');
  const at = nowIso(store.now());
  const id = newId();
  store.db
    .prepare(
      `INSERT INTO outbox (id, tool, args_hash, idempotency_key, payload_json, state, created_at, updated_at, detail_json)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL)`,
    )
    .run(id, input.tool, input.argsHash, input.idempotencyKey || null, JSON.stringify(input.payload || {}), at, at);
  return getOutbox(store, id);
}

export function getOutbox(store, id) {
  return outboxRow(store.db.prepare('SELECT * FROM outbox WHERE id = ?').get(id));
}

export function listOutbox(store, { state = null } = {}) {
  const rows = state
    ? store.db.prepare('SELECT * FROM outbox WHERE state = ? ORDER BY created_at ASC').all(state)
    : store.db.prepare('SELECT * FROM outbox ORDER BY created_at ASC').all();
  return rows.map(outboxRow);
}

function transition(store, id, state, detail) {
  if (!OUTBOX_STATES.includes(state)) throw new Error(`outbox state must be one of ${OUTBOX_STATES.join(', ')}`);
  const row = getOutbox(store, id);
  if (!row) throw new Error(`outbox ${id} does not exist`);
  if (row.state === state) return row;
  if (TERMINAL.has(row.state))
    throw new Error(`outbox ${id} is already ${row.state}; refusing ${row.state} -> ${state}`);
  if (detail !== null && detail !== undefined) assertNoSecrets(detail, 'outbox detail');
  store.db
    .prepare('UPDATE outbox SET state = ?, updated_at = ?, detail_json = ? WHERE id = ?')
    .run(state, nowIso(store.now()), detail === null || detail === undefined ? null : JSON.stringify(detail), id);
  return getOutbox(store, id);
}

export function markApplied(store, id, { detail = null } = {}) {
  return transition(store, id, 'applied', detail);
}

export function markFailed(store, id, { detail = null } = {}) {
  return transition(store, id, 'failed', detail);
}

export function markUnknown(store, id, { detail = null } = {}) {
  return transition(store, id, 'unknown', detail);
}

/**
 * Resolve unresolved intents (pending/unknown) after a restart.
 *
 * With a checker, each row's verdict decides its state. Without one, only pending rows older than
 * `staleAfterMs` are marked unknown — nothing is retried automatically.
 */
export async function reconcileOutbox(store, { check = null, staleAfterMs = 0 } = {}) {
  if (check !== null && typeof check !== 'function') throw new Error('reconcile check must be a function');
  const rows = store.db
    .prepare("SELECT * FROM outbox WHERE state IN ('pending','unknown') ORDER BY created_at ASC")
    .all();
  const summary = { checked: rows.length, applied: 0, failed: 0, unknown: 0, skipped: 0 };
  if (!check) {
    const cutoff = store.now() - Math.max(0, Number(staleAfterMs) || 0);
    for (const raw of rows) {
      const row = outboxRow(raw);
      if (row.state !== 'pending') {
        summary.skipped += 1;
        continue;
      }
      if (Date.parse(row.createdAt) > cutoff) {
        summary.skipped += 1;
        continue;
      }
      markUnknown(store, row.id, { detail: { reason: 'no checker; stale pending intent' } });
      summary.unknown += 1;
    }
    return summary;
  }
  for (const raw of rows) {
    const row = outboxRow(raw);
    if (row.state === 'unknown' && row.detail?.reason === 'no checker; stale pending intent') {
      // Still unresolved; the checker gets a chance to settle it in this pass.
    }
    const verdict = await check(row);
    const outcome = verdict?.outcome;
    if (!['applied', 'failed', 'unknown'].includes(outcome)) {
      throw new Error(`reconcile checker returned invalid outcome for outbox ${row.id}: ${JSON.stringify(outcome)}`);
    }
    const detail = verdict?.detail ?? null;
    if (outcome === 'applied') {
      markApplied(store, row.id, { detail });
      summary.applied += 1;
    } else if (outcome === 'failed') {
      markFailed(store, row.id, { detail });
      summary.failed += 1;
    } else {
      markUnknown(store, row.id, { detail });
      summary.unknown += 1;
    }
  }
  return summary;
}
