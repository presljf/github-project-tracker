import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../scripts/adopt/lib/broker-store.mjs';
import {
  getOutbox,
  listOutbox,
  markApplied,
  markFailed,
  reconcileOutbox,
  recordIntent,
} from '../scripts/adopt/lib/broker-outbox.mjs';

function tempPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-broker-outbox-'));
  return path.join(dir, 'broker.db');
}

function setup(file = tempPath()) {
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const store = openStore({ path: file, now: () => clock });
  return {
    store,
    file,
    advance(ms) {
      clock += ms;
    },
    close() {
      store.close();
    },
  };
}

const HASH = 'c'.repeat(64);

test('records intent before a mutation and lists it pending', () => {
  const ctx = setup();
  try {
    const intent = recordIntent(ctx.store, {
      tool: 'tracker_proposal_create',
      argsHash: HASH,
      idempotencyKey: 'proposal-1',
      payload: { title: '[Proposal] Example' },
    });
    assert.equal(intent.state, 'pending');
    assert.deepEqual(intent.payload, { title: '[Proposal] Example' });
    assert.deepEqual(
      listOutbox(ctx.store, { state: 'pending' }).map((row) => row.id),
      [intent.id],
    );
    assert.equal(getOutbox(ctx.store, intent.id).idempotencyKey, 'proposal-1');
  } finally {
    ctx.close();
  }
});

test('marks applied/failed and refuses terminal transitions', () => {
  const ctx = setup();
  try {
    const intent = recordIntent(ctx.store, { tool: 't', argsHash: HASH });
    assert.equal(markApplied(ctx.store, intent.id, { detail: { issue: 4 } }).state, 'applied');
    assert.equal(markApplied(ctx.store, intent.id).state, 'applied');
    assert.throws(() => markFailed(ctx.store, intent.id), /already applied/);
  } finally {
    ctx.close();
  }
});

test('reconciles a crash between the mutation and the database commit', async () => {
  const ctx = setup();
  const intent = recordIntent(ctx.store, { tool: 'tracker_proposal_create', argsHash: HASH, payload: { title: 'x' } });
  ctx.store.close();
  const reopened = openStore({ path: ctx.file, now: () => Date.parse('2026-01-02T00:00:00Z') });
  try {
    const summary = await reconcileOutbox(reopened, {
      check: () => ({ outcome: 'applied', detail: { issue: 42 } }),
    });
    assert.deepEqual(summary, { checked: 1, applied: 1, failed: 0, unknown: 0, skipped: 0 });
    assert.equal(getOutbox(reopened, intent.id).state, 'applied');
    assert.deepEqual(getOutbox(reopened, intent.id).detail, { issue: 42 });
  } finally {
    reopened.close();
  }
});

test('without a checker, stale pending becomes unknown and is not retried', async () => {
  const ctx = setup();
  try {
    const intent = recordIntent(ctx.store, { tool: 't', argsHash: HASH });
    ctx.advance(1000);
    const first = await reconcileOutbox(ctx.store, { staleAfterMs: 0 });
    assert.deepEqual(first, { checked: 1, applied: 0, failed: 0, unknown: 1, skipped: 0 });
    assert.equal(getOutbox(ctx.store, intent.id).state, 'unknown');
    const second = await reconcileOutbox(ctx.store, { staleAfterMs: 0 });
    assert.deepEqual(second, { checked: 1, applied: 0, failed: 0, unknown: 0, skipped: 1 });
    assert.equal(getOutbox(ctx.store, intent.id).state, 'unknown');
  } finally {
    ctx.close();
  }
});

test('a checker can settle an unknown intent later', async () => {
  const ctx = setup();
  try {
    const intent = recordIntent(ctx.store, { tool: 't', argsHash: HASH });
    await reconcileOutbox(ctx.store, { check: () => ({ outcome: 'unknown', detail: { reason: 'no id yet' } }) });
    assert.equal(getOutbox(ctx.store, intent.id).state, 'unknown');
    await reconcileOutbox(ctx.store, { check: () => ({ outcome: 'failed', detail: { reason: '404' } }) });
    assert.equal(getOutbox(ctx.store, intent.id).state, 'failed');
  } finally {
    ctx.close();
  }
});

test('rejects invalid checker outcomes, unknown fields, and secrets', async () => {
  const ctx = setup();
  try {
    assert.throws(
      () => recordIntent(ctx.store, { tool: 't', argsHash: HASH, requiredChecks: [] }),
      /not a known field/,
    );
    assert.throws(
      () => recordIntent(ctx.store, { tool: 't', argsHash: HASH, payload: { token: `ghp_${'w'.repeat(30)}` } }),
      /secret-like/,
    );
    recordIntent(ctx.store, { tool: 't', argsHash: HASH });
    await assert.rejects(() => reconcileOutbox(ctx.store, { check: () => ({ outcome: 'root' }) }), /invalid outcome/);
  } finally {
    ctx.close();
  }
});
