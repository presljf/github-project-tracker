/**
 * Broker control-plane store (P0.1).
 *
 * SQLite (`node:sqlite`) authority store for grants, leases, plans, approvals, idempotency,
 * revocations, the hash-chained call log, and the mutation outbox. The store is created outside
 * the repository at `~/.tracker-broker/broker.db` (file 0600, directory 0700), uses WAL with a
 * busy timeout, and refuses to start when a migration fails or the schema is newer than this code.
 *
 * Same-user limitation (accepted D8-A until the m2): file modes do not stop a process running as
 * the same OS user. This is operational separation only; the P0 gate must report it as failed and
 * nothing may claim a hard boundary while the store lives under the operator's home.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1;
export const STORE_FILE_MODE = 0o600;
export const STORE_DIR_MODE = 0o700;
export const BUSY_TIMEOUT_MS = 5000;

const SECRET_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /-----BEGIN (?:RSA|EC|OPENSSH|PGP) PRIVATE KEY-----/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /sk-[A-Za-z0-9]{20,}/,
];

const MIGRATIONS = [
  {
    version: 1,
    statements: [
      `CREATE TABLE grants (
        id TEXT PRIMARY KEY,
        tier TEXT NOT NULL,
        repo TEXT NOT NULL,
        project INTEGER NOT NULL,
        tools_json TEXT NOT NULL,
        tasks_json TEXT NOT NULL,
        limits_json TEXT NOT NULL,
        approval_id TEXT NOT NULL,
        issued_by TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        plan_id TEXT,
        approved_by TEXT NOT NULL,
        channel TEXT NOT NULL,
        signature TEXT,
        approved_at TEXT NOT NULL,
        expires_at TEXT
      )`,
      `CREATE TABLE plans (
        id TEXT PRIMARY KEY,
        tool TEXT NOT NULL,
        args_hash TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT
      )`,
      `CREATE TABLE leases (
        id TEXT PRIMARY KEY,
        grant_id TEXT NOT NULL REFERENCES grants(id),
        tool TEXT NOT NULL,
        task INTEGER,
        args_hash TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        max_uses INTEGER,
        uses INTEGER NOT NULL DEFAULT 0,
        revoked_at TEXT
      )`,
      `CREATE TABLE idempotency (
        key TEXT PRIMARY KEY,
        tool TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE revocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        revoked_at TEXT NOT NULL,
        UNIQUE (subject_type, subject_id)
      )`,
      `CREATE TABLE call_log (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        tool TEXT NOT NULL,
        args_hash TEXT,
        lease_id TEXT,
        plan_id TEXT,
        outcome TEXT NOT NULL,
        detail_json TEXT,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL
      )`,
      `CREATE TABLE outbox (
        id TEXT PRIMARY KEY,
        tool TEXT NOT NULL,
        args_hash TEXT NOT NULL,
        idempotency_key TEXT,
        payload_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending','applied','failed','unknown')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        detail_json TEXT
      )`,
      'CREATE INDEX idx_leases_grant ON leases(grant_id)',
      'CREATE INDEX idx_call_log_at ON call_log(at)',
      'CREATE INDEX idx_outbox_state ON outbox(state)',
    ],
  },
];

/** Default store path; `TRACKER_BROKER_STORE` overrides it (callers must still keep it out of the repo). */
export function defaultStorePath(env = process.env) {
  return env.TRACKER_BROKER_STORE || path.join(os.homedir(), '.tracker-broker', 'broker.db');
}

/** Sibling append-only audit copy used by the call-log ledger. */
export function defaultAuditPath(storePath = defaultStorePath()) {
  return path.join(path.dirname(storePath), 'audit.jsonl');
}

export function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

export function newId() {
  return crypto.randomUUID();
}

/**
 * Refuse to persist secret-like values. The store must never hold a token or private key, so every
 * writer funnels through this guard before an INSERT.
 */
export function assertNoSecrets(value, label = 'record') {
  const text = JSON.stringify(value ?? null);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) throw new Error(`refusing to store ${label}: secret-like value matched ${pattern}`);
  }
}

function relativeInside(root, target) {
  const rel = path.relative(root, target);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: STORE_DIR_MODE });
  fs.chmodSync(dir, STORE_DIR_MODE);
}

function currentSchemaVersion(db) {
  const row = db.prepare('PRAGMA user_version').get();
  return Number(row?.user_version || 0);
}

/**
 * Apply migrations inside one transaction. A newer schema than this code supports, or any failing
 * statement, refuses startup instead of running against a partially migrated store.
 */
