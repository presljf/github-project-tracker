import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBypass } from '../scripts/github/post-merge-audit.mjs';

const green = [
  { name: 'ci / ci-gate', conclusion: 'SUCCESS' },
  { name: 'docs-guard', conclusion: 'SUCCESS' },
  { name: 'pr-close-guard', conclusion: 'SUCCESS' },
];
const base = { statusCheckRollup: green, labels: [], headRefName: 'task/x', body: 'Closes #1' };
test('clean merged PR has no bypass', () => assert.equal(evaluateBypass({ pull: base }).ok, true));
test('failed required check is a bypass', () => {
  const pull = { ...base, statusCheckRollup: [{ name: 'docs-guard', conclusion: 'FAILURE' }, ...green.filter((c) => c.name !== 'docs-guard' && c.name !== 'ci / ci-gate')] };
  assert.ok(evaluateBypass({ pull }).violations.some((v) => v.code === 'CHECKS_FAILED'));
});
test('task merge without closing keyword is a bypass', () => {
  const pull = { ...base, body: 'Refs #1' };
  assert.ok(evaluateBypass({ pull }).violations.some((v) => v.code === 'MISSING_CLOSING_KEYWORD'));
});
test('partial PR closing a task is a bypass', () => {
  const pull = { ...base, labels: ['partial'], body: 'Closes #1' };
  assert.ok(evaluateBypass({ pull }).violations.some((v) => v.code === 'PARTIAL_CLOSED_TASK'));
});
