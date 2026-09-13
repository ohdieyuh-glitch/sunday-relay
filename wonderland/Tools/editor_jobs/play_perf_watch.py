# Editor job, READ-ONLY and CONCURRENT: watch the frame rate of whoever is playing, on this machine, as they play.
#
# Private-beta gate item 10 is "performance is acceptable on the founder's laptop". A scripted PIE run cannot
# measure that: behind another window the editor throttles PIE, and that throttle is not reachable from Python.
# A founder playing holds the foreground, so their own session is the honest measurement. This job installs a
# light tick callback and returns at once (it does not hold the channel): whenever a PIE world exists it appends
# one sample every INTERVAL seconds to OUT -- frames per second over the interval, where the player stands,
# whether the editor held the foreground -- and nothing else. It reads; it never moves, pauses or ends anything.
# It stops at DEADLINE_HOURS, or when a file named STOP exists next to OUT. Re-queueing replaces the running watch.
# Globals: OUT (jsonl path), INTERVAL, DEADLINE_HOURS.
import builtins
import json
import os
import time

CONCURRENT = True
OUT = globals().get("OUT", os.path.join(os.path.dirname(CHANNEL), "perf_watch.jsonl"))
INTERVAL = globals().get("INTERVAL", 2.0)
DEADLINE_HOURS = globals().get("DEADLINE_HOURS", 8.0)
STOP = OUT + ".stop"


def _editor_foreground():
    try:
        import ctypes
        user32 = ctypes.windll.user32
        pid = ctypes.c_ulong(0)
        user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), ctypes.byref(pid))
        return pid.value == os.getpid()
    except Exception:
        return None


def job():
    old = getattr(builtins, "_wl_play_perf_watch", None)
    if old is not None:
        unreal.unregister_slate_post_tick_callback(old)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    state = {"t0": None, "f0": 0, "session": None, "deadline": time.time() + DEADLINE_HOURS * 3600.0, "samples": 0}

    def tick(_dt):
        now = time.time()
        if state["t0"] is not None and now - state["t0"] < INTERVAL:
            return
        if now > state["deadline"] or os.path.exists(STOP):
            unreal.unregister_slate_post_tick_callback(builtins._wl_play_perf_watch)
            builtins._wl_play_perf_watch = None
            return
        world = ues.get_game_world()
        frames = unreal.SystemLibrary.get_frame_count()
        if world is None:
            state["t0"], state["session"] = None, None
            return
        if state["t0"] is None or state["session"] != world.get_name():
            state["t0"], state["f0"], state["session"] = now, frames, world.get_name()
            return
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        loc = pawn.get_actor_location() if pawn else None
        row = {"t": time.strftime("%H:%M:%S"), "session": state["session"],
               "fps": round((frames - state["f0"]) / (now - state["t0"]), 1),
               "foreground": _editor_foreground(), "at": None if loc is None else [round(loc.x), round(loc.y), round(loc.z)]}
        with open(OUT, "a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
        state["t0"], state["f0"] = now, frames
        state["samples"] += 1

    builtins._wl_play_perf_watch = unreal.register_slate_post_tick_callback(tick)
    RESULT.update({"watching": True, "out": OUT, "stop_file": STOP, "status": "done"})
    yield None
