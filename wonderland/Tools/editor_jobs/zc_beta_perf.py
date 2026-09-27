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
        """Frame costs over a window, as the engine's own stat unit reports them.

        THE OVERLAY IS RE-ENABLED ONLY WHEN IT HAS ACTUALLY STOPPED REPORTING, BECAUSE "stat unit" TOGGLES.

        This has now failed in two different ways and the second one named the cause. Originally the command
        was issued once at the top of the job and two stands came back empty -- both at noon, both the last of
        that pass. Re-issuing it every 1.5 seconds fixed noon and broke MIDNIGHT instead, losing three stands
        there. A fix that moves a failure to the other end of the run has not addressed it.

        "stat unit" is a toggle, not a switch-on. Re-asking for it on a timer turns the overlay ON, then OFF,
        then ON, so whether a sample lands depends on the parity of how many times it has been issued. Both
        symptoms are the same bug seen at different phases.

        So it is re-issued only in response to evidence that it is off: a run of consecutive dead reads. A
        working overlay is never touched, and a lapsed one is switched back on once rather than flipped.

        AND A ZERO IS DISCARDED RATHER THAN AVERAGED IN. FStatUnitData reports 0.00 when the overlay is not
        drawing, so keeping those would not merely add noise -- it would drag a median toward zero and
        report a stand as FASTER the longer the overlay was off.
        """
        frames = []
        spent = 0.0
        dead = 0
        while spent < seconds:
            got = H.get_frame_cost_ms()
            if got is not None and float(got[0]) > 0.01:
                frame, game, render, gpu = got
                frames.append((frame, game, render, gpu))
                dead = 0
            else:
                dead += 1
                # Twenty dead reads is a second of nothing, which is the overlay being off rather than a
                # slow frame. Switched back on once, then left alone so it is not flipped off again.
                if dead == 20:
                    unreal.SystemLibrary.execute_console_command(world, "stat unit")
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
            # THE DOG IS RE-ACQUIRED AND GUARDED AT EVERY STAND, because since the map was converted to World
            # Partition a teleport can outrun its own ground: the destination cell is not loaded at the moment
            # of the jump, the Dog falls through where the floor will be, passes KillZ and is destroyed -- and
            # a destroyed pawn's Python wrapper is not None, it throws "ObjectInstance is null" on the next
            # touch. This job died on exactly that. Held at a stand height with its velocity reset until the
            # cell answers a downward trace, it survives; and if it does not, the stand is skipped rather than
            # taking the whole measurement down with it.
            try:
                live = unreal.GameplayStatics.get_player_pawn(world, 0)
                base = live.get_actor_location().z if live is not None else 0.0
            except Exception:                                      # noqa: BLE001
                live, base = None, 0.0
            if live is None:
                at_hour[name] = None
                continue
            dog = live
            hold = unreal.Vector(x, y, base + 150.0)
            import time as _t
            _began = _t.time()
            while True:
                try:
                    dog.set_actor_location(hold, False, False)
                    mc = dog.character_movement
                    if mc is not None:
                        mc.set_editor_property("velocity", unreal.Vector(0.0, 0.0, 0.0))
                except Exception:                                  # noqa: BLE001
                    break
                try:
                    under = unreal.SystemLibrary.line_trace_single(
                        world, hold, unreal.Vector(x, y, hold.z - 5000.0),
                        unreal.TraceTypeQuery.TRACE_TYPE_QUERY2, False, [dog],
                        unreal.DrawDebugTrace.NONE, True,
                        unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
                except Exception:                                  # noqa: BLE001
                    under = None
                if under is not None or _t.time() - _began > 10.0:
                    break
                yield 0.25
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
