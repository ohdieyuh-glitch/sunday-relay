/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_STORAGE_KEY, EMPTY_DRAFT, ONBOARDING_STEPS, activate, canActivate, cardBelongsTo, cardCurrency,
  cardReference, cardValues, claimCard, clearAgentDraft, firstIncompleteStep, isConfigured, isPersistedCard,
  loadAgentDraft, newCardForAgent, normaliseName, parseAgentDraft, saveAgentDraft, startNewCompoundAgent,
  stepComplete, type CompoundAgentDraft,
} from './onboarding';
import { AGENT_OPTIONS } from '../project-settings';
import { REPOSITORY_PERMISSIONS } from '../../mission/repository-target';

/**
 * The creation flow's gating, completion and durability — the parts that decide
 * whether an incomplete Compound Agent can reach activation, and whether a
 * returning user is recognised. All pure, so none of it needs a renderer.
 */

const complete = (): CompoundAgentDraft => ({
  ...EMPTY_DRAFT,
  name: 'Caesar',
  promptArchitectId: 'architect-sunday-alcatraz',
  codingAgentId: 'coding-claude-code',
  reviewerId: 'reviewer-hermes',
});

describe('the steps', () => {
  it('runs name → architect → coding → reviewer → C.A.R.D. → settings → review → activate', () => {
    expect(ONBOARDING_STEPS.map((s) => s.id)).toEqual([
      'name', 'architect', 'coding', 'reviewer', 'card', 'settings', 'review', 'activate',
    ]);
  });

  it('numbers the steps consecutively from zero', () => {
    ONBOARDING_STEPS.forEach((s, i) => expect(s.index).toBe(i));
  });

  it('calls the configuration surface C.A.R.D., never PSP', () => {
    const text = ONBOARDING_STEPS.map((s) => `${s.eyebrow} ${s.title} ${s.hint}`).join(' ');
    expect(text).toContain('C.A.R.D.');
    expect(text).not.toMatch(/\bPSP\b/);
  });
});

describe('gating', () => {
  it('refuses activation until the agent is genuinely complete', () => {
    // "Never silently manufacture a default Compound Agent simply to make a
    // Mission run" — every slot is load-bearing, so every slot gates.
    expect(canActivate(EMPTY_DRAFT)).toBe(false);
    expect(canActivate({ ...complete(), name: '   ' })).toBe(false);
    expect(canActivate({ ...complete(), promptArchitectId: null })).toBe(false);
    expect(canActivate({ ...complete(), codingAgentId: null })).toBe(false);
    expect(canActivate({ ...complete(), reviewerId: null })).toBe(false);
    expect(canActivate(complete())).toBe(true);
  });

  it('does not move the activation timestamp when the agent is incomplete', () => {
    const attempted = activate(EMPTY_DRAFT, '2026-08-26T00:00:00.000Z');
    expect(attempted.activatedAt).toBeNull();
  });

  it('activates a complete agent', () => {
    expect(activate(complete(), '2026-08-26T00:00:00.000Z').activatedAt)
      .toBe('2026-08-26T00:00:00.000Z');
  });

  it('treats C.A.R.D. and limits as always-valid, never as blockers', () => {
    // They open on a real default rather than an empty state, so they must not
    // trap a user who is happy with it.
    expect(stepComplete(EMPTY_DRAFT, 'card')).toBe(true);
    expect(stepComplete(EMPTY_DRAFT, 'settings')).toBe(true);
  });

  it('resumes at the first incomplete step', () => {
    expect(firstIncompleteStep(EMPTY_DRAFT)).toBe('name');
    expect(firstIncompleteStep({ ...EMPTY_DRAFT, name: 'Caesar' })).toBe('architect');
    expect(firstIncompleteStep(complete())).toBe('activate');
  });
});

describe('names', () => {
  it('collapses whitespace and trims', () => {
    expect(normaliseName('  Caesar   Augustus ')).toBe('Caesar Augustus');
  });
  it('rejects a whitespace-only name', () => {
    expect(normaliseName('   \n ')).toBe('');
  });
  it('bounds the length rather than storing an essay', () => {
    expect(normaliseName('x'.repeat(500))).toHaveLength(40);
  });
});

