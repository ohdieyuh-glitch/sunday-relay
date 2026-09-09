import type { JuliusBrainEntry } from '../mission/julius';

/**
 * THE TWO PROJECT BRAIN VOCABULARIES, AND THE MAP BETWEEN THEM.
 *
 * The domain and the database do not agree on what an entry can be, and until
 * now only one direction of that disagreement was handled.
 *
 *   domain   `JuliusBrainEntry['kind']` — OBJECTIVE, REQUIREMENT, CONSTRAINT,
 *            DECISION, FINDING, REPAIR, HANDOFF, ARTIFACT, EVIDENCE
 *   stored   migration 014's CHECK — DECISION, FINDING, REPAIR, ARTIFACT,
 *            CONSTRAINT, RESEARCH_NOTE, HANDOFF, ACCEPTANCE_UPDATE
 *
 * `fromStored` is the READ direction and already existed, inline in
 * `julius-read-postgres.ts`. `toStored` is the WRITE direction and did not
 * exist at all, because nothing wrote: `julius_brain_entries` had exactly one
 * writer, the bootstrap seed, which sidesteps the question by hand — it emits
 * only CONSTRAINT and ACCEPTANCE_UPDATE and never the OBJECTIVE or REQUIREMENT
 * the domain would call them.
 *
 * WHY THAT MATTERED BEFORE ANYONE HAD WRITTEN A LINE. A writer that persisted a
 * domain entry directly would pass every in-memory test — `OBJECTIVE` is used
 * in `julius-runtime.test.ts` and `julius-compound-agent.e2e.test.ts` today —
 * and be rejected by PostgreSQL's CHECK constraint the first time it met a real
 * database, inside a paid mission. OBJECTIVE, REQUIREMENT and EVIDENCE are the
 * three that would have failed.
 *
 * `toStored` IS THE BOOTSTRAP'S OWN CHOICES, not new ones: it stores the
 * objective as CONSTRAINT and a requirement as ACCEPTANCE_UPDATE because
 * `relay-bridge/julius/mission-seed.ts` already does, and it stores EVIDENCE as
 * ARTIFACT because that is what `fromStored` already does with a kind it cannot
 * classify. Nothing here invents a third convention.
 *
 * Both directions live in ONE file so they can be tested as a pair, against the
 * migration's own CHECK list read out of the SQL. A mapping proven only against
 * a typed-out copy of that list is a mapping proven against nothing.
 */

/** Exactly the values migration 014's CHECK constraint admits. */
export const STORED_BRAIN_KINDS = Object.freeze([
  'DECISION', 'FINDING', 'REPAIR', 'ARTIFACT',
  'CONSTRAINT', 'RESEARCH_NOTE', 'HANDOFF', 'ACCEPTANCE_UPDATE',
] as const);

export type StoredBrainKind = typeof STORED_BRAIN_KINDS[number];

/**
 * A stored kind as the context compiler's vocabulary. Unrecognised kinds are
 * carried as ARTIFACT rather than dropped, because an entry the compiler cannot
 * classify is still context a worker may need.
 */
export function brainKindFromStored(stored: string): JuliusBrainEntry['kind'] {
  switch (stored) {
    case 'DECISION': return 'DECISION';
    case 'FINDING': return 'FINDING';
    case 'REPAIR': return 'REPAIR';
    case 'HANDOFF': return 'HANDOFF';
    case 'CONSTRAINT': return 'CONSTRAINT';
    case 'ACCEPTANCE_UPDATE': return 'REQUIREMENT';
    default: return 'ARTIFACT';
  }
}

/**
 * A domain kind as something the database will accept. Total by construction:
 * every member of the domain union has a case, so a kind added to the union
 * stops this file compiling instead of reaching a CHECK constraint at run time.
 */
export function brainKindToStored(kind: JuliusBrainEntry['kind']): StoredBrainKind {
  switch (kind) {
    case 'DECISION': return 'DECISION';
    case 'FINDING': return 'FINDING';
    case 'REPAIR': return 'REPAIR';
    case 'HANDOFF': return 'HANDOFF';
    case 'CONSTRAINT': return 'CONSTRAINT';
    case 'ARTIFACT': return 'ARTIFACT';
    // The bootstrap's own choices, kept rather than re-decided.
    case 'REQUIREMENT': return 'ACCEPTANCE_UPDATE';
    case 'OBJECTIVE': return 'CONSTRAINT';
    // `fromStored` already answers ARTIFACT for anything it cannot classify.
    case 'EVIDENCE': return 'ARTIFACT';
  }
}
