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
import { issueKind } from './audit.mjs';
import { createGitHub } from '../lib/github.mjs';
import { getWorkProfileAdapter } from '../lib/work-profile.mjs';
import { parseArgs, parseIssueRef, UsageError } from '../lib/cli.mjs';
import {
  isProposalTitle,
  missingProposalSections,
  PROPOSAL_DEFERRED_LABEL,
  PROPOSAL_DEFERRED_STATUS,
  PROPOSAL_LABEL,
  PROPOSAL_STATUS,
  PROPOSAL_TYPE,
  proposalSection,
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

function labelsOf(issue) {
  return (issue.labels || []).map((entry) => entry.name || entry);
}

function streamNameFromTitle(title) {
  return /^\[Stream\]\s*(.+?)\s+—\s+/.exec(String(title || ''))?.[1] || null;
}

function releaseNameFromTitle(title) {
  const text = String(title || '');
  return (
    /^\[Release\]\s*(.+?)(?:\s+—|$)/i.exec(text)?.[1] || /^\[(v?\d+\.\d+\.\d+)\]\s*Release\b/i.exec(text)?.[1] || null
  );
}

function sprintNameFromTitle(title) {
  const text = String(title || '');
  return (
    /^\[Sprint\]\s*(\d+\.\d+\.\d+\.\d+)(?:\s|—|$)/i.exec(text)?.[1] ||
    /^\[(\d+\.\d+\.\d+\.\d+)\]\s*Sprint\b/i.exec(text)?.[1] ||
    null
  );
}

function taskBodyFromProposal(body, estimate) {
  const get = (name) => proposalSection(body, name).trim() || '_Not specified._';
  return `## Why / context

${get('Problem / context')}

## Current behavior

The proposal is still intake; no implementation exists yet.

## Goal

${get('Proposal')}

## Non-goals

${get('Non-goals')}

## Acceptance criteria

${get('Acceptance when accepted')}

## Test plan

Add or update automated tests for the accepted scope; run the local suite, lint, format, docs check, and audit.

## Verification evidence

Attach test output and audit/dry-run evidence in the task check-out comment.

## Dependencies / blockers

${get('Dependencies / blockers')}

## Risks / rollback

Low to moderate; revert the implementation commit if the change must be rolled back.

## Estimate

${estimate || 'M'}
`;
}

export async function acceptProposal({
  config,
  github,
  issueNumber,
  title,
  streamNumber,
  releaseNumber,
  sprintNumber,
  milestone,
  area,
  kind,
  estimate,
  source,
  dryRun = false,
} = {}) {
  const ctx = await readContext({ config, github, issueNumber });
  if (issueKind(ctx.issue.title) !== 'proposal') throw new UsageError(`#${issueNumber} is not a [Proposal] issue`);
  if (!ctx.item) throw new UsageError(`#${issueNumber} is not on the project; import it first`);
  if (!title || !/^\[[^\]]+-T\d+\]\s+/.test(title))
    throw new UsageError('--title is required and must look like "[<delivery>-T01] Short task title"');

  const profile = getWorkProfileAdapter(config);
  let parentNumber;
  let deliveryField;
  let deliveryValue;
  if (profile.isTooling) {
    if (!streamNumber) throw new UsageError('--stream ISSUE is required in the tooling profile');
    const streamCtx = await readContext({ config, github, issueNumber: streamNumber });
    if (issueKind(streamCtx.issue.title) !== 'stream')
      throw new UsageError(`#${streamNumber} is not a [Stream] container`);
    deliveryValue = streamNameFromTitle(streamCtx.issue.title);
    if (!deliveryValue) throw new UsageError(`cannot derive Stream option from #${streamNumber} title`);
    deliveryField = profile.streamField;
    parentNumber = streamNumber;
  } else {
    if (!releaseNumber || !sprintNumber)
      throw new UsageError('--release ISSUE and --sprint ISSUE are required in the product profile');
    const releaseCtx = await readContext({ config, github, issueNumber: releaseNumber });
    const sprintCtx = await readContext({ config, github, issueNumber: sprintNumber });
    if (issueKind(releaseCtx.issue.title) !== 'release')
      throw new UsageError(`#${releaseNumber} is not a [Release] container`);
    if (issueKind(sprintCtx.issue.title) !== 'sprint')
      throw new UsageError(`#${sprintNumber} is not a [Sprint] container`);
    if (!milestone) throw new UsageError('--milestone is required in the product profile');
    deliveryValue = [releaseNameFromTitle(releaseCtx.issue.title), sprintNameFromTitle(sprintCtx.issue.title)];
    if (!deliveryValue[0] || !deliveryValue[1])
      throw new UsageError('cannot derive Release/Sprint options from target titles');
    parentNumber = sprintNumber;
  }

  const fields = {
    Status: 'Todo',
    Area: area || ctx.item.area || 'cross',
    Kind: kind || ctx.item.kind || 'infra',
    Estimate: estimate || ctx.item.estimate || 'M',
    Source: source || ctx.item.source || 'Internal',
  };
  if (profile.isTooling) fields[deliveryField] = deliveryValue;
  else {
    fields.Release = deliveryValue[0];
    fields.Sprint = deliveryValue[1];
  }
  const resolved = new Map();
  for (const [field, value] of Object.entries(fields)) resolved.set(field, optionOrThrow(ctx, field, value));
  if (milestone) resolved.set('__milestone', { value: milestone });

  const remove = [PROPOSAL_LABEL, PROPOSAL_DEFERRED_LABEL].filter((label) => labelsOf(ctx.issue).includes(label));
  const taskType = config.issueTypes?.task || 'Task';
  const body = taskBodyFromProposal(ctx.issue.body || '', fields.Estimate);
  const plan = {
    ok: true,
    action: 'accept',
    dryRun,
    issue: issueNumber,
    title,
    body,
    type: taskType,
    removeLabels: remove,
    fields,
    parent: parentNumber,
    milestone: milestone || null,
  };
  if (dryRun) return plan;

  await github.updateIssueTitle(ctx.repoOwner, ctx.repoName, issueNumber, title);
  await github.updateIssueBody(ctx.repoOwner, ctx.repoName, issueNumber, body);
  await github.setIssueType(ctx.repoOwner, ctx.repoName, issueNumber, taskType);
  if (remove.length) await github.removeLabels(ctx.repoOwner, ctx.repoName, issueNumber, remove);
  if (milestone) await github.setIssueMilestone(ctx.repoOwner, ctx.repoName, issueNumber, milestone);
  for (const field of Object.keys(fields)) {
    const { field: fieldObj, option } = resolved.get(field);
    await github.setProjectItemField(ctx.project.id, ctx.item.id, fieldObj.id, option.id);
  }
  await github.addSubIssue(ctx.repoOwner, ctx.repoName, parentNumber, issueNumber);
  await github.addComment(
    ctx.repoOwner,
    ctx.repoName,
    issueNumber,
    [
      '### Proposal accepted',
      `- **Proposal:** #${issueNumber}`,
      `- **Prior state:** ${PROPOSAL_STATUS}`,
      `- **Task:** ${title}`,
      `- **Delivery:** ${profile.isTooling ? `${deliveryField}=${deliveryValue}` : `Release=${deliveryValue[0]}, Sprint=${deliveryValue[1]}`}`,
    ].join('\n'),
  );
  return plan;
}

