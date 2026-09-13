# Persistent command channel for a live Unreal Editor session.
#
# Launched once with the editor:  -ExecCmds="py <this file> <channel dir>"
# Then any <channel>/inbox/<name>.py is executed on the game thread. A script may
# define job() as a generator to run across frames:
#   yield 1.5                      wait 1.5 s (wall clock)
#   yield lambda: cond()           wait until cond() is true (120 s timeout -> TimeoutError thrown in)
#   yield (lambda: cond(), 30)     same with an explicit timeout
#   yield None                     next tick
# The script fills RESULT (a dict) and calls emit(...) for log lines. When it ends,
# <channel>/done/<name>.json holds RESULT plus status/log/error.
import io
import json
import os
import sys
import time
import traceback

import unreal

CHANNEL = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "channel")
INBOX = os.path.join(CHANNEL, "inbox")
DONE = os.path.join(CHANNEL, "done")
os.makedirs(INBOX, exist_ok=True)
os.makedirs(DONE, exist_ok=True)

_state = {"last_poll": 0.0, "last_beat": 0.0, "jobs": [], "ticks": 0}


def _write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1, default=str)
    os.replace(tmp, path)


def _stamp():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _finish(job):
    result = job["result"]
    result.setdefault("status", "done")
    result["finished"] = _stamp()
    result["seconds"] = round(time.time() - job["t0"], 2)
    result["log"] = job["log"].getvalue()[-60000:]
    _write_json(os.path.join(DONE, job["name"] + ".json"), result)
    unreal.log("WLCHANNEL finished %s status=%s" % (job["name"], result["status"]))


def _start(path):
    name = os.path.splitext(os.path.basename(path))[0]
    with open(path, encoding="utf-8") as f:
        source = f.read()
    os.remove(path)
    log = io.StringIO()
    result = {"name": name, "started": _stamp(), "status": "running"}

    def emit(*parts):
        line = " ".join(str(p) for p in parts)
        log.write(line + "\n")
        unreal.log("WLJOB[%s] %s" % (name, line))

    job = {"name": name, "result": result, "log": log, "gen": None, "wait_until": 0.0,
           "cond": None, "deadline": None, "t0": time.time()}
    namespace = {"unreal": unreal, "RESULT": result, "emit": emit, "CHANNEL": CHANNEL,
                 "__name__": "__wl_job__", "__file__": path}
    unreal.log("WLCHANNEL start %s" % name)
    try:
        exec(compile(source, path, "exec"), namespace)
        entry = namespace.get("job")
        if callable(entry):
            gen = entry()
            if hasattr(gen, "__next__"):
                job["gen"] = gen
                _state["jobs"].append(job)
                return
    except Exception:
        result["status"] = "error"
        result["error"] = traceback.format_exc()
    _finish(job)


def _schedule(job, yielded, now):
    if yielded is None:
        job["wait_until"] = now
    elif isinstance(yielded, (int, float)):
        job["wait_until"] = now + float(yielded)
    elif callable(yielded):
        job["cond"], job["deadline"] = yielded, now + 120.0
    elif isinstance(yielded, tuple) and yielded and callable(yielded[0]):
        job["cond"], job["deadline"] = yielded[0], now + float(yielded[1] if len(yielded) > 1 else 120.0)
    else:
        job["wait_until"] = now


def _step(job, now):
    if now < job["wait_until"]:
        return False
    thrown = None
    if job["cond"] is not None:
        try:
            ready = bool(job["cond"]())
        except Exception:
            ready = False
        if not ready:
            if job["deadline"] is not None and now > job["deadline"]:
                thrown = TimeoutError("waited condition timed out")
            else:
                return False
        job["cond"], job["deadline"] = None, None
    try:
        yielded = job["gen"].throw(thrown) if thrown is not None else next(job["gen"])
    except StopIteration:
        return True
    except Exception:
        job["result"]["status"] = "error"
        job["result"]["error"] = traceback.format_exc()
        return True
    _schedule(job, yielded, now)
    return False


def _tick(delta_seconds):
    # RE-ENTRANCY GUARD: a job that saves, loads or opens a dialog pumps Slate, and Slate
    # runs this callback again while that job's generator is still executing.
    if _state.get("in_tick"):
        return
    _state["in_tick"] = True
    try:
        _tick_body()
    finally:
        _state["in_tick"] = False


def _tick_body():
    try:
        now = time.time()
        _state["ticks"] += 1
        if now - _state["last_poll"] > 0.25:
            _state["last_poll"] = now
            for entry in sorted(os.listdir(INBOX)):
                if entry.endswith(".py"):
                    _start(os.path.join(INBOX, entry))
        for job in list(_state["jobs"]):
            if _step(job, now):
                _state["jobs"].remove(job)
                _finish(job)
        if now - _state["last_beat"] > 2.0:
            _state["last_beat"] = now
            _write_json(os.path.join(CHANNEL, "heartbeat.json"),
                        {"time": _stamp(), "ticks": _state["ticks"], "jobs": [j["name"] for j in _state["jobs"]]})
    except Exception:
        unreal.log_error("WLCHANNEL tick error: " + traceback.format_exc())


unreal.SystemLibrary.execute_console_command(None, "Slate.bAllowThrottling 0")
_handle = unreal.register_slate_post_tick_callback(_tick)
unreal.log("WLCHANNEL listening on " + INBOX)
