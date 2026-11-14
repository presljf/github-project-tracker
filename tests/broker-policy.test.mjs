import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIMITS,
  DEFAULT_TTL_MINUTES,
  assertPolicy,
  assertToolAllowed,
  loadPolicy,
  pathAllowed,
  toolAllowed,
  validatePolicy,
} from '../scripts/adopt/lib/broker-policy.mjs';

function validPolicy(overrides = {}) {
  return {
    tier: 'proposal',
    repo: 'presljf/github-project-tracker',
    project: 2,
    tools: ['tracker_proposal_create'],
    tasks: [188],
    limits: { maxWritesPerRun: 1 },
    paths: { allow: ['docs/'], deny: ['docs/private/'] },
    approval: 'human',
    ttl: { grantMinutes: 120 },
    ...overrides,
  };
}

test('accepts a valid policy and fills optional defaults', () => {
  assert.deepEqual(validatePolicy(validPolicy()), []);
  const policy = loadPolicy(validPolicy());
  assert.equal(policy.tier, 'proposal');
  assert.deepEqual(policy.limits, { ...DEFAULT_LIMITS, maxWritesPerRun: 1 });
  assert.deepEqual(policy.ttl, { ...DEFAULT_TTL_MINUTES, grantMinutes: 120 });
  assert.equal(policy.approval, 'human');
  assert.ok(Object.isFrozen(policy));
});

test('rejects unknown top-level and nested fields', () => {
  assert.match(
    validatePolicy(validPolicy({ requiredChecks: [] })).join('\n'),
    /policy\.requiredChecks is not a known field/,
  );
  assert.match(validatePolicy(validPolicy({ limits: { maxWritesPerRun: 1, burst: 2 } })).join('\n'), /limits\.burst/);
  assert.match(validatePolicy(validPolicy({ paths: { allow: ['docs/'], skip: true } })).join('\n'), /paths\.skip/);
  assert.match(validatePolicy(validPolicy({ ttl: { leaseMinutes: 5, forever: 1 } })).join('\n'), /ttl\.forever/);
  assert.match(validatePolicy(validPolicy({ approval: 'auto' })).join('\n'), /approval/);
});

test('rejects malformed tier/repo/project/tools/tasks/ttl values', () => {
  assert.match(validatePolicy(validPolicy({ tier: 'root' })).join('\n'), /tier must be one of/);
  assert.match(validatePolicy(validPolicy({ repo: 'not-a-repo' })).join('\n'), /repo must be owner\/repository/);
  assert.match(validatePolicy(validPolicy({ project: 0 })).join('\n'), /project must be a positive integer/);
  assert.match(validatePolicy(validPolicy({ tools: [] })).join('\n'), /tools must be a non-empty/);
  assert.match(validatePolicy(validPolicy({ tools: undefined })).join('\n'), /tools is required/);
  assert.match(validatePolicy(validPolicy({ tools: ['a', 'a'] })).join('\n'), /duplicate/);
  assert.match(validatePolicy(validPolicy({ tasks: [0] })).join('\n'), /tasks must contain positive integers/);
  assert.match(
    validatePolicy(validPolicy({ ttl: { grantMinutes: 0 } })).join('\n'),
    /grantMinutes must be a positive integer/,
  );
  assert.match(validatePolicy(validPolicy({ limits: { maxWritesPerRun: -1 } })).join('\n'), /non-negative integer/);
});

test('assertPolicy throws one actionable error for invalid policy', () => {
  assert.throws(
    () => assertPolicy(validPolicy({ tier: 'root', project: -1 })),
    /invalid broker policy:[\s\S]*tier[\s\S]*project/,
  );
});

test('tool allowlist is fail-closed', () => {
  const policy = loadPolicy(validPolicy());
  assert.equal(toolAllowed(policy, 'tracker_proposal_create'), true);
  assert.equal(toolAllowed(policy, 'tracker_task_done'), false);
  assert.throws(() => assertToolAllowed(policy, 'tracker_task_done'), /not in the policy allowlist/);
  assert.equal(toolAllowed({ tools: [] }, 'anything'), false);
});

test('path rules deny first, normalize separators, and fail closed when allow is empty', () => {
  const policy = loadPolicy(validPolicy());
  assert.equal(pathAllowed(policy, 'docs/BROKER_STORE.md'), true);
  assert.equal(pathAllowed(policy, './docs/BROKER_STORE.md'), true);
  assert.equal(pathAllowed(policy, 'docs/private/secret.md'), false);
  assert.equal(pathAllowed(policy, 'scripts/adopt/lib/broker-store.mjs'), false);
  assert.equal(pathAllowed(loadPolicy(validPolicy({ paths: { allow: [], deny: [] } })), 'docs/x.md'), false);
});
