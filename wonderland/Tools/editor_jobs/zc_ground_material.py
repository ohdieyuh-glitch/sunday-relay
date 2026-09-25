# WHAT IS THE FLAT GREEN GROUND MADE OF?
#
# The beta walk passes 5/5 and has for a while. It checks that the world is a disc of real size, that there
# are no empty areas, and that the Dog stands on ground everywhere it is put down. All true, and none of it
# looks at the picture.
#
# The picture at 659 m ("TOWARD EAST REACH") is a flat untextured green plane running to the horizon, while
# the plaza at 284 m is cobbles with grass in the joints, lanterns and mouldings. Both pass "there is a floor
# here". Only one of them is finished, and P2 item 13 asks for floors, materials and polish, not just floors.
#
# So this asks the ground what it is, at a spread of radii, rather than my guessing from a screenshot: the
# actor it belongs to, the component, the mesh, and the material actually on it. Then the difference between
# the finished plaza and the unfinished reach is a name I can go and fix, instead of an impression.
CONCURRENT = True

import math
import unreal

L = unreal.WonderlandUiTestLibrary

HIT_BLOCKING, HIT_LOCATION, HIT_COMPONENT, HIT_ACTOR = 0, 4, 10, 9

#: The walk's own bearing, and radii spanning the finished centre out to the reach.
BEARING_DEG = 45.0
RADII_M = (30.0, 120.0, 284.0, 420.0, 560.0, 659.0, 780.0, 900.0, 1050.0)


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
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 5.0

    found = []
    RESULT["ground"] = found
    rad = math.radians(BEARING_DEG)

    for metres in RADII_M:
        x = math.cos(rad) * metres * 100.0
        y = math.sin(rad) * metres * 100.0
        hit = unreal.SystemLibrary.line_trace_single(
            world, unreal.Vector(x, y, 4000.0), unreal.Vector(x, y, -6000.0),
            unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [], unreal.DrawDebugTrace.NONE, True)
        row = {"radius_m": metres}
        if hit is None:
            row["hit"] = False
            found.append(row)
            yield 0.0
            continue
        try:
            t = hit.to_tuple()
        except Exception:
            row["hit"] = False
            found.append(row)
            continue
        row["hit"] = bool(t[HIT_BLOCKING])
        if not row["hit"]:
            found.append(row)
            continue
        row["z"] = round(float(t[HIT_LOCATION].z), 1)
        actor = t[HIT_ACTOR]
        comp = t[HIT_COMPONENT]
        try:
            row["actor"] = str(actor.get_actor_label())[:44] if actor is not None else None
        except Exception:
            row["actor"] = str(actor.get_name())[:44] if actor is not None else None
        # THE MATERIAL IS THE POINT. A floor with the right mesh and a default material still reads as
        # untextured, which is exactly what the reach looks like.
        if comp is not None:
            try:
                row["component"] = str(comp.get_name())[:40]
            except Exception:
                pass
            try:
                mesh = comp.get_editor_property("static_mesh")
                row["mesh"] = str(mesh.get_name())[:40] if mesh is not None else None
            except Exception:
                row["mesh"] = None
            mats = []
            try:
                for i in range(int(comp.get_num_materials())):
                    m = comp.get_material(i)
                    mats.append(str(m.get_name())[:40] if m is not None else None)
            except Exception as err:                               # noqa: BLE001
                row["material_error"] = str(err)[:90]
            row["materials"] = mats
        found.append(row)
        emit("G_%04.0fm" % metres, "INFO", "ground at %.0f m" % metres, row)
        yield 0.1

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
