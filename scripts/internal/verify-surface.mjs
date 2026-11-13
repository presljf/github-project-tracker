#!/usr/bin/env node
/**
 * Repo-surface guard: enforce contract/repo-surface.json and the class-first repository surface.
 *
 * Rules (blocking):
 *   - manifest schema + every classified path exists (status: shipped) / is absent (contract-only)
 *   - every file under scope.classify is classified exactly once
 *   - `workflow_call` present iff the workflow filename is reusable-*.yml
 *   - `.github/workflows` keeps only internal runners + reusable-*; release.yml is the only
 *     runnable release caller
 *   - copy-mode class only under profiles/ and (for YAML) carries a `COPY-MODE EXAMPLE` header
 *   - catalog reusable claims match the manifest; reusable workflows/actions are documented;
 *     the generated `surface-status` block matches renderCatalogStatusBlock(entries) exactly
 *     (tolerant prose parser kept as the pre-migration fallback)
 *   - manifest docs anchors resolve (same heading-slug algorithm as check-docs.mjs)
 *   - generated entries live under generatedRoots and declare an existing generatedBy script
 * Advisory (warnings; fail only with --strict):
 *   - unclassified docs file, unexpected COPY-MODE header, generated HTML missing its marker,
 *     adopter code importing internal code, npm alias drift, stale catalog §7 documentation
 *
 * CLI: node scripts/internal/verify-surface.mjs [--root DIR] [--manifest FILE] [--json]
 *        [--strict] [--require-manifest] [--help]
 * Exit: 0 pass (warnings allowed unless --strict); 1 violations; 2 usage error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, UsageError, jsonOut } from '../adopt/lib/cli.mjs';
import {
  AUDIENCES,
  CATALOG_STATUS_END_MARKER,
  CATALOG_STATUS_START_MARKER,
  CLASSES,
  STATUSES,
  renderCatalogStatusBlock,
} from './surface-shared.mjs';

export { AUDIENCES, CLASSES, STATUSES };

export const SURFACE_SCHEMA_VERSION = 1;

const DEFAULT_SCOPE_CLASSIFY = [
  '.github/workflows/',
  '.github/actions/',
  'profiles/',
  'scripts/',
  'docs/',
  'contract/',
];
const SKIP_DIRS = new Set(['.git', 'node_modules']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** GitHub heading slug, identical to scripts/adopt/docs/check-docs.mjs. */
export function slugHeading(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\w\s-]/gu, '')
    .replace(/\s+/g, '-');
}

const anchorCache = new Map();
/** Heading anchors of a Markdown file (cached). */
export function collectAnchors(file) {
  const key = path.resolve(file);
  if (anchorCache.has(key)) return anchorCache.get(key);
  const anchors = new Set();
  for (const line of fs.readFileSync(key, 'utf8').split(/\r?\n/)) {
    const match = /^#{1,6}\s+(.*)$/.exec(line);
    if (match) anchors.add(slugHeading(match[1]));
  }
  anchorCache.set(key, anchors);
  return anchors;
}

function normalizePath(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}
function isSafeRelative(value) {
  const normalized = normalizePath(value);
  return normalized !== '' && !normalized.startsWith('/') && !normalized.split('/').includes('..');
}
function asArray(value) {
  return Array.isArray(value) ? value : [];
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function existsFile(root, rel) {
  try {
    return fs.statSync(path.join(root, rel)).isFile();
  } catch {
    return false;
  }
}
function readText(root, rel) {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return null;
  }
}
function walk(root, prefix, out = []) {
  const rel = normalizePath(prefix);
  const absolute = path.join(root, rel);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    return out;
  }
  if (!stat.isDirectory()) {
    out.push(rel);
    return out;
  }
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const child = `${rel.replace(/\/+$/, '')}/${entry.name}`;
    if (entry.isDirectory()) walk(root, child, out);
    else if (entry.isFile()) out.push(child);
  }
  return out;
}
function basename(rel) {
  return rel.split('/').pop();
}
function basenameStem(rel) {
  return basename(rel).replace(/\.(ya?ml|mjs|json|md|html|pdf)$/i, '');
}
function entryPaths(entry) {
  if (typeof entry.path === 'string') return [normalizePath(entry.path)];
  return asArray(entry.paths).map(normalizePath);
}
function sectionBetween(text, startPattern, endPattern) {
  const start = text.search(startPattern);
  if (start < 0) return null;
  const rest = text.slice(start);
  const end = rest.search(endPattern);
  return end < 0 ? rest : rest.slice(0, end);
}
// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

