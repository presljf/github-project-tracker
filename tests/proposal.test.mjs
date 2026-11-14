import test from 'node:test';
import assert from 'node:assert/strict';
import { issueKind } from '../scripts/adopt/cli/audit.mjs';
import { importProposal, listProposals } from '../scripts/adopt/cli/proposal.mjs';
import {
  isProposalTitle,
  missingProposalSections,
  PROPOSAL_LABEL,
  proposalTemplate,
  toProposalTitle,
} from '../scripts/adopt/lib/proposal.mjs';
import { FakeGitHub } from './helpers/fake-github.mjs';

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

function fields() {
  const option = (id, name) => ({ id, name, color: 'GRAY' });
  return [
    {
      id: 'f_status',
      name: 'Status',
      options: [
        option('o_todo', 'Todo'),
        option('o_progress', 'In Progress'),
        option('o_review', 'In Review'),
        option('o_blocked', 'Blocked'),
        option('o_done', 'Done'),
        option('o_proposed', 'Proposed'),
      ],
    },
    { id: 'f_area', name: 'Area', options: [option('o_cross', 'cross')] },
    { id: 'f_kind', name: 'Kind', options: [option('o_infra', 'infra')] },
    { id: 'f_estimate', name: 'Estimate', options: [option('o_m', 'M')] },
    { id: 'f_source', name: 'Source', options: [option('o_internal', 'Internal')] },
  ];
}

function github({ body = proposalTemplate(), labels = [], type = null } = {}) {
  return new FakeGitHub({
    projects: [{ id: 'P1', number: 1, title: 'Project Tracker', owner: 'owner' }],
    fields: fields(),
    issues: [
      {
        number: 100,
        title: 'Adopt review-map guard',
        body,
        state: 'OPEN',
        labels,
        issueType: type ? { name: type } : null,
        url: 'https://github.com/owner/repo/issues/100',
      },
    ],
    items: [],
  });
}

test('proposal title/body contract', () => {
  assert.equal(isProposalTitle('[Proposal] x'), true);
  assert.equal(isProposalTitle('[Task] x'), false);
  assert.equal(toProposalTitle('Adopt guard'), '[Proposal] Adopt guard');
  assert.equal(toProposalTitle('[Proposal] Adopt guard'), '[Proposal] Adopt guard');
  assert.deepEqual(missingProposalSections(proposalTemplate()), []);
  assert.equal(issueKind('[Proposal] x'), 'proposal');
});

test('proposal import validates and converts an existing issue', async () => {
  const gh = github();
  const result = await importProposal({ config: config(), github: gh, issueNumber: 100 });
  assert.equal(result.action, 'import');
  assert.equal(result.title, '[Proposal] Adopt review-map guard');
  assert.equal(result.projectItemAdded, true);
  assert.equal(gh.issues[0].title, '[Proposal] Adopt review-map guard');
  assert.equal(gh.issues[0].type, 'Feature');
  assert.ok(gh.issues[0].labels.includes(PROPOSAL_LABEL));
  const item = gh.items.find((entry) => entry.content.number === 100);
  assert.equal(item.status, 'Proposed');
  assert.equal(item.area, 'cross');
  assert.equal(item.kind, 'infra');
  assert.equal(item.estimate, 'M');
  assert.equal(item.source, 'Internal');
});

test('proposal import rejects a missing section before mutating', async () => {
  const gh = github({ body: '## Proposal\nOnly one section\n' });
  await assert.rejects(importProposal({ config: config(), github: gh, issueNumber: 100 }), /missing required section/);
  assert.deepEqual(gh.mutations, []);
});

test('proposal import dry-run makes no mutations', async () => {
  const gh = github();
  const result = await importProposal({ config: config(), github: gh, issueNumber: 100, dryRun: true });
  assert.equal(result.dryRun, true);
  assert.deepEqual(gh.mutations, []);
});

test('proposal list returns open proposal issues', async () => {
  const gh = github();
  gh.issues[0].title = '[Proposal] Adopt review-map guard';
  gh.issues.push({
    number: 101,
    title: '[Proposal] Another',
    body: proposalTemplate(),
    state: 'OPEN',
    labels: [PROPOSAL_LABEL],
    issueType: { name: 'Feature' },
  });
  const result = await listProposals({ config: config(), github: gh });
  assert.equal(result.count, 2);
  assert.deepEqual(
    result.proposals.map((entry) => entry.number),
    [100, 101],
  );
});
