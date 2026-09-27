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


def _editor_foreground():
    """Whether this editor owns the foreground window. Behind another window the editor throttles PIE
    (EditorPerformanceSettings.bThrottleCPUWhenNotForeground is neither Python-visible nor settable with
    `set` in the editor), so a frame rate is only a measurement when this is True. Copied from beta_probe,
    where it has been right since it was written -- this job simply never asked."""
    try:
        import ctypes
        user32 = ctypes.windll.user32
        pid = ctypes.c_ulong(0)
        user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), ctypes.byref(pid))
        return pid.value == os.getpid()
    except Exception:                                              # noqa: BLE001
        return None


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

    def read_frame():
        """ONE ROW PER FRAME, carrying both the averaged cost and the raw cost of that frame.

        Returns None when the engine frame number has not moved since the last accepted row, so a loop that
        polls faster than the game renders contributes nothing instead of contributing a duplicate.
        """
        try:
            now = int(H.get_engine_frame_number())
        except Exception:                                          # noqa: BLE001
            now = None
        if now is not None and now == globals().get("_LAST_FRAME"):
            return None
        try:
            avg = H.get_frame_cost_ms()
            raw = H.get_raw_frame_cost_ms()
        except Exception:                                          # noqa: BLE001
            return None
        if avg is None or raw is None or float(avg[0]) <= 0.01:
            return None
        globals()["_LAST_FRAME"] = now
        return (float(avg[0]), float(avg[1]), float(avg[2]), float(avg[3]),
                float(raw[0]), float(raw[1]), float(raw[3]))

    def stats(rows):
        clean = [r for r in rows if r[0] > 0.01]
        if not clean:
            return None
        def at(p, i):
            col = sorted(v[i] for v in clean if len(v) > i)
            if not col:
                return None
            return round(col[min(len(col) - 1, int(len(col) * p))], 2)
        # ---- MEDIANS FROM THE AVERAGED FIELDS, EXTREMES FROM THE RAW ONES.
        #
        # FStatUnitData holds both, and its own comment calls the first block "filtered with a simple running
        # average": FrameTime = 0.9 * FrameTime + 0.1 * RawFrameTime, and the same for game, render and GPU.
        # A ten-frame exponential average is a fair estimate of AVERAGE cost and is physically incapable of
        # showing a single expensive frame -- a 200 ms spike arrives as 15 ms. This job published spawn_p95
        # and hitch_over_quiet from the filtered field and reported spawning as CHEAPER than standing still at
        # one and at ten avatars. A negative hitch is not a surprising measurement, it is an impossible one.
        #
        # So p95 and worst now come from RawFrameTime, where a hitch is a single row, and the medians stay on
        # the filtered field where the filter is an advantage. Both are labelled for whoever reads the JSON.
        out = {"frames": len(clean),
               "frame_median": at(0.5, 0), "raw_p95": at(0.95, 4), "raw_worst": at(0.999, 4),
               "raw_median": at(0.5, 4), "raw_game_p95": at(0.95, 5), "raw_gpu_p95": at(0.95, 6),
               "game_median": at(0.5, 1), "render_median": at(0.5, 2), "gpu_median": at(0.5, 3)}
        # ---- HOW MUCH OF THE FRAME IS ACCOUNTED FOR, which is what tells a LOAD from a CLAMP.
        #
        # The 2026-09-27 run of this job reported 38.71 ms at zero avatars and then 375.72, 400.10 and 399.94
        # at one, five and ten -- and 400.12 coming back DOWN to one. A cost identical at one and at ten, and
        # identical again descending, does not come from avatars. In the same rows game was 27 ms and GPU 23:
        # fifty milliseconds of four hundred accounted for, and a worst case of 400.6 against a median of
        # 400.12. That is a frame waiting on a clamp, not a frame doing work, and the editor's background
        # throttle is the clamp -- it engages when this editor stops owning the foreground window, which
        # nothing in the run re-checked after the first call to focus_game_viewport.
        #
        # So every rung now carries the ratio. It needs no Windows API and it catches any clamp, not just
        # this one: vsync, a frame-rate cap, a stalled render thread. A reading where the work does not add
        # up to the frame is not a measurement of the thing being measured.
        busiest = max(out["game_median"], out["gpu_median"], out["render_median"])
        out["accounted_fraction"] = round(busiest / max(out["frame_median"], 0.01), 3)
        out["unaccounted_ms"] = round(out["frame_median"] - busiest, 2)
        out["foreground"] = _editor_foreground()
        return out

    def watch(seconds):
        seen = []
        started = time.time()
        ticks = 0
        reads = 0
        while time.time() - started < seconds:
            reads += 1
            row = read_frame()
            if row is not None:
                seen.append(row)
            ticks += 1
            if ticks % 30 == 0:
                unreal.SystemLibrary.execute_console_command(world, "stat unit")
            yield 0.0          # a hitch lives in one frame, so every frame is sampled -- and only once
        globals()["_SEEN"] = seen
        # THE RATIO IS THE EVIDENCE. 253 reads over 3 frames is what produced a median, a p95 and a worst case
        # that agreed to the hundredth; publishing it means the next reader can see the duplication rather
        # than having to deduce it from suspiciously flat percentiles.
        globals()["_SEEN_READS"] = reads

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

    # ---- RUNG ZERO: what the world costs with nothing added, MEASURED FIVE TIMES.
    #
    # THE SPREAD COMES BEFORE THE VALUE. The world lane put four runs of one walk beside each other and got
    # peak speeds of 230, 0, 35.2 and 86.0 on the same route -- and every cause either of us proposed for that
    # deliverable had been built on ONE reading of a distribution nobody had checked was one. This job has the
    # same exposure: it published 106.58 ms at one avatar with 23% accounted, beside 31.37 at zero and 45.05
    # at ten, and that single number is the only thing left unexplained in the founder's item 5.
    #
    # So rung zero is read five times in one session before anything is concluded from any of them. If the
    # five disagree with each other by as much as the rungs disagree, the ladder is noise and A06 says so at
    # the top rather than leaving it to be noticed.
    repeats = []
    for _ in range(8):
        yield from watch(STEADY_S)
        got = stats(globals().get("_SEEN", []))
        if got:
            repeats.append(got)
        yield 1.0
    RESULT["rung_zero_repeats"] = repeats
    RESULT["rung_zero_series"] = [r["frame_median"] for r in repeats]

    # ---- AND THE FIRST READS ARE THE WORLD WARMING UP, NOT THE WORLD.
    #
    # Five reads of an UNCHANGED world came back 521.22, 123.11, 63.97, 47.95, 57.12: not scatter, a descent.
    # Shaders, streaming and the render pipeline settle over the first half-minute of play, and rung zero has
    # always been taken immediately after BeginPlay -- so the one rung every marginal cost is subtracted from
    # has always been the least settled measurement in the job, and the spread it showed was mostly its own
    # warm-up. That is the same error as a fixed settle timer, in a different coat: a count of reads is a
    # guess about when the machine is ready.
    #
    # So reads are discarded until consecutive ones stop falling: the series is settled from the first read
    # whose successor is within a tenth of it, and only the settled tail is used. If it never settles, nothing
    # is discarded and A06 fails on the full spread, which is the honest outcome rather than a trimmed one.
    # THE TREND HAS TO STOP, NOT ONE PAIR TO MATCH. A gently falling series has neighbours inside any
    # tolerance while it is still on its way down -- 47.95 then 57.12 would pass a pair test mid-descent. So a
    # read LOWER than its predecessor resets the wait, and the settled point is the last time that happened.
    # The world lane hit the same hole in their own settle an hour after fixing the timer version of it.
    series = [r["frame_median"] for r in repeats]
    settled_from = 0
    for i in range(1, len(series)):
        if series[i] < series[i - 1] * 0.90:
            settled_from = i
    settled = repeats[settled_from:] if len(repeats) - settled_from >= 2 else repeats
    RESULT["rung_zero_warmup_reads"] = settled_from
    repeats = settled
    frames = sorted(r["frame_median"] for r in repeats)
    rungs = {"0": {"steady": repeats[len(repeats) // 2] if repeats else None}}
    RESULT["rungs"] = rungs
    RESULT["rung_zero_spread"] = {
        "reads": len(frames), "lowest": frames[0] if frames else None, "highest": frames[-1] if frames else None,
        "spread_ms": round(frames[-1] - frames[0], 2) if frames else None,
        "note": "the median of these is what the ladder uses; the spread is what says whether it means anything",
    }
    emit("A_0", "INFO", "0 avatars, five reads", RESULT["rung_zero_spread"])

    standing = []
    spawn_read_total = 0
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
            spawn_reads = 0
            while time.time() - started < 3.0:
                spawn_reads += 1
                row = read_frame()
                if row is not None:
                    during.append(row)
                yield 0.0
            spawn_read_total += spawn_reads
            if body is not None:
                standing.append(body)

        yield SETTLE_S
        yield from watch(STEADY_S)
        rungs[str(want)] = {"spawning": stats(during), "steady": stats(globals().get("_SEEN", []))}
        if rungs[str(want)]["spawning"]:
            rungs[str(want)]["spawning"]["reads"] = spawn_read_total
        if rungs[str(want)]["steady"]:
            rungs[str(want)]["steady"]["reads"] = globals().get("_SEEN_READS")
        spawn_read_total = 0
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
    spread = RESULT.get("rung_zero_spread") or {}
    steady = {k: (v.get("steady") or {}).get("frame_median") for k, v in rungs.items()}
    ladder_range = 0.0
    known = [v for v in steady.values() if isinstance(v, (int, float))]
    if len(known) > 1:
        ladder_range = max(known) - min(known)
    record("A06", "the instrument repeats: one setting read five times disagrees LESS than the settings do",
           isinstance(spread.get("spread_ms"), float) and spread["spread_ms"] <= max(ladder_range * 0.5, 5.0),
           rung_zero_spread=spread, ladder_range_ms=round(ladder_range, 2),
           note="five reads of an unchanged world. If they scatter as widely as the rungs, nothing below is a "
                "measurement of avatars -- it is a measurement of this machine. Every cause proposed for the "
                "unexplained 106.58 ms at one avatar was, until this ran, a single draw from an unchecked "
                "distribution.")
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
    # RAW, BECAUSE A HITCH IS ONE FRAME. The averaged field cannot carry one, and reading it here is what made
    # this clause report spawning as cheaper than standing still.
    hitch = {k: (v["spawning"]["raw_p95"] if v.get("spawning") else None)
             for k, v in rungs.items() if k != "0"}
    quiet95 = rungs["0"]["steady"]["raw_p95"]
    RESULT["spawn_p95_ms"] = hitch
    RESULT["quiet_p95_ms"] = quiet95
    over = {k: (round(v - quiet95, 2) if v is not None else None) for k, v in hitch.items()}
    RESULT["hitch_over_quiet_ms"] = over
    # A NEGATIVE HITCH VOIDS THE CLAUSE RATHER THAN PASSING IT. Spawning cannot cost less than standing still,
    # so a negative value means the two windows are not comparable -- different settle states, or an instrument
    # that is not measuring frames. The old version passed on exactly that, twice.
    impossible = {k: v for k, v in over.items() if v is not None and v < -2.0}
    RESULT["impossible_hitches"] = impossible or None
    record("A04", "arriving avatars do not stall the frame",
           not impossible and all(v is not None and v <= 45.0 for v in over.values()),
           impossible_negative=impossible or None,
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
