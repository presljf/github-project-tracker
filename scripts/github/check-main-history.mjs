#!/usr/bin/env node
/** Backstop: flag main commits not associated with a merged PR. */
import { execFileSync } from 'node:child_process';
import { GitHubCli } from './lib/github.mjs';

export function evaluateMainHistory({ commits = [], pullsBySha = {} } = {}) {
  const violations = [];
  for (const sha of commits) {
    const pulls = pullsBySha[sha] || [];
    const merged = pulls.some((pr) => pr.merged_at || pr.merged);
    if (!merged) violations.push(sha);
  }
  return { ok: violations.length === 0, violations };
}
function main() {
  const repo = process.env.GITHUB_REPOSITORY || '';
  const [owner, name] = repo.split('/');
  const base = process.env.BASE_SHA || '';
  const head = process.env.HEAD_SHA || 'HEAD';
  const empty = /^0+$/.test(base);
  const range = empty ? [head] : [base, head];
  const args = empty ? ['rev-list', '--max-count=1', head] : ['rev-list', `${range[0]}..${range[1]}`];
  const shas = execFileSync('git', args, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const gh = new GitHubCli();
  const pullsBySha = {};
  for (const sha of shas) pullsBySha[sha] = gh.getCommitPullRequests(owner, name, sha) || [];
  const result = evaluateMainHistory({ commits: shas, pullsBySha });
  if (result.ok) {
    console.log(`Main history OK — ${shas.length} commit(s) associated with merged PRs.`);
    return;
  }
  const body = [
    '## Direct/non-PR main commit detected',
    '',
    `Repository: ${repo}`,
    `Commits without a merged PR: ${result.violations.map((s) => `\`${s}\``).join(', ')}`,
    '',
    'Resolve this OI before the next release. Hooks/branch protection should prevent this; do not hide the bypass.',
  ].join('\n');
  const issue = gh.createIssue(owner, {
    title: '[Bypass] Direct main commit without merged PR',
    body,
    labels: ['tracker-contract-exception'],
  });
  console.error(`Main history FAILED — opened OI #${issue.number}: ${issue.url}`);
  process.exitCode = 1;
}
if (process.argv[1] && process.argv[1].endsWith('check-main-history.mjs')) main();
