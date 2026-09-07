/**
 * WHICH FACT IS NEWER — the question a network cannot answer for you.
 *
 * An event arriving last is not an event that happened last. Retries, replays,
 * two open connections and a reconnect all deliver in an order the wire chose,
 * and a world that trusted arrival order would show a founder a CODING dog
 * after their mission finished.
 *
 * TWO AXES, BECAUSE JULIUS HAS TWO CLOCKS AND THEY MEASURE DIFFERENT THINGS.
 *
 *   sequence   per RUN, allocated by the event ledger
 *              (`relay_wonderland.stream_sequences`, keyed by `run_id`). It
 *              orders EVENTS within one run and nothing else.
 *
 *   revision   per RUN, `julius_runs.version`, bumped under optimistic
 *              concurrency on every state transition. It orders STATES.
 *
 * They are not interchangeable and neither subsumes the other. Several events
 * share one revision (a run does not transition on every event), and a snapshot
 * carries a revision with no sequence at all. So: sequence decides whether an
 * EVENT is new, revision decides whether a STATE is current, and an event whose
 * revision is behind the state we hold is describing a run that has moved on —
 * which is the case a sequence check alone cannot catch, because that event's
 * sequence really is the next one on its own stale connection.
 *
 * SEQUENCE IS PER RUN, WHICH IS THE CORRECTION THIS MODULE EXISTS TO MAKE.
 * `stream_id` is the run id on every write path (`julius-event-postgres.ts`,
 * `julius-postgres.ts`). Two runs in one project therefore both count 1, 2,
 * 3 — so a single project-wide cursor is not merely imprecise, it is wrong:
 * run B's third event would be refused as stale because run A had already
 * reached three. Cursors are held PER RUN here for that reason.
 *
 * IDENTITY IS CHECKED BEFORE ORDER. A foreign project's event is not stale, it
 * is not ours, and the two are counted separately because they mean different
 * things to whoever is debugging.
 */

import { exactKeys } from './wonderland-contracts';
import type { WonderlandEnvelope } from './wonderland-envelope';

/* ------------------------------------------------------------ versioning */

export const WONDERLAND_CURSOR_SCHEMA_V1 = 'relay-wonderland-cursor.v1' as const;
export type WonderlandCursorSchemaVersion = typeof WONDERLAND_CURSOR_SCHEMA_V1;

/* ------------------------------------------------------------- verdicts */

/**
 * WHAT HAPPENED TO AN ARRIVING ENVELOPE.
 *
 * Every refusal is its own member rather than a shared `rejected`, because the
 * counts are a diagnosis: forty `stale_sequence` is a chatty replay and is
 * fine; one `foreign_project` is a routing bug and is not.
 */
export const WONDERLAND_ORDERING_VERDICTS = [
  'accepted',
  /** The same event id, already applied. The wire retried. */
  'duplicate',
  /** In-order for its sender, behind our cursor. A stale connection. */
  'stale_sequence',
  /** Its run has already moved past the state this describes. */
  'stale_revision',
  /** Another world entirely. Never ours, at any sequence. */
  'foreign_project',
  /** A different Julius. Two instances' streams must never be merged. */
  'foreign_julius',
  /** A run we are not following. In order, not ours. */
  'foreign_run',
  /** Structurally unusable: no run, or a sequence that is not a number. */
  'malformed',
] as const;
export type WonderlandOrderingVerdict = (typeof WONDERLAND_ORDERING_VERDICTS)[number];

/** The verdicts that change what a world is showing. Exactly one. */
export const WONDERLAND_APPLIED_VERDICTS: readonly WonderlandOrderingVerdict[] =
  Object.freeze(['accepted']);

/* -------------------------------------------------------------- the cursor */

/**
 * WHAT WE HAVE ACCEPTED, for one run of one Julius in one project.
 *
 * `runId` may be null only before anything has been accepted. The moment a
 * first envelope lands the cursor binds to its run, and every later envelope is
 * checked against that binding — which is what makes `foreign_run` detectable
 * rather than silently interleaved.
 */
