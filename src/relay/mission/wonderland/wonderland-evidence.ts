/**
 * HOW MUCH A CLAIM ABOUT THIS SEAM IS ACTUALLY WORTH.
 *
 * The handoff document carries a five-rung table saying what is REAL, what is
 * INTEGRATION-READY and what is SIMULATED. A table in a document is a promise
 * that whoever writes the next sentence will read it first, and the failure
 * mode this whole stream is built against is a true-sounding sentence written
 * by someone who did not.
 *
 * So the ladder is executable here. A capture of Julius events carries where it
 * came from, and the verifier decides which rung it establishes. Two properties
 * make that worth having rather than decorative:
 *
 *   1. `real` IS UNREACHABLE FROM THIS MODULE. `real` means a live Julius run
 *      drove the world AS IT RAN. A replay is not that, however genuine the
 *      recording — the events are real and the driving is not. No input to
 *      `verifyWonderlandCapture` can produce it, and a test pins that.
 *
 *   2. CLAIMING A LIVE ORIGIN COSTS SOMETHING. A capture may only call itself
 *      recorded from a live run if it names the run and when it was taken.
 *      Without both it is downgraded to synthesised, silently in the data and
 *      loudly in the reason. A field nobody can fill in by accident is a weak
 *      guarantee but it is the strongest one available to a pure function, and
 *      it turns "did anyone check?" into a value you can read.
 *
 * WHAT THIS IS FOR, concretely: nothing in this repository has ever sat above
 * `integration_ready`, because no real Julius event has ever been captured.
 * When one is, this is what turns the recording into a claim — and refuses to
 * if the recording does not support it.
 */

import { exactKeys } from './wonderland-contracts';
import type { JuliusOperationalEvent } from '../julius/julius-events';
import {
  applyJuliusEvent,
  emptyJuliusEmbodiment,
} from './wonderland-julius-state';
import type { JuliusVisualState } from './wonderland-julius-state';
import { normalizeJuliusOperationalEvents } from './wonderland-julius-normalizer';
import type { JuliusNormalizationIdentity } from './wonderland-julius-normalizer';

/* ------------------------------------------------------------ versioning */

export const WONDERLAND_CAPTURE_SCHEMA_V1 = 'relay-wonderland-capture.v1' as const;
export type WonderlandCaptureSchemaVersion = typeof WONDERLAND_CAPTURE_SCHEMA_V1;

/* --------------------------------------------------------------- the ladder */

/**
 * The five rungs, WEAKEST FIRST so the order is the comparison.
 *
 *   not_built                nothing exists to exercise
 *   simulated                exercised by input this repository invented
 *   integration_ready        the contract exists and ran; no state demonstrated
 *   recorded_event_verified  real events, replayed, and they moved the world
 *   real                     a live run drove the world as it ran
 *
 * The gap between the last two is the one people collapse, and it is the only
 * one that matters commercially: a founder told "Julius is connected" will
 * believe the fifth rung and be shown the fourth.
 */
export const WONDERLAND_EVIDENCE_LEVELS = [
  'not_built',
  'simulated',
  'integration_ready',
  'recorded_event_verified',
  'real',
] as const;
export type WonderlandEvidenceLevel = (typeof WONDERLAND_EVIDENCE_LEVELS)[number];

const RUNG: ReadonlyMap<WonderlandEvidenceLevel, number> = new Map(
  WONDERLAND_EVIDENCE_LEVELS.map((level, index) => [level, index]),
);

/** True when `level` is at least as strong as `floor`. Order is the table's. */
export const wonderlandEvidenceAtLeast = (
  level: WonderlandEvidenceLevel,
  floor: WonderlandEvidenceLevel,
): boolean => (RUNG.get(level) ?? -1) >= (RUNG.get(floor) ?? Number.POSITIVE_INFINITY);

/**
 * The rungs a CAPTURE can establish. Two, out of five.
 *
 * Declared as data so the limitation is a value a caller can read rather than a
 * paragraph they have to find. `real` needs a live run and `integration_ready`
 * is a property of the code rather than of any recording, so neither is
 * something a replay could award itself.
 */
