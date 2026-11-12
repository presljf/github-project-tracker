/**
 * Work-profile adapters: one enforcement engine, two selectable lifecycles.
 *
 * - `product` (default) — [Release] → [Sprint] → tasks; Release/Sprint project fields.
 * - `tooling` — [Stream] container → tasks; Stream project field; the tag (if any) is the
 *   version record.
 *
 * `config.workProfile` is optional; absent means `product`, so existing adopters keep the
 * current behaviour. The task CLI, stream CLI, and audit share these adapters instead of
 * forking DoR/WIP/evidence logic per profile.
 */
export const WORK_PROFILES = ['product', 'tooling'];
export const DEFAULT_WORK_PROFILE = 'product';
/** Fields every project item must carry, independent of profile. */
export const CORE_FIELDS = ['Area', 'Kind', 'Estimate'];

export function resolveWorkProfile(config = {}) {
  const name = config.workProfile === undefined ? DEFAULT_WORK_PROFILE : config.workProfile;
  if (!WORK_PROFILES.includes(name)) {
    throw new Error(
      `unknown workProfile ${JSON.stringify(name)}; expected ${WORK_PROFILES.map((profile) => JSON.stringify(profile)).join(' or ')}`,
    );
  }
  return name;
}

/** Project field name used for the delivery container; config-declared (`fields.Stream.name`). */
export function streamFieldName(config = {}) {
  return config.fields?.Stream?.name || 'Stream';
}

/** Build the profile adapter consumed by task.mjs, stream.mjs, audit.mjs, and bootstrap.mjs. */
export function getWorkProfileAdapter(config = {}) {
  const name = resolveWorkProfile(config);
  const tooling = name === 'tooling';
  const streamField = streamFieldName(config);
  return {
    name,
    isTooling: tooling,
    streamField,
    label: tooling ? 'tooling (Stream → Task)' : 'product (Release → Sprint → Task)',
    containerKinds: tooling ? ['stream'] : ['release', 'sprint'],
    taskFields: requiredItemFields({ isTooling: tooling, streamField }, 'task'),
  };
}

/** Project fields an item of `kind` must carry; used by DoR and the mode-aware audit. */
export function requiredItemFields(profile, kind) {
  const fields = [...CORE_FIELDS];
  if (profile.isTooling) {
    if (kind === 'stream' || kind === 'task') fields.push(profile.streamField);
    return fields;
  }
  if (kind !== 'roadmap') fields.push('Release');
  if (kind === 'sprint' || kind === 'task') fields.push('Sprint');
  return fields;
}

/** Audit violation code for an empty project field (stream field keeps a stable code). */
export function fieldMissingCode(profile, fieldName) {
  return fieldName === profile.streamField ? 'FIELD_STREAM_MISSING' : `FIELD_${fieldName.toUpperCase()}_MISSING`;
}

/** Ancestors an open task must have; used by the mode-aware audit. */
export function taskAncestryRequirements(profile) {
  return profile.isTooling
    ? [{ kind: 'stream', code: 'TASK_HIERARCHY_MISSING_STREAM', noun: 'stream' }]
    : [
        { kind: 'release', code: 'TASK_HIERARCHY_MISSING_RELEASE', noun: 'release' },
        { kind: 'sprint', code: 'TASK_HIERARCHY_MISSING_SPRINT', noun: 'sprint' },
      ];
}

/** Milestone requirement per profile (tooling deliveries are versioned by the tag). */
export function requiresMilestone(profile, kind) {
  return profile.isTooling ? false : kind !== 'roadmap';
}

/** Close evidence requirement per profile. */
export function closedEvidenceRules(profile) {
  if (profile.isTooling) {
    return [
      {
        kinds: ['stream'],
        code: 'STREAM_EXIT_EVIDENCE_MISSING',
        message: 'closed stream has no "### Stream close evidence" comment',
        pattern: /###\s*Stream close evidence/i,
      },
      {
        kinds: ['task'],
        code: 'TASK_CHECKOUT_EVIDENCE_MISSING',
        message: 'closed tooling task has no "### Check-out" evidence comment',
        pattern: /###\s*Check-?out/i,
      },
    ];
  }
  return [
    {
      kinds: ['sprint'],
      code: 'SPRINT_EXIT_EVIDENCE_MISSING',
      message: 'closed sprint has no demo/exit evidence comment',
      pattern: /###\s*Sprint (demo|close|exit)|Status\s*→\s*Done/i,
    },
    {
      kinds: ['release'],
      code: 'RELEASE_EXIT_EVIDENCE_MISSING',
      message: 'closed release has no close evidence comment',
      pattern: /###\s*Release close/i,
    },
  ];
}

/** `task.mjs done` requires an attached PR in the tooling profile. */
export function doneRequiresPr(profile) {
  return profile.isTooling;
}
