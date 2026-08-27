/**
 * THE ORIGINAL RELAY DOG — canonical geometry.
 *
 * Reconstructed from the founder's reference sheet (hero/front, rear, and
 * three-quarter). This is a brand asset and its proportions are treated like a
 * logo: every dimension below is expressed as a multiple of HEAD_WIDTH, so the
 * canonical ratios are enforced by construction rather than by eye, and
 * `relay-dog.test.ts` checks each one against the canonical band.
 *
 * THE SILHOUETTE RULE, which everything else serves:
 *
 *   WIDE HEAD → NARROW BODY → LONG HANGING ARMS → THIN SEPARATED LEGS
 *   → LARGE BLOCK FEET
 *
 * The width contrast between the head and the body is the single strongest
 * identifier of the character. An earlier build ran the torso at 0.89 of the
 * head's width, the legs at 0.31 and the visor at 0.78 — which produced a
 * barrel-chested, thick-legged humanoid that read as "another blocky white
 * robot" rather than as this specific creature. The bands below exist to make
 * that class of drift impossible to reintroduce quietly.
 *
 * The character must survive as a black silhouette, with the eyes off, from
 * front, rear and either three-quarter. Nothing here depends on materials.
 */

/** Which surface a box belongs to. Drives material, not geometry. */
export type DogSurface = 'ivory' | 'visor' | 'eye';

/** An articulated part. Each becomes its own transform node so it can animate. */
export type DogJoint = 'root' | 'head' | 'armLeft' | 'armRight' | 'legLeft' | 'legRight' | 'tail';

export type DogBox = {
  readonly name: string;
  readonly joint: DogJoint;
  readonly surface: DogSurface;
  readonly center: readonly [number, number, number];
  readonly size: readonly [number, number, number];
};

/**
 * THE UNIT. Every dimension in this file is a multiple of the head's outer
 * width, so the character can be rescaled without any ratio drifting.
 */
const W = 7.2;

/**
 * The canonical proportion bands, as fractions of HEAD_WIDTH. These are the
 * founder's figures; the values actually used sit inside each band and are
 * asserted against it.
 */
export const DOG_CANON = Object.freeze({
  headWidth: 1.0,
  torsoWidth: [0.55, 0.62],
  legWidth: [0.17, 0.21],
  legGap: [0.13, 0.18],
  footWidth: [0.25, 0.3],
  earWidth: [0.17, 0.21],
  visorWidth: [0.62, 0.68],
  eyeWidth: [0.12, 0.15],
  /** Height distribution: head block, torso, legs+feet. */
  heightSplit: { head: [0.32, 0.4], torso: [0.32, 0.4], legs: [0.24, 0.33] },
});

/* --------------------------------------------------------------- vertical */
/* Ground at 0. Three regions, each roughly a third of the figure.           */
const FOOT_TOP = 0.225 * W;      // feet are WIDE + DEEP + LOW, never boots
const LEG_TOP = 0.8 * W;
const PELVIS_TOP = 0.9875 * W;
const LOWER_TORSO_TOP = 1.175 * W;
const MID_TORSO_TOP = 1.475 * W;
const TORSO_TOP = 1.8625 * W;    // where the head sits
const JAW_TOP = 2.1125 * W;
const VISOR_TOP = 2.4125 * W;
const HEAD_TOP = 2.6625 * W;
const EAR_TOP = 2.9025 * W;      // total height ≈ 2.9 × head width

/* ------------------------------------------------------------ horizontal */
const HEAD_HALF = 0.5 * W;
const HEAD_DEPTH = 0.725 * W;
const TORSO_W = 0.62 * W;        // canonical band 0.55–0.62 (top of band:
                                 // at 0.60 the body read as a stick figure
                                 // beside the head, which the sheet does not)
