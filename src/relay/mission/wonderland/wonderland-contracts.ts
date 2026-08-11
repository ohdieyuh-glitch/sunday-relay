/**
 * SUNDAY RELAY — WONDERLAND: THE RELAY↔UNREAL CONTRACT.
 *
 * Relay is where a user BUILDS their Compound AI Agent. Wonderland is where
 * that Agent LIVES. This module is the seam between them, and it is a seam and
 * not a second product: Relay stays authoritative for missions, loops, the
 * Project Brain, permissions, verification, the marketplace and every durable
 * record. Unreal visualizes and requests. It never decides.
 *
 * WHAT THIS MODULE IS
 *
 * A versioned, typed, PURE-DOMAIN projection: real Relay state in, one
 * world-state document out. No Node, no network, no clock — the observation
 * instant arrives as an injected ISO string, exactly as in `mission/durable`,
 * `mission/economics` and `mission/loop`.
 *
 * THE FOUR RULES THIS FILE EXISTS TO MAKE STRUCTURAL
 *
 *  1. UNKNOWN IS NEVER ZERO AND NEVER A DEFAULT. A mission Relay has not
 *     observed projects as unobserved — never as idle, never as complete, and
 *     never as a zero finding count. Numbers that can be unknown travel as
 *     `WonderlandFigure`, which is `RelayFigure` from the Project Brain in a
 *     shape a USTRUCT can hold; a vocabulary that can be unknown travels as
 *     `null`, and every struct that can be wholly unobserved carries a sentence
 *     saying so — `unobservedReason`, `unavailableReason`, `captureBlockedReason`,
 *     `nextStageRequirement`, `healthReason`, `unattestedReason`. A bare flag is
 *     never the whole answer.
 *
 *  2. THE PROJECTION IS READ-ONLY OVER RELAY TRUTH. Every function here takes
 *     observations and returns a document. Nothing mutates its input, appends
 *     an event, touches evidence, or reaches a provider. The world can carry a
 *     REQUEST (`WonderlandMissionRequest`), and a request is not a decision.
 *
 *  3. NOTHING SIMULATED MAY RENDER AS REAL. `provenance` is Relay's own
 *     `Provenance` and is carried on the document itself, with `simulated`
 *     beside it so a renderer cannot reach the world content without having
 *     passed the label.
 *
 *  4. A FIELD THE C++ SIDE READS MUST EXIST HERE, AND VICE VERSA. Every
 *     document struct declares its field names as a runtime array built by
 *     `exactKeys`, which fails `tsc` when the array and the interface disagree
 *     in EITHER direction. `wonderland-cpp-parity.test.ts` then compares those
 *     arrays against the real `.h` files. Two mechanically checked links, so
 *     drift has nowhere to hide.
 *
 * WHAT IS DELIBERATELY ABSENT: any mission engine, any permission decision,
 * any verification verdict of its own, any orchestration. Those exist once, in
 * Relay, and this module reads their output. See docs/relay/WONDERLAND.md.
 */

import { PROVENANCES, type Provenance } from '../../protocol/enums';
import { RELAY_HEALTH_STATES, RELAY_UNKNOWN_REASONS } from '../../shared/llmops';
import type { RelayFigure, RelayHealthState, RelayUnknownReason } from '../../shared/llmops';
import type { ChakraTier } from '../../shared/relay-chakra';
import { OFFICIAL_RELAY_DOG_ACTIVITIES } from '../../shared/official-relay-dog-states';
import type {
  OfficialRelayDogActivity,
  OfficialRelayDogMotion,
} from '../../shared/official-relay-dog-states';
import { OFFICIAL_RELAY_DOG_POSE_NAMES } from '../../shared/official-relay-dog-sprite';
import type { OfficialRelayDogPose } from '../../shared/official-relay-dog-sprite';
import { MISSION_STATUSES, MISSION_VERDICTS } from '../contracts';
import type { MissionStatus, MissionVerdict } from '../contracts';
import { RELAY_LOOP_RUNTIME_STATES } from '../loop/runtime/loop-runtime-types';
import type { RelayLoopRuntimeState } from '../loop/runtime/loop-runtime-types';
import { AQUALA_STATUS_VALUES } from '../status/status-model';
import type {
  AqualaExecutionStatus,
  AqualaMissionOutcomeStatus,
  AqualaReleaseStatus,
  AqualaVerificationStatus,
} from '../status/status-model';
import type { ConnectionState, TerminalProvenanceLabel } from '../terminal';

/* ------------------------------------------------------------- versioning */

export const WONDERLAND_WORLD_SCHEMA_V1 = 'relay-wonderland-world.v1' as const;
export const WONDERLAND_WORLD_SCHEMA_VERSION = WONDERLAND_WORLD_SCHEMA_V1;
export const SUPPORTED_WONDERLAND_WORLD_SCHEMA_VERSIONS = [
  WONDERLAND_WORLD_SCHEMA_V1,
] as const;
export type WonderlandWorldSchemaVersion =
  (typeof SUPPORTED_WONDERLAND_WORLD_SCHEMA_VERSIONS)[number];

/* --------------------------------------------------------- exact key sets */

/**
 * A runtime field-name list that `tsc` proves is EXACTLY an interface's keys.
 *
 * This is the first of the two parity links, and it is the one that costs
 * nothing to keep true: a field added to the interface makes the literal array
 * fail to satisfy the parameter type (the missing key is named in the error),
 * and a name in the array that is not a key fails the `keyof T` constraint.
 *
 * The second link — `.h` files against these arrays — lives in
 * `wonderland-cpp-parity.test.ts`. Neither link alone is enough: a manifest
 * that drifts from its interface would let the test compare C++ against a
 * fiction and report agreement.
 */
export const exactKeys =
  <T,>() =>
    <K extends readonly (keyof T & string)[]>(
      keys: K &
      (Exclude<keyof T, K[number]> extends never
        ? unknown
        : readonly ['wonderland parity: field list is missing', Exclude<keyof T, K[number]>]),
    ): K => keys as K;

/**
 * The field names of `T` whose type admits `null`, as an object type so
 * `exactKeys` can prove a runtime list against them.
 *
 * This is what keeps the NULLABILITY manifests below from being a second,
 * hand-maintained opinion: making a field nullable in an interface, or making a
 * nullable field required, breaks the corresponding list at compile time. The
 * C++ parity test then requires every nullable field to be carried by a type
 * that can actually express absence.
 */
type NullableFieldNames<T> = Record<
  { [K in keyof T]-?: null extends T[K] ? K : never }[keyof T] & string,
  unknown
>;

/** `exactKeys`, narrowed to the nullable field names of `T`. */
export const nullableKeys = <T,>() => exactKeys<NullableFieldNames<T>>();

