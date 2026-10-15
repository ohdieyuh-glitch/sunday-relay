/**
 * THE USAGE AUTHORITY — where the numbers in the HUD are allowed to come from.
 *
 * The meter can draw. What it could not do until this file existed is say WHO
 * SAID SO, HOW LONG AGO, and WHETHER THAT IS STILL TRUE. Those three questions
 * are the difference between a gauge and a decoration, and none of them can be
 * answered by the projection: a projection is handed numbers and renders them,
 * and by then the chance to refuse a number has already passed.
 *
 * THE FOUR READINGS, and why four rather than a boolean:
 *
 *   known          an authority reported, recently enough to still mean it
 *   stale          an authority reported, and it was long enough ago that the
 *                  figures may have moved. THE NUMBERS ARE STILL SHOWN — a
 *                  stale figure is information and hiding it would leave a
 *                  founder with nothing — but they are labelled, because a
 *                  stale number presented as current is the more expensive lie
 *   not_reported   no authority has ever spoken. Not zero. Not empty.
 *   unavailable    an authority spoke and said it cannot supply figures. This
 *                  is a DIFFERENT fact from silence: one means the system is
 *                  there and refusing, the other means nothing is there, and
 *                  collapsing them hides a deployment mistake behind a shrug
 *
 * WHAT THIS MODULE REFUSES:
 *
 *  - IT NEVER FABRICATES. There is no path from "no report" to a number. The
 *    projection it produces carries `WonderlandFigure`s that say `known: false`.
 *
 *  - IT NEVER ACCEPTS ANOTHER PROJECT'S FIGURES. A report whose `projectId`
 *    does not match is rejected and counted. This is the same rule the event
 *    reducer applies, for the same reason: one player's capacity rendered under
 *    another player's name is worse than no capacity at all, and it is exactly
 *    the failure a shared HUD component invites.
 *
 *  - IT NEVER GOES BACKWARDS. Reports carry a monotonic `revision` per project,
 *    and one at or below the held revision is rejected. A retried delivery, a
 *    reordered fan-out and a reconnect replay are all normal traffic, and any
 *    of them would otherwise walk a founder's balance backwards.
 *
 *  - IT KNOWS NOTHING ABOUT BILLING. A tier is an opaque id, a label and a
 *    ceiling that the authority supplies. There is no price, no plan name, no
 *    entitlement rule and no table mapping one to the other, here or in the
 *    meter. Relay holds no subscription ledger; a constant in a rendering path
 *    would quietly become one.
 *
 * PURE. Every instant is an injected ISO string — including the one that
 * decides staleness, which is the whole reason freshness can be tested at all.
 */

import type { Provenance } from '../../protocol/enums';
import { exactKeys } from './wonderland-contracts';
import {
  WONDERLAND_USAGE_ANCHOR,
  WONDERLAND_USAGE_SCHEMA_V1,
  projectWonderlandUsageHud,
  projectWonderlandUsageMeter,
} from './wonderland-usage-meter';
import type {
  WonderlandUsageChannel,
  WonderlandUsageHud,
  WonderlandUsageMeter,
  WonderlandUsageStatus,
} from './wonderland-usage-meter';

/* ------------------------------------------------------------ versioning */

export const WONDERLAND_USAGE_REPORT_SCHEMA_V1 = 'relay-wonderland-usage-report.v1' as const;
export type WonderlandUsageReportSchemaVersion = typeof WONDERLAND_USAGE_REPORT_SCHEMA_V1;

/* -------------------------------------------------------------- readings */

export const WONDERLAND_USAGE_READINGS = [
  'not_reported',
  'known',
  'stale',
  'unavailable',
] as const;
export type WonderlandUsageReading = (typeof WONDERLAND_USAGE_READINGS)[number];

/**
 * `not_reported` sits at ordinal 0 deliberately, because the C++ mirror
 * zero-fills: a default-constructed reading has to mean "nobody has said",
 * never "known".
 */
export const WONDERLAND_USAGE_READING_ZERO: WonderlandUsageReading = 'not_reported';

/** Whether a reading carries figures at all. Stale ones do; the other two do not. */
export const wonderlandUsageReadingHasFigures = (reading: WonderlandUsageReading): boolean =>
  reading === 'known' || reading === 'stale';

/* --------------------------------------------------------------- reports */

/**
 * One channel's figures, as an authority states them.
 *
 * `current` IS THE REMAINDER, not the spend, and the name is the one the
 * direction used. Every field is nullable because an authority may know one
 * channel and not the other — a Compound ceiling with no single-agent figure is
 * a real state, and forcing it to report zero would be forcing it to lie.
 */
