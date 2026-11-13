#!/usr/bin/env node
/**
 * Safe append of a single-select option to a GitHub Projects field.
 *
 * Reads the current options first, keeps every existing option id/colour/description (so item
 * values that reference those ids are untouched), appends only when the option name is new, and
 * is idempotent on re-run. Used by the tooling stream lifecycle to add a per-delivery Stream
 * option before creating a `[Stream]` container.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './validate-config.mjs';
import { createGitHub } from '../lib/github.mjs';
import { parseArgs, UsageError } from '../lib/cli.mjs';

/** GitHub Projects single-select option colours. */
export const FIELD_COLORS = ['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE'];

/**
 * Pure merge: preserve existing option descriptors, append the new option without an id.
 * Returns `{ added, options }`.
 */
export function mergeSingleSelectOption(existingOptions = [], optionName, { color = 'BLUE', description = '' } = {}) {
  const name = typeof optionName === 'string' ? optionName : optionName?.name;
  if (!name || !String(name).trim()) throw new Error('option name is required');
  const normalized = (existingOptions || []).map((option) => ({
    id: option.id || null,
    name: option.name,
    color: option.color || 'BLUE',
    description: option.description || '',
  }));
  if (normalized.some((option) => option.name === name)) return { added: false, options: normalized };
  return { added: true, options: [...normalized, { name, color, description }] };
}

/** Find the declared single-select field or fail with an actionable message. */
export function findSingleSelectField(fields, fieldName) {
  const field = (fields || []).find((entry) => entry.name === fieldName);
  if (!field) {
    throw new Error(
      `project field ${JSON.stringify(fieldName)} not found; declare it in tracker.config.json and run bootstrap`,
    );
  }
  // The project field-list command reports `type: "ProjectV2SingleSelectField"`; the fakes/tests use
  // `dataType: "SINGLE_SELECT"`. Accept both and reject anything else (e.g. ProjectV2Field text).
  const dataType = field.dataType || field.type;
  const singleSelect = dataType === 'SINGLE_SELECT' || dataType === 'ProjectV2SingleSelectField';
  if (dataType && !singleSelect) {
    throw new Error(`project field ${JSON.stringify(fieldName)} is not a single-select field (${dataType})`);
  }
  return field;
}

/**
 * Ensure `optionName` exists on `fieldName`, preserving existing ids/colours and item values.
 * `runner` must expose `listFields(owner, projectNumber)` and `updateFieldOptions(fieldId, options)`.
 */
export async function ensureSingleSelectOption({
  runner,
  owner,
  projectNumber,
  fieldName,
  optionName,
  color = 'BLUE',
  description = '',
  dryRun = false,
}) {
  if (!runner || typeof runner.listFields !== 'function' || typeof runner.updateFieldOptions !== 'function') {
    throw new Error('a GitHub runner with listFields/updateFieldOptions is required');
  }
  if (!FIELD_COLORS.includes(color)) {
    throw new Error(`invalid option color ${JSON.stringify(color)}; expected one of ${FIELD_COLORS.join(', ')}`);
  }
  const fields = await runner.listFields(owner, projectNumber);
  const field = findSingleSelectField(fields, fieldName);
  const merged = mergeSingleSelectOption(field.options, optionName, { color, description });
  if (!merged.added) {
    return { ok: true, added: false, unmodified: true, dryRun, field: field.name, option: optionName };
  }
  if (dryRun) {
    return {
      ok: true,
      added: false,
      planned: true,
      dryRun,
      field: field.name,
      option: optionName,
      options: merged.options,
    };
  }
  await runner.updateFieldOptions(field.id, merged.options);
  const addedOption = merged.options.find((option) => option.name === optionName);
  return {
    ok: true,
    added: true,
    dryRun,
    field: field.name,
    option: optionName,
    optionId: addedOption?.id || null,
    options: merged.options,
  };
}

function usage() {
  return [
    'Usage: node scripts/adopt/cli/project-field-option.mjs --config tracker.config.json --field NAME --option VALUE',
    '                                                                 [--color BLUE] [--description TEXT] [--dry-run] [--json]',
    '',
    'Safely appends a single-select option, preserving existing option ids/colours and item values.',
    'Idempotent: an existing option is left unchanged. Default: mutates unless --dry-run.',
  ].join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  (async () => {
    try {
      const args = parseArgs(process.argv.slice(2), {
        flags: ['dry-run', 'json', 'help'],
        options: ['config', 'field', 'option', 'color', 'description'],
      });
      if (args.help) {
        console.log(usage());
        return;
      }
      if (!args.field) throw new UsageError('--field is required (for example --field Stream)');
      if (!args.option) throw new UsageError('--option is required (for example --option v1.3.1)');
      const configPath = path.resolve(args.config || 'tracker.config.json');
      if (!fs.existsSync(configPath)) throw new UsageError(`config not found: ${configPath}`);
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const errors = validateConfig(config);
      if (errors.length) throw new UsageError(`invalid config:\n- ${errors.join('\n- ')}`);
      if (!config.project?.number) throw new UsageError('config.project.number is required');
      const [repoOwner] = String(config.repository || '').split('/');
      const owner = config.project.owner || repoOwner;
      const result = await ensureSingleSelectOption({
        runner: createGitHub(),
        owner,
        projectNumber: config.project.number,
        fieldName: args.field,
        optionName: args.option,
        color: args.color || 'BLUE',
        description: args.description || '',
        dryRun: Boolean(args['dry-run']),
      });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else if (result.unmodified) {
        console.log(`${result.field}: option ${JSON.stringify(result.option)} already exists; unchanged.`);
      } else if (result.planned) {
        console.log(
          `${result.field}: would append option ${JSON.stringify(result.option)} (dry-run; ${result.options.length} options total).`,
        );
      } else {
        console.log(
          `${result.field}: appended option ${JSON.stringify(result.option)} (${result.options.length} options).`,
        );
      }
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    }
  })();
}