/* -------------------------------------------------------------- figures */

/**
 * A number that is either known or explicitly not, FLATTENED.
 *
 * `RelayFigure` — the Project Brain's discriminated union — is the model of
 * record and `wonderlandFigure` is the only way to build one of these. It is
 * flattened here because a USTRUCT cannot hold a discriminated union, and the
 * flattening keeps the guarantee: `value` is null whenever `known` is false, so
 * there is still no numeric field to read without checking `known` first.
 *
 * The alternative — sending `value: 0` with `known: false` — is exactly the bug
 * `RelayFigure` was built to prevent, because Unreal's `int64` cannot be null
 * and something in the chain would have had to invent the zero.
 */
export interface WonderlandFigure {
  readonly known: boolean;
  /** Null whenever `known` is false. Never 0 standing in for unknown. */
  readonly value: number | null;
  /** Null whenever `known` is true; otherwise Relay's own reason. */
  readonly reason: RelayUnknownReason | null;
}

/**
 * The breath's fields. `exactKeys` fails `tsc` if this array and
 * `WonderlandBreath` disagree, which is how the drafted-and-removed
 * `riseGridUnits` cannot come back on one side only.
 */
export const WONDERLAND_BREATH_FIELDS = exactKeys<WonderlandBreath>()([
  'uniformScale',
  'phase',
] as const);

export const WONDERLAND_FIGURE_FIELDS = exactKeys<WonderlandFigure>()([
  'known',
  'value',
  'reason',
] as const);

/** The one conversion. Derived from `RelayFigure`, never re-decided. */
export function wonderlandFigure(figure: RelayFigure): WonderlandFigure {
  return figure.known
    ? { known: true, value: figure.value, reason: null }
    : { known: false, value: null, reason: figure.reason };
}

/* --------------------------------------------------------- attestation */

/**
 * Requested versus served, as evidence.
 *
 * `attested` is true ONLY when Relay observed both names and they match. A
 * missing served model is not agreement, and this is not a detail: the hosted
 * reviewer currently serves an unattested model, and a world that rendered
 * that as attested would be advertising a guarantee Relay does not hold.
 */
export interface WonderlandAttestation {
  readonly requestedModel: string | null;
  /** The name the runtime reported. Never inferred from configuration. */
  readonly servedModel: string | null;
  readonly attested: boolean;
  /** A sentence whenever `attested` is false. Never a bare flag. */
  readonly unattestedReason: string | null;
}

export const WONDERLAND_ATTESTATION_FIELDS = exactKeys<WonderlandAttestation>()([
  'requestedModel',
  'servedModel',
  'attested',
  'unattestedReason',
] as const);

/* ------------------------------------------------------------- missions */

/**
 * One mission as the world sees it.
 *
 * THE FOUR DIMENSIONS NEVER COLLAPSE. `status/status-model.ts` exists because
 * execution completed ≠ outcome satisfied ≠ verification complete ≠ release
 * authorized, and a world that reduced them to one "done" would re-introduce
 * the ambiguity that model was built to remove. All four travel, each nullable
 * on its own.
 */
export interface WonderlandMission {
  readonly missionId: string;
  /** False when Relay has no observation of this mission at all. */
  readonly observed: boolean;
  /** A sentence whenever `observed` is false. */
  readonly unobservedReason: string | null;
  readonly missionStatus: MissionStatus | null;
  readonly verdict: MissionVerdict | null;
  readonly executionStatus: AqualaExecutionStatus | null;
  readonly outcomeStatus: AqualaMissionOutcomeStatus | null;
  readonly verificationStatus: AqualaVerificationStatus | null;
  readonly releaseStatus: AqualaReleaseStatus | null;
  /** Unknown findings are unknown, never zero findings. */
  readonly blockingFindingsOpen: WonderlandFigure;
  readonly reviewerAttestation: WonderlandAttestation;
  readonly updatedAtIso: string | null;
}

export const WONDERLAND_MISSION_FIELDS = exactKeys<WonderlandMission>()([
  'missionId',
  'observed',
  'unobservedReason',
  'missionStatus',
  'verdict',
  'executionStatus',
  'outcomeStatus',
  'verificationStatus',
  'releaseStatus',
  'blockingFindingsOpen',
  'reviewerAttestation',
  'updatedAtIso',
] as const);

/* ---------------------------------------------------------------- loops */

/**
 * A Loop the world can see running.
 *
 * `executing` is NOT "not terminal". It is `isActiveLoopState` — the Loop
 * Engine's own classifier — because a run blocked on approval is making no
 * progress and a world that animated it would be lying once a frame.
 */
export interface WonderlandLoopSignal {
  readonly loopId: string;
  readonly observed: boolean;
  readonly state: RelayLoopRuntimeState | null;
  /** Doing work right now, per the Loop Engine's classifier. */
  readonly executing: boolean;
  /** Blocked on something external. Not progress, not failure. */
  readonly waiting: boolean;
  readonly terminal: boolean;
}

export const WONDERLAND_LOOP_SIGNAL_FIELDS = exactKeys<WonderlandLoopSignal>()([
  'loopId',
  'observed',
  'state',
  'executing',
  'waiting',
  'terminal',
] as const);

/* ------------------------------------------------------------ the agent */

/**
 * The Relay Dog's 3D animation clips.
 *
 * ONE PER OFFICIAL MOTION, plus `dormant` for "Relay has not observed an
 * activity". The mapping is total over `OfficialRelayDogMotion`, so the 3D dog
 * and the 2D dog cannot show different behaviour for the same Relay state —
 * they read the same field through the same table.
 *
 * `dormant` is not `idle_patrol`. Idle is an observed Relay state; dormant is
 * the absence of an observation, and rendering the second as the first is the
 * exact substitution rule 1 forbids.
 */
export const WONDERLAND_DOG_ANIMATIONS = [
  'dormant',
  'patrol_walk',
  'stand_still',
  'attention_jump',
  'work_scratch',
  'scan_sniff',
  'carry_walk',
  'halt_slump',
  'sleep_curl',
  'dig_forward',
  'code_type',
] as const;
export type WonderlandDogAnimation = (typeof WONDERLAND_DOG_ANIMATIONS)[number];

/**
 * Official motion → 3D clip. TOTAL over `OfficialRelayDogMotion`, so adding a
 * motion to the shared identity module fails this file until Wonderland has a
 * clip for it. `dormant` is deliberately absent from the right-hand side: it
 * belongs to the ABSENCE of a motion, and `wonderlandAnimationFor` is the only
 * thing that may produce it.
 */
