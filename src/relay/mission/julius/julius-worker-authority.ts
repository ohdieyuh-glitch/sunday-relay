import { JULIUS_EVIDENCE_TYPES, type JuliusEvidenceType, type JuliusWorkerRole } from './julius-runtime';

/**
 * WHAT A WORKER'S RESULT MAY SAY, BY ROLE.
 *
 * Julius's roles are not providers. A Coding Agent may be Claude Code today and
 * Codex or Devin tomorrow; an Independent Reviewer may be Hermes or an
 * OpenHands harness. What must not change when one is swapped is which KINDS of
 * fact each role is allowed to author — because the kinds are what decide a
 * mission.
 *
 * TWO RULES, ONE BOUNDARY
 *   - EVIDENCE TYPES. A worker reports evidence; it does not author the kinds
 *     that belong to someone else. A reviewer's finding is the reviewer's. An
 *     approval is a person's. A receipt is the executor's or the provider
 *     ledger's. The coordinator used to keep any string as a type, so a Coding
 *     Agent could report `REVIEW_FINDING` or `USER_APPROVAL` PASSED about its
 *     own work — and an acceptance criterion asking for that type was
 *     satisfied by the worker it was meant to judge.
 *   - RESULT CHANNELS. A verdict, a rebuttal, architecture state and a
 *     consistency assessment each belong to one role. The pipeline already
 *     applied them only for that role; what it did not do was SAY when another
 *     role sent one. A refusal nobody records is indistinguishable from a
 *     channel nobody used.
 *
 * AND ONE RULE ABOUT NAMES. Julius mints evidence ids. A worker that chose its
 * own could take the id a later review's evidence needs — the id space is
 * shared across the run — and turn a forged claim into a failed review.
 *
 * Pure: no store, no clock, no provider.
 */

/** The role family a worker belongs to. A specialist is bound as a Coding Agent. */
export type JuliusAuthorityRole = 'PROMPT_ARCHITECT' | 'CODING_AGENT' | 'INDEPENDENT_REVIEWER';

export const juliusAuthorityRoleOf = (role: JuliusWorkerRole | string): JuliusAuthorityRole | null => {
  if (role === 'PROMPT_ARCHITECT' || role === 'CODING_AGENT' || role === 'INDEPENDENT_REVIEWER') return role;
  if (typeof role === 'string' && role.startsWith('SPECIALIST:')) return 'CODING_AGENT';
  return null;
};

/**
 * THE EVIDENCE EACH ROLE MAY AUTHOR.
 *
 * - The architect produces artifacts: a plan, a packet, a design.
 * - The Coding Agent produces the facts implementation produces: tests,
 *   commands, builds, lint, typecheck, diffs and artifacts.
 * - The Independent Reviewer judges, and may run checks of its own to do it —
 *   a review harness that executes a suite or a scanner is still independent of
 *   the work — so it may author findings, security scans and the same check
 *   types a coder can.
 *
 * NO WORKER authors `USER_APPROVAL` (a person gives that), `PROVIDER_RECEIPT`
 * or `TOOL_RECEIPT` (the ledger and the executor mint those).
 */
export const JULIUS_EVIDENCE_AUTHORITY: Readonly<Record<JuliusAuthorityRole, readonly JuliusEvidenceType[]>> = Object.freeze({
  PROMPT_ARCHITECT: Object.freeze(['ARTIFACT'] as const),
  CODING_AGENT: Object.freeze(['TEST', 'COMMAND', 'BUILD', 'LINT', 'TYPECHECK', 'ARTIFACT', 'DIFF'] as const),
  INDEPENDENT_REVIEWER: Object.freeze(['REVIEW_FINDING', 'SECURITY_SCAN', 'TEST', 'COMMAND', 'BUILD', 'LINT', 'TYPECHECK', 'ARTIFACT'] as const),
});

export type JuliusEvidenceAuthority =
  | { readonly ok: true; readonly type: JuliusEvidenceType }
  | { readonly ok: false; readonly reasonCode: 'evidence_type_unknown' | 'evidence_type_not_authorable_by_role' };

export function juliusEvidenceAuthority(role: JuliusWorkerRole | string, type: string): JuliusEvidenceAuthority {
  if (!(JULIUS_EVIDENCE_TYPES as readonly string[]).includes(type)) return { ok: false, reasonCode: 'evidence_type_unknown' };
  const family = juliusAuthorityRoleOf(role);
  if (family === null || !(JULIUS_EVIDENCE_AUTHORITY[family] as readonly string[]).includes(type)) {
    return { ok: false, reasonCode: 'evidence_type_not_authorable_by_role' };
  }
  return { ok: true, type: type as JuliusEvidenceType };
}

/**
 * THE ID JULIUS GIVES A PIECE OF EVIDENCE: the task that produced it, the lease
 * it was produced under, and its position in the result. Deterministic, so a
 * replayed result writes the same rows; scoped to the producing task, so no
 * worker can name a row that belongs to another.
 */
export const juliusMintedEvidenceId = (taskId: string, leaseGeneration: number, index: number): string =>
  `${taskId}:${String(leaseGeneration)}:${String(index)}`;

/** The optional channels a worker result may carry. */
export const JULIUS_RESULT_CHANNELS = [
  'contractProposal', 'guidanceRequest', 'guidance', 'segmentResume', 'researchAsks',
  'reviewVerdict', 'rebuttal', 'architecture', 'consistency', 'architectureObservations',
] as const;
export type JuliusResultChannel = (typeof JULIUS_RESULT_CHANNELS)[number];

/**
 * WHO MAY USE A CHANNEL AT ALL.
 *
 * `contractProposal`, `guidance` and `guidanceRequest` are deliberately NOT
 * gated here: each already has its own refusal on the record
 * (`contract.refused` against the lock, `guidance.refused` for a task that is
 * not a guidance task, `peer.request.refused` for a direction the peer channel
 * does not allow), and a second refusal in front of the first would change the
 * reason a reader sees without changing what happens. `segmentResume` and
 * `researchAsks` belong to every role that can pause.
 */
const CHANNEL_OWNERS: Readonly<Partial<Record<JuliusResultChannel, readonly JuliusAuthorityRole[]>>> = Object.freeze({
  reviewVerdict: ['INDEPENDENT_REVIEWER'],
  rebuttal: ['PROMPT_ARCHITECT'],
  architecture: ['PROMPT_ARCHITECT'],
  consistency: ['PROMPT_ARCHITECT'],
  architectureObservations: ['CODING_AGENT'],
});

export function juliusResultChannelPermitted(role: JuliusWorkerRole | string, channel: JuliusResultChannel): boolean {
  const owners = CHANNEL_OWNERS[channel];
  if (owners === undefined) return true;
  const family = juliusAuthorityRoleOf(role);
  return family !== null && owners.includes(family);
}
