#!/usr/bin/env node
/** Verify a branch/worktree only touches allowed task paths. */
import { execFileSync } from 'node:child_process';
import { changedFilesOutsideScope } from './lib/guards.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const base = opt('base', 'origin/main');
const scopeArg = opt('scope', '');
const scopes = scopeArg.split(',').map((s) => s.trim()).filter(Boolean);
if (!scopes.length) {
  console.error('usage: guard-scope.mjs --base origin/main --scope "path1,path2"');
  process.exitCode = 2;
} else {
  const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const outside = changedFilesOutsideScope({ changedFiles: changed, scopes });
  if (outside.length) {
    console.error(`Scope guard FAILED (${outside.length} outside ${scopeArg}):`);
    for (const file of outside) console.error(`- ${file}`);
    process.exitCode = 1;
  } else {
    console.log(`Scope guard OK — ${changed.length} changed file(s) within ${scopeArg}.`);
  }
}
