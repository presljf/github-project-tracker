import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isSelfRepo, verifyContract } from '../scripts/adopt/cli/verify-contract.mjs';
import { evaluateReleaseGate } from '../scripts/adopt/cli/release-gate.mjs';
import { closeStream, DEFAULT_GATE_COMMAND, defaultGateCommand } from '../scripts/adopt/cli/stream.mjs';
import { FakeTaskGitHub } from './helpers/fake-task-github.mjs';

const REPO_ROOT = process.cwd();
const TRACKER_REPO = 'presljf/github-project-tracker';
const contract = {
  schemaVersion: 1,
  trackerVersion: '1.3.0',
  repository: TRACKER_REPO,
  requiredConfig: ['repository', 'automation.templateVersion'],
  requiredWorkflows: [{ id: 'ci', reusable: `${TRACKER_REPO}/.github/workflows/reusable-ci.yml` }],
  requiredProfiles: ['node'],
  requiredDocs: ['docs/TRACKER.md'],
  overrideManifest: 'tracker.overrides.json',
};

function selfConfig(overrides = {}) {
  return {
    repository: TRACKER_REPO,
    automation: { templateVersion: '1.3.0' },
    ...overrides,
  };
}

function downstreamFixture({ pin = '1.3.0', profile = false, docs = false, workflow = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'self-repo-'));
  const config = { repository: 'downstream/repo', automation: { templateVersion: pin } };
  if (profile) config.profiles = { node: {} };
  fs.writeFileSync(path.join(root, 'tracker.config.json'), JSON.stringify(config));
  if (docs) fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  if (docs) fs.writeFileSync(path.join(root, 'docs/TRACKER.md'), '# tracker\n');
  if (workflow) {
    fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.github/workflows/ci.yml'),
      `jobs:\n  ci:\n    uses: ${TRACKER_REPO}/.github/workflows/reusable-ci.yml@v${pin}\n`,
    );
  }
  return { root, config };
}

function runNodeScript(script, args, cwd = REPO_ROOT) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    encoding: 'utf8',
  });
}

// ---------------------------------------------------------------------------
// verify-contract: self-repo detection + skip, downstream unchanged
// ---------------------------------------------------------------------------

test('isSelfRepo detects only the contract owner repository', () => {
  assert.equal(isSelfRepo({ contract, config: selfConfig() }), true);
  assert.equal(isSelfRepo({ contract, config: { repository: 'other/repo' } }), false);
  assert.equal(isSelfRepo({ contract: { ...contract, repository: undefined }, config: selfConfig() }), false);
  assert.equal(isSelfRepo({ contract, config: {} }), false);
});

test('verify-contract self-repo passes with an explicit skip result', () => {
  const result = verifyContract({ root: REPO_ROOT, contract, config: selfConfig() });
  assert.equal(result.ok, true);
  assert.equal(result.selfRepo, true);
  assert.deepEqual(result.skipped, ['requiredProfiles', 'requiredDocs', 'requiredWorkflows']);
  assert.ok(result.notes.some((note) => /self-repo: downstream contract checks skipped/.test(note)));
  assert.deepEqual(result.violations, []);
});

