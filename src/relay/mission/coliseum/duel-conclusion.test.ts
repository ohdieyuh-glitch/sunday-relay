import { describe, expect, it } from 'vitest';
import { createInMemoryDurableBacking, type DurableKeyValueBacking } from '../durable';
import { createDuelStore, totalXp } from './duel-store';
import type { DuelRecord } from './duel-contracts';
import type { ProofEntry } from './proof-meter';
import type { VerifiedFixFact } from './duel-results-projection';
import { concludeDuelAndAward, readAwardMarker } from './duel-conclusion';

const NOW = '2026-08-18T00:00:00.000Z';

const concluded = (over: Partial<DuelRecord> = {}): DuelRecord => ({
  duelId: 'duel-1',
  status: 'concluded',
  mode: 'manual',
  participants: [
    { participantId: 'agent-a', displayName: 'A', kind: 'agent' },
    { participantId: 'agent-b', displayName: 'B', kind: 'agent' },
  ],
  sandboxes: [
    { sourceTargetRef: 'repo:a@main', sandboxCopyId: 'sb-a', provisionedAt: NOW },
    { sourceTargetRef: 'repo:b@main', sandboxCopyId: 'sb-b', provisionedAt: NOW },
  ],
  winnerParticipantId: 'agent-a',
  createdAt: NOW,
  updatedAt: NOW,
  abortReason: null,
  ...over,
});

const PROOF: Readonly<Record<string, readonly ProofEntry[]>> = {
  'agent-a': [{
    entryId: 'p-1', category: 'bug-discovery', submitterId: 'agent-a',
    summary: 'found a race', verification: 'verified-true', verifierId: 'verifier-1', brokeSandbox: false,
  }],
  // agent-b submitted only an UNVERIFIED claim — worth 0, truthfully.
  'agent-b': [{
    entryId: 'p-2', category: 'repair-accepted', submitterId: 'agent-b',
    summary: 'claims a fix', verification: 'unverified', verifierId: null, brokeSandbox: false,
  }],
};

const FIXES: readonly VerifiedFixFact[] = [{
  id: 'fix-1', summary: 'hardened opponent input parsing',
  targetParticipantId: 'agent-b', authorParticipantId: 'agent-a',
  appliedState: 'applied', verifierId: 'verifier-1',
}];