export const WONDERLAND_MOTION_ANIMATION: Readonly<
  Record<OfficialRelayDogMotion, WonderlandDogAnimation>
> = Object.freeze({
  patrol: 'patrol_walk',
  still: 'stand_still',
  attention_jump: 'attention_jump',
  work_scratch: 'work_scratch',
  scan: 'scan_sniff',
  carry: 'carry_walk',
  halt: 'halt_slump',
  sleep: 'sleep_curl',
  dig: 'dig_forward',
  code_progression: 'code_type',
});

/**
 * Every official motion, DERIVED from the total map above rather than restated.
 *
 * Deriving matters here: the shared identity module declares
 * `OfficialRelayDogMotion` as a type-only union with no runtime array, and
 * `OFFICIAL_RELAY_DOG_ACTIVITY_MOTION` does not cover it (`work_scratch` is
 * retained for the `reaching` pose and no activity selects it any more). A list
 * derived from that map would have silently dropped a motion the C++ enum
 * needs, and the parity test would have called the smaller set agreement.
 */
export const WONDERLAND_DOG_MOTIONS = Object.keys(
  WONDERLAND_MOTION_ANIMATION,
) as readonly OfficialRelayDogMotion[];

/** The clip for an observed motion, or `dormant` for no observation. */
export function wonderlandAnimationFor(
  motion: OfficialRelayDogMotion | null,
): WonderlandDogAnimation {
  return motion === null ? 'dormant' : WONDERLAND_MOTION_ANIMATION[motion];
}

/**
 * An ADDITIVE layer over the animation, never a replacement.
 *
 * The founder's example — a meditation hover while a `/loop` executes — has to
 * be additive, because the official pose table is the Dog's identity and a
 * replacement would give Wonderland a silhouette the website never shows. So
 * the clip still comes from the observed activity and the hover rides on top.
 */
export const WONDERLAND_DOG_OVERLAYS = ['none', 'loop_meditation_hover'] as const;
export type WonderlandDogOverlay = (typeof WONDERLAND_DOG_OVERLAYS)[number];

/* ------------------------------------------------------------- the breath */

/**
 * THE DOG BREATHES. A THIRD LAYER, AND IT CARRIES NO INFORMATION.
 *
 * The founder asked for the Relay Dogs to "move around like it's breathing in
 * and out", and that sits against a rule this module already enforces: the
 * animation CLIP is a pure function of the motion Relay observed, with no
 * elapsed-time input, no random source and no "looks busy" heuristic. Breathing
 * is time-driven. Both are right, because they are different layers:
 *
 *   1. the CLIP — chosen by Relay state, never by a timer
 *   2. the OVERLAY — additive, e.g. a meditation hover while a Loop executes
 *   3. the BREATH — ambient, continuous, and deliberately INFORMATION-FREE
 *
 * **The breath must never encode anything.** A breath that quickened while a
 * mission was busy would be a second status channel, and an untruthful one: a
 * viewer could not tell whether a fast breath meant "Relay is working" or "the
 * animation is simply fast", and Relay's whole thesis is that a surface never
 * implies a fact it cannot support. So the period and the amplitude are
 * constants, and `wonderlandBreathAt` takes **elapsed seconds and nothing
 * else** — there is no state parameter, and there must never be one. That
 * absence is the guarantee; a comment promising it would not be.
 *
 * IT SCALES UNIFORMLY, AND ONLY UNIFORMLY. `FWonderlandDogProportions`
 * prohibits independent width and height scaling because it distorts the body
 * into a humanoid, so the swell is one factor on every axis. Scaling the height
 * alone to fake a chest would break the identity the founder's reference image
 * confirms.
 */
export const WONDERLAND_BREATH = Object.freeze({
  /** One full inhale and exhale. A calm resting rate, not an exerted one. */
  periodSeconds: 4,
  /** Peak uniform swell. 1.5% reads as alive; more reads as a pulse effect. */
  scaleAmplitude: 0.015,
});

/**
 * THERE IS NO VERTICAL RISE, and there was one for an hour.
 *
 * A `riseGridUnits` field was drafted here, and nothing could apply it: the pawn
 * does not know its own grid-unit-to-world size, and inventing a constant to
 * convert it would have been a fabricated number in the identity contract. The
 * choice was a dead field carrying a comment that described behaviour nothing
 * performed — this repository's most frequent defect — or one honest swell. A
 * 1.5% uniform swell on a voxel figure reads as breathing on its own.
 */

export interface WonderlandBreath {
  /** Multiply the Dog's uniform scale by this. Never below 1. */
  readonly uniformScale: number;
  /** 0 at rest, 1 at full inhale. Exposed so a renderer can drive a highlight. */
  readonly phase: number;
}

/**
 * The breath at an instant.
 *
 * `(1 - cos)/2` rather than a raw sine, so the curve runs rest → inhale → rest
 * and the Dog never shrinks below its own size on the exhale. A sine would make
 * it smaller than itself for half of every cycle, which reads as deflating
 * rather than breathing.
 *
 * A negative, infinite or NaN elapsed time is not a time. It resolves to rest
 * rather than throwing: a renderer handed a bad clock should show a still Dog,
 * not crash the world.
 */
export function wonderlandBreathAt(elapsedSeconds: number): WonderlandBreath {
  const usable = Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? elapsedSeconds : 0;
  const cycles = usable / WONDERLAND_BREATH.periodSeconds;
  const eased = (1 - Math.cos(2 * Math.PI * (cycles % 1))) / 2;
  return {
    uniformScale: 1 + WONDERLAND_BREATH.scaleAmplitude * eased,
    phase: eased,
  };
}

/**
 * A skin TRANSFORMS the Relay Dog. It never replaces it.
 *
 * The identity docs are explicit: the palette may be overridden per PSP, and
 * `OFFICIAL_RELAY_DOG_POSES` — the silhouette, ears, visor, eyes, proportions —
 * may not. So this struct carries colour and carries the proportions as
 * READ-BACK facts stamped from the official sprite module. There is no field a
 * skin could set to change them, which is why a test can prove it: the type
 * has nowhere to put a different width.
 */
export interface WonderlandDogSkin {
  readonly skinId: string;
  readonly displayName: string;
  /** Progression accent, or null for the Dog exactly as shipped. */
  readonly chakraTier: ChakraTier | null;
  readonly eyeColor: string;
  readonly collarColor: string;
  readonly bodyColor: string;
  readonly shadowColor: string;
  readonly visorColor: string;
  /** Stamped from OFFICIAL_RELAY_DOG_WIDTH. Identity, not configuration. */
  readonly gridWidth: number;
  readonly gridHeight: number;
  /** Always true: independent width/height scaling distorts the body. */
  readonly uniformScaleOnly: boolean;
}

