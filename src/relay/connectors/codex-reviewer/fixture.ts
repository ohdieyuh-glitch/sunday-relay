import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Codex Reviewer live-review fixture (Prompt 8.3) — a throwaway deterministic
 * Git repository with a SEEDED behavioral defect for the independent reviewer
 * to catch. NO external dependencies, no package install, tiny source + tests.
 *
 * Mission requirement: provider dispatch must be blocked when EITHER the actor
 * is rate-limited OR the global spending breaker is active.
 * Seeded implementer change (the defect): dispatch is blocked only when BOTH
 * are true (`&&` instead of `||`). The included tests cover only neither-active
 * (allowed) and both-active (denied), so they PASS while leaving a real
 * behavioral + test-coverage gap — exactly what an independent Reviewer should
 * flag as a blocking finding. The Sunday repository is NEVER used for this.
 */

export const CLAIMED_FILE = 'src/dispatch.js';
export const TEST_FILE = 'test/dispatch.test.js';
export const RELAY_TEST_ARGS = ['--test', TEST_FILE];

/** Baseline stub (failing) committed as the clean baseline — the "both active
 * → denied" test fails against it, so the implementer change is meaningful. */
export const BASELINE_STUB = `// Provider dispatch guard (baseline stub — not yet implemented).
function isDispatchBlocked(rateLimited, spendingBreakerActive) {
  // TODO: block when either safety control is active.
  return false;
}
module.exports = { isDispatchBlocked };
`;

/** The seeded implementer change under review — the DEFECT (&& not ||). */
export const DEFECT_IMPLEMENTATION = `// Provider dispatch guard.
// Block provider dispatch when a safety control is active.
function isDispatchBlocked(rateLimited, spendingBreakerActive) {
  // BUG: only blocks when BOTH controls are active.
  return rateLimited && spendingBreakerActive;
}
module.exports = { isDispatchBlocked };
`;

/** The correct implementation (for documentation / a future repair — never
 * written by this phase). */
export const CORRECT_IMPLEMENTATION = `// Provider dispatch guard.
function isDispatchBlocked(rateLimited, spendingBreakerActive) {
  return rateLimited || spendingBreakerActive;
}
module.exports = { isDispatchBlocked };
`;

const TEST_SOURCE = `const test = require('node:test');
const assert = require('node:assert');
const { isDispatchBlocked } = require('../src/dispatch.js');

// Intentionally incomplete: covers only "neither" and "both".
test('neither condition active -> dispatch allowed', () => {
  assert.strictEqual(isDispatchBlocked(false, false), false);
});

test('both conditions active -> dispatch denied', () => {
  assert.strictEqual(isDispatchBlocked(true, true), true);
});
`;

export interface BuiltReviewFixture {
  fixtureRoot: string;
  sourceRepo: string;
  baselineRevision: string;
  claimedFile: string;
  protectedPaths: { forbidden: string[]; readOnly: string[] };
}

const FIXTURE_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'Relay Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@relay.local',
  GIT_COMMITTER_NAME: 'Relay Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@relay.local',
  GIT_TERMINAL_PROMPT: '0',
};

function fixtureGit(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    timeout: 15_000,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...FIXTURE_ENV },
  });
}

export function buildReviewDefectFixture(): BuiltReviewFixture {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'relay-codex-fixture-'));
  const sourceRepo = join(fixtureRoot, 'source');
  mkdirSync(join(sourceRepo, 'src'), { recursive: true });
  mkdirSync(join(sourceRepo, 'test'), { recursive: true });

  writeFileSync(join(sourceRepo, 'src', 'dispatch.js'), BASELINE_STUB, 'utf8');
  writeFileSync(join(sourceRepo, 'test', 'dispatch.test.js'), TEST_SOURCE, 'utf8');
  writeFileSync(
    join(sourceRepo, 'package.json'),
    `${JSON.stringify({ name: 'relay-dispatch-fixture', version: '1.0.0', private: true }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(join(sourceRepo, 'README.md'), '# Relay dispatch fixture\n\nThrowaway fixture — do not publish.\n', 'utf8');

  fixtureGit(['init', '-q', '-b', 'main'], sourceRepo);
  fixtureGit(['add', '.'], sourceRepo);
  fixtureGit(['commit', '-q', '-m', 'clean baseline (dispatch guard not yet implemented)'], sourceRepo);
  const baselineRevision = fixtureGit(['rev-parse', 'HEAD'], sourceRepo).trim();

  return {
    fixtureRoot,
    sourceRepo,
    baselineRevision,
    claimedFile: CLAIMED_FILE,
    protectedPaths: { forbidden: ['package.json', 'README.md'], readOnly: [] },
  };
}
