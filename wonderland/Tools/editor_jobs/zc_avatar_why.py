# WHAT IS THE RENDER THREAD ACTUALLY DOING FOR ONE PROJECT AVATAR?
#
# MEASURED, zc_avatar_ladder, twice in one session and reproducible on the way up and on the way down: one
# Large Project Avatar takes the render thread from 18 ms to 140 while the GAME thread stays at 34 and the GPU
# stays at 23. Ten avatars cost less than one, because the crowd budget drops them all to the Small tier and
# the render thread goes to 0.2. So the cost is not the animator, not the hardware, and not the number of
# avatars: it is one Large figure's worth of render-thread submission.
#
# WHAT IT IS NOT, ALREADY RULED OUT BY READING: the boxes are instanced per part and each component is
# ATTACHED TO ITS PART'S PIVOT, so animating moves pivots and does not rewrite instance transforms.
#
# THIS IS THE NEXT CANDIDATE AND IT IS A/B'D RATHER THAN ARGUED. A Large avatar is roughly 31,900 instances
# across seventy-odd movable components, and every one of them is a shadow caster in a world with four sun
# cascades. Shadow quality is a console variable, so the same avatar can be measured with and without inside
# one session -- no build, no thermal drift between the two readings.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import os
import time
import unreal

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary

AVATARS = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "ProjectAvatars")
WINDOW_S = 6.0


def job():
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
    # ---- ISSUED ONCE. `stat unit` IS A TOGGLE, AND RE-ISSUING IT TURNS THE OVERLAY OFF.
    #
    # The engine binds it as FEngineStatToggle::CreateUObject(this, &UEngine::ToggleStatUnit), so every call
    # flips the display. Loops in this tree re-issued it every thirty ticks to "keep it alive" and were
    # switching it off half the time -- which is why runs reported stat_froze in the hundreds, why frame
    # samples came back sparse, and why a rung could report ten accepted frames in an eight-second window.
    #
    # FStatUnitData only advances while the overlay DRAWS, so the instrument was being disabled by the code
    # meant to protect it. The frozen-stat guard added this afternoon was detecting a fault this loop caused.
    #
    # Issued once at the top and never again. A genuine dropout is then a real signal rather than this job's
    # own doing, and the guard can be trusted.
    unreal.SystemLibrary.execute_console_command(world, "stat unit")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.0")
    yield 12.0

    def window(seconds):
        seen = []
        started = time.time()
        ticks = 0
        while time.time() - started < seconds:
            try:
                got = H.get_frame_cost_ms()
                if got is not None and float(got[0]) > 0.01:
                    seen.append((float(got[0]), float(got[1]), float(got[2]), float(got[3])))
            except Exception:
                pass
            ticks += 1
            yield 0.0
        clean = sorted(seen)
        globals()["_M"] = None if not clean else {
            "samples": len(clean),
            "frame": round(sorted(v[0] for v in clean)[len(clean) // 2], 2),
            "game": round(sorted(v[1] for v in clean)[len(clean) // 2], 2),
            "render": round(sorted(v[2] for v in clean)[len(clean) // 2], 2),
            "gpu": round(sorted(v[3] for v in clean)[len(clean) // 2], 2)}

    files = [os.path.join(AVATARS, n) for n in sorted(os.listdir(AVATARS)) if n.lower().endswith(".wlvox")]
    RESULT["avatar_files"] = len(files)
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    spot = dog.get_actor_location() + dog.get_actor_forward_vector() * 1100.0

    steps = {}
    RESULT["steps"] = steps

    yield from window(WINDOW_S)
    steps["00 no avatar, shadows on"] = globals().get("_M")

    body = L.spawn_figure_actor(world, spot, files[0], "WL_WhyAvatar")
    yield 8.0
    yield from window(WINDOW_S)
    steps["01 one avatar, shadows on"] = globals().get("_M")

    # ---- SHADOWS OFF. The one candidate a CVar can settle without a build.
    unreal.SystemLibrary.execute_console_command(world, "r.ShadowQuality 0")
    yield 6.0
    yield from window(WINDOW_S)
    steps["02 one avatar, shadows off"] = globals().get("_M")

    unreal.SystemLibrary.execute_console_command(world, "r.ShadowQuality 5")
    yield 6.0

    # ---- AND WITH THE BODY HIDDEN, which prices everything about it EXCEPT being drawn: the actor, its
    # ---- components, its animator and its ticks all still exist.
    if body is not None:
        body.set_actor_hidden_in_game(True)
    yield 6.0
    yield from window(WINDOW_S)
    steps["03 one avatar, hidden"] = globals().get("_M")
    if body is not None:
        body.set_actor_hidden_in_game(False)
    yield 4.0

    for k, v in steps.items():
        emit("W", "INFO", k, v)

    got_all = all(v is not None for v in steps.values())
    record("W00", "every step was measured with the clock running", got_all,
           steps={k: (v["frame"] if v else None) for k, v in steps.items()})
    if not got_all:
        RESULT["status"] = "FAIL"
        return

    on = steps["01 one avatar, shadows on"]["render"]
    off = steps["02 one avatar, shadows off"]["render"]
    hidden = steps["03 one avatar, hidden"]["render"]
    bare = steps["00 no avatar, shadows on"]["render"]
    RESULT["render_ms"] = {"no avatar": bare, "one avatar": on, "shadows off": off, "hidden": hidden}
    RESULT["shadow_share"] = round(on - off, 2)
    RESULT["draw_share"] = round(on - hidden, 2)

    record("W01", "the avatar's render cost is dynamic shadows, or it is not",
           True, render_ms=RESULT["render_ms"], shadows_account_for_ms=RESULT["shadow_share"],
           being_drawn_accounts_for_ms=RESULT["draw_share"],
           note="reported either way. A large gap between 'shadows on' and 'shadows off' names the cause; a "
                "large gap between 'one avatar' and 'hidden' says the cost is in drawing it at all, and a "
                "small one says the cost is in merely having it.")

    if body is not None:
        try:
            body.destroy_actor()
        except Exception:
            pass
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
