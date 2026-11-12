#!/usr/bin/env node
/** Install versioned git hooks for branch hygiene. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const hooksDir = path.join(root, '.githooks');
const required = ['pre-commit', 'pre-push', 'post-checkout'];
const missing = required.filter((name) => !fs.existsSync(path.join(hooksDir, name)));
if (missing.length) {
  console.error(`error: missing hook(s): ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  for (const name of required) fs.chmodSync(path.join(hooksDir, name), 0o755);
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, stdio: 'inherit' });
  console.log('Installed git hooks: core.hooksPath=.githooks (pre-commit, pre-push, post-checkout).');
}
