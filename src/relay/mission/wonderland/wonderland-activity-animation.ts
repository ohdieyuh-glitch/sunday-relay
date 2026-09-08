/**
 * WHAT THE SEVEN SIGNALS LOOK LIKE, WITHOUT DECIDING WHAT THEY LOOK LIKE.
 *
 * `wonderland-julius-animation.ts` answers "which clip is playing" from the
 * PHASE, and there is one answer at a time because a run is coding or reviewing
 * or repairing, never two. The activity axis is concurrent — a Coding Agent can
 * be retrying while a swarm runs and an approval sits open — so it cannot map
 * onto the same channel. A signal that replaced the base clip would mean a run
 * stopped looking like it was coding the moment it retried.
 *
 * So signals produce ACCENTS: additive intents that ride on whatever the phase
 * is playing. The base clip stays the phase's, exactly as it is today, and this
 * module never touches it.
 *
 * AN ACCENT IS AN INTENT, NOT A CLIP, and the distinction is the whole reason
 * this can be written before the engine exists. `awaiting_input` says the world
 * should show that a person is being waited on; whether that is a raised head,
 * a UI pip or a colour is the renderer's business and can change without this
 * file moving. Naming clips here would be inventing animation assets, which is
 * exactly what must not happen without Unreal.
 *
 * PRIORITY IS DERIVED, NOT DECLARED. `JULIUS_ACTIVITY_SIGNALS` is already
 * ordered most-urgent-first — an open human gate above a degraded provider
 * above a retry above a swarm — and re-stating that order here would be a
 * second copy free to disagree with the first. The dominant accent is simply
 * the earliest signal in that vocabulary, so re-ordering the vocabulary
 * re-orders the world, once.
 */

import { JULIUS_ACTIVITY_SIGNALS } from './wonderland-julius-activity';
import type { JuliusActivitySignal } from './wonderland-julius-activity';
import { JULIUS_VISUAL_STATES } from './wonderland-julius-state';
import type { JuliusVisualState } from './wonderland-julius-state';
import { exactKeys } from './wonderland-contracts';

export const WONDERLAND_ACTIVITY_ANIMATION_SCHEMA_V1 =
  'relay-wonderland-activity-animation.v1' as const;

/**
 * The accents a world may be asked to show. INTENTS, in the product's words.
 *
 * Deliberately fewer than the signals: `retrying` and `switching_worker` are
 * both "this is being attempted again by other means", and a viewer does not
 * need two visual languages for one situation. Where two signals share an
 * accent the DOMINANT SIGNAL is still carried separately, so a renderer that
 * wants to distinguish them can, and one that does not is not forced to.
 */
export const WONDERLAND_ACTIVITY_ACCENTS = [
  /** A person is being waited on. The run is not working; it is asking. */
  'awaiting_input',
  /** Something failed and the run carried on. Degraded, NOT stopped. */
  'strained',
  /** The same work, attempted again or by other means. */
  'reattempting',
  /** More than one worker is present. What /MAS looks like from outside. */
  'accompanied',
  /** Reading before acting: context assembled for a worker. */
  'recalling',
] as const;
export type WonderlandActivityAccent = (typeof WONDERLAND_ACTIVITY_ACCENTS)[number];

/**
 * Which accent each signal asks for.
 *
 * TOTAL OVER THE SIGNAL VOCABULARY, and the test holds it that way: a signal
 * added without an accent would be a fact the world could not show, which is
 * the failure this table exists to make impossible.
 */
export const WONDERLAND_SIGNAL_ACCENT: Readonly<
  Record<JuliusActivitySignal, WonderlandActivityAccent>
> = Object.freeze({
  awaiting_approval: 'awaiting_input',
  provider_degraded: 'strained',
  recovering: 'strained',
  retrying: 'reattempting',
  switching_worker: 'reattempting',
  swarming: 'accompanied',
  retrieving_context: 'recalling',
});

/**
 * The visual states that END a run, mirroring the producer's set.
 *
 * Named here rather than imported so this module keeps no edge to the
 * producer — it is a presentation contract and the producer is a transport
 * one. The test holds the two lists together.
 */
export const WONDERLAND_TERMINAL_STATES: readonly JuliusVisualState[] = Object.freeze([
  'complete',
  'blocked',
  'error',
]);

