import { describe, expect, it } from 'vitest';

import { WONDERLAND_USAGE_CHANNELS } from './wonderland-usage-meter';
import { WONDERLAND_WORKER_ROLES } from './wonderland-envelope';
import {
  EMPTY_WONDERLAND_USAGE_ACCOUNT,
  WONDERLAND_ATTRIBUTION_CHANNEL,
  WONDERLAND_USAGE_ACCOUNT_FIELDS,
  WONDERLAND_USAGE_ACTIVITY_FIELDS,
  WONDERLAND_USAGE_ATTRIBUTIONS,
  accountWonderlandUsage,
  attributeWonderlandUsage,
  wonderlandAccountByChannel,
  wonderlandChannelUnits,
} from './wonderland-usage-accounting';
import type { WonderlandUsageActivity } from './wonderland-usage-accounting';

/**
 * WHICH METER A UNIT OF WORK BELONGS TO.
 *
 * This is a test about money, so the standard is different: the arithmetic has
 * to close over arbitrary input, and anything that cannot be attributed has to
 * make the whole account say so rather than being quietly absorbed into the
 * channel it probably belonged to.
 */

const activity = (overrides: Partial<WonderlandUsageActivity> = {}): WonderlandUsageActivity => ({
  units: 10,
  orchestratorId: null,
  runId: null,
  workerRole: null,
  soloAgentId: null,
  ...overrides,
});

const orchestrated = (overrides: Partial<WonderlandUsageActivity> = {}) =>
  activity({ orchestratorId: 'julius-1', runId: 'run-1', workerRole: 'CODING_AGENT', ...overrides });

const solo = (overrides: Partial<WonderlandUsageActivity> = {}) =>
  activity({ soloAgentId: 'agent-9', ...overrides });

describe('the vocabulary', () => {
  it('defaults to unattributed, which is the only safe zero', () => {
    // A record nobody filled in has not been attributed to anything; defaulting
    // it to compound would put unexplained spend on a founder's main meter.
    expect(WONDERLAND_USAGE_ATTRIBUTIONS[0]).toBe('unattributed');
    expect(WONDERLAND_ATTRIBUTION_CHANNEL.unattributed).toBeNull();
  });

  it('maps each attribution to at most one channel', () => {
    expect(WONDERLAND_ATTRIBUTION_CHANNEL.compound_orchestrated).toBe('compound_agent');
    expect(WONDERLAND_ATTRIBUTION_CHANNEL.single_agent).toBe('single_agent');
    const channels = Object.values(WONDERLAND_ATTRIBUTION_CHANNEL).filter((c) => c !== null);
    expect(new Set(channels).size).toBe(channels.length);
  });

  it('lists its fields exactly once', () => {
    expect(new Set(WONDERLAND_USAGE_ACTIVITY_FIELDS).size).toBe(
      WONDERLAND_USAGE_ACTIVITY_FIELDS.length,
    );
    expect(new Set(WONDERLAND_USAGE_ACCOUNT_FIELDS).size).toBe(
      WONDERLAND_USAGE_ACCOUNT_FIELDS.length,
    );
  });
});

/* ----------------------------------------------------------- the rule */

describe('attribution follows the orchestrator, not the worker', () => {
  it('puts every worker slot`s spend on the COMPOUND meter', () => {
    // A founder bought a Compound Agent and the slots are what it is made of.
    // The Coding Agent's spend is compound spend even though one model did it.
    for (const workerRole of WONDERLAND_WORKER_ROLES) {
      expect(attributeWonderlandUsage(orchestrated({ workerRole }))).toBe('compound_orchestrated');
    }
  });

  it('puts an agent working alone on the SINGLE meter', () => {
    expect(attributeWonderlandUsage(solo())).toBe('single_agent');
  });

  it('is the same model in both cases, which is why the worker cannot decide it', () => {
    // Identical work, identical role, different orchestration — different
    // meters. Attributing by who DID the work would put it in both.
    const insideJulius = orchestrated({ workerRole: 'CODING_AGENT' });
    const sidekick = solo({ workerRole: 'CODING_AGENT' });
    expect(attributeWonderlandUsage(insideJulius)).toBe('compound_orchestrated');
    expect(attributeWonderlandUsage(sidekick)).toBe('single_agent');
  });

  it('counts a run with no named orchestrator as orchestrated', () => {
    // A run IS an orchestration. The instance id is useful for telling two
    // Julius instances apart, not for deciding that a run happened.
    expect(attributeWonderlandUsage(activity({ runId: 'run-1' }))).toBe('compound_orchestrated');
  });

  it('refuses to attribute a record claiming BOTH', () => {
    // Contradictory, not a preference to resolve. Picking one would be this
    // module choosing which of two claims about someone's money to believe.
    const contradictory = activity({ orchestratorId: 'julius-1', soloAgentId: 'agent-9' });
    expect(attributeWonderlandUsage(contradictory)).toBe('unattributed');
  });

  it('refuses to attribute a worker role with nothing behind it', () => {
    // A slot of something never identified is evidence, not attribution.
    expect(attributeWonderlandUsage(activity({ workerRole: 'CODING_AGENT' }))).toBe('unattributed');
    expect(attributeWonderlandUsage(activity())).toBe('unattributed');
  });
});

/* ----------------------------------------------------------- the total */

