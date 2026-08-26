/**
 * THE ORIGINAL RELAY DOG — geometry authored from the founder's reference sheet.
 *
 * The supplied FRONT / SIDE / REAR / THREE-QUARTER renders are the source of
 * truth, and this file is a measured transcription of them, not an impression.
 * Substituting a Shiba, a corgi, a rounded mascot or any generic voxel animal is
 * explicitly out of bounds; so is importing a downloaded model.
 *
 * WHY PROCEDURAL BOXES RATHER THAN A GLB.
 *
 *   - The Dog IS a box cluster. Every form in the reference is an axis-aligned
 *     rectangular prism. Authoring it as boxes is not an approximation of the
 *     reference — it is the reference's actual construction.
 *   - `no-broken-assets.test.tsx` forbids <img> and CSS `url()` on this
 *     frontend. A GLB is a fetched binary with its own failure mode (404,
 *     Draco decoder, CORS) on a page whose whole premise is that it always
 *     renders.
 *   - A box list is ~2 kB of source. A GLB of the same model, plus a Draco or
 *     Meshopt decoder, is hundreds of kB over the wire — on a landing page.
 *   - Proportions stay REVIEWABLE. A founder note like "the ears are too
 *     narrow" is a one-number edit here, and `relay-dog.test.ts` asserts the
 *     ratios against the reference so a later edit cannot silently redraw the
 *     character.
 *
 * UNITS AND FRAME. One unit is one reference block. The Dog stands on y = 0 and
 * faces +Z, matching the FRONT reference. +X is the Dog's own left as the
 * viewer sees it on the right of frame. Height is ~20.7 units to the ear tips.
 *
 * PROPORTIONS, measured off the front reference as fractions of full height:
 * head+ears 40%, torso 33%, legs 26%. The head is the widest part of the
 * silhouette at 0.34 of the total height — the reference's most distinctive
 * property and the one a generic voxel dog always gets wrong by shrinking the
 * head.
 */

/** Which surface a box belongs to. Drives material, not geometry. */
export type DogSurface = 'ivory' | 'visor' | 'eye';

/** An articulated part. Each becomes its own transform node so it can animate. */
export type DogJoint = 'root' | 'head' | 'armLeft' | 'armRight' | 'legLeft' | 'legRight' | 'tail';

export type DogBox = {
  readonly name: string;
  readonly joint: DogJoint;
  readonly surface: DogSurface;
  /** Box centre in Dog space, before the joint pivot is applied. */
  readonly center: readonly [number, number, number];
  readonly size: readonly [number, number, number];
};

/**
 * Joint pivots in Dog space. A joint rotates about its pivot, so the head turns
 * on the neck rather than swinging about the model origin — the difference
 * between a character and a bag of boxes.
 */
export const DOG_PIVOTS: Readonly<Record<DogJoint, readonly [number, number, number]>> = Object.freeze({
  root: [0, 0, 0],
  head: [0, 12.3, 0],
  armLeft: [-3.5, 11.6, 0],
  armRight: [3.5, 11.6, 0],
  legLeft: [-1.6, 5.3, 0],
  legRight: [1.6, 5.3, 0],
  tail: [0, 8.0, -2.2],
});

