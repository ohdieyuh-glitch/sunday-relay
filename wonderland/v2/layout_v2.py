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
    A("ground_flowers", 1120, -450 + 220 * i, 85, yaw=23 * i, s=1.0, mat=("MI_V2_PetalPink", "MI_V2_PetalBlue", "MI_V2_PetalViolet")[i % 3], label="SideBed_L_Ground%d" % i) for i in range(7)
] + [
    A("ground_flowers", -1120, -400 + 220 * i, 85, yaw=31 * i, s=1.0, mat=("MI_V2_PetalViolet", "MI_V2_PetalPink", "MI_V2_RosePink")[i % 3], label="SideBed_R_Ground%d" % i) for i in range(7)
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
SKY = _band("V2_Skyline", [
    A("sky_dome", 0, 0, -200, yaw=0, s=1.0, mat="MI_V2_SkyPano", label="Sky_MarblePanorama"),
])
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


def _parterre(sgn, cx, cy, seed, tag):
    """A formal quadrant garden: four hedged beds around a centrepiece, with
    the walks between them left open. This is the unit the reference's royal
    gardens are made of -- geometry first, then colour inside it."""
    out = []
    q = 620.0                      # quadrant side
    w = 150.0                      # half-width of the cross walk
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
                         yaw=yaw, sxyz=(1.75, 0.90, 0.85),
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
        out.append(A("garden_lawn", bx, by, 3.0, sxyz=(0.1033, 0.0862, 0.5),
                     mat="MI_V2_Soil", label="%s_Bed%d_Soil" % (tag, i)))
        # what fills it
        out.append(A("rose_bush", bx, by, 60, yaw=40 * i, s=0.85,
                     mat="MI_V2_LeafMid", label="%s_Bed%d_Rose" % (tag, i)))
        # SEVEN, not three. FlankLeftCam08's first render showed a bed of
        # three blooms reading as three pink dots sitting on grass -- the
        # reference's beds are FULL, the planting is the bed. Filled to the
        # edges with a mix of clusters, blossom and lavender so the bed has
        # colour AND texture rather than four copies of one puff.
        for k in range(7):
            a = _rnd(i, k, seed) * 6.283
            r = 90.0 + 145.0 * _rnd(i, k, seed + 20)
            kind = ("flower_cluster", "blossom_cluster", "lavender_heads")[k % 3]
            out.append(A(kind,
                         bx + math.cos(a) * r, by + math.sin(a) * r, 40,
                         yaw=_rnd(i, k, seed + 1) * 360.0, s=0.5 + 0.24 * _rnd(i, k, seed + 2),
                         mat=petals[(i + k) % 4] if kind != "lavender_heads" else "MI_V2_Lavender",
                         label="%s_Bed%d_Flower%d" % (tag, i, k)))
        # a ball of clipped box at the bed's inner corner: the rhythm that
        # tells the eye the four beds are one composition
        out.append(A("topiary_ball", bx - sgn * qx * q * 0.42, by - qy * q * 0.42, 0,
                     s=0.62, mat="MI_V2_LeafDark", label="%s_Bed%d_Ball" % (tag, i)))
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
                     sxyz=(1.07, 0.405, 0.35), mat="MI_V2_PlazaWarm",
                     label="%s_Walk%d" % (tag, k)))
    # the centrepiece the walks run to
    out += [
        A("pedestal_finial", cx, cy, 0, s=1.0, mat="MI_V2_IvoryStone", label="%s_Centre_Plinth" % tag),
        A("garden_urn", cx, cy, 124, s=0.6, mat="MI_V2_Ceramic", label="%s_Centre_Urn" % tag),
        A("flower_cluster", cx, cy, 210, s=0.5, mat="MI_V2_PetalPink", label="%s_Centre_Flowers" % tag),
    ]
    # cones at the room's outer corners, so it has a silhouette from the plaza
    for i, (qx, qy) in enumerate(((-1, -1), (-1, 1), (1, -1), (1, 1))):
        out.append(A("topiary_cone_plain", cx + sgn * qx * (off + q * 0.62), cy + qy * (off + q * 0.62), 0,
                     s=0.9, mat="MI_V2_LeafDark", label="%s_Cone%d" % (tag, i)))
    return out


def _grove(sgn, cx, cy, seed, tag, count=5):
    """A loose group of trees with underplanting -- the canopy that stops a
    flank reading as open ground, placed as a GROUP with a centre and an edge
    rather than as a row."""
    out = []
    for i in range(count):
        a = 6.283 * i / count + _rnd(i, seed, 3) * 0.9
        r = 320.0 + 520.0 * _rnd(i, seed, 4)
        x, y = cx + sgn * math.cos(a) * r, cy + math.sin(a) * r
        tall = _rnd(i, seed, 5) > 0.45
        sc = 0.92 + 0.3 * _rnd(i, seed, 6)
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
        # what grows at its foot
        out.append(A("shrub_flowering", x + 190 - 380 * _rnd(i, seed, 11), y + 190 - 380 * _rnd(i, seed, 12), 0,
                     yaw=_rnd(i, seed, 13) * 360.0, s=0.8, mat="MI_V2_LeafMid",
                     label="%s_Shrub%d" % (tag, i)))
    for k in range(4):
        a = 6.283 * k / 4 + 0.4
        out.append(A("ground_flowers", cx + sgn * math.cos(a) * 720.0, cy + math.sin(a) * 720.0, 0,
                     yaw=_rnd(k, seed, 14) * 360.0, s=1.0,
                     mat=("MI_V2_PetalViolet", "MI_V2_PetalWhite")[k % 2],
                     label="%s_Ground%d" % (tag, k)))
    return out


