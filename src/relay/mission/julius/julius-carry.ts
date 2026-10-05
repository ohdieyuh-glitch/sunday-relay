import { isJuliusArchitectureEntryId, juliusArchitectureProposalEntryId } from './julius-architecture-state';
import { juliusClaimIdFor, type JuliusCarriedKnowledge } from './julius-claim-ledger';
import { foldJuliusFindings, type JuliusFindingLife } from './julius-finding-lifecycle';
import type { JuliusMemoryClaim } from './julius-memory-trust';
import type { JuliusPeerLedgerEntry } from './julius-peer-channel';
import type { JuliusReviewerFinding } from './julius-verification-runtime';

/**
 * THE CORRECTED CARRY (DECISION C): WHAT ONE MISSION MAY HAND THE NEXT, AND THE
 * RECORD THAT PROVES IT WAS HANDED.
 *
 * THE DEFECT THIS REPLACES (Beta-blocking P2). The first carry
 * (`relay-bridge/julius/mission-knowledge.ts`, `julius-claim-ledger.v1`) took
 * every claim of the project standing at VERIFIED or APPROVED, of any kind, and
 * wrote each copy into the next run with `task_id NULL`, which is run-wide.
 * Measured against what can actually reach VERIFIED, that carried the wrong
 * things and missed the right ones:
 *
 *   - An accepted review promotes EVERY entry the reviewed task wrote
 *     (`juliusClaimPromotionsOnAccept`). That includes a coder's own HANDOFF
 *     notes and an architect's task-scoped "PROPOSED ARCHITECTURE REVISION — NOT
 *     IN FORCE" DECISION. Both became VERIFIED, and the carry then copied them
 *     into the next mission as run-wide truth: task-scoped state globalized, and
 *     a proposal nobody adopted presented as a design.
 *   - The Independent Reviewer's findings are not brain entries at all. They
 *     live in `julius_reviewer_findings` with their life on the ledger
 *     (`julius-finding-lifecycle`), so the one kind of knowledge a learning pair
 *     exists to move — a defect a reviewer found, a repair answered and a
 *     re-review resolved — could never be carried.
 *   - A store failure read as an empty carry (`.catch(() => [])`), so "nothing
 *     was eligible" and "nobody could look" were the same record.
 *   - Nothing recorded what was considered, what was refused and why, or what
 *     the receiving planner was actually given.
 *
 * WHAT IS CARRIED NOW, and nothing else:
 *
 *   VERIFIED_REPAIR_FINDING  an Independent Reviewer's BLOCKING finding whose
 *                            life ended RESOLVED by a reviewer's own declaration,
 *                            after at least one repair round claimed to address
 *                            it. (A warning Julius promoted is recorded blocking.)
 *   VERIFIED_FINDING         the same, resolved by the reviewer with no repair
 *                            round, or a non-blocking finding a repair round only
 *                            happened to address. It is verified, but it is not a
 *                            repair.
 *   ACCEPTED_DECISION        a run-wide DECISION entry whose current standing is
 *                            APPROVED on DECISION evidence: adopted, in force.
 *
 * Everything else considered is EXCLUDED BY NAME (`JuliusCarryExclusionCode`),
 * so the manifest proves the defect class stayed out instead of merely not
 * showing it.
 *
 * SCOPE AND PROVENANCE TRAVEL WITH THE FACT. A carried finding is about a task
 * of ANOTHER run; the receiving run has no such task, so the copy is labelled a
 * PRIOR lesson and names its source run, the work it was about, the review that
 * raised it, the repairs and the review that resolved it, in its text, its
 * claim evidence and the manifest. It is never phrased as a fact about the
 * receiving mission.
 *
 * THE PAIR RULE. A WITH arm is valid only when its carry holds at least one
 * VERIFIED_REPAIR_FINDING. An empty carry, or one holding only decisions
 * ("design-only"), makes the pair invalid, and the bootstrap refuses it before
 * a run exists, so before any paid dispatch.
 *
 * PURE. No clock, no store, no Node. Ordering is total, so the same inputs
 * always select the same carry.
 */

export const JULIUS_CARRY_VERSION = 'julius-carry.v2' as const;