export interface WonderlandUsageChannelReport {
  /** Units still available. NEVER units spent — the meter drains. */
  readonly current: number | null;
  /** This tier's ceiling. */
  readonly maximum: number | null;
  /**
   * The ceiling the HUD draws a full arc for, in THIS CHANNEL'S ladder.
   *
   * Per channel, not per HUD: the two bars are different instruments with
   * different tier ladders, and one shared ceiling squashes the smaller one
   * into a stub of its own stroke.
   */
  readonly reference: number | null;
  /** Opaque. Never parsed, never ranked, never mapped to a price. */
  readonly tierId: string | null;
  readonly tierLabel: string | null;
  readonly unitLabel: string | null;
}

export interface WonderlandUsageReport {
  readonly schemaVersion: WonderlandUsageReportSchemaVersion;
  /** Whose capacity this is. A report for another project is not ours. */
  readonly projectId: string;
  /** Monotonic per project. At or below the held revision is stale. */
  readonly revision: number;
  /** When the AUTHORITY observed these figures — not when they arrived. */
  readonly reportedAtIso: string;
  /** Who said so. Carried for traceability, never interpreted. */
  readonly authorityId: string;
  /**
   * Set when the authority is present and cannot supply figures. A sentence,
   * because "unavailable" alone tells an operator nothing they can act on.
   */
  readonly unavailableReason: string | null;
  readonly compoundAgent: WonderlandUsageChannelReport;
  readonly singleAgent: WonderlandUsageChannelReport;
}

/* ----------------------------------------------------------- the holder */

/**
 * What a client holds between reports.
 *
 * The counters are part of the state rather than a log, for the same reason the
 * event reducer's are: a HUD that has rejected eleven foreign-project reports is
 * in a different situation from one that has received a clean stream, and a
 * surface that could not tell them apart would render both identically.
 */
export interface WonderlandUsageAuthorityState {
  readonly projectId: string;
  /** Seconds after which a report stops counting as current. */
  readonly staleAfterSeconds: number;
  /** The last accepted report, or null when none has been. */
  readonly report: WonderlandUsageReport | null;
  /** Highest accepted revision. Resume/compare against exactly this. */
  readonly revision: number;
  readonly foreignProjectReportsRejected: number;
  readonly staleRevisionsRejected: number;
  readonly malformedReportsRejected: number;
}

/** The sentence a HUD shows when no authority has ever reported. */
export const WONDERLAND_USAGE_NOT_REPORTED_REASON =
  'No usage authority has reported capacity for this world yet.';

/** The sentence a HUD shows beside figures that may have moved. */
export const WONDERLAND_USAGE_STALE_REASON =
  'These figures are the last an authority reported and may have moved since.';

/**
 * How long a report counts as current, by default.
 *
 * Sixty seconds is a CHOICE and not a measurement, so it is a default rather
 * than a constant: a deployment that knows its authority's cadence should say
 * so. What matters is that some budget exists — without one, a figure from an
 * authority that died an hour ago renders exactly like one from a second ago.
 */
export const WONDERLAND_USAGE_DEFAULT_STALE_AFTER_SECONDS = 60;

export function emptyWonderlandUsageAuthority(input: {
  readonly projectId: string;
  readonly staleAfterSeconds?: number;
}): WonderlandUsageAuthorityState {
  return Object.freeze({
    projectId: input.projectId,
    staleAfterSeconds:
      input.staleAfterSeconds ?? WONDERLAND_USAGE_DEFAULT_STALE_AFTER_SECONDS,
    report: null,
    revision: 0,
    foreignProjectReportsRejected: 0,
    staleRevisionsRejected: 0,
    malformedReportsRejected: 0,
  });
}

/** A report whose own shape disqualifies it, before any of its figures are read. */
function malformed(report: WonderlandUsageReport): boolean {
  return (
    report.schemaVersion !== WONDERLAND_USAGE_REPORT_SCHEMA_V1 ||
    !Number.isSafeInteger(report.revision) ||
    report.revision < 1 ||
    report.projectId.trim() === '' ||
    report.reportedAtIso.trim() === ''
  );
}

/**
 * Accept a report, or refuse it and say which rule refused it.
 *
 * The three refusals are ordered by how wrong the report is. A foreign project
 * is not ours at all; a malformed one is ours and unreadable; a stale revision
 * is ours, readable, and already superseded. Counting them separately is what
 * lets an operator tell a mis-routed fan-out from a schema drift from ordinary
 * replay traffic — three very different problems that a single "rejected"
 * counter would present as one.
 */
