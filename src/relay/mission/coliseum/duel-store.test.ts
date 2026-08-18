import { describe, expect, it } from 'vitest';

import { createInMemoryDurableBacking } from '../durable';
import { createDuelStore, totalXp } from './duel-store';
import {
  ACTIVE_AUTOMATION_FIGHT,
  CHALLENGED_DUEL,
  CONCLUDED_MANUAL_DUEL,
  CONCLUDED_MANUAL_PROOF_ENTRIES,
  CONCLUDED_MANUAL_VERIFIED_FIXES,
  activeAutomationFightResults,
  challengedDuelResults,
  concludedManualDuelResults,
} from './duel-fixtures';
import { projectDuelResults } from './duel-results-projection';
import type { DuelRecord } from './duel-contracts';

const resultsFor = (duel: DuelRecord) =>
  projectDuelResults({
    duel,
    proofEntries: CONCLUDED_MANUAL_PROOF_ENTRIES,
    measurements: {},
    verifiedFixes: CONCLUDED_MANUAL_VERIFIED_FIXES,
  });

describe('duel store — durable round trip', () => {
  it('writes a duel, reloads it from the backing, and projects identically', async () => {
    const backing = createInMemoryDurableBacking();
    const store = createDuelStore(backing);
    const written = await store.writeDuel(CONCLUDED_MANUAL_DUEL);
    expect(written.ok).toBe(true);

    // A SECOND store over the SAME backing — proving the bytes carry it.
    const reloadedStore = createDuelStore(backing);
    const read = await reloadedStore.readDuel(CONCLUDED_MANUAL_DUEL.duelId);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.duel).toEqual(CONCLUDED_MANUAL_DUEL);
      expect(resultsFor(read.duel)).toEqual(resultsFor(CONCLUDED_MANUAL_DUEL));
    }
    expect(await reloadedStore.listDuelIds()).toEqual([CONCLUDED_MANUAL_DUEL.duelId]);
  });

  it('a missing duel is not_found and malformed bytes are corrupt — never invented', async () => {
    const backing = createInMemoryDurableBacking({
      seed: { 'coliseum:duel:broken': '{not json' },
    });
    const store = createDuelStore(backing);
    expect(await store.readDuel('absent')).toEqual({ ok: false, reason: 'not_found' });
    expect(await store.readDuel('broken')).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('a failed write reports failure — never claims the duel was saved', async () => {
    const store = createDuelStore(createInMemoryDurableBacking({ failWrites: true }));
    const written = await store.writeDuel(CONCLUDED_MANUAL_DUEL);
    expect(written.ok).toBe(false);
  });

  it('strips token-named keys through the shared redactor before persisting', async () => {
    const backing = createInMemoryDurableBacking();
    const store = createDuelStore(backing);
    const poisoned = {
      ...CONCLUDED_MANUAL_DUEL,
      // A hostile/buggy caller smuggling a credential into the record.
      apiToken: 'sk-live-abcdef1234567890',
    } as unknown as DuelRecord;
    await store.writeDuel(poisoned);
    const raw = await backing.getText(`coliseum:duel:${CONCLUDED_MANUAL_DUEL.duelId}`);
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('sk-live-abcdef1234567890');
  });
});

describe('per-agent XP ledger', () => {
  it('appends awards and reloads them from the backing, append-only', async () => {
    const backing = createInMemoryDurableBacking();
    const store = createDuelStore(backing);
    await store.appendXp('agent-aria', {
      duelId: 'duel-1', xp: 90, awardedAt: '2026-08-18T10:00:00.000Z', summary: 'verified duel work',
    });
    await store.appendXp('agent-aria', {
      duelId: 'duel-2', xp: 50, awardedAt: '2026-08-18T11:00:00.000Z', summary: 'opponent fix bonus',
    });

    const reloaded = await createDuelStore(backing).readXpLedger('agent-aria');
    expect(reloaded.entries).toHaveLength(2);
    expect(reloaded.entries.map((e) => e.duelId)).toEqual(['duel-1', 'duel-2']);
    expect(totalXp(reloaded)).toBe(140);
  });

  it('an agent with no ledger reads as empty, never invented', async () => {
    const store = createDuelStore(createInMemoryDurableBacking());
    const ledger = await store.readXpLedger('nobody');
    expect(ledger.entries).toEqual([]);
    expect(totalXp(ledger)).toBe(0);
  });
});

