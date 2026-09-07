/**
 * THE ANIMATION PLAN — what a renderer should DO when Julius's state changes.
 *
 * The state layer answers "what is Julius doing". The clip table answers "which
 * clip depicts that". Neither answers the question a renderer actually has at
 * the moment a state changes, which is: do I blend into this, cut to it, or
 * leave what is playing alone?
 *
 * WHY THAT IS A CONTRACT AND NOT A RENDERER'S BUSINESS. Two surfaces draw this
 * dog. If each decided its own blend rules, the browser would ease into an error
 * the world cut to, and the same mission would feel urgent in one and calm in
 * the other. So the DECISION lives here as data and the EXECUTION lives in the
 * renderer — which is also what makes the clips replaceable: a real animation
 * asset drops in behind a plan that never mentioned it.
 *
 * THE ONE RULE THAT IS NOT ABOUT AESTHETICS. A state that needs a human is
 * `interrupt`: it cuts. Every other transition blends. A blocked mission and a
 * failed one are the two states a founder has to notice, and a graceful
 * quarter-second cross-fade into "your agent stopped" is a quarter second spent
 * making the most important frame in the session look like the others.
 *
 * WHAT THIS FILE DOES NOT DO: it plays nothing, holds no timer, and names no
 * asset. It is a pure function of two embodiments.
 */

import { exactKeys, wonderlandAnimationFor } from './wonderland-contracts';
import type { WonderlandDogAnimation, WonderlandDogOverlay } from './wonderland-contracts';
import {
  JULIUS_VISUAL_STATES,
  JULIUS_VISUAL_STATE_ACTIVITY,
  isJuliusEndingState,
} from './wonderland-julius-state';
import type { JuliusEmbodiment, JuliusVisualState } from './wonderland-julius-state';
import { OFFICIAL_RELAY_DOG_ACTIVITY_MOTION } from '../../shared/official-relay-dog-states';
import type { OfficialRelayDogActivity } from '../../shared/official-relay-dog-states';

/* ------------------------------------------------------------ versioning */

export const WONDERLAND_ANIMATION_SCHEMA_V1 = 'relay-wonderland-animation.v1' as const;
export type WonderlandAnimationSchemaVersion = typeof WONDERLAND_ANIMATION_SCHEMA_V1;

/* ----------------------------------------------------------- transitions */

/**
 * HOW to get from the clip that is playing to the one that should be.
 *
 *   hold        the same clip. Do NOT restart it — a looping walk that
 *               restarted every time an unrelated event arrived would twitch
 *               once per event, which reads as the world stuttering
 *   wake        from `dormant`. The world has just learned what Julius is
 *               doing, and arriving is worth seeing
 *   cross_fade  the ordinary case: one piece of work becoming another
 *   interrupt   a state that needs a human. CUTS. See the rule above
 *   settle      into a real ending. Slower than a cross-fade on purpose —
 *               a finish that snaps reads as a failure
 *   dormant     back to no observation. The only transition that removes
 *               information, so it is slow and never a cut
 */
export const WONDERLAND_ANIMATION_TRANSITIONS = [
  'hold',
  'wake',
  'cross_fade',
  'interrupt',
  'settle',
  'dormant',
] as const;
export type WonderlandAnimationTransition =
  (typeof WONDERLAND_ANIMATION_TRANSITIONS)[number];

/**
 * Blend durations, in milliseconds.
 *
 * `interrupt` is 0 and that is the point — it is a cut, not a fast blend.
 * Everything else is long enough to read as motion rather than as a glitch.
 * These are the numbers both surfaces use; a renderer that picked its own would
 * be the drift this module exists to prevent.
 */
export const WONDERLAND_ANIMATION_BLEND_MS: Readonly<
  Record<WonderlandAnimationTransition, number>
> = Object.freeze({
  hold: 0,
  wake: 260,
  cross_fade: 180,
  interrupt: 0,
  settle: 420,
  dormant: 520,
});

