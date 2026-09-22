"""THE BEE RELAY DOG -- a SKIN on the canonical Dog, not a different creature.

FOUNDER DIRECTIVE (2026-09-22): "recognizably the canonical Relay Dog crossed with the Wonderland
Bee mascot", white/black base kept where appropriate, bee yellow and gold accents, a subtle striped
armour treatment, wing-like elements if they fit the silhouette, small antenna motifs that do NOT
destroy the Relay Dog ears, honeycomb detail, a warm luminous eye, premium mascot quality -- and
explicitly "do not make it a literal ordinary bee".

WHAT A SKIN IS ALLOWED TO DO, and what it is not. It may repaint any box and it may ADD parts. It
may not move, resize or delete a single canonical box: dog_canon.BOXES is imported and used as-is,
so the Bee stands in the same silhouette, animates on the same pivots and can be driven by the same
ARelayDogCharacter as the plain Dog. That is what keeps it a skin instead of a second model to
maintain.

THE STRIPES ARE GEOMETRY THAT WAS ALREADY THERE. A bee's abdomen is banded, and the Dog's torso is
already four stacked blocks -- upperTorso, midTorso, lowerTorso, pelvisStep. Painting them
ivory / amber / carapace / amber makes the bands land exactly on real box seams, so the stripe edges
are crisp at every distance and in every LOD, with no texture, no UV work and no cost. The same
trick bands the arms and legs. This is the "subtle striped armour" read: banded plating on a white
machine, not a yellow-and-black insect.

WHY THE WINGS DO NOT RUIN THE SILHOUETTE. Four wings, swept BACK along the body rather than spread,
built from the translucent unlit master the Sub-Agent Cub Ghost needed (M_V2_Ghost). Swept back they
sit inside the Dog's existing outline from the front and read as wings only from three-quarters and
above -- the founder's "if they fit the silhouette" condition, answered by sweep angle rather than by
leaving them out.

THE ANTENNAE DO NOT TOUCH THE EARS. dog_canon puts the ears at x = +/-(HEAD_HALF - 0.085 - EAR_W/2)
with a gap of 0.45 W between them. The antennae rise from inside that gap, so both ears keep their
canonical size and position and the Relay Dog head still reads first.

HONEYCOMB IS A REAL HEXAGON, NOT A TEXTURE. The V2 masters sample through world-projected UVs, which
is exactly why the Dog's own materials run at TexScale 0 -- a honeycomb texture would streak down
every vertical face. So the honeycomb is seven six-sided prisms in a comb cluster on the chest:
actual geometry, ~170 triangles, correct from any angle and in any light.
"""
import dog_canon as D

W = D.W

#: Repaint only. Any canonical box not named here keeps the Dog's own surface.
#: The bands: chest ivory, thorax amber, abdomen dark, pelvis amber -- read top to bottom.
SURFACE_MAP = {
    "midTorso": "amber",
    "lowerTorso": "carapace",
    "pelvisStep": "amber",
    "armLeftForearm": "amber", "armRightForearm": "amber",
    "armLeftHand": "carapace", "armRightHand": "carapace",
    "legLeftShin": "amber", "legRightShin": "amber",
    "footLeft": "carapace", "footRight": "carapace",
    "tail02": "amber", "tail04": "amber",
    "headFrameLeft": "amber", "headFrameRight": "amber",
    "neck": "carapace",
}

_EAR_X = D.HEAD_HALF - 0.085 * W - D.EAR_W / 2          # the canonical ear centre
_ANT_X = 0.088 * W                                       # well inside the 0.45 W gap between the ears

#: Added parts: (name, joint, surface, centre_web, size_web, rot_ue(pitch,yaw,roll), kind)
#: kind "box" or "hex" (a six-sided prism, for the honeycomb).
EXTRAS = [
    # --- antennae: a stalk that leans forward out of the skull top, and a bead on the end.
    ("antennaStalkLeft", "head", "carapace", (-_ANT_X, D.HEAD_TOP + 0.115 * W, 0.045 * W),
     (0.032 * W, 0.26 * W, 0.032 * W), (14.0, 0.0, -7.0), "box"),
    ("antennaStalkRight", "head", "carapace", (_ANT_X, D.HEAD_TOP + 0.115 * W, 0.045 * W),
     (0.032 * W, 0.26 * W, 0.032 * W), (14.0, 0.0, 7.0), "box"),
    ("antennaBeadLeft", "head", "amber", (-_ANT_X - 0.028 * W, D.HEAD_TOP + 0.245 * W, 0.082 * W),
     (0.062 * W, 0.062 * W, 0.062 * W), (0.0, 0.0, 0.0), "box"),
    ("antennaBeadRight", "head", "amber", (_ANT_X + 0.028 * W, D.HEAD_TOP + 0.245 * W, 0.082 * W),
     (0.062 * W, 0.062 * W, 0.062 * W), (0.0, 0.0, 0.0), "box"),

    # --- wings: fore and hind, each side, swept back so the front silhouette is unchanged.
    #     Long along web x (= Unreal y); yaw sweeps the tip backwards, roll lifts it.
    ("wingForeLeft", "root", "wing", (-0.46 * W, 1.63 * W, -0.30 * W),
     (0.78 * W, 0.022 * W, 0.20 * W), (0.0, 34.0, 13.0), "box"),
    ("wingForeRight", "root", "wing", (0.46 * W, 1.63 * W, -0.30 * W),
     (0.78 * W, 0.022 * W, 0.20 * W), (0.0, -34.0, -13.0), "box"),
    ("wingHindLeft", "root", "wing", (-0.36 * W, 1.52 * W, -0.34 * W),
     (0.52 * W, 0.020 * W, 0.145 * W), (0.0, 44.0, 8.0), "box"),
    ("wingHindRight", "root", "wing", (0.36 * W, 1.52 * W, -0.34 * W),
     (0.52 * W, 0.020 * W, 0.145 * W), (0.0, -44.0, -8.0), "box"),
    # the root each wing pair grows from, so they do not float off the back
    ("wingRootLeft", "root", "carapace", (-0.20 * W, 1.60 * W, -0.235 * W),
     (0.13 * W, 0.13 * W, 0.10 * W), (0.0, 0.0, 0.0), "box"),
    ("wingRootRight", "root", "carapace", (0.20 * W, 1.60 * W, -0.235 * W),
     (0.13 * W, 0.13 * W, 0.10 * W), (0.0, 0.0, 0.0), "box"),
]