describe('fixtures honor the WP-2 results contract', () => {
  it('the concluded manual duel carries verified entries, a winner and the opponent-fix bonus', () => {
    const view = concludedManualDuelResults();
    expect(view.status).toBe('concluded');
    expect(view.mode).toBe('manual');
    expect(view.winnerParticipantId).toBe('agent-aria');
    const aria = view.participants[0];
    expect(aria.proofScore).toBeGreaterThan(0);
    expect(aria.bugsFound).toBe(1);
    expect(aria.repairsAccepted).toBe(1);
    expect(aria.opponentFixBonus).toBeGreaterThan(0);
    // The unverified performance claim is visible but worth zero.
    const unverified = aria.entries.find((e) => e.category === 'performance-improvement');
    expect(unverified).toBeDefined();
    expect(unverified?.verified).toBe(false);
    expect(unverified?.points).toBe(0);
    // Unmeasured stays null — never zero.
    expect(view.participants[1].evaluationQuality).toBeNull();
    expect(view.verifiedFixes).toHaveLength(1);
    expect(view.verifiedFixes[0].appliedState).toBe('applied');
    // The loser still earned for its verified reproducible failure.
    expect(view.participants[1].xpEarned).toBeGreaterThan(0);
  });

  it('the active automation fight is mid-flight: no winner, no scores invented', () => {
    const view = activeAutomationFightResults();
    expect(view.status).toBe('active');
    expect(view.mode).toBe('automation-fight');
    expect(view.winnerParticipantId).toBeNull();
    for (const p of view.participants) {
      expect(p.kind).toBe('automation');
      expect(p.proofScore).toBe(0);
      expect(p.entries).toEqual([]);
      expect(p.evaluationQuality).toBeNull();
      expect(p.reliabilityDelta).toBeNull();
      expect(p.performanceDelta).toBeNull();
    }
    expect(ACTIVE_AUTOMATION_FIGHT.sandboxes).not.toBeNull();
  });

  it('the challenged duel has no sandboxes and no results yet', () => {
    expect(CHALLENGED_DUEL.sandboxes).toBeNull();
    const view = challengedDuelResults();
    expect(view.status).toBe('challenged');
    expect(view.winnerParticipantId).toBeNull();
    expect(view.verifiedFixes).toEqual([]);
  });

  it('C-3: opponent-fix bonus requires applied AND independently verified — nothing else earns', () => {
    const bonusFor = (fixes: Parameters<typeof projectDuelResults>[0]['verifiedFixes']) =>
      projectDuelResults({
        duel: CONCLUDED_MANUAL_DUEL,
        proofEntries: {},
        measurements: {},
        verifiedFixes: fixes,
      }).participants[0].opponentFixBonus;

    const base = {
      id: 'fix-x',
      summary: 'a fix on the opponent sandbox',
      targetParticipantId: 'sw-ledger',
      authorParticipantId: 'agent-aria',
    } as const;

    // 'available' (not applied) earns nothing, even independently verified.
    expect(bonusFor([{ ...base, appliedState: 'available', verifierId: 'reviewer-hermes' }])).toBe(0);
    // Self-verified earns nothing — the author is not independent.
    expect(bonusFor([{ ...base, appliedState: 'applied', verifierId: 'agent-aria' }])).toBe(0);
    // Unverified (null verifier) earns nothing — unknown is never independence.
    expect(bonusFor([{ ...base, appliedState: 'applied', verifierId: null }])).toBe(0);
    // Applied + independently verified earns the bonus.
    expect(bonusFor([{ ...base, appliedState: 'applied', verifierId: 'reviewer-hermes' }])).toBeGreaterThan(0);
  });

  it('every projection lists all nine commands with truthful bindings', () => {
    const view = challengedDuelResults();
    expect(view.commands).toHaveLength(9);
    const byName = Object.fromEntries(view.commands.map((c) => [c.name, c.binding]));
    expect(byName.TRACE).toBe('bound');
    expect(byName.SB).toBe('bound');
    expect(byName.VERIFY).toBe('bound');
    for (const unboundName of ['RED', 'FORK', 'GUARD', 'ROLLBACK', 'DEEP', 'SWARM'] as const) {
      expect(byName[unboundName]).toBe('unbound');
    }
  });
});
