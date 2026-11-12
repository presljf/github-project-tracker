#!/usr/bin/env node
/**
 * Dependency-free docs checker: relative links, anchors, balanced fenced blocks, secret patterns.
 * Usage: node scripts/docs/check-docs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP = new Set(['.git', 'node_modules', 'coverage', 'dist', 'build', 'out', '.next', 'generated']);
const SECRET_PATTERNS = [
  /sp_dc\s*=/i,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /BEGIN (RSA|EC|OPENSSH) PRIVATE KEY/,
  /client[_-]?secret\s*[:=]\s*['"][^<]/i,
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function slug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\w\s-]/gu, '')
    .replace(/\s+/g, '-');
}

const files = walk(ROOT);
const anchors = new Map();
for (const file of files) {
  const set = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^#{1,6}\s+(.*)$/.exec(line);
    if (match) set.add(slug(match[1]));
  }
  anchors.set(path.resolve(file), set);
}

const errors = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  let fence = false;
  lines.forEach((line) => {
    if (line.startsWith('```')) fence = !fence;
  });
  if (fence) errors.push(`${path.relative(ROOT, file)}: unbalanced code fence`);

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) errors.push(`${path.relative(ROOT, file)}: secret-like pattern ${pattern}`);
  }

  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].trim();
    if (['#', 'http://', 'https://', 'mailto:'].some((prefix) => target.startsWith(prefix))) {
      if (target.startsWith('#')) {
        const frag = decodeURIComponent(target.slice(1));
        if (frag && !anchors.get(path.resolve(file))?.has(frag)) {
          errors.push(`${path.relative(ROOT, file)}: missing anchor ${target}`);
        }
      }
      continue;
    }
    const [pathPart, frag] = target.split('#');
    const dest = path.resolve(path.dirname(file), pathPart);
    if (!fs.existsSync(dest)) {
      errors.push(`${path.relative(ROOT, file)}: missing link target ${target}`);
      continue;
    }
    if (frag && dest.endsWith('.md') && !anchors.get(dest)?.has(decodeURIComponent(frag))) {
      errors.push(`${path.relative(ROOT, file)}: missing anchor ${target}`);
    }
  }
}

if (errors.length) {
  console.error(`docs check FAILED (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`docs check OK — ${files.length} Markdown files; links/anchors/fences clean; no secret-like patterns.`);
}
