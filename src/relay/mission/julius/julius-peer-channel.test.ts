import { describe, expect, it } from 'vitest';

import {
  JULIUS_ONLY_OUTCOMES, JULIUS_PEER_REQUEST_KINDS, JULIUS_PEER_REQUEST_RULES, JULIUS_PEER_REQUEST_STATUSES,
  foldJuliusPeerRequests, guardJuliusPeerResponse, juliusGuidanceIsAuthoritative, juliusPeerIdsThatFit,
  juliusPeerRequestId, juliusPeerRequestOpenedFacts, juliusPeerRequestTransitionFacts, juliusResearchContinuationIds,
  openJuliusPeerRequest, projectJuliusArchitectState, projectJuliusGuidanceState, projectJuliusReviewerState,
  transitionJuliusPeerRequest,
  type JuliusPeerRequest,
} from './julius-peer-channel';
import { validateJuliusEvent } from './julius-events';

/**
 * THE PEER CHANNEL'S RULES, held without a runtime.
 *
 * What a request is, who may address whom, which moves are legal, what a peer
 * may never write, and what each peer is doing — every one a pure function of
 * rows, so each is proven here directly and again through the pipeline in
 * `julius-peer-channel.e2e.test.ts`.
 */

const BASE = {
  missionId: 'msn-1', runId: 'run-1', projectId: 'prj-1', executionScope: 'gh-34995797200.1',
  reason: 'A worker paused its unit of work and asked the Prompt Architect for guidance.',
  createdAt: '2026-09-15T12:00:00.000Z',
} as const;

const question = (over: Partial<Parameters<typeof openJuliusPeerRequest>[0]> = {}) => openJuliusPeerRequest({
  ...BASE,
  kind: 'GUIDANCE_QUESTION', anchor: 'guidance:build-1:1:task',
  sourceRole: 'CODING_AGENT', targetRole: 'PROMPT_ARCHITECT',
  subjectTaskId: 'build-1', carrierTaskId: 'guidance:build-1:1:task',
  mandatory: true, pausedTaskIds: ['segment:build-1:2:task'],
  ...over,
});

const opened = (outcome: ReturnType<typeof openJuliusPeerRequest>): JuliusPeerRequest => {
  if (outcome.outcome !== 'OPENED') throw new Error(`expected OPENED, got ${outcome.reasonCode}`);
  return outcome.request;
};

