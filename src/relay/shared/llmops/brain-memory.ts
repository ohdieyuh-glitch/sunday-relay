/**
 * SUNDAY RELAY — PROJECT BRAIN LLMOPS
 * Short-term and long-term project memory (PURE, deterministic).
 *
 * The Project Brain already had ONE kind of memory: approved, sourced entries
 * that a human let in. That is long-term memory, and it is the right default —
 * but it cannot hold what happened in the last ten minutes, because nobody is
 * going to approve "the test suite went red at 04:12".
 *
 * So there are two, and the boundary between them is the whole design:
 *
 *   SHORT-TERM is observed, bounded, and evicted by recency. Nothing approves
 *   it. It is never cited as a fact about the project — only as a fact about
 *   the last few minutes of it.
 *
 *   LONG-TERM is approved, sourced, and durable. Nothing enters it without a
 *   human saying yes.
 *
 * PROMOTION IS A PROPOSAL, NEVER AN ACT. A short-term observation that looks
 * durable produces a *proposal* to remember it. If an agent could promote its
 * own observation, "the Brain says so" would mean "an agent wrote it down
 * twice", and the approval gate that makes long-term memory worth trusting
 * would be decorative.
 */

import { actorIdentityIsComparable, normaliseActor } from './llmops-contracts';

/* ------------------------------------------------------------ short term */

export const RELAY_OBSERVATION_KINDS = [
  'run_outcome',
  'error',
  'repair',
  'evaluation',
  'user_decision',
  'cost',
  'note',
] as const;
export type RelayObservationKind = (typeof RELAY_OBSERVATION_KINDS)[number];

export interface RelayShortTermEntry {
  readonly entryId: string;
  readonly kind: RelayObservationKind;
  readonly summary: string;
  /** ISO-8601. */
  readonly observedAt: string;
  /** Who or what saw it. Never blank — an unattributed observation is a rumour. */
  readonly observedBy: string;
  readonly missionId?: string;
}

/**
 * How many observations short-term memory holds. Small on purpose: short-term
 * memory that grows without bound is just an unapproved long-term memory with
 * a friendlier name.
 */
export const SHORT_TERM_CAPACITY = 64;

export interface RelayShortTermMemory {
  readonly entries: readonly RelayShortTermEntry[];
  /** How many were dropped to stay inside capacity. Reported, never silent. */
  readonly evicted: number;
}

export function emptyShortTermMemory(): RelayShortTermMemory {
  return { entries: [], evicted: 0 };
}

/**
 * Append, keeping the most recent `SHORT_TERM_CAPACITY`.
 *
 * Eviction is COUNTED and carried. A surface that says "12 recent events" when
 * 300 were observed and 288 fell off the end is describing its own buffer and
 * calling it the project's history.
 */
export function rememberShortTerm(
  memory: RelayShortTermMemory,
  entry: RelayShortTermEntry,
): RelayShortTermMemory {
  // Sorted on the INSTANT, not on the string. Two ISO timestamps can compare
  // the wrong way lexically — different offsets, or differing fractional-second
  // precision — and eviction then drops the NEWEST entry while claiming to keep
  // the most recent. Unparseable timestamps sort last so they are evicted first.
  const instant = (value: string): number => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };
  const combined = [...memory.entries, entry]
    .slice()
    .sort((a, b) => instant(a.observedAt) - instant(b.observedAt)
      || a.entryId.localeCompare(b.entryId));
  const overflow = Math.max(0, combined.length - SHORT_TERM_CAPACITY);
  return {
    entries: combined.slice(overflow),
    evicted: memory.evicted + overflow,
  };
}

/* ------------------------------------------------------------- long term */

export const RELAY_MEMORY_SOURCES = [
  'user_stated',
  'repository_observed',
  'run_observed',
  'research_approved',
] as const;
export type RelayMemorySource = (typeof RELAY_MEMORY_SOURCES)[number];

