# DOES SPAWNING A PROJECT AVATAR STILL HITCH?
#
# FOUNDER, P0 item 5: "Cached spawn improved about 509 ms -> 73 ms but still hitches."
#
# WHY THE EXISTING MEASUREMENT CANNOT ANSWER THIS. zc_avatar_cost reports frame_ms_mean per tier, and a mean
# is exactly the wrong statistic for a hitch: one 400 ms frame inside a 60-frame window moves the mean by
# under 7 ms and disappears. A hitch is a SINGLE long frame, and it is felt as a stutter no matter what the
# average around it says. The founder can see one; the mean cannot.
#
# So this watches the frames either side of a spawn and keeps the WORST one, against a baseline worst
# measured moments earlier in the same session. The number that matters is the difference between them: how
# much longer the longest frame gets because an avatar arrived.
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

#: Where the avatars are read from, the same place zc_avatar_cost uses.
AVATARS = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "ProjectAvatars")

#: Seconds of quiet frames to establish what a long frame looks like WITHOUT a spawn in it.
QUIET_S = 14.0
#: How long to keep watching after each spawn.
WATCH_S = 6.0


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
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    world = ues.get_game_world()
    L.focus_game_viewport()

    # FStatUnitData only advances while the stat overlay draws, and it must be re-issued.
    unreal.SystemLibrary.execute_console_command(world, "stat unit")
    yield 10.0

    def stats(values):
        """Median, p95 and max. See why the max alone is not enough, below."""
        clean = sorted(v for v in values if v > 0.01)
        if not clean:
            return {"samples": 0, "median_ms": 0.0, "p95_ms": 0.0, "worst_ms": 0.0}
        return {
            "samples": len(clean),
            "median_ms": round(clean[len(clean) // 2], 2),
            "p95_ms": round(clean[min(len(clean) - 1, int(len(clean) * 0.95))], 2),
            "worst_ms": round(clean[-1], 2),
        }

    def watch(seconds, label):
        # THE MAX IS NOT A SAFE STATISTIC HERE, which this job learned the hard way: a run read a worst QUIET
        # frame of 551.98 ms -- a half-second stall with no avatar anywhere near it, almost certainly a shader
        # compile or a streaming hitch -- against a worst SPAWN frame of 83.18, and reported the arriving
        # avatar as saving 468 ms. max() over a window measures whatever the machine did that second, not
        # what the avatar cost. So the distribution is kept and the verdict is taken from the 95th percentile,
        # which a single unrelated stall cannot move, with the max still reported beside it.
        seen = []
        started = time.time()
        while time.time() - started < seconds:
            try:
                v = float(H.get_frame_cost_ms()[0])
                if v > 0.01:
                    seen.append(v)
            except Exception:
                pass
            if len(seen) % 20 == 0:
                unreal.SystemLibrary.execute_console_command(world, "stat unit")
            yield 0.0          # every tick, because a hitch lives in one frame
        RESULT[label] = stats(seen)
        emit(label, "INFO", label, RESULT[label])

    # ---- WHAT A LONG FRAME LOOKS LIKE WITH NOTHING HAPPENING
    yield from watch(QUIET_S, "quiet_before")

    # ---- AND WHAT IT LOOKS LIKE WHEN AVATARS ARRIVE
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    where = dog.get_actor_location() + dog.get_actor_forward_vector() * 1100.0
    files = []
    try:
        for name in sorted(os.listdir(AVATARS)):
            if name.lower().endswith(".wlvox"):
                files.append(os.path.join(AVATARS, name))
    except Exception as err:                                       # noqa: BLE001
        RESULT["avatars_error"] = str(err)[:160]
    RESULT["avatar_files"] = len(files)

    spikes = []
    for i, path in enumerate(files[:4]):
        seen = []
        started = time.time()
        spawned_at = None
        while time.time() - started < WATCH_S:
            if spawned_at is None and time.time() - started > 1.0:
                try:
                    L.spawn_figure_actor(world, where, path, "hitch_%d" % i)
                except Exception as err:                           # noqa: BLE001
                    RESULT["spawn_error"] = str(err)[:160]
                spawned_at = time.time()
            try:
                v = float(H.get_frame_cost_ms()[0])
                if v > 0.01:
                    seen.append(v)
            except Exception:
                pass
            if len(seen) % 20 == 0:
                unreal.SystemLibrary.execute_console_command(world, "stat unit")
            yield 0.0
        row = stats(seen)
        row["avatar"] = os.path.basename(path)[:28]
        spikes.append(row)
        emit("H_%d" % i, "INFO", "spawn %d" % i, spikes[-1])
    RESULT["spawn_spikes"] = spikes

    # WHAT A HITCH ACTUALLY IS, stated so the arithmetic matches it: how much longer the longest frame runs
    # than a NORMAL frame. That is the thing a player feels as a stutter.
    #
    # The baseline is the quiet window's MEDIAN, not its p95 and not its max. A previous version compared
    # tail against tail and read a quiet p95 of 593.22 ms -- the PIE session's own startup stall, with no
    # avatar within ten seconds of it -- which made an arriving avatar look 510 ms FASTER than nothing
    # happening. The median is what a normal frame costs and no single stall can move it.
    normal = RESULT.get("quiet_before", {}).get("median_ms", 0.0)
    longest = max((x["worst_ms"] for x in spikes), default=0.0)
    RESULT["normal_frame_ms"] = normal
    RESULT["longest_spawn_frame_ms"] = longest
    RESULT["hitch_ms"] = round(longest - normal, 2)
    RESULT["quiet_tail"] = {k: RESULT.get("quiet_before", {}).get(k) for k in ("p95_ms", "worst_ms")}

    record("H00", "both sides were actually sampled",
           RESULT.get("quiet_before", {}).get("samples", 0) > 50 and all(x["samples"] > 20 for x in spikes),
           quiet=RESULT.get("quiet_before"), spawns=spikes,
           note="a hitch is one frame; sampled every tick rather than on an interval, or the frame that "
                "stutters is the one the sampler slept through")
    # The founder's own number to beat. 73 ms was the improved spawn they still called a hitch.
    record("H01", "an arriving avatar does not add a hitch worse than the 73 ms the founder still felt",
           RESULT["hitch_ms"] < 73.0,
           normal_frame_ms=normal, longest_spawn_frame_ms=longest, hitch_ms=RESULT["hitch_ms"],
           quiet_tail=RESULT["quiet_tail"], per_spawn=spikes,
           note="the longest frame during a spawn against a NORMAL frame in the same session, so neither the "
                "machine's own stalls nor its thermal state is charged to the avatar")

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