describe('a request is typed, directed and bound', () => {
  it('opens with every field the ledger needs, and its id is scoped to the execution attempt', () => {
    const request = opened(question({ checkpointId: 'checkpoint:build-1:1', contractBindingDigest: `sha256:${'a'.repeat(64)}` }));
    expect(request).toMatchObject({
      requestId: 'peer:guidance_question:gh-34995797200.1:guidance:build-1:1:task',
      kind: 'GUIDANCE_QUESTION', sourceRole: 'CODING_AGENT', targetRole: 'PROMPT_ARCHITECT',
      requiredResponseType: 'GUIDANCE_PACKET', status: 'OPEN', mandatory: true,
      pausedTaskIds: ['segment:build-1:2:task'], pausedTaskCount: 1, resolvedAt: null, responseRef: null,
    });
  });

  it('the closed vocabularies are exactly the ones the founder named', () => {
    expect(JULIUS_PEER_REQUEST_KINDS).toEqual([
      'GUIDANCE_QUESTION', 'REVIEW_REQUEST', 'CHALLENGE', 'EVIDENCE_CHALLENGE', 'REBUTTAL_REQUEST', 'REPLAN_PROPOSAL', 'CLARIFICATION',
    ]);
    expect(JULIUS_PEER_REQUEST_STATUSES).toEqual(['OPEN', 'ANSWERED', 'REFUSED', 'SUPERSEDED', 'RESOLVED']);
  });

  it.each([
    ['Coding Agent → Architect', 'GUIDANCE_QUESTION', 'CODING_AGENT', 'PROMPT_ARCHITECT', null],
    ['Julius → Reviewer', 'REVIEW_REQUEST', 'JULIUS', 'INDEPENDENT_REVIEWER', null],
    ['Reviewer → Julius', 'CHALLENGE', 'INDEPENDENT_REVIEWER', 'JULIUS', null],
    ['Reviewer → Architect, through Julius', 'EVIDENCE_CHALLENGE', 'INDEPENDENT_REVIEWER', 'JULIUS', 'PROMPT_ARCHITECT'],
    ['Architect → Julius', 'REPLAN_PROPOSAL', 'PROMPT_ARCHITECT', 'JULIUS', null],
    ['Julius → Architect', 'REBUTTAL_REQUEST', 'JULIUS', 'PROMPT_ARCHITECT', null],
    ['Julius → Architect (clarify)', 'CLARIFICATION', 'JULIUS', 'PROMPT_ARCHITECT', null],
    ['Julius → Reviewer (clarify)', 'CLARIFICATION', 'JULIUS', 'INDEPENDENT_REVIEWER', null],
  ])('permits %s', (_label, kind, sourceRole, targetRole, mediatedFor) => {
    const outcome = question({ kind, sourceRole, targetRole, mediatedFor, evidenceIds: ['evidence:1'] });
    expect(outcome.outcome).toBe('OPENED');
  });

  it.each([
    ['a reviewer questioning the architect directly', 'GUIDANCE_QUESTION', 'INDEPENDENT_REVIEWER', 'PROMPT_ARCHITECT', null],
    ['a reviewer challenging the architect without Julius', 'EVIDENCE_CHALLENGE', 'INDEPENDENT_REVIEWER', 'PROMPT_ARCHITECT', null],
    ['the architect reviewing', 'REVIEW_REQUEST', 'PROMPT_ARCHITECT', 'INDEPENDENT_REVIEWER', null],
    ['the coder asking for a review', 'REVIEW_REQUEST', 'CODING_AGENT', 'INDEPENDENT_REVIEWER', null],
    ['the coder challenging', 'CHALLENGE', 'CODING_AGENT', 'JULIUS', null],
    ['a peer asking for a rebuttal', 'REBUTTAL_REQUEST', 'INDEPENDENT_REVIEWER', 'PROMPT_ARCHITECT', null],
    ['the reviewer proposing a replan', 'REPLAN_PROPOSAL', 'INDEPENDENT_REVIEWER', 'JULIUS', null],
    ['Julius asking the coder to clarify', 'CLARIFICATION', 'JULIUS', 'CODING_AGENT', null],
  ])('refuses %s', (_label, kind, sourceRole, targetRole, mediatedFor) => {
    const outcome = question({ kind, sourceRole, targetRole, mediatedFor, evidenceIds: ['evidence:1'] });
    expect(outcome).toEqual({ outcome: 'REFUSED', reasonCode: 'peer_request_direction_refused' });
  });

  it('refuses a worker addressing itself, an unknown party, and a mediation the kind does not have', () => {
    expect(question({ sourceRole: 'PROMPT_ARCHITECT', targetRole: 'PROMPT_ARCHITECT' }))
      .toEqual({ outcome: 'REFUSED', reasonCode: 'peer_request_addresses_itself' });
    expect(question({ sourceRole: 'SPECIALIST:db' })).toEqual({ outcome: 'REFUSED', reasonCode: 'peer_request_party_unknown' });
    expect(question({ mediatedFor: 'JULIUS' })).toEqual({ outcome: 'REFUSED', reasonCode: 'peer_request_mediation_refused' });
    expect(question({ kind: 'EVIDENCE_CHALLENGE', sourceRole: 'INDEPENDENT_REVIEWER', targetRole: 'JULIUS', evidenceIds: ['e'] }))
      .toEqual({ outcome: 'REFUSED', reasonCode: 'peer_request_mediation_required' });
  });

  it('a challenge accuses, and an accusation cites evidence', () => {
    expect(question({ kind: 'CHALLENGE', sourceRole: 'INDEPENDENT_REVIEWER', targetRole: 'JULIUS' }))
      .toEqual({ outcome: 'REFUSED', reasonCode: 'peer_challenge_requires_evidence' });
  });

  it('a pause needs a carrier, and only a mandatory request pauses anything', () => {
    expect(question({ carrierTaskId: null })).toEqual({ outcome: 'REFUSED', reasonCode: 'peer_request_mandatory_requires_carrier' });
    expect(question({ mandatory: false })).toEqual({ outcome: 'REFUSED', reasonCode: 'peer_request_pause_requires_mandatory' });
    expect(question({ pausedTaskIds: ['a'], pausedTaskCount: 0 })).toEqual({ outcome: 'REFUSED', reasonCode: 'peer_request_paused_tasks_invalid' });
  });

  it('refuses an unsafe reason, a malformed binding and an oversized list rather than writing them', () => {
    expect(question({ reason: 'token: abc' }).outcome).toBe('REFUSED');
    expect(question({ reason: 'x'.repeat(281) }).outcome).toBe('REFUSED');
    expect(question({ contractBindingDigest: 'sha256:nope' })).toEqual({ outcome: 'REFUSED', reasonCode: 'peer_request_binding_invalid' });
    expect(question({ contextRefs: Array.from({ length: 17 }, (_, index) => `ref:${index}`) }).outcome).toBe('REFUSED');
    expect(question({ contextRefs: [`ref:${'r'.repeat(600)}`, `ref:${'s'.repeat(500)}`] }).outcome).toBe('REFUSED');
    expect(question({ executionScope: 's'.repeat(65) })).toEqual({ outcome: 'REFUSED', reasonCode: 'peer_request_scope_invalid' });
  });

  it('two workflow attempts of one run never share a request id; one attempt always does', () => {
    const attempt4 = opened(question({ executionScope: 'gh-34774471909.1' }));
    const attempt5 = opened(question({ executionScope: 'gh-34995797200.1' }));
    expect(attempt4.runId).toBe(attempt5.runId);
    expect(attempt4.requestId).not.toBe(attempt5.requestId);
    expect(opened(question({ executionScope: 'gh-34995797200.1' })).requestId).toBe(attempt5.requestId);
  });

  it('a long anchor is digested, never truncated, so two long anchors sharing a prefix stay distinct', () => {
    const long = `repair:segment:guidance:${'x'.repeat(300)}`;
    const a = juliusPeerRequestId({ kind: 'REVIEW_REQUEST', executionScope: 'local', anchor: `${long}:1:task` });
    const b = juliusPeerRequestId({ kind: 'REVIEW_REQUEST', executionScope: 'local', anchor: `${long}:2:task` });
    expect(a.length).toBeLessThanOrEqual(200);
    expect(a).not.toBe(b);
  });

  it('the widest legal request still fits the ledger row', () => {
    const wide = opened(question({
      subjectTaskId: `s:${'s'.repeat(500)}`, carrierTaskId: `c:${'c'.repeat(500)}`, checkpointId: `k:${'k'.repeat(500)}`,
      reason: 'r'.repeat(280), contractBindingDigest: `sha256:${'b'.repeat(64)}`,
      contextRefs: juliusPeerIdsThatFit(Array.from({ length: 40 }, (_, i) => `ref:${'q'.repeat(90)}:${i}`)).ids,
      pausedTaskIds: juliusPeerIdsThatFit(Array.from({ length: 40 }, (_, i) => `task:${'p'.repeat(90)}:${i}`)).ids,
      pausedTaskCount: 40,
    }));
    expect(() => validateJuliusEvent({
      eventId: 'e', runId: 'run-1', projectId: 'prj-1', type: 'peer.request.opened', taskId: null, workerId: null,
      correlationId: 'c', causationId: null, occurredAt: BASE.createdAt, facts: { ...juliusPeerRequestOpenedFacts(wide), owner: 'o' },
    })).not.toThrow();
  });
});

