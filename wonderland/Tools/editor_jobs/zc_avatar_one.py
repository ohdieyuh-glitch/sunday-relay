# WHY DOES ONE PROJECT AVATAR COST THREE TIMES WHAT TEN DO?
#
# THE MEASUREMENT THIS EXISTS TO EXPLAIN, from zc_avatar_ladder at 16:33 with the instrument repeating to
# 1.68 ms across eight reads of an unchanged world:
#
#   0 avatars   22.17 ms
#   1 avatar    92.52 ms ascending, 98.15 ms descending
#   5 avatars   28.27 ms ascending, 34.32 ms descending
#   10 avatars  35.02 ms
#
# Adding four avatars made the frame three times cheaper and removing them made it expensive again. At one
# avatar the render thread median is 98.12 of a 98.15 ms frame, with game at 20.78 and GPU at 20.79, so the
# cost is the render thread alone. At five it is gone.
#
# WHAT IS ALREADY RULED OUT, so this job does not re-test it: a first-time cost (the descending read at the
# end of the run is 98.15, so nothing was amortised), the order of the rungs (same value first and last), the
# particular avatar file (rung 1 spawns files[0], which every later rung also contains), and the camera (never
# moved between rungs).
#
# SO THIS ASKS TWO QUESTIONS AND NOTHING ELSE.
#
#   WHERE IS THE CLIFF? Rungs 1, 2, 3, 4, 5 one at a time. A step between 1 and 2 is a switch -- some path
#   that behaves differently for a single instance. A smooth decline across five is not a switch and kills
#   every "it turns on above one" explanation in a single pass.
#
#   IS IT SHADOWS? At one avatar, with everything else untouched: virtual shadow maps off, then back on, then
#   distance fields off, then back on. Each toggle is read BACK from the cvar before its rung is measured, so
#   a knob that is not recognised voids its own rung instead of publishing the unchanged world as a result.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import os
import sys
import time
import unreal

H = unreal.WonderlandHudTestLibrary
L = unreal.WonderlandUiTestLibrary

