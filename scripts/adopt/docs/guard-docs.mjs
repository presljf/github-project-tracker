#!/usr/bin/env node
/** Fail when changed source areas do not include their mapped documentation. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const root = path.resolve(opt('root', '.'));
const base = opt('base', process.env.DOCS_GUARD_BASE || 'origin/main');
const coveragePath = path.join(root, 'docs', 'DOCS_COVERAGE.json');
const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));

function normalized(file) {
  return String(file).replace(/^\.\//, '');
}
function ignored(file) {
  const f = normalized(file);
  return (coverage.ignore || []).some((scope) => f === scope.replace(/\/$/, '') || f.startsWith(scope));
}
function matches(file, prefix) {
  return normalized(file) === prefix || normalized(file).startsWith(prefix);
}

export function evaluateCoverage({ changedFiles, rules, ignore = [], linkedIssueType = '', exceptionReason = '', labels = [] }) {
  const changed = new Set(changedFiles.map(normalized));
  const docsChanged = [...changed].some((file) => file.startsWith('docs/') || file === 'README.md');
  const violations = [];
  if (labels.includes('docs:no-change') && exceptionReason.trim()) {
    return { ok: true, violations: [], skipped: 'docs:no-change exception with reason' };
  }
  for (const rule of rules) {
    const sources = [...changed].filter((file) => rule.paths.some((prefix) => matches(file, prefix)) && !ignore.some((scope) => file.startsWith(scope)));
    if (!sources.length) continue;
    const mappedDocs = rule.docs.filter((doc) => changed.has(doc));
    if (!mappedDocs.length) {
      violations.push({ code: 'DOCS_MISSING', rule: rule.id, sources, required: rule.docs });
    }
  }
  const knownPrefixes = rules.flatMap((rule) => rule.paths);
  const unmapped = [...changed].filter((file) => !ignored(file) && !file.startsWith('docs/') && !file.startsWith('tests/') && !knownPrefixes.some((prefix) => matches(file, prefix)));
  if (unmapped.length) violations.push({ code: 'UNMAPPED_SOURCE', files: unmapped });
  if (['Feature', 'Bug'].includes(linkedIssueType) && !docsChanged && !violations.length) {
    violations.push({ code: 'DOCS_REQUIRED_FOR_ISSUE_TYPE', issueType: linkedIssueType });
  }
  return { ok: violations.length === 0, violations };
}

function main() {
  const labels = (opt('labels', process.env.DOCS_GUARD_LABELS || '')).split(',').map((s) => s.trim()).filter(Boolean);
  const linkedIssueType = opt('linked-issue-type', process.env.DOCS_GUARD_ISSUE_TYPE || '');
  const exceptionReason = opt('exception-reason', process.env.DOCS_GUARD_EXCEPTION_REASON || '');
  const changedFiles = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const result = evaluateCoverage({ changedFiles, rules: coverage.rules, ignore: coverage.ignore || [], linkedIssueType, exceptionReason, labels });
  if (result.skipped) console.log(`Docs coverage guard skipped: ${result.skipped}`);
  if (result.ok) {
    console.log(`Docs coverage guard OK — ${changedFiles.length} changed file(s) covered.`);
  } else {
    console.error(`Docs coverage guard FAILED (${result.violations.length}):`);
    for (const v of result.violations) console.error(`- ${v.code}: ${JSON.stringify(v)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith('guard-docs.mjs')) main();
