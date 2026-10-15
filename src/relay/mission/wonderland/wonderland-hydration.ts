/**
 * ONE PAYLOAD A JOINING OR RECONNECTING WORLD CAN START FROM.
 *
 * The event stream tells a world what CHANGED. That is the wrong shape for two
 * moments: entering a world that has been running for an hour, and coming back
 * after a dropped link. Both need what is TRUE NOW, and neither can afford the
 * transcript — a run with four thousand events must not cost four thousand
 * deliveries to rejoin.
 *
 * So there are two kinds of thing on this seam, and they are different by
 * design rather than by accident:
 *
 *   INCREMENTAL   `WonderlandEnvelope`. One event, lean, ordered by sequence.
 *                 Carries a phase and its identity and nothing else, because it
 *                 arrives constantly and anything on it is paid for every time.
 *
 *   SNAPSHOT      this file. Everything a world needs to draw itself from cold,
 *                 sent once on join and once per reconnect. Usage, Project
 *                 Brain, C.A.R.D. and activity live HERE, where they cost
 *                 nothing per event.
 *
 * THAT SPLIT IS WHY USAGE IS NOT ON THE ENVELOPE. Capacity does not change per
 * event; putting a meter reading on every `run.transitioned` would send the
 * same two numbers thousands of times and still be stale between transitions,
 * because usage moves on its own schedule. It is a REPORT with its own revision
 * and it belongs where reports belong.
 *
 * NOTHING HERE IS COMPUTED. Every field arrives from the system that owns it —
 * the kernel for the run, the usage authority for the meters, the context
 * compiler for the brain, the C.A.R.D. record for the roles — and this module
 * only assembles and narrows. A hydration that derived a figure would be a
 * second authority for it, which is the one thing the ownership table exists to
 * prevent.
 */

import { exactKeys } from './wonderland-contracts';
import type { JuliusActivityReading } from './wonderland-julius-activity';
import type { WonderlandBrainCitation } from './wonderland-brain-scope';
import type { WonderlandRunSnapshot } from './wonderland-rehydration';
import type { WonderlandUsageHud } from './wonderland-usage-meter';
import type { WonderlandUsageAuthorityStatus } from './wonderland-usage-authority';
import { wonderlandHumanGateBelongs } from './wonderland-human-gate';
import type { WonderlandHumanGate } from './wonderland-human-gate';
import { JULIUS_RUN_STATE_VISUAL_STATE } from './wonderland-julius-state';
import type { JuliusVisualState } from './wonderland-julius-state';
import { juliusMissionStateIsTerminal } from './wonderland-rehydration';

export const WONDERLAND_HYDRATION_SCHEMA_V1 = 'relay-wonderland-hydration.v1' as const;
export type WonderlandHydrationSchemaVersion = typeof WONDERLAND_HYDRATION_SCHEMA_V1;

/* ----------------------------------------------------------- the C.A.R.D. */

/**
 * The autonomy levels, mirroring `JULIUS_AUTONOMY_LEVELS`.
 *
 * Carried because it answers a question a founder watching a run actually asks
 * — "will it stop and ask me?" — and it is safe to carry because it is a closed
 * three-member vocabulary rather than free text.
 */
export const WONDERLAND_AUTONOMY_LEVELS = ['SUPERVISED', 'AUTONOMOUS', 'UNCHAINED'] as const;
export type WonderlandAutonomyLevel = (typeof WONDERLAND_AUTONOMY_LEVELS)[number];

/**
 * WHAT A WORLD MAY KNOW ABOUT A C.A.R.D., WHICH IS DELIBERATELY LITTLE.
 *
 * `CardVersion` carries `models` — PROVIDER AND MODEL NAMES — along with the
 * tool list, the permission list and the budget figures. None of that may reach
 * a world. The visual vocabulary is provider-free by construction and a test
 * asserts it; leaking the names through the C.A.R.D. would undo that from the
 * side door, and it would do it on the surface a player can inspect.
 *
 * So the roles are reported as FILLED OR NOT, never by whom. Which model
 * occupies the Coding Agent slot is Relay's business and changes nothing about
 * what a world draws — that is the same argument the state vocabulary makes,
 * applied to the record that assigns the slots.
 *
 * Budgets are absent too, and for a different reason: they are usage's
 * business, the usage authority already owns capacity, and a second source for
 * "how much is left" is exactly the duplicated authority the ownership table
 * forbids.
 */
