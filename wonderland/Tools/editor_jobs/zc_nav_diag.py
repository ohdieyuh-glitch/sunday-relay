# WHY IS THERE A NAVMESH ACTOR AND NO NAVIGABLE SURFACE?
#
# zc_nav_invoker added the bounds volume, saw RecastNavMesh-Default appear in 2.0 s, and then found no route
# on any of six bearings. A navmesh ACTOR appearing in two seconds is not the same thing as navmesh TILES
# being built -- the actor is created by the navigation system as soon as it has bounds to work with, whether
# or not it has generated anything inside them.
#
# So this asks the three questions that separate those cases, rather than waiting longer and hoping:
#   does the Dog actually carry the invoker component the C++ constructor adds?
#   is there a navigable surface under the Dog at all, which projection answers directly?
#   and does waiting substantially longer change either answer?
CONCURRENT = True

import time
import unreal

L = unreal.WonderlandUiTestLibrary


def job():
    RESULT["status"] = "running"
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    gw = ues.get_game_world()
    L.focus_game_viewport()
    yield 3.0

    dogs = unreal.GameplayStatics.get_all_actors_of_class(gw, unreal.RelayDogCharacter)
    dog = dogs[0] if dogs else unreal.GameplayStatics.get_player_pawn(gw, 0)
    RESULT["dog"] = str(dog.get_name())

    # ---- 1. DOES THE DOG CARRY THE INVOKER?
    comps = []
    try:
        for c in dog.get_components_by_class(unreal.ActorComponent):
            comps.append(str(c.get_name()))
    except Exception as err:                                       # noqa: BLE001
        RESULT["component_error"] = str(err)[:160]
    RESULT["dog_components"] = comps
    RESULT["has_invoker"] = any("NavInvoker" in n or "Invoker" in n for n in comps)

    # ---- 2. IS THERE A SURFACE UNDER IT? Projection is the direct question: it snaps a point to the
    # nearest navigable poly, so it succeeds only where tiles have actually been built.
    def probe(label):
        here = dog.get_actor_location()
        out = {"at": [round(float(here.x), 1), round(float(here.y), 1), round(float(here.z), 1)]}
        try:
            p = unreal.NavigationSystemV1.project_point_to_navigation(
                gw, here, None, unreal.Vector(2000.0, 2000.0, 2000.0))
            out["projected"] = [round(float(p.x), 1), round(float(p.y), 1), round(float(p.z), 1)] if p is not None else None
        except Exception as err:                                   # noqa: BLE001
            out["project_error"] = str(err)[:120]
        try:
            r = unreal.NavigationSystemV1.get_random_reachable_point_in_radius(gw, here, 3000.0)
            out["random_reachable"] = [round(float(r.x), 1), round(float(r.y), 1)] if r is not None else None
        except Exception as err:                                   # noqa: BLE001
            out["random_error"] = str(err)[:120]
        meshes = unreal.GameplayStatics.get_all_actors_of_class(gw, unreal.RecastNavMesh)
        out["recast_actors"] = len(meshes)
        for m in meshes:
            try:
                out["tile_count"] = int(m.get_editor_property("tile_number_hard_limit"))
            except Exception:
                pass
        emit(label, "INFO", label, out)
        return out

    RESULT["immediately"] = probe("D01_immediately")

    # ---- 3. DOES TIME HELP? Sampled rather than waited out blind, so the answer says WHEN it appeared.
    marks = {}
    started = time.time()
    for wait in (15, 30, 45, 60, 90):
        while time.time() - started < wait:
            yield 2.0
        marks["after_%ds" % wait] = probe("D02_after_%ds" % wait)
        if marks["after_%ds" % wait].get("projected") is not None:
            break
    RESULT["over_time"] = marks

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
