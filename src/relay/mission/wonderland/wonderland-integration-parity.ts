/**
 * THE INTEGRATION LAYER'S HALF OF THE C++ PARITY TABLE.
 *
 * `wonderland-contracts.ts` owns the world DOCUMENT's parity records. This file
 * owns the records for the two things the integration layer added — Julius's
 * embodied state and the usage meter — and it exists as a separate module for
 * one structural reason: the contracts module supplies `exactKeys` to both new
 * modules, so a parity table living there would have to import back from them
 * and the cycle would decide, at load time, which frozen constant was already
 * initialized. A separate leaf module imports from all three and is imported by
 * the test alone.
 *
 * The test merges these arrays with the core ones and applies EVERY check to
 * the union, in both directions: a struct or enum in the headers absent from
 * here fails, and an entry here naming something the headers do not declare
 * fails too. Nothing about the guarantee is weaker for the split.
 */

import {
  WONDERLAND_ACTIVITY_ACCENTS,
  WONDERLAND_ACTIVITY_INTENT_FIELDS,
} from './wonderland-activity-animation';
import type { WonderlandActivityIntent } from './wonderland-activity-animation';
import {
  WONDERLAND_AUTONOMY_LEVELS,
  WONDERLAND_CARD_SCOPE_FIELDS,
  WONDERLAND_HYDRATION_FIELDS,
} from './wonderland-hydration';
import {
  WONDERLAND_GATED_OPERATIONS,
  WONDERLAND_HUMAN_GATE_FIELDS,
} from './wonderland-human-gate';
import type { WonderlandHumanGate } from './wonderland-human-gate';
import type {
  WonderlandCardScope,
  WonderlandHydration,
} from './wonderland-hydration';
import {
  WONDERLAND_BRAIN_CITATION_FIELDS,
  WONDERLAND_BRAIN_KINDS,
} from './wonderland-brain-scope';
import type { WonderlandBrainCitation } from './wonderland-brain-scope';
import {
  JULIUS_ACTIVITY_READING_FIELDS,
  JULIUS_ACTIVITY_SIGNALS,
  JULIUS_WORKER_ACTIVITY_FIELDS,
} from './wonderland-julius-activity';
import type {
  JuliusActivityReading,
  JuliusWorkerActivity,
} from './wonderland-julius-activity';
import {
  JULIUS_EMBODIMENT_FIELDS,
  JULIUS_STATE_SOURCES,
  JULIUS_VISUAL_STATES,
} from './wonderland-julius-state';
import type { JuliusEmbodiment } from './wonderland-julius-state';
import { WONDERLAND_TASK_SOURCES, WONDERLAND_TASK_STATES } from './wonderland-julius-task-state';
import {
  WONDERLAND_ANIMATION_PLAN_FIELDS,
  WONDERLAND_ANIMATION_TRANSITIONS,
} from './wonderland-julius-animation';
import type { WonderlandAnimationPlan } from './wonderland-julius-animation';
import {
  WONDERLAND_ADMISSIONS,
  WONDERLAND_ENTRY_FIELDS,
  WONDERLAND_PRESENTATIONS,
  WONDERLAND_RENDERER_KINDS,
  WONDERLAND_RENDERER_OFFER_FIELDS,
} from './wonderland-entry';
import type { WonderlandEntry, WonderlandRendererOffer } from './wonderland-entry';
import {
  WONDERLAND_ENVELOPE_FIELDS,
  WONDERLAND_WORKER_ROLES,
} from './wonderland-envelope';
import type { WonderlandEnvelope } from './wonderland-envelope';
import {
  WONDERLAND_CURSOR_FIELDS,
  WONDERLAND_ORDERING_VERDICTS,
} from './wonderland-ordering';
import type { WonderlandCursor } from './wonderland-ordering';
import { WONDERLAND_RUN_SNAPSHOT_FIELDS } from './wonderland-rehydration';
import type { WonderlandRunSnapshot } from './wonderland-rehydration';
import { WONDERLAND_USAGE_ATTRIBUTIONS } from './wonderland-usage-accounting';
import {
  WONDERLAND_HUD_ANCHORS,
  WONDERLAND_METER_DRAW_PLAN_FIELDS,
  WONDERLAND_SWOOSH_SAMPLE_FIELDS,
  WONDERLAND_SWOOSH_SEGMENT_FIELDS,
  WONDERLAND_USAGE_CHANNELS,
  WONDERLAND_USAGE_CHANNEL_STYLE_FIELDS,
  WONDERLAND_USAGE_HUD_FIELDS,
  WONDERLAND_USAGE_METER_FIELDS,
  WONDERLAND_USAGE_STATUSES,
  WONDERLAND_USAGE_SWOOSH_FIELDS,
  WONDERLAND_USAGE_VIEWPORT_FIELDS,
} from './wonderland-usage-meter';
import {
  WONDERLAND_LINK_STATES,
  WONDERLAND_LINK_STATUS_FIELDS,
} from './wonderland-bridge';
import type { WonderlandLinkStatus } from './wonderland-bridge';
import {
  WONDERLAND_USAGE_AUTHORITY_STATUS_FIELDS,
  WONDERLAND_USAGE_READINGS,
} from './wonderland-usage-authority';
import type { WonderlandUsageAuthorityStatus } from './wonderland-usage-authority';
import type {
  WonderlandMeterDrawPlan,
  WonderlandSwooshSample,
  WonderlandSwooshSegment,
  WonderlandUsageChannelStyle,
  WonderlandUsageHud,
  WonderlandUsageMeter,
  WonderlandUsageSwoosh,
  WonderlandUsageViewport,
} from './wonderland-usage-meter';

