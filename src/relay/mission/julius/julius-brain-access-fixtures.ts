import { generateKeyPairSync, sign } from 'node:crypto';

import { GITHUB_ACTIONS_OIDC_ISSUER, type JuliusBrainAccessPolicy, type JuliusBrainJwk } from './julius-brain-access';
import { createJuliusBrainOidcKeyStore, type JuliusBrainOidcKeyStore } from './julius-brain-oidc-keys';

/**
 * A stand-in GitHub Actions OIDC issuer for the access-contract proofs: a fresh
 * RSA key, its JWKS, the policy it satisfies, and tokens minted with any claim
 * overridden. Tests only; nothing composes it.
 */

export const ACCESS_FIXTURE_POLICY: JuliusBrainAccessPolicy = {
  audience: 'julius-project-brain', repositoryId: '1100220033', repositoryOwnerId: '4400550066',
  workflowRef: 'ohdieyuh-glitch/sunday-relay/.github/workflows/julius-first-live-mission.yml@refs/heads/main', ref: 'refs/heads/main',
  allowedEvents: ['workflow_dispatch'], environments: { 'julius-paid': 'production', 'julius-dev': 'development' }, sessionTtlMs: 3 * 60 * 60 * 1000,
};

/** A key store that always answers from one fixed document: for proofs that are not about rotation. */
export function staticFixtureKeyStore(jwks: { readonly keys: readonly JuliusBrainJwk[] }): JuliusBrainOidcKeyStore {
  return createJuliusBrainOidcKeyStore({
    issuers: { [GITHUB_ACTIONS_OIDC_ISSUER]: 'https://token.actions.githubusercontent.com/.well-known/jwks' },
    fetch: async () => ({ status: 200, body: JSON.stringify(jwks) }),
    clock: { now: () => new Date().toISOString() },
  });
}

export function createAccessFixtureIssuer(startSeconds: number) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwks: { keys: JuliusBrainJwk[] } = { keys: [{ ...(publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string }), kid: 'github-1', alg: 'RS256', use: 'sig' }] };
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  let counter = 0;
  /** A signed token for run 35000000000 attempt 1 in julius-paid, issued at `startSeconds`, unless overridden. */
  const mint = (overrides: Record<string, unknown> = {}, header: Record<string, unknown> = { alg: 'RS256', kid: 'github-1', typ: 'JWT' }): string => {
    counter += 1;
    const payload = {
      iss: GITHUB_ACTIONS_OIDC_ISSUER, aud: ACCESS_FIXTURE_POLICY.audience, iat: startSeconds, nbf: startSeconds, exp: startSeconds + 300, jti: `jti-${counter}-${Math.random().toString(36).slice(2)}`,
      repository_id: ACCESS_FIXTURE_POLICY.repositoryId, repository_owner_id: ACCESS_FIXTURE_POLICY.repositoryOwnerId, repository: 'ohdieyuh-glitch/sunday-relay',
      workflow_ref: ACCESS_FIXTURE_POLICY.workflowRef, ref: ACCESS_FIXTURE_POLICY.ref, event_name: 'workflow_dispatch', environment: 'julius-paid', run_id: '35000000000', run_attempt: '1',
      ...overrides,
    };
    const signingInput = `${b64(header)}.${b64(payload)}`;
    return `${signingInput}.${sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url')}`;
  };
  return { jwks, mint, policy: ACCESS_FIXTURE_POLICY, keys: staticFixtureKeyStore(jwks) };
}
