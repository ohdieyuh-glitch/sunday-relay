/**
 * PSP AGENT ID — trace adapter boundary (PURE, shared verbatim).
 *
 * The Aquala Trace Ledger is a completed, hash-chained domain. This milestone
 * does NOT modify it: no new event kinds are registered, no ledger file is
 * touched, no chain is rewritten. Instead this is the typed FUTURE ADAPTER
 * BOUNDARY the PSP domain will hand events through once trace gains an
 * extension registry for new event types.
 *
 * Until then these builders exist so that:
 *   - the safe event vocabulary is agreed and identical on both surfaces;
 *   - the metadata policy is enforced by CODE rather than by convention;
 *   - a future integration has exactly one place to plug in.
 *
 * THE METADATA POLICY IS ABSOLUTE. Trace metadata may carry the PUBLIC PSP
 * agent id, the PSP id, the PSP version, the entitlement FINGERPRINT, a
 * transaction reference, the import result, the workspace id and the actor id.
 * It may NEVER carry a raw PSP Agent ID credential, a raw secret segment, a
 * plaintext access token, a payment credential or a provider credential —
 * and `buildPspTraceEvent` refuses to produce an event that would.
 */

import { containsPspAgentId, redactPspAgentIds } from './psp-agent-id';
import type { PSPAgentImportErrorCode } from './psp-errors';

export const PSP_TRACE_EVENT_KINDS = [
  'psp_agent_import_requested',
  'psp_agent_entitlement_verified',
  'psp_agent_import_completed',
  'psp_agent_import_rejected',
  'psp_agent_entitlement_revoked',
  'psp_agent_entitlement_transferred',
] as const;
export type PSPTraceEventKind = (typeof PSP_TRACE_EVENT_KINDS)[number];

/** The ONLY metadata keys a PSP trace event may carry. */
export const PSP_TRACE_ALLOWED_KEYS = [
  'pspAgentId',
  'pspId',
  'pspVersionId',
  'entitlementFingerprint',
  'transactionReference',
  'importResult',
  'workspaceId',
  'actorId',
  'errorCode',
] as const;
export type PSPTraceMetadataKey = (typeof PSP_TRACE_ALLOWED_KEYS)[number];

export type PSPTraceMetadata = Partial<Record<PSPTraceMetadataKey, string>>;

export interface PSPTraceEvent {
  kind: PSPTraceEventKind;
  at: string;
  metadata: PSPTraceMetadata;
}

/**
 * Keys whose NAME alone means the value must never be traced. Mirrors the
 * repository's existing credential-handle rejection list.
 */
const SECRET_KEY_SHAPE =
  /(password|passwd|secret|token|api[_-]?key|apikey|cookie|recovery[_-]?code|private[_-]?key|bearer|credential(?!Fingerprint)|agentIdRaw|rawId)/i;

/**
 * Build a PSP trace event, dropping anything outside the allowlist and
 * refusing outright if a value carries credential-shaped material. This is a
 * hard boundary, not a best effort: an unsafe event is not emitted at all.
 */
export function buildPspTraceEvent(input: {
  kind: PSPTraceEventKind;
  at: string;
  metadata: Record<string, unknown>;
}): PSPTraceEvent | null {
  const metadata: PSPTraceMetadata = {};

  for (const [key, value] of Object.entries(input.metadata)) {
    if (SECRET_KEY_SHAPE.test(key)) return null;
    if (!(PSP_TRACE_ALLOWED_KEYS as readonly string[]).includes(key)) continue;
    if (value === undefined || value === null) continue;
    const text = String(value);
    // A credential-shaped value in ANY position kills the event.
    if (containsPspAgentId(text) || text !== redactPspAgentIds(text)) return null;
    metadata[key as PSPTraceMetadataKey] = text;
  }

  return { kind: input.kind, at: input.at, metadata };
}

export function pspImportRequestedEvent(input: {
  at: string;
  pspAgentId?: string;
  workspaceId: string;
  actorId: string;
}): PSPTraceEvent | null {
  return buildPspTraceEvent({
    kind: 'psp_agent_import_requested',
    at: input.at,
    metadata: {
      ...(input.pspAgentId ? { pspAgentId: input.pspAgentId } : {}),
      workspaceId: input.workspaceId,
      actorId: input.actorId,
    },
  });
}

export function pspImportRejectedEvent(input: {
  at: string;
  code: PSPAgentImportErrorCode;
  pspAgentId?: string;
  workspaceId: string;
  actorId: string;
}): PSPTraceEvent | null {
  return buildPspTraceEvent({
    kind: 'psp_agent_import_rejected',
    at: input.at,
    metadata: {
      ...(input.pspAgentId ? { pspAgentId: input.pspAgentId } : {}),
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      importResult: 'rejected',
      errorCode: input.code,
    },
  });
}

export function pspImportCompletedEvent(input: {
  at: string;
  pspAgentId: string;
  pspId: string;
  pspVersionId: string;
  entitlementFingerprint: string;
  workspaceId: string;
  actorId: string;
  transactionReference?: string;
}): PSPTraceEvent | null {
  return buildPspTraceEvent({
    kind: 'psp_agent_import_completed',
    at: input.at,
    metadata: {
      pspAgentId: input.pspAgentId,
      pspId: input.pspId,
      pspVersionId: input.pspVersionId,
      entitlementFingerprint: input.entitlementFingerprint,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      importResult: 'imported',
      ...(input.transactionReference
        ? { transactionReference: input.transactionReference } : {}),
    },
  });
}
