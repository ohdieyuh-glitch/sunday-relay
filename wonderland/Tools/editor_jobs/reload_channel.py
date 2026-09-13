# Editor job: replace the running channel listener with the current wonderland/Tools/editor_channel.py,
# on the same channel directory, without restarting the editor (the founder may be using it).
# The old listener runs this job; the new one is registered before the old one is unregistered, and
# the old one still writes this job's result when the job returns.
import gc
import runpy
import sys

REPO_CHANNEL = globals().get("REPO_CHANNEL", "C:/dev/iwonder/wonderland-task3/wonderland/Tools/editor_channel.py")

old = [(d["CHANNEL"], d["_handle"]) for d in gc.get_objects()
       if isinstance(d, dict) and "_handle" in d and "CHANNEL" in d and "_tick" in d]
argv = sys.argv
sys.argv = ["editor_channel.py", CHANNEL]
try:
    fresh = runpy.run_path(REPO_CHANNEL, run_name="__wl_channel_reloaded__")
finally:
    sys.argv = argv
import builtins
builtins._WL_CHANNEL_RELOADED = fresh
retired = []
for path, handle in old:
    if handle != fresh["_handle"]:
        unreal.unregister_slate_post_tick_callback(handle)
        retired.append(path)
RESULT.update({"new_channel": fresh["CHANNEL"], "retired_listeners": retired, "status": "done"})
