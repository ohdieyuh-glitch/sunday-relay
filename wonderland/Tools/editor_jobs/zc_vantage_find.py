# FIND A CAMERA THAT IS ACTUALLY LOOKING AT THE WORLD. The instrument fix, before any more lighting.
#
# WHAT WENT WRONG. zc_dusk_shape ran 32 readings from a camera INSIDE A BUSH and every gate that was
# supposed to catch that passed. The frames are foliage edge to edge -- no ground, no sky, no
# architecture -- at every rung including the 23:00 "approved night" reference. So the whole run
# measured the inside of a shrub and reported it as the Golden Arrival.
#
# WHY D_VALID PASSED. It proved three things, all true and none sufficient:
#   - the pawn was within 500 uu of the asked spot            (it was)
#   - a forward trace found nothing within 400 uu             (on the PAWN channel)
#   - a downward trace and a ground-patch trace both hit      (ground exists below)
# Foliage has no pawn collision, so the forward trace went straight through the leaves and reported
# clear. The gate tested exactly what it said and was blind to the only thing that mattered. The
# founder's warning was "do not infer world behaviour from a camera embedded in lit geometry"; I
# proved the point valid by trace and it was embedded in geometry the trace cannot see.
#
# It is also the predictable failure: vegetation is 89 per cent of this world's triangles. A camera
# placed without asking about foliage is more likely inside a plant than not.
#
# THE SECOND MISTAKE, which is why the camera was up there at all. The spot was "proven" for the
# PAWN's standing position in an earlier job, and the camera sits 900 uu ABOVE the pawn looking 1400
# uu ahead. A pawn standing on open paving says nothing about what is nine metres above its head.
# Proving a standing position is not proving a viewpoint.
#
# WHAT THIS JOB DOES. Searches spots and yaws for a viewpoint where the ground patch is genuinely
# open, judged three ways that fail independently:
#
#   1. A VISIBILITY trace from the eye to the ground target (TRACE_TYPE_QUERY1, which foliage does
#      block) must reach nearly all the way. Something at 50 uu in front of the lens is an occluder
#      however little the pawn channel cares about it.
#   2. The ground patch must not be GREEN-DOMINATED. Leaves read green; paving reads neutral. This
#      catches an occluder the trace misses, and the trace catches one the colour misses -- a canopy
#      lit to grey at night would fool the colour test alone.
#   3. The sky band must actually contain sky, because a viewpoint with no sky in it is under
#      something, and "under something" is the whole failure being fixed.
#
# AND THEN IT LOOKS. Every candidate is captured, because the two gates above are exactly the kind of
# proxy that passed last time, and the only thing that would have caught this run in five seconds was
# opening one JPEG.
#
# The camera also comes DOWN to player eye height. The founder's requirement is that "the player must
# be able to SEE AND TRAVERSE the ground" -- that is a statement about what a player sees walking,
# not about a nine-metre crane shot, and the crane shot is what put the lens in the canopy.
#
# Changes no lighting and turns no dusk knob. Noon throughout, for visibility. Saves nothing.
import math
import os

CONCURRENT = False

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "vantage")

#: Candidates around the Golden Arrival. The first is the spot zc_dusk_shape used, kept so the
#: failure is reproduced and named rather than quietly abandoned.
SPOTS = ((-64.0, -5042.0), (-64.0, -4400.0), (600.0, -5042.0), (-700.0, -5042.0), (-64.0, -5700.0))
YAWS = (0.0, 45.0, 90.0, 135.0, 180.0, 225.0, 270.0, 315.0)

EYE_UP = 160.0          # player eye height above the pawn's origin, not a crane
LOOK_AHEAD = 900.0      # where on the ground the player is looking
LOOK_DROP = -250.0

