# DID THE PSO PRECACHE SETTINGS ACTUALLY TAKE, OR WERE THEY WRITTEN SOMEWHERE THE ENGINE DOES NOT READ?
#
# The settings were added under [/Script/Engine.RendererSettings] and the five-avatar spawn hitch did not move
# at all -- 93.27 ms before, 93.4 ms after. Two explanations fit that equally well: the hypothesis is wrong,
# or the settings never reached the engine.
#
# THEY ARE DIFFERENT MISTAKES AND ONLY ONE OF THEM IS ABOUT AVATARS. That ini section is not a general CVar
# bucket -- it maps to UPROPERTYs on URendererSettings, and a key with no matching property is silently
# ignored. Arbitrary console variables belong in [SystemSettings]. So before drawing any conclusion about
# pipeline state compilation, the values are read back from the engine itself.
#
# This is the same discipline that settled the exposure question and the preview glow: a setting that does not
# move the picture is either the wrong setting or one that is not being read, and asking which costs a minute.
CONCURRENT = True

import unreal

NAMES = ("r.PSOPrecaching", "r.PSOPrecache.Components", "r.PSOPrecache.Resources",
         "r.PSOPrecache.ProxyCreationWhenPSOReady", "r.PSOPrecache.GlobalComputeShaders")


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    seen = {}
    RESULT["cvars"] = seen
    for name in NAMES:
        try:
            seen[name] = int(unreal.SystemLibrary.get_console_variable_int_value(name))
        except Exception as err:                                   # noqa: BLE001
            seen[name] = "?" + str(err)[:70]
    emit("P_CVARS", "INFO", "what the engine actually holds", seen)

    on = [n for n, v in seen.items() if isinstance(v, int) and v > 0]
    tests.append({"id": "P00", "name": "the PSO precache settings reached the engine",
                  "pass": len(on) >= 3,
                  "detail": {"values": seen, "enabled": on,
                             "note": "written into [/Script/Engine.RendererSettings], which maps to "
                                     "URendererSettings properties rather than to console variables. If "
                                     "these read zero the ini keys were ignored and the avatar measurement "
                                     "tested nothing -- the fix has to move to [SystemSettings] before the "
                                     "hypothesis can be judged at all."}})
    RESULT["status"] = "measured"
    yield 0.5