describe('the slots offer only what the product actually declares', () => {
  it('draws every role from the real AGENT_OPTIONS catalogue', () => {
    // No invented models, providers or reviewers: every id the flow can store
    // must resolve in the product's own catalogue.
    const ids = new Set(AGENT_OPTIONS.map((o) => o.id));
    const draft = complete();
    expect(ids.has(draft.promptArchitectId!)).toBe(true);
    expect(ids.has(draft.codingAgentId!)).toBe(true);
    expect(ids.has(draft.reviewerId!)).toBe(true);
  });

  it('keeps Hermes a first-class reviewer option', () => {
    const hermes = AGENT_OPTIONS.find((o) => o.role === 'reviewer' && o.name === 'Hermes');
    expect(hermes).toBeDefined();
    expect(hermes!.availability).toBe('available');
  });

  it('offers no chat-only model as a coding agent that the product has not declared as one', () => {
    const coding = AGENT_OPTIONS.filter((o) => o.role === 'coding_agent').map((o) => o.name);
    expect(coding).toContain('Claude Code');
    // The slot is coding tools/agents; a bare chat model must not appear here.
    expect(coding).not.toContain('GPT');
    expect(coding).not.toContain('Claude');
  });
});

describe('durability', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('survives a reload — a configured agent makes a RETURNING user', () => {
    // Durable, not session-scoped: session storage would force the whole
    // creation flow again on every visit.
    saveAgentDraft(activate(complete(), '2026-08-26T00:00:00.000Z'));
    const restored = loadAgentDraft();
    expect(restored.name).toBe('Caesar');
    expect(isConfigured(restored)).toBe(true);
  });

  it('writes to a durable store', () => {
    saveAgentDraft(complete());
    expect(localStorage.getItem(AGENT_STORAGE_KEY)).not.toBeNull();
  });

  it('refuses an activation that its own configuration does not earn', () => {
    // A stored record claiming activation while missing a role slot is corrupt,
    // not a returning user. It must fail back rather than let an incomplete
    // agent past the gate.
    const forged = parseAgentDraft({ ...complete(), reviewerId: null, activatedAt: '2026-01-01T00:00:00.000Z' });
    expect(forged.activatedAt).toBeNull();
    expect(isConfigured(forged)).toBe(false);
  });

  it('ignores values the product does not declare', () => {
    const parsed = parseAgentDraft({ mode: 'god_mode', network: 'everything', review: 'lol', spendUsd: -5 });
    expect(parsed.mode).toBe(EMPTY_DRAFT.mode);
    expect(parsed.network).toBe(EMPTY_DRAFT.network);
    expect(parsed.review).toBe(EMPTY_DRAFT.review);
    expect(parsed.spendUsd).toBe(EMPTY_DRAFT.spendUsd);
  });

  it('never throws on corrupt or absent storage', () => {
    localStorage.setItem(AGENT_STORAGE_KEY, '{not json');
    expect(() => loadAgentDraft()).not.toThrow();
    expect(loadAgentDraft()).toEqual(EMPTY_DRAFT);
    clearAgentDraft();
    expect(loadAgentDraft()).toEqual(EMPTY_DRAFT);
  });

  it('parses a non-object into the empty draft rather than crashing', () => {
    for (const junk of [null, 42, 'x', [], undefined]) {
      expect(parseAgentDraft(junk)).toEqual(EMPTY_DRAFT);
    }
  });
});

