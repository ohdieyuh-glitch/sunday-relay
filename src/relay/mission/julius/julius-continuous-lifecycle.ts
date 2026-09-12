/**
 * THE CONTINUOUS THREE-WORKER LIFECYCLE — how the Prompt Architect and the
 * Independent Reviewer stay in a mission after their opening move.
 *
 * WHAT WAS WRONG. Julius dispatched three roles in a near-straight line: the
 * architect planned once, the reviewer graded once, and the Coding Agent did
 * every remaining minute of agentic work alone. The evidence is in the paid
 * record — Mission 5's coder ran thirteen turns and sixteen tool calls against
 * an architect that had spoken once, hours earlier, and a reviewer that would
 * not speak again until the diff existed. Between `worker.dispatched` and
 * `worker.completed` the run was opaque: there was no declared event, no port,
 * no callback and no fixture through which anyone could say anything.
 *
 * THE SHAPE OF THE FIX, and what it deliberately is NOT.
 *
 * It is NOT a second channel beside the task graph. Julius's unit of
 * participation is a TASK — claimed under a lease, admitted against an attempt,
 * dispatched under a locked contract, banked as evidence, decided, released.
 * Budget, provenance, the contract gate, the repair loop and recovery all key
 * off that one primitive, and a parallel path would have to re-earn every one
 * of those properties. So continuous participation is expressed in tasks, and
 * this module is the vocabulary that decides WHEN one is warranted.
 *
 * It is also NOT a change to the adapter seam. `dispatch(input) => result`
 * stays exactly one promise in and one result out. A worker still cannot be
 * interrupted mid-flight; what changes is that a mission now has many more
 * meaningful moments at which a worker may be asked something, and a typed
 * record of each.
 *
 * THREE PRIMITIVES:
 *
 *   CHECKPOINT   a durable, typed record that something worth a decision
 *                happened. Julius records it; a worker never does. Ten closed
 *                triggers, all event-driven — there is no timer, no token
 *                count and no polling anywhere in this module.
 *
 *   GUIDANCE     what the architect may say AFTER the contract locks. Bound to
 *                the exact contract revision it was written under, versioned,
 *                and structurally unable to carry a contract field.
 *
 *   VERDICT      what the reviewer says about a checkpoint: CONTINUE, WARNING,
 *                CHALLENGE, REPAIR_REQUIRED or BLOCK. Adversarial verdicts must
 *                cite evidence, and the reviewer may never judge its own work.
 *
 * AUTHORITY IS UNMOVED. Nothing here decides a mission. `routeJuliusCheckpoint`
 * returns a NAMED INTENTION and Julius performs it through the machinery it
 * already owns — `appendDecision`, `scheduleRepair`, the contract gate. A
 * worker that returns BLOCK has not stopped a run; it has told Julius what it
 * found, and Julius stops the run.
 */

import { createHash } from 'node:crypto';
import type { JuliusTaskContractBinding, JuliusTaskContractState } from './julius-task-contract';
import type { JuliusDecisionAction, JuliusWorkerRole } from './julius-runtime';

export const JULIUS_CONTINUOUS_LIFECYCLE_VERSION = 'julius-continuous-lifecycle.v1' as const;

/* ------------------------------------------------------------------ triggers */

/**
 * WHEN A CHECKPOINT IS WARRANTED — a closed set, and deliberately a set of
 * EVENTS rather than intervals.
 *
 * A cadence measured in tokens or ticks produces two failures at once: it asks
 * when nothing happened, and it stays silent through the one turn that
 * mattered. Every trigger below names something that actually occurred and that
 * a reader can find in the durable record afterwards.
 *
 * `CONTRACT_DRAFTED` and `CONTRACT_REVISION_PROPOSED` are the pre-lock pair.
 * `PRE_COMPLETION_VERIFICATION` is the last one before Julius may complete, and
 * it exists because "the coder says it is done" has never been evidence.
 */
export const JULIUS_CHECKPOINT_TRIGGERS = [
  'CONTRACT_DRAFTED',
  'CONTRACT_REVISION_PROPOSED',
  'GUIDANCE_REQUESTED',
  'IMPLEMENTATION_MILESTONE',
  'SUBSYSTEM_DISCOVERED',
  'TEST_FAILED',
  'MATERIAL_EVIDENCE',
  'SECURITY_SENSITIVE_CHANGE',
  'REPAIR_ROUND_ENTERED',
  'PRE_COMPLETION_VERIFICATION',
  /**
   * A worker needs to know something it cannot know from the repository, and
   * is asking Julius to go and look.
   *
   * Available to ALL THREE slots, which is the point: an Architect that must
   * ask the Coder to check a version, or a Reviewer that can only grade what it
   * was handed, is not a peer. It is the one trigger whose answer Julius can
   * produce itself, so it schedules no worker — see `SERVE_RESEARCH`.
   */
  'RESEARCH_REQUESTED',
] as const;
export type JuliusCheckpointTrigger = (typeof JULIUS_CHECKPOINT_TRIGGERS)[number];

/**
 * WHO OBSERVED IT. `JULIUS` is not a worker slot — it is the coordinator
 * recording something it saw itself (a repair round opening, a run about to
 * complete), and it is the only origin that may record a checkpoint with no
 * worker behind it.
 */
export const JULIUS_CHECKPOINT_ORIGINS = [
  'PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER', 'JULIUS',
] as const;
export type JuliusCheckpointOrigin = (typeof JULIUS_CHECKPOINT_ORIGINS)[number];

/** Bounds. A checkpoint is a signal, not a transcript. */
export const JULIUS_CHECKPOINT_LIMITS = Object.freeze({
  summaryChars: 400,
  evidenceIds: 20,
});

