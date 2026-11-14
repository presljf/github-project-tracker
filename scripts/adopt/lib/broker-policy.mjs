/**
 * Broker policy contract (P0.1).
 *
 * One server instance owns one repo/project and one policy. The policy is explicit, rejects
 * unknown fields (a typo must fail closed rather than silently widen authority), and carries the
 * tier, tool allowlist, task scope, limits, path rules, approval mode, and TTLs used by grants.
 */

export const TIERS = Object.freeze(['read', 'proposal', 'delivery', 'admin']);
export const APPROVAL_MODES = Object.freeze(['none', 'policy', 'human', 'async']);
export const LIMIT_KEYS = Object.freeze(['maxWritesPerRun', 'callsPerHour', 'maxGraphqlPoints']);
export const TTL_KEYS = Object.freeze(['grantMinutes', 'leaseMinutes']);
export const TOP_LEVEL_KEYS = Object.freeze([
  'tier',
  'repo',
  'project',
  'tools',
  'tasks',
  'limits',
  'paths',
  'approval',
  'ttl',
]);

export const DEFAULT_LIMITS = Object.freeze({ maxWritesPerRun: 1, callsPerHour: 60, maxGraphqlPoints: 500 });
export const DEFAULT_TTL_MINUTES = Object.freeze({ grantMinutes: 240, leaseMinutes: 30 });

/** Template defaults; a usable policy must still name its repo/project. */
export const DEFAULT_POLICY = Object.freeze({
  tier: 'read',
  repo: '',
  project: 0,
  tools: Object.freeze([]),
  tasks: Object.freeze([]),
  limits: DEFAULT_LIMITS,
  paths: Object.freeze({ allow: Object.freeze([]), deny: Object.freeze([]) }),
  approval: 'human',
  ttl: DEFAULT_TTL_MINUTES,
});

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unknownKeys(value, allowed, label, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${label}.${key} is not a known field`);
  }
}

function stringList(value, label, errors, { required = false } = {}) {
  if (value === undefined) {
    if (required) errors.push(`${label} is required`);
    return [];
  }
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array of strings`);
    return [];
  }
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) errors.push(`${label} must contain non-empty strings`);
    else if (seen.has(item)) errors.push(`${label} contains duplicate ${JSON.stringify(item)}`);
    else seen.add(item);
  }
  return value;
}

function positiveIntList(value, label, errors) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array of positive integers`);
    return [];
  }
  const seen = new Set();
  for (const item of value) {
    if (!Number.isInteger(item) || item <= 0) errors.push(`${label} must contain positive integers`);
    else if (seen.has(item)) errors.push(`${label} contains duplicate ${item}`);
    else seen.add(item);
  }
  return value;
}

/** Validate a policy object; returns an array of human-readable errors (empty means valid). */
export function validatePolicy(policy = {}) {
  const errors = [];
  if (!isPlainObject(policy)) return ['policy must be an object'];
  unknownKeys(policy, TOP_LEVEL_KEYS, 'policy', errors);

  if (!TIERS.includes(policy.tier)) errors.push(`policy.tier must be one of ${TIERS.join(', ')}`);
  if (typeof policy.repo !== 'string' || !REPO_PATTERN.test(policy.repo)) {
    errors.push('policy.repo must be owner/repository');
  }
  if (!Number.isInteger(policy.project) || policy.project <= 0) {
    errors.push('policy.project must be a positive integer');
  }
  if (policy.tools === undefined) errors.push('policy.tools is required');
  else if (!Array.isArray(policy.tools) || policy.tools.length === 0) {
    errors.push('policy.tools must be a non-empty array of strings');
  } else stringList(policy.tools, 'policy.tools', errors);
  positiveIntList(policy.tasks, 'policy.tasks', errors);

  if (policy.limits !== undefined) {
    if (!isPlainObject(policy.limits)) errors.push('policy.limits must be an object');
    else {
      unknownKeys(policy.limits, LIMIT_KEYS, 'policy.limits', errors);
      for (const key of LIMIT_KEYS) {
        const value = policy.limits[key];
        if (value === undefined) continue;
        if (!Number.isInteger(value) || value < 0) errors.push(`policy.limits.${key} must be a non-negative integer`);
      }
    }
  }

  if (policy.paths !== undefined) {
    if (!isPlainObject(policy.paths)) errors.push('policy.paths must be an object');
    else {
      unknownKeys(policy.paths, ['allow', 'deny'], 'policy.paths', errors);
      stringList(policy.paths.allow, 'policy.paths.allow', errors);
      stringList(policy.paths.deny, 'policy.paths.deny', errors);
    }
  }

  if (policy.approval !== undefined && !APPROVAL_MODES.includes(policy.approval)) {
    errors.push(`policy.approval must be one of ${APPROVAL_MODES.join(', ')}`);
  }

  if (policy.ttl !== undefined) {
    if (!isPlainObject(policy.ttl)) errors.push('policy.ttl must be an object');
    else {
      unknownKeys(policy.ttl, TTL_KEYS, 'policy.ttl', errors);
      for (const key of TTL_KEYS) {
        const value = policy.ttl[key];
        if (value === undefined) continue;
        if (!Number.isInteger(value) || value <= 0) errors.push(`policy.ttl.${key} must be a positive integer`);
      }
    }
  }

  return errors;
}

export function assertPolicy(policy = {}) {
  const errors = validatePolicy(policy);
  if (errors.length) throw new Error(`invalid broker policy:\n- ${errors.join('\n- ')}`);
  return policy;
}

function mergePolicy(policy) {
  const paths = { allow: [...(policy.paths?.allow || [])], deny: [...(policy.paths?.deny || [])] };
  return Object.freeze({
    tier: policy.tier,
    repo: policy.repo,
    project: policy.project,
    tools: Object.freeze([...new Set(policy.tools)]),
    tasks: Object.freeze([...new Set(policy.tasks || [])]),
    limits: Object.freeze({ ...DEFAULT_LIMITS, ...(policy.limits || {}) }),
    paths: Object.freeze({ allow: Object.freeze(paths.allow), deny: Object.freeze(paths.deny) }),
    approval: policy.approval ?? DEFAULT_POLICY.approval,
    ttl: Object.freeze({ ...DEFAULT_TTL_MINUTES, ...(policy.ttl || {}) }),
  });
}

/** Validate then fill optional defaults; the result is frozen. */
export function loadPolicy(policy = {}) {
  assertPolicy(policy);
  return mergePolicy(policy);
}

/** Fail-closed tool check: an empty allowlist admits nothing. */
export function toolAllowed(policy, tool) {
  return Array.isArray(policy.tools) && policy.tools.includes(String(tool));
}

export function assertToolAllowed(policy, tool) {
  if (!toolAllowed(policy, tool)) throw new Error(`tool ${JSON.stringify(tool)} is not in the policy allowlist`);
}

function normalizePathForPolicy(candidate) {
  return String(candidate || '')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

/** Deny prefixes win; an empty allow list admits nothing (fail closed). */
export function pathAllowed(policy, candidate) {
  const target = normalizePathForPolicy(candidate);
  if (!target) return false;
  const deny = policy.paths?.deny || [];
  if (
    deny.some(
      (prefix) => target === normalizePathForPolicy(prefix) || target.startsWith(`${normalizePathForPolicy(prefix)}/`),
    )
  ) {
    return false;
  }
  const allow = policy.paths?.allow || [];
  return allow.some((prefix) => {
    const base = normalizePathForPolicy(prefix);
    return Boolean(base) && (target === base || target.startsWith(`${base}/`));
  });
}
