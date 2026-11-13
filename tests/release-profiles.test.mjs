/* eslint-disable no-regex-spaces */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
  return existsSync(join(ROOT, relativePath));
}

const REUSABLE = '.github/workflows/reusable-release.yml';
const CALLERS = [
  '.github/workflows/release.yml',
  'profiles/release/reusable/release-macos.yml',
  'profiles/release/reusable/release-container.yml',
  'profiles/release/reusable/release-package.yml',
];
const COPY_EXAMPLES = [
  'profiles/release/copy/generic-release.yml',
  'profiles/release/copy/macos-release.yml',
  'profiles/release/copy/container-release.yml',
  'profiles/release/copy/package-release.yml',
];
const NEW_FILES = [
  REUSABLE,
  ...CALLERS,
  '.github/actions/checksum/action.yml',
  '.github/actions/sign-notarize-macos/action.yml',
  'docs/RELEASE_PROFILES.md',
  'profiles/release/README.md',
  ...COPY_EXAMPLES,
  'tests/release-profiles.test.mjs',
];

function workflowTriggerSection(text) {
  const start = text.indexOf('\non:');
  assert.ok(start >= 0, 'workflow has an on: block');
  const end = text.indexOf('\npermissions:', start);
  assert.ok(end > start, 'workflow has a permissions block after on:');
  return text.slice(start, end);
}

function assertNoPrTrigger(relativePath) {
  const text = read(relativePath);
  const trigger = workflowTriggerSection(text);
  assert.ok(
    !/^\s{2}pull_request(_target)?:/m.test(trigger),
    `${relativePath} must not be triggered by pull_request/pull_request_target`,
  );
}

// ---------------------------------------------------------------------------
// Reusable release workflow contract
// ---------------------------------------------------------------------------
test('reusable release workflow exists and is workflow_call only', () => {
  assert.ok(exists(REUSABLE));
  const text = read(REUSABLE);
  const trigger = workflowTriggerSection(text);
  assert.match(trigger, /^on:\n  workflow_call:/m);
  assert.doesNotMatch(trigger, /^\s{2}(push|pull_request|schedule|workflow_dispatch):/m);
});