function validateManifestShape(manifest, file, errors) {
  const fail = (message, entryId) =>
    errors.push({
      code: 'SURFACE_MANIFEST_SCHEMA',
      severity: 'error',
      path: entryId ? `${file}#${entryId}` : file,
      message,
    });
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('manifest must be a JSON object');
    return false;
  }
  if (manifest.schemaVersion !== SURFACE_SCHEMA_VERSION) {
    fail(`schemaVersion must be ${SURFACE_SCHEMA_VERSION} (got ${JSON.stringify(manifest.schemaVersion)})`);
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    fail('entries must be a non-empty array');
    return false;
  }
  if (manifest.generatedRoots !== undefined && !Array.isArray(manifest.generatedRoots)) {
    fail('generatedRoots must be an array of path prefixes');
  }
  const scope = manifest.scope;
  if (scope !== undefined && (typeof scope !== 'object' || scope === null)) fail('scope must be an object');
  if (scope?.classify !== undefined && !Array.isArray(scope.classify)) fail('scope.classify must be an array');
  if (scope?.exclude !== undefined && !Array.isArray(scope.exclude)) fail('scope.exclude must be an array');

  const seenIds = new Set();
  const seenPaths = new Map();
  let ok = true;
  for (const [index, entry] of manifest.entries.entries()) {
    const label = typeof entry?.id === 'string' ? entry.id : `entries[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail('entry must be an object', label);
      ok = false;
      continue;
    }
    if (typeof entry.id !== 'string' || !entry.id.trim()) fail('id must be a non-empty string', label);
    else if (seenIds.has(entry.id)) fail(`duplicate id ${JSON.stringify(entry.id)}`, label);
    else seenIds.add(entry.id);

    if (!CLASSES.includes(entry.class)) fail(`class must be one of ${CLASSES.join(', ')}`, label);
    if (!STATUSES.includes(entry.status)) fail(`status must be one of ${STATUSES.join(', ')}`, label);

    const hasPath = typeof entry.path === 'string' && entry.path.trim() !== '';
    const hasPaths = Array.isArray(entry.paths) && entry.paths.length > 0;
    if (hasPath === hasPaths) fail('exactly one of path (string) or paths (non-empty array) is required', label);
    for (const rel of entryPaths(entry)) {
      if (!isSafeRelative(rel)) {
        fail(`path must be a safe repository-relative path (got ${JSON.stringify(rel)})`, label);
        ok = false;
        continue;
      }
      if (seenPaths.has(rel) && seenPaths.get(rel) !== entry.id) {
        fail(`duplicate path ${rel} (also classified by ${seenPaths.get(rel)})`, label);
      } else seenPaths.set(rel, entry.id);
    }
    if (entry.class === 'generated' && typeof entry.generatedBy !== 'string') {
      fail('generated entries require generatedBy (the documented generator command)', label);
    }
    if (entry.class === 'copy-mode') {
      if (entry.mode !== undefined && !['reusable', 'copy'].includes(entry.mode)) {
        fail('copy-mode mode must be "reusable" or "copy"', label);
      }
      if (entry.header !== undefined && !['required', 'none', 'optional'].includes(entry.header)) {
        fail('copy-mode header must be "required", "none" or "optional"', label);
      }
      for (const rel of entryPaths(entry)) {
        if (/\.ya?ml$/.test(rel) && entry.header === undefined) {
          fail('copy-mode YAML entries must declare header: "required" or "none" (headers are enforced)', label);
        }
      }
    } else if (entry.mode !== undefined || entry.header !== undefined) {
      fail('mode/header are only valid on copy-mode entries', label);
    }
    if (
      entry.aliases !== undefined &&
      !(Array.isArray(entry.aliases) && entry.aliases.every((a) => typeof a === 'string'))
    ) {
      fail('aliases must be an array of strings', label);
    }
    if (
      entry.audience !== undefined &&
      !(Array.isArray(entry.audience) && entry.audience.every((a) => AUDIENCES.includes(a)))
    ) {
      fail(`audience must be an array drawn from ${AUDIENCES.join(', ')}`, label);
    }
    if (typeof entry.title !== 'string' || !entry.title.trim()) fail('title must be a non-empty string', label);
    if (typeof entry.summary !== 'string' || !entry.summary.trim()) fail('summary must be a non-empty string', label);
    if (entry.docs !== undefined && !(Array.isArray(entry.docs) && entry.docs.every((d) => typeof d === 'string'))) {
      fail('docs must be an array of "path" or "path#anchor" strings', label);
    }
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Location rules
// ---------------------------------------------------------------------------

/** Classes permitted at a classified path (null = not part of the classified surface). */
export function allowedClasses(rel, generatedRoots = []) {
  const generated = generatedRoots.some(
    (prefix) => rel === normalizePath(prefix) || rel.startsWith(normalizePath(prefix)),
  );
  if (generated) return ['generated', 'internal'];
  if (/^\.github\/workflows\//.test(rel)) {
    return /^reusable-[^/]+\.ya?ml$/.test(basename(rel)) ? ['reusable-workflow'] : ['internal'];
  }
  if (/^\.github\/actions\/[^/]+\/action\.ya?ml$/.test(rel)) return ['reusable-action'];
  if (/^\.github\/actions\//.test(rel)) return ['internal'];
  if (rel.startsWith('profiles/')) return /\.md$/.test(rel) ? ['internal'] : ['copy-mode'];
  if (rel.startsWith('scripts/adopt/cli/') || rel.startsWith('scripts/adopt/docs/')) return ['adopter-cli'];
  if (rel.startsWith('scripts/adopt/lib/')) return ['adopter-lib'];
  if (rel.startsWith('scripts/internal/')) return ['internal'];
  if (rel.startsWith('docs/')) return ['internal'];
  if (rel.startsWith('contract/')) return ['internal'];
  return null;
}

// ---------------------------------------------------------------------------
// YAML trigger parsing (tolerant, dependency-free)
// ---------------------------------------------------------------------------

function stripYamlComments(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/** Extract the top-level `on:` block: {found, workflowCall, triggers}. */
export function workflowCallInfo(text) {
  const lines = stripYamlComments(text).split(/\r?\n/);
  const start = lines.findIndex((line) => /^on\s*:/.test(line));
  if (start < 0) return { found: false, workflowCall: false, triggers: [] };
  const inline = /^on\s*:\s*\[(.*)\]\s*$/.exec(lines[start]);
  if (inline) {
    const triggers = inline[1]
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    return { found: true, workflowCall: triggers.includes('workflow_call'), triggers };
  }
  const triggers = [];
  let workflowCall = /^on\s*:\s*workflow_call\s*$/.test(lines[start]);
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (!/^\s/.test(line)) break; // left the top-level block
    const key = /^ {2}([A-Za-z_][\w-]*)\s*:/.exec(line);
    if (key) {
      triggers.push(key[1]);
      if (key[1] === 'workflow_call') workflowCall = true;
    }
  }
  return { found: true, workflowCall, triggers };
}

// ---------------------------------------------------------------------------
// Catalog claim matching (tolerant)
// ---------------------------------------------------------------------------

function resolveEntryByName(entries, token) {
  const normalized = String(token).replace(/^`|`$/g, '');
  const stem = normalized.replace(/\.ya?ml$/, '');
  for (const entry of entries) {
    for (const rel of entryPaths(entry)) {
      if (basename(rel) === normalized || basenameStem(rel) === stem) return entry;
    }
    if (
      entry.id === normalized ||
      String(entry.id).endsWith(`:${normalized}`) ||
      String(entry.id).endsWith(`:${stem}`)
    ) {
      return entry;
    }
    if (asArray(entry.aliases).includes(normalized) || asArray(entry.aliases).includes(stem)) return entry;
  }
  return null;
}

function backtickedTokens(text, { depthZeroOnly = false } = {}) {
  const out = [];
  const source = String(text);
  let depth = 0;
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '`') {
      const end = source.indexOf('`', index + 1);
      if (end < 0) break;
      const token = source.slice(index + 1, end).trim();
      if (token && (!depthZeroOnly || depth === 0)) out.push(token);
      index = end + 1;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')' && depth > 0) depth -= 1;
    index += 1;
  }
  return out;
}

