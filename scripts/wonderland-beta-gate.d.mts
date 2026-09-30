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

/**
 * WHETHER THE BUNDLE IS TIED TO THIS CHECKOUT. Bound only when its
 * `bundle-manifest.txt` names the commit being read, `mode=paid`, and one run
 * `runs.tsv` holds, and every table the gate reads carries `run_id`. An unbound
 * bundle keeps its failures; nothing it did can PASS, and no drill stands in.
 */
export interface BetaGateBinding {
  readonly bound: boolean;
  /** Why the bundle is unbound, or null when it is bound. */
  readonly reason: string | null;
  /** The one Julius run every table was scoped to, or null when none was named. */
  readonly runId: string | null;
  readonly runState: string | null;
  /** The commit the manifest says produced the bundle, and the one reading it. */
  readonly commit: string | null;
  readonly readingCommit: string | null;
  readonly mode: string | null;
  readonly workflowRunId: string | null;
}

export interface BetaGateReport {
  /** The evidence bundle actually read, or null when none was supplied or found. */
  readonly evidence: string | null;
  readonly evidenceNote: string | null;
  /** Where an admissible-looking drill ledger was read from, or null. */
  readonly capabilitySource: string | null;
  readonly binding: BetaGateBinding;
  readonly results: readonly BetaCapabilityResult[];
  /** At most three, creation-path capabilities first, in declared order. */
  readonly gaps: readonly BetaCapabilityResult[];
  readonly summary: BetaGateSummary;
}

/**
 * The columns a drill attestation is written with. Exported so a drill writes
 * the ledger the gate reads, rather than the two agreeing by hand — which is
 * how two free dry runs shipped `unavailable` for tables whose column names had
 * drifted apart.
 */
export declare const CAPABILITY_PROOF_COLUMNS: readonly string[];

/** The provenance file the evidence dump writes first, which binds a bundle to a commit, a mode and a run. */
export declare const BUNDLE_MANIFEST: string;

/** Tokens that name a stand-in rather than a provider — every drill, fake and stub in this repository uses one. */
export declare const NOT_A_PROVIDER_TOKENS: readonly string[];

/** The participant id GitHub sign-in mints (`ghu-<id>`): the only account this repository creates. */
export declare const ACCOUNT_PARTICIPANT_ID: RegExp;

/** Where the live identities are read from: the composition, the launchers that set the reviewer's provider, the runtime's transport enum. */
export declare const LIVE_COMPOSITION: string;
export declare const LIVE_LAUNCHERS: readonly string[];
export declare const RUNTIME_TRANSPORTS: string;

/** The evidence dump whose queries decide which bundle files have a producer. */
export declare const EVIDENCE_DUMP: string;

/** One role's live identity: the worker and adapter the composition declares, and the providers it routes the role to. */
export interface LiveRoleIdentity {
  readonly workerId: string;
  readonly adapterId: string;
  readonly providers: readonly string[];
}

/**
 * The allowlist a task's provider identity is held to, read from this checkout's
 * live composition — or why it cannot be read, in which case no role is credited.
 */
export declare function liveIdentities():
  | { readonly roles: Readonly<Record<'PROMPT_ARCHITECT' | 'CODING_AGENT' | 'INDEPENDENT_REVIEWER', LiveRoleIdentity>>; readonly transports: readonly string[] }
  | { readonly error: string };

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
 * alone can lift one past FAIL either, because a capability proof stands in
 * only where a bound mission's readable rows show the behaviour genuinely did
 * not happen: never where it failed, and never where the bundle cannot say.
 * The capability AXIS still reads PROVEN for a current drill, which is what
 * `julius-real-infra` checks after its drills run.
 */
export declare function evaluate(evidenceDir: string | null, options?: BetaGateOptions): BetaGateReport;
