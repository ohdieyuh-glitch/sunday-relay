import { deriveJuliusContextQualification } from './julius-context-provenance';
import type { JuliusOperationalEvent } from './julius-events';
import type { JuliusFindingLife } from './julius-finding-lifecycle';
import { promoteJuliusMemoryClaim, type JuliusMemoryClaim, type JuliusMemoryEvidenceRef } from './julius-memory-trust';
import type { JuliusBrainEntry, JuliusContextQualification } from './julius-runtime';
import type { JuliusBrainAppend } from './julius-runtime-ports';
import type { JuliusReviewerFinding } from './julius-verification-runtime';

/**
 * THE CLAIM LEDGER — how a brain entry becomes a claim, how a claim earns a
 * standing, and how a recorded standing reaches the packet.
 *
 * THE MINIMUM, AND WHY IT IS THE MINIMUM. The founder's rule for the claim
 * store was "only what context integrity, durable knowledge, evidence,
 * continuity and truthful reuse need; no contradiction graphs, no lineage
 * inference". Three things meet that bar and nothing else does:
 *
 *   1. ADMISSION. Every brain entry the runtime writes gets a claim, with the
 *      standing the derivation already gave it — the same rule
 *      (`deriveJuliusContextQualification`), so a durable claim and a derived
 *      one can never disagree at birth. One definition of a standing.
 *   2. PROMOTION ON REVIEW. When an Independent Reviewer's review is ACCEPTED,
 *      the claims for the entries the reviewed task WROTE are promoted to
 *      VERIFIED on the review's evidence, through the trust core — which is
 *      what refuses self-verification (a reviewer that is the asserter), an
 *      APPROVED or terminal claim, and evidence of the wrong kind. The link is
 *      the task id on the entry, which the runtime knows; nothing is inferred
 *      from text.
 *   3. THE RECORD WINS. At compile time a recorded standing replaces the
 *      derived one for the same claim, because a recorded standing is a fact
 *      with a history and a derived one is a rule applied to a row. An entry
 *      with no recorded claim — a bootstrap seed, an older run — keeps its
 *      derived standing, so nothing that compiled before this existed
 *      compiles differently now.
 *
 * WHAT IS DELIBERATELY ABSENT. No writer asserts `supersedes` or
 * `contradicts` here: the runtime does not know that two entries disagree,
 * and guessing it from text is the poisoning failure with extra steps. The
 * fail-closed clash path therefore stays reachable through its seam until an
 * asserter exists — the readiness page says so, and so does this file.
 *
 * PURE. No clock, no store, no Node: time arrives as ISO strings, claims and
 * entries arrive as values, and every function returns new values. (The type
 * imports above are erased; nothing here loads a module with side effects.)
 */

export const JULIUS_CLAIM_LEDGER_VERSION = 'julius-claim-ledger.v1' as const;

/** The claim id a brain entry's claim carries — the derivation's own naming. */
export const juliusClaimIdFor = (entryId: string): string => `claim:${entryId}`;

/**
 * WHAT MAKES TWO STANDINGS THE SAME STANDING. Both stores compare an append
 * against the latest row with this, so a replayed append writes no second
 * row in either — one definition, or the two stores would drift on replay.
 */
export const juliusClaimStandingKey = (claim: JuliusMemoryClaim): string => JSON.stringify([
  claim.trust, claim.provenance, claim.assertedBy, claim.assertedAt,
  claim.evidence.map((reference) => [reference.kind, reference.id]),
  claim.supersedes, [...claim.contradicts],
]);

/**
 * THE CLAIM AN APPEND ADMITS: the derivation applied to the entry as it will be
 * read back, so the durable claim is the derived claim and not a second opinion.
 */
export function juliusAdmittedClaimFor(append: JuliusBrainAppend): JuliusMemoryClaim {
  const entry: JuliusBrainEntry = {
    entryId: append.entryId,
    kind: append.kind,
    text: append.safeText,
    taskIds: append.taskId === null ? [] : [append.taskId],
    allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'],
    sensitivity: 'INTERNAL',
    provenance: { workerId: append.workerId, recordedAt: append.occurredAt, evidenceIds: append.evidenceIds },
  };
  const derived = deriveJuliusContextQualification([entry]).claims[0];
  if (derived === undefined) throw new Error('julius_claim_derivation_empty');
  return derived;
}

export interface JuliusClaimPromotion {
  readonly claim: JuliusMemoryClaim;
  readonly from: JuliusMemoryClaim['trust'];
}

export interface JuliusClaimPromotionRefusal {
  readonly claimId: string;
  readonly reasonCode: string;
}

/**
 * WHAT AN ACCEPTED REVIEW PROMOTES.
 *
 * The candidates are the current claims whose entries name the reviewed task;
 * the authority is the reviewer; the evidence is the review's own rows, as
 * REVIEW references. Each candidate goes through `promoteJuliusMemoryClaim`,
 * which decides — and a refusal is returned by name rather than dropped, so a
 * reviewer that turns out to be the asserter, or a review with no evidence, is
 * visible in the record instead of silently promoting nothing.
 *
 * VERIFIED is the ceiling here: APPROVED needs a DECISION reference, and a
 * review is not a decision. A claim already at or above VERIFIED is skipped
 * rather than refused — there is nothing to record.
 */
