/**
 * WONDERLAND — THE RELAY DOG'S MISSION-STAGE PRESENTATION.
 *
 * The Relay Dog is the physical manifestation of Julius. This module is the
 * ADAPTER the founder's architecture calls for, and it is the whole of the
 * middle arrow:
 *
 *   JULIUS EVENT / MISSION STATE
 *     -> Wonderland mission-state adapter        <- this file
 *       -> Relay Dog animation state
 *         -> animation + props/effects
 *
 * PROVIDER NAMES NEVER REACH HERE. There is no input to any function in this
 * file that could carry `openai`, `anthropic`, `xai` or a model id, and there is
 * no branch on one. The Compound Agent's ROLE and STAGE decide what the world
 * shows; which vendor answered is a fact about billing and attestation, not
 * about what the Dog is doing. That is enforced structurally rather than asked
 * for politely: the stage vocabulary is closed, and the presentation map is
 * TOTAL over it, so a provider could not be added as a stage without failing
 * `tsc`.
 *
 * PRESENTATION IS NOT EVENT SEMANTICS. The two are separate layers and this
 * module is the boundary. Julius still hands off work between workers, and that
 * event still exists and is still recorded — what changed is that the Dog no
 * longer performs a dedicated handoff pose for it. `handoff` therefore remains a
 * real member of the stage vocabulary and resolves to `inherit`: the world keeps
 * showing the stage it was already showing. Deleting the member instead would
 * have deleted a Julius event to remove a visual, which is the one thing the
 * direction explicitly forbade.
 *
 * PURE. No clock, no React, no Unreal, no randomness. Everything here is a total
 * function over a closed vocabulary, so the same mission state produces the same
 * world on every machine and in every replay.
 */

/* ------------------------------------------------------------ the stages */

/**
 * THE MISSION STAGES THE WORLD PRESENTS.
 *
 * `none` is first and is a real member: before an AI task begins there is no
 * Mission Contract and no mission animation, and the absence has to be
 * representable or a renderer will show a mission that has not started.
 */
export const WONDERLAND_MISSION_STAGES = [
  'none',
  'mission_start',
  'planning',
  'implementing',
  'verifying',
  'handoff',
  'researching',
  'reviewing',
  'repairing',
  'waiting_for_user',
  'complete',
  'error',
] as const;
export type WonderlandMissionStage = (typeof WONDERLAND_MISSION_STAGES)[number];

/**
 * The four stages this specification LOCKS. Named so a test can assert their
 * presentations against the written direction field by field, and so a later
 * change to one of them is visibly a change to a locked thing.
 */
export const WONDERLAND_LOCKED_STAGES: readonly WonderlandMissionStage[] = [
  'mission_start',
  'planning',
  'implementing',
  'verifying',
] as const;

/* -------------------------------------------------------------- the props */

/**
 * What the Dog is holding. `none` is first for the same reason every other
 * zero-value in Wonderland is: a default-constructed Unreal struct must not
 * spawn a book.
 *
 * BOOK MEANS PLANNING. The direction was explicit that the book must not drift
 * onto another stage, and the map below is the only place a prop is assigned —
 * so the binding is checkable in one place rather than spread across a renderer.
 */
export const WONDERLAND_DOG_PROPS = ['none', 'book', 'paintbrush'] as const;
export type WonderlandDogProp = (typeof WONDERLAND_DOG_PROPS)[number];

/** How the Dog is moving through the world during a stage. */
export const WONDERLAND_DOG_LOCOMOTIONS = [
  'grounded',
  /** Suspended off the ground with a subtle vertical hover. */
  'floating',
  /** Walking a circuit around the Mission Contract. */
  'orbit_contract',
  /** Planted, facing the Mission Contract. */
  'planted_facing_contract',
] as const;
export type WonderlandDogLocomotion = (typeof WONDERLAND_DOG_LOCOMOTIONS)[number];

/** The sustained effect connecting the Dog to the Mission Contract, if any. */
export const WONDERLAND_DOG_EMISSIONS = ['none', 'verification_beam'] as const;
export type WonderlandDogEmission = (typeof WONDERLAND_DOG_EMISSIONS)[number];

