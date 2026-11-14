import test from 'node:test';
import assert from 'node:assert/strict';
import { auditTracker } from '../scripts/adopt/cli/audit.mjs';
import { PROPOSAL_LABEL, proposalTemplate } from '../scripts/adopt/lib/proposal.mjs';

function config() {
  return {
    trackerVersion: 1,
    repository: 'owner/repo',
    project: { owner: 'owner', title: 'Project Tracker', number: 1 },
    statuses: ['Todo', 'In Progress', 'In Review', 'Blocked', 'Done', 'Proposed'],
    issueTypes: { task: 'Task', bug: 'Bug', feature: 'Feature' },
    workProfile: 'tooling',
    fields: { Stream: { name: 'Stream' } },
    automation: { templateVersion: '1.0.0' },
  };
}

function proposalIssue(extra = {}) {
  return {
    number: 10,
    title: '[Proposal] Adopt the thing',
    state: 'OPEN',
    issueType: { name: 'Feature' },
    milestone: null,
    labels: [PROPOSAL_LABEL],
    assignees: [],
    body: proposalTemplate(),
    ...extra,
  };
}

function proposalItem(extra = {}) {
  return {
    content: { number: 10 },
    status: 'Proposed',
    release: '',
    sprint: '',
    area: 'cross',
    kind: 'infra',
    estimate: 'M',
    source: 'Internal',
    ...extra,
  };
}

function data(issue = proposalIssue(), item = proposalItem()) {
  return {
    issues: [issue],
    projectItems: item ? [item] : [],
    comments: {},
    subIssues: {},
    dependencies: {},
  };
}

test('valid proposal passes audit without delivery hierarchy', () => {
  const result = auditTracker({ config: config(), data: data() });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.deepEqual(result.violations, []);
});

test('proposal missing label, section, or Proposed status fails', () => {
  const missingLabel = auditTracker({ config: config(), data: data(proposalIssue({ labels: [] })) });
  assert.ok(missingLabel.violations.some((entry) => entry.code === 'PROPOSAL_LABEL_MISSING'));

  const missingSection = auditTracker({
    config: config(),
    data: data(proposalIssue({ body: '## Proposal\nOnly this\n' })),
  });
  assert.ok(missingSection.violations.some((entry) => entry.code === 'PROPOSAL_SECTION_MISSING'));

  const wrongStatus = auditTracker({ config: config(), data: data(proposalIssue(), proposalItem({ status: 'Todo' })) });
  assert.ok(wrongStatus.violations.some((entry) => entry.code === 'PROPOSAL_STATUS_MISSING'));
});

test('deferred proposal is still audit-clean', () => {
  const result = auditTracker({ config: config(), data: data(proposalIssue(), proposalItem({ status: 'Deferred' })) });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});

test('proposal does not require a milestone or stream ancestry', () => {
  const result = auditTracker({ config: config(), data: data() });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});
