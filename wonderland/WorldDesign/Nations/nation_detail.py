#!/usr/bin/env python3
"""NC02 and TR02 -- WINDOWS, CORNICES AND WALL LIGHT for Noctis and Tartarus.

FOUNDER DIRECTIVE (2026-09-22): "cornices", "window recesses", "architectural detail". IC02 gave the Icarus
district arched windows and wall lanterns on its great halls, and the difference between a 25 m wall with
openings and a 25 m wall without them is the difference between a building and a crate. Noctis and Tartarus got
their ground, their plinth courses and their skylines in NC01 and TR01, and then stopped: a census of the three
nations' emitted batches shows Icarus carrying Detail_Window_Arched, Detail_Wall_Lantern, verges, drains and tree
grates, and the other two carrying none of them. That is the largest architectural gap left in the built world,
and it is in two thirds of it.

ADDITIVE, NOT A REWRITE. NC01 and TR01 are applied, walked and proven; re-emitting them to add detail would mean
removing and replacing 4,048 instances, and the last time a proven pass was re-applied to add something it came
back with its collision silently changed. So this is its own layer with its own tag, applied on top and removable
on its own.

WHERE THE BUILDINGS ARE. Not guessed from the emitted instance list -- recovering a footprint from a pile of part
transforms is exactly the kind of lossy inference this project has been bitten by. Each quarter script now writes
its own `footprints` out alongside its spec (`nc01_footprints.json`, `tr01_footprints.json`): the module, its
position in that nation's rotated local frame, its yaw and its true size. Both quarters are deterministic --
regenerating them after adding that one write produced byte-identical specs -- so the sidecar costs nothing.

WHAT GOES ON A WALL, AND WHAT DOES NOT. Only faces long enough to carry an opening with masonry either side
(5.2 m) and only on modules that actually present a blank plane: palaces, colonnades, gatehouse screens and
storefront corners. Houses
already carry their own openings in the kit; putting more on them would be detail on top of detail. Row heights
come from each module's own DECLARED WALL TOP -- its eaves or deck socket -- not from its bounding box,
which on a domed palace is mostly dome.

    python nation_detail.py        (writes nc02_noctis_detail.json and tq02_tartarus_detail.json)
"""
import json
import math
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import noctis_quarter as NOCTIS        # noqa: E402
import tartarus_quarter as TARTARUS    # noqa: E402

KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]

#: Modules that present a blank wall worth opening up. Houses are excluded on purpose: the kit already gives them
#: their own windows, and a second set would be detail arguing with detail.
WALLED = ("WL_Palace_", "WL_Colonnade_", "WL_Gatehouse_", "WL_Market_Corner_")
#: A face must be able to hold at least one 2.21 m opening with masonry either side. 9 m was the first
#: guess and it left Tartarus with three detailed buildings out of fifty-seven: its quarter is made of
#: market corners and works blocks, not palaces, so the threshold has to admit a 5.8 m storefront face.
MIN_FACE = 520.0
WINDOW_PITCH = 560.0                    # how far apart openings sit along a wall
CORNICE_RUN = 300.0                     # a cornice block is stretched to this, so the course reads continuous
CULL_NEAR, CULL_MID = 12000.0, 26000.0

NATIONS = {
    "NC02": dict(mod=NOCTIS, source="nc01_footprints.json", out="nc02_noctis_detail.json",
                 folder="Wonderland/Authored/NC02_NoctisDetail",
                 tags=["WL_NATION_NOCTIS", "WL_QUARTER_NOCTIS_FIRST", "WL_NATION_DETAIL"]),
    # TQ02 for the same reason its quarter is TQ01: the TR prefix belongs to the Golden Arrival treads.
    "TQ02": dict(mod=TARTARUS, source="tq01_footprints.json", out="tq02_tartarus_detail.json",
                 folder="Wonderland/Authored/TQ02_TartarusDetail",
                 tags=["WL_NATION_TARTARUS", "WL_QUARTER_TARTARUS_FIRST", "WL_NATION_DETAIL"]),
}