test('verify-contract self-repo still enforces version/config alignment', () => {
  const stale = verifyContract({
    root: REPO_ROOT,
    contract,
    config: selfConfig({ automation: { templateVersion: '1.2.2' } }),
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.selfRepo, true);
  assert.ok(stale.violations.some((violation) => /templateVersion=1\.2\.2 expected 1\.3\.0/.test(violation)));
});

test('verify-contract downstream behaviour is unchanged (missing pins still fail)', () => {
  const { root, config } = downstreamFixture();
  try {
    const result = verifyContract({ root, contract, config });
    assert.equal(result.ok, false);
    assert.equal(result.selfRepo, false);
    assert.ok(result.violations.some((violation) => /required profile missing: node/.test(violation)));
    assert.ok(result.violations.some((violation) => /required docs missing: docs\/TRACKER\.md/.test(violation)));
    assert.ok(result.violations.some((violation) => /required workflow missing: ci/.test(violation)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const pinned = downstreamFixture({ profile: true, docs: true, workflow: true, pin: '1.2.2' });
  try {
    const result = verifyContract({ root: pinned.root, contract, config: pinned.config });
    assert.ok(result.violations.some((violation) => /templateVersion=1\.2\.2 expected 1\.3\.0/.test(violation)));
    assert.ok(result.violations.some((violation) => /ref not pinned to v1\.3\.0/.test(violation)));
  } finally {
    fs.rmSync(pinned.root, { recursive: true, force: true });
  }
});

test('real verify-contract CLI passes on the contract repository itself', () => {
  const result = runNodeScript('scripts/adopt/cli/verify-contract.mjs', []);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /self-repo: downstream contract checks skipped/);
  assert.match(result.stdout, /Adoption contract OK — tracker v1\.4\.0/);
});

// ---------------------------------------------------------------------------
// release-gate: self-repo passthrough + stream close default gate
// ---------------------------------------------------------------------------

test('evaluateReleaseGate reports selfRepo and still fails open bypass OIs', () => {
  const clean = evaluateReleaseGate({ contractResult: { ok: true, selfRepo: true, violations: [] } });
  assert.equal(clean.ok, true);
  assert.equal(clean.selfRepo, true);

  const bypass = evaluateReleaseGate({
    contractResult: { ok: true, selfRepo: true, violations: [] },
    bypasses: [{ number: 9 }],
  });
  assert.equal(bypass.ok, false);
  assert.ok(bypass.violations.some((violation) => /#9/.test(violation)));

  const downstream = evaluateReleaseGate({ contractResult: { ok: true, selfRepo: false, violations: [] } });
  assert.equal(downstream.selfRepo, false);
});

test('release gate works self-repo (real CLI, no bypass check) and default gate command is composed', () => {
  const config = selfConfig();
  assert.equal(defaultGateCommand(config), `${DEFAULT_GATE_COMMAND} --repo ${TRACKER_REPO}`);
  assert.equal(DEFAULT_GATE_COMMAND, 'node scripts/adopt/cli/release-gate.mjs');

  const gate = runNodeScript('scripts/adopt/cli/release-gate.mjs', ['--root', REPO_ROOT]);
  assert.equal(gate.status, 0, gate.stderr);
  assert.match(gate.stdout, /Release gate OK — self-repo: downstream contract checks skipped/);
  assert.match(gate.stdout, /open-OI check skipped \(no --repo/);
});

test('release-gate CLI honours a custom --config path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-config-'));
  try {
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'contract.json'),
      JSON.stringify({
        trackerVersion: '1.3.0',
        repository: TRACKER_REPO,
        requiredConfig: ['repository', 'automation.templateVersion'],
      }),
    );
    fs.writeFileSync(
      path.join(root, 'config', 'custom.json'),
      JSON.stringify({ repository: TRACKER_REPO, automation: { templateVersion: '1.3.0' } }),
    );
    const gate = runNodeScript('scripts/adopt/cli/release-gate.mjs', [
      '--root',
      root,
      '--contract',
      path.join(root, 'contract.json'),
      '--config',
      path.join(root, 'config/custom.json'),
    ]);
    assert.equal(gate.status, 0, gate.stderr);
    assert.match(gate.stdout, /Release gate OK/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stream close passes its release gate (self-repo tooling) and records close evidence', async () => {
  const issues = [
    {
      number: 30,
      title: '[Stream] v1.3.0 — Release hardening',
      state: 'OPEN',
      type: 'Task',
      body: '# Stream',
      assignees: [],
    },
    { number: 31, title: '[Task] Release task', state: 'CLOSED', type: 'Task', body: '', assignees: [] },
  ];
  const github = new FakeTaskGitHub({
    projects: [{ id: 'PVT_test', number: 1, title: 'Project Tracker' }],
    fields: [
      {
        id: 'FIELD_STATUS',
        name: 'Status',
        options: ['Todo', 'In Progress', 'In Review', 'Blocked', 'Done'].map((name, index) => ({
          id: `OPT_${index}`,
          name,
        })),
      },
      { id: 'FIELD_STREAM', name: 'Stream', options: [{ id: 'OPT_STREAM', name: 'v1.3.0' }] },
    ],
    issues,
    items: [{ id: 'ITEM_30', content: { number: 30 }, status: 'In Progress', stream: 'v1.3.0' }],
  });
  github.subIssues.set(30, [31]);
  const config = {
    trackerVersion: 1,
    repository: TRACKER_REPO,
    project: { owner: 'presljf', title: 'Project Tracker OS', number: 1 },
    workProfile: 'tooling',
    fields: { Stream: { options: ['v1.3.0'] } },
    automation: { templateVersion: '1.3.0', tagPattern: '^v\\d+\\.\\d+\\.\\d+$' },
  };
  const result = await closeStream({
    config,
    github,
    stream: 30,
    evidence: 'release gate self-repo PASS; all child tasks done',
    tag: 'v1.3.0',
    gateCommand: `node scripts/adopt/cli/release-gate.mjs --root ${REPO_ROOT}`,
  });
  assert.equal(result.ok, true);
  assert.equal(result.tag, 'v1.3.0');
  assert.match(result.comment, /### Stream close evidence/);
  assert.match(result.comment, /Release gate:\*\* PASS/);
  assert.match(result.comment, /release-gate\.mjs --root/);
  assert.ok(github.mutations.some((mutation) => mutation[0] === 'closeIssue'));
  assert.equal(github.issues[0].state, 'CLOSED');
  assert.equal(github.items[0].status, 'Done');
});

test('stream close dry-run advertises the default self-repo gate command', async () => {
  const config = {
    trackerVersion: 1,
    repository: TRACKER_REPO,
    project: { owner: 'presljf', title: 'Project Tracker OS', number: 1 },
    workProfile: 'tooling',
    fields: { Stream: { options: ['v1.3.0'] } },
    automation: { templateVersion: '1.3.0', tagPattern: '^v\\d+\\.\\d+\\.\\d+$' },
  };
  const github = new FakeTaskGitHub({
    projects: [{ id: 'PVT_test', number: 1, title: 'Project Tracker' }],
    fields: [{ id: 'FIELD_STATUS', name: 'Status', options: [{ id: 'OPT_0', name: 'Done' }] }],
    issues: [{ number: 30, title: '[Stream] v1.3.0 — Release hardening', state: 'OPEN', type: 'Task', body: '' }],
    items: [{ id: 'ITEM_30', content: { number: 30 }, status: 'In Progress' }],
  });
  const result = await closeStream({ config, github, stream: 30, evidence: 'dry', dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.gate.command, defaultGateCommand(config));
  assert.equal(result.gate.skipped, true);
});
