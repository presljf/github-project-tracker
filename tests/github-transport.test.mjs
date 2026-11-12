import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubCli, parseIncludeOutput } from '../scripts/github/lib/github.mjs';

const headers = (remaining = 4000, reset = Math.floor(Date.now() / 1000) + 3600) => `HTTP/2.0 200 OK
x-ratelimit-limit: 5000
x-ratelimit-remaining: ${remaining}
x-ratelimit-used: ${5000 - remaining}
x-ratelimit-reset: ${reset}
x-ratelimit-resource: graphql

{"data":{"rateLimit":{"limit":5000,"remaining":${remaining},"used":${5000 - remaining},"resetAt":"2099-01-01T00:00:00Z","cost":1}}}`;

test('parseIncludeOutput extracts headers and JSON body', () => {
  const parsed = parseIncludeOutput(headers());
  assert.equal(parsed.headers['x-ratelimit-remaining'], '4000');
  assert.equal(parsed.json.data.rateLimit.remaining, 4000);
});

test('refreshRateLimit records budget from response headers', () => {
  const gh = new GitHubCli({ exec: () => headers(300), retries: 0, sleep: () => {} });
  const rate = gh.refreshRateLimit();
  assert.equal(rate.remaining, 300);
  assert.equal(rate.limit, 5000);
  assert.equal(rate.resource, 'graphql');
});

test('mutations are paced by the configured spacing', () => {
  const sleeps = [];
  const gh = new GitHubCli({
    exec: () => headers(100),
    retries: 0,
    sleep: (ms) => sleeps.push(ms),
    minMutationSpacingMs: 1100,
  });
  gh._beforeMutation();
  gh._beforeMutation();
  assert.ok(sleeps.some((ms) => ms > 0 && ms <= 1100));
});

test('exhausted budget fails closed when reset is too far away', () => {
  const reset = Math.floor(Date.now() / 1000) + 7200;
  const gh = new GitHubCli({ exec: () => headers(0, reset), retries: 0, sleep: () => {}, maxWaitMs: 1000 });
  assert.throws(() => gh._beforeMutation(), /rate limit exhausted/);
});