#: The honeycomb chest emblem: one central cell and six around it, on the front of the upper torso.
#: Flat-topped hexagons, so the comb packs the way a real one does.
_HEX_R = 0.058 * W
_HEX_CY = 1.66 * W
_HEX_Z = 0.232 * W          # upperTorso half-depth (0.225) plus a hair, so the cells sit proud
for _i, (_dx, _dy) in enumerate([(0.0, 0.0), (1.0, 0.0), (-1.0, 0.0), (0.5, 0.87), (-0.5, 0.87),
                                 (0.5, -0.87), (-0.5, -0.87)]):
    # SIZE IS FULL WIDTH, NOT RADIUS. parts() hands the builder (dim_x, dim_y, dim_z) and the hex
    # builder takes dim_y / 2 as the circumradius, so a cell of radius R must be written 2R wide or
    # it comes out half size with daylight between the cells. Centres sit sqrt(3).R apart, which is
    # what makes a honeycomb pack instead of a polka dot.
    EXTRAS.append(("honeycomb%02d" % (_i + 1), "root", "amber" if _i == 0 else "gold",
                   (_dx * _HEX_R * 1.74, _HEX_CY + _dy * _HEX_R * 1.74, _HEX_Z),
                   (2.0 * _HEX_R, 2.0 * _HEX_R, 0.030 * W), (90.0, 0.0, 0.0), "hex"))

#: Materials. Ivory, visor and eye stay on the Dog's own canon values except the eye, which the
#: founder asked to run warmer and more luminous for this skin. Amber and gold are the bee accents;
#: carapace is a darker, glossier version of the visor black so the banding reads as plating rather
#: than as paint; wing rides the translucent unlit master.
MATERIALS = {
    "ivory": dict(D.MATERIALS["ivory"]),
    "visor": dict(D.MATERIALS["visor"]),
    "amber": {"color": "#F2B134", "roughness": 0.52, "metalness": 0.0, "emissive": None},
    "gold": {"color": "#E8A317", "roughness": 0.34, "metalness": 0.55, "emissive": None},
    "carapace": {"color": "#141210", "roughness": 0.38, "metalness": 0.15, "emissive": None},
    "eye": {"color": "#FFC94A", "roughness": 0.34, "metalness": 0.1, "emissive": ("#FFB627", 1.5)},
    "wing": {"core": "#FFF6DC", "rim": "#F2B134", "opacity": 0.22, "rim_power": 3.2,
             "brightness": 9000.0, "fade_strength": 0.45},
}
SURFACES = ("ivory", "visor", "eye", "amber", "gold", "carapace", "wing")
#: The one translucent surface, which the builder must put on the ghost master rather than a V2 one.
TRANSLUCENT = ("wing",)


def boxes():
    """The Bee's full build list: every canonical Dog box with its skin surface, then the extras.
    (name, joint, surface, centre_web, size_web, rot_ue, kind)."""
    out = []
    for name, joint, surface, centre, size in D.BOXES:
        out.append((name, joint, SURFACE_MAP.get(name, surface), centre, size, (0.0, 0.0, 0.0), "box"))
    out.extend(EXTRAS)
    return out


def parts(scale):
    """{(joint, surface): [(name, centre_local_ue, dims_ue, rot_ue, kind)]}, each box in its joint's
    own frame -- the same contract dog_canon.parts() honours, so the Bee rigs identically."""
    out = {}
    for name, joint, surface, centre, size, rot, kind in boxes():
        px, py, pz = D.PIVOTS[joint]
        c_ue, d_ue = D.to_unreal((centre[0] - px, centre[1] - py, centre[2] - pz), size, scale)
        out.setdefault((joint, surface), []).append((name, c_ue, d_ue, rot, kind))
    return out


def measurements():
    canon = len(D.BOXES)
    return {"canonicalBoxes": canon, "repainted": len(SURFACE_MAP), "extras": len(EXTRAS),
            "totalParts": canon + len(EXTRAS), "surfaces": len(SURFACES),
            "height": D.height(), "antennaGapUsed": 2 * _ANT_X, "earGap": W - 2 * 0.085 * W - 2 * D.EAR_W,
            "wingSweepDeg": 34.0}
