#!/usr/bin/env node
/** Verify SHA256SUMS against release assets (manual fallback gate). */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function verifyChecksums({ dir, checksumFile = 'SHA256SUMS' } = {}) {
  const file = path.join(dir, checksumFile);
  if (!fs.existsSync(file)) throw new Error(`checksum file not found: ${file}`);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const results = [];
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (!match) throw new Error(`invalid checksum line: ${line}`);
    const [, expected, name] = match;
    const target = path.join(dir, name);
    if (!fs.existsSync(target)) throw new Error(`asset missing: ${name}`);
    const actual = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    if (actual !== expected) throw new Error(`checksum mismatch: ${name}`);
    results.push({ name, sha256: actual });
  }
  if (!results.length) throw new Error('checksum file is empty');
  return results;
}
function main() {
  const args = process.argv.slice(2);
  const get = (n, d = null) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : d;
  };
  try {
    const results = verifyChecksums({ dir: path.resolve(get('dir', '.')), checksumFile: get('file', 'SHA256SUMS') });
    console.log(`Checksums OK — ${results.length} asset(s).`);
    for (const r of results) console.log(`${r.sha256}  ${r.name}`);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && process.argv[1].endsWith('verify-checksums.mjs')) main();
