import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AQUALA_MARK_SPEC, buildAqualaMarkGeometry } from './aquala-mark';
import { arcPoints, ribbonOutline, strokedRingShape, strokedShape } from './ribbon';

/**
 * THE MARK IS THE BRAND, and it is built from numbers rather than traced, so
 * the numbers are the thing that has to be defended.
 *
 * The ring test below is the important one. An inside-out ribbon produces a
 * FILLED COIN with exactly the same vertex count, the same bounding box and the
 * same part count as a correct annulus — every cheap assertion passes while the
 * logo is wrong. Only sampling the interior catches it, and it shipped once.
 */

const BEVEL_SIZE = AQUALA_MARK_SPEC.depth * 0.14;

/** Greatest distance from the mark's centre reached by any real vertex. */
const maxRadius = (geometry: THREE.BufferGeometry): number => {
  const pos = geometry.getAttribute('position');
  let max = 0;
  for (let i = 0; i < pos.count; i += 1) {
    max = Math.max(max, Math.hypot(pos.getX(i), pos.getY(i)));
  }
  return max;
};

const covers = (geometry: THREE.BufferGeometry, px: number, py: number): boolean => {
  const pos = geometry.getAttribute('position');
  const index = geometry.index;
  const triangles = index ? index.count / 3 : pos.count / 3;
  for (let t = 0; t < triangles; t += 1) {
    const ia = index ? index.getX(t * 3) : t * 3;
    const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    const ax = pos.getX(ia), ay = pos.getY(ia);
    const bx = pos.getX(ib), by = pos.getY(ib);
    const cx = pos.getX(ic), cy = pos.getY(ic);
    // Extrusion side walls project to zero area; they cover nothing in plan.
    if (Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) < 1e-9) continue;
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
  }
  return false;
};

describe('the ribbon builder', () => {
  it('offsets a centreline symmetrically', () => {
    const { left, right } = ribbonOutline([{ x: 0, y: 0 }, { x: 1, y: 0 }], 0.5, false);
    expect(left[0].y).toBeCloseTo(0.5, 6);
    expect(right[0].y).toBeCloseTo(-0.5, 6);
  });

  it('never emits NaN on a duplicated sample', () => {
    const { left } = ribbonOutline([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }], 0.2, false);
    expect(left.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it('refuses a path it cannot offset', () => {
    expect(() => ribbonOutline([{ x: 0, y: 0 }], 0.1, false)).toThrow();
  });

  it('builds a ring as a true annulus, not a filled disc', () => {
    const centre = arcPoints(0, 0, 1, 0, Math.PI * 2, 96).slice(0, -1);
    const shape = strokedRingShape(centre, 0.1);
    const outer = shape.getPoints(0);
    const hole = shape.holes[0].getPoints(0);
    // The OUTLINE must be the outer radius and the HOLE the inner one. Swapping
    // them — which is what the left/right normal convention invites — yields a
    // degenerate shape that triangulates into a solid coin.
    expect(outer[0].length()).toBeGreaterThan(hole[0].length());
    expect(outer[0].length()).toBeCloseTo(1.1, 5);
    expect(hole[0].length()).toBeCloseTo(0.9, 5);
    // And they must wind in opposite directions.
    expect(Math.sign(THREE.ShapeUtils.area(outer))).toBe(-Math.sign(THREE.ShapeUtils.area(hole)));
  });

  it('closes a stroked open path', () => {
    const shape = strokedShape([{ x: -1, y: 0 }, { x: 0, y: 0.5 }, { x: 1, y: 0 }], 0.1);
    expect(shape.getPoints(0).length).toBeGreaterThan(4);
  });
});

describe('the Aquala mark', () => {
  const parts = buildAqualaMarkGeometry();

  it('builds every element of the official mark', () => {
    // Ring, two crescents, bridge, wave. Dropping one is how the mark quietly
    // becomes a generic circle logo.
    expect(parts).toHaveLength(5);
  });

  it('contains no degenerate vertices', () => {
    // Checked with ONE assertion over ~44k vertices. An `expect` per component
    // is 130k assertions and times out — a test slow enough to be disabled is
    // a test that stops guarding anything.
    const bad = parts.flatMap((geometry) => {
      const pos = geometry.getAttribute('position').array;
      for (let i = 0; i < pos.length; i += 1) {
        if (!Number.isFinite(pos[i])) return [i];
      }
      return [];
    });
    expect(bad).toEqual([]);
  });

  it('leaves the ring hollow', () => {
    const ring = parts[0];
    expect(covers(ring, 0, 0), 'the ring must not be a filled coin').toBe(false);
    // ...but the stroke itself is solid where it should be.
    expect(covers(ring, AQUALA_MARK_SPEC.ringOuterRadius - AQUALA_MARK_SPEC.ringStroke / 2, 0)).toBe(true);
  });

  it('sizes the ring to the declared outer radius, plus its bevel', () => {
    // THE BEVEL COUNTS. `ExtrudeGeometry` grows the outline outward by
    // `bevelSize` at the caps, so the built ring measures the spec radius plus
    // that — asserting the bare radius fails against correct geometry.
    parts[0].computeBoundingBox();
    const b = parts[0].boundingBox!;
    const expected = AQUALA_MARK_SPEC.ringOuterRadius + BEVEL_SIZE;
    expect(b.max.x).toBeCloseTo(expected, 3);
    expect(b.max.y).toBeCloseTo(expected, 3);
  });

  it('mirrors the two crescents exactly', () => {
    parts[1].computeBoundingBox();
    parts[2].computeBoundingBox();
    const left = parts[1].boundingBox!;
    const right = parts[2].boundingBox!;
    expect(left.min.x).toBeCloseTo(-right.max.x, 5);
    expect(left.min.y).toBeCloseTo(right.min.y, 5);
  });

  it('keeps every element inside the ring', () => {
    // Measured over ACTUAL VERTICES. A bounding box's corner is not a point on
    // the geometry — the box corner of a circle of radius 1 sits at 1.41, so a
    // corner-based check reports every correct ring as overflowing itself.
    const limit = AQUALA_MARK_SPEC.ringOuterRadius + BEVEL_SIZE + 1e-4;
    for (const geometry of parts) {
      expect(maxRadius(geometry)).toBeLessThanOrEqual(limit);
    }
  });

  it('places the wave below the crescents, without overlap', () => {
    parts[2].computeBoundingBox();
    parts[4].computeBoundingBox();
    expect(parts[4].boundingBox!.max.y).toBeLessThan(parts[2].boundingBox!.min.y);
  });

  it('extrudes with real depth, centred in Z', () => {
    // A flat mark is the failure the founder named explicitly: "no cheap flat
    // PNG appearance". Depth is what makes the camera move worth anything.
    for (const geometry of parts) {
      geometry.computeBoundingBox();
      const b = geometry.boundingBox!;
      expect(b.max.z - b.min.z).toBeGreaterThan(AQUALA_MARK_SPEC.depth * 0.9);
      expect(b.max.z).toBeCloseTo(-b.min.z, 4);
    }
  });
});
