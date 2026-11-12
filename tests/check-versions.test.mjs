import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findStaleVersions } from '../scripts/docs/check-versions.mjs';
test('flags stale version and ignores allowlist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'versions-'));
  const old = path.join(dir, 'old.md'); const clean = path.join(dir, 'clean.md'); const history = path.join(dir, 'history.md');
  fs.writeFileSync(old, 'v1.0.1\n'); fs.writeFileSync(clean, 'v1.0.2\n'); fs.writeFileSync(history, 'v1.0.1\n');
  const got = findStaleVersions({ files: [old, clean, history], stale: '1.0.1', allow: [history] });
  assert.deepEqual(got, [old]);
});
