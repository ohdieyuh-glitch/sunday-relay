# WALK THE BETA-ACCESSIBLE WORLD, ON A GRID THE SHAPE OF THE WORLD.
#
# FOUNDER: "FINISH THE ENTIRE BETA-ACCESSIBLE WONDERLAND WORLD ... Walk-test every major region."
#
# WHY NEITHER EARLIER GRID WORKED. Both failures were mine and both are recorded here, because in each case the
# shape of the grid decided the answer and a reader needs to know that.
#
#   zc_world_walk gridded the map between its two FURTHEST mesh actors and reported 41 of 81 tiles empty. But
#   16,536 of the world's 16,803 mesh actors -- 98.4% -- sit in two of those tiles: the grid was stretched to
#   27 km by a handful of strays, and most of what it called "empty" was empty SKY. A tile of sky is not a
#   missing region, and counting it as one turns a finished world into a permanently failing number.
#
#   The first fix trimmed to the middle 99% of actors in x and y. Still a box, and still wrong: the strays are
#   several per cent of the actor count rather than a half per cent, so the trimmed box came back very nearly
#   the full 27 km -- 69 x 63 tiles -- and the map-rendering loop, which was O(tiles squared), sat on the game
#   thread until the editor had to be restarted. Both the bound and the loop are fixed below.
#
# WONDERLAND IS RADIAL, AND THAT IS THE ANSWER. It was authored in rings and bearings and the ledger describes
# it that way throughout: Golden Arrival inside 500 m, the nation bands out to ~1,155 m, Dubel Forest at
# 1,230-1,480 m. So the core is a DISC about the origin, not a box about the outliers -- and a disc needs one
# number, which the actors themselves can be asked for.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "beta_walk")
TILE_UU = 20000.0          # 200 m: a neighbourhood, and small enough that "empty" is something a player notices


