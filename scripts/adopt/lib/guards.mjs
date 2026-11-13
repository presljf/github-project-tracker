import fs from 'node:fs';
import path from 'node:path';

const SCAN_EXT = new Set(['.js', '.mjs', '.cjs', '.yml', '.yaml']);
const DEFAULT_ALLOW = [
  'scripts/adopt/lib/github.mjs',
  'scripts/adopt/lib/guards.mjs',
  'scripts/adopt/cli/guard-gh-transport.mjs',
  'scripts/adopt/cli/guard-scope.mjs',
];
const TRANSPORT_PATTERNS = [
  /\bgh\s+(?:api|issue|pr|project|repo|auth|workflow|label|run|release)\b/,
  /api\.github\.com/,
  /https?:\/\/github\.com\/[^\s'"`]+\/actions\/workflows/,
  /exec(?:File|FileSync)?\(\s*['"]gh['"]/,
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'coverage', 'dist', 'build'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SCAN_EXT.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function normalizeScopes(scopes) {
  return (scopes || []).map((s) => String(s).replace(/^\.\//, '').replace(/\/+$/, '')).filter(Boolean);
}

export function isAllowed(file, scopes) {
  const normalized = String(file).replace(/^\.\//, '');
  return normalizeScopes(scopes).some((scope) => normalized === scope || normalized.startsWith(`${scope}/`));
}

export function findTransportViolations({ root, allow = [] }) {
  const allowed = new Set([...DEFAULT_ALLOW, ...normalizeScopes(allow)]);
  const dirs = [path.join(root, 'scripts'), path.join(root, '.github', 'workflows')];
  const violations = [];
  for (const file of dirs.flatMap((dir) => walk(dir))) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (allowed.has(rel)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const pattern of TRANSPORT_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({ file: rel, line: index + 1, text: line.trim() });
          break;
        }
      }
    });
  }
  return violations;
}

export function changedFilesOutsideScope({ changedFiles, scopes }) {
  return changedFiles.filter((file) => !isAllowed(file, scopes));
}
