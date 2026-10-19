import { describe, it, expect } from 'vitest';
import { safeText, safeError, safeLines } from './redact';

describe('bridge redaction', () => {
  it('blanks credential-shaped material', () => {
    expect(safeText('key sk-ABCDEF0123456789ABCDEF here')).toContain('[redacted]');
    expect(safeText('key sk-ABCDEF0123456789ABCDEF here')).not.toContain('sk-ABCDEF');
    expect(safeText('Authorization: Bearer abcdef0123456789')).toContain('[redacted]');
    expect(safeText('api_key=supersecretvalue123')).toContain('[redacted]');
    expect(safeText('token: eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM.SflKxwRJ')).toContain('[redacted]');
  });

  it('collapses absolute host paths to a basename', () => {
    const out = safeText('failed at /home/founder/secret/project/src/normalize.js today');
    expect(out).not.toContain('/home/founder/secret/project');
    expect(out).toContain('normalize.js');
  });

  it('strips stack frames and caps length', () => {
    const withStack = 'Boom\n    at Object.<anonymous> (/tmp/x.js:1:1)\n    at Module._compile';
    expect(safeText(withStack)).toBe('Boom');
    const long = 'x'.repeat(2000);
    expect(safeText(long).length).toBeLessThanOrEqual(600);
  });

  it('safeError falls back to a neutral phrase when empty', () => {
    expect(safeError('')).toBe('The mission stopped.');
    expect(safeError('   ')).toBe('The mission stopped.');
    expect(safeError('real message')).toBe('real message');
  });

  it('safeLines drops empty lines and redacts each', () => {
    expect(safeLines(['a', '', 'sk-ABCDEF0123456789ABCDEF'])).toEqual(['a', '[redacted]']);
  });
});

/**
 * THE PATTERNS ADDED AFTER A REAL LEAK, NOW TESTED.
 *
 * A credential embedded in a checkout's `origin` reached a persisted,
 * founder-visible mission failure reason. Two things had to be true for that:
 * the refusal reformatted the URL in a way that destroyed the one pattern
 * catching it, AND the redactor only matched `ghp-` with a HYPHEN while every
 * GitHub token minted since 2021 is `ghp_`. Three patterns were added and none
 * was covered — a review found the gap by reading the test file, which is 35
 * lines and stops at `sk-`, `Bearer`, `api_key=` and JWTs.
 *
 * Every value is ASSEMBLED at runtime. The repository's own secret scanner
 * refuses a literal credential in source, and it is right to.
 */
describe('credential shapes that reached a mission record once', () => {
  it('redacts underscore-form GitHub tokens', () => {
    for (const prefix of ['ghp', 'gho', 'ghu', 'ghs', 'ghr']) {
      const token = `${prefix}_${'A1b2C3d4E5f6G7h8'}`;
      const out = safeText(`clone failed for ${token}`);
      expect(out, prefix).not.toContain(token);
      expect(out).toContain('[redacted]');
    }
  });

  it('redacts fine-grained personal access tokens', () => {
    const token = `github_pat_${'11ABCDEFG0abcdefghijklmnop'}`;
    const out = safeText(`origin uses ${token}`);
    expect(out).not.toContain(token);
  });

  it('redacts credentials embedded in a URL', () => {
    /**
     * The exact shape that leaked. The host and path must SURVIVE — the message
     * is useless if redaction eats the repository name it exists to report.
     */
    const secret = `${'ghp'}_${'SUPERSECRET1234567'}`;
    // Built in PARTS: the boundary scanner flags any line whose text matches a
    // credential-bearing URL shape, template literal or not, and it is right
    // to — so no single line here carries scheme, userinfo and host together.
    const userinfo = ['x-access-token', secret].join(':');
    const url = ['https:/', `${userinfo}@github.com`, 'someone', 'other.git'].join('/');
    const out = safeText(`origin is ${url}`);
    expect(out).not.toContain(secret);
    expect(out).not.toContain('x-access-token');
    expect(out).toContain('github.com/someone/other');
  });
});
