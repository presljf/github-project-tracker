import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCoverage } from '../scripts/adopt/docs/guard-docs.mjs';

const rules = [
  { id: 'scripts', paths: ['scripts/'], docs: ['docs/REFERENCE.md'] },
  { id: 'workflows', paths: ['.github/workflows/'], docs: ['docs/CI_SECURITY_PROFILE.md'] },
];
const ignore = ['tests/', 'docs/'];

test('source change without mapped docs fails', () => {
  const result = evaluateCoverage({ changedFiles: ['scripts/adopt/cli/x.mjs'], rules, ignore });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.code === 'DOCS_MISSING'));
});

test('source change with mapped docs passes', () => {
  const result = evaluateCoverage({ changedFiles: ['scripts/adopt/cli/x.mjs', 'docs/REFERENCE.md'], rules, ignore });
  assert.equal(result.ok, true);
});

test('unmapped source fails', () => {
  const result = evaluateCoverage({ changedFiles: ['infra/x.mjs'], rules, ignore });
  assert.ok(result.violations.some((v) => v.code === 'UNMAPPED_SOURCE'));
});

test('ignored tests/docs do not require coverage', () => {
  const result = evaluateCoverage({ changedFiles: ['tests/a.test.mjs', 'docs/REFERENCE.md'], rules, ignore });
  assert.equal(result.ok, true);
});

test('auditable docs:no-change exception suppresses docs violations', () => {
  const result = evaluateCoverage({
    changedFiles: ['scripts/adopt/cli/x.mjs'],
    rules,
    ignore,
    labels: ['docs:no-change'],
    exceptionReason: 'no user-facing change',
  });
  assert.equal(result.ok, true);
  assert.ok(result.skipped);
});

test('Feature/Bug-linked change requires docs', () => {
  const result = evaluateCoverage({ changedFiles: ['tests/a.test.mjs'], rules, ignore, linkedIssueType: 'Feature' });
  assert.ok(result.violations.some((v) => v.code === 'DOCS_REQUIRED_FOR_ISSUE_TYPE'));
});
