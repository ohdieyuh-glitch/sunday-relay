import { describe, expect, it } from 'vitest';

import {
  FOUNDER_MISSIONS,
  checkFounderMissions,
  freeMissions,
  type FounderMission,
} from './founder-missions';
import { LIVE_REACH_SOURCES } from '../live-reach/live-reach-contracts';
import { EMPTY_LIVE_REACH_SETTINGS, evaluateLiveReach } from '../live-reach';

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
  startsAMission: false,
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

/**
 * THE PACK'S CLAIMS, CHECKED AGAINST THE CODE THEY DESCRIBE.
 *
 * The first version of `fm-1` was fabricated: it asked Relay to post to X and
 * claimed Relay would refuse the publish half by name. Nothing reads a mission
 * objective looking for capabilities, so no mechanism could produce that
 * observation — a made-up expectation, in the document whose entire purpose is
 * to let a founder catch made-up behaviour.
 *
 * Structural validation could not have caught it: the entry was well-formed.
 * Only running the claim against the real decider can, so that is what this
 * does. A pack that asserts a refusal must assert one the product actually
 * makes.
 */
describe('the refusal mission describes a refusal the product actually makes', () => {
  const refusalMission = FOUNDER_MISSIONS.find((m) => m.id === 'fm-1-refusal-is-real');

  it('is still the free, first entry', () => {
    expect(refusalMission).toBeDefined();
    expect(refusalMission?.spends).toBe(false);
    expect(FOUNDER_MISSIONS[0]?.id).toBe('fm-1-refusal-is-real');
  });

  it('REALLY is refused capability_unsupported by the permission model', () => {
    // The exact call the mission tells the founder to make.
    const decision = evaluateLiveReach({
      source: 'x',
      capability: 'post',
      settings: EMPTY_LIVE_REACH_SETTINGS,
      missionAuthorises: true,
      ready: true,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      // Named in the mission's `proves`. If this refusal code ever changes,
      // the pack is telling a founder to look for something they will not see.
      expect(decision.refusal).toBe('capability_unsupported');
      expect(refusalMission?.proves).toContain('capability_unsupported');
    }
  });

  it('is refused even with everything else in its favour', () => {
    // `ready: true` and `missionAuthorises: true` are the most permissive
    // inputs there are. An unsupported capability is refused regardless, which
    // is what makes this a demonstration rather than a configuration accident.
    for (const authorises of [true, false]) {
      for (const ready of [true, false]) {
        const decision = evaluateLiveReach({
          source: 'x', capability: 'post', settings: EMPTY_LIVE_REACH_SETTINGS,
          missionAuthorises: authorises, ready,
        });
        expect(decision.allowed, `${String(authorises)}/${String(ready)}`).toBe(false);
      }
    }
  });

  it('names no source that has a write backend, because none does', () => {
    // The claim in `wouldFailIf` — nine sources modelled, zero write backends.
    // If one ever gains a real action backend, this fails and the pack has to
    // stop saying "anything that reads as partial success is the product
    // lying".
    for (const source of LIVE_REACH_SOURCES) {
      const decision = evaluateLiveReach({
        source, capability: 'post', settings: EMPTY_LIVE_REACH_SETTINGS,
        missionAuthorises: true, ready: true,
      });
      expect(decision.allowed, `${source} accepted a post`).toBe(false);
    }
  });
});

/**
 * A MISSION THAT DOES NOT SAY WHAT IT NEEDS COSTS AN EVENING.
 *
 * The pack listed the architect variables and stopped, so `fm-2` and `fm-3`
 * read as though the architect were the only prerequisite. The pipeline runs
 * architect → coding agent → reviewer, and on a founder machine the defaults
 * name INSTALLED software rather than variables — a fact no `requires` entry
 * expressed. The rule below fired on the real pack when it was added, which is
 * how the gap was proven rather than argued.
 */
describe('an entry that starts a mission says so about the other roles', () => {
  it('rejects a mission that names only the architect', () => {
    const faults = checkFounderMissions([mission({
      startsAMission: true,
      spends: true,
      requires: ['RELAY_PROMPT_ARCHITECT_MODE=live', 'OPENAI_API_KEY'],
    })]);
    expect(faults.map((f) => f.problem)).toContain('mission_omits_the_roles_it_needs');
  });

  it('accepts one that names the role selectors', () => {
    expect(checkFounderMissions([mission({
      startsAMission: true, spends: true,
      requires: ['OPENAI_API_KEY', 'RELAY_ROLE_CODING_AGENT', 'RELAY_ROLE_REVIEWER'],
    })])).toEqual([]);
  });

  it('accepts one that says it runs on a founder machine', () => {
    // The defaults staff the other two roles there, so naming the machine is
    // as honest as naming the variables — and more useful, because what those
    // defaults need is installed software rather than configuration.
    expect(checkFounderMissions([mission({
      startsAMission: true, spends: true,
      requires: ['OPENAI_API_KEY', 'a founder machine with Claude Code and Hermes installed'],
    })])).toEqual([]);
  });

  it('does not ask an entry that starts no mission for any of that', () => {
    // `fm-1` goes through an operator route and starts nothing.
    expect(checkFounderMissions([mission({ startsAMission: false, requires: [] })])).toEqual([]);
  });

  it('holds for the shipped pack', () => {
    for (const entry of FOUNDER_MISSIONS) {
      if (!entry.startsAMission) continue;
      expect(entry.requires.join(' '), entry.id)
        .toMatch(/RELAY_ROLE_CODING_AGENT|RELAY_ROLE_REVIEWER|founder machine/i);
    }
  });
});
