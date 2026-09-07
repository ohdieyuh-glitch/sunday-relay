/**
 * ONE WORLD'S SESSION — the fold that actually drives a dog.
 *
 * Everything else in this seam is a layer with one job: the envelope says what
 * may cross, the cursor says which fact is newer, the transition table says
 * which moves Julius can make, the animation plan says what a renderer should
 * do. Held apart they are testable; held apart they are also not a product.
 * This is where they compose, and it is deliberately the only place they do —
 * a second composition would be a second answer to "what is the world showing".
 *
 * THE ORDER OF THE THREE CHECKS IS THE DESIGN.
 *
 *   1. ORDERING, first. An event that is stale, duplicated or misrouted is not
 *      a state change at all, and running the state machine over it would be
 *      asking whether a move is legal before establishing that the move
 *      happened.
 *   2. LEGALITY, second. An in-order event can still say something Julius
 *      cannot have done — or something that would retract a completion — and
 *      that is a different refusal with a different diagnosis.
 *   3. PRESENTATION, last, and only for what survived. The animation plan is
 *      computed from the transition that was actually taken, so a refused event
 *      cannot move the dog even by accident.
 *
 * WHAT IT WILL NOT DO: hold a timer, own a socket, or decide anything about
 * money. It is a pure fold from (session, envelope) to (session, decision).
 */

import { exactKeys } from './wonderland-contracts';
import type { WonderlandDogAnimation, WonderlandDogOverlay } from './wonderland-contracts';
import { JULIUS_UNOBSERVED_REASON, JULIUS_VISUAL_STATE_ACTIVITY } from './wonderland-julius-state';
import type { JuliusStateSource, JuliusVisualState } from './wonderland-julius-state';
import { officialRelayDogBehavior } from '../../shared/official-relay-dog-states';
import {
  planWonderlandAnimationFor,
  wonderlandClipForJuliusState,
} from './wonderland-julius-animation';
import type { WonderlandAnimationPlan } from './wonderland-julius-animation';
import { applyWonderlandOrdering, openWonderlandCursor } from './wonderland-ordering';
import type {
  WonderlandCursor,
  WonderlandOrderingVerdict,
} from './wonderland-ordering';
import { wonderlandVisualDecision } from './wonderland-visual-transitions';
import type { WonderlandVisualVerdict } from './wonderland-visual-transitions';
import type { WonderlandEnvelope, WonderlandWorkerRole } from './wonderland-envelope';
import { adoptWonderlandSnapshot } from './wonderland-rehydration';
import type { WonderlandRunSnapshot } from './wonderland-rehydration';

/* ------------------------------------------------------------ versioning */

export const WONDERLAND_SESSION_SCHEMA_V1 = 'relay-wonderland-session.v1' as const;
export type WonderlandSessionSchemaVersion = typeof WONDERLAND_SESSION_SCHEMA_V1;

/* -------------------------------------------------------------- the state */

export interface WonderlandSession {
  readonly schemaVersion: WonderlandSessionSchemaVersion;
  readonly projectId: string;
  readonly worldSessionId: string | null;
  readonly missionId: string | null;
  /** What the wire has established, including everything it refused. */
  readonly cursor: WonderlandCursor;

  /** Null means Relay has said nothing. It is NOT `idle`. */
  readonly visualState: JuliusVisualState | null;
  readonly stateSource: JuliusStateSource | null;
  readonly sourceState: string | null;
  readonly workerRole: WonderlandWorkerRole | null;
  /** Set only by a real ending. No transport condition can set it. */
  readonly terminal: boolean;
  /** A sentence whenever `visualState` is null. Never a bare absence. */
  readonly unobservedReason: string | null;
  readonly observedAtIso: string | null;

  /** The clip a renderer should currently be playing. */
  readonly clip: WonderlandDogAnimation;
  /** Null when unobserved — an unknown state neither asks nor rests. */
  readonly attentionRequired: boolean | null;

  /** In-order events the state machine refused. Distinct from stale ones. */
  readonly illegalTransitionsRefused: number;
  /** The most recent refusal of any kind, as a sentence Relay wrote. */
  readonly lastRefusalReason: string | null;
}

