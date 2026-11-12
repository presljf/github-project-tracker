#!/usr/bin/env node
/** Verify downstream tooling versions/config against the adoption contract. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function major(version = '') {
  const m = String(version).match(/^[~^]?(\d+)/);
  return m ? Number(m[1]) : null;
}
export function evaluateTooling({ contract, pkg = {}, configText = '', submoduleTag = null } = {}) {
  const tooling = contract.tooling || {};
  const violations = [];
  for (const [name, expected] of Object.entries(tooling)) {
    if (name === 'config') continue;
    const actual = pkg.dependencies?.[name] || pkg.devDependencies?.[name];
    if (!actual) violations.push(`tooling dependency missing: ${name}`);
    else if (major(actual) !== major(expected)) violations.push(`${name} major=${major(actual)} expected ${expected}`);
  }
  const configPath = tooling.config || 'profiles/node/eslint.config.mjs';
  if (!String(configText).includes(configPath))
    violations.push(`eslint config does not import shared baseline: ${configPath}`);
  if (configText.includes("'no-useless-assignment': 'warn'") || configText.includes("'preserve-caught-error': 'warn'"))
    violations.push('local lint warning override present; fix warnings instead');
  if (submoduleTag && String(submoduleTag).replace(/^v/, '') !== String(contract.trackerVersion).replace(/^v/, ''))
    violations.push(`.tracker-os tag=${submoduleTag} expected v${contract.trackerVersion}`);
  return { ok: violations.length === 0, violations };
}
function main() {
  const args = process.argv.slice(2);
  const get = (n, d = null) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : d;
  };
  const root = path.resolve(get('root', '.'));
  const contract = JSON.parse(
    fs.readFileSync(get('contract', path.join(root, 'contract/adoption-contract.json')), 'utf8'),
  );
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const configFile = get('config', 'eslint.config.mjs');
  const configText = fs.existsSync(path.join(root, configFile))
    ? fs.readFileSync(path.join(root, configFile), 'utf8')
    : '';
  let submoduleTag = null;
  const submodule = path.join(root, '.tracker-os');
  if (fs.existsSync(submodule)) {
    try {
      submoduleTag = execFileSync('git', ['-C', submodule, 'describe', '--tags', '--exact-match'], {
        encoding: 'utf8',
      }).trim();
    } catch {
      submoduleTag = 'unknown';
    }
  }
  const result = evaluateTooling({ contract, pkg, configText, submoduleTag });
  if (result.ok) console.log('Tooling contract OK.');
  else {
    console.error(`Tooling contract FAILED (${result.violations.length}):`);
    for (const v of result.violations) console.error(`- ${v}`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && process.argv[1].endsWith('verify-tooling.mjs')) main();
