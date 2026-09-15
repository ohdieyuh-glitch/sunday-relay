import { createHash } from 'node:crypto';

import type { JuliusTask, JuliusWorkerRole } from './julius-runtime';

/**
 * THE PEER CHANNEL — every exchange between Julius's sustained workers, as
 * durable, auditable mission state.
 *
 * The Prompt Architect and the Independent Reviewer are sustained peers, not
 * bookends: the architect is asked questions during implementation and asked to
 * defend its design, the reviewer is asked to judge work and may challenge what
 * it judged. Before this module those exchanges were untyped — a guidance
 * request carried no id, no source, no target and no status, and a review
 * request was only the existence of a `:review` task. A reader of the ledger
 * could see that a task ran and not WHO ASKED WHOM, FOR WHAT, OR WHETHER IT WAS
 * ANSWERED.
 *
 * WHAT A PEER REQUEST IS. A row with a closed kind, a direction that kind
 * permits, a status that only moves along legal transitions, and provenance
 * back to the checkpoint, evidence and contract binding it was raised under.
 * The row is written as a ledger event; the state of every request is a
 * PROJECTION over those events (`foldJuliusPeerRequests`), so there is no
 * mutable second copy to drift.
 *
 * WHAT IT IS NOT. A message bus. A request never carries a payload a peer acts
 * on directly: the work it asks for is still a TASK — claimed, dispatched,
 * banked, reviewed and decided like every other unit — and the answer still
 * travels the Project Brain. The channel is the audit of that exchange and the
 * rule for who may address whom, not a way around the task graph.
 *
 * AUTHORITY STAYS WITH JULIUS. `guardJuliusPeerResponse` refuses any peer
 * output that names a mission-owned term or a Julius-only outcome; nothing a
 * peer writes can change the objective, the criteria, the budget, the
 * permissions, the security boundary, provider authority or contract
 * ownership, and no peer can mint VERIFIED.
 *
 * Pure: no clock and no network; the only Node API is the digest that bounds a
 * long request id, as the guidance packet digest already uses. Time arrives as an
 * injected string.
 */

/* ------------------------------------------------------------------ vocabulary */

