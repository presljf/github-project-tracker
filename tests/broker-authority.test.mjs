import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../scripts/adopt/lib/broker-store.mjs';
import {
  createApproval,
  getApproval,
  getGrant,
  getLease,
  getPlan,
  getIdempotent,
  issueGrant,
  issueLease,
  putIdempotent,
  revokeSubject,
  savePlan,
  useLease,
} from '../scripts/adopt/lib/broker-authority.mjs';

const REPO = 'presljf/github-project-tracker';
const HASH = 'a'.repeat(64);

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-broker-authority-'));
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const store = openStore({ path: path.join(dir, 'broker.db'), now: () => clock });
  return {
    store,
    advance(ms) {
      clock += ms;
    },
    close() {
      store.close();
    },
  };
}

function grantInput(approvalId, overrides = {}) {
  return {
    tier: 'proposal',
    repo: REPO,
    project: 2,
    tools: ['tracker_proposal_create'],
    tasks: [188],
    approvalId,
    issuedBy: 'owner',
    ttlMinutes: 60,
    ...overrides,
  };
}

function withContext(fn) {
  const ctx = setup();
  try {
    return fn(ctx);
  } finally {
    ctx.close();
  }
}

function makeGrant(ctx, overrides = {}) {
  const approval = createApproval(ctx.store, { approvedBy: 'owner', channel: 'chat' });
  return issueGrant(ctx.store, grantInput(approval.id, overrides));
}

function makeLease(ctx, grant, overrides = {}) {
  return issueLease(ctx.store, {
    grantId: grant.id,
    tool: 'tracker_proposal_create',
    task: 188,
    argsHash: HASH,
    ttlMinutes: 10,
    ...overrides,
  });
}

test('a grant requires a recorded, unexpired approval', () => {
  withContext((ctx) => {
    assert.throws(() => issueGrant(ctx.store, grantInput(undefined)), /approvalId is required/);
    assert.throws(() => issueGrant(ctx.store, grantInput('missing-approval')), /does not exist/);
    const approval = createApproval(ctx.store, {
      approvedBy: 'owner',
      channel: 'chat',
      expiresAt: '2026-01-01T00:01:00Z',
    });
    assert.equal(getApproval(ctx.store, approval.id).approvedBy, 'owner');
    ctx.advance(61_000);
    assert.throws(() => issueGrant(ctx.store, grantInput(approval.id)), /approval has expired/);
  });
});

test('grants reject malformed and unknown fields', () => {
  withContext((ctx) => {
    const approval = createApproval(ctx.store, { approvedBy: 'owner', channel: 'chat' });
    assert.throws(() => issueGrant(ctx.store, grantInput(approval.id, { requiredChecks: [] })), /not a known field/);
    assert.throws(() => issueGrant(ctx.store, grantInput(approval.id, { tier: 'root' })), /tier must be one of/);
    assert.throws(
      () => issueGrant(ctx.store, grantInput(approval.id, { repo: 'nope' })),
      /repo must be owner\/repository/,
    );
    assert.throws(
      () => issueGrant(ctx.store, grantInput(approval.id, { tools: [] })),
      /tools must be a non-empty array/,
    );
    assert.throws(() => issueGrant(ctx.store, grantInput(approval.id, { tasks: [0] })), /positive integer/);
    assert.throws(() => issueGrant(ctx.store, grantInput(approval.id, { issuedBy: '' })), /issuedBy is required/);
    assert.throws(
      () => issueGrant(ctx.store, grantInput(approval.id, { limits: { maxWritesPerRun: 1, burst: 2 } })),
      /limits\.burst is not a known field/,
    );
    assert.throws(
      () => issueGrant(ctx.store, grantInput(approval.id, { tools: [`ghp_${'x'.repeat(30)}`] })),
      /secret-like/,
    );
  });
});

test('approvals reject malformed/unknown fields and past expiry', () => {
  withContext((ctx) => {
    assert.throws(
      () => createApproval(ctx.store, { approvedBy: 'owner', channel: 'chat', requiredChecks: [] }),
      /not a known field/,
    );
    assert.throws(() => createApproval(ctx.store, { approvedBy: '', channel: 'chat' }), /approvedBy is required/);
    assert.throws(
      () => createApproval(ctx.store, { approvedBy: 'owner', channel: 'chat', expiresAt: '2000-01-01T00:00:00Z' }),
      /must be in the future/,
    );
  });
});