export const WONDERLAND_CAPTURE_ESTABLISHES: readonly WonderlandEvidenceLevel[] = Object.freeze([
  'simulated',
  'recorded_event_verified',
]);

/* -------------------------------------------------------------- a capture */

/**
 * WHERE A CAPTURE CAME FROM.
 *
 * `synthesised` is ordinal 0 and the default everywhere: a capture that did not
 * say is one this repository wrote, which is the assumption that can only ever
 * understate the evidence.
 */
export const WONDERLAND_CAPTURE_ORIGINS = ['synthesised', 'recorded_from_live_run'] as const;
export type WonderlandCaptureOrigin = (typeof WONDERLAND_CAPTURE_ORIGINS)[number];

export interface WonderlandCapture {
  readonly schemaVersion: WonderlandCaptureSchemaVersion;
  readonly captureId: string;
  readonly origin: WonderlandCaptureOrigin;
  /** The Julius run recorded. Required to claim a live origin. */
  readonly sourceRunId: string | null;
  /** When the recording was taken. Required to claim a live origin. */
  readonly capturedAtIso: string | null;
  readonly projectId: string;
  readonly events: readonly JuliusOperationalEvent[];
}

export const WONDERLAND_CAPTURE_FIELDS = exactKeys<WonderlandCapture>()([
  'schemaVersion',
  'captureId',
  'origin',
  'sourceRunId',
  'capturedAtIso',
  'projectId',
  'events',
] as const);

/**
 * Build a capture, DOWNGRADING a live claim that is not paid for.
 *
 * The downgrade happens here rather than at verification so the stored record
 * itself is honest: a file on disk saying `recorded_from_live_run` with no run
 * id would be a lie sitting in the repository waiting to be quoted, and it
 * would survive being read by something that never called the verifier.
 */
export function wonderlandCapture(input: {
  readonly captureId: string;
  readonly projectId: string;
  readonly events: readonly JuliusOperationalEvent[];
  readonly origin?: WonderlandCaptureOrigin;
  readonly sourceRunId?: string | null;
  readonly capturedAtIso?: string | null;
}): WonderlandCapture {
  const runId = (input.sourceRunId ?? '').trim();
  const at = (input.capturedAtIso ?? '').trim();
  const claimsLive = input.origin === 'recorded_from_live_run';
  const paidFor = runId.length > 0 && at.length > 0;
  const origin: WonderlandCaptureOrigin =
    claimsLive && paidFor ? 'recorded_from_live_run' : 'synthesised';
  return Object.freeze({
    schemaVersion: WONDERLAND_CAPTURE_SCHEMA_V1,
    captureId: input.captureId,
    origin,
    // Kept even when the claim was downgraded: a partially-filled record is
    // evidence of what someone was trying to record, and discarding it would
    // make the downgrade unexplainable afterwards.
    sourceRunId: runId.length > 0 ? runId : null,
    capturedAtIso: at.length > 0 ? at : null,
    projectId: input.projectId,
    events: Object.freeze([...input.events]),
  });
}

/* ------------------------------------------------------------ the verdict */

export interface WonderlandEvidence {
  readonly level: WonderlandEvidenceLevel;
  /** Always a sentence. A level with no explanation is a number to argue with. */
  readonly reason: string;
  readonly origin: WonderlandCaptureOrigin;
  /** Kernel events in the capture. */
  readonly eventsCaptured: number;
  /** World events the normalizer produced from them. */
  readonly eventsNormalized: number;
  /** Kernel events the model does not map. Not an error — most are not states. */
  readonly silentEvents: number;
  /** World events the reducer applied. */
  readonly eventsApplied: number;
  /** Distinct visual states the replay actually reached, in order of arrival. */
  readonly statesObserved: readonly JuliusVisualState[];
  readonly reachedTerminal: boolean;
}

