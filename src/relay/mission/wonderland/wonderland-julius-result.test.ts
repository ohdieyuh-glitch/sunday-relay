import { describe, expect, it } from 'vitest';

import type { JuliusMissionResultView, JuliusSlotView, JuliusTimelineEntry } from '../julius/julius-runtime-api';
import { JULIUS_DEFAULT_ROLES, type JuliusDefaultRole } from '../julius/julius-runtime';
import {
  WONDERLAND_JULIUS_BILLING_PATHS,
  WONDERLAND_JULIUS_RESULT_FIELDS,
  WONDERLAND_JULIUS_RESULT_SCHEMA_V1,
  WONDERLAND_JULIUS_ROLE_BILLING_FIELDS,
  WONDERLAND_RESULT_WITHHELD,
  projectWonderlandJuliusResult,
  trimHostPaths,
  wonderlandJuliusBilling,
} from './wonderland-julius-result';
import type { WonderlandJuliusBillingRecord, WonderlandJuliusRoleBilling } from './wonderland-julius-result';

/**
 * THE USER RESULT, HELD TO FOUNDER DECISION 5.
 *
 * Every removal has a CONTROL beside it: the same field carrying ordinary text
 * comes through untouched, so no test here can pass because the projection
 * simply blanked everything.
 */

const DIGEST = 'a'.repeat(64);

const view = (over: Partial<JuliusMissionResultView> = {}): JuliusMissionResultView => ({
  runId: 'run:0001',
  missionId: 'mission:alpha',
  state: 'COMPLETED',
  verified: true,
  terminal: true,
  criteria: [
    { criterionId: 'c-1', description: 'The page loads in under a second', requiredEvidenceTypes: ['TEST'],
      satisfied: true, basis: 'EVIDENCE', evidenceIds: ['e-1'] },
    { criterionId: 'c-2', description: 'The mission is complete', requiredEvidenceTypes: [],
      satisfied: true, basis: 'COMPLETION', evidenceIds: [] },
  ],
  deliverables: [
    { evidenceId: 'e-1', taskId: 'task-internal-7', type: 'TEST', safeSummary: '12 tests passed in src/app.test.ts',
      artifactRef: 'artifact:report-1', integrityHash: DIGEST, retained: true, occurredAt: '2026-09-27T10:00:00.000Z' },
  ],
  outstandingFindings: [],
  reviewDecisions: [{ taskId: 'task-internal-7', action: 'ACCEPT', reasonCode: 'ALL_EVIDENCE_PASSED' }],
  cost: { knownUsdMicros: 1_234_567, unknownComponents: 0, complete: true },
  failure: null,
  ...over,
});

const OWNER = { includeCost: true } as const;
const MEMBER = { includeCost: false } as const;

/** Every role, billing not established: what an owner reads when no billing record could be read. */
const NOT_ESTABLISHED = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'].map((role) => ({
  role, billingPath: 'UNKNOWN', apiSpendUsdMicros: null, unestablishedComponents: 1,
}));

describe('the result is Julius\'s, with nothing re-derived', () => {
  it('carries the run, both words for its state, and Julius\'s own verdicts verbatim', () => {
    const result = projectWonderlandJuliusResult(view(), OWNER);
    expect(result.schemaVersion).toBe(WONDERLAND_JULIUS_RESULT_SCHEMA_V1);
    expect(result).toMatchObject({
      runId: 'run:0001', missionId: 'mission:alpha', juliusState: 'COMPLETED', taskState: 'Completed',
      verified: true, terminal: true, tokens: 'UNKNOWN', withheldDetails: 0, failure: null,
    });
    expect(result.criteria.map((c) => [c.criterionId, c.satisfied, c.basis])).toEqual([
      ['c-1', true, 'EVIDENCE'], ['c-2', true, 'COMPLETION'],
    ]);
  });

  it('NEVER re-derives: an unverified run whose criteria all read satisfied stays unverified', () => {
    // Julius decided both halves. A projection that "fixed" either would be a second authority.
    const result = projectWonderlandJuliusResult(view({ state: 'EXECUTING', verified: false, terminal: false }), OWNER);
    expect(result.verified).toBe(false);
    expect(result.criteria.every((c) => c.satisfied)).toBe(true);
    expect(result.taskState).toBe('Implementation');
  });

  it('a READY run is Queued, not verified, not over -- the run the acceptance follows', () => {
    const result = projectWonderlandJuliusResult(view({
      state: 'READY', verified: false, terminal: false, deliverables: [], reviewDecisions: [],
      criteria: [{ criterionId: 'c-2', description: 'The mission is complete', requiredEvidenceTypes: [],
        satisfied: false, basis: 'COMPLETION', evidenceIds: [] }],
      cost: { knownUsdMicros: 0, unknownComponents: 0, complete: true },
    }), OWNER);
    expect(result).toMatchObject({ juliusState: 'READY', taskState: 'Queued', verified: false, terminal: false });
    expect(result.review).toEqual({ verdict: null, reasonCode: null, repairRounds: 0, reReviewedAfterRepair: false, decisions: 0 });
  });

  it('names exactly its fields -- no taskId, no slot, no provider, no model rides along', () => {
    const result = projectWonderlandJuliusResult(view({
      outstandingFindings: [{ findingId: 'f-1', taskId: 'task-internal-7', claim: 'A test is flaky', severity: 'HIGH' }],
    }), OWNER);
    expect(Object.keys(result).sort()).toEqual([...WONDERLAND_JULIUS_RESULT_FIELDS].sort());
    expect(Object.keys(result.deliverables[0]).sort()).toEqual(
      ['artifactRef', 'evidenceId', 'integrityHash', 'occurredAt', 'retained', 'summary', 'type']);
    expect(Object.keys(result.openFindings[0]).sort()).toEqual(['claim', 'findingId', 'severity']);
    expect(JSON.stringify(result)).not.toContain('task-internal-7');
  });

  it('is frozen, all the way down', () => {
    const result = projectWonderlandJuliusResult(view(), OWNER);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.criteria[0])).toBe(true);
    expect(Object.isFrozen(result.deliverables[0])).toBe(true);
    expect(Object.isFrozen(result.cost)).toBe(true);
  });
});