export function juliusClaimPromotionsOnAccept(input: {
  readonly claims: readonly JuliusMemoryClaim[];
  readonly entries: readonly JuliusBrainEntry[];
  readonly subjectTaskId: string;
  readonly by: string;
  readonly reviewEvidenceIds: readonly string[];
  readonly at: string;
}): { readonly promoted: readonly JuliusClaimPromotion[]; readonly refused: readonly JuliusClaimPromotionRefusal[] } {
  const entryTaskIds = new Map(input.entries.map((entry) => [entry.entryId, entry.taskIds] as const));
  const evidence: readonly JuliusMemoryEvidenceRef[] = input.reviewEvidenceIds.map((id) => ({ kind: 'REVIEW' as const, id }));
  const promoted: JuliusClaimPromotion[] = [];
  const refused: JuliusClaimPromotionRefusal[] = [];
  for (const claim of input.claims) {
    if (!(entryTaskIds.get(claim.entryId) ?? []).includes(input.subjectTaskId)) continue;
    if (claim.trust !== 'UNVERIFIED' && claim.trust !== 'SUPPORTED') continue;
    const outcome = promoteJuliusMemoryClaim(claim, { to: 'VERIFIED', by: input.by, evidence, at: input.at });
    if (outcome.outcome === 'OK') promoted.push({ claim: outcome.claim, from: claim.trust });
    else refused.push({ claimId: claim.claimId, reasonCode: outcome.reasonCode });
  }
  return { promoted: Object.freeze(promoted), refused: Object.freeze(refused) };
}

/**
 * A PIECE OF KNOWLEDGE ONE MISSION VERIFIED AND ANOTHER MAY REUSE.
 *
 * The claim (its standing, its asserter, the evidence it was verified on) and
 * the brain row it is about, plus the run that earned it — which the carried
 * copy records, so a reader of mission B can always ask where a fact came from.
 * Since the corrected carry (below) this shape is used for the one carried
 * source that HAS a brain row and a recorded standing: the accepted
 * architecture. A carried finding has neither in its source run; its copy's
 * standing is derived (`juliusCarriedFindingClaim`).
 */
export interface JuliusCarriedKnowledge {
  readonly sourceRunId: string;
  readonly claim: JuliusMemoryClaim;
  readonly entry: {
    readonly entryId: string;
    readonly kind: JuliusBrainEntry['kind'];
    readonly text: string;
    readonly evidenceIds: readonly string[];
  };
}

/**
 * The SOURCE half of a carried copy's id: where it came from. Kept for the
 * readers that name it (`python/.../history.py` reads the `carried:` prefix;
 * fixtures build ids with it). On its own it is NOT unique: `entry_id` is one
 * key across every run the database holds, so the second run to inherit the
 * same source row would collide with the first and silently inherit nothing —
 * the `brain:architecture:r1` defect again. The carry writes `juliusCarriedCopyId`.
 */
export const juliusCarriedEntryId = (sourceRunId: string, entryId: string): string =>
  `carried:${sourceRunId}:${entryId}`;

/** The id a carried copy is WRITTEN under: the source, and the run that inherits it. Unique per inheriting run, stable on replay. */
export const juliusCarriedCopyId = (targetRunId: string, sourceRunId: string, sourceRef: string): string =>
  `${juliusCarriedEntryId(sourceRunId, sourceRef)}:into:${targetRunId}`;

/** Whether a brain entry is a carried copy. A copy is never itself a source of a later carry. */
export const isJuliusCarriedEntryId = (entryId: string): boolean => entryId.startsWith('carried:');

/**
 * THE CARRIED COPY'S CLAIM: the same standing, the same asserter, the same
 * evidence — about the new entry id, with the source recorded as the reason.
 *
 * WHY THE STANDING TRAVELS. A reviewer in mission A verified this; re-deriving
 * the copy's standing from its kind would silently demote it to an assertion and
 * mission B would rank a verified fact as a guess. Carrying it is not a
 * promotion — nobody is verifying anything here — it is the same claim, about a
 * copy, and `assertedBy` still names whoever asserted it in A, which is what
 * keeps self-verification impossible in B too.
 */
export function juliusCarriedClaim(carried: JuliusCarriedKnowledge): JuliusMemoryClaim {
  return {
    ...carried.claim,
    claimId: juliusClaimIdFor(juliusCarriedEntryId(carried.sourceRunId, carried.entry.entryId)),
    entryId: juliusCarriedEntryId(carried.sourceRunId, carried.entry.entryId),
  };
}

/**
 * THE RECORD WINS. For every derived claim that has a recorded standing, the
 * recorded claim is used — trust, evidence, lineage and all. Everything else in
 * the qualification (context types, recorded-at, the contract set) is the
 * derivation's, because those are read off the entry and not off the standing.
 */
