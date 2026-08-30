"""The Golden Arrival composition, reconstructed from the Marble panorama.

Pure data. World origin = the panorama's VIEWPOINT (V). +Y is forward (into
the picture); screen-right is -X. Distances in uu. Every position below is
derived in v2/reference/ANALYSIS.md from the panorama's own pixel geometry
(azimuth, elevation, eye height 2.62 m), then rounded to a buildable plan.

Restraint is the design: a clean plaza, one open corridor, organised bands.
Nothing is scattered on the plaza. PCG (later) respects the path exclusion.

    BEHIND (−9 m)      one gate, open, urns at its feet; the plaza continues past it
    PLAZA (−15 … +9 m) large pale slabs in a loose cream/grey checker, sparse petals
    SIDES (±8 m)       low cream walls, raised beds, hedges, roses, the two rose cones
    CORRIDOR (+9 m →)  dark stone path 4.4 m wide, three steps at +15 m, rising gently
    GARDEN LEFT        the GIANT mushroom (clock on its stem, ivy on its cap), medium
                       mushrooms, a garden tree, planters
    GARDEN RIGHT       the clock tree, flowering shrubs, topiary balls, the heart on a terrace
    ARCH (+45 m)       the stone gateway that ends the corridor
    TOWERS (55–70 m)   white towers with dark caps, left and right
    CITY (90–400 m)    five depth layers, cream masonry, muted pink roofs, gold finials
    SKY                the panorama's sky above the horizon (its near mushroom/tree bands refilled from the clean sky beside them); two keys and the teapot, high
"""
import math


