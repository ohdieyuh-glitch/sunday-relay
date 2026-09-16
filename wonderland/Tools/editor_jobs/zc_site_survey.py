# PIE probe: WHERE SHOULD A SIMULATED MISSION BE STAGED? (founder, 2026-09-16: "the location you are at is not ideal")
#
# The mission needs open ground: the Dog walks a 3.4 m circle round a Contract that floats 3.4 m ahead of where it
# arrives, the companions fly a 2 m orbit above, and the play camera stands 4-5 m outside that circle. At South Meadows
# the arrival court's rose arch stood in that ring and hid the Dog and the Contract for most of the film. This travels to
# each candidate site and photographs it from above and from the four sides of where the Contract would be.
import os

L = unreal.WonderlandUiTestLibrary
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "site_survey")
SITES = globals().get("SITES") or ["castle_approach", "gatekeeper_fields", "grand_clock", "south_meadows"]


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    shots = {}
    RESULT["shots"] = shots
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 5.0
        world = ues.get_game_world()
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        controller = unreal.GameplayStatics.get_player_controller(world, 0)
        travel = next(t for t in unreal.ObjectIterator(unreal.WonderlandTravelSubsystem) if t.get_world() == world)
        boom = pawn.get_component_by_class(unreal.SpringArmComponent)
        arm_was = float(boom.target_arm_length)
        L.focus_game_viewport()
        for site in SITES:
            ok = travel.request_travel(site)
            accepted = ok[0] if isinstance(ok, tuple) else bool(ok)
            yield 0.5
            yield (lambda: not travel.is_travelling(), 60)
            yield 3.0
            at = pawn.get_actor_location()
            yaw = pawn.get_actor_rotation().yaw
            entry = {"accepted": accepted, "report": str(travel.get_last_travel_report()),
                     "at": [round(at.x), round(at.y), round(at.z)], "yaw": round(yaw, 1), "files": []}
            # From above, then from the four sides at the play camera's distance, all looking at where the Contract goes.
            for tag, dyaw, pitch, arm in (("above", 0.0, -62.0, 1100.0), ("behind", 0.0, -14.0, 520.0),
                                          ("left", 90.0, -14.0, 520.0), ("front", 180.0, -14.0, 520.0),
                                          ("right", -90.0, -14.0, 520.0)):
                boom.set_editor_property("target_arm_length", arm, unreal.PropertyAccessChangeNotifyMode.NEVER)
                controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=pitch, yaw=yaw + dyaw))
                yield 0.8
                path = os.path.join(SHOTS, "%s_%s.png" % (site, tag))
                L.capture_game_viewport(path)
                entry["files"].append(path)
            shots[site] = entry
            unreal.log_warning("WLSITESURVEY %s %s" % (site, entry["report"]))
        boom.set_editor_property("target_arm_length", arm_was, unreal.PropertyAccessChangeNotifyMode.NEVER)
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLSITESURVEY could not end play: %s" % exc)