export interface JuliusMissionCheckpoint {
  readonly checkpointId: string;
  readonly runId: string;
  /** The task the checkpoint is ABOUT — the subject, never the observer's own review task. */
  readonly taskId: string;
  /** Monotonic within a run, so two checkpoints can always be ordered without a clock. */
  readonly sequence: number;
  readonly trigger: JuliusCheckpointTrigger;
  readonly origin: JuliusCheckpointOrigin;
  /**
   * The contract revision in force when it was observed, or null before one is
   * locked. A checkpoint that outlives its revision is readable as stale
   * without re-deriving anything.
   */
  readonly binding: JuliusTaskContractBinding | null;
  readonly evidenceIds: readonly string[];
  readonly safeSummary: string;
  readonly recordedAt: string;
}

export type JuliusCheckpointOutcome =
  | { readonly outcome: 'RECORDED'; readonly checkpoint: JuliusMissionCheckpoint }
  | { readonly outcome: 'REFUSED'; readonly reasonCode: string };

const trimmed = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length === 0 || text.length > max ? null : text;
};

const identifier = (value: unknown): string | null => trimmed(value, 200);

const idList = (value: unknown, max: number): readonly string[] | null => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  const out: string[] = [];
  for (const entry of value) {
    const id = identifier(entry);
    if (id === null) return null;
    out.push(id);
  }
  return Object.freeze(out);
};

/**
 * RECORD ONE, or refuse it with a reason.
 *
 * Refusal rather than repair: a checkpoint whose summary is empty or whose
 * sequence is not a whole number is a caller defect, and storing a corrected
 * version would put Julius's words in a worker's mouth.
 */
export function recordJuliusCheckpoint(input: {
  readonly checkpointId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly sequence: number;
  readonly trigger: string;
  readonly origin: string;
  readonly binding?: JuliusTaskContractBinding | null;
  readonly evidenceIds?: readonly string[];
  readonly safeSummary: string;
  readonly recordedAt: string;
}): JuliusCheckpointOutcome {
  const checkpointId = identifier(input.checkpointId);
  const runId = identifier(input.runId);
  const taskId = identifier(input.taskId);
  const recordedAt = identifier(input.recordedAt);
  if (checkpointId === null || runId === null || taskId === null || recordedAt === null) {
    return { outcome: 'REFUSED', reasonCode: 'checkpoint_identity_required' };
  }
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    return { outcome: 'REFUSED', reasonCode: 'checkpoint_sequence_invalid' };
  }
  if (!(JULIUS_CHECKPOINT_TRIGGERS as readonly string[]).includes(input.trigger)) {
    return { outcome: 'REFUSED', reasonCode: 'checkpoint_trigger_unknown' };
  }
  if (!(JULIUS_CHECKPOINT_ORIGINS as readonly string[]).includes(input.origin)) {
    return { outcome: 'REFUSED', reasonCode: 'checkpoint_origin_unknown' };
  }
  const summary = trimmed(input.safeSummary, JULIUS_CHECKPOINT_LIMITS.summaryChars);
  if (summary === null) return { outcome: 'REFUSED', reasonCode: 'checkpoint_summary_invalid' };
  const evidenceIds = idList(input.evidenceIds, JULIUS_CHECKPOINT_LIMITS.evidenceIds);
  if (evidenceIds === null) return { outcome: 'REFUSED', reasonCode: 'checkpoint_evidence_invalid' };

  return {
    outcome: 'RECORDED',
    checkpoint: Object.freeze({
      checkpointId, runId, taskId,
      sequence: input.sequence,
      trigger: input.trigger as JuliusCheckpointTrigger,
      origin: input.origin as JuliusCheckpointOrigin,
      binding: input.binding ?? null,
      evidenceIds,
      safeSummary: summary,
      recordedAt,
    }),
  };
}

/* ------------------------------------------------------------------- verdicts */

/**
 * THE REVIEWER'S CONTINUOUS VOCABULARY, ordered by severity.
 *
 * It is deliberately NOT the decision vocabulary. `JuliusDecisionAction` is
 * what JULIUS concludes about a task; this is what a REVIEWER observed about a
 * moment, and the two are mapped by `juliusDecisionForVerdict` in exactly one
 * place so a reviewer can never mint a decision by naming one.
 *
 *   CONTINUE         seen, nothing to answer
 *   WARNING          recorded for the record; does not interrupt
 *   CHALLENGE        the contract itself is in question — routes to the
 *                    revision model, never to a silent amendment
 *   REPAIR_REQUIRED  the work is wrong and must be redone under the same terms
 *   BLOCK            it must not continue at all
 */
export const JULIUS_CHECKPOINT_VERDICTS = [
  'CONTINUE', 'WARNING', 'CHALLENGE', 'REPAIR_REQUIRED', 'BLOCK',
] as const;
export type JuliusCheckpointVerdict = (typeof JULIUS_CHECKPOINT_VERDICTS)[number];

/** Verdicts that assert something is WRONG, and therefore must cite evidence. */
export const JULIUS_ADVERSARIAL_VERDICTS: readonly JuliusCheckpointVerdict[] =
  Object.freeze(['CHALLENGE', 'REPAIR_REQUIRED', 'BLOCK']);

/**
 * WHAT THE REVIEWER MAY CHALLENGE, as a closed set.
 *
 * The founder's list, made machine-readable so a verdict names its category
 * rather than describing it. `unsupported_guidance` and `provenance_gap` are
 * the two that only exist because the architect now speaks after LOCK.
 */
export const JULIUS_CHALLENGE_CATEGORIES = [
  'contract_drift',
  'unsupported_guidance',
  'missed_acceptance_criterion',
  'weak_evidence',
  'bad_assumption',
  'unsafe_implementation',
  'superficial_test',
  'regression',
  'brain_contradiction',
  'provenance_gap',
  'budget_misuse',
  'unsupported_completion_claim',
] as const;
export type JuliusChallengeCategory = (typeof JULIUS_CHALLENGE_CATEGORIES)[number];