describe('COST: the owner sees it; an ordinary member does not (founder decision 5)', () => {
  it('a member gets no cost at all -- not zero, not a floor, not a field to read', () => {
    const result = projectWonderlandJuliusResult(view(), MEMBER);
    expect(result.cost).toEqual({ visible: false });
    expect(JSON.stringify(result)).not.toContain('1234567');
    expect(JSON.stringify(result)).not.toMatch(/usd/i);
  });

  it('CONTROL: the owner gets the exact figure, and whether it is complete -- and, with no billing record, billing NOT established', () => {
    expect(projectWonderlandJuliusResult(view(), OWNER).cost)
      .toEqual({ visible: true, knownUsdMicros: 1_234_567, unknownComponents: 0, complete: true, billing: NOT_ESTABLISHED });
    expect(projectWonderlandJuliusResult(view({ cost: { knownUsdMicros: 5, unknownComponents: 2, complete: false } }), OWNER).cost)
      .toEqual({ visible: true, knownUsdMicros: 5, unknownComponents: 2, complete: false, billing: NOT_ESTABLISHED });
  });

  it('TOKENS are UNKNOWN for everyone, never a number standing in for one', () => {
    expect(projectWonderlandJuliusResult(view(), OWNER).tokens).toBe('UNKNOWN');
    expect(projectWonderlandJuliusResult(view(), MEMBER).tokens).toBe('UNKNOWN');
  });
});

/* ------------------------------------------------ billing provenance (P10) */

/**
 * WHO PAID, HELD TO THE FOUNDER'S PRIORITY 10 RULE: actual provider API spend
 * and subscription-backed work are different facts, and neither is read off a
 * dollar figure. The settlement facts below are the ones Julius writes on
 * `budget.settled` (`role`, `costBasis`, `usdMicros`, `released`), plus the
 * `billingPath` and `executionUsdMicros` its subscription fix adds.
 */

const slot = (role: JuliusDefaultRole, over: Partial<JuliusSlotView> = {}): JuliusSlotView => ({
  role, workerId: null, providerId: null, requestedModel: null, servedModel: null,
  state: 'NEVER_DISPATCHED', dispatches: 0, lastSequence: null,
  knownUsdMicros: 0, unknownCostComponents: 0, costComplete: true,
  lastFailureClass: null, findingsRaised: 0,
  ...over,
});
/** A slot that dispatched once and is no longer open. */
const ran = (role: JuliusDefaultRole, over: Partial<JuliusSlotView> = {}) => slot(role, { state: 'IDLE', dispatches: 1, ...over });

let sequence = 0;
const settled = (role: string, facts: Record<string, string | number | boolean | null>): JuliusTimelineEntry => {
  sequence += 1;
  return {
    eventId: `event-${sequence}`, sequence, type: 'budget.settled', taskId: `task-${sequence}`, workerId: null,
    occurredAt: '2026-09-28T12:00:00.000Z',
    facts: { reservationId: `reservation-${sequence}`, role, released: false, ...facts },
  };
};

