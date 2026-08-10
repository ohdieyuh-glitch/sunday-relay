import { describe, expect, it } from 'vitest';

import { createMissionRegistry } from './mission';
import { FOUNDER_MISSIONS } from '../src/relay/mission/founder-pack/founder-missions';

/**
 * THE PACK'S CLAIMS ABOUT THE BRIDGE, RUN AGAINST THE BRIDGE.
 *
 * The domain-side test already runs the pack's refusal claim against
 * `evaluateLiveReach`. It cannot run this one: the mission registry lives in
 * the bridge, and `src/relay/mission` may not import it. So the claim that
 * needs the registry is checked here, on the side that owns it.
 *
 * THIS EXISTS BECAUSE THE PACK HAS BEEN WRONG TWICE, both times fluently:
 *
 *   `fm-1` promised a refusal no mechanism produces — Relay does not read a
 *   mission objective looking for capabilities.
 *
 *   `fm-5` named an IDEMPOTENCY KEY. Mission start takes `missionId`,
 *   `objective` and `evidenceReferences`; idempotency keys exist on the
 *   Reviewer and hosted-coding routes and nowhere near here. The substance was
 *   right and the mechanism was invented, which is the harder kind to notice —
 *   the entry reads as true because it nearly is.
 *
 * Structural validation caught neither, because both entries were well-formed.
 * Only running the claim can.
 */

const registry = () => createMissionRegistry({
  fusionBaseUrl: null,
  sundayMode: 'fast',
  claudeMode: 'fake',
  confirmLive: true,
  // No architect configured: the mission is refused at preflight, which is all
  // this test wants. It asserts the DISPATCH decision, not a completed run, so
  // nothing here contacts anything or spends anything.
  architectEnv: {},
  hermesEnv: {},
  now: () => '2026-08-10T12:00:00.000Z',
});

describe('the pack says idempotency is keyed on the mission id', () => {
  const mission = FOUNDER_MISSIONS.find((m) => m.id === 'fm-5-the-same-mission-twice');

  it('is still in the pack, and still says mission id rather than a key', () => {
    expect(mission).toBeDefined();
    expect(mission?.proves).toContain('MISSION ID');
    // The wrong mechanism must not come back.
    expect(mission?.proves).not.toMatch(/idempotency key/i);
  });

  it('REALLY returns the first run when the same mission id starts twice', () => {
    /**
     * THE FIRST VERSION OF THIS TEST WAS VACUOUS, while checking a fabrication.
     *
     * It compared `second.missionId` to `first.missionId`. `LiveMissionUpdate`
     * carries no `missionId` — both were `undefined`, so the assertion passed
     * without touching the behaviour. I made the same class of mistake inside
     * the fix for it: naming a field that does not exist, fluently.
     *
     * So the discriminator is now the revision, which is real and derived from
     * the id and the ORIGINAL request — and it is asserted DEFINED first, so
     * this can never pass by comparing two absences again.
     */
    const reg = registry();
    const first = reg.start({ missionId: 'fm-5-probe', objective: 'Add the guard.' });
    const second = reg.start({ missionId: 'fm-5-probe', objective: 'Something else entirely.' });

    expect(first.missionRevision).toBeDefined();
    expect(second.missionRevision).toBeDefined();
    // The same run, not a new one. A second dispatch would have rederived the
    // revision from the second objective.
    expect(second.missionRevision).toBe(first.missionRevision);
  });

  it('does not adopt the second call’s objective, which is what a restart would do', () => {
    const reg = registry();
    reg.start({ missionId: 'fm-5-objective', objective: 'The first objective.' });
    const second = reg.start({ missionId: 'fm-5-objective', objective: 'The second objective.' });
    expect(JSON.stringify(second)).not.toContain('The second objective');
  });

  it('treats a different mission id as a different mission', () => {
    // The other direction: idempotency that swallowed distinct missions would
    // be worse than none.
    const reg = registry();
    const a = reg.start({ missionId: 'fm-5-a', objective: 'Add the guard.' });
    const b = reg.start({ missionId: 'fm-5-b', objective: 'Add the guard.' });
    expect(a.missionRevision).toBeDefined();
    expect(b.missionRevision).toBeDefined();
    // Same objective, different id — so the revision must still differ, which
    // is what proves the id is part of it.
    expect(b.missionRevision).not.toBe(a.missionRevision);
  });

  it('warns that the record is in memory, because it is', () => {
    // A fresh registry is a restarted bridge. The pack says so rather than
    // letting a founder discover it during a retry that spent twice.
    const before = registry();
    before.start({ missionId: 'fm-5-restart', objective: 'Add the guard.' });
    expect(registry().get('fm-5-restart')).toBeNull();
    expect(mission?.wouldFailIf).toContain('in memory');
  });
});
