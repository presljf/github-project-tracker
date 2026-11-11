import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GitHubCli } from '../scripts/github/lib/github.mjs';

function fakeGraphql(payload) {
  return (args) => {
    if (args[0] === 'api' && args[1] === 'graphql') {
      const input = JSON.parse(fs.readFileSync(args[3], 'utf8'));
      return JSON.stringify(payload(input));
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };
}

function projectItemNode(number, status = 'Todo') {
  return { id: `ITEM${number}`, project: { number: 2 }, fieldValues: { nodes: [
    { name: status, field: { name: 'Status', id: 'F_STATUS' } },
    { name: 'v1.1.0', field: { name: 'Release', id: 'F_RELEASE' } },
  ] } };
}

test('getProjectItemForIssue parses a single target item', () => {
  const gh = new GitHubCli({ exec: fakeGraphql((input) => ({ data: { repository: { issue: { projectItems: { nodes: [projectItemNode(input.variables.issue)] } } } } })), retries: 0, sleep: () => {} });
  const item = gh.getProjectItemForIssue('o', 2, 'o', 'r', 60);
  assert.equal(item.id, 'ITEM60');
  assert.equal(item.status, 'Todo');
  assert.equal(item.release, 'v1.1.0');
});

test('batchIssueDependencies parses aliases', () => {
  const gh = new GitHubCli({ exec: fakeGraphql((input) => ({
    data: { repository: {
      i0: { blockedBy: { nodes: [{ number: 48 }] } },
      i1: { blockedBy: { nodes: [] } },
    } },
  })), retries: 0, sleep: () => {} });
  const deps = gh.batchIssueDependencies('o', 'r', [60, 61]);
  assert.deepEqual(deps[60], [48]);
  assert.deepEqual(deps[61], []);
});
