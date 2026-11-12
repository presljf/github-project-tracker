import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRequiredChecks } from '../scripts/github/merge-pr.mjs';

const checks = [
  { name: 'ci / ci-gate', conclusion: 'SUCCESS' },
  { name: 'docs-guard', conclusion: 'SUCCESS' },
];

test('accepts green required checks', () => {
  assert.deepEqual(evaluateRequiredChecks(checks, ['ci / ci-gate', 'docs-guard']), {
    ok: true,
    missing: [],
    failing: [],
  });
});

test('rejects missing required check', () => {
  const r = evaluateRequiredChecks(
    checks.filter((c) => c.name !== 'docs-guard'),
    ['ci / ci-gate', 'docs-guard'],
  );
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['docs-guard']);
});

test('rejects failing/skipped required check', () => {
  for (const conclusion of ['FAILURE', 'CANCELLED', 'SKIPPED', null]) {
    const r = evaluateRequiredChecks([{ name: 'ci / ci-gate', conclusion }], ['ci / ci-gate']);
    assert.equal(r.ok, false);
  }
});