/** Who may take part. JULIUS is the orchestrator, never a worker slot. */
export const JULIUS_PEER_PARTIES = ['JULIUS', 'PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as const;
export type JuliusPeerParty = (typeof JULIUS_PEER_PARTIES)[number];

export const JULIUS_PEER_REQUEST_KINDS = [
  'GUIDANCE_QUESTION',
  'REVIEW_REQUEST',
  'CHALLENGE',
  'EVIDENCE_CHALLENGE',
  'REBUTTAL_REQUEST',
  'REPLAN_PROPOSAL',
  'CLARIFICATION',
] as const;
export type JuliusPeerRequestKind = (typeof JULIUS_PEER_REQUEST_KINDS)[number];

export const JULIUS_PEER_REQUEST_STATUSES = ['OPEN', 'ANSWERED', 'REFUSED', 'SUPERSEDED', 'RESOLVED'] as const;
export type JuliusPeerRequestStatus = (typeof JULIUS_PEER_REQUEST_STATUSES)[number];

export const JULIUS_PEER_RESPONSE_TYPES = [
  'GUIDANCE_PACKET',
  'REVIEW_VERDICT',
  'DISAGREEMENT_RESOLUTION',
  'REBUTTAL',
  'REPLAN_DECISION',
  'CLARIFICATION_ANSWER',
] as const;
export type JuliusPeerResponseType = (typeof JULIUS_PEER_RESPONSE_TYPES)[number];

export const JULIUS_PEER_CHANNEL_VERSION = 'julius-peer-channel.v1' as const;

/**
 * WHO MAY ADDRESS WHOM, AND WHAT ANSWER IS OWED — closed, per kind.
 *
 *   Coding Agent → Architect       GUIDANCE_QUESTION
 *   Julius → Reviewer              REVIEW_REQUEST
 *   Reviewer → Julius              CHALLENGE
 *   Reviewer → Architect, THROUGH JULIUS
 *                                  EVIDENCE_CHALLENGE — addressed to Julius and
 *                                  naming the architect as the party it is about
 *                                  (`mediatedFor`); a reviewer never reaches the
 *                                  architect directly
 *   Julius → Architect             REBUTTAL_REQUEST
 *   Architect → Julius             REPLAN_PROPOSAL
 *   Julius → either peer           CLARIFICATION
 *
 * Anything else is refused by `openJuliusPeerRequest`. There is no row for a
 * peer addressing another peer directly, and none for a worker addressing
 * itself.
 */
export const JULIUS_PEER_REQUEST_RULES: Readonly<Record<JuliusPeerRequestKind, {
  readonly sources: readonly JuliusPeerParty[];
  readonly targets: readonly JuliusPeerParty[];
  readonly mediatedFor: readonly JuliusPeerParty[] | null;
  readonly response: JuliusPeerResponseType;
}>> = Object.freeze({
  GUIDANCE_QUESTION: { sources: ['CODING_AGENT'], targets: ['PROMPT_ARCHITECT'], mediatedFor: null, response: 'GUIDANCE_PACKET' },
  REVIEW_REQUEST: { sources: ['JULIUS'], targets: ['INDEPENDENT_REVIEWER'], mediatedFor: null, response: 'REVIEW_VERDICT' },
  CHALLENGE: { sources: ['INDEPENDENT_REVIEWER'], targets: ['JULIUS'], mediatedFor: null, response: 'DISAGREEMENT_RESOLUTION' },
  EVIDENCE_CHALLENGE: { sources: ['INDEPENDENT_REVIEWER'], targets: ['JULIUS'], mediatedFor: ['PROMPT_ARCHITECT'], response: 'DISAGREEMENT_RESOLUTION' },
  REBUTTAL_REQUEST: { sources: ['JULIUS'], targets: ['PROMPT_ARCHITECT'], mediatedFor: null, response: 'REBUTTAL' },
  REPLAN_PROPOSAL: { sources: ['PROMPT_ARCHITECT'], targets: ['JULIUS'], mediatedFor: null, response: 'REPLAN_DECISION' },
  CLARIFICATION: { sources: ['JULIUS'], targets: ['PROMPT_ARCHITECT', 'INDEPENDENT_REVIEWER'], mediatedFor: null, response: 'CLARIFICATION_ANSWER' },
});

/**
 * THE LEGAL MOVES OF A REQUEST.
 *
 *   OPEN      -> ANSWERED    the target produced the owed response
 *             -> REFUSED     it could not or would not, with a code
 *             -> SUPERSEDED  a later request on the same subject replaced it
 *             -> RESOLVED    Julius closed it without an answer being needed
 *   ANSWERED  -> RESOLVED    Julius accepted the answer and acted on it
 *             -> OPEN        Julius REJECTED the answer: the response is still
 *                            owed, and the work paused on it stays paused
 *             -> SUPERSEDED
 *
 * REFUSED, SUPERSEDED and RESOLVED are terminal: a resolved question cannot be
 * reopened by a late answer. Reopening is only ever Julius's move on an answer
 * it judged, and it names why.
 */
export const JULIUS_PEER_REQUEST_TRANSITIONS: Readonly<Record<JuliusPeerRequestStatus, readonly JuliusPeerRequestStatus[]>> = Object.freeze({
  OPEN: ['ANSWERED', 'REFUSED', 'SUPERSEDED', 'RESOLVED'],
  ANSWERED: ['RESOLVED', 'OPEN', 'SUPERSEDED'],
  REFUSED: [],
  SUPERSEDED: [],
  RESOLVED: [],
});

export const JULIUS_PEER_REQUEST_LIMITS = Object.freeze({
  reasonChars: 280,
  contextRefs: 16,
  evidenceIds: 16,
  /**
   * EVERY ID LIST, IN CHARACTERS. The ledger row carries the whole request and
   * the event validator refuses a payload over 8 KiB — which would throw inside
   * the tick that tried to write it. Three lists at this cap plus every scalar
   * stay well under.
   */
  listChars: 1024,
  /** Julius task ids are not bounded short: a repair of a continuation of a guidance task is long by construction. */
  identifierChars: 512,
  /** The request id stays short enough to index and to read. */
  requestIdChars: 200,
});

/* ----------------------------------------------------------------- the request */

export interface JuliusPeerRequest {
  readonly requestId: string;
  readonly channelVersion: typeof JULIUS_PEER_CHANNEL_VERSION;
  readonly missionId: string;
  readonly runId: string;
  readonly projectId: string;
  /** The execution attempt this request belongs to. Part of `requestId`. */
  readonly executionScope: string;
  readonly sourceRole: JuliusPeerParty;
  readonly targetRole: JuliusPeerParty;
  /** For a mediated kind, the party the request is ABOUT; null otherwise. */
  readonly mediatedFor: JuliusPeerParty | null;
  readonly kind: JuliusPeerRequestKind;
  /** A bounded, closed-vocabulary-or-safe sentence. Never a provider body. */
  readonly reason: string;
  /** The unit of work the exchange concerns. */
  readonly subjectTaskId: string;
  /** The task that carries the requested work, when one exists. */
  readonly carrierTaskId: string | null;
  /** Ids a reader follows: tasks, Project Brain entries, evidence. Never text. */
  readonly contextRefs: readonly string[];
  /**
   * WHETHER WORK WAITS ON THE ANSWER, and which. A mandatory request names the
   * tasks it pauses; the pause itself is the task graph's — each named task is
   * BLOCKED on the request's carrier and only Julius's accepting decision
   * releases it — so the field is the audit of a barrier, never the barrier.
   */
  readonly mandatory: boolean;
  readonly pausedTaskIds: readonly string[];
  /** How many tasks the request pauses; more than `pausedTaskIds` names when they did not all fit. */
  readonly pausedTaskCount: number;
  readonly requiredResponseType: JuliusPeerResponseType;
  readonly status: JuliusPeerRequestStatus;
  readonly checkpointId: string | null;
  readonly evidenceIds: readonly string[];
  readonly contractBindingDigest: string | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  /** What answered it: a guidance id, a verdict record, a resolution id. */
  readonly responseRef: string | null;
  /** The code the last move gave: why it was refused, reopened or superseded, or how it was resolved. */
  readonly transitionCode: string | null;
}

export type JuliusPeerRequestOutcome =
  | { readonly outcome: 'OPENED'; readonly request: JuliusPeerRequest }
  | { readonly outcome: 'REFUSED'; readonly reasonCode: string };

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

const identifier = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= JULIUS_PEER_REQUEST_LIMITS.identifierChars && IDENTIFIER.test(value)
    ? value
    : null;

const idList = (value: unknown, limit: number): readonly string[] | null => {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > limit) return null;
  const out: string[] = [];
  for (const item of value) {
    const id = identifier(item);
    if (id === null) return null;
    if (!out.includes(id)) out.push(id);
  }
  if (out.join(' ').length > JULIUS_PEER_REQUEST_LIMITS.listChars) return null;
  return Object.freeze(out);
};

