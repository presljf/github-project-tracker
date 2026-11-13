#!/usr/bin/env node
/**
 * Tech-debt register: scan, guard, and render (T02 / issue #137).
 *
 * The register (`contract/debt-register.json`) is the single source of truth for accepted
 * tech debt. This tool has three jobs:
 *
 * - advisory scan (default / `--advisory`): print the heuristic findings and always exit 0;
 * - blocking guard (`--check`): fail on expired or unlabeled debt, on accepted shims/temp fixes
 *   without owner+expiry+reason+pointer, on pointers that no longer exist, on unregistered
 *   blocking-class findings, and on a stale generated `docs/TECH_DEBT.md`;
 * - render (`--render`/`--write`): deterministically regenerate `docs/TECH_DEBT.md` from the
 *   register (same content the guard compares against).
 *
 * `--json` prints a deterministic machine-readable result (no timestamps).
 *
 * Scans tracked files (`git ls-files`, filesystem walk fallback for fixtures):
 * comment markers in scripts/, tests/ and .github/ (fixtures/docs excluded), `@deprecated`,
 * hardcoded repo/environment defaults in scripts/, dead exports (import-graph heuristic over
 * tracked .mjs), and file-size hotspots (> 400 lines).
 *
 * Node stdlib only; no test execution, no network.
 *
 * Usage:
 *   node scripts/internal/scan-debt.mjs [--root DIR] [--config FILE] [--json]
 *        [--check] [--render|--write] [--advisory] [--help]
 * Exit: 0 pass/advisory, 1 guard violations, 2 usage error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs, UsageError, jsonOut } from '../adopt/lib/cli.mjs';

export const DEBT_SCHEMA_VERSION = 1;
export const DEBT_CLASSES = [
  'shim',
  'monkey-patch',
  'temp-fix',
  'hardcoded-env',
  'dead-export',
  'duplication',
  'hotspot',
  'todo',
  'coverage',
];
export const DEBT_STATUSES = ['accepted', 'fixed', 'backlog', 'p4'];
export const DEBT_RISKS = ['low', 'medium', 'high'];
export const DEBT_EFFORTS = ['S', 'M', 'L', 'XL'];
export const DEBT_DECISIONS = ['fix-now', 'register', 'p4-backlog', 'remove'];
export const HOTSPOT_THRESHOLD = 400;
export const DEFAULT_REGISTER = path.join('contract', 'debt-register.json');
export const DEFAULT_DOC = path.join('docs', 'TECH_DEBT.md');

const MARKER_PATTERN = /(?:\/\/|#|\/\*|<!--)\s*(TODO|FIXME|HACK|XXX|TEMP|WORKAROUND|MONKEY[- ]PATCH)\b/;
const DEPRECATED_PATTERN = /@deprecated\b/;
const HARDCODED_REPO_PATTERN = /(['"`])(?:presljf|castdeck)\/[^'"`]*\1/;
const EXPORT_PATTERN = /^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm;
const POINTER_PATTERN = /^(.+?):(\d+)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MARKER_SCOPES = ['scripts/', 'tests/', '.github/'];
const CODE_EXTENSIONS = new Set(['.mjs', '.js', '.cjs']);
const EXCLUDED_PREFIXES = ['tests/fixtures/', 'docs/', 'node_modules/', '.git/'];

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function normalize(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

function isExcluded(rel) {
  return EXCLUDED_PREFIXES.some((prefix) => rel === prefix.replace(/\/$/, '') || rel.startsWith(prefix));
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Tracked files (git ls-files) or a deterministic filesystem walk for fixture roots. */
export function listTrackedFiles(root) {
  const absolute = path.resolve(root);
  try {
    const output = execFileSync('git', ['-C', absolute, 'ls-files'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.trim().split('\n').map(normalize).filter(Boolean).sort();
  } catch {
    return walk(absolute)
      .map((file) => normalize(path.relative(absolute, file)))
      .filter(Boolean)
      .sort();
  }
}

function under(rel, scopes) {
  return scopes.some((scope) => (scope.endsWith('/') ? rel.startsWith(scope) : rel === scope));
}

function hasCodeExtension(rel) {
  return CODE_EXTENSIONS.has(path.posix.extname(rel).toLowerCase());
}

function lineCount(root, rel) {
  const text = safeRead(path.join(root, rel));
  if (text === null) return 0;
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

// ---------------------------------------------------------------------------
// Scans (heuristics; deterministic order by pointer)
// ---------------------------------------------------------------------------

function scanMarkers(root, files) {
  const findings = [];
  for (const rel of files) {
    if (!under(rel, MARKER_SCOPES) || isExcluded(rel)) continue;
    if (!hasCodeExtension(rel) && !/\.ya?ml$/.test(rel)) continue;
    const text = safeRead(path.join(root, rel));
    if (text === null) continue;
    text.split(/\r?\n/).forEach((line, index) => {
      const match = MARKER_PATTERN.exec(line);
      if (!match) return;
      findings.push({
        class: 'todo',
        marker: match[1].toUpperCase(),
        pointer: `${rel}:${index + 1}`,
        detail: line.trim(),
        recommendation: 'classify: fix now or register with an owner and expiry',
      });
    });
  }
  return findings;
}

function scanDeprecated(root, files) {
  const findings = [];
  for (const rel of files) {
    if (!rel.startsWith('scripts/') || !hasCodeExtension(rel)) continue;
    // The scanner's own detector regex would otherwise be reported as a shim.
    if (rel === 'scripts/internal/scan-debt.mjs') continue;
    const text = safeRead(path.join(root, rel));
    if (text === null) continue;
    text.split(/\r?\n/).forEach((line, index) => {
      if (!DEPRECATED_PATTERN.test(line)) return;
      findings.push({
        class: 'shim',
        pointer: `${rel}:${index + 1}`,
        detail: line.trim(),
        recommendation: 'remove the alias/shim or register it with owner+expiry (blocking class)',
      });
    });
  }
  return findings;
}

function scanHardcodedEnv(root, files) {
  const findings = [];
  for (const rel of files) {
    if (!rel.startsWith('scripts/') || !hasCodeExtension(rel)) continue;
    const text = safeRead(path.join(root, rel));
    if (text === null) continue;
    text.split(/\r?\n/).forEach((line, index) => {
      if (!HARDCODED_REPO_PATTERN.test(line)) return;
      findings.push({
        class: 'hardcoded-env',
        pointer: `${rel}:${index + 1}`,
        detail: line.trim(),
        recommendation: 'derive the repo from --repo/GITHUB_REPOSITORY/env or register why the literal is intentional',
      });
    });
  }
  return findings;
}

function scanDeadExports(root, files) {
  const texts = new Map();
  for (const rel of files) {
    if (!hasCodeExtension(rel)) continue;
    const text = safeRead(path.join(root, rel));
    if (text !== null) texts.set(rel, text);
  }
  const findings = [];
  for (const [rel, text] of texts) {
    if (!rel.startsWith('scripts/') || !text.includes('export ')) continue;
    for (const match of text.matchAll(EXPORT_PATTERN)) {
      const name = match[1];
      const word = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      let used = false;
      for (const [otherRel, otherText] of texts) {
        if (otherRel === rel) continue;
        if (word.test(otherText)) {
          used = true;
          break;
        }
      }
      if (used) continue;
      const inFile = text.match(word)?.length ?? 1;
      const pointerRel = text.slice(0, match.index).split('\n').length;
      findings.push({
        class: 'dead-export',
        pointer: `${rel}:${pointerRel}`,
        detail: `export ${name} is never imported`,
        recommendation:
          inFile > 1 ? 'drop only the export keyword (still used internally)' : 'delete the unused export',
      });
    }
  }
  return findings;
}

function scanHotspots(root, files) {
  const findings = [];
  for (const rel of files) {
    if (!rel.startsWith('scripts/') || !hasCodeExtension(rel)) continue;
    const lines = lineCount(root, rel);
    if (lines <= HOTSPOT_THRESHOLD) continue;
    findings.push({
      class: 'hotspot',
      pointer: `${rel}:1`,
      detail: `${lines} lines (> ${HOTSPOT_THRESHOLD}); split or register a P4 plan`,
      recommendation: 'P4: split along parser/compare/render or transport boundaries',
      lines,
    });
  }
  return findings;
}

function sortFindings(findings) {
  return [...findings].sort((a, b) => {
    if (a.class !== b.class) return a.class.localeCompare(b.class);
    if (a.pointer !== b.pointer) return a.pointer.localeCompare(b.pointer);
    return String(a.detail).localeCompare(String(b.detail));
  });
}

/** Run all heuristic scans. Pure with respect to the filesystem (read-only). */
export function scanDebtFindings({ root = '.', files = null } = {}) {
  const resolvedRoot = path.resolve(root);
  const tracked = files ? [...files].map(normalize).sort() : listTrackedFiles(resolvedRoot);
  const findings = {
    markers: sortFindings(scanMarkers(resolvedRoot, tracked)),
    shims: sortFindings(scanDeprecated(resolvedRoot, tracked)),
    hardcodedEnv: sortFindings(scanHardcodedEnv(resolvedRoot, tracked)),
    deadExports: sortFindings(scanDeadExports(resolvedRoot, tracked)),
    hotspots: sortFindings(scanHotspots(resolvedRoot, tracked)),
  };
  return findings;
}

// ---------------------------------------------------------------------------
// Register load / validation
// ---------------------------------------------------------------------------

function pointerParts(pointer) {
  const text = String(pointer || '');
  const match = POINTER_PATTERN.exec(text);
  if (match) return { file: match[1], line: Number(match[2]) };
  return { file: text, line: null };
}

function isIsoDate(value) {
  return typeof value === 'string' && DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function todayIso(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function pushEntryError(errors, registerRel, entry, code, message) {
  errors.push({ code, path: `${registerRel}#${entry?.id ?? '?'}`, message });
}

/** Validate the register against the schema and guard policy. */
export function validateDebtRegister({ register, root = '.', now = Date.now(), registerRel = DEFAULT_REGISTER } = {}) {
  const errors = [];
  const resolvedRoot = path.resolve(root);
  if (!register || typeof register !== 'object' || Array.isArray(register)) {
    errors.push({ code: 'DEBT_REGISTER_SCHEMA', path: registerRel, message: 'register must be a JSON object' });
    return { errors, entries: [] };
  }
  if (register.schemaVersion !== DEBT_SCHEMA_VERSION) {
    errors.push({
      code: 'DEBT_REGISTER_SCHEMA',
      path: registerRel,
      message: `schemaVersion must be ${DEBT_SCHEMA_VERSION} (got ${JSON.stringify(register.schemaVersion)})`,
    });
  }
  const policy = register.policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    errors.push({ code: 'DEBT_REGISTER_SCHEMA', path: registerRel, message: 'policy must be an object' });
  } else {
    if (
      !Array.isArray(policy.blockingClasses) ||
      !policy.blockingClasses.every((item) => DEBT_CLASSES.includes(item))
    ) {
      errors.push({
        code: 'DEBT_REGISTER_SCHEMA',
        path: registerRel,
        message: `policy.blockingClasses must be an array drawn from ${DEBT_CLASSES.join(', ')}`,
      });
    }
    if (typeof policy.reviewCadence !== 'string' || !policy.reviewCadence.trim()) {
      errors.push({
        code: 'DEBT_REGISTER_SCHEMA',
        path: registerRel,
        message: 'policy.reviewCadence must be a non-empty string',
      });
    }
    if (policy.coverage !== undefined) {
      const coverage = policy.coverage;
      if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) {
        errors.push({ code: 'DEBT_REGISTER_SCHEMA', path: registerRel, message: 'policy.coverage must be an object' });
      } else {
        for (const key of ['command', 'measuredAt', 'head']) {
          if (typeof coverage[key] !== 'string' || !coverage[key].trim()) {
            errors.push({
              code: 'DEBT_REGISTER_SCHEMA',
              path: registerRel,
              message: `policy.coverage.${key} must be a non-empty string`,
            });
          }
        }
        for (const key of ['lines', 'branches', 'functions']) {
          if (typeof coverage[key] !== 'number' || coverage[key] < 0 || coverage[key] > 100) {
            errors.push({
              code: 'DEBT_REGISTER_SCHEMA',
              path: registerRel,
              message: `policy.coverage.${key} must be a percentage 0-100`,
            });
          }
        }
        if (!isIsoDate(coverage.measuredAt)) {
          errors.push({
            code: 'DEBT_EXPIRY_FORMAT',
            path: registerRel,
            message: 'policy.coverage.measuredAt must be YYYY-MM-DD',
          });
        }
      }
    }
  }
  const entries = Array.isArray(register.entries) ? register.entries : [];
  if (!Array.isArray(register.entries)) {
    errors.push({ code: 'DEBT_REGISTER_SCHEMA', path: registerRel, message: 'entries must be an array' });
  }
  const blockingClasses = Array.isArray(policy?.blockingClasses) ? policy.blockingClasses : [];
  const today = todayIso(now);
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push({ code: 'DEBT_REGISTER_SCHEMA', path: registerRel, message: 'every entry must be an object' });
      continue;
    }
    if (typeof entry.id !== 'string' || !entry.id.trim()) {
      errors.push({ code: 'DEBT_REGISTER_SCHEMA', path: registerRel, message: 'entry.id must be a non-empty string' });
    } else if (seen.has(entry.id)) {
      pushEntryError(errors, registerRel, entry, 'DEBT_ENTRY_DUPLICATE_ID', `duplicate id ${JSON.stringify(entry.id)}`);
    } else {
      seen.add(entry.id);
    }
    if (!DEBT_CLASSES.includes(entry.class)) {
      pushEntryError(
        errors,
        registerRel,
        entry,
        'DEBT_REGISTER_SCHEMA',
        `class must be one of ${DEBT_CLASSES.join(', ')}`,
      );
    }
    if (!DEBT_STATUSES.includes(entry.status)) {
      pushEntryError(
        errors,
        registerRel,
        entry,
        'DEBT_REGISTER_SCHEMA',
        `status must be one of ${DEBT_STATUSES.join(', ')}`,
      );
    }
    if (entry.risk !== undefined && !DEBT_RISKS.includes(entry.risk)) {
      pushEntryError(
        errors,
        registerRel,
        entry,
        'DEBT_REGISTER_SCHEMA',
        `risk must be one of ${DEBT_RISKS.join(', ')}`,
      );
    }
    if (entry.effort !== undefined && !DEBT_EFFORTS.includes(entry.effort)) {
      pushEntryError(
        errors,
        registerRel,
        entry,
        'DEBT_REGISTER_SCHEMA',
        `effort must be one of ${DEBT_EFFORTS.join(', ')}`,
      );
    }
    if (entry.decision !== undefined && !DEBT_DECISIONS.includes(entry.decision)) {
      pushEntryError(
        errors,
        registerRel,
        entry,
        'DEBT_REGISTER_SCHEMA',
        `decision must be one of ${DEBT_DECISIONS.join(', ')}`,
      );
    }
    if (typeof entry.owner !== 'string' || !entry.owner.trim()) {
      pushEntryError(errors, registerRel, entry, 'DEBT_OWNER_MISSING', 'accepted debt requires an owner');
    }
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
      pushEntryError(errors, registerRel, entry, 'DEBT_REASON_MISSING', 'accepted debt requires a reason');
    }
    if (typeof entry.pointer !== 'string' || !entry.pointer.trim()) {
      pushEntryError(
        errors,
        registerRel,
        entry,
        'DEBT_POINTER_MISSING',
        'accepted debt requires a pointer (path:line)',
      );
    }
    if (typeof entry.expiry !== 'string' || !entry.expiry.trim()) {
      pushEntryError(errors, registerRel, entry, 'DEBT_EXPIRY_MISSING', 'accepted debt requires an expiry');
    } else if (!isIsoDate(entry.expiry)) {
      pushEntryError(
        errors,
        registerRel,
        entry,
        'DEBT_EXPIRY_FORMAT',
        `expiry must be YYYY-MM-DD (got ${JSON.stringify(entry.expiry)})`,
      );
    } else if (entry.status !== 'fixed' && entry.expiry < today) {
      pushEntryError(
        errors,
        registerRel,
        entry,
        'DEBT_EXPIRED',
        `expired ${entry.expiry} (today ${today}); fix, remove, or extend with a reason`,
      );
    }
    if (typeof entry.pointer === 'string' && entry.pointer.trim() && entry.status !== 'fixed') {
      const file = pointerParts(entry.pointer).file;
      if (!fs.existsSync(path.join(resolvedRoot, file))) {
        pushEntryError(errors, registerRel, entry, 'DEBT_POINTER_NOT_FOUND', `pointer target does not exist: ${file}`);
      }
    }
    if (blockingClasses.includes(entry.class) && entry.status === 'accepted') {
      const complete =
        typeof entry.owner === 'string' &&
        entry.owner.trim() &&
        typeof entry.expiry === 'string' &&
        isIsoDate(entry.expiry) &&
        typeof entry.reason === 'string' &&
        entry.reason.trim() &&
        typeof entry.pointer === 'string' &&
        entry.pointer.trim();
      if (!complete) {
        pushEntryError(
          errors,
          registerRel,
          entry,
          'DEBT_SHIM_UNLABELED',
          `blocking class ${entry.class} accepted without owner+expiry+reason+pointer`,
        );
      }
    }
  }
  return { errors, entries };
}