def _rnd(*key):
    """Deterministic 0..1 from integers -- the geometry kernel's hash, kept
    local so this data module imports with no path setup."""
    ints = [int(round(float(k) * 1024.0)) for k in key] + [0, 0, 0]
    h = (ints[0] * 374761393 + ints[1] * 668265263 + ints[2] * 2147483647 + len(key) * 1274126177) & 0xFFFFFFFF
    h = (h ^ (h >> 13)) & 0xFFFFFFFF
    h = (h * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 4294967296.0


import os as _os
#: PASS 02 (C3, garden colour layers) is gated so PASS 01 renders alone first.
PASS02 = _os.environ.get("WLV2_PASS02", "0") == "1"
#: PASS 03 (H1 threshold in frame, H2 landmarks) is gated the same way.
PASS03 = _os.environ.get("WLV2_PASS03", "0") == "1"


def _band(name, items):
    return [dict(it, band=name) for it in items]


def A(asset, x, y, z=0.0, yaw=0.0, s=1.0, mat=None, label=None, sxyz=None, pitch=0.0, roll=0.0):
    return {"asset": asset, "pos": (x, y, z), "rot": (pitch, yaw, roll),
            "scale": sxyz if sxyz is not None else (s, s, s), "mat": mat, "label": label}


def _dress_wall(x, y, yaw, length, tag, planters=True, side=1.0):
    """Give a plain wall run depth: pilasters, a cap course, and planting at
    its foot.

    The founder has named the plaza-side walls twice -- "ReverseCam03
    currently exposes plain walls", and "plain walls and unfinished backsides
    are not acceptable merely because HeroCam0 cannot see them". A garden_wall
    is 510 x 100 x 263 uu of flat ashlar, and a run of them is a flat ribbon
    however good the material is. What the boards show on the same surface is
    RELIEF: a vertical rhythm of pilasters, a horizontal line capping it, and
    the garden meeting its foot rather than stopping at it. None of this is
    decoration laid over blank geometry -- it is the wall having a section.
    """
    out = []
    c, sn = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    n = max(2, int(length / 500.0))
    for i in range(n + 1):
        t = -0.5 + i / float(n)
        px, py = x + c * length * t, y + sn * length * t
        # a pilaster: a narrow tall block standing proud of the wall face
        out.append(A("gate_pier", px, py, 0, yaw=yaw, sxyz=(0.34, 0.30, 0.42),
                     mat="MI_V2_IvoryStone", label="%s_Pilaster%d" % (tag, i)))
        if i % 2 == 0:
            out.append(A("gate_finial_ball", px, py, 273, s=0.34, mat="MI_V2_Gold",
                         label="%s_PilasterCap%d" % (tag, i)))
    # the cap course, a thin run along the top
    out.append(A("kerb_stone", x, y, 258, yaw=yaw,
                 sxyz=(length / 120.0, 1.5, 0.34), mat="MI_V2_IvoryStone",
                 label="%s_Cap" % tag))
    if planters:
        for i in range(max(2, n // 2)):
            t = -0.42 + 0.84 * (i / float(max(1, (n // 2) - 1)) if n > 3 else i)
            # `side` puts the planters on the GARDEN face. The first version
            # had no such argument and offset them one way for every wall,
            # which put four of them on the plaza -- caught by the layout
            # gate's plaza-clean check before it reached a render, which is
            # what that check is for.
            px = x + c * length * t - sn * 150.0 * side
            py = y + sn * length * t + c * 150.0 * side
            out += [
                A("planter_box", px, py, 0, yaw=yaw, s=0.85, mat="MI_V2_IvoryStone",
                  label="%s_Planter%d" % (tag, i)),
                A("flower_cluster", px, py, 62, yaw=30 * i, s=0.5,
                  mat=("MI_V2_PetalPink", "MI_V2_Lavender", "MI_V2_PetalWhite")[i % 3],
                  label="%s_PlanterFlowers%d" % (tag, i)),
            ]
    return out


def _ground_patch(x, y, z, yaw, sc, petal, label):
    """A ground-flower patch: the green leaf MAT and its coloured BLOOMS, on
    the same spot. Two meshes because one mesh is one material -- placing
    ground_flowers alone with a petal colour paints its whole mound that
    colour, which is the white dome FlankLeftCam08 showed sitting on the lawn.
    """
    return [
        A("ground_flowers", x, y, z, yaw=yaw, s=sc, mat="MI_V2_LeafMid", label=label),
        A("ground_blooms", x, y, z, yaw=yaw, s=sc, mat=petal, label=label + "_Blooms"),
    ]


# ---------------------------------------------------------------------------
# THE GATE (behind the viewpoint) AND THE PLAZA EDGE
# ---------------------------------------------------------------------------
GATE = _band("V2_Arrival", [
    # PLAYER SCALE (PASS 07): at s=1.4 the piers were 9.1 m to the cap with a
    # 2.9 m opening -- from the arrival spawn only the bottom third of a pier
    # was in frame and the plinth alone stood chest-high on the 1.74 m Dog;
    # the urns (2.0 m) were taller than the Dog. Same pieces, same language,
    # at the scale the garden gates already use: 6.5 m piers (s=1.0, finials
    # at z=650 as on the garden gate), centres +-260 for a 4.0 m opening
    # between the shafts, leaves at their authored 5.6 m, urns 1.3 m and
    # moved outside the plinths, standing 13 cm clear of the rear wall face.
    A("gate_pier", 260, -910, 0, s=1.0, mat="MI_V2_IvoryStone", label="Gate_PierL"),
    A("gate_pier", -260, -910, 0, s=1.0, mat="MI_V2_IvoryStone", label="Gate_PierR"),
    # leaves OPEN: hinged at the shafts' inner faces, swung 80 degrees toward the plaza
    A("gate_leaf", 200, -870, 0, yaw=80, s=0.5, sxyz=(0.5, 0.5, 1.0), mat="MI_V2_Gold", label="Gate_LeafL"),
    A("gate_leaf", -200, -870, 0, yaw=100, s=0.5, sxyz=(-0.5, 0.5, 1.0), mat="MI_V2_Gold", label="Gate_LeafR"),
    A("gate_finial_ball", 260, -910, 650, s=1.0, mat="MI_V2_Gold", label="Gate_FinialL"),
    A("gate_finial_ball", -260, -910, 650, s=1.0, mat="MI_V2_Gold", label="Gate_FinialR"),
    A("garden_urn", 420, -800, 0, s=0.65, mat="MI_V2_Ceramic", label="Gate_UrnL"),
    A("garden_urn", -420, -800, 0, s=0.65, mat="MI_V2_Ceramic", label="Gate_UrnR"),
    A("flower_cluster", 420, -800, 100, s=0.45, mat="MI_V2_PetalPink", label="Gate_UrnFlowersL"),
    A("flower_cluster", -420, -800, 100, s=0.45, mat="MI_V2_PetalViolet", label="Gate_UrnFlowersR"),
    # the plaza's rear wall either side of the gate, ivied
    A("garden_wall", 580, -910, 0, s=1.0, mat="MI_V2_IvoryStone", label="Rear_WallL0"),
    A("garden_wall", 1080, -910, 0, s=1.0, mat="MI_V2_IvoryStone", label="Rear_WallL1"),
    A("garden_wall", -580, -910, 0, s=1.0, mat="MI_V2_IvoryStone", label="Rear_WallR0"),
    A("garden_wall", -1080, -910, 0, s=1.0, mat="MI_V2_IvoryStone", label="Rear_WallR1"),
# PILASTERS AND A CAP, NO PLANTERS. This wall stands INSIDE PLAZA_RECT
# (x +-650, y -1500..800), so a planter row at its foot lands on the arrival
# floor -- which the layout gate's plaza-clean check said twice, once for each
# side I tried. It is right: that floor is where participants arrive and
# gather, and the founder's brief asks for open gathering areas and clear
# movement lanes there. The wall gets its section; the plaza keeps its floor.
] + _dress_wall(830, -910, 0.0, 1000.0, "Rear_WallL", planters=False) \
  + _dress_wall(-830, -910, 0.0, 1000.0, "Rear_WallR", planters=False) + [
    A("ivy_drape", 700, -880, 250, s=0.7, mat="MI_V2_LeafMid", label="Rear_IvyL"),
    A("ivy_drape", -800, -880, 250, s=0.7, mat="MI_V2_LeafDark", label="Rear_IvyR"),
    A("hedge_block", 800, -1060, 0, yaw=0, s=1.2, mat="MI_V2_LeafDark", label="Rear_HedgeL"),
    A("hedge_block", -900, -1060, 0, yaw=0, s=1.1, mat="MI_V2_LeafMid", label="Rear_HedgeR"),
    A("vine_wall", 580, -870, 60, s=1.0, mat="MI_V2_LeafMid", label="Rear_WallIvyL0"),
    A("vine_wall", -1080, -870, 60, s=0.9, mat="MI_V2_LeafDark", label="Rear_WallIvyR1"),
])

# ---------------------------------------------------------------------------
# THE SIDES: walls, raised beds, rose cones — balanced, not mirrored
# ---------------------------------------------------------------------------
SIDES = _band("V2_Arrival", [
    # the plaza is SUNKEN: three steps rise to the side terraces along both
    # edges, and cream pedestals with gold finials stand at the path's mouth
    A("pedestal_finial", 590, 740, 0, s=1.1, mat="MI_V2_IvoryStone", label="Pedestal_L"),
    A("pedestal_finial", -590, 740, 0, s=1.1, mat="MI_V2_IvoryStone", label="Pedestal_R"),
    A("gate_finial_ball", 590, 740, 136, s=0.6, mat="MI_V2_Gold", label="Pedestal_L_Finial"),
    A("gate_finial_ball", -590, 740, 136, s=0.6, mat="MI_V2_Gold", label="Pedestal_R_Finial"),
] + [
    A("side_steps", 660, -700 + 400 * i, 0, yaw=-90, s=1.0, mat="MI_V2_PlazaCream", label="SideSteps_L%d" % i) for i in range(5)
] + [
    A("side_steps", -660, -640 + 400 * i, 0, yaw=90, s=1.0, mat="MI_V2_PlazaCream", label="SideSteps_R%d" % i) for i in range(5)
] + [
    A("side_steps", -280 - 400 * (i + 1), 800, 0, yaw=0, s=1.0, mat="MI_V2_PlazaCream", label="FrontSteps_R%d" % i) for i in range(3)
] + [
    A("side_steps", 280 + 400 * (i + 1), 800, 0, yaw=0, s=1.0, mat="MI_V2_PlazaCream", label="FrontSteps_L%d" % i) for i in range(3)
] + [
    A("topiary_cone_roses", 860, -45, 145, yaw=10, s=1.0, mat="MI_V2_LeafMid", label="RoseCone_L"),
    A("topiary_cone_roses", -770, 250, 145, yaw=200, s=1.04, mat="MI_V2_LeafMid", label="RoseCone_R"),
    A("planter_box", 860, -45, 60, s=1.4, mat="MI_V2_IvoryStone", label="RoseCone_L_Planter"),
    A("planter_box", -770, 250, 60, s=1.4, mat="MI_V2_IvoryStone", label="RoseCone_R_Planter"),
] + [
    A("retaining_wall", 800, -700 + 400 * i, 60, yaw=90, s=1.0, mat="MI_V2_IvoryStone", label="SideWall_L%d" % i) for i in range(5)
] + [
    A("retaining_wall", -800, -640 + 400 * i, 60, yaw=90, s=1.0, mat="MI_V2_IvoryStone", label="SideWall_R%d" % i) for i in range(5)
] + [
    A(("hedge_block", "shrub_flowering", "hedge_mass")[i % 3], 1010 + 60 * (i % 2), -600 + 330 * i, 60, yaw=(90 if i % 3 == 0 else 41 * i), s=0.9,
      mat=("MI_V2_LeafMid", "MI_V2_LeafDark")[i % 2], label="SideBed_L_Hedge%d" % i) for i in range(6)
] + [
    A(("shrub_flowering", "hedge_block", "hedge_mass")[i % 3], -1010 - 60 * (i % 2), -540 + 330 * i, 60, yaw=(90 if i % 3 == 1 else 67 * i), s=0.9,
      mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2], label="SideBed_R_Hedge%d" % i) for i in range(6)
] + [
    A("rose_bush", 940, -300 + 600 * i, 85, yaw=30 * i, s=0.9, mat="MI_V2_LeafMid", label="SideBed_L_RoseBush%d" % i) for i in range(2)
] + [
    A("rose_bush", -940, -200 + 600 * i, 85, yaw=50 * i, s=0.9, mat="MI_V2_LeafMid", label="SideBed_R_RoseBush%d" % i) for i in range(2)
] + [
    g for i in range(7) for g in _ground_patch(1120, -450 + 220 * i, 85, 23 * i, 1.0, ("MI_V2_PetalPink", "MI_V2_PetalBlue", "MI_V2_PetalViolet")[i % 3], "SideBed_L_Ground%d" % i)
] + [
    g for i in range(7) for g in _ground_patch(-1120, -400 + 220 * i, 85, 31 * i, 1.0, ("MI_V2_PetalViolet", "MI_V2_PetalPink", "MI_V2_RosePink")[i % 3], "SideBed_R_Ground%d" % i)
] + [
    A("rose_bloom", 900 + 90 * (i % 3), -520 + 300 * i, 110, yaw=53 * i, s=0.55, mat=("MI_V2_RosePink", "MI_V2_RoseRed", "MI_V2_PetalPink")[i % 3], label="SideBed_L_Rose%d" % i) for i in range(6)
] + [
    A("rose_bloom", -900 - 90 * (i % 3), -460 + 300 * i, 110, yaw=71 * i, s=0.55, mat=("MI_V2_PetalViolet", "MI_V2_RosePink", "MI_V2_PetalBlue")[i % 3], label="SideBed_R_Rose%d" % i) for i in range(6)
] + [
    A("flower_cluster", 940 + 80 * (i % 2), -400 + 260 * i, 90, yaw=29 * i, s=0.8, mat=("MI_V2_PetalPink", "MI_V2_PetalBlue", "MI_V2_PetalViolet")[i % 3], label="SideBed_L_Flowers%d" % i) for i in range(6)
] + [
    A("flower_cluster", -940 - 80 * (i % 2), -340 + 260 * i, 90, yaw=37 * i, s=0.8, mat=("MI_V2_PetalViolet", "MI_V2_PetalPink", "MI_V2_RosePink")[i % 3], label="SideBed_R_Flowers%d" % i) for i in range(6)
])

# ---------------------------------------------------------------------------
# THE CORRIDOR: the front wall line at +9 m, the steps, the path (laid by the builder)
# ---------------------------------------------------------------------------
CORRIDOR = _band("V2_Garden", [
    A("path_steps", 0, 2980, 0, s=1.0, mat="MI_V2_PlazaCream", label="Path_Steps"),
    A("balustrade", 300, 3030, 60, yaw=90, s=0.9, mat="MI_V2_IvoryStone", label="Steps_BalustradeL"),
    A("balustrade", -300, 3030, 60, yaw=90, s=0.9, mat="MI_V2_IvoryStone", label="Steps_BalustradeR"),
    A("garden_urn", 330, 2840, 0, s=0.9, mat="MI_V2_Ceramic", label="Steps_UrnL"),
    A("garden_urn", -330, 2840, 0, s=0.9, mat="MI_V2_Ceramic", label="Steps_UrnR"),
] + [
    # low cream kerbs edging the path, and the near hedges right behind them
    A("retaining_wall", side * 250, 1000 + 400 * i, 0, yaw=90, s=1.0, sxyz=(1.0, 0.6, 0.4), mat="MI_V2_IvoryStone", label="PathKerb%d_%d" % (side, i))
    for side in (-1, 1) for i in range(9)
] + [
    A("hedge_block", side * 330, 1000 + 320 * i, 0, yaw=90, s=0.9, mat=("MI_V2_LeafMid", "MI_V2_LeafDark")[i % 2], label="NearHedge%d_%d" % (side, i))
    for side in (-1, 1) for i in range(3)
] + [
    A("retaining_wall", 280 + 400 * (i + 1), 900, 0, yaw=0, s=1.0, mat="MI_V2_IvoryStone", label="FrontWall_L%d" % i) for i in range(4)
] + [
    A("retaining_wall", -280 - 400 * (i + 1), 900, 0, yaw=0, s=1.0, mat="MI_V2_IvoryStone", label="FrontWall_R%d" % i) for i in range(4)
] + ([
    # PASS 02: the front beds are LAYERED -- hedges pushed back and smaller, a
    # band of massed flower beds (pink / white / lavender / rose / violet) in
    # front of them at the wall, lavender between. The reference's beds are
    # colour over green held by the wall, not green masses swallowing a few
    # flowers.
    A("hedge_mass", 560 + 380 * i, 1360, 60, yaw=33 * i, s=0.75, mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2], label="FrontBed_L_Hedge%d" % i) for i in range(4)
] + [
    A("hedge_mass", -560 - 380 * i, 1360, 60, yaw=59 * i, s=0.75, mat=("MI_V2_LeafMid", "MI_V2_LeafDark")[i % 2], label="FrontBed_R_Hedge%d" % i) for i in range(4)
] + [
    # PASS 02b: the beds as ONE continuous colour band the height of the wall
    # coping -- eleven beds per side on a 200 uu pitch, 1.35x, raised so the
    # bloom crests clear the 0.85 m wall from the 2.6 m eye (PASS 02's six
    # beds at 1.0x / z 60 only showed their crests).
    A("flower_bed_base_%d" % (i % 4), side * (400 + 200 * i), 1050, 80, yaw=23 * i + (0 if side > 0 else 90), s=1.35, mat=("MI_V2_LeafMid", "MI_V2_LeafGrey")[i % 2], label="FrontBed%d_Base%d" % (side, i))
    for side in (-1, 1) for i in range(11)
] + [
    A("flower_bed_blooms_%d" % (i % 4), side * (400 + 200 * i), 1050, 80, yaw=23 * i + (0 if side > 0 else 90), s=1.35,
      mat=("MI_V2_PetalPink", "MI_V2_PetalWhite", "MI_V2_Lavender", "MI_V2_PetalRose", "MI_V2_PetalViolet", "MI_V2_RosePink")[(i + (0 if side > 0 else 3)) % 6], label="FrontBed%d_Blooms%d" % (side, i))
    for side in (-1, 1) for i in range(11)
] + [
    A("lavender_stems", side * (500 + 200 * i), 1200, 70, yaw=40 * i, s=1.25, mat="MI_V2_LeafGrey", label="FrontBed%d_LavStems%d" % (side, i))
    for side in (-1, 1) for i in range(10)
] + [
    A("lavender_heads", side * (500 + 200 * i), 1200, 70, yaw=40 * i, s=1.25, mat="MI_V2_Lavender", label="FrontBed%d_LavHeads%d" % (side, i))
    for side in (-1, 1) for i in range(10)
] if PASS02 else [
    A("hedge_mass", 560 + 380 * i, 1100, 60, yaw=33 * i, s=1.0, mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2], label="FrontBed_L_Hedge%d" % i) for i in range(4)
] + [
    A("hedge_mass", -560 - 380 * i, 1100, 60, yaw=59 * i, s=1.0, mat=("MI_V2_LeafMid", "MI_V2_LeafDark")[i % 2], label="FrontBed_R_Hedge%d" % i) for i in range(4)
] + [
    A("flower_cluster", 420 + 300 * i, 1000, 90, yaw=17 * i, s=0.9, mat=("MI_V2_PetalPink", "MI_V2_PetalBlue", "MI_V2_RoseRed", "MI_V2_PetalViolet")[i % 4], label="FrontBed_L_Flowers%d" % i) for i in range(5)
] + [
    A("flower_cluster", -420 - 300 * i, 1000, 90, yaw=23 * i, s=0.9, mat=("MI_V2_PetalViolet", "MI_V2_RosePink", "MI_V2_PetalBlue", "MI_V2_PetalPink")[i % 4], label="FrontBed_R_Flowers%d" % i) for i in range(5)
]) + [
    # hedges flanking the path, then the garden opens
    A("hedge_mass", side * (390 + 30 * (i % 2)), 1950 + 320 * i, 0 + (60 if 1950 + 320 * i > 2980 else 0), yaw=41 * i + (0 if side > 0 else 180), s=(0.6 if PASS02 else 0.85),
      mat=("MI_V2_LeafMid", "MI_V2_LeafDark")[i % 2], label="PathHedge%d_%d" % (side, i))
    for side in (-1, 1) for i in range(8)
] + ([
    # PASS 02: colour along the corridor -- a massed bed between every other
    # pair of path hedges, on the verge behind the kerb.
    A("flower_bed_base_%d" % (i % 4), side * 370, 1950 + 320 * i, (60 if 1950 + 320 * i > 2980 else 0), yaw=90 + 30 * i, s=1.1, mat="MI_V2_LeafMid", label="PathBed%d_Base%d" % (side, i))
    for side in (-1, 1) for i in range(8)
] + [
    A("flower_bed_blooms_%d" % (i % 4), side * 370, 1950 + 320 * i, (60 if 1950 + 320 * i > 2980 else 0), yaw=90 + 30 * i, s=1.1,
      mat=("MI_V2_PetalRose", "MI_V2_PetalWhite", "MI_V2_PetalPink", "MI_V2_Lavender", "MI_V2_RosePink", "MI_V2_PetalViolet")[(i + (0 if side > 0 else 3)) % 6], label="PathBed%d_Blooms%d" % (side, i))
    for side in (-1, 1) for i in range(8)
] if PASS02 else []) + [
    A("rose_bloom", side * (300 + 40 * (i % 2)), 1850 + 420 * i, 70 + (60 if 1850 + 420 * i > 2980 else 0), yaw=31 * i, s=0.5,
      mat=("MI_V2_RoseRed", "MI_V2_RosePink")[(i + (0 if side > 0 else 1)) % 2], label="PathRose%d_%d" % (side, i))
    for side in (-1, 1) for i in range(6)
] + [
    A(("floral_arch_trellis" if PASS03 else "floral_arch"), 0, 3600, 80, s=1.0, sxyz=(1.0, 1.0, 1.1), mat=("MI_V2_Gold" if PASS03 else "MI_V2_LeafMid"), label="Corridor_FloralArch"),
    A("rose_bloom", -470, 3560, 660, yaw=0, s=0.7, mat="MI_V2_RosePink", label="FloralArch_Rose0"),
    A("rose_bloom", 460, 3560, 620, yaw=60, s=0.7, mat="MI_V2_RoseRed", label="FloralArch_Rose1"),
    A("rose_bloom", 0, 3550, 780, yaw=120, s=0.8, mat="MI_V2_RosePink", label="FloralArch_Rose2"),
    A("rose_bloom", -260, 3555, 750, yaw=180, s=0.6, mat="MI_V2_PetalViolet", label="FloralArch_Rose3"),
    A("rose_bloom", 280, 3555, 740, yaw=240, s=0.6, mat="MI_V2_RosePink", label="FloralArch_Rose4"),
    A("garden_arch_stone", 0, 4500, 220, s=1.0, mat="MI_V2_IvoryStone", label="Corridor_Arch"),
    A("ivy_drape", 350, 4460, 620, s=0.8, mat="MI_V2_LeafMid", label="Corridor_ArchIvyL"),
    A("ivy_drape", -350, 4460, 620, s=0.8, mat="MI_V2_LeafDark", label="Corridor_ArchIvyR"),
    A("rose_bloom", 0, 4440, 870, s=0.7, mat="MI_V2_RosePink", label="Corridor_ArchRose"),
])

# ---------------------------------------------------------------------------
# GARDEN LEFT: the giant mushroom and its grounds
# ---------------------------------------------------------------------------
GARDEN_L = _band("V2_Garden", [
    # the garden floor first, so everything else stands on it (z -2 so slab
    # and wall bases at 0 stay proud of the lawn)
    A("garden_lawn", 3800, 2600, -2, mat="MI_V2_Lawn", label="Lawn_L"),
    # the LEFT GARDEN GATE: gold leaves between cream piers at the entrance to
    # the left garden, beyond the front wall (reprojected view: az -25, ~18 m)
    A("gate_pier", 1080, 1700, 0, s=1.0, mat="MI_V2_IvoryStone", label="GardenGate_PierL"),
    A("gate_pier", 700, 1700, 0, s=1.0, mat="MI_V2_IvoryStone", label="GardenGate_PierR"),
    A("gate_leaf", 1030, 1690, 0, yaw=180, s=0.45, sxyz=(-0.45, 0.45, 0.95), mat="MI_V2_Gold", label="GardenGate_LeafL"),
    A("gate_leaf", 750, 1690, 0, yaw=0, s=0.45, sxyz=(0.45, 0.45, 0.95), mat="MI_V2_Gold", label="GardenGate_LeafR"),
    A("gate_finial_heart", 1080, 1700, 650, s=0.9, mat="MI_V2_Gold", label="GardenGate_FinialL"),
    A("gate_finial_ball", 700, 1700, 650, s=1.0, mat="MI_V2_Gold", label="GardenGate_FinialR"),
] + ([
    # PASS 03 (H1): the threshold reads at 18 m -- a gold arch over the piers
    # with a heart crown, and a mirrored gate on the right garden entrance.
    A("gate_arch_gold", 890, 1700, 0, s=1.0, mat="MI_V2_Gold", label="GardenGate_ArchL"),
    A("gate_pier", -1080, 1700, 0, s=1.0, mat="MI_V2_IvoryStone", label="GardenGateR_PierL"),
    A("gate_pier", -700, 1700, 0, s=1.0, mat="MI_V2_IvoryStone", label="GardenGateR_PierR"),
    A("gate_leaf", -1030, 1690, 0, yaw=180, s=0.45, sxyz=(-0.45, 0.45, 0.95), mat="MI_V2_Gold", label="GardenGateR_LeafL"),
    A("gate_leaf", -750, 1690, 0, yaw=0, s=0.45, sxyz=(0.45, 0.45, 0.95), mat="MI_V2_Gold", label="GardenGateR_LeafR"),
    A("gate_arch_gold", -890, 1700, 0, s=1.0, mat="MI_V2_Gold", label="GardenGate_ArchR"),
    A("gate_finial_ball", -1080, 1700, 650, s=1.0, mat="MI_V2_Gold", label="GardenGateR_FinialL"),
    A("gate_finial_heart", -700, 1700, 650, s=0.9, mat="MI_V2_Gold", label="GardenGateR_FinialR"),
] if PASS03 else []) + [
    A("vine_wall", 1090, 1660, 80, yaw=0, s=0.5, mat="MI_V2_LeafMid", label="GardenGate_IvyL"),
    A("stone_ring_base", 1960, 1000, 0, s=1.0, mat="MI_V2_IvoryStone", label="GiantMushroom_Base"),
    A("mushroom_giant", 1960, 1000, 76, yaw=15, s=1.0, mat=("MI_V2_MushRed" if PASS03 else "MI_V2_MushTerracotta"), label="GiantMushroom"),
    A("mushroom_giant_gills", 1960, 1000, 76, yaw=15, s=1.0, mat="MI_V2_MushCream", label="GiantMushroom_Gills"),
] + ([
    # PASS 03 (H2): the landmark cap is red with cream spots and a gold rim
    A("mushroom_giant_spots", 1960, 1000, 76, yaw=15, s=1.0, mat="MI_V2_MushCream", label="GiantMushroom_Spots"),
    A("mushroom_giant_rim", 1960, 1000, 76, yaw=15, s=1.0, mat="MI_V2_Gold", label="GiantMushroom_Rim"),
] if PASS03 else []) + [
    # the small red mushroom on a pedestal at the left terrace edge
    A("pedestal_finial", 900, 520, 60, s=1.3, mat="MI_V2_IvoryStone", label="LeftBollard_Pedestal"),
    A("mushroom_small", 900, 520, 220, yaw=40, s=0.55, mat="MI_V2_MushRed", label="LeftBollard_Mushroom"),
    A("clock_ornate", 1780, 800, 850, yaw=-10, s=1.1, mat="MI_V2_Gold", label="GiantMushroom_Clock"),
    A("canopy_large", 1960, 1000, 1640, yaw=0, s=1.3, sxyz=(1.5, 1.5, 0.55), mat="MI_V2_LeafMid", label="GiantMushroom_Ivy0"),
    A("canopy_large", 2400, 1200, 1600, yaw=120, s=1.0, sxyz=(1.1, 1.1, 0.5), mat="MI_V2_LeafDark", label="GiantMushroom_Ivy1"),
    # PASS 03: the clock's sightline from HeroCam0 is kept clear -- the vine
    # and the foot hedges move off the line between the camera and the stem.
    A("vine_hanging", (2700 if PASS03 else 2500), 700, 1380, s=0.9, mat="MI_V2_LeafMid", label="GiantMushroom_Vine0"),
    A("vine_hanging", 1500, 1300, 1380, s=0.8, mat="MI_V2_LeafDark", label="GiantMushroom_Vine1"),
    A("hedge_mass", (1500 if PASS03 else 1700), 600, 0, yaw=30, s=(0.9 if PASS03 else 1.4), mat="MI_V2_LeafDark", label="GiantMushroom_Foot0"),
    A("hedge_mass", 2300, 700, 0, yaw=150, s=(1.0 if PASS03 else 1.3), mat="MI_V2_LeafMid", label="GiantMushroom_Foot1"),
    A("hedge_mass", 1900, 1500, 0, yaw=250, s=1.2, mat="MI_V2_LeafDark", label="GiantMushroom_Foot2"),
    A("mushroom_medium", 1450, 1750, 0, yaw=40, s=1.0, mat="MI_V2_MushRed", label="Garden_L_Mush0"),
    A("mushroom_medium", 2600, 1500, 0, yaw=200, s=0.8, mat="MI_V2_MushCream", label="Garden_L_Mush1"),
    A("mushroom_small", 1300, 1200, 0, yaw=90, s=1.0, mat="MI_V2_MushPurple", label="Garden_L_Mush2"),
    A("mushroom_small", 1200, 2150, 0, yaw=300, s=0.9, mat="MI_V2_MushRed", label="Garden_L_Mush3"),
    A("tree_mature_trunk", 1350, 2300, 0, yaw=180, s=1.15, mat="MI_V2_Bark", label="Garden_L_Tree_Trunk"),
    A("canopy_large", 1350, 2300, 1500, yaw=0, s=1.5, mat="MI_V2_LeafMid", label="Garden_L_Tree_Canopy0"),
    A("canopy_large", 1000, 2550, 1380, yaw=130, s=1.1, mat="MI_V2_LeafDark", label="Garden_L_Tree_Canopy1"),
    A("canopy_large", 1750, 2150, 1320, yaw=250, s=1.0, mat="MI_V2_LeafLight", label="Garden_L_Tree_Canopy2"),
    A("canopy_medium", 1200, 2000, 1150, yaw=60, s=1.2, mat="MI_V2_LeafMid", label="Garden_L_Tree_Canopy3"),
    A("blossom_cluster", 1250, 2450, 1600, s=1.0, mat="MI_V2_RosePink", label="Garden_L_Tree_Blossom"),
    A("topiary_ball", 1100, 1600, 0, s=1.0, mat="MI_V2_LeafMid", label="Garden_L_Ball0"),
    A("topiary_spiral", 2200, 2200, 0, s=1.1, mat="MI_V2_LeafDark", label="Garden_L_Spiral"),
    A("topiary_cone_plain", 1250, 3100, 0, s=1.0, mat="MI_V2_LeafMid", label="Garden_L_Cone"),
    A("rose_bush", 1000, 2300, 0, yaw=40, s=1.0, mat="MI_V2_LeafMid", label="Garden_L_RoseBush"),
    A("shrub_flowering", 2600, 2700, 0, yaw=120, s=1.1, mat="MI_V2_LeafDark", label="Garden_L_FlowerShrub"),
    A("tree_slender_trunk", 2900, 2200, 0, yaw=70, s=1.0, mat="MI_V2_Bark", label="Garden_L_Slender_Trunk"),
    A("canopy_medium", 2900, 2200, 800, yaw=0, s=1.1, mat="MI_V2_LeafLight", label="Garden_L_Slender_Canopy"),
    A("tower_capped", 2000, 5200, 0, s=1.3, mat="MI_V2_IvoryStone", label="Tower_L"),
    A("roof_cone_steep", 2000, 5200, 1430, s=1.3, mat="MI_V2_RoofPink", label="Tower_L_Cap"),
    A("balcony_ring", 2000, 5200, 760, s=0.65, mat="MI_V2_IvoryStone", label="Tower_L_Balcony"),
    A("gate_finial_ball", 2000, 5200, 1430 + 640 * 1.3, s=1.0, mat="MI_V2_Gold", label="Tower_L_Finial"),
    A("tower_capped", 3200, 6500, 0, s=1.6, mat="MI_V2_IvoryStone", label="Tower_L2"),
    A("roof_cone_steep", 3200, 6500, 1760, s=1.6, mat="MI_V2_RoofLilac", label="Tower_L2_Cap"),
])

# ---------------------------------------------------------------------------
# GARDEN RIGHT: the clock tree, flowering shrubs, the heart on its terrace
# ---------------------------------------------------------------------------
GARDEN_R = _band("V2_Garden", [
    A("garden_lawn", -3800, 2600, -2, mat="MI_V2_Lawn", label="Lawn_R"),
    # MEASURED ON THE REPROJECTED cam0 VIEW, not the flat panorama: the clock
    # sits at +45 deg, the trunk spans +42..+52, and the foliage fills the
    # top-right corner -- so the tree is 16 m tall, 28 m out, at +47 deg.
    # the trunk mesh is 27 m tall at scale 1; 0.6 puts its highest limbs at
    # 16 m and the crown (canopies at 8-10.5 m + ~6 m radius) tops out at
    # ~17 m -- the measured ~16 m. (0.8 left bare limbs 5 m above the crown.)
    A("tree_clock_trunk", -2050, 1900, 0, yaw=200, s=0.6, mat="MI_V2_Bark", label="ClockTree_Trunk"),
    A("clock_ornate", -1900, 1720, 560, yaw=-25, s=1.0, mat="MI_V2_Gold", label="ClockTree_Clock"),
    A("canopy_large", -2100, 1950, 1050, yaw=0, s=1.4, mat="MI_V2_LeafMid", label="ClockTree_Canopy0"),
    A("canopy_large", -1600, 2100, 960, yaw=140, s=1.1, mat="MI_V2_LeafDark", label="ClockTree_Canopy1"),
    A("canopy_large", -2550, 1650, 990, yaw=260, s=1.0, mat="MI_V2_LeafLight", label="ClockTree_Canopy2"),
    A("canopy_medium", -1700, 1650, 800, yaw=30, s=1.2, mat="MI_V2_LeafMid", label="ClockTree_Canopy3"),
    A("vine_hanging", -1880, 1700, 760, s=0.7, mat="MI_V2_LeafMid", label="ClockTree_Vine0"),
    A("vine_hanging", -2200, 1750, 800, s=0.6, mat="MI_V2_LeafDark", label="ClockTree_Vine1"),
    A("hedge_mass", -1400, 1500, 60, yaw=20, s=1.3, mat="MI_V2_LeafDark", label="Garden_R_Hedge0"),
    A("hedge_mass", -1900, 1300, 0, yaw=200, s=1.2, mat="MI_V2_LeafMid", label="Garden_R_Hedge1"),
    A("hedge_mass", -2300, 2200, 0, yaw=70, s=1.4, mat="MI_V2_LeafDark", label="Garden_R_Hedge2"),
    A("hedge_mass", -1600, 2700, 100, yaw=300, s=1.1, mat="MI_V2_LeafMid", label="Garden_R_Hedge3"),
    A("blossom_cluster", -1500, 1450, 260, s=1.1, mat="MI_V2_PetalPink", label="Garden_R_Bloom0"),
    A("blossom_cluster", -2300, 2150, 220, s=1.0, mat="MI_V2_PetalViolet", label="Garden_R_Bloom1"),
    A("topiary_ball", -1200, 1900, 0, s=1.1, mat="MI_V2_LeafMid", label="Garden_R_Ball0"),
    A("topiary_spiral", -1900, 2600, 0, s=1.0, mat="MI_V2_LeafDark", label="Garden_R_Spiral"),
    A("topiary_cone_plain", -1050, 2500, 0, s=0.9, mat="MI_V2_LeafMid", label="Garden_R_Cone"),
    A("rose_bush", -1500, 2150, 0, yaw=200, s=1.0, mat="MI_V2_LeafMid", label="Garden_R_RoseBush0"),
    A("rose_bush", -2500, 2900, 0, yaw=80, s=0.9, mat="MI_V2_LeafMid", label="Garden_R_RoseBush1"),
    A("shrub_flowering", -1800, 1800, 0, yaw=300, s=1.0, mat="MI_V2_LeafDark", label="Garden_R_FlowerShrub"),
    A("tree_slender_trunk", -2200, 3300, 0, yaw=150, s=1.1, mat="MI_V2_Bark", label="Garden_R_Slender_Trunk"),
    A("canopy_medium", -2200, 3300, 880, yaw=0, s=1.2, mat="MI_V2_LeafMid", label="Garden_R_Slender_Canopy"),
    A("blossom_cluster", -2100, 3400, 980, s=0.9, mat="MI_V2_PetalPink", label="Garden_R_Slender_Blossom"),
    A("mushroom_medium", -2200, 1000, 0, yaw=120, s=0.9, mat="MI_V2_MushRed", label="Garden_R_Mush0"),
    A("mushroom_small", -1250, 1250, 0, yaw=10, s=0.9, mat="MI_V2_MushPurple", label="Garden_R_Mush1"),
    A("mushroom_small", -3300, 2400, 0, yaw=220, s=1.0, mat="MI_V2_MushCream", label="Garden_R_Mush2"),
    # the heart on a low terrace
    A("terrace_platform", -900, 2660, 0, s=1.0, sxyz=(0.7, 0.7, 2.1), mat="MI_V2_IvoryStone", label="Heart_Terrace"),
    A("heart_topiary", -900, 2660, 250, yaw=15, s=0.7, mat=("MI_V2_LeafLight" if PASS03 else "MI_V2_LeafMid"), label="HeartTopiary"),
    A("hedge_mass", -1250, 2760, 250, yaw=0, s=1.0, mat="MI_V2_LeafDark", label="Heart_Base0"),
    A("hedge_mass", -600, 2800, 250, yaw=90, s=0.8, mat="MI_V2_LeafDark", label="Heart_Base1"),
    A("tower_capped", -2500, 4300, 0, s=1.2, mat="MI_V2_IvoryStone", label="Tower_R0"),
    A("roof_cone_steep", -2500, 4300, 1320, s=1.2, mat="MI_V2_RoofPink", label="Tower_R0_Cap"),
    A("balcony_ring", -2500, 4300, 740, s=0.6, mat="MI_V2_IvoryStone", label="Tower_R0_Balcony"),
    A("gate_finial_ball", -2500, 4300, 1320 + 640 * 1.2, s=0.9, mat="MI_V2_Gold", label="Tower_R0_Finial"),
    A("tower_capped", -5200, 5400, 0, s=1.4, mat="MI_V2_IvoryStone", label="Tower_R1"),
    A("roof_cone_steep", -5200, 5400, 1540, s=1.4, mat="MI_V2_RoofBlue", label="Tower_R1_Cap"),
    A("tree_mature_trunk", -3600, 3600, 0, yaw=60, s=0.8, mat="MI_V2_Bark", label="Garden_R_Tree_Trunk"),
    A("canopy_large", -3600, 3600, 1050, yaw=0, s=1.0, mat="MI_V2_LeafMid", label="Garden_R_Tree_Canopy0"),
    A("canopy_large", -3200, 3800, 950, yaw=150, s=0.8, mat="MI_V2_LeafLight", label="Garden_R_Tree_Canopy1"),
])

# ---------------------------------------------------------------------------
# THE CITY IN DEPTH
# ---------------------------------------------------------------------------


def _castle_group(x, y, seed, scale=1.0, layer="V2_Castle", n_towers=4, dominant=1.0):
    """One palace mass with REAL variation: the tower bodies rotate through
    round / square / octagon / slender, the roofs through ogee / bell / steep
    cone / flat-crenellated / dome, halls carry facade bays and an arcade,
    finials alternate ball / spire, heights and widths differ per tower, and
    the cluster's footprint and yaw change with the seed. Ten groups do not
    read as ten copies."""
    k = seed
    h = _rnd
    roofs = ("MI_V2_RoofPink", "MI_V2_RoofRose", "MI_V2_RoofNavy", "MI_V2_RoofPink", "MI_V2_RoofLilac")
    bodies = ("castle_tower", "castle_tower_square", "castle_tower_octagon", "castle_tower_slender")
    body_h = {"castle_tower": 1700.0, "castle_tower_square": 1700.0, "castle_tower_octagon": 1800.0, "castle_tower_slender": 2000.0}
    caps = {"castle_tower": ("roof_ogee", "roof_bell"), "castle_tower_square": ("roof_flat_crenellated", "roof_hip"),
            "castle_tower_octagon": ("roof_cone_steep", "roof_bell"), "castle_tower_slender": ("roof_cone_steep", "roof_ogee")}
    yaw = (k * 37) % 40 - 20
    items = [
        A("castle_hall", x, y, 0, yaw=yaw, s=scale, mat="MI_V2_IvoryStone", label="City%d_Hall" % k),
        A(("roof_hip", "roof_flat_crenellated")[k % 2], x, y, 900 * scale, yaw=yaw, s=scale, mat=roofs[k % 5], label="City%d_HallRoof" % k),
        A("castle_arcade", x, y - 430 * scale, 0, yaw=yaw, s=scale * 1.6, mat="MI_V2_IvoryStone", label="City%d_Arcade" % k),
    ]
    for f in range(3):
        items.append(A("facade_panel", x - 400 * scale + 400 * scale * f, y - 402 * scale, 420 * scale, yaw=yaw, s=scale,
                       mat="MI_V2_IvoryStone", label="City%d_Bay%d" % (k, f)))
    towers = (((700, 200), 1.0, 0), ((-600, -100), 0.8, 1), ((100, 800), 1.35, 2), ((-900, 600), 1.1, 3))[:max(1, int(n_towers))]
    for t, ((ox, oy), ts, bi) in enumerate(towers):
        if t == 0:
            ts = ts * dominant   # PASS 06: one tower may rule its cluster
        # a distinct PERMUTATION of the four bodies per group (24 exist, 13
        # groups), so no two groups share a tower sequence -- a hash pick
        # produced two collisions in thirteen
        import itertools
        perm = list(itertools.permutations(bodies))[(k * 5) % 24]
        body = perm[t]
        cap = caps[body][int(h(k, t, 8) * 2) % 2]
        ts2 = ts * (0.85 + 0.3 * h(k, t, 1)) * scale
        tx, ty = x + ox * scale, y + oy * scale
        items.append(A(body, tx, ty, 0, yaw=yaw + 20 * t, s=ts2, mat="MI_V2_IvoryStone", label="City%d_Tower%d" % (k, t)))
        zt = body_h[body] * ts2
        items.append(A(cap, tx, ty, zt, yaw=yaw + 20 * t, s=ts2 * (1.15 if body == "castle_tower_slender" else 1.0),
                       mat=roofs[(k + t + 1) % 5], label="City%d_Tower%d_Roof" % (k, t)))
        if body in ("castle_tower", "castle_tower_octagon") and t % 2 == 0:
            items.append(A("balcony_ring", tx, ty, zt * 0.62, s=ts2, mat="MI_V2_IvoryStone", label="City%d_Tower%d_Balcony" % (k, t)))
        finial = ("gate_finial_ball", "finial_spire")[(k + t) % 2]
        cap_h = {"roof_ogee": 800.0, "roof_bell": 640.0, "roof_cone_steep": 560.0, "roof_flat_crenellated": 110.0, "roof_hip": 430.0}[cap]
        if cap != "roof_flat_crenellated":
            items.append(A(finial, tx, ty, zt + cap_h * ts2 * (1.15 if body == "castle_tower_slender" else 1.0),
                           s=ts2 * 0.9, mat="MI_V2_Gold", label="City%d_Tower%d_Finial" % (k, t)))
    items.append(A("castle_dome", x - 250 * scale, y + 450 * scale, 900 * scale, s=scale,
                   mat=("MI_V2_Gold", "MI_V2_RoofRose", "MI_V2_RoofNavy")[k % 3], label="City%d_Dome" % k))
    items.append(A("castle_bridge", x + 400 * scale, y + 500 * scale, 1000 * scale, yaw=35 + yaw, s=scale,
                   mat="MI_V2_IvoryStone", label="City%d_Bridge" % k))
    return _band(layer, items)


CITY = (
    # LAYER 3: the castle focal plane, 95-130 m -- the massing the founder
    # approved (SUITE01); unchanged
    _castle_group(2400, 9500, 1, 1.0) + _castle_group(-2600, 10200, 2, 1.1) + _castle_group(300, 11500, 3, 1.7)
    + _castle_group(5200, 12200, 4, 1.3) + _castle_group(-5600, 13000, 5, 1.4)
    # PASS 06 (founder, 2026-08-28: "beyond the castle the world starts to
    # look too deep and messy"). Layers 4 and 5 were eight groups of four
    # towers at scale 2.0-4.6 stacked behind the castle on its own silhouette
    # -- thirty-two giant tower tops and no hierarchy. Now:
    # LAYER 4, 185-240 m: three DISTINCT silhouettes with clean air between
    # them and nothing within 12 deg of the axis, so the castle's outline
    # reads against sky. Each is one dominant tower with two attendants.
    + _castle_group(-8800, 19500, 7, 2.2, "V2_Skyline", n_towers=3, dominant=1.5)
    + _castle_group(9200, 21000, 8, 2.1, "V2_Skyline", n_towers=3, dominant=1.45)
    # the on-axis anchor of the beyond: ONE great spire at 360 m, soft in fog
    + _castle_group(0, 36000, 6, 3.6, "V2_Skyline", n_towers=1, dominant=1.7)
    # LAYER 5, 300-420 m: a LOW continuous band of small clusters every ~17
    # deg from -68 to +68 deg, two towers each, fog does the softening -- the
    # city goes on, quietly
    + _castle_group(-30000, 30500, 11, 1.7, "V2_Skyline", n_towers=2)
    + _castle_group(-22500, 34000, 12, 1.6, "V2_Skyline", n_towers=2)
    + _castle_group(-13500, 38500, 13, 1.8, "V2_Skyline", n_towers=2)
    + _castle_group(-6500, 41500, 9, 1.5, "V2_Skyline", n_towers=2)
    + _castle_group(7000, 41000, 10, 1.6, "V2_Skyline", n_towers=2)
    + _castle_group(14500, 38000, 14, 1.7, "V2_Skyline", n_towers=2)
    + _castle_group(23000, 33500, 20, 1.6, "V2_Skyline", n_towers=2)
    + _castle_group(30500, 30000, 16, 1.8, "V2_Skyline", n_towers=2)
)


def _tree_group(x, y, seed, label, s=1.0):
    """A garden tree: trunk and three canopies, the foreground recipe at
    midground scale, so the flanks are furnished with the same language."""
    h = _rnd
    return [
        A("tree_mature_trunk", x, y, 0, yaw=int(360 * h(seed, 1)), s=1.1 * s, mat="MI_V2_Bark", label=label + "_Trunk"),
        A("canopy_large", x, y, 1450 * s, yaw=0, s=1.4 * s, mat="MI_V2_LeafMid", label=label + "_Canopy0"),
        A("canopy_large", x - 320 * s, y + 220 * s, 1320 * s, yaw=130, s=1.05 * s, mat="MI_V2_LeafDark", label=label + "_Canopy1"),
        A("canopy_large", x + 380 * s, y - 150 * s, 1280 * s, yaw=250, s=0.95 * s, mat="MI_V2_LeafLight", label=label + "_Canopy2"),
    ]


def _hedge_wall(x0, y0, x1, y1, n, label, s=1.3, mat="MI_V2_LeafDark"):
    """n hedge masses along a line: a garden wall that gives the midground
    an edge to read against."""
    out = []
    for i in range(n):
        t = (i + 0.5) / n
        out.append(A("hedge_mass", x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0,
                     yaw=int(math.degrees(math.atan2(y1 - y0, x1 - x0))), s=s, mat=mat, label="%s_%d" % (label, i)))
    return out


# PASS 06: THE FLANKS, 60-150 m. From every camera the ground beside and
# behind the castle was a bare green plane. Garden masses in the kit's own
# language: tree groups, hedge walls that make garden rooms, a landmark
# mushroom each side, topiary rows. Left is +X.
BEYOND_L = _band("V2_Castle",
    _tree_group(4600, 6600, 61, "BeyondL_Tree0", 1.1) + _tree_group(6900, 9200, 62, "BeyondL_Tree1", 1.25)
    + _tree_group(9400, 7200, 63, "BeyondL_Tree2", 1.0) + _tree_group(3900, 14800, 64, "BeyondL_Tree3", 1.3)
    + _hedge_wall(3400, 4600, 6800, 4800, 6, "BeyondL_Wall0")
    + _hedge_wall(7200, 5200, 7600, 9600, 7, "BeyondL_Wall1", mat="MI_V2_LeafMid")
    + _hedge_wall(4200, 11200, 8800, 11600, 7, "BeyondL_Wall2")
    + [A("mushroom_giant", 5800, 8000, 76, yaw=40, s=1.15, mat="MI_V2_MushRed", label="BeyondL_Mushroom"),
       A("mushroom_medium", 8300, 6300, 0, yaw=200, s=1.3, mat="MI_V2_MushPurple", label="BeyondL_Mush1"),
       A("mushroom_medium", 3600, 9800, 0, yaw=80, s=1.1, mat="MI_V2_MushCream", label="BeyondL_Mush2")]
    + [A("topiary_cone_plain", 3600 + 600 * i, 5600, 0, s=1.3, mat="MI_V2_LeafMid", label="BeyondL_Cone%d" % i) for i in range(5)]
    + [A("topiary_ball", 8000 + 500 * i, 10400, 0, s=1.5, mat="MI_V2_LeafLight", label="BeyondL_Ball%d" % i) for i in range(4)]
)
BEYOND_R = _band("V2_Castle",
    _tree_group(-5000, 7200, 71, "BeyondR_Tree0", 1.2) + _tree_group(-7600, 9800, 72, "BeyondR_Tree1", 1.1)
    + _tree_group(-9800, 6600, 73, "BeyondR_Tree2", 1.05) + _tree_group(-4400, 15200, 74, "BeyondR_Tree3", 1.35)
    + _hedge_wall(-3600, 4800, -7400, 5000, 6, "BeyondR_Wall0", mat="MI_V2_LeafMid")
    + _hedge_wall(-7800, 5400, -8200, 10200, 7, "BeyondR_Wall1")
    + _hedge_wall(-4600, 11600, -9400, 12000, 7, "BeyondR_Wall2", mat="MI_V2_LeafMid")
    + [A("mushroom_giant", -6400, 8600, 76, yaw=220, s=1.05, mat="MI_V2_MushRed", label="BeyondR_Mushroom"),
       A("mushroom_medium", -3800, 6000, 0, yaw=10, s=1.2, mat="MI_V2_MushCream", label="BeyondR_Mush1"),
       A("mushroom_medium", -9000, 8600, 0, yaw=140, s=1.3, mat="MI_V2_MushPurple", label="BeyondR_Mush2")]
    + [A("topiary_cone_plain", -3800 - 600 * i, 6000, 0, s=1.3, mat="MI_V2_LeafMid", label="BeyondR_Cone%d" % i) for i in range(5)]
    + [A("topiary_spiral", -8600 - 500 * i, 10800, 0, s=1.4, mat="MI_V2_LeafDark", label="BeyondR_Spiral%d" % i) for i in range(3)]
)

# PASS 06: BEHIND THE ARRIVAL GATE. ReverseCam03 and ScaleCam07 showed the
# world ending at the gate with the panorama painted behind it. An avenue:
# hedge rows and a tree line either side of the axis, a pair of towers where
# the avenue meets the city behind, and a cluster beyond them.
AVENUE = _band("V2_Arrival",
    _hedge_wall(900, -2200, 900, -6200, 6, "Avenue_HedgeL", s=1.2, mat="MI_V2_LeafMid")
    + _hedge_wall(-900, -2200, -900, -6200, 6, "Avenue_HedgeR", s=1.2, mat="MI_V2_LeafMid")
    + [A("tree_slender_trunk", 1500, -2800 - 1100 * i, 0, yaw=40 * i, s=1.1, mat="MI_V2_Bark", label="Avenue_TreeL%d" % i) for i in range(3)]
    + [A("canopy_medium", 1500, -2800 - 1100 * i, 880, yaw=30 * i, s=1.2, mat="MI_V2_LeafMid", label="Avenue_CanopyL%d" % i) for i in range(3)]
    + [A("tree_slender_trunk", -1500, -3300 - 1100 * i, 0, yaw=50 * i, s=1.1, mat="MI_V2_Bark", label="Avenue_TreeR%d" % i) for i in range(3)]
    + [A("canopy_medium", -1500, -3300 - 1100 * i, 880, yaw=70 * i, s=1.2, mat="MI_V2_LeafLight", label="Avenue_CanopyR%d" % i) for i in range(3)]
    + [A("tower_capped", 2600, -8200, 0, s=1.3, mat="MI_V2_IvoryStone", label="Avenue_TowerL"),
       A("roof_cone_steep", 2600, -8200, 1430, s=1.3, mat="MI_V2_RoofPink", label="Avenue_TowerL_Cap"),
       A("gate_finial_ball", 2600, -8200, 1430 + 640 * 1.3, s=1.0, mat="MI_V2_Gold", label="Avenue_TowerL_Finial"),
       A("tower_capped", -2600, -8200, 0, s=1.3, mat="MI_V2_IvoryStone", label="Avenue_TowerR"),
       A("roof_cone_steep", -2600, -8200, 1430, s=1.3, mat="MI_V2_RoofLilac", label="Avenue_TowerR_Cap"),
       A("gate_finial_ball", -2600, -8200, 1430 + 640 * 1.3, s=1.0, mat="MI_V2_Gold", label="Avenue_TowerR_Finial")]
    + _castle_group(600, -16000, 17, 1.9, "V2_Skyline", n_towers=3, dominant=1.3)
    + _castle_group(-9000, -14000, 18, 1.6, "V2_Skyline", n_towers=2)
    + _castle_group(9500, -13500, 22, 1.6, "V2_Skyline", n_towers=2)
)

# ---------------------------------------------------------------------------
# SKY: the panorama dome (sky only) and restrained floating props
# ---------------------------------------------------------------------------
def _balloons():
    """The boards' skyline, which this world's sky did not have.

    Hot-air balloons appear in the hero frame of all three reference boards,
    in the skyline panel of two, and have a panel of their own ("SKYLINE &
    FLOATING ELEMENTS"). Wonderland's sky held clouds and a dome -- and the
    sky is the half of every wide frame that no amount of garden can fill.

    Sited by hand-written rules rather than scattered: they drift over the
    CITY and the outer districts, never over the plaza (where they would sit
    in HeroCam0's castle sightline at the height the castle occupies), and
    their altitude rises with distance so the far ones read against sky rather
    than against the skyline they are meant to sit above.
    """
    silks = ("MI_V2_RoofPink", "MI_V2_RoofLilac", "MI_V2_RoofBlue",
             "MI_V2_RoofRose", "MI_V2_RoofNavy", "MI_V2_PetalViolet")
    out = []
    for i in range(24):
        b = (360.0 * i / 24.0 + 41.0 * _rnd(i, 77, 1)) % 360.0
        r = 9000.0 + 30000.0 * _rnd(i, 77, 2) ** 0.7
        a = math.radians(b)
        x, y = math.cos(a) * r, math.sin(a) * r
        # higher the further out, so a distant balloon is not lost in the city
        z = 2600.0 + 4200.0 * (r / 39000.0) + 1800.0 * _rnd(i, 77, 3)
        s = 0.85 + 0.85 * _rnd(i, 77, 4)
        yaw = _rnd(i, 77, 5) * 360.0
        out += [
            A("balloon_envelope", x, y, z, yaw=yaw, s=s, mat=silks[i % 6],
              label="Balloon%02d" % i),
            A("balloon_basket", x, y, z, yaw=yaw, s=s, mat="MI_V2_Bark",
              label="Balloon%02d_Basket" % i),
        ]
    return out


SKY = _band("V2_Skyline", [
    A("sky_dome", 0, 0, -200, yaw=0, s=1.0, mat="MI_V2_SkyPano", label="Sky_MarblePanorama"),
] + _balloons())
HOVER = _band("V2_Props", [
    A("key_ornate", 900, 2600, 2100, yaw=20, s=0.8, mat="MI_V2_Gold", label="FloatKey0"),
    A("key_ornate", -1400, 4200, 2400, yaw=160, s=0.8, mat="MI_V2_Gold", label="FloatKey1"),
    A("tea_pot", 400, 6000, 2900, yaw=30, s=1.1, mat="MI_V2_Ceramic", label="FloatTeapot"),
    A("tea_cup_small", -300, 5000, 3300, yaw=200, s=1.0, mat="MI_V2_Ceramic", label="FloatCup"),
])

FOREGROUND = GATE + SIDES
COURTYARD = []
GARDEN = CORRIDOR + GARDEN_L + GARDEN_R
# ---------------------------------------------------------------------------
# W1: THE CASTLE APPROACH BECOMES A PLACE (2026-08-29)
#
# THE MEASUREMENT THAT MADE THIS PASS. From the garden gates (y = 17 m) to the
# castle front (y = 90 m), within 25 m of the axis, this district held ZERO
# actors across 3,650 square metres -- while the plaza it leads from holds one
# every fifteen. The approach a participant walks toward the hero building was
# 246 times emptier than the space they had just crossed, which is exactly why
# the castle read as the last object at the edge of a set rather than a gateway
# into more Wonderland.
#
# WHAT IS BUILT, AND WHY IN THIS ORDER. Large masses first, then medium
# structure, then small detail -- never scatter:
#
#   * PAIRED HEDGE MASSES step inward as the approach rises (26 m apart at the
#     bottom, 17 m at the top). A corridor that narrows makes the castle grow
#     without moving it, and it gives the walk a direction that open lawn
#     cannot.
#   * A FOUNTAIN COURT at the midpoint: the one place on the whole route with
#     a reason to stop, ringed by its own low kerb, benches of clipped topiary
#     and four urns. It is also the district's first water.
#   * TWO CROSS-AXES at the court, so the approach is not a corridor with no
#     exits: each ends in an arch and a landmark mushroom, which is where the
#     left and right garden routes rejoin.
#   * TREE PAIRS between the masses for canopy overhead, and beds of flowers
#     at their feet, so the eye has something at every height rather than only
#     at the horizon.
#
# Nothing here touches the castle, the skyline bands or the garden gates: the
# PASS 06/07 hierarchy is preserved and this fills the hole inside it.
def _approach_pair(y, half, seed, hedge_mat="MI_V2_LeafMid"):
    """One rung of the approach: a hedge mass either side at +-half."""
    out = []
    for side, tag in ((1.0, "L"), (-1.0, "R")):
        out.append(A("hedge_mass", side * half, y, 0, yaw=(seed * 37 + (0 if side > 0 else 90)) % 360,
                     s=1.25, mat=hedge_mat, label="Approach_Hedge%s%d" % (tag, seed)))
    return out


# W1b: THE STEP THE PATH FORGOT.
#
# PATH_SPLINE lifts the path 60 uu between y = 2940 and y = 3060 and nothing
# was ever built to carry a walker up it. The first gait capture found it the
# only way it could be found: the Dog walked north, met a 60 uu wall against
# its 26 uu step height, and stood there -- six route legs in a row gave up,
# 2,221 uu short of the fountain and 5,021 short of the castle. The approach
# W1 had just furnished could not be reached on foot at all.
#
# path_steps is exactly the piece for it: three 20 uu risers, 4.6 m wide, with
# the cut-stone nosing the plaza's own steps use. Two flights side by side span
# the path's width, and a balustrade each side finishes the edge the way the
# front steps do.
APPROACH_STEPS = _band("V2_Arrival", [
    A("path_steps", -230, 2940, 0, s=1.0, mat="MI_V2_PathStone", label="ApproachSteps_L"),
    A("path_steps", 230, 2940, 0, s=1.0, mat="MI_V2_PathStone", label="ApproachSteps_R"),
    A("balustrade", -520, 3010, 0, yaw=90, s=1.0, mat="MI_V2_IvoryStone", label="ApproachSteps_BalL"),
    A("balustrade", 520, 3010, 0, yaw=90, s=1.0, mat="MI_V2_IvoryStone", label="ApproachSteps_BalR"),
    A("pedestal_finial", -520, 2900, 0, s=0.9, mat="MI_V2_IvoryStone", label="ApproachSteps_PlinthL"),
    A("pedestal_finial", 520, 2900, 0, s=0.9, mat="MI_V2_IvoryStone", label="ApproachSteps_PlinthR"),
    A("gate_finial_ball", -520, 2900, 300, s=0.8, mat="MI_V2_Gold", label="ApproachSteps_FinialL"),
    A("gate_finial_ball", 520, 2900, 300, s=0.8, mat="MI_V2_Gold", label="ApproachSteps_FinialR"),
])

APPROACH = _band("V2_Garden",
    # the corridor, narrowing as it climbs toward the castle
    _approach_pair(2400, 2600, 0)
    + _approach_pair(3400, 2500, 1, "MI_V2_LeafDark")
    + _approach_pair(4400, 2400, 2)
    + _approach_pair(6600, 2000, 5, "MI_V2_LeafDark")
    + _approach_pair(7600, 1850, 6)
    + _approach_pair(8500, 1700, 7, "MI_V2_LeafDark")
    # trees between the masses: canopy overhead on the way up
    + [A("tree_mature_trunk", 2050 * (1 if i % 2 == 0 else -1), 2900 + 1500 * i, 0,
         yaw=31 * i, s=1.15, mat="MI_V2_Bark", label="Approach_Trunk%d" % i) for i in range(4)]
    + [A("canopy_large", 2050 * (1 if i % 2 == 0 else -1), 2900 + 1500 * i, 940,
         yaw=44 * i, s=1.2, mat=("MI_V2_LeafMid" if i % 2 else "MI_V2_LeafLight"),
         label="Approach_Canopy%d" % i) for i in range(4)]
    # THE FOUNTAIN COURT, at the midpoint of the climb
    + [A("fountain_basin", 0, 5400, 0, s=1.0, mat="MI_V2_IvoryStone", label="Court_FountainBasin"),
       A("fountain_water", 0, 5400, 0, s=1.0, mat="MI_V2_Water", label="Court_FountainWater"),
       A("fountain_finial", 0, 5400, 300, s=1.0, mat="MI_V2_Gold", label="Court_FountainFinial")]
    + [A("topiary_cone_roses", 620 * (1 if i < 2 else -1), 5400 + (330 if i % 2 else -330), 0,
         yaw=45 * i, s=1.0, mat="MI_V2_LeafDark", label="Court_Topiary%d" % i) for i in range(4)]
    + [A("garden_urn", 900 * (1 if i < 2 else -1), 5400 + (760 if i % 2 else -760), 0,
         s=1.0, mat="MI_V2_Ceramic", label="Court_Urn%d" % i) for i in range(4)]
    + [A("flower_cluster", 900 * (1 if i < 2 else -1), 5400 + (760 if i % 2 else -760), 150,
         s=0.6, mat=("MI_V2_PetalRose" if i % 2 else "MI_V2_PetalWhite"),
         label="Court_UrnFlowers%d" % i) for i in range(4)]
    # the cross-axes out of the court, each ending in an arch and a landmark
    + [A("garden_arch_stone", 2300, 5400, 0, yaw=90, s=1.0, mat="MI_V2_IvoryStone", label="Court_ArchL"),
       A("garden_arch_stone", -2300, 5400, 0, yaw=90, s=1.0, mat="MI_V2_IvoryStone", label="Court_ArchR"),
       A("mushroom_landmark", 3100, 5400, 0, s=1.1, mat="MI_V2_MushStem", label="Court_MushL"),
       A("mushroom_giant", 3100, 5400, 0, s=1.1, mat="MI_V2_MushTerracotta", label="Court_MushLCap"),
       A("mushroom_landmark", -3100, 5400, 0, s=1.05, mat="MI_V2_MushStem", label="Court_MushR"),
       A("mushroom_giant", -3100, 5400, 0, s=1.05, mat="MI_V2_MushPurple", label="Court_MushRCap")]
    # beds along the corridor, at the feet of the hedges
    + [A("planter_box", 1750 * (1 if i % 2 == 0 else -1), 3000 + 900 * i, 0,
         yaw=90, s=1.1, mat="MI_V2_IvoryStone", label="Approach_Bed%d" % i) for i in range(6)]
    + [A("ground_flowers", 1750 * (1 if i % 2 == 0 else -1), 3000 + 900 * i, 60,
         yaw=17 * i, s=1.0, mat=("MI_V2_PetalPink" if i % 3 == 0 else
                                 "MI_V2_PetalViolet" if i % 3 == 1 else "MI_V2_PetalBlue"),
         label="Approach_BedFlowers%d" % i) for i in range(6)]
)

PALACE = CITY + BEYOND_L + BEYOND_R + AVENUE + APPROACH + APPROACH_STEPS
# ---------------------------------------------------------------------------
# PASS 09 — THE FLANKS AND THE REAR WORLD BECOME PLACES
# ---------------------------------------------------------------------------
#
# Measured off this file before a line of it was written. W1 closed the
# founder's "empty lawn between garden gates and castle": the castle approach
# went from 0 actors over 3,650 m2 to 199, one per 18 m2. The emptiness did
# not go away, it moved outward.
#
#   plaza / arrival      257 actors   1,600 m2    1 per   6 m2
#   castle approach      199 actors   3,650 m2    1 per  18 m2
#   left flank            34 actors   6,050 m2    1 per 178 m2
#   right flank           38 actors   6,050 m2    1 per 159 m2
#   behind spawn          30 actors  11,200 m2    1 per 373 m2
#
# 23,300 m2 at ten to sixty times the plaza's sparsity, against the plaza's
# 1,600 -- that is the expanse SkylineCam06 shows, and it is 45% of that
# frame. It is what makes an elevated camera read the district as a model on a
# lawn rather than as part of a world.
#
# The language is the reference's, not a scatter: gardens here are ORGANISED.
# Beds have edges. Quarters have centres. Hedges make rooms and the gaps
# between them are the walks. Landmarks sit at the ends of things, so the eye
# is led rather than filled. Nothing here is a new visual idea -- every piece
# is from the kit Golden Arrival already established, which is the point: this
# is the first use of that kit as a KIT, and the flanks are where it has to
# prove it travels.
#
# Density targets, in the same units the audit used: flanks 1 per 50 m2 (a
# garden -- airier than a plaza, denser than a lawn), behind the spawn 1 per
# 90 m2 (scenic, off the primary route). Those are targets, not quotas: the
# brief's rule is that dense does not mean cluttered, and every walk through
# these rooms stays open for a social space.


def _parterre(sgn, cx, cy, seed, tag, H=None):
    """A formal quadrant garden: four hedged beds around a centrepiece, with
    the walks between them left open. This is the unit the reference's royal
    gardens are made of -- geometry first, then colour inside it.

    HIERARCHY, WITHOUT REDRAWING THE UNIT. A parterre is a designed
    composition and stretching its spacing would make a sprawl of it, so
    distance changes what is IN it and how big the whole is, never its
    proportions: the blooms thin, then the kerb course goes, then the corner
    ornament, then the rim wall -- in that order, because that is the order in
    which they stop being legible. `H` absent (the flanks, the rear world)
    means every one of these is present, exactly as authored.
    """
    out = []
    u = H["scale"] if H else 1.0   # the unit reads bigger with distance
    q = 620.0 * u                  # quadrant side
    w = 150.0 * u                  # half-width of the cross walk
    off = q / 2.0 + w
    petals = ("MI_V2_PetalPink", "MI_V2_PetalViolet", "MI_V2_PetalWhite", "MI_V2_PetalRose")
    for i, (qx, qy) in enumerate(((-1, -1), (-1, 1), (1, -1), (1, 1))):
        bx, by = cx + sgn * qx * off, cy + qy * off
        # the bed's clipped edge: four low runs, the gaps at the corners read
        # as the box hedge a parterre has rather than as a solid green brick
        # MEASURED, not guessed: hedge_block is 353 x 150 x 127 uu. At the
        # uniform s=0.52 this first carried, each "edge" was 184 uu against a
        # 620 uu bed side -- 30% of it -- so the bed would have read as four
        # small green lumps with gaps between them rather than as a clipped
        # border. Stretched along its run instead: 618 x 135 x 108, a low
        # continuous edge at knee height, which is what a parterre has.
        for k, (dx, dy, yaw) in enumerate(((0, -1, 0), (0, 1, 0), (-1, 0, 90), (1, 0, 90))):
            out.append(A("hedge_block", bx + dx * q * 0.5, by + dy * q * 0.5, 0,
                         yaw=yaw, sxyz=(1.75 * u, 0.90, 0.85),
                         mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[(i + k) % 2],
                         label="%s_Bed%d_Edge%d" % (tag, i, k)))
        # THE BED HAS A FLOOR. Without one the blooms sit on lawn showing
        # through between them, and the bed reads as flowers ON grass instead
        # of as a planted bed -- in the boards a bed's ground is dark worked
        # soil, and it is a surprising amount of why their gardens look
        # gardened. garden_lawn is 6004 x 7197 x 30, so these fractions make a
        # 620 x 620 floor, RAISED 3 uu rather than sunk. garden_lawn's box is
        # `box(6000, 7200, 24, at=(0,0,-12))` -- centred 12 below its origin,
        # so its top SURFACE is at local z = 0 and all its thickness hangs
        # below. Placed at z = -6, as this first read, the bed floor's surface
        # would have sat 6 uu UNDER the ground slab's top and the whole thing
        # would have been invisible: a bed floor nobody would ever see, and no
        # gate would have caught it because it placed and resolved perfectly.
        # +3 puts it just proud of the slab (0) and of the garden lawn (-2).
        out.append(A("garden_lawn", bx, by, 3.0, sxyz=(0.1033 * u, 0.0862 * u, 0.5),
                     mat="MI_V2_Soil", label="%s_Bed%d_Soil" % (tag, i)))
        # STONE BORDERS. The brief asks for premium stone borders and formal
        # geometry, and the boards show every bed held by a kerb -- it is the
        # line that makes a bed a BED rather than a patch of planting. Four
        # kerb runs on the bed's own square, laid at its edge and low enough
        # to read as an edging course rather than a wall.
        if H is None or H["prop"] > 0.34:
            for k, (dx, dy, kyaw) in enumerate(((0, -1, 0), (0, 1, 0), (-1, 0, 90), (1, 0, 90))):
                out.append(A("kerb_stone", bx + dx * (q * 0.5 + 34.0 * u), by + dy * (q * 0.5 + 34.0 * u), 0,
                             yaw=kyaw, sxyz=(5.4 * u, 1.0, 0.62), mat="MI_V2_Kerb",
                             label="%s_Bed%d_Kerb%d" % (tag, i, k)))
        # what fills it
        out.append(A("rose_bush", bx, by, 60, yaw=40 * i, s=0.85 * u,
                     mat="MI_V2_LeafMid", label="%s_Bed%d_Rose" % (tag, i)))
        # SEVEN, not three. FlankLeftCam08's first render showed a bed of
        # three blooms reading as three pink dots sitting on grass -- the
        # reference's beds are FULL, the planting is the bed. Filled to the
        # edges with a mix of clusters, blossom and lavender so the bed has
        # colour AND texture rather than four copies of one puff.
        for k in range(7 if H is None else _n(7, H["veg"], 2)):
            a = _rnd(i, k, seed) * 6.283
            r = (90.0 + 145.0 * _rnd(i, k, seed + 20)) * u
            kind = ("flower_cluster", "blossom_cluster", "lavender_heads")[k % 3]
            out.append(A(kind,
                         bx + math.cos(a) * r, by + math.sin(a) * r, 40,
                         yaw=_rnd(i, k, seed + 1) * 360.0, s=(0.5 + 0.24 * _rnd(i, k, seed + 2)) * u,
                         mat=petals[(i + k) % 4] if kind != "lavender_heads" else "MI_V2_Lavender",
                         label="%s_Bed%d_Flower%d" % (tag, i, k)))
        # a ball of clipped box at the bed's inner corner: the rhythm that
        # tells the eye the four beds are one composition
        out.append(A("topiary_ball", bx - sgn * qx * q * 0.42, by - qy * q * 0.42, 0,
                     s=0.62 * u, mat="MI_V2_LeafDark", label="%s_Bed%d_Ball" % (tag, i)))
    # THE WALKS ARE PAVED, because in the reference they are. A royal garden's
    # rooms have a stone floor between their beds; ours had lawn, which is the
    # single clearest way our gardens still read as planting-on-grass rather
    # than as the built rooms the boards show.
    #
    # terrace_platform is 1440 x 740 x 140 uu -- MEASURED, and that 140 is the
    # trap: it is a raised terrace, so dropped in at z=0 it would put a 1.4 m
    # wall across the middle of every garden room. At sz=0.35 it is 49 uu
    # thick and sunk to z=-18 it stands about a kerb's height proud, which
    # reads as paving and steps like paving. The two strips cross at the
    # centrepiece, which is what the four beds are arranged around.
    for k, yaw in enumerate((0.0, 90.0)):
        out.append(A("terrace_platform", cx, cy, -18.0, yaw=yaw,
                     sxyz=(1.07 * u, 0.405 * u, 0.35), mat="MI_V2_PlazaWarm",
                     label="%s_Walk%d" % (tag, k)))
    # the centrepiece the walks run to
    out += [
        A("pedestal_finial", cx, cy, 0, s=1.0 * u, mat="MI_V2_IvoryStone", label="%s_Centre_Plinth" % tag),
        A("garden_urn", cx, cy, 124 * u, s=0.6 * u, mat="MI_V2_Ceramic", label="%s_Centre_Urn" % tag),
        A("flower_cluster", cx, cy, 210 * u, s=0.5 * u, mat="MI_V2_PetalPink", label="%s_Centre_Flowers" % tag),
    ]
    # cones at the room's outer corners, so it has a silhouette from the plaza,
    # and a PLINTHED URN beside each -- the boards put ornament at the corners
    # of a formal room, and a cone alone is a shape rather than a decision
    for i, (qx, qy) in enumerate(((-1, -1), (-1, 1), (1, -1), (1, 1))):
        ox, oy = cx + sgn * qx * (off + q * 0.62), cy + qy * (off + q * 0.62)
        out.append(A("topiary_cone_plain", ox, oy, 0, s=0.9 * u, mat="MI_V2_LeafDark",
                     label="%s_Cone%d" % (tag, i)))
        if H is None or H["prop"] > 0.46:
            out += [
                A("pedestal_finial", ox + sgn * qx * 300.0 * u, oy + qy * 300.0 * u, 0, s=0.8 * u,
                  mat="MI_V2_IvoryStone", label="%s_CornerPlinth%d" % (tag, i)),
                A("garden_urn", ox + sgn * qx * 300.0 * u, oy + qy * 300.0 * u, 100 * u, s=0.5 * u,
                  mat="MI_V2_Ceramic", label="%s_CornerUrn%d" % (tag, i)),
                A("flower_cluster", ox + sgn * qx * 300.0 * u, oy + qy * 300.0 * u, 172 * u, s=0.42 * u,
                  mat=("MI_V2_PetalPink", "MI_V2_PetalViolet", "MI_V2_PetalWhite",
                       "MI_V2_RosePink")[i % 4],
                  label="%s_CornerFlowers%d" % (tag, i)),
            ]
    # THE ROOM HAS A RIM. A low wall along the room's outer square, broken at
    # the four walk entrances, so the garden room is enclosed by architecture
    # the way the boards enclose theirs -- hedges alone read as planting, a
    # stone line reads as a built room.
    rim = off + q * 0.5 + 190.0 * u
    if H is None or H["court_p"] > 0.40:
        for k in range(16):
            side, t = k // 4, (k % 4) / 3.0
            if 0.34 <= t <= 0.66:                 # the gap a walk passes through
                continue
            v = -rim + 2.0 * rim * t
            px, py = ((v, -rim), (v, rim), (-rim, v), (rim, v))[side]
            out.append(A("garden_wall", cx + sgn * px, cy + py, 0,
                         yaw=(0.0, 0.0, 90.0, 90.0)[side], sxyz=(0.72 * u, 1.0, 0.46),
                         mat="MI_V2_IvoryStone", label="%s_Rim%d" % (tag, k)))
    return out


def _grove(sgn, cx, cy, seed, tag, count=5, H=None):
    """A loose group of trees with underplanting -- the canopy that stops a
    flank reading as open ground, placed as a GROUP with a centre and an edge
    rather than as a row.

    `H` is optional and absent inside Golden Arrival on purpose: the flanks
    and the rear world are authored ground the founder has already judged, and
    a hierarchy that quietly rewrote them would be changing approved work to
    fix a problem in the outer world.
    """
    out = []
    sp = H["spacing"] if H else 1.0
    gs = H["scale"] if H else 1.0
    for i in range(count):
        a = 6.283 * i / count + _rnd(i, seed, 3) * 0.9
        r = (320.0 + 520.0 * _rnd(i, seed, 4)) * sp
        x, y = cx + sgn * math.cos(a) * r, cy + math.sin(a) * r
        tall = _rnd(i, seed, 5) > 0.45
        sc = (0.92 + 0.3 * _rnd(i, seed, 6)) * gs
        if tall:
            out.append(A("tree_mature_trunk", x, y, 0, yaw=_rnd(i, seed, 7) * 360.0, s=sc,
                         mat="MI_V2_Bark", label="%s_Trunk%d" % (tag, i)))
            # 1320, not 1180. tree_mature_trunk MEASURES 1,066 x 929 x 1,752
            # uu -- the 1,400 in its recipe is the bole, and its limbs carry it
            # to 1,752. canopy_large is 837 tall, so centred at 1,180 x sc it
            # topped out at 1,619 x sc and left 133 x sc of bare branch above
            # the leaves: the brown spikes still visible on the grove trees in
            # FlankRightCam09 after PASS 08 shortened the limbs. Shortening
            # them was right and was not enough, because the canopy was hung
            # too low to meet them. 1,320 x sc puts the leaf top at 1,759.
            out.append(A("canopy_large", x, y, 1320 * sc, yaw=_rnd(i, seed, 8) * 360.0, s=sc * 1.05,
                         mat=("MI_V2_LeafMid", "MI_V2_LeafDark", "MI_V2_LeafLight")[i % 3],
                         label="%s_Canopy%d" % (tag, i)))
        else:
            out.append(A("tree_slender_trunk", x, y, 0, yaw=_rnd(i, seed, 9) * 360.0, s=sc,
                         mat="MI_V2_Bark", label="%s_SlimTrunk%d" % (tag, i)))
            out.append(A("canopy_medium", x, y, 800 * sc, yaw=_rnd(i, seed, 10) * 360.0, s=sc * 1.1,
                         mat=("MI_V2_LeafLight", "MI_V2_LeafMid")[i % 2],
                         label="%s_SlimCanopy%d" % (tag, i)))
        # what grows at its foot -- underplanting is read at walking distance
        # and is invisible mass beyond it, so it is on the vegetation budget
        if H is None or _rnd(i, seed, 31) < H["veg"]:
            out.append(A("shrub_flowering", x + 190 - 380 * _rnd(i, seed, 11), y + 190 - 380 * _rnd(i, seed, 12), 0,
                         yaw=_rnd(i, seed, 13) * 360.0, s=0.8 * gs, mat="MI_V2_LeafMid",
                         label="%s_Shrub%d" % (tag, i)))
    for k in range(4 if H is None else _n(4, H["prop"], 0)):
        a = 6.283 * k / 4 + 0.4
        out += _ground_patch(cx + sgn * math.cos(a) * 720.0 * sp, cy + math.sin(a) * 720.0 * sp, 0,
                             _rnd(k, seed, 14) * 360.0, 1.0,
                             ("MI_V2_PetalViolet", "MI_V2_PetalWhite")[k % 2],
                             "%s_Ground%d" % (tag, k))
    return out


def _giant_mushroom(x, y, seed, tag, s=1.0, tint="MI_V2_MushRed"):
    """The landmark, all four of its pieces at one transform.

    `mushroom_giant` is a 20 m cap on a 3.5 m stem and it is the object the
    boards put on every page: four panels of them across the three, and a
    named MUSHROOM GROVE on the layout overview. This world had four, all of
    them inside Golden Arrival, because the outer world's groves used
    `mushroom_landmark` -- a 3 m garden mushroom -- for the same job. A grove
    of garden mushrooms is not the Mushroom Grove.

    The cap, its gills, its spots and its gold rim are separate recipes at the
    same transform on purpose: the cream underside is what the eye sees when
    it looks up, and it cannot be the same material as the red top.
    """
    yaw = _rnd(seed, 9, 1) * 360.0
    return [
        A("mushroom_giant", x, y, 76, yaw=yaw, s=s, mat=tint,
          label="%s_Cap" % tag),
        A("mushroom_giant_gills", x, y, 76, yaw=yaw, s=s, mat="MI_V2_MushCream",
          label="%s_Gills" % tag),
        A("mushroom_giant_spots", x, y, 76, yaw=yaw, s=s, mat="MI_V2_MushCream",
          label="%s_Spots" % tag),
        A("mushroom_giant_rim", x, y, 76, yaw=yaw, s=s, mat="MI_V2_Gold",
          label="%s_Rim" % tag),
    ]


def _mushroom_cluster(sgn, cx, cy, seed, tag, H=None):
    """A landmark and its family. Wonderland's mushrooms are architecture, so
    one is large and sited, and the rest read as its grounds.

    FEWER BUT STRONGER with distance: the family thins to nothing and the
    landmark itself grows, which is the whole of "landmark hierarchy" in two
    numbers -- `landmark_p` decides how many companions, `landmark_scale`
    decides how big the one that remains.
    """
    ls = H["landmark_scale"] if H else 1.0
    out = [
        A("stone_ring_base", cx, cy, -2, s=0.85 * ls, mat="MI_V2_Stone", label="%s_Ring" % tag),
        A("mushroom_landmark", cx, cy, 0, yaw=_rnd(seed, 1, 2) * 360.0, s=1.15 * ls,
          mat="MI_V2_MushTerracotta", label="%s_Landmark" % tag),
    ]
    for i in range(3 if H is None else _n(3, H["landmark_p"], 0)):
        a = 6.283 * i / 3 + _rnd(i, seed, 15) * 0.8
        r = (420.0 + 260.0 * _rnd(i, seed, 16)) * (H["spacing"] if H else 1.0)
        out.append(A(("mushroom_medium", "mushroom_small", "mushroom_medium")[i],
                     cx + sgn * math.cos(a) * r, cy + math.sin(a) * r, 0,
                     yaw=_rnd(i, seed, 17) * 360.0,
                     s=(0.8 + 0.35 * _rnd(i, seed, 18)) * (H["scale"] if H else 1.0),
                     mat=("MI_V2_MushRed", "MI_V2_MushPurple", "MI_V2_MushCream")[i % 3],
                     label="%s_Cap%d" % (tag, i)))
    return out


def _rose_walk(sgn, x, y0, y1, seed, tag):
    """A rhythm along the flank's inner edge: clipped box and roses
    alternating, which is what turns open ground into a WAY rather than a
    field, and what the eye follows from the plaza toward the castle."""
    out = []
    # A DELIBERATE GAP, because the lane behind this border is pinched shut.
    #
    # walkable.py routed the left flank's entry to its landmark and the answer
    # was 20 waypoints out to x = 1,500 -- back onto the main approach, up the
    # middle, and in again at the far end. The right flank had NO route at all.
    # The flanks were cul-de-sacs: you could enter them and not cross them.
    #
    # The pinch is between this border at x = 3,050 (+-75) and a PRE-EXISTING
    # hedge mass, BeyondL_Wall0_0, r=416 at (3,683 / 4,617), which spans
    # x 3,267..4,099 and y 4,201..5,033. That leaves a 142 uu lane, and once
    # the Dog's 36 uu capsule is taken off both sides, 70 uu of walkable
    # width -- 0.7 m, which is a squeeze rather than a garden walk, and which
    # a coarser grid reports as no route at all.
    #
    # So the border opens opposite it. A gap in a planted border is ordinary
    # garden language (it is where a path crosses) and it costs two pieces.
    GAP_Y0, GAP_Y1 = 4050.0, 5150.0
    n = int((y1 - y0) / 620.0)
    for i in range(n):
        y = y0 + 620.0 * (i + 0.5)
        if GAP_Y0 <= y <= GAP_Y1:
            continue
        if i % 2 == 0:
            out.append(A("topiary_cone_roses", sgn * x, y, 0, yaw=25 * i, s=0.78,
                         mat="MI_V2_LeafMid", label="%s_Cone%d" % (tag, i)))
        else:
            out.append(A("rose_bush", sgn * x, y, 70, yaw=45 * i, s=0.85,
                         mat="MI_V2_LeafMid", label="%s_Rose%d" % (tag, i)))
            out.append(A("lavender_heads", sgn * (x + 150), y, 0, yaw=15 * i, s=0.9,
                         mat="MI_V2_Lavender", label="%s_Lav%d" % (tag, i)))
    return out


def _boundary(sgn, x, y0, y1, seed, tag):
    """The district needs an EDGE, not a fade. A low garden wall with piers on
    a regular pitch, ivied, so the flank ends in architecture instead of in
    the ground slab running out."""
    out = []
    n = int((y1 - y0) / 500.0)
    for i in range(n):
        y = y0 + 500.0 * (i + 0.5)
        out.append(A("garden_wall", sgn * x, y, 0, yaw=90, s=1.0,
                     mat="MI_V2_IvoryStone", label="%s_Wall%d" % (tag, i)))
        if i % 3 == 0:
            out += _dress_wall(sgn * x, y, 90.0, 1400.0, "%s_W%d" % (tag, i), planters=False)
        if i % 4 == 0:
            out.append(A("gate_pier", sgn * x, y - 250, 0, s=0.62,
                         mat="MI_V2_IvoryStone", label="%s_Pier%d" % (tag, i)))
            out.append(A("gate_finial_ball", sgn * x, y - 250, 405, s=0.6,
                         mat="MI_V2_Gold", label="%s_Finial%d" % (tag, i)))
        if i % 3 == 1:
            out.append(A("ivy_drape", sgn * (x - 40), y, 180, yaw=90, s=0.9,
                         mat="MI_V2_LeafDark", label="%s_Ivy%d" % (tag, i)))
    return out


#: THE FLANK WALK, ROUTED RATHER THAN RULED.
#:
#: A straight paved spine does not fit either flank -- measured, best
#: clearance -33 uu against the 150 a 3 m walk needs, because the garden is
#: planted along its whole length. That is a fact about STRAIGHT LINES. The
#: walkability flood fill was then asked for the route a walker actually
#: takes, and both flanks answered in seven waypoints that stay inside the
#: flank (before the border gap was opened they answered in twenty, out to
#: x = 1,500 and back down the main approach -- the flanks were cul-de-sacs).
#:
#: These are those waypoints, mirrored. They are DERIVED, not designed: run
#:     python3 wonderland/v2/tools/walkable.py --routes
#: after any change to the flank planting and bring them back into line. The
#: paving is not an obstacle in that fill, so it cannot invent its own route.
FLANK_ROUTE = [(2675, 425), (3225, 425), (3225, 3525), (2975, 3625),
               (2975, 4725), (2775, 4775), (2775, 5675)]


def _paved_route(sgn, pts, width, tag):
    """Lay paving along a polyline, one slab per straight run.

    terrace_platform is 1,440 along X and 740 along Y, so a run laid at yaw 90
    takes its width from sy and its length from sx -- the axis swap that has
    already cost two edits in this file. Sunk 18 uu so it reads as paving
    rather than the 1.4 m terrace it is at scale 1.
    """
    out = []
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        cx, cy = sgn * (x0 + x1) * 0.5, (y0 + y1) * 0.5
        dx, dy = abs(x1 - x0), abs(y1 - y0)
        if dy >= dx:                       # a run along Y
            length = max(dy, width)
            out.append(A("terrace_platform", cx, cy, -18.0, yaw=90,
                         sxyz=(length / 1440.0, width / 740.0, 0.35),
                         mat="MI_V2_PlazaCream", label="%s_Paved%d" % (tag, i)))
        else:                              # a run along X
            length = max(dx, width)
            out.append(A("terrace_platform", cx, cy, -18.0, yaw=0,
                         sxyz=(length / 1440.0, width / 740.0, 0.35),
                         mat="MI_V2_PlazaCream", label="%s_Paved%d" % (tag, i)))
    return out


def _flank(sgn, tag):
    """One flank, near to far: a threshold off the plaza, a parterre, a walk
    that leads along it, a grove, a landmark at the end, and a wall that says
    where the district stops."""
    out = []
    # the threshold, on the cross axis from the plaza's side steps
    out += [
        A("garden_arch_stone", sgn * 2650, 400, 220, yaw=90, s=0.95,
          mat="MI_V2_IvoryStone", label="%s_EntryArch" % tag),
        # a paved apron under the threshold and a paved way from it to the
        # parterre, so the route into the room is stone the whole way
        A("terrace_platform", sgn * 2650, 400, -18.0, yaw=90,
          sxyz=(0.62, 0.44, 0.35), mat="MI_V2_PlazaCream", label="%s_EntryApron" % tag),
        # YAW 90 SWAPS WHICH SCALE AXIS IS WHICH. terrace_platform is 1440
        # along X and 740 along Y; turned 90 degrees its X extent comes from
        # sy and its Y extent from sx. The first version of this line read as
        # if it did not: it put an 851 x 432 slab centred at x=3480, which
        # overlapped the parterre's outer edge at 3580 and stopped 400 uu
        # short of the arch it was supposed to lead from. The gap to pave runs
        # x 2650 (arch) to 3580 (bed edge), so 930 along X and 300 across.
        A("terrace_platform", sgn * 3115, 520, -18.0, yaw=90,
          sxyz=(0.208, 1.26, 0.35), mat="MI_V2_PlazaWarm", label="%s_EntryWalk" % tag),
        A("topiary_cone_plain", sgn * 2650, 40, 0, s=0.85, mat="MI_V2_LeafDark", label="%s_EntryConeA" % tag),
        A("topiary_cone_plain", sgn * 2650, 760, 0, s=0.85, mat="MI_V2_LeafDark", label="%s_EntryConeB" % tag),
    ]
    # THE FLANK CAMERAS STOOD ON BARE GROUND. FlankLeftCam08 sits at
    # y = -1,250 and the flank's first content was the parterre's near bed at
    # y = -70: twelve metres of empty lawn across the bottom 40% of the first
    # frame. Exactly the defect the offline preview caught for RearWorldCam10
    # an hour earlier -- and I fixed that one and did not think to check these
    # two, which is the same mistake as fixing an instance instead of a class.
    # The near field is now the start of the sequence rather than the run-up
    # to it: a flowering bank across the approach, trees framing both sides,
    # and a mushroom at the outer corner.
    out += [
        A("tree_mature_trunk", sgn * 3150, -1450, 0, yaw=200, s=1.05, mat="MI_V2_Bark",
          label="%s_NearTreeA_Trunk" % tag),
        A("canopy_large", sgn * 3150, -1450, 1385, yaw=40, s=1.1, mat="MI_V2_LeafMid",
          label="%s_NearTreeA_Canopy" % tag),
        A("tree_slender_trunk", sgn * 6000, -1350, 0, yaw=70, s=1.0, mat="MI_V2_Bark",
          label="%s_NearTreeB_Trunk" % tag),
        A("canopy_medium", sgn * 6000, -1350, 810, yaw=120, s=1.15, mat="MI_V2_LeafLight",
          label="%s_NearTreeB_Canopy" % tag),
    ] + [
        # a flowering bank across the near approach, low so it does not wall
        # the room off -- the eye goes over it to the parterre beyond
        # -700, not -900. Same arithmetic as RearWorldCam10: FlankLeftCam08's
        # eye is at 2.65 m with a 58.7 deg vertical field pitched -4, so its
        # lower edge meets the ground at 2.65 / tan(33.4) = 4.0 m. At y = -900
        # this bank stood 3.5 m out -- under the lens, invisible, and it is
        # why the first fix for "the camera stands on bare lawn" only half
        # worked: the mid band at 8.2 m showed and this did not.
        # massed for the same reason as the rear band: an even row of seven
        # reads as a fence of separate objects, three groups read as planting
        # LOW AT THE FRONT. Massing this bank fixed the polka dots and went
        # straight past the mark: at s 0.82-0.96, five and a half metres from
        # a 2.65 m eye, it became a WALL of foliage across the bottom 45% of
        # the frame with the garden hidden behind it -- the brief's "dense
        # does not mean cluttered" and "dark masses swallowing architecture"
        # in a single edit, after two passes spent making this ground NOT
        # bare. The nearest planting must be something the eye goes OVER:
        # clipped balls and low flowering shrubs at knee to waist, with the
        # height kept for the masses at 9-12 m. hedge_block leaves this mix --
        # it is a 1.27 m hedge and at 5.5 m that is a fence.
        # COLOUR, measured on this very frame. gap_v2 against the founder
        # reference: the green arc holds 25.6% of ours and 4.8% of theirs
        # (5.3x), the rose arc 1.8% against 6.8% (0.26x), and the foreground
        # sits at p50 61 against 151. A royal garden in the boards is BLOOM
        # with green between it; this had become green with a little bloom in
        # it -- which is what happens when three passes in a row are spent
        # fixing how MUCH planting there is and none on what colour it is.
        # Every other piece now carries a petal colour, and the greens include
        # LeafLight so the mass is not one tone.
        A(("topiary_ball", "blossom_cluster", "shrub_flowering", "flower_cluster",
           "topiary_ball", "lavender_heads")[k % 6],
          sgn * (bx + (-130 + 105 * (k % 3))), -700 + 85 * ((k % 2) * 2 - 1) + 45 * (k % 3), 0,
          yaw=90 + 37 * k, s=0.50 + 0.11 * ((k % 3) / 2.0),
          mat=("MI_V2_LeafMid", "MI_V2_PetalPink", "MI_V2_LeafLight",
               "MI_V2_PetalViolet", "MI_V2_LeafDark", "MI_V2_Lavender")[k % 6],
          label="%s_NearClump%d_%d" % (tag, bi, k))
        # same frustum rule: FlankLeftCam08 sits at x = 4,350, and at the
        # 5.5 m depth of this bank the frame is 5.5 m wide, so a clump must
        # stand within 550 uu of the camera's x to be in it at all.
        for bi, bx in enumerate((3980, 4350, 4720))
        for k in range(6)
    ] + [
        g for i in range(5)
        for g in _ground_patch(sgn * (3600 + 560 * i), -520, 0, 55 * i, 1.05,
                               ("MI_V2_PetalViolet", "MI_V2_PetalWhite", "MI_V2_PetalPink")[i % 3],
                               "%s_NearFlowers%d" % (tag, i))
    ]
    # and the band between the near bank and the parterre, which
    # FlankLeftCam08 still showed as open lawn across the middle of the frame:
    # the bank sits at y = -900 and the parterre's outer edge at y = -144, so
    # six and a half metres of nothing at exactly the depth perspective makes
    # widest. Low planting, so it fills the ground without walling the room
    # off -- the eye still travels over it to the parterre.
    out += [
        A(("topiary_ball", "rose_bush", "blossom_cluster", "shrub_flowering",
           "flower_cluster", "topiary_ball", "lavender_heads")[i % 7],
          sgn * (3250 + 480 * i), -430 + 70 * ((i % 2) * 2 - 1), 0,
          yaw=35 * i, s=0.8,
          mat=("MI_V2_LeafDark", "MI_V2_RosePink", "MI_V2_PetalPink", "MI_V2_LeafLight",
               "MI_V2_PetalWhite", "MI_V2_LeafMid", "MI_V2_Lavender")[i % 7],
          label="%s_MidBand%d" % (tag, i))
        for i in range(9)
    ]
    for i in range(4):
        out += _ground_patch(sgn * (3500 + 720 * i), -250, 0, 40 * i, 0.95,
                             ("MI_V2_PetalPink", "MI_V2_Lavender", "MI_V2_PetalWhite")[i % 3],
                             "%s_MidGround%d" % (tag, i))
    out += _mushroom_cluster(sgn, sgn * 6400, -1750, 4900 if sgn > 0 else 5000, "%s_NearMush" % tag)
    out += _parterre(sgn, sgn * 4350, 700, 4100 if sgn > 0 else 4200, "%s_Parterre" % tag)
    out += _rose_walk(sgn, 3050, 1900, 5900, 4300, "%s_Walk" % tag)
    # A PAVED SPINE DOES NOT FIT HERE, AND THAT IS THE FINDING.
    #
    # Every room in this flank is joined by lawn, which is unlike the
    # reference (its gardens are threaded with stone) and against the brief's
    # rule that art and navigation are developed together: a garden with no
    # path is a garden nobody walks. So a paved run was authored along the
    # flank's length -- and then MEASURED before it shipped, by scanning the
    # clearance of a straight line at every x from 2,800 to 4,500 over
    # y 2,000..5,800 against every solid actor:
    #
    #   best clearance, left flank:   -25 uu (at x = 3,300)
    #   best clearance, right flank: +102 uu (at x = 3,400)
    #
    # A 3 m walk needs 150. Nothing fits, on either side, anywhere in the
    # band. The obstruction is not this pass's work: a pre-existing hedge mass
    # (BeyondL_Wall0_0, r=416 at 3,683/4,617) lies across the line, and the
    # rose border at 3,050 closes the gap from the other side. Paving it
    # anyway would have run stone through a hedge.
    #
    # So the walk is NOT placed. The flank's rooms are reached individually
    # from the plaza for now, and its internal circulation is real design work
    # -- a routed path that goes round what is already there, or that hedge
    # moved -- rather than a strip laid down a constant x. Recorded here so
    # the next pass starts from the measurement instead of rediscovering it.
    out += _grove(sgn, sgn * 5450, 3650, 4400 if sgn > 0 else 4500, "%s_Grove" % tag)
    out += _mushroom_cluster(sgn, sgn * 4900, 6900, 4600 if sgn > 0 else 4700, "%s_Mush" % tag)
    out += _boundary(sgn, 7700, -1200, 8300, 4800, "%s_Edge" % tag)
    out += _paved_route(sgn, FLANK_ROUTE, 260.0, "%s_Walk" % tag)
    # WONDERLAND, NOT A FORMAL GARDEN. The flanks as built read as a competent
    # royal parterre and nothing in them says which world it is -- the boards
    # list clocks, hearts, keys and tea things as the signatures, and the brief
    # is equally clear that they need HIERARCHY rather than a gimmick every
    # five metres. So: ONE major landmark per flank at the end of its walk,
    # where the eye already travels; one small vignette beside the room; and an
    # arch over the way in for vertical structure. Nothing else.
    # (2,750, 5,950) AND NOT (3,050, 6,400), WHICH WAS INSIDE A TOWER.
    # tools/walkable.py flood-filled the world from the spawn and reported the
    # left flank's landmark unreachable; the cause was 180 uu away --
    # Tower_L2, a tower_capped with a 520 uu footprint at (3,200, 6,500). The
    # clock monument had been placed inside a building, and no gate caught it
    # because a layout gate checks that assets and materials resolve, not that
    # two pieces occupy different ground. Moved to the end of the rose walk
    # with 711 uu to the tower and 652 to the court mushroom.
    if sgn > 0:
        # a clock monument, its face turned back down the walk
        out += [
            A("gate_pier", sgn * 2750, 5950, 0, s=0.55, mat="MI_V2_IvoryStone",
              label="%s_ClockPier" % tag),
            A("clock_ornate", sgn * 2750, 5835, 330, yaw=90, s=1.6, mat="MI_V2_Gold",
              label="%s_Clock" % tag),
            A("gate_finial_ball", sgn * 2750, 5950, 372, s=0.5, mat="MI_V2_Gold",
              label="%s_ClockFinial" % tag),
        ]
    else:
        # the heart, on the same beat on the other side
        out += [
            A("heart_topiary", sgn * 2750, 5950, 0, yaw=0, s=0.85, mat="MI_V2_LeafDark",
              label="%s_Heart" % tag),
            A("rose_bush", sgn * 2750, 5730, 60, s=0.8, mat="MI_V2_LeafMid",
              label="%s_HeartRoses" % tag),
        ]
    out += [
        # the tea vignette: a plinth beside the room with a pot and two cups,
        # at the scale that reads as somebody left them there
        A("tea_plinth", sgn * 5200, 1600, 0, s=0.9, mat="MI_V2_IvoryStone", label="%s_TeaPlinth" % tag),
        A("tea_pot", sgn * 5200, 1600, 86, yaw=30 * sgn, s=0.55, mat="MI_V2_Ceramic", label="%s_TeaPot" % tag),
        A("tea_cup", sgn * 5320, 1520, 86, yaw=-40 * sgn, s=0.5, mat="MI_V2_Ceramic", label="%s_TeaCupA" % tag),
        A("tea_cup_small", sgn * 5090, 1690, 86, yaw=70 * sgn, s=0.5, mat="MI_V2_Ceramic", label="%s_TeaCupB" % tag),
        # floral arch over the way in: floral_arch is 1094 along X, so yaw 90
        # spans it ACROSS a walk that runs along X
        A("floral_arch", sgn * 3115, 520, 0, yaw=90, s=0.6, mat="MI_V2_LeafMid",
          label="%s_EntryFloralArch" % tag),
    ]
    return out


def _cam_foreground(cx, cy, yaw_deg, d0, d1, seed, tag):
    """Planting in the band a camera's frame actually opens on.

    camera_framing.py measures where each camera's picture of the ground
    begins; this fills the stretch from there outward for the two garden
    cameras, which it reported as the thinnest in the suite (8 and 10
    placements against 20 for the new flank cameras). Laid ACROSS the view
    rather than along it, low at the centre and taller at the edges, so it
    frames the composition those cameras already have instead of blocking it
    -- they are a regression system and their subject is behind this.
    """
    out = []
    f = (math.cos(math.radians(yaw_deg)), math.sin(math.radians(yaw_deg)))
    r = (-f[1], f[0])
    for i in range(11):
        along = d0 + (d1 - d0) * ((i % 4) / 3.0)
        across = (-1.0 + 2.0 * (i / 10.0)) * (d1 * 0.85)
        x = cx + f[0] * along + r[0] * across
        y = cy + f[1] * along + r[1] * across
        edge = abs(i - 5) / 5.0                       # 0 at centre, 1 at the edges
        if edge > 0.62:
            out += [
                A("tree_slender_trunk", x, y, 0, yaw=_rnd(i, seed, 1) * 360.0, s=0.95,
                  mat="MI_V2_Bark", label="%s_EdgeTrunk%d" % (tag, i)),
                A("canopy_medium", x, y, 780, yaw=_rnd(i, seed, 2) * 360.0, s=1.15,
                  mat=("MI_V2_LeafMid", "MI_V2_LeafDark")[i % 2],
                  label="%s_EdgeCanopy%d" % (tag, i)),
            ]
        else:
            out.append(A(("topiary_ball", "shrub_flowering", "rose_bush", "hedge_block")[i % 4],
                         x, y, 0, yaw=30 * i, s=0.75,
                         mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2],
                         label="%s_Low%d" % (tag, i)))
        if i % 3 == 0:
            out += _ground_patch(x + 120, y - 90, 0, 40 * i, 0.9,
                                 ("MI_V2_PetalPink", "MI_V2_Lavender", "MI_V2_PetalWhite")[i % 3],
                                 "%s_Ground%d" % (tag, i))
    return out


#: The two garden cameras' near fields, sized from camera_framing.py: each
#: sees the ground from 3.2 m and its foreground band runs to 9.5 m.
CAM_FOREGROUNDS = _band("V2_Garden",
                        _cam_foreground(3000.0, 3000.0, 225.0, 380.0, 900.0, 6100, "GL04_Fore")
                        + _cam_foreground(-2800.0, 1500.0, 50.0, 380.0, 900.0, 6200, "GR05_Fore"))


#: THE FLANKS STAND ON THE TERRAIN SLAB, NOT ON LAWN. Every other garden in
#: this world has a `garden_lawn` under it -- a 60 x 72 m slab whose top is a
#: 48 x 48 grid displaced by low-frequency noise, which exists precisely
#: because "a flat plane here is the founder's flat colour in one actor"
#: (garden_lawn's own docstring). The flanks were authored without one, so
#: their ground is the moss terrain slab: one flat quad, one flat tone, under
#: everything. Two meshes fix it.
FLANK_GROUND = _band("V2_Garden", [
    A("garden_lawn", sgn * 5250, 3500, -2, sxyz=(0.92, 1.53, 1.0),
      mat="MI_V2_Lawn", label="FlankGround_%s" % ("L" if sgn > 0 else "R"))
    for sgn in (1, -1)
])

FLANKS = _band("V2_Garden", _flank(1, "FlankL") + _flank(-1, "FlankR"))


# The ground BEHIND the spawn. A participant who turns round at the arrival
# gate should see Wonderland continuing, not the edge of the set -- and this
# is also the first thing a second participant walks through to reach the
# plaza, so it is a route as well as a view.
REARWORLD = _band("V2_Garden", [
    # a second gate on the axis, smaller than the arrival gate and read
    # through it: depth by repetition of the same motif at another scale
    A("gate_pier", 300, -6000, 0, s=0.8, mat="MI_V2_IvoryStone", label="Rear_GatePierL"),
    A("gate_pier", -300, -6000, 0, s=0.8, mat="MI_V2_IvoryStone", label="Rear_GatePierR"),
    A("gate_arch_gold", 0, -6000, 0, s=0.85, mat="MI_V2_Gold", label="Rear_GateArch"),
    A("gate_finial_heart", 300, -6000, 520, s=0.75, mat="MI_V2_Gold", label="Rear_GateFinialL"),
    A("gate_finial_ball", -300, -6000, 520, s=0.8, mat="MI_V2_Gold", label="Rear_GateFinialR"),
] + [
    # a hedged avenue leading to it, narrowing as it goes, so the gate reads
    # as a destination from the plaza
    # yaw 90 so the 353 uu run lies ALONG the avenue, stretched to 459 against
    # a 430 uu pitch: the hedges meet. At yaw 0 they lay across it, 335 wide
    # every 430, and the avenue would have been a dashed line of blocks.
    A("hedge_block", side * (1100 - 55 * i), -2600 - 430 * i, 0, yaw=90,
      sxyz=(1.30, 0.95, 0.95), mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2],
      label="Rear_Avenue%d_%d" % (side, i))
    for side in (1, -1) for i in range(8)
] + _grove(1, 3100, -4400, 5100, "Rear_GroveL", count=4)
  + _grove(-1, -3300, -4900, 5200, "Rear_GroveR", count=4)
  + _grove(1, 2600, -7600, 5300, "Rear_GroveF", count=3)
  + _mushroom_cluster(-1, -5000, -5600, 5400, "Rear_Mush")
  + [
    # a pair of urns on the axis where the avenue begins: the arrival gate
    # framed from behind
    A("pedestal_finial", 700, -2300, 0, s=0.9, mat="MI_V2_IvoryStone", label="Rear_PlinthL"),
    A("pedestal_finial", -700, -2300, 0, s=0.9, mat="MI_V2_IvoryStone", label="Rear_PlinthR"),
    A("garden_urn", 700, -2300, 112, s=0.55, mat="MI_V2_Ceramic", label="Rear_UrnL"),
    A("garden_urn", -700, -2300, 112, s=0.55, mat="MI_V2_Ceramic", label="Rear_UrnR"),
    A("flower_cluster", 700, -2300, 190, s=0.45, mat="MI_V2_PetalWhite", label="Rear_UrnFlowersL"),
    A("flower_cluster", -700, -2300, 190, s=0.45, mat="MI_V2_PetalViolet", label="Rear_UrnFlowersR"),
] + _grove(1, 2300, -8600, 5500, "Rear_FrameL", count=3)
  + _grove(-1, -2500, -8500, 5600, "Rear_FrameR", count=3)
  + _mushroom_cluster(1, 3600, -8900, 5700, "Rear_FrameMush")
  + [
    # THE REAR WORLD USED TO STOP 18 M SHORT OF ITS OWN CAMERA. RearWorldCam10
    # stands at y = -9,400 and the furthest thing behind the spawn was a grove
    # at -7,600: measured from the layout, ZERO placements within 15 m of the
    # camera, so the view opened on 34 m of bare ground before it reached
    # anything. The fix is not to move the camera in -- it is at the distance
    # that reads the gate, the avenue, the arrival gate and the castle as one
    # line of depth, which is the whole point of the view. The fix is that the
    # world should not end before the place a participant stands in it.
    A("hedge_block", side * (1500 + 120 * i), -8300 - 260 * i, 0, yaw=20 * i,
      s=1.0, mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2],
      label="Rear_FarHedge%d_%d" % (side, i))
    for side in (1, -1) for i in range(3)
] + [
    g for side in (1, -1)
    for g in _ground_patch(side * 1900, -8750, 0, 40 * side, 1.1,
                           ("MI_V2_PetalViolet", "MI_V2_PetalWhite")[(side + 1) // 2],
                           "Rear_FarFlowers%d" % side)
] + [
    # RearWorldCam10's NEAR ground. The framing groves sit 17 m out, which
    # closed the 34 m void but left the bottom half of the frame as lawn: a
    # camera needs something at three to eight metres, not only at seventeen.
    # LOW planting only -- the eye is at 3.2 m and this view's whole value is
    # the line of depth through the rear gate to the castle, so nothing here
    # may stand tall enough to interrupt it.
    # PLACED WHERE THE CAMERA CAN SEE IT. The first attempt at this band sat
    # at y = -9,180 and -9,020, which is 2.2 m and 3.8 m in front of
    # RearWorldCam10 -- and the render came back with the same bare foreground
    # as before, because that content was UNDER THE LENS. The camera eye is at
    # 3.2 m with a 58.7 deg vertical field pitched -3, so its lower edge meets
    # the ground at 3.2 / tan(32.4) = 5.0 m. Nothing closer than five metres
    # is in the picture at all. "Near the camera" and "in the near field of
    # the frame" are not the same thing, and only one of them is measurable
    # from the camera's own numbers.
    #
    # Three rows at 6, 9 and 12 m, which is the band the frame actually shows
    # between its bottom edge and the groves at 17 m.
    # MASSED, NOT SPRINKLED. The first version of this band put 27 pieces on
    # an even 9 x 3 grid, and the render came back reading as polka dots: a
    # lawn with isolated shrub balls sitting on it at regular intervals. The
    # planting was visible, which was the point of the previous fix, and it
    # was not a garden. Reference planting comes in MASSES with ground
    # between them -- five or six pieces touching, then a gap, then another
    # group. Same count, five clumps, and the gaps are as deliberate as the
    # groups.
    A(("topiary_ball", "shrub_flowering", "hedge_block", "rose_bush", "shrub_flowering")[k % 5],
      cx + (-140 + 115 * (k % 5)) + 40 * ((k % 3) - 1),
      cy + (-90 + 75 * (k % 3)) + 35 * ((k % 2) * 2 - 1), 0,
      yaw=41 * k + 90 * ci, s=0.70 + 0.16 * ((k % 4) / 3.0),
      mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[k % 2],
      label="Rear_NearClump%d_%d" % (ci, k))
    # POSITIONED INSIDE THE FRUSTUM. At 90 deg horizontal the visible
    # half-width EQUALS the depth, so at 8 m out the frame is only 8 m wide --
    # the first clump positions spread to 30 m off-axis and four of the five
    # stood outside the picture entirely, which camera_framing.py caught as
    # the near-band count going DOWN (10 -> 8) after adding planting. Each
    # clump below satisfies |x - cam_x| < (y - cam_y), with the camera at
    # (0, -9,400): depths 7-17 m, offsets inside the cone at that depth.
    for ci, (cx, cy) in enumerate(((-300, -8700), (900, -8300), (-1600, -7800),
                                   (1500, -7700), (-900, -8250)))
    for k in range(6)
] + [
    g for i in range(8)
    for g in _ground_patch(-3100 + 900 * (i % 8), (-8650, -8350)[i // 8], 0, 50 * i, 0.95,
                           ("MI_V2_PetalPink", "MI_V2_PetalWhite", "MI_V2_Lavender")[i % 3],
                           "Rear_NearGround%d" % i)
])


# ---------------------------------------------------------------------------
# THE OUTER WORLD — Wonderland beyond Golden Arrival
# ---------------------------------------------------------------------------
#
# tools/emptiness.py grids the whole district and ranks what is empty. The
# answer was not subtle and it was not where three passes of work had gone:
#
#   1,691 cells   27,056 m2   x -118..118 m, y -118..138 m
#
# ONE region, wrapping the entire built district. Golden Arrival occupies
# roughly 160 x 180 m and everything outside it is void — which is precisely
# the founder's "Wonderland must stop feeling like a single isolated set", and
# it is two orders of magnitude larger than the lawn patches inside the
# district that had been absorbing the effort. A camera shows what it points
# at; the audit shows where the world is not.
#
# So the kit that built the flanks now builds QUARTERS, on a ring at 95-175 m,
# with roads out to them. Each quarter is composed rather than scattered — it
# has a type, a centre, a landmark and an edge — and the types alternate so
# the ring is not twelve copies of one garden. Authored decisions: where the
# quarters sit, what type each is, which bearings carry roads. Generated: the
# planting and module placement inside each, from the same functions the
# flanks use.


# ---------------------------------------------------------------------------
# THE HIERARCHY
# ---------------------------------------------------------------------------
#
# The first outer world was 32 quarters built by three functions that took a
# centre and nothing else, so every quarter of a kind was the same quarter:
# garden 106 pieces, towers 36, grove 34, footprint 21.6 m, over and over, from
# 50 m out to 164 m. tools/hierarchy.py put a number on it -- **core:far
# density ratio 1.10x**, against boards that read past 2.5 -- and a polar map
# showed the shape of the mistake: a complete RING of thin ground at 50-75 m
# (147-334 per ha in all eight sectors) with a DENSER ring outside it at
# 75-125 m. Density that rises with distance is not a hierarchy, it is a fence.
#
# So position no longer decides only WHERE a quarter is. It decides WHAT it is,
# through one continuous score:
#
#   score = 0.70 * falloff + 0.16 * road activation + 0.14 * a noise field
#
# and every quantity a quarter has -- how many pieces, how far apart, how big,
# how likely a landmark, how tall a silhouette, how much empty ground it may
# hold -- is derived from that score rather than written down. The three terms
# each do a job: the falloff makes the hierarchy, the road term keeps ground
# beside a way denser than open land at the same radius (density follows
# movement, not distance), and the noise breaks the tiers so they read as
# country rather than as three concentric bands.
#
# `HIER` is exported, and `tools/emptiness.py` reads `empty_tol` from it: the
# audit and the generator share one definition of how much emptiness is
# correct at a place, which is the only way the audit can be right about the
# far world without demanding the far world be dense.

_H_R0 = 6500.0          #: uu -- inside this, Golden Arrival's own authored density
_H_R1 = 34000.0         #: uu -- the far edge of the walkable world
_H_E = 0.06720551273974977   #: math.exp(-2.7), the falloff's value at the far edge


def _clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else (hi if v > hi else v)


def _vnoise(x, y, cell, seed):
    """Smooth deterministic 0..1 value noise, so a gradient is not a ring.

    Bilinear between lattice values with a smoothstep weight -- without the
    smoothstep the field creases along the lattice and the creases show up in
    the world as straight edges of density.
    """
    gx, gy = x / cell, y / cell
    i, j = math.floor(gx), math.floor(gy)
    fx, fy = gx - i, gy - j
    sx, sy = fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy)
    a, b = _rnd(i, j, seed), _rnd(i + 1, j, seed)
    c, d = _rnd(i, j + 1, seed), _rnd(i + 1, j + 1, seed)
    return (a * (1.0 - sx) + b * sx) * (1.0 - sy) + (c * (1.0 - sx) + d * sx) * sy


def _road_activation(x, y):
    """1 on a way, falling to 0 in open country.

    A world's density follows its movement, not its radius: the ground beside
    a road is busier than the ground behind a hill at the same distance out.
    This is what stops the falloff reading as concentric.
    """
    r = math.hypot(x, y)
    if r < 900.0:
        return 1.0
    b = math.degrees(math.atan2(y, x)) % 360.0
    best = 1e18
    for rb in _ROAD_BEARINGS:
        d = abs((b - rb + 180.0) % 360.0 - 180.0)
        best = min(best, math.radians(d) * r)          # lateral offset, uu
    # the ring circuit is a way too, and it runs at a radius rather than a bearing
    best = min(best, abs(r - _RING_RADIUS))
    return _clamp(1.0 - (best - 2600.0) / 6400.0)


#: HIER is called about 1.3 million times while the world is placed -- once per
#: candidate position per already-placed quarter, twice per `_want_gap` -- and
#: each call walks 32 road bearings and two noise octaves. Memoising it on the
#: exact coordinate took module import from 25 seconds to under three: the
#: repeated queries are the same POINTS (a placed quarter, asked about again
#: for the next candidate), so exact keys hit and nothing is approximated.
_HIER_CACHE = {}


def HIER(x, y):
    """Everything a place derives from where it is. One dict, all continuous.

    Nothing here is a threshold on a tier: `tier` is a label for the reports
    and is never read by the generator, precisely so the world cannot acquire
    a visible boundary at a number.
    """
    hit = _HIER_CACHE.get((x, y))
    if hit is not None:
        return hit
    r = math.hypot(x, y)
    # NOT LINEAR. A straight falloff over 65 -> 340 m barely moves across the
    # 85-170 m band where most of the quarters actually stand: the first pass
    # measured 385 per ha at 50-100 m against 407 at 100-150, still rising
    # outward. Density in a landscape decays on a LENGTH, so this does too --
    # normalised to reach exactly 0 at the far edge, which a bare exponential
    # would not, leaving a step where the world stops.
    t = _clamp((r - _H_R0) / (_H_R1 - _H_R0))
    fall = (math.exp(-2.7 * t) - _H_E) / (1.0 - _H_E)
    road = _road_activation(x, y)
    field = 0.62 * _vnoise(x, y, 9000.0, 4211) + 0.38 * _vnoise(x, y, 3400.0, 9137)
    s = _clamp(0.70 * fall + 0.16 * road + 0.14 * field)
    out = {
        "score": s,
        "tier": "core" if s >= 0.68 else ("mid" if s >= 0.38 else "far"),
        "fall": fall, "road": road, "field": field,
        #: how many pieces a quarter is made of, against its authored count
        "density": 0.26 + 1.20 * (s ** 1.90),
        #: how far apart they stand -- the core is tight, the distance is loose.
        #:
        #: The core end was 1.00, meaning "as authored", and that was the
        #: assumption worth questioning: a core tower quarter with its towers
        #: at 1,500 uu from its centre is 34 m across, so packing those
        #: densely puts a tower inside a tower and packing them safely empties
        #: the core -- 103 placements per hectare at 100-150 m, against 188
        #: before, chasing the same collision from the other side. "Shortest
        #: spacing between meaningful structures" is the first line of the
        #: brief for this tier, and it is a statement about what is INSIDE a
        #: quarter as much as between them. 0.70 in the core.
        "spacing": 2.25 - 1.55 * s,
        #: a distant piece is bigger, or it is not there at all
        "scale": 0.90 + 0.62 * ((1.0 - s) ** 1.35),
        #: SECONDARY landmarks are a core luxury; the distance gets one, large
        "landmark_p": 0.16 + 0.84 * s,
        "landmark_scale": 1.00 + 1.15 * ((1.0 - s) ** 1.4),
        "veg": 0.36 + 1.00 * (s ** 1.25),
        #: props are the first thing distance takes and the last thing it returns
        "prop": 0.04 + 1.36 * (s ** 2.1),
        #: walls, courts and paved yards -- architecture ABOUT architecture
        "court_p": s ** 1.15,
        #: how much of the silhouette this place contributes at the horizon
        "skyline": 0.55 + 1.10 * (1.0 - s),
        #: uu. How far from a placement the ground may be before it reads as a
        #: hole. 9 m in the core, 55 m at the horizon -- read by emptiness.py,
        #: so "empty" means empty BY THE STANDARD OF ITS OWN TIER.
        "empty_tol": 900.0 + 4600.0 * (1.0 - s),
    }
    if len(_HIER_CACHE) < 400000:
        _HIER_CACHE[(x, y)] = out
    return out


def _n(base, mult, lo=1, hi=None):
    """A count from a multiplier, floored so a tier can thin but not delete."""
    v = int(round(base * mult))
    v = max(lo, v)
    return v if hi is None else min(hi, v)


def _quarter_garden(cx, cy, sgn, seed, tag, H=None):
    """A formal garden quarter: parterre, grove, landmark, hedged edge.

    With a hierarchy the same three parts survive at every distance and stop
    being the same SIZE: the parterre thins from the inside out (blooms first,
    then ornament, then its rim), the grove grows and spreads, and the
    mushroom family becomes one large landmark once secondary ones stop
    earning their draw calls.
    """
    H = H or HIER(cx, cy)
    sp = H["spacing"]
    out = _parterre(sgn, cx, cy, seed, tag + "_P", H=H)
    out += _grove(sgn, cx + sgn * 1800 * sp, cy + 1500 * sp, seed + 11, tag + "_G",
                  count=_n(5, H["veg"], 3), H=H)
    # INSIDE ITS OWN QUARTER. At 1600/1400 the landmark stood 2,120 uu from
    # the centre against a garden's 2,200 uu reach -- on its own perimeter,
    # which is exactly where the neighbour's wall is. Three of them were found
    # inside other people's geometry. A landmark belongs in the room it names.
    out += _mushroom_cluster(sgn, cx - sgn * 850 * sp, cy - 740 * sp, seed + 21,
                             tag + "_M", H=H)
    return out


def _quarter_towers(cx, cy, sgn, seed, tag, H=None):
    """A neighbourhood: a cluster of towers with courts and walls between.

    HIERARCHY. Five towers, one wall ring and one paved court was this
    quarter at 85 m and at 164 m alike. Now the count, the spread, the height
    and whether it has a wall at all come from the score: a core neighbourhood
    is seven towers close-packed inside a walled court with planting and
    ground colour; a distant one is two or three tall silhouettes on open
    ground, which is what a town reads as from three hundred metres.
    """
    H = H or HIER(cx, cy)
    out = []
    sp, sk = H["spacing"], H["skyline"]
    plan = ((0, 0, 1.35, "MI_V2_RoofPink"), (1500, 900, 1.0, "MI_V2_RoofLilac"),
            (-1300, 1100, 1.15, "MI_V2_RoofBlue"), (700, -1500, 0.85, "MI_V2_RoofRose"),
            (-1600, -900, 1.05, "MI_V2_RoofNavy"), (2100, -2000, 1.22, "MI_V2_RoofPink"),
            (-2400, 2100, 0.95, "MI_V2_RoofRose"))
    n_tower = _n(5, H["density"], 2, len(plan))
    for i, (dx, dy, h0, roof) in enumerate(plan[:n_tower]):
        x, y = cx + sgn * dx * sp, cy + dy * sp
        # the DOMINANT tower keeps the full skyline multiplier; its attendants
        # take less of it, so a distant cluster is one silhouette with company
        # rather than three of the same height standing in a row
        h = h0 * (sk if i == 0 else 0.55 + 0.45 * sk) * H["scale"] / 1.28
        out += [
            A("tower_capped", x, y, 0, yaw=_rnd(i, seed, 1) * 360.0, s=h,
              mat="MI_V2_IvoryStone", label="%s_Tower%d" % (tag, i)),
            A("roof_cone_steep", x, y, 1100.0 * h, s=h, mat=roof,
              label="%s_TowerCap%d" % (tag, i)),
            A("finial_spire", x, y, 1560.0 * h, s=0.7 * h, mat="MI_V2_Gold",
              label="%s_TowerSpire%d" % (tag, i)),
        ]
        # a balcony is a detail read at fifty metres and a wasted draw at three
        # hundred: it is on the landmark budget, not the massing budget
        if _rnd(i, seed, 41) < H["landmark_p"]:
            out.append(A("balcony_ring", x, y, 585.0 * h, s=0.65 * h,
                         mat="MI_V2_IvoryStone", label="%s_TowerBalcony%d" % (tag, i)))
    # a court between them, with its own planting
    n_court = _n(6, H["density"], 0)
    for i in range(n_court):
        a = 6.283 * i / max(1, n_court) + 0.4
        out.append(A(("topiary_cone_plain", "shrub_flowering", "topiary_ball")[i % 3],
                     cx + math.cos(a) * 950.0 * sp, cy + math.sin(a) * 950.0 * sp, 0,
                     yaw=40 * i, s=0.85 * H["scale"],
                     mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2],
                     label="%s_Court%d" % (tag, i)))
    for i in range(_n(3, H["prop"], 0)):
        out += _ground_patch(cx + 500 - 500 * i, cy - 700, 0, 60 * i, 1.0,
                             ("MI_V2_PetalPink", "MI_V2_Lavender", "MI_V2_PetalWhite")[i % 3],
                             "%s_CourtGround%d" % (tag, i))
    # A NEIGHBOURHOOD, NOT FIVE TOWERS ON GRASS. The world render showed these
    # as isolated architectural fragments standing on lawn -- the brief's
    # "architectural fragments" was meant as a kind of place, not as debris.
    # A neighbourhood has ground under it, a wall around it and a way in.
    out.append(A("garden_lawn", cx, cy, -2, sxyz=(0.62 * sp, 0.52 * sp, 1.0),
                 mat="MI_V2_Lawn", label="%s_Ground" % tag))
    # THE WALL IS THE FIRST THING DISTANCE TAKES. A perimeter wall is a line
    # of 14 pieces that subtends about a pixel at 300 m; a tower is a
    # silhouette. Walls, pilasters and the paved court belong to `court_p`.
    if H["court_p"] > 0.34:
        n_wall = _n(14, 0.5 + 0.5 * H["court_p"], 6)
        for i in range(n_wall):
            a = 6.283 * i / n_wall
            # a broken perimeter wall: two gaps, where the roads arrive
            if 0.42 < (i / float(n_wall)) < 0.58 or (i / float(n_wall)) > 0.92 or (i / float(n_wall)) < 0.08:
                continue
            rr = 2150.0 * sp
            out.append(A("garden_wall", cx + math.cos(a) * rr, cy + math.sin(a) * rr, 0,
                         yaw=math.degrees(a) + 90.0, sxyz=(1.0 * sp, 1.0, 0.85),
                         mat="MI_V2_IvoryStone", label="%s_Wall%d" % (tag, i)))
            if i % 4 == 0 and H["prop"] > 0.30:
                out.append(A("gate_pier", cx + math.cos(a) * rr, cy + math.sin(a) * rr, 0,
                             s=0.6, mat="MI_V2_IvoryStone", label="%s_WallPier%d" % (tag, i)))
        # a paved court at its heart, so the towers stand on something built
        for k, yaw in enumerate((0.0, 90.0)):
            out.append(A("terrace_platform", cx, cy, -18.0, yaw=yaw,
                         sxyz=(1.45 * sp, 0.42 * sp, 0.35), mat="MI_V2_PlazaWarm",
                         label="%s_Court%d" % (tag, k)))
    return out


def _quarter_grove(cx, cy, sgn, seed, tag, H=None):
    """A mushroom wood: the organic, exploratory end of the language."""
    # ONE landmark, not four clusters. The first world render showed eight of
    # these quarters and the frame read as a mushroom farm: four clusters each
    # (a landmark plus three caps) times eight quarters is ninety-six giant
    # mushrooms, which is not a signature, it is wallpaper. The brief is
    # explicit -- landmarks need hierarchy, and "do not turn every 5 meters
    # into another gimmick". A mushroom wood is trees with ONE mushroom
    # landmark standing in it and a few small ones at its feet.
    H = H or HIER(cx, cy)
    sp = H["spacing"]
    out = _grove(sgn, cx, cy, seed, tag + "_G", count=_n(9, H["veg"], 4), H=H)
    # THE GIANT. A grove in the Mushroom Grove district, or any grove far
    # enough out to need a silhouette rather than a detail, stands under a
    # real 20 m cap; nearer ones keep the garden-scale family so the giants
    # stay rare enough to be landmarks.
    gx, gy = cx + sgn * 700.0 * sp, cy + 500.0 * sp
    if H["landmark_scale"] > 1.22 or _district_of(cx, cy)[0] == "Mushroom Grove":
        out += _giant_mushroom(gx, gy, seed + 30, "%s_Giant" % tag,
                               s=(0.85 + 0.35 * _rnd(seed, 8, 1)) * H["landmark_scale"] * 0.9,
                               tint=("MI_V2_MushRed", "MI_V2_MushTerracotta",
                                     "MI_V2_MushPurple")[seed % 3])
    out += _mushroom_cluster(sgn, cx - sgn * 900.0 * sp, cy - 800.0 * sp, seed + 30,
                             "%s_M" % tag, H=H)
    for i in range(_n(6, H["density"], 2)):
        a = 6.283 * i / 6.0 + _rnd(i, seed, 7) * 0.9
        r = (1300.0 + 500.0 * _rnd(i, seed, 8)) * sp
        out.append(A(("mushroom_small", "mushroom_medium")[i % 2],
                     cx + math.cos(a) * r, cy + math.sin(a) * r, 0,
                     yaw=_rnd(i, seed, 9) * 360.0,
                     s=(0.8 + 0.4 * _rnd(i, seed, 10)) * H["scale"],
                     mat=("MI_V2_MushRed", "MI_V2_MushCream", "MI_V2_MushPurple")[i % 3],
                     label="%s_SmallCap%d" % (tag, i)))
    # A WINDING PATH, which is the founder's own word for what a mushroom
    # wood needs -- "dense but navigable understory". A straight road through
    # a wood is a firebreak; a path that bends is a wood you walk in.
    turn = _rnd(seed, 12, 1) * 6.283
    prev = None
    for i in range(7):
        t = i / 6.0
        a = turn + 1.9 * math.sin(t * 3.4) + t * 1.1
        r = 260.0 + 2100.0 * t
        px, py = cx + math.cos(a) * r * sp, cy + math.sin(a) * r * sp
        if prev is not None:
            d = math.hypot(px - prev[0], py - prev[1]) or 1.0
            out.append(A("terrace_platform", (px + prev[0]) * 0.5, (py + prev[1]) * 0.5,
                         -18.0, yaw=math.degrees(math.atan2(py - prev[1], px - prev[0])),
                         sxyz=(d / 1440.0, 0.15, 0.35), mat="MI_V2_PlazaCream",
                         label="%s_Path%d" % (tag, i)))
        prev = (px, py)
        # understory at the path's edge, which is where a walker sees it
        out.append(A(("shrub_flowering", "rose_bush", "topiary_ball")[i % 3],
                     px + 260.0 * math.cos(a + 1.57), py + 260.0 * math.sin(a + 1.57), 0,
                     yaw=_rnd(i, seed, 13) * 360.0,
                     s=(0.8 + 0.4 * _rnd(i, seed, 14)) * H["scale"],
                     mat=("MI_V2_LeafMid", "MI_V2_LeafDark")[i % 2],
                     label="%s_Under%d" % (tag, i)))
        if i % 2 == 0:
            out += _ground_patch(px + 300.0 * math.cos(a - 1.57),
                                 py + 300.0 * math.sin(a - 1.57), 0,
                                 _rnd(i, seed, 15) * 360.0, 1.0,
                                 ("MI_V2_PetalViolet", "MI_V2_PetalWhite")[i % 2],
                                 "%s_PathBed%d" % (tag, i))
    return out


def _quarter_wood(cx, cy, sgn, seed, tag, H=None):
    """LANDSCAPE, at the scale distance actually reads.

    The atmospheric band is not a thinner town. Beyond ~190 m a wall is a
    pixel, a parterre is a smudge and a court is nothing -- what carries is
    MASS: a body of canopy with a shape, a ridge that gives it a top edge, and
    one silhouette standing clear of it. So the far tier has its own kind
    rather than a starved copy of a near one, which is also why the hierarchy
    does not read as three rings of the same thing at three sizes.
    """
    H = H or HIER(cx, cy)
    sc = H["scale"]
    # A MASS IS TIGHT EVEN WHEN THE WORLD IS LOOSE. `spacing` is the distance
    # BETWEEN quarters and applying it inside a wood scattered eleven trees
    # over 116 m -- measured, and it read as trees on a lawn rather than as
    # woodland. A far wood is bigger and there are fewer of them; the trees
    # inside it stand as close together as they do anywhere. So the body takes
    # a damped spread and the count follows its AREA, which holds the internal
    # density roughly constant while the mass itself grows.
    sp = 0.80 + 0.40 * H["spacing"]
    out = []
    # 20, NOT 11. The plan view is the check no camera can make, and at 11 the
    # far woods drew as a dozen dots inside a 58 m ring -- one tree per 278 m2,
    # which is an orchard with most of it missing, not woodland. A mass has to
    # read as mass or the atmospheric tier is just sparse. The count follows
    # sp^2 so the internal density holds as the body grows, and every piece of
    # it is instanced (trunks and canopies are both in build_v2.BATCHABLE), so
    # the far tier's silhouette costs draw calls in the single digits.
    n_tree = _n(20 * sp * sp, 0.62 + 0.75 * H["veg"], 8)
    ax = 1.0 + 0.9 * _rnd(seed, 3, 1)                   # the wood is not round
    lean = _rnd(seed, 3, 2) * 6.283
    for i in range(n_tree):
        a = 6.283 * _rnd(i, seed, 21)
        rad = (900.0 + 2100.0 * math.sqrt(_rnd(i, seed, 22))) * sp
        ux, uy = math.cos(a) * rad * ax, math.sin(a) * rad
        x = cx + ux * math.cos(lean) - uy * math.sin(lean)
        y = cy + ux * math.sin(lean) + uy * math.cos(lean)
        t = 1.05 + 0.55 * _rnd(i, seed, 23)
        if _rnd(i, seed, 24) > 0.42:
            out.append(A("tree_mature_trunk", x, y, 0, yaw=_rnd(i, seed, 25) * 360.0,
                         s=t * sc, mat="MI_V2_Bark", label="%s_Trunk%d" % (tag, i)))
            out.append(A("canopy_large", x, y, 1320 * t * sc, yaw=_rnd(i, seed, 26) * 360.0,
                         s=t * sc * 1.25,
                         mat=("MI_V2_LeafMid", "MI_V2_LeafDark", "MI_V2_LeafLight")[i % 3],
                         label="%s_Canopy%d" % (tag, i)))
        else:
            out.append(A("tree_slender_trunk", x, y, 0, yaw=_rnd(i, seed, 27) * 360.0,
                         s=t * sc, mat="MI_V2_Bark", label="%s_Slim%d" % (tag, i)))
            out.append(A("canopy_medium", x, y, 800 * t * sc, yaw=_rnd(i, seed, 28) * 360.0,
                         s=t * sc * 1.3,
                         mat=("MI_V2_LeafLight", "MI_V2_LeafMid")[i % 2],
                         label="%s_SlimCanopy%d" % (tag, i)))
    # the ridge: a mass along the wood's long axis that gives it a top edge
    for i in range(_n(6, 0.6 + 0.7 * H["veg"], 3)):
        t = -0.5 + i / float(max(1, _n(6, 0.6 + 0.7 * H["veg"], 3) - 1))
        rx, ry = t * 4200.0 * sp * ax, (_rnd(i, seed, 29) - 0.5) * 1400.0
        x = cx + rx * math.cos(lean) - ry * math.sin(lean)
        y = cy + rx * math.sin(lean) + ry * math.cos(lean)
        out.append(A("hedge_mass", x, y, 0, yaw=math.degrees(lean),
                     s=(1.7 + 0.9 * _rnd(i, seed, 30)) * sc,
                     mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2],
                     label="%s_Ridge%d" % (tag, i)))
    # ONE thing standing clear of the mass. Which one is the wood's identity,
    # and it is chosen by the field rather than alternated, so neighbouring
    # woods are not reliably different in the way a pattern is.
    lx, ly = cx + sgn * 1500.0 * sp, cy - 1200.0 * sp
    ls = H["landmark_scale"]
    pick = _vnoise(cx, cy, 7000.0, 5501)
    if pick < 0.40:
        out.append(A("stone_ring_base", lx, ly, -2, s=1.6 * ls, mat="MI_V2_Stone",
                     label="%s_Ring" % tag))
        out += _giant_mushroom(lx, ly, seed + 41, "%s_Giant" % tag,
                               s=(0.9 + 0.4 * _rnd(seed, 8, 2)) * ls * 0.9,
                               tint=("MI_V2_MushRed", "MI_V2_MushPurple",
                                     "MI_V2_MushTerracotta")[seed % 3])
    elif pick < 0.74:
        h = 1.30 * ls * H["skyline"] / 1.28
        out += [
            A("tower_capped", lx, ly, 0, yaw=_rnd(seed, 1, 3) * 360.0, s=h,
              mat="MI_V2_IvoryStone", label="%s_Tower" % tag),
            A("roof_cone_steep", lx, ly, 1100.0 * h, s=h,
              mat=("MI_V2_RoofNavy", "MI_V2_RoofLilac", "MI_V2_RoofBlue")[seed % 3],
              label="%s_TowerCap" % tag),
            A("finial_spire", lx, ly, 1560.0 * h, s=0.7 * h, mat="MI_V2_Gold",
              label="%s_TowerSpire" % tag),
        ]
    else:
        for k in range(3):
            a = 6.283 * k / 3.0 + _rnd(seed, k, 4)
            t = 1.5 + 0.8 * _rnd(seed, k, 5)
            out.append(A("tree_mature_trunk", lx + math.cos(a) * 620.0 * ls,
                         ly + math.sin(a) * 620.0 * ls, 0, yaw=_rnd(seed, k, 6) * 360.0,
                         s=t * ls * 0.8, mat="MI_V2_Bark", label="%s_Great%d" % (tag, k)))
            out.append(A("canopy_large", lx + math.cos(a) * 620.0 * ls,
                         ly + math.sin(a) * 620.0 * ls, 1320 * t * ls * 0.8,
                         yaw=_rnd(seed, k, 7) * 360.0, s=t * ls * 1.1,
                         mat=("MI_V2_LeafDark", "MI_V2_LeafMid", "MI_V2_LeafLight")[k % 3],
                         label="%s_GreatCanopy%d" % (tag, k)))
    # terrain composition: the ground under a far mass is its own tone, so the
    # moss slab is not the only thing between here and the horizon
    for k in range(2):
        out.append(A("garden_lawn", cx + (k - 0.5) * 3600.0 * sp,
                     cy + (0.5 - k) * 2600.0 * sp, -2,
                     yaw=(seed * 13 + 40 * k) % 90,
                     sxyz=(1.25 * sp, 1.05 * sp, 1.0),
                     mat=("MI_V2_Meadow", "MI_V2_Moss")[k % 2],
                     label="%s_Ground%d" % (tag, k)))
    return out


