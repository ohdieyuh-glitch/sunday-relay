# IS THE SPAWN HITCH PAID ONCE PER FIGURE, OR EVERY TIME ONE ARRIVES?
#
# FOUNDER, P0 item 5: "Cached spawn improved about 509 ms -> 73 ms but still hitches ... optimize remaining
# spawn/render cost."
#
# WHY THIS QUESTION AND NOT ANOTHER SWEEP. The two answers have completely different fixes and there is no
# point guessing between them:
#
#   PER FIGURE, FIRST TIME ONLY  -> pre-warm at load. Build each distinct avatar once behind the loading
#                                   screen and the cost never lands in play again.
#   EVERY SPAWN                  -> pre-warming buys nothing and the build has to be amortised across
#                                   frames instead, so a figure appears over several frames rather than
#                                   stalling one.
#
# The existing cache already covers PARSING -- that is the 509 ms to 73 ms the founder measured, and it is
# keyed by path and timestamp. What it does not cover is the construction: roughly seventy instanced
# components, about thirty-two thousand instances, a material instance per surface, each registered. None of
# that is shared between spawns.
#
# THE LADDER CANNOT ANSWER IT, which is why this exists. It cycles ten DIFFERENT files, so "the fifth avatar"
# and "a fifth distinct figure" are the same event there and cannot be told apart. Here one single file is
# spawned eight times in a row. If the hitch belongs to the figure, only the first arrival is expensive. If it
# belongs to the act of spawning, all eight cost the same.
#
# Each arrival is measured on its own, and the p95 rather than the max: one unrelated compile inside a window
# would otherwise be charged to the avatar, and this project has already drawn a confident conclusion from
# exactly that kind of contamination today.
CONCURRENT = True

import os
import time
import unreal

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary

AVATARS = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "ProjectAvatars")
ARRIVALS = 8
WATCH_S = 3.0


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
    unreal.SystemLibrary.execute_console_command(world, "stat unit")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.0")
    yield 12.0

    # ---- THE DISTANCE FIELD LEVER, SWEPT RATHER THAN ASSUMED.
    #
    # The arrival cost is flat at about 22 ms over quiet and comes from registering forty-one components in
    # one frame. Lumen's global distance field is updated when a primitive registers, so a figure that opts
    # out of it should pay less. Measured both ways in one session at one temperature, because the alternative
    # is trusting that it sounds right -- which is how the pre-warm got built and reverted earlier today.
    mode = "0"   # this copy measures the lever OFF; its twin measures it ON
    unreal.SystemLibrary.execute_console_command(world, "wl.Figure.DistanceField %s" % mode)
    RESULT["distance_field"] = str(mode)
    yield 2.0

    files = [os.path.join(AVATARS, n) for n in sorted(os.listdir(AVATARS)) if n.lower().endswith(".wlvox")]
    big = [f for f in files if "Large" in f] or files
    if not big:
        record("F00", "there is a Project Avatar to spawn repeatedly", False)
        RESULT["status"] = "FAIL"
        return
    # THE HEAVIEST FIGURE, because a hitch that does not show on the worst case will not show at all.
    path = big[0]
    RESULT["figure"] = os.path.basename(path)
    record("F00", "there is a Project Avatar to spawn repeatedly", True, figure=os.path.basename(path))

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    base = dog.get_actor_location() + dog.get_actor_forward_vector() * 1100.0

    def quiet():
        seen = []
        started = time.time()
        while time.time() - started < 4.0:
            try:
                got = H.get_frame_cost_ms()
                if got is not None and float(got[0]) > 0.01:
                    seen.append(float(got[0]))
            except Exception:                                      # noqa: BLE001
                pass
            yield 0.0
        globals()["_QUIET"] = seen

    yield from quiet()
    rest = globals().get("_QUIET") or []
    rest.sort()
    quiet_p95 = round(rest[int(len(rest) * 0.95)] if rest else 0.0, 2)
    RESULT["quiet_p95_ms"] = quiet_p95

    standing = []
    arrivals = []
    RESULT["arrivals_p95_ms"] = arrivals
    for i in range(ARRIVALS):
        during = []
        # ---- EVERY ARRIVAL AT THE SAME DISTANCE FROM THE CAMERA, WHICH THE FIRST VERSION DID NOT DO.
        #
        # It laid them out in rows receding from the viewer -- (i%4, i//4) -- so arrivals 1 to 3 landed in the
        # near row and 7 to 8 in the far one. The p95 then fell from 168 ms to 33 across the series and was
        # read as a warm-up completing. It was not: later avatars were simply further away and cheaper to
        # submit. A pre-warm built on that reading changed the series by about seven per cent, which is run
        # variance, and that is what exposed the mistake.
        #
        # Spread around a circle at a fixed radius instead. Distance is then constant and the only thing left
        # varying is how many have already arrived, which is the question actually being asked.
        import math as _m
        angle = (i / float(ARRIVALS)) * 2.0 * _m.pi
        spot = unreal.Vector(base.x + _m.cos(angle) * 520.0, base.y + _m.sin(angle) * 520.0, base.z)
        started = time.time()
        body = L.spawn_figure_actor(world, spot, path, "WL_FirstTime_%d" % i)
        while time.time() - started < WATCH_S:
            try:
                got = H.get_frame_cost_ms()
                if got is not None and float(got[0]) > 0.01:
                    during.append(float(got[0]))
            except Exception:                                      # noqa: BLE001
                pass
            yield 0.0
        if body is not None:
            standing.append(body)
        during.sort()
        p95 = round(during[int(len(during) * 0.95)] if during else 0.0, 2)
        arrivals.append(p95)
        emit("F_%d" % i, "INFO", "arrival %d" % (i + 1), {"p95_ms": p95, "frames": len(during)})
        yield 1.0

    for body in standing:
        try:
            body.destroy_actor()
        except Exception:                                          # noqa: BLE001
            pass

    read = [v for v in arrivals if v > 0.0]
    record("F01", "every arrival was measured with the clock running",
           len(read) == ARRIVALS, measured=len(read), wanted=ARRIVALS, arrivals=arrivals)
    if len(read) != ARRIVALS:
        RESULT["status"] = "FAIL: the overlay did not report for every arrival"
        return

    first = arrivals[0]
    rest_of_them = arrivals[1:]
    later = round(sum(rest_of_them) / float(len(rest_of_them)), 2)
    RESULT["first_arrival_ms"] = first
    RESULT["later_arrivals_mean_ms"] = later
    RESULT["first_over_later_ms"] = round(first - later, 2)

    # ---- THE VERDICT, AND IT IS REPORTED EITHER WAY RATHER THAN GATED.
    #
    # This does not pass or fail a requirement -- it decides which of two fixes is the right one, and saying
    # "the first arrival cost 60 ms more than the rest" is worth more than a green tick.
    record("F02", "the answer is recorded: first-time cost, or every-time cost",
           True, first_arrival_ms=first, later_arrivals_mean_ms=later,
           first_over_later_ms=RESULT["first_over_later_ms"], quiet_p95_ms=quiet_p95,
           all_arrivals=arrivals,
           note="the SAME figure spawned eight times. A large gap between the first and the rest means the "
                "cost belongs to the figure and pre-warming at load removes it from play entirely. A flat "
                "series means it belongs to the act of spawning, pre-warming buys nothing, and the build has "
                "to be spread across frames instead.")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