export interface JuliusCheckpointVerdictRecord {
  readonly verdictId: string;
  readonly checkpointId: string;
  readonly verdict: JuliusCheckpointVerdict;
  readonly category: JuliusChallengeCategory | null;
  readonly reviewerWorkerId: string;
  readonly reasonCode: string;
  readonly evidenceIds: readonly string[];
  readonly safeClaim: string;
  readonly recordedAt: string;
}

export type JuliusCheckpointVerdictOutcome =
  | { readonly outcome: 'RECORDED'; readonly record: JuliusCheckpointVerdictRecord }
  | { readonly outcome: 'REFUSED'; readonly reasonCode: string };

/**
 * A VERDICT THAT ACCUSES MUST CITE.
 *
 * `CONTINUE` and `WARNING` may cite nothing, because "I looked and saw nothing
 * to answer" is a real observation. The three adversarial verdicts may not: an
 * uncited BLOCK is an opinion with the authority of a finding, and Julius would
 * have no way to tell the reviewer's judgement from its mood.
 *
 * INDEPENDENCE IS ENFORCED HERE TOO. A reviewer may not judge a checkpoint it
 * produced itself; the whole value of the third slot is that it did not write
 * the thing it is grading.
 */
export function recordJuliusCheckpointVerdict(input: {
  readonly verdictId: string;
  readonly checkpoint: JuliusMissionCheckpoint;
  readonly verdict: string;
  readonly category?: string | null;
  readonly reviewerWorkerId: string;
  readonly reasonCode: string;
  readonly evidenceIds?: readonly string[];
  readonly safeClaim: string;
  readonly recordedAt: string;
}): JuliusCheckpointVerdictOutcome {
  const verdictId = identifier(input.verdictId);
  const reviewerWorkerId = identifier(input.reviewerWorkerId);
  const recordedAt = identifier(input.recordedAt);
  if (verdictId === null || reviewerWorkerId === null || recordedAt === null) {
    return { outcome: 'REFUSED', reasonCode: 'verdict_identity_required' };
  }
  if (!(JULIUS_CHECKPOINT_VERDICTS as readonly string[]).includes(input.verdict)) {
    return { outcome: 'REFUSED', reasonCode: 'verdict_unknown' };
  }
  const verdict = input.verdict as JuliusCheckpointVerdict;
  if (input.checkpoint.origin === 'INDEPENDENT_REVIEWER') {
    return { outcome: 'REFUSED', reasonCode: 'reviewer_cannot_judge_its_own_checkpoint' };
  }
  const reasonCode = trimmed(input.reasonCode, 64);
  if (reasonCode === null || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(reasonCode)) {
    return { outcome: 'REFUSED', reasonCode: 'verdict_reason_code_invalid' };
  }
  const claim = trimmed(input.safeClaim, JULIUS_CHECKPOINT_LIMITS.summaryChars);
  if (claim === null) return { outcome: 'REFUSED', reasonCode: 'verdict_claim_invalid' };
  const evidenceIds = idList(input.evidenceIds, JULIUS_CHECKPOINT_LIMITS.evidenceIds);
  if (evidenceIds === null) return { outcome: 'REFUSED', reasonCode: 'verdict_evidence_invalid' };
  if (JULIUS_ADVERSARIAL_VERDICTS.includes(verdict) && evidenceIds.length === 0) {
    return { outcome: 'REFUSED', reasonCode: 'adversarial_verdict_requires_evidence' };
  }
  let category: JuliusChallengeCategory | null = null;
  if (input.category !== undefined && input.category !== null) {
    if (!(JULIUS_CHALLENGE_CATEGORIES as readonly string[]).includes(input.category)) {
      return { outcome: 'REFUSED', reasonCode: 'verdict_category_unknown' };
    }
    category = input.category as JuliusChallengeCategory;
  } else if (JULIUS_ADVERSARIAL_VERDICTS.includes(verdict)) {
    return { outcome: 'REFUSED', reasonCode: 'adversarial_verdict_requires_category' };
  }

  return {
    outcome: 'RECORDED',
    record: Object.freeze({
      verdictId,
      checkpointId: input.checkpoint.checkpointId,
      verdict, category, reviewerWorkerId, reasonCode, evidenceIds,
      safeClaim: claim, recordedAt,
    }),
  };
}

/**
 * THE ONE PLACE A VERDICT BECOMES A DECISION ACTION — and it is not a total
 * function on purpose.
 *
 * `CONTINUE` and `WARNING` map to NOTHING. A reviewer that saw nothing wrong
 * has not decided a task, and minting an ACCEPT from a WARNING would let the
 * checkpoint path complete a mission the verification path never verified.
 * `CHALLENGE` maps to nothing either: it is a question about the CONTRACT, and
 * the answer is a reviewed revision, not a task decision.
 */
export function juliusDecisionForVerdict(verdict: JuliusCheckpointVerdict): JuliusDecisionAction | null {
  if (verdict === 'REPAIR_REQUIRED') return 'REPAIR';
  if (verdict === 'BLOCK') return 'HALT';
  return null;
}

/* ------------------------------------------------------------------- guidance */

export const JULIUS_GUIDANCE_PACKET_VERSION = 'julius-guidance-packet.v1' as const;

/**
 * WHERE A PIECE OF EVIDENCE CAME FROM.
 *
 * `WEB` is listed and is the reason `trust` exists. External text is
 * attacker-controlled by assumption: a page can contain an instruction
 * addressed to the model reading it. So a reference records WHERE something was
 * read and HOW WELL it was corroborated, and the guidance packet carries the
 * architect's own words about it — never the retrieved text itself. Nothing in
 * this module admits a fetched document into the record.
 */