export const WONDERLAND_DOG_SKIN_FIELDS = exactKeys<WonderlandDogSkin>()([
  'skinId',
  'displayName',
  'chakraTier',
  'eyeColor',
  'collarColor',
  'bodyColor',
  'shadowColor',
  'visorColor',
  'gridWidth',
  'gridHeight',
  'uniformScaleOnly',
] as const);

/** The Compound AI Agent, embodied. */
export interface WonderlandAgent {
  readonly agentId: string;
  /** False when Relay reported no workspace dog state. */
  readonly observed: boolean;
  /** The raw workspace state Relay produced, kept for traceability. */
  readonly workspaceState: string | null;
  readonly activity: OfficialRelayDogActivity | null;
  readonly pose: OfficialRelayDogPose | null;
  readonly motion: OfficialRelayDogMotion | null;
  /** Derived from `motion` alone; `dormant` when motion is null. */
  readonly animation: WonderlandDogAnimation;
  readonly overlay: WonderlandDogOverlay;
  /** Null when unobserved — an unknown activity does not travel or rest. */
  readonly travelling: boolean | null;
  readonly attentionRequired: boolean | null;
  readonly activityLabel: string | null;
  readonly skin: WonderlandDogSkin;
}

export const WONDERLAND_AGENT_FIELDS = exactKeys<WonderlandAgent>()([
  'agentId',
  'observed',
  'workspaceState',
  'activity',
  'pose',
  'motion',
  'animation',
  'overlay',
  'travelling',
  'attentionRequired',
  'activityLabel',
  'skin',
] as const);

/* ------------------------------------------------- the in-world terminal */

/**
 * One line of the in-world terminal.
 *
 * Every field is COPIED from a `RelayTerminalEvent` that `projectTerminalEvent`
 * already redacted and already stripped of private reasoning. Nothing here
 * re-derives text, which is the whole reason this struct is thin: a second
 * wording is a second chance to invent one.
 */
export interface WonderlandTerminalLine {
  readonly sequence: number;
  readonly headline: string;
  readonly detail: string;
  readonly severity: string | null;
  readonly provenance: Provenance;
  readonly omittedPrivateReasoning: boolean;
  readonly redactionsApplied: number;
}

export const WONDERLAND_TERMINAL_LINE_FIELDS = exactKeys<WonderlandTerminalLine>()([
  'sequence',
  'headline',
  'detail',
  'severity',
  'provenance',
  'omittedPrivateReasoning',
  'redactionsApplied',
] as const);

/**
 * The small, wide, minimal transparent panel beneath the Dog.
 *
 * `unavailable` is a state the panel SHOWS. A terminal with no read model
 * renders the reason, not an empty frame that reads as a quiet system.
 */
export interface WonderlandTerminalPanel {
  readonly present: boolean;
  readonly unavailableReason: string | null;
  readonly connectionState: ConnectionState | null;
  readonly provenance: TerminalProvenanceLabel | null;
  readonly runId: string | null;
  readonly missionId: string | null;
  readonly lines: readonly WonderlandTerminalLine[];
  /** Total lines Relay had, when more than `lines` carries. Null when none dropped. */
  readonly truncatedFrom: number | null;
  readonly lastSequence: number | null;
}

export const WONDERLAND_TERMINAL_PANEL_FIELDS = exactKeys<WonderlandTerminalPanel>()([
  'present',
  'unavailableReason',
  'connectionState',
  'provenance',
  'runId',
  'missionId',
  'lines',
  'truncatedFrom',
  'lastSequence',
] as const);

/* ---------------------------------------------------- project → entity */

/**
 * What KIND of thing a project is. Form follows this, never repository size.
 *
 * `unknown` is a real member and it is first: a project whose category Relay
 * has not established gets the fogged form, not the default building. The
 * direction was explicit that repositories are not all skyscrapers, and a
 * silent fallback to one shape is how that happens anyway.
 */
export const WONDERLAND_PROJECT_CATEGORIES = [
  'unknown',
  'game_3d_shooter',
  'database_platform',
  'ai_system',
  'devtool',
  'cloud_system',
  'web_application',
  'mobile_application',
  'research_codebase',
] as const;
export type WonderlandProjectCategory = (typeof WONDERLAND_PROJECT_CATEGORIES)[number];

/**
 * The world form a project takes. Creatures, vessels, machines and landmarks —
 * chosen by category, and never by how much code was pushed.
 */
export const WONDERLAND_ENTITY_FORMS = [
  /** Relay has not established a category. Rendered fogged, not built. */
  'fogged_unknown',
  /** 3D shooter → a giant war creature: spider/scorpion silhouette. */
  'war_creature',
  /** Database platform → an enormous data vessel that carries its own weather. */
  'data_vessel',
  /** AI system → an intelligent mythical organism that watches back. */
  'mythic_organism',
  /** Devtool → a clockwork entity of gears, escapements and strange dials. */
  'clockwork_entity',
  /** Cloud system → a floating carrier-continent creature. */
  'sky_carrier',
  /** Web application → a glass pavilion of impossible galleries. */
  'glass_pavilion',
  /** Mobile application → a walking caravan that folds and unfolds. */
  'wanderer_caravan',
  /** Research codebase → a living library-landmark, half garden half archive. */
  'library_landmark',
] as const;
export type WonderlandEntityForm = (typeof WONDERLAND_ENTITY_FORMS)[number];

/**
 * A project, as a world entity.
 *
 * EVOLUTION IS DRIVEN BY VERIFIED MEANINGFUL DEVELOPMENT. There is no commit
 * count in this struct and none in its input, deliberately: a field that
 * existed would eventually be read, and commit volume is the exact signal the
 * direction forbids. The only input that moves `stage` is a mission that
 * reached `verified_complete` WITH an attestation, an approved independent
 * review and at least one evidence reference.
 */
export interface WonderlandProjectEntity {
  readonly projectId: string;
  readonly observed: boolean;
  readonly category: WonderlandProjectCategory | null;
  readonly form: WonderlandEntityForm;
  /**
   * Null when Relay has not observed the project at all. 0 is a real,
   * observed measurement: a project Relay watched that has verified nothing.
   */
  readonly stage: number | null;
  /** Verified missions that qualified. Never a commit or an event count. */
  readonly evolutionEvidenceCount: number;
  /**
   * Activity Relay saw but did NOT verify. Reported so a surface can say the
   * work exists, and structurally unable to move `stage`.
   */
  readonly unverifiedActivityCount: number;
  /** A sentence naming what the next stage requires. */
  readonly nextStageRequirement: string;
}

