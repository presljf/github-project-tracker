#!/usr/bin/env node
/** Require explicit approval for dependency/lockfile changes in a PR. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { evaluateDependencyChanges } from '../lib/preflight.mjs';

function main() {
  const args = process.argv.slice(2);
  const get = (name, fallback = null) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const root = path.resolve(get('root', '.'));
  const base = get('base', 'origin/main');
  const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: root, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
  let basePackage = null;
  let currentPackage = null;
  try {
    basePackage = JSON.parse(execFileSync('git', ['show', `${base}:package.json`], { cwd: root, encoding: 'utf8' }));
  } catch {
    /* no package */
  }
  try {
    currentPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    /* no package */
  }
  let approvals = {};
  try {
    approvals = JSON.parse(fs.readFileSync(path.join(root, 'tracker.dependencies.json'), 'utf8'));
  } catch {
    /* none */
  }
  const result = evaluateDependencyChanges({ changedFiles: changed, basePackage, currentPackage, approvals });
  if (result.ok) console.log('Dependency approval guard OK.');
  else {
    console.error(`Dependency approval guard FAILED (${result.violations.length}):`);
    for (const v of result.violations) console.error(`- ${v}`);
    process.exitCode = 1;
  }
}
main();
