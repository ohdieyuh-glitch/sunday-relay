import type { RelayStageActor } from './relay-stage-layout';

/**
 * SUNDAY RELAY — WHO IS ON THE STAGE, DERIVED RATHER THAN DECLARED.
 *
 * The workspace held its cast as a frozen one-row constant. That was honest
 * while there was exactly one actor and one thing it could mean, and it stopped
 * being a fact about the product the moment a second role could work: a
 * constant cannot be wrong, but it also cannot be right — it says the same
 * thing whether the reviewer is running or has never been configured.
 *
 * THIS IS THE RULE THE STAGE ALREADY STATES, APPLIED. `RELAY_STAGE.md`: "An
 * empty cast renders an empty stage that says why. It does not helpfully draw a
 * Dog so the space looks used." An actor appears here because a role is ACTUALLY
 * WORKING, and for no other reason. A role that is configured, idle, absent,
 * unavailable or merely *requested* is not on the stage — requesting a role and
 * staffing one are different facts, which is the distinction `loop-roles.ts`
 * exists to keep.
 *
 * WHY NO LEOPARD AND NO CUBS YET, stated rather than quietly omitted. The stage
 * contract sizes a Leopard at 2 dog-units and a cub at 0.6, and this projection
 * places neither, because nothing in this build produces the thing either one
 * would represent. A cub is a subordinate or temporarily-expanded agent: Unchain
 * is the feature that would create one, and `UNCHAIN.md` records that the meter,
 * the session lifecycle and Rechaining execution are all unimplemented, so no
 * cub can exist to be drawn. Giving the architect a cub sprite because a cub
 * sprite was available would be assigning a meaning nothing produced — the same
 * defect as a panel rendering a run it never fetched, in artwork instead of
 * data. The slots stay open; the sizes are already agreed.
 *
 * PURE. No clock, no DOM, no I/O — the browser and the CLI can both ask who is
 * on the stage and get the same answer.
 */

/** A role that can appear, and what the surface knows about it right now. */
export interface CastRoleInput {
  /** The canonical Relay agent role. */
  readonly role: 'coding_agent' | 'prompt_architect' | 'reviewer';
  /**
   * Whether this role is DOING something right now.
   *
   * Not "is it configured", not "was it requested", not "is it available" —
   * those are three other questions with three other answers, and a stage that
   * conflated them would put an actor on it for a reviewer nobody ran.
   */
  readonly working: boolean;
}

/** The sprite the stage has artwork and a state model for, per role. */
const ACTOR_ID: Readonly<Record<CastRoleInput['role'], string>> = Object.freeze({
  coding_agent: 'relay-dog',
  prompt_architect: 'relay-architect',
  reviewer: 'relay-reviewer',
});

/**
 * ORDER IS FIXED, NOT INPUT ORDER. The cast must not reshuffle because a
 * caller listed roles differently or because a role finished — an actor
 * jumping across the stage when an unrelated one stops is the stage inventing
 * movement that nothing in the product did.
 */
const ROLE_ORDER: readonly CastRoleInput['role'][] = Object.freeze([
  'prompt_architect', 'coding_agent', 'reviewer',
]);

/** One dog-unit each: these are PEERS, and nothing here is subordinate to anything. */
const ACTOR_WIDTH = 1;
/**
 * The patrol track. The Dog measures this to decide whether to patrol at all,
 * and a track the size of the sprite switches patrol off without failing
 * anywhere — which is why it is stated rather than defaulted.
 */
const ACTOR_TRACK = 6;

export interface WorkspaceCast {
  readonly actors: readonly RelayStageActor[];
  /**
   * Why the stage is empty, or `null` when it is not. The stage says why rather
   * than drawing something so the space looks used.
   */
  readonly emptyReason: string | null;
}

/**
 * The cast, from what each role is actually doing.
 *
 * Actors are spread evenly across the stage and share one depth: they are
 * peers on one ground plane. Depth is reserved for the parallax the `far`
 * layer will carry, not spent on implying a hierarchy this product does not
 * have.
 */
export function projectWorkspaceCast(input: {
  readonly roles: readonly CastRoleInput[];
}): WorkspaceCast {
  const byRole = new Map(input.roles.map((r) => [r.role, r]));
  const working = ROLE_ORDER.filter((role) => byRole.get(role)?.working === true);

  if (working.length === 0) {
    return {
      actors: [],
      emptyReason: 'No agent is working. The stage fills when one starts.',
    };
  }

  // Evenly spaced across the full width, each actor centred in its own share.
  // One actor lands at 0.5, which is exactly where the single-actor cast stood,
  // so today's shipped stage does not move.
  const share = 1 / working.length;
  const actors = working.map((role, index) => Object.freeze({
    id: ACTOR_ID[role],
    x: share * (index + 0.5),
    depth: 1,
    width: ACTOR_WIDTH,
    track: ACTOR_TRACK,
    layer: 'actors' as const,
  }));

  return { actors: Object.freeze(actors), emptyReason: null };
}
