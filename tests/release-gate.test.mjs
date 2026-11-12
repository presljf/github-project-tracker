import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateReleaseGate } from '../scripts/github/release-gate.mjs';
test('passes clean contract and no bypasses', () => assert.equal(evaluateReleaseGate({ contractResult: { ok: true, violations: [] } }).ok, true));
test('fails stale contract', () => assert.ok(evaluateReleaseGate({ contractResult: { ok: false, violations: ['stale pin'] } }).violations.length));
test('fails open bypass OIs', () => {
  const r = evaluateReleaseGate({ contractResult: { ok: true, violations: [] }, bypasses: [{ number: 9 }] });
  assert.equal(r.ok, false);
  assert.match(r.violations[0], /#9/);
});