describe('a request only moves along legal edges', () => {
  const request = opened(question());

  it('OPEN → ANSWERED → RESOLVED, with what answered and how it closed', () => {
    const answered = transitionJuliusPeerRequest(request, { to: 'ANSWERED', at: 't1', responseRef: 'guidance:build-1:1' });
    expect(answered.outcome).toBe('TRANSITIONED');
    if (answered.outcome !== 'TRANSITIONED') return;
    expect(answered.request.resolvedAt).toBeNull();
    const resolved = transitionJuliusPeerRequest(answered.request, { to: 'RESOLVED', at: 't2', transitionCode: 'ANSWER_ACCEPTED' });
    expect(resolved).toMatchObject({ outcome: 'TRANSITIONED', request: { status: 'RESOLVED', resolvedAt: 't2', responseRef: 'guidance:build-1:1', transitionCode: 'ANSWER_ACCEPTED' } });
  });

  it('a rejected answer reopens the request and keeps the answer it rejected on the record', () => {
    const answered = transitionJuliusPeerRequest(request, { to: 'ANSWERED', at: 't1', responseRef: 'guidance:build-1:1' });
    if (answered.outcome !== 'TRANSITIONED') throw new Error('unreachable');
    const reopened = transitionJuliusPeerRequest(answered.request, { to: 'OPEN', at: 't2', transitionCode: 'ANSWER_REJECTED' });
    expect(reopened).toMatchObject({ outcome: 'TRANSITIONED', request: { status: 'OPEN', responseRef: 'guidance:build-1:1', resolvedAt: null } });
  });

  it('refuses a repeated move, a move out of a terminal state, an answer naming nothing, and a closure naming no reason', () => {
    expect(transitionJuliusPeerRequest(request, { to: 'OPEN', at: 't', transitionCode: 'X' }))
      .toEqual({ outcome: 'REFUSED', reasonCode: 'peer_request_transition_repeated' });
    const resolved = transitionJuliusPeerRequest(request, { to: 'RESOLVED', at: 't', transitionCode: 'NOT_NEEDED' });
    if (resolved.outcome !== 'TRANSITIONED') throw new Error('unreachable');
    for (const to of ['OPEN', 'ANSWERED', 'REFUSED', 'SUPERSEDED']) {
      expect(transitionJuliusPeerRequest(resolved.request, { to, at: 't', responseRef: 'r', transitionCode: 'X' }))
        .toEqual({ outcome: 'REFUSED', reasonCode: 'peer_request_transition_illegal' });
    }
    expect(transitionJuliusPeerRequest(request, { to: 'ANSWERED', at: 't' }))
      .toEqual({ outcome: 'REFUSED', reasonCode: 'peer_request_answer_requires_ref' });
    expect(transitionJuliusPeerRequest(request, { to: 'REFUSED', at: 't' }))
      .toEqual({ outcome: 'REFUSED', reasonCode: 'peer_request_transition_requires_code' });
  });
});

