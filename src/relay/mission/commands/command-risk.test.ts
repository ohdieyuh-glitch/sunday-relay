import { describe, expect, it } from 'vitest';

import {
  calculateApprovalRequirement,
  calculateCommandRisk,
  type CommandRiskInput,
} from './command-risk';

const base = (over: Partial<CommandRiskInput> = {}): CommandRiskInput => ({
  intent: 'resume',
  secondaryIntents: [],
  activeWorkTargeted: false,
  partialWorkPresent: false,
  checkpointRequired: false,
  dependencyHighImpact: false,
  reviewInvalidated: false,
  ownershipTransfer: false,
  budgetIncreaseMaterial: false,
  permissionExpansion: false,
  productionWritesRequested: false,
  deploymentRequested: false,
  securityWeakening: false,
  evidenceDiscard: false,
  independentReviewBypass: false,
  hardBudgetBypass: false,
  releaseWithoutApproval: false,
  ...over,
});

describe('deterministic risk calculation (domain-controlled)', () => {
  it.each([
    ['resume a valid waiting task', base(), 'low'],
    ['change priority without dependency consequences', base({ intent: 'change_priority' }), 'low'],
    ['pause active work behind a checkpoint', base({ intent: 'pause', activeWorkTargeted: true, checkpointRequired: true }), 'medium'],
    ['reassign between compatible agents', base({ intent: 'reassign' }), 'medium'],
    ['redirect preserving dependencies', base({ intent: 'redirect' }), 'medium'],
    ['cancel active work WITHOUT partial changes', base({ intent: 'cancel', activeWorkTargeted: true }), 'medium'],
    ['cancel active work WITH partial changes', base({ intent: 'cancel', activeWorkTargeted: true, partialWorkPresent: true }), 'high'],
    ['invalidate an existing review', base({ reviewInvalidated: true }), 'high'],
    ['transfer workspace write ownership', base({ intent: 'reassign', ownershipTransfer: true }), 'high'],
    ['material budget increase', base({ intent: 'change_budget', budgetIncreaseMaterial: true }), 'high'],
    ['permission expansion', base({ intent: 'change_permissions', permissionExpansion: true }), 'high'],
    ['invalidating dependents', base({ intent: 'cancel', dependencyHighImpact: true }), 'high'],
    ['production writes', base({ intent: 'change_permissions', permissionExpansion: true, productionWritesRequested: true }), 'critical'],
    ['deployment', base({ deploymentRequested: true }), 'critical'],
    ['security weakening', base({ securityWeakening: true }), 'critical'],
    ['evidence discard', base({ evidenceDiscard: true }), 'critical'],
    ['independent review bypass', base({ independentReviewBypass: true }), 'critical'],
    ['hard budget bypass', base({ hardBudgetBypass: true }), 'critical'],
    ['release without approval', base({ releaseWithoutApproval: true }), 'critical'],
  ] as const)('%s → %s', (_label, input, expected) => {
    expect(calculateCommandRisk(input).risk).toBe(expected);
  });

  it('every risk result names its deterministic factors', () => {
    const { factors } = calculateCommandRisk(
      base({ intent: 'cancel', activeWorkTargeted: true, partialWorkPresent: true, reviewInvalidated: true }),
    );
    expect(factors).toContain('cancels active work with partial changes');
    expect(factors).toContain('invalidates an existing independent review');
  });
});

describe('human-approval calculation (separate from interpretation and risk)', () => {
  it('low-risk resumes require no approval', () => {
    const input = base();
    const { risk } = calculateCommandRisk(input);
    expect(calculateApprovalRequirement(input, risk).required).toBe(false);
  });

  it.each([
    ['partial-work loss', base({ intent: 'cancel', partialWorkPresent: true })],
    ['review invalidation', base({ reviewInvalidated: true })],
    ['ownership transfer', base({ ownershipTransfer: true })],
    ['material budget increase', base({ budgetIncreaseMaterial: true })],
    ['production permission expansion', base({ productionWritesRequested: true })],
    ['security constraint change', base({ securityWeakening: true })],
    ['deployment', base({ deploymentRequested: true })],
    ['gate bypass', base({ independentReviewBypass: true })],
  ] as const)('%s requires approval', (_label, input) => {
    const { risk } = calculateCommandRisk(input);
    const approval = calculateApprovalRequirement(input, risk);
    expect(approval.required).toBe(true);
    expect(approval.reasons.length).toBeGreaterThan(0);
  });

  it('high risk always requires approval even without a named condition', () => {
    const input = base({ intent: 'cancel', dependencyHighImpact: true });
    const { risk } = calculateCommandRisk(input);
    expect(risk).toBe('high');
    const approval = calculateApprovalRequirement(input, risk);
    expect(approval.required).toBe(true);
    expect(approval.reasons[0]).toMatch(/high risk/u);
  });
});
