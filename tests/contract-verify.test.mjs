import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyContract } from '../scripts/adopt/cli/verify-contract.mjs';

const contract = {
  trackerVersion: '1.2.1',
  requiredConfig: ['repository', 'automation.templateVersion'],
  requiredWorkflows: [{ id: 'ci', reusable: 'presljf/github-project-tracker/.github/workflows/reusable-ci.yml' }],
  requiredProfiles: ['node'],
  requiredDocs: ['docs/TRACKER.md'],
  overrideManifest: 'tracker.overrides.json',
};
function fixture({ pin = '1.2.1', workflow = true, docs = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-'));
  fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'tracker.config.json'),
    JSON.stringify({ repository: 'x/y', automation: { templateVersion: pin }, profiles: { node: {} } }),
  );
  if (docs) fs.writeFileSync(path.join(root, 'docs/TRACKER.md'), '# tracker\n');
  if (workflow)
    fs.writeFileSync(
      path.join(root, '.github/workflows/ci.yml'),
      'jobs:\n  ci:\n    uses: presljf/github-project-tracker/.github/workflows/reusable-ci.yml@v1.2.1\n',
    );
  return root;
}
test('clean exact pin passes', () => {
  const root = fixture();
  assert.equal(
    verifyContract({ root, contract, config: JSON.parse(fs.readFileSync(path.join(root, 'tracker.config.json'))) }).ok,
    true,
  );
});
test('stale pin fails', () => {
  const root = fixture({ pin: '1.0.1' });
  assert.ok(
    verifyContract({
      root,
      contract,
      config: JSON.parse(fs.readFileSync(path.join(root, 'tracker.config.json'))),
    }).violations.some((v) => v.includes('templateVersion')),
  );
});
test('missing required workflow without override fails', () => {
  const root = fixture({ workflow: false });
  assert.ok(
    verifyContract({
      root,
      contract,
      config: JSON.parse(fs.readFileSync(path.join(root, 'tracker.config.json'))),
    }).violations.some((v) => v.includes('required workflow missing')),
  );
});
test('valid OI override allows missing workflow', () => {
  const root = fixture({ workflow: false });
  const overrides = {
    overrides: [{ id: 'ci', issue: 'https://github.com/o/r/issues/1', reason: 'legacy', expires: '2099-01-01' }],
  };
  assert.equal(
    verifyContract({
      root,
      contract,
      config: JSON.parse(fs.readFileSync(path.join(root, 'tracker.config.json'))),
      overrides,
    }).ok,
    true,
  );
});
test('expired override fails', () => {
  const root = fixture({ workflow: false });
  const overrides = {
    overrides: [{ id: 'ci', issue: 'https://github.com/o/r/issues/1', reason: 'legacy', expires: '2000-01-01' }],
  };
  assert.ok(
    verifyContract({
      root,
      contract,
      config: JSON.parse(fs.readFileSync(path.join(root, 'tracker.config.json'))),
      overrides,
    }).violations.some((v) => v.includes('expired')),
  );
});

// ---------------------------------------------------------------------------
// v1.4.0 required six-caller adoption contract (issue #141)
// ---------------------------------------------------------------------------

const V140_REQUIRED = [
  ['contract', 'reusable-contract.yml'],
  ['post-merge-audit', 'reusable-post-merge-audit.yml'],
  ['pr-close-guard', 'reusable-pr-close-guard.yml'],
  ['audit', 'reusable-audit.yml'],
  ['e2e', 'reusable-e2e.yml'],
  ['counts', 'reusable-counts.yml'],
];
const sixContract = {
  trackerVersion: '1.2.1',
  requiredConfig: ['repository', 'automation.templateVersion'],
  requiredWorkflows: V140_REQUIRED.map(([id, file]) => ({
    id,
    reusable: `presljf/github-project-tracker/.github/workflows/${file}`,
  })),
  requiredProfiles: ['node'],
  requiredDocs: ['docs/TRACKER.md'],
  overrideManifest: 'tracker.overrides.json',
};

