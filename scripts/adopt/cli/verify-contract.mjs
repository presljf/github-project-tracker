#!/usr/bin/env node
/** Verify a downstream project follows the pinned tracker adoption contract. */
import fs from 'node:fs';
import path from 'node:path';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function getPath(obj, dotted) {
  return dotted.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}
function collectWorkflowFiles(root) {
  const dir = path.join(root, '.github', 'workflows');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(ya?ml)$/.test(f))
    .map((f) => path.join(dir, f));
}
/**
 * Split each workflow file into top-level job blocks (after `jobs:`). The job indentation is
 * derived from the first job key, so valid 2-space and 4-space layouts both work; blank lines and
 * full-line comments (at any indent) are ignored, and a column-0 comment never ends the job map.
 * Scanning per job keeps a `tracker-ref` attached to the caller that actually uses it and avoids
 * cross-caller attribution in combined files.
 */
function collectWorkflowJobs(root) {
  const jobs = [];
  for (const file of collectWorkflowFiles(root)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    let inJobs = false;
    let jobIndent = null;
    let current = null;
    const flush = () => {
      if (current) jobs.push({ file, id: current.id, text: current.lines.join('\n') });
      current = null;
    };
    for (const line of lines) {
      if (!inJobs) {
        if (/^jobs:\s*(?:#.*)?$/.test(line)) inJobs = true;
        continue;
      }
      if (line.trim() === '' || /^\s*#/.test(line)) continue;
      const indent = line.match(/^\s*/)[0].length;
      if (indent === 0) break;
      const key = /^(\s+)([A-Za-z_][\w-]*):\s*(?:#.*)?$/.exec(line);
      if (jobIndent === null) {
        if (!key) continue;
        jobIndent = indent;
      }
      if (indent === jobIndent && key) {
        flush();
        current = { id: key[2], lines: [line] };
        continue;
      }
      if (current && indent > jobIndent) current.lines.push(line);
    }
    flush();
  }
  return jobs;
}
/**
 * Real `uses:` mapping lines only: line-anchored, comments excluded, trailing YAML comments
 * tolerated. A commented-out `# uses: ...` line must never satisfy a required caller.
 */
function usesRefs(text) {
  const refs = [];
  for (const match of text.matchAll(/^\s*uses:\s*(['"]?)([^'"\s#]+)\1\s*(?:#.*)?$/gm)) refs.push(match[2]);
  return refs;
}
/**
 * `tracker-ref:` values in one job block. Captures the whole value (so expressions fail), strips a
 * trailing YAML comment, then unwraps quotes. Empty values stay empty and fail downstream.
 */
function trackerValues(text) {
  const values = [];
  for (const match of text.matchAll(/^\s*tracker-ref:\s*(.*?)\s*$/gm)) {
    const raw = match[1].replace(/\s+#.*$/, '').trim();
    const quoted = /^(['"])(.*)\1$/.exec(raw);
    values.push(quoted ? quoted[2] : raw);
  }
  return values;
}
/**
 * The contract's own repository ships the contract, reusable workflows and adopter docs rather than
 * consuming them. Downstream-adopter checks (required profile/docs/workflow pins) are skipped there;
 * version/config alignment is still verified.
 */
export function isSelfRepo({ contract, config }) {
  return (
    Boolean(contract?.repository && config?.repository) && String(config.repository) === String(contract.repository)
  );
}

export function verifyContract({ root, contract, config, overrides = {} }) {
  const violations = [];
  const version = String(contract.trackerVersion);
  const selfRepo = isSelfRepo({ contract, config });
  if (String(config?.automation?.templateVersion) !== version)
    violations.push(`templateVersion=${config?.automation?.templateVersion} expected ${version}`);
  for (const key of contract.requiredConfig || [])
    if (getPath(config, key) === undefined) violations.push(`required config missing: ${key}`);
  if (selfRepo) {
    return {
      ok: violations.length === 0,
      version,
      selfRepo: true,
      skipped: ['requiredProfiles', 'requiredDocs', 'requiredWorkflows'],
      notes: [
        `self-repo: downstream contract checks skipped (${['requiredProfiles', 'requiredDocs', 'requiredWorkflows'].join(', ')}) — this repository owns the contract and reusable workflows`,
      ],
      violations,
    };
  }
  for (const profile of contract.requiredProfiles || [])
    if (!config?.profiles?.[profile]) violations.push(`required profile missing: ${profile}`);
  for (const doc of contract.requiredDocs || [])
    if (!fs.existsSync(path.join(root, doc))) violations.push(`required docs missing: ${doc}`);
  const jobs = collectWorkflowJobs(root);
  for (const requirement of contract.requiredWorkflows || []) {
    const matches = [];
    for (const job of jobs) {
      for (const ref of usesRefs(job.text)) {
        if (ref.split('@')[0] === requirement.reusable) {
          matches.push({ file: job.file, job: job.id, ref, text: job.text });
        }
      }
    }
    const override = (overrides.overrides || []).find((entry) => entry.id === requirement.id);
    if (override) {
      if (!override.issue || !/^https:\/\/github\.com\/.+\/issues\/\d+$/.test(override.issue))
        violations.push(`override ${requirement.id} needs an upstream issue URL`);
      if (!override.reason) violations.push(`override ${requirement.id} needs a reason`);
      if (override.expires && Date.parse(override.expires) < Date.now())
        violations.push(`override ${requirement.id} expired ${override.expires}`);
    }
    if (!matches.length) {
      if (!override)
        violations.push(
          `required workflow missing: ${requirement.id} (${requirement.reusable}); declare an OI-linked override if intentional`,
        );
      continue;
    }
    for (const match of matches) {
      const relative = path.relative(root, match.file);
      if (!match.ref.endsWith(`@v${version}`)) {
        violations.push(
          `${requirement.id} ref not pinned to v${version}: ${relative} job ${match.job} ${match.ref} (use the exact @v${version} release tag; SHA and no-v refs are not accepted)`,
        );
      }
      for (const trackerRef of trackerValues(match.text)) {
        if (trackerRef !== `v${version}`) {
          violations.push(
            `${requirement.id} tracker-ref not pinned to v${version}: ${relative} job ${match.job} ${trackerRef || '<empty>'} (the reusable tooling pin must match the caller ref)`,
          );
        }
      }
    }
  }
  return { ok: violations.length === 0, version, selfRepo: false, skipped: [], notes: [], violations };
}
function main() {
  const args = process.argv.slice(2);
  const get = (name, fallback = null) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const root = path.resolve(get('root', '.'));
  const contractPath = path.resolve(get('contract', path.join(root, 'contract', 'adoption-contract.json')));
  const contract = readJson(contractPath);
  const configArg = get('config');
  const configPath = configArg ? path.resolve(configArg) : path.join(root, 'tracker.config.json');
  const config = readJson(configPath);
  const overridePath = path.join(root, contract.overrideManifest || 'tracker.overrides.json');
  const overrides = fs.existsSync(overridePath) ? readJson(overridePath) : {};
  const result = verifyContract({ root, contract, config, overrides });
  for (const note of result.notes) console.log(note);
  if (result.ok)
    console.log(
      result.selfRepo
        ? `Adoption contract OK — tracker v${result.version} (self-repo: downstream contract checks skipped).`
        : `Adoption contract OK — tracker v${result.version}.`,
    );
  else {
    console.error(`Adoption contract FAILED (${result.violations.length}):`);
    for (const v of result.violations) console.error(`- ${v}`);
    process.exitCode = 1;
  }
}
const isMain = process.argv[1] && process.argv[1].endsWith('verify-contract.mjs');
if (isMain) main();
