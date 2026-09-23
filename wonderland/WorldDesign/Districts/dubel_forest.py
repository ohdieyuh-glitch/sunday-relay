#!/usr/bin/env python3
"""DF01 -- Dubel Forest: the wilderness belt beyond the three nations.

FOUNDER DIRECTIVE 2026-09-23: "Finish Dubel Forest. Do not leave it as trees + ground + a few props. Build it
as a real Wonderland location." It was not unfinished -- it did not exist. `Dubel` appears exactly twice in the
whole repository, both times in CANON, and the canon record says so itself:

    {"id": "DUBEL", "rule": "if it stays outside the three-nation division, preserve it as an exception;
     never force it into a nation", "geography": "not defined in this world lane"}

So the identity is canon and the geography was mine to choose. WHERE. The three nations divide every bearing
between them from 500 m outward and their built frontier now ends at 1,158 m, past which the world is empty to
the horizon. "Outside the three-nation division" is therefore best read radially rather than angularly: Dubel
is the belt BEYOND the nations, the wilderness their cities stop at. That also fixes something the captures
show plainly -- Wonderland currently ends at a line, with nothing between the last tower and the sky.

WHAT MAKES IT A PLACE RATHER THAN SCATTERED TREES. Six things, each of which the founder named:

  DENSITY THAT MEANS SOMETHING  A forest with uniform spacing reads as an array. Density here follows a
      noise-free deterministic field: dense heart, thinning toward both the inner edge (so the nations' outskirts
      are not walled off) and the outer edge (so the belt fades rather than stops).
  CLEARINGS                     Explicit voids, placed first and respected by everything after, so there are
      spaces to stand in and sightlines through the trunks.
  A PATH                        A winding paved way with its own clearance, so the forest is traversable rather
      than merely enterable, and so a player has a reason to be in it.
  VERTICAL VARIATION            Three trunk kinds at three heights plus scale jitter, so the canopy line is not
      a single plane.
  UNDERGROWTH                   Shrubs, flower clusters and small mushrooms at the trunk bases, because bare
      ground under trees is what makes a forest look unfinished.
  LANDMARKS                     Giant and landmark mushrooms at chosen points, tall enough to be seen over the
      canopy from the nation bands, so the belt has silhouette from distance.

PERFORMANCE IS NOT AN AFTERTHOUGHT HERE. Measured this session: the world is ~114.6 M triangles at 3.3-3.5 fps
in PIE, 99.2% of it on single-LOD meshes, and vegetation is already 89.3% of every triangle in Wonderland.
SM_canopy_large alone is 31,264 triangles with one LOD. So this pass deliberately favours the slender trunk and
the medium canopy (21.4 k a tree) over the mature pair (37.5 k), keeps the tree count to a few hundred rather
than a few thousand, and culls hard at distance. A forest that halves the frame rate is not an improvement.
"""
import json
import math
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
PASS = "DF01"

VEG = "/Game/WonderlandV2/Vegetation/Trees/%s.%s"
SHRUB = "/Game/WonderlandV2/Vegetation/Shrubs/%s.%s"
FLOWER = "/Game/WonderlandV2/Vegetation/Flowers/%s.%s"
TERRAIN = "/Game/WonderlandV2/Ground/Terrain/%s.%s"
MUSH = "/Game/WonderlandV2/Mushrooms/%s/%s.%s"

#: (trunk, trunk height cm, canopy, canopy dz as ratio of scaled trunk height, canopy scale ratio, share)
KINDS = [
    ("SM_tree_slender_trunk", 982.8, "SM_canopy_medium", 0.77, 1.15, 0.62),
    ("SM_tree_mature_trunk", 1567.3, "SM_canopy_large", 0.67, 1.30, 0.38),
]
#: Wonderland's leaves are not one green. Gold and copper are the belt's own note -- it is the wild edge of the
#: world and reads as later in the year than the nations' gardens.
LEAF = [("MI_V2_LeafMid", 0.34), ("MI_V2_LeafDark", 0.22), ("MI_V2_LeafLight", 0.16),
        ("MI_V2_LeafGold", 0.14), ("MI_V2_LeafCopper", 0.09), ("MI_V2_LeafCream", 0.05)]
BARK = "MI_V2_Bark"

