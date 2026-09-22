"""CHERUBIM -- the Project Avatar of ordered structure, as a production asset.

A DIFFERENT ANIMAL, DELIBERATELY. The founder asked for three families, and three families are only worth having
if their silhouettes cannot be confused at 60 m. Ten Tails is a quadruped beast that stands on the ground and
streams backward. The Cherubim is its opposite in every structural choice: it has no legs and never touches the
floor, it is RADIAL rather than fore-and-aft, it is built of rings and vanes rather than hide and bone, and it is
read from any angle rather than from the side. Ezekiel's wheel within a wheel, full of eyes.

WHAT GROWS:

  SMALL   ONE ring, hanging vertically, with a sealed core inside it and a single eye. Two stub vanes. No spokes,
          no halo: an unopened thing, more instrument than creature.
  MEDIUM  TWO rings, now on perpendicular axes, so the silhouette stops being a disc and becomes a gyroscope.
          Four vanes, each grown to two blades. Four eyes around the primary ring. The core has cracked open into
          four spokes and lit; a thin halo appears above.
  LARGE   THREE nested rings on three axes -- the wheel within a wheel is literal. SIX vanes of four blades each.
          TWELVE eyes distributed across all three rings. Eight spokes, a crowned halo, and six shards orbiting
          free of the frame entirely, which is the stage's real tell: at LARGE the construct is no longer one
          object but a system holding itself together.

Ring count, vane count, blades per vane, eye count, spoke count and shard count all move independently. None of
them is a scale factor.

NO GROUND CONTACT, AND THE BOUNDS SAY SO. The construct is authored with its lowest geometry at y=0 so its mesh
bounds sit on the floor like every other asset in this project, and so fit_scale measures the CREATURE rather
than a column of empty hover space. How high it actually floats is Internal Development's number, not this
lane's -- they lift the actor; we hand them a body whose origin is on the deck.

FRAME. Positions and sizes in the web frame (X right, Y up, Z forward); every `rot` is an Unreal Rotator produced
by avatar_common's verified aim_x/aim_z rather than typed by hand.
"""
import math

from avatar_common import aim_z, blade, box, eye, sphere, torus, tube

FAMILY = "Cherubim"

#: Axis 0 = ring standing vertical facing forward, 1 = vertical facing sideways, 2 = lying flat.
#: The order matters: it is the order the rings APPEAR in as the avatar develops, so MEDIUM's pair is already
#: perpendicular and LARGE's third ring completes the gyroscope rather than thickening a disc.
RING_AXES = (0, 1, 2)
RING_NORMALS = {0: (0.0, 0.0, 1.0), 1: (1.0, 0.0, 0.0), 2: (0.0, 1.0, 0.0)}

STAGES = {
    "small": dict(
        rings=1, ring_r=34.0, ring_falloff=0.78, ring_tube=4.2, studs=0,
        core_r=11.0, shell=0, spokes=0, spoke_w=0.0,
        wings=2, blades=1, wing_len=30.0, wing_w=13.0, wing_thick=2.0, wing_sweep=26.0,
        eyes=(1, 0, 0), eye_r=4.2, halo=0.0, halo_tube=0.0, crown=0, shards=0, shard_r=0.0),
    "medium": dict(
        rings=2, ring_r=76.0, ring_falloff=0.76, ring_tube=7.0, studs=8,
        core_r=22.0, shell=4, spokes=4, spoke_w=7.0,
        wings=4, blades=2, wing_len=74.0, wing_w=28.0, wing_thick=3.4, wing_sweep=32.0,
        eyes=(4, 0, 0), eye_r=7.5, halo=30.0, halo_tube=3.0, crown=0, shards=0, shard_r=0.0),
    "large": dict(
        rings=3, ring_r=158.0, ring_falloff=0.74, ring_tube=13.0, studs=16,
        core_r=46.0, shell=8, spokes=8, spoke_w=15.0,
        wings=6, blades=4, wing_len=168.0, wing_w=60.0, wing_thick=6.5, wing_sweep=38.0,
        eyes=(6, 4, 2), eye_r=14.0, halo=68.0, halo_tube=6.0, crown=8, shards=6, shard_r=232.0),
}

