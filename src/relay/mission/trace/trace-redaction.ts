/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 4
 * Event redaction (PURE) — REUSES the shared redactors; no fifth copy.
 *
 * Order matters and is enforced by the factory: REDACT → CANONICALIZE → HASH
 * → STORE. Hashing the redacted form is what lets integrity be verified later
 * without ever needing the original secret, and it means a stored trace can
 * be exported without carrying credentials.
 *
 * Protected categories: API keys, authorization headers, tokens of every kind
 * (access, refresh, session), cookies, provider credentials, database
 * credentials, private keys, webhook secrets, signed URLs carrying
 * credentials, and secret environment-variable VALUES. Environment-variable
 * NAMES may remain — they are useful evidence and are not secrets.
 */

import { redactCommandMetadata } from '../commands/command-events';
import { traceError, traceFail, traceOk, type TraceResult } from './trace-errors';
import type { AqualaTraceRedactionStatus } from './trace-types';

export { redactCommandMetadata } from '../commands/command-events';

export interface RedactedMetadata {
  metadata: Record<string, unknown>;
  status: AqualaTraceRedactionStatus;
}

/** True when redaction would change the input — i.e. it carried secrets. */
export function metadataContainsSecrets(metadata: Record<string, unknown>): boolean {
  return JSON.stringify(redactCommandMetadata(metadata)) !== JSON.stringify(metadata);
}

/**
 * Deeply redacts event metadata and reports whether anything was removed.
 * Never mutates the caller's object.
 *
 * A value that survives redaction while still looking like a credential is
 * REJECTED rather than stored: silently keeping something we could not
 * neutralize would put a live secret inside a permanent, hash-chained record.
 */
export function redactEventMetadata(
  metadata: Record<string, unknown>,
): TraceResult<RedactedMetadata> {
  const before = JSON.stringify(metadata);
  const redacted = redactCommandMetadata(metadata);
  const after = JSON.stringify(redacted);

  if (RESIDUAL_SECRET.test(after)) {
    return traceFail(
      traceError(
        'SECRET_REDACTION_FAILED',
        'metadata still contains a credential-shaped value after redaction and cannot be stored',
        'remove the credential and record a reference or handle instead',
        { field: 'metadata' },
      ),
    );
  }

  return traceOk({
    metadata: redacted,
    status: after === before ? 'not_required' : 'redacted',
  });
}

/**
 * A last-line check against the REDACTED output. The shared redactor covers
 * known key names and value shapes; this catches anything credential-shaped
 * that survived, so it is refused instead of persisted.
 */
const RESIDUAL_SECRET =
  /(?:\bsk-[A-Za-z0-9]{16,}|\bAKIA[0-9A-Z]{12,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,})/u;

/** Exposed for tests and for callers that want to pre-flight a payload. */
export function containsResidualSecret(serialized: string): boolean {
  return RESIDUAL_SECRET.test(serialized);
}