/**
 * THE IDS THAT FIT, AND HOW MANY THERE WERE. For a caller naming work it did not
 * choose — every task a decision gates — so the row stays writable and the
 * count stays true when the names do not all fit.
 */
export function juliusPeerIdsThatFit(ids: readonly string[]): { readonly ids: readonly string[]; readonly total: number } {
  const unique = [...new Set(ids)];
  const kept: string[] = [];
  let chars = 0;
  for (const id of unique) {
    const cost = id.length + (kept.length === 0 ? 0 : 1);
    if (kept.length >= JULIUS_PEER_REQUEST_LIMITS.contextRefs || chars + cost > JULIUS_PEER_REQUEST_LIMITS.listChars) break;
    kept.push(id);
    chars += cost;
  }
  return { ids: Object.freeze(kept), total: unique.length };
}

const safeReason = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim();
  if (text.length === 0 || text.length > JULIUS_PEER_REQUEST_LIMITS.reasonChars) return null;
  if (/(?:api[_-]?key|authorization|bearer|token|secret|password)\s*[=:]/iu.test(text)) return null;
  return text;
};

const isParty = (value: unknown): value is JuliusPeerParty =>
  typeof value === 'string' && (JULIUS_PEER_PARTIES as readonly string[]).includes(value);

/**
 * THE REQUEST'S IDENTITY, and why the execution scope is part of it.
 *
 * A Julius run id is derived from the mission contract, so every workflow
 * attempt of one mission carries the SAME run id — qualification attempts 1–3
 * all ran as `run:5408584e00ffb49fd1c011a1`. An identity derived from the run
 * and the subject alone would make attempt 3's challenge and attempt 4's the
 * same row wherever the two are read together: the paid-run archive, a Project
 * Brain import, a receipt. The scope — the workflow run and attempt in a paid
 * run — separates them; the anchor keeps the id stable across replays and
 * restarts within one attempt, so a replayed tick names the same request.
 */
export function juliusPeerRequestId(input: {
  readonly kind: JuliusPeerRequestKind;
  readonly executionScope: string;
  readonly anchor: string;
}): string {
  const plain = `peer:${input.kind.toLowerCase()}:${input.executionScope}:${input.anchor}`;
  if (plain.length <= JULIUS_PEER_REQUEST_LIMITS.requestIdChars) return plain;
  // BOUNDED, NOT TRUNCATED. Two long anchors that share a prefix must not share
  // an id, so a long anchor is replaced by its digest rather than cut.
  const digest = createHash('sha256').update(input.anchor).digest('hex').slice(0, 32);
  return `peer:${input.kind.toLowerCase()}:${input.executionScope}:h-${digest}`;
}