export const WONDERLAND_SESSION_FIELDS = exactKeys<WonderlandSession>()([
  'schemaVersion',
  'projectId',
  'worldSessionId',
  'missionId',
  'cursor',
  'visualState',
  'stateSource',
  'sourceState',
  'workerRole',
  'terminal',
  'unobservedReason',
  'observedAtIso',
  'clip',
  'attentionRequired',
  'illegalTransitionsRefused',
  'lastRefusalReason',
]);

export function openWonderlandSession(input: {
  readonly projectId: string;
  readonly worldSessionId?: string | null;
  readonly juliusInstanceId?: string | null;
  readonly runId?: string | null;
}): WonderlandSession {
  return Object.freeze({
    schemaVersion: WONDERLAND_SESSION_SCHEMA_V1,
    projectId: input.projectId,
    worldSessionId: input.worldSessionId ?? null,
    missionId: null,
    cursor: openWonderlandCursor({
      projectId: input.projectId,
      juliusInstanceId: input.juliusInstanceId ?? null,
      runId: input.runId ?? null,
    }),
    visualState: null,
    stateSource: null,
    sourceState: null,
    workerRole: null,
    terminal: false,
    unobservedReason: JULIUS_UNOBSERVED_REASON,
    observedAtIso: null,
    clip: 'dormant',
    attentionRequired: null,
    illegalTransitionsRefused: 0,
    lastRefusalReason: null,
  });
}

/* ------------------------------------------------------------ the outcome */

/**
 * What one envelope did.
 *
 * The PLAN IS NULL WHEN NOTHING WAS APPLIED, rather than a `hold`. A hold is a
 * real instruction — keep playing, do not restart — and returning one for a
 * refused event would tell a renderer that a decision was made about it. Null
 * says no decision was reached, which is the truth.
 */
export interface WonderlandSessionOutcome {
  readonly session: WonderlandSession;
  readonly ordering: WonderlandOrderingVerdict;
  /** Null when ordering refused it, because legality was never asked. */
  readonly legality: WonderlandVisualVerdict | null;
  readonly plan: WonderlandAnimationPlan | null;
  readonly reason: string | null;
}

/**
 * Whether a state asks for a human, READ from the shared behaviour rather than
 * decided here.
 *
 * `officialRelayDogBehavior` is what the website's own dog uses, so the two
 * surfaces cannot disagree about whether a founder is being waited on — which
 * is the single fact most likely to be restated slightly differently in two
 * places and then to drift.
 */
const asksForAHuman = (state: JuliusVisualState): boolean =>
  officialRelayDogBehavior(JULIUS_VISUAL_STATE_ACTIVITY[state]).attentionRequired;

const ORDERING_REASONS: Readonly<Record<Exclude<WonderlandOrderingVerdict, 'applied'>, string>> =
  Object.freeze({
    duplicate: 'This event has already been applied; the wire delivered it twice.',
    stale_sequence: 'This event is behind the position already applied for its run.',
    stale_revision: 'This run has already moved past the state this event describes.',
    foreign_project: 'This event belongs to another world.',
    foreign_julius: 'This event belongs to a different Julius instance.',
    foreign_run: 'This event belongs to a run this world is not following.',
    malformed: 'This event is missing the identity or ordering it needs to be used.',
  });

/**
 * Fold one envelope in.
 *
 * A REFUSAL AT ANY STAGE LEAVES THE VISUAL STATE EXACTLY WHERE IT WAS. That is
 * the property worth stating: a world under a misbehaving stream keeps showing
 * the last thing it had good reason to believe, rather than degrading toward a
 * default. It also keeps the counters honest — every refusal lands in exactly
 * one counter, so "quiet" and "drowning in rejects" are never confusable.
 */
