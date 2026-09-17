# PIE probe: WHAT STANDS BETWEEN THE MISSION CAMERA AND THE CONTRACT at the castle_approach site.
#
# The b4f88ca6 inspection lifted the camera up to 32 degrees at some bearings, into near top-down views, because a trace
# from the Contract to the camera hit something even 700 uu up. This maps it: from the Contract's heart out to every
# bearing, at the distances and heights the mission camera uses, the first thing each trace hits -- on the WorldStatic
# object type and on the Camera channel -- with the actor, the component and its mesh.
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "camera_occluders")
CONTRACT = globals().get("CONTRACT") or (-40.0, 6340.0, 121.0)
DISTANCES = globals().get("DISTANCES") or [450.0, 650.0, 950.0, 1300.0]
HEIGHTS = globals().get("HEIGHTS") or [130.0, 275.0, 450.0, 700.0]


def job():
    os.makedirs(ROOT, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 6.0
        world = ues.get_game_world()
        dog = unreal.GameplayStatics.get_player_pawn(world, 0)
        # The same site the inspection plays Scenario D at; give the world round it time to stream in.
        unreal.SystemLibrary.execute_console_command(world, "wl.Mission.Site %s" % (globals().get("SITE") or "castle_approach"))
        yield 8.0
        RESULT["dog_at"] = [round(dog.get_actor_location().x), round(dog.get_actor_location().y), round(dog.get_actor_location().z)]
        heart = unreal.Vector(*CONTRACT)

        def describe(hit):
            if hit is None:
                return None
            parts = list(hit.to_tuple())
            actor = next((p for p in parts if isinstance(p, unreal.Actor)), None)
            comp = next((p for p in parts if isinstance(p, unreal.PrimitiveComponent)), None)
            if actor is None and comp is not None:
                actor = comp.get_owner()
            loc = next((p for p in parts if isinstance(p, unreal.Vector)), None)
            mesh = None
            if isinstance(comp, unreal.StaticMeshComponent):
                sm = comp.get_editor_property("static_mesh")
                mesh = sm.get_name() if sm else None
            return {
                "actor": actor.get_actor_label() if actor and hasattr(actor, "get_actor_label") else (actor.get_name() if actor else None),
                "class": actor.get_class().get_name() if actor else None,
                "component": comp.get_name() if comp else None,
                "mesh": mesh,
                "at": [round(loc.x), round(loc.y), round(loc.z)] if loc else None,
                "from_heart": round((loc - heart).length()) if loc else None,
            }

        rows = []
        for bearing in range(0, 360, 10):
            a = math.radians(bearing)
            for dist in DISTANCES:
                for height in HEIGHTS:
                    end = unreal.Vector(CONTRACT[0] + math.cos(a) * dist, CONTRACT[1] + math.sin(a) * dist, height)
                    start = heart + (end - heart).normal() * 45.0
                    statics = unreal.SystemLibrary.line_trace_single_for_objects(
                        world, start, end, [unreal.ObjectTypeQuery.OBJECT_TYPE_QUERY1], False, [dog],
                        unreal.DrawDebugTrace.NONE, True)
                    camera = unreal.SystemLibrary.line_trace_single(
                        world, start, end, unreal.TraceTypeQuery.TRACE_TYPE_QUERY2, False, [dog],
                        unreal.DrawDebugTrace.NONE, True)
                    rows.append({"bearing": bearing, "dist": dist, "height": height,
                                 "static": describe(statics), "camera": describe(camera)})
            yield 0.0
        with open(os.path.join(ROOT, "occluders.json"), "w", encoding="utf-8") as fh:
            json.dump(rows, fh)
        counts = {}
        for r in rows:
            for kind in ("static", "camera"):
                hit = r[kind]
                if hit:
                    key = "%s|%s|%s|%s" % (kind, hit["actor"], hit["class"], hit["mesh"])
                    counts[key] = counts.get(key, 0) + 1
        RESULT["top"] = sorted(counts.items(), key=lambda kv: -kv[1])[:25]
        RESULT["traces"] = len(rows)
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLOCCLUDERS could not end play: %s" % exc)