/* ------------------------------------------------------- the presentation */

/**
 * WHAT THE WORLD SHOWS FOR ONE STAGE.
 *
 * `inherit` is the answer for a stage that has no dedicated presentation: the
 * previous stage's presentation continues. It is a first-class value rather than
 * a null so that "keep showing what you were showing" is a decision the table
 * states, not a gap a renderer fills however it likes.
 */
export type WonderlandDogPresentation =
  | { readonly kind: 'inherit'; readonly because: string }
  | {
    readonly kind: 'staged';
    /** The clip id an Unreal animation graph binds. Stable, never a provider name. */
    readonly animationId: string;
    readonly prop: WonderlandDogProp;
    readonly locomotion: WonderlandDogLocomotion;
    readonly emission: WonderlandDogEmission;
    /** True when the Mission Contract diamond must be present in the scene. */
    readonly contractPresent: boolean;
    /** Does the Dog's head track the Mission Contract? */
    readonly headTracksContract: boolean;
    /** A sentence a preview overlay can render, and a reviewer can check. */
    readonly intent: string;
  };

/**
 * THE TABLE. Total over the stage vocabulary — `Record`, not a partial map, so
 * adding a stage without deciding its presentation fails the build.
 *
 * The four locked stages are written to the specification exactly:
 *
 *   mission_start  floating, body upright, head raised, forelimbs extended
 *                  outward and ~30-45 degrees DOWNWARD. Not meditation, not a
 *                  T-pose, not arms straight down. Subtle hover, never frozen.
 *   planning       reading an open book while walking a circuit around the
 *                  Mission Contract. Reading, never writing.
 *   implementing   working a paintbrush — strokes, not a held prop.
 *   verifying      planted, facing the Contract, SUSTAINED beam. Not a
 *                  projectile, not bullets, not intermittent flashes.
 */
export const WONDERLAND_STAGE_PRESENTATION: Readonly<
  Record<WonderlandMissionStage, WonderlandDogPresentation>
