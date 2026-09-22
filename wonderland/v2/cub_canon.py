"""THE RELAY DOG SUB-AGENT CUB GHOST -- the Dog's head, and nothing below it.

FOUNDER DIRECTIVE (2026-09-22, as corrected the same day) and the founder's own reference plate,
`recovery/evidence/2026-09-22-founder-reference-plates/RELAY_DOG_CUBS_sub_agents.jpg`, captioned
"RELAY DOG CUBS / SUB AGENTS". These are the physical Wonderland representation of REGULAR
SUB-AGENTS: not /MAS clones, not Compound AI Agent clones, not swarm agents, not alternate Julius
bodies. /MAS is a separate system and nothing here belongs to it. Names: RelayDogCub, SA_CubGhost.

WHAT THE PLATE SAYS, AND WHAT IT COST. The first build of this file was a miniature of the standing
mascot: canonical head, shortened torso, two articulated arms with elbow hinges, a plume where the
legs would be. It rendered well and it was wrong. The plate shows eight cubs and not one of them has
a body. A cub is:

  * A FLOATING HEAD. The Relay Dog head, pearl white and self-lit, rounded at every edge.
  * TWO EAR SPURS at the top corners, short and tapered and canted outward -- not the Dog's tall
    upright ears.
  * A BLACK VISOR across the face with WARM GOLD EYES inside it, and the eye SHAPE CHANGES FROM CUB
    TO CUB -- flat bars, curved arcs, slanted wedges. That is not decoration, it is how a cub has an
    expression without a face. EYE_SETS below carries all three.
  * TWO BALL HANDS, small white spheres floating free either side at about jaw height. They are
    DETACHED. There is no arm, no shoulder and no linkage to salvage the old rig into.
  * A GHOST TAIL below and behind, a smooth flowing wisp that curls -- a comet tail, not a stack of
    blocks. The old stepped plume read as a drill bit the moment it was bright enough to see.

SO THE DERIVATION IS THE HEAD. cub_canon imports dog_canon and re-bases the Dog's ACTUAL head boxes
-- brow, jaw, frame, back, visor recess -- recentred on the head's own middle. The visor geometry and
its recess are the canonical numbers, not a copy of them, which is what makes a cub unmistakably a
Relay Dog rather than a white box with eyes. Everything from the neck down is deleted, not shrunk.

THE ORIGIN IS THE CENTRE OF THE HEAD, because a floating head has no feet to stand on. The runtime
places the actor where the head should hover; the tail hangs below it and the hands float beside it.
FOUNDER, 2026-09-22: cubs FLY ABOVE the primary Relay Dog -- overhead, not gathered around it on the
ground. See FLIGHT below, which the staging and the integration contract both read.

Axes are dog_canon's: web X right, Y up, Z toward the viewer (the Cub faces +Z); dog_canon.to_unreal
converts. Pure stdlib, so the same numbers drive the Unreal builder, a preview and an offline gate.
"""
import dog_canon as D

W = 1.0  # the Cub's head width -- every ratio below is a multiple of it

#: The Dog's head occupies local y 0 (TORSO_TOP) .. 0.8 (HEAD_TOP). A floating head is measured from
#: its own middle, so every inherited box drops by half of that.
HEAD_SPAN = D.HEAD_TOP - D.TORSO_TOP
HEAD_MID = HEAD_SPAN / 2.0
HEAD_TOP = HEAD_MID
HEAD_BOTTOM = -HEAD_MID
FACE_Z = D.FACE_Z
VISOR_FLOOR_Z = D.VISOR_FLOOR_Z

#: Rounded, not sharp. The plate's cubs are moulded white plastic with a soft radius on every edge.
CHAMFER = 0.055 * W

# --------------------------------------------------------------------------- the head (the Dog's own)
HEAD_BOXES = []
for _n, _j, _surf, _c, _s in D.BOXES:
    if _j != "head" or _n.startswith("ear") or _n.startswith("eye"):
        continue                      # ears become spurs, eyes become the swappable EYE_SETS
    HEAD_BOXES.append((_n, "pearl" if _surf == "ivory" else _surf,
                       (_c[0], _c[1] - D.TORSO_TOP - HEAD_MID, _c[2]), _s))

