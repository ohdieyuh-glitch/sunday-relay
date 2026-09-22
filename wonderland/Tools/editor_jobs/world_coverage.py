# Editor job, READ-ONLY and CONCURRENT: where is Wonderland actually unfinished?
#
# WHY (founder, 2026-09-22): "A camera shows what it points at. An audit shows where the world is not finished. Do
# NOT spend hours repeatedly polishing one 20-meter camera patch while large unfinished areas remain."
#
# So this answers the question at WORLD scale rather than at camera scale. It lays a grid over the whole 3 km map
# and, for every cell, counts what is actually built there -- architecture, ground, foliage and everything else --
# splitting single actors from batch instances. Then it names each cell's nation sector, so "Noctis is empty" is a
# measurement instead of an impression.
#
# The output is deliberately two things: a machine-readable grid for later passes, and a compact ASCII map in the
# RESULT so the shape of the world is visible without opening a file.
# Globals: CELL (metres), EXTENT (metres from origin), OUT.
import json
import math

CONCURRENT = True
CELL = float(globals().get("CELL", 100.0))
EXTENT = float(globals().get("EXTENT", 1500.0))
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/world_coverage.json")

ARCH = ("castle", "facade", "tower", "hall", "house", "gatehouse", "cloister", "arcade", "wall", "gate", "bridge",
        "stair", "step", "pavilion", "screen", "column", "balustrade", "pier", "plinth", "spire", "pinnacle",
        "urn", "lantern", "arch")
GROUND = ("terrace_platform", "plaza_slab", "path_flag", "cobble", "kerb", "garden_lawn", "ground", "medallion",
          "cube")
FOLIAGE = ("tree", "canopy", "shrub", "hedge", "topiary", "rose", "flower", "lavender", "blossom", "grass", "ivy",
           "vine", "mushroom", "leaf", "petal", "tuft", "plant")

#: Nation sectors, from WorldDesign/nations.py. Neutral core is r < 500 m; bearings are degrees CCW from +X.
NEUTRAL_R = 500.0
SECTORS = (("ICARUS", 30.0, 150.0), ("TARTARUS", -90.0, 30.0), ("NOCTIS", 150.0, -90.0))


def kind_of(name):
    low = name.lower()
    for words, kind in ((GROUND, "ground"), (FOLIAGE, "foliage"), (ARCH, "architecture")):
        if any(w in low for w in words):
            return kind
    return "other"


def _in_sector(bearing, lo, hi):
    if lo <= hi:
        return lo <= bearing < hi
    return bearing >= lo or bearing < hi        # the wrap-around sector


def nation_at(x_m, y_m):
    if math.hypot(x_m, y_m) < NEUTRAL_R:
        return "NEUTRAL"
    bearing = math.degrees(math.atan2(y_m, x_m))
    for name, lo, hi in SECTORS:
        if _in_sector(bearing, lo, hi):
            return name
    return "NEUTRAL"


def job():
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    n = int(math.ceil(EXTENT * 2.0 / CELL))
    half = n // 2
    cells = {}

    def bump(x_uu, y_uu, kind, count):
        gx = int(math.floor(x_uu / 100.0 / CELL)) + half
        gy = int(math.floor(y_uu / 100.0 / CELL)) + half
        if not (0 <= gx < n and 0 <= gy < n):
            return
        c = cells.setdefault((gx, gy), {"architecture": 0, "ground": 0, "foliage": 0, "other": 0, "actors": 0})
        c[kind] += count

    scanned = 0
    for b in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        mesh = b.get_editor_property("mesh")
        ism = b.get_component_by_class(unreal.InstancedStaticMeshComponent)
        if mesh is None or ism is None:
            continue
        kind = kind_of(mesh.get_name())
        # An instanced batch draws its instances anywhere in the world, so the ACTOR's position says nothing.
        # Every instance is placed individually or the map is a lie.
        count = ism.get_instance_count()
        for i in range(count):
            # 5.8's Python returns the Transform itself here, not the (ok, transform) pair the older
            # signature suggests -- unpacking it raises "cannot unpack non-iterable Transform object".
            xf = ism.get_instance_transform(i, True)
            if xf is None:
                continue
            loc = xf.translation
            bump(loc.x, loc.y, kind, 1)
        scanned += count
        yield None

    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.StaticMeshActor):
        smc = a.static_mesh_component
        mesh = smc.static_mesh if smc else None
        if mesh is None:
            continue
        loc = a.get_actor_location()
        bump(loc.x, loc.y, kind_of(mesh.get_name()), 1)
        gx = int(math.floor(loc.x / 100.0 / CELL)) + half
        gy = int(math.floor(loc.y / 100.0 / CELL)) + half
        if (gx, gy) in cells:
            cells[(gx, gy)]["actors"] += 1
        scanned += 1
    yield None

    rows = []
    by_nation = {}
    for gy in range(n):
        for gx in range(n):
            cx = (gx - half + 0.5) * CELL
            cy = (gy - half + 0.5) * CELL
            c = cells.get((gx, gy))
            built = 0 if c is None else (c["architecture"] + c["ground"] + c["foliage"] + c["other"])
            nation = nation_at(cx, cy)
            stat = by_nation.setdefault(nation, {"cells": 0, "empty": 0, "built": 0, "architecture": 0})
            stat["cells"] += 1
            stat["built"] += built
            if c:
                stat["architecture"] += c["architecture"]
            if built == 0:
                stat["empty"] += 1
            if c:
                rows.append({"gx": gx, "gy": gy, "x_m": round(cx, 1), "y_m": round(cy, 1), "nation": nation,
                             "architecture": c["architecture"], "ground": c["ground"], "foliage": c["foliage"],
                             "other": c["other"], "actors": c["actors"], "total": built})

    # A picture of the world in text: how much is built in each cell, on a log-ish scale.
    def glyph(total):
        if total == 0:
            return "."
        if total < 10:
            return ":"
        if total < 50:
            return "-"
        if total < 200:
            return "+"
        if total < 1000:
            return "#"
        return "@"

    picture = []
    for gy in range(n - 1, -1, -1):          # +Y (north) at the top
        line = "".join(glyph(0 if (gx, gy) not in cells else sum(
            cells[(gx, gy)][k] for k in ("architecture", "ground", "foliage", "other"))) for gx in range(n))
        picture.append(line)

    with open(OUT, "w", newline="\n") as f:
        json.dump({"cell_m": CELL, "extent_m": EXTENT, "cells": rows, "by_nation": by_nation,
                   "picture": picture}, f)
    for stat in by_nation.values():
        stat["empty_pct"] = round(100.0 * stat["empty"] / max(1, stat["cells"]), 1)
    RESULT["scanned"] = scanned
    RESULT["by_nation"] = by_nation
    RESULT["picture"] = picture
    RESULT["status"] = "done"
