import {
  JULIUS_CHALLENGE_CATEGORIES, JULIUS_CHECKPOINT_VERDICTS, juliusChallengeIsMaterial,
  type JuliusChallengeCategory, type JuliusCheckpointVerdict,
} from './julius-continuous-lifecycle';
import { guardJuliusPeerResponse } from './julius-peer-channel';

/**
 * THE REVIEWER'S VERDICT, AS JULIUS READS IT.
 *
 * The canonical vocabulary — CONTINUE, WARNING, CHALLENGE, REPAIR_REQUIRED,
 * BLOCK — existed in the kernel with no live caller. The live reviewer spoke in
 * evidence alone: one PASSED or FAILED `REVIEW_FINDING`, so a reviewer could
 * approve or send back and nothing else. A minor concern on approved work was
 * dropped, a dispute about the plan was indistinguishable from a bug in the
 * code, and "this must not continue" had no way to be said.
 *
 * WHAT THIS MODULE DECIDES, and what it does not.
 *
 *   - What a reviewer DECLARED, rebuilt from an allowlist. A peer output that
 *     names a Julius-only outcome or a mission-owned term is refused by name
 *     before anything else is read.
 *   - What the reviewer's EVIDENCE says, in the same vocabulary, so a review
 *     with no declaration still has a verdict.
 *   - The EFFECTIVE verdict: the stricter of the two. A reviewer cannot talk its
 *     own FAILED evidence into a CONTINUE, and FAILED evidence cannot quietly
 *     erase a BLOCK.
 *   - The ROUTE Julius takes. The route is Julius's: the reviewer says what it
 *     saw, and nothing here lets it choose the consequence. It never emits
 *     VERIFIED, and no route mints a decision the verification evaluator would
 *     not.
 *
 * A PROVIDER FAILURE IS NEVER A VERDICT. Nothing here is reached by a dispatch
 * that failed: a failed review has no result, so it has no declaration and no
 * evidence, and its task fails with its own code.
 *
 * Pure: no clock, no network, no Node API.
 */

export const JULIUS_REVIEW_VERDICT_VERSION = 'julius-review-verdict.v1' as const;

/** Severity order: a later verdict is stricter. */
const SEVERITY: Readonly<Record<JuliusCheckpointVerdict, number>> = Object.freeze({
  CONTINUE: 0, WARNING: 1, CHALLENGE: 2, REPAIR_REQUIRED: 3, BLOCK: 4,
});

/** What a CHALLENGE disputes. `WORK` is the unit under review; the rest are what the work was built from. */
export const JULIUS_CHALLENGE_TARGETS = ['WORK', 'PLAN', 'GUIDANCE', 'CONTRACT'] as const;
export type JuliusChallengeTarget = (typeof JULIUS_CHALLENGE_TARGETS)[number];

export const JULIUS_REVIEW_VERDICT_LIMITS = Object.freeze({
  claimChars: 400,
  warnings: 8,
  warningClaimChars: 240,
});

export interface JuliusReviewWarning {
  readonly category: JuliusChallengeCategory | null;
  readonly claim: string;
}

export interface JuliusReviewVerdictDeclaration {
  readonly version: typeof JULIUS_REVIEW_VERDICT_VERSION;
  readonly verdict: JuliusCheckpointVerdict;
  /** Required for CHALLENGE and BLOCK: an accusation names what kind of wrong it is. */
  readonly category: JuliusChallengeCategory | null;
  /** Required for CHALLENGE; null for every other verdict. */
  readonly target: JuliusChallengeTarget | null;
  readonly claim: string;
  readonly warnings: readonly JuliusReviewWarning[];
}

export type JuliusReviewVerdictReading =
  | { readonly ok: true; readonly declaration: JuliusReviewVerdictDeclaration }
  | { readonly ok: false; readonly reasonCode: string };

/**
 * A claim is one bounded line, and never something the event validator would
 * refuse as credential-shaped — refusing it here is a recorded refusal, while
 * the validator refusing it would throw inside the tick that tried to write it.
 */
const safeLine = (value: unknown, limit: number): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (text.length === 0) return null;
  if (/(?:api[_-]?key|authorization|bearer|token|secret|password)\s*[=:]/iu.test(text)) return null;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};

const category = (value: unknown): JuliusChallengeCategory | null | undefined => {
  if (value === undefined || value === null) return null;
  const normal = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (JULIUS_CHALLENGE_CATEGORIES as readonly string[]).includes(normal) ? normal as JuliusChallengeCategory : undefined;
};

/**
 * REBUILD A REVIEWER'S DECLARATION FROM AN ALLOWLIST, OR SAY WHY NOT.
 *
 * The authority guard runs first, on the raw value, so a declaration of
 * `VERIFIED` is refused as exactly that — `peer_response_mints_julius_only_outcome`
 * — rather than as an unknown word.
 */
