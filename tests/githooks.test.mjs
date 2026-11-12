import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const hook = (name) => path.join(root, '.githooks', name);
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-'));
  execFileSync('git', ['init', '-b', 'main', dir], { stdio: 'ignore' });
  return dir;
}
function run(name, cwd, env = {}, input = '') {
  const r = spawnSync('sh', [hook(name)], { cwd, env: { ...process.env, ...env }, input, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

test('pre-commit blocks main and allows task branches', () => {
  const cwd = repo();
  assert.equal(run('pre-commit', cwd).code, 1);
  execFileSync('git', ['switch', '-c', 'task/1-test'], { cwd, stdio: 'ignore' });
  assert.equal(run('pre-commit', cwd).code, 0);
});
test('pre-commit audited main override warns but permits', () => {
  const cwd = repo();
  const result = run('pre-commit', cwd, { TRACKER_ALLOW_MAIN_COMMIT: '1' });
  assert.equal(result.code, 0);
  assert.match(result.out, /WARNING/);
});
test('pre-push blocks direct main and allows task branch', () => {
  const cwd = repo();
  assert.equal(run('pre-push', cwd, {}, 'refs/heads/main abc refs/heads/main def\n').code, 1);
  assert.equal(run('pre-push', cwd, {}, 'refs/heads/task/1-test abc refs/heads/task/1-test def\n').code, 0);
});
test('post-checkout warns on main', () => {
  const r = spawnSync('sh', [hook('post-checkout'), 'old', 'new', '1'], { cwd: repo(), encoding: 'utf8' });
  assert.match(`${r.stdout || ''}${r.stderr || ''}`, /WARNING/);
});
test('hooks are versioned and executable', () => {
  for (const name of ['pre-commit', 'pre-push', 'post-checkout']) assert.ok(fs.statSync(hook(name)).mode & 0o111);
});
