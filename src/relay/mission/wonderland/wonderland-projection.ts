/**
 * SUNDAY RELAY — WONDERLAND: THE PROJECTION.
 *
 * Real Relay observations in, one `WonderlandWorld` document out. PURE: no
 * Node, no network, no clock. The observation instant is the second positional
 * argument, `observedAtIso`, following `projectOperations(record, asOf)`.
 *
 * WHAT THIS FILE REFUSES TO DO, in the words of the failures it prevents:
 *
 *  - It never calls `officialRelayDogViewForState` on a state Relay did not
 *    assert. That function resolves an unrecognised string to `idle` — correct
 *    for a surface that must always draw SOMETHING, and wrong here, because a
 *    world that renders an unobserved Agent as an idling one has answered a
 *    question Relay never answered. `KNOWN_DOG_STATES` is the guard.
 *
 *  - It never derives terminal text. Lines are copied from
 *    `RelayTerminalEvent`s that `projectTerminalEvent` already redacted and
 *    already stripped of private reasoning. There is no branch here that can
 *    produce a headline Relay did not produce.
 *
 *  - It never recomputes a Brain figure. `RelayOperationsView` is the model of
 *    record and every number is carried through `wonderlandFigure`.
 *
 *  - It never decides. `WonderlandMissionRequest` is the only outbound shape
 *    and it carries `authority: 'relay_decides'`.
 */

import type { Provenance } from '../../protocol/enums';
import type { RelayFigure, RelayOperationsView } from '../../shared/llmops';
import { knownFigure, unknownFigure } from '../../shared/llmops';
import {
  OFFICIAL_RELAY_DOG_PALETTE,
  OFFICIAL_RELAY_DOG_HEIGHT,
  OFFICIAL_RELAY_DOG_WIDTH,
} from '../../shared/official-relay-dog-sprite';
import {
  OFFICIAL_HOME_DOG_STATES,
  OFFICIAL_WORKSPACE_DOG_STATES,
  officialRelayDogViewForState,
} from '../../shared/official-relay-dog-states';
import { chakraDogPalette, chakraLabel, isChakraTier } from '../../shared/relay-chakra';
import type { ChakraTier } from '../../shared/relay-chakra';
import type { MissionStatus, MissionVerdict } from '../contracts';
import { isActiveLoopState, isTerminalLoopState, isWaitingLoopState } from '../loop/runtime/loop-runtime-state';
import type { RelayLoopRuntimeState } from '../loop/runtime/loop-runtime-types';
import type { AqualaOutcomeStatus } from '../status/status-model';
import type { RelayTerminalReadModel } from '../terminal';
import {
  WONDERLAND_AUTHORITY,
  WONDERLAND_CLIENT_ROLE,
  WONDERLAND_OWNER_ONLY_SECTIONS,
  WONDERLAND_WORLD_SCHEMA_VERSION,
  WONDERLAND_WORLD_VISIBLE_SECTIONS,
  wonderlandAnimationFor,
  wonderlandFigure,
  type WonderlandAgent,
  type WonderlandAttestation,
  type WonderlandBrainWeather,
  type WonderlandClassStanding,
  type WonderlandDogOverlay,
  type WonderlandDogSkin,
  type WonderlandGve,
  type WonderlandLoopSignal,
  type WonderlandMission,
  type WonderlandProjectEntity,
  type WonderlandReplication,
  type WonderlandTerminalLine,
  type WonderlandTerminalPanel,
  type WonderlandWorld,
} from './wonderland-contracts';

/* ----------------------------------------------------------- provenance */

/**
 * A sentence for every provenance, because a one-word badge is what lets a
 * simulated world get mistaken for a live one at a glance.
 */
const PROVENANCE_LABEL: Readonly<Record<Provenance, string>> = Object.freeze({
  simulated: 'SIMULATED WORLD — no Relay execution produced this state.',
  live: 'LIVE — projected from Relay execution state.',
  imported: 'IMPORTED — projected from a record Relay did not itself produce.',
  manual: 'MANUAL — projected from operator-entered state.',
});

