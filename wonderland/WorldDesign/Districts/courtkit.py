"""Shared vocabulary for district arrival courts (DC02 onward; DC01 carries its own copy of the first version).

A court is designed in the ARRIVAL FRAME: d = metres... in uu ahead of the anchor along the arrival yaw, lat = uu to
the visitor's right (UE is left-handed: +y is right of +x seen from above). Everything else is the Golden Arrival's
own language, measured there first: kerb-stone courses laid flush (GA07), plaza slabs in courses (GA04), flower beds,
lamps. A court is two files: a reversible TRIM of generator clutter (apply_vegetation_trim.py) and an authored LAYER
(apply_layer.py).
"""
import json
import math
import random

V2 = "/Game/WonderlandV2/"
MESH = {
    "kerb": V2 + "Ground/Cobblestone/SM_kerb_stone.SM_kerb_stone",
    "slab0": V2 + "Ground/Cobblestone/SM_plaza_slab_0.SM_plaza_slab_0",
    "slab3": V2 + "Ground/Cobblestone/SM_plaza_slab_3.SM_plaza_slab_3",
    "slab6": V2 + "Ground/Cobblestone/SM_plaza_slab_6.SM_plaza_slab_6",
    "ring_base": V2 + "Mushrooms/Landmark/SM_stone_ring_base.SM_stone_ring_base",
    "pedestal": V2 + "Props/Garden/SM_pedestal_finial.SM_pedestal_finial",
    "waymarker": V2 + "Props/Garden/SM_waymarker.SM_waymarker",
    "waymarker_lamp": V2 + "Props/Garden/SM_waymarker_lamp.SM_waymarker_lamp",
    "bed_base0": V2 + "Vegetation/Flowers/SM_flower_bed_base_0.SM_flower_bed_base_0",
    "bed_blooms0": V2 + "Vegetation/Flowers/SM_flower_bed_blooms_0.SM_flower_bed_blooms_0",
    "blossom": V2 + "Vegetation/Flowers/SM_blossom_cluster.SM_blossom_cluster",
    "lavender": V2 + "Vegetation/Flowers/SM_lavender_heads.SM_lavender_heads",
    "rose_bush": V2 + "Vegetation/Roses/SM_rose_bush.SM_rose_bush",
    "spiral": V2 + "Vegetation/Topiary/SM_topiary_spiral.SM_topiary_spiral",
}
SINK_UU = 100000.0
PAVING = ["MI_V2_PlazaCream"] * 5 + ["MI_V2_PlazaWarm"] * 3 + ["MI_V2_PlazaGrey"]


