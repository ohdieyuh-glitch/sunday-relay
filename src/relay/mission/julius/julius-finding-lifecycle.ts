import type { JuliusPeerLedgerEntry } from './julius-peer-channel';
import type { JuliusReviewerFinding } from './julius-verification-runtime';

/**
 * A FINDING HAS A LIFE, AND ONLY A REVIEWER ENDS IT.
 *
 * Findings were recorded OPEN and stayed OPEN forever. A repair ran, a
 * re-review passed, the mission completed — and the record still said the
 * problem was open, because nothing ever said otherwise. The reverse mistake is
 * worse and is the one this exists to refuse: marking a finding resolved
 * because code changed. Changed code is not evidence that the problem is gone;
 * an independent reviewer saying so is.
 *
 *   OPEN        recorded by a review, and not yet answered.
 *   ADDRESSED   a repair of the work it is about has SUCCEEDED. The claim is
 *               that someone has acted, not that it worked.
 *   RESOLVED    an independent re-review looked at the repair and said this
 *               finding is answered. Only a reviewer's own declaration reaches
 *               here, and only through the review of the repair.
 *   SUPERSEDED  the problem changed shape and a new finding replaces it. The
 *               replacement is named, so the chain stays followable.
 *
 * WHAT MAY NOT HAPPEN, in the transitions rather than in a comment: nothing
 * moves to RESOLVED except from a reviewer's resolution; ADDRESSED never
 * implies RESOLVED; a RESOLVED finding is terminal; a re-review that says the
 * problem is still there returns it to OPEN, and the next repair round is what
 * answers it.
 *
 * IDENTITY IS PRESERVED. The same finding id travels from the review that
 * raised it, through the repair, to the re-review that ends it, so "was it
 * fixed?" is a question about one row rather than a guess across several. The
 * state is a fold over `finding.transitioned` rows, so it reconstructs from the
 * ledger and has no second copy anywhere.
 *
 * Pure: no clock, no network, no Node API.
 */

export const JULIUS_FINDING_LIFECYCLE_VERSION = 'julius-finding-lifecycle.v1' as const;

export const JULIUS_FINDING_STATES = ['OPEN', 'ADDRESSED', 'RESOLVED', 'SUPERSEDED'] as const;
export type JuliusFindingState = (typeof JULIUS_FINDING_STATES)[number];

/** Who or what moved it, as a closed vocabulary. */
export const JULIUS_FINDING_MOVES = [
  'REPAIR_SUCCEEDED',
  'REVIEWER_RESOLVED',
  'REVIEWER_MAINTAINED',
  'REVIEWER_SUPERSEDED',
] as const;
export type JuliusFindingMove = (typeof JULIUS_FINDING_MOVES)[number];

export const JULIUS_FINDING_TRANSITIONS: Readonly<Record<JuliusFindingState, readonly JuliusFindingState[]>> = Object.freeze({
  OPEN: ['ADDRESSED', 'RESOLVED', 'SUPERSEDED'],
  ADDRESSED: ['RESOLVED', 'OPEN', 'SUPERSEDED'],
  RESOLVED: [],
  SUPERSEDED: [],
});

/** What each move is allowed to do, so a repair can never resolve anything. */
export const JULIUS_FINDING_MOVE_RESULTS: Readonly<Record<JuliusFindingMove, JuliusFindingState>> = Object.freeze({
  REPAIR_SUCCEEDED: 'ADDRESSED',
  REVIEWER_RESOLVED: 'RESOLVED',
  REVIEWER_MAINTAINED: 'OPEN',
  REVIEWER_SUPERSEDED: 'SUPERSEDED',
});

export interface JuliusFindingLife {
  readonly findingId: string;
  /** The work the finding is about — unchanged for the finding's whole life. */
  readonly taskId: string;
  readonly category: string;
  readonly severity: string;
  readonly criterionId: string | null;
  readonly blocking: boolean;
  readonly claim: string;
  readonly evidenceIds: readonly string[];
  /** The review that raised it. */
  readonly originReviewTaskId: string | null;
  readonly state: JuliusFindingState;
  /** The repair rounds that claimed to address it, in order. */
  readonly repairTaskIds: readonly string[];
  /** The review that ended it, when one has. */
  readonly resolutionReviewTaskId: string | null;
  readonly supersededByFindingId: string | null;
  readonly lastMove: JuliusFindingMove | null;
}

export interface JuliusFindingTransition {
  readonly findingId: string;
  readonly move: JuliusFindingMove;
  readonly at: string;
  readonly reviewTaskId?: string | null;
  readonly repairTaskId?: string | null;
  readonly supersededByFindingId?: string | null;
}

export type JuliusFindingMoveOutcome =
  | { readonly outcome: 'MOVED'; readonly life: JuliusFindingLife }
  | { readonly outcome: 'REFUSED'; readonly reasonCode: string };