export const WONDERLAND_PROJECT_ENTITY_FIELDS = exactKeys<WonderlandProjectEntity>()([
  'projectId',
  'observed',
  'category',
  'form',
  'stage',
  'evolutionEvidenceCount',
  'unverifiedActivityCount',
  'nextStageRequirement',
] as const);

/* -------------------------------------------------------- brain weather */

/**
 * The Project Brain's operational signals, as the world's weather.
 *
 * Read from `RelayOperationsView` and never recomputed. A silent system is not
 * a healthy one, so `health` carries Relay's own `unknown` and the world fogs
 * rather than clearing.
 */
export interface WonderlandBrainWeather {
  readonly present: boolean;
  readonly projectId: string | null;
  readonly health: RelayHealthState;
  /** Always a sentence. Relay's own words, not the world's. */
  readonly healthReason: string;
  readonly errorRate: WonderlandFigure;
  readonly signalAgeMs: WonderlandFigure;
  readonly unrecoveredErrorCount: WonderlandFigure;
  readonly waitingOnUserOpen: boolean;
  readonly openRepairLoops: WonderlandFigure;
}

export const WONDERLAND_BRAIN_WEATHER_FIELDS = exactKeys<WonderlandBrainWeather>()([
  'present',
  'projectId',
  'health',
  'healthReason',
  'errorRate',
  'signalAgeMs',
  'unrecoveredErrorCount',
  'waitingOnUserOpen',
  'openRepairLoops',
] as const);

/* ------------------------------------------------------------------ GVE */

/**
 * The three GVE classes. A Guided Verified Experience improves something real:
 * the software, the Agent, or both. An experience that improves neither is a
 * minigame, and Wonderland does not ship one.
 */
export const WONDERLAND_GVE_CLASSES = ['project', 'agent', 'hybrid'] as const;
export type WonderlandGveClass = (typeof WONDERLAND_GVE_CLASSES)[number];

/** The GVE identifiers that exist. Exactly one, on purpose. */
export const WONDERLAND_GVE_IDS = ['runaway_dog_research_chase'] as const;
export type WonderlandGveId = (typeof WONDERLAND_GVE_IDS)[number];

/**
 * The GVE lifecycle. `unavailable` is first and is the default-free default:
 * with no backing Relay work there is no experience to offer.
 */
export const WONDERLAND_GVE_PHASES = [
  'unavailable',
  'offered',
  'chase_active',
  'backend_running',
  'capture_ready',
  'captured',
  'resolved',
  'abandoned',
] as const;
export type WonderlandGvePhase = (typeof WONDERLAND_GVE_PHASES)[number];

/**
 * A recommendation the chase revealed.
 *
 * A recommendation with no evidence is WITHHELD, not shown, and `headline` is
 * replaced by the withholding sentence rather than left readable. This is the
 * one place a game loop would be tempted to invent copy — the reward has to
 * land — and it is exactly where inventing it would be a product lie.
 */
export interface WonderlandRecommendation {
  readonly recommendationId: string;
  readonly headline: string;
  readonly evidenceIds: readonly string[];
  /** Relay's freshness verdict for the newest cited evidence. */
  readonly evidenceFreshness: string | null;
  readonly withheld: boolean;
  readonly withheldReason: string | null;
}

export const WONDERLAND_RECOMMENDATION_FIELDS = exactKeys<WonderlandRecommendation>()([
  'recommendationId',
  'headline',
  'evidenceIds',
  'evidenceFreshness',
  'withheld',
  'withheldReason',
] as const);

/**
 * A Mission the world OFFERS. Wonderland requests; Relay decides.
 *
 * `authority` is a constant string and not a boolean because a boolean invites
 * a false branch. There is no shape of this struct that expresses "Wonderland
 * approved this mission", and that absence is the authority boundary.
 */
export interface WonderlandMissionRequest {
  readonly requestId: string;
  readonly objective: string;
  readonly sourceGveId: WonderlandGveId;
  /** Always 'relay_decides'. */
  readonly authority: string;
  readonly evidenceIds: readonly string[];
}

export const WONDERLAND_MISSION_REQUEST_FIELDS = exactKeys<WonderlandMissionRequest>()([
  'requestId',
  'objective',
  'sourceGveId',
  'authority',
  'evidenceIds',
] as const);

/** The one real GVE, projected. */
export interface WonderlandGve {
  readonly gveId: WonderlandGveId;
  readonly gveClass: WonderlandGveClass;
  readonly phase: WonderlandGvePhase;
  /** The Relay Loop actually doing the research. Null when none observed. */
  readonly backingLoopId: string | null;
  readonly backingLoopState: RelayLoopRuntimeState | null;
  /** Capture opens only on real, finished, successful backing work. */
  readonly captureUnlocked: boolean;
  /** A sentence whenever capture is locked. */
  readonly captureBlockedReason: string | null;
  readonly recommendations: readonly WonderlandRecommendation[];
  readonly missionRequests: readonly WonderlandMissionRequest[];
}

export const WONDERLAND_GVE_FIELDS = exactKeys<WonderlandGve>()([
  'gveId',
  'gveClass',
  'phase',
  'backingLoopId',
  'backingLoopState',
  'captureUnlocked',
  'captureBlockedReason',
  'recommendations',
  'missionRequests',
] as const);

/* -------------------------------------------------------------- classes */

/**
 * The engineer classes. A user holds a standing in EVERY one of them — there
 * is no primary class field and no single-class shape, because the direction is
 * that users are multi-class and never locked to one archetype. Making that
 * structural is cheaper than policing it later.
 */
export const WONDERLAND_ENGINEER_CLASSES = [
  'agentic_engineer',
  'ai_engineer',
  'forward_deployed_engineer',
  'software_engineer',
  'game_developer',
  'research_engineer',
  'systems_infrastructure_engineer',
] as const;
export type WonderlandEngineerClass = (typeof WONDERLAND_ENGINEER_CLASSES)[number];

/**
 * A badge is VERIFIED mastery. Every badge names the mission that earned it,
 * and a badge without one cannot be constructed.
 */
export interface WonderlandBadge {
  readonly badgeId: string;
  readonly engineerClass: WonderlandEngineerClass;
  /** A real Relay skill id — Skill Plugins are Relay capabilities. */
  readonly skillId: string;
  /** The verified mission that earned it. Never optional. */
  readonly evidenceMissionId: string;
  readonly awardedAtIso: string;
}

export const WONDERLAND_BADGE_FIELDS = exactKeys<WonderlandBadge>()([
  'badgeId',
  'engineerClass',
  'skillId',
  'evidenceMissionId',
  'awardedAtIso',
] as const);

