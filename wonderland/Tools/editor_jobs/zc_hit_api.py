# Ask the engine what a trace hit can actually be read with. NO PIE, no captures, about two seconds.
#
# Two filming runs and one ground check were spent on this: `hit.blocking_hit` raises, HitResult.Location
# is protected, and GameplayStatics has no break_hit_result in this build. Rather than guess a fourth
# accessor and spend another PIE session finding out, this enumerates what exists and writes it down.
#
# It starts no play session, so it is safe to run at any free-commit level.
import json


def job():
    def names(obj, want):
        return sorted(n for n in dir(obj) if any(w in n.lower() for w in want))

    found = {
        "HitResult": names(unreal.HitResult, ["loc", "impact", "block", "actor", "distance", "time", "get", "break"]),
        "GameplayStatics.hit": names(unreal.GameplayStatics, ["hit", "break"]),
        "SystemLibrary.trace": names(unreal.SystemLibrary, ["trace", "hit", "break"]),
        "MathLibrary.break": names(unreal.MathLibrary, ["hit", "break"]) if hasattr(unreal, "MathLibrary") else [],
    }
    # Whatever exists on the module itself for pulling a hit apart.
    found["module.break"] = sorted(n for n in dir(unreal) if "breakhit" in n.lower().replace("_", ""))

    for key, value in found.items():
        unreal.log_warning("WLHITAPI %s = %s" % (key, json.dumps(value)))

    RESULT["api"] = found
    emit("H01", "INFO", "what a HitResult can be read with", {k: len(v) for k, v in found.items()})
    RESULT["status"] = "done"
    yield 0.1
