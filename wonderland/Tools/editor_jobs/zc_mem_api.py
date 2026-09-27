# WHICH MEMORY READING CAN THIS EDITOR ACTUALLY GIVE PYTHON?
#
# The footprint probe refused to run because unreal.SystemLibrary.get_platform_memory_stats does not exist
# here. That refusal was correct -- falling back to an OS-wide reading would have measured every other process
# on the machine and called it an avatar -- but it leaves the question unanswered, and the question is worth
# 840 MB per Project Avatar.
#
# So this asks the engine what it has rather than guessing a second time. Cheap, no PIE, no world.
CONCURRENT = True

import unreal


def job():
    RESULT["status"] = "running"
    found = {}
    RESULT["candidates"] = found

    for name in dir(unreal.SystemLibrary):
        low = name.lower()
        if "memory" in low or "mem_" in low:
            found["SystemLibrary." + name] = "present"
    for mod in ("StatsBlueprintLibrary", "KismetSystemLibrary", "BlueprintPlatformLibrary"):
        try:
            holder = getattr(unreal, mod)
        except Exception:                                          # noqa: BLE001
            continue
        for name in dir(holder):
            if "memory" in name.lower():
                found[mod + "." + name] = "present"

    # And try the ones most likely to work, reporting what they actually return.
    tried = {}
    RESULT["tried"] = tried
    for label, fn in (
            ("SystemLibrary.get_platform_memory_stats",
             lambda: unreal.SystemLibrary.get_platform_memory_stats()),
            ("SystemLibrary.get_memory_stats", lambda: unreal.SystemLibrary.get_memory_stats()),
    ):
        try:
            got = fn()
            tried[label] = str(got)[:200]
        except Exception as err:                                   # noqa: BLE001
            tried[label] = "?" + str(err)[:90]

    emit("A_MEM", "INFO", "memory readings available to Python", {"found": found, "tried": tried})
    RESULT["tests"] = [{"id": "A00", "name": "the engine offers Python a memory reading",
                        "pass": len(found) > 0,
                        "detail": {"candidates": found, "tried": tried}}]
    RESULT["status"] = "measured"
    yield 0.5
