#!/usr/bin/env node
/** Release gate: contract verification + no open bypass OIs. */
import path from 'node:path';
import fs from 'node:fs';
import { verifyContract } from './verify-contract.mjs';
import { GitHubCli } from '../lib/github.mjs';

export function evaluateReleaseGate({ contractResult, bypasses = [], bypassChecked = false }) {
  const violations = [...(contractResult?.violations || [])];
  if (bypasses.length)
    violations.push(`open tracker-contract-exception OI(s): ${bypasses.map((b) => `#${b.number}`).join(', ')}`);
  return {
    ok: violations.length === 0,
    selfRepo: Boolean(contractResult?.selfRepo),
    bypassChecked: Boolean(bypassChecked),
    violations,
  };
}
function main() {
  const args = process.argv.slice(2);
  const get = (name, fallback = null) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const root = path.resolve(get('root', '.'));
  const contractPath = path.resolve(get('contract', path.join(root, 'contract', 'adoption-contract.json')));
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const configArg = get('config');
  const configPath = configArg ? path.resolve(configArg) : path.join(root, 'tracker.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const overridePath = path.join(root, contract.overrideManifest || 'tracker.overrides.json');
  const overrides = fs.existsSync(overridePath) ? JSON.parse(fs.readFileSync(overridePath, 'utf8')) : {};
  const contractResult = verifyContract({ root, contract, config, overrides });
  let bypasses = [];
  const repo = get('repo');
  const label = get('label', 'tracker-contract-exception');
  if (repo) {
    const [owner, name] = repo.split('/');
    bypasses = new GitHubCli().listOpenIssuesByLabel(owner, name, label);
  }
  const result = evaluateReleaseGate({ contractResult, bypasses, bypassChecked: Boolean(repo) });
  if (result.ok) {
    const bypassNote = result.bypassChecked
      ? 'no open bypass OIs.'
      : 'open-OI check skipped (no --repo; run with --repo owner/repo for the release-procedure check).';
    console.log(
      result.selfRepo
        ? `Release gate OK — self-repo: downstream contract checks skipped (version/config verified); ${bypassNote}`
        : `Release gate OK — contract verified; ${bypassNote}`,
    );
  } else {
    console.error(`Release gate FAILED (${result.violations.length}):`);
    for (const v of result.violations) console.error(`- ${v}`);
    process.exitCode = 1;
  }
}
const isMain = process.argv[1] && process.argv[1].endsWith('release-gate.mjs');
if (isMain) main();
