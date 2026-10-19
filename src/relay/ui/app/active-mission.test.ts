/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';

import {
  rememberActiveMission, recallActiveMission, forgetActiveMission, clearActiveMissions,
} from './active-mission';

/**
 * THE ACTIVE-MISSION POINTER is per-repository, opaque, and fail-closed: it
 * remembers only a mission id, keeps repositories separate, and forgetting one
 * never disturbs another. It carries no mission state and no secret.
 */

afterEach(() => clearActiveMissions());

const A = 'github:github.com/beta-alice/app-a';
const B = 'github:github.com/beta-alice/app-b';

describe('active-mission pointer', () => {
  it('remembers and recalls a mission id per repository, independently', () => {
    expect(recallActiveMission(A)).toBeNull();
    rememberActiveMission(A, 'm-a1');
    rememberActiveMission(B, 'm-b1');
    expect(recallActiveMission(A)).toBe('m-a1');
    expect(recallActiveMission(B)).toBe('m-b1');
    // Re-pointing one repo does not touch the other.
    rememberActiveMission(A, 'm-a2');
    expect(recallActiveMission(A)).toBe('m-a2');
    expect(recallActiveMission(B)).toBe('m-b1');
  });

  it('forgets one repository without disturbing another, and clears all', () => {
    rememberActiveMission(A, 'm-a');
    rememberActiveMission(B, 'm-b');
    forgetActiveMission(A);
    expect(recallActiveMission(A)).toBeNull();
    expect(recallActiveMission(B)).toBe('m-b');
    clearActiveMissions();
    expect(recallActiveMission(B)).toBeNull();
  });

  it('ignores empty keys or ids rather than storing a pointer that cannot resolve', () => {
    rememberActiveMission(A, '');
    rememberActiveMission('', 'm');
    expect(recallActiveMission(A)).toBeNull();
    expect(recallActiveMission('')).toBeNull();
  });
});
