import { afterEach, describe, expect, it } from 'vitest';

import { zoneNamesAPlace } from './timezone-port';

/**
 * THE HOST THAT CANNOT LIST ITS OWN ZONES.
 *
 * A SEPARATE FILE ON PURPOSE. The supported-zone list is memoized per module
 * instance, so a stub installed after any other test in the same file has
 * already triggered the read does nothing — which is exactly how this branch
 * came to be called "unreachable from a test" and shipped with none. Vitest
 * gives each file its own module registry, so here the stub lands first.
 */

const real = Intl.supportedValuesOf;
afterEach(() => { Intl.supportedValuesOf = real; });

describe('a host whose list of real locations cannot be read', () => {
  it('answers cannot_verify through the REAL function, never not_a_place', () => {
    (Intl as { supportedValuesOf?: unknown }).supportedValuesOf = undefined;
    expect(zoneNamesAPlace('America/Los_Angeles')).toBe('cannot_verify');
    // Even for the zones the rule exists to refuse: without the list this
    // server genuinely cannot tell, and saying otherwise would be a guess.
    expect(zoneNamesAPlace('Etc/GMT+5')).toBe('cannot_verify');
    // UTC is decided before the list is consulted, so it survives the outage.
    expect(zoneNamesAPlace('UTC')).toBe('place');
    // And a string naming no zone needs no list to be refused.
    expect(zoneNamesAPlace('America/Atlantis')).toBe('not_a_place');
  });

  it('does not throw when the list THROWS, and heals when it comes back', () => {
    // A throwing implementation escaped the first guard entirely — it caught
    // only an ABSENT function — and caching the failure then wedged a healthy
    // bridge into refusing every create and every tick until restart.
    let calls = 0;
    Intl.supportedValuesOf = (() => { calls += 1; throw new Error('no tz data'); }) as never;
    expect(zoneNamesAPlace('America/Los_Angeles')).toBe('cannot_verify');
    expect(zoneNamesAPlace('America/Los_Angeles')).toBe('cannot_verify');
    expect(calls).toBe(2);

    Intl.supportedValuesOf = real;
    expect(zoneNamesAPlace('America/Los_Angeles')).toBe('place');
  });
});
