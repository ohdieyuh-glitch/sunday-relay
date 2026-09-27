# IS NAVIGATION ACTUALLY COSTING THE FRAME, OR IS THIS MACHINE JUST WARMER THAN IT WAS?
#
# Three runs of zc_avatar_cost before navigation read a baseline of 28.4-30.5 ms, and three runs after it
# read 32.3-36.3. The ranges do not overlap, which looks conclusive -- until you notice the first set was
# taken ninety minutes earlier, and that this machine throttles under sustained PIE. Two measurements an hour
# and a half apart share a confound big enough to explain the whole difference, and attributing it to
# navigation on that evidence would be exactly the mistake I already had to retract twice today.
#
# So both sides are measured HERE, minutes apart, in one job, at the same thermal state. The only thing that
# changes between them is the navmesh's runtime_generation: DYNAMIC builds tiles around the invoker, STATIC
# builds none at all. Whatever separates the two readings is navigation, and whatever does not, is not.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import time
import unreal

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary

#: Seconds of frames to average per side. Long enough that a single hitch cannot decide it.
SAMPLE_S = 22.0


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)

    def set_generation(mode):
        """mode: 'STATIC' or 'DYNAMIC'. Returns what the actors actually report afterwards."""
        world = ues.get_editor_world()
        got = []
        enum = getattr(unreal, "RuntimeGenerationType", None)
        want = getattr(enum, mode, None) if enum is not None else None
        for m in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.RecastNavMesh):
            for value in (want, mode, 0 if mode == "STATIC" else 2):
                if value is None:
                    continue
                try:
                    m.set_editor_property("runtime_generation", value)
                    break
                except Exception:
                    continue
            try:
                got.append(str(m.get_editor_property("runtime_generation")))
            except Exception:
                got.append("unreadable")
        return got

    def measure(label):
        """Average frame cost over SAMPLE_S of real play, discarding the first seconds of settling."""
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        L.focus_game_viewport()
        gw = ues.get_game_world()
        # FStatUnitData ONLY ADVANCES WHILE THE STAT OVERLAY IS DRAWING, and it has to be re-issued: the first
        # version of this job sampled without it and read 0.00 ms on BOTH sides, which would have reported
        # "navigation is free" from an instrument that was never running. zc_avatar_cost already knew this.
        unreal.SystemLibrary.execute_console_command(gw, "stat unit")
        # Let streaming, TSR history and any generation settle before counting anything.
        yield 12.0
        samples = []
        started = time.time()
        while time.time() - started < SAMPLE_S:
            try:
                samples.append(float(H.get_frame_cost_ms()[0]))
            except Exception:
                pass
            if len(samples) % 20 == 0:
                unreal.SystemLibrary.execute_console_command(gw, "stat unit")
            yield 0.25
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        clean = [v for v in samples if v > 0.01]
        clean.sort()
        out = {
            "samples": len(clean),
            "mean_ms": round(sum(clean) / len(clean), 2) if clean else 0.0,
            "median_ms": round(clean[len(clean) // 2], 2) if clean else 0.0,
            "worst_ms": round(clean[-1], 2) if clean else 0.0,
        }
        emit(label, "INFO", label, out)
        RESULT[label] = out
        return out

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)

    # ---- SIDE A: navigation generating.
    RESULT["set_dynamic"] = set_generation("DYNAMIC")
    yield 1.0
    try:
        les.save_current_level()
    except Exception as err:                                       # noqa: BLE001
        RESULT["save_error_dynamic"] = str(err)[:160]
    yield 2.0
    with_nav = yield from measure("with_navigation")

    # ---- SIDE B: the same world, minutes later, generating nothing.
    RESULT["set_static"] = set_generation("STATIC")
    yield 1.0
    try:
        les.save_current_level()
    except Exception as err:                                       # noqa: BLE001
        RESULT["save_error_static"] = str(err)[:160]
    yield 2.0
    without_nav = yield from measure("without_navigation")

    # ---- AND PUT IT BACK THE WAY IT SHIPS. A cost measurement that left the level unroutable would have
    # broken the thing it was measuring.
    RESULT["restored"] = set_generation("DYNAMIC")
    yield 1.0
    try:
        les.save_current_level()
    except Exception as err:                                       # noqa: BLE001
        RESULT["save_error_restore"] = str(err)[:160]
    yield 2.0

    cost = round(with_nav["median_ms"] - without_nav["median_ms"], 2)
    RESULT["navigation_costs_ms"] = cost
    record("N01", "both sides were actually measured",
           with_nav["samples"] > 20 and without_nav["samples"] > 20,
           with_navigation=with_nav, without_navigation=without_nav)
    record("N02", "the level is left routable, not left as the cost fixture",
           any("DYNAMIC" in str(v).upper() for v in RESULT["restored"]),
           restored=RESULT["restored"])
    emit("N03", "INFO", "what navigation costs, same session, same thermal state",
         {"with_median_ms": with_nav["median_ms"], "without_median_ms": without_nav["median_ms"],
          "difference_ms": cost})
    RESULT["status"] = "measured"