export interface WonderlandCursor {
  readonly schemaVersion: WonderlandCursorSchemaVersion;
  readonly projectId: string;
  /** Bound on first acceptance. Null means nothing has been accepted yet. */
  readonly juliusInstanceId: string | null;
  readonly runId: string | null;
  /** Highest accepted event sequence for `runId`. Resume from exactly this. */
  readonly sequence: number;
  /** Highest accepted run revision. A state older than this is history. */
  readonly revision: number;
  /**
   * Whether `revision` came from a SNAPSHOT rather than from an event.
   *
   * It changes what a tie means, and the difference is not academic. Two events
   * can legitimately share a revision — a run does not transition on every
   * event — so an event at the held revision is not automatically old. A
   * snapshot is different: it is the run's own row AT that revision, so it is
   * strictly newer than any event of that same generation. Without this
   * distinction a reconnect after COMPLETE would accept the replayed
   * revision-6 CODING event and walk the world backwards, which is the precise
   * failure the whole ordering layer exists to prevent.
   */
  readonly revisionFromSnapshot: boolean;
  /** The last accepted event's id, so an immediate retry is a duplicate. */
  readonly lastEventId: string | null;
  readonly lastAcceptedAtIso: string | null;
  /** Accepted events, so "quiet" and "nothing ever arrived" are different. */
  readonly accepted: number;
  readonly duplicates: number;
  readonly staleSequences: number;
  readonly staleRevisions: number;
  readonly foreignProjects: number;
  readonly foreignJulius: number;
  readonly foreignRuns: number;
  readonly malformed: number;
  /** Sequence jumps greater than one. Replay is how they are repaired. */
  readonly gaps: number;
}

export const WONDERLAND_CURSOR_FIELDS = exactKeys<WonderlandCursor>()([
  'schemaVersion',
  'projectId',
  'juliusInstanceId',
  'runId',
  'sequence',
  'revision',
  'revisionFromSnapshot',
  'lastEventId',
  'lastAcceptedAtIso',
  'accepted',
  'duplicates',
  'staleSequences',
  'staleRevisions',
  'foreignProjects',
  'foreignJulius',
  'foreignRuns',
  'malformed',
  'gaps',
]);

export function openWonderlandCursor(input: {
  readonly projectId: string;
  readonly juliusInstanceId?: string | null;
  readonly runId?: string | null;
}): WonderlandCursor {
  return Object.freeze({
    schemaVersion: WONDERLAND_CURSOR_SCHEMA_V1,
    projectId: input.projectId,
    juliusInstanceId: input.juliusInstanceId ?? null,
    runId: input.runId ?? null,
    sequence: 0,
    revision: 0,
    revisionFromSnapshot: false,
    lastEventId: null,
    lastAcceptedAtIso: null,
    accepted: 0,
    duplicates: 0,
    staleSequences: 0,
    staleRevisions: 0,
    foreignProjects: 0,
    foreignJulius: 0,
    foreignRuns: 0,
    malformed: 0,
    gaps: 0,
  });
}

/* ------------------------------------------------------------- the verdict */

/**
 * Judge an envelope against a cursor. PURE — decides nothing about rendering.
 *
 * ORDER OF CHECKS IS THE DESIGN. Identity first, because an envelope from
 * another project is not late, it is misrouted, and reporting it as stale would
 * send whoever is debugging to look at the wire instead of the router.
 * Structure next, because an unusable envelope cannot be compared. Then
 * duplicate, then the two staleness axes.
 */
