import { createHash } from 'node:crypto';

import { guardJuliusPeerResponse, type JuliusPeerLedgerEntry } from './julius-peer-channel';

/**
 * WHEN THE ARCHITECT AND THE REVIEWER DISAGREE, JULIUS DECIDES — ONCE, ON THE RECORD.
 *
 * A reviewer's CHALLENGE used to have nowhere to go: it could only become a
 * repair order for work that may not have been the problem, or be dropped. Now it
 * opens a DISAGREEMENT: a durable record of the subject, the reviewer's position
 * and evidence, the contract binding it was raised under, and — after exactly one
 * bounded rebuttal — the architect's position, the resolution and its basis.
 *
 * THE FLOW, AND WHY IT CANNOT LOOP.
 *
 *   Reviewer CHALLENGE ─► Julius opens the disagreement
 *                         ─► ONE rebuttal request to the architect (a task)
 *      CONCEDES ─────────────► CHALLENGE_UPHELD (the architect agreed)
 *      MAINTAINS with evidence ─► ONE independent re-review (a task)
 *          CONTINUE / WARNING ───► ARCHITECT_UPHELD
 *          anything stricter ────► CHALLENGE_UPHELD (the challenge was maintained)
 *      MAINTAINS, and the MISSION'S OWN TERMS must change
 *                            ─► ESCALATED — beyond Julius's authority
 *      no usable rebuttal ───► CHALLENGE_UPHELD (nothing answered it)
 *      nobody can rebut ─────► CHALLENGE_UPHELD (no worker serves a rebuttal)
 *
 * One rebuttal and one re-review, counted by the record's own state rather than
 * by a counter a restart would lose: a re-review that challenges again resolves
 * the disagreement instead of opening a second one. There is no third turn.
 *
 * WHAT A RESOLUTION DOES NOT DO. It never revises the contract. Where the
 * architect's position is that a mission-owned term must change, Julius does not
 * change it and does not let the argument continue: it ESCALATES, which halts
 * the affected work for whoever owns the mission.
 *
 * Pure: the only Node API is the digest that bounds a long identity.
 */

export const JULIUS_DISAGREEMENT_VERSION = 'julius-disagreement.v1' as const;

export const JULIUS_DISAGREEMENT_STATUSES = ['AWAITING_REBUTTAL', 'AWAITING_RE_REVIEW', 'RESOLVED'] as const;
export type JuliusDisagreementStatus = (typeof JULIUS_DISAGREEMENT_STATUSES)[number];

export const JULIUS_DISAGREEMENT_RESOLUTIONS = ['CHALLENGE_UPHELD', 'ARCHITECT_UPHELD', 'ESCALATED'] as const;
export type JuliusDisagreementResolution = (typeof JULIUS_DISAGREEMENT_RESOLUTIONS)[number];

export const JULIUS_DISAGREEMENT_BASES = [
  'ARCHITECT_CONCEDED',
  'RE_REVIEW_CONTINUED',
  'RE_REVIEW_MAINTAINED',
  'RE_REVIEW_BLOCKED',
  'REBUTTAL_UNUSABLE',
  'REBUTTAL_UNROUTABLE',
  'MISSION_TERMS_MUST_CHANGE',
] as const;
export type JuliusDisagreementBasis = (typeof JULIUS_DISAGREEMENT_BASES)[number];

export const JULIUS_DISAGREEMENT_LIMITS = Object.freeze({
  rebuttals: 1,
  reReviews: 1,
  argumentChars: 600,
  positionChars: 400,
  evidence: 8,
  locatorChars: 200,
  evidenceClaimChars: 240,
  ids: 16,
});

