import { mergeJuliusDurableStanding } from './julius-claim-ledger';
import type { JuliusContextConflict, JuliusContextType } from './julius-context-integrity';
import { deriveJuliusContextQualification } from './julius-context-provenance';
import type { JuliusMemoryClaim, JuliusMemoryTrustState } from './julius-memory-trust';
import { JULIUS_DEFAULT_ROLES, type JuliusBrainEntry, type JuliusContextQualification, type JuliusDecisionAction } from './julius-runtime';
import type { JuliusReviewerFinding } from './julius-verification-runtime';

/**
 * THE LINEAGE ASSERTER (founder decision B, 2026-10-03).
 *
 * Every claim has always carried `supersedes` and `contradicts`, and in a live
 * run every claim had them empty: nothing asserted lineage, so the compiler's
 * fail-closed path was reachable only through a test seam, and the GOVERNANCE
 * rung by no derived claim at all. This asserts both, from STRUCTURE alone —
 * never from an entry's text, never from a model's opinion — under the
 * founder's four rules:
 *   1. a later VERIFIED revision of the same subject SUPERSEDES the earlier,
 *      where VERIFIED means VERIFIED or APPROVED (founder, I1);
 *   2. incompatible VERIFIED values for the same subject CONTRADICT, and the
 *      packet or the run FAILS CLOSED — nothing chooses between them;
 *   3. GOVERNANCE claims come only from durable recorded governance decisions;
 *   4. worker or model output is never governance authority.
 *
 * WHAT A SUBJECT IS: a closed list of families, each an entry-id shape the
 * runtime itself mints (`JULIUS_LINEAGE_FAMILIES`). An entry in no family gets
 * no lineage; adding one is a reviewed change, and the list is pinned.
 *
 * THE COMPATIBILITY TABLE is rule 2's live path. A task ACCEPTED while a
 * blocking VERIFIED finding about it is still OPEN cannot both be true, and
 * the table says so, never a comparison of text. It is applied RUN-WIDE, to
 * the run's durable verdicts and findings, because a packet never holds both:
 * admission is task-scoped, and an accepted task is not dispatched again.
 *
 * Pure: it reads only its arguments, orders everything by a total key, and
 * returns new values. The same inputs in any order give the same output.
 */

/** Founder I1: the verified rungs. */
export const JULIUS_LINEAGE_VERIFIED_TRUSTS: readonly JuliusMemoryTrustState[] = Object.freeze(['VERIFIED', 'APPROVED']);
const isVerified = (trust: JuliusMemoryTrustState): boolean => JULIUS_LINEAGE_VERIFIED_TRUSTS.includes(trust);

/** Every verdict the pipeline treats as acceptance (`ACCEPT || COMPLETE`, julius-task-pipeline.ts, six places). */
export const JULIUS_ACCEPTING_VERDICTS: readonly JuliusDecisionAction[] = Object.freeze(['ACCEPT', 'COMPLETE']);
const DECISION_ACTIONS: readonly JuliusDecisionAction[] = Object.freeze(['ACCEPT', 'REPAIR', 'REROUTE', 'RETRY', 'ESCALATE', 'HALT', 'COMPLETE']);