test('leases are tool-, task-, and args-hash bound', () => {
  withContext((ctx) => {
    const grant = makeGrant(ctx);
    assert.equal(getGrant(ctx.store, grant.id).tools[0], 'tracker_proposal_create');
    const lease = makeLease(ctx, grant);
    assert.equal(getLease(ctx.store, lease.id).task, 188);
    assert.equal(useLease(ctx.store, { leaseId: lease.id, tool: 'tracker_proposal_create', argsHash: HASH }).uses, 1);
    assert.throws(
      () => useLease(ctx.store, { leaseId: lease.id, tool: 'tracker_task_done', argsHash: HASH }),
      /does not match call tool/,
    );
    assert.throws(
      () => useLease(ctx.store, { leaseId: lease.id, tool: 'tracker_proposal_create', argsHash: 'b'.repeat(64) }),
      /args hash does not match/,
    );
    assert.throws(() => makeLease(ctx, grant, { task: 999 }), /outside grant/);
    assert.throws(
      () => issueLease(ctx.store, { grantId: grant.id, tool: 'tracker_task_done', argsHash: HASH, task: 188 }),
      /not in grant/,
    );
  });
});

test('lease expiry and revocation are re-checked on every apply', () => {
  withContext((ctx) => {
    const grant = makeGrant(ctx);
    const expiring = makeLease(ctx, grant, { ttlMinutes: 1 });
    ctx.advance(61_000);
    assert.throws(
      () => useLease(ctx.store, { leaseId: expiring.id, tool: 'tracker_proposal_create', argsHash: HASH }),
      /has expired/,
    );
    const revoked = makeLease(ctx, grant);
    revokeSubject(ctx.store, { subjectType: 'lease', subjectId: revoked.id, reason: 'owner revoke' });
    assert.throws(
      () => useLease(ctx.store, { leaseId: revoked.id, tool: 'tracker_proposal_create', argsHash: HASH }),
      /is revoked/,
    );
  });
});

test('grant expiry and revocation block new leases', () => {
  withContext((ctx) => {
    const shortGrant = makeGrant(ctx, { ttlMinutes: 1 });
    ctx.advance(61_000);
    assert.throws(() => makeLease(ctx, shortGrant), /grant .* has expired/);
    const grant = makeGrant(ctx);
    revokeSubject(ctx.store, { subjectType: 'grant', subjectId: grant.id, reason: 'owner revoke' });
    assert.throws(() => makeLease(ctx, grant), /is revoked/);
  });
});

test('a lease cannot outlive its grant or exceed its use budget', () => {
  withContext((ctx) => {
    const grant = makeGrant(ctx, { ttlMinutes: 5 });
    assert.throws(() => makeLease(ctx, grant, { ttlMinutes: 10 }), /must not outlive/);
    const once = makeLease(ctx, grant, { maxUses: 1, ttlMinutes: 5 });
    useLease(ctx.store, { leaseId: once.id, tool: 'tracker_proposal_create', argsHash: HASH });
    assert.throws(
      () => useLease(ctx.store, { leaseId: once.id, tool: 'tracker_proposal_create', argsHash: HASH }),
      /exhausted/,
    );
  });
});

test('idempotency returns the first recorded result for a duplicate key', () => {
  withContext((ctx) => {
    const first = putIdempotent(ctx.store, {
      key: 'proposal-1',
      tool: 'tracker_proposal_create',
      result: { issue: 7 },
    });
    const second = putIdempotent(ctx.store, {
      key: 'proposal-1',
      tool: 'tracker_proposal_create',
      result: { issue: 99 },
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.deepEqual(second.row.result, { issue: 7 });
    assert.deepEqual(getIdempotent(ctx.store, 'proposal-1').result, { issue: 7 });
  });
});

test('plans round-trip and refuse secret-like content', () => {
  withContext((ctx) => {
    const saved = savePlan(ctx.store, {
      tool: 'tracker_proposal_create',
      argsHash: HASH,
      plan: { title: '[Proposal] Test', fields: { Status: 'Proposed' } },
    });
    assert.deepEqual(getPlan(ctx.store, saved.id).plan.fields, { Status: 'Proposed' });
    assert.throws(
      () =>
        savePlan(ctx.store, {
          tool: 'tracker_proposal_create',
          argsHash: HASH,
          plan: { token: `ghp_${'z'.repeat(30)}` },
        }),
      /secret-like/,
    );
    assert.throws(
      () => savePlan(ctx.store, { tool: 'tracker_proposal_create', argsHash: HASH, plan: [] }),
      /must be an object/,
    );
  });
});

test('revocation is idempotent and updatable', () => {
  withContext((ctx) => {
    const grant = makeGrant(ctx);
    revokeSubject(ctx.store, { subjectType: 'grant', subjectId: grant.id, reason: 'first' });
    revokeSubject(ctx.store, { subjectType: 'grant', subjectId: grant.id, reason: 'second' });
    assert.equal(getGrant(ctx.store, grant.id).revokedAt !== null, true);
  });
});
