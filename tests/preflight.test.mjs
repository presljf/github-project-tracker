import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCleanTree, evaluateDependencyChanges } from '../scripts/github/lib/preflight.mjs';

test('clean tree passes', () => assert.equal(evaluateCleanTree({ statusText: '' }).ok, true));
test('dirty tree blocks unless exception has reason', () => {
  assert.equal(evaluateCleanTree({ statusText: ' M a.js', allowDirty: false }).ok, false);
  assert.equal(evaluateCleanTree({ statusText: ' M a.js', allowDirty: true, reason: '' }).ok, false);
  assert.equal(evaluateCleanTree({ statusText: ' M a.js', allowDirty: true, reason: 'generated lock fix' }).ok, true);
});
test('dependency change requires OI approval', () => {
  const changed = ['package.json', 'package-lock.json'];
  assert.equal(evaluateDependencyChanges({ changedFiles: changed }).ok, false);
  assert.equal(evaluateDependencyChanges({ changedFiles: changed, approvals: { approvals: [{ paths: ['package-lock.json'], issue: 'https://github.com/o/r/issues/1', reason: 'upgrade', expires: '2099-01-01' }] } }).ok, false); // package.json approval missing
  assert.equal(evaluateDependencyChanges({ changedFiles: changed, approvals: { approvals: [
    { paths: ['package.json'], issue: 'https://github.com/o/r/issues/1', reason: 'upgrade', expires: '2099-01-01' },
    { paths: ['package-lock.json'], issue: 'https://github.com/o/r/issues/1', reason: 'upgrade', expires: '2099-01-01' },
  ] } }).ok, true);
});
test('script-only package change is not a dependency change', () => {
  const base = { dependencies: { a: '1' }, scripts: { test: 'old' } };
  const current = { dependencies: { a: '1' }, scripts: { test: 'new' } };
  assert.equal(evaluateDependencyChanges({ changedFiles: ['package.json'], basePackage: base, currentPackage: current }).ok, true);
});