def wall_top(module, height):
    """Where this module's WALL ends -- which is not where its bounding box ends.

    This is BC01's lesson in a new place. WL_Palace_Wing stands 19.28 m tall and its eaves socket says the wall
    stops at 12.40 m; the rest is roof. A cornice at 94% of the bounding height would have floated 5.7 m above
    the masonry it was supposed to finish, and the top window register would have been a hole in the sky. A
    bounding box is not a wall, and the kit already says so if you ask it.

    Returns (z, source). When no socket declares an eaves or deck line, the wall top is ASSUMED at 45% of the
    bounding height -- deliberately low. At 45% of a dome, a string course runs around the drum, which is
    architecturally ordinary and, more to the point, certainly on the building. Guessing high is what puts
    mouldings in mid-air.
    """
    sockets = KIT[module].get("sockets") or {}
    for key in ("eaves", "parapet", "deck"):
        s = sockets.get(key)
        if isinstance(s, dict) and s.get("z"):
            return float(s["z"]), key
    return height * 0.45, "assumed"


def registers(top, source):
    """Which rows of openings a wall carries, as (fraction of the WALL TOP, module).

    One row of arched windows always. A lancet pair above them once the wall is tall enough for two storeys, and
    an oculus near the head of a really tall one -- but ONLY where the kit actually declared where the wall ends.
    On an assumed wall top this stops at the single lowest register, because the one thing worse than a plain
    wall is a window opening onto a roof.
    """
    rows = [(0.32, "WL_Detail_Window_Arched")]
    if source == "assumed":
        return rows
    if top >= 900.0:
        rows.append((0.66, "WL_Detail_Window_LancetPair"))
    if top >= 1600.0:
        rows.append((0.88, "WL_Detail_Window_Oculus"))
    return rows