export function wonderlandOrderingVerdict(
  cursor: WonderlandCursor,
  envelope: WonderlandEnvelope,
): WonderlandOrderingVerdict {
  if (envelope.projectId !== cursor.projectId) return 'foreign_project';

  if (
    cursor.juliusInstanceId !== null &&
    envelope.juliusInstanceId !== null &&
    envelope.juliusInstanceId !== cursor.juliusInstanceId
  ) {
    return 'foreign_julius';
  }

  if (cursor.runId !== null && envelope.runId !== null && envelope.runId !== cursor.runId) {
    return 'foreign_run';
  }

  if (!Number.isSafeInteger(envelope.sequence) || envelope.sequence < 0) return 'malformed';
  if (!Number.isSafeInteger(envelope.revision) || envelope.revision < 0) return 'malformed';
  if (envelope.eventId.length === 0) return 'malformed';

  if (cursor.lastEventId !== null && envelope.eventId === cursor.lastEventId) return 'duplicate';

  // Revision BEFORE sequence. A reconnect on a stale replica can deliver an
  // event whose sequence is genuinely ahead of ours on that replica while the
  // run has already moved on — the sequence check would accept it and the world
  // would go backwards. The revision is the run's own version and cannot.
  if (envelope.revision < cursor.revision) return 'stale_revision';
  // A tie is stale only against a snapshot. See `revisionFromSnapshot`.
  if (cursor.revisionFromSnapshot && envelope.revision === cursor.revision) {
    return 'stale_revision';
  }

  if (envelope.sequence <= cursor.sequence) return 'stale_sequence';

  return 'accepted';
}

/**
 * Fold a verdict into the cursor.
 *
 * Every verdict updates SOMETHING, including the refusals — a cursor that
 * dropped forty events and looks identical to one that received none is a
 * cursor nobody can debug. Only `accepted` moves the position.
 */
export function applyWonderlandOrdering(
  cursor: WonderlandCursor,
  envelope: WonderlandEnvelope,
): { readonly cursor: WonderlandCursor; readonly verdict: WonderlandOrderingVerdict } {
  const verdict = wonderlandOrderingVerdict(cursor, envelope);

  if (verdict !== 'accepted') {
    const counter: Readonly<Record<Exclude<WonderlandOrderingVerdict, 'accepted'>, keyof WonderlandCursor>> = {
      duplicate: 'duplicates',
      stale_sequence: 'staleSequences',
      stale_revision: 'staleRevisions',
      foreign_project: 'foreignProjects',
      foreign_julius: 'foreignJulius',
      foreign_run: 'foreignRuns',
      malformed: 'malformed',
    };
    const field = counter[verdict];
    return {
      verdict,
      cursor: Object.freeze({ ...cursor, [field]: (cursor[field] as number) + 1 }),
    };
  }

  // A gap only means something once we have a position to jump from.
  const gapped = cursor.sequence > 0 && envelope.sequence > cursor.sequence + 1;

  return {
    verdict,
    cursor: Object.freeze({
      ...cursor,
      // Identity is LEARNED on first acceptance and never overwritten with null
      // by a later envelope that happened not to name it.
      juliusInstanceId: envelope.juliusInstanceId ?? cursor.juliusInstanceId,
      runId: envelope.runId ?? cursor.runId,
      sequence: envelope.sequence,
      // Revision only ever rises. An accepted event that names an older
      // revision than one already seen does not take the run backwards.
      revision: Math.max(cursor.revision, envelope.revision),
      // An accepted event re-establishes the revision from the EVENT stream, so
      // later events at that revision are peers again rather than history.
      revisionFromSnapshot: false,
      lastEventId: envelope.eventId,
      lastAcceptedAtIso: envelope.occurredAt,
      accepted: cursor.accepted + 1,
      gaps: cursor.gaps + (gapped ? 1 : 0),
    }),
  };
}

/** What to ask a replay for: everything strictly after this, for this run. */
export interface WonderlandResumeRequest {
  readonly projectId: string;
  readonly runId: string | null;
  readonly afterSequence: number;
  readonly heldRevision: number;
}

/**
 * The resume request for a cursor.
 *
 * `afterSequence` is the highest APPLIED sequence, not the highest received:
 * an envelope the reducer refused must be sent again if the reason it was
 * refused has since changed.
 */
export const wonderlandResumeRequest = (cursor: WonderlandCursor): WonderlandResumeRequest =>
  Object.freeze({
    projectId: cursor.projectId,
    runId: cursor.runId,
    afterSequence: cursor.sequence,
    heldRevision: cursor.revision,
  });

/** True when the stream has holes, so a replay is worth asking for. */
export const wonderlandCursorNeedsReplay = (cursor: WonderlandCursor): boolean => cursor.gaps > 0;