export interface WonderlandCardScope {
  /** Opaque handle. The world compares it and never parses it. */
  readonly cardRevision: string;
  /**
   * A role SLOT is filled, or NULL when nobody could look.
   *
   * NULL IS NOT FALSE, AND THIS IS WHERE THAT BIT. A reader that cannot
   * resolve the C.A.R.D. behind a run — which is every reader today, because
   * `julius_runs.card_revision` is free text with no foreign key and nothing in
   * the persistence layer reads `relay_wonderland.card_versions` — would
   * otherwise report all three slots EMPTY, and a world would draw three
   * unfilled roles as a fact. Unknown is not zero here as everywhere else.
   *
   * Named `has*` rather than `*Assigned` for two reasons, and the second is
   * the one that matters: `has` reads as a question a world ASKS, while
   * `assigned` hints at an act it might perform, and the parity suite sweeps
   * field names for exactly that kind of implied authority. (It also happens
   * that "assigned" contains "signed", which the sweep's pattern matches — the
   * same substring trap as `sk-` inside `task-`. The rename fixes the real
   * problem and sidesteps the accidental one.)
   */
  readonly hasPromptArchitect: boolean | null;
  readonly hasCodingAgent: boolean | null;
  readonly hasIndependentReviewer: boolean | null;
  /**
   * Whether this C.A.R.D. permits a swarm at all, or NULL when nobody looked.
   *
   * Not "is one running" — that is `swarming` on the activity axis. This is
   * eligibility, which is what a world needs to know whether to leave room for
   * clones before any exist.
   *
   * NULLABLE FOR THE SAME REASON THE THREE SLOTS ARE, and it was not, which was
   * a bug on this seam rather than a nicety. A reader that cannot resolve the
   * C.A.R.D. behind a run — which is EVERY reader today, because C.A.R.D.
   * policy is not persisted at all: `julius_runs` stores a `card_revision` and
   * nothing stores the policy that revision names — passed no capabilities and
   * got `false` back. A world then drew "this run may not spawn a swarm", a
   * confident claim nobody made, and it drew it beside three role slots that
   * correctly said UNKNOWN. Absence is now absence here too.
   */
  readonly swarmEligible: boolean | null;
  /**
   * Which swarm roles it permits, from the repository's own closed vocabulary.
   *
   * Safe to carry precisely because it IS closed: `researcher`, `architect`,
   * `implementer` and the rest are Relay's words for functions, not anybody's
   * product names.
   *
   * AN ARRAY, NEVER NULL, and therefore MEANINGLESS ON ITS OWN: empty is both
   * "permits no roles" and "nobody could look". `swarmEligible` is what tells
   * them apart, and a reader must consult it first — the same shape as the
   * citation's `contentHash`, which is what tells a retrieval that found
   * nothing from one that never happened. Kept as a bare list because a world
   * iterates it, and there is no carrier for a TArray on the C++ side.
   */
  readonly eligibleSwarmRoles: readonly string[];
  /** Null when the record does not say. Never defaulted to a level. */
  readonly autonomy: WonderlandAutonomyLevel | null;
}

export const WONDERLAND_CARD_SCOPE_FIELDS = exactKeys<WonderlandCardScope>()([
  'cardRevision',
  'hasPromptArchitect',
  'hasCodingAgent',
  'hasIndependentReviewer',
  'swarmEligible',
  'eligibleSwarmRoles',
  'autonomy',
] as const);

/**
 * The shape this module accepts, declared here rather than imported.
 *
 * The same inversion `wonderland-brain-scope.ts` uses, for the same reason: if
 * this imported `CardVersion` it would be handed `models` on every call and the
 * only thing between a provider name and a world would be this function
 * remembering not to copy it. With a narrower parameter the names are never in
 * scope, so no expression here could leak one.
 */
