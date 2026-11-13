import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RateState } from '../scripts/adopt/lib/rate-state.mjs';

function tempState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-rate-'));
  return new RateState({ path: path.join(dir, 'state.json'), now: () => 1000 });
}

test('shared state records resources and consumes estimated cost', () => {
  const state = tempState();
  state.record({
    resource: 'graphql',
    limit: 5000,
    remaining: 100,
    used: 4900,
    resetEpoch: 2000,
    resetAt: '1970-01-01T00:33:20Z',
    cost: 1,
    command: 'task:refresh',
  });
  state.consume(5, 'task:mutation');
  const report = state.report();
  assert.equal(report.resources.graphql.remaining, 95);
  assert.ok(report.topCommands.some((row) => row.command === 'task:mutation' && row.cost === 5));
});

test('same-window record takes the lower remaining (shared truth)', () => {
  const state = tempState();
  state.record({ resource: 'graphql', limit: 5000, remaining: 300, used: 4700, resetEpoch: 2000 });
  state.record({ resource: 'graphql', limit: 5000, remaining: 100, used: 4900, resetEpoch: 2000 });
  assert.equal(state.read().resources.graphql.remaining, 100);
});

test('waitMs uses the shared reset epoch', () => {
  const state = tempState();
  state.record({ resource: 'graphql', limit: 5000, remaining: 0, used: 5000, resetEpoch: 2000 });
  assert.equal(state.waitMs(), 1_999_000);
});