/**
 * NULLABILITY, PROVEN BY MUTUAL ASSIGNABILITY RATHER THAN BY A HELPER.
 *
 * `wonderland-contracts.ts` proves its manifests with `nullableKeys`, which is
 * `exactKeys<Record<NullableNames<T>, unknown>>()`. That helper does NOT
 * survive being called from another module: `keyof` on the constructed record
 * resolves to `never` once it is instantiated across a file boundary, and the
 * failure is silent in the worst possible way — the expected element type
 * becomes `never`, every name in the list is an error, and the obvious fix is
 * to empty the list. A manifest that proves nothing then looks exactly like one
 * that does, which is the class of defect this whole parity apparatus exists to
 * catch, so it must not be reintroduced by the apparatus itself.
 *
 * `AssertExactKeys` states the requirement directly instead: the list's members
 * and the interface's nullable field names must each be assignable to the
 * other. Both directions, as one type. A field that becomes nullable fails the
 * second direction; a name that is no longer nullable fails the first.
 */
type NullableKeysOf<T> = {
  [K in keyof T]-?: null extends T[K] ? K : never;
}[keyof T] &
  string;

/**
 * `true` only when the two unions are the same set; `never` otherwise, so the
 * assignment below is the error. Wrapped in tuples so a union does not
 * distribute and report a partial overlap as agreement.
 */
type SameKeys<Listed, Expected> = [Listed] extends [Expected]
  ? [Expected] extends [Listed]
    ? true
    : never
  : never;

const JULIUS_EMBODIMENT_NULLABLE = [
  'missionId',
  'agentId',
  'visualState',
  'stateSource',
  'relayPhase',
  'sourceState',
  'activity',
  'motion',
  'attentionRequired',
  'unobservedReason',
  'observedAtIso',
] as const;
const _JuliusEmbodimentNullableIsExact: SameKeys<
  (typeof JULIUS_EMBODIMENT_NULLABLE)[number],
  NullableKeysOf<JuliusEmbodiment>
> = true;
void _JuliusEmbodimentNullableIsExact;

const ENVELOPE_NULLABLE = [
  'worldSessionId',
  'juliusInstanceId',
  'missionId',
  'runId',
  'taskId',
  'workerRole',
  'sourceState',
] as const;
const _EnvelopeNullableIsExact: SameKeys<
  (typeof ENVELOPE_NULLABLE)[number],
  NullableKeysOf<WonderlandEnvelope>
> = true;
void _EnvelopeNullableIsExact;

const CURSOR_NULLABLE = ['juliusInstanceId', 'runId', 'lastEventId', 'lastAppliedAtIso'] as const;
const _CursorNullableIsExact: SameKeys<
  (typeof CURSOR_NULLABLE)[number],
  NullableKeysOf<WonderlandCursor>
> = true;
void _CursorNullableIsExact;

const RUN_SNAPSHOT_NULLABLE = [
  'juliusInstanceId',
  'missionId',
  'activeTasks',
  'pendingApprovals',
  'atSequence',
] as const;
const _RunSnapshotNullableIsExact: SameKeys<
  (typeof RUN_SNAPSHOT_NULLABLE)[number],
  NullableKeysOf<WonderlandRunSnapshot>
> = true;
void _RunSnapshotNullableIsExact;

