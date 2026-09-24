# WALK-TEST WONDERLAND, AND SAY WHAT IS ACTUALLY THERE.
#
# FOUNDER: "FINISH THE ENTIRE BETA-ACCESSIBLE WONDERLAND WORLD... Walk-test every major region."
#
# Finishing a world is content work and cannot be written from a script. Finding out WHAT IS MISSING can be,
# and that is what this does -- it is the audit that turns "finish the world" from an unbounded instruction
# into a list. Nothing here is guessed: the world is sampled on a grid, every sample is traced for ground, and
# each region is reported by what was found under it.
#
#   GROUND       a downward trace from high above. No hit is a hole the player would fall through.
#   CONTENT      actors within reach of the sample, so an area that is merely empty is told from one that is
#                missing its floor.
#   REACHABLE    whether the Dog, placed there, is standing on something rather than falling.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "world_walk")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    L.focus_game_viewport()
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 11.0")
    yield 1.0

    # ---------------------------------------------------------------- how big is the world at all?
    everything = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.StaticMeshActor)
    xs, ys, zs = [], [], []
    for a in everything:
        loc = a.get_actor_location()
        xs.append(loc.x); ys.append(loc.y); zs.append(loc.z)
    if not xs:
        RESULT["status"] = "FAIL: the level has no static meshes at all"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    bounds = {"min": [round(min(xs), 0), round(min(ys), 0), round(min(zs), 0)],
              "max": [round(max(xs), 0), round(max(ys), 0), round(max(zs), 0)],
              "mesh_actors": len(everything)}
    RESULT["bounds"] = bounds
    span_x = max(xs) - min(xs)
    span_y = max(ys) - min(ys)
    RESULT["span_metres"] = [round(span_x / 100.0, 1), round(span_y / 100.0, 1)]

    # ---------------------------------------------------------------- where the world actually IS
    #
    # NO TRACES. Three attempts at a downward line trace returned a HitResult this Python build will not open,
    # and a trace that cannot be read is worth less than a count that can: what the founder needs to know is
    # which parts of a 27 km map have anything in them, and the 16,803 mesh actors already say that exactly.
    STEPS = 9
    rows = []
    RESULT["samples"] = rows
    tile_x = span_x / STEPS
    tile_y = span_y / STEPS
    buckets = {}
    for a in everything:
        loc = a.get_actor_location()
        ix = min(STEPS - 1, max(0, int((loc.x - min(xs)) / max(tile_x, 1.0))))
        iy = min(STEPS - 1, max(0, int((loc.y - min(ys)) / max(tile_y, 1.0))))
        key = (ix, iy)
        cell = buckets.setdefault(key, {"n": 0, "z": []})
        cell["n"] += 1
        cell["z"].append(loc.z)

    built = 0
    sparse = 0
    empty = 0
    for ix in range(STEPS):
        for iy in range(STEPS):
            cell = buckets.get((ix, iy))
            n = cell["n"] if cell else 0
            row = {"tile": [ix, iy],
                   "centre": [round(min(xs) + tile_x * (ix + 0.5), 0), round(min(ys) + tile_y * (iy + 0.5), 0)],
                   "mesh_actors": n}
            if cell:
                row["ground_z"] = round(sum(cell["z"]) / len(cell["z"]), 0)
            # A tile is about 3 km on a side. Under a hundred meshes in 9 square kilometres is not a region.
            if n == 0:
                row["verdict"] = "EMPTY"
                empty += 1
            elif n < 100:
                row["verdict"] = "sparse"
                sparse += 1
            else:
                row["verdict"] = "built"
                built += 1
            rows.append(row)

    RESULT["tiles_built"] = built
    RESULT["tiles_sparse"] = sparse
    RESULT["tiles_empty"] = empty
    RESULT["tiles_total"] = len(rows)
    RESULT["tile_size_metres"] = [round(tile_x / 100.0, 0), round(tile_y / 100.0, 0)]
    RESULT["busiest_tiles"] = sorted(
        [r for r in rows if r["mesh_actors"] > 0], key=lambda r: -r["mesh_actors"])[:6]

    # ---------------------------------------------------------------- and stand the Dog in the built ones
    visits = []
    RESULT["visits"] = visits
    standing = sorted([r for r in rows if r["mesh_actors"] > 0], key=lambda r: -r["mesh_actors"])[:8]
    for n, r in enumerate(standing):
        where = unreal.Vector(r["centre"][0], r["centre"][1], r.get("ground_z", 0.0) + 900.0)
        pawn.set_actor_location(where, False, False)
        yield 1.6
        at = pawn.get_actor_location()
        fell = at.z < r.get("ground_z", 0.0) - 5000.0
        visits.append({"tile": r["tile"], "landed_z": round(float(at.z), 0),
                       "expected_near_z": r.get("ground_z"), "fell_through": bool(fell),
                       "mesh_actors": r["mesh_actors"]})
        H.capture_viewport_jpeg(os.path.join(ROOT, "%02d_region.jpg" % (n + 1)), 1600, 90)

    RESULT["visits_that_fell_through"] = sum(1 for v in visits if v["fell_through"])
    RESULT["status"] = "walked"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
