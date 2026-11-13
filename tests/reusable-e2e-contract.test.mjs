/* Contract tests for .github/workflows/reusable-e2e.yml (T05 / issue #140).
 * Dependency-free YAML-subset helpers (regex + indentation scanning); mirrors
 * tests/reusable-contract-contract.test.mjs and tests/reusable-audit-family-contract.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const WORKFLOW = '.github/workflows/reusable-e2e.yml';
const CHECKOUT_SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const ARTIFACT_SHA = 'cf430e030ddbb5b0abf93d22962f4752f3646cd9';
const TRACKER_REPO = 'presljf/github-project-tracker';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

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

/** Output name -> value expression inside the workflow_call `outputs:` mapping. */
function callOutputs(text) {
  const lines = stripComments(text).split(/\r?\n/);
  const start = lines.findIndex((line) => /^ {4}outputs:\s*$/.test(line));
  const outputs = {};
  if (start < 0) return outputs;
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,4}\S/.test(line)) break;
    const name = /^ {6}([a-z0-9-]+):\s*$/.exec(line);
    if (name) {
      current = name[1];
      continue;
    }
    const value = /^\s+value:\s*(.+)$/.exec(line);
    if (value && current) outputs[current] = value[1].trim();
  }
  return outputs;
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

/** Permission lines that grant write access (negative fixture helper). */
function writePermissionLines(text) {
  return stripComments(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[a-z-]+:\s*write$/.test(line));
}

function topLevelPermissions(text) {
  const match = /^permissions:\n((?: {2}[^\n]*\n?)+)/m.exec(stripComments(text));
  return match ? match[1].trim() : null;
}