export function migrateStore(db, { migrations = MIGRATIONS, apply = true } = {}) {
  const current = currentSchemaVersion(db);
  if (current > SCHEMA_VERSION) {
    throw new Error(`store schema v${current} is newer than supported v${SCHEMA_VERSION}; upgrade TrackerOS`);
  }
  if (current === SCHEMA_VERSION) return { from: current, to: current };
  if (!apply) throw new Error(`store schema v${current} needs migration to v${SCHEMA_VERSION}; reopen read-write`);
  const pending = migrations.filter((entry) => entry.version > current).sort((a, b) => a.version - b.version);
  if (!pending.length || pending[pending.length - 1].version !== SCHEMA_VERSION) {
    throw new Error(`migration chain for v${current} does not reach schema v${SCHEMA_VERSION}`);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const migration of pending) {
      for (const statement of migration.statements) db.exec(statement);
    }
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
    return { from: current, to: SCHEMA_VERSION };
  } catch (error) {
    db.exec('ROLLBACK');
    throw new Error(`store migration failed: ${error.message}`, { cause: error });
  }
}

/**
 * Open (and by default create/migrate) the control-plane store.
 *
 * @param {object} [options]
 * @param {string} [options.path] store file; defaults to `defaultStorePath()`
 * @param {() => number} [options.now] clock injection for tests
 * @param {boolean} [options.readOnly] open an existing store without writing (schema must match)
 * @param {Array} [options.migrations] migration list override for failure tests
 * @param {boolean} [options.allowRepoPath] test escape hatch; production callers must not use it
 */
export function openStore({
  path: storePath = defaultStorePath(),
  now = Date.now,
  readOnly = false,
  migrations = MIGRATIONS,
  allowRepoPath = false,
} = {}) {
  const resolved = path.resolve(storePath);
  if (!allowRepoPath && relativeInside(process.cwd(), resolved)) {
    throw new Error(`store path must live outside the repository (agent-writable space): ${resolved}`);
  }
  if (!readOnly) ensurePrivateDir(path.dirname(resolved));
  const db = new DatabaseSync(resolved, { readOnly });
  try {
    if (!readOnly) {
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = NORMAL');
      db.exec('PRAGMA foreign_keys = ON');
      db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
      fs.chmodSync(resolved, STORE_FILE_MODE);
    }
    migrateStore(db, { migrations, apply: !readOnly });
  } catch (error) {
    db.close();
    throw error;
  }
  return {
    path: resolved,
    auditPath: defaultAuditPath(resolved),
    now,
    readOnly,
    db,
    close() {
      db.close();
    },
  };
}

/** Run `fn` inside a single-writer transaction; rolls back on any throw. */
export function withTransaction(store, fn) {
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    store.db.exec('COMMIT');
    return result;
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
}

/** Read-only call-log query API (also used by the P0 gate and future audit tooling). */
export function queryCalls(store, { tool = null, toolPrefix = null, since = null, limit = 100 } = {}) {
  const capped = Math.max(1, Math.min(1000, Number(limit) || 100));
  const clauses = [];
  const params = [];
  if (tool) {
    clauses.push('tool = ?');
    params.push(String(tool));
  }
  if (toolPrefix) {
    clauses.push('tool LIKE ?');
    params.push(`${String(toolPrefix)}%`);
  }
  if (since) {
    clauses.push('at >= ?');
    params.push(String(since));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = store.db
    .prepare(
      `SELECT seq, at, tool, args_hash AS argsHash, lease_id AS leaseId, plan_id AS planId, outcome,
              detail_json AS detailJson, prev_hash AS prevHash, hash
         FROM call_log ${where} ORDER BY seq ASC LIMIT ?`,
    )
    .all(...params, capped);
  return rows.map((row) => ({ ...row, detail: row.detailJson ? JSON.parse(row.detailJson) : null }));
}

/** Non-secret store diagnostics for doctor/gate output. */
export function storeDiagnostics(store) {
  const fileStat = fs.statSync(store.path);
  let dirMode;
  try {
    dirMode = (fs.statSync(path.dirname(store.path)).mode & 0o777).toString(8);
  } catch {
    dirMode = null;
  }
  return {
    path: store.path,
    auditPath: store.auditPath,
    schemaVersion: currentSchemaVersion(store.db),
    journalMode: store.db.prepare('PRAGMA journal_mode').get()?.journal_mode || null,
    busyTimeout: Number(store.db.prepare('PRAGMA busy_timeout').get()?.timeout || 0),
    fileMode: (fileStat.mode & 0o777).toString(8),
    dirMode,
    readOnly: Boolean(store.readOnly),
  };
}