#: SIZED BY WHAT A FOREST HAS TO LOOK LIKE, THEN CAPPED BY WHAT THE FRAME RATE ALLOWS.
#: The first cut of this pass put 300 trees across 180 degrees of belt from 1,220 to 1,620 m. That is
#: 1.78 km2 -- one tree per 5,950 m2 -- and the capture showed exactly what that number predicts: an orchard,
#: not woodland. A forest reads as a forest at roughly one tree per 150-400 m2, which over that belt would
#: have been 4,500-12,000 trees. At 21-37 k triangles a tree with NO LODs (ledger row I), that is 100-400 M
#: triangles on top of a world already at 114.6 M and 3.5 fps. Unaffordable, and not by a small margin.
#: So Dubel becomes a PLACE rather than a belt: a 60-degree wood 250 m deep, dense enough to be a forest
#: where a player actually stands. Full woodland across the whole outer ring is gated on vegetation LODs.
R_IN, R_OUT = 123000.0, 148000.0          # cm: 1,230 m to 1,480 m
ARC_LO, ARC_HI = 58.0, 122.0              # 64 degrees, centred on the Icarus approach the arrival faces
TREE_TARGET = 620
CULL_TREE = 90000.0
CULL_SMALL = 35000.0

CLEARINGS = [(0.0, 137000.0, 4200.0), (-33000.0, 128000.0, 3000.0), (34000.0, 127000.0, 3000.0),
             (-18000.0, 143000.0, 2400.0), (19000.0, 142000.0, 2400.0)]
LANDMARKS = [(0.0, 137000.0, "SM_mushroom_landmark", 2.2), (-33000.0, 128000.0, "SM_mushroom_giant", 1.45),
             (34000.0, 127000.0, "SM_mushroom_giant", 1.45)]


def bearing(x, y):
    return math.degrees(math.atan2(y, x))


def in_arc(x, y):
    b = bearing(x, y)
    return ARC_LO <= b <= ARC_HI


def density_at(r):
    """1.0 in the heart of the belt, falling to 0 at both edges. No noise: a deterministic field is auditable."""
    mid = 0.5 * (R_IN + R_OUT)
    half = 0.5 * (R_OUT - R_IN)
    t = abs(r - mid) / half
    return max(0.0, 1.0 - t * t)


def path_points():
    """A way through the belt: an arc at mid-radius, drifting in and out so it is not a circle."""
    pts = []
    mid = 0.5 * (R_IN + R_OUT)
    steps = 96
    for i in range(steps + 1):
        b = ARC_LO + (ARC_HI - ARC_LO) * i / steps
        r = mid + 5200.0 * math.sin(math.radians(b * 2.3)) + 2100.0 * math.sin(math.radians(b * 5.7))
        pts.append((r * math.cos(math.radians(b)), r * math.sin(math.radians(b))))
    return pts


def dist_to_path(x, y, pts):
    return min(math.hypot(x - px, y - py) for px, py in pts)