/* ---------------------------------------------------------- attestation */

/**
 * Requested versus served.
 *
 * `attested` requires BOTH names and equality. The three failure sentences are
 * different on purpose: "the runtime never said" and "a different model
 * answered" are not the same fact, and an operator told the wrong one would go
 * and fix the wrong thing.
 */
export function projectWonderlandAttestation(
  requestedModel: string | null,
  servedModel: string | null,
): WonderlandAttestation {
  if (requestedModel !== null && servedModel !== null && requestedModel === servedModel) {
    return { requestedModel, servedModel, attested: true, unattestedReason: null };
  }
  const unattestedReason =
    servedModel === null && requestedModel === null
      ? 'Relay observed neither the requested nor the served model.'
      : servedModel === null
        ? 'The runtime did not report which model served this work.'
        : requestedModel === null
          ? 'Relay has no record of which model was requested.'
          : `A different model served this work: ${requestedModel} was requested, ${servedModel} answered.`;
  return { requestedModel, servedModel, attested: false, unattestedReason };
}

/* ------------------------------------------------------------- missions */

/** What Relay observed about one mission. Every field may be absent. */
export interface WonderlandMissionObservation {
  readonly missionId: string;
  readonly missionStatus?: MissionStatus | null;
  readonly verdict?: MissionVerdict | null;
  /** The four-dimension status, whole. Never a subset. */
  readonly status?: AqualaOutcomeStatus | null;
  readonly blockingFindingsOpen?: RelayFigure | null;
  readonly reviewerRequestedModel?: string | null;
  readonly reviewerServedModel?: string | null;
  readonly updatedAtIso?: string | null;
}

/**
 * One mission, projected.
 *
 * `observed` is EVIDENCED, not asserted by the caller: it is true only when at
 * least one of the three state facts arrived. An observation object naming a
 * mission and nothing else is a mission Relay knows the id of, which is not the
 * same as a mission whose state Relay has seen.
 */
export function projectWonderlandMission(
  observation: WonderlandMissionObservation,
): WonderlandMission {
  const missionStatus = observation.missionStatus ?? null;
  const verdict = observation.verdict ?? null;
  const status = observation.status ?? null;
  const observed = missionStatus !== null || verdict !== null || status !== null;

  return {
    missionId: observation.missionId,
    observed,
    unobservedReason: observed
      ? null
      : 'Relay has not observed this mission’s state. Not idle, not complete — unknown.',
    missionStatus,
    verdict,
    executionStatus: status?.executionStatus ?? null,
    outcomeStatus: status?.outcomeStatus ?? null,
    verificationStatus: status?.verificationStatus ?? null,
    releaseStatus: status?.releaseStatus ?? null,
    blockingFindingsOpen: wonderlandFigure(
      observation.blockingFindingsOpen ?? unknownFigure('not_observed'),
    ),
    reviewerAttestation: projectWonderlandAttestation(
      observation.reviewerRequestedModel ?? null,
      observation.reviewerServedModel ?? null,
    ),
    updatedAtIso: observation.updatedAtIso ?? null,
  };
}

/* ---------------------------------------------------------------- loops */

export interface WonderlandLoopObservation {
  readonly loopId: string;
  readonly state?: RelayLoopRuntimeState | null;
}

/**
 * One Loop, projected.
 *
 * `executing`, `waiting` and `terminal` all come from the Loop Engine's own
 * classifiers. Nothing here decides what counts as progress — `isActiveLoopState`
 * already excludes every wait state, which is the distinction a progress
 * indicator has to respect to avoid lying once a frame.
 */
export function projectWonderlandLoopSignal(
  observation: WonderlandLoopObservation,
): WonderlandLoopSignal {
  const state = observation.state ?? null;
  return {
    loopId: observation.loopId,
    observed: state !== null,
    state,
    executing: state !== null && isActiveLoopState(state),
    waiting: state !== null && isWaitingLoopState(state),
    terminal: state !== null && isTerminalLoopState(state),
  };
}

