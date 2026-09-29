#!/usr/bin/env python3
"""W270S / W270N / W270T -- THE REAR SEAM: where NOCTIS meets TARTARUS behind Golden Arrival.

FOUNDER DIRECTIVE (2026-09-28, "COMPLETE THE WONDERLAND WORLD"): stop polishing corners a camera shows; audit
the whole world and close the largest unfinished spaces first, in the Bible's language, never as random
clutter. Core's completion matrix (WORLD_COMPLETION_MATRIX.md, row R40) assigns this seam to the World lane.

WHAT THE AUDIT SAYS, measured rather than photographed. The census of the shipping map (zc_world_census,
179,135 placements, complete against every World Partition descriptor) run through Tools/world_audit/
emptiness.py puts the wedge 245..295 deg x 600..1,200 m at 47.1 ha with 36.2 ha -- 76.9% -- farther than 9 m
from anything. What does stand there is ~27 lone skyline towers on their own kerb rings, three frontier
planting patches (FR02/03/04) and distant-skyline glass. It is the thinnest wedge of the three nation seams.

WHAT CANON SAYS BELONGS HERE (CANON/NATIONS.md). Beyond 500 m the map is nation land and grows "outward from
the established core ... placed deliberately inside Icarus, Noctis or Tartarus instead of becoming generic
territory". Bearing 270 is the NOCTIS (150..270) / TARTARUS (270..390) line, which runs straight out behind the
arrival. So this is not one district but two nations meeting, and the meeting line is designed:

  W270S  THE SEAM WAY (neutral, Wonderland language) -- the 270 deg seam radial, a 28.8 m plate avenue from
         the core's edge to the frontier, kerbed, with flower verges and a topiary-and-lamp rhythm, and four
         places on it: the REAR GATE (a ceremonial arch), the MARCH CROSSING (clear plaza where Core's march
         ring meets it, ~560 m), the CLOCK CROSSING (a giant pocket watch on a medallion -- the Bible's
         timepieces, placed once, where the eye lands) and THE EXCHANGE (~1,000 m, clear plaza where Core's outer
         ring meets it, a pavilion at its heart). It ends at the FRONTIER GATE between one NOCTIS tower and one
         TARTARUS tower: the seam, stated in stone at the edge of the world.
  W270N  NOCTIS FLANK (west) and
  W270T  TARTARUS FLANK (east) -- each built from ITS OWN nation vocabulary, imported from nation_band.py so
         there is one definition of what a Noctis hall is. The structure is deliberately NOT the band skeleton
         (the founder: "do not make every band a copy of avenue + six towers + plaza + gate"): the seam way is
         the spine and each nation opens COURTS off it -- screening courts on the Noctis side, foundry courts on
         the Tartarus side -- walled by the nation's halls, closed by its signature hall, with its tower chains
         at the far corners and a GVE anchor named from the canon's unused spaces. Between the courts runs a
         street of the nation's own houses (Noctis studio terraces, Tartarus canopied foundries). Beyond the
         built frontage the flank becomes garden rooms and then groves that thin toward each nation's
         heartland, with CLEARINGS left on purpose -- empty ground that is designed has an edge and a reason.

WHAT THIS IS BUILT FROM, AND WHAT IT AVOIDS.
  * Only modules that already stand in the world (each checked against the census's own mesh list) and the
    tree/topiary/shrub meshes the world already grows. Nothing debuts here.
  * CLEARANCE AGAINST THE REAL WORLD: every building footprint, paving plate and plant is tested against the
    census inside the wedge (the lone towers, their kerb rings, hedges, the frontier patches). Something that
    would stand in something else is SKIPPED and counted, not placed.
  * Corridors for Core's rings are kept clear in both flanks at the two crossing plazas (+/- 12 m).
  * Trees are few and slender-first: SM_canopy_large is 31 k triangles with one LOD (dubel_forest.py).
  * Gates are yawed to be passable (WL_Gatehouse_Screen at yaw_local 0 was a wall across the Noctis road).
  * Lamp GEOMETRY only. Light comes from separate entries in the practical-lights pool; the approved night is
    untouched until a lamp pass is reviewed on its own.

ADDITIVE AND REMOVABLE: three passes, each tagged, each lifts out as a unit (apply_layer.py REMOVE_ONLY).

    python w270_rear_seam.py            (writes w270s_seam_way.json, w270n_noctis_flank.json,
                                          w270t_tartarus_flank.json, footprints, and w270_new_placements.csv.gz)
"""
import csv
import gzip
import json
import math
import random
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "Nations"))
import nations                                                  # noqa: E402
import nation_band as NB                                        # noqa: E402  the nations' own vocabularies

KIT = NB.KIT
PLATE = NB.PLATE
PAVING_TOP = NB.PAVING_TOP                                      # 12: every nation floor stands here
GROUND_Z = -14.0                                                # the frontier shelf (beta walk lands at 75)
CULL_NEAR, CULL_MID, CULL_FAR = NB.CULL_NEAR, NB.CULL_MID, NB.CULL_FAR
CENSUS = ROOT.parent / "Tools" / "captures" / "zc" / "census" / "world_census.csv.gz"

BEARING = 270.0
_R = math.radians(BEARING)
DIR = (math.cos(_R), math.sin(_R))                              # (0, -1): out along the seam
LEFT = (-math.sin(_R), math.cos(_R))                            # (+1, 0): +v is EAST, the Tartarus side
SEAM_HALF_DEG = 25.0                                            # the wedge is 245..295

U0 = 51140.0                                                    # one row past the core's edge: the first row
ROWS = 82                                                       # at 504 m clipped the 488 m hedge
U1 = U0 + PLATE["len_y"] * ROWS                                 # 82 x 740 -> ends at 1,118 m, short of FR03
WAY_HALF = PLATE["len_x"]                                       # two plate columns: 28.8 m
NODE_HALF = 2 * PLATE["len_x"]                                  # four at a node: 57.6 m
#: THE PLACES ON THE WAY, where the ground is actually clear. The census found a grove of hedge masses east of
#: the axis at 486-590 m and a tower compound at 600 m (v +20..+29) -- so the way begins as ONE column, on the
#: west side, until the march plaza -- and, deciding the whole shape, a near-continuous RING of existing
#: SM_hedge_mass pieces (11-20 m tall, 40-100 m long) around the city at r ~850-1,040 m, unbroken across this
#: wedge from v -520 to +344 m. No way can cross it until a gate is opened in it (Core's decision: it edits
#: existing V2 content). So the way is two passes that are each whole, and a third that is held:
#:   W270S  the inner way 511-830 m (rear gate, march plaza, courts, the CLOCK plaza as its terminus) and the
#:          outer way 1,040-1,118 m (the EXCHANGE on the outer ring, courts, the frontier gate);
#:   W270G  the way THROUGH the ring, 830-1,040 m, generated against the world as it will be once the two hedge
#:          pieces that cross the axis are moved apart. HELD: not to be applied before that edit.
#: MARCH at 645 m and EXCHANGE at 1,075 m are where rings CAN cross: a 57.6 x 59 m plaza is 32/32 clear at both,
#: while at 560 / 1,000 m the hedge grove and the ring block the ring arms (proposal sent to Core 2026-09-28).
NODES = {"MARCH": 64500.0, "CLOCK": 80000.0, "EXCHANGE": 107500.0}
NODE_ROWS = 8
RING_CLEAR = 1200.0                                             # half-width kept clear for Core's rings
INNER_END = 61500.0                                             # west column only, until the march plaza
WALL = (83000.0, 104000.0)                                      # the hedge ring: W270G's stretch
#: the two existing pieces that cross the axis inside WALL, which a hedge gate would move apart: census centres
#: (x, y) of V2Batch_hedge_mass at u 882.6 m v -19.2 m and u 938.0 m v +22.6 m
GATE_HEDGES = ((-1920.0, -88260.0), (2260.0, -93800.0))
COURTS = ((71500.0, WAY_HALF), (107500.0, NODE_HALF))           # (u, the court's inner edge)
STREET = (75000.0, 84000.0)