export function applyWonderlandEnvelope(
  session: WonderlandSession,
  envelope: WonderlandEnvelope,
  input: { readonly overlay?: WonderlandDogOverlay } = {},
): WonderlandSessionOutcome {
  const ordered = applyWonderlandOrdering(session.cursor, envelope);

  if (ordered.verdict !== 'applied') {
    const reason = ORDERING_REASONS[ordered.verdict];
    return Object.freeze({
      session: Object.freeze({ ...session, cursor: ordered.cursor, lastRefusalReason: reason }),
      ordering: ordered.verdict,
      legality: null,
      plan: null,
      reason,
    });
  }

  const decision = wonderlandVisualDecision({
    from: session.visualState,
    to: envelope.state,
    source: envelope.stateSource,
    terminal: session.terminal,
  });

  if (decision.verdict !== 'applied') {
    return Object.freeze({
      // The CURSOR still advances: the event was delivered in order, and
      // refusing its content is not a reason to ask for it again.
      session: Object.freeze({
        ...session,
        cursor: ordered.cursor,
        illegalTransitionsRefused: session.illegalTransitionsRefused + 1,
        lastRefusalReason: decision.reason,
      }),
      ordering: ordered.verdict,
      legality: decision.verdict,
      plan: null,
      reason: decision.reason,
    });
  }

  const attentionRequired = asksForAHuman(envelope.state);
  const plan = planWonderlandAnimationFor({
    fromClip: session.clip,
    toState: envelope.state,
    terminal: envelope.terminal || session.terminal,
    attentionRequired,
    overlay: input.overlay,
  });

  return Object.freeze({
    session: Object.freeze({
      ...session,
      cursor: ordered.cursor,
      // Identity is LEARNED and never overwritten with null by a broader event.
      missionId: envelope.missionId ?? session.missionId,
      worldSessionId: envelope.worldSessionId ?? session.worldSessionId,
      visualState: envelope.state,
      stateSource: envelope.stateSource,
      sourceState: envelope.sourceState,
      workerRole: envelope.workerRole ?? session.workerRole,
      terminal: session.terminal || envelope.terminal,
      unobservedReason: null,
      observedAtIso: envelope.occurredAt,
      clip: plan.to,
      attentionRequired,
    }),
    ordering: ordered.verdict,
    legality: decision.verdict,
    plan,
    reason: null,
  });
}

/** Fold many, in order. Each is judged against what the last one left. */
export function applyWonderlandEnvelopes(
  session: WonderlandSession,
  envelopes: readonly WonderlandEnvelope[],
): WonderlandSession {
  return envelopes.reduce(
    (current, envelope) => applyWonderlandEnvelope(current, envelope).session,
    session,
  );
}

/**
 * Recover from an authoritative snapshot.
 *
 * The state is SET, and the clip with it, so a client joining mid-CODING shows
 * CODING. No animation plan is returned: arriving at a state you were never
 * watching is not a transition, and handing a renderer a `wake` into the middle
 * of a mission would perform an entrance that never happened. A renderer
 * adopting a recovered session should show the clip, not play into it.
 */
export function recoverWonderlandSession(
  session: WonderlandSession,
  snapshot: WonderlandRunSnapshot,
): WonderlandSessionOutcome {
  const recovery = adoptWonderlandSnapshot(session.cursor, snapshot);

  if (recovery.verdict !== 'adopted' || recovery.visualState === null) {
    return Object.freeze({
      session: Object.freeze({ ...session, lastRefusalReason: recovery.reason }),
      ordering: 'applied',
      legality: null,
      plan: null,
      reason: recovery.reason,
    });
  }

  return Object.freeze({
    session: Object.freeze({
      ...session,
      cursor: recovery.cursor,
      missionId: snapshot.missionId ?? session.missionId,
      visualState: recovery.visualState,
      // The kernel's own word is the most precise source there is.
      stateSource: 'julius_run_state' as JuliusStateSource,
      sourceState: recovery.sourceState,
      terminal: recovery.terminal,
      unobservedReason: null,
      observedAtIso: snapshot.observedAtIso,
      clip: wonderlandClipForJuliusState(recovery.visualState),
      attentionRequired: asksForAHuman(recovery.visualState),
    }),
    ordering: 'applied',
    legality: 'applied',
    plan: null,
    reason: null,
  });
}
