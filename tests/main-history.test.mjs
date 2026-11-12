import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMainHistory } from '../scripts/github/check-main-history.mjs';
test('accepts every main commit with a merged PR', () => {
  assert.equal(evaluateMainHistory({ commits: ['a'], pullsBySha: { a: [{ merged_at: '2026-01-01' }] } }).ok, true);
});
test('flags direct main commits', () => {
  const r = evaluateMainHistory({ commits: ['a', 'b'], pullsBySha: { a: [{ merged_at: '2026-01-01' }], b: [] } });
  assert.equal(r.ok, false);
  assert.deepEqual(r.violations, ['b']);
});