def way_columns(u, through_wall=False):
    """Which plate columns the way occupies at distance u. Inside WALL only W270G builds (through_wall)."""
    if WALL[0] <= u < WALL[1]:
        return (-1, 0) if through_wall else ()
    if u < INNER_END:
        return (-1,)
    if in_node(u):
        return (-2, -1, 0, 1)
    return (-1, 0)


V2 = "/Game/WonderlandV2/"
VEG = {
    "trunk_slender": V2 + "Vegetation/Trees/SM_tree_slender_trunk.SM_tree_slender_trunk",
    "trunk_mature": V2 + "Vegetation/Trees/SM_tree_mature_trunk.SM_tree_mature_trunk",
    "canopy_medium": V2 + "Vegetation/Trees/SM_canopy_medium.SM_canopy_medium",
    "canopy_large": V2 + "Vegetation/Trees/SM_canopy_large.SM_canopy_large",
    "shrub": V2 + "Vegetation/Shrubs/SM_shrub_flowering.SM_shrub_flowering",
    "hedge": V2 + "Vegetation/Shrubs/SM_hedge_block.SM_hedge_block",
    "rose": V2 + "Vegetation/Roses/SM_rose_bush.SM_rose_bush",
    "topiary_ball": V2 + "Vegetation/Topiary/SM_topiary_ball.SM_topiary_ball",
    "topiary_spiral": V2 + "Vegetation/Topiary/SM_topiary_spiral.SM_topiary_spiral",
    "topiary_cone": V2 + "Vegetation/Topiary/SM_topiary_cone_plain.SM_topiary_cone_plain",
    "waymarker": V2 + "Props/Garden/SM_waymarker_lamp.SM_waymarker_lamp",
}
#: (trunk, trunk height cm, canopy, canopy dz as a ratio of scaled trunk height, canopy scale ratio) --
#: dubel_forest.py's measured pairing, reused rather than re-measured.
TREES = {"slender": ("trunk_slender", 982.8, "canopy_medium", 0.77, 1.15),
         "mature": ("trunk_mature", 1567.3, "canopy_large", 0.67, 1.30)}

NEUTRAL = {"paving": "MI_V2_GroundFlag_PlazaWarm", "paving_shade": "MI_V2_GroundFlag_PlazaShade",
           "paving_warm": "MI_V2_GroundFlag_PlazaWarm", "kerb": "MI_V2_MarblePale", "moss": "MI_V2_Moss"}
FLANK_LEAVES = {"W270N": ("MI_V2_LeafDark", "MI_V2_LeafDark", "MI_V2_LeafMid", "MI_V2_PetalWhite"),
                "W270T": ("MI_V2_LeafCopper", "MI_V2_LeafGold", "MI_V2_LeafMid", "MI_V2_LeafDark")}


def world(u, v):
    return (DIR[0] * u + LEFT[0] * v, DIR[1] * u + LEFT[1] * v)


def edge_v(u):
    """How far across the wedge reaches at distance u (to the 245 / 295 lines), less a 6 m margin."""
    return u * math.tan(math.radians(SEAM_HALF_DEG)) - 600.0


