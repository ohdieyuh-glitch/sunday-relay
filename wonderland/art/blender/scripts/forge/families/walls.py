"""Curtain wall, mural towers, posterns, bastions, stairs: the city's EDGE.

THE REFERENCE GAP. A city reads as a place rather than as a cluster of towers
because it has an edge — a line where it stops on purpose. The founder
reference has one: a walled, terraced boundary between the garden you stand in
and the city behind it, with towers standing ON that line rather than beside it.

`layout_v2` cannot draw that today. It has excellent colonnades (PASS 30's
South Reach ends on nineteen columns "so the world's southern edge is a made
line rather than a fade" — the right instinct, reached with the wrong tool: a
colonnade is transparent, and an edge needs to be opaque somewhere). It has
`gatehouse_district`, which is a point, not a line. What it has never had is a
WALL: a run that butts to itself, turns corners, carries towers, and can be
walked along the top of.

FIVE MODULES THAT MAKE A CIRCUIT. Everything here is designed to be assembled
into a closed loop by a generator that only knows two things — the run length
and the turn angle:

    Curtain_Run   ->  Curtain_Run  ->  Corner_Bastion (90 deg)  ->  Curtain_Run
        |                  |                                            |
    Mural_Tower       Postern_Gate                                 Stair_Flight

WHY THE WALL-WALK MATTERS MORE THAN THE WALL. `walkable.py --window=world` and
`route.py` audit the world's traversal, and PASS 30's whole finding was that a
place can be full of actors and still be nothing to arrive at. A wall you can
only look at is scenery. Every module here has a 3.4 m wall-walk at a single
shared height (6.20 m), the stair reaches it in risers of 0.31 m, and the
parapet is 1.15 m — so the circuit is a ROUTE, and the Dog can use it.
"""

import math

from .. import elements as E
from .. import kit as K
from .. import mesh as M

XL, L, MD, S = K.LADDER["XL"], K.LADDER["L"], K.LADDER["M"], K.LADDER["S"]

#: The one number every module in this family shares. A wall-walk at a
#: different height in two modules is a circuit with a step in it.
WALK_Z = 6.20
#: Wall thickness at the walk, and the batter at the foot.
WALL_T = 3.40
BATTER = 0.55
#: Parapet height above the walk. 1.15 m: over a Relay Dog's head, under the
#: eye line of a camera standing on the walk.
PARAPET = 1.15


