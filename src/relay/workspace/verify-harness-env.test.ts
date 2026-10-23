import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { runWorkspaceVerification } from './verify-harness';

/**
 * `runWorkspaceVerification` is shipped code. It isolates the process git
 * environment for the run and must put that environment back, including
 * variables that were unset. Overlapping calls are serialized; they are not
 * re-entrant and must not observe each other's HOME.
 */

const GIT_ENV_KEYS = ['HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT'] as const;

type GitEnvSnap = Record<(typeof GIT_ENV_KEYS)[number], string | undefined>;

const snapGitEnv = (): GitEnvSnap => {
  const snap = {} as GitEnvSnap;
  for (const key of GIT_ENV_KEYS) snap[key] = process.env[key];
  return snap;
};

const restoreGitEnv = (snap: GitEnvSnap): void => {
  for (const key of GIT_ENV_KEYS) {
    const value = snap[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

const initial = snapGitEnv();

afterEach(() => {
  restoreGitEnv(initial);
});

type Hooks = { beforeChecks?: () => void };

const verify = (hooks?: Hooks) =>
  (runWorkspaceVerification as (hooks?: Hooks) => ReturnType<typeof runWorkspaceVerification>)(hooks);

describe('workspace verification restores the process git environment', () => {
  it('puts HOME and every git env var back after a real run, including vars that were unset', async () => {
    process.env.HOME = '/tmp/relay-verify-sentinel-home';
    process.env.GIT_CONFIG_GLOBAL = '/tmp/relay-verify-sentinel-global';
    process.env.GIT_CONFIG_SYSTEM = '/tmp/relay-verify-sentinel-system';
    delete process.env.GIT_CONFIG_NOSYSTEM;
    process.env.GIT_TERMINAL_PROMPT = '1';
    const before = snapGitEnv();

    const result = await verify();
    expect(result.failures).toBe(0);
    expect(snapGitEnv()).toEqual(before);
  }, 60_000);

  it('restores the process git environment when verification returns after an internal failure', async () => {
    process.env.HOME = '/tmp/relay-verify-sentinel-home';
    delete process.env.GIT_CONFIG_GLOBAL;
    delete process.env.GIT_CONFIG_SYSTEM;
    delete process.env.GIT_CONFIG_NOSYSTEM;
    delete process.env.GIT_TERMINAL_PROMPT;
    const before = snapGitEnv();
    const savedPath = process.env.PATH;
    process.env.PATH = '/tmp/relay-verify-missing-path';
    try {
      const result = await verify();
      expect(result.failures).toBeGreaterThan(0);
      expect(snapGitEnv()).toEqual(before);
    } finally {
      process.env.PATH = savedPath;
    }
  }, 30_000);

  it('restores the process git environment and removes the temp HOME when verification rejects', async () => {
    process.env.HOME = '/tmp/relay-verify-sentinel-home';
    process.env.GIT_CONFIG_GLOBAL = '/tmp/relay-verify-sentinel-global';
    delete process.env.GIT_CONFIG_SYSTEM;
    delete process.env.GIT_CONFIG_NOSYSTEM;
    delete process.env.GIT_TERMINAL_PROMPT;
    const before = snapGitEnv();
    let homeDuring = '';
    await expect(verify({
      beforeChecks() {
        homeDuring = process.env.HOME ?? '';
        throw new Error('verification fault');
      },
    })).rejects.toThrow('verification fault');
    expect(homeDuring.startsWith('/tmp/relay-verify-sentinel-home')).toBe(false);
    expect(homeDuring.length).toBeGreaterThan(0);
    expect(existsSync(homeDuring)).toBe(false);
    expect(snapGitEnv()).toEqual(before);
  });

  it('serializes overlapping runs so they do not keep each other\'s HOME', async () => {
    const originalHome = process.env.HOME;
    let home1 = '';
    let home2 = '';
    const first = verify({
      beforeChecks() {
        home1 = process.env.HOME ?? '';
      },
    });
    const second = verify({
      beforeChecks() {
        home2 = process.env.HOME ?? '';
        expect(existsSync(home1)).toBe(false);
        expect(home2).not.toBe(home1);
        expect(home2).not.toBe(originalHome);
      },
    });
    const [a, b] = await Promise.all([first, second]);
    expect(a.failures).toBe(0);
    expect(b.failures).toBe(0);
    expect(home1).not.toBe(home2);
    expect(existsSync(home1)).toBe(false);
    expect(existsSync(home2)).toBe(false);
    expect(process.env.HOME).toBe(originalHome);
  }, 90_000);
});