def build(pass_id, cfg):
    mod = cfg["mod"]
    mats = mod.PART_MATERIAL
    footprints = json.loads((HERE / cfg["source"]).read_text(encoding="utf-8"))
    batches = {}
    stats = Counter()
    tops = Counter()

    def add(key, mesh, material, u, v, z, yaw_local, scale=(1.0, 1.0, 1.0), cull=CULL_NEAR, shadow=True):
        x, y = mod.world(u, v)
        bt = batches.setdefault(key, {"id": "%s_%s" % (pass_id, key), "mesh": mesh, "material": material,
                                      "instances": [], "collides": False, "cast_shadow": shadow,
                                      "affect_df": False, "cull_distance": cull})
        bt["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0,
                                round((yaw_local + mod.BEARING) % 360.0, 1), 0.0,
                                round(scale[0], 3), round(scale[1], 3), round(scale[2], 3)])
        stats[key] += 1

    def add_module(name, u, v, z, yaw_local, scale=(1.0, 1.0, 1.0), cull=CULL_NEAR):
        for part in KIT[name]["parts"]:
            if part["part"] in mod.SKIP_PARTS:
                continue
            add("%s_%s" % (name.replace("WL_", ""), part["part"]), part["mesh"],
                mats.get(part["part"], part["material"]), u, v, z, yaw_local, scale, cull)

    used, skipped = 0, Counter()
    for fp in footprints:
        name = fp["module"]
        if not name.startswith(WALLED):
            skipped["not a blank-walled module: " + name] += 1
            continue
        bw, bd = fp["w"], fp["d"]
        if max(bw, bd) < MIN_FACE:
            skipped["no face long enough: " + name] += 1
            continue
        height = KIT[name]["size"][2]
        top, top_source = wall_top(name, height)
        tops[top_source] += 1
        byaw = fp["yaw"]
        ca, sa = math.cos(math.radians(byaw)), math.sin(math.radians(byaw))

        def place(lx, ly, z, face_yaw, module=None, key=None, mesh=None, material=None, scale=(1, 1, 1),
                  cull=CULL_NEAR):
            """Put something at (lx, ly) in the BUILDING's own frame, facing out of the face it sits on."""
            u = fp["u"] + lx * ca - ly * sa
            v = fp["v"] + lx * sa + ly * ca
            if module:
                add_module(module, u, v, z, byaw + face_yaw, scale, cull)
            else:
                add(key, mesh, material, u, v, z, byaw + face_yaw, scale, cull)

        # ---- the four faces, each with its own run length and outward direction
        faces = ((0.0, -1.0, bd / 2.0, bw, 180.0), (0.0, 1.0, bd / 2.0, bw, 0.0),
                 (-1.0, 0.0, bw / 2.0, bd, 90.0), (1.0, 0.0, bw / 2.0, bd, 270.0))
        opened = False
        for fx, fy, half, run, face_yaw in faces:
            if run < MIN_FACE:
                continue
            opened = True
            n = max(1, int(round(run / WINDOW_PITCH)))
            for frac, module in registers(top, top_source):
                if module not in KIT:
                    skipped["kit has no " + module] += 1
                    continue
                for i in range(n):
                    t = (i + 0.5) / n - 0.5
                    lx = t * run if fy else fx * half
                    ly = fy * (half + 14.0) if fy else t * run
                    if not fy:
                        lx = fx * (half + 14.0)
                    place(lx, ly, fp["z"] + top * frac, face_yaw, module=module, cull=CULL_NEAR)
            # wall light on every second opening of the lowest register, low enough to light the pavement
            for i in range(0, n, 2):
                t = (i + 0.5) / n - 0.5
                lx = t * run if fy else fx * (half + 10.0)
                ly = fy * (half + 10.0) if fy else t * run
                place(lx, ly, fp["z"] + top * 0.20, face_yaw, module="WL_Detail_Wall_Lantern", cull=8000.0)

        # ---- a cornice where the wall meets its roof. The plinth block is the kit's only moulding run, so it is
        # stretched along the course exactly as BC01 stretches it around the core's buildings: a base course and a
        # cornice are the same section, and which one it is depends only on where you put it.
        plinth = KIT["WL_Detail_Plinth_Block"]
        plen = plinth["size"][0]
        for fx, fy, half, run, face_yaw in faces:
            n = max(1, int(round(run / CORNICE_RUN)))
            step = run / n
            for i in range(n):
                t = (i + 0.5) / n - 0.5
                lx = t * run if fy else fx * (half + 8.0)
                ly = fy * (half + 8.0) if fy else t * run
                place(lx, ly, fp["z"] + top * 0.99, face_yaw,
                      key="Cornice", mesh=plinth["parts"][0]["mesh"], material=mats["stone"],
                      scale=(step / plen, 1.0, 1.0), cull=CULL_MID)
        if opened:
            used += 1

    spec = {"pass": pass_id, "tags": cfg["tags"], "folder": cfg["folder"], "actors": [],
            "batches": [b for b in batches.values() if b["instances"]]}
    (HERE / cfg["out"]).write_text(json.dumps(spec, indent=1), encoding="utf-8")
    total = sum(len(b["instances"]) for b in spec["batches"])
    print("%s -> %s" % (pass_id, cfg["out"]))
    print("  buildings detailed: %d of %d footprints" % (used, len(footprints)))
    print("  batches %d, instances %d" % (len(spec["batches"]), total))
    for k, v in stats.most_common(8):
        print("    %-38s %5d" % (k, v))
    print("  wall tops: " + ", ".join("%s x%d" % (k, v) for k, v in tops.most_common()))
    if skipped:
        print("  skipped:")
        for k, v in skipped.most_common(6):
            print("    %-38s %5d" % (k, v))
    return spec


def main():
    for pass_id, cfg in NATIONS.items():
        build(pass_id, cfg)
        print()


if __name__ == "__main__":
    main()