export interface JuliusDisagreement {
  readonly disagreementId: string;
  readonly version: typeof JULIUS_DISAGREEMENT_VERSION;
  readonly executionScope: string;
  readonly missionId: string;
  /** The work the challenge is about. */
  readonly subjectTaskId: string;
  /** The review that raised it, and the peer request that carried it to Julius. */
  readonly reviewTaskId: string;
  readonly challengeRequestId: string;
  /** Whether the challenge holds dependent work while it is argued. */
  readonly material: boolean;
  readonly category: string;
  readonly target: string;
  readonly reviewerPosition: string;
  readonly reviewerEvidenceIds: readonly string[];
  /** What the Coding Agent's work left on the record, which both positions are about. */
  readonly codingAgentEvidenceIds: readonly string[];
  readonly contractBindingDigest: string | null;
  readonly rebuttalTaskId: string | null;
  readonly architectPosition: 'CONCEDES' | 'MAINTAINS' | null;
  readonly architectArgument: string | null;
  readonly architectEvidence: readonly JuliusRebuttalEvidence[];
  readonly reReviewTaskId: string | null;
  readonly status: JuliusDisagreementStatus;
  readonly resolution: JuliusDisagreementResolution | null;
  readonly resolutionBasis: JuliusDisagreementBasis | null;
  readonly openedAt: string;
  readonly resolvedAt: string | null;
}

/* ---------------------------------------------------------------- identity */

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const identifier = (value: unknown, limit = 512): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= limit && IDENTIFIER.test(value) ? value : null;

/**
 * ONE DISAGREEMENT PER CHALLENGING REVIEW, PER EXECUTION ATTEMPT.
 *
 * The review task names the challenge; the execution scope separates two
 * workflow attempts of the same mission, whose run ids — and therefore whose
 * review task ids — are identical. Without the scope, attempt 4's disagreement
 * and attempt 5's would be one record wherever the two are read together.
 */
export function juliusDisagreementId(input: { readonly executionScope: string; readonly reviewTaskId: string }): string {
  const plain = `disagreement:${input.executionScope}:${input.reviewTaskId}`;
  if (plain.length <= 200) return plain;
  return `disagreement:${input.executionScope}:h-${createHash('sha256').update(input.reviewTaskId).digest('hex').slice(0, 32)}`;
}

/** The architect task that answers a disagreement, named for the review that raised it. */
export const juliusRebuttalTaskId = (reviewTaskId: string): string => `rebuttal:${reviewTaskId}:task`;

/** The review task id belonging to a rebuttal task, or null for anything else. */
export function juliusRebuttalReviewTaskId(taskId: string): string | null {
  const match = /^rebuttal:(.+):task$/u.exec(taskId);
  return match === null ? null : match[1]!;
}

/* ----------------------------------------------------------------- opening */

const safeLine = (value: unknown, limit: number): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (text.length === 0) return null;
  if (/(?:api[_-]?key|authorization|bearer|token|secret|password)\s*[=:]/iu.test(text)) return null;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};

const idList = (value: readonly unknown[] | undefined): readonly string[] | null => {
  const list = value ?? [];
  if (list.length > JULIUS_DISAGREEMENT_LIMITS.ids) return null;
  const out: string[] = [];
  for (const item of list) {
    const id = identifier(item, 200);
    if (id === null) return null;
    if (!out.includes(id)) out.push(id);
  }
  return out.join(' ').length > 1024 ? null : Object.freeze(out);
};

export type JuliusDisagreementOpening =
  | { readonly outcome: 'OPENED'; readonly disagreement: JuliusDisagreement }
  | { readonly outcome: 'REFUSED'; readonly reasonCode: string };