# --------------------------------------------------------------------------- ear spurs
#: Short chunky spurs canted outward from the top corners, their bases SUNK INTO the skull --
#: the first cut stood them tall and clear of it and they read as a pair of chimneys. dog_canon puts the ears at
#: +/-(HEAD_HALF - 0.085 - EAR_W/2); the spurs keep that x so the Cub still lines up with the Dog,
#: then lean out and taper to a blunt tip.
SPUR_X = D.HEAD_HALF - 0.085 * W - D.EAR_W / 2
SPUR_H = 0.205 * W
SPUR_W0, SPUR_W1 = 0.215 * W, 0.135 * W
SPUR_CANT = 11.0            # degrees, leaning away from the centre line
SPUR_BOXES = [
    ("spurLeft", "pearl", (-SPUR_X, HEAD_TOP + SPUR_H / 2 - 0.048 * W, -0.03 * W),
     (SPUR_W0, SPUR_H, 0.215 * W), (0.0, 0.0, SPUR_CANT), SPUR_W1),
    ("spurRight", "pearl", (SPUR_X, HEAD_TOP + SPUR_H / 2 - 0.048 * W, -0.03 * W),
     (SPUR_W0, SPUR_H, 0.215 * W), (0.0, 0.0, -SPUR_CANT), SPUR_W1),
]

# --------------------------------------------------------------------------- eyes, three expressions
#: The plate draws the same cub with different eyes. Each set is a list of boxes in head-local web
#: axes, built on the visor floor so they sit inside the recess exactly as the Dog's eyes do.
_EYE_Y = D.JAW_TOP + 0.115 * W - D.TORSO_TOP - HEAD_MID
_EYE_W = D.EYE_W * 1.18
_EYE_X = 0.055 * W + _EYE_W / 2
_EYE_Z = VISOR_FLOOR_Z + 0.04 * W


def _eye_pair(builder):
    out = []
    for side, sx in (("Left", -1.0), ("Right", 1.0)):
        out.extend(builder(side, sx))
    return out


def _flat(side, sx):
    return [("eye%s" % side, "eye", (sx * _EYE_X, _EYE_Y, _EYE_Z), (_EYE_W, _EYE_W * 1.15, 0.025 * W),
             (0.0, 0.0, 0.0))]


def _arc(side, sx):
    # a shallow upward curve: three short bars, the outer two stepped down. Reads as a smile.
    bars = []
    for i, (dx, dy, w) in enumerate(((-0.30, -0.055, 0.34), (0.0, 0.012, 0.40), (0.30, -0.055, 0.34))):
        bars.append(("eye%s%02d" % (side, i + 1), "eye",
                     (sx * _EYE_X + dx * _EYE_W, _EYE_Y + dy * W, _EYE_Z),
                     (_EYE_W * w, _EYE_W * 0.46, 0.025 * W), (0.0, 0.0, 0.0)))
    return bars


def _slant(side, sx):
    return [("eye%s" % side, "eye", (sx * _EYE_X, _EYE_Y, _EYE_Z), (_EYE_W, _EYE_W * 0.95, 0.025 * W),
             (0.0, 0.0, sx * 17.0))]


EYE_SETS = {"flat": _eye_pair(_flat), "arc": _eye_pair(_arc), "slant": _eye_pair(_slant)}
DEFAULT_EYES = "flat"

# --------------------------------------------------------------------------- ball hands
#: Detached spheres that must FLOAT CLEAR of the skull -- at 0.615 W they intersected it, since
#: the head's half width is 0.5 W. No arm, no shoulder, no pivot chain -- the runtime floats them beside the head
#: and they are their own joints so they can bob independently.
HAND_R = 0.160 * W
HAND_X = 0.790 * W
HAND_Y = -0.195 * W
HAND_Z = 0.075 * W