def main():
    rng = random.Random(20260923)
    pts = path_points()
    batches, actors = {}, []

    def add(key, mesh, material, x, y, z, yaw, scale, cull, collides=False, shadow=True):
        b = batches.setdefault(key, {"id": "%s_%s" % (PASS, key), "mesh": mesh, "material": material,
                                     "instances": [], "collides": collides, "cast_shadow": shadow,
                                     "affect_df": False, "cull_distance": cull})
        b["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0, round(yaw % 360.0, 1), 0.0,
                               round(scale, 3), round(scale, 3), round(scale, 3)])

    def clear_of_clearings(x, y, pad=0.0):
        return all(math.hypot(x - cx, y - cy) > cr + pad for cx, cy, cr in CLEARINGS)

    # ---- the path itself, laid before anything can stand on it -------------------------------------------
    for i, (x, y) in enumerate(pts):
        if i % 2:
            continue
        nx, ny = pts[min(i + 2, len(pts) - 1)]
        yaw = math.degrees(math.atan2(ny - y, nx - x))
        add("Path", TERRAIN % ("SM_garden_lawn", "SM_garden_lawn"), "MI_V2_GroundFlag_PathWarm",
            x, y, 6.0, yaw, 0.055, CULL_SMALL, collides=False, shadow=False)

    # ---- trees ------------------------------------------------------------------------------------------
    placed = []
    tries = 0
    while len(placed) < TREE_TARGET and tries < TREE_TARGET * 60:
        tries += 1
        r = rng.uniform(R_IN, R_OUT)
        b = rng.uniform(ARC_LO, ARC_HI)
        x, y = r * math.cos(math.radians(b)), r * math.sin(math.radians(b))
        if rng.random() > density_at(r):
            continue
        if not clear_of_clearings(x, y, 400.0):
            continue
        if dist_to_path(x, y, pts) < 620.0:
            continue
        if any(math.hypot(x - px, y - py) < 620.0 for px, py, _ in placed):
            continue
        kind = KINDS[0] if rng.random() < KINDS[0][5] else KINDS[1]
        placed.append((x, y, kind))

    for x, y, kind in placed:
        trunk, th, canopy, dzr, csr, _ = kind
        s = rng.uniform(0.82, 1.38)
        yaw = rng.uniform(0.0, 360.0)
        leaf = rng.choices([m for m, _ in LEAF], weights=[w for _, w in LEAF])[0]
        add("Trunk", VEG % (trunk, trunk), BARK, x, y, 0.0, yaw, s, CULL_TREE, collides=True)
        add("Canopy_%s" % leaf.replace("MI_V2_", ""), VEG % (canopy, canopy), leaf,
            x, y, th * s * dzr, yaw, s * csr, CULL_TREE, collides=False)

    # ---- undergrowth: what makes it a forest floor rather than a lawn with trees on it -------------------
    for x, y, _ in placed:
        for _ in range(rng.randint(1, 4)):
            a = rng.uniform(0.0, 360.0)
            d = rng.uniform(260.0, 900.0)
            ux, uy = x + d * math.cos(math.radians(a)), y + d * math.sin(math.radians(a))
            if dist_to_path(ux, uy, pts) < 520.0 or not clear_of_clearings(ux, uy, 120.0):
                continue
            pick = rng.random()
            if pick < 0.42:
                add("Undergrowth_Shrub", SHRUB % ("SM_shrub_flowering", "SM_shrub_flowering"), "MI_V2_LeafDark",
                    ux, uy, 0.0, rng.uniform(0, 360), rng.uniform(0.55, 1.05), CULL_SMALL)
            elif pick < 0.72:
                add("Undergrowth_Cluster", FLOWER % ("SM_flower_cluster", "SM_flower_cluster"), "MI_V2_LeafMid",
                    ux, uy, 0.0, rng.uniform(0, 360), rng.uniform(0.6, 1.2), CULL_SMALL)
            else:
                add("Undergrowth_Mushroom", MUSH % ("Small", "SM_mushroom_small", "SM_mushroom_small"),
                    "MI_V2_RoofRose", ux, uy, 0.0, rng.uniform(0, 360), rng.uniform(0.45, 0.95), CULL_SMALL)

    # ---- clearing rims: a clearing reads as authored when its edge is planted ----------------------------
    for cx, cy, cr in CLEARINGS:
        n = max(8, int(2.0 * math.pi * cr / 900.0))
        for i in range(n):
            a = 360.0 * i / n + rng.uniform(-6.0, 6.0)
            rr = cr + rng.uniform(60.0, 420.0)
            ux, uy = cx + rr * math.cos(math.radians(a)), cy + rr * math.sin(math.radians(a))
            add("ClearingRim", SHRUB % ("SM_shrub_flowering", "SM_shrub_flowering"), "MI_V2_LeafMid",
                ux, uy, 0.0, rng.uniform(0, 360), rng.uniform(0.5, 0.9), CULL_SMALL)

    # ---- landmarks: silhouette from the nation bands -----------------------------------------------------
    for x, y, mesh, s in LANDMARKS:
        folder = "Landmark"   # both the giant and the landmark mushroom live in Mushrooms/Landmark
        add("Landmark", MUSH % (folder, mesh, mesh), "MI_V2_RoofRose", x, y, 0.0,
            math.degrees(math.atan2(y, x)) + 180.0, s, CULL_TREE, collides=True)

    inst = sum(len(b["instances"]) for b in batches.values())
    spec = {"pass": PASS, "title": "DF01: Dubel Forest, the wilderness belt beyond the three nations",
            "tags": ["DF01", "WL_DUBEL", "WL_WILDERNESS"],
            "folder": "Wonderland/Authored/DF01_DubelForest",
            "actors": actors, "batches": list(batches.values())}
    (HERE / "df01_dubel_forest.json").write_text(json.dumps(spec, indent=1), encoding="utf-8")
    print("%s -> df01_dubel_forest.json" % PASS)
    print("  belt r %.0f..%.0f m over %.0f deg of arc" % (R_IN / 100, R_OUT / 100, ARC_HI - ARC_LO))
    print("  trees %d, batches %d, instances %d" % (len(placed), len(batches), inst))
    for k in sorted(batches, key=lambda k: -len(batches[k]["instances"]))[:8]:
        print("    %-30s %5d" % (k, len(batches[k]["instances"])))
    return spec


if __name__ == "__main__":
    main()
