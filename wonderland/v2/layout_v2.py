"""The Golden Arrival composition, authored from the founder's reference.

Pure data. World origin = the centre of the portal; +Y is forward (into the
picture); screen-right is -X. Distances in uu (cm). Every entry names an ASSET
from assets_v2 by key, a position, a yaw, a scale and a material instance. The
builder places them; nothing here is procedural.

Reference structure (the founder's own reading of the image):

    BOTTOM FOREGROUND   the purple rune portal, cut by the bottom edge
    LOWER CENTRE        wide detailed cobblestone path, open travel corridor
    LEFT                gold gate, giant mushrooms, foliage, dark framing tree
    CENTRE              open corridor, garden arch, stairs up to the city
    RIGHT               heart topiary, tea installation, giant mushroom, clock tree
    UPPER CENTRE        dense fairy city
    UPPER EDGES         trees / foliage framing
"""

import math


def _band(name, items):
    return [dict(it, band=name) for it in items]


def A(asset, x, y, z=0.0, yaw=0.0, s=1.0, mat=None, label=None, sxyz=None, pitch=0.0, roll=0.0):
    return {"asset": asset, "pos": (x, y, z), "rot": (pitch, yaw, roll),
            "scale": sxyz if sxyz is not None else (s, s, s), "mat": mat, "label": label}