/* ---------------------------------------------------------------- skins */

/**
 * A skin request. There is deliberately NO width, height, pose or silhouette
 * field: the identity documents state that the palette may be overridden per PSP
 * and the poses and proportions may not, so the request type simply cannot
 * express the forbidden change. A rule enforced by the absence of a field
 * cannot be violated by a caller who did not read the rule.
 */
export interface WonderlandSkinRequest {
  readonly skinId: string;
  readonly displayName: string;
  /**
   * `unknown` on purpose. This is the boundary a persisted value crosses, and
   * `chakraDogPalette` already resolves an unrecognised tier to the untiered
   * default rather than to `root`.
   */
  readonly chakraTier?: unknown;
}

/** The Dog as shipped: the existing PSP colorway id, untiered. */
export const WONDERLAND_DEFAULT_SKIN_REQUEST: WonderlandSkinRequest = Object.freeze({
  skinId: 'official-cream',
  displayName: 'Official Cream',
  chakraTier: null,
});

/**
 * Resolve a skin.
 *
 * Proportions are STAMPED from the official sprite module rather than accepted
 * or defaulted here, so a change to the canonical grid moves the 3D dog with the
 * 2D one and no local constant can disagree with it.
 */
export function resolveWonderlandDogSkin(
  request: WonderlandSkinRequest = WONDERLAND_DEFAULT_SKIN_REQUEST,
): WonderlandDogSkin {
  const tier: ChakraTier | null = isChakraTier(request.chakraTier) ? request.chakraTier : null;
  const accents = chakraDogPalette(tier);
  return {
    skinId: request.skinId,
    displayName: request.displayName,
    chakraTier: tier,
    eyeColor: accents.y,
    collarColor: accents.c,
    // Body, shading and visor are the animal. They are never recoloured.
    bodyColor: OFFICIAL_RELAY_DOG_PALETTE.w,
    shadowColor: OFFICIAL_RELAY_DOG_PALETTE.s,
    visorColor: OFFICIAL_RELAY_DOG_PALETTE.d,
    gridWidth: OFFICIAL_RELAY_DOG_WIDTH,
    gridHeight: OFFICIAL_RELAY_DOG_HEIGHT,
    uniformScaleOnly: true,
  };
}

/** A label for a surface that names the tier. Untiered says so. */
export const wonderlandSkinTierLabel = (skin: WonderlandDogSkin): string =>
  chakraLabel(skin.chakraTier);

/* ---------------------------------------------------------------- agent */

/**
 * Every dog state Relay's own surfaces produce.
 *
 * The guard, and the reason it exists: `officialRelayDogViewForState` resolves
 * an unrecognised string to `idle` so a surface always has something safe to
 * draw. In a world-state document that fallback would convert "Relay said
 * nothing" into "the Agent is idling", which is the substitution the whole
 * projection exists to prevent. Membership is checked BEFORE the call.
 */
const KNOWN_DOG_STATES: ReadonlySet<string> = new Set<string>([
  ...OFFICIAL_WORKSPACE_DOG_STATES,
  ...OFFICIAL_HOME_DOG_STATES,
]);

export interface WonderlandAgentObservation {
  readonly agentId: string;
  /**
   * The workspace/home dog state Relay produced — `dogState` on the workspace
   * projection. Null, absent, or an unrecognised value all mean unobserved.
   */
  readonly workspaceState?: string | null;
}

/**
 * The Agent, embodied.
 *
 * `overlay` is the only place loop state touches the Dog, and it is ADDITIVE:
 * the clip still comes from the observed activity, so Wonderland can never show
 * a silhouette the website does not. An unobserved Agent gets `dormant` and
 * `none` — never a hover it was not observed to be performing.
 */
