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
import time
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "beta_walk")
TILE_UU = 20000.0          # 200 m: a neighbourhood, and small enough that "empty" is something a player notices
# The world's own content class. Characters are instanced too (voxels), so W07 counts batches and static mesh
# actors only, on both sides; without the class it cannot tell them apart, and says so rather than guess.
BATCH = getattr(unreal, "WonderlandInstancedBatch", None)


def pct(values, p):
    s = sorted(values)
    if not s:
        return 0.0
    return s[max(0, min(len(s) - 1, int(round((len(s) - 1) * p))))]


def job():
    # THE JOB GIVES BACK WHAT IT CHANGES, on every exit: a pass, a FAIL, an exception, or a timeout the
    # channel throws in. wl.Sky.DayMinutes is a process-wide console variable, and this walk used to leave
    # it at 0 -- which froze the sky for every later PIE session in the same editor, other lanes' captures
    # included. wl.Sky.Hour is a console COMMAND acting on the PIE world's day cycle and dies with PIE, so
    # there is nothing of it to give back. The background-throttle flag has a setter and no getter, every
    # PIE job sets it for itself, and suspending it changes how fast another job runs but not what it
    # measures -- so it is left suspended rather than "restored" to a value nobody read.
    found = unreal.SystemLibrary.get_console_variable_float_value("wl.Sky.DayMinutes")
    RESULT["day_minutes_found"] = found
    try:
        yield from _walk()
    finally:
        editor_world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
        unreal.SystemLibrary.execute_console_command(editor_world, "wl.Sky.DayMinutes %s" % found)
        RESULT["day_minutes_restored"] = unreal.SystemLibrary.get_console_variable_float_value(
            "wl.Sky.DayMinutes")


