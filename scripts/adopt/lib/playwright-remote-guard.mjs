/**
 * Playwright `globalSetup` factory for the remote-only verification policy.
 *
 * Dependency-free by design: this module imports no `@playwright/test` types so adopters can wire
 * it from their own framework config. Use it before any browser/window is created:
 *
 * ```js
 * // tests/global-setup.mjs (adopter file, default-exported as the Playwright globalSetup)
 * import { createPlaywrightRemoteGuard } from '../scripts/adopt/lib/playwright-remote-guard.mjs';
 * export default createPlaywrightRemoteGuard({
 *   suite: 'desktop-smoke',
 *   hidden: process.env.CASTDECK_HIDDEN_GUI === '1', // the adopter's documented hidden-mode flag
 * });
 * ```
 *
 * Behaviour: remote runner (`GITHUB_ACTIONS === 'true'`) allows; hidden local mode (when the suite
 * declares `localMode: "hidden"` and the caller passes `hidden: true`) allows; the suite override
 * env allows with a loud warning; otherwise globalSetup throws with actionable instructions, so the
 * visible local run fails before spawning windows. Absent `verification.remoteOnly` config is a no-op.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GUARD_STATUS, evaluateRemoteOnlyPolicy, formatGuardInstructions } from './verification-policy.mjs';

function loadConfig({ config, configPath }) {
  if (config !== undefined && config !== null) return config;
  const file = path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`remote-only guard: cannot parse tracker config ${file}: ${err.message}`, { cause: err });
  }
}

/**
 * Returns an async Playwright `globalSetup` function (suitable as a module default export).
 *
 * @param {object} options
 * @param {string} options.suite - suite id declared in `verification.remoteOnly`
 * @param {object} [options.config] - inline tracker config (skips filesystem lookup)
 * @param {string} [options.configPath] - config path relative to `process.cwd()` (default tracker.config.json)
 * @param {boolean} [options.hidden] - adopter's documented hidden-local-mode flag
 * @param {object} [options.env] - environment map (defaults to `process.env`)
 * @param {(message: string) => void} [options.warn] - warning sink (defaults to `console.warn`)
 */
export function createPlaywrightRemoteGuard({
  suite,
  config = null,
  configPath = 'tracker.config.json',
  hidden = false,
  env = process.env,
  warn = (message) => console.warn(message),
} = {}) {
  if (!suite || !String(suite).trim()) {
    throw new Error('createPlaywrightRemoteGuard: suite id is required (e.g. "desktop-smoke")');
  }
  return async function remoteOnlyGlobalSetup() {
    const resolvedConfig = loadConfig({ config, configPath });
    if (!resolvedConfig) return { status: GUARD_STATUS.NO_POLICY, suite };
    const result = evaluateRemoteOnlyPolicy({
      config: resolvedConfig,
      suiteId: suite,
      mode: 'enforce',
      hidden: Boolean(hidden),
      env,
    });
    if (result.ok) {
      if (result.warning) warn(`WARNING: ${result.warning}`);
      return { status: result.status, suite };
    }
    const error = new Error(`remote-only guard: ${formatGuardInstructions(result)}`);
    error.code = result.status;
    error.guard = result;
    throw error;
  };
}

export default createPlaywrightRemoteGuard;
