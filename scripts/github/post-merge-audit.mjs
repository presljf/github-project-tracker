#!/usr/bin/env node
/** Audit a merged PR for contract bypasses and open a tracker OI. */
import { GitHubCli } from './lib/github.mjs';
import { evaluateRequiredChecks } from './merge-pr.mjs';
import { parseClosingRefs } from './guard-pr-close.mjs';

export const REQUIRED_CHECKS = ['ci / ci-gate', 'docs-guard', 'pr-close-guard'];
export function evaluateBypass({ pull, required = REQUIRED_CHECKS }) {
  const violations = [];
  const checks = evaluateRequiredChecks(pull.statusCheckRollup, required);
  if (!checks.ok) violations.push({ code: 'CHECKS_FAILED', detail: `missing=${checks.missing.join(',') || 'none'} failing=${checks.failing.join(',') || 'none'}` });
  const labels = (pull.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const partial = labels.includes('partial');
  const closing = parseClosingRefs(pull.body);
  if (String(pull.headRefName || '').startsWith('task/') && !partial && closing.length === 0) violations.push({ code: 'MISSING_CLOSING_KEYWORD', detail: 'task PR merged without Closes/Fixes/Resolves' });
  if (partial && closing.length > 0) violations.push({ code: 'PARTIAL_CLOSED_TASK', detail: `partial PR used closing keyword(s): ${closing.join(',')}` });
  return { ok: violations.length === 0, violations };
}
async function main() {
  const num = Number(process.env.PR_NUMBER);
  const repo = process.env.GITHUB_REPOSITORY || '';
  const [owner, name] = repo.split('/');
  const gh = new GitHubCli();
  const pull = gh.getPullRequest(owner, name, num);
  const result = evaluateBypass({ pull });
  if (result.ok) {
    console.log(`Post-merge audit OK for PR #${num}.`);
    return;
  }
  try { gh.createLabel('tracker-contract-exception', 'd93f0b', 'A merged PR bypassed Tracker contract checks'); } catch { /* label may exist */ }
  const detail = result.violations.map((v) => `- **${v.code}**: ${v.detail}`).join('\n');
  const issue = gh.createIssue(owner, {
    title: `[Bypass] PR #${num} merged without a clean contract gate`,
    body: `## Contract bypass detected\n\nPR: #${num}\n\n${detail}\n\nResolve this OI before the next release; do not silently retry or hide the bypass.\n`,
    labels: ['tracker-contract-exception'],
  });
  console.log(`Opened bypass OI #${issue.number}: ${issue.url}`);
}
const isMain = process.argv[1] && process.argv[1].endsWith('post-merge-audit.mjs');
if (isMain) main();
