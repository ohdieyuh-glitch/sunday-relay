/**
 * WHAT A WORLD MAY KNOW ABOUT A CONTEXT RETRIEVAL, AND WHAT IT MAY NOT.
 *
 * The founder directive is one sentence and it is the whole design: the Unreal
 * client must not become the database of record; it consumes safe, scoped
 * representations. This module is the boundary that makes that structural
 * rather than a habit.
 *
 * WHAT PROJECT BRAIN ACTUALLY HOLDS, which is why the boundary is not optional.
 * A `JuliusBrainEntry` carries free TEXT and a sensitivity of PUBLIC, INTERNAL
 * or SECRET. `compileJuliusContext` filters SECRET out and redacts key-shaped
 * substrings from what survives, but everything past that filter is still the
 * project's own objectives, constraints, decisions and findings — the substance
 * of somebody's work. A game client is the wrong place for it: it is the least
 * trusted process in the system, it is the one a player can attach a debugger
 * to, and it has no business being the copy that outlives the run.
 *
 * SO NO TEXT CROSSES. Not truncated, not summarised, not "just the objectives".
 * `WonderlandBrainCitation` carries COUNTS, REVISIONS and FLAGS, and the test
 * for that is not a review: `scopeWonderlandBrain` is the only constructor, and
 * a test serialises its output and asserts a distinctive string planted in
 * every entry appears nowhere in it.
 *
 * WHAT THE WORLD GETS INSTEAD is still worth having. A founder watching a run
 * should be able to see that context was retrieved, roughly how much of it,
 * whether the budget cut some off, and how much was redacted on the way. Those
 * are facts about the RETRIEVAL rather than about the project, and each one
 * answers a question somebody actually asks: "is it reading the brief", "did it
 * get all of it", "is something in there it should not see".
 *
 * BOUNDED BY CONSTRUCTION, WHICH §13 REQUIRES. The citation is O(kinds) — nine
 * counters — and never O(entries). A brain with ten thousand entries produces
 * exactly the same-sized citation as one with three, so no HUD change can ever
 * pull a full payload across, and there is no size at which this becomes the
 * expensive thing on the frame.
 *
 * SENSITIVITY IS DELIBERATELY ABSENT, and the omission is the interesting
 * decision here. Reporting "this retrieval touched SECRET material" would be
 * useful to an operator and is also a disclosure channel: it tells anyone
 * watching the world that secret material EXISTS and roughly when it is being
 * read, which is most of what an attacker wants from a side channel.
 * `redactionCount` covers the honest need — something was removed, and how much
 * — without saying what class of thing it was.
 */

import { exactKeys } from './wonderland-contracts';

export const WONDERLAND_BRAIN_SCHEMA_V1 = 'relay-wonderland-brain.v1' as const;

/**
 * The entry kinds, mirroring `JuliusBrainEntry['kind']`.
 *
 * A KIND IS NOT CONTENT. "Three constraints and two decisions were retrieved"
 * says something real about the shape of the context without saying what any of
 * them were — which is the line this whole module draws. The vocabulary is
 * closed and small, so a count per kind is a fixed-size fact.
 *
 * Declared here rather than imported so this module has no import edge into the
 * kernel at all: it never sees an entry, only a snapshot's counts, and an
 * import would make it look like it could. The test holds the two lists
 * against each other, so a kind added to the kernel and not here fails.
 */
export const WONDERLAND_BRAIN_KINDS = [
  'OBJECTIVE',
  'REQUIREMENT',
  'CONSTRAINT',
  'DECISION',
  'FINDING',
  'REPAIR',
  'HANDOFF',
  'ARTIFACT',
  'EVIDENCE',
] as const;
export type WonderlandBrainKind = (typeof WONDERLAND_BRAIN_KINDS)[number];

/**
 * What a world is told about one context compilation.
 *
 * Every field is a number, a flag, an opaque handle or a closed-vocabulary
 * token. There is no string here that a project author wrote.
 */
export interface WonderlandBrainCitation {
  readonly schemaVersion: typeof WONDERLAND_BRAIN_SCHEMA_V1;
  readonly projectId: string;
  readonly runId: string;
  /** Opaque handle. The world groups by it and never parses it. */
  readonly taskId: string;
  /**
   * Which Project Brain revision the context was compiled from.
   *
   * Carried because "it read the brief" and "it read the brief as it was three
   * revisions ago" are different facts, and a run whose context is stale is a
   * run somebody wants to know about.
   */
  readonly brainRevision: number;
  /** How many entries reached the packet. Not which. */
  readonly entryCount: number;
  /** Entries per kind. Always all nine keys, so a zero is a reported zero. */
  readonly kindCounts: Readonly<Record<WonderlandBrainKind, number>>;
  /** Characters compiled. A size, never the characters. */
  readonly characterCount: number;
  /** Redactions the compiler made. Something was removed, and how much. */
  readonly redactionCount: number;
  /**
   * Whether the budget cut the context short.
   *
   * The most operationally useful flag here: a truncated context is a worker
   * that did not see everything, and a run that goes wrong afterwards has a
   * candidate explanation the founder can see without reading anything.
   */
  readonly truncated: boolean;
  /**
   * The compiler's content hash. Opaque, and useful precisely because it is:
   * two retrievals with the same hash read the same thing, which is how a
   * pointless recompile becomes visible without anybody seeing the content.
   */
  readonly contentHash: string;
  readonly observedAtIso: string;
}