> = Object.freeze({
  none: {
    kind: 'staged',
    animationId: 'dog_idle_explore',
    prop: 'none',
    locomotion: 'grounded',
    emission: 'none',
    // No task has begun, so there is no Mission Contract to show.
    contractPresent: false,
    headTracksContract: false,
    intent: 'No mission. The user is exploring Wonderland and no Mission Contract exists.',
  },
  mission_start: {
    kind: 'staged',
    animationId: 'dog_mission_activation_float',
    prop: 'none',
    locomotion: 'floating',
    emission: 'none',
    contractPresent: true,
    headTracksContract: false,
    intent:
      'Julius is activating. The Compound Agent floats above the ground, body upright, head raised, forelimbs extended outward and angled down, entering the Mission Contract.',
  },
  planning: {
    kind: 'staged',
    animationId: 'dog_planning_read_orbit',
    prop: 'book',
    locomotion: 'orbit_contract',
    emission: 'none',
    contractPresent: true,
    headTracksContract: false,
    intent:
      'The Prompt Architect is studying the mission. The Dog reads an open book while walking around the Mission Contract, eyes tracking the pages and turning them as it goes.',
  },
  implementing: {
    kind: 'staged',
    animationId: 'dog_implement_paint',
    prop: 'paintbrush',
    locomotion: 'orbit_contract',
    emission: 'none',
    contractPresent: true,
    headTracksContract: false,
    intent:
      'Julius is painting the creation into existence — deliberate repeated strokes, repositioning as implementation progresses.',
  },
  verifying: {
    kind: 'staged',
    animationId: 'dog_verify_beam',
    prop: 'none',
    locomotion: 'planted_facing_contract',
    emission: 'verification_beam',
    contractPresent: true,
    headTracksContract: true,
    intent:
      'Julius is checking the work. A sustained analytical beam connects the Dog to the Mission Contract for as long as verification runs.',
  },
  /**
   * NO DEDICATED HANDOFF ANIMATION.
   *
   * The Julius event is untouched — workers still hand work to one another and
   * the trace still records it. The world simply does not interrupt the stage it
   * is showing to perform a carry. `inherit` says that explicitly.
   */
  handoff: {
    kind: 'inherit',
    because:
      'Julius hands work between workers internally. That is an event, not a scene: the Dog keeps performing the stage it was already performing.',
  },
  // The stages below are DELIBERATELY UNCHANGED by this specification, which
  // said to preserve existing behaviour for them until they are defined. They
  // are listed so the table stays total, and each carries the presentation the
  // existing activity vocabulary already implied.
  researching: {
    kind: 'staged',
    animationId: 'dog_research_scan',
    prop: 'none',
    locomotion: 'grounded',
    emission: 'none',
    contractPresent: true,
    headTracksContract: false,
    intent: 'Existing research behaviour, preserved pending its own specification.',
  },
  reviewing: {
    kind: 'staged',
    animationId: 'dog_review_scan',
    prop: 'none',
    locomotion: 'grounded',
    emission: 'none',
    contractPresent: true,
    headTracksContract: true,
    intent: 'Existing review behaviour, preserved pending its own specification.',
  },
  repairing: {
    kind: 'staged',
    animationId: 'dog_repair_work',
    prop: 'none',
    locomotion: 'grounded',
    emission: 'none',
    contractPresent: true,
    headTracksContract: false,
    intent: 'Existing repair behaviour, preserved pending its own specification.',
  },
  waiting_for_user: {
    kind: 'staged',
    animationId: 'dog_attention_wait',
    prop: 'none',
    locomotion: 'grounded',
    emission: 'none',
    contractPresent: true,
    headTracksContract: false,
    intent: 'Existing attention behaviour, preserved pending its own specification.',
  },
  complete: {
    kind: 'staged',
    animationId: 'dog_complete_rest',
    prop: 'none',
    locomotion: 'grounded',
    emission: 'none',
    contractPresent: true,
    headTracksContract: false,
    intent: 'Existing completion behaviour, preserved pending its own specification.',
  },
  error: {
    kind: 'staged',
    animationId: 'dog_error_halt',
    prop: 'none',
    locomotion: 'grounded',
    emission: 'none',
    contractPresent: true,
    headTracksContract: false,
    intent: 'Existing stopped behaviour, preserved pending its own specification.',
  },
});

/* -------------------------------------------------- resolving with history */

/**
 * The presentation actually shown, resolving `inherit` against what came before.
 *
 * `previousStage` is the stage the world was last SHOWING, not the last stage
 * Julius reported — those differ precisely when an inheriting stage is active,
 * which is the case this function exists for. A handoff arriving before any
 * stage has been shown falls back to `none`, because inheriting from nothing has
 * to mean the resting world rather than an arbitrary pose.
 */
export function resolveWonderlandStagePresentation(
  stage: WonderlandMissionStage,
  previousStage: WonderlandMissionStage | null,
): { readonly presentation: WonderlandDogPresentation; readonly shownStage: WonderlandMissionStage } {
  const direct = WONDERLAND_STAGE_PRESENTATION[stage];
  if (direct.kind === 'staged') return { presentation: direct, shownStage: stage };

  const fallback = previousStage === null ? 'none' : previousStage;
  const inherited = WONDERLAND_STAGE_PRESENTATION[fallback];
  // An inheriting stage may never inherit from another inheriting stage: the
  // table has exactly one, and this keeps that a checked fact rather than a
  // comment that a second one would quietly falsify.
  return inherited.kind === 'staged'
    ? { presentation: inherited, shownStage: fallback }
    : { presentation: WONDERLAND_STAGE_PRESENTATION.none as WonderlandDogPresentation, shownStage: 'none' };
}

/* ------------------------------------------------------------ transitions */

/**
 * A prop or effect must never pop. This describes the change between two
 * presentations so a renderer can drive an entry/exit rather than a hard cut.
 */
