import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import type { Provenance } from '../protocol/enums';

/**
 * Credential handles (Prompt 8.2) — PURE, browser-safe. A provider-neutral
 * reference to approved access that NEVER contains the credential value. Raw
 * passwords/tokens/keys/cookies/recovery codes are never accepted or stored,
 * and never enter prompts, handoffs, events, the Project Brain, the terminal,
 * the Final Audit, JSON, or logs. Multi-factor stays a Manual Task. This is
 * NOT an encrypted vault (deferred) — it is scope + expiration + revocation.
 */

export type HandleCapability = 'authenticated_session' | 'scoped_api' | 'read_only_service';

export interface CredentialHandle {
  credentialHandleId: string;
  userId: string;
  projectId: string;
  service: string;
  accountLabel: string;
  capability: HandleCapability;
  allowedActions: string[];
  prohibitedActions: string[];
  scope: string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  requiresUserPresence: boolean;
  requiresMultiFactor: boolean;
  provenance: Provenance;
}

/** Field names / values that must never appear in a handle definition. */
const SECRET_KEYS = /(password|passwd|secret|token|api[_-]?key|apikey|cookie|recovery[_-]?code|private[_-]?key|bearer)/i;
const SECRET_VALUE = /(sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{10,}\.)/;

export interface CredentialHandleInput {
  credentialHandleId: string;
  userId: string;
  projectId: string;
  service: string;
  accountLabel: string;
  capability: HandleCapability;
  allowedActions: string[];
  prohibitedActions?: string[];
  scope: string[];
  createdAt: string;
  expiresAt: string;
  requiresUserPresence?: boolean;
  requiresMultiFactor?: boolean;
  provenance: Provenance;
  /** Anything extra is inspected for secret shapes and REJECTED. */
  [extra: string]: unknown;
}

export function createCredentialHandle(input: CredentialHandleInput): RelayResult<CredentialHandle> {
  const errors: string[] = [];
  // Reject any secret-shaped KEY or VALUE anywhere in the definition.
  for (const key of Object.keys(input)) {
    if (SECRET_KEYS.test(key)) errors.push(`field "${key}" looks like a raw credential — handles never hold secret values.`);
    const value = input[key];
    if (typeof value === 'string' && SECRET_VALUE.test(value)) errors.push(`field "${key}" contains a secret-shaped value.`);
  }
  if (!input.service || input.service.trim() === '') errors.push('service is required.');
  if (!input.expiresAt) errors.push('an expiration is required.');
  if (!input.scope || input.scope.length === 0) errors.push('a non-empty scope is required.');
  if (errors.length > 0) return fail(relayError('validation-failed', 'Credential handle rejected.', { details: errors }));

  return ok({
    credentialHandleId: input.credentialHandleId, userId: input.userId, projectId: input.projectId,
    service: input.service, accountLabel: input.accountLabel, capability: input.capability,
    allowedActions: [...input.allowedActions], prohibitedActions: [...(input.prohibitedActions ?? [])],
    scope: [...input.scope], createdAt: input.createdAt, expiresAt: input.expiresAt,
    lastUsedAt: null, revokedAt: null,
    requiresUserPresence: input.requiresUserPresence ?? false,
    requiresMultiFactor: input.requiresMultiFactor ?? false,
    provenance: input.provenance,
  });
}

export function handleIsActive(handle: CredentialHandle, now: string): boolean {
  if (handle.revokedAt) return false;
  return handle.expiresAt > now;
}

export function revokeHandle(handle: CredentialHandle, now: string): CredentialHandle {
  return { ...handle, revokedAt: now };
}

/** An action is permitted by a handle only if active, allowed, not
 * prohibited, and does not require MFA/presence that must be a Manual Task. */
export type HandleAccessResult = 'allowed' | 'expired' | 'revoked' | 'prohibited' | 'not_in_scope' | 'requires_manual_task';

export function evaluateHandleAccess(
  handle: CredentialHandle, action: string, now: string,
): HandleAccessResult {
  if (handle.revokedAt) return 'revoked';
  if (handle.expiresAt <= now) return 'expired';
  if (handle.prohibitedActions.includes(action)) return 'prohibited';
  if (handle.requiresMultiFactor || handle.requiresUserPresence) return 'requires_manual_task';
  if (!handle.allowedActions.includes(action)) return 'not_in_scope';
  return 'allowed';
}

/** A user-facing access SUMMARY — names + scopes only, never values. */
export function accessSummary(handles: readonly CredentialHandle[], now: string): Array<{ service: string; accountLabel: string; capability: string; scope: string[]; status: 'active' | 'expired' | 'revoked'; expiresAt: string }> {
  return handles.map((h) => ({
    service: h.service, accountLabel: h.accountLabel, capability: h.capability, scope: h.scope,
    status: h.revokedAt ? 'revoked' : h.expiresAt <= now ? 'expired' : 'active', expiresAt: h.expiresAt,
  }));
}