export function sanitizeJuliusReviewVerdict(value: unknown): JuliusReviewVerdictReading {
  const guarded = guardJuliusPeerResponse(value);
  if (!guarded.ok) return { ok: false, reasonCode: guarded.reasonCode };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reasonCode: 'review_verdict_shape_refused' };
  }
  const source = value as Record<string, unknown>;
  const word = typeof source.verdict === 'string' ? source.verdict.trim().toUpperCase() : '';
  if (!(JULIUS_CHECKPOINT_VERDICTS as readonly string[]).includes(word)) {
    return { ok: false, reasonCode: 'review_verdict_unknown' };
  }
  const verdict = word as JuliusCheckpointVerdict;

  const named = category(source.category);
  if (named === undefined) return { ok: false, reasonCode: 'review_verdict_category_unknown' };
  if ((verdict === 'CHALLENGE' || verdict === 'BLOCK') && named === null) {
    return { ok: false, reasonCode: 'review_verdict_requires_category' };
  }

  let target: JuliusChallengeTarget | null = null;
  if (verdict === 'CHALLENGE') {
    const raw = typeof source.target === 'string' ? source.target.trim().toUpperCase() : '';
    if (!(JULIUS_CHALLENGE_TARGETS as readonly string[]).includes(raw)) {
      return { ok: false, reasonCode: 'review_challenge_requires_target' };
    }
    target = raw as JuliusChallengeTarget;
  }

  const claim = safeLine(source.claim, JULIUS_REVIEW_VERDICT_LIMITS.claimChars);
  if (claim === null) return { ok: false, reasonCode: 'review_verdict_claim_invalid' };

  const rawWarnings = source.warnings ?? [];
  if (!Array.isArray(rawWarnings)) return { ok: false, reasonCode: 'review_verdict_warnings_invalid' };
  const warnings: JuliusReviewWarning[] = [];
  for (const item of rawWarnings.slice(0, JULIUS_REVIEW_VERDICT_LIMITS.warnings)) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return { ok: false, reasonCode: 'review_verdict_warnings_invalid' };
    const entry = item as Record<string, unknown>;
    const warningCategory = category(entry.category);
    const warningClaim = safeLine(entry.claim, JULIUS_REVIEW_VERDICT_LIMITS.warningClaimChars);
    if (warningCategory === undefined || warningClaim === null) return { ok: false, reasonCode: 'review_verdict_warnings_invalid' };
    warnings.push(Object.freeze({ category: warningCategory, claim: warningClaim }));
  }
  // A WARNING warns about something. One with nothing to retain is a CONTINUE
  // wearing a louder word, and the record keeps the claim as its warning.
  if (verdict === 'WARNING' && warnings.length === 0) {
    warnings.push(Object.freeze({ category: named, claim }));
  }

  return {
    ok: true,
    declaration: Object.freeze({
      version: JULIUS_REVIEW_VERDICT_VERSION, verdict, category: named, target, claim,
      warnings: Object.freeze(warnings),
    }),
  };
}

/**
 * WHAT THE REVIEWER'S EVIDENCE SAYS, in the verdict vocabulary. A FAILED review
 * finding requires repair; PASSED alone continues; no review finding at all says
 * nothing, and the evaluator decides what a missing review means.
 */
export function juliusEvidenceReviewVerdict(
  evidence: readonly { readonly type: string; readonly status: string }[],
): JuliusCheckpointVerdict | null {
  const reviews = evidence.filter((item) => item.type === 'REVIEW_FINDING');
  if (reviews.some((item) => item.status === 'FAILED')) return 'REPAIR_REQUIRED';
  if (reviews.some((item) => item.status === 'PASSED')) return 'CONTINUE';
  return null;
}

export interface JuliusEffectiveReviewVerdict {
  readonly verdict: JuliusCheckpointVerdict | null;
  /** Where the effective verdict came from. `BOTH` when they agreed. */
  readonly source: 'DECLARED' | 'EVIDENCE' | 'BOTH' | 'NONE';
  readonly declared: JuliusCheckpointVerdict | null;
  readonly derived: JuliusCheckpointVerdict | null;
}

/** THE STRICTER OF WHAT THE REVIEWER SAID AND WHAT ITS EVIDENCE SHOWS. */
export function juliusEffectiveReviewVerdict(
  declared: JuliusCheckpointVerdict | null,
  derived: JuliusCheckpointVerdict | null,
): JuliusEffectiveReviewVerdict {
  if (declared === null && derived === null) return { verdict: null, source: 'NONE', declared, derived };
  if (declared === null) return { verdict: derived, source: 'EVIDENCE', declared, derived };
  if (derived === null) return { verdict: declared, source: 'DECLARED', declared, derived };
  if (declared === derived) return { verdict: declared, source: 'BOTH', declared, derived };
  return SEVERITY[declared] > SEVERITY[derived]
    ? { verdict: declared, source: 'DECLARED', declared, derived }
    : { verdict: derived, source: 'EVIDENCE', declared, derived };
}

