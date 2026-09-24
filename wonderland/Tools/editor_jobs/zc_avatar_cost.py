# WHAT DOES A PROJECT AVATAR REALLY COST?
#
# FOUNDER: "When Project Avatars spawn, Wonderland currently lags extremely badly... DO NOT solve this by
# simply reducing the number of Project Avatars. The system itself must become cheaper."
#
# THE MEASUREMENT THIS REPLACES WAS VOID, and saying so is the point of this file. The first pass timed frames
# with GetWorldDeltaSeconds and reported 349 ms mean / 400 ms worst WITH NO AVATARS SPAWNED AT ALL. 400.00 is
# UE's max-delta clamp, not a reading: an unfocused PIE window throttles straight into it, so every number in
# that run described the editor's throttle rather than the cost of anything. A baseline that already sits at
# the clamp cannot measure an increase.
#
# So this reads FStatUnitData -- the same counters `stat unit` draws, each measured where it happens -- and
# REFUSES TO REPORT at all if the baseline is anywhere near the clamp. A run that cannot be trusted says so.
import os
import time

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "avatar_cost")
FAMILIES = ["Cherubim", "Seraph", "TenTails"]
CLAMP_MS = 400.0


def job():
    os.makedirs(ROOT, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    rows = []
    RESULT["measurements"] = rows
    RESULT["status"] = "running"

    # A LEFTOVER PIE IS NOT A REASON TO FAIL. An earlier run of this job errored before it could end play,
    # and the next one then sat waiting 600 frames for a world that was never going to go away on its own.
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 6.0
    world = ues.get_game_world()
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    L.focus_game_viewport()
    avatars_dir = unreal.Paths.project_dir() + "ProjectAvatars"
    # STAT UNIT HAS TO BE ON, or FStatUnitData never accumulates and every timing reads a clean 0.00 --
    # which the first version of this then cheerfully called trustworthy, because zero is comfortably below
    # the clamp. A guard that passes on no data is worse than no guard.
    unreal.SystemLibrary.execute_console_command(world, "stat unit")
    yield 1.5
    RESULT["avatars_dir"] = avatars_dir

    # THE RETURN SHAPE IS READ, NOT ASSUMED. A UFUNCTION with a bool return and out-params can arrive in Python
    # as (ret, out...) or as just (out...) depending on how it is exposed, and guessing wrong killed the first
    # run at its very first sample with no error text in the log at all. This records what actually came back.
    RESULT["frame_cost_raw"] = str(H.get_frame_cost_ms())
    RESULT["draw_call_raw"] = str(H.get_draw_call_count())

    def unpack(value, want):
        vals = list(value) if isinstance(value, (list, tuple)) else [value]
        # Drop a leading bool-as-success if one is there, then take the numbers.
        if len(vals) == want + 1:
            return bool(vals[0]), vals[1:]
        return True, vals[:want]

    def sample():
        try:
            ok, t = unpack(H.get_frame_cost_ms(), 4)
            calls_ok, c = unpack(H.get_draw_call_count(), 2)
        except Exception as bad:
            RESULT["sample_error"] = str(bad)[:200]
            return {"ok": False}
        return {"ok": bool(ok), "frame_ms": float(t[0]), "game_ms": float(t[1]),
                "render_ms": float(t[2]), "gpu_ms": float(t[3]),
                "draw_calls": int(c[0]) if calls_ok else -1,
                "primitives": int(c[1]) if calls_ok else -1}

    def window(seconds):
        """Mean and worst over a window, from the engine's own unit counters."""
        got = []
        deadline = time.perf_counter() + seconds
        while time.perf_counter() < deadline:
            s = sample()
            if s["ok"]:
                got.append(s)
            yield 0.05
        if not got:
            RESULT["_last"] = {"samples": 0, "trustworthy": False}
            return
        n = float(len(got))
        RESULT["_last"] = {
            "samples": len(got),
            "frame_ms_mean": round(sum(g["frame_ms"] for g in got) / n, 2),
            "frame_ms_worst": round(max(g["frame_ms"] for g in got), 2),
            "game_ms_mean": round(sum(g["game_ms"] for g in got) / n, 2),
            "render_ms_mean": round(sum(g["render_ms"] for g in got) / n, 2),
            "gpu_ms_mean": round(sum(g["gpu_ms"] for g in got) / n, 2),
            "draw_calls": got[-1]["draw_calls"],
            "primitives": got[-1]["primitives"],
        }

    spawned = []

    def count_instances():
        total_components, total_instances = 0, 0
        for a in spawned:
            if a is None:
                continue
            for c in a.get_components_by_class(unreal.InstancedStaticMeshComponent):
                total_components += 1
                total_instances += int(c.get_instance_count())
        return total_components, total_instances

    def spawn(n, stage):
        at = pawn.get_actor_location()
        fwd = pawn.get_actor_forward_vector()
        right = pawn.get_actor_right_vector()
        began = time.perf_counter()
        for i in range(n):
            fam = FAMILIES[i % len(FAMILIES)]
            path = "%s/%s_%s.wlvox" % (avatars_dir, fam, stage)
            where = unreal.Vector(at.x + fwd.x * 1100.0 + right.x * ((i - n * 0.5) * 420.0),
                                  at.y + fwd.y * 1100.0 + right.y * ((i - n * 0.5) * 420.0),
                                  at.z - 88.0)
            body = L.spawn_figure_actor(world, where, path, "%s_%s_%d" % (fam, stage, i))
            if body is not None:
                spawned.append(body)
        return time.perf_counter() - began

    # ---------------------------------------------------------------- THE BASELINE DECIDES IF THIS RUN COUNTS
    for step in window(4.0):
        yield step
    base = RESULT.pop("_last")
    if not base.get("samples"):
        RESULT["status"] = "VOID: the engine reported no frame timings at all"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    RESULT["baseline"] = base
    # VOID ONLY WHEN THE READING IS ACTUALLY MEANINGLESS: no data at all, or frames sitting ON the clamp,
    # where an increase cannot show up because the number cannot go higher. A baseline that is merely SLOW
    # is still a baseline -- the editor's own overhead inflates every absolute here, but it inflates the
    # before and the after equally, so the DELTA is the honest part and is reported as such.
    trustworthy = 0.01 < base["frame_ms_mean"] and base["frame_ms_worst"] < CLAMP_MS * 0.9
    RESULT["baseline_is_trustworthy"] = trustworthy
    RESULT["clamp_ms"] = CLAMP_MS
    if not trustworthy:
        # SAID PLAINLY RATHER THAN REPORTED ANYWAY. This is exactly the state the first pass was in.
        if base["frame_ms_mean"] <= 0.01:
            RESULT["status"] = ("VOID: the engine reported 0.00 ms for every thread, which means stat unit was "
                                "not accumulating -- no timing was taken at all, and zero must never be read "
                                "as cheap")
        else:
            RESULT["status"] = ("VOID: the empty baseline is already at %.1f ms worst, near UE's %.0f ms delta "
                                "clamp, so any increase measured from here would be the editor throttling "
                                "rather than the cost of an avatar" % (base["frame_ms_worst"], CLAMP_MS))
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    comps, insts = count_instances()
    rows.append(dict(avatars=0, stage="-", spawn_seconds=0.0, components=comps, instances=insts, **base))
    H.capture_viewport_jpeg(os.path.join(ROOT, "00_baseline.jpg"), 1600, 88)

    # ---------------------------------------------------------------- 1, 5, 10
    for count, stage in ((1, "Large"), (4, "Large"), (5, "Large")):
        took = spawn(count, stage)
        yield 2.5
        for step in window(4.0):
            yield step
        stats = RESULT.pop("_last")
        comps, insts = count_instances()
        total = len(spawned)
        rows.append(dict(avatars=total, stage=stage, added=count,
                         spawn_seconds=round(took, 3),
                         spawn_ms_each=round(took / max(count, 1) * 1000.0, 1),
                         components=comps, instances=insts, **stats))
        H.capture_viewport_jpeg(os.path.join(ROOT, "%02d_avatars.jpg" % total), 1600, 88)

    # A COUNTER THAT NEVER MOVES IS NOT A MEASUREMENT.
    #
    # Measured here: frame/game/render/gpu came back as 202.71 / 333.14 / 121.57 / 44.62 for 0, 1, 5 AND 10
    # avatars -- byte-identical across a load that multiplied the instance count by 318,987. FStatUnitData
    # is only refreshed when the stat overlay itself draws, so sampling it from Python reads one frozen
    # snapshot over and over. Reporting that as "no measurable cost" would be the most flattering lie in
    # this whole file, so the timings are struck out and the counts -- which ARE real -- are kept.
    times = [(r.get("frame_ms_mean"), r.get("game_ms_mean"), r.get("render_ms_mean")) for r in rows]
    RESULT["thread_timings_are_frozen"] = len(set(times)) <= 1 and len(times) > 1
    if RESULT["thread_timings_are_frozen"]:
        for r in rows:
            for k in ("frame_ms_mean", "frame_ms_worst", "game_ms_mean", "render_ms_mean", "gpu_ms_mean"):
                r[k] = "FROZEN - not measured"
        RESULT["timing_note"] = ("FStatUnitData did not advance between loads, so no per-frame cost was "
                                 "captured. Draw calls, instance counts and spawn times below ARE real.")
    RESULT["total_spawned"] = len(spawned)
    if len(rows) > 1:
        last = rows[-1]
        RESULT["cost_per_avatar_ms"] = round(
            (last["frame_ms_mean"] - rows[0]["frame_ms_mean"]) / max(last["avatars"], 1), 3)
        RESULT["instances_per_avatar"] = round(last["instances"] / float(max(last["avatars"], 1)), 1)
    for a in spawned:
        if a is not None:
            a.destroy_actor()
    yield 1.0
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