function sixFixture({ missing = null, pin = '1.2.1', wrongPin = null, trackerRef = null, noV = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-six-'));
  fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'tracker.config.json'),
    JSON.stringify({ repository: 'x/y', automation: { templateVersion: '1.2.1' }, profiles: { node: {} } }),
  );
  fs.writeFileSync(path.join(root, 'docs/TRACKER.md'), '# tracker\n');
  for (const [id, file] of V140_REQUIRED) {
    if (id === missing) continue;
    const ref = wrongPin === id ? '9.9.9' : pin;
    const usesRef = noV ? ref : `v${ref}`;
    let workflow = `jobs:\n  ${id}:\n    uses: presljf/github-project-tracker/.github/workflows/${file}@${usesRef}\n`;
    if (trackerRef !== null) {
      workflow += `    with:\n      tracker-ref: ${trackerRef === '' ? "''" : trackerRef}\n`;
    }
    fs.writeFileSync(path.join(root, '.github/workflows', `${id}.yml`), workflow);
  }
  return root;
}

test('all six v1.4.0 callers present at the contract pin passes', () => {
  const root = sixFixture();
  try {
    const result = verifyContract({
      root,
      contract: sixContract,
      config: JSON.parse(fs.readFileSync(path.join(root, 'tracker.config.json'))),
    });
    assert.equal(result.ok, true, result.violations.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a missing one of the six required callers fails with its id', () => {
  for (const [missing, file] of V140_REQUIRED) {
    const root = sixFixture({ missing });
    try {
      const result = verifyContract({
        root,
        contract: sixContract,
        config: JSON.parse(fs.readFileSync(path.join(root, 'tracker.config.json'))),
      });
      assert.equal(result.ok, false);
      assert.ok(
        result.violations.some((v) => v.includes(`required workflow missing: ${missing} (`) && v.includes(file)),
        `missing ${missing} must fail`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('a wrong pin on any one of the six required callers fails', () => {
  for (const [id] of V140_REQUIRED) {
    const root = sixFixture({ wrongPin: id });
    try {
      const result = verifyContract({
        root,
        contract: sixContract,
        config: JSON.parse(fs.readFileSync(path.join(root, 'tracker.config.json'))),
      });
      assert.equal(result.ok, false);
      assert.ok(
        result.violations.some((v) => v.includes(`${id} ref not pinned to v1.2.1`)),
        `wrong pin on ${id} must fail`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('a matching tracker-ref on every required caller passes', () => {
  const root = sixFixture({ trackerRef: 'v1.2.1' });
  try {
    const result = verifyContract({
      root,
      contract: sixContract,
      config: JSON.parse(fs.readFileSync(path.join(root, 'tracker.config.json'))),
    });
    assert.equal(result.ok, true, result.violations.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a stale or empty tracker-ref fails even when the uses ref is pinned', () => {
  for (const trackerRef of ['v1.1.0', '']) {
    const root = sixFixture({ trackerRef });
    try {
      const result = verifyContract({
        root,
        contract: sixContract,
        config: JSON.parse(fs.readFileSync(path.join(root, 'tracker.config.json'))),
      });
      assert.equal(result.ok, false);
      assert.ok(
        result.violations.some((v) => v.includes('tracker-ref not pinned to v1.2.1')),
        `tracker-ref ${trackerRef || '<empty>'} must fail`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('a no-v uses ref is not accepted even though the tag name matches the version', () => {
  const root = sixFixture({ noV: true });
  try {
    const result = verifyContract({
      root,
      contract: sixContract,
      config: JSON.parse(fs.readFileSync(path.join(root, 'tracker.config.json'))),
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.includes('ref not pinned to v1.2.1')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a commented-out required caller does not satisfy the contract', () => {
  const root = sixFixture({ missing: 'contract' });
  try {
    fs.writeFileSync(
      path.join(root, '.github/workflows/comment.yml'),
      [
        '# uses: presljf/github-project-tracker/.github/workflows/reusable-contract.yml@v1.2.1',
        'jobs:',
        '  noop:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: echo no caller',
        '',
      ].join('\n'),
    );
    const result = verifyContract({
      root,
      contract: sixContract,
      config: JSON.parse(fs.readFileSync(path.join(root, 'tracker.config.json'))),
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.includes('required workflow missing: contract')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('trailing YAML comments on uses/tracker-ref are tolerated, but stale values still fail', () => {
  const good = sixFixture({ trackerRef: 'v1.2.1 # pinned for the audit tooling' });
  try {
    const file = path.join(good, '.github/workflows/contract.yml');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('@v1.2.1', '@v1.2.1 # release pin'));
    const result = verifyContract({
      root: good,
      contract: sixContract,
      config: JSON.parse(fs.readFileSync(path.join(good, 'tracker.config.json'))),
    });
    assert.equal(result.ok, true, result.violations.join('\n'));
  } finally {
    fs.rmSync(good, { recursive: true, force: true });
  }

  const stale = sixFixture({ trackerRef: 'v1.1.0 # legacy' });
  try {
    const result = verifyContract({
      root: stale,
      contract: sixContract,
      config: JSON.parse(fs.readFileSync(path.join(stale, 'tracker.config.json'))),
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.includes('tracker-ref not pinned to v1.2.1')));
  } finally {
    fs.rmSync(stale, { recursive: true, force: true });
  }
});

test('an expression tracker-ref fails instead of passing as a non-empty value', () => {
  const root = sixFixture({ trackerRef: '${{ inputs.tracker-ref }}' });
  try {
    const result = verifyContract({
      root,
      contract: sixContract,
      config: JSON.parse(fs.readFileSync(path.join(root, 'tracker.config.json'))),
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.includes('tracker-ref not pinned to v1.2.1')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tracker-ref is checked per job, not against unrelated callers in the same file', () => {
  const root = sixFixture({ trackerRef: 'v1.2.1' });
  try {
    fs.writeFileSync(
      path.join(root, '.github/workflows/combined.yml'),
      [
        'jobs:',
        '  contract:',
        '    uses: presljf/github-project-tracker/.github/workflows/reusable-contract.yml@v1.2.1',
        '    with:',
        '      tracker-ref: v1.2.1',
        '  unrelated-guard:',
        '    uses: presljf/github-project-tracker/.github/workflows/reusable-guard.yml@v1.2.1',
        '    with:',
        '      tracker-ref: v1.0.0',
        '',
      ].join('\n'),
    );
    const result = verifyContract({
      root,
      contract: sixContract,
      config: JSON.parse(fs.readFileSync(path.join(root, 'tracker.config.json'))),
    });
    assert.equal(result.ok, true, result.violations.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('valid 4-space job keys and column-0 comments are parsed, not reported missing', () => {
  const root = sixFixture();
  try {
    fs.writeFileSync(
      path.join(root, '.github/workflows/contract.yml'),
      [
        'jobs:',
        '# a column-0 comment before the first job is valid YAML',
        '    contract:',
        '        uses: presljf/github-project-tracker/.github/workflows/reusable-contract.yml@v1.2.1',
        '        with:',
        '            tracker-ref: v1.2.1',
        '# a column-0 comment between jobs is valid YAML',
        '    extra:',
        '        runs-on: ubuntu-latest',
        '        steps:',
        '            - run: echo ok',
        '',
      ].join('\n'),
    );
    const result = verifyContract({
      root,
      contract: sixContract,
      config: JSON.parse(fs.readFileSync(path.join(root, 'tracker.config.json'))),
    });
    assert.equal(result.ok, true, result.violations.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a custom --config path is honoured by the verify-contract CLI', () => {
  const root = sixFixture({ trackerRef: 'v1.2.1' });
  try {
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.renameSync(path.join(root, 'tracker.config.json'), path.join(root, 'config', 'custom.json'));
    fs.writeFileSync(path.join(root, 'contract.json'), JSON.stringify(sixContract));
    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), 'scripts/adopt/cli/verify-contract.mjs'),
        '--root',
        root,
        '--contract',
        path.join(root, 'contract.json'),
        '--config',
        path.join(root, 'config/custom.json'),
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Adoption contract OK/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the shipped adoption contract requires the six v1.4.0 reusables and every contract is shipped', () => {
  const shipped = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'contract/adoption-contract.json'), 'utf8'));
  for (const [id, file] of V140_REQUIRED) {
    const entry = (shipped.requiredWorkflows || []).find((workflow) => workflow.id === id);
    assert.ok(entry, `adoption contract requires ${id}`);
    assert.equal(entry.reusable, `presljf/github-project-tracker/.github/workflows/${file}`);
    const workflowFile = path.join(process.cwd(), '.github/workflows', file);
    assert.ok(fs.existsSync(workflowFile), `${file} is shipped`);
    assert.match(fs.readFileSync(workflowFile, 'utf8'), /^on:\n {2}workflow_call:/m, `${file} is workflow_call`);
  }
  const ids = new Set((shipped.requiredWorkflows || []).map((workflow) => workflow.id));
  for (const [id] of V140_REQUIRED) assert.ok(ids.has(id), `requiredWorkflows includes ${id}`);
  // The pin source is the contract version (bumped with automation.templateVersion), not a
  // duplicated per-entry field; deriving it here keeps the T07 release bump green.
  const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tracker.config.json'), 'utf8'));
  assert.equal(shipped.trackerVersion, config.automation.templateVersion);
});