# ---------------------------------------------------------------------------
# THE DISTRICTS THE BOARDS NAME
# ---------------------------------------------------------------------------
#
# PASS 23. The hierarchy decided WHERE and HOW MUCH and it was right about
# both, and the world still read as three recipes at forty-four sizes. The
# reference boards do not describe three recipes: their world-layout overview
# labels ROYAL CASTLE, CLOCK TOWER DISTRICT, GOLDEN GATES, ROYAL GARDENS,
# MUSHROOM GROVE, ARRIVAL PLAZA, WATER FEATURES and OUTER DISTRICTS, and their
# object language is clocks, keys, teapots, fountains, gold arches, columns
# and topiary sculpture -- of which this kit already HAS every piece and the
# world was using almost none. `tower_clock`, `fountain_basin`, `tea_plinth`,
# `column_ornate`, `arch_stone`, `key_ornate`, `topiary_spiral`, `floral_arch`
# and `stairs_broad` between them appeared 11 times in 4,590 placements.
#
# So a quarter is no longer a density, it is a PLACE with an identity, a
# landmark, an edge and a reason to walk to it. Seven kinds, each built from
# the same kit and each unmistakable at a glance.

def _quarter_clockyard(cx, cy, sgn, seed, tag, H=None):
    """THE CLOCK QUARTER -- a clock tower over a geometric yard.

    The boards give clocks a district of their own and make them a signature
    object at three scales: the tower, the ornate face, the little clock in a
    garden. `tower_clock` is 11.8 m of drum, cornice and window frames with
    its clock and roof left to the layout, and it had never been placed.
    """
    H = H or HIER(cx, cy)
    sp, sc, sk = H["spacing"], H["scale"], H["skyline"]
    out = []
    h = (1.05 + 0.35 * _rnd(seed, 1, 1)) * sc * (0.72 + 0.28 * sk)
    out += [
        A("tower_clock", cx, cy, 0, yaw=_rnd(seed, 1, 2) * 90.0, s=h,
          mat="MI_V2_IvoryStone", label="%s_Tower" % tag),
        A("roof_bell", cx, cy, 1190.0 * h, s=h * 1.05,
          mat=("MI_V2_RoofBlue", "MI_V2_RoofLilac", "MI_V2_RoofPink")[seed % 3],
          label="%s_TowerRoof" % tag),
        A("finial_spire", cx, cy, (1190.0 + 620.0) * h, s=0.8 * h, mat="MI_V2_Gold",
          label="%s_TowerSpire" % tag),
    ]
    # THE FACES. The drum's upper storey is at 760-1180 uu; a clock reads from
    # every approach, so it goes on all four when the quarter is near enough
    # to be read at all and on the two that face the road when it is not.
    faces = 4 if H["landmark_p"] > 0.55 else 2
    for k in range(faces):
        a = math.radians(90.0 * k + 45.0)
        out.append(A("clock_ornate", cx + math.cos(a) * 118.0 * h,
                     cy + math.sin(a) * 118.0 * h, 960.0 * h,
                     yaw=math.degrees(a) - 90.0, s=1.15 * h, mat="MI_V2_Gold",
                     label="%s_Face%d" % (tag, k)))
    # the yard: clipped cones on a circle, the geometric planting the boards
    # put under every ornamental clock
    n = _n(8, H["density"], 4)
    for i in range(n):
        a = 6.283 * i / n
        r = 820.0 * sp
        out.append(A(("topiary_cone_plain", "topiary_spiral")[i % 2],
                     cx + math.cos(a) * r, cy + math.sin(a) * r, 0,
                     yaw=30 * i, s=(0.85 + 0.2 * _rnd(i, seed, 3)) * sc,
                     mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2],
                     label="%s_Cone%d" % (tag, i)))
    # KEYS ON PLINTHS. The boards' object language, and `key_ornate` existed
    # in this world only as two props floating over the plaza.
    for i in range(_n(4, H["prop"], 0)):
        a = 6.283 * i / 4.0 + 0.78
        r = 1450.0 * sp
        px, py = cx + math.cos(a) * r, cy + math.sin(a) * r
        out += [
            A("pedestal_finial", px, py, 0, s=0.85 * sc, mat="MI_V2_IvoryStone",
              label="%s_Plinth%d" % (tag, i)),
            A("key_ornate", px, py, 128.0 * sc, yaw=40 * i, s=0.9 * sc, mat="MI_V2_Gold",
              label="%s_Key%d" % (tag, i)),
        ]
    out.append(A("garden_lawn", cx, cy, -2, sxyz=(0.55 * sp, 0.48 * sp, 1.0),
                 mat="MI_V2_Lawn", label="%s_Ground" % tag))
    for k, yaw in enumerate((0.0, 90.0)):
        out.append(A("terrace_platform", cx, cy, -18.0, yaw=yaw,
                     sxyz=(1.15 * sp, 0.34 * sp, 0.35), mat="MI_V2_PlazaCream",
                     label="%s_Yard%d" % (tag, k)))
    if H["court_p"] > 0.40:
        for i in range(10):
            if i in (2, 7):                       # the two ways in
                continue
            a = 6.283 * i / 10.0
            r = 1900.0 * sp
            out.append(A("garden_wall", cx + math.cos(a) * r, cy + math.sin(a) * r, 0,
                         yaw=math.degrees(a) + 90.0, sxyz=(0.9 * sp, 1.0, 0.7),
                         mat="MI_V2_IvoryStone", label="%s_Wall%d" % (tag, i)))
        for i in (2, 7):
            a = 6.283 * i / 10.0
            r = 1900.0 * sp
            out.append(A("arch_stone", cx + math.cos(a) * r, cy + math.sin(a) * r, 0,
                         yaw=math.degrees(a) + 90.0, s=0.8 * sc,
                         mat="MI_V2_IvoryStone", label="%s_Gate%d" % (tag, i)))
    for i in range(_n(5, H["veg"], 2)):
        a = 6.283 * i / 5.0 + 0.7
        out += _ground_patch(cx + math.cos(a) * 1150.0 * sp,
                             cy + math.sin(a) * 1150.0 * sp, 0, 55 * i, 1.0,
                             ("MI_V2_PetalViolet", "MI_V2_PetalWhite", "MI_V2_PetalPink",
                              "MI_V2_Lavender")[i % 4],
                             "%s_Bed%d" % (tag, i))
    # THE HOUR RING. A clock quarter's ground should say what it is: twelve
    # kerbs on a circle, the four quarter-hours marked by a plinth, which is
    # the geometric planting the boards put under every ornamental clock and
    # costs sixteen instanced pieces.
    if H["court_p"] > 0.30:
        for i in range(12):
            a = 6.283 * i / 12.0
            r = 560.0 * sp
            out.append(A("kerb_stone", cx + math.cos(a) * r, cy + math.sin(a) * r, 0,
                         yaw=math.degrees(a) + 90.0, sxyz=(1.6, 1.0, 0.55),
                         mat="MI_V2_Kerb", label="%s_Hour%d" % (tag, i)))
            if i % 3 == 0:
                out += [
                    A("pedestal_finial", cx + math.cos(a) * r * 1.24,
                      cy + math.sin(a) * r * 1.24, 0, s=0.5 * sc,
                      mat="MI_V2_IvoryStone", label="%s_Quarter%d" % (tag, i)),
                    A("gate_finial_ball", cx + math.cos(a) * r * 1.24,
                      cy + math.sin(a) * r * 1.24, 70.0 * sc, s=0.3 * sc,
                      mat="MI_V2_Gold", label="%s_QuarterCap%d" % (tag, i)),
                ]
    # A COLONNADE on one side of the yard: the boards' "columns & ornaments",
    # and what turns a tower on grass into a tower in a courtyard.
    if H["court_p"] > 0.45:
        cyaw = math.radians((seed * 53) % 360)
        for i in range(_n(5, H["density"], 3)):
            t = -0.5 + (i + 0.5) / _n(5, H["density"], 3)
            px = cx + math.cos(cyaw) * 1560.0 * sp - math.sin(cyaw) * t * 2400.0 * sp
            py = cy + math.sin(cyaw) * 1560.0 * sp + math.cos(cyaw) * t * 2400.0 * sp
            out += [
                A("column_ornate", px, py, 0, s=0.78 * sc, mat="MI_V2_IvoryStone",
                  label="%s_Column%d" % (tag, i)),
                A("gate_finial_ball", px, py, 780.0 * 0.78 * sc, s=0.4 * sc,
                  mat="MI_V2_Gold", label="%s_ColumnCap%d" % (tag, i)),
            ]
    return out


