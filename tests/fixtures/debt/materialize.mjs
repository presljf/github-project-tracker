/**
 * Debt-register fixtures: materialize the clean mini-repo plus a per-case overlay into a temp dir.
 * Test-only helper; not a script entrypoint.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CLEAN_DIR = path.join(HERE, 'clean');
export const CASES_DIR = path.join(HERE, 'cases');

/** Read a case definition ({} when the case has no overlay spec). */
export function readCase(name) {
  const file = path.join(CASES_DIR, name, 'case.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function writeFile(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Copy the clean fixture to a temp root and apply the named case overlay. */
export function materializeDebtCase(name = 'clean') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `debt-${name}-`));
  fs.cpSync(CLEAN_DIR, root, { recursive: true });
  if (name === 'clean') return root;
  const spec = readCase(name);
  if (spec.register) writeFile(root, 'contract/debt-register.json', `${JSON.stringify(spec.register, null, 2)}\n`);
  if (spec.files) {
    for (const [rel, content] of Object.entries(spec.files)) writeFile(root, rel, content);
  }
  if (spec.remove) {
    for (const rel of spec.remove) fs.rmSync(path.join(root, rel), { recursive: true, force: true });
  }
  if (spec.doc !== undefined) writeFile(root, 'docs/TECH_DEBT.md', spec.doc);
  return root;
}

export function cleanupDebtCase(root) {
  fs.rmSync(root, { recursive: true, force: true });
}
