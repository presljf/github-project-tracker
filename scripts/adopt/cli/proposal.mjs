#!/usr/bin/env node
/**
 * Proposal lifecycle CLI: board-managed intake that becomes a delivery task only when accepted.
 *
 * This slice implements template/import/list. Import validates the proposal title/body and sets
 * the Feature type, status:proposed label, Proposed board status, and core fields without
 * requiring Release/Sprint/Stream, milestone, task sections, or task hierarchy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './validate-config.mjs';
import { createGitHub } from '../lib/github.mjs';
import { parseArgs, parseIssueRef, UsageError } from '../lib/cli.mjs';
import {
  isProposalTitle,
  missingProposalSections,
  PROPOSAL_LABEL,
  PROPOSAL_STATUS,
  PROPOSAL_TYPE,
  proposalTemplate,
  toProposalTitle,
} from '../lib/proposal.mjs';

function repoParts(config) {
  const [repoOwner, repoName] = String(config.repository || '').split('/');
  if (!repoOwner || !repoName) throw new UsageError('config.repository must be owner/repo');
  return { repoOwner, repoName, owner: config.project.owner };
}

async function readContext({ config, github, issueNumber }) {
  const { repoOwner, repoName, owner } = repoParts(config);
  const issue = await github.getIssueView(repoOwner, repoName, issueNumber);
  if (!issue) throw new Error(`issue #${issueNumber} not found`);
  const projects = await github.listProjects(owner);
  const project = projects.find(
    (entry) => entry.number === config.project.number || entry.title === config.project.title,
  );
  if (!project) throw new Error(`project ${config.project.number} not found`);
  const fields = await github.listFields(owner, config.project.number);
  let item;
  if (typeof github.getProjectItemForIssue === 'function') {
    item = await github.getProjectItemForIssue(owner, config.project.number, repoOwner, repoName, issueNumber);
  } else {
    const items = await github.listProjectItems(owner, config.project.number);
    item = items.find((entry) => entry.content?.number === issueNumber);
  }
  const field = (name) => fields.find((entry) => entry.name === name);
  const option = (name, value) => field(name)?.options?.find((entry) => entry.name === value);
  return { config, github, repoOwner, repoName, owner, issue, project, fields, item, field, option };
}

function optionOrThrow(ctx, fieldName, value) {
  const field = ctx.field(fieldName);
  if (!field) throw new Error(`project field ${fieldName} not found; run bootstrap or fix config`);
  const option = field.options?.find((entry) => entry.name === value);
  if (!option) {
    throw new Error(
      `option ${JSON.stringify(value)} not found on field ${fieldName}; add it with ` +
        `node scripts/adopt/cli/project-field-option.mjs --config tracker.config.json --field ${fieldName} --option ${JSON.stringify(value)}`,
    );
  }
  return { field, option };
}

export async function importProposal({
  config,
  github,
  issueNumber,
  bodyFile,
  area = 'cross',
  kind = 'infra',
  estimate = 'M',
  source = 'Internal',
  priority,
  dryRun = false,
} = {}) {
  const ctx = await readContext({ config, github, issueNumber });
  const kindNow = ctx.issue.title.match(/^\[([^\]]+)\]/)?.[1] || '';
  if (/^(Program|Roadmap|Release|Sprint|Stream)$/i.test(kindNow))
    throw new UsageError(`#${issueNumber} is a ${kindNow} container, not a proposal candidate`);

  const body = bodyFile ? fs.readFileSync(path.resolve(bodyFile), 'utf8') : ctx.issue.body || '';
  const missing = missingProposalSections(body);
  if (missing.length) {
    throw new UsageError(
      `proposal body is missing required section(s): ${missing.map((s) => `## ${s}`).join(', ')}. ` +
        'Use `proposal.mjs template` and fill them before importing.',
    );
  }

  const title = toProposalTitle(ctx.issue.title);
  const type = config.issueTypes?.feature || PROPOSAL_TYPE;
  const labels = (ctx.issue.labels || []).map((entry) => entry.name || entry);
  const currentType = ctx.issue.issueType?.name || ctx.issue.type || null;
  const deliveryFields = ['release', 'sprint', 'stream'].filter((field) => ctx.item?.[field]);
  if (deliveryFields.length) {
    throw new UsageError(
      `#${issueNumber} already has delivery field(s) ${deliveryFields.join(', ')}; proposals must not carry Release/Sprint/Stream`,
    );
  }

  const planned = {
    titleChanged: title !== ctx.issue.title,
    bodyChanged: Boolean(bodyFile),
    typeChanged: currentType !== type,
    labelAdded: !labels.includes(PROPOSAL_LABEL),
    projectItemAdded: !ctx.item,
    fields: {},
  };
  const setField = (fieldName, value) => {
    if (value === undefined || value === null || value === '') return;
    const resolved = optionOrThrow(ctx, fieldName, value);
    planned.fields[fieldName] = value;
    return resolved;
  };
  const status = setField('Status', PROPOSAL_STATUS);
  const areaField = setField('Area', area);
  const kindField = setField('Kind', kind);
  const estimateField = setField('Estimate', estimate);
  const sourceField = setField('Source', source);
  const priorityField = priority ? setField('Priority', priority) : null;

  if (!dryRun) {
    if (planned.titleChanged) await github.updateIssueTitle(ctx.repoOwner, ctx.repoName, issueNumber, title);
    if (planned.bodyChanged) await github.updateIssueBody(ctx.repoOwner, ctx.repoName, issueNumber, body);
    if (planned.typeChanged) await github.setIssueType(ctx.repoOwner, ctx.repoName, issueNumber, type);
    if (planned.labelAdded) await github.addLabels(ctx.repoOwner, ctx.repoName, issueNumber, [PROPOSAL_LABEL]);
    let item = ctx.item;
    if (!item) item = await github.addProjectItem(ctx.owner, config.project.number, ctx.issue.url);
    if (!item?.id) throw new Error('project item id missing after add');
    const updates = [
      [status, planned.fields.Status],
      [areaField, planned.fields.Area],
      [kindField, planned.fields.Kind],
      [estimateField, planned.fields.Estimate],
      [sourceField, planned.fields.Source],
      ...(priorityField ? [[priorityField, planned.fields.Priority]] : []),
    ];
    for (const [resolved, value] of updates) {
      if (!resolved || !value) continue;
      await github.setProjectItemField(ctx.project.id, item.id, resolved.field.id, resolved.option.id);
    }
  }

  return {
    ok: true,
    action: 'import',
    dryRun,
    issue: issueNumber,
    title,
    project: config.project.number,
    projectItemAdded: planned.projectItemAdded,
    changes: planned,
  };
}

export async function listProposals({ config, github } = {}) {
  const { repoOwner, repoName, owner } = repoParts(config);
  const issues = await github.listIssues(repoOwner, repoName, 'open');
  const proposals = issues.filter((issue) => isProposalTitle(issue.title));
  const items =
    typeof github.listProjectItems === 'function' ? await github.listProjectItems(owner, config.project.number) : [];
  const byNumber = new Map(items.map((item) => [item.content?.number, item]));
  return {
    ok: true,
    action: 'list',
    count: proposals.length,
    proposals: proposals.map((issue) => ({
      number: issue.number,
      title: issue.title,
      url: issue.url,
      labels: (issue.labels || []).map((entry) => entry.name || entry),
      status: byNumber.get(issue.number)?.status || null,
    })),
  };
}

function usage() {
  return [
    'Usage: node scripts/adopt/cli/proposal.mjs <command> [options]',
    '',
    'Commands:',
    '  template                         Print the proposal body template',
    '  import --issue N [--body-file F] [--area A] [--kind K] [--estimate S|M|L]',
    '         [--source S] [--priority P] [--dry-run] [--json]',
    '  list [--json]',
    '',
    'Import validates the proposal title/body, sets the Feature type, status:proposed label,',
    'Proposed board status, and core fields. It never requires Release/Sprint/Stream, milestone,',
    'task sections, or task hierarchy. Acceptance/conversion is a follow-up command.',
    '',
    'Default: mutations enabled. --dry-run performs read-only validation and prints the plan.',
  ].join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  (async () => {
    try {
      const raw = process.argv.slice(2);
      const command = raw[0];
      if (!command || command === '--help' || command === '-h') {
        console.log(usage());
        return;
      }
      if (command === 'template') {
        process.stdout.write(proposalTemplate());
        return;
      }
      const args = parseArgs(raw.slice(1), {
        flags: ['dry-run', 'json', 'help'],
        options: ['config', 'issue', 'body-file', 'area', 'kind', 'estimate', 'source', 'priority'],
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
      let result;
      if (command === 'import') {
        result = await importProposal({
          config,
          github,
          issueNumber: parseIssueRef(args.issue),
          bodyFile: args['body-file'],
          area: args.area,
          kind: args.kind,
          estimate: args.estimate,
          source: args.source,
          priority: args.priority,
          dryRun: Boolean(args['dry-run']),
        });
      } else if (command === 'list') {
        result = await listProposals({ config, github });
      } else {
        throw new UsageError(`unknown command: ${command}`);
      }
      if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else if (result.action === 'list') {
        console.log(`Proposals (${result.count}):`);
        for (const proposal of result.proposals)
          console.log(`- #${proposal.number} ${proposal.title} [${proposal.status || 'off-board'}]`);
      } else {
        console.log(
          `${result.dryRun ? 'DRY-RUN' : 'imported'} proposal #${result.issue}: ${result.title}` +
            ` (project ${result.project}${result.projectItemAdded ? ', added' : ', existing item'})`,
        );
        if (result.changes?.labelAdded) console.log(`- add label ${PROPOSAL_LABEL}`);
        if (result.changes?.typeChanged) console.log(`- set type ${PROPOSAL_TYPE}`);
        if (result.changes?.fields)
          for (const [field, value] of Object.entries(result.changes.fields)) console.log(`- ${field}: ${value}`);
      }
    } catch (error) {
      console.error(`error: ${error?.message || error}`);
      process.exitCode = 1;
    }
  })();
}
