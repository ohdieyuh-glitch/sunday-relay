# SUPERSEDED BY zc_wp_state, 2026-09-27 -- KEPT ONLY SO THE RETIREMENT IS VISIBLE.
#
# This probe reads World Partition through Python, which in UE 5.8 cannot reach it: every name comes back
# None, and the job rendered None as "not partitioned" and "streaming not enabled". zc_wp_state asks the
# same question through a C++ UFUNCTION that actually reads the world, and passes in editor and PIE
# (partitioned=1 streaming=1 runtimeHash=WorldPartitionRuntimeHashSet). Two gates answering one question in
# opposite directions is how QA came to report the shipping map as fully resident twelve minutes after it
# had been measured streaming, and the founder has since ruled that this artifact must never lower readiness
# again. So it no longer asserts anything: it records that it is superseded and by what, and exits.
#
# (Original header follows, for the record.)
# HOW IS WORLD PARTITION ACTUALLY CONFIGURED ON THIS MAP?
#
# Before splitting a single actor, the cheaper question: is the runtime grid set up at all? The map was
# converted with RuntimeHashClass=WorldPartitionRuntimeHashSet, which is UE5's newer hash and takes its grid
# from RUNTIME PARTITIONS in World Settings rather than from a cell size in the ini. A hash set with no
# partition configured has nowhere to put an actor except the always-loaded set -- which would produce exactly
# the reading zc_streaming gets, 21,089 actors resident at every stop, and would do so no matter how small
# the actors were.
#
# That matters because the two causes have very different costs. A missing grid is a settings change. Actors
# too big to page means rewriting the world's batching. This asks which it is, and touches nothing.
#
# Read in the EDITOR world, not PIE: the runtime hash is an editor-side object and PIE gets a generated copy.
CONCURRENT = True

import unreal


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests
    RESULT["superseded_by"] = "zc_wp_state"
    tests.append({"id": "C00", "name": "SUPERSEDED: this probe cannot observe World Partition from Python; "
                                        "zc_wp_state is the authoritative reading", "pass": True,
                  "detail": {"superseded_by": "zc_wp_state", "failed_question": "measurement mechanism actually capable? NO",
                             "decided": "founder, 2026-09-27"}})
    RESULT["status"] = "SUPERSEDED by zc_wp_state"
    yield 0.2
    return

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    world = ues.get_editor_world()
    RESULT["editor_world"] = str(world.get_name()) if world else None
    if world is None:
        record("C00", "the editor world is reachable", False)
        RESULT["status"] = "FAIL"
        return
    record("C00", "the editor world is reachable", True, world=RESULT["editor_world"])

    settings = None
    try:
        settings = unreal.GameplayStatics.get_world_settings(world)
        RESULT["world_settings"] = str(settings.get_name()) if settings else None
    except Exception as err:                                       # noqa: BLE001
        RESULT["world_settings_error"] = str(err)[:200]

    # ---- EVERY PROPERTY WE CAN REACH THAT MENTIONS PARTITION OR STREAMING.
    found = {}
    RESULT["properties"] = found
    for holder, label in ((settings, "WorldSettings"), (world, "World")):
        if holder is None:
            continue
        for name in ("world_partition", "enable_world_bounds_checks", "is_partitioned_world",
                     "instanced_foliage_grid_size", "navigation_data_chunk_generation_mode",
                     "default_runtime_partition", "runtime_partitions", "streaming_generation"):
            try:
                got = holder.get_editor_property(name)
                found["%s.%s" % (label, name)] = str(got)[:200]
            except Exception as err:                               # noqa: BLE001
                found["%s.%s" % (label, name)] = "?" + str(err)[:80]

    # ---- AND THE PARTITION OBJECT ITSELF, however it can be reached.
    wp = None
    for how in ("get_world_partition",):
        try:
            wp = getattr(unreal.WorldPartitionBlueprintLibrary, how)()
            break
        except Exception as err:                                   # noqa: BLE001
            RESULT.setdefault("reach", []).append("%s: %s" % (how, str(err)[:90]))
    if wp is None:
        for obj in unreal.find_objects_by_class(unreal.WorldPartition) if hasattr(unreal, "find_objects_by_class") else []:
            wp = obj
            break
    if wp is None:
        try:
            found_objs = [o for o in unreal.find_asset_data if False]
        except Exception:
            pass
    RESULT["world_partition_object"] = type(wp).__name__ if wp is not None else None

    if wp is not None:
        for name in ("runtime_hash", "editor_hash", "default_hlod_layer", "enable_streaming",
                     "server_streaming_mode", "streaming_policy_class"):
            try:
                got = wp.get_editor_property(name)
                RESULT.setdefault("partition", {})[name] = str(got)[:220]
            except Exception as err:                               # noqa: BLE001
                RESULT.setdefault("partition", {})[name] = "?" + str(err)[:90]
        try:
            hash_obj = wp.get_editor_property("runtime_hash")
            if hash_obj is not None:
                RESULT["runtime_hash_class"] = type(hash_obj).__name__
                for name in ("runtime_partitions", "grids", "hlod_setups"):
                    try:
                        got = hash_obj.get_editor_property(name)
                        RESULT.setdefault("runtime_hash", {})[name] = str(got)[:400]
                    except Exception as err:                       # noqa: BLE001
                        RESULT.setdefault("runtime_hash", {})[name] = "?" + str(err)[:90]
        except Exception as err:                                   # noqa: BLE001
            RESULT["runtime_hash_error"] = str(err)[:200]

    emit("C_CFG", "INFO", "what the level says about partition",
         {"partition": RESULT.get("partition"), "runtime_hash": RESULT.get("runtime_hash"),
          "class": RESULT.get("runtime_hash_class")})

    record("C01", "world partition is reachable and reports a runtime hash",
           RESULT.get("runtime_hash_class") is not None,
           partition_object=RESULT.get("world_partition_object"),
           runtime_hash=RESULT.get("runtime_hash_class"),
           note="a partitioned map with no runtime hash, or a hash set with no runtime partition, has nowhere "
                "to put an actor except the always-loaded set -- which is what zero streaming looks like")

    record("C02", "streaming is enabled on the partition",
           str(RESULT.get("partition", {}).get("enable_streaming")).lower() in ("true", "1"),
           enable_streaming=RESULT.get("partition", {}).get("enable_streaming"),
           note="the single switch that turns the whole thing off")

    RESULT["status"] = "measured"
    yield 0.5
