# RESTORE THE WORLD PARTITION EDITOR REGIONS -- the whole of Wonderland loaded in the editor, measured as it loads.
#
# FOUNDER, 2026-09-28: "The currently open Wonderland WP2 map is showing: No Loaded Region(s). Restore the World
# Partition editor regions so the complete Wonderland world is visible/available in the Unreal Editor again ...
# Use the real World Partition editor loading mechanism ... Because Wonderland is large, monitor RAM while
# loading. Do not crash Unreal trying to force everything into memory. If the entire editor world genuinely
# cannot fit safely, measure that and report the limiting factor."
#
# WHAT "No Loaded Region(s)" IS. SWorldPartitionViewportWidget draws it over the level viewport exactly when the
# map streams and UWorldPartition::HasLoadedUserCreatedRegions() is false. This user's per-project settings held
# an EMPTY entry for WL_V2_GoldenArrival_WP2 -- `PerWorldEditorSettings=((".../WL_V2_GoldenArrival_WP2", ()))` --
# so every editor opened the map with nothing loaded.
#
# THE MECHANISM IS THE EDITOR'S OWN. UWonderlandUiTestLibrary::LoadEditorRegions calls
# UWorldPartition::LoadLastLoadedRegions: one user-created shape loader adapter per box, loaded -- the object
# "Load Region From Selection" makes, and what the banner counts -- then writes them to the per-project settings
# the editor restores from. Nothing about the map changes: no actor moves, none becomes always-loaded, the
# runtime grid, HLODs and data layers are untouched. This is editor residency only.
#
# LOADED IN TILES, NEAREST FIRST, WITH A FLOOR. The actors are split into k-d tiles of at most LEAF_MAX actor
# centres; every centre lies inside exactly one tile, and a shape adapter loads every actor whose bounds meet it,
# so the tiles together cover every spatially loaded actor. Between tiles the job reads the machine's available
# memory and STOPS below FLOOR_MB, reporting how far it got -- the founder's "measure that and report the limiting
# factor" instead of an editor that dies halfway through a load.
#
# RESIDENCY IS CHECKED AGAINST DISK, NOT AGAINST THE BANNER. Every actor descriptor (what exists on disk) is
# looked up as a live object (what is in memory). A banner can be cleared by a region that loaded nothing; this
# cannot. HLOD actors are counted separately: they are runtime proxies and are never loaded by editor regions.
#
# NOT CONCURRENT and NOT PIE: editor regions belong to the editor world, and this is the heaviest thing the
# editor can be asked to do.
CONCURRENT = False

import math
import os
import re
import time
import unreal

L = unreal.WonderlandUiTestLibrary
WPL = unreal.WorldPartitionBlueprintLibrary

LEAF_MAX = 2400          # actor centres per tile
# STOP LOADING BELOW THIS MUCH AVAILABLE PHYSICAL MEMORY. Measured before the first run: with the editor up and
# nothing loaded, this 15.7 GB machine already sits near 1,100 MB available (four agent sessions, WSL, a browser)
# and the editor commits 7.4 GB against 3.8 GB resident -- so available memory is not a free-space gauge here, it
# is the last of the standby cache. 350 MB is the point past which Windows is trimming the editor itself.
# Commit charge (47.7 GB limit with the page file) and the editor log are watched from outside the process.
FLOOR_MB = 350
SETTLE_S = 3.0           # after each tile, before memory is read again
# CHANNEL is <project>/Tools/_channel, so the project directory is two levels up.
INI = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "Saved", "Config", "WindowsEditor",
                   "EditorPerProjectUserSettings.ini")
