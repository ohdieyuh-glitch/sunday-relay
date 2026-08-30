"""THE CANONICAL RELAY DOG — the web model's geometry, as data.

Transcribed from `src/relay/ui/landing/three/relay-dog.ts` (main 96451fc), the
production landing-page Dog the founder approved. Every dimension is a multiple
of HEAD_WIDTH (W); the web build uses W = 7.2 scene units. This module is pure
stdlib so the same numbers drive the Unreal generator (dog_v2.py) and the
offline gate (verify_dog_canon.py). THE WEB DOG IS THE CANON: nothing here may
change a proportion — Unreal adapts to it, never the other way round.

Web axes: X right, Y up, Z toward the viewer (the Dog faces +Z).
Unreal axes: X forward (the Dog faces +X), Y right, Z up, left-handed.
  ue = (S * z_web, -S * x_web, S * y_web)     -- the -x flips handedness so the
                                                  physical shape is preserved
                                                  (the tail stays on the Dog's LEFT hip).
"""

W = 1.0  # HEAD_WIDTH -- all ratios below are dimensionless multiples of it

FOOT_TOP = 0.225 * W
LEG_TOP = 0.8 * W
PELVIS_TOP = 0.9875 * W
LOWER_TORSO_TOP = 1.175 * W
MID_TORSO_TOP = 1.475 * W
TORSO_TOP = 1.8625 * W
JAW_TOP = 2.1125 * W
VISOR_TOP = 2.4125 * W
HEAD_TOP = 2.6625 * W
EAR_TOP = 2.9025 * W

HEAD_HALF = 0.5 * W
HEAD_DEPTH = 0.725 * W
TORSO_W = 0.62 * W
VISOR_W = 0.65 * W
VISOR_HALF = VISOR_W / 2
EAR_W = 0.19 * W
EYE_W = 0.135 * W
LEG_W = 0.19 * W
LEG_GAP = 0.14 * W
LEG_X = (LEG_GAP + LEG_W) / 2
FOOT_W = 0.275 * W
FACE_Z = HEAD_DEPTH / 2
VISOR_FLOOR_Z = FACE_Z - 0.22 * W

#: THE ARTICULATION SEAMS (2026-08-29, the locomotion phase).
#:
#: The web canon already draws each arm as three stacked boxes and each leg as
#: one. Where the upper arm's underside meets the forearm's top face there is
#: an exact plane — 1.3083 W, the same number from both directions — and that
#: plane is where a real elbow is. Splitting the arm THERE adds no length, no
#: width and no shoulder displacement: the same boxes hang in the same places,
#: they simply belong to two joints instead of one, so the forearm can pivot.
#: The knee is the same idea on a leg the web draws as a single block: the box
#: is cut in half and the halves are re-stacked exactly where the whole was.
#:
#: Each seam carries a HINGE BLOCK, narrower and shallower than both limbs it
#: joins and centred on the seam plane, so at rest it is entirely inside the
#: limb (verify_dog_canon proves that) and the standing silhouette is unchanged
#: — and the moment the joint bends it is revealed as a real geometric pivot
#: rather than a painted line. No rounded joints; the block idiom holds.
ELBOW_Y = 1.3083 * W          # upper-arm underside == forearm top face
KNEE_Y = 0.5125 * W           # mid-shank, the leg block's own centre
ARM_PIVOT_X = 0.4463 * W      # between the upper arm's and the forearm's centres
ARM_PIVOT_Z = 0.0063 * W
HINGE_ARM = (0.16 * W, 0.09 * W, 0.16 * W)   # inside arm 0.20/0.19 wide, 0.2125/0.20 deep
HINGE_LEG = (0.15 * W, 0.08 * W, 0.18 * W)   # inside leg 0.19 wide, 0.225 deep

mid = lambda a, b: (a + b) / 2  # noqa: E731
span = lambda a, b: b - a       # noqa: E731

#: The canonical bands (fractions of HEAD_WIDTH) the web test enforces.
DOG_CANON = {
    "torsoWidth": (0.55, 0.62), "legWidth": (0.17, 0.21), "legGap": (0.13, 0.18), "footWidth": (0.25, 0.30),
    "earWidth": (0.17, 0.21), "visorWidth": (0.62, 0.68), "eyeWidth": (0.12, 0.15),
}

