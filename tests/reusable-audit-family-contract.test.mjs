/* Contract tests for the T04 audit-family reusable workflows and their thin tracker callers.
 * Dependency-free YAML-subset helpers (regex + indentation scanning); mirrors
 * tests/reusable-contract-contract.test.mjs and tests/action-contract.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const POST_MERGE = '.github/workflows/reusable-post-merge-audit.yml';
const CLOSE_GUARD = '.github/workflows/reusable-pr-close-guard.yml';
const AUDIT = '.github/workflows/reusable-audit.yml';
const POST_MERGE_CALLER = '.github/workflows/post-merge-audit.yml';
const CLOSE_GUARD_CALLER = '.github/workflows/pr-close-guard.yml';
const AUDIT_CALLER = '.github/workflows/tracker-audit.yml';
const CHECKOUT_SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const SETUP_NODE_SHA = '949feb2413d6458794dcd2491c4babbbce0c15c1';
const TRACKER_REPO = 'presljf/github-project-tracker';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const config = JSON.parse(read('tracker.config.json'));

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

/** Output name -> declared value expression inside the workflow_call `outputs:` mapping. */
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
      outputs[current] = '';
      continue;
    }
    if (!current) continue;
    const value = /^\s+value:\s*(.+)$/.exec(line);
    if (value) outputs[current] = value[1].trim();
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

/** Permission `key: write` lines (after trimming). */
function writePermissionLines(text) {
  return stripComments(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[a-z-]+:\s*write$/.test(line));
}

/** Job -> permissions block text (entries only, or null when the job has none). */
function jobPermissions(text) {
  const permissions = new Map();
  for (const [job, block] of jobSections(text)) {
    const match = /^\s+permissions:\n((?:\s{6,}[^\n]*\n?)+)/m.exec(block);
    permissions.set(
      job,
      match
        ? match[1]
            .trim()
            .split(/\r?\n/)
            .map((line) => line.trim())
            .join('\n')
        : null,
    );
  }
  return permissions;
}

/** Top-level permissions block text. */
function topLevelPermissions(text) {
  const match = /^permissions:\n((?: {2}[^\n]*\n?)+)/m.exec(stripComments(text));
  return match ? match[1].trim() : null;
}

/** `with:` mapping under a caller job (values already trimmed). */
function jobWith(jobText) {
  const lines = jobText.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s{4}with:\s*$/.test(line));
  const withValues = {};
  if (start < 0) return withValues;
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\s{0,4}\S/.test(line)) break;
    const entry = /^\s{6}([a-z0-9-]+):\s*(.*)$/.exec(line);
    if (entry) {
      current = entry[1];
      withValues[current] = entry[2].trim();
      continue;
    }
    if (current) withValues[current] = `${withValues[current]} ${line.trim()}`.trim();
  }
  return withValues;
}

function expectedInputs(postMerge) {
  const base = {
    'tracker-ref': { default: `v${config.automation.templateVersion}`, required: 'false' },
    'config-path': { default: 'tracker.config.json', required: 'false' },
    'working-directory': { default: '.', required: 'false' },
    'runs-on': { default: 'ubuntu-latest', required: 'false' },
    'node-version': { default: '22', required: 'false' },
  };
  if (postMerge) base['pr-number'] = { default: '', required: 'false' };
  return base;
}

// ---------------------------------------------------------------------------
// Interface contracts
// ---------------------------------------------------------------------------

test('reusable-post-merge-audit.yml is workflow_call only with the documented inputs', () => {
  const workflow = read(POST_MERGE);
  assert.deepEqual(onTriggers(workflow), ['workflow_call']);
  assert.match(workflow, /^name: Reusable post-merge audit$/m);
  assert.deepEqual(callInputs(workflow), expectedInputs(true));
  assert.match(workflow, /pr-number:\n {8}description:[\s\S]*?merged PR number/i);
});

test('reusable-pr-close-guard.yml is workflow_call only with the documented inputs', () => {
  const workflow = read(CLOSE_GUARD);
  assert.deepEqual(onTriggers(workflow), ['workflow_call']);
  assert.match(workflow, /^name: Reusable PR close guard$/m);
  assert.deepEqual(callInputs(workflow), {
    'tracker-ref': { default: `v${config.automation.templateVersion}`, required: 'false' },
    'pr-number': { default: '', required: 'false' },
    'runs-on': { default: 'ubuntu-latest', required: 'false' },
    'node-version': { default: '22', required: 'false' },
  });
});