export function openJuliusPeerRequest(input: {
  readonly kind: string;
  readonly missionId: string;
  readonly runId: string;
  readonly projectId: string;
  readonly executionScope: string;
  readonly anchor: string;
  readonly sourceRole: string;
  readonly targetRole: string;
  readonly mediatedFor?: string | null;
  readonly reason: string;
  readonly subjectTaskId: string;
  readonly carrierTaskId?: string | null;
  readonly contextRefs?: readonly string[];
  readonly mandatory?: boolean;
  readonly pausedTaskIds?: readonly string[];
  readonly pausedTaskCount?: number;
  readonly checkpointId?: string | null;
  readonly evidenceIds?: readonly string[];
  readonly contractBindingDigest?: string | null;
  readonly createdAt: string;
}): JuliusPeerRequestOutcome {
  if (!(JULIUS_PEER_REQUEST_KINDS as readonly string[]).includes(input.kind)) {
    return { outcome: 'REFUSED', reasonCode: 'peer_request_kind_unknown' };
  }
  const kind = input.kind as JuliusPeerRequestKind;
  const rule = JULIUS_PEER_REQUEST_RULES[kind];
  if (!isParty(input.sourceRole) || !isParty(input.targetRole)) {
    return { outcome: 'REFUSED', reasonCode: 'peer_request_party_unknown' };
  }
  if (input.sourceRole === input.targetRole) {
    return { outcome: 'REFUSED', reasonCode: 'peer_request_addresses_itself' };
  }
  if (!rule.sources.includes(input.sourceRole) || !rule.targets.includes(input.targetRole)) {
    return { outcome: 'REFUSED', reasonCode: 'peer_request_direction_refused' };
  }
  const mediated = input.mediatedFor ?? null;
  if (rule.mediatedFor === null) {
    if (mediated !== null) return { outcome: 'REFUSED', reasonCode: 'peer_request_mediation_refused' };
  } else if (mediated === null || !isParty(mediated) || !rule.mediatedFor.includes(mediated)) {
    return { outcome: 'REFUSED', reasonCode: 'peer_request_mediation_required' };
  }

  const missionId = identifier(input.missionId);
  const runId = identifier(input.runId);
  const projectId = identifier(input.projectId);
  const executionScope = identifier(input.executionScope);
  const anchor = identifier(input.anchor);
  const subjectTaskId = identifier(input.subjectTaskId);
  const createdAt = identifier(input.createdAt);
  if (missionId === null || runId === null || projectId === null || executionScope === null
    || anchor === null || subjectTaskId === null || createdAt === null) {
    return { outcome: 'REFUSED', reasonCode: 'peer_request_identity_required' };
  }
  // The scope is part of every id; a scope that could crowd out the anchor is refused.
  if (executionScope.length > 64) return { outcome: 'REFUSED', reasonCode: 'peer_request_scope_invalid' };
  const carrierTaskId = input.carrierTaskId === undefined || input.carrierTaskId === null ? null : identifier(input.carrierTaskId);
  if (input.carrierTaskId !== undefined && input.carrierTaskId !== null && carrierTaskId === null) {
    return { outcome: 'REFUSED', reasonCode: 'peer_request_carrier_invalid' };
  }
  const checkpointId = input.checkpointId === undefined || input.checkpointId === null ? null : identifier(input.checkpointId);
  if (input.checkpointId !== undefined && input.checkpointId !== null && checkpointId === null) {
    return { outcome: 'REFUSED', reasonCode: 'peer_request_checkpoint_invalid' };
  }
  const reason = safeReason(input.reason);
  if (reason === null) return { outcome: 'REFUSED', reasonCode: 'peer_request_reason_invalid' };
  const contextRefs = idList(input.contextRefs, JULIUS_PEER_REQUEST_LIMITS.contextRefs);
  if (contextRefs === null) return { outcome: 'REFUSED', reasonCode: 'peer_request_context_refs_invalid' };
  const evidenceIds = idList(input.evidenceIds, JULIUS_PEER_REQUEST_LIMITS.evidenceIds);
  if (evidenceIds === null) return { outcome: 'REFUSED', reasonCode: 'peer_request_evidence_invalid' };
  const pausedTaskIds = idList(input.pausedTaskIds, JULIUS_PEER_REQUEST_LIMITS.contextRefs);
  if (pausedTaskIds === null) return { outcome: 'REFUSED', reasonCode: 'peer_request_paused_tasks_invalid' };
  const mandatory = input.mandatory === true;
  // A PAUSE WITH NOTHING TO CARRY THE ANSWER IS A PAUSE NOTHING CAN END.
  if (mandatory && carrierTaskId === null) {
    return { outcome: 'REFUSED', reasonCode: 'peer_request_mandatory_requires_carrier' };
  }
  const pausedTaskCount = input.pausedTaskCount ?? pausedTaskIds.length;
  if (!Number.isSafeInteger(pausedTaskCount) || pausedTaskCount < pausedTaskIds.length) {
    return { outcome: 'REFUSED', reasonCode: 'peer_request_paused_tasks_invalid' };
  }
  if (!mandatory && pausedTaskCount > 0) {
    return { outcome: 'REFUSED', reasonCode: 'peer_request_pause_requires_mandatory' };
  }
  const digest = input.contractBindingDigest ?? null;
  if (digest !== null && !DIGEST.test(digest)) {
    return { outcome: 'REFUSED', reasonCode: 'peer_request_binding_invalid' };
  }
  // A CHALLENGE ACCUSES, AND AN ACCUSATION CITES. The same rule the checkpoint
  // verdict record applies to adversarial verdicts, held at the channel too.
  if ((kind === 'CHALLENGE' || kind === 'EVIDENCE_CHALLENGE') && evidenceIds.length === 0) {
    return { outcome: 'REFUSED', reasonCode: 'peer_challenge_requires_evidence' };
  }

  return {
    outcome: 'OPENED',
    request: Object.freeze({
      requestId: juliusPeerRequestId({ kind, executionScope, anchor }),
      channelVersion: JULIUS_PEER_CHANNEL_VERSION,
      missionId, runId, projectId, executionScope,
      sourceRole: input.sourceRole, targetRole: input.targetRole, mediatedFor: mediated as JuliusPeerParty | null,
      kind, reason, subjectTaskId, carrierTaskId, contextRefs, mandatory, pausedTaskIds, pausedTaskCount,
      requiredResponseType: rule.response,
      status: 'OPEN' as const,
      checkpointId, evidenceIds, contractBindingDigest: digest,
      createdAt, resolvedAt: null, responseRef: null, transitionCode: null,
    }),
  };
}

export type JuliusPeerTransitionOutcome =
  | { readonly outcome: 'TRANSITIONED'; readonly request: JuliusPeerRequest }
  | { readonly outcome: 'REFUSED'; readonly reasonCode: string };

/**
 * MOVE A REQUEST ALONG A LEGAL EDGE, OR REFUSE.
 *
 * The same target status twice is not a transition and is refused as
 * `peer_request_transition_repeated`, so a replayed tick that re-announces an
 * answer changes nothing rather than stamping a second `resolvedAt`. An answer
 * must name what answered; every other move must name why.
 */
