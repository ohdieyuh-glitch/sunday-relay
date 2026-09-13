# PIE job: the private-beta tour -- every place the world map offers, visited the way a player visits it.
#
# Gate items 3 (traversal), 9 (map teleport), 11 (no grey/empty district dominates the immediate experience) and
# 12 (the route shows enough world). For each offered destination, in order, through the game's own travel
# subsystem (the same call the M map makes):
#   - travel, and record whether it arrived, the report, and the landing distance from the anchor;
#   - capture the player's own view (the Dog's camera, HUD hidden) facing the arrival yaw, then left, back, right;
#   - frame rate over FPS_SECONDS facing the arrival view;
#   - a trap check: hold W for WALK_SECONDS in each of the four facings from the landing point, and record how far
#     the Dog got (a landing it cannot leave is a collision trap).
# A frame rate counts only when the editor held the foreground (behind another window PIE is throttled).
# Waits for any other PIE to end.
# Globals: ONLY (list of destination ids, default all offered), TAG, WALK_SECONDS, FPS_SECONDS.
import math
import os
import time

ONLY = globals().get("ONLY", None)
TAG = globals().get("TAG", "tour")
WALK_SECONDS = globals().get("WALK_SECONDS", 2.5)
FPS_SECONDS = globals().get("FPS_SECONDS", 4.0)
FACINGS = (("fwd", 0.0), ("left", -90.0), ("back", 180.0), ("right", 90.0))
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "tour")
L = unreal.WonderlandUiTestLibrary


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    os.makedirs(SHOTS, exist_ok=True)
    try:
        yield from _tour(ues, les)
    finally:
        if ues.get_game_world() is not None:
            les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    RESULT["status"] = "done"


def _tour(ues, les):
    GS = unreal.GameplayStatics
    SL = unreal.SystemLibrary
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: GS.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    pc = GS.get_player_controller(world, 0)
    pawn = GS.get_player_pawn(world, 0)
    travel = next(c for c in unreal.ObjectIterator(unreal.WonderlandTravelSubsystem) if c.get_world() == world)
    for hud in unreal.ObjectIterator(unreal.WonderlandUsageHudWidget):
        if hud.get_world() == world:
            hud.set_visibility(unreal.SlateVisibility.HIDDEN)
    L.focus_game_viewport()
    anchors = {str(a.get_editor_property("destination_id")): a for a in GS.get_all_actors_of_class(world, unreal.WonderlandTravelAnchor)}
    offered = [d for d in travel.get_offered_destinations()]
    RESULT["offered"] = [str(d.get_editor_property("id")) for d in offered]
    stops = []
    RESULT["stops"] = stops
    for d in offered:
        did = str(d.get_editor_property("id"))
        if ONLY and did not in ONLY:
            continue
        stop = {"id": did, "name": str(d.get_editor_property("display_name"))}
        t0 = time.time()
        stop["request"] = str(travel.request_travel(did))
        yield 0.5
        yield (lambda: not travel.is_travelling(), 30)
        yield 2.5
        stop["travel_seconds"] = round(time.time() - t0, 1)
        stop["arrived"] = str(travel.get_last_arrived_destination()) == did
        stop["report"] = str(travel.get_last_travel_report())
        land = pawn.get_actor_location()
        stop["landed"] = [round(land.x), round(land.y), round(land.z)]
        anchor = anchors.get(did)
        if anchor is not None:
            al = anchor.get_actor_location()
            stop["anchor_distance_cm"] = round(math.hypot(al.x - land.x, al.y - land.y))
        yaw0 = float(d.get_editor_property("arrival_yaw_deg"))
        # the player's view, four ways
        shots = {}
        for label, dy in FACINGS:
            pc.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-6.0, yaw=yaw0 + dy))
            yield 2.0
            path = os.path.join(SHOTS, "%s__%s__%s.png" % (did, label, TAG))
            shots[label] = bool(L.capture_game_viewport(path))
        stop["shots"] = shots
        pc.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-6.0, yaw=yaw0))
        yield 1.0
        fg0 = _editor_foreground()
        f0, t1 = SL.get_frame_count(), time.time()
        yield FPS_SECONDS
        stop["fps"] = round((SL.get_frame_count() - f0) / (time.time() - t1), 1)
        stop["foreground"] = bool(fg0 and _editor_foreground())
        # trap check: four short walks from the landing point
        walks = {}
        for label, dy in FACINGS:
            pawn.set_actor_location(land, False, True)
            pc.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-6.0, yaw=yaw0 + dy))
            yield 0.4
            start = pawn.get_actor_location()
            L.set_key_held("W", True)
            yield WALK_SECONDS
            L.set_key_held("W", False)
            end = pawn.get_actor_location()
            walks[label] = round(math.hypot(end.x - start.x, end.y - start.y))
        pawn.set_actor_location(land, False, True)
        stop["walk_cm"] = walks
        stop["trapped"] = max(walks.values()) < 150
        stops.append(stop)
        emit(did, stop["arrived"], stop["fps"], walks)
        yield 0.5


def _editor_foreground():
    """Whether this editor owns the foreground window. Behind another window the editor throttles PIE
    (EditorPerformanceSettings.bThrottleCPUWhenNotForeground is neither Python-visible nor settable with
    `set` in the editor), so a frame rate is only a measurement when this is True."""
    try:
        import ctypes
        user32 = ctypes.windll.user32
        pid = ctypes.c_ulong(0)
        user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), ctypes.byref(pid))
        return pid.value == os.getpid()
    except Exception:
        return None
