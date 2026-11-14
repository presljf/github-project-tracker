import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../scripts/adopt/mcp/server.mjs';

function tools() {
  return {
    tracker_proposal_list: async () => ({ ok: true, count: 0, proposals: [] }),
    tracker_issue_context: async ({ issue }) => ({ issue, comments: [], projectItem: null }),
    tracker_fail: async () => {
      throw new Error('boom');
    },
  };
}

test('initializes with tools capability', async () => {
  const response = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, tools());
  assert.equal(response.result.serverInfo.name, 'tracker-os');
  assert.deepEqual(response.result.capabilities, { tools: {} });
});

test('lists the narrow TrackerOS tools', async () => {
  const response = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, tools());
  const names = response.result.tools.map((tool) => tool.name);
  assert.ok(names.includes('tracker_proposal_list'));
  assert.ok(names.includes('tracker_issue_context'));
  assert.ok(names.includes('tracker_audit'));
  assert.ok(names.includes('tracker_proposal_accept'));
  assert.ok(names.includes('tracker_proposal_defer'));
  assert.ok(names.includes('tracker_proposal_reject'));
  assert.ok(!names.includes('github_graphql'));
});

test('calls a tool and returns text content', async () => {
  const response = await handleRequest(
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'tracker_proposal_list', arguments: {} } },
    tools(),
  );
  assert.equal(response.result.isError, false);
  assert.deepEqual(JSON.parse(response.result.content[0].text), { ok: true, count: 0, proposals: [] });
});

test('tool errors are marked isError', async () => {
  const response = await handleRequest(
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'tracker_fail', arguments: {} } },
    tools(),
  );
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /boom/);
});

test('unknown method and notifications are handled', async () => {
  const unknown = await handleRequest({ jsonrpc: '2.0', id: 5, method: 'nope' }, tools());
  assert.equal(unknown.error.code, -32601);
  const notification = await handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, tools());
  assert.equal(notification, null);
});
