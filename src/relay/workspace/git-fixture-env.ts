import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Git environment for workspace tests and for one shipped caller,
 * `runWorkspaceVerification`. `runGit` forwards HOME only, so a developer
 * gitconfig is visible unless that HOME is an empty directory.
 *
 * `installHermeticGitHome` is the test-suite form: it stays in place for the
 * process. `withSerializedHermeticGitEnv` is the shipped form: it scopes the
 * same variables to one call and puts the previous values back.
 */

const HERMETIC_VALUES = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
} as const;

/** Process variables a hermetic git scope writes. Restoration covers each one. */
export const HERMETIC_GIT_ENV_KEYS = ['HOME', ...Object.keys(HERMETIC_VALUES)] as const;

let homeDir: string | null = null;

function emptyHome(): string {
  if (homeDir === null) homeDir = mkdtempSync(join(tmpdir(), 'relay-git-home-'));
  return homeDir;
}

export function hermeticGitEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: emptyHome(),
    ...HERMETIC_VALUES,
  };
  if (process.env.LANG !== undefined) env.LANG = process.env.LANG;
  if (process.env.TMPDIR !== undefined) env.TMPDIR = process.env.TMPDIR;
  return { ...env, ...extra };
}

export function captureGitProcessEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const key of HERMETIC_GIT_ENV_KEYS) snap[key] = process.env[key];
  return snap;
}

export function restoreGitProcessEnv(snap: Record<string, string | undefined>): void {
  for (const key of HERMETIC_GIT_ENV_KEYS) {
    const value = snap[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function applyHermeticHome(home: string): void {
  process.env.HOME = home;
  for (const [key, value] of Object.entries(HERMETIC_VALUES)) process.env[key] = value;
}

/** Test suites: point this process at an empty HOME for the rest of the process. */
export function installHermeticGitHome(): void {
  applyHermeticHome(emptyHome());
}

let serialized: Promise<void> = Promise.resolve();

/**
 * Shipped scope used by workspace verification.
 *
 * Sets HOME, GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM, GIT_CONFIG_NOSYSTEM, and
 * GIT_TERMINAL_PROMPT. The finally block writes back each previous value, or
 * deletes the variable when it was unset, and removes the temp HOME.
 *
 * Overlapping calls are serialized on one queue. They are not re-entrant: a
 * call must not start another call before it returns, or the inner call waits
 * for a finally that is waiting on the inner call. Each call captures the
 * environment at the moment it starts, which is the restored environment of
 * the call before it.
 */
export async function withSerializedHermeticGitEnv<T>(task: () => Promise<T>): Promise<T> {
  const run = serialized.then(async () => {
    const snap = captureGitProcessEnv();
    let home: string | undefined;
    try {
      home = mkdtempSync(join(tmpdir(), 'relay-git-home-'));
      applyHermeticHome(home);
      return await task();
    } finally {
      restoreGitProcessEnv(snap);
      if (home !== undefined) rmSync(home, { recursive: true, force: true });
    }
  });
  serialized = run.then(() => undefined, () => undefined);
  return run;
}