function isWorkflowToken(token) {
  return /^[a-z0-9][a-z0-9-]*\.ya?ml$/i.test(token) || /^[a-z0-9][a-z0-9-]*$/i.test(token);
}

/** Extract the generated availability block (including markers); null when absent or malformed. */
export function extractCatalogStatusBlock(text) {
  const source = String(text ?? '');
  const start = source.indexOf(CATALOG_STATUS_START_MARKER);
  if (start < 0) return null;
  const end = source.indexOf(CATALOG_STATUS_END_MARKER, start + CATALOG_STATUS_START_MARKER.length);
  if (end < 0) return null;
  return source.slice(start, end + CATALOG_STATUS_END_MARKER.length);
}

/** Normalize a generated block for exact comparison (CRLF + trailing-whitespace insensitive). */
export function normalizeCatalogStatusBlock(block) {
  return String(block ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}

function catalogChecks({ root, entries, errors, warnings, notes }) {
  const rel = 'docs/ACTIONS_CATALOG.md';
  const text = readText(root, rel);
  if (text === null) {
    notes.push(`${rel} not found; catalog claims/mismatch/§7 rules skipped`);
    return;
  }
  // 1. Catalog reusable claims must match the manifest.
  const reusableTokens = new Set([...text.matchAll(/`(reusable-[a-z0-9-]+\.ya?ml)`/g)].map((match) => match[1]));
  for (const token of reusableTokens) {
    if (!resolveEntryByName(entries, token)) {
      errors.push({
        code: 'SURFACE_CATALOG_CLAIM_MISSING',
        severity: 'error',
        path: rel,
        message: `catalog claims ${token} but no manifest entry classifies it`,
      });
    }
  }
  // 2. Reusable workflows/actions documented in catalog §7 (tolerant across catalog rewrites).
  const section7 = sectionBetween(text, /^## 7\./m, /^## 8\./m) ?? '';
  for (const entry of entries.filter((item) => ['reusable-workflow', 'reusable-action'].includes(item.class))) {
    const base = basename(entryPaths(entry)[0] ?? '');
    if (!base) continue;
    const inCatalog = text.includes(base);
    const sectionNumber = typeof entry.catalogSection === 'string' ? entry.catalogSection : null;
    const sectionHeading =
      sectionNumber !== null
        ? section7.split('\n').some((line) => {
            const heading = /^#{3,4}\s+(\S+)/.exec(line);
            return Boolean(heading) && heading[1] === sectionNumber;
          })
        : false;
    const inSection = section7 !== '' && (section7.includes(base) || sectionHeading);
    const inAnchoredDocs = asArray(entry.docs).some((ref) => {
      const [file] = String(ref).split('#');
      if (normalizePath(file) === rel) return false;
      const other = readText(root, file);
      return Boolean(other && other.includes(base));
    });
    if (!inCatalog && !inSection && !inAnchoredDocs) {
      errors.push({
        code: 'SURFACE_REUSABLE_UNDOCUMENTED',
        severity: 'error',
        path: entryPaths(entry)[0],
        message: `${base} is not documented in docs/ACTIONS_CATALOG.md §7 (or its mapped docs)`,
      });
    } else if (sectionNumber !== null && !inSection) {
      errors.push({
        code: 'SURFACE_REUSABLE_UNDOCUMENTED',
        severity: 'error',
        path: entryPaths(entry)[0],
        message: `${base} declares catalogSection ${sectionNumber} but docs/ACTIONS_CATALOG.md §7 has no such contract section`,
      });
    }
  }
  // 3. Generated availability block: exact comparison with the shared renderer.
  //    The tolerant prose parser below is kept only as a pre-migration fallback (catalogs that
  //    do not yet carry the generated block) so T01 fixtures/catalogs stay green.
  const generatedBlock = extractCatalogStatusBlock(text);
  if (generatedBlock !== null) {
    const expectedBlock = renderCatalogStatusBlock(entries);
    if (normalizeCatalogStatusBlock(generatedBlock) !== normalizeCatalogStatusBlock(expectedBlock)) {
      errors.push({
        code: 'SURFACE_CATALOG_STATUS_BLOCK_DRIFT',
        severity: 'error',
        path: rel,
        message:
          'catalog surface-status block drifted from contract/repo-surface.json; run `npm run surface:render` and refresh the block from renderCatalogStatusBlock(entries)',
      });
    }
    return;
  }
  notes.push(
    'catalog generated surface-status block not found; using tolerant shipped-vs-contract-only parser (fallback)',
  );
  // 3b. Tolerant fallback: hand-written shipped-vs-contract-only prose claims must agree with
  //     the manifest. Kept for catalogs that predate the generated block.
  const markerLine = text.split(/\r?\n/).find((line) => /shipped vs contract-only/i.test(line));
  if (!markerLine) {
    notes.push('catalog status paragraph not found; SURFACE_CATALOG_STATUS_MISMATCH skipped (tolerant)');
    return;
  }
  // Start after the "shipped:" keyword so the paragraph's own "Shipped vs contract-only:" title
  // is not mistaken for the contract-only clause.
  const shippedIndex = markerLine.search(/\bshipped\s*:/i);
  const fromShipped = shippedIndex >= 0 ? markerLine.slice(shippedIndex) : markerLine;
  const contractIndex = fromShipped.search(/contract-only\s*:/i);
  const clauses = [
    { expected: 'shipped', text: contractIndex >= 0 ? fromShipped.slice(0, contractIndex) : fromShipped },
    { expected: 'contract-only', text: contractIndex >= 0 ? fromShipped.slice(contractIndex) : '' },
  ];
  if (contractIndex < 0)
    notes.push('catalog status paragraph lacks a Contract-only clause; only shipped claims checked');
  for (const clause of clauses) {
    // Parenthetical explanations (e.g. "(CI setup/cache is inlined in `reusable-ci.yml`)") are
    // context, not status claims, so only depth-0 backticked tokens are treated as claims.
    for (const token of backtickedTokens(clause.text, { depthZeroOnly: true })) {
      if (!isWorkflowToken(token)) continue;
      const entry = resolveEntryByName(entries, token);
      if (!entry) continue; // caller filenames for adopters are not template artifacts; tolerated
      if (entry.status !== clause.expected) {
        errors.push({
          code: 'SURFACE_CATALOG_STATUS_MISMATCH',
          severity: 'error',
          path: rel,
          message: `catalog lists ${token} as ${clause.expected} but manifest status is ${entry.status}`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Docs anchors / generated / alias / import checks
// ---------------------------------------------------------------------------

function docsAnchorChecks({ root, entries, errors }) {
  for (const entry of entries) {
    for (const ref of asArray(entry.docs)) {
      const [file, anchor] = String(ref).split('#');
      const rel = normalizePath(file);
      if (!existsFile(root, rel)) {
        errors.push({
          code: 'SURFACE_DOC_ANCHOR_MISSING',
          severity: 'error',
          path: entryPaths(entry)[0],
          message: `docs reference ${ref} points at a missing file (${rel})`,
        });
        continue;
      }
      if (!anchor) continue;
      if (!/\.md$/i.test(rel)) {
        errors.push({
          code: 'SURFACE_DOC_ANCHOR_MISSING',
          severity: 'error',
          path: entryPaths(entry)[0],
          message: `docs reference ${ref} uses an anchor on a non-Markdown file`,
        });
        continue;
      }
      let anchors;
      try {
        anchors = collectAnchors(path.join(root, rel));
      } catch (error) {
        errors.push({
          code: 'SURFACE_DOC_ANCHOR_MISSING',
          severity: 'error',
          path: entryPaths(entry)[0],
          message: `docs reference ${ref} could not be read: ${error.message}`,
        });
        continue;
      }
      if (!anchors.has(decodeURIComponent(anchor))) {
        errors.push({
          code: 'SURFACE_DOC_ANCHOR_MISSING',
          severity: 'error',
          path: entryPaths(entry)[0],
          message: `docs reference ${ref} anchor #${anchor} does not match any heading`,
        });
      }
    }
  }
}

function generatedChecks({ root, manifest, entries, warnings }) {
  const generatedRoots = asArray(manifest.generatedRoots).map(normalizePath);
  const classified = new Set(entries.filter((e) => e.class === 'generated').flatMap(entryPaths));
  for (const entry of entries.filter((item) => item.class === 'generated')) {
    const command = String(entry.generatedBy ?? '').trim();
    if (!command) continue;
    const script = command.split(/\s+/)[0];
    if (script.startsWith('scripts/')) {
      const known = entries.some((item) => entryPaths(item).includes(normalizePath(script)));
      if (!known || !existsFile(root, normalizePath(script))) {
        warnings.push({
          code: 'SURFACE_GENERATED_PROVENANCE',
          severity: 'warning',
          path: entryPaths(entry)[0],
          message: `generatedBy script ${script} is not a classified, existing script`,
        });
      }
    }
    for (const rel of entryPaths(entry)) {
      if (!/\.html$/i.test(rel)) continue;
      const text = readText(root, rel);
      if (text !== null && !text.includes('Generated by')) {
        warnings.push({
          code: 'SURFACE_GENERATED_PROVENANCE',
          severity: 'warning',
          path: rel,
          message: 'generated HTML lacks a "Generated by" provenance marker',
        });
      }
    }
  }
  for (const root_ of generatedRoots) {
    for (const rel of walk(root, root_)) {
      if (!classified.has(rel) && !entries.some((entry) => entryPaths(entry).includes(rel))) {
        warnings.push({
          code: 'SURFACE_GENERATED_UNCLASSIFIED',
          severity: 'warning',
          path: rel,
          message: `file under generatedRoots is not listed by a generated entry`,
        });
      }
    }
  }
}

function aliasChecks({ root, entries, warnings }) {
  let pkg;
  try {
    pkg = readJson(path.join(root, 'package.json'));
  } catch {
    return;
  }
  const scripts = pkg?.scripts ?? {};
  for (const entry of entries) {
    for (const alias of asArray(entry.aliases)) {
      const command = scripts[alias];
      if (typeof command !== 'string') {
        warnings.push({
          code: 'SURFACE_ALIAS_DRIFT',
          severity: 'warning',
          path: 'package.json',
          message: `manifest alias ${alias} is not defined in package.json scripts`,
        });
        continue;
      }
      if (entryPaths(entry).some((rel) => command.includes(rel))) continue;
      warnings.push({
        code: 'SURFACE_ALIAS_DRIFT',
        severity: 'warning',
        path: 'package.json',
        message: `alias ${alias} does not invoke the classified path ${entryPaths(entry)[0]}`,
      });
    }
  }
}

function importDirectionChecks({ root, entries, warnings }) {
  for (const entry of entries.filter((item) => ['adopter-cli', 'adopter-lib'].includes(item.class))) {
    const rel = entryPaths(entry)[0];
    const text = readText(root, rel);
    if (text === null) continue;
    const fromDir = path.posix.dirname(rel);
    for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const spec = match[1];
      if (!spec.startsWith('.')) continue;
      const resolved = normalizePath(path.posix.normalize(path.posix.join(fromDir, spec)));
      if (resolved.startsWith('scripts/internal/')) {
        warnings.push({
          code: 'SURFACE_IMPORT_DIRECTION',
          severity: 'warning',
          path: rel,
          message: `adopter code imports internal code (${resolved})`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate the repo surface against a manifest. Pure with respect to the filesystem (read-only).
 * @returns {{ok: boolean, root: string, manifest: string|null, skipped?: string, counts: object,
 *   errors: Array, warnings: Array, notes: string[]}}
 */
export function verifySurface({
  root = '.',
  manifestPath = null,
  requireManifest = false,
  strict = false,
  catalogPath = null,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedManifest = manifestPath
    ? path.resolve(manifestPath)
    : path.join(resolvedRoot, 'contract', 'repo-surface.json');
  const manifestRel = normalizePath(path.relative(resolvedRoot, resolvedManifest)) || resolvedManifest;
  const errors = [];
  const warnings = [];
  const notes = [];

  if (!fs.existsSync(resolvedManifest)) {
    if (!requireManifest) {
      return {
        ok: true,
        root: resolvedRoot,
        manifest: null,
        skipped: 'manifest-missing',
        counts: { entries: 0, shipped: 0, contractOnly: 0, classifiedFiles: 0 },
        errors,
        warnings,
        notes: [`surface guard skipped — ${manifestRel} not found (not a surface-managed root)`],
      };
    }
    errors.push({
      code: 'SURFACE_MANIFEST_PARSE',
      severity: 'error',
      path: manifestRel,
      message: `required manifest not found: ${manifestRel}`,
    });
    return {
      ok: false,
      root: resolvedRoot,
      manifest: manifestRel,
      counts: { entries: 0, shipped: 0, contractOnly: 0, classifiedFiles: 0 },
      errors,
      warnings,
      notes,
    };
  }

  let manifest;
  try {
    manifest = readJson(resolvedManifest);
  } catch (error) {
    errors.push({
      code: 'SURFACE_MANIFEST_PARSE',
      severity: 'error',
      path: manifestRel,
      message: `cannot parse manifest JSON: ${error.message}`,
    });
    return {
      ok: false,
      root: resolvedRoot,
      manifest: manifestRel,
      counts: { entries: 0, shipped: 0, contractOnly: 0, classifiedFiles: 0 },
      errors,
      warnings,
      notes,
    };
  }

  const shapeOk = validateManifestShape(manifest, manifestRel, errors);
  const entries = Array.isArray(manifest.entries) ? manifest.entries.filter((e) => e && typeof e === 'object') : [];
  const generatedRoots = asArray(manifest.generatedRoots).map(normalizePath);
  const scope = manifest.scope ?? {};
  const classify = asArray(scope.classify).length ? asArray(scope.classify).map(normalizePath) : DEFAULT_SCOPE_CLASSIFY;
  const exclude = asArray(scope.exclude).map(normalizePath);

  const isExcluded = (rel) =>
    exclude.some((prefix) => rel === prefix || rel.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));

  // 1. Manifest -> filesystem (status semantics) + class/location rules.
  const classifiedFiles = new Set();
  for (const entry of entries) {
    for (const rel of entryPaths(entry)) {
      classifiedFiles.add(rel);
      const absolute = path.join(resolvedRoot, rel);
      const exists = fs.existsSync(absolute);
      if (entry.status === 'shipped' && !exists) {
        errors.push({
          code: 'SURFACE_MANIFEST_MISSING_FILE',
          severity: 'error',
          path: rel,
          message: `manifest entry ${entry.id} is shipped but the file does not exist`,
        });
      }
      if (entry.status === 'contract-only' && exists) {
        errors.push({
          code: 'SURFACE_CONTRACT_ONLY_PRESENT',
          severity: 'error',
          path: rel,
          message: `manifest entry ${entry.id} is contract-only but the file now exists; flip status to shipped`,
        });
      }
      const allowed = allowedClasses(rel, generatedRoots);
      if (allowed && !allowed.includes(entry.class)) {
        if (entry.class === 'copy-mode' && !rel.startsWith('profiles/')) {
          errors.push({
            code: 'SURFACE_COPY_MODE_NOT_PROFILE',
            severity: 'error',
            path: rel,
            message: `copy-mode templates must live under profiles/ (got ${rel})`,
          });
        } else {
          errors.push({
            code: 'SURFACE_CLASS_PATH_MISMATCH',
            severity: 'error',
            path: rel,
            message: `class ${entry.class} is not valid at this path (expected ${allowed.join(' or ')})`,
          });
        }
      }
      if (entry.class === 'copy-mode') {
        if (exists && /\.ya?ml$/.test(rel) && entry.header === 'required') {
          const raw = readText(resolvedRoot, rel) ?? '';
          const first = raw.split(/\r?\n/).find((line) => line.trim() !== '');
          if (!first || !/^#\s*COPY-MODE EXAMPLE\b/.test(first.trim())) {
            errors.push({
              code: 'SURFACE_COPY_MODE_HEADER',
              severity: 'error',
              path: rel,
              message: 'copy-mode YAML must start with a "# COPY-MODE EXAMPLE" header line',
            });
          }
        }
      } else if (
        exists &&
        /\.ya?ml$/.test(rel) &&
        /^#\s*COPY-MODE EXAMPLE\b/m.test(readText(resolvedRoot, rel) ?? '')
      ) {
        warnings.push({
          code: 'SURFACE_COPY_HEADER_UNEXPECTED',
          severity: 'warning',
          path: rel,
          message: 'non-copy-mode YAML carries a COPY-MODE EXAMPLE header',
        });
      }
    }
  }

  // 2. Filesystem -> manifest (every classified file has exactly one entry).
  for (const prefix of classify) {
    for (const rel of walk(resolvedRoot, prefix)) {
      if (isExcluded(rel)) continue;
      const generated = generatedRoots.some((root_) => rel === root_ || rel.startsWith(root_));
      if (classifiedFiles.has(rel)) continue;
      const isDocs = rel.startsWith('docs/');
      if (isDocs) {
        warnings.push({
          code: 'SURFACE_DOCS_UNCLASSIFIED',
          severity: 'warning',
          path: rel,
          message: 'documentation file is not classified in contract/repo-surface.json',
        });
        continue;
      }
      if (generated) {
        warnings.push({
          code: 'SURFACE_GENERATED_UNCLASSIFIED',
          severity: 'warning',
          path: rel,
          message: 'generated file is not listed by a manifest entry',
        });
        continue;
      }
      errors.push({
        code: 'SURFACE_UNCLASSIFIED_FILE',
        severity: 'error',
        path: rel,
        message: 'file is not classified in contract/repo-surface.json (add an entry or exclude it)',
      });
    }
  }

  // 3. Workflow trigger rules.
  for (const rel of walk(resolvedRoot, '.github/workflows')) {
    if (isExcluded(rel)) continue;
    if (!/\.ya?ml$/.test(rel)) continue;
    const text = readText(resolvedRoot, rel) ?? '';
    const info = workflowCallInfo(text);
    const reusableName = /^reusable-[^/]+\.ya?ml$/.test(basename(rel));
    if (!info.found) {
      errors.push({
        code: 'SURFACE_WORKFLOW_CALL_INVALID',
        severity: 'error',
        path: rel,
        message: 'workflow has no top-level on: block; cannot determine its trigger contract',
      });
      continue;
    }
    if (info.workflowCall && !reusableName) {
      errors.push({
        code: 'SURFACE_WORKFLOW_CALL_INVALID',
        severity: 'error',
        path: rel,
        message: "contains 'workflow_call' but filename is not reusable-*.yml",
      });
    }
    if (reusableName && !info.workflowCall) {
      errors.push({
        code: 'SURFACE_REUSABLE_MISSING_WORKFLOW_CALL',
        severity: 'error',
        path: rel,
        message: "reusable-* workflow must be workflow_call only (missing 'on: workflow_call')",
      });
    }
    if (/^release-.+\.ya?ml$/.test(basename(rel))) {
      errors.push({
        code: 'SURFACE_RELEASE_CALLERS',
        severity: 'error',
        path: rel,
        message:
          'release example callers must live under profiles/release/; .github/workflows keeps only release.yml runnable',
      });
    }
  }

  // 4. Catalog claims/status/documentation.
  const catalogRel = catalogPath ? path.resolve(catalogPath) : path.join(resolvedRoot, 'docs', 'ACTIONS_CATALOG.md');
  if (fs.existsSync(catalogRel)) {
    catalogChecks({ root: resolvedRoot, entries, errors, warnings, notes });
  } else {
    notes.push('docs/ACTIONS_CATALOG.md not found; catalog rules skipped');
  }

  // 5. Docs anchors, generated provenance, aliases, import direction.
  docsAnchorChecks({ root: resolvedRoot, entries, errors });
  generatedChecks({ root: resolvedRoot, manifest, entries, warnings });
  aliasChecks({ root: resolvedRoot, entries, warnings });
  importDirectionChecks({ root: resolvedRoot, entries, warnings });

  const counts = {
    entries: entries.length,
    shipped: entries.filter((entry) => entry.status === 'shipped').length,
    contractOnly: entries.filter((entry) => entry.status === 'contract-only').length,
    classifiedFiles: classifiedFiles.size,
  };
  const ok = errors.length === 0 && (!strict || warnings.length === 0);
  if (!shapeOk && errors.length === 0) {
    // Defensive: shape validation should always emit at least one error.
    errors.push({
      code: 'SURFACE_MANIFEST_SCHEMA',
      severity: 'error',
      path: manifestRel,
      message: 'manifest schema validation failed',
    });
  }
  return { ok, root: resolvedRoot, manifest: manifestRel, counts, errors, warnings, notes };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/internal/verify-surface.mjs [options]

Options:
  --root DIR            Repository root to verify (default: .)
  --manifest FILE       Manifest path (default: <root>/contract/repo-surface.json)
  --json                Print the machine-readable result as JSON
  --strict              Treat warnings as failures
  --require-manifest    Fail when the manifest is missing (tracker CI mode)
  --help, -h            Show this help

Exit codes: 0 pass/skip, 1 violations (or warnings with --strict), 2 usage error.`;

function printHuman(result, strict) {
  for (const note of result.notes) console.log(note);
  for (const warning of result.warnings) console.error(`warning: ${warning.code}: ${warning.path}: ${warning.message}`);
  if (result.skipped) {
    console.log(`Surface guard skipped — ${result.notes[0] ?? result.skipped}.`);
    return;
  }
  if (result.ok) {
    const { entries, shipped, contractOnly, classifiedFiles } = result.counts;
    console.log(
      `Surface guard OK — ${entries} entries (${shipped} shipped, ${contractOnly} contract-only); ` +
        `${classifiedFiles} file(s) classified; ${result.warnings.length} warning(s).`,
    );
    return;
  }
  const failures = [...result.errors, ...(strict ? result.warnings : [])];
  console.error(`Surface guard FAILED (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure.code}: ${failure.path}: ${failure.message}`);
  if (!strict && result.warnings.length) {
    console.error(`(${result.warnings.length} advisory warning(s); pass --strict to fail on them.)`);
  }
}

function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv, {
      flags: ['json', 'strict', 'require-manifest', 'help'],
      options: ['root', 'manifest'],
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
  const result = verifySurface({
    root: parsed.root ?? '.',
    manifestPath: parsed.manifest ?? null,
    strict: Boolean(parsed.strict),
    requireManifest: Boolean(parsed['require-manifest']),
  });
  if (parsed.json) {
    jsonOut({
      ok: result.ok,
      skipped: result.skipped ?? null,
      root: result.root,
      manifest: result.manifest,
      counts: result.counts,
      errors: result.errors,
      warnings: result.warnings,
      notes: result.notes,
    });
  } else {
    printHuman(result, Boolean(parsed.strict));
  }
  if (!result.ok) process.exitCode = 1;
}

const isMain = process.argv[1] && process.argv[1].endsWith('verify-surface.mjs');
if (isMain) main();
