/**
 * YUJI's reader for one admitted Julius mission.
 *
 * `read` derives `traceId` and each phase `spanId` from the admitted `wlj_`
 * id by calling `scripts/julius-mission-trace.mjs`. A trace id on the phase
 * source, on a receipt, or on a dispatch payload is not read. Legacy `run:`
 * ids and `preflight:` ids return null. The spend tag stays the spend record;
 * these ids are correlation only.
 *
 * BRIDGE accepts the value and derives the same ids again. Production wires
 * the phase source from the run's own tasks. This module does not mount a route.
 */

import {
  juliusMissionSpanId,
  juliusMissionTraceId,
  juliusMissionTraceparent,
} from '../scripts/julius-mission-trace.mjs';

export interface JuliusMissionEvidencePhaseIdentity {
  readonly role: string;
  readonly stage: string | null;
  readonly attempt: number | null;
  readonly state: string;
}

/**
 * Phase identities only. Trace ids are not a field of this source, so a
 * stored or dispatch-supplied trace id has nowhere to enter.
 */
export interface JuliusMissionEvidenceSource {
  phases(wljRunId: string): Promise<readonly JuliusMissionEvidencePhaseIdentity[] | null>;
}

export interface JuliusMissionEvidencePhaseTrace {
  readonly role: string;
  readonly state: string;
  readonly stage: string | null;
  readonly attempt: number | null;
  readonly spanId: string | null;
  readonly traceparent: string | null;
}

export interface JuliusMissionEvidenceTrace {
  readonly traceId: string | null;
  /** The mission record is not a span. */
  readonly traceparent: null;
  readonly phases: readonly JuliusMissionEvidencePhaseTrace[] | null;
}

export interface JuliusMissionEvidenceReader {
  read(wljRunId: string): Promise<JuliusMissionEvidenceTrace>;
}

export function createJuliusMissionEvidenceReader(source: JuliusMissionEvidenceSource): JuliusMissionEvidenceReader {
  return {
    async read(wljRunId: string): Promise<JuliusMissionEvidenceTrace> {
      const traceId = juliusMissionTraceId(wljRunId);
      const identities = await source.phases(wljRunId);
      if (identities === null) return { traceId, traceparent: null, phases: null };
      return {
        traceId,
        traceparent: null,
        phases: identities.map((phase) => {
          const spanId = juliusMissionSpanId(wljRunId, phase.role, phase.stage, phase.attempt);
          return {
            role: phase.role,
            state: phase.state,
            stage: phase.stage,
            attempt: phase.attempt,
            spanId,
            traceparent: juliusMissionTraceparent(traceId, spanId),
          };
        }),
      };
    },
  };
}