export interface WonderlandStageTransition {
  readonly from: WonderlandMissionStage;
  readonly to: WonderlandMissionStage;
  readonly propExiting: WonderlandDogProp;
  readonly propEntering: WonderlandDogProp;
  readonly emissionEnding: WonderlandDogEmission;
  readonly emissionBeginning: WonderlandDogEmission;
  /** True when the Mission Contract itself spawns on this transition. */
  readonly contractSpawns: boolean;
  readonly contractDespawns: boolean;
}

export function wonderlandStageTransition(
  from: WonderlandMissionStage,
  to: WonderlandMissionStage,
  previousShown: WonderlandMissionStage | null = null,
): WonderlandStageTransition {
  const a = resolveWonderlandStagePresentation(from, previousShown).presentation;
  const b = resolveWonderlandStagePresentation(to, from).presentation;
  const fromStaged = a.kind === 'staged' ? a : null;
  const toStaged = b.kind === 'staged' ? b : null;

  const propA = fromStaged?.prop ?? 'none';
  const propB = toStaged?.prop ?? 'none';
  const emitA = fromStaged?.emission ?? 'none';
  const emitB = toStaged?.emission ?? 'none';
  const contractA = fromStaged?.contractPresent ?? false;
  const contractB = toStaged?.contractPresent ?? false;

  return {
    from,
    to,
    propExiting: propA === propB ? 'none' : propA,
    propEntering: propA === propB ? 'none' : propB,
    emissionEnding: emitA === emitB ? 'none' : emitA,
    emissionBeginning: emitA === emitB ? 'none' : emitB,
    contractSpawns: !contractA && contractB,
    contractDespawns: contractA && !contractB,
  };
}

/* ------------------------------------------------- the activity adapter */

/**
 * THE ACTIVITY VOCABULARY, RESTATED HERE ON PURPOSE.
 *
 * The runtime list lives in `src/relay/ui/relay-dog-motion`, and the mission
 * layer may never import from the UI layer — that edge is a structural boundary
 * this repository tests by walking the real import graph. So the domain declares
 * the shape it needs, exactly as the adapter rule requires, and
 * `wonderland-dog-stage.test.ts` imports BOTH and asserts they are the same set.
 * The drift that would otherwise be invisible becomes a failing test instead of
 * a stage nobody wrote a presentation for.
 */
export const WONDERLAND_DOG_ACTIVITIES = [
  'idle',
  'thinking',
  'waiting_for_user',
  'researching',
  'implementing',
  'handoff',
  'verifying',
  'reviewing',
  'repairing',
  'complete',
  'error',
] as const;
export type RelayDogActivityKind = (typeof WONDERLAND_DOG_ACTIVITIES)[number];

/**
 * The existing Relay Dog activity vocabulary -> the stage vocabulary.
 *
 * TOTAL over `RelayDogActivityKind`, so the two vocabularies cannot drift: a new
 * activity in the UI motion system fails this file until somebody decides what
 * the world shows for it.
 *
 * `thinking` maps to `planning`. That is the substantive remap this
 * specification makes to the existing table — the book-and-orbit scene IS the
 * Prompt Architect studying the mission, and `thinking` is the activity the
 * existing system already raises while that happens.
 */
export const WONDERLAND_ACTIVITY_STAGE: Readonly<
  Record<RelayDogActivityKind, WonderlandMissionStage>
> = Object.freeze({
  idle: 'none',
  thinking: 'planning',
  waiting_for_user: 'waiting_for_user',
  researching: 'researching',
  implementing: 'implementing',
  handoff: 'handoff',
  verifying: 'verifying',
  reviewing: 'reviewing',
  repairing: 'repairing',
  complete: 'complete',
  error: 'error',
});

/** The stage for an observed activity. `mission_start` is not reachable from an
 * activity: it belongs to the instant the Mission Contract spawns, which the
 * mission lifecycle raises, not the per-frame activity projection. */
export function wonderlandStageForActivity(
  activity: RelayDogActivityKind,
): WonderlandMissionStage {
  return WONDERLAND_ACTIVITY_STAGE[activity];
}