const ENTRY_NULLABLE = [
  'admissionReason',
  'sessionId',
  'admittedAtIso',
  'presentationReason',
  'rendererId',
  'rendererKind',
  'presentingSinceIso',
] as const;
const _EntryNullableIsExact: SameKeys<
  (typeof ENTRY_NULLABLE)[number],
  NullableKeysOf<WonderlandEntry>
> = true;
void _EntryNullableIsExact;

const RENDERER_OFFER_NULLABLE = [] as const;
const _RendererOfferNullableIsExact: SameKeys<
  (typeof RENDERER_OFFER_NULLABLE)[number],
  NullableKeysOf<WonderlandRendererOffer>
> = true;
void _RendererOfferNullableIsExact;

const ANIMATION_PLAN_NULLABLE = ['attentionRequired'] as const;
const _AnimationPlanNullableIsExact: SameKeys<
  (typeof ANIMATION_PLAN_NULLABLE)[number],
  NullableKeysOf<WonderlandAnimationPlan>
> = true;
void _AnimationPlanNullableIsExact;

const LINK_STATUS_NULLABLE = ['lastSnapshotAtIso'] as const;
const _LinkStatusNullableIsExact: SameKeys<
  (typeof LINK_STATUS_NULLABLE)[number],
  NullableKeysOf<WonderlandLinkStatus>
> = true;
void _LinkStatusNullableIsExact;

const AUTHORITY_STATUS_NULLABLE = ['reason', 'ageSeconds', 'authorityId'] as const;
const _AuthorityStatusNullableIsExact: SameKeys<
  (typeof AUTHORITY_STATUS_NULLABLE)[number],
  NullableKeysOf<WonderlandUsageAuthorityStatus>
> = true;
void _AuthorityStatusNullableIsExact;

const USAGE_VIEWPORT_NULLABLE = [] as const;
const _UsageViewportNullableIsExact: SameKeys<
  (typeof USAGE_VIEWPORT_NULLABLE)[number],
  NullableKeysOf<WonderlandUsageViewport>
> = true;
void _UsageViewportNullableIsExact;

const ACTIVITY_INTENT_NULLABLE = ['dominant', 'dominantSignal'] as const;
const _ActivityIntentNullableIsExact: SameKeys<
  (typeof ACTIVITY_INTENT_NULLABLE)[number],
  NullableKeysOf<WonderlandActivityIntent>
> = true;
void _ActivityIntentNullableIsExact;

const CARD_SCOPE_NULLABLE = [
  'autonomy',
  'hasPromptArchitect',
  'hasCodingAgent',
  'hasIndependentReviewer',
  // Nullable since the reader that cannot resolve a C.A.R.D. stopped reporting
  // `false` — "this run may not spawn a swarm" — for a record nobody read.
  'swarmEligible',
] as const;
const _CardScopeNullableIsExact: SameKeys<
  (typeof CARD_SCOPE_NULLABLE)[number],
  NullableKeysOf<WonderlandCardScope>
> = true;
void _CardScopeNullableIsExact;

const HUMAN_GATE_NULLABLE = ['taskId'] as const;
const _HumanGateNullableIsExact: SameKeys<
  (typeof HUMAN_GATE_NULLABLE)[number],
  NullableKeysOf<WonderlandHumanGate>
> = true;
void _HumanGateNullableIsExact;

const HYDRATION_NULLABLE = ['worldSessionId'] as const;
const _HydrationNullableIsExact: SameKeys<
  (typeof HYDRATION_NULLABLE)[number],
  NullableKeysOf<WonderlandHydration>
> = true;
void _HydrationNullableIsExact;

const BRAIN_CITATION_NULLABLE = [] as const;
const _BrainCitationNullableIsExact: SameKeys<
  (typeof BRAIN_CITATION_NULLABLE)[number],
  NullableKeysOf<WonderlandBrainCitation>
> = true;
void _BrainCitationNullableIsExact;

const ACTIVITY_READING_NULLABLE = ['observedAtIso'] as const;
const _ActivityReadingNullableIsExact: SameKeys<
  (typeof ACTIVITY_READING_NULLABLE)[number],
  NullableKeysOf<JuliusActivityReading>
> = true;
void _ActivityReadingNullableIsExact;

const WORKER_ACTIVITY_NULLABLE = [] as const;
const _WorkerActivityNullableIsExact: SameKeys<
  (typeof WORKER_ACTIVITY_NULLABLE)[number],
  NullableKeysOf<JuliusWorkerActivity>
> = true;
void _WorkerActivityNullableIsExact;

