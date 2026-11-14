import { execFileSync } from 'node:child_process';
import { RateState } from './rate-state.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TRANSIENT =
  /connection refused|timed out|TLS|502|503|ECONNRESET|EOF|Something went wrong|GraphQL.*(timeout|unavailable)/i;

class GhError extends Error {
  constructor(args, err) {
    const stderr = (err?.stderr || '').toString().trim();
    const stdout = (err?.stdout || '').toString().trim();
    super(
      `gh ${args.join(' ')} failed${stderr ? `: ${stderr.split('\n')[0]}` : ''}${stdout && !stderr ? `: ${stdout.split('\n')[0]}` : ''}`,
    );
    this.name = 'GhError';
    this.args = args;
    this.exitCode = err?.status ?? 1;
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

function defaultExec(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // synchronous backoff for CLI retries
  }
}

export function parseIncludeOutput(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const chunks = normalized.split(/\n\n/);
  let headerChunk = '';
  let body = '';
  for (const chunk of chunks) {
    if (/^HTTP\//.test(chunk) || /x-ratelimit-/i.test(chunk)) headerChunk = chunk;
    if (chunk.trim().startsWith('{')) body = chunk;
  }
  const headers = {};
  for (const line of headerChunk.split('\n')) {
    const m = /^([^:]+):\s*(.*)$/.exec(line);
    if (m) headers[m[1].toLowerCase()] = m[2];
  }
  let json = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    /* keep null */
  }
  return { headers, body, json };
}

export class GitHubCli {
  constructor({
    exec = defaultExec,
    retries = 3,
    sleep = sleepSync,
    minMutationSpacingMs = 1100,
    budgetFloor = 25,
    maxWaitMs = 60000,
    rateState = null,
    command = 'tracker',
  } = {}) {
    this.exec = exec;
    this.retries = retries;
    this.sleep = sleep;
    this.minMutationSpacingMs = minMutationSpacingMs;
    this.budgetFloor = budgetFloor;
    this.maxWaitMs = maxWaitMs;
    this.rate = null;
    this.lastMutationAt = 0;
    this.mutations = 0;
    this.cache = new Map();
    this.rateState = rateState;
    this.command = command;
  }

  _cached(key, loader) {
    if (!this.cache.has(key)) this.cache.set(key, loader());
    return this.cache.get(key);
  }