export function projectWonderlandAgent(
  observation: WonderlandAgentObservation,
  loops: readonly WonderlandLoopSignal[],
  skin: WonderlandDogSkin,
): WonderlandAgent {
  const raw = observation.workspaceState ?? null;
  const known = raw !== null && KNOWN_DOG_STATES.has(raw);
  const view = known ? officialRelayDogViewForState(raw) : null;
  const overlay: WonderlandDogOverlay = loops.some((loop) => loop.executing)
    ? 'loop_meditation_hover'
    : 'none';

  return {
    agentId: observation.agentId,
    observed: known,
    workspaceState: raw,
    activity: view?.activity ?? null,
    pose: view?.pose ?? null,
    motion: view?.motion ?? null,
    animation: wonderlandAnimationFor(view?.motion ?? null),
    overlay,
    travelling: view === null ? null : view.travelling,
    attentionRequired: view === null ? null : view.attentionRequired,
    activityLabel: view?.label ?? null,
    skin,
  };
}

/* ------------------------------------------------------------- terminal */

/**
 * How many lines the in-world panel carries.
 *
 * The panel is deliberately small, wide and minimal — it sits beneath the Dog in
 * a 3D scene, not in a browser pane. When Relay has more, `truncatedFrom` says
 * how many, because a window silently presented as a whole is the same class of
 * lie as a percentile computed from three samples.
 */
export const WONDERLAND_TERMINAL_MAX_LINES = 6;

/**
 * The in-world terminal panel.
 *
 * Every line is COPIED. `headline` and `detail` come from a `RelayTerminalEvent`
 * that `projectTerminalEvent` produced, which is where redaction and the
 * "Private reasoning omitted." substitution already happened. This function adds
 * no wording of its own, which is why `redactionsApplied` and
 * `omittedPrivateReasoning` travel with each line: the panel can say that
 * something was removed without knowing what it was.
 */
export function projectWonderlandTerminal(
  readModel: RelayTerminalReadModel | null,
  options: { readonly maxLines?: number } = {},
): WonderlandTerminalPanel {
  if (readModel === null) {
    return {
      present: false,
      unavailableReason:
        'No Relay execution stream is attached. The panel is empty because there is nothing to show, not because the system is quiet.',
      connectionState: null,
      provenance: null,
      runId: null,
      missionId: null,
      lines: [],
      truncatedFrom: null,
      lastSequence: null,
    };
  }

  const maxLines = options.maxLines ?? WONDERLAND_TERMINAL_MAX_LINES;
  const all = readModel.events;
  const kept = maxLines >= all.length ? all : all.slice(all.length - maxLines);
  const lines: WonderlandTerminalLine[] = kept.map((event) => ({
    sequence: event.sequence,
    headline: event.headline,
    detail: event.safeSummary,
    severity: event.severity,
    provenance: event.provenance,
    omittedPrivateReasoning: event.omittedPrivateReasoning,
    redactionsApplied: event.redactionsApplied,
  }));

  return {
    present: true,
    unavailableReason: null,
    connectionState: readModel.connectionState,
    provenance: readModel.provenance,
    runId: readModel.runId,
    missionId: readModel.missionId,
    lines,
    truncatedFrom: all.length > lines.length ? all.length : null,
    // The read model's own cursor, not the last line the panel happened to keep.
    lastSequence: readModel.lastSequence,
  };
}

/* --------------------------------------------------------------- brain */

/**
 * The Brain's operational signals, as weather.
 *
 * `unrecoveredErrorCount` is known ONLY when `unrecoveredIsExact`. When the
 * store evicted errors the count is a FLOOR, and a floor rendered as a count
 * would let the world imply every error was recovered — which
 * `RelayOperationsView` documents as the thing that flag exists to prevent.
 */
