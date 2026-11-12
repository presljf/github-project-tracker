import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('reusable desktop smoke contract exposes required inputs and defaults', () => {
  const yaml = read('.github/workflows/reusable-desktop-smoke.yml');
  assert.match(yaml, /workflow_call:/);
  assert.match(yaml, /runner-label:/);
  assert.match(yaml, /default: macos-15/);
  assert.match(yaml, /smoke-command:/);
  assert.match(yaml, /contents: read/);
  assert.doesNotMatch(yaml, /pull_request_target/);
  assert.match(yaml, /runs-on: \$\{\{ inputs\.runner-label \}\}/);
});

test('caller example documents path/label gating and macos-15', () => {
  const readme = read('profiles/desktop/README.md');
  assert.match(readme, /contains\(github\.event\.pull_request\.labels/);
  assert.match(readme, /macos-15/);
  assert.match(readme, /reusable-desktop-smoke\.yml@v1\.2\.2/);
});
