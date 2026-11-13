/* Contract tests for .github/workflows/reusable-contract.yml + its self caller
 * tracker-contract.yml. Dependency-free YAML-subset helpers (regex + indentation scanning); mirrors
 * tests/action-contract.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const WORKFLOW = '.github/workflows/reusable-contract.yml';
const CALLER = '.github/workflows/tracker-contract.yml';
const CHECKOUT_SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const SETUP_NODE_SHA = '949feb2413d6458794dcd2491c4babbbce0c15c1';
const TRACKER_REPO = 'presljf/github-project-tracker';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---------------------------------------------------------------------------
// Pure YAML-subset helpers (also exercised by negative fixtures below)
// ---------------------------------------------------------------------------

function stripComments(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/** Top-level `on:` trigger keys. */
function onTriggers(text) {
  const lines = stripComments(text).split(/\r?\n/);
  const start = lines.findIndex((line) => /^on:\s*$/.test(line));
  const triggers = [];
  if (start < 0) return triggers;
  for (const line of lines.slice(start + 1)) {
    const trigger = /^ {2}([A-Za-z_][\w-]*):/.exec(line);
    if (trigger) triggers.push(trigger[1]);
    else if (line.trim() !== '' && !/^\s/.test(line)) break;
  }
  return triggers;
}

/** Job name -> job YAML block. */
function jobSections(text) {
  const lines = stripComments(text).split(/\r?\n/);
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  const jobs = new Map();
  if (start < 0) return jobs;
  let current = null;
  let buffer = [];
  for (const line of lines.slice(start + 1)) {
    const job = /^ {2}([a-z][\w-]*):\s*$/.exec(line);
    if (job) {
      if (current) jobs.set(current, buffer.join('\n'));
      current = job[1];
      buffer = [line];
      continue;
    }
    if (current) buffer.push(line);
  }
  if (current) jobs.set(current, buffer.join('\n'));
  return jobs;
}

/** `- name: ...` step blocks of one job. */
function splitSteps(jobText) {
  const blocks = [];
  let current = null;
  for (const line of jobText.split(/\r?\n/)) {
    const start = /^(\s*)- name:\s*(.+?)\s*$/.exec(line);
    if (start) {
      if (current) blocks.push(current);
      current = { name: start[2], indent: start[1].length, lines: [line] };
      continue;
    }
    if (!current) continue;
    const indented = line.match(/^\s*/)[0].length;
    if (line.trim() !== '' && indented <= current.indent && /^- /.test(line.trim())) {
      blocks.push(current);
      current = null;
      continue;
    }
    current.lines.push(line);
  }
  if (current) blocks.push(current);
  return blocks.map((block) => ({ name: block.name, text: block.lines.join('\n') }));
}

function stepText(jobText, name) {
  const step = splitSteps(jobText).find((item) => item.name === name);
  assert.ok(step, `step '${name}' exists`);
  return step.text;
}

/** Input name -> { required, default } inside the workflow_call `inputs:` mapping. */
function callInputs(text) {
  const lines = stripComments(text).split(/\r?\n/);
  const start = lines.findIndex((line) => /^ {4}inputs:\s*$/.test(line));
  const inputs = {};
  if (start < 0) return inputs;
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,4}\S/.test(line)) break;
    const name = /^ {6}([a-z0-9-]+):\s*$/.exec(line);
    if (name) {
      current = name[1];
      inputs[current] = { required: null, default: null };
      continue;
    }
    if (!current) continue;
    const required = /^\s+required:\s*(true|false)\s*$/.exec(line);
    if (required) inputs[current].required = required[1];
    const def = /^\s+default:\s*(.*)$/.exec(line);
    if (def) inputs[current].default = def[1].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return inputs;
}

/** Secret name -> required flag inside the workflow_call `secrets:` mapping. */
function callSecrets(text) {
  const lines = stripComments(text).split(/\r?\n/);
  const start = lines.findIndex((line) => /^ {4}secrets:\s*$/.test(line));
  const secrets = {};
  if (start < 0) return secrets;
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,4}\S/.test(line)) break;
    const name = /^ {6}([A-Za-z_][\w-]*):\s*$/.exec(line);
    if (name) {
      current = name[1];
      secrets[current] = { required: null };
      continue;
    }
    if (!current) continue;
    const required = /^\s+required:\s*(true|false)\s*$/.exec(line);
    if (required) secrets[current].required = required[1];
  }
  return secrets;
}

