import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowed, changedFilesOutsideScope, findTransportViolations } from '../scripts/github/lib/guards.mjs';

test('scope matching allows files and directories only', () => {
  assert.equal(isAllowed('docs/a.md', ['docs']), true);
  assert.equal(isAllowed('scripts/github/a.mjs', ['scripts/github/']), true);
  assert.equal(isAllowed('package.json', ['docs']), false);
});

test('changedFilesOutsideScope reports contamination', () => {
  assert.deepEqual(changedFilesOutsideScope({ changedFiles: ['docs/a.md', 'package.json'], scopes: ['docs'] }), [
    'package.json',
  ]);
});

test('transport guard finds raw gh in a temp script and honors allowlist', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-test-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'bad.mjs'), "execFileSync('gh', ['issue']);\\n");
  fs.writeFileSync(path.join(root, 'scripts', 'ok.mjs'), "console.log('ok');\\n");
  const bad = findTransportViolations({ root, allow: [] });
  assert.ok(bad.some((v) => v.file === 'scripts/bad.mjs'));
  const allowed = findTransportViolations({ root, allow: ['scripts/bad.mjs'] });
  assert.equal(allowed.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