/** How many items one mission may inherit. A packet, not an archive. */
export const JULIUS_CARRY_LIMIT = 12;

/** The longest reviewer claim a carried line quotes. The source row keeps the rest. */
export const JULIUS_CARRY_CLAIM_CHARS = 600;

export const JULIUS_CARRY_CLASSES = ['VERIFIED_REPAIR_FINDING', 'VERIFIED_FINDING', 'ACCEPTED_DECISION'] as const;
export type JuliusCarryClass = (typeof JULIUS_CARRY_CLASSES)[number];

/** The learning arm a mission runs as. Absent: an ordinary mission, outside any pair. */
export const JULIUS_CARRY_ARMS = ['WITHOUT', 'WITH'] as const;
export type JuliusCarryArm = (typeof JULIUS_CARRY_ARMS)[number];

export const JULIUS_CARRY_EXCLUSION_CODES = [
  // findings
  'FINDING_DISMISSED',
  'FINDING_UNRESOLVED',
  'FINDING_ADDRESSED_NOT_VERIFIED',
  'FINDING_SUPERSEDED',
  'FINDING_ORIGIN_UNKNOWN',
  'FINDING_RESOLUTION_UNKNOWN',
  'FINDING_WITHOUT_EVIDENCE',
  // claims and entries
  'CARRY_OF_CARRY',
  'KIND_NOT_CARRYABLE',
  'DECISION_PROPOSED_NOT_IN_FORCE',
  'DECISION_NOT_ACCEPTED',
  'DECISION_WITHOUT_AUTHORITY',
  'TASK_SCOPED',
  'TASK_SCOPE_UNKNOWN',
  'CLAIM_TERMINAL',
  // both
  'SAME_RUN',
  'CARRY_LIMIT',
] as const;
export type JuliusCarryExclusionCode = (typeof JULIUS_CARRY_EXCLUSION_CODES)[number];

/** One earlier run, as the carry reads it: its findings and the ledger rows that give them their lives. */
export interface JuliusCarrySourceRun {
  readonly runId: string;
  readonly findings: readonly JuliusReviewerFinding[];
  readonly ledger: readonly JuliusPeerLedgerEntry[];
}

/**
 * A claim the project holds at VERIFIED or APPROVED, with the brain row it is
 * about. `taskId` is the row's own scope: null is run-wide, a string is one
 * task's, and `undefined` means the reader could not say, which is never read
 * as run-wide.
 */
export interface JuliusCarryClaimCandidate extends JuliusCarriedKnowledge {
  readonly taskId: string | null | undefined;
}

/** Where a carried item came from, kept whole so a reader of the receiving run can follow it back. */
export interface JuliusCarryScope {
  readonly sourceRunId: string;
  /** The finding id, or the source entry id for a decision. */
  readonly sourceRef: string;
  /** The work a finding was about. Null for a run-wide decision. */
  readonly sourceTaskId: string | null;
  readonly originReviewTaskId: string | null;
  readonly repairTaskIds: readonly string[];
  readonly resolutionReviewTaskId: string | null;
  readonly criterionId: string | null;
}

export interface JuliusCarryItem {
  readonly carryClass: JuliusCarryClass;
  readonly scope: JuliusCarryScope;
  /**
   * The id the copy takes in the receiving run: legible, stable so a replay writes nothing twice, and the
   * receiving run's OWN, so every run that inherits the same fact holds its own copy and claim.
   */
  readonly entryId: string;
  /** The stored brain kind the copy is written as. */
  readonly storedKind: 'FINDING' | 'DECISION';
  readonly text: string;
  readonly evidenceIds: readonly string[];
  /** The copy's standing: verified or approved by whoever did so in the source run, never re-derived. */
  readonly claim: JuliusMemoryClaim;
  /** For ordering only: when the source fact was recorded. */
  readonly recordedAt: string;
}

export interface JuliusCarryExclusion {
  readonly sourceRunId: string;
  readonly sourceRef: string;
  readonly reasonCode: JuliusCarryExclusionCode;
  /** The kind or state that decided it, when that is not already the code. */
  readonly detail: string | null;
}

