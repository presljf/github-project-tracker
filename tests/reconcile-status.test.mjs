import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStatusReconciliation,
  buildStatusReconciliation,
  resolveStatusField,
} from '../scripts/adopt/cli/reconcile-status.mjs';
import { collectAuditData } from '../scripts/adopt/cli/audit.mjs';
import { FakeTaskGitHub } from './helpers/fake-task-github.mjs';

function config(overrides = {}) {
  return {
    trackerVersion: 1,
    repository: 'owner/repo',
    project: { owner: 'owner', title: 'Project Tracker', number: 1 },
    automation: { templateVersion: '1.0.0' },
    ...overrides,
  };
}

const STATUS_FIELD = {
  id: 'FIELD_STATUS',
  name: 'Status',
  dataType: 'SINGLE_SELECT',
  options: [
    { id: 'OPT_TODO', name: 'Todo' },
    { id: 'OPT_REVIEW', name: 'In Review' },
    { id: 'OPT_DONE', name: 'Done' },
  ],
};

function fakeGitHub(overrides = {}) {
  return new FakeTaskGitHub({
    projects: [{ id: 'PVT_1', number: 1, title: 'Project Tracker' }],
    fields: [STATUS_FIELD],
    issues: [
      { number: 3, title: '[Task] Closed stale', state: 'CLOSED' },
      { number: 4, title: '[Task] Closed done', state: 'CLOSED' },
      { number: 5, title: '[Task] Open in progress', state: 'OPEN' },
      { number: 6, title: '[Task] Closed off project', state: 'CLOSED' },
    ],
    items: [
      { id: 'ITEM_3', content: { number: 3 }, status: 'In Review' },
      { id: 'ITEM_4', content: { number: 4 }, status: 'Done' },
      { id: 'ITEM_5', content: { number: 5 }, status: 'In Progress' },
    ],
    ...overrides,
  });
}

test('buildStatusReconciliation lists only closed, on-project, non-Done items', async () => {
  const github = fakeGitHub();
  const data = await collectAuditData(github, config());
  const plan = buildStatusReconciliation({ config: config(), data });
  assert.deepEqual(
    plan.map((entry) => entry.issue),
    [3],
  );
  assert.equal(plan[0].status, 'In Review');
  assert.equal(plan[0].itemId, 'ITEM_3');
  assert.match(plan[0].message, /expected Done/);
});

test('applyStatusReconciliation is report-only by default', async () => {
  const github = fakeGitHub();
  const data = await collectAuditData(github, config());
  const plan = buildStatusReconciliation({ config: config(), data });
  const outcome = await applyStatusReconciliation({ github, config: config(), plan, dryRun: true });
  assert.equal(outcome.applied.length, 1);
  assert.equal(outcome.applied[0].planned, true);
  assert.deepEqual(github.mutations, []);
});

test('applyStatusReconciliation sets flagged items to Done and is idempotent', async () => {
  const github = fakeGitHub();
  const data = await collectAuditData(github, config());
  const plan = buildStatusReconciliation({ config: config(), data });
  const outcome = await applyStatusReconciliation({ github, config: config(), plan, dryRun: false });
  assert.equal(outcome.applied.filter((entry) => entry.changed).length, 1);
  assert.deepEqual(
    github.mutations.map((mutation) => mutation[0]),
    ['setProjectItemField'],
  );
  assert.equal(github.items.find((item) => item.id === 'ITEM_3').status, 'Done');

  const after = await collectAuditData(github, config());
  assert.deepEqual(buildStatusReconciliation({ config: config(), data: after }), []);
});

test('applyStatusReconciliation skips entries without a project item id', async () => {
  const github = fakeGitHub();
  const outcome = await applyStatusReconciliation({
    github,
    config: config(),
    plan: [{ code: 'PROJECT_STATUS_STALE', issue: 3, itemId: null, status: 'In Review', message: 'stale' }],
    dryRun: false,
  });
  assert.equal(outcome.applied.length, 0);
  assert.equal(outcome.skipped.length, 1);
  assert.match(outcome.skipped[0].reason, /item id missing/);
  assert.deepEqual(github.mutations, []);
});

test('resolveStatusField fails loudly when the project or Status field is missing', async () => {
  const noProject = fakeGitHub({ projects: [] });
  await assert.rejects(() => resolveStatusField({ github: noProject, config: config() }), /project #1 not found/);

  const noField = fakeGitHub({ fields: [] });
  await assert.rejects(
    () => resolveStatusField({ github: noField, config: config() }),
    /project field Status not found/,
  );

  const noDone = fakeGitHub({
    fields: [{ ...STATUS_FIELD, options: [{ id: 'OPT_TODO', name: 'Todo' }] }],
  });
  await assert.rejects(() => resolveStatusField({ github: noDone, config: config() }), /has no Done option/);
});

test('status-drift plan is profile-agnostic and lists every closed on-project item', async () => {
  const toolingConfig = config({ workProfile: 'tooling', fields: { Stream: { options: ['v1.3.1'] } } });
  const github = new FakeTaskGitHub({
    projects: [{ id: 'PVT_1', number: 1, title: 'Project Tracker' }],
    fields: [STATUS_FIELD],
    issues: [
      { number: 10, title: '[Stream] v1.3.1 — docs', state: 'CLOSED' },
      { number: 11, title: '[Task] Stream task stale', state: 'CLOSED' },
      { number: 12, title: '[Task] Historical product task stale', state: 'CLOSED' },
    ],
    items: [
      { id: 'ITEM_10', content: { number: 10 }, status: 'Done' },
      { id: 'ITEM_11', content: { number: 11 }, status: 'In Review' },
      { id: 'ITEM_12', content: { number: 12 }, status: 'In Review' },
    ],
  });
  github.subIssues.set(10, [11]);
  const data = await collectAuditData(github, toolingConfig);
  // Status is current-state board metadata, so there is no Stream-ancestry/historical exemption:
  // both closed non-Done items are drift regardless of work profile.
  assert.deepEqual(
    buildStatusReconciliation({ config: toolingConfig, data }).map((entry) => entry.issue),
    [11, 12],
  );
  assert.deepEqual(
    buildStatusReconciliation({ config: config(), data }).map((entry) => entry.issue),
    [11, 12],
  );
});

test('plan handles unset status, filters foreign-repo items, and is number-sorted', async () => {
  const github = fakeGitHub({
    issues: [
      { number: 9, title: '[Task] Unset status', state: 'CLOSED' },
      { number: 3, title: '[Task] Closed stale', state: 'CLOSED' },
      { number: 7, title: '[Task] Foreign repo stale', state: 'CLOSED' },
    ],
    items: [
      { id: 'ITEM_9', content: { number: 9 }, status: '' },
      { id: 'ITEM_3', content: { number: 3 }, status: 'In Review' },
      { id: 'ITEM_7', content: { number: 7, repository: 'other/repo' }, status: 'In Review' },
    ],
  });
  const data = await collectAuditData(github, config());
  const plan = buildStatusReconciliation({ config: config(), data });
  assert.deepEqual(
    plan.map((entry) => entry.issue),
    [3, 9],
  );
  assert.equal(plan[1].status, null);
  assert.match(plan[1].message, /no Project status/);
});

test('audit data collection requests project items beyond the default page size', async () => {
  const github = fakeGitHub();
  await collectAuditData(github, config());
  const call = github.calls.find((entry) => entry[0] === 'listProjectItems');
  assert.deepEqual(call, ['listProjectItems', 'owner', 1, { limit: 1000 }]);
});