const record = (
  slots: readonly JuliusSlotView[],
  settlements: readonly JuliusTimelineEntry[],
  whole = true,
): WonderlandJuliusBillingRecord => ({ slots, settlements, whole });

const roleOf = (billing: readonly WonderlandJuliusRoleBilling[], role: JuliusDefaultRole) =>
  billing.find((entry) => entry.role === role) as WonderlandJuliusRoleBilling;

/** THE PRIORITY 10 COMPOSITION: OpenAI architect and xAI reviewer on API keys, the coder on the founder's Max plan. */
const P10_SETTLEMENTS = () => [
  settled('PROMPT_ARCHITECT', { costBasis: 'PROVIDER_REPORTED', usdMicros: 12_345, billingPath: 'API_BILLED' }),
  settled('CODING_AGENT', {
    costBasis: 'NOT_APPLICABLE', usdMicros: null, billingPath: 'SUBSCRIPTION',
    // The runtime's notional price for the run, kept for the execution envelope only.
    executionUsdMicros: 608_861,
  }),
  settled('INDEPENDENT_REVIEWER', { costBasis: 'PROVIDER_REPORTED', usdMicros: 2_100, billingPath: 'API_BILLED' }),
];
const P10_SLOTS = () => JULIUS_DEFAULT_ROLES.map((role) => ran(role));