export interface JuliusCarrySelection {
  readonly version: typeof JULIUS_CARRY_VERSION;
  readonly selected: readonly JuliusCarryItem[];
  readonly excluded: readonly JuliusCarryExclusion[];
  readonly counts: Readonly<Record<JuliusCarryClass, number>>;
}

/**
 * The entry id a carried copy takes: the run that RECEIVES it, its source run, and what it was there.
 *
 * Entry ids are unique across the whole store, so an id without the receiving run made a fact's copy the property of
 * the first run to inherit it: on a long-lived store every later heir collided with that row, was written nothing, and
 * its claim (derived from the id) was deduplicated into the first heir's.
 */
export const juliusCarryEntryId = (targetRunId: string, sourceRunId: string, sourceRef: string): string =>
  `carried:${targetRunId}:${sourceRunId}:${sourceRef}`;

export const isJuliusCarriedEntryId = (entryId: string): boolean => entryId.startsWith('carried:');

const CLASS_RANK: Readonly<Record<JuliusCarryClass, number>> = {
  VERIFIED_REPAIR_FINDING: 0,
  VERIFIED_FINDING: 1,
  ACCEPTED_DECISION: 2,
};

const bounded = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;

/**
 * WHAT A FINDING'S LIFE SAYS ABOUT CARRYING IT. A string is the exclusion code;
 * a class is what it carries as.
 */
function findingVerdict(
  finding: JuliusReviewerFinding,
  life: JuliusFindingLife | undefined,
): JuliusCarryExclusionCode | 'VERIFIED_REPAIR_FINDING' | 'VERIFIED_FINDING' {
  // A rejected finding is not knowledge, whatever happened to it afterwards.
  if (finding.status === 'DISMISSED') return 'FINDING_DISMISSED';
  if (life === undefined) return 'FINDING_UNRESOLVED';
  if (life.state === 'OPEN') return 'FINDING_UNRESOLVED';
  if (life.state === 'ADDRESSED') return 'FINDING_ADDRESSED_NOT_VERIFIED';
  if (life.state === 'SUPERSEDED') return 'FINDING_SUPERSEDED';
  // RESOLVED. Only a reviewer's declaration reaches it, but the carry checks
  // the record says so rather than trusting the state alone.
  if (life.lastMove !== 'REVIEWER_RESOLVED' || life.resolutionReviewTaskId === null) return 'FINDING_RESOLUTION_UNKNOWN';
  // A finding no review is on record as raising is a finding of unknown origin:
  // its author cannot be shown to be the Independent Reviewer.
  if (life.originReviewTaskId === null) return 'FINDING_ORIGIN_UNKNOWN';
  if (finding.evidenceIds.length === 0) return 'FINDING_WITHOUT_EVIDENCE';
  // A repair round marks every OPEN finding of its unit ADDRESSED, the non-blocking ones too, and a re-review may
  // resolve any of them. Only a finding that blocked the work is one a repair had to answer.
  return life.repairTaskIds.length > 0 && finding.blocking ? 'VERIFIED_REPAIR_FINDING' : 'VERIFIED_FINDING';
}

