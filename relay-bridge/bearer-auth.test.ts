import { describe, expect, it } from 'vitest';
import { bearerMatches, parseBearerCredential } from './bearer-auth';
import { bearerMatches as routeBearerMatches } from './reviewer-routes';
import { bearerMatches as serviceBearerMatches } from '../relay-hermes-service/service';

/**
 * ONE BEARER PARSER — the non-blocking review finding about a stated parity
 * that did not hold.
 *
 * The bridge and the Hermes service each carried a `bearerMatches`, and the
 * service's docstring said it matched the bridge's. It did not: different
 * scheme casing, different separator handling, and a different rule for a
 * configured secret carrying whitespace. Every wrong secret was rejected by
 * both — strictly fail-closed, which is why this was not an auth bypass. The
 * defect was the claim.
 *
 * The parity test below is the point of the whole change: it compares the two
 * surfaces' exported functions directly, over inputs chosen because they used
 * to disagree.
 */

const SECRET = 'private-service-token';

describe('the two surfaces now share one implementation', () => {
  const cases: Array<[string, string | undefined]> = [
    ['exact', `Bearer ${SECRET}`],
    ['lowercase scheme (RFC 6750 says the scheme is case-insensitive)', `bearer ${SECRET}`],
    ['mixed-case scheme', `BeArEr ${SECRET}`],
    ['tab separator', `Bearer\t${SECRET}`],
    ['multiple spaces', `Bearer   ${SECRET}`],
    ['leading whitespace', `  Bearer ${SECRET}`],
    ['trailing whitespace', `Bearer ${SECRET}  `],
    ['wrong secret', 'Bearer nope'],
    ['secret as a prefix', `Bearer ${SECRET}x`],
    ['empty credential', 'Bearer '],
    ['no scheme', SECRET],
    ['wrong scheme', `Basic ${SECRET}`],
    ['absent header', undefined],
  ];

  it.each(cases)('bridge and service agree: %s', (_label, header) => {
    const shared = bearerMatches(header, SECRET);
    expect(routeBearerMatches(header, SECRET)).toBe(shared);
    expect(serviceBearerMatches(header, SECRET)).toBe(shared);
  });

  it('the shared parser is the one both re-export', () => {
    expect(routeBearerMatches).toBe(bearerMatches);
    expect(serviceBearerMatches).toBe(bearerMatches);
  });
});

describe('what it accepts and refuses', () => {
  it('accepts the RFC 6750 forms', () => {
    for (const header of [`Bearer ${SECRET}`, `bearer ${SECRET}`, `Bearer\t${SECRET}`, `Bearer   ${SECRET}`]) {
      expect(bearerMatches(header, SECRET), header).toBe(true);
    }
  });

  it('tolerates a configured secret with surrounding whitespace — a platform env var with a newline', () => {
    expect(bearerMatches(`Bearer ${SECRET}`, `${SECRET}\n`)).toBe(true);
    expect(bearerMatches(`Bearer ${SECRET}`, `  ${SECRET}  `)).toBe(true);
  });

  it('refuses every wrong secret, however it is presented', () => {
    for (const header of [
      'Bearer nope', `Bearer ${SECRET}x`, `Bearer x${SECRET}`, `Bearer ${SECRET.slice(0, -1)}`,
      'Bearer ', 'Bearer', SECRET, `Basic ${SECRET}`, '', undefined,
    ]) {
      expect(bearerMatches(header, SECRET), String(header)).toBe(false);
    }
  });

  it('an unset or blank configured secret authenticates NOTHING', () => {
    // Otherwise a misconfigured deployment would accept an empty credential.
    for (const expected of [undefined, '', '   ', '\n']) {
      expect(bearerMatches(`Bearer ${SECRET}`, expected)).toBe(false);
      expect(bearerMatches('Bearer ', expected)).toBe(false);
    }
  });

  it('does not trim the interior of a credential — a token is opaque', () => {
    expect(parseBearerCredential('Bearer  a b ')).toBe('a b');
    expect(parseBearerCredential('Bearer tok')).toBe('tok');
    expect(parseBearerCredential('Bearer')).toBeNull();
    expect(parseBearerCredential(undefined)).toBeNull();
  });

  it('comparison is over fixed-length digests, so no length branch remains', () => {
    // A one-character secret and a very long presented value must both be
    // handled without throwing — the old shape special-cased length.
    expect(bearerMatches(`Bearer ${'x'.repeat(4096)}`, 'a')).toBe(false);
    expect(bearerMatches('Bearer a', 'a')).toBe(true);
  });
});