describe('the state of every request is a fold over the ledger', () => {
  const request = opened(question());
  const open = { type: 'peer.request.opened', facts: juliusPeerRequestOpenedFacts(request) };
  const move = (to: string, extra: Record<string, string> = {}) => ({
    type: 'peer.request.transitioned',
    facts: juliusPeerRequestTransitionFacts({ requestId: request.requestId, to: to as never, at: 't', ...extra }),
  });

  it('rebuilds the request exactly as it was opened', () => {
    const [rebuilt] = foldJuliusPeerRequests([open]);
    const { runId: _r, projectId: _p, ...expected } = request;
    expect(rebuilt).toMatchObject(expected);
  });

  it('is idempotent over a replayed open and a replayed move, and ignores an illegal or orphaned move', () => {
    const rows = [
      open, open,
      move('ANSWERED', { responseRef: 'guidance:build-1:1' }), move('ANSWERED', { responseRef: 'guidance:build-1:1' }),
      move('RESOLVED', { transitionCode: 'ANSWER_ACCEPTED' }),
      move('OPEN', { transitionCode: 'LATE' }),
      { type: 'peer.request.transitioned', facts: juliusPeerRequestTransitionFacts({ requestId: 'peer:never-opened', to: 'RESOLVED', at: 't', transitionCode: 'X' }) },
    ];
    const folded = foldJuliusPeerRequests(rows);
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ status: 'RESOLVED', transitionCode: 'ANSWER_ACCEPTED', responseRef: 'guidance:build-1:1' });
  });

  it('survives a round trip through JSON, as an evidence bundle carries it', () => {
    const rows = [open, move('ANSWERED', { responseRef: 'guidance:build-1:1' })];
    expect(foldJuliusPeerRequests(JSON.parse(JSON.stringify(rows)))).toEqual(foldJuliusPeerRequests(rows));
  });
});

