import { describe, expect, it } from 'vitest';

import { projectWorkspaceCast, type CastRole, type CastRoleInput } from './relay-stage-cast';
import { layoutStage } from './relay-stage-layout';

/**
 * WHO IS ON THE STAGE.
 *
 * An actor is on the stage because a role is ACTUALLY WORKING and this build
 * can draw it. Those are two questions, and the tests keep them apart, because
 * collapsing them produces the two opposite lies: an under-reported team, or an
 * empty box counted as a sprite.
 */

const role = (r: CastRole, working: boolean): CastRoleInput => ({ role: r, working });

describe('an actor appears because a role is working, never because it exists', () => {
  it('draws nothing, and says why, when no role is working', () => {
    const cast = projectWorkspaceCast({
      roles: [role('coding_agent', false), role('reviewer', false)],
    });
    expect(cast.actors).toEqual([]);
    expect(cast.workingWithoutSprite).toEqual([]);
    expect(cast.emptyReason).toBe('No agent is working. The stage fills when one starts.');
  });

  it('draws nothing when it is told about no roles at all', () => {
    const cast = projectWorkspaceCast({ roles: [] });
    expect(cast.actors).toEqual([]);
    expect(cast.emptyReason).not.toBeNull();
  });

  it('a working coding agent stands exactly where the single-actor constant stood', () => {
    const cast = projectWorkspaceCast({ roles: [role('coding_agent', true)] });
    expect(cast.actors).toHaveLength(1);
    expect(cast.actors[0]).toMatchObject({
      id: 'relay-dog', x: 0.5, depth: 1, width: 1, track: 6, layer: 'actors',
    });
    expect(cast.emptyReason).toBeNull();
  });

  it('a configured-but-idle role is not on the stage', () => {
    const cast = projectWorkspaceCast({
      roles: [role('coding_agent', true), role('reviewer', false)],
    });
    expect(cast.actors.map((a) => a.id)).toEqual(['relay-dog']);
    expect(cast.workingWithoutSprite).toEqual([]);
  });
});

describe('a working role with no sprite is NAMED, never dropped and never placed', () => {
  it('reports a working reviewer instead of drawing an empty box for it', () => {
    // `relay-reviewer` has no CSS, no component and no render branch. Placing
    // it puts an invisible full-width box on the stage and inflates the
    // overflow warning; dropping it makes a working reviewer look like no
    // reviewer. Neither is true, so it is named.
    const cast = projectWorkspaceCast({
      roles: [role('coding_agent', true), role('reviewer', true)],
    });
    expect(cast.actors.map((a) => a.id)).toEqual(['relay-dog']);
    expect(cast.workingWithoutSprite).toEqual(['reviewer']);
  });

  it('an empty stage with work running does NOT claim nobody is working', () => {
    const cast = projectWorkspaceCast({
      roles: [role('coding_agent', false), role('reviewer', true), role('prompt_architect', true)],
    });
    expect(cast.actors).toEqual([]);
    expect(cast.workingWithoutSprite).toEqual(['prompt_architect', 'reviewer']);
    expect(cast.emptyReason).toBe('No agent on this stage has artwork yet. Work is running.');
    expect(cast.emptyReason).not.toContain('No agent is working');
  });

  it('never emits an id the host has no renderer for', () => {
    // The property that matters, asserted against every role the projection
    // accepts rather than against a constant defined beside it.
    const all: CastRole[] = ['prompt_architect', 'coding_agent', 'reviewer'];
    const cast = projectWorkspaceCast({ roles: all.map((r) => role(r, true)) });
    expect(cast.actors.map((a) => a.id)).toEqual(['relay-dog']);
    expect(cast.workingWithoutSprite).toEqual(['prompt_architect', 'reviewer']);
    // EVERY working role is accounted for exactly once — drawn, or named as
    // undrawable. Neither list may quietly swallow one.
    expect(cast.actors.length + cast.workingWithoutSprite.length).toBe(all.length);
  });
});

describe('a role stands in the same place whenever it stands at all', () => {
  it('the coding agent does not move when the reviewer stops', () => {
    // Spacing actors by how many are on stage slid the coding agent from 0.5 to
    // 0.75 when an unrelated role finished — motion nothing in the product
    // performed. Fixed slots leave a gap instead.
    const withReviewer = projectWorkspaceCast({
      roles: [role('coding_agent', true), role('reviewer', true)],
    });
    const without = projectWorkspaceCast({ roles: [role('coding_agent', true)] });
    const dog = (c: { actors: readonly { id: string; x: number }[] }) =>
      c.actors.find((a) => a.id === 'relay-dog')?.x;
    expect(dog(withReviewer)).toBe(0.5);
    expect(dog(without)).toBe(0.5);
  });

  it('the order is stable however the caller lists the roles', () => {
    const a = projectWorkspaceCast({
      roles: [role('reviewer', true), role('prompt_architect', true), role('coding_agent', true)],
    });
    const b = projectWorkspaceCast({
      roles: [role('prompt_architect', true), role('coding_agent', true), role('reviewer', true)],
    });
    expect(a.workingWithoutSprite).toEqual(b.workingWithoutSprite);
    expect(a.actors.map((x) => x.id)).toEqual(b.actors.map((x) => x.id));
  });

  it('WORKING WINS over a duplicate entry, whichever order they arrive in', () => {
    // Last-wins let a stale idle entry erase a working agent, and the stage
    // then stated as a fact that nobody was working.
    const idleLast = projectWorkspaceCast({
      roles: [role('coding_agent', true), role('coding_agent', false)],
    });
    const idleFirst = projectWorkspaceCast({
      roles: [role('coding_agent', false), role('coding_agent', true)],
    });
    expect(idleLast.actors).toHaveLength(1);
    expect(idleFirst.actors).toHaveLength(1);
  });
});

describe('the cast respects the stage it stands on', () => {
  it('fits the real layout engine at desktop AND at the narrowest viewport', () => {
    // The stage reports an overflow rather than drawing sprites on top of each
    // other, and the earlier test checked only 1440 — hiding the narrow case,
    // which is where a stage runs out of dog-widths first.
    const cast = projectWorkspaceCast({
      roles: [role('coding_agent', true), role('reviewer', true), role('prompt_architect', true)],
    });
    for (const viewportWidthPx of [1440, 640, 390]) {
      const layout = layoutStage({ actors: cast.actors, viewportWidthPx });
      expect(layout.overflowing, `overflow at ${String(viewportWidthPx)}px`).toBe(false);
      expect(layout.placements).toHaveLength(1);
    }
  });

  it('an empty cast reaches the layout engine as a genuinely empty stage', () => {
    const cast = projectWorkspaceCast({ roles: [] });
    const layout = layoutStage({ actors: cast.actors, viewportWidthPx: 1440 });
    expect(layout.placements).toEqual([]);
    expect(layout.emptyReason).not.toBeNull();
  });
});
