/* Contract tests for .github/workflows/reusable-counts.yml, its self caller counts-docs.yml and the
 * dispatch-only e2e-fixture.yml (T05 / issue #140). Dependency-free YAML-subset helpers; mirrors
 * tests/reusable-contract-contract.test.mjs and tests/reusable-audit-family-contract.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const WORKFLOW = '.github/workflows/reusable-counts.yml';
const CALLER = '.github/workflows/counts-docs.yml';
const FIXTURE = '.github/workflows/e2e-fixture.yml';
const CHECKOUT_SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const SETUP_NODE_SHA = '949feb2413d6458794dcd2491c4babbbce0c15c1';
const TRACKER_REPO = 'presljf/github-project-tracker';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const config = JSON.parse(read('tracker.config.json'));

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

/** `with:` mapping under a caller job (values trimmed). */
function jobWith(jobText) {
  const lines = jobText.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s{4}with:\s*$/.test(line));
  const values = {};
  if (start < 0) return values;
  for (const line of lines.slice(start + 1)) {
    if (/^\s{0,4}\S/.test(line)) break;
    const entry = /^\s{6}([a-z0-9-]+):\s*(.*)$/.exec(line);
    if (entry) values[entry[1]] = entry[2].trim();
  }
  return values;
}

// ---------------------------------------------------------------------------
// reusable-counts.yml interface
// ---------------------------------------------------------------------------

test('reusable-counts.yml is workflow_call only with the documented inputs', () => {
  const workflow = read(WORKFLOW);
  assert.deepEqual(onTriggers(workflow), ['workflow_call']);
  assert.match(workflow, /^name: Reusable counts docs verification$/m);

  const inputs = callInputs(workflow);
  assert.deepEqual(Object.keys(inputs).sort(), ['config-path', 'node-version', 'runs-on', 'tracker-ref']);
  assert.deepEqual(inputs, {
    'tracker-ref': { required: 'false', default: `v${config.automation.templateVersion}` },
    'config-path': { required: 'false', default: 'tracker.config.json' },
    'runs-on': { required: 'false', default: 'ubuntu-latest' },
    'node-version': { required: 'false', default: '22' },
  });
});

test('reusable-counts.yml exposes counts-ok and the guard step output', () => {
  const workflow = read(WORKFLOW);
  assert.deepEqual(callOutputs(workflow), { 'counts-ok': '${{ jobs.counts.outputs.counts-ok }}' });
  const job = jobSections(workflow).get('counts');
  assert.match(job, /^ {4}outputs:\n {6}counts-ok: \$\{\{ steps\.counts\.outputs\.ok \}\}$/m);
});

