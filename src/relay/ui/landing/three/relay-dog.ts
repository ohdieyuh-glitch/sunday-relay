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
 * viewer sees it on the right of frame. Height is ~21 units to the ear tips.
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
  head: [0, 13.8, 0],
  armLeft: [-3.85, 13.2, 0],
  armRight: [3.85, 13.2, 0],
  legLeft: [-1.75, 5.7, 0],
  legRight: [1.75, 5.7, 0],
  tail: [2.6, 8.6, -2.0],
});

/**
 * MEASURED OFF THE SKIN SHEET, part by part. Proportions as fractions of the
 * 21.2-unit height: head block 35%, torso 38%, legs 27%; head width 34%; arm
 * span 42%.
 *
 * Three properties here were WRONG in the previous pass and are the reason the
 * character did not read as itself:
 *
 *   1. THE TORSO WIDENS DOWNWARD. It is narrow at the shoulders and broadest at
 *      the hip, finishing in a skirt — the silhouette the sheet calls the RELAY
 *      OG FORM. The previous model had a broad chest tapering to narrow hips,
 *      which is the opposite shape and made the Dog read as a generic humanoid.
 *   2. THE ARMS ARE WIDER THAN THE HEAD. The rear view is unambiguous: the arm
 *      columns sit outside the head's silhouette. An earlier rule forced them
 *      inside it, which pinned them against the body.
 *   3. THE HEAD HAS A CHAMFERED TOP. Its top slab is stepped in from the main
 *      mass before the ears rise, visible in every supplied view.
 */