function findingItem(
  targetRunId: string,
  sourceRunId: string,
  finding: JuliusReviewerFinding,
  life: JuliusFindingLife,
  carryClass: 'VERIFIED_REPAIR_FINDING' | 'VERIFIED_FINDING',
): JuliusCarryItem {
  const sourceRef = `finding:${finding.findingId}`;
  const entryId = juliusCarryEntryId(targetRunId, sourceRunId, sourceRef);
  const origin = life.originReviewTaskId!;
  const resolution = life.resolutionReviewTaskId!;
  const label = carryClass === 'VERIFIED_REPAIR_FINDING' ? 'PRIOR VERIFIED REPAIR FINDING' : 'PRIOR VERIFIED FINDING';
  const repaired = life.repairTaskIds.length > 0 ? `, repaired by ${life.repairTaskIds.join(', ')}` : '';
  const criterion = finding.criterionId === null ? '' : `, criterion ${finding.criterionId}`;
  const text = [
    `${label} (an earlier mission of this project, not this one).`,
    `Source: run ${sourceRunId}, about task ${finding.taskId}; raised by review ${origin}${repaired}; resolved by review ${resolution}.`,
    `[${finding.severity}, ${finding.category}${criterion}] ${bounded(finding.claim, JULIUS_CARRY_CLAIM_CHARS)}`,
  ].join('\n');
  return Object.freeze({
    carryClass,
    scope: Object.freeze({
      sourceRunId,
      sourceRef,
      sourceTaskId: finding.taskId,
      originReviewTaskId: origin,
      repairTaskIds: Object.freeze([...life.repairTaskIds]),
      resolutionReviewTaskId: resolution,
      criterionId: finding.criterionId,
    }),
    entryId,
    storedKind: 'FINDING' as const,
    text,
    evidenceIds: Object.freeze([...finding.evidenceIds]),
    claim: Object.freeze({
      claimId: juliusClaimIdFor(entryId),
      entryId,
      provenance: 'reviewer_verified' as const,
      trust: 'VERIFIED' as const,
      // The reviewer asserted it, so no reviewer in the receiving run can
      // "verify" it again as if it were its own discovery.
      assertedBy: finding.reviewerWorkerId,
      assertedAt: finding.createdAt,
      evidence: Object.freeze([
        { kind: 'REVIEW' as const, id: resolution },
        { kind: 'FINDING' as const, id: finding.findingId },
      ]),
      supersedes: null,
      contradicts: Object.freeze([]),
    }),
    recordedAt: finding.createdAt,
  });
}

/**
 * WHAT A CLAIM CANDIDATE SAYS ABOUT CARRYING IT. Only an adopted, run-wide,
 * in-force decision carries; every other claim the old carry would have taken
 * is named here.
 */
function claimVerdict(candidate: JuliusCarryClaimCandidate): { code: JuliusCarryExclusionCode; detail: string | null } | null {
  const { claim, entry } = candidate;
  if (isJuliusCarriedEntryId(entry.entryId)) return { code: 'CARRY_OF_CARRY', detail: null };
  if (claim.trust === 'SUPERSEDED' || claim.trust === 'CONTRADICTED') return { code: 'CLAIM_TERMINAL', detail: claim.trust };
  if (entry.kind !== 'DECISION') return { code: 'KIND_NOT_CARRYABLE', detail: entry.kind };
  if (candidate.taskId !== null && candidate.taskId !== undefined
    && entry.entryId === juliusArchitectureProposalEntryId(candidate.taskId)) {
    return { code: 'DECISION_PROPOSED_NOT_IN_FORCE', detail: null };
  }
  if (entry.entryId.startsWith('brain:architecture:proposal:')) return { code: 'DECISION_PROPOSED_NOT_IN_FORCE', detail: null };
  if (candidate.taskId === undefined) return { code: 'TASK_SCOPE_UNKNOWN', detail: null };
  if (candidate.taskId !== null) return { code: 'TASK_SCOPED', detail: candidate.taskId };
  if (claim.trust !== 'APPROVED') return { code: 'DECISION_NOT_ACCEPTED', detail: claim.trust };
  if (!claim.evidence.some((reference) => reference.kind === 'DECISION')) return { code: 'DECISION_WITHOUT_AUTHORITY', detail: null };
  return null;
}

function decisionItem(targetRunId: string, candidate: JuliusCarryClaimCandidate): JuliusCarryItem {
  const sourceRef = candidate.entry.entryId;
  const entryId = juliusCarryEntryId(targetRunId, candidate.sourceRunId, sourceRef);
  const what = isJuliusArchitectureEntryId(sourceRef) ? 'ACCEPTED ARCHITECTURE DECISION' : 'ACCEPTED DECISION';
  return Object.freeze({
    carryClass: 'ACCEPTED_DECISION' as const,
    scope: Object.freeze({
      sourceRunId: candidate.sourceRunId,
      sourceRef,
      sourceTaskId: null,
      originReviewTaskId: null,
      repairTaskIds: Object.freeze([]),
      resolutionReviewTaskId: null,
      criterionId: null,
    }),
    entryId,
    storedKind: 'DECISION' as const,
    text: [
      `PRIOR ${what} (an earlier mission of this project, adopted there; not this mission's terms).`,
      `Source: run ${candidate.sourceRunId}, entry ${sourceRef}.`,
      candidate.entry.text,
    ].join('\n'),
    evidenceIds: Object.freeze([...candidate.entry.evidenceIds]),
    claim: Object.freeze({
      ...candidate.claim,
      claimId: juliusClaimIdFor(entryId),
      entryId,
      evidence: Object.freeze(candidate.claim.evidence.map((reference) => ({ kind: reference.kind, id: reference.id }))),
      contradicts: Object.freeze([...candidate.claim.contradicts]),
    }),
    recordedAt: candidate.claim.assertedAt,
  });
}

