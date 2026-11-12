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
    body: '## Why / context\nFixture\n\n## Current behavior\nFixture\n\n## Goal\nFixture\n\n## Non-goals\nFixture\n\n## Acceptance criteria\n- [x] Fixture\n\n## Test plan\nFixture\n\n## Verification evidence required\nFixture\n\n## Dependencies / blockers\nNone\n\n## Risks / rollback\nLow\n\n## Estimate\nS',
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
      issue(6, '[Sprint] 1.0.0.2 — Active sprint'),
    ],
    projectItems: [
      item(1, { release: '', sprint: '', area: 'docs', kind: 'infra', estimate: 'L' }),
      item(2, { sprint: '' }),
      item(3, { status: 'Done' }),
      item(4, { status: 'Done' }),
      item(5),
      item(6),
    ],
    comments: {
      3: [{ body: '### Sprint demo / exit\n- Outcome: done' }],
    },
    subIssues: { 1: [2], 2: [6], 6: [5], 3: [4] },
    dependencies: {},
  };
}

test('clean tracker data passes', () => {
  const result = auditTracker({ config: config(), data: baseData() });
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.checked.issues, 6);
  assert.equal(result.checked.projectItems, 6);
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
  data.projectItems = data.projectItems
    .filter((entry) => entry.content.number !== 5)
    .concat([
      {
        content: { number: 5 },
        status: 'Todo',
        release: 'v1.0.0',
        sprint: '1.0.0.1',
        area: '',
        kind: '',
        estimate: '',
      },
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
  data.issues.push(issue(7, '[Task] Second active', 'OPEN', { assignees: [{ login: 'owner' }] }));
  data.issues[4].assignees = [{ login: 'owner' }];
  data.projectItems.push(item(4, { status: 'In Progress' }));
  // make #5 and #6 In Progress, both owned by owner, only #5 checked in
  data.projectItems = data.projectItems
    .filter((entry) => entry.content.number !== 5)
    .concat([item(5, { status: 'In Progress' }), item(7, { status: 'In Progress' })]);
  data.comments[5] = [{ body: '### Check-in\n- Owner: owner' }];
  data.issues[4].assignees = [{ login: 'owner' }];
  data.issues.push(issue(8, '[Task] Blocked task', 'OPEN', { assignees: [] }));
  data.projectItems.push(item(8, { status: 'Blocked' }));
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

test('detects missing required task sections and release/sprint ancestry', () => {
  const missing = baseData();
  missing.issues[4].body = missing.issues[4].body.replace(/## Test plan[\s\S]*?(?=## Verification)/, '');
  const missingResult = auditTracker({ config: config(), data: missing });
  assert.ok(missingResult.violations.some((v) => v.code === 'TASK_SECTION_MISSING' && /test plan/i.test(v.message)));

  const noHierarchy = baseData();
  delete noHierarchy.subIssues[6];
  const hierarchyResult = auditTracker({ config: config(), data: noHierarchy });
  assert.ok(hierarchyResult.violations.some((v) => v.code === 'TASK_HIERARCHY_MISSING_SPRINT'));
});

test('reports closed items with stale Project status as non-blocking warnings', () => {
  const stale = baseData();
  const closedTask = stale.projectItems.find((entry) => entry.content.number === 4);
  closedTask.status = 'In Review';
  const result = auditTracker({ config: config(), data: stale });
  assert.equal(result.ok, true, 'status drift must never block the audit');
  assert.equal(result.violations.length, 0);
  const warnings = result.warnings.filter((warning) => warning.code === 'PROJECT_STATUS_STALE');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].issue, 4);
  assert.match(warnings[0].message, /Project status In Review \(expected Done\)/);

  // Strict mode still exits 0 for warnings: only violations gate.
  const strictResult = auditTracker({ config: config(), data: stale, strict: true });
  assert.equal(strictResult.ok, true);
  assert.equal(strictResult.warnings.filter((warning) => warning.code === 'PROJECT_STATUS_STALE').length, 1);
});

test('stale status detection scopes to closed items on the project with a non-Done status', () => {
  const data = baseData();
  // Closed item whose status is Done stays clean.
  assert.equal(
    auditTracker({ config: config(), data }).warnings.filter((warning) => warning.code === 'PROJECT_STATUS_STALE')
      .length,
    0,
  );
  // Open items are ignored even when their status is not Done.
  data.issues[5].state = 'OPEN';
  data.projectItems.find((entry) => entry.content.number === 5).status = 'In Progress';
  assert.equal(
    auditTracker({ config: config(), data }).warnings.filter((warning) => warning.code === 'PROJECT_STATUS_STALE')
      .length,
    0,
  );
  // Closed items missing from the project are out of scope.
  const offProject = baseData();
  offProject.projectItems = offProject.projectItems.filter((entry) => entry.content.number !== 4);
  assert.equal(
    auditTracker({ config: config(), data: offProject }).warnings.filter(
      (warning) => warning.code === 'PROJECT_STATUS_STALE',
    ).length,
    0,
  );
});

test('flags an open sprint without a release ancestor but exempts linked and closed sprints', () => {
  // baseData() has the open sprint #6 linked under release #2 and the closed sprint #3 unlinked.
  const clean = auditTracker({ config: config(), data: baseData() });
  assert.ok(!clean.violations.some((violation) => violation.code === 'SPRINT_HIERARCHY_MISSING_RELEASE'));

  const orphan = baseData();
  orphan.issues.push(issue(9, '[Sprint] 1.0.0.3 — Orphan sprint'));
  orphan.projectItems.push(item(9, { sprint: '1.0.0.3' }));
  const result = auditTracker({ config: config(), data: orphan });
  const violations = result.violations.filter((violation) => violation.code === 'SPRINT_HIERARCHY_MISSING_RELEASE');
  assert.equal(violations.length, 1);
  assert.equal(violations[0].issue, 9);
  assert.match(violations[0].message, /open sprint has no release tracker ancestor/);
});

test('stale-status warning carries fix guidance; unset status is drift; foreign-repo items ignored', () => {
  const data = baseData();
  const stale = data.projectItems.find((entry) => entry.content.number === 4);
  stale.status = 'In Review';
  stale.id = 'ITEM_4';
  stale.content.repository = 'owner/repo';
  const warning = auditTracker({ config: config(), data }).warnings.find(
    (entry) => entry.code === 'PROJECT_STATUS_STALE',
  );
  assert.equal(warning.itemId, 'ITEM_4');
  assert.match(warning.fix, /reconcile:status/, 'warning must point at the repair command');
  assert.match(warning.message, /expected Done/);

  // An item auto-added to the project without a Status value is drift too ("not Done").
  const unset = baseData();
  unset.projectItems.find((entry) => entry.content.number === 4).status = '';
  const unsetWarning = auditTracker({ config: config(), data: unset }).warnings.find(
    (entry) => entry.code === 'PROJECT_STATUS_STALE',
  );
  assert.match(unsetWarning.message, /no Project status/);

  // Shared projects can host other repositories' items; never flag (or repair) a foreign item.
  const foreign = baseData();
  const foreignItem = foreign.projectItems.find((entry) => entry.content.number === 4);
  foreignItem.status = 'In Review';
  foreignItem.content.repository = 'other/repo';
  assert.equal(
    auditTracker({ config: config(), data: foreign }).warnings.filter((entry) => entry.code === 'PROJECT_STATUS_STALE')
      .length,
    0,
  );
});