AVATARS = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "ProjectAvatars")
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "avatar_one")
RUNGS = (1, 2, 3, 4, 5)
STEADY_S = 8.0
SETTLE_S = 3.0
# Eight identical raw reads across advancing frames means the stat unit overlay stopped drawing, not that the
# world went perfectly steady. RawFrameTime is unsmoothed, so a byte-identical repeat is the overlay.
FROZEN_LIMIT = 8


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    os.makedirs(ROOT, exist_ok=True)
    RESULT["tests"] = []

    def record(tid, name, ok, **detail):
        RESULT["tests"].append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    # ---- THE INSTRUMENT MUST EXIST BEFORE ANYTHING IS MEASURED WITH IT.
    if not hasattr(H, "get_raw_frame_cost_ms") or not hasattr(H, "get_engine_frame_number"):
        RESULT["status"] = "VOID: this editor predates the raw frame instrument"
        record("O00", "the editor exports the raw frame instrument", False)
        return
    record("O00", "the editor exports the raw frame instrument", True)

    if ues.get_game_world() is None:
        les.editor_play_simulate()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    world = ues.get_game_world()
    L.focus_game_viewport()
    unreal.SystemLibrary.execute_console_command(world, "stat unit")
    yield 10.0

    def read_frame():
        """One row per engine frame, raw, refusing a frozen stat. See FROZEN_LIMIT."""
        try:
            now = int(H.get_engine_frame_number())
        except Exception:                                           # noqa: BLE001
            now = None
        if now is not None and now == globals().get("_LF"):
            return None
        try:
            avg = H.get_frame_cost_ms()
            raw = H.get_raw_frame_cost_ms()
        except Exception:                                          # noqa: BLE001
            return None
        if avg is None or raw is None or float(avg[0]) <= 0.01:
            return None
        if float(raw[0]) == globals().get("_LR"):
            globals()["_FZ"] = globals().get("_FZ", 0) + 1
            globals()["_LF"] = now
            if globals()["_FZ"] >= FROZEN_LIMIT:
                RESULT["stat_froze"] = RESULT.get("stat_froze", 0) + 1
                return None
        else:
            globals()["_FZ"] = 0
        globals()["_LR"] = float(raw[0])
        globals()["_LF"] = now
        return (float(avg[0]), float(avg[1]), float(avg[2]), float(avg[3]),
                float(raw[0]), float(raw[1]), float(raw[3]))

    def stats(rows):
        clean = [r for r in rows if r[0] > 0.01]
        if not clean:
            return None

        def at(p, i):
            col = sorted(v[i] for v in clean if len(v) > i)
            return round(col[min(len(col) - 1, int(len(col) * p))], 2) if col else None
        return {"frames": len(clean),
                "frame_median": at(0.5, 0), "raw_p95": at(0.95, 4), "raw_worst": at(0.999, 4),
                # THE THREE THREADS SEPARATELY, because the whole finding is that ONE of them carries it.
                "game_median": at(0.5, 1), "render_median": at(0.5, 2), "gpu_median": at(0.5, 3)}

    def watch(seconds):
        seen = []
        started = time.time()
        ticks = 0
        while time.time() - started < seconds:
            row = read_frame()
            if row is not None:
                seen.append(row)
            ticks += 1
            if ticks % 30 == 0:
                unreal.SystemLibrary.execute_console_command(world, "stat unit")
            yield 0.0
        globals()["_SEEN"] = seen

    def measure(label):
        yield SETTLE_S
        yield from watch(STEADY_S)
        got = stats(globals().get("_SEEN", []))
        RESULT.setdefault("readings", {})[label] = got
        emit(label, "INFO", label, got)

    files = []
    try:
        for name in sorted(os.listdir(AVATARS)):
            if name.lower().endswith(".wlvox"):
                files.append(os.path.join(AVATARS, name))
    except Exception as err:                                        # noqa: BLE001
        RESULT["avatars_error"] = str(err)[:160]
    RESULT["avatar_files"] = len(files)
    if not files:
        record("O01", "there are Project Avatar figures to spawn", False)
        RESULT["status"] = "VOID: no avatar figures"
        return
    record("O01", "there are Project Avatar figures to spawn", True, found=len(files))

    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    base = pawn.get_actor_location()

    # ---- QUESTION ONE: WHERE IS THE CLIFF?
    yield from measure("n00")
    standing = []
    for want in RUNGS:
        while len(standing) < want:
            i = len(standing)
            spot = unreal.Vector(base.x + (i % 4) * 420.0 - 630.0,
                                 base.y + (i // 4) * 420.0 - 420.0, base.z)
            body = L.spawn_figure_actor(world, spot, files[i % len(files)],
                                        "WL_OneAvatar_%d" % i)
            if body is not None:
                standing.append(body)
            yield 0.5
        yield from measure("n%02d" % want)

    # ---- QUESTION TWO: IS IT SHADOWS? Back down to one, then toggle.
    for body in standing[1:]:
        try:
            body.destroy_actor()
        except Exception:                                           # noqa: BLE001
            pass
    standing = standing[:1]
    yield 2.0
    yield from measure("n01_again")

    def toggled(label, cvar, value, restore):
        """Set a cvar, READ IT BACK, measure, restore. A knob that did not take voids its own rung."""
        unreal.SystemLibrary.execute_console_command(world, "%s %s" % (cvar, value))
        yield 1.0
        got = None
        try:
            var = unreal.SystemLibrary.get_console_variable_float_value(cvar)
            got = float(var)
        except Exception:                                           # noqa: BLE001
            got = None
        RESULT.setdefault("cvar_readback", {})[label] = {"cvar": cvar, "asked": value, "read": got}
        if got is None or abs(got - float(value)) > 1e-3:
            RESULT.setdefault("readings", {})[label] = None
            record("O_%s" % label, "%s took the value it was given" % cvar, False,
                   asked=value, read=got,
                   note="the rung is VOID rather than reported: an unrecognised cvar leaves the world exactly "
                        "as it was, and publishing that as a toggled measurement is how a knob that does "
                        "nothing gets credited with a result.")
        else:
            record("O_%s" % label, "%s took the value it was given" % cvar, True, asked=value, read=got)
            yield from measure(label)
        unreal.SystemLibrary.execute_console_command(world, "%s %s" % (cvar, restore))
        yield 1.0

    yield from toggled("vsm_off", "r.Shadow.Virtual.Enable", "0", "1")
    yield from toggled("df_off", "r.DistanceFields", "0", "1")

    # ---- AND THE VERDICT, WHICH IS ABOUT SHAPE RATHER THAN A CEILING.
    r = RESULT.get("readings") or {}

    def med(k):
        return (r.get(k) or {}).get("frame_median")

    ladder = {k: med("n%02d" % k) for k in (0,) + RUNGS}
    RESULT["ladder_ms"] = ladder
    one, two = ladder.get(1), ladder.get(2)
    record("O02", "the run reproduced the finding it was built to explain",
           isinstance(one, float) and isinstance(ladder.get(5), float) and one > ladder[5] * 1.5,
           ladder_ms=ladder, one_over_five=(round(one / ladder[5], 2) if one and ladder.get(5) else None),
           note="if one avatar is NOT expensive on this run, nothing below means anything and the 16:33 "
                "reading was a property of that session rather than of avatars.")

    if isinstance(one, float) and isinstance(two, float):
        drop = (one - two) / max(one, 0.01)
        RESULT["cliff"] = {"one": one, "two": two, "fraction_lost_at_two": round(drop, 3),
                           "reading": ("A SWITCH: most of the cost disappears when the second avatar arrives, "
                                       "so something behaves differently for a single instance."
                                       if drop >= 0.4 else
                                       "NOT A SWITCH: the cost declines gradually across the rungs, so no "
                                       "path is turning on above one instance and the explanation is "
                                       "elsewhere.")}
        record("O03", "the cost at one avatar is a switch rather than a gradient",
               drop >= 0.4, **RESULT["cliff"])

    shadows = med("vsm_off")
    again = med("n01_again")
    if isinstance(shadows, float) and isinstance(again, float):
        RESULT["shadow_share"] = {
            "one_avatar": again, "with_vsm_off": shadows,
            "fraction_removed": round((again - shadows) / max(again, 0.01), 3),
            "reading": ("VIRTUAL SHADOW MAPS ARE THE COST" if shadows < again * 0.6 else
                        "shadows are NOT the cost: turning them off left it in place"),
        }
        record("O04", "virtual shadow maps explain the cost at one avatar",
               shadows < again * 0.6, **RESULT["shadow_share"])

    fields = med("df_off")
    if isinstance(fields, float) and isinstance(again, float):
        RESULT["distance_field_share"] = {
            "one_avatar": again, "with_df_off": fields,
            "fraction_removed": round((again - fields) / max(again, 0.01), 3),
            "reading": ("DISTANCE FIELDS ARE THE COST" if fields < again * 0.6 else
                        "distance fields are NOT the cost"),
        }
        record("O05", "distance fields explain the cost at one avatar",
               fields < again * 0.6, **RESULT["distance_field_share"])

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    for body in standing:
        try:
            body.destroy_actor()
        except Exception:                                           # noqa: BLE001
            pass
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