class Court(object):
    def __init__(self, pass_id, ax, ay, yaw, floor, seed):
        self.pass_id, self.ax, self.ay, self.yaw, self.floor = pass_id, ax, ay, yaw, floor
        self.actors, self.batches = [], {}
        self.rng = random.Random(seed)
        self.mesh = dict(MESH)

    # ---- the frame
    def at(self, d, lat):
        th = math.radians(self.yaw)
        return (self.ax + math.cos(th) * d - math.sin(th) * lat, self.ay + math.sin(th) * d + math.cos(th) * lat)

    # ---- placement
    def actor(self, id_, mesh, d, lat, z, materials, scale=1.0, yaw_local=0.0, collision="block"):
        x, y = self.at(d, lat)
        s = [scale] * 3 if isinstance(scale, (int, float)) else list(scale)
        self.actors.append({"id": id_, "mesh": self.mesh[mesh], "loc": [round(x, 2), round(y, 2), round(z, 2)],
                            "rot": [0.0, round(self.yaw + yaw_local, 2), 0.0], "scale": [round(v, 4) for v in s],
                            "materials": materials, "collision": collision})

    def inst_world(self, key, mesh, material, x, y, z, yaw, sx, sy, sz, collides=False, shadow=False):
        #: ONE BATCH IS ONE MESH AND ONE MATERIAL. This used to key on `key` alone and record mesh and
        #: material only when the batch was first created, so every later instance was appended to the
        #: first one whatever it was made of. pave_rect cycles three slab shapes and picks a tint per
        #: instance exactly as its docstring says, and all of it was discarded: 45 slab batches came out
        #: as 45 uniform patches, slab_0 ended up 87.9% of every plaza slab in the world, and the tints
        #: landed 67/28/4 against the 5:3:1 PAVING was weighted for. The variation was always being
        #: computed; it just had nowhere to live. GA02/03/04 do not use this path, which is why they mix.
        bkey = (key, mesh, material)
        b = self.batches.setdefault(bkey, {"id": "%s_%s_%s" % (key, mesh, material.replace("MI_V2_", "")),
                                           "mesh": self.mesh[mesh], "material": material, "instances": [],
                                           "collides": collides, "cast_shadow": shadow, "affect_df": False})
        b["instances"].append([round(x, 1), round(y, 1), round(z, 2), 0.0, round(yaw % 360.0, 1), 0.0,
                               round(sx, 3), round(sy, 3), round(sz, 3)])

    def inst(self, key, mesh, material, d, lat, z, yaw_local, sx, sy=None, sz=None, collides=False, shadow=False):
        x, y = self.at(d, lat)
        self.inst_world(key, mesh, material, x, y, z, self.yaw + yaw_local, sx, sx if sy is None else sy,
                        sx if sz is None else sz, collides, shadow)

    # ---- the Golden Arrival's courses
    def strip_along(self, key, material, lat, d0, d1, width, z, height=2.0):
        n = max(1, int(round((d1 - d0) / 118.0)))
        step = (d1 - d0) / n
        for i in range(n):
            self.inst(key, "kerb", material, d0 + step * (i + 0.5), lat, z, 0.0, step / 120.0 * 1.01, width / 36.2, height / 28.2)

    def strip_across(self, key, material, d, lat0, lat1, width, z, height=2.0):
        n = max(1, int(round((lat1 - lat0) / 118.0)))
        step = (lat1 - lat0) / n
        for i in range(n):
            self.inst(key, "kerb", material, d, lat0 + step * (i + 0.5), z, 90.0, step / 120.0 * 1.01, width / 36.2, height / 28.2)

    def ring(self, key, material, d, lat, radius, width, z, height=2.0, seg_len=38.0):
        cx, cy = self.at(d, lat)
        n = max(12, int(round(2.0 * math.pi * radius / seg_len)))
        for i in range(n):
            a = 2.0 * math.pi * (i + 0.5) / n
            chord = 2.0 * radius * math.sin(math.pi / n) * 1.04
            self.inst_world(key, "kerb", material, cx + radius * math.cos(a), cy + radius * math.sin(a), z,
                            math.degrees(a) + 90.0, chord / 120.0, width / 36.2, height / 28.2)

    def medallion(self, d, lat, radius, z):
        self.ring("MedallionGold", "MI_V2_Gold", d, lat, radius, 16.0, z, 2.2)
        for rr in (radius - 26.0, radius - 44.0, radius - 62.0):
            self.ring("MedallionRose", "MI_V2_RoofRose", d, lat, rr, 19.0, z, 1.8)
        self.ring("MedallionGold", "MI_V2_Gold", d, lat, radius * 0.55, 12.0, z, 2.2)
        self.ring("MedallionGold", "MI_V2_Gold", d, lat, radius * 0.16, 10.0, z, 2.4, seg_len=20.0)

    def pave_rect(self, key, d0, d1, lat0, lat1, z, skip=None):
        """Plaza slabs in courses (GA04): 128 uu cells, three slab shapes, cream/warm/grey. Slabs collide (13 cm)."""
        slabs = ["slab0", "slab3", "slab6"]
        rows = int(round((d1 - d0) / 128.0))
        cols = int(round((lat1 - lat0) / 128.0))
        for r in range(rows):
            for c in range(cols):
                d = d0 + 128.0 * (r + 0.5)
                lat = lat0 + 128.0 * (c + 0.5)
                if skip and skip(d, lat):
                    continue
                # Slabs are ~129 x 123 uu with bevelled edges: on a 128 uu grid the lawn showed through as lines between the
                # columns (DC02a, and still at 1.04 in DC02b). At 1.09 they overlap by ~6 uu; alternate columns sit 0.4 uu
                # apart in height so the overlapping top faces never share a plane.
                self.inst(key, slabs[(r + c) % 3], self.rng.choice(PAVING), d, lat, z + 0.5 + 0.4 * (c % 2),
                          self.rng.choice([0.0, 180.0]), 1.0, 1.09, 0.985, collides=True)

    def pave_disc(self, key, d, lat, r_in, r_out, z):
        cx, cy = self.at(d, lat)
        slabs = ["slab0", "slab3", "slab6"]
        radius, course = r_in + 64.0, 0
        while radius <= r_out - 40.0:
            count = max(1, int(round(2.0 * math.pi * radius / 132.0)))     # radius 0: one slab at the centre
            for k in range(count):
                ang = 360.0 * (k + 0.5 * (course % 2)) / count
                self.inst_world(key, slabs[(k + course) % 3], self.rng.choice(PAVING), cx + radius * math.cos(math.radians(ang)),
                                cy + radius * math.sin(math.radians(ang)), z + 0.5, ang, 0.985, 0.985, 0.985, collides=True)
            radius += 128.0
            course += 1

    def lamp_pair(self, tag, d, lat, z, scale=0.42):
        for side, s in ((1.0, "R"), (-1.0, "L")):
            self.actor("LampPost%s%s" % (tag, s), "waymarker", d, side * lat, z, ["MI_V2_IvoryStone"], scale)
            self.actor("Lamp%s%s" % (tag, s), "waymarker_lamp", d, side * lat, z, ["MI_V2_GlassAmber"], scale, collision="none")

    def flower_bed(self, key, d, lat, z, material, yaw_local=90.0):
        self.inst(key + "Base", "bed_base0", "MI_V2_Soil", d, lat, z, yaw_local, 1.0)
        self.inst(key + "Blooms_" + material[-6:], "bed_blooms0", material, d, lat, z, yaw_local, 1.0, shadow=True)

    def layer(self, title, tags=("V2_Districts",)):
        return {"pass": self.pass_id, "title": title, "folder": "Wonderland/Authored/%s" % self.pass_id, "tags": list(tags),
                "actors": self.actors, "batches": list(self.batches.values())}


def trim_spec(pass_id, title, census_rows, picks):
    """picks: [(object name, index or None for an actor, why)]. Instances are sunk SINK_UU with their exact before."""
    by_key = {(r["name"], r.get("index")): r for r in census_rows}
    trims = []
    for name, index, why in picks:
        row = by_key[(name, index)]
        before = row["transform"]
        after = list(before)
        after[2] = round(before[2] - SINK_UU, 3)
        trims.append({"name": name, "label": row["label"], "mesh": row["mesh"], "index": index, "why": why,
                      "before": before, "after": after})
    return {"pass": pass_id + "_TRIM", "title": title, "trims": trims}


def write(path, spec):
    path.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
