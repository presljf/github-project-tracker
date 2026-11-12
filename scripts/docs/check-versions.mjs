#!/usr/bin/env node
/** Fail when active docs/config/workflows still pin an older tracker version. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function findStaleVersions({ files, stale = '1.0.1', allow = [] } = {}) {
  const allowed = new Set(allow);
  const violations = [];
  for (const rel of files) {
    if (allowed.has(rel) || rel.startsWith('tests/') || rel.startsWith('scripts/')) continue;
    let text;
    try { text = fs.readFileSync(rel, 'utf8'); } catch { continue; }
    const v = String(stale).replace(/\./g, '\\.');
    const pattern = new RegExp(`(?:v${v}\\b|(?<![\\w.])${v}(?![\\w.]))`, 'g');
    if (pattern.test(text)) violations.push(rel);
  }
  return violations;
}
function main() {
  const root = process.cwd();
  const config = JSON.parse(fs.readFileSync(path.join(root, 'tracker.config.json'), 'utf8'));
  const current = String(config.automation.templateVersion || '');
  const files = execFileSync('git', ['ls-files', '*.md', '*.yml', '*.yaml', '*.json', '*.mjs'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const violations = findStaleVersions({ files, stale: '1.0.1', allow: ['CHANGELOG.md', 'docs/ROADMAP_v1.1.0.md', 'package-lock.json'] });
  if (violations.length) {
    console.error(`Version consistency FAILED — ${violations.length} file(s) still reference 1.0.1:`);
    for (const f of violations) console.error(`- ${f}`);
    process.exitCode = 1;
  } else console.log(`Version consistency OK — active files reference v${current}.`);
}
if (process.argv[1] && process.argv[1].endsWith('check-versions.mjs')) main();