export const DOG_BOXES: readonly DogBox[] = Object.freeze([
  // ---- head ------------------------------------------------------------
  // Built as a FRAME around a real aperture so the visor is a cavity with
  // depth, not a panel — and so no thin side stripe appears at three-quarter.
  // Extends BELOW the pivot, into the torso. The head pivots at the shoulder
  // line, so a head whose bottom face sits exactly on that line opens a hole
  // through the neck the moment it turns — which is what the first build did.
  // The overlap is hidden inside the shoulders at every angle the rig allows.
  { name: 'headBelow', joint: 'head', surface: 'ivory', center: [0, 14.15, 0], size: [7.2, 2.3, 6] },
  { name: 'headAbove', joint: 'head', surface: 'ivory', center: [0, 17.85, 0], size: [7.2, 0.7, 6] },
  { name: 'headLeft', joint: 'head', surface: 'ivory', center: [-3.2, 16.4, 0], size: [0.8, 2.2, 6] },
  { name: 'headRight', joint: 'head', surface: 'ivory', center: [3.2, 16.4, 0], size: [0.8, 2.2, 6] },
  { name: 'headBack', joint: 'head', surface: 'ivory', center: [0, 16.4, -0.4], size: [5.6, 2.2, 5.2] },
  // The stepped top slab, narrower than the main mass.
  { name: 'headTop', joint: 'head', surface: 'ivory', center: [0, 18.75, 0], size: [6.4, 1.1, 5.4] },
  // Two upright rectangular ears rising from the stepped top, wide notch between.
  { name: 'earLeft', joint: 'head', surface: 'ivory', center: [-2.15, 20.25, -0.1], size: [1.5, 1.9, 1.6] },
  { name: 'earRight', joint: 'head', surface: 'ivory', center: [2.15, 20.25, -0.1], size: [1.5, 1.9, 1.6] },
  // The cavity's black floor, set 0.7 back from the face plane.
  { name: 'visorPlate', joint: 'head', surface: 'visor', center: [0, 16.4, 2.3], size: [5.6, 2.2, 0.16] },
  // Two small square gold eyes deep in the opening, generous black around them.
  { name: 'eyeLeft', joint: 'head', surface: 'eye', center: [-1.0, 16.4, 2.48], size: [1.0, 1.0, 0.22] },
  { name: 'eyeRight', joint: 'head', surface: 'eye', center: [1.0, 16.4, 2.48], size: [1.0, 1.0, 0.22] },

  // ---- torso: narrow shoulders widening into the skirt ------------------
  { name: 'shoulders', joint: 'root', surface: 'ivory', center: [0, 13.0, 0], size: [5.4, 1.6, 4.3] },
  // A NECK. The head is wider than the shoulders and pivots at their top edge,
  // so any turn swings its corners clear and opens a hole straight through the
  // character. This block sits inside both and fills that gap at every angle
  // the look layer can reach.
  { name: 'neck', joint: 'root', surface: 'ivory', center: [0, 13.4, 0], size: [4.6, 1.8, 4.0] },
  { name: 'chest', joint: 'root', surface: 'ivory', center: [0, 11.3, 0], size: [5.9, 1.8, 4.5] },
  { name: 'lowerTorso', joint: 'root', surface: 'ivory', center: [0, 9.5, 0], size: [6.1, 1.8, 4.6] },
  // The widest point of the body — the skirt.
  { name: 'skirt', joint: 'root', surface: 'ivory', center: [0, 7.55, 0], size: [6.4, 2.1, 4.7] },
  // A chamfer back in before the legs, as the rear view shows.
  { name: 'hipChamfer', joint: 'root', surface: 'ivory', center: [0, 6.1, 0], size: [5.6, 0.8, 4.2] },

  // ---- arms: outside the head's silhouette, gapped at the shoulder ------
  { name: 'armLeftUpper', joint: 'armLeft', surface: 'ivory', center: [-3.85, 11.0, 0.15], size: [1.25, 4.2, 1.7] },
  { name: 'armLeftHand', joint: 'armLeft', surface: 'ivory', center: [-3.85, 8.1, 0.35], size: [1.4, 1.6, 1.9] },
  { name: 'armRightUpper', joint: 'armRight', surface: 'ivory', center: [3.85, 11.0, 0.15], size: [1.25, 4.2, 1.7] },
  { name: 'armRightHand', joint: 'armRight', surface: 'ivory', center: [3.85, 8.1, 0.35], size: [1.4, 1.6, 1.9] },

  // ---- legs: straight blocks, substantial feet projecting forward -------
  { name: 'legLeft', joint: 'legLeft', surface: 'ivory', center: [-1.75, 3.35, 0], size: [2.2, 4.7, 2.4] },
  { name: 'footLeft', joint: 'legLeft', surface: 'ivory', center: [-1.75, 0.5, 0.6], size: [2.4, 1.0, 3.4] },
  { name: 'legRight', joint: 'legRight', surface: 'ivory', center: [1.75, 3.35, 0], size: [2.2, 4.7, 2.4] },
  { name: 'footRight', joint: 'legRight', surface: 'ivory', center: [1.75, 0.5, 0.6], size: [2.4, 1.0, 3.4] },

  // ---- tail: stepped, out to the Dog's right at hip height --------------
  // The sheet puts it beside the right hand, stepping outward and down — not
  // tucked behind the spine, where it vanishes from every view that matters.
  { name: 'tail1', joint: 'tail', surface: 'ivory', center: [3.2, 8.5, -2.6], size: [1.5, 1.5, 1.6] },
  { name: 'tail2', joint: 'tail', surface: 'ivory', center: [4.3, 8.0, -3.2], size: [1.3, 1.3, 1.4] },
  { name: 'tail3', joint: 'tail', surface: 'ivory', center: [5.1, 7.4, -3.6], size: [1.05, 1.05, 1.2] },
]);

/** Overall reference measurements, asserted in `relay-dog.test.ts`. */
export const DOG_METRICS = Object.freeze({
  /** Ground to ear tips. */
  height: 21.2,
  /** Widest point of the silhouette — the skull. */
  headWidth: 7.2,
  /** Front-reference proportions as fractions of `height`. */
  headBlockFraction: 0.35,
  torsoFraction: 0.38,
  legFraction: 0.27,
});
