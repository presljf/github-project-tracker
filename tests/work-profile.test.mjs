import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../scripts/github/validate-config.mjs';
import { getWorkProfileAdapter, resolveWorkProfile } from '../scripts/github/lib/work-profile.mjs';
import { auditTracker, collectAuditData, issueKind } from '../scripts/github/audit.mjs';
import { checkDoR, doneTask, startTask } from '../scripts/github/task.mjs';
import { closeStream, openStream, streamTitle } from '../scripts/github/stream.mjs';
import { ensureSingleSelectOption, mergeSingleSelectOption } from '../scripts/github/project-field-option.mjs';
import { FakeTaskGitHub } from './helpers/fake-task-github.mjs';

// ---------------------------------------------------------------------------
// Fixtures: product (default) vs tooling configs and project fields
// ---------------------------------------------------------------------------

const STATUSES = ['Todo', 'In Progress', 'In Review', 'Blocked', 'Done'];

function statusOptions() {
  return STATUSES.map((name, index) => ({ id: `OPT_STATUS_${index}`, name }));
}

function productConfig(overrides = {}) {
  return {
    trackerVersion: 1,
    repository: 'owner/repo',
    project: { owner: 'owner', title: 'Project Tracker', number: 1 },
    statuses: STATUSES,
    fields: {
      Release: { options: ['v1.0.0'] },
      Sprint: { options: ['1.0.0.1'] },
      Area: { options: ['docs'] },
      Kind: { options: ['infra'] },
      Estimate: { options: ['S', 'M', 'L'] },
      Source: { options: ['Internal'] },
    },
    releases: [{ key: 'v1.0.0', milestone: 'v1.0.0' }],
    automation: { templateVersion: '1.3.0' },
    ...overrides,
  };
}

function toolingConfig(overrides = {}) {
  return {
    trackerVersion: 1,
    repository: 'owner/repo',
    project: { owner: 'owner', title: 'Project Tracker', number: 1 },
    workProfile: 'tooling',
    statuses: STATUSES,
    fields: {
      Stream: { options: ['v1.3.1'] },
      Area: { options: ['docs'] },
      Kind: { options: ['infra'] },
      Estimate: { options: ['S', 'M', 'L'] },
      Source: { options: ['Internal'] },
    },
    releases: [],
    automation: { templateVersion: '1.3.0' },
    ...overrides,
  };
}

function productFields() {
  return [
    { id: 'FIELD_STATUS', name: 'Status', options: statusOptions() },
    { id: 'FIELD_RELEASE', name: 'Release', options: [{ id: 'OPT_RELEASE', name: 'v1.0.0' }] },
    { id: 'FIELD_SPRINT', name: 'Sprint', options: [{ id: 'OPT_SPRINT', name: '1.0.0.1' }] },
    { id: 'FIELD_AREA', name: 'Area', options: [{ id: 'OPT_AREA', name: 'docs' }] },
    { id: 'FIELD_KIND', name: 'Kind', options: [{ id: 'OPT_KIND', name: 'infra' }] },
    { id: 'FIELD_ESTIMATE', name: 'Estimate', options: [{ id: 'OPT_ESTIMATE', name: 'M' }] },
    { id: 'FIELD_SOURCE', name: 'Source', options: [{ id: 'OPT_SOURCE', name: 'Internal' }] },
  ];
}

function toolingFields(streamOptions = ['v1.3.1']) {
  return [
    { id: 'FIELD_STATUS', name: 'Status', options: statusOptions() },
    {
      id: 'FIELD_STREAM',
      name: 'Stream',
      options: streamOptions.map((name, index) => ({ id: `OPT_STREAM_${index}`, name })),
    },
    { id: 'FIELD_AREA', name: 'Area', options: [{ id: 'OPT_AREA', name: 'docs' }] },
    { id: 'FIELD_KIND', name: 'Kind', options: [{ id: 'OPT_KIND', name: 'infra' }] },
    { id: 'FIELD_ESTIMATE', name: 'Estimate', options: [{ id: 'OPT_ESTIMATE', name: 'M' }] },
    { id: 'FIELD_SOURCE', name: 'Source', options: [{ id: 'OPT_SOURCE', name: 'Internal' }] },
  ];
}

function issue(number, title, state = 'OPEN', extra = {}) {
  return {
    number,
    title,
    state,
    type: 'Task',
    milestone: null,
    body: '## Acceptance criteria\n- [x] Fixture criterion',
    assignees: [],
    labels: [],
    url: `https://github.com/owner/repo/issues/${number}`,
    ...extra,
  };
}

function streamIssue(number = 30, extra = {}) {
  return issue(number, '[Stream] v1.3.1 — Docs maintenance', 'OPEN', extra);
}

