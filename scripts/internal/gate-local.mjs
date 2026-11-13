#!/usr/bin/env node
/**
 * Local-first gate runner: one command that exercises the repo's local verification stack in a
 * deterministic order, with per-step timeouts and captured output tails.
 *
 * Why: agents batch related edits locally and run one reviewable checkpoint (`npm run gate:local`)
 * instead of scattering partial remote CI runs. The step table mirrors the `docs-guard` CI job
 * (`.github/workflows/ci.yml`) so local and remote verification cannot drift silently — see
 * `tests/gate-local.test.mjs` for the parity guard.
 *
 * Rules:
 * - Node stdlib only (internal module helpers are fine; no npm dependencies).
 * - No network/live-GitHub steps: every step is offline or self-repo safe (`gate:release` runs
 *   without `--repo`; `verify:contract`/`verify:tooling` skip downstream checks in self-repo mode).
 * - A step is never faked as passed: unavailable prerequisites are reported as `skipped` with a
 *   reason (e.g. no `origin/main` to diff against, or an npm alias not shipped yet).
 * - Default is fail-fast (stop at the first failing step); `--continue` runs every step and
 *   aggregates failures.
 *
 * CLI: node scripts/internal/gate-local.mjs [--json] [--list] [--continue] [--help]
 * Env: GATE_LOCAL_BASE (base ref for docs coverage; default origin/main)
 *      GATE_LOCAL_TIMEOUT_MS (per-step timeout; default 10 minutes)
 *
 * Exit codes: 0 all attempted steps passed (skips allowed, but never counted as passes),
 *             1 at least one required step failed, 2 usage error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, jsonOut, UsageError } from '../adopt/lib/cli.mjs';

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_BASE = 'origin/main';
/** Placeholder resolved to the docs-coverage base ref at run time. */
export const BASE_PLACEHOLDER = '{{base}}';
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * Ordered local-gate step table (deterministic; do not reorder casually — the order is cheapest
 * and most actionable first, and the docs-guard parity test keys off it).
 *
 * Fields:
 * - id: stable machine name used in JSON output and tests.
 * - title: human label.
 * - command: argv template; `npm` is swapped for the platform npm binary at spawn time and
 *   BASE_PLACEHOLDER is resolved from GATE_LOCAL_BASE.
 * - required: failing this step fails the gate (all current steps are required).
 * - optionalAlias: skip with a notice when the npm alias is not defined yet (forward-compat for
 *   aliases added in a later tracker release).
 * - requiresGitRef: only run when `git rev-parse --verify <ref>` succeeds locally.
 * - baseRef: resolve the docs coverage base and skip when it cannot be resolved.
 */
export const LOCAL_STEPS = Object.freeze(
  [
    { id: 'unit-tests', title: 'unit tests', command: ['npm', 'run', 'test'], required: true },
    { id: 'lint', title: 'lint', command: ['npm', 'run', 'lint'], required: true },
    { id: 'format', title: 'format check', command: ['npm', 'run', 'format:check'], required: true },
    { id: 'docs-check', title: 'docs links/anchors', command: ['npm', 'run', 'docs:check'], required: true },
    { id: 'versions', title: 'version consistency', command: ['npm', 'run', 'guard:versions'], required: true },
    { id: 'config', title: 'config validation', command: ['npm', 'run', 'validate:config'], required: true },
    { id: 'tooling', title: 'tooling verification', command: ['npm', 'run', 'verify:tooling'], required: true },
    { id: 'contract', title: 'adoption contract', command: ['npm', 'run', 'verify:contract'], required: true },
    { id: 'release-gate', title: 'release gate', command: ['npm', 'run', 'gate:release'], required: true },
    { id: 'transport-guard', title: 'GitHub transport guard', command: ['npm', 'run', 'guard:gh'], required: true },
    {
      id: 'dependency-guard',
      title: 'dependency guard',
      command: ['npm', 'run', 'guard:deps'],
      required: true,
      requiresGitRef: DEFAULT_BASE,
    },
    {
      id: 'surface',
      title: 'repo-surface guard',
      command: ['npm', 'run', 'verify:surface', '--', '--root', '.', '--require-manifest'],
      required: true,
    },
    {
      id: 'surface-check',
      title: 'repo surface check',
      command: ['npm', 'run', 'surface:check'],
      required: true,
      optionalAlias: true,
    },
    {
      id: 'debt',
      title: 'debt guard',
      command: ['npm', 'run', 'guard:debt'],
      required: true,
      optionalAlias: true,
    },
    {
      id: 'docs-coverage',
      title: 'docs coverage',
      command: ['node', 'scripts/adopt/docs/guard-docs.mjs', '--base', BASE_PLACEHOLDER],
      required: true,
      baseRef: true,
    },
    { id: 'counts', title: 'counts guard', command: ['npm', 'run', 'guard:docs:counts'], required: true },
  ].map((step) => Object.freeze(step)),
);