export type JuliusLineageFamily = 'V' | 'R';
/** The closed families: the only entry ids that have a subject and an order. */
export const JULIUS_LINEAGE_FAMILIES: readonly { readonly family: JuliusLineageFamily; readonly shape: RegExp }[] = Object.freeze([
  // V — a task's verdict, written by the pipeline when a decision is recorded. Ordered by the entry's DURABLE brain
  // revision (never its time, never arrival); its value is the action.
  { family: 'V', shape: new RegExp(`^brain:decision:(.+):(${DECISION_ACTIONS.join('|')}):([A-Z0-9_]+)$`, 'u') },
  // R — an entry the runtime revisions by name. Ordered by N; its value is the entry's text.
  { family: 'R', shape: /^((?:brain:architecture|brain:guidance-answer):.+):r([1-9][0-9]*)$/u },
  { family: 'R', shape: /^(pbr:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@v([1-9][0-9]*)$/u },
]);

/** An entry placed in its family: what it is about, where it stands in that subject's order, and what it says. */
export interface JuliusLineagePlacement {
  readonly family: JuliusLineageFamily;
  readonly subject: string;
  readonly order: number;
  readonly value: string;
}

/**
 * WHERE AN ENTRY STANDS, or null. A verdict needs its durable revision: one the
 * store did not return cannot be ordered, so it is given no lineage at all
 * rather than an order invented from its time.
 */
export function placeJuliusLineageEntry(
  entry: JuliusBrainEntry,
  revisions: Readonly<Record<string, number>>,
): JuliusLineagePlacement | null {
  for (const { family, shape } of JULIUS_LINEAGE_FAMILIES) {
    const match = shape.exec(entry.entryId);
    if (match === null) continue;
    if (family === 'V') {
      const revision = revisions[entry.entryId];
      if (revision === undefined || !Number.isSafeInteger(revision) || revision < 1) return null;
      return { family, subject: `verdict:${match[1]!}`, order: revision, value: match[2]! };
    }
    return { family, subject: match[1]!, order: Number(match[2]), value: entry.text };
  }
  return null;
}

/* ------------------------------------------------------------ the compatibility table */

export type JuliusFindingStatus = JuliusReviewerFinding['status'];
const FINDING_STATUSES: readonly JuliusFindingStatus[] = Object.freeze(['OPEN', 'RESOLVED', 'DISMISSED']);
const TRUSTS: readonly JuliusMemoryTrustState[] = Object.freeze(['UNVERIFIED', 'SUPPORTED', 'VERIFIED', 'APPROVED', 'CONTRADICTED', 'SUPERSEDED']);

/**
 * ONE ROW OF THE TABLE, and the only way a verdict and a finding are judged.
 * The rows partition every (verdict, status, blocking, trust): exactly one row
 * matches any combination, and a test enumerates all of them.
 */
export interface JuliusCompatibilityRow {
  readonly rowId: string;
  readonly verdicts: readonly JuliusDecisionAction[];
  readonly statuses: readonly JuliusFindingStatus[];
  readonly blocking: readonly boolean[];
  readonly trusts: readonly JuliusMemoryTrustState[];
  readonly result: 'INCOMPATIBLE' | 'COMPATIBLE';
}
export const JULIUS_ACCEPTANCE_INCOMPATIBLE_ROW = 'ACCEPT_X_OPEN_BLOCKING_VERIFIED';
export const JULIUS_VERDICT_FINDING_TABLE: readonly JuliusCompatibilityRow[] = Object.freeze([
  // THE FOUNDER'S ROW: accepted while a blocking finding of verified standing is still open. CONTRADICTS, FAIL CLOSED.
  { rowId: JULIUS_ACCEPTANCE_INCOMPATIBLE_ROW, verdicts: JULIUS_ACCEPTING_VERDICTS, statuses: ['OPEN'], blocking: [true], trusts: JULIUS_LINEAGE_VERIFIED_TRUSTS, result: 'INCOMPATIBLE' },
  // Below the verified rungs a finding's value is not VERIFIED, so rule 2 does not reach it.
  { rowId: 'ACCEPT_X_OPEN_BLOCKING_NOT_VERIFIED', verdicts: JULIUS_ACCEPTING_VERDICTS, statuses: ['OPEN'], blocking: [true], trusts: TRUSTS.filter((trust) => !isVerified(trust)), result: 'COMPATIBLE' },
  { rowId: 'ACCEPT_X_OPEN_NON_BLOCKING', verdicts: JULIUS_ACCEPTING_VERDICTS, statuses: ['OPEN'], blocking: [false], trusts: TRUSTS, result: 'COMPATIBLE' },
  // The founder's compatible row: a finding the run resolved (or dismissed) no longer disputes the acceptance.
  { rowId: 'ACCEPT_X_RESOLVED', verdicts: JULIUS_ACCEPTING_VERDICTS, statuses: ['RESOLVED', 'DISMISSED'], blocking: [true, false], trusts: TRUSTS, result: 'COMPATIBLE' },
  // A verdict that is not an acceptance disputes nothing: a REPAIR exists for the very finding it answers.
  { rowId: 'NOT_AN_ACCEPTANCE', verdicts: DECISION_ACTIONS.filter((action) => !JULIUS_ACCEPTING_VERDICTS.includes(action)), statuses: FINDING_STATUSES, blocking: [true, false], trusts: TRUSTS, result: 'COMPATIBLE' },
].map((row) => Object.freeze({ ...row, verdicts: Object.freeze([...row.verdicts]), statuses: Object.freeze([...row.statuses]), blocking: Object.freeze([...row.blocking]), trusts: Object.freeze([...row.trusts]) }) as JuliusCompatibilityRow));

/** The row a combination falls in. Throws if none does: the table is closed, and a gap is a defect, not a default. */
export function juliusVerdictFindingRow(input: {
  readonly verdict: JuliusDecisionAction; readonly status: JuliusFindingStatus; readonly blocking: boolean; readonly trust: JuliusMemoryTrustState;
}): JuliusCompatibilityRow {
  const row = JULIUS_VERDICT_FINDING_TABLE.find((candidate) => candidate.verdicts.includes(input.verdict)
    && candidate.statuses.includes(input.status) && candidate.blocking.includes(input.blocking) && candidate.trusts.includes(input.trust));
  if (row === undefined) throw new Error(`julius_compatibility_table_gap:${input.verdict}:${input.status}:${String(input.blocking)}:${input.trust}`);
  return row;
}

/* ----------------------------------------------------- lineage inside the qualification */

/** Why the asserter refused to let something stand as it was given. Recorded with the snapshot, never only logged. */
export interface JuliusLineageRefusal {
  readonly code: 'SYSTEM_POLICY_WITHOUT_DURABLE_DECISION' | 'GOVERNANCE_DECIDER_UNPROVEN' | 'GOVERNANCE_OPERATION_NOT_A_TOKEN';
  readonly subjectId: string;
}

/**
 * The qualification with lineage asserted (its `incompatible` holds rule 2's pairs, each sorted, the list sorted:
 * the compiler may not resolve them), and the refusals.
 */
export interface JuliusAssertedLineage {
  readonly qualification: JuliusContextQualification;
  readonly refusals: readonly JuliusLineageRefusal[];
}

const pairOf = (left: string, right: string): readonly [string, string] => (left < right ? [left, right] : [right, left]);
const byKey = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/**
 * RULES 1, 2 AND 4 OVER ONE QUALIFICATION.
 *
 * Within each subject, in order: a VERIFIED claim supersedes the latest earlier
 * claim of that subject (pointing at it), and every earlier claim of the subject
 * becomes SUPERSEDED, so it leaves the packet. A later claim that is not
 * verified supersedes nothing. Two verified claims at the SAME place in the
 * order with different values contradict each other and keep their trust, so
 * the compiler sees both and fails closed; with equal values they agree, and
 * nothing is asserted. Rule 4: a claim of `system_policy` provenance that is not
 * the locked contract's is demoted to the bottom rung, with a refusal, unless
 * it is a governance entry this module built from a durable decision.
 */
export function assertJuliusLineage(input: {
  readonly qualification: JuliusContextQualification;
  readonly entries: readonly JuliusBrainEntry[];
  /** The durable brain revision per entry id (julius_brain_entries.revision): family V's order. */
  readonly revisions: Readonly<Record<string, number>>;
  /** Entry ids of the governance entries `juliusGovernanceEntries` built: the only non-contract `system_policy` allowed. */
  readonly governanceEntryIds?: readonly string[];
}): JuliusAssertedLineage {
  const governance = new Set(input.governanceEntryIds ?? []);
  const refusals: JuliusLineageRefusal[] = [];
  const claims = new Map(input.qualification.claims.map((claim) => [claim.entryId, claim]));

  // RULE 4 FIRST, so a forged authority never takes part in lineage either.
  for (const [entryId, claim] of [...claims.entries()].sort(([left], [right]) => byKey(left, right))) {
    const contract = input.qualification.contextTypes[entryId] === 'CURRENT_CONTRACT';
    if (claim.provenance === 'system_policy' && !contract && !governance.has(entryId)) {
      claims.set(entryId, { ...claim, provenance: 'derived_candidate', trust: 'UNVERIFIED' });
      refusals.push({ code: 'SYSTEM_POLICY_WITHOUT_DURABLE_DECISION', subjectId: claim.claimId });
    }
  }

  const supersedes = new Map<string, string>();
  const superseded = new Set<string>();
  const contradicts = new Map<string, Set<string>>();
  const incompatible = new Map<string, readonly [string, string]>();
  const subjects = new Map<string, { placement: JuliusLineagePlacement; claim: JuliusMemoryClaim }[]>();
  for (const entry of input.entries) {
    const claim = claims.get(entry.entryId);
    const placement = placeJuliusLineageEntry(entry, input.revisions);
    if (claim === undefined || placement === null) continue;
    const key = `${placement.family}\u0000${placement.subject}`;
    subjects.set(key, [...(subjects.get(key) ?? []), { placement, claim }]);
  }
  for (const key of [...subjects.keys()].sort(byKey)) {
    // THE TOTAL ORDER: (order, entry id). Nothing about the input's own order survives this.
    const items = subjects.get(key)!.sort((left, right) => left.placement.order - right.placement.order || byKey(left.claim.entryId, right.claim.entryId));
    const orders = [...new Set(items.map((item) => item.placement.order))];
    for (const order of orders) {
      const here = items.filter((item) => item.placement.order === order);
      const earlier = items.filter((item) => item.placement.order < order);
      const verifiedHere = here.filter((item) => isVerified(item.claim.trust));
      // RULE 2 at one place in the order: unequal verified values contradict; equal ones agree.
      for (const [index, left] of verifiedHere.entries()) {
        for (const right of verifiedHere.slice(index + 1)) {
          if (left.placement.value === right.placement.value) continue;
          contradicts.set(left.claim.claimId, (contradicts.get(left.claim.claimId) ?? new Set()).add(right.claim.claimId));
          contradicts.set(right.claim.claimId, (contradicts.get(right.claim.claimId) ?? new Set()).add(left.claim.claimId));
          const pair = pairOf(left.claim.claimId, right.claim.claimId);
          incompatible.set(pair.join('\u0000'), pair);
        }
      }
      // RULE 1: a verified claim supersedes the latest earlier claim, and everything earlier leaves the packet.
      if (verifiedHere.length > 0 && earlier.length > 0) {
        const latestEarlierOrder = earlier.at(-1)!.placement.order;
        const target = earlier.filter((item) => item.placement.order === latestEarlierOrder)[0]!;
        for (const item of verifiedHere) supersedes.set(item.claim.claimId, target.claim.claimId);
        for (const item of earlier) superseded.add(item.claim.claimId);
      }
    }
  }

  const asserted = input.qualification.claims.map((original) => {
    const claim = claims.get(original.entryId) ?? original;
    const lineage = contradicts.get(claim.claimId);
    return {
      ...claim,
      trust: superseded.has(claim.claimId) ? 'SUPERSEDED' as const : claim.trust,
      supersedes: supersedes.get(claim.claimId) ?? claim.supersedes,
      contradicts: lineage === undefined ? claim.contradicts : [...new Set([...claim.contradicts, ...lineage])].sort(byKey),
    };
  });
  const pairs = [...(input.qualification.incompatible ?? []).map(([left, right]) => pairOf(left, right)), ...incompatible.values()];
  return {
    qualification: {
      ...input.qualification,
      claims: asserted,
      incompatible: [...new Map(pairs.map((pair) => [pair.join('\u0000'), pair])).values()]
        .sort((left, right) => byKey(left[0], right[0]) || byKey(left[1], right[1])),
    },
    refusals,
  };
}

/* ---------------------------------------------------------------- rule 2, run-wide */

/** A verdict as the run recorded it: its brain entry, the claim the run holds for it, and its durable revision. */
export interface JuliusRecordedVerdict {
  readonly entry: JuliusBrainEntry;
  readonly claim: JuliusMemoryClaim;
  readonly revision: number;
}
/** A finding in its effective state (after its lifecycle), with the entry and the claim the run holds for it. */
export interface JuliusRecordedFinding {
  readonly finding: JuliusReviewerFinding;
  readonly entryId: string;
  readonly claim: JuliusMemoryClaim;
}

/** One contradiction the run holds, with everything a reviewer needs to see it again. */
export interface JuliusRunContradiction {
  readonly family: 'A' | 'V';
  readonly subject: string;
  readonly rowId: string;
  readonly left: { readonly entryId: string; readonly claimId: string; readonly value: string; readonly trust: JuliusMemoryTrustState };
  readonly right: { readonly entryId: string; readonly claimId: string; readonly value: string; readonly trust: JuliusMemoryTrustState };
}

/**
 * EVERY CONTRADICTION THE RUN HOLDS, whatever any one packet would show.
 *
 * Per task, the latest verdict by durable revision (two verified verdicts at
 * the same revision with different actions are themselves a contradiction,
 * family V: an ordering that cannot be trusted is not a verdict). When that
 * verdict is an acceptance, every effective finding about the task is judged by
 * the table, and an INCOMPATIBLE row is a family A contradiction. Sorted, so the
 * same run gives the same list.
 */
export function juliusRunContradictions(input: {
  readonly verdicts: readonly JuliusRecordedVerdict[];
  readonly findings: readonly JuliusRecordedFinding[];
}): readonly JuliusRunContradiction[] {
  const found: JuliusRunContradiction[] = [];
  const latest = new Map<string, { placement: JuliusLineagePlacement; verdict: JuliusRecordedVerdict }[]>();
  for (const verdict of input.verdicts) {
    const placement = placeJuliusLineageEntry(verdict.entry, { [verdict.entry.entryId]: verdict.revision });
    if (placement === null || placement.family !== 'V' || !isVerified(verdict.claim.trust)) continue;
    const taskId = placement.subject.slice('verdict:'.length);
    const held = latest.get(taskId) ?? [];
    if (held.length === 0 || placement.order > held[0]!.placement.order) latest.set(taskId, [{ placement, verdict }]);
    else if (placement.order === held[0]!.placement.order) latest.set(taskId, [...held, { placement, verdict }]);
  }
  for (const taskId of [...latest.keys()].sort(byKey)) {
    const tied = latest.get(taskId)!.sort((left, right) => byKey(left.verdict.entry.entryId, right.verdict.entry.entryId));
    for (const [index, left] of tied.entries()) {
      for (const right of tied.slice(index + 1)) {
        if (left.placement.value === right.placement.value) continue;
        found.push({
          family: 'V', subject: `verdict:${taskId}`, rowId: 'VERDICTS_AT_ONE_REVISION',
          left: { entryId: left.verdict.entry.entryId, claimId: left.verdict.claim.claimId, value: left.placement.value, trust: left.verdict.claim.trust },
          right: { entryId: right.verdict.entry.entryId, claimId: right.verdict.claim.claimId, value: right.placement.value, trust: right.verdict.claim.trust },
        });
      }
    }
    for (const { placement, verdict } of tied) {
      const action = placement.value as JuliusDecisionAction;
      const findings = input.findings.filter((recorded) => recorded.finding.taskId === taskId)
        .sort((left, right) => byKey(left.entryId, right.entryId));
      for (const recorded of findings) {
        const row = juliusVerdictFindingRow({ verdict: action, status: recorded.finding.status, blocking: recorded.finding.blocking, trust: recorded.claim.trust });
        if (row.result !== 'INCOMPATIBLE') continue;
        found.push({
          family: 'A', subject: `acceptance:${taskId}`, rowId: row.rowId,
          left: { entryId: verdict.entry.entryId, claimId: verdict.claim.claimId, value: action, trust: verdict.claim.trust },
          right: { entryId: recorded.entryId, claimId: recorded.claim.claimId, value: 'OPEN_BLOCKING_VERIFIED', trust: recorded.claim.trust },
        });
      }
    }
  }
  return found.sort((left, right) => byKey(left.subject, right.subject) || byKey(left.left.entryId, right.left.entryId)
    || byKey(left.right.entryId, right.right.entryId));
}

/**
 * THE RUN'S CONTRADICTIONS FROM ITS DURABLE RECORDS: the brain (with each entry's revision), the effective
 * findings and the claim standings the run recorded. What a packet would hold does not matter here.
 *
 * A verdict's claim, and a finding's, is derived exactly as the context layer derives a DECISION or a FINDING entry,
 * then any standing the run recorded for it replaces the derivation (`mergeJuliusDurableStanding`, "the record
 * wins"). A finding's entry is built from the finding's OWN durable record — its reviewer, its time and the evidence
 * it cites — so a blocking finding that cites evidence stands VERIFIED, and one that cites none does not
 * (`needsEvidence`). The dispatch path's finding entries carry no provenance, so read from a packet every finding
 * would be UNVERIFIED and the founder's row could never be reached; it is built here from the record instead.
 */
export function juliusRunContradictionsFromRecords(input: {
  readonly brain: readonly JuliusBrainEntry[];
  /** Effective findings (`juliusEffectiveFindings`): OPEN only while unresolved. */
  readonly findings: readonly JuliusReviewerFinding[];
  readonly claims: readonly JuliusMemoryClaim[];
}): readonly JuliusRunContradiction[] {
  const verdictEntries = input.brain.filter((entry) => entry.revision !== undefined
    && placeJuliusLineageEntry(entry, { [entry.entryId]: entry.revision })?.family === 'V');
  const findingEntries = input.findings.map((finding) => ({
    finding,
    entry: {
      entryId: `finding:${finding.taskId}:${finding.findingId}`,
      kind: 'FINDING' as const,
      text: `REVIEW FINDING ${finding.findingId}`,
      taskIds: [finding.taskId],
      allowedRoles: [...JULIUS_DEFAULT_ROLES],
      sensitivity: 'INTERNAL' as const,
      provenance: { workerId: finding.reviewerWorkerId, recordedAt: finding.createdAt, evidenceIds: finding.evidenceIds },
    },
  }));
  const standing = mergeJuliusDurableStanding(
    deriveJuliusContextQualification([...verdictEntries, ...findingEntries.map((item) => item.entry)]),
    input.claims,
  );
  const claimFor = new Map(standing.claims.map((held) => [held.entryId, held]));
  return juliusRunContradictions({
    verdicts: verdictEntries.flatMap((entry) => {
      const held = claimFor.get(entry.entryId);
      return held === undefined ? [] : [{ entry, claim: held, revision: entry.revision! }];
    }),
    findings: findingEntries.flatMap(({ finding, entry }) => {
      const held = claimFor.get(entry.entryId);
      return held === undefined ? [] : [{ finding, entryId: entry.entryId, claim: held }];
    }),
  });
}

/**
 * A RUN CONTRADICTION AS EVENT FACTS: flat, closed values and ids only (an event's facts are scalars and bounded),
 * so a reviewer can read the pair back from the ledger after the halt. The first contradiction in full; all of them
 * as a bounded list.
 */
export function juliusContradictionFacts(contradictions: readonly JuliusRunContradiction[]): Readonly<Record<string, string | number>> {
  const first = contradictions[0];
  if (first === undefined) return {};
  const side = (held: JuliusRunContradiction['left']) => `${held.entryId}|${held.claimId}|${held.value}|${held.trust}`;
  return {
    contradictions: contradictions.length,
    contradictionFamily: first.family,
    contradictionSubject: first.subject,
    contradictionRow: first.rowId,
    contradictionLeft: side(first.left),
    contradictionRight: side(first.right),
    contradictionPairs: contradictions.map((held) => `${held.family}:${held.rowId}:${held.left.claimId}>${held.right.claimId}`).join(';').slice(0, 2_000),
  };
}

/** A run contradiction as the compiler records a conflict: unresolved, nothing kept. */
export const juliusContradictionConflict = (contradiction: JuliusRunContradiction): JuliusContextConflict => ({
  entryIds: [contradiction.left.entryId, contradiction.right.entryId],
  claimIds: [contradiction.left.claimId, contradiction.right.claimId],
  resolution: 'UNRESOLVED',
  keptClaimId: null,
  reasonCode: `INCOMPATIBLE_BY_COMPATIBILITY_TABLE:${contradiction.rowId}`,
});

/* --------------------------------------------------------------------- rule 3: GOVERNANCE */

/**
 * A DURABLE GOVERNANCE DECISION, exactly as its store row holds it. Approvals
 * only: a lifecycle decision joins when its actor is proven a durable operator
 * identity (founder ruling, 2026-10-03).
 */
export interface JuliusGovernanceDecision {
  readonly kind: 'APPROVAL';
  readonly decisionId: string;
  readonly taskId: string | null;
  readonly state: 'APPROVED' | 'DENIED';
  readonly operation: string;
  readonly policyRevision: string;
  readonly decidedBy: string;
  readonly decidedAt: string;
}

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u;

/**
 * RULES 3 AND 4: the packet entries, claims and context types governance
 * decisions become, and the ones refused. Built only from rows the durable read
 * returned, decided, by a decider that is no worker of this run; the text is
 * three closed values, never the decision's prose reason. The claim is
 * `system_policy`, so `classifyContextAuthority` ranks it GOVERNANCE.
 */
export function juliusGovernanceEntries(input: {
  readonly decisions: readonly JuliusGovernanceDecision[];
  /** Every worker id this run dispatches to: none of them may be a governance decider. */
  readonly workerIds: readonly string[];
}): {
  readonly entries: readonly JuliusBrainEntry[];
  readonly claims: readonly JuliusMemoryClaim[];
  readonly contextTypes: Readonly<Record<string, JuliusContextType>>;
  readonly recordedAt: Readonly<Record<string, string>>;
  readonly refusals: readonly JuliusLineageRefusal[];
} {
  const workers = new Set(input.workerIds);
  const entries: JuliusBrainEntry[] = [];
  const claims: JuliusMemoryClaim[] = [];
  const contextTypes: Record<string, JuliusContextType> = {};
  const recordedAt: Record<string, string> = {};
  const refusals: JuliusLineageRefusal[] = [];
  for (const decision of [...input.decisions].sort((left, right) => byKey(left.decisionId, right.decisionId))) {
    if (decision.state !== 'APPROVED' && decision.state !== 'DENIED') continue;
    const decider = decision.decidedBy.trim();
    if (decider === '' || workers.has(decider) || (JULIUS_DEFAULT_ROLES as readonly string[]).includes(decider) || decider.startsWith('SPECIALIST:')) {
      refusals.push({ code: 'GOVERNANCE_DECIDER_UNPROVEN', subjectId: decision.decisionId });
      continue;
    }
    if (!TOKEN.test(decision.operation) || !TOKEN.test(decision.policyRevision)) {
      refusals.push({ code: 'GOVERNANCE_OPERATION_NOT_A_TOKEN', subjectId: decision.decisionId });
      continue;
    }
    const entryId = `governance:approval:${decision.decisionId}`;
    entries.push({
      entryId,
      kind: 'DECISION',
      text: `GOVERNANCE ${decision.state} ${decision.operation} (policy ${decision.policyRevision})`,
      taskIds: decision.taskId === null ? [] : [decision.taskId],
      allowedRoles: [...JULIUS_DEFAULT_ROLES],
      sensitivity: 'INTERNAL',
      provenance: { workerId: decider, recordedAt: decision.decidedAt, evidenceIds: [] },
    });
    claims.push({
      claimId: `claim:${entryId}`,
      entryId,
      provenance: 'system_policy',
      trust: 'APPROVED',
      assertedBy: decider,
      assertedAt: decision.decidedAt,
      evidence: [{ kind: 'DECISION', id: decision.decisionId }],
      supersedes: null,
      contradicts: [],
    });
    contextTypes[entryId] = 'INSTRUCTION';
    recordedAt[entryId] = decision.decidedAt;
  }
  return { entries, claims, contextTypes, recordedAt, refusals };
}
