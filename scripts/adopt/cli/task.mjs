#!/usr/bin/env node
/**
 * Task lifecycle CLI: start, checkpoint, review, block, done, status.
 * Enforces DoR/WIP on start and evidence/acceptance on done; dry-run makes no mutations.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './validate-config.mjs';
import { evaluateCleanTree, gitStatus } from '../lib/preflight.mjs';
import { issueKind } from './audit.mjs';
import { createGitHub } from '../lib/github.mjs';
import { parseArgs, parseIssueRef, UsageError } from '../lib/cli.mjs';
import { doneRequiresPr, getWorkProfileAdapter } from '../lib/work-profile.mjs';

const STATUSES = ['Todo', 'In Progress', 'In Review', 'Blocked', 'Done'];

function repoParts(config) {
  const [repoOwner, repoName] = config.repository.split('/');
  return { repoOwner, repoName, owner: config.project.owner || repoOwner };
}

async function readContext({ config, github, issueNumber }) {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) throw new UsageError('--issue must be a positive integer');
  const { repoOwner, repoName, owner } = repoParts(config);
  if (!config.project?.number) throw new UsageError('config.project.number is required');
  const issue = await github.getIssueView(repoOwner, repoName, issueNumber);
  if (!issue) throw new Error(`issue #${issueNumber} not found`);
  const projects = await github.listProjects(owner);
  const project = projects.find(
    (entry) => entry.number === config.project.number || entry.title === config.project.title,
  );
  const fields = await github.listFields(owner, config.project.number);
  let item;
  if (typeof github.getProjectItemForIssue === 'function') {
    item = await github.getProjectItemForIssue(owner, config.project.number, repoOwner, repoName, issueNumber);
  } else {
    const items = await github.listProjectItems(owner, config.project.number);
    item = items.find((entry) => entry.content?.number === issueNumber);
  }
  const items = item ? [item] : [];
  const field = (name) => fields.find((entry) => entry.name === name);
  const option = (name, value) => field(name)?.options?.find((entry) => entry.name === value);
  return {
    config,
    github,
    repoOwner,
    repoName,
    owner,
    issue,
    fields,
    items,
    item,
    field,
    option,
    projectId: project?.id,
  };
}

function requireFieldOption(ctx, fieldName, value) {
  const field = ctx.field(fieldName);
  if (!field) throw new Error(`project field ${fieldName} not found; run bootstrap or fix config`);
  const option = field.options?.find((entry) => entry.name === value);
  if (!option) throw new Error(`option ${value} not found on field ${fieldName}`);
  return { field, option };
}

async function setStatus(ctx, status, dryRun) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status ${status}`);
  if (!ctx.item) throw new Error(`issue #${ctx.issue.number} is not on project ${ctx.config.project.number}`);
  const { field, option } = requireFieldOption(ctx, 'Status', status);
  if (ctx.item.status === status) return { changed: false };
  if (dryRun) return { changed: false, planned: true };
  await ctx.github.setProjectItemField(ctx.projectId, ctx.item.id, field.id, option.id);
  return { changed: true };
}

function assigneeLogins(issue) {
  return (issue.assignees || []).map((entry) => entry.login || entry);
}

function hasAcceptance(body) {
  return /##\s*Acceptance criteria/i.test(body || '');
}

function uncheckedAcceptance(body) {
  const match = /##\s*Acceptance criteria[^\n]*\n([\s\S]*?)(?=\n##\s|\s*$)/i.exec(body || '');
  if (!match) return [];
  return match[1].split('\n').filter((line) => /^\s*-\s*\[\s*\]/.test(line));
}

async function checkWip({ ctx, owner, dryRun }) {
  const { repoOwner, repoName } = ctx;
  const issues = await ctx.github.listIssues(repoOwner, repoName, 'open');
  let itemByNumber;
  if (typeof ctx.github.batchProjectItems === 'function') {
    const byNumber = await ctx.github.batchProjectItems(
      ctx.owner,
      ctx.config.project.number,
      repoOwner,
      repoName,
      issues.map((issue) => issue.number),
    );
    itemByNumber = new Map(Object.entries(byNumber).map(([number, item]) => [Number(number), item]));
  } else {
    const items = await ctx.github.listProjectItems(ctx.owner, ctx.config.project.number);
    itemByNumber = new Map(items.map((item) => [item.content?.number, item]));
  }
  const active = [];
  for (const issue of issues) {
    if (issue.number === ctx.issue.number) continue;
    if (issueKind(issue.title) !== 'task') continue;
    const item = itemByNumber.get(issue.number);
    if (item?.status !== 'In Progress') continue;
    const assignees = (issue.assignees || []).map((entry) => entry.login || entry);
    if (assignees.includes(owner) || assignees.length === 0) active.push(issue.number);
  }
  if (active.length) {
    const message = `WIP limit: ${owner} already has In Progress task(s) ${active.map((n) => `#${n}`).join(', ')}. Finish/block/defer them first.`;
    if (!dryRun) throw new Error(message);
    return message;
  }
  return null;
}

async function validateStreamMembership({ config, github, issue, item, streamNumber, profile }) {
  const { repoOwner, repoName } = repoParts(config);
  const streamCtx = await readContext({ config, github, issueNumber: streamNumber });
  const streamKind = issueKind(streamCtx.issue.title);
  if (streamKind !== 'stream')
    throw new Error(`--stream #${streamNumber} is a ${streamKind} tracker, not a [Stream] container`);
  if (String(streamCtx.issue.state).toUpperCase() !== 'OPEN')
    throw new Error(`--stream #${streamNumber} is not open; start work inside an open [Stream] container`);
  if (!streamCtx.item) throw new Error(`DoR: stream #${streamNumber} is not on project #${config.project.number}`);
  const streamValue = streamCtx.item[profile.streamField.toLowerCase()];
  if (!streamValue)
    throw new Error(
      `DoR: stream #${streamNumber} project field ${profile.streamField} is empty; set the per-delivery Stream option first`,
    );
  const children = await github.listSubIssues(repoOwner, repoName, streamNumber);
  const childNumbers = (children || []).map((child) => child.number ?? child);
  if (!childNumbers.includes(issue.number))
    throw new Error(
      `DoR: task #${issue.number} is not a sub-issue of stream #${streamNumber}; link it under the [Stream] container first`,
    );
  const taskValue = item[profile.streamField.toLowerCase()];
  if (taskValue && taskValue !== streamValue)
    throw new Error(
      `DoR: task ${profile.streamField} field ${JSON.stringify(taskValue)} does not match stream #${streamNumber} (${JSON.stringify(streamValue)})`,
    );
  return streamCtx;
}

export async function checkDoR({ config, github, issueNumber, owner, dryRun = false, stream = null }) {
  const profile = getWorkProfileAdapter(config);
  const ctx = await readContext({ config, github, issueNumber });
  const { issue, item } = ctx;
  const kind = issueKind(issue.title);
  if (kind !== 'task')
    throw new Error(
      `#${issueNumber} is a ${kind} tracker, not a task; use the ${profile.isTooling ? 'stream' : 'sprint/release'} lifecycle`,
    );
  if (String(issue.state).toUpperCase() !== 'OPEN') throw new Error(`#${issueNumber} is not open`);
  if (!issue.issueType?.name) throw new Error('DoR: issue has no native type');
  if (!item) throw new Error(`DoR: issue is not on project #${config.project.number}`);
  let streamCtx = null;
  if (profile.isTooling) {
    if (stream === null || stream === undefined)
      throw new UsageError('DoR: the tooling work profile requires --stream <issue|url> (the [Stream] container)');
    streamCtx = await validateStreamMembership({ config, github, issue, item, streamNumber: stream, profile });
  } else {
    if (stream !== null && stream !== undefined)
      throw new UsageError('--stream is only valid for workProfile "tooling"; the product profile uses Release/Sprint');
    if (!issue.milestone) throw new Error('DoR: issue has no milestone');
  }
  for (const fieldName of profile.taskFields) {
    if (!item[fieldName.toLowerCase()]) throw new Error(`DoR: project field ${fieldName} is empty`);
  }
  if (!hasAcceptance(issue.body)) throw new Error('DoR: issue has no "## Acceptance criteria" section');
  const deps = await github.issueDependencies(ctx.repoOwner, ctx.repoName, issueNumber);
  if ((deps?.blocked_by || 0) > 0) throw new Error(`DoR: issue is blocked by ${deps.blocked_by} dependency(ies)`);
  const wip = await checkWip({ ctx, owner, dryRun });
  return { ctx, kind, warning: wip, profile, stream: streamCtx };
}

function gitInfo({ repoRoot, branch, createBranch, dryRun, gitExec = null }) {
  const exec = gitExec || ((args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim());
  if (createBranch && !dryRun) {
    exec(['switch', '-c', branch]);
  }
  try {
    return {
      branch: branch || exec(['rev-parse', '--abbrev-ref', 'HEAD']),
      head: exec(['rev-parse', '--short', 'HEAD']),
    };
  } catch {
    return { branch: branch || '(unknown)', head: '(unknown)' };
  }
}

export async function startTask({
  config,
  github,
  issueNumber,
  owner,
  executor,
  branch,
  stream = null,
  dryRun = false,
  repoRoot = process.cwd(),
  gitExec = null,
  allowDirty = false,
  dirtyReason = '',
  preflightStatus = null,
}) {
  const status = preflightStatus ?? (gitExec ? '' : gitStatus(repoRoot));
  const preflight = evaluateCleanTree({ statusText: status, allowDirty, reason: dirtyReason });
  if (!preflight.ok) throw new UsageError(`preflight: ${preflight.violations.join('; ')}`);
  let hooksWarning = '';
  try {
    if (!gitExec) {
      const hooksPath = execFileSync('git', ['config', 'core.hooksPath'], { cwd: repoRoot, encoding: 'utf8' }).trim();
      if (hooksPath !== '.githooks') hooksWarning = 'git hooks not installed; run npm run hooks:install';
    }
  } catch {
    hooksWarning = 'git hooks not installed; run npm run hooks:install';
  }
  const {
    ctx,
    warning,
    profile,
    stream: streamCtx,
  } = await checkDoR({
    config,
    github,
    issueNumber,
    owner,
    dryRun,
    stream,
  });
  const git = gitInfo({ repoRoot, branch, createBranch: Boolean(branch), dryRun, gitExec });
  const dorSummary = profile.isTooling
    ? 'type/stream/fields/acceptance/dependencies checked'
    : 'type/milestone/fields/acceptance/dependencies checked';
  const comment = [
    '### Check-in',
    '',
    `- **Owner:** ${owner}`,
    `- **Executor:** ${executor}`,
    `- **Branch:** \`${git.branch}\``,
    `- **Starting HEAD:** \`${git.head}\``,
    `- **Scope confirmed:** ${ctx.issue.title}`,
    ...(profile.isTooling
      ? [`- **Work profile:** ${profile.label}`, `- **Stream:** #${streamCtx.issue.number} — ${streamCtx.issue.title}`]
      : []),
    `- **DoR:** ${dorSummary}`,
    ...(allowDirty ? [`- **Dirty-worktree exception:** ${dirtyReason}`] : []),
    '- **Evidence planned:** attach at check-out',
    `- **Risks/blockers:** ${[warning, hooksWarning].filter(Boolean).join('; ') || 'none'}`,
    '',
    'Status → In Progress.',
  ].join('\n');
  if (!dryRun) {
    await github.addAssignee(ctx.repoOwner, ctx.repoName, issueNumber, owner);
    await setStatus(ctx, 'In Progress', false);
    await github.addComment(ctx.repoOwner, ctx.repoName, issueNumber, comment);
  }
  return {
    ok: true,
    dryRun,
    action: 'start',
    issue: issueNumber,
    owner,
    executor,
    branch: git.branch,
    head: git.head,
    profile: profile.name,
    stream: streamCtx ? streamCtx.issue.number : null,
    comment,
    ...(dryRun ? { plannedComment: comment } : {}),
  };
}

function messageFrom(args) {
  if (args['message-file']) {
    const file = path.resolve(args['message-file']);
    if (!fs.existsSync(file)) throw new UsageError(`message file not found: ${file}`);
    return fs.readFileSync(file, 'utf8');
  }
  if (!args.message) throw new UsageError('--message or --message-file is required');
  return args.message;
}

export async function checkpointTask({ config, github, issueNumber, message, dryRun = false }) {
  const ctx = await readContext({ config, github, issueNumber });
  const body = `### Update\n\n${message.trim()}\n`;
  if (!dryRun) await github.addComment(ctx.repoOwner, ctx.repoName, issueNumber, body);
  return { ok: true, dryRun, action: 'checkpoint', issue: issueNumber, comment: body };
}

export async function reviewTask({ config, github, issueNumber, pr, evidence, dryRun = false }) {
  const ctx = await readContext({ config, github, issueNumber });
  const body = [
    '### Review',
    '',
    `- **PR:** ${pr || 'not provided'}`,
    `- **Evidence:** ${evidence || 'attached in issue/PR'}`,
    '',
    'Status → In Review.',
  ].join('\n');
  if (!dryRun) {
    await setStatus(ctx, 'In Review', false);
    await github.addComment(ctx.repoOwner, ctx.repoName, issueNumber, body);
  }
  return { ok: true, dryRun, action: 'review', issue: issueNumber, comment: body };
}

export async function blockTask({ config, github, issueNumber, reason, blockedBy, dryRun = false }) {
  if (!reason) throw new UsageError('--reason is required for block');
  const ctx = await readContext({ config, github, issueNumber });
  const body = [
    '### Blocker',
    '',
    `- **Reason:** ${reason}`,
    `- **Blocked by:** ${blockedBy || 'not linked'}`,
    '- **Unblock condition:** resolve the blocker and run unblock/start again',
    '',
    'Status → Blocked.',
  ].join('\n');
  if (!dryRun) {
    await setStatus(ctx, 'Blocked', false);
    if (blockedBy) await github.addBlockedBy(ctx.repoOwner, ctx.repoName, issueNumber, blockedBy);
    await github.addComment(ctx.repoOwner, ctx.repoName, issueNumber, body);
  }
  return { ok: true, dryRun, action: 'block', issue: issueNumber, comment: body };
}

function isPullRequestRef(value) {
  const text = String(value || '').trim();
  return /^https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(text) || /^#?\d+$/.test(text);
}

function pullRequestNumber(value) {
  const text = String(value || '').trim();
  const match = /\/pull\/(\d+)\/?$/.exec(text) || /^#?(\d+)$/.exec(text);
  return match ? Number(match[1]) : null;
}

export async function doneTask({ config, github, issueNumber, evidence, pr, force = false, dryRun = false }) {
  const profile = getWorkProfileAdapter(config);
  if (!evidence) throw new UsageError('--evidence or --evidence-file is required for done');
  if (doneRequiresPr(profile)) {
    if (!pr)
      throw new UsageError('--pr is required for done in the tooling work profile (link the PR with its evidence)');
    if (!isPullRequestRef(pr)) throw new UsageError('--pr must be a pull request URL or number');
  }
  const ctx = await readContext({ config, github, issueNumber });
  if (String(ctx.issue.state).toUpperCase() !== 'OPEN' && !doneRequiresPr(profile))
    throw new Error(`#${issueNumber} is not open`);
  const unchecked = uncheckedAcceptance(ctx.issue.body);
  if (unchecked.length && !force)
    throw new Error(
      `DoD: ${unchecked.length} unchecked acceptance criterion(ia); check them or use --force after review`,
    );

  if (doneRequiresPr(profile)) {
    const number = pullRequestNumber(pr);
    if (!number) throw new UsageError('--pr must be a pull request URL or number');
    const pull = await github.getPullRequest(ctx.repoOwner, ctx.repoName, number);
    if (!pull) throw new Error(`PR #${number} not found`);
    if (String(pull.state).toUpperCase() !== 'MERGED')
      throw new Error(`DoD: PR #${number} is not merged; merge it before task done`);
    const closing = (pull.closingIssuesReferences || []).map((entry) => Number(entry.number ?? entry));
    if (!closing.includes(issueNumber))
      throw new Error(`DoD: PR #${number} does not close #${issueNumber}; add Closes #${issueNumber} to the PR body`);
  }
  const body = [
    '### Check-out',
    '',
    '- **Acceptance criteria:** checked',
    ...(profile.isTooling
      ? [
          `- **Work profile:** ${profile.label}`,
          `- **Stream:** ${ctx.item?.[profile.streamField.toLowerCase()] || '(not set)'}`,
        ]
      : []),
    `- **PR:** ${pr || 'not provided'}`,
    `- **Evidence:** ${evidence}`,
    '- **Deviations:** none',
    '',
    'Status → Done; issue closed.',
  ].join('\n');
  if (!dryRun) {
    await setStatus(ctx, 'Done', false);
    if (String(ctx.issue.state).toUpperCase() === 'OPEN')
      await github.closeIssue(ctx.repoOwner, ctx.repoName, issueNumber);
    await github.addComment(ctx.repoOwner, ctx.repoName, issueNumber, body);
  }
  return { ok: true, dryRun, action: 'done', issue: issueNumber, profile: profile.name, comment: body };
}

export async function statusTask({ config, github, issueNumber }) {
  const profile = getWorkProfileAdapter(config);
  const ctx = await readContext({ config, github, issueNumber });
  return {
    ok: true,
    action: 'status',
    issue: issueNumber,
    title: ctx.issue.title,
    state: ctx.issue.state,
    workProfile: profile.name,
    assignees: assigneeLogins(ctx.issue),
    status: ctx.item?.status || null,
    fields: ctx.item
      ? {
          release: ctx.item.release || null,
          sprint: ctx.item.sprint || null,
          ...(profile.isTooling || ctx.item.stream ? { stream: ctx.item.stream || null } : {}),
          area: ctx.item.area || null,
          kind: ctx.item.kind || null,
          estimate: ctx.item.estimate || null,
          source: ctx.item.source || null,
        }
      : null,
  };
}

function usage() {
  return [
    'Usage: node scripts/adopt/cli/task.mjs <command> --issue N [--config tracker.config.json] [--dry-run] [--json]',
    '',
    'Commands:',
    '  start       --issue N [--owner LOGIN] [--executor TEXT] [--branch NAME]',
    '              [--stream ISSUE|URL]   (required in the tooling work profile)',
    '  checkpoint  --issue N (--message TEXT | --message-file FILE)',
    '  review      --issue N [--pr URL] [--evidence TEXT]',
    '  block       --issue N --reason TEXT [--blocked-by URL]',
    '  done        --issue N (--evidence TEXT | --evidence-file FILE) [--pr URL] [--force]',
    '  status      --issue N',
    '',
    'Work profile comes from tracker.config.json: "product" (default; Release/Sprint fields) or',
    '"tooling" ([Stream] container + Stream field; done requires --pr).',
    '',
    'Default: mutations enabled. --dry-run performs read-only validation and prints the planned result.',
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
      const args = parseArgs(raw.slice(1), {
        flags: ['dry-run', 'json', 'force', 'help', 'allow-dirty'],
        options: [
          'config',
          'issue',
          'owner',
          'executor',
          'branch',
          'stream',
          'message',
          'message-file',
          'pr',
          'evidence',
          'evidence-file',
          'reason',
          'blocked-by',
          'dirty-reason',
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
      const issueNumber = Number(args.issue);
      if (!Number.isInteger(issueNumber) || issueNumber <= 0)
        throw new UsageError('--issue is required and must be a positive integer');
      const owner = args.owner || config.automation?.defaultAssignee || '@me';
      const executor = args.executor || process.env.TRACKER_EXECUTOR || 'agent:session';
      const dryRun = Boolean(args['dry-run']);
      if (args.stream && command !== 'start') throw new UsageError('--stream is only valid for the start command');
      const stream = args.stream ? parseIssueRef(args.stream, '--stream') : null;
      const github = createGitHub();
      let result;
      if (command === 'start')
        result = await startTask({
          config,
          github,
          issueNumber,
          owner,
          executor,
          branch: args.branch,
          stream,
          dryRun,
          allowDirty: Boolean(args['allow-dirty']),
          dirtyReason: args['dirty-reason'],
        });
      else if (command === 'checkpoint')
        result = await checkpointTask({ config, github, issueNumber, message: messageFrom(args), dryRun });
      else if (command === 'review')
        result = await reviewTask({ config, github, issueNumber, pr: args.pr, evidence: args.evidence, dryRun });
      else if (command === 'block')
        result = await blockTask({
          config,
          github,
          issueNumber,
          reason: args.reason,
          blockedBy: args['blocked-by'],
          dryRun,
        });
      else if (command === 'done') {
        const evidence = args['evidence-file']
          ? fs.readFileSync(path.resolve(args['evidence-file']), 'utf8')
          : args.evidence;
        result = await doneTask({
          config,
          github,
          issueNumber,
          evidence,
          pr: args.pr,
          force: Boolean(args.force),
          dryRun,
        });
      } else if (command === 'status') result = await statusTask({ config, github, issueNumber });
      else throw new UsageError(`unknown command: ${command}`);
      if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else if (result.action === 'status') {
        console.log(
          `status #${issueNumber}: ${result.state}; project status=${result.status || '(not on project)'}; assignee=${result.assignees?.join(', ') || '(none)'}`,
        );
        if (result.fields) console.log(`fields: ${JSON.stringify(result.fields)}`);
      } else {
        console.log(`${result.action} #${issueNumber}: ${dryRun ? 'DRY-RUN (no mutations)' : 'applied'}`);
        if (result.comment) console.log(`\n${result.comment}`);
        if (result.warning) console.log(`warning: ${result.warning}`);
      }
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    }
  })();
}
