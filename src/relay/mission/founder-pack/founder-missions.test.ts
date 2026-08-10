import { describe, expect, it } from 'vitest';

import {
  FOUNDER_MISSIONS,
  checkFounderMissions,
  freeMissions,
  type FounderMission,
} from './founder-missions';
import { LIVE_REACH_SOURCES } from '../live-reach/live-reach-contracts';

/**
 * A TEST PACK THAT CANNOT DRIFT FROM THE PRODUCT.
 *
 * The failure this prevents is specific and has a cost: a founder sets aside
 * an hour, opens the pack, and the first mission names a field that was
 * renamed three merges ago. The pack is data for exactly that reason, and this
 * is the check that keeps it honest.
 */

const mission = (over: Partial<FounderMission> = {}): FounderMission => ({
  id: 'fm-x',
  title: 'A mission',
  objective: 'Do the thing.',
  evidenceReferences: [],
  spends: false,
  requires: [],
  proves: 'something',
  wouldFailIf: 'something else',
  ...over,
});

describe('the shipped pack', () => {
  it('has no faults', () => {
    expect(checkFounderMissions()).toEqual([]);
  });

  it('names only sources Relay models', () => {
    for (const entry of FOUNDER_MISSIONS) {
      for (const reference of entry.evidenceReferences) {
        expect(LIVE_REACH_SOURCES, `${entry.id}`).toContain(reference.source);
      }
    }
  });

  it('starts with something that costs nothing', () => {
    // A founder should be able to prove a real property before authorising any
    // spend. If the pack ever opens with a billable mission, that is a product
    // decision somebody should have to make on purpose.
    expect(FOUNDER_MISSIONS[0]?.spends).toBe(false);
    expect(freeMissions().length).toBeGreaterThan(0);
  });

  it('gives every mission a way to catch a fake', () => {
    // The line between a test pack and a demo script.
    for (const entry of FOUNDER_MISSIONS) {
      expect(entry.wouldFailIf.length, entry.id).toBeGreaterThan(20);
    }
  });

  it('says what every spending mission needs', () => {
    for (const entry of FOUNDER_MISSIONS) {
      if (!entry.spends) continue;
      expect(entry.requires.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('includes a mission whose expected outcome is a REFUSAL', () => {
    // A pack of things that succeed proves nothing about honesty. At least one
    // mission has to be one Relay must decline.
    const refusal = FOUNDER_MISSIONS.find((m) => m.proves.toLowerCase().includes('refus'));
    expect(refusal).toBeDefined();
    expect(refusal?.spends).toBe(false);
  });

  it('has unique ids', () => {
    const ids = FOUNDER_MISSIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the check catches what it is for', () => {
  it('rejects a source Relay does not model', () => {
    const faults = checkFounderMissions([mission({
      evidenceReferences: [{ source: 'mastodon' as never, reference: 'https://example.com/a' }],
    })]);
    expect(faults.map((f) => f.problem)).toContain('unknown_source');
  });

  it('rejects a reference that is not an absolute URL', () => {
    // The network policy resolves absolute URLs. A relative one would be
    // refused at retrieval, which is a confusing place to learn about a typo.
    const faults = checkFounderMissions([mission({
      evidenceReferences: [{ source: 'web', reference: '/changelog' }],
    })]);
    expect(faults.map((f) => f.problem)).toContain('reference_not_absolute');
  });

  it('rejects a spending mission that lists no requirement', () => {
    const faults = checkFounderMissions([mission({ spends: true, requires: [] })]);
    expect(faults.map((f) => f.problem)).toContain('spending_mission_requires_nothing');
  });

  it('rejects a mission with no failure condition', () => {
    const faults = checkFounderMissions([mission({ wouldFailIf: '   ' })]);
    expect(faults.map((f) => f.problem)).toContain('no_failure_condition');
  });

  it('rejects duplicate ids', () => {
    const faults = checkFounderMissions([mission(), mission()]);
    expect(faults.map((f) => f.problem)).toContain('duplicate_id');
  });

  it('accepts a well-formed mission', () => {
    expect(checkFounderMissions([mission()])).toEqual([]);
  });
});
