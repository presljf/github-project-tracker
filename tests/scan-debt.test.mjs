import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEBT_SCHEMA_VERSION,
  listTrackedFiles,
  renderTechDebt,
  scanDebt,
  scanDebtFindings,
  validateDebtRegister,
} from '../scripts/internal/scan-debt.mjs';
import { cleanupDebtCase, materializeDebtCase, readCase } from './fixtures/debt/materialize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = path.join(ROOT, 'scripts', 'internal', 'scan-debt.mjs');
const CASES = fs
  .readdirSync(path.join(ROOT, 'tests', 'fixtures', 'debt', 'cases'))
  .filter((name) => fs.existsSync(path.join(ROOT, 'tests', 'fixtures', 'debt', 'cases', name, 'case.json')))
  .sort();
const NOW = Date.parse('2026-11-12T12:00:00Z');

function codes(list) {
  return new Set(list.map((item) => item.code));
}

function readRegister(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'contract', 'debt-register.json'), 'utf8'));
}

/** Make the generated doc current for a materialized fixture. */
function syncDoc(root, now = NOW) {
  const register = readRegister(root);
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'TECH_DEBT.md'), renderTechDebt({ register, root, now }));
}

function evaluate(name, options = {}) {
  const root = materializeDebtCase(name);
  try {
    return scanDebt({ root, now: NOW, verifyDoc: true, ...options });
  } finally {
    cleanupDebtCase(root);
  }
}