export function applyWonderlandUsageReport(
  state: WonderlandUsageAuthorityState,
  report: WonderlandUsageReport,
): WonderlandUsageAuthorityState {
  if (report.projectId !== state.projectId) {
    return Object.freeze({
      ...state,
      foreignProjectReportsRejected: state.foreignProjectReportsRejected + 1,
    });
  }
  if (malformed(report)) {
    return Object.freeze({
      ...state,
      malformedReportsRejected: state.malformedReportsRejected + 1,
    });
  }
  if (report.revision <= state.revision) {
    return Object.freeze({
      ...state,
      staleRevisionsRejected: state.staleRevisionsRejected + 1,
    });
  }
  return Object.freeze({ ...state, report, revision: report.revision });
}

/* -------------------------------------------------------------- reading */

/** Elapsed seconds between two ISO instants, or null when either is unusable. */
function elapsedSeconds(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return (to - from) / 1000;
}

export interface WonderlandUsageReadingResult {
  readonly reading: WonderlandUsageReading;
  /** A sentence whenever the reading is not `known`. Never a bare enum. */
  readonly reason: string | null;
  /** Age of the held report at the observation instant, when computable. */
  readonly ageSeconds: number | null;
}

/**
 * Resolve what the held state means AT AN INSTANT.
 *
 * The instant is a parameter, which is the only reason staleness is testable:
 * a module that read a clock could be tested for "known" and never for the
 * transition, and the transition is the whole feature.
 *
 * AN UNREADABLE TIMESTAMP IS STALE, not fresh. A report whose `reportedAtIso`
 * cannot be parsed has no age, and the safe reading of "I cannot tell how old
 * this is" is not "it is current".
 *
 * A REPORT FROM THE FUTURE IS NOT STALE. Clock skew between an authority and a
 * client is ordinary; treating a slightly-ahead timestamp as expired would make
 * a healthy system flicker. Only elapsed time past the budget ages a report.
 */
export function readWonderlandUsageAuthority(
  state: WonderlandUsageAuthorityState,
  atIso: string,
): WonderlandUsageReadingResult {
  const report = state.report;
  if (report === null) {
    return {
      reading: 'not_reported',
      reason: WONDERLAND_USAGE_NOT_REPORTED_REASON,
      ageSeconds: null,
    };
  }
  if (report.unavailableReason !== null) {
    return { reading: 'unavailable', reason: report.unavailableReason, ageSeconds: null };
  }
  const age = elapsedSeconds(report.reportedAtIso, atIso);
  if (age === null) {
    return { reading: 'stale', reason: WONDERLAND_USAGE_STALE_REASON, ageSeconds: null };
  }
  if (age > state.staleAfterSeconds) {
    return { reading: 'stale', reason: WONDERLAND_USAGE_STALE_REASON, ageSeconds: age };
  }
  return { reading: 'known', reason: null, ageSeconds: age };
}

/* ----------------------------------------------------------- projection */

/**
 * `current` and `maximum` become `used` and `capacity`, ONCE.
 *
 * The meter's projection speaks in units SPENT because that is what a usage
 * model measures; the authority speaks in units REMAINING because that is what
 * a capacity meter reads. The conversion is one subtraction and it lives here,
 * in one place, deliberately: the last time these two conventions met at three
 * call sites the HUD drew an empty bar beside the words "480 / 480".
 */
function usedUnitsFrom(channel: WonderlandUsageChannelReport): number | null {
  if (channel.current === null || channel.maximum === null) return null;
  if (!Number.isFinite(channel.current) || !Number.isFinite(channel.maximum)) return null;
  return Math.max(0, channel.maximum - channel.current);
}

/**
 * The status a reading implies.
 *
 * `blocked` is deliberately absent: nothing here knows whether a spent meter
 * stops a mission, and a HUD asserting `blocked` would be a rendering module
 * making an entitlement decision.
 */
function statusFor(
  reading: WonderlandUsageReading,
  channel: WonderlandUsageChannelReport,
): WonderlandUsageStatus {
  if (reading === 'not_reported' || reading === 'unavailable') return 'unavailable';
  if (channel.current === null || channel.maximum === null) return 'unavailable';
  if (reading === 'stale') return 'updating';
  return 'available';
}

/**
 * A reading's provenance.
 *
 * `known` is the ONLY reading that may claim `live`. A stale figure was live
 * once and is not now, and `imported` is Relay's own word for a figure that
 * came from somewhere real and is no longer being maintained — which is exactly
 * what a stale reading is.
 */
function provenanceFor(reading: WonderlandUsageReading): Provenance {
  if (reading === 'known') return 'live';
  if (reading === 'stale') return 'imported';
  return 'simulated';
}