describe('BILLING PROVENANCE: API spend is money, a subscription is not (Priority 10)', () => {
  it('names every C.A.R.D. role, in Julius\'s order, with exactly four fields and a closed word', () => {
    const billing = wonderlandJuliusBilling(record(P10_SLOTS(), P10_SETTLEMENTS()));
    expect(billing.map((entry) => entry.role)).toEqual([...JULIUS_DEFAULT_ROLES]);
    for (const entry of billing) {
      expect(Object.keys(entry).sort()).toEqual([...WONDERLAND_JULIUS_ROLE_BILLING_FIELDS].sort());
      expect(WONDERLAND_JULIUS_BILLING_PATHS).toContain(entry.billingPath);
    }
    expect(WONDERLAND_JULIUS_BILLING_PATHS).toEqual(['API_BILLED', 'SUBSCRIPTION', 'NOT_APPLICABLE', 'UNKNOWN']);
  });

  it('API-BILLED: the architect\'s and reviewer\'s actual charges are projected exactly, per role', () => {
    const billing = wonderlandJuliusBilling(record(P10_SLOTS(), P10_SETTLEMENTS()));
    expect(roleOf(billing, 'PROMPT_ARCHITECT'))
      .toEqual({ role: 'PROMPT_ARCHITECT', billingPath: 'API_BILLED', apiSpendUsdMicros: 12_345, unestablishedComponents: 0 });
    expect(roleOf(billing, 'INDEPENDENT_REVIEWER'))
      .toEqual({ role: 'INDEPENDENT_REVIEWER', billingPath: 'API_BILLED', apiSpendUsdMicros: 2_100, unestablishedComponents: 0 });
  });

  it('API-BILLED from today\'s rows too: a spend basis with a figure and no billingPath is a metered bill', () => {
    // Every settlement written before the billingPath fact existed looks like this (Live Run 3's coder did).
    const billing = wonderlandJuliusBilling(record([ran('CODING_AGENT')], [
      settled('CODING_AGENT', { costBasis: 'PROVIDER_REPORTED', usdMicros: 608_861 }),
    ]));
    expect(roleOf(billing, 'CODING_AGENT'))
      .toEqual({ role: 'CODING_AGENT', billingPath: 'API_BILLED', apiSpendUsdMicros: 608_861, unestablishedComponents: 0 });
  });

  it('API-BILLED sums a role\'s bills, and a bill whose amount was never reported makes it a floor, not a zero', () => {
    const billing = wonderlandJuliusBilling(record([ran('INDEPENDENT_REVIEWER', { dispatches: 3 })], [
      settled('INDEPENDENT_REVIEWER', { costBasis: 'PROVIDER_REPORTED', usdMicros: 1_000, billingPath: 'API_BILLED' }),
      settled('INDEPENDENT_REVIEWER', { costBasis: 'PROVIDER_REPORTED', usdMicros: 500, billingPath: 'API_BILLED' }),
      settled('INDEPENDENT_REVIEWER', { costBasis: 'UNKNOWN', usdMicros: null, billingPath: 'API_BILLED' }),
    ]));
    expect(roleOf(billing, 'INDEPENDENT_REVIEWER'))
      .toEqual({ role: 'INDEPENDENT_REVIEWER', billingPath: 'API_BILLED', apiSpendUsdMicros: 1_500, unestablishedComponents: 1 });
  });

  it('API-BILLED with no amount anyone reported: the path is known, the money is not -- null, never 0', () => {
    const billing = wonderlandJuliusBilling(record([ran('PROMPT_ARCHITECT')], [
      settled('PROMPT_ARCHITECT', { costBasis: 'UNKNOWN', usdMicros: null, billingPath: 'API_BILLED' }),
    ]));
    expect(roleOf(billing, 'PROMPT_ARCHITECT'))
      .toEqual({ role: 'PROMPT_ARCHITECT', billingPath: 'API_BILLED', apiSpendUsdMicros: null, unestablishedComponents: 1 });
  });

  it('SUBSCRIPTION: the coder on the Max plan says SUBSCRIPTION, and no Anthropic API spend is fabricated', () => {
    const result = projectWonderlandJuliusResult(view({
      // Julius's own total, as its summary reads this run: two bills, one unpriced component.
      cost: { knownUsdMicros: 14_445, unknownComponents: 1, complete: false },
    }), { includeCost: true, billing: record(P10_SLOTS(), P10_SETTLEMENTS()) });
    if (!result.cost.visible) throw new Error('the owner must see cost');
    expect(roleOf(result.cost.billing, 'CODING_AGENT'))
      .toEqual({ role: 'CODING_AGENT', billingPath: 'SUBSCRIPTION', apiSpendUsdMicros: null, unestablishedComponents: 0 });
    // The runtime's notional price is never read, so it cannot appear anywhere, in any unit.
    const json = JSON.stringify(result);
    expect(json).not.toContain('608861');
    expect(json).not.toContain('0.608861');
    // API money across the roles is exactly the two API bills.
    const apiSpend = result.cost.billing.reduce((total, entry) => total + (entry.apiSpendUsdMicros ?? 0), 0);
    expect(apiSpend).toBe(12_345 + 2_100);
    // And Julius's own total is carried through untouched, not recomputed here.
    expect(result.cost).toMatchObject({ knownUsdMicros: 14_445, unknownComponents: 1, complete: false });
  });

  it('SUBSCRIPTION is never INFERRED: a no-billing-event basis without Julius\'s billingPath reads NOT_APPLICABLE', () => {
    // NOT_APPLICABLE is Julius's "not billed through a metered account at all" -- a local run is that too.
    const billing = wonderlandJuliusBilling(record([ran('CODING_AGENT')], [
      settled('CODING_AGENT', { costBasis: 'NOT_APPLICABLE', usdMicros: null, executionUsdMicros: 608_861 }),
    ]));
    expect(roleOf(billing, 'CODING_AGENT'))
      .toEqual({ role: 'CODING_AGENT', billingPath: 'NOT_APPLICABLE', apiSpendUsdMicros: null, unestablishedComponents: 0 });
  });

  it('THE PRE-FIX DEFECT, if it were ever written: SUBSCRIPTION beside a provider bill is believed neither way', () => {
    // b618201c's success ending stamped the notional total_cost_usd as PROVIDER_REPORTED.
    const billing = wonderlandJuliusBilling(record([ran('CODING_AGENT')], [
      settled('CODING_AGENT', { costBasis: 'PROVIDER_REPORTED', usdMicros: 608_861, billingPath: 'SUBSCRIPTION' }),
    ]));
    expect(roleOf(billing, 'CODING_AGENT'))
      .toEqual({ role: 'CODING_AGENT', billingPath: 'UNKNOWN', apiSpendUsdMicros: null, unestablishedComponents: 1 });
  });

  it('and the mirror contradiction: API_BILLED beside Julius\'s own "no billing event" is UNKNOWN', () => {
    const billing = wonderlandJuliusBilling(record([ran('CODING_AGENT')], [
      settled('CODING_AGENT', { costBasis: 'NOT_APPLICABLE', usdMicros: null, billingPath: 'API_BILLED' }),
    ]));
    expect(roleOf(billing, 'CODING_AGENT')).toMatchObject({ billingPath: 'UNKNOWN', apiSpendUsdMicros: null });
  });
});