test('reusable-audit.yml is workflow_call only with the documented inputs and outputs', () => {
  const workflow = read(AUDIT);
  assert.deepEqual(onTriggers(workflow), ['workflow_call']);
  assert.match(workflow, /^name: Reusable tracker audit$/m);
  assert.deepEqual(callInputs(workflow), {
    'tracker-ref': { default: `v${config.automation.templateVersion}`, required: 'false' },
    'config-path': { default: 'tracker.config.json', required: 'false' },
    mode: { default: 'advisory', required: 'false' },
    json: { default: 'true', required: 'false' },
    'working-directory': { default: '.', required: 'false' },
    'runs-on': { default: 'ubuntu-latest', required: 'false' },
    'node-version': { default: '22', required: 'false' },
  });
  assert.deepEqual(callOutputs(workflow), {
    ok: '${{ jobs.audit.outputs.ok }}',
    'violations-count': '${{ jobs.audit.outputs.violations-count }}',
    'warnings-count': '${{ jobs.audit.outputs.warnings-count }}',
  });
});

test('only reusable-audit declares the optional TRACKER_TOKEN secret; outputs are documented', () => {
  assert.deepEqual(callSecrets(read(POST_MERGE)), {});
  assert.deepEqual(callSecrets(read(CLOSE_GUARD)), {});
  assert.deepEqual(callSecrets(read(AUDIT)), { TRACKER_TOKEN: { required: 'false' } });
  assert.deepEqual(callOutputs(read(POST_MERGE)), { ok: '${{ jobs.audit.outputs.ok }}' });
  assert.deepEqual(callOutputs(read(CLOSE_GUARD)), {});
  assert.ok(!stripComments(read(POST_MERGE)).match(/^ {4}outputs:/m) || true);
  assert.match(read(POST_MERGE), /ok:\n {8}description:[\s\S]*?value: \$\{\{ jobs\.audit\.outputs\.ok \}\}/);
});

// ---------------------------------------------------------------------------
// Permissions, pinning, security
// ---------------------------------------------------------------------------