export const STEP_IDS = Object.freeze(LOCAL_STEPS.map((step) => step.id));

/** npm alias a step invokes (`npm run <alias>`), or null for direct node steps. */
export function npmAliasOf(step) {
  const command = step?.command || [];
  if (command[0] === 'npm' && command[1] === 'run' && typeof command[2] === 'string') return command[2];
  return null;
}

/** Resolve the argv template for a step (base placeholder + platform npm binary). */
export function resolveCommand(step, { base = DEFAULT_BASE } = {}) {
  const command = step.command.map((part) => (part === BASE_PLACEHOLDER ? base : part));
  if (command[0] === 'npm') command[0] = NPM;
  return command;
}

/** Keep the last `maxLines`/`maxChars` of captured output so failures stay actionable. */
export function tailText(value, { maxLines = 25, maxChars = 4000 } = {}) {
  const text = String(value ?? '').trimEnd();
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const tail = lines.slice(-maxLines).join('\n');
  return tail.length > maxChars ? tail.slice(-maxChars) : tail;
}

/** package.json scripts, or {} when the file/field is unavailable. */
export function readPackageScripts(cwd) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    return pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {};
  } catch {
    return {};
  }
}

export function hasNpmAlias(alias, { cwd = process.cwd() } = {}) {
  return Object.prototype.hasOwnProperty.call(readPackageScripts(cwd), alias);
}

/** True when `git rev-parse --verify --quiet <ref>` succeeds in `cwd`. */
export function gitRefExists(ref, { cwd = process.cwd(), spawn = spawnSync } = {}) {
  try {
    const result = spawn('git', ['rev-parse', '--verify', '--quiet', ref], { cwd, encoding: 'utf8' });
    return result?.status === 0;
  } catch {
    return false;
  }
}

function stepMeta(step, command) {
  return { id: step.id, title: step.title, command, required: Boolean(step.required) };
}

/**
 * Preflight: decide whether a step should run, be skipped (with a reason) or fail without
 * spawning (a required npm alias missing from package.json).
 * @returns {{skipReason?: string, failReason?: string}|null}
 */
function preflight(step, { base, checkNpmAlias, checkGitRef }) {
  const alias = npmAliasOf(step);
  if (alias && !checkNpmAlias(alias)) {
    return step.optionalAlias
      ? { skipReason: `npm alias not defined yet: ${alias}` }
      : { failReason: `required npm alias not defined: ${alias}` };
  }
  if (step.requiresGitRef && !checkGitRef(step.requiresGitRef)) {
    return { skipReason: `git ref not available locally: ${step.requiresGitRef}` };
  }
  if (step.baseRef && !checkGitRef(base)) {
    return { skipReason: `docs coverage base ref not resolved: ${base}` };
  }
  return null;
}

