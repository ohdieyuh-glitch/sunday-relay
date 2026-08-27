import * as THREE from 'three';

/**
 * STROKE GEOMETRY WITHOUT AN SVG LOADER.
 *
 * The Aquala mark is a STROKED drawing — a ring, two arcs, a bridge and a wave,
 * each of which is a centreline with a thickness. Three.js can extrude a filled
 * `THREE.Shape`, but it has no notion of a stroke, and this repository forbids
 * fetched assets outright (`no-broken-assets.test.tsx`: zero <img>, zero
 * `url()`), so an SVG file is not an option even as an input.
 *
 * So a stroke is constructed as a fill: walk the centreline, offset every
 * sample along its normal by ±halfWidth, and close the two offset walks into a
 * single outline. Extruding THAT gives a solid, bevelled, physically-lit stroke
 * with real depth when the camera moves — which is the entire point of the
 * founder's "no cheap flat PNG appearance" requirement.
 *
 * The normal at a sample is the perpendicular of the CENTRED difference of its
 * neighbours, not of the forward segment. Using the forward segment biases every
 * normal half a segment ahead, which shows up as a visible thickness ripple on
 * the wave — the one curve here with rapidly changing curvature.
 */

/** A 2D centreline sample. */
export type Point2 = { x: number; y: number };

/**
 * Offset a centreline into a closed outline of constant width.
 *
 * `closed` joins the last sample back to the first (the outer ring) and
 * produces an annulus; an open path (the wave) is capped flat at both ends.
 */
export function ribbonOutline(
  points: readonly Point2[],
  halfWidth: number,
  closed: boolean,
): { left: Point2[]; right: Point2[] } {
  if (points.length < 2) {
    throw new Error('ribbonOutline needs at least two samples');
  }
  const left: Point2[] = [];
  const right: Point2[] = [];
  const last = points.length - 1;

  for (let i = 0; i <= last; i += 1) {
    // Centred difference. At an open path's ends there is no neighbour on one
    // side, so fall back to the single available segment.
    const prev = i === 0 ? (closed ? points[last] : points[0]) : points[i - 1];
    const next = i === last ? (closed ? points[0] : points[last]) : points[i + 1];
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      // Duplicate samples carry no direction; reuse the previous normal rather
      // than emitting NaN, which would silently destroy the whole outline.
      const fallback = left.length > 0 ? left[left.length - 1] : points[i];
      left.push({ x: fallback.x, y: fallback.y });
      right.push({ x: points[i].x, y: points[i].y });
      continue;
    }
    dx /= length;
    dy /= length;
    // Left normal of a direction (dx, dy) is (-dy, dx).
    const nx = -dy;
    const ny = dx;
    left.push({ x: points[i].x + nx * halfWidth, y: points[i].y + ny * halfWidth });
    right.push({ x: points[i].x - nx * halfWidth, y: points[i].y - ny * halfWidth });
  }
  return { left, right };
}

/**
 * A closed `THREE.Shape` for a stroked open path: up one side, back the other.
 */
export function strokedShape(points: readonly Point2[], halfWidth: number): THREE.Shape {
  const { left, right } = ribbonOutline(points, halfWidth, false);
  const shape = new THREE.Shape();
  shape.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i += 1) shape.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i -= 1) shape.lineTo(right[i].x, right[i].y);
  shape.closePath();
  return shape;
}

/**
 * A closed `THREE.Shape` for a stroked CLOSED path — an annulus. The outer walk
 * is the shape, the inner walk is a hole, which is what makes the ring a ring
 * rather than a filled disc.
 */
export function strokedRingShape(points: readonly Point2[], halfWidth: number): THREE.Shape {
  const { left, right } = ribbonOutline(points, halfWidth, true);

  // WHICH WALK IS THE OUTER ONE IS NOT A FREE CHOICE. `ribbonOutline` offsets by
  // the LEFT normal (-dy, dx). For a counter-clockwise centreline that normal
  // points INWARD — at angle 0 the travel direction is +Y and the left normal is
  // -X — so `left` is the inner walk and `right` is the outer one.
  //
  // Taking `left` as the outline (the intuitive reading of the name) builds a
  // disc of the INNER radius with a hole of the OUTER radius: a degenerate
  // shape that triangulates to a filled coin. The first CPU silhouette of the
  // Aquala mark showed exactly that, and it is invisible in any check that only
  // asserts vertex counts or bounding boxes — both are identical either way.
  const outerWalk = right;
  const innerWalk = left;

  const shape = new THREE.Shape();
  shape.moveTo(outerWalk[0].x, outerWalk[0].y);
  for (let i = 1; i < outerWalk.length; i += 1) shape.lineTo(outerWalk[i].x, outerWalk[i].y);
  shape.closePath();

  // The hole is walked in reverse so it winds opposite the outline.
  const hole = new THREE.Path();
  hole.moveTo(innerWalk[innerWalk.length - 1].x, innerWalk[innerWalk.length - 1].y);
  for (let i = innerWalk.length - 2; i >= 0; i -= 1) hole.lineTo(innerWalk[i].x, innerWalk[i].y);
  hole.closePath();
  shape.holes.push(hole);
  return shape;
}

/** Sample a circular arc centreline. Angles in radians, CCW from +X. */
export function arcPoints(
  cx: number,
  cy: number,
  radius: number,
  from: number,
  to: number,
  segments: number,
): Point2[] {
  const out: Point2[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = from + ((to - from) * i) / segments;
    out.push({ x: cx + Math.cos(t) * radius, y: cy + Math.sin(t) * radius });
  }
  return out;
}