function taskIssue(number = 31, extra = {}) {
  return issue(number, '[Task] Write docs', 'OPEN', extra);
}

function toolingItem(number, extra = {}) {
  return {
    id: `ITEM_${number}`,
    content: { number },
    status: 'Todo',
    stream: 'v1.3.1',
    area: 'docs',
    kind: 'infra',
    estimate: 'M',
    source: 'Internal',
    ...extra,
  };
}

function toolingFake({
  issues = [streamIssue(), taskIssue()],
  items = [toolingItem(30), toolingItem(31)],
  deps = {},
} = {}) {
  const github = new FakeTaskGitHub({
    projects: [{ id: 'PVT_test', number: 1, title: 'Project Tracker' }],
    fields: toolingFields(),
    issues,
    items,
    issueDeps: deps,
  });
  github.subIssues.set(30, [31]);
  return github;
}

function toolingStartArgs(overrides = {}) {
  return {
    config: toolingConfig(),
    issueNumber: 31,
    owner: 'owner',
    executor: 'agent:test',
    stream: 30,
    dryRun: false,
    repoRoot: process.cwd(),
    gitExec: () => 'deadbee',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Config schema / validate-config: profile default, tooling shape, actionable errors
// ---------------------------------------------------------------------------

test('workProfile is optional and absent means product', () => {
  assert.deepEqual(validateConfig(productConfig()), []);
  assert.equal(resolveWorkProfile({}), 'product');
  assert.equal(getWorkProfileAdapter({}).name, 'product');
  assert.equal(getWorkProfileAdapter({ workProfile: 'tooling' }).name, 'tooling');
});

test('tooling profile accepts Stream field declaration with no Release/Sprint fields and no releases', () => {
  assert.deepEqual(validateConfig(toolingConfig()), []);
  const customName = toolingConfig({
    fields: {
      Stream: { name: 'Delivery', options: ['v1.3.1'] },
      Area: { options: ['docs'] },
      Kind: { options: ['infra'] },
      Estimate: { options: ['S', 'M', 'L'] },
    },
  });
  assert.deepEqual(validateConfig(customName), []);
  assert.equal(getWorkProfileAdapter(customName).streamField, 'Delivery');
});

test('validate-config rejects invalid profiles and profile-specific field gaps with actionable errors', () => {
  const invalidProfile = validateConfig(toolingConfig({ workProfile: 'agile' }));
  assert.ok(invalidProfile.some((error) => /\$\.workProfile/.test(error) && /must be one of/.test(error)));

  const noStream = validateConfig(
    toolingConfig({
      fields: { Area: { options: ['docs'] }, Kind: { options: ['infra'] }, Estimate: { options: ['M'] } },
    }),
  );
  assert.ok(noStream.some((error) => /\$\.fields\.Stream/.test(error) && /tooling/.test(error)));

  const emptyStream = validateConfig(
    toolingConfig({
      fields: {
        Stream: { options: [] },
        Area: { options: ['docs'] },
        Kind: { options: ['infra'] },
        Estimate: { options: ['M'] },
      },
    }),
  );
  assert.ok(emptyStream.some((error) => /\$\.fields\.Stream\.options/.test(error) && /at least 1/.test(error)));

  const productNoRelease = productConfig();
  delete productNoRelease.fields.Release;
  assert.ok(
    validateConfig(productNoRelease).some(
      (error) => /\$\.fields\.Release/.test(error) && /product work profile/.test(error) && /tooling/.test(error),
    ),
  );

  const productNoReleases = validateConfig(productConfig({ releases: [] }));
  assert.ok(productNoReleases.some((error) => /\$\.releases/.test(error) && /at least one release/.test(error)));
});

test('a declared Stream field is ignored in the product profile (backwards compatible)', () => {
  const config = productConfig();
  config.fields.Stream = { options: ['v1.3.1'] };
  assert.deepEqual(validateConfig(config), []);
  const adapter = getWorkProfileAdapter(config);
  assert.equal(adapter.streamField, 'Stream');
  assert.ok(!adapter.taskFields.includes('Stream'));
});

test('issueKind recognises [Stream] as a container kind', () => {
  assert.equal(issueKind('[Stream] v1.3.1 — Docs maintenance'), 'stream');
  assert.equal(issueKind('[Task] still a task'), 'task');
});

// ---------------------------------------------------------------------------
// Task CLI DoR/DoD matrix: product unchanged; tooling requires Stream + Area/Kind/Estimate
// ---------------------------------------------------------------------------

test('tooling start enforces Stream membership, Stream field, and Area/Kind/Estimate', async () => {
  const github = toolingFake();
  const result = await startTask(toolingStartArgs({ github }));
  assert.equal(result.ok, true);
  assert.equal(result.profile, 'tooling');
  assert.equal(result.stream, 30);
  assert.match(result.comment, /### Check-in/);
  assert.match(result.comment, /Work profile:\*\* tooling/);
  assert.match(result.comment, /Stream:\*\* #30 — \[Stream\]/);
  assert.match(result.comment, /type\/stream\/fields\/acceptance\/dependencies checked/);
  assert.equal(github.items[1].status, 'In Progress');
  assert.deepEqual(github.issues[1].assignees, [{ login: 'owner' }]);
});

test('tooling start rejects missing --stream, non-membership, empty Stream, and mismatched Stream', async () => {
  await assert.rejects(() => startTask(toolingStartArgs({ github: toolingFake(), stream: null })), /requires --stream/);

  const notMember = toolingFake();
  notMember.subIssues.set(30, []);
  await assert.rejects(() => startTask(toolingStartArgs({ github: notMember })), /not a sub-issue of stream #30/);

  await assert.rejects(
    () =>
      startTask(
        toolingStartArgs({ github: toolingFake({ items: [toolingItem(30), toolingItem(31, { stream: '' })] }) }),
      ),
    /project field Stream is empty/,
  );
  await assert.rejects(
    () =>
      startTask(
        toolingStartArgs({ github: toolingFake({ items: [toolingItem(30), toolingItem(31, { stream: 'v9.9.9' })] }) }),
      ),
    /does not match stream #30/,
  );

  const noArea = toolingFake({ items: [toolingItem(30), toolingItem(31, { area: '' })] });
  await assert.rejects(() => startTask(toolingStartArgs({ github: noArea })), /project field Area is empty/);

  const closedStream = toolingFake({ issues: [streamIssue(30, { state: 'CLOSED' }), taskIssue()] });
  await assert.rejects(() => startTask(toolingStartArgs({ github: closedStream })), /is not open/);
});

test('tooling DoR keeps acceptance, blocked-dependency, and WIP checks', async () => {
  await assert.rejects(
    () =>
      startTask(
        toolingStartArgs({ github: toolingFake({ issues: [streamIssue(), taskIssue(31, { body: 'No criteria' })] }) }),
      ),
    /Acceptance criteria/,
  );
  await assert.rejects(
    () => startTask(toolingStartArgs({ github: toolingFake({ deps: { 31: { blocked_by: 9 } } }) })),
    /blocked by/,
  );
  const wip = toolingFake({
    issues: [streamIssue(), taskIssue(), taskIssue(32, { assignees: [{ login: 'owner' }] })],
    items: [toolingItem(30), toolingItem(31), toolingItem(32, { status: 'In Progress' })],
  });
  wip.subIssues.set(30, [31, 32]);
  await assert.rejects(() => startTask(toolingStartArgs({ github: wip })), /WIP limit/);
});

test('product profile ignores tooling flags and keeps Release/Sprint DoR', async () => {
  const github = new FakeTaskGitHub({
    projects: [{ id: 'PVT_test', number: 1, title: 'Project Tracker' }],
    fields: productFields(),
    issues: [issue(5, '[Task] Example task', 'OPEN', { milestone: 'v1.0.0', type: 'Task' })],
    items: [
      {
        id: 'ITEM_5',
        content: { number: 5 },
        status: 'Todo',
        release: 'v1.0.0',
        sprint: '1.0.0.1',
        area: 'docs',
        kind: 'infra',
        estimate: 'M',
      },
    ],
  });
  await assert.rejects(
    () => startTask({ ...toolingStartArgs({ github }), config: productConfig(), issueNumber: 5, stream: 30 }),
    /only valid for workProfile "tooling"/,
  );
  const start = await startTask({
    ...toolingStartArgs({ github }),
    config: productConfig(),
    issueNumber: 5,
    stream: null,
  });
  assert.equal(start.profile, 'product');
  assert.match(start.comment, /type\/milestone\/fields\/acceptance\/dependencies checked/);
  assert.doesNotMatch(start.comment, /Work profile/);
});

test('tooling done requires a PR plus evidence; plain evidence-only close is refused', async () => {
  const github = toolingFake();
  await startTask(toolingStartArgs({ github }));
  await assert.rejects(
    () => doneTask({ config: toolingConfig(), github, issueNumber: 31, evidence: 'tests pass' }),
    /--pr is required/,
  );
  await assert.rejects(
    () => doneTask({ config: toolingConfig(), github, issueNumber: 31, evidence: 'tests pass', pr: 'not-a-pr' }),
    /pull request URL/,
  );
  const result = await doneTask({
    config: toolingConfig(),
    github,
    issueNumber: 31,
    evidence: 'npm test 112/112',
    pr: 'https://github.com/owner/repo/pull/7',
  });
  assert.equal(result.profile, 'tooling');
  assert.equal(github.issues[1].state, 'CLOSED');
  assert.match(result.comment, /### Check-out/);
  assert.match(result.comment, /Work profile:\*\* tooling/);
});

test('tooling done still refuses unchecked acceptance criteria', async () => {
  const github = toolingFake({
    issues: [streamIssue(), taskIssue(31, { body: '## Acceptance criteria\n- [ ] Not done' })],
  });
  await assert.rejects(
    () =>
      doneTask({
        config: toolingConfig(),
        github,
        issueNumber: 31,
        evidence: 'evidence',
        pr: 'https://github.com/owner/repo/pull/8',
      }),
    /unchecked acceptance/,
  );
});

// ---------------------------------------------------------------------------
// Stream lifecycle: open, close gates, evidence, tag recording
// ---------------------------------------------------------------------------

test('stream open creates a [Stream] container, appends the delivery option, and sets fields', async () => {
  const github = new FakeTaskGitHub({
    projects: [{ id: 'PVT_test', number: 1, title: 'Project Tracker' }],
    fields: toolingFields(['v1.3.1']),
    issues: [],
    items: [],
  });
  const result = await openStream({
    config: toolingConfig({ fields: { ...toolingConfig().fields, Stream: { options: ['v1.3.1'] } } }),
    github,
    name: 'v1.3.2',
    delivery: 'Docs maintenance',
  });
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.title, streamTitle('v1.3.2', 'Docs maintenance'));
  assert.ok(github.mutations.some((mutation) => mutation[0] === 'updateFieldOptions'));
  const streamField = github.fields.find((field) => field.name === 'Stream');
  assert.ok(streamField.options.some((option) => option.name === 'v1.3.2'));
  assert.ok(
    streamField.options.some((option) => option.id === 'OPT_STREAM_0'),
    'existing option id preserved',
  );
  const item = github.items.find((entry) => entry.content.number === result.issue);
  assert.equal(item.stream, 'v1.3.2');
  assert.equal(item.status, 'Todo');
  assert.match(result.comment, /### Stream opened/);
});

test('stream open is dry-run safe, reuses an existing open stream, and rejects product profile', async () => {
  const github = new FakeTaskGitHub({
    projects: [{ id: 'PVT_test', number: 1, title: 'Project Tracker' }],
    fields: toolingFields(['v1.3.2']),
    issues: [streamIssue(30, { title: streamTitle('v1.3.2', 'Docs maintenance') })],
    items: [toolingItem(30, { stream: 'v1.3.2' })],
  });
  const dry = await openStream({
    config: toolingConfig(),
    github,
    name: 'v1.3.2',
    delivery: 'Docs maintenance',
    dryRun: true,
  });
  assert.equal(dry.planned, true);
  assert.equal(github.mutations.length, 0);
  const reuse = await openStream({ config: toolingConfig(), github, name: 'v1.3.2', delivery: 'Docs maintenance' });
  assert.equal(reuse.created, false);
  assert.equal(reuse.issue, 30);
  await assert.rejects(
    () => openStream({ config: productConfig(), github, name: 'v1.3.2', delivery: 'Docs maintenance' }),
    /requires workProfile "tooling"/,
  );
});

test('stream close refuses open children, red release gate, and missing evidence', async () => {
  const openChild = toolingFake({
    issues: [streamIssue(), taskIssue()],
    items: [toolingItem(30, { status: 'In Progress' }), toolingItem(31)],
  });
  await assert.rejects(
    () =>
      closeStream({
        config: toolingConfig(),
        github: openChild,
        stream: 30,
        evidence: 'evidence',
        gateRunner: async () => ({ ok: true }),
      }),
    /open child task\(s\) #31/,
  );
  await assert.rejects(
    () =>
      closeStream({
        config: toolingConfig(),
        github: toolingFake(),
        stream: 30,
        gateRunner: async () => ({ ok: true }),
      }),
    /--evidence or --evidence-file is required/,
  );
  const greenGate = async () => ({ ok: true, command: 'node scripts/github/release-gate.mjs' });
  const redGate = async () => ({
    ok: false,
    exitCode: 1,
    command: 'node scripts/github/release-gate.mjs',
    output: 'contract FAILED',
  });
  const closable = () =>
    toolingFake({
      issues: [streamIssue(), taskIssue(31, { state: 'CLOSED' })],
      items: [toolingItem(30), toolingItem(31, { status: 'Done' })],
    });
  await assert.rejects(
    () => closeStream({ config: toolingConfig(), github: closable(), stream: 30, evidence: 'ok', gateRunner: redGate }),
    /release-gate checks are not green/,
  );
  await assert.rejects(
    () =>
      closeStream({ config: productConfig(), github: closable(), stream: 30, evidence: 'ok', gateRunner: greenGate }),
    /requires workProfile "tooling"/,
  );
});

test('stream close records ### Stream close evidence with children, gate result, and tag', async () => {
  const github = toolingFake({
    issues: [streamIssue(), taskIssue(31, { state: 'CLOSED' })],
    items: [toolingItem(30, { status: 'In Progress' }), toolingItem(31, { status: 'Done' })],
  });
  const result = await closeStream({
    config: toolingConfig(),
    github,
    stream: 30,
    evidence: 'rehearsal: all tasks done; npm test 112/112',
    tag: 'v1.3.0',
    gateRunner: async () => ({ ok: true, command: 'node scripts/github/release-gate.mjs' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.tag, 'v1.3.0');
  assert.match(result.comment, /### Stream close evidence/);
  assert.match(result.comment, /Child tasks:\*\* 1 closed \(#31\)/);
  assert.match(result.comment, /Release gate:\*\* PASS/);
  assert.match(result.comment, /`v1\.3\.0` recorded/);
  assert.equal(github.issues[0].state, 'CLOSED');
  assert.equal(github.items[0].status, 'Done');
  assert.ok(github.commentsByIssue[30].some((body) => /### Stream close evidence/.test(body)));
});

test('stream close dry-run skips the gate without mutating and validates tags', async () => {
  const github = toolingFake({
    issues: [streamIssue(), taskIssue(31, { state: 'CLOSED' })],
    items: [toolingItem(30), toolingItem(31, { status: 'Done' })],
  });
  const result = await closeStream({
    config: toolingConfig(),
    github,
    stream: 30,
    evidence: 'dry',
    tag: 'v1.3.0',
    dryRun: true,
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.gate.skipped, true);
  assert.equal(github.mutations.length, 0);
  assert.equal(github.issues[0].state, 'OPEN');
  await assert.rejects(
    () =>
      closeStream({
        config: toolingConfig(),
        github,
        stream: 30,
        evidence: 'x',
        tag: '1.3.0',
        gateRunner: async () => ({ ok: true }),
      }),
    /does not match tagPattern/,
  );
});

test('closed rehearsal stream: open → task start/done → stream close → audit passes', async () => {
  const github = new FakeTaskGitHub({
    projects: [{ id: 'PVT_test', number: 1, title: 'Project Tracker' }],
    fields: toolingFields(['v1.3.2']),
    issues: [],
    items: [],
  });
  const config = toolingConfig();
  const opened = await openStream({ config, github, name: 'v1.3.2', delivery: 'Rehearsal delivery' });
  assert.equal(opened.created, true);

  const task = issue(2, '[Task] Rehearsal task', 'OPEN', {
    body: '## Acceptance criteria\n- [x] Rehearsed',
    url: 'https://github.com/owner/repo/issues/2',
  });
  github.issues.push(task);
  github.items.push(toolingItem(2, { stream: 'v1.3.2' }));
  github.subIssues.set(opened.issue, [2]);

  await startTask({
    config,
    github,
    issueNumber: 2,
    owner: 'owner',
    executor: 'agent:rehearsal',
    stream: opened.issue,
    dryRun: false,
    repoRoot: process.cwd(),
    gitExec: () => 'rehearsal',
  });
  assert.equal(github.items.find((item) => item.content.number === 2).status, 'In Progress');

  await doneTask({
    config,
    github,
    issueNumber: 2,
    evidence: 'npm test 112/112',
    pr: 'https://github.com/owner/repo/pull/2',
  });
  assert.equal(github.issues.find((entry) => entry.number === 2).state, 'CLOSED');

  const closed = await closeStream({
    config,
    github,
    stream: opened.issue,
    evidence: 'rehearsal complete: task #2 closed with PR + evidence',
    gateRunner: async () => ({ ok: true, command: 'node scripts/github/release-gate.mjs' }),
  });
  assert.equal(closed.ok, true);
  assert.equal(github.issues.find((entry) => entry.number === opened.issue).state, 'CLOSED');

  const data = await collectAuditData(github, config);
  const audit = auditTracker({ config, data });
  assert.equal(audit.workProfile, 'tooling');
  assert.equal(audit.ok, true, JSON.stringify(audit.violations));
});

// ---------------------------------------------------------------------------
// project-field-option: safe append preserves ids/colours and item values
// ---------------------------------------------------------------------------

function optionRunner(existing = [{ id: 'OPT_OLD', name: 'v1.3.0', color: 'GREEN', description: 'first' }]) {
  const field = { id: 'FIELD_STREAM', name: 'Stream', dataType: 'SINGLE_SELECT', options: structuredClone(existing) };
  const updates = [];
  return {
    field,
    updates,
    async listFields() {
      return [structuredClone(field)];
    },
    async updateFieldOptions(fieldId, options) {
      updates.push({ fieldId, options: structuredClone(options) });
      field.options = structuredClone(options);
      return {};
    },
  };
}

test('option utility appends one option while preserving existing ids, colours, and order', async () => {
  const runner = optionRunner();
  const result = await ensureSingleSelectOption({
    runner,
    owner: 'owner',
    projectNumber: 1,
    fieldName: 'Stream',
    optionName: 'v1.3.1',
    color: 'PURPLE',
    description: 'second',
  });
  assert.equal(result.added, true);
  assert.equal(runner.updates.length, 1);
  const [payload] = runner.updates;
  assert.equal(payload.options[0].id, 'OPT_OLD');
  assert.equal(payload.options[0].name, 'v1.3.0');
  assert.equal(payload.options[0].color, 'GREEN');
  assert.equal(payload.options[1].name, 'v1.3.1');
  assert.equal(payload.options[1].color, 'PURPLE');
  assert.equal(payload.options[1].description, 'second');
  assert.equal(payload.options[1].id, undefined, 'new option must not carry an id');
});

test('option utility is idempotent and dry-run safe', async () => {
  const runner = optionRunner();
  await ensureSingleSelectOption({
    runner,
    owner: 'owner',
    projectNumber: 1,
    fieldName: 'Stream',
    optionName: 'v1.3.1',
  });
  const second = await ensureSingleSelectOption({
    runner,
    owner: 'owner',
    projectNumber: 1,
    fieldName: 'Stream',
    optionName: 'v1.3.1',
  });
  assert.equal(second.added, false);
  assert.equal(second.unmodified, true);
  assert.equal(runner.updates.length, 1);

  const dryRunner = optionRunner();
  const planned = await ensureSingleSelectOption({
    runner: dryRunner,
    owner: 'owner',
    projectNumber: 1,
    fieldName: 'Stream',
    optionName: 'v1.3.9',
    dryRun: true,
  });
  assert.equal(planned.planned, true);
  assert.equal(dryRunner.updates.length, 0);
});

test('option utility accepts gh-shaped single-select field types (live stream open)', async () => {
  const ghShaped = {
    listFields: async () => [
      {
        id: 'PVTSSF_live',
        name: 'Stream',
        type: 'ProjectV2SingleSelectField',
        options: [{ id: 'OPT_1', name: 'v1.3.1-maintenance' }],
      },
    ],
    updateFieldOptions: async () => ({}),
  };
  const result = await ensureSingleSelectOption({
    runner: ghShaped,
    owner: 'presljf',
    projectNumber: 2,
    fieldName: 'Stream',
    optionName: 'v1.3.1-maintenance',
  });
  assert.equal(result.unmodified, true);
});

test('option utility rejects unknown fields, wrong field types, and invalid colours', async () => {
  const runner = optionRunner();
  await assert.rejects(
    () => ensureSingleSelectOption({ runner, owner: 'owner', projectNumber: 1, fieldName: 'Missing', optionName: 'x' }),
    /project field "Missing" not found/,
  );
  const textField = { id: 'FIELD_TEXT', name: 'Notes', dataType: 'TEXT', options: [] };
  await assert.rejects(
    () =>
      ensureSingleSelectOption({
        runner: { listFields: async () => [textField], updateFieldOptions: async () => ({}) },
        owner: 'owner',
        projectNumber: 1,
        fieldName: 'Notes',
        optionName: 'x',
      }),
    /not a single-select field/,
  );
  await assert.rejects(
    () =>
      ensureSingleSelectOption({
        runner,
        owner: 'owner',
        projectNumber: 1,
        fieldName: 'Stream',
        optionName: 'x',
        color: 'TEAL',
      }),
    /invalid option color/,
  );
  const merged = mergeSingleSelectOption([{ id: 'A', name: 'one', color: 'BLUE', description: 'd' }], 'one');
  assert.equal(merged.added, false);
  assert.deepEqual(merged.options, [{ id: 'A', name: 'one', color: 'BLUE', description: 'd' }]);
});

// ---------------------------------------------------------------------------
// Mode-aware audit: tooling positive/negative fixtures; product fixture unchanged
// ---------------------------------------------------------------------------

const AUDIT_TASK_BODY = [
  '## Why / context',
  'Fixture',
  '',
  '## Current behavior',
  'Fixture',
  '',
  '## Goal',
  'Fixture',
  '',
  '## Non-goals',
  'Fixture',
  '',
  '## Acceptance criteria',
  '- [x] Fixture',
  '',
  '## Test plan',
  'Fixture',
  '',
  '## Verification evidence required',
  'Fixture',
  '',
  '## Dependencies / blockers',
  'None',
  '',
  '## Risks / rollback',
  'Low',
].join('\n');

function auditToolingConfig() {
  return {
    trackerVersion: 1,
    repository: 'owner/repo',
    project: { owner: 'owner', title: 'Project Tracker', number: 1 },
    workProfile: 'tooling',
    fields: { Stream: { options: ['v1.3.1'] } },
    automation: { templateVersion: '1.3.0' },
  };
}

function auditIssue(number, title, state = 'OPEN', extra = {}) {
  return {
    number,
    title,
    state,
    issueType: { name: 'Task' },
    milestone: null,
    labels: [],
    assignees: [],
    body: AUDIT_TASK_BODY,
    ...extra,
  };
}

function toolingAuditData() {
  return {
    issues: [
      auditIssue(10, '[Stream] v1.3.1 — Docs maintenance'),
      auditIssue(11, '[Task] Open docs task', 'OPEN', { assignees: [{ login: 'owner' }] }),
      auditIssue(12, '[Task] Closed docs task', 'CLOSED'),
    ],
    projectItems: [
      { content: { number: 10 }, status: 'Todo', stream: 'v1.3.1', area: 'docs', kind: 'infra', estimate: 'M' },
      {
        content: { number: 11 },
        status: 'In Progress',
        stream: 'v1.3.1',
        area: 'docs',
        kind: 'infra',
        estimate: 'M',
        source: 'Internal',
      },
      { content: { number: 12 }, status: 'Done', stream: 'v1.3.1', area: 'docs', kind: 'infra', estimate: 'M' },
    ],
    comments: {
      11: [{ body: '### Check-in\n- Owner: owner' }],
      12: [{ body: '### Check-out\n- Evidence: done' }],
    },
    subIssues: { 10: [11, 12] },
    dependencies: {},
  };
}

test('mode-aware audit passes a valid tooling fixture (Stream → Task, no Release/Sprint)', () => {
  const result = auditTracker({ config: auditToolingConfig(), data: toolingAuditData() });
  assert.equal(result.workProfile, 'tooling');
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});

test('mode-aware audit fails tooling negative cases: hierarchy, Stream field, keepers', () => {
  const noAncestry = toolingAuditData();
  delete noAncestry.subIssues[10];
  const noAncestryCodes = auditTracker({ config: auditToolingConfig(), data: noAncestry }).violations.map(
    (v) => v.code,
  );
  assert.ok(noAncestryCodes.includes('TASK_HIERARCHY_MISSING_STREAM'));
  assert.ok(!noAncestryCodes.includes('TASK_HIERARCHY_MISSING_RELEASE'));

  const noField = toolingAuditData();
  noField.projectItems[1].stream = '';
  const noFieldCodes = auditTracker({ config: auditToolingConfig(), data: noField }).violations.map((v) => v.code);
  assert.ok(noFieldCodes.includes('FIELD_STREAM_MISSING'));
  assert.ok(!noFieldCodes.includes('FIELD_RELEASE_MISSING'));

  const closedStreamNoEvidence = toolingAuditData();
  closedStreamNoEvidence.issues[0].state = 'CLOSED';
  closedStreamNoEvidence.issues[1].state = 'CLOSED';
  closedStreamNoEvidence.projectItems[0].status = 'Done';
  closedStreamNoEvidence.projectItems[1].status = 'Done';
  closedStreamNoEvidence.comments[11] = [{ body: '### Check-in' }];
  const noEvidenceCodes = auditTracker({ config: auditToolingConfig(), data: closedStreamNoEvidence }).violations.map(
    (v) => v.code,
  );
  assert.ok(noEvidenceCodes.includes('STREAM_EXIT_EVIDENCE_MISSING'));

  const openChildren = toolingAuditData();
  openChildren.issues[0].state = 'CLOSED';
  openChildren.projectItems[0].status = 'Done';
  openChildren.comments[10] = [{ body: '### Stream close evidence\n- Release gate: PASS' }];
  const openChildCodes = auditTracker({ config: auditToolingConfig(), data: openChildren }).violations.map(
    (v) => v.code,
  );
  assert.ok(openChildCodes.includes('PARENT_DONE_OPEN_CHILDREN'));

  const taskNoCheckout = toolingAuditData();
  taskNoCheckout.comments[12] = [];
  const checkoutCodes = auditTracker({ config: auditToolingConfig(), data: taskNoCheckout }).violations.map(
    (v) => v.code,
  );
  assert.ok(checkoutCodes.includes('TASK_CHECKOUT_EVIDENCE_MISSING'));
});

test('product-profile audit fixture is unchanged (default profile)', () => {
  const config = {
    trackerVersion: 1,
    repository: 'owner/repo',
    project: { owner: 'owner', title: 'Project Tracker', number: 1 },
    automation: { templateVersion: '1.3.0' },
  };
  const data = {
    issues: [
      auditIssue(1, '[Roadmap] Program roadmap', 'OPEN', { milestone: null }),
      auditIssue(2, '[Release] v1.0.0', 'OPEN', { milestone: { title: 'v1.0.0' } }),
      auditIssue(3, '[Sprint] 1.0.0.1 — Foundation', 'OPEN', { milestone: { title: 'v1.0.0' } }),
      auditIssue(4, '[Task] Open todo', 'OPEN', { milestone: { title: 'v1.0.0' } }),
    ],
    projectItems: [
      { content: { number: 1 }, status: 'Todo', release: '', sprint: '', area: 'docs', kind: 'infra', estimate: 'L' },
      {
        content: { number: 2 },
        status: 'Todo',
        release: 'v1.0.0',
        sprint: '',
        area: 'docs',
        kind: 'infra',
        estimate: 'M',
      },
      {
        content: { number: 3 },
        status: 'Todo',
        release: 'v1.0.0',
        sprint: '1.0.0.1',
        area: 'docs',
        kind: 'infra',
        estimate: 'M',
      },
      {
        content: { number: 4 },
        status: 'Todo',
        release: 'v1.0.0',
        sprint: '1.0.0.1',
        area: 'docs',
        kind: 'infra',
        estimate: 'M',
      },
    ],
    comments: {},
    subIssues: { 1: [2], 2: [3], 3: [4] },
    dependencies: {},
  };
  const result = auditTracker({ config, data });
  assert.equal(result.workProfile, 'product');
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});

test('tooling audit exempts historical closed tasks that are not under a Stream', () => {
  const data = toolingAuditData();
  // Historical product record: closed task #12, no check-out comment, not a [Stream] sub-issue.
  data.comments[12] = [];
  data.subIssues[10] = [11];
  const codes = auditTracker({ config: auditToolingConfig(), data }).violations.map((v) => v.code);
  assert.ok(
    !codes.includes('TASK_CHECKOUT_EVIDENCE_MISSING'),
    'historical product task must stay valid after the profile flip',
  );

  // A closed task INSIDE a Stream still needs tooling check-out evidence.
  const streamTask = toolingAuditData();
  streamTask.comments[12] = [];
  const streamCodes = auditTracker({ config: auditToolingConfig(), data: streamTask }).violations.map((v) => v.code);
  assert.ok(streamCodes.includes('TASK_CHECKOUT_EVIDENCE_MISSING'));
});

test('tooling profile skips Release/Sprint and milestone requirements but keeps type/sections', () => {
  const data = toolingAuditData();
  data.issues[1].issueType = null;
  data.issues[1].body = 'No sections';
  const codes = auditTracker({ config: auditToolingConfig(), data }).violations.map((v) => v.code);
  assert.ok(codes.includes('TYPE_MISSING'));
  assert.ok(codes.includes('TASK_SECTION_MISSING'));
  assert.ok(!codes.includes('MILESTONE_MISSING'));
  assert.ok(!codes.includes('FIELD_RELEASE_MISSING'));
  assert.ok(!codes.includes('FIELD_SPRINT_MISSING'));
});

test('checkDoR remains callable directly with product defaults', async () => {
  const github = new FakeTaskGitHub({
    projects: [{ id: 'PVT_test', number: 1, title: 'Project Tracker' }],
    fields: productFields(),
    issues: [issue(5, '[Task] Example task', 'OPEN', { milestone: 'v1.0.0', type: 'Task' })],
    items: [
      {
        id: 'ITEM_5',
        content: { number: 5 },
        status: 'Todo',
        release: 'v1.0.0',
        sprint: '1.0.0.1',
        area: 'docs',
        kind: 'infra',
        estimate: 'M',
      },
    ],
  });
  const result = await checkDoR({ config: productConfig(), github, issueNumber: 5, owner: 'owner' });
  assert.equal(result.profile.name, 'product');
  assert.equal(result.stream, null);
});