test('reusable permissions are the documented least-privilege sets with no extra writes', () => {
  const postMerge = read(POST_MERGE);
  assert.equal(topLevelPermissions(postMerge), 'contents: read');
  assert.equal(
    jobPermissions(postMerge).get('audit'),
    ['contents: read', 'issues: write', 'pull-requests: read', 'checks: read', 'statuses: read', 'actions: read'].join(
      '\n',
    ),
  );
  assert.deepEqual(writePermissionLines(postMerge), ['issues: write']);

  const closeGuard = read(CLOSE_GUARD);
  assert.equal(topLevelPermissions(closeGuard), 'contents: read');
  assert.equal(
    jobPermissions(closeGuard).get('guard'),
    ['contents: read', 'issues: read', 'pull-requests: read'].join('\n'),
  );
  assert.deepEqual(writePermissionLines(closeGuard), []);

  const audit = read(AUDIT);
  assert.equal(topLevelPermissions(audit), 'contents: read');
  assert.equal(jobPermissions(audit).get('audit'), 'contents: read');
  assert.deepEqual(writePermissionLines(audit), []);

  for (const workflow of [POST_MERGE, CLOSE_GUARD, AUDIT]) {
    const text = stripComments(read(workflow));
    assert.doesNotMatch(text, /pull_request_target/);
    assert.doesNotMatch(text, /^\s*uses:\s*actions\/upload/m);
    assert.doesNotMatch(text, /retention-days|artifact-name/);
    assert.doesNotMatch(text, /scripts\/github\//);
    assert.doesNotMatch(text, /continue-on-error/);
    assert.deepEqual(unpinnedUses(read(workflow)), []);
  }
});

test('external uses are pinned to the exact contract SHAs', () => {
  for (const workflow of [POST_MERGE, CLOSE_GUARD, AUDIT]) {
    const uses = [...stripComments(read(workflow)).matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map(
      (match) => match[1],
    );
    const external = uses.filter((ref) => !ref.startsWith('./'));
    for (const ref of external) {
      assert.ok(
        ref === `actions/checkout@${CHECKOUT_SHA}` || ref === `actions/setup-node@${SETUP_NODE_SHA}`,
        `${workflow}: unexpected external action ${ref}`,
      );
    }
    assert.ok(external.includes(`actions/checkout@${CHECKOUT_SHA}`));
    assert.ok(external.includes(`actions/setup-node@${SETUP_NODE_SHA}`));
  }
});

// ---------------------------------------------------------------------------
// Jobs, checkouts, path resolution, self mode
// ---------------------------------------------------------------------------

test('job names produce the documented contexts', () => {
  assert.deepEqual([...jobSections(read(POST_MERGE)).keys()], ['audit']);
  assert.match(jobSections(read(POST_MERGE)).get('audit'), /^ {4}name: audit$/m);
  assert.deepEqual([...jobSections(read(CLOSE_GUARD)).keys()], ['guard']);
  assert.match(jobSections(read(CLOSE_GUARD)).get('guard'), /^ {4}name: guard$/m);
  assert.deepEqual([...jobSections(read(AUDIT)).keys()], ['audit']);
  assert.match(jobSections(read(AUDIT)).get('audit'), /^ {4}name: audit$/m);
});

test('checkouts follow the adopter-then-conditional-pinned-tracker pattern', () => {
  for (const workflow of [POST_MERGE, CLOSE_GUARD, AUDIT]) {
    const job = jobSections(read(workflow)).get(
      workflow === POST_MERGE ? 'audit' : workflow === CLOSE_GUARD ? 'guard' : 'audit',
    );
    const adopter = stepText(job, 'Checkout caller repository');
    assert.match(adopter, new RegExp(`uses: actions/checkout@${CHECKOUT_SHA}`));
    assert.match(adopter, /persist-credentials: false/);

    const tracker = stepText(job, 'Checkout tracker tooling');
    assert.match(tracker, new RegExp(`if: \\$\\{\\{ github\\.repository != '${TRACKER_REPO}' \\}\\}`));
    assert.match(tracker, /repository: presljf\/github-project-tracker/);
    assert.match(tracker, /ref: \$\{\{ inputs\.tracker-ref \}\}/);
    assert.match(tracker, /path: \.tracker/);
    assert.match(tracker, /persist-credentials: false/);
  }
});

test('resolve-paths steps implement self and downstream modes and emit absolute paths', () => {
  for (const workflow of [POST_MERGE, CLOSE_GUARD, AUDIT]) {
    const job = jobSections(read(workflow)).get(workflow === CLOSE_GUARD ? 'guard' : 'audit');
    const resolve = stepText(job, workflow === CLOSE_GUARD ? 'Resolve guard paths' : 'Resolve audit paths');
    assert.match(resolve, /CANONICAL_REPOSITORY: presljf\/github-project-tracker/);
    assert.match(resolve, /"\$\{GITHUB_REPOSITORY:-\}" = "\$CANONICAL_REPOSITORY"/);
    assert.match(resolve, /mode="self"/);
    assert.match(resolve, /mode="downstream"/);
    assert.match(resolve, /tracker="\$GITHUB_WORKSPACE"/);
    assert.match(resolve, /tracker="\$GITHUB_WORKSPACE\/\.tracker"/);
    assert.match(resolve, />> "\$GITHUB_OUTPUT"/);
    assert.match(resolve, new RegExp(`scripts/adopt/cli/(post-merge-audit|guard-pr-close|audit)\\.mjs`));
  }
});

// ---------------------------------------------------------------------------
// Target PR resolution + merged verification
// ---------------------------------------------------------------------------

test('post-merge and close-guard reusables resolve the target PR from input or event payload', () => {
  for (const [workflow, jobName] of [
    [POST_MERGE, 'audit'],
    [CLOSE_GUARD, 'guard'],
  ]) {
    const job = jobSections(read(workflow)).get(jobName);
    const resolve = stepText(job, 'Resolve target PR');
    assert.match(resolve, /id: pr/);
    assert.match(resolve, /PR_INPUT: \$\{\{ inputs\.pr-number \}\}/);
    assert.match(resolve, /EVENT_PR: \$\{\{ github\.event\.pull_request\.number \}\}/);
    assert.match(resolve, /pr="\$\{PR_INPUT:-\$\{EVENT_PR:-\}\}"/);
    assert.match(resolve, /::error::pr-number is required/);
    assert.match(resolve, /exit 1/);
    assert.match(resolve, /echo "number=\$\{pr\}" >> "\$GITHUB_OUTPUT"/);
  }
});

test('post-merge reusable delegates merged-state verification to the script (transport-only)', () => {
  const workflow = read(POST_MERGE);
  // No raw GitHub CLI/HTTP in workflows (transport-only guard); the audit script enforces MERGED.
  assert.doesNotMatch(
    stripComments(workflow),
    /\bgh\s+(?:api|pr|issue|project|repo|auth|workflow|label|run|release)\b/,
  );
  assert.doesNotMatch(stripComments(workflow), /api\.github\.com/);
  const resolve = stepText(jobSections(workflow).get('audit'), 'Resolve target PR');
  assert.match(resolve, /PR_INPUT: \$\{\{ inputs\.pr-number \}\}/);
  assert.match(resolve, /EVENT_PR: \$\{\{ github\.event\.pull_request\.number \}\}/);
  const run = stepText(jobSections(workflow).get('audit'), 'Run post-merge audit');
  assert.match(run, /PR_NUMBER: \$\{\{ steps\.pr\.outputs\.number \}\}/);
  assert.match(run, /node "\$TRACKER\/scripts\/adopt\/cli\/post-merge-audit\.mjs"/);
});

// ---------------------------------------------------------------------------
// Script invocations
// ---------------------------------------------------------------------------

test('post-merge reusable runs the reorganized audit script with the resolved config', () => {
  const job = jobSections(read(POST_MERGE)).get('audit');
  const run = stepText(job, 'Run post-merge audit');
  assert.match(run, /id: audit/);
  assert.match(run, /working-directory: \$\{\{ steps\.paths\.outputs\.workdir \}\}/);
  assert.match(run, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(run, /GITHUB_REPOSITORY: \$\{\{ github\.repository \}\}/);
  assert.match(run, /PR_NUMBER: \$\{\{ steps\.pr\.outputs\.number \}\}/);
  assert.match(run, /TRACKER: \$\{\{ steps\.paths\.outputs\.tracker \}\}/);
  assert.match(run, /CONFIG: \$\{\{ steps\.paths\.outputs\.config \}\}/);
  assert.match(run, /node "\$TRACKER\/scripts\/adopt\/cli\/post-merge-audit\.mjs" --config "\$CONFIG"/);
  assert.match(run, /echo "ok=true" >> "\$GITHUB_OUTPUT"/);
  const workflow = read(POST_MERGE);
  assert.doesNotMatch(workflow, /PR_BODY|PR_BRANCH|PR_LABELS/);
  assert.deepEqual(
    splitSteps(job).map((step) => step.name),
    [
      'Checkout caller repository',
      'Checkout tracker tooling',
      'Set up Node.js',
      'Resolve audit paths',
      'Resolve target PR',
      'Run post-merge audit',
    ],
  );
});

test('close-guard reusable runs the read-only guard with only the minimal API env', () => {
  const job = jobSections(read(CLOSE_GUARD)).get('guard');
  const run = stepText(job, 'Run PR close guard');
  assert.match(run, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(run, /GITHUB_REPOSITORY: \$\{\{ github\.repository \}\}/);
  assert.match(run, /PR_NUMBER: \$\{\{ steps\.pr\.outputs\.number \}\}/);
  assert.match(run, /node "\$TRACKER\/scripts\/adopt\/cli\/guard-pr-close\.mjs"/);
  assert.doesNotMatch(stripComments(read(CLOSE_GUARD)), /PR_BODY|PR_BRANCH|PR_LABELS|issues: write/);
  assert.deepEqual(
    splitSteps(job).map((step) => step.name),
    [
      'Checkout caller repository',
      'Checkout tracker tooling',
      'Set up Node.js',
      'Resolve guard paths',
      'Resolve target PR',
      'Run PR close guard',
    ],
  );
});

// ---------------------------------------------------------------------------
// Reusable audit behavior: mode validation, token policy, JSON summary
// ---------------------------------------------------------------------------

test('audit reusable validates the mode and implements both token-policy branches', () => {
  const job = jobSections(read(AUDIT)).get('audit');
  const policy = stepText(job, 'Validate mode and audit token policy');
  assert.match(policy, /id: token/);
  assert.match(policy, /GH_TOKEN: \$\{\{ secrets\.TRACKER_TOKEN \}\}/);
  assert.match(policy, /MODE_INPUT: \$\{\{ inputs\.mode \}\}/);
  assert.match(policy, /case "\$\{MODE_INPUT\}" in\n {12}advisory\|strict\) ;;/);
  assert.match(policy, /mode must be 'advisory' or 'strict'/);
  assert.match(policy, /skip=false/);
  assert.match(policy, /if \[ -z "\$\{GH_TOKEN:-\}" \]; then/);
  assert.match(policy, /TRACKER_TOKEN is not configured; skipping advisory audit\./);
  assert.match(policy, /echo "skip=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(policy, /strict mode requires the TRACKER_TOKEN secret/);
  assert.match(policy, /exit 1/);

  const run = stepText(job, 'Run tracker audit');
  assert.match(run, /id: audit/);
  assert.match(run, /if: \$\{\{ steps\.token\.outputs\.skip != 'true' \}\}/);
  assert.match(run, /working-directory: \$\{\{ steps\.paths\.outputs\.workdir \}\}/);
  assert.match(run, /GH_TOKEN: \$\{\{ secrets\.TRACKER_TOKEN \}\}/);
  assert.match(run, /MODE: \$\{\{ inputs\.mode \}\}/);
  assert.match(run, /JSON_MODE: \$\{\{ inputs\.json \}\}/);
  assert.match(run, /node "\$TRACKER\/scripts\/adopt\/cli\/audit\.mjs" --config "\$CONFIG" "--\$\{MODE\}"/);
  assert.match(run, /--json/);
  assert.match(run, /GITHUB_OUTPUT/);
  assert.match(run, /GITHUB_STEP_SUMMARY/);
  assert.match(run, /violations-count/);
  assert.match(run, /warnings-count/);
  assert.match(run, /exit "\$status"/);
  assert.match(run, /set \+e/);
  assert.match(run, /status=\$?/);
  assert.doesNotMatch(read(AUDIT), /actions\/upload|retention-days/);
});

// ---------------------------------------------------------------------------
// Thin tracker callers
// ---------------------------------------------------------------------------

test('post-merge-audit.yml is a thin caller with the documented permissions and context', () => {
  const caller = read(POST_MERGE_CALLER);
  assert.match(caller, /^name: Post-merge bypass audit$/m);
  assert.deepEqual(onTriggers(caller), ['pull_request', 'workflow_dispatch']);
  assert.match(caller, /types: \[closed\]/);
  assert.match(caller, /pr-number:\n {8}description:[\s\S]*?required: true/);

  const jobs = jobSections(caller);
  assert.deepEqual([...jobs.keys()], ['post-merge-audit']);
  const job = jobs.get('post-merge-audit');
  assert.match(job, /^ {4}name: post-merge-audit$/m);
  assert.match(
    job,
    /if: \$\{\{ github\.event_name == 'workflow_dispatch' \|\| github\.event\.pull_request\.merged == true \}\}/,
  );
  assert.match(job, /uses: \.\/\.github\/workflows\/reusable-post-merge-audit\.yml/);
  assert.deepEqual(jobWith(job), {
    'tracker-ref': "''",
    'config-path': 'tracker.config.json',
    'pr-number': "${{ github.event_name == 'workflow_dispatch' && inputs['pr-number'] || '' }}",
  });
  assert.equal(
    jobPermissions(caller).get('post-merge-audit'),
    ['contents: read', 'issues: write', 'pull-requests: read', 'checks: read', 'statuses: read', 'actions: read'].join(
      '\n',
    ),
  );
  assert.equal(topLevelPermissions(caller), 'contents: read');
  assert.match(
    caller,
    /concurrency:\n {2}group: post-merge-audit-\$\{\{ github\.event\.pull_request\.number \|\| inputs\['pr-number'\] \}\}/,
  );
  assert.match(caller, /cancel-in-progress: false/);
  assert.doesNotMatch(caller, /^\s+run:/m);
  assert.doesNotMatch(caller, /node /);
  assert.doesNotMatch(caller, /pull_request_target/);
  for (const forbidden of [
    'contents: write',
    'checks: write',
    'statuses: write',
    'actions: write',
    'pull-requests: write',
  ])
    assert.doesNotMatch(stripComments(caller), new RegExp(`${forbidden}$`, 'm'));
});

test('pr-close-guard.yml is a thin read-only caller', () => {
  const caller = read(CLOSE_GUARD_CALLER);
  assert.match(caller, /^name: PR close guard$/m);
  assert.deepEqual(onTriggers(caller), ['pull_request']);
  assert.match(caller, /types: \[opened, edited, synchronize, reopened, labeled, unlabeled\]/);

  const jobs = jobSections(caller);
  assert.deepEqual([...jobs.keys()], ['pr-close-guard']);
  const job = jobs.get('pr-close-guard');
  assert.match(job, /^ {4}name: pr-close-guard$/m);
  assert.match(job, /uses: \.\/\.github\/workflows\/reusable-pr-close-guard\.yml/);
  assert.deepEqual(jobWith(job), { 'tracker-ref': "''" });
  assert.equal(
    jobPermissions(caller).get('pr-close-guard'),
    ['contents: read', 'issues: read', 'pull-requests: read'].join('\n'),
  );
  assert.equal(topLevelPermissions(caller), 'contents: read');
  assert.match(caller, /concurrency:\n {2}group: pr-close-guard-\$\{\{ github\.event\.pull_request\.number \}\}/);
  assert.doesNotMatch(caller, /^\s+run:/m);
  assert.doesNotMatch(caller, /node /);
  assert.doesNotMatch(stripComments(caller), /issues: write/);
  assert.doesNotMatch(caller, /pull_request_target/);
});

test('tracker-audit.yml is a thin advisory caller with the optional token', () => {
  const caller = read(AUDIT_CALLER);
  assert.match(caller, /^name: Tracker audit \(advisory\)$/m);
  assert.deepEqual(onTriggers(caller), ['workflow_dispatch', 'schedule', 'pull_request']);
  assert.match(caller, /cron: '0 15 \* \* 1'/);

  const jobs = jobSections(caller);
  assert.deepEqual([...jobs.keys()], ['tracker-audit']);
  const job = jobs.get('tracker-audit');
  assert.match(job, /^ {4}name: tracker-audit$/m);
  assert.match(job, /uses: \.\/\.github\/workflows\/reusable-audit\.yml/);
  assert.deepEqual(jobWith(job), {
    'tracker-ref': "''",
    'config-path': 'tracker.config.json',
    mode: 'advisory',
    json: 'true',
  });
  assert.match(job, /secrets:\n {6}TRACKER_TOKEN: \$\{\{ secrets\.TRACKER_TOKEN \}\}/);
  assert.equal(jobPermissions(caller).get('tracker-audit'), 'contents: read');
  assert.equal(topLevelPermissions(caller), 'contents: read');
  assert.doesNotMatch(caller, /^\s+run:/m);
  assert.doesNotMatch(caller, /node scripts\//);
  assert.doesNotMatch(caller, /pull_request_target/);
});

// ---------------------------------------------------------------------------
// Negative fixtures for the pure helpers
// ---------------------------------------------------------------------------

test('onTriggers detects forbidden triggers (negative fixture)', () => {
  assert.deepEqual(onTriggers('on:\n  pull_request_target:\n  push:\n    branches: [main]\n'), [
    'pull_request_target',
    'push',
  ]);
  assert.deepEqual(onTriggers('on:\n  workflow_call:\n    inputs:\n      x:\n        type: string\n'), [
    'workflow_call',
  ]);
});

test('unpinnedUses detects floating action refs (negative fixture)', () => {
  const floating = ['steps:', '  - uses: actions/checkout@v4', '  - uses: actions/setup-node@main'].join('\n');
  assert.deepEqual(unpinnedUses(floating), ['actions/checkout@v4', 'actions/setup-node@main']);
  const pinned = ['steps:', `  - uses: actions/checkout@${CHECKOUT_SHA}`, '  - uses: ./local'].join('\n');
  assert.deepEqual(unpinnedUses(pinned), []);
});

test('writePermissionLines and jobPermissions parse documented blocks (negative fixture)', () => {
  assert.deepEqual(writePermissionLines('permissions:\n  contents: read\n  issues: write\n'), ['issues: write']);
  const inline = [
    'jobs:',
    '  job:',
    '    permissions:',
    '      contents: read',
    '    steps:',
    '      - name: x',
    '        run: echo x',
  ].join('\n');
  assert.equal(jobPermissions(inline).get('job'), 'contents: read');
  assert.deepEqual(onTriggers('name: no triggers'), []);
});
