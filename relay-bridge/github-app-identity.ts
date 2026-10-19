import { sign as cryptoSign } from 'node:crypto';
import { fail, ok, relayError, type RelayResult } from '../src/relay/protocol/errors';

/**
 * THE GITHUB APP'S OWN IDENTITY — an App JWT, minted from the App id and its
 * private key.
 *
 * A GitHub App authenticates as ITSELF with a short-lived RS256 JWT (iss = App
 * id, signed by the App's private key). That JWT is then exchanged for an
 * INSTALLATION access token (see `github-app-installation.ts`), which is the
 * short-lived, repository-scoped, permission-scoped credential a Mission
 * actually uses. This is the canonical alternative to a permanent founder PAT:
 * nothing here or downstream is a long-lived secret in a Mission's reach.
 *
 * THE PRIVATE KEY NEVER LEAVES THIS PROCESS AND IS NEVER SURFACED. It is read
 * from server-side configuration, held in memory for the sign, and never
 * logged, thrown, returned, attested, persisted, or placed in a URL. The JWT it
 * produces is itself short-lived (ten minutes, GitHub's maximum) and is only
 * ever sent to GitHub in an `Authorization` header.
 */

export interface AppIdentityConfig {
  /** The GitHub App's numeric id (or client id string). Public, safe to log. */
  readonly appId: string;
  /** The App's RSA private key, PEM. SECRET — never logged/returned/persisted. */
  readonly privateKeyPem: string;
}

/** GitHub caps an App JWT at 10 minutes; we use 9 with a 60s clock-skew buffer. */
const APP_JWT_TTL_SECONDS = 9 * 60;
const CLOCK_SKEW_SECONDS = 60;

const b64url = (input: Buffer | string): string =>
  (Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8')).toString('base64url');

/**
 * Mint a signed App JWT. `nowSeconds` is injected (never a hidden clock) so the
 * mint is deterministic and testable. Returns a validation error rather than
 * throwing if the key cannot sign — and the error carries NO key material.
 */
export function mintAppJwt(config: AppIdentityConfig, nowSeconds: number): RelayResult<string> {
  if (typeof config.appId !== 'string' || config.appId.trim() === '') {
    return fail(relayError('validation-failed', 'A GitHub App id is required to mint an App JWT.'));
  }
  if (typeof config.privateKeyPem !== 'string' || !config.privateKeyPem.includes('PRIVATE KEY')) {
    // Shape check only; the value is never echoed.
    return fail(relayError('validation-failed', 'A GitHub App private key (PEM) is required to mint an App JWT.'));
  }
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    // Backdated by the skew buffer, because GitHub rejects a JWT whose iat is in
    // the future relative to its own clock.
    iat: nowSeconds - CLOCK_SKEW_SECONDS,
    exp: nowSeconds + APP_JWT_TTL_SECONDS,
    iss: config.appId,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  try {
    // RS256 = RSASSA-PKCS1-v1_5 over SHA-256, which is what crypto.sign('sha256',
    // …, <RSA private key>) produces.
    const signature = cryptoSign('sha256', Buffer.from(signingInput, 'utf8'), config.privateKeyPem);
    return ok(`${signingInput}.${b64url(signature)}`);
  } catch {
    // The failure reason (a bad key, wrong type) must not carry the key.
    return fail(relayError('validation-failed', 'The GitHub App private key could not sign an App JWT.'));
  }
}
