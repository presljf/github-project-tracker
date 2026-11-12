import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyContract } from '../scripts/github/verify-contract.mjs';

const contract = {
  trackerVersion: '1.0.2',
  requiredConfig: ['repository', 'automation.templateVersion'],
  requiredWorkflows: [{ id: 'ci', reusable: 'presljf/github-project-tracker/.github/workflows/reusable-ci.yml' }],
  requiredProfiles: ['node'],
  requiredDocs: ['docs/TRACKER.md'],
  overrideManifest: 'tracker.overrides.json',
};
function fixture({ pin = '1.0.2', workflow = true, docs = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-'));
  fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tracker.config.json'), JSON.stringify({ repository: 'x/y', automation: { templateVersion: pin }, profiles: { node: {} } }));
  if (docs) fs.writeFileSync(path.join(root, 'docs/TRACKER.md'), '# tracker\n');
  if (workflow) fs.writeFileSync(path.join(root, '.github/workflows/ci.yml'), 'jobs:\n  ci:\n    uses: presljf/github-project-tracker/.github/workflows/reusable-ci.yml@v1.0.2\n');
  return root;
}
test('clean exact pin passes', () => {
  const root = fixture();
  assert.equal(verifyContract({ root, contract, config: JSON.parse(fs.readFileSync(path.join(root,'tracker.config.json'))) }).ok, true);
});
test('stale pin fails', () => {
  const root = fixture({ pin: '1.0.1' });
  assert.ok(verifyContract({ root, contract, config: JSON.parse(fs.readFileSync(path.join(root,'tracker.config.json'))) }).violations.some((v) => v.includes('templateVersion')));
});
test('missing required workflow without override fails', () => {
  const root = fixture({ workflow: false });
  assert.ok(verifyContract({ root, contract, config: JSON.parse(fs.readFileSync(path.join(root,'tracker.config.json'))) }).violations.some((v) => v.includes('required workflow missing')));
});
test('valid OI override allows missing workflow', () => {
  const root = fixture({ workflow: false });
  const overrides = { overrides: [{ id: 'ci', issue: 'https://github.com/o/r/issues/1', reason: 'legacy', expires: '2099-01-01' }] };
  assert.equal(verifyContract({ root, contract, config: JSON.parse(fs.readFileSync(path.join(root,'tracker.config.json'))), overrides }).ok, true);
});
test('expired override fails', () => {
  const root = fixture({ workflow: false });
  const overrides = { overrides: [{ id: 'ci', issue: 'https://github.com/o/r/issues/1', reason: 'legacy', expires: '2000-01-01' }] };
  assert.ok(verifyContract({ root, contract, config: JSON.parse(fs.readFileSync(path.join(root,'tracker.config.json'))), overrides }).violations.some((v) => v.includes('expired')));
});