def _quarter_water(cx, cy, sgn, seed, tag, H=None):
    """THE WATER GARDEN -- a fountain court with radial walks.

    "WATER FEATURES" is a labelled region on the boards' layout overview and a
    whole panel on two of them, and this world contained exactly ONE fountain:
    the one W1 built on the castle approach, because the kit had no water at
    all until that pass invented it. A water garden is the fountain, the ring
    it stands in, the walks that run to it and the balustrade that stops them.
    """
    H = H or HIER(cx, cy)
    sp, sc = H["spacing"], H["scale"]
    fs = (1.0 + 0.5 * (H["landmark_scale"] - 1.0)) * sc
    out = [
        A("stone_ring_base", cx, cy, -4, s=1.9 * fs, mat="MI_V2_Stone", label="%s_Ring" % tag),
        A("fountain_basin", cx, cy, 0, yaw=_rnd(seed, 2, 1) * 45.0, s=fs,
          mat="MI_V2_IvoryStone", label="%s_Basin" % tag),
        A("fountain_water", cx, cy, 0, yaw=_rnd(seed, 2, 1) * 45.0, s=fs,
          mat="MI_V2_Water", label="%s_Water" % tag),
        A("fountain_finial", cx, cy, 262.0 * fs, s=fs, mat="MI_V2_Gold",
          label="%s_Finial" % tag),
    ]
    # four walks out of it, and a balustrade between them
    for k in range(4):
        yaw = 90.0 * k + 45.0 * (seed % 2)
        a = math.radians(yaw)
        out.append(A("terrace_platform", cx + math.cos(a) * 1250.0 * sp,
                     cy + math.sin(a) * 1250.0 * sp, -18.0, yaw=yaw,
                     sxyz=(1.15 * sp, 0.30 * sp, 0.35), mat="MI_V2_PlazaCream",
                     label="%s_Walk%d" % (tag, k)))
    n_bal = _n(8, H["density"], 4)
    for i in range(n_bal):
        a = 6.283 * i / n_bal + 0.39
        r = 900.0 * sp
        out.append(A("balustrade", cx + math.cos(a) * r, cy + math.sin(a) * r, 0,
                     yaw=math.degrees(a) + 90.0, s=1.0 * sc, mat="MI_V2_IvoryStone",
                     label="%s_Rail%d" % (tag, i)))
    # columns standing off the water, urns on the axis
    for i in range(_n(4, H["prop"], 0)):
        a = 6.283 * i / 4.0
        r = 1700.0 * sp
        px, py = cx + math.cos(a) * r, cy + math.sin(a) * r
        out += [
            A("column_ornate", px, py, 0, s=0.9 * sc, mat="MI_V2_IvoryStone",
              label="%s_Column%d" % (tag, i)),
            A("garden_urn", px, py, 860.0 * 0.9 * sc, s=0.55 * sc, mat="MI_V2_Ceramic",
              label="%s_ColumnUrn%d" % (tag, i)),
        ]
    for i in range(_n(6, H["veg"], 2)):
        a = 6.283 * i / 6.0 + 0.52
        r = 1350.0 * sp
        out += _ground_patch(cx + math.cos(a) * r, cy + math.sin(a) * r, 0,
                             _rnd(i, seed, 4) * 360.0, 1.0,
                             ("MI_V2_PetalPink", "MI_V2_Lavender", "MI_V2_PetalWhite")[i % 3],
                             "%s_Bed%d" % (tag, i))
        out.append(A("topiary_ball", cx + math.cos(a + 0.4) * r * 1.18,
                     cy + math.sin(a + 0.4) * r * 1.18, 0, s=0.7 * sc,
                     mat="MI_V2_LeafDark", label="%s_Ball%d" % (tag, i)))
    # A RILL AND A SECOND BASIN. One fountain in a lawn is an object; a
    # fountain, a channel running away from it and a lower basin at the end
    # is a WATER GARDEN, which is what the boards' panel shows and what the
    # district is named for. The rill is paving with water paving over it.
    ra = math.radians(35.0 + (seed % 4) * 90.0)
    for i in range(5):
        d = 1900.0 + 520.0 * i
        out += [
            A("terrace_platform", cx + math.cos(ra) * d, cy + math.sin(ra) * d, -18.0,
              yaw=math.degrees(ra), sxyz=(0.40 * sp, 0.14 * sp, 0.35),
              mat="MI_V2_PlazaCream", label="%s_Rill%d" % (tag, i)),
            A("terrace_platform", cx + math.cos(ra) * d, cy + math.sin(ra) * d, -6.0,
              yaw=math.degrees(ra), sxyz=(0.30 * sp, 0.07 * sp, 0.30),
              mat="MI_V2_Water", label="%s_RillWater%d" % (tag, i)),
        ]
    lx = cx + math.cos(ra) * 4600.0
    ly = cy + math.sin(ra) * 4600.0
    out += [
        A("stone_ring_base", lx, ly, -4, s=1.2 * fs, mat="MI_V2_Stone",
          label="%s_LowerRing" % tag),
        A("fountain_basin", lx, ly, 0, s=0.62 * fs, mat="MI_V2_IvoryStone",
          label="%s_LowerBasin" % tag),
        A("fountain_water", lx, ly, 0, s=0.62 * fs, mat="MI_V2_Water",
          label="%s_LowerWater" % tag),
    ]
    for i in range(_n(4, H["prop"], 1)):
        a = ra + 1.57 * (1 if i % 2 else -1)
        d = 2400.0 + 900.0 * (i // 2)
        out += [
            A("pedestal_finial", cx + math.cos(a) * d, cy + math.sin(a) * d, 0,
              s=0.7 * sc, mat="MI_V2_IvoryStone", label="%s_Post%d" % (tag, i)),
            A("garden_urn", cx + math.cos(a) * d, cy + math.sin(a) * d, 100.0 * sc,
              s=0.5 * sc, mat="MI_V2_Ceramic", label="%s_PostUrn%d" % (tag, i)),
        ]
    out.append(A("garden_lawn", cx, cy, -2, sxyz=(0.62 * sp, 0.55 * sp, 1.0),
                 mat="MI_V2_Lawn", label="%s_Ground" % tag))
    return out


def _quarter_tea(cx, cy, sgn, seed, tag, H=None):
    """THE TEA TERRACE -- Wonderland's own furniture, at garden scale.

    Teapots, cups and saucers are a whole panel on every board and this kit
    has five recipes for them; the world had three, floating over the plaza.
    A tea terrace is a raised floor, a table service at the size of garden
    ornament, spiral topiary at its corners and a vine arch to come in by.
    """
    H = H or HIER(cx, cy)
    sp, sc = H["spacing"], H["scale"]
    ts = (1.6 + 0.5 * (H["landmark_scale"] - 1.0)) * sc
    out = [
        A("terrace_platform", cx, cy, -14.0, yaw=_rnd(seed, 3, 1) * 90.0,
          sxyz=(0.95 * sp, 0.95 * sp, 0.55), mat="MI_V2_PlazaWarm",
          label="%s_Floor" % tag),
        A("tea_plinth", cx, cy, 0, s=ts, mat="MI_V2_IvoryStone", label="%s_Plinth" % tag),
        A("tea_pot", cx, cy, 108.0 * ts, yaw=_rnd(seed, 3, 2) * 360.0, s=ts,
          mat="MI_V2_Ceramic", label="%s_Pot" % tag),
    ]
    for i in range(_n(4, H["prop"], 2)):
        a = 6.283 * i / 4.0 + 0.6
        r = 620.0 * sp
        px, py = cx + math.cos(a) * r, cy + math.sin(a) * r
        out += [
            A("tea_saucer", px, py, 0, yaw=30 * i, s=ts * 0.85, mat="MI_V2_Ceramic",
              label="%s_Saucer%d" % (tag, i)),
            A(("tea_cup", "tea_cup_small")[i % 2], px, py, 22.0 * ts, yaw=30 * i + 20,
              s=ts * 0.85, mat="MI_V2_Ceramic", label="%s_Cup%d" % (tag, i)),
        ]
    if H["landmark_p"] > 0.40:
        out.append(A("tea_heart", cx + sgn * 900.0 * sp, cy - 760.0 * sp, 60.0 * ts,
                     yaw=20, s=ts * 0.9, mat="MI_V2_RosePink", label="%s_Heart" % tag))
    for i in range(4):
        a = 6.283 * i / 4.0 + 0.78
        r = 1180.0 * sp
        out.append(A("topiary_spiral", cx + math.cos(a) * r, cy + math.sin(a) * r, 0,
                     yaw=40 * i, s=(0.95 + 0.2 * _rnd(i, seed, 5)) * sc,
                     mat="MI_V2_LeafDark", label="%s_Spiral%d" % (tag, i)))
    out.append(A("floral_arch", cx, cy - 1500.0 * sp, 0, yaw=0, s=1.0 * sc,
                 mat="MI_V2_LeafMid", label="%s_Arch" % tag))
    # A RAIL ROUND THE TERRACE, and lanterns on it. A raised floor with
    # nothing at its edge reads as a slab; the boards' terraces all have a
    # balustrade, and it is the piece that says "this is a room outdoors".
    n_rail = _n(10, 0.6 + 0.7 * H["density"], 6)
    for i in range(n_rail):
        a = 6.283 * i / n_rail + 0.31
        if 0.42 < (i / float(n_rail)) < 0.58:
            continue                          # the way in, under the arch
        r = 1030.0 * sp
        out.append(A("balustrade", cx + math.cos(a) * r, cy + math.sin(a) * r, 0,
                     yaw=math.degrees(a) + 90.0, s=0.95 * sc,
                     mat="MI_V2_IvoryStone", label="%s_Rail%d" % (tag, i)))
        if i % 3 == 0:
            out += [
                A("pedestal_finial", cx + math.cos(a) * r, cy + math.sin(a) * r, 0,
                  s=0.55 * sc, mat="MI_V2_IvoryStone", label="%s_Post%d" % (tag, i)),
                A("gate_finial_ball", cx + math.cos(a) * r, cy + math.sin(a) * r, 78.0 * sc,
                  s=0.34 * sc, mat="MI_V2_Gold", label="%s_Lamp%d" % (tag, i)),
            ]
    # the rest of the service, set out on the floor rather than stacked
    for i in range(_n(3, H["prop"], 1)):
        a = 2.1 * i + 1.4
        r = 380.0 * sp
        out.append(A(("tea_saucer", "tea_cup_small", "tea_cup")[i % 3],
                     cx + math.cos(a) * r, cy + math.sin(a) * r, 0, yaw=40 * i,
                     s=ts * 0.7, mat="MI_V2_Ceramic", label="%s_Set%d" % (tag, i)))
    for i in range(_n(4, H["veg"], 1)):
        out += _ground_patch(cx + (i - 1.5) * 620.0 * sp, cy + 1300.0 * sp, 0,
                             40 * i, 1.0,
                             ("MI_V2_RosePink", "MI_V2_PetalWhite", "MI_V2_PetalViolet")[i % 3],
                             "%s_Bed%d" % (tag, i))
    out.append(A("garden_lawn", cx, cy, -2, sxyz=(0.5 * sp, 0.45 * sp, 1.0),
                 mat="MI_V2_Lawn", label="%s_Ground" % tag))
    return out


def _quarter_court(cx, cy, sgn, seed, tag, H=None):
    """A WALLED GARDEN COURT -- architecture around a garden, not beside it.

    The boards' gardens are ROOMS: a wall, a colonnade, an arch you come in
    by, and formal planting inside. That is the difference between "organized
    gardens, not random" and a parterre standing on a lawn.
    """
    H = H or HIER(cx, cy)
    sp, sc = H["spacing"], H["scale"]
    out = []
    w, d = 2100.0 * sp, 1700.0 * sp
    yaw0 = (seed * 31) % 90 - 45
    c, s0 = math.cos(math.radians(yaw0)), math.sin(math.radians(yaw0))

    def place(lx, ly):
        return (cx + lx * c - ly * s0, cy + lx * s0 + ly * c)

    # the wall, with a gate on the south face and an arch on the north
    n_side = _n(5, 0.6 + 0.6 * H["court_p"], 3)
    for side, (ax, ay, run) in enumerate(((0, -1, w), (0, 1, w), (-1, 0, d), (1, 0, d))):
        for i in range(n_side):
            t = -0.5 + (i + 0.5) / n_side
            if side < 2 and abs(t) < 0.16:
                continue                          # the two ways through
            lx = t * run * 2 if side < 2 else ax * w
            ly = ay * d if side < 2 else t * run * 2
            px, py = place(lx, ly)
            out.append(A("garden_wall", px, py, 0, yaw=yaw0 + (0.0 if side < 2 else 90.0),
                         sxyz=(run / (n_side * 255.0), 1.0, 0.62),
                         mat="MI_V2_IvoryStone", label="%s_Wall%d_%d" % (tag, side, i)))
    for side, ay in ((0, -1), (1, 1)):
        px, py = place(0.0, ay * d)
        out.append(A(("gate_arch_gold", "arch_stone")[side], px, py, 0, yaw=yaw0,
                     s=(0.95 if side else 0.9) * sc,
                     mat=("MI_V2_Gold", "MI_V2_IvoryStone")[side],
                     label="%s_Entry%d" % (tag, side)))
    # A COLONNADE along one side: the boards' "columns & ornaments", and the
    # cheapest way a garden reads as royal rather than municipal.
    if H["court_p"] > 0.35:
        n_col = _n(5, H["density"], 3)
        for i in range(n_col):
            t = -0.5 + (i + 0.5) / n_col
            px, py = place(-w * 0.86, t * d * 1.7)
            out += [
                A("column_ornate", px, py, 0, s=0.85 * sc, mat="MI_V2_IvoryStone",
                  label="%s_Column%d" % (tag, i)),
                A("gate_finial_ball", px, py, 850.0 * 0.85 * sc, s=0.45 * sc,
                  mat="MI_V2_Gold", label="%s_ColumnCap%d" % (tag, i)),
            ]
    out.append(A("terrace_platform", cx, cy, -18.0, yaw=yaw0,
                 sxyz=(w / 900.0, d / 620.0, 0.35), mat="MI_V2_PlazaCream",
                 label="%s_Court" % tag))
    out += _parterre(sgn, cx, cy, seed + 5, tag + "_P", H=H)
    # the room's own landmark, off the cross axis so the walk stays open
    lx, ly = place(w * 0.42, -d * 0.44)
    if _vnoise(cx, cy, 6000.0, 8123) < 0.5:
        out.append(A("heart_topiary", lx, ly, 0, yaw=yaw0 + 15, s=0.55 * H["landmark_scale"] * sc,
                     mat="MI_V2_LeafLight", label="%s_Heart" % tag))
    else:
        out += [
            A("pedestal_finial", lx, ly, 0, s=1.15 * sc, mat="MI_V2_IvoryStone",
              label="%s_Plinth" % tag),
            A("clock_ornate", lx, ly, 150.0 * sc, yaw=yaw0 + 180, s=1.35 * sc,
              mat="MI_V2_Gold", label="%s_Clock" % tag),
        ]
    out.append(A("garden_lawn", cx, cy, -2, yaw=yaw0,
                 sxyz=(w / 2800.0, d / 2400.0, 1.0),
                 mat="MI_V2_Lawn", label="%s_Ground" % tag))
    return out


def _quarter_hamlet(cx, cy, sgn, seed, tag, H=None):
    """A SMALL SETTLEMENT -- the boards' outer districts, at village scale.

    Between the royal core and the woods the reference shows ordinary
    Wonderland: small houses with the same pink and lilac roofs as the
    palace, a lane, a well, garden pockets. It is the tier that makes the
    world feel inhabited rather than staged, and it did not exist.
    """
    H = H or HIER(cx, cy)
    sp, sc = H["spacing"], H["scale"]
    out = []
    roofs = ("MI_V2_RoofPink", "MI_V2_RoofLilac", "MI_V2_RoofBlue", "MI_V2_RoofRose",
             "MI_V2_RoofNavy")
    n = _n(6, H["density"], 3, 8)
    for i in range(n):
        a = 6.283 * i / n + 0.31 * _rnd(i, seed, 6)
        r = (900.0 + 620.0 * _rnd(i, seed, 7)) * sp
        x, y = cx + math.cos(a) * r, cy + math.sin(a) * r
        yaw = math.degrees(a) + 90.0 + 30.0 * (_rnd(i, seed, 8) - 0.5)
        hs = (0.30 + 0.14 * _rnd(i, seed, 9)) * sc
        out += [
            A("castle_hall", x, y, 0, yaw=yaw, s=hs, mat="MI_V2_IvoryStone",
              label="%s_House%d" % (tag, i)),
            A(("roof_hip", "roof_bell", "roof_ogee")[i % 3], x, y, 900.0 * hs,
              yaw=yaw, s=hs, mat=roofs[(i + seed) % 5], label="%s_HouseRoof%d" % (tag, i)),
        ]
        # A FRONT GARDEN. A house on grass is a model; a house with a kerb, a
        # bed and a hedge in front of it is somewhere somebody lives, and it
        # is four pieces. This is what took the hamlet from 44 placements to
        # something that reads at walking distance.
        fx = x + math.cos(a) * 430.0 * sc
        fy = y + math.sin(a) * 430.0 * sc
        if _rnd(i, seed, 10) < 0.72:
            out.append(A("hedge_mass", fx, fy, 0, yaw=yaw, s=0.8 * sc,
                         mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2],
                         label="%s_Hedge%d" % (tag, i)))
        out.append(A("kerb_stone", fx, fy, 0, yaw=yaw, sxyz=(3.0, 1.0, 0.5),
                     mat="MI_V2_Kerb", label="%s_Kerb%d" % (tag, i)))
        out += _ground_patch(fx - math.cos(a) * 130.0, fy - math.sin(a) * 130.0, 0,
                             _rnd(i, seed, 11) * 360.0, 0.85,
                             ("MI_V2_PetalPink", "MI_V2_PetalWhite", "MI_V2_Lavender",
                              "MI_V2_RosePink")[i % 4],
                             "%s_Bed%d" % (tag, i))
        if _rnd(i, seed, 12) < 0.5:
            out.append(A("topiary_ball", fx + math.sin(a) * 190.0 * sc,
                         fy - math.cos(a) * 190.0 * sc, 0, s=0.55 * sc,
                         mat="MI_V2_LeafDark", label="%s_Ball%d" % (tag, i)))
        # and the lane that runs to its door
        out.append(A("terrace_platform", (x + cx) * 0.5, (y + cy) * 0.5, -18.0,
                     yaw=math.degrees(a),
                     sxyz=(math.hypot(x - cx, y - cy) / 1600.0, 0.16, 0.35),
                     mat="MI_V2_PlazaCream", label="%s_Lane%d" % (tag, i)))
    # the village tower, and the well the lane runs to
    th = (0.72 + 0.22 * _rnd(seed, 4, 1)) * sc * (0.75 + 0.25 * H["skyline"])
    out += [
        A("tower_capped", cx + sgn * 480.0 * sp, cy + 420.0 * sp, 0, s=th,
          mat="MI_V2_IvoryStone", label="%s_Tower" % tag),
        A("roof_cone_steep", cx + sgn * 480.0 * sp, cy + 420.0 * sp, 1100.0 * th, s=th,
          mat=roofs[seed % 5], label="%s_TowerCap" % tag),
        A("finial_spire", cx + sgn * 480.0 * sp, cy + 420.0 * sp, 1560.0 * th,
          s=0.6 * th, mat="MI_V2_Gold", label="%s_TowerSpire" % tag),
        A("stone_ring_base", cx, cy, -3, s=0.75 * sc, mat="MI_V2_Stone",
          label="%s_WellRing" % tag),
        A("fountain_basin", cx, cy, 0, s=0.5 * sc, mat="MI_V2_IvoryStone",
          label="%s_Well" % tag),
        A("fountain_water", cx, cy, 0, s=0.5 * sc, mat="MI_V2_Water",
          label="%s_WellWater" % tag),
    ]
    # the square, and a lane out of it
    out.append(A("terrace_platform", cx, cy, -18.0, yaw=(seed * 17) % 90,
                 sxyz=(0.62 * sp, 0.62 * sp, 0.35), mat="MI_V2_PlazaWarm",
                 label="%s_Square" % tag))
    # the market cross, and an arch on the way in: a village square wants a
    # thing at its middle and a threshold to arrive through
    out += [
        A("pedestal_finial", cx - sgn * 700.0 * sp, cy + 620.0 * sp, 0, s=1.1 * sc,
          mat="MI_V2_IvoryStone", label="%s_Cross" % tag),
        A("gate_finial_heart", cx - sgn * 700.0 * sp, cy + 620.0 * sp, 160.0 * sc,
          s=0.7 * sc, mat="MI_V2_Gold", label="%s_CrossHeart" % tag),
        A("garden_arch_stone", cx + sgn * 1500.0 * sp, cy - 1350.0 * sp, 0,
          yaw=math.degrees(math.atan2(-1350.0, sgn * 1500.0)) + 90.0, s=0.8 * sc,
          mat="MI_V2_IvoryStone", label="%s_Arch" % tag),
    ]
    for i in range(_n(4, H["veg"], 2)):
        a2 = 6.283 * i / 4.0 + 0.9
        out.append(A(("shrub_flowering", "rose_bush")[i % 2],
                     cx + math.cos(a2) * 620.0 * sp, cy + math.sin(a2) * 620.0 * sp, 0,
                     yaw=40 * i, s=0.85 * sc, mat="MI_V2_LeafMid",
                     label="%s_SquareGreen%d" % (tag, i)))
    for i in range(_n(3, H["prop"], 0)):
        a = 2.4 * i + 0.7
        out += _ground_patch(cx + math.cos(a) * 780.0 * sp, cy + math.sin(a) * 780.0 * sp,
                             0, 45 * i, 1.0,
                             ("MI_V2_PetalPink", "MI_V2_PetalWhite", "MI_V2_Lavender")[i % 3],
                             "%s_Bed%d" % (tag, i))
    out.append(A("garden_lawn", cx, cy, -2, sxyz=(0.58 * sp, 0.52 * sp, 1.0),
                 mat="MI_V2_Lawn", label="%s_Ground" % tag))
    return out


