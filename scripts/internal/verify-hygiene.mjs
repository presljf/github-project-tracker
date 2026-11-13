#!/usr/bin/env node
/**
 * Tracked-file hygiene guard (template policy).
 *
 * Catches the class of defect that slipped through T05: a tracked symlink (a `node_modules` symlink
 * whose .gitignore pattern had a trailing slash) that `git status` reports as clean and that no
 * runtime test necessarily exercises. It fails when `git ls-files` contains:
 *   1. a symlink (mode `120000`), or
 *   2. a tracked path that the repository's .gitignore rules match (force-added or ignore-rule
 *      drift). Global/user excludes are disabled for the check so a developer's personal
 *      core.excludesFile cannot make the required local gate fail where CI passes; repo-local
 *      .git/info/exclude is still part of git's effective rules.
 *
 * Internal/template-maintainer-only: adopters do not copy this script. No network, no mutations.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Parse `git ls-files -s -z` records (`<mode> <sha> <stage>\t<path>\0`) into mode/path pairs. */
export function parseLsFiles(output) {
  const entries = [];
  for (const record of String(output ?? '').split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const [mode] = record.slice(0, tab).split(/\s+/);
    entries.push({ mode, path: record.slice(tab + 1) });
  }
  return entries;
}

/**
 * Return `{ ok, files, violations }` for the repository at `root`.
 * Throws when git itself cannot answer (not a repository, git missing) so a missing prerequisite is
 * never reported as a pass.
 */
export function findHygieneViolations({ root = process.cwd(), spawn = spawnSync } = {}) {
  const listed = spawn('git', ['-C', root, 'ls-files', '-s', '-z'], { encoding: 'utf8' });
  if (listed?.status !== 0) {
    throw new Error(`git ls-files failed: ${String(listed?.stderr || '').trim() || 'unknown error'}`);
  }
  const entries = parseLsFiles(listed.stdout);
  const violations = [];
  for (const entry of entries) {
    if (entry.mode === '120000') violations.push(`tracked symlink: ${entry.path}`);
  }

  const stdin = entries.map((entry) => entry.path).join('\0');
  const ignored = spawn(
    'git',
    ['-C', root, '-c', 'core.excludesFile=/dev/null', 'check-ignore', '--no-index', '-z', '--stdin'],
    {
      encoding: 'utf8',
      input: stdin ? `${stdin}\0` : '',
    },
  );
  // check-ignore exits 0 when at least one path is ignored, 1 when none are; anything else is an error.
  if (ignored?.status !== 0 && ignored?.status !== 1) {
    throw new Error(`git check-ignore failed: ${String(ignored?.stderr || '').trim() || 'unknown error'}`);
  }
  for (const file of String(ignored?.stdout ?? '').split('\0')) {
    if (file) violations.push(`tracked path is git-ignored: ${file}`);
  }

  return { ok: violations.length === 0, files: entries.length, violations };
}

function main() {
  const args = process.argv.slice(2);
  const get = (name, fallback = null) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const root = path.resolve(get('root', '.'));
  let result;
  try {
    result = findHygieneViolations({ root });
  } catch (error) {
    console.error(`Tracked-file hygiene error: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  if (result.ok) {
    console.log(`Tracked-file hygiene OK — ${result.files} tracked path(s); no symlinks or git-ignored paths.`);
    return;
  }
  console.error(`Tracked-file hygiene FAILED (${result.violations.length}):`);
  for (const violation of result.violations) console.error(`- ${violation}`);
  process.exitCode = 1;
}

const isMain = process.argv[1] && process.argv[1].endsWith('verify-hygiene.mjs');
if (isMain) main();
