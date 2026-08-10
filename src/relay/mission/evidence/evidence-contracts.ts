import type { LiveReachAttempt, LiveReachCapability, LiveReachSource } from '../live-reach';

/**
 * EVIDENCE — what Relay OBSERVED, kept separate from what a model remembers.
 *
 * A retrieved observation enters Relay as an EvidenceArtifact and never as
 * text in an agent's context. The difference is the whole point: an artifact
 * carries where it came from, when it was published, when Relay fetched it,
 * which backend actually served it, and whether it contains anything that
 * looks like an instruction. A paragraph pasted into a prompt carries none of
 * that, and the agent cannot tell it from something the founder said.
 *
 * THREE KINDS OF KNOWING, deliberately not collapsed:
 *
 *   MODEL KNOWLEDGE      what the model was trained on. Not evidence, and not
 *                        recorded here.
 *   LIVE OBSERVATION     this file. Attributable, timestamped, and provisional.
 *   DURABLE PROJECT      the Project Brain. Approved, and about THIS project.
 *
 * The Brain may hold a durable REFERENCE to an artifact. It does not absorb
 * the artifact's claims, because a thing being observed is not a thing being
 * true.
 *
 * PURE. No Node, no network, no clock. Sanitization runs in the composition
 * root — the domain declares the shape it needs and the caller supplies it,
 * which is the same inversion the connectors already use, and it is why this
 * module can name `injectionSignals` without importing the scanner.
 */

/* ---------------------------------------------------------- freshness */

/**
 * How old the INFORMATION is, which is not how recently Relay fetched it.
 *
 * The distinction the direction insists on: a social post published twelve
 * minutes ago and a manual published eighteen months ago are equally "just
 * retrieved" and are not equally current. Age is measured from publication.
 */
export const EVIDENCE_FRESHNESS = ['live', 'recent', 'dated', 'stale', 'unknown'] as const;
export type EvidenceFreshness = (typeof EVIDENCE_FRESHNESS)[number];

export const EVIDENCE_FRESHNESS_LABEL: Readonly<Record<EvidenceFreshness, string>> =
  Object.freeze({
    live: 'LIVE',
    recent: 'RECENT',
    dated: 'DATED',
    stale: 'STALE',
    unknown: 'PUBLICATION TIME UNKNOWN',
  });

/** Bucket boundaries, in minutes. Stated once so a surface cannot invent its own. */
const FRESHNESS_BOUNDS = Object.freeze({ live: 60, recent: 60 * 24, dated: 60 * 24 * 30 });

export interface EvidenceAge {
  /** Minutes between publication and retrieval. Null when publication is unknown. */
  readonly minutes: number | null;
  readonly freshness: EvidenceFreshness;
}

/**
 * How old this information was when Relay saw it.
 *
 * UNKNOWN PUBLICATION STAYS UNKNOWN. A source that does not say when it
 * published is not a source that published now, and substituting the retrieval
 * time would turn every scraped page into breaking news. A publication time in
 * the future is also unknown rather than negative: a clock disagreed, and
 * guessing which one is wrong is not this function's business.
 */
export function evidenceAge(publishedAt: string | null, retrievedAt: string): EvidenceAge {
  if (publishedAt === null || publishedAt === '') return { minutes: null, freshness: 'unknown' };
  const published = Date.parse(publishedAt);
  const retrieved = Date.parse(retrievedAt);
  if (Number.isNaN(published) || Number.isNaN(retrieved)) {
    return { minutes: null, freshness: 'unknown' };
  }
  const minutes = Math.round((retrieved - published) / 60000);
  if (minutes < 0) return { minutes: null, freshness: 'unknown' };
  const freshness: EvidenceFreshness = minutes <= FRESHNESS_BOUNDS.live
    ? 'live'
    : minutes <= FRESHNESS_BOUNDS.recent
      ? 'recent'
      : minutes <= FRESHNESS_BOUNDS.dated
        ? 'dated'
        : 'stale';
  return { minutes, freshness };
}

/* ---------------------------------------------------------- authority */

/**
 * How much weight a source class carries on its own subject.
 *
 * `primary` is the thing itself — a project's own release, a vendor's own
 * documentation. `secondary` reports on it. `community` is people discussing
 * it. All three are worth keeping; only the ordering is claimed.
 *
 * SOCIAL POPULARITY IS NOT AUTHORITY. A thousand people saying a feature still
 * works do not outrank the release notes that removed it. `outranks` encodes
 * exactly that and nothing more — it never decides who is CORRECT, only whose
 * account of its own subject carries more weight when they disagree.
 */
