import { describe, expect, it } from 'vitest';
import {
  WONDERLAND_ACTIVITY_STAGE,
  WONDERLAND_DOG_ACTIVITIES,
} from '../../mission/wonderland/wonderland-dog-stage';
import { RELAY_DOG_ACTIVITIES } from './dog-behavior';

/**
 * THE TWO ACTIVITY LISTS MEET HERE, AND ONLY HERE.
 *
 * `wonderland-dog-stage.ts` restates the Relay Dog activity vocabulary because
 * the mission layer may not import the UI layer — a structural boundary this
 * repository proves by walking the real import graph, and one that includes test
 * files. The dependency is therefore inverted: the domain declares the shape it
 * needs, and this test, which lives on the UI side where consuming the domain is
 * the sanctioned direction, proves the two declarations agree.
 *
 * Without it the restatement would be a copy that drifts. With it, adding an
 * activity to the UI motion system fails here until the world decides what to
 * show for it — which is exactly the moment that decision should be made.
 */
describe('the Wonderland stage adapter tracks the Relay Dog activity vocabulary', () => {
  it('declares exactly the activities the UI motion system raises', () => {
    expect([...WONDERLAND_DOG_ACTIVITIES].sort()).toEqual([...RELAY_DOG_ACTIVITIES].sort());
  });

  it('gives every UI activity a stage', () => {
    for (const activity of RELAY_DOG_ACTIVITIES) {
      expect(
        WONDERLAND_ACTIVITY_STAGE[activity],
        `${activity} has no Wonderland stage`,
      ).toBeDefined();
    }
  });

  it('keeps handoff as an activity the UI can still raise', () => {
    // Removing the Dog's handoff ANIMATION must not remove the handoff EVENT.
    expect(RELAY_DOG_ACTIVITIES).toContain('handoff');
    expect(WONDERLAND_ACTIVITY_STAGE.handoff).toBe('handoff');
  });
});
