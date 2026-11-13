import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findHygieneViolations, parseLsFiles } from '../scripts/internal/verify-hygiene.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'internal', 'verify-hygiene.mjs');

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hygiene-'));
  execFileSync('git', ['init', '-b', 'main', root], { stdio: 'ignore' });
  return root;
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('parseLsFiles reads modes and paths (including spaces) from -z records', () => {
  const output = [
    '100644 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 0\tdocs/one.md',
    '120000 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 0\tnode_modules',
    '100755 cccccccccccccccccccccccccccccccccccccccc 0\tscripts/a b.sh',
    '',
  ].join('\0');
  assert.deepEqual(parseLsFiles(output), [
    { mode: '100644', path: 'docs/one.md' },
    { mode: '120000', path: 'node_modules' },
    { mode: '100755', path: 'scripts/a b.sh' },
  ]);
  assert.deepEqual(parseLsFiles(''), []);
});

test('clean tracked tree passes', () => {
  const root = repo();
  try {
    fs.writeFileSync(path.join(root, 'README.md'), '# fixture\n');
    execFileSync('git', ['-C', root, 'add', 'README.md']);
    const result = findHygieneViolations({ root });
    assert.equal(result.ok, true);
    assert.equal(result.files, 1);
    assert.deepEqual(result.violations, []);
  } finally {
    cleanup(root);
  }
});

test(
  'tracked symlink fails (the T05 node_modules class)',
  { skip: process.platform === 'win32' ? 'symlink creation needs privileges on Windows' : false },
  () => {
    const root = repo();
    try {
      fs.writeFileSync(path.join(root, 'README.md'), '# fixture\n');
      fs.symlinkSync('../node_modules-target', path.join(root, 'node_modules'));
      execFileSync('git', ['-C', root, 'add', 'README.md', 'node_modules']);
      const result = findHygieneViolations({ root });
      assert.equal(result.ok, false);
      assert.ok(result.violations.some((violation) => /tracked symlink: node_modules/.test(violation)));
    } finally {
      cleanup(root);
    }
  },
);

test('empty repository and a tracked tree without .gitignore pass', () => {
  const empty = repo();
  const noIgnore = repo();
  try {
    const emptyResult = findHygieneViolations({ root: empty });
    assert.equal(emptyResult.ok, true);
    assert.equal(emptyResult.files, 0);

    fs.writeFileSync(path.join(noIgnore, 'app.log'), 'log line\n');
    execFileSync('git', ['-C', noIgnore, 'add', 'app.log']);
    const result = findHygieneViolations({ root: noIgnore });
    assert.equal(result.ok, true);
    assert.equal(result.files, 1);
  } finally {
    cleanup(empty);
    cleanup(noIgnore);
  }
});

test('a submodule gitlink is not treated as a symlink or ignored path', () => {
  const root = repo();
  try {
    fs.writeFileSync(path.join(root, 'README.md'), '# fixture\n');
    execFileSync('git', ['-C', root, 'add', 'README.md']);
    execFileSync('git', [
      '-C',
      root,
      'update-index',
      '--add',
      '--cacheinfo',
      '160000',
      '1111111111111111111111111111111111111111',
      'vendor/tracker',
    ]);
    const result = findHygieneViolations({ root });
    assert.equal(result.ok, true);
    assert.ok(result.files >= 2);
  } finally {
    cleanup(root);
  }
});

test('a user/global gitignore does not create a local-only failure', () => {
  const root = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hygiene-home-'));
  try {
    fs.mkdirSync(path.join(home, '.config', 'git'), { recursive: true });
    fs.writeFileSync(path.join(home, '.config', 'git', 'ignore'), '*.log\n');
    fs.writeFileSync(path.join(root, 'app.log'), 'log line\n');
    execFileSync('git', ['-C', root, 'add', 'app.log']);
    const result = spawnSync(process.execPath, [SCRIPT, '--root', root], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Tracked-file hygiene OK/);
  } finally {
    cleanup(root);
    cleanup(home);
  }
});

test('force-added git-ignored path fails', () => {
  const root = repo();
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n');
    fs.mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');
    execFileSync('git', ['-C', root, 'add', '.gitignore']);
    execFileSync('git', ['-C', root, 'add', '-f', 'node_modules/dep/index.js']);
    const result = findHygieneViolations({ root });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((violation) => /git-ignored: node_modules\/dep\/index\.js/.test(violation)));
  } finally {
    cleanup(root);
  }
});

test('CLI exits 1 with the violation and 0 on a clean tree', () => {
  const bad = repo();
  const good = repo();
  try {
    fs.writeFileSync(path.join(bad, 'README.md'), '# fixture\n');
    fs.writeFileSync(path.join(good, 'README.md'), '# fixture\n');
    execFileSync('git', ['-C', bad, 'add', 'README.md']);
    execFileSync('git', ['-C', good, 'add', 'README.md']);
    if (process.platform !== 'win32') {
      fs.symlinkSync('../target', path.join(bad, 'link'));
      execFileSync('git', ['-C', bad, 'add', 'link']);
    }
    const failed = spawnSync(process.execPath, [SCRIPT, '--root', bad], { encoding: 'utf8' });
    if (process.platform !== 'win32') {
      assert.equal(failed.status, 1);
      assert.match(failed.stderr, /Tracked-file hygiene FAILED/);
      assert.match(failed.stderr, /tracked symlink: link/);
    }
    const passed = spawnSync(process.execPath, [SCRIPT, '--root', good], { encoding: 'utf8' });
    assert.equal(passed.status, 0, passed.stderr);
    assert.match(passed.stdout, /Tracked-file hygiene OK/);
  } finally {
    cleanup(bad);
    cleanup(good);
  }
});

test('non-repository root exits 2 (a missing prerequisite is not a pass)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hygiene-nogit-'));
  try {
    const result = spawnSync(process.execPath, [SCRIPT, '--root', dir], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Tracked-file hygiene error: git ls-files failed/);
  } finally {
    cleanup(dir);
  }
});