export function transitionJuliusPeerRequest(
  request: JuliusPeerRequest,
  next: { readonly to: string; readonly at: string; readonly responseRef?: string | null; readonly transitionCode?: string | null },
): JuliusPeerTransitionOutcome {
  if (!(JULIUS_PEER_REQUEST_STATUSES as readonly string[]).includes(next.to)) {
    return { outcome: 'REFUSED', reasonCode: 'peer_request_status_unknown' };
  }
  const to = next.to as JuliusPeerRequestStatus;
  if (to === request.status) return { outcome: 'REFUSED', reasonCode: 'peer_request_transition_repeated' };
  if (!JULIUS_PEER_REQUEST_TRANSITIONS[request.status].includes(to)) {
    return { outcome: 'REFUSED', reasonCode: 'peer_request_transition_illegal' };
  }
  const at = identifier(next.at);
  if (at === null) return { outcome: 'REFUSED', reasonCode: 'peer_request_identity_required' };
  const responseRef = next.responseRef === undefined || next.responseRef === null ? null : identifier(next.responseRef);
  if (next.responseRef !== undefined && next.responseRef !== null && responseRef === null) {
    return { outcome: 'REFUSED', reasonCode: 'peer_request_response_ref_invalid' };
  }
  // AN ANSWER NAMES WHAT ANSWERED. "Answered" with nothing to follow is a claim.
  if (to === 'ANSWERED' && responseRef === null) {
    return { outcome: 'REFUSED', reasonCode: 'peer_request_answer_requires_ref' };
  }
  const code = next.transitionCode ?? null;
  if (code !== null && !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(code)) {
    return { outcome: 'REFUSED', reasonCode: 'peer_request_transition_code_invalid' };
  }
  // Every move that is not an answer says why it happened.
  if (to !== 'ANSWERED' && code === null) {
    return { outcome: 'REFUSED', reasonCode: 'peer_request_transition_requires_code' };
  }
  const terminal = to === 'RESOLVED' || to === 'REFUSED' || to === 'SUPERSEDED';
  return {
    outcome: 'TRANSITIONED',
    request: Object.freeze({
      ...request,
      status: to,
      // A reopened request keeps the answer it rejected on the record; a new
      // answer replaces it.
      responseRef: responseRef ?? request.responseRef,
      transitionCode: code,
      resolvedAt: terminal ? at : null,
    }),
  };
}

/* -------------------------------------------------------------- ledger shape */

/**
 * WHAT THE LEDGER CARRIES, flat and bounded. Arrays of ids are joined with a
 * space — ids never contain one — so the row stays inside the event validator's
 * primitive-facts rule and the whole request can be rebuilt from it.
 */
export function juliusPeerRequestOpenedFacts(request: JuliusPeerRequest): Record<string, string | number | boolean | null> {
  return {
    requestId: request.requestId,
    channelVersion: request.channelVersion,
    missionId: request.missionId,
    executionScope: request.executionScope,
    kind: request.kind,
    sourceRole: request.sourceRole,
    targetRole: request.targetRole,
    mediatedFor: request.mediatedFor,
    reason: request.reason,
    subjectTaskId: request.subjectTaskId,
    carrierTaskId: request.carrierTaskId,
    contextRefs: request.contextRefs.join(' '),
    mandatory: request.mandatory,
    pausedTaskIds: request.pausedTaskIds.join(' '),
    pausedTaskCount: request.pausedTaskCount,
    requiredResponseType: request.requiredResponseType,
    status: request.status,
    checkpointId: request.checkpointId,
    evidenceIds: request.evidenceIds.join(' '),
    contractBindingDigest: request.contractBindingDigest,
    createdAt: request.createdAt,
  };
}

export function juliusPeerRequestTransitionFacts(input: {
  readonly requestId: string;
  readonly to: JuliusPeerRequestStatus;
  readonly at: string;
  readonly responseRef?: string | null;
  readonly transitionCode?: string | null;
  /**
   * THE FACT THAT CAUSED THIS MOVE — a decision's idempotency key, a packet id.
   * A move is applied once per cause, so a resumed verification that re-reads an
   * old decision cannot reopen a question a later answer already addressed,
   * even though reopening would be a legal edge from where the request now is.
   */
  readonly causeRef?: string | null;
}): Record<string, string | number | boolean | null> {
  return {
    requestId: input.requestId,
    to: input.to,
    at: input.at,
    responseRef: input.responseRef ?? null,
    transitionCode: input.transitionCode ?? null,
    causeRef: input.causeRef ?? null,
  };
}

/** The minimal shape of a ledger event the fold reads. */
export interface JuliusPeerLedgerEntry {
  readonly type: string;
  readonly taskId?: string | null;
  readonly facts: Readonly<Record<string, string | number | boolean | null>>;
}

const splitIds = (value: unknown): readonly string[] =>
  typeof value === 'string' && value.length > 0 ? Object.freeze(value.split(' ')) : Object.freeze([]);
const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/**
 * EVERY REQUEST'S CURRENT STATE, FROM THE LEDGER ALONE.
 *
 * Idempotent over replays: a second `opened` row for an id already seen is
 * ignored, and a transition is applied only along a legal edge, so a duplicated
 * or out-of-order row cannot resurrect a resolved request or skip a state. A
 * transition for an id never opened is ignored rather than invented. Order is
 * the ledger's order; the projection has no clock.
 */
