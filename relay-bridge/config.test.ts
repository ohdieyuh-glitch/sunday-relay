import { describe, expect, it } from 'vitest';

import { resolveFusionBaseUrl } from './config';

/**
 * THE HEALTH SURFACE MUST NOT DESCRIBE A MACHINE THAT DOES NOT EXIST.
 *
 * A hosted bridge published `fusionBaseUrl: "http://localhost:3000"` in its
 * UNAUTHENTICATED health output. That reads as a configured endpoint and is a
 * description of a loopback service a container does not have — the default
 * nobody changed, presented as a decision somebody made.
 *
 * Null is the honest answer there, and it has a consequence worth having: the
 * mission refuses the development-architect path at the CONFIGURATION rather
 * than discovering it at an HTTP call to an address nothing answers.
 */

describe('the Fusion base URL', () => {
  it('keeps the local default on a founder machine', () => {
    expect(resolveFusionBaseUrl({})).toBe('http://localhost:3000');
  });

  it('is NULL on a production deployment with nothing configured', () => {
    for (const env of [{ NODE_ENV: 'production' }, { RAILWAY_ENVIRONMENT: 'production' }]) {
      // Unknown is not a loopback guess.
      expect(resolveFusionBaseUrl(env), JSON.stringify(env)).toBeNull();
    }
  });

  it('honours a real value in production', () => {
    // A deployment that genuinely runs Fusion somewhere says so, and is
    // believed. The trailing slash is normalized, as it always was.
    expect(resolveFusionBaseUrl({
      NODE_ENV: 'production',
      FUSION_BASE_URL: 'https://fusion.example.com/',
    })).toBe('https://fusion.example.com');
  });

  it('honours a real value on a founder machine too', () => {
    expect(resolveFusionBaseUrl({ FUSION_BASE_URL: 'http://127.0.0.1:4000' }))
      .toBe('http://127.0.0.1:4000');
  });

  it('treats whitespace as unset rather than as a URL', () => {
    expect(resolveFusionBaseUrl({ NODE_ENV: 'production', FUSION_BASE_URL: '   ' })).toBeNull();
    expect(resolveFusionBaseUrl({ FUSION_BASE_URL: '  ' })).toBe('http://localhost:3000');
  });
});