#: joint -> pivot (web axes, ×W)
PIVOTS = {
    "root": (0.0, 0.0, 0.0),
    "head": (0.0, TORSO_TOP, 0.0),
    "armLeft": (-TORSO_W / 2, TORSO_TOP - 0.06 * W, 0.0),
    "armRight": (TORSO_W / 2, TORSO_TOP - 0.06 * W, 0.0),
    "legLeft": (-LEG_X, LEG_TOP, 0.0),
    "legRight": (LEG_X, LEG_TOP, 0.0),
    "forearmLeft": (-ARM_PIVOT_X, ELBOW_Y, ARM_PIVOT_Z),
    "forearmRight": (ARM_PIVOT_X, ELBOW_Y, ARM_PIVOT_Z),
    "shinLeft": (-LEG_X, KNEE_Y, 0.0),
    "shinRight": (LEG_X, KNEE_Y, 0.0),
    # CENTRED, BY FOUNDER DECISION (2026-08-30). The web Dog carries its tail on
    # the LEFT hip and this file has always matched it; seen at gameplay scale
    # in Wonderland the founder called it "all the way on the left side" and
    # asked for the middle. So the tail now leaves the back of the pelvis on
    # the centre line and keeps its own rise and sweep. This is a deliberate
    # divergence from relay-dog.ts, not a transcription slip -- the web model
    # is untouched, and verify_dog_canon enforces the new rule instead of the
    # old one so the two cannot drift silently.
    "tail": (0.0, 1.0 * W, -0.2 * W),
}

#: joint -> the joint it hangs from. The hierarchy is what makes a shoulder
#: carry its forearm and a hip carry its shin; a flat list of siblings would
#: leave the forearm behind the moment the arm swung.
PARENTS = {
    "root": None,
    "head": "root",
    "armLeft": "root", "armRight": "root",
    "forearmLeft": "armLeft", "forearmRight": "armRight",
    "legLeft": "root", "legRight": "root",
    "shinLeft": "legLeft", "shinRight": "legRight",
    "tail": "root",
}

