import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startTask,
  checkpointTask,
  reviewTask,
  blockTask,
  doneTask,
  statusTask,
  checkDoR,
} from '../scripts/adopt/cli/task.mjs';
import { FakeTaskGitHub } from './helpers/fake-task-github.mjs';

const _silent = { log() {}, warn() {}, error() {} };

function projectConfig() {
  return {
    trackerVersion: 1,
    repository: 'owner/repo',
    project: { owner: 'owner', title: 'Project Tracker', number: 1, id: 'PVT_test' },
    statuses: ['Todo', 'In Progress', 'In Review', 'Blocked', 'Done'],
    fields: {
      Release: { options: ['v1.0.0'] },
      Sprint: { options: ['1.0.0.1'] },
      Area: { options: ['docs'] },
      Kind: { options: ['infra'] },
      Estimate: { options: ['M'] },
      Source: { options: ['Internal'] },
    },
    releases: [{ key: 'v1.0.0', milestone: 'v1.0.0' }],
    automation: { defaultAssignee: 'owner', templateVersion: '1.0.0' },
  };
}

function fields() {
  return (
    ['Todo', 'In Progress', 'In Review', 'Blocked', 'Done'].map((status) => ({
      id: `FIELD_STATUS`.replace('STATUS', status.replace(/\s+/g, '_').toUpperCase()),
      name: 'Status',
      options: [
        { id: 'OPT_TODO', name: 'Todo' },
        { id: 'OPT_PROGRESS', name: 'In Progress' },
        { id: 'OPT_REVIEW', name: 'In Review' },
        { id: 'OPT_BLOCKED', name: 'Blocked' },
        { id: 'OPT_DONE', name: 'Done' },
      ],
    }))[0] && [
      {
        id: 'FIELD_STATUS',
        name: 'Status',
        options: [
          { id: 'OPT_TODO', name: 'Todo' },
          { id: 'OPT_PROGRESS', name: 'In Progress' },
          { id: 'OPT_REVIEW', name: 'In Review' },
          { id: 'OPT_BLOCKED', name: 'Blocked' },
          { id: 'OPT_DONE', name: 'Done' },
        ],
      },
      { id: 'FIELD_RELEASE', name: 'Release', options: [{ id: 'OPT_RELEASE', name: 'v1.0.0' }] },
      { id: 'FIELD_SPRINT', name: 'Sprint', options: [{ id: 'OPT_SPRINT', name: '1.0.0.1' }] },
      { id: 'FIELD_AREA', name: 'Area', options: [{ id: 'OPT_AREA', name: 'docs' }] },
      { id: 'FIELD_KIND', name: 'Kind', options: [{ id: 'OPT_KIND', name: 'infra' }] },
      { id: 'FIELD_ESTIMATE', name: 'Estimate', options: [{ id: 'OPT_ESTIMATE', name: 'M' }] },
      { id: 'FIELD_SOURCE', name: 'Source', options: [{ id: 'OPT_SOURCE', name: 'Internal' }] },
    ]
  );
}

function item(number, extra = {}) {
  return {
    id: `ITEM_${number}`,
    content: { number },
    status: 'Todo',
    release: 'v1.0.0',
    sprint: '1.0.0.1',
    area: 'docs',
    kind: 'infra',
    estimate: 'M',
    source: 'Internal',
    ...extra,
  };
}

function issue(number = 5, extra = {}) {
  return {
    number,
    title: '[Task] Example task',
    state: 'OPEN',
    type: 'Task',
    milestone: 'v1.0.0',
    body: '## Acceptance criteria\n- [x] Done thing',
    assignees: [],
    url: `https://github.com/owner/repo/issues/${number}`,
    ...extra,
  };
}

function fake({ issues = [issue()], items = [item(5)], deps = {} } = {}) {
  return new FakeTaskGitHub({
    projects: [{ id: 'PVT_test', number: 1, title: 'Project Tracker' }],
    fields: fields(),
    issues,
    items,
    issueDeps: deps,
  });
}

function baseArgs() {
  return {
    config: projectConfig(),
    issueNumber: 5,
    owner: 'owner',
    executor: 'agent:test',
    dryRun: false,
    repoRoot: process.cwd(),
    gitExec: () => 'deadbee',
  };
}

