import { describe, expect, it } from 'vitest';

import {
  appendBrainRecord,
  brainFactsOf,
  brainSha256,
  canonicalBrainJson,
  projectBrainLedger,
  verifyBrainLedger,
  type BrainRecord,
  type BrainRecordDraft,
} from './brain-ledger';

/**
 * The ledger is where "Project Brain owns truth" either holds or does not, so
 * these are about authority, replay and tamper-evidence rather than storage.
 */

const SCOPE = 'attempt:run:julius-live-9/build-1/2';
const RECORDED_AT = '2026-09-22T10:00:00.000Z';

const draft = (patch: Partial<BrainRecordDraft> = {}): BrainRecordDraft => ({
  domain: 'MISSION_DECISION', kind: 'DECISION', scope: SCOPE, projectId: 'prj-1', missionId: 'mission:1',
  author: 'JULIUS', authorId: 'julius', payload: { statement: 'accept the plan', reasonCode: 'TASK_VERIFIED' },
  evidenceIds: ['evidence:1'], occurredAt: '2026-09-22T09:59:00.000Z', idempotencyKey: 'decision:build-1:accept',
  ...patch,
});

/** Append a list of drafts, as a store would, and hand back the ledger. */
function ledgerOf(drafts: readonly BrainRecordDraft[]): BrainRecord[] {
  const ledger: BrainRecord[] = [];
  drafts.forEach((item, index) => {
    const result = appendBrainRecord({ ledger, draft: item, recordedAt: RECORDED_AT, recordId: `rec-${index + 1}` });
    if (result.outcome !== 'APPENDED') throw new Error(`${result.outcome}: ${'detail' in result ? result.detail : ''}`);
    ledger.push(result.record);
  });
  return ledger;
}

