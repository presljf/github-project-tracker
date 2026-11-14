#!/usr/bin/env node
/**
 * Narrow TrackerOS MCP facade.
 *
 * This server intentionally exposes TrackerOS operations, not a generic GitHub API. It runs with
 * the write transport injected by the caller (GH_TOKEN); the raw agent should have a read-only
 * token and no write SSH key when this server is the only mutation path.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../cli/validate-config.mjs';
import { createGitHub } from '../lib/github.mjs';
import { createProposal, listProposals } from '../cli/proposal.mjs';
import { statusTask } from '../cli/task.mjs';
import { auditTracker, collectAuditData } from '../cli/audit.mjs';

const SERVER_INFO = { name: 'tracker-os', version: '1.5.0' };
const PROTOCOL_VERSION = '2024-11-05';

const TOOL_DEFS = [
  {
    name: 'tracker_proposal_list',
    description: 'List open TrackerOS proposals and their board status.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'tracker_proposal_create',
    description: 'Create a board-managed [Proposal] issue using the proposal contract.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'body'],
      properties: {
        title: { type: 'string', minLength: 1 },
        body: { type: 'string', minLength: 1 },
        area: { type: 'string' },
        kind: { type: 'string' },
        estimate: { type: 'string' },
        source: { type: 'string' },
        priority: { type: 'string' },
        dryRun: { type: 'boolean' },
      },
    },
  },
  {
    name: 'tracker_issue_context',
    description: 'Return an issue, its comments, and its TrackerOS project fields.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['issue'],
      properties: { issue: { type: 'integer', minimum: 1 } },
    },
  },
  {
    name: 'tracker_task_status',
    description: 'Return TrackerOS task status, assignees, and fields.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['issue'],
      properties: { issue: { type: 'integer', minimum: 1 } },
    },
  },
  {
    name: 'tracker_audit',
    description: 'Run the TrackerOS audit and return violations and warnings.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
];

function repoParts(config) {
  const [repoOwner, repoName] = String(config.repository || '').split('/');
  if (!repoOwner || !repoName) throw new Error('config.repository must be owner/repo');
  return { repoOwner, repoName, owner: config.project.owner || repoOwner };
}

export function createTools({ config, github }) {
  return {
    async tracker_proposal_list() {
      return listProposals({ config, github });
    },
    async tracker_proposal_create(args = {}) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-mcp-proposal-'));
      const bodyFile = path.join(dir, 'body.md');
      fs.writeFileSync(bodyFile, String(args.body || ''));
      try {
        return await createProposal({
          config,
          github,
          title: args.title,
          bodyFile,
          area: args.area,
          kind: args.kind,
          estimate: args.estimate,
          source: args.source,
          priority: args.priority,
          dryRun: Boolean(args.dryRun),
        });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    async tracker_issue_context(args = {}) {
      const { repoOwner, repoName, owner } = repoParts(config);
      const issue = await github.getIssueView(repoOwner, repoName, args.issue);
      if (!issue) throw new Error(`issue #${args.issue} not found`);
      const comments =
        typeof github.issueComments === 'function' ? await github.issueComments(repoOwner, repoName, args.issue) : [];
      let item = null;
      if (typeof github.getProjectItemForIssue === 'function') {
        item = await github.getProjectItemForIssue(owner, config.project.number, repoOwner, repoName, args.issue);
      }
      return {
        issue: {
          number: issue.number,
          title: issue.title,
          state: issue.state,
          url: issue.url,
          type: issue.issueType?.name || issue.type || null,
          labels: (issue.labels || []).map((entry) => entry.name || entry),
          body: issue.body || '',
        },
        comments,
        projectItem: item,
      };
    },
    async tracker_task_status(args = {}) {
      return statusTask({ config, github, issueNumber: args.issue });
    },
    async tracker_audit() {
      const data = await collectAuditData(github, config);
      return auditTracker({ config, data });
    },
  };
}

export async function handleRequest(message, tools) {
  const id = message?.id ?? null;
  const method = message?.method;
  if (!message || message.jsonrpc !== '2.0' || !method)
    return { jsonrpc: '2.0', id, error: { code: -32600, message: 'invalid JSON-RPC request' } };
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: message.params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    };
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOL_DEFS } };
  if (method === 'tools/call') {
    const name = message.params?.name;
    const fn = tools[name];
    if (!fn) return { jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool: ${name}` } };
    try {
      const result = await fn(message.params?.arguments || {});
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false },
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: error?.message || String(error) }], isError: true },
      };
    }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
}

export function startServer({
  config,
  github,
  input = process.stdin,
  output = process.stdout,
  error = process.stderr,
} = {}) {
  const tools = createTools({ config, github });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (parseError) {
      output.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: parseError.message } })}\n`,
      );
      return;
    }
    const response = await handleRequest(message, tools);
    if (response) output.write(`${JSON.stringify(response)}\n`);
  });
  rl.on('error', (err) => error.write(`tracker-os-mcp: ${err.message}\n`));
  return rl;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const configPath = path.resolve(
      process.argv.includes('--config') ? process.argv[process.argv.indexOf('--config') + 1] : 'tracker.config.json',
    );
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const errors = validateConfig(config);
    if (errors.length) throw new Error(`invalid config:\n- ${errors.join('\n- ')}`);
    startServer({ config, github: createGitHub() });
  } catch (error) {
    process.stderr.write(`tracker-os-mcp: ${error.message}\n`);
    process.exitCode = 1;
  }
}