describe('THE C.A.R.D. RECORD: identity, revisions, binding', () => {
  const T0 = '2026-08-27T00:00:00.000Z';
  const T1 = '2026-08-27T00:01:00.000Z';
  beforeEach(() => {
    localStorage.clear();
  });

  it('mints identity on the first save and starts at revision 1', () => {
    const saved = saveAgentDraft(complete(), T0);
    expect(saved.cardId).toMatch(/^card-/);
    expect(saved.agentId).toMatch(/^agent-/);
    expect(saved.revision).toBe(1);
    expect(saved.createdAt).toBe(T0);
    expect(saved.updatedAt).toBe(T0);
    expect(isPersistedCard(saved)).toBe(true);
    expect(isPersistedCard(EMPTY_DRAFT)).toBe(false);
    expect(loadAgentDraft()).toEqual(saved);
  });

  it('advances the revision only when a configured value changes', () => {
    const first = saveAgentDraft(complete(), T0);
    const same = saveAgentDraft({ ...first }, T1);
    expect(same.revision).toBe(1);
    expect(same.updatedAt).toBe(T0);
    const changed = saveAgentDraft({ ...first, mode: 'guided' }, T1);
    expect(changed.revision).toBe(2);
    expect(changed.updatedAt).toBe(T1);
    expect(changed.cardId).toBe(first.cardId);
    expect(changed.createdAt).toBe(T0);
  });

  it('never lets a stale copy rewind identity or the revision counter', () => {
    const first = saveAgentDraft(complete(), T0);
    saveAgentDraft({ ...first, spendUsd: 1 }, T1); // revision 2
    const fromStale = saveAgentDraft({ ...first, cardId: 'card-forged', agentId: 'agent-forged', revision: 0, runtimeMinutes: 9 }, T1);
    expect(fromStale.cardId).toBe(first.cardId);
    expect(fromStale.agentId).toBe(first.agentId);
    expect(fromStale.revision).toBe(3);
  });

  it('migrates a record saved before identity existed: it becomes an addressable revision 1, stable across reads', () => {
    localStorage.setItem(AGENT_STORAGE_KEY, JSON.stringify({
      name: 'Old', promptArchitectId: 'architect-sunday-alcatraz', codingAgentId: 'coding-claude-code',
      reviewerId: 'reviewer-hermes', mode: 'guided', spendUsd: 12, runtimeMinutes: 30,
    }));
    const migrated = loadAgentDraft(T0);
    expect(migrated.name).toBe('Old');
    expect(migrated.mode).toBe('guided');
    expect(migrated.spendUsd).toBe(12);
    expect(isPersistedCard(migrated)).toBe(true);
    expect(migrated.revision).toBe(1);
    expect(loadAgentDraft(T1)).toEqual(migrated);
  });

  it('keeps a cleared ceiling as NOT SET, never a silent zero', () => {
    saveAgentDraft({ ...complete(), spendUsd: null, agentCalls: 4 }, T0);
    expect(loadAgentDraft().spendUsd).toBeNull();
    expect(loadAgentDraft().agentCalls).toBe(4);
    expect(parseAgentDraft({ spendUsd: -1 }).spendUsd).toBe(EMPTY_DRAFT.spendUsd);
  });

  it('keeps only the permissions the product declares, in ladder order', () => {
    const parsed = parseAgentDraft({ permissions: ['deploy_production', 'read', 'nope', 'read'] }).permissions;
    expect(parsed).toEqual(REPOSITORY_PERMISSIONS.filter((p) => (['read', 'deploy_production'] as string[]).includes(p)));
  });

  describe('binding to the participant', () => {
    it('claims an unbound C.A.R.D. for the participant who signs in — once, and again for the same one', () => {
      saveAgentDraft(complete(), T0);
      expect(claimCard('ghu-1', T1).ok).toBe(true);
      expect(loadAgentDraft().participantId).toBe('ghu-1');
      expect(claimCard('ghu-1', T1).ok).toBe(true);
    });

    it("REFUSES to hand one participant another participant's C.A.R.D., and leaves it untouched", () => {
      saveAgentDraft(complete(), T0);
      claimCard('ghu-1', T0);
      const claim = claimCard('ghu-2', T1);
      expect(claim.ok).toBe(false);
      if (!claim.ok) expect(claim.reason).toBe('wrong_participant');
      expect(loadAgentDraft().participantId).toBe('ghu-1');
      expect(cardBelongsTo(loadAgentDraft(), 'ghu-2')).toBe(false);
      expect(cardBelongsTo(loadAgentDraft(), 'ghu-1')).toBe(true);
    });

    it('has nothing to claim when no C.A.R.D. was ever persisted', () => {
      const claim = claimCard('ghu-1', T0);
      expect(claim.ok).toBe(false);
      if (!claim.ok) expect(claim.reason).toBe('no_card');
      expect(cardBelongsTo(EMPTY_DRAFT, 'ghu-1')).toBe(false);
    });

    it("a save never re-binds: the owner is the store's, not the caller's copy", () => {
      saveAgentDraft(complete(), T0);
      claimCard('ghu-1', T0);
      const saved = saveAgentDraft({ ...loadAgentDraft(), participantId: 'ghu-2', mode: 'guided' }, T1);
      expect(saved.participantId).toBe('ghu-1');
    });
  });

  describe('currency — a consumer holding a reference notices the record moved', () => {
    it('is current while nothing changed, stale once a value changed', () => {
      const card = saveAgentDraft(complete(), T0);
      expect(cardCurrency(cardReference(card)).ok).toBe(true);
      saveAgentDraft({ ...card, mode: 'guided' }, T1);
      const currency = cardCurrency(cardReference(card));
      expect(currency.ok).toBe(false);
      if (!currency.ok) {
        expect(currency.reason).toBe('stale_revision');
        expect(currency.current.revision).toBe(2);
      }
    });

    it('reports a replaced C.A.R.D., a different Compound Agent, and no C.A.R.D. at all', () => {
      const card = saveAgentDraft(complete(), T0);
      newCardForAgent(T1);
      let currency = cardCurrency(cardReference(card));
      expect(!currency.ok && currency.reason).toBe('card_replaced');
      startNewCompoundAgent(T1);
      currency = cardCurrency(cardReference(card));
      expect(!currency.ok && currency.reason).toBe('wrong_agent');
      clearAgentDraft();
      currency = cardCurrency(cardReference(card));
      expect(!currency.ok && currency.reason).toBe('no_card');
    });
  });

  describe('explicit re-configuration — the only ways a C.A.R.D. is configured again', () => {
    it('a NEW C.A.R.D. keeps the Compound Agent, resets its operating profile, and is not yet activated', () => {
      const card = saveAgentDraft(activate({ ...complete(), mode: 'autonomous', spendUsd: 3, network: 'blocked' }, T0), T0);
      claimCard('ghu-1', T0);
      const fresh = newCardForAgent(T1);
      expect(fresh.agentId).toBe(card.agentId);
      expect(fresh.cardId).not.toBe(card.cardId);
      expect(fresh.revision).toBe(1);
      expect(fresh.name).toBe('Caesar');
      expect(fresh.promptArchitectId).toBe(card.promptArchitectId);
      expect(fresh.mode).toBe(EMPTY_DRAFT.mode);
      expect(fresh.spendUsd).toBe(EMPTY_DRAFT.spendUsd);
      expect(fresh.network).toBe(EMPTY_DRAFT.network);
      expect(fresh.activatedAt).toBeNull();
      expect(fresh.participantId).toBe('ghu-1');
      expect(loadAgentDraft()).toEqual(fresh);
    });

    it('a NEW COMPOUND AGENT inherits NOTHING from the first — not its name, roles, C.A.R.D. or identity', () => {
      const card = saveAgentDraft(activate({ ...complete(), mode: 'autonomous', spendUsd: 3 }, T0), T0);
      const fresh = startNewCompoundAgent(T1, 'ghu-9');
      expect(fresh.agentId).not.toBe(card.agentId);
      expect(fresh.cardId).not.toBe(card.cardId);
      expect(cardValues(fresh)).toEqual(cardValues(EMPTY_DRAFT));
      expect(fresh.participantId).toBe('ghu-9');
      expect(fresh.revision).toBe(1);
      expect(canActivate(fresh)).toBe(false);
      expect(isConfigured(fresh)).toBe(false);
      expect(loadAgentDraft()).toEqual(fresh);
    });

    it("a NEW COMPOUND AGENT started before sign-in stays unbound rather than inheriting a stranger's binding", () => {
      saveAgentDraft(complete(), T0);
      claimCard('ghu-1', T0);
      expect(startNewCompoundAgent(T1, null).participantId).toBeNull();
    });
  });
});
