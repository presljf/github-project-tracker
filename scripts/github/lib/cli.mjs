/**
 * Small shared helpers for tracker CLI scripts.
 */
export class UsageError extends Error {}

export function parseArgs(argv, spec) {
  const flags = new Set(spec.flags || []);
  const options = new Map((spec.options || []).map((name) => [name, true]));
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split('=', 2);
      if (flags.has(name)) {
        out[name] = true;
        continue;
      }
      if (options.has(name)) {
        const value = inline !== undefined ? inline : argv[i + 1];
        if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} requires a value`);
        out[name] = value;
        if (inline === undefined) i += 1;
        continue;
      }
      throw new UsageError(`unknown option --${name}`);
    }
    out._.push(arg);
  }
  return out;
}

/** Parse `#123`, `123`, or an issue URL into a positive issue number. */
export function parseIssueRef(value, flag = '--issue') {
  if (value === undefined || value === null || String(value).trim() === '') throw new UsageError(`${flag} is required`);
  const text = String(value).trim();
  const url = /^https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)\/?$/.exec(text);
  const number = url ? Number(url[1]) : Number(text.replace(/^#/, ''));
  if (!Number.isInteger(number) || number <= 0)
    throw new UsageError(`${flag} must be an issue number, #number, or issue URL (got ${JSON.stringify(text)})`);
  return number;
}

export function fail(message, code = 1) {
  console.error(`error: ${message}`);
  process.exitCode = code;
}

export function jsonOut(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function logPlan(actions) {
  for (const action of actions) console.log(action);
}
