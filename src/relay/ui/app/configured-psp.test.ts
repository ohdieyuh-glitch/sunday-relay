/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';

import {
  saveConfiguredPsp, loadConfiguredPsp, clearConfiguredPsp,
} from './configured-psp';

/**
 * THE PRE-CONFIGURED PSP POINTER survives the OAuth/install redirect the way the
 * connected-repository pointer does: it round-trips one configuration object
 * through `sessionStorage`, forgets on demand, and NEVER throws on a malformed
 * store. It is a request, never a claim — a broken value fails closed to null.
 */

const KEY = 'sunday-relay.configured-psp';
const CONFIG = {
  mode: 'guided', review: 'independent', completionRule: 'strict',
  permissions: ['read', 'write_worktree'],
  limits: { agentCalls: 8, runtimeMinutes: 30, spendUsd: 5, reviewCycles: 1, repairCycles: 1 },
};

afterEach(() => clearConfiguredPsp());

describe('configured-psp pointer', () => {
  it('round-trips a saved configuration object', () => {
    expect(loadConfiguredPsp()).toBeNull();
    saveConfiguredPsp(CONFIG);
    expect(loadConfiguredPsp()).toEqual(CONFIG);
    // Re-saving replaces, it does not accumulate.
    saveConfiguredPsp({ mode: 'autonomous' });
    expect(loadConfiguredPsp()).toEqual({ mode: 'autonomous' });
  });

  it('load() with nothing stored returns null', () => {
    expect(loadConfiguredPsp()).toBeNull();
  });

  it('clear() empties the pointer', () => {
    saveConfiguredPsp(CONFIG);
    expect(loadConfiguredPsp()).toEqual(CONFIG);
    clearConfiguredPsp();
    expect(loadConfiguredPsp()).toBeNull();
  });

  it('ignores a non-object config rather than storing a request that cannot resolve', () => {
    saveConfiguredPsp(null);
    expect(loadConfiguredPsp()).toBeNull();
    saveConfiguredPsp(undefined);
    expect(loadConfiguredPsp()).toBeNull();
    saveConfiguredPsp('guided');
    expect(loadConfiguredPsp()).toBeNull();
    saveConfiguredPsp(42);
    expect(loadConfiguredPsp()).toBeNull();
    // An array is not a configuration either.
    saveConfiguredPsp(['read']);
    expect(loadConfiguredPsp()).toBeNull();
  });

  it('a malformed stored value returns null and never throws', () => {
    // Not valid JSON at all.
    sessionStorage.setItem(KEY, '{not json');
    expect(() => loadConfiguredPsp()).not.toThrow();
    expect(loadConfiguredPsp()).toBeNull();
    // Valid JSON, but not a config object — a primitive, an array, null.
    sessionStorage.setItem(KEY, JSON.stringify(42));
    expect(loadConfiguredPsp()).toBeNull();
    sessionStorage.setItem(KEY, JSON.stringify('guided'));
    expect(loadConfiguredPsp()).toBeNull();
    sessionStorage.setItem(KEY, JSON.stringify(null));
    expect(loadConfiguredPsp()).toBeNull();
    sessionStorage.setItem(KEY, JSON.stringify(['read', 'write_worktree']));
    expect(loadConfiguredPsp()).toBeNull();
  });
});
