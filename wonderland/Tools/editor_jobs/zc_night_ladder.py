# TWO FIXES LANDED IN ONE BUILD. THIS TELLS THEM APART.
#
# The world lane's NightShadowLift (local exposure, the first of the founder's eleven section A systems to
# have any code behind it) and the practical pool's significance ranking (which stopped 48 slots being spent
# on 1.8 candela wall dabs) were committed within minutes of each other. Compiled together, a single
# after-reading cannot say which moved the number -- or whether one moved it the wrong way and the other
# covered for it.
#
# ONLY ONE OF THEM IS A CVAR, and that is what makes the split possible. wl.Look.NightShadowLift is
# interpolated by Nightfall as Lerp(1.0, lift, Nightfall), so at 1.0 it is ARITHMETICALLY a no-op at every
# hour -- the engine default, nothing lifted. The ranking has no switch; it is simply how the pool now sorts.
# So:
#
#   lift 1.0   the ranking change alone, against the committed pre-build reading of the same view
#   1.0 -> 0.5 the lift alone, with the ranking held constant across the ladder
#
# WHAT IT READS AT EACH RUNG, on the same frame, kept apart on purpose:
#   THE GROUND at Tartarus's avenue dip -- the founder's "nearby ground is readable"
#   THE BODY of the default Dog with its own lights excluded -- section D, the reading that cannot be
#            satisfied by making the eyes brighter
#
# AND IT CHECKS THE CVAR TOOK. A console command for a variable this build does not have prints "Command not
# recognized" and changes nothing, which is exactly what the previous build did -- so each rung reads the
# value back and the job fails rather than publishing a ladder of identical numbers.
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import math
import os
import sys
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "night_ladder")
LIFTS = (1.0, 0.85, 0.65, 0.5)
STEP = 2
DARK = 0.14 * 255.0
LIGHT = 0.72 * 255.0
# THE GROUND VIEW, AND WHY IT IS NOT THE AVENUE ANY MORE.
#
# These coordinates were Tartarus's avenue at its shelf transition, derived from the route polyline. They put
# the camera against a crimson wall: the ladder's ground column then read 54.1% dark at lift 0.65 and 91.6% at
# 0.62, a jump the wrong way that no lighting change can produce and that is entirely the camera seeing masonry
# at one rung and not the next. The BODY column was unaffected -- it frames the Dog at its own home -- so the
# body readings from those runs stand and the ground readings do not.
#
# This is the Tartarus checkpoint court, the one viewpoint in this nation that another lane has photographed
# successfully and that the occlusion trace passes. Borrowed beats derived.
AVENUE_EYE = (44000.0, -21500.0, 260.0)
AVENUE_LOOK = (46177.0, -22619.0, 60.0)
#: the committed reading of this view on the PREVIOUS build, TQ05 applied, old ranking, no lift
BEFORE_RANKING = {"luma": 0.0325, "dark_fraction": 0.966}
BODY_BOX = (0.40, 0.22, 0.60, 0.82)


def read(path):
    sys.path.insert(0, os.path.dirname(CHANNEL))
    from occupancy import read_png                                  # noqa: WPS433
    return read_png(path)


def ground_stats(path):
    w, h, chan, px = read(path)
    vals, ground = [], []
    for y in range(0, h, STEP):
        row = y * w * chan
        for x in range(0, w, STEP):
            i = row + x * chan
            lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
            vals.append(lum)
            if y >= int(h * 0.66):
                ground.append(lum)
    f = lambda v: round(sum(1 for q in v if q < DARK) / float(max(len(v), 1)), 4)
    m = lambda v: round(sum(v) / float(max(len(v), 1)) / 255.0, 4)
    return {"luma": m(vals), "dark_fraction": f(vals), "ground_luma": m(ground), "ground_dark_fraction": f(ground)}


