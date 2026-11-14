import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubCli } from '../scripts/adopt/lib/github.mjs';

test('issueComments uses REST pagination and parses every page', () => {
  const gh = new GitHubCli();
  const calls = [];
  gh.run = (args) => {
    calls.push(args);
    return Array.from({ length: 101 }, (_, i) => JSON.stringify({ id: i + 1, body: `c${i + 1}` })).join('\n');
  };
  const comments = gh.issueComments('owner', 'repo', 5);
  assert.equal(comments.length, 101);
  assert.ok(calls[0].includes('--paginate'));
  assert.ok(calls[0][2].includes('per_page=100'));
});

test('issueComments fails closed on API failure', () => {
  const gh = new GitHubCli();
  gh.run = () => {
    throw new Error('rate limited');
  };
  assert.throws(() => gh.issueComments('owner', 'repo', 5), /rate limited/);
});
