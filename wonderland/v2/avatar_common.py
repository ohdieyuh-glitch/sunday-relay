"""Shared bones of the PROJECT AVATAR production assets.

FOUNDER DIRECTIVE (2026-09-22). A Project Avatar is the living representation of a PROJECT, and it GROWS:
SMALL -> MEDIUM -> LARGE. The founder is explicit that these are NOT one model scaled three times -- each stage
must show real morphological development. So every family below declares three independent parameter sets and the
shapes are built from them; the only thing scaling does at the end is put the finished creature at the height the
runtime lane already expects.

THE LANE SPLIT, KEPT. Internal Development owns runtime: state, gait, hover, progression, spawning, multiplayer,
Brain integration. This lane owns the production asset: meshes, materials, silhouette, the joint structure a rig
needs, LODs, collision and packaging. Nothing here drives anything; it declares a body and where its joints are.

SCALE IS THE RUNTIME LANE'S NUMBER, NOT A NEW ONE. project_avatar_figures.py already fits its voxel placeholders
to TARGET_METRES = {small 1.15, medium 2.70, large 5.60}. These meshes are built in their own units and then fitted
to exactly those heights, so a LARGE avatar dropped at spawn stands at its intended mature size and needs no
shrinking to fit -- which the founder asked for specifically.

PART KINDS the builder understands: box, sphere, tube, cone, torus.

TWO FRAMES, SAID OUT LOUD, because this is exactly where an asset lane loses a day. POSITIONS and SIZES are
written in the web frame dog_canon uses -- X right, Y up, Z forward -- which is the frame a person can actually
reason about while placing a horn. `to_unreal` below converts them on the way into the engine with dog_canon's own
mapping, (x, y, z) -> (z, -x, y). ROTATIONS are the exception: a `rot` in these files is already an UNREAL ROTATOR
(pitch about Y, yaw about Z, roll about X) and is handed to the geometry builder untouched, because every rotated
part here is a horn, a tooth, a claw, a vane or a ring, each of which is far easier to aim in the frame it will
actually be drawn in than to specify in one frame and convert into another. A cone with no rotation points along
UNREAL +Z, i.e. straight up.
"""
import math

#: The heights the runtime lane already fits its placeholder figures to, in metres.
TARGET_METRES = {"small": 1.15, "medium": 2.70, "large": 5.60}
STAGES = ("small", "medium", "large")


def box(name, joint, surface, centre, size, rot=(0.0, 0.0, 0.0), chamfer=None):
    return (name, joint, surface, "box", (centre, size, rot, chamfer))


def sphere(name, joint, surface, centre, radius, steps=14):
    return (name, joint, surface, "sphere", (centre, radius, steps))


def tube(name, joint, surface, path, radii, sides=8):
    return (name, joint, surface, "tube", (path, radii, sides))


def cone(name, joint, surface, centre, r0, r1, height, rot=(0.0, 0.0, 0.0), steps=16):
    return (name, joint, surface, "cone", (centre, r0, r1, height, rot, steps))


def torus(name, joint, surface, centre, ring_r, tube_r, rot=(0.0, 0.0, 0.0), major=28, minor=10):
    return (name, joint, surface, "torus", (centre, ring_r, tube_r, rot, major, minor))


def eye(name, joint, centre, radius, surfaces=("eye_ring", "eye", "pupil"), ring=True, look=(0.0, 0.0, 1.0)):
    """A readable eye: a rim, a glowing iris and a dark pupil, stacked ALONG THE DIRECTION IT LOOKS.

    `look` is not decoration, it is the whole correctness of this function. The first version placed all three
    spheres concentrically, with the rim at 1.18x the iris radius -- so an opaque rim completely enclosed the
    glowing iris it was supposed to frame, and every ringed eye in the project rendered as a plain dark ball. The
    Cherubim's twelve eyes came back as twelve black beads on a gold wheel. It is the same failure as the Ten
    Tails' tail bulb and the Cub Ghost's sheath: in this project, a bigger opaque thing around a smaller bright
    thing always wins, and it always looks like the bright thing was never built.

    So the rim now sits BEHIND the iris and the pupil in FRONT of it, both offset along `look`. Pass the
    direction the eye actually faces; three spheres rather than a texture, because these creatures carry up to
    seventeen eyes and a painted eye is a smudge at any distance a player sees one from.

    `ring=False` drops the rim, and that is not a shortcut either: on a secondary eye the rim is under a pixel,
    while sitting on a DIFFERENT SURFACE from the iris and so costing a whole extra mesh, component and draw
    call on that joint. Ten of them is ten draw calls spent on something nobody can see.
    """
    rim, iris, pupil = surfaces
    d = _unit(look)
    out = []
    if ring:
        out.append(sphere(name + "_ring", joint, rim,
                          (centre[0] - d[0] * radius * 0.45,
                           centre[1] - d[1] * radius * 0.45,
                           centre[2] - d[2] * radius * 0.45), radius * 1.18, steps=12))
    out.append(sphere(name, joint, iris, centre, radius, steps=12))
    out.append(sphere(name + "_pupil", joint, pupil,
                      (centre[0] + d[0] * radius * 0.62,
                       centre[1] + d[1] * radius * 0.62,
                       centre[2] + d[2] * radius * 0.62), radius * 0.42, steps=10))
    return out


