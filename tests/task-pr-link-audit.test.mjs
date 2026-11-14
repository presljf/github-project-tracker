import test from 'node:test';
import assert from 'node:assert/strict';
import { auditTracker, checkoutPrFromComments } from '../scripts/adopt/cli/audit.mjs';
import { closingRefsFromBody, pullClosesIssue } from '../scripts/adopt/lib/pr-link.mjs';

function config(overrides = {}) {
  return {
    trackerVersion: 1,
    repository: 'owner/repo',
    project: { owner: 'owner', title: 'Project Tracker', number: 1 },
    statuses: ['Todo', 'In Progress', 'In Review', 'Blocked', 'Done', 'Proposed', 'Deferred'],
    issueTypes: { task: 'Task', bug: 'Bug', feature: 'Feature' },
    workProfile: 'tooling',
    fields: { Stream: { name: 'Stream' } },
    automation: { templateVersion: '1.0.0' },
    guard: {},
    ...overrides,
  };
}

function closedTask() {
  return {
    number: 50,
    title: '[v1.5.0-T01] Closed task',
    state: 'CLOSED',
    issueType: { name: 'Task' },
    milestone: null,
    labels: [],
    assignees: [],
    body: '## Acceptance criteria\n- [x] Done',
  };
}

function data(prLinks = {}) {
  return {
    issues: [closedTask()],
    projectItems: [],
    comments: { 50: ['### Check-out\n- **PR:** https://github.com/owner/repo/pull/70\n- **Evidence:** tests'] },
    subIssues: {},
    dependencies: {},
    prLinks,
  };
}

test('checkout PR parsing', () => {
  assert.deepEqual(checkoutPrFromComments(['- **PR:** https://github.com/owner/repo/pull/70']), {
    number: 70,
    url: 'https://github.com/owner/repo/pull/70',
  });
  assert.equal(checkoutPrFromComments(['- **PR:** not provided']), null);
});

test('PR closing helpers accept linked refs or body keyword', () => {
  assert.deepEqual(closingRefsFromBody('Closes #50'), [50]);
  assert.equal(pullClosesIssue({ closingIssuesReferences: [{ number: 50 }] }, 50), true);
  assert.equal(pullClosesIssue({ body: 'Fixes #50' }, 50), true);
  assert.equal(pullClosesIssue({ body: 'Part of #50' }, 50), false);
});

test('closed task with an unlinked merged PR fails audit', () => {
  const result = auditTracker({
    config: config(),
    data: data({ 50: { state: 'MERGED', body: 'Part of #50', closingIssuesReferences: [] } }),
  });
  assert.ok(result.violations.some((entry) => entry.code === 'TASK_PR_LINK_MISSING'));
});

test('closed task with a linked PR or body closing keyword passes', () => {
  const linked = auditTracker({
    config: config(),
    data: data({ 50: { state: 'MERGED', body: '', closingIssuesReferences: [{ number: 50 }] } }),
  });
  assert.equal(linked.ok, true, JSON.stringify(linked.violations));
  const backfilled = auditTracker({
    config: config(),
    data: data({ 50: { state: 'MERGED', body: 'Closes #50', closingIssuesReferences: [] } }),
  });
  assert.equal(backfilled.ok, true, JSON.stringify(backfilled.violations));
});

test('closed task with an unmerged PR fails audit', () => {
  const result = auditTracker({
    config: config(),
    data: data({ 50: { state: 'OPEN', body: 'Closes #50', closingIssuesReferences: [] } }),
  });
  assert.ok(result.violations.some((entry) => entry.code === 'TASK_PR_NOT_MERGED'));
});

test('reviewed historical exception skips the PR-link rule', () => {
  const result = auditTracker({
    config: config({ guard: { taskPrLinkExceptions: [{ issue: 50, reason: 'historical pilot' }] } }),
    data: data({ 50: { state: 'MERGED', body: 'Part of #50' } }),
  });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});
