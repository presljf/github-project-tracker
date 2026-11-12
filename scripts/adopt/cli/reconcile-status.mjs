#!/usr/bin/env node
/**
 * Reconcile Project Status for closed issues.
 *
 * GitHub closes an issue when a merged completion PR carries `Closes #N`, but the Project Status
 * single-select field is per-item metadata that is NOT updated by closure. `task.mjs done` refuses
 * closed issues, so the closing session must reconcile the field explicitly (this is the #116
 * incident: the issue auto-closed while its status stayed In Review until a human noticed).
 *
 * Report-only by default; `--apply` sets each flagged item to Done. The detection plan is shared
 * with the advisory audit (`projectStatusDrift`) so the audit warning, this command, and the docs
 * cannot disagree about what "stale" means.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './validate-config.mjs';
import { createGitHub } from '../lib/github.mjs';
import { parseArgs, UsageError } from '../lib/cli.mjs';
import { collectAuditData, projectStatusDrift } from './audit.mjs';

const STATUS_FIELD = 'Status';
const DONE = 'Done';

/**
 * Plan entries come from the shared `projectStatusDrift` detector (same scope/repository filters as
 * the advisory audit warning) and already carry the project item id needed by `--apply`.
 */
export function buildStatusReconciliation({ config, data }) {
  return projectStatusDrift({ config, data });
}

/** Resolve the configured project's Status field and the Done option; fail loudly when missing. */
export async function resolveStatusField({ github, config }) {
  const owner = config.project.owner || config.repository.split('/')[0];
  const projects = await github.listProjects(owner);
  const project = projects.find(
    (entry) => entry.number === config.project.number || entry.title === config.project.title,
  );
  if (!project) throw new Error(`project #${config.project.number} not found for ${owner}`);
  const fields = await github.listFields(owner, config.project.number);
  const field = fields.find((entry) => entry.name === STATUS_FIELD);
  if (!field) throw new Error(`project field ${STATUS_FIELD} not found; run bootstrap first`);
  const option = (field.options || []).find((entry) => entry.name === DONE);
  if (!option) throw new Error(`project field ${STATUS_FIELD} has no ${DONE} option; run bootstrap first`);
  return { projectId: project.id, fieldId: field.id, optionId: option.id };
}

/**
 * Apply the plan. `dryRun` (default) only reports what would change; mutations require dryRun:false.
 * Returns `{ applied, skipped }` where skipped entries carry a reason (e.g. missing project item id).
 */
export async function applyStatusReconciliation({ github, config, plan, dryRun = true }) {
  if (!plan.length) return { applied: [], skipped: [] };
  const target = dryRun ? null : await resolveStatusField({ github, config });
  const applied = [];
  const skipped = [];
  for (const entry of plan) {
    if (!entry.itemId) {
      skipped.push({ ...entry, reason: 'project item id missing' });
      continue;
    }
    if (dryRun) {
      applied.push({ ...entry, changed: false, planned: true });
      continue;
    }
    await github.setProjectItemField(target.projectId, entry.itemId, target.fieldId, target.optionId);
    applied.push({ ...entry, changed: true });
  }
  return { applied, skipped };
}

function usage() {
  return [
    'Usage: node scripts/adopt/cli/reconcile-status.mjs --config tracker.config.json [--apply] [--json]',
    '',
    'Lists closed issues whose Project Status is not Done (auto-close drift after `Closes #N`).',
    'Default: report-only (no mutations).',
    '  --apply  Set each flagged project item Status to Done',
    '  --json   Machine-readable plan/result',
    '  --help   Show this help',
  ].join('\n');
}

function printPlan({ config, plan }) {
  console.log(`Project-status reconciliation — ${config.repository} (project #${config.project.number})`);
  if (!plan.length) {
    console.log('No stale Project statuses; every closed item is Done.');
    return;
  }
  console.log(`Stale closed item(s) (${plan.length}) — status should be ${DONE}:`);
  for (const entry of plan)
    console.log(`- #${entry.issue} status=${entry.status || '(none)'} ${entry.title ? `— ${entry.title}` : ''}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  (async () => {
    try {
      const args = parseArgs(process.argv.slice(2), {
        flags: ['apply', 'json', 'help'],
        options: ['config'],
      });
      if (args.help) {
        console.log(usage());
        return;
      }
      const configPath = path.resolve(args.config || 'tracker.config.json');
      if (!fs.existsSync(configPath)) throw new UsageError(`config not found: ${configPath}`);
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const errors = validateConfig(config);
      if (errors.length) throw new UsageError(`invalid config:\n- ${errors.join('\n- ')}`);
      const github = createGitHub();
      const data = await collectAuditData(github, config);
      const plan = buildStatusReconciliation({ config, data });
      const apply = Boolean(args.apply);
      const outcome = apply
        ? await applyStatusReconciliation({ github, config, plan, dryRun: false })
        : { applied: [], skipped: [] };
      if (args.json) {
        process.stdout.write(
          `${JSON.stringify(
            {
              ok: true,
              repository: config.repository,
              project: config.project.number,
              apply,
              count: plan.length,
              plan,
              applied: outcome.applied,
              skipped: outcome.skipped,
            },
            null,
            2,
          )}\n`,
        );
      } else {
        printPlan({ config, plan });
        if (plan.length && !apply) console.log('Run with --apply to set these items to Done.');
        if (apply) console.log(`Applied ${outcome.applied.filter((entry) => entry.changed).length} status update(s).`);
        for (const entry of outcome.skipped) console.warn(`warning: #${entry.issue} skipped (${entry.reason})`);
      }
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    }
  })();
}
