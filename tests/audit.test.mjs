import test from 'node:test';
import assert from 'node:assert/strict';
import { auditTracker, issueKind } from '../scripts/github/audit.mjs';

function config(overrides = {}) {
  return {
    trackerVersion: 1,
    repository: 'owner/repo',
    project: { owner: 'owner', title: 'Project Tracker', number: 1 },
    automation: { templateVersion: '1.0.0' },
    ...overrides,
  };
}

function item(number, extra = {}) {
  return {
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

function issue(number, title, state = 'OPEN', extra = {}) {
  return {
    number,
    title,
    state,
    issueType: { name: 'Task' },
    milestone: { title: 'v1.0.0' },
    labels: [],
    assignees: [],
    ...extra,
  };
}

function baseData() {
  return {
    issues: [
      issue(1, '[Roadmap] Program roadmap', 'OPEN', { milestone: null }),
      issue(2, '[Release] v1.0.0'),
      issue(3, '[Sprint] 1.0.0.1 — Foundation', 'CLOSED'),
      issue(4, '[Task] Closed task', 'CLOSED'),
      issue(5, '[Task] Open todo'),
    ],
    projectItems: [
      item(1, { release: '', sprint: '', area: 'docs', kind: 'infra', estimate: 'L' }),
      item(2, { sprint: '' }),
      item(3, { status: 'Done' }),
      item(4, { status: 'Done' }),
      item(5),
    ],
    comments: {
      3: [{ body: '### Sprint demo / exit\n- Outcome: done' }],
    },
    subIssues: { 3: [4] },
    dependencies: {},
  };
}

test('clean tracker data passes', () => {
  const result = auditTracker({ config: config(), data: baseData() });
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.checked.issues, 5);
  assert.equal(result.checked.projectItems, 5);
});

test('issueKind identifies trackers vs tasks', () => {
  assert.equal(issueKind('[Roadmap] x'), 'roadmap');
  assert.equal(issueKind('[Release] x'), 'release');
  assert.equal(issueKind('[Sprint] x'), 'sprint');
  assert.equal(issueKind('[Task] x'), 'task');
  assert.equal(issueKind('[Program] Project Tracker OS v1.0.0 — roadmap & plan of record'), 'roadmap');
  assert.equal(issueKind('[v1.0.0] Release tracking — Project tracker OS'), 'release');
  assert.equal(issueKind('[1.0.0.2] Sprint — Automation toolkit + tracker workflows'), 'sprint');
  assert.equal(issueKind('[1.0.0.2-T09] Author Actions workflow catalog'), 'task');
});

test('detects missing type, milestone, project item, and fields', () => {
  const data = baseData();
  data.issues[4].issueType = null;
  data.issues[4].milestone = null;
  data.projectItems = data.projectItems.filter((entry) => entry.content.number !== 5).concat([
    { content: { number: 5 }, status: 'Todo', release: 'v1.0.0', sprint: '1.0.0.1', area: '', kind: '', estimate: '' },
  ]);
  const result = auditTracker({ config: config(), data });
  const codes = result.violations.map((violation) => violation.code);
  assert.ok(codes.includes('TYPE_MISSING'));
  assert.ok(codes.includes('MILESTONE_MISSING'));
  assert.ok(codes.includes('FIELD_AREA_MISSING'));
  assert.ok(codes.includes('FIELD_KIND_MISSING'));
  assert.ok(codes.includes('FIELD_ESTIMATE_MISSING'));
  assert.equal(result.ok, false);
});

test('detects WIP limit, missing check-in, and blocked without dependency', () => {
  const data = baseData();
  data.issues.push(issue(6, '[Task] Second active', 'OPEN', { assignees: [{ login: 'owner' }] }));
  data.issues[4].assignees = [{ login: 'owner' }];
  data.projectItems.push(item(4, { status: 'In Progress' }));
  // make #5 and #6 In Progress, both owned by owner, only #5 checked in
  data.projectItems = data.projectItems.filter((entry) => entry.content.number !== 5).concat([item(5, { status: 'In Progress' }), item(6, { status: 'In Progress' })]);
  data.comments[5] = [{ body: '### Check-in\n- Owner: owner' }];
  data.issues[4].assignees = [{ login: 'owner' }];
  data.issues.push(issue(7, '[Task] Blocked task', 'OPEN', { assignees: [] }));
  data.projectItems.push(item(7, { status: 'Blocked' }));
  const result = auditTracker({ config: config(), data });
  const codes = result.violations.map((violation) => violation.code);
  assert.ok(codes.includes('WIP_LIMIT_EXCEEDED'));
  assert.ok(codes.includes('IN_PROGRESS_NO_CHECKIN'));
  assert.ok(codes.includes('BLOCKED_WITHOUT_DEPENDENCY'));
});

test('detects parent Done with open children, duplicate labels, missing sprint exit evidence', () => {
  const data = baseData();
  data.subIssues[3] = [4, 5];
  data.issues[4].labels = ['area:docs'];
  data.comments = {};
  const result = auditTracker({ config: config(), data });
  const codes = result.violations.map((violation) => violation.code);
  assert.ok(codes.includes('PARENT_DONE_OPEN_CHILDREN'));
  assert.ok(codes.includes('DUPLICATE_DIMENSION_LABEL'));
  assert.ok(codes.includes('SPRINT_EXIT_EVIDENCE_MISSING'));
});

test('detects missing template version and strict flag', () => {
  const data = baseData();
  const cfg = config();
  delete cfg.automation.templateVersion;
  const result = auditTracker({ config: cfg, data, strict: true });
  assert.ok(result.violations.some((violation) => violation.code === 'TEMPLATE_VERSION_MISSING'));
  assert.equal(result.strict, true);
});