function jobPermissions(jobText) {
  const match = /^\s{4}permissions:\n((?:\s{6,}[^\n]*\n?)+)/m.exec(jobText);
  return match ? match[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

test('reusable-e2e.yml is workflow_call only with the documented inputs', () => {
  const workflow = read(WORKFLOW);
  assert.deepEqual(onTriggers(workflow), ['workflow_call']);
  assert.match(workflow, /^name: Reusable Playwright E2E$/m);

  const inputs = callInputs(workflow);
  assert.deepEqual(Object.keys(inputs).sort(), [
    'artifact-name',
    'artifact-path',
    'artifact-retention-days',
    'browsers',
    'install-command',
    'node-version',
    'package-manager',
    'runs-on',
    'test-command',
    'timeout-minutes',
    'upload-on-success',
    'working-directory',
  ]);
  const expected = {
    'node-version': '22',
    'working-directory': '.',
    'package-manager': 'npm',
    'install-command': '',
    'test-command': 'npm run e2e',
    browsers: 'chromium',
    'artifact-path': '',
    'artifact-name': 'e2e-artifacts',
    'artifact-retention-days': '7',
    'upload-on-success': 'false',
    'runs-on': 'ubuntu-latest',
    'timeout-minutes': '20',
  };
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(inputs[name].default, value, `${name} default`);
    assert.equal(inputs[name].required, 'false', `${name} required`);
  }
  assert.ok(!('tracker-ref' in inputs), 'no tracker-ref input: E2E needs no tracker scripts');
});

test('reusable-e2e.yml exposes the documented outputs', () => {
  assert.deepEqual(callOutputs(read(WORKFLOW)), {
    'e2e-passed': '${{ jobs.e2e.outputs.e2e-passed }}',
    'artifact-name': '${{ jobs.e2e.outputs.artifact-name }}',
  });
});

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

test('reusable-e2e.yml is read-only, secret-free, and PR-target-free', () => {
  const workflow = read(WORKFLOW);
  const stripped = stripComments(workflow);
  assert.equal(topLevelPermissions(workflow), 'contents: read');
  assert.equal(jobPermissions(jobSections(workflow).get('e2e')), 'contents: read');
  assert.deepEqual(writePermissionLines(workflow), []);
  assert.doesNotMatch(stripped, /pull_request_target/);
  assert.doesNotMatch(stripped, /^ {4}secrets:/m);
  assert.doesNotMatch(stripped, /\$\{\{\s*secrets\./);
});

test('reusable-e2e.yml pins every external action to the contract SHAs', () => {
  const workflow = read(WORKFLOW);
  assert.deepEqual(unpinnedUses(workflow), []);
  const uses = [...stripComments(workflow).matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
  const external = uses.filter((ref) => !ref.startsWith('./'));
  assert.deepEqual(external, [
    `actions/checkout@${CHECKOUT_SHA}`,
    `actions/checkout@${CHECKOUT_SHA}`,
    `actions/upload-artifact@${ARTIFACT_SHA}`,
  ]);
  assert.doesNotMatch(
    stripComments(workflow),
    /^\s*uses:\s*actions\/setup-node@/m,
    'Node setup goes through the composite action, not a direct setup-node step',
  );
  assert.ok(uses.includes('./.tracker-actions/.github/actions/setup-node-cache'));
});

// ---------------------------------------------------------------------------
// Steps and behavior
// ---------------------------------------------------------------------------

test('e2e job shape, timeout, and step order', () => {
  const jobs = jobSections(read(WORKFLOW));
  assert.deepEqual([...jobs.keys()], ['e2e']);
  const job = jobs.get('e2e');
  assert.match(job, /^ {4}name: e2e$/m);
  assert.match(job, /^ {4}runs-on: \$\{\{ inputs\.runs-on \}\}$/m);
  assert.match(job, /^ {4}timeout-minutes: \$\{\{ inputs\.timeout-minutes \}\}$/m);
  assert.match(job, /^ {4}outputs:\n {6}e2e-passed: \$\{\{ steps\.e2e\.outcome == 'success' \}\}$/m);
  assert.match(job, /^ {6}artifact-name: \$\{\{ inputs\.artifact-name \}\}$/m);
  assert.deepEqual(
    splitSteps(job).map((step) => step.name),
    [
      'Checkout adopter repository',
      'Checkout tracker action source',
      'Set up Node and dependencies',
      'Install Playwright browsers',
      'Run E2E tests',
      'Upload failure artifacts',
    ],
  );
});

test('checkouts: adopter first, then the tracker action source via job.workflow_repository/sha', () => {
  const job = jobSections(read(WORKFLOW)).get('e2e');
  const adopter = stepText(job, 'Checkout adopter repository');
  assert.match(adopter, new RegExp(`uses: actions/checkout@${CHECKOUT_SHA}`));
  assert.match(adopter, /persist-credentials: false/);

  const tracker = stepText(job, 'Checkout tracker action source');
  assert.match(tracker, new RegExp(`uses: actions/checkout@${CHECKOUT_SHA}`));
  assert.match(tracker, /repository: \$\{\{ job\.workflow_repository \}\}/);
  assert.match(tracker, /ref: \$\{\{ job\.workflow_sha \}\}/);
  assert.match(tracker, /path: \.tracker-actions/);
  assert.match(tracker, /persist-credentials: false/);
});

test('setup-node-cache is consumed with the documented inputs', () => {
  const setup = stepText(jobSections(read(WORKFLOW)).get('e2e'), 'Set up Node and dependencies');
  assert.match(setup, /uses: \.\/\.tracker-actions\/\.github\/actions\/setup-node-cache/);
  assert.match(setup, /node-version: \$\{\{ inputs\.node-version \}\}/);
  assert.match(setup, /working-directory: \$\{\{ inputs\.working-directory \}\}/);
  assert.match(setup, /package-manager: \$\{\{ inputs\.package-manager \}\}/);
  assert.match(setup, /install-command: \$\{\{ inputs\.install-command \}\}/);
});

test('Playwright install skips on empty/none and maps comma lists with a Linux-only --with-deps', () => {
  const install = stepText(jobSections(read(WORKFLOW)).get('e2e'), 'Install Playwright browsers');
  assert.match(install, /if: \$\{\{ inputs\.browsers != '' && inputs\.browsers != 'none' \}\}/);
  assert.match(install, /working-directory: \$\{\{ inputs\.working-directory \}\}/);
  assert.match(install, /tr ',' ' '/);
  assert.match(install, /xargs/);
  assert.match(install, /\[ "\$\(uname -s\)" = "Linux" \]/);
  assert.match(install, /npx playwright install --with-deps \$browsers/);
  assert.match(install, /npx playwright install \$browsers/);
});

test('the E2E command runs through bash -euo pipefail with env-provided input', () => {
  const run = stepText(jobSections(read(WORKFLOW)).get('e2e'), 'Run E2E tests');
  assert.match(run, /id: e2e/);
  assert.match(run, /working-directory: \$\{\{ inputs\.working-directory \}\}/);
  assert.match(run, /COMMAND: \$\{\{ inputs\.test-command \}\}/);
  assert.match(run, /bash -euo pipefail -c "\$\{COMMAND\}"/);
  const script = run.split('run: |')[1] ?? '';
  assert.doesNotMatch(script, /\$\{\{\s*inputs\./, 'never interpolate inputs into the run script directly');
  assert.match(script, /bash -euo pipefail -c "\$\{COMMAND\}"/);
});

test('failure artifacts upload only when configured, after the test step', () => {
  const job = jobSections(read(WORKFLOW)).get('e2e');
  const upload = stepText(job, 'Upload failure artifacts');
  assert.match(upload, /if: \$\{\{ \(failure\(\) \|\| inputs\.upload-on-success\) && inputs\.artifact-path != '' \}\}/);
  assert.match(upload, new RegExp(`uses: actions/upload-artifact@${ARTIFACT_SHA}`));
  assert.match(upload, /name: \$\{\{ inputs\.artifact-name \}\}/);
  assert.match(upload, /path: \$\{\{ inputs\.artifact-path \}\}/);
  assert.match(upload, /if-no-files-found: warn/);
  assert.match(upload, /retention-days: \$\{\{ inputs\.artifact-retention-days \}\}/);
  assert.ok(job.indexOf('Upload failure artifacts') > job.indexOf('Run E2E tests'), 'upload follows the test run');
});

// ---------------------------------------------------------------------------
// Negative fixtures for the helpers
// ---------------------------------------------------------------------------

test('onTriggers detects forbidden triggers (negative fixture)', () => {
  assert.deepEqual(onTriggers('on:\n  pull_request_target:\n  push:\n'), ['pull_request_target', 'push']);
  assert.deepEqual(onTriggers('on:\n  workflow_call:\n    inputs:\n      x:\n        type: string\n'), [
    'workflow_call',
  ]);
});

test('unpinnedUses detects floating refs (negative fixture)', () => {
  assert.deepEqual(unpinnedUses('steps:\n  - uses: actions/checkout@v4\n'), ['actions/checkout@v4']);
  assert.deepEqual(unpinnedUses(`steps:\n  - uses: actions/checkout@${CHECKOUT_SHA}\n  - uses: ./local\n`), []);
});

test('writePermissionLines flags write grants (negative fixture)', () => {
  assert.deepEqual(writePermissionLines('permissions:\n  contents: write'), ['contents: write']);
  assert.deepEqual(writePermissionLines('permissions:\n  contents: read'), []);
});

test('callInputs defaults are quoted-string normalized (negative fixture)', () => {
  assert.deepEqual(callInputs('on:\n    inputs:\n      x:\n        required: false\n        default: "a"\n'), {
    x: { required: 'false', default: 'a' },
  });
  assert.deepEqual(callInputs('name: no workflow_call'), {});
});
