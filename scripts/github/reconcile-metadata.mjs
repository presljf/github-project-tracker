#!/usr/bin/env node
/** Reconcile project metadata to the Tracker OS canonical contract. */
import fs from 'node:fs';
import path from 'node:path';
import { GitHubCli } from './lib/github.mjs';

const RELEASE_LEGACY = /^\[([^\]]+)\]\s+Release\b(.*)$/i;
const SPRINT_LEGACY = /^\[([^\]]+)\]\s+Sprint\b(.*)$/i;
const RELEASE_CANONICAL = /^\[Release\]\s+([^\s—-]+)/i;
const SPRINT_CANONICAL = /^\[Sprint\]\s+([^\s—-]+)/i;
const TASK = /^\[([^\]]*?-T\d+)\]/i;

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
export function buildReconciliationPlan({ issues = [], selected = [], includeClosed = false } = {}) {
  const selectedSet = new Set(selected.map(Number));
  const plan = [];
  for (const issue of issues) {
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
      }
      applied.push({ number: entry.number, ...action });
    }
  }
  return applied;
}
function main() {
  const args = process.argv.slice(2);
  const get = (n, d = null) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : d;
  };
  const repo = get('repo', 'presljf/castdeck');
  const [owner, name] = repo.split('/');
  const root = process.cwd();
  const contract = JSON.parse(
    fs.readFileSync(get('contract', path.join(root, 'contract/adoption-contract.json')), 'utf8'),
  );
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
  let plan = buildReconciliationPlan({ issues, selected, includeClosed });
  if (repair === 'open-only') plan = plan.filter((p) => p.state !== 'CLOSED');
  if (repair === 'all-safe') plan = plan.filter((p) => p.actions.every((a) => ['rename', 'type'].includes(a.type)));
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