export function openJuliusDisagreement(input: {
  readonly executionScope: string;
  readonly missionId: string;
  readonly subjectTaskId: string;
  readonly reviewTaskId: string;
  readonly challengeRequestId: string;
  readonly material: boolean;
  readonly category: string;
  readonly target: string;
  readonly reviewerPosition: string;
  readonly reviewerEvidenceIds: readonly string[];
  readonly codingAgentEvidenceIds: readonly string[];
  readonly contractBindingDigest: string | null;
  readonly openedAt: string;
}): JuliusDisagreementOpening {
  const executionScope = identifier(input.executionScope, 64);
  const missionId = identifier(input.missionId);
  const subjectTaskId = identifier(input.subjectTaskId);
  const reviewTaskId = identifier(input.reviewTaskId);
  const challengeRequestId = identifier(input.challengeRequestId, 200);
  const openedAt = identifier(input.openedAt);
  if (executionScope === null || missionId === null || subjectTaskId === null || reviewTaskId === null
    || challengeRequestId === null || openedAt === null) {
    return { outcome: 'REFUSED', reasonCode: 'disagreement_identity_required' };
  }
  const category = identifier(input.category, 64);
  const target = identifier(input.target, 32);
  if (category === null || target === null) return { outcome: 'REFUSED', reasonCode: 'disagreement_challenge_invalid' };
  const reviewerPosition = safeLine(input.reviewerPosition, JULIUS_DISAGREEMENT_LIMITS.positionChars);
  if (reviewerPosition === null) return { outcome: 'REFUSED', reasonCode: 'disagreement_position_invalid' };
  const reviewerEvidenceIds = idList(input.reviewerEvidenceIds);
  const codingAgentEvidenceIds = idList(input.codingAgentEvidenceIds);
  if (reviewerEvidenceIds === null || codingAgentEvidenceIds === null) {
    return { outcome: 'REFUSED', reasonCode: 'disagreement_evidence_invalid' };
  }
  // THE SAME RULE AS THE CHALLENGE THAT OPENED IT: an accusation cites.
  if (reviewerEvidenceIds.length === 0) return { outcome: 'REFUSED', reasonCode: 'disagreement_requires_reviewer_evidence' };
  if (input.contractBindingDigest !== null && !DIGEST.test(input.contractBindingDigest)) {
    return { outcome: 'REFUSED', reasonCode: 'disagreement_binding_invalid' };
  }
  return {
    outcome: 'OPENED',
    disagreement: Object.freeze({
      disagreementId: juliusDisagreementId({ executionScope, reviewTaskId }),
      version: JULIUS_DISAGREEMENT_VERSION,
      executionScope, missionId, subjectTaskId, reviewTaskId, challengeRequestId,
      material: input.material, category, target, reviewerPosition, reviewerEvidenceIds, codingAgentEvidenceIds,
      contractBindingDigest: input.contractBindingDigest,
      rebuttalTaskId: null, architectPosition: null, architectArgument: null, architectEvidence: Object.freeze([]),
      reReviewTaskId: null,
      status: 'AWAITING_REBUTTAL' as const, resolution: null, resolutionBasis: null,
      openedAt, resolvedAt: null,
    }),
  };
}

/* ---------------------------------------------------------------- rebuttal */

export interface JuliusRebuttalEvidence {
  readonly locator: string;
  readonly claim: string;
}

export interface JuliusRebuttal {
  readonly position: 'CONCEDES' | 'MAINTAINS';
  readonly argument: string;
  readonly evidence: readonly JuliusRebuttalEvidence[];
  /** The architect's view that a MISSION-OWNED term must change for its position to stand. */
  readonly missionTermsMustChange: boolean;
}

export type JuliusRebuttalReading =
  | { readonly ok: true; readonly rebuttal: JuliusRebuttal }
  | { readonly ok: false; readonly reasonCode: string };

/**
 * THE ARCHITECT'S ONE ANSWER, rebuilt from an allowlist.
 *
 * A position that MAINTAINS must bring evidence — a locator and what it shows —
 * because the re-review that follows is a judgement of that evidence, and a
 * maintained position with nothing to judge is an assertion. The authority guard
 * runs first: a rebuttal cannot revise the contract, set the budget or declare
 * the work verified, however it phrases the attempt.
 */