export interface WonderlandCardInput {
  readonly cardRevision: string;
  /**
   * The slot assignments, as the record holds them.
   *
   * PRESENT-AND-EMPTY is "the record says nobody". ABSENT is "I could not read
   * the record" — omit the property rather than passing a blank, because a
   * blank is an answer and this module will report it as one.
   */
  readonly promptArchitect?: string | null;
  readonly codingAgent?: string | null;
  readonly reviewer?: string | null;
  /** Capability tokens. Only `swarm:` entries are read, and only their role. */
  readonly capabilities?: readonly string[];
  readonly autonomy?: string | null;
}

const isAutonomy = (value: unknown): value is WonderlandAutonomyLevel =>
  typeof value === 'string' &&
  (WONDERLAND_AUTONOMY_LEVELS as readonly string[]).includes(value);

/**
 * Whether a slot is filled, and whether that is even knowable.
 *
 * ABSENT MEANS UNKNOWN; PRESENT-AND-EMPTY MEANS EMPTY. A caller that resolved
 * the record and found nothing in the slot passes `null` or `''` and gets
 * `false` — a real answer. A caller that could not resolve the record omits the
 * property entirely and gets `null`. The distinction is the whole point: those
 * are different facts and only one of them may be drawn.
 */
const slotFilled = (value: string | null | undefined, supplied: boolean): boolean | null => {
  if (!supplied) return null;
  return typeof value === 'string' && value.trim() !== '';
};

/** Narrow a C.A.R.D. record into what a world may know. THE ONLY CONSTRUCTOR. */
export function scopeWonderlandCard(input: WonderlandCardInput): WonderlandCardScope {
  const swarmRoles = (input.capabilities ?? [])
    .filter((token) => token.startsWith('swarm:'))
    .map((token) => token.slice('swarm:'.length))
    .filter((role) => role.trim() !== '');

  return Object.freeze({
    cardRevision: input.cardRevision,
    hasPromptArchitect: slotFilled(input.promptArchitect, 'promptArchitect' in input),
    hasCodingAgent: slotFilled(input.codingAgent, 'codingAgent' in input),
    hasIndependentReviewer: slotFilled(input.reviewer, 'reviewer' in input),
    // SAME SUPPLIED-CHECK AS THE SLOTS. A caller that read the record and found
    // no swarm capability passes `capabilities: []` and gets `false`, a real
    // answer. A caller that could not read it omits the property and gets
    // `null`. `?? []` below would have collapsed both into "not eligible".
    swarmEligible: 'capabilities' in input ? swarmRoles.length > 0 : null,
    eligibleSwarmRoles: Object.freeze([...new Set(swarmRoles)].sort()),
    autonomy: isAutonomy(input.autonomy) ? input.autonomy : null,
  });
}

/* ---------------------------------------------------------- the hydration */