/* ------------------------------------------------------------- the clips */

/**
 * Activity to clip, DERIVED rather than restated.
 *
 * The chain activity → motion → clip lives in two modules and a plan needs the
 * end of it. Composing it here rather than typing out eleven pairs means a clip
 * renamed in the shared tables cannot leave a stale duplicate behind; a test
 * still holds this against both tables so the composition itself is checked.
 */
export const WONDERLAND_ACTIVITY_CLIP: Readonly<
  Record<OfficialRelayDogActivity, WonderlandDogAnimation>
> = Object.freeze(
  Object.fromEntries(
    (Object.keys(OFFICIAL_RELAY_DOG_ACTIVITY_MOTION) as OfficialRelayDogActivity[]).map(
      (activity) => [activity, wonderlandAnimationFor(OFFICIAL_RELAY_DOG_ACTIVITY_MOTION[activity])],
    ),
  ) as Record<OfficialRelayDogActivity, WonderlandDogAnimation>,
);

/**
 * WHICH CLIPS LOOP.
 *
 * Total over the animation vocabulary, so a clip added to the shared table has
 * to declare itself here before a renderer can play it. The distinction is real
 * work rather than bookkeeping: a looping clip is left alone across a `hold`,
 * and a one-shot has to be allowed to finish or it never plays at all.
 *
 * `attention_jump` loops because the request it depicts does not go away by
 * itself. `halt_slump` does not: a stopped agent settles once and stays
 * stopped, and a looping collapse would read as repeatedly falling over.
 */
export const WONDERLAND_ANIMATION_LOOPS: Readonly<Record<WonderlandDogAnimation, boolean>> =
  Object.freeze({
    dormant: true,
    patrol_walk: true,
    stand_still: true,
    attention_jump: true,
    work_scratch: true,
    scan_sniff: true,
    carry_walk: true,
    halt_slump: false,
    sleep_curl: true,
    dig_forward: true,
    code_type: true,
  });

/* -------------------------------------------------------------- the plan */

export interface WonderlandAnimationPlan {
  readonly schemaVersion: WonderlandAnimationSchemaVersion;
  /** The clip currently playing. `dormant` when nothing has been observed. */
  readonly from: WonderlandDogAnimation;
  readonly to: WonderlandDogAnimation;
  readonly transition: WonderlandAnimationTransition;
  readonly blendMs: number;
  /** Whether the destination clip loops. A one-shot must be allowed to finish. */
  readonly loop: boolean;
  /** Additive, never a replacement. Rides on top of whatever is playing. */
  readonly overlay: WonderlandDogOverlay;
  /** Null when unobserved — an unknown state neither asks nor rests. */
  readonly attentionRequired: boolean | null;
  /** Always a sentence. A renderer logging a transition should log WHY. */
  readonly reason: string;
}

export const WONDERLAND_ANIMATION_PLAN_FIELDS = exactKeys<WonderlandAnimationPlan>()([
  'schemaVersion',
  'from',
  'to',
  'transition',
  'blendMs',
  'loop',
  'overlay',
  'attentionRequired',
  'reason',
] as const);

/** The states whose arrival a person has to notice. Cut, never blend. */
const INTERRUPTING: ReadonlySet<JuliusVisualState> = new Set<JuliusVisualState>([
  'blocked',
  'error',
]);

function chooseTransition(input: {
  readonly from: WonderlandDogAnimation;
  readonly to: WonderlandDogAnimation;
  readonly toState: JuliusVisualState | null;
  readonly terminal: boolean;
}): { transition: WonderlandAnimationTransition; reason: string } {
  if (input.from === input.to) {
    return {
      transition: 'hold',
      reason: 'The clip has not changed. A looping clip must not restart.',
    };
  }
  if (input.to === 'dormant') {
    return {
      transition: 'dormant',
      reason: 'Relay is no longer reporting a state. The world rests rather than guessing.',
    };
  }
  if (input.toState !== null && INTERRUPTING.has(input.toState)) {
    return {
      transition: 'interrupt',
      reason: 'This state needs a person. It cuts so the frame that says so is the next one.',
    };
  }
  if (input.from === 'dormant') {
    return {
      transition: 'wake',
      reason: 'The world has just learned what Julius is doing.',
    };
  }
  if (input.terminal && isJuliusEndingState(input.toState)) {
    return {
      transition: 'settle',
      reason: 'The mission ended. A finish that snaps reads as a failure.',
    };
  }
  return { transition: 'cross_fade', reason: 'One piece of work became another.' };
}

