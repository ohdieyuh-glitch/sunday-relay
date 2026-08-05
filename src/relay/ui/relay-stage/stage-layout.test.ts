import { describe, expect, it } from 'vitest';

import {
  CLIPPING_LAYERS, FAR_SCALE, GROUND_HORIZON, RELAY_STAGE_LAYERS,
  RELAY_STAGE_NARROW, RELAY_STAGE_WIDE, layerClips, layoutStage, placeActor,
  stageCapacity, stageShapeFor, type RelayStageActor,
} from './stage-layout';

/**
 * THE STAGE'S LAYOUT, TESTED WITHOUT RENDERING ONE.
 *
 * The band this replaces was `width: 100%` with its scenery clipped to a fixed
 * `128px × 90px`. Ninety pixels at every viewport, one occupant, and anything
 * that left the box was cut. The three properties below are the ones that make
 * the difference real rather than cosmetic.
 */

const actor = (over: Partial<RelayStageActor> = {}): RelayStageActor => ({
  id: 'relay-dog',
  x: 0.5,
  depth: 1,
  width: 1,
  layer: 'actors',
  ...over,
});

/* ------------------------------------------------------------- clipping */

describe('only the backdrop clips', () => {
  it('every other layer is free to exceed the stage box', () => {
    // The whole reason the old box was wrong: an actor mid-jump or
    // mid-transformation was cut by the thing meant to give it room.
    for (const layer of RELAY_STAGE_LAYERS) {
      expect(layerClips(layer), layer).toBe(layer === 'backdrop');
    }
    expect(CLIPPING_LAYERS).toEqual(['backdrop']);
  });

  it('there is a layer for each thing the stage was asked to hold', () => {
    // Dog, wider Leopard, cubs, vehicles → actors. Transformations and
    // effects → effects. A selectable scene → backdrop, with parallax in far.
    expect(RELAY_STAGE_LAYERS).toContain('backdrop');
    expect(RELAY_STAGE_LAYERS).toContain('actors');
    expect(RELAY_STAGE_LAYERS).toContain('effects');
    expect(RELAY_STAGE_LAYERS.indexOf('backdrop'))
      .toBeLessThan(RELAY_STAGE_LAYERS.indexOf('actors'));
    expect(RELAY_STAGE_LAYERS.indexOf('actors'))
      .toBeLessThan(RELAY_STAGE_LAYERS.indexOf('effects'));
  });
});

/* ---------------------------------------------------------------- shape */

describe('the stage grows with the page and always has vertical room', () => {
  it('is an ASPECT with a floor, never a fixed height', () => {
    for (const shape of [RELAY_STAGE_WIDE, RELAY_STAGE_NARROW]) {
      expect(shape.aspectRatio).toBeGreaterThan(0);
      expect(shape.minHeightRem).toBeGreaterThan(0);
    }
  });

  it('a narrow viewport gets a TALLER stage, not a squeezed one', () => {
    const wide = stageShapeFor(1440);
    const narrow = stageShapeFor(390);
    // Lower aspect ratio = proportionally taller.
    expect(narrow.aspectRatio).toBeLessThan(wide.aspectRatio);
  });

  it('the old band could not have held a jump, and this can', () => {
    // 90px was the whole height at any width. At the floor alone the stage is
    // 11rem — 176px at a 16px root — before the aspect adds any more.
    const OLD_BAND_PX = 90;
    const ROOT_PX = 16;
    expect(RELAY_STAGE_NARROW.minHeightRem * ROOT_PX).toBeGreaterThan(OLD_BAND_PX);
    expect(RELAY_STAGE_WIDE.minHeightRem * ROOT_PX).toBeGreaterThan(OLD_BAND_PX);
  });
});

/* ---------------------------------------------------------------- depth */