export function foldJuliusPeerRequests(entries: readonly JuliusPeerLedgerEntry[]): readonly JuliusPeerRequest[] {
  const byId = new Map<string, JuliusPeerRequest>();
  for (const entry of entries) {
    const facts = entry.facts;
    if (entry.type === 'peer.request.opened') {
      const requestId = text(facts.requestId);
      if (requestId === null || byId.has(requestId)) continue;
      const kind = text(facts.kind);
      const sourceRole = text(facts.sourceRole);
      const targetRole = text(facts.targetRole);
      const status = text(facts.status);
      const response = text(facts.requiredResponseType);
      if (kind === null || !(JULIUS_PEER_REQUEST_KINDS as readonly string[]).includes(kind)) continue;
      if (!isParty(sourceRole) || !isParty(targetRole)) continue;
      if (status !== 'OPEN' || response === null || !(JULIUS_PEER_RESPONSE_TYPES as readonly string[]).includes(response)) continue;
      byId.set(requestId, Object.freeze({
        requestId,
        channelVersion: JULIUS_PEER_CHANNEL_VERSION,
        missionId: text(facts.missionId) ?? '',
        runId: '',
        projectId: '',
        executionScope: text(facts.executionScope) ?? '',
        sourceRole, targetRole,
        mediatedFor: isParty(facts.mediatedFor) ? facts.mediatedFor : null,
        kind: kind as JuliusPeerRequestKind,
        reason: text(facts.reason) ?? '',
        subjectTaskId: text(facts.subjectTaskId) ?? '',
        carrierTaskId: text(facts.carrierTaskId),
        contextRefs: splitIds(facts.contextRefs),
        mandatory: facts.mandatory === true,
        pausedTaskIds: splitIds(facts.pausedTaskIds),
        pausedTaskCount: typeof facts.pausedTaskCount === 'number' ? facts.pausedTaskCount : splitIds(facts.pausedTaskIds).length,
        requiredResponseType: response as JuliusPeerResponseType,
        status: 'OPEN',
        checkpointId: text(facts.checkpointId),
        evidenceIds: splitIds(facts.evidenceIds),
        contractBindingDigest: text(facts.contractBindingDigest),
        createdAt: text(facts.createdAt) ?? '',
        resolvedAt: null, responseRef: null, transitionCode: null,
      }));
      continue;
    }
    if (entry.type === 'peer.request.transitioned') {
      const requestId = text(facts.requestId);
      const current = requestId === null ? undefined : byId.get(requestId);
      if (current === undefined) continue;
      const moved = transitionJuliusPeerRequest(current, {
        to: text(facts.to) ?? '',
        at: text(facts.at) ?? '',
        responseRef: text(facts.responseRef),
        transitionCode: text(facts.transitionCode),
      });
      if (moved.outcome === 'TRANSITIONED') byId.set(current.requestId, moved.request);
    }
  }
  return Object.freeze([...byId.values()]);
}

/* ------------------------------------------------------------ authority guard */

/**
 * THE TERMS ONLY JULIUS OWNS, as the keys a peer output might try to set.
 *
 * Matched on a normalised key (lower case, separators removed), at any depth,
 * so `acceptance_criteria`, `acceptanceCriteria` and `AcceptanceCriteria` are
 * one name. A peer PROPOSES changes to these through a REPLAN_PROPOSAL, which
 * Julius evaluates; it never writes them.
 */
export const JULIUS_PEER_PROTECTED_TERMS = Object.freeze([
  'objective',
  'missionobjective',
  'userobjective',
  'acceptancecriteria',
  'blockingacceptancecriteria',
  'criteria',
  'budget',
  'spendusd',
  'budgetusd',
  'budgetusdmicros',
  'permissions',
  'grantedpermissions',
  'grantedtools',
  'securityboundary',
  'sandboxpolicy',
  'network',
  'providerauthority',
  'allowedproviders',
  'provider',
  'contractowner',
  'contractownership',
  'missioncontract',
  'missioncontractrevision',
  'contractrevision',
  'contractstate',
  'lockedbyevaluatorid',
  // The task contract's boundary: what may be touched and what must be checked.
  'inscope',
  'outofscope',
  'permittedpaths',
  'prohibitedactions',
  'requiredchecks',
  'stoppingcondition',
  'bindingdigest',
]);

/** Outcomes and states only Julius may mint. */
export const JULIUS_ONLY_OUTCOMES = Object.freeze([
  'VERIFIED',
  'TASK_VERIFIED',
  'MISSION_VERIFIED',
  'COMPLETE',
  'COMPLETED',
  'ACCEPT',
  'HALT',
  'LOCKED',
]);

/** The keys whose VALUE would be a decision or a state if a peer set it. */
const DECISION_KEYS = Object.freeze(['verdict', 'status', 'state', 'decision', 'action', 'outcome', 'resolution', 'completion']);

const normaliseKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/gu, '');

export type JuliusPeerGuardOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasonCode: 'peer_response_mutates_protected_term' | 'peer_response_mints_julius_only_outcome' | 'peer_response_unreadable'; readonly path: string };

/**
 * REFUSE A PEER OUTPUT THAT REACHES FOR JULIUS'S AUTHORITY.
 *
 * Two walls, both structural:
 *   - a key naming a mission-owned term, anywhere in the output;
 *   - a decision-shaped key (`verdict`, `status`, `decision`, …) whose value is a
 *     Julius-only outcome such as VERIFIED or COMPLETE.
 *
 * A reviewer's canonical verdicts — CONTINUE, WARNING, CHALLENGE,
 * REPAIR_REQUIRED, BLOCK — pass; VERIFIED never does. The walk is bounded, and
 * an output deeper or wider than a legitimate one is refused as unreadable
 * rather than partially checked.
 */