# ---------------------------------------------------------------------------
# FOREGROUND  0-15 m
# ---------------------------------------------------------------------------
FOREGROUND = _band("V2_Arrival", [
    # the portal: ring geometry + rune disc, at the origin
    A("portal_disc", 0, 0, 2.0, mat="MI_V2_PortalRunes", label="Portal_Runes"),
    A("portal_ring", 0, 0, 3.0, s=1.0, mat="MI_V2_PortalGlow", label="Portal_RingOuter"),
    A("portal_ring", 0, 0, 3.0, s=0.78, mat="MI_V2_PortalGlow", label="Portal_RingMid"),
    A("portal_ring", 0, 0, 3.0, s=0.52, mat="MI_V2_PortalGlow", label="Portal_RingInner"),
    # the clock tree, right edge: trunk enters below the frame, leaves above it
    A("tree_clock_trunk", -1380, -120, 0, yaw=100, s=1.0, mat="MI_V2_Bark", label="ClockTree_Trunk"),
    A("clock_ornate", -1230, -285, 700, yaw=0, s=1.0, mat="MI_V2_Gold", label="ClockTree_ClockA"),
    A("clock_ornate", -1300, -250, 1160, yaw=-15, s=0.7, mat="MI_V2_Gold", label="ClockTree_ClockB"),
    A("canopy_large", -1350, 250, 1650, yaw=30, s=1.0, mat="MI_V2_LeafDark", label="ClockTree_Canopy0"),
    A("canopy_large", -900, 500, 1500, yaw=140, s=0.8, mat="MI_V2_LeafMid", label="ClockTree_Canopy1"),
    A("canopy_large", -1750, 100, 1520, yaw=260, s=0.75, mat="MI_V2_LeafDark", label="ClockTree_Canopy2"),
    A("vine_hanging", -1250, -230, 1250, yaw=20, s=1.0, mat="MI_V2_LeafMid", label="ClockTree_Vine0"),
    A("vine_hanging", -1120, -170, 1200, yaw=80, s=0.9, mat="MI_V2_LeafDark", label="ClockTree_Vine1"),
    A("vine_hanging", -1500, -260, 1300, yaw=150, s=1.1, mat="MI_V2_LeafMid", label="ClockTree_Vine2"),
    # the framing tree, left: a mature dark tree whose crown fills the top-left
    A("tree_mature_trunk", 2250, 900, 0, yaw=200, s=1.0, mat="MI_V2_Bark", label="LeftTree_Trunk"),
    A("canopy_large", 2050, 950, 1500, yaw=0, s=1.3, mat="MI_V2_LeafDark", label="LeftTree_Canopy0"),
    A("canopy_large", 1500, 1200, 1350, yaw=90, s=1.0, mat="MI_V2_LeafMid", label="LeftTree_Canopy1"),
    A("canopy_large", 2500, 600, 1300, yaw=200, s=0.9, mat="MI_V2_LeafDark", label="LeftTree_Canopy2"),
    A("blossom_cluster", 1700, 1050, 1420, s=1.0, mat="MI_V2_RosePink", label="LeftTree_Blossom0"),
    A("blossom_cluster", 2350, 800, 1560, s=0.8, mat="MI_V2_PetalViolet", label="LeftTree_Blossom1"),
    A("blossom_cluster", 1950, 1300, 1250, s=0.9, mat="MI_V2_RosePink", label="LeftTree_Blossom2"),
    # flower banks in both bottom corners: dark mass first, blooms on top
    A("hedge_mass", 820, 520, 0, yaw=20, s=1.2, mat="MI_V2_LeafDark", label="FgBank_L_Mass0"),
    A("hedge_mass", 1150, 700, 0, yaw=200, s=1.0, mat="MI_V2_LeafDark", label="FgBank_L_Mass1"),
    A("hedge_mass", -860, 640, 0, yaw=80, s=1.1, mat="MI_V2_LeafDark", label="FgBank_R_Mass0"),
    A("hedge_mass", -1150, 850, 0, yaw=300, s=0.9, mat="MI_V2_LeafDark", label="FgBank_R_Mass1"),
] + [
    A("rose_bloom", 700 + 90 * (i % 4) + 30 * (i // 4), 420 + 110 * (i // 4) + 40 * (i % 3), 60 + 40 * (i % 3),
      yaw=47 * i, s=0.9 + 0.25 * (i % 3), mat=("MI_V2_RosePink", "MI_V2_PetalViolet", "MI_V2_RoseRed")[i % 3],
      label="FgBank_L_Rose%d" % i) for i in range(9)
] + [
    A("rose_bloom", -700 - 100 * (i % 4) - 20 * (i // 4), 520 + 120 * (i // 4) + 30 * (i % 3), 60 + 40 * (i % 3),
      yaw=61 * i, s=0.9 + 0.25 * (i % 3), mat=("MI_V2_PetalViolet", "MI_V2_RosePink", "MI_V2_RoseRed")[i % 3],
      label="FgBank_R_Rose%d" % i) for i in range(9)
] + [
    A("flower_cluster", 640 + 130 * i, 380 + 60 * (i % 2), 20, yaw=33 * i, s=1.0,
      mat=("MI_V2_PetalPink", "MI_V2_PetalViolet")[i % 2], label="FgBank_L_Flowers%d" % i) for i in range(4)
] + [
    A("flower_cluster", -640 - 130 * i, 480 + 60 * (i % 2), 20, yaw=71 * i, s=1.0,
      mat=("MI_V2_PetalViolet", "MI_V2_PetalPink")[i % 2], label="FgBank_R_Flowers%d" % i) for i in range(4)
])

# ---------------------------------------------------------------------------
# COURTYARD  15-50 m
# ---------------------------------------------------------------------------
COURTYARD = _band("V2_Arrival", [
    # the gold gate, left: two piers, two leaves, finials, wall running outward
    A("gate_pier", 1900, 2200, 0, yaw=0, s=1.0, mat="MI_V2_IvoryStone", label="Gate_PierInner"),
    A("gate_pier", 2700, 2200, 0, yaw=0, s=1.0, mat="MI_V2_IvoryStone", label="Gate_PierOuter"),
    A("gate_leaf", 2100, 2200, 0, yaw=0, s=1.0, mat="MI_V2_Gold", label="Gate_LeafInner"),
    A("gate_leaf", 2500, 2200, 0, yaw=180, s=1.0, mat="MI_V2_Gold", label="Gate_LeafOuter"),
    A("gate_finial_heart", 1900, 2200, 680, yaw=0, s=1.0, mat="MI_V2_Gold", label="Gate_FinialHeart"),
    A("gate_finial_ball", 2700, 2200, 680, s=1.0, mat="MI_V2_Gold", label="Gate_FinialBall"),
    A("garden_wall", 3150, 2200, 0, yaw=0, s=1.0, mat="MI_V2_IvoryStone", label="Gate_Wall0"),
    A("garden_wall", 3650, 2200, 0, yaw=0, s=1.0, mat="MI_V2_IvoryStone", label="Gate_Wall1"),
    A("ivy_drape", 1900, 2130, 600, yaw=0, s=1.0, mat="MI_V2_LeafMid", label="Gate_IvyInner"),
    A("ivy_drape", 2700, 2130, 600, yaw=0, s=1.1, mat="MI_V2_LeafDark", label="Gate_IvyOuter"),
    A("ivy_drape", 3150, 2130, 320, yaw=0, s=0.8, mat="MI_V2_LeafMid", label="Gate_WallIvy0"),
    A("ivy_drape", 3650, 2130, 320, yaw=0, s=0.9, mat="MI_V2_LeafDark", label="Gate_WallIvy1"),
    A("rose_bloom", 1840, 2120, 520, yaw=20, s=0.6, mat="MI_V2_RoseRed", label="Gate_Rose0"),
    A("rose_bloom", 1960, 2120, 380, yaw=140, s=0.55, mat="MI_V2_RosePink", label="Gate_Rose1"),
    A("rose_bloom", 2650, 2120, 450, yaw=80, s=0.6, mat="MI_V2_RoseRed", label="Gate_Rose2"),
    A("rose_bloom", 2760, 2120, 300, yaw=200, s=0.55, mat="MI_V2_RosePink", label="Gate_Rose3"),
    A("hedge_mass", 2000, 2550, 0, yaw=0, s=1.4, mat="MI_V2_LeafDark", label="Gate_HedgeBehind0"),
    A("hedge_mass", 2500, 2600, 0, yaw=90, s=1.3, mat="MI_V2_LeafMid", label="Gate_HedgeBehind1"),
    A("hedge_mass", 3200, 2500, 0, yaw=45, s=1.5, mat="MI_V2_LeafDark", label="Gate_HedgeBehind2"),
    # mushrooms by the gate, left
    A("mushroom_medium", 2150, 1650, 0, yaw=30, s=1.0, mat="MI_V2_MushRed", label="GateMush_Red0"),
    A("mushroom_medium", 2380, 1500, 0, yaw=200, s=0.75, mat="MI_V2_MushRed", label="GateMush_Red1"),
    A("mushroom_small", 2020, 1520, 0, yaw=90, s=1.0, mat="MI_V2_MushPurple", label="GateMush_Purple0"),
    A("mushroom_small", 1860, 1720, 0, yaw=250, s=0.8, mat="MI_V2_MushPurple", label="GateMush_Purple1"),
    A("mushroom_small", 760, 1380, 0, yaw=10, s=1.1, mat="MI_V2_MushPurple", label="PathMush_Purple0"),
    A("mushroom_small", 640, 1520, 0, yaw=120, s=0.7, mat="MI_V2_MushPurple", label="PathMush_Purple1"),
    # the tea installation, right
    A("tea_plinth", -820, 1900, 0, s=1.0, mat="MI_V2_Stone", label="Tea_Plinth"),
    A("tea_saucer", -820, 1900, 96, s=1.0, mat="MI_V2_Ceramic", label="Tea_Saucer0"),
    A("tea_saucer", -820, 1900, 118, s=0.8, mat="MI_V2_Ceramic", label="Tea_Saucer1"),
    A("tea_cup", -820, 1900, 136, yaw=205, s=1.0, mat="MI_V2_Ceramic", label="Tea_Cup"),
    A("tea_heart", -980, 1780, 330, yaw=-60, s=1.0, mat="MI_V2_RoseRed", label="Tea_Heart0"),
    A("tea_heart", -700, 1760, 300, yaw=40, s=0.8, mat="MI_V2_RoseRed", label="Tea_Heart1"),
    A("tea_plinth", -1180, 2280, 0, s=0.7, mat="MI_V2_Stone", label="Teapot_Plinth"),
    A("tea_pot", -1180, 2280, 70, yaw=160, s=1.0, mat="MI_V2_Ceramic", label="Teapot"),
    A("tea_saucer", -520, 2150, 0, s=0.6, mat="MI_V2_Ceramic", label="Tea_SaucerSmall"),
    A("tea_cup", -520, 2150, 12, yaw=90, s=0.55, mat="MI_V2_Ceramic", label="Tea_CupSmall"),
    A("rose_bloom", -1080, 2190, 60, yaw=30, s=0.7, mat="MI_V2_RosePink", label="Tea_Rose0"),
    A("rose_bloom", -660, 2020, 40, yaw=110, s=0.6, mat="MI_V2_PetalViolet", label="Tea_Rose1"),
    # urns and hedges edging the court
    A("garden_urn", 1350, 800, 0, s=1.0, mat="MI_V2_Ceramic", label="Urn_L"),
    A("garden_urn", -1350, 1000, 0, s=1.0, mat="MI_V2_Ceramic", label="Urn_R"),
] + [
    A("hedge_mass", side * (1500 + 60 * (i % 2)), 700 + 300 * i, 0, yaw=40 * i, s=1.1,
      mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2], label="CourtHedge%d_%d" % (side, i))
    for side in (-1, 1) for i in range(6) if not (side > 0 and 1900 < 700 + 300 * i < 2500)
])

# ---------------------------------------------------------------------------
# GARDEN  50-120 m
# ---------------------------------------------------------------------------
GARDEN = _band("V2_Garden", [
    A("floral_arch", 0, 4200, 0, yaw=0, s=1.0, mat="MI_V2_LeafMid", label="FloralArch"),
    A("rose_bloom", -470, 4130, 620, yaw=0, s=0.7, mat="MI_V2_RosePink", label="FloralArch_Rose0"),
    A("rose_bloom", 460, 4130, 560, yaw=60, s=0.7, mat="MI_V2_RoseRed", label="FloralArch_Rose1"),
    A("rose_bloom", 0, 4120, 900, yaw=120, s=0.8, mat="MI_V2_RosePink", label="FloralArch_Rose2"),
    A("rose_bloom", -260, 4125, 840, yaw=180, s=0.6, mat="MI_V2_PetalViolet", label="FloralArch_Rose3"),
    A("rose_bloom", 280, 4125, 830, yaw=240, s=0.6, mat="MI_V2_RosePink", label="FloralArch_Rose4"),
    # the heart topiary, right
    A("heart_topiary", -1150, 3300, 0, yaw=10, s=1.0, mat="MI_V2_LeafMid", label="HeartTopiary"),
    A("hedge_mass", -1400, 3450, 0, yaw=0, s=1.2, mat="MI_V2_LeafDark", label="Heart_Base0"),
    A("hedge_mass", -900, 3500, 0, yaw=90, s=1.0, mat="MI_V2_LeafDark", label="Heart_Base1"),
    # the clock tower behind it
    A("tower_clock", -1700, 5300, 0, yaw=0, s=1.0, mat="MI_V2_IvoryStone", label="ClockTower"),
    A("clock_ornate", -1700, 5150, 900, yaw=0, s=1.0, mat="MI_V2_Gold", label="ClockTower_Clock"),
    A("roof_bell", -1700, 5300, 1180, s=1.0, mat="MI_V2_RoofPink", label="ClockTower_Roof"),
    # giant mushrooms: left-mid behind the gate, right-mid behind the heart
    A("mushroom_landmark", 1700, 4200, 0, yaw=20, s=1.0, mat="MI_V2_MushRed", label="Landmark_Mushroom_L"),
    A("mushroom_landmark", -2300, 4900, 0, yaw=160, s=1.15, mat="MI_V2_MushRed", label="Landmark_Mushroom_R"),
    A("mushroom_medium", 1300, 3700, 0, yaw=70, s=1.2, mat="MI_V2_MushCream", label="Garden_Mush_Cream0"),
    A("mushroom_medium", -1900, 4300, 0, yaw=300, s=0.9, mat="MI_V2_MushPurple", label="Garden_Mush_Purple0"),
    A("mushroom_medium", -2600, 4400, 0, yaw=120, s=1.1, mat="MI_V2_MushRed", label="Garden_Mush_Red0"),
    # garden trees behind the gate (left) and behind the heart (right)
    A("tree_mature_trunk", 2100, 3400, 0, yaw=40, s=1.1, mat="MI_V2_Bark", label="GardenTree_L_Trunk"),
    A("canopy_large", 2100, 3400, 1350, yaw=0, s=1.4, mat="MI_V2_LeafMid", label="GardenTree_L_Canopy0"),
    A("canopy_large", 1700, 3600, 1200, yaw=120, s=1.0, mat="MI_V2_LeafDark", label="GardenTree_L_Canopy1"),
    A("canopy_large", 2500, 3250, 1250, yaw=240, s=1.0, mat="MI_V2_LeafMid", label="GardenTree_L_Canopy2"),
    A("blossom_cluster", 1900, 3500, 1400, s=1.0, mat="MI_V2_RosePink", label="GardenTree_L_Blossom0"),
    A("blossom_cluster", 2400, 3300, 1500, s=0.9, mat="MI_V2_PetalViolet", label="GardenTree_L_Blossom1"),
    A("tree_mature_trunk", -2900, 5200, 0, yaw=300, s=0.9, mat="MI_V2_Bark", label="GardenTree_R_Trunk"),
    A("canopy_large", -2900, 5200, 1150, yaw=0, s=1.1, mat="MI_V2_LeafMid", label="GardenTree_R_Canopy0"),
    A("canopy_large", -2500, 5400, 1050, yaw=150, s=0.9, mat="MI_V2_LeafDark", label="GardenTree_R_Canopy1"),
    # stairs up to the palace terrace, and the portal at the top
    A("stairs_broad", 0, 6600, 0, s=1.0, mat="MI_V2_Stone", label="Stairs_Flight0"),
    A("stairs_broad", 0, 6950, 180, s=1.0, mat="MI_V2_Stone", label="Stairs_Flight1"),
    A("stairs_broad", 0, 7300, 360, s=1.0, mat="MI_V2_Stone", label="Stairs_Flight2"),
    A("balustrade", 420, 6650, 0, yaw=90, s=1.0, mat="MI_V2_IvoryStone", label="Stairs_Balustrade_L0"),
    A("balustrade", -420, 6650, 0, yaw=90, s=1.0, mat="MI_V2_IvoryStone", label="Stairs_Balustrade_R0"),
    A("balustrade", 420, 7000, 180, yaw=90, s=1.0, mat="MI_V2_IvoryStone", label="Stairs_Balustrade_L1"),
    A("balustrade", -420, 7000, 180, yaw=90, s=1.0, mat="MI_V2_IvoryStone", label="Stairs_Balustrade_R1"),
    A("garden_urn", 560, 6450, 0, s=1.2, mat="MI_V2_Ceramic", label="Stairs_Urn_L"),
    A("garden_urn", -560, 6450, 0, s=1.2, mat="MI_V2_Ceramic", label="Stairs_Urn_R"),
    A("terrace_platform", 0, 8300, 540, s=1.0, mat="MI_V2_Stone", label="Terrace"),
    A("column_ornate", 520, 8250, 600, s=1.0, mat="MI_V2_IvoryStone", label="Terrace_Column_L"),
    A("column_ornate", -520, 8250, 600, s=1.0, mat="MI_V2_IvoryStone", label="Terrace_Column_R"),
    A("arch_stone", 0, 8250, 600, yaw=0, s=1.0, mat="MI_V2_IvoryStone", label="Terrace_Arch"),
    A("gate_finial_heart", 0, 8250, 1480, s=1.2, mat="MI_V2_Gold", label="Terrace_Heart"),
] + [
    # hedged verges either side of the path, flowers at the stone
    A("hedge_mass", side * (560 + 40 * (i % 3)), 2800 + 300 * i, 0, yaw=37 * i, s=0.9 + 0.1 * (i % 2),
      mat=("MI_V2_LeafDark", "MI_V2_LeafMid")[i % 2], label="Verge_Hedge%d_%d" % (side, i))
    for side in (-1, 1) for i in range(12)
] + [
    A("flower_cluster", side * (240 + 60 * (i % 3)), 2700 + 260 * i, 10, yaw=53 * i, s=0.8 + 0.2 * (i % 2),
      mat=("MI_V2_PetalPink", "MI_V2_PetalViolet", "MI_V2_RosePink")[i % 3], label="Verge_Flowers%d_%d" % (side, i))
    for side in (-1, 1) for i in range(14)
] + [
    A("rose_bloom", side * (330 + 90 * (i % 2)), 2850 + 420 * i, 70, yaw=29 * i, s=0.55,
      mat=("MI_V2_RoseRed", "MI_V2_RosePink")[i % 2], label="Verge_Rose%d_%d" % (side, i))
    for side in (-1, 1) for i in range(9)
] + [
    A("mushroom_small", side * (700 + 80 * (i % 2)), 3000 + 900 * i, 0, yaw=97 * i, s=0.9,
      mat=("MI_V2_MushRed", "MI_V2_MushPurple", "MI_V2_MushCream")[i % 3], label="Verge_Mush%d_%d" % (side, i))
    for side in (-1, 1) for i in range(4)
])

# ---------------------------------------------------------------------------
# PALACE DISTRICT  120-400 m  (3D castle kit, layered in depth)
# ---------------------------------------------------------------------------


def _castle_group(x, y, seed, scale=1.0, layer="V2_Castle"):
    """One asymmetric palace mass: a hall, three towers of different heights
    and roofs, a bridge, a dome. Nothing is a lone tower."""
    k = seed
    items = [
        A("castle_hall", x, y, 0, yaw=(k * 37) % 30 - 15, s=scale, mat="MI_V2_IvoryStone", label="Castle%d_Hall" % k),
        A("roof_hip", x, y, 900 * scale, yaw=(k * 37) % 30 - 15, s=scale, mat=("MI_V2_RoofPink", "MI_V2_RoofRose")[k % 2], label="Castle%d_HallRoof" % k),
        A("castle_tower", x + 700 * scale, y + 200 * scale, 0, s=scale * 1.0, mat="MI_V2_IvoryStone", label="Castle%d_TowerA" % k),
        A("roof_ogee", x + 700 * scale, y + 200 * scale, 1700 * scale, s=scale * 1.0, mat="MI_V2_RoofPink", label="Castle%d_TowerA_Roof" % k),
        A("castle_tower", x - 600 * scale, y - 100 * scale, 0, s=scale * 0.8, mat="MI_V2_IvoryStone", label="Castle%d_TowerB" % k),
        A("roof_bell", x - 600 * scale, y - 100 * scale, 1360 * scale, s=scale * 0.8, mat=("MI_V2_RoofLilac", "MI_V2_RoofBlue")[k % 2], label="Castle%d_TowerB_Roof" % k),
        A("castle_tower", x + 100 * scale, y + 800 * scale, 0, s=scale * 1.35, mat="MI_V2_IvoryStone", label="Castle%d_TowerC" % k),
        A("roof_ogee", x + 100 * scale, y + 800 * scale, 2300 * scale, s=scale * 1.35, mat="MI_V2_RoofRose", label="Castle%d_TowerC_Roof" % k),
        A("castle_dome", x - 250 * scale, y + 450 * scale, 900 * scale, s=scale, mat="MI_V2_Gold", label="Castle%d_Dome" % k),
        A("castle_bridge", x + 400 * scale, y + 500 * scale, 1000 * scale, yaw=35, s=scale, mat="MI_V2_IvoryStone", label="Castle%d_Bridge" % k),
        A("balcony_ring", x + 700 * scale, y + 200 * scale, 1100 * scale, s=scale * 1.0, mat="MI_V2_IvoryStone", label="Castle%d_BalconyA" % k),
        A("balcony_ring", x + 100 * scale, y + 800 * scale, 1500 * scale, s=scale * 1.35, mat="MI_V2_IvoryStone", label="Castle%d_BalconyC" % k),
        A("gate_finial_ball", x + 700 * scale, y + 200 * scale, 2650 * scale, s=scale * 0.9, mat="MI_V2_Gold", label="Castle%d_FinialA" % k),
        A("gate_finial_ball", x + 100 * scale, y + 800 * scale, 3580 * scale, s=scale * 1.2, mat="MI_V2_Gold", label="Castle%d_FinialC" % k),
    ]
    return _band(layer, items)


PALACE = (
    _castle_group(2600, 9800, 1, 1.0) + _castle_group(-2900, 10400, 2, 1.1) +
    _castle_group(0, 11800, 3, 1.3) + _castle_group(4600, 12600, 4, 1.4) +
    _castle_group(-5200, 13400, 5, 1.5) + _castle_group(1800, 15200, 6, 1.9, "V2_Skyline") +
    _castle_group(-2400, 17000, 7, 2.2, "V2_Skyline") + _castle_group(6500, 18500, 8, 2.4, "V2_Skyline") +
    _castle_group(-7800, 19800, 9, 2.6, "V2_Skyline") + _castle_group(300, 22500, 10, 3.2, "V2_Skyline")
)

# ---------------------------------------------------------------------------
# SKY  (hover props + the Marble skyline dome)
# ---------------------------------------------------------------------------
SKY = _band("V2_Skyline", [
    A("sky_dome", 0, 0, -200, yaw=0, s=1.0, mat="MI_V2_SkyPano", label="Skyline_MarbleDome"),
])
HOVER = _band("V2_Props", [
    A("key_ornate", 650, 2400, 1500, yaw=20, s=1.0, mat="MI_V2_Gold", label="FloatKey0"),
    A("key_ornate", -300, 3300, 1800, yaw=140, s=0.9, mat="MI_V2_Gold", label="FloatKey1"),
    A("key_ornate", 1100, 4600, 2100, yaw=260, s=1.1, mat="MI_V2_Gold", label="FloatKey2"),
    A("tea_pot", 350, 5200, 2400, yaw=30, s=1.3, mat="MI_V2_Ceramic", label="FloatTeapot"),
])

ALL = FOREGROUND + COURTYARD + GARDEN + PALACE + SKY + HOVER

#: The path: a spline from behind the portal to the stairs. The builder lays
#: irregular cobble slabs along it (Phase "ground first").
PATH_SPLINE = [(0.0, -800.0, 0.0), (0.0, 0.0, 0.0), (40.0, 1400.0, 0.0),
               (-30.0, 3000.0, 0.0), (0.0, 4400.0, 0.0), (0.0, 6500.0, 0.0)]
PATH_WIDTH_NEAR, PATH_WIDTH_FAR = 640.0, 300.0
PLAZA_RADIUS = 1500.0


def summary():
    by = {}
    for it in ALL:
        by[it["band"]] = by.get(it["band"], 0) + 1
    return by
