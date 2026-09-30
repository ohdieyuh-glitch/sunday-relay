# G3b -- FAR -> CENTRE TRAVEL, THE TRIP THE FOUNDER'S TELEPORT FAILED ON (2026-09-30).
#
# FOUNDER'S SESSION (editor log wl-live-editor-104.log, 16:04:57 UTC): a Mission Contract deployed at Tartarus Heartland
# East travelled to castle_approach -- the densest cells in the world, 640 m away -- and gave up at 25.8 s: "Could not land
# safely at castle_approach; returned to where you were." zg_22 passed every destination but never made that trip: it
# reached castle_approach from 75 m away. This job makes it on purpose.
#
# PHASE "hops": for each (rim, centre) pair: travel to the rim place, let it settle, then travel rim -> centre through the
# player's own path (the world map: open, select, TELEPORT). Records seconds, arrival, the report, and -- on a build that has
# it -- the travel's own diagnostics (which condition refused, when streaming finished, cells pending).
# PHASE "deploy": travel to tartarus_heartland_east, then `wl.Mission.Scenario B` -- the founder's exact case -- and wait for
# the scenario's own travel to castle_approach to end. PASS: it arrived, and the Dog is within 40 m of the site.
# Globals: PAIRS (list of [rim, centre]), REPEAT (deploy repeats), PHASES. PIE-owning: CONCURRENT is False. Saves nothing.
CONCURRENT = False
import math
import os

L = unreal.WonderlandUiTestLibrary
GS = unreal.GameplayStatics
PAIRS = globals().get("PAIRS") or [["tartarus_heartland_east", "castle_approach"],
                                   ["noctis_heartland_southwest", "royal_gardens"],
                                   ["icarus_heartland", "teapot_court"],
                                   ["dubel_forest", "grand_clock"]]
REPEAT = int(globals().get("REPEAT", 1))
PHASES = globals().get("PHASES") or ["hops", "deploy"]
# SQUEEZE: run with MaxBlackSeconds lowered to this many seconds, so a stream that is slow but still arriving meets the
# limit on ANY machine -- the founder's failure made reproducible. Old logic abandons at the limit; the fix keeps waiting
# while cells are still arriving. Always restored.
SQUEEZE = globals().get("SQUEEZE")
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zh", "far_hops")


def _unwrap(ret):
    if isinstance(ret, tuple):
        if len(ret) >= 2 and isinstance(ret[0], bool):
            return ret[1] if ret[0] else None
        return ret[0] if ret else None
    return ret


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    os.makedirs(ROOT, exist_ok=True)
    RESULT["status"] = "running"
    L.set_background_throttle_suspended(True)
    # the settings class carries no BlueprintType, so it has no Python class; its default object is reached by path and
    # its properties by their reflected names
    settings = unreal.find_object(None, "/Script/Wonderland.Default__WonderlandTravelSettings")

    def get_limit():
        return float(settings.get_editor_property("MaxBlackSeconds"))

    def set_limit(value):
        settings.set_editor_property("MaxBlackSeconds", float(value))

    original = get_limit()
    RESULT["max_black_seconds_original"] = original
    if SQUEEZE is not None:
        set_limit(SQUEEZE)
        RESULT["squeezed_to"] = get_limit()
    try:
        yield from _run(ues, les)
    finally:
        set_limit(original)
        RESULT["max_black_seconds_restored"] = get_limit()
        if ues.get_game_world() is not None:
            les.editor_request_end_play()
            while ues.get_game_world() is not None:
                yield 1.0


