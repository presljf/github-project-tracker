import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { planVersionBump, applyVersionBump } from '../scripts/release/bump-version.mjs';

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-'));
  execFileSync('git', ['init', '-b', 'main', root], { stdio: 'ignore' });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tracker.config.json'), '{"templateVersion":"1.2.0"}\n');
  fs.writeFileSync(
    path.join(root, 'docs/REFERENCE.md'),
    'Target v1.2.0\nSprint 1.2.0.1 stays\nHistorical: released as patch v1.2.0\n',
  );
  fs.writeFileSync(path.join(root, 'docs/ROADMAP_v1.0.md'), 'history v1.2.0\n');
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{"version":"1.2.0"}\n');
  fs.writeFileSync(path.join(root, 'tests.fixture.md'), 'v1.2.0\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  return root;
}
test('plans only allowlisted active files and preserves sprint keys', () => {
  const root = repo();
  const changes = planVersionBump({ root, from: '1.2.0', to: '1.2.1' });
  const files = changes.map((c) => c.file);
  assert.deepEqual(files, ['docs/REFERENCE.md', 'tracker.config.json']);
  assert.equal(changes.find((c) => c.file === 'docs/REFERENCE.md').edits.length, 1);
});
test('apply changes only planned lines', () => {
  const root = repo();
  const changes = planVersionBump({ root, from: '1.2.0', to: '1.2.1' });
  applyVersionBump({ root, changes });
  assert.match(fs.readFileSync(path.join(root, 'docs/REFERENCE.md'), 'utf8'), /Target v1\.2\.1\nSprint 1\.2\.0\.1/);
  assert.match(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'), /1\.2\.0/);
});