export function guardJuliusPeerResponse(value: unknown): JuliusPeerGuardOutcome {
  let visited = 0;
  const walk = (node: unknown, path: string, depth: number): JuliusPeerGuardOutcome => {
    visited += 1;
    if (visited > 4_000 || depth > 12) return { ok: false, reasonCode: 'peer_response_unreadable', path };
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        const result = walk(node[index], `${path}[${String(index)}]`, depth + 1);
        if (!result.ok) return result;
      }
      return { ok: true };
    }
    if (node === null || typeof node !== 'object') return { ok: true };
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const normal = normaliseKey(key);
      const here = path === '' ? key : `${path}.${key}`;
      if ((JULIUS_PEER_PROTECTED_TERMS as readonly string[]).includes(normal)) {
        return { ok: false, reasonCode: 'peer_response_mutates_protected_term', path: here };
      }
      if (DECISION_KEYS.includes(normal) && typeof child === 'string'
        && (JULIUS_ONLY_OUTCOMES as readonly string[]).includes(child.trim().toUpperCase())) {
        return { ok: false, reasonCode: 'peer_response_mints_julius_only_outcome', path: here };
      }
      const result = walk(child, here, depth + 1);
      if (!result.ok) return result;
    }
    return { ok: true };
  };
  return walk(value, '', 0);
}

/* ---------------------------------------------------------- guidance lifecycle */

/**
 * WHAT A PIECE OF ARCHITECT GUIDANCE IS, UNTIL JULIUS DECIDES.
 *
 *   PROPOSED      the architect's guidance task has not finished
 *   UNDER_REVIEW  it finished and its review has not been decided
 *   ACCEPTED      Julius accepted it — the only state that is authoritative
 *   REJECTED      Julius sent it back for repair, or halted it
 *
 * Only ACCEPTED guidance is eligible as authoritative downstream context. The
 * live pipeline still hands the packet to the waiting segment before its review
 * is decided; that behaviour change is scheduled work, and this projection is
 * what it will gate on.
 */
export const JULIUS_GUIDANCE_STATES = ['PROPOSED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED'] as const;
export type JuliusGuidanceState = (typeof JULIUS_GUIDANCE_STATES)[number];

export function projectJuliusGuidanceState(input: {
  readonly guidanceTask: Pick<JuliusTask, 'taskId' | 'state'>;
  readonly decisionsForTask: readonly { readonly action: string }[];
}): JuliusGuidanceState {
  const actions = input.decisionsForTask.map((decision) => decision.action);
  if (actions.includes('ACCEPT') || actions.includes('COMPLETE')) return 'ACCEPTED';
  if (actions.includes('REPAIR') || actions.includes('HALT')) return 'REJECTED';
  if (input.guidanceTask.state === 'SUCCEEDED') return 'UNDER_REVIEW';
  if (input.guidanceTask.state === 'FAILED' || input.guidanceTask.state === 'CANCELLED') return 'REJECTED';
  return 'PROPOSED';
}

export const juliusGuidanceIsAuthoritative = (state: JuliusGuidanceState): boolean => state === 'ACCEPTED';

/* ------------------------------------------------------------ state projections */

export const JULIUS_ARCHITECT_PEER_STATES = [
  'STANDBY', 'PLANNING', 'RESEARCHING', 'GUIDING', 'REPLANNING', 'WAITING_ON_EVIDENCE', 'CHECKING_ALIGNMENT',
] as const;
export type JuliusArchitectPeerState = (typeof JULIUS_ARCHITECT_PEER_STATES)[number];

export const JULIUS_REVIEWER_PEER_STATES = [
  'STANDBY', 'OBSERVING', 'RESEARCHING', 'REVIEWING', 'CHALLENGING', 'WAITING_ON_REPAIR', 'REVIEWING_REPAIR', 'FINAL_REVIEW',
] as const;
export type JuliusReviewerPeerState = (typeof JULIUS_REVIEWER_PEER_STATES)[number];

export interface JuliusPeerStateInput {
  readonly tasks: readonly Pick<JuliusTask, 'taskId' | 'taskType' | 'role' | 'state' | 'parentTaskId'>[];
  readonly requests: readonly JuliusPeerRequest[];
  /**
   * The continuations Julius minted to carry a research answer, named by the
   * `checkpoint.verdict` rows that created them (`juliusResearchContinuationIds`).
   * Named, never inferred from an id shape: a guidance pause and a research
   * pause produce continuations with the same shape.
   */
  readonly researchContinuationTaskIds: readonly string[];
}

const LIVE_STATES = new Set(['RUNNABLE', 'ACTIVE', 'BLOCKED']);
const live = (task: { readonly state: string }): boolean => LIVE_STATES.has(task.state);

/** The research continuations a ledger names, in order and once each. */
export function juliusResearchContinuationIds(entries: readonly JuliusPeerLedgerEntry[]): readonly string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (entry.type !== 'checkpoint.verdict' || entry.facts.route !== 'SERVE_RESEARCH') continue;
    const id = entry.facts.continuationTaskId;
    if (typeof id === 'string' && id.length > 0 && !ids.includes(id)) ids.push(id);
  }
  return Object.freeze(ids);
}

