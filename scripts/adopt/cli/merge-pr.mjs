#!/usr/bin/env node
/** Merge a PR only when required checks are green; refuses --admin. */
import { GitHubCli } from '../lib/github.mjs';

const CHECK_PASS = new Set(['SUCCESS']);
export function canonicalState(check) {
  return String(check.conclusion || check.state || '').toUpperCase();
}
export function canonicalName(check) {
  return check.name || check.context || '';
}
export function evaluateRequiredChecks(rollup = [], required = []) {
  const byName = new Map();
  for (const check of rollup || []) byName.set(canonicalName(check), canonicalState(check));
  const missing = [];
  const failing = [];
  for (const name of required) {
    if (!byName.has(name)) missing.push(name);
    else if (!CHECK_PASS.has(byName.get(name))) failing.push(`${name}=${byName.get(name)}`);
  }
  return { ok: missing.length === 0 && failing.length === 0, missing, failing };
}

function parse(argv) {
  if (argv.includes('--admin'))
    throw new Error('--admin is forbidden; use only a normal merge after required checks pass.');
  const get = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const pr = Number(get('pr'));
  const repo = get('repo');
  if (!Number.isInteger(pr) || pr <= 0 || !repo)
    throw new Error(
      'usage: merge-pr.mjs --pr N --repo owner/repo [--required "ci / ci-gate,docs-guard"] [--delete-branch]',
    );
  return {
    pr,
    repo,
    required: String(get('required', 'ci / ci-gate,docs-guard'))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    deleteBranch: argv.includes('--delete-branch'),
    method: get('method', 'squash'),
  };
}

async function main() {
  const { pr, repo, required, deleteBranch, method } = parse(process.argv.slice(2));
  const [owner, name] = repo.split('/');
  const gh = new GitHubCli();
  const pull = gh.getPullRequest(owner, name, pr);
  if (pull.isDraft) throw new Error(`PR #${pr} is a draft.`);
  if (pull.state !== 'OPEN') throw new Error(`PR #${pr} is ${pull.state}.`);
  if (pull.mergeable !== 'MERGEABLE') throw new Error(`PR #${pr} is not mergeable (${pull.mergeable}).`);
  const result = evaluateRequiredChecks(pull.statusCheckRollup, required);
  if (!result.ok)
    throw new Error(
      `required checks not green; missing=${result.missing.join(',') || 'none'} failing=${result.failing.join(',') || 'none'}`,
    );
  gh.mergePullRequest(owner, name, pr, { method, deleteBranch });
  console.log(`PR #${pr} merged normally; required checks green: ${required.join(', ')}`);
}

const isMain = process.argv[1] && process.argv[1].endsWith('merge-pr.mjs');
if (isMain) {
  main().catch((err) => {
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
  });
}
