import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyChecksums } from '../scripts/github/verify-checksums.mjs';
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checksums-'));
  fs.writeFileSync(path.join(dir, 'artifact.dmg'), 'payload');
  const sum = crypto.createHash('sha256').update('payload').digest('hex');
  fs.writeFileSync(path.join(dir, 'SHA256SUMS'), `${sum}  artifact.dmg\n`);
  return dir;
}
test('verifies matching checksums', () => assert.equal(verifyChecksums({ dir: fixture() }).length, 1));
test('fails missing asset', () => { const dir = fixture(); fs.rmSync(path.join(dir, 'artifact.dmg')); assert.throws(() => verifyChecksums({ dir }), /asset missing/); });
test('fails mismatched checksum', () => { const dir = fixture(); fs.writeFileSync(path.join(dir, 'artifact.dmg'), 'tampered'); assert.throws(() => verifyChecksums({ dir }), /mismatch/); });