GROUND_RECT = (0.5, 0.74, 0.28, 0.16)
SKY_RECT = (0.5, 0.16, 0.30, 0.10)
FOV = 70.0
PAWN_CH = unreal.TraceTypeQuery.TRACE_TYPE_QUERY1     # visibility: foliage blocks this one
CLEAR_FRACTION = 0.90   # the view must reach 90% of the way to the ground target
GREEN_MAX = 1.25        # g / mean(r,b) above this reads as leaves rather than paving


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests
    os.makedirs(ROOT, exist_ok=True)

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

    def live():
        return ues.get_game_world()

    def command(text):
        unreal.SystemLibrary.execute_console_command(live(), text)

    def rect(r):
        cx, cy, hw, hh = r
        got = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
        if got is None:
            return None
        mean, dark, bright, sampled = got
        r_, g_, b_ = float(mean.r), float(mean.g), float(mean.b)
        # GREEN DOMINANCE. Leaves put most of their energy in g; paving, stone and sky do not.
        green = g_ / max((r_ + b_) / 2.0, 1e-5)
        return {"luma": round(0.2126 * r_ + 0.7152 * g_ + 0.0722 * b_, 4),
                "rgb": [round(r_, 4), round(g_, 4), round(b_, 4)],
                "green_ratio": round(green, 3),
                "crushed": round(float(dark), 4), "blown": round(float(bright), 4),
                "readable": round(max(0.0, 1.0 - float(dark) - float(bright)), 4)}

    def trace(a, b, ignore, channel):
        try:
            hit = unreal.SystemLibrary.line_trace_single(
                live(), a, b, channel, False, [p for p in (ignore,) if p is not None],
                unreal.DrawDebugTrace.NONE, True,
                unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            if hit is None:
                return None
            t = hit.to_tuple()
            return {"dist": round(float(t[3]), 1), "z": round(float(t[4].z), 1)}
        except Exception:                                              # noqa: BLE001
            return None

    L.focus_game_viewport()
    command("wl.Sky.DayMinutes 0")
    command("wl.Sky.Hour 12")
    yield 2.0

    rows = []
    RESULT["candidates"] = rows

    for si, spot in enumerate(SPOTS):
        pawn = unreal.GameplayStatics.get_player_pawn(live(), 0)
        if pawn is None:
            continue
        down = trace(unreal.Vector(spot[0], spot[1], 20000.0),
                     unreal.Vector(spot[0], spot[1], -5000.0), pawn, PAWN_CH)
        gz = down["z"] if down else None
        pawn.set_actor_location(
            unreal.Vector(spot[0], spot[1], (gz + 120.0) if gz is not None else 200.0), False, True)
        command("FlushLevelStreaming")
        yield 2.5
        pawn = unreal.GameplayStatics.get_player_pawn(live(), 0)
        if pawn is None:
            continue
        where = pawn.get_actor_location()
        offset = round(math.hypot(where.x - spot[0], where.y - spot[1]), 1)

        for yaw in YAWS:
            rad = math.radians(yaw)
            eye = unreal.Vector(where.x, where.y, where.z + EYE_UP)
            tgt = unreal.Vector(where.x + math.cos(rad) * LOOK_AHEAD,
                                where.y + math.sin(rad) * LOOK_AHEAD,
                                where.z + LOOK_DROP)
            L.pose_camera(live(), eye, tgt, FOV)
            yield 0.7

            want = math.sqrt((tgt.x - eye.x) ** 2 + (tgt.y - eye.y) ** 2 + (tgt.z - eye.z) ** 2)
            seen = trace(eye, tgt, pawn, PAWN_CH)
            reach = (seen["dist"] / want) if (seen and want > 1.0) else None
            # No hit at all means nothing between the lens and the target: fully clear.
            if seen is None:
                reach = 1.0
            g = rect(GROUND_RECT)
            s = rect(SKY_RECT)
            key = "s%d_y%03d" % (si, int(yaw))
            try:
                H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % key), 1100, 82)
            except Exception:                                          # noqa: BLE001
                pass
            if not (g and s):
                rows.append({"key": key, "spot": list(spot), "yaw": yaw, "unmeasured": True})
                continue
            clear = reach is not None and reach >= CLEAR_FRACTION
            open_ground = g["green_ratio"] <= GREEN_MAX
            has_sky = s["green_ratio"] <= GREEN_MAX and s["luma"] > g["luma"]
            rows.append({
                "key": key, "spot": list(spot), "yaw": yaw, "pawn_offset_uu": offset,
                "eye_z": round(eye.z, 1), "ground_z": gz,
                "view_reach": (round(reach, 3) if reach is not None else None),
                "first_hit_uu": (seen["dist"] if seen else None), "target_uu": round(want, 1),
                "ground": g, "sky": s,
                "view_clear": clear, "ground_not_foliage": open_ground, "sky_visible": has_sky,
                "usable": bool(clear and open_ground and has_sky)})

    command("wl.Sky.Hour 12")
    L.release_camera(live())

    good = [r for r in rows if not r.get("unmeasured")]
    record("V_MEASURED", "every candidate viewpoint produced a reading",
           len(good) == len(SPOTS) * len(YAWS), population=len(good),
           wanted=len(SPOTS) * len(YAWS))

    # ---- THE FAILURE THIS JOB EXISTS FOR, REPRODUCED AND NAMED.
    #
    # If the old spot now reads clear at every yaw, the bush is not where I think it is and the
    # diagnosis is wrong -- so this asserts the fault is still there rather than assuming it.
    old = [r for r in good if r["spot"] == [-64.0, -5042.0]]
    blocked_old = [r for r in old if not r["usable"]]
    record("V_REPRO", "the viewpoint zc_dusk_shape used is demonstrably obstructed, so the void is "
                      "diagnosed and not guessed",
           len(old) > 0 and len(blocked_old) > 0, population=len(old),
           obstructed_yaws=[r["yaw"] for r in blocked_old],
           green_ratio_by_yaw={("%03d" % r["yaw"]): r["ground"]["green_ratio"] for r in old},
           view_reach_by_yaw={("%03d" % r["yaw"]): r["view_reach"] for r in old},
           note="green_ratio near or above %.2f is leaves. The dusk run's camera was higher still "
                "(900 uu rather than %.0f), so this understates how buried it was" % (GREEN_MAX, EYE_UP))

    usable = [r for r in good if r["usable"]]
    # THE BEST ONE IS THE MOST OPEN ONE, not the brightest. Ranking by luma would pick whatever the
    # sun happens to be facing and is exactly the kind of proxy that caused this.
    usable.sort(key=lambda r: (-r["view_reach"], r["ground"]["green_ratio"]))
    RESULT["usable"] = usable[:8]
    RESULT["chosen"] = usable[0] if usable else None
    record("V_FOUND", "at least one viewpoint is open ground with sky above and a clear line of sight",
           len(usable) > 0, population=len(good), usable_count=len(usable),
           chosen=RESULT["chosen"],
           thresholds={"view_reach_at_least": CLEAR_FRACTION, "green_ratio_at_most": GREEN_MAX},
           note="RED means no candidate around the Golden Arrival is open enough to measure ground "
                "lighting from, which would itself be the finding -- 89 per cent of this world's "
                "triangles are vegetation and the arrival may simply be overgrown")

    RESULT["captures"] = ROOT
    RESULT["must_look"] = ("Every candidate is captured in %s as sN_yNNN.jpg. The two gates above are "
                           "proxies of exactly the kind that passed the run this job exists to "
                           "replace; the JPEG is the evidence." % ROOT)
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