export const WONDERLAND_BRAIN_CITATION_FIELDS = exactKeys<WonderlandBrainCitation>()([
  'schemaVersion',
  'projectId',
  'runId',
  'taskId',
  'brainRevision',
  'entryCount',
  'kindCounts',
  'characterCount',
  'redactionCount',
  'truncated',
  'contentHash',
  'observedAtIso',
] as const);

/**
 * The shape this module accepts, declared HERE rather than imported.
 *
 * THE DEPENDENCY IS INVERTED ON PURPOSE, and it is the same inversion the
 * repository's boundary rules already demand of adapters. If this module
 * imported `JuliusContextSnapshot` it would be handed a `packet` full of text
 * on every call, and the only thing standing between that text and a world
 * would be this function remembering not to copy it. Declaring the narrower
 * shape means the text is never in scope: there is no expression inside
 * `scopeWonderlandBrain` that could reach a block, because the parameter type
 * has none.
 *
 * A caller passes a snapshot and TypeScript accepts it structurally, so nothing
 * at the call site gets harder. What changes is that the leak becomes
 * impossible rather than avoided.
 */
export interface WonderlandBrainRetrieval {
  readonly projectId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly projectBrainRevision: number;
  /** Kinds only. The caller reads them off the packet's blocks. */
  readonly kinds: readonly string[];
  readonly characterCount: number;
  readonly redactionCount: number;
  readonly truncated: boolean;
  readonly contentHash: string;
  readonly observedAtIso: string;
}

/** A whole, non-negative count. Anything else is reported as zero, not as NaN. */
const count = (value: number): number =>
  Number.isSafeInteger(value) && value > 0 ? value : 0;

/**
 * Project one retrieval into what a world may know. THE ONLY CONSTRUCTOR.
 *
 * An unrecognised kind is COUNTED IN `entryCount` AND IN NO BUCKET, rather than
 * being dropped or given a bucket of its own. Dropping it would make the
 * counters disagree with the total and hide the fact that something new
 * appeared; inventing a bucket would put an unreviewed kernel token into a
 * world's vocabulary. The disagreement between the total and the sum of the
 * buckets is the signal, and the parity test that holds this vocabulary against
 * the kernel's is what makes it a temporary one.
 */
export function scopeWonderlandBrain(
  retrieval: WonderlandBrainRetrieval,
): WonderlandBrainCitation {
  const kindCounts: Record<WonderlandBrainKind, number> = Object.fromEntries(
    WONDERLAND_BRAIN_KINDS.map((kind) => [kind, 0]),
  ) as Record<WonderlandBrainKind, number>;

  const known = new Set<string>(WONDERLAND_BRAIN_KINDS);
  for (const kind of retrieval.kinds) {
    if (known.has(kind)) kindCounts[kind as WonderlandBrainKind] += 1;
  }

  return Object.freeze({
    schemaVersion: WONDERLAND_BRAIN_SCHEMA_V1,
    projectId: retrieval.projectId,
    runId: retrieval.runId,
    taskId: retrieval.taskId,
    brainRevision: count(retrieval.projectBrainRevision),
    entryCount: retrieval.kinds.length,
    kindCounts: Object.freeze(kindCounts),
    characterCount: count(retrieval.characterCount),
    redactionCount: count(retrieval.redactionCount),
    truncated: retrieval.truncated === true,
    contentHash: retrieval.contentHash,
    observedAtIso: retrieval.observedAtIso,
  });
}

/**
 * The citation for a retrieval nobody has reported. UNKNOWN IS NOT ZERO — and
 * this is the one place that rule needs stating carefully, because a citation
 * IS mostly zeroes.
 *
 * The distinction is carried by `contentHash` being empty and `observedAtIso`
 * being empty: a real retrieval always has both. A renderer must check one of
 * them before showing "0 entries retrieved", which would otherwise be a claim
 * that a compilation happened and found nothing.
 */
export function noWonderlandBrainCitation(input: {
  readonly projectId: string;
  readonly runId: string;
}): WonderlandBrainCitation {
  return scopeWonderlandBrain({
    projectId: input.projectId,
    runId: input.runId,
    taskId: '',
    projectBrainRevision: 0,
    kinds: [],
    characterCount: 0,
    redactionCount: 0,
    truncated: false,
    contentHash: '',
    observedAtIso: '',
  });
}

/** True when an authority actually reported this retrieval. */
export const wonderlandBrainWasReported = (citation: WonderlandBrainCitation): boolean =>
  citation.contentHash.trim() !== '' && citation.observedAtIso.trim() !== '';