/** Non-local `uses:` refs that are not pinned to a full 40-hex commit SHA. */
function unpinnedUses(text) {
  const unpinned = [];
  for (const match of stripComments(text).matchAll(/^\s*(?:- )?uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
    const ref = match[1].replace(/^['"]|['"]$/g, '');
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    if (!/@[0-9a-f]{40}$/.test(ref)) unpinned.push(ref);
  }
  return unpinned;
}

/** Permission lines that grant write access (comma-separated list accepted). */
function writePermissionLines(text) {
  return stripComments(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[a-z-]+:\s*write$/.test(line));
}

function allJobPermissions(text) {
  const permissions = new Map();
  for (const [job, block] of jobSections(text)) {
    const match = /^\s+permissions:\n((?:\s{6,}[^\n]*\n?)+)/m.exec(block);
    permissions.set(job, match ? match[1].trim() : null);
  }
  return permissions;
}

// ---------------------------------------------------------------------------
// Reusable workflow: trigger, interface, permissions
// ---------------------------------------------------------------------------

test('reusable-contract.yml is workflow_call only with the documented inputs', () => {
  const workflow = read(WORKFLOW);
  assert.deepEqual(onTriggers(workflow), ['workflow_call']);
  assert.match(workflow, /^name: Reusable contract and metadata verification$/m);

  const inputs = callInputs(workflow);
  assert.deepEqual(Object.keys(inputs).sort(), [
    'config-path',
    'contract-path',
    'metadata',
    'node-version',
    'runs-on',
    'submodule-path',
    'tracker-ref',
    'version-guard-command',
    'working-directory',
  ]);
  const expected = {
    'tracker-ref': { default: 'v1.4.0', required: 'false' },
    'config-path': { default: 'tracker.config.json', required: 'false' },
    'contract-path': { default: '', required: 'false' },
    'runs-on': { default: 'ubuntu-latest', required: 'false' },
    'version-guard-command': { default: '', required: 'false' },
    metadata: { default: 'true', required: 'false' },
    'working-directory': { default: '.', required: 'false' },
    'submodule-path': { default: '.tracker-os', required: 'false' },
    'node-version': { default: '22', required: 'false' },
  };
  for (const [name, spec] of Object.entries(expected)) {
    assert.equal(inputs[name].default, spec.default, `${name} default`);
    assert.equal(inputs[name].required, spec.required, `${name} required`);
  }

  // tracker-ref default must track the pinned template version (release bump updates both).
  const config = JSON.parse(read('tracker.config.json'));
  assert.equal(inputs['tracker-ref'].default, `v${config.automation.templateVersion}`);
});

test('reusable-contract.yml exposes job outputs and one optional token secret', () => {
  const workflow = read(WORKFLOW);
  assert.match(
    workflow,
    /contract-ok:\n {8}description:[\s\S]*?value: \$\{\{ jobs\.contract\.outputs\.contract-ok \}\}/,
  );
  assert.match(
    workflow,
    /metadata-ok:\n {8}description:[\s\S]*?value: \$\{\{ jobs\.metadata\.outputs\.metadata-ok \}\}/,
  );
  assert.deepEqual(callSecrets(workflow), { TRACKER_TOKEN: { required: 'false' } });
  // The offline contract job never touches the token.
  const contractJob = jobSections(workflow).get('contract');
  assert.doesNotMatch(contractJob, /secrets\./);
  assert.doesNotMatch(contractJob, /GH_TOKEN/);
});

test('permissions are contents:read only, with no writes, artifacts, or pull_request_target', () => {
  const workflow = stripComments(read(WORKFLOW));
  const topLevelPermissions = /^permissions:\n((?: {2}[^\n]*\n?)+)/m.exec(workflow);
  assert.ok(topLevelPermissions, 'top-level permissions');
  assert.equal(topLevelPermissions[1].trim(), 'contents: read');
  assert.deepEqual(writePermissionLines(read(WORKFLOW)), []);
  for (const [job, permissions] of allJobPermissions(read(WORKFLOW))) {
    assert.equal(permissions, 'contents: read', `${job} permissions are read-only`);
  }
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.doesNotMatch(workflow, /^\s*uses:\s*actions\/upload/m);
  assert.doesNotMatch(workflow, /artifact-name|retention-days/);
  assert.doesNotMatch(workflow, /scripts\/github\//);
});

test('all external uses are pinned to the exact contract SHAs', () => {
  const workflow = read(WORKFLOW);
  assert.deepEqual(unpinnedUses(workflow), []);
  const uses = [...stripComments(workflow).matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
  const external = uses.filter((ref) => !ref.startsWith('./'));
  assert.ok(external.length >= 4);
  for (const ref of external) {
    assert.ok(
      ref === `actions/checkout@${CHECKOUT_SHA}` || ref === `actions/setup-node@${SETUP_NODE_SHA}`,
      `unexpected external action: ${ref}`,
    );
  }
  assert.ok(external.includes(`actions/checkout@${CHECKOUT_SHA}`));
  assert.ok(external.includes(`actions/setup-node@${SETUP_NODE_SHA}`));
});

// ---------------------------------------------------------------------------
// Reusable workflow: jobs and steps
// ---------------------------------------------------------------------------

test('jobs are contract + metadata + version-guard, with metadata gated on the input and independent', () => {
  const jobs = jobSections(read(WORKFLOW));
  assert.deepEqual([...jobs.keys()], ['contract', 'metadata', 'version-guard']);
  assert.match(jobs.get('metadata'), /^ {4}if: \$\{\{ inputs\.metadata \}\}$/m);
  assert.doesNotMatch(jobs.get('metadata'), /^ {4}needs:/m);
  assert.match(jobs.get('contract'), /^ {4}runs-on: \$\{\{ inputs\.runs-on \}\}$/m);
  assert.match(jobs.get('metadata'), /^ {4}runs-on: \$\{\{ inputs\.runs-on \}\}$/m);
});

test('contract job runs the checks in the documented order', () => {
  const contractJob = jobSections(read(WORKFLOW)).get('contract');
  assert.deepEqual(
    splitSteps(contractJob).map((step) => step.name),
    [
      'Checkout adopter repository',
      'Checkout tracker contract and tooling',
      'Set up Node.js',
      'Resolve contract paths',
      'Fetch pinned tracker submodule tags',
      'Verify tooling contract',
      'Verify adoption contract',
    ],
  );
});

test('checkouts use the adopter checkout then the conditional pinned tracker checkout', () => {
  const adopter = stepText(jobSections(read(WORKFLOW)).get('contract'), 'Checkout adopter repository');
  assert.match(adopter, new RegExp(`uses: actions/checkout@${CHECKOUT_SHA}`));
  assert.match(adopter, /persist-credentials: false/);
  assert.match(adopter, /submodules: recursive/);

  const tracker = stepText(jobSections(read(WORKFLOW)).get('contract'), 'Checkout tracker contract and tooling');
  assert.match(tracker, /if: \$\{\{ github\.repository != 'presljf\/github-project-tracker' \}\}/);
  assert.match(tracker, /repository: presljf\/github-project-tracker/);
  assert.match(tracker, /ref: \$\{\{ inputs\.tracker-ref \}\}/);
  assert.match(tracker, /path: \.tracker/);
  assert.match(tracker, /persist-credentials: false/);
});

test('resolve-paths step detects self mode and downstream mode and honours contract-path', () => {
  const resolve = stepText(jobSections(read(WORKFLOW)).get('contract'), 'Resolve contract paths');
  assert.match(resolve, /CANONICAL_REPOSITORY: presljf\/github-project-tracker/);
  assert.match(resolve, /"\$\{GITHUB_REPOSITORY:-\}" = "\$CANONICAL_REPOSITORY"/);
  assert.match(resolve, /tracker="\$GITHUB_WORKSPACE"/);
  assert.match(resolve, /tracker="\$GITHUB_WORKSPACE\/\.tracker"/);
  assert.match(resolve, /contract\/adoption-contract\.json/);
  assert.match(resolve, /\.tracker\/contract\/adoption-contract\.json/);
  assert.match(resolve, /contract="\$\{CONTRACT_PATH_INPUT:-\}"/);
  assert.match(resolve, />> "\$GITHUB_OUTPUT"/);
  assert.match(resolve, /echo "workdir=\$\{workdir\}"/);
});

test('submodule fetch is conditional on an input path and skips with a notice', () => {
  const fetchStep = stepText(jobSections(read(WORKFLOW)).get('contract'), 'Fetch pinned tracker submodule tags');
  assert.match(fetchStep, /SUBMODULE_PATH: \$\{\{ inputs\.submodule-path \}\}/);
  assert.match(fetchStep, /\[ -d "\$SUBMODULE_PATH" \]/);
  assert.match(fetchStep, /git -C "\$SUBMODULE_PATH" rev-parse --git-dir/);
  assert.match(fetchStep, /git -C "\$SUBMODULE_PATH" fetch --tags --force/);
  assert.match(fetchStep, /::notice::No tracker submodule at/);
});

test('optional version guard runs in its own job without the untrusted template checkout', () => {
  const job = jobSections(read(WORKFLOW)).get('version-guard');
  assert.ok(job, 'version-guard job exists');
  assert.match(job, /^ {4}if: \$\{\{ inputs\.version-guard-command != '' \}\}$/m);
  assert.match(job, /^ {4}runs-on: \$\{\{ inputs\.runs-on \}\}$/m);
  // Arbitrary caller-command execution must never share a job with the untrusted pinned checkout.
  assert.doesNotMatch(job, /ref: \$\{\{ inputs\.tracker-ref \}\}/);
  assert.doesNotMatch(job, /path: \.tracker/);
  assert.doesNotMatch(job, /repository: presljf\/github-project-tracker/);
  assert.doesNotMatch(job, /secrets\./);
  const checkout = stepText(job, 'Checkout adopter repository');
  assert.match(checkout, /persist-credentials: false/);
  assert.doesNotMatch(checkout, /submodules:/);
  const guard = stepText(job, 'Run optional version guard');
  assert.match(guard, /working-directory: \$\{\{ inputs\.working-directory \}\}/);
  assert.match(guard, /bash -euo pipefail -c "\$\{COMMAND\}"/);
});

test('verify steps call the reorganized tooling with the resolved paths', () => {
  const contractJob = jobSections(read(WORKFLOW)).get('contract');
  const tooling = stepText(contractJob, 'Verify tooling contract');
  assert.match(
    tooling,
    /node "\$TRACKER\/scripts\/adopt\/cli\/verify-tooling\.mjs" --root "\$WORKDIR" --contract "\$CONTRACT" --tracker-config "\$CONFIG"/,
  );
  const contract = stepText(contractJob, 'Verify adoption contract');
  assert.match(contract, /id: verify-contract/);
  assert.match(
    contract,
    /node "\$TRACKER\/scripts\/adopt\/cli\/verify-contract\.mjs" --root "\$WORKDIR" --contract "\$CONTRACT"/,
  );
  assert.match(contract, /echo "ok=true" >> "\$GITHUB_OUTPUT"/);
  assert.doesNotMatch(read(WORKFLOW), /scripts\/github\//);
});

test('metadata job requires the token with an actionable error and verifies from the working directory', () => {
  const metadataJob = jobSections(read(WORKFLOW)).get('metadata');
  const requireToken = stepText(metadataJob, 'Require TRACKER_TOKEN for live metadata');
  assert.match(requireToken, /GH_TOKEN: \$\{\{ secrets\.TRACKER_TOKEN \}\}/);
  assert.match(
    requireToken,
    /metadata: true requires the TRACKER_TOKEN secret \(Projects read\); pass metadata: false on fork PRs/,
  );
  assert.match(requireToken, /exit 1/);

  const verify = stepText(metadataJob, 'Verify live project metadata');
  assert.match(verify, /GH_TOKEN: \$\{\{ secrets\.TRACKER_TOKEN \}\}/);
  assert.match(verify, /cd "\$WORKDIR"/);
  assert.match(
    verify,
    /node "\$TRACKER\/scripts\/adopt\/cli\/verify-metadata\.mjs" --repo "\$\{\{ github\.repository \}\}" --contract "\$CONTRACT"/,
  );
  assert.match(verify, /echo "ok=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(verify, /id: verify-metadata/);
});

// ---------------------------------------------------------------------------
// Self caller
// ---------------------------------------------------------------------------

test('tracker-contract.yml is the thin self caller with the documented contexts', () => {
  const caller = read(CALLER);
  assert.match(caller, /^name: Tracker contract$/m);
  assert.deepEqual(onTriggers(caller), ['pull_request', 'push', 'workflow_dispatch']);
  assert.match(caller, /push:\n {4}branches: \[main\]/);

  const jobs = jobSections(caller);
  assert.deepEqual([...jobs.keys()], ['tracker-contract']);
  const job = jobs.get('tracker-contract');
  assert.match(job, /^ {4}name: tracker-contract$/m);
  assert.match(job, /uses: \.\/\.github\/workflows\/reusable-contract\.yml/);
  assert.match(job, /tracker-ref: ''/);
  assert.match(job, /config-path: tracker\.config\.json/);
  assert.match(job, /contract-path: ''/);
  assert.match(job, /metadata: false/);
  assert.match(read(CALLER), /tooling work profile/);
  assert.match(job, /secrets:\n {6}TRACKER_TOKEN: \$\{\{ secrets\.TRACKER_TOKEN \}\}/);

  const topLevelPermissions = /^permissions:\n((?: {2}[^\n]*\n?)+)/m.exec(stripComments(caller));
  assert.ok(topLevelPermissions);
  assert.equal(topLevelPermissions[1].trim(), 'contents: read');
  assert.deepEqual(writePermissionLines(caller), []);
  assert.doesNotMatch(stripComments(caller), /pull_request_target/);
  assert.doesNotMatch(stripComments(caller), /^ {2}metadata:/m, 'metadata is not a job');
  assert.deepEqual(unpinnedUses(caller), []);
});

// ---------------------------------------------------------------------------
// Negative fixtures for the pure helpers
// ---------------------------------------------------------------------------

test('onTriggers detects forbidden triggers (negative fixture)', () => {
  const inline = 'on:\n  pull_request_target:\n  push:\n    branches: [main]\n';
  assert.deepEqual(onTriggers(inline), ['pull_request_target', 'push']);
  const reusable = 'on:\n  workflow_call:\n    inputs:\n      x:\n        type: string\n';
  assert.deepEqual(onTriggers(reusable), ['workflow_call']);
});

test('unpinnedUses detects floating refs and allows local/sha-pinned ones (negative fixture)', () => {
  const floating = [
    'steps:',
    '  - name: Bad',
    `    uses: actions/checkout@${'a'.repeat(40)}`,
    '  - name: Worse',
    '    uses: actions/checkout@v4',
    '  - name: Local',
    '    uses: ./.github/workflows/reusable-contract.yml',
  ].join('\n');
  assert.deepEqual(unpinnedUses(floating), ['actions/checkout@v4']);
});

test('writePermissionLines flags write grants (negative fixture)', () => {
  assert.deepEqual(writePermissionLines('permissions:\n  contents: write'), ['contents: write']);
  assert.deepEqual(writePermissionLines('permissions:\n  contents: read'), []);
});

test('jobSections does not leak sibling jobs (negative fixture)', () => {
  const inline = [
    'jobs:',
    '  contract:',
    '    steps:',
    '      - name: Contract step',
    '        run: echo contract',
    '  metadata:',
    '    if: ${{ inputs.metadata }}',
    '    steps:',
    '      - name: Metadata step',
    '        run: echo metadata',
  ].join('\n');
  const jobs = jobSections(inline);
  assert.deepEqual([...jobs.keys()], ['contract', 'metadata']);
  assert.deepEqual(
    splitSteps(jobs.get('contract')).map((step) => step.name),
    ['Contract step'],
  );
});

// ---------------------------------------------------------------------------
// Peer-owned profile examples (docs workers land these in the same PR)
// ---------------------------------------------------------------------------

test('profiles/contract copy-mode example matches the reusable contract', () => {
  const file = path.join(ROOT, 'profiles/contract/tracker-contract.yml');
  assert.ok(fs.existsSync(file), 'profiles/contract/tracker-contract.yml exists (peer docs worker)');
  const example = fs.readFileSync(file, 'utf8');
  const firstLine = example.split(/\r?\n/).find((line) => line.trim() !== '');
  assert.match(firstLine, /^# COPY-MODE EXAMPLE/);
  assert.match(example, /uses: presljf\/github-project-tracker\/\.github\/workflows\/reusable-contract\.yml@v1\.4\.0/);
  assert.doesNotMatch(example, /pull_request_target/);
});

test('profiles/contract README documents token setup, pin, and check contexts', () => {
  const file = path.join(ROOT, 'profiles/contract/README.md');
  assert.ok(fs.existsSync(file), 'profiles/contract/README.md exists (peer docs worker)');
  const readme = fs.readFileSync(file, 'utf8');
  for (const phrase of [
    'reusable-contract.yml',
    '@v1.4.0',
    'TRACKER_TOKEN',
    'tracker-contract / contract',
    'tracker-contract / metadata',
  ]) {
    assert.ok(readme.includes(phrase), `README covers ${phrase}`);
  }
});
