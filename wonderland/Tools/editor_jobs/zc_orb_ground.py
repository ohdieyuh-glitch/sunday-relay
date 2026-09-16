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

    # ---------------------------------------------------------------- is it on the floor?
    # NOT BY TRACING FROM PYTHON. This build exposes nothing readable on a HitResult -- `blocking_hit` is
    # not an attribute, GameplayStatics has no break_hit_result, and HitResult.Location is protected -- so
    # a Python trace can report THAT something was hit and never WHERE. Three runs were spent learning it.
    #
    # ASK WHICH BRANCH THE ORB TOOK INSTEAD. AWonderlandMissionOrb::DesiredLocation traces down for the
    # floor and sets its Z to the hit; only when it finds nothing does it fall back to `pawn.Z - 42`. Those
    # two produce DIFFERENT heights, so the orb's own Z says which happened -- and if the trace ran, the
    # orb's Z IS the floor surface by construction. That is a stronger statement than a second trace from
    # here, which could disagree with the one that actually placed the dais.
    fallback_z = pawn_at.z - 42.0
    on_fallback = abs(orb_at.z - fallback_z) < 5.0
    say("orb_z=%.2f  floor-trace fallback would be %.2f  on_fallback=%s" % (orb_at.z, fallback_z, on_fallback))

    wanted = (offset.x ** 2 + offset.y ** 2) ** 0.5
    flat = ((orb_at.x - pawn_at.x) ** 2 + (orb_at.y - pawn_at.y) ** 2) ** 0.5
    ok = (not on_fallback and abs(flat - wanted) < 20.0 and (pawn_at.z - orb_at.z) > 20.0)
    RESULT["ground"] = {"orb_z": round(orb_at.z, 2), "fallback_z": round(fallback_z, 2),
                        "used_floor_trace": not on_fallback,
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
