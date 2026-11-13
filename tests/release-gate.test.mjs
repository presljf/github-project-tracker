import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateReleaseGate } from '../scripts/adopt/cli/release-gate.mjs';
test('passes clean contract and no bypasses', () => {
  const result = evaluateReleaseGate({ contractResult: { ok: true, violations: [] } });
  assert.equal(result.ok, true);
  assert.equal(result.bypassChecked, false, 'no --repo means the open-OI check is skipped');
});
test('reports the open-OI check as performed when --repo is supplied', () => {
  const result = evaluateReleaseGate({ contractResult: { ok: true, violations: [] }, bypassChecked: true });
  assert.equal(result.ok, true);
  assert.equal(result.bypassChecked, true);
});
test('fails stale contract', () =>
  assert.ok(evaluateReleaseGate({ contractResult: { ok: false, violations: ['stale pin'] } }).violations.length));
test('fails open bypass OIs', () => {
  const r = evaluateReleaseGate({
    contractResult: { ok: true, violations: [] },
    bypasses: [{ number: 9 }],
    bypassChecked: true,
  });
  assert.equal(r.ok, false);
  assert.match(r.violations[0], /#9/);
});