describe('concludeDuelAndAward', () => {
  it('writes BOTH participants\' real rewards into the durable ledger, sequentially', async () => {
    const backing = createInMemoryDurableBacking();
    const store = createDuelStore(backing);
    const result = await concludeDuelAndAward(store, backing, {
      duel: concluded(), proofEntries: PROOF, verifiedFixes: FIXES, awardedAt: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [a, b] = result.participants;
    // agent-a: verified bug-discovery points + 50 opponent-fix bonus + 25 winner bonus.
    expect(a.written).toBe(true);
    expect(a.reward.opponentFixBonus).toBe(50);
    expect(a.reward.xp).toBeGreaterThan(75);
    // agent-b: an unverified claim earns 0 — the ledger says so.
    expect(b.written).toBe(true);
    expect(b.reward.xp).toBe(0);

    const ledgerA = await store.readXpLedger('agent-a');
    expect(totalXp(ledgerA)).toBe(a.reward.xp);
    expect(ledgerA.entries[0].duelId).toBe('duel-1');
    const ledgerB = await store.readXpLedger('agent-b');
    expect(totalXp(ledgerB)).toBe(0);
    expect(ledgerB.entries).toHaveLength(1);

    const marker = await readAwardMarker(backing, 'duel-1');
    expect(marker?.participantIds).toEqual(['agent-a', 'agent-b']);
  });

  it('REFUSES to award the same duel twice — and no second ledger entry appears', async () => {
    const backing = createInMemoryDurableBacking();
    const store = createDuelStore(backing);
    const input = { duel: concluded(), proofEntries: PROOF, verifiedFixes: FIXES, awardedAt: NOW };
    const first = await concludeDuelAndAward(store, backing, input);
    expect(first.ok).toBe(true);
    const second = await concludeDuelAndAward(store, backing, { ...input, awardedAt: '2026-08-19T00:00:00.000Z' });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.refusal).toMatch(/already awarded at 2026-08-18T00:00:00\.000Z/u);
    expect((await store.readXpLedger('agent-a')).entries).toHaveLength(1);
    expect((await store.readXpLedger('agent-b')).entries).toHaveLength(1);
  });

  it('refuses a duel that is not concluded — a state value is a position, never proof', async () => {
    const backing = createInMemoryDurableBacking();
    const store = createDuelStore(backing);
    for (const status of ['challenged', 'accepted', 'provisioning', 'active', 'aborted'] as const) {
      const result = await concludeDuelAndAward(store, backing, {
        duel: concluded({ status, winnerParticipantId: null }),
        proofEntries: PROOF, verifiedFixes: [], awardedAt: NOW,
      });
      expect(result.ok).toBe(false);
    }
    expect((await store.readXpLedger('agent-a')).entries).toHaveLength(0);
  });

  it('a self-verified or merely-available fix earns NO opponent-fix bonus', async () => {
    const backing = createInMemoryDurableBacking();
    const store = createDuelStore(backing);
    const result = await concludeDuelAndAward(store, backing, {
      duel: concluded(),
      proofEntries: {},
      verifiedFixes: [
        { id: 'f1', summary: 's', targetParticipantId: 'agent-b', authorParticipantId: 'agent-a', appliedState: 'applied', verifierId: 'agent-a' },
        { id: 'f2', summary: 's', targetParticipantId: 'agent-b', authorParticipantId: 'agent-a', appliedState: 'available', verifierId: 'verifier-1' },
        { id: 'f3', summary: 's', targetParticipantId: 'agent-b', authorParticipantId: 'agent-a', appliedState: 'applied', verifierId: null },
      ],
      awardedAt: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.participants[0].reward.opponentFixBonus).toBe(0);
  });

  it('a partial award (one append failed) writes NO marker, and a retry pays only the missing participant', async () => {
    const real = createInMemoryDurableBacking();
    let failWritesTo: string | null = 'coliseum:xp:agent-b';
    const flaky: DurableKeyValueBacking = {
      durability: real.durability,
      locationLabel: real.locationLabel,
      async putText(key, text) {
        if (failWritesTo !== null && key === failWritesTo) throw new Error('injected durable failure');
        return real.putText(key, text);
      },
      getText: (key) => real.getText(key),
      deleteKey: (key) => real.deleteKey(key),
      listKeys: () => real.listKeys(),
    };
    const store = createDuelStore(flaky);
    const input = { duel: concluded(), proofEntries: PROOF, verifiedFixes: [], awardedAt: NOW };

    const first = await concludeDuelAndAward(store, flaky, input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.participants[0].written).toBe(true);
    expect(first.participants[1].written).toBe(false);
    expect(first.participants[1].writeFailure).toMatch(/injected durable failure/u);
    expect(await readAwardMarker(flaky, 'duel-1')).toBeNull();

    // Retry after the backing recovers: agent-a is NOT paid twice.
    failWritesTo = null;
    const second = await concludeDuelAndAward(store, flaky, input);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.participants.every((p) => p.written)).toBe(true);
    expect(second.participants[0].alreadyWritten).toBe(true);
    expect(second.participants[1].alreadyWritten).toBe(false);
    expect(second.markerWritten).toBe(true);
    expect((await store.readXpLedger('agent-a')).entries).toHaveLength(1);
    expect((await store.readXpLedger('agent-b')).entries).toHaveLength(1);
    expect(await readAwardMarker(flaky, 'duel-1')).not.toBeNull();
  });

  it('a dedup retry reports the LEDGER\'s original entry, never this call\'s recomputed reward', async () => {
    const real = createInMemoryDurableBacking();
    let failWritesTo: string | null = 'coliseum:xp:agent-b';
    const flaky: DurableKeyValueBacking = {
      durability: real.durability,
      locationLabel: real.locationLabel,
      async putText(key, text) {
        if (failWritesTo !== null && key === failWritesTo) throw new Error('injected durable failure');
        return real.putText(key, text);
      },
      getText: (key) => real.getText(key),
      deleteKey: (key) => real.deleteKey(key),
      listKeys: () => real.listKeys(),
    };
    const store = createDuelStore(flaky);
    // First call: agent-a's award lands (with PROOF-based xp), agent-b's fails,
    // so no marker is written and a retry is expected.
    const first = await concludeDuelAndAward(store, flaky, {
      duel: concluded(), proofEntries: PROOF, verifiedFixes: FIXES, awardedAt: NOW,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const originalXp = first.participants[0].reward.xp;
    expect(originalXp).toBeGreaterThan(0);

    // Retry with DIFFERENT proof inputs (none) — the recomputed reward is 25
    // (winner bonus only), but the ledger still holds the ORIGINAL entry.
    failWritesTo = null;
    const second = await concludeDuelAndAward(store, flaky, {
      duel: concluded(), proofEntries: {}, verifiedFixes: [], awardedAt: NOW,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const a = second.participants[0];
    expect(a.alreadyWritten).toBe(true);
    expect(a.ledgerEntry?.xp).toBe(originalXp); // the durable fact
    expect(a.reward.xp).not.toBe(originalXp); // this call's recomputation differs
    // And the ledger itself agrees with what was reported.
    const ledgerA = await store.readXpLedger('agent-a');
    expect(ledgerA.entries[0].xp).toBe(originalXp);
    expect(ledgerA.entries).toHaveLength(1);
  });

  it('a failed MARKER write does not reject a fully-written award — markerWritten:false, and dedup still blocks double-pay', async () => {
    const real = createInMemoryDurableBacking();
    let failMarker = true;
    const flaky: DurableKeyValueBacking = {
      durability: real.durability,
      locationLabel: real.locationLabel,
      async putText(key, text) {
        if (failMarker && key === 'coliseum:award:duel-1') throw new Error('injected marker failure');
        return real.putText(key, text);
      },
      getText: (key) => real.getText(key),
      deleteKey: (key) => real.deleteKey(key),
      listKeys: () => real.listKeys(),
    };
    const store = createDuelStore(flaky);
    const input = { duel: concluded(), proofEntries: PROOF, verifiedFixes: FIXES, awardedAt: NOW };

    const first = await concludeDuelAndAward(store, flaky, input);
    expect(first.ok).toBe(true); // XP writes fully succeeded — an ok award
    if (!first.ok) return;
    expect(first.participants.every((p) => p.written)).toBe(true);
    expect(first.markerWritten).toBe(false); // the truthful marker fact
    expect(await readAwardMarker(flaky, 'duel-1')).toBeNull();
    expect((await store.readXpLedger('agent-a')).entries).toHaveLength(1);
    expect((await store.readXpLedger('agent-b')).entries).toHaveLength(1);

    // A subsequent call re-runs the per-participant dedup: nobody is paid twice.
    failMarker = false;
    const second = await concludeDuelAndAward(store, flaky, input);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.participants.every((p) => p.alreadyWritten)).toBe(true);
    expect(second.markerWritten).toBe(true);
    expect((await store.readXpLedger('agent-a')).entries).toHaveLength(1);
    expect((await store.readXpLedger('agent-b')).entries).toHaveLength(1);
  });
});
