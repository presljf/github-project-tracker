import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GitHubCli } from '../scripts/github/lib/github.mjs';

test('updateFieldOptions sends a variables object, not an array', async () => {
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    if (args[0] === 'api' && args[1] === 'graphql') {
      const input = JSON.parse(fs.readFileSync(args[3], 'utf8'));
      if (input.query.includes('node(id: $id)')) {
        return JSON.stringify({ data: { node: { id: 'FIELD', options: [{ id: 'OPT', name: 'Todo', color: 'GRAY', description: '' }] } } });
      }
      assert.equal(Array.isArray(input.variables.input.singleSelectOptions), true);
      return JSON.stringify({ data: { updateProjectV2Field: { projectV2Field: { options: [] } } } });
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const gh = new GitHubCli({ exec, retries: 0, sleep: () => {} });
  await gh.updateFieldOptions('FIELD', ['Todo', 'In Progress']);
  const queryInput = JSON.parse(fs.readFileSync(calls[0][3], 'utf8'));
  assert.deepEqual(queryInput.variables, { id: 'FIELD' });
});
