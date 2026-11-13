#!/usr/bin/env node
/** Qualified version bump: explicit files, exclusions, dry-run diff, no dependency trees. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ALLOW = [
  'tracker.config.json',
  'tracker.config.example.json',
  'contract/adoption-contract.json',
  'README.md',
  'SECURITY.md',
  'docs/**/*.md',
  'docs/reference-cards/*.md',
  '.github/workflows/*.yml',
  '.github/workflows/*.yaml',
  '.github/ISSUE_TEMPLATE/*.yml',
  'profiles/**/*.md',
  'profiles/**/*.json',
  'profiles/**/*.yml',
  'profiles/**/*.yaml',
  'examples/*.json',
];
const EXCLUDE = [
  '**/package-lock.json',
  '**/node_modules/**',
  '**/.tracker-os/**',
  'CHANGELOG.md',
  'docs/DOCS_VALIDATION.md',
  'docs/ROADMAP_*.md',
  'docs/RELEASE_NOTES_*.md',
  'tests/**',
  '**/*.pdf',
  '**/*.png',
  '**/*.jpg',
  '**/*.jpeg',
  '**/*.webp',
  '**/*.ico',
];
function globToRegex(glob) {
  let out = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else out += '[^/]*';
    } else if (c === '.') out += '\\.';
    else out += c.replace(/[\\^$+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp(`${out}$`);
}
export function versionPattern(from) {
  const v = from.replace(/^v/, '').replace(/\./g, '\\.');
  return new RegExp(`(?:v?${v})(?![.\\d])`, 'g');
}
const VERSION_CONTEXT =
  /(docs version|target template|target\s+v|templateVersion|pinnedVersion|trackerVersion|"ref"\s*:|uses:\s|default:\s*v|latest patch|status:\s*v|release:\s*v|tag\s+v?|placeholder|upgrade-tracker|tracker-ref)/i;
const HISTORICAL =
  /(released as|result recorded|live t08|historical|remains immutable|superseded|incident|reusable workflow ref parses|composite action ref works)/i;
export function planVersionBump({ root, from, to }) {
  const allow = ALLOW.map(globToRegex);
  const exclude = EXCLUDE.map(globToRegex);
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const changes = [];
  for (const rel of files.sort()) {
    if (!allow.some((r) => r.test(rel))) continue;
    if (exclude.some((r) => r.test(rel))) continue;
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    const lines = text.split('\n');
    const edits = [];
    const pattern = versionPattern(from);
    lines.forEach((line, idx) => {
      if (!pattern.test(line)) return;
      if (!VERSION_CONTEXT.test(line) || HISTORICAL.test(line)) {
        pattern.lastIndex = 0;
        return;
      }
      pattern.lastIndex = 0;
      edits.push({
        line: idx + 1,
        before: line,
        after: line.replace(pattern, (match) => (match.startsWith('v') ? `v${to}` : to)),
      });
    });
    if (edits.length) changes.push({ file: rel, edits });
  }
  return changes;
}
export function applyVersionBump({ root, changes }) {
  for (const change of changes) {
    const file = path.join(root, change.file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (const edit of change.edits) lines[edit.line - 1] = edit.after;
    fs.writeFileSync(file, lines.join('\n'));
  }
}
function main() {
  const args = process.argv.slice(2);
  const get = (n, d = null) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : d;
  };
  const root = path.resolve(get('root', '.'));
  const from = get('from');
  const to = get('to');
  if (!from || !to) {
    console.error('usage: bump-version.mjs --from X.Y.Z --to X.Y.Z [--apply]');
    process.exitCode = 1;
    return;
  }
  const changes = planVersionBump({ root, from, to });
  console.log(
    `Qualified version bump ${from} -> ${to}: ${changes.length} file(s), ${changes.reduce((n, c) => n + c.edits.length, 0)} line(s).`,
  );
  for (const change of changes) {
    console.log(`\n${change.file}`);
    for (const edit of change.edits) console.log(`  ${edit.line}: ${edit.before.trim()} -> ${edit.after.trim()}`);
  }
  if (!args.includes('--apply')) {
    console.log('\nDry run. Re-run with --apply to write these exact lines.');
    return;
  }
  applyVersionBump({ root, changes });
  console.log('\nApplied. Regenerate cards and run guards.');
}
if (process.argv[1] && process.argv[1].endsWith('bump-version.mjs')) main();