export function mergeJuliusDurableStanding(
  qualification: JuliusContextQualification,
  recorded: readonly JuliusMemoryClaim[],
): JuliusContextQualification {
  if (recorded.length === 0) return qualification;
  const byId = new Map(recorded.map((claim) => [claim.claimId, claim] as const));
  return {
    ...qualification,
    claims: qualification.claims.map((claim) => byId.get(claim.claimId) ?? claim),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE CARRY, CORRECTED (founder ruling 2026-10-04, R1 and R3).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT WAS WRONG. The first carry handed a new run every claim of the
 * project's other runs whose standing read VERIFIED or APPROVED. A DECISION
 * entry is APPROVED BY ITS KIND (`julius-context-provenance.ts`), so that meant
 * every verification verdict about some other run's task ("REPAIR
 * (BLOCKING_FINDINGS): Verification requires repair.") and the architecture an
 * architect PROPOSED and nobody accepted arrived in the next run as approved
 * instructions — RUN-WIDE, for all three roles, because the copy's task was
 * nulled — from any mission of the project. The one thing worth carrying, the
 * reviewer's actual finding, never travelled at all: findings live in
 * `julius_reviewer_findings`, not in the brain.
 *
 * WHAT TRAVELS NOW: ONE SOURCE, A CLOSED LIST, DECIDED FROM DURABLE STATE.
 *
 *   VERIFIED_REPAIR_FINDING  a reviewer finding that was BLOCKING, cites
 *                            evidence, was ADDRESSED by a repair, and that an
 *                            independent re-review then RESOLVED — the
 *                            finding's own lifecycle folded from the source
 *                            run's ledger (`foldJuliusFindings`), never the
 *                            row's stored status and never its text.
 *
 * THE DESIGN DOES NOT TRAVEL (Decision C; SECOND's carry ruling (b), 1ee86fc5).
 * Draft r1 also carried the design in force when the newest COMPLETED source
 * run ended. The two arms of the learning experiment must differ by the
 * verified repair finding and by nothing else, and a design beside it could
 * change the plan for reasons unrelated to the reviewer's lesson. Nor is "in
 * force" the same as "accepted": a first revision is in force by default. So
 * every design is still classified, and the one in force is excluded by its
 * own name (`architecture_not_a_source`), like every other row left behind.
 *
 * Everything else a source run holds is excluded BY NAME
 * (`JULIUS_CARRY_EXCLUSIONS`) and every exclusion is recorded: a verdict
 * mirror, a proposal, a superseded revision, a handoff an accepted review
 * promoted, a copy of a copy, a finding nobody resolved. Adding a source is a
 * reviewed change to this list, as adding a lineage family is.
 *
 * WHICH RUNS ARE SOURCES is the caller's SQL and is deliberately narrow: the
 * same project AND the same mission, never the run doing the carrying, newest
 * first, bounded (`JULIUS_CARRY_SOURCE_RUN_LIMIT`). A mission's own earlier
 * runs are the only structural relation the store holds; "related" by text is
 * not a relation this layer may invent.
 *
 * WHO RECEIVES IT: THE NEW RUN'S PLANNER, AND NOBODY ELSE. Every carried row is
 * scoped to the new run's `plan` task (the Prompt Architect) whatever its
 * source scope: a task-scoped finding stays task-scoped, and nothing is ever
 * widened. The plan is where an
 * earlier run's lessons are applied; what the planner adopts reaches the coder
 * and the reviewer through this run's own plan and its own accepted
 * architecture, which is the single design in force inside a run. The source
 * scope is kept on every copy (`sourceScope`, `sourceTaskId`), so the narrowing
 * is a recorded fact, not a silent one.
 *
 * WHERE IT CAME FROM TRAVELS WITH IT, in existing durable places and no new
 * column (so no migration): the entry id (`carried:<sourceRun>:<sourceRef>:into:<run>`, unique per
 * inheriting run — the old id was not, so a second heir silently got nothing;
 * `juliusCarriedCopyId`), the `task_id` column (the scope), the text's header
 * (source run and state, source task and type, the finding's severity,
 * category, criterion, reviewer, repair and resolving review), the standing's
 * reason (`CARRIED_FROM:<sourceRun>`) and the `knowledge.carried` event the
 * store writes in the same transaction as the rows.
 *
 * PURE. Its inputs are folded durable rows; it returns a plan the store writes.
 */

/** v3: the design is no longer a source. A v2 record may hold a carried design; a v3 record never does. */
export const JULIUS_KNOWLEDGE_CARRY_VERSION = 'julius-knowledge-carry.v3' as const;

/** How many earlier runs of a mission are read as sources. Newest first. */
export const JULIUS_CARRY_SOURCE_RUN_LIMIT = 8;

/** How many VERIFIED/APPROVED brain rows of the source runs are classified for the record. */
export const JULIUS_CARRY_CANDIDATE_LIMIT = 500;

/** A carried finding's claim text is cut here: a packet, not an archive. */
export const JULIUS_CARRIED_CLAIM_CHARS = 2_000;

/** The one thing a later run may inherit. A closed list. */
export const JULIUS_CARRY_SOURCES = ['VERIFIED_REPAIR_FINDING'] as const;
export type JuliusCarrySource = (typeof JULIUS_CARRY_SOURCES)[number];

/** Why a candidate did not travel. A closed vocabulary, recorded by count and by reference. */
export const JULIUS_CARRY_EXCLUSIONS = [
  // reviewer findings
  'finding_not_blocking', 'finding_uncited', 'finding_lifecycle_unreadable', 'finding_superseded',
  'finding_unresolved', 'finding_resolved_without_repair', 'finding_dismissed', 'finding_origin_unknown',
  // architecture: every design is named, and none travels
  'architecture_proposal', 'architecture_not_in_force', 'architecture_run_not_completed',
  'architecture_older_run', 'architecture_standing_not_approved', 'architecture_not_a_source',
  // everything else the first carry would have handed over
  'decision_mirror', 'task_scoped_entry', 'entry_kind_not_carried', 'carried_copy',
  // eligible, but beyond the packet's bound
  'over_limit',
] as const;
export type JuliusCarryExclusionReason = (typeof JULIUS_CARRY_EXCLUSIONS)[number];

/** Why a carry could not be decided or written. Recorded as the outcome, never thrown at the bootstrap. */
export const JULIUS_CARRY_FAILURES = ['carry_sources_unreadable', 'carry_write_failed'] as const;
export type JuliusCarryFailure = (typeof JULIUS_CARRY_FAILURES)[number];

/** Where a carried row is admitted in the new run. One shape: its plan task. */
export interface JuliusCarryScope {
  readonly taskId: string;
  readonly taskType: 'plan';
  readonly role: 'PROMPT_ARCHITECT';
}

/** A run of the same mission the carry may read, as `julius_runs` holds it. */
export interface JuliusCarrySourceRun {
  readonly runId: string;
  readonly state: string;
}

/** One finding row of a source run, with the life its ledger gives it and the work it judged. */
export interface JuliusCarryFindingCandidate {
  readonly runId: string;
  readonly finding: Pick<JuliusReviewerFinding,
    'findingId' | 'taskId' | 'reviewerWorkerId' | 'severity' | 'category' | 'claim' | 'criterionId' | 'evidenceIds' | 'blocking' | 'status' | 'createdAt'>;
  /** `foldJuliusFindings` over the source run's ledger; null when that ledger could not be read. */
  readonly life: Pick<JuliusFindingLife, 'originReviewTaskId' | 'state' | 'lastMove' | 'repairTaskIds' | 'resolutionReviewTaskId'> | null;
  /** The work the finding judged (`julius_tasks`); null when the row is not readable. */
  readonly task: { readonly taskType: string; readonly role: string } | null;
}

/** What a source run's ledger says is the design in force, if any. */
export interface JuliusCarryArchitectureFact {
  readonly runId: string;
  /** `juliusArchitectureEntryId(run, foldJuliusArchitecture(ledger).revision)`, or null when nothing is in force. */
  readonly inForceEntryId: string | null;
  readonly revision: number | null;
  readonly proposedByTaskId: string | null;
}

/** A brain row of a source run whose CURRENT standing is VERIFIED or APPROVED — what the first carry would have copied. */
export interface JuliusCarryBrainCandidate {
  readonly runId: string;
  readonly entryId: string;
  readonly kind: JuliusBrainEntry['kind'];
  readonly taskId: string | null;
  readonly workerId: string;
  readonly text: string;
  readonly evidenceIds: readonly string[];
  readonly claim: JuliusMemoryClaim;
}

/** One row the store will write into the new run, with everything the record needs to say where it came from. */
export interface JuliusCarryItem {
  readonly source: JuliusCarrySource;
  readonly sourceRunId: string;
  readonly sourceRunState: string;
  /** The finding id. */
  readonly sourceRef: string;
  readonly sourceTaskId: string | null;
  readonly sourceTaskType: string | null;
  /** How the source was scoped in its own run. The copy is always scoped to `scope`. */
  readonly sourceScope: 'TASK' | 'RUN';
  readonly entryId: string;
  readonly kind: 'FINDING' | 'DECISION';
  /** The copy keeps its author: the reviewer who raised the finding. */
  readonly workerId: string;
  readonly text: string;
  readonly evidenceIds: readonly string[];
  readonly scope: JuliusCarryScope;
  /** The standing the copy is recorded at, about the copy's own entry id. */
  readonly claim: JuliusMemoryClaim;
  readonly severity: string | null;
  readonly category: string | null;
  readonly criterionId: string | null;
  readonly revision: number | null;
}

export interface JuliusCarryExclusion {
  readonly sourceRunId: string;
  readonly sourceRef: string;
  readonly reason: JuliusCarryExclusionReason;
}

export interface JuliusCarryPlan {
  readonly version: typeof JULIUS_KNOWLEDGE_CARRY_VERSION;
  readonly runId: string;
  readonly missionId: string;
  readonly scope: JuliusCarryScope;
  readonly sourceRunIds: readonly string[];
  /** Every row the carry looked at: the source runs' findings and their VERIFIED/APPROVED brain rows. */
  readonly candidates: number;
  /** True when the store bounded its read of brain rows, so `candidates` is a lower bound. */
  readonly candidatesTruncated: boolean;
  /** How many passed every rule before the packet bound. */
  readonly eligible: number;
  readonly carried: readonly JuliusCarryItem[];
  readonly excluded: readonly JuliusCarryExclusion[];
}

/** What the bootstrap is told, and what it may refuse on. */
export interface JuliusKnowledgeCarryOutcome {
  readonly outcome: 'CARRIED' | 'EMPTY' | 'FAILED';
  /** Rows the plan carried (new or already present from an earlier attempt of this bootstrap). */
  readonly carried: number;
  /** Of those, the VERIFIED_REPAIR_FINDINGs: the only rows a REQUIRED carry counts. */
  readonly carriedFindings: number;
  /** The runs those findings came from, each once: a required carry's must all be the runs it pinned. */
  readonly findingSourceRunIds: readonly string[];
  /** Rows this call newly wrote: 0 on a replay. */
  readonly written: number;
  readonly excluded: number;
  readonly reasonCode: JuliusCarryFailure | null;
  /** The `knowledge.carried` event that records this outcome, or null when not even the failure could be written. */
  readonly eventId: string | null;
}

const SEVERITY_ORDER: Readonly<Record<string, number>> = Object.freeze({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 });

const oneLine = (value: string): string => value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();

const cut = (value: string, limit: number): string =>
  (value.length <= limit ? value : `${value.slice(0, limit)} [cut at ${String(limit)} characters]`);

/**
 * A CARRIED FINDING, AS THE PLANNER READS IT. Every structured field on its own
 * labelled line, and the reviewer's claim last. Deliberately NOT the
 * `REVIEW FINDING <id> [` shape this run's own findings take in a repair packet:
 * a lesson from an earlier run is not a finding this run must answer, and
 * nothing may read it as one.
 */
export function renderJuliusCarriedFinding(input: {
  readonly sourceRunId: string;
  readonly sourceRunState: string;
  readonly finding: JuliusCarryFindingCandidate['finding'];
  readonly life: NonNullable<JuliusCarryFindingCandidate['life']>;
  readonly task: JuliusCarryFindingCandidate['task'];
  readonly scope: JuliusCarryScope;
}): string {
  const { finding, life, task, scope } = input;
  return [
    'CARRIED FROM AN EARLIER RUN: VERIFIED REVIEWER FINDING. It was resolved in that run. It is a lesson for this plan, not a finding against this run\'s work.',
    `SOURCE RUN: ${input.sourceRunId} (${input.sourceRunState})`,
    `SOURCE TASK: ${finding.taskId} (${task === null ? 'task type unknown' : `${task.taskType}, ${task.role}`})`,
    `FINDING: ${finding.findingId} | severity ${finding.severity} | category ${finding.category} | criterion ${finding.criterionId ?? 'none'} | ${finding.blocking ? 'blocking' : 'non-blocking'}`,
    `RAISED BY: ${finding.reviewerWorkerId} in ${life.originReviewTaskId ?? 'unknown'}, citing ${finding.evidenceIds.join(', ')}`,
    `REPAIRED BY: ${life.repairTaskIds.join(', ')} | RESOLVED BY THE INDEPENDENT RE-REVIEW: ${life.resolutionReviewTaskId ?? 'unknown'}`,
    `SCOPE HERE: ${scope.taskId} (${scope.taskType}, ${scope.role}) only`,
    `REVIEWER'S CLAIM: ${cut(oneLine(finding.claim), JULIUS_CARRIED_CLAIM_CHARS)}`,
  ].join('\n');
}

/**
 * A CARRIED FINDING'S STANDING: exactly what admission derives for a FINDING row
 * that cites the finding's evidence and names its reviewer — `reviewer_verified`,
 * VERIFIED, asserted by the reviewer, when the reviewer asserted it. No second
 * opinion and no promotion: the one derivation (`juliusAdmittedClaimFor`).
 */
export function juliusCarriedFindingClaim(input: {
  readonly runId: string;
  readonly projectId: string;
  readonly entryId: string;
  readonly scope: JuliusCarryScope;
  readonly finding: JuliusCarryFindingCandidate['finding'];
}): JuliusMemoryClaim {
  return juliusAdmittedClaimFor({
    runId: input.runId, projectId: input.projectId, taskId: input.scope.taskId,
    workerId: input.finding.reviewerWorkerId, entryId: input.entryId, kind: 'FINDING',
    safeText: '', evidenceIds: input.finding.evidenceIds,
    occurredAt: input.finding.createdAt,
  });
}

/** A finding travels only when its own lifecycle says a repair answered it and a reviewer said so. */
function findingExclusion(candidate: JuliusCarryFindingCandidate): JuliusCarryExclusionReason | null {
  const { finding, life } = candidate;
  // A rejected finding is not knowledge, whatever happened to it afterwards.
  if (finding.status === 'DISMISSED') return 'finding_dismissed';
  if (!finding.blocking) return 'finding_not_blocking';
  // A finding that points at nothing is an assertion (`julius-context-provenance.ts`, `needsEvidence`).
  if (finding.evidenceIds.length === 0) return 'finding_uncited';
  if (life === null) return 'finding_lifecycle_unreadable';
  if (life.state === 'SUPERSEDED') return 'finding_superseded';
  if (life.state !== 'RESOLVED' || life.lastMove !== 'REVIEWER_RESOLVED' || life.resolutionReviewTaskId === null) return 'finding_unresolved';
  // No review is on record as raising it (`finding.recorded`): its author cannot be shown to be the Independent Reviewer.
  if (life.originReviewTaskId === null) return 'finding_origin_unknown';
  if (life.repairTaskIds.length === 0) return 'finding_resolved_without_repair';
  return null;
}

/**
 * Why a VERIFIED/APPROVED brain row is not carried — every row except the one
 * design in force, which the plan names itself. Shapes are the ids the runtime mints (`brain:decision:` in
 * the pipeline, `brain:architecture:` in `julius-architecture-state.ts`); the
 * unit cases build their inputs with those minting functions, so a drift
 * between the two fails a test rather than a mission.
 */
function brainExclusion(
  row: JuliusCarryBrainCandidate,
  inForceOf: ReadonlyMap<string, JuliusCarryArchitectureFact>,
  stateOf: ReadonlyMap<string, string>,
): JuliusCarryExclusionReason {
  if (isJuliusCarriedEntryId(row.entryId)) return 'carried_copy';
  if (row.entryId.startsWith('brain:decision:')) return 'decision_mirror';
  if (row.entryId.startsWith('brain:architecture:proposal:')) return 'architecture_proposal';
  if (row.entryId.startsWith('brain:architecture:')) {
    if (stateOf.get(row.runId) !== 'COMPLETED') return 'architecture_run_not_completed';
    return inForceOf.get(row.runId)?.inForceEntryId === row.entryId ? 'architecture_older_run' : 'architecture_not_in_force';
  }
  if (row.taskId !== null) return 'task_scoped_entry';
  return 'entry_kind_not_carried';
}

/**
 * DECIDE WHAT A NEW RUN INHERITS.
 *
 * Total over its inputs: every candidate from a source run is either carried or
 * excluded with a reason, so `carried + excluded` accounts for everything the
 * carry looked at (the identity the unit cases hold it to).
 */
export function planJuliusKnowledgeCarry(input: {
  readonly runId: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly scope: JuliusCarryScope;
  /** Newest first. */
  readonly sourceRuns: readonly JuliusCarrySourceRun[];
  readonly findings: readonly JuliusCarryFindingCandidate[];
  readonly architectures: readonly JuliusCarryArchitectureFact[];
  readonly brain: readonly JuliusCarryBrainCandidate[];
  readonly brainTruncated?: boolean;
  readonly limit: number;
}): JuliusCarryPlan {
  // NEVER THE RUN DOING THE CARRYING, whatever the caller passed.
  const runs = input.sourceRuns.filter((run) => run.runId !== input.runId);
  const rank = new Map(runs.map((run, index) => [run.runId, index] as const));
  const stateOf = new Map(runs.map((run) => [run.runId, run.state] as const));
  const findings = input.findings.filter((row) => rank.has(row.runId));
  const brain = input.brain.filter((row) => rank.has(row.runId));
  const inForceOf = new Map(input.architectures.filter((fact) => rank.has(fact.runId)).map((fact) => [fact.runId, fact] as const));
  const excluded: JuliusCarryExclusion[] = [];

  // THE ONE DESIGN: in force when the newest COMPLETED run that has one ended. Named on the record, never carried.
  const designRun = runs.find((run) => run.state === 'COMPLETED' && (inForceOf.get(run.runId)?.inForceEntryId ?? null) !== null);
  const design = designRun === undefined ? null : inForceOf.get(designRun.runId) ?? null;
  const designRow = design === null ? undefined : brain.find((row) => row.runId === design.runId && row.entryId === design.inForceEntryId);
  if (design !== null && designRow === undefined) {
    // In force on the ledger, and no VERIFIED/APPROVED standing for its row: said, not skipped.
    excluded.push({ sourceRunId: design.runId, sourceRef: design.inForceEntryId ?? '', reason: 'architecture_standing_not_approved' });
  }
  for (const row of brain) {
    if (row === designRow) {
      // The design's row is a DECISION the runtime wrote at APPROVED; anything else under its id is not that row.
      const approved = row.claim.trust === 'APPROVED' && row.kind === 'DECISION';
      excluded.push({ sourceRunId: row.runId, sourceRef: row.entryId, reason: approved ? 'architecture_not_a_source' : 'architecture_standing_not_approved' });
      continue;
    }
    excluded.push({ sourceRunId: row.runId, sourceRef: row.entryId, reason: brainExclusion(row, inForceOf, stateOf) });
  }

  // THE VERIFIED REPAIR FINDINGS, newest run first, most severe first, then oldest first: one total order.
  const passing: JuliusCarryFindingCandidate[] = [];
  for (const candidate of findings) {
    const reason = findingExclusion(candidate);
    if (reason === null) passing.push(candidate);
    else excluded.push({ sourceRunId: candidate.runId, sourceRef: candidate.finding.findingId, reason });
  }
  passing.sort((left, right) =>
    (rank.get(left.runId)! - rank.get(right.runId)!)
    || ((SEVERITY_ORDER[left.finding.severity] ?? 9) - (SEVERITY_ORDER[right.finding.severity] ?? 9))
    || left.finding.createdAt.localeCompare(right.finding.createdAt)
    || left.finding.findingId.localeCompare(right.finding.findingId));
  const findingItems: JuliusCarryItem[] = passing.map((candidate) => {
    const entryId = juliusCarriedCopyId(input.runId, candidate.runId, candidate.finding.findingId);
    const sourceRunState = stateOf.get(candidate.runId) ?? 'UNKNOWN';
    return {
      source: 'VERIFIED_REPAIR_FINDING', sourceRunId: candidate.runId, sourceRunState,
      sourceRef: candidate.finding.findingId, sourceTaskId: candidate.finding.taskId,
      sourceTaskType: candidate.task?.taskType ?? null, sourceScope: 'TASK',
      entryId, kind: 'FINDING', workerId: candidate.finding.reviewerWorkerId,
      text: renderJuliusCarriedFinding({
        sourceRunId: candidate.runId, sourceRunState, finding: candidate.finding,
        life: candidate.life!, task: candidate.task, scope: input.scope,
      }),
      evidenceIds: [...candidate.finding.evidenceIds], scope: input.scope,
      claim: juliusCarriedFindingClaim({ runId: input.runId, projectId: input.projectId, entryId, scope: input.scope, finding: candidate.finding }),
      severity: candidate.finding.severity, category: candidate.finding.category,
      criterionId: candidate.finding.criterionId, revision: null,
    };
  });

  // ONE ROW PER ENTRY ID, the first in order wins; then the packet bound, with the rest named.
  const seen = new Set<string>();
  const eligible = findingItems.filter((item) => {
    if (seen.has(item.entryId)) return false;
    seen.add(item.entryId);
    return true;
  });
  const carried = eligible.slice(0, Math.max(0, input.limit));
  for (const item of eligible.slice(carried.length)) {
    excluded.push({ sourceRunId: item.sourceRunId, sourceRef: item.sourceRef, reason: 'over_limit' });
  }
  return Object.freeze({
    version: JULIUS_KNOWLEDGE_CARRY_VERSION,
    runId: input.runId,
    missionId: input.missionId,
    scope: input.scope,
    sourceRunIds: Object.freeze(runs.map((run) => run.runId)),
    // A design in force whose row held no standing was looked at too, and is excluded above.
    candidates: findings.length + brain.length + (design !== null && designRow === undefined ? 1 : 0),
    candidatesTruncated: input.brainTruncated === true,
    eligible: eligible.length,
    carried: Object.freeze(carried),
    excluded: Object.freeze(excluded),
  });
}

/* ------------------------------------------------------- the carry on the record */

/** The event validator's own refusal shape (`validateJuliusEvent`): a fact that holds one would cost the whole record. */
const SECRET_SHAPE = /(?:api[_-]?key|authorization|token|secret|password)\s*[=:]/iu;

/** An id or a closed token, reduced to a safe alphabet; never prose. */
const token = (value: string | null): string =>
  (value === null || value.length === 0 ? '-' : value.replace(/[^A-Za-z0-9._:@+/-]/gu, '_').slice(0, 160));

/** Whole items joined until the bound, never half of one. */
function bounded(items: readonly string[], separator: string, limit: number): { readonly text: string | null; readonly truncated: boolean } {
  let text = '';
  let kept = 0;
  for (const item of items) {
    const next = text.length === 0 ? item : `${text}${separator}${item}`;
    if (next.length > limit) break;
    text = next;
    kept += 1;
  }
  return { text: kept === 0 ? null : text, truncated: kept < items.length };
}

/** One carried row as one `|`-separated token string; a token that would trip the validator is withheld, not the event. */
function entryToken(item: JuliusCarryItem, digest: string | null): string {
  const text = [
    token(item.entryId), item.kind, item.source, token(item.sourceRunId), token(item.sourceTaskId), token(item.sourceTaskType),
    item.sourceScope, token(item.severity), token(item.category), token(item.criterionId), token(item.workerId),
    item.claim.trust, token(digest),
  ].join('|');
  return SECRET_SHAPE.test(text) ? `${token(digest)}|withheld` : text;
}

/**
 * THE FACTS OF A DECIDED CARRY. Ids, closed tokens, counts and digests only —
 * never a claim's text, which `findings.tsv` already exports and the digest
 * binds. Bounded well under the ledger's 8 KiB, whole items at a time.
 *
 * `digests` is the caller's (`sha256` of each carried row's text): this module
 * holds no hash, so the store computes it and the record carries it.
 */
export function juliusKnowledgeCarryFacts(
  plan: JuliusCarryPlan,
  digests: Readonly<Record<string, string>>,
): Readonly<Record<string, string | number | boolean | null>> {
  const reasons = JULIUS_CARRY_EXCLUSIONS
    .map((reason) => [reason, plan.excluded.filter((item) => item.reason === reason).length] as const)
    .filter(([, count]) => count > 0);
  const entries = bounded(plan.carried.map((item) => entryToken(item, digests[item.entryId] ?? null)), ';', 3_000);
  const refs = bounded(plan.excluded
    .map((item) => `${item.reason}:${token(item.sourceRunId)}:${token(item.sourceRef)}`)
    .filter((ref) => !SECRET_SHAPE.test(ref)), ';', 1_500);
  const sources = bounded(plan.sourceRunIds.map(token), ' ', 600);
  return Object.freeze({
    carryVersion: JULIUS_KNOWLEDGE_CARRY_VERSION,
    outcome: plan.carried.length === 0 ? 'EMPTY' : 'CARRIED',
    reasonCode: null,
    missionId: token(plan.missionId),
    scopeTaskId: token(plan.scope.taskId),
    scopeTaskType: plan.scope.taskType,
    scopeRole: plan.scope.role,
    sourceRuns: plan.sourceRunIds.length,
    sourceRunIds: sources.text,
    candidates: plan.candidates,
    candidatesTruncated: plan.candidatesTruncated,
    eligible: plan.eligible,
    carried: plan.carried.length,
    carriedFindings: plan.carried.filter((item) => item.source === 'VERIFIED_REPAIR_FINDING').length,
    // Kept in the record's shape (the evidence bundle exports it): a design does not travel, so it is 0.
    carriedArchitecture: 0,
    carriedEntries: entries.text,
    entriesTruncated: entries.truncated,
    excluded: plan.excluded.length,
    excludedByReason: reasons.length === 0 ? null : reasons.map(([reason, count]) => `${reason}=${String(count)}`).join(','),
    excludedRefs: refs.text,
    excludedRefsTruncated: refs.truncated,
  });
}

/**
 * THE FACTS OF A CARRY THAT COULD NOT HAPPEN. Unknown is not zero: every count
 * the carry never made is null, and the reason is the closed failure code.
 */
export function juliusKnowledgeCarryFailureFacts(input: {
  readonly missionId: string;
  readonly scopeTaskId: string;
  readonly reasonCode: JuliusCarryFailure;
}): Readonly<Record<string, string | number | boolean | null>> {
  return Object.freeze({
    carryVersion: JULIUS_KNOWLEDGE_CARRY_VERSION,
    outcome: 'FAILED',
    reasonCode: input.reasonCode,
    missionId: token(input.missionId),
    scopeTaskId: token(input.scopeTaskId),
    scopeTaskType: 'plan',
    scopeRole: 'PROMPT_ARCHITECT',
    sourceRuns: null, sourceRunIds: null, candidates: null, candidatesTruncated: null, eligible: null,
    carried: null, carriedFindings: null, carriedArchitecture: null, carriedEntries: null, entriesTruncated: null,
    excluded: null, excludedByReason: null, excludedRefs: null, excludedRefsTruncated: null,
  });
}

/**
 * THE CARRY'S ONE LEDGER ROW, on the new run's stream. A run-level event (no
 * task, no worker): Julius decided it at bootstrap, before anything ran. The id
 * is the caller's, derived from the facts, so a replayed bootstrap that carries
 * the same thing writes nothing twice and one that carries something else is a
 * second, distinct row rather than a conflict.
 */
export function juliusKnowledgeCarriedEvent(input: {
  readonly runId: string;
  readonly projectId: string;
  readonly eventId: string;
  readonly facts: Readonly<Record<string, string | number | boolean | null>>;
  readonly occurredAt: string;
}): JuliusOperationalEvent {
  return {
    eventId: input.eventId, runId: input.runId, projectId: input.projectId, type: 'knowledge.carried',
    taskId: null, workerId: null, correlationId: `knowledge-carry:${input.runId}`, causationId: null,
    occurredAt: input.occurredAt, facts: input.facts,
  };
}

/**
 * WHAT ONE DISPATCH WAS OWED FROM AN EARLIER RUN, AND WHAT IT WAS HANDED
 * (founder ruling 2026-10-04, R2 point 4). `owed` is every carried row in scope
 * for this task and role; the snapshot says which arrived, which the budget
 * evicted and which the integrity layer excluded. Null when nothing was owed,
 * so a packet with no inheritance writes no row.
 */
export function juliusKnowledgeConsumedFacts(input: {
  readonly owed: readonly string[];
  readonly sourceEntryIds: readonly string[];
  readonly evictedEntryIds: readonly string[] | null;
  readonly excludedEntryIds: readonly string[] | null;
  readonly attempt: number;
  readonly role: string;
  readonly taskType: string;
}): Readonly<Record<string, string | number | boolean | null>> | null {
  if (input.owed.length === 0) return null;
  const admitted = input.owed.filter((entryId) => input.sourceEntryIds.includes(entryId));
  const evicted = input.owed.filter((entryId) => (input.evictedEntryIds ?? []).includes(entryId));
  const excluded = input.owed.filter((entryId) => (input.excludedEntryIds ?? []).includes(entryId));
  const admittedIds = bounded(admitted.map(token), ' ', 1_500);
  const evictedIds = bounded(evicted.map(token), ' ', 600);
  return Object.freeze({
    carryVersion: JULIUS_KNOWLEDGE_CARRY_VERSION,
    attempt: input.attempt,
    role: token(input.role),
    taskType: token(input.taskType),
    inScope: input.owed.length,
    admitted: admitted.length,
    admittedEntryIds: admittedIds.text,
    evicted: evicted.length,
    evictedEntryIds: evictedIds.text,
    excludedInScope: excluded.length,
    missing: input.owed.length - admitted.length,
  });
}
