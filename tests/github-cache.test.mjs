import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GitHubCli } from '../scripts/adopt/lib/github.mjs';

test('listFields is cached and cleared by field mutations', () => {
  let calls = 0;
  const remaining = 4000;
  const exec = (args) => {
    if (args[0] === 'api' && args[1] === '--include') {
      return `HTTP/2.0 200 OK\nx-ratelimit-limit: 5000\nx-ratelimit-remaining: ${remaining}\nx-ratelimit-used: ${5000 - remaining}\nx-ratelimit-reset: ${Math.floor(Date.now() / 1000) + 3600}\nx-ratelimit-resource: graphql\n\n{"data":{"rateLimit":{"limit":5000,"remaining":${remaining},"used":${5000 - remaining},"resetAt":"2099-01-01T00:00:00Z","cost":1}}}`;
    }
    if (args[0] === 'project' && args[1] === 'field-list') {
      calls += 1;
      return JSON.stringify({ fields: [{ id: 'F', name: 'Status', options: [] }] });
    }
    if (args[0] === 'project' && args[1] === 'field-create') {
      return JSON.stringify({ id: 'F2', name: 'New', options: [] });
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const gh = new GitHubCli({ exec, retries: 0, sleep: () => {} });
  gh.listFields('o', 1);
  gh.listFields('o', 1);
  assert.equal(calls, 1);
  gh.createField('o', 1, 'New', ['x']);
  gh.listFields('o', 1);
  assert.equal(calls, 2);
});

test('batchIssueActivity parses aliases into comments/subIssues', async () => {
  let input;
  const exec = (args) => {
    if (args[0] === 'api' && args[1] === 'graphql') input = JSON.parse(fs.readFileSync(args[3], 'utf8'));
    return JSON.stringify({
      data: {
        repository: {
          i0: { comments: { nodes: [{ body: '### Check-in' }] }, subIssues: { nodes: [{ number: 2, state: 'OPEN' }] } },
          i1: { comments: { nodes: [] }, subIssues: { nodes: [] } },
        },
      },
    });
  };
  const gh = new GitHubCli({ exec, retries: 0, sleep: () => {} });
  const out = await gh.batchIssueActivity('o', 'r', [1, 2], { chunkSize: 2 });
  assert.deepEqual(out.comments[1], ['### Check-in']);
  assert.deepEqual(out.comments[2], []);
  assert.deepEqual(out.subIssues[1], [2]);
  assert.equal(input.variables.n0, 1);
  assert.equal(input.variables.n1, 2);
});
