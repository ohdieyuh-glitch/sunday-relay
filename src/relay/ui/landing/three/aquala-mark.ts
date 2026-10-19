import * as THREE from 'three';
import { arcPoints, strokedRingShape, strokedShape, type Point2 } from './ribbon';

/**
 * THE OFFICIAL AQUALA MARK, AS PROCEDURAL 3D GEOMETRY.
 *
 * The founder supplied the Aquala logo as a raster reference and named it the
 * geometric source of truth: a circular ring enclosing two facing crescent arcs
 * joined by a short bridge, above a three-crested wave.
 *
 * It is rebuilt here from measured proportions rather than traced, for three
 * reasons that are all load-bearing:
 *
 *   1. `no-broken-assets.test.tsx` forbids any <img> or CSS `url()` on the
 *      Relay frontend. A traced SVG would have to become an asset or a giant
 *      inline path string; neither can be extruded with clean bevels.
 *   2. A parameterised mark can be TUNED against the reference after it renders.
 *      A traced path can only be re-traced.
 *   3. Extrusion needs a closed outline with correct winding, which is exactly
 *      what these primitives produce and what an auto-traced path usually does
 *      not.
 *
 * MEASUREMENT SPACE. All values are expressed as multiples of the ring's OUTER
 * RADIUS, so the mark is resolution-independent and the numbers below can be
 * checked directly against the reference image by dividing pixel measurements
 * by the ring's outer radius in that image. They are recorded in
 * `AQUALA_MARK_SPEC` and asserted in `aquala-mark.test.ts`, so a later edit that
 * drifts the proportions fails rather than quietly changing the logo.
 */

export type AqualaMarkSpec = {
  /** Ring outer radius. The unit of every other measurement. */
  readonly ringOuterRadius: number;
  /** Ring stroke thickness. */
  readonly ringStroke: number;
  /** Crescent centre offset from the mark's centre, on each axis. */
  readonly crescentOffsetX: number;
  readonly crescentOffsetY: number;
  /** Crescent centreline radius and stroke. */
  readonly crescentRadius: number;
  readonly crescentStroke: number;
  /** Angular half-gap of each crescent, radians — the opening that makes it a C. */
  readonly crescentGap: number;
  /** Vertical position of the wave's centreline. Negative is below centre. */
  readonly waveY: number;
  /** Wave half-span, crest amplitude, stroke, and number of full cycles. */
  readonly waveHalfSpan: number;
  readonly waveAmplitude: number;
  readonly waveStroke: number;
  readonly waveCycles: number;
  /** Extrusion depth, in the same radius units. */
  readonly depth: number;
};

/**
 * Proportions measured from the supplied reference (1219px square; ring outer
 * radius ≈ 366px). Every figure is `pixels / 366`.
 */
export const AQUALA_MARK_SPEC: AqualaMarkSpec = Object.freeze({
  ringOuterRadius: 1,
  ringStroke: 0.12,
  crescentOffsetX: 0.47,
  crescentOffsetY: 0.13,
  crescentRadius: 0.28,
  crescentStroke: 0.1,
  crescentGap: 0.62,
  waveY: -0.4,
  waveHalfSpan: 0.8,
  waveAmplitude: 0.075,
  waveStroke: 0.095,
  waveCycles: 2.5,
  depth: 0.16,
});

/** Ring centreline samples, seam-free (the closing sample is not duplicated). */
function ringCentreline(spec: AqualaMarkSpec, segments = 168): Point2[] {
  const radius = spec.ringOuterRadius - spec.ringStroke / 2;
  const out: Point2[] = [];
  for (let i = 0; i < segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    out.push({ x: Math.cos(t) * radius, y: Math.sin(t) * radius });
  }
  return out;
}

/**
 * The wave centreline. A raised cosine envelope tapers the amplitude to zero at
 * both ends, so the wave meets its flat caps without the abrupt shoulder a bare
 * sine leaves — that shoulder is the single most obvious tell of a rebuilt logo.
 */
function waveCentreline(spec: AqualaMarkSpec, segments = 128): Point2[] {
  const out: Point2[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    const x = -spec.waveHalfSpan + u * spec.waveHalfSpan * 2;
    const envelope = 0.35 + 0.65 * Math.sin(Math.PI * u);
    const y = spec.waveY + Math.sin(u * Math.PI * 2 * spec.waveCycles) * spec.waveAmplitude * envelope;
    out.push({ x, y });
  }
  return out;
}

/**
 * The two crescents plus their bridge.
 *
 * Each crescent is an arc whose gap faces OUTWARD and slightly up, mirrored
 * across the vertical axis, which is what gives the mark its "facing pair"
 * reading rather than reading as two unrelated circles. The bridge is a shallow
 * arc dipping between them.
 */
function crescentCentrelines(spec: AqualaMarkSpec): { left: Point2[]; right: Point2[]; bridge: Point2[] } {
  const gap = spec.crescentGap;
  // Right crescent's opening is centred on +X-and-up (≈ 25°).
  const rightGapCentre = 0.44;
  const right = arcPoints(
    spec.crescentOffsetX,
    spec.crescentOffsetY,
    spec.crescentRadius,
    rightGapCentre + gap,
    rightGapCentre - gap + Math.PI * 2,
    72,
  );
  // Left crescent is the exact mirror, so the pair cannot drift apart.
  const left = right.map((p) => ({ x: -p.x, y: p.y }));

  const bridgeSpan = spec.crescentOffsetX - spec.crescentRadius;
  const bridge: Point2[] = [];
  for (let i = 0; i <= 24; i += 1) {
    const u = i / 24;
    const x = -bridgeSpan + u * bridgeSpan * 2;
    // A shallow downward dip, deepest at the centre.
    const y = spec.crescentOffsetY - spec.crescentRadius * 0.34 * Math.sin(Math.PI * u);
    bridge.push({ x, y });
  }
  return { left, right, bridge };
}

const EXTRUDE = (spec: AqualaMarkSpec): THREE.ExtrudeGeometryOptions => ({
  depth: spec.depth,
  bevelEnabled: true,
  // A bevel this small is what catches the rim light. Without it the extrusion
  // reads as a flat sticker at every camera angle, which is the exact failure
  // the founder called out.
  bevelThickness: spec.depth * 0.18,
  bevelSize: spec.depth * 0.14,
  bevelSegments: 3,
  curveSegments: 12,
});

/**
 * Build the mark's geometry, centred on the origin and centred in Z so it
 * rotates about its own middle rather than swinging about its back face.
 */
export function buildAqualaMarkGeometry(spec: AqualaMarkSpec = AQUALA_MARK_SPEC): THREE.BufferGeometry[] {
  const options = EXTRUDE(spec);
  const { left, right, bridge } = crescentCentrelines(spec);

  const shapes: THREE.Shape[] = [
    strokedRingShape(ringCentreline(spec), spec.ringStroke / 2),
    strokedShape(left, spec.crescentStroke / 2),
    strokedShape(right, spec.crescentStroke / 2),
    strokedShape(bridge, spec.crescentStroke / 2),
    strokedShape(waveCentreline(spec), spec.waveStroke / 2),
  ];

  return shapes.map((shape) => {
    const geometry = new THREE.ExtrudeGeometry(shape, options);
    geometry.translate(0, 0, -spec.depth / 2);
    geometry.computeVertexNormals();
    return geometry;
  });
}
