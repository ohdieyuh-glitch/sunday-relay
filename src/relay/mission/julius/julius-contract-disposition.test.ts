import { describe, expect, it } from 'vitest';
import {
  JULIUS_CONTRACT_DISPOSITIONS,
  juliusContractDisposition,
  juliusContractDispositionFacts,
} from './julius-contract-disposition';

/**
 * SILENCE IS NOT A DISPOSITION.
 *
 * Live Run 3 reached VERIFIED COMPLETION and the word "challenge" appears
 * nowhere in its evidence bundle: no `contract.challenged` event — correct,
 * nothing was challenged — and no record saying so either. "The evaluator
 * examined the terms and had no objection" and "the challenge leg never ran"
 * are opposite conclusions about a paid run, and the bundle could not tell them
 * apart.
 */
const base = {
  contractTaskId: 'build-1',
  contractId: 'contract:build-1',
  contractRevision: 2,
  evaluatorId: 'independent-reviewer-hermes',
};

describe('the evaluator says what it decided, either way', () => {
  it('records NO_CHALLENGE as a fact with a reason, not as an absence', () => {
    const outcome = juliusContractDisposition({ ...base, disposition: 'NO_CHALLENGE', reasonCode: 'TASK_VERIFIED' });
    expect(outcome.outcome).toBe('RECORDED');
    if (outcome.outcome !== 'RECORDED') return;
    expect(outcome.record).toMatchObject({
      disposition: 'NO_CHALLENGE', reasonCode: 'TASK_VERIFIED',
      evaluatorId: 'independent-reviewer-hermes', contractRevision: 2, evidenceCount: 0,
    });
    expect(outcome.record.evidenceIds).toEqual([]);
  });

  it('records CHALLENGE with the finding ids it points at', () => {
    const outcome = juliusContractDisposition({
      ...base, disposition: 'CHALLENGE', reasonCode: 'REVIEW_BLOCKING_FINDINGS',
      evidenceIds: ['finding-1', 'finding-2'],
    });
    expect(outcome.outcome).toBe('RECORDED');
    if (outcome.outcome !== 'RECORDED') return;
    expect(outcome.record.evidenceIds).toEqual(['finding-1', 'finding-2']);
    expect(outcome.record.evidenceCount).toBe(2);
  });

  /**
   * THE RULE THE FIRST DRAFT GOT WRONG. `challengeJuliusTaskContract` refuses a
   * challenge with no objections, and that is right for a contract GATE, which
   * needs something concrete to revise against. But Julius admits a repair round
   * on the subject's own FAILED evidence as well as on a reviewer finding
   * (`verifyTask` → EVIDENCE_FAILED), and such a round has NO findings by
   * construction. Refusing its disposition would restore the exact silence this
   * record exists to end, on the runs most in need of explaining.
   */
  it('records a CHALLENGE grounded in failed evidence rather than in findings', () => {
    const outcome = juliusContractDisposition({
      ...base, disposition: 'CHALLENGE', reasonCode: 'EVIDENCE_FAILED', evidenceIds: [],
    });
    expect(outcome.outcome, 'a repair round on failed evidence has no findings to cite').toBe('RECORDED');
    if (outcome.outcome !== 'RECORDED') return;
    expect(outcome.record.disposition).toBe('CHALLENGE');
    expect(outcome.record.evidenceCount).toBe(0);
  });

  /** An evaluator that has no objection and names its objections has not decided. */
  it('refuses NO_CHALLENGE that cites objections', () => {
    const outcome = juliusContractDisposition({
      ...base, disposition: 'NO_CHALLENGE', reasonCode: 'TASK_VERIFIED', evidenceIds: ['finding-1'],
    });
    expect(outcome).toEqual({ outcome: 'REFUSED', reasonCode: 'no_challenge_cannot_cite_objections' });
  });

  it('refuses a disposition nobody can stand behind', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ disposition: 'MAYBE' }, 'disposition_unknown'],
      [{ evaluatorId: '  ' }, 'evaluator_required'],
      [{ contractId: '' }, 'contract_identity_required'],
      [{ contractRevision: 0 }, 'contract_revision_invalid'],
      [{ contractRevision: 1.5 }, 'contract_revision_invalid'],
    ];
    for (const [override, reasonCode] of cases) {
      expect(juliusContractDisposition({
        ...base, disposition: 'NO_CHALLENGE', reasonCode: 'TASK_VERIFIED', ...override,
      } as never)).toEqual({ outcome: 'REFUSED', reasonCode });
    }
  });

  /**
   * A REASON THAT DID NOT SURVIVE NARROWING IS NOT A REASON. Writing the row
   * anyway would publish "the evaluator decided, for reasons unavailable" —
   * the shape this record exists to end. The prose and credential cases are
   * here because a reason code is the one field a provider's text could reach.
   */
  it('refuses a reason code that is prose, punctuation or credential-shaped', () => {
    for (const reasonCode of [
      'the plan was fine, mostly',
      'Authorization: Bearer FAKESECRET123456789',
      'https://example.invalid/why',
      '',
      '1_leading_digit',
    ]) {
      expect(juliusContractDisposition({ ...base, disposition: 'NO_CHALLENGE', reasonCode }),
        `${reasonCode} is not a reason code`).toEqual({ outcome: 'REFUSED', reasonCode: 'reason_code_invalid' });
    }
    // Both conventions this runtime really writes are accepted.
    for (const reasonCode of ['TASK_VERIFIED', 'repair_round_limit']) {
      expect(juliusContractDisposition({ ...base, disposition: 'NO_CHALLENGE', reasonCode }).outcome).toBe('RECORDED');
    }
  });

  it('offers exactly two dispositions', () => {
    expect([...JULIUS_CONTRACT_DISPOSITIONS]).toEqual(['CHALLENGE', 'NO_CHALLENGE']);
  });
});