export function sanitizeJuliusRebuttal(value: unknown): JuliusRebuttalReading {
  const guarded = guardJuliusPeerResponse(value);
  if (!guarded.ok) return { ok: false, reasonCode: guarded.reasonCode };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reasonCode: 'rebuttal_shape_refused' };
  const source = value as Record<string, unknown>;
  const word = typeof source.position === 'string' ? source.position.trim().toUpperCase() : '';
  if (word !== 'CONCEDES' && word !== 'MAINTAINS') return { ok: false, reasonCode: 'rebuttal_position_unknown' };
  const argument = safeLine(source.argument, JULIUS_DISAGREEMENT_LIMITS.argumentChars);
  if (argument === null) return { ok: false, reasonCode: 'rebuttal_argument_invalid' };
  const raw = source.evidence ?? [];
  if (!Array.isArray(raw) || raw.length > JULIUS_DISAGREEMENT_LIMITS.evidence) return { ok: false, reasonCode: 'rebuttal_evidence_invalid' };
  const evidence: JuliusRebuttalEvidence[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return { ok: false, reasonCode: 'rebuttal_evidence_invalid' };
    const entry = item as Record<string, unknown>;
    const locator = safeLine(entry.locator, JULIUS_DISAGREEMENT_LIMITS.locatorChars);
    const claim = safeLine(entry.claim, JULIUS_DISAGREEMENT_LIMITS.evidenceClaimChars);
    if (locator === null || claim === null) return { ok: false, reasonCode: 'rebuttal_evidence_invalid' };
    evidence.push(Object.freeze({ locator, claim }));
  }
  if (word === 'MAINTAINS' && evidence.length === 0) return { ok: false, reasonCode: 'rebuttal_maintains_without_evidence' };
  const flag = source.missionTermsMustChange ?? false;
  if (typeof flag !== 'boolean') return { ok: false, reasonCode: 'rebuttal_shape_refused' };
  return { ok: true, rebuttal: Object.freeze({ position: word, argument, evidence: Object.freeze(evidence), missionTermsMustChange: flag }) };
}

/* ---------------------------------------------------------------- resolution */

export type JuliusDisagreementStep =
  | { readonly kind: 'REBUTTAL_UNROUTABLE' }
  | { readonly kind: 'REBUTTAL_SCHEDULED'; readonly rebuttalTaskId: string }
  | { readonly kind: 'REBUTTAL'; readonly rebuttal: JuliusRebuttal | null }
  | { readonly kind: 'RE_REVIEW_SCHEDULED'; readonly reReviewTaskId: string }
  | { readonly kind: 'RE_REVIEW'; readonly verdict: string | null };

export type JuliusDisagreementTransition =
  | { readonly outcome: 'MOVED'; readonly disagreement: JuliusDisagreement; readonly resolved: boolean }
  | { readonly outcome: 'REFUSED'; readonly reasonCode: string };

/**
 * THE ONLY WAY A DISAGREEMENT MOVES, and the whole of the bound.
 *
 * Every step is legal from exactly one status, so a second rebuttal, a second
 * re-review, or any step after resolution is refused — not ignored, refused —
 * and the record cannot grow a third turn however the tasks are replayed.
 */
