#!/usr/bin/env node
/** Print the current GitHub budget and shared command cost report. */
import { createGitHub } from './lib/github.mjs';
try {
  const gh = createGitHub();
  const status = gh.rateLimitStatus();
  const report = gh.rateState?.report?.();
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ status, report }, null, 2) + '\n');
  } else {
    console.log(
      `GitHub ${status.resource} budget: ${status.remaining}/${status.limit} remaining, ${status.used} used; resets ${status.resetAt}`,
    );
    if (report) {
      console.log(`Shared state: ${report.path}`);
      for (const row of report.topCommands) console.log(`  ${row.command}: ${row.cost} estimated points`);
    }
    if (status.remaining <= 0) console.error('Budget exhausted; wait for reset before mutating.');
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