export interface WonderlandClassStanding {
  readonly engineerClass: WonderlandEngineerClass;
  readonly verifiedBadges: readonly WonderlandBadge[];
  /**
   * Claimed or observed-but-unverified work. Counted and shown, and it never
   * becomes a badge — the count and the badge list are separate fields so no
   * aggregation can merge them.
   */
  readonly unverifiedClaimCount: number;
  /** Skill ids from Relay's own skill catalogue. Never invented names. */
  readonly skillPluginIds: readonly string[];
}

export const WONDERLAND_CLASS_STANDING_FIELDS = exactKeys<WonderlandClassStanding>()([
  'engineerClass',
  'verifiedBadges',
  'unverifiedClaimCount',
  'skillPluginIds',
] as const);

/* ---------------------------------------------------------- replication */

/**
 * The multiplayer authority boundary, as data.
 *
 * FOUNDATION ONLY, and the document says so rather than implying more. What is
 * declared: who is authoritative, that the client is presentational, the
 * monotonic revision a client must not render backwards over, and which
 * document sections are owner-only versus world-visible. What is NOT built:
 * clans, a Battle Pass, a Coliseum, boss economies, a marketplace, or world
 * scale. Those are documented as planned in docs/relay/WONDERLAND.md and
 * appear nowhere in this type.
 */
export interface WonderlandReplication {
  /** Always 'relay'. */
  readonly authority: string;
  /** Always 'presentational'. */
  readonly clientRole: string;
  /** Monotonic. A client holding a higher revision must not be overwritten. */
  readonly revision: number;
  /** Document sections replicated only to the owning client. */
  readonly ownerOnlySections: readonly string[];
  /** Document sections every client in the world may see. */
  readonly worldVisibleSections: readonly string[];
}

export const WONDERLAND_REPLICATION_FIELDS = exactKeys<WonderlandReplication>()([
  'authority',
  'clientRole',
  'revision',
  'ownerOnlySections',
  'worldVisibleSections',
] as const);

export const WONDERLAND_AUTHORITY = 'relay' as const;
export const WONDERLAND_CLIENT_ROLE = 'presentational' as const;
export const WONDERLAND_REQUEST_AUTHORITY = 'relay_decides' as const;

/* ------------------------------------------------------- the document */

/** The whole world-state document. One observation, one revision. */
export interface WonderlandWorld {
  readonly schemaVersion: WonderlandWorldSchemaVersion;
  /** The instant this projection was computed FOR. Injected, never read. */
  readonly observedAtIso: string;
  readonly revision: number;
  readonly provenance: Provenance;
  /** True whenever provenance is not 'live'. The label travels with the data. */
  readonly simulated: boolean;
  /** Always a sentence naming what this world is. */
  readonly provenanceLabel: string;
  readonly agent: WonderlandAgent;
  readonly loops: readonly WonderlandLoopSignal[];
  readonly missions: readonly WonderlandMission[];
  readonly entities: readonly WonderlandProjectEntity[];
  readonly brain: WonderlandBrainWeather;
  readonly terminal: WonderlandTerminalPanel;
  readonly gve: WonderlandGve | null;
  readonly classes: readonly WonderlandClassStanding[];
  readonly replication: WonderlandReplication;
}

export const WONDERLAND_WORLD_FIELDS = exactKeys<WonderlandWorld>()([
  'schemaVersion',
  'observedAtIso',
  'revision',
  'provenance',
  'simulated',
  'provenanceLabel',
  'agent',
  'loops',
  'missions',
  'entities',
  'brain',
  'terminal',
  'gve',
  'classes',
  'replication',
] as const);

/**
 * Which document sections are owner-only and which the whole world sees.
 *
 * Owner-only because they are that player's operational truth: their terminal
 * lines, their GVE progress, their class standings, and their Agent's identity.
 * World-visible because they are the shared landscape: project entities, the
 * Brain's weather, and the header a client needs to order revisions.
 *
 * Kept beside the field manifest so `wonderland-projection.test.ts` can prove
 * both lists name real document sections, that they are disjoint, and that
 * together they account for every section — a section in neither list would be
 * replicated by accident, in whichever direction the engine happened to default.
 */
export const WONDERLAND_OWNER_ONLY_SECTIONS = [
  'agent',
  'loops',
  'missions',
  'terminal',
  'gve',
  'classes',
] as const;

export const WONDERLAND_WORLD_VISIBLE_SECTIONS = [
  'schemaVersion',
  'observedAtIso',
  'revision',
  'provenance',
  'simulated',
  'provenanceLabel',
  'entities',
  'brain',
  'replication',
] as const;

/* ------------------------------------------------- terminal vocabularies */

/**
 * `ConnectionState` and `TerminalProvenanceLabel` are type-only unions in
 * `../terminal`. A `Record<Union, true>` object literal is the cheapest way to
 * get an EXHAUSTIVE runtime list: tsc rejects the literal if a member is
 * missing and rejects an extra key, so `Object.keys` cannot under-report.
 */
const CONNECTION_STATE_MEMBERS: Readonly<Record<ConnectionState, true>> = Object.freeze({
  OFFLINE: true,
  RECONNECTING: true,
  LIVE: true,
});
export const WONDERLAND_CONNECTION_STATES = Object.keys(
  CONNECTION_STATE_MEMBERS,
) as readonly ConnectionState[];

const TERMINAL_PROVENANCE_MEMBERS: Readonly<Record<TerminalProvenanceLabel, true>> =
  Object.freeze({
    SIMULATED: true,
    'LIVE LOCAL': true,
    'LIVE PROVIDER': true,
  });
export const WONDERLAND_TERMINAL_PROVENANCES = Object.keys(
  TERMINAL_PROVENANCE_MEMBERS,
) as readonly TerminalProvenanceLabel[];

/* ------------------------------------------------- nullability manifests */

/**
 * Which fields of each struct admit absence, PROVEN against the interfaces.
 *
 * The C++ parity test requires every name here to be carried on the C++ side by
 * a type that can express "not observed" — `FWonderlandText`, `FWonderlandFigure`,
 * a nested struct, a container, or an enum whose zero value means unknown. An
 * `FString` or a bare `bool` in one of these positions is the bug this catches:
 * Unreal would hand the renderer an empty string or `false` and the world would
 * present it as a fact.
 */