describe('a peer may propose; it may never decide', () => {
  it.each([
    ['the objective', { objective: 'something else' }],
    ['the acceptance criteria, in any spelling', { acceptance_criteria: [] }],
    ['the criteria, nested', { advice: { blockingAcceptanceCriteria: [] } }],
    ['the budget', { Budget: { spendUsd: 50 } }],
    ['the spend', { spend_usd: 50 }],
    ['the permissions', { permissions: ['write:*'] }],
    ['the security boundary', { securityBoundary: 'none' }],
    ['the network', { network: 'host' }],
    ['provider authority', { allowedProviders: ['x'] }],
    ['contract ownership', { contractOwner: 'PROMPT_ARCHITECT' }],
    ['the scope', { items: [{ inScope: ['everything'] }] }],
  ])('refuses a response that reaches for %s', (_label, value) => {
    expect(guardJuliusPeerResponse(value)).toMatchObject({ ok: false, reasonCode: 'peer_response_mutates_protected_term' });
  });

  it.each(JULIUS_ONLY_OUTCOMES.map((outcome) => [outcome]))('refuses a peer minting %s', (outcome) => {
    expect(guardJuliusPeerResponse({ verdict: outcome })).toMatchObject({ ok: false, reasonCode: 'peer_response_mints_julius_only_outcome' });
    expect(guardJuliusPeerResponse({ findings: [{ status: outcome.toLowerCase() }] }))
      .toMatchObject({ ok: false, reasonCode: 'peer_response_mints_julius_only_outcome' });
  });

  it('lets the reviewer\'s own verdicts and ordinary advice through', () => {
    for (const verdict of ['CONTINUE', 'WARNING', 'CHALLENGE', 'REPAIR_REQUIRED', 'BLOCK']) {
      expect(guardJuliusPeerResponse({ verdict, category: 'CONTRACT_MISMATCH' })).toEqual({ ok: true });
    }
    expect(guardJuliusPeerResponse({ recommendedActions: ['verify the build'], relevantConstraints: ['no new dependency'] })).toEqual({ ok: true });
    // A word in prose is not a decision.
    expect(guardJuliusPeerResponse({ summary: 'Once VERIFIED by Julius the change ships.' })).toEqual({ ok: true });
  });

  it('refuses an output too deep to read rather than checking part of it', () => {
    let deep: unknown = { leaf: true };
    for (let index = 0; index < 20; index += 1) deep = { child: deep };
    expect(guardJuliusPeerResponse(deep)).toMatchObject({ ok: false, reasonCode: 'peer_response_unreadable' });
  });
});

describe('guidance is authoritative only once Julius accepts it', () => {
  it.each([
    ['RUNNABLE', [], 'PROPOSED'],
    ['SUCCEEDED', [], 'UNDER_REVIEW'],
    ['SUCCEEDED', ['ACCEPT'], 'ACCEPTED'],
    ['SUCCEEDED', ['REPAIR'], 'REJECTED'],
    ['SUCCEEDED', ['HALT'], 'REJECTED'],
    ['FAILED', [], 'REJECTED'],
  ])('a %s guidance task with decisions %j is %s', (state, actions, expected) => {
    const projected = projectJuliusGuidanceState({
      guidanceTask: { taskId: 'guidance:build-1:1:task', state: state as never },
      decisionsForTask: (actions as string[]).map((action) => ({ action })),
    });
    expect(projected).toBe(expected);
    expect(juliusGuidanceIsAuthoritative(projected)).toBe(expected === 'ACCEPTED');
  });
});

