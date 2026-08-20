import { describe, expect, it } from 'vitest';

import type { DurableKeyValueBacking } from '../durable';
import type { RelayCard } from './card-contracts';
import {
  activateCard,
  decideWonderlandEntry,
  restoreCard,
  standardCard,
  updateCard,
  validateCard,
} from './card-lifecycle';
import { createRelayCardStore } from './card-store';

const NOW = '2026-08-20T10:00:00.000Z';
const LATER = '2026-08-20T11:00:00.000Z';

function card(over: Partial<RelayCard> = {}): RelayCard {
  return {
    ...standardCard({ cardId: 'card-1', ownerId: 'owner-1', displayName: 'Scout', nowIso: NOW }),
    ...over,
  };
}

function activeCard(over: Partial<RelayCard> = {}): RelayCard {
  const a = activateCard(card(), NOW);
  if (!a.ok || a.card === null) throw new Error('fixture failed to activate');
  return { ...a.card, ...over };
}

/** An in-memory backing that can be told to fail, for the write-failure path. */
function backing(opts: { failWrite?: boolean; failRead?: boolean; corrupt?: string } = {}) {
  const data = new Map<string, string>();
  const b: DurableKeyValueBacking = {
    durability: 'volatile-test-only',
    locationLabel: 'test',
    async getText(key) {
      if (opts.failRead) throw new Error('disk gone');
      if (opts.corrupt !== undefined && data.has(key)) return opts.corrupt;
      return data.get(key) ?? null;
    },
    async putText(key, value) {
      if (opts.failWrite) throw new Error('disk full');
      data.set(key, value);
    },
    async deleteKey(key) {
      data.delete(key);
    },
    async listKeys() {
      return [...data.keys()];
    },
  };
  return { b, data };
}

describe('the standard card is already an excellent agent', () => {
  it('enables all three roles rather than withholding any', () => {
    const c = card();
    expect(c.roleStack).toHaveLength(3);
    expect(c.roleStack.every((s) => s.enabled)).toBe(true);
    expect(c.roleStack.map((s) => s.role).sort()).toEqual(
      ['coding_agent', 'prompt_architect', 'reviewer'],
    );
  });

  it('requires evidence by default — verification is not a paid tier', () => {
    expect(card().verificationPolicy).toBe('evidence_required');
  });

  it('has Project Brain on and fail-closed budgets by default', () => {
    const c = card();
    expect(c.projectBrain.enabled).toBe(true);
    expect(c.budget.failClosed).toBe(true);
  });

  it('starts bounded: it asks before writing', () => {
    expect(card().autonomy).toBe('ask_before_write');
  });

  it('an unknown budget is null, never zero and never unlimited', () => {
    const c = card();
    expect(c.budget.perMissionCents).toBeNull();
    expect(c.budget.perDayCents).not.toBe(0);
  });

  it('is a draft until someone activates it', () => {
    expect(card().state).toBe('draft');
    expect(card().activatedAtIso).toBeNull();
  });
});

describe('validation refuses what would look usable but is not', () => {
  it('accepts the standard card', () => {
    expect(validateCard(card()).valid).toBe(true);
  });

  it('rejects a non-object', () => {
    for (const bad of [null, 42, 'card', [], undefined]) {
      expect(validateCard(bad).valid).toBe(false);
    }
  });

  it('names an unsupported schema separately from corruption', () => {
    const v = validateCard(card({ schemaVersion: 'relay-card.v99' as never }));
    expect(v.valid).toBe(false);
    expect(v.problems.join(' ')).toContain('unsupported schema version');
  });

  it('rejects an empty role stack — an agent with no roles is not an agent', () => {
    const v = validateCard(card({ roleStack: [] }));
    expect(v.problems.join(' ')).toContain('roleStack is empty');
  });

  it('rejects a role stack where everything is disabled', () => {
    const v = validateCard(card({ roleStack: card().roleStack.map((s) => ({ ...s, enabled: false })) }));
    expect(v.problems.join(' ')).toContain('nothing would run');
  });

  it('rejects a budget that is not fail-closed', () => {
    const v = validateCard(card({ budget: { perMissionCents: 100, perDayCents: null, failClosed: false as never } }));
    expect(v.problems.join(' ')).toContain('fail-closed');
  });

  it('rejects an active card with no moment of activation', () => {
    const v = validateCard(card({ state: 'active', activatedAtIso: null }));
    expect(v.problems.join(' ')).toContain('must carry activatedAtIso');
  });

  it('rejects a Dog coat outside the sanctioned set', () => {
    const v = validateCard(card({ identity: { ...card().identity, dogCoat: 'rainbow' as never } }));
    expect(v.problems.join(' ')).toContain('sanctioned Relay Dog coat');
  });
});