describe('the disposition survives the durable write', () => {
  /**
   * FLAT SCALARS, BECAUSE THE RUNTIME'S `recordEvent` COERCES A NON-SCALAR WITH
   * `String(value)` — the defect that once reached a durable row as the literal
   * text `[object Object]`, taking every column with it.
   */
  it('flattens to scalars only', () => {
    const outcome = juliusContractDisposition({
      ...base, disposition: 'CHALLENGE', reasonCode: 'REVIEW_BLOCKING_FINDINGS', evidenceIds: ['f-1', 'f-2'],
    });
    if (outcome.outcome !== 'RECORDED') throw new Error('expected RECORDED');
    const facts = juliusContractDispositionFacts(outcome.record);
    for (const [key, value] of Object.entries(facts)) {
      expect(['string', 'number', 'boolean'].includes(typeof value) || value === null, `${key} is ${typeof value}`).toBe(true);
    }
    expect(facts.evidenceIds).toBe('f-1,f-2');
    expect(facts.evidenceCount).toBe(2);
    expect(facts.disposition).toBe('CHALLENGE');
  });

  /** A row is a record, not a transport for an unbounded list — and a truncated
   *  list must never read as a complete one, which is what the count is for. */
  it('bounds the id list and keeps the count exact', () => {
    const ids = Array.from({ length: 400 }, (_, i) => `finding-${String(i)}`);
    const outcome = juliusContractDisposition({
      ...base, disposition: 'CHALLENGE', reasonCode: 'REVIEW_BLOCKING_FINDINGS', evidenceIds: ids,
    });
    if (outcome.outcome !== 'RECORDED') throw new Error('expected RECORDED');
    const facts = juliusContractDispositionFacts(outcome.record);
    expect(String(facts.evidenceIds).length).toBeLessThanOrEqual(1_024);
    expect(String(facts.evidenceIds).endsWith('...')).toBe(true);
    expect(facts.evidenceCount, 'the count is of what there WAS, not of what fitted').toBe(400);
  });
});