const VISOR_W = 0.65 * W;        // canonical band 0.62–0.68
const VISOR_HALF = VISOR_W / 2;
const EAR_W = 0.19 * W;          // canonical band 0.17–0.21
const EYE_W = 0.135 * W;         // canonical band 0.12–0.15
const LEG_W = 0.19 * W;          // canonical band 0.17–0.21
const LEG_GAP = 0.14 * W;        // canonical band 0.13–0.18
const LEG_X = (LEG_GAP + LEG_W) / 2;
const FOOT_W = 0.275 * W;        // canonical band 0.25–0.30

/** Recess depth of the visor cavity — the opening has real depth, not a decal. */
const FACE_Z = HEAD_DEPTH / 2;
const VISOR_FLOOR_Z = FACE_Z - 0.22 * W;

const mid = (a: number, b: number) => (a + b) / 2;
const span = (a: number, b: number) => b - a;

export const DOG_PIVOTS: Readonly<Record<DogJoint, readonly [number, number, number]>> = Object.freeze({
  root: [0, 0, 0],
  head: [0, TORSO_TOP, 0],
  // Upper OUTSIDE corners of the narrow torso, never the centre of the chest.
  armLeft: [-TORSO_W / 2, TORSO_TOP - 0.06 * W, 0],
  armRight: [TORSO_W / 2, TORSO_TOP - 0.06 * W, 0],
  legLeft: [-LEG_X, LEG_TOP, 0],
  legRight: [LEG_X, LEG_TOP, 0],
  tail: [0.2 * W, 1.0 * W, -0.2 * W],
});

