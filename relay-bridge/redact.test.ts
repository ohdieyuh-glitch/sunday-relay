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
