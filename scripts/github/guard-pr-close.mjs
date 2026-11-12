#!/usr/bin/env node
/** Enforce closing-keyword rules for tracker task PRs. */
import { GitHubCli } from './lib/github.mjs';

const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;
const PARTIAL = /\b(?:refs?|part of)\s+#(\d+)\b/i;
function issueKind(title = '') {
  if (/^\[Roadmap\]/i.test(title)) return 'roadmap';
  if (/^\[Release\]/i.test(title)) return 'release';
  if (/^\[Sprint\]/i.test(title)) return 'sprint';
  return 'task';
}
export function parseClosingRefs(body = '') {
  return [...String(body).matchAll(CLOSING)].map((m) => Number(m[1]));
}
export function evaluateClosing({ body = '', branch = '', labels = [], lookup = () => null }) {
  const violations = [];
  const closing = parseClosingRefs(body);
  const labelsSet = new Set(labels.map((l) => String(l).toLowerCase()));
  const isTaskBranch = branch.startsWith('task/');
  const partial = labelsSet.has('partial');
  if (isTaskBranch && !partial && closing.length === 0) violations.push('task PR must contain a closing keyword (Closes/Fixes/Resolves #N)');
  if (partial && closing.length > 0) violations.push('partial PR must not use a closing keyword; use Refs/Part of');
  if (isTaskBranch && partial && !PARTIAL.test(body)) violations.push('partial task PR must reference the parent with Refs/Part of');
  for (const n of closing) {
    const issue = lookup(n);
    if (!issue) violations.push(`closing references missing issue #${n}`);
    else {
      const kind = issueKind(issue.title);
      if (kind !== 'task') violations.push(`closing keyword targets a ${kind} tracker (#${n}), not a task`);
    }
  }
  return { ok: violations.length === 0, closing, violations };
}
async function main() {
  const pr = Number(process.env.PR_NUMBER);
  const repo = process.env.GITHUB_REPOSITORY || '';
  const [owner, name] = repo.split('/');
  const gh = new GitHubCli();
  const pull = gh.getPullRequest(owner, name, pr);
  const body = process.env.PR_BODY || pull.body || '';
  const branch = process.env.PR_BRANCH || pull.headRefName || '';
  const eventLabels = (process.env.PR_LABELS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const labels = eventLabels.length ? eventLabels : (pull.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const lookup = (n) => gh.getIssue(owner, name, n);
  const result = evaluateClosing({ body, branch, labels, lookup });
  if (result.ok) console.log('PR closing-keyword guard OK.');
  else {
    console.error(`PR closing-keyword guard FAILED (${result.violations.length}):`);
    for (const v of result.violations) console.error(`- ${v}`);
    process.exitCode = 1;
  }
}
const isMain = process.argv[1] && process.argv[1].endsWith('guard-pr-close.mjs');
if (isMain) main();
