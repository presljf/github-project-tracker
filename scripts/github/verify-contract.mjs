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
  return fs.readdirSync(dir).filter((f) => /\.(ya?ml)$/.test(f)).map((f) => path.join(dir, f));
}
function usesRefs(files) {
  const refs = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/uses:\s*['"]?([^'"\s#]+)['"]?/g)) refs.push({ file, ref: match[1] });
  }
  return refs;
}
export function verifyContract({ root, contract, config, overrides = {} }) {
  const violations = [];
  const version = String(contract.trackerVersion);
  if (String(config?.automation?.templateVersion) !== version) violations.push(`templateVersion=${config?.automation?.templateVersion} expected ${version}`);
  for (const key of contract.requiredConfig || []) if (getPath(config, key) === undefined) violations.push(`required config missing: ${key}`);
  for (const profile of contract.requiredProfiles || []) if (!config?.profiles?.[profile]) violations.push(`required profile missing: ${profile}`);
  for (const doc of contract.requiredDocs || []) if (!fs.existsSync(path.join(root, doc))) violations.push(`required docs missing: ${doc}`);
  const refs = usesRefs(collectWorkflowFiles(root));
  for (const requirement of contract.requiredWorkflows || []) {
    const matches = refs.filter((entry) => entry.ref.split('@')[0] === requirement.reusable);
    const override = (overrides.overrides || []).find((entry) => entry.id === requirement.id);
    if (!matches.length) {
      if (!override) violations.push(`required workflow missing: ${requirement.id} (${requirement.reusable}); declare an OI-linked override if intentional`);
      continue;
    }
    for (const match of matches) {
      if (!match.ref.endsWith(`@v${version}`) && !match.ref.endsWith(`@${version}`)) {
        violations.push(`${requirement.id} ref not pinned to v${version}: ${path.relative(root, match.file)} ${match.ref}`);
      }
    }
    if (override) {
      if (!override.issue || !/^https:\/\/github\.com\/.+\/issues\/\d+$/.test(override.issue)) violations.push(`override ${requirement.id} needs an upstream issue URL`);
      if (!override.reason) violations.push(`override ${requirement.id} needs a reason`);
      if (override.expires && Date.parse(override.expires) < Date.now()) violations.push(`override ${requirement.id} expired ${override.expires}`);
    }
  }
  return { ok: violations.length === 0, version, violations };
}
function main() {
  const args = process.argv.slice(2);
  const get = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
  const root = path.resolve(get('root', '.'));
  const contractPath = path.resolve(get('contract', path.join(root, 'contract', 'adoption-contract.json')));
  const contract = readJson(contractPath);
  const config = readJson(path.join(root, 'tracker.config.json'));
  const overridePath = path.join(root, contract.overrideManifest || 'tracker.overrides.json');
  const overrides = fs.existsSync(overridePath) ? readJson(overridePath) : {};
  const result = verifyContract({ root, contract, config, overrides });
  if (result.ok) console.log(`Adoption contract OK — tracker v${result.version}.`);
  else {
    console.error(`Adoption contract FAILED (${result.violations.length}):`);
    for (const v of result.violations) console.error(`- ${v}`);
    process.exitCode = 1;
  }
}
const isMain = process.argv[1] && process.argv[1].endsWith('verify-contract.mjs');
if (isMain) main();