export interface WonderlandHydration {
  readonly schemaVersion: WonderlandHydrationSchemaVersion;
  readonly projectId: string;
  /** The world session this hydration was cut for. Null when unscoped. */
  readonly worldSessionId: string | null;
  /**
   * The run, its state, its revision and — crucially — the sequence it is
   * consistent with. The tail resumes from exactly there.
   */
  readonly run: WonderlandRunSnapshot;
  /**
   * THE DRAWABLE STATE, so a world hydrating cold has something to draw.
   *
   * `run.state` is the KERNEL's word — one of thirteen, and the vocabulary a
   * mission is bookkept in. What a world DRAWS is one of eleven visual states,
   * and the mapping between them is owned by `wonderland-julius-state.ts` and
   * total over the kernel's union.
   *
   * WHY IT IS ON THE PAYLOAD AND NOT DERIVED BY THE CLIENT. A TypeScript caller
   * can import that mapping; an Unreal client cannot — an adapter may not own a
   * mission verdict, which is the boundary this whole layer is built around. So
   * a world handed only the kernel's word would have to map it ITSELF, in
   * engine code nobody reviewed, and there would be two answers to "what is
   * this run doing" that agree until the day they do not.
   *
   * It is therefore CARRIED rather than computed here: the hydration assembles
   * what the mapping said, exactly as it assembles what the usage authority
   * said. THE ENVELOPE STILL OWNS THE LIVE STATE — this is the cold-start
   * answer, and a run with no further events (one that has COMPLETED, say)
   * would otherwise leave a world with nothing to draw for ever.
   */
  readonly visualState: JuliusVisualState;
  /**
   * Whether the run is OVER, from the kernel's state rather than the picture.
   *
   * Carried beside the visual state because it cannot be recovered from it:
   * `blocked` and `error` are drawn differently and only one of them is
   * terminal, and a world that inferred an ending from the drawing would be
   * reading the picture as the fact. `blocked` and `error` may never appear as
   * `complete`, and this is the field that lets a client obey that without
   * knowing the kernel's vocabulary.
   */
  readonly terminal: boolean;
  /** Both meters, as the usage authority projected them. Never recomputed. */
  readonly usage: WonderlandUsageHud;
  /** How much to believe those figures. Relay's verdict, carried verbatim. */
  readonly usageStatus: WonderlandUsageAuthorityStatus;
  /** What else is true besides the phase. */
  readonly activity: JuliusActivityReading;
  /** The last context retrieval, scoped. Counts and revisions, never content. */
  readonly brain: WonderlandBrainCitation;
  /** Which role slots are filled and what the record permits. Never who. */
  readonly card: WonderlandCardScope;
  /**
   * What this run is waiting for a PERSON to do, typed.
   *
   * `run.pendingApprovals` says HOW MANY gates are open and is the authority on
   * the number; this says WHICH ONES, and may carry fewer. The two are read in
   * one statement so they cannot disagree about a moment, and where they
   * disagree about a COUNT that difference is itself the report — a gate whose
   * operation this build cannot name is counted and not described, the same
   * shape as a Project Brain kind that has no bucket.
   *
   * EMPTY IS NOT UNKNOWN HERE, and it does not need to be: the count beside it
   * carries the absence. `pendingApprovals: null` is "nobody counted"; an empty
   * list beside a known count of zero is "nothing is gated".
   */
  readonly humanGates: readonly WonderlandHumanGate[];
  /** When this hydration was cut. Not when anything in it last changed. */
  readonly observedAtIso: string;
}

export const WONDERLAND_HYDRATION_FIELDS = exactKeys<WonderlandHydration>()([
  'schemaVersion',
  'projectId',
  'worldSessionId',
  'run',
  'visualState',
  'terminal',
  'usage',
  'usageStatus',
  'activity',
  'brain',
  'card',
  'humanGates',
  'observedAtIso',
] as const);

/**
 * Assemble a hydration. Assembles and narrows; computes nothing.
 *
 * THE PROJECT IS TAKEN FROM THE RUN, not from a separate argument, so a
 * hydration cannot name one project at the top and carry another's run
 * underneath. That mismatch would be invisible to every downstream check —
 * ordering compares the envelope's project to the cursor's, and both would
 * agree while the meters underneath belonged to somebody else.
 */
export function wonderlandHydration(input: {
  readonly run: WonderlandRunSnapshot;
  readonly usage: WonderlandUsageHud;
  readonly usageStatus: WonderlandUsageAuthorityStatus;
  readonly activity: JuliusActivityReading;
  readonly brain: WonderlandBrainCitation;
  readonly card: WonderlandCardScope;
  readonly observedAtIso: string;
  readonly worldSessionId?: string | null;
  readonly humanGates?: readonly WonderlandHumanGate[];
}): WonderlandHydration {
  return Object.freeze({
    schemaVersion: WONDERLAND_HYDRATION_SCHEMA_V1,
    projectId: input.run.projectId,
    worldSessionId: input.worldSessionId ?? null,
    run: input.run,
    // THE MAPPING'S ANSWER, READ HERE RATHER THAN INVENTED HERE. It is total
    // over the kernel's union, so there is no unmapped state to default — and
    // no argument for one, which is why it is not an input the caller could
    // get wrong.
    visualState: JULIUS_RUN_STATE_VISUAL_STATE[input.run.state],
    terminal: juliusMissionStateIsTerminal(input.run.state),
    usage: input.usage,
    usageStatus: input.usageStatus,
    activity: input.activity,
    brain: input.brain,
    card: input.card,
    // OPTIONAL, AND DEFAULTING TO EMPTY RATHER THAN TO UNKNOWN. The count on
    // the run snapshot is what carries "nobody looked"; a caller that omits
    // the list has described no gate, which is what an empty list says.
    humanGates: Object.freeze([...(input.humanGates ?? [])]),
    observedAtIso: input.observedAtIso,
  });
}

