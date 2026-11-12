#!/usr/bin/env node
/** Verify live GitHub project metadata against the adoption contract. */
import fs from 'node:fs';
import path from 'node:path';
import { GitHubCli } from './lib/github.mjs';

const RELEASE_CANONICAL = /^\[Release\]\s+([^\s—-]+)/i;
const RELEASE_LEGACY = /^\[([^\]]+)\]\s+Release\b/i;
const SPRINT_CANONICAL = /^\[Sprint\]\s+([^\s—-]+)/i;
const SPRINT_LEGACY = /^\[([^\]]+)\]\s+Sprint\b/i;
const TASK = /^\[([^\]]*?-T\d+)\]/i;

export function classifyTitle(title = '') {
  const release = title.match(RELEASE_CANONICAL) || title.match(RELEASE_LEGACY);
  if (release) return { kind: 'release', key: release[1].trim() };
  const sprint = title.match(SPRINT_CANONICAL) || title.match(SPRINT_LEGACY);
  if (sprint) return { kind: 'sprint', key: sprint[1].trim() };
  const task = title.match(TASK);
  if (task) return { kind: 'task', key: task[1].trim() };
  return { kind: 'other', key: null };
}
export function evaluateMetadata({ contract, issueTypes = [], fields = [], issues = [] }) {
  const meta = contract.metadata || {};
  const violations = [];
  const typeNames = new Set(issueTypes.map((t) => t.name || t));
  for (const type of meta.requiredIssueTypes || [])
    if (!typeNames.has(type)) violations.push(`native issue type missing: ${type}`);
  const fieldNames = new Set(fields.map((f) => f.name));
  for (const name of meta.requiredFields || [])
    if (!fieldNames.has(name)) violations.push(`required project field missing: ${name}`);
  for (const name of meta.forbiddenFields || [])
    if (fieldNames.has(name)) violations.push(`forbidden project field present: ${name}`);
  for (const [name, allowed] of Object.entries(meta.optionalFields || {})) {
    const field = fields.find((f) => f.name === name);
    if (!field) continue;
    const options = new Set((field.options || []).map((o) => o.name || o));
    for (const option of allowed)
      if (!options.has(option)) violations.push(`optional field ${name} missing option: ${option}`);
  }
  for (const [name, required] of Object.entries(meta.requiredOptions || {})) {
    const field = fields.find((f) => f.name === name);
    if (!field) continue;
    const options = new Set((field.options || []).map((o) => o.name || o));
    for (const option of required)
      if (!options.has(option)) violations.push(`project field ${name} missing option: ${option}`);
  }
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  const seen = { release: new Map(), sprint: new Map(), task: new Map() };
  for (const issue of issues) {
    const { kind, key } = classifyTitle(issue.title);
    if (!['release', 'sprint', 'task'].includes(kind)) continue;
    const expected = meta.typeMapping?.[kind];
    const actual = issue.issueType?.name || issue.issueType || null;
    if (expected && actual !== expected)
      violations.push(`#${issue.number} ${kind} type=${actual || 'missing'} expected ${expected}`);
    if (key) {
      if (seen[kind].has(key))
        violations.push(`duplicate ${kind} key ${key}: #${seen[kind].get(key)} and #${issue.number}`);
      else seen[kind].set(key, issue.number);
    }
    if (kind === 'sprint') {
      const parent = issue.parent?.number ? byNumber.get(issue.parent.number) : null;
      if (!parent || classifyTitle(parent.title).kind !== 'release')
        violations.push(`#${issue.number} sprint parent is not a Release`);
    }
    if (kind === 'task') {
      const parent = issue.parent?.number ? byNumber.get(issue.parent.number) : null;
      if (!parent || classifyTitle(parent.title).kind !== 'sprint')
        violations.push(`#${issue.number} task parent is not a Sprint`);
    }
  }
  return { ok: violations.length === 0, violations };
}
function main() {
  const args = process.argv.slice(2);
  const get = (n, d = null) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : d;
  };
  const root = process.cwd();
  const contract = JSON.parse(
    fs.readFileSync(get('contract', path.join(root, 'contract/adoption-contract.json')), 'utf8'),
  );
  const repo = get('repo', 'presljf/github-project-tracker');
  const [owner, name] = repo.split('/');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'tracker.config.json'), 'utf8'));
  const projectNumber = Number(get('project', config.project?.number || 0));
  const gh = new GitHubCli();
  const issueTypes = gh.getIssueTypes(owner, name);
  const fields = projectNumber ? gh.listFields(owner, projectNumber) : [];
  const issues = gh.listIssues(owner, name, { state: args.includes('--include-closed') ? 'all' : 'open', limit: 1000 });
  const result = evaluateMetadata({ contract, issueTypes, fields, issues });
  if (result.ok) console.log('Project metadata OK.');
  else {
    console.error(`Project metadata FAILED (${result.violations.length}):`);
    for (const v of result.violations) console.error(`- ${v}`);
    if (!args.includes('--warn-only')) process.exitCode = 1;
  }
}
if (process.argv[1] && process.argv[1].endsWith('verify-metadata.mjs')) main();
