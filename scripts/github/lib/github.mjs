import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TRANSIENT = /connection refused|timed out|TLS|502|503|ECONNRESET|EOF|Something went wrong|GraphQL.*(timeout|unavailable)/i;

export class GhError extends Error {
  constructor(args, err) {
    const stderr = (err?.stderr || '').toString().trim();
    const stdout = (err?.stdout || '').toString().trim();
    super(`gh ${args.join(' ')} failed${stderr ? `: ${stderr.split('\n')[0]}` : ''}${stdout && !stderr ? `: ${stdout.split('\n')[0]}` : ''}`);
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

export class GitHubCli {
  constructor({ exec = defaultExec, retries = 3, sleep = sleepSync } = {}) {
    this.exec = exec;
    this.retries = retries;
    this.sleep = sleep;
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
    const result = this.run(['project', 'list', '--owner', owner, '--format', 'json', '--limit', '100'], { json: true });
    return result?.projects || [];
  }

  createProject(owner, title) {
    return this.run(['project', 'create', '--owner', owner, '--title', title, '--format', 'json'], { json: true });
  }

  linkProject(owner, number, repo) {
    const result = this.run(['project', 'link', String(number), '--owner', owner, '--repo', repo], { allowFailure: true });
    if (result && result.error) {
      const text = `${result.error?.stderr || ''}\n${result.error?.message || ''}`;
      if (/already|linked/i.test(text)) return { alreadyLinked: true };
      throw new GhError(['project', 'link'], result.error);
    }
    return {};
  }

  listFields(owner, number) {
    const result = this.run(['project', 'field-list', String(number), '--owner', owner, '--format', 'json'], { json: true });
    return result?.fields || [];
  }

  createField(owner, number, name, options) {
    const args = [
      'project', 'field-create', String(number), '--owner', owner,
      '--name', name, '--data-type', 'SINGLE_SELECT',
      '--single-select-options', options.join(','), '--format', 'json',
    ];
    return this.run(args, { json: true });
  }

  updateFieldOptions(fieldId, options) {
    const query = 'query($id: ID!) { node(id: $id) { ... on ProjectV2SingleSelectField { id options { id name color description } } } }';
    fs.writeFileSync(path.join(os.tmpdir(), 'tracker-field-query.json'), JSON.stringify({ query, variables: { id: fieldId } }));
    const node = this.run(['api', 'graphql', '--input', path.join(os.tmpdir(), 'tracker-field-query.json')], { json: true });
    const existing = node?.data?.node?.options || [];
    const byName = new Map(existing.map((option) => [option.name, option]));
    const merged = options.map((option) => {
      const current = byName.get(option.name || option);
      return current
        ? { id: current.id, name: current.name, color: current.color, description: current.description || '' }
        : { name: typeof option === 'string' ? option : option.name, color: 'BLUE', description: '' };
    });
    const mutation = 'mutation($input: UpdateProjectV2FieldInput!) { updateProjectV2Field(input: $input) { projectV2Field { ... on ProjectV2SingleSelectField { options { id name } } } } }';
    const inputPath = path.join(os.tmpdir(), 'tracker-field-update.json');
    fs.writeFileSync(inputPath, JSON.stringify({ query: mutation, variables: { input: { fieldId, singleSelectOptions: merged } } }));
    return this.run(['api', 'graphql', '--input', inputPath], { json: true });
  }

  listMilestones(owner, repo) {
    const result = this.run(['api', `repos/${owner}/${repo}/milestones?state=all&per_page=100`], { json: true });
    return result || [];
  }

  createMilestone(owner, repo, title, description) {
    return this.run([
      'api', '--method', 'POST', `repos/${owner}/${repo}/milestones`,
      '-f', `title=${title}`, '-f', `description=${description || ''}`,
    ], { json: true });
  }

  listLabels(owner, repo) {
    const result = this.run(['label', 'list', '--repo', `${owner}/${repo}`, '--limit', '100', '--json', 'name,color,description'], { json: true });
    return result || [];
  }

  createLabel(owner, repo, name, color, description) {
    return this.run([
      'label', 'create', name, '--repo', `${owner}/${repo}`,
      '--color', color, '--description', description || '',
    ]);
  }

  findIssue(owner, repo, title) {
    const search = `in:title "${title}"`;
    const result = this.run([
      'issue', 'list', '--repo', `${owner}/${repo}`, '--state', 'all',
      '--search', search, '--json', 'number,title,state,url', '--limit', '100',
    ], { json: true });
    const matches = (result || []).filter((issue) => issue.title === title);
    return matches.find((issue) => issue.state === 'OPEN') || matches[0] || null;
  }


  getIssueView(owner, repo, number) {
    return this.run([
      'issue', 'view', String(number), '--repo', `${owner}/${repo}`,
      '--json', 'number,title,state,assignees,milestone,issueType,body,url,labels',
    ], { json: true });
  }

  addAssignee(owner, repo, number, login) {
    return this.run(['issue', 'edit', String(number), '--repo', `${owner}/${repo}`, '--add-assignee', login]);
  }

  addComment(owner, repo, number, body) {
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
    return this.run(['issue', 'close', String(number), '--repo', `${owner}/${repo}`, '--reason', 'completed']);
  }

  addBlockedBy(owner, repo, number, blockedByUrl) {
    return this.run(['issue', 'edit', String(number), '--repo', `${owner}/${repo}`, '--add-blocked-by', blockedByUrl]);
  }

  getIssue(owner, repo, number) {
    return this.run(['issue', 'view', String(number), '--repo', `${owner}/${repo}`, '--json', 'number,title,state,url'], { json: true });
  }

  createIssue(owner, repo, { title, body, milestone }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-issue-'));
    const bodyPath = path.join(dir, 'body.md');
    fs.writeFileSync(bodyPath, body || '');
    const args = ['issue', 'create', '--repo', `${owner}/${repo}`, '--title', title, '--body-file', bodyPath];
    if (milestone) args.push('--milestone', milestone);
    const url = this.run(args);
    const number = Number(url.split('/').pop());
    fs.rmSync(dir, { recursive: true, force: true });
    return { number, title, state: 'OPEN', url };
  }

  setIssueType(owner, repo, number, type) {
    return this.run(['api', `repos/${owner}/${repo}/issues/${number}`, '--method', 'PATCH', '-f', `type=${type}`], { json: true });
  }

  listSubIssues(owner, repo, parent) {
    const result = this.run(['api', `repos/${owner}/${repo}/issues/${parent}/sub_issues`], { json: true });
    return result || [];
  }

  addSubIssue(owner, repo, parent, child) {
    const childId = this.run(['api', `repos/${owner}/${repo}/issues/${child}`, '--jq', '.id']);
    const args = ['api', '--method', 'POST', `repos/${owner}/${repo}/issues/${parent}/sub_issues`, '-F', `sub_issue_id=${childId}`];
    const result = this.run(args, { allowFailure: true });
    if (result && result.error) {
      const text = `${result.error?.stderr || ''}\n${result.error?.message || ''}`;
      if (/already|duplicate|sub.?issue/i.test(text)) return { alreadyLinked: true };
      throw new GhError(args, result.error);
    }
    return result;
  }

  listProjectItems(owner, number) {
    const result = this.run(['project', 'item-list', String(number), '--owner', owner, '--format', 'json', '--limit', '100'], { json: true });
    return result?.items || [];
  }

  addProjectItem(owner, number, url) {
    return this.run(['project', 'item-add', String(number), '--owner', owner, '--url', url, '--format', 'json'], { json: true });
  }


  listIssues(owner, repo, state = 'all') {
    const result = this.run([
      'issue', 'list', '--repo', `${owner}/${repo}`, '--state', state,
      '--json', 'number,title,state,assignees,labels,milestone,issueType,url',
      '--limit', '100',
    ], { json: true });
    return result || [];
  }

  issueComments(owner, repo, number) {
    const result = this.run([
      'issue', 'view', String(number), '--repo', `${owner}/${repo}`, '--json', 'comments',
    ], { json: true });
    return result?.comments || [];
  }

  issueDependencies(owner, repo, number) {
    const result = this.run(['api', `repos/${owner}/${repo}/issues/${number}`], { json: true });
    return result?.issue_dependencies_summary || { blocked_by: 0, blocking: 0 };
  }

  setProjectItemField(projectId, itemId, fieldId, optionId) {
    this.run([
      'project', 'item-edit', '--id', itemId, '--project-id', projectId,
      '--field-id', fieldId, '--single-select-option-id', optionId,
    ]);
  }
}