  clearCache(prefix = '') {
    for (const key of [...this.cache.keys()]) {
      if (!prefix || key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  refreshRateLimit() {
    const query = 'query { rateLimit { limit remaining used resetAt cost } }';
    const output = this.exec(['api', '--include', 'graphql', '-f', `query=${query}`]);
    const { headers, json } = parseIncludeOutput(output);
    const data = json?.data?.rateLimit;
    this.rate = {
      resource: headers['x-ratelimit-resource'] || 'graphql',
      limit: Number(data?.limit ?? headers['x-ratelimit-limit'] ?? 0),
      remaining: Number(data?.remaining ?? headers['x-ratelimit-remaining'] ?? 0),
      used: Number(data?.used ?? headers['x-ratelimit-used'] ?? 0),
      resetEpoch: Number(headers['x-ratelimit-reset'] || 0),
      resetAt:
        data?.resetAt ||
        (headers['x-ratelimit-reset'] ? new Date(Number(headers['x-ratelimit-reset']) * 1000).toISOString() : null),
      cost: Number(data?.cost ?? 1),
    };
    this.rateState?.record({
      resource: this.rate.resource,
      limit: this.rate.limit,
      remaining: this.rate.remaining,
      used: this.rate.used,
      resetEpoch: this.rate.resetEpoch,
      resetAt: this.rate.resetAt,
      cost: 1,
      command: `${this.command}:refresh`,
    });
    return this.rate;
  }

  rateLimitStatus() {
    return this.refreshRateLimit();
  }

  _waitMsUntilReset() {
    if (!this.rate?.resetEpoch) return 0;
    return Math.max(0, this.rate.resetEpoch * 1000 - Date.now());
  }

  _beforeMutation() {
    if (!this.rate && this.rateState) {
      const shared = this.rateState.read().resources.graphql;
      if (shared && shared.resetEpoch * 1000 > Date.now()) {
        this.rate = { ...shared, cost: 1 };
      }
    }
    if (!this.rate) this.refreshRateLimit();
    if (this.rate.remaining <= this.budgetFloor) this.refreshRateLimit();
    if (this.rate.remaining <= 0) {
      const waitMs = this._waitMsUntilReset();
      if (waitMs > 0 && waitMs <= this.maxWaitMs) this.sleep(waitMs + 250);
      else
        throw new Error(
          `GitHub rate limit exhausted; reset at ${this.rate.resetAt || 'unknown'}; refusing mutation rather than guessing`,
        );
    }
    const since = Date.now() - this.lastMutationAt;
    if (since < this.minMutationSpacingMs) this.sleep(this.minMutationSpacingMs - since);
    this.lastMutationAt = Date.now();
    this.mutations += 1;
    this.rate.remaining = Math.max(0, this.rate.remaining - 5);
    this.rateState?.consume(5, `${this.command}:mutation`);
  }

  run(args, { json = false, allowFailure = false } = {}) {
    let last;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const text = this.exec(args);
        const out = (text || '').trim();
        if (!out) return json ? null : '';
        if (json) return JSON.parse(out);
        return out;
      } catch (err) {
        last = err;
        const message = `${err?.stderr || ''}\n${err?.message || ''}`;
        if (/API rate limit exceeded|secondary rate limit/i.test(message)) {
          let status = null;
          try {
            status = this.refreshRateLimit();
          } catch {
            /* best effort */
          }
          const reset = status?.resetAt || 'unknown';
          throw new Error(
            `GitHub rate limit hit (${status ? `${status.remaining}/${status.limit} remaining` : 'budget unknown'}; resets ${reset}). Not retrying blindly; wait for reset or reduce request bursts.`,
            { cause: err },
          );
        }
        if (attempt >= this.retries || !TRANSIENT.test(message)) break;
        this.sleep(500 * (attempt + 1));
      }
    }
    if (allowFailure) return { error: last };
    throw new GhError(args, last);
  }

  repo(owner, repo) {
    return this.run(['api', `repos/${owner}/${repo}`], { json: true });
  }

  listProjects(owner) {
    return this._cached(`projects:${owner}`, () => {
      const result = this.run(['project', 'list', '--owner', owner, '--format', 'json', '--limit', '100'], {
        json: true,
      });
      return result?.projects || [];
    });
  }

  createProject(owner, title) {
    this._beforeMutation();
    this.clearCache('projects:');
    return this.run(['project', 'create', '--owner', owner, '--title', title, '--format', 'json'], { json: true });
  }

  linkProject(owner, number, repo) {
    this._beforeMutation();
    const result = this.run(['project', 'link', String(number), '--owner', owner, '--repo', repo], {
      allowFailure: true,
    });
    if (result && result.error) {
      const text = `${result.error?.stderr || ''}\n${result.error?.message || ''}`;
      if (/already|linked/i.test(text)) return { alreadyLinked: true };
      throw new GhError(['project', 'link'], result.error);
    }
    return {};
  }

  listFields(owner, number) {
    return this._cached(`fields:${owner}:${number}`, () => {
      const result = this.run(['project', 'field-list', String(number), '--owner', owner, '--format', 'json'], {
        json: true,
      });
      return result?.fields || [];
    });
  }

  createField(owner, number, name, options) {
    this._beforeMutation();
    const args = [
      'project',
      'field-create',
      String(number),
      '--owner',
      owner,
      '--name',
      name,
      '--data-type',
      'SINGLE_SELECT',
      '--single-select-options',
      options.join(','),
      '--format',
      'json',
    ];
    this.clearCache('fields:');
    return this.run(args, { json: true });
  }

  updateFieldOptions(fieldId, options) {
    this._beforeMutation();
    this.clearCache('fields:');
    const query =
      'query($id: ID!) { node(id: $id) { ... on ProjectV2SingleSelectField { id options { id name color description } } } }';
    fs.writeFileSync(
      path.join(os.tmpdir(), 'tracker-field-query.json'),
      JSON.stringify({ query, variables: { id: fieldId } }),
    );
    const node = this.run(['api', 'graphql', '--input', path.join(os.tmpdir(), 'tracker-field-query.json')], {
      json: true,
    });
    const existing = node?.data?.node?.options || [];
    const byName = new Map(existing.map((option) => [option.name, option]));
    const merged = options.map((option) => {
      const spec = typeof option === 'string' ? { name: option } : option;
      const current = byName.get(spec.name);
      return current
        ? { id: current.id, name: current.name, color: current.color, description: current.description || '' }
        : { name: spec.name, color: spec.color || 'BLUE', description: spec.description || '' };
    });
    const mutation =
      'mutation($input: UpdateProjectV2FieldInput!) { updateProjectV2Field(input: $input) { projectV2Field { ... on ProjectV2SingleSelectField { options { id name } } } } }';
    const inputPath = path.join(os.tmpdir(), 'tracker-field-update.json');
    fs.writeFileSync(
      inputPath,
      JSON.stringify({ query: mutation, variables: { input: { fieldId, singleSelectOptions: merged } } }),
    );
    return this.run(['api', 'graphql', '--input', inputPath], { json: true });
  }

  listMilestones(owner, repo) {
    return this._cached(`milestones:${owner}:${repo}`, () => {
      const result = this.run(['api', `repos/${owner}/${repo}/milestones?state=all&per_page=100`], { json: true });
      return result || [];
    });
  }

  createMilestone(owner, repo, title, description) {
    this._beforeMutation();
    const result = this.run(
      [
        'api',
        '--method',
        'POST',
        `repos/${owner}/${repo}/milestones`,
        '-f',
        `title=${title}`,
        '-f',
        `description=${description || ''}`,
      ],
      { json: true },
    );
    this.clearCache('milestones:');
    return result;
  }

  listLabels(owner, repo) {
    return this._cached(`labels:${owner}:${repo}`, () => {
      const result = this.run(
        ['label', 'list', '--repo', `${owner}/${repo}`, '--limit', '100', '--json', 'name,color,description'],
        { json: true },
      );
      return result || [];
    });
  }

  createLabel(owner, repo, name, color, description) {
    this._beforeMutation();
    const result = this.run([
      'label',
      'create',
      name,
      '--repo',
      `${owner}/${repo}`,
      '--color',
      color,
      '--description',
      description || '',
    ]);
    this.clearCache('labels:');
    return result;
  }

  findIssue(owner, repo, title) {
    const search = `in:title "${title}"`;
    const result = this.run(
      [
        'issue',
        'list',
        '--repo',
        `${owner}/${repo}`,
        '--state',
        'all',
        '--search',
        search,
        '--json',
        'number,title,state,url',
        '--limit',
        '100',
      ],
      { json: true },
    );
    const matches = (result || []).filter((issue) => issue.title === title);
    return matches.find((issue) => issue.state === 'OPEN') || matches[0] || null;
  }

  getIssueView(owner, repo, number) {
    return this.run(
      [
        'issue',
        'view',
        String(number),
        '--repo',
        `${owner}/${repo}`,
        '--json',
        'number,title,state,assignees,milestone,issueType,body,url,labels',
      ],
      { json: true },
    );
  }

  addAssignee(owner, repo, number, login) {
    this._beforeMutation();
    return this.run(['issue', 'edit', String(number), '--repo', `${owner}/${repo}`, '--add-assignee', login]);
  }

  addComment(owner, repo, number, body) {
    this._beforeMutation();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-comment-'));
    const file = path.join(dir, 'comment.md');
    fs.writeFileSync(file, body || '');
    try {
      return this.run(['issue', 'comment', String(number), '--repo', `${owner}/${repo}`, '--body-file', file]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  closeIssue(owner, repo, number) {
    this._beforeMutation();
    return this.run(['issue', 'close', String(number), '--repo', `${owner}/${repo}`, '--reason', 'completed']);
  }

  addBlockedBy(owner, repo, number, blockedByUrl) {
    this._beforeMutation();
    return this.run(['issue', 'edit', String(number), '--repo', `${owner}/${repo}`, '--add-blocked-by', blockedByUrl]);
  }

  listOpenIssuesByLabel(owner, repo, label) {
    return this.run(
      [
        'issue',
        'list',
        '--repo',
        `${owner}/${repo}`,
        '--label',
        label,
        '--state',
        'open',
        '--json',
        'number,title,url',
      ],
      { json: true },
    );
  }

  getCommitPullRequests(owner, repo, sha) {
    return this.run(['api', `repos/${owner}/${repo}/commits/${sha}/pulls`], { json: true });
  }

  getIssueTypes(owner, repo) {
    return this.run(['api', `repos/${owner}/${repo}/issue-types`], { json: true });
  }

  getIssue(owner, repo, number) {
    return this.run(
      ['issue', 'view', String(number), '--repo', `${owner}/${repo}`, '--json', 'number,title,state,url'],
      { json: true },
    );
  }

  createIssue(owner, repo, { title, body, milestone, labels = [] }) {
    this._beforeMutation();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-issue-'));
    const bodyPath = path.join(dir, 'body.md');
    fs.writeFileSync(bodyPath, body || '');
    const args = ['issue', 'create', '--repo', `${owner}/${repo}`, '--title', title, '--body-file', bodyPath];
    if (milestone) args.push('--milestone', milestone);
    for (const label of labels) args.push('--label', label);
    const url = this.run(args);
    const number = Number(url.split('/').pop());
    fs.rmSync(dir, { recursive: true, force: true });
    return { number, title, state: 'OPEN', url };
  }

  updateIssueTitle(owner, repo, number, title) {
    this._beforeMutation();
    return this.run(['issue', 'edit', String(number), '--repo', `${owner}/${repo}`, '--title', title]);
  }

  updateIssueBody(owner, repo, number, body) {
    this._beforeMutation();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-body-'));
    const file = path.join(dir, 'body.md');
    fs.writeFileSync(file, String(body || ''));
    try {
      return this.run(['issue', 'edit', String(number), '--repo', `${owner}/${repo}`, '--body-file', file]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  addLabels(owner, repo, number, labels = []) {
    if (!labels.length) return null;
    this._beforeMutation();
    const args = ['issue', 'edit', String(number), '--repo', `${owner}/${repo}`];
    for (const label of labels) args.push('--add-label', label);
    return this.run(args);
  }

  setIssueType(owner, repo, number, type) {
    this._beforeMutation();
    return this.run(['api', `repos/${owner}/${repo}/issues/${number}`, '--method', 'PATCH', '-f', `type=${type}`], {
      json: true,
    });
  }

  listSubIssues(owner, repo, parent) {
    const result = this.run(['api', `repos/${owner}/${repo}/issues/${parent}/sub_issues`], { json: true });
    return result || [];
  }

  addSubIssue(owner, repo, parent, child) {
    this._beforeMutation();
    const childId = this.run(['api', `repos/${owner}/${repo}/issues/${child}`, '--jq', '.id']);
    const args = [
      'api',
      '--method',
      'POST',
      `repos/${owner}/${repo}/issues/${parent}/sub_issues`,
      '-F',
      `sub_issue_id=${childId}`,
    ];
    const result = this.run(args, { allowFailure: true });
    if (result && result.error) {
      const text = `${result.error?.stderr || ''}\n${result.error?.message || ''}`;
      if (/already|duplicate|sub.?issue/i.test(text)) return { alreadyLinked: true };
      throw new GhError(args, result.error);
    }
    return result;
  }

  listProjectItems(owner, number, { limit = 100 } = {}) {
    return this._cached(`items:${owner}:${number}:${limit}`, () => {
      const result = this.run(
        ['project', 'item-list', String(number), '--owner', owner, '--format', 'json', '--limit', String(limit)],
        { json: true },
      );
      return result?.items || [];
    });
  }

  addProjectItem(owner, number, url) {
    this._beforeMutation();
    const result = this.run(
      ['project', 'item-add', String(number), '--owner', owner, '--url', url, '--format', 'json'],
      { json: true },
    );
    this.clearCache('items:');
    return result;
  }

  listIssues(owner, repo, options = 'all') {
    const { state = 'all', limit = 1000 } = typeof options === 'string' ? { state: options } : options;
    const result = this.run(
      [
        'issue',
        'list',
        '--repo',
        `${owner}/${repo}`,
        '--state',
        state,
        '--json',
        'number,title,body,state,assignees,labels,milestone,issueType,parent,url',
        '--limit',
        String(limit),
      ],
      { json: true },
    );
    return result || [];
  }

  issueComments(owner, repo, number) {
    const result = this.run(['issue', 'view', String(number), '--repo', `${owner}/${repo}`, '--json', 'comments'], {
      json: true,
    });
    return result?.comments || [];
  }

  issueDependencies(owner, repo, number) {
    const result = this.run(['api', `repos/${owner}/${repo}/issues/${number}`], { json: true });
    return result?.issue_dependencies_summary || { blocked_by: 0, blocking: 0 };
  }

  setProjectItemField(projectId, itemId, fieldId, optionId) {
    this._beforeMutation();
    const result = this.run([
      'project',
      'item-edit',
      '--id',
      itemId,
      '--project-id',
      projectId,
      '--field-id',
      fieldId,
      '--single-select-option-id',
      optionId,
    ]);
    this.clearCache('items:');
    return result;
  }

  getPullRequest(owner, repo, number) {
    return this.run(
      [
        'pr',
        'view',
        String(number),
        '--repo',
        `${owner}/${repo}`,
        '--json',
        'number,state,isDraft,mergeable,mergeStateStatus,statusCheckRollup,headRefName,body,labels',
      ],
      { json: true },
    );
  }

  /**
   * Metadata-only PR fetch (no statusCheckRollup). Used as the degraded retry when the token
   * cannot read check runs/statuses (private repos need `checks: read` + `statuses: read`).
   */
  getPullRequestMetadata(owner, repo, number) {
    return this.run(
      [
        'pr',
        'view',
        String(number),
        '--repo',
        `${owner}/${repo}`,
        '--json',
        'number,state,isDraft,mergeable,mergeStateStatus,headRefName,body,labels',
      ],
      { json: true },
    );
  }

  mergePullRequest(owner, repo, number, { method = 'squash', deleteBranch = true } = {}) {
    this._beforeMutation();
    const args = ['pr', 'merge', String(number), '--repo', `${owner}/${repo}`];
    if (method === 'merge') args.push('--merge');
    else if (method === 'rebase') args.push('--rebase');
    else args.push('--squash');
    if (deleteBranch) args.push('--delete-branch');
    return this.run(args);
  }

  _graphql(query, variables) {
    const inputPath = path.join(
      os.tmpdir(),
      `tracker-graphql-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
    );
    fs.writeFileSync(inputPath, JSON.stringify({ query, variables }));
    try {
      return this.run(['api', 'graphql', '--input', inputPath], { json: true });
    } finally {
      fs.rmSync(inputPath, { force: true });
    }
  }

  _parseProjectItem(node, issueNumber) {
    if (!node) return null;
    const fields = {};
    for (const value of node.fieldValues?.nodes || []) {
      const fieldName = value?.field?.name;
      if (!fieldName) continue;
      const key = fieldName.toLowerCase();
      fields[key] = value.name ?? value.text ?? value.number ?? value.date ?? null;
    }
    return { id: node.id, content: { number: issueNumber }, ...fields };
  }

  getProjectItemForIssue(owner, projectNumber, repoOwner, repoName, issueNumber) {
    const query = `query($owner: String!, $name: String!, $issue: Int!) {
      repository(owner: $owner, name: $name) {
        issue(number: $issue) {
          projectItems(first: 20) {
            nodes { id project { number } fieldValues(first: 50) { nodes {
              ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { name id } } }
              ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name id } } }
              ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name id } } }
              ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name id } } }
            } } }
          }
        }
      }
    }`;
    const data = this._graphql(query, { owner: repoOwner, name: repoName, issue: issueNumber });
    const nodes = data?.data?.repository?.issue?.projectItems?.nodes || [];
    const node = nodes.find((entry) => entry.project?.number === projectNumber);
    return this._parseProjectItem(node, issueNumber);
  }

  batchProjectItems(owner, projectNumber, repoOwner, repoName, numbers, { chunkSize = 20 } = {}) {
    const result = {};
    for (let start = 0; start < numbers.length; start += chunkSize) {
      const chunk = numbers.slice(start, start + chunkSize);
      const aliases = chunk
        .map(
          (
            _,
            i,
          ) => `i${i}: issue(number: $n${i}) { projectItems(first: 20) { nodes { id project { number } fieldValues(first: 50) { nodes {
        ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { name id } } }
        ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name id } } }
        ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name id } } }
        ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name id } } }
      } } } } }`,
        )
        .join('\n');
      const query = `query($owner: String!, $name: String!${chunk.map((_, i) => `, $n${i}: Int!`).join('')}) {
        repository(owner: $owner, name: $name) { ${aliases} }
      }`;
      const variables = { owner: repoOwner, name: repoName };
      chunk.forEach((n, i) => {
        variables[`n${i}`] = n;
      });
      const data = this._graphql(query, variables);
      const repoData = data?.data?.repository || {};
      chunk.forEach((n, i) => {
        const node = repoData[`i${i}`]?.projectItems?.nodes?.find((entry) => entry.project?.number === projectNumber);
        result[n] = this._parseProjectItem(node, n);
      });
    }
    return result;
  }

  batchIssueDependencies(owner, repo, numbers, { chunkSize = 20 } = {}) {
    const result = {};
    for (let start = 0; start < numbers.length; start += chunkSize) {
      const chunk = numbers.slice(start, start + chunkSize);
      const aliases = chunk
        .map((_, i) => `i${i}: issue(number: $n${i}) { blockedBy(first: 100) { nodes { number } } }`)
        .join('\n');
      const query = `query($owner: String!, $name: String!${chunk.map((_, i) => `, $n${i}: Int!`).join('')}) { repository(owner: $owner, name: $name) { ${aliases} } }`;
      const variables = { owner, name: repo };
      chunk.forEach((n, i) => {
        variables[`n${i}`] = n;
      });
      const data = this._graphql(query, variables);
      const repoData = data?.data?.repository || {};
      chunk.forEach((n, i) => {
        result[n] = (repoData[`i${i}`]?.blockedBy?.nodes || []).map((x) => x.number);
      });
    }
    return result;
  }

  setProjectItemFieldValues(projectId, itemId, updates) {
    this._beforeMutation();
    const variables = { projectId, itemId };
    const aliases = updates
      .map((update, i) => {
        variables[`field${i}`] = update.fieldId;
        variables[`option${i}`] = update.optionId;
        return `u${i}: updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $field${i}, value: { singleSelectOptionId: $option${i} } }) { projectV2Item { id } }`;
      })
      .join('\n');
    const query = `mutation($projectId: ID!, $itemId: ID!${updates.map((_, i) => `, $field${i}: ID!, $option${i}: String!`).join('')}) { ${aliases} }`;
    const data = this._graphql(query, variables);
    this.clearCache('items:');
    this.rateState?.consume(5 * Math.max(1, updates.length), `${this.command}:mutation-batch`);
    return data;
  }

  batchIssueActivity(owner, repo, numbers, { chunkSize = 10 } = {}) {
    const comments = {};
    const subIssues = {};
    for (let start = 0; start < numbers.length; start += chunkSize) {
      const chunk = numbers.slice(start, start + chunkSize);
      const aliases = chunk
        .map(
          (n, i) =>
            `i${i}: issue(number: $n${i}) { comments(first: 100) { nodes { body } } subIssues(first: 100) { nodes { number state } } }`,
        )
        .join('\n');
      const variables = { owner, name: repo };
      chunk.forEach((n, i) => {
        variables[`n${i}`] = n;
      });
      const query = `query($owner: String!, $name: String!${chunk.map((_, i) => `, $n${i}: Int!`).join('')}) { repository(owner: $owner, name: $name) { ${aliases} } }`;
      const inputPath = path.join(os.tmpdir(), `tracker-activity-${process.pid}-${start}.json`);
      fs.writeFileSync(inputPath, JSON.stringify({ query, variables }));
      try {
        const result = this.run(['api', 'graphql', '--input', inputPath], { json: true });
        const repoData = result?.data?.repository || {};
        chunk.forEach((n, i) => {
          const node = repoData[`i${i}`];
          comments[n] = (node?.comments?.nodes || []).map((c) => c.body || '');
          subIssues[n] = (node?.subIssues?.nodes || []).map((s) => s.number).filter(Boolean);
        });
      } finally {
        fs.rmSync(inputPath, { force: true });
      }
    }
    return { comments, subIssues };
  }
}

export function createGitHub(options = {}) {
  return new GitHubCli({
    rateState: new RateState(),
    command: path.basename(process.argv[1] || 'tracker'),
    ...options,
  });
}