const METER_DRAW_PLAN_NULLABLE = [] as const;
const _MeterDrawPlanNullableIsExact: SameKeys<
  (typeof METER_DRAW_PLAN_NULLABLE)[number],
  NullableKeysOf<WonderlandMeterDrawPlan>
> = true;
void _MeterDrawPlanNullableIsExact;

const SWOOSH_SAMPLE_NULLABLE = [] as const;
const _SwooshSampleNullableIsExact: SameKeys<
  (typeof SWOOSH_SAMPLE_NULLABLE)[number],
  NullableKeysOf<WonderlandSwooshSample>
> = true;
void _SwooshSampleNullableIsExact;

const SWOOSH_SEGMENT_NULLABLE = [] as const;
const _SwooshSegmentNullableIsExact: SameKeys<
  (typeof SWOOSH_SEGMENT_NULLABLE)[number],
  NullableKeysOf<WonderlandSwooshSegment>
> = true;
void _SwooshSegmentNullableIsExact;

const CHANNEL_STYLE_NULLABLE = [] as const;
const _ChannelStyleNullableIsExact: SameKeys<
  (typeof CHANNEL_STYLE_NULLABLE)[number],
  NullableKeysOf<WonderlandUsageChannelStyle>
> = true;
void _ChannelStyleNullableIsExact;

const USAGE_SWOOSH_NULLABLE = [] as const;
const _UsageSwooshNullableIsExact: SameKeys<
  (typeof USAGE_SWOOSH_NULLABLE)[number],
  NullableKeysOf<WonderlandUsageSwoosh>
> = true;
void _UsageSwooshNullableIsExact;

const USAGE_METER_NULLABLE = ['tierId', 'tierLabel', 'unitLabel', 'unavailableReason'] as const;
const _UsageMeterNullableIsExact: SameKeys<
  (typeof USAGE_METER_NULLABLE)[number],
  NullableKeysOf<WonderlandUsageMeter>
> = true;
void _UsageMeterNullableIsExact;

const USAGE_HUD_NULLABLE = [] as const;
const _UsageHudNullableIsExact: SameKeys<
  (typeof USAGE_HUD_NULLABLE)[number],
  NullableKeysOf<WonderlandUsageHud>
> = true;
void _UsageHudNullableIsExact;