/* ----------------------------------------------------------- the verdict */

/**
 * Why a hydration was refused. The identity refusals matter most: a hydration
 * is adopted WHOLESALE, so a mis-routed one replaces everything at once with
 * another project's picture and nothing later contradicts it.
 */
export const WONDERLAND_HYDRATION_VERDICTS = [
  'accepted',
  'foreign_project',
  /** Its run's project and its own disagree. A malformed assembly. */
  'inconsistent',
  'unsupported_schema',
] as const;
export type WonderlandHydrationVerdict = (typeof WONDERLAND_HYDRATION_VERDICTS)[number];

/**
 * Judge a hydration against the project a world is bound to.
 *
 * SCHEMA IS CHECKED AND NOT COERCED. A world that accepted an unknown schema
 * would be guessing at the meaning of fields it does not have, and the guess
 * would be silent. Refusing is what lets a client and a bridge be deployed at
 * different times without one of them inventing the other's contract.
 */
export function wonderlandHydrationVerdict(
  boundProjectId: string,
  hydration: WonderlandHydration,
): WonderlandHydrationVerdict {
  if (hydration.schemaVersion !== WONDERLAND_HYDRATION_SCHEMA_V1) return 'unsupported_schema';
  if (boundProjectId.trim() === '' || hydration.projectId !== boundProjectId) {
    return 'foreign_project';
  }
  if (
    hydration.run.projectId !== hydration.projectId ||
    hydration.usage.compoundAgent.channel !== 'compound_agent' ||
    hydration.usage.singleAgent.channel !== 'single_agent' ||
    hydration.activity.projectId !== hydration.projectId ||
    hydration.activity.runId !== hydration.run.runId ||
    hydration.brain.projectId !== hydration.projectId
  ) {
    return 'inconsistent';
  }
  // THE PICTURE MUST MATCH THE RUN IT IS ABOUT. A hydration assembled with one
  // run's state and another's drawing would be adopted wholesale and never
  // contradicted — the world would animate the wrong mission under the right
  // name. Recomputed rather than trusted, from the same total mapping.
  if (
    hydration.visualState !== JULIUS_RUN_STATE_VISUAL_STATE[hydration.run.state] ||
    hydration.terminal !== juliusMissionStateIsTerminal(hydration.run.state)
  ) {
    return 'inconsistent';
  }
  // EVERY GATE, NOT A SAMPLE. A hydration is adopted wholesale, so one foreign
  // gate among correct ones would show a person being waited on for something
  // this world cannot see — and nothing arriving later would withdraw it.
  for (const gate of hydration.humanGates) {
    if (!wonderlandHumanGateBelongs(gate, hydration.projectId, hydration.run.runId)) {
      return 'inconsistent';
    }
  }
  return 'accepted';
}

/** True when a world may adopt it. */
export const wonderlandHydrationIsUsable = (
  boundProjectId: string,
  hydration: WonderlandHydration,
): boolean => wonderlandHydrationVerdict(boundProjectId, hydration) === 'accepted';

/**
 * What to ask for after adopting one.
 *
 * The tail, and only the tail. A reconnect costs one hydration plus the events
 * after the position it names — never the transcript.
 */
export interface WonderlandHydrationResume {
  readonly projectId: string;
  readonly runId: string;
  readonly afterSequence: number;
}

export function wonderlandHydrationResume(
  hydration: WonderlandHydration,
): WonderlandHydrationResume {
  return Object.freeze({
    projectId: hydration.projectId,
    runId: hydration.run.runId,
    // Zero when the snapshot could not say where it sat: the world then asks
    // for everything it can get and lets ordering refuse what it already has,
    // which is correct and merely more expensive.
    afterSequence: hydration.run.atSequence ?? 0,
  });
}
