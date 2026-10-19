/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';

import {
  saveConnectedRepository, loadConnectedRepository, clearConnectedRepository,
} from './connected-repository';

/**
 * THE CONNECTED-REPOSITORY POINTER is opaque and fail-closed: it remembers only
 * one repository key so a refresh returns to it, forgets on demand, and never
 * throws on a malformed store. It carries no repository contents and no secret.
 */

const KEY = 'sunday-relay.connected-repository';
const REPO = 'github:github.com/beta-alice/their-app';

afterEach(() => clearConnectedRepository());

describe('connected-repository pointer', () => {
  it('round-trips a saved repository key', () => {
    expect(loadConnectedRepository()).toBeNull();
    saveConnectedRepository(REPO);
    expect(loadConnectedRepository()).toBe(REPO);
    // Re-pointing replaces, it does not accumulate.
    saveConnectedRepository('github:github.com/beta-alice/other');
    expect(loadConnectedRepository()).toBe('github:github.com/beta-alice/other');
  });

  it('load() with nothing stored returns null', () => {
    expect(loadConnectedRepository()).toBeNull();
  });

  it('clear() empties the pointer', () => {
    saveConnectedRepository(REPO);
    expect(loadConnectedRepository()).toBe(REPO);
    clearConnectedRepository();
    expect(loadConnectedRepository()).toBeNull();
  });

  it('ignores an empty key rather than storing a pointer that cannot resolve', () => {
    saveConnectedRepository('');
    expect(loadConnectedRepository()).toBeNull();
  });

  it('a malformed stored value returns null and never throws', () => {
    // Not valid JSON at all.
    sessionStorage.setItem(KEY, '{not json');
    expect(() => loadConnectedRepository()).not.toThrow();
    expect(loadConnectedRepository()).toBeNull();
    // Valid JSON, but not a non-empty string.
    sessionStorage.setItem(KEY, JSON.stringify({ repo: REPO }));
    expect(loadConnectedRepository()).toBeNull();
    sessionStorage.setItem(KEY, JSON.stringify(42));
    expect(loadConnectedRepository()).toBeNull();
    sessionStorage.setItem(KEY, JSON.stringify(''));
    expect(loadConnectedRepository()).toBeNull();
  });
});
