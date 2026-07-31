import { describe, expect, it } from 'vitest';

import {
  attachSourceAttestation,
  attachTraceVerification,
  createAdjustment,
  createCostReceipt,
  disputeReceipt,
  finalizeReceipt,
  markProvisional,
  voidReceipt,
  type CreateCostReceiptInput,
} from './cost-receipt-service';
import { InMemoryCostReceiptRepository } from './cost-receipt-repository';
import {
  ECON_T1,
  ECON_T2,
  ECON_T3,
  FIXTURE_MISSION,
  FIXTURE_PROJECT,
  FIXTURE_REVISION,
  receipt,
  secretShapedReceiptMetadata,
  usd,
} from './economics-fixtures';
import { formatMoney } from './money';

const base = (over: Partial<CreateCostReceiptInput> = {}): CreateCostReceiptInput => ({
  receiptId: 'r-1',
  projectId: FIXTURE_PROJECT,
  missionId: FIXTURE_MISSION,
  missionRevision: FIXTURE_REVISION,
  category: 'model_inference',
  costClass: 'actual',
  status: 'finalized',
  source: 'provider_reported',
  providerUsageReferenceId: 'usage-1',
  amount: usd('1.00'),
  actualAgentId: 'agent-claude',
  occurredAt: ECON_T1,
  recordedAt: ECON_T1,
  finalizedAt: ECON_T1,
  ...over,
});