# ---------------------------------------------------------------------------------------- the real world
class Occupancy:
    """ORIENTED RECTANGLES, in three layers, hashed.

    The first version used a circle of radius max(ex, ey) per object. It blocked the way outright at 883 m:
    an SM_hedge_mass whose LONG half-extent is 38.5 m became a 77 m disc, although a hedge is long and thin.
    The forge's walkable.py recorded the same lesson ("an elongated piece needs an ORIENTED RECTANGLE or the
    answer is about the model rather than the world"), so every footprint here is a rectangle with its yaw,
    tested by separating axes.

    Layers, because not everything excludes everything: EXISTING (the census) blocks all new work; SOLID (new
    buildings, trees, hedges) blocks new solids and plants; PAVED (new plates) keeps plants off the floor but
    does NOT block the halls and gates that are meant to stand on it -- the first run claimed each plate as an
    obstacle and then skipped 111 of the way's own plates, and the gates, against themselves."""
    CELL = 2000.0

    def __init__(self):
        # WAY is the seam way's own floor: nothing but the way's furniture may stand on it. PAVED is court
        # and lane floor, which the nations' halls are MEANT to stand on.
        self.layers = {"existing": {}, "solid": {}, "paved": {}, "way": {}}

    def _keys(self, x, y, r):
        c = self.CELL
        for i in range(int((x - r) // c), int((x + r) // c) + 1):
            for j in range(int((y - r) // c), int((y + r) // c) + 1):
                yield (i, j)

    def add(self, layer, x, y, hx, hy, yaw_deg, tag):
        rec = (x, y, hx, hy, yaw_deg, tag)
        for k in self._keys(x, y, math.hypot(hx, hy)):
            self.layers[layer].setdefault(k, []).append(rec)

    @staticmethod
    def _overlap(a, b, margin):
        """Separating-axis test for two oriented rectangles (x, y, hx, hy, yaw)."""
        ax, ay, ahx, ahy, ayaw = a[:5]
        bx, by, bhx, bhy, byaw = b[:5]
        ahx, ahy = ahx + margin, ahy + margin
        dx, dy = bx - ax, by - ay
        for yaw in (ayaw, byaw):
            c, s = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
            for (nx, ny) in ((c, s), (-s, c)):
                ra = ahx * abs(math.cos(math.radians(ayaw)) * nx + math.sin(math.radians(ayaw)) * ny) \
                    + ahy * abs(-math.sin(math.radians(ayaw)) * nx + math.cos(math.radians(ayaw)) * ny)
                rb = bhx * abs(math.cos(math.radians(byaw)) * nx + math.sin(math.radians(byaw)) * ny) \
                    + bhy * abs(-math.sin(math.radians(byaw)) * nx + math.cos(math.radians(byaw)) * ny)
                if abs(dx * nx + dy * ny) > ra + rb:
                    return False
        return True

    def hits(self, x, y, hx, hy, yaw_deg, margin, layers):
        me = (x, y, hx, hy, yaw_deg)
        reach = math.hypot(hx, hy) + margin
        for layer in layers:
            seen = set()
            for k in self._keys(x, y, reach + 4000.0):
                for rec in self.layers[layer].get(k, ()):
                    if id(rec) in seen:
                        continue
                    seen.add(id(rec))
                    if math.hypot(rec[0] - x, rec[1] - y) > reach + math.hypot(rec[2], rec[3]):
                        continue
                    if self._overlap(me, rec, margin):
                        return layer + ":" + rec[5]
        return None


def load_census(occ, exclude=()):
    """Everything standing inside the wedge (plus a margin), as oriented rectangles. SINK_UU trims and sky
    are not world; ground plates are the floor; flowers and grass are not obstacles to anything. `exclude`
    lists (x, y) centres of SM_hedge_mass pieces to leave out -- the world as it will be after a hedge gate."""
    n = 0
    with gzip.open(CENSUS, "rt", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["kind"] == "OTHER":
                continue
            x, y, z = float(r["x"]), float(r["y"]), float(r["z"])
            if z < -50000.0 or z > 6000.0:
                continue
            rad = math.hypot(x, y)
            b = math.degrees(math.atan2(y, x)) % 360.0
            if not (238.0 <= b <= 302.0 and 44000.0 <= rad <= 125000.0):
                continue
            ex, ey, ez = float(r["ex"]), float(r["ey"]), float(r["ez"])
            if max(ex, ey) > 5000.0 and ez < 300.0:
                continue
            if "Grass_Tuft" in r["mesh"]:
                continue
            # A CANOPY IS NOT SOLID; ITS TRUNK IS. Core's rule for the GF re-seat, and it is right: a 40 m
            # tree's leaves stand 10 m over the ground, and a floor or a hedge can run beneath them.
            if "canopy" in r["mesh"].lower():
                continue
            if r["mesh"] == "SM_hedge_mass" and any(math.hypot(x - ex_, y - ey_) < 200.0 for ex_, ey_ in exclude):
                continue
            # FLOOR ABUTS FLOOR. A plate already in the world (a nation band's, or this lane's own applied way)
            # keeps plants off like any paving, but must not refuse a new plate laid against it: W270G's end
            # rows were refused for touching W270S's applied rows by a 60 cm margin.
            if r["mesh"] == "SM_terrace_platform":
                occ.add("paved", x, y, max(ex, 20.0), max(ey, 20.0), float(r["yaw"]), r["owner"])
                n += 1
                continue
            occ.add("existing", x, y, max(ex, 20.0), max(ey, 20.0), float(r["yaw"]), r["owner"])
            n += 1
    return n


# ---------------------------------------------------------------------------------------- one pass
class Pass:
    def __init__(self, pass_id, tags, folder, mats, occ, rng_seed):
        self.id, self.tags, self.folder, self.mats, self.occ = pass_id, tags, folder, mats, occ
        self.rng = random.Random(rng_seed)
        self.batches, self.actors, self.footprints = {}, [], []
        self.stats, self.skipped = Counter(), Counter()
        self.skip_why = Counter()
        self.skip_at = []
        self.new_rows = []                                      # census-format rows for the emptiness re-run

    # -- raw instance, exactly nation_band.add's record format, batched PER 200 m WORLD TILE.
    #    World Partition pages by ACTOR BOUNDS, and one batch actor per mesh spanned up to 604 m of this wedge
    #    -- an actor that can never leave residency. The ledger's row H counts 753 such actors holding 44.5% of
    #    the world's instances and names the fix, "splitting them by tile at build time", so new work is born
    #    tiled.
    def add(self, key, mesh, material, u, v, z, yaw_local, scale=1.0, cull=CULL_NEAR, shadow=True,
            collides=False):
        x, y = world(u, v)
        tkey = "%s_t%d_%d" % (key, math.floor(x / 20000.0), math.floor(y / 20000.0))
        bt = self.batches.setdefault(tkey, {"id": "%s_%s" % (self.id, tkey), "mesh": mesh, "material": material,
                                            "instances": [], "collides": collides, "cast_shadow": shadow,
                                            "affect_df": False, "cull_distance": cull})
        sx, sy, sz = scale if isinstance(scale, tuple) else (scale, scale, scale)
        bt["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0,
                                round((yaw_local + BEARING) % 360.0, 1), 0.0,
                                round(sx, 3), round(sy, 3), round(sz, 3)])
        self.stats[key] += 1

    def _clear(self, name, u, v, hw, hd, yaw_local, margin, layers=("existing", "solid", "way")):
        x, y = world(u, v)
        hit = self.occ.hits(x, y, hw, hd, yaw_local + BEARING, margin, layers)
        if hit:
            self.skipped[name] += 1
            self.skip_why[hit[:60]] += 1
            self.skip_at.append((name, round(u / 100.0, 1), round(v / 100.0, 1), hit[:60]))
            return False
        return True

    def claim(self, u, v, hw, hd, yaw_local, tag, layer="solid"):
        x, y = world(u, v)
        self.occ.add(layer, x, y, hw, hd, yaw_local + BEARING, "%s:%s" % (self.id, tag))

    def add_module(self, name, u, v, z, yaw_local, scale=1.0, cull=CULL_NEAR, collide=True, record=False,
                   check=True, margin=150.0, mats=None, layer="solid", layers=("existing", "solid", "way")):
        sz = KIT[name]["size"]
        hw, hd = sz[0] * scale * 0.5, sz[1] * scale * 0.5
        if check and not self._clear(name, u, v, hw, hd, yaw_local, margin, layers):
            return False
        mats = self.mats if mats is None else mats
        for part in KIT[name]["parts"]:
            if part["part"] == "veg_anchor":
                continue
            mat = mats.get(part["part"], part["material"])
            blocks = collide and part["part"] not in nations.NO_COLLIDE_PARTS
            self.add("%s_%s" % (name.replace("WL_", ""), part["part"]), part["mesh"], mat, u, v, z, yaw_local,
                     scale, cull, collides=blocks)
        if check:
            self.claim(u, v, hw, hd, yaw_local, name, layer)
        if record:
            self.footprints.append({"module": name, "u": round(u, 1), "v": round(v, 1), "z": round(z, 1),
                                    "yaw": round(yaw_local, 2), "w": round(sz[0] * scale, 1),
                                    "d": round(sz[1] * scale, 1), "scale": round(scale, 3)})
        x, y = world(u, v)
        self.new_rows.append(("NEW", x, y, z, hw, hd, sz[2] * scale * 0.5, name, self.id))
        return True

    def plate(self, u, v, material, key, layer="paved"):
        hw, hd = PLATE["len_x"] * 0.5, PLATE["len_y"] * 0.5    # len_x across the way, len_y along it
        # a plate is tested against what ALREADY stands, never against this pass's own floor or buildings
        if not self._clear("plate_" + key, u, v, hd, hw, 0.0, 60.0, layers=("existing",)):
            return False
        # YAW 90, NOT 0. The plate's 1,440 side is its LOCAL X, and yaw 0 lays local X along u (the garden-room
        # hedges below say so, correctly). At yaw 0 -- as this was applied on 2026-09-28 -- every plate ran
        # 1,440 ALONG the way while the columns stood 1,440 apart ACROSS it: 7.4 m paving strips with 7 m of
        # lawn between them, and neighbouring rows overlapping by 7 m. The PIE proof (zzW15) found it: every
        # stand on the axis traced the lawn. The claim above was always the intended 1,440-across footprint.
        self.add(key, PLATE["mesh"], material, u, v, PAVING_TOP - PLATE["top_local"], 90.0, cull=CULL_FAR,
                 collides=True, shadow=False)
        self.claim(u, v, hd, hw, 0.0, "plate", layer=layer)
        x, y = world(u, v)
        self.new_rows.append(("NEW", x, y, PAVING_TOP, hd, hw, 10.0, "plate", self.id))
        return True

    def socket(self, name, which):
        return (KIT[name].get("sockets") or {}).get(which)

    def stack(self, chain, u, v, z, yaw_local, crown=None, mats=None):
        """nation_band.stack, plus a clearance test on the base footprint before the first stone is laid."""
        base = KIT[chain[0]]["size"]
        if not self._clear(chain[0], u, v, base[0] * 0.5, base[1] * 0.5, yaw_local, 300.0):
            return None
        top_z, expect = z, ("ground", None)
        for name in chain:
            bot = self.socket(name, "bottom")
            if bot is None or bot.get("kind") != expect[0] or (expect[1] is not None
                                                                  and bot.get("rung") != expect[1]):
                raise SystemExit("%s does not meet %s" % (name, expect))
            self.add_module(name, u, v, top_z - float(bot.get("z", 0.0)), yaw_local, cull=CULL_FAR,
                            record=True, check=False, mats=mats)
            top = self.socket(name, "top")
            if top is None:
                break
            top_z = top_z - float(bot.get("z", 0.0)) + float(top.get("z", 0.0))
            expect = (top.get("kind"), top.get("rung"))
        if crown:
            self.add_module(crown, u, v, top_z, 0.0, cull=CULL_FAR, collide=False, check=False, mats=mats)
        self.claim(u, v, base[0] * 0.5, base[1] * 0.5, yaw_local, chain[0])
        return top_z

    def anchor(self, gve, label, u, v):
        x, y = world(u, v)
        self.actors.append({"id": label, "mesh": KIT["WL_Ground_Plaza_Medallion"]["parts"][0]["mesh"],
                            "loc": [round(x, 1), round(y, 1), round(PAVING_TOP, 1)], "rot": [0.0, BEARING, 0.0],
                            "materials": [self.mats.get("paving", NEUTRAL["paving"])],
                            "scale": [0.25, 0.25, 0.02], "collision": "none", "cast_shadow": False,
                            "tags": self.tags + ["WL_GVE_" + gve.upper().replace(" ", "_").replace("/", "_")]})
        self.stats["anchor"] += 1

    def plant(self, kind, u, v, scale, leaf, yaw, margin=120.0, radius=None, rect=None,
              layers=("existing", "solid", "paved", "way")):
        """A tree, shrub, hedge or topiary, clear of what stands, of what these passes built, and of the floor.
        `rect` (half-x, half-y, in the plant's own frame) replaces the default square for elongated pieces;
        `layers` lets a planter that belongs ON a plaza stand on it."""
        r = radius if radius is not None else {"tree_slender": 450.0, "tree_mature": 650.0}.get(kind, 150.0)
        hx, hy = rect if rect is not None else (r, r)
        x, y = world(u, v)
        hit = self.occ.hits(x, y, hx, hy, yaw + BEARING, margin, layers)
        if hit:
            self.skipped[kind] += 1
            self.skip_why[hit[:60]] += 1
            return False
        if kind.startswith("tree_"):
            trunk, th, canopy, dzr, csr = TREES[kind[5:]]
            z = GROUND_Z - 20.0
            self.add("Trunk_" + kind[5:], VEG[trunk], "MI_V2_Bark", u, v, z, yaw, scale, CULL_MID, collides=True)
            self.add("Canopy_%s_%s" % (kind[5:], leaf.replace("MI_V2_", "")), VEG[canopy], leaf, u, v,
                     z + th * scale * dzr, yaw, scale * csr, CULL_MID, shadow=True)
        else:
            mesh = VEG[kind]
            mat = leaf if kind != "waymarker" else "MI_V2_GlassAmber"
            if kind == "rose":
                mat = "MI_V2_RosePink"
            self.add(kind.title().replace("_", ""), mesh, mat, u, v, GROUND_Z - 5.0, yaw, scale,
                     CULL_NEAR if kind in ("shrub", "rose", "hedge") else CULL_MID,
                     collides=kind in ("hedge", "topiary_cone", "topiary_spiral", "topiary_ball"))
        # a tree claims its TRUNK (and root flare), not its canopy: shrubs and roses belong under it, and the
        # canopy radius already kept tree from tree when this one was tested
        ch = 180.0 if kind.startswith("tree_") else None
        self.occ.add("solid", x, y, ch or hx, ch or hy, yaw + BEARING, "%s:%s" % (self.id, kind))
        self.new_rows.append(("NEW", x, y, GROUND_Z, hx, hy, 400.0, kind, self.id))
        return True

    def spec(self):
        return {"pass": self.id, "tags": self.tags, "folder": self.folder, "actors": self.actors,
                "batches": [b for b in self.batches.values() if b["instances"]]}


# ---------------------------------------------------------------------------------------- W270S the seam way
def in_node(u):
    return next((n for n, c in NODES.items() if abs(u - c) <= NODE_ROWS * 0.5 * PLATE["len_y"]), None)


def build_way(occ, through_wall=False):
    """W270S (the inner and outer way) or, with through_wall, W270G (the stretch through the hedge ring)."""
    pid = "W270G" if through_wall else "W270S"
    tags = ["WL_WEDGE_270", "WL_SEAM_NOCTIS_TARTARUS", "WL_SEAM_WAY"]
    if through_wall:
        tags.append("WL_HELD_UNTIL_HEDGE_GATE")
    p = Pass(pid, tags, "Wonderland/Authored/%s_%s" % (pid, "HedgeGate" if through_wall else "SeamWay"),
             dict(NEUTRAL), occ, pid)

    def cols(u):
        if through_wall and not (WALL[0] <= u < WALL[1]):
            return ()
        return way_columns(u, through_wall)

    def court_mouth(u):
        return any(abs(u - cu) <= 3100.0 for cu, _ in COURTS)

    def opening(u):
        return in_node(u) or court_mouth(u) or not cols(u)

    rows = [U0 + PLATE["len_y"] * (j + 0.5) for j in range(ROWS)]

    # 1. THE FLOOR: the west column past the hedge grove, the 28.8 m way, four columns at each crossing plaza
    for u in rows:
        for c in cols(u):
            v = (c + 0.5) * PLATE["len_x"]
            main = c in (-1, 0)
            p.plate(u, v, NEUTRAL["paving_warm"] if main else NEUTRAL["paving_shade"],
                    "Way" if main else "Plaza", layer="way")

    # 2. KERBS, VERGES AND FRINGE along whichever edges the way has, opened at plazas and court mouths
    def edges(u):
        cc = cols(u)
        return (min(cc) * PLATE["len_x"], (max(cc) + 1) * PLATE["len_x"])

    run = KIT["WL_Ground_Kerb_Run"]["size"][0]
    u = U0 + 400.0
    while u < U1 - 400.0:
        if not opening(u):
            lo, hi = edges(u)
            for (vv, side) in ((lo, -1.0), (hi, 1.0)):
                # yaw 0: the run's length is its local X, which yaw 0 lays ALONG the way (it was 90, which
                # stood every kerb run across the verge like a bench -- the same misreading as the plates)
                p.add_module("WL_Ground_Kerb_Run", u, vv + side * 160.0, PAVING_TOP, 0.0, cull=CULL_NEAR,
                             collide=False, margin=40.0, layer="paved", layers=("existing", "solid"))
        u += run
    flowers = ("WL_Flower_Rose_Run", "WL_Flower_Lavender_Run", "WL_Flower_Daisy_Run")
    frun = KIT["WL_Flower_Rose_Run"]["size"][0]
    u = U0 + 300.0
    while u < U1 - 300.0:
        if not opening(u):
            sp = flowers[(int((u - U0) // 1300.0)) % 3]
            lo, hi = edges(u)
            for (vv, side) in ((lo, -1.0), (hi, 1.0)):
                for dv in (520.0, 640.0):
                    p.add_module(sp, u, vv + side * dv, GROUND_Z + 2.0, 0.0, cull=CULL_NEAR, collide=False,
                                 check=False)
        u += frun
    topi = ("topiary_cone", "topiary_spiral", "topiary_cone", "topiary_ball")
    u, i = U0 + 1200.0, 0
    while u < U1 - 600.0:
        if not opening(u):
            lo, hi = edges(u)
            for (vv, side) in ((lo, -1.0), (hi, 1.0)):
                p.plant(topi[i % len(topi)], u, vv + side * 950.0, 1.0 + 0.1 * (i % 3), "MI_V2_LeafDark", 0.0,
                        margin=40.0, radius=120.0)
                if not opening(u + 1200.0):
                    p.plant("waymarker", u + 1200.0, vv + side * 950.0, 1.0, "", 0.0, margin=40.0, radius=60.0)
        u += 2400.0
        i += 1
    tuft = KIT["WL_Garden_Grass_Tuft"]["parts"][0]
    u = U0 + 200.0
    while u < U1:
        if cols(u) and not in_node(u):
            lo, hi = edges(u)
            for (vv, side) in ((lo, -1.0), (hi, 1.0)):
                p.add("Fringe", tuft["mesh"], "MI_V2_Moss", u + p.rng.uniform(-30, 30),
                      vv + side * (1150.0 + p.rng.uniform(0, 60)), GROUND_Z - 12.0, p.rng.uniform(0, 360),
                      scale=p.rng.uniform(0.8, 1.25), cull=4000.0, shadow=False)
        u += 115.0

    if through_wall:
        # THE HEDGE GATE: a ceremonial arch in the opening, rose arches where the passage begins and ends
        p.add_module("WL_Arch_Ceremonial", 91000.0, 0.0, PAVING_TOP, 90.0, cull=CULL_FAR, record=True,
                     layers=("existing", "solid"))
        for ug in (WALL[0] + 1500.0, WALL[1] - 1500.0):
            p.add_module("WL_Arch_Garden_Rose", ug, 0.0, PAVING_TOP, 90.0, scale=1.6, cull=CULL_MID, record=True,
                         layers=("existing", "solid"))
        return p

    # 3. THE PLACES ON THE WAY.
    #    REAR GATE, at the core's edge, centred on the west column the way begins as. Yaw 90 puts the arch's
    #    23 m width ACROSS the path, which is what makes it a gate rather than a wall along it.
    p.add_module("WL_Arch_Ceremonial", U0 + 900.0, -0.5 * PLATE["len_x"], PAVING_TOP, 90.0, cull=CULL_FAR,
                 record=True, layers=("existing", "solid"))
    p.add_module("WL_Object_LanternStandard", U0 + 900.0, -PLATE["len_x"] - 1500.0, GROUND_Z, 0.0,
                 cull=CULL_FAR, record=True)
    #    Each crossing plaza: a medallion at its heart, balustrade and a clipped spiral on its four CORNERS
    #    only, so the way (along u) and Core's ring (across v) both pass straight through.
    for name, uc in NODES.items():
        p.add_module("WL_Ground_Plaza_Medallion", uc, 0.0, PAVING_TOP + 1.0, 0.0, cull=CULL_NEAR,
                     collide=False, check=False)
        for su in (-1.0, 1.0):
            for sv in (-1.0, 1.0):
                p.add_module("WL_Detail_Balustrade_Run", uc + su * (NODE_ROWS * 0.5 * PLATE["len_y"] - 100.0),
                             sv * (WAY_HALF + 700.0), PAVING_TOP, 0.0, cull=CULL_NEAR, collide=True, margin=40.0,
                             layers=("existing", "solid"))
                p.plant("topiary_spiral", uc + su * (NODE_ROWS * 0.5 * PLATE["len_y"] - 500.0),
                        sv * (NODE_HALF - 400.0), 1.25, "MI_V2_LeafDark", 0.0, margin=40.0, radius=150.0,
                        layers=("existing", "solid"))
    #    CLOCK PLAZA -- the Bible's timepiece, once, where the eye lands, and the inner way's terminus until the
    #    hedge gate opens: a pocket watch 13 m tall on its medallion, a ring of clipped balls round it.
    uc = NODES["CLOCK"]
    p.add_module("WL_Object_PocketClock", uc, 0.0, PAVING_TOP + 2.0, 90.0, scale=3.2, cull=CULL_FAR,
                 record=True, check=False)
    for a in range(8):
        t = math.radians(22.5 + a * 45.0)
        p.plant("topiary_ball", uc + math.cos(t) * 700.0, math.sin(t) * 700.0, 1.1, "MI_V2_LeafMid", 0.0,
                margin=10.0, radius=90.0, layers=("existing", "solid"))
    #    THE EXCHANGE -- where the content nation and the software nation face each other across the outer
    #    ring: a pavilion at the plaza's heart, the way parting round it.
    p.add_module("WL_Palace_Pavilion", NODES["EXCHANGE"], 0.0, PAVING_TOP, 0.0, scale=0.8, cull=CULL_FAR,
                 record=True, check=False)
    #    FRONTIER GATE -- the screen yawed across the way's end. The nations' own towers at the Exchange courts'
    #    far corners say whose ground lies either side.
    p.add_module("WL_Gatehouse_Screen", U1 - 400.0, 0.0, PAVING_TOP, 90.0, cull=CULL_FAR, record=True,
                 layers=("existing", "solid"))
    return p


# ---------------------------------------------------------------------------------------- the two flanks
def build_flank(occ, pass_id, cfg_id, side, gve_names):
    cfg = NB.NATIONS[cfg_id]
    mats = cfg["materials"]
    nation = cfg["nation"]
    p = Pass(pass_id, ["WL_WEDGE_270", "WL_NATION_" + nation, "WL_DISTRICT_%s_SEAM" % nation],
             "Wonderland/Authored/%s_%sSeam" % (pass_id, nation.title()), dict(mats), occ, pass_id)
    # foliage follows the NATION (a pocket's pass ids are not W270's)
    leaves = FLANK_LEAVES.get(pass_id) or FLANK_LEAVES["W270N" if nation == "NOCTIS" else "W270T"]

    def ring_corridor(u):
        return any(abs(u - NODES[n]) <= RING_CLEAR for n in ("MARCH", "EXCHANGE"))

    # 1. THE COURTS, opening straight off the way (or off the Exchange plaza): five plate columns deep,
    #    eight rows along the way
    gi = 0
    for ci, (uc, inner) in enumerate(COURTS):
        rows = [uc + PLATE["len_y"] * (j - 3.5) for j in range(8)]
        for u in rows:
            for c in range(5):
                p.plate(u, side * (inner + PLATE["len_x"] * (c + 0.5)), mats["paving"], "Court")
        v_far = inner + 5 * PLATE["len_x"]
        # the nation's halls wall the court's two sides, their length running away from the way
        hl = KIT[cfg["hall"]]["size"][0]
        for su in (-1.0, 1.0):
            for k in range(3):
                p.add_module(cfg["hall"], uc + su * (4 * PLATE["len_y"] + 350.0),
                             side * (inner + 250.0 + 1150.0 + 2400.0 * k), PAVING_TOP, 90.0,
                             cull=CULL_MID, record=True, margin=60.0)
        # the signature hall closes the far end, its length along the way, facing the court
        p.add_module(cfg["signature"], uc, side * (v_far + KIT[cfg["signature"]]["size"][1] * 0.5 + 250.0),
                     PAVING_TOP, 0.0 if side > 0 else 180.0, cull=CULL_FAR, record=True)
        # tower chains at the court's far corners, crowned
        for k, su in enumerate((-1.0, 1.0)):
            p.stack(cfg["chains"][(ci + k) % len(cfg["chains"])], uc + su * 2400.0,
                    side * (v_far + 3000.0), PAVING_TOP, p.rng.choice((0.0, 45.0, 90.0)),
                    crown=cfg["crown"])
        # a GVE anchor named from the canon's still-unused spaces, and two lanterns at the court mouth
        if gi < len(gve_names):
            p.anchor(gve_names[gi], "%s_GVE_%02d" % (pass_id, gi), uc, side * (inner + 3600.0))
            gi += 1
        for su in (-1.0, 1.0):
            p.add_module("WL_Object_LanternStandard", uc + su * 2200.0, side * (inner + 900.0), PAVING_TOP,
                         0.0, cull=CULL_FAR, record=True, margin=40.0)

    # 2. THE STREET between the courts: a one-plate lane parallel to the way, the nation's houses on both sides
    lane_v = side * (WAY_HALF + 3700.0)               # the inner row clears the clock plaza's edge
    blk = cfg["block"]
    bw, bd = KIT[blk]["size"][0], KIT[blk]["size"][1]
    j = 0
    u = STREET[0]
    while u < STREET[1]:
        if not ring_corridor(u):
            p.plate(u, lane_v, mats["paving_shade"], "Lane")
        u += PLATE["len_y"]
    u = STREET[0] + bw * 0.6
    while u < STREET[1] - bw * 0.6:
        if not ring_corridor(u):
            for row in (-1.0, 1.0):
                vv = lane_v + row * (PLATE["len_x"] * 0.5 + bd * 0.5 + 60.0)
                p.add_module(blk, u, vv, PAVING_TOP if row < 0 else GROUND_Z,
                             90.0 if row * side > 0 else 270.0, cull=CULL_MID, record=True, margin=40.0)
        u += bw * 1.10
        j += 1

    # 3. GARDEN ROOMS beyond the frontage. A room is 30 m square, walled by the world's own hedge block
    #    (measured from the census: 6.06 x 1.42 m, 1.1 m high), five blocks a side with the middle block left
    #    out on the two sides that face along the way -- the doors -- topiary cones at the corners, four beds
    #    and a rose at the centre. Formal, full and structured, which is the Bible's garden and not a scatter.
    HEDGE = (303.0, 71.0)
    H = 1620.0                                              # corner blocks end at 1,527 < H - 71
    rooms_v0 = WAY_HALF + 5 * PLATE["len_x"] + 5600.0
    for uc in (60500.0, 73500.0, 82500.0, 95000.0, 107000.0):
        if ring_corridor(uc):
            continue
        for k in range(2):
            vc = side * (rooms_v0 + H + k * (2 * H + 1200.0))
            if abs(vc) + H > edge_v(uc):
                continue
            x, y = world(uc, vc)
            if occ.hits(x, y, H + 100.0, H + 100.0, BEARING, 0.0, ("existing", "solid", "paved", "way")):
                p.skipped["garden_room"] += 1
                continue
            for e in (-1224.0, -612.0, 0.0, 612.0, 1224.0):
                # the block's long axis is its local X: yaw 0 lays it along u, yaw 90 across
                for (du, dv, yaw) in ((e, -H, 0.0), (e, H, 0.0), (-H, e, 90.0), (H, e, 90.0)):
                    if e == 0.0 and dv == 0.0:
                        continue                                    # doors on the two sides facing along u
                    p.plant("hedge", uc + du, vc + dv, 1.0, "MI_V2_LeafMid", yaw, margin=0.0, rect=HEDGE)
            for (du, dv) in ((-H, -H), (-H, H), (H, -H), (H, H)):
                p.plant("topiary_cone", uc + du, vc + dv, 1.2, leaves[0], 0.0, margin=0.0, radius=90.0)
            for (du, dv) in ((-600.0, -600.0), (600.0, -600.0), (-600.0, 600.0), (600.0, 600.0)):
                for q in range(5):
                    sp = ("WL_Flower_Rose_Run", "WL_Flower_Lavender_Run", "WL_Flower_Daisy_Run")[(q + k) % 3]
                    p.add_module(sp, uc + du + (q - 2) * 130.0, vc + dv, GROUND_Z + 2.0, 0.0, cull=CULL_NEAR,
                                 collide=False, check=False)
            p.plant("rose", uc, vc, 1.3, "MI_V2_RosePink", 0.0, margin=0.0, radius=120.0)
            p.stats["garden_room"] += 1

    # 4. GROVES, MEADOWS AND A MUSHROOM WOOD beyond the garden rooms. The first version planted one tree per
    #    jittered grid point, and the plan view showed exactly what the founder forbade: an even scatter that
    #    reads as nobody's design. Designed ground is made of GROUPS with edges and the spaces between them:
    #    groves of six to eleven trees with a shrub-and-rose rim, flower-drift meadows between the groves, one
    #    mushroom wood per flank (the Bible's "mushroom woods", carried into both nations as the seam's
    #    Wonderland language), and a stepping-stone path from the nation's street out to that wood.
    belt_v0 = WAY_HALF + 5 * PLATE["len_x"] + 5600.0 + 2 * 3240.0 + 1500.0
    rng = p.rng
    groves = 0
    trees = 0
    u = 54000.0
    while u < 115000.0:
        vmax = edge_v(u)
        v = belt_v0 + rng.uniform(0.0, 2500.0)
        while v < vmax - 1500.0:
            depth = (v - belt_v0) / max(1.0, vmax - belt_v0)          # 0 near the frontage, 1 at the edge
            gu, gv = u + rng.uniform(-1500.0, 1500.0), side * v
            if not ring_corridor(gu) and math.hypot(gu, gv) < 116000.0:
                if rng.random() < 0.62 - 0.30 * depth:
                    # a GROVE: trees Poisson-placed inside a radius, understorey on its rim
                    gr = rng.uniform(1800.0, 2600.0)
                    n_tree = rng.randint(6, 11)
                    placed = 0
                    for _ in range(n_tree * 4):
                        if placed >= n_tree:
                            break
                        t, d = rng.uniform(0, math.tau), gr * math.sqrt(rng.random())
                        kind = "tree_slender" if rng.random() < 0.8 else "tree_mature"
                        if p.plant(kind, gu + math.cos(t) * d, gv + math.sin(t) * d, rng.uniform(0.85, 1.2),
                                   rng.choice(leaves), rng.uniform(0, 360), margin=60.0):
                            placed += 1
                    if placed >= 3:
                        groves += 1
                        trees += placed
                        for k in range(rng.randint(5, 9)):
                            t = rng.uniform(0, math.tau)
                            d = gr + rng.uniform(200.0, 700.0)
                            p.plant(rng.choice(("shrub", "shrub", "rose")), gu + math.cos(t) * d,
                                    gv + math.sin(t) * d, rng.uniform(0.8, 1.25), leaves[2], rng.uniform(0, 360),
                                    margin=0.0, radius=110.0)
                elif rng.random() < 0.55:
                    # a MEADOW DRIFT: a loose arc of flower runs, one species to a drift
                    sp = ("WL_Flower_Lavender_Run", "WL_Flower_Daisy_Run", "WL_Flower_Rose_Run")[rng.randint(0, 2)]
                    x0, y0 = world(gu, gv)
                    if not occ.hits(x0, y0, 900.0, 900.0, BEARING, 0.0, ("existing", "solid", "paved", "way")):
                        arc0 = rng.uniform(0, math.tau)
                        for q in range(rng.randint(8, 16)):
                            t = arc0 + q * 0.22
                            d = rng.uniform(300.0, 800.0)
                            p.add_module(sp, gu + math.cos(t) * d, gv + math.sin(t) * d, GROUND_Z + 2.0,
                                         math.degrees(t) + 90.0, cull=CULL_NEAR, collide=False, check=False)
                        p.stats["meadow_drift"] += 1
            v += rng.uniform(5500.0, 7500.0)
        u += rng.uniform(5500.0, 7000.0)
    p.stats["groves"] = groves

    # THE MUSHROOM WOOD: one per flank, a third of the way out toward the heartland, inside the hedge ring
    # caps follow the NATION, not the side: a Tartarus pocket has a west half too
    caps = ("MI_V2_MushPurple", "MI_V2_MushCream") if nation == "NOCTIS" else ("MI_V2_MushRed", "MI_V2_MushTerracotta")
    mu = 74000.0
    mv = side * min(edge_v(mu) - 6000.0, 26000.0)
    wood = 0
    for _ in range(60):
        if wood >= 16:
            break
        t, d = rng.uniform(0, math.tau), 3200.0 * math.sqrt(rng.random())
        name = rng.choice(("WL_Mushroom_Toadstool", "WL_Mushroom_Tall", "WL_Mushroom_Tall", "WL_Mushroom_Button"))
        sc = rng.uniform(1.2, 3.2) if name != "WL_Mushroom_Button" else rng.uniform(1.0, 1.8)
        mm = {"mush_cap": caps[wood % 2], "mush_gill": "MI_V2_MushCream", "mush_spot": "MI_V2_PetalWhite",
              "mush_stem": "MI_V2_MushStem"}
        if p.add_module(name, mu + math.cos(t) * d, mv + math.sin(t) * d, GROUND_Z, rng.uniform(0, 360),
                        scale=sc, cull=CULL_MID, record=True, margin=150.0, mats=mm,
                        layers=("existing", "solid", "paved", "way")):
            wood += 1
    for _ in range(10):
        t, d = rng.uniform(0, math.tau), rng.uniform(2600.0, 4200.0)
        p.plant("tree_slender", mu + math.cos(t) * d, mv + math.sin(t) * d, rng.uniform(0.9, 1.15),
                leaves[0], rng.uniform(0, 360), margin=60.0)
    p.stats["mushrooms"] = wood

    # THE PATH out to it: stepping flags every 4.5 m from the street's outer row to the wood's edge
    flag = ("WL_Ground_Flagstone_A", "WL_Ground_Flagstone_B", "WL_Ground_Flagstone_C")
    start_v = abs(lane_v) + PLATE["len_x"] * 0.5 + 1500.0
    end_v = abs(mv) - 3600.0
    vv, k = start_v, 0
    while vv < end_v:
        p.add_module(flag[k % 3], mu + math.sin(vv / 900.0) * 250.0, side * vv, GROUND_Z + 1.0,
                     rng.uniform(-8.0, 8.0), scale=0.55, cull=CULL_NEAR, collide=False, margin=10.0,
                     layer="paved", layers=("existing", "solid", "way"))
        vv += 450.0
        k += 1
    p.stats["trees"] = trees
    return p


# ---------------------------------------------------------------------------------------- run
def main():
    # A GENERATOR MUST NOT REGENERATE ITSELF FROM A WORLD THAT ALREADY CONTAINS IT. Once W270S/N/T are applied
    # the census holds them, every piece would collide with its own applied copy, and the committed specs would
    # be overwritten with near-empty ones -- which is what nearly happened on 2026-09-28 (a syntax error saved
    # it). Run against the census taken BEFORE the apply, or use --gate-only.
    census = Path(sys.argv[sys.argv.index("--census") + 1]) if "--census" in sys.argv else CENSUS
    with gzip.open(census, "rt", encoding="utf-8") as f:
        if any(",W270S_" in line or ",W270N_" in line or ",W270T_" in line for line in f):
            raise SystemExit("REFUSED: %s already contains W270S/N/T. Pass --census <the pre-apply census> "
                             "(captures/zc/census/world_census_before_w270.csv.gz)." % census)
    globals()["CENSUS"] = census
    occ = Occupancy()
    existing = load_census(occ)
    canon = {n["id"]: n.get("gve_spaces", []) for n in NB.CANON["nations"]}
    way = build_way(occ)
    nox = build_flank(occ, "W270N", "NC03", -1.0, canon["NOCTIS"][6:])
    tar = build_flank(occ, "W270T", "TQ03", 1.0, canon["TARTARUS"][6:])
    # W270G sees the world AFTER a hedge gate: the census without the two pieces that cross the axis, plus
    # everything the other three passes place (so it cannot land on them either)
    occ_gate = Occupancy()
    load_census(occ_gate, exclude=GATE_HEDGES)
    for layer in ("solid", "paved", "way"):
        occ_gate.layers[layer] = occ.layers[layer]
    gate = build_way(occ_gate, through_wall=True)

    rows = []
    for p, out in ((way, "w270s_seam_way.json"), (nox, "w270n_noctis_flank.json"),
                   (tar, "w270t_tartarus_flank.json"), (gate, "w270g_hedge_gate_HELD.json")):
        spec = p.spec()
        (HERE / out).write_text(json.dumps(spec, indent=1), encoding="utf-8")
        (HERE / out.replace(".json", "_footprints.json")).write_text(json.dumps(p.footprints, indent=1),
                                                                      encoding="utf-8")
        total = sum(len(b["instances"]) for b in spec["batches"])
        coll = sum(len(b["instances"]) for b in spec["batches"] if b["collides"])
        print("%s -> %s   batches %d  instances %d (%d collide)  actors %d  footprints %d"
              % (p.id, out, len(spec["batches"]), total, coll, len(spec["actors"]), len(p.footprints)))
        print("   placed:  " + ", ".join("%s %d" % kv for kv in p.stats.most_common(10)))
        if p.skipped:
            print("   SKIPPED for clearance: " + ", ".join("%s %d" % kv for kv in p.skipped.most_common(10)))
            print("   ...against: " + ", ".join("%s %d" % kv for kv in p.skip_why.most_common(6)))
        rows += p.new_rows
    with gzip.open(HERE / "w270_new_placements.csv.gz", "wt", encoding="utf-8", newline="") as f:
        f.write("kind,x,y,z,ex,ey,ez,yaw,mesh,owner\n")
        for (k, x, y, z, ex, ey, ez, mesh, owner) in rows:
            f.write("%s,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,0,%s,%s\n" % (k, x, y, z, ex, ey, ez, mesh, owner))
    print("existing placements considered for clearance: %d; new footprint rows: %d" % (existing, len(rows)))
    # which nation does each flank actually land in? (a flank in the wrong sector is the wrong district)
    for label, v in (("W270N", -20000.0), ("W270T", 20000.0), ("W270S", 0.0)):
        x, y = world(85000.0, v)
        print("   %s at u=850 m v=%+.0f m lands in %s" % (label, v / 100, nations.zone_at(x, y)))


def gate_only():
    """W270G alone, against the world AS IT NOW STANDS -- for after the hedge gate has been moved.

    W270S/N/T are applied by then and sit in the census themselves, so regenerating them from it would make
    each collide with its own applied copy and skip everything. This rebuilds only the stretch through the
    ring, testing it against everything that is really there: the relocated hedges, the applied passes and
    the rest of the world. No exclusion list: the hedges are wherever the census says they now are."""
    occ = Occupancy()
    load_census(occ)
    gate = build_way(occ, through_wall=True)
    spec = gate.spec()
    out = "w270g_hedge_gate.json"
    (HERE / out).write_text(json.dumps(spec, indent=1), encoding="utf-8")
    (HERE / out.replace(".json", "_footprints.json")).write_text(json.dumps(gate.footprints, indent=1),
                                                                  encoding="utf-8")
    total = sum(len(b["instances"]) for b in spec["batches"])
    print("W270G (gate-only, post-move) -> %s   batches %d  instances %d" % (out, len(spec["batches"]), total))
    print("   placed:  " + ", ".join("%s %d" % kv for kv in gate.stats.most_common(10)))
    if gate.skipped:
        print("   SKIPPED: " + ", ".join("%s %d" % kv for kv in gate.skipped.most_common(10)))
        for s in gate.skip_at[:30]:
            print("     ", s)
    # THE TRAVERSAL QUESTION IS CONTINUITY, not a zero count: a row with one of its two plates refused is a
    # 14.4 m squeeze (the third hedge, 971-1,014 m, narrows the way like that), a row with none is a wall.
    placed_rows = {}
    for b in spec["batches"]:
        if "_Way_" not in b["id"]:
            continue
        for r in b["instances"]:
            placed_rows.setdefault(round(-r[1]), 0)
            placed_rows[round(-r[1])] += 1
    want = [round(U0 + PLATE["len_y"] * (j + 0.5)) for j in range(ROWS)
            if WALL[0] <= U0 + PLATE["len_y"] * (j + 0.5) < WALL[1]]
    closed = [u for u in want if placed_rows.get(u, 0) == 0]
    narrow = [u for u in want if placed_rows.get(u, 0) == 1]
    print("   rows through the ring: %d; OPEN %d, narrowed to one column %d, CLOSED %d%s"
          % (len(want), len(want) - len(closed), len(narrow), len(closed),
             "" if not closed else "  <- no passage at u(m) = %s" % [u // 100 for u in closed]))


if __name__ == "__main__":
    if "--gate-only" in sys.argv:
        gate_only()
    else:
        main()
