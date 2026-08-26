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
    SKY                the panorama itself above +8° of elevation; two keys and the teapot, high
"""


def _rnd(*key):
    """Deterministic 0..1 from integers -- the geometry kernel's hash, kept
    local so this data module imports with no path setup."""
    ints = [int(round(float(k) * 1024.0)) for k in key] + [0, 0, 0]
    h = (ints[0] * 374761393 + ints[1] * 668265263 + ints[2] * 2147483647 + len(key) * 1274126177) & 0xFFFFFFFF
    h = (h ^ (h >> 13)) & 0xFFFFFFFF
    h = (h * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 4294967296.0


def _band(name, items):
    return [dict(it, band=name) for it in items]


def A(asset, x, y, z=0.0, yaw=0.0, s=1.0, mat=None, label=None, sxyz=None, pitch=0.0, roll=0.0):
    return {"asset": asset, "pos": (x, y, z), "rot": (pitch, yaw, roll),
            "scale": sxyz if sxyz is not None else (s, s, s), "mat": mat, "label": label}


# ---------------------------------------------------------------------------
# THE GATE (behind the viewpoint) AND THE PLAZA EDGE
# ---------------------------------------------------------------------------
GATE = _band("V2_Arrival", [
    A("gate_pier", 230, -910, 0, s=1.4, mat="MI_V2_IvoryStone", label="Gate_PierL"),
    A("gate_pier", -230, -910, 0, s=1.4, mat="MI_V2_IvoryStone", label="Gate_PierR"),
    # leaves OPEN: hinged at the piers, swung 80 degrees toward the plaza
    A("gate_leaf", 170, -870, 0, yaw=80, s=0.5, sxyz=(0.5, 0.5, 1.25), mat="MI_V2_Gold", label="Gate_LeafL"),
    A("gate_leaf", -170, -870, 0, yaw=100, s=0.5, sxyz=(-0.5, 0.5, 1.25), mat="MI_V2_Gold", label="Gate_LeafR"),
    A("gate_finial_ball", 230, -910, 910, s=1.3, mat="MI_V2_Gold", label="Gate_FinialL"),
    A("gate_finial_ball", -230, -910, 910, s=1.3, mat="MI_V2_Gold", label="Gate_FinialR"),
    A("garden_urn", 330, -880, 0, s=1.0, mat="MI_V2_Ceramic", label="Gate_UrnL"),
    A("garden_urn", -330, -880, 0, s=1.0, mat="MI_V2_Ceramic", label="Gate_UrnR"),
    A("flower_cluster", 330, -880, 150, s=0.6, mat="MI_V2_PetalPink", label="Gate_UrnFlowersL"),
    A("flower_cluster", -330, -880, 150, s=0.6, mat="MI_V2_PetalViolet", label="Gate_UrnFlowersR"),
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
    A("topiary_cone_roses", 860, -45, 85, yaw=10, s=1.0, mat="MI_V2_LeafMid", label="RoseCone_L"),
    A("topiary_cone_roses", -770, 250, 85, yaw=200, s=1.04, mat="MI_V2_LeafMid", label="RoseCone_R"),
    A("planter_box", 860, -45, 0, s=1.4, mat="MI_V2_IvoryStone", label="RoseCone_L_Planter"),
    A("planter_box", -770, 250, 0, s=1.4, mat="MI_V2_IvoryStone", label="RoseCone_R_Planter"),
] + [
    A("retaining_wall", 800, -700 + 400 * i, 0, yaw=90, s=1.0, mat="MI_V2_IvoryStone", label="SideWall_L%d" % i) for i in range(5)
] + [
    A("retaining_wall", -800, -640 + 400 * i, 0, yaw=90, s=1.0, mat="MI_V2_IvoryStone", label="SideWall_R%d" % i) for i in range(5)
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
    A("path_steps", 0, 1470, 0, s=1.0, mat="MI_V2_Stone", label="Path_Steps"),
    A("balustrade", 300, 1520, 60, yaw=90, s=0.9, mat="MI_V2_IvoryStone", label="Steps_BalustradeL"),
    A("balustrade", -300, 1520, 60, yaw=90, s=0.9, mat="MI_V2_IvoryStone", label="Steps_BalustradeR"),
    A("garden_urn", 330, 1330, 0, s=0.9, mat="MI_V2_Ceramic", label="Steps_UrnL"),
    A("garden_urn", -330, 1330, 0, s=0.9, mat="MI_V2_Ceramic", label="Steps_UrnR"),
] + [
    A("retaining_wall", 280 + 400 * (i + 1), 900, 0, yaw=0, s=1.0, mat="MI_V2_IvoryStone", label="FrontWall_L%d" % i) for i in range(4)
] + [
    A("retaining_wall", -280 - 400 * (i + 1), 900, 0, yaw=0, s=1.0, mat="MI_V2_IvoryStone", label="FrontWall_R%d" % i) for i in range(4)
] + [
    A("hedge_mass", 560 + 380 * i, 1100, 60, yaw=33 * i, s=1.0, mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2], label="FrontBed_L_Hedge%d" % i) for i in range(4)
] + [
    A("hedge_mass", -560 - 380 * i, 1100, 60, yaw=59 * i, s=1.0, mat=("MI_V2_LeafMid", "MI_V2_LeafDark")[i % 2], label="FrontBed_R_Hedge%d" % i) for i in range(4)
] + [
    A("flower_cluster", 420 + 300 * i, 1000, 90, yaw=17 * i, s=0.9, mat=("MI_V2_PetalPink", "MI_V2_PetalBlue", "MI_V2_RoseRed", "MI_V2_PetalViolet")[i % 4], label="FrontBed_L_Flowers%d" % i) for i in range(5)
] + [
    A("flower_cluster", -420 - 300 * i, 1000, 90, yaw=23 * i, s=0.9, mat=("MI_V2_PetalViolet", "MI_V2_RosePink", "MI_V2_PetalBlue", "MI_V2_PetalPink")[i % 4], label="FrontBed_R_Flowers%d" % i) for i in range(5)
] + [
    # hedges flanking the path beyond the steps, then the garden opens
    A("hedge_mass", side * (330 + 30 * (i % 2)), 1750 + 320 * i, 60 + 24 * i, yaw=41 * i + (0 if side > 0 else 180), s=0.85,
      mat=("MI_V2_LeafMid", "MI_V2_LeafDark")[i % 2], label="PathHedge%d_%d" % (side, i))
    for side in (-1, 1) for i in range(8)
] + [
    A("rose_bloom", side * (300 + 40 * (i % 2)), 1850 + 420 * i, 130 + 24 * i, yaw=31 * i, s=0.5,
      mat=("MI_V2_RoseRed", "MI_V2_RosePink")[(i + (0 if side > 0 else 1)) % 2], label="PathRose%d_%d" % (side, i))
    for side in (-1, 1) for i in range(6)
] + [
    A("garden_arch_stone", 0, 4500, 220, s=1.0, mat="MI_V2_IvoryStone", label="Corridor_Arch"),
    A("ivy_drape", 350, 4460, 620, s=0.8, mat="MI_V2_LeafMid", label="Corridor_ArchIvyL"),
    A("ivy_drape", -350, 4460, 620, s=0.8, mat="MI_V2_LeafDark", label="Corridor_ArchIvyR"),
    A("rose_bloom", 0, 4440, 870, s=0.7, mat="MI_V2_RosePink", label="Corridor_ArchRose"),
])

# ---------------------------------------------------------------------------
# GARDEN LEFT: the giant mushroom and its grounds
# ---------------------------------------------------------------------------
GARDEN_L = _band("V2_Garden", [
    # the LEFT GARDEN GATE: gold leaves between cream piers at the entrance to
    # the left garden, beyond the front wall (reprojected view: az -25, ~18 m)
    A("gate_pier", 1080, 1700, 0, s=1.0, mat="MI_V2_IvoryStone", label="GardenGate_PierL"),
    A("gate_pier", 700, 1700, 0, s=1.0, mat="MI_V2_IvoryStone", label="GardenGate_PierR"),
    A("gate_leaf", 1030, 1690, 0, yaw=180, s=0.45, sxyz=(-0.45, 0.45, 0.95), mat="MI_V2_Gold", label="GardenGate_LeafL"),
    A("gate_leaf", 750, 1690, 0, yaw=0, s=0.45, sxyz=(0.45, 0.45, 0.95), mat="MI_V2_Gold", label="GardenGate_LeafR"),
    A("gate_finial_heart", 1080, 1700, 650, s=0.9, mat="MI_V2_Gold", label="GardenGate_FinialL"),
    A("gate_finial_ball", 700, 1700, 650, s=1.0, mat="MI_V2_Gold", label="GardenGate_FinialR"),
    A("vine_wall", 1090, 1660, 80, yaw=0, s=0.5, mat="MI_V2_LeafMid", label="GardenGate_IvyL"),
    A("mushroom_giant", 1960, 1000, 0, yaw=15, s=1.0, mat="MI_V2_MushTerracotta", label="GiantMushroom"),
    A("clock_ornate", 1780, 800, 850, yaw=-10, s=1.1, mat="MI_V2_Gold", label="GiantMushroom_Clock"),
    A("canopy_large", 1960, 1000, 1640, yaw=0, s=1.3, sxyz=(1.5, 1.5, 0.55), mat="MI_V2_LeafMid", label="GiantMushroom_Ivy0"),
    A("canopy_large", 2400, 1200, 1600, yaw=120, s=1.0, sxyz=(1.1, 1.1, 0.5), mat="MI_V2_LeafDark", label="GiantMushroom_Ivy1"),
    A("vine_hanging", 2500, 700, 1380, s=0.9, mat="MI_V2_LeafMid", label="GiantMushroom_Vine0"),
    A("vine_hanging", 1500, 1300, 1380, s=0.8, mat="MI_V2_LeafDark", label="GiantMushroom_Vine1"),
    A("hedge_mass", 1700, 600, 0, yaw=30, s=1.4, mat="MI_V2_LeafDark", label="GiantMushroom_Foot0"),
    A("hedge_mass", 2300, 700, 0, yaw=150, s=1.3, mat="MI_V2_LeafMid", label="GiantMushroom_Foot1"),
    A("hedge_mass", 1900, 1500, 0, yaw=250, s=1.2, mat="MI_V2_LeafDark", label="GiantMushroom_Foot2"),
    A("mushroom_medium", 1450, 1750, 0, yaw=40, s=1.0, mat="MI_V2_MushRed", label="Garden_L_Mush0"),
    A("mushroom_medium", 2600, 1500, 0, yaw=200, s=0.8, mat="MI_V2_MushCream", label="Garden_L_Mush1"),
    A("mushroom_small", 1300, 1200, 0, yaw=90, s=1.0, mat="MI_V2_MushPurple", label="Garden_L_Mush2"),
    A("mushroom_small", 1200, 2150, 0, yaw=300, s=0.9, mat="MI_V2_MushRed", label="Garden_L_Mush3"),
    A("tree_mature_trunk", 1500, 2600, 0, yaw=180, s=0.9, mat="MI_V2_Bark", label="Garden_L_Tree_Trunk"),
    A("canopy_large", 1500, 2600, 1150, yaw=0, s=1.1, mat="MI_V2_LeafMid", label="Garden_L_Tree_Canopy0"),
    A("canopy_large", 1200, 2800, 1050, yaw=130, s=0.85, mat="MI_V2_LeafDark", label="Garden_L_Tree_Canopy1"),
    A("canopy_large", 1850, 2500, 1000, yaw=250, s=0.8, mat="MI_V2_LeafLight", label="Garden_L_Tree_Canopy2"),
    A("blossom_cluster", 1400, 2700, 1200, s=0.9, mat="MI_V2_RosePink", label="Garden_L_Tree_Blossom"),
    A("topiary_ball", 1100, 1600, 0, s=1.0, mat="MI_V2_LeafMid", label="Garden_L_Ball0"),
    A("topiary_spiral", 2200, 2200, 0, s=1.1, mat="MI_V2_LeafDark", label="Garden_L_Spiral"),
    A("topiary_cone_plain", 1250, 3100, 0, s=1.0, mat="MI_V2_LeafMid", label="Garden_L_Cone"),
    A("rose_bush", 1000, 2300, 0, yaw=40, s=1.0, mat="MI_V2_LeafMid", label="Garden_L_RoseBush"),
    A("shrub_flowering", 2600, 2700, 0, yaw=120, s=1.1, mat="MI_V2_LeafDark", label="Garden_L_FlowerShrub"),
    A("tree_slender_trunk", 2900, 2200, 0, yaw=70, s=1.0, mat="MI_V2_Bark", label="Garden_L_Slender_Trunk"),
    A("canopy_medium", 2900, 2200, 800, yaw=0, s=1.1, mat="MI_V2_LeafLight", label="Garden_L_Slender_Canopy"),
    A("tower_capped", 5000, 3300, 0, s=1.2, mat="MI_V2_IvoryStone", label="Tower_L"),
    A("roof_cone_steep", 5000, 3300, 1320, s=1.2, mat="MI_V2_RoofNavy", label="Tower_L_Cap"),
    A("balcony_ring", 5000, 3300, 700, s=0.6, mat="MI_V2_IvoryStone", label="Tower_L_Balcony"),
])

# ---------------------------------------------------------------------------
# GARDEN RIGHT: the clock tree, flowering shrubs, the heart on its terrace
# ---------------------------------------------------------------------------
GARDEN_R = _band("V2_Garden", [
    A("tree_clock_trunk", -2900, 1600, 0, yaw=200, s=0.62, mat="MI_V2_Bark", label="ClockTree_Trunk"),
    A("clock_ornate", -2760, 1440, 520, yaw=-20, s=0.9, mat="MI_V2_Gold", label="ClockTree_Clock"),
    A("canopy_large", -2900, 1650, 1060, yaw=0, s=1.1, mat="MI_V2_LeafMid", label="ClockTree_Canopy0"),
    A("canopy_large", -2500, 1850, 950, yaw=140, s=0.9, mat="MI_V2_LeafDark", label="ClockTree_Canopy1"),
    A("canopy_large", -3300, 1400, 980, yaw=260, s=0.85, mat="MI_V2_LeafLight", label="ClockTree_Canopy2"),
    A("vine_hanging", -2750, 1450, 760, s=0.6, mat="MI_V2_LeafMid", label="ClockTree_Vine"),
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
    A("terrace_platform", -1300, 3250, 0, s=1.0, sxyz=(0.7, 0.7, 2.5), mat="MI_V2_IvoryStone", label="Heart_Terrace"),
    A("heart_topiary", -1300, 3250, 300, yaw=15, s=0.6, mat="MI_V2_LeafMid", label="HeartTopiary"),
    A("hedge_mass", -1650, 3350, 300, yaw=0, s=1.0, mat="MI_V2_LeafDark", label="Heart_Base0"),
    A("hedge_mass", -950, 3400, 300, yaw=90, s=0.9, mat="MI_V2_LeafDark", label="Heart_Base1"),
    A("tower_capped", -4200, 4200, 0, s=1.0, mat="MI_V2_IvoryStone", label="Tower_R0"),
    A("roof_cone_steep", -4200, 4200, 1100, s=1.0, mat="MI_V2_RoofNavy", label="Tower_R0_Cap"),
    A("balcony_ring", -4200, 4200, 620, s=0.5, mat="MI_V2_IvoryStone", label="Tower_R0_Balcony"),
    A("tower_capped", -5200, 5400, 0, s=1.4, mat="MI_V2_IvoryStone", label="Tower_R1"),
    A("roof_cone_steep", -5200, 5400, 1540, s=1.4, mat="MI_V2_RoofBlue", label="Tower_R1_Cap"),
    A("tree_mature_trunk", -3600, 3600, 0, yaw=60, s=0.8, mat="MI_V2_Bark", label="Garden_R_Tree_Trunk"),
    A("canopy_large", -3600, 3600, 1050, yaw=0, s=1.0, mat="MI_V2_LeafMid", label="Garden_R_Tree_Canopy0"),
    A("canopy_large", -3200, 3800, 950, yaw=150, s=0.8, mat="MI_V2_LeafLight", label="Garden_R_Tree_Canopy1"),
])

# ---------------------------------------------------------------------------
# THE CITY IN DEPTH
# ---------------------------------------------------------------------------


def _castle_group(x, y, seed, scale=1.0, layer="V2_Castle"):
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
    towers = (((700, 200), 1.0, 0), ((-600, -100), 0.8, 1), ((100, 800), 1.35, 2), ((-900, 600), 1.1, 3))
    for t, ((ox, oy), ts, bi) in enumerate(towers):
        body = bodies[(k + bi) % 4]
        cap = caps[body][(k + t) % 2]
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
    # LAYER 3: mid-distance city, 90-140 m
    _castle_group(2400, 9500, 1, 1.0) + _castle_group(-2600, 10200, 2, 1.1) + _castle_group(300, 11500, 3, 1.25)
    + _castle_group(5200, 12200, 4, 1.3) + _castle_group(-5600, 13000, 5, 1.4)
    # LAYER 4: large skyline towers, 150-220 m
    + _castle_group(1800, 15500, 6, 2.0, "V2_Skyline") + _castle_group(-3200, 17500, 7, 2.3, "V2_Skyline")
    + _castle_group(7500, 19000, 8, 2.4, "V2_Skyline") + _castle_group(-8500, 20500, 9, 2.6, "V2_Skyline")
    # LAYER 5: soft distant structures, 250-400 m (fog does the softening)
    + _castle_group(500, 26000, 10, 3.4, "V2_Skyline") + _castle_group(-12000, 30000, 11, 3.8, "V2_Skyline")
    + _castle_group(11000, 33000, 12, 4.0, "V2_Skyline") + _castle_group(-4000, 40000, 13, 4.6, "V2_Skyline")
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
])

FOREGROUND = GATE + SIDES
COURTYARD = []
GARDEN = CORRIDOR + GARDEN_L + GARDEN_R
PALACE = CITY
ALL = FOREGROUND + GARDEN + PALACE + SKY + HOVER

#: The dark path: from the front wall line to the arch, 4.4 m narrowing to 3 m,
#: rising 0.6 m at the steps then 2%. The builder lays it.
PATH_SPLINE = [(0.0, 850.0, 0.0), (0.0, 1420.0, 0.0), (0.0, 1560.0, 60.0), (20.0, 2600.0, 82.0),
               (-15.0, 3600.0, 102.0), (0.0, 4450.0, 118.0)]
PATH_WIDTH_NEAR, PATH_WIDTH_FAR = 440.0, 300.0
#: The pale plaza: from behind the gate to the front wall, 16 m wide.
PLAZA_RECT = (-1400.0, 1400.0, -1600.0, 880.0)      # x0, x1, y0, y1
PLAZA_SLAB = 130.0
PETALS = 36


def summary():
    by = {}
    for it in ALL:
        by[it["band"]] = by.get(it["band"], 0) + 1
    return by