# --------------------------------------------------------------------------- the ghost tail
#: A smooth tapering tube along a curve, not a stack of boxes. The first build made the wisp from ten
#: overlapping blocks and it read as a drill bit as soon as the material was bright enough to see it.
TAIL_PATH = [
    (0.0, -0.30 * W, 0.00 * W),
    (0.0, -0.58 * W, -0.10 * W),
    (0.0, -0.88 * W, -0.26 * W),
    (0.0, -1.16 * W, -0.50 * W),
    (0.0, -1.36 * W, -0.82 * W),
    (0.0, -1.44 * W, -1.18 * W),
    (0.0, -1.38 * W, -1.52 * W),
    (0.0, -1.22 * W, -1.78 * W),
    (0.0, -1.02 * W, -1.94 * W),
]
TAIL_RADII = [0.355 * W, 0.330 * W, 0.292 * W, 0.246 * W, 0.196 * W, 0.148 * W, 0.104 * W,
              0.064 * W, 0.030 * W]
TAIL_SIDES = 10

# --------------------------------------------------------------------------- flight
#: FOUNDER, 2026-09-22: "They need to be flying above the relay dog not around above." Cubs hold
#: station OVERHEAD, in a loose dome over the primary Dog, not in a ring at its feet. These are the
#: numbers the review staging and the integration contract both use, in multiples of the DOG's
#: height (1.74 m at its canonical W_UU 60) so they scale with whoever they are escorting.
FLIGHT = {
    "base_over_dog": 0.25,     # the lowest cub clears the Dog's ear line by this, x dog height
    "spread": 0.95,            # extra height between the lowest and highest cub, x dog height
    "radius_min": 0.15,        # horizontal offset from the Dog's axis, x dog height
    "radius_max": 0.75,
}

# --------------------------------------------------------------------------- assembly
JOINTS = ("root", "head", "handLeft", "handRight", "tail")
PARENTS = {"root": None, "head": "root", "handLeft": "root", "handRight": "root", "tail": "root"}
PIVOTS = {"root": (0.0, 0.0, 0.0),
          "head": (0.0, 0.0, 0.0),
          "handLeft": (-HAND_X, HAND_Y, HAND_Z),
          "handRight": (HAND_X, HAND_Y, HAND_Z),
          "tail": (0.0, HEAD_BOTTOM, 0.0)}
SURFACES = ("pearl", "visor", "eye", "ghost")


def parts_spec(eyes=DEFAULT_EYES):
    """(name, joint, surface, kind, payload). kind is box / sphere / tube."""
    out = []
    for name, surface, centre, size in HEAD_BOXES:
        out.append((name, "head", surface, "box", (centre, size, (0.0, 0.0, 0.0), CHAMFER)))
    for name, surface, centre, size, rot, _tip in SPUR_BOXES:
        out.append((name, "head", surface, "box", (centre, size, rot, CHAMFER)))
    for name, surface, centre, size, rot in EYE_SETS[eyes]:
        out.append((name, "head", surface, "box", (centre, size, rot, None)))
    out.append(("handLeft", "handLeft", "pearl", "sphere", ((-HAND_X, HAND_Y, HAND_Z), HAND_R)))
    out.append(("handRight", "handRight", "pearl", "sphere", ((HAND_X, HAND_Y, HAND_Z), HAND_R)))
    out.append(("tail", "tail", "ghost", "tube", (TAIL_PATH, TAIL_RADII, TAIL_SIDES)))
    return out


def parts(scale, eyes=DEFAULT_EYES):
    """{(joint, surface): [(name, kind, payload_ue)]}, every part in its joint's own frame and in
    Unreal axes, so a joint rotates its part about the canonical pivot."""
    out = {}
    for name, joint, surface, kind, payload in parts_spec(eyes):
        px, py, pz = PIVOTS[joint]

        def local(p):
            return (p[0] - px, p[1] - py, p[2] - pz)

        if kind == "box":
            centre, size, rot, extra = payload
            c_ue, d_ue = D.to_unreal(local(centre), size, scale)
            out.setdefault((joint, surface), []).append(
                (name, kind, (c_ue, d_ue, rot, None if extra is None else extra * scale)))
        elif kind == "sphere":
            centre, radius = payload
            c_ue, _ = D.to_unreal(local(centre), (0, 0, 0), scale)
            out.setdefault((joint, surface), []).append((name, kind, (c_ue, radius * scale)))
        elif kind == "tube":
            path, radii, sides = payload
            path_ue = [D.to_unreal(local(p), (0, 0, 0), scale)[0] for p in path]
            out.setdefault((joint, surface), []).append(
                (name, kind, (path_ue, [r * scale for r in radii], sides)))
    return out


