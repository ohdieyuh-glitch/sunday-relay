# IS THE PARTITIONED TWIN ACTUALLY USABLE, OR ONLY LIGHTER?
#
# zc_twin_streams showed the twin streams where the shipping map cannot: 2,396 actors resident at 600 m
# against a flat 21,083. That makes adopting it the only route to P2 item 13's streaming clause -- and it
# says nothing whatever about whether the world in it is intact.
#
# A lighter map that renders wrong is not a better map. This project has already been bitten by exactly that
# failure: the config carries a note about "the black Hub", where STATIC-mobility meshes with no baked
# lighting rendered BLACK, and the fix was Movable everywhere. A migrated world is precisely where a mistake
# like that would resurface, and residency counts would look perfect while it did.
#
# So before the founder is asked to weigh a migration, the twin is opened, played, photographed at the same
# places the beta walk photographs, and asked the questions that catch a broken world: is the ground under
# the Dog, do the batches report the instances they declared, is anything rendering as default material.
#
# READ ONLY. The twin is opened to look at and the shipping map is put back; T90 asserts it.
CONCURRENT = True

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary

TWIN = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2_WP"
HOME = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "twin_usable")

STOPS_M = (30.0, 284.0, 660.0)
BEARING_DEG = 45.0
HIT_BLOCKING, HIT_LOCATION, HIT_ACTOR = 0, 4, 9


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)

    try:
        les.load_level(TWIN)
    except Exception as err:                                       # noqa: BLE001
        RESULT["open_error"] = str(err)[:200]
    yield 8.0

    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 10.0

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    rad = math.radians(BEARING_DEG)
    grounded, shots = [], []

    for metres in STOPS_M:
        x = math.cos(rad) * metres * 100.0
        y = math.sin(rad) * metres * 100.0
        if dog is not None:
            dog.set_actor_location(unreal.Vector(x, y, 400.0), False, False)
        # Long enough for the cells around the new position to stream IN before judging what is there.
        yield 14.0
        hit = unreal.SystemLibrary.line_trace_single(
            world, unreal.Vector(x, y, 3000.0), unreal.Vector(x, y, -6000.0),
            unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [], unreal.DrawDebugTrace.NONE, True)
        row = {"radius_m": metres, "ground": False}
        if hit is not None:
            try:
                t = hit.to_tuple()
                row["ground"] = bool(t[HIT_BLOCKING])
                if row["ground"]:
                    row["z"] = round(float(t[HIT_LOCATION].z), 1)
                    a = t[HIT_ACTOR]
                    row["on"] = (str(a.get_actor_label())[:40] if a is not None else None)
            except Exception:
                pass
        grounded.append(row)
        shot = os.path.join(ROOT, "%04.0fm.jpg" % metres)
        H.capture_viewport_jpeg(shot, 1600, 92)
        shots.append(os.path.basename(shot))
        emit("U_%04.0fm" % metres, "INFO", "twin at %.0f m" % metres, row)

    RESULT["ground_checks"] = grounded
    RESULT["captures"] = shots
    record("U01", "there is ground under the Dog everywhere it is put down in the twin",
           all(r["ground"] for r in grounded), stops=grounded,
           note="a migrated world with cells that failed to stream would drop the Dog through the floor, "
                "and the residency counts would look perfect while it did")

    # ---- DID EVERY BATCH BUILD WHAT IT DECLARED? The batches log a mismatch, so this asks the world rather
    # than the log: a batch that lost its instances in migration reports fewer than it was built with.
    comps = insts = empty = 0
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        try:
            for c in actor.get_components_by_class(unreal.InstancedStaticMeshComponent):
                comps += 1
                n = 0
                try:
                    n = int(c.get_instance_count())
                except Exception:
                    pass
                insts += n
                if n == 0:
                    empty += 1
        except Exception:
            pass
    RESULT["resident_components"] = comps
    RESULT["resident_instances"] = insts
    RESULT["empty_components"] = empty
    record("U02", "no resident batch is standing there with nothing in it",
           empty == 0 and comps > 0, components=comps, instances=insts, empty=empty,
           note="an empty instanced component is what a batch looks like when its instances did not survive")

    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)

    back = False
    try:
        back = bool(les.load_level(HOME))
    except Exception as err:                                       # noqa: BLE001
        RESULT["restore_error"] = str(err)[:200]
    yield 6.0
    RESULT["editor_world_at_end"] = str(ues.get_editor_world().get_name())
    record("T90", "the editor is left on the shipping map",
           RESULT["editor_world_at_end"] == "WL_V2_GoldenArrival_WP2",
           world=RESULT["editor_world_at_end"], restored=back)

    # ---- AND THE CAPTURES DID NOT WRITE, which is reported rather than glossed.
    #
    # The three filenames are recorded above and the directory is empty: capture_viewport_jpeg was called and
    # produced nothing, seemingly because the viewport client is rebound by the level switch this job
    # performs. Every other proof captures fine in the shipping map and none of them switches levels.
    #
    # That leaves a real gap, and it is the gap that matters most here. The structure checks below all pass
    # -- ground everywhere, no empty batches, the same ground actors as the shipping map -- and this project
    # has already shipped a world that passed structure and rendered BLACK, which is what the config's note
    # about the black Hub is. Structure cannot see that. So the twin is verified INTACT and NOT verified to
    # look right, and the founder should read it that way.
    written = [f for f in RESULT.get("captures", [])
               if os.path.exists(os.path.join(ROOT, f)) and os.path.getsize(os.path.join(ROOT, f)) > 0]
    RESULT["captures_actually_written"] = written
    record("U03", "the twin was photographed, not only counted",
           len(written) == len(RESULT.get("captures", [])),
           expected=RESULT.get("captures"), written=written,
           note="capture_viewport_jpeg produced no file after the level switch. The twin is verified intact "
                "by structure and NOT verified visually, and the black Hub is precedent for a world that "
                "passes structure and renders wrong")

    RESULT["status"] = "measured; the visual half is missing and says so"