#: (name, joint, surface, centre(x,y,z), size(w,h,d)) -- web axes, ×W. 31 boxes.
BOXES = [
    ("headBrow", "head", "ivory", (0, mid(VISOR_TOP, HEAD_TOP), 0), (W, span(VISOR_TOP, HEAD_TOP), HEAD_DEPTH)),
    ("headJaw", "head", "ivory", (0, mid(TORSO_TOP, JAW_TOP), 0), (W, span(TORSO_TOP, JAW_TOP), HEAD_DEPTH)),
    ("headStub", "head", "ivory", (0, TORSO_TOP - 0.075 * W, 0), (0.3 * W, 0.15 * W, 0.3 * W)),
    ("headFrameLeft", "head", "ivory", (-mid(VISOR_HALF, HEAD_HALF), mid(JAW_TOP, VISOR_TOP), 0),
     (span(VISOR_HALF, HEAD_HALF), span(JAW_TOP, VISOR_TOP), HEAD_DEPTH)),
    ("headFrameRight", "head", "ivory", (mid(VISOR_HALF, HEAD_HALF), mid(JAW_TOP, VISOR_TOP), 0),
     (span(VISOR_HALF, HEAD_HALF), span(JAW_TOP, VISOR_TOP), HEAD_DEPTH)),
    ("headBack", "head", "ivory", (0, mid(JAW_TOP, VISOR_TOP), mid(-FACE_Z, VISOR_FLOOR_Z)),
     (VISOR_W, span(JAW_TOP, VISOR_TOP), span(-FACE_Z, VISOR_FLOOR_Z))),
    ("earLeft", "head", "ivory", (-(HEAD_HALF - 0.085 * W - EAR_W / 2), mid(HEAD_TOP, EAR_TOP), -0.025 * W),
     (EAR_W, span(HEAD_TOP, EAR_TOP), 0.2 * W)),
    ("earRight", "head", "ivory", (HEAD_HALF - 0.085 * W - EAR_W / 2, mid(HEAD_TOP, EAR_TOP), -0.025 * W),
     (EAR_W, span(HEAD_TOP, EAR_TOP), 0.2 * W)),
    ("visorInterior", "head", "visor", (0, mid(JAW_TOP, VISOR_TOP), VISOR_FLOOR_Z + 0.0125 * W),
     (VISOR_W, span(JAW_TOP, VISOR_TOP), 0.025 * W)),
    ("eyeLeft", "head", "eye", (-(0.055 * W + EYE_W / 2), JAW_TOP + 0.115 * W, VISOR_FLOOR_Z + 0.04 * W),
     (EYE_W, EYE_W, 0.025 * W)),
    ("eyeRight", "head", "eye", (0.055 * W + EYE_W / 2, JAW_TOP + 0.115 * W, VISOR_FLOOR_Z + 0.04 * W),
     (EYE_W, EYE_W, 0.025 * W)),
    ("neck", "root", "ivory", (0, TORSO_TOP - 0.05 * W, 0), (0.325 * W, 0.175 * W, 0.325 * W)),
    ("upperTorso", "root", "ivory", (0, mid(MID_TORSO_TOP, TORSO_TOP), 0), (TORSO_W, span(MID_TORSO_TOP, TORSO_TOP), 0.45 * W)),
    ("midTorso", "root", "ivory", (0, mid(LOWER_TORSO_TOP, MID_TORSO_TOP), 0), (TORSO_W, span(LOWER_TORSO_TOP, MID_TORSO_TOP), 0.45 * W)),
    ("lowerTorso", "root", "ivory", (0, mid(PELVIS_TOP, LOWER_TORSO_TOP), 0), (0.4875 * W, span(PELVIS_TOP, LOWER_TORSO_TOP), 0.4 * W)),
    ("pelvisStep", "root", "ivory", (0, mid(LEG_TOP - 0.025 * W, PELVIS_TOP), 0),
     (0.3625 * W, span(LEG_TOP - 0.025 * W, PELVIS_TOP), 0.3375 * W)),
    ("armLeftUpper", "armLeft", "ivory", (-0.44 * W, 1.5083 * W, 0), (0.2 * W, 0.4 * W, 0.2125 * W)),
    ("armLeftElbow", "armLeft", "ivory", (-ARM_PIVOT_X, ELBOW_Y, ARM_PIVOT_Z), HINGE_ARM),
    ("armLeftForearm", "forearmLeft", "ivory", (-0.4525 * W, 1.1208 * W, 0.0125 * W), (0.19 * W, 0.375 * W, 0.2 * W)),
    ("armLeftHand", "forearmLeft", "ivory", (-0.4625 * W, 0.8333 * W, 0.025 * W), (0.205 * W, 0.2 * W, 0.225 * W)),
    ("armRightUpper", "armRight", "ivory", (0.44 * W, 1.5083 * W, 0), (0.2 * W, 0.4 * W, 0.2125 * W)),
    ("armRightElbow", "armRight", "ivory", (ARM_PIVOT_X, ELBOW_Y, ARM_PIVOT_Z), HINGE_ARM),
    ("armRightForearm", "forearmRight", "ivory", (0.4525 * W, 1.1208 * W, 0.0125 * W), (0.19 * W, 0.375 * W, 0.2 * W)),
    ("armRightHand", "forearmRight", "ivory", (0.4625 * W, 0.8333 * W, 0.025 * W), (0.205 * W, 0.2 * W, 0.225 * W)),
    ("legLeftThigh", "legLeft", "ivory", (-LEG_X, mid(KNEE_Y, LEG_TOP), 0), (LEG_W, span(KNEE_Y, LEG_TOP), 0.225 * W)),
    ("legRightThigh", "legRight", "ivory", (LEG_X, mid(KNEE_Y, LEG_TOP), 0), (LEG_W, span(KNEE_Y, LEG_TOP), 0.225 * W)),
    ("legLeftKnee", "legLeft", "ivory", (-LEG_X, KNEE_Y, 0), HINGE_LEG),
    ("legRightKnee", "legRight", "ivory", (LEG_X, KNEE_Y, 0), HINGE_LEG),
    ("legLeftShin", "shinLeft", "ivory", (-LEG_X, mid(FOOT_TOP, KNEE_Y), 0), (LEG_W, span(FOOT_TOP, KNEE_Y), 0.225 * W)),
    ("legRightShin", "shinRight", "ivory", (LEG_X, mid(FOOT_TOP, KNEE_Y), 0), (LEG_W, span(FOOT_TOP, KNEE_Y), 0.225 * W)),
    ("footLeft", "shinLeft", "ivory", (-(LEG_X + 0.0125 * W), FOOT_TOP / 2, 0.0625 * W), (FOOT_W, FOOT_TOP, 0.375 * W)),
    ("footRight", "shinRight", "ivory", (LEG_X + 0.0125 * W, FOOT_TOP / 2, 0.0625 * W), (FOOT_W, FOOT_TOP, 0.375 * W)),
    ("tail01", "tail", "ivory", (0.0, 0.95 * W, -0.2375 * W), (0.1625 * W, 0.1625 * W, 0.175 * W)),
    ("tail02", "tail", "ivory", (0.0, 0.9875 * W, -0.3375 * W), (0.1445 * W, 0.1445 * W, 0.157 * W)),
    ("tail03", "tail", "ivory", (0.0, 1.075 * W, -0.4 * W), (0.125 * W, 0.125 * W, 0.1375 * W)),
    ("tail04", "tail", "ivory", (0.0, 1.1875 * W, -0.4375 * W), (0.1125 * W, 0.1125 * W, 0.125 * W)),
    ("tailTip", "tail", "ivory", (0.0, 1.2875 * W, -0.45 * W), (0.1 * W, 0.1 * W, 0.1125 * W)),
]

