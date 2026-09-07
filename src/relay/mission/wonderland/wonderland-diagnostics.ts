/**
 * WHAT AN OPERATOR CAN SAFELY BE SHOWN ABOUT ONE WORLD.
 *
 * When a founder says "the dog is wrong", every useful question is about
 * plumbing: which Julius is this, which run, what did we last accept, how much
 * did we throw away, does the usage figure mean anything. Those answers are
 * spread across a cursor, a link, an authority and an entry, and an operator
 * asking them one at a time is an operator who will stop asking.
 *
 * SO THIS IS A PROJECTION, NOT A STORE. It holds nothing, subscribes to
 * nothing and decides nothing; it reads the records that already exist and
 * arranges them. A diagnostics layer with its own state is a second account of
 * the truth, and the first thing it does when something goes wrong is disagree
 * with the layer it was built to explain.
 *
 * SAFETY IS STRUCTURAL, NOT EDITORIAL. Everything here is an identifier, a
 * count, an enum member or a sentence this repository wrote. No metadata, no
 * payload, no facts, no URL and no header crosses — not because they are
 * filtered, but because there is no field they could occupy. A test sweeps the
 * output for credential shapes and provider names anyway, since "there is no
 * field for it" is a claim worth checking rather than trusting.
 */

import { exactKeys } from './wonderland-contracts';
import type { WonderlandCursor } from './wonderland-ordering';
import type { WonderlandUsageAuthorityStatus } from './wonderland-usage-authority';
import type { WonderlandLinkStatus } from './wonderland-bridge';
import type { WonderlandEntry } from './wonderland-entry';
import type { WonderlandUsageAccount } from './wonderland-usage-accounting';
import type { JuliusVisualState } from './wonderland-julius-state';

export const WONDERLAND_DIAGNOSTICS_SCHEMA_V1 = 'relay-wonderland-diagnostics.v1' as const;
export type WonderlandDiagnosticsSchemaVersion = typeof WONDERLAND_DIAGNOSTICS_SCHEMA_V1;

/**
 * ONE WORLD, AS AN OPERATOR SEES IT.
 *
 * Flat on purpose. A nested shape reads well in a type and badly in a terminal,
 * and this exists to be printed next to a founder saying something is wrong.
 */
export interface WonderlandDiagnostics {
  readonly schemaVersion: WonderlandDiagnosticsSchemaVersion;

  /* identity — which world, which Julius, which run */
  readonly projectId: string;
  readonly worldSessionId: string | null;
  readonly juliusInstanceId: string | null;
  readonly runId: string | null;

  /* what is being shown */
  readonly visualState: JuliusVisualState | null;
  readonly terminal: boolean;
  /** A sentence whenever `visualState` is null. Never a bare absence. */
  readonly unobservedReason: string | null;

  /* the wire */
  readonly linkState: WonderlandLinkStatus['state'];
  readonly lastSnapshotAtIso: string | null;
  readonly reconnectAttempts: number;

  /* the cursor */
  readonly lastAcceptedSequence: number;
  readonly lastAcceptedRevision: number;
  readonly revisionFromSnapshot: boolean;
  readonly lastAcceptedAtIso: string | null;
  readonly eventsAccepted: number;

  /* what was thrown away, by kind */
  readonly duplicatesRejected: number;
  readonly staleSequencesRejected: number;
  readonly staleRevisionsRejected: number;
  readonly foreignProjectsRejected: number;
  readonly foreignJuliusRejected: number;
  readonly foreignRunsRejected: number;
  readonly malformedRejected: number;
  readonly sequenceGaps: number;

  /* the money */
  readonly usageReading: WonderlandUsageAuthorityStatus['reading'];
  readonly usageAuthorityId: string | null;
  readonly usageRevision: number;
  readonly usageAgeSeconds: number | null;
  readonly usageAccountPartial: boolean | null;
  readonly usageUnattributedUnits: number | null;

  /* the way in */
  readonly entryAdmission: WonderlandEntry['admission'];
  readonly entryPresentation: WonderlandEntry['presentation'];

  /** The most recent thing that went wrong, as a sentence Relay wrote. */
  readonly lastRefusalReason: string | null;
  /** True when anything at all has been refused. One glance, not seven. */
  readonly degraded: boolean;
}

