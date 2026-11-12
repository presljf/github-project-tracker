import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalTitle, expectedType, buildReconciliationPlan } from '../scripts/github/reconcile-metadata.mjs';

test('canonicalizes legacy release/sprint titles', () => {
  assert.equal(canonicalTitle('[v0.5.0] Release tracking — Quick wins'), '[Release] v0.5.0 — Quick wins');
  assert.equal(
    canonicalTitle('[0.5.6] Sprint — Tracker contract adoption'),
    '[Sprint] 0.5.6 — Tracker contract adoption',
  );
  assert.equal(canonicalTitle('[Release] v0.5.0 — already'), null);
});
test('expected types follow canonical mapping', () => {
  assert.equal(expectedType('[Release] v0.5.0 — x'), 'Task');
  assert.equal(expectedType('[Sprint] 0.5.6 — x'), 'Task');
  assert.equal(expectedType('[0.5.6-T01] x'), 'Feature');
});
test('plan reports rename and type fixes, excluding closed by default', () => {
  const issues = [
    { number: 1, state: 'OPEN', title: '[v0.5.0] Release tracking — x', issueType: { name: 'Task' } },
    { number: 2, state: 'OPEN', title: '[0.5.6-T01] x', issueType: { name: 'Task' } },
    { number: 3, state: 'CLOSED', title: '[0.5.1] Sprint — x', issueType: { name: 'Task' } },
  ];
  const plan = buildReconciliationPlan({ issues });
  assert.deepEqual(
    plan.map((p) => p.number),
    [1, 2],
  );
  assert.equal(plan[0].actions[0].type, 'rename');
  assert.equal(plan[1].actions[0].type, 'type');
});