test('start checks DoR, assigns owner, sets In Progress, posts check-in', async () => {
  const github = fake();
  const result = await startTask({ ...baseArgs(), github });
  assert.equal(result.ok, true);
  assert.match(result.comment, /### Check-in/);
  assert.equal(github.items[0].status, 'In Progress');
  assert.deepEqual(github.issues[0].assignees, [{ login: 'owner' }]);
  assert.ok(github.mutations.some((mutation) => mutation[0] === 'addComment'));
});

test('start dry-run validates without mutations', async () => {
  const github = fake();
  const result = await startTask({ ...baseArgs(), github, dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(github.mutations.length, 0);
  assert.equal(github.items[0].status, 'Todo');
});

test('start records a comment digest and done rejects stale comments', async () => {
  const github = fake();
  await startTask({ ...baseArgs(), github });
  const checkIn = github.commentsByIssue[5].at(-1);
  assert.match(checkIn, /tracker-comment-digest/);
  github.commentsByIssue[5].push('a new comment after check-in');
  await assert.rejects(
    () => doneTask({ config: projectConfig(), github, issueNumber: 5, evidence: 'tests pass' }),
    /comment review is stale/,
  );
});

test('start rejects a task branch for another issue', async () => {
  const github = fake();
  await assert.rejects(
    () => startTask({ ...baseArgs(), github, branch: 'task/999-other', dryRun: true }),
    /does not belong to task #5/,
  );
});

test('start accepts a task branch for the issue', async () => {
  const github = fake();
  const result = await startTask({ ...baseArgs(), github, branch: 'task/5-ok', dryRun: true });
  assert.equal(result.branch, 'task/5-ok');
});

test('start rejects WIP violation', async () => {
  const github = fake({
    issues: [issue(), issue(6, { assignees: [{ login: 'owner' }] })],
    items: [item(5), item(6, { status: 'In Progress' })],
  });
  await assert.rejects(() => startTask({ ...baseArgs(), github }), /WIP limit/);
});

test('DoR rejects missing acceptance criteria and blocked dependencies', async () => {
  const noAcceptance = fake({ issues: [issue(5, { body: 'No criteria' })] });
  await assert.rejects(
    () => checkDoR({ config: projectConfig(), github: noAcceptance, issueNumber: 5, owner: 'owner' }),
    /Acceptance criteria/,
  );
  const blocked = fake({ deps: { 5: { blocked_by: 1 } } });
  await assert.rejects(
    () => checkDoR({ config: projectConfig(), github: blocked, issueNumber: 5, owner: 'owner' }),
    /blocked by/,
  );
});

test('checkpoint, review, block, and status transitions', async () => {
  const github = fake();
  await startTask({ ...baseArgs(), github });
  const update = await checkpointTask({
    config: projectConfig(),
    github,
    issueNumber: 5,
    message: 'Done: work\nNext: review',
  });
  assert.match(update.comment, /### Update/);
  await reviewTask({
    config: projectConfig(),
    github,
    issueNumber: 5,
    pr: 'https://github.com/owner/repo/pull/1',
    evidence: 'tests pass',
  });
  assert.equal(github.items[0].status, 'In Review');
  await blockTask({
    config: projectConfig(),
    github,
    issueNumber: 5,
    reason: 'waiting',
    blockedBy: 'https://github.com/owner/repo/issues/6',
  });
  assert.equal(github.items[0].status, 'Blocked');
  const state = await statusTask({ config: projectConfig(), github, issueNumber: 5 });
  assert.equal(state.status, 'Blocked');
  assert.equal(state.assignees[0], 'owner');
});

test('done rejects unchecked acceptance unless forced, then closes with evidence', async () => {
  const github = fake({ issues: [issue(5, { body: '## Acceptance criteria\n- [ ] Not done' })] });
  await assert.rejects(
    () => doneTask({ config: projectConfig(), github, issueNumber: 5, evidence: 'x' }),
    /unchecked acceptance/,
  );
  const result = await doneTask({
    config: projectConfig(),
    github,
    issueNumber: 5,
    evidence: 'tests pass',
    force: true,
  });
  assert.equal(result.ok, true);
  assert.equal(github.items[0].status, 'Done');
  assert.equal(github.issues[0].state, 'CLOSED');
  assert.ok(github.mutations.some((mutation) => mutation[0] === 'closeIssue'));
});

test('done dry-run makes no mutations', async () => {
  const github = fake();
  await doneTask({ config: projectConfig(), github, issueNumber: 5, evidence: 'tests pass', dryRun: true });
  assert.equal(github.mutations.length, 0);
});