describe('NOT_APPLICABLE is no API bill -- never "$0 of API spend"', () => {
  it('a role that never dispatched is NOT_APPLICABLE with NO amount: null, not 0', () => {
    const billing = wonderlandJuliusBilling(record(JULIUS_DEFAULT_ROLES.map((role) => slot(role)), []));
    for (const entry of billing) {
      expect(entry).toEqual({ role: entry.role, billingPath: 'NOT_APPLICABLE', apiSpendUsdMicros: null, unestablishedComponents: 0 });
    }
    expect(JSON.stringify(billing)).not.toContain('"apiSpendUsdMicros":0');
  });

  it('everything a role dispatched went back unsent (released): no billing event, whatever the row says', () => {
    const billing = wonderlandJuliusBilling(record([ran('CODING_AGENT')], [
      settled('CODING_AGENT', { released: true, usdMicros: null, costBasis: 'UNKNOWN', billingPath: 'API_BILLED' }),
    ]));
    expect(roleOf(billing, 'CODING_AGENT'))
      .toEqual({ role: 'CODING_AGENT', billingPath: 'NOT_APPLICABLE', apiSpendUsdMicros: null, unestablishedComponents: 0 });
  });

  it('a stray figure beside a NOT_APPLICABLE basis is never money', () => {
    const billing = wonderlandJuliusBilling(record([ran('CODING_AGENT')], [
      settled('CODING_AGENT', { costBasis: 'NOT_APPLICABLE', usdMicros: 608_861, billingPath: 'NOT_APPLICABLE' }),
    ]));
    expect(roleOf(billing, 'CODING_AGENT').apiSpendUsdMicros).toBeNull();
    expect(JSON.stringify(billing)).not.toContain('608861');
  });
});

describe('UNKNOWN stays UNKNOWN', () => {
  const coder = (facts: Record<string, string | number | boolean | null>, over: Partial<JuliusSlotView> = {}) =>
    roleOf(wonderlandJuliusBilling(record([ran('CODING_AGENT', over)], [settled('CODING_AGENT', facts)])), 'CODING_AGENT');

  it('a settlement that reported nothing, with no billingPath, is UNKNOWN -- not API spend, not free', () => {
    expect(coder({ costBasis: 'UNKNOWN', usdMicros: null }))
      .toEqual({ role: 'CODING_AGENT', billingPath: 'UNKNOWN', apiSpendUsdMicros: null, unestablishedComponents: 1 });
  });

  it('a harness\'s ESTIMATE is not a bill and establishes nobody\'s billing -- and is never shown', () => {
    const entry = coder({ costBasis: 'ESTIMATED', usdMicros: null, estimatedUsdMicros: 77_777 });
    expect(entry).toMatchObject({ billingPath: 'UNKNOWN', apiSpendUsdMicros: null });
    expect(JSON.stringify(entry)).not.toContain('77777');
  });

  it('a billingPath word nobody defined is UNKNOWN, never agreement -- including the attestation\'s lowercase words', () => {
    for (const word of ['subscripton', 'api_billed', 'subscription', 'MIXED', '']) {
      expect(coder({ costBasis: 'PROVIDER_REPORTED', usdMicros: 5, billingPath: word }).billingPath, word).toBe('UNKNOWN');
    }
  });

  it('a role that dispatched and was never settled is UNKNOWN; one still open is counted as unestablished', () => {
    const never = wonderlandJuliusBilling(record([ran('CODING_AGENT')], []));
    expect(roleOf(never, 'CODING_AGENT')).toEqual({ role: 'CODING_AGENT', billingPath: 'UNKNOWN', apiSpendUsdMicros: null, unestablishedComponents: 1 });
    const open = wonderlandJuliusBilling(record([ran('CODING_AGENT', { state: 'ACTIVE', dispatches: 2 })], [
      settled('CODING_AGENT', { costBasis: 'PROVIDER_REPORTED', usdMicros: 900, billingPath: 'API_BILLED' }),
    ]));
    // The settled path stands; the open dispatch makes its money a floor.
    expect(roleOf(open, 'CODING_AGENT')).toEqual({ role: 'CODING_AGENT', billingPath: 'API_BILLED', apiSpendUsdMicros: 900, unestablishedComponents: 1 });
  });

  it('a role whose settlements disagree has no single path: UNKNOWN, with its API money still exact', () => {
    const billing = wonderlandJuliusBilling(record([ran('CODING_AGENT', { dispatches: 2 })], [
      settled('CODING_AGENT', { costBasis: 'PROVIDER_REPORTED', usdMicros: 4_000, billingPath: 'API_BILLED' }),
      settled('CODING_AGENT', { costBasis: 'NOT_APPLICABLE', usdMicros: null, billingPath: 'SUBSCRIPTION' }),
    ]));
    expect(roleOf(billing, 'CODING_AGENT')).toMatchObject({ billingPath: 'UNKNOWN', apiSpendUsdMicros: 4_000 });
  });

  it('a timeline not read whole, or no record at all, establishes nothing for any role', () => {
    const partial = wonderlandJuliusBilling(record(P10_SLOTS(), P10_SETTLEMENTS(), false));
    expect(partial).toEqual(NOT_ESTABLISHED);
    expect(wonderlandJuliusBilling(null)).toEqual(NOT_ESTABLISHED);
    // A slot Julius did not answer for is not a role that never ran.
    expect(roleOf(wonderlandJuliusBilling(record([], [])), 'CODING_AGENT')).toMatchObject({ billingPath: 'UNKNOWN' });
  });
});