async function ensureProposalForLifecycle(ctx, issueNumber) {
  if (issueKind(ctx.issue.title) !== 'proposal') throw new UsageError(`#${issueNumber} is not a [Proposal] issue`);
  if (!ctx.item) throw new UsageError(`#${issueNumber} is not on the project; import it first`);
}

export async function deferProposal({ config, github, issueNumber, reason, dryRun = false } = {}) {
  const ctx = await readContext({ config, github, issueNumber });
  await ensureProposalForLifecycle(ctx, issueNumber);
  if (!reason) throw new UsageError('--reason is required');
  const { field, option } = optionOrThrow(ctx, 'Status', PROPOSAL_DEFERRED_STATUS);
  const labelPresent = labelsOf(ctx.issue).includes(PROPOSAL_DEFERRED_LABEL);
  if (dryRun) {
    return { ok: true, action: 'defer', dryRun, issue: issueNumber, reason, labelAdded: !labelPresent };
  }
  if (!labelPresent) await github.addLabels(ctx.repoOwner, ctx.repoName, issueNumber, [PROPOSAL_DEFERRED_LABEL]);
  await github.setProjectItemField(ctx.project.id, ctx.item.id, field.id, option.id);
  await github.addComment(
    ctx.repoOwner,
    ctx.repoName,
    issueNumber,
    ['### Proposal deferred', '', `- **Reason:** ${reason}`, `- **Status:** ${PROPOSAL_DEFERRED_STATUS}`].join('\n'),
  );
  return { ok: true, action: 'defer', dryRun, issue: issueNumber, reason, labelAdded: !labelPresent };
}