/**
 * An approved, sourced fact about the project.
 *
 * `approvedBy` is required and is not the same actor as `proposedBy` — see
 * `isSelfApproved`. The Brain's value is entirely in the fact that something
 * outside the agent agreed.
 */
export interface RelayLongTermEntry {
  readonly entryId: string;
  readonly statement: string;
  readonly source: RelayMemorySource;
  /** Where it came from: a path, a URL, a mission id, a user message id. */
  readonly citation: string;
  readonly proposedBy: string;
  readonly approvedBy: string;
  /** ISO-8601. */
  readonly approvedAt: string;
}

/** An entry an agent approved for itself is not an approved entry. */
export function isSelfApproved(entry: RelayLongTermEntry): boolean {
  // Same normalisation as independence: an approver who differs from the
  // proposer only by a homoglyph or an invisible character is the proposer,
  // and must not escape the "approved by their own author" section.
  const proposer = normaliseActor(entry.proposedBy);
  const approver = normaliseActor(entry.approvedBy);
  // Fails closed in the OTHER direction: an approver whose identity cannot be
  // compared with confidence is treated as possibly the proposer, so the entry
  // is surfaced rather than quietly accepted as independently approved.
  if (!actorIdentityIsComparable(entry.approvedBy)) return true;
  return proposer !== '' && proposer === approver;
}

/* ------------------------------------------------------------- promotion */

export interface RelayPromotionProposal {
  readonly entryId: string;
  readonly statement: string;
  readonly source: RelayMemorySource;
  readonly citation: string;
  readonly proposedBy: string;
  /** Every short-term entry this proposal rests on. */
  readonly basis: readonly string[];
  /** ISO-8601. */
  readonly proposedAt: string;
}

/**
 * Turn a short-term observation into a PROPOSAL to remember it durably.
 *
 * Returns a proposal, never a `RelayLongTermEntry`. There is deliberately no
 * function in this module that produces an approved entry: approval arrives
 * from the existing Project Brain approval flow, performed by a human, and a
 * module that could mint one would make that flow optional.
 */
export function proposePromotion(input: {
  readonly entry: RelayShortTermEntry;
  readonly statement: string;
  readonly source: RelayMemorySource;
  readonly citation: string;
  readonly proposedBy: string;
  readonly proposedAt: string;
  readonly supporting?: readonly RelayShortTermEntry[];
}): RelayPromotionProposal {
  const basis = [input.entry, ...(input.supporting ?? [])].map((e) => e.entryId);
  return {
    entryId: input.entry.entryId,
    statement: input.statement,
    source: input.source,
    citation: input.citation,
    proposedBy: input.proposedBy,
    basis: [...new Set(basis)],
    proposedAt: input.proposedAt,
  };
}

/* -------------------------------------------------- the documentation view */

/**
 * How long a generated Project Brain document stays fresh.
 *
 * "Continuously refreshed documentation" is a promise about staleness, and a
 * promise about staleness needs a number and an observed timestamp, or it is a
 * word in a README.
 */
export const BRAIN_DOC_STALE_AFTER_MS = 60 * 60 * 1000;

export interface RelayBrainDocument {
  readonly projectId: string;
  /** ISO-8601 instant this document was generated for. */
  readonly generatedAt: string;
  readonly longTermEntries: number;
  readonly selfApprovedEntries: number;
  readonly shortTermEntries: number;
  readonly shortTermEvicted: number;
  readonly pendingProposals: number;
  /** ISO-8601 of the newest input, or null when there was none. */
  readonly newestInputAt: string | null;
  /** True when the newest input is older than the freshness horizon. */
  readonly stale: boolean;
  /** Why it is stale, or why it is not. Always a sentence, never a bare flag. */
  readonly freshness: string;
  readonly sections: readonly RelayBrainDocumentSection[];
}

export interface RelayBrainDocumentSection {
  readonly heading: string;
  readonly lines: readonly string[];
}