export const JULIUS_GUIDANCE_REFERENCE_KINDS = [
  'REPOSITORY', 'DOCUMENTATION', 'SPECIFICATION', 'PRIOR_ART', 'WEB',
] as const;
export type JuliusGuidanceReferenceKind = (typeof JULIUS_GUIDANCE_REFERENCE_KINDS)[number];

/**
 * `UNVERIFIED` is the default and stays the default. `CORROBORATED` means a
 * second independent source said the same thing, and it is the architect's
 * claim about its own work — not a trust level Julius granted.
 */
export const JULIUS_GUIDANCE_REFERENCE_TRUST = ['UNVERIFIED', 'CORROBORATED'] as const;
export type JuliusGuidanceReferenceTrust = (typeof JULIUS_GUIDANCE_REFERENCE_TRUST)[number];

export interface JuliusGuidanceReference {
  readonly kind: JuliusGuidanceReferenceKind;
  /** A locator — a path, a URL, a specification section. Bounded, never a body. */
  readonly locator: string;
  readonly retrievedAt: string;
  readonly trust: JuliusGuidanceReferenceTrust;
}

export const JULIUS_GUIDANCE_LIMITS = Object.freeze({
  stringChars: 2_000,
  entryChars: 500,
  entriesPerList: 40,
  references: 20,
  locatorChars: 500,
});

/**
 * WHAT THE ARCHITECT MAY SAY AFTER THE CONTRACT LOCKS.
 *
 * Every field is advisory. Read the list against the contract's own field list
 * and the point becomes structural rather than promised: there is no
 * `objective`, no `inScope`, no `blockingAcceptanceCriteria`, no `budget` and
 * no `permittedPaths` here. `affectedCriterionIds` NAMES criteria that already
 * exist and is refused if it names one the contract does not have — guidance
 * may point at an agreement, never edit it.
 *
 * `binding` is NOT nullable. Guidance that is not bound to a contract revision
 * is guidance nobody can date, and after a revision it would be indistinguishable
 * from current advice. That is the whole of proof 9.
 */
export interface JuliusGuidancePacket {
  readonly version: typeof JULIUS_GUIDANCE_PACKET_VERSION;
  readonly guidanceId: string;
  readonly runId: string;
  /** The task the guidance is FOR — the coder's task, not the architect's own. */
  readonly taskId: string;
  readonly binding: JuliusTaskContractBinding;
  /** Monotonic per subject task. Two packets for one task are always ordered. */
  readonly revision: number;
  readonly triggeringCheckpointId: string;
  readonly subObjective: string;
  readonly relevantRequirements: readonly string[];
  readonly relevantConstraints: readonly string[];
  readonly repositoryFindings: readonly string[];
  readonly runtimeFindings: readonly string[];
  readonly references: readonly JuliusGuidanceReference[];
  readonly recommendedActions: readonly string[];
  /**
   * NARROWER THAN THE CONTRACT, NEVER WIDER — and named so it cannot be
   * mistaken for `prohibitedActions`, which is the contract's and is on the
   * forbidden list. A prohibition can only ever restrict what the coder may do,
   * so guidance may add one; it can never grant permission the agreement
   * withheld. The first draft of this module called it `prohibitedActions` and
   * the disjointness test rejected it, which is precisely what that test is for.
   */
  readonly additionalProhibitions: readonly string[];
  readonly affectedCriterionIds: readonly string[];
  readonly unresolvedQuestions: readonly string[];
  readonly issuedByWorkerId: string;
  readonly issuedAt: string;
  readonly packetDigest: string;
}

/**
 * THE FIELDS GUIDANCE MAY NEVER CARRY.
 *
 * Named rather than merely omitted, because the omission is the safety property
 * and a later editor adding one back would otherwise be adding a silent
 * contract amendment. `julius-continuous-lifecycle.test.ts` holds this list
 * against the real contract type and against the sanitizer's allowlist, so the
 * two can never drift into overlapping.
 */
export const JULIUS_GUIDANCE_FORBIDDEN_FIELDS: readonly string[] = Object.freeze([
  'objective', 'responsibilityBoundary', 'requiredInputs', 'expectedOutputs',
  'inScope', 'outOfScope', 'blockingAcceptanceCriteria', 'requiredEvidence',
  'requiredChecks', 'permittedPaths', 'prohibitedActions', 'dependencyTaskIds', 'reviewCriteria',
  'failureConditions', 'repairRules', 'budget', 'stoppingCondition',
  'contractRevision', 'bindingDigest', 'state', 'lockedAt', 'lockedByEvaluatorId',
]);

const GUIDANCE_LIST_FIELDS = [
  'relevantRequirements', 'relevantConstraints', 'repositoryFindings', 'runtimeFindings',
  'recommendedActions', 'additionalProhibitions', 'affectedCriterionIds', 'unresolvedQuestions',
] as const;

/**
 * The architect's proposal for a packet — everything Julius does not own.
 * `binding`, `revision`, `guidanceId`, `issuedAt` and the digest are Julius's,
 * exactly as the contract's identity fields are.
 */
export type JuliusGuidanceProposal = Pick<
  JuliusGuidancePacket,
  | 'subObjective' | 'relevantRequirements' | 'relevantConstraints' | 'repositoryFindings'
  | 'runtimeFindings' | 'references' | 'recommendedActions' | 'additionalProhibitions'
  | 'affectedCriterionIds' | 'unresolvedQuestions'
>;