def _quarter_meadow(cx, cy, sgn, seed, tag, H=None):
    """OPEN COUNTRY -- the transition the boards keep between their masses.

    Not everything is a place, and a world in which everything is a place is
    as uniform as one in which nothing is. The boards' distance is landscape:
    drifts of flowers, hedgerow lines, single trees, one marker. It is the
    honest answer to a large empty region -- it costs almost nothing, it is
    all instanced, and it reads as somewhere rather than as filler.
    """
    H = H or HIER(cx, cy)
    sp, sc = H["spacing"], H["scale"]
    out = []
    lean = _rnd(seed, 5, 1) * 6.283
    for k in range(3):
        out.append(A("garden_lawn", cx + math.cos(lean + 2.1 * k) * 2200.0 * sp,
                     cy + math.sin(lean + 2.1 * k) * 2200.0 * sp, -2,
                     yaw=(seed * 11 + 37 * k) % 90,
                     sxyz=(1.15 * sp, 1.0 * sp, 1.0),
                     mat=("MI_V2_Meadow", "MI_V2_Moss", "MI_V2_Lawn")[k],
                     label="%s_Ground%d" % (tag, k)))
    # a hedgerow, which is what makes open ground read as FIELDS
    n_h = _n(7, 0.7 + 0.6 * H["veg"], 4)
    for i in range(n_h):
        t = -0.5 + i / float(max(1, n_h - 1))
        rx, ry = t * 5200.0 * sp, (_rnd(i, seed, 11) - 0.5) * 900.0
        out.append(A("hedge_mass", cx + rx * math.cos(lean) - ry * math.sin(lean),
                     cy + rx * math.sin(lean) + ry * math.cos(lean), 0,
                     yaw=math.degrees(lean), s=(1.2 + 0.6 * _rnd(i, seed, 12)) * sc,
                     mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2],
                     label="%s_Hedgerow%d" % (tag, i)))
    # single trees, well apart, the way a meadow carries them
    for i in range(_n(5, 0.5 + 0.9 * H["veg"], 2)):
        a = 6.283 * _rnd(i, seed, 13)
        r = (1200.0 + 2400.0 * _rnd(i, seed, 14)) * sp
        x, y = cx + math.cos(a) * r, cy + math.sin(a) * r
        t = (1.15 + 0.5 * _rnd(i, seed, 15)) * sc
        out += [
            A("tree_mature_trunk", x, y, 0, yaw=_rnd(i, seed, 16) * 360.0, s=t,
              mat="MI_V2_Bark", label="%s_Tree%d" % (tag, i)),
            A("canopy_large", x, y, 1320.0 * t, yaw=_rnd(i, seed, 17) * 360.0, s=t * 1.2,
              mat=("MI_V2_LeafMid", "MI_V2_LeafLight", "MI_V2_LeafDark")[i % 3],
              label="%s_TreeCanopy%d" % (tag, i)),
        ]
    # drifts, not beds: long smears of one colour, which is what a meadow is
    for i in range(_n(7, 0.6 + 0.9 * H["veg"], 3)):
        a = lean + 0.5 * (i - 3)
        r = (700.0 + 2100.0 * _rnd(i, seed, 18)) * sp
        out += _ground_patch(cx + math.cos(a) * r, cy + math.sin(a) * r, 0,
                             math.degrees(lean) + 20.0 * i, 1.35,
                             ("MI_V2_PetalViolet", "MI_V2_PetalWhite", "MI_V2_PetalPink",
                              "MI_V2_Lavender")[i % 4],
                             "%s_Drift%d" % (tag, i))
    # ONE marker, so open country still has a destination in it
    mx, my = cx + sgn * 1500.0 * sp, cy - 1300.0 * sp
    ls = H["landmark_scale"]
    if _vnoise(cx, cy, 8000.0, 9311) < 0.5:
        out += [
            A("stone_ring_base", mx, my, -2, s=0.9 * ls, mat="MI_V2_Stone",
              label="%s_Ring" % tag),
            A("mushroom_landmark", mx, my, 0, yaw=_rnd(seed, 6, 1) * 360.0, s=1.2 * ls,
              mat="MI_V2_MushTerracotta", label="%s_Landmark" % tag),
        ]
    else:
        out += [
            A("pedestal_finial", mx, my, 0, s=1.3 * ls, mat="MI_V2_IvoryStone",
              label="%s_Plinth" % tag),
            A("garden_urn", mx, my, 160.0 * ls, s=0.95 * ls, mat="MI_V2_Ceramic",
              label="%s_Urn" % tag),
            A("gate_finial_ball", mx, my, 300.0 * ls, s=0.6 * ls, mat="MI_V2_Gold",
              label="%s_Finial" % tag),
        ]
    return out


def _road(x0, y0, x1, y1, width, tag, n=None):
    """A paved way between two points, laid as segments along its run.

    Roads are what make a ring of quarters a WORLD rather than a set of
    islands: the founder's test is that a player should feel 'I can keep
    going', and that is a question about connection, not about content.
    """
    out = []
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy)
    if n is None:
        n = max(1, int(length / 1400.0))
    yaw = math.degrees(math.atan2(dy, dx))
    for i in range(n):
        t0, t1 = i / float(n), (i + 1) / float(n)
        cx, cy = x0 + dx * (t0 + t1) * 0.5, y0 + dy * (t0 + t1) * 0.5
        seg = length / n
        out.append(A("terrace_platform", cx, cy, -18.0, yaw=yaw,
                     sxyz=(seg / 1440.0, width / 740.0, 0.35),
                     mat=("MI_V2_PlazaCream", "MI_V2_PlazaWarm")[i % 2],
                     label="%s_Seg%d" % (tag, i)))
    return out


#: THE RING. Twelve quarters by bearing and radius, each with a type and a
#: seed. Bearings avoid the castle axis (90 deg) so the castle sightline the
#: founder approved in PASS 06/07 stays open, and radii alternate so the ring
#: is a landscape rather than a fence.
_QUARTERS = [
    (200.0, 11000, "garden"), (232.0, 13500, "towers"), (263.0, 10200, "grove"),
    (295.0, 14000, "garden"), (326.0, 11200, "towers"), (356.0, 13000, "grove"),
    (25.0, 11500, "garden"), (56.0, 13800, "towers"), (128.0, 12500, "grove"),
    (152.0, 10800, "garden"), (176.0, 14200, "towers"), (108.0, 15500, "garden"),
]

#: PLACED AT THE MEASURED CENTRES, not at guessed bearings. After the first
#: ring the audit re-ran and the 27,056 m2 void had broken into pieces, the
#: largest two being 7,216 and 6,816 m2 in the REAR quadrants -- ground the
#: ring's bearings skirted. These sites are the audit's own reported centres
#: for every remaining region over ~400 m2, which is the difference between
#: filling a world and filling the part of it somebody happened to look at.
_QUARTER_SITES = [
    (7751, -5529, "garden", 8100), (-7826, -5083, "towers", 8200),
    (10316, 11105, "grove", 8300), (-10535, 11443, "garden", 8400),
    (1708, 13010, "towers", 8500), (-4210, 8887, "grove", 8600),
    (4296, 8776, "garden", 8700), (9600, -9800, "grove", 8800),
    (-9400, -9500, "garden", 8900), (11200, 2600, "towers", 9000),
    (-11400, 2200, "grove", 9100), (0, -10600, "garden", 9200),
    # third round, again from the audit's own centres after the ring roads
    (7045, -4870, "towers", 9300), (-4919, -8967, "grove", 9400),
    (-9464, 48, "garden", 9500), (-4060, -2898, "grove", 9600),
    (9293, 13573, "towers", 9700), (10424, 8536, "garden", 9800),
    (11400, -10500, "grove", 9900), (-11000, -11200, "towers", 10000),
]