describe('BILLING is the owner\'s: a member gains nothing', () => {
  it('OWNER: the billing sits inside the visible cost', () => {
    const result = projectWonderlandJuliusResult(view(), { includeCost: true, billing: record(P10_SLOTS(), P10_SETTLEMENTS()) });
    expect(result.cost.visible).toBe(true);
    expect(result.cost).toHaveProperty('billing');
  });

  it('MEMBER: even handed a billing record, the cost is exactly { visible: false } -- no path, no amount, no word', () => {
    const result = projectWonderlandJuliusResult(view(), { includeCost: false, billing: record(P10_SLOTS(), P10_SETTLEMENTS()) });
    expect(result.cost).toEqual({ visible: false });
    const json = JSON.stringify(result);
    // UNKNOWN is left out only because `tokens` says it for everyone; the rest are billing's alone.
    for (const word of ['API_BILLED', 'SUBSCRIPTION', 'NOT_APPLICABLE', 'billing', 'apiSpend', 'unestablished', '12345', '2100', '608861']) {
      expect(json, word).not.toContain(word);
    }
  });

  it('nothing but closed words and numbers can reach the projection: a credential in a billing fact goes nowhere', () => {
    const apiKey = 'sk-ant-api03-FAKETESTNOTREAL-aaaaaaaaaaaa'; // relay-boundary:allow-fixture
    const oauth = 'sk-ant-oat01-FAKETESTNOTREAL-bbbbbbbbbbbb'; // relay-boundary:allow-fixture
    const leaky = record([ran('CODING_AGENT')], [
      settled('CODING_AGENT', {
        costBasis: 'PROVIDER_REPORTED', usdMicros: 5, billingPath: apiKey, oauthToken: oauth, reasoning: 'I think the key is',
      }),
    ]);
    expect(roleOf(wonderlandJuliusBilling(leaky), 'CODING_AGENT').billingPath).toBe('UNKNOWN');
    const json = JSON.stringify(projectWonderlandJuliusResult(view(), { includeCost: true, billing: leaky }));
    for (const needle of ['FAKETESTNOTREAL', 'sk-ant', 'oauthToken', 'I think']) expect(json, needle).not.toContain(needle);
  });

  it('is frozen, all the way down', () => {
    const result = projectWonderlandJuliusResult(view(), { includeCost: true, billing: record(P10_SLOTS(), P10_SETTLEMENTS()) });
    if (!result.cost.visible) throw new Error('the owner must see cost');
    expect(Object.isFrozen(result.cost.billing)).toBe(true);
    expect(result.cost.billing.every((entry) => Object.isFrozen(entry))).toBe(true);
  });
});

describe('PRIORITY 9 IS UNCHANGED apart from the one new owner field', () => {
  /** Acceptance #5's created run: READY, never dispatched, $0 and complete (J05). */
  const p9 = () => view({
    state: 'READY', verified: false, terminal: false, deliverables: [], reviewDecisions: [],
    criteria: [{ criterionId: 'created-in-world', description: 'The mission is complete', requiredEvidenceTypes: [],
      satisfied: false, basis: 'COMPLETION', evidenceIds: [] }],
    cost: { knownUsdMicros: 0, unknownComponents: 0, complete: true },
  });
  const p9Billing = () => record(JULIUS_DEFAULT_ROLES.map((role) => slot(role)), []);

  it('the OWNER\'s Priority 9 cost is exactly what acceptance #5 read, plus billing: nothing was billed by anyone', () => {
    const result = projectWonderlandJuliusResult(p9(), { includeCost: true, billing: p9Billing() });
    expect(result.cost).toEqual({
      visible: true, knownUsdMicros: 0, unknownComponents: 0, complete: true,
      billing: JULIUS_DEFAULT_ROLES.map((role) => ({ role, billingPath: 'NOT_APPLICABLE', apiSpendUsdMicros: null, unestablishedComponents: 0 })),
    });
  });

  it('every other field is byte-identical with or without the billing record, for the owner and the member', () => {
    const withBilling = projectWonderlandJuliusResult(p9(), { includeCost: true, billing: p9Billing() });
    const without = projectWonderlandJuliusResult(p9(), { includeCost: true });
    const { cost: costWith, ...restWith } = withBilling;
    const { cost: costWithout, ...restWithout } = without;
    expect(JSON.stringify(restWith)).toBe(JSON.stringify(restWithout));
    const strip = (cost: typeof costWith) => { const { billing: _billing, ...rest } = cost as Record<string, unknown>; return rest; };
    expect(strip(costWith)).toEqual(strip(costWithout));
    // The member's result is the Priority 9 member result, byte for byte.
    expect(JSON.stringify(projectWonderlandJuliusResult(p9(), { includeCost: false, billing: p9Billing() })))
      .toBe(JSON.stringify(projectWonderlandJuliusResult(p9(), MEMBER)));
  });
});