test('reusable release workflow exposes the documented core inputs', () => {
  const text = read(REUSABLE);
  const call = text.slice(text.indexOf('workflow_call:'), text.indexOf('permissions: {}'));
  for (const input of [
    'profile:',
    'version:',
    'tag-pattern:',
    'dry-run:',
    'publish:',
    'artifact-globs:',
    'checksum-algorithm:',
    'build-command:',
    'working-directory:',
    'artifact-name:',
    'retention-days:',
    'draft:',
    'prerelease:',
  ]) {
    assert.ok(call.includes(input), `reusable workflow declares input ${input}`);
  }
  assert.match(call, /dry-run:[\s\S]*?default: true/, 'dry-run defaults to true');
  assert.match(call, /publish:[\s\S]*?default: false/, 'publish defaults to false');
  assert.match(call, /draft:[\s\S]*?default: true/, 'draft defaults to true');
  assert.match(call, /tag-pattern:[\s\S]*?default: '\^v\[0-9\]\+/, 'tag pattern default is the vX.Y.Z ERE');
});

test('reusable release workflow exposes outputs and optional secrets', () => {
  const text = read(REUSABLE);
  for (const output of ['version:', 'artifacts:', 'checksums-file:', 'release-url:', 'dry-run:']) {
    assert.ok(text.includes(output), `reusable workflow declares output ${output}`);
  }
  for (const secret of [
    'RELEASE_TOKEN:',
    'MACOS_CERT_P12:',
    'MACOS_CERT_PASSWORD:',
    'APPLE_ID:',
    'APPLE_APP_PASSWORD:',
    'NPM_TOKEN:',
    'PYPI_API_TOKEN:',
  ]) {
    assert.ok(text.includes(secret), `reusable workflow declares optional secret ${secret}`);
  }
  const secretsBlock = text.slice(text.indexOf('secrets:'), text.indexOf('\n\npermissions: {}'));
  assert.ok(!/required: true/.test(secretsBlock), 'no secret is required (dry-runs must work without them)');
});

test('reusable release workflow enforces the publish guards', () => {
  const text = read(REUSABLE);
  assert.match(text, /^permissions: \{\}$/m, 'workflow-level permissions start empty (least privilege)');
  assert.ok(
    (text.match(/environment: release/g) || []).length >= 3,
    'publish/sign jobs declare the release environment',
  );
  for (const phrase of [
    'publish: true requires a release tag ref',
    'publish: true with dry-run: true is contradictory',
    'does not match tag-pattern',
    'does not match resolved version tag',
    'Publishing is never allowed from pull_request events',
    'already exists. Releases are immutable by policy',
    'Refusing to overwrite an existing',
    'No files matched artifact-globs',
  ]) {
    assert.ok(text.includes(phrase), `reusable workflow contains guard: ${phrase}`);
  }
  // The publish gate is `tag match && publish && !dry-run`.
  assert.match(text, /if \[\[ "\$publish" == "true" && "\$dry_run" == "false" && "\$tag_matches" == "true" \]\]/);
  assert.ok(!/\n\s+if:\s*\$\{\{\s*github\.event_name\s*==\s*'pull_request'/.test(text));
});

test('reusable release workflow covers all four profiles', () => {
  const text = read(REUSABLE);
  for (const marker of [
    'generic|github-release',
    'macos|desktop|macos-app-github-release',
    'container|ghcr|image',
    'package|npm|pypi|npm-pypi|packages',
    'publish-github-release',
    'publish-container',
    'publish-package',
    'sign-macos',
    'checksum',
  ]) {
    assert.ok(text.includes(marker), `reusable workflow implements profile marker: ${marker}`);
  }
});

test('reusable release workflow pins third-party actions by commit SHA', () => {
  const text = read(REUSABLE);
  const uses = [...text.matchAll(/^\s+uses:\s+(\S+)/gm)].map((match) => match[1]);
  assert.ok(uses.length >= 4, 'workflow uses several actions');
  for (const ref of uses) {
    if (ref.startsWith('./')) continue;
    assert.match(ref, /@[0-9a-f]{40}$/, `third-party action must be pinned by full SHA (got ${ref})`);
  }
  assert.ok(!/@main\b/.test(text));
});

// ---------------------------------------------------------------------------
// Thin callers
// ---------------------------------------------------------------------------
test('generic caller triggers on release tags and dispatch with dry-run default', () => {
  assert.ok(exists(CALLERS[0]));
  const text = read(CALLERS[0]);
  const trigger = workflowTriggerSection(text);
  assert.match(trigger, /^  push:\n    tags:\n      - 'v\*'/m);
  assert.match(trigger, /^  workflow_dispatch:/m);
  assert.match(trigger, /dry-run:[\s\S]*?default: true/);
  assert.match(trigger, /publish:[\s\S]*?default: false/);
  assert.match(text, /uses: \.\/\.github\/workflows\/reusable-release\.yml/);
  assert.match(text, /profile: generic/);
  assert.match(text, /dry-run: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.dry-run \|\| false \}\}/);
  assert.match(text, /publish: \$\{\{ github\.event_name == 'push' \|\| inputs\.publish \}\}/);
  assertNoPrTrigger(CALLERS[0]);
  assertCallerPermissionUnion(CALLERS[0]);
});

const CALLER_PERMISSION_UNION = ['contents: write', 'packages: write', 'id-token: write'];

function assertCallerPermissionUnion(file) {
  const text = read(file);
  for (const permission of CALLER_PERMISSION_UNION) {
    assert.ok(
      text.includes(permission),
      `${file} must grant the reusable-workflow permission union (missing ${permission}); subsets cause startup_failure (T02 live finding)`,
    );
  }
}

test('profile example callers are dispatch-only, dry-run by default, correctly profiled', () => {
  const expectations = [
    ['profiles/release/reusable/release-macos.yml', 'macos'],
    ['profiles/release/reusable/release-container.yml', 'container'],
    ['profiles/release/reusable/release-package.yml', 'package'],
  ];
  for (const [file, profile] of expectations) {
    const text = read(file);
    const trigger = workflowTriggerSection(text);
    assert.match(trigger, /^  workflow_dispatch:/m, `${file} is dispatchable`);
    assert.doesNotMatch(trigger, /^\s{2}push:/m, `${file} has no push trigger yet (example)`);
    assert.match(trigger, /dry-run:[\s\S]*?default: true/, `${file} dry-run defaults true`);
    assert.match(trigger, /publish:[\s\S]*?default: false/, `${file} publish defaults false`);
    assert.match(text, new RegExp(`profile: ${profile}`), `${file} uses profile ${profile}`);
    assert.match(
      text,
      /uses: presljf\/github-project-tracker\/\.github\/workflows\/reusable-release\.yml@v\d+\.\d+\.\d+/,
      `${file} calls the pinned reusable workflow (copy examples must pin the adopted tag)`,
    );
    assertNoPrTrigger(file);
    assertCallerPermissionUnion(file);
  }
  const container = read('profiles/release/reusable/release-container.yml');
  assert.match(container, /packages: write/);
  const pkg = read('profiles/release/reusable/release-package.yml');
  assert.match(pkg, /id-token: write/);
  const macos = read('profiles/release/reusable/release-macos.yml');
  assert.match(macos, /MACOS_CERT_P12/);
  assert.match(macos, /APPLE_APP_PASSWORD/);
  // The callers' build commands must stay runnable placeholders (T02 fixed the unversioned-package case).
  assert.match(pkg, /project-tracker-os/, 'package caller stages a versioned placeholder package');
});

// ---------------------------------------------------------------------------
// Composite actions
// ---------------------------------------------------------------------------
function compositeSteps(text) {
  const blocks = text.split(/^ {4}- /m).slice(1);
  return blocks;
}

test('checksum composite action matches the catalog interface', () => {
  const file = '.github/actions/checksum/action.yml';
  assert.ok(exists(file));
  const text = read(file);
  assert.match(text, /using: composite/);
  assert.ok(text.includes('working-directory:'));
  assert.ok(text.includes('digest-count:'));
  for (const input of ['paths:', 'algorithm:', 'output-file:', 'working-directory:']) {
    assert.ok(text.includes(input), `checksum action input ${input}`);
  }
  for (const behavior of [
    'sha256sum',
    'shasum -a 256',
    'LC_ALL=C sort',
    'Refusing to overwrite',
    'No files matched',
    ' -c "$output_file"',
    '::group::',
    'checksums-file=',
  ]) {
    assert.ok(text.includes(behavior), `checksum action implements: ${behavior}`);
  }
  for (const block of compositeSteps(text)) {
    assert.match(block, /shell: bash/, 'every checksum action run step uses bash');
  }
});

test('sign-notarize-macos composite action matches the catalog interface', () => {
  const file = '.github/actions/sign-notarize-macos/action.yml';
  assert.ok(exists(file));
  const text = read(file);
  for (const needle of [
    'artifact-path:',
    'signing-identity:',
    'team-id:',
    'notarize:',
    'dry-run:',
    'keychain-profile:',
    'certificate-p12:',
    'certificate-password:',
    'apple-id:',
    'apple-app-password:',
    'signed-path:',
    'notarized:',
    'codesign',
    'xcrun notarytool submit',
    'xcrun stapler staple',
    'security delete-keychain',
    '::add-mask::',
    'skipping macOS signing/notarization cleanly',
  ]) {
    assert.ok(text.includes(needle), `sign action implements: ${needle}`);
  }
  assert.match(text, /dry-run:[\s\S]*?default: 'true'/, 'sign action dry-run defaults true');
  assert.match(text, /notarize:[\s\S]*?default: 'false'/, 'sign action notarize defaults false');
  for (const block of compositeSteps(text)) {
    assert.match(block, /shell: bash/, 'every sign action run step uses bash');
  }
});

// ---------------------------------------------------------------------------
// Copy-mode examples and profile docs
// ---------------------------------------------------------------------------
test('copy-mode examples keep the tag/environment guards and never publish from PRs', () => {
  for (const file of COPY_EXAMPLES) {
    assert.ok(exists(file), `${file} exists`);
    const text = read(file);
    assertNoPrTrigger(file);
    assert.match(text, /environment: release/, `${file} gates publishing with the release environment`);
    assert.match(text, /tags:\s*\n\s*- 'v\*'/, `${file} triggers on release tags`);
    assert.match(text, /should-publish/, `${file} computes a publish decision`);
    for (const match of text.matchAll(/^\s+uses:\s+(\S+)/gm)) {
      const ref = match[1];
      if (ref.startsWith('./')) continue;
      assert.match(ref, /@[0-9a-f]{40}$/, `${file} pins ${ref} by full SHA`);
    }
    assert.ok(!/@main\b/.test(text), `${file} does not use @main`);
    assert.ok(!/secrets:\s*inherit/.test(text), `${file} does not inherit all secrets`);
  }
});

test('profiles/release README documents the profile matrix and copy procedure', () => {
  const file = 'profiles/release/README.md';
  assert.ok(exists(file));
  const text = read(file);
  for (const profile of ['generic', 'macos', 'container', 'package']) {
    assert.ok(text.includes(profile), `profile matrix mentions ${profile}`);
  }
  for (const phrase of [
    'reusable',
    'copy',
    'release` environment',
    'SHA256SUMS',
    'dry-run',
    'checksum',
    'sign-notarize-macos',
    'workflows.release.profile',
  ]) {
    assert.ok(text.includes(phrase), `profiles/release README covers: ${phrase}`);
  }
});

test('release-profiles doc covers every required profile topic', () => {
  const file = 'docs/RELEASE_PROFILES.md';
  assert.ok(exists(file));
  const text = read(file);
  for (const phrase of [
    'dry-run is the default',
    'permission-union requirement',
    'startup_failure',
    'macos-15-arm64-us-default',
    'live validation evidence',
    'release` environment',
    'tag pattern',
    'no `pull_request`',
    'SHA256SUMS',
    'ad-hoc',
    'notarytool',
    'GHCR',
    'trusted publishing',
    'MACOS_CERT_P12',
    'RELEASE_TOKEN',
    'NPM_TOKEN',
    'PYPI_API_TOKEN',
    'environment secrets',
    'pin',
    'roll',
    'immutable',
    'copy mode',
  ]) {
    assert.ok(text.toLowerCase().includes(phrase.toLowerCase()), `docs/RELEASE_PROFILES.md covers: ${phrase}`);
  }
});

// ---------------------------------------------------------------------------
// Opt-in adoption-contract gate (v1.4.0 T06 / issue #141)
// ---------------------------------------------------------------------------
function jobBlock(text, id) {
  const marker = `\n  ${id}:\n`;
  const start = text.indexOf(marker);
  assert.ok(start >= 0, `job ${id} exists`);
  const rest = text.slice(start + marker.length);
  const next = rest.search(/\n  [a-z_][a-z0-9_]*:\n/);
  return next >= 0 ? rest.slice(0, next) : rest;
}

test('reusable release contract gate is opt-in and stays within contents: read', () => {
  const text = read(REUSABLE);
  const call = text.slice(text.indexOf('workflow_call:'), text.indexOf('permissions: {}'));
  for (const input of ['contract-gate:', 'tracker-ref:', 'contract-path:', 'config-path:']) {
    assert.ok(call.includes(input), `reusable release declares ${input}`);
  }
  assert.match(call, /contract-gate:[\s\S]*?default: false/, 'contract-gate defaults false');
  assert.match(call, /tracker-ref:[\s\S]*?default: v\d+\.\d+\.\d+/, 'tracker-ref default is a release pin');

  const gate = jobBlock(text, 'contract_gate');
  assert.match(gate, /^ {4}name: contract-gate$/m);
  assert.match(gate, /^ {4}if: \$\{\{ inputs\.contract-gate \}\}$/m);
  const permissions = /permissions:\n((?: {6}[^\n]*\n?)+)/.exec(gate);
  assert.ok(permissions, 'gate job declares permissions');
  assert.equal(permissions[1].trim(), 'contents: read');
  // No issues: read / token / raw gh: the caller permission graph must stay valid for existing
  // callers, and the open-OI half of release-gate is a release-procedure step.
  assert.doesNotMatch(gate, /^\s+issues:/m);
  assert.doesNotMatch(gate, /secrets\./);
  assert.doesNotMatch(gate, /GH_TOKEN/);
  assert.doesNotMatch(gate, /release-gate\.mjs[^\n]*--repo/);
  // config-path is honoured end-to-end (verify-contract/release-gate now accept --config).
  assert.match(gate, /verify-contract\.mjs" --root "\$GITHUB_WORKSPACE" --contract "\$CONTRACT" --config "\$CONFIG"/);
  assert.match(gate, /release-gate\.mjs" --root "\$GITHUB_WORKSPACE" --contract "\$CONTRACT" --config "\$CONFIG"/);
  assert.doesNotMatch(gate, /inputs\.submodule-path/);
  for (const phrase of [
    'verify-tooling.mjs',
    'verify-contract.mjs',
    'release-gate.mjs',
    'inputs.tracker-ref',
    'CANONICAL_REPOSITORY',
    'submodule_path=".tracker-os"',
  ]) {
    assert.ok(gate.includes(phrase), `gate implements: ${phrase}`);
  }
  for (const step of [
    'Checkout caller repository',
    'Checkout tracker contract and tooling',
    'Set up Node.js',
    'Resolve contract gate paths',
    'Fetch pinned tracker submodule tags',
    'Verify tooling contract',
    'Verify adoption contract',
    'Run release gate (offline contract half)',
  ]) {
    assert.ok(gate.includes(`- name: ${step}`), `gate step ${step}`);
  }
});

test('build waits for the contract gate but tolerates it being disabled', () => {
  const build = jobBlock(read(REUSABLE), 'build');
  assert.match(build, /^ {4}needs: \[prepare, contract_gate\]$/m);
  assert.match(build, /needs\.prepare\.result == 'success'/);
  assert.match(build, /needs\.contract_gate\.result == 'success'/);
  assert.match(build, /needs\.contract_gate\.result == 'skipped'/);
  assert.match(build, /!cancelled\(\)/);
});

test('generic caller exposes the gate off by default and pins tracker-ref to the template version', () => {
  const text = read(CALLERS[0]);
  const trigger = workflowTriggerSection(text);
  assert.match(trigger, /contract-gate:[\s\S]*?default: false/, 'caller gate input defaults false');
  assert.match(
    text,
    /contract-gate: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.contract-gate \|\| false \}\}/,
  );
  const config = JSON.parse(read('tracker.config.json'));
  assert.ok(
    text.includes(`tracker-ref: v${config.automation.templateVersion}`),
    'caller pins the checked-in template version',
  );
});

test('release profile examples expose the gate off by default and pin tracker-ref', () => {
  for (const [file] of [
    ['profiles/release/reusable/release-macos.yml', 'macos'],
    ['profiles/release/reusable/release-container.yml', 'container'],
    ['profiles/release/reusable/release-package.yml', 'package'],
  ]) {
    const text = read(file);
    const trigger = workflowTriggerSection(text);
    assert.match(trigger, /contract-gate:[\s\S]*?default: false/, `${file} gate input defaults false`);
    assert.match(text, /contract-gate: \$\{\{ inputs\.contract-gate \}\}/, `${file} passes the gate input`);
    assert.match(text, /tracker-ref: v\d+\.\d+\.\d+/, `${file} pins tracker-ref`);
  }
});

// ---------------------------------------------------------------------------
// Secret hygiene and docs links
// ---------------------------------------------------------------------------
test('no literal credentials or private keys in the new release files', () => {
  const forbidden = [
    /ghp_[A-Za-z0-9]{20,}/,
    /gho_[A-Za-z0-9]{20,}/,
    /ghs_[A-Za-z0-9]{20,}/,
    /github_pat_[A-Za-z0-9_]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /xox[baprs]-[A-Za-z0-9-]{10,}/,
  ];
  for (const file of NEW_FILES) {
    const text = read(file);
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${file} must not contain literal credentials`);
    }
  }
});

test('relative Markdown links in the new docs resolve', () => {
  const files = ['docs/RELEASE_PROFILES.md', 'profiles/release/README.md'];
  for (const file of files) {
    const text = read(file);
    const base = dirname(join(ROOT, file));
    for (const match of text.matchAll(/\]\((\.{1,2}\/[^)#\s]+)(#[^)]*)?\)/g)) {
      const target = resolve(base, match[1]);
      assert.ok(existsSync(target), `${file} links to missing relative path ${match[1]}`);
    }
  }
});

test('release surface contains no floating action refs and no tracked secrets config', () => {
  const files = [
    REUSABLE,
    ...CALLERS,
    ...COPY_EXAMPLES,
    '.github/actions/checksum/action.yml',
    '.github/actions/sign-notarize-macos/action.yml',
  ];
  for (const file of files) {
    const text = read(file);
    for (const match of text.matchAll(/uses:\s+(\S+)/g)) {
      const ref = match[1];
      if (ref.startsWith('./')) continue;
      assert.ok(!/(^|\/)(v\d+|main|master)$/.test(ref.split('@')[1] || ''), `${file} has a floating ref: ${ref}`);
    }
  }
  // The template config must remain free of secrets and the bot flag stays disabled.
  const config = JSON.parse(read('tracker.config.json'));
  assert.equal(config.automation.bot.enabled, false);
  assert.equal(config.workflows.release.profile, 'generic');
  assert.equal(config.workflows.release.dryRun, true);
});

// ---------------------------------------------------------------------------
// Deliverable inventory (files the task promises must actually exist)
// ---------------------------------------------------------------------------
test('all T10 deliverables are present', () => {
  const expected = [
    '.github/workflows/reusable-release.yml',
    '.github/workflows/release.yml',
    'profiles/release/reusable/release-macos.yml',
    'profiles/release/reusable/release-container.yml',
    'profiles/release/reusable/release-package.yml',
    '.github/actions/checksum/action.yml',
    '.github/actions/sign-notarize-macos/action.yml',
    'docs/RELEASE_PROFILES.md',
    'profiles/release/README.md',
    'tests/release-profiles.test.mjs',
  ];
  for (const file of expected) {
    assert.ok(existsSync(join(ROOT, file)), `${file} exists`);
  }
  assert.ok(readdirSync(join(ROOT, 'profiles/release/copy')).length >= 4, 'four copy-mode profile examples exist');
});
