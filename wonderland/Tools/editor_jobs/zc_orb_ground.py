# PIE job: is the Mission Contract Orb standing ON the floor, or hovering above it?
#
# A FEW SECONDS, ON PURPOSE. The filming run is 100 s and this machine's free commit has been down to
# 557 MB, where a long job is likely to be killed part-written. So the one thing still unproved -- the
# down-trace that answers "ground-positioned" -- is asked on its own first, and the filming is spent only
# once it is known to work.
#
# It also demonstrates the logging rule the lane owner asked for: every line goes to the EDITOR LOG as it
# happens, not into a result file written at the end. A killed process leaves the log behind and takes the
# result file with it, so anything only in RESULT is lost exactly when it is most wanted.
#
# Rules kept: zc_ prefix, no saves, no map edits, never Escape unless a panel is open, and it ends its own PIE.
import os

L = unreal.WonderlandUiTestLibrary


def say(line):
    """Into the editor log, immediately. Survives a kill; RESULT does not."""
    unreal.log_warning("WLORBGROUND %s" % line)


def hit_location(hit):
    """
    The Z of a trace hit, and the name of whatever route worked.

    HitResult's fields are NOT Python attributes in 5.8 -- `hit.blocking_hit` raises AttributeError -- so
    this tries the accessors in order and REPORTS WHICH ONE ANSWERED rather than assuming. Getting this
    wrong is what errored the last two filming runs.
    """
    try:
        parts = unreal.GameplayStatics.break_hit_result(hit)
        where = next((p for p in parts if isinstance(p, unreal.Vector)), None)
        if parts and parts[0] and where is not None:
            return float(where.z), "break_hit_result"
    except Exception as exc:
        say("break_hit_result refused: %s" % exc)
    try:
        return float(hit.get_editor_property("location").z), "get_editor_property"
    except Exception as exc:
        say("get_editor_property refused: %s" % exc)
    return None, "none"


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    say("start")

    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 3.0
    world = ues.get_game_world()
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    mission = next((m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem)
                    if m.get_beat_count() > 0 and m.is_orb_in_world()), None)
    say("pie up, mission=%s" % (mission is not None))
    if mission is None:
        RESULT["status"] = "error"
        RESULT["error"] = "no mission subsystem with an orb in the world"
        say("NO MISSION SUBSYSTEM")
        return

    orb_actor = next((a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandMissionOrb)), None)
    offset = orb_actor.follow_offset if orb_actor is not None else unreal.Vector()
    orb_at = mission.get_orb_location()
    pawn_at = pawn.get_actor_location()
    say("orb %.1f,%.1f,%.1f  pawn %.1f,%.1f,%.1f  offset %.0f,%.0f  height %.1f"
        % (orb_at.x, orb_at.y, orb_at.z, pawn_at.x, pawn_at.y, pawn_at.z,
           offset.x, offset.y, mission.get_orb_height_uu()))

    hit = unreal.SystemLibrary.line_trace_single(
        world, unreal.Vector(orb_at.x, orb_at.y, orb_at.z + 200.0),
        unreal.Vector(orb_at.x, orb_at.y, orb_at.z - 400.0),
        unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [], unreal.DrawDebugTrace.NONE, True)
    say("trace returned %s" % type(hit).__name__)
    floor_z, how = (None, "no hit") if hit is None else hit_location(hit)
    above = None if floor_z is None else round(orb_at.z - floor_z, 2)
    say("floor_z=%s via %s  above_floor=%s" % (floor_z, how, above))

    wanted = (offset.x ** 2 + offset.y ** 2) ** 0.5
    flat = ((orb_at.x - pawn_at.x) ** 2 + (orb_at.y - pawn_at.y) ** 2) ** 0.5
    ok = (floor_z is not None and abs(above) < 6.0
          and abs(flat - wanted) < 20.0 and (pawn_at.z - orb_at.z) > 20.0)
    RESULT["ground"] = {"orb_z": orb_at.z, "floor_z": floor_z, "above_floor_uu": above, "read_by": how,
                        "flat_uu": round(flat, 1), "wanted_uu": round(wanted, 1),
                        "below_pawn_uu": round(pawn_at.z - orb_at.z, 1)}
    say("VERDICT %s %s" % ("PASS" if ok else "FAIL", RESULT["ground"]))
    emit("G01", "PASS" if ok else "FAIL", "the orb stands on the floor where it was told", RESULT["ground"])
    RESULT["passed"] = 1 if ok else 0
    RESULT["failed"] = [] if ok else ["G01"]

    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    L.set_background_throttle_suspended(False)
    RESULT["status"] = "done"
    say("done")