const sanitizeReference = (value: unknown): JuliusGuidanceReference | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (!(JULIUS_GUIDANCE_REFERENCE_KINDS as readonly string[]).includes(source.kind as string)) return null;
  const locator = trimmed(source.locator, JULIUS_GUIDANCE_LIMITS.locatorChars);
  const retrievedAt = identifier(source.retrievedAt);
  if (locator === null || retrievedAt === null) return null;
  // ABSENT TRUST IS UNVERIFIED, never corroborated: a reference that forgot to
  // say would otherwise arrive claiming the stronger of the two.
  const trust = source.trust === undefined || source.trust === null ? 'UNVERIFIED' : source.trust;
  if (!(JULIUS_GUIDANCE_REFERENCE_TRUST as readonly string[]).includes(trust as string)) return null;
  return Object.freeze({
    kind: source.kind as JuliusGuidanceReferenceKind,
    locator, retrievedAt,
    trust: trust as JuliusGuidanceReferenceTrust,
  });
};

/**
 * REBUILD THE PROPOSAL FROM AN ALLOWLIST, exactly as a contract proposal is.
 *
 * A key nobody listed cannot reach the packet however the provider sent it, and
 * a PRESENT-but-unusable field refuses the whole proposal rather than being
 * dropped — half a packet is advice nobody wrote. A proposal carrying any
 * contract-owned field is refused outright and by name, which is what makes
 * "guidance cannot alter locked scope" a property of the type rather than of
 * everyone remembering.
 */
export function sanitizeJuliusGuidanceProposal(value: unknown): JuliusGuidanceProposal | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;

  for (const forbidden of JULIUS_GUIDANCE_FORBIDDEN_FIELDS) {
    if (forbidden in source) return null;
  }

  const subObjective = trimmed(source.subObjective, JULIUS_GUIDANCE_LIMITS.stringChars);
  if (subObjective === null) return null;

  const lists: Record<string, readonly string[]> = {};
  for (const field of GUIDANCE_LIST_FIELDS) {
    const raw = source[field];
    if (raw === undefined) { lists[field] = Object.freeze([]); continue; }
    if (!Array.isArray(raw) || raw.length > JULIUS_GUIDANCE_LIMITS.entriesPerList) return null;
    const entries: string[] = [];
    for (const entry of raw) {
      const text = trimmed(entry, JULIUS_GUIDANCE_LIMITS.entryChars);
      if (text === null) return null;
      entries.push(text);
    }
    lists[field] = Object.freeze(entries);
  }

  const rawReferences = source.references;
  const references: JuliusGuidanceReference[] = [];
  if (rawReferences !== undefined) {
    if (!Array.isArray(rawReferences) || rawReferences.length > JULIUS_GUIDANCE_LIMITS.references) return null;
    for (const entry of rawReferences) {
      const reference = sanitizeReference(entry);
      if (reference === null) return null;
      references.push(reference);
    }
  }

  return Object.freeze({
    subObjective,
    relevantRequirements: lists.relevantRequirements!,
    relevantConstraints: lists.relevantConstraints!,
    repositoryFindings: lists.repositoryFindings!,
    runtimeFindings: lists.runtimeFindings!,
    references: Object.freeze(references),
    recommendedActions: lists.recommendedActions!,
    additionalProhibitions: lists.additionalProhibitions!,
    affectedCriterionIds: lists.affectedCriterionIds!,
    unresolvedQuestions: lists.unresolvedQuestions!,
  });
}

/**
 * WHAT A CODER MAY ASK FOR, MID-MISSION.
 *
 * Deliberately a QUESTION and its context, never an instruction: a coder that
 * could tell the architect what to write would be the coder editing its own
 * terms one indirection later. The same forbidden-field refusal applies, for
 * the same reason — a request naming `inScope` is a scope change wearing a
 * question mark.
 */
export interface JuliusGuidanceRequest {
  readonly question: string;
  readonly blockedOn: readonly string[];
  readonly attempted: readonly string[];
  readonly relevantPaths: readonly string[];
}

const REQUEST_LIST_FIELDS = ['blockedOn', 'attempted', 'relevantPaths'] as const;

export function sanitizeJuliusGuidanceRequest(value: unknown): JuliusGuidanceRequest | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  for (const forbidden of JULIUS_GUIDANCE_FORBIDDEN_FIELDS) {
    if (forbidden in source) return null;
  }
  const question = trimmed(source.question, JULIUS_CHECKPOINT_LIMITS.summaryChars);
  if (question === null) return null;
  const lists: Record<string, readonly string[]> = {};
  for (const field of REQUEST_LIST_FIELDS) {
    const raw = source[field];
    if (raw === undefined) { lists[field] = Object.freeze([]); continue; }
    if (!Array.isArray(raw) || raw.length > JULIUS_GUIDANCE_LIMITS.entriesPerList) return null;
    const entries: string[] = [];
    for (const entry of raw) {
      const text = trimmed(entry, JULIUS_GUIDANCE_LIMITS.entryChars);
      if (text === null) return null;
      entries.push(text);
    }
    lists[field] = Object.freeze(entries);
  }
  return Object.freeze({
    question,
    blockedOn: lists.blockedOn!,
    attempted: lists.attempted!,
    relevantPaths: lists.relevantPaths!,
  });
}