export function advanceJuliusDisagreement(
  current: JuliusDisagreement,
  step: JuliusDisagreementStep,
  at: string,
): JuliusDisagreementTransition {
  const resolve = (resolution: JuliusDisagreementResolution, basis: JuliusDisagreementBasis, extra: Partial<JuliusDisagreement> = {}) => ({
    outcome: 'MOVED' as const,
    resolved: true,
    disagreement: Object.freeze({ ...current, ...extra, status: 'RESOLVED' as const, resolution, resolutionBasis: basis, resolvedAt: at }),
  });
  if (current.status === 'RESOLVED') return { outcome: 'REFUSED', reasonCode: 'disagreement_already_resolved' };

  switch (step.kind) {
    case 'REBUTTAL_UNROUTABLE':
      if (current.status !== 'AWAITING_REBUTTAL' || current.rebuttalTaskId !== null) return { outcome: 'REFUSED', reasonCode: 'disagreement_step_out_of_order' };
      return resolve('CHALLENGE_UPHELD', 'REBUTTAL_UNROUTABLE');
    case 'REBUTTAL_SCHEDULED':
      if (current.status !== 'AWAITING_REBUTTAL' || current.rebuttalTaskId !== null) return { outcome: 'REFUSED', reasonCode: 'disagreement_rebuttal_bound_reached' };
      return { outcome: 'MOVED', resolved: false, disagreement: Object.freeze({ ...current, rebuttalTaskId: step.rebuttalTaskId }) };
    case 'REBUTTAL': {
      if (current.status !== 'AWAITING_REBUTTAL' || current.rebuttalTaskId === null) return { outcome: 'REFUSED', reasonCode: 'disagreement_step_out_of_order' };
      if (step.rebuttal === null) return resolve('CHALLENGE_UPHELD', 'REBUTTAL_UNUSABLE');
      const argued = {
        architectPosition: step.rebuttal.position,
        architectArgument: step.rebuttal.argument,
        architectEvidence: step.rebuttal.evidence,
      };
      if (step.rebuttal.position === 'CONCEDES') return resolve('CHALLENGE_UPHELD', 'ARCHITECT_CONCEDED', argued);
      if (step.rebuttal.missionTermsMustChange) return resolve('ESCALATED', 'MISSION_TERMS_MUST_CHANGE', argued);
      return { outcome: 'MOVED', resolved: false, disagreement: Object.freeze({ ...current, ...argued, status: 'AWAITING_RE_REVIEW' as const }) };
    }
    case 'RE_REVIEW_SCHEDULED':
      if (current.status !== 'AWAITING_RE_REVIEW' || current.reReviewTaskId !== null) return { outcome: 'REFUSED', reasonCode: 'disagreement_re_review_bound_reached' };
      return { outcome: 'MOVED', resolved: false, disagreement: Object.freeze({ ...current, reReviewTaskId: step.reReviewTaskId }) };
    case 'RE_REVIEW':
      if (current.status !== 'AWAITING_RE_REVIEW' || current.reReviewTaskId === null) return { outcome: 'REFUSED', reasonCode: 'disagreement_step_out_of_order' };
      if (step.verdict === 'CONTINUE' || step.verdict === 'WARNING') return resolve('ARCHITECT_UPHELD', 'RE_REVIEW_CONTINUED');
      if (step.verdict === 'BLOCK') return resolve('CHALLENGE_UPHELD', 'RE_REVIEW_BLOCKED');
      // A re-review that challenges again, requires repair, or says nothing
      // usable maintains the challenge. It never opens a second disagreement.
      return resolve('CHALLENGE_UPHELD', 'RE_REVIEW_MAINTAINED');
    default:
      return { outcome: 'REFUSED', reasonCode: 'disagreement_step_unknown' };
  }
}

/* ---------------------------------------------------------------- ledger */

const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const ids = (value: unknown): readonly string[] => (typeof value === 'string' && value.length > 0 ? value.split(' ') : []);

export function juliusDisagreementOpenedFacts(disagreement: JuliusDisagreement): Record<string, string | number | boolean | null> {
  return {
    disagreementId: disagreement.disagreementId,
    version: disagreement.version,
    executionScope: disagreement.executionScope,
    missionId: disagreement.missionId,
    subjectTaskId: disagreement.subjectTaskId,
    reviewTaskId: disagreement.reviewTaskId,
    challengeRequestId: disagreement.challengeRequestId,
    material: disagreement.material,
    category: disagreement.category,
    target: disagreement.target,
    reviewerPosition: disagreement.reviewerPosition,
    reviewerEvidenceIds: disagreement.reviewerEvidenceIds.join(' '),
    codingAgentEvidenceIds: disagreement.codingAgentEvidenceIds.join(' '),
    contractBindingDigest: disagreement.contractBindingDigest,
    openedAt: disagreement.openedAt,
  };
}

