import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, queryCalls } from '../scripts/adopt/lib/broker-store.mjs';
import { appendCall, canonicalJson, readAuditCopy, verifyCallLog } from '../scripts/adopt/lib/broker-ledger.mjs';

function withStore(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-broker-ledger-'));
  const store = openStore({ path: path.join(dir, 'broker.db'), now: () => Date.parse('2026-01-01T00:00:00Z') });
  try {
    return fn(store, dir);
  } finally {
    store.close();
  }
}

test('appends a verifiable hash chain and mirrors it to the audit copy', () => {
  withStore((store) => {
    appendCall(store, { tool: 'tracker_proposal_create', argsHash: 'a'.repeat(64), outcome: 'planned' });
    appendCall(store, {
      tool: 'tracker_proposal_create',
      argsHash: 'a'.repeat(64),
      outcome: 'applied',
      detail: { issue: 9 },
    });
    appendCall(store, { tool: 'tracker_task_status', outcome: 'ok', detail: { issue: 9 } });
    const verification = verifyCallLog(store);
    assert.deepEqual(verification, { ok: true, count: 3 });
    const audit = readAuditCopy(store);
    assert.equal(audit.length, 3);
    assert.deepEqual(
      audit.map((entry) => entry.seq),
      [1, 2, 3],
    );
    assert.equal(fs.statSync(store.auditPath).mode & 0o777, 0o600);
  });
});

test('detects tampering with a stored row', () => {
  withStore((store) => {
    appendCall(store, { tool: 'a' });
    appendCall(store, { tool: 'b' });
    appendCall(store, { tool: 'c' });
    store.db.prepare("UPDATE call_log SET outcome = 'error' WHERE seq = 2").run();
    const verification = verifyCallLog(store);
    assert.equal(verification.ok, false);
    assert.equal(verification.brokenAt, 2);
  });
});

test('detects a deleted entry', () => {
  withStore((store) => {
    appendCall(store, { tool: 'a' });
    appendCall(store, { tool: 'b' });
    appendCall(store, { tool: 'c' });
    store.db.prepare('DELETE FROM call_log WHERE seq = 2').run();
    const verification = verifyCallLog(store);
    assert.equal(verification.ok, false);
    assert.equal(verification.brokenAt, 3);
    assert.match(verification.reason, /prev_hash/);
  });
});

test('rejects unknown fields, unknown outcomes, and secret-like detail', () => {
  withStore((store) => {
    assert.throws(() => appendCall(store, { tool: 'a', requiredChecks: [] }), /not a known field/);
    assert.throws(() => appendCall(store, { tool: 'a', outcome: 'root' }), /outcome must be one of/);
    assert.throws(() => appendCall(store, { tool: 'a', detail: { token: `ghp_${'q'.repeat(30)}` } }), /secret-like/);
    assert.throws(() => appendCall(store, {}), /tool is required/);
  });
});

test('query API filters by tool, prefix, and limit', () => {
  withStore((store) => {
    appendCall(store, { tool: 'tracker_proposal_create' });
    appendCall(store, { tool: 'tracker_task_status' });
    appendCall(store, { tool: 'tracker_proposal_create' });
    assert.equal(queryCalls(store, { tool: 'tracker_proposal_create' }).length, 2);
    assert.equal(queryCalls(store, { toolPrefix: 'tracker_task' }).length, 1);
    assert.equal(queryCalls(store, { limit: 1 }).length, 1);
    assert.equal(queryCalls(store, { tool: 'missing' }).length, 0);
  });
});

test('canonical JSON is key-order independent', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
  assert.equal(canonicalJson(undefined), 'null');
});