describe('the Brain ledger', () => {
  it('records what an author states as a FACT, and what a proposer states as a PROPOSAL', () => {
    const fact = appendBrainRecord({ ledger: [], draft: draft(), recordedAt: RECORDED_AT, recordId: 'rec-1' });
    expect(fact).toMatchObject({ outcome: 'APPENDED', record: { status: 'FACT', sequence: 1, previousHash: null, author: 'JULIUS' } });

    // The reviewer may propose a decision; it does not get to make one.
    const proposal = appendBrainRecord({
      ledger: [], recordedAt: RECORDED_AT, recordId: 'rec-2',
      draft: draft({ author: 'INDEPENDENT_REVIEWER', authorId: 'reviewer-1', idempotencyKey: 'decision:build-1:propose' }),
    });
    expect(proposal).toMatchObject({ outcome: 'APPENDED', record: { status: 'PROPOSAL' } });
    // ...and authors its own findings outright.
    expect(appendBrainRecord({
      ledger: [], recordedAt: RECORDED_AT, recordId: 'rec-3',
      draft: draft({ domain: 'REVIEW_FINDING', kind: 'FINDING', author: 'INDEPENDENT_REVIEWER', authorId: 'reviewer-1', idempotencyKey: 'finding:1' }),
    })).toMatchObject({ outcome: 'APPENDED', record: { status: 'FACT' } });
  });

  it('refuses a system that owns neither the domain nor a proposal in it, and says who does', () => {
    const rendered = appendBrainRecord({ ledger: [], recordedAt: RECORDED_AT, recordId: 'rec-1', draft: draft({ author: 'WONDERLAND', authorId: 'wonderland' }) });
    expect(rendered).toMatchObject({ outcome: 'REFUSED', reasonCode: 'not_an_author', detail: 'WONDERLAND may not write MISSION_DECISION; JULIUS authors it' });

    // Agent lifecycle takes no proposals at all: only Julius states that an agent existed.
    for (const author of ['WONDERLAND', 'PYTHON', 'GVE', 'INDEPENDENT_REVIEWER'] as const) {
      expect(appendBrainRecord({ ledger: [], recordedAt: RECORDED_AT, recordId: 'rec-1', draft: draft({ domain: 'AGENT_LIFECYCLE', kind: 'SUB_AGENT', author, authorId: 'x' }) }), author)
        .toMatchObject({ outcome: 'REFUSED', reasonCode: 'not_an_author' });
    }
    // Presentation is not durable, so nothing may be appended about it — not even by Wonderland.
    expect(appendBrainRecord({ ledger: [], recordedAt: RECORDED_AT, recordId: 'rec-1', draft: draft({ domain: 'PRESENTATION_STATE', kind: 'CUB_OPACITY', author: 'WONDERLAND', authorId: 'wonderland' }) }))
      .toMatchObject({ outcome: 'REFUSED', reasonCode: 'domain_not_durable' });
  });

  it('replaying a run appends nothing, and the same key with a different statement is refused', () => {
    const ledger = ledgerOf([draft()]);
    const replay = appendBrainRecord({ ledger, draft: draft(), recordedAt: '2026-09-22T11:00:00.000Z', recordId: 'rec-99' });
    expect(replay).toMatchObject({ outcome: 'DUPLICATE', record: { recordId: 'rec-1' } });
    expect(ledger).toHaveLength(1);

    const conflict = appendBrainRecord({ ledger, draft: draft({ payload: { statement: 'reject the plan', reasonCode: 'BLOCKING_FINDINGS' } }), recordedAt: RECORDED_AT, recordId: 'rec-2' });
    expect(conflict).toMatchObject({ outcome: 'REFUSED', reasonCode: 'idempotency_conflict' });
  });

  it('Unknown stays Unknown: a time nobody stated is null, and the moment of recording never stands in for it', () => {
    const ledger = ledgerOf([draft({ occurredAt: null, idempotencyKey: 'decision:untimed' })]);
    expect(ledger[0]).toMatchObject({ occurredAt: null, recordedAt: RECORDED_AT });
    expect(ledger[0]!.occurredAt).not.toBe(ledger[0]!.recordedAt);
    expect(appendBrainRecord({ ledger: [], recordedAt: RECORDED_AT, recordId: 'rec-1', draft: draft({ occurredAt: 'yesterday' }) }))
      .toMatchObject({ outcome: 'REFUSED', reasonCode: 'payload_invalid', detail: expect.stringContaining('occurredAt') });
  });

  it('truth changes by superseding, never by editing; only the author may supersede', () => {
    const first = ledgerOf([draft()]);
    const second = appendBrainRecord({
      ledger: first, recordedAt: RECORDED_AT, recordId: 'rec-2',
      draft: draft({ idempotencyKey: 'decision:build-1:revised', payload: { statement: 'repair first', reasonCode: 'BLOCKING_FINDINGS' }, supersedes: 'rec-1' }),
    });
    expect(second).toMatchObject({ outcome: 'APPENDED', record: { supersedes: 'rec-1', status: 'FACT' } });
    const ledger = [...first, (second as { record: BrainRecord }).record];

    // The older record is still there, and reads as superseded rather than deleted.
    const projected = projectBrainLedger(ledger);
    expect(projected.map((record) => record.status)).toEqual(['SUPERSEDED', 'FACT']);
    expect(brainFactsOf(ledger, 'MISSION_DECISION').map((record) => record.recordId)).toEqual(['rec-2']);
    expect(ledger).toHaveLength(2);

    // A proposer cannot supersede an author's fact, and nothing may supersede what is not there.
    expect(appendBrainRecord({ ledger, recordedAt: RECORDED_AT, recordId: 'rec-3', draft: draft({ author: 'INDEPENDENT_REVIEWER', authorId: 'reviewer-1', idempotencyKey: 'k3', supersedes: 'rec-2' }) }))
      .toMatchObject({ outcome: 'REFUSED', reasonCode: 'not_an_author' });
    expect(appendBrainRecord({ ledger, recordedAt: RECORDED_AT, recordId: 'rec-4', draft: draft({ idempotencyKey: 'k4', supersedes: 'rec-404' }) }))
      .toMatchObject({ outcome: 'REFUSED', reasonCode: 'supersedes_unknown' });
    expect(appendBrainRecord({ ledger, recordedAt: RECORDED_AT, recordId: 'rec-5', draft: draft({ domain: 'EVIDENCE', kind: 'EVIDENCE', idempotencyKey: 'k5', supersedes: 'rec-2' }) }))
      .toMatchObject({ outcome: 'REFUSED', reasonCode: 'supersedes_foreign' });
  });

  it('the chain shows an edit, a removal or a reorder', () => {
    const ledger = ledgerOf([draft(), draft({ idempotencyKey: 'k2', kind: 'RESEARCH', domain: 'EVIDENCE' }), draft({ idempotencyKey: 'k3' })]);
    expect(verifyBrainLedger(ledger)).toEqual({ ok: true, problems: [] });

    const edited = ledger.map((record) => (record.sequence === 2 ? { ...record, payload: { statement: 'something else' } } : record));
    expect(verifyBrainLedger(edited).problems[0]).toMatch(/rec-2: its content does not match its hash/);
    expect(verifyBrainLedger(ledger.filter((record) => record.sequence !== 2)).problems[0]).toMatch(/sequence 3, expected 2/);
    expect(verifyBrainLedger([ledger[0]!, ledger[2]!, ledger[1]!]).ok).toBe(false);
    // A record re-hashed after an edit still does not follow the one before it.
    const resealed = { ...edited[1]!, hash: brainSha256('anything') };
    expect(verifyBrainLedger([ledger[0]!, resealed, ledger[2]!]).ok).toBe(false);
  });

  it('a fact is stated, not serialised wholesale: scalars only, bounded, and scoped to a real attempt', () => {
    expect(appendBrainRecord({ ledger: [], recordedAt: RECORDED_AT, recordId: 'rec-1', draft: draft({ payload: { nested: { a: 1 } as never } }) }))
      .toMatchObject({ outcome: 'REFUSED', reasonCode: 'payload_invalid', detail: expect.stringContaining('payload.nested') });
    expect(appendBrainRecord({ ledger: [], recordedAt: RECORDED_AT, recordId: 'rec-1', draft: draft({ payload: { big: 'x'.repeat(9000) } }) }))
      .toMatchObject({ outcome: 'REFUSED', reasonCode: 'payload_invalid', detail: expect.stringContaining('at most 8192') });
    expect(appendBrainRecord({ ledger: [], recordedAt: RECORDED_AT, recordId: 'rec-1', draft: draft({ scope: 'workflow:349/5' }) }))
      .toMatchObject({ outcome: 'REFUSED', reasonCode: 'scope_invalid' });
    expect(appendBrainRecord({ ledger: [], recordedAt: RECORDED_AT, recordId: 'rec-1', draft: draft({ evidenceIds: ['e1', 'e1'] }) }))
      .toMatchObject({ outcome: 'REFUSED', reasonCode: 'payload_invalid', detail: expect.stringContaining('duplicate reference') });
    // Key order is not meaning: the same fact written two ways hashes the same.
    expect(canonicalBrainJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalBrainJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});