export const WONDERLAND_EVIDENCE_FIELDS = exactKeys<WonderlandEvidence>()([
  'level',
  'reason',
  'origin',
  'eventsCaptured',
  'eventsNormalized',
  'silentEvents',
  'eventsApplied',
  'statesObserved',
  'reachedTerminal',
] as const);

/**
 * Replay a capture through the real seam and say what it established.
 *
 * The same normalizer and the same reducer a live stream would use — a verifier
 * with its own simplified fold would be measuring code that does not ship.
 *
 * `nextEventId` is injected for the same reason it is everywhere else in this
 * seam: an id generated in here would be non-deterministic, and a verdict that
 * changed between two runs of the same capture is not evidence of anything.
 */
export function verifyWonderlandCapture(
  capture: WonderlandCapture,
  input: {
    readonly nextEventId: (event: JuliusOperationalEvent, index: number) => string;
    readonly identity?: JuliusNormalizationIdentity;
  },
): WonderlandEvidence {
  const normalized = normalizeJuliusOperationalEvents(capture.events, {
    baseSequence: 0,
    nextEventId: input.nextEventId,
    identity: input.identity,
  });

  const seen: JuliusVisualState[] = [];
  let embodiment = emptyJuliusEmbodiment({ projectId: capture.projectId });
  let applied = 0;
  for (const event of normalized.events) {
    const before = embodiment;
    embodiment = applyJuliusEvent(embodiment, event);
    if (embodiment.sequence > before.sequence) applied += 1;
    const state = embodiment.visualState;
    if (state !== null && !seen.includes(state)) seen.push(state);
  }

  const observed = seen.length > 0;
  const level: WonderlandEvidenceLevel = !observed
    ? // The contract ran and demonstrated no state. That is exactly what
      // integration-ready means, and it is true regardless of where the events
      // came from — a real recording of events the model does not map proves
      // the code works and nothing about the world moving.
      'integration_ready'
    : capture.origin === 'recorded_from_live_run'
      ? 'recorded_event_verified'
      : 'simulated';

  return Object.freeze({
    level,
    reason: reasonFor(level, capture, seen.length),
    origin: capture.origin,
    eventsCaptured: capture.events.length,
    eventsNormalized: normalized.events.length,
    silentEvents: normalized.silentEvents,
    eventsApplied: applied,
    statesObserved: Object.freeze([...seen]),
    reachedTerminal: embodiment.terminal,
  });
}

function reasonFor(
  level: WonderlandEvidenceLevel,
  capture: WonderlandCapture,
  states: number,
): string {
  if (level === 'integration_ready') {
    return capture.events.length === 0
      ? 'This capture holds no events, so it establishes nothing beyond the contract existing.'
      : 'The seam ran over this capture and no event in it produced a visual state.';
  }
  if (level === 'recorded_event_verified') {
    return `Replayed ${capture.events.length} events recorded from run ${String(
      capture.sourceRunId,
    )}, reaching ${states} visual ${states === 1 ? 'state' : 'states'}. Real events, replayed — NOT a live run driving the world.`;
  }
  return 'These events were written by this repository, so the replay demonstrates the seam and not a real mission.';
}

/**
 * THE CLAIM A PERSON MAY MAKE, given a verdict. One wording, in one place.
 *
 * Exists because the sentence is the thing that gets copied into a demo script
 * or a README, and a level rendered by whoever happens to be writing is how
 * `recorded_event_verified` becomes "Julius is connected".
 */
export function wonderlandEvidenceClaim(evidence: WonderlandEvidence): string {
  switch (evidence.level) {
    case 'real':
      return 'A live Julius mission drove this world.';
    case 'recorded_event_verified':
      return 'Real Julius events have been replayed through this seam. No live run has driven the world.';
    case 'integration_ready':
      return 'This seam is integration-ready. No Julius event has moved it.';
    case 'simulated':
      return 'This is a simulated run using events written by this repository.';
    case 'not_built':
      return 'This is not built.';
  }
}