describe('NEVER SHOWN: reasoning, secrets, credentials, host paths', () => {
  it('a finding claim carrying private reasoning is withheld whole, and counted', () => {
    const result = projectWonderlandJuliusResult(view({
      outstandingFindings: [
        { findingId: 'f-1', taskId: 't', severity: 'HIGH', claim: 'My chain of thought: the user probably wants X' },
        { findingId: 'f-2', taskId: 't', severity: 'LOW', claim: 'The header overlaps the logo at 320px' },
      ],
    }), OWNER);
    expect(result.openFindings[0].claim).toBe(WONDERLAND_RESULT_WITHHELD);
    // CONTROL: an ordinary claim is untouched.
    expect(result.openFindings[1].claim).toBe('The header overlaps the logo at 320px');
    expect(result.withheldDetails).toBe(1);
  });

  it('an evidence summary carrying a stack trace is withheld whole', () => {
    const result = projectWonderlandJuliusResult(view({
      deliverables: [{ ...view().deliverables[0], safeSummary: 'TypeError: x is undefined\n    at run (/srv/app/worker.js:10:3)' }],
    }), OWNER);
    expect(result.deliverables[0].summary).toBe(WONDERLAND_RESULT_WITHHELD);
    // CONTROL: the default summary, with its relative path, is shown as written.
    expect(projectWonderlandJuliusResult(view(), OWNER).deliverables[0].summary).toBe('12 tests passed in src/app.test.ts');
  });

  it('secrets are redacted wherever they appear -- the credential itself, not only its label -- and counted', () => {
    const result = projectWonderlandJuliusResult(view({
      deliverables: [{ ...view().deliverables[0], safeSummary: 'Called the API with Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123' }],
      // relay-boundary:allow-fixture
      failure: { reasonCode: 'PROVIDER_ERROR', failureClass: 'OPENAI_API_KEY=sk-FAKETESTNOTREAL-aaaaaaaaaaaa' },
      state: 'FAILED', verified: false,
    }), OWNER);
    const json = JSON.stringify(result);
    expect(json).not.toContain('abcdefghijklmnopqrstuvwxyz0123');
    expect(json).not.toContain('FAKETESTNOTREAL');
    expect(json).toContain('[redacted]');
    // CONTROL: the code beside it is untouched.
    expect(result.failure?.reasonCode).toBe('PROVIDER_ERROR');
    expect(result.withheldDetails).toBe(2);
  });

  it('host paths are cut back to the file name the mission made, and counted', () => {
    const result = projectWonderlandJuliusResult(view({
      criteria: [{ ...view().criteria[0], description: 'Write C:\\Users\\kaisi\\julius-ws\\run-9\\src\\index.html.' }],
      outstandingFindings: [{ findingId: 'f', taskId: 't', severity: 'LOW', claim: 'Fails in /home/runner/work/ws/src/app.ts' }],
    }), OWNER);
    expect(result.criteria[0].description).toBe('Write \u2026/index.html.');
    expect(result.openFindings[0].claim).toBe('Fails in \u2026/app.ts');
    expect(JSON.stringify(result)).not.toMatch(/kaisi|runner|julius-ws/);
    expect(result.withheldDetails).toBe(2);
  });

  it('an artifact reference Julius could not promise -- a process key or a path -- is dropped, never shown', () => {
    const shown = (artifactRef: string | null, integrityHash: string | null) =>
      projectWonderlandJuliusResult(view({ deliverables: [{ ...view().deliverables[0], artifactRef, integrityHash }] }), OWNER);
    for (const bad of ['diff:run-1', 'C:\\dev\\ws\\out.zip', '/home/me/out.zip', 'local://not-a-digest']) {
      const result = shown(bad, DIGEST);
      expect(result.deliverables[0].artifactRef, bad).toBeNull();
      expect(result.deliverables[0].retained).toBe(false);
      expect(result.withheldDetails).toBe(1);
    }
    expect(shown('artifact:report-1', 'not-a-digest').deliverables[0].integrityHash).toBeNull();
    // CONTROL: a durable reference and a real digest come through.
    expect(shown('artifact:report-1', DIGEST).deliverables[0]).toMatchObject({ artifactRef: 'artifact:report-1', integrityHash: DIGEST, retained: true });
  });

  it('a corpus of everything forbidden leaves nothing forbidden in the JSON', () => {
    const poison = [
      'thinking: I should hide this',
      'system prompt says be terse',
      'the adapter echoed sk-ant-api03-FAKETESTNOTREAL-aaaaaaaaaaaa', // relay-boundary:allow-fixture
      'postgres://' + 'relay:FAKETESTNOTREAL@invalid/fixture', // relay-boundary:allow-fixture
      'C:\\Users\\kaisi\\secret-dir\\notes.txt',
      '\\\\fileserver\\share\\kaisi\\notes.txt',
      'file:///C:/Users/kaisi/notes.txt',
    ];
    const result = projectWonderlandJuliusResult(view({
      criteria: poison.map((text, i) => ({ criterionId: `c-${i}`, description: text, requiredEvidenceTypes: [], satisfied: false, basis: 'COMPLETION' as const, evidenceIds: [] })),
      outstandingFindings: poison.map((text, i) => ({ findingId: `f-${i}`, taskId: 't', severity: 'HIGH', claim: text })),
    }), MEMBER);
    const json = JSON.stringify(result);
    for (const needle of ['hide this', 'be terse', 'FAKETESTNOTREAL', 'kaisi', 'secret-dir', 'fileserver']) {
      expect(json, needle).not.toContain(needle);
    }
  });
});