const CODE = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,200}$/u;

/** The finding as it is first recorded: open, about one task, raised by one review. */
export function juliusFindingLife(
  finding: Pick<JuliusReviewerFinding, 'findingId' | 'taskId' | 'category' | 'severity' | 'criterionId' | 'blocking' | 'claim' | 'evidenceIds'>,
  originReviewTaskId: string | null,
): JuliusFindingLife {
  return Object.freeze({
    findingId: finding.findingId,
    taskId: finding.taskId,
    category: finding.category,
    severity: finding.severity,
    criterionId: finding.criterionId,
    blocking: finding.blocking,
    claim: finding.claim,
    evidenceIds: Object.freeze([...finding.evidenceIds]),
    originReviewTaskId,
    state: 'OPEN' as const,
    repairTaskIds: Object.freeze([]),
    resolutionReviewTaskId: null,
    supersededByFindingId: null,
    lastMove: null,
  });
}

/**
 * MOVE A FINDING, OR REFUSE.
 *
 * `REVIEWER_SUPERSEDED` must name the replacement: a superseded finding whose
 * successor nobody recorded is a problem that left the record while looking
 * answered.
 */
export function moveJuliusFinding(life: JuliusFindingLife, transition: JuliusFindingTransition): JuliusFindingMoveOutcome {
  if (!(JULIUS_FINDING_MOVES as readonly string[]).includes(transition.move)) {
    return { outcome: 'REFUSED', reasonCode: 'finding_move_unknown' };
  }
  const to = JULIUS_FINDING_MOVE_RESULTS[transition.move];
  if (!JULIUS_FINDING_TRANSITIONS[life.state].includes(to)) {
    return { outcome: 'REFUSED', reasonCode: life.state === to ? 'finding_move_repeated' : 'finding_move_illegal' };
  }
  if (transition.move === 'REVIEWER_SUPERSEDED') {
    const replacement = transition.supersededByFindingId ?? '';
    if (!CODE.test(replacement) || replacement === life.findingId) {
      return { outcome: 'REFUSED', reasonCode: 'finding_supersession_requires_replacement' };
    }
  }
  if (transition.move === 'REPAIR_SUCCEEDED') {
    const repair = transition.repairTaskId ?? '';
    if (!CODE.test(repair)) return { outcome: 'REFUSED', reasonCode: 'finding_addressed_requires_repair' };
    if (life.repairTaskIds.includes(repair)) return { outcome: 'REFUSED', reasonCode: 'finding_move_repeated' };
  }
  if ((transition.move === 'REVIEWER_RESOLVED' || transition.move === 'REVIEWER_MAINTAINED') && !CODE.test(transition.reviewTaskId ?? '')) {
    return { outcome: 'REFUSED', reasonCode: 'finding_resolution_requires_review' };
  }
  return {
    outcome: 'MOVED',
    life: Object.freeze({
      ...life,
      state: to,
      lastMove: transition.move,
      repairTaskIds: transition.move === 'REPAIR_SUCCEEDED'
        ? Object.freeze([...life.repairTaskIds, transition.repairTaskId!])
        : life.repairTaskIds,
      resolutionReviewTaskId: transition.move === 'REVIEWER_RESOLVED' ? transition.reviewTaskId! : life.resolutionReviewTaskId,
      supersededByFindingId: transition.move === 'REVIEWER_SUPERSEDED' ? transition.supersededByFindingId! : life.supersededByFindingId,
    }),
  };
}