describe('what each peer is doing is derived, never stored', () => {
  const t = (taskId: string, taskType: string, role: string, state = 'RUNNABLE') =>
    ({ taskId, taskType, role: role as never, state: state as never, parentTaskId: null });
  const none = { requests: [], researchContinuationTaskIds: [] };

  it('the architect', () => {
    expect(projectJuliusArchitectState({ ...none, tasks: [] })).toBe('STANDBY');
    expect(projectJuliusArchitectState({ ...none, tasks: [t('plan-1', 'plan', 'PROMPT_ARCHITECT')] })).toBe('PLANNING');
    expect(projectJuliusArchitectState({ ...none, tasks: [t('repair:plan-1:1:task', 'repair:plan', 'PROMPT_ARCHITECT')] })).toBe('REPLANNING');
    expect(projectJuliusArchitectState({ ...none, tasks: [t('guidance:b:1:task', 'guidance', 'PROMPT_ARCHITECT', 'ACTIVE')] })).toBe('GUIDING');
    expect(projectJuliusArchitectState({ ...none, tasks: [t('guidance:b:1:task', 'guidance', 'PROMPT_ARCHITECT', 'SUCCEEDED')] })).toBe('STANDBY');
    // An answer is still owed even when no task is carrying it right now — a
    // rejected packet whose repair has not been minted — and the architect is
    // the one who owes it.
    expect(projectJuliusArchitectState({
      ...none, tasks: [t('guidance:b:1:task', 'guidance', 'PROMPT_ARCHITECT', 'SUCCEEDED')], requests: [opened(question())],
    })).toBe('GUIDING');
    expect(projectJuliusArchitectState({
      tasks: [t('segment:guidance:b:1:task:2:task', 'guidance', 'PROMPT_ARCHITECT')], requests: [],
      researchContinuationTaskIds: ['segment:guidance:b:1:task:2:task'],
    })).toBe('RESEARCHING');
    const rebuttal = opened(openJuliusPeerRequest({
      ...BASE, kind: 'REBUTTAL_REQUEST', anchor: 'disagreement:1', sourceRole: 'JULIUS', targetRole: 'PROMPT_ARCHITECT',
      subjectTaskId: 'plan-1', reason: 'Defend the plan against the reviewer challenge.',
    }));
    expect(projectJuliusArchitectState({ ...none, tasks: [], requests: [rebuttal] })).toBe('CHECKING_ALIGNMENT');
    const answered = transitionJuliusPeerRequest(rebuttal, { to: 'ANSWERED', at: 't', responseRef: 'rebuttal:1' });
    if (answered.outcome !== 'TRANSITIONED') throw new Error('unreachable');
    expect(projectJuliusArchitectState({ ...none, tasks: [], requests: [answered.request] })).toBe('WAITING_ON_EVIDENCE');
  });

  it('the reviewer', () => {
    expect(projectJuliusReviewerState({ ...none, tasks: [] })).toBe('STANDBY');
    expect(projectJuliusReviewerState({ ...none, tasks: [t('build-1', 'build', 'CODING_AGENT', 'ACTIVE')] })).toBe('OBSERVING');
    expect(projectJuliusReviewerState({ ...none, tasks: [t('build-1:review', 'review:build', 'INDEPENDENT_REVIEWER')] })).toBe('REVIEWING');
    expect(projectJuliusReviewerState({ ...none, tasks: [t('repair:build-1:1:task:review', 'review:repair:build', 'INDEPENDENT_REVIEWER')] })).toBe('REVIEWING_REPAIR');
    expect(projectJuliusReviewerState({ ...none, tasks: [t('repair:build-1:1:task', 'repair:build', 'CODING_AGENT')] })).toBe('WAITING_ON_REPAIR');
    expect(projectJuliusReviewerState({ ...none, tasks: [t('mission:final:review', 'review:mission', 'INDEPENDENT_REVIEWER')] })).toBe('FINAL_REVIEW');
    expect(projectJuliusReviewerState({
      tasks: [t('segment:build-1:review:2:task', 'review:build', 'INDEPENDENT_REVIEWER')], requests: [],
      researchContinuationTaskIds: ['segment:build-1:review:2:task'],
    })).toBe('RESEARCHING');
    const challenge = opened(openJuliusPeerRequest({
      ...BASE, kind: 'CHALLENGE', anchor: 'challenge:1', sourceRole: 'INDEPENDENT_REVIEWER', targetRole: 'JULIUS',
      subjectTaskId: 'plan-1', reason: 'The plan contradicts the contract.', evidenceIds: ['evidence:7'],
    }));
    expect(projectJuliusReviewerState({ ...none, tasks: [], requests: [challenge] })).toBe('CHALLENGING');
  });

  it('names research continuations from the verdict rows that created them, never from an id shape', () => {
    expect(juliusResearchContinuationIds([
      { type: 'checkpoint.verdict', facts: { route: 'SERVE_RESEARCH', continuationTaskId: 'segment:build-1:2:task' } },
      { type: 'checkpoint.verdict', facts: { route: 'REQUEST_GUIDANCE', continuationTaskId: 'segment:build-1:3:task' } },
      { type: 'checkpoint.verdict', facts: { route: 'SERVE_RESEARCH', continuationTaskId: null } },
    ])).toEqual(['segment:build-1:2:task']);
  });
});

describe('the rule table and the response each kind owes', () => {
  it('every kind owes exactly one response type', () => {
    expect(Object.fromEntries(Object.entries(JULIUS_PEER_REQUEST_RULES).map(([kind, rule]) => [kind, rule.response]))).toEqual({
      GUIDANCE_QUESTION: 'GUIDANCE_PACKET', REVIEW_REQUEST: 'REVIEW_VERDICT', CHALLENGE: 'DISAGREEMENT_RESOLUTION',
      EVIDENCE_CHALLENGE: 'DISAGREEMENT_RESOLUTION', REBUTTAL_REQUEST: 'REBUTTAL', REPLAN_PROPOSAL: 'REPLAN_DECISION',
      CLARIFICATION: 'CLARIFICATION_ANSWER',
    });
  });

  it('no rule lets a peer address another peer directly', () => {
    const peers = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'];
    const direct = Object.entries(JULIUS_PEER_REQUEST_RULES)
      .filter(([kind]) => kind !== 'GUIDANCE_QUESTION')
      .filter(([, rule]) => rule.sources.some((source) => peers.includes(source)) && rule.targets.some((target) => peers.includes(target)));
    // The coder's question to the architect is the one sanctioned direct line.
    expect(direct).toEqual([]);
  });
});