/**
 * THE ROUTE, JULIUS'S AND NOBODY ELSE'S.
 *
 *   CONTINUE          PROCEED — the evaluator decides from the evidence.
 *   WARNING           RETAIN — every warning becomes a non-blocking finding on
 *                     the work, and the evaluator decides as for CONTINUE. A
 *                     warning Julius's policy promotes becomes blocking.
 *   CHALLENGE         RECORD — a challenge request and a non-blocking finding,
 *                     never a contract revision. HOLD instead when the category
 *                     is material: no decision until it is resolved.
 *   REPAIR_REQUIRED   REPAIR — a blocking finding; the evaluator plans a bounded
 *                     repair and the repair is independently re-reviewed.
 *   BLOCK             HALT — a blocking finding and a HALT decision on the work.
 */
export type JuliusReviewRoute = 'PROCEED' | 'RETAIN' | 'RECORD' | 'HOLD' | 'REPAIR' | 'HALT';

export function juliusReviewRoute(input: {
  readonly verdict: JuliusCheckpointVerdict | null;
  readonly category: JuliusChallengeCategory | null;
}): JuliusReviewRoute {
  // Materiality is the checkpoint router's rule too (`julius-continuous-lifecycle`):
  // one list, so the two readers of a challenge cannot disagree about it.
  switch (input.verdict) {
    case 'WARNING': return 'RETAIN';
    case 'CHALLENGE': return juliusChallengeIsMaterial(input.category) ? 'HOLD' : 'RECORD';
    case 'REPAIR_REQUIRED': return 'REPAIR';
    case 'BLOCK': return 'HALT';
    default: return 'PROCEED';
  }
}

/** Whether Julius's policy promotes a warning of this category to blocking. */
export const juliusWarningIsPromoted = (
  warning: JuliusReviewWarning,
  promoted: readonly string[] | undefined,
): boolean => warning.category !== null && (promoted ?? []).includes(warning.category);

/* ---------------------------------------------------------------- ledger */

/** The declaration as flat, bounded facts. Warnings travel as one JSON string of closed fields. */
export function juliusReviewVerdictFacts(
  declaration: JuliusReviewVerdictDeclaration,
): Record<string, string | number | boolean | null> {
  return {
    verdictVersion: declaration.version,
    verdict: declaration.verdict,
    category: declaration.category,
    target: declaration.target,
    claim: declaration.claim,
    warningCount: declaration.warnings.length,
    warnings: JSON.stringify(declaration.warnings),
  };
}

/** The declaration back from its facts, through the same allowlist, or null. */
export function juliusReviewVerdictFromFacts(
  facts: Readonly<Record<string, string | number | boolean | null>>,
): JuliusReviewVerdictDeclaration | null {
  let warnings: unknown = [];
  try { warnings = typeof facts.warnings === 'string' ? JSON.parse(facts.warnings) : []; } catch { return null; }
  const reading = sanitizeJuliusReviewVerdict({
    verdict: facts.verdict, category: facts.category, target: facts.target, claim: facts.claim, warnings,
  });
  return reading.ok ? reading.declaration : null;
}

/* ------------------------------------------------------------ what a reviewer is told */

/** The field a reviewer escalates in. */
export const JULIUS_REVIEW_ESCALATION_FIELD = 'escalation' as const;

/**
 * WHAT A REVIEWER IS TOLD IT MAY ESCALATE, in the domain's own words.
 *
 * Written here rather than in an adapter for the reason the research guidance
 * is: the instruction and the sanitizer then cannot state different rules — the
 * categories, the targets and the one thing a reviewer never says are read off
 * the same constants that refuse a declaration.
 */
export function juliusReviewEscalationGuidance(): string {
  return [
    `ESCALATING TO JULIUS. Your answer carries an "${JULIUS_REVIEW_ESCALATION_FIELD}" field. Leave it null unless one of two things is true:`,
    '  "challenge": you dispute something Julius should not accept as it stands — the work itself, the plan it followed, the architect\'s guidance, or the contract terms — and you can name which and why, citing your findings. A challenge is a disagreement Julius resolves; it does not change the contract and it does not order a repair.',
    '  "block": continuing would be unsafe or would breach the contract, and the work must stop.',
    'An escalation carries exactly:',
    '  "verdict": "challenge" or "block"',
    `  "category": one of ${JULIUS_CHALLENGE_CATEGORIES.join(', ')}`,
    `  "target": for a challenge, one of ${JULIUS_CHALLENGE_TARGETS.map((target) => target.toLowerCase()).join(', ')}`,
    `  "claim": what is wrong, in one sentence of at most ${JULIUS_REVIEW_VERDICT_LIMITS.claimChars} characters`,
    'Ordinary problems in the work are findings, not escalations: "changes_required" with blocking findings already sends the work to repair.',
    'You never declare work verified, complete or accepted. Only Julius does, and an escalation that says so is refused.',
  ].join('\n');
}