export const DOG_BOXES: readonly DogBox[] = Object.freeze([
  // ---- head ------------------------------------------------------------
  // The skull is a single wide block, and it is THE WIDEST FORM IN THE
  // SILHOUETTE — wider than the shoulders, wider than the arms at rest. That
  // relationship is the character. The first pass made the arm span exceed the
  // head and the Dog immediately read as a generic blocky humanoid.
  { name: 'skull', joint: 'head', surface: 'ivory', center: [0, 15.3, 0], size: [7.2, 6, 6] },
  // Two tall rectangular ears with a wide notch between them — never rounded,
  // never floppy. Set close to the skull's outer edges as in FRONT and REAR.
  { name: 'earLeft', joint: 'head', surface: 'ivory', center: [-2.45, 19.4, -0.3], size: [1.9, 2.6, 1.8] },
  { name: 'earRight', joint: 'head', surface: 'ivory', center: [2.45, 19.4, -0.3], size: [1.9, 2.6, 1.8] },
  // The visor is a RECESSED horizontal slot, not a painted stripe: it stands
  // proud of the face by a sliver so its opening catches a hard shadow line,
  // which is how the reference reads as an opening rather than a decal.
  { name: 'visor', joint: 'head', surface: 'visor', center: [0, 16.1, 2.94], size: [5.8, 1.8, 0.24] },
  // The visor WRAPS ONTO BOTH SIDE PLANES. This is only visible in the SIDE
  // reference, where a black notch sits at the front of the head — and a
  // front-only visor leaves the profile blank there, which is the single
  // clearest tell that a model was built from the front view alone.
  { name: 'visorWrapLeft', joint: 'head', surface: 'visor', center: [-3.475, 16.1, 2.45], size: [0.26, 1.8, 1.1] },
  { name: 'visorWrapRight', joint: 'head', surface: 'visor', center: [3.475, 16.1, 2.45], size: [0.26, 1.8, 1.1] },
  // Two gold eyes INSIDE the visor, with a gap between them and ivory at both
  // ends of the slot. Their emissive is restrained in `materials.ts`; the
  // reference eyes glow, they do not blow out.
  { name: 'eyeLeft', joint: 'head', surface: 'eye', center: [-1.4, 16.1, 3.02], size: [1.5, 1.2, 0.2] },
  { name: 'eyeRight', joint: 'head', surface: 'eye', center: [1.4, 16.1, 3.02], size: [1.5, 1.2, 0.2] },

  // ---- torso -----------------------------------------------------------
  // Three stacked blocks: wide chest, PINCHED belly, flared hips. The pinch is
  // load-bearing — it is what opens a visible gap between the arm and the body
  // in the reference, while the chest and hips stay in contact so the arms
  // still read as attached.
  { name: 'chest', joint: 'root', surface: 'ivory', center: [0, 10.9, 0], size: [5.2, 3.0, 4.6] },
  { name: 'belly', joint: 'root', surface: 'ivory', center: [0, 8.3, 0], size: [4.0, 2.4, 4.3] },
  { name: 'hips', joint: 'root', surface: 'ivory', center: [0, 6.2, 0], size: [4.8, 2.2, 4.0] },

  // ---- arms ------------------------------------------------------------
  // The upright form from the reference sheet: block arms hanging at the sides
  // with a slightly deeper block hand, hands ending near hip height. Their
  // outer edge stays inside the skull's, preserving the head-is-widest rule.
  //
  // SET FORWARD OF THE TORSO, and with a wider gap than geometry alone needs.
  // Shadow maps are off on this page, so a narrow gap between two similarly-lit
  // ivory faces does not read at all — the first render had arms that vanished
  // into the body. Depth offset gives the silhouette a break that survives flat
  // lighting.
  { name: 'armLeftUpper', joint: 'armLeft', surface: 'ivory', center: [-3.0, 9.6, 0.35], size: [1.15, 4.4, 1.7] },
  { name: 'armLeftHand', joint: 'armLeft', surface: 'ivory', center: [-3.0, 6.9, 0.5], size: [1.2, 1.5, 1.9] },
  { name: 'armRightUpper', joint: 'armRight', surface: 'ivory', center: [3.0, 9.6, 0.35], size: [1.15, 4.4, 1.7] },
  { name: 'armRightHand', joint: 'armRight', surface: 'ivory', center: [3.0, 6.9, 0.5], size: [1.2, 1.5, 1.9] },

  // ---- legs ------------------------------------------------------------
  // One block leg each, with a foot that projects FORWARD only — the reference
  // feet are not centred under the leg, and centring them costs the stance its
  // forward lean.
  { name: 'legLeft', joint: 'legLeft', surface: 'ivory', center: [-1.6, 3.1, 0], size: [2.1, 4.4, 2.3] },
  { name: 'footLeft', joint: 'legLeft', surface: 'ivory', center: [-1.6, 0.45, 0.5], size: [2.3, 0.9, 3.2] },
  { name: 'legRight', joint: 'legRight', surface: 'ivory', center: [1.6, 3.1, 0], size: [2.1, 4.4, 2.3] },
  { name: 'footRight', joint: 'legRight', surface: 'ivory', center: [1.6, 0.45, 0.5], size: [2.3, 0.9, 3.2] },

  // ---- tail ------------------------------------------------------------
  // Three stepping blocks going back and up, tapering. Visible in SIDE and
  // THREE-QUARTER; absent from FRONT, which is the correct occlusion.
  { name: 'tail1', joint: 'tail', surface: 'ivory', center: [0, 8.3, -3.0], size: [1.3, 1.3, 1.5] },
  { name: 'tail2', joint: 'tail', surface: 'ivory', center: [0, 9.2, -3.8], size: [1.15, 1.15, 1.3] },
  { name: 'tail3', joint: 'tail', surface: 'ivory', center: [0, 9.8, -4.6], size: [1.0, 1.0, 1.3] },
]);

/** Overall reference measurements, asserted in `relay-dog.test.ts`. */
export const DOG_METRICS = Object.freeze({
  /** Ground to ear tips. */
  height: 20.7,
  /** Widest point of the silhouette — the skull. */
  headWidth: 7.2,
  /** Front-reference proportions as fractions of `height`. */
  headBlockFraction: 0.4,
  torsoFraction: 0.33,
  legFraction: 0.26,
});