/**
 * CHOOSE THE CARRY. Every source finding and every claim candidate leaves this
 * either SELECTED or EXCLUDED with a code, never silently: the manifest is the
 * proof of point 2 ("what became carry-eligible") and of everything that did not.
 */
export function selectJuliusCarry(input: {
  readonly targetRunId: string;
  readonly sources: readonly JuliusCarrySourceRun[];
  readonly claims: readonly JuliusCarryClaimCandidate[];
  readonly limit?: number;
}): JuliusCarrySelection {
  const limit = Math.max(0, Math.floor(input.limit ?? JULIUS_CARRY_LIMIT));
  const eligible: JuliusCarryItem[] = [];
  const excluded: JuliusCarryExclusion[] = [];
  const exclude = (sourceRunId: string, sourceRef: string, reasonCode: JuliusCarryExclusionCode, detail: string | null = null): void => {
    excluded.push(Object.freeze({ sourceRunId, sourceRef, reasonCode, detail }));
  };

  for (const source of input.sources) {
    const lives = new Map(foldJuliusFindings(source.findings, source.ledger).map((life) => [life.findingId, life] as const));
    for (const finding of source.findings) {
      const sourceRef = `finding:${finding.findingId}`;
      if (source.runId === input.targetRunId) { exclude(source.runId, sourceRef, 'SAME_RUN'); continue; }
      const life = lives.get(finding.findingId);
      const verdict = findingVerdict(finding, life);
      if (verdict === 'VERIFIED_REPAIR_FINDING' || verdict === 'VERIFIED_FINDING') {
        eligible.push(findingItem(input.targetRunId, source.runId, finding, life!, verdict));
      } else {
        exclude(source.runId, sourceRef, verdict, life?.state ?? null);
      }
    }
  }

  for (const candidate of input.claims) {
    if (candidate.sourceRunId === input.targetRunId) { exclude(candidate.sourceRunId, candidate.entry.entryId, 'SAME_RUN'); continue; }
    const verdict = claimVerdict(candidate);
    if (verdict === null) eligible.push(decisionItem(input.targetRunId, candidate));
    else exclude(candidate.sourceRunId, candidate.entry.entryId, verdict.code, verdict.detail);
  }

  // One item per copy id: the same fact reached twice (two readers, a replay) is one fact.
  const unique = [...new Map(eligible.map((item) => [item.entryId, item] as const)).values()];
  unique.sort((left, right) =>
    CLASS_RANK[left.carryClass] - CLASS_RANK[right.carryClass]
    || (right.recordedAt < left.recordedAt ? -1 : right.recordedAt > left.recordedAt ? 1 : 0)
    || (left.entryId < right.entryId ? -1 : left.entryId > right.entryId ? 1 : 0));
  const selected = unique.slice(0, limit);
  for (const item of unique.slice(limit)) exclude(item.scope.sourceRunId, item.scope.sourceRef, 'CARRY_LIMIT', item.carryClass);

  const counts = { VERIFIED_REPAIR_FINDING: 0, VERIFIED_FINDING: 0, ACCEPTED_DECISION: 0 };
  for (const item of selected) counts[item.carryClass] += 1;
  return Object.freeze({
    version: JULIUS_CARRY_VERSION,
    selected: Object.freeze(selected),
    excluded: Object.freeze(excluded),
    counts: Object.freeze(counts),
  });
}