export function juliusFindingTransitionFacts(transition: JuliusFindingTransition): Record<string, string | number | boolean | null> {
  return {
    findingId: transition.findingId,
    move: transition.move,
    to: JULIUS_FINDING_MOVE_RESULTS[transition.move],
    at: transition.at,
    reviewTaskId: transition.reviewTaskId ?? null,
    repairTaskId: transition.repairTaskId ?? null,
    supersededByFindingId: transition.supersededByFindingId ?? null,
  };
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/**
 * EVERY FINDING'S LIFE, FROM THE ROWS THAT EXIST.
 *
 * The durable finding rows say what was found; the ledger says what happened to
 * it. A transition that is not legal from where the finding is — a replayed
 * row, a repair claiming to resolve, a move after a resolution — is ignored
 * exactly as it would have been refused live, so the fold reaches the state the
 * runtime reached.
 */
export function foldJuliusFindings(
  findings: readonly JuliusReviewerFinding[],
  entries: readonly JuliusPeerLedgerEntry[],
): readonly JuliusFindingLife[] {
  const origin = new Map<string, string | null>();
  for (const entry of entries) {
    if (entry.type !== 'finding.recorded') continue;
    const findingId = text(entry.facts.findingId);
    if (findingId !== null) origin.set(findingId, text(entry.facts.reviewTaskId));
  }
  const byId = new Map<string, JuliusFindingLife>();
  for (const finding of findings) byId.set(finding.findingId, juliusFindingLife(finding, origin.get(finding.findingId) ?? null));
  for (const entry of entries) {
    if (entry.type !== 'finding.transitioned') continue;
    const findingId = text(entry.facts.findingId);
    const current = findingId === null ? undefined : byId.get(findingId);
    if (current === undefined) continue;
    const move = text(entry.facts.move);
    if (move === null) continue;
    const moved = moveJuliusFinding(current, {
      findingId: current.findingId,
      move: move as JuliusFindingMove,
      at: text(entry.facts.at) ?? '',
      reviewTaskId: text(entry.facts.reviewTaskId),
      repairTaskId: text(entry.facts.repairTaskId),
      supersededByFindingId: text(entry.facts.supersededByFindingId),
    });
    if (moved.outcome === 'MOVED') byId.set(current.findingId, moved.life);
  }
  return Object.freeze([...byId.values()]);
}

/**
 * IS THIS FINDING STILL A PROBLEM ON THE RECORD — whether or not it blocks.
 *
 *   OPEN        unresolved.
 *   ADDRESSED   unresolved: someone acted; nobody independent said it worked.
 *   RESOLVED    resolved.
 *   SUPERSEDED  resolved ONLY when the replacement it names is a finding the run
 *               actually recorded. A supersession naming nothing that exists is
 *               a problem that left the record while looking answered.
 */
export function juliusFindingIsUnresolved(life: JuliusFindingLife, lives: readonly JuliusFindingLife[]): boolean {
  if (life.state === 'OPEN' || life.state === 'ADDRESSED') return true;
  if (life.state === 'SUPERSEDED') {
    const replacement = life.supersededByFindingId;
    return replacement === null || replacement === life.findingId || !lives.some((other) => other.findingId === replacement);
  }
  return false;
}

/** A finding still counts against the work while it blocks and is unresolved. */
export const juliusFindingIsOutstanding = (life: JuliusFindingLife, lives: readonly JuliusFindingLife[]): boolean =>
  life.blocking && juliusFindingIsUnresolved(life, lives);

/**
 * THE FINDING ROWS AS THE LEDGER SAYS THEY ARE — ONE TRUTH.
 *
 * A finding row is written once, `OPEN`, and never updated; the ledger is where
 * its life is. Verification and completion used to read the row, so a finding a
 * re-review RESOLVED still counted as OPEN on its row, and a finding merely
 * ADDRESSED counted as nothing at all once the decision moved to the repair.
 * Every reader of a finding's status now reads this projection: `OPEN` when the
 * lifecycle says it is unresolved, `RESOLVED` when it is resolved. The row's own
 * stored status is not consulted.
 */
export function juliusEffectiveFindings(
  findings: readonly JuliusReviewerFinding[],
  entries: readonly JuliusPeerLedgerEntry[],
): readonly JuliusReviewerFinding[] {
  const lives = foldJuliusFindings(findings, entries);
  const byId = new Map(lives.map((life) => [life.findingId, life]));
  return Object.freeze(findings.map((finding) => {
    const life = byId.get(finding.findingId);
    const unresolved = life === undefined || juliusFindingIsUnresolved(life, lives);
    return Object.freeze({ ...finding, status: unresolved ? 'OPEN' as const : 'RESOLVED' as const });
  }));
}

export type JuliusFindingsCompletionGate =
  | { readonly ok: true; readonly reasonCode: 'FINDINGS_RESOLVED' }
  | { readonly ok: false; readonly reasonCode: 'FINDINGS_UNRESOLVED'; readonly findingIds: readonly string[] };

/**
 * A RUN WITH A BLOCKING FINDING NOBODY RESOLVED DOES NOT COMPLETE.
 *
 * Reproduced on main 5c53cb93: a build was rejected, repaired, and re-reviewed by
 * a reviewer that said nothing about the finding; the repair was accepted, and
 * the run COMPLETED with the finding still ADDRESSED. The gate can only HOLD —
 * it accepts nothing, repairs nothing and completes nothing — and it names the
 * findings it holds for.
 */
export function juliusFindingsCompletionGate(input: {
  readonly findings: readonly JuliusReviewerFinding[];
  readonly entries: readonly JuliusPeerLedgerEntry[];
}): JuliusFindingsCompletionGate {
  const lives = foldJuliusFindings(input.findings, input.entries);
  const outstanding = lives.filter((life) => juliusFindingIsOutstanding(life, lives)).map((life) => life.findingId);
  return outstanding.length === 0
    ? { ok: true, reasonCode: 'FINDINGS_RESOLVED' }
    : { ok: false, reasonCode: 'FINDINGS_UNRESOLVED', findingIds: Object.freeze(outstanding) };
}