def _mushroom_cluster(sgn, cx, cy, seed, tag):
    """A landmark and its family. Wonderland's mushrooms are architecture, so
    one is large and sited, and the rest read as its grounds."""
    out = [
        A("stone_ring_base", cx, cy, -2, s=0.85, mat="MI_V2_Stone", label="%s_Ring" % tag),
        A("mushroom_landmark", cx, cy, 0, yaw=_rnd(seed, 1, 2) * 360.0, s=1.15,
          mat="MI_V2_MushTerracotta", label="%s_Landmark" % tag),
    ]
    for i in range(3):
        a = 6.283 * i / 3 + _rnd(i, seed, 15) * 0.8
        r = 420.0 + 260.0 * _rnd(i, seed, 16)
        out.append(A(("mushroom_medium", "mushroom_small", "mushroom_medium")[i],
                     cx + sgn * math.cos(a) * r, cy + math.sin(a) * r, 0,
                     yaw=_rnd(i, seed, 17) * 360.0, s=0.8 + 0.35 * _rnd(i, seed, 18),
                     mat=("MI_V2_MushRed", "MI_V2_MushPurple", "MI_V2_MushCream")[i % 3],
                     label="%s_Cap%d" % (tag, i)))
    return out


def _rose_walk(sgn, x, y0, y1, seed, tag):
    """A rhythm along the flank's inner edge: clipped box and roses
    alternating, which is what turns open ground into a WAY rather than a
    field, and what the eye follows from the plaza toward the castle."""
    out = []
    n = int((y1 - y0) / 620.0)
    for i in range(n):
        y = y0 + 620.0 * (i + 0.5)
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
        if i % 4 == 0:
            out.append(A("gate_pier", sgn * x, y - 250, 0, s=0.62,
                         mat="MI_V2_IvoryStone", label="%s_Pier%d" % (tag, i)))
            out.append(A("gate_finial_ball", sgn * x, y - 250, 405, s=0.6,
                         mat="MI_V2_Gold", label="%s_Finial%d" % (tag, i)))
        if i % 3 == 1:
            out.append(A("ivy_drape", sgn * (x - 40), y, 180, yaw=90, s=0.9,
                         mat="MI_V2_LeafDark", label="%s_Ivy%d" % (tag, i)))
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
        A(("shrub_flowering", "hedge_block", "rose_bush")[i % 3],
          sgn * (3400 + 420 * i), -900 + 90 * ((i % 2) * 2 - 1), 0,
          yaw=90 + 12 * i, s=0.9,
          mat=("MI_V2_LeafMid", "MI_V2_LeafDark", "MI_V2_LeafMid")[i % 3],
          label="%s_NearBank%d" % (tag, i))
        for i in range(7)
    ] + [
        A("ground_flowers", sgn * (3600 + 560 * i), -640, 0, yaw=55 * i, s=1.05,
          mat=("MI_V2_PetalViolet", "MI_V2_PetalWhite", "MI_V2_PetalPink")[i % 3],
          label="%s_NearFlowers%d" % (tag, i))
        for i in range(5)
    ]
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
    # WONDERLAND, NOT A FORMAL GARDEN. The flanks as built read as a competent
    # royal parterre and nothing in them says which world it is -- the boards
    # list clocks, hearts, keys and tea things as the signatures, and the brief
    # is equally clear that they need HIERARCHY rather than a gimmick every
    # five metres. So: ONE major landmark per flank at the end of its walk,
    # where the eye already travels; one small vignette beside the room; and an
    # arch over the way in for vertical structure. Nothing else.
    if sgn > 0:
        # a clock monument, its face turned back down the walk
        out += [
            A("gate_pier", sgn * 3050, 6400, 0, s=0.55, mat="MI_V2_IvoryStone",
              label="%s_ClockPier" % tag),
            A("clock_ornate", sgn * 3050, 6285, 330, yaw=90, s=1.6, mat="MI_V2_Gold",
              label="%s_Clock" % tag),
            A("gate_finial_ball", sgn * 3050, 6400, 372, s=0.5, mat="MI_V2_Gold",
              label="%s_ClockFinial" % tag),
        ]
    else:
        # the heart, on the same beat on the other side
        out += [
            A("heart_topiary", sgn * 3050, 6400, 0, yaw=0, s=0.85, mat="MI_V2_LeafDark",
              label="%s_Heart" % tag),
            A("rose_bush", sgn * 3050, 6180, 60, s=0.8, mat="MI_V2_LeafMid",
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
    A("ground_flowers", side * 1900, -8750, 0, yaw=40 * side, s=1.1,
      mat=("MI_V2_PetalViolet", "MI_V2_PetalWhite")[(side + 1) // 2],
      label="Rear_FarFlowers%d" % side)
    for side in (1, -1)
])


#: THE BANDS THE BUILDER WALKS. One list, so `ALL` and build_v2 cannot drift.
#:
#: They already had. build_v2 kept its own hand-written list and `ALL` kept
#: another, and the two never matched: COURTYARD was built and absent from
#: `ALL`, so the layout gate had never checked a single actor in it -- and
#: PASS 09 added FLANKS and REARWORLD to `ALL` alone, whereupon the gate
#: counted 305 new placements and passed while the generator placed four. A
#: gate reading a different list from the builder reports the world it was
#: shown, not the world that gets made.
BUILD_BANDS = [FOREGROUND, COURTYARD, GARDEN, PALACE, FLANKS, REARWORLD]

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
