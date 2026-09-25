# WALK THE BETA-ACCESSIBLE WORLD, ON A GRID THAT FITS THE WORLD.
#
# FOUNDER: "FINISH THE ENTIRE BETA-ACCESSIBLE WONDERLAND WORLD ... Walk-test every major region."
#
# WHY THIS REPLACES zc_world_walk. That job gridded the map between the furthest mesh actors in it and reported
# 41 of 81 tiles empty. The bounds were wrong, not the world: 16,536 of 16,803 mesh actors -- 98.4% -- sit in two
# of those tiles, and the grid was stretched to 27 km by a handful of strays ten kilometres out. A tile of empty
# sky is not a missing region, and counting it as one turns a finished world into a permanent failing number.
#
# So the grid is fitted to the CONTENT: the core is the box that holds the middle 99% of the mesh actors, and
# anything outside it is reported separately BY NAME, so a stray can be judged rather than silently averaged in.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "beta_walk")


def pct(vals, p):
    s = sorted(vals)
    if not s:
        return 0.0
    i = max(0, min(len(s) - 1, int(round((len(s) - 1) * p))))
    return s[i]


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"

    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    L.focus_game_viewport()
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 10.5")
    yield 1.0

    everything = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.StaticMeshActor)
    if not everything:
        RESULT["status"] = "FAIL: no static meshes"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    pos = []
    for a in everything:
        loc = a.get_actor_location()
        pos.append((a, loc.x, loc.y, loc.z))
    xs = [p[1] for p in pos]
    ys = [p[2] for p in pos]

    # ---- THE CORE: the box holding the middle 99%, which is the world a player can actually reach.
    x0, x1 = pct(xs, 0.005), pct(xs, 0.995)
    y0, y1 = pct(ys, 0.005), pct(ys, 0.995)
    pad = 20000.0
    x0 -= pad; x1 += pad; y0 -= pad; y1 += pad
    RESULT["core_bounds_uu"] = [round(x0), round(y0), round(x1), round(y1)]
    RESULT["core_span_metres"] = [round((x1 - x0) / 100.0, 1), round((y1 - y0) / 100.0, 1)]

    # ---- THE STRAYS, named. Two or three actors ten kilometres out are either a deliberate backdrop or litter,
    # ---- and the only way to tell is to read their names.
    strays = []
    for a, x, y, z in pos:
        if x < x0 or x > x1 or y < y0 or y > y1:
            # get_actor_label is editor-only and has not been exercised on a PIE actor here, so a stray that
            # cannot name itself is still reported by its class and position rather than dropped.
            try:
                label = a.get_actor_label()
            except Exception:
                label = a.get_class().get_name()
            strays.append({"name": label, "at_metres": [round(x / 100.0), round(y / 100.0), round(z / 100.0)]})
    RESULT["strays_outside_core"] = len(strays)
    RESULT["strays"] = strays[:40]

    inside = [p for p in pos if x0 <= p[1] <= x1 and y0 <= p[2] <= y1]
    RESULT["mesh_actors_total"] = len(pos)
    RESULT["mesh_actors_in_core"] = len(inside)

    # ---- GRID THE CORE. Tiles about 400 m on a side: a tile that size is a neighbourhood, and empty means
    # ---- something a player would notice walking into it.
    tile = 40000.0
    nx = max(1, int(round((x1 - x0) / tile)))
    ny = max(1, int(round((y1 - y0) / tile)))
    tx = (x1 - x0) / nx
    ty = (y1 - y0) / ny
    RESULT["grid"] = [nx, ny]
    RESULT["tile_metres"] = [round(tx / 100.0, 1), round(ty / 100.0, 1)]

    buckets = {}
    for a, x, y, z in inside:
        ix = min(nx - 1, max(0, int((x - x0) / tx)))
        iy = min(ny - 1, max(0, int((y - y0) / ty)))
        cell = buckets.setdefault((ix, iy), {"n": 0, "z": []})
        cell["n"] += 1
        cell["z"].append(z)

    rows = []
    RESULT["samples"] = rows
    built = sparse = empty = 0
    for ix in range(nx):
        for iy in range(ny):
            cell = buckets.get((ix, iy))
            n = cell["n"] if cell else 0
            row = {"tile": [ix, iy],
                   "centre": [round(x0 + tx * (ix + 0.5)), round(y0 + ty * (iy + 0.5))],
                   "mesh_actors": n}
            if cell:
                row["ground_z"] = round(sum(cell["z"]) / len(cell["z"]))
            if n == 0:
                row["verdict"] = "EMPTY"; empty += 1
            elif n < 25:
                row["verdict"] = "sparse"; sparse += 1
            else:
                row["verdict"] = "built"; built += 1
            rows.append(row)
    RESULT["tiles_built"] = built
    RESULT["tiles_sparse"] = sparse
    RESULT["tiles_empty"] = empty
    RESULT["tiles_total"] = len(rows)
    RESULT["coverage_pct"] = round(100.0 * (built + sparse) / max(1, len(rows)), 1)

    art = []
    for iy in range(ny):
        art.append("".join({"built": "B", "sparse": "s", "EMPTY": "."}[
            next(r for r in rows if r["tile"] == [ix, iy])["verdict"]] for ix in range(nx)))
    RESULT["map"] = art

    # ---- AND STAND THE DOG IN A SPREAD OF THEM, built and sparse alike, to find holes in the floor.
    have = [r for r in rows if r["mesh_actors"] > 0]
    have.sort(key=lambda r: -r["mesh_actors"])
    picks = have[:6] + have[len(have) // 2: len(have) // 2 + 3] + have[-3:]
    seen = set()
    visits = []
    RESULT["visits"] = visits
    n = 0
    for r in picks:
        key = tuple(r["tile"])
        if key in seen:
            continue
        seen.add(key)
        gz = r.get("ground_z", 0.0)
        pawn.set_actor_location(unreal.Vector(r["centre"][0], r["centre"][1], gz + 900.0), False, False)
        yield 1.8
        at = pawn.get_actor_location()
        fell = at.z < gz - 5000.0
        visits.append({"tile": r["tile"], "mesh_actors": r["mesh_actors"], "landed_z": round(float(at.z)),
                       "expected_near_z": gz, "fell_through": bool(fell)})
        n += 1
        H.capture_viewport_jpeg(os.path.join(ROOT, "%02d_t%d_%d.jpg" % (n, r["tile"][0], r["tile"][1])), 1600, 90)

    RESULT["visits_that_fell_through"] = sum(1 for v in visits if v["fell_through"])
    RESULT["status"] = "walked"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
