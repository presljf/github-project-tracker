import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTooling, major } from '../scripts/github/verify-tooling.mjs';
const contract = {
  trackerVersion: '1.2.1',
  tooling: {
    eslint: '^10.14.0',
    '@eslint/js': '^10.0.1',
    globals: '^17.14.0',
    config: 'profiles/node/eslint.config.mjs',
  },
};
const pkg = {
  devDependencies: { eslint: '^10.14.0', '@eslint/js': '^10.0.1', globals: '^17.14.0', prettier: '^3.10.0' },
};
test('major parses ranges', () => assert.equal(major('^10.14.0'), 10));
test('clean tooling passes', () =>
  assert.equal(
    evaluateTooling({
      contract,
      pkg,
      configText: "import baseline from 'profiles/node/eslint.config.mjs';",
      submoduleTag: 'v1.2.1',
    }).ok,
    true,
  ));
test('major drift fails', () =>
  assert.ok(
    evaluateTooling({
      contract,
      pkg: { devDependencies: { eslint: '^9.0.0', '@eslint/js': '^10', globals: '^17' } },
      configText: 'profiles/node/eslint.config.mjs',
    }).violations.some((v) => v.includes('eslint major')),
  ));
test('missing shared import and warning overrides fail', () => {
  const r = evaluateTooling({ contract, pkg, configText: "/* no baseline */ 'no-useless-assignment': 'warn'" });
  assert.ok(r.violations.some((v) => v.includes('shared baseline')));
  assert.ok(r.violations.some((v) => v.includes('warning override')));
});