/** Blocking-class findings must be registered (accepted/backlog/p4) or already fixed. */
export function validateFindingsRegistered({ register, findings, registerRel = DEFAULT_REGISTER } = {}) {
  const errors = [];
  const policy = register?.policy ?? {};
  const blocking = Array.isArray(policy.blockingClasses) ? policy.blockingClasses : [];
  const entries = Array.isArray(register?.entries) ? register.entries : [];
  const all = [...(findings?.shims ?? []), ...(findings?.markers ?? [])];
  for (const finding of all) {
    if (!blocking.includes(finding.class)) continue;
    const findingFile = pointerParts(finding.pointer).file;
    const registered = entries.some(
      (entry) =>
        entry &&
        entry.class === finding.class &&
        entry.status !== 'fixed' &&
        pointerParts(entry.pointer).file === findingFile,
    );
    if (!registered) {
      errors.push({
        code: 'DEBT_UNREGISTERED_SHIM',
        path: finding.pointer,
        message: `blocking-class finding is not registered (add an entry with owner+expiry or fix it): ${finding.detail}`,
      });
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function templateVersion(root) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'tracker.config.json'), 'utf8'));
    return String(config?.automation?.templateVersion || 'unknown');
  } catch {
    return 'unknown';
  }
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function countBy(entries, key) {
  const counts = {};
  for (const entry of entries) {
    const value = String(entry[key] ?? 'unknown');
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function table(headers, rows) {
  const lines = [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`];
  for (const row of rows) lines.push(`| ${row.map((cell) => String(cell ?? '')).join(' | ')} |`);
  return lines;
}

function expiryBuckets(entries, now = Date.now()) {
  // Coarse buckets only: the generated doc must stay deterministic across days (only an expired
  // entry changes it, and expiry already fails the guard). Near-term windows would make the doc
  // stale on unrelated days.
  const today = todayIso(now);
  const active = entries.filter((entry) => entry.status !== 'fixed');
  const expired = active.filter((entry) => entry.expiry < today);
  const upcoming = active.filter((entry) => entry.expiry >= today);
  const earliest = upcoming.length ? upcoming.map((entry) => entry.expiry).sort()[0] : 'n/a';
  return { total: active.length, expired: expired.length, upcoming: upcoming.length, earliest };
}

/** Deterministic `docs/TECH_DEBT.md` content. */
export function renderTechDebt({ register, root = '.', now = Date.now() } = {}) {
  const entries = sortEntries(Array.isArray(register?.entries) ? register.entries : []);
  const policy = register?.policy ?? {};
  const coverage = policy.coverage ?? null;
  const version = templateVersion(root);
  const byClass = countBy(entries, 'class');
  const byStatus = countBy(entries, 'status');
  const byRisk = countBy(entries, 'risk');
  const buckets = expiryBuckets(entries, now);
  const lines = [
    '# Tech debt register',
    '',
    '> Generated by `node scripts/internal/scan-debt.mjs --render` from `contract/debt-register.json`. Do not edit by hand.',
    `> Target template: v${version}. The register is the single source of truth; see "How to add debt" below.`,
    '',
    '## Summary',
    '',
  ];
  lines.push(
    ...table(
      ['Metric', 'Count'],
      [
        ['Entries', entries.length],
        [
          'By class',
          Object.entries(byClass)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ') || 'none',
        ],
        [
          'By status',
          Object.entries(byStatus)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ') || 'none',
        ],
        [
          'By risk',
          Object.entries(byRisk)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ') || 'none',
        ],
        ['Active entries', buckets.total],
        ['Expired', buckets.expired],
        ['Upcoming', buckets.upcoming],
        ['Earliest expiry', buckets.earliest],
        ['Blocking classes', (policy.blockingClasses ?? []).join(', ') || 'none'],
        ['Review cadence', policy.reviewCadence ?? 'unknown'],
      ],
    ),
  );
  lines.push('', '## Register', '');
  lines.push(
    ...table(
      ['ID', 'Class', 'Status', 'Risk', 'Effort', 'Decision', 'Pointer', 'Owner', 'Expiry', 'Reason'],
      entries.map((entry) => [
        entry.id,
        entry.class,
        entry.status,
        entry.risk ?? '',
        entry.effort ?? '',
        entry.decision ?? '',
        `\`${entry.pointer}\``,
        entry.owner ?? '',
        entry.expiry ?? '',
        entry.reason ?? '',
      ]),
    ),
  );
  const p4 = entries.filter((entry) => entry.status === 'p4');
  lines.push('', '## P4 backlog', '');
  if (!p4.length) lines.push('None.');
  else {
    lines.push(
      ...table(
        ['ID', 'Pointer', 'Risk', 'Effort', 'Owner', 'Expiry', 'Plan'],
        p4.map((entry) => [
          entry.id,
          `\`${entry.pointer}\``,
          entry.risk ?? '',
          entry.effort ?? '',
          entry.owner ?? '',
          entry.expiry ?? '',
          entry.evidence ?? entry.reason ?? '',
        ]),
      ),
    );
  }
  lines.push('', '## Coverage baseline', '');
  if (!coverage) {
    lines.push(
      'No coverage baseline recorded yet. Run the command below once, then add the aggregate to',
      '`policy.coverage` in `contract/debt-register.json` and re-render this page:',
      '',
      '```bash',
      "node --test --experimental-test-coverage --test-coverage-include='scripts/**' tests/*.test.mjs",
      '```',
    );
  } else {
    lines.push(
      'Evidence-only baseline (not a CI gate; no counts-contract conflict — the template does not adopt `docs.counts`).',
      '',
      '```bash',
      coverage.command,
      '```',
      '',
      ...table(
        ['Measured', 'HEAD', 'Lines', 'Branches', 'Functions'],
        [
          [
            coverage.measuredAt,
            coverage.head.slice(0, 12),
            `${coverage.lines.toFixed(2)}%`,
            `${coverage.branches.toFixed(2)}%`,
            `${coverage.functions.toFixed(2)}%`,
          ],
        ],
      ),
    );
  }
  lines.push(
    '',
    '## How to add debt',
    '',
    '1. Run `node scripts/internal/scan-debt.mjs` (advisory) and inspect the findings.',
    '2. Add an entry to `contract/debt-register.json`: `{id, class, pointer, owner, expiry, reason, status, risk, effort, decision, detectedBy}`.',
    '3. Accepted entries must have an owner, an ISO `expiry`, a `reason`, and a `pointer` (`path:line`).',
    '   Blocking classes are shims, monkey patches and temp fixes: never leave one unregistered.',
    '4. Run `node scripts/internal/scan-debt.mjs --render` to refresh this page, then `--check` (CI runs',
    '   the blocking check; expired entries fail the build).',
    '',
  );
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate the debt register. Read-only and deterministic for a fixed `now`.
 * @returns {{ok:boolean, root:string, registerRel:string, register:object|null,
 *   findings:object, errors:Array, counts:object, docRel:string|null}}
 */