def pivots_unreal(scale):
    return {j: D.to_unreal(p, (0, 0, 0), scale)[0] for j, p in PIVOTS.items()}


#: VFX SOCKETS. The world lane owns where they are; Internal Development owns what plays there.
SOCKETS = [
    ("head", "VFX_Visor", (0.0, (D.JAW_TOP + D.VISOR_TOP) / 2 - D.TORSO_TOP - HEAD_MID, FACE_Z + 0.03 * W)),
    ("head", "VFX_Halo", (0.0, HEAD_TOP + SPUR_H + 0.10 * W, 0.0)),
    ("head", "VFX_Core", (0.0, 0.0, 0.0)),                       # the emergence flash, inside the head
    ("head", "VFX_EyeLeft", (-_EYE_X, _EYE_Y, _EYE_Z + 0.02 * W)),
    ("head", "VFX_EyeRight", (_EYE_X, _EYE_Y, _EYE_Z + 0.02 * W)),
    ("tail", "VFX_TailTip", TAIL_PATH[-1]),                      # the sparkle trail and the dissolve
    ("tail", "VFX_TailMid", TAIL_PATH[3]),
    ("handLeft", "VFX_HandLeft", (-HAND_X, HAND_Y, HAND_Z)),
    ("handRight", "VFX_HandRight", (HAND_X, HAND_Y, HAND_Z)),
]


def sockets_unreal(scale):
    out = []
    for joint, name, off in SOCKETS:
        px, py, pz = PIVOTS[joint]
        out.append((joint, name, D.to_unreal((off[0] - px, off[1] - py, off[2] - pz), (0, 0, 0), scale)[0]))
    return out


#: Materials. Pearl is the Dog's ivory lifted and made glossier -- the plate's cubs are moulded
#: plastic catching light, not chalk. Visor and eye keep the Dog's canon shapes so the face cannot
#: drift; the eye runs hotter because on the plate it is the only light on the creature.
MATERIALS = {
    "pearl": {"color": "#F7F4EC", "roughness": 0.34, "metalness": 0.0, "emissive": None},
    "visor": dict(D.MATERIALS["visor"]),
    "eye": {"color": "#FFD86B", "roughness": 0.30, "metalness": 0.0, "emissive": ("#FFC24A", 2.4)},
    # Measured, not guessed: a four-way sweep on plain static mesh actors (0.26/14k, 0.45/45k,
    # 0.62/90k, 0.80/160k) against sunlit cream paving read invisible / soft and luminous / solid /
    # blown out. The ghost master is UNLIT, so brightness is in SCENE units against Wonderland's
    # daylight -- the first build authored 2.2 and rendered pure black.
    # An UNLIT surface has no shading, so a tube reads as a flat ribbon unless the fresnel does the
    # work of form. A warmer rim over more of the surface gives the tail roundness; a lower opacity
    # puts the world back behind it, which is what makes it a ghost rather than a white blade.
    "ghost": {"core": "#FFFBF0", "rim": "#FFD98A", "opacity": 0.30, "rim_power": 2.4,
              "brightness": 62000.0, "fade_strength": 0.38},
}


def height():
    """Tip of the ear spurs down to the lowest point of the tail, in W."""
    return (HEAD_TOP + SPUR_H) - min(p[1] - r for p, r in zip(TAIL_PATH, TAIL_RADII))


def measurements():
    low = min(p[1] - r for p, r in zip(TAIL_PATH, TAIL_RADII))
    return {"headWidth": W, "headSpan": HEAD_SPAN, "headTop": HEAD_TOP, "headBottom": HEAD_BOTTOM,
            "spurHeight": SPUR_H, "spurCantDeg": SPUR_CANT, "handRadius": HAND_R, "handX": HAND_X,
            "tailLowest": low, "totalHeight": height(), "eyeSets": len(EYE_SETS),
            "parts": len(parts_spec()), "joints": len(JOINTS),
            "headOverHeight": (HEAD_SPAN + SPUR_H) / height()}
