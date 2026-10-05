import { describe, expect, it } from 'vitest';

import { BRIDGE_COMMIT_ATTESTATION, createBridgeBoot, readBridgeIdentity } from './bridge-identity';

/**
 * WHICH BUILD IS ANSWERING, AND WHICH START OF IT. The commit is the platform's
 * word or nothing; the boot is drawn once per created server.
 */

const BOOT = Object.freeze({ bootId: '5e'.repeat(16), startedAt: '2026-10-04T12:00:00.000Z' });
const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('the commit is what the platform attests, or Unknown', () => {
  it('takes a full commit from the platform variable, trimmed and lower-cased, and names the variable', () => {
    expect(readBridgeIdentity({ [BRIDGE_COMMIT_ATTESTATION]: SHA }, BOOT)).toEqual({
      commit: SHA, attestedBy: 'RAILWAY_GIT_COMMIT_SHA', production: false, ...BOOT,
    });
    expect(readBridgeIdentity({ RAILWAY_GIT_COMMIT_SHA: `  ${SHA.toUpperCase()}\n` }, BOOT).commit).toBe(SHA);
  });

  it('believes nothing that is not a full commit: absent, empty, short, long, prefixed or not hex is null, attested by nothing', () => {
    for (const stated of [undefined, '', '   ', SHA.slice(0, 7), `${SHA}0`, `sha:${SHA}`, SHA.replace('a', 'g'), 'main']) {
      const identity = readBridgeIdentity({ RAILWAY_GIT_COMMIT_SHA: stated }, BOOT);
      expect({ stated, commit: identity.commit, attestedBy: identity.attestedBy }).toEqual({ stated, commit: null, attestedBy: null });
    }
  });

  it('reads no other variable for the commit: a deployment that names its own commit is not attested by a platform', () => {
    for (const name of ['RELAY_BRIDGE_COMMIT', 'GIT_COMMIT', 'COMMIT_SHA', 'VERCEL_GIT_COMMIT_SHA', 'SOURCE_VERSION']) {
      expect(readBridgeIdentity({ [name]: SHA }, BOOT).commit, name).toBeNull();
    }
  });
});

describe('the production branch, and the boot', () => {
  it('reports the production branch of the gates exactly as the gates read it', () => {
    expect(readBridgeIdentity({}, BOOT).production).toBe(false);
    expect(readBridgeIdentity({ RAILWAY_ENVIRONMENT: 'production' }, BOOT).production).toBe(true);
    expect(readBridgeIdentity({ NODE_ENV: 'production' }, BOOT).production).toBe(true);
    expect(readBridgeIdentity({ NODE_ENV: 'development' }, BOOT).production).toBe(false);
  });

  it('draws 128 random bits per created server, and records when', () => {
    const first = createBridgeBoot(new Date('2026-10-04T08:30:00Z'));
    const second = createBridgeBoot(new Date('2026-10-04T08:30:00Z'));
    expect(first.bootId).toMatch(/^[0-9a-f]{32}$/u);
    expect(second.bootId, 'two starts are two boots, even in the same instant').not.toBe(first.bootId);
    expect(first.startedAt).toBe('2026-10-04T08:30:00.000Z');
    expect(readBridgeIdentity({}, first)).toMatchObject({ bootId: first.bootId, startedAt: first.startedAt });
  });
});
