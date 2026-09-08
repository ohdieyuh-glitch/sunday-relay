/**
 * Type declarations for the Wonderland Beta Gate.
 *
 * Authored as plain `.mjs` on purpose: an operator runs it with `node` and no
 * build step, and the TypeScript tests import the SAME function, so there is
 * exactly one implementation of the verdict rule.
 */

/**
 * The four answers. `CAPABILITY PROVEN` exists because a flawless mission never
 * crashes and so never exercises recovery; without it the gate must either call
 * a proven capability unproven or demand that a healthy run break itself.
 */
export type BetaVerdict = 'PASS' | 'CAPABILITY PROVEN' | 'FAIL' | 'NOT BUILT';

/** WHAT DID THIS RUN PROVE? Read only from the mission's own durable rows. */
export type BetaMissionProof = 'EXERCISED' | 'FAILED' | 'NOT EXERCISED' | 'UNKNOWN' | 'NOT BUILT';

/**
 * WHAT IS JULIUS READY TO DO? Read only from a recorded drill attestation.
 * `STALE` means a drill proved it once and the code it drove has changed since.
 * `NOT ADMISSIBLE` marks a capability a mission must walk itself, where no
 * drill may stand in however well it ran.
 */
export type BetaCapabilityProof = 'PROVEN' | 'STALE' | 'UNPROVEN' | 'NOT ADMISSIBLE' | 'NOT BUILT';

export interface BetaCapabilityResult {
  readonly id: string;
  /** True when the capability sits on the creation path to VERIFIED COMPLETION. */
  readonly path: boolean;
  /** True when only the mission itself may prove it — no drill is admissible. */
  readonly missionRequired: boolean;
  /**
   * The production files this row is built on. A drill attestation must name
   * every one of them to cover this capability, so the gate publishes the list
   * rather than leaving a drill author to read it out of the gate's source.
   */
  readonly implementedBy: readonly string[];
  readonly verdict: BetaVerdict;
  readonly mission: BetaMissionProof;
  readonly capability: BetaCapabilityProof;
  /** The evidence the verdict was read from, never a summary of intent. */
  readonly basis: string;
  /** Why the capability axis answered as it did, drill by drill. */
  readonly capabilityBasis: string;
}

export interface BetaGateSummary {
  readonly total: number;
  /** WHAT THIS RUN PROVED, four disjoint counts over the mission axis. */
  readonly exercised: number;
  readonly failed: number;
  readonly notExercised: number;
  readonly unknown: number;
  /** WHAT JULIUS IS READY TO DO, four disjoint counts over the verdict. */
  readonly provenByMission: number;
  readonly provenByDrill: number;
  readonly unproven: number;
  readonly notBuilt: number;
}

export interface BetaGateReport {
  /** The evidence bundle actually read, or null when none was supplied or found. */
  readonly evidence: string | null;
  readonly evidenceNote: string | null;
  /** Where an admissible-looking drill ledger was read from, or null. */
  readonly capabilitySource: string | null;
  readonly results: readonly BetaCapabilityResult[];
  /** At most three, creation-path capabilities first, in declared order. */
  readonly gaps: readonly BetaCapabilityResult[];
  readonly summary: BetaGateSummary;
}

export interface BetaGateOptions {
  /**
   * A directory holding `capability-proofs.tsv` and its transcripts, when they
   * did not travel inside the evidence bundle. Omitted, the bundle is searched.
   */
  readonly capabilityDir?: string | null;
}

/**
 * Evaluate every capability against the repository, one live mission evidence
 * bundle and any recorded drill attestations. Passing `null` is the no-evidence
 * case, in which no runtime capability can reach PASS — and no drill ledger
 * alone can lift one past FAIL either, because a capability proof is admissible
 * only where the mission is silent, never where it failed.
 */
export declare function evaluate(evidenceDir: string | null, options?: BetaGateOptions): BetaGateReport;
