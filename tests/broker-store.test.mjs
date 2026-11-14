import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  SCHEMA_VERSION,
  assertNoSecrets,
  defaultStorePath,
  openStore,
  queryCalls,
  storeDiagnostics,
} from '../scripts/adopt/lib/broker-store.mjs';

function tempStorePath(name = 'broker.db') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-broker-store-'));
  return { dir, file: path.join(dir, name) };
}

function withStore(fn, options = {}) {
  const { file } = tempStorePath();
  const store = openStore({ path: file, ...options });
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

test('creates a private WAL store outside the repository and reports diagnostics', () => {
  withStore((store) => {
    const diagnostics = storeDiagnostics(store);
    assert.equal(diagnostics.schemaVersion, SCHEMA_VERSION);
    assert.equal(diagnostics.journalMode, 'wal');
    assert.equal(diagnostics.busyTimeout, 5000);
    assert.equal(diagnostics.fileMode, '600');
    assert.equal(diagnostics.dirMode, '700');
    assert.equal(diagnostics.readOnly, false);
    assert.deepEqual(queryCalls(store), []);
  });
  assert.match(defaultStorePath({}), /\.tracker-broker[/\\]broker\.db$/);
});

test('refuses a store path inside the repository', () => {
  const repoPath = path.join(process.cwd(), `.broker-test-${process.pid}.db`);
  assert.throws(() => openStore({ path: repoPath }), /outside the repository/);
  assert.equal(fs.existsSync(repoPath), false);
});

test('refuses a schema newer than this code', () => {
  const { file } = tempStorePath();
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA user_version = 99');
  raw.close();
  assert.throws(() => openStore({ path: file }), /newer than supported/);
});

test('a failed migration refuses startup and leaves the store unmigrated', () => {
  const { file } = tempStorePath();
  const broken = [{ version: 1, statements: ['CREATE TABLE broken ('] }];
  assert.throws(() => openStore({ path: file, migrations: broken }), /store migration failed/);
  const raw = new DatabaseSync(file);
  assert.equal(Number(raw.prepare('PRAGMA user_version').get().user_version), 0);
  raw.close();
  // A fresh open with the real migrations succeeds on the same path.
  const store = openStore({ path: file });
  assert.equal(storeDiagnostics(store).schemaVersion, SCHEMA_VERSION);
  store.close();
});

test('reopens an existing store without re-running migrations', () => {
  const { file } = tempStorePath();
  const first = openStore({ path: file });
  first.close();
  const second = openStore({ path: file });
  try {
    assert.equal(storeDiagnostics(second).schemaVersion, SCHEMA_VERSION);
    assert.equal(storeDiagnostics(second).journalMode, 'wal');
  } finally {
    second.close();
  }
});

test('read-only open works on an existing store but not on a missing one', () => {
  const { file } = tempStorePath();
  const writable = openStore({ path: file });
  writable.close();
  const readonly = openStore({ path: file, readOnly: true });
  try {
    assert.equal(storeDiagnostics(readonly).readOnly, true);
    assert.deepEqual(queryCalls(readonly), []);
  } finally {
    readonly.close();
  }
  const missing = tempStorePath('missing.db');
  assert.throws(() => openStore({ path: missing.file, readOnly: true }));
});

test('secret-like values are refused before they reach SQLite', () => {
  assert.throws(() => assertNoSecrets({ token: `ghp_${'a'.repeat(30)}` }), /secret-like/);
  assert.throws(() => assertNoSecrets({ key: '-----BEGIN OPENSSH PRIVATE KEY-----' }), /secret-like/);
  assert.throws(() => assertNoSecrets({ value: `github_pat_${'b'.repeat(30)}` }), /secret-like/);
  assert.doesNotThrow(() => assertNoSecrets({ title: 'Broker control-plane store' }));
});
