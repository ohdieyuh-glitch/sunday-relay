import { describe, expect, it } from 'vitest';
import { companyWebTarget } from './company-link';

/**
 * Mirrors `siblingProductTarget.test.ts` in spirit: unset is the truthful
 * default (the brandmark renders as plain text, not a broken link), and only
 * an absolute http(s) URL is accepted.
 */
describe('companyWebTarget', () => {
  it('is unconfigured when the env var is unset', () => {
    expect(companyWebTarget({})).toEqual({
      configured: false,
      reason: 'Set VITE_IWONDER_WEB_URL to link to the i.Wonder company site.',
    });
  });

  it('is unconfigured when the env var is blank', () => {
    expect(companyWebTarget({ VITE_IWONDER_WEB_URL: '   ' }).configured).toBe(false);
  });

  it('accepts an absolute https URL', () => {
    expect(companyWebTarget({ VITE_IWONDER_WEB_URL: 'https://iwonder.example.com/' })).toEqual({
      configured: true,
      url: 'https://iwonder.example.com/',
    });
  });

  it('rejects a relative path — this repository does not build that route', () => {
    const result = companyWebTarget({ VITE_IWONDER_WEB_URL: '/iwonder' });
    expect(result.configured).toBe(false);
  });

  it('rejects a non-http(s) scheme', () => {
    const result = companyWebTarget({ VITE_IWONDER_WEB_URL: 'javascript:alert(1)' });
    expect(result.configured).toBe(false);
  });
});
