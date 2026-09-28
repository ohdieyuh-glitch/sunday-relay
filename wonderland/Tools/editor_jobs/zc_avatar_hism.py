# IS THE QUADTREE EARNING ITS KEEP ON A PROJECT AVATAR?
#
# FOUNDER, P0 item 5: "Test 0/1/5/10 avatars and optimize remaining spawn/render cost. Project Avatars must
# scale inside one Server Avatar."
#
# WHAT THE LADDER NARROWED IT TO. One Large avatar costs 18.7 ms of frame; hiding it gives back 15.5 and
# turning its shadows off gives back 0.8. Not the animator, not the ticking, not the shadows, not having the
# actor -- submitting it to be drawn, across ~70 movable components and ~31,900 instances.
#
# THE UNTRIED LEVER. Those components are HierarchicalInstancedStaticMesh, chosen for per-instance culling and
# never measured against the plain kind. Per-instance culling pays when instances are spread over a
# landscape; every instance in one of these is inside a volume the size of a shoe, moves with its component,
# and is either all visible or all not. wl.Figure.Hism now switches it, so both can be measured in one
# session at one temperature -- which matters, because the first avatar ladder read the machine warming up
# and reported a spawn as SAVING 468 ms.
#
# BOTH DIRECTIONS, and that is the control. Each setting is measured twice, once on the way out and once on
# the way back, so a difference that is really thermal drift shows up as the two passes disagreeing rather
# than as a result.
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
WINDOW_S = 7.0
SETTLE_S = 5.0


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
        def mid(i):
            return round(sorted(v[i] for v in clean)[len(clean) // 2], 2)
        globals()["_M"] = None if not clean else {
            "samples": len(clean), "frame": mid(0), "game": mid(1), "render": mid(2), "gpu": mid(3)}

    files = [os.path.join(AVATARS, n) for n in sorted(os.listdir(AVATARS)) if n.lower().endswith(".wlvox")]
    RESULT["avatar_files"] = len(files)
    record("H00", "there is a Project Avatar figure to spawn", len(files) >= 1, found=len(files))
    if not files:
        RESULT["status"] = "FAIL: no avatars on disk"
        return

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    spot = dog.get_actor_location() + dog.get_actor_forward_vector() * 1100.0

    steps = {}
    RESULT["steps"] = steps

    def measure(label, hism):
        unreal.SystemLibrary.execute_console_command(world, "wl.Figure.Hism %d" % hism)
        # The setting is read when the figure is BUILT, so the avatar has to be made after it is set.
        body = L.spawn_figure_actor(world, spot, files[0], "WL_HismProbe")
        yield SETTLE_S
        yield from window(WINDOW_S)
        with_one = globals().get("_M")
        parts = None
        if body is not None:
            try:
                parts = len(body.get_components_by_class(unreal.InstancedStaticMeshComponent))
            except Exception:
                parts = None
            try:
                body.destroy_actor()
            except Exception:
                pass
        yield SETTLE_S
        yield from window(WINDOW_S)
        without = globals().get("_M")
        row = {"with_one_avatar": with_one, "with_none": without, "components": parts}
        if with_one and without:
            row["avatar_costs_ms"] = round(with_one["frame"] - without["frame"], 2)
        steps[label] = row
        emit("H_%s" % label, "INFO", label, row)

    # OUT AND BACK. hism, plain, plain, hism -- so each setting is measured once early and once late and the
    # pair can be compared against each other before either is compared to the other setting.
    yield from measure("01 hierarchical (first)", 1)
    yield from measure("02 plain (first)", 0)
    yield from measure("03 plain (second)", 0)
    yield from measure("04 hierarchical (second)", 1)

    unreal.SystemLibrary.execute_console_command(world, "wl.Figure.Hism 1")

    costs = {k: v.get("avatar_costs_ms") for k, v in steps.items()}
    RESULT["avatar_cost_ms"] = costs
    got_all = all(v is not None for v in costs.values())
    record("H01", "every pass was measured with the clock running", got_all, costs=costs,
           note="all zeroes means the stat unit overlay stopped drawing, not that an avatar became free")
    if not got_all:
        RESULT["status"] = "FAIL: stat unit did not report"
        return

    hier = [costs["01 hierarchical (first)"], costs["04 hierarchical (second)"]]
    plain = [costs["02 plain (first)"], costs["03 plain (second)"]]
    RESULT["hierarchical_ms"] = hier
    RESULT["plain_ms"] = plain
    drift = max(abs(hier[0] - hier[1]), abs(plain[0] - plain[1]))
    RESULT["repeat_disagreement_ms"] = round(drift, 2)

    gap = round((sum(hier) / 2.0) - (sum(plain) / 2.0), 2)
    RESULT["hierarchical_minus_plain_ms"] = gap
    record("H02", "the two passes at each setting agree well enough to compare the settings",
           drift <= 6.0, hierarchical=hier, plain=plain, disagreement_ms=RESULT["repeat_disagreement_ms"],
           tolerance=6.0,
           note="the same setting measured early and late. If these disagree by more than the gap between "
                "SETTINGS, the experiment measured the machine and not the quadtree.")
    record("H03", "the quadtree is or is not costing a Project Avatar time",
           True, hierarchical_ms=hier, plain_ms=plain, hierarchical_minus_plain_ms=gap,
           repeat_disagreement_ms=RESULT["repeat_disagreement_ms"],
           note="reported either way, and only meaningful if H02 passed. A positive gap larger than the "
                "disagreement says the plain component is cheaper for this shape of data and the default "
                "should change; anything smaller says the tree is not where the 15.5 ms lives.")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
