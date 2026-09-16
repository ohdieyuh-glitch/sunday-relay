import type { JuliusBrainResponse, JuliusBrainServiceOperation } from './julius-brain-service-api';

/**
 * ONE REQUEST, ONE EFFECT, HOWEVER OFTEN IT IS ASKED.
 *
 * A client that loses a response cannot tell whether the Brain did the work. It
 * repeats the request, and the service answers what it answered the first time
 * rather than doing it again:
 *
 *   same request id, same request     the first answer, marked `replayed`
 *   same request id, another request  refused `request_id_conflict`: a request
 *                                     id is a promise about which request it is
 *   another request id, same facts    the Brain's own idempotency decides — a
 *                                     draft's idempotency key, an attempt's
 *                                     preservation, a recovery's content hash
 *
 * The log is keyed by the attempt AND the request id, so one run's ids can never
 * collide with another's, and a request id from a different attempt is a
 * different request. Entries hold the digest of the request and the answer, never
 * a token: a digest is what a repeat is compared against.
 *
 * A second caller arriving while the first is still working is told
 * `request_in_flight` rather than being allowed to do the work twice.
 */

export interface JuliusBrainRequestEntry {
  readonly key: string;
  readonly requestDigest: string;
  readonly operation: JuliusBrainServiceOperation;
  readonly response: JuliusBrainResponse | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export type JuliusBrainRequestBegin =
  | { readonly state: 'NEW' }
  | { readonly state: 'REPLAY'; readonly response: JuliusBrainResponse }
  | { readonly state: 'IN_FLIGHT' }
  | { readonly state: 'CONFLICT'; readonly heldDigest: string; readonly heldOperation: JuliusBrainServiceOperation };

export interface JuliusBrainRequestLog {
  /** Claim a request id for this attempt, or say what is already held under it. */
  begin(input: { readonly key: string; readonly requestDigest: string; readonly operation: JuliusBrainServiceOperation; readonly at: string }): Promise<JuliusBrainRequestBegin>;
  /** Record the answer, so a repeat returns it. */
  complete(input: { readonly key: string; readonly response: JuliusBrainResponse; readonly at: string }): Promise<void>;
  /** Release a claim whose work never ran (the call was refused before any effect). */
  abandon(input: { readonly key: string }): Promise<void>;
  read(key: string): Promise<JuliusBrainRequestEntry | null>;
}

export const juliusBrainRequestKey = (brainRunId: string, requestId: string): string => `${brainRunId}#${requestId}`;

export function createJuliusBrainRequestMemoryLog(): JuliusBrainRequestLog & { readonly size: () => number } {
  const entries = new Map<string, JuliusBrainRequestEntry>();
  return {
    size: () => entries.size,
    async begin({ key, requestDigest, operation, at }) {
      const held = entries.get(key);
      if (held === undefined) {
        entries.set(key, { key, requestDigest, operation, response: null, startedAt: at, completedAt: null });
        return { state: 'NEW' };
      }
      if (held.requestDigest !== requestDigest) return { state: 'CONFLICT', heldDigest: held.requestDigest, heldOperation: held.operation };
      return held.response === null ? { state: 'IN_FLIGHT' } : { state: 'REPLAY', response: held.response };
    },
    async complete({ key, response, at }) {
      const held = entries.get(key);
      if (held !== undefined) entries.set(key, { ...held, response, completedAt: at });
    },
    async abandon({ key }) {
      const held = entries.get(key);
      if (held !== undefined && held.response === null) entries.delete(key);
    },
    async read(key) { return entries.get(key) ?? null; },
  };
}
