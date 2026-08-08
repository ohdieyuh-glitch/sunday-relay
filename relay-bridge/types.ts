/**
 * Bridge wire types. The response shape is the shared mission wire contract
 * `LiveMissionUpdate` (imported type-only, so the wire and the browser store
 * can never drift — both read the same declaration). `BridgeEventInput` is
 * what the orchestration emits before the mission assigns a monotonic
 * sequence + timestamp.
 */

import type {
  CodingTerminalLine,
  CodingTerminalState,
  EventTruthClass,
  LiveMissionUpdate,
  MissionArchitectReceipt,
  MissionAttestationSummary,
  MissionClaim,
  MissionError,
  MissionHandoff,
  MissionPhase,
  MissionReview,
  MissionReviewFinding,
  MissionRole,
  RelayMissionState,
  TerminalEventCategory,
} from '../src/relay/mission/wire-contracts';

export type { LiveMissionUpdate, MissionClaim, MissionError, MissionHandoff, MissionRole, RelayMissionState };
export type { MissionArchitectReceipt, MissionAttestationSummary, MissionPhase, MissionReview, MissionReviewFinding };
export type { CodingTerminalLine, CodingTerminalState };
export type { EventTruthClass, TerminalEventCategory };

/** A normalized event before the mission assigns `sequence`, `at`, and the
    mission revision. Every reference here is already safe: a redacted
    execution reference, an attestation id, or an artifact digest. */
export interface BridgeEventInput {
  role: MissionRole;
  category: TerminalEventCategory;
  truth: EventTruthClass;
  headline: string;
  detail?: string;
  meta?: string;
  done?: boolean;
  findingId?: string;
  repairId?: string;
  /** Shortened/redacted reference to the execution the event describes. */
  executionRef?: string;
  attestationRef?: string;
  artifactRef?: string;
}

/** Body of POST /relay-api/mission/start. */
export interface StartMissionRequest {
  /** The browser mission id (e.g. "rly-002-msn-1") — the idempotency key. One
      dispatch per mission id, ever. */
  missionId: string;
  /** The controlled task objective (the founder's Ask Relay request). */
  objective: string;
  /**
   * Who is asking, for the controlled beta.
   *
   * OPTIONAL IN THE TYPE, REQUIRED BY THE GUARD WHEN THE BETA IS ON. A bridge
   * with the beta off never reads it, and making it mandatory here would break
   * every existing caller for a feature they have not opted into. When the beta
   * IS on, a request without it is refused — which is the point.
   */
  participantId?: string;
}
