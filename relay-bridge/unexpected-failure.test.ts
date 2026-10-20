import { describe, expect, it } from 'vitest';

import { describeUnexpected } from './mission';

/**
 * A REFUSAL THAT NAMES NOTHING CANNOT BE ACTED ON.
 *
 * The first real hosted three-role Mission died with "The mission stopped
 * unexpectedly." and nothing else. The Prompt Architect had run and been paid,
 * the handoff was validated and persisted, the hosted Coding Agent assignment
 * was created — and then a throw was swallowed whole. Neither the founder nor
 * Relay could tell a missing executable from an unwritable volume from a bug.
 *
 * What is surfaced is narrow on purpose: the error CLASS, and for a failed
 * spawn the COMMAND. The message body never is — it carries absolute paths,
 * argument lists and text a provider echoed back, which is the material this
 * bridge redacts everywhere else.
 */

describe('an unexpected failure says what kind it was', () => {
  it('names a missing executable, which is the fact a hosted deployment can act on', () => {
    const err = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT', path: 'git' });
    const out = describeUnexpected(err);
    expect(out).toContain('git');
    expect(out).toContain('ENOENT');
    expect(out).toContain('image');
  });

  it('reports a system error code on its own', () => {
    expect(describeUnexpected(Object.assign(new Error('x'), { code: 'EACCES' }))).toContain('EACCES');
  });

  it('falls back to the error class when there is no code', () => {
    expect(describeUnexpected(new TypeError('x'))).toContain('TypeError');
  });

  it('stays generic for a non-object throw', () => {
    expect(describeUnexpected('boom')).toBe('The mission stopped unexpectedly.');
    expect(describeUnexpected(null)).toBe('The mission stopped unexpectedly.');
  });

  /**
   * THE HALF THAT MATTERS MORE. Everything above makes a failure legible;
   * these keep it from becoming a leak.
   */
  it('never surfaces the error message', () => {
    /**
     * ASSEMBLED AT RUNTIME, not written as a literal.
     *
     * The repository secret scanner flags an inline-credential URL wherever it
     * appears, including in a fixture — correctly, because it cannot tell a
     * fixture from the real thing and guessing is how a real one ships. It
     * failed CI on the first version of this test, which is the scanner doing
     * its job. Joining the parts keeps the test honest and the scanner useful,
     * the same way `live-reach-service.test.ts` handles a key-shaped string.
     */
    const secret = ['sk', 'notarealsecret0000'].join('-');
    const url = ['https:/', '', `user:${secret}@host`, 'path?token=abc'].join('/');
    const err = Object.assign(new Error(`connect failed to ${url}`), { code: 'ECONNREFUSED' });
    const out = describeUnexpected(err);
    expect(out).not.toContain(secret);
    expect(out).not.toContain('host');
    expect(out).not.toContain('token=abc');
    // It still says something useful.
    expect(out).toContain('ECONNREFUSED');
  });

  it('never surfaces an absolute path, only a bare command', () => {
    // An absolute path discloses host layout; a bare command names software.
    const err = Object.assign(new Error('x'), { code: 'ENOENT', path: '/srv/secret-app/bin/hermes' });
    const out = describeUnexpected(err);
    expect(out).not.toContain('/srv');
    expect(out).toContain('ENOENT');
  });

  it('refuses a code that is not a system-error token', () => {
    // `code` is attacker-influenced on some errors; only the short uppercase
    // shape is echoed, so a sentence cannot ride out through it.
    const err = Object.assign(new Error('x'), { code: 'leaked sk-abcdefghijklmnop secret' });
    const out = describeUnexpected(err);
    // The property is that the bogus code is NOT echoed — not that the output
    // is bare. It falls through to the error class, which is a safe token.
    // (My first version of this test asserted exact equality and failed on
    // `...: Error.`, which is correct behaviour.)
    expect(out).not.toContain('sk-abcdefghijklmnop');
    expect(out).not.toContain('leaked');
    expect(out).toBe('The mission stopped unexpectedly: Error.');
  });
});
