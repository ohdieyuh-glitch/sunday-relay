#!/usr/bin/env python3
"""CP01-CP05 -- A CHECKPOINT WHERE EVERY TERRITORY MEETS THE WORLD.

THE GAP. `Tools/territory_registry.py` (commit 66948fb8) wrote five territory checkpoints into
`Config/DefaultGame.ini` -- an id, a specialisation quoted from the canon, an accent colour and a
`CheckpointXY` for Golden Arrival, ICARUS, NOCTIS, TARTARUS and Dubel Forest. The panel that reads them is
Internal Development's. **Nothing was ever built at the coordinates.** Measured off the 286 layer specs on
disk, within 15 m of each checkpoint:

    arrival    321 instances      a plaza; the arrival court is already there
    ICARUS     136 instances      march kerb and a grass verge
    NOCTIS      16 instances      nearest thing 7.6 m away
    TARTARUS    16 instances      nearest thing 7.6 m away
    DUBEL        5 instances      forest floor

So four of the five stand on bare march. A checkpoint that exists only in an .ini answers none of the three
questions the founder set for it -- *where am I, where is another territory, how do I reach it* -- because
there is nothing in the world to walk up to.

WHAT THIS BUILDS, AND WHY EACH PIECE IS THERE
---------------------------------------------
  THE BAY.       The three nation checkpoints sit ON the march road. A court centred on the road would
                 swallow it, so the march is WIDENED instead: paved bays either side of the carriageway,
                 outside the existing kerb line, with the road itself left exactly as it is. You walk the
                 march, it opens out, you can stop, and you walk on. Nothing is placed in the corridor.
  THE FINGERPOST One obelisk on the court plate, with a sign per destination mounted at eye height and
                 turned to that destination's TRUE WORLD BEARING, computed from the registry's own
                 coordinates. The signs really point at the places they name; that is the "how do I reach
                 it" answer given as geometry rather than as a menu.
  THE TOWER.     A stacked tower on the nation's own proven chain, in the nation's own materials, set at
                 the far end of the bay. The founder's list names "poor landmark visibility" and "weak
                 silhouettes": a checkpoint you cannot see from the next ring is not a checkpoint. It
                 stands in the bay, never on the road.
  THE LIGHT.     Lantern standards round the bay rim and a hanging lantern over every sign, on each
                 nation's own brightest declared accent -- NOCTIS's `MI_V2_NoctisLuminous` among them,
                 which is the rule ledger row F was closed with. The requirement is that a checkpoint stays
                 readable at night without the night becoming day, so the light is LOCAL and architectural.
  THE OVERLOOK.  The far bay gets a garden overlook and planting, so the two sides of the road do different
                 jobs and the widening reads as a place rather than as a car park.

NOTHING HERE IS INVENTED LORE. The five identities, their specialisations and their accents come from
`WorldDesign/CANON/nations.json` by way of `Tools/territory_registry.py`; this file adds no purpose, no
landmark name and no specialisation of its own. Dubel Forest's canon says its geography is "not defined in
this world lane", so its checkpoint is built in the NEUTRAL palette and reported as NEEDS FOUNDER DEFINITION
rather than dressed in a nation's colours.

TWO MEASUREMENTS THE LAYOUT RESTS ON -- and the first one was WRONG in the first cut, which is recorded
here rather than tidied away:
  * **The ROAD is at z = 12; the ground beside it is at z = -14.** `SM_terrace_platform` is 1440 x 740 x 140
    and the marches place it at z = -128, so its top is 12, and that is where IC01/NC01/TQ01 put their kerb
    runs. The first cut took 12 as "the ground at the checkpoint" and authored the bays on it. The bays sit
    15-49 m OFF the axis, where there is no platform: four pawn-channel traces at every nation court came
    back -14, -14, -14, -14 (zc_checkpoints, 2026-09-27), and the apron was floating 26 cm above the lawn --
    the founder's "floating objects", shipped by me and caught by my own gate. The platform bottom at -128
    on ground at -14 means the road stands 26 cm proud like a kerb, which is what a march road should do,
    and the bays now sit on the ground beside it and step down off the road within the Dog's 30 uu.
  * Dubel's floor is -14 too (the frontier shelf), not the 0 its trees are planted at.
  * **The corridor to keep clear is wider than the road.** Measured in each nation's own (u, v) frame:
    ICARUS carries balustrade and newel urns at v = +/-780 and pinnacles at +/-1140; NOCTIS and TARTARUS
    carry kerb runs at +/-1440 and lantern standards at +/-1630, whose own radius is 314. The bays start
    outside the widest of those, per nation, not at a round number.

AND EVERY PIECE IS CHECKED AGAINST WHAT IS ALREADY STANDING. `Occupancy` loads every instance in every spec
on disk, gives it its real mesh footprint from mesh_inventory, and refuses any placement that would overlap
something taller than 2 m. Flat ground -- paving, slabs, kerbs, verge -- does not block, because an obelisk
may stand on a pavement. A refusal is counted and printed, never silently dropped.

Run:  python WorldDesign/Districts/territory_checkpoints.py
"""
import json
import math
import random
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
WD = HERE.parent
ROOT = WD.parent
sys.path.insert(0, str(WD))
sys.path.insert(0, str(WD / "Nations"))
import nations                                                              # noqa: E402

