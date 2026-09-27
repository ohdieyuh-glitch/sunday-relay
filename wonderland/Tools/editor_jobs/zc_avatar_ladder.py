# 0, 1, 5, 10 PROJECT AVATARS -- WHAT EACH ONE COSTS TO ARRIVE AND WHAT IT COSTS TO KEEP.
#
# FOUNDER, P0 item 5: "Cached spawn improved about 509 ms -> 73 ms but still hitches. Test 0/1/5/10 avatars
# and optimize remaining spawn/render cost. Project Avatars must scale inside one Server Avatar."
#
# TWO DIFFERENT COSTS, AND THEY NEED DIFFERENT STATISTICS. The HITCH is a single long frame and is felt
# however short the average around it; the STEADY cost is what the frame settles to afterwards and decides
# whether a crowd is playable at all. So each rung of the ladder is measured twice: the 95th percentile of
# the frames during the spawn (a percentile, because one unrelated shader compile inside a window will
# otherwise be reported as the avatar's fault -- this project has already made that mistake and read a spawn
# as SAVING 468 ms), and the median of the frames a few seconds later with nothing arriving.
#
# THE MARGINAL COST IS THE ANSWER. One avatar against none, and the tenth against the fifth, say whether the
# system scales or merely works at small numbers.
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
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "avatar_ladder")
RUNGS = (1, 5, 10)
SETTLE_S = 6.0
STEADY_S = 6.0


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
    unreal.SystemLibrary.execute_console_command(world, "stat unit")
    yield 10.0

    def stats(rows):
        clean = sorted(r for r in rows if r[0] > 0.01)
        if not clean:
            return None
        def at(p, i):
            return round(sorted(v[i] for v in clean)[min(len(clean) - 1, int(len(clean) * p))], 2)
        return {"samples": len(clean),
                "frame_median": at(0.5, 0), "frame_p95": at(0.95, 0), "frame_worst": at(0.999, 0),
                "game_median": at(0.5, 1), "render_median": at(0.5, 2), "gpu_median": at(0.5, 3)}

    def watch(seconds):
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
            if ticks % 30 == 0:
                unreal.SystemLibrary.execute_console_command(world, "stat unit")
            yield 0.0          # every tick: a hitch lives in one frame
        globals()["_SEEN"] = seen

    files = []
    try:
        for name in sorted(os.listdir(AVATARS)):
            if name.lower().endswith(".wlvox"):
                files.append(os.path.join(AVATARS, name))
    except Exception as err:                                       # noqa: BLE001
        RESULT["avatars_error"] = str(err)[:160]
    RESULT["avatar_files"] = len(files)
    record("A00", "there are Project Avatar figures to spawn", len(files) >= 1, found=len(files))
    if not files:
        RESULT["status"] = "FAIL: no avatars on disk"
        return

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    base = dog.get_actor_location() + dog.get_actor_forward_vector() * 1200.0

    # ---- RUNG ZERO: what the world costs with nothing added.
    yield from watch(STEADY_S)
    rungs = {"0": {"steady": stats(globals().get("_SEEN", []))}}
    RESULT["rungs"] = rungs
    emit("A_0", "INFO", "0 avatars", rungs["0"]["steady"])

    standing = []
    for want in RUNGS:
        during = []
        while len(standing) < want:
            i = len(standing)
            path = files[i % len(files)]
            spot = unreal.Vector(base.x + (i % 4) * 420.0 - 630.0,
                                 base.y + (i // 4) * 420.0 - 420.0, base.z)
            # WATCH THE FRAMES THE SPAWN LANDS IN. Three seconds is long enough to contain the build and
            # short enough that the window is mostly the spawn.
            started = time.time()
            body = L.spawn_figure_actor(world, spot, path, "WL_LadderAvatar_%d" % i)
            while time.time() - started < 3.0:
                try:
                    got = H.get_frame_cost_ms()
                    if got is not None and float(got[0]) > 0.01:
                        during.append((float(got[0]), float(got[1]), float(got[2]), float(got[3])))
                except Exception:
                    pass
                yield 0.0
            if body is not None:
                standing.append(body)

        yield SETTLE_S
        yield from watch(STEADY_S)
        rungs[str(want)] = {"spawning": stats(during), "steady": stats(globals().get("_SEEN", []))}
        shot = os.path.join(ROOT, "avatars_%02d.png" % want)
        try:
            L.capture_game_viewport(shot)
        except Exception:
            pass
        emit("A_%d" % want, "INFO", "%d avatars" % want, rungs[str(want)]["steady"])

    # ---- AND BACK DOWN AGAIN, WHICH IS THE CONTROL THE FIRST RUN DID NOT HAVE.
    #
    # The ascending ladder read 30.6 ms at zero, 132.0 at one, 88.2 at five and 55.9 at ten -- the cost FELL
    # as the crowd grew, which no per-avatar cost can do. Either the tier system is dropping the whole crowd
    # to a cheaper figure as it fills (which it is designed to do), or the first rung was paying for shader
    # compiles and streaming that the later rungs did not. Those have opposite fixes, and a descending pass
    # separates them: if one avatar is cheap on the way DOWN, the 132 ms was warm-up and not the avatar.
    down = {}
    RESULT["descending"] = down
    for want in (5, 1):
        while len(standing) > want:
            body = standing.pop()
            try:
                body.destroy_actor()
            except Exception:
                pass
        yield SETTLE_S
        yield from watch(STEADY_S)
        down[str(want)] = stats(globals().get("_SEEN", []))
        emit("A_DOWN_%d" % want, "INFO", "%d avatars, coming back down" % want, down[str(want)])
    RESULT["one_avatar_up_vs_down"] = {
        "up": rungs["1"]["steady"]["frame_median"] if rungs.get("1", {}).get("steady") else None,
        "down": down["1"]["frame_median"] if down.get("1") else None}

    read_all = all(v.get("steady") for v in rungs.values())
    record("A01", "every rung of the ladder was measured with the clock running", read_all,
           rungs=sorted(rungs.keys()),
           steady_frame_median={k: (v["steady"]["frame_median"] if v.get("steady") else None)
                                for k, v in rungs.items()})
    if not read_all:
        RESULT["status"] = "FAIL: stat unit did not report"
        return

    # ---- WHAT AN AVATAR COSTS TO KEEP, and whether the tenth costs what the first did.
    zero = rungs["0"]["steady"]["frame_median"]
    ten = rungs["10"]["steady"]["frame_median"]
    five = rungs["5"]["steady"]["frame_median"]
    one = rungs["1"]["steady"]["frame_median"]
    marginal = {"1st": round(one - zero, 2),
                "2nd-5th each": round((five - one) / 4.0, 2),
                "6th-10th each": round((ten - five) / 5.0, 2)}
    RESULT["marginal_ms_per_avatar"] = marginal
    RESULT["steady_ms"] = {"0": zero, "1": one, "5": five, "10": ten}
    emit("A_MARGINAL", "INFO", "what one more avatar costs", marginal)

    record("A02", "ten Project Avatars still hold a playable frame",
           ten <= 50.0, steady_ms=RESULT["steady_ms"], ceiling=50.0)

    # THE HONEST READING OF THE LADDER, once the control is in. A03 is only meaningful if the ascending and
    # descending readings for the same crowd size agree; where they do not, the ladder measured the machine
    # warming up and says so instead of pretending to a per-avatar cost.
    up_one = rungs["1"]["steady"]["frame_median"]
    down_one = down["1"]["frame_median"] if down.get("1") else None
    warm = down_one is not None and abs(up_one - down_one) > 12.0
    RESULT["warm_up_confounded"] = warm
    record("A05", "the ladder measured avatars and not the machine warming up",
           not warm, one_avatar_ascending_ms=up_one, one_avatar_descending_ms=down_one, tolerance=12.0,
           note="the same crowd size measured twice in one session, once on the way up and once on the way "
                "down. A gap here means the first rung paid for shader compiles the later rungs did not, and "
                "every marginal cost derived from the ascending pass is worth nothing.")

    record("A03", "the cost per avatar does not grow as the crowd does",
           marginal["6th-10th each"] <= marginal["2nd-5th each"] + 2.5,
           marginal_ms_per_avatar=marginal, tolerance=2.5,
           note="the founder: 'Project Avatars must scale inside one Server Avatar.' A system that scales "
                "charges about the same for the tenth as for the second; one that does not charges more.")

    # ---- AND THE HITCH, which is what the founder actually reported feeling.
    hitch = {k: (v["spawning"]["frame_p95"] if v.get("spawning") else None)
             for k, v in rungs.items() if k != "0"}
    quiet95 = rungs["0"]["steady"]["frame_p95"]
    RESULT["spawn_p95_ms"] = hitch
    RESULT["quiet_p95_ms"] = quiet95
    over = {k: (round(v - quiet95, 2) if v is not None else None) for k, v in hitch.items()}
    RESULT["hitch_over_quiet_ms"] = over
    record("A04", "arriving avatars do not stall the frame",
           all(v is not None and v <= 45.0 for v in over.values()),
           p95_during_spawn=hitch, p95_quiet=quiet95, over_quiet_ms=over, ceiling=45.0,
           note="the 95th percentile, not the max: one unrelated shader compile inside a spawn window would "
                "otherwise be charged to the avatar, and this project has already read a spawn as SAVING "
                "468 ms for exactly that reason.")

    for body in standing:
        try:
            body.destroy_actor()
        except Exception:
            pass
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