# ---------------------------------------------------------------------------
# THE DISTRICT FIELD
# ---------------------------------------------------------------------------
#
# The boards' world-layout overview is a MAP with named regions on it, and
# that is the piece the procedural world was missing: it had a hierarchy of
# density and no geography. Forty-four quarters of three kinds, interleaved by
# a hash, cannot read as "the Clock Tower District" or "the Mushroom Grove" no
# matter how well their densities fall off.
#
# So the world has districts, and a quarter's KIND comes from the district it
# stands in rather than from a field in a table. Each seed is a bearing and a
# radius -- roughly where the boards put that region relative to the castle --
# and a palette; a site joins the nearest seed in a metric that blends angle
# and distance, so districts are wedges and annular sectors rather than
# circles, and a noise term keeps their borders from reading as arcs.
#
# AUTHORED POSITIONS SURVIVE. What a `Q` or `S` centre encodes is a decision
# about WHERE -- a bearing that misses the castle sightline, a centre the
# emptiness audit reported -- and that is untouched. The `kind` field in those
# tables is now advisory and the district overrides it, which is the whole
# point: the same forty-four places, finally telling you what they are.

#: (name, bearing deg, radius uu, kind palette). The palette is sampled by a
#: noise field, and repeating a kind in it weights that kind, so a district is
#: mostly one thing with variety rather than three things in rotation.
_DISTRICT_SEEDS = (
    ("Royal Gardens",     65.0, 11000.0, ("court", "garden", "court")),
    ("Clock Quarter",      5.0, 13500.0, ("clockyard", "court", "garden")),
    ("Tower Rise",       120.0, 13000.0, ("towers", "court", "clockyard")),
    ("Lantern Hamlets",  152.0, 15500.0, ("hamlet", "court", "garden")),
    ("Tea Terraces",     200.0, 11500.0, ("tea", "garden", "court")),
    ("Water Gardens",    248.0, 12000.0, ("water", "water", "garden")),
    ("Mushroom Grove",   300.0, 14000.0, ("grove", "wood", "grove")),
    ("Gatekeeper Fields",340.0, 15000.0, ("meadow", "hamlet", "garden")),
    ("North Reach",      130.0, 25000.0, ("wood", "hamlet", "meadow")),
    ("East Reach",        25.0, 26000.0, ("towers", "meadow", "wood")),
    ("The Long Woods",   210.0, 25000.0, ("wood", "meadow", "wood")),
    ("South Meadows",    278.0, 27000.0, ("meadow", "wood", "meadow")),
    ("West Wood",        170.0, 30000.0, ("wood", "wood", "meadow")),
    ("Far Orchards",     315.0, 29000.0, ("meadow", "wood", "hamlet")),
)


def _district_of(x, y):
    """(name, kind) for a place. Geography first, then what stands on it."""
    r = math.hypot(x, y) or 1.0
    b = math.degrees(math.atan2(y, x)) % 360.0
    # the border wobble: enough to break the arc, not enough to interleave
    b += 16.0 * (_vnoise(x, y, 11000.0, 6421) - 0.5)
    r *= 1.0 + 0.16 * (_vnoise(x, y, 13000.0, 6427) - 0.5)
    best, bd = _DISTRICT_SEEDS[0], 1e18
    for seed in _DISTRICT_SEEDS:
        _n_, sb, sr, _k = seed
        da = abs((b - sb + 180.0) % 360.0 - 180.0)
        # angle weighed by the MEAN radius, so a 20 deg error costs the same
        # near and far -- otherwise every far site joins whichever district
        # happens to be nearest the origin
        d = math.radians(da) * (0.5 * (r + sr)) * 0.62 + abs(r - sr)
        if d < bd:
            best, bd = seed, d
    name, _sb, _sr, palette = best
    # A HASH, NOT THE FIELD. Sampling the palette from a smooth noise field
    # gave every site in a district nearly the same value, so the Clock
    # Quarter's four sites came out as four courts and the world gained one
    # clock tower. And the pick is WEIGHTED: a district is its signature kind
    # most of the time, or it is not a district.
    v = _rnd(round(x / 100.0), round(y / 100.0), 6433)
    k = 0 if v < 0.64 else (1 if v < 0.85 else 2)
    return name, palette[k]


#: uu. The ring circuit's working radius, used by the road-activation term.
_RING_RADIUS = 12500.0
#: The bearings that carry a radial way out of the district. Derived from the
#: sites rather than restated, so a new quarter activates its own ground.
_ROAD_BEARINGS = ([b for (b, _r, _k) in _QUARTERS]
                  + [math.degrees(math.atan2(y, x)) % 360.0
                     for (x, y, _k, _s) in _QUARTER_SITES])


# ---------------------------------------------------------------------------
# THE ATMOSPHERIC DISTANCE
# ---------------------------------------------------------------------------
#
# The audit that found the 27,056 m2 void sampled +/- 120 m. The world reaches
# 450 m. Re-run over the ground a walker can actually cover, it reports
# **461,488 m2 in one region** -- 46 hectares, ninety-five times the number
# this ledger had been carrying, and the same failure the tool exists to catch,
# one level up: an audit's WINDOW is part of its measurement.
#
# A polar map says the shape of it. Density per hectare by 45 deg sector:
#
#   150-200 m    33   90  231   36   12   63   51   41
#   200-300 m     0   10    9    0    0    0    0    0
#   300-450 m     2   12   13    1    0    0    0    0
#
# Only the two sectors either side of the castle axis have anything out there,
# and that is CITY -- the approved layer-4/5 silhouettes, all of them at y > 0.
# Turn round at the plaza and the world ends at 165 m in every direction.
#
# This is the atmospheric band, and it is deliberately NOT a thinner ring of
# the same quarters: `_quarter_wood` is landscape at the scale distance reads,
# and the arcs skip the castle sightline and the ground the CITY already
# occupies, so the far world is woods and lone towers behind and to the sides,
# and architecture in front. That asymmetry is the reason it does not read as
# a third concentric ring.

#: uu. The atmospheric band: from beyond the quarter belt to the world edge.
_DISTANCE_BAND = (17000.0, 33500.0)
#: uu. How far apart the far tier stands, at the near edge of the band and at
#: the far edge. IT GROWS, because a spiral at ONE spacing is area-uniform and
#: an area-uniform tier does not thin: with the woods dense enough to read as
#: mass, the profile went flat from 200 m to 325 m at ~50 per hectare -- the
#: ring problem again, wearing the horizon's clothes. Masses stay masses and
#: there are fewer of them the further out you go, which is the tier's own
#: brief: lowest density, larger spacing, fewer but stronger landmarks.
_DISTANCE_SPACING = (9600.0, 15400.0)
#: How many to try before giving up -- the spiral is dense, the keep-outs and
#: the spacing rule do the choosing.
_DISTANCE_TRIES = 220
#: deg. Half-width of the castle sightline, kept clear at every radius.
_AXIS_KEEP_OUT = 15.0
#: uu. How much air an approved CITY group keeps around it.
_CITY_CLEARANCE = 5200.0


def _city_points():
    return [(it["pos"][0], it["pos"][1]) for it in CITY
            if math.hypot(it["pos"][0], it["pos"][1]) > 15000.0]


_CITY_POINTS = _city_points()


def _spacing_at(x, y):
    """The far tier's minimum spacing at a point -- it grows with radius."""
    r0, r1 = _DISTANCE_BAND
    d0, d1 = _DISTANCE_SPACING
    t = _clamp((math.hypot(x, y) - r0) / (r1 - r0))
    return d0 + (d1 - d0) * t


def _distance_sites():
    """The far tier: even coverage of a big ring, at a spacing that grows.

    Authored: the band, the spacing, and the two keep-outs. Generated: every
    position and kind.

    IT WAS ARCS, AND ARCS ARE RINGS. Four concentric arcs of 12/12/10/8 put
    forty-two quarters in a band that holds about twenty at the spacing the
    hierarchy itself asks for, so the relaxation had nowhere to put them and
    pressed them onto the world edge -- ten in the 325-350 m bin and a density
    that RISED into the horizon, which is the exact artefact this pass exists
    to remove. Cut to twenty-three the profile fell monotonically and the
    coverage went ragged instead: two holes of 1.3 ha each at 320 m, big
    enough to read as gaps in the horizon line.
    
    Both symptoms are the same cause -- a ring generator cannot distribute a
    sparse tier evenly. So: candidates on a golden-angle spiral, which is
    uniform BY AREA rather than by radius, kept only if they clear everything
    already kept by `_DISTANCE_SPACING`. Even coverage, no band, and the count
    is whatever the ring actually holds rather than a number written down.

    THE CITY KEEP-OUT IS MEASURED, NOT ASSUMED. It began as "skip bearings
    18-162 beyond 240 m, the CITY holds that ground" -- and the CITY does not
    hold that ground: its layer 4 is two groups at 214 m and 229 m and its
    layer 5 stands at 300-420 m, so the rule reserved a quadrant for
    architecture that is not there. The audit found the consequence exactly:
    30,416 m2 and 21,264 m2, the two largest holes in the world, both in the
    front hemisphere between 200 and 350 m.

    And what fills the front is WOOD, never towers. The founder's PASS 06 note
    was that beyond the castle the world looked "too deep and messy", which is
    why layers 4 and 5 were cut to three clean silhouettes; new tower tops
    behind the castle would undo that judgement. Landscape at the same
    distance does not -- it is the layered haze those frames read well.
    """
    r0, r1 = _DISTANCE_BAND
    kept = []
    for k in range(_DISTANCE_TRIES):
        # uniform by AREA: r = sqrt(lerp(r0^2, r1^2, u)), bearing by the
        # golden angle so successive candidates never share a spoke
        u = (k + 0.5) / _DISTANCE_TRIES
        r = math.sqrt(r0 * r0 + (r1 * r1 - r0 * r0) * u)
        b = (k * 137.50776405 + 11.0 * _rnd(k, 64, 1)) % 360.0
        if abs((b - 90.0 + 180.0) % 360.0 - 180.0) < _AXIS_KEEP_OUT:
            continue                          # the castle reads against sky
        a = math.radians(b)
        x, y = math.cos(a) * r, math.sin(a) * r
        if any((px - x) ** 2 + (py - y) ** 2 < _CITY_CLEARANCE ** 2
               for (px, py) in _CITY_POINTS):
            continue                          # an approved silhouette stands here
        front = 10.0 < b < 170.0
        kind = "wood" if (front or _rnd(k, 64, 2) < 0.72) else "towers"
        # ONE SPACING RULE, NOT TWO. This had its own table -- 96 m at the
        # near edge growing to 154 m at the far -- while `_separate` enforced
        # `_want_gap`, which for two far woods asks 178 m. The spiral accepted
        # candidates the placer then refused, and three woods were dropped
        # into a 14,960 m2 hole in the west because of a disagreement between
        # two descriptions of the same quantity. Asking `_want_gap` directly
        # cannot disagree with itself.
        me = {"x": x, "y": y, "kind": kind,
              "reach": _reach(kind, HIER(x, y))}
        if any(math.hypot(qx - x, qy - y)
               < _want_gap(me, {"x": qx, "y": qy, "kind": qk,
                                "reach": _reach(qk, HIER(qx, qy))})
               for (qx, qy, qk, _s) in kept):
            continue                          # too close to one already kept
        kept.append((x, y, kind, 10500 + 211 * k))
    return kept




# ---------------------------------------------------------------------------
# SITES, SEPARATED
# ---------------------------------------------------------------------------
#
# Two quarters were 9.7 m apart with 21 m footprints -- S12_towers and
# S00_garden, added in different rounds from the audit's own centres, because
# the audit reports where the world is EMPTY and says nothing about what has
# been put there since. Nothing checked, so a tower stood inside a parterre.
#
# Rather than move two coordinates, the sites are separated by construction:
# each carries an estimated reach from its kind and its hierarchy, pairs that
# interpenetrate push apart along their own separation, and a site that cannot
# clear within a bounded displacement is DROPPED and named. The audit's intent
# survives (nothing moves more than 25 m from where it reported), and the class
# of defect cannot come back with the next round of sites.

#: uu. How far a quarter of each kind reaches from its centre, at spacing 1.
#:
#: READ OFF THE BUILDERS, not guessed, and LINEAR IN SPACING because they are:
#:
#:   towers   the wall ring stands at 2,150 * spacing, plus a pier
#:   garden   the grove sits at (1800 + 840) * spacing from the centre
#:   grove    the outer small caps at (1300 + 500) * spacing
#:   wood     the body at 3,000 * (0.80 + 0.40 * spacing), plus the ridge
#:
#: The first version was `_REACH * (0.55 + 0.45 * spacing)` -- SUBLINEAR, so
#: at spacing 1.23 it called a tower quarter 2,429 uu wide when its own wall
#: stood at 2,645. Everything measured against that number was measured
#: against a quarter smaller than the one being built, which is how a City3
#: tower ended up inside an S04 wall with every keep-out satisfied.
_REACH = {"garden": 2750.0, "towers": 2350.0, "grove": 1950.0, "wood": 2900.0,
          "clockyard": 2200.0, "water": 2100.0, "tea": 1900.0, "court": 2600.0,
          "hamlet": 2000.0, "meadow": 3800.0}
#: uu. How far a site may be nudged from where it was first put.
#:
#: Two budgets, because the two kinds of site mean different things. A `Q` or
#: `S` centre is a DECISION -- a bearing chosen to miss the castle sightline,
#: or a coordinate the emptiness audit reported -- so it moves 25 m at most and
#: keeps its intent. A `C` or `D` centre is generated from an arc and means
#: nothing in particular, so it may travel until it fits. With one budget for
#: both, a far wood and a tower neighbourhood stayed 43 m apart with 64 m and
#: 36 m footprints: trees standing inside a court, because the only site that
#: could have moved was pinned by a rule written for the other kind.
_NUDGE = {"authored": 4500.0, "generated": 12000.0}
#: uu. Two sites closer than this are the same site. 18 m against footprints
#: of about 21 m is better than 80% overlap -- one place, described twice.
#: Measured either way: at 13 m five such pairs survive into the world and
#: five landmarks end up inside other geometry; at 25 m eight sites go,
#: including pairs 24 m apart that are simply neighbours in a dense core.
_DUPLICATE = 1800.0
#: Jacobi damping: half of each step, so squeezed sites settle rather than
#: oscillate between their neighbours.
_RELAX_DAMP = 0.5
#: uu. The biggest half-footprint in the approved district (a castle_hall at
#: 600, a tower_capped at s=1.6 giving 640), so a point anchor stands for the
#: body it actually has.
_ANCHOR_BODY = 700.0
#: uu. No quarter stands beyond this: the far arc plus a little, well inside
#: the ground both audits sample and the distance this fog still carries.
_WORLD_EDGE = 34500.0


def _reach(kind, H):
    """The quarter's true outer extent -- the furthest piece it lays down."""
    return _REACH[kind] * (0.12 + 0.88 * H["spacing"]) + 250.0


#: A quarter's BODY, as a fraction of its extent. TWO DIFFERENT QUESTIONS were
#: being answered with one number, and the second answer was wrong both ways.
#:
#: Against APPROVED WORK the full extent is right: no piece of a quarter may
#: stand inside the castle, so the keep-out has to be as wide as the quarter.
#: Against ANOTHER QUARTER it is far too wide -- garden rooms sharing a hedge
#: line is what a dense district looks like -- and spacing every pair by their
#: full extents emptied the core: 147 placements per hectare at 100-150 m
#: against 327 before, with five quarters dropped for not fitting.
#:
#: 0.53 restores the packing the core had before the extents were corrected:
#: the old, understated reach gave two core tower quarters a 3,380 uu gap, and
#: at 0.62 of the true extent they stood 3,930 apart -- the whole core drifted
#: outward, its quarters' scores fell with it, and the density they derive
#: from those scores fell too: 165 per hectare at 100-150 m against 327.
#: Correcting a measurement must not quietly change the thing measured.
#:
#: PER KIND, because the kinds are not shaped alike. A garden's mass is its
#: parterre, about 1,120 uu, with a grove and a landmark reaching well past
#: it -- those may interleave with a neighbour's edge and it reads as one
#: continuous district. A TOWER quarter's mass IS its spread: the towers stand
#: at 1,500 * spacing from the centre, so at a single 0.53 two tower quarters
#: 26 m apart put a tower inside a tower, which the embedded-landmark check
#: found twice in one pair. Measured, not chosen: each fraction is the kind's
#: own mass divided by its extent.
#: MEASURED against each builder: garden -- the parterre rim at ~1,120 uu of
#: a 2,750-ish extent; towers -- the wall ring at 2,150 * spacing, which is
#: four fifths of the quarter; grove -- the small caps at 1,800 * spacing;
#: wood -- the tree body at 3,000 * (0.80 + 0.40 * spacing), which is 0.81 of
#: the extent at far spacing and was set to 0.62 until a wood's tree turned up
#: standing inside an approved City8 tower.
#:
#: The new kinds, read off their builders the same way: a clockyard's wall
#: ring is at 1,900 * spacing of a ~2,450 extent; a water garden's columns at
#: 1,700; a tea terrace's spirals at 1,180; a court's wall box at 2,100 x
#: 1,700; a hamlet's houses at 1,520. A MEADOW is 0.30 on purpose -- open
#: country is mostly open, its hedgerow and its drifts are its edges, and two
#: meadows running into each other is a landscape rather than a collision.
_BODY = {"garden": 0.45, "towers": 0.80, "grove": 0.55, "wood": 0.85,
         "clockyard": 0.78, "water": 0.80, "tea": 0.62, "court": 0.80,
         "hamlet": 0.76, "meadow": 0.30}


def _body(kind, H):
    return _reach(kind, H) * _BODY[kind]


#: The sizes a quarter will try, in order, before it gives up its place.
_SQUEEZE = (1.0, 0.82, 0.66, 0.54)

#: AND THE KINDS IT WILL TRY. Seventeen sites could not be placed and every
#: one of them was a big kind in a tight spot -- a walled court is 42 m across
#: and there is not room for one everywhere the district field says "court".
#: Dropping it throws away a decision (a bearing off the castle axis, a centre
#: the emptiness audit reported) to protect a kind, which is backwards: the
#: POSITION is what was decided and the kind is what the field suggested.
#:
#: So a site that will not fit becomes a smaller kind of place, in an order
#: that keeps the district reading -- a court becomes a garden before it
#: becomes a grove, a clock quarter keeps its architecture one step longer --
#: and only a meadow that will not fit is finally dropped.
_KIND_FALLBACK = {
    "court":     ("garden", "grove", "meadow"),
    "clockyard": ("court", "garden", "grove"),
    "towers":    ("hamlet", "grove", "meadow"),
    "water":     ("garden", "grove", "meadow"),
    "garden":    ("grove", "meadow"),
    "tea":       ("garden", "grove"),
    "hamlet":    ("grove", "meadow"),
    "wood":      ("grove", "meadow"),
    "grove":     ("meadow",),
    "meadow":    (),
}


def _squeezed(H, f):
    """The same hierarchy, for a quarter that had to fit into less room.

    Only `spacing` and `scale` move: how far apart a quarter's own pieces
    stand and how big they are. Its density, its landmark probability and
    everything else stay what its POSITION says they should be, because being
    squeezed by a neighbour is not the same as being far away.
    """
    if f >= 0.999:
        return H
    out = dict(H)
    out["spacing"] = H["spacing"] * f
    out["scale"] = H["scale"] * (0.55 + 0.45 * f)
    return out


def _want_gap(a, b):
    """How far apart two quarters SHOULD stand -- itself a hierarchy quantity.

    Quarters abutting is not the defect; a tower standing inside a parterre
    is. And the core is MEANT to be tight -- "shortest spacing between
    meaningful structures" is the first line of the brief for it -- so the
    target gap is a fraction of the two reaches that grows with distance:
    core rooms may almost touch, distant masses stand well clear of each
    other with landscape between. Enforced here, so it is a property of the
    construction rather than something a later audit has to notice.
    """
    ha, hb = HIER(a["x"], a["y"]), HIER(b["x"], b["y"])
    s = 0.5 * (ha["score"] + hb["score"])
    # BODIES, not extents. Two core quarters' bodies just touching is the
    # dense core the brief asks for; two distant masses stand nearly two
    # bodies clear of each other with landscape between. That is the whole
    # spacing hierarchy, in one line and one number per tier.
    body = _body(a["kind"], ha) + _body(b["kind"], hb)
    # 0.90 at the core end, so two core quarters' bodies TOUCH rather than
    # stand 13% clear: at 1.00 two tower quarters needed 43 m between centres
    # and eleven of the thirty-two authored sites could not be placed at all.
    # Touching is the dense core; the distance keeps nearly two bodies of air.
    #
    # EXCEPT BETWEEN TWO WOODS. The "larger spacing" the far tier asks for is
    # about landmark clusters SEPARATED BY LANDSCAPE, and a wood is the
    # landscape -- two woods whose canopies meet is a forest, not a collision.
    # Applying the separation to them demanded 178 m between bodies 100 m
    # across, so four of the fifteen far sites could not be placed and the
    # west of the world opened a 15,000 m2 hole. They may nearly touch; what
    # keeps the horizon sparse is that there are few of them and they are big.
    # ADJACENCY IS KIND-AWARE. Landscape systems merge; designed ones do not.
    #   wood + wood        one forest
    #   meadow + anything  open country runs up to whatever is beside it
    #   grove + wood       a wood with a grove in it
    # Everything else -- towers, clockyards, courts, water gardens -- is
    # architecture with a silhouette, and needs the spacing its tier asks for.
    soft = ("wood", "meadow", "grove")
    sep = 0.30 if ("meadow" in (a["kind"], b["kind"])) else (
        0.35 if (a["kind"] in soft and b["kind"] in soft) else 1.0)
    return body * (0.90 + 0.95 * (1.0 - s) * sep)