/** Structs the integration layer added, and their TypeScript mirrors. */
export const WONDERLAND_INTEGRATION_CPP_STRUCT_PARITY: readonly {
  readonly cppStruct: string;
  readonly tsInterface: string;
  readonly fields: readonly string[];
}[] = [
  {
    cppStruct: 'FWonderlandJuliusEmbodiment',
    tsInterface: 'JuliusEmbodiment',
    fields: JULIUS_EMBODIMENT_FIELDS,
  },
  {
    cppStruct: 'FWonderlandEnvelope',
    tsInterface: 'WonderlandEnvelope',
    fields: WONDERLAND_ENVELOPE_FIELDS,
  },
  {
    /**
     * THE SECOND AXIS. `FWonderlandJuliusEmbodiment` says which phase a run is
     * in, and there is one answer; this says what else is true, and there can
     * be several. Mirrored rather than left to the client because the whole
     * value of the vocabulary is that a world cannot add to it: every signal is
     * raised by an event Julius really emits, and a client free to invent one
     * would be free to render a tool call nobody reported.
     */
    cppStruct: 'FWonderlandActivityReading',
    tsInterface: 'JuliusActivityReading',
    fields: JULIUS_ACTIVITY_READING_FIELDS,
  },
  {
    cppStruct: 'FWonderlandWorkerActivity',
    tsInterface: 'JuliusWorkerActivity',
    fields: JULIUS_WORKER_ACTIVITY_FIELDS,
  },
  {
    /**
     * THE STRUCT THAT EXISTS TO BE NARROW.
     *
     * Mirrored so the narrowness is checkable: the field list IS the guarantee
     * that no project text crosses, and a C++ side that had quietly grown a
     * `Summary` for the best of reasons would be carrying the substance of
     * somebody's work into the least trusted process in the system. The
     * TypeScript proves the same thing from the other end, by compiling a real
     * packet from canary text and searching the citation for it.
     */
    cppStruct: 'FWonderlandBrainCitation',
    tsInterface: 'WonderlandBrainCitation',
    fields: WONDERLAND_BRAIN_CITATION_FIELDS,
  },
  {
    cppStruct: 'FWonderlandCursor',
    tsInterface: 'WonderlandCursor',
    fields: WONDERLAND_CURSOR_FIELDS,
  },
  {
    cppStruct: 'FWonderlandRunSnapshot',
    tsInterface: 'WonderlandRunSnapshot',
    fields: WONDERLAND_RUN_SNAPSHOT_FIELDS,
  },
  {
    /**
     * THE SNAPSHOT HALF OF THE SEAM, mirrored because a world adopts it
     * WHOLESALE. The envelope is incremental and lean; this carries usage,
     * Project Brain, C.A.R.D. and activity, which change on their own
     * schedules and would be paid for on every event if they rode along.
     */
    cppStruct: 'FWonderlandHydration',
    tsInterface: 'WonderlandHydration',
    fields: WONDERLAND_HYDRATION_FIELDS,
  },
  {
    /**
     * The activity axis's presentation half. Mirrored so a client cannot
     * re-rank urgency: the order is Relay's, derived from the signal
     * vocabulary, and a second opinion about which signal matters most would
     * be free to disagree with the one the product states.
     */
    cppStruct: 'FWonderlandActivityIntent',
    tsInterface: 'WonderlandActivityIntent',
    fields: WONDERLAND_ACTIVITY_INTENT_FIELDS,
  },
  {
    /**
     * Mirrored so the NARROWNESS is checkable. `CardVersion` carries provider
     * and model names; the field list here is the guarantee that none of them
     * crosses, and a C++ side that had grown a `Models` array would be leaking
     * them onto the surface a player can inspect.
     */
    cppStruct: 'FWonderlandCardScope',
    tsInterface: 'WonderlandCardScope',
    fields: WONDERLAND_CARD_SCOPE_FIELDS,
  },
  {
    /**
     * THE ONE MOMENT IN A RUN WHERE A PERSON IS REQUIRED, mirrored so the
     * narrowness is checkable. `JuliusApprovalRecord` carries `safeRationale`,
     * `decisionReason` and `decidedBy` — a sentence and a person's name — and
     * the field list here is the guarantee that none of them crosses onto the
     * surface a player can attach a debugger to.
     */
    cppStruct: 'FWonderlandHumanGate',
    tsInterface: 'WonderlandHumanGate',
    fields: WONDERLAND_HUMAN_GATE_FIELDS,
  },
  {
    cppStruct: 'FWonderlandEntry',
    tsInterface: 'WonderlandEntry',
    fields: WONDERLAND_ENTRY_FIELDS,
  },
  {
    cppStruct: 'FWonderlandRendererOffer',
    tsInterface: 'WonderlandRendererOffer',
    fields: WONDERLAND_RENDERER_OFFER_FIELDS,
  },
  {
    cppStruct: 'FWonderlandAnimationPlan',
    tsInterface: 'WonderlandAnimationPlan',
    fields: WONDERLAND_ANIMATION_PLAN_FIELDS,
  },
  {
    cppStruct: 'FWonderlandUsageChannelStyle',
    tsInterface: 'WonderlandUsageChannelStyle',
    fields: WONDERLAND_USAGE_CHANNEL_STYLE_FIELDS,
  },
  {
    cppStruct: 'FWonderlandUsageViewport',
    tsInterface: 'WonderlandUsageViewport',
    fields: WONDERLAND_USAGE_VIEWPORT_FIELDS,
  },
  {
    cppStruct: 'FWonderlandSwooshSegment',
    tsInterface: 'WonderlandSwooshSegment',
    fields: WONDERLAND_SWOOSH_SEGMENT_FIELDS,
  },
  {
    /**
     * A SAMPLE IS NOT A CONTRACT THE WORLD RECEIVES — IT IS ONE IT RECOMPUTES.
     *
     * Every other struct here crosses the wire. This one never does: the world
     * is told the swoosh SHAPE and derives samples from it locally, because a
     * renderer that asked Relay for 64 points per meter per frame would be the
     * per-frame backend call the directive forbids. The parity entry exists
     * anyway, because the two samplers must agree about what a sample IS for
     * `WonderlandUsageGeometry.golden.tsv` to mean anything: the fixture is
     * generated from the TypeScript field-by-field, and a C++ struct that had
     * drifted would still diff clean against a fixture written in its own
     * shape. Mirroring the type is what keeps the numeric check honest.
     */
    cppStruct: 'FWonderlandSwooshSample',
    tsInterface: 'WonderlandSwooshSample',
    fields: WONDERLAND_SWOOSH_SAMPLE_FIELDS,
  },
  {
    cppStruct: 'FWonderlandUsageSwoosh',
    tsInterface: 'WonderlandUsageSwoosh',
    fields: WONDERLAND_USAGE_SWOOSH_FIELDS,
  },
  {
    cppStruct: 'FWonderlandUsageMeter',
    tsInterface: 'WonderlandUsageMeter',
    fields: WONDERLAND_USAGE_METER_FIELDS,
  },
  {
    /**
     * THE ARITHMETIC BETWEEN A READING AND A DRAWING, MIRRORED SO IT CANNOT FORK.
     *
     * Unlike the meter, this never travels: each surface computes it locally
     * from the meter it was given. It is mirrored because the two surfaces must
     * compute the SAME plan, and the fields are what makes that checkable —
     * a C++ port that had quietly dropped `bRemainderKnown` and inferred it
     * from a zero would draw a reported empty meter and an unreported one
     * identically, and no test written in its own terms would notice.
     */
    cppStruct: 'FWonderlandMeterDrawPlan',
    tsInterface: 'WonderlandMeterDrawPlan',
    fields: WONDERLAND_METER_DRAW_PLAN_FIELDS,
  },
  {
    /**
     * THE LINK MOVES OUT OF THE C++-ONLY ALLOWLIST HERE.
     *
     * `WonderlandTypes.h` has carried this struct since the world module was
     * written, under a comment saying "Relay does not model the client's socket,
     * so there is nothing here to mirror". `wonderland-bridge.ts` is that model,
     * so the record is no longer true and the allowlist entry is gone — which
     * the parity test enforces from the other side too: an allowlist naming
     * something now mirrored fails just as loudly as a missing mirror.
     */
    cppStruct: 'FWonderlandLinkStatus',
    tsInterface: 'WonderlandLinkStatus',
    fields: WONDERLAND_LINK_STATUS_FIELDS,
  },
  {
    cppStruct: 'FWonderlandUsageAuthorityStatus',
    tsInterface: 'WonderlandUsageAuthorityStatus',
    fields: WONDERLAND_USAGE_AUTHORITY_STATUS_FIELDS,
  },
  {
    cppStruct: 'FWonderlandUsageHud',
    tsInterface: 'WonderlandUsageHud',
    fields: WONDERLAND_USAGE_HUD_FIELDS,
  },
];

