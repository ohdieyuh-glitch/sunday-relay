# WHAT WONDERLAND COSTS TO DRAW, AT THE END OF THIS RUN.
#
# Measured in ONE session, at four places a beta player actually stands, with the frame cost taken as a MEDIAN
# so that a single hitch cannot move it. Everything here is a fact about this machine on this afternoon and
# nothing here is a comparison with a number taken on another day: this laptop throttles under sustained PIE,
# and an A and a B measured an hour apart measure the thermals.
#
# WHAT IS NEW SINCE THE LAST MEASUREMENT IS LISTED, so the founder can see what the cost includes: a second
# shadow-casting directional light after dark (the moon), a small unshadowed lamp on the Dog at night, five
# territory checkpoints, and a deeper glow animation on one skin.
CONCURRENT = True

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "beta_perf")
#: Four stands: the arrival plaza, the Icarus checkpoint, a nation march, and out in the wilderness belt.
STANDS = (("arrival", 0.0, -1460.0), ("icarus_checkpoint", 0.0, 52500.0),
          ("tartarus_march", 45466.0, -26250.0), ("dubel_belt", 0.0, 120000.0))
SECONDS = 7.0


def job():
    os.makedirs(ROOT, exist_ok=True)
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
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)

    # STAT UNIT HAS TO BE DRAWING or FStatUnitData never advances and every reading is 0.00.
    #
    # THE FIRST RUN OF THIS JOB REPORTED 0.00 ms AT EVERY STAND, AT BOTH HOURS, AND PASSED -- a frame cost of
    # zero is under any ceiling. That is the shape of a vacuous pass and the reason F00 below now asserts the
    # numbers are non-zero before anything is concluded from them. The overlay is re-issued at every stand
    # because the engine drops it on some state changes.
    unreal.SystemLibrary.execute_console_command(world, "stat unit")
    yield 2.0

    def window(seconds):
        """Frame costs over a window, as the engine's own stat unit reports them."""
        frames = []
        spent = 0.0
        while spent < seconds:
            got = H.get_frame_cost_ms()
            if got is not None:
                frame, game, render, gpu = got
                frames.append((frame, game, render, gpu))
            yield 0.05
            spent += 0.05
        RESULT.setdefault("_windows", []).append(len(frames))
        globals()["_LAST"] = frames

    def summarise(frames):
        if not frames:
            return None
        def median(vals):
            s = sorted(vals)
            return round(s[len(s) // 2], 2)
        return {"frames": len(frames),
                "frame_ms": median([f[0] for f in frames]),
                "game_ms": median([f[1] for f in frames]),
                "render_ms": median([f[2] for f in frames]),
                "gpu_ms": median([f[3] for f in frames])}

    readings = {}
    RESULT["by_hour"] = readings
    for hour_label, hour in (("noon", 12.0), ("midnight", 0.0)):
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.1f" % hour)
        yield 3.0
        at_hour = {}
        readings[hour_label] = at_hour
        for name, x, y in STANDS:
            dog.set_actor_location(unreal.Vector(x, y, dog.get_actor_location().z + 150.0), False, False)
            # Let streaming and Lumen settle before the clock is read, not while it is.
            unreal.SystemLibrary.execute_console_command(world, "stat unit")
            yield 6.0
            yield from window(SECONDS)
            at_hour[name] = summarise(globals().get("_LAST", []))
            try:
                L.capture_game_viewport(os.path.join(ROOT, "%s_%s.png" % (hour_label, name)))
            except Exception:
                pass
            emit("F_%s_%s" % (hour_label, name), "INFO", "%s at %s" % (name, hour_label), at_hour[name])

    read_all = all(v is not None and v["frame_ms"] > 0.05
                   for hour in readings.values() for v in hour.values())
    record("F00", "every stand was measured at noon and at midnight, and the clock was actually running",
           read_all, stands=[s[0] for s in STANDS],
           frame_ms={"%s/%s" % (h, k): (v["frame_ms"] if v else None)
                     for h, hour in readings.items() for k, v in hour.items()},
           note="a frame cost of 0.00 is what FStatUnitData reports when the stat unit overlay is not "
                "drawing, and it is under every ceiling anyone would set. Asserted here so the two clauses "
                "below cannot pass on nothing.")
    if not read_all:
        RESULT["status"] = "FAIL: stat unit did not report"
        return

    worst = max(v["frame_ms"] for hour in readings.values() for v in hour.values())
    RESULT["worst_frame_ms"] = worst
    record("F01", "the worst stand in the world holds a playable frame",
           worst <= 50.0, worst_frame_ms=worst, ceiling=50.0,
           note="a ceiling, not a target. This is an editor PIE window on a throttling laptop, which is the "
                "harshest place Wonderland is ever drawn; a packaged build has never been measured and that "
                "gap is listed as a beta blocker rather than estimated away.")

    # WHAT NIGHT COSTS, which is the only new per-frame cost this run added that runs all the time.
    night_cost = {}
    for name, _x, _y in STANDS:
        day = readings["noon"][name]["frame_ms"]
        night = readings["midnight"][name]["frame_ms"]
        night_cost[name] = round(night - day, 2)
    RESULT["night_over_noon_ms"] = night_cost
    record("F02", "the moon's second shadow-casting light is affordable",
           all(v <= 14.0 for v in night_cost.values()),
           night_minus_noon_ms=night_cost, ceiling=14.0,
           note="midnight now runs a second directional light with two cascades, plus a small unshadowed lamp "
                "on the Dog. This is what that costs, measured in the same session as the noon figure it is "
                "subtracted from.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
