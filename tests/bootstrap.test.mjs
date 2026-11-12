import test from 'node:test';
import assert from 'node:assert/strict';
import { runBootstrap, buildIssueSpecs } from '../scripts/github/bootstrap.mjs';
import { FakeGitHub } from './helpers/fake-github.mjs';

const silent = { log() {}, warn() {}, error() {} };

function config(overrides = {}) {
  return {
    trackerVersion: 1,
    repository: 'owner/repo',
    project: { owner: 'owner', title: 'Project Tracker', number: 1 },
    roadmap: { title: 'Program roadmap', body: '# Program roadmap\n' },
    statuses: ['Todo', 'In Progress', 'In Review', 'Blocked', 'Done'],
    fields: {
      Release: { options: ['v1.0.0'] },
      Sprint: { options: ['1.0.0.1'] },
      Area: { options: ['docs', 'ci'] },
      Kind: { options: ['feature', 'fix', 'infra'] },
      Estimate: { options: ['S', 'M', 'L'] },
      Source: { options: ['Internal', 'CastDeck', 'Other'] },
    },
    issueTypes: { task: 'Task', bug: 'Bug', feature: 'Feature' },
    labels: {
      risk: ['risk:low', 'risk:medium', 'risk:high'],
      process: ['plan-change', 'source:downstream', 'status:needs-triage'],
    },
    releases: [
      {
        key: 'v1.0.0',
        milestone: 'v1.0.0',
        sprints: [{ key: '1.0.0.1', title: 'Foundation', estimate: 'M', tasks: ['First task'] }],
      },
    ],
    automation: { templateRepo: 'owner/github-project-tracker', templateVersion: '1.0.0' },
    ...overrides,
  };
}

test('buildIssueSpecs creates roadmap/release/sprint/task hierarchy', () => {
  const specs = buildIssueSpecs(config());
  assert.deepEqual(
    specs.map((spec) => spec.kind),
    ['roadmap', 'release', 'sprint', 'task'],
  );
  assert.equal(specs[3].parentTitle, '[Sprint] 1.0.0.1 — Foundation');
  assert.equal(specs[3].release, 'v1.0.0');
  assert.equal(specs[3].sprint, '1.0.0.1');
});

test('dry-run plans creates and performs zero mutations', async () => {
  const github = new FakeGitHub();
  const result = await runBootstrap({ config: config(), github, apply: false, logger: silent });
  assert.equal(result.mode, 'dry-run');
  assert.equal(github.mutations.length, 0);
  assert.ok(result.actions.some((line) => line.includes('CREATE project')));
  assert.ok(result.actions.some((line) => line.includes('CREATE field "Status"')));
  assert.ok(result.actions.some((line) => line.includes('CREATE milestone "v1.0.0"')));
  assert.ok(result.actions.some((line) => line.includes('CREATE issue "[Task] First task"')));
  assert.ok(result.manual.length > 0);
});

test('apply creates once and is idempotent on re-run', async () => {
  const github = new FakeGitHub();
  await runBootstrap({ config: config(), github, apply: true, logger: silent });
  const first = {
    projects: github.projects.length,
    issues: github.issues.length,
    milestones: github.milestones.length,
    labels: github.labels.length,
  };
  assert.equal(first.projects, 1);
  assert.equal(first.issues, 4);
  assert.equal(first.milestones, 1);
  assert.ok(first.labels >= 6);

  const second = await runBootstrap({ config: config(), github, apply: true, logger: silent });
  assert.equal(github.projects.length, first.projects);
  assert.equal(github.issues.length, first.issues);
  assert.equal(github.milestones.length, first.milestones);
  assert.equal(github.labels.length, first.labels);
  assert.ok(!second.actions.some((line) => line.startsWith('CREATE ')), 'second run should not create resources');

  const task = github.issues.find((issue) => issue.title === '[Task] First task');
  const taskItem = github.items.find((item) => item.content.number === task.number);
  assert.equal(taskItem.status, 'Todo');
  assert.equal(taskItem.release, 'v1.0.0');
  assert.equal(taskItem.sprint, '1.0.0.1');
  assert.ok(github.subIssues.get(2)?.includes(3), 'sprint should parent task');
});

test('apply adds missing options to an existing field without recreating it', async () => {
  const github = new FakeGitHub();
  await runBootstrap({ config: config(), github, apply: true, logger: silent });
  const field = github.fields.find((entry) => entry.name === 'Area');
  const before = github.fields.length;
  const cfg = config();
  cfg.fields.Area.options.push('new-area');
  await runBootstrap({ config: cfg, github, apply: true, logger: silent });
  assert.equal(github.fields.length, before);
  assert.ok(github.fields.find((entry) => entry.name === 'Area').options.some((option) => option.name === 'new-area'));
  assert.ok(github.mutations.some((mutation) => mutation[0] === 'updateFieldOptions' && mutation[1] === field.id));
});

test('invalid config fails before any mutation', async () => {
  const github = new FakeGitHub();
  await assert.rejects(
    () => runBootstrap({ config: config({ repository: 'not-a-repo' }), github, apply: true, logger: silent }),
    /Invalid tracker config/,
  );
  assert.equal(github.mutations.length, 0);
});

test('bootstrap-created task passes DoR, task start, and audit', async () => {
  const { FakeTaskGitHub } = await import('./helpers/fake-task-github.mjs');
  const { startTask } = await import('../scripts/github/task.mjs');
  const { collectAuditData, auditTracker } = await import('../scripts/github/audit.mjs');
  const github = new FakeTaskGitHub();
  const cfg = config();
  await runBootstrap({ config: cfg, github, apply: true, logger: silent });
  const task = github.issues.find((issue) => issue.title === '[Task] First task');
  assert.ok(task, 'bootstrap should create the task skeleton');
  const item = github.items.find((entry) => entry.content.number === task.number);
  assert.equal(item.area, 'docs');
  assert.equal(item.kind, 'feature');
  assert.equal(item.estimate, 'M');
  const start = await startTask({
    config: cfg,
    github,
    issueNumber: task.number,
    owner: 'owner',
    executor: 'agent:test',
    dryRun: true,
    repoRoot: process.cwd(),
    gitExec: () => 'abc123',
  });
  assert.equal(start.ok, true);
  const data = await collectAuditData(github, cfg);
  const audit = auditTracker({ config: cfg, data });
  assert.equal(audit.ok, true, JSON.stringify(audit.violations));
});