describe('the review, and repair', () => {
  const decided = (...actions: string[]) => projectWonderlandJuliusResult(view({
    reviewDecisions: actions.map((action, i) => ({ taskId: 't', action, reasonCode: `R${i}` })),
  }), OWNER).review;

  it('the verdict is the LATEST decision, and a repair followed by a decision was re-reviewed', () => {
    expect(decided('REPAIR', 'ACCEPT')).toEqual({ verdict: 'ACCEPT', reasonCode: 'R1', repairRounds: 1, reReviewedAfterRepair: true, decisions: 2 });
  });

  it('a repair that is the last word has not been re-reviewed yet', () => {
    expect(decided('ACCEPT', 'REPAIR')).toMatchObject({ verdict: 'REPAIR', repairRounds: 1, reReviewedAfterRepair: false });
    expect(decided('REPAIR', 'ACCEPT', 'REPAIR')).toMatchObject({ repairRounds: 2, reReviewedAfterRepair: false });
  });

  it('no repair is no repair', () => {
    expect(decided('ACCEPT')).toMatchObject({ repairRounds: 0, reReviewedAfterRepair: false });
  });
});

describe('the failure, when there is one', () => {
  it('is the reason Julius named, carried as a code', () => {
    const result = projectWonderlandJuliusResult(view({
      state: 'FAILED', verified: false, failure: { reasonCode: 'TASK_FAILED', failureClass: 'PROVIDER_TIMEOUT' },
    }), MEMBER);
    expect(result.failure).toEqual({ reasonCode: 'TASK_FAILED', failureClass: 'PROVIDER_TIMEOUT' });
    expect(result.taskState).toBe('Failed');
  });

  it('a reason that is really a stack trace is withheld rather than printed as a code', () => {
    const result = projectWonderlandJuliusResult(view({
      state: 'FAILED', verified: false,
      failure: { reasonCode: 'Error: boom\n    at x (C:\\dev\\a.js:1:1)', failureClass: null },
    }), MEMBER);
    expect(result.failure).toEqual({ reasonCode: WONDERLAND_RESULT_WITHHELD, failureClass: null });
  });
});

describe('trimHostPaths', () => {
  it('cuts each kind of host path and counts them', () => {
    expect(trimHostPaths('a C:\\x\\y\\z.txt b /Users/q/r.md c \\\\srv\\share\\s.doc d file:///tmp/t.log'))
      .toEqual({ text: 'a \u2026/z.txt b \u2026/r.md c \u2026/s.doc d \u2026/t.log', trimmed: 4 });
  });

  it('CONTROL: leaves the project\'s own relative paths, URLs and ordinary prose alone', () => {
    for (const text of [
      'edited src/app.ts and docs/readme.md', 'see https://example.com/home/page', 'ratio 3:4 at 10:30',
      'the /api/users route', 'a ~/notes file',
    ]) {
      expect(trimHostPaths(text), text).toEqual({ text, trimmed: 0 });
    }
  });
});
