/**
 * MCP CREDENTIAL REFERENCES (PURE, browser-safe by construction).
 *
 * An `McpCredentialReference` is an OPAQUE RECORD THAT CANNOT HOLD A SECRET.
 * It says a credential exists, who owns it, roughly what it can do, and
 * whether it is still valid. It never says what it is.
 *
 * This module is deliberately browser-safe and deliberately useless for
 * authentication: resolving a reference to actual key material happens behind
 * `McpCredentialResolverPort`, which lives on the server side and is never
 * imported by a browser module. The split is the point. A reference can travel
 * anywhere Relay's domain travels — PSP exports, Mission Contracts, Project
 * Brain, the Trace Ledger, Execution Capsules, the website — precisely because
 * there is nothing in it worth stealing.
 *
 * `scopeSummary` needs a word of care: it is a list of SCOPE NAMES
 * (`repo:read`), never scope VALUES, and never an installation id or an
 * account handle that would identify the credential itself. A scope name is
 * policy input; anything more is a fingerprint of the secret.
 *
 * The type-level guard below (`assertNoSecretFields`) is not decoration.
 * `mcp-credential.test.ts` feeds it every field name a token has ever been
 * called and asserts each one is refused, so a future field named
 * `access_token` fails a test rather than shipping.
 */

import type { McpCredentialReferenceId } from '../../protocol/ids';

export const MCP_CREDENTIAL_CLASSES = [
  'none',
  'bearer_token',
  'oauth_authorization_code',
  'api_key_header',
  'basic_auth',
  'child_process_env',
] as const;
export type McpCredentialClass = (typeof MCP_CREDENTIAL_CLASSES)[number];

export const MCP_CREDENTIAL_STATES = [
  'active',
  'expired',
  'revoked',
  'missing',
  'insufficient_scope',
] as const;
export type McpCredentialState = (typeof MCP_CREDENTIAL_STATES)[number];

export interface McpCredentialReference {
  readonly credentialReferenceId: McpCredentialReferenceId;
  readonly credentialClass: McpCredentialClass;
  readonly accountId: string;
  readonly workspaceId: string;
  /** Which provider class this belongs to — `github`, `filesystem`, … */
  readonly providerClass: string;
  /** Scope NAMES only. Never values, never identifiers of the credential. */
  readonly scopeSummary: readonly string[];
  readonly state: McpCredentialState;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * For `child_process_env`: the NAMES of environment variables the resolver
   * is permitted to populate. Names are configuration; values never appear in
   * this domain at all.
   */
  readonly environmentVariableNames: readonly string[];
}

/**
 * Field names that must never exist on a credential reference, in any spelling
 * Relay has seen a token wear. Checked structurally rather than by review.
 */
export const FORBIDDEN_CREDENTIAL_FIELDS: readonly string[] = Object.freeze([
  'token', 'accessToken', 'access_token', 'refreshToken', 'refresh_token',
  'idToken', 'id_token', 'bearer', 'apiKey', 'api_key', 'key', 'secret',
  'clientSecret', 'client_secret', 'password', 'passphrase', 'authorization',
  'credential', 'credentials', 'privateKey', 'private_key', 'sessionToken',
  'session_token', 'serviceToken', 'service_token', 'connectionString',
  'connection_string', 'dsn', 'env', 'environment',
]);

/**
 * Returns the offending field names, empty when clean. Used by the domain
 * validator, by the PSP export path, and by the Trace/Capsule writers — one
 * rule, applied at every boundary a reference can cross.
 */
export function forbiddenCredentialFieldsIn(value: unknown): readonly string[] {
  if (typeof value !== 'object' || value === null) return [];
  const found: string[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (depth > 8 || typeof node !== 'object' || node === null) return;
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      // `environmentVariableNames` is a NAME list and legitimately contains
      // strings like `GITHUB_TOKEN`. The forbidden set is about FIELD names on
      // the record, not about the contents of a declared name list.
      if (key === 'environmentVariableNames') continue;
      if (FORBIDDEN_CREDENTIAL_FIELDS.includes(key)) found.push(key);
      walk(child, depth + 1);
    }
  };
  walk(value, 0);
  return found;
}

export const credentialIsUsable = (reference: McpCredentialReference): boolean =>
  reference.state === 'active';

/**
 * Whether the reference covers every scope an operation needs. Missing scopes
 * are returned so preflight can say WHICH scope is absent — "insufficient
 * scope" with no name is an error message that costs an hour to act on.
 */
export function missingScopes(
  reference: McpCredentialReference,
  required: readonly string[],
): readonly string[] {
  const held = new Set(reference.scopeSummary);
  return required.filter((scope) => !held.has(scope));
}
