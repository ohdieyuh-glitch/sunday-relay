import type { RelayError } from './errors';
import { relayError } from './errors';

/**
 * relay.protocol.v1 — the only supported protocol version.
 * Compatibility behavior (PROTOCOL.md §0):
 * - matching version: accepted;
 * - unsupported (future/other) version: structured `protocol-mismatch` error;
 * - missing version: `protocol-mismatch` (never silently defaulted);
 * - malformed (non-string) version: `protocol-mismatch`.
 */
export const RELAY_PROTOCOL_VERSION = 'relay.protocol.v1' as const;
export type RelayProtocolVersion = typeof RELAY_PROTOCOL_VERSION;

export function checkProtocolVersion(value: unknown): RelayError | null {
  if (value === RELAY_PROTOCOL_VERSION) return null;
  const detail =
    value === undefined || value === null
      ? 'protocolVersion is missing'
      : typeof value !== 'string'
        ? 'protocolVersion is malformed (not a string)'
        : `protocolVersion "${value}" is not supported`;
  return relayError('protocol-mismatch', `${detail}; this build speaks ${RELAY_PROTOCOL_VERSION} only.`, {
    retryable: false,
  });
}
