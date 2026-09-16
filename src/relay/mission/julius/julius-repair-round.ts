import type { JuliusFindingLife } from './julius-finding-lifecycle';

/**
 * WHAT CHANGED BETWEEN ONE REPAIR ROUND AND THE LAST, bounded.
 *
 * A reviewer re-reviewing a repair used to be handed the repair's own evidence
 * and its packet, and asked whether prior findings were resolved — without
 * being shown what it had rejected, what the repair claims to have changed, or
 * what the evidence looked like before. It answered from memory it does not
 * have. So it either re-derived the whole judgement (expensive, and a different
 * judgement) or waved the round through.
 *
 * THIS IS NOT A TRANSCRIPT. A history dump would be the other failure: the
 * reviewer's packet is bounded (its prompt travels on argv), and a wall of
 * prior rounds crowds out the thing being judged. What it gets is a structured
 * comparison — the findings it must answer, what the round before produced,
 * what this round produced, and which evidence types moved — with every field
 * capped and no provider body anywhere.
 *
 * Pure: no clock, no network, no Node API. Every input is a durable row.
 */

export const JULIUS_REPAIR_ROUND_VERSION = 'julius-repair-round.v1' as const;

export const JULIUS_REPAIR_ROUND_LIMITS = Object.freeze({
  findings: 12,
  evidencePerRound: 12,
  claimChars: 240,
  summaryChars: 200,
  totalChars: 6_000,
});

export interface JuliusRepairRoundEvidence {
  readonly type: string;
  readonly status: string;
  readonly safeSummary: string;
}

export interface JuliusRepairRoundDiff {
  readonly version: typeof JULIUS_REPAIR_ROUND_VERSION;
  readonly repairTaskId: string;
  readonly repairedTaskId: string;
  readonly round: number;
  /** The findings this round exists to answer, with the identity they keep. */
  readonly findings: readonly {
    readonly findingId: string;
    readonly state: string;
    readonly severity: string;
    readonly category: string;
    readonly criterionId: string | null;
    readonly claim: string;
  }[];
  readonly before: readonly JuliusRepairRoundEvidence[];
  readonly after: readonly JuliusRepairRoundEvidence[];
  /** Evidence types that appear in this round and not the last, and the reverse. */
  readonly gainedTypes: readonly string[];
  readonly lostTypes: readonly string[];
  /** What the repair said it did, in its own bounded words. */
  readonly repairSummary: string | null;
}

const cap = (value: string, limit: number): string =>
  (value.length > limit ? `${value.slice(0, limit - 1)}…` : value);

const row = (item: { readonly type: string; readonly status: string; readonly safeSummary: string }): JuliusRepairRoundEvidence =>
  Object.freeze({ type: item.type, status: item.status, safeSummary: cap(item.safeSummary, JULIUS_REPAIR_ROUND_LIMITS.summaryChars) });

/**
 * BUILD THE COMPARISON FROM DURABLE ROWS ONLY.
 *
 * `before` is the evidence of the work that was rejected; `after` is the
 * repair's own. Both are capped, and the type sets are computed rather than
 * described, so "the tests that were failing now pass" is a claim the reviewer
 * can check rather than one the packet makes for it.
 */
export function juliusRepairRoundDiff(input: {
  readonly repairTaskId: string;
  readonly repairedTaskId: string;
  readonly round: number;
  readonly findings: readonly JuliusFindingLife[];
  readonly evidence: readonly { readonly taskId: string; readonly type: string; readonly status: string; readonly safeSummary: string }[];
  readonly repairSummary?: string | null;
}): JuliusRepairRoundDiff {
  const before = input.evidence.filter((item) => item.taskId === input.repairedTaskId)
    .slice(-JULIUS_REPAIR_ROUND_LIMITS.evidencePerRound).map(row);
  const after = input.evidence.filter((item) => item.taskId === input.repairTaskId)
    .slice(-JULIUS_REPAIR_ROUND_LIMITS.evidencePerRound).map(row);
  const beforeTypes = new Set(before.map((item) => `${item.type}:${item.status}`));
  const afterTypes = new Set(after.map((item) => `${item.type}:${item.status}`));
  return Object.freeze({
    version: JULIUS_REPAIR_ROUND_VERSION,
    repairTaskId: input.repairTaskId,
    repairedTaskId: input.repairedTaskId,
    round: input.round,
    findings: Object.freeze(input.findings.slice(0, JULIUS_REPAIR_ROUND_LIMITS.findings).map((life) => Object.freeze({
      findingId: life.findingId,
      state: life.state,
      severity: life.severity,
      category: life.category,
      criterionId: life.criterionId,
      claim: cap(life.claim, JULIUS_REPAIR_ROUND_LIMITS.claimChars),
    }))),
    before: Object.freeze(before),
    after: Object.freeze(after),
    gainedTypes: Object.freeze([...afterTypes].filter((type) => !beforeTypes.has(type)).sort()),
    lostTypes: Object.freeze([...beforeTypes].filter((type) => !afterTypes.has(type)).sort()),
    repairSummary: input.repairSummary === undefined || input.repairSummary === null
      ? null
      : cap(input.repairSummary, JULIUS_REPAIR_ROUND_LIMITS.summaryChars),
  });
}

/**
 * THE COMPARISON AS THE REVIEWER READS IT, and as a Project Brain entry carries
 * it: bounded text, ids the reviewer must answer with, no provider body.
 */
export function renderJuliusRepairRoundDiff(diff: JuliusRepairRoundDiff): string {
  const lines = [
    `REPAIR ROUND ${String(diff.round)} OF ${diff.repairedTaskId} — WHAT CHANGED SINCE YOU REJECTED IT`,
    '',
    'FINDINGS YOU RAISED, AND MUST ANSWER (answer each in "resolutions" by id):',
    ...(diff.findings.length === 0
      ? ['  (none: this round was admitted on failed evidence rather than on a finding)']
      : diff.findings.map((finding) => `  ${finding.findingId} [${finding.state}, ${finding.severity}, ${finding.category}${finding.criterionId === null ? '' : `, criterion ${finding.criterionId}`}]: ${finding.claim}`)),
    '',
    'EVIDENCE BEFORE (the work you rejected):',
    ...(diff.before.length === 0 ? ['  (none recorded)'] : diff.before.map((item) => `  ${item.type} ${item.status}: ${item.safeSummary}`)),
    '',
    'EVIDENCE AFTER (this repair round):',
    ...(diff.after.length === 0 ? ['  (none recorded)'] : diff.after.map((item) => `  ${item.type} ${item.status}: ${item.safeSummary}`)),
    '',
    `EVIDENCE GAINED: ${diff.gainedTypes.join(', ') || '(none)'}`,
    `EVIDENCE LOST: ${diff.lostTypes.join(', ') || '(none)'}`,
    ...(diff.repairSummary === null ? [] : ['', `THE REPAIR'S OWN ACCOUNT: ${diff.repairSummary}`]),
    '',
    'A finding is resolved when the evidence shows the problem is gone, not because the code changed.',
    'A finding you do not answer stays exactly as it is.',
  ];
  const text = lines.join('\n');
  return text.length > JULIUS_REPAIR_ROUND_LIMITS.totalChars
    ? `${text.slice(0, JULIUS_REPAIR_ROUND_LIMITS.totalChars - 1)}…`
    : text;
}

/** The entry a repair round's re-review reads it from. */
export const juliusRepairRoundEntryId = (reviewTaskId: string): string => `brain:repair-round:${reviewTaskId}`;