def _walk():
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

    # ---- THE WORLD IS COUNTED IN THE EDITOR, WHERE IT IS AUTHORED -- NOT IN PLAY, AT THE SPAWN.
    #
    # THE ERROR THIS FIXES (2026-09-28). This walk used to count the world in the PLAY world the moment PIE
    # began, with the Dog at the arrival -- which assumes everything is resident at the spawn. It never was.
    # Every WonderlandInstancedBatch then reported its streaming bounds as a POINT at the origin (its instances
    # live on an editor-only component until BeginPlay), so World Partition filed all 3,585 spatially loaded
    # batches in the one cell at the origin: resident at the spawn, and gone 700 m out. The count at the spawn
    # saw the whole world; every stand past ~700 m then stood on the V2 lawn (-14) where the editor has
    # paving, halls and towers; and W03/W04 passed, because a lawn is a floor. zzV4 (11:56) is that run:
    # [5,10] at 728 m authored 43 m of structure and traced -14 in play.
    #
    # Once the batches stream by their true bounds, the same count at the spawn would see only what is within
    # the loading range of the arrival, and call the outer rings EMPTY -- a false fail instead of a false pass.
    # Either way the count answered "what is loaded where the Dog started", which is not the question. What is
    # AUTHORED is counted here, in the editor world; whether it is THERE IN PLAY is asked at each stand (W07).
    ed_world = ues.get_editor_world()
    everything = unreal.GameplayStatics.get_all_actors_of_class(ed_world, unreal.StaticMeshActor)
    RESULT["census_world"] = "editor"

    # AND THE COUNT IS ONLY AS GOOD AS WHAT THE EDITOR HAS LOADED. An actor whose region is not loaded in the
    # editor is not in this count, and its tile would read EMPTY; so the World Partition descriptors are
    # checked against the loaded actors, and a shortfall fails W08 rather than passing as open ground.
    loaded_names = set()
    for a in unreal.GameplayStatics.get_all_actors_of_class(ed_world, unreal.Actor):
        try:
            loaded_names.add(str(a.get_name()))
        except Exception:                         # noqa: BLE001
            pass
    descs = None
    try:
        got = unreal.WorldPartitionBlueprintLibrary.get_actor_descs()
        if isinstance(got, tuple):
            got = next((g for g in got if hasattr(g, "__len__") and not isinstance(g, str)), None)
        if got is not None and hasattr(got, "__len__") and not isinstance(got, (str, bool)):
            descs = got
    except Exception as exc:                      # noqa: BLE001
        RESULT["descriptor_error"] = repr(exc)
    unloaded = []
    if descs is not None:
        for d in descs:
            try:
                if str(d.get_editor_property("name")) not in loaded_names:
                    unloaded.append(str(d.get_editor_property("label")))
            except Exception:                     # noqa: BLE001
                continue
    RESULT["editor_descriptors"] = None if descs is None else len(descs)
    RESULT["editor_unloaded"] = len(unloaded)
    record("W08", "the authored world was all loaded in the editor when it was counted",
           descs is not None and not unloaded,
           descriptors=RESULT["editor_descriptors"], unloaded=len(unloaded), examples=unloaded[:12],
           note="an actor whose editor region is not loaded is missing from the count, and its tile reads "
                "EMPTY; load the regions (zc_wp_regions) and walk again" if descs is not None else
                "the descriptor API gave nothing, so completeness could not be checked")

    # ---- AND THE INSTANCES, WHICH ARE MOST OF THE WORLD.
    #
    # THE ERROR THIS FIXES, and it was mine. Both earlier versions of this walk counted only StaticMeshActors
    # -- 16,803 of them -- and called a tile EMPTY when it held none. But Wonderland is overwhelmingly
    # INSTANCED: the ledger's own headline is "107,546 placed instances", and every authored layer lands as
    # instanced batches. So "empty" never meant "nothing here", it meant "no StaticMeshActor here", and the
    # 82.5% coverage this job reported was measuring the wrong population entirely. It was caught the only way
    # it could be: 1,665 instances were applied to the seventeen tiles it called empty, and the number did not
    # move by one.
    #
    # Instance transforms are read one at a time because that is the only accessor there is. It is ~100k calls
    # and takes seconds, which is the right trade for an audit that runs once and decides whether the world is
    # finished.
    inst_pos = []
    # THE WORLD'S OWN CONTENT, for W07: batch instances and static mesh actors. Not characters -- the voxel Dog
    # and its companions are instanced too, travel with the Dog, and put 5,202 instances into EVERY tile it
    # stands in; zzW11 counted them as world, and a stand with 152 of its 304 authored pieces passed as 5,354.
    world_pos = [(float(a.get_actor_location().x), float(a.get_actor_location().y)) for a in everything]
    comps = 0
    for a in unreal.GameplayStatics.get_all_actors_of_class(ed_world, unreal.Actor):
        is_world = BATCH is not None and isinstance(a, BATCH)
        for comp in a.get_components_by_class(unreal.InstancedStaticMeshComponent):
            comps += 1
            try:
                count = int(comp.get_instance_count())
            except Exception:
                continue
            for i in range(count):
                try:
                    t = comp.get_instance_transform(i, world_space=True)
                except Exception:
                    break
                v = t.translation
                inst_pos.append((float(v.x), float(v.y), float(v.z)))
                if is_world:
                    world_pos.append((float(v.x), float(v.y)))
    RESULT["instanced_components"] = comps
    RESULT["instances_total"] = len(inst_pos)
    RESULT["world_content_total"] = len(world_pos)

    if not everything and not inst_pos:
        RESULT["status"] = "FAIL: the level has no static meshes at all"
        return

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

    def resident_in_tile(cx, cy):
        """What of the WORLD'S OWN CONTENT is really in the PLAY world inside a stand's tile: static mesh
        actors and batch instances -- the population world_pos counted in the editor, over the same bounds.
        Components are skipped by their bounds first, so only the ones overlapping the tile are read."""
        if BATCH is None:
            return None
        lo_x, hi_x = cx - TILE_UU * 0.5, cx + TILE_UU * 0.5
        lo_y, hi_y = cy - TILE_UU * 0.5, cy + TILE_UU * 0.5
        n = 0
        for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.StaticMeshActor):
            try:
                v = a.get_actor_location()
            except Exception:                     # noqa: BLE001
                continue
            if lo_x <= v.x < hi_x and lo_y <= v.y < hi_y:
                n += 1
        for a in unreal.GameplayStatics.get_all_actors_of_class(world, BATCH):
            try:
                found = a.get_components_by_class(unreal.InstancedStaticMeshComponent)
            except Exception:                     # noqa: BLE001
                continue
            for comp in found:
                try:
                    o, e = unreal.SystemLibrary.get_component_bounds(comp)[:2]
                    if o.x + e.x < lo_x or o.x - e.x >= hi_x or o.y + e.y < lo_y or o.y - e.y >= hi_y:
                        continue
                    count = int(comp.get_instance_count())
                except Exception:                 # noqa: BLE001
                    continue
                for i in range(count):
                    try:
                        v = comp.get_instance_transform(i, world_space=True).translation
                    except Exception:             # noqa: BLE001
                        break
                    if lo_x <= v.x < hi_x and lo_y <= v.y < hi_y:
                        n += 1
        return n

    # ---- HOW BIG IS THE WORLD PEOPLE WALK IN? Ask what is placed for its radius, not for its extremes.
    pos = []
    for a in everything:
        loc = a.get_actor_location()
        x = float(loc.x)
        y = float(loc.y)
        pos.append((a, x, y, float(loc.z), (x * x + y * y) ** 0.5))
    for (x, y, z) in inst_pos:
        pos.append((None, x, y, z, (x * x + y * y) ** 0.5))
    radii = [p[4] for p in pos]
    r99 = pct(radii, 0.99)
    core = max(r99 * 1.10, 40000.0)
    RESULT["placed_total"] = len(pos)
    RESULT["mesh_actors_total"] = len(everything)
    RESULT["core_radius_metres"] = round(core / 100.0, 1)
    RESULT["radius_percentiles_metres"] = {
        "p50": round(pct(radii, 0.50) / 100.0, 1),
        "p90": round(pct(radii, 0.90) / 100.0, 1),
        "p99": round(r99 / 100.0, 1),
        "max": round(max(radii) / 100.0, 1),
    }

    inside = [p for p in pos if p[4] <= core]
    RESULT["placed_in_core"] = len(inside)
    RESULT["mesh_actors_in_core"] = len(inside)
    RESULT["actors_beyond_core"] = len(pos) - len(inside)

    # ---- THE STRAYS, NAMED, so a deliberate distant backdrop can be told from litter rather than averaged in.
    strays = []
    for a, x, y, z, r in pos:
        if r > core:
            if a is None:
                label = "(instance)"
            else:
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
    # the world's own content per tile, over the whole tile (the play count at a stand sees the whole tile too)
    world_buckets = {}
    for x, y in world_pos:
        key = (int((x + core) // TILE_UU), int((y + core) // TILE_UU))
        world_buckets[key] = world_buckets.get(key, 0) + 1

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
                   "authored_world": world_buckets.get((ix, iy), 0), "radius_metres": round(radius / 100.0)}
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
    # ---- THE BUILT WORLD AND THE WILDERNESS ARE JUDGED SEPARATELY, and that is a correction rather than a
    # ---- lowered bar.
    #
    # W02 used to ask that 85% of every tile in the disc hold something. That number was invented before any
    # of this had been measured, and it penalises the one part of the world that is deliberately empty: DF01
    # Dubel Forest, at 1,200-1,600 m, is built with "clearings -- explicit voids, placed first and respected
    # by everything after" and "thinning toward both the inner edge and the outer edge, so the belt fades
    # rather than stops". A test that fails a forest for having clearings in it is testing the wrong thing,
    # and passing it would mean deleting them.
    #
    # What the founder actually asked for is a world with no empty AREAS in it. So the built world -- inside
    # the nations' own frontier -- must have nothing empty at all, which is a STRICTER bar than 85%, and the
    # wilderness is reported beside it rather than scored against a city's standard.
    FRONTIER_M = 1200.0
    built_rows = [r for r in rows if r["radius_metres"] <= FRONTIER_M]
    wild_rows = [r for r in rows if r["radius_metres"] > FRONTIER_M]
    built_empty = [r for r in built_rows if r["mesh_actors"] == 0]
    RESULT["built_world"] = {"tiles": len(built_rows), "empty": len(built_empty),
                             "empty_at": [[r["tile"], r["radius_metres"]] for r in built_empty]}
    RESULT["wilderness"] = {"tiles": len(wild_rows),
                            "empty": sum(1 for r in wild_rows if r["mesh_actors"] == 0),
                            "placed": sum(r["mesh_actors"] for r in wild_rows)}
    record("W02", "the built world has no empty areas in it", len(built_empty) == 0,
           built_tiles=len(built_rows), built_empty=len(built_empty),
           where=RESULT["built_world"]["empty_at"], frontier_m=FRONTIER_M,
           note="the wilderness past the frontier is judged by W05, not by a city's standard")
    record("W05", "the wilderness belt is planted, with the clearings DF01 was designed to have",
           RESULT["wilderness"]["placed"] > 1500 and RESULT["wilderness"]["empty"] > 0,
           **RESULT["wilderness"])

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
        # ---- AND WAIT FOR THE GROUND TO ARRIVE, HOLDING THE DOG UP WHILE IT DOES.
        #
        # This was a flat 1.8 second settle, which was right while the whole world was resident: the Dog
        # teleported into a tile whose floor had been loaded since startup and fell straight onto it. With the
        # map converted to World Partition the destination cell is NOT loaded at the moment of the teleport --
        # it only begins streaming because the player just became a streaming source there -- and the first
        # version of this fix, which simply waited for the Dog to stop falling, KILLED IT: with no floor yet,
        # it fell past where the floor will be, through KillZ, and was destroyed. The proof then died on
        # "RelayDogCharacter: Internal Error - ObjectInstance is null", which is a pawn that no longer exists.
        #
        # So the Dog is HELD at the teleport height, re-placed every tick, while a downward trace asks whether
        # the ground has arrived. The trace is the right instrument because it does not depend on the pawn
        # surviving, and the holding is what stops the fall that would destroy it. Only once something is
        # under the Dog is it released to settle onto it. The pawn is re-fetched each tick as well, so a
        # respawn between stops cannot poison every later reading.
        # GRAVITY IS SWITCHED OFF FOR THE WAIT, not fought with. Re-placing the Dog every quarter second was
        # not enough -- it accelerates between ticks, and a few ticks of free fall over a cell that has not
        # arrived is all it takes to pass KillZ and be destroyed. And a destroyed pawn's Python wrapper is not
        # None; it throws "ObjectInstance is null" the moment anything touches it, which is how two runs of
        # this proof died mid-traversal rather than reporting. So: disable movement, wait for ground, restore.
        hold_at = unreal.Vector(r["centre"][0], r["centre"][1], gz + 900.0)

        def living():
            """The pawn, or None -- asked in a way that survives it having been destroyed."""
            try:
                got = unreal.GameplayStatics.get_player_pawn(world, 0)
                if got is None:
                    return None
                got.get_actor_location()          # touches the UObject; throws if it is gone
                return got
            except Exception:                     # noqa: BLE001
                return None

        def mover(who):
            try:
                return who.character_movement
            except Exception:                     # noqa: BLE001
                return None

        live = living()
        mc = mover(live) if live else None
        if mc is not None:
            try:
                mc.disable_movement()
            except Exception:                     # noqa: BLE001
                pass
        # THE STAND'S CELLS ARE STREAMED IN BEFORE ANYTHING IS READ. The trace below waits for "a floor", and
        # the always-loaded V2 lawn is a floor everywhere: it arrives at once, so on its own the wait proved
        # nothing about the plaza or hall that belongs over it. A frame first, so the streaming source has
        # moved to the Dog; then a blocking flush; then a moment for the flushed cells to register.
        yield 0.3
        unreal.SystemLibrary.execute_console_command(world, "FlushLevelStreaming")
        yield 0.7
        # WHAT IS AUTHORED HERE, IS IT HERE IN PLAY? Counted while the Dog is held, over the same tile the
        # editor census counted -- and counted AGAIN a second later until two readings agree. The flush alone
        # is not a promise: zzW11 read [8,4] at 152 of 304 and [7,1] at 208 of 303 after a long jump, and
        # zzW13, the same tiles with a longer settle, found every one of those actors there. A reading taken
        # while cells are still arriving is a reading of the arrival, not of the world.
        # AND "TWO READINGS AGREE" WAS NOT ENOUGH EITHER: zzW14 read [8,4] at 272 twice, a second apart, and
        # zzW13 had found all 304 there after two seconds -- the tile's cells arrive in waves, with pauses between
        # them longer than a second. So the count now waits on the SUBJECT: until everything the editor authored
        # in this tile is resident, or ten seconds have passed. A tile that is really short still fails; it just
        # fails after waiting, instead of a tile in mid-arrival failing at once.
        try:
            prev_n, n_now = None, None
            count_began = time.time()
            target = r["authored_world"]
            while True:
                n_now = resident_in_tile(r["centre"][0], r["centre"][1])
                if n_now is None or n_now >= target or time.time() - count_began > 10.0:
                    break
                prev_n = n_now
                yield 1.0
            r["resident_in_play"] = n_now
            r["resident_waited_s"] = round(time.time() - count_began, 1)
            r["resident_settled"] = n_now is not None and (n_now >= target or n_now == prev_n)
        except Exception as exc:                  # noqa: BLE001
            r["resident_in_play"] = None
            r["resident_error"] = repr(exc)
        # WALL CLOCK, NOT WORLD TIME. The first version timed this wait with GameplayStatics.get_time_seconds,
        # which does not advance while the world is paused -- so the escape hatch could never fire, the loop
        # span until the channel's own thirty-minute cap killed the job, and the proof reported nothing at all
        # after half an hour. A timeout that depends on the thing it is timing out is not a timeout.
        #
        # THE TRACE LOOKS DOWN FROM FAR ABOVE THE TILE, NOT FROM THE HOLD POINT. `gz` is the mean height of
        # everything placed in the tile, and where a tile has deep content that mean sits BELOW the floor a
        # player walks on. At [7,7], 31 m from the arrival, it was -1308 against a plaza near +12, so the Dog
        # was held at -408 -- under the plaza -- the 4,000 uu trace beneath it found nothing for twelve
        # seconds, and the Dog was released onto whatever lies below (-861 on one run, -1045 on the next).
        # That stand never tested the Golden Arrival floor, and W03 counted it as standing. So the trace now
        # starts 200 m above the tile's content, and the Dog is dropped 900 uu above the topmost thing it
        # finds: the surface a player would actually be standing on.
        top_from = unreal.Vector(r["centre"][0], r["centre"][1], gz + 20000.0)
        top_to = unreal.Vector(r["centre"][0], r["centre"][1], gz - 20000.0)
        surface_z = None
        began = time.time()
        arrived = False
        while True:
            live = living()
            if live is not None:
                try:
                    live.set_actor_location(hold_at, False, False)
                    # AND THE VELOCITY WITH IT, which is what the first two attempts missed. Re-placing the
                    # Dog every quarter second does not stop it ACCELERATING: gravity keeps integrating, so
                    # after ten seconds of waiting it carries about 9,800 uu/s and a single tick moves it
                    # 2,450 uu -- past KillZ and destroyed before the next re-placement can catch it. The
                    # position has to be reset and the speed with it.
                    moving = mover(live)
                    if moving is not None:
                        moving.set_editor_property("velocity", unreal.Vector(0.0, 0.0, 0.0))
                except Exception:                 # noqa: BLE001
                    pass
            try:
                down = unreal.SystemLibrary.line_trace_single(
                    world, top_from, top_to,
                    unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [live] if live else [],
                    unreal.DrawDebugTrace.NONE, True,
                    unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            except Exception:                     # noqa: BLE001
                down = None
            if down is not None:
                arrived = True
                try:
                    surface_z = float(down.to_tuple()[4].z)
                except Exception:                 # noqa: BLE001
                    surface_z = None
                break
            if time.time() - began > 12.0:
                break
            yield 0.25
        r["cell_streamed_in"] = arrived
        drop_z = (surface_z if surface_z is not None else gz) + 900.0
        live = living()
        if live is not None:
            try:
                live.set_actor_location(unreal.Vector(r["centre"][0], r["centre"][1], drop_z), False, False)
                moving = mover(live)
                if moving is not None:
                    moving.set_editor_property("velocity", unreal.Vector(0.0, 0.0, 0.0))
            except Exception:                     # noqa: BLE001
                pass
        mc = mover(live) if live else None
        if mc is not None:
            try:
                mc.set_movement_mode(unreal.MovementMode.MOVE_FALLING)
            except Exception:                     # noqa: BLE001
                pass
        if live is not None:
            pawn = live
        # ---- THE STAND IS READ WHEN THE DOG HAS LANDED, not two seconds after it was let go.
        #
        # A fixed wait is a guess about frame rate, and when the guess is wrong the Dog is read in mid-air --
        # which W03 counts as "did not fall through", because it only fails a Dog 50 m below the tile. zzT6
        # read [7,6] at z 941 and [8,7] at 394; zzV1, the same stands an hour later, read the ground at 108
        # and 101. Landed means WALKING movement and a height that held still across a wait -- two reads with
        # time between them, because two reads of the same moment agree about anything. A Dog that has not
        # landed ten seconds after release is an unmeasured stand, not a pass.
        landed = False
        mode = None
        last_z = None
        settle_began = time.time()
        while time.time() - settle_began < 10.0:
            yield 0.25
            live = living()
            if live is None:
                break
            try:
                z_now = float(live.get_actor_location().z)
                mode = str(live.character_movement.get_editor_property("movement_mode"))
            except Exception:                     # noqa: BLE001
                break
            walking = "WALKING" in mode.upper()
            if walking and last_z is not None and abs(z_now - last_z) < 2.0:
                landed = True
                break
            last_z = z_now if walking else None
        settle_s = round(time.time() - settle_began, 2)
        # THE STAND IS READ FROM A PAWN THAT IS STILL THERE, or it is recorded as unmeasured. A destroyed
        # Dog's wrapper is not None -- it throws on the first touch -- and three runs of this proof died on
        # that rather than reporting anything at all. An unmeasured stand is a result; a traceback is not.
        live = living()
        if live is None:
            visits.append({"tile": r["tile"], "radius_metres": r["radius_metres"],
                           "mesh_actors": r["mesh_actors"], "authored_world": r["authored_world"], "landed_z": None,
                           "expected_near_z": round(gz), "fell_through": None,
                           "unmeasured": "the Dog did not survive the stand",
                           "cell_streamed_in": r.get("cell_streamed_in"), "resident_in_play": r.get("resident_in_play"), "resident_settled": r.get("resident_settled"),
                           "was_empty": r["mesh_actors"] == 0})
            continue
        pawn = live
        at = pawn.get_actor_location()
        # FELL THROUGH means it never came to rest AND dropped 50 m past the point it was let go from. A Dog
        # that LANDED is standing on something, whatever the tile's content averages. The first live run of
        # this version (zzV4) still compared against `gz` and flagged [13,11]: the Dog had landed on real
        # ground at 75 (floor -14), but `gz` was borrowed from 99 m mountain neighbours (9942). The older job
        # passed that stand only because it read the Dog two seconds into its fall, at 8878.
        fell = (not landed) and float(at.z) < drop_z - 5000.0
        surface = round(surface_z) if surface_z is not None else None
        if not landed and not fell:
            visits.append({"tile": r["tile"], "radius_metres": r["radius_metres"],
                           "mesh_actors": r["mesh_actors"], "authored_world": r["authored_world"], "landed_z": None,
                           "expected_near_z": round(gz), "surface_z": surface, "fell_through": None,
                           "unmeasured": "the Dog had not landed 10 s after release",
                           "airborne_z": round(float(at.z)), "movement_mode": mode,
                           "cell_streamed_in": r.get("cell_streamed_in"), "resident_in_play": r.get("resident_in_play"), "resident_settled": r.get("resident_settled"),
                           "was_empty": r["mesh_actors"] == 0})
            H.capture_viewport_jpeg(os.path.join(ROOT, "%02d_r%04dm_airborne.jpg" % (n + 1, r["radius_metres"])),
                                    1600, 90)
            continue
        visits.append({"tile": r["tile"], "radius_metres": r["radius_metres"],
                       "mesh_actors": r["mesh_actors"], "authored_world": r["authored_world"], "landed_z": round(float(at.z)),
                       "expected_near_z": round(gz), "surface_z": surface, "fell_through": bool(fell),
                       "landed": landed, "settle_s": settle_s,
                       "cell_streamed_in": r.get("cell_streamed_in"), "resident_in_play": r.get("resident_in_play"), "resident_settled": r.get("resident_settled"),
                       "was_empty": r["mesh_actors"] == 0})
        H.capture_viewport_jpeg(os.path.join(ROOT, "%02d_r%04dm.jpg" % (n + 1, r["radius_metres"])), 1600, 90)

    unmeasured = [v for v in visits if v.get("unmeasured")]
    RESULT["unmeasured_stands"] = len(unmeasured)
    record("W06", "every stand was actually measured",
           len(unmeasured) == 0, unmeasured=len(unmeasured), of=len(visits),
           which=[v["tile"] for v in unmeasured],
           note="a stand where the Dog was destroyed, or had not come to rest, proves nothing about whether "
                "there is ground there, and must not be counted as a pass")
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
    # W07: A FLOOR IS NOT THE WORLD. W03/W04 ask whether the Dog stands on something, and the V2 lawn is
    # something everywhere -- which is how a walk with every far stand on bare lawn passed both. This asks
    # the other half: of what the editor has in the stand's tile, how much is in play there. 90% leaves room
    # for editor-only helpers; a streaming fault shows as a stand holding a few per cent of its authored count.
    judged = [v for v in visits if v["authored_world"] >= 15]
    short = [v for v in judged
             if v.get("resident_in_play") is None or not v.get("resident_settled")
             or v["resident_in_play"] < 0.9 * v["authored_world"]]
    RESULT["stands_short_in_play"] = len(short)
    record("W07", "what is authored where the Dog stands is there in play", bool(judged) and not short,
           judged=len(judged), short=len(short),
           where=[[v["tile"], v["radius_metres"], v["authored_world"], v.get("resident_in_play")] for v in short],
           note="tile, radius m, authored in the editor, resident in play; a count that never settled "
                "(two readings a second apart that disagree for 8 s) is short, not passed")

    RESULT["status"] = "walked"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