def extents(parts):
    """Axis-aligned bounds of a part list, in the creature's own units."""
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3

    def take(p, r):
        for i in range(3):
            lo[i] = min(lo[i], p[i] - r[i])
            hi[i] = max(hi[i], p[i] + r[i])

    for _n, _j, _s, kind, payload in parts:
        if kind == "box":
            c, size, _rot, _ch = payload
            take(c, (size[0] / 2.0, size[1] / 2.0, size[2] / 2.0))
        elif kind == "sphere":
            c, r, _steps = payload
            take(c, (r, r, r))
        elif kind == "cone":
            # A cone grows from its centre along its own rotated axis, so its true bounds depend on a rotation
            # this function deliberately does not model. Treat it as a sphere of its longest dimension: bounds
            # that are a little generous cost a creature a few centimetres of height, while bounds that are too
            # small would let fit_scale place a LARGE avatar ABOVE its target and break the founder's one hard
            # requirement -- that a LARGE form arrive at its intended size.
            c, r0, r1, h, _rot, _steps = payload
            r = max(r0, r1, h)
            take(c, (r, r, r))
        elif kind == "torus":
            c, ring_r, tube_r, _rot, _maj, _min = payload
            r = ring_r + tube_r
            take(c, (r, r, r))
        elif kind == "tube":
            path, radii, _sides = payload
            for p, r in zip(path, radii):
                take(p, (r, r, r))
    return tuple(lo), tuple(hi)


def fit_scale(parts, target_metres):
    """The uniform scale that puts this creature at the height the runtime lane expects, in centimetres."""
    lo, hi = extents(parts)
    height = hi[1] - lo[1]
    if height <= 0.0:
        return 1.0
    return (target_metres * 100.0) / height


def deck_offset(parts):
    """How far a body must be lifted so its lowest geometry sits exactly on y=0.

    Every family here is authored around a natural centre -- a hip height, a ring hub, a spindle base -- and then
    something hangs below it: a lowered wing pair, a claw, a flame train. Rather than fudge each family's centre
    until nothing dips, the builder lifts the finished body by this one number, so the contract "the mesh origin
    is on the deck" holds for all three families by construction instead of by three separate near-misses.
    """
    return -extents(parts)[0][1]


def lift(parts, dy):
    """Return the same part list moved up by dy. Used once, by the builder, after deck_offset."""
    def mv(pt):
        return (pt[0], pt[1] + dy, pt[2])
    out = []
    for name, joint, surface, kind, payload in parts:
        if kind == "box":
            c, size, rot, ch = payload
            payload = (mv(c), size, rot, ch)
        elif kind == "sphere":
            c, r, st = payload
            payload = (mv(c), r, st)
        elif kind == "cone":
            c, r0, r1, h, rot, st = payload
            payload = (mv(c), r0, r1, h, rot, st)
        elif kind == "torus":
            c, R, tb, rot, maj, mnr = payload
            payload = (mv(c), R, tb, rot, maj, mnr)
        elif kind == "tube":
            path, radii, sides = payload
            payload = ([mv(q) for q in path], radii, sides)
        out.append((name, joint, surface, kind, payload))
    return out


def tri_estimate(parts):
    """Roughly what this costs before it is built, so a stage can be judged for budget on paper."""
    total = 0
    for _n, _j, _s, kind, payload in parts:
        if kind == "box":
            total += 12 if payload[3] is None else 48
        elif kind == "sphere":
            steps = payload[2]
            total += steps * steps
        elif kind == "cone":
            total += payload[5] * 4
        elif kind == "torus":
            total += payload[4] * payload[5] * 2
        elif kind == "tube":
            total += (len(payload[0]) - 1) * payload[2] * 2
    return total


def _unit(v):
    L = math.sqrt(sum(c * c for c in v)) or 1.0
    return (v[0] / L, v[1] / L, v[2] / L)


