import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTitle, evaluateMetadata, resolveRepoArgument } from '../scripts/adopt/cli/verify-metadata.mjs';

const contract = {
  metadata: {
    requiredIssueTypes: ['Task', 'Bug', 'Feature'],
    typeMapping: { release: 'Task', sprint: 'Task', task: 'Feature' },
    requiredFields: ['Status', 'Release', 'Sprint'],
    requiredOptions: { Status: ['Todo', 'Done'] },
    hierarchy: { release: ['sprint'], sprint: ['task'] },
    uniqueKeys: true,
  },
};
const issueTypes = [{ name: 'Task' }, { name: 'Bug' }, { name: 'Feature' }];
const fields = [
  { name: 'Status', options: [{ name: 'Todo' }, { name: 'Done' }] },
  { name: 'Release', options: [] },
  { name: 'Sprint', options: [] },
];
const base = [
  { number: 1, title: '[Release] v1.0.0 — release', issueType: { name: 'Task' }, parent: null },
  { number: 2, title: '[Sprint] 1.0.0.1 — sprint', issueType: { name: 'Task' }, parent: { number: 1 } },
  { number: 3, title: '[1.0.0.1-T01] task', issueType: { name: 'Feature' }, parent: { number: 2 } },
];
test('classifies titles', () => {
  assert.equal(classifyTitle(base[0].title).kind, 'release');
  assert.equal(classifyTitle(base[1].title).kind, 'sprint');
  assert.equal(classifyTitle(base[2].title).kind, 'task');
});
test('clean metadata passes', () =>
  assert.equal(evaluateMetadata({ contract, issueTypes, fields, issues: base }).ok, true));
test('wrong type fails', () =>
  assert.ok(
    evaluateMetadata({
      contract,
      issueTypes,
      fields,
      issues: [{ ...base[2], issueType: { name: 'Task' } }],
    }).violations.some((v) => v.includes('type=Task')),
  ));
test('wrong hierarchy fails', () =>
  assert.ok(
    evaluateMetadata({
      contract,
      issueTypes,
      fields,
      issues: [base[0], base[1], { ...base[2], parent: { number: 1 } }],
    }).violations.some((v) => v.includes('parent is not a Sprint')),
  ));
test('duplicate sprint key fails', () => {
  const dup = { ...base[1], number: 4, parent: { number: 1 } };
  assert.ok(
    evaluateMetadata({ contract, issueTypes, fields, issues: [...base, dup] }).violations.some((v) =>
      v.includes('duplicate sprint key'),
    ),
  );
});
test('missing field fails', () =>
  assert.ok(
    evaluateMetadata({ contract, issueTypes, fields: [], issues: [] }).violations.some((v) =>
      v.includes('project field missing'),
    ),
  ));

test('accepts canonical and flags legacy title formats', () => {
  assert.deepEqual(classifyTitle('[Sprint] 1.2.1.1 — sprint'), { kind: 'sprint', key: '1.2.1.1' });
  assert.deepEqual(classifyTitle('[Release] v1.2.1 — release'), { kind: 'release', key: 'v1.2.1' });
  assert.deepEqual(classifyTitle('[0.5.6] Sprint — sprint'), { kind: 'legacy', key: null });
  assert.deepEqual(classifyTitle('[v0.5.0] Release tracking — release'), { kind: 'legacy', key: null });
});

test('explicit issue exceptions are excluded from metadata checks', () => {
  const issues = [
    { number: 1, title: '[Release] v1.0.0 — x', issueType: { name: 'Task' }, parent: null },
    { number: 2, title: '[Release] v1.0.0 — duplicate', issueType: { name: 'Task' }, parent: null },
  ];
  const exceptions = [{ issues: [2], repo: 'o/r' }];
  assert.equal(evaluateMetadata({ contract, issueTypes, fields, issues, exceptions }).ok, true);
});

test('repo argument resolves from --repo or GITHUB_REPOSITORY and never defaults silently', () => {
  assert.equal(resolveRepoArgument({ repo: 'owner/repo', env: {} }), 'owner/repo');
  assert.equal(resolveRepoArgument({ repo: '', env: { GITHUB_REPOSITORY: 'env/repo' } }), 'env/repo');
  assert.equal(resolveRepoArgument({ repo: 'flag/repo', env: { GITHUB_REPOSITORY: 'env/repo' } }), 'flag/repo');
  assert.throws(() => resolveRepoArgument({ repo: null, env: {} }), /repo is required: pass --repo owner\/repo/);
  assert.throws(() => resolveRepoArgument({ repo: 'not-a-repo', env: {} }), /repo is required/);
});