function executeStep(step, { cwd, env, spawn, timeoutMs, base }) {
  const command = resolveCommand(step, { base });
  const startedAt = Date.now();
  let raw;
  try {
    raw = spawn(command[0], command.slice(1), {
      cwd,
      env: { ...env, GATE_LOCAL_STEP: step.id },
      timeout: timeoutMs,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      shell: false,
    });
  } catch (error) {
    return {
      ...stepMeta(step, command),
      status: 'failed',
      exitCode: null,
      signal: null,
      timedOut: false,
      durationMs: Date.now() - startedAt,
      error: error.message,
      stdoutTail: '',
      stderrTail: '',
    };
  }
  const durationMs = Date.now() - startedAt;
  const timedOut =
    Boolean(raw?.error && raw.error.code === 'ETIMEDOUT') || (raw?.status === null && Boolean(raw?.signal));
  const passed = Boolean(raw) && raw.status === 0 && !raw.error && !timedOut;
  return {
    ...stepMeta(step, command),
    status: passed ? 'passed' : 'failed',
    exitCode: typeof raw?.status === 'number' ? raw.status : null,
    signal: raw?.signal ?? null,
    timedOut,
    durationMs,
    error: raw?.error?.message ?? null,
    stdoutTail: tailText(raw?.stdout),
    stderrTail: tailText(raw?.stderr),
  };
}

/**
 * Run the ordered local gate. Pure with respect to spawning: pass `spawn`/`checkNpmAlias`/
 * `checkGitRef` to inject fakes in tests.
 * @returns {{ok: boolean, base: string, cwd: string, durationMs: number, continueOnFailure: boolean,
 *   counts: {total: number, executed: number, passed: number, failed: number, skipped: number, notRun: number},
 *   results: Array<object>, notices: string[]}}
 */