export const WONDERLAND_NULLABLE_FIELDS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    FWonderlandFigure: nullableKeys<WonderlandFigure>()(['value', 'reason'] as const),
    FWonderlandAttestation: nullableKeys<WonderlandAttestation>()([
      'requestedModel',
      'servedModel',
      'unattestedReason',
    ] as const),
    FWonderlandMission: nullableKeys<WonderlandMission>()([
      'unobservedReason',
      'missionStatus',
      'verdict',
      'executionStatus',
      'outcomeStatus',
      'verificationStatus',
      'releaseStatus',
      'updatedAtIso',
    ] as const),
    FWonderlandLoopSignal: nullableKeys<WonderlandLoopSignal>()(['state'] as const),
    FWonderlandDogSkin: nullableKeys<WonderlandDogSkin>()(['chakraTier'] as const),
    FWonderlandAgent: nullableKeys<WonderlandAgent>()([
      'workspaceState',
      'activity',
      'pose',
      'motion',
      'travelling',
      'attentionRequired',
      'activityLabel',
    ] as const),
    FWonderlandTerminalLine: nullableKeys<WonderlandTerminalLine>()(['severity'] as const),
    FWonderlandTerminalPanel: nullableKeys<WonderlandTerminalPanel>()([
      'unavailableReason',
      'connectionState',
      'provenance',
      'runId',
      'missionId',
      'truncatedFrom',
      'lastSequence',
    ] as const),
    FWonderlandProjectEntity: nullableKeys<WonderlandProjectEntity>()([
      'category',
      'stage',
    ] as const),
    FWonderlandBrainWeather: nullableKeys<WonderlandBrainWeather>()(['projectId'] as const),
    FWonderlandRecommendation: nullableKeys<WonderlandRecommendation>()([
      'evidenceFreshness',
      'withheldReason',
    ] as const),
    FWonderlandMissionRequest: nullableKeys<WonderlandMissionRequest>()([] as const),
    FWonderlandGve: nullableKeys<WonderlandGve>()([
      'backingLoopId',
      'backingLoopState',
      'captureBlockedReason',
    ] as const),
    FWonderlandBadge: nullableKeys<WonderlandBadge>()([] as const),
    FWonderlandClassStanding: nullableKeys<WonderlandClassStanding>()([] as const),
    FWonderlandReplication: nullableKeys<WonderlandReplication>()([] as const),
    FWonderlandWorld: nullableKeys<WonderlandWorld>()(['gve'] as const),
  });

/* -------------------------------------------------- the C++ parity table */

/**
 * THE PARITY TABLE — the declared correspondence between this module and
 * `wonderland/Source/Wonderland/*.h`.
 *
 * Data, not assertions, so `wonderland-cpp-parity.test.ts` derives every check
 * from it instead of restating one. A struct or enum in the headers that is
 * absent from here fails that test; an entry here naming a struct the headers
 * do not declare fails it too. Both directions, because a parity record that
 * only checks one is a record of intentions.
 */
export const WONDERLAND_CPP_STRUCT_PARITY: readonly {
  readonly cppStruct: string;
  readonly tsInterface: string;
  readonly fields: readonly string[];
}[] = [
  { cppStruct: 'FWonderlandFigure', tsInterface: 'WonderlandFigure', fields: WONDERLAND_FIGURE_FIELDS },
  { cppStruct: 'FWonderlandBreath', tsInterface: 'WonderlandBreath', fields: WONDERLAND_BREATH_FIELDS },
  { cppStruct: 'FWonderlandAttestation', tsInterface: 'WonderlandAttestation', fields: WONDERLAND_ATTESTATION_FIELDS },
  { cppStruct: 'FWonderlandMission', tsInterface: 'WonderlandMission', fields: WONDERLAND_MISSION_FIELDS },
  { cppStruct: 'FWonderlandLoopSignal', tsInterface: 'WonderlandLoopSignal', fields: WONDERLAND_LOOP_SIGNAL_FIELDS },
  { cppStruct: 'FWonderlandDogSkin', tsInterface: 'WonderlandDogSkin', fields: WONDERLAND_DOG_SKIN_FIELDS },
  { cppStruct: 'FWonderlandAgent', tsInterface: 'WonderlandAgent', fields: WONDERLAND_AGENT_FIELDS },
  { cppStruct: 'FWonderlandTerminalLine', tsInterface: 'WonderlandTerminalLine', fields: WONDERLAND_TERMINAL_LINE_FIELDS },
  { cppStruct: 'FWonderlandTerminalPanel', tsInterface: 'WonderlandTerminalPanel', fields: WONDERLAND_TERMINAL_PANEL_FIELDS },
  { cppStruct: 'FWonderlandProjectEntity', tsInterface: 'WonderlandProjectEntity', fields: WONDERLAND_PROJECT_ENTITY_FIELDS },
  { cppStruct: 'FWonderlandBrainWeather', tsInterface: 'WonderlandBrainWeather', fields: WONDERLAND_BRAIN_WEATHER_FIELDS },
  { cppStruct: 'FWonderlandRecommendation', tsInterface: 'WonderlandRecommendation', fields: WONDERLAND_RECOMMENDATION_FIELDS },
  { cppStruct: 'FWonderlandMissionRequest', tsInterface: 'WonderlandMissionRequest', fields: WONDERLAND_MISSION_REQUEST_FIELDS },
  { cppStruct: 'FWonderlandGve', tsInterface: 'WonderlandGve', fields: WONDERLAND_GVE_FIELDS },
  { cppStruct: 'FWonderlandBadge', tsInterface: 'WonderlandBadge', fields: WONDERLAND_BADGE_FIELDS },
  { cppStruct: 'FWonderlandClassStanding', tsInterface: 'WonderlandClassStanding', fields: WONDERLAND_CLASS_STANDING_FIELDS },
  { cppStruct: 'FWonderlandReplication', tsInterface: 'WonderlandReplication', fields: WONDERLAND_REPLICATION_FIELDS },
  { cppStruct: 'FWonderlandWorld', tsInterface: 'WonderlandWorld', fields: WONDERLAND_WORLD_FIELDS },
];

/**
 * THE ENUM PARITY TABLE.
 *
 * `zeroMember` is the load-bearing column. Unreal cannot hold a null enum, and a
 * default-constructed USTRUCT zero-fills, so whatever sits at ordinal 0 is what
 * a renderer sees before anything is assigned. That value must therefore be the
 * one that means "Relay has not said" — otherwise rule 1 is defeated by C++
 * initialization semantics rather than by anybody's decision.
 *
 * `nullable: true` means the TS field is `Union | null`, and the C++ enum must
 * carry the extra sentinel `Unobserved` at ordinal 0. `nullable: false` means the
 * projection always writes the field, and `zeroMember` must still be the safest
 * member of the union itself:
 *
 *   provenance   → `simulated`. An unset provenance must never read as live.
 *   health       → `unknown`. A silent system is not a healthy one.
 *   animation    → `dormant`. Absence of an observation is not idle patrol.
 *   category     → `unknown`; form → `fogged_unknown`. Not a default building.
 *   gvePhase     → `unavailable`. No backing work, no experience.
 *   connection   → `OFFLINE`; terminalProvenance → `SIMULATED`.
 *
 * `gveClass`, `gveId` and `engineerClass` have no unknown member and none is
 * invented for them: every one of those fields is written for every record the
 * projection emits (a standing exists for all seven classes, always), so ordinal
 * 0 is never observed. That is stated here rather than assumed.
 */