export async function rejectProposal({ config, github, issueNumber, reason, dryRun = false } = {}) {
  const ctx = await readContext({ config, github, issueNumber });
  await ensureProposalForLifecycle(ctx, issueNumber);
  if (!reason) throw new UsageError('--reason is required');
  const { field, option } = optionOrThrow(ctx, 'Status', 'Done');
  if (dryRun) return { ok: true, action: 'reject', dryRun, issue: issueNumber, reason };
  await github.addComment(
    ctx.repoOwner,
    ctx.repoName,
    issueNumber,
    ['### Proposal rejected', '', `- **Reason:** ${reason}`, `- **Status:** Done`].join('\n'),
  );
  await github.setProjectItemField(ctx.project.id, ctx.item.id, field.id, option.id);
  await github.closeIssue(ctx.repoOwner, ctx.repoName, issueNumber, 'not_planned');
  return { ok: true, action: 'reject', dryRun, issue: issueNumber, reason };
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
    '  accept --issue N --title "[<delivery>-T01] Short task title"',
    '         (--stream ISSUE | --release ISSUE --sprint ISSUE) [--milestone NAME]',
    '         [--area A] [--kind K] [--estimate S|M|L] [--source S] [--dry-run] [--json]',
    '  defer --issue N --reason TEXT [--dry-run] [--json]',
    '  reject --issue N --reason TEXT [--dry-run] [--json]',
    '',
    'Accept converts the proposal in place: task title/body/type, milestone/family fields,',
    'parent sub-issue, and Status Todo. Defer records a reason and moves it to Deferred.',
    'Reject records a reason, sets Status Done, and closes the issue as not planned.',
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
        options: [
          'config',
          'issue',
          'body-file',
          'area',
          'kind',
          'estimate',
          'source',
          'priority',
          'title',
          'stream',
          'release',
          'sprint',
          'milestone',
          'reason',
        ],
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
      } else if (command === 'accept') {
        result = await acceptProposal({
          config,
          github,
          issueNumber: parseIssueRef(args.issue),
          title: args.title,
          streamNumber: args.stream ? parseIssueRef(args.stream, '--stream') : undefined,
          releaseNumber: args.release ? parseIssueRef(args.release, '--release') : undefined,
          sprintNumber: args.sprint ? parseIssueRef(args.sprint, '--sprint') : undefined,
          milestone: args.milestone,
          area: args.area,
          kind: args.kind,
          estimate: args.estimate,
          source: args.source,
          dryRun: Boolean(args['dry-run']),
        });
      } else if (command === 'defer' || command === 'reject') {
        const options = {
          config,
          github,
          issueNumber: parseIssueRef(args.issue),
          reason: args.reason,
          dryRun: Boolean(args['dry-run']),
        };
        result = command === 'defer' ? await deferProposal(options) : await rejectProposal(options);
      } else {
        throw new UsageError(`unknown command: ${command}`);
      }
      if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else if (result.action === 'list') {
        console.log(`Proposals (${result.count}):`);
        for (const proposal of result.proposals)
          console.log(`- #${proposal.number} ${proposal.title} [${proposal.status || 'off-board'}]`);
      } else if (result.action === 'accept') {
        console.log(
          `${result.dryRun ? 'DRY-RUN' : 'accepted'} proposal #${result.issue} -> ${result.title}` +
            ` (parent #${result.parent}${result.milestone ? `, milestone ${result.milestone}` : ''})`,
        );
        console.log(
          `- fields: ${Object.entries(result.fields)
            .map(([key, value]) => `${key}=${value}`)
            .join(', ')}`,
        );
      } else if (result.action === 'defer' || result.action === 'reject') {
        console.log(`${result.dryRun ? 'DRY-RUN' : result.action} proposal #${result.issue}: ${result.reason}`);
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