def pct(values, p):
    s = sorted(values)
    if not s:
        return 0.0
    return s[max(0, min(len(s) - 1, int(round((len(s) - 1) * p))))]


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

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
        RESULT["status"] = "FAIL: the level has no static meshes at all"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    # ---- HOW BIG IS THE WORLD PEOPLE WALK IN? Ask the actors for their radius, not for their extremes.
    pos = []
    for a in everything:
        loc = a.get_actor_location()
        x = float(loc.x)
        y = float(loc.y)
        pos.append((a, x, y, float(loc.z), (x * x + y * y) ** 0.5))
    radii = [p[4] for p in pos]
    r99 = pct(radii, 0.99)
    core = max(r99 * 1.10, 40000.0)
    RESULT["mesh_actors_total"] = len(pos)
    RESULT["core_radius_metres"] = round(core / 100.0, 1)
    RESULT["radius_percentiles_metres"] = {
        "p50": round(pct(radii, 0.50) / 100.0, 1),
        "p90": round(pct(radii, 0.90) / 100.0, 1),
        "p99": round(r99 / 100.0, 1),
        "max": round(max(radii) / 100.0, 1),
    }

    inside = [p for p in pos if p[4] <= core]
    RESULT["mesh_actors_in_core"] = len(inside)
    RESULT["actors_beyond_core"] = len(pos) - len(inside)

    # ---- THE STRAYS, NAMED, so a deliberate distant backdrop can be told from litter rather than averaged in.
    strays = []
    for a, x, y, z, r in pos:
        if r > core:
            try:
                label = a.get_actor_label()
            except Exception:
                label = a.get_class().get_name()
            strays.append({"name": label,
                           "at_metres": [round(x / 100.0), round(y / 100.0), round(z / 100.0)],
                           "radius_metres": round(r / 100.0)})
    strays.sort(key=lambda s: -s["radius_metres"])
    RESULT["strays"] = strays[:30]

    # ---- GRID THE DISC. A tile whose centre falls outside the disc is not judged: it is not the world.
    half = int(core / TILE_UU) + 1
    nx = ny = 2 * half
    buckets = {}
    for a, x, y, z, r in inside:
        key = (int((x + core) // TILE_UU), int((y + core) // TILE_UU))
        cell = buckets.setdefault(key, {"n": 0, "z": []})
        cell["n"] += 1
        cell["z"].append(z)

    rows = []
    RESULT["samples"] = rows
    built = 0
    sparse = 0
    empty = 0
    for iy in range(ny):
        for ix in range(nx):
            cx = -core + TILE_UU * (ix + 0.5)
            cy = -core + TILE_UU * (iy + 0.5)
            radius = (cx * cx + cy * cy) ** 0.5
            if radius > core:
                continue
            cell = buckets.get((ix, iy))
            n = cell["n"] if cell else 0
            row = {"tile": [ix, iy], "centre": [round(cx), round(cy)], "mesh_actors": n,
                   "radius_metres": round(radius / 100.0)}
            if cell:
                row["ground_z"] = round(sum(cell["z"]) / len(cell["z"]))
            if n == 0:
                row["verdict"] = "EMPTY"
                empty += 1
            elif n < 15:
                row["verdict"] = "sparse"
                sparse += 1
            else:
                row["verdict"] = "built"
                built += 1
            rows.append(row)

    RESULT["grid"] = [nx, ny]
    RESULT["tile_metres"] = round(TILE_UU / 100.0, 1)
    RESULT["tiles_in_disc"] = len(rows)
    RESULT["tiles_built"] = built
    RESULT["tiles_sparse"] = sparse
    RESULT["tiles_empty"] = empty
    RESULT["coverage_pct"] = round(100.0 * (built + sparse) / max(1, len(rows)), 1)

    # Indexed, not searched. Written as a scan of `rows` per cell this is O(tiles squared), which is the loop
    # that hung the editor on the 69 x 63 grid the box bound produced.
    by_tile = {(r["tile"][0], r["tile"][1]): r["verdict"] for r in rows}
    glyph = {"built": "B", "sparse": "s", "EMPTY": "."}
    RESULT["map"] = ["".join(glyph.get(by_tile.get((ix, iy)), " ") for ix in range(nx)) for iy in range(ny)]

    # ---- AND THE RINGS, because that is how the world was authored and how the ledger reads it.
    bands = {}
    for r in rows:
        band = int(r["radius_metres"] // 200) * 200
        b = bands.setdefault(band, {"tiles": 0, "empty": 0, "actors": 0})
        b["tiles"] += 1
        b["actors"] += r["mesh_actors"]
        if r["mesh_actors"] == 0:
            b["empty"] += 1
    RESULT["rings"] = [dict(from_metres=k, to_metres=k + 200, **v) for k, v in sorted(bands.items())]

    record("W01", "the walkable world is a disc of real size rather than a scatter of strays",
           RESULT["core_radius_metres"] > 800.0 and RESULT["mesh_actors_in_core"] > len(pos) * 0.90,
           core_radius_m=RESULT["core_radius_metres"], in_core=RESULT["mesh_actors_in_core"],
           of_total=len(pos), beyond=RESULT["actors_beyond_core"])
    record("W02", "most of the disc has something in it", RESULT["coverage_pct"] >= 85.0,
           coverage_pct=RESULT["coverage_pct"], built=built, sparse=sparse, empty=empty,
           tiles=len(rows))

    # ---- STAND THE DOG ACROSS IT.
    #
    # THE EMPTY TILES ARE VISITED TOO, and that is the point. The first version of this walk picked only tiles
    # that HAD actors, which quietly skipped the only question a beta player can actually be hurt by: whether
    # the frontier has a floor. A tile with nothing in it is not a defect -- every world ends somewhere -- but
    # a tile you fall through is, and the two are indistinguishable until somebody stands in one.
    have = sorted([r for r in rows if r["mesh_actors"] > 0], key=lambda r: -r["mesh_actors"])
    blank = sorted([r for r in rows if r["mesh_actors"] == 0], key=lambda r: r["radius_metres"])
    third = len(have) // 3
    middle = len(have) // 2
    picks = []
    seen = set()
    for r in have[:5] + have[third:third + 3] + have[middle:middle + 3] + have[-4:] + blank[:4] + blank[-4:]:
        key = (r["tile"][0], r["tile"][1])
        if key not in seen:
            seen.add(key)
            picks.append(r)

    visits = []
    RESULT["visits"] = visits
    for n, r in enumerate(picks):
        # An empty tile has no actors to average a height from, so it borrows the height of the built world
        # around it rather than being dropped from an arbitrary zero.
        gz = r.get("ground_z")
        if gz is None:
            near = [q for q in rows if "ground_z" in q
                    and abs(q["tile"][0] - r["tile"][0]) <= 2 and abs(q["tile"][1] - r["tile"][1]) <= 2]
            gz = (sum(q["ground_z"] for q in near) / len(near)) if near else 0.0
            r["ground_z_borrowed"] = round(gz)
        pawn.set_actor_location(unreal.Vector(r["centre"][0], r["centre"][1], gz + 900.0), False, False)
        yield 1.8
        at = pawn.get_actor_location()
        fell = float(at.z) < gz - 5000.0
        visits.append({"tile": r["tile"], "radius_metres": r["radius_metres"],
                       "mesh_actors": r["mesh_actors"], "landed_z": round(float(at.z)),
                       "expected_near_z": round(gz), "fell_through": bool(fell),
                       "was_empty": r["mesh_actors"] == 0})
        H.capture_viewport_jpeg(os.path.join(ROOT, "%02d_r%04dm.jpg" % (n + 1, r["radius_metres"])), 1600, 90)

    fell_through = sum(1 for v in visits if v["fell_through"])
    RESULT["visits_that_fell_through"] = fell_through
    empties = [v for v in visits if v["was_empty"]]
    RESULT["empty_tiles_visited"] = len(empties)
    RESULT["empty_tiles_with_no_floor"] = sum(1 for v in empties if v["fell_through"])
    record("W03", "the Dog stands on ground everywhere it was put down", fell_through == 0,
           visited=len(visits), fell_through=fell_through,
           where=[v["tile"] for v in visits if v["fell_through"]])
    record("W04", "even the empty frontier tiles have a floor under them",
           RESULT["empty_tiles_with_no_floor"] == 0,
           empty_visited=len(empties), no_floor=RESULT["empty_tiles_with_no_floor"],
           where=[[v["tile"], v["radius_metres"]] for v in empties if v["fell_through"]])

    RESULT["status"] = "walked"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
