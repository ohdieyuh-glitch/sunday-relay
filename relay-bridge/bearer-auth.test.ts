import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

  /**
   * THIS TABLE IS A TAUTOLOGY, AND IT IS KEPT AS ONE ON PURPOSE.
   *
   * The identity assertion below proves all three names are the SAME function
   * object, so of course they agree — every row would pass against any
   * implementation, correct or not. Read as a parity matrix it proves nothing;
   * read as what it is, it is a tripwire: the day someone re-forks one of the
   * re-exports, the identity assertion fails and this table starts meaning
   * something again. The real behavioural coverage is in the next describe.
   */
  it.each(cases)('the three names answer identically (they are one function): %s', (_label, header) => {
    const shared = bearerMatches(header, SECRET);
    expect(routeBearerMatches(header, SECRET)).toBe(shared);
    expect(serviceBearerMatches(header, SECRET)).toBe(shared);
  });

  it('the shared parser is the one both re-export — the load-bearing assertion', () => {
    expect(routeBearerMatches).toBe(bearerMatches);
    expect(serviceBearerMatches).toBe(bearerMatches);
  });

  it('there is no THIRD bearer parser in production code', () => {
    /*
     * The claim in the module headline is that one implementation is shared by
     * every server surface that parses a `Bearer` credential. Function identity
     * proves it for the two known re-exports; this holds the claim against a
     * surface that has not been written yet, by reading the tree.
     *
     * `Relay-Session` is deliberately excluded: it is a different scheme with
     * different rules, and the headline says so.
     */
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) continue;
        const source = readFileSync(full, 'utf8');
        if (full.endsWith('bearer-auth.ts')) continue;
        /*
         * PARSING, not sending. Every client in this tree builds an outbound
         * `Authorization: \`Bearer ${token}\`` header, and that is not a second
         * parser — so the shapes looked for here are the ones that READ an
         * incoming credential: a regex over the scheme, a `startsWith`, or a
         * direct comparison against a composed `Bearer …` string.
         */
        const parsesBearer = [
          /\/\^[^/\n]{0,14}[Bb]earer/,        // an anchored regex literal over the scheme
          /startsWith\(\s*['"`]\s*[Bb]earer/, // header.startsWith('Bearer ')
          /[!=]==\s*`Bearer /,               // authorization === `Bearer ${token}`
          /`Bearer [^`]*`\s*[!=]==/,
        ].some((pattern) => pattern.test(source));
        if (parsesBearer) offenders.push(full.slice(root.length + 1));
      }
    };
    for (const dir of ['relay-bridge', 'relay-hermes-service']) walk(join(root, dir));
    // The fixture bridge under src/ is a test double and is documented as one;
    // nothing under the two server trees may parse Bearer for itself.
    expect(offenders, 'a second Bearer parser appeared').toEqual([]);
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

  it('a wildly mismatched length is answered, not thrown on — and answered wrong-secret', () => {
    // The old shape special-cased length before comparing. This asserts the
    // OUTCOME for mismatched lengths; it deliberately does not claim to prove
    // constant time, which a unit test cannot. The digest step that removes the
    // length branch is asserted structurally below.
    expect(bearerMatches(`Bearer ${'x'.repeat(4096)}`, 'a')).toBe(false);
    expect(bearerMatches('Bearer a', `${'x'.repeat(4096)}`)).toBe(false);
    expect(bearerMatches('Bearer a', 'a')).toBe(true);
  });

  it('the implementation really does hash before comparing', () => {
    /*
     * The previous test was titled "comparison is over fixed-length digests"
     * and asserted only that nothing threw — it passed with a plain `===`.
     * Whether both sides are reduced to a fixed-length digest before
     * `timingSafeEqual` is a property of the source, so the source is what is
     * read. `timingSafeEqual` on raw buffers of different lengths THROWS, so a
     * shape without the digest could not answer the case above at all.
     */
    const source = readFileSync(join(__dirname, 'bearer-auth.ts'), 'utf8');
    expect(source).toMatch(/createHash\(\s*['"]sha256['"]\s*\)/);
    expect(source).toContain('timingSafeEqual');
  });
});