function canonicalise(value: unknown, path: string): string {
  if (value === undefined) throw new Error(`julius_guidance_canonical_undefined:${path}`);
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`julius_guidance_canonical_non_finite:${path}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonicalise(item, `${path}[${index}]`)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalise(item, `${path}.${key}`)}`).join(',')}}`;
  }
  throw new Error(`julius_guidance_canonical_unsupported:${path}`);
}

/**
 * THE PACKET DIGEST — over the ADVICE and the AGREEMENT IT WAS WRITTEN UNDER.
 *
 * `binding` is inside the hash on purpose: the same words issued under contract
 * revision 2 are a different packet from the ones issued under revision 1,
 * because they were written knowing different terms. `packetDigest` is excluded
 * for the obvious reason and `issuedAt` because a re-derivation after recovery
 * would move it.
 */
export function juliusGuidanceDigest(packet: Omit<JuliusGuidancePacket, 'packetDigest' | 'issuedAt'>): string {
  const { version: _version, ...rest } = packet;
  return `sha256:${createHash('sha256')
    .update(canonicalise({ version: JULIUS_GUIDANCE_PACKET_VERSION, packet: rest }, '$'))
    .digest('hex')}`;
}

export type JuliusGuidanceOutcome =
  | { readonly outcome: 'ISSUED'; readonly packet: JuliusGuidancePacket }
  | { readonly outcome: 'REFUSED'; readonly reasonCode: string };

/**
 * ASSEMBLE A PACKET FROM A SANITISED PROPOSAL AND JULIUS'S OWN FACTS.
 *
 * `contractCriterionIds` is the contract's criterion set, and the refusal it
 * powers is the sharp end of proof 7: an architect may say "criterion C2 is
 * affected", and may not invent a C9 for the coder to satisfy. Naming a
 * criterion that does not exist is not a typo to be trimmed — it is an attempt
 * to widen the agreement, and it is refused as one.
 */
export function issueJuliusGuidance(input: {
  readonly guidanceId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly binding: JuliusTaskContractBinding;
  readonly revision: number;
  readonly triggeringCheckpointId: string;
  readonly proposal: JuliusGuidanceProposal;
  readonly contractCriterionIds: readonly string[];
  readonly issuedByWorkerId: string;
  readonly issuedAt: string;
}): JuliusGuidanceOutcome {
  const guidanceId = identifier(input.guidanceId);
  const runId = identifier(input.runId);
  const taskId = identifier(input.taskId);
  const triggeringCheckpointId = identifier(input.triggeringCheckpointId);
  const issuedByWorkerId = identifier(input.issuedByWorkerId);
  const issuedAt = identifier(input.issuedAt);
  if (guidanceId === null || runId === null || taskId === null
    || triggeringCheckpointId === null || issuedByWorkerId === null || issuedAt === null) {
    return { outcome: 'REFUSED', reasonCode: 'guidance_identity_required' };
  }
  if (!Number.isInteger(input.revision) || input.revision < 1) {
    return { outcome: 'REFUSED', reasonCode: 'guidance_revision_invalid' };
  }
  if (!Number.isInteger(input.binding.contractRevision) || input.binding.contractRevision < 1
    || identifier(input.binding.contractId) === null || identifier(input.binding.bindingDigest) === null) {
    return { outcome: 'REFUSED', reasonCode: 'guidance_binding_invalid' };
  }
  const known = new Set(input.contractCriterionIds);
  for (const criterionId of input.proposal.affectedCriterionIds) {
    if (!known.has(criterionId)) {
      return { outcome: 'REFUSED', reasonCode: 'guidance_names_unknown_criterion' };
    }
  }

  const body = {
    version: JULIUS_GUIDANCE_PACKET_VERSION,
    guidanceId, runId, taskId,
    binding: input.binding,
    revision: input.revision,
    triggeringCheckpointId,
    ...input.proposal,
    issuedByWorkerId,
  } as const;

  return {
    outcome: 'ISSUED',
    packet: Object.freeze({ ...body, issuedAt, packetDigest: juliusGuidanceDigest(body) }),
  };
}

/**
 * IS THIS GUIDANCE STILL THE CURRENT AGREEMENT'S?
 *
 * The same four answers the contract binding uses, computed the same way and
 * for the same reason: after a revision, advice written under the old terms is
 * not merely older, it may be wrong, and rebinding it silently to the new
 * revision would be Julius forging the architect's signature.
 */
export type JuliusGuidanceCurrency = 'CURRENT' | 'STALE' | 'FOREIGN' | 'INDETERMINATE';

export function evaluateJuliusGuidanceCurrency(input: {
  readonly guidance: Pick<JuliusGuidancePacket, 'binding'> | null;
  readonly contract: { readonly contractId: string; readonly taskId: string; readonly contractRevision: number; readonly bindingDigest: string | null } | null;
}): JuliusGuidanceCurrency {
  const guidance = input.guidance;
  const contract = input.contract;
  if (guidance === null || contract === null) return 'INDETERMINATE';
  if (contract.bindingDigest === null) return 'INDETERMINATE';
  const recorded = guidance.binding;
  if (recorded.contractId !== contract.contractId || recorded.taskId !== contract.taskId) return 'FOREIGN';
  if (!Number.isInteger(recorded.contractRevision) || recorded.contractRevision < 1) return 'INDETERMINATE';
  if (recorded.contractRevision > contract.contractRevision) return 'FOREIGN';
  if (recorded.contractRevision < contract.contractRevision) return 'STALE';
  return recorded.bindingDigest === contract.bindingDigest ? 'CURRENT' : 'FOREIGN';
}

/* -------------------------------------------------------------------- routing */

/**
 * WHAT JULIUS SHOULD DO ABOUT A CHECKPOINT — a named intention, never an act.
 *
 * Each variant corresponds to machinery Julius already owns, and this function
 * performs none of it. That separation is the whole reason a worker cannot
 * redefine mission authority: the strongest thing a reviewer can do is cause
 * this function to return `HALT`, and Julius still decides whether to halt.
 */
export type JuliusCheckpointRouting =
  | { readonly route: 'CONTINUE'; readonly reasonCode: string }
  | { readonly route: 'REQUEST_GUIDANCE'; readonly role: JuliusWorkerRole; readonly reasonCode: string }
  | { readonly route: 'REQUEST_REVIEW'; readonly role: JuliusWorkerRole; readonly reasonCode: string }
  | { readonly route: 'REQUIRE_REPAIR'; readonly reasonCode: string }
  | { readonly route: 'REQUIRE_CONTRACT_REVISION'; readonly reasonCode: string }
  /**
   * JULIUS GOES AND LOOKS, on behalf of the slot that asked.
   *
   * The only route that schedules no worker, because retrieval is Julius's own
   * act rather than somebody else's turn. It is still a BARRIER: the asking
   * worker's dispatch ends and its continuation carries the observation, which
   * is what makes the answer arrive before the work that depends on it rather
   * than after.
   */
  | { readonly route: 'SERVE_RESEARCH'; readonly reasonCode: string }
  | { readonly route: 'HALT'; readonly reasonCode: string };

/**
 * The triggers that warrant asking the architect, absent any reviewer verdict.
 * `TEST_FAILED` is here and `MATERIAL_EVIDENCE` is not: a failing test is a
 * question about the plan, while evidence arriving is a question about the
 * work, and the reviewer is the one who reads work.
 */
const GUIDANCE_TRIGGERS: readonly JuliusCheckpointTrigger[] = Object.freeze([
  'GUIDANCE_REQUESTED', 'SUBSYSTEM_DISCOVERED', 'TEST_FAILED',
]);

/**
 * The triggers that warrant asking the reviewer, absent any verdict. Every one
 * of them is a moment where something now EXISTS that nobody has checked.
 */
const REVIEW_TRIGGERS: readonly JuliusCheckpointTrigger[] = Object.freeze([
  'CONTRACT_DRAFTED', 'CONTRACT_REVISION_PROPOSED', 'IMPLEMENTATION_MILESTONE',
  'MATERIAL_EVIDENCE', 'SECURITY_SENSITIVE_CHANGE', 'REPAIR_ROUND_ENTERED',
  'PRE_COMPLETION_VERIFICATION',
]);

export function routeJuliusCheckpoint(input: {
  readonly checkpoint: JuliusMissionCheckpoint;
  readonly verdict: JuliusCheckpointVerdictRecord | null;
  /** True when an unresolved guidance task already exists for this subject. */
  readonly guidanceInFlight: boolean;
  readonly contractState: JuliusTaskContractState | null;
}): JuliusCheckpointRouting {
  const verdict = input.verdict;

  // A VERDICT OUTRANKS THE TRIGGER. The reviewer has read the thing; the
  // trigger only says it happened.
  if (verdict !== null && verdict.checkpointId === input.checkpoint.checkpointId) {
    if (verdict.verdict === 'BLOCK') {
      return { route: 'HALT', reasonCode: verdict.reasonCode };
    }
    if (verdict.verdict === 'REPAIR_REQUIRED') {
      return { route: 'REQUIRE_REPAIR', reasonCode: verdict.reasonCode };
    }
    if (verdict.verdict === 'CHALLENGE') {
      // A CHALLENGE AGAINST A LOCKED CONTRACT IS THE REVISION MODEL'S ENTRY
      // POINT, and against a draft it is the existing pre-lock challenge. Both
      // end at a reviewed revision; neither amends anything here.
      return { route: 'REQUIRE_CONTRACT_REVISION', reasonCode: verdict.reasonCode };
    }
    // CONTINUE and WARNING both continue. A WARNING is recorded and does not
    // interrupt — that is what makes it different from a CHALLENGE, and why a
    // reviewer that wants to stop the run has to say so.
    return { route: 'CONTINUE', reasonCode: verdict.reasonCode };
  }

  if (input.checkpoint.trigger === 'RESEARCH_REQUESTED') {
    /**
     * NO ANTI-SPAM GATE HERE, and that is deliberate rather than an oversight.
     *
     * Guidance is rate-limited by "one outstanding question per subject"
     * because asking the architect twice about the same thing costs a worker's
     * turn and adds nothing. Research is limited by the slot's own retrieval
     * budget, which is a harder bound and a per-slot one: a worker that asks
     * too often runs out, is told so by name, and cannot borrow a peer's share.
     * Adding a second limiter on top would refuse a legitimate second question
     * about a different page for no reason anyone could state.
     */
    return { route: 'SERVE_RESEARCH', reasonCode: 'CHECKPOINT_RESEARCH_REQUESTED' };
  }

  if (GUIDANCE_TRIGGERS.includes(input.checkpoint.trigger)) {
    // ASKING TWICE IS PROMPT SPAM. One outstanding guidance task per subject is
    // the whole of the anti-spam rule: the next checkpoint of the same kind
    // adds nothing the architect is not already answering.
    if (input.guidanceInFlight) return { route: 'CONTINUE', reasonCode: 'GUIDANCE_ALREADY_IN_FLIGHT' };
    if (input.contractState !== 'LOCKED') {
      // Before LOCK the architect is already the task holder; guidance would be
      // the architect asking itself.
      return { route: 'CONTINUE', reasonCode: 'CONTRACT_NOT_LOCKED' };
    }
    return { route: 'REQUEST_GUIDANCE', role: 'PROMPT_ARCHITECT', reasonCode: `CHECKPOINT_${input.checkpoint.trigger}` };
  }

  if (REVIEW_TRIGGERS.includes(input.checkpoint.trigger)) {
    return { route: 'REQUEST_REVIEW', role: 'INDEPENDENT_REVIEWER', reasonCode: `CHECKPOINT_${input.checkpoint.trigger}` };
  }

  // Unreachable while research plus the two lists partition the trigger set.
  return { route: 'CONTINUE', reasonCode: 'NO_ROUTE' };
}

/* ---------------------------------------------------------------- task naming */

/**
 * The task ids the routing produces. Shaped like the repair ids
 * (`repair:<parent>:<round>:task`) so a reader can tell at a glance what a task
 * is FOR and what it is ABOUT, and so an impostor cannot borrow the name.
 */
export const juliusGuidanceTaskId = (subjectTaskId: string, revision: number): string =>
  `guidance:${subjectTaskId}:${revision}:task`;

/**
 * Keyed by the SUBJECT and the sequence, not by the run, so the id is derivable
 * from durable state on replay rather than minted from a counter a restart
 * would lose — the same reason the repair ids are shaped the way they are.
 */
export const juliusCheckpointId = (subjectTaskId: string, sequence: number): string =>
  `checkpoint:${subjectTaskId}:${sequence}`;

/**
 * A RESEARCH CHECKPOINT LIVES IN ITS OWN NAMESPACE.
 *
 * Both lineages number their yields from the subject's durable segment rows, so
 * without the `research:` segment a research checkpoint and a guidance
 * checkpoint of the same subject would eventually claim the same id — and the
 * one that arrived second would be recorded as a duplicate of a question it has
 * nothing to do with.
 */
export const juliusResearchCheckpointId = (subjectTaskId: string, sequence: number): string =>
  `checkpoint:research:${subjectTaskId}:${sequence}`;

export const juliusGuidanceId = (subjectTaskId: string, revision: number): string =>
  `guidance:${subjectTaskId}:${revision}`;

/** `guidance:<subject>:<n>:task` → the subject it was issued for, or null. */
export function guidanceSubjectTaskId(taskId: string): string | null {
  const match = /^guidance:(.+):([1-9]\d*):task$/u.exec(taskId);
  return match === null ? null : match[1]!;
}

/**
 * THE ADVICE, AS THE WORKER IT WAS WRITTEN FOR WILL READ IT.
 *
 * THE GAP THIS CLOSES. A guidance packet was stored as an artifact and read by
 * exactly one consumer — the Independent Reviewer, so it could judge the
 * advice. The Coding Agent it was written FOR was handed nothing: its
 * continuation resumed carrying `brain:segment-resume`, which is what the coder
 * itself said before it paused. A mission could buy an architect dispatch and a
 * review of its output, and the worker that asked the question never saw a word
 * of the answer. `guidanceConsumed` stayed UNKNOWN for the plainest possible
 * reason: nothing consumed guidance.
 *
 * Research already closed this loop — `renderJuliusResearchResume` puts the
 * observations on the continuation's own Project Brain channel. This is the
 * same shape for the other kind of answer, and deliberately so: one channel,
 * one redaction path, one provenance record, and no prose side channel.
 *
 * BOUNDED, AND TRUNCATION SAYS SO. A packet cut silently would leave a coder
 * reasoning from advice it believes it read in full, which is worse than
 * shorter advice and much worse than being told.
 *
 * IT CARRIES NO AUTHORITY IT DID NOT HAVE. The packet is already refused if it
 * names a contract term; this renders what survived that refusal, and says in
 * the text itself that the agreement is elsewhere and unchanged.
 */
export const JULIUS_GUIDANCE_HANDOFF_CHARS = 6_000;

export function renderJuliusGuidanceHandoff(packet: JuliusGuidancePacket): string {
  const header = [
    `GUIDANCE FROM THE PROMPT ARCHITECT (revision ${String(packet.revision)}, `
    + `for checkpoint ${packet.triggeringCheckpointId})`,
    'It is ADVICE. The Mission Contract is unchanged and remains the agreement you are held to;'
    + ' nothing below may widen it, and a prohibition here only ever narrows what you may do.',
    '',
    `SUB-OBJECTIVE: ${packet.subObjective}`,
  ];

  const sections: { readonly title: string; readonly items: readonly string[] }[] = [
    { title: 'RECOMMENDED ACTIONS', items: packet.recommendedActions },
    { title: 'ADDITIONAL PROHIBITIONS (narrowing only)', items: packet.additionalProhibitions },
    { title: 'RELEVANT REQUIREMENTS', items: packet.relevantRequirements },
    { title: 'RELEVANT CONSTRAINTS', items: packet.relevantConstraints },
    { title: 'WHAT THE ARCHITECT FOUND IN THE REPOSITORY', items: packet.repositoryFindings },
    { title: 'WHAT THE ARCHITECT FOUND AT RUNTIME', items: packet.runtimeFindings },
    {
      title: 'REFERENCES',
      items: packet.references.map((reference) =>
        `[${reference.kind}/${reference.trust}] ${reference.locator}`),
    },
    /* LAST, AND KEPT. What the architect could NOT settle is the part a coder
       most needs to know it is deciding for itself. */
    { title: 'STILL UNRESOLVED — the architect could not settle these', items: packet.unresolvedQuestions },
  ];

  const lines = [...header];
  let budget = JULIUS_GUIDANCE_HANDOFF_CHARS - header.join('\n').length;
  let dropped = 0;
  for (const section of sections) {
    if (section.items.length === 0) continue;
    const block = [`${section.title}:`, ...section.items.map((item) => `  - ${item}`)].join('\n');
    if (block.length > budget) { dropped += section.items.length; continue; }
    budget -= block.length;
    lines.push('', block);
  }
  if (dropped > 0) {
    lines.push('', `${String(dropped)} further guidance item(s) did not fit this packet and were not included. `
      + 'They are in the durable record; ask again for a specific one if you need it.');
  }
  return lines.join('\n').trimEnd();
}

/**
 * THE ENTRY ID A DELIVERED GUIDANCE PACKET TAKES ON THE CONTINUATION'S BRAIN.
 *
 * The REVISION is in the id, and that is the whole point: `appendBrainEntry` is
 * idempotent per id, so a second packet for the same continuation must be a
 * different entry or the coder would be handed the first advice forever while
 * the record said a second was issued. Revisions are monotonic per subject, so
 * two packets are always ordered and both are readable.
 */
export const juliusGuidanceHandoffEntryId = (continuationTaskId: string, revision: number): string =>
  `brain:guidance-answer:${continuationTaskId}:r${String(revision)}`;

/** Is this one of them? Used to count what a compiled packet actually carried. */
export const isJuliusGuidanceHandoffEntryId = (entryId: string): boolean =>
  /^brain:guidance-answer:.+:r[1-9]\d*$/u.test(entryId);