MATERIALS = {
    "frame":    {"color": "#C9CBD4", "roughness": 0.28, "metalness": 0.85, "emissive": None},
    "gild":     {"color": "#E8C87A", "roughness": 0.22, "metalness": 0.95, "emissive": None},
    "vane":     {"color": "#F4F1E8", "roughness": 0.34, "metalness": 0.05, "emissive": None},
    "vane_tip": {"color": "#E3D3A8", "roughness": 0.26, "metalness": 0.40, "emissive": None},
    "core":     {"color": "#FFF2CC", "roughness": 0.10, "metalness": 0.0,  "emissive": 60000.0},
    "shard":    {"color": "#DCDCE4", "roughness": 0.18, "metalness": 0.70, "emissive": None},
    "eye_ring": {"color": "#2C2C34", "roughness": 0.30, "metalness": 0.20, "emissive": None},
    "eye":      {"color": "#9FD8FF", "roughness": 0.08, "metalness": 0.0,  "emissive": 56000.0},
    "pupil":    {"color": "#0B1018", "roughness": 0.12, "metalness": 0.0,  "emissive": None},
}

SOCKET_KINDS = ("VFX_Core", "VFX_Ring", "VFX_Halo", "VFX_WingTip", "VFX_Shard")


def centre_y(stage):
    """The construct hangs its largest ring so the lowest geometry is on the deck."""
    p = STAGES[stage]
    return p["ring_r"] + p["ring_tube"]


def ring_radius(p, i):
    return p["ring_r"] * (p["ring_falloff"] ** i)


def joints(stage):
    p = STAGES[stage]
    out = ["root", "core"]
    out += ["ring_%02d" % i for i in range(p["rings"])]
    if p["halo"] > 0.0:
        out.append("halo")
    for w in range(p["wings"]):
        out += ["wing_%02d_a" % w, "wing_%02d_b" % w]
    out += ["shard_%02d" % s for s in range(p["shards"])]
    return out


def parents(stage):
    p = STAGES[stage]
    out = {"root": None, "core": "root"}
    for i in range(p["rings"]):
        out["ring_%02d" % i] = "core"
    if p["halo"] > 0.0:
        out["halo"] = "core"
    for w in range(p["wings"]):
        # the outer half of a vane is its own joint, so a wing can BEAT rather than swing rigidly from the hub
        out["wing_%02d_a" % w] = "core"
        out["wing_%02d_b" % w] = "wing_%02d_a" % w
    for s in range(p["shards"]):
        out["shard_%02d" % s] = "core"
    return out


def _ring_point(axis, R, cy, deg):
    a = math.radians(deg)
    if axis == 0:
        return (R * math.cos(a), cy + R * math.sin(a), 0.0)
    if axis == 1:
        return (0.0, cy + R * math.sin(a), R * math.cos(a))
    return (R * math.cos(a), cy, R * math.sin(a))


def _ring_out(axis, deg):
    """The outward normal at a point on a ring -- which way an eye on that ring looks, and which way a stud
    stands proud of the rim."""
    a = math.radians(deg)
    if axis == 0:
        return (math.cos(a), math.sin(a), 0.0)
    if axis == 1:
        return (0.0, math.sin(a), math.cos(a))
    return (math.cos(a), 0.0, math.sin(a))


