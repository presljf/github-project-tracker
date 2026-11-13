#!/usr/bin/env node
/** Reconcile project metadata to the Tracker OS canonical contract. */
import fs from 'node:fs';
import { GitHubCli } from '../lib/github.mjs';
import { UsageError } from '../lib/cli.mjs';

const RELEASE_LEGACY = /^\[([^\]]+)\]\s+Release\b(.*)$/i;
const SPRINT_LEGACY = /^\[([^\]]+)\]\s+Sprint\b(.*)$/i;
const RELEASE_CANONICAL = /^\[Release\]\s+([^\s—-]+)/i;
const SPRINT_CANONICAL = /^\[Sprint\]\s+([^\s—-]+)/i;
const TASK = /^\[([^\]]*?-T\d+)\]/i;

/**
 * Resolve the reconciled repo from `--repo` or `GITHUB_REPOSITORY`. Generic CLIs carry no hardcoded
 * repository default; a missing value is an actionable usage error, not a silent personal repo.
 */
export function resolveRepoArgument({ repo = null, env = process.env } = {}) {
  const value = String(repo ?? '').trim() || String(env?.GITHUB_REPOSITORY ?? '').trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(value))
    throw new UsageError('repo is required: pass --repo owner/repo or set GITHUB_REPOSITORY (no hardcoded default)');
  return value;
}

export function canonicalTitle(title = '') {
  let m = title.match(RELEASE_LEGACY);
  if (m) {
    const suffix = m[2].replace(/^\s*tracking\s*/i, '').trim();
    return `[Release] ${m[1].trim()}${suffix ? ` ${suffix}` : ''}`;
  }
  m = title.match(SPRINT_LEGACY);
  if (m) {
    const suffix = m[2].trim();
    return `[Sprint] ${m[1].trim()}${suffix ? ` ${suffix}` : ''}`;
  }
  return null;
}
export function expectedType(title = '') {
  if (RELEASE_CANONICAL.test(title) || SPRINT_CANONICAL.test(title)) return 'Task';
  if (TASK.test(title)) return 'Feature';
  return null;
}
export function buildReconciliationPlan({ issues = [], selected = [], includeClosed = false, exceptions = [] } = {}) {
  const selectedSet = new Set(selected.map(Number));
  const ignored = new Set(exceptions.flatMap((entry) => entry.issues || []));
  const working = issues.map((issue) => ({ ...issue, title: canonicalTitle(issue.title) || issue.title }));
  const sprints = new Map();
  const releases = new Map();
  for (const issue of working) {
    const sprint = issue.title.match(/^\[Sprint\]\s+([^\s—-]+)/i);
    if (sprint) sprints.set(sprint[1], issue.number);
    const release = issue.title.match(/^\[Release\]\s+([^\s—-]+)/i);
    if (release) releases.set(release[1], issue.number);
  }
  const plan = [];
  for (const issue of issues) {
    if (ignored.has(issue.number)) continue;
    if (!includeClosed && issue.state === 'CLOSED') continue;
    if (selectedSet.size && !selectedSet.has(Number(issue.number))) continue;
    const nextTitle = canonicalTitle(issue.title);
    const title = nextTitle || issue.title;
    const expected = expectedType(title);
    const actualType = issue.issueType?.name || issue.issueType || null;
    const actions = [];
    if (nextTitle && nextTitle !== issue.title) actions.push({ type: 'rename', from: issue.title, to: nextTitle });
    if (expected && actualType !== expected)
      actions.push({ type: 'type', from: actualType || 'missing', to: expected });
    const taskKey = title.match(/^\[([^\]]*?-T\d+)\]/i);
    const sprintKey = title.match(/^\[Sprint\]\s+([^\s—-]+)/i);
    if (taskKey) {
      const key = taskKey[1].replace(/-T\d+$/i, '');
      const parent = sprints.get(key);
      if (parent && issue.parent?.number !== parent)
        actions.push({ type: 'parent', from: issue.parent?.number || 'none', to: parent });
    } else if (sprintKey) {
      const [major, minor] = sprintKey[1].split('.');
      const releaseKey = `v${major}.${minor}.0`;
      const parent = releases.get(releaseKey);
      if (parent && issue.parent?.number !== parent)
        actions.push({ type: 'parent', from: issue.parent?.number || 'none', to: parent });
    }
    if (actions.length) plan.push({ number: issue.number, state: issue.state, actions });
  }
  return plan;
}

export function applyPlan({ github, owner, repo, plan, dryRun = true }) {
  const applied = [];
  for (const entry of plan) {
    for (const action of entry.actions) {
      if (!dryRun) {
        if (action.type === 'rename') github.updateIssueTitle(owner, repo, entry.number, action.to);
        if (action.type === 'type') github.setIssueType(owner, repo, entry.number, action.to);
        if (action.type === 'parent') github.addSubIssue(owner, repo, action.to, entry.number);
      }
      applied.push({ number: entry.number, ...action });
    }
  }
  return applied;
}
function main() {
  const args = process.argv.slice(2);
  const get = (n, d = null) => {
    const prefix = `--${n}=`;
    const inline = args.find((a) => a.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : d;
  };
  let repo;
  try {
    repo = resolveRepoArgument({ repo: get('repo', null) });
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`error: ${error.message}`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
  const [owner, name] = repo.split('/');
  const includeClosed = args.includes('--include-closed');
  const repair = get('repair', 'none');
  const selected = String(get('issues', ''))
    .split(',')
    .map((s) => Number(s.trim()))
    .filter(Boolean);
  if (!['none', 'open-only', 'selected', 'all-safe'].includes(repair)) {
    console.error(`error: --repair must be none, open-only, selected, or all-safe (got ${repair})`);
    process.exitCode = 1;
    return;
  }
  const gh = new GitHubCli();
  const issues = gh.listIssues(owner, name, { state: includeClosed ? 'all' : 'open', limit: 1000 });
  const parsedExceptions = (() => {
    try {
      const file = get('exceptions', null);
      if (!file) return [];
      return JSON.parse(fs.readFileSync(file, 'utf8')).exceptions || [];
    } catch {
      return [];
    }
  })();
  let plan = buildReconciliationPlan({ issues, selected, includeClosed, exceptions: parsedExceptions });
  if (repair === 'open-only') plan = plan.filter((p) => p.state !== 'CLOSED');
  if (repair === 'all-safe')
    plan = plan.filter((p) => p.actions.every((a) => ['rename', 'type', 'parent'].includes(a.type)));
  console.log(
    `Metadata reconciliation (${repair}${includeClosed ? ', include-closed' : ''}): ${plan.length} issue(s) require action.`,
  );
  for (const entry of plan)
    console.log(
      `#${entry.number} ${entry.state}: ${entry.actions.map((a) => `${a.type} ${a.from} -> ${a.to}`).join('; ')}`,
    );
  if (repair === 'none') return;
  if (!plan.length) return;
  applyPlan({ github: gh, owner, repo: name, plan, dryRun: false });
  console.log(`Applied ${plan.reduce((n, e) => n + e.actions.length, 0)} metadata action(s).`);
}
const isMain = process.argv[1] && process.argv[1].endsWith('reconcile-metadata.mjs');
if (isMain) main();