describe('totalling', () => {
  it('keeps the two channels separate and never doubles', () => {
    const account = accountWonderlandUsage([
      orchestrated({ units: 30 }),
      orchestrated({ units: 12, workerRole: 'INDEPENDENT_REVIEWER' }),
      solo({ units: 5 }),
    ]);
    expect(account.compoundUnits).toBe(42);
    expect(account.singleUnits).toBe(5);
    expect(account.partial).toBe(false);
    expect(account.activitiesCounted).toBe(3);
  });

  it('closes: every activity lands in exactly one place, over arbitrary input', () => {
    // The property that makes double-counting structurally impossible rather
    // than merely avoided by care.
    const mixed: readonly WonderlandUsageActivity[] = [
      orchestrated({ units: 1 }),
      solo({ units: 2 }),
      activity({ units: 4 }),
      activity({ units: 8, orchestratorId: 'j', soloAgentId: 'a' }),
      activity({ units: -1, runId: 'r' }),
      activity({ units: Number.NaN, runId: 'r' }),
      orchestrated({ units: 16 }),
    ];
    const account = accountWonderlandUsage(mixed);
    expect(account.activitiesCounted + account.activitiesUnattributed + account.activitiesRefused).toBe(
      mixed.length,
    );
    expect(account.compoundUnits + account.singleUnits + account.unattributedUnits).toBe(
      1 + 2 + 4 + 8 + 16,
    );
  });

  it('refuses a negative or non-finite figure rather than clamping it', () => {
    // Clamping silently absorbs whatever produced it, and a meter that quietly
    // absorbs bad arithmetic about money is worse than one that says so.
    const account = accountWonderlandUsage([
      activity({ units: -5, runId: 'run-1' }),
      activity({ units: Number.POSITIVE_INFINITY, runId: 'run-1' }),
      orchestrated({ units: 7 }),
    ]);
    expect(account.activitiesRefused).toBe(2);
    expect(account.compoundUnits).toBe(7);
    expect(account.partial).toBe(true);
  });

  it('reports unattributed units without assigning them anywhere', () => {
    // The tempting move is to put them in green, because orchestration is the
    // common case and the guess is usually right. Usually-right is the wrong
    // standard for a number about money.
    const account = accountWonderlandUsage([orchestrated({ units: 20 }), activity({ units: 9 })]);
    expect(account.compoundUnits).toBe(20);
    expect(account.singleUnits).toBe(0);
    expect(account.unattributedUnits).toBe(9);
    expect(account.partial).toBe(true);
  });

  it('totals nothing to a clean empty account', () => {
    expect(accountWonderlandUsage([])).toEqual(EMPTY_WONDERLAND_USAGE_ACCOUNT);
    expect(accountWonderlandUsage([]).partial).toBe(false);
  });
});

/* --------------------------------------------------- reading it back out */

describe('what a HUD may be told', () => {
  it('gives figures only when the account is complete', () => {
    const complete = accountWonderlandUsage([orchestrated({ units: 3 }), solo({ units: 4 })]);
    expect(wonderlandChannelUnits(complete, 'compound_agent')).toBe(3);
    expect(wonderlandChannelUnits(complete, 'single_agent')).toBe(4);
  });

  it('answers UNKNOWN for both channels when anything was left out', () => {
    // A subtotal that omits unattributed spend is not a smaller true number; it
    // is a number whose meaning depends on what was left out.
    const partial = accountWonderlandUsage([orchestrated({ units: 3 }), activity({ units: 4 })]);
    for (const channel of WONDERLAND_USAGE_CHANNELS) {
      expect(wonderlandChannelUnits(partial, channel)).toBeNull();
    }
    expect(wonderlandAccountByChannel(partial)).toEqual({
      compound_agent: null,
      single_agent: null,
    });
  });

  it('never reports a partial account as a confident zero', () => {
    // The failure this whole module is shaped against: an unattributable spend
    // rendering as an untouched meter.
    const partial = accountWonderlandUsage([activity({ units: 100 })]);
    expect(partial.compoundUnits).toBe(0);
    expect(wonderlandChannelUnits(partial, 'compound_agent')).not.toBe(0);
    expect(wonderlandChannelUnits(partial, 'compound_agent')).toBeNull();
  });

  it('covers both channels in the contract`s own order', () => {
    const account = accountWonderlandUsage([orchestrated({ units: 1 })]);
    expect(Object.keys(wonderlandAccountByChannel(account))).toEqual([...WONDERLAND_USAGE_CHANNELS]);
  });

  it('is frozen', () => {
    const account = accountWonderlandUsage([orchestrated()]);
    expect(Object.isFrozen(account)).toBe(true);
    expect(Object.keys(account).sort()).toEqual([...WONDERLAND_USAGE_ACCOUNT_FIELDS].sort());
  });
});

describe('the shapes this contract has to survive', () => {
  it('gives a second Julius instance its own compound total', () => {
    // Two orchestrators are two compound agents. Not built here, but the
    // contract must not make it impossible.
    const a = accountWonderlandUsage([activity({ units: 5, orchestratorId: 'julius-a', runId: 'r1' })]);
    const b = accountWonderlandUsage([activity({ units: 9, orchestratorId: 'julius-b', runId: 'r2' })]);
    expect(a.compoundUnits).toBe(5);
    expect(b.compoundUnits).toBe(9);
  });

  it('puts an imported sidekick on the single meter without special-casing it', () => {
    expect(attributeWonderlandUsage(activity({ units: 2, soloAgentId: 'imported-sidekick' }))).toBe(
      'single_agent',
    );
  });

  it('names no price, no currency and no provider anywhere in its output', () => {
    // Units are the authority's business. A module that knew what one was worth
    // would be one refactor from inventing a price.
    const text = JSON.stringify(accountWonderlandUsage([orchestrated(), solo()])).toLowerCase();
    for (const leak of ['usd', 'price', 'cost', 'dollar', 'openai', 'anthropic', 'token']) {
      expect(text).not.toContain(leak);
    }
  });
});
