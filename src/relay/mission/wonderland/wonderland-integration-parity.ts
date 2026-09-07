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
  JULIUS_EMBODIMENT_FIELDS,
  JULIUS_STATE_SOURCES,
  JULIUS_VISUAL_STATES,
} from './wonderland-julius-state';
import type { JuliusEmbodiment } from './wonderland-julius-state';
import {
  WONDERLAND_HUD_ANCHORS,
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
  {
    cppEnum: 'EWonderlandJuliusStateSource',
    source: 'JULIUS_STATE_SOURCES',
    members: JULIUS_STATE_SOURCES,
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
  FWonderlandUsageChannelStyle: CHANNEL_STYLE_NULLABLE,
  FWonderlandLinkStatus: LINK_STATUS_NULLABLE,
  FWonderlandUsageAuthorityStatus: AUTHORITY_STATUS_NULLABLE,
  FWonderlandUsageViewport: USAGE_VIEWPORT_NULLABLE,
  FWonderlandSwooshSegment: SWOOSH_SEGMENT_NULLABLE,
  FWonderlandUsageSwoosh: USAGE_SWOOSH_NULLABLE,
  FWonderlandUsageMeter: USAGE_METER_NULLABLE,
  FWonderlandUsageHud: USAGE_HUD_NULLABLE,
});