/** A live continuation of this role that exists to carry a research answer. */
function researchContinuationFor(role: JuliusWorkerRole, input: JuliusPeerStateInput): boolean {
  return input.tasks.some((task) => task.role === role && live(task)
    && input.researchContinuationTaskIds.includes(task.taskId));
}

/**
 * WHAT THE ARCHITECT IS DOING, DERIVED — never stored.
 *
 * In precedence order, because more than one can be true at once and the
 * projection names the one that most constrains the mission:
 *   RESEARCHING         a live architect continuation that exists because it asked to read something
 *   REPLANNING          a live `repair:plan`, or an OPEN replan proposal it raised
 *   PLANNING            a live plan task
 *   CHECKING_ALIGNMENT  an OPEN rebuttal or clarification addressed to it
 *   GUIDING             a live guidance task, or an OPEN question addressed to it
 *   WAITING_ON_EVIDENCE it answered a rebuttal or proposal and Julius has not resolved it
 *   STANDBY             nothing is asked of it
 *
 * A worker ACTIVATES because a row says so — a task, a request — never because a
 * tick passed.
 */
export function projectJuliusArchitectState(input: JuliusPeerStateInput): JuliusArchitectPeerState {
  const mine = input.tasks.filter((task) => task.role === 'PROMPT_ARCHITECT' && live(task));
  const addressedOpen = (kinds: readonly JuliusPeerRequestKind[]) => input.requests.some(
    (request) => request.targetRole === 'PROMPT_ARCHITECT' && request.status === 'OPEN' && kinds.includes(request.kind),
  );
  if (researchContinuationFor('PROMPT_ARCHITECT', input)) return 'RESEARCHING';
  if (mine.some((task) => task.taskType === 'repair:plan')
    || input.requests.some((request) => request.kind === 'REPLAN_PROPOSAL' && request.sourceRole === 'PROMPT_ARCHITECT' && request.status === 'OPEN')) {
    return 'REPLANNING';
  }
  if (mine.some((task) => task.taskType === 'plan')) return 'PLANNING';
  if (mine.some((task) => task.taskType === 'rebuttal' || task.taskType === 'repair:rebuttal')
    || addressedOpen(['REBUTTAL_REQUEST', 'CLARIFICATION'])) {
    return 'CHECKING_ALIGNMENT';
  }
  if (mine.some((task) => task.taskType === 'guidance' || task.taskType === 'repair:guidance')
    || addressedOpen(['GUIDANCE_QUESTION'])) {
    return 'GUIDING';
  }
  if (input.requests.some((request) => request.status === 'ANSWERED'
    && ((request.kind === 'REBUTTAL_REQUEST' && request.targetRole === 'PROMPT_ARCHITECT')
      || (request.kind === 'REPLAN_PROPOSAL' && request.sourceRole === 'PROMPT_ARCHITECT')))) {
    return 'WAITING_ON_EVIDENCE';
  }
  return 'STANDBY';
}

/**
 * WHAT THE REVIEWER IS DOING, DERIVED — never stored.
 *
 * In precedence order:
 *   RESEARCHING       a live reviewer continuation that exists because it asked to read something
 *   FINAL_REVIEW      a live mission-level review, or an OPEN final review request
 *   REVIEWING_REPAIR  a live review of a repair, or of an architect's rebuttal
 *   REVIEWING         any other live review
 *   CHALLENGING       a challenge it raised that Julius has not resolved
 *   WAITING_ON_REPAIR a repair ordered on work it reviewed is live
 *   OBSERVING         work that will reach it is in progress
 *   STANDBY           nothing is in flight
 */
export function projectJuliusReviewerState(input: JuliusPeerStateInput): JuliusReviewerPeerState {
  const reviews = input.tasks.filter((task) => task.role === 'INDEPENDENT_REVIEWER' && live(task));
  if (researchContinuationFor('INDEPENDENT_REVIEWER', input)) return 'RESEARCHING';
  if (reviews.some((task) => task.taskType === 'review:mission')
    || input.requests.some((request) => request.kind === 'REVIEW_REQUEST' && request.status === 'OPEN' && request.subjectTaskId.startsWith('mission:'))) {
    return 'FINAL_REVIEW';
  }
  if (reviews.some((task) => task.taskType.startsWith('review:repair:') || task.taskType === 'review:rebuttal')) {
    return 'REVIEWING_REPAIR';
  }
  if (reviews.length > 0) return 'REVIEWING';
  if (input.requests.some((request) => request.sourceRole === 'INDEPENDENT_REVIEWER'
    && (request.kind === 'CHALLENGE' || request.kind === 'EVIDENCE_CHALLENGE')
    && (request.status === 'OPEN' || request.status === 'ANSWERED'))) {
    return 'CHALLENGING';
  }
  if (input.tasks.some((task) => live(task) && task.role !== 'INDEPENDENT_REVIEWER' && task.taskType.startsWith('repair:'))) {
    return 'WAITING_ON_REPAIR';
  }
  if (input.tasks.some((task) => live(task) && task.role !== 'INDEPENDENT_REVIEWER')) return 'OBSERVING';
  return 'STANDBY';
}
