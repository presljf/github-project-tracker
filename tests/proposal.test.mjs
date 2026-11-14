import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { issueKind } from '../scripts/adopt/cli/audit.mjs';
import {
  acceptProposal,
  createProposal,
  deferProposal,
  importProposal,
  listProposals,
  rejectProposal,
} from '../scripts/adopt/cli/proposal.mjs';
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
        option('o_deferred', 'Deferred'),
      ],
    },
    { id: 'f_stream', name: 'Stream', options: [option('o_stream', 'v1.5.0')] },
    { id: 'f_area', name: 'Area', options: [option('o_cross', 'cross')] },
    { id: 'f_kind', name: 'Kind', options: [option('o_infra', 'infra')] },
    { id: 'f_estimate', name: 'Estimate', options: [option('o_s', 'S'), option('o_m', 'M'), option('o_l', 'L')] },
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

function lifecycleGithub() {
  return new FakeGitHub({
    projects: [{ id: 'P1', number: 1, title: 'Project Tracker', owner: 'owner' }],
    fields: fields(),
    issues: [
      {
        number: 100,
        title: '[Proposal] Ship proposal model',
        body: proposalTemplate(),
        state: 'OPEN',
        labels: [PROPOSAL_LABEL],
        issueType: { name: 'Feature' },
        url: 'https://github.com/owner/repo/issues/100',
      },
      {
        number: 200,
        title: '[Stream] v1.5.0 — Proposal model',
        body: '# Stream v1.5.0\n',
        state: 'OPEN',
        labels: [],
        issueType: { name: 'Feature' },
        url: 'https://github.com/owner/repo/issues/200',
      },
    ],
    items: [
      {
        id: 'ITEM_100',
        content: { number: 100, title: '[Proposal] Ship proposal model' },
        status: 'Proposed',
        area: 'cross',
        kind: 'infra',
        estimate: 'L',
        source: 'Internal',
      },
      {
        id: 'ITEM_200',
        content: { number: 200, title: '[Stream] v1.5.0 — Proposal model' },
        status: 'Todo',
        stream: 'v1.5.0',
        area: 'cross',
        kind: 'infra',
        estimate: 'M',
        source: 'Internal',
      },
    ],
  });
}

test('proposal accept converts in place into a tooling task', async () => {
  const gh = lifecycleGithub();
  const result = await acceptProposal({
    config: config(),
    github: gh,
    issueNumber: 100,
    title: '[v1.5.0-T01] Ship proposal model',
    streamNumber: 200,
  });
  assert.equal(result.action, 'accept');
  const issue = gh.issues.find((entry) => entry.number === 100);
  assert.equal(issue.title, '[v1.5.0-T01] Ship proposal model');
  assert.equal(issue.type, 'Task');
  assert.ok(!issue.labels.includes(PROPOSAL_LABEL));
  for (const section of [
    'Why / context',
    'Current behavior',
    'Goal',
    'Non-goals',
    'Acceptance criteria',
    'Test plan',
    'Verification evidence',
    'Dependencies / blockers',
    'Risks / rollback',
  ])
    assert.match(issue.body, new RegExp(`^## ${section}`, 'm'));
  const item = gh.items.find((entry) => entry.id === 'ITEM_100');
  assert.equal(item.status, 'Todo');
  assert.equal(item.stream, 'v1.5.0');
  assert.deepEqual(gh.subIssues.get(200), [100]);
});

test('proposal defer moves board status and records reason', async () => {
  const gh = lifecycleGithub();
  const result = await deferProposal({ config: config(), github: gh, issueNumber: 100, reason: 'Not this release' });
  assert.equal(result.action, 'defer');
  assert.equal(gh.items.find((entry) => entry.id === 'ITEM_100').status, 'Deferred');
  assert.ok(gh.comments[100][0].includes('Not this release'));
});

test('proposal reject records reason and closes the issue', async () => {
  const gh = lifecycleGithub();
  const result = await rejectProposal({ config: config(), github: gh, issueNumber: 100, reason: 'Out of scope' });
  assert.equal(result.action, 'reject');
  assert.equal(gh.issues.find((entry) => entry.number === 100).state, 'CLOSED');
  assert.equal(gh.items.find((entry) => entry.id === 'ITEM_100').status, 'Done');
  assert.ok(gh.comments[100][0].includes('Out of scope'));
});

test('proposal create makes a board-managed proposal', async () => {
  const gh = new FakeGitHub({
    projects: [{ id: 'P1', number: 1, title: 'Project Tracker', owner: 'owner' }],
    fields: fields(),
    issues: [],
    items: [],
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-create-'));
  const bodyFile = path.join(dir, 'body.md');
  fs.writeFileSync(bodyFile, proposalTemplate());
  try {
    const result = await createProposal({
      config: config(),
      github: gh,
      title: 'Board-managed intake',
      bodyFile,
    });
    assert.equal(result.action, 'create');
    const issue = gh.issues.find((entry) => entry.number === result.issue);
    assert.equal(issue.title, '[Proposal] Board-managed intake');
    assert.equal(issue.type, 'Feature');
    const item = gh.items.find((entry) => entry.content.number === result.issue);
    assert.equal(item.status, 'Proposed');
    assert.equal(item.area, 'cross');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
