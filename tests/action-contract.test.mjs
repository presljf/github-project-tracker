/* Contract tests for the setup-node-cache composite action and its reusable-workflow consumers.
 * Dependency-free: small YAML-subset helpers (regex + line scanning) instead of a YAML parser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ACTION = '.github/actions/setup-node-cache/action.yml';
const CI = '.github/workflows/reusable-ci.yml';
const DESKTOP = '.github/workflows/reusable-desktop-smoke.yml';
const ACTION_PATH = './.tracker-actions/.github/actions/setup-node-cache';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---------------------------------------------------------------------------
// Pure YAML-subset helpers (kept dependency-free; also exercised by negative fixtures)
// ---------------------------------------------------------------------------

/** Split a YAML document into `- name: ...` step blocks (composite actions and workflow jobs). */
function splitSteps(text) {
  const blocks = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
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

/** Names of `run:` steps that do not declare `shell: bash` (composite actions require it). */
function runStepsWithoutShell(text) {
  return splitSteps(text)
    .filter((step) => /^\s+run:/m.test(step.text) && !/^\s+shell:\s*bash\s*$/m.test(step.text))
    .map((step) => step.name);
}

/** Non-local `uses:` references that are not pinned to a full 40-hex commit SHA. */
function unpinnedUses(text) {
  const unpinned = [];
  for (const match of text.matchAll(/^\s*(?:- )?uses:\s*(\S+)\s*$/gm)) {
    const ref = match[1].replace(/^['"]|['"]$/g, '');
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    if (!/@[0-9a-f]{40}$/.test(ref)) unpinned.push(ref);
  }
  return unpinned;
}

/** Input names mapped to { required, default } from an `inputs:` block. */
function inputDefaults(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^inputs:\s*$/.test(line));
  const inputs = {};
  if (start < 0) return inputs;
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const name = /^ {2}([a-z0-9-]+):\s*$/.exec(line);
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

/** Top-level job name -> job YAML block. */
function jobSections(text) {
  const lines = text.split(/\r?\n/);
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

function stepText(text, name) {
  const step = splitSteps(text).find((item) => item.name === name);
  assert.ok(step, `step '${name}' exists`);
  return step.text;
}

// ---------------------------------------------------------------------------
// Composite action interface
// ---------------------------------------------------------------------------

test('setup-node-cache action is a composite action with the documented interface', () => {
  const action = read(ACTION);
  assert.match(action, /^name: Setup Node with dependency cache$/m);
  assert.match(action, /^description:/m);
  assert.match(action, /^runs:\n {2}using: composite$/m);

  const defaults = inputDefaults(action);
  assert.deepEqual(Object.keys(defaults).sort(), [
    'cache',
    'cache-dependency-path',
    'install-command',
    'install-dependencies',
    'node-version',
    'package-manager',
    'registry-url',
    'working-directory',
  ]);
  const expected = {
    'node-version': '22',
    'package-manager': 'npm',
    'working-directory': '.',
    cache: 'true',
    'install-dependencies': 'true',
    'registry-url': '',
    'cache-dependency-path': '',
    'install-command': '',
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(defaults[name].default, value, name);
  for (const name of Object.keys(expected)) assert.equal(defaults[name].required, 'false', name);

  assert.match(action, /^outputs:\n/m);
  assert.match(
    action,
    /node-version:\n {4}description:[\s\S]*?value: \$\{\{ steps\.resolve\.outputs\.node-version \}\}/,
  );
  assert.match(action, /cache-hit:\n {4}description:[\s\S]*?value: \$\{\{ steps\.setup\.outputs\.cache-hit \}\}/);
});

test('every composite run step declares shell: bash and nested uses are SHA-pinned', () => {
  const action = read(ACTION);
  assert.deepEqual(runStepsWithoutShell(action), []);
  const steps = splitSteps(action);
  assert.equal(steps.length, 3);
  assert.deepEqual(
    steps.map((step) => step.name),
    ['Validate and resolve setup inputs', 'Set up Node.js', 'Install dependencies'],
  );
  assert.deepEqual(unpinnedUses(action), []);
  assert.match(action, /uses: actions\/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7\.1\.0/);
  assert.match(action, /package-manager-cache: false/);
  assert.match(action, /cache: \$\{\{ steps\.resolve\.outputs\.cache \}\}/);
  assert.match(action, /cache-dependency-path: \$\{\{ steps\.resolve\.outputs\.cache-dependency-path \}\}/);
  assert.match(action, /registry-url: \$\{\{ inputs\.registry-url \}\}/);
});

test('action assumes no secrets and normalizes boolean inputs', () => {
  const action = read(ACTION);
  assert.doesNotMatch(action, /^secrets:/m);
  assert.doesNotMatch(action, /\$\{\{\s*secrets\./);
  assert.match(action, /normalize_bool\(\)/);
  assert.match(action, /true \| 1 \| yes/);
  assert.match(action, /false \| 0 \| no/);
  assert.match(action, /must be true or false/);
  assert.match(action, /package-manager must be npm, pnpm, or yarn/);
  assert.match(action, />>"\$GITHUB_OUTPUT"/);
});

// ---------------------------------------------------------------------------
// reusable-ci.yml consumer
// ---------------------------------------------------------------------------

test('reusable-ci.yml routes all Node setup through the action', () => {
  const ci = read(CI);
  assert.doesNotMatch(ci, /actions\/setup-node@/);
  assert.equal((ci.match(/uses: \.\/\.tracker-actions\/\.github\/actions\/setup-node-cache/g) ?? []).length, 5);
  assert.deepEqual(unpinnedUses(ci), []);

  const jobs = jobSections(ci);
  assert.deepEqual([...jobs.keys()], ['prepare', 'lint', 'format', 'test', 'build', 'summary']);
  for (const job of ['prepare', 'lint', 'format', 'test', 'build']) {
    const text = jobs.get(job);
    assert.equal((text.match(/uses: actions\/checkout@/g) ?? []).length, 2, `${job}: caller + tracker checkouts`);
    const tracker = stepText(text, 'Checkout tracker action source');
    assert.match(tracker, /repository: \$\{\{ job\.workflow_repository \}\}/);
    assert.match(tracker, /ref: \$\{\{ job\.workflow_sha \}\}/);
    assert.match(tracker, /path: \.tracker-actions/);
    assert.match(tracker, /persist-credentials: false/);
    assert.match(text, new RegExp(`uses: ${ACTION_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.ok(
      text.indexOf('Set up Node and dependencies') < text.indexOf(job === 'prepare' ? 'Detect lockfile' : 'Run '),
      job,
    );
  }

  const prepare = stepText(jobs.get('prepare'), 'Set up Node and dependencies');
  assert.match(prepare, /cache: 'false'/);
  assert.match(prepare, /install-dependencies: 'false'/);

  for (const job of ['lint', 'format', 'test', 'build']) {
    const setup = stepText(jobs.get(job), 'Set up Node and dependencies');
    assert.match(setup, /node-version: \$\{\{ inputs\.node-version \}\}/);
    assert.match(setup, /working-directory: \$\{\{ inputs\.working-directory \}\}/);
    assert.match(setup, /package-manager: npm/);
    assert.match(setup, /cache: \$\{\{ needs\.prepare\.outputs\.lockfileKind == 'npm' \}\}/);
    assert.match(setup, /cache-dependency-path: \$\{\{ needs\.prepare\.outputs\.lockfilePath \}\}/);
    assert.match(setup, /install-command: \$\{\{ needs\.prepare\.outputs\.installCommand \}\}/);
    assert.doesNotMatch(jobs.get(job), /name: Install dependencies/);
  }

  // The aggregate gate does not need Node and must stay untouched.
  assert.doesNotMatch(jobs.get('summary'), /setup-node-cache/);
  assert.match(jobs.get('summary'), /name: ci-gate/);
});

// ---------------------------------------------------------------------------
// reusable-desktop-smoke.yml consumer
// ---------------------------------------------------------------------------

test('reusable-desktop-smoke.yml routes Node setup and install through the action', () => {
  const desktop = read(DESKTOP);
  assert.doesNotMatch(desktop, /actions\/setup-node@/);
  assert.equal((desktop.match(/uses: \.\/\.tracker-actions\/\.github\/actions\/setup-node-cache/g) ?? []).length, 1);
  assert.deepEqual(unpinnedUses(desktop), []);

  const jobs = jobSections(desktop);
  assert.deepEqual([...jobs.keys()], ['desktop-smoke']);
  const text = jobs.get('desktop-smoke');
  assert.equal((text.match(/uses: actions\/checkout@/g) ?? []).length, 2);
  const tracker = stepText(text, 'Checkout tracker action source');
  assert.match(tracker, /repository: \$\{\{ job\.workflow_repository \}\}/);
  assert.match(tracker, /ref: \$\{\{ job\.workflow_sha \}\}/);
  assert.match(tracker, /path: \.tracker-actions/);
  assert.match(tracker, /persist-credentials: false/);

  const setup = stepText(text, 'Set up Node and dependencies');
  assert.match(setup, /node-version: \$\{\{ inputs\.node-version \}\}/);
  assert.match(setup, /working-directory: \$\{\{ inputs\.working-directory \}\}/);
  assert.match(setup, /cache: 'true'/);
  assert.match(setup, /install-dependencies: \$\{\{ inputs\.install-command != '' \}\}/);
  assert.match(setup, /install-command: \$\{\{ inputs\.install-command \}\}/);
  assert.ok(text.indexOf('Set up Node and dependencies') < text.indexOf('Run desktop smoke'));
  assert.doesNotMatch(text, /name: Install dependencies/);

  // Public reusable-workflow interface unchanged.
  assert.match(desktop, /smoke-command:/);
  assert.match(desktop, /outputs:\n {6}smoke-passed:/);
  assert.match(desktop, /permissions:\n {2}contents: read/);
});

// ---------------------------------------------------------------------------
// Negative fixtures for the pure helpers
// ---------------------------------------------------------------------------

test('runStepsWithoutShell detects a missing shell declaration (negative fixture)', () => {
  const missingShell = ['runs:', '  using: composite', '  steps:', '    - name: Bad step', '      run: echo hi'].join(
    '\n',
  );
  assert.deepEqual(runStepsWithoutShell(missingShell), ['Bad step']);

  const withShell = [
    'runs:',
    '  using: composite',
    '  steps:',
    '    - name: Good step',
    '      shell: bash',
    '      run: echo hi',
  ].join('\n');
  assert.deepEqual(runStepsWithoutShell(withShell), []);
});

test('unpinnedUses detects floating and branch refs (negative fixture)', () => {
  const floating = ['steps:', '  - uses: actions/checkout@v4', '  - uses: owner/repo/.github/actions/x'].join('\n');
  assert.deepEqual(unpinnedUses(floating), ['actions/checkout@v4', 'owner/repo/.github/actions/x']);

  const pinned = [
    'steps:',
    '  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    '  - uses: ./.tracker-actions/.github/actions/setup-node-cache',
  ].join('\n');
  assert.deepEqual(unpinnedUses(pinned), []);
});

test('inputDefaults reads defaults, missing inputs yield an empty map (negative fixture)', () => {
  const inline = [
    'inputs:',
    '  cache:',
    "    description: 'Cache toggle.'",
    '    required: false',
    "    default: 'true'",
    '  label:',
    '    description: No default.',
    '    required: true',
    'outputs:',
    '  x:',
    '    description: x',
  ].join('\n');
  const parsed = inputDefaults(inline);
  assert.deepEqual(parsed, {
    cache: { required: 'false', default: 'true' },
    label: { required: 'true', default: null },
  });
  assert.deepEqual(inputDefaults('name: no inputs here'), {});
});

test('jobSections and splitSteps do not leak sibling jobs or steps (negative fixture)', () => {
  const inline = [
    'jobs:',
    '  first:',
    '    name: first',
    '    steps:',
    '      - name: One',
    '        run: echo one',
    '  second:',
    '    name: second',
    '    steps:',
    '      - name: Two',
    '        shell: bash',
    '        run: echo two',
  ].join('\n');
  const jobs = jobSections(inline);
  assert.deepEqual([...jobs.keys()], ['first', 'second']);
  assert.deepEqual(
    splitSteps(jobs.get('first')).map((step) => step.name),
    ['One'],
  );
  assert.deepEqual(
    splitSteps(jobs.get('second')).map((step) => step.name),
    ['Two'],
  );
});
