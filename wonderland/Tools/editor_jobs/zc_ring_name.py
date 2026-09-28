# WHAT IS THE RING, BY NAME?
#
# It is world geometry, not an effect: the capture shows solid voxel stepping along its whole length, and the
# Dog stands OUTSIDE it, to the right. "Centred on the Dog" was a misreading of a frame where the Dog
# happened to be behind it. So flames, water and light pools are all ruled out by the picture, and the useful
# question is no longer whose lane it is but what the actor is called.
#
# NO PIE NEEDED beyond a world to read; this enumerates actors near the spawn and reports the big ones.
CONCURRENT = False

import math
import unreal

L = unreal.WonderlandUiTestLibrary
RADIUS = 1400.0


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    yield 6.0
    world = ues.get_game_world()
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    if dog is None:
        RESULT["status"] = "VOID: no pawn"
        return
    here = dog.get_actor_location()
    RESULT["spawn"] = [round(here.x, 1), round(here.y, 1), round(here.z, 1)]

    near = []
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        try:
            loc = actor.get_actor_location()
        except Exception:                                           # noqa: BLE001
            continue
        d = math.hypot(loc.x - here.x, loc.y - here.y)
        if d > RADIUS:
            continue
        try:
            label = str(actor.get_actor_label())
        except Exception:                                           # noqa: BLE001
            label = str(actor.get_name())
        cls = actor.get_class().get_name()
        size = None
        try:
            origin, extent = actor.get_actor_bounds(False)
            size = [round(extent.x * 2, 0), round(extent.y * 2, 0), round(extent.z * 2, 0)]
        except Exception:                                           # noqa: BLE001
            pass
        near.append({"label": label, "class": cls, "dist_uu": round(d, 1), "size_uu": size,
                     "z": round(loc.z, 1)})
    near.sort(key=lambda r: r["dist_uu"])
    RESULT["actors_near_spawn"] = near[:40]
    # The ring is tall and wide and roughly square in the frame, so pick out the sizeable upright things.
    upright = [r for r in near
               if r.get("size_uu") and r["size_uu"][2] >= 200.0
               and max(r["size_uu"][0], r["size_uu"][1]) >= 200.0]
    RESULT["big_upright_things_near_spawn"] = upright[:20]
    emit("N_NEAR", "INFO", "sizeable actors near the spawn",
         {"count": len(near), "upright": [u["label"] for u in upright[:12]]})

    tests.append({"id": "N00", "name": "actors near the spawn were enumerated",
                  "pass": bool(near), "detail": {"found": len(near), "radius_uu": RADIUS}})
    emit("N00", "PASS" if near else "FAIL", "actors near the spawn were enumerated",
         {"found": len(near)})

    RESULT["status"] = "measured"
    yield 1.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