export const EVIDENCE_AUTHORITY = ['primary', 'secondary', 'community', 'unknown'] as const;
export type EvidenceAuthority = (typeof EVIDENCE_AUTHORITY)[number];

const AUTHORITY_RANK: Readonly<Record<EvidenceAuthority, number>> = Object.freeze({
  primary: 3, secondary: 2, community: 1, unknown: 0,
});

export function outranks(a: EvidenceAuthority, b: EvidenceAuthority): boolean {
  return AUTHORITY_RANK[a] > AUTHORITY_RANK[b];
}

/* --------------------------------------------------------- the record */

export const EVIDENCE_SANITIZATION = ['clean', 'redacted', 'truncated', 'redacted_and_truncated'] as const;
export type EvidenceSanitization = (typeof EVIDENCE_SANITIZATION)[number];

export interface EvidenceArtifact {
  readonly evidenceId: string;
  readonly missionId: string;
  readonly projectId: string;

  /** Where it came from. */
  readonly source: LiveReachSource;
  readonly capability: LiveReachCapability;
  /** A URL or a stable source-native identifier. Shown, and re-fetchable. */
  readonly reference: string;
  readonly title: string | null;
  /** Public author, account or channel. Null when the source does not say. */
  readonly author: string | null;

  /** When the SOURCE says it was published. Null is a real answer. */
  readonly publishedAt: string | null;
  /** When Relay fetched it. Always known, because Relay was there. */
  readonly retrievedAt: string;
  readonly age: EvidenceAge;

  /** What was asked, when there was a query. */
  readonly query: string | null;

  /**
   * The observation itself, ALREADY sanitized by the caller.
   *
   * It is data. Nothing in it is an instruction to any agent, whatever it
   * says — see `renderForPrompt`, which is the only sanctioned way to put an
   * artifact in front of a model.
   */
  readonly content: string;
  /**
   * A change-detection fingerprint of the content.
   *
   * NOT a cryptographic hash and never described as one: it exists so a later
   * retrieval of the same reference can be compared to this one. Anything
   * security-bearing must use a real digest in the composition root.
   */
  readonly contentFingerprint: string;
  readonly sanitization: EvidenceSanitization;
  /**
   * Phrases in the content that resemble instructions to an agent.
   *
   * Recorded so a Reviewer or an operator can see that hostile text was
   * present. Their presence changes nothing about the artifact's authority,
   * because it never had any.
   */
  readonly injectionSignals: readonly string[];

  readonly authority: EvidenceAuthority;
  /** Which backend was asked for, which one ran, and whether it fell back. */
  readonly attempt: LiveReachAttempt;
  /** Whatever Relay does not know about this observation, said plainly. */
  readonly uncertainty: readonly string[];
}

/* ------------------------------------------------------------- packs */

/**
 * Several artifacts gathered for one question, with their disagreements kept.
 *
 * CONFLICTS ARE PRESERVED, NOT RESOLVED. When the release notes and the forum
 * disagree, a pack holds both and says they disagree. Deciding is the Prompt
 * Architect's or the Reviewer's job, on the record, with the evidence in front
 * of them — not a silent choice made while assembling a list.
 */
export interface EvidenceConflict {
  /** What the sources disagree about, in one sentence. */
  readonly about: string;
  readonly evidenceIds: readonly string[];
  /** The highest authority present among them, for a reader in a hurry. */
  readonly highestAuthority: EvidenceAuthority;
}

export interface EvidencePack {
  readonly packId: string;
  readonly missionId: string;
  readonly projectId: string;
  readonly purpose: string;
  readonly assembledAt: string;
  readonly artifacts: readonly EvidenceArtifact[];
  readonly conflicts: readonly EvidenceConflict[];
  /** The freshest publication in the pack, or null when none is dated. */
  readonly newestPublishedAt: string | null;
}

/* ------------------------------------------------------- fingerprint */

/**
 * FNV-1a over the content. Deterministic, fast, and honest about its purpose.
 *
 * A domain module has no crypto and should not pretend otherwise. This detects
 * "the page changed", which is what a re-fetch comparison needs.
 */
export function contentFingerprint(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, '0')}`;
}