export function scanDebt({ root = '.', configPath = null, now = Date.now(), verifyDoc = false, docPath = null } = {}) {
  const resolvedRoot = path.resolve(root);
  const registerPath = configPath ? path.resolve(configPath) : path.join(resolvedRoot, DEFAULT_REGISTER);
  const registerRel = normalize(path.relative(resolvedRoot, registerPath)) || registerPath;
  const resolvedDoc = docPath ? path.resolve(docPath) : path.join(resolvedRoot, DEFAULT_DOC);
  const docRel = normalize(path.relative(resolvedRoot, resolvedDoc)) || resolvedDoc;
  const errors = [];
  const findings = scanDebtFindings({ root: resolvedRoot });
  let register = null;
  if (!fs.existsSync(registerPath)) {
    errors.push({ code: 'DEBT_REGISTER_MISSING', path: registerRel, message: `register not found: ${registerRel}` });
  } else {
    try {
      register = JSON.parse(fs.readFileSync(registerPath, 'utf8'));
    } catch (error) {
      errors.push({
        code: 'DEBT_REGISTER_PARSE',
        path: registerRel,
        message: `cannot parse register JSON: ${error.message}`,
      });
    }
  }
  if (register) {
    const validation = validateDebtRegister({ register, root: resolvedRoot, now, registerRel });
    errors.push(...validation.errors);
    errors.push(...validateFindingsRegistered({ register, findings, registerRel }));
    if (verifyDoc) {
      const rendered = renderTechDebt({ register, root: resolvedRoot, now });
      const current = safeRead(resolvedDoc);
      if (current === null) {
        errors.push({ code: 'DEBT_DOC_MISSING', path: docRel, message: `generated doc missing: ${docRel}` });
      } else if (current !== rendered) {
        errors.push({
          code: 'DEBT_DOC_STALE',
          path: docRel,
          message: 'generated doc is stale; run `node scripts/internal/scan-debt.mjs --render` and commit the result',
        });
      }
    }
  }
  const counts = {
    entries: Array.isArray(register?.entries) ? register.entries.length : 0,
    markers: findings.markers.length,
    shims: findings.shims.length,
    hardcodedEnv: findings.hardcodedEnv.length,
    deadExports: findings.deadExports.length,
    hotspots: findings.hotspots.length,
  };
  return {
    ok: errors.length === 0,
    root: resolvedRoot,
    registerRel,
    register,
    findings,
    errors,
    counts,
    docRel,
  };
}

