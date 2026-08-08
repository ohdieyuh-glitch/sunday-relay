import type { RelayStageActor } from './relay-stage-layout';

/**
 * SUNDAY RELAY — WHO IS ON THE STAGE, DERIVED RATHER THAN DECLARED.
 *
 * The workspace held its cast as a frozen one-row constant. A constant cannot
 * be wrong, but it also cannot be right — it said the same thing whether the
 * coding agent was implementing or the project had only just been configured.
 *
 * THE FIRST VERSION REPLACED THAT CONSTANT WITH A CONSTANT INPUT, which was
 * worse: the caller passed a literal `working: true` for an agent the same
 * render tree was labelling `waiting`. Nothing was derived, and a false datum
 * had been written into the code.
 *
 * THE SECOND VERSION DERIVED THE WRONG THING. `dogState !== 'wandering'` reads
 * as activity and is not: `verified_complete` maps to `complete`, so it claimed
 * the coding agent was working after the mission finished, and
 * `architect_working` maps to `trotting`, so it claimed the coding agent was
 * working when a different role was. In the other direction it deleted the Dog
 * from an idle workspace — and `wandering` is the Dog's IDLE ANIMATION, a thing
 * to show rather than a reason to hide.
 *
 * SO THE QUESTION IS `onStage`, NOT `working`. The Dog is the mission's avatar
 * and is present whenever the workspace is showing one; a role with no idle
 * presence is present only while it runs. Naming the field for what it decides
 * is what stops the next author deriving activity from it again.
 *
 * TWO QUESTIONS, KEPT APART. "Does this role belong on the stage?" and "can this
 * build draw it?" are different, and collapsing them produces the two opposite
 * lies: drop an undrawable role and the stage under-reports the team; place one
 * and the stage announces an actor it renders as an empty box, while the
 * overflow warning counts a sprite nobody can see. So a role this build has no
 * sprite for is NAMED in `workingWithoutSprite`, never silently dropped and
 * never silently placed.
 *
 * FIXED SLOTS, NOT EVEN SPREAD. Each role stands in the same place whenever it
 * stands at all. Spacing actors by how many are on stage meant a reviewer
 * finishing slid the coding agent a quarter of the stage sideways — motion
 * nothing in the product performed, which is exactly what the Relay Dog's
 * motion system refuses to invent. A departure now leaves a gap.
 *
 * PURE. No clock, no DOM, no I/O — the browser and the CLI can both ask who is
 * on the stage and get the same answer.
 */

export type CastRole = 'prompt_architect' | 'coding_agent' | 'reviewer';

/** A role that can appear, and what the surface knows about it right now. */
export interface CastRoleInput {
  readonly role: CastRole;
  /**
   * Whether this role HAS SOMETHING TO SHOW on the stage right now.
   *
   * Deliberately not called `working`, because for the Relay Dog that would be
   * false. The Dog is the mission's avatar and owns an IDLE animation —
   * `wandering` is a state to show, not a reason to hide — so its presence is
   * not conditional on activity, and a first attempt at deriving one produced
   * two opposite errors at once: it claimed the coding agent was working at
   * `verified_complete` (the mission is finished) and at `architect_working`
   * (a different role is), while deleting the Dog entirely from an idle
   * workspace.
   *
   * For a role with no idle presence — the reviewer — this IS "is it running",
   * and it is not "is it configured", "was it requested" or "is it available".
   * Those are three other questions and `loop-roles.ts` exists to keep them
   * apart.
   */
  readonly onStage: boolean;
}

/**
 * WHERE EACH ROLE STANDS, AND WHETHER IT CAN BE DRAWN AT ALL.
 *
 * `coding_agent` is the only role with a sprite and a state model: the Relay
 * Dog. `relay-architect` and `relay-reviewer` exist as ids and as nothing else
 * — no CSS, no component, no `render()` branch — so placing one puts an empty
 * full-width box on the stage and inflates the overflow warning. They are
 * declared here so the projection can NAME them rather than forget them.
 *
 * The coding agent's slot is 0.5, which is exactly where the constant put it,
 * so the shipped stage does not move.
 */
const ROLE_SLOT: Readonly<Record<CastRole, { readonly x: number; readonly id: string | null }>> =
  Object.freeze({
    prompt_architect: Object.freeze({ x: 1 / 6, id: null }),
    coding_agent: Object.freeze({ x: 0.5, id: 'relay-dog' }),
    reviewer: Object.freeze({ x: 5 / 6, id: null }),
  });

/** Fixed, so the cast never reorders because a caller listed roles differently. */
const ROLE_ORDER: readonly CastRole[] = Object.freeze([
  'prompt_architect', 'coding_agent', 'reviewer',
]);

/** One dog-unit each: these are PEERS, and nothing here is subordinate. */
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
   * Roles that belong on the stage and that this build cannot draw. Named
   * rather than dropped: "nobody else is here" and "two agents are here and we
   * have no artwork for them" are the same empty stage and different facts.
   */
  readonly workingWithoutSprite: readonly CastRole[];
  /**
   * Why the stage is empty, or `null` when it is not. The stage says why rather
   * than drawing something so the space looks used.
   */
  readonly emptyReason: string | null;
}

/**
 * The cast, from what each role has to show.
 *
 * A role appearing twice is resolved by "present wins": a caller that appends a
 * stale absent entry after a live one must not be able to erase an agent from
 * the stage and have the stage then state that nobody is there.
 */
export function projectWorkspaceCast(input: {
  readonly roles: readonly CastRoleInput[];
}): WorkspaceCast {
  const present = new Set<CastRole>();
  for (const entry of input.roles) {
    // PRESENT WINS over a duplicate. Last-wins would let ordering decide
    // whether an agent is on stage.
    if (entry.onStage && ROLE_SLOT[entry.role] !== undefined) present.add(entry.role);
  }

  const order = ROLE_ORDER.filter((role) => present.has(role));
  const actors: RelayStageActor[] = [];
  const workingWithoutSprite: CastRole[] = [];

  for (const role of order) {
    const slot = ROLE_SLOT[role];
    if (slot.id === null) { workingWithoutSprite.push(role); continue; }
    actors.push(Object.freeze({
      id: slot.id,
      x: slot.x,
      depth: 1,
      width: ACTOR_WIDTH,
      track: ACTOR_TRACK,
      layer: 'actors' as const,
    }));
  }

  return {
    actors: Object.freeze(actors),
    workingWithoutSprite: Object.freeze(workingWithoutSprite),
    emptyReason: actors.length > 0
      ? null
      : workingWithoutSprite.length > 0
        // The honest empty stage: someone IS working, and this build cannot
        // draw them. Saying "no agent is working" here would be false.
        ? 'No agent on this stage has artwork yet. Work is running.'
        : 'No agent is on the stage. It fills when one arrives.',
  };
}
