# WHAT IS LIFTING THE NIGHT? HIDE EACH CANDIDATE AND RE-READ, IN ONE SESSION.
#
# The night has risen from 0.132 world luma to 0.217 and three corrections aimed at three different suspects
# have each moved it by under 0.005. Two of those suspects were argued rather than tested, and the third --
# the shadow gate -- was disproved the moment it was A/B'd: putting the sun's shadows back made the night
# BRIGHTER still. So no more reasoning about which change did it.
#
# This is the A/B, and it is the only kind of evidence that has been worth anything on this number. Midnight
# is photographed once as it stands, then again with each candidate hidden, then again with it back. Hiding is
# reversible, needs no build, and both readings happen within a few seconds of each other in one PIE session,
# so no thermal or streaming drift can sit between them.
#
# THE CANDIDATES, in the order they became suspicious:
#   glow   -- the territory checkpoint's glow ring and pylon bands, painted on an UNLIT material at 22x the
#             accent colour. An unlit surface renders the colour it is given whatever the sun is doing, so
#             this is exactly as bright at midnight as at noon, and the GOLDEN ARRIVAL marker stands at the
#             Arrival Gate, which is where the player spawns and where this proof's camera looks.
#   lamp   -- the same checkpoint's point light, already dimmed once from 9 candelas to 2.5.
#   stone  -- the plinth and pylon themselves, which are lit geometry and should NOT matter; included as the
#             control. If hiding ordinary lit stone moves the number as much as hiding the glow does, then
#             the reading is about the checkpoint being IN FRAME at all and not about its brightness.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "night_culprit")
HOUR = 4.0


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".png"):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 8.0

    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % HOUR)
    yield 8.0

    # ---- THE SAME FRAMING THE NIGHT PROOF USES, so the numbers are comparable to the ones already on record.
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    here = dog.get_actor_location()
    yaw = dog.get_actor_rotation().yaw
    eye = unreal.Vector(here.x - math.cos(math.radians(yaw)) * 520.0,
                        here.y - math.sin(math.radians(yaw)) * 520.0, here.z + 210.0)
    L.pose_camera(world, eye, unreal.Vector(here.x, here.y, here.z + 40.0), 70.0)
    yield 3.0

    posts = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandTerritoryCheckpoint)
    RESULT["checkpoints_in_level"] = len(posts)
    near = []
    for post in posts:
        d = (post.get_actor_location() - here).length()
        near.append({"label": str(post.get_actor_label()), "metres": round(d / 100.0, 1)})
    near.sort(key=lambda r: r["metres"])
    RESULT["checkpoints_by_distance"] = near[:6]
    emit("C_POSTS", "INFO", "territory checkpoints, nearest first", {"n": len(posts), "near": near[:4]})

    def look(tag):
        yield 2.5
        got = L.read_screen_rect(0.06, 0.10, 0.94, 0.92)
        globals()["_L"] = None if got is None else round(float(got[1]), 5)
        bright = L.read_screen_extremes(0.06, 0.10, 0.94, 0.92)
        globals()["_HI"] = None if bright is None else round(float(bright[1]), 5)
        try:
            L.capture_game_viewport(os.path.join(ROOT, "%s.png" % tag))
        except Exception:
            pass

    def parts(which, hidden):
        """Hide or show one class of the checkpoints' components on every checkpoint in the level."""
        touched = 0
        for post in posts:
            for comp in post.get_components_by_class(unreal.InstancedStaticMeshComponent):
                if str(comp.get_name()).lower().startswith(which):
                    comp.set_hidden_in_game(hidden)
                    touched += 1
            if which == "lamp":
                for comp in post.get_components_by_class(unreal.PointLightComponent):
                    comp.set_visibility(not hidden)
                    touched += 1
        return touched

    steps = {}
    RESULT["midnight_luma"] = steps

    yield from look("00_as_it_stands")
    steps["00 as it stands"] = {"mean": globals().get("_L"), "brightest": globals().get("_HI")}

    for which in ("glow", "lamp", "stone", "ivory"):
        n = parts(which, True)
        yield from look("%s_hidden" % which)
        steps["%s hidden (%d components)" % (which, n)] = {
            "mean": globals().get("_L"), "brightest": globals().get("_HI")}
        parts(which, False)
        yield 1.5

    # ---- AND EVERYTHING AT ONCE, which prices the whole checkpoint.
    for which in ("glow", "lamp", "stone", "ivory"):
        parts(which, True)
    yield from look("05_whole_checkpoint_hidden")
    steps["whole checkpoint hidden"] = {"mean": globals().get("_L"), "brightest": globals().get("_HI")}
    for which in ("glow", "lamp", "stone", "ivory"):
        parts(which, False)
    yield from look("06_back_again")
    steps["back again"] = {"mean": globals().get("_L"), "brightest": globals().get("_HI")}

    for k, v in steps.items():
        emit("C", "INFO", k, v)

    base = steps["00 as it stands"]["mean"]
    back = steps["back again"]["mean"]
    got_all = base is not None and all(v["mean"] is not None for v in steps.values())
    record("C00", "every reading came back with the window up", got_all,
           readings={k: v["mean"] for k, v in steps.items()},
           note="all None means the editor was behind another window, not that the world is black")
    if not got_all:
        RESULT["status"] = "FAIL: nothing was measured"
        L.release_camera(world)
        return

    # THE CONTROL THAT MAKES THE REST WORTH READING: hiding and re-showing must land back where it started.
    record("C01", "hiding is reversible -- the last reading matches the first",
           abs(base - back) <= 0.012, first=base, last=back, tolerance=0.012,
           note="if these disagree the scene was still settling and every difference below is noise")

    share = {}
    for k, v in steps.items():
        if "hidden" in k:
            share[k] = round(base - v["mean"], 5)
    RESULT["luma_removed_by_hiding"] = share
    emit("C_SHARE", "INFO", "how much of the night each part is", share)

    whole = share.get("whole checkpoint hidden", 0.0)
    record("C02", "the night's brightness is or is not the territory checkpoints",
           True, base_luma=base, with_checkpoint_hidden=steps["whole checkpoint hidden"]["mean"],
           removed=whole, per_part=share,
           note="reported either way. The night proof's ceiling needs the world at about 0.17 here; if "
                "hiding the checkpoint gets most of the way there, the glow's brightness is the bug. If it "
                "does not, the lift is somewhere else and this rules the checkpoint out for good.")

    L.release_camera(world)
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