/**
 * Enums the integration layer added.
 *
 * `zeroMember` is load-bearing here for the same reason it is in the core
 * table: a default-constructed USTRUCT zero-fills, so whatever sits at ordinal
 * 0 is what a renderer sees before Relay has said anything.
 *
 *   juliusState  -> `Unobserved`. Idle is an observed state; absence is not it.
 *   stateSource  -> `Unobserved`. A reading with no source was not read.
 *   usageStatus  -> `unavailable`. "Available" is the one default that would
 *                   invite a player to spend capacity nobody confirmed.
 *   hudAnchor    -> `top_left`. Not nullable — every HUD element has a corner,
 *                   and this is the corner the usage meter uses.
 */
export const WONDERLAND_INTEGRATION_CPP_ENUM_PARITY: readonly {
  readonly cppEnum: string;
  readonly source: string;
  readonly members: readonly string[];
  readonly nullable: boolean;
  readonly zeroMember: string;
}[] = [
  {
    cppEnum: 'EWonderlandJuliusState',
    source: 'JULIUS_VISUAL_STATES',
    members: JULIUS_VISUAL_STATES,
    nullable: true,
    zeroMember: 'Unobserved',
  },
  // The Mission Contract's task lifecycle. NOT nullable, and its ordinal 0 is a
  // real state on purpose: a default-constructed task genuinely IS a local Draft
  // that no backend knows about, so Draft at 0 tells the truth. It stays true
  // because a Julius-sourced task can never land there -- see
  // `JULIUS_REACHABLE_TASK_STATES` in wonderland-julius-task-state.ts, which
  // proves Julius produces neither Draft nor Research.
  {
    cppEnum: 'EWonderlandTaskState',
    source: 'WONDERLAND_TASK_STATES',
    members: WONDERLAND_TASK_STATES,
    nullable: false,
    zeroMember: 'Draft',
  },
  // Who said so. Local at ordinal 0, so a default never claims Julius reported it.
  {
    cppEnum: 'EWonderlandTaskSource',
    source: 'WONDERLAND_TASK_SOURCES',
    members: WONDERLAND_TASK_SOURCES,
    nullable: false,
    zeroMember: 'Local',
  },
  {
    cppEnum: 'EWonderlandJuliusStateSource',
    source: 'JULIUS_STATE_SOURCES',
    members: JULIUS_STATE_SOURCES,
    nullable: true,
    zeroMember: 'Unobserved',
  },
  {
    /**
     * Ordinal 0 is `None` — nothing to show, which is not the same as nothing
     * happening. No accent occupies it.
     */
    cppEnum: 'EWonderlandActivityAccent',
    source: 'WONDERLAND_ACTIVITY_ACCENTS',
    members: WONDERLAND_ACTIVITY_ACCENTS,
    nullable: true,
    zeroMember: 'Unobserved',
  },
  {
    /**
     * Ordinal 0 is `Unobserved` and no level occupies it. Guessing the
     * cautious level would still claim a fact nobody stated.
     */
    cppEnum: 'EWonderlandAutonomy',
    source: 'WONDERLAND_AUTONOMY_LEVELS',
    members: WONDERLAND_AUTONOMY_LEVELS,
    nullable: true,
    zeroMember: 'Unobserved',
  },
  {
    /**
     * What C.A.R.D. can gate, which is the kernel's `JuliusPolicyOperation`.
     * SCREAMING_SNAKE there and PascalCase here. Ordinal 0 is `Unobserved` so
     * an unset array member — or a token this build cannot name — never reads
     * as a real gate, which would draw a boundary that does not exist.
     */
    cppEnum: 'EWonderlandGatedOperation',
    source: 'WONDERLAND_GATED_OPERATIONS',
    members: WONDERLAND_GATED_OPERATIONS,
    nullable: true,
    zeroMember: 'Unobserved',
  },
  {
    /**
     * The kernel's own kind vocabulary, uppercase there and PascalCase here.
     * Ordinal 0 is `Unobserved` for the array-member reason: an element nobody
     * wrote must not read as a real kind.
     */
    cppEnum: 'EWonderlandBrainKind',
    source: 'WONDERLAND_BRAIN_KINDS',
    members: WONDERLAND_BRAIN_KINDS,
    nullable: true,
    zeroMember: 'Unobserved',
  },
  {
    /**
     * `nullable` HERE MEANS SOMETHING SLIGHTLY DIFFERENT, AND IT MATTERS.
     *
     * The other nullable enums carry an absent VALUE. This one is an array
     * member, and an array of these is routinely EMPTY — which is not absence
     * of a value but the report "nothing was signalled". The zero member exists
     * for the same structural reason regardless: a TArray element that nobody
     * wrote must not read as a real activity, so ordinal 0 is `Unobserved` and
     * no signal occupies it.
     */
    cppEnum: 'EWonderlandActivitySignal',
    source: 'JULIUS_ACTIVITY_SIGNALS',
    members: JULIUS_ACTIVITY_SIGNALS,
    nullable: true,
    zeroMember: 'Unobserved',
  },
  {
    /**
     * ORDINAL 0 IS `Hold`, AND THAT IS THE SAFE DEFAULT ON PURPOSE.
     *
     * A USTRUCT arrives zero-filled, so a plan nothing filled in says "keep
     * playing what you are playing". The alternative orderings are all worse:
     * a default of `Interrupt` would cut on a struct nobody wrote, and a
     * default of `Dormant` would fade the dog out whenever a message was
     * dropped — a transport fault rendered as a fact about the mission.
     */
    cppEnum: 'EWonderlandAnimationTransition',
    source: 'WONDERLAND_ANIMATION_TRANSITIONS',
    members: WONDERLAND_ANIMATION_TRANSITIONS,
    nullable: false,
    zeroMember: 'hold',
  },
  {
    /**
     * NULLABLE, and the absence is not a slot. Attributing unlabelled work to
     * the Coding Agent would put it on the wrong instrument, so a role that did
     * not travel is `Unobserved` rather than a guess.
     */
    cppEnum: 'EWonderlandWorkerRole',
    source: 'WONDERLAND_WORKER_ROLES',
    members: WONDERLAND_WORKER_ROLES,
    nullable: true,
    zeroMember: 'Unobserved',
  },
  {
    cppEnum: 'EWonderlandOrderingVerdict',
    source: 'WONDERLAND_ORDERING_VERDICTS',
    members: WONDERLAND_ORDERING_VERDICTS,
    nullable: false,
    zeroMember: 'applied',
  },
  {
    cppEnum: 'EWonderlandUsageAttribution',
    source: 'WONDERLAND_USAGE_ATTRIBUTIONS',
    members: WONDERLAND_USAGE_ATTRIBUTIONS,
    nullable: false,
    zeroMember: 'unattributed',
  },
  {
    cppEnum: 'EWonderlandAdmission',
    source: 'WONDERLAND_ADMISSIONS',
    members: WONDERLAND_ADMISSIONS,
    nullable: false,
    zeroMember: 'not_requested',
  },
  {
    cppEnum: 'EWonderlandPresentation',
    source: 'WONDERLAND_PRESENTATIONS',
    members: WONDERLAND_PRESENTATIONS,
    nullable: false,
    zeroMember: 'no_renderer',
  },
  {
    /**
     * NULLABLE, AND THE ABSENCE IS NOT EITHER KIND.
     *
     * A zero-filled offer claiming to be `UnrealPixelStream` would describe an
     * approximation as the real world; one claiming `EmbeddedScene` would
     * understate a real stream. A renderer that did not say what it is has said
     * nothing, and `Unobserved` is that.
     */
    cppEnum: 'EWonderlandRendererKind',
    source: 'WONDERLAND_RENDERER_KINDS',
    members: WONDERLAND_RENDERER_KINDS,
    nullable: true,
    zeroMember: 'Unobserved',
  },
  {
    cppEnum: 'EWonderlandUsageStatus',
    source: 'WONDERLAND_USAGE_STATUSES',
    members: WONDERLAND_USAGE_STATUSES,
    nullable: false,
    zeroMember: 'unavailable',
  },
  {
    cppEnum: 'EWonderlandHudAnchor',
    source: 'WONDERLAND_HUD_ANCHORS',
    members: WONDERLAND_HUD_ANCHORS,
    nullable: false,
    zeroMember: 'top_left',
  },
  {
    cppEnum: 'EWonderlandLinkState',
    source: 'WONDERLAND_LINK_STATES',
    members: WONDERLAND_LINK_STATES,
    nullable: false,
    zeroMember: 'never_connected',
  },
  {
    cppEnum: 'EWonderlandUsageReading',
    source: 'WONDERLAND_USAGE_READINGS',
    members: WONDERLAND_USAGE_READINGS,
    nullable: false,
    zeroMember: 'not_reported',
  },
  {
    cppEnum: 'EWonderlandUsageChannel',
    source: 'WONDERLAND_USAGE_CHANNELS',
    members: WONDERLAND_USAGE_CHANNELS,
    nullable: false,
    zeroMember: 'compound_agent',
  },
];