function advisoryFindings(findings) {
  return [
    ...findings.markers,
    ...findings.shims,
    ...findings.hardcodedEnv,
    ...findings.deadExports,
    ...findings.hotspots,
  ];
}

const USAGE = `Usage: node scripts/internal/scan-debt.mjs [options]

Options:
  --root DIR            Repository root to scan (default: .)
  --config FILE         Register path (default: <root>/contract/debt-register.json)
  --doc FILE            Generated doc path (default: <root>/docs/TECH_DEBT.md)
  --json                Print the machine-readable result
  --check               Blocking guard: expired/unlabeled debt, stale doc, unregistered shims
  --render, --write     Regenerate the doc from the register
  --advisory            Print findings and always exit 0
  --help, -h            Show this help

Exit codes: 0 pass/advisory, 1 guard violations, 2 usage error.`;

function printHuman(result) {
  const findings = advisoryFindings(result.findings);
  console.log(
    `Debt scan — ${findings.length} finding(s): ${result.counts.markers} marker(s), ${result.counts.shims} shim(s), ` +
      `${result.counts.hardcodedEnv} hardcoded-env, ${result.counts.deadExports} dead export(s), ` +
      `${result.counts.hotspots} hotspot(s); register entries: ${result.counts.entries}.`,
  );
  for (const finding of findings) console.log(`  ${finding.class}: ${finding.pointer} — ${finding.detail}`);
  if (result.errors.length) {
    console.error(`Debt guard FAILED (${result.errors.length}):`);
    for (const error of result.errors) console.error(`- ${error.code}: ${error.path}: ${error.message}`);
  } else {
    console.log('Debt register OK — no expired, unlabeled, or unregistered blocking debt.');
  }
}

