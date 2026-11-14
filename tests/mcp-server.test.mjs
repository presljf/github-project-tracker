import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_WRITE_TOOLS,
  LOCKED_WRITE_TOOLS,
  READ_TOOLS,
  WRITE_LOCK_GATE,
  assertWriteSurfaceLocked,
  createTools,
  handleRequest,
} from '../scripts/adopt/mcp/server.mjs';

/** The complete default surface. Adding or removing a tool must update this list in review. */
const EXPECTED_TOOLS = [
  'tracker_audit',
  'tracker_issue_context',
  'tracker_proposal_create',
  'tracker_proposal_list',
  'tracker_task_status',
];

const TRANSITION_TOOLS = ['tracker_proposal_accept', 'tracker_proposal_defer', 'tracker_proposal_reject'];

function tools() {
  return {
    tracker_proposal_list: async () => ({ ok: true, count: 0, proposals: [] }),
    tracker_issue_context: async ({ issue }) => ({ issue, comments: [], projectItem: null }),
    tracker_fail: async () => {
      throw new Error('boom');
    },
  };
}

async function listedToolDefs() {
  const response = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, tools());
  return response.result.tools;
}

test('initializes with tools capability', async () => {
  const response = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, tools());
  assert.equal(response.result.serverInfo.name, 'tracker-os');
  assert.deepEqual(response.result.capabilities, { tools: {} });
});

test('lists only read/plan tools plus guarded proposal intake', async () => {
  const names = (await listedToolDefs()).map((tool) => tool.name).sort();
  assert.deepEqual(names, EXPECTED_TOOLS);
  assert.ok(!names.includes('github_graphql'));
});

test('default surface excludes locked proposal transitions', async () => {
  const names = (await listedToolDefs()).map((tool) => tool.name);
  for (const locked of TRANSITION_TOOLS) assert.ok(!names.includes(locked), `${locked} must stay locked`);
});

test('write-surface contract partitions the default surface', () => {
  assert.deepEqual([...READ_TOOLS, ...ALLOWED_WRITE_TOOLS].sort(), EXPECTED_TOOLS);
  assert.deepEqual(ALLOWED_WRITE_TOOLS, ['tracker_proposal_create']);
  // Pinned: deleting a locked entry is how a transition write would sneak back in.
  assert.deepEqual([...LOCKED_WRITE_TOOLS].sort(), TRANSITION_TOOLS);
  assert.equal(WRITE_LOCK_GATE.phase, 'P2.2');
  assert.ok(WRITE_LOCK_GATE.requires.length > 0);
});

test('write-surface guard accepts the default surface', async () => {
  const summary = assertWriteSurfaceLocked(await listedToolDefs());
  assert.deepEqual(summary.read, READ_TOOLS);
  assert.deepEqual(summary.write, ALLOWED_WRITE_TOOLS);
});

test('write-surface guard fails server startup when a transition write returns', async () => {
  const listed = await listedToolDefs();
  for (const locked of TRANSITION_TOOLS) {
    const drifted = [...listed, { name: locked, description: 'drift', inputSchema: { type: 'object' } }];
    assert.throws(() => assertWriteSurfaceLocked(drifted), /write surface locked until P2\.2/);
    assert.throws(() => assertWriteSurfaceLocked(drifted), new RegExp(locked));
  }
});

test('write-surface guard rejects unclassified and duplicate tools', async () => {
  const listed = await listedToolDefs();
  assert.throws(
    () => assertWriteSurfaceLocked([...listed, { name: 'tracker_merge', inputSchema: { type: 'object' } }]),
    /unclassified MCP tool\(s\): tracker_merge/,
  );
  assert.throws(() => assertWriteSurfaceLocked([...listed, listed[0]]), /duplicate MCP tool definition/);
});

test('tool handlers mirror the locked surface', () => {
  const handlers = Object.keys(createTools({ config: {}, github: {} })).sort();
  assert.deepEqual(handlers, EXPECTED_TOOLS);
});

test('calling a locked transition is an unknown tool, not a hidden write', async () => {
  const surface = createTools({ config: {}, github: {} });
  for (const locked of TRANSITION_TOOLS) {
    const response = await handleRequest(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: locked, arguments: { issue: 1 } } },
      surface,
    );
    assert.equal(response.error.code, -32602);
    assert.match(response.error.message, new RegExp(`unknown tool: ${locked}`));
  }
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