/**
 * THE HONESTY LAYER, as its own struct so Unreal can hold it.
 *
 * Kept apart from `WonderlandUsageHud` deliberately. The HUD is what to DRAW;
 * this is how much to BELIEVE it, and a renderer that had to dig the second out
 * of the first would eventually stop bothering. It is small enough to travel
 * everywhere the HUD does.
 */
export interface WonderlandUsageAuthorityStatus {
  readonly reading: WonderlandUsageReading;
  /** A sentence whenever the reading is not `known`. Never a bare enum. */
  readonly reason: string | null;
  /** Age of the held report at the observation instant, when computable. */
  readonly ageSeconds: number | null;
  /** The revision the figures came from. 0 when none have. */
  readonly revision: number;
  /** Who reported them, or null. Carried for traceability, never interpreted. */
  readonly authorityId: string | null;
  /** Reports refused because they named another project. */
  readonly foreignProjectReportsRejected: number;
  /** Reports refused because their revision was already passed. */
  readonly staleRevisionsRejected: number;
  /** Reports refused because their own shape disqualified them. */
  readonly malformedReportsRejected: number;
}

export const WONDERLAND_USAGE_AUTHORITY_STATUS_FIELDS =
  exactKeys<WonderlandUsageAuthorityStatus>()([
    'reading',
    'reason',
    'ageSeconds',
    'revision',
    'authorityId',
    'foreignProjectReportsRejected',
    'staleRevisionsRejected',
    'malformedReportsRejected',
  ] as const);

export interface WonderlandUsageAuthorityProjection {
  readonly hud: WonderlandUsageHud;
  readonly status: WonderlandUsageAuthorityStatus;
}

/**
 * The whole HUD, from held authority state, at an instant.
 *
 * This is the function a surface calls. It cannot be handed loose numbers —
 * everything it draws came through `applyWonderlandUsageReport`, which is where
 * the project check, the revision check and the schema check live. That is the
 * point of routing it here rather than letting a caller build a meter directly:
 * the refusals are not optional, because there is no path around them.
 */
export function projectWonderlandUsageFromAuthority(
  state: WonderlandUsageAuthorityState,
  atIso: string,
): WonderlandUsageAuthorityProjection {
  const resolved = readWonderlandUsageAuthority(state, atIso);
  const report = state.report;
  const carries = wonderlandUsageReadingHasFigures(resolved.reading) && report !== null;

  const meterFor = (channel: WonderlandUsageChannel): WonderlandUsageMeter => {
    const figures =
      report === null
        ? null
        : channel === 'compound_agent'
          ? report.compoundAgent
          : report.singleAgent;
    return projectWonderlandUsageMeter({
      channel,
      tierId: carries ? (figures?.tierId ?? null) : null,
      tierLabel: carries ? (figures?.tierLabel ?? null) : null,
      unitLabel: carries ? (figures?.unitLabel ?? null) : null,
      capacityUnits: carries ? (figures?.maximum ?? null) : null,
      usedUnits: carries && figures !== null ? usedUnitsFrom(figures) : null,
      referenceCapacityUnits: carries ? (figures?.reference ?? null) : null,
      status: figures === null ? 'unavailable' : statusFor(resolved.reading, figures),
      provenance: provenanceFor(resolved.reading),
      observedAtIso: report?.reportedAtIso ?? atIso,
      unavailableReason: resolved.reason,
    });
  };

  return {
    status: Object.freeze({
      reading: resolved.reading,
      reason: resolved.reason,
      ageSeconds: resolved.ageSeconds,
      revision: state.revision,
      authorityId: report?.authorityId ?? null,
      foreignProjectReportsRejected: state.foreignProjectReportsRejected,
      staleRevisionsRejected: state.staleRevisionsRejected,
      malformedReportsRejected: state.malformedReportsRejected,
    }),
    hud: projectWonderlandUsageHud({
      compoundAgent: meterFor('compound_agent'),
      singleAgent: meterFor('single_agent'),
      // THE HUD'S OWN INSTANT IS THE OBSERVATION, not the report's. A HUD
      // assembled at 10:05 from a report made at 10:00 was assembled at 10:05,
      // and stamping it with the report's time would erase the age the reading
      // has just been computed from.
      observedAtIso: atIso,
    }),
  };
}

/** The anchor, re-exported so a surface binding the authority needs one import. */
export const WONDERLAND_USAGE_AUTHORITY_ANCHOR = WONDERLAND_USAGE_ANCHOR;
/** The meter schema these projections carry. */
export const WONDERLAND_USAGE_AUTHORITY_METER_SCHEMA = WONDERLAND_USAGE_SCHEMA_V1;