def _run(ues, les):
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    t = 0.0
    while ues.get_game_world() is None and t < 90.0:
        yield 1.0
        t += 1.0
    world = ues.get_game_world()
    dog_of = lambda: GS.get_player_pawn(ues.get_game_world(), 0)
    t = 0.0
    while dog_of() is None and t < 30.0:
        yield 0.5
        t += 0.5
    if dog_of() is None:
        RESULT["status"] = "BLOCKED: no pawn"
        return
    yield 4.0
    L.focus_game_viewport()
    ui = L.get_ui(world)
    travel = next(c for c in unreal.ObjectIterator(unreal.WonderlandTravelSubsystem) if c.get_world() == world)
    has_diag = hasattr(travel, "get_last_travel_diagnostics")
    RESULT["build_has_diagnostics"] = has_diag
    RESULT["dll_mtime"] = os.path.getmtime(os.path.join(unreal.Paths.project_dir(), "Binaries", "Win64", "UnrealEditor-Wonderland.dll"))
    trips = []
    RESULT["trips"] = trips

    def go(did, via_map):
        """One travel; returns the trip record once the travel has ended (or 95 s)."""
        trip = {"to": did, "via_map": via_map}
        dog = dog_of()
        s = dog.get_actor_location()
        trip["from"] = [round(s.x), round(s.y), round(s.z)]
        arrival = _unwrap(travel.resolve_arrival(did))
        if arrival is not None:
            a = arrival.translation
            trip["registry_arrival"] = [round(a.x), round(a.y), round(a.z)]
            trip["distance_m"] = round(math.hypot(a.x - s.x, a.y - s.y) / 100.0)
        if via_map:
            if not ui.is_world_map_open():
                ui.toggle_world_map()
            yield 0.5
            ui.select_map_destination(did)
            yield 0.3
            trip["selected"] = str(ui.get_map_selected_id())
            trip["started"] = bool(ui.teleport_to_selected())
        else:
            trip["started"] = str(travel.request_travel(did))
        w = 0.0
        yield 0.25
        while travel.is_travelling() and w < 95.0:
            yield 0.25
            w += 0.25
        trip["seconds"] = round(w, 2)
        trip["report"] = str(travel.get_last_travel_report())
        trip["arrived"] = str(travel.get_last_arrived_destination()) == did and trip["report"].startswith("Arrived")
        if has_diag:
            trip["diagnostics"] = str(travel.get_last_travel_diagnostics())
        dog = dog_of()
        if dog is not None:
            e = dog.get_actor_location()
            trip["landed"] = [round(e.x), round(e.y), round(e.z)]
            if arrival is not None:
                trip["from_point_m"] = round(math.hypot(e.x - a.x, e.y - a.y) / 100.0, 2)
            trip["mode"] = str(dog.character_movement.movement_mode)
        emit("TRIP", did, "ARRIVED" if trip["arrived"] else "FAILED", trip["seconds"], trip["report"], trip.get("diagnostics", ""))
        trips.append(trip)
        return trip

    def settle(limit=30.0):
        w = 0.0
        while not L.is_world_partition_streaming_complete(world) and w < limit:
            yield 0.5
            w += 0.5
        yield 1.0

    if "hops" in PHASES:
        for rim, centre in PAIRS:
            for rep in range(REPEAT):
                out = yield from go(rim, False)
                out["leg"] = "to_rim"
                yield from settle()
                back = yield from go(centre, True)
                back["leg"] = "rim_to_centre"
                back["pair"] = [rim, centre]
                back["rep"] = rep
                yield from settle(10.0)
    if "deploy" in PHASES:
        deploys = []
        RESULT["deploys"] = deploys
        for rep in range(REPEAT):
            yield from go("tartarus_heartland_east", False)
            yield from settle()
            n0 = len(trips)
            unreal.SystemLibrary.execute_console_command(world, "wl.Mission.Scenario B")
            # the scenario starts its own travel to the simulation site; wait for it to begin and end
            w = 0.0
            while not travel.is_travelling() and w < 10.0:
                yield 0.25
                w += 0.25
            began = travel.is_travelling()
            w = 0.0
            while travel.is_travelling() and w < 95.0:
                yield 0.25
                w += 0.25
            rec = {"rep": rep, "travel_began": bool(began), "seconds": round(w, 2),
                   "report": str(travel.get_last_travel_report()),
                   "arrived": str(travel.get_last_arrived_destination()) == "castle_approach" and str(travel.get_last_travel_report()).startswith("Arrived")}
            if has_diag:
                rec["diagnostics"] = str(travel.get_last_travel_diagnostics())
            dog = dog_of()
            site = _unwrap(travel.resolve_arrival("castle_approach"))
            if dog is not None and site is not None:
                e, a = dog.get_actor_location(), site.translation
                rec["dog_to_site_m"] = round(math.hypot(e.x - a.x, e.y - a.y) / 100.0, 1)
            rec["pass"] = rec["arrived"] and rec.get("dog_to_site_m", 999.0) <= 40.0
            emit("DEPLOY", rep, "PASS" if rec["pass"] else "FAIL", rec["seconds"], rec["report"], rec.get("diagnostics", ""))
            deploys.append(rec)
            # let the scenario's cutscene begin, photograph it, then stop it so the next repeat starts clean
            yield 6.0
            L.capture_game_viewport(os.path.join(ROOT, "deploy_%d.png" % rep))
            unreal.SystemLibrary.execute_console_command(world, "wl.Mission.Stop")
            yield 3.0
    centre_trips = [t for t in trips if t.get("leg") == "rim_to_centre"]
    RESULT["rim_to_centre_arrived"] = sum(1 for t in centre_trips if t["arrived"])
    RESULT["rim_to_centre_total"] = len(centre_trips)
    RESULT["deploy_pass"] = sum(1 for d in RESULT.get("deploys", []) if d["pass"])
    RESULT["deploy_total"] = len(RESULT.get("deploys", []))
    RESULT["status"] = "measured"
