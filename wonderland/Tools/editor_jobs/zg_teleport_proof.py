# G3 QUALIFICATION -- TELEPORT TO EVERY OFFERED DESTINATION, THROUGH THE PLAYER'S OWN TRAVEL (founder regression 2026-09-29).
#
# FOUNDER: "For every newly registered canonical destination: teleport -> streaming settles -> valid ground -> Dog
# survives -> Dog can walk away under its own power." And for the baseline: "existing teleport destinations still
# work; world streaming remains healthy."
#
# Every destination the map offers is travelled to with UWonderlandTravelSubsystem::RequestTravel -- the same call the
# world map's TELEPORT button makes: fade, stream at the arrival point, sweep onto ground, move the pawn once, three
# frames of ground under it, fade in. Then, per stop:
#   ARRIVED        the travel reported arrival at that id ("Arrived at X"), not a return to the origin;
#   SURVIVED       the pawn is the same live Dog, walking (not falling), capsule upright;
#   STREAMED       World Partition streaming settles after the arrival (waited for, up to 30 s);
#   GROUND         the floor under the Dog, named, within 40 cm of the feet and of the registry's arrival height, and
#                  not a planter (a roof, a hedge top, a planter or a tower base fails this);
#   ON THE POINT   landed within 3 m of the registry's arrival point;
#   WALKS AWAY     driven by input alone (no placement), the Dog covers >= 2.5 m in at least one of four headings.
# The destinations are visited in registry order, so each travel starts from wherever the last one ended -- far
# places are reached from far places, which is exactly what the anchor-only registry could not do.
# Globals: ONLY (optional id list). PIE-owning: CONCURRENT is False. Saves nothing.
CONCURRENT = False
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
GS = unreal.GameplayStatics
ONLY = globals().get("ONLY")
NEW_IDS = ["tower_rise", "tower_lane", "icarus_tower_hamlets", "mushroom_grove", "icarus_gate", "noctis_gate", "tartarus_gate",
           "icarus_quarter", "noctis_quarter", "tartarus_quarter", "icarus_heartland", "tartarus_heartland_east",
           "tartarus_heartland_southeast", "noctis_heartland_west", "noctis_heartland_southwest", "dubel_forest"]
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "g3_teleport")
PAWN = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2


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
    try:
        yield from _run(ues, les)
    finally:
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
    travel = next(c for c in unreal.ObjectIterator(unreal.WonderlandTravelSubsystem) if c.get_world() == world)
    offered = [str(d.get_editor_property("id")) for d in travel.get_offered_destinations()]
    RESULT["offered"] = offered
    RESULT["offered_count"] = len(offered)
    RESULT["new_ids_missing_from_offer"] = [i for i in NEW_IDS if i not in offered]
    first_dog = dog_of().get_name()
    stops = []
    RESULT["stops"] = stops

    def floor_under(dog):
        loc = dog.get_actor_location()
        half = dog.capsule_component.get_scaled_capsule_half_height()
        hit = unreal.SystemLibrary.line_trace_single(world, loc, unreal.Vector(loc.x, loc.y, loc.z - half - 150.0), PAWN, False, [dog],
                                                     unreal.DrawDebugTrace.NONE, True, unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        if hit is None:
            return None, None, half
        tt = hit.to_tuple()
        return float(tt[4].z), (tt[9].get_actor_label() if tt[9] is not None else "?"), half

    for did in offered:
        if ONLY and did not in ONLY:
            continue
        stop = {"id": did, "new": did in NEW_IDS}
        arrival = _unwrap(travel.resolve_arrival(did))
        if arrival is not None:
            a = arrival.translation
            stop["registry_arrival"] = [round(a.x), round(a.y), round(a.z)]
        req = travel.request_travel(did)
        stop["request"] = str(req)
        yield 0.5
        w = 0.0
        while travel.is_travelling() and w < 40.0:
            yield 0.25
            w += 0.25
        yield 1.0
        dog = dog_of()
        stop["arrived"] = str(travel.get_last_arrived_destination()) == did and str(travel.get_last_travel_report()).startswith("Arrived")
        stop["report"] = str(travel.get_last_travel_report())
        stop["seconds"] = round(w, 2)
        stop["same_dog"] = dog is not None and dog.get_name() == first_dog
        if dog is None:
            stops.append(stop)
            continue
        loc = dog.get_actor_location()
        stop["landed"] = [round(loc.x), round(loc.y), round(loc.z)]
        stop["mode"] = str(dog.character_movement.movement_mode)
        # STREAMING SETTLES: the travel lands once the ground round the arrival is in; the rest of the Dog's own 512 m
        # range keeps streaming in after the fade. Read ONE second after arrival (zg_06) that was still running at
        # every far stop, which is streaming doing its job, not failing it -- so wait for it to finish, up to 30 s.
        settle = 0.0
        while not L.is_world_partition_streaming_complete(world) and settle < 30.0:
            yield 0.5
            settle += 0.5
        stop["streaming_complete"] = bool(L.is_world_partition_streaming_complete(world))
        stop["streaming_settle_s"] = settle
        dog = dog_of()
        loc = dog.get_actor_location()
        fz, flabel, half = floor_under(dog)
        stop["floor"] = [None if fz is None else round(fz, 1), flabel]
        feet = loc.z - half
        stop["feet_z"] = round(feet, 1)
        if arrival is not None:
            stop["from_point_m"] = round(math.hypot(loc.x - a.x, loc.y - a.y) / 100.0, 2)
        H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % did), 1280, 85)
        # ---- WALKS AWAY UNDER ITS OWN POWER: input only, four headings, the first that goes 2.5 m wins
        walked = []
        yaw0 = dog.get_actor_rotation().yaw
        for rel in (0.0, 90.0, -90.0, 180.0):
            dog = dog_of()
            s0 = dog.get_actor_location()
            g0 = GS.get_time_seconds(world)
            yaw = math.radians(yaw0 + rel)
            while GS.get_time_seconds(world) - g0 < 2.5:
                dog = dog_of()
                if dog is None:
                    break
                dog.add_movement_input(unreal.Vector(math.cos(yaw), math.sin(yaw), 0.0), 1.0, True)
                yield 0.0
            dog = dog_of()
            e0 = dog.get_actor_location() if dog is not None else s0
            d = math.hypot(e0.x - s0.x, e0.y - s0.y) / 100.0
            walked.append({"rel_deg": rel, "moved_m": round(d, 2), "mode": str(dog.character_movement.movement_mode) if dog else None})
            if d >= 2.5:
                break
        stop["walk_away"] = walked
        # ON THE GROUND THE REGISTRY MEANT: the feet on the floor (within 40 cm) and that floor within 40 cm of the
        # registry's arrival height. +/- 1 m let the Grand Clock and the Colossal Key pass standing on SD01 planter tops
        # (floor 78.5 against a registry 19 / 12) -- a planter is not where a visitor should arrive.
        ok_ground = fz is not None and -5.0 <= (feet - fz) <= 40.0 and (arrival is None or abs(fz - a.z) <= 40.0) \
            and "planter" not in str(flabel).lower()
        stop["checks"] = {
            "arrived": stop["arrived"],
            "survived": stop["same_dog"] and "WALKING" in stop["mode"],
            "streamed": stop["streaming_complete"],
            "ground": ok_ground,
            "on_the_point": stop.get("from_point_m", 99.0) <= 3.0,
            "walks_away": any(x["moved_m"] >= 2.5 and x["mode"] and "WALKING" in x["mode"] for x in walked),
        }
        stop["pass"] = all(stop["checks"].values())
        stops.append(stop)
        emit("STOP", did, "PASS" if stop["pass"] else "FAIL", [k for k, v in stop["checks"].items() if not v], stop.get("report"))
        yield 0.5
    RESULT["new_pass"] = sum(1 for s in stops if s["new"] and s.get("pass"))
    RESULT["new_total"] = sum(1 for s in stops if s["new"])
    RESULT["existing_pass"] = sum(1 for s in stops if not s["new"] and s.get("pass"))
    RESULT["existing_total"] = sum(1 for s in stops if not s["new"])
    RESULT["all_pass"] = all(s.get("pass") for s in stops) and not RESULT["new_ids_missing_from_offer"]
    RESULT["status"] = "measured"