JOINTS = ("root", "head", "armLeft", "forearmLeft", "armRight", "forearmRight",
          "legLeft", "shinLeft", "legRight", "shinRight", "tail")

#: The seams, as (hinge box, the two limb boxes it must hide inside). The gate
#: proves each hinge is strictly contained in BOTH, which is what makes
#: "the standing silhouette is unchanged" a checked claim rather than a hope.
SEAMS = (
    ("armLeftElbow", "armLeftUpper", "armLeftForearm"),
    ("armRightElbow", "armRightUpper", "armRightForearm"),
    ("legLeftKnee", "legLeftThigh", "legLeftShin"),
    ("legRightKnee", "legRightThigh", "legRightShin"),
)
SURFACES = ("ivory", "visor", "eye")

#: Web canon materials (sRGB hex, roughness, metalness, emissive hex × intensity)
MATERIALS = {
    "ivory": {"color": "#EBE5D6", "roughness": 0.72, "metalness": 0.0, "emissive": None},
    "visor": {"color": "#050505", "roughness": 0.55, "metalness": 0.0, "emissive": None},
    "eye": {"color": "#F2C94C", "roughness": 0.40, "metalness": 0.1, "emissive": ("#C9A23A", 0.9)},
}


def srgb_to_linear(hex_colour):
    """'#RRGGBB' -> (r, g, b) linear, the space UE's LinearColor and three.js's
    colour management both work in."""
    h = hex_colour.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def to_unreal(centre, size, scale):
    """Web (x right, y up, z forward) -> Unreal (x forward, y right, z up), scaled.
    Returns (centre_ue, dims_ue) with dims as (dim_x, dim_y, dim_z)."""
    x, y, z = centre
    w, h, d = size
    return ((z * scale, -x * scale, y * scale), (d * scale, w * scale, h * scale))


def parts(scale):
    """The Unreal build list: {(joint, surface): [(name, centre_local_ue, dims_ue), ...]},
    every box expressed in ITS JOINT'S local frame (pivot subtracted) so a joint
    rotates its part about the pivot, exactly as the web rig does."""
    out = {}
    for name, joint, surface, centre, size in BOXES:
        px, py, pz = PIVOTS[joint]
        local = (centre[0] - px, centre[1] - py, centre[2] - pz)
        c_ue, d_ue = to_unreal(local, size, scale)
        out.setdefault((joint, surface), []).append((name, c_ue, d_ue))
    return out


def pivots_unreal(scale):
    return {j: to_unreal(p, (0, 0, 0), scale)[0] for j, p in PIVOTS.items()}


def extents(boxes):
    """Axis-aligned bounds of a list of (name, centre, dims): (min, max) in that frame."""
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for _, c, d in boxes:
        for i in range(3):
            lo[i] = min(lo[i], c[i] - d[i] / 2)
            hi[i] = max(hi[i], c[i] + d[i] / 2)
    return tuple(lo), tuple(hi)


def height():
    return EAR_TOP


def measurements():
    """The headline ratios (×W) the report and the gate use."""
    return {
        "headWidth": W, "headHeight": span(TORSO_TOP, HEAD_TOP), "headDepth": HEAD_DEPTH,
        "torsoWidth": TORSO_W, "torsoHeight": span(PELVIS_TOP, TORSO_TOP), "torsoDepth": 0.45 * W,
        "visorWidth": VISOR_W, "visorHeight": span(JAW_TOP, VISOR_TOP), "visorRecess": 0.22 * W,
        "earWidth": EAR_W, "earHeight": span(HEAD_TOP, EAR_TOP), "earGap": W - 2 * 0.085 * W - 2 * EAR_W,
        "eyeWidth": EYE_W, "armWidth": 0.2 * W, "armLength": (1.5083 * W + 0.2 * W) - (0.8333 * W - 0.1 * W),
        "legWidth": LEG_W, "legGap": LEG_GAP, "footWidth": FOOT_W, "footDepth": 0.375 * W, "footHeight": FOOT_TOP,
        "tailSegment1": 0.1625 * W, "tailTip": 0.1 * W, "totalHeight": EAR_TOP,
    }