def body_stats(path):
    w, h, chan, px = read(path)
    x0, y0, x1, y1 = (int(BODY_BOX[0] * w), int(BODY_BOX[1] * h), int(BODY_BOX[2] * w), int(BODY_BOX[3] * h))
    body, lights, seen = [], 0, 0
    for y in range(y0, min(y1, h), STEP):
        row = y * w * chan
        for x in range(x0, min(x1, w), STEP):
            i = row + x * chan
            lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
            seen += 1
            if lum >= LIGHT:
                lights += 1
            else:
                body.append(lum)
    return {"body_mean": round(sum(body) / float(max(len(body), 1)) / 255.0, 4),
            "body_dark_fraction": round(sum(1 for v in body if v < DARK) / float(max(len(body), 1)), 4),
            "light_fraction": round(lights / float(max(seen, 1)), 4)}


def job():
    os.makedirs(ROOT, exist_ok=True)
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
    yield 8.0
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 23.60")
    yield 4.0
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    home = dog.get_actor_location()
    ui = L.get_ui(world)
    if ui is not None:
        ui.wear_relay_skin("relay_og")
    yield 5.0

    def capture(path):
        """Take the shot and prove it landed: the call returns (w, h) and never throws."""
        if os.path.exists(path):
            os.remove(path)
        got = L.capture_game_viewport(path)
        if not (got[0] if isinstance(got, (tuple, list)) else got) or not os.path.exists(path):
            raise RuntimeError("capture_game_viewport returned %s" % (got,))

    avenue, body = {}, {}
    RESULT["avenue"] = avenue
    RESULT["body"] = body
    RESULT["lift_readback"] = {}
    for lift in LIFTS:
        unreal.SystemLibrary.execute_console_command(world, "wl.Look.NightShadowLift %.2f" % lift)
        yield 1.0
        # ---- DID IT TAKE? An unknown cvar prints "Command not recognized" and changes nothing.
        try:
            var = unreal.SystemLibrary.get_console_variable_float_value("wl.Look.NightShadowLift")
        except Exception:                                           # noqa: BLE001
            var = None
        RESULT["lift_readback"]["%.2f" % lift] = var
        yield 2.0

        # ---- WHAT THIS RUNG COSTS, not only what it looks like.
        #
        # Local exposure is a bilateral decomposition and it runs on the RENDER THREAD. Enabled unconditionally
        # it put an empty world at 389.5 ms with five per cent of the frame accounted for; it is now off by day
        # and ON AT NIGHT, which is exactly where the founder needs it. So the night we are buying has a price
        # nobody has read, and "sane performance" is in their brief. stat unit has to be re-issued to keep
        # FStatUnitData advancing, and the whole tuple is taken because a frame time alone cannot be
        # contradicted -- see zc_nav_cost, which published 1030 ms from element zero of this same call.
        unreal.SystemLibrary.execute_console_command(world, "stat unit")
        yield 3.0
        rows = []
        for _ in range(40):
            try:
                got = unreal.WonderlandHudTestLibrary.get_frame_cost_ms()
                if got is not None and float(got[0]) > 0.01:
                    rows.append((float(got[0]), float(got[1]), float(got[2]), float(got[3])))
            except Exception:                                       # noqa: BLE001
                pass
            yield 0.1
        if rows:
            rows.sort()
            mid = lambda i: round(sorted(r[i] for r in rows)[len(rows) // 2], 2)
            busiest = max(mid(1), mid(2), mid(3))
            RESULT.setdefault("cost", {})["%.2f" % lift] = {
                "frame_median": mid(0), "game_median": mid(1), "render_median": mid(2), "gpu_median": mid(3),
                "accounted_fraction": round(busiest / max(mid(0), 0.01), 3), "samples": len(rows)}

        live = ues.get_game_world()
        pawn = unreal.GameplayStatics.get_player_pawn(live, 0) if live is not None else None
        if live is None or pawn is None:
            record("L_DEAD_%.2f" % lift, "the world was alive at lift %.2f" % lift, False)
            continue

        # ---- THE GROUND, at Tartarus's avenue dip.
        pawn.set_actor_location(unreal.Vector(AVENUE_LOOK[0], AVENUE_LOOK[1], AVENUE_LOOK[2] + 120.0), False, True)
        for _ in range(30):
            if unreal.SystemLibrary.line_trace_single(
                    live, unreal.Vector(AVENUE_LOOK[0], AVENUE_LOOK[1], AVENUE_LOOK[2] + 900.0),
                    unreal.Vector(AVENUE_LOOK[0], AVENUE_LOOK[1], AVENUE_LOOK[2] - 1500.0),
                    unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [], unreal.DrawDebugTrace.NONE, True) is not None:
                break
            yield 1.0
        yield 1.5
        L.pose_camera(live, unreal.Vector(*AVENUE_EYE), unreal.Vector(*AVENUE_LOOK), 70.0)
        yield 1.5
        unreal.GameplayStatics.set_game_paused(live, True)
        yield 0.3
        path = os.path.join(ROOT, "avenue_lift_%.2f.png" % lift)
        try:
            capture(path)
            avenue["%.2f" % lift] = ground_stats(path)
            emit("L_AV_%.2f" % lift, "INFO", "avenue at lift %.2f" % lift, avenue["%.2f" % lift])
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})["avenue %.2f" % lift] = str(err)[:130]
        unreal.GameplayStatics.set_game_paused(live, False)
        L.release_camera(live)
        yield 0.5

        # ---- THE BODY, back at the Dog's own place, framed exactly as zc_night_bodies frames it.
        pawn.set_actor_location(home, False, True)
        yield 3.0
        yaw = pawn.get_actor_rotation().yaw
        eye = unreal.Vector(home.x + math.cos(math.radians(yaw)) * 520.0,
                            home.y + math.sin(math.radians(yaw)) * 520.0, home.z + 110.0)
        L.pose_camera(live, eye, unreal.Vector(home.x, home.y, home.z + 60.0), 45.0)
        yield 1.5
        unreal.GameplayStatics.set_game_paused(live, True)
        yield 0.3
        path = os.path.join(ROOT, "body_lift_%.2f.png" % lift)
        try:
            capture(path)
            body["%.2f" % lift] = body_stats(path)
            emit("L_BODY_%.2f" % lift, "INFO", "relay_og body at lift %.2f" % lift, body["%.2f" % lift])
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})["body %.2f" % lift] = str(err)[:130]
        unreal.GameplayStatics.set_game_paused(live, False)
        L.release_camera(live)
        yield 0.5

    unreal.SystemLibrary.execute_console_command(world, "wl.Look.NightShadowLift 0.65")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.00")

    took = RESULT["lift_readback"]
    record("L00", "the build HAS wl.Look.NightShadowLift and each rung took",
           all(isinstance(v, float) and abs(v - float(k)) < 0.01 for k, v in took.items()) and len(took) == len(LIFTS),
           readback=took,
           note="an unknown cvar prints 'Command not recognized' and silently leaves the ladder flat")

    base = avenue.get("1.00")
    record("L01", "THE RANKING ALONE: the avenue at lift 1.0, against the same view before the pool change",
           base is not None, at_lift_1=base, previous_build=BEFORE_RANKING,
           note="lift 1.0 is arithmetically a no-op, so any difference here is the significance ranking. "
                "The previous build's reading was taken with TQ05 applied and the old distance-only pool.")

    record("L02", "THE LIFT ALONE: the avenue ground across the ladder, ranking held constant",
           len(avenue) == len(LIFTS), per_lift={k: v.get("ground_dark_fraction") for k, v in avenue.items()},
           luma={k: v.get("ground_luma") for k, v in avenue.items()})

    record("L03", "and the Dog's BODY across the same ladder",
           len(body) == len(LIFTS), body_dark={k: v.get("body_dark_fraction") for k, v in body.items()},
           body_mean={k: v.get("body_mean") for k, v in body.items()},
           light_fraction={k: v.get("light_fraction") for k, v in body.items()},
           note="the figure's own lights are excluded from body_mean; light_fraction is reported beside it "
                "so a brighter body can never be a brighter pair of eyes.")

    record("L04", "the night this buys has its render cost recorded, not assumed",
           len(RESULT.get("cost", {})) == len(LIFTS), cost=RESULT.get("cost"),
           note="local exposure is a render-thread pass and is ON at night at every one of these rungs. A "
                "frame here that game and GPU do not account for is the pass, and the founder's night is "
                "being bought with it.")
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
