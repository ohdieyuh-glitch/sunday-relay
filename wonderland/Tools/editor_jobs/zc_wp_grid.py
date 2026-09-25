# READ THE RUNTIME GRID, WHICH IS THE ONE THING STILL UNMEASURED ABOUT THE TWIN.
#
# Row H's original finding was phrased in exactly these terms: "Confirmed in-engine: world_partition: None,
# runtime grid {'None': 20858}." That second number is a bucket count of every actor's runtime_grid property
# -- the grid an actor is assigned to for streaming. All 20,858 in "None" is what an unpartitioned map looks
# like: nothing belongs to a grid, so nothing streams.
#
# I have said three times now that the twin's runtime grid "has not been read in-engine". It is readable, by
# the same route the original measurement used, so it is read here rather than repeated as a caveat.
#
# SAME SAFETY AS zc_wp_walk: the twin is opened, measured, and the authoritative map is opened again as the
# last act. Nothing is saved to either and no config is touched.
AUTHORITATIVE = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"
TWIN = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2_WP"


def grid_buckets(world):
    """Every actor's runtime_grid, counted -- the shape row H reported."""
    buckets = {}
    unreadable = 0
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        try:
            g = a.get_editor_property("runtime_grid")
            key = str(g) if g else "None"
        except Exception:
            unreadable += 1
            continue
        if key in ("", "None"):
            key = "None"
        buckets[key] = buckets.get(key, 0) + 1
    return buckets, unreadable


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    RESULT["status"] = "running"

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)

    # ---- the authoritative map, which is the one already open.
    a_buckets, a_bad = grid_buckets(ues.get_editor_world())
    RESULT["authoritative_runtime_grid"] = a_buckets
    RESULT["authoritative_unreadable"] = a_bad

    # ---- the twin.
    opened = bool(les.load_level(TWIN))
    RESULT["twin_opened"] = opened
    yield 4.0
    if opened:
        b_buckets, b_bad = grid_buckets(ues.get_editor_world())
        RESULT["twin_runtime_grid"] = b_buckets
        RESULT["twin_unreadable"] = b_bad
    else:
        b_buckets, b_bad = {}, 0

    # ---- and put the authoritative map back, unconditionally.
    back = bool(les.load_level(AUTHORITATIVE))
    yield 4.0
    RESULT["restored_authoritative"] = back

    a_none = a_buckets.get("None", 0)
    a_total = sum(a_buckets.values()) or 1
    b_none = b_buckets.get("None", 0)
    b_total = sum(b_buckets.values()) or 1

    # ---- WHAT runtime_grid ACTUALLY MEANS, corrected after this job's first run said the wrong thing.
    #
    # The first version asserted that a partitioned map would show its actors assigned to a NAMED grid and
    # an unpartitioned one would show them all under "None". Both maps read "None" for every actor, and the
    # reason is that an empty runtime_grid means "use the DEFAULT grid" -- it is not a statement about
    # whether the world is partitioned at all. So row H's original "{'None': 20858}" did not prove the map
    # unpartitioned either; the "world_partition: None" beside it did.
    #
    # WHAT DOES DISCRIMINATE is how many actors are resident when the map is merely OPENED. An unpartitioned
    # map has no choice: every actor is in the package, so opening it loads all of them. A partitioned map
    # loads the always-loaded set and streams the rest per region. That contrast is the whole of row H's
    # complaint -- "every actor is permanently resident" -- and it is enormous here.
    RESULT["runtime_grid_note"] = (
        "an empty runtime_grid means the DEFAULT grid, not 'unstreamed'; it does not discriminate")
    RESULT["authoritative_resident_on_open"] = a_total
    RESULT["twin_resident_on_open"] = b_total
    RESULT["twin_external_actor_files"] = 21047

    record("G01", "the twin opened and its actors could be read", opened and b_total > 0,
           actors_seen=b_total)
    record("G02", "opening the authoritative map loads its entire population, which is row H's complaint",
           a_total > 20000, resident_on_open=a_total, buckets=a_buckets)
    record("G03", "opening the twin loads a small fraction, the rest arriving by region",
           0 < b_total < a_total * 0.25,
           resident_on_open=b_total, of_external_actor_files=21047,
           pct=round(100.0 * b_total / 21047.0, 1),
           note="runtime_grid is 'None' in BOTH maps and means the default grid, not unstreamed")
    record("G04", "the authoritative map is open again, nothing saved to either", back)

    RESULT["status"] = "measured"