function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv, {
      flags: ['json', 'check', 'render', 'write', 'advisory', 'help'],
      options: ['root', 'config', 'doc'],
    });
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`error: ${error.message}`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  const root = parsed.root ?? '.';
  const renderMode = Boolean(parsed.render || parsed.write);
  const checkMode = Boolean(parsed.check);
  const result = scanDebt({
    root,
    configPath: parsed.config ?? null,
    verifyDoc: checkMode,
    docPath: parsed.doc ?? null,
  });
  if (renderMode) {
    if (!result.register) {
      for (const error of result.errors) console.error(`- ${error.code}: ${error.path}: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    const rendered = renderTechDebt({ register: result.register, root: result.root });
    const docPath = parsed.doc ?? path.join(result.root, DEFAULT_DOC);
    fs.mkdirSync(path.dirname(docPath), { recursive: true });
    fs.writeFileSync(docPath, rendered);
    console.log(`Rendered ${normalize(path.relative(result.root, docPath))} from ${result.registerRel}.`);
    return;
  }
  if (parsed.json) {
    jsonOut({
      schemaVersion: DEBT_SCHEMA_VERSION,
      ok: result.ok,
      root: result.root,
      register: result.registerRel,
      doc: result.docRel,
      counts: result.counts,
      errors: result.errors,
      findings: result.findings,
    });
  } else {
    printHuman(result);
  }
  if (checkMode && !result.ok) process.exitCode = 1;
}

const isMain = process.argv[1] && process.argv[1].endsWith('scan-debt.mjs');
if (isMain) main();