export interface WonderlandActivityIntent {
  readonly schemaVersion: typeof WONDERLAND_ACTIVITY_ANIMATION_SCHEMA_V1;
  /**
   * Accents to show, most urgent first, deduplicated.
   *
   * A renderer may show all of them, the first n, or only the dominant one.
   * The ORDER is the contract; how many a surface has room for is not.
   */
  readonly accents: readonly WonderlandActivityAccent[];
  /** The single most urgent accent, or null when there is nothing to show. */
  readonly dominant: WonderlandActivityAccent | null;
  /**
   * The signal that produced the dominant accent.
   *
   * Carried because two signals can share an accent: a renderer that wants to
   * tell a retry from a reroute can, without the contract forcing two visual
   * languages on one that does not.
   */
  readonly dominantSignal: JuliusActivitySignal | null;
  /**
   * Whether the accents should INTERRUPT rather than blend in.
   *
   * True only for a human gate. Everything else is the run working — noisily,
   * perhaps — and a world that cut its animation for a retry would flicker
   * through a normal recovery. An open gate is different in kind: nothing is
   * happening until a person acts, and a viewer needs to notice.
   */
  readonly interrupt: boolean;
  /**
   * Suppressed because the run has ended.
   *
   * A finished run is not retrying and not waiting for anybody, whatever the
   * last signals said. The signals are KEPT on the activity reading — they are
   * the record of what was true while it ran — and simply not shown.
   */
  readonly suppressedByTerminal: boolean;
  /** Always a sentence. A renderer logging an accent should log why. */
  readonly reason: string;
}

export const WONDERLAND_ACTIVITY_INTENT_FIELDS = exactKeys<WonderlandActivityIntent>()([
  'schemaVersion',
  'accents',
  'dominant',
  'dominantSignal',
  'interrupt',
  'suppressedByTerminal',
  'reason',
] as const);

const ORDER = new Map<JuliusActivitySignal, number>(
  JULIUS_ACTIVITY_SIGNALS.map((signal, index) => [signal, index]),
);

const TERMINAL = new Set<string>(WONDERLAND_TERMINAL_STATES);

const intent = (
  accents: readonly WonderlandActivityAccent[],
  dominantSignal: JuliusActivitySignal | null,
  suppressedByTerminal: boolean,
  reason: string,
): WonderlandActivityIntent =>
  Object.freeze({
    schemaVersion: WONDERLAND_ACTIVITY_ANIMATION_SCHEMA_V1,
    accents: Object.freeze(accents),
    dominant: accents[0] ?? null,
    dominantSignal,
    interrupt: dominantSignal === 'awaiting_approval',
    suppressedByTerminal,
    reason,
  });

/**
 * Turn the signals true right now into what a world should show.
 *
 * `visualState` is `null` when Relay has said nothing. UNOBSERVED SHOWS
 * NOTHING — not because there is nothing happening, but because a world that
 * has not been told anything must not accent a guess. That is the same rule
 * the phase animation follows when it draws `dormant` rather than `idle`.
 */
export function planWonderlandActivityIntent(input: {
  readonly signals: readonly JuliusActivitySignal[];
  readonly visualState: JuliusVisualState | null;
}): WonderlandActivityIntent {
  if (input.visualState === null) {
    return intent([], null, false, 'Relay has not said what this run is doing.');
  }

  const ranked = [...new Set(input.signals)]
    .filter((signal) => ORDER.has(signal))
    .sort((a, b) => (ORDER.get(a) as number) - (ORDER.get(b) as number));

  if (TERMINAL.has(input.visualState)) {
    // Suppressed, and SAID to be suppressed, so a surface can explain the
    // difference between "nothing was signalled" and "it ended holding these".
    return intent(
      [],
      null,
      ranked.length > 0,
      ranked.length > 0
        ? 'The run has ended; what was true while it ran is kept, not shown.'
        : 'The run has ended and nothing was signalled.',
    );
  }

  if (ranked.length === 0) {
    return intent([], null, false, 'Nothing was signalled for this run.');
  }

  const accents: WonderlandActivityAccent[] = [];
  for (const signal of ranked) {
    const accent = WONDERLAND_SIGNAL_ACCENT[signal];
    if (!accents.includes(accent)) accents.push(accent);
  }

  return intent(
    accents,
    ranked[0],
    false,
    `${ranked.length} signal${ranked.length === 1 ? '' : 's'}; showing ${accents.join(', ')}.`,
  );
}

/**
 * Every accent a renderer must be able to express before this contract is met.
 *
 * The counterpart of `WONDERLAND_REQUIRED_CLIPS`: a world missing one of these
 * cannot show a state Relay can report, and the honest thing is to know that
 * before a founder is watching rather than after.
 */
export const WONDERLAND_REQUIRED_ACCENTS: readonly WonderlandActivityAccent[] = Object.freeze([
  ...WONDERLAND_ACTIVITY_ACCENTS,
]);

/** Every visual state, for a renderer auditing its own coverage. */
export const WONDERLAND_ANIMATED_STATES: readonly JuliusVisualState[] = Object.freeze([
  ...JULIUS_VISUAL_STATES,
]);