/**
 * Regenerate the project's Brain documentation from current memory.
 *
 * It reports what it was generated FROM — counts and the newest input — so a
 * reader can tell a document about a busy project from a document about a
 * project nothing has reported on for a day. Those look identical when a
 * generator prints only its conclusions.
 */
export function refreshBrainDocument(input: {
  readonly projectId: string;
  readonly longTerm: readonly RelayLongTermEntry[];
  readonly shortTerm: RelayShortTermMemory;
  readonly proposals: readonly RelayPromotionProposal[];
  readonly generatedAt: string;
}): RelayBrainDocument {
  const timestamps = [
    ...input.longTerm.map((e) => e.approvedAt),
    ...input.shortTerm.entries.map((e) => e.observedAt),
    ...input.proposals.map((p) => p.proposedAt),
  ].filter((value) => Number.isFinite(Date.parse(value)));

  // Reduced on the INSTANT, as `ingest` already does. Comparing ISO strings
  // lexically picks `13:00:00+02:00` over `12:00:00Z`, which is an hour EARLIER
  // — and the document then reports a staleness that is simply wrong.
  const newestInputAt = timestamps.length === 0
    ? null
    : timestamps.reduce((newest, value) => (Date.parse(value) > Date.parse(newest) ? value : newest));

  const generatedMs = Date.parse(input.generatedAt);
  const newestMs = newestInputAt === null ? Number.NaN : Date.parse(newestInputAt);
  const ageKnown = Number.isFinite(generatedMs) && Number.isFinite(newestMs);
  const ageMs = ageKnown ? Math.max(0, generatedMs - newestMs) : Number.NaN;
  const stale = !ageKnown || ageMs > BRAIN_DOC_STALE_AFTER_MS;

  const selfApproved = input.longTerm.filter(isSelfApproved);

  const freshness = newestInputAt === null
    ? 'Nothing has been recorded for this project, so this document states nothing.'
    : !ageKnown
      ? 'A timestamp could not be read, so freshness is unknown.'
      : stale
        ? `The newest input is ${Math.floor(ageMs / 60000)} minutes old.`
        : `Generated from input ${Math.floor(ageMs / 1000)} seconds old.`;

  const sections: RelayBrainDocumentSection[] = [
    {
      heading: 'WHAT THIS PROJECT KNOWS',
      lines: input.longTerm.length === 0
        ? ['Nothing has been approved into long-term memory yet.']
        : input.longTerm.map((e) => `${e.statement}  [${e.source}: ${e.citation}]`),
    },
    {
      heading: 'RECENTLY OBSERVED',
      lines: input.shortTerm.entries.length === 0
        ? ['No observations in short-term memory.']
        : [
          ...input.shortTerm.entries.map((e) => `${e.observedAt}  ${e.kind}: ${e.summary}`),
          ...(input.shortTerm.evicted > 0
            // Said out loud: a buffer that silently drops the older half is a
            // surface describing itself and calling it the project's history.
            ? [`${input.shortTerm.evicted} older observation(s) have been evicted.`]
            : []),
        ],
    },
    {
      heading: 'AWAITING APPROVAL',
      lines: input.proposals.length === 0
        ? ['Nothing is proposed for long-term memory.']
        : input.proposals.map((p) => `${p.statement}  [proposed by ${p.proposedBy}]`),
    },
  ];

  if (selfApproved.length > 0) {
    // Surfaced rather than filtered: the entries exist and are being used, and
    // hiding them would make the Brain look better than it is.
    sections.push({
      heading: 'APPROVED BY THEIR OWN AUTHOR',
      lines: selfApproved.map((e) => `${e.statement}  [${e.approvedBy} approved their own entry]`),
    });
  }

  return {
    projectId: input.projectId,
    generatedAt: input.generatedAt,
    longTermEntries: input.longTerm.length,
    selfApprovedEntries: selfApproved.length,
    shortTermEntries: input.shortTerm.entries.length,
    shortTermEvicted: input.shortTerm.evicted,
    pendingProposals: input.proposals.length,
    newestInputAt,
    stale,
    freshness,
    sections,
  };
}