export function runGate({
  steps = LOCAL_STEPS,
  cwd = process.cwd(),
  env = process.env,
  spawn = spawnSync,
  checkNpmAlias = (alias) => hasNpmAlias(alias, { cwd }),
  checkGitRef = (ref) => gitRefExists(ref, { cwd }),
  base = env.GATE_LOCAL_BASE || DEFAULT_BASE,
  timeoutMs = Number(env.GATE_LOCAL_TIMEOUT_MS) > 0 ? Number(env.GATE_LOCAL_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
  continueOnFailure = false,
} = {}) {
  const startedAt = Date.now();
  const results = [];
  const notices = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let stopped = false;
  for (const step of steps) {
    const command = resolveCommand(step, { base });
    if (stopped) {
      results.push({ ...stepMeta(step, command), status: 'not-run', skipReason: 'fail-fast stopped the gate' });
      continue;
    }
    const decision = preflight(step, { base, checkNpmAlias, checkGitRef });
    if (decision?.skipReason) {
      skipped += 1;
      results.push({ ...stepMeta(step, command), status: 'skipped', skipReason: decision.skipReason });
      notices.push(`${step.id}: skipped — ${decision.skipReason}`);
      continue;
    }
    if (decision?.failReason) {
      failed += 1;
      results.push({
        ...stepMeta(step, command),
        status: 'failed',
        exitCode: null,
        signal: null,
        timedOut: false,
        durationMs: 0,
        error: decision.failReason,
        stdoutTail: '',
        stderrTail: '',
      });
      if (!continueOnFailure) stopped = true;
      continue;
    }
    const result = executeStep(step, { cwd, env, spawn, timeoutMs, base });
    results.push(result);
    if (result.status === 'passed') passed += 1;
    else {
      failed += 1;
      if (!continueOnFailure) stopped = true;
    }
  }
  const executed = passed + failed;
  const notRun = results.filter((result) => result.status === 'not-run').length;
  return {
    ok: failed === 0,
    base,
    cwd,
    durationMs: Date.now() - startedAt,
    continueOnFailure,
    counts: { total: steps.length, executed, passed, failed, skipped, notRun },
    results,
    notices,
  };
}

/** Human-readable summary with `GATE_LOCAL_OK n/n` / `GATE_LOCAL_FAIL n/n` and failing tails. */
export function formatHuman(result) {
  const lines = [];
  const { counts } = result;
  lines.push(`Local gate — ${counts.total} step(s); base ${result.base}; cwd ${result.cwd}`);
  for (const [index, entry] of result.results.entries()) {
    const label = `[${String(index + 1).padStart(2, '0')}/${counts.total}] ${entry.id}`;
    if (entry.status === 'skipped') {
      lines.push(`${label} — skipped: ${entry.skipReason}`);
    } else if (entry.status === 'not-run') {
      lines.push(`${label} — not run (fail-fast)`);
    } else if (entry.status === 'passed') {
      lines.push(`${label} — ok (${entry.durationMs}ms)`);
    } else {
      const detail = entry.timedOut ? 'timed out' : `exit ${entry.exitCode ?? 'spawn-error'}`;
      lines.push(`${label} — FAIL (${detail}, ${entry.durationMs}ms)`);
    }
  }
  for (const notice of result.notices) lines.push(`notice: ${notice}`);
  if (result.ok) {
    const suffix = counts.skipped ? ` (${counts.skipped} skipped)` : '';
    lines.push(`GATE_LOCAL_OK ${counts.passed}/${counts.executed}${suffix}`);
    return lines.join('\n');
  }
  lines.push(`GATE_LOCAL_FAIL ${counts.failed}/${counts.executed}`);
  for (const entry of result.results.filter((item) => item.status === 'failed')) {
    lines.push(`--- ${entry.id} failing output${entry.error ? ` (${entry.error})` : ''} ---`);
    const output = [entry.stdoutTail, entry.stderrTail].filter(Boolean).join('\n');
    lines.push(output || '(no captured output)');
  }
  return lines.join('\n');
}

const USAGE = `Usage: node scripts/internal/gate-local.mjs [options]

One-command local checkpoint: runs the ordered local gate (unit tests, lint, format, docs,
config/tooling/contract/surface guards, release gate, docs coverage) with per-step timeouts.
Skipped steps are never counted as passes.

Options:
  --json       Print the machine-readable run result (or the step table with --list)
  --list       Print the ordered step table and exit (add --json for JSON)
  --continue   Keep running after a failing step instead of failing fast
  --help, -h   Show this help

Environment:
  GATE_LOCAL_BASE        Base ref for docs coverage (default: origin/main)
  GATE_LOCAL_TIMEOUT_MS  Per-step timeout in ms (default: 600000)

Exit codes: 0 pass (skips allowed), 1 failed step, 2 usage error.`;

function listPayload() {
  return {
    base: DEFAULT_BASE,
    steps: LOCAL_STEPS.map((step, index) => ({
      index: index + 1,
      id: step.id,
      title: step.title,
      command: resolveCommand(step, { base: BASE_PLACEHOLDER }),
      required: Boolean(step.required),
      optionalAlias: Boolean(step.optionalAlias),
      requiresGitRef: step.requiresGitRef ?? null,
      baseRef: Boolean(step.baseRef),
    })),
  };
}

function printList() {
  console.log(`Local gate step table (${LOCAL_STEPS.length} steps, deterministic order):`);
  for (const [index, step] of LOCAL_STEPS.entries()) {
    const command = resolveCommand(step, { base: BASE_PLACEHOLDER }).join(' ');
    const notes = [];
    if (step.optionalAlias) notes.push('skips when alias absent');
    if (step.requiresGitRef) notes.push(`requires ${step.requiresGitRef}`);
    if (step.baseRef) notes.push(`base ${BASE_PLACEHOLDER}`);
    console.log(`${index + 1}. ${step.id} — ${command}${notes.length ? ` (${notes.join('; ')})` : ''}`);
  }
}

function toJson(result) {
  return {
    ok: result.ok,
    base: result.base,
    cwd: result.cwd,
    durationMs: result.durationMs,
    continueOnFailure: result.continueOnFailure,
    counts: result.counts,
    notices: result.notices,
    results: result.results,
  };
}

export function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv, { flags: ['json', 'list', 'continue', 'help'] });
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
  if (parsed.list) {
    if (parsed.json) jsonOut(listPayload());
    else printList();
    return;
  }
  const result = runGate({ continueOnFailure: Boolean(parsed.continue) });
  if (parsed.json) jsonOut(toJson(result));
  else console.log(formatHuman(result));
  if (!result.ok) process.exitCode = 1;
}

const isMain = process.argv[1] && process.argv[1].endsWith('gate-local.mjs');
if (isMain) main();
