# IS THERE ANYTHING FOR THE DOG TO STAND ON WHERE IT FALLS THROUGH?
#
# FOUNDER, item 13: "collisions, traversal... walk-test every major region."
#
# NOW THAT THE WALK HARNESS DRIVES, its failure is reproducible and specific: the Dog is destroyed part-way
# along two of the three nation avenues -- ICARUS at waypoint 4 after 24.5 m, TARTARUS at waypoint 2 after
# 9.4 m -- each time last seen at z=75.2, 63.2 uu BELOW the floor its own route declares. It is not being
# blocked. It is falling.
#
# THE MECHANISM TO TEST comes from the world lane, who hit the same shape from the other side: NON-COLLIDING
# PAVING IS INVISIBLE TO TRACES. A surface can be drawn, look solid, and have no collision at all -- and then
# a trace on the PAWN channel passes straight through it and reports whatever is underneath, while a trace on
# VISIBILITY stops on the thing you can see. A Dog walks onto it and falls.
#
# SO THIS ASKS BOTH CHANNELS THE SAME QUESTION at every early waypoint of every avenue, and reports what each
# hit and at what height. The two agreeing is a floor that is really there. The two disagreeing -- visibility
# stopping high on something the pawn channel passes through -- is a hole you can see but not stand on, which
# is exactly the founder's "collisions" and exactly what kills the walk.
#
# THE ROUTE'S OWN DECLARED FLOOR IS THE THIRD READING, because the routes were generated from the geometry
# spec rather than from a trace. Where the declared floor and the pawn floor disagree, the route is describing
# a surface the character cannot use.
#
# NO CLAIM ABOUT THE FIX HERE. This says where the hole is and which channel can see it. Whether the answer is
# collision on the paving, a different route, or a changed shelf height is a decision that needs this first.
#
# NOT CONCURRENT: this job owns PIE, because the pawn channel means the Dog's own world.
CONCURRENT = False

import json
import unreal

L = unreal.WonderlandUiTestLibrary
ROUTES = r"C:/dev/iwonder/wonderland-task3/wonderland/WorldDesign/Nations/nation_routes.json"

PAWN = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2          # what the character collides with
VIS = unreal.TraceTypeQuery.TRACE_TYPE_QUERY1           # what you can see
EVERY = 4                                                # the same thinning the walk uses
FIRST = 12                                               # the early waypoints, where both deaths happened


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    with open(ROUTES, encoding="utf-8") as f:
        routes = json.load(f)

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    L.focus_game_viewport()
    yield 5.0
    world = ues.get_game_world()
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)

    def trace(x, y, top, channel):
        """(z, what) of the first hit going down, or (None, None)."""
        try:
            hit = unreal.SystemLibrary.line_trace_single(
                world, unreal.Vector(x, y, top), unreal.Vector(x, y, top - 4000.0), channel, False,
                [p for p in (dog,) if p is not None], unreal.DrawDebugTrace.NONE, True,
                unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            if hit is None:
                return (None, None)
            t = hit.to_tuple()
            z = float(t[4].z)
            who = None
            try:
                who = str(t[9].get_actor_label()) if t[9] is not None else None
            except Exception:                                       # noqa: BLE001
                try:
                    who = str(t[9].get_name()) if t[9] is not None else None
                except Exception:                                   # noqa: BLE001
                    who = None
            return (round(z, 1), who)
        except Exception:                                           # noqa: BLE001
            return (None, None)

    findings = {}
    RESULT["waypoints"] = findings
    holes = []
    disagreements = []

    for nation, route in sorted(routes.items()):
        pts = route["points"][::EVERY][:FIRST]
        rows = []
        # STREAM THE AREA IN FIRST. A trace into an unloaded cell finds nothing and would report every
        # waypoint as a hole -- a statement about streaming, not about collision.
        if dog is not None and pts:
            try:
                dog.set_actor_location(
                    unreal.Vector(pts[0]["x"], pts[0]["y"], float(pts[0]["floor"]) + 900.0), False, True)
            except Exception:                                       # noqa: BLE001
                pass
        yield 6.0
        try:
            unreal.SystemLibrary.flush_level_streaming(world)
        except Exception:                                           # noqa: BLE001
            pass
        yield 2.0
        dog = unreal.GameplayStatics.get_player_pawn(world, 0)

        for i, p in enumerate(pts):
            declared = float(p["floor"])
            top = declared + 800.0
            pz, pwho = trace(p["x"], p["y"], top, PAWN)
            vz, vwho = trace(p["x"], p["y"], top, VIS)
            row = {"i": i, "declared_floor": round(declared, 1),
                   "pawn_z": pz, "pawn_hit": pwho, "visible_z": vz, "visible_hit": vwho}
            if pz is None:
                row["verdict"] = "NOTHING TO STAND ON"
                holes.append("%s/%d" % (nation, i))
            elif vz is not None and (vz - pz) > 20.0:
                row["verdict"] = "visible surface {0} uu above the standable one".format(round(vz - pz, 1))
                disagreements.append("%s/%d" % (nation, i))
            elif abs(pz - declared) > 30.0:
                row["verdict"] = "declared floor off by {0} uu".format(round(declared - pz, 1))
            else:
                row["verdict"] = "solid"
            rows.append(row)
        findings[nation] = rows
        emit("H_%s" % nation, "INFO", nation,
             {"checked": len(rows), "verdicts": [r["verdict"][:44] for r in rows]})
        yield 0.5

    RESULT["waypoints_with_nothing_to_stand_on"] = holes or None
    RESULT["waypoints_where_the_channels_disagree"] = disagreements or None

    record("H00", "every early waypoint of every avenue has something the CHARACTER can stand on",
           not holes, holes=holes or None,
           note="the pawn channel is what the Dog collides with. Nothing there means the Dog walks into "
                "space, which is the reproducible death this run exists to locate.")

    record("H01", "what you can SEE and what you can STAND ON are the same surface",
           not disagreements, disagreements=disagreements or None, tolerance_uu=20.0,
           note="THE WORLD LANE'S MECHANISM, tested here. Non-colliding paving is drawn, looks solid, and is "
                "invisible to the pawn channel -- so a visible floor above a standable one is a surface a "
                "player walks onto and falls through.")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
