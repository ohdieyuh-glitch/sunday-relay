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


#: uu. WHERE A GROUND LAWN GOES, and why it is positive.
#:
#: THE QUILT WAS NEVER VISIBLE. `garden_lawn` is `box(6000, 7200, 24,
#: at=(0,0,-12))` -- its top surface is at its own local z = 0 with all 24 uu
#: of thickness below -- and then perlin displaces that top by +/-9. The
#: terrain slab is an engine Cube at z = -30 scaled 0.6, so it is 60 uu thick
#: and its TOP IS AT z = 0.
#:
#: A lawn placed at z = -2 therefore has its surface between -11 and +7, and
#: only its noise peaks clear the slab. At -5 almost nothing does. 191 of the
#: world's 255 lawns sat at -2 to -8: the quilt, every quarter's ground, the
#: flank lawns and the lake's water sheet were all INSIDE the terrain, which
#: is why every wide frame shows one flat olive plane and why "the ground
#: quilt does not read" survived a pass that doubled its colour contrast. The
#: contrast was never the problem.
#:
#: THE FIX IS THE SLAB, NOT THE LAWNS. Raising every lawn to +10 clears the
#: terrain and then buries what stands ON the lawn: `ground_flowers` is a
#: flattened sphere reaching only +11 from its origin, so every bed would have
#: gone under the grass instead. `garden_lawn`'s own docstring says what was
#: meant -- "sits 2 cm under the beds and walls; the moss ground slab stays
#: BENEATH as terrain" -- and the slab is not beneath, it is exactly level
#: with the lawn's origin. build_v2 drops it to a top of -14 (see
#: V2_GroundSlab), which is below the lawns' deepest displaced point, and
#: every placement keeps the z it was authored with.
GROUND_Z = -2.0
#: THE ROAD'S TOP MUST BE UNDER THE DOG'S STEP HEIGHT, AND IT WAS OVER IT BY
#: ONE UNIT.
#:
#: terrace_platform is a 120-thick slab with a 20-thick cap, so its top sits at
#: local z = 140. At z = -18 with a 0.35 z-scale that puts the walking surface
#: at 31 uu -- and ARelayDogCharacter sets MaxStepHeight = 30. Every road in
#: this world was one unit too tall to step onto.
#:
#: It looked like anything but that. The Dog crossed grass perfectly, stalled
#: at road edges, ground along them at a sixth of its speed, and once gave up
#: SEVENTY-FOUR UU SHORT of a target with nothing collidable within three
#: metres. Six route fixes went past it -- wider capsule, centred waypoints,
#: pinned pinches, clearance-preferring search, shorter legs, a widened gate --
#: because every one of them was looking for something in the way, and the
#: obstacle was the road itself.
#:
#: -30 puts the surface at 19 uu, eleven under the step height, which is margin
#: rather than luck.
ROAD_Z = -30.0
#: uu. A parterre's worked-soil floor, proud of the lawn under it.
BED_Z = 3.0


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
      mat=("MI_V2_LeafMid", "MI_V2_LeafDark", "MI_V2_RosePink", "MI_V2_LeafCream",
           "MI_V2_LeafDark", "MI_V2_PetalViolet")[i % 6], label="SideBed_L_Hedge%d" % i) for i in range(6)
] + [
    A(("shrub_flowering", "hedge_block", "hedge_mass")[i % 3], -1010 - 60 * (i % 2), -540 + 330 * i, 60, yaw=(90 if i % 3 == 1 else 67 * i), s=0.9,
      mat=("MI_V2_LeafDark", "MI_V2_PetalPink", "MI_V2_LeafMid", "MI_V2_Lavender",
           "MI_V2_LeafCream", "MI_V2_LeafMid")[i % 6], label="SideBed_R_Hedge%d" % i) for i in range(6)
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
      # THE WALL EITHER SIDE OF THE PROCESSIONAL WAY. Measured on the PASS 28
      # PathCam02 frame, `hedge_mass` at 4-5 m is what fills the left and right
      # thirds, in two greens that are one hue at two values. A third of the
      # run now flowers, which changes the colour of the walk without changing
      # a single position.
      mat=("MI_V2_LeafMid", "MI_V2_LeafDark", "MI_V2_RosePink", "MI_V2_LeafDark",
           "MI_V2_LeafCream", "MI_V2_PetalViolet")[i % 6],
      label="PathHedge%d_%d" % (side, i))
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
    A(("floral_arch_trellis" if PASS03 else "floral_arch"), 0, 3600, 80, s=1.0, sxyz=(1.0, 1.0, 1.1), mat=("MI_V2_Gold" if PASS03 else "MI_V2_RosePink"), label="Corridor_FloralArch"),
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
    A("garden_lawn", 3800, 2600, GROUND_Z, mat="MI_V2_Lawn", label="Lawn_L"),
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
    # MEASURED ON THE PASS 28 RENDER: these four crowns and the clock tree's
    # four are the EIGHT LARGEST presences in HeroCam0 -- 3.6%, 2.9%, 2.8%,
    # 2.5%, 2.1%, 1.4% of the founder's benchmark frame each, all plain green,
    # all within 25 m of the lens. The brief says reduce green dominance, and
    # nothing else in this world is worth as many pixels. They are not removed:
    # they are the frame's own trees and the reference has trees there. They
    # FLOWER. A royal garden in blossom is the reference, and it costs the
    # composition nothing.
    A("canopy_large", 1350, 2300, 1500, yaw=0, s=1.5, mat="MI_V2_PetalWhite", label="Garden_L_Tree_Canopy0"),
    A("canopy_large", 1000, 2550, 1380, yaw=130, s=1.1, mat="MI_V2_RosePink", label="Garden_L_Tree_Canopy1"),
    A("canopy_large", 1750, 2150, 1320, yaw=250, s=1.0, mat="MI_V2_PetalPink", label="Garden_L_Tree_Canopy2"),
    A("canopy_medium", 1200, 2000, 1150, yaw=60, s=1.2, mat="MI_V2_LeafCream", label="Garden_L_Tree_Canopy3"),
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
    A("garden_lawn", -3800, 2600, GROUND_Z, mat="MI_V2_Lawn", label="Lawn_R"),
    # MEASURED ON THE REPROJECTED cam0 VIEW, not the flat panorama: the clock
    # sits at +45 deg, the trunk spans +42..+52, and the foliage fills the
    # top-right corner -- so the tree is 16 m tall, 28 m out, at +47 deg.
    # the trunk mesh is 27 m tall at scale 1; 0.6 puts its highest limbs at
    # 16 m and the crown (canopies at 8-10.5 m + ~6 m radius) tops out at
    # ~17 m -- the measured ~16 m. (0.8 left bare limbs 5 m above the crown.)
    A("tree_clock_trunk", -2050, 1900, 0, yaw=200, s=0.6, mat="MI_V2_Bark", label="ClockTree_Trunk"),
    A("clock_ornate", -1900, 1720, 560, yaw=-25, s=1.0, mat="MI_V2_Gold", label="ClockTree_Clock"),
    A("canopy_large", -2100, 1950, 1050, yaw=0, s=1.4, mat="MI_V2_PetalViolet", label="ClockTree_Canopy0"),
    A("canopy_large", -1600, 2100, 960, yaw=140, s=1.1, mat="MI_V2_Lavender", label="ClockTree_Canopy1"),
    A("canopy_large", -2550, 1650, 990, yaw=260, s=1.0, mat="MI_V2_PetalWhite", label="ClockTree_Canopy2"),
    A("canopy_medium", -1700, 1650, 800, yaw=30, s=1.2, mat="MI_V2_LeafCream", label="ClockTree_Canopy3"),
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
#: Landmarks the approach rungs must not stand in, as (x, y, keep-out radius).
#: The garden flanks were authored before the approach corridor was, so a rung
#: can land on one: Approach_HedgeR2 sat 1.4 m from Tower_R0's centre, wrapping
#: a 5 m hedge blob around the foot of a 13 m ivory tower on the corridor every
#: player walks. `_declutter` could not catch it -- it runs inside
#: `_approach_sides`, and the APPROACH band is assembled separately -- and the
#: 3D embedded-landmark test in tools/hierarchy.py is what found it.
_APPROACH_KEEPOUT = ((-2500.0, 4300.0, 620.0),   # Tower_R0, 3.6 m drum
                     (2500.0, 4300.0, 620.0),    # Tower_L0, its mirror
                     (0.0, 5400.0, 700.0))       # Court_FountainBasin