export const WONDERLAND_CPP_ENUM_PARITY: readonly {
  readonly cppEnum: string;
  readonly source: string;
  readonly members: readonly string[];
  readonly nullable: boolean;
  readonly zeroMember: string;
}[] = [
  { cppEnum: 'EWonderlandProvenance', source: 'PROVENANCES', members: PROVENANCES, nullable: false, zeroMember: 'simulated' },
  { cppEnum: 'EWonderlandMissionStatus', source: 'MISSION_STATUSES', members: MISSION_STATUSES, nullable: true, zeroMember: 'Unobserved' },
  { cppEnum: 'EWonderlandMissionVerdict', source: 'MISSION_VERDICTS', members: MISSION_VERDICTS, nullable: true, zeroMember: 'Unobserved' },
  { cppEnum: 'EWonderlandExecutionStatus', source: 'AQUALA_STATUS_VALUES.execution', members: AQUALA_STATUS_VALUES.execution, nullable: true, zeroMember: 'Unobserved' },
  { cppEnum: 'EWonderlandOutcomeStatus', source: 'AQUALA_STATUS_VALUES.outcome', members: AQUALA_STATUS_VALUES.outcome, nullable: true, zeroMember: 'Unobserved' },
  { cppEnum: 'EWonderlandVerificationStatus', source: 'AQUALA_STATUS_VALUES.verification', members: AQUALA_STATUS_VALUES.verification, nullable: true, zeroMember: 'Unobserved' },
  { cppEnum: 'EWonderlandReleaseStatus', source: 'AQUALA_STATUS_VALUES.release', members: AQUALA_STATUS_VALUES.release, nullable: true, zeroMember: 'Unobserved' },
  { cppEnum: 'EWonderlandLoopState', source: 'RELAY_LOOP_RUNTIME_STATES', members: RELAY_LOOP_RUNTIME_STATES, nullable: true, zeroMember: 'Unobserved' },
  { cppEnum: 'EWonderlandDogActivity', source: 'OFFICIAL_RELAY_DOG_ACTIVITIES', members: OFFICIAL_RELAY_DOG_ACTIVITIES, nullable: true, zeroMember: 'Unobserved' },
  { cppEnum: 'EWonderlandDogPose', source: 'OFFICIAL_RELAY_DOG_POSE_NAMES', members: OFFICIAL_RELAY_DOG_POSE_NAMES, nullable: true, zeroMember: 'Unobserved' },
  { cppEnum: 'EWonderlandDogMotion', source: 'WONDERLAND_DOG_MOTIONS', members: WONDERLAND_DOG_MOTIONS, nullable: true, zeroMember: 'Unobserved' },
  { cppEnum: 'EWonderlandDogAnimation', source: 'WONDERLAND_DOG_ANIMATIONS', members: WONDERLAND_DOG_ANIMATIONS, nullable: false, zeroMember: 'dormant' },
  { cppEnum: 'EWonderlandDogOverlay', source: 'WONDERLAND_DOG_OVERLAYS', members: WONDERLAND_DOG_OVERLAYS, nullable: false, zeroMember: 'none' },
  { cppEnum: 'EWonderlandProjectCategory', source: 'WONDERLAND_PROJECT_CATEGORIES', members: WONDERLAND_PROJECT_CATEGORIES, nullable: true, zeroMember: 'Unobserved' },
  { cppEnum: 'EWonderlandEntityForm', source: 'WONDERLAND_ENTITY_FORMS', members: WONDERLAND_ENTITY_FORMS, nullable: false, zeroMember: 'fogged_unknown' },
  { cppEnum: 'EWonderlandHealth', source: 'RELAY_HEALTH_STATES', members: RELAY_HEALTH_STATES, nullable: false, zeroMember: 'unknown' },
  { cppEnum: 'EWonderlandUnknownReason', source: 'RELAY_UNKNOWN_REASONS', members: RELAY_UNKNOWN_REASONS, nullable: true, zeroMember: 'Unobserved' },
  { cppEnum: 'EWonderlandGveClass', source: 'WONDERLAND_GVE_CLASSES', members: WONDERLAND_GVE_CLASSES, nullable: false, zeroMember: 'project' },
  { cppEnum: 'EWonderlandGveId', source: 'WONDERLAND_GVE_IDS', members: WONDERLAND_GVE_IDS, nullable: false, zeroMember: 'runaway_dog_research_chase' },
  { cppEnum: 'EWonderlandGvePhase', source: 'WONDERLAND_GVE_PHASES', members: WONDERLAND_GVE_PHASES, nullable: false, zeroMember: 'unavailable' },
  { cppEnum: 'EWonderlandEngineerClass', source: 'WONDERLAND_ENGINEER_CLASSES', members: WONDERLAND_ENGINEER_CLASSES, nullable: false, zeroMember: 'agentic_engineer' },
  { cppEnum: 'EWonderlandConnectionState', source: 'WONDERLAND_CONNECTION_STATES', members: WONDERLAND_CONNECTION_STATES, nullable: true, zeroMember: 'Unobserved' },
  { cppEnum: 'EWonderlandTerminalProvenance', source: 'WONDERLAND_TERMINAL_PROVENANCES', members: WONDERLAND_TERMINAL_PROVENANCES, nullable: true, zeroMember: 'Unobserved' },
];

/** The sentinel a nullable enum carries at ordinal 0. */
export const WONDERLAND_CPP_UNOBSERVED_MEMBER = 'Unobserved' as const;

/**
 * THE COMPLETE set of C++ types permitted to carry a nullable field, besides an
 * enum whose ordinal 0 is `Unobserved`.
 *
 * Each is a `bKnown` flag beside a value, because an empty `FString` is a string,
 * `0` is a measurement and `false` is an answer. This array is the parity test's
 * only source for the allowed set — an earlier draft listed two names here and
 * accepted four in the test, which is exactly the kind of disagreement between a
 * stated rule and an enforced one that this repository keeps being bitten by.
 *
 * `FWonderlandFigure` is deliberately absent: it mirrors a TypeScript struct that
 * is never itself null, so it is not a carrier. Its own `value` field's absence is
 * covered by a recorded exemption in the parity test.
 */
export const WONDERLAND_CPP_NULLABLE_CARRIERS = [
  'FWonderlandText',
  'FWonderlandNumber',
  'FWonderlandFlag',
] as const;
