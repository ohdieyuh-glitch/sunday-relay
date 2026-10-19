/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import { validateMissionConfig } from '../../mission/mission-config';
import { EMPTY_DRAFT, activate, clearAgentDraft, saveAgentDraft, type CompoundAgentDraft } from './onboarding';
import {
  CARD_FIELDS_IN_MISSION_CONFIG, CARD_FIELDS_NOT_IN_MISSION_CONFIG, applyMissionConfigToCard, cardRef,
  missionConfigLabel, projectMissionConfig, unaccountedCardFields,
} from './card-projection';

/**
 * ONE C.A.R.D., MANY PROJECTIONS. The Mission request the bridge validates and
 * the shape the edit surface edits are both derived from the record, and an
 * edit is written back into it. Every value survives the round trip where the
 * legacy shape can carry it, and every value it cannot carry is NAMED.
 */

const T0 = '2026-08-27T00:00:00.000Z';
const card = (): CompoundAgentDraft => activate({
  ...EMPTY_DRAFT,
  name: 'Caesar',
  promptArchitectId: 'architect-sunday-alcatraz',
  codingAgentId: 'coding-claude-code',
  reviewerId: 'reviewer-hermes',
  mode: 'autonomous',
  review: 'security',
  network: 'blocked',
  brainUpdate: 'never_auto',
  reviewerPolicy: 'every_mission',
  spendUsd: 3,
  runtimeMinutes: 90,
  agentCalls: 12,
  reviewCycles: 2,
  repairCycles: null,
  completionRule: 'balanced',
  permissions: ['read', 'merge_pr'],
}, T0);

describe('projection: C.A.R.D. → Mission request', () => {
  beforeEach(() => clearAgentDraft());

  it('carries every mapped value exactly, and the bridge accepts it as-is', () => {
    const c = saveAgentDraft(card(), T0);
    const p = projectMissionConfig(c);
    expect(p.mode).toBe('autonomous');
    expect(p.review).toBe('security');
    expect(p.completionRule).toBe('balanced');
    expect([...p.permissions].sort()).toEqual(['merge_pr', 'read']);
    expect(p.limits).toEqual({ spendUsd: 3, runtimeMinutes: 90, agentCalls: 12, reviewCycles: 2, repairCycles: null });
    expect(p.roles).toEqual({ architect: 'architect-sunday-alcatraz', coding: 'coding-claude-code', reviewer: 'reviewer-hermes' });
    // Identity travels in the request's profile slot, in the bridge's own legal form.
    expect(p.pspId).toBe(cardRef(c));
    expect(p.pspId).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
    expect(p.pspId).toContain('-r1');
    const validated = validateMissionConfig(p);
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.value).toEqual(p);
  });

  it('an unpersisted C.A.R.D. carries no identity — it does not invent one', () => {
    expect(cardRef(card())).toBeNull();
    expect(projectMissionConfig(card()).pspId).toBeNull();
  });

  it('every C.A.R.D. value is either carried or NAMED as not carried — nothing is dropped in silence', () => {
    expect(unaccountedCardFields()).toEqual([]);
    expect([...CARD_FIELDS_NOT_IN_MISSION_CONFIG]).toEqual(['name', 'network', 'brainUpdate', 'reviewerPolicy', 'activatedAt']);
    expect(Object.keys(CARD_FIELDS_IN_MISSION_CONFIG)).toHaveLength(12);
  });

  it('names the C.A.R.D. and its revision, never a default', () => {
    expect(missionConfigLabel(saveAgentDraft(card(), T0))).toBe('C.A.R.D. Caesar · revision 1');
    expect(missionConfigLabel(EMPTY_DRAFT)).toBe('C.A.R.D. UNNAMED · revision 0');
  });
});

describe('hydration: an edit of the Mission-request shape → the C.A.R.D.', () => {
  beforeEach(() => clearAgentDraft());

  it("round-trips: applying a C.A.R.D.'s own projection changes nothing", () => {
    const c = saveAgentDraft(card(), T0);
    expect(applyMissionConfigToCard(c, projectMissionConfig(c))).toEqual(c);
  });

  it('applies what the edit names and keeps what it is silent on — including the values the request cannot carry', () => {
    const c = card();
    const edited = applyMissionConfigToCard(c, {
      mode: 'guided', limits: { spendUsd: null, agentCalls: 1 }, permissions: ['read', 'bogus'],
    });
    expect(edited.mode).toBe('guided');
    expect(edited.spendUsd).toBeNull();      // explicitly cleared = not set
    expect(edited.agentCalls).toBe(1);
    expect(edited.runtimeMinutes).toBe(90);  // silent → kept
    expect(edited.permissions).toEqual(['read']);
    expect(edited.review).toBe('security');
    expect(edited.network).toBe('blocked');
    expect(edited.brainUpdate).toBe('never_auto');
    expect(edited.reviewerPolicy).toBe('every_mission');
    expect(edited.name).toBe('Caesar');
    expect(edited.activatedAt).toBe(T0);
    expect(edited.promptArchitectId).toBe(c.promptArchitectId);
  });

  it('never touches identity — an edit cannot re-assign a C.A.R.D. or rewind its revision', () => {
    const c = saveAgentDraft(card(), T0);
    const edited = applyMissionConfigToCard(c, { pspId: 'other', cardId: 'x', agentId: 'y', revision: 99, participantId: 'ghu-x', mode: 'guided' });
    expect(edited.cardId).toBe(c.cardId);
    expect(edited.agentId).toBe(c.agentId);
    expect(edited.revision).toBe(c.revision);
    expect(edited.participantId).toBe(c.participantId);
    expect(edited.mode).toBe('guided');
  });

  it('ignores values the product does not declare', () => {
    const edited = applyMissionConfigToCard(card(), { mode: 'god', review: 'lol', completionRule: 'x', limits: { spendUsd: -3 } });
    expect(edited.mode).toBe('autonomous');
    expect(edited.review).toBe('security');
    expect(edited.completionRule).toBe('balanced');
    expect(edited.spendUsd).toBe(3);
  });
});