/**
 * Which fields of each new struct admit absence, PROVEN against the interfaces.
 *
 * `nullableKeys` makes `tsc` reject a list that is not exactly the nullable
 * key set, in either direction, so making a field nullable — or making a
 * nullable field required — breaks the build here rather than quietly leaving
 * an `FString` to present emptiness as a fact.
 */
export const WONDERLAND_INTEGRATION_NULLABLE_FIELDS: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  FWonderlandJuliusEmbodiment: JULIUS_EMBODIMENT_NULLABLE,
  FWonderlandAnimationPlan: ANIMATION_PLAN_NULLABLE,
  FWonderlandEntry: ENTRY_NULLABLE,
  FWonderlandEnvelope: ENVELOPE_NULLABLE,
  FWonderlandCursor: CURSOR_NULLABLE,
  FWonderlandRunSnapshot: RUN_SNAPSHOT_NULLABLE,
  FWonderlandRendererOffer: RENDERER_OFFER_NULLABLE,
  FWonderlandUsageChannelStyle: CHANNEL_STYLE_NULLABLE,
  FWonderlandLinkStatus: LINK_STATUS_NULLABLE,
  FWonderlandUsageAuthorityStatus: AUTHORITY_STATUS_NULLABLE,
  FWonderlandUsageViewport: USAGE_VIEWPORT_NULLABLE,
  FWonderlandHydration: HYDRATION_NULLABLE,
  FWonderlandActivityIntent: ACTIVITY_INTENT_NULLABLE,
  FWonderlandCardScope: CARD_SCOPE_NULLABLE,
  FWonderlandHumanGate: HUMAN_GATE_NULLABLE,
  FWonderlandBrainCitation: BRAIN_CITATION_NULLABLE,
  FWonderlandActivityReading: ACTIVITY_READING_NULLABLE,
  FWonderlandWorkerActivity: WORKER_ACTIVITY_NULLABLE,
  FWonderlandMeterDrawPlan: METER_DRAW_PLAN_NULLABLE,
  FWonderlandSwooshSample: SWOOSH_SAMPLE_NULLABLE,
  FWonderlandSwooshSegment: SWOOSH_SEGMENT_NULLABLE,
  FWonderlandUsageSwoosh: USAGE_SWOOSH_NULLABLE,
  FWonderlandUsageMeter: USAGE_METER_NULLABLE,
  FWonderlandUsageHud: USAGE_HUD_NULLABLE,
});