def _approach_pair(y, half, seed, hedge_mat="MI_V2_LeafMid"):
    """One rung of the approach: a hedge mass either side at +-half.

    A RUNG SLIDES ALONG THE CORRIDOR RATHER THAN STANDING ON A LANDMARK. The
    corridor's rhythm is what the rungs are for, so one that collides is moved
    UP the climb -- the direction that keeps the sequence reading -- until it
    clears, and dropped only if it cannot. Nudging the one hedge by hand would
    have fixed the one hedge; this keeps working when either end moves.
    """
    out = []
    for side, tag in ((1.0, "L"), (-1.0, "R")):
        x, ry = side * half, y
        for _ in range(12):
            hit = next(((kx, ky, kr) for (kx, ky, kr) in _APPROACH_KEEPOUT
                        if (x - kx) ** 2 + (ry - ky) ** 2 < kr * kr), None)
            if hit is None:
                break
            ry += 120.0
        else:
            continue        # twelve steps up the corridor and still on it: drop
        out.append(A("hedge_mass", x, ry, 0, yaw=(seed * 37 + (0 if side > 0 else 90)) % 360,
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
    # 1500, NOT 940. `canopy_large` reaches 315 uu BELOW its own origin, so at
    # 940 on a trunk whose top is 1,714 these crowns hung from 5.6 m to 15.7 m
    # -- leaves at eye level over a processional avenue, and 55% of their own
    # trunk's height where every other tree in Wonderland puts its crown at
    # 88% (`_tree_group`: 1450 on a 1639 trunk). A number that contradicts the
    # thing it sits on. Raised to the world's own ratio, which lifts the
    # underside to 11 m and opens the walk up to the castle.
    + [A("canopy_large", 2050 * (1 if i % 2 == 0 else -1), 2900 + 1500 * i, 1500,
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


PARTERRE_NOTES = []


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
    # THE WALK IS AS WIDE AS THE GAP, NOT AS WIDE AS THE SPACING.
    #
    # `off = q/2 + w` puts the bed CENTRE at w from the axis, so the walk is w
    # wide only if the beds' edges have no thickness. They do: each bed's
    # border run is a stretched hedge_block, half-width 75 * 0.90 = 67.5 uu,
    # straddling the bed boundary -- and the two perpendicular runs of adjacent
    # beds each take 67.5 uu out of the walk between them, from BOTH sides.
    #
    # Delivered, the garden quarter's principal cross walk was 112 uu. Not
    # narrow: IMPASSABLE. A route solve of the whole world found the centre of
    # the garden quarter and the centre of the hamlet were the only two places
    # in 434,342 cells of open ground that a walker could not reach -- sealed
    # inside their own parterres by their own flower beds, with the ornament
    # they are built around standing in the middle where nobody could get to
    # it. The founder's rule is that the world is repaired, not the route.
    #
    # Adding the border's own half-width makes `w` mean what it says: a clear
    # 2w between hedge faces, 3 m at full scale. The parterre grows 135 uu
    # overall, under 8% of its width, and its proportions are unchanged --
    # this is the composition being delivered, not redrawn.
    _EDGE_HALF = 75.0 * 0.90       # hedge_block FOOT y * its sxyz y
    off = q / 2.0 + w + _EDGE_HALF
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
        out.append(A("garden_lawn", bx, by, BED_Z, sxyz=(0.1033 * u, 0.0862 * u, 0.5),
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
        out.append(A("terrace_platform", cx, cy, ROAD_Z, yaw=yaw,
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
    # THE ROOM HAS A RIM, AND FOR TWO PASSES IT HAD NO DOOR.
    #
    # A low wall along the room's outer square, broken at the four walk
    # entrances, so the garden room is enclosed by architecture the way the
    # boards enclose theirs -- hedges alone read as planting, a stone line
    # reads as a built room.
    #
    # THE GAP COULD NEVER OPEN. Four pieces a side put t at 0, 0.333, 0.667
    # and 1.0; the skip window was `0.34 <= t <= 0.66`, which excludes both
    # middle values by three thousandths. So all sixteen segments were placed,
    # every parterre in the world was a sealed box, and the comment above went
    # on saying "broken at the four walk entrances" while the code closed it.
    # A route solve found it: the garden quarter's centre was a 44 m2 pocket
    # of open ground with no way in, and it had been that way since the rim
    # was written. This is the same defect the parterre's own bed spacing had
    # -- and the header two hundred lines up describes fixing THAT one.
    #
    # Rewritten so the opening is a MEASURED width rather than a threshold on
    # a fraction: five pieces a side at 511 x 0.72u uu each, the middle one
    # dropped, leaving a clear gap of `2*rim/2 - 511*0.72u` between the inner
    # faces of its neighbours. The gate below asserts it, so this cannot
    # silently close again.
    rim = off + q * 0.5 + 190.0 * u
    _WALL_LEN = 511.0 * 0.72 * u
    if H is None or H["court_p"] > 0.40:
        PER_SIDE = 5
        for k in range(4 * PER_SIDE):
            side, i = k // PER_SIDE, k % PER_SIDE
            if i == PER_SIDE // 2:                # the walk entrance, centred
                continue
            t = i / float(PER_SIDE - 1)
            v = -rim + 2.0 * rim * t
            px, py = ((v, -rim), (v, rim), (-rim, v), (rim, v))[side]
            out.append(A("garden_wall", cx + sgn * px, cy + py, 0,
                         yaw=(0.0, 0.0, 90.0, 90.0)[side], sxyz=(0.72 * u, 1.0, 0.46),
                         mat="MI_V2_IvoryStone", label="%s_Rim%d" % (tag, k)))
        # THE OPENING IS ASSERTED, not described. `_parterre` is called for
        # every garden and court quarter in the world, so a silently closed
        # rim seals dozens of rooms at once and only a full route solve finds
        # it. 200 uu is comfortably over the Dog's 72 uu capsule width.
        _gap = (2.0 * rim * (2.0 / (PER_SIDE - 1))) - _WALL_LEN
        if _gap < 200.0:
            PARTERRE_NOTES.append(
                "%s: rim opening only %.0f uu -- the parterre is a sealed box" % (tag, _gap))
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
                         mat=_leaf(i, seed, 3) if H is not None else
                             ("MI_V2_LeafMid", "MI_V2_LeafDark", "MI_V2_LeafLight")[i % 3],
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


#: WHERE A 20 m MUSHROOM BELONGS.
#:
#: They are the best Wonderland-scale identifier this world has and they had
#: become background streetlights: 31 of them, and counted by district the
#: distribution was backwards -- Royal Gardens 5, East Reach 5, and the
#: MUSHROOM GROVE 2. A landmark that stands everywhere identifies nothing.
#:
#: So they belong to the wild half of the world. The formal districts -- the
#: royal gardens, the clock quarter, the water gardens, the tea terraces, the
#: tower rise, the lantern hamlets -- get none at all, and their landmark is
#: their own architecture. And they come in three sizes rather than one:
#:
#:   HERO    2.6-3.2   a handful, one per wild district at most, sited
#:   MEDIUM  1.3-1.7   the ordinary giant of a wood
#:   (small) the garden-scale `mushroom_landmark` everywhere else
_MUSH_DISTRICTS = ("Mushroom Grove", "The Long Woods", "West Wood", "North Reach",
                   "Far Orchards", "South Meadows", "East Reach", "Gatekeeper Fields")
#: The one district whose giants are its whole identity gets the heroes.
_MUSH_HERO_DISTRICT = "Mushroom Grove"


#: uu. The ONE hero, filled in once SITES exists: the grove of the Mushroom
#: Grove standing nearest that district's own seed radius. A hierarchy needs a
#: top and a hash cannot choose one.
_MUSH_HERO_AT = None


def _giant_tier(x, y):
    """(allowed, scale multiplier) for a giant mushroom at this place."""
    d = _district_of(x, y)[0]
    if d not in _MUSH_DISTRICTS:
        return (False, 0.0)
    if _MUSH_HERO_AT is not None and \
            math.hypot(x - _MUSH_HERO_AT[0], y - _MUSH_HERO_AT[1]) < 1500.0:
        return (True, 2.55)                   # THE hero: ~26 m across
    if d == _MUSH_HERO_DISTRICT:
        return (True, 1.75)
    # one in three of the wild quarters carries one, and it is a medium
    return (_rnd(round(x / 400.0), round(y / 400.0), 181) < 0.42, 1.0)


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
            out.append(A("terrace_platform", cx, cy, ROAD_Z, yaw=90,
                         sxyz=(length / 1440.0, width / 740.0, 0.35),
                         mat="MI_V2_PlazaCream", label="%s_Paved%d" % (tag, i)))
        else:                              # a run along X
            length = max(dx, width)
            out.append(A("terrace_platform", cx, cy, ROAD_Z, yaw=0,
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
        A("terrace_platform", sgn * 2650, 400, ROAD_Z, yaw=90,
          sxyz=(0.62, 0.44, 0.35), mat="MI_V2_PlazaCream", label="%s_EntryApron" % tag),
        # YAW 90 SWAPS WHICH SCALE AXIS IS WHICH. terrace_platform is 1440
        # along X and 740 along Y; turned 90 degrees its X extent comes from
        # sy and its Y extent from sx. The first version of this line read as
        # if it did not: it put an 851 x 432 slab centred at x=3480, which
        # overlapped the parterre's outer edge at 3580 and stopped 400 uu
        # short of the arch it was supposed to lead from. The gap to pave runs
        # x 2650 (arch) to 3580 (bed edge), so 930 along X and 300 across.
        A("terrace_platform", sgn * 3115, 520, ROAD_Z, yaw=90,
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
        A("floral_arch", sgn * 3115, 520, 0, yaw=90, s=0.6, mat="MI_V2_PetalWhite",
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
    A("garden_lawn", sgn * 5250, 3500, GROUND_Z, sxyz=(0.92, 1.53, 1.0),
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
            out.append(A("terrace_platform", cx, cy, ROAD_Z, yaw=yaw,
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
    allowed, tier = _giant_tier(cx, cy)
    if allowed:
        out += _giant_mushroom(gx, gy, seed + 30, "%s_Giant" % tag,
                               s=(0.85 + 0.35 * _rnd(seed, 8, 1)) * tier * 0.95,
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
                         ROAD_Z, yaw=math.degrees(math.atan2(py - prev[1], px - prev[0])),
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
        out += _tree(x, y, seed, i, "%s_Tree" % tag, sc=sc, mix="wood")
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
    # THE CLEARING RIM, IN MUSHROOM COUNTRY.
    #
    # `rad` starts at 900 uu, so a wood has a nine-metre clearing at its heart
    # and that is right: it is where the bench and the signpost go and where a
    # player can stand. But measuring what is actually within fifteen metres of
    # that spot found thirteen things, none of them a mushroom -- the NEAREST
    # ONE WAS 22 M AWAY, in the mushroom wood. The quarter has twenty of them
    # and the whole ring of trees, and a player standing at the heart of the
    # place could see none of the thing it is named for.
    #
    # Three at the rim, where the trees begin, at the angles the trees leave
    # open. They frame the clearing rather than filling it: the standing spot,
    # the bench and the route through stay clear, which the world route solve
    # re-checks at an 80 uu capsule. Woods outside mushroom country get
    # nothing, because "some districts have none" is the hierarchy.
    if _giant_tier(cx, cy)[0]:
        for k in range(3):
            a = lean + 2.094 * k + 0.9 * _rnd(seed, k, 61)
            rad_m = (1000.0 + 320.0 * _rnd(seed, k, 62)) * sp
            out.append(A("mushroom_medium", cx + math.cos(a) * rad_m,
                         cy + math.sin(a) * rad_m, 0,
                         yaw=_rnd(seed, k, 63) * 360.0,
                         s=(1.15 + 0.45 * _rnd(seed, k, 64)) * sc,
                         mat=("MI_V2_MushRed", "MI_V2_MushPurple",
                              "MI_V2_MushTerracotta")[(seed + k) % 3],
                         label="%s_Rim%d" % (tag, k)))

    # ONE thing standing clear of the mass. Which one is the wood's identity,
    # and it is chosen by the field rather than alternated, so neighbouring
    # woods are not reliably different in the way a pattern is.
    lx, ly = cx + sgn * 1500.0 * sp, cy - 1200.0 * sp
    ls = H["landmark_scale"]
    pick = _vnoise(cx, cy, 7000.0, 5501)
    allowed, tier = _giant_tier(cx, cy)
    if pick < 0.40 and allowed:
        out.append(A("stone_ring_base", lx, ly, -2, s=1.6 * ls, mat="MI_V2_Stone",
                     label="%s_Ring" % tag))
        out += _giant_mushroom(lx, ly, seed + 41, "%s_Giant" % tag,
                               s=(0.9 + 0.4 * _rnd(seed, 8, 2)) * tier * 0.95,
                               tint=("MI_V2_MushRed", "MI_V2_MushPurple",
                                     "MI_V2_MushTerracotta")[seed % 3])
    elif pick < 0.40:
        # a wood outside the mushroom country still wants a marker, at the
        # scale of a garden ornament rather than a landmark
        out += [
            A("stone_ring_base", lx, ly, -2, s=1.0 * ls, mat="MI_V2_Stone",
              label="%s_Ring" % tag),
            A("mushroom_landmark", lx, ly, 0, yaw=_rnd(seed, 1, 2) * 360.0, s=1.3 * ls,
              mat="MI_V2_MushTerracotta", label="%s_Landmark" % tag),
        ]
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
                     cy + (0.5 - k) * 2600.0 * sp, GROUND_Z,
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
    for k, yaw in enumerate((0.0, 90.0)):
        out.append(A("terrace_platform", cx, cy, ROAD_Z, yaw=yaw,
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
                     cy + math.sin(a) * 1250.0 * sp, ROAD_Z, yaw=yaw,
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
            A("terrace_platform", cx + math.cos(ra) * d, cy + math.sin(ra) * d, ROAD_Z,
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
    return out


def _quarter_lake(cx, cy, sgn, seed, tag, H=None):
    """A LAKE -- the water feature at the scale the boards actually draw.

    Twelve fountains across the world is a lot of water and none of it is
    BIG, and the boards' water panel is not twelve fountains: it is a sheet of
    water with a rim, planting at its edge and something to cross it by. There
    was no room left to put a lake between the quarters -- the widest clear
    spot in the whole southern half measures under 25 m -- so a lake is a KIND
    of quarter instead, and the Water Gardens district makes some of its
    quarters lakes.
    
    The sheet is `garden_lawn` wearing MI_V2_Water: 48 x 48 of displaced grid,
    which under a water material is ripple rather than plate. Sunk 8 uu so the
    shore has an edge, with an island at its middle carrying the fountain, a
    balustrade rim broken where the path comes down, reeds at the water line
    and seats facing it.
    """
    H = H or HIER(cx, cy)
    sp, sc = H["spacing"], H["scale"]
    out = []
    w = 0.52 * sp
    yaw0 = (seed * 29) % 90
    out.append(A("garden_lawn", cx, cy, GROUND_Z, yaw=yaw0, sxyz=(w, w * 0.88, 1.0),
                 mat="MI_V2_Water", label="%s_Water" % tag))
    rx, ry = 6004.0 * w * 0.5, 7197.0 * w * 0.88 * 0.5
    # the rim, broken where the path comes down to the water
    n_rim = _n(16, 0.6 + 0.6 * H["density"], 10)
    for i in range(n_rim):
        a = 6.283 * i / n_rim
        px, py = cx + math.cos(a) * rx * 1.04, cy + math.sin(a) * ry * 1.04
        if 0.20 < (i / float(n_rim)) < 0.30:
            continue                          # the slipway
        out.append(A(("balustrade", "kerb_stone")[i % 2], px, py, 0,
                     yaw=math.degrees(a) + 90.0,
                     sxyz=(1.0, 1.0, 1.0) if i % 2 == 0 else (3.0, 1.0, 0.6),
                     mat=("MI_V2_IvoryStone", "MI_V2_Kerb")[i % 2],
                     label="%s_Rim%d" % (tag, i)))
        if i % 4 == 0:
            out += [
                A("pedestal_finial", px, py, 0, s=0.6 * sc, mat="MI_V2_IvoryStone",
                  label="%s_Post%d" % (tag, i)),
                A("gate_finial_ball", px, py, 84.0 * sc, s=0.36 * sc, mat="MI_V2_Gold",
                  label="%s_Lamp%d" % (tag, i)),
            ]
    # THE ISLAND, and what stands on it
    fs = (1.0 + 0.4 * (H["landmark_scale"] - 1.0)) * sc
    out += [
        A("stone_ring_base", cx, cy, -2, s=2.4 * fs, mat="MI_V2_Stone",
          label="%s_Island" % tag),
        A("fountain_basin", cx, cy, 0, s=1.15 * fs, mat="MI_V2_IvoryStone",
          label="%s_Basin" % tag),
        A("fountain_water", cx, cy, 0, s=1.15 * fs, mat="MI_V2_Water",
          label="%s_BasinWater" % tag),
        A("fountain_finial", cx, cy, 300.0 * fs, s=1.15 * fs, mat="MI_V2_Gold",
          label="%s_Finial" % tag),
    ]
    # A WAY ACROSS. `castle_bridge` has been used exactly once in this world,
    # inside the castle groups, and a lake is what a bridge is for.
    out.append(A("castle_bridge", cx, cy - ry * 0.55, 60.0, yaw=yaw0, s=0.5 * sc,
                 mat="MI_V2_IvoryStone", label="%s_Bridge" % tag))
    # reeds at the water line, and the path that runs round it
    for i in range(_n(10, 0.6 + 0.8 * H["veg"], 5)):
        a = 6.283 * _rnd(i, seed, 61)
        px = cx + math.cos(a) * rx * (0.96 + 0.10 * _rnd(i, seed, 62))
        py = cy + math.sin(a) * ry * (0.96 + 0.10 * _rnd(i, seed, 62))
        out.append(A(("lavender_stems", "shrub_flowering", "rose_bush")[i % 3], px, py, 0,
                     yaw=_rnd(i, seed, 63) * 360.0,
                     s=(0.9 + 0.4 * _rnd(i, seed, 64)) * sc,
                     mat=("MI_V2_LeafMid", "MI_V2_LeafDark")[i % 2],
                     label="%s_Reed%d" % (tag, i)))
    n_path = _n(12, H["density"], 8)
    for i in range(n_path):
        a0 = 6.283 * i / n_path
        a1 = 6.283 * (i + 1) / n_path
        x0, y0 = cx + math.cos(a0) * rx * 1.22, cy + math.sin(a0) * ry * 1.22
        x1, y1 = cx + math.cos(a1) * rx * 1.22, cy + math.sin(a1) * ry * 1.22
        d = math.hypot(x1 - x0, y1 - y0) or 1.0
        out.append(A("terrace_platform", (x0 + x1) * 0.5, (y0 + y1) * 0.5, ROAD_Z,
                     yaw=math.degrees(math.atan2(y1 - y0, x1 - x0)),
                     sxyz=(d / 1440.0, 0.20, 0.35), mat="MI_V2_PlazaCream",
                     label="%s_Walk%d" % (tag, i)))
    for k, a in enumerate((0.6, 2.7, 4.4)):
        bx = cx + math.cos(a) * rx * 1.30
        by = cy + math.sin(a) * ry * 1.30
        out.append(A("garden_bench", bx, by, 0,
                     yaw=math.degrees(math.atan2(cy - by, cx - bx)),
                     s=1.05 * sc, mat="MI_V2_IvoryStone",
                     label="%s_Bench%d" % (tag, k)))
    out.append(A("signpost", cx + rx * 1.34, cy, 0, yaw=180.0, s=1.15 * sc,
                 mat="MI_V2_IvoryStone", label="%s_Sign" % tag))
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
    out.append(A("terrace_platform", cx, cy, ROAD_Z, yaw=yaw0,
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
        out.append(A("terrace_platform", (x + cx) * 0.5, (y + cy) * 0.5, ROAD_Z,
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
    out.append(A("terrace_platform", cx, cy, ROAD_Z, yaw=(seed * 17) % 90,
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
                     cy + math.sin(lean + 2.1 * k) * 2200.0 * sp, GROUND_Z,
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
        out += _tree(x, y, seed, i, "%s_Tree" % tag, sc=sc * 1.1, mix="meadow")
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


#: A ROAD HAS A CHARACTER, and the character says where it goes.
#:
#: 139 roads is enough infrastructure to expose the next problem: every one of
#: them was the same two cream slabs alternating, at whatever width its caller
#: passed. A player crossing this world could not tell a royal approach from a
#: track through a wood, and a road that does not say where it leads is
#: navigation furniture rather than a place.
#:
#: One FAMILY -- always terrace_platform, always the plaza tints -- with six
#: contextual variations, because a different material every hundred metres is
#: the other failure. What changes is the surface mix, the width, how long a
#: slab runs, and whether the way has a kerb:
#:
#:   royal    pale formal stone, kerbed, long slabs      the castle approach
#:   ring     the navigational backbone: warm, kerbed    recognisable anywhere
#:   garden   smaller elegant paving, kerbed             between garden rooms
#:   court    grey architectural paving, kerbed          tower districts
#:   wood     narrow, warm-grey, unkerbed, short slabs   organic, through trees
#:   trail    narrowest, shaded stone, unkerbed          meadow and open country
_ROAD_STYLE = {
    "royal":  (("MI_V2_PlazaCream", "MI_V2_PlazaCream", "MI_V2_PlazaWarm"), 1.00, 1500.0, True),
    "ring":   (("MI_V2_PlazaWarm", "MI_V2_PlazaCream", "MI_V2_PlazaWarm"), 0.92, 1400.0, True),
    "garden": (("MI_V2_PlazaCream", "MI_V2_PlazaWarm", "MI_V2_PlazaGrey"), 0.80, 1000.0, True),
    "court":  (("MI_V2_PlazaGrey", "MI_V2_PlazaCream", "MI_V2_PlazaGrey"), 0.86, 1200.0, True),
    "wood":   (("MI_V2_PlazaWarm", "MI_V2_PlazaShade", "MI_V2_PlazaWarm"), 0.62, 820.0, False),
    "trail":  (("MI_V2_PlazaShade", "MI_V2_PlazaWarm", "MI_V2_PlazaShade"), 0.52, 900.0, False),
}
#: Which style a road serving this KIND of place wears.
_ROAD_STYLE_FOR = {"garden": "garden", "court": "garden", "clockyard": "court",
                   "towers": "court", "hamlet": "court", "water": "garden",
                   "lake": "garden", "tea": "garden", "grove": "wood",
                   "wood": "wood", "meadow": "trail"}


def _road(x0, y0, x1, y1, width, tag, n=None, style="ring"):
    """A paved way between two points, laid as segments along its run.

    Roads are what make a ring of quarters a WORLD rather than a set of
    islands: the founder's test is that a player should feel 'I can keep
    going', and that is a question about connection, not about content.
    """
    mats, wmul, seg_len, kerbed = _ROAD_STYLE.get(style, _ROAD_STYLE["ring"])
    width = width * wmul
    out = []
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy)
    if n is None:
        n = max(1, int(length / seg_len))
    yaw = math.degrees(math.atan2(dy, dx))
    ux, uy = (dx / length, dy / length) if length else (1.0, 0.0)
    for i in range(n):
        t0, t1 = i / float(n), (i + 1) / float(n)
        cx, cy = x0 + dx * (t0 + t1) * 0.5, y0 + dy * (t0 + t1) * 0.5
        seg = length / n
        out.append(A("terrace_platform", cx, cy, ROAD_Z, yaw=yaw,
                     sxyz=(seg / 1440.0, width / 740.0, 0.35),
                     mat=mats[i % 3], label="%s_Seg%d" % (tag, i)))
        # THE KERB is what makes paving read as a made road rather than a
        # slab dropped on grass, and it is the cheapest edge in the kit: two
        # stretched kerb_stones per segment, instanced with everything else.
        if kerbed:
            for k, side in enumerate((-1.0, 1.0)):
                out.append(A("kerb_stone", cx - uy * width * 0.55 * side,
                             cy + ux * width * 0.55 * side, -2.0, yaw=yaw,
                             sxyz=(seg / 120.0, 1.0, 0.5), mat="MI_V2_Kerb",
                             label="%s_Kerb%d_%d" % (tag, i, k)))
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
    # no garden in this palette: a district called the Water Gardens should
    # arrive at a garden by FALLING BACK to one, not by choosing it
    ("Water Gardens",    248.0, 12000.0, ("lake", "water", "water")),
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
          "hamlet": 2000.0, "meadow": 3800.0,
          # MEASURED off the builder, like the rest: the sheet is
          # garden_lawn at 0.52 * spacing (half-width 1,560 uu at spacing 1)
          # and the path ring sits at 1.22 of that. 2,600 was a guess and it
          # made the lake so demanding that both candidates fell back to a
          # fountain -- the kind existed and the world had none of it.
          "lake": 1900.0}
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
         "hamlet": 0.76, "meadow": 0.30, "lake": 0.90}


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
    "lake":      ("water", "garden", "grove"),
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

# THE HERO MUSHROOM. Chosen from the world rather than written down: the grove
# of the Mushroom Grove nearest that district's own seed radius, so it stands
# in the middle of its country rather than on its edge.
_hero_seed_r = dict((n, r) for (n, _b, r, _k) in _DISTRICT_SEEDS)[_MUSH_HERO_DISTRICT]
_hero_candidates = [s for s in SITES
                    if s.get("district") == _MUSH_HERO_DISTRICT and s["kind"] in ("grove", "wood")]
if _hero_candidates:
    _h = min(_hero_candidates,
             key=lambda s: abs(math.hypot(s["x"], s["y"]) - _hero_seed_r))
    _MUSH_HERO_AT = (_h["x"], _h["y"])
    SITE_NOTES.append("hero mushroom at %s (%.0f, %.0f)" % (_h["tag"], _h["x"], _h["y"]))

_QUARTER_BUILDERS = {"garden": _quarter_garden, "towers": _quarter_towers,
                     "grove": _quarter_grove, "wood": _quarter_wood,
                     "clockyard": _quarter_clockyard, "water": _quarter_water,
                     "tea": _quarter_tea, "court": _quarter_court,
                     "hamlet": _quarter_hamlet, "meadow": _quarter_meadow,
                     "lake": _quarter_lake}


#: BLOSSOM. The reference boards' vegetation panel is not one green: it shows
#: flowering trees through the gardens and the woods, and the first world
#: render came back with a canopy that is uniformly mid-green from 50 m to the
#: horizon. `canopy_large` wearing a petal material IS a blossom tree -- the
#: same trick `blossom_cluster` already uses -- so a share of every wood's
#: crowns flower. Kept to a fifth: the boards' blossom is an accent through
#: green, not an orchard.
_BLOSSOM = ("MI_V2_PetalPink", "MI_V2_RosePink", "MI_V2_PetalWhite",
            "MI_V2_PetalViolet", "MI_V2_Lavender", "MI_V2_PetalRose")
#: A DELIBERATE REVERSAL, and worth stating as one. This was pulled to 0.08
#: from 0.20 because 31% flowering canopy read as an orchard rather than an
#: accent. The founder's brief now asks for the opposite in as many words --
#: "reduce green dominance ... controlled rose, pink, lavender, cream, aged
#: gold" -- so the earlier calibration is superseded, not forgotten. 0.20 with
#: the BLOSSOM tree form on top lands the world's canopy near a quarter
#: flowering, and the greens themselves now carry the rest of the colour.
_BLOSSOM_SHARE = 0.20

#: THE GREENS WERE ONE HUE AT THREE VALUES. Thinning a forest of one colour
#: leaves a thinner forest of one colour, so the green half of the canopy is
#: now a real palette: half of it the original mid-greens, the rest cream,
#: aged gold, copper and blue-green -- foliage colours, carrying the brief's
#: warmth at canopy scale where a blossom cluster is too small to reach.
_LEAF_MIX = ("MI_V2_LeafMid", "MI_V2_LeafDark", "MI_V2_LeafLight",
             "MI_V2_LeafMid", "MI_V2_LeafDark", "MI_V2_LeafLight",
             "MI_V2_LeafCream", "MI_V2_LeafGold", "MI_V2_LeafCopper",
             "MI_V2_LeafBlue", "MI_V2_LeafCream", "MI_V2_LeafGrey")


def _leaf(i, seed, salt=0):
    """The material for one crown: mostly leaf, sometimes flower.

    The green is drawn on the HASH rather than on `i % 3`. The modulo made a
    tree's three crowns one of each green every time, which averages to a
    single colour at any distance -- the exact reason the canopy read as one
    material however many tones were in the table.
    """
    if _rnd(i, seed, 160 + salt) < _BLOSSOM_SHARE:
        return _BLOSSOM[int(_rnd(i, seed, 161 + salt) * len(_BLOSSOM)) % len(_BLOSSOM)]
    return _LEAF_MIX[int(_rnd(i, seed, 162 + salt) * len(_LEAF_MIX)) % len(_LEAF_MIX)]


#: FOUR FORMS FROM TWO MESHES.
#:
#: The forest mass works at macro scale and reads at close range as one tree
#: asset stamped hundreds of times: every tree in this world was a trunk with
#: ONE canopy centred on it, at a scale between 0.9 and 1.7. Two meshes cannot
#: become four species, but they can become four SILHOUETTES -- which is what
#: the eye actually reads at 20 m and beyond -- by varying the trunk's height
#: against its canopy's width, how many canopies overlap, and how far off the
#: axis they sit.
#:
#:   broad     mature trunk, three overlapping canopies, wide and low
#:   tall      slender trunk stretched, one small high canopy
#:   blossom   slender trunk, two canopies, always flowering
#:   old       mature trunk at large scale, one huge asymmetric canopy
#:
#: The weights are the forest's composition and they are the whole of the
#: variety knob: `_TREE_MIX` per context rather than a global.
#: The BLOSSOM form carries two canopies, so its weight counts roughly double
#: in the frame: at 0.16-0.26 the world's canopy came out 21% flowering, which
#: is still an orchard. These land it near 14%.
#: BLOSSOM WEIGHTS RAISED with _BLOSSOM_SHARE and for the same reason: the
#: founder's brief asks for less green dominance, and the flowering FORM is
#: the one that changes a crown's silhouette as well as its colour.
_TREE_MIX = {"wood":   (0.34, 0.26, 0.18, 0.22),
             "grove":  (0.36, 0.21, 0.27, 0.16),
             "country":(0.30, 0.29, 0.17, 0.24),
             "edge":   (0.28, 0.33, 0.25, 0.14),
             "meadow": (0.25, 0.18, 0.22, 0.35)}


def _tree(x, y, seed, i, tag, sc=1.0, mix="wood"):
    """One tree, of one of four forms. Returns its placements."""
    w = _TREE_MIX.get(mix, _TREE_MIX["wood"])
    u = _rnd(i, seed, 170)
    form = 0
    acc = 0.0
    for k, wk in enumerate(w):
        acc += wk
        if u < acc:
            form = k
            break
    yaw = _rnd(i, seed, 171) * 360.0
    out = []
    if form == 0:                              # BROAD
        t = (1.05 + 0.35 * _rnd(i, seed, 172)) * sc
        out.append(A("tree_mature_trunk", x, y, 0, yaw=yaw, s=t, mat="MI_V2_Bark",
                     label="%s_T%d" % (tag, i)))
        for c in range(3):
            a = 6.283 * c / 3.0 + _rnd(i, seed, 173)
            r = 260.0 * t * (0.4 + 0.6 * _rnd(i + c, seed, 174))
            out.append(A("canopy_large", x + math.cos(a) * r, y + math.sin(a) * r,
                         (1180.0 + 190.0 * c) * t, yaw=yaw + 47.0 * c,
                         s=t * (1.05 + 0.18 * _rnd(i + c, seed, 175)),
                         mat=_leaf(i + c, seed, 20 + c),
                         label="%s_C%d_%d" % (tag, i, c)))
    elif form == 1:                            # TALL
        t = (0.95 + 0.4 * _rnd(i, seed, 176)) * sc
        h = 1.45 + 0.35 * _rnd(i, seed, 177)
        out += [
            A("tree_slender_trunk", x, y, 0, yaw=yaw, sxyz=(t * 0.85, t * 0.85, t * h),
              mat="MI_V2_Bark", label="%s_T%d" % (tag, i)),
            A("canopy_medium", x, y, 800.0 * t * h, yaw=yaw + 30.0,
              s=t * 0.92, mat=_leaf(i, seed, 24),
              label="%s_C%d_0" % (tag, i)),
        ]
    elif form == 2:                            # BLOSSOM
        t = (0.90 + 0.30 * _rnd(i, seed, 178)) * sc
        petal = _BLOSSOM[int(_rnd(i, seed, 179) * 4) % 4]
        out.append(A("tree_slender_trunk", x, y, 0, yaw=yaw, s=t, mat="MI_V2_Bark",
                     label="%s_T%d" % (tag, i)))
        for c in range(2):
            a = 3.14 * c + _rnd(i, seed, 180)
            r = 190.0 * t
            out.append(A("canopy_medium", x + math.cos(a) * r, y + math.sin(a) * r,
                         (760.0 + 150.0 * c) * t, yaw=yaw + 90.0 * c,
                         s=t * (1.0 + 0.2 * c), mat=petal,
                         label="%s_C%d_%d" % (tag, i, c)))
    else:                                      # OLD
        t = (1.45 + 0.55 * _rnd(i, seed, 182)) * sc
        out += [
            A("tree_mature_trunk", x, y, 0, yaw=yaw, sxyz=(t * 1.12, t * 1.12, t * 0.86),
              mat="MI_V2_Bark", label="%s_T%d" % (tag, i)),
            A("canopy_large", x + 150.0 * t, y - 110.0 * t, 1130.0 * t * 0.86,
              yaw=yaw, s=t * 1.32, mat=_leaf(i, seed, 26),
              label="%s_C%d_0" % (tag, i)),
        ]
    return out


#: WHAT IS UNDER THE PLAYER, PER PLACE TYPE.
#:
#: The aerial cameras keep showing long stretches of one continuous green, and
#: the slab discovery proved that some of the intended variation was literally
#: buried. The rest of it is that every quarter of every kind laid the same
#: single `MI_V2_Lawn` tile: the ground said nothing about where you were.
#:
#: A place type is recognisable from its floor before it is recognisable from
#: its skyline -- a wood has leaf litter, a village has worn earth in its
#: lanes, a formal garden has mown lawn and a meadow has rough pasture -- so
#: each kind gets a palette rather than a colour, laid as two or three
#: overlapping tiles at different scales and angles so no seam repeats.
#:
#: (material, scale multiplier, offset multiplier) per tile.
_GROUND_LANG = {
    "garden":    (("MI_V2_Lawn", 1.00, 0.0), ("MI_V2_Meadow", 0.62, 0.55)),
    # NO BARE EARTH IN A COURT. Measured on the PASS 28 SkylineRiseCam21
    # frame: the worn-earth tiles read as a large bare wedge across the
    # near-mid ground -- a scar, not a lane. A court is a PAVED yard and
    # since PASS 28 it is dressed with a medallion and a border course, so
    # the soil tile was describing something that is no longer there.
    "court":     (("MI_V2_Lawn", 1.00, 0.0), ("MI_V2_Lawn", 0.55, 0.62),
                  ("MI_V2_Meadow", 0.30, 0.70)),
    "clockyard": (("MI_V2_Lawn", 0.92, 0.0), ("MI_V2_Meadow", 0.50, 0.60)),
    "water":     (("MI_V2_Lawn", 1.00, 0.0), ("MI_V2_Moss", 0.58, 0.58)),
    "lake":      (("MI_V2_Moss", 1.05, 0.0), ("MI_V2_Meadow", 0.60, 0.72)),
    "tea":       (("MI_V2_Lawn", 0.92, 0.0), ("MI_V2_Meadow", 0.52, 0.58)),
    # 0.30, not 0.52: at half a lawn tile these were fields of bare earth
    # rather than the worn lanes they are meant to be.
    "hamlet":    (("MI_V2_Meadow", 0.95, 0.0), ("MI_V2_Dirt", 0.30, 0.42),
                  ("MI_V2_Lawn", 0.46, 0.68)),
    "towers":    (("MI_V2_Lawn", 0.95, 0.0), ("MI_V2_Dirt", 0.26, 0.60)),
    "grove":     (("MI_V2_Mulch", 0.95, 0.0), ("MI_V2_Moss", 0.62, 0.55)),
    "wood":      (("MI_V2_Mulch", 1.10, 0.0), ("MI_V2_Mulch", 0.66, 0.62),
                  ("MI_V2_Moss", 0.52, 0.78)),
    "meadow":    (("MI_V2_Meadow", 1.15, 0.0), ("MI_V2_Meadow", 0.70, 0.66),
                  ("MI_V2_Lawn", 0.48, 0.80)),
}


def _quarter_ground(cx, cy, kind, seed, tag, sp):
    """The floor of one quarter, in its own kind's language."""
    out = []
    for i, (mat, ms, off) in enumerate(_GROUND_LANG.get(kind, _GROUND_LANG["garden"])):
        a = 6.283 * _rnd(i, seed, 190)
        r = off * 1800.0 * sp
        out.append(A("garden_lawn", cx + math.cos(a) * r, cy + math.sin(a) * r,
                     GROUND_Z - i, yaw=(seed * 23 + 47 * i) % 180,
                     sxyz=(0.62 * sp * ms, 0.55 * sp * ms, 1.0),
                     mat=mat, label="%s_Ground%d" % (tag, i)))
    return out


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
            out += _tree(x, y, seed, i, "%s_Edge" % tag, sc=sc * 0.95, mix="edge")
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
        out.append(A("terrace_platform", px, py, ROAD_Z, yaw=yaw,
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
        # AND A FINGERPOST. The founder's test for a road network is that a
        # player believes they can keep going, and the object that answers it
        # is a sign -- which the boards give a panel to and this kit had none
        # of. One at every quarter's approach, turned so a finger points back
        # down the road it arrived by.
        out.append(A("signpost", px - uy * 380.0 * sc, py + ux * 380.0 * sc, 0,
                     yaw=yaw + 180.0, s=1.15 * sc, mat="MI_V2_IvoryStone",
                     label="%s_Signpost" % tag))
    # A SEAT. "Social spaces" is the last line of the founder's list for what
    # a quarter should be able to have, and a social space with nowhere to sit
    # is a lawn. Two, facing in, at a quarter that is dense enough to sit in.
    if H["prop"] > 0.45:
        for k, a in enumerate((0.9, 3.9)):
            bx = cx + math.cos(a) * r0 * 0.56
            by = cy + math.sin(a) * r0 * 0.56
            out.append(A("garden_bench", bx, by, 0,
                         yaw=math.degrees(math.atan2(cy - by, cx - bx)),
                         s=1.05 * sc, mat="MI_V2_IvoryStone",
                         label="%s_Bench%d" % (tag, k)))
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
        # the way wears the character of the place it serves, and the two
        # roads out of the district's own edge wear the royal one
        style = _ROAD_STYLE_FOR.get(s["kind"], "ring")
        if best is None and math.hypot(s["x"], s["y"]) < 13000.0:
            style = "royal"
        out += _road(x0, y0, x1, y1, width, "%s_Road" % s["tag"],
                     n=max(1, int(math.hypot(x1 - x0, y1 - y0) / seg)), style=style)
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
            soft = ("wood", "grove", "meadow")
            lane_style = "wood" if (a["kind"] in soft and b["kind"] in soft) else "garden"
            out += _road(x0, y0, x1, y1, 180.0, tag,
                         n=max(1, int(math.hypot(x1 - x0, y1 - y0) / 1800.0)),
                         style=lane_style)
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
        out += _road(x0, y0, x1, y1, 280.0, "NorthWay%d" % i, style="royal")
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
    # 260 -> 460. THE NORTH GATE WAS A TRAP, and the Dog found it four times.
    #
    # Piers at +/-260 with a 92 uu octagonal plinth leave a 336 uu span. That is
    # five times the Dog's width and it still could not get through: it caught a
    # jamb, slid across the opening and ended SIXTEEN UU INSIDE the far pier's
    # collision at (-168, 6914) -- the same coordinate every run, unable to
    # depenetrate, pushing at it for 25 s a leg while every remaining leg of the
    # tour was abandoned behind it.
    #
    # Four route solvers were tried against this before the world was
    # questioned: a wider capsule, centred waypoints, pinned pinch points, and
    # a clearance-preferring search. Each got the Dog closer and none of them
    # made a 336 uu gate safe, because the failure is not the path -- it is a
    # body that can be pushed into geometry and cannot get out.
    #
    # A gate a walker cannot walk through is a gate that is too narrow,
    # whatever the arithmetic says. 460 gives a 736 uu span, and it still reads
    # as a garden gate rather than a portal.
    for k, side in enumerate((-1, 1)):
        px, py = gx + c * 460.0 * side, gy + s0 * 460.0 * side
        out += [
            A("gate_pier", px, py, 0, yaw=yaw, s=1.0, mat="MI_V2_IvoryStone",
              label="NorthGate_Pier%d" % k),
            A("gate_finial_ball", px, py, 300.0, s=0.7, mat="MI_V2_Gold",
              label="NorthGate_Finial%d" % k),
        ]
    out += [
        # the arch spans the piers, so it grows with them (its own hoop is
        # 190 uu at s=1, and it starts 5.6 m up -- it never was the obstacle)
        A("gate_arch_gold", gx, gy, 0, yaw=yaw, s=1.7, mat="MI_V2_Gold",
          label="NorthGate_Arch"),
        A("garden_urn", gx + c * 620.0, gy + s0 * 620.0, 0, s=0.85, mat="MI_V2_Ceramic",
          label="NorthGate_UrnL"),
        A("garden_urn", gx - c * 620.0, gy - s0 * 620.0, 0, s=0.85, mat="MI_V2_Ceramic",
          label="NorthGate_UrnR"),
        A("signpost", gx + c * 900.0, gy + s0 * 900.0, 0, yaw=yaw + 90.0, s=1.3,
          mat="MI_V2_IvoryStone", label="NorthGate_Sign"),
        A("garden_bench", gx - c * 900.0, gy - s0 * 900.0, 0, yaw=yaw, s=1.05,
          mat="MI_V2_IvoryStone", label="NorthGate_Bench"),
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
            out += _road(x0, y0, x1, y1, width, "RingRoad%d_%02d" % (band, i),
                         style="ring")
            if band == 0:
                out += [
                    A("pedestal_finial", x0, y0 - 900.0, 0, s=0.9, mat="MI_V2_IvoryStone",
                      label="RingMarker%02d" % i),
                    A("gate_finial_ball", x0, y0 - 900.0, 124, s=0.55, mat="MI_V2_Gold",
                      label="RingMarkerCap%02d" % i),
                    A("signpost", x0 + 420.0, y0 - 900.0, 0, yaw=(i * 47) % 360, s=1.2,
                      mat="MI_V2_IvoryStone", label="RingSign%02d" % i),
                    A("garden_bench", x0 - 520.0, y0 - 900.0, 0, yaw=(i * 61) % 360,
                      s=1.0, mat="MI_V2_IvoryStone", label="RingBench%02d" % i),
                ]
    return out


def _outer_world():
    out = []
    for s in SITES:
        H = _squeezed(HIER(s["x"], s["y"]), s.get("squeeze", 1.0))
        sgn = 1 if s["x"] >= 0 else -1
        out += _quarter_ground(s["x"], s["y"], s["kind"], s["seed"], s["tag"],
                               H["spacing"])
        out += _QUARTER_BUILDERS[s["kind"]](s["x"], s["y"], sgn, s["seed"], s["tag"], H=H)
        out += _quarter_edge(s, H)
    out += _road_tree(SITES)
    out += _ring_roads(SITES)
    out += _district_lanes(SITES)
    out += _north_way()
    out += _country()
    out += _district_cam_foregrounds()
    # BUILT framing for the six district cameras that opened onto bare apron.
    # Applied here, beside its vegetation sibling, because both are defined far
    # below the band literals that would otherwise want to call them -- and a
    # module reads top to bottom.
    out += _district_cam_architecture()
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

# ---------------------------------------------------------------------------
# SIX DISTRICT CAMERAS OPENED ONTO NOTHING, AND THE ANSWER IS NOT MORE TREES
#
# `camera_framing.py` reports, for every camera, where its picture of the
# ground begins and how many placements stand in the band between there and
# 3x it. Six came back with ZERO:
#
#     ClockGrandCam23  ColossalKeyCam25  FloatingStairCam26
#     LanternLaneCam27 GlassPavilionCam28 CloisterCam31
#
# Each was added in PASS 28/29 for a landmark that now exists, and each is a
# monument across an empty apron: the eye has nothing to measure the distance
# against, so a 25 m gatehouse at 24 m reads the same size as a 12 m one.
#
# THE EXISTING GENERATOR CANNOT DO THIS JOB. `_district_cam_foregrounds` places
# trees, shrubs, flower beds and hedges, and the founder's instruction for this
# pass is explicit: "Add ARCHITECTURE and vertical layering, not foliage spam",
# "no tree pass as architecture substitute". A near field of shrubs would tick
# the audit and miss the point.
#
# So this places BUILT things, and it keeps the two rules the vegetation
# generator paid for:
#
#   * THE MIDDLE STAYS OPEN. Everything sits off-axis; the subject the camera
#     exists to photograph is never behind foreground.
#   * NOTHING GOES UNDER THE LENS. Depth starts at 1.15x the camera's own
#     d_near, computed from its transform, so a piece cannot land in the strip
#     below the frame -- two passes were spent planting there before
#     `camera_framing.py` existed.
#
# The vocabulary is a terrace edge read from the side: a balustrade run along
# the view, a plinth with an urn on it, and a column standing further out. Low
# things near, tall things at the sides and further back, which is how a real
# forecourt frames a building and why it gives scale where a bush does not.
_CAM_ARCH_TAGS = ("HeroCam23", "HeroCam25", "HeroCam26",
                  "HeroCam27", "HeroCam28", "CloisterCam31")


def _district_cam_architecture():
    try:
        import v2_config as _C
    except Exception:                          # the layout must import alone
        return []
    out = []
    aspect = 16.0 / 9.0
    for cam in getattr(_C, "HERO_CAMS", ()):
        tags = tuple(cam.get("tags", ()))
        if not any(t in _CAM_ARCH_TAGS for t in tags):
            continue
        x, y, z = cam["location"]
        pitch, yaw = cam["rotation"][0], cam["rotation"][1]
        hfov = math.radians(float(cam["fov"]))
        vfov = 2.0 * math.atan(math.tan(hfov / 2.0) / aspect)
        lower = math.radians(pitch) - vfov / 2.0
        if lower >= -1e-6:
            # the camera looks at or above the horizon: its ground never
            # begins, so there is no near field to fill and nothing to do.
            continue
        d_near = z / math.tan(-lower)
        fwd = (math.cos(math.radians(yaw)), math.sin(math.radians(yaw)))
        side = (-fwd[1], fwd[0])
        seed = int(abs(x) + abs(y)) % 9973
        tag = cam["name"]
        across = math.degrees(math.atan2(side[1], side[0]))
        # (depth multiple, lateral fraction of the half-width, what stands there)
        # SIZED FROM THE RENDER, not from the plan (2026-09-03). The first
        # version put the plinths at 1.70x d_near and half the visible
        # half-width, and ClockGrandCam23 and FloatingStairCam26 both came back
        # with an urn eating a quarter of the frame: at 4.4 m and 61% of the
        # way to the edge, a 1 m urn is enormous. Framing is meant to give the
        # eye something to measure the subject against, not to become the
        # subject. Deeper and wider, and the urn itself smaller.
        plan = ((1.25, 0.66, "rail"), (1.25, -0.66, "rail"),
                (2.30, 0.70, "plinth"), (2.30, -0.70, "plinth"),
                (3.10, 0.80, "column"), (3.10, -0.80, "column"))
        for i, (t, latf, kind) in enumerate(plan):
            depth = d_near * t
            half = depth * math.tan(hfov / 2.0)
            lat = latf * half
            px = x + fwd[0] * depth + side[0] * lat
            py = y + fwd[1] * depth + side[1] * lat
            j = _rnd(i, seed, 141)
            if kind == "rail":
                # the run lies ALONG the view, like the edge of a terrace the
                # camera stands on, not a fence across it
                out.append(A("balustrade", px, py, 0,
                             yaw=math.degrees(math.atan2(fwd[1], fwd[0])),
                             s=0.9 + 0.25 * j, mat="MI_V2_IvoryStone",
                             label="%s_ArchRail%d" % (tag, i)))
            elif kind == "plinth":
                s = 0.85 + 0.25 * j
                out += [
                    A("pedestal_finial", px, py, 0, yaw=across, s=s,
                      mat="MI_V2_IvoryStone", label="%s_ArchPlinth%d" % (tag, i)),
                    A("garden_urn", px, py, 150.0 * s, yaw=_rnd(i, seed, 142) * 360.0,
                      # MI_V2_Ceramic is what all twelve other garden_urns in
                      # the world wear. MI_V2_Porcelain was invented here and
                      # the layout gate refused it, which is the gate working.
                      s=s * 0.55, mat="MI_V2_Ceramic",
                      label="%s_ArchUrn%d" % (tag, i)),
                ]
            else:
                out.append(A("column_ornate", px, py, 0, yaw=across,
                             s=1.0 + 0.3 * j, mat="MI_V2_IvoryStone",
                             label="%s_ArchColumn%d" % (tag, i)))
    return out


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
        # KNEE HEIGHT AT THE FRONT, MASS AT THE SIDES -- the rule this project
        # already paid for. HamletCam17's first frame was a wall of leaves
        # because this put trees at 1.15x d_near, which is 5.5 m from a 2.8 m
        # eye, and PASS 12's ledger entry says exactly what that looks like:
        # "a bank of foliage filled the bottom 45% and hid the garden".
        #
        # Depth now starts at 1.6x, a tree needs 2.2x AND to be past 0.58 of
        # the half-width, and anything nearer or more central than that is low
        # planting. The subject keeps the middle of the frame.
        n = 15
        for i in range(n):
            t = 1.6 + 1.7 * _rnd(i, seed, 121)
            depth = d_near * t
            half = depth * math.tan(hfov / 2.0)
            lat = (0.46 + 0.46 * _rnd(i, seed, 122)) * half * (1 if i % 2 else -1)
            far_enough = t > 2.2 and abs(lat) > 0.58 * half
            px = x + fwd[0] * depth + side[0] * lat
            py = y + fwd[1] * depth + side[1] * lat
            pick = _rnd(i, seed, 123)
            if pick < 0.30 and far_enough:
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
                             s=(0.85 + 0.4 * _rnd(i, seed, 128)) * (1.0 if far_enough else 0.62),
                             mat=("MI_V2_LeafMid", "MI_V2_LeafDark")[i % 2],
                             label="%s_FgShrub%d" % (tag, i)))
            elif pick < 0.82:
                out += _ground_patch(px, py, 0, _rnd(i, seed, 129) * 360.0, 1.15,
                                     ("MI_V2_PetalPink", "MI_V2_PetalViolet",
                                      "MI_V2_PetalWhite", "MI_V2_Lavender")[i % 4],
                                     "%s_FgBed%d" % (tag, i))
            elif far_enough:
                out.append(A("hedge_mass", px, py, 0,
                             yaw=math.degrees(math.atan2(side[1], side[0])),
                             s=1.0 + 0.4 * _rnd(i, seed, 130),
                             mat="MI_V2_LeafDark", label="%s_FgHedge%d" % (tag, i)))
            else:
                out += _ground_patch(px, py, 0, _rnd(i, seed, 131) * 360.0, 1.0,
                                     ("MI_V2_RosePink", "MI_V2_Lavender")[i % 2],
                                     "%s_FgLow%d" % (tag, i))
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
        # THE TOWER'S THREE SIBLINGS. `castle_tower` was here and the octagon,
        # square and slender variants were not, so every route solve and every
        # walkable audit ran straight through 38 castle towers as if they were
        # air. The Dog proved it: the exploration route was solved through the
        # tower at (2500, 10300), it walked into real collision on leg 19 of
        # 95, and it never moved again -- 22 legs abandoned, the whole outer
        # world unvisited. This is the richest defect class in this project,
        # a rule applied to one collection and not its siblings, and it hid
        # for as long as it did because a MISSING FOOT ENTRY FAILS OPEN.
        #
        # Measured from the recipes in assets_v2: the square tower's base box
        # is 560 x 560, the slender's revolve profile starts at radius 120,
        # the octagon's buttresses sit at radius 320 on a ~300 drum. The
        # arcade is the walk-through colonnade at 420 x 200.
        "castle_tower_octagon": (300, 300), "castle_tower_square": (280, 280),
        "castle_tower_slender": (120, 120), "castle_arcade": (420, 200),
        # THE TEA DISTRICT'S CROCKERY IS SOLID AND IS THE SIZE OF A BUILDING.
        # Measured from the recipes: the pot reaches 138 uu, the cups 134 and
        # 130, the clock 78. A walker meets all of them. The SAUCER is
        # deliberately absent: at 260 uu it is a flat disc on the ground, a
        # platform you step onto rather than something you go round.
        "tea_pot": (138, 138), "tea_cup": (134, 134),
        "tea_cup_small": (130, 130), "clock_ornate": (78, 78),
        "tower_clock": (176, 176), "column_ornate": (60, 60), "arch_stone": (330, 90),
        "tea_plinth": (200, 200), "stairs_broad": (350, 260),
        "garden_bench": (85, 90), "signpost": (46, 46),
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
                    out += _tree(x, y, k, i, "%s_Tree" % tag, sc=sc, mix="country")
                # MULCH UNDER DENSE PLANTING. The founder's ground list names
                # it and it is the cheapest way a tree mass reads as woodland
                # from above rather than as trees standing on a lawn: two dark
                # organic tiles under the canopy, at different angles.
                for m in range(2):
                    out.append(A("garden_lawn", cx + (m - 0.5) * 1500.0,
                                 cy + (0.5 - m) * 1200.0, GROUND_Z - m,
                                 yaw=(k * 31 + 53 * m) % 180,
                                 sxyz=(0.72 - 0.18 * m, 0.62 - 0.15 * m, 1.0),
                                 mat=("MI_V2_Mulch", "MI_V2_Moss")[m],
                                 label="%s_Floor%d" % (tag, m)))
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
                out.append(A("garden_lawn", cx, cy, GROUND_Z, yaw=(k * 37) % 90,
                             sxyz=(1.1, 0.95, 1.0),
                             mat=("MI_V2_Meadow", "MI_V2_Lawn", "MI_V2_Moss")[k % 3],
                             label="%s_Ground" % tag))
            elif pick < 0.93:
                # ONE SILHOUETTE. Rare, and it is why the horizon has shape.
                h = (1.1 + 0.5 * _rnd(gx, gy, 110)) * sc * H["skyline"] / 1.28
                cap, caph = _far_cap(gx, gy, 2)
                out += [
                    A("tower_capped", cx, cy, 0, yaw=_rnd(gx, gy, 111) * 360.0, s=h,
                      mat="MI_V2_IvoryStone", label="%s_Tower" % tag),
                    A(cap, cx, cy, 1100.0 * h, s=h,
                      mat=("MI_V2_RoofPink", "MI_V2_RoofLilac", "MI_V2_RoofNavy",
                           "MI_V2_RoofBlue")[k % 4], label="%s_TowerCap" % tag),
                    # THE FINIAL RIDES THE CAP, not a constant. 1560 was the
                    # cone's own 1100 + 460; on a crenellated roof it floated
                    # 4.5 m over the parapet and on an ogee it sank into it.
                    A("finial_spire", cx, cy, (1100.0 + caph * 0.82) * h, s=0.7 * h,
                      mat="MI_V2_Gold", label="%s_TowerSpire" % tag),
                ]
                for i in range(3):
                    a = 6.283 * i / 3.0 + 0.4
                    out.append(A("hedge_mass", cx + math.cos(a) * 900.0,
                                 cy + math.sin(a) * 900.0, 0, yaw=60 * i,
                                 s=1.3 * sc, mat="MI_V2_LeafDark",
                                 label="%s_TowerHedge%d" % (tag, i)))
            else:
                # a lone giant, standing in open country the way the boards do
                # it -- but only in the country that has giants
                allowed, tier = _giant_tier(cx, cy)
                out.append(A("stone_ring_base", cx, cy, -2, s=(1.5 if allowed else 0.9) * sc,
                             mat="MI_V2_Stone", label="%s_Ring" % tag))
                if allowed:
                    out += _giant_mushroom(cx, cy, 12000 + k, "%s_Giant" % tag,
                                           s=(0.9 + 0.4 * _rnd(gx, gy, 112)) * tier * 0.9,
                                           tint=("MI_V2_MushRed", "MI_V2_MushPurple",
                                                 "MI_V2_MushTerracotta")[k % 3])
                else:
                    out.append(A("mushroom_landmark", cx, cy, 0,
                                 yaw=_rnd(gx, gy, 113) * 360.0, s=1.25 * sc,
                                 mat="MI_V2_MushTerracotta", label="%s_Landmark" % tag))
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


#: The near band's own centres, so the far band can clear them. Their ridges
#: reach 15,000 uu and the far band's reach 21,000, so two bands that merely
#: do not overlap in RADIUS still put a tower through a hill -- the audit
#: caught two.
_HORIZON_AT = []


#: THE BACKDROP HAD ONE SILHOUETTE AND FOUR COLOURS.
#:
#: `skyline.py`'s ladder is twenty rows of `roof_cone_steep` between 90 and
#: 135 m -- every tower in the far city, the horizon band and the scenic
#: groups caps with the same cone, and only its tint changes. At a kilometre,
#: through fog, tint is the first thing to go and shape is the last, so the
#: whole backdrop reads as one repeated tower. That is exactly the "endless
#: towers" the founder's skyline note asks not to add, already added, and the
#: fix is not fewer of them: it is that a tower group should have a PROFILE.
#:
#: Four caps the kit already has, chosen by hash so a group is mixed and two
#: neighbouring groups are not reliably different in the way a pattern is.
#: Heights are `cap_h`'s, so a finial that sits on top still sits on top.
_FAR_CAPS = ("roof_cone_steep", "roof_bell", "roof_ogee", "roof_flat_crenellated")
_FAR_CAP_H = {"roof_cone_steep": 560.0, "roof_bell": 640.0, "roof_ogee": 800.0,
              "roof_flat_crenellated": 110.0}


def _far_cap(a, b, salt=0):
    """(cap asset, its own height in unscaled uu) for a backdrop tower."""
    cap = _FAR_CAPS[int(_rnd(a, b, 170 + salt) * 4.0) % 4]
    return cap, _FAR_CAP_H[cap]


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
        _HORIZON_AT.append((x, y))
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
                             mat=_leaf(i, k, 4), label="%s_Crown%d" % (tag, i)))
        elif pick < 0.88:
            # a far tower group: three or four, one dominant, fog does the rest
            n = 3 + int(2 * _rnd(k, 141, 7))
            for i in range(n):
                a2 = 6.283 * i / n + _rnd(i, k, 149)
                rr = (700.0 + 1900.0 * _rnd(i, k, 150))
                tx, ty = x + math.cos(a2) * rr, y + math.sin(a2) * rr
                h = (2.6 if i == 0 else 1.5 + 1.0 * _rnd(i, k, 151))
                cap, _caph = _far_cap(i, k, 1)
                out += [
                    A("tower_capped", tx, ty, 0, yaw=_rnd(i, k, 152) * 360.0, s=h,
                      mat="MI_V2_IvoryStone", label="%s_Tower%d" % (tag, i)),
                    A(cap, tx, ty, 1100.0 * h, s=h,
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


# ---------------------------------------------------------------------------
# THE FAR HORIZON  (founder: "a broad flat outer plane beyond the developed
# environment ... it should NOT look like developed Wonderland -> abrupt green
# development plane -> horizon")
# ---------------------------------------------------------------------------
#
# The scenic band runs to 580 m and the GROUND SLAB runs to 1,500 m, so beyond
# the last ridge there is nearly a kilometre of flat green in every direction
# before the world ends at a line. Fog alone has not closed it: the aerial
# frames read developed world, then plane, then a hard edge against the sea
# band.
#
# The answer is not another five kilometres of Wonderland. It is FORM at the
# distance where only form survives: a handful of very large, very sparse
# masses from 650 m to 1,150 m -- wooded ridges and the odd tall silhouette at
# eight to fourteen times normal scale, which at that range read as hills with
# trees on them. Twenty of them, every piece instanced.

_FAR_HORIZON_BAND = (72000.0, 118000.0)
_FAR_HORIZON_TRIES = 90
_FAR_HORIZON_SPACING = 26000.0


def _far_horizon():
    r0, r1 = _FAR_HORIZON_BAND
    kept, out, towered = [], [], []
    for k in range(_FAR_HORIZON_TRIES):
        u = (k + 0.5) / _FAR_HORIZON_TRIES
        r = math.sqrt(r0 * r0 + (r1 * r1 - r0 * r0) * u)
        b = (k * 137.50776405 + 7.0 * _rnd(k, 151, 1)) % 360.0
        a = math.radians(b)
        x, y = math.cos(a) * r, math.sin(a) * r
        if any((qx - x) ** 2 + (qy - y) ** 2 < _FAR_HORIZON_SPACING ** 2
               for (qx, qy) in kept):
            continue
        if any((qx - x) ** 2 + (qy - y) ** 2 < 36000.0 ** 2
               for (qx, qy) in _HORIZON_AT):
            continue                          # the near band holds this ground
        kept.append((x, y))
        tag = "FarHorizon%03d" % len(kept)
        lean = _rnd(k, 151, 2) * 3.1416
        # A RIDGE, at the scale that reads at a kilometre. hedge_mass is 6.4 m
        # across at scale 1; at 8-14 it is a 50-90 m wooded mass, which is a
        # hill with trees on it and costs one instance.
        n = 6 + int(5 * _rnd(k, 151, 3))
        for i in range(n):
            t = -0.5 + i / float(n - 1)
            rx = t * (26000.0 + 16000.0 * _rnd(k, 151, 4))
            ry = (_rnd(i, k, 152) - 0.5) * 7000.0
            s = 8.0 + 6.0 * _rnd(i, k, 153)
            out.append(A("hedge_mass",
                         x + rx * math.cos(lean) - ry * math.sin(lean),
                         y + rx * math.sin(lean) + ry * math.cos(lean), -900.0,
                         yaw=math.degrees(lean) + 14.0 * _rnd(i, k, 154),
                         sxyz=(s, s * 0.72, s * (0.40 + 0.30 * _rnd(i, k, 155))),
                         mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2],
                         label="%s_Ridge%d" % (tag, i)))
        # and now and then something standing on one -- decided below, once
        # every ridge's bearing is known
        towered.append([x, y, k, tag, _rnd(k, 151, 6) < 0.34])

    # WHICH RIDGES GET A SILHOUETTE IS AN ANGULAR QUESTION, NOT A COIN FLIP.
    #
    # The ridges themselves are golden-angle spaced and land evenly. The towers
    # were then chosen by an independent 34% draw per ridge, which is the same
    # as choosing them at random around the circle -- and random points on a
    # circle leave long gaps. Measured on the outer band: 70 tall pieces across
    # 29 of 72 five-degree sectors, with an EMPTY ARC OF 95 DEGREES. A quarter
    # of the horizon had nothing standing above the tree line, so from a
    # good part of the world the place simply stopped at the canopy.
    #
    # Filling every sector would be worse: an even ring of towers is exactly
    # the artificial tier the hierarchy exists to avoid, and 30-40 degrees of
    # open sky between silhouettes is what makes the ones that are there read
    # as distant. So the 34% draw stands, and only ARCS TOO WIDE TO BE SKY get
    # a ridge promoted -- the one nearest the middle of the gap, which is where
    # the eye is looking when it notices the world ended.
    _GAP = 52.0                      # degrees of empty horizon that reads as a void
    bearings = [(math.degrees(math.atan2(t[1], t[0])) % 360.0, i)
                for i, t in enumerate(towered)]
    for _ in range(len(towered)):
        have = sorted(b for (b, i) in bearings if towered[i][4])
        if not have:
            towered[bearings[0][1]][4] = True
            continue
        # the widest gap on the circle, and the bearing at its middle
        widest, mid = 0.0, None
        for j, b in enumerate(have):
            nxt = have[(j + 1) % len(have)]
            gap = (nxt - b) % 360.0 or (360.0 if len(have) == 1 else 0.0)
            if gap > widest:
                widest, mid = gap, (b + gap / 2.0) % 360.0
        if widest <= _GAP:
            break
        # promote the un-towered ridge closest to the middle of that gap
        cand = [(abs(((b - mid + 180.0) % 360.0) - 180.0), i)
                for (b, i) in bearings if not towered[i][4]]
        if not cand:
            break
        towered[min(cand)[1]][4] = True

    for (x, y, k, tag, has_tower) in towered:
        if not has_tower:
            continue
        for i in range(2):
            h = 5.0 + 3.0 * _rnd(i, k, 157)
            tx = x + (i - 0.5) * 3400.0
            cap, _caph = _far_cap(i, k, 3)
            out += [
                A("tower_capped", tx, y, 0, yaw=_rnd(i, k, 158) * 360.0, s=h,
                  mat="MI_V2_IvoryStone", label="%s_Tower%d" % (tag, i)),
                A(cap, tx, y, 1100.0 * h, s=h,
                  mat=("MI_V2_RoofPink", "MI_V2_RoofNavy")[i % 2],
                  label="%s_TowerCap%d" % (tag, i)),
            ]
    return out


HORIZON = _band("V2_Skyline", _horizon() + _far_horizon())


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
            out.append(A("garden_lawn", cx, cy, GROUND_Z - (k % 3),
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
    # PASS 28: A BIGGER FIGURE, because the first one was too small to be
    # seen. Measured on the PlayerCam01 frame, the arrival plaza's paving is
    # the bottom 45% of the founder's own gameplay view and reads as a blank
    # pale field -- the brief's "giant empty modern-plaza feeling" in the one
    # place a player stands still and looks at the ground. The medallion above
    # is 8.6 m across on a 13 m plaza and disappears at eye height.
    #
    # So the figure grows to fill the floor: an outer ring at 15 m, eight
    # radiating spokes between the two rings, and petal drifts off the axis.
    # Everything is `kerb_stone` at 0.11-0.13 of its 28 uu, so it stands 3 uu
    # proud of paving whose own surface is 19 uu -- inside MaxStepHeight 30,
    # and the layout gate checks it rather than this comment being trusted.
    for i in range(24):
        a = 6.283 * i / 24.0 + 0.13
        out.append(A("kerb_stone", cx + math.cos(a) * 760.0, cy + math.sin(a) * 760.0, 2,
                     yaw=math.degrees(a) + 90.0, sxyz=(1.30, 0.50, 0.11),
                     mat=("MI_V2_PlazaShade", "MI_V2_Gold", "MI_V2_PlazaGrey")[i % 3],
                     label="Plaza_Ring%d" % i))
    for k in range(8):
        a = 6.283 * k / 8.0 + 0.39
        for j in range(3):
            r = 500.0 + 105.0 * j
            out.append(A("kerb_stone", cx + math.cos(a) * r, cy + math.sin(a) * r, 2,
                         yaw=math.degrees(a), sxyz=(0.62, 0.34, 0.10),
                         mat=("MI_V2_Gold", "MI_V2_PlazaShade")[j % 2],
                         label="Plaza_Spoke%d_%d" % (k, j)))
    # NO PETAL DRIFTS HERE. The layout gate refused them: "plaza clean" is one
    # of its checks, and the arrival floor is deliberately kept as open paving
    # a participant can stand and gather on. The colour has to come from the
    # STONE, which is why the ring alternates gold, shade and grey rather than
    # scattering flowers over the one surface the brief keeps clear.
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
            # RECOMPOSED, NOT THINNED (batch B). Measured on SkylineCam06, the
            # single largest green mass in Wonderland is this band: canopy_large
            # takes 26.3% of that frame and `ApproachSideL/R_Canopy*` are four of
            # its six biggest individual pieces. They stand 29-64 m off the
            # processional axis and they are what the castle is behind.
            #
            # The answer is not fewer plants -- the brief says do not globally
            # remove vegetation, and a bare processional way is worse than a
            # blocked one. It is WHERE the tall ones stand. Inside 42 m of the
            # axis the band is now beds, ornament and low topiary; beyond it,
            # trees and hedge masses. Same thirty pieces a side, the mass moved
            # outward, and the near band gains the flower colour batch D wants.
            near = abs(x) < 4200.0
            if pick < (0.10 if near else 0.36):
                t = 1.05 + 0.4 * _rnd(i, seed, 4)
                out += [
                    A("tree_mature_trunk", x, y, 0, yaw=_rnd(i, seed, 5) * 360.0, s=t,
                      mat="MI_V2_Bark", label="%s_Trunk%d" % (tag, i)),
                    A("canopy_large", x, y, 1320.0 * t, yaw=_rnd(i, seed, 6) * 360.0,
                      s=t * 1.12, mat=_leaf(i, seed, 8),
                      label="%s_Canopy%d" % (tag, i)),
                ]
            elif pick < (0.22 if near else 0.58):
                out.append(A("hedge_mass", x, y, 0, yaw=_rnd(i, seed, 7) * 40.0,
                             s=1.1 + 0.5 * _rnd(i, seed, 8),
                             mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2],
                             label="%s_Hedge%d" % (tag, i)))
            elif pick < (0.62 if near else 0.74):
                out += _ground_patch(x, y, 0, _rnd(i, seed, 9) * 360.0, 1.1,
                                     ("MI_V2_PetalPink", "MI_V2_PetalViolet",
                                      "MI_V2_PetalWhite", "MI_V2_RosePink")[i % 4],
                                     "%s_Bed%d" % (tag, i))
            elif pick < (0.84 if near else 0.88):
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
            out.append(A("garden_lawn", side * 4600.0, 3200.0 + 2700.0 * k, GROUND_Z,
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


# ===========================================================================
# THE SIGNATURE SKYLINE  (ENCHANTMENT + VERTICALITY, batch A)
# ===========================================================================
#
# THE MEASUREMENT THAT FORCED THIS. `tools/skyline.py` builds every recipe on
# the offline backend, reads its bounding box, and reports each placement's
# real top. Over the walkable world before this band existed:
#
#   height p50 6.5 m   p90 32.1 m   max 127.7 m
#   80-120 m ....  4 pieces      120 m+ .... 2 pieces
#   tallest : second distinct site .... 1.46x
#
# The second-tallest thing in Wonderland was a hot-air balloon, and twelve of
# the eighteen tallest sites were balloons. Ranked by the angle they subtend
# from a player's eye -- which is what a skyline IS -- seven of the eighteen
# largest presences in the world were TREE CANOPIES and the tallest piece of
# architecture came eleventh.
#
# THE LADDER THIS BUILDS, and why each rung is where it is:
#
#   1  THE GREAT SPIRE, 194 m, on the arrival axis at 330 m.
#      On-axis is not a compromise, it is the composition: gate -> plaza ->
#      path -> arch -> castle -> and then, far beyond and twice the castle's
#      angular height, the spire. The castle keeps the focal plane and the
#      spire owns the distance, which is what "preserve castle importance"
#      and "one dominant spire" mean together rather than in conflict.
#      Its height is SET BY THE FROZEN CAMERA: HeroCam0's vertical half-field
#      is 33.8 deg at 16:9, so at 331.5 m anything over about 200 m has its
#      tip cut off in the founder's benchmark frame. 194 m subtends 30.5 deg
#      against the 19.5 deg of the cluster it replaces as the anchor.
#      The 12-deg-clear axis corridor PASS 06 established is why there is
#      nothing to move: 0 pieces stand within 30 m of this point.
#
#   2  TWO SIGNATURE SPIRES, 150 m and 138 m, at bearings 30 and 128 deg.
#      Both are OUTSIDE HeroCam0's 50 deg half-field, deliberately. Three
#      near-equal towers in one frame is a row, not a hierarchy; and the
#      brief asks for negative sky. They are what the player turns to see,
#      and they give East Reach and Tower Rise a reason to be named.
#      Different radii and different heights, because a symmetric pair reads
#      as staging.
#
#   3  SEVEN DISTRICT TOWERS, 71-91 m, one per inner district that should
#      have a built landmark. This is the rung the world was missing
#      entirely: 4 pieces stood between 80 and 120 m and 65 between 50 and
#      80, so the skyline went from neighbourhood tower straight to nothing.
#
# Nothing here is placed on a guessed coordinate. Every site is searched
# outward from its district's own seed until it clears the world that is
# already standing there, and the search reports what it moved and why.

#: uu. How much open ground a signature landmark needs around its own
#: footprint. A 194 m spire growing out of a hedge is not a landmark.
_SIG_CLEAR = {"spire_great": 7000.0, "spire_signature": 2200.0,
              "tower_district": 1500.0}

#: Measured half-footprints, in unscaled uu, from the recipes above:
#: spire_great's cathedral body reaches 5,120 (the transept gables, measured
#: off the built mesh in PASS 29 -- it was 1,580 when the recipe was a bare
#: plinth); spire_signature's base skirt is 880; tower_district's plinth box
#: is 1240 across. The halo rings are in the air and are not obstacles.
FOOT.update({"spire_great": (5250, 5250), "spire_signature": (880, 880),
             "tower_district": (620, 620)})

# ---------------------------------------------------------------------------
# WHAT A GATE IS: PIERS THAT BLOCK AND AN OPENING THAT DOES NOT (2026-09-03)
#
# `FOOT` gives one axis-aligned half-extent pair per asset, and a THRESHOLD
# cannot be said in that language. `route.py` knew it and wrote the reason down
# next to its own workaround:
#
#     "gatehouse_district is a THRESHOLD: its solid parts are a ring around a
#      5.2 m opening the road runs through, and one axis-aligned rectangle can
#      only express that by blocking the arch."
#
# So it was declared soft -- excluded from the solve entirely -- and that is
# FAIL-OPEN. The route solver drew a line straight through the gatehouse's
# PIERS, and on 2026-09-03 the first real-GPU traversal of this world wedged
# the canonical Relay Dog inside `DPClockQuarter_Gatehouse`'s wall at
# (14143, 1086), where it failed leg after leg from identical coordinates and
# the 262-leg route could not finish. The reasoning was right and the fallback
# was the only thing available; this is the missing third option.
#
# A part is (local_x, local_y, half_x, half_y) in uu at scale 1, in the piece's
# own frame, and every number below is READ OFF THE RECIPE that builds the
# mesh rather than estimated from its bounding box:
#
#   gatehouse_district  towers  box(700,700,...) at y = +/-900  -> half 350
#                       walls   box(340,330,...) at y = +/-425  -> half 170x165
#                       leaving |y| < 260, which is the 5.2 m arch its own
#                       docstring names.
#   garden_arch_stone   pilasters box(120, D+30=120, ...) at x = +/-R = +/-350
#   lantern_swag        posts   box(260,260,140) at x = +/-SPAN = +/-1500;
#                       33 m of catenary between them is air, and treating the
#                       swag as one block would have walled off 35.9 m of
#                       ground for two 2.6 m posts.
#   floral_arch         posts   box(40,40,130) at x = +/-R = +/-500
#
# NOT LISTED, ON PURPOSE. `bridge_arc` says in its own comment that the arch
# springs from abutments "moved OFF the walking line to the banks" and has no
# central pier -- it is a surface you cross, not a thing you go around.
# `castle_bridge` is the same. `glass_screen_panes` and `vine_wall` are glazing
# and ivy riding a frame that is itself solid. `fountain_grand_water` is the
# water inside `fountain_grand`, which is already in FOOT at (680, 680).
# Each of those is a considered non-obstacle, which is what `_SOFT_OK` is for;
# what was wrong was putting load-bearing masonry in the same bucket.
FOOT_PARTS = {
    "gatehouse_district": ((0.0, -900.0, 350.0, 350.0), (0.0, 900.0, 350.0, 350.0),
                           (0.0, -425.0, 170.0, 165.0), (0.0, 425.0, 170.0, 165.0)),
    "garden_arch_stone":  ((-350.0, 0.0, 60.0, 60.0), (350.0, 0.0, 60.0, 60.0)),
    "lantern_swag":       ((-1500.0, 0.0, 130.0, 130.0), (1500.0, 0.0, 130.0, 130.0)),
    "floral_arch":        ((-500.0, 0.0, 20.0, 20.0), (500.0, 0.0, 20.0, 20.0)),
}


def solid_boxes(it):
    """Every solid box a placement contributes, in WORLD space.

    Yields (cx, cy, half_x, half_y, yaw_radians). One implementation, so the
    walkability flood, the route solver and any gate that comes later cannot
    hold different opinions about what is solid -- the failure PASS 09 fixed
    when the builder walked one band list and `ALL` was another.

    A piece with parts contributes those parts; a piece with a plain `FOOT`
    entry contributes one box; anything else contributes nothing and its
    caller decides whether that silence was considered.
    """
    a = it["asset"]
    sc = it["scale"]
    sx, sy = ((abs(sc[0]), abs(sc[1])) if isinstance(sc, (list, tuple))
              else (abs(sc), abs(sc)))
    yaw = math.radians(it["rot"][1])
    co, si = math.cos(yaw), math.sin(yaw)
    ox, oy = it["pos"][0], it["pos"][1]
    parts = FOOT_PARTS.get(a)
    if parts:
        for (lx, ly, hx, hy) in parts:
            # the part's own offset turns with the piece; its half-extents are
            # already in the piece's frame and stay there, which is what the
            # oriented-rectangle test downstream expects.
            px, py = lx * sx, ly * sy
            yield (ox + px * co - py * si, oy + px * si + py * co,
                   hx * sx, hy * sy, yaw)
        return
    f = FOOT.get(a)
    if f:
        yield (ox, oy, f[0] * sx, f[1] * sy, yaw)

_SIG_PLACED = []
SIG_NOTES = []


def _sig_free(x, y, need):
    """Is there `need` uu of clear ground here, against the world as built?

    SOFT SCATTER DOES NOT BLOCK. The first run of this required clear ground
    against everything and six of seven district towers could not be placed:
    the inner districts are full, and what they are full of is mostly hedges,
    topiary and trees. Vegetation growing where a landmark should stand is
    already a solved problem here -- `_declutter` removes scatter that has
    grown through a protected asset -- so requiring virgin ground was asking
    the wrong question and would have pushed every district landmark out into
    the fields between the districts it was meant to name.

    Surfaces do not block either: a tower standing on a road is standing on a
    road, and that is correct.
    """
    surface = ("garden_lawn", "terrace_platform", "ground_flowers", "ground_blooms",
               "flagstone", "kerb_stone", "sky_dome", "path_steps", "side_steps")
    for band in (OUTER_WORLD, HORIZON, PALACE, GROUND_QUILT, FLANKS, REARWORLD):
        for p in band:
            a = p["asset"]
            if a in surface or a in _SOFT or a.startswith("cloud_") or a.startswith("sea_"):
                continue
            px, py = p["pos"][0], p["pos"][1]
            if abs(px - x) > need + 800.0 or abs(py - y) > need + 800.0:
                continue
            hx, hy = FOOT.get(a, (180, 180))
            sx, sy = abs(p["scale"][0]), abs(p["scale"][1])
            if math.hypot(px - x, py - y) < need + max(hx * sx, hy * sy):
                return False
    for (px, py, pr) in _SIG_PLACED:
        if math.hypot(px - x, py - y) < need + pr:
            return False
    return True


def _sig_site(bearing_deg, radius, need, name, district=None):
    """The nearest point to (bearing, radius) with `need` uu of clear ground.

    SEARCHED IN COST ORDER, and the cost is not symmetric. A bearing is a
    COMPOSITION decision -- which way the player looks to see this thing, and
    whether it stands in the frozen hero frame -- and a radius is only how far
    away it is. Weighting them equally moved a signature spire 26 deg round
    the world and put it 12 deg off the arrival axis, beside the great spire
    it was meant to be the alternative to. A degree of bearing therefore costs
    what 700 uu of radius costs, so this walks outward before it walks
    sideways.
    """
    b0 = math.radians(bearing_deg)
    cands = []
    for dr in [900.0 * k for k in range(-8, 13)]:
        for db in [2.0 * k for k in range(-14, 15)]:
            cands.append((abs(dr) + 700.0 * abs(db), dr, db))
    cands.sort()
    for _cost, dr, db in cands:
        r = radius + dr
        if r < 3000.0:
            continue
        b = b0 + math.radians(db)
        x, y = math.cos(b) * r, math.sin(b) * r
        # A DISTRICT LANDMARK THAT LEFT ITS DISTRICT IS NOT ONE. The Lantern
        # Hamlets' lantern lane was pushed 90 m outward looking for clear
        # ground and came to rest inside West Wood, which is a landmark
        # correctly placed against an unstated requirement. The requirement is
        # stated now, and the search enforces it rather than the radii being
        # tuned until it happens to hold.
        if district is not None and _district_of(x, y)[0].replace(" ", "") != district:
            continue
        if _sig_free(x, y, need):
            if dr or db:
                SIG_NOTES.append("%s moved %+.0f uu / %+.1f deg to clear ground"
                                 % (name, dr, db))
            _SIG_PLACED.append((x, y, need))
            return x, y
    if need > 900.0:
        SIG_NOTES.append("%s: no site at %.0f uu clearance inside its district "
                         "-- retrying at %.0f" % (name, need, need * 0.68))
        return _sig_site(bearing_deg, radius, need * 0.68, name, district)
    SIG_NOTES.append("%s COULD NOT BE PLACED -- no clear ground near "
                     "bearing %.0f radius %.0f" % (name, bearing_deg, radius))
    return None


def _signature_skyline():
    out = []

    # --- 1. THE GREAT SPIRE, on the axis, at the far end of the world -----
    gx, gy = 0.0, 33000.0
    _SIG_PLACED.append((gx, gy, _SIG_CLEAR["spire_great"]))
    S = 1.08                                   # 180 m authored -> 194.4 m
    # THE NON-UNIFORM SCALE IS GONE, AND A MEASUREMENT RETIRED IT. PASS 28
    # widened this placement 1.75x across because the spire had rendered as a
    # hairline; `skyline.py --cam=HeroCam0` then showed the widened spire was
    # STILL only 4.0% of the hero frame and seventh in it, behind two tree
    # trunks and three mushrooms. A placement scale was never going to buy the
    # width, and it cost detail on the way: 1.75 across against 1.08 up
    # stretched every window in the tower.
    #
    # The width is authored now -- a cathedral body 104 m across the transepts
    # and four 122 m flanking spires on the shoulder -- so this is 1:1 and the
    # geometry is the size it says it is. See assets_v2.spire_great.
    WIDE = 1.0
    out.append(A("spire_great", gx, gy, 0.0, yaw=22.5, sxyz=(WIDE, WIDE, S),
                 mat="MI_V2_IvoryStone", label="GreatSpire_Body"))
    # AND IT STANDS ON SOMETHING. A spire rising straight out of a lawn is a
    # mast. Four subordinate towers at 43 m and two halls give the base a
    # silhouette of its own, so at 330 m the eye reads a great building with a
    # spire rather than a pole with a point.
    # MOVED OUT IN PASS 29: at 22-33 m from the axis these four stood INSIDE
    # the new cathedral body, whose transept arms reach 52 m. They are the
    # precinct's outer guard now, at 78-84 m, where they read as a walled
    # close around the great church rather than as lumps against its wall.
    for k, (ox, oy, ts, cap) in enumerate((
            (7900.0, 2400.0, 2.4, "roof_cone_steep"), (-7900.0, 2400.0, 2.3, "roof_bell"),
            (6200.0, -5600.0, 2.0, "roof_ogee"), (-6200.0, -5600.0, 2.1, "roof_cone_steep"))):
        out.append(A("castle_tower_octagon", gx + ox, gy + oy, 0.0, yaw=22.5 + 24.0 * k,
                     s=ts, mat="MI_V2_IvoryStone", label="GreatSpire_Tower%d" % k))
        out.append(A(cap, gx + ox, gy + oy, 1800.0 * ts, yaw=22.5 + 24.0 * k, s=ts,
                     mat=("MI_V2_RoofNavy", "MI_V2_RoofPink", "MI_V2_RoofLilac",
                          "MI_V2_RoofRose")[k], label="GreatSpire_TowerCap%d" % k))
        out.append(A("finial_spire", gx + ox, gy + oy, 1800.0 * ts + 560.0 * ts,
                     s=0.9 * ts, mat="MI_V2_Gold", label="GreatSpire_TowerFinial%d" % k))
    # THE HALLS COME OFF THE AXIS. GreatSpireCam22 -- the first player-height
    # look at this precinct -- showed a 2.2-scale castle_hall standing at
    # (0, -4600) squarely between the approach and the spire: a 40 m
    # slab-sided box with a heavy cornice, hiding the base of the tallest
    # thing in Wonderland from the one camera that stands under it. A
    # processional axis is a thing you keep CLEAR; that is the whole reason
    # PASS 06 left this bearing empty in the first place.
    for k, (ox, oy, hs) in enumerate(((8800.0, 6200.0, 2.4), (-8800.0, 6200.0, 2.2),
                                      (9400.0, -6400.0, 1.9), (-9400.0, -6400.0, 1.9))):
        out.append(A("castle_hall", gx + ox, gy + oy, 0.0, yaw=22.5 + 26.0 * k, s=hs,
                     mat="MI_V2_IvoryStone", label="GreatSpire_Hall%d" % k))
        out.append(A("roof_flat_crenellated", gx + ox, gy + oy, 900.0 * hs, yaw=22.5 + 26.0 * k,
                     s=hs, mat=("MI_V2_RoofNavy", "MI_V2_RoofLilac")[k % 2],
                     label="GreatSpire_HallRoof%d" % k))
        out.append(A("castle_arcade", gx + ox, gy + oy - 430.0 * hs, 0.0, yaw=22.5 + 26.0 * k,
                     s=hs * 1.6, mat="MI_V2_IvoryStone", label="GreatSpire_Arcade%d" % k))
        for f in range(3):
            out.append(A("facade_panel", gx + ox - 400.0 * hs + 400.0 * hs * f,
                         gy + oy - 402.0 * hs, 420.0 * hs, yaw=22.5 + 26.0 * k, s=hs,
                         mat="MI_V2_IvoryStone", label="GreatSpire_Hall%dBay%d" % (k, f)))

    # AND THE APPROACH IS BUILT, because the same frame showed the precinct
    # standing on 100 m of empty lawn. A processional way 130 m long on the
    # clear axis: paving at ROAD_Z like every other walking surface, piers and
    # waymarkers down both sides, blossom trees behind them, and the ground
    # under it laid rather than left as the outer world's bare quilt.
    for i in range(9):
        yy = gy - 13600.0 + 1600.0 * i
        out.append(A("terrace_platform", gx, yy, ROAD_Z, yaw=0.0,
                     sxyz=(1.15, 1.5, 0.35),
                     mat=("MI_V2_PlazaCream", "MI_V2_PlazaWarm", "MI_V2_PlazaGrey")[i % 3],
                     label="GreatSpire_Way%d" % i))
        for sgn in (1.0, -1.0):
            out.append(A("kerb_stone", gx + sgn * 1180.0, yy, -2.0, yaw=90.0,
                         sxyz=(13.0, 1.0, 0.5), mat="MI_V2_Kerb",
                         label="GreatSpire_WayKerb%d_%d" % (i, int(sgn))))
            if i % 2 == 0:
                out.append(A("waymarker", gx + sgn * 1620.0, yy, 0.0, yaw=90.0, s=0.95,
                             mat="MI_V2_IvoryStone", label="GreatSpire_WayMark%d_%d" % (i, int(sgn))))
                out.append(A("waymarker_lamp", gx + sgn * 1620.0, yy, 0.0, yaw=90.0, s=0.95,
                             mat="MI_V2_GlassAmber", label="GreatSpire_WayLamp%d_%d" % (i, int(sgn))))
            if i % 3 == 1:
                out += _tree_group(gx + sgn * 3400.0, yy + 300.0, 4400 + i * 7 + int(sgn),
                                   "GreatSpire_WayTree%d_%d" % (i, int(sgn)), 1.15)
        if i % 4 == 2:
            for sgn in (1.0, -1.0):
                out.append(A("gate_pier", gx + sgn * 2300.0, yy, 0.0, yaw=0.0, s=1.7,
                             mat="MI_V2_IvoryStone", label="GreatSpire_WayPier%d_%d" % (i, int(sgn))))
    for i in range(12):
        ax = -6000.0 + 1100.0 * (i % 6)
        ay = -12800.0 + 4200.0 * (i // 6)
        out.append(A("garden_lawn", gx + ax * 1.9, gy + ay, GROUND_Z, yaw=37.0 * i,
                     sxyz=(0.95, 0.80, 1.0),
                     mat=("MI_V2_Lawn", "MI_V2_Meadow")[i % 2],
                     label="GreatSpire_Ground%d" % i))
    # THE IMPOSSIBLE GESTURE, used three times in the whole world. The rings
    # hang clear of the shaft at the two set-backs and at the crown, so from
    # the ground they read as unsupported: nothing rises through them.
    # SIZED OFF THE RECIPE, not off the placement scale. The ring asset is
    # authored at r = 1000 uu, and a ring must CLEAR the shaft it hangs
    # around or it is a collar: at 64 m the stage-1 fins reach 2,060 uu, at
    # 107 m the flying stage reaches 1,330, at 149 m the needle is 420. A
    # ring inside the geometry is the whole gesture lost, which is what
    # happened when these rode a scale letter instead of a measurement.
    for i, (z, ring_uu, tilt) in enumerate(((6400.0, 2700.0, 0.0),
                                            (10700.0, 1850.0, 6.0),
                                            (14900.0, 1150.0, -9.0))):
        hs = ring_uu / 1000.0
        out.append(A("spire_halo_ring", gx, gy, z * S, yaw=17.0 * i,
                     sxyz=(hs, hs, hs),
                     pitch=tilt, mat="MI_V2_Gold", label="GreatSpire_Halo%d" % i))
    # a precinct at its foot, so the tallest thing in Wonderland stands on
    # something built rather than on lawn
    # THE CLOSE. The pier ring stood at 54 m, which the 52 m transept arms now
    # reach into; both it and the paved court are sized off the building.
    for k, yaw in enumerate((0.0, 90.0)):
        out.append(A("terrace_platform", gx, gy, ROAD_Z, yaw=yaw,
                     sxyz=(8.6, 3.1, 0.35), mat="MI_V2_PlazaCream",
                     label="GreatSpire_Court%d" % k))
    for k in range(20):
        a = 2.0 * math.pi * k / 20
        if 0.40 < (k / 20.0) < 0.60:          # the way in, from the south
            continue
        out.append(A("gate_pier", gx + math.cos(a) * 8600.0, gy + math.sin(a) * 8600.0,
                     0.0, yaw=math.degrees(a), s=1.8, mat="MI_V2_IvoryStone",
                     label="GreatSpire_Pier%d" % k))
        if k % 2 == 0:
            out.append(A("topiary_cone_roses", gx + math.cos(a) * 7500.0,
                         gy + math.sin(a) * 7500.0, 0.0, yaw=31.0 * k, s=1.9,
                         mat=("MI_V2_RosePink", "MI_V2_PetalWhite")[(k // 2) % 2],
                         label="GreatSpire_Cone%d" % k))

    # --- 2. THE TWO SIGNATURE SPIRES --------------------------------------
    # (bearing, radius, scale, yaw, halo, district it names)
    for bearing, radius, sc, yaw, halo, who in (
            # SIZED SO THE GREAT SPIRE ACTUALLY DOMINATES. At 150 m and 138 m
            # these measured 29.8 and 26.1 deg of subtended angle against the
            # great spire's 30.3 -- a tie, and a tie is three landmarks, not
            # a hierarchy with an anchor. Trimmed to 1.47x and 1.59x below it.
            (30.0, 25000.0, 1.130, 12.0, True, "EastReach"),       # 132 m
            (128.0, 26000.0, 1.050, -24.0, True, "TowerRise")):    # 123 m
        pt = _sig_site(bearing, radius, _SIG_CLEAR["spire_signature"],
                       "Spire_%s" % who)
        if pt is None:
            continue
        x, y = pt
        out.append(A("spire_signature", x, y, 0.0, yaw=yaw, s=sc,
                     mat="MI_V2_IvoryStone", label="Spire_%s_Body" % who))
        if halo:
            out.append(A("spire_halo_ring", x, y, 8100.0 * sc, yaw=yaw + 40.0,
                         s=0.60 * sc, pitch=7.0, mat="MI_V2_Gold",
                         label="Spire_%s_Halo" % who))
        for k, cyaw in enumerate((0.0, 90.0)):
            out.append(A("terrace_platform", x, y, ROAD_Z, yaw=cyaw,
                         sxyz=(1.5, 0.55, 0.35), mat="MI_V2_PlazaWarm",
                         label="Spire_%s_Court%d" % (who, k)))
        for k in range(10):
            a = 2.0 * math.pi * k / 10 + 0.3
            out.append(A(("gate_pier", "topiary_cone_roses")[k % 2],
                         x + math.cos(a) * 1700.0, y + math.sin(a) * 1700.0, 0.0,
                         yaw=math.degrees(a), s=1.25,
                         mat=("MI_V2_IvoryStone", "MI_V2_RosePink")[k % 2],
                         label="Spire_%s_Ring%d" % (who, k)))

    # --- 3. THE DISTRICT TOWERS, the rung that was missing ----------------
    # One per inner district that should read as BUILT. Water Gardens and
    # Mushroom Grove are deliberately absent: a district whose identity is
    # water or fungus does not announce itself with a stone keep, and giving
    # all eight the same landmark is the tiling this band exists to break.
    # (district, bearing, radius, scale, roof material)
    for who, bearing, radius, sc, roof in (
            ("RoyalGardens",   65.0, 10600.0, 1.34, "MI_V2_RoofPink"),
            ("ClockQuarter",    5.0, 13100.0, 1.28, "MI_V2_RoofNavy"),
            ("TowerRise",     116.0, 12600.0, 1.20, "MI_V2_RoofLilac"),
            ("LanternHamlets",152.0, 15100.0, 1.12, "MI_V2_RoofRose"),
            ("TeaTerraces",   200.0, 11200.0, 1.06, "MI_V2_RoofBlue"),
            ("GatekeeperFields",340.0, 14600.0, 1.24, "MI_V2_RoofPink"),
            ("NorthReach",    130.0, 24500.0, 1.35, "MI_V2_RoofNavy")):
        pt = _sig_site(bearing, radius, _SIG_CLEAR["tower_district"],
                       "Tower_%s" % who)
        if pt is None:
            continue
        x, y = pt
        yaw = (bearing * 3.0) % 90.0
        out.append(A("tower_district", x, y, 0.0, yaw=yaw, s=sc,
                     mat="MI_V2_IvoryStone", label="DistrictTower_%s" % who))
        out.append(A("roof_flat_crenellated", x, y, 4130.0 * sc, yaw=yaw, s=0.0001,
                     mat=roof, label="DistrictTower_%s_RoofTint" % who))
        for k, cyaw in enumerate((0.0, 90.0)):
            out.append(A("terrace_platform", x, y, ROAD_Z, yaw=cyaw + yaw,
                         sxyz=(1.05, 0.40, 0.35), mat="MI_V2_PlazaWarm",
                         label="DistrictTower_%s_Court%d" % (who, k)))
        for k in range(8):
            a = 2.0 * math.pi * k / 8 + 0.6
            out.append(A(("gate_pier", "topiary_ball")[k % 2],
                         x + math.cos(a) * 1150.0, y + math.sin(a) * 1150.0, 0.0,
                         yaw=math.degrees(a), s=1.0,
                         mat=("MI_V2_IvoryStone", "MI_V2_LeafMid")[k % 2],
                         label="DistrictTower_%s_Ring%d" % (who, k)))
    return out


SIGNATURE = _band("V2_Skyline", _signature_skyline())

#: The landmarks the world is navigated by must survive the scatter that
#: dresses a quarter's edge -- a missing name here is the same fail-open
#: defect as a missing FOOT entry.
_PROTECT = _PROTECT + ("spire_great", "spire_signature", "tower_district")

#: AND THE SCATTER THAT IS ALREADY THERE HAS TO GO. `_sig_free` deliberately
#: lets a landmark stand where hedges and trees stand, on the promise that
#: this pass removes them -- an unkept promise here would put a 194 m spire
#: inside a hedgerow. Reuses the existing filter rather than writing a second
#: one, so there is one description of "scatter has grown through a landmark".
_SIG_CLEARED = {}
for _bandref in (OUTER_WORLD, HORIZON, GROUND_QUILT, FLANKS, REARWORLD, PALACE):
    _before = len(_bandref)
    _bandref[:] = _declutter(_bandref, also=SIGNATURE)
    if len(_bandref) != _before:
        _SIG_CLEARED[id(_bandref)] = _before - len(_bandref)
SIG_NOTES.append("declutter around the signature landmarks removed %d scatter pieces"
                 % sum(_SIG_CLEARED.values()))

# ===========================================================================
# REVEALING THE CITY  (ENCHANTMENT + VERTICALITY, batch B)
# ===========================================================================
#
# MEASURED, from `tools/occlusion.py --cover`, before this filter existed:
#
#     0- 40 m   43.9% of the ground had a crown over it
#    40- 80 m   45.5%
#    80-130 m   57.1%      <- the castle approach
#   130-200 m   67.2%      <- the quarters
#   200-340 m   49.6%
#
# 62 canopies per hectare in the 80-130 m band, each about 14 m across. That
# is a CLOSED woodland, and it is why the first SkylineCam06 render reads as a
# forest with tower tops in it: at the shallow angle a standing player or a
# low camera looks along, 57% plan cover is near-total occlusion. The castle
# is 30 m tall and the canopy ceiling is 15-25 m, so the trees are not beside
# the architecture, they are in front of it at its own height.
#
# THINNING EVENLY WOULD ONLY MAKE A THINNER FOREST. Cover is an average, and
# an average says nothing about whether there is anywhere to see THROUGH. So
# this does two things, both filters over the assembled bands rather than new
# placement rules -- a filter cannot introduce a third thing to go wrong:
#
#   1. A CLEARING FIELD. Two octaves of the same value noise the density field
#      uses, thresholded, so trees survive in groves and vanish in glades. The
#      result is woodland with rooms in it, which is what a designed park is
#      and what an even scatter can never become.
#   2. SIGHTLINE CORRIDORS. From every camera in the suite to every signature
#      landmark, trees inside the cone are removed -- but only beyond 30 m, so
#      the near framing the compositions depend on is untouched, and only when
#      they are tall enough to cross the line of sight.
#
# AUTHORED PLANTING IS NOT TOUCHED. Golden Arrival's own trees, the approach
# avenue, the garden groups and the flank compositions carry authored labels;
# only the generated `<TAG>_T<i>` / `<TAG>_C<i>_<c>` trees of the quarters,
# the country layer and the road verges are in scope. "Do not globally remove
# vegetation" is enforced by WHAT THIS CAN SEE, not by being careful.

#: Label prefixes whose trees are generated and may be thinned. A tag like
#: `S17_garden` or `Country042` is a procedural placement; `Garden_L_Tree` and
#: `Approach_Trunk0` are decisions somebody made.
def _generated_tag(tag):
    if tag.startswith("Country") or tag.startswith("Road") or tag.startswith("Lane") \
            or tag.startswith("Verge") or tag.startswith("Beyond"):
        return True
    return len(tag) > 1 and tag[0] in "QSDC" and tag[1:].isdigit()


def _tree_key(label):
    """(tag, index) for a generated tree piece, or None.

    TWO NAMING SCHEMES, because there are two. `_tree` writes `<TAG>_T<i>` and
    `<TAG>_C<i>_<c>`; `_tree_group` writes `<TAG>_Trunk` and `<TAG>_Canopy<c>`.
    The first version of this knew only the first scheme, so the eight tree
    groups standing between the plaza and the castle -- twenty-four large
    crowns on the exact sightline the founder says is blocked -- were INVISIBLE
    to the filter that exists to open that sightline. It reported 311 trees
    thinned and was silent about the ones that mattered most.

    A FILTER THAT CANNOT SEE SOMETHING REPORTS SUCCESS. That is the same
    fail-open shape as a missing FOOT entry, and it is the third time this
    project has paid for a rule that knew one collection and not its sibling.

    Keying on (tag, index) is what makes this remove TREES rather than leave a
    field of bare trunks holding nothing up.
    """
    parts = label.split("_")
    if len(parts) < 2:
        return None
    last = parts[-1]
    if last.startswith("T") and last[1:].isdigit():
        tag, idx = "_".join(parts[:-1]), last[1:]
    elif len(parts) >= 3 and parts[-2].startswith("C") and parts[-2][1:].isdigit() \
            and last.isdigit():
        tag, idx = "_".join(parts[:-2]), parts[-2][1:]
    elif last == "Trunk":
        tag, idx = "_".join(parts[:-1]), "g"
    elif last.startswith("Canopy") and last[6:].isdigit():
        tag, idx = "_".join(parts[:-1]), "g"
    else:
        return None
    head = tag.split("_")[0]
    if not _generated_tag(head):
        return None
    return (tag, idx)


def _clearing(x, y):
    """0 = glade, 1 = closed grove. Two octaves, same family as the density
    field, so clearings sit WITH the world's grain rather than across it."""
    return 0.62 * _vnoise(x, y, 5200.0, 7717) + 0.38 * _vnoise(x, y, 2100.0, 7723)


#: How much of the woodland survives, by radius. The far world's 49.6% cover
#: is correct -- it is the backdrop and its job is mass. The approach and the
#: quarters are where the city is, and they are where the canopy closed over
#: it. Interpolated, never stepped, so no ring appears at a number.
_THIN_KEEP = ((0.0, 1.00), (4000.0, 0.88), (9000.0, 0.70), (14000.0, 0.66),
              (20000.0, 0.74), (28000.0, 0.90), (40000.0, 1.00))


def _keep_share(r):
    prev_r, prev_k = _THIN_KEEP[0]
    for rr, kk in _THIN_KEEP[1:]:
        if r <= rr:
            t = (r - prev_r) / (rr - prev_r) if rr > prev_r else 0.0
            return prev_k + t * (kk - prev_k)
        prev_r, prev_k = rr, kk
    return _THIN_KEEP[-1][1]


def _sight_cones(marks=None):
    """(camera xy, landmark xy, half-angle, landmark top) for every pair.

    Only the landmarks the world is NAVIGATED by: the signature skyline and
    the castle focal plane. Widening this to every wall would clear the world.

    `marks` overrides that set, which is how the SECOND reveal pass -- the one
    that runs after the district landmarks and their architecture exist -- asks
    the same question about gates, cloisters, screens and bridges without this
    function acquiring a second opinion about what a landmark is.
    """
    import v2_config as _cfg
    if marks is None:
        marks = []
        for p in SIGNATURE:
            if p["asset"] in ("spire_great", "spire_signature", "tower_district"):
                marks.append((p["pos"][0], p["pos"][1], 1600.0))
        for p in CITY:
            if p["asset"] == "castle_hall" and math.hypot(p["pos"][0], p["pos"][1]) < 16000.0:
                marks.append((p["pos"][0], p["pos"][1], 1400.0))
    cones = []
    for c in _cfg.HERO_CAMS:
        cx, cy, _cz = c["location"]
        for (mx, my, half_w) in marks:
            d = math.hypot(mx - cx, my - cy)
            if d < 3000.0:
                continue
            cones.append((cx, cy, mx, my, d, math.atan2(half_w, d)))
    return cones


_REVEAL_NOTES = []


def _reveal_city(bands, marks=None, thin=True):
    """Thin the generated woodland, and clear the sightlines. In place.

    `thin=False` runs the sightline half only, for the second pass: the
    clearing field is a property of the woodland and applying it twice would
    thin the same trees against the same threshold a second time.
    """
    cones = _sight_cones(marks)
    trees = {}
    for band in bands:
        for p in band:
            k = _tree_key(p.get("label") or "")
            if k is None:
                continue
            e = trees.setdefault(k, {"x": None, "y": None, "n": 0})
            e["n"] += 1
            if p["asset"].endswith("_trunk"):
                e["x"], e["y"] = p["pos"][0], p["pos"][1]
    # a crown whose trunk is in another band still belongs to that tree
    for band in bands:
        for p in band:
            k = _tree_key(p.get("label") or "")
            if k is None:
                continue
            e = trees[k]
            if e["x"] is None:
                e["x"], e["y"] = p["pos"][0], p["pos"][1]

    drop, cone_drop = set(), 0
    for k, e in trees.items():
        x, y = e["x"], e["y"]
        r = math.hypot(x, y)
        if thin and _clearing(x, y) > _keep_share(r):
            drop.add(k)
            continue
        for (cx, cy, mx, my, d, half) in cones:
            dxc, dyc = x - cx, y - cy
            dc = math.hypot(dxc, dyc)
            # BEYOND THE NEAR FRAMING AND NEARER THAN THE LANDMARK. A tree
            # behind the landmark cannot hide it, and one at the camera's feet
            # is the composition.
            if not (3000.0 < dc < d):
                continue
            bearing = math.atan2(dyc, dxc)
            to_mark = math.atan2(my - cy, mx - cx)
            off = abs((bearing - to_mark + math.pi) % (2.0 * math.pi) - math.pi)
            # the cone widens with the tree's own crown, so a wide crown just
            # off the axis still counts as in the way
            if off < half + math.atan2(900.0, dc):
                drop.add(k)
                cone_drop += 1
                break

    removed = 0
    for band in bands:
        before = len(band)
        band[:] = [p for p in band if _tree_key(p.get("label") or "") not in drop]
        removed += before - len(band)
    _REVEAL_NOTES.append(
        "reveal: %d of %d generated trees removed (%d for a sightline), "
        "%d placements" % (len(drop), len(trees), cone_drop, removed))


_reveal_city([OUTER_WORLD, HORIZON, FLANKS, REARWORLD, PALACE, GROUND_QUILT,
              CAM_FOREGROUNDS])

# ===========================================================================
# THE ENCHANTED LANDMARKS  (ENCHANTMENT + VERTICALITY, batch C + E)
# ===========================================================================
#
# "Every major district should contain something that makes the player want to
# walk toward it", and "important quarters should feel distinct through
# landmark + architecture + vegetation + colour + ornament".
#
# The world already had fourteen NAMED districts and, apart from the Mushroom
# Grove's fungus and the Clock Quarter's 11.9 m clock tower, nothing told you
# which one you were in. The quarter builders differ by KIND, and kind is
# assigned by a weighted hash inside a district -- so a district is mostly one
# recipe, which is a texture, not an identity.
#
# So each district now gets ONE authored thing at landmark size, and no type
# appears in more than two districts. The glass takes a different colour in
# each place it is used, which is what stops two rose walks with a rotunda in
# them from being the same place twice.
#
# Sized against what is already standing: the district towers are 75-91 m and
# the neighbourhood towers 25-45, so these sit at 12-50 m -- big enough to
# pull a walker across a quarter, small enough that they cannot compete with
# the skyline hierarchy batch A just built. A landmark that outranks the
# navigation anchor is not a landmark, it is a second anchor.

#: Measured half-footprints, unscaled uu, read off the recipes. Conservative
#: where a shape is not a cylinder: teapot_pavilion's spout reaches the ground
#: 44 m from its axis and the solver's footprint is an axis-aligned rectangle
#: that does not rotate with yaw, so the entry covers body AND spout at any
#: yaw. Over-blocking sends a route around; under-blocking sends it THROUGH,
#: and a missing entry fails open entirely.
FOOT.update({"clock_grand": (950, 950), "gear_monument": (800, 800),
             "key_colossal": (780, 700), "flower_colossal": (330, 330),
             "glass_pavilion": (1180, 1180), "teapot_pavilion": (4600, 4600),
             "floating_stair": (1650, 2600), "lantern_strange": (190, 190)})

#: The glazing meshes ride on their frames and are never obstacles in their
#: own right -- declared, not left missing, so the omission reads as a
#: decision rather than an oversight.
_GLASS_MESHES = ("glass_pavilion_lights", "lantern_strange_glass",
                 "flower_colossal_bloom")

#: (district, bearing, radius, builder key, scale, glass tint, note)
#: No type in more than two districts; the two that repeat take a different
#: glass colour, a different scale and a different setting.
_DISTRICT_LANDMARKS = (
    ("RoyalGardens",      65.0, 10200.0, "flower_bed",   1.00, "MI_V2_GlassRose",   "three giant blooms over a parterre"),
    ("ClockQuarter",       5.0, 12600.0, "great_clock",  1.00, "MI_V2_GlassAmber",  "the great clock and its movement"),
    ("TowerRise",        120.0, 12400.0, "stair",        0.42, "MI_V2_GlassViolet", "a stair that leaves the ground"),
    ("LanternHamlets",   152.0, 14600.0, "lantern_run",  0.62, "MI_V2_GlassAmber",  "a lane of lanterns that lean"),
    ("TeaTerraces",      200.0, 11000.0, "teapot",       0.42, "MI_V2_GlassRose",   "a teapot with a door in it"),
    ("WaterGardens",     248.0, 11600.0, "pavilion",     0.60, "MI_V2_GlassTeal",   "a glass rotunda over the water"),
    ("MushroomGrove",    300.0, 13600.0, "lantern_run",  0.50, "MI_V2_GlassTeal",   "lanterns among the caps"),
    ("GatekeeperFields", 340.0, 14200.0, "key",          0.55, "MI_V2_GlassAmber",  "the key in the stone"),
    ("NorthReach",       130.0, 24000.0, "gears",        1.30, "MI_V2_GlassAmber",  "an engine in the fields"),
    ("EastReach",         25.0, 27000.0, "stair",        0.62, "MI_V2_GlassViolet", "a longer flight, further out"),
    ("TheLongWoods",     210.0, 24000.0, "flower_bed",   1.45, "MI_V2_GlassRose",   "blooms above the woods"),
    ("SouthMeadows",     278.0, 26000.0, "pavilion",     0.86, "MI_V2_GlassAmber",  "an amber rotunda in the meadow"),
    ("WestWood",         170.0, 29000.0, "key",          0.90, "MI_V2_GlassAmber",  "a second key, larger, half sunk"),
    ("FarOrchards",      315.0, 28000.0, "great_clock",  0.62, "MI_V2_GlassRose",   "a smaller clock, for the orchards"),
)

LANDMARK_NOTES = []


def _lm_court(x, y, tag, r, n=8, pier=1.0, cone="topiary_cone_roses",
              cone_mat="MI_V2_RosePink"):
    """A landmark stands on something built, with a way in from the south."""
    out = [A("terrace_platform", x, y, ROAD_Z, yaw=yaw,
             sxyz=(r / 720.0, r / 1900.0, 0.35), mat="MI_V2_PlazaWarm",
             label="%s_Court%d" % (tag, k)) for k, yaw in enumerate((0.0, 90.0))]
    for k in range(n):
        a = 2.0 * math.pi * k / n + 0.2
        if 0.40 < (k / float(n)) < 0.60:
            continue
        out.append(A("gate_pier", x + math.cos(a) * r, y + math.sin(a) * r, 0.0,
                     yaw=math.degrees(a), s=pier, mat="MI_V2_IvoryStone",
                     label="%s_Pier%d" % (tag, k)))
        if k % 2 == 0:
            out.append(A(cone, x + math.cos(a) * r * 0.72, y + math.sin(a) * r * 0.72,
                         0.0, yaw=37.0 * k, s=1.15 * pier, mat=cone_mat,
                         label="%s_Cone%d" % (tag, k)))
    return out


def _lm_setting(x, y, tag, sc, glass, reach):
    """The GROUND a landmark stands on, and the way you arrive at it.

    Measured on the PASS 28 landmark captures: the teapot, the great spire and
    the key all read well and all stand in the same empty frame -- the bottom
    45% is flat outer-world quilt with nothing on it. `_lm_court` gives a
    landmark a paved court about 20 m across, and a camera 30 m out sees
    mostly the lawn in front of it.

    So a landmark gets a SETTING: laid ground in three tones so the field is
    not one flat green, an approach spur running back toward the world's
    centre (which is where every district's road comes from), waymarkers in
    the district's own glass along it, and planting either side. It is the
    same language as the great spire's processional way, at a quarter the
    length.
    """
    out = []
    b = math.atan2(-y, -x)                       # back toward the origin
    ux, uy = math.cos(b), math.sin(b)
    px, py = -uy, ux
    # FOUR TILES, NOT SIX, AND THEY OVERLAP. Every tile boundary is a straight
    # seam on a flat plane; fewer and larger means fewer seams, and 1.15 scale
    # against a 2,400 uu step means they overlap rather than tile.
    for i in range(4):
        gx = x + ux * (2400.0 + 2400.0 * (i % 2)) + px * (3000.0 * ((i // 2) * 2 - 1))
        gy = y + uy * (2400.0 + 2400.0 * (i % 2)) + py * (3000.0 * ((i // 2) * 2 - 1))
        out.append(A("garden_lawn", gx, gy, GROUND_Z, yaw=37.0 * i + 13.0,
                     sxyz=(1.15, 1.02, 1.0),
                     mat=("MI_V2_Lawn", "MI_V2_Meadow")[i % 2],
                     label="%s_Ground%d" % (tag, i)))
    for i in range(7):
        d = reach + 900.0 + 1500.0 * i
        sx, sy = x + ux * d, y + uy * d
        out.append(A("terrace_platform", sx, sy, ROAD_Z, yaw=math.degrees(b),
                     sxyz=(1.15, 0.95, 0.35),
                     mat=("MI_V2_PlazaWarm", "MI_V2_PlazaCream", "MI_V2_PlazaGrey")[i % 3],
                     label="%s_Spur%d" % (tag, i)))
        if i % 2 == 0:
            for sgn in (1.0, -1.0):
                out.append(A("waymarker", sx + px * sgn * 900.0, sy + py * sgn * 900.0, 0.0,
                             yaw=math.degrees(b) + 90.0, s=0.8, mat="MI_V2_IvoryStone",
                             label="%s_SpurMark%d_%d" % (tag, i, int(sgn))))
                out.append(A("waymarker_lamp", sx + px * sgn * 900.0, sy + py * sgn * 900.0, 0.0,
                             yaw=math.degrees(b) + 90.0, s=0.8, mat=glass,
                             label="%s_SpurLamp%d_%d" % (tag, i, int(sgn))))
        if i % 3 == 1:
            for sgn in (1.0, -1.0):
                out += _tree_group(sx + px * sgn * 2100.0, sy + py * sgn * 2100.0,
                                   7700 + i * 11 + int(sgn), "%s_SpurTree%d_%d" % (tag, i, int(sgn)), 1.05)
        if i % 3 == 2:
            for sgn in (1.0, -1.0):
                out += _ground_patch(sx + px * sgn * 1500.0, sy + py * sgn * 1500.0, 0,
                                     53.0 * i, 1.3,
                                     ("MI_V2_PetalRose", "MI_V2_Lavender", "MI_V2_PetalWhite")[i % 3],
                                     "%s_SpurBed%d_%d" % (tag, i, int(sgn)))
    return out


def _lm_build(kind, x, y, tag, sc, glass):
    """One district landmark and its setting."""
    out = []
    if kind == "great_clock":
        out.append(A("clock_grand", x, y, 0.0, yaw=200.0, s=sc,
                     mat="MI_V2_IvoryStone", label="%s_Clock" % tag))
        out.append(A("gear_monument", x + 1900.0 * sc, y - 900.0 * sc, 0.0,
                     yaw=-40.0, s=0.62 * sc, mat="MI_V2_GoldAged",
                     label="%s_Gears" % tag))
        out += _lm_court(x, y, tag, 2200.0 * sc, 10, 1.3 * sc,
                         "topiary_cone_plain", "MI_V2_LeafDark")
    elif kind == "gears":
        out.append(A("gear_monument", x, y, 0.0, yaw=25.0, s=sc,
                     mat="MI_V2_GoldAged", label="%s_Gears" % tag))
        out += _lm_court(x, y, tag, 1700.0 * sc, 8, 1.1 * sc,
                         "topiary_ball", "MI_V2_LeafMid")
    elif kind == "key":
        out.append(A("key_colossal", x, y, 0.0, yaw=118.0, s=sc,
                     mat="MI_V2_GoldAged", label="%s_Key" % tag))
        out += _lm_court(x, y, tag, 2000.0 * sc, 8, 1.2 * sc,
                         "topiary_cone_plain", "MI_V2_LeafDark")
    elif kind == "flower_bed":
        # THREE, NOT ONE. A single giant flower is a specimen; three at
        # different heights and headings are a bed, which is what a garden
        # district's landmark should be.
        for i, (dx, dy, s2, tint) in enumerate((
                (0.0, 0.0, 1.00, "MI_V2_RosePink"),
                (-1250.0, 900.0, 0.78, "MI_V2_PetalViolet"),
                (1050.0, -1150.0, 0.88, "MI_V2_PetalPink"))):
            out.append(A("flower_colossal", x + dx * sc, y + dy * sc, 0.0,
                         yaw=61.0 * i + 20.0, s=s2 * sc, mat="MI_V2_LeafMid",
                         label="%s_BloomStem%d" % (tag, i)))
            out.append(A("flower_colossal_bloom", x + dx * sc, y + dy * sc, 0.0,
                         yaw=61.0 * i + 20.0, s=s2 * sc, mat=tint,
                         label="%s_Bloom%d" % (tag, i)))
        out += _lm_court(x, y, tag, 2100.0 * sc, 8, 1.0 * sc,
                         "shrub_flowering", "MI_V2_PetalWhite")
    elif kind == "pavilion":
        out.append(A("glass_pavilion", x, y, 0.0, yaw=15.0, s=sc,
                     mat="MI_V2_IvoryStone", label="%s_Pavilion" % tag))
        out.append(A("glass_pavilion_lights", x, y, 0.0, yaw=15.0, s=sc,
                     mat=glass, label="%s_PavilionGlass" % tag))
        out += _lm_court(x, y, tag, 1900.0 * sc, 10, 1.0 * sc,
                         "topiary_ball", "MI_V2_LeafMid")
    elif kind == "teapot":
        out.append(A("teapot_pavilion", x, y, 0.0, yaw=-65.0, s=sc,
                     mat="MI_V2_Ceramic", label="%s_Teapot" % tag))
        out.append(A("tea_cup", x + 2600.0 * sc, y + 1500.0 * sc, 0.0, yaw=30.0,
                     s=2.4 * sc, mat="MI_V2_Ceramic", label="%s_Cup" % tag))
        out.append(A("tea_saucer", x + 2600.0 * sc, y + 1500.0 * sc, 0.0, yaw=30.0,
                     s=2.4 * sc, mat="MI_V2_Ceramic", label="%s_Saucer" % tag))
        out += _lm_court(x, y, tag, 2600.0 * sc, 10, 1.2 * sc,
                         "topiary_cone_roses", "MI_V2_RosePink")
    elif kind == "stair":
        out.append(A("floating_stair", x, y, 0.0, yaw=-70.0, s=sc,
                     mat="MI_V2_IvoryStone", label="%s_Stair" % tag))
        out += _lm_court(x, y, tag, 2000.0 * sc, 8, 1.1 * sc,
                         "topiary_cone_plain", "MI_V2_LeafDark")
    elif kind == "lantern_run":
        # A LANE OF THEM. One strange lantern is a prop; eleven leaning down a
        # lane, each bent a different way, is a place with a name.
        for i in range(11):
            t = i / 10.0
            a = math.atan2(y, x) + 1.15
            lx = x + math.cos(a) * (t - 0.5) * 5200.0 + 260.0 * math.sin(4.1 * i)
            ly = y + math.sin(a) * (t - 0.5) * 5200.0 + 260.0 * math.cos(3.3 * i)
            s2 = sc * (0.86 + 0.34 * _rnd(i, 991, 3))
            yw = 360.0 * _rnd(i, 991, 4)
            out.append(A("lantern_strange", lx, ly, 0.0, yaw=yw, s=s2,
                         mat="MI_V2_Bronze", label="%s_Lantern%d" % (tag, i)))
            out.append(A("lantern_strange_glass", lx, ly, 0.0, yaw=yw, s=s2,
                         mat=glass, label="%s_LanternGlass%d" % (tag, i)))
        out.append(A("glass_pavilion", x, y, 0.0, yaw=40.0, s=0.42,
                     mat="MI_V2_IvoryStone", label="%s_Pavilion" % tag))
        out.append(A("glass_pavilion_lights", x, y, 0.0, yaw=40.0, s=0.42,
                     mat=glass, label="%s_PavilionGlass" % tag))
    return out


#: where each district landmark ACTUALLY landed. `_sig_site` moves a landmark
#: to find clear ground inside its own district, so the table's bearing and
#: radius are a request, not a position. Anything built around a landmark has
#: to read this rather than recompute the request -- the same class of bug as
#: the gate reading a different list from the builder.
LANDMARK_SITES = {}


def _district_landmarks():
    out = []
    for (who, bearing, radius, kind, sc, glass, note) in _DISTRICT_LANDMARKS:
        need = 2400.0 if kind in ("great_clock", "teapot", "lantern_run") else 1900.0
        pt = _sig_site(bearing, radius, need, "Landmark_%s" % who, district=who)
        if pt is None:
            continue
        x, y = pt
        out += _lm_build(kind, x, y, "LM%s" % who, sc, glass)
        out += _lm_setting(x, y, "LM%s" % who, sc, glass,
                           {"great_clock": 2200.0, "teapot": 2600.0,
                            "lantern_run": 2600.0}.get(kind, 2000.0) * sc)
        LANDMARK_SITES[who] = (x, y, kind, sc, glass,
                               {"great_clock": 2200.0, "teapot": 2600.0,
                                "lantern_run": 2600.0}.get(kind, 2000.0) * sc)
        LANDMARK_NOTES.append("%-18s %-12s at (%7.0f,%7.0f) r=%5.0f m -- %s"
                              % (who, kind, x, y, math.hypot(x, y) / 100.0, note))
    return out


LANDMARKS = _band("V2_Skyline", _district_landmarks())


# ---------------------------------------------------------------------------
# DISTRICT DEPTH -- turning a monument in a field into somewhere to go
# ---------------------------------------------------------------------------
#
# Each district had ONE landmark, a paved court about 20 m across and an
# approach spur. Standing in one, that is a monument in a field: you read what
# the district is FOR at 200 m and there is nothing to walk THROUGH when you
# arrive. The founder's phrase for the gap is "wonder per meter".
#
# So eight districts get a second layer, and every piece of it is one of four
# things -- a THRESHOLD, an OUTDOOR ROOM, a MECHANISM, or COLOUR at
# architectural size. None of it is more trees or more towers, which is what
# this world has always reached for and has enough of.
#
# EVERYTHING IS PLACED IN THE LANDMARK'S OWN APPROACH FRAME: `u` runs back
# toward the world centre, which is where the district's road comes from and
# therefore the direction a walker arrives from, and `p` is across it. So the
# gate is always on the way in, the screens are always beside the walk, and
# the swags always span it -- whatever bearing `_sig_site` finally chose. This
# is the second lesson of the same kind as LANDMARK_SITES: build in the frame
# the thing actually has, not the one the table asked for.

#: uu, unscaled half-footprints for the new pieces, read off the built meshes.
#: THREE OF THEM ARE DELIBERATELY ABSENT, and that is a decision rather than
#: an omission -- the same declaration `_GLASS_MESHES` makes:
#:   gatehouse_district  is a THRESHOLD. Its solid parts are a ring around a
#:     5.2 m opening the road runs through; the solver's footprint is one
#:     axis-aligned rectangle, so any entry blocks the arch and pushes every
#:     route around the gate it exists to be walked through.
#:   bridge_arc          is a walking surface. Blocking it removes a crossing.
#:   lantern_swag        is two 2.6 m posts 30 m apart with a lane under it.
#:     One rectangle can express the pair only by walling off the lane.
FOOT.update({"cloister_square": (1520, 1520), "orrery_gold": (760, 760),
             "glass_screen": (1040, 1040), "fountain_grand": (680, 680)})

_DEPTH_MESHES = ("gatehouse_district", "bridge_arc", "lantern_swag")

#: (district, pieces). Each piece: (kind, along, across, extra)
#: `along` is uu out from the landmark toward the world centre (so positive is
#: on the approach), `across` is uu to the walker's left. No district gets the
#: same set as another; a place made of the same parts as its neighbour is a
#: texture, which is the failure this whole layer is fixing.
_DEPTH = (
    ("RoyalGardens",    (("cloister", -400.0, 4300.0, 1.00),
                         ("fountain", -400.0, 4300.0, 1.00),
                         ("screen", 2600.0, 2200.0, 0.90),
                         ("screen", 2600.0, -2200.0, 0.90),
                         ("swag", 1400.0, 0.0, 1.00),
                         ("swag", 4200.0, 0.0, 1.00))),
    ("ClockQuarter",    (("gate", 4300.0, 0.0, 1.00),
                         ("orrery", -3200.0, 2500.0, 1.00),
                         ("screen", 1800.0, -2700.0, 1.00),
                         ("swag", 900.0, 0.0, 1.00),
                         ("swag", 6400.0, 0.0, 1.00))),
    ("TowerRise",       (("gate", 4600.0, 0.0, 0.90),
                         ("bridge", 1800.0, 0.0, 1.00),
                         ("screen", -1800.0, 2900.0, 1.10),
                         ("cloister", 2400.0, 5000.0, 0.92))),
    # NO CLOISTER HERE, AND THE WORLD SAID SO. Tea Terraces is the densest
    # quarter in the walkable world -- plinths, pots, saucers, cups and hearts
    # at every scale -- and a 35 m cloister found no site at any of five
    # offsets. It gets a threshold instead, which is the thing it was short of
    # anyway: you now arrive at the tea district through a gate.
    ("TeaTerraces",     (("gate", 3800.0, 1500.0, 0.92),
                         ("fountain", 4200.0, 4400.0, 0.88),
                         ("swag", 1200.0, 0.0, 1.00),
                         ("swag", 3600.0, 0.0, 1.00),
                         ("swag", 6000.0, 0.0, 1.00))),
    ("WaterGardens",    (("bridge", 2600.0, 0.0, 1.10),
                         ("fountain", -2800.0, 0.0, 1.20),
                         ("screen", 800.0, 2900.0, 1.00),
                         ("screen", 800.0, -2900.0, 1.00),
                         ("gate", 5400.0, 0.0, 0.95))),
    ("MushroomGrove",   (("cloister", -600.0, 4500.0, 0.88),
                         ("screen", 2200.0, -2500.0, 0.95),
                         ("swag", 1000.0, 0.0, 1.00),
                         ("swag", 4000.0, 0.0, 1.00))),
    ("LanternHamlets",  (("gate", 4800.0, 0.0, 0.86),
                         ("fountain", -2500.0, 2300.0, 0.94),
                         ("swag", 1200.0, 0.0, 1.00),
                         ("swag", 2900.0, 0.0, 1.00),
                         ("swag", 6600.0, 0.0, 1.00))),
    ("GatekeeperFields", (("gate", 4400.0, 0.0, 1.00),
                          ("orrery", -2700.0, -2900.0, 0.86),
                          ("screen", 2200.0, 2600.0, 1.00))),
    # THE OUTER SIX. Eight districts had architecture and six had a monument
    # in a field, which is the same gap this whole layer was written to close
    # -- just further out. The reaches are emptier and their landmarks stand
    # further apart, so the offsets are larger and the pieces bigger; a 26 m
    # gatehouse that reads at 150 m in the Clock Quarter has to be 30 m to do
    # the same job on a 270 m reach.
    ("NorthReach",      (("gate", 6200.0, 0.0, 1.15),
                         ("screen", 2600.0, -3600.0, 1.20),
                         ("swag", 2000.0, 0.0, 1.10))),
    ("EastReach",       (("gate", 6800.0, 0.0, 1.10),
                         ("cloister", -900.0, 5600.0, 1.05),
                         ("swag", 2400.0, 0.0, 1.10))),
    ("TheLongWoods",    (("cloister", -800.0, -5400.0, 1.05),
                         ("fountain", -800.0, -5400.0, 1.00),
                         ("screen", 2400.0, 3300.0, 1.15))),
    ("SouthMeadows",    (("bridge", 3000.0, 0.0, 1.25),
                         ("orrery", -3000.0, 3200.0, 1.00),
                         ("swag", 6200.0, 0.0, 1.10))),
    ("WestWood",        (("gate", 5600.0, 0.0, 1.10),
                         ("screen", -2000.0, 3400.0, 1.15),
                         ("swag", 2200.0, 0.0, 1.10))),
    ("FarOrchards",     (("orrery", -2800.0, -3200.0, 1.05),
                         ("fountain", 2600.0, 3000.0, 1.10),
                         ("gate", 5800.0, 0.0, 1.05))),
)

DEPTH_NOTES = []


#: uu. Nothing in this layer may stand nearer the origin than this. The
#: Golden Arrival is the founder's frozen composition and six of the locked
#: cameras stand in it.
_DEPTH_MIN_R = 9000.0
#: uu. Nor further than this from the landmark it belongs to. Scaled with the
#: landmark's own radius, because a 90 m leash is most of an inner district
#: and a tenth of the ground between two outer ones -- the reaches are emptier
#: and their pieces have to stand further apart to read at all.
_DEPTH_MAX_FROM_LM = 9000.0


def _depth_leash(lx, ly):
    r = math.hypot(lx, ly)
    return _DEPTH_MAX_FROM_LM * (1.0 if r < 18000.0 else 1.45)


def _depth_site_ok(lx, ly, x, y):
    """May a depth piece belonging to the landmark at (lx, ly) stand here?

    THE SEARCH WALKED A BRIDGE INTO THE ARRIVAL PLAZA. `_sig_site` has carried
    a guard for exactly this since PASS 23 -- "A DISTRICT LANDMARK THAT LEFT
    ITS DISTRICT IS NOT ONE" -- and this search, written one function away
    from it, had none. Tower Rise's bridge slid 63 m looking for clear ground,
    crossed two districts and came to rest 11 m from HeroCam0, where
    `skyline.py --cam` measured it at EIGHTY-ONE PER CENT of the founder's
    hero frame. Two lantern swags landed beside SkylineCam06 the same way. A
    rule applied to one collection and not its sibling is the richest defect
    vein in this project, and this is the sixth.

    THE TEST IS BELONGING TO A LANDMARK, NOT MEMBERSHIP OF A WEDGE.
    `_district_of` was the obvious guard and it was the wrong one: the
    districts are wedges at a radius, an approach runs INWARD, and a gate
    150 m up the approach from a landmark at 250 m is at 100 m -- correctly
    on the way in, and correctly reported as a different district. Requiring
    the wedge dropped eight of thirty-eight pieces for being where they
    should be. Ninety metres of its own landmark says the same thing about
    what a piece belongs to without being wrong about geography.
    """
    if math.hypot(x, y) < _DEPTH_MIN_R:
        return False
    return math.hypot(x - lx, y - ly) <= _depth_leash(lx, ly)


#: district -> (roof / cap accent, the metal its mechanisms are made of).
#: THE ARCHITECTURE WAS ALL ONE STONE. Every gatehouse, cloister, screen and
#: bridge in PASS 29's first draft took MI_V2_IvoryStone and differed only in
#: the colour of its GLASS -- which is a few per cent of the piece, and at
#: player height in a district you meet the stone first. The founder's ask is
#: "district-specific colour", so the roofs, caps and metalwork carry the
#: district's own accent as well. The body stays ivory on purpose: a world
#: where every quarter's walls are a different colour is a theme park, and the
#: rule this project keeps is that identity comes from ONE thing changing, not
#: from everything changing.
_DEPTH_ACCENT = {
    "RoyalGardens":     ("MI_V2_RoofRose",  "MI_V2_Gold"),
    "ClockQuarter":     ("MI_V2_RoofNavy",  "MI_V2_GoldAged"),
    "TowerRise":        ("MI_V2_RoofLilac", "MI_V2_Bronze"),
    "TeaTerraces":      ("MI_V2_RoofPink",  "MI_V2_Ceramic"),
    "WaterGardens":     ("MI_V2_RoofBlue",  "MI_V2_Bronze"),
    "MushroomGrove":    ("MI_V2_RoofLilac", "MI_V2_Bronze"),
    "LanternHamlets":   ("MI_V2_RoofNavy",  "MI_V2_GoldAged"),
    "GatekeeperFields": ("MI_V2_RoofBlue",  "MI_V2_Gold"),
    # THE OUTER SIX, and they take the accents the inner eight do not. A reach
    # is seen from further away and usually against the horizon haze, so the
    # accent is doing more work there than anywhere: it is often the only
    # thing separating one distant precinct from another.
    "NorthReach":       ("MI_V2_RoofLilac", "MI_V2_GoldAged"),
    "EastReach":        ("MI_V2_RoofRose",  "MI_V2_Bronze"),
    "TheLongWoods":     ("MI_V2_RoofBlue",  "MI_V2_GoldAged"),
    "SouthMeadows":     ("MI_V2_RoofPink",  "MI_V2_Gold"),
    "WestWood":         ("MI_V2_RoofNavy",  "MI_V2_Bronze"),
    "FarOrchards":      ("MI_V2_RoofRose",  "MI_V2_Gold"),
}


def _depth_build(kind, x, y, bdeg, tag, sc, glass, roof="MI_V2_RoofNavy",
                 metal="MI_V2_Bronze"):
    """One depth piece, in the landmark's approach frame.

    `bdeg` is the bearing back toward the world centre, so a piece that faces
    the walker takes bdeg + 90 and a piece the walker passes through takes
    bdeg.
    """
    out = []
    if kind == "gate":
        out.append(A("gatehouse_district", x, y, 0.0, yaw=bdeg, s=sc,
                     mat="MI_V2_IvoryStone", label="%s_Gatehouse" % tag))
        out.append(A("gatehouse_glass", x, y, 0.0, yaw=bdeg, s=sc,
                     mat=glass, label="%s_GatehouseGlass" % tag))
        # THE COLOUR HAS TO BE WHERE IT CAN BE SEEN. This was a coloured
        # roof_cone_steep at s=0.62 seated at the tower's own roof line --
        # r 124 uu inside an ivory roof of r 400, so it was a coloured cone
        # completely enclosed by a white one, invisible in every frame and
        # costing two draws each. Measured off the recipes rather than
        # assumed, which is the only reason it was caught before the render.
        # The banner mast and its ball stand ABOVE the ivory finial (2,836 uu),
        # where the district's colour is the highest thing on the gate.
        for s3 in (1.0, -1.0):
            gx3 = x + math.cos(math.radians(bdeg + 90.0)) * 900.0 * sc * s3
            gy3 = y + math.sin(math.radians(bdeg + 90.0)) * 900.0 * sc * s3
            out.append(A("gate_finial_ball", gx3, gy3, 2860.0 * sc, yaw=bdeg,
                         s=2.4 * sc, mat=roof, label="%s_GateBall%d" % (tag, int(s3))))
            out.append(A("finial_spire", gx3, gy3, 3170.0 * sc, yaw=bdeg,
                         s=1.1 * sc, mat=metal, label="%s_GateSpire%d" % (tag, int(s3))))
        # the road runs THROUGH it, so it needs paving under the arch or the
        # threshold is a gate standing on grass
        out.append(A("terrace_platform", x, y, ROAD_Z, yaw=bdeg,
                     sxyz=(0.42 * sc, 1.05 * sc, 0.35), mat="MI_V2_PlazaGrey",
                     label="%s_GatehouseFloor" % tag))
        for s2 in (1.0, -1.0):
            out.append(A("topiary_cone_plain",
                         x + math.cos(math.radians(bdeg + 90.0)) * 1500.0 * sc,
                         y + math.sin(math.radians(bdeg + 90.0)) * 1500.0 * sc,
                         0.0, yaw=0.0, s=1.5, mat="MI_V2_LeafDark",
                         label="%s_GateCone%d" % (tag, int(s2))) if s2 > 0 else
                        A("topiary_cone_plain",
                          x - math.cos(math.radians(bdeg + 90.0)) * 1500.0 * sc,
                          y - math.sin(math.radians(bdeg + 90.0)) * 1500.0 * sc,
                          0.0, yaw=0.0, s=1.5, mat="MI_V2_LeafDark",
                          label="%s_GateCone%d" % (tag, int(s2))))
    elif kind == "cloister":
        out.append(A("cloister_square", x, y, 0.0, yaw=bdeg, s=sc,
                     mat="MI_V2_IvoryStone", label="%s_Cloister" % tag))
        # same measurement, same correction: the corner turret's own ivory
        # pinnacle is r 210 and tops out at 2,020 uu, so a coloured cone at
        # s=0.5 seated at 1,420 was inside it. Above it instead.
        for k4 in range(4):
            a4 = math.radians(bdeg) + math.pi / 4.0 + math.pi * k4 / 2.0
            out.append(A("gate_finial_ball", x + math.cos(a4) * 1768.0 * sc,
                         y + math.sin(a4) * 1768.0 * sc, 2020.0 * sc,
                         yaw=bdeg, s=1.9 * sc, mat=roof,
                         label="%s_CloisterBall%d" % (tag, k4)))
        out.append(A("terrace_platform", x, y, ROAD_Z, yaw=bdeg,
                     sxyz=(2.0 * sc, 3.9 * sc, 0.35), mat="MI_V2_PlazaCream",
                     label="%s_CloisterFloor" % tag))
    elif kind == "fountain":
        out.append(A("fountain_grand", x, y, 0.0, yaw=bdeg + 22.0, s=sc,
                     mat="MI_V2_IvoryStone", label="%s_Fountain" % tag))
        out.append(A("fountain_finial", x, y, 1560.0 * sc, yaw=bdeg, s=0.9 * sc,
                     mat=metal, label="%s_FountainFinial" % tag))
        out.append(A("fountain_grand_water", x, y, 0.0, yaw=bdeg + 22.0, s=sc,
                     mat="MI_V2_Water", label="%s_FountainWater" % tag))
    elif kind == "screen":
        out.append(A("glass_screen", x, y, 0.0, yaw=bdeg + 90.0, s=sc,
                     mat="MI_V2_IvoryStone", label="%s_Screen" % tag))
        out.append(A("glass_screen_panes", x, y, 0.0, yaw=bdeg + 90.0, s=sc,
                     mat=glass, label="%s_ScreenGlass" % tag))
    elif kind == "swag":
        out.append(A("lantern_swag", x, y, 0.0, yaw=bdeg + 90.0, s=sc,
                     mat=metal, label="%s_Swag" % tag))
        out.append(A("lantern_swag_glass", x, y, 0.0, yaw=bdeg + 90.0, s=sc,
                     mat=glass, label="%s_SwagGlass" % tag))
    elif kind == "orrery":
        out.append(A("orrery_gold", x, y, 0.0, yaw=bdeg + 40.0, s=sc,
                     mat=metal, label="%s_Orrery" % tag))
        out.append(A("stone_ring_base", x, y, 0.0, yaw=0.0, s=1.5 * sc,
                     mat="MI_V2_PlazaGrey", label="%s_OrreryBase" % tag))
    elif kind == "bridge":
        # A BRIDGE NEEDS SOMETHING TO CROSS, so the water comes with it. A
        # channel 8 m wide under the span, its coping either side, and the
        # spur's paving stopping short of both banks.
        out.append(A("bridge_arc", x, y, 0.0, yaw=bdeg, s=sc,
                     mat="MI_V2_IvoryStone", label="%s_Bridge" % tag))
        for s4 in (1.0, -1.0):
            for s5 in (1.0, -1.0):
                out.append(A("waymarker_lamp",
                             x + math.cos(math.radians(bdeg)) * 1240.0 * sc * s4
                               + math.cos(math.radians(bdeg + 90.0)) * 330.0 * sc * s5,
                             y + math.sin(math.radians(bdeg)) * 1240.0 * sc * s4
                               + math.sin(math.radians(bdeg + 90.0)) * 330.0 * sc * s5,
                             620.0 * sc, yaw=bdeg, s=0.9 * sc, mat=glass,
                             label="%s_BridgeLamp%d_%d" % (tag, int(s4), int(s5))))
        # THE CHANNEL IS FLUSH, NOT SUNK. At 60 uu below the road it was a
        # 0.6 m ditch beside the path -- climbable down, not back up against a
        # 30 uu step -- and the gate would not have said so, because it exempts
        # anything labelled Water on the grounds that a rill is meant to be a
        # rill. An exemption is not a licence to build a trap.
        out.append(A("terrace_platform", x, y, ROAD_Z, yaw=bdeg + 90.0,
                     sxyz=(2.6 * sc, 0.62 * sc, 0.30), mat="MI_V2_Water",
                     label="%s_BridgeWater" % tag))
        # coping BESIDE the bridge, on both banks -- the first version ran it
        # across the road at 6.2 m, which is on the deck
        for s2 in (1.0, -1.0):
            for s3 in (1.0, -1.0):
                bx = (x + math.cos(math.radians(bdeg)) * 330.0 * sc * s2
                      + math.cos(math.radians(bdeg + 90.0)) * 1500.0 * sc * s3)
                by = (y + math.sin(math.radians(bdeg)) * 330.0 * sc * s2
                      + math.sin(math.radians(bdeg + 90.0)) * 1500.0 * sc * s3)
                out.append(A("kerb_stone", bx, by, -2.0, yaw=bdeg + 90.0,
                             sxyz=(11.0 * sc, 1.0, 0.7), mat="MI_V2_Kerb",
                             label="%s_BridgeBank%d_%d" % (tag, int(s2), int(s3))))
    return out


def _district_depth():
    out = []
    for who, pieces in _DEPTH:
        site = LANDMARK_SITES.get(who)
        if site is None:
            DEPTH_NOTES.append("%-18s SKIPPED -- its landmark was never placed" % who)
            continue
        lx, ly, _kind, _sc, glass, reach = site
        b = math.atan2(-ly, -lx)                 # back toward the world centre
        bdeg = math.degrees(b)
        ux, uy = math.cos(b), math.sin(b)
        px, py = -uy, ux
        built = []
        placed_at = set()
        for (pk, along, across, psc) in pieces:
            x = lx + ux * (reach + along) + px * across
            y = ly + uy * (reach + along) + py * across
            # A piece that lands on top of an existing landmark is not a
            # second thing to see, it is a bug with a name. Everything here is
            # tested against the same register the landmarks were sited with.
            # SIZED OFF THE MESH, PLUS A MARGIN -- not "how much room would be
            # nice". The first draft asked a cloister for 24 m of clear ground
            # beyond its own centre and TowerRise and Tea Terraces could not
            # place theirs at any point on a 180 m approach: the inner
            # districts are full of garden walls, benches and topiary cones,
            # all of which `_declutter` will remove around a protected asset
            # anyway. These are the built half-extents plus about 3 m.
            need = {"cloister": 1760.0, "gate": 1000.0, "screen": 1150.0,
                    "swag": 700.0, "orrery": 1120.0, "fountain": 960.0,
                    "bridge": 1300.0}[pk] * psc
            # A fountain inside its own cloister is the intended case, and it
            # is only intended if the cloister IS THERE. Pairing against the
            # TABLE rather than against what was placed let a fountain skip
            # the clearance test at a site the cloister had just been dropped
            # from for failing it -- a fountain planted inside whatever the
            # cloister could not stand in. Pair against `placed`.
            paired = pk == "fountain" and (along, across) in placed_at
            if not paired and not (_depth_site_ok(lx, ly, x, y) and _sig_free(x, y, need)):
                # SEARCH THE PLAN, NOT THE LINE. Sliding only along the
                # approach dropped nine of thirty-eight pieces: the inner
                # districts are full, and a spur that meets a quarter building
                # is blocked at every distance along itself. Moving ACROSS as
                # well costs a little of "the gate is on the way in" and buys
                # the piece existing at all, so across is weighted heavier
                # than along in the cost and the note says how far it went.
                cands = []
                for da in [900.0 * k for k in range(-7, 8)]:
                    for dc in [900.0 * k for k in range(-5, 6)]:
                        if da == 0.0 and dc == 0.0:
                            continue
                        cands.append((abs(da) + 2.1 * abs(dc), da, dc))
                cands.sort()
                moved = None
                for _cost, da, dc in cands:
                    x2 = x + ux * da + px * dc
                    y2 = y + uy * da + py * dc
                    if not _depth_site_ok(lx, ly, x2, y2):
                        continue
                    if _sig_free(x2, y2, need):
                        x, y, moved = x2, y2, (da, dc)
                        break
                if moved is None:
                    DEPTH_NOTES.append("%-18s %-9s DROPPED -- no clear ground within 63 m "
                                       "of its site" % (who, pk))
                    continue
                DEPTH_NOTES.append("%-18s %-9s moved %+.0f along / %+.0f across"
                                   % (who, pk, moved[0], moved[1]))
            if not paired:
                _SIG_PLACED.append((x, y, need))
            placed_at.add((along, across))
            built.append(pk)
            roof, metal = _DEPTH_ACCENT.get(who, ("MI_V2_RoofNavy", "MI_V2_Bronze"))
            out += _depth_build(pk, x, y, bdeg, "DP%s" % who, psc, glass, roof, metal)
        DEPTH_NOTES.append("%-18s %s" % (who, ", ".join(built) or "nothing placed"))
    return out


DEPTH = _band("V2_Skyline", _district_depth())


# ---------------------------------------------------------------------------
# REVEAL, SECOND PASS -- the architecture that did not exist the first time
# ---------------------------------------------------------------------------
#
# `_reveal_city` runs where it does because the woodland has to be thinned
# before the landmarks are sited into it. That means its cones could only ever
# be drawn to the skyline and the castle: the fourteen district landmarks and
# every piece of PASS 29's district depth are placed AFTER it, so nothing has
# ever cleared a sightline to a gatehouse, a cloister, a screen or a bridge.
#
# The founder's list is "gates, towers, courts, bridges, plazas, skyline
# anchors and district entrances", and five of those seven were invisible to
# the only filter that opens a view. So the same filter runs again over the
# same bands with the new marks -- SIGHTLINES ONLY. The clearing field is a
# property of the woodland; applying it twice would thin the same trees
# against the same threshold a second time and quietly halve the forest.


def _depth_marks():
    """Every district destination worth clearing a view to, and how wide
    it is. The widths are the half-extents the FOOT table already records or
    the recipe's measured bbox, not a guess -- a cone drawn 16 m wide to a 7 m
    pavilion clears woodland nobody was looking through."""
    marks = []
    for p in LANDMARKS:
        w = {"clock_grand": 1200.0, "teapot_pavilion": 1600.0,
             "key_colossal": 900.0, "glass_pavilion": 1000.0,
             "floating_stair": 1300.0, "flower_colossal": 700.0,
             "gear_monument": 800.0}.get(p["asset"])
        if w:
            marks.append((p["pos"][0], p["pos"][1], w * abs(p["scale"][0])))
    for p in DEPTH:
        w = {"gatehouse_district": 1300.0, "cloister_square": 1500.0,
             "glass_screen": 1050.0, "bridge_arc": 1400.0,
             "orrery_gold": 800.0, "fountain_grand": 700.0}.get(p["asset"])
        if w:
            marks.append((p["pos"][0], p["pos"][1], w * abs(p["scale"][0])))
    return marks


_reveal_city([OUTER_WORLD, HORIZON, FLANKS, REARWORLD, PALACE, GROUND_QUILT,
              CAM_FOREGROUNDS], marks=_depth_marks(), thin=False)

#: The enchanted landmarks are the reason a district is a place; scatter must
#: not grow through them either.
_PROTECT = _PROTECT + ("clock_grand", "gear_monument", "key_colossal",
                       "flower_colossal", "glass_pavilion", "teapot_pavilion",
                       "floating_stair",
                       # PASS 29's district depth. `_sig_free` lets these stand
                       # where hedges and cones stand on exactly the same
                       # promise the signature landmarks were given, and the
                       # promise is kept in the same place: a cloister with a
                       # topiary growing through its arcade is the failure this
                       # filter exists for.
                       "gatehouse_district", "cloister_square", "bridge_arc",
                       "orrery_gold", "glass_screen", "lantern_swag",
                       "fountain_grand")
for _bandref in (OUTER_WORLD, HORIZON, GROUND_QUILT, FLANKS, REARWORLD):
    _bandref[:] = _declutter(_bandref, also=LANDMARKS + DEPTH)

# ===========================================================================
# THE COURTS STOP BEING BLANK SLABS  (batch D, second half)
# ===========================================================================
#
# "Improve large pale-stone areas with borders, inlays, medallions, subtle
# wear, petals and scale variation. Avoid huge empty modern-plaza surfaces."
#
# The ARRIVAL plaza already has a centre and an edge -- a medallion of gold
# and stone inlays and a border course -- and PASS 08 gave its slabs four
# tints. Nothing else in Wonderland got either. Measured: 48 courts and 14
# yards paved with `terrace_platform`, one flat `MI_V2_PlazaWarm` rectangle
# each, and the largest is 41 x 25 m. Sixty-two blank plazas.
#
# So the plaza's own rule is applied to all of them, which is the point: one
# description of what a paved court in this world IS, not a second one.
#
#   centre  a medallion of twelve alternating gold and shade inlays with an
#           inner ring, so the middle is worked
#   edge    a border course inset from the perimeter, so paving stops being
#           a field that simply ends
#   field   three to five overlapping slabs at other tints and angles, laid at
#           EXACTLY the court's own surface height, which is the "scale
#           variation" and "subtle wear" without a decal or a noise texture
#   colour  petal patches at the corners
#
# THE STEP-HEIGHT CONTRACT IS WHY THE FIELD SLABS ARE AT ROAD_Z. A court's
# walking surface is ROAD_Z + 140 * 0.35 = 19 uu. A tint slab laid at the same
# z with the same z-scale has its top at 19 too -- lip zero. The inlays are
# `kerb_stone` at 0.12 of its 28 uu, so 3.4 uu proud of the court and 22 above
# ground, inside MaxStepHeight 30. This world lost a whole traversal audit to
# a one-unit lip; nothing here is laid by eye.

_COURT_TINTS = ("MI_V2_PlazaCream", "MI_V2_PlazaGrey", "MI_V2_PlazaShade",
                "MI_V2_PlazaWarm")


def _is_court(label):
    """A paved COURT, not a road. Roads, lanes and walks are also
    terrace_platform and dressing them would put a medallion in a street."""
    tail = label.rsplit("_", 1)[-1] if "_" in label else label
    base = tail.rstrip("0123456789")
    return base in ("Court", "Yard")


def _dress_courts(bands):
    """One medallion, one border and some tonal variety per paved court."""
    groups = {}
    for band in bands:
        for p in band:
            if p["asset"] != "terrace_platform":
                continue
            lab = p.get("label") or ""
            if not _is_court(lab):
                continue
            x, y = p["pos"][0], p["pos"][1]
            key = (round(x / 300.0), round(y / 300.0))
            g = groups.setdefault(key, {"x": x, "y": y, "hx": 0.0, "hy": 0.0,
                                        "tag": lab.rsplit("_", 1)[0], "z": p["pos"][2]})
            # the two crossed platforms of a court are at yaw 0 and 90, so the
            # court's reach is the larger of each piece's ROTATED half-extent
            yaw = abs(p["rot"][1]) % 180.0
            ex, ey = 720.0 * abs(p["scale"][0]), 370.0 * abs(p["scale"][1])
            if 45.0 < yaw < 135.0:
                ex, ey = ey, ex
            g["hx"], g["hy"] = max(g["hx"], ex), max(g["hy"], ey)

    out = []
    for i, (key, g) in enumerate(sorted(groups.items())):
        cx, cy, hx, hy = g["x"], g["y"], g["hx"], g["hy"]
        tag, z = g["tag"], g["z"]
        h = min(hx, hy)
        if h < 380.0:                       # too small to have a middle
            continue
        top = z + 140.0 * 0.35              # the court's own walking surface
        # --- the medallion
        for k in range(12):
            a = 6.283 * k / 12.0
            r = h * 0.30
            out.append(A("kerb_stone", cx + math.cos(a) * r, cy + math.sin(a) * r, top,
                         yaw=math.degrees(a) + 90.0, sxyz=(1.35, 0.55, 0.12),
                         mat=("MI_V2_Gold", "MI_V2_PlazaShade")[k % 2],
                         label="%s_Inlay%d" % (tag, k)))
        for k in range(8):
            a = 6.283 * k / 8.0 + 0.39
            out.append(A("kerb_stone", cx + math.cos(a) * h * 0.15,
                         cy + math.sin(a) * h * 0.15, top,
                         yaw=math.degrees(a) + 90.0, sxyz=(0.95, 0.45, 0.11),
                         mat="MI_V2_PlazaCream", label="%s_InlayIn%d" % (tag, k)))
        # --- the border course, inset so the paving has a margin
        bx, by = hx * 0.86, hy * 0.86
        n = max(3, int(bx / 460.0))
        for k in range(n + 1):
            t = -1.0 + 2.0 * k / n
            for sgn in (1.0, -1.0):
                out.append(A("kerb_stone", cx + bx * t, cy + sgn * by, top,
                             yaw=0.0, sxyz=(2.0, 0.6, 0.13), mat="MI_V2_Kerb",
                             label="%s_Border%s%d" % (tag, "T" if sgn > 0 else "B", k)))
        n2 = max(3, int(by / 460.0))
        for k in range(n2 + 1):
            t = -1.0 + 2.0 * k / n2
            for sgn in (1.0, -1.0):
                out.append(A("kerb_stone", cx + sgn * bx, cy + by * t, top,
                             yaw=90.0, sxyz=(2.0, 0.6, 0.13), mat="MI_V2_Kerb",
                             label="%s_Border%s%d" % (tag, "L" if sgn > 0 else "R", k)))
        # --- tonal field: other stone, other angles, the SAME height
        for k in range(3 + (i % 3)):
            a = 6.283 * _rnd(i, k, 71)
            rr = h * (0.36 + 0.42 * _rnd(i, k, 72))
            out.append(A("terrace_platform", cx + math.cos(a) * rr, cy + math.sin(a) * rr,
                         z, yaw=17.0 + 41.0 * k,
                         sxyz=(0.30 + 0.36 * _rnd(i, k, 73),
                               0.34 + 0.40 * _rnd(i, k, 74), 0.35),
                         mat=_COURT_TINTS[(i + k) % 4],
                         label="%s_Field%d" % (tag, k)))
        # --- petals, at the corners rather than over the middle
        corners = ((1, 1), (1, -1), (-1, 1), (-1, -1))
        for k in range(4):
            out.append(A("ground_flowers", cx + corners[k][0] * hx * 0.62,
                         cy + corners[k][1] * hy * 0.62, top + 4.0,
                         yaw=53.0 * k, s=0.9,
                         mat=("MI_V2_PetalRose", "MI_V2_PetalWhite",
                              "MI_V2_Lavender", "MI_V2_PetalPink")[k % 4],
                         label="%s_Petals%d" % (tag, k)))
    return out


COURT_DRESS = _band("V2_Skyline", _dress_courts(
    [OUTER_WORLD, SIGNATURE, LANDMARKS, FLANKS, REARWORLD, PALACE]))

# ===========================================================================
# THE ROUTES  (batch C, second half -- wonder per METRE)
# ===========================================================================
#
# "Add memorable authored moments along ROUTES and districts." The districts
# have one each now. The routes are 404 paved segments across 139 runs --
# about 6.7 km of paving with kerbs on it and NOTHING ELSE. Wonder per metre
# is a claim about the metres between the landmarks, and those were empty.
#
# Two cadences, both derived from the road data rather than from new
# geometry, so a road that moves takes its wayside with it:
#
#   every 2nd segment (~33 m)   a waymarker: a 7 m pillar with a caged glass
#                               lamp whose COLOUR IS THE DISTRICT'S. A road
#                               tells you which quarter you are walking into
#                               before its landmark is in sight, which is the
#                               brief's "route treatment" as a mechanism
#                               rather than as an adjective.
#   every 8th segment (~130 m)  a wayside wonder drawn from that district's
#                               own vocabulary, at wayside scale -- 6 to 10 m,
#                               never near its landmark's size. A wayside
#                               piece that competes with a district landmark
#                               is exactly the theme-park clutter the brief
#                               names as the failure mode.
#
# EVERYTHING IS OFFSET TO THE SIDE OF THE CARRIAGEWAY, past the kerb line, and
# every position is clearance-checked. The traversal contract is not something
# to re-prove after decorating a road; it is a reason not to decorate the road
# itself.

FOOT.update({"waymarker": (120, 120)})

#: district -> (glass tint, wayside kind). Two districts share a kind at most,
#: and where they do the tint differs, which is the same rule the district
#: landmarks follow.
# THREE NEW KINDS IN PASS 29, and one rule finally kept. The comment above
# says "two districts share a kind at most" and `key` was in three -- South
# Meadows, North Reach and Gatekeeper Fields -- so the roads of three separate
# districts revealed the same gold key. The new district architecture supplies
# the vocabulary to fix that rather than inventing more props: a lantern swag
# SPANS the road (the only wayside piece the walker passes UNDER), a traceried
# screen stands facing them at a set-back, and a small fountain marks a
# junction. Each is used exactly once.
_ROUTE_LANG = {
    "Clock Quarter":      ("MI_V2_GlassAmber",  "clock"),
    "Far Orchards":       ("MI_V2_GlassRose",   "clock"),
    "Royal Gardens":      ("MI_V2_GlassRose",   "bloom"),
    "The Long Woods":     ("MI_V2_GlassViolet", "bloom"),
    "Tower Rise":         ("MI_V2_GlassViolet", "gears"),
    "East Reach":         ("MI_V2_GlassAmber",  "gears"),
    "Lantern Hamlets":    ("MI_V2_GlassAmber",  "swag"),
    "West Wood":          ("MI_V2_GlassTeal",   "lantern"),
    "Tea Terraces":       ("MI_V2_GlassRose",   "tea"),
    "Water Gardens":      ("MI_V2_GlassTeal",   "fountain"),
    "South Meadows":      ("MI_V2_GlassAmber",  "screen"),
    "Mushroom Grove":     ("MI_V2_GlassTeal",   "mush"),
    "North Reach":        ("MI_V2_GlassViolet", "key"),
    "Gatekeeper Fields":  ("MI_V2_GlassAmber",  "key"),
}

WAYSIDE_NOTES = []


def _wayside_piece(kind, x, y, yaw, tag, tint):
    """One wayside wonder, from its district's own vocabulary."""
    if kind == "clock":
        return [A("pedestal_finial", x, y, 0.0, s=1.5, mat="MI_V2_IvoryStone", label=tag + "_Plinth"),
                A("clock_ornate", x, y, 340.0, yaw=yaw, s=2.4, mat="MI_V2_GoldAged", label=tag + "_Clock")]
    if kind == "bloom":
        return [A("flower_colossal", x, y, 0.0, yaw=yaw, s=0.34, mat="MI_V2_LeafMid", label=tag + "_Stem"),
                A("flower_colossal_bloom", x, y, 0.0, yaw=yaw, s=0.34,
                  mat=("MI_V2_RosePink", "MI_V2_PetalViolet")[int(x + y) % 2], label=tag + "_Bloom")]
    if kind == "gears":
        return [A("gear_monument", x, y, 0.0, yaw=yaw, s=0.28, mat="MI_V2_GoldAged", label=tag + "_Gears")]
    if kind == "lantern":
        return [A("lantern_strange", x, y, 0.0, yaw=yaw, s=0.52, mat="MI_V2_Bronze", label=tag + "_Lantern"),
                A("lantern_strange_glass", x, y, 0.0, yaw=yaw, s=0.52, mat=tint, label=tag + "_LanternGlass")]
    if kind == "tea":
        return [A("tea_saucer", x, y, 0.0, yaw=yaw, s=2.3, mat="MI_V2_Ceramic", label=tag + "_Saucer"),
                A("tea_cup", x, y, 30.0, yaw=yaw + 40.0, s=2.3, mat="MI_V2_Ceramic", label=tag + "_Cup")]
    if kind == "mush":
        return [A("mushroom_giant", x, y, 0.0, yaw=yaw, s=0.5,
                  mat=("MI_V2_MushRed", "MI_V2_MushPurple", "MI_V2_MushCream")[int(x) % 3],
                  label=tag + "_Mush")]
    if kind == "key":
        return [A("pedestal_finial", x, y, 0.0, s=1.4, mat="MI_V2_IvoryStone", label=tag + "_Plinth"),
                A("key_ornate", x, y, 320.0, yaw=yaw, s=3.6, mat="MI_V2_GoldAged", label=tag + "_Key")]
    # PASS 29. `yaw` arrives as the road bearing + 90, i.e. ACROSS the road, so
    # a swag authored along its own local X spans the carriageway and the
    # walker goes under it -- the only wayside piece in the world that is not
    # something to look at from beside the road.
    if kind == "swag":
        return [A("lantern_swag", x, y, 0.0, yaw=yaw + 90.0, s=0.55,
                  mat="MI_V2_Bronze", label=tag + "_Swag"),
                A("lantern_swag_glass", x, y, 0.0, yaw=yaw + 90.0, s=0.55,
                  mat=tint, label=tag + "_SwagGlass")]
    if kind == "screen":
        return [A("glass_screen", x, y, 0.0, yaw=yaw, s=0.42,
                  mat="MI_V2_IvoryStone", label=tag + "_Screen"),
                A("glass_screen_panes", x, y, 0.0, yaw=yaw, s=0.42,
                  mat=tint, label=tag + "_ScreenGlass")]
    if kind == "fountain":
        return [A("fountain_grand", x, y, 0.0, yaw=yaw, s=0.46,
                  mat="MI_V2_IvoryStone", label=tag + "_Fountain"),
                A("fountain_grand_water", x, y, 0.0, yaw=yaw, s=0.46,
                  mat="MI_V2_Water", label=tag + "_FountainWater")]
    return []


def _wayside(bands):
    """Waymarkers and wayside wonders along every road in the world."""
    import re as _re
    segs = []
    for band in bands:
        for p in band:
            if p["asset"] != "terrace_platform":
                continue
            lab = p.get("label") or ""
            if not _re.search(r"_Seg\d+$", lab):
                continue
            segs.append(p)
    segs.sort(key=lambda p: (p.get("label") or ""))

    # what is already standing, so nothing is planted inside a wall
    solid = []
    surface = ("garden_lawn", "terrace_platform", "ground_flowers", "ground_blooms",
               "flagstone", "kerb_stone", "sky_dome", "path_steps", "side_steps")
    for band in bands:
        for p in band:
            a = p["asset"]
            if a in surface or a.startswith("cloud_") or a.startswith("sea_"):
                continue
            hx, hy = FOOT.get(a, (170, 170))
            solid.append((p["pos"][0], p["pos"][1],
                          max(hx * abs(p["scale"][0]), hy * abs(p["scale"][1]))))

    def free(x, y, need):
        for (px, py, pr) in solid:
            if abs(px - x) > need + pr or abs(py - y) > need + pr:
                continue
            if math.hypot(px - x, py - y) < need + pr:
                return False
        return True

    out = []
    n_mark = n_wonder = n_skip = 0
    for i, p in enumerate(segs):
        if i % 2:
            continue
        cx, cy = p["pos"][0], p["pos"][1]
        yaw = math.radians(p["rot"][1])
        # the carriageway's half-width comes from the segment's own y scale --
        # 740 uu at scale 1 -- so a wide road pushes its wayside further out
        # and a lane keeps it close, without either being written down twice
        half = 740.0 * abs(p["scale"][1]) * 0.5
        side = 1.0 if (i // 2) % 2 == 0 else -1.0
        ux, uy = -math.sin(yaw) * side, math.cos(yaw) * side
        district, _kind = _district_of(cx, cy)
        tint, wkind = _ROUTE_LANG.get(district, ("MI_V2_GlassAmber", "lantern"))
        # ONE WONDER PER 29 SEGMENTS IS NOT WONDER PER METRE. At `i % 16` --
        # over a loop that already skips odd indices, so every 32nd segment --
        # 404 road segments carried 14 wonders, and four of the ten kinds never
        # appeared anywhere in the world because their districts' roads never
        # landed on one. The clearance search below is what decides whether a
        # position is usable, and it reports its skips, so the cadence can be
        # asked for honestly and the world answers.
        big = (i % 6 == 0)
        # A SWAG IS NOT A VERGE PIECE. Every other wayside wonder stands
        # beside the carriageway; this one hangs across it, so it is placed on
        # the road's own centre line and needs the room its 16.5 m span takes.
        spans = big and wkind == "swag"
        need = (940.0 if spans else 780.0) if big else 150.0
        # SEARCH BOTH VERGES AND SEVERAL SET-BACKS. The first version tried
        # one offset on each side and skipped HALF of its 202 positions,
        # leaving one marker per 69 m on a road system whose whole point was
        # wonder per metre. The verges are busy, so the set-back is a search:
        # the wayside steps back from the carriageway until it finds room, and
        # a skip now means there genuinely is none.
        base = half + (900.0 if big else 380.0)
        spot = None
        if spans:
            # on the centre line, stepping ALONG the road for room
            for step in (0.0, 900.0, -900.0, 1800.0, -1800.0):
                x = cx + math.cos(yaw) * step
                y = cy + math.sin(yaw) * step
                if free(x, y, need):
                    spot = (x, y)
                    break
        else:
            for grow in (0.0, 340.0, 700.0, 1150.0, 1700.0):
                for sgn in (1.0, -1.0):
                    x = cx + ux * sgn * (base + grow)
                    y = cy + uy * sgn * (base + grow)
                    if free(x, y, need):
                        spot = (x, y)
                        break
                if spot:
                    break
        if spot is None:
            n_skip += 1
            continue
        x, y = spot
        tag = "Way%04d" % i
        if big:
            piece = _wayside_piece(wkind, x, y, math.degrees(yaw) + 90.0, tag, tint)
            if piece:
                out += piece
                solid.append((x, y, need))
                n_wonder += 1
                # AND THE ROAD KEEPS ITS MARKER. A wonder used to REPLACE the
                # waymarker at its position, so raising the wonder cadence from
                # every 32nd segment to every 12th took the world from 172
                # markers to 131 -- and the founder's preserve list names 171.
                # A wayside wonder is something extra to walk toward, not a
                # substitute for knowing where the road goes. The marker takes
                # the ordinary verge offset on the far side, searched the same
                # way, and is simply skipped if there is no room.
                placed_mark = False
                for grow in (0.0, 340.0, 700.0, 1150.0, 1700.0):
                  for msgn in (-1.0, 1.0):
                    mx = cx + ux * msgn * (half + 380.0 + grow)
                    my = cy + uy * msgn * (half + 380.0 + grow)
                    if free(mx, my, 150.0):
                        out.append(A("waymarker", mx, my, 0.0, yaw=math.degrees(yaw), s=0.75,
                                     mat="MI_V2_IvoryStone", label=tag + "_Marker"))
                        out.append(A("waymarker_lamp", mx, my, 0.0, yaw=math.degrees(yaw), s=0.75,
                                     mat=tint, label=tag + "_Lamp"))
                        solid.append((mx, my, 150.0))
                        n_mark += 1
                        placed_mark = True
                        break
                  if placed_mark:
                      break
                continue
        out.append(A("waymarker", x, y, 0.0, yaw=math.degrees(yaw), s=0.75,
                     mat="MI_V2_IvoryStone", label=tag + "_Marker"))
        out.append(A("waymarker_lamp", x, y, 0.0, yaw=math.degrees(yaw), s=0.75,
                     mat=tint, label=tag + "_Lamp"))
        solid.append((x, y, need))
        n_mark += 1
    WAYSIDE_NOTES.append(
        "wayside: %d waymarkers, %d wonders, %d positions skipped for clearance, "
        "over %d road segments" % (n_mark, n_wonder, n_skip, len(segs)))
    return out


WAYSIDE = _band("V2_Skyline", _wayside(
    [OUTER_WORLD, SIGNATURE, LANDMARKS, PALACE, FLANKS, REARWORLD]))

# ---------------------------------------------------------------------------
# THE SOUTHERN QUARTER -- the first district built from a MEASUREMENT rather
# than from a camera.
#
# emptiness.py, 2026-09-04: the largest empty region in Wonderland is 17,712
# m2 centred at (6736, -29819) -- 1.77 hectares, x -134..242 m, y -358..-202 m.
# Three earlier passes went into one twenty-metre patch because a camera was
# pointed at it; this is the biggest actual hole in the world.
#
# IT IS A QUARTER, NOT A DECORATION PASS. A street with a destination at each
# end, blocks of houses that front onto it, arcades and balconies for facade
# depth, a market with a fountain, a cloister court, and a tower group that
# fills a gap the skyline audit found: 479 pieces stand 30-50 m and only 28
# stand 80-120 m, so the eye jumps from the city mass straight to the great
# spire with no rungs between. These towers are those rungs.
#
# THE STREET AIMS AT THE SPIRE. Not decoration either: skyline.py puts
# spire_great at (0, 8200) and the quarter is 386 m south of it, so a street
# laid along the bearing from here to there gives a walker a view corridor
# with the landmark closing it. The axis is computed, not guessed.
# ---------------------------------------------------------------------------
# THE ARCHITECTURE KIT.
#
# Written after measuring, because every visual defect in the first two
# districts turned out to be a scale mistake rather than a design one. From
# skyline.py's own meshkit bboxes:
#
#     lantern_swag        32.6 m wide, 12.5 m tall     <- a street-spanning
#                                                         GARLAND, and one was
#                                                         hung on every facade
#                                                         bay: 24 of them
#     lantern_strange     13.9 x 21.8 m                <- 48 used as street lamps
#     orrery_gold         15.2 x 26.4 m                <- a landmark, placed as
#                                                         a plaza ornament at 1.5
#     castle_hall         12.6 x 8.8 x 10.0 m
#     column_ornate        1.8 x  1.9 x  9.5 m
#     facade_panel         4.4 x  1.7 x  6.3 m
#
# The founder's list -- "too much gold ornament", "obvious repeated procedural
# rhythms", "facades lack depth" -- is that table. Ornament the size of a
# building repeated every eight metres IS the rhythm you can see.
#
# So the kit works in MEASURED units and builds in the order the reference
# does: base -> body -> crown, with the facade rhythm made of things that are
# actually facade-sized.
_KIT_ROOF_TIERS = {
    # cap -> (height at s=1, the width it wants to sit on)
    "roof_ogee": (8.2, 6.2), "roof_bell": (7.0, 6.9),
    "roof_cone_steep": (6.0, 4.0), "roof_hip": (4.2, 13.0),
    "roof_flat_crenellated": (1.0, 5.2),
}
#: The reference board's roof palette is CORAL / ROSE / TERRACOTTA over ivory,
#: with lilac and blue as accents -- not the navy-led mix the first two
#: districts used. Ordered so a hash pick lands on warm far more often.
KIT_ROOFS = ("MI_V2_RoofRose", "MI_V2_RoofPink", "MI_V2_RoofRose",
             "MI_V2_MushTerracotta", "MI_V2_RoofLilac", "MI_V2_RoofPink",
             "MI_V2_RoofRose", "MI_V2_RoofBlue")
#: THE WALLS ARE NOT ALL ONE IVORY. The founder's list ends with "materials too
#: uniform", and every wall in the first two districts was MI_V2_IvoryStone --
#: one instance batch, one tone, across a whole city. The reference board's
#: stone swatches are a family: warm cream, cool grey-white, shaded. Varying by
#: seed costs nothing (the instancing key already includes the material, so
#: this trades one huge batch for six large ones) and it is most of what stops
#: a generated street reading as a single extruded object.
KIT_WALLS = ("MI_V2_IvoryStone", "MI_V2_PlazaCream", "MI_V2_IvoryStone",
             "MI_V2_PlazaWarm", "MI_V2_Stone", "MI_V2_IvoryStone",
             "MI_V2_PlazaShade", "MI_V2_Ceramic")


def kit_crown(x, y, z, yaw, width_m, seed, tag, mat=None):
    """A STACKED crown, which is what the reference towers actually have.

    Every tower in the first two districts was a cylinder with one cap on it --
    the founder's "too many simple cylinder + tower-cap forms". The reference
    stacks two or three roofs of falling diameter with a spire above, so the
    silhouette steps instead of stopping.
    """
    out = []
    k = seed
    roof = mat or KIT_ROOFS[k % len(KIT_ROOFS)]
    tiers = (("roof_bell", "roof_cone_steep"),
             ("roof_ogee", "roof_cone_steep"),
             ("roof_hip", "roof_bell", "roof_cone_steep"))[k % 3]
    zc = z
    for ti, cap in enumerate(tiers):
        h_m, want_w = _KIT_ROOF_TIERS[cap]
        # each tier sits on what the one below left, narrowing as it rises
        s = (width_m * (0.92 ** ti)) / want_w
        out.append(A(cap, x, y, zc, yaw=yaw + 9.0 * ti, s=s,
                     mat=roof if ti == 0 else KIT_ROOFS[(k + ti) % len(KIT_ROOFS)],
                     label="%s_Tier%d" % (tag, ti)))
        zc += h_m * s * 100.0 * 0.78      # overlap so tiers read as one crown
    out.append(A("finial_spire", x, y, zc, yaw=yaw, s=max(0.8, width_m / 4.0),
                 mat="MI_V2_Gold", label="%s_Spire" % tag))
    return out


def kit_facade(x, y, yaw, width_m, seed, tag, bays=None, lamp=False):
    """A facade with DEPTH: pilasters between the bays, an arch at the middle
    one, a cornice line over the top. facade_panel is 4.4 m wide and
    column_ornate is 1.8 -- so a 12.6 m hall takes two bays and three
    pilasters, which is a rhythm rather than a repeat.

    `lamp` is off by default and deliberately so. lantern_swag is 32.6 m wide;
    it belongs ACROSS a street, once, not on a building.
    """
    out = []
    k = seed
    n = bays if bays is not None else max(2, int(width_m / 5.2))
    step = width_m / float(n)
    fwd = math.radians(yaw - 90.0)
    along = math.radians(yaw)
    for i in range(n):
        off = (-width_m * 0.5 + step * (i + 0.5)) * 100.0
        bx = x + math.cos(along) * off + math.cos(fwd) * 402.0
        by = y + math.sin(along) * off + math.sin(fwd) * 402.0
        out.append(A("facade_panel", bx, by, 300.0, yaw=yaw, s=step / 4.4,
                     mat=KIT_WALLS[(k + i) % len(KIT_WALLS)],
                     label="%s_Bay%d" % (tag, i)))
        # the pilaster between this bay and the next: 9.5 m tall at s=1, so a
        # 10 m storey takes about 0.75
        px_ = x + math.cos(along) * (off + step * 50.0) + math.cos(fwd) * 430.0
        py_ = y + math.sin(along) * (off + step * 50.0) + math.sin(fwd) * 430.0
        out.append(A("column_ornate", px_, py_, 0.0, yaw=yaw, s=0.72,
                     mat="MI_V2_IvoryStone", label="%s_Pilaster%d" % (tag, i)))
        if i == n // 2:
            out.append(A("arch_stone", bx, by, 0.0, yaw=yaw, s=0.42,
                         mat="MI_V2_PlazaCream", label="%s_Entrance" % tag))
    # THE CORNICE. A flat parapet band over the bays, which is most of what
    # separates a building from a box: the reference never has a wall meeting
    # sky without a line on it.
    # THE CORNICE IS GOLD, and that is a measurement rather than a taste.
    # gap_v2 against the reference: palette.gold 0.058 vs 0.365 -- SIX TIMES
    # under. The reference's aged gold is not a few finials, it is trim on
    # everything, and removing the oversized garlands (correctly) left the city
    # with almost none. A cornice line runs the full width of every facade,
    # which is the largest gold surface available for the fewest pieces.
    out.append(A("balustrade", x + math.cos(fwd) * 410.0,
                 y + math.sin(fwd) * 410.0, 700.0, yaw=yaw,
                 s=width_m / 3.5, mat="MI_V2_GoldAged",
                 label="%s_Cornice" % tag))
    # a gold ball on each pilaster head: small, cheap, and it puts a highlight
    # at the top of every bay rather than one per building
    for gi in range(n):
        goff = (-width_m * 0.5 + step * (gi + 1.0)) * 100.0
        gx = x + math.cos(along) * goff + math.cos(fwd) * 430.0
        gy = y + math.sin(along) * goff + math.sin(fwd) * 430.0
        out.append(A("gate_finial_ball", gx, gy, 960.0, yaw=yaw, s=0.9,
                     mat="MI_V2_Gold", label="%s_PilasterCap%d" % (tag, gi)))
    if lamp:
        out.append(A("waymarker_lamp", x + math.cos(fwd) * 620.0,
                     y + math.sin(fwd) * 620.0, 0.0, yaw=yaw, s=1.0,
                     mat="MI_V2_GoldAged", label="%s_Lamp" % tag))
    return out


def kit_building(x, y, yaw, seed, tag, storeys=1, tower=True, scale=1.0):
    """base -> body -> crown, the order the reference reads in.

    Storeys stack castle_hall (10 m each) so a block can be two or three high
    without a new mesh, which is what makes a street wall rather than a row of
    bungalows.
    """
    out = []
    k = seed
    for st in range(storeys):
        z = st * 1000.0 * scale
        out.append(A("castle_hall", x, y, z, yaw=yaw, s=scale,
                     mat=KIT_WALLS[(k + st) % len(KIT_WALLS)],
                     label="%s_Body%d" % (tag, st)))
        out += kit_facade(x, y, yaw, 12.6 * scale, k + st, "%s_F%d" % (tag, st),
                          lamp=(st == 0 and k % 3 == 0))
        if st:
            out.append(A("balcony_ring", x, y, z, yaw=yaw, s=scale * 0.68,
                         mat="MI_V2_GoldAged", label="%s_Bal%d" % (tag, st)))
    ztop = storeys * 1000.0 * scale
    out.append(A("roof_flat_crenellated", x, y, ztop, yaw=yaw, s=scale * 1.1,
                 mat="MI_V2_GoldAged", label="%s_Parapet" % tag))
    if tower:
        body = ("castle_tower_slender", "castle_tower_octagon",
                "castle_tower", "castle_tower_square")[k % 4]
        ts = scale * (1.5 + 0.5 * (k % 3))
        bw = {"castle_tower_slender": 2.7, "castle_tower_octagon": 6.9,
              "castle_tower": 5.8, "castle_tower_square": 5.6}[body]
        out.append(A(body, x, y, ztop, yaw=yaw + 11.0, s=ts,
                     mat=KIT_WALLS[(k + 3) % len(KIT_WALLS)],
                     label="%s_Tower" % tag))
        zt = ztop + _S_BODY_H[body] * ts
        out += kit_crown(x, y, zt, yaw, bw * ts, k, "%s_Crown" % tag)
        out.append(A("balcony_ring", x, y, zt * 0.94, yaw=yaw, s=ts * 0.85,
                     mat="MI_V2_GoldAged", label="%s_TowerBal" % tag))
    return out


def kit_massing(x, y, yaw, seed, tag, scale=1.0, storeys=2):
    """A DISTANT building: mass and crown, no bays, no pilasters, no arch.

    The detail bands the founder set are 0-50 m authored, 50-200 m modular,
    200 m+ cheap. kit_building is the 0-200 m article -- twelve to sixty
    placements each, because a facade you can walk up to needs them. At 400 m
    none of that is resolvable and all of it is paid for, so the far band gets
    the silhouette only: the stack, a parapet, and a crown, which is the entire
    contribution a building makes to a skyline.
    """
    out = []
    k = seed
    for st in range(storeys):
        out.append(A("castle_hall", x, y, st * 1000.0 * scale, yaw=yaw, s=scale,
                     mat=KIT_WALLS[(k + st) % len(KIT_WALLS)],
                     label="%s_M%d" % (tag, st)))
    ztop = storeys * 1000.0 * scale
    body = ("castle_tower_slender", "castle_tower_octagon", "castle_tower")[k % 3]
    ts = scale * (1.2 + 0.4 * (k % 3))
    bw = {"castle_tower_slender": 2.7, "castle_tower_octagon": 6.9,
          "castle_tower": 5.8}[body]
    out.append(A(body, x, y, ztop, yaw=yaw, s=ts,
                 mat=KIT_WALLS[(k + 2) % len(KIT_WALLS)],
                 label="%s_T" % tag))
    out += kit_crown(x, y, ztop + _S_BODY_H[body] * ts, yaw, bw * ts, k,
                     "%s_C" % tag)
    return out


def skyline_ring(r_inner_m, r_outer_m, rings, per_ring, seed, tag):
    """The city goes on past the edge of the sampled world.

    Every emptiness audit runs on a 720 x 760 m window, so "no empty ground"
    has only ever meant no empty ground INSIDE that box. The reference board's
    world-scale panel shows the city running to the horizon in every direction,
    and a wide shot from inside a 360 m disc shows its edge. This fills the
    band beyond with massing on the same kit, so the horizon is city rather
    than the place the city stops.
    """
    out = []
    for ri in range(rings):
        r = r_inner_m + (r_outer_m - r_inner_m) * (ri / max(1.0, rings - 1.0))
        n = int(per_ring * (r / r_inner_m))
        for i in range(n):
            a = (2.0 * math.pi * i / n) + 0.37 * ri + 0.11 * seed
            # jitter, so a ring does not read as a ring
            h = _rnd(seed, ri, i)
            rr = (r + (h - 0.5) * (r_outer_m - r_inner_m) * 0.42) * 100.0
            x = math.cos(a) * rr
            y = math.sin(a) * rr
            # keep the castle sightline clear: nothing within 12 deg of +y
            if abs(math.degrees(math.atan2(x, y))) < 12.0 and y > 0:
                continue
            k = seed * 101 + ri * 13 + i
            # SCALED AFTER MEASURING. At scale 1.5-2.9 the ring topped out at
            # 332 m and skyline.py's dominance -- the great spire against the
            # next distinct site -- went to 1.00x. A horizon that is TALLER
            # than the landmark it surrounds does not read as distance, it
            # reads as the spire having been demoted. These reach about 100 m:
            # a city on the skyline, comfortably under the 194 m spire.
            out += kit_massing(x, y, math.degrees(a) + 90.0 + 40.0 * h, k,
                               "%s_R%d_%03d" % (tag, ri, i),
                               scale=0.85 + 0.55 * h, storeys=1 + (k % 2))
    return out


def connect_districts(ax, ay, bx, by, seed, tag, width_m=13.0,
                      block_every_m=52.0, skip_m=9000.0):
    """A built ROAD between two districts, not a gap between them.

    Eleven districts with open ground between them is eleven villages. The
    reference is one continuous metropolis, so the ground BETWEEN quarters has
    to be built too -- a paved road with frontage along it, which is how a real
    city's districts stop being separate.

    `skip_m` leaves the ends alone: both districts already have their own edges
    and gates, and running frontage into them would double up on geometry that
    is there.
    """
    out = []
    dx, dy = bx - ax, by - ay
    L = math.hypot(dx, dy)
    if L < skip_m * 2.2:
        return out
    ux, uy = dx / L, dy / L
    px, py = -uy, ux
    bearing = math.degrees(math.atan2(uy, ux))
    step = 1300.0
    n = int((L - skip_m * 2.0) / step)
    for i in range(n + 1):
        d = skip_m + step * i
        sx, sy = ax + ux * d, ay + uy * d
        out.append(A("terrace_platform", sx, sy, ROAD_Z, yaw=bearing,
                     sxyz=(1.0, width_m / 7.4, 0.30), mat="MI_V2_PathWarm",
                     label="%s_Rd%03d" % (tag, i)))
        for sgn in (1.0, -1.0):
            out.append(A("kerb_stone", sx + px * width_m * 50.0 * sgn,
                         sy + py * width_m * 50.0 * sgn, ROAD_Z + 26.0,
                         yaw=bearing, s=1.0, mat="MI_V2_Kerb",
                         label="%s_Kb%03d_%d" % (tag, i, int(sgn))))
        # frontage at intervals: enough to enclose the road, not so much that
        # a connector becomes a district in its own right
        if (step * i) % block_every_m * 0 == 0 and i % max(1, int(block_every_m / 13.0)) == 0:
            k = seed * 17 + i
            for sgn in (1.0, -1.0):
                hx = sx + px * (width_m * 50.0 + 900.0) * sgn
                hy = sy + py * (width_m * 50.0 + 900.0) * sgn
                out += kit_building(hx, hy, bearing + (90.0 if sgn > 0 else -90.0),
                                    k + int(sgn), "%s_B%03d_%d" % (tag, i, int(sgn)),
                                    storeys=1 + ((k + int(sgn)) % 2),
                                    tower=((k + i) % 4 == 0), scale=0.84)
        if i % 9 == 4:
            out.append(A("waymarker_lamp", sx + px * (width_m * 50.0 + 300.0),
                         sy + py * (width_m * 50.0 + 300.0), 0.0, yaw=bearing,
                         s=1.05, mat="MI_V2_GoldAged",
                         label="%s_Lamp%03d" % (tag, i)))
        if i % 17 == 8:
            out.append(A("gate_arch_gold", sx, sy, 0.0, yaw=bearing, s=1.2,
                         mat="MI_V2_GoldAged", label="%s_Arch%03d" % (tag, i)))
    return out


def urban_fill(cx, cy, half_x, half_y, seed, tag, bearing=0.0,
               street_m=14.0, block_m=34.0, roofs=None, storey_bias=0):
    """Convert a MEASURED empty rectangle into connected city.

    The first two districts were hand-authored, which is why the third, fourth
    and fifth holes were still holes: hand-authoring does not scale and the
    emptiness audit finds new ones faster than a person can lay streets. This
    takes a region straight off emptiness.py -- centre and extent -- and returns
    a block grid with streets between, so closing a hole is one call.

    A grid, not a scatter. The founder's complaint is that buildings "feel
    placed apart rather than continuous city": a scatter with a minimum
    distance always reads as objects on a lawn, because the gaps are the same
    size everywhere. Streets and blocks give the gaps a STRUCTURE -- wide where
    a street runs, nearly nothing where two blocks meet.
    """
    out = []
    b = math.radians(bearing)
    ux, uy = math.cos(b), math.sin(b)
    px, py = -uy, ux
    pitch = block_m + street_m                 # centre-to-centre, metres
    nx = max(1, int((half_x * 2.0 / 100.0) / pitch))
    ny = max(1, int((half_y * 2.0 / 100.0) / pitch))

    def at(a_m, c_m):
        return (cx + ux * a_m * 100.0 + px * c_m * 100.0,
                cy + uy * a_m * 100.0 + py * c_m * 100.0)

    # ---- the street grid, paved continuously -------------------------------
    # terrace_platform is 14.4 m along its local x by 7.4 m across. Spacing is
    # chosen so the pieces OVERLAP; this is the defect that made the southern
    # quarter read as slabs on grass and it is arithmetic, not judgement.
    span_a = nx * pitch
    span_c = ny * pitch
    step = 13.0
    for gi in range(ny + 1):
        c = -span_c * 0.5 + pitch * gi
        for t in range(int(span_a / step) + 1):
            a = -span_a * 0.5 + step * t
            sx, sy = at(a, c)
            out.append(A("terrace_platform", sx, sy, ROAD_Z, yaw=bearing,
                         sxyz=(1.0, street_m / 7.4, 0.30), mat="MI_V2_Cobble",
                         label="%s_StA%d_%03d" % (tag, gi, t)))
    for gj in range(nx + 1):
        a = -span_a * 0.5 + pitch * gj
        for t in range(int(span_c / step) + 1):
            c = -span_c * 0.5 + step * t
            sx, sy = at(a, c)
            out.append(A("terrace_platform", sx, sy, ROAD_Z, yaw=bearing + 90.0,
                         sxyz=(1.0, street_m / 7.4, 0.30), mat="MI_V2_PathStone",
                         label="%s_StC%d_%03d" % (tag, gj, t)))

    # ---- the blocks --------------------------------------------------------
    n = 0
    for gj in range(nx):
        for gi in range(ny):
            a0 = -span_a * 0.5 + pitch * (gj + 0.5)
            c0 = -span_c * 0.5 + pitch * (gi + 0.5)
            k = seed * 31 + gj * 7 + gi * 13
            # FOUR BUILDINGS PER BLOCK, one to each street frontage, with a
            # courtyard in the middle. A block that is one building is a
            # pavilion; a block that is four with a hole in it is a city.
            for e in range(4):
                eang = bearing + 90.0 * e
                ex, ey = at(a0 + math.cos(math.radians(90.0 * e)) * block_m * 0.32,
                            c0 + math.sin(math.radians(90.0 * e)) * block_m * 0.32)
                st = 1 + ((k + e) % 3) + storey_bias
                out += kit_building(ex, ey, eang, k + e, "%s_B%d_%d_%d" % (tag, gj, gi, e),
                                    storeys=max(1, st), tower=((k + e) % 3 == 0),
                                    scale=0.86 + 0.06 * ((k + e) % 4))
                n += 1
            # the courtyard floor and something in it
            qx, qy = at(a0, c0)
            # PAVED WIDER THAN THE COURTYARD. gap_v2: palette.green 0.192 vs
            # the reference's 0.040 -- 4.8 TIMES over, which is the founder's
            # "gardens richer than buildings" as a number. The block interiors
            # were lawn showing between four buildings; the courtyard floor now
            # covers the whole block footprint so what shows between buildings
            # is stone.
            out.append(A("terrace_platform", qx, qy, ROAD_Z, yaw=bearing,
                         sxyz=(block_m / 14.4, block_m / 7.4, 0.32),
                         mat="MI_V2_PlazaShade", label="%s_Q%d_%dFloor" % (tag, gj, gi)))
            pick = k % 4
            if pick == 0:
                out.append(A("fountain_basin", qx, qy, 0.0, yaw=bearing, s=0.85,
                             mat="MI_V2_IvoryStone", label="%s_Q%d_%dBasin" % (tag, gj, gi)))
            elif pick == 1:
                # MUSHROOM ARCHITECTURE, which the reference board has as a
                # landmark class: a giant cap with a building under it, in a
                # courtyard, rather than a mushroom field beside the city.
                out.append(A("mushroom_giant", qx, qy, 0.0, yaw=bearing, s=0.55,
                             mat="MI_V2_MushCream", label="%s_Q%d_%dMush" % (tag, gj, gi)))
                out.append(A("mushroom_giant_spots", qx, qy, 0.0, yaw=bearing, s=0.55,
                             mat="MI_V2_MushRed", label="%s_Q%d_%dMushSpot" % (tag, gj, gi)))
                out.append(A("arch_stone", qx, qy, 0.0, yaw=bearing + 40.0, s=0.36,
                             mat="MI_V2_IvoryStone", label="%s_Q%d_%dMushDoor" % (tag, gj, gi)))
            elif pick == 2:
                out.append(A("topiary_spiral", qx, qy, 0.0, yaw=0.0, s=1.1,
                             mat="MI_V2_LeafDark", label="%s_Q%d_%dTopiary" % (tag, gj, gi)))
                out.append(A("garden_bench", qx + 600.0, qy, 0.0, yaw=bearing + 90.0,
                             s=1.0, mat="MI_V2_IvoryStone",
                             label="%s_Q%d_%dBench" % (tag, gj, gi)))
            else:
                out.append(A("clock_ornate", qx, qy, 250.0, yaw=bearing, s=0.7,
                             mat="MI_V2_GoldAged", label="%s_Q%d_%dClock" % (tag, gj, gi)))
            # a bridge over the street between this block and the next, at
            # height -- "landmarks behind landmarks" needs things in front of
            # things, and an arch across a street is the cheapest of those
            if (k % 3) == 0 and gj < nx - 1:
                bxm, bym = at(a0 + (block_m + street_m) * 0.5, c0)
                out.append(A("castle_bridge", bxm, bym, 1150.0, yaw=bearing + 90.0,
                             s=street_m / 9.2, mat="MI_V2_IvoryStone",
                             label="%s_Br%d_%d" % (tag, gj, gi)))
    return out


SOUTH_CENTRE = (6736.0, -29819.0)
_SPIRE_AT = (0.0, 8200.0)


def _south_axis():
    """Unit vector from the quarter toward the great spire, and its yaw."""
    dx = _SPIRE_AT[0] - SOUTH_CENTRE[0]
    dy = _SPIRE_AT[1] - SOUTH_CENTRE[1]
    n = math.hypot(dx, dy)
    return (dx / n, dy / n), math.degrees(math.atan2(dy, dx))


_S_BODY_H = {"castle_tower": 1700.0, "castle_tower_square": 1700.0,
             "castle_tower_octagon": 1800.0, "castle_tower_slender": 2000.0}
_S_CAP_H = {"roof_ogee": 800.0, "roof_bell": 640.0, "roof_cone_steep": 560.0,
            "roof_flat_crenellated": 110.0, "roof_hip": 430.0}
#: The reference's roof hierarchy: pale stone below, pink / lilac / blue above.
_S_ROOFS = ("MI_V2_RoofPink", "MI_V2_RoofLilac", "MI_V2_RoofBlue",
            "MI_V2_RoofRose", "MI_V2_RoofNavy")


def _south_house(x, y, yaw, seed, tag, scale=1.0, tall=False):
    """A street house, now built from the kit rather than by hand.

    The hand-built version hung a lantern_swag on every bay. That mesh is
    32.6 m wide and 12.5 m tall -- a garland meant to span a street -- so
    twenty-four of them became the gold clutter and the mechanical rhythm the
    founder saw. The kit's facade uses facade_panel (4.4 m) with column_ornate
    pilasters (1.8 m) between, an arch at the middle bay and a cornice over the
    top, which is ornament at ornament scale.
    """
    out = kit_building(x, y, yaw, seed, tag,
                       storeys=2 if (seed % 3 == 0 or tall) else 1,
                       tower=True, scale=scale)
    # The arcade stays: it is the thing that gives the pavement a colonnade to
    # walk under, and it is 6.6 m wide, which is the right size for one.
    ax = x + math.cos(math.radians(yaw - 90.0)) * 640.0 * scale
    ay = y + math.sin(math.radians(yaw - 90.0)) * 640.0 * scale
    for k2 in (-1, 0, 1):
        ox = math.cos(math.radians(yaw)) * 620.0 * k2 * scale
        oy = math.sin(math.radians(yaw)) * 620.0 * k2 * scale
        out.append(A("castle_arcade", ax + ox, ay + oy, 0.0, yaw=yaw, s=scale,
                     mat="MI_V2_IvoryStone", label="%s_Arcade%d" % (tag, k2 + 1)))
    out.append(A("ivy_drape", x, y, 700.0 * scale, yaw=yaw + 40.0, s=scale * 0.9,
                 mat="MI_V2_LeafMid", label="%s_Ivy" % tag))
    return out


def _south_quarter():
    (ux, uy), yaw = _south_axis()
    px, py = -uy, ux                      # left of the street
    cx, cy = SOUTH_CENTRE
    out = []

    def at(along, across, z=0.0):
        return (cx + ux * along + px * across, cy + uy * along + py * across)

    # ---- THE STREET ITSELF ------------------------------------------------
    # Paved, kerbed, and long enough to be a street rather than a courtyard:
    # 170 m from the gate to the market.
    HALF = 8500.0
    seg = 1000.0
    n = int((HALF * 2.0) / seg)
    for i in range(n + 1):
        a = -HALF + seg * i
        sx, sy = at(a, 0.0)
        # MEASURED, AFTER LOOKING AT IT. terrace_platform is rx 720, ry 370 --
        # 14.4 m along its local x by 7.4 m across -- so (0.34, 0.62) made a
        # 4.9 x 4.6 m slab, dropped every 10 m, in a street meant to be 14 m
        # wide. The overview render showed exactly that: pale squares scattered
        # on open grass, no street. The scale was chosen without ever asking
        # the recipe how big the piece is.
        out.append(A("terrace_platform", sx, sy, ROAD_Z, yaw=yaw,
                     sxyz=(0.76, 1.95, 0.30), mat="MI_V2_Cobble",
                     label="South_Road%02d" % i))
        for s in (1.0, -1.0):
            kx, ky = at(a, 700.0 * s)
            out.append(A("kerb_stone", kx, ky, ROAD_Z + 26.0, yaw=yaw,
                         s=1.0, mat="MI_V2_Kerb",
                         label="South_Kerb%02d_%d" % (i, int(s))))
        # Street lamps and benches at walking intervals, alternating sides, so
        # the pavement has something at eye height every twenty metres.
        if i % 2 == 0:
            s = 1.0 if (i // 2) % 2 == 0 else -1.0
            lx, ly = at(a, 860.0 * s)
            out.append(A("waymarker_lamp", lx, ly, 0.0, yaw=yaw, s=1.15,
                         mat="MI_V2_GoldAged", label="South_Lamp%02d" % i))
        if i % 4 == 2:
            s = -1.0 if (i // 4) % 2 == 0 else 1.0
            bx, by = at(a, 960.0 * s)
            out.append(A("garden_bench", bx, by, 0.0, yaw=yaw + 90.0 * s,
                         s=1.0, mat="MI_V2_IvoryStone",
                         label="South_Bench%02d" % i))
            out.append(A("planter_box", bx + ux * 420.0, by + uy * 420.0, 0.0,
                         yaw=yaw, s=1.0, mat="MI_V2_PlazaCream",
                         label="South_Planter%02d" % i))
            out.append(A("flower_cluster", bx + ux * 420.0, by + uy * 420.0,
                         150.0, yaw=yaw, s=0.9, mat="MI_V2_PetalPink",
                         label="South_PlanterBloom%02d" % i))

    # ---- THE NORTH GATE, facing the city ---------------------------------
    gx, gy = at(HALF + 400.0, 0.0)
    for s in (1.0, -1.0):
        ppx, ppy = at(HALF + 400.0, 760.0 * s)
        out.append(A("gate_pier", ppx, ppy, 0.0, yaw=yaw, s=1.5,
                     mat="MI_V2_IvoryStone", label="South_GatePier%d" % int(s)))
        out.append(A("gate_finial_ball", ppx, ppy, 1560.0, yaw=yaw, s=1.5,
                     mat="MI_V2_RoofLilac", label="South_GateBall%d" % int(s)))
        out.append(A("topiary_cone_roses", *at(HALF + 1500.0, 1080.0 * s),
                     0.0, yaw=0.0, s=1.5, mat="MI_V2_LeafDark",
                     label="South_GateCone%d" % int(s)))
    out.append(A("gate_arch_gold", gx, gy, 0.0, yaw=yaw, s=1.5,
                 mat="MI_V2_Gold", label="South_GateArch"))
    out.append(A("waymarker", *at(HALF + 1500.0, 0.0), 0.0, yaw=yaw + 180.0,
                 s=1.2, mat="MI_V2_IvoryStone", label="South_GateWaymark"))

    # ---- THE BLOCKS ------------------------------------------------------
    # Four plots a side, fronting the street, set back far enough for the
    # arcade to stand in front of the facade.
    # A STREET WALL NEEDS TO BE A WALL. castle_hall is rx 630 -- 12.6 m wide --
    # and four plots a side over 170 m put 27 m of grass between neighbours, so
    # the render read as scattered buildings on a lawn rather than a street.
    # Ten a side at 16 m centres leaves about 3 m between masses, which the
    # garden walls below then close.
    plots = 10
    for side_i, s in enumerate((1.0, -1.0)):
        for i in range(plots):
            a = -HALF + 1400.0 + (16000.0 / plots) * i
            hx, hy = at(a, 2300.0 * s)
            # facing the street: the facade normal points across, toward a=0
            hyaw = yaw + (90.0 if s > 0 else -90.0)
            k = side_i * 7 + i * 3 + 1
            out += _south_house(hx, hy, hyaw, k, "South_%s%d" % ("L" if s > 0 else "R", i),
                                scale=1.0 + 0.18 * ((k % 3) - 1),
                                tall=(i == 1 and side_i == 0) or (i == 3 and side_i == 1))
            # A garden wall closing the gap between plots, so the street has a
            # continuous edge instead of grass running between buildings.
            wx, wy = at(a + 800.0, 1500.0 * s)
            out.append(A("garden_wall", wx, wy, 0.0, yaw=yaw, s=1.25,
                         mat="MI_V2_IvoryStone",
                         label="South_Wall%s%d" % ("L" if s > 0 else "R", i)))
            out.append(A("hedge_block", wx, wy + 120.0 * s, 0.0, yaw=yaw, s=1.0,
                         mat="MI_V2_LeafMid",
                         label="South_WallHedge%s%d" % ("L" if s > 0 else "R", i)))

    # ---- THE MARKET, closing the south end -------------------------------
    mx, my = at(-HALF - 1800.0, 0.0)
    out.append(A("terrace_platform", mx, my, ROAD_Z, yaw=yaw,
                 sxyz=(1.5, 1.5, 0.32), mat="MI_V2_PlazaCream",
                 label="South_MarketFloor"))
    out.append(A("fountain_grand", mx, my, 0.0, yaw=yaw + 22.0, s=1.25,
                 mat="MI_V2_IvoryStone", label="South_Fountain"))
    out.append(A("fountain_grand_water", mx, my, 0.0, yaw=yaw + 22.0, s=1.25,
                 mat="MI_V2_Water", label="South_FountainWater"))
    out.append(A("fountain_finial", mx, my, 1560.0 * 1.25, yaw=yaw, s=1.1,
                 mat="MI_V2_Bronze", label="South_FountainFinial"))
    for k in range(6):
        ang = math.radians(60.0 * k)
        bx = mx + math.cos(ang) * 2100.0
        by = my + math.sin(ang) * 2100.0
        out.append(A("column_ornate", bx, by, 0.0, yaw=yaw, s=1.2,
                     mat="MI_V2_IvoryStone", label="South_MarketCol%d" % k))
        # lantern_strange is 21.8 m tall. Six of them at 0.9 ringed the market
        # with twenty-metre lamps. A waymarker_lamp is a lamp.
        out.append(A("waymarker_lamp", bx, by, 0.0, yaw=yaw, s=1.15,
                     mat="MI_V2_GoldAged", label="South_MarketLamp%d" % k))
        out.append(A("garden_urn", bx + 260.0, by, 0.0, yaw=yaw, s=1.0,
                     mat="MI_V2_PlazaCream", label="South_MarketUrn%d" % k))
    out.append(A("balustrade", *at(-HALF - 3600.0, 0.0), 0.0, yaw=yaw + 90.0,
                 s=2.2, mat="MI_V2_IvoryStone", label="South_MarketRail"))

    # ---- THE CLOISTER COURT, east side -----------------------------------
    ccx, ccy = at(1200.0, -5200.0)
    out.append(A("cloister_square", ccx, ccy, 0.0, yaw=yaw, s=1.15,
                 mat="MI_V2_IvoryStone", label="South_Cloister"))
    out.append(A("terrace_platform", ccx, ccy, ROAD_Z, yaw=yaw,
                 sxyz=(1.15, 1.15, 0.32), mat="MI_V2_PlazaShade",
                 label="South_CloisterFloor"))
    for k4 in range(4):
        a4 = math.radians(yaw) + math.pi / 4.0 + math.pi * k4 / 2.0
        out.append(A("gate_finial_ball", ccx + math.cos(a4) * 1768.0 * 1.15,
                     ccy + math.sin(a4) * 1768.0 * 1.15, 2020.0 * 1.15,
                     yaw=yaw, s=1.9 * 1.15, mat="MI_V2_RoofBlue",
                     label="South_CloisterBall%d" % k4))
    out.append(A("topiary_ball", ccx, ccy, 0.0, yaw=0.0, s=1.3,
                 mat="MI_V2_LeafDark", label="South_CloisterTopiary"))

    # ---- STAIRS AND A BRIDGE where the ground steps ----------------------
    out.append(A("stairs_broad", *at(-HALF - 900.0, 0.0), ROAD_Z, yaw=yaw + 180.0,
                 s=1.4, mat="MI_V2_PlazaGrey", label="South_MarketSteps"))
    out.append(A("castle_bridge", *at(3400.0, 2300.0), 1000.0, yaw=yaw + 90.0,
                 s=1.1, mat="MI_V2_IvoryStone", label="South_Bridge"))

    # ---- THE WINGS -------------------------------------------------------
    # ONE STREET IS NOT A QUARTER. Measured after the first pass: the 17,712
    # m2 hole did not close, it SPLIT -- 8,160 m2 left at (15228,-26842) and
    # 6,512 at (-4490,-33023), one either side of the new street. So the
    # quarter grows sideways into both remnants rather than being declared
    # finished at 17% of the hole it was aimed at.
    #
    # Each wing is a parallel lane with its own blocks, offset far enough that
    # the two streets are separate places rather than one wide plaza, and
    # joined to the main street by a cross lane so the network connects.
    for wsign, wtag in ((1.0, "W"), (-1.0, "E")):
        wacross = 8600.0 * wsign
        for i in range(9):
            a = -6200.0 + 1600.0 * i
            sx, sy = at(a, wacross)
            out.append(A("terrace_platform", sx, sy, ROAD_Z, yaw=yaw,
                         sxyz=(1.20, 1.05, 0.30), mat="MI_V2_PathStone",
                         label="South_%sLane%02d" % (wtag, i)))
            if i % 3 == 1:
                out.append(A("waymarker_lamp", *at(a, wacross + 620.0 * wsign),
                             0.0, yaw=yaw, s=1.05, mat="MI_V2_GoldAged",
                             label="South_%sLaneLamp%02d" % (wtag, i)))
        # three plots facing the lane, backs to the main street
        for i in range(3):
            a = -5200.0 + 5200.0 * i
            hx, hy = at(a, wacross + 2100.0 * wsign)
            hyaw = yaw + (90.0 if wsign < 0 else -90.0)
            k = (11 if wsign > 0 else 19) + i * 5
            out += _south_house(hx, hy, hyaw, k,
                                "South_%s%d" % (wtag, i),
                                scale=0.92 + 0.16 * (k % 3),
                                tall=(i == 1))
            out.append(A("garden_wall", *at(a + 2600.0, wacross + 1250.0 * wsign),
                         0.0, yaw=yaw, s=1.15, mat="MI_V2_IvoryStone",
                         label="South_%sWall%d" % (wtag, i)))
        # the cross lane that joins this wing to the main street
        for j in range(6):
            cxs, cys = at(-6600.0, wacross * (j / 5.0))
            out.append(A("terrace_platform", cxs, cys, ROAD_Z, yaw=yaw + 90.0,
                         sxyz=(1.25, 1.00, 0.30), mat="MI_V2_PathStone",
                         label="South_%sCross%d" % (wtag, j)))
        out.append(A("arch_stone", *at(-6600.0, wacross * 0.5), 0.0,
                     yaw=yaw + 90.0, s=1.5, mat="MI_V2_PlazaCream",
                     label="South_%sCrossArch" % wtag))

    # ---- DEPTH, NOT A RIBBON ---------------------------------------------
    # The founder's rule: a player must be able to turn left, then left again,
    # and still be inside authored Wonderland. One street with houses along it
    # fails that on the first turn -- behind the frontage there was grass.
    #
    # So: three cross streets cutting the block, courtyards BEHIND the houses
    # with their own rear elevations, alleys between them, and a secondary
    # destination that is not the market, so the quarter has two reasons to
    # walk it.
    for ci, along_c in enumerate((-5000.0, 900.0, 6200.0)):
        for j in range(-6, 7):
            ccx, ccy = at(along_c, j * 1100.0)
            out.append(A("terrace_platform", ccx, ccy, ROAD_Z, yaw=yaw + 90.0,
                         sxyz=(0.82, 1.35, 0.30), mat="MI_V2_PathStone",
                         label="South_X%d_%02d" % (ci, j + 6)))
        # blocks facing the cross street, on both sides, beyond the main row
        for j in (-5, -3, 3, 5):
            hx, hy = at(along_c + 1500.0 * (1 if j > 0 else -1), j * 1100.0)
            k = ci * 11 + abs(j) * 3 + 5
            out += kit_building(hx, hy, yaw + (0.0 if j > 0 else 180.0), k,
                                "South_X%d_B%d" % (ci, j + 6),
                                storeys=1 + (k % 2), tower=(k % 2 == 0),
                                scale=0.92)
        out.append(A("arch_stone", *at(along_c, 0.0), 0.0, yaw=yaw + 90.0,
                     s=0.75, mat="MI_V2_PlazaCream",
                     label="South_X%dArch" % ci))

    # COURTYARDS behind the frontage: paved, edged, with a rear elevation on
    # three sides. This is the "turn left twice" test made physical.
    for qi, (qa, qc) in enumerate(((-3600.0, 4600.0), (2600.0, -4600.0),
                                   (-7400.0, -4400.0))):
        qx, qy = at(qa, qc)
        out.append(A("terrace_platform", qx, qy, ROAD_Z, yaw=yaw,
                     sxyz=(1.5, 1.5, 0.32), mat="MI_V2_PlazaShade",
                     label="South_Court%dFloor" % qi))
        for e in range(3):
            eang = yaw + 90.0 * e
            ex = qx + math.cos(math.radians(eang)) * 1500.0
            ey = qy + math.sin(math.radians(eang)) * 1500.0
            out += kit_building(ex, ey, eang + 180.0, qi * 7 + e + 2,
                                "South_Court%d_E%d" % (qi, e),
                                storeys=1, tower=(e == 1), scale=0.8)
        out.append(A("fountain_basin", qx, qy, 0.0, yaw=yaw, s=0.9,
                     mat="MI_V2_IvoryStone", label="South_Court%dBasin" % qi))
        out.append(A("topiary_cone_roses", qx + 900.0, qy + 900.0, 0.0,
                     yaw=0.0, s=1.2, mat="MI_V2_LeafDark",
                     label="South_Court%dTopiary" % qi))
        out.append(A("garden_bench", qx - 900.0, qy, 0.0, yaw=yaw + 90.0,
                     s=1.0, mat="MI_V2_IvoryStone",
                     label="South_Court%dBench" % qi))

    # THE SECOND DESTINATION. A clock hall off the main street, so the quarter
    # is not just "walk to the market": the reference board has clocks and
    # mechanisms as a whole object language, and this is where the south gets
    # one.
    hx, hy = at(3000.0, 5400.0)
    out += kit_building(hx, hy, yaw + 90.0, 4, "South_ClockHall",
                        storeys=2, tower=True, scale=1.5)
    out.append(A("clock_ornate", hx, hy, 2050.0, yaw=yaw + 90.0, s=1.3,
                 mat="MI_V2_GoldAged", label="South_ClockFace"))
    out.append(A("stairs_broad", *at(2600.0, 3900.0), ROAD_Z, yaw=yaw + 90.0,
                 s=1.4, mat="MI_V2_PlazaGrey", label="South_ClockSteps"))
    out.append(A("terrace_platform", *at(3000.0, 3900.0), ROAD_Z, yaw=yaw,
                 sxyz=(1.1, 0.9, 0.32), mat="MI_V2_PlazaCream",
                 label="South_ClockForecourt"))
    return out


SOUTH_QUARTER = _band("V2_South", _south_quarter())


def _south_way():
    """The quarter's own waypoints, for the tools that ask whether a walker can
    get here. Derived from the same axis the street is laid on, so they cannot
    go stale the way a hand-written list does -- walkable.py has a comment about
    exactly that failure, where it reported a turn unreachable that the world no
    longer had."""
    (ux, uy), _ = _south_axis()
    px, py = -uy, ux
    cx, cy = SOUTH_CENTRE
    def at(a, c):
        return (cx + ux * a + px * c, cy + uy * a + py * c)
    return [at(8900.0, 0.0),      # the quarter's gate, from the city side
            at(4000.0, 0.0),      # upper street
            at(0.0, 0.0),         # the crossing
            at(-4000.0, 0.0),     # lower street
            at(-10300.0, 0.0),    # the market
            at(-2000.0, 8600.0),  # west lane
            at(-2000.0, -8600.0)] # east lane


SOUTH_WAY = _south_way()


# ---------------------------------------------------------------------------
# THE SOUTHWEST QUARTER -- the civic tower district, and deliberately NOT the
# southern one again.
#
# emptiness.py after the southern quarter: the largest remaining region is
# 8,128 m2 centred at (-20606, -24316), x -290..-150 m, y -310..-178 m. The
# founder asked for a distinct identity rather than a second copy, so where the
# south is a low residential street with a market at one end, this is VERTICAL
# and CIVIC: a hard-edged plaza with a colonnade all the way round it, a tight
# cluster of towers taller than anything in the south, bridges between them at
# height, and streets narrow enough that the towers close over the walker.
#
# The skyline argument is the same one the towers answer in the south and this
# is where it is pressed: 479 pieces stand 30-50 m and 28 stand 80-120 m. The
# south added rungs at 86 m. These go to about 120, which is the band directly
# under the great spire's 194.
SW_CENTRE = (-20606.0, -24316.0)
#: Cooler than the south on purpose -- blue and lilac lead, rose is the accent.
_SW_ROOFS = ("MI_V2_RoofBlue", "MI_V2_RoofLilac", "MI_V2_RoofNavy",
             "MI_V2_RoofBlue", "MI_V2_RoofRose")


def _sw_block(x, y, yaw, seed, tag, scale=1.0):
    """A civic block: taller than the south, no front garden, three storeys
    where the seed allows. Same kit, different massing -- which is what makes
    two districts read as one city rather than two generators."""
    out = kit_building(x, y, yaw, seed, tag,
                       storeys=2 + (seed % 2), tower=True, scale=scale)
    # bays on the BACK too: a narrow street is walled by the backs of things.
    out += kit_facade(x, y, yaw + 180.0, 12.6 * scale, seed + 3,
                      "%s_Rear" % tag)
    return out


def _southwest_quarter():
    cx, cy = SW_CENTRE
    out = []
    R = 3400.0                       # the civic plaza's radius, 34 m

    # ---- THE PLAZA, AND IT HAS AN EDGE --------------------------------
    # The founder's note was "no giant dead plazas". A plaza is dead when it is
    # a floor with nothing standing at its rim, so this one is a colonnade the
    # whole way round with an arcade on two sides behind it.
    out.append(A("terrace_platform", cx, cy, ROAD_Z, yaw=0.0,
                 sxyz=(2.3, 2.3, 0.34), mat="MI_V2_PlazaShade",
                 label="SW_PlazaFloor"))
    for k in range(16):
        a = math.radians(22.5 * k)
        px_, py_ = cx + math.cos(a) * R, cy + math.sin(a) * R
        out.append(A("column_ornate", px_, py_, 0.0, yaw=math.degrees(a),
                     s=1.35, mat="MI_V2_IvoryStone", label="SW_Col%02d" % k))
        # was lantern_swag at 0.95 -- a 31 m garland on every column of a
        # 34 m plaza, sixteen of them. The swag spans the plaza ONCE now,
        # below; the columns carry a finial instead.
        out.append(A("gate_finial_ball", px_, py_, 950.0, yaw=math.degrees(a),
                     s=1.1, mat="MI_V2_GoldAged", label="SW_ColFinial%02d" % k))
        if k % 4 == 0:
            out.append(A("castle_arcade", cx + math.cos(a) * (R + 900.0),
                         cy + math.sin(a) * (R + 900.0), 0.0,
                         yaw=math.degrees(a) + 90.0, s=1.4,
                         mat="MI_V2_IvoryStone", label="SW_Arcade%02d" % k))
        if k % 2 == 1:
            out.append(A("balustrade", cx + math.cos(a) * (R - 250.0),
                         cy + math.sin(a) * (R - 250.0), 0.0,
                         yaw=math.degrees(a) + 90.0, s=1.25,
                         mat="MI_V2_IvoryStone", label="SW_Rail%02d" % k))
    # the civic monument at the centre, and it is not a fountain again
    out.append(A("stone_ring_base", cx, cy, 0.0, yaw=0.0, s=1.6,
                 mat="MI_V2_PlazaCream", label="SW_MonumentBase"))
    # orrery_gold is 15.2 x 16.4 x 26.4 m -- a LANDMARK. At s=1.5 it stood
    # forty metres over a civic plaza and camera 42 ended up inside it. Kept,
    # because a mechanism at the heart of the quarter is on the reference
    # board, but at a size a plaza can hold.
    out.append(A("orrery_gold", cx, cy, 380.0, yaw=0.0, s=0.42,
                 mat="MI_V2_Gold", label="SW_Orrery"))
    out.append(A("pedestal_finial", cx, cy, 1500.0, yaw=0.0, s=1.2,
                 mat="MI_V2_Bronze", label="SW_MonumentFinial"))
    # THE SWAG, USED AS A SWAG. 32.6 m wide, so it spans the 34 m plaza once,
    # overhead, which is what the mesh was modelled for.
    for sw in range(2):
        out.append(A("lantern_swag", cx, cy, 1450.0, yaw=90.0 * sw, s=1.0,
                     mat="MI_V2_GoldAged", label="SW_PlazaSwag%d" % sw))
        out.append(A("lantern_swag_glass", cx, cy, 1450.0, yaw=90.0 * sw, s=1.0,
                     mat="MI_V2_GlassAmber", label="SW_PlazaSwagGlass%d" % sw))

    # ---- THE TOWER CLUSTER, tight and tall ----------------------------
    # Five towers inside a 45 m circle. The south's rungs reached 86 m; these
    # reach about 120, which is the band under the great spire.
    # SCALED DOWN AFTER MEASURING, not before. At 4.2-5.4 the tallest topped out
    # near 153 m and skyline.py's dominance -- the great spire against the next
    # distinct site -- fell from 1.45x to 1.27x. The spire is the city's
    # orientation landmark and a rival two thirds of the way to it is not a
    # rung, it is competition. These reach roughly 118 m: the top of the 80-120
    # band, under the 134 m second site that already existed, so the ladder
    # fills and the spire keeps its lead.
    towers = ((-2600.0, 4200.0, 3.6), (1400.0, 4900.0, 4.2),
              (4300.0, 3100.0, 3.3), (-4600.0, 1800.0, 3.0),
              (300.0, 6600.0, 3.8))
    tops = []
    for i, (ox, oy, ts) in enumerate(towers):
        tx, ty = cx + ox, cy + oy
        body = ("castle_tower_slender", "castle_tower_octagon",
                "castle_tower")[i % 3]
        out.append(A(body, tx, ty, 0.0, yaw=17.0 * i, s=ts,
                     mat="MI_V2_IvoryStone", label="SW_Tower%d" % i))
        zt = _S_BODY_H[body] * ts
        cap = ("roof_cone_steep", "roof_ogee")[i % 2]
        out.append(A(cap, tx, ty, zt, yaw=17.0 * i, s=ts,
                     mat=_SW_ROOFS[i % 5], label="SW_Tower%dRoof" % i))
        out.append(A("finial_spire", tx, ty, zt + _S_CAP_H[cap] * ts,
                     s=ts * 0.8, mat="MI_V2_Gold", label="SW_Tower%dFinial" % i))
        out.append(A("balcony_ring", tx, ty, zt * 0.55, s=ts * 0.85,
                     mat="MI_V2_IvoryStone", label="SW_Tower%dBalcony" % i))
        out.append(A("ivy_drape", tx, ty, zt * 0.30, yaw=40.0 * i, s=ts * 0.5,
                     mat="MI_V2_LeafMid", label="SW_Tower%dIvy" % i))
        tops.append((tx, ty, zt))
    # BRIDGES BETWEEN THEM, at height. This is the thing the south does not
    # have and the reference does: a city you read as connected in the air.
    for i in range(len(tops) - 1):
        ax, ay, az = tops[i]; bx, by, bz = tops[i + 1]
        mx, my = (ax + bx) * 0.5, (ay + by) * 0.5
        br = math.degrees(math.atan2(by - ay, bx - ax))
        out.append(A("castle_bridge", mx, my, min(az, bz) * 0.62, yaw=br,
                     s=1.5, mat="MI_V2_IvoryStone", label="SW_Bridge%d" % i))

    # ---- THREE NARROW STREETS off the plaza ---------------------------
    for si, bearing in enumerate((205.0, 285.0, 145.0)):
        b = math.radians(bearing)
        for j in range(7):
            d = R + 1200.0 + 1500.0 * j
            sx, sy = cx + math.cos(b) * d, cy + math.sin(b) * d
            # 3.7 x 3.4 m every 15 m was the south's mistake twice over. A
            # narrow street is still a PAVED street: 9 m across, continuous.
            out.append(A("terrace_platform", sx, sy, ROAD_Z, yaw=bearing,
                         sxyz=(1.10, 1.25, 0.30), mat="MI_V2_Cobble",
                         label="SW_St%d_%02d" % (si, j)))
            for s in (1.0, -1.0):
                # blocks TIGHT to the street: 9 m apart, so the towers close over it
                if True:
                    bx = sx + math.cos(b + math.pi / 2) * 900.0 * s
                    by = sy + math.sin(b + math.pi / 2) * 900.0 * s
                    out += _sw_block(bx, by, bearing + (90.0 if s > 0 else -90.0),
                                     si * 5 + j + int(s) + 2,
                                     "SW_S%d_%02d_%d" % (si, j, int(s)),
                                     scale=0.86 + 0.10 * ((j + si) % 3))
                if j % 2 == 1 and s > 0:
                    out.append(A("waymarker_lamp", sx + math.cos(b + math.pi / 2) * 620.0,
                                 sy + math.sin(b + math.pi / 2) * 620.0, 0.0,
                                 yaw=bearing, s=1.05, mat="MI_V2_GoldAged",
                                 label="SW_St%dLamp%02d" % (si, j)))
            if j == 3:
                # a terrace step partway along, so the street is not a flat run
                out.append(A("retaining_wall", sx, sy, ROAD_Z, yaw=bearing + 90.0,
                             s=1.3, mat="MI_V2_PlazaGrey",
                             label="SW_St%dTerrace" % si))
                out.append(A("stairs_broad", sx + math.cos(b) * 700.0,
                             sy + math.sin(b) * 700.0, ROAD_Z, yaw=bearing + 180.0,
                             s=1.2, mat="MI_V2_PlazaGrey",
                             label="SW_St%dSteps" % si))
        # a gate closing each street where it leaves the quarter
        gd = R + 1200.0 + 1500.0 * 7
        gx, gy = cx + math.cos(b) * gd, cy + math.sin(b) * gd
        for s in (1.0, -1.0):
            out.append(A("gate_pier", gx + math.cos(b + math.pi / 2) * 780.0 * s,
                         gy + math.sin(b + math.pi / 2) * 780.0 * s, 0.0,
                         yaw=bearing, s=1.3, mat="MI_V2_IvoryStone",
                         label="SW_St%dPier%d" % (si, int(s))))
        out.append(A("gate_arch_gold", gx, gy, 0.0, yaw=bearing, s=1.3,
                     mat="MI_V2_GoldAged", label="SW_St%dGate" % si))

    # ---- THE ENCHANTED ACCENT, integrated into stone ------------------
    # Not a mushroom field beside the city: mushrooms standing in the city's own
    # courtyards, which is what "integrated" has to mean if it is not foliage
    # spam with extra steps.
    for i, (ox, oy, s) in enumerate(((-5200.0, -3800.0, 1.5),
                                     (5600.0, -2600.0, 1.2),
                                     (-1200.0, -6200.0, 1.35))):
        mx, my = cx + ox, cy + oy
        out.append(A("terrace_platform", mx, my, ROAD_Z, yaw=0.0,
                     sxyz=(0.7, 0.7, 0.32), mat="MI_V2_PlazaCream",
                     label="SW_Court%dFloor" % i))
        out.append(A("mushroom_medium", mx, my, 0.0, yaw=30.0 * i, s=s,
                     mat=("MI_V2_MushPurple", "MI_V2_MushCream",
                          "MI_V2_MushTerracotta")[i % 3],
                     label="SW_Court%dMush" % i))
        out.append(A("garden_bench", mx + 700.0, my, 0.0, yaw=90.0, s=1.0,
                     mat="MI_V2_IvoryStone", label="SW_Court%dBench" % i))
        out.append(A("planter_box", mx - 700.0, my, 0.0, yaw=0.0, s=1.0,
                     mat="MI_V2_PlazaCream", label="SW_Court%dPlanter" % i))
        out.append(A("rose_bush", mx - 700.0, my, 160.0, yaw=0.0, s=0.9,
                     mat="MI_V2_RosePink", label="SW_Court%dRose" % i))
    return out


SOUTHWEST_QUARTER = _band("V2_Southwest", _southwest_quarter())


# ---------------------------------------------------------------------------
# THE MEASURED HOLES, closed by the generator rather than by hand.
#
# Every region below came off emptiness.py with its centre and extent; none was
# chosen because a camera pointed at it. The castle sightline at (-10923,
# 30061) is NOT here and never will be -- it is deliberate negative space, and
# the audit has flagged it as such since before these districts existed.
#
# bearings differ per region so the grids do not all run true north, which is
# what would turn five districts into one visible tiling.
FILL_NORTHEAST = _band("V2_FillNE", urban_fill(
    14730.0, 29419.0, 7800.0, 6000.0, 3, "FillNE", bearing=18.0))
FILL_SOUTHFLANK_W = _band("V2_FillSW2", urban_fill(
    -4960.0, -32205.0, 8400.0, 4400.0, 5, "FillSFW", bearing=-9.0))
FILL_SOUTHFLANK_E = _band("V2_FillSE", urban_fill(
    15707.0, -27323.0, 7200.0, 6600.0, 7, "FillSFE", bearing=6.0))
FILL_EAST = _band("V2_FillE", urban_fill(
    32488.0, -4129.0, 4000.0, 6800.0, 11, "FillE", bearing=-24.0))
FILL_WEST = _band("V2_FillW", urban_fill(
    -32067.0, -9835.0, 3600.0, 5800.0, 13, "FillW", bearing=31.0))

# The next tier of holes, all under 4,000 m2 and all off the same audit. The
# goal is the largest accidental hole under 2,000 m2, then under 1,000; these
# are the ones standing between here and that.
FILL_WESTEDGE = _band("V2_FillWE", urban_fill(
    -32484.0, 8667.0, 4200.0, 6000.0, 17, "FillWE", bearing=-14.0))
FILL_EASTEDGE = _band("V2_FillEE", urban_fill(
    30560.0, 10004.0, 3800.0, 3400.0, 19, "FillEE", bearing=22.0))
FILL_SOUTHEAST2 = _band("V2_FillSE2", urban_fill(
    22804.0, -15764.0, 3000.0, 3200.0, 23, "FillSE2", bearing=-33.0))
FILL_EASTLOW = _band("V2_FillEL", urban_fill(
    31762.0, -1335.0, 4000.0, 3400.0, 29, "FillEL", bearing=8.0))


# ---------------------------------------------------------------------------
# THE ROADS BETWEEN. Eleven districts with open ground between them is eleven
# villages; the reference is one continuous metropolis. Each of these is a
# paved road with frontage along it, joining quarters that already exist.
CONNECTORS = _band("V2_Connect",
    connect_districts(0.0, 0.0, 6736.0, -29819.0, 2, "CxCityS")
    + connect_districts(6736.0, -29819.0, -20606.0, -24316.0, 3, "CxSSW")
    + connect_districts(0.0, 0.0, -20606.0, -24316.0, 5, "CxCitySW")
    + connect_districts(0.0, 0.0, 14730.0, 29419.0, 7, "CxCityNE")
    + connect_districts(6736.0, -29819.0, 15707.0, -27323.0, 11, "CxSSFE")
    + connect_districts(-20606.0, -24316.0, -32067.0, -9835.0, 13, "CxSWW")
    + connect_districts(0.0, 0.0, 32488.0, -4129.0, 17, "CxCityE")
    + connect_districts(0.0, 0.0, -32484.0, 8667.0, 19, "CxCityWE"))

#: THE HORIZON. Four rings from 420 m to 900 m, massing only -- the 200 m+
#: band of the founder's detail policy. The castle sightline is carved out of
#: every ring, because the one deliberate piece of negative space in Wonderland
#: does not get filled from behind either.
SKYLINE_RING = _band("V2_SkyRing", skyline_ring(420.0, 900.0, 4, 26, 3, "Sky"))


BUILD_BANDS = [FOREGROUND, COURTYARD, GARDEN, PALACE, FLANK_GROUND, FLANKS,
               REARWORLD, CAM_FOREGROUNDS, GROUND_QUILT, OUTER_WORLD, PLAZA_ORNAMENT,
               PROCESSIONAL_BORDER, HORIZON, APPROACH_SIDES, PLAZA_WALL_DRESS,
               SIGNATURE, LANDMARKS, DEPTH, COURT_DRESS, WAYSIDE,
               SOUTH_QUARTER, SOUTHWEST_QUARTER,
               FILL_NORTHEAST, FILL_SOUTHFLANK_W, FILL_SOUTHFLANK_E,
               FILL_EAST, FILL_WEST, FILL_WESTEDGE, FILL_EASTEDGE,
               FILL_SOUTHEAST2, FILL_EASTLOW, CONNECTORS, SKYLINE_RING]

# ---------------------------------------------------------------------------
# NOTHING IS BUILT ON A VIEWPOINT (2026-09-03)
#
# The first render after the Studio came back showed GreatSpireCam22 looking at
# the inside of a wall: `DPTowerRise_Cloister`, a PASS 29 depth piece, stands
# 10.6 m from that camera and its footprint is 14.0 m, so the lens is inside
# the cloister. Two more cameras were in the same state -- FlankRightCam09
# 0.19 m from the centre of an edge hedge, EastReachCam20 inside a colossal
# bloom's stem.
#
# EVERY PLACER INVOLVED WAS OBEYING ITS OWN RULES. The depth search guards the
# district it belongs to and the share it takes of a hero frame; the quarter
# ring places a broken hedge circle with deliberate gaps; the landmark dressing
# stands stems around a bloom. None of them had any reason to know a camera was
# there, and PASS 28's first siting rule -- STANDPOINT CLEAR, before sightline,
# before approach -- was written for the camera author, not for the placers.
#
# So the rule is applied ONCE, here, over the single list the builder walks,
# rather than in each generator: that is the same correction PASS 09 made when
# `build_v2` walked a hand-written band list and `layout_v2.ALL` was another,
# and 305 placements passed the gate while four reached the world.
#
# It DROPS rather than nudges, which is what these placers already do when a
# clearance test fails, and it is deliberately height-blind: a footprint that
# contains a viewpoint is a piece that should not be there whether or not it
# happens to clear the lens today, and cameras move. `verify_v2_layout`'s gate
# is the height-aware one, because a FAILURE has to be true -- the plan-only
# version of it reported SkylineRiseCam21 inside a 3.6 m hedge from 18 m up.
_CAM_KEEPOUT_SURFACES = ("terrace_platform", "garden_lawn", "stone_ring_base",
                         "path_steps", "side_steps", "ground_flowers",
                         "ground_blooms", "tea_saucer", "mushroom_small",
                         "key_ornate")
CAM_KEEPOUT_DROPPED = []


def _drop_pieces_standing_on_cameras(bands):
    try:
        import v2_config as _C
        pts = [c["location"] for c in getattr(_C, "HERO_CAMS", ())]
    except Exception:                          # the layout must import alone
        return bands
    if not pts:
        return bands
    for band in bands:
        keep = []
        for it in band:
            a = it["asset"]
            if a in _CAM_KEEPOUT_SURFACES or a not in FOOT:
                keep.append(it)
                continue
            sc = it["scale"]
            sx, sy = ((abs(sc[0]), abs(sc[1])) if isinstance(sc, (list, tuple))
                      else (abs(sc), abs(sc)))
            hx, hy = FOOT[a]
            hx *= sx
            hy *= sy
            yaw = math.radians(it["rot"][1])
            co, si = math.cos(yaw), math.sin(yaw)
            hit = None
            for (cx, cy, _cz) in pts:
                dx, dy = cx - it["pos"][0], cy - it["pos"][1]
                lx, ly = dx * co + dy * si, -dx * si + dy * co
                # the inscribed ELLIPSE, for the reason verify_v2_layout's
                # matching check records: FOOT is a half-extent pair, not a
                # shape, and its corners reach 1.41x its axes -- which claimed
                # a camera 2.9 m clear of a round stem, standing behind it.
                if (lx / hx) ** 2 + (ly / hy) ** 2 <= 1.0:
                    hit = (cx, cy)
                    break
            if hit is None:
                keep.append(it)
            else:
                CAM_KEEPOUT_DROPPED.append("%s (%s)" % (it["label"], a))
        band[:] = keep
    return bands


_drop_pieces_standing_on_cameras(BUILD_BANDS)

# ---------------------------------------------------------------------------
# TWO TREES IN ONE PLACE TRAPPED THE DOG (2026-09-03)
#
# The first real-GPU traversal of this world since the Studio came back wedged
# the canonical Relay Dog at leg 123 of 262 and it NEVER GOT OUT: seventeen
# consecutive legs failed from the identical coordinates, each after up to 114
# seconds, so the route could not finish. The ledger's "262 of 262 legs, 3,232
# m, 100%, ZERO stalls" was measured on an older world and carried forward
# unverified -- and both offending trees were already present at 356fe89, so
# this is NOT a regression from the offline work. It has been a trap for some
# time and only a real traversal could find it.
#
# WHAT IT WAS. `ClockQuarterCam13_FgTrunk12`, a camera-foreground tree placed
# for ClockQuarterCam13's framing, stands 68 uu from `LMClockQuarter_SpurTree4_1_Trunk`,
# a landmark spur tree. Their trunk radii are 65 and 121 uu, so the two trees
# INTERPENETRATE by 1.19 m; the Dog's 72 uu capsule rode up the fused flare to
# z = 107 and could not step off in any direction.
#
# THE EXISTING FILTER COULD NOT SEE IT. `_declutter` removes scatter that has
# grown through a LANDMARK -- its guard list is `_PROTECT`, which is towers,
# domes, mushrooms and spires. A tree is not protected, so two trees growing
# through each other is invisible to it. A rule applied to one collection and
# not its sibling, which is the richest defect vein in this project.
#
# WHY THIS AND NOT THE 679. Measured across the whole world there are 679 pairs
# of solid pieces whose gap is narrower than the Dog can pass. Nearly all are
# harmless -- a rose bush against a hedge, a teacup beside its teapot, pilasters
# in a wall run -- things a walker goes AROUND and reads as one mass. Dropping
# them would gut the world for no gain and is exactly the broad speculative
# change this pass was told not to make. The dangerous class is much smaller and
# has a different signature: two THIN TRUNKS in open ground, which read as
# passable and are not, and which are also simply wrong to look at. There are 32
# such pairs and this drops the junior of each.
#
# Junior = the smaller trunk, because the larger one is the more considered
# piece of the two (a landmark's spur tree over a camera's foreground dressing),
# with the label as a deterministic tie-break. The trunk's CANOPY goes with it:
# anything sharing its exact position, or a floating crown is left behind, which
# is a defect shape this project has already paid for.
_TRUNKS = ("tree_mature_trunk", "tree_slender_trunk", "tree_clock_trunk")
FUSED_TREES_DROPPED = []


def _drop_trees_growing_through_each_other(bands):
    idx = []
    for band in bands:
        for it in band:
            if it["asset"] not in _TRUNKS or it["asset"] not in FOOT:
                continue
            sc = it["scale"]
            sx = abs(sc[0]) if isinstance(sc, (list, tuple)) else abs(sc)
            hx, hy = FOOT[it["asset"]]
            idx.append((it["pos"][0], it["pos"][1], min(hx, hy) * sx, it))
    cell = 600.0
    grid = {}
    for n, (x, y, r, it) in enumerate(idx):
        grid.setdefault((int(x // cell), int(y // cell)), []).append(n)
    doomed = set()
    for n, (x, y, r, it) in enumerate(idx):
        ci, cj = int(x // cell), int(y // cell)
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for m in grid.get((ci + di, cj + dj), ()):
                    if m <= n:
                        continue
                    x2, y2, r2, it2 = idx[m]
                    if math.hypot(x2 - x, y2 - y) > r + r2:
                        continue
                    # the smaller trunk yields; equal radii break on the label
                    if (r, str(it["label"])) <= (r2, str(it2["label"])):
                        doomed.add(id(it))
                    else:
                        doomed.add(id(it2))
    if not doomed:
        return bands
    #: the doomed trunks' own positions, so their crowns leave with them
    spots = set()
    for (x, y, r, it) in idx:
        if id(it) in doomed:
            spots.add((round(x, 1), round(y, 1)))
            FUSED_TREES_DROPPED.append("%s (%s)" % (it["label"], it["asset"]))
    for band in bands:
        band[:] = [it for it in band
                   if id(it) not in doomed
                   and (round(it["pos"][0], 1), round(it["pos"][1], 1)) not in spots]
    return bands


_drop_trees_growing_through_each_other(BUILD_BANDS)

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