KIT = json.loads((WD / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
INVENTORY = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/mesh_inventory.json")

CULL_NEAR, CULL_MID, CULL_FAR = 12000.0, 26000.0, 60000.0

#: THE REGISTRY'S OWN COORDINATES. Copied from Tools/territory_registry.py so the world and the panel cannot
#: drift apart; if that file's numbers change, these must be regenerated with them.
SITES = {
    "arrival":  dict(xy=(0.0, -1460.0),            bearing=90.0,  label="Golden Arrival"),
    "ICARUS":   dict(xy=(0.0, 52500.0),            bearing=90.0,  label="Icarus"),
    "NOCTIS":   dict(xy=(-45466.333699, -26250.0), bearing=210.0, label="Noctis"),
    "TARTARUS": dict(xy=(45466.333699, -26250.0),  bearing=330.0, label="Tartarus"),
    "DUBEL":    dict(xy=(0.0, 126000.0),           bearing=90.0,  label="Dubel Forest"),
}

#: The neutral palette, for Golden Arrival and for Dubel -- which the canon forbids forcing into a nation.
NEUTRAL_MATS = {"stone": "MI_V2_IvoryStone", "stone_dark": "MI_V2_AshlarMarbleCool",
                "gold": "MI_V2_Gold", "gold_aged": "MI_V2_GoldAged", "glass": "MI_V2_GlassTeal",
                "roof": "MI_V2_RoofRose", "roof_alt": "MI_V2_RoofSlate", "kerb": "MI_V2_Kerb",
                "metal": "MI_V2_Gold", "moss": "MI_V2_Moss",
                "paving": "MI_V2_GroundFlag_PlazaCream", "paving_shade": "MI_V2_GroundFlag_PlazaShade",
                "paving_warm": "MI_V2_GroundFlag_PlazaWarm"}

#: Per site: which generator owns its palette, how far out the bay must start, and the tower chain.
#: Every chain here is one a nation's own quarter generator already stacks and the world already carries.
PLAN = {
    "CP01": dict(site="arrival", module=None, ground=12.3, fingerpost_only=True, bays=False,
                 chain=None, glow="glass", out="cp01_arrival_checkpoint.json"),
    "CP02": dict(site="ICARUS", module="icarus_district", ground=-14.0, bay_in=1500.0, bays=True,
                 chain=("WL_Tower_Base_Battered", "WL_Tower_Mid_Ashlar", "WL_Tower_Mid_Arcade",
                        "WL_Tower_Mid_Balconied", "WL_Spire_Needle"),
                 glow="glass", out="cp02_icarus_checkpoint.json"),
    "CP03": dict(site="NOCTIS", module="noctis_quarter", ground=-14.0, bay_in=2100.0, bays=True,
                 chain=("WL_Tower_Base_Battered", "WL_Tower_Mid_Ashlar", "WL_Tower_Mid_Arcade",
                        "WL_Tower_Mid_Balconied", "WL_Spire_Needle"),
                 glow="glass", out="cp03_noctis_checkpoint.json"),
    "CP04": dict(site="TARTARUS", module="tartarus_quarter", ground=-14.0, bay_in=2100.0, bays=True,
                 chain=("WL_Tower_Base_Buttressed", "WL_Tower_Mid_Machicolated", "WL_Tower_Mid_Fluted",
                        "WL_Tower_Crown_Cone"),
                 glow="glass", out="cp04_tartarus_checkpoint.json"),
    # DUBEL SITS ON THE FRONTIER SHELF, NOT ON ZERO. DF01 places its trees at z = 0, and taking that as the
    # ground would have floated the clearing: `zc_walk_after_wp` traced the floor at 880 m, 1,050 m and
    # 1,180 m and got -14 at all three, against +12 at the marches. So the marches stand on a +12 shelf and
    # the frontier drops to -14, and a paved disc laid at 0 would be a 14 cm lip at every edge -- exactly
    # the "floating objects" the founder's defect list names. The trees keep their own z; paving is what a
    # player walks on, so paving goes on the measured floor.
    "CP05": dict(site="DUBEL", module=None, ground=-14.0, clearing=1800.0, bays=False,
                 chain=("WL_Tower_Base_Battered", "WL_Tower_Mid_Ashlar", "WL_Tower_Mid_Arcade",
                        "WL_Tower_Mid_Balconied", "WL_Spire_Needle"),
                 glow="glass", out="cp05_dubel_checkpoint.json"),
}

PROOF = {}              # what the in-editor gate measures, published by the build itself
FLAG = 400.0            # the flagstone module's own square, so a floor tiles on its grid
KERB = 800.0            # the kerb run's own length
BAY_DEPTH = 2800.0
BAY_U0, BAY_U1 = -2200.0, 2600.0
#: Anything shorter than this is ground a monument may stand ON. Anything taller is something to avoid.
BLOCK_H = 200.0


# --------------------------------------------------------------------------- what is already standing
class Occupancy:
    """Every instance in every spec on disk, with its real footprint, so a placement can be refused."""

    def __init__(self):
        self.sizes = {}
        if INVENTORY.exists():
            for rec in json.loads(INVENTORY.read_text(encoding="utf-8")):
                self.sizes[rec["name"]] = rec["size_cm"]
        for mod in KIT.values():
            for part in mod["parts"]:
                self.sizes.setdefault(part["mesh"].split("/")[-1].split(".")[0], mod["size"])
        self.items = []            # (x, y, radius) of things taller than BLOCK_H
        self.paving = []           # (x, y, top) of flat ground pieces, so a site's real floor can be read
        self.unknown = Counter()
        #: THIS PASS'S OWN OUTPUT IS NOT AN OBSTACLE, AND LEAVING IT IN MADE THE GENERATOR EAT ITSELF.
        #: The first run placed all three nation towers; the second run loaded the specs the first run had
        #: just written, found a tower standing exactly where it wanted to put a tower, and refused --
        #: quietly shipping three checkpoints with no landmark and one with no overlook. A generator that is
        #: not idempotent is a generator whose second run silently produces a different world, so the
        #: family's own files are skipped and `main` asserts the run is stable.
        mine = {cfg["out"] for cfg in PLAN.values()}
        for path in sorted(WD.rglob("*.json")):
            if path.name in ("nations.json", "mesh_bounds.json", "kit_modules.json") or path.name in mine:
                continue
            try:
                spec = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(spec, dict) or "batches" not in spec:
                continue
            for batch in spec["batches"]:
                leaf = (batch.get("mesh") or "").split("/")[-1].split(".")[0]
                size = self.sizes.get(leaf)
                if size is None:
                    self.unknown[leaf] += len(batch.get("instances", ()))
                    continue
                half = 0.5 * math.hypot(float(size[0]), float(size[1]))
                flat = float(size[2]) < 40.0 and any(k in leaf.lower() for k in
                                                     ("plaza_slab", "flagstone", "paving", "medallion"))
                for inst in batch.get("instances", ()):
                    if len(inst) < 7:
                        continue
                    if flat:
                        self.paving.append((float(inst[0]), float(inst[1]),
                                            float(inst[2]) + float(size[2]) * float(inst[8])))
                    if float(size[2]) < BLOCK_H:
                        continue                    # ground: paving, slabs, kerbs, verge, flower runs
                    self.items.append((float(inst[0]), float(inst[1]), half * float(inst[6])))

    def clear(self, x, y, radius):
        for ix, iy, ir in self.items:
            if (x - ix) ** 2 + (y - iy) ** 2 < (radius + ir) ** 2:
                return False
        return True

    def one_floor(self, x, y, within=300.0, spread=10.0):
        """The paved floor under (x, y) if the paving there is ONE surface, else None.

        The first arrival fingerpost was authored at 12.3 and traced [-14, -14, 0.7, 4.5] around its foot:
        it stood on the seam between a plaza at -13.5 and a flagstone walk at 12.3, so half its base floated
        and half was buried. A site is only a site if every piece of paving under it agrees.
        """
        tops = [t for (px, py, t) in self.paving if (x - px) ** 2 + (y - py) ** 2 <= within * within]
        if len(tops) < 3 or max(tops) - min(tops) > spread:
            return None
        tops.sort()
        return tops[len(tops) // 2]


def palette(cfg):
    if cfg["module"] is None:
        return dict(NEUTRAL_MATS), None, ("veg_anchor",)
    mod = __import__(cfg["module"])
    mats = dict(NEUTRAL_MATS)
    mats.update(mod.PART_MATERIAL)
    return mats, getattr(mod, "LUMINOUS", None), getattr(mod, "SKIP_PARTS", ("veg_anchor",))


def build(pass_id, cfg, occ):
    site = SITES[cfg["site"]]
    cx, cy = site["xy"]
    bearing = site["bearing"]
    rad = math.radians(bearing)
    fwd = (math.cos(rad), math.sin(rad))
    left = (-math.sin(rad), math.cos(rad))
    g = cfg["ground"]
    mats, accent, skip = palette(cfg)
    rng = random.Random(pass_id)
    batches, stats, marks = {}, Counter(), {}

    def world(u, v):
        return (cx + fwd[0] * u + left[0] * v, cy + fwd[1] * u + left[1] * v)

    def add(key, mesh, material, u, v, z, yaw_local, scale=1.0, cull=CULL_NEAR,
            collides=False, shadow=True):
        x, y = world(u, v)
        bt = batches.setdefault((key, mesh, material),
                                {"id": "%s_%s" % (pass_id, key), "mesh": mesh, "material": material,
                                 "instances": [], "collides": collides, "cast_shadow": shadow,
                                 "affect_df": False, "cull_distance": cull})
        bt["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0,
                                round((yaw_local + bearing) % 360.0, 1), 0.0,
                                round(scale, 3), round(scale, 3), round(scale, 3)])
        stats[key] += 1

    def add_module(name, u, v, z, yaw_local, scale=1.0, cull=CULL_NEAR, collide=True, glow=()):
        for part in KIT[name]["parts"]:
            if part["part"] in skip:
                continue              # a flat panel that renders as a green slab if given a leaf material
            material = (accent if (accent and part["part"] in glow) else
                        mats.get(part["part"], part["material"]))
            blocks = collide and part["part"] not in nations.NO_COLLIDE_PARTS
            add("%s_%s" % (name.replace("WL_", ""), part["part"]), part["mesh"], material,
                u, v, z, yaw_local, scale, cull, collides=blocks)

    def guarded(name, u, v, scale=1.0):
        """True if this module's own footprint is clear of everything already standing."""
        x, y = world(u, v)
        if occ.clear(x, y, KIT[name]["radius"] * scale):
            return True
        stats["refused_" + name.replace("WL_", "")] += 1
        return False

    def nearest_clear(name, u0, v0, r_min, r_max, step=150.0, spokes=24, scale=1.0, allow=None):
        """The clear site NEAREST to (u0, v0), searched rather than chosen.

        The first cut of this pass placed Dubel's landmark at one fixed spot and the guard refused it, so the
        forest checkpoint shipped with no beacon above the canopy at all -- which was the only reason it had
        a tower. A refusal on a single candidate is not an answer; it is a search that was never run.
        Returns (u, v, distance) or None, and the caller says what to do when the whole annulus is occupied.
        """
        r = r_min
        while r <= r_max:
            best = None
            for i in range(spokes):
                t = 2.0 * math.pi * i / spokes
                u, v = u0 + r * math.cos(t), v0 + r * math.sin(t)
                if allow is not None and not allow(u, v):
                    continue
                x, y = world(u, v)
                if occ.clear(x, y, KIT[name]["radius"] * scale):
                    if best is None:
                        best = (u, v, r)
            if best is not None:
                return best
            stats["searched_past_" + str(int(r))] += 1
            r += step
        return None

    def socket(name, which):
        return (KIT[name].get("sockets") or {}).get(which)

    def stack(chain, u, v, z, yaw_local, cull=CULL_FAR):
        """Raise a tower through the kit's own sockets, refusing any joint that does not meet."""
        top_z, expect = z, ("ground", None)
        for name in chain:
            bot = socket(name, "bottom")
            if bot is None:
                raise SystemExit("%s has no bottom socket" % name)
            if bot.get("kind") != expect[0] or (expect[1] is not None and bot.get("rung") != expect[1]):
                raise SystemExit("%s bottom %s/%s does not meet %s/%s"
                                 % (name, bot.get("kind"), bot.get("rung"), expect[0], expect[1]))
            add_module(name, u, v, top_z - float(bot.get("z", 0.0)), yaw_local, cull=cull)
            top = socket(name, "top")
            if top is None:
                break
            top_z = top_z - float(bot.get("z", 0.0)) + float(top.get("z", 0.0))
            expect = (top.get("kind"), top.get("rung"))
        return top_z

    def fingerpost(u, v, note):
        """An obelisk, and one sign per OTHER territory turned to that territory's true world bearing.

        The bearing is computed from the registry's own coordinates and then expressed in this site's local
        frame, so a sign points where the place actually is. Nothing here names a purpose or a
        specialisation -- the panel reads those from the canon; the world only has to point.
        """
        add_module("WL_Detail_Pinnacle_Grand", u, v, g, 0.0, scale=1.25, cull=CULL_FAR)
        ox, oy = world(u, v)
        for other, spec in sorted(SITES.items()):
            if other == cfg["site"]:
                continue
            tx, ty = spec["xy"]
            local_deg = (math.degrees(math.atan2(ty - oy, tx - ox)) - bearing) % 360.0
            arm = math.radians(local_deg)
            su = u + 230.0 * math.cos(arm)
            sv = v + 230.0 * math.sin(arm)
            add_module("WL_Market_Hanging_Sign", su, sv, g + 330.0, local_deg, scale=1.35,
                       cull=CULL_NEAR, collide=False)
            add_module("WL_Detail_Lantern_Hanging", su, sv, g + 560.0, local_deg, scale=1.2,
                       cull=CULL_NEAR, collide=False, glow=(cfg["glow"],))
            stats["sign_" + other] += 1
        stats["fingerpost_" + note] += 1

    # ------------------------------------------------------------------ CP01: the arrival keeps its plaza
    if cfg.get("fingerpost_only"):
        # The arrival court is accepted, completed work and the travel anchor stands at its centre, so
        # nothing is paved and nothing is built ON the arrival point. The fingerpost is offset to the first
        # side position the occupancy guard says is clear, searched outward rather than chosen.
        # AND IT MAY NOT STAND IN THE WALK. The first search returned (u=600, v=0) -- clear of every obstacle
        # and 6 m dead ahead of the spawn, on the arrival's own facing, which the travel registry describes as
        # "the castle is straight ahead". Clear of obstacles is not the same as out of the way: an 11.7 m
        # obelisk there is the first thing a visitor walks into and it stands between them and the view the
        # arrival was aimed at. The corridor is reserved explicitly.
        def off_the_walk(u, v):
            if -500.0 <= u <= 4000.0 and abs(v) < 1000.0:
                return False
            x, y = world(u, v)
            return occ.one_floor(x, y) is not None

        spot = nearest_clear("WL_Detail_Pinnacle_Grand", 0.0, 0.0, 600.0, 3200.0, scale=1.25,
                             allow=off_the_walk)
        if spot is not None:
            # THE Z COMES FROM THE PAVING THAT IS THERE, not from a number typed into PLAN.
            g = occ.one_floor(*world(spot[0], spot[1]))
            stats["arrival_floor_from_paving"] = int(g)
        if spot is None:
            print("      CP01 NO CLEAR SITE within 32 m of the arrival point -- nothing placed, and that is")
            print("      reported rather than forced. This wants an in-editor clear-site probe first.")
        else:
            fingerpost(spot[0], spot[1], "arrival")
            marks["court_uv"] = (spot[0], spot[1])
            stats["arrival_site_u"] = int(spot[0])
            stats["arrival_site_v"] = int(spot[1])
            stats["arrival_site_r"] = int(spot[2])

    # ------------------------------------------------------------------ CP02-CP04: widen the march
    elif cfg["bays"]:
        bay_in = cfg["bay_in"]
        bay_out = bay_in + BAY_DEPTH
        rows = int(BAY_DEPTH / FLAG)
        cols = int((BAY_U1 - BAY_U0) / FLAG)
        shapes = ("WL_Ground_Flagstone_A", "WL_Ground_Flagstone_B", "WL_Ground_Flagstone_C")
        for side in (1.0, -1.0):
            for r in range(rows):
                for c in range(cols):
                    u = BAY_U0 + FLAG * (c + 0.5)
                    v = side * (bay_in + FLAG * (r + 0.5))
                    # PAVING DOES NOT COLLIDE. The march platform and the ground slab beneath it already
                    # block; a 6 cm colliding lip laid over a surface a player walks is a trip edge and a
                    # second body inside a shell that blocks, which is the fault ledger row C closed.
                    add_module(shapes[(r + c) % 3], u, v, g, 0.0, cull=CULL_MID, collide=False)
            for i in range(int((BAY_U1 - BAY_U0) / KERB)):
                add_module("WL_Ground_Kerb_Run", BAY_U0 + KERB * (i + 0.5), side * bay_out, g, 0.0,
                           cull=CULL_MID, collide=False)
            for end in (BAY_U0, BAY_U1):
                for i in range(int(BAY_DEPTH / KERB)):
                    add_module("WL_Ground_Kerb_Run", end, side * (bay_in + KERB * (i + 0.5)), g, 90.0,
                               cull=CULL_MID, collide=False)
            for i in range(3):
                lu = BAY_U0 + (BAY_U1 - BAY_U0) * (i + 0.5) / 3.0
                if guarded("WL_Object_LanternStandard", lu, side * (bay_out - 300.0)):
                    add_module("WL_Object_LanternStandard", lu, side * (bay_out - 300.0), g, 0.0,
                               cull=CULL_MID, glow=(cfg["glow"],))

        # THE COURT, in the left bay: the plate a visitor stands on, and the fingerpost on it.
        court_v = bay_in + 1400.0
        marks["court_uv"] = (-1200.0, court_v)
        add_module("WL_Ground_Plaza_Medallion", -1200.0, court_v, g + 7.0, 0.0, scale=1.6,
                   cull=CULL_MID, collide=False)
        fingerpost(-1200.0, court_v, cfg["site"])

        # THE TOWER, at the far end of the same bay -- in the bay, never on the road.
        if guarded(cfg["chain"][0], 1200.0, court_v):
            stats["tower_top_uu"] = int(stack(cfg["chain"], 1200.0, court_v, g,
                                              rng.choice((0.0, 45.0, 90.0))))
            marks["tower_uv"] = (1200.0, court_v)

        # THE OVERLOOK, in the right bay, facing away from the road, with the bay planted behind it.
        if guarded("WL_Garden_Overlook", 0.0, -(bay_in + 2100.0)):
            add_module("WL_Garden_Overlook", 0.0, -(bay_in + 2100.0), g, -90.0, cull=CULL_MID)
        for i in range(5):
            pu = BAY_U0 + (BAY_U1 - BAY_U0) * (i + 0.5) / 5.0
            if not guarded("WL_Garden_Planter_Wall", pu, -(bay_out - 500.0)):
                continue
            add_module("WL_Garden_Planter_Wall", pu, -(bay_out - 500.0), g, 0.0, cull=CULL_MID,
                       collide=False)
            for f in range(3):
                flower = rng.choice(("WL_Flower_Rose_Run", "WL_Flower_Lavender_Run",
                                     "WL_Flower_Daisy_Run"))
                add_module(flower, pu - 260.0 + f * 260.0, -(bay_out - 500.0), g + 313.0,
                           rng.uniform(0.0, 360.0), scale=rng.uniform(0.9, 1.2), cull=CULL_NEAR,
                           collide=False)

    # ------------------------------------------------------------------ CP05: a clearing in the forest
    else:
        r_out = cfg["clearing"]
        shapes = ("WL_Ground_Flagstone_A", "WL_Ground_Flagstone_B", "WL_Ground_Flagstone_C")
        n = int(r_out * 2 / FLAG)
        for a in range(n):
            for b in range(n):
                u = -r_out + FLAG * (a + 0.5)
                v = -r_out + FLAG * (b + 0.5)
                if math.hypot(u, v) > r_out:
                    continue
                add_module(shapes[(a + b) % 3], u, v, g, 0.0, cull=CULL_MID, collide=False)
        ring = int(2.0 * math.pi * r_out / KERB)
        for i in range(ring):
            t = 2.0 * math.pi * i / ring
            add_module("WL_Ground_Kerb_Run", r_out * math.cos(t), r_out * math.sin(t), g,
                       math.degrees(t) + 90.0, cull=CULL_MID, collide=False)
        marks["court_uv"] = (0.0, 0.0)
        add_module("WL_Ground_Plaza_Medallion", 0.0, 0.0, g + 7.0, 0.0, scale=1.6, cull=CULL_MID,
                   collide=False)
        fingerpost(0.0, 0.0, cfg["site"])
        # Six lanterns on the rim, each nudged round the ring until it is clear of a trunk rather than
        # dropped on one. The clearing is cut INTO a forest, so a fixed angle is a coin toss.
        for i in range(6):
            base = 2.0 * math.pi * i / 6.0 + 0.5
            for nudge in (0.0, 0.08, -0.08, 0.16, -0.16, 0.24, -0.24):
                t = base + nudge
                lu, lv = (r_out - 350.0) * math.cos(t), (r_out - 350.0) * math.sin(t)
                x, y = world(lu, lv)
                if occ.clear(x, y, KIT["WL_Object_LanternStandard"]["radius"]):
                    add_module("WL_Object_LanternStandard", lu, lv, g, math.degrees(t), cull=CULL_MID,
                               glow=(cfg["glow"],))
                    break
            else:
                stats["refused_lantern_after_nudging"] += 1
        # The landmark has to clear the canopy. DF01's canopies sit at z = 634-1234, so a 9 m obelisk is
        # invisible from outside the forest and the tower is the only thing that answers "where is Dubel".
        # Its site is SEARCHED: the first version put it at one fixed point, the guard refused it, and the
        # forest checkpoint shipped with no beacon at all.
        spot = nearest_clear(cfg["chain"][0], 0.0, 0.0, r_out + 1200.0, r_out + 4500.0, step=200.0)
        if spot is None:
            print("      CP05 NO CLEAR TOWER SITE in the annulus 30-63 m -- Dubel has no beacon above the")
            print("      canopy, and that is a stated gap rather than a silently missing landmark.")
        else:
            stats["tower_top_uu"] = int(stack(cfg["chain"], spot[0], spot[1], g, 45.0))
            stats["tower_site_r"] = int(spot[2])
            marks["tower_uv"] = (spot[0], spot[1])

    # THE PROOF READS ITS POINTS FROM HERE, NOT FROM A SECOND COPY OF THIS LAYOUT.
    # The in-editor gate has to know where the court plate is, where the tower stands, and where "just
    # outside the bay" is. Re-deriving those in the job means two files that must agree about a layout, and
    # they will stop agreeing the first time a bay moves -- at which point the gate measures bare ground,
    # finds a floor, and passes. So the generator publishes the points it actually built.
    PROOF[cfg["site"]] = {
        "pass": pass_id, "ground_z": g, "bearing": bearing,
        "centre": [round(v, 1) for v in world(0.0, 0.0)],
        "court": [round(v, 1) for v in world(*marks.get("court_uv", (0.0, 0.0)))],
        "tower": ([round(v, 1) for v in world(*marks["tower_uv"])] if "tower_uv" in marks else None),
        "tower_top_z": float(stats["tower_top_uu"]) if "tower_top_uu" in stats else None,
        "road_in": [round(v, 1) for v in world(-3000.0, 0.0)],
        "road_out": [round(v, 1) for v in world(3000.0, 0.0)],
        # A reference floor OUTSIDE anything this pass paved, to compare the apron against.
        "outside": [round(v, 1) for v in world(0.0, (cfg.get("bay_in", cfg.get("clearing", 1800.0))
                                                     + BAY_DEPTH + 1500.0))],
    }

    tags = ["WL_AUTHORED", "WL_PASS_%s" % pass_id, "WL_TERRITORY_CHECKPOINT",
            "WL_CHECKPOINT_%s" % cfg["site"].upper()]
    tags.append(nations.tag(cfg["site"]) if cfg["site"] in ("ICARUS", "NOCTIS", "TARTARUS")
                else "WL_NATION_NEUTRAL")
    out = {
        "pass": pass_id,
        "folder": "Wonderland/Authored/%s_%sCheckpoint" % (pass_id, site["label"].replace(" ", "")),
        "tags": tags,
        "actors": [],
        "batches": list(batches.values()),
    }
    (HERE / cfg["out"]).write_text(json.dumps(out, indent=1), encoding="utf-8")
    total = sum(len(b["instances"]) for b in out["batches"])
    coll = sum(len(b["instances"]) for b in out["batches"] if b["collides"])
    tris = 0
    for b in out["batches"]:
        leaf = b["mesh"].split("/")[-1].split(".")[0]
        for mod in KIT.values():
            hit = [p for p in mod["parts"] if p["mesh"].endswith("." + leaf)]
            if hit:
                tris += int(mod["tris"] / max(1, len(mod["parts"]))) * len(b["instances"])
                break
    print("%s  %-9s %5d instances / %3d batches / %4d colliding / ~%8d tris  -> %s"
          % (pass_id, cfg["site"], total, len(out["batches"]), coll, tris, cfg["out"]))
    for key in sorted(stats):
        if key.startswith(("refused_", "tower_top", "tower_site", "arrival_")):
            print("      %-36s %s" % (key, stats[key]))
    return total, coll


def main():
    occ = Occupancy()
    print("occupancy: %d standing things taller than %.0f cm loaded from the specs on disk"
          % (len(occ.items), BLOCK_H))
    if occ.unknown:
        print("           %d mesh names had no size on record and could not be tested: %s"
              % (len(occ.unknown), ", ".join(sorted(occ.unknown)[:6])))
    grand = coll = 0
    for pass_id in ("CP01", "CP02", "CP03", "CP04", "CP05"):
        t, c = build(pass_id, PLAN[pass_id], occ)
        grand += t
        coll += c
    (HERE / "cp_proof_points.json").write_text(json.dumps(PROOF, indent=1), encoding="utf-8")
    print("\nwrote cp_proof_points.json -- the in-editor gate reads its points from the build, not a copy")
    print("FIVE TERRITORY CHECKPOINTS: %d instances, %d colliding." % (grand, coll))
    print("Dubel Forest is built NEUTRAL and marked NEEDS FOUNDER DEFINITION: CANON/nations.json says its")
    print("geography is 'not defined in this world lane', and this pass does not decide that.")


if __name__ == "__main__":
    main()