function runCli(args, cwd = ROOT) {
  return spawnSync(process.execPath, [GUARD, ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

// ---------------------------------------------------------------------------
// Clean fixture
// ---------------------------------------------------------------------------

test('clean fixture passes the guard when the generated doc is current', () => {
  const root = materializeDebtCase('clean');
  try {
    syncDoc(root);
    const result = scanDebt({ root, now: NOW, verifyDoc: true });
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
    assert.equal(result.counts.entries, 0);
    assert.equal(result.counts.shims, 0);
  } finally {
    cleanupDebtCase(root);
  }
});

// ---------------------------------------------------------------------------
// Every negative fixture emits its expected audit code
// ---------------------------------------------------------------------------

for (const name of CASES) {
  const spec = readCase(name);
  if (!spec.expect?.errors?.length) continue;
  test(`fixture ${name} fails with ${spec.expect.errors.join(', ')}`, () => {
    const root = materializeDebtCase(name);
    try {
      // Cases that exercise the stale/missing-doc rule skip doc sync.
      if (spec.doc === undefined && spec.autoDoc !== false) syncDoc(root);
      const result = scanDebt({ root, now: NOW, verifyDoc: true });
      assert.equal(result.ok, false);
      const emitted = codes(result.errors);
      for (const code of spec.expect.errors)
        assert.ok(emitted.has(code), `${name}: expected ${code}, got ${[...emitted]}`);
    } finally {
      cleanupDebtCase(root);
    }
  });
}

// ---------------------------------------------------------------------------
// CLI modes: advisory exit 0, --check blocks, --render/--check round-trip, --json stable
// ---------------------------------------------------------------------------

test('advisory mode always exits 0; --check is the blocking mode', () => {
  const root = materializeDebtCase('expired');
  try {
    syncDoc(root);
    const advisory = runCli(['--root', root, '--advisory']);
    assert.equal(advisory.status, 0, advisory.stderr);
    assert.match(advisory.stdout, /Debt scan/);
    const blocking = runCli(['--root', root, '--check']);
    assert.equal(blocking.status, 1);
    assert.match(blocking.stderr, /DEBT_EXPIRED/);
  } finally {
    cleanupDebtCase(root);
  }
});

test('--render writes the generated doc and --check then passes for the clean fixture', () => {
  const root = materializeDebtCase('clean');
  try {
    const render = runCli(['--root', root, '--render']);
    assert.equal(render.status, 0, render.stderr);
    assert.ok(fs.existsSync(path.join(root, 'docs', 'TECH_DEBT.md')));
    const check = runCli(['--root', root, '--check']);
    assert.equal(check.status, 0, check.stderr);
  } finally {
    cleanupDebtCase(root);
  }
});

test('--json output is deterministic across runs', () => {
  const root = materializeDebtCase('clean');
  try {
    syncDoc(root);
    const first = runCli(['--root', root, '--json']);
    const second = runCli(['--root', root, '--json']);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(first.stdout, second.stdout);
    const parsed = JSON.parse(first.stdout);
    assert.equal(parsed.schemaVersion, DEBT_SCHEMA_VERSION);
    assert.equal(parsed.counts.entries, 0);
  } finally {
    cleanupDebtCase(root);
  }
});

// ---------------------------------------------------------------------------
// Register validation units
// ---------------------------------------------------------------------------

const baseEntry = {
  id: 'unit-001',
  class: 'hardcoded-env',
  pointer: 'scripts/adopt/lib/cli.mjs:1',
  owner: '@unit',
  expiry: '2026-11-12',
  reason: 'unit fixture',
  status: 'accepted',
  risk: 'low',
  effort: 'S',
  decision: 'register',
  detectedBy: 'manual',
};

test('expiry boundary: expiring today is not yet expired, yesterday is', () => {
  const today = validateDebtRegister({
    register: {
      schemaVersion: 1,
      policy: { blockingClasses: ['shim'], reviewCadence: 'monthly' },
      entries: [baseEntry],
    },
    root: ROOT,
    now: NOW,
    registerRel: 'contract/debt-register.json',
  });
  assert.deepEqual(today.errors, []);
  const yesterday = validateDebtRegister({
    register: {
      schemaVersion: 1,
      policy: { blockingClasses: ['shim'], reviewCadence: 'monthly' },
      entries: [{ ...baseEntry, expiry: '2026-11-11' }],
    },
    root: ROOT,
    now: NOW,
    registerRel: 'contract/debt-register.json',
  });
  assert.ok(codes(yesterday.errors).has('DEBT_EXPIRED'));
});

test('blocking-class accepted entries require owner+expiry+reason+pointer', () => {
  const result = validateDebtRegister({
    register: {
      schemaVersion: 1,
      policy: { blockingClasses: ['temp-fix'], reviewCadence: 'monthly' },
      entries: [{ ...baseEntry, id: 'unit-002', class: 'temp-fix', owner: '', expiry: '' }],
    },
    root: ROOT,
    now: NOW,
    registerRel: 'contract/debt-register.json',
  });
  const emitted = codes(result.errors);
  assert.ok(emitted.has('DEBT_OWNER_MISSING'));
  assert.ok(emitted.has('DEBT_EXPIRY_MISSING'));
  assert.ok(emitted.has('DEBT_SHIM_UNLABELED'));
});

test('listTrackedFiles falls back to a deterministic walk for fixture roots', () => {
  const root = materializeDebtCase('clean');
  try {
    const files = listTrackedFiles(root);
    assert.deepEqual(files, [...files].sort());
    assert.ok(files.includes('scripts/ok.mjs'));
    assert.ok(files.includes('contract/debt-register.json'));
  } finally {
    cleanupDebtCase(root);
  }
});

// ---------------------------------------------------------------------------
// Real repository state
// ---------------------------------------------------------------------------

test('real repo: register is valid, doc is current, and no blocking debt is detected', () => {
  const result = scanDebt({ root: ROOT, now: NOW, verifyDoc: true });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.ok(result.counts.entries >= 15);
  assert.equal(result.counts.shims, 0);
  assert.ok(result.counts.hotspots >= 4);
});

test('real repo scan findings are deterministic and advisory only', () => {
  const first = JSON.stringify(scanDebtFindings({ root: ROOT }));
  const second = JSON.stringify(scanDebtFindings({ root: ROOT }));
  assert.equal(first, second);
});

test('rendered doc includes summary, register, P4 backlog, coverage, and how-to-add sections', () => {
  const register = {
    schemaVersion: 1,
    policy: {
      blockingClasses: ['shim'],
      reviewCadence: 'monthly',
      coverage: {
        command: "node --test --experimental-test-coverage --test-coverage-include='scripts/**' tests/*.test.mjs",
        measuredAt: '2026-11-12',
        head: '0123456789abcdef',
        lines: 80,
        branches: 70,
        functions: 90,
      },
    },
    entries: [{ ...baseEntry, status: 'p4', decision: 'p4-backlog', evidence: 'unit plan' }],
  };
  const doc = renderTechDebt({ register, root: ROOT, now: NOW });
  assert.match(doc, /Generated by `node scripts\/internal\/scan-debt\.mjs --render`/);
  assert.match(doc, /## Summary/);
  assert.match(doc, /## Register/);
  assert.match(doc, /## P4 backlog/);
  assert.match(doc, /## Coverage baseline/);
  assert.match(doc, /80\.00%/);
  assert.match(doc, /## How to add debt/);
});