export const DOG_BOXES: readonly DogBox[] = Object.freeze([
  /* ---- head: a thick rectangular FRAME around a real aperture -------------
     Four heavy masses — brow, jaw, and two side frames — surround the visor.
     The face is not a black screen glued to a cube; the frame is what makes
     the character readable, and the jaw below the visor carries as much mass
     as the brow above it. */
  { name: 'headBrow', joint: 'head', surface: 'ivory',
    center: [0, mid(VISOR_TOP, HEAD_TOP), 0], size: [W, span(VISOR_TOP, HEAD_TOP), HEAD_DEPTH] },
  { name: 'headJaw', joint: 'head', surface: 'ivory',
    // Stops exactly AT the shoulder line. The head is far wider than the torso,
    // so any full-width extension below this point is not hidden — it shows as
    // extra head and swallows the notches beneath the head's lower corners,
    // which are one of the character's strongest identifiers.
    center: [0, mid(TORSO_TOP, JAW_TOP), 0], size: [W, span(TORSO_TOP, JAW_TOP), HEAD_DEPTH] },
  { name: 'headStub', joint: 'head', surface: 'ivory',
    // The neck-gap fix, done NARROW so it stays inside the torso's silhouette:
    // it closes the hole a head turn would otherwise open, without adding a
    // pixel to the head's visible width.
    center: [0, TORSO_TOP - 0.075 * W, 0], size: [0.3 * W, 0.15 * W, 0.3 * W] },
  { name: 'headFrameLeft', joint: 'head', surface: 'ivory',
    center: [-mid(VISOR_HALF, HEAD_HALF), mid(JAW_TOP, VISOR_TOP), 0],
    size: [span(VISOR_HALF, HEAD_HALF), span(JAW_TOP, VISOR_TOP), HEAD_DEPTH] },
  { name: 'headFrameRight', joint: 'head', surface: 'ivory',
    center: [mid(VISOR_HALF, HEAD_HALF), mid(JAW_TOP, VISOR_TOP), 0],
    size: [span(VISOR_HALF, HEAD_HALF), span(JAW_TOP, VISOR_TOP), HEAD_DEPTH] },
  { name: 'headBack', joint: 'head', surface: 'ivory',
    center: [0, mid(JAW_TOP, VISOR_TOP), mid(-FACE_Z, VISOR_FLOOR_Z)],
    size: [VISOR_W, span(JAW_TOP, VISOR_TOP), span(-FACE_Z, VISOR_FLOOR_Z)] },

  /* ---- ears: short, WIDE, chunky rectangular prisms ----------------------
     Not antennas. Inset from the head's corners so ivory remains outside them,
     with a gap between them far wider than either ear. */
  { name: 'earLeft', joint: 'head', surface: 'ivory',
    center: [-(HEAD_HALF - 0.085 * W - EAR_W / 2), mid(HEAD_TOP, EAR_TOP), -0.025 * W],
    size: [EAR_W, span(HEAD_TOP, EAR_TOP), 0.2 * W] },
  { name: 'earRight', joint: 'head', surface: 'ivory',
    center: [HEAD_HALF - 0.085 * W - EAR_W / 2, mid(HEAD_TOP, EAR_TOP), -0.025 * W],
    size: [EAR_W, span(HEAD_TOP, EAR_TOP), 0.2 * W] },

  /* ---- visor: a wide horizontal aperture with a floor set well back ------ */
  { name: 'visorInterior', joint: 'head', surface: 'visor',
    center: [0, mid(JAW_TOP, VISOR_TOP), VISOR_FLOOR_Z + 0.0125 * W],
    size: [VISOR_W, span(JAW_TOP, VISOR_TOP), 0.025 * W] },

  /* ---- eyes: two small gold blocks suspended in the cavity ---------------
     Toward the LOWER half of the visor, with black above, between and outside.
     They must never approach filling the opening. */
  { name: 'eyeLeft', joint: 'head', surface: 'eye',
    center: [-(0.055 * W + EYE_W / 2), JAW_TOP + 0.115 * W, VISOR_FLOOR_Z + 0.04 * W],
    size: [EYE_W, EYE_W, 0.025 * W] },
  { name: 'eyeRight', joint: 'head', surface: 'eye',
    center: [0.055 * W + EYE_W / 2, JAW_TOP + 0.115 * W, VISOR_FLOOR_Z + 0.04 * W],
    size: [EYE_W, EYE_W, 0.025 * W] },

  /* ---- neck: short, narrow, blocky. Never a cylinder or a joint. --------- */
  { name: 'neck', joint: 'root', surface: 'ivory',
    center: [0, TORSO_TOP - 0.05 * W, 0], size: [0.325 * W, 0.175 * W, 0.325 * W] },

  /* ---- torso: a LONG NARROW central slab, not a chest cube ---------------
     0.60 of the head's width, so the head's lower corners overhang it by a
     clear margin on both sides. Those two notches are load-bearing. */
  { name: 'upperTorso', joint: 'root', surface: 'ivory',
    center: [0, mid(MID_TORSO_TOP, TORSO_TOP), 0],
    size: [TORSO_W, span(MID_TORSO_TOP, TORSO_TOP), 0.45 * W] },
  { name: 'midTorso', joint: 'root', surface: 'ivory',
    center: [0, mid(LOWER_TORSO_TOP, MID_TORSO_TOP), 0],
    size: [TORSO_W, span(LOWER_TORSO_TOP, MID_TORSO_TOP), 0.45 * W] },

  /* ---- lower torso: a STEPPED pixel taper, never one giant rectangle ----- */
  { name: 'lowerTorso', joint: 'root', surface: 'ivory',
    center: [0, mid(PELVIS_TOP, LOWER_TORSO_TOP), 0],
    size: [0.4875 * W, span(PELVIS_TOP, LOWER_TORSO_TOP), 0.4 * W] },
  { name: 'pelvisStep', joint: 'root', surface: 'ivory',
    center: [0, mid(LEG_TOP - 0.025 * W, PELVIS_TOP), 0],
    size: [0.3625 * W, span(LEG_TOP - 0.025 * W, PELVIS_TOP), 0.3375 * W] },

  /* ---- arms: long, slender, SEGMENTED, hanging clear of the torso --------
     Three stepped segments per side, drifting very slightly outward as they
     descend, ending near the upper thigh. They begin BELOW the head's lower
     edge so the notches under the head stay open. Their outer edge slightly exceeds
     the head's width, which the reference allows. */
  { name: 'armLeftUpper', joint: 'armLeft', surface: 'ivory',
    center: [-0.44 * W, 1.5083 * W, 0], size: [0.2 * W, 0.4 * W, 0.2125 * W] },
  { name: 'armLeftForearm', joint: 'armLeft', surface: 'ivory',
    center: [-0.4525 * W, 1.1208 * W, 0.0125 * W], size: [0.19 * W, 0.375 * W, 0.2 * W] },
  { name: 'armLeftHand', joint: 'armLeft', surface: 'ivory',
    center: [-0.4625 * W, 0.8333 * W, 0.025 * W], size: [0.205 * W, 0.2 * W, 0.225 * W] },
  { name: 'armRightUpper', joint: 'armRight', surface: 'ivory',
    center: [0.44 * W, 1.5083 * W, 0], size: [0.2 * W, 0.4 * W, 0.2125 * W] },
  { name: 'armRightForearm', joint: 'armRight', surface: 'ivory',
    center: [0.4525 * W, 1.1208 * W, 0.0125 * W], size: [0.19 * W, 0.375 * W, 0.2 * W] },
  { name: 'armRightHand', joint: 'armRight', surface: 'ivory',
    center: [0.4625 * W, 0.8333 * W, 0.025 * W], size: [0.205 * W, 0.2 * W, 0.225 * W] },

  /* ---- legs: thin vertical columns, clearly separated -------------------- */
  { name: 'legLeft', joint: 'legLeft', surface: 'ivory',
    center: [-LEG_X, mid(FOOT_TOP, LEG_TOP), 0], size: [LEG_W, span(FOOT_TOP, LEG_TOP), 0.225 * W] },
  { name: 'legRight', joint: 'legRight', surface: 'ivory',
    center: [LEG_X, mid(FOOT_TOP, LEG_TOP), 0], size: [LEG_W, span(FOOT_TOP, LEG_TOP), 0.225 * W] },

  /* ---- feet: WIDE + DEEP + LOW, projecting forward and slightly outward -- */
  { name: 'footLeft', joint: 'legLeft', surface: 'ivory',
    center: [-(LEG_X + 0.0125 * W), FOOT_TOP / 2, 0.0625 * W],
    size: [FOOT_W, FOOT_TOP, 0.375 * W] },
  { name: 'footRight', joint: 'legRight', surface: 'ivory',
    center: [LEG_X + 0.0125 * W, FOOT_TOP / 2, 0.0625 * W],
    size: [FOOT_W, FOOT_TOP, 0.375 * W] },

  /* ---- tail: a STEPPED 90° voxel hook ------------------------------------
     Out of the rear/side of the hip, back, then bending upward in discrete
     rectangular segments to a squared tip. Never a curve, tube or spline. */
  { name: 'tail01', joint: 'tail', surface: 'ivory',
    center: [0.2875 * W, 0.95 * W, -0.2375 * W], size: [0.1625 * W, 0.1625 * W, 0.175 * W] },
  { name: 'tail02', joint: 'tail', surface: 'ivory',
    center: [0.3875 * W, 0.9875 * W, -0.3375 * W], size: [0.1445 * W, 0.1445 * W, 0.157 * W] },
  { name: 'tail03', joint: 'tail', surface: 'ivory',
    center: [0.4625 * W, 1.075 * W, -0.4 * W], size: [0.125 * W, 0.125 * W, 0.1375 * W] },
  { name: 'tail04', joint: 'tail', surface: 'ivory',
    center: [0.5125 * W, 1.1875 * W, -0.4375 * W], size: [0.1125 * W, 0.1125 * W, 0.125 * W] },
  { name: 'tailTip', joint: 'tail', surface: 'ivory',
    center: [0.5375 * W, 1.2875 * W, -0.45 * W], size: [0.1 * W, 0.1 * W, 0.1125 * W] },
]);

/** Measurements the canonical bands are checked against. */
export const DOG_METRICS = Object.freeze({
  headWidth: W,
  height: EAR_TOP,
  torsoTop: TORSO_TOP,
  legTop: LEG_TOP,
  footTop: FOOT_TOP,
});
