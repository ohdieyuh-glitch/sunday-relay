# PIE job: walk the Relay Dog along a route with real movement input (held W, control yaw turned
# toward the next waypoint) and report where it got stuck. Authored layers add collision; this is
# the check that a visitor can still walk the corridor end to end.
# Globals: ROUTE (list of [name, x, y]), START ([x, y, yaw]), TAG.
import math
import os
import time

ROUTE = globals().get("ROUTE", [])
START = globals().get("START", [0.0, -1300.0, 90.0])
TAG = globals().get("TAG", "walk")
REACH_CM = globals().get("REACH_CM", 140.0)
STUCK_SECONDS = globals().get("STUCK_SECONDS", 4.0)
LEG_TIMEOUT = globals().get("LEG_TIMEOUT", 40.0)
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "walks")
L = unreal.WonderlandUiTestLibrary


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 3.0
    world = ues.get_game_world()
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    cap = pawn.get_component_by_class(unreal.CapsuleComponent)
    hh = cap.get_scaled_capsule_half_height()
    pawn.set_actor_location_and_rotation(unreal.Vector(START[0], START[1], 200.0), unreal.Rotator(roll=0.0, pitch=0.0, yaw=START[2]), False, True)
    yield 1.5
    L.focus_game_viewport()
    legs = []
    RESULT["legs"] = legs
    t_route = time.time()
    for (name, wx, wy) in ROUTE:
        t0 = time.time()
        best = 1e9
        best_t = t0
        status = "reached"
        L.set_key_held("W", True)
        while True:
            loc = pawn.get_actor_location()
            dist = math.hypot(wx - loc.x, wy - loc.y)
            if dist <= REACH_CM:
                break
            bearing = math.degrees(math.atan2(wy - loc.y, wx - loc.x))
            pc.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-8.0, yaw=bearing))
            now = time.time()
            if dist < best - 25.0:
                best, best_t = dist, now
            if now - best_t > STUCK_SECONDS:
                status = "stuck"
                break
            if now - t0 > LEG_TIMEOUT:
                status = "timeout"
                break
            yield 0.05
        L.set_key_held("W", False)
        loc = pawn.get_actor_location()
        leg = {"waypoint": name, "status": status, "seconds": round(time.time() - t0, 1),
               "at": [round(loc.x), round(loc.y), round(loc.z)], "remaining_cm": round(math.hypot(wx - loc.x, wy - loc.y))}
        if status != "reached":
            shot = os.path.join(SHOTS, "%s__%s_%s.png" % (TAG, name, status))
            L.capture_game_viewport(shot)
            leg["capture"] = shot
            # Lift past the blockage so the rest of the route is still measured.
            pawn.set_actor_location_and_rotation(unreal.Vector(wx, wy, loc.z + 150.0), unreal.Rotator(roll=0.0, pitch=0.0, yaw=pawn.get_actor_rotation().yaw), False, True)
            yield 1.0
        legs.append(leg)
        emit(name, status, leg["seconds"], leg["at"])
        yield 0.1
    RESULT["route_seconds"] = round(time.time() - t_route, 1)
    RESULT["stuck"] = [l["waypoint"] for l in legs if l["status"] != "reached"]
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    RESULT["status"] = "done"