def _wall_section(part, dark, length, x0=0.0, matrix=None, slits=True):
    """One straight length of curtain: battered face, walk, parapet, merlons.

    Shared by the run, the postern and the bastion's two arms, so a wall's
    section can never disagree with itself where two modules meet.
    """
    made = []
    ht = WALL_T * 0.5
    # the battered foot: a wall that leans in reads as thick, and a vertical
    # slab reads as a fence however thick it actually is
    made += part.loft([
        [(-length * 0.5 + x0, -(ht + BATTER), 0.0), (length * 0.5 + x0, -(ht + BATTER), 0.0),
         (length * 0.5 + x0, (ht + BATTER), 0.0), (-length * 0.5 + x0, (ht + BATTER), 0.0)],
        [(-length * 0.5 + x0, -ht, 2.60), (length * 0.5 + x0, -ht, 2.60),
         (length * 0.5 + x0, ht, 2.60), (-length * 0.5 + x0, ht, 2.60)]],
        matrix=matrix, smooth=False)
    # THE WALL BODY STOPS UNDER THE STRING COURSE, not at the walk. It first
    # ran the full way to WALK_Z, which put its top face in the same plane as
    # the string course's, one 3.40 m wide and one 3.60 m, sharing a centre --
    # textbook z-fighting. The validator caught it on the postern and the
    # bastion; the curtain run had it too and slipped under the area tolerance,
    # which is why that tolerance was widened afterwards.
    made += part.box(length, WALL_T, WALK_Z - 0.62 - 2.60, at=(x0, 0.0, 2.60),
                     matrix=matrix, centre_z=False)
    if slits:
        n = max(1, int(length // 4.0))
        for i in range(n):
            x = x0 - length * 0.5 + length * (i + 0.5) / n
            for dy in (-1.0, 1.0):
                made += part.box(0.34, 0.26, 1.90, at=(x, dy * (ht - 0.06), 3.55),
                                 matrix=matrix, chamfer=0.07, centre_z=False)
    # the string course under the walk: the shadow line that says "top"
    made += part.box(length, WALL_T + 0.46, 0.30, at=(x0, 0.0, WALK_Z - 0.62),
                     matrix=matrix, chamfer=0.07, centre_z=False)
    made += part.box(length, WALL_T + 0.20, 0.18, at=(x0, 0.0, WALK_Z - 0.32),
                     matrix=matrix, chamfer=0.06, centre_z=False)
    # the walk itself, and the parapets either side of it
    dark.box(length, WALL_T - 1.30, 0.14, at=(x0, 0.0, WALK_Z - 0.14),
             matrix=matrix, centre_z=False)
    for dy in (-1.0, 1.0):
        made += part.box(length, 0.62, PARAPET, at=(x0, dy * (ht - 0.31), WALK_Z),
                         matrix=matrix, chamfer=0.09, centre_z=False)
        n = max(2, int(length // 1.7))
        for i in range(n):
            x = x0 - length * 0.5 + length * (i + 0.5) / n
            made += part.box(length / n * 0.56, 0.68, 0.72,
                             at=(x, dy * (ht - 0.31), WALK_Z + PARAPET),
                             matrix=matrix, chamfer=0.10, centre_z=False)
    return made


def wall_curtain_run(part_len=13.6):
    """Closure returning the builder, so the run length is one constant."""
    def build(f):
        p = f.part("stone")
        d = f.part("stone_dark")
        _wall_section(p, d, part_len)
        return K.ModuleSpec(
            "WL_Wall_Curtain_Run", "wall", "structure", "screen",
            f.emit("WL_Wall_Curtain_Run"),
            [K.Socket("bottom", 0.0, part_len * 0.5, "ground"),
             K.Socket("walk", WALK_Z, part_len * 0.5, "bridge_end",
                      "3.4 m wall-walk at 6.20 m; every module in this family shares it"),
             K.Socket("end_a", 0.0, WALL_T * 0.5, "pier",
                      "square section at x = -%.2f m; butts to another run" % (part_len * 0.5)),
             K.Socket("end_b", 0.0, WALL_T * 0.5, "pier",
                      "square section at x = +%.2f m; butts to another run" % (part_len * 0.5))],
            districts=("city", "castle", "plaza", "hamlet"),
            note="13.6 m of battered curtain wall with a walk, parapets and merlons "
                 "both sides; butts end to end into any length",
            params={"length_m": part_len, "walk_z_m": WALK_Z,
                    "thickness_m": WALL_T, "parapet_m": PARAPET},
            tri_budget=16000, collision=True)
    build.__name__ = "wall_curtain_run"
    return build


def wall_mural_tower(f):
    """A half-round tower ON the wall line: 19.4 m, and it butts both ways.

    The module that makes a wall read as defended rather than as a fence.
    Deliberately a D-shape rather than a full drum, because a mural tower's
    back is the wall — a full drum standing on a wall line leaves two
    awkward crescents of nothing where the curtain meets it.

    It carries the tower family's own corbel table, merlons and needle, so a
    wall and the towers behind it are recognisably one city.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    r = f.part("roof")
    g = f.part("gold")
    gl = f.part("glass")
    R = 4.40
    H = 19.4
    # the D: a 220-degree half-drum in front of a straight back
    p.lathe([(R * 1.20, 0.0), (R * 1.20, 1.10), (R * 1.06, 1.85)],
            segments=16, arc=220.0, matrix=M.xform((0, 0, 0), (0, 0, -110.0)),
            smooth=False)
    body = p.lathe(M.entasis(R * 1.02, R * 0.96, 1.85, 12.60, steps=6),
                   segments=16, arc=220.0,
                   matrix=M.xform((0, 0, 0), (0, 0, -110.0)), smooth=False)
    p.displace(body, 0.030, 1.6, seed=211)
    # 12.44, not 12.60: level with the drum's cap the back wall put 8 m2 of
    # up-facing stone in the drum's own plane. The drum now oversails it.
    p.box(R * 1.94, 1.30, 12.44, at=(0.0, -R * 0.52, 0.0), chamfer=0.16,
          centre_z=False)
    d.box(R * 1.60, 0.90, 10.10, at=(0.0, -R * 0.44, 1.85), centre_z=False)
    for (x, y, a) in K.radial(3, R * 1.00, phase=1.05):
        if y < -0.4:
            continue
        E.window_arched(p, (x, y, 7.60), 0.80, 2.30, depth=0.26, rot=(0, 0, a),
                        kind="ogee", glass_part=gl)
    for (x, y, a) in K.radial(3, R * 1.00, phase=1.05):
        if y < -0.4:
            continue
        p.box(0.32, 0.26, 1.85, at=(x, y, 3.40), rot=(0, 0, a), chamfer=0.07,
              centre_z=False)
    E.corbel_table(p, 12.60, R * 0.98, count=14, depth=0.34, drop=0.50)
    p.lathe([(R * 1.08, 13.18), (R * 1.08, 15.00)], segments=16, arc=250.0,
            matrix=M.xform((0, 0, 0), (0, 0, -125.0)), smooth=False)
    for (mx, my, ma) in K.radial(12, R * 1.04):
        if my < -R * 0.30:
            continue
        p.box(0.56, 0.37, 0.86, at=(mx, my, 15.00), rot=(0, 0, ma),
              chamfer=0.06, centre_z=False)
    p.lathe([(R * 1.02, 15.00), (MD * 0.94, 15.90)], segments=16, arc=250.0,
            matrix=M.xform((0, 0, 0), (0, 0, -125.0)), smooth=False)
    r.lathe(M.needle(MD * 0.94, 3.10, steps=6, concavity=0.36, z0=15.90),
            segments=16, smooth=True)
    E.finial(p, (0.0, 0.0, 18.60), 0.95, radius=0.18, gold=g)
    return K.ModuleSpec(
        "WL_Wall_Mural_Tower", "wall", "structure", "screen",
        f.emit("WL_Wall_Mural_Tower"),
        [K.Socket("bottom", 0.0, R * 1.20, "ground"),
         K.Socket("walk", WALK_Z, R * 1.20, "bridge_end",
                  "the curtain's 6.20 m walk passes through the tower"),
         K.Socket("end_a", 0.0, WALL_T * 0.5, "pier",
                  "the wall butts on the flat back, at y = -2.29 m, either side"),
         K.Socket("end_b", 0.0, WALL_T * 0.5, "pier",
                  "the wall butts on the flat back, at y = -2.29 m, either side")],
        districts=("city", "castle", "hamlet"),
        note="19.4 m D-plan mural tower with the wall's own walk through it; "
             "flat back so the curtain butts into it cleanly",
        params={"radius_m": R, "plan": "D, 220 degrees", "walk_z_m": WALK_Z},
        tri_budget=20000, collision=True)


def wall_postern_gate(f):
    """A curtain run with a pedestrian gate cut through it. 13.6 m.

    A wall with no way through is a wall the generator has to route around,
    and `region.py`'s definition of forsaken ground is partly about exactly
    that: distance to a road. This is the same section as
    `WL_Wall_Curtain_Run` -- same length, same ends, same walk -- with a 3.2 m
    pointed opening in the middle, so a generator can substitute one for the
    other anywhere in a circuit without re-planning it.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    g = f.part("gold")
    LEN = 13.6
    SPAN, RISE, SPRING = 3.20, 1.60, 3.30
    ht = WALL_T * 0.5
    # THE FLANKING LENGTHS BUTT THE GATE BLOCK, they do not overlap it. They
    # first ran 0.90 m past it, which put the flanking wall's face and the gate
    # wall's face in the SAME PLANE over that strip -- classic z-fighting, and
    # it rendered as two black bands with a moire in them. It was not a hole:
    # a render against a magenta world showed the bands black rather than
    # magenta, which is what said "two surfaces", not "no surface".
    #
    # The coincident-face check does not see this. It compares faces that share
    # a CENTRE; these two only partly overlap and have different areas. That
    # limit is written into the check's own docstring.
    GATE_HALF = SPAN * 0.5 + 1.80
    for sgn in (-1.0, 1.0):
        seg = LEN * 0.5 - GATE_HALF
        _wall_section(p, d, seg, x0=sgn * (GATE_HALF + seg * 0.5), slits=False)
    # the gate block: piers, a pointed arch, and the wall carried over it
    for sgn in (-1.0, 1.0):
        p.box(1.80, WALL_T + 0.50, SPRING, at=(sgn * (SPAN * 0.5 + 0.90), 0.0, 0.0),
              chamfer=0.16, centre_z=False)
    # ONE band the full thickness of the wall, not two thin ones at the faces.
    # Two bands leave the middle of the passage soffit open, and the dark box
    # put there to close it was SPAN wide -- so it filled the arch head and
    # rendered as a black slab in the opening. A single band's intrados IS the
    # soffit, and there is nothing to close.
    E.arch_band(p, SPAN, RISE, WALL_T, 0.60, at=(0.0, 0.0, SPRING),
                kind="pointed", steps=11, keystone=True)
    E.arched_wall(p, SPAN, RISE, WALK_Z - 0.62 - SPRING, SPAN * 0.5 + 1.80,
                  WALL_T, kind="pointed", steps=11, thickness=0.60,
                  at=(0.0, 0.0, SPRING))
    # the walk carries straight over the gate, so the circuit is unbroken
    p.box(SPAN + 3.60, WALL_T + 0.46, 0.30, at=(0.0, 0.0, WALK_Z - 0.62),
          chamfer=0.07, centre_z=False)
    p.box(SPAN + 3.60, WALL_T + 0.20, 0.18, at=(0.0, 0.0, WALK_Z - 0.32),
          chamfer=0.06, centre_z=False)
    d.box(SPAN + 3.60, WALL_T - 1.30, 0.14, at=(0.0, 0.0, WALK_Z - 0.14),
          centre_z=False)
    for dy in (-1.0, 1.0):
        p.box(SPAN + 3.60, 0.62, PARAPET, at=(0.0, dy * (ht - 0.31), WALK_Z),
              chamfer=0.09, centre_z=False)
        for i in range(4):
            x = -(SPAN + 3.0) * 0.5 + (SPAN + 3.0) * (i + 0.5) / 4.0
            p.box(0.86, 0.68, 0.72, at=(x, dy * (ht - 0.31), WALK_Z + PARAPET),
                  chamfer=0.10, centre_z=False)
    for sgn in (-1.0, 1.0):
        E.pinnacle(p, (sgn * (SPAN * 0.5 + 0.90), 0.0, WALK_Z + PARAPET + 0.72),
                   2.40, 0.34, gold=g)
    return K.ModuleSpec(
        "WL_Wall_Postern_Gate", "wall", "structure", "threshold",
        f.emit("WL_Wall_Postern_Gate"),
        [K.Socket("bottom", 0.0, LEN * 0.5, "ground"),
         K.Socket("passage", 0.0, SPAN * 0.5, "pier",
                  "3.2 m clear opening, 3.3 m to the springing"),
         K.Socket("walk", WALK_Z, LEN * 0.5, "bridge_end",
                  "the walk carries over the gate; the circuit is unbroken"),
         K.Socket("end_a", 0.0, WALL_T * 0.5, "pier", "x = -6.80 m; same section as the run"),
         K.Socket("end_b", 0.0, WALL_T * 0.5, "pier", "x = +6.80 m; same section as the run")],
        districts=("city", "castle", "hamlet", "plaza"),
        note="a drop-in replacement for a curtain run with a 3.2 m pointed "
             "postern through it; identical length, ends and walk height",
        params={"length_m": LEN, "opening_m": SPAN, "walk_z_m": WALK_Z},
        tri_budget=22000, collision=True)


def wall_corner_bastion(f):
    """The 90-degree turn, with an angled bastion on the outside. 11.0 m.

    A circuit needs corners, and a mitred butt joint between two runs is the
    one place a modular wall always looks modular. This is the corner as an
    EVENT: two short arms at right angles, and a canted bastion filling the
    outside angle so the turn has a shape of its own from every bearing.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    g = f.part("gold")
    ARM = 5.20
    ht = WALL_T * 0.5
    _wall_section(p, d, ARM, x0=ARM * 0.5 + ht)
    _wall_section(p, d, ARM, x0=ARM * 0.5 + ht,
                  matrix=M.xform((0, 0, 0), (0, 0, 90.0)))
    # the canted bastion in the outside angle
    plan = [(ht, -ht), (ht + 2.30, -ht - 1.10), (ht + 3.05, -ht - 3.05),
            (ht + 1.10, -ht - 2.30), (-ht, -ht)]
    plan = [(x, y) for (x, y) in plan]
    p.loft([[(x * 1.16, y * 1.16, 0.0) for (x, y) in plan],
            [(x, y, 2.60) for (x, y) in plan]], smooth=False)
    p.prism(plan, WALK_Z - 2.60 - 0.62, z0=2.60)
    p.prism([(x * 1.10, y * 1.10) for (x, y) in plan], 0.30, z0=WALK_Z - 0.62)
    p.prism([(x * 1.05, y * 1.05) for (x, y) in plan], 0.18, z0=WALK_Z - 0.32)
    d.prism([(x * 0.90, y * 0.90) for (x, y) in plan], 0.14, z0=WALK_Z - 0.14)
    # the bastion's own parapet, following its canted plan
    n = len(plan)
    for i in range(n):
        ax, ay = plan[i]
        bx, by = plan[(i + 1) % n]
        seg = math.hypot(bx - ax, by - ay)
        if seg < 0.4:
            continue
        yaw = math.degrees(math.atan2(by - ay, bx - ax))
        mx, my = (ax + bx) * 0.5, (ay + by) * 0.5
        k = 1.0 - 0.31 / max(seg, 0.5)
        p.box(seg, 0.62, PARAPET, at=(mx * k, my * k, WALK_Z), rot=(0, 0, yaw),
              chamfer=0.09, centre_z=False)
        for j in range(max(1, int(seg // 1.7))):
            t = (j + 0.5) / max(1, int(seg // 1.7))
            p.box(0.80, 0.68, 0.72,
                  at=(ax * k + (bx - ax) * t * k, ay * k + (by - ay) * t * k,
                      WALK_Z + PARAPET),
                  rot=(0, 0, yaw), chamfer=0.10, centre_z=False)
    E.pinnacle(p, (ht + 1.30, -ht - 1.30, WALK_Z + PARAPET + 0.72), 3.20, 0.42,
               gold=g)
    return K.ModuleSpec(
        "WL_Wall_Corner_Bastion", "wall", "structure", "screen",
        f.emit("WL_Wall_Corner_Bastion"),
        [K.Socket("bottom", 0.0, 8.0, "ground"),
         K.Socket("walk", WALK_Z, 8.0, "bridge_end", "the walk turns the corner at 6.20 m"),
         # THE NUMBER IS COMPUTED, NOT TYPED. It said 8.90 m and the arms end
         # at 6.90; nothing compared a socket note against the geometry it
         # describes until the grammar check did.
         K.Socket("end_a", 0.0, WALL_T * 0.5, "pier",
                  "arm along +X ends at x = +%.2f m; butts to a run"
                  % (ARM * 0.5 + ht + ARM * 0.5)),
         K.Socket("end_b", 0.0, WALL_T * 0.5, "pier",
                  "arm along +Y ends at y = +%.2f m; butts to a run rotated "
                  "90 deg" % (ARM * 0.5 + ht + ARM * 0.5))],
        districts=("city", "castle", "plaza"),
        note="90-degree wall corner with a canted five-sided bastion in the "
             "outside angle; the walk turns with it",
        params={"arm_m": ARM, "turn_deg": 90.0, "walk_z_m": WALK_Z},
        tri_budget=24000, collision=True)


def wall_stair_flight(f):
    """The steps up to the wall-walk: 20 risers of 0.31 m, against a wall.

    THE MODULE THAT MAKES THE CIRCUIT A ROUTE. `verify_v2_layout.py` audits
    step height over every surface in the world (it reports "0 violations over
    914 surfaces"), so a decorative stair that fails it becomes an obstacle and
    the wall-walk above becomes unreachable — which `walkable.py` would then
    report as closed ground.

    0.31 m risers on a 0.36 m going is a real climbable stair at Wonderland's
    scale, and 20 of them reach 6.20 m exactly. It stands against a wall face,
    so its back is flat at y = 0 like the other clip-ons.
    """
    p = f.part("stone")
    g = f.part("gold")
    RISER, GOING, N = 0.310, 0.360, 20
    W = 2.60
    RUN = GOING * N
    # the raking wall the flight sits on
    p.loft([[(-0.10, 0.0, 0.0), (RUN + 0.50, 0.0, 0.0),
             (RUN + 0.50, W + 0.55, 0.0), (-0.10, W + 0.55, 0.0)],
            [(-0.10, 0.0, 0.55), (RUN + 0.50, 0.0, 0.55),
             (RUN + 0.50, W + 0.42, 0.55), (-0.10, W + 0.42, 0.55)]], smooth=False)
    for i in range(N):
        x = GOING * i
        z = RISER * i
        p.box(GOING * (N - i) + 0.30, W, RISER,
              at=(x + (GOING * (N - i) + 0.30) * 0.5 - 0.15, W * 0.5 + 0.21, z),
              chamfer=0.035, centre_z=False)
    # A LOW raking stringer, not a full-height one. The first version carried
    # the stringer all the way to the walk, which hid every tread behind it and
    # made the flight read as a plain wedge. A stringer is a kerb; the rail
    # above it is what stops you falling.
    p.loft([[(-0.10, W + 0.21, 0.0), (RUN + 0.50, W + 0.21, 0.0),
             (RUN + 0.50, W + 0.63, 0.0), (-0.10, W + 0.63, 0.0)],
            [(-0.10, W + 0.21, 0.42), (RUN + 0.50, W + 0.21, WALK_Z - 0.62),
             (RUN + 0.50, W + 0.63, WALK_Z - 0.62), (-0.10, W + 0.63, 0.42)]],
           smooth=False)
    for i in range(0, N, 2):
        x = GOING * i
        z = RISER * i
        p.lathe([(0.0, 0.0), (0.085, 0.0), (0.070, 0.24), (0.125, 0.50),
                 (0.075, 0.86), (0.090, 1.10), (0.0, 1.22)], segments=8,
                smooth=True,
                matrix=M.xform((x, W + 0.42, z * (1.0 - 0.62 / WALK_Z) + 0.30)))
    p.loft([[(-0.10, W + 0.24, 1.42), (RUN + 0.40, W + 0.24, 1.42),
             (RUN + 0.40, W + 0.60, 1.42), (-0.10, W + 0.60, 1.42)],
            [(-0.10, W + 0.24, 1.64), (RUN + 0.40, W + 0.24, WALK_Z + 0.80),
             (RUN + 0.40, W + 0.60, WALK_Z + 0.80), (-0.10, W + 0.60, 1.64)]],
           smooth=False)
    p.box(0.72, 0.72, 1.55, at=(RUN + 0.30, W + 0.42, WALK_Z - 0.30),
          chamfer=0.08, centre_z=False)
    E.finial(p, (RUN + 0.30, W + 0.42, WALK_Z + 1.25), 0.85, radius=0.16, gold=g)
    return K.ModuleSpec(
        "WL_Wall_Stair_Flight", "wall", "structure", "detail",
        f.emit("WL_Wall_Stair_Flight"),
        [K.Socket("bottom", 0.0, RUN * 0.5, "ground"),
         K.Socket("back", 0.0, RUN * 0.5, "bridge_end",
                  "flat back at y = 0; stand it against a curtain face"),
         K.Socket("walk", WALK_Z, 0.6, "bridge_end",
                  "arrives on the 6.20 m wall-walk at x = +7.20 m")],
        districts=("city", "castle", "plaza", "hamlet"),
        note="20 risers of 0.310 m reaching the 6.20 m wall-walk exactly; "
             "raking stringer and rail, flat back",
        params={"risers": N, "riser_m": RISER, "going_m": GOING,
                "rise_total_m": RISER * N, "walk_z_m": WALK_Z},
        tri_budget=14000, collision=True)


BUILDERS = (
    wall_curtain_run(), wall_mural_tower, wall_postern_gate,
    wall_corner_bastion, wall_stair_flight,
)