def _anchor_grid(cell=1200.0):
    """Approved mass, in a grid, so the relaxation can be pushed off it.

    `_district_clear` refuses to PLACE a site on approved ground and says
    nothing about where the relaxation then moves it. It moved two: the
    hierarchy audit's embedded-landmark check found `City4_Tower3` standing
    inside `Q07_towers_Tower2` and `City5_Tower2` inside a Q11 parterre bed --
    an approved castle tower and a quarter's garden occupying the same square
    metres. Golden Arrival and the city now repel, exactly as the quarters
    repel each other, so a site cannot be pushed into approved work any more
    than it can be placed there.
    """
    grid = {}
    for (px, py) in _DISTRICT_MASS:
        k = (int(px // cell), int(py // cell))
        grid.setdefault(k, []).append((px, py))
    return grid, cell


def _nearest_anchor(x, y, grid, cell, reach):
    """Any approved mass within `reach` of (x, y), or None.

    It returns the FIRST hit, not the nearest: every caller asks "is there
    one", and scanning the whole neighbourhood to find the closest of them
    took placement from a second to half a minute of every module import.
    """
    rr = reach * reach
    ci, cj = int(x // cell), int(y // cell)
    span = int(reach // cell) + 1
    for i in range(ci - span, ci + span + 1):
        for j in range(cj - span, cj + span + 1):
            for (px, py) in grid.get((i, j), ()):
                if (px - x) ** 2 + (py - y) ** 2 < rr:
                    return (px, py)
    return None


def _separate(sites):
    """Place every quarter where it clears everything already placed.

    GREEDY AND SEQUENTIAL, not relaxed. This was a damped Jacobi relaxation
    and the trouble with relaxation here is that it does not have to succeed:
    it pushes for a fixed number of passes and whatever is left over is left
    over, so a site squeezed between two neighbours ends up embedded in one of
    them and only a later audit finds out. Five successive tunings of the
    damping, the iteration count and the budgets each fixed the pair in front
    of me and produced a different one, and it cost 36 seconds of every
    module import.

    Sequential placement cannot do that. Inner sites first, because the core
    is the authored intent; each site takes its own position if it clears, and
    otherwise the nearest position on a deterministic ring search that does.
    If nothing within its budget clears, it is DROPPED and named. Every kept
    site is conflict-free by construction, which is the property the audits
    kept having to check for.
    """
    # DUPLICATES FIRST, BECAUSE THEY ARE NOT A SPACING PROBLEM.
    #
    # S00_garden and S12_towers stood 9.7 m apart with 21 m footprints, and no
    # amount of pushing fixes that: they are the SAME HOLE, reported by the
    # emptiness audit in two different rounds and turned into two quarters
    # because nothing compared the new centres against the old ones. Separating
    # them just moves two quarters that should have been one. A later site
    # within `_DUPLICATE` of an earlier one is dropped by name.
    grid, cell = _anchor_grid()
    cand = []
    for s in sites:
        twin = next((t for t in cand
                     if math.hypot(s["x"] - t["x"], s["y"] - t["y"]) < _DUPLICATE), None)
        if twin is not None:
            SITE_NOTES.append("%s dropped: the same site as %s, %.0f m away"
                              % (s["tag"], twin["tag"],
                                 math.hypot(s["x"] - twin["x"], s["y"] - twin["y"]) / 100.0))
            continue
        d = dict(s)
        d["squeeze"] = 1.0
        cand.append(d)

    def fits(a, placed):
        H = _squeezed(HIER(a["x"], a["y"]), a["squeeze"])
        a["reach"] = _reach(a["kind"], H)
        if math.hypot(a["x"], a["y"]) > _WORLD_EDGE:
            return False
        # THE BODY, plus the anchor's own size. Using the full extent here
        # demanded 35 m of clear ground around every quarter centre and
        # refused twenty of the thirty-two authored sites -- the district's
        # own mass reaches 66-117 m and the ring stands at 78-165, so almost
        # every one of them has a hedge or a trunk within 35 m. What must not
        # happen is a PIECE inside approved work, and every piece that can do
        # that -- a tower at 1,500 * spacing, a landmark at 850 -- is inside
        # the body. The outer, sparse end of a quarter meeting the flank's
        # planting is a district, not a collision.
        if _nearest_anchor(a["x"], a["y"], grid, cell,
                           _body(a["kind"], H) + _ANCHOR_BODY) is not None:
            return False
        for b in placed:
            if math.hypot(a["x"] - b["x"], a["y"] - b["y"]) < _want_gap(a, b):
                return False
        return True

    # AUTHORED SITES PLACE FIRST. Ordering purely by radius let the generated
    # core belt -- which means nothing in particular and carries a 120 m budget
    # -- take the good ground before the twelve ring bearings and twenty audit
    # centres that were chosen for reasons, and twenty-four of those thirty-two
    # then had nowhere to go. A site that encodes a decision is placed while
    # there is still room; the generated tiers fill what is left, which is
    # what they are for.
    def _priority(s):
        return (0 if s["tag"][:1] in ("Q", "S") else 1, math.hypot(s["x"], s["y"]))

    kept, dropped = [], []
    for s in sorted(cand, key=_priority):
        s["x0"], s["y0"] = s["x"], s["y"]
        budget = _NUDGE["authored" if s["tag"][:1] in ("Q", "S") else "generated"]
        placed = False
        # MOVE, THEN SHRINK, THEN DROP. A quarter that will not fit at its own
        # size can usually fit as a smaller one, and a place squeezed between
        # two neighbours BEING smaller is what happens in a real district --
        # it is local variation the hierarchy would otherwise have to invent.
        # Dropping ten authored sites to keep every quarter full size threw
        # away decisions (a bearing off the castle axis, an audited centre) to
        # protect a number.
        kind0 = s["kind"]
        for kind in (kind0,) + _KIND_FALLBACK.get(kind0, ()):
            s["kind"] = kind
            for squeeze in _SQUEEZE:
                s["squeeze"] = squeeze
                # ring search: the authored spot first, then the nearest ring
                # that clears -- deterministic in both radius and bearing, so
                # the world is identical every run
                for step in range(0, int(budget // 500) + 1):
                    d = step * 500.0
                    for k in range(1 if step == 0 else 14):
                        b = math.radians(360.0 * k / 14.0 + 11.0 * step)
                        s["x"], s["y"] = s["x0"] + math.cos(b) * d, s["y0"] + math.sin(b) * d
                        if fits(s, kept):
                            kept.append(s)
                            placed = True
                            break
                    if placed:
                        break
                if placed:
                    break
            if placed:
                break
        if placed:
            if s["kind"] != kind0:
                s["tag"] = s["tag"].split("_")[0] + "_" + s["kind"]
                SITE_NOTES.append("%s: no room for a %s here, made a %s"
                                  % (s["tag"], kind0, s["kind"]))
        else:
            s["x"], s["y"], s["squeeze"], s["kind"] = s["x0"], s["y0"], 1.0, kind0
            dropped.append(s)
    if dropped:
        SITE_NOTES.append("dropped %d site(s) that could not clear: %s"
                          % (len(dropped), ", ".join(s["tag"] for s in dropped)))
    return kept


#: Filled by _separate; printed by the layout gate so a dropped site is news
#: rather than a silence.
SITE_NOTES = []


# ---------------------------------------------------------------------------
# THE CORE BELT
# ---------------------------------------------------------------------------
#
# With the falloff steepened the profile fell monotonically everywhere but one
# band, and that band was the giveaway: measured then, 762 per ha at 25-50 m,
# **338 at 50-75**, then back up to 549 at 75-100. Golden Arrival's authored
# ground stops around 50 m and the first quarter centre stood at 85; the
# twenty-five metres between them was a moat, and a moat is exactly how a
# generated world announces itself -- the eye reads the ring, not the
# gradient. (As built the dip is 282 against 723 and 305: see `_district_edge`
# for why what remains of it is not this file's to close.)
#
# The brief's core tier is the answer and it was simply missing: "highest
# architectural density, SHORTEST spacing between meaningful structures,
# strong visual relationship to Golden Arrival". So a belt of small, tight
# quarters just beyond the district's edge, close-packed because `_want_gap`
# lets core bodies touch, and kept off the castle approach -- which is
# approved composition and not ground to build on.

#: deg. The castle approach and its sightline, kept clear of new quarters.
_APPROACH_KEEP_OUT = 26.0
#: (radius uu, count) for the belt that meets Golden Arrival's edge.
#:
#: 92 m, not the 71 the first attempt used. At 71 m every one of the twelve
#: sites was refused by the district keep-out, each within 1.4 m to 12 m of a
#: flank tree or a rear-world hedge -- which is the measurement that matters:
#: **the 50-75 m band is not empty, it is Golden Arrival's own outskirt**, and
#: that is approved ground rather than somewhere to put new towers. So the
#: belt sits just beyond the district's reach and the band itself is thickened
#: by the thing that already crosses it -- the roads (see `_road_verge`).
#: TWO arcs, not one. Correcting the spacing rules pushed quarters that had
#: been 10-17 m apart out to 30-60 m -- right, and it opened real ground: the
#: district-window emptiness went 4,832 m2 to 9,200 AT THAT POINT, every new
#: region between 58 m and 138 m, which is the core tier and the tier the
#: brief wants DENSEST. The second arc is the answer the audit itself named;
#: the keep-out, the duplicate rule and the placer decide which of its sites
#: survive, and as built it is 5,840 m2.
#:
#: PASS 23: three arcs and more of them. Nineteen of sixty-three candidates
#: were refused -- by the approved castle plane in the +y band, by each other
#: in the ring -- and the answer to a refusal rate is more candidates, not
#: looser rules: the placer already drops what does not fit, so every extra
#: seed is either a new place or a line in the build log.
_CORE_ARCS = ((9200.0, 14), (12400.0, 16), (15600.0, 18))


def _core_sites():
    sites = []
    for ai, (rad, count) in enumerate(_CORE_ARCS):
        for i in range(count):
            b = (360.0 * i / count + 29.0 * ai + 13.0 * _rnd(ai, i, 73)) % 360.0
            if abs((b - 90.0 + 180.0) % 360.0 - 180.0) < _APPROACH_KEEP_OUT:
                continue
            r = rad * (0.86 + 0.28 * _rnd(ai, i, 74))
            a = math.radians(b)
            # the core is where the architecture is: towers and gardens, and a
            # grove only where the field says the ground wants to stay open
            f = _vnoise(math.cos(a) * r, math.sin(a) * r, 5200.0, 7717)
            kind = "towers" if f < 0.38 else ("garden" if f < 0.80 else "grove")
            sites.append((math.cos(a) * r, math.sin(a) * r, kind,
                          12800 + 173 * (ai * 20 + i)))
    return sites


CORE_SITES = _core_sites()
#: Built here rather than beside its own function: `_distance_sites` asks
#: `_want_gap` how far apart two far woods stand, and `_want_gap` is defined
#: further down. One rule, so the definition order follows the dependency.
DISTANCE_SITES = _distance_sites()


#: What counts as district MASS for a keep-out: things with a body, not
#: things with a colour. The first version of this refused every one of the
#: twelve core sites, and the nearest thing to four of them was a patch of
#: `ground_flowers` five metres away -- a keep-out that treats a bed of
#: petals like a castle wall does not protect approved work, it just refuses
#: to build. What must not be built over is stone, trunk and hedge.
_MASS_ASSETS = ("garden_wall", "retaining_wall", "balustrade", "hedge_block",
                "hedge_mass", "gate_pier", "gate_leaf", "garden_arch_stone",
                "tower_capped", "tree_mature_trunk", "tree_slender_trunk",
                "tree_clock_trunk", "mushroom_landmark", "mushroom_giant",
                "fountain_basin", "heart_topiary", "tea_plinth", "facade_panel",
                "topiary_cone_plain", "topiary_cone_roses", "topiary_spiral")


def _district_mass():
    """Golden Arrival's own authored mass, for a keep-out.

    A generated site must not be laid on top of ground the founder has already
    judged. `_separate` knows about quarters and nothing else, so without this
    the core belt would happily stand a tower in the left flank's rose walk.
    """
    pts = []
    for band in (FOREGROUND, GARDEN, PALACE, FLANK_GROUND, FLANKS, REARWORLD,
                 CAM_FOREGROUNDS):
        for it in band:
            if it["asset"].startswith("castle_") or it["asset"] in _MASS_ASSETS:
                pts.append((it["pos"][0], it["pos"][1]))
    return pts


_DISTRICT_MASS = _district_mass()


def _district_clear(x, y, reach):
    for (px, py) in _DISTRICT_MASS:
        if (px - x) ** 2 + (py - y) ** 2 < reach * reach:
            return False
    return True


#: How far Golden Arrival reaches on each bearing, in 24 sectors of 15 deg.
#:
#: Roads used to leave the district at a flat 8,000 uu on every bearing. The
#: district is not round: measured, its walkable mass ends between 66 m and
#: 117 m depending on where you stand, so that one number started a road
#: fifteen metres short of the garden in some bearings and fifty metres inside
#: it in others. Each road now leaves from its own bearing's edge.
#:
#: WHAT THIS DID NOT DO, because the first version of this comment claimed it
#: would: it did not close the 50-75 m density trough. AS BUILT that band
#: holds 282 placements per hectare against 723 inside it and 305 outside --
#: a shallow dip now rather than the 391-against-720 step it was, but still a
#: dip, and this measurement is why it stays one: the band is INSIDE the
#: district on every bearing, so the thin ring is Golden Arrival's own
#: outskirt and not a gap between the district and the quarters. Closing it
#: means re-planting approved ground, and it is carried in WORLD_LEDGER.md as
#: its own item rather than fixed here by stealth.
def _district_edge():
    # THE WALKABLE DISTRICT, not everything the district band holds. Measured
    # against `_DISTRICT_MASS` this read 79-158 m, because that list carries
    # PALACE -- the castle focal plane at 95-140 m and the far city beyond it.
    # Roads then started past the quarters they were meant to reach. The edge
    # a road leaves from is the edge of the ground somebody walks on.
    ground = []
    for band in (FOREGROUND, GARDEN, FLANK_GROUND, FLANKS, REARWORLD, CAM_FOREGROUNDS):
        for it in band:
            if it["asset"].startswith("castle_") or it["asset"] in _MASS_ASSETS:
                ground.append((it["pos"][0], it["pos"][1]))
    edge = [4800.0] * 24
    for (px, py) in ground:
        r = math.hypot(px, py)
        if r < 1500.0 or r > 16000.0:
            continue
        k = int((math.degrees(math.atan2(py, px)) % 360.0) // 15.0)
        for kk in (k - 1, k, k + 1):        # a road clears its neighbours too
            edge[kk % 24] = max(edge[kk % 24], r)
    return edge


_DISTRICT_EDGE = _district_edge()


def _edge_at(bearing_deg):
    return _DISTRICT_EDGE[int(bearing_deg % 360.0 // 15.0)] + 400.0


def _site(prefix, qi, x, y, seed, spoke=None):
    """One site, with its kind and its district taken from where it stands."""
    district, kind = _district_of(x, y)
    return {"x": float(x), "y": float(y), "kind": kind, "seed": seed,
            "district": district, "tag": "%s%02d_%s" % (prefix, qi, kind),
            "spoke": spoke}


def _all_sites():
    """Every quarter in the world, as one table, in one order."""
    sites = []
    for qi, (bearing, radius, _kind) in enumerate(_QUARTERS):
        a = math.radians(bearing)
        sites.append(_site("Q", qi, math.cos(a) * radius, math.sin(a) * radius,
                           7000 + 137 * qi, spoke=bearing))
    for qi, (cx, cy, _kind, seed) in enumerate(_QUARTER_SITES):
        sites.append(_site("S", qi, cx, cy, seed))
    for qi, (cx, cy, _kind, seed) in enumerate(CORE_SITES):
        s = _site("C", qi, cx, cy, seed)
        if not _district_clear(cx, cy, _reach(s["kind"], HIER(cx, cy)) * 0.62):
            SITE_NOTES.append("core belt C%02d skipped: Golden Arrival stands there" % qi)
            continue
        sites.append(s)
    for qi, (cx, cy, _kind, seed) in enumerate(DISTANCE_SITES):
        sites.append(_site("D", qi, cx, cy, seed))
    return _separate(sites)


SITES = _all_sites()

_QUARTER_BUILDERS = {"garden": _quarter_garden, "towers": _quarter_towers,
                     "grove": _quarter_grove, "wood": _quarter_wood,
                     "clockyard": _quarter_clockyard, "water": _quarter_water,
                     "tea": _quarter_tea, "court": _quarter_court,
                     "hamlet": _quarter_hamlet, "meadow": _quarter_meadow}


def _quarter_edge(s, H):
    """The band that turns a quarter into a PLACE with an outside.

    The founder's list for a place is identity, landmark, path, secondary
    structure, vegetation, EDGE, destination -- and the edge is the one every
    kind was missing. The boards never show a garden that simply stops: there
    is a hedge line, a rank of trees, a drift of planting, and then the
    country. Written once and applied to all ten kinds from `_outer_world`,
    because an edge is a property of being a quarter rather than of being a
    clockyard.

    It is also where the density went. The district kinds are lighter than the
    three they replaced -- a tea terrace is not a 106-piece parterre -- and the
    right answer is not to make a tea terrace into a parterre, it is to give
    every quarter the surround it should have had.
    """
    cx, cy, seed, tag, kind = s["x"], s["y"], s["seed"], s["tag"], s["kind"]
    sgn = 1 if cx >= 0 else -1
    sp, sc = H["spacing"], H["scale"]
    r0 = s.get("reach", _reach(kind, H)) * 0.80
    out = []
    # A BROKEN RING, not a fence: gaps where the ways come in, and three
    # kinds of green so it reads as planting rather than as a wall.
    n = _n(11, 0.55 + 0.85 * H["veg"], 5, 18)
    for i in range(n):
        a = 6.283 * i / n + 0.6 * _rnd(i, seed, 71)
        if _rnd(i, seed, 72) < 0.22:
            continue                          # the gaps
        r = r0 * (0.94 + 0.22 * _rnd(i, seed, 73))
        x, y = cx + math.cos(a) * r, cy + math.sin(a) * r
        pick = _rnd(i, seed, 74)
        if pick < 0.34:
            t = (1.0 + 0.45 * _rnd(i, seed, 75)) * sc
            out += [
                A("tree_slender_trunk", x, y, 0, yaw=_rnd(i, seed, 76) * 360.0, s=t,
                  mat="MI_V2_Bark", label="%s_EdgeTrunk%d" % (tag, i)),
                A("canopy_medium", x, y, 800.0 * t, yaw=_rnd(i, seed, 77) * 360.0,
                  s=t * 1.25, mat=("MI_V2_LeafMid", "MI_V2_LeafDark", "MI_V2_LeafLight")[i % 3],
                  label="%s_EdgeCanopy%d" % (tag, i)),
            ]
        elif pick < 0.72:
            out.append(A("hedge_mass", x, y, 0, yaw=math.degrees(a) + 90.0,
                         s=(1.0 + 0.5 * _rnd(i, seed, 78)) * sc,
                         mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2],
                         label="%s_EdgeHedge%d" % (tag, i)))
        else:
            out.append(A(("shrub_flowering", "rose_bush", "topiary_ball")[i % 3], x, y, 0,
                         yaw=_rnd(i, seed, 79) * 360.0,
                         s=(0.85 + 0.35 * _rnd(i, seed, 80)) * sc,
                         mat=("MI_V2_LeafMid", "MI_V2_LeafDark")[i % 2],
                         label="%s_EdgeShrub%d" % (tag, i)))
    # colour at the foot of it -- the boards' beds are always AGAINST the green
    for i in range(_n(5, 0.5 + 0.9 * H["veg"], 2, 9)):
        a = 6.283 * _rnd(i, seed, 81)
        r = r0 * (0.70 + 0.16 * _rnd(i, seed, 82))
        out += _ground_patch(cx + math.cos(a) * r, cy + math.sin(a) * r, 0,
                             _rnd(i, seed, 83) * 360.0, 1.1,
                             ("MI_V2_PetalPink", "MI_V2_PetalViolet", "MI_V2_PetalWhite",
                              "MI_V2_Lavender", "MI_V2_RosePink")[i % 5],
                             "%s_EdgeBed%d" % (tag, i))
    # AND A WAY IN. Every quarter gets a short paved approach on the bearing
    # its road arrives from, with a marker either side, so a destination reads
    # as a destination from outside it.
    if H["prop"] > 0.22:
        d = math.hypot(cx, cy) or 1.0
        ux, uy = -cx / d, -cy / d               # toward the district
        px, py = cx + ux * r0 * 1.06, cy + uy * r0 * 1.06
        yaw = math.degrees(math.atan2(uy, ux))
        out.append(A("terrace_platform", px, py, -18.0, yaw=yaw,
                     sxyz=(0.62 * sp, 0.24 * sp, 0.35), mat="MI_V2_PlazaCream",
                     label="%s_Approach" % tag))
        for k, side in enumerate((-1, 1)):
            ox = px - uy * 210.0 * sc * side
            oy = py + ux * 210.0 * sc * side
            out += [
                A("gate_pier", ox, oy, 0, yaw=yaw, s=0.62 * sc, mat="MI_V2_IvoryStone",
                  label="%s_ApproachPier%d" % (tag, k)),
                A("gate_finial_ball", ox, oy, 300.0 * 0.62 * sc, s=0.4 * sc,
                  mat="MI_V2_Gold", label="%s_ApproachFinial%d" % (tag, k)),
            ]
    return out


def _road_verge(x0, y0, x1, y1, tag, seed):
    """What grows beside a way.

    ROAD-SIDE ACTIVATION, and the reason it is here rather than in a quarter:
    the band from the district's edge out to the first quarters measured 338
    placements per hectare against 762 inside it and 549 beyond, and the only
    built thing that crosses that band is the roads. Planting their verges
    thickens exactly the ground that is thin, ties the quarters back to Golden
    Arrival along the routes a walker actually uses, and adds nothing to the
    open country between the spokes -- which is meant to stay open.

    Density comes from the hierarchy at each point, so a verge near the plaza
    is a planted avenue and the same call at 300 m lays almost nothing.
    """
    out = []
    d = math.hypot(x1 - x0, y1 - y0)
    n = int(d / 900.0)
    for i in range(n):
        t = (i + 0.5) / n
        px, py = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        H = HIER(px, py)
        if _rnd(i, seed, 51) > 0.35 + 0.75 * H["score"]:
            continue
        nx, ny = -(y1 - y0) / d, (x1 - x0) / d
        for side in (-1, 1):
            off = (260.0 + 190.0 * _rnd(i, seed, 52)) * side
            vx, vy = px + nx * off, py + ny * off
            pick = _rnd(i, seed + side, 53)
            if pick < 0.30 * H["veg"]:
                s = (1.0 + 0.25 * _rnd(i, seed, 54)) * H["scale"]
                out += [
                    A("tree_slender_trunk", vx, vy, 0, yaw=_rnd(i, seed, 55) * 360.0,
                      s=s, mat="MI_V2_Bark", label="%s_VergeTrunk%d_%d" % (tag, i, side)),
                    A("canopy_medium", vx, vy, 800 * s, yaw=_rnd(i, seed, 56) * 360.0,
                      s=s * 1.15, mat=("MI_V2_LeafMid", "MI_V2_LeafLight")[i % 2],
                      label="%s_VergeCanopy%d_%d" % (tag, i, side)),
                ]
            elif pick < 0.55:
                out.append(A(("shrub_flowering", "topiary_ball", "hedge_mass")[i % 3],
                             vx, vy, 0, yaw=_rnd(i, seed, 57) * 360.0,
                             s=(0.85 + 0.4 * _rnd(i, seed, 58)) * H["scale"],
                             mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[side > 0],
                             label="%s_VergeShrub%d_%d" % (tag, i, side)))
            elif pick < 0.72 and H["prop"] > 0.40:
                out += [
                    A("pedestal_finial", vx, vy, 0, s=0.7, mat="MI_V2_IvoryStone",
                      label="%s_VergePost%d_%d" % (tag, i, side)),
                    A("gate_finial_ball", vx, vy, 100, s=0.42, mat="MI_V2_Gold",
                      label="%s_VergeLamp%d_%d" % (tag, i, side)),
                ]
            elif pick < 0.86 and H["veg"] > 0.55:
                out += _ground_patch(vx, vy, 0, _rnd(i, seed, 59) * 360.0, 1.0,
                                     ("MI_V2_PetalViolet", "MI_V2_PetalWhite",
                                      "MI_V2_PetalPink")[i % 3],
                                     "%s_VergeBed%d_%d" % (tag, i, side))
    return out


def _road_tree(sites):
    """Roads that reach EVERYTHING, by construction rather than by hope.

    The first outer world gave every quarter its own spoke from the district
    edge, which is a wheel: twelve places you can reach from the plaza and
    none you can reach from each other. A ring was added for the twelve, and
    the twenty audit sites got spokes and no ring at all.

    So instead: every quarter is joined to the nearest quarter CLOSER TO THE
    DISTRICT than itself (the innermost joins the district edge). That is a
    tree rooted at Golden Arrival, so connectivity is a property of the
    construction and not something to be discovered by a walk -- and because
    each link goes to a real neighbour rather than radially inward, the
    network branches like a road network instead of radiating like a wheel.
    The ring legs then close the loops, which is what makes it a circuit.
    """
    out = []
    order = sorted(range(len(sites)), key=lambda i: math.hypot(sites[i]["x"], sites[i]["y"]))
    for n, i in enumerate(order):
        s = sites[i]
        r = math.hypot(s["x"], s["y"]) or 1.0
        H = HIER(s["x"], s["y"])
        width = 200.0 + 180.0 * H["score"]
        reach = _reach(s["kind"], H)
        best, bd = None, 1e18
        for j in order[:n]:
            t = sites[j]
            d = math.hypot(s["x"] - t["x"], s["y"] - t["y"])
            if d < bd:
                best, bd = t, d
        if best is None or bd > r * 0.95:
            # nothing nearer than the district itself: come straight in, from
            # the district's own edge on this bearing rather than a flat radius
            ux, uy = s["x"] / r, s["y"] / r
            start = min(_edge_at(math.degrees(math.atan2(s["y"], s["x"]))), r - 900.0)
            x0, y0 = ux * start, uy * start
        else:
            tr = _reach(best["kind"], HIER(best["x"], best["y"]))
            d = bd or 1.0
            ux, uy = (s["x"] - best["x"]) / d, (s["y"] - best["y"]) / d
            x0, y0 = best["x"] + ux * tr, best["y"] + uy * tr
        d = math.hypot(s["x"] - x0, s["y"] - y0) or 1.0
        ux, uy = (s["x"] - x0) / d, (s["y"] - y0) / d
        x1, y1 = s["x"] - ux * reach, s["y"] - uy * reach
        if math.hypot(x1 - x0, y1 - y0) < 600.0:
            continue
        # a far road is a line on the ground at 300 m: fewer, longer segments
        seg = 1400.0 if H["score"] > 0.45 else 2800.0
        out += _road(x0, y0, x1, y1, width, "%s_Road" % s["tag"],
                     n=max(1, int(math.hypot(x1 - x0, y1 - y0) / seg)))
        out += _road_verge(x0, y0, x1, y1, s["tag"], s["seed"])
        # a threshold where the road meets the quarter, while it can be read
        if H["prop"] > 0.35:
            tx, ty = s["x"] - ux * (reach + 250.0), s["y"] - uy * (reach + 250.0)
            out += [
                A("garden_arch_stone", tx, ty, 220,
                  yaw=math.degrees(math.atan2(uy, ux)) + 90.0, s=0.9,
                  mat="MI_V2_IvoryStone", label="%s_Threshold" % s["tag"]),
                A("gate_finial_ball", tx, ty, 470, s=0.55, mat="MI_V2_Gold",
                  label="%s_ThresholdFinial" % s["tag"]),
            ]
    return out


#: The way's own waypoints, exported so the audit reads them rather than
#: keeping a second copy: walkable.py had one, the route was re-solved, and
#: the tool spent two runs reporting a turn the world no longer had.
NORTH_WAY = ((-25.0, 6925.0), (425.0, 9475.0), (1775.0, 11275.0), (1175.0, 15025.0),
             (2075.0, 16375.0), (1175.0, 18175.0), (-25.0, 18925.0), (125.0, 20125.0),
             (1025.0, 20725.0), (9875.0, 19225.0), (10925.0, 20875.0), (11075.0, 23125.0))


def _crosses_quarter(x0, y0, x1, y1, sites, skip=1200.0):
    """Does this leg pass through a quarter it does not end at?

    Written once because three different road builders need it and the first
    two each learned it the hard way -- the road audit found a ring leg
    through C40_clockyard, and the north way's first draft went through an
    approved hedge wall.
    """
    bx, by = x1 - x0, y1 - y0
    ll = bx * bx + by * by or 1.0
    for s in sites:
        if math.hypot(s["x"] - x0, s["y"] - y0) < skip or \
           math.hypot(s["x"] - x1, s["y"] - y1) < skip:
            continue
        t = max(0.0, min(1.0, ((s["x"] - x0) * bx + (s["y"] - y0) * by) / ll))
        d = math.hypot(s["x"] - (x0 + t * bx), s["y"] - (y0 + t * by))
        if d < _body(s["kind"], _squeezed(HIER(s["x"], s["y"]),
                                          s.get("squeeze", 1.0))) * 0.85:
            return True
    return False


def _district_lanes(sites):
    """LANES INSIDE A DISTRICT, so a district is a neighbourhood.

    The road tree joins every quarter to the nearest one closer in, and the
    ring closes loops at two radii. Both are about getting ACROSS the world.
    Neither makes the seven clockyards of the Clock Quarter feel like one
    place: they are seven separate destinations that happen to share a name.

    A lane is narrower than a road (1.8 m against 3), it links quarters of the
    same district in a nearest-neighbour chain, and it skips any leg that
    would cross a third quarter or that a road already covers. The boards'
    stone-path panel is exactly this: the narrow way between two garden rooms,
    not the avenue between two districts.
    """
    by_district = {}
    for s in sites:
        by_district.setdefault(s.get("district", "?"), []).append(s)
    out = []
    n_lane = 0
    for name, group in sorted(by_district.items()):
        if len(group) < 2:
            continue
        # a nearest-neighbour chain from the innermost, which is how a
        # neighbourhood actually grew rather than how a graph is drawn
        rest = sorted(group, key=lambda s: math.hypot(s["x"], s["y"]))
        chain = [rest.pop(0)]
        while rest:
            last = chain[-1]
            nxt = min(rest, key=lambda s: math.hypot(s["x"] - last["x"], s["y"] - last["y"]))
            rest.remove(nxt)
            chain.append(nxt)
        for i in range(len(chain) - 1):
            a, b = chain[i], chain[i + 1]
            d = math.hypot(b["x"] - a["x"], b["y"] - a["y"])
            if d > 16000.0:
                continue                      # not a lane, a journey
            ra = _reach(a["kind"], _squeezed(HIER(a["x"], a["y"]), a.get("squeeze", 1.0)))
            rb = _reach(b["kind"], _squeezed(HIER(b["x"], b["y"]), b.get("squeeze", 1.0)))
            ux, uy = (b["x"] - a["x"]) / d, (b["y"] - a["y"]) / d
            x0, y0 = a["x"] + ux * ra * 0.92, a["y"] + uy * ra * 0.92
            x1, y1 = b["x"] - ux * rb * 0.92, b["y"] - uy * rb * 0.92
            if math.hypot(x1 - x0, y1 - y0) < 900.0:
                continue                      # they already touch
            if _crosses_quarter(x0, y0, x1, y1, sites):
                continue
            n_lane += 1
            tag = "Lane%02d" % n_lane
            out += _road(x0, y0, x1, y1, 180.0, tag,
                         n=max(1, int(math.hypot(x1 - x0, y1 - y0) / 1800.0)))
            out += _road_verge(x0, y0, x1, y1, tag, 6100 + 23 * n_lane)
            # a waymark at each end, the garden version: a plinth and a ball
            for k, (px, py) in enumerate(((x0, y0), (x1, y1))):
                out += [
                    A("pedestal_finial", px - uy * 220.0, py + ux * 220.0, 0, s=0.62,
                      mat="MI_V2_IvoryStone", label="%s_Post%d" % (tag, k)),
                    A("gate_finial_ball", px - uy * 220.0, py + ux * 220.0, 88.0, s=0.36,
                      mat="MI_V2_Gold", label="%s_Ball%d" % (tag, k)),
                ]
    LANE_NOTES.append("district lanes: %d" % n_lane)
    return out


#: Filled by _district_lanes, printed by the layout gate.
LANE_NOTES = []


def _north_way():
    """THE WAY PAST THE CASTLE.

    Everything a walker can reach beyond the castle plane, they reach by going
    round -- the audit says every quarter is reachable and says nothing about
    whether a player would ever believe it. The approach ends AT the castle;
    the boards' world does not.

    So an authored route leaves the district on the castle's east shoulder,
    threads between the approved focal-plane groups (the easternmost stands at
    (5200, 12200), and this passes well outside it), and runs out to the East
    Reach. It is authored rather than generated because its whole job is to
    miss five specific approved masses and keep the castle sightline clear,
    which is a composition decision and not a rule.

    A gate where it leaves, markers along it, and lanterns at the turns: a
    road nobody can see the start of is not a destination, it is a shortcut.
    """
    # ROUTED, NOT DRAWN -- twice over, because the first attempt was drawn.
    #
    # Written by hand from the district's east shoulder, this ran straight
    # into the BeyondL hedge wall (seven pieces at x 7,229-7,571 from y 5,514
    # to 9,286) and walkable.py reported its first turn UNREACHABLE. Asked
    # instead for the route a walker takes, the flood came back going up the
    # castle approach and turning east behind the plane -- a different shape
    # entirely -- and squeezing past a court urn at 1.3 m, which is a walk and
    # not a road.
    #
    # So the corridor was solved rather than sampled: a widest-path search
    # (Dijkstra maximising the MINIMUM clearance) from the castle court to the
    # milestone, then simplified by extending each leg only while the straight
    # line still clears 250 uu. The answer is 2.6 m of clear air either side
    # for the whole run, which carries a 3 m road with a metre to spare, and
    # it says something the eye could not: the way past the castle goes UP THE
    # AXIS behind the focal plane and turns east at 200 m, because the flanks
    # and the beyond gardens close every other side.
    #
    # It starts at the CASTLE COURT, not at the plaza. The approach is already
    # the route from the plaza; this is what happens when you get there.
    way = NORTH_WAY
    out = []
    for i in range(len(way) - 1):
        (x0, y0), (x1, y1) = way[i], way[i + 1]
        out += _road(x0, y0, x1, y1, 280.0, "NorthWay%d" % i)
        out += _road_verge(x0, y0, x1, y1, "NorthWay%d" % i, 4400 + 17 * i)
        # a lantern pair at every turn, so the way reads at dusk and at range
        for k, side in enumerate((-1, 1)):
            dx, dy = x1 - x0, y1 - y0
            d = math.hypot(dx, dy) or 1.0
            nx, ny = -dy / d, dx / d
            out += [
                A("pedestal_finial", x1 + nx * 300.0 * side, y1 + ny * 300.0 * side, 0,
                  s=0.9, mat="MI_V2_IvoryStone", label="NorthWay%d_Post%d" % (i, k)),
                A("gate_finial_ball", x1 + nx * 300.0 * side, y1 + ny * 300.0 * side, 128.0,
                  s=0.55, mat="MI_V2_Gold", label="NorthWay%d_Lamp%d" % (i, k)),
            ]
    # THE NORTH GATE, where it leaves the court: the same gold language as the
    # arrival gate, at the scale of a garden gate rather than a portal
    gx, gy = way[0]
    yaw = math.degrees(math.atan2(way[1][1] - gy, way[1][0] - gx)) + 90.0
    c, s0 = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    for k, side in enumerate((-1, 1)):
        px, py = gx + c * 260.0 * side, gy + s0 * 260.0 * side
        out += [
            A("gate_pier", px, py, 0, yaw=yaw, s=1.0, mat="MI_V2_IvoryStone",
              label="NorthGate_Pier%d" % k),
            A("gate_finial_ball", px, py, 300.0, s=0.7, mat="MI_V2_Gold",
              label="NorthGate_Finial%d" % k),
        ]
    out += [
        A("gate_arch_gold", gx, gy, 0, yaw=yaw, s=0.95, mat="MI_V2_Gold",
          label="NorthGate_Arch"),
        A("garden_urn", gx + c * 620.0, gy + s0 * 620.0, 0, s=0.85, mat="MI_V2_Ceramic",
          label="NorthGate_UrnL"),
        A("garden_urn", gx - c * 620.0, gy - s0 * 620.0, 0, s=0.85, mat="MI_V2_Ceramic",
          label="NorthGate_UrnR"),
    ]
    # and a MILESTONE at the far end, so the way arrives somewhere named
    ex, ey = way[-1]
    out += [
        A("stone_ring_base", ex, ey, -2, s=1.4, mat="MI_V2_Stone",
          label="NorthWay_EndRing"),
        A("pedestal_finial", ex, ey, 0, s=1.6, mat="MI_V2_IvoryStone",
          label="NorthWay_EndPlinth"),
        A("clock_ornate", ex, ey, 240.0, yaw=250.0, s=1.8, mat="MI_V2_Gold",
          label="NorthWay_EndClock"),
        A("garden_arch_stone", ex - 300.0, ey - 900.0, 220, yaw=250.0, s=1.0,
          mat="MI_V2_IvoryStone", label="NorthWay_EndArch"),
    ]
    return out


def _ring_roads(sites):
    """The legs that close the loops, at two radii.

    A tree reaches everything and still means every journey is out and back.
    Adjacent quarters at similar radius are joined so the outer world is a
    circuit, at the inner ring and again in the far band -- and the leg that
    would cross the castle approach is skipped at both, because that sightline
    is approved work.
    """
    out = []
    for band, (lo, hi, width) in enumerate(((9000.0, 17000.0, 240.0),
                                            (17000.0, 34000.0, 200.0))):
        ring = []
        for s in sites:
            r = math.hypot(s["x"], s["y"])
            if lo <= r < hi:
                ring.append((math.degrees(math.atan2(s["y"], s["x"])) % 360.0,
                             s["x"], s["y"]))
        ring.sort()
        for i in range(len(ring)):
            _b0, x0, y0 = ring[i]
            _b1, x1, y1 = ring[(i + 1) % len(ring)]
            if (x0 * x1 < 0) and (y0 > 6000 and y1 > 6000):
                continue                      # never across the castle approach
            if math.hypot(x1 - x0, y1 - y0) > 22000.0:
                continue                      # not a leg, a shortcut across the world
            # AND NOT THROUGH A THIRD QUARTER. A ring leg is a straight line
            # between two centres and a straight line between two centres can
            # cross somebody else's court -- the road audit found one going
            # through C40_clockyard. The road tree is safe from this because
            # it joins neighbours; the ring is not.
            crosses = False
            for s in sites:
                if math.hypot(s["x"] - x0, s["y"] - y0) < 600.0 or \
                   math.hypot(s["x"] - x1, s["y"] - y1) < 600.0:
                    continue                  # an endpoint: the road serves it
                bx, by = x1 - x0, y1 - y0
                ll = bx * bx + by * by or 1.0
                t = max(0.0, min(1.0, ((s["x"] - x0) * bx + (s["y"] - y0) * by) / ll))
                if math.hypot(s["x"] - (x0 + t * bx), s["y"] - (y0 + t * by)) < \
                        _body(s["kind"], _squeezed(HIER(s["x"], s["y"]),
                                                   s.get("squeeze", 1.0))) * 0.85:
                    crosses = True
                    break
            if crosses:
                continue
            out += _road(x0, y0, x1, y1, width, "RingRoad%d_%02d" % (band, i))
            if band == 0:
                out += [
                    A("pedestal_finial", x0, y0 - 900.0, 0, s=0.9, mat="MI_V2_IvoryStone",
                      label="RingMarker%02d" % i),
                    A("gate_finial_ball", x0, y0 - 900.0, 124, s=0.55, mat="MI_V2_Gold",
                      label="RingMarkerCap%02d" % i),
                ]
    return out


def _outer_world():
    out = []
    for s in SITES:
        H = _squeezed(HIER(s["x"], s["y"]), s.get("squeeze", 1.0))
        sgn = 1 if s["x"] >= 0 else -1
        out += _QUARTER_BUILDERS[s["kind"]](s["x"], s["y"], sgn, s["seed"], s["tag"], H=H)
        out += _quarter_edge(s, H)
    out += _road_tree(SITES)
    out += _ring_roads(SITES)
    out += _district_lanes(SITES)
    out += _north_way()
    out += _country()
    out += _district_cam_foregrounds()
    protected = [it for band in (FOREGROUND, GARDEN, PALACE, FLANK_GROUND, FLANKS,
                                 REARWORLD, CAM_FOREGROUNDS)
                 for it in band if it["asset"] in _PROTECT]
    return _declutter(out, also=protected)


# ---------------------------------------------------------------------------
# WHAT THE DISTRICT CAMERAS STAND IN
# ---------------------------------------------------------------------------
#
# The eight new cameras were placed at the distance their SUBJECT needs, and
# camera_framing immediately said what that costs: 2 to 19 placements in the
# near band, against 42 for the flank cameras that were built for. A frame
# whose bottom third is bare lawn reads as a screenshot of an asset, not as a
# place -- which is the exact failure PASS 09-12 spent three passes on.
#
# This is that fix done once, in arithmetic rather than by eye. For every
# camera tagged as a district camera it reads the camera's OWN transform,
# computes where its picture of the ground begins
#
#     d_near = eye_z / tan(-(pitch - vfov/2))
#
# and lays a clump between there and 2.6x it, inside the visible half-width
# (which at 90 deg fov equals the depth), on both sides of the axis with the
# middle left open so the subject is never hidden. Nothing it places can be
# under a lens, because the lens is what decides where it goes.

#: Cameras that get one. The eight world/district cameras; Golden Arrival's
#: own eleven are authored ground and are not touched.
_CAM_FOREGROUND_TAGS = ("HeroCam13", "HeroCam14", "HeroCam15", "HeroCam16",
                        "HeroCam17", "HeroCam18", "HeroCam20")


def _district_cam_foregrounds():
    try:
        import v2_config as _C
    except Exception:                          # the layout must import alone
        return []
    out = []
    aspect = 16.0 / 9.0
    for cam in getattr(_C, "HERO_CAMS", ()):
        tags = tuple(cam.get("tags", ()))
        if not any(t in _CAM_FOREGROUND_TAGS for t in tags):
            continue
        x, y, z = cam["location"]
        pitch, yaw = cam["rotation"][0], cam["rotation"][1]
        hfov = math.radians(float(cam["fov"]))
        vfov = 2.0 * math.atan(math.tan(hfov / 2.0) / aspect)
        lower = math.radians(pitch) - vfov / 2.0
        if lower >= -1e-6:
            continue
        d_near = z / math.tan(-lower)
        fwd = (math.cos(math.radians(yaw)), math.sin(math.radians(yaw)))
        side = (-fwd[1], fwd[0])
        seed = int(abs(x) + abs(y)) % 9973
        tag = cam["name"]
        n = 13
        for i in range(n):
            # depth 1.15x to 2.6x d_near; the near end is the bottom of frame
            t = 1.15 + 1.45 * _rnd(i, seed, 121)
            depth = d_near * t
            # off-axis, but never across the middle third: the subject is there
            half = depth * math.tan(hfov / 2.0)
            lat = (0.34 + 0.52 * _rnd(i, seed, 122)) * half * (1 if i % 2 else -1)
            px = x + fwd[0] * depth + side[0] * lat
            py = y + fwd[1] * depth + side[1] * lat
            pick = _rnd(i, seed, 123)
            if pick < 0.30:
                s = 1.0 + 0.35 * _rnd(i, seed, 124)
                out += [
                    A("tree_slender_trunk", px, py, 0, yaw=_rnd(i, seed, 125) * 360.0,
                      s=s, mat="MI_V2_Bark", label="%s_FgTrunk%d" % (tag, i)),
                    A("canopy_medium", px, py, 800.0 * s, yaw=_rnd(i, seed, 126) * 360.0,
                      s=s * 1.2, mat=("MI_V2_LeafMid", "MI_V2_LeafDark")[i % 2],
                      label="%s_FgCanopy%d" % (tag, i)),
                ]
            elif pick < 0.58:
                out.append(A(("shrub_flowering", "rose_bush", "topiary_ball")[i % 3],
                             px, py, 0, yaw=_rnd(i, seed, 127) * 360.0,
                             s=0.85 + 0.4 * _rnd(i, seed, 128),
                             mat=("MI_V2_LeafMid", "MI_V2_LeafDark")[i % 2],
                             label="%s_FgShrub%d" % (tag, i)))
            elif pick < 0.82:
                out += _ground_patch(px, py, 0, _rnd(i, seed, 129) * 360.0, 1.15,
                                     ("MI_V2_PetalPink", "MI_V2_PetalViolet",
                                      "MI_V2_PetalWhite", "MI_V2_Lavender")[i % 4],
                                     "%s_FgBed%d" % (tag, i))
            else:
                out.append(A("hedge_mass", px, py, 0,
                             yaw=math.degrees(math.atan2(side[1], side[0])),
                             s=1.0 + 0.4 * _rnd(i, seed, 130),
                             mat="MI_V2_LeafDark", label="%s_FgHedge%d" % (tag, i)))
    return out


#: THE GROUND BETWEEN THE QUARTERS. The world render shows one flat green
#: plane from the district out to the horizon -- the moss terrain slab, a
#: single 3 km quad with a single material, which is why everything between
#: the quarters reads as a golf course however good the quarters are.
#: garden_lawn exists for exactly this: 60 x 72 m of 48 x 48 grid displaced by
#: low-frequency noise, and its own docstring says a flat plane here is "the
#: founder's flat colour in one actor".
#:
#: Twenty-eight of them across the ring on a jittered grid, alternating
#: between the lawn and moss tints and turned so the seams do not line up.
#: This is texture and tonal variation over ~10 hectares for twenty-eight
#: actors -- the cheapest large-area improvement left in the world.
# ---------------------------------------------------------------------------
# THE COUNTRY BETWEEN THE QUARTERS
# ---------------------------------------------------------------------------
#
# The far band holds about twenty quarters and no more, and that is not a
# limitation to be tuned away: it is the spacing the tier's own rule asks for,
# and packing it tighter would make the horizon as busy as the core. But
# twenty places across 26 hectares still leaves 26,000 m2 that is empty by its
# OWN tier's tolerance, and the reference boards are emphatic about what is
# out there -- not more districts, LANDSCAPE. Tree masses, hedgerow lines,
# drifts of colour, and now and then one silhouette standing clear.
#
# So: a jittered grid over the whole outer world, its density read from
# `HIER`, skipping anything near a quarter (they are the strong bits and stay
# strong) and anything on the castle sightline. Every piece of it is in an
# instanced batch, so ~1,200 placements cost single-digit draw calls.

#: uu. The grid the country is scattered on, before jitter.
_COUNTRY_CELL = 3800.0
#: How close to a quarter the country stops, as a multiple of the quarter's
#: BODY. Measured against its REACH at 1.25 this excluded 80 of 92 candidate
#: cells -- a far wood's reach is 59 m and the grid was 52 m, so nearly every
#: cell in the outer world sat inside some quarter's exclusion and the country
#: layer produced twelve clusters. A quarter's body is what country must not
#: be laid on top of; its reach is where its own outermost tree already is.
_COUNTRY_CLEAR = 1.05


#: MEASURED plan half-footprints (half_x, half_y) in uu at scale 1, from the
#: recipe contact sheets. This lived in tools/walkable.py, which imports it
#: from here now: the layout needs the same numbers to keep its own pieces out
#: of each other, and two copies of a measured table is the "two descriptions
#: of one quantity" trap this project has already paid for twice.
FOOT = {"hedge_block": (176, 75), "hedge_mass": (320, 320), "garden_wall": (255, 50),
        "retaining_wall": (255, 50), "gate_pier": (95, 95), "gate_leaf": (210, 40),
        "pedestal_finial": (35, 35), "garden_urn": (55, 55), "planter_box": (105, 105),
        "topiary_cone_plain": (115, 120), "topiary_cone_roses": (115, 120),
        "topiary_ball": (93, 92), "topiary_spiral": (95, 95), "heart_topiary": (589, 199),
        "tree_mature_trunk": (105, 105), "tree_slender_trunk": (55, 55),
        "tree_clock_trunk": (170, 170), "mushroom_landmark": (150, 150),
        # THE STEM, NOT THE CAP. The cap is 20 m across and 13 m in the air;
        # what a walker meets and what a hedge could grow through is the 3.5 m
        # stem. Set to the cap radius this made three Golden Arrival
        # destinations unreachable in one edit.
        "mushroom_giant": (260, 260), "mushroom_medium": (90, 90),
        "fountain_basin": (300, 300), "balustrade": (255, 40),
        "castle_tower": (400, 400), "castle_hall": (600, 600), "tower_capped": (400, 400),
        "tower_clock": (176, 176), "column_ornate": (60, 60), "arch_stone": (330, 90),
        "tea_plinth": (200, 200), "stairs_broad": (350, 260),
        "rose_bush": (98, 105), "shrub_flowering": (90, 90)}

#: What must not have something growing through it. A landmark is the reason a
#: place is a place, and the scatter that dresses a quarter's edge does not
#: know what its neighbour already stands on.
_PROTECT = ("mushroom_giant", "mushroom_landmark", "tower_capped", "tower_clock",
            "castle_tower", "castle_tower_square", "castle_tower_octagon",
            "castle_tower_slender", "castle_hall", "castle_dome", "castle_arcade",
            "fountain_basin", "heart_topiary", "tea_plinth", "column_ornate",
            "arch_stone", "gate_arch_gold", "clock_ornate")
#: What may be removed to protect one. Cheap, repeatable, and there is always
#: more of it: the hedge is filler, the landmark is the point.
_SOFT = ("hedge_mass", "hedge_block", "shrub_flowering", "topiary_ball", "rose_bush",
         "ground_flowers", "ground_blooms", "flower_cluster", "blossom_cluster",
         "lavender_heads", "canopy_large", "canopy_medium", "tree_mature_trunk",
         "tree_slender_trunk", "mushroom_small", "mushroom_medium")


def _declutter(items, also=()):
    """Remove scatter that has grown through a landmark.

    The edge dressing and the country layer both place hedges and trees by
    hash, and neither can see what a NEIGHBOURING quarter put down: the
    hierarchy audit's embedded-landmark check found fifteen of them at once --
    a giant mushroom inside a hedgerow, a castle dome inside a hedge planted
    by a country cluster forty metres away. Removing the hedge is the right
    repair, and it is a filter rather than another placement rule, so it
    cannot itself introduce a third thing to go wrong.
    """
    # GOLDEN ARRIVAL'S LANDMARKS ARE GUARDS TOO. The filter first ran over the
    # outer world alone and three of its hedges were still standing through
    # approved work -- Avenue_TowerL, a City18 tower, the rear world's
    # mushroom -- because the district's own pieces were not in the list. A
    # protection rule that only knows about the thing it just built protects
    # the wrong half of the world.
    guard = []
    for it in list(items) + list(also):
        a = it["asset"]
        if a not in _PROTECT:
            continue
        sc = it["scale"]
        sx, sy = (abs(sc[0]), abs(sc[1])) if isinstance(sc, (list, tuple)) else (abs(sc), abs(sc))
        hx, hy = FOOT.get(a, (200, 200))
        guard.append((it["pos"][0], it["pos"][1], hx * sx, hy * sy,
                      math.radians(it["rot"][1])))
    if not guard:
        return items
    cell = 2400.0
    grid = {}
    for g in guard:
        reach = math.hypot(g[2], g[3]) + 700.0     # room for the soft piece's pad
        i0, i1 = int((g[0] - reach) // cell), int((g[0] + reach) // cell)
        j0, j1 = int((g[1] - reach) // cell), int((g[1] + reach) // cell)
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                grid.setdefault((i, j), []).append(g)
    # THE TWO FOOTPRINTS OVERLAP, not "the small one's centre is inside the
    # big one". A hedge_mass is 3.2 m across and a tower_capped is 4 m: the
    # hedge's centre can sit outside the tower while the tower's centre sits
    # inside the hedge, which is precisely what the audit kept reporting and
    # what a containment test cannot see. Expanding the guard by the soft
    # piece's own half-size is the Minkowski sum, and it is symmetric.
    out, cut = [], 0
    for it in items:
        a = it["asset"]
        if a in _SOFT:
            sc = it["scale"]
            sx, sy = (abs(sc[0]), abs(sc[1])) if isinstance(sc, (list, tuple)) else (abs(sc), abs(sc))
            fx, fy = FOOT.get(a, (90, 90))
            pad = max(fx * sx, fy * sy) * 0.85
            x, y = it["pos"][0], it["pos"][1]
            hit = False
            for (gx, gy, hx, hy, yaw) in grid.get((int(x // cell), int(y // cell)), ()):
                dx, dy = x - gx, y - gy
                c, s = math.cos(yaw), math.sin(yaw)
                if abs(dx * c + dy * s) <= hx + pad and abs(-dx * s + dy * c) <= hy + pad:
                    hit = True
                    break
            if hit:
                cut += 1
                continue
        out.append(it)
    DECLUTTER_NOTES.append("declutter: %d scatter pieces removed from inside %d landmarks"
                           % (cut, len(guard)))
    return out


#: Filled by _declutter, printed by the layout gate.
DECLUTTER_NOTES = []


def _country():
    out = []
    bodies = [(s["x"], s["y"],
               _body(s["kind"], _squeezed(HIER(s["x"], s["y"]), s.get("squeeze", 1.0))),
               s.get("reach", 2500.0))
              for s in SITES]
    n = int(_WORLD_EDGE // _COUNTRY_CELL) + 1
    k = 0
    for gx in range(-n, n + 1):
        for gy in range(-n, n + 1):
            cx = gx * _COUNTRY_CELL + (_rnd(gx, gy, 91) - 0.5) * _COUNTRY_CELL * 0.8
            cy = gy * _COUNTRY_CELL + (_rnd(gx, gy, 92) - 0.5) * _COUNTRY_CELL * 0.8
            r = math.hypot(cx, cy)
            if r < 9500.0 or r > _WORLD_EDGE:
                continue                      # the district has its own ground
            b = math.degrees(math.atan2(cy, cx)) % 360.0
            if r > 15000.0 and abs((b - 90.0 + 180.0) % 360.0 - 180.0) < _AXIS_KEEP_OUT:
                continue                      # the castle reads against sky
            H = HIER(cx, cy)
            # thin with distance, and thin again away from the ways
            if _rnd(gx, gy, 93) > 0.30 + 0.70 * (0.45 + 0.55 * H["score"]):
                continue
            # THE BODY OR THREE QUARTERS OF THE REACH, whichever is larger. A
            # grove's body is 0.55 of its extent and its mushroom landmark
            # sits outside that, so a country tower forty metres away stood
            # through one. What country must clear is the quarter's CONTENT.
            if any(math.hypot(cx - sx, cy - sy) < max(b, rr * 0.75) * _COUNTRY_CLEAR
                   for (sx, sy, b, rr) in bodies):
                continue
            k += 1
            tag = "Country%03d" % k
            sc, sp = H["scale"], H["spacing"]
            pick = _rnd(gx, gy, 94)
            if pick < 0.46:
                # A TREE MASS. Tight, because a mass is tight -- see the wood.
                cnt = _n(7, 0.6 + 0.8 * H["veg"], 3, 12)
                lean = _rnd(gx, gy, 95) * 6.283
                for i in range(cnt):
                    a = 6.283 * _rnd(i, k, 96)
                    rad = (300.0 + 1500.0 * math.sqrt(_rnd(i, k, 97))) * (0.9 + 0.5 * sp)
                    x = cx + math.cos(a) * rad * (1.0 + 0.6 * math.cos(lean))
                    y = cy + math.sin(a) * rad
                    t = (1.1 + 0.6 * _rnd(i, k, 98)) * sc
                    if _rnd(i, k, 99) > 0.45:
                        out += [
                            A("tree_mature_trunk", x, y, 0, yaw=_rnd(i, k, 100) * 360.0,
                              s=t, mat="MI_V2_Bark", label="%s_Trunk%d" % (tag, i)),
                            A("canopy_large", x, y, 1320.0 * t, yaw=_rnd(i, k, 101) * 360.0,
                              s=t * 1.22,
                              mat=("MI_V2_LeafMid", "MI_V2_LeafDark", "MI_V2_LeafLight")[i % 3],
                              label="%s_Canopy%d" % (tag, i)),
                        ]
                    else:
                        out += [
                            A("tree_slender_trunk", x, y, 0, yaw=_rnd(i, k, 102) * 360.0,
                              s=t, mat="MI_V2_Bark", label="%s_Slim%d" % (tag, i)),
                            A("canopy_medium", x, y, 800.0 * t, yaw=_rnd(i, k, 103) * 360.0,
                              s=t * 1.3, mat=("MI_V2_LeafLight", "MI_V2_LeafMid")[i % 2],
                              label="%s_SlimCanopy%d" % (tag, i)),
                        ]
            elif pick < 0.70:
                # A HEDGEROW, which is what turns open ground into fields
                lean = _rnd(gx, gy, 104) * 3.1416
                cnt = _n(6, 0.7 + 0.7 * H["veg"], 3, 10)
                for i in range(cnt):
                    t = -0.5 + i / float(max(1, cnt - 1))
                    rx, ry = t * 3400.0, (_rnd(i, k, 105) - 0.5) * 700.0
                    out.append(A("hedge_mass",
                                 cx + rx * math.cos(lean) - ry * math.sin(lean),
                                 cy + rx * math.sin(lean) + ry * math.cos(lean), 0,
                                 yaw=math.degrees(lean),
                                 s=(1.15 + 0.6 * _rnd(i, k, 106)) * sc,
                                 mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2],
                                 label="%s_Hedgerow%d" % (tag, i)))
                for i in range(_n(3, H["veg"], 1, 4)):
                    out += _ground_patch(cx + (i - 1) * 900.0, cy + 600.0, 0, 40 * i, 1.25,
                                         ("MI_V2_PetalViolet", "MI_V2_PetalWhite",
                                          "MI_V2_PetalPink")[i % 3],
                                         "%s_Drift%d" % (tag, i))
            elif pick < 0.84:
                # DRIFTS: colour on open ground, the cheapest thing in the kit
                for i in range(_n(6, 0.6 + 0.9 * H["veg"], 3, 9)):
                    a = 6.283 * _rnd(i, k, 107)
                    rad = 1900.0 * math.sqrt(_rnd(i, k, 108))
                    out += _ground_patch(cx + math.cos(a) * rad, cy + math.sin(a) * rad, 0,
                                         _rnd(i, k, 109) * 360.0, 1.4,
                                         ("MI_V2_PetalPink", "MI_V2_Lavender",
                                          "MI_V2_PetalWhite", "MI_V2_PetalViolet")[i % 4],
                                         "%s_Drift%d" % (tag, i))
                out.append(A("garden_lawn", cx, cy, -3, yaw=(k * 37) % 90,
                             sxyz=(1.1, 0.95, 1.0),
                             mat=("MI_V2_Meadow", "MI_V2_Lawn", "MI_V2_Moss")[k % 3],
                             label="%s_Ground" % tag))
            elif pick < 0.93:
                # ONE SILHOUETTE. Rare, and it is why the horizon has shape.
                h = (1.1 + 0.5 * _rnd(gx, gy, 110)) * sc * H["skyline"] / 1.28
                out += [
                    A("tower_capped", cx, cy, 0, yaw=_rnd(gx, gy, 111) * 360.0, s=h,
                      mat="MI_V2_IvoryStone", label="%s_Tower" % tag),
                    A("roof_cone_steep", cx, cy, 1100.0 * h, s=h,
                      mat=("MI_V2_RoofPink", "MI_V2_RoofLilac", "MI_V2_RoofNavy",
                           "MI_V2_RoofBlue")[k % 4], label="%s_TowerCap" % tag),
                    A("finial_spire", cx, cy, 1560.0 * h, s=0.7 * h, mat="MI_V2_Gold",
                      label="%s_TowerSpire" % tag),
                ]
                for i in range(3):
                    a = 6.283 * i / 3.0 + 0.4
                    out.append(A("hedge_mass", cx + math.cos(a) * 900.0,
                                 cy + math.sin(a) * 900.0, 0, yaw=60 * i,
                                 s=1.3 * sc, mat="MI_V2_LeafDark",
                                 label="%s_TowerHedge%d" % (tag, i)))
            else:
                # a lone giant, standing in open country the way the boards do it
                out.append(A("stone_ring_base", cx, cy, -2, s=1.5 * sc,
                             mat="MI_V2_Stone", label="%s_Ring" % tag))
                out += _giant_mushroom(cx, cy, 12000 + k, "%s_Giant" % tag,
                                       s=(0.9 + 0.4 * _rnd(gx, gy, 112)) * H["landmark_scale"] * 0.85,
                                       tint=("MI_V2_MushRed", "MI_V2_MushPurple",
                                             "MI_V2_MushTerracotta")[k % 3])
    return out


# ---------------------------------------------------------------------------
# THE HORIZON
# ---------------------------------------------------------------------------
#
# Ledger item: "the horizon still ends at a hard line against the sea band."
# Measured, that is precise: the approved CITY layer 5 stands at 300-420 m and
# occupies bearings 22-158 degrees -- the castle's hemisphere and nothing else
# -- so in five of the eight sectors the world's last object is at 345 m and
# beyond it is flat slab meeting fog.
#
# This is the scenic band, and it is deliberately NOT more world: it lies past
# `_WORLD_EDGE`, nothing here is reachable, nothing carries collision, nothing
# has a road. It is silhouette at the distance silhouette is all that survives
# -- wooded ridges, the occasional far tower group -- placed all the way round
# and skipped where the approved city already holds the ground.
#
# The founder's rule for going outward is that expansion only counts if it
# produces meaningful spatial structure. A horizon IS structure: it is the
# difference between a world that continues and a diorama on a table.

#: uu. The scenic band, past everything walkable -- and past the quarters'
#: OUTERMOST PIECES, not just their centres. At 39,000 it began 45 m inside
#: the reach of the furthest woods and the audit found a horizon ridge growing
#: through a meadow's landmark and a far wood's trunk standing in a horizon
#: tower. A quarter at the world edge (34,500) reaches about 6,000 uu.
_HORIZON_BAND = (43000.0, 58000.0)
#: How many to try around it; the spacing rule keeps what fits.
_HORIZON_TRIES = 150
#: uu. Minimum spacing between horizon masses -- they are big and few.
_HORIZON_SPACING = 9000.0


def _horizon():
    r0, r1 = _HORIZON_BAND
    kept, out = [], []
    for k in range(_HORIZON_TRIES):
        u = (k + 0.5) / _HORIZON_TRIES
        r = math.sqrt(r0 * r0 + (r1 * r1 - r0 * r0) * u)
        b = (k * 137.50776405 + 9.0 * _rnd(k, 141, 1)) % 360.0
        a = math.radians(b)
        x, y = math.cos(a) * r, math.sin(a) * r
        if any((qx - x) ** 2 + (qy - y) ** 2 < _HORIZON_SPACING ** 2 for (qx, qy) in kept):
            continue
        if any((px - x) ** 2 + (py - y) ** 2 < 11000.0 ** 2 for (px, py) in _CITY_POINTS):
            continue                          # the approved city holds this
        if any(math.hypot(s["x"] - x, s["y"] - y) < s.get("reach", 3000.0) + 4000.0
               for s in SITES):
            continue                          # and a quarter holds this
        kept.append((x, y))
        tag = "Horizon%03d" % len(kept)
        pick = _rnd(k, 141, 2)
        if pick < 0.62:
            # A WOODED RIDGE. hedge_mass at 4-7x is a 13-22 m green mass, and
            # a line of them at this range is a treeline: the cheapest object
            # in the kit that reads at half a kilometre.
            lean = _rnd(k, 141, 3) * 3.1416
            n = 7 + int(6 * _rnd(k, 141, 4))
            for i in range(n):
                t = -0.5 + i / float(n - 1)
                rx = t * (9000.0 + 6000.0 * _rnd(k, 141, 5))
                ry = (_rnd(i, k, 142) - 0.5) * 2600.0
                s = 4.0 + 3.0 * _rnd(i, k, 143)
                out.append(A("hedge_mass",
                             x + rx * math.cos(lean) - ry * math.sin(lean),
                             y + rx * math.sin(lean) + ry * math.cos(lean), -200.0,
                             yaw=math.degrees(lean) + 20.0 * _rnd(i, k, 144),
                             sxyz=(s, s * 0.8, s * (0.55 + 0.3 * _rnd(i, k, 145))),
                             mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2],
                             label="%s_Ridge%d" % (tag, i)))
            # a few crowns standing above the ridge line
            for i in range(2 + int(3 * _rnd(k, 141, 6))):
                rx = (_rnd(i, k, 146) - 0.5) * 9000.0
                ry = (_rnd(i, k, 147) - 0.5) * 2200.0
                cx2 = x + rx * math.cos(lean) - ry * math.sin(lean)
                cy2 = y + rx * math.sin(lean) + ry * math.cos(lean)
                s = 3.4 + 2.2 * _rnd(i, k, 148)
                out.append(A("canopy_large", cx2, cy2, 900.0 * s, s=s,
                             mat=("MI_V2_LeafDark", "MI_V2_LeafMid", "MI_V2_LeafLight")[i % 3],
                             label="%s_Crown%d" % (tag, i)))
        elif pick < 0.88:
            # a far tower group: three or four, one dominant, fog does the rest
            n = 3 + int(2 * _rnd(k, 141, 7))
            for i in range(n):
                a2 = 6.283 * i / n + _rnd(i, k, 149)
                rr = (700.0 + 1900.0 * _rnd(i, k, 150))
                tx, ty = x + math.cos(a2) * rr, y + math.sin(a2) * rr
                h = (2.6 if i == 0 else 1.5 + 1.0 * _rnd(i, k, 151))
                out += [
                    A("tower_capped", tx, ty, 0, yaw=_rnd(i, k, 152) * 360.0, s=h,
                      mat="MI_V2_IvoryStone", label="%s_Tower%d" % (tag, i)),
                    A("roof_cone_steep", tx, ty, 1100.0 * h, s=h,
                      mat=("MI_V2_RoofPink", "MI_V2_RoofLilac", "MI_V2_RoofNavy",
                           "MI_V2_RoofBlue")[i % 4], label="%s_TowerCap%d" % (tag, i)),
                ]
            for i in range(4):
                a2 = 6.283 * i / 4.0 + 0.4
                s = 4.5 + 2.0 * _rnd(i, k, 153)
                out.append(A("hedge_mass", x + math.cos(a2) * 3200.0,
                             y + math.sin(a2) * 3200.0, -200.0,
                             sxyz=(s, s * 0.8, s * 0.6), mat="MI_V2_LeafDark",
                             label="%s_Skirt%d" % (tag, i)))
        else:
            # and once in a while, a giant on the skyline
            out.append(A("stone_ring_base", x, y, -2, s=3.0, mat="MI_V2_Stone",
                         label="%s_Ring" % tag))
            out += _giant_mushroom(x, y, 15000 + k, "%s_Giant" % tag,
                                   s=2.6 + 1.0 * _rnd(k, 141, 8),
                                   tint=("MI_V2_MushRed", "MI_V2_MushPurple",
                                         "MI_V2_MushTerracotta")[k % 3])
    return out


HORIZON = _band("V2_Skyline", _horizon())


def _ground_quilt():
    # ACROSS THE WHOLE WORLD, not the district's shoulders. The quilt was a
    # 7 x 5 grid reaching about 170 m, laid when that was the whole world; the
    # hierarchy took the world to 350 m, and everything beyond the old grid is
    # the flat moss slab again -- one quad, one tone, from the last quarter to
    # the horizon, which is the founder's golf course over ten times the area
    # it was first complained about. A `garden_lawn` is 60 x 72 m of displaced
    # grid: terrain, not content. It is SURFACE to every audit here, so it
    # moves no density number and games no measurement -- it is the tier's
    # "terrain composition" and nothing else.
    out = []
    k = 0
    for gx in range(-6, 7):
        for gy in range(-5, 6):
            if abs(gx) <= 1 and abs(gy) <= 1:
                continue                    # the district has its own ground
            if math.hypot(gx * 5600.0, gy * 6600.0) > 35000.0:
                continue                    # outside the world's own edge
            cx = gx * 5600.0 + (_rnd(gx, gy, 71) - 0.5) * 900.0
            cy = gy * 6600.0 + (_rnd(gx, gy, 72) - 0.5) * 900.0 + 1000.0
            out.append(A("garden_lawn", cx, cy, -3 - (k % 3),
                         yaw=90.0 * (k % 4),
                         sxyz=(0.98 + 0.10 * _rnd(gx, gy, 73),
                               0.98 + 0.10 * _rnd(gx, gy, 74), 1.0),
                         # NOT MOSS. The slab IS moss, so a moss quilt tile is
                         # an invisible tile: the quilt's whole job is lighter
                         # fields ON a darker ground.
                         mat=("MI_V2_Lawn", "MI_V2_Meadow", "MI_V2_Lawn")[k % 3],
                         label="Quilt_%d_%d" % (gx, gy)))
            k += 1
    return out


GROUND_QUILT = _band("V2_Skyline", _ground_quilt())


OUTER_WORLD = _band("V2_Skyline", _outer_world())


# ---------------------------------------------------------------------------
# THE PLAZA STOPS BEING A GRID OF SLABS
# ---------------------------------------------------------------------------
#
# The brief is specific about this surface: it must stop reading as repeated
# prototype slabs and move toward crafted royal fantasy stonework, with
# "selective ornamental inserts", "edge treatment" and "gold detail only where
# tasteful" -- and explicitly NOT noise added to hide repetition. PASS 08 gave
# the slabs four tints and a per-slab draw, which is the material half. This
# is the other half: a plaza in the boards has a CENTRE and an EDGE, and ours
# had neither. A grid with no centre is a floor; a grid with a medallion at
# its heart and a border course at its rim is a plaza.
#
# Everything here sits at the plaza's own level and inside PLAZA_RECT
# (x +-650, y -1500..800), and the medallion is a ring rather than a disc so
# the arrival floor the brief wants kept open for gathering stays open.

def _plaza_ornament():
    out = []
    cx, cy = 0.0, -350.0                       # the plaza's own centre
    # THE MEDALLION: a ring of alternating gold and stone inlays, laid flat.
    for i in range(16):
        a = 6.283 * i / 16.0
        r = 430.0
        out.append(A("kerb_stone", cx + math.cos(a) * r, cy + math.sin(a) * r, 2,
                     yaw=math.degrees(a) + 90.0, sxyz=(1.45, 0.62, 0.10),
                     mat=("MI_V2_Gold", "MI_V2_PlazaWarm")[i % 2],
                     label="Plaza_Medallion%d" % i))
    # an inner ring, tighter and all stone, so the centre reads as worked
    for i in range(10):
        a = 6.283 * i / 10.0 + 0.31
        out.append(A("kerb_stone", cx + math.cos(a) * 215.0, cy + math.sin(a) * 215.0, 2,
                     yaw=math.degrees(a) + 90.0, sxyz=(1.05, 0.5, 0.09),
                     mat="MI_V2_PlazaShade", label="Plaza_MedallionInner%d" % i))
    # THE BORDER COURSE: a run of kerb along the plaza's four edges, just
    # inside the side steps, which is what stops a paved field from simply
    # ending.
    x0, x1, y0, y1 = -650.0, 650.0, -1500.0, 800.0
    for i in range(9):
        t = i / 8.0
        out += [
            A("kerb_stone", x0 + 34.0, y0 + (y1 - y0) * t, 2, yaw=90,
              sxyz=(2.4, 0.66, 0.13), mat="MI_V2_Kerb", label="Plaza_BorderL%d" % i),
            A("kerb_stone", x1 - 34.0, y0 + (y1 - y0) * t, 2, yaw=90,
              sxyz=(2.4, 0.66, 0.13), mat="MI_V2_Kerb", label="Plaza_BorderR%d" % i),
        ]
    for i in range(6):
        t = i / 5.0
        out.append(A("kerb_stone", x0 + (x1 - x0) * t, y0 + 34.0, 2, yaw=0,
                     sxyz=(2.0, 0.66, 0.13), mat="MI_V2_Kerb",
                     label="Plaza_BorderS%d" % i))
    # GOLD, SPARINGLY: four small inlays on the medallion's axes, and nothing
    # else on this floor. The brief's rule is that gold is an accent that
    # communicates royal structure, not a coating.
    # ON THE DIAGONALS, not the axes. The layout gate refused the first
    # version: an inlay at (0, -990) stands on the GATE-VIEW AXIS, the line
    # PlayerCam01 looks down and a participant walks in along. That check
    # exists because the arrival sightline is composed, and a gold ball on it
    # is an obstruction in the one view the district is built around.
    for i, (dx, dy) in enumerate(((470, 450), (-470, 450), (470, -450), (-470, -450))):
        out.append(A("gate_finial_ball", cx + dx, cy + dy, 6, s=0.30,
                     mat="MI_V2_Gold", label="Plaza_Inlay%d" % i))
    return out


PLAZA_ORNAMENT = _band("V2_Arrival", _plaza_ornament())


# ---------------------------------------------------------------------------
# THE PROCESSIONAL BORDER — flower colour on the route the player walks
# ---------------------------------------------------------------------------
#
# gap_v2 has said the same thing about every frame it has measured: the rose
# arc holds 1.8-3.1% of ours against 6.8% of the founder reference, while the
# green arc runs 5x theirs. The flanks got their bloom; the ARRIVAL AXIS did
# not, and it is the surface HeroCam0 and PlayerCam01 look straight down --
# the one view the whole district is composed around, and the one the primary
# reference is a picture of.
#
# In that reference the path is lined, both sides, the whole way: a continuous
# flowering border between the kerb and the hedge, dense enough to read as
# colour rather than as individual plants. That is what this is. It runs
# OUTSIDE the walking corridor (|x| > 260 is the corridor check's own bound)
# and stops short of the fountain court so the court keeps its own
# composition.


def _processional_border():
    out = []
    petals = ("MI_V2_PetalPink", "MI_V2_RosePink", "MI_V2_PetalViolet",
              "MI_V2_PetalWhite", "MI_V2_Lavender", "MI_V2_PetalRose")
    for side in (1, -1):
        # the border hugs the corridor as it narrows toward the castle
        for i in range(22):
            t = i / 21.0
            y = 900.0 + 7400.0 * t
            x = side * (700.0 - 190.0 * t)          # 7.0 m out, closing to 5.1
            kind = ("blossom_cluster", "flower_cluster", "rose_bush",
                    "lavender_heads", "flower_cluster", "blossom_cluster")[i % 6]
            out.append(A(kind, x, y, 30, yaw=37 * i + 90 * side, s=0.62 + 0.16 * ((i % 3) / 2.0),
                         mat=petals[(i + (0 if side > 0 else 3)) % 6],
                         label="Procession_%d_Bloom%d" % (side, i)))
            if i % 3 == 0:
                # a clipped ball every third station, so the border has a beat
                out.append(A("topiary_ball", side * (x / side + 150.0), y + 120.0, 0,
                             s=0.52, mat="MI_V2_LeafDark",
                             label="Procession_%d_Ball%d" % (side, i)))
            if i % 4 == 1:
                out += _ground_patch(side * (x / side - 130.0), y - 90.0, 0, 45 * i, 0.8,
                                     petals[(i + 2) % 6], "Procession_%d_Ground%d" % (side, i))
    return out


PROCESSIONAL_BORDER = _band("V2_Garden", _processional_border())


#: THE BANDS THE BUILDER WALKS. One list, so `ALL` and build_v2 cannot drift.
#:
#: They already had. build_v2 kept its own hand-written list and `ALL` kept
#: another, and the two never matched: COURTYARD was built and absent from
#: `ALL`, so the layout gate had never checked a single actor in it -- and
#: PASS 09 added FLANKS and REARWORLD to `ALL` alone, whereupon the gate
#: counted 305 new placements and passed while the generator placed four. A
#: gate reading a different list from the builder reports the world it was
#: shown, not the world that gets made.
# ---------------------------------------------------------------------------
# THE GROUND BESIDE THE CASTLE APPROACH  (ledger: "empty lawn between the
# garden gates and the castle", carried HIGH since the environment checkpoint)
# ---------------------------------------------------------------------------
#
# Measured, per hectare of solid placements:
#
#   the approach corridor      |x| < 25 m, y 17-95 m     713
#   LEFT of it                 x 25-70 m                 362
#   RIGHT of it                x -70..-25 m              330
#   the flank beside the plaza x 25-70 m, y -60..17 m    505
#
# So the ground either side of the processional way is 1.4x thinner than the
# same offset beside the plaza -- the founder's complaint, in numbers. W1 gave
# the approach a fountain court, hedge masses and cross-axes and those are on
# the AXIS; its shoulders were never planted.
#
# This is an ADDED BAND, not an edit. Everything W1 and the flanks put down is
# untouched and still hashes identical; this fills between them, in their own
# language, and stops 28 m clear of the corridor the layout gate protects.

def _approach_sides():
    out = []
    for side in (1, -1):
        tag = "ApproachSide%s" % ("L" if side > 0 else "R")
        seed = 3300 if side > 0 else 3400
        for i in range(30):
            u = (i + 0.5) / 30.0
            y = 2300.0 + 6500.0 * u + 400.0 * (_rnd(i, seed, 1) - 0.5)
            x = side * (2900.0 + 3500.0 * _rnd(i, seed, 2))
            pick = _rnd(i, seed, 3)
            if pick < 0.26:
                t = 1.05 + 0.4 * _rnd(i, seed, 4)
                out += [
                    A("tree_mature_trunk", x, y, 0, yaw=_rnd(i, seed, 5) * 360.0, s=t,
                      mat="MI_V2_Bark", label="%s_Trunk%d" % (tag, i)),
                    A("canopy_large", x, y, 1320.0 * t, yaw=_rnd(i, seed, 6) * 360.0,
                      s=t * 1.12,
                      mat=("MI_V2_LeafMid", "MI_V2_LeafDark", "MI_V2_LeafLight")[i % 3],
                      label="%s_Canopy%d" % (tag, i)),
                ]
            elif pick < 0.50:
                out.append(A("hedge_mass", x, y, 0, yaw=_rnd(i, seed, 7) * 40.0,
                             s=1.1 + 0.5 * _rnd(i, seed, 8),
                             mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2],
                             label="%s_Hedge%d" % (tag, i)))
            elif pick < 0.70:
                out += _ground_patch(x, y, 0, _rnd(i, seed, 9) * 360.0, 1.1,
                                     ("MI_V2_PetalPink", "MI_V2_PetalViolet",
                                      "MI_V2_PetalWhite", "MI_V2_RosePink")[i % 4],
                                     "%s_Bed%d" % (tag, i))
            elif pick < 0.86:
                out.append(A(("topiary_cone_plain", "topiary_ball", "shrub_flowering")[i % 3],
                             x, y, 0, yaw=30 * i,
                             s=0.85 + 0.35 * _rnd(i, seed, 10),
                             mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2],
                             label="%s_Green%d" % (tag, i)))
            else:
                # ornament on the processional way's shoulder: the boards put
                # plinthed urns down the length of every royal walk
                out += [
                    A("pedestal_finial", x, y, 0, s=0.85, mat="MI_V2_IvoryStone",
                      label="%s_Plinth%d" % (tag, i)),
                    A("garden_urn", x, y, 124.0, s=0.55, mat="MI_V2_Ceramic",
                      label="%s_Urn%d" % (tag, i)),
                    A("flower_cluster", x, y, 210.0, s=0.45,
                      mat=("MI_V2_PetalPink", "MI_V2_Lavender")[i % 2],
                      label="%s_UrnFlowers%d" % (tag, i)),
                ]
        # a lawn under it, so the band has its own tone rather than the slab's
        for k in range(3):
            out.append(A("garden_lawn", side * 4600.0, 3200.0 + 2700.0 * k, -2,
                         yaw=90.0 * (k % 2), sxyz=(0.62, 0.52, 1.0),
                         mat=("MI_V2_Lawn", "MI_V2_Meadow", "MI_V2_Lawn")[k],
                         label="%s_Ground%d" % (tag, k)))
    return _declutter(out, also=[it for band in (GARDEN, PALACE, FLANKS, REARWORLD)
                                 for it in band if it["asset"] in _PROTECT])


APPROACH_SIDES = _band("V2_Garden", _approach_sides())


# ---------------------------------------------------------------------------
# THE PLAZA-SIDE WALLS  (ledger, MEDIUM: "plain plaza-side walls (cam3)")
# ---------------------------------------------------------------------------
#
# `_dress_wall` was written for exactly this complaint -- the founder named it
# twice, "ReverseCam03 currently exposes plain walls" and "plain walls and
# unfinished backsides are not acceptable merely because HeroCam0 cannot see
# them" -- and it was then used on the rear wall and the flank edges and never
# on the walls it was written for. SideWall runs at x = +/-800 from y -700 to
# 960; FrontWall runs along y = 900 from x +/-680 to +/-1880. Both are in
# ReverseCam03's frame and both are flat ashlar ribbons.
#
# An ADDED band again: the eighteen retaining_wall pieces are untouched and
# still hash identical. `side` puts the planters on the GARDEN face -- at
# x = +800 the garden is +x, so the planters go to -1; the plaza-clean gate is
# what caught this being backwards the first time `_dress_wall` was used.
PLAZA_WALL_DRESS = _band("V2_Arrival",
    _dress_wall(800.0, 130.0, 90.0, 2060.0, "SideWallL", side=-1.0)
    + _dress_wall(-800.0, 160.0, 90.0, 2060.0, "SideWallR", side=1.0)
    + _dress_wall(1280.0, 900.0, 0.0, 1600.0, "FrontWallL", side=1.0)
    + _dress_wall(-1280.0, 900.0, 0.0, 1600.0, "FrontWallR", side=1.0))


BUILD_BANDS = [FOREGROUND, COURTYARD, GARDEN, PALACE, FLANK_GROUND, FLANKS,
               REARWORLD, CAM_FOREGROUNDS, GROUND_QUILT, OUTER_WORLD, PLAZA_ORNAMENT,
               PROCESSIONAL_BORDER, HORIZON, APPROACH_SIDES, PLAZA_WALL_DRESS]

#: Everything the layout declares: what the builder walks, plus the two bands
#: it places by their own rules (SKY is the dome/atmosphere, HOVER is lifted
#: props). Derived from BUILD_BANDS rather than restated.
ALL = [it for band in BUILD_BANDS for it in band] + SKY + HOVER

#: The dark path: from the front wall line to the arch, 4.4 m narrowing to 3 m,
#: rising 0.6 m at the steps then 2%. The builder lays it.
# THE PATH RAMPS; IT DOES NOT JUMP.
#
# This spline used to lift 60 uu between y = 2940 and y = 3060 -- sixty
# centimetres across one metre twenty. The flagstones that follow it are about
# 124 uu long, so ONE slab absorbed the whole rise and became a 60 uu vertical
# face: measured at 60.0 uu per slab where every other segment of this path is
# 2.0 to 2.3. That was a wall to any character, and it is why the Dog could not
# reach the castle approach on foot -- six route legs gave up against it, and
# neither adding steps nor raising the step height moved it, because the wall
# was the path itself. Spread over 540 uu the same rise is 13 uu per slab and
# six degrees underfoot: a ramp a participant walks up without noticing, and
# the path still arrives at the court at exactly the same height.
PATH_SPLINE = [(0.0, 850.0, 0.0), (10.0, 2000.0, 0.0), (0.0, 2760.0, 0.0),
               (0.0, 3030.0, 30.0), (0.0, 3300.0, 60.0),
               (-10.0, 3700.0, 72.0), (0.0, 4450.0, 84.0)]
PATH_WIDTH_NEAR, PATH_WIDTH_FAR = 440.0, 300.0
#: The pale plaza: from behind the gate to the front wall, 16 m wall to wall
#: (retaining walls at x = +/-8 m); the sunken slab field is the 13 m between
#: the side steps (PLAZA_RECT), the steps and terraces fill the rest.
PLAZA_RECT = (-650.0, 650.0, -1500.0, 800.0)        # x0, x1, y0, y1 -- the sunken floor between the side steps
PLAZA_SLAB = 130.0
PETALS = 36


def summary():
    by = {}
    for it in ALL:
        by[it["band"]] = by.get(it["band"], 0) + 1
    return by