/**
 * The plan to get from one embodiment to the next.
 *
 * `previous` may be null — the first frame after a world loads has nothing
 * playing, which is a `wake` from `dormant` rather than a special case.
 *
 * THE OVERLAY IS CARRIED, NOT DECIDED. `WonderlandDogOverlay` is additive and
 * belongs to the loop signals rather than to the mission state, so a caller
 * that knows about a running Loop supplies it and this function passes it
 * through. Deciding it here would need loop state this module has no business
 * holding.
 */
export function planWonderlandAnimation(
  previous: JuliusEmbodiment | null,
  next: JuliusEmbodiment,
  input: { readonly overlay?: WonderlandDogOverlay } = {},
): WonderlandAnimationPlan {
  const from = previous?.animation ?? 'dormant';
  const to = next.animation;
  const { transition, reason } = chooseTransition({
    from,
    to,
    toState: next.visualState,
    terminal: next.terminal,
  });
  return Object.freeze({
    schemaVersion: WONDERLAND_ANIMATION_SCHEMA_V1,
    from,
    to,
    transition,
    blendMs: WONDERLAND_ANIMATION_BLEND_MS[transition],
    loop: WONDERLAND_ANIMATION_LOOPS[to],
    overlay: input.overlay ?? 'none',
    attentionRequired: next.attentionRequired,
    reason,
  });
}

/* ------------------------------------------------------ the clips needed */

/**
 * EVERY CLIP THE WORLD NEEDS TO DEPICT A REAL MISSION, DERIVED.
 *
 * Named as data rather than left in a document, so "have we got the assets" is
 * a test rather than a reading, and derived over the whole state vocabulary so
 * it cannot fall behind a state added later.
 *
 * THERE IS NO SMALLER HONEST PHASE ONE. Eleven states collapse to nine clips,
 * plus `dormant` for no observation — ten. Cutting any one of them leaves a
 * state with no way to be shown, and a state shown by a clip that means
 * something else is worse than a placeholder: a placeholder reads as missing,
 * a wrong clip reads as a fact. So this list is the floor, and every entry in
 * it is a replaceable slot: swap the asset behind a name and nothing above
 * changes.
 *
 * WHERE THE BODY IS DELIBERATELY AMBIGUOUS. `attention`, `verifying` and
 * `complete` all resolve to `stand_still` — three different facts that look the
 * same standing still. That is why `attentionRequired` and the embodiment's
 * `terminal` travel alongside the plan rather than being inferred from the
 * clip: a viewer tells those three apart by the HUD and the state readout, and
 * a renderer that tried to read them off the animation would get it wrong.
 */
export const WONDERLAND_REQUIRED_CLIPS: readonly WonderlandDogAnimation[] = Object.freeze([
  'dormant',
  ...new Set(
    JULIUS_VISUAL_STATES.map((state) => WONDERLAND_ACTIVITY_CLIP[JULIUS_VISUAL_STATE_ACTIVITY[state]]),
  ),
]);

/** The clip that depicts a state, or `dormant` when Relay has said nothing. */
export function wonderlandClipForJuliusState(
  state: JuliusVisualState | null,
): WonderlandDogAnimation {
  return state === null ? 'dormant' : WONDERLAND_ACTIVITY_CLIP[JULIUS_VISUAL_STATE_ACTIVITY[state]];
}