MAP_TAG = "WL_V2_GoldenArrival_WP2.WL_V2_GoldenArrival_WP2"
STOP_FILE = os.path.join(CHANNEL, "STOP_wp_regions")
SHOTS = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "Saved", "Screenshots", "WindowsEditor")
RINGS = ((0.0, 500.0), (500.0, 1500.0), (1500.0, 5000.0), (5000.0, 20000.0), (20000.0, 1.0e9))   # metres


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def field(text, key):
        m = re.search(r"\b%s=([-0-9.]+)" % re.escape(key), text or "")
        return float(m.group(1)) if m else None

    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        RESULT["status"] = "VOID: a play session is running; editor regions load into the editor world between sessions"
        return
    world = ues.get_editor_world()
    if world is None:
        RESULT["status"] = "VOID: no editor world"
        return
    RESULT["map"] = world.get_path_name()

    before = L.describe_editor_regions(world)
    RESULT["before"] = before
    RESULT["memory_before"] = L.describe_memory()
    emit("BEFORE", before)
    actors_before = len(unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors())
    RESULT["level_actors_before"] = actors_before
    yield 0.5

    # ---- WHAT EXISTS ON DISK.
    got = WPL.get_actor_descs()
    descs = got[1] if isinstance(got, tuple) else got
    descs = list(descs or [])
    RESULT["descs_total"] = len(descs)
    if not descs:
        RESULT["status"] = "VOID: the partition returned no actor descriptors -- nothing to measure against"
        return

    def centre(d):
        b = d.bounds
        mn, mx = b.min, b.max
        return ((mn.x + mx.x) * 0.5, (mn.y + mx.y) * 0.5, mn.z, mx.z)

    def loaded(d):
        try:
            return unreal.find_object(None, str(d.actor_path)) is not None
        except Exception:                                           # noqa: BLE001
            return False

    def is_hlod(d):
        return "HLOD" in str(d.native_class.get_name() if d.native_class else d.class_)

    spatial, always, hlod = [], [], []
    for d in descs:
        if is_hlod(d):
            hlod.append(d)
        elif d.is_spatially_loaded:
            spatial.append(d)
        else:
            always.append(d)
    RESULT["descs_spatial"] = len(spatial)
    RESULT["descs_always_loaded"] = len(always)
    RESULT["descs_hlod"] = len(hlod)
    loaded_before = sum(1 for d in spatial if loaded(d))
    RESULT["spatial_loaded_before"] = loaded_before
    emit("DISK", "spatial=%d always=%d hlod=%d loaded_before=%d" % (len(spatial), len(always), len(hlod), loaded_before))
    yield 0.5

    # ---- THE TILES: a k-d split of the spatially loaded actors' centres, every centre in exactly one tile.
    pts = [(c[0], c[1], d) for d in spatial for c in [centre(d)]]
    zmin = min(centre(d)[2] for d in spatial) - 1000.0
    zmax = max(centre(d)[3] for d in spatial) + 1000.0
    x0 = min(p[0] for p in pts) - 100.0
    x1 = max(p[0] for p in pts) + 100.0
    y0 = min(p[1] for p in pts) - 100.0
    y1 = max(p[1] for p in pts) + 100.0

    def kd(items, ax0, ay0, ax1, ay1):
        if len(items) <= LEAF_MAX:
            return [(ax0, ay0, ax1, ay1, len(items))]
        axis = 0 if (ax1 - ax0) >= (ay1 - ay0) else 1
        items.sort(key=lambda t: t[axis])
        m = len(items) // 2
        cut = (items[m - 1][axis] + items[m][axis]) * 0.5
        if axis == 0:
            return kd(items[:m], ax0, ay0, cut, ay1) + kd(items[m:], cut, ay0, ax1, ay1)
        return kd(items[:m], ax0, ay0, ax1, cut) + kd(items[m:], ax0, cut, ax1, ay1)

    leaves = kd(pts, x0, y0, x1, y1)
    leaves.sort(key=lambda t: math.hypot((t[0] + t[2]) * 0.5, (t[1] + t[3]) * 0.5))
    RESULT["tiles_planned"] = len(leaves)
    RESULT["world_extent_m"] = [round(x0 / 100.0), round(y0 / 100.0), round(x1 / 100.0), round(y1 / 100.0)]
    emit("PLAN", "%d tiles over x %.0f..%.0f m, y %.0f..%.0f m" % (len(leaves), x0 / 100, x1 / 100, y0 / 100, y1 / 100))

    def make_box(ax0, ay0, ax1, ay1):
        box = unreal.Box()
        box.set_editor_property("min", unreal.Vector(ax0, ay0, zmin))
        box.set_editor_property("max", unreal.Vector(ax1, ay1, zmax))
        box.set_editor_property("is_valid", True)
        return box

    # ---- LOAD, NEAREST FIRST, READING MEMORY BETWEEN TILES.
    per_tile = []
    RESULT["tiles"] = per_tile
    stopped = None
    for i, (ax0, ay0, ax1, ay1, n) in enumerate(leaves):
        live = ues.get_editor_world()
        if live is None or ues.get_game_world() is not None:
            stopped = "the editor world went away or a play session started at tile %d" % i
            break
        # AN OUTSIDE HAND ON THE BRAKE: a memory watcher running beside the editor drops this file when the machine
        # is paging too hard, and the load stops cleanly between tiles instead of taking the editor down.
        if os.path.isfile(STOP_FILE):
            stopped = "stopped from outside before tile %d of %d: %s" % (i, len(leaves), open(STOP_FILE).read().strip()[:200])
            break
        state = L.describe_editor_regions(live)
        avail = field(state, "available_mb")
        if avail is not None and avail < FLOOR_MB:
            stopped = "available memory %.0f MB is under the %d MB floor before tile %d of %d" % (avail, FLOOR_MB, i, len(leaves))
            break
        t0 = time.time()
        after = L.load_editor_regions(live, [make_box(ax0, ay0, ax1, ay1)])
        seconds = round(time.time() - t0, 1)
        yield SETTLE_S
        after = L.describe_editor_regions(ues.get_editor_world())
        row = {"tile": i, "actors": n,
               "box_m": [round(ax0 / 100), round(ay0 / 100), round(ax1 / 100), round(ay1 / 100)],
               "load_s": seconds,
               "avail_before_mb": avail, "avail_after_mb": field(after, "available_mb"),
               "used_after_mb": field(after, "process_used_mb"), "regions": field(after, "user_regions")}
        per_tile.append(row)
        emit("TILE", row)
    RESULT["stopped"] = stopped

    # ---- WHAT IS IN MEMORY NOW, against what is on disk.
    world = ues.get_editor_world()
    final = L.describe_editor_regions(world)
    RESULT["after"] = final
    RESULT["memory_after"] = L.describe_memory()
    emit("AFTER", final)
    missing = []
    ring_stats = []
    for lo, hi in RINGS:
        ring = []
        for d in spatial:
            c = centre(d)
            dist = math.hypot(c[0], c[1]) / 100.0
            if lo <= dist < hi:
                ring.append(d)
        got_ring = [d for d in ring if loaded(d)]
        ring_stats.append({"ring_m": [lo, hi if hi < 1e8 else "far"], "actors": len(ring), "loaded": len(got_ring)})
        yield 0.2
    RESULT["rings"] = ring_stats
    spatial_loaded = 0
    for d in spatial:
        if loaded(d):
            spatial_loaded += 1
        elif len(missing) < 25:
            c = centre(d)
            missing.append({"label": str(d.label), "class": str(d.native_class.get_name() if d.native_class else ""),
                            "at_m": [round(c[0] / 100), round(c[1] / 100)]})
    RESULT["spatial_loaded_after"] = spatial_loaded
    RESULT["missing_examples"] = missing
    always_loaded = sum(1 for d in always if loaded(d))
    RESULT["always_loaded_resident"] = always_loaded
    actors_after = len(unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors())
    RESULT["level_actors_after"] = actors_after

    # the farthest real actors, named, so a reader can check them in the outliner
    far = sorted(spatial, key=lambda d: -math.hypot(centre(d)[0], centre(d)[1]))[:8]
    RESULT["farthest"] = [{"label": str(d.label), "class": str(d.native_class.get_name() if d.native_class else ""),
                           "dist_m": round(math.hypot(centre(d)[0], centre(d)[1]) / 100.0), "resident": loaded(d)}
                          for d in far]

    # ---- PHOTOGRAPHS OF THE LOADED WORLD, from the level viewport itself (HighResShot renders the viewport, so it
    # needs no window focus). The plaza from above, then the farthest real actor in each of three directions.
    photos = []
    RESULT["photos"] = photos

    def newest_shot(before):
        try:
            got = [os.path.join(SHOTS, f) for f in os.listdir(SHOTS) if f.lower().endswith(".png")]
        except OSError:
            return None
        got = [p for p in got if os.path.getmtime(p) > before]
        return max(got, key=os.path.getmtime) if got else None

    def photograph(label, where, look_from):
        t0 = time.time()
        rot = unreal.MathLibrary.find_look_at_rotation(look_from, where)
        ues.set_level_viewport_camera_info(look_from, rot)
        yield 3.0
        unreal.SystemLibrary.execute_console_command(ues.get_editor_world(), "HighResShot 1600x900")
        yield 6.0
        shot = newest_shot(t0)
        photos.append({"label": label, "file": shot, "at_m": [round(where.x / 100), round(where.y / 100)]})
        emit("PHOTO", label, shot)

    cam_before = ues.get_level_viewport_camera_info()
    yield from photograph("plaza_overview", unreal.Vector(0.0, 0.0, 0.0), unreal.Vector(-9000.0, -9000.0, 7000.0))
    sectors = {}
    for d in spatial:
        c = centre(d)
        ang = (math.degrees(math.atan2(c[1], c[0])) + 360.0) % 360.0
        k = int(ang // 120.0)
        dist = math.hypot(c[0], c[1])
        if dist > sectors.get(k, (0.0, None))[0]:
            sectors[k] = (dist, d)
    for k, (dist, d) in sorted(sectors.items()):
        c = centre(d)
        target = unreal.Vector(c[0], c[1], (c[2] + c[3]) * 0.5)
        away = unreal.Vector(-c[0], -c[1], 0.0)
        norm = max(math.hypot(away.x, away.y), 1.0)
        eye = unreal.Vector(c[0] + away.x / norm * 4000.0, c[1] + away.y / norm * 4000.0, target.z + 2500.0)
        yield from photograph("far_sector_%d_%s" % (k, str(d.label)[:40]), target, eye)
    try:
        if cam_before and len(cam_before) >= 2:
            ues.set_level_viewport_camera_info(cam_before[-2], cam_before[-1])
    except Exception:                                               # noqa: BLE001
        pass

    persisted = None
    try:
        with open(INI, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if line.startswith("PerWorldEditorSettings=") and MAP_TAG in line:
                    persisted = line.strip()[:4000]
    except OSError as err:
        persisted = "unreadable: %s" % err
    RESULT["persisted_line"] = persisted

    regions = field(final, "user_regions") or 0
    record("R01", "the map has user-loaded editor regions, so 'No Loaded Region(s)' no longer applies",
           field(final, "has_user_regions") == 1 and regions >= 1,
           regions=regions, before=before, after=final,
           note="SWorldPartitionViewportWidget shows the banner exactly while HasLoadedUserCreatedRegions() is false.")
    record("R02", "every spatially loaded actor on disk is a live object in the editor (genuine residency)",
           spatial_loaded == len(spatial) and stopped is None,
           resident=spatial_loaded, on_disk=len(spatial), loaded_before=loaded_before,
           level_actors_before=actors_before, level_actors_after=actors_after, missing=missing[:10])
    record("R03", "the distant rings are resident too, not only the plaza",
           all(r["actors"] == r["loaded"] for r in ring_stats), rings=ring_stats, farthest=RESULT["farthest"])
    avail_end = field(final, "available_mb")
    record("R04", "the load finished above the memory floor (it did not exhaust the machine)",
           stopped is None and avail_end is not None and avail_end >= FLOOR_MB * 0.8,
           stopped=stopped, available_mb_end=avail_end, used_mb_end=field(final, "process_used_mb"),
           floor_mb=FLOOR_MB, tiles_loaded=len(per_tile), tiles_planned=len(leaves))
    record("R05", "the regions are saved where the editor restores them from",
           persisted is not None and "LoadedEditorRegions" in (persisted or ""),
           persisted=(persisted or "")[:600], ini=INI)
    record("R06", "streaming and the always-loaded set are unchanged (editor residency only)",
           field(final, "streaming") == 1 and always_loaded == len(always),
           streaming=field(final, "streaming"), always_loaded=len(always), always_resident=always_loaded)
    RESULT["status"] = "measured" if all(t["pass"] for t in tests) else "FAIL"
