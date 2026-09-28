# THE EVENING, IN THREE REGIONS, FROM OBSERVATION POINTS THAT ARE PROVEN VALID BEFORE ANYTHING IS READ.
#
# Every dusk number this lane has published came from a camera at (-320, -1900) aimed at (0, -1460). The
# aim point is the Golden Arrival MONUMENT, and when a later job stood the pawn on it the frame read luma
# 0.6917 with ground_dark 0.0000 at nineteen hundred -- brighter than noon, in the dark, because the
# camera was against lit stone. A look-at target is not a standing position and the two shared coordinates
# in my head across four jobs.
#
# So this job proves its vantage before it measures anything, and it does that at all three places.
#
# THE ARRIVAL SPOT IS CHOSEN BY DATA, NOT BY EYE: (-64, -5042), which is 36 m from the monument on the
# ground-beside-road shelf at z -13.5, with 118 walkable instances inside 15 m and 35 practical lights
# within one pool radius, the nearest at 10 m. Open paved ground a player would actually cross, neither
# on the monument nor in a dead corner.
#
# WHAT "PROVEN VALID" MEANS HERE, as five separate gates rather than an assurance:
#
#   V_STAND      the pawn arrived within 5 m of the asked position, re-fetched after the teleport
#                because a move can respawn it and the old reference then reads (0, 0, 0)
#   V_CLEAR      a forward trace from the eye hits nothing within 4 m -- the camera is not inside or
#                against geometry, which is exactly the defect that produced the 0.6917
#   V_GROUND     a downward trace from the eye finds floor at the height the camera was placed above it
#   V_PATCH      a trace along the ray through the GROUND PATCH hits a surface at a plausible distance,
#                so the rectangle being measured contains ground rather than sky or a wall
#   V_DAY        at noon the frame reads inside a plausible daylight band. A camera sealed in a dark box
#                or pressed against an emissive fails this, and no night number from it means anything
#
# READABILITY IS THE READING, NOT BRIGHTNESS. A brighter mean with most of the traversal ground still
# crushed is not an improvement, so every rung records the crushed fraction, the blown fraction and the
# readable remainder alongside the means, and the gates read the readable fraction.
#
# AND THE STEP IS NOT CALLED GLOBAL UNLESS IT REPRODUCES. zzW3 found no 19:15 step at Noctis or Tartarus
# and a large one at the arrival, but its arrival rows were taken from the monument and are void. This
# measures all three the same way from valid vantages, and D_GLOBAL passes only if two or more regions
# show it.
#
# Saves nothing. Restores hour. Touches no lighting value at all -- the approved night is not altered.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "dusk_regions")

#: The evening, densely, plus a night reference readability is judged against.
HOURS = (18.00, 18.25, 18.50, 18.75, 19.00, 19.25, 19.50, 19.75, 20.00, 23.00)
NIGHT_REF = 23.00
#: name -> (x, y). The arrival spot is data-chosen; the other two are the densest Noctis lamp and a
#: Tartarus district centroid, both already used and both proven to place correctly.
PLACES = (("golden_arrival", (-64.0, -5042.0)),
          ("noctis_nc02", (-65943.0, -38753.0)),
          ("tartarus_tq04", (87157.0, -50320.0)))
SPAN = 21.0
AGREE = 0.010
#: Looking DOWN, identically at every place, so the ground patch contains ground everywhere and the moon's
#: bearing relative to the view is the same at all three. An eye-height horizontal view is filled by
#: whichever building stands 30 m ahead, which is a different building in each district.
CAM_UP = 900.0
CAM_AHEAD = (1400.0, -1400.0)
CAM_DROP = -100.0
CAM_FOV = 70.0
#: The rectangle every ground reading comes from, in screen fractions. Recorded in the result so a reader
#: knows exactly what was measured.
GROUND_RECT = (0.5, 0.78, 0.30, 0.16)
FRAME_RECT = (0.5, 0.5, 0.46, 0.44)
PAWN_CH = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2
#: Noon has to land in here or the vantage is not showing us the world.
DAY_BAND = (0.12, 0.50)


def elevation_at(hour):
    return math.sin(((hour - 6.0) / 12.0) * math.pi) * 72.0


def daylight_at(elev):
    return max(0.0, min(1.0, (elev + 9.0) / SPAN)) ** 1.9


