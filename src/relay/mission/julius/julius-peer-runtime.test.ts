import { describe, expect, it } from 'vitest';

import { validateJuliusEvent, type JuliusOperationalEvent } from './julius-events';
import { createJuliusMemoryStore } from './julius-memory-store';
import { foldJuliusPeerRequests } from './julius-peer-channel';
import {
  moveJuliusPeerRequest, openJuliusPeerRequestOnLedger, readJuliusPeerLedger,
  type JuliusPeerRuntimeContext,
} from './julius-peer-runtime';

/**
 * THE CHANNEL'S RUNTIME RULES, DIRECTLY.
 *
 * The pipeline proofs exercise these through whole missions; some of the rules
 * only matter in windows a mission reaches by accident — a crash between a
 * decision and its announcement, a resumed verification re-reading an old
 * decision. They are held here on their own, against a real ledger.
 */

const RUN = { runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1' };

function ledger(over: { timeline?: boolean } = {}) {
  const store = createJuliusMemoryStore();
  store.seedRun({ ...RUN, state: 'READY', cardRevision: 'c', missionContractRevision: 1, projectBrainRevision: 0, version: 1 });
  let sequence = 0;
  const context: JuliusPeerRuntimeContext = {
    ...RUN,
    executionScope: 'gh-1.1',
    now: () => `2026-09-15T12:00:${String(sequence).padStart(2, '0')}.000Z`,
    ...(over.timeline === false ? {} : { timeline: store }),
    emit: async (type, input) => {
      sequence += 1;
      const event: JuliusOperationalEvent = {
        eventId: `event:${String(sequence)}`, runId: RUN.runId, projectId: RUN.projectId, type,
        taskId: input.taskId, workerId: input.workerId ?? null, correlationId: 'c', causationId: null,
        occurredAt: context.now(), facts: input.facts,
      };
      validateJuliusEvent(event);
      await store.appendEvent(event);
    },
  };
  const requests = async () => foldJuliusPeerRequests((await readJuliusPeerLedger(store, RUN))!);
  return { store, context, requests };
}

const QUESTION = {
  kind: 'GUIDANCE_QUESTION', anchor: 'guidance:build-1:1:task', sourceRole: 'CODING_AGENT', targetRole: 'PROMPT_ARCHITECT',
  reason: 'A worker asked the Prompt Architect for guidance.', subjectTaskId: 'build-1', carrierTaskId: 'guidance:build-1:1:task',
  mandatory: true, pausedTaskIds: ['segment:build-1:2:task'], announce: true,
} as const;
const move = { kind: 'GUIDANCE_QUESTION' as const, anchor: 'guidance:build-1:1:task', taskId: 'build-1', firstWrite: true };

describe('a move is written only when it is legal now, and once per cause', () => {
  it('a cause that already moved a request cannot move it again, even when the edge would be legal', async () => {
    const { context, requests } = ledger();
    await openJuliusPeerRequestOnLedger(context, QUESTION);
    expect((await moveJuliusPeerRequest(context, { ...move, to: 'ANSWERED', from: ['OPEN'], responseRef: 'guidance:build-1:1', causeRef: 'guidance:build-1:1' })).outcome).toBe('MOVED');
    // Julius rejects the first answer, and a corrected one arrives.
    expect((await moveJuliusPeerRequest(context, { ...move, to: 'OPEN', from: ['ANSWERED'], transitionCode: 'ANSWER_REJECTED', causeRef: 'guidance:build-1:1:task:REPAIR:BLOCKING_FINDINGS' })).outcome).toBe('MOVED');
    expect((await moveJuliusPeerRequest(context, { ...move, to: 'ANSWERED', from: ['OPEN'], responseRef: 'guidance:build-1:2', causeRef: 'guidance:build-1:2' })).outcome).toBe('MOVED');

    // A resumed verification re-reads the OLD rejection. ANSWERED -> OPEN is a
    // legal edge from where the request now is; the cause is what refuses it.
    const replay = await moveJuliusPeerRequest(context, { ...move, to: 'OPEN', from: ['ANSWERED'], transitionCode: 'ANSWER_REJECTED', causeRef: 'guidance:build-1:1:task:REPAIR:BLOCKING_FINDINGS' });
    expect(replay).toEqual({ outcome: 'NOT_MOVED', reasonCode: 'peer_request_cause_already_applied' });
    expect((await requests())[0]).toMatchObject({ status: 'ANSWERED', responseRef: 'guidance:build-1:2' });
  });

  it('a move from a state the caller did not expect, a repeated move, and a request never opened write nothing', async () => {
    const { context, store, requests } = ledger();
    await openJuliusPeerRequestOnLedger(context, QUESTION);
    const before = store.events().length;
    expect(await moveJuliusPeerRequest(context, { ...move, to: 'RESOLVED', from: ['ANSWERED'], transitionCode: 'X', causeRef: 'c1' }))
      .toEqual({ outcome: 'NOT_MOVED', reasonCode: 'peer_request_not_in_expected_state' });
    expect(await moveJuliusPeerRequest(context, { ...move, to: 'OPEN', transitionCode: 'X', causeRef: 'c2' }))
      .toEqual({ outcome: 'NOT_MOVED', reasonCode: 'peer_request_transition_repeated' });
    expect(await moveJuliusPeerRequest(context, { ...move, anchor: 'guidance:nobody:1:task', to: 'ANSWERED', responseRef: 'r', causeRef: 'c3' }))
      .toEqual({ outcome: 'NOT_MOVED', reasonCode: 'peer_request_unknown' });
    expect(store.events()).toHaveLength(before);
    expect((await requests())[0]!.status).toBe('OPEN');
  });

  it('without a readable ledger, only the first write of the causing fact moves anything', async () => {
    const { context, store } = ledger({ timeline: false });
    await openJuliusPeerRequestOnLedger(context, QUESTION);
    expect(await moveJuliusPeerRequest(context, { ...move, to: 'ANSWERED', responseRef: 'r', causeRef: 'c', firstWrite: false }))
      .toEqual({ outcome: 'NOT_MOVED', reasonCode: 'peer_ledger_unreadable_replay' });
    expect((await moveJuliusPeerRequest(context, { ...move, to: 'ANSWERED', responseRef: 'r', causeRef: 'c', firstWrite: true })).outcome).toBe('MOVED');
    expect(store.events().filter((event) => event.type === 'peer.request.transitioned')).toHaveLength(1);
  });

  it('a request the channel will not open is written as a refusal, never as a request', async () => {
    const { context, store, requests } = ledger();
    const refused = await openJuliusPeerRequestOnLedger(context, { ...QUESTION, sourceRole: 'INDEPENDENT_REVIEWER' });
    expect(refused).toEqual({ outcome: 'REFUSED', reasonCode: 'peer_request_direction_refused' });
    expect(store.events().map((event) => [event.type, event.facts.reasonCode])).toEqual([['peer.request.refused', 'peer_request_direction_refused']]);
    expect(await requests()).toEqual([]);
    // Validation alone writes nothing.
    await openJuliusPeerRequestOnLedger(context, { ...QUESTION, announce: false });
    expect(store.events()).toHaveLength(1);
  });
});
