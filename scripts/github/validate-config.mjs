#!/usr/bin/env node
/**
 * Validate tracker.config JSON files against the versioned contract.
 *
 * Usage:
 *   node scripts/github/validate-config.mjs [file ...]
 *
 * With no arguments, validates tracker.config.example.json and examples/*.json.
 * No external dependencies; Node >=22.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WORK_PROFILE, WORK_PROFILES } from './lib/work-profile.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'tracker.config.schema.json');
const SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

const TYPE_CHECKS = {
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: Array.isArray,
  string: (v) => typeof v === 'string',
  integer: Number.isInteger,
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  null: (v) => v === null,
};

function typeOk(value, type) {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => TYPE_CHECKS[t]?.(value));
}

function validationError(errors, p, message) {
  errors.push(`${p || '$'}: ${message}`);
}

function validate(value, schema, p, errors) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.const !== undefined && value !== schema.const) {
    validationError(errors, p, `must equal ${JSON.stringify(schema.const)}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    validationError(errors, p, `must be one of ${schema.enum.map((x) => JSON.stringify(x)).join(', ')}`);
  }
  if (schema.type && !typeOk(value, schema.type)) {
    validationError(errors, p, `expected type ${JSON.stringify(schema.type)}`);
    return;
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      validationError(errors, p, `must be at least ${schema.minLength} character(s)`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      validationError(errors, p, `does not match ${schema.pattern}`);
    }
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    validationError(errors, p, `must be >= ${schema.minimum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      validationError(errors, p, `must contain at least ${schema.minItems} item(s)`);
    }
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) validationError(errors, p, 'must not contain duplicate items');
        seen.add(key);
      }
    }
    if (schema.items) value.forEach((item, i) => validate(item, schema.items, `${p}[${i}]`, errors));
  }
  if (TYPE_CHECKS.object(value)) {
    for (const key of schema.required || []) {
      if (!(key in value)) validationError(errors, `${p}.${key}`, 'is required');
    }
    const properties = schema.properties || {};
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) validate(item, properties[key], `${p}.${key}`, errors);
      else if (schema.additionalProperties === false) validationError(errors, `${p}.${key}`, 'is not allowed');
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validate(item, schema.additionalProperties, `${p}.${key}`, errors);
      }
    }
  }
}

const SECRET_PATTERNS = [
  /sp_dc=/i,
  /refresh[_-]?token/i,
  /access[_-]?token/i,
  /client[_-]?secret/i,
  /password/i,
  /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/i,
];

function scanSecrets(value, p, errors) {
  if (typeof value === 'string') {
    if (SECRET_PATTERNS.some((rx) => rx.test(value)))
      validationError(errors, p, 'looks like a secret value; keep secrets out of config');
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => scanSecrets(item, `${p}[${i}]`, errors));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) scanSecrets(item, `${p}.${key}`, errors);
  }
}

function crossChecks(config, errors) {
  const statuses = config.statuses || [];
  for (const required of ['Todo', 'In Progress', 'In Review', 'Blocked', 'Done']) {
    if (!statuses.includes(required)) validationError(errors, '$.statuses', `should include ${required}`);
  }
  const workProfile = config.workProfile === undefined ? DEFAULT_WORK_PROFILE : config.workProfile;
  if (WORK_PROFILES.includes(workProfile)) {
    if (workProfile === 'tooling') {
      if (!config.fields?.Stream) {
        validationError(
          errors,
          '$.fields.Stream',
          'is required when workProfile is "tooling"; declare the Stream field and its per-delivery options',
        );
      }
    } else {
      for (const fieldName of ['Release', 'Sprint']) {
        if (!config.fields?.[fieldName]) {
          validationError(
            errors,
            `$.fields.${fieldName}`,
            `is required for the ${DEFAULT_WORK_PROFILE} work profile (the default); declare it or set workProfile to "tooling"`,
          );
        }
      }
      if (Array.isArray(config.releases) && config.releases.length === 0) {
        validationError(
          errors,
          '$.releases',
          `the ${DEFAULT_WORK_PROFILE} work profile requires at least one release; declare one or set workProfile to "tooling"`,
        );
      }
    }
  }
  const seenReleases = new Set();
  const seenMilestones = new Set();
  const seenSprints = new Set();
  for (const [ri, release] of (config.releases || []).entries()) {
    const rp = `$.releases[${ri}]`;
    if (seenReleases.has(release.key)) validationError(errors, `${rp}.key`, 'duplicate release key');
    seenReleases.add(release.key);
    if (seenMilestones.has(release.milestone)) validationError(errors, `${rp}.milestone`, 'duplicate milestone');
    seenMilestones.add(release.milestone);
    for (const [si, sprint] of (release.sprints || []).entries()) {
      if (seenSprints.has(sprint.key)) validationError(errors, `${rp}.sprints[${si}].key`, 'duplicate sprint key');
      seenSprints.add(sprint.key);
    }
  }
  if (config.automation?.templateRepo && !config.automation?.templateVersion) {
    validationError(errors, '$.automation.templateVersion', 'required when templateRepo is set');
  }
  scanSecrets(config, '$', errors);
}

export function validateConfig(config) {
  const errors = [];
  validate(config, SCHEMA, '$', errors);
  crossChecks(config, errors);
  return errors;
}

export function validateConfigFile(file) {
  const abs = path.resolve(file);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    return [`${file}: cannot read/parse JSON (${err.message})`];
  }
  return validateConfig(config);
}

function collectProfileExamples(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectProfileExamples(full, out);
    else if (entry.name === 'tracker.config.example.json') out.push(full);
  }
  return out;
}

function defaultFiles() {
  const files = [path.join(ROOT, 'tracker.config.example.json')];
  const dir = path.join(ROOT, 'examples');
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.endsWith('.json')) files.push(path.join(dir, name));
    }
  }
  return [...files, ...collectProfileExamples(path.join(ROOT, 'profiles')).sort()];
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : defaultFiles();
  let failed = false;
  for (const file of files) {
    const errors = validateConfigFile(file);
    if (errors.length) {
      failed = true;
      console.error(`FAIL ${path.relative(ROOT, path.resolve(file))}`);
      for (const error of errors) console.error(`  - ${error}`);
    } else {
      console.log(`OK   ${path.relative(ROOT, path.resolve(file))}`);
    }
  }
  if (failed) process.exitCode = 1;
}