export type JuliusCarryPairGate =
  | { readonly valid: true; readonly reasonCode: 'CARRY_PAIR_VALID' | 'CARRY_NOT_A_WITH_ARM' }
  | { readonly valid: false; readonly reasonCode: 'CARRY_EMPTY' | 'CARRY_DESIGN_ONLY' | 'CARRY_UNKNOWN' };

/**
 * IS THIS A VALID ARM. Only a WITH arm has a carry to judge. A WITHOUT arm, or
 * a mission outside any pair, passes without one. A WITH arm whose carry could
 * not be read is UNKNOWN, which is not empty and is not valid either.
 */
export function juliusCarryPairGate(
  arm: JuliusCarryArm | null,
  selection: JuliusCarrySelection | null,
): JuliusCarryPairGate {
  if (arm !== 'WITH') return { valid: true, reasonCode: 'CARRY_NOT_A_WITH_ARM' };
  if (selection === null) return { valid: false, reasonCode: 'CARRY_UNKNOWN' };
  if (selection.selected.length === 0) return { valid: false, reasonCode: 'CARRY_EMPTY' };
  if (selection.counts.VERIFIED_REPAIR_FINDING === 0) return { valid: false, reasonCode: 'CARRY_DESIGN_ONLY' };
  return { valid: true, reasonCode: 'CARRY_PAIR_VALID' };
}

/**
 * POINT 4: WHAT THE PLANNER ACTUALLY RECEIVED. Read off a compiled packet's own
 * source ids, so "carried" and "given" cannot be the same claim made twice.
 */
export function juliusCarryReceipt(input: {
  readonly carriedEntryIds: readonly string[];
  readonly packetSourceEntryIds: readonly string[];
}): { readonly received: readonly string[]; readonly missing: readonly string[] } {
  const packet = new Set(input.packetSourceEntryIds);
  const carried = [...new Set(input.carriedEntryIds)].sort();
  return Object.freeze({
    received: Object.freeze(carried.filter((id) => packet.has(id))),
    missing: Object.freeze(carried.filter((id) => !packet.has(id))),
  });
}

/** The carried ids a packet holds, in packet order: everything under the `carried:` prefix. */
export const juliusCarriedIdsIn = (packetSourceEntryIds: readonly string[]): readonly string[] =>
  Object.freeze(packetSourceEntryIds.filter(isJuliusCarriedEntryId));

/**
 * THE MANIFEST AS EVENT FACTS: scalars only, bounded, and never a quoted claim,
 * so it fits the ledger's 8 KiB fact budget and its secret filter. Counts are
 * exact; the id lists are truncated with a flag saying so, never silently.
 */
export function juliusCarryManifestFacts(input: {
  readonly arm: JuliusCarryArm | null;
  readonly selection: JuliusCarrySelection;
  readonly written: number;
}): Record<string, string | number | boolean | null> {
  const ids = input.selection.selected.map((item) => item.entryId).join(' ');
  const refusals = input.selection.excluded.map((item) => `${item.reasonCode}:${item.sourceRunId}:${item.sourceRef}`).join(' ');
  // These ids came from stores. A list that would trip the ledger's
  // credential-assignment check is recorded by count only, never failing the write.
  const safe = (text: string): string | null =>
    (/(?:api[_-]?key|authorization|token|secret|password)\s*[=:]/iu.test(text) ? null : bounded(text, 3_000) || null);
  const byCode = new Map<string, number>();
  for (const item of input.selection.excluded) byCode.set(item.reasonCode, (byCode.get(item.reasonCode) ?? 0) + 1);
  return {
    version: input.selection.version,
    arm: input.arm,
    selected: input.selection.selected.length,
    verifiedRepairFindings: input.selection.counts.VERIFIED_REPAIR_FINDING,
    verifiedFindings: input.selection.counts.VERIFIED_FINDING,
    acceptedDecisions: input.selection.counts.ACCEPTED_DECISION,
    excluded: input.selection.excluded.length,
    excludedByCode: [...byCode.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([code, count]) => `${code}=${String(count)}`).join(' ') || null,
    written: input.written,
    selectedEntryIds: safe(ids),
    selectedEntryIdsTruncated: ids.length > 3_000,
    excludedRefs: safe(refusals),
    excludedRefsTruncated: refusals.length > 3_000,
  };
}
