#!/usr/bin/env node
/** Fail when tracker automation/workflows bypass the GitHub transport. */
import fs from 'node:fs';
import path from 'node:path';
import { findTransportViolations } from './lib/guards.mjs';

const rootIndex = process.argv.indexOf('--root');
const root = path.resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : '.');
const configPath = path.join(root, 'tracker.config.json');
let allow = [];
try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  allow = config.guard?.allow || [];
} catch { /* use defaults */ }
const violations = findTransportViolations({ root, allow });
if (violations.length) {
  console.error(`GitHub transport guard FAILED (${violations.length}):`);
  for (const v of violations) console.error(`- ${v.file}:${v.line}: ${v.text}`);
  process.exitCode = 1;
} else {
  console.log('GitHub transport guard OK — no raw gh/GitHub HTTP outside the allowlist.');
}