describe('activation', () => {
  it('activates a valid draft and records when', () => {
    const a = activateCard(card(), LATER);
    expect(a.ok).toBe(true);
    expect(a.card?.state).toBe('active');
    expect(a.card?.activatedAtIso).toBe(LATER);
  });

  it('refuses to activate an invalid card', () => {
    const a = activateCard(card({ roleStack: [] }), LATER);
    expect(a.ok).toBe(false);
    expect(a.card).toBeNull();
    expect(a.reason).toContain('not valid');
  });

  it('refuses a DUPLICATE activation rather than rewriting when it began', () => {
    const first = activateCard(card(), NOW);
    expect(first.ok).toBe(true);
    const second = activateCard(first.card as RelayCard, LATER);
    expect(second.ok).toBe(false);
    expect(second.reason).toContain('already active');
    expect(second.card?.activatedAtIso).toBe(NOW);
  });
});

describe('an update cannot change who owns a card', () => {
  it('preserves identity fields and moves updatedAt', () => {
    const c = card();
    const u = updateCard(c, { autonomy: 'write_then_report' }, LATER);
    expect(u.autonomy).toBe('write_then_report');
    expect(u.ownerId).toBe(c.ownerId);
    expect(u.cardId).toBe(c.cardId);
    expect(u.createdAtIso).toBe(c.createdAtIso);
    expect(u.updatedAtIso).toBe(LATER);
  });
});

describe('returning-user restoration never fabricates a card', () => {
  it('restores a valid active card and marks its provenance', () => {
    const r = restoreCard({ stored: activeCard(), expectedOwnerId: 'owner-1' });
    expect(r.outcome).toBe('restored');
    expect(r.card?.provenance).toBe('restored_from_durable');
  });

  it('a missing card is no_card, and returns NO card', () => {
    const r = restoreCard({ stored: null, expectedOwnerId: 'owner-1' });
    expect(r.outcome).toBe('no_card');
    expect(r.card).toBeNull();
  });

  it('a malformed card is invalid, not no_card — the difference routes the user', () => {
    const r = restoreCard({ stored: { cardId: 'x' }, expectedOwnerId: 'owner-1' });
    expect(r.outcome).toBe('invalid');
    expect(r.card).toBeNull();
  });

  it('a future schema is unsupported_schema, not corruption', () => {
    const r = restoreCard({
      stored: activeCard({ schemaVersion: 'relay-card.v99' as never }),
      expectedOwnerId: 'owner-1',
    });
    expect(r.outcome).toBe('unsupported_schema');
  });

  it("another owner's card is refused and does not name them", () => {
    const r = restoreCard({ stored: activeCard(), expectedOwnerId: 'someone-else' });
    expect(r.outcome).toBe('owner_mismatch');
    expect(r.card).toBeNull();
    expect(r.detail).not.toContain('owner-1');
  });

  it('an inactive card is returned but NOT treated as restored', () => {
    const r = restoreCard({ stored: card({ state: 'inactive' }), expectedOwnerId: 'owner-1' });
    expect(r.outcome).toBe('not_active');
    expect(r.card).not.toBeNull();
  });

  it('never returns a standard card as though it had been restored', () => {
    for (const stored of [null, undefined, {}, 'nonsense', 7]) {
      const r = restoreCard({ stored, expectedOwnerId: 'owner-1' });
      expect(r.outcome).not.toBe('restored');
      expect(r.card === null || r.card.provenance !== 'restored_from_durable').toBe(true);
    }
  });
});

describe('Wonderland must ask Relay, and can be refused', () => {
  it('authorizes an active card and carries only an identity', () => {
    const d = decideWonderlandEntry({ card: activeCard(), requesterOwnerId: 'owner-1', nowIso: NOW });
    expect(d.authorized).toBe(true);
    if (d.authorized) {
      expect(d.identity.dogCoat).toBe('white');
      expect(Object.keys(d)).not.toContain('budget');
      expect(Object.keys(d)).not.toContain('tools');
    }
  });

  it('refuses with no card', () => {
    const d = decideWonderlandEntry({ card: null, requesterOwnerId: 'owner-1', nowIso: NOW });
    expect(d.authorized).toBe(false);
    if (!d.authorized) expect(d.refusal).toBe('no_card');
  });

  it('refuses a draft card — configuring is not activating', () => {
    const d = decideWonderlandEntry({ card: card(), requesterOwnerId: 'owner-1', nowIso: NOW });
    if (!d.authorized) expect(d.refusal).toBe('card_not_active');
    else throw new Error('a draft card was authorized');
  });

  it('refuses another owner', () => {
    const d = decideWonderlandEntry({ card: activeCard(), requesterOwnerId: 'intruder', nowIso: NOW });
    if (!d.authorized) expect(d.refusal).toBe('owner_mismatch');
    else throw new Error('a foreign card was authorized');
  });

  it('refuses an invalid card', () => {
    const d = decideWonderlandEntry({
      card: activeCard({ roleStack: [] }),
      requesterOwnerId: 'owner-1',
      nowIso: NOW,
    });
    if (!d.authorized) expect(d.refusal).toBe('card_invalid');
    else throw new Error('an invalid card was authorized');
  });

  it('every refusal carries a reason a client can show', () => {
    const d = decideWonderlandEntry({ card: null, requesterOwnerId: 'o', nowIso: NOW });
    if (!d.authorized) expect(d.detail.length).toBeGreaterThan(0);
  });
});

