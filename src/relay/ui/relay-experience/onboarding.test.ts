/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_STORAGE_KEY, EMPTY_DRAFT, ONBOARDING_STEPS, activate, canActivate,
  clearAgentDraft, firstIncompleteStep, isConfigured, loadAgentDraft,
  normaliseName, parseAgentDraft, saveAgentDraft, stepComplete,
  type CompoundAgentDraft,
} from './onboarding';
import { AGENT_OPTIONS } from '../project-settings';

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