def _wing_dirs(p):
    """Vane directions. Wings come in mirrored PAIRS, and each pair takes its own rise angle, so six wings read
    as three pairs (one raised, one level, one lowered) exactly the way the source imagery arranges them --
    never as six identical spokes, which is what an even fan would give."""
    pairs = max(1, p["wings"] // 2)
    rises = {1: (14.0,), 2: (34.0, -8.0), 3: (46.0, 6.0, -34.0)}.get(pairs, (14.0,) * pairs)
    sweep = math.radians(p["wing_sweep"])
    out = []
    for k in range(pairs):
        r = math.radians(rises[k])
        for side in (-1, 1):
            out.append((side * math.cos(r) * math.cos(sweep), math.sin(r), -math.cos(r) * math.sin(sweep)))
    return out[:p["wings"]]


def pivots(stage):
    p = STAGES[stage]
    cy = centre_y(stage)
    out = {"root": (0.0, 0.0, 0.0), "core": (0.0, cy, 0.0)}
    for i in range(p["rings"]):
        out["ring_%02d" % i] = (0.0, cy, 0.0)          # rings spin about the hub they share
    if p["halo"] > 0.0:
        out["halo"] = (0.0, cy + ring_radius(p, 0) * 0.92 + p["halo"] * 0.35, 0.0)
    for w, d in enumerate(_wing_dirs(p)):
        root = (d[0] * p["core_r"] * 1.05, cy + d[1] * p["core_r"] * 1.05, d[2] * p["core_r"] * 1.05)
        out["wing_%02d_a" % w] = root
        out["wing_%02d_b" % w] = (root[0] + d[0] * p["wing_len"] * 0.44,
                                  root[1] + d[1] * p["wing_len"] * 0.44,
                                  root[2] + d[2] * p["wing_len"] * 0.44)
    for s in range(p["shards"]):
        a = 360.0 * s / max(1, p["shards"])
        out["shard_%02d" % s] = (p["shard_r"] * math.cos(math.radians(a)),
                                 cy + p["shard_r"] * 0.22 * math.sin(math.radians(a * 2.0)),
                                 p["shard_r"] * math.sin(math.radians(a)))
    return out


def parts(stage):
    p = STAGES[stage]
    cy = centre_y(stage)
    out = []

    # ---- core: a lit sphere, sheathed at MEDIUM and LARGE by plates that have cracked apart
    out.append(sphere("core", "core", "core", (0.0, cy, 0.0), p["core_r"], steps=16))
    for i in range(p["shell"]):
        a = 360.0 * i / p["shell"] + 22.5
        d = _ring_out(2, a)
        # These slabs run ALONG their outward direction, so a centre at 1.30 core radii and a length of 1.30
        # put their inner ends at 0.65 -- well inside the core sphere, caging the only lit thing on the
        # creature. Pushed out, they read as a cracked shell with the light showing between them.
        r = p["core_r"] * 1.66
        out.append(box("shell_%02d" % i, "core", "frame",
                       (d[0] * r, cy + p["core_r"] * 0.10 * math.sin(math.radians(a * 3.0)), d[2] * r),
                       (p["core_r"] * 0.52, p["core_r"] * 0.98, p["core_r"] * 0.30),
                       rot=aim_z(d), chamfer=p["core_r"] * 0.07))

    # ---- spokes: the core reaching out to hold the primary ring
    for i in range(p["spokes"]):
        a = 360.0 * i / p["spokes"]
        d = _ring_out(0 if i % 2 == 0 else 2, a)
        out.append(blade("spoke_%02d" % i, "core", "gild",
                         (d[0] * p["core_r"] * 0.9, cy + d[1] * p["core_r"] * 0.9, d[2] * p["core_r"] * 0.9),
                         d, ring_radius(p, 0) - p["core_r"] * 0.85, p["spoke_w"], p["spoke_w"] * 0.42,
                         chamfer=p["spoke_w"] * 0.16))

    # ---- rings. One, then two perpendicular, then three: the silhouette changes CLASS at each stage.
    for i in range(p["rings"]):
        axis = RING_AXES[i]
        R = ring_radius(p, i)
        tb = p["ring_tube"] * (1.0 - 0.16 * i)
        out.append(torus("ring_%02d" % i, "ring_%02d" % i, "frame" if i else "gild",
                         (0.0, cy, 0.0), R, tb, rot=aim_z(RING_NORMALS[axis]),
                         major=32 if R > 100 else 24, minor=10))
        for s in range(p["studs"] if i == 0 else p["studs"] // 2):
            n = max(1, p["studs"] if i == 0 else p["studs"] // 2)
            a = 360.0 * s / n
            pt = _ring_point(axis, R + tb * 0.5, cy, a)
            d = _ring_out(axis, a)
            out.append(box("stud_%d_%02d" % (i, s), "ring_%02d" % i, "gild", pt,
                           (tb * 1.1, tb * 1.9, tb * 1.1), rot=aim_z(d), chamfer=tb * 0.25))

    # ---- eyes, distributed across the rings that exist. "Full of eyes" is the Cherubim's whole identity, so
    # the count rises 1 -> 4 -> 12 and, at LARGE, onto all three rings rather than crowding one.
    for i, n in enumerate(p["eyes"][:p["rings"]] if p["rings"] > 1 else p["eyes"][:1]):
        if not n:
            continue
        axis = RING_AXES[i]
        R = ring_radius(p, i)
        for k in range(n):
            a = 360.0 * k / n + (18.0 * i)
            if i == 0 and p["rings"] == 1:
                pt, d = (0.0, cy, p["core_r"] * 0.94), (0.0, 0.0, 1.0)
                joint = "core"
            else:
                d = _ring_out(axis, a)
                pt = _ring_point(axis, R - p["ring_tube"] * 0.9, cy, a)
                joint = "ring_%02d" % i
            out.extend(eye("eye_%d_%02d" % (i, k), joint,
                           (pt[0] - d[0] * p["eye_r"] * 0.2,
                            pt[1] - d[1] * p["eye_r"] * 0.2,
                            pt[2] - d[2] * p["eye_r"] * 0.2), p["eye_r"], ring=(i == 0), look=d))

    # ---- vanes. Each wing is a root blade plus `blades` feather blades fanning off the outer joint.
    for w, d in enumerate(_wing_dirs(p)):
        root = (d[0] * p["core_r"] * 1.05, cy + d[1] * p["core_r"] * 1.05, d[2] * p["core_r"] * 1.05)
        out.append(blade("wingroot_%02d" % w, "wing_%02d_a" % w, "gild", root, d,
                         p["wing_len"] * 0.46, p["wing_w"] * 0.72, p["wing_thick"] * 1.7,
                         roll=90.0, chamfer=p["wing_thick"] * 0.5))
        mid = (root[0] + d[0] * p["wing_len"] * 0.44,
               root[1] + d[1] * p["wing_len"] * 0.44,
               root[2] + d[2] * p["wing_len"] * 0.44)
        for b in range(p["blades"]):
            f = 0.0 if p["blades"] == 1 else (b / float(p["blades"] - 1)) - 0.5
            spread = math.radians(f * 46.0)
            # fan each blade within the wing's own plane: rotate the direction about the up axis
            bx = d[0] * math.cos(spread) - d[2] * math.sin(spread)
            bz = d[0] * math.sin(spread) + d[2] * math.cos(spread)
            bd = (bx, d[1] + f * 0.30, bz)
            L = p["wing_len"] * (0.78 - 0.20 * abs(f) * 2.0)
            # roll=90: broadside to someone on the ground. Flat-horizontal vanes rendered as white splinters.
            out.append(blade("wingblade_%02d_%d" % (w, b), "wing_%02d_b" % w, "vane", mid, bd,
                             L, p["wing_w"] * (1.0 - 0.28 * abs(f) * 2.0), p["wing_thick"],
                             roll=90.0, chamfer=p["wing_thick"] * 0.4))
            tip = (mid[0] + bd[0] * L * 0.92, mid[1] + bd[1] * L * 0.92, mid[2] + bd[2] * L * 0.92)
            out.append(blade("wingtip_%02d_%d" % (w, b), "wing_%02d_b" % w, "vane_tip", tip, bd,
                             L * 0.22, p["wing_w"] * 0.42, p["wing_thick"] * 0.9, roll=90.0))

    # ---- halo, and at LARGE a crown of uprights on it
    if p["halo"] > 0.0:
        hy = cy + ring_radius(p, 0) * 0.92 + p["halo"] * 0.35
        out.append(torus("halo", "halo", "gild", (0.0, hy, 0.0), p["halo"], p["halo_tube"],
                         rot=aim_z((0.0, 1.0, 0.0)), major=24, minor=8))
        for c in range(p["crown"]):
            a = 360.0 * c / p["crown"]
            pt = _ring_point(2, p["halo"], hy, a)
            out.append(blade("crown_%02d" % c, "halo", "gild", pt, (0.0, 1.0, 0.0),
                             p["halo"] * 0.52 * (1.0 if c % 2 == 0 else 0.62),
                             p["halo_tube"] * 2.0, p["halo_tube"] * 0.9, chamfer=p["halo_tube"] * 0.3))

    # ---- shards: at LARGE the construct stops being one object
    pv = pivots(stage)
    for s in range(p["shards"]):
        c = pv["shard_%02d" % s]
        n = _ring_out(2, 360.0 * s / max(1, p["shards"]))
        out.append(box("shard_%02d" % s, "shard_%02d" % s, "shard", c,
                       (p["core_r"] * 0.34, p["core_r"] * 0.92, p["core_r"] * 0.34),
                       rot=aim_z((n[0], 0.55, n[2])), chamfer=p["core_r"] * 0.09))
    return out


def sockets(stage):
    p = STAGES[stage]
    pv = pivots(stage)
    cy = centre_y(stage)
    out = [("VFX_Core", "core", (0.0, cy, 0.0))]
    for i in range(p["rings"]):
        out.append(("VFX_Ring_%02d" % i, "ring_%02d" % i,
                    _ring_point(RING_AXES[i], ring_radius(p, i), cy, 0.0)))
    if p["halo"] > 0.0:
        out.append(("VFX_Halo", "halo", pv["halo"]))
    for w, d in enumerate(_wing_dirs(p)):
        root = (d[0] * p["core_r"] * 1.05, cy + d[1] * p["core_r"] * 1.05, d[2] * p["core_r"] * 1.05)
        L = p["wing_len"]
        out.append(("VFX_WingTip_%02d" % w, "wing_%02d_b" % w,
                    (root[0] + d[0] * L, root[1] + d[1] * L, root[2] + d[2] * L)))
    for s in range(p["shards"]):
        out.append(("VFX_Shard_%02d" % s, "shard_%02d" % s, pv["shard_%02d" % s]))
    return out


def eye_count(stage):
    p = STAGES[stage]
    return sum(p["eyes"][:p["rings"]] if p["rings"] > 1 else p["eyes"][:1])


def collision_capsule(stage):
    """(radius, half_height, centre_y) in canon units, around the hub and the primary ring -- not around the
    vane span, which is thin, open and something a player should be able to walk through the gaps of."""
    p = STAGES[stage]
    R = ring_radius(p, 0)
    return (R * 0.55, R * 1.00, centre_y(stage))