export function projectWonderlandBrain(
  view: RelayOperationsView | null,
): WonderlandBrainWeather {
  if (view === null) {
    return {
      present: false,
      projectId: null,
      health: 'unknown',
      healthReason: 'No Project Brain operational record is attached to this world.',
      errorRate: wonderlandFigure(unknownFigure('not_observed')),
      signalAgeMs: wonderlandFigure(unknownFigure('not_observed')),
      unrecoveredErrorCount: wonderlandFigure(unknownFigure('not_observed')),
      waitingOnUserOpen: false,
      openRepairLoops: wonderlandFigure(unknownFigure('not_observed')),
    };
  }
  return {
    present: true,
    projectId: view.projectId,
    health: view.health,
    healthReason: view.healthReason,
    errorRate: wonderlandFigure(view.errorRate),
    signalAgeMs: wonderlandFigure(view.signalAgeMs),
    unrecoveredErrorCount: wonderlandFigure(
      view.unrecoveredIsExact
        ? knownFigure(view.unrecoveredErrorCount)
        : unknownFigure('unreadable'),
    ),
    waitingOnUserOpen: view.waitingOnUserOpen,
    openRepairLoops: wonderlandFigure(knownFigure(view.repairs.inProgress)),
  };
}

/* ---------------------------------------------------------- replication */

/**
 * The authority header.
 *
 * The section lists are the contract's own constants rather than anything
 * computed here, so `wonderland-projection.test.ts` can prove they cover the
 * document exactly once: a section in neither list would be replicated in
 * whichever direction the engine defaulted, which is not a decision anybody
 * would have made on purpose.
 */
export function projectWonderlandReplication(revision: number): WonderlandReplication {
  return {
    authority: WONDERLAND_AUTHORITY,
    clientRole: WONDERLAND_CLIENT_ROLE,
    revision,
    ownerOnlySections: WONDERLAND_OWNER_ONLY_SECTIONS,
    worldVisibleSections: WONDERLAND_WORLD_VISIBLE_SECTIONS,
  };
}

/* ------------------------------------------------------------ the world */

export interface WonderlandWorldInput {
  /** Monotonic, supplied by whoever owns the snapshot sequence. */
  readonly revision: number;
  readonly provenance: Provenance;
  readonly agent: WonderlandAgentObservation;
  readonly skin?: WonderlandSkinRequest;
  readonly loops?: readonly WonderlandLoopObservation[];
  readonly missions?: readonly WonderlandMissionObservation[];
  /** Already-projected entities, from `wonderland-entities.ts`. */
  readonly entities?: readonly WonderlandProjectEntity[];
  readonly brain?: RelayOperationsView | null;
  readonly terminal?: RelayTerminalReadModel | null;
  /** Already-projected GVE, from `wonderland-gve.ts`. Null when none is live. */
  readonly gve?: WonderlandGve | null;
  /** Already-projected standings, from `wonderland-classes.ts`. */
  readonly classes?: readonly WonderlandClassStanding[];
  readonly terminalMaxLines?: number;
}

/**
 * The whole world-state document.
 *
 * Composition only: every section is produced by the function that owns it, so
 * there is exactly one place each rule lives. `observedAtIso` is echoed onto the
 * document, as `RelayOperationsView.asOf` and `RelayBrainDocument.generatedAt`
 * are, so a consumer can tell what instant it is looking at.
 */
export function projectWonderlandWorld(
  input: WonderlandWorldInput,
  observedAtIso: string,
): WonderlandWorld {
  const loops = (input.loops ?? []).map(projectWonderlandLoopSignal);
  const skin = resolveWonderlandDogSkin(input.skin ?? WONDERLAND_DEFAULT_SKIN_REQUEST);

  return {
    schemaVersion: WONDERLAND_WORLD_SCHEMA_VERSION,
    observedAtIso,
    revision: input.revision,
    provenance: input.provenance,
    simulated: input.provenance === 'simulated',
    provenanceLabel: PROVENANCE_LABEL[input.provenance],
    agent: projectWonderlandAgent(input.agent, loops, skin),
    loops,
    missions: (input.missions ?? []).map(projectWonderlandMission),
    entities: input.entities ?? [],
    brain: projectWonderlandBrain(input.brain ?? null),
    terminal: projectWonderlandTerminal(input.terminal ?? null, {
      maxLines: input.terminalMaxLines,
    }),
    gve: input.gve ?? null,
    classes: input.classes ?? [],
    replication: projectWonderlandReplication(input.revision),
  };
}
