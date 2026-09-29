# DISTANT VIEWS AT TWO LOADING RANGES -- the founder's decision after the streaming fix (f97ba360), shown not told.
#
# Correct streaming pages each batch by its real bounds, so with MainPartition's 512 m loading range and no HLODs a
# vantage in the core holds ~85 % of the world's instances and one at 800 m ~35 % (WORLD session's table). Before
# the fix everything sat in the always-resident origin cell, so views FROM the core showed everything (and the
# world beyond ~700 m did not exist when you went there). This photographs the same vantages at the map's own
# range and at 1,024 m, with the loaded-batch count and process memory for each, using the RUNTIME-ONLY override
# wp.Runtime.OverrideRuntimeLoadingRange (non-shipping; cleared when the play world ends). No map edit.
CONCURRENT = False
import math
import os
import unreal

ROOT = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "Tools", "captures", "zc", "distant_views_0928")
VANTAGES = (
    # label, pawn stand (x, y), camera eye, camera target
    ("plaza_toward_icarus", (0.0, 6000.0), (0.0, 4000.0, 3000.0), (0.0, 70000.0, 800.0)),
    ("rim_toward_noctis", (-30000.0, -17000.0), (-28000.0, -16000.0, 2600.0), (-80000.0, -46000.0, 800.0)),
    ("rim_toward_tartarus", (30000.0, -17000.0), (28000.0, -16000.0, 2600.0), (80000.0, -46000.0, 800.0)),
    ("march_toward_rear", (0.0, -52000.0), (0.0, -50000.0, 3500.0), (0.0, -110000.0, 600.0)),
)
RANGES = (("map_512m", None), ("override_1024m", 102400))


def job():
    SL = unreal.SystemLibrary
    L = unreal.WonderlandUiTestLibrary
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    os.makedirs(ROOT, exist_ok=True)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    L.focus_game_viewport()
    yield 6.0
    rows = []
    RESULT["rows"] = rows

    def alive():
        w = ues.get_game_world()
        if w is None:
            return None, None
        p = unreal.GameplayStatics.get_player_pawn(w, 0)
        return (w, p) if p is not None else (None, None)

    for label, stand, eye, target in VANTAGES:
        for rlabel, rng in RANGES:
            w, pawn = alive()
            if w is None:
                rows.append({"vantage": label, "range": rlabel, "void": "no play world"})
                break
            SL.execute_console_command(w, "wp.Runtime.OverrideRuntimeLoadingRange -grid=MainPartition -range=%d"
                                       % (rng if rng else -1))
            pawn.set_actor_location(unreal.Vector(stand[0], stand[1], 400.0), False, True)
            L.pose_camera(w, unreal.Vector(*eye), unreal.Vector(*target), 70.0)
            yield 1.0
            SL.execute_console_command(w, "FlushLevelStreaming")
            yield 2.0
            # WAIT ON WORLD PARTITION ITSELF, not on a delay: every proxy (flush, a fixed wait, two readings that
            # agree) has been fooled on this map. Capped at 30 s; the result says if it never completed.
            done = [False]

            def streamed():
                ww = ues.get_game_world()
                done[0] = ww is not None and L.is_world_partition_streaming_complete(ww)
                return done[0]

            try:
                yield (streamed, 30.0)
            except TimeoutError:
                pass
            yield 2.0
            w, pawn = alive()
            if w is None:
                rows.append({"vantage": label, "range": rlabel, "void": "play world died"})
                break
            batches = unreal.GameplayStatics.get_all_actors_of_class(w, unreal.WonderlandInstancedBatch)
            inst = 0
            for b in batches:
                try:
                    inst += int(b.get_editor_property("built_instances"))
                except Exception:                                   # noqa: BLE001
                    pass
            mem = str(L.describe_editor_regions(ues.get_editor_world()))
            used = mem.split("process_used_mb=")[1].split(" ")[0] if "process_used_mb=" in mem else "?"
            unreal.GameplayStatics.set_game_paused(w, True)
            yield 0.5
            path = os.path.join(ROOT, "%s_%s.png" % (label, rlabel))
            L.capture_game_viewport(path)
            unreal.GameplayStatics.set_game_paused(w, False)
            row = {"vantage": label, "range": rlabel, "streaming_complete": done[0],
                   "batches_loaded": len(batches), "instances_built": inst,
                   "process_used_mb": used, "shot": os.path.basename(path) if os.path.isfile(path) else None}
            rows.append(row)
            emit("VIEW", row)
    w, pawn = alive()
    if w is not None:
        SL.execute_console_command(w, "wp.Runtime.OverrideRuntimeLoadingRange -grid=MainPartition -range=-1")
        L.release_camera(w)
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 120)
    RESULT["status"] = "measured" if rows and all(r.get("shot") for r in rows) else "PARTIAL"
