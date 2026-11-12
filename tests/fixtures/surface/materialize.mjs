/**
 * Surface-guard fixtures: materialize the clean mini-repo plus a per-case overlay into a temp dir.
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

function applyManifest(root, spec) {
  if (!spec) return;
  const file = path.join(root, 'contract', 'repo-surface.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.entries = manifest.entries.filter((entry) => !(spec.remove ?? []).includes(entry.id));
  for (const entry of spec.add ?? []) manifest.entries.push(entry);
  for (const [id, patch] of Object.entries(spec.set ?? {})) {
    const entry = manifest.entries.find((item) => item.id === id);
    if (!entry) throw new Error(`surface fixture: unknown entry id ${id}`);
    Object.assign(entry, patch);
  }
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Copy the clean fixture to a temp root and apply the named case overlay. */
export function materializeSurfaceCase(name = 'clean') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `surface-${name}-`));
  fs.cpSync(CLEAN_DIR, root, { recursive: true });
  if (name === 'clean') return root;
  const spec = readCase(name);
  for (const rel of spec.remove ?? []) fs.rmSync(path.join(root, rel), { recursive: true, force: true });
  for (const [rel, content] of Object.entries(spec.write ?? {})) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  for (const [rel, content] of Object.entries(spec.append ?? {})) {
    fs.appendFileSync(path.join(root, rel), content);
  }
  for (const edit of spec.replace ?? []) {
    const file = path.join(root, edit.rel);
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(edit.from)) throw new Error(`surface fixture: ${edit.rel} has no ${JSON.stringify(edit.from)}`);
    fs.writeFileSync(file, text.split(edit.from).join(edit.to));
  }
  applyManifest(root, spec.manifest);
  return root;
}

/** Remove a materialized fixture root. */
export function cleanupSurfaceCase(root) {
  fs.rmSync(root, { recursive: true, force: true });
}