def aim_x(direction, roll=0.0):
    """The Unreal Rotator that points a part's LOCAL +X along `direction`, given in the web frame.

    This is the one piece of frame arithmetic in the avatar lane, written once and tested, because aiming a
    horn or a wing by hand-guessing a rotator is how an asset ends up with its wings on backwards and nobody
    able to say which of three sign conventions was wrong. gs.py's own sweep frame uses the same derivation.
    """
    dx, dy, dz = _unit(direction)
    ux, uy, uz = dz, -dx, dy                      # web -> Unreal, exactly to_unreal's mapping
    pitch = math.degrees(math.asin(max(-1.0, min(1.0, uz))))
    yaw = math.degrees(math.atan2(uy, ux))
    return (pitch, yaw, roll)


def aim_z(direction, roll=0.0):
    """The Unreal Rotator that points a part's LOCAL +Z along `direction` (web frame).

    Cones and cylinders are built up the local +Z axis, so horns, teeth, claws and spines aim with this one and
    boxes and vanes aim with aim_x. Derived from the Rotator's own order -- roll about X, then pitch about Y,
    then yaw about Z -- rather than assumed: under pitch p and yaw y, local +Z lands on
    (-sin p cos y, -sin p sin y, cos p), which inverts to the two lines below.
    """
    dx, dy, dz = _unit(direction)
    ux, uy, uz = dz, -dx, dy
    pitch = math.degrees(math.acos(max(-1.0, min(1.0, uz))))
    yaw = math.degrees(math.atan2(-uy, -ux))
    return (pitch, yaw, roll)


def blade(name, joint, surface, root, direction, length, width, thick, roll=0.0, chamfer=None):
    """A flat swept vane -- a wing feather, a fin, a fletch -- growing from `root` along `direction`.

    The box is authored long on the LOCAL +X axis and aimed with aim_x, so a wing is described the way a person
    thinks about one (it starts here, it goes that way, it is this long) instead of as three Euler angles whose
    correctness can only be checked by rendering it.

    ROLL MATTERS MORE THAN IT LOOKS. With roll=0 a blade's WIDTH axis comes out horizontal: local +Y lands on
    (-sin yaw, cos yaw, 0), pitch having left it alone because pitch turns about Y itself. A horizontal vane seen
    by someone standing on the ground is edge-on, so it renders as a splinter no matter how wide it is -- which
    is exactly what the first render showed on every Cherubim vane and every Seraph pinion. Pass roll=90 for
    anything meant to be read broadside from ground level. This is the Bee's wing lesson wearing a new hat.
    """
    d = _unit(direction)
    centre = (root[0] + d[0] * length * 0.5, root[1] + d[1] * length * 0.5, root[2] + d[2] * length * 0.5)
    return (name, joint, surface, "box", (centre, (width, thick, length), aim_x(direction, roll), chamfer))


def to_unreal(centre, size=(0.0, 0.0, 0.0), scale=1.0):
    """Web (x right, y up, z forward) -> Unreal (x forward, y right, z up), scaled. Exactly dog_canon.to_unreal,
    repeated here so an avatar canon never has to import the Dog to place a point."""
    x, y, z = centre
    w, h, d = size
    return ((z * scale, -x * scale, y * scale), (d * scale, w * scale, h * scale))


def ring_of(n, radius, y, phase=0.0, tilt=0.0):
    """n points evenly around a ring in the XZ plane at height y -- how secondary eyes, teeth and tail roots are
    placed without writing a coordinate per item."""
    out = []
    for i in range(n):
        a = math.radians(phase + 360.0 * i / n)
        out.append((radius * math.cos(a),
                    y + math.sin(math.radians(tilt)) * radius * math.sin(a),
                    radius * math.sin(a) * math.cos(math.radians(tilt))))
    return out


def fan_of(n, spread_deg, length, y, rise_deg, base_z=0.0):
    """n directions in a horizontal fan, each a (dx, dy, dz) unit-ish vector times length -- the Ten Tails' tail
    arrangement, and the reason its LARGE form reads as a sunburst rather than a bundle."""
    out = []
    for i in range(n):
        t = 0.0 if n == 1 else (i / float(n - 1)) - 0.5
        a = math.radians(t * spread_deg)
        rise = math.radians(rise_deg * (1.0 - abs(t) * 1.1))
        out.append((math.sin(a) * math.cos(rise) * length,
                    y + math.sin(rise) * length,
                    base_z - math.cos(a) * math.cos(rise) * length))
    return out