describe('durable store', () => {
  it('saves and loads a round trip', async () => {
    const { b } = backing();
    const store = createRelayCardStore(b);
    const saved = await store.save(activeCard());
    expect(saved.ok).toBe(true);
    const loaded = await store.load('owner-1');
    expect(loaded.outcome).toBe('restored');
    expect(loaded.card?.cardId).toBe('card-1');
  });

  it('REFUSES to persist an invalid card', async () => {
    const { b, data } = backing();
    const store = createRelayCardStore(b);
    const r = await store.save(card({ roleStack: [] }));
    expect(r.ok).toBe(false);
    expect(data.size).toBe(0);
  });

  it('a failed write is reported as a failure, never as saved', async () => {
    const { b } = backing({ failWrite: true });
    const r = await createRelayCardStore(b).save(activeCard());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('durable write failed');
  });

  it('a failed read is invalid, not silently empty', async () => {
    const { b } = backing({ failRead: true });
    const r = await createRelayCardStore(b).load('owner-1');
    expect(r.outcome).toBe('invalid');
  });

  it('corrupt stored JSON is invalid, NOT no_card', async () => {
    const { b } = backing({ corrupt: '{not json' });
    const store = createRelayCardStore(b);
    await store.save(activeCard());
    const r = await store.load('owner-1');
    expect(r.outcome).toBe('invalid');
    expect(r.detail).toContain('not valid JSON');
  });

  it('an absent card is no_card', async () => {
    const { b } = backing();
    expect((await createRelayCardStore(b).load('nobody')).outcome).toBe('no_card');
  });

  it('one owner cannot read another owner card', async () => {
    const { b } = backing();
    const store = createRelayCardStore(b);
    await store.save(activeCard());
    expect((await store.load('someone-else')).outcome).toBe('no_card');
  });

  it('clear removes it and the next load says so honestly', async () => {
    const { b } = backing();
    const store = createRelayCardStore(b);
    await store.save(activeCard());
    await store.clear('owner-1');
    expect((await store.load('owner-1')).outcome).toBe('no_card');
  });

  it('an interrupted creation leaves no half-card to resume from', async () => {
    // The draft was never saved because it never validated; a resumed session
    // must find nothing rather than a partial record that looks activatable.
    const { b } = backing();
    const store = createRelayCardStore(b);
    await store.save(card({ identity: { ...card().identity, displayName: '' } }));
    expect((await store.load('owner-1')).outcome).toBe('no_card');
  });
});

describe('the whole first run, end to end', () => {
  it('create → validate → save → activate → enter', async () => {
    const { b } = backing();
    const store = createRelayCardStore(b);

    const draft = standardCard({
      cardId: 'card-new', ownerId: 'owner-new', displayName: 'First', nowIso: NOW,
    });
    expect(validateCard(draft).valid).toBe(true);

    // A draft may be saved and resumed; it just cannot enter Wonderland.
    expect((await store.save(draft)).ok).toBe(true);
    const beforeActivation = decideWonderlandEntry({
      card: draft, requesterOwnerId: 'owner-new', nowIso: NOW,
    });
    expect(beforeActivation.authorized).toBe(false);

    const activated = activateCard(draft, LATER);
    expect(activated.ok).toBe(true);
    expect((await store.save(activated.card as RelayCard)).ok).toBe(true);

    const entry = decideWonderlandEntry({
      card: activated.card, requesterOwnerId: 'owner-new', nowIso: LATER,
    });
    expect(entry.authorized).toBe(true);
  });

  it('a returning participant is restored without reconfiguring', async () => {
    const { b } = backing();
    const store = createRelayCardStore(b);
    await store.save(activeCard());

    const back = await store.load('owner-1');
    expect(back.outcome).toBe('restored');
    const entry = decideWonderlandEntry({
      card: back.card, requesterOwnerId: 'owner-1', nowIso: LATER,
    });
    expect(entry.authorized).toBe(true);
  });

  it('GitHub is not an onboarding gate — nothing here mentions a repository', async () => {
    const { b } = backing();
    const store = createRelayCardStore(b);
    const c = activeCard();
    await store.save(c);
    const entry = decideWonderlandEntry({ card: c, requesterOwnerId: 'owner-1', nowIso: NOW });
    expect(entry.authorized).toBe(true);
    // The card carries no repository, and entry did not require one.
    expect(JSON.stringify(c)).not.toContain('repo');
    expect(JSON.stringify(entry)).not.toContain('repo');
  });
});