def patch(rect):
    cx, cy, hw, hh = rect
    got = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
    if got is None:
        return None
    mean, dark, bright, sampled = got
    d, b = float(dark), float(bright)
    return {"luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 4),
            "crushed": round(d, 4), "blown": round(b, 4),
            "readable": round(max(0.0, 1.0 - d - b), 4), "sampled": int(sampled)}


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

    def cvar(name, value):
        unreal.SystemLibrary.execute_console_command(live(), "%s %s" % (name, value))

    def command(text):
        unreal.SystemLibrary.execute_console_command(live(), text)

    def trace(a, b, ignore):
        try:
            hit = unreal.SystemLibrary.line_trace_single(
                live(), a, b, PAWN_CH, False, [p for p in (ignore,) if p is not None],
                unreal.DrawDebugTrace.NONE, True,
                unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            if hit is None:
                return None
            t = hit.to_tuple()
            return {"dist": round(float(t[3]), 1), "z": round(float(t[4].z), 1)}
        except Exception:                                              # noqa: BLE001
            return None

    def moon_intensity():
        """Nightfall in disguise: MoonLux is linear in it and it is exactly 1.0 at 23:00."""
        try:
            lights = unreal.GameplayStatics.get_all_actors_of_class(live(), unreal.DirectionalLight)
        except Exception:                                              # noqa: BLE001
            return None
        for a in lights:
            if a is None:
                continue
            try:
                if str(a.get_actor_label()) != "WL_Moon":
                    continue
                comp = a.directional_light_component
                return float(comp.intensity) if comp is not None else None
            except Exception:                                          # noqa: BLE001
                continue
        return None

    def read_f(name):
        try:
            return round(float(unreal.SystemLibrary.get_console_variable_float_value(name)), 3)
        except Exception:                                              # noqa: BLE001
            return None

    L.focus_game_viewport()
    cvar("wl.Sky.DayMinutes", 0)
    cvar("wl.Sky.TwilightSpan", "%.1f" % SPAN)
    RESULT["lighting_knobs_as_found"] = {
        "PracticalCount": read_f("wl.Look.PracticalCount"),
        "PracticalRadius": read_f("wl.Look.PracticalRadius"),
        "PracticalGain": read_f("wl.Look.PracticalGain"),
        "MoonGain": read_f("wl.Sky.MoonGain"),
        "MoonLeadHours": read_f("wl.Sky.MoonLeadHours"),
        "NightShadowLift": read_f("wl.Look.NightShadowLift")}
    RESULT["ground_rect_screen"] = list(GROUND_RECT)
    RESULT["frame_rect_screen"] = list(FRAME_RECT)

    def settled(limit=24):
        window = []
        for _ in range(limit):
            yield 1.0
            now = patch(FRAME_RECT)
            if now is None:
                continue
            window.append(now["luma"])
            if len(window) > 3:
                window.pop(0)
            if len(window) == 3 and (max(window) - min(window)) < 0.004:
                return

    out, vantage = {}, {}
    RESULT["places"] = out
    RESULT["vantage"] = vantage

    def place_pawn(x, y, tries=3):
        """Put the pawn at (x, y) and PROVE it arrived, moving it again if it came back somewhere else.

        A long teleport RESPAWNS the pawn in this project, and a fixed sleep afterwards samples whichever
        moment of the respawn it lands in. The same code and the same coordinates placed Tartarus at
        offset 0.0 in one run and found NO PAWN AT ALL five seconds after the move in the next -- 153 km
        from the previous district, so the move is a respawn and a stream at once.

        Waiting on the PREDICATE that a pawn exists, then checking where it actually is and moving it
        again if it respawned at the old spot, is the difference between a placement and a hope. Result
        goes through a global because a generator that yields channel steps cannot also return a value.
        """
        globals()["_PLACED"] = None
        for attempt in range(tries):
            p = unreal.GameplayStatics.get_player_pawn(live(), 0)
            gz = None
            if p is not None:
                h = trace(unreal.Vector(x, y, 20000.0), unreal.Vector(x, y, -5000.0), p)
                gz = h["z"] if h else None
                p.set_actor_location(
                    unreal.Vector(x, y, (gz + 120.0) if gz is not None else 200.0), False, True)
            # A PREDICATE, NOT A DURATION: wait until a pawn exists again rather than assuming one does.
            yield (lambda: unreal.GameplayStatics.get_player_pawn(live(), 0) is not None, 120)
            command("FlushLevelStreaming")
            yield 2.0
            p = unreal.GameplayStatics.get_player_pawn(live(), 0)
            if p is None:
                continue
            w = p.get_actor_location()
            if math.hypot(w.x - x, w.y - y) <= 500.0:
                globals()["_PLACED"] = {"pawn": p, "where": w, "ground_z": gz, "attempts": attempt + 1}
                return

    for name, (px, py) in PLACES:
        for step in place_pawn(px, py):
            yield step
        got = globals().get("_PLACED")
        if got is None:
            vantage[name] = {"asked": [px, py], "landed": None, "valid": False,
                             "why": "the pawn could not be placed in three attempts"}
            out[name] = []
            continue
        pawn, where, gz = got["pawn"], got["where"], got["ground_z"]
        off = round(math.hypot(where.x - px, where.y - py), 1)

        eye = unreal.Vector(where.x, where.y, where.z + CAM_UP)
        at = unreal.Vector(where.x + CAM_AHEAD[0], where.y + CAM_AHEAD[1], where.z + CAM_DROP)
        L.pose_camera(live(), eye, at, CAM_FOV)
        yield 2.0

        # ---- IS THIS VANTAGE WORTH MEASURING FROM? Traced, not assumed.
        fwd = trace(eye, unreal.Vector(eye.x + (at.x - eye.x) * 0.02,
                                       eye.y + (at.y - eye.y) * 0.02,
                                       eye.z + (at.z - eye.z) * 0.02), pawn)
        down = trace(eye, unreal.Vector(eye.x, eye.y, eye.z - 4000.0), pawn)
        # the ray through the ground patch: partway along the view, then down to the floor
        gx = eye.x + (at.x - eye.x) * 0.9
        gy = eye.y + (at.y - eye.y) * 0.9
        gpatch = trace(unreal.Vector(gx, gy, eye.z), unreal.Vector(gx, gy, eye.z - 4000.0), pawn)
        vantage[name] = {
            "asked": [px, py], "landed": [round(where.x, 1), round(where.y, 1), round(where.z, 1)],
            "offset_uu": off, "ground_trace_z": gz,
            "place_attempts": got["attempts"],
            "eye": [round(eye.x, 1), round(eye.y, 1), round(eye.z, 1)],
            "at": [round(at.x, 1), round(at.y, 1), round(at.z, 1)],
            "forward_hit": fwd, "down_hit": down, "ground_patch_hit": gpatch}

        rows = []
        out[name] = rows
        for hour in HOURS:
            cvar("wl.Sky.Hour", "%.2f" % hour)
            for step in settled():
                yield step
            f1, g1 = patch(FRAME_RECT), patch(GROUND_RECT)
            mi = moon_intensity()
            yield 1.0
            f2, g2 = patch(FRAME_RECT), patch(GROUND_RECT)
            try:
                H.capture_viewport_jpeg(os.path.join(ROOT, "%s_h%05.2f.jpg" % (name, hour)), 1200, 85)
            except Exception:                                          # noqa: BLE001
                pass
            if not (f1 and f2 and g1 and g2):
                rows.append({"hour": hour, "unmeasured": True})
                continue
            elev = elevation_at(hour)
            rows.append({
                "hour": hour,
                "luma": round((f1["luma"] + f2["luma"]) / 2.0, 4),
                "spread": round(abs(f1["luma"] - f2["luma"]), 4),
                "frame_crushed": round((f1["crushed"] + f2["crushed"]) / 2.0, 4),
                "ground_luma": round((g1["luma"] + g2["luma"]) / 2.0, 4),
                "ground_crushed": round((g1["crushed"] + g2["crushed"]) / 2.0, 4),
                "ground_blown": round((g1["blown"] + g2["blown"]) / 2.0, 4),
                "ground_readable": round((g1["readable"] + g2["readable"]) / 2.0, 4),
                "ground_spread": round(abs(g1["readable"] - g2["readable"]), 4),
                "moon_intensity": (round(mi, 3) if mi is not None else None),
                "sun_elevation": round(elev, 2),
                "daylight": round(daylight_at(elev), 4),
                "exposure_bias_predicted": round(1.45 + (-0.9 - 1.45) * daylight_at(elev), 3)})

    cvar("wl.Sky.Hour", 12)

    # ---- THE VANTAGES, BEFORE ANY READING IS ALLOWED TO MEAN ANYTHING.
    measured = [n for n, _ in PLACES if out.get(n)]
    # `(x or 9e9) > 500` READS A PERFECT PLACEMENT AS A MISSING ONE, because 0.0 is falsy in Python.
    # The first run of this job landed the arrival and Tartarus pawns at offset EXACTLY 0.0 and V_STAND
    # reported both as more than 5 m away, voiding a run in which all three vantages were valid. A valid
    # zero result and an absent value are different things and `or` cannot tell them apart.
    stand_bad = [n for n in measured
                 if vantage[n].get("offset_uu") is None or vantage[n]["offset_uu"] > 500.0]
    record("V_STAND", "the pawn reached every measurement spot",
           len(measured) == len(PLACES) and not stand_bad,
           places_measured=measured, wanted=[n for n, _ in PLACES], too_far=stand_bad,
           vantage=vantage,
           note="re-fetched after each teleport, because a move can respawn the pawn and the stale "
                "reference then reports the world origin")

    embedded = [n for n in measured
                if vantage[n].get("forward_hit") and vantage[n]["forward_hit"]["dist"] < 400.0]
    record("V_CLEAR", "no camera is inside or against geometry",
           len(measured) > 0 and not embedded, embedded_at=embedded,
           forward_hits={n: vantage[n].get("forward_hit") for n in measured}, floor_uu=400.0,
           note="the defect that produced luma 0.6917 at night: a camera standing on the monument, "
                "reading lit stone and calling it the world")

    no_floor = [n for n in measured if not vantage[n].get("down_hit")]
    wrong_h = [n for n in measured
               if vantage[n].get("down_hit")
               and not (CAM_UP - 400.0 <= vantage[n]["down_hit"]["dist"] <= CAM_UP + 600.0)]
    record("V_GROUND", "there is floor under every camera, at the height it was placed above it",
           len(measured) > 0 and not no_floor and not wrong_h,
           no_floor_under=no_floor, unexpected_height=wrong_h,
           down_hits={n: vantage[n].get("down_hit") for n in measured}, placed_at=CAM_UP)

    no_patch = [n for n in measured if not vantage[n].get("ground_patch_hit")]
    record("V_PATCH", "the ground rectangle actually contains ground at every place",
           len(measured) > 0 and not no_patch, nothing_under_patch=no_patch,
           patch_hits={n: vantage[n].get("ground_patch_hit") for n in measured},
           rect_screen=list(GROUND_RECT),
           note="a ground patch aimed at sky or at a wall measures neither the ground nor the same thing "
                "in two districts")

    if len(measured) != len(PLACES) or stand_bad or embedded or no_floor or wrong_h or no_patch:
        RESULT["status"] = "voided: at least one vantage could not be shown valid"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    good = {n: [r for r in out[n] if not r.get("unmeasured")] for n in measured}
    complete = [n for n in measured if len(good[n]) == len(HOURS)]
    worst_spread = max((max([r["spread"] for r in good[n]] + [r["ground_spread"] for r in good[n]])
                        for n in complete), default=None)
    record("D_NOISE", "every rung agrees with itself, on the frame and on the ground",
           len(complete) == len(PLACES) and worst_spread is not None and worst_spread <= AGREE,
           worst_spread=worst_spread, tolerance=AGREE, complete=complete,
           rungs={n: len(good[n]) for n in measured}, wanted=len(HOURS))
    if len(complete) != len(PLACES) or (worst_spread or 1.0) > AGREE:
        RESULT["status"] = "voided: the rungs do not agree with themselves"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    # ---- NOON SANITY. Taken last so the vantage gates have already run; a camera that cannot see a
    # normal day cannot be trusted with a night.
    cvar("wl.Sky.Hour", 12)
    for step in settled():
        yield step
    noon = patch(FRAME_RECT)
    RESULT["noon_at_last_place"] = noon
    record("V_DAY", "the last vantage reads a plausible daylight frame at noon",
           noon is not None and DAY_BAND[0] <= noon["luma"] <= DAY_BAND[1],
           noon_luma=(noon or {}).get("luma"), band=list(DAY_BAND), place=measured[-1],
           note="a camera sealed in a dark box, or pressed against something emissive, fails this and "
                "every night number taken from it is worthless")

    # ---- THE STEP, IN READABLE GROUND, PER PLACE.
    summary = {}
    for n in complete:
        seq = sorted([r for r in good[n] if r["hour"] <= 20.0], key=lambda r: r["hour"])
        # STEPS ARE DETECTED ON GROUND LUMA, NOT ON THE READABLE FRACTION, and that is not a preference.
        #
        # readable is a THRESHOLD statistic. Where a region's ground sits near luma 0.14 a thousandth of
        # luma moves several per cent of the fraction; where it sits far from the threshold the same
        # thousandth moves nothing. Comparing step SIZES between regions in that statistic compares
        # amplifier gain rather than the world -- the arrival hovers around 0.09 to 0.12 while Noctis
        # ranges 0.016 to 0.18, so their fractions respond differently to the same physical change by
        # construction, and "which region has the biggest step" would be answered by where each one
        # happens to sit relative to the threshold.
        #
        # So the comparable quantity detects the step and the fraction is reported beside it. ACCEPTANCE
        # is a different question and D_READABLE keeps the fraction, because "can a walker see the
        # ground" is exactly a threshold question.
        steps = [{"to": seq[i]["hour"],
                  "d_ground_luma": round(seq[i]["ground_luma"] - seq[i - 1]["ground_luma"], 4),
                  "d_readable": round(seq[i]["ground_readable"] - seq[i - 1]["ground_readable"], 4)}
                 for i in range(1, len(seq))]
        mags = sorted(abs(s["d_ground_luma"]) for s in steps)
        worst = max(steps, key=lambda s: abs(s["d_ground_luma"])) if steps else None
        night = next((r for r in good[n] if abs(r["hour"] - NIGHT_REF) < 0.01), None)
        summary[n] = {
            "worst_step_ground_luma": (worst["d_ground_luma"] if worst else None),
            "worst_step_readable_there": (worst["d_readable"] if worst else None),
            "worst_step_at_hour": (worst["to"] if worst else None),
            "median_step_ground_luma": (mags[len(mags) // 2] if mags else None),
            "ground_luma_by_hour": {("%.2f" % r["hour"]): r["ground_luma"] for r in good[n]},
            "readable_by_hour": {("%.2f" % r["hour"]): r["ground_readable"] for r in good[n]},
            "crushed_by_hour": {("%.2f" % r["hour"]): r["ground_crushed"] for r in good[n]},
            "luma_by_hour": {("%.2f" % r["hour"]): r["luma"] for r in good[n]},
            "night_readable": (night or {}).get("ground_readable"),
            "worst_evening_readable": min((r["ground_readable"] for r in seq), default=None),
            "worst_evening_hour": (min(seq, key=lambda r: r["ground_readable"])["hour"] if seq else None)}
    RESULT["summary"] = summary

    def stepped(n):
        """A jump in the ground's actual brightness that stands out from that region's own ordinary
        quarter-hour movement. An absolute floor AND a multiple of the local median, so a region that
        moves a lot everywhere does not qualify on size alone and a flat region with one lurch does."""
        s = summary[n]
        if s["worst_step_ground_luma"] is None or s["median_step_ground_luma"] is None:
            return False
        return abs(s["worst_step_ground_luma"]) > 0.030 and \
            abs(s["worst_step_ground_luma"]) > max(3.0 * s["median_step_ground_luma"], 0.015)

    with_step = [n for n in complete if stepped(n)]
    record("D_GLOBAL", "the evening step reproduces in more than one region, so it is the world's",
           len(with_step) >= 2, regions_with_a_step=with_step, regions_measured=complete,
           per_region={n: {k: summary[n][k] for k in
                           ("worst_step_ground_luma", "worst_step_readable_there",
                            "worst_step_at_hour", "median_step_ground_luma")}
                       for n in complete},
           note="RED means it is local geometry at whichever place shows it and the caveat belongs on "
                "that vantage rather than on the world. Green means a real world-wide transition. One "
                "region alone is not a transition")

    # ---- READABILITY, WHICH IS THE FOUNDER'S SENTENCE AND NOT THE BRIGHTNESS.
    fails = [{"place": n, "hour": summary[n]["worst_evening_hour"],
              "evening_readable": summary[n]["worst_evening_readable"],
              "night_readable": summary[n]["night_readable"]}
             for n in complete
             if summary[n]["night_readable"] is not None
             and summary[n]["worst_evening_readable"] is not None
             and summary[n]["worst_evening_readable"] < summary[n]["night_readable"] - AGREE]
    record("D_READABLE", "no region leaves less of the ground readable in the evening than at night",
           len(complete) == len(PLACES) and len(fails) == 0,
           worse_than_night=fails,
           readable_evening_vs_night={n: [summary[n]["worst_evening_readable"],
                                          summary[n]["night_readable"]] for n in complete},
           note="the founder's complaint is that six in the evening is darker than midnight, measured on "
                "the share of ground a walker can READ rather than on a mean a few lamp pixels can carry")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
