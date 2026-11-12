import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateClosing, parseClosingRefs } from '../scripts/github/guard-pr-close.mjs';

const task = { number: 1, title: '[Task] work' };
const sprint = { number: 2, title: '[Sprint] 1.0.0.1 — work' };
const lookup = (n) => ({ 1: task, 2: sprint })[n] || null;

test('parses closing keywords case-insensitively', () => {
  assert.deepEqual(parseClosingRefs('Closes #12\nfixes #7'), [12, 7]);
});
test('task completion requires a closing keyword', () => {
  assert.equal(evaluateClosing({ body: 'Refs #1', branch: 'task/x', lookup }).ok, false);
  assert.equal(evaluateClosing({ body: 'Closes #1', branch: 'task/x', lookup }).ok, true);
});
test('partial PR cannot close and must use Refs', () => {
  assert.equal(evaluateClosing({ body: 'Closes #1', branch: 'task/x', labels: ['partial'], lookup }).ok, false);
  assert.equal(evaluateClosing({ body: 'Part of #1', branch: 'task/x', labels: ['partial'], lookup }).ok, true);
});
test('closing a sprint/release tracker fails', () => {
  assert.equal(evaluateClosing({ body: 'Closes #2', branch: 'task/x', lookup }).ok, false);
});