describe('depth scales and lifts together', () => {
  it('a nearer actor is bigger AND lower on the ground plane', () => {
    const near = placeActor(actor({ depth: 1 }));
    const far = placeActor(actor({ depth: 0 }));
    expect(near.scale).toBeGreaterThan(far.scale);
    expect(near.bottomPercent).toBeLessThan(far.bottomPercent);
  });

  it('the FARTHEST actor stands at the horizon, not in mid-air', () => {
    // Applying scale without lift is how a flat stage betrays that it has no
    // depth model: a small dog floats.
    const far = placeActor(actor({ depth: 0 }));
    expect(far.bottomPercent).toBeCloseTo(GROUND_HORIZON * 100, 5);
    expect(far.scale).toBeCloseTo(FAR_SCALE, 5);
  });

  it('the NEAREST actor stands on the ground line', () => {
    const near = placeActor(actor({ depth: 1 }));
    expect(near.bottomPercent).toBeCloseTo(0, 5);
    expect(near.scale).toBeCloseTo(1, 5);
  });

  it('nearer actors paint later, so a cub in front is in front', () => {
    const { placements } = layoutStage({
      actors: [actor({ id: 'leopard', depth: 0.4 }), actor({ id: 'cub', depth: 0.9 })],
      viewportWidthPx: 1440,
    });
    expect(placements.map((p) => p.id)).toEqual(['leopard', 'cub']);
  });

  it('a nonsense depth or x is clamped, never propagated', () => {
    const wild = placeActor(actor({ depth: 4, x: -3 }));
    expect(wild.leftPercent).toBe(0);
    expect(wild.scale).toBeLessThanOrEqual(1);
    const nan = placeActor(actor({ depth: Number.NaN, x: Number.NaN }));
    expect(Number.isFinite(nan.scale)).toBe(true);
    expect(Number.isFinite(nan.bottomPercent)).toBe(true);
    expect(Number.isFinite(nan.leftPercent)).toBe(true);
  });
});

/* ------------------------------------------------------------- capacity */

describe('the stage never claims room it does not have', () => {
  it('answers how many fit, as a number', () => {
    expect(stageCapacity(RELAY_STAGE_WIDE)).toBeGreaterThan(1);
    expect(stageCapacity(RELAY_STAGE_NARROW)).toBeGreaterThanOrEqual(1);
  });

  it('a narrow stage holds fewer than a wide one', () => {
    expect(stageCapacity(RELAY_STAGE_NARROW))
      .toBeLessThanOrEqual(stageCapacity(RELAY_STAGE_WIDE));
  });

  it('reports an overflowing cast rather than overlapping it silently', () => {
    // Two sprites drawn on top of each other is a surface lying about how much
    // is there. The Leopard is 2 dog units; enough of them exceed any stage.
    const many = Array.from({ length: 12 }, (_, i) => actor({ id: `leopard-${i}`, width: 2 }));
    const layout = layoutStage({ actors: many, viewportWidthPx: 1440 });
    expect(layout.requestedWidth).toBe(24);
    expect(layout.overflowing).toBe(true);
  });

  it('a cast that fits is not reported as overflowing', () => {
    const layout = layoutStage({
      actors: [actor({ id: 'dog' }), actor({ id: 'cub', width: 0.6 })],
      viewportWidthPx: 1440,
    });
    expect(layout.overflowing).toBe(false);
  });

  it('a mixed cast is measured in DOG UNITS, so a wider Leopard costs more', () => {
    const layout = layoutStage({
      actors: [
        actor({ id: 'dog', width: 1 }),
        actor({ id: 'leopard', width: 2 }),
        actor({ id: 'cub-a', width: 0.6 }),
        actor({ id: 'cub-b', width: 0.6 }),
      ],
      viewportWidthPx: 1440,
    });
    expect(layout.requestedWidth).toBeCloseTo(4.2, 5);
  });
});

/* ------------------------------------------------------------ emptiness */

describe('an empty stage is a real state', () => {
  it('says WHY it is empty and invents nobody', () => {
    const layout = layoutStage({ actors: [], viewportWidthPx: 1440 });
    expect(layout.placements).toEqual([]);
    expect(layout.emptyReason).not.toBeNull();
  });

  it('carries the caller’s reason when it has one', () => {
    const layout = layoutStage({
      actors: [], viewportWidthPx: 1440, emptyReason: 'No mission is running.',
    });
    expect(layout.emptyReason).toBe('No mission is running.');
  });

  it('an occupied stage has no empty reason at all', () => {
    const layout = layoutStage({ actors: [actor()], viewportWidthPx: 1440 });
    expect(layout.emptyReason).toBeNull();
  });
});
