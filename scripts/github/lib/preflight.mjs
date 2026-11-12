import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function evaluateCleanTree({ statusText = '', allowDirty = false, reason = '' } = {}) {
  const dirty = String(statusText).trim().split('\n').filter(Boolean);
  if (!dirty.length) return { ok: true, dirty, violations: [] };
  const violations = [];
  if (!allowDirty) violations.push(`worktree is dirty (${dirty.length} path(s)); commit/stash or use --allow-dirty --dirty-reason`);
  else if (!String(reason).trim()) violations.push('--allow-dirty requires --dirty-reason');
  return { ok: violations.length === 0, dirty, violations };
}
export function gitStatus(repoRoot) {
  return execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim();
}
export function evaluateDependencyChanges({ changedFiles = [], basePackage = null, currentPackage = null, approvals = {}, now = Date.now() } = {}) {
  const dependencyFiles = changedFiles.filter((f) => /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(f));
  if (!dependencyFiles.length) return { ok: true, dependencyFiles, violations: [] };
  if (changedFiles.includes('package.json') && basePackage && currentPackage) {
    const deps = (pkg) => JSON.stringify({ dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {}, optionalDependencies: pkg.optionalDependencies || {} });
    if (deps(basePackage) === deps(currentPackage) && !dependencyFiles.some((f) => f.endsWith('lock.json') || f.endsWith('.lock') || f.endsWith('.yaml'))) {
      return { ok: true, dependencyFiles: [], violations: [] };
    }
  }
  const entries = approvals.approvals || [];
  const violations = [];
  for (const file of dependencyFiles) {
    const approved = entries.find((entry) => (entry.paths || []).includes(file) && entry.issue && entry.reason && (!entry.expires || Date.parse(entry.expires) >= now));
    if (!approved) violations.push(`${file} changed without an approved tracker.dependencies entry (issue/reason/expiry)`);
  }
  return { ok: violations.length === 0, dependencyFiles, violations };
}