describe('receipt creation and validation', () => {
  it('creates a valid finalized receipt, frozen and serializable', () => {
    const result = createCostReceipt(base());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(JSON.parse(JSON.stringify(result.value))).toEqual(result.value);
    expect(result.value.integrity).toBe('unverified');
  });

  it('allows a pending receipt with a genuinely unknown amount', () => {
    const result = createCostReceipt(
      base({ receiptId: 'r-pending', status: 'pending', amount: null, finalizedAt: undefined, providerUsageReferenceId: undefined }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.amount).toBeNull();
  });

  it('refuses to finalize a receipt with no amount', () => {
    const result = createCostReceipt(base({ amount: null }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RECEIPT_AMOUNT_REQUIRED');
    expect(result.error.reason).toMatch(/fabricate certainty/u);
  });

  it.each([
    ['project', { projectId: '' }],
    ['mission', { missionId: '' }],
    ['receipt id', { receiptId: '' }],
  ])('rejects a missing %s', (_label, over) => {
    const result = createCostReceipt(base(over as Partial<CreateCostReceiptInput>));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('COST_ATTRIBUTION_INVALID');
  });

  it.each([0, -1, 1.5])('rejects an invalid mission revision %s', (revision) => {
    const result = createCostReceipt(base({ missionRevision: revision }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('COST_ATTRIBUTION_INVALID');
  });

  it('rejects an unknown category, class, status, and source', () => {
    expect(createCostReceipt(base({ category: 'teleportation' as never })).ok).toBe(false);
    expect(createCostReceipt(base({ costClass: 'guessed' as never })).ok).toBe(false);
    expect(createCostReceipt(base({ status: 'maybe' as never })).ok).toBe(false);
    expect(createCostReceipt(base({ source: 'vibes' as never })).ok).toBe(false);
  });

  it('refuses a negative amount outside an adjustment', () => {
    const result = createCostReceipt(base({ amount: usd('-1.00') }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_ADJUSTMENT');
  });

  it('requires an adjustment to identify the original and state a reason', () => {
    const noOriginal = createCostReceipt(base({ category: 'adjustment', amount: usd('-0.25') }));
    expect(!noOriginal.ok && noOriginal.error.code).toBe('INVALID_ADJUSTMENT');

    const noReason = createCostReceipt(
      base({ category: 'adjustment', amount: usd('-0.25'), adjustmentOfReceiptId: 'r-x' }),
    );
    expect(!noReason.ok && noReason.error.code).toBe('INVALID_ADJUSTMENT');
  });

  it('requires a provider usage reference for a finalized provider-reported actual', () => {
    const result = createCostReceipt(base({ providerUsageReferenceId: undefined }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('COST_ATTRIBUTION_INVALID');
    expect(result.error.field).toBe('providerUsageReferenceId');
  });

  it('requires a rate reference for a Relay-calculated amount — no invented prices', () => {
    const result = createCostReceipt(
      base({ source: 'relay_calculated', providerUsageReferenceId: undefined }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RATE_REFERENCE_REQUIRED');
  });

  it('requires a rate reference to value human time — no invented hourly rate', () => {
    const result = createCostReceipt(
      base({
        category: 'human_intervention',
        source: 'human_entered',
        providerUsageReferenceId: undefined,
        actualAgentId: undefined,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RATE_REFERENCE_REQUIRED');
    expect(result.error.reason).toMatch(/never invents an hourly rate/u);
  });

  it('redacts metadata and records that it did', () => {
    const metadata = secretShapedReceiptMetadata();
    const snapshot = JSON.stringify(metadata);
    const result = createCostReceipt(base({ metadata }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = JSON.stringify(result.value);
    expect(stored).not.toContain('sk-fixture0123456789abcdefghij');
    expect(stored).not.toContain('fixture-token-0123456789abcd');
    expect(stored).toContain('[redacted]');
    expect(stored).toContain('ANTHROPIC_API_KEY'); // the NAME is useful evidence
    expect(result.value.redactionStatus).toBe('redacted');
    expect(JSON.stringify(metadata)).toBe(snapshot);
  });

  it('never mutates its input', () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    createCostReceipt(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('receipt lifecycle', () => {
  const pending = () =>
    receipt({
      receiptId: 'r-life',
      status: 'pending',
      amount: null,
      providerUsageReferenceId: undefined,
      finalizedAt: undefined,
      actualAgentId: 'agent-claude',
    });

  it('moves pending → provisional → finalized', () => {
    const provisional = markProvisional(pending(), usd('0.90'));
    expect(provisional.ok).toBe(true);
    if (!provisional.ok) return;
    expect(provisional.value.status).toBe('provisional');

    const finalized = finalizeReceipt(provisional.value, usd('1.00'), ECON_T2);
    expect(finalized.ok).toBe(true);
    if (!finalized.ok) return;
    expect(finalized.value.status).toBe('finalized');
    expect(formatMoney(finalized.value.amount!)).toBe('$1.00');
    expect(finalized.value.finalizedAt).toBe(ECON_T2);
  });

  it('finalization is idempotent for the same amount', () => {
    const first = finalizeReceipt(pending(), usd('1.00'), ECON_T2);
    if (!first.ok) throw new Error('setup failed');
    const again = finalizeReceipt(first.value, usd('1.00'), ECON_T3);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.finalizedAt).toBe(ECON_T2); // unchanged
  });

  it('refuses to re-finalize at a DIFFERENT amount — that is a correction', () => {
    const first = finalizeReceipt(pending(), usd('1.00'), ECON_T2);
    if (!first.ok) throw new Error('setup failed');
    const changed = finalizeReceipt(first.value, usd('2.00'), ECON_T3);
    expect(changed.ok).toBe(false);
    if (changed.ok) return;
    expect(changed.error.code).toBe('RECEIPT_ALREADY_FINALIZED');
    expect(changed.error.safeNextAction).toMatch(/adjustment/u);
  });

  it('a finalized receipt may be disputed and stays inspectable', () => {
    const finalized = receipt({ receiptId: 'r-d', amount: usd('3.00'), actualAgentId: 'agent-claude' });
    const disputed = disputeReceipt(finalized, 'unrecognized session');
    expect(disputed.ok).toBe(true);
    if (!disputed.ok) return;
    expect(disputed.value.status).toBe('disputed');
    expect(disputed.value.metadata.disputeReason).toBe('unrecognized session');
    expect(formatMoney(disputed.value.amount!)).toBe('$3.00');
  });

  it('a voided receipt can never reactivate', () => {
    const voided = voidReceipt(receipt({ receiptId: 'r-v', amount: usd('1.00'), actualAgentId: 'agent-claude' }), 'duplicate');
    expect(voided.ok).toBe(true);
    if (!voided.ok) return;

    for (const attempt of [
      finalizeReceipt(voided.value, usd('1.00'), ECON_T3),
      markProvisional(voided.value, usd('1.00')),
      disputeReceipt(voided.value, 'nope'),
    ]) {
      expect(attempt.ok).toBe(false);
      if (!attempt.ok) expect(attempt.error.code).toBe('RECEIPT_VOIDED');
    }
    // …and it is still fully readable.
    expect(formatMoney(voided.value.amount!)).toBe('$1.00');
  });

  it('rejects an invalid transition and preserves the prior state', () => {
    const finalized = receipt({ receiptId: 'r-t', amount: usd('1.00'), actualAgentId: 'agent-claude' });
    const backwards = markProvisional(finalized, usd('0.50'));
    expect(backwards.ok).toBe(false);
    if (backwards.ok) return;
    expect(backwards.error.code).toBe('INVALID_RECEIPT_TRANSITION');
    expect(finalized.status).toBe('finalized');
    expect(formatMoney(finalized.amount!)).toBe('$1.00');
  });

  it('raises integrity only through attestation or a VERIFIED chain', () => {
    const r = receipt({ receiptId: 'r-int', amount: usd('1.00'), actualAgentId: 'agent-claude' });
    const attested = attachSourceAttestation(r);
    expect(attested.ok && attested.value.integrity).toBe('source_attested');

    const unverified = attachTraceVerification(r, false);
    expect(unverified.ok).toBe(false);
    if (!unverified.ok) expect(unverified.error.code).toBe('ECONOMICS_TRACE_ADAPTER_FAILED');

    const verified = attachTraceVerification(r, true);
    expect(verified.ok && verified.value.integrity).toBe('trace_verified');
  });

  it('exposes no delete or generic mutation function', () => {
    const service = { attachSourceAttestation, createAdjustment, createCostReceipt, disputeReceipt, finalizeReceipt, markProvisional, voidReceipt };
    expect(Object.keys(service).some((name) => /delete|remove|set[A-Z]|update|patch/u.test(name))).toBe(
      false,
    );
  });
});

describe('receipt repository', () => {
  const populated = () => {
    const repository = new InMemoryCostReceiptRepository();
    for (const r of [
      receipt({ receiptId: 'p-1', category: 'planning', amount: usd('0.20'), actualAgentId: 'agent-architect', runId: 'run-1', capsuleId: 'cap-1', taskId: 'task-1', pspVersionId: 'psp-v1' }),
      receipt({ receiptId: 'p-2', category: 'review', amount: usd('0.40'), actualAgentId: 'agent-codex', runId: 'run-2', capsuleId: 'cap-2', taskId: 'task-2', pspVersionId: 'psp-v1' }),
    ]) {
      const created = repository.create(r);
      if (!created.ok) throw new Error(created.error.reason);
    }
    return repository;
  };

  it('creates, gets, and lists across every attribution axis', () => {
    const repository = populated();
    expect(repository.get('p-1')?.category).toBe('planning');
    expect(repository.get('missing')).toBeNull();
    expect(repository.listByProject(FIXTURE_PROJECT)).toHaveLength(2);
    expect(repository.listByMission(FIXTURE_MISSION)).toHaveLength(2);
    expect(repository.listByTask('task-1')).toHaveLength(1);
    expect(repository.listByRun('run-2')[0].receiptId).toBe('p-2');
    expect(repository.listByCapsule('cap-1')[0].receiptId).toBe('p-1');
    expect(repository.listByActualAgent('agent-codex')[0].receiptId).toBe('p-2');
    expect(repository.listByPspVersion('psp-v1')).toHaveLength(2);
    expect(repository.listByCategory('review')).toHaveLength(1);
    expect(repository.listByStatus('finalized')).toHaveLength(2);
  });

  it('rejects a duplicate receipt id', () => {
    const repository = populated();
    const duplicate = repository.create(receipt({ receiptId: 'p-1', amount: usd('9.99'), actualAgentId: 'agent-claude' }));
    expect(!duplicate.ok && duplicate.error.code).toBe('DUPLICATE_RECEIPT_ID');
    expect(formatMoney(repository.get('p-1')!.amount!)).toBe('$0.20');
  });

  it('rejects a second CHARGE for the same provider usage — no double billing', () => {
    const repository = new InMemoryCostReceiptRepository();
    const first = receipt({ receiptId: 'u-1', amount: usd('1.00'), actualAgentId: 'agent-claude', providerUsageReferenceId: 'usage-shared' });
    expect(repository.create(first).ok).toBe(true);

    const second = receipt({ receiptId: 'u-2', amount: usd('1.00'), actualAgentId: 'agent-claude', providerUsageReferenceId: 'usage-shared' });
    const result = repository.create(second);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DUPLICATE_PROVIDER_USAGE_REFERENCE');
  });

  it('still allows an ADJUSTMENT against the same provider usage', () => {
    const repository = new InMemoryCostReceiptRepository();
    const original = receipt({ receiptId: 'u-3', amount: usd('2.00'), actualAgentId: 'agent-claude', providerUsageReferenceId: 'usage-adj' });
    repository.create(original);
    const adjustment = createAdjustment({
      receiptId: 'u-3-adj',
      original,
      amount: usd('-0.25'),
      reason: 'provider credit',
      occurredAt: ECON_T3,
      recordedAt: ECON_T3,
    });
    if (!adjustment.ok) throw new Error(adjustment.error.reason);
    expect(repository.create(adjustment.value).ok).toBe(true);
  });

  it('returns deep-frozen clones — stored state is unreachable through them', () => {
    const repository = populated();
    const fetched = repository.get('p-1')!;
    expect(Object.isFrozen(fetched)).toBe(true);
    expect(() => {
      (fetched as { status: string }).status = 'voided';
    }).toThrow();
    expect(repository.get('p-1')?.status).toBe('finalized');
  });

  it('replaces only through a validated lifecycle result, never re-attributing', () => {
    const repository = populated();
    const stored = repository.get('p-1')!;
    const disputed = disputeReceipt(stored, 'checking');
    if (!disputed.ok) throw new Error('setup failed');
    expect(repository.replace(disputed.value).ok).toBe(true);
    expect(repository.get('p-1')?.status).toBe('disputed');

    const reAttributed = { ...stored, missionId: 'mission-other' };
    const result = repository.replace(reAttributed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('COST_ATTRIBUTION_INVALID');
    expect(repository.get('p-1')?.missionId).toBe(FIXTURE_MISSION);
  });

  it('exposes no deletion API', () => {
    const repository = new InMemoryCostReceiptRepository();
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(repository));
    expect(surface.some((name) => /delete|remove|clear|drop|purge/u.test(name))).toBe(false);
  });

  it('a failed operation preserves the repository byte-for-byte', () => {
    const repository = populated();
    const before = JSON.stringify(repository.listByMission(FIXTURE_MISSION));
    repository.create(receipt({ receiptId: 'p-1', amount: usd('5.00'), actualAgentId: 'agent-claude' }));
    repository.replace({ ...repository.get('p-1')!, runId: 'run-hijack' });
    expect(JSON.stringify(repository.listByMission(FIXTURE_MISSION))).toBe(before);
  });
});
