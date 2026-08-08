import { describe, expect, it } from 'vitest';

import { projectWorkspaceCast, type CastRoleInput } from './relay-stage-cast';
import { layoutStage } from './relay-stage-layout';

/**
 * WHO IS ON THE STAGE.
 *
 * The cast was a frozen constant, which could not be wrong and could not be
 * right: it said the same thing whether a reviewer was running or had never
 * been configured. These tests pin the property that replaces it — an actor is
 * on the stage because a role is ACTUALLY WORKING, and for no other reason.
 */

const role = (r: CastRoleInput['role'], working: boolean): CastRoleInput => ({ role: r, working });

describe('an actor appears because a role is working, never because it exists', () => {
  it('draws nothing, and says why, when no role is working', () => {
    // The stage's own rule: it does not helpfully draw a Dog so the space looks
    // used. An empty cast is a real answer.
    const cast = projectWorkspaceCast({
      roles: [role('coding_agent', false), role('reviewer', false)],
    });
    expect(cast.actors).toEqual([]);
    expect(cast.emptyReason).toContain('No agent is working');
  });

  it('draws nothing when it is told about no roles at all', () => {
    const cast = projectWorkspaceCast({ roles: [] });
    expect(cast.actors).toEqual([]);
    expect(cast.emptyReason).not.toBeNull();
  });

  it('a working coding agent stands exactly where the single-actor cast stood', () => {
    // The shipped stage must not move because the cast became a projection.
    const cast = projectWorkspaceCast({ roles: [role('coding_agent', true)] });
    expect(cast.actors).toHaveLength(1);
    expect(cast.actors[0]).toMatchObject({
      id: 'relay-dog', x: 0.5, depth: 1, width: 1, track: 6, layer: 'actors',
    });
    expect(cast.emptyReason).toBeNull();
  });

  it('a configured-but-idle role is not on the stage', () => {
    // Configured, requested, available and WORKING are four different facts.
    // A stage that conflated them would put an actor on it for a reviewer
    // nobody ran.
    const cast = projectWorkspaceCast({
      roles: [role('coding_agent', true), role('reviewer', false), role('prompt_architect', false)],
    });
    expect(cast.actors.map((a) => a.id)).toEqual(['relay-dog']);
  });

  it('every working role gets one actor, in a fixed order', () => {
    const cast = projectWorkspaceCast({
      roles: [
        // Deliberately out of order: the cast must not follow input order, or
        // an actor jumps across the stage when a caller reorders a list.
        role('reviewer', true), role('coding_agent', true), role('prompt_architect', true),
      ],
    });
    expect(cast.actors.map((a) => a.id))
      .toEqual(['relay-architect', 'relay-dog', 'relay-reviewer']);
  });

  it('an actor does not move when an UNRELATED role stops', () => {
    // It does move when the cast size changes — spacing is a function of how
    // many are on stage — but the ORDER is stable, which is what stops the
    // stage inventing movement nothing in the product performed.
    const three = projectWorkspaceCast({
      roles: [role('prompt_architect', true), role('coding_agent', true), role('reviewer', true)],
    });
    const two = projectWorkspaceCast({
      roles: [role('prompt_architect', true), role('coding_agent', true), role('reviewer', false)],
    });
    expect(three.actors.map((a) => a.id).slice(0, 2)).toEqual(two.actors.map((a) => a.id));
  });
});

describe('the cast respects the stage it stands on', () => {
  it('spreads peers evenly and keeps every actor inside the stage', () => {
    const cast = projectWorkspaceCast({
      roles: [role('prompt_architect', true), role('coding_agent', true), role('reviewer', true)],
    });
    const xs = cast.actors.map((a) => a.x);
    // `toBeCloseTo`, because `(1/3) * 2.5` and `5/6` are different doubles and
    // the difference is not a fact about the stage.
    expect(xs).toHaveLength(3);
    for (const [i, expected] of [1 / 6, 3 / 6, 5 / 6].entries()) {
      expect(xs[i]).toBeCloseTo(expected, 12);
    }
    for (const x of xs) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('all three are PEERS: one dog-unit each, one depth, one layer', () => {
    // Nothing in this build produces a subordinate agent, so nothing here is
    // drawn smaller or further back to imply one.
    const cast = projectWorkspaceCast({
      roles: [role('prompt_architect', true), role('coding_agent', true), role('reviewer', true)],
    });
    expect(new Set(cast.actors.map((a) => a.width))).toEqual(new Set([1]));
    expect(new Set(cast.actors.map((a) => a.depth))).toEqual(new Set([1]));
    expect(new Set(cast.actors.map((a) => a.layer))).toEqual(new Set(['actors']));
  });

  it('the real layout engine accepts the full cast without overflowing', () => {
    // The stage reports an overflow rather than drawing sprites on top of each
    // other. Three peers must fit the shipped desktop stage.
    const cast = projectWorkspaceCast({
      roles: [role('prompt_architect', true), role('coding_agent', true), role('reviewer', true)],
    });
    const layout = layoutStage({ actors: cast.actors, viewportWidthPx: 1440 });
    expect(layout.overflowing).toBe(false);
    expect(layout.placements).toHaveLength(3);
    expect(layout.emptyReason).toBeNull();
  });

  it('an empty cast reaches the layout engine as a genuinely empty stage', () => {
    const cast = projectWorkspaceCast({ roles: [] });
    const layout = layoutStage({ actors: cast.actors, viewportWidthPx: 1440 });
    expect(layout.placements).toEqual([]);
    expect(layout.emptyReason).not.toBeNull();
  });
});

describe('no cub and no Leopard are drawn, and that is deliberate', () => {
  it('places no actor the product cannot produce', () => {
    // The stage contract sizes a Leopard at 2 dog-units and a cub at 0.6. A cub
    // is a subordinate or temporarily-expanded agent, and Unchain — the feature
    // that would create one — has no meter, no session lifecycle and no
    // Rechaining execution. Drawing one because the sprite slot exists would
    // assign a meaning nothing produced.
    const everything = projectWorkspaceCast({
      roles: [role('prompt_architect', true), role('coding_agent', true), role('reviewer', true)],
    });
    expect(everything.actors.some((a) => a.width === 0.6)).toBe(false);
    expect(everything.actors.some((a) => a.width === 2)).toBe(false);
    expect(everything.actors.map((a) => a.id)).not.toContain('relay-cub');
    expect(everything.actors.map((a) => a.id)).not.toContain('relay-leopard');
  });
});