export const WONDERLAND_DIAGNOSTICS_FIELDS = exactKeys<WonderlandDiagnostics>()([
  'schemaVersion',
  'projectId',
  'worldSessionId',
  'juliusInstanceId',
  'runId',
  'visualState',
  'terminal',
  'unobservedReason',
  'linkState',
  'lastSnapshotAtIso',
  'reconnectAttempts',
  'lastAcceptedSequence',
  'lastAcceptedRevision',
  'revisionFromSnapshot',
  'lastAcceptedAtIso',
  'eventsAccepted',
  'duplicatesRejected',
  'staleSequencesRejected',
  'staleRevisionsRejected',
  'foreignProjectsRejected',
  'foreignJuliusRejected',
  'foreignRunsRejected',
  'malformedRejected',
  'sequenceGaps',
  'usageReading',
  'usageAuthorityId',
  'usageRevision',
  'usageAgeSeconds',
  'usageAccountPartial',
  'usageUnattributedUnits',
  'entryAdmission',
  'entryPresentation',
  'lastRefusalReason',
  'degraded',
]);

/**
 * Arrange what already exists. Reads only; nothing is computed from a clock.
 *
 * `account` and `entry` are optional because a world can be diagnosed before
 * either exists — a stream can be misbehaving in a build that ships no renderer
 * and reports no usage, which is exactly today's build.
 */
export function projectWonderlandDiagnostics(input: {
  readonly cursor: WonderlandCursor;
  readonly link: WonderlandLinkStatus;
  readonly reconnectAttempts: number;
  readonly usage: WonderlandUsageAuthorityStatus;
  readonly visualState: JuliusVisualState | null;
  readonly terminal: boolean;
  readonly unobservedReason: string | null;
  readonly worldSessionId?: string | null;
  readonly account?: WonderlandUsageAccount | null;
  readonly entry?: WonderlandEntry | null;
  readonly lastRefusalReason?: string | null;
}): WonderlandDiagnostics {
  const c = input.cursor;
  const refused =
    c.duplicates +
    c.staleSequences +
    c.staleRevisions +
    c.foreignProjects +
    c.foreignJulius +
    c.foreignRuns +
    c.malformed;

  return Object.freeze({
    schemaVersion: WONDERLAND_DIAGNOSTICS_SCHEMA_V1,

    projectId: c.projectId,
    worldSessionId: input.worldSessionId ?? null,
    juliusInstanceId: c.juliusInstanceId,
    runId: c.runId,

    visualState: input.visualState,
    terminal: input.terminal,
    unobservedReason: input.unobservedReason,

    linkState: input.link.state,
    lastSnapshotAtIso: input.link.lastSnapshotAtIso,
    reconnectAttempts: input.reconnectAttempts,

    lastAcceptedSequence: c.sequence,
    lastAcceptedRevision: c.revision,
    revisionFromSnapshot: c.revisionFromSnapshot,
    lastAcceptedAtIso: c.lastAcceptedAtIso,
    eventsAccepted: c.accepted,

    duplicatesRejected: c.duplicates,
    staleSequencesRejected: c.staleSequences,
    staleRevisionsRejected: c.staleRevisions,
    foreignProjectsRejected: c.foreignProjects,
    foreignJuliusRejected: c.foreignJulius,
    foreignRunsRejected: c.foreignRuns,
    malformedRejected: c.malformed,
    sequenceGaps: c.gaps,

    usageReading: input.usage.reading,
    usageAuthorityId: input.usage.authorityId,
    usageRevision: input.usage.revision,
    usageAgeSeconds: input.usage.ageSeconds,
    // Null rather than false when there is no account: "nothing has been
    // totalled" and "the total is complete" are different answers.
    usageAccountPartial: input.account?.partial ?? null,
    usageUnattributedUnits: input.account?.unattributedUnits ?? null,

    entryAdmission: input.entry?.admission ?? 'not_requested',
    entryPresentation: input.entry?.presentation ?? 'no_renderer',

    lastRefusalReason: input.lastRefusalReason ?? null,
    // One glance rather than seven counters. Gaps count: a stream with holes is
    // degraded even if every event that did arrive was accepted.
    degraded: refused > 0 || c.gaps > 0,
  });
}

/**
 * One line per fact, for a terminal or a log.
 *
 * Sorted by field order rather than alphabetically, so identity comes first and
 * the counters stay grouped — an operator reads this top to bottom.
 */
export function formatWonderlandDiagnostics(diagnostics: WonderlandDiagnostics): string {
  return WONDERLAND_DIAGNOSTICS_FIELDS.map((field) => {
    const value = diagnostics[field];
    return `${field}: ${value === null ? 'unknown' : String(value)}`;
  }).join('\n');
}