/** One step of a disagreement as a ledger row. */
export function juliusDisagreementStepFacts(
  disagreementId: string,
  step: JuliusDisagreementStep,
  at: string,
): Record<string, string | number | boolean | null> {
  const base = { disagreementId, step: step.kind, at };
  switch (step.kind) {
    case 'REBUTTAL_SCHEDULED': return { ...base, rebuttalTaskId: step.rebuttalTaskId };
    case 'RE_REVIEW_SCHEDULED': return { ...base, reReviewTaskId: step.reReviewTaskId };
    case 'RE_REVIEW': return { ...base, verdict: step.verdict };
    case 'REBUTTAL': return step.rebuttal === null
      ? { ...base, position: null }
      : {
        ...base, position: step.rebuttal.position, argument: step.rebuttal.argument,
        evidence: JSON.stringify(step.rebuttal.evidence), missionTermsMustChange: step.rebuttal.missionTermsMustChange,
      };
    default: return base;
  }
}

/**
 * EVERY DISAGREEMENT'S CURRENT STATE, FROM THE LEDGER ALONE.
 *
 * `disagreement.opened` creates a record; each `disagreement.step` is applied
 * through `advanceJuliusDisagreement`, so a replayed or out-of-order step is
 * refused exactly as it would have been live, and the fold reaches the state the
 * runtime reached. Nothing else stores it.
 */
export function foldJuliusDisagreements(entries: readonly JuliusPeerLedgerEntry[]): readonly JuliusDisagreement[] {
  const byId = new Map<string, JuliusDisagreement>();
  for (const entry of entries) {
    const facts = entry.facts;
    if (entry.type === 'disagreement.opened') {
      const opened = openJuliusDisagreement({
        executionScope: text(facts.executionScope) ?? '',
        missionId: text(facts.missionId) ?? '',
        subjectTaskId: text(facts.subjectTaskId) ?? '',
        reviewTaskId: text(facts.reviewTaskId) ?? '',
        challengeRequestId: text(facts.challengeRequestId) ?? '',
        material: facts.material === true,
        category: text(facts.category) ?? '',
        target: text(facts.target) ?? '',
        reviewerPosition: text(facts.reviewerPosition) ?? '',
        reviewerEvidenceIds: ids(facts.reviewerEvidenceIds),
        codingAgentEvidenceIds: ids(facts.codingAgentEvidenceIds),
        contractBindingDigest: text(facts.contractBindingDigest),
        openedAt: text(facts.openedAt) ?? '',
      });
      if (opened.outcome === 'OPENED' && !byId.has(opened.disagreement.disagreementId)) {
        byId.set(opened.disagreement.disagreementId, opened.disagreement);
      }
      continue;
    }
    if (entry.type !== 'disagreement.step') continue;
    const current = byId.get(text(facts.disagreementId) ?? '');
    if (current === undefined) continue;
    const at = text(facts.at) ?? '';
    let step: JuliusDisagreementStep | null = null;
    switch (facts.step) {
      case 'REBUTTAL_UNROUTABLE': step = { kind: 'REBUTTAL_UNROUTABLE' }; break;
      case 'REBUTTAL_SCHEDULED': step = { kind: 'REBUTTAL_SCHEDULED', rebuttalTaskId: text(facts.rebuttalTaskId) ?? '' }; break;
      case 'RE_REVIEW_SCHEDULED': step = { kind: 'RE_REVIEW_SCHEDULED', reReviewTaskId: text(facts.reReviewTaskId) ?? '' }; break;
      case 'RE_REVIEW': step = { kind: 'RE_REVIEW', verdict: text(facts.verdict) }; break;
      case 'REBUTTAL': {
        let evidence: unknown = [];
        try { evidence = typeof facts.evidence === 'string' ? JSON.parse(facts.evidence) : []; } catch { evidence = null; }
        const reading = facts.position === null || facts.position === undefined
          ? null
          : sanitizeJuliusRebuttal({
            position: facts.position, argument: facts.argument, evidence, missionTermsMustChange: facts.missionTermsMustChange,
          });
        step = { kind: 'REBUTTAL', rebuttal: reading !== null && reading.ok ? reading.rebuttal : null };
        break;
      }
      default: step = null;
    }
    if (step === null) continue;
    const moved = advanceJuliusDisagreement(current, step, at);
    if (moved.outcome === 'MOVED') byId.set(current.disagreementId, moved.disagreement);
  }
  return Object.freeze([...byId.values()]);
}