test('reusable-counts.yml is read-only, secret-free, and artifact-free', () => {
  const workflow = read(WORKFLOW);
  const stripped = stripComments(workflow);
  assert.equal(topLevelPermissions(workflow), 'contents: read');
  assert.equal(jobPermissions(jobSections(workflow).get('counts')), 'contents: read');
  assert.deepEqual(writePermissionLines(workflow), []);
  assert.doesNotMatch(stripped, /pull_request_target/);
  assert.doesNotMatch(stripped, /^ {4}secrets:/m);
  assert.doesNotMatch(stripped, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(stripped, /upload-artifact/);
});

test('reusable-counts.yml pins checkout and setup-node to the contract SHAs', () => {
  const workflow = read(WORKFLOW);
  assert.deepEqual(unpinnedUses(workflow), []);
  const uses = [...stripComments(workflow).matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
  assert.deepEqual(uses, [
    `actions/checkout@${CHECKOUT_SHA}`,
    `actions/checkout@${CHECKOUT_SHA}`,
    `actions/setup-node@${SETUP_NODE_SHA}`,
  ]);
});

test('counts job shape and step order', () => {
  const job = jobSections(read(WORKFLOW)).get('counts');
  assert.ok(job, 'job counts exists');
  assert.match(job, /^ {4}name: counts$/m);
  assert.match(job, /^ {4}runs-on: \$\{\{ inputs\.runs-on \}\}$/m);
  assert.deepEqual(
    splitSteps(job).map((step) => step.name),
    [
      'Checkout adopter repository',
      'Checkout tracker tooling',
      'Set up Node.js',
      'Resolve counts paths',
      'Verify counts docs contract',
    ],
  );
});

// ---------------------------------------------------------------------------
// Self mode / downstream mode and the guard invocation
// ---------------------------------------------------------------------------

test('tracker checkout is conditional and pinned; self mode reads the workspace', () => {
  const job = jobSections(read(WORKFLOW)).get('counts');
  const adopter = stepText(job, 'Checkout adopter repository');
  assert.match(adopter, new RegExp(`uses: actions/checkout@${CHECKOUT_SHA}`));
  assert.match(adopter, /persist-credentials: false/);

  const tracker = stepText(job, 'Checkout tracker tooling');
  assert.match(tracker, /if: \$\{\{ github\.repository != 'presljf\/github-project-tracker' \}\}/);
  assert.match(tracker, /repository: presljf\/github-project-tracker/);
  assert.match(tracker, /ref: \$\{\{ inputs\.tracker-ref \}\}/);
  assert.match(tracker, /path: \.tracker/);
  assert.match(tracker, /persist-credentials: false/);
});

test('resolve step detects self/downstream mode, builds absolute paths, and fails fast', () => {
  const resolve = stepText(jobSections(read(WORKFLOW)).get('counts'), 'Resolve counts paths');
  assert.match(resolve, /CANONICAL_REPOSITORY: presljf\/github-project-tracker/);
  assert.match(resolve, /"\$\{GITHUB_REPOSITORY:-\}" = "\$CANONICAL_REPOSITORY"/);
  assert.match(resolve, /tracker="\$GITHUB_WORKSPACE"/);
  assert.match(resolve, /tracker="\$GITHUB_WORKSPACE\/\.tracker"/);
  assert.match(resolve, /config="\$GITHUB_WORKSPACE\/\$\{CONFIG_PATH_INPUT:-tracker\.config\.json\}"/);
  assert.match(resolve, /::error::tracker config not found/);
  assert.match(resolve, /::error::counts guard not found/);
  assert.match(resolve, /steps\.paths\.outputs\.tracker|>> "\$GITHUB_OUTPUT"/);
});

test('the counts guard runs with --root workspace and the resolved config; no inventory', () => {
  const job = jobSections(read(WORKFLOW)).get('counts');
  const guard = stepText(job, 'Verify counts docs contract');
  assert.match(guard, /id: counts/);
  assert.match(
    guard,
    /node "\$TRACKER\/scripts\/adopt\/cli\/guard-docs-counts\.mjs" --root "\$GITHUB_WORKSPACE" --config "\$CONFIG"/,
  );
  assert.match(guard, /echo "ok=true" >> "\$GITHUB_OUTPUT"/);

  const stripped = stripComments(read(WORKFLOW));
  assert.doesNotMatch(stripped, /suite-counts/, 'no suite inventory in the counts reusable');
  assert.doesNotMatch(stripped, /--results/);
  assert.doesNotMatch(stripped, /inventoryCommand/);
});

// ---------------------------------------------------------------------------
// Self caller
// ---------------------------------------------------------------------------

test('counts-docs.yml is the thin self caller for the counts reusable', () => {
  const caller = read(CALLER);
  assert.match(caller, /^name: Counts docs$/m);
  assert.deepEqual(onTriggers(caller), ['pull_request', 'push', 'workflow_dispatch']);
  assert.match(caller, /push:\n {4}branches: \[main\]/);
  assert.equal(topLevelPermissions(caller), 'contents: read');
  assert.match(
    caller,
    /concurrency:\n {2}group: counts-docs-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true/,
  );

  const job = jobSections(caller).get('counts-docs');
  assert.ok(job, 'job counts-docs exists');
  assert.match(job, /^ {4}name: counts-docs$/m);
  assert.match(job, /uses: \.\/\.github\/workflows\/reusable-counts\.yml/);
  assert.deepEqual(jobWith(job), { 'tracker-ref': "''", 'config-path': 'tracker.config.json' });
  assert.equal(jobPermissions(job), 'contents: read');
  assert.doesNotMatch(stripComments(caller), /secrets/);
  assert.doesNotMatch(stripComments(caller), /pull_request_target/);
  assert.deepEqual(unpinnedUses(caller), []);
});

// ---------------------------------------------------------------------------
// Dispatch-only E2E plumbing fixture
// ---------------------------------------------------------------------------

test('e2e-fixture.yml is dispatch-only, internal, and delegates to the e2e reusable', () => {
  const fixture = read(FIXTURE);
  assert.match(fixture, /^name: E2E reusable fixture$/m);
  assert.deepEqual(onTriggers(fixture), ['workflow_dispatch']);
  assert.doesNotMatch(stripComments(fixture), /workflow_call/, 'internal runner must not be callable');
  assert.equal(topLevelPermissions(fixture), 'contents: read');

  const job = jobSections(fixture).get('e2e-fixture');
  assert.ok(job, 'job e2e-fixture exists');
  assert.match(job, /^ {4}name: e2e-fixture$/m);
  assert.match(job, /uses: \.\/\.github\/workflows\/reusable-e2e\.yml/);
  const values = jobWith(job);
  assert.equal(values.browsers, 'none');
  assert.equal(values['install-command'], 'none');
  assert.match(values['test-command'], /node -e/);
  assert.match(values['test-command'], /e2e fixture ok/);
  assert.equal(values['artifact-path'], "''");
  assert.equal(values['working-directory'], "'.'");
  assert.deepEqual(writePermissionLines(fixture), []);
  assert.deepEqual(unpinnedUses(fixture), []);
});

// ---------------------------------------------------------------------------
// Negative fixtures for the helpers
// ---------------------------------------------------------------------------

test('onTriggers detects forbidden triggers (negative fixture)', () => {
  assert.deepEqual(onTriggers('on:\n  pull_request_target:\n'), ['pull_request_target']);
  assert.deepEqual(onTriggers('on:\n  workflow_call:\n    inputs:\n      x:\n        type: string\n'), [
    'workflow_call',
  ]);
});

test('unpinnedUses detects floating refs (negative fixture)', () => {
  assert.deepEqual(unpinnedUses('steps:\n  - uses: actions/checkout@v4\n'), ['actions/checkout@v4']);
  assert.deepEqual(unpinnedUses(`steps:\n  - uses: actions/setup-node@${SETUP_NODE_SHA}\n`), []);
});

test('writePermissionLines flags write grants (negative fixture)', () => {
  assert.deepEqual(writePermissionLines('permissions:\n  contents: write'), ['contents: write']);
  assert.deepEqual(writePermissionLines('permissions:\n  contents: read'), []);
});

test('callInputs normalizes quoted defaults and tolerates missing blocks (negative fixture)', () => {
  assert.deepEqual(callInputs('on:\n    inputs:\n      x:\n        required: false\n        default: "a"\n'), {
    x: { required: 'false', default: 'a' },
  });
  assert.deepEqual(callInputs('name: no workflow_call'), {});
});
