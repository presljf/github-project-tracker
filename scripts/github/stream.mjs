#!/usr/bin/env node
/**
 * Stream lifecycle CLI for the tooling work profile: `open` and `close` `[Stream]` containers.
 *
 * One sprint ≡ one release ≡ one Stream; the tag (if any) is the version record. `close` refuses
 * while child tasks are open, requires release-gate checks green, and records
 * `### Stream close evidence` (optionally recording the tag name; tag creation stays with the
 * release flow). The product profile keeps using the Release → Sprint lifecycle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './validate-config.mjs';
import { issueKind } from './audit.mjs';
import { createGitHub } from './lib/github.mjs';
import { parseArgs, parseIssueRef, UsageError } from './lib/cli.mjs';
import { getWorkProfileAdapter } from './lib/work-profile.mjs';
import { ensureSingleSelectOption } from './project-field-option.mjs';

export const DEFAULT_GATE_COMMAND = 'node scripts/github/release-gate.mjs';

export function streamTitle(name, delivery) {
  return `[Stream] ${name} — ${delivery}`;
}

export function streamNameFromTitle(title = '') {
  const match = /^\[Stream\]\s*(.+?)\s+—\s+/.exec(String(title));
  return match ? match[1].trim() : String(title).trim();
}

export function streamIssueBody({ name, delivery }) {
  return [
    `# Stream ${name} — ${delivery}`,
    '',
    `**Delivery:** ${delivery}  •  **Version record:** tag (if any)`,
    '',
    '## Stream objective',
    '',
    '- Fill the unversioned delivery outcome for this stream.',
    '',
    '## Scope / tasks',
    '',
    '- [ ] Add tasks as sub-issues; each task carries the `Stream` field and passes tooling DoR.',
    '',
    '## Exit criteria / close gate',
    '',
    '- [ ] All child tasks Done (task.mjs done requires PR + evidence)',
    '- [ ] Release-gate checks green',
    '- [ ] `stream.mjs close` records `### Stream close evidence`',
    '',
  ].join('\n');
}

function requireTooling(config) {
  const profile = getWorkProfileAdapter(config);
  if (!profile.isTooling) {
    throw new UsageError(
      'the stream lifecycle requires workProfile "tooling"; the product profile (default) uses Release → Sprint → task.mjs',
    );
  }
  return profile;
}

function projectContext(config) {
  if (!config.project?.number) throw new UsageError('config.project.number is required');
  const [repoOwner, repoName] = String(config.repository || '').split('/');
  if (!repoOwner || !repoName) throw new UsageError('config.repository must be owner/name');
  return { repoOwner, repoName, projectOwner: config.project.owner || repoOwner, projectNumber: config.project.number };
}

function optionName(fields, fieldName, preferred) {
  const field = (fields || []).find((entry) => entry.name === fieldName);
  if (!field?.options?.length) return null;
  return field.options.find((entry) => entry.name === preferred)?.name || field.options[0].name;
}

async function projectIdFor(github, projectOwner, projectNumber) {
  const projects = await github.listProjects(projectOwner);
  return (projects || []).find((project) => project.number === projectNumber)?.id || null;
}

async function setItemField({ github, fields, projectId, itemId, fieldName, value }) {
  if (!projectId || !itemId || !value) return false;
  const field = (fields || []).find((entry) => entry.name === fieldName);
  const option = field?.options?.find((entry) => entry.name === value);
  if (!field || !option) return false;
  await github.setProjectItemField(projectId, itemId, field.id, option.id);
  return true;
}

function tail(text, lines = 6) {
  const rows = String(text || '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  return rows.slice(-lines).join('\n');
}

export function runReleaseGate({ command, config, repoRoot = process.cwd(), timeoutMs = 600000 }) {
  const resolved = command || `${DEFAULT_GATE_COMMAND} --repo ${config.repository}`;
  try {
    const output = execFileSync('bash', ['-c', resolved], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });
    return { ok: true, command: resolved, output: String(output || '').trim() };
  } catch (err) {
    return {
      ok: false,
      command: resolved,
      exitCode: err.status ?? 1,
      output: `${err.stdout || ''}${err.stderr || ''}`.trim(),
    };
  }
}

export async function openStream({
  config,
  github,
  name,
  delivery,
  owner = null,
  area = null,
  kind = null,
  estimate = null,
  color = 'BLUE',
  dryRun = false,
}) {
  const profile = requireTooling(config);
  const { repoOwner, repoName, projectOwner, projectNumber } = projectContext(config);
  if (!name || !String(name).trim()) throw new UsageError('--name is required (delivery/version key, e.g. v1.3.1)');
  if (!delivery || !String(delivery).trim())
    throw new UsageError('--delivery is required (short delivery description)');
  const streamName = String(name).trim();
  const deliveryText = String(delivery).trim();
  const title = streamTitle(streamName, deliveryText);
  const fields = await github.listFields(projectOwner, projectNumber);
  const existing = await github.findIssue(repoOwner, repoName, title);
  if (existing && String(existing.state).toUpperCase() === 'CLOSED') {
    throw new Error(
      `[Stream] ${streamName} — ${deliveryText} already exists as #${existing.number} and is closed; use a new delivery name`,
    );
  }
  const option = await ensureSingleSelectOption({
    runner: github,
    owner: projectOwner,
    projectNumber,
    fieldName: profile.streamField,
    optionName: streamName,
    color,
    description: deliveryText,
    dryRun,
  });
  const plannedFields = {
    Status: 'Todo',
    [profile.streamField]: streamName,
    Area: area || optionName(fields, 'Area'),
    Kind: kind || optionName(fields, 'Kind'),
    Estimate: estimate || optionName(fields, 'Estimate', 'M'),
  };
  if (dryRun) {
    return {
      ok: true,
      dryRun,
      planned: true,
      action: 'open',
      profile: profile.name,
      title,
      stream: streamName,
      existingIssue: existing ? existing.number : null,
      option: option.added ? { planned: true } : { existing: true },
      fields: plannedFields,
    };
  }
  const warnings = [];
  let issue = existing;
  let created = false;
  if (!issue) {
    issue = await github.createIssue(repoOwner, repoName, {
      title,
      body: streamIssueBody({ name: streamName, delivery: deliveryText }),
    });
    created = true;
    try {
      await github.setIssueType(repoOwner, repoName, issue.number, config.issueTypes?.task || 'Task');
    } catch (err) {
      warnings.push(`issue type: ${err.message}`);
    }
  }
  const updatedFields = await github.listFields(projectOwner, projectNumber);
  const items = await github.listProjectItems(projectOwner, projectNumber);
  let item = (items || []).find((entry) => entry.content?.number === issue.number);
  if (!item) item = await github.addProjectItem(projectOwner, projectNumber, issue.url);
  const projectId = await projectIdFor(github, projectOwner, projectNumber);
  const setFields = [];
  for (const [fieldName, value] of Object.entries(plannedFields)) {
    if (!value) continue;
    if (await setItemField({ github, fields: updatedFields, projectId, itemId: item.id, fieldName, value }))
      setFields.push(`${fieldName}=${value}`);
  }
  if (owner && typeof github.addAssignee === 'function') {
    await github.addAssignee(repoOwner, repoName, issue.number, owner);
  }
  const comment = [
    '### Stream opened',
    '',
    `- **Stream:** ${title}`,
    `- **Work profile:** ${profile.label}`,
    `- **Per-delivery option:** ${profile.streamField}=${streamName}`,
    `- **Fields:** ${setFields.join('; ') || 'none applied'}`,
    '- **Next:** add tasks as sub-issues with the same Stream field; start them with',
    `  \`task.mjs start --stream ${issue.number}\`.`,
  ].join('\n');
  await github.addComment(repoOwner, repoName, issue.number, comment);
  return {
    ok: true,
    dryRun,
    action: 'open',
    profile: profile.name,
    issue: issue.number,
    title,
    stream: streamName,
    created,
    option,
    comment,
    ...(warnings.length ? { warnings } : {}),
  };
}

export async function closeStream({
  config,
  github,
  stream,
  evidence,
  tag = null,
  dryRun = false,
  repoRoot = process.cwd(),
  gateRunner = null,
  gateCommand = null,
  gateTimeoutMs = 600000,
}) {
  const profile = requireTooling(config);
  if (!evidence || !String(evidence).trim())
    throw new UsageError('--evidence or --evidence-file is required for stream close');
  const { repoOwner, repoName, projectOwner, projectNumber } = projectContext(config);
  const streamNumber = typeof stream === 'number' ? stream : parseIssueRef(stream, '--stream');
  const issue = await github.getIssueView(repoOwner, repoName, streamNumber);
  if (!issue) throw new Error(`stream #${streamNumber} not found`);
  if (issueKind(issue.title) !== 'stream') throw new Error(`#${streamNumber} is not a [Stream] container`);
  if (String(issue.state).toUpperCase() !== 'OPEN') throw new Error(`stream #${streamNumber} is not open`);
  const children = await github.listSubIssues(repoOwner, repoName, streamNumber);
  const childNumbers = (children || []).map((child) => child.number ?? child);
  const openChildren = (children || [])
    .filter((child) => String(child.state || 'OPEN').toUpperCase() === 'OPEN')
    .map((child) => child.number ?? child);
  if (openChildren.length) {
    throw new Error(
      `stream close blocked: #${streamNumber} has open child task(s) ${openChildren.map((number) => `#${number}`).join(', ')}; finish them with task.mjs done first`,
    );
  }
  let recordedTag = null;
  if (tag) {
    const pattern = config.automation?.tagPattern ? new RegExp(config.automation.tagPattern) : /^v\d+\.\d+\.\d+$/;
    if (!pattern.test(String(tag).trim()))
      throw new Error(`--tag ${JSON.stringify(tag)} does not match tagPattern ${pattern}`);
    recordedTag = String(tag).trim();
  }
  let gate;
  if (gateRunner) gate = await gateRunner({ config, repoRoot, streamNumber });
  else if (dryRun)
    gate = { ok: true, skipped: true, command: gateCommand || `${DEFAULT_GATE_COMMAND} --repo ${config.repository}` };
  else gate = runReleaseGate({ command: gateCommand, config, repoRoot, timeoutMs: gateTimeoutMs });
  if (!gate.ok) {
    const detail = tail(gate.output);
    throw new Error(
      `stream close blocked: release-gate checks are not green (${gate.command || 'gate'} exited ${gate.exitCode ?? 1})${detail ? `\n${detail}` : ''}`,
    );
  }
  const childList = childNumbers.length ? childNumbers.map((number) => `#${number}`).join(', ') : '(none)';
  const comment = [
    '### Stream close evidence',
    '',
    `- **Stream:** #${streamNumber} ${issue.title}`,
    `- **Delivery:** ${streamNameFromTitle(issue.title)}`,
    `- **Child tasks:** ${childNumbers.length} closed${childNumbers.length ? ` (${childList})` : ''}`,
    `- **Release gate:** PASS — \`${gate.command || DEFAULT_GATE_COMMAND}\`${gate.skipped ? ' (dry-run)' : ''}`,
    `- **Tag:** ${recordedTag ? `\`${recordedTag}\` recorded; tag creation stays with the release flow` : 'not recorded'}`,
    `- **Evidence:** ${String(evidence).trim()}`,
    '',
    'Status → Done; stream closed.',
  ].join('\n');
  if (!dryRun) {
    const items = await github.listProjectItems(projectOwner, projectNumber);
    const item = (items || []).find((entry) => entry.content?.number === streamNumber);
    if (!item) throw new Error(`stream #${streamNumber} is not on project #${projectNumber}; cannot close`);
    const fields = await github.listFields(projectOwner, projectNumber);
    const projectId = await projectIdFor(github, projectOwner, projectNumber);
    await setItemField({ github, fields, projectId, itemId: item.id, fieldName: 'Status', value: 'Done' });
    await github.closeIssue(repoOwner, repoName, streamNumber);
    await github.addComment(repoOwner, repoName, streamNumber, comment);
  }
  return {
    ok: true,
    dryRun,
    action: 'close',
    profile: profile.name,
    stream: streamNumber,
    children: childNumbers,
    tag: recordedTag,
    gate: { ok: gate.ok, skipped: Boolean(gate.skipped), command: gate.command || null },
    comment,
  };
}

function usage() {
  return [
    'Usage: node scripts/github/stream.mjs <open|close> --config tracker.config.json [--dry-run] [--json]',
    '',
    'Tooling work profile only (config.workProfile = "tooling"): [Stream] container lifecycle.',
    '',
    'Commands:',
    '  open   --name NAME --delivery TEXT [--owner LOGIN] [--area A] [--kind K] [--estimate S|M|L]',
    '         [--color BLUE]',
    '  close  --stream ISSUE|URL (--evidence TEXT | --evidence-file FILE) [--tag vX.Y.Z]',
    '         [--gate-command "COMMAND"]',
    '',
    'open creates the [Stream] container, appends the per-delivery Stream option safely, adds it to',
    'the project with required fields, and records `### Stream opened`.',
    'close refuses while child tasks are open, requires the release gate green, records',
    '`### Stream close evidence`, sets Status Done, and closes the container.',
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
      const args = parseArgs(raw.slice(1), {
        flags: ['dry-run', 'json', 'help'],
        options: [
          'config',
          'name',
          'delivery',
          'stream',
          'owner',
          'area',
          'kind',
          'estimate',
          'color',
          'evidence',
          'evidence-file',
          'tag',
          'gate-command',
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
      const dryRun = Boolean(args['dry-run']);
      const github = createGitHub();
      let result;
      if (command === 'open') {
        result = await openStream({
          config,
          github,
          name: args.name,
          delivery: args.delivery,
          owner: args.owner || config.automation?.defaultAssignee || null,
          area: args.area,
          kind: args.kind,
          estimate: args.estimate,
          color: args.color || 'BLUE',
          dryRun,
        });
      } else if (command === 'close') {
        if (!args.stream) throw new UsageError('--stream is required for close (issue number, #number, or URL)');
        const evidence = args['evidence-file']
          ? fs.readFileSync(path.resolve(args['evidence-file']), 'utf8')
          : args.evidence;
        result = await closeStream({
          config,
          github,
          stream: parseIssueRef(args.stream, '--stream'),
          evidence,
          tag: args.tag || null,
          dryRun,
          gateCommand: args['gate-command'] || null,
        });
      } else {
        throw new UsageError(`unknown command: ${command}`);
      }
      if (args.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else if (result.planned) {
        console.log(
          `open stream ${JSON.stringify(result.title)}: DRY-RUN (no mutations); issue ${result.existingIssue ? `#${result.existingIssue} exists` : 'would be created'}`,
        );
        console.log(`fields: ${JSON.stringify(result.fields)}`);
      } else if (result.action === 'open') {
        console.log(
          `open stream: ${result.created ? 'created' : 'reused'} #${result.issue} ${result.title} (${result.profile})${dryRun ? ' [dry-run]' : ''}`,
        );
        if (result.comment) console.log(`\n${result.comment}`);
        for (const warning of result.warnings || []) console.log(`warning: ${warning}`);
      } else {
        console.log(`close stream #${result.stream}: ${dryRun ? 'DRY-RUN (no mutations)' : 'applied'}`);
        if (result.comment) console.log(`\n${result.comment}`);
      }
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    }
  })();
}
