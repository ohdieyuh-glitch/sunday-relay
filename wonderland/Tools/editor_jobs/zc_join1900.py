# IS THE 19:15 STEP A DEFECT IN THE WORLD, OR A FACT ABOUT ONE CAMERA?
#
# zzU2's W_JOIN_1900 failed at 0.0652 between 19:10 and 19:25, with ground jumping 0.0687 to 0.1772. The
# same step is in zzT2 (+0.0473 over 19:00-19:25), zzU1 (+0.0683) and zzU2 (+0.0652) -- three runs across
# two builds, so it predates the bearing fix and is not mine.
#
# WHAT IT IS NOT. Between elevation -20.45 and -23.14 both curves are pinned: Nightfall is 1.0 at each end
# and Daylight is 0 at each end, so nothing driven by either can move. Read off the source, everything else
# hour-keyed in that window is continuous too:
#
#   SunFloor           0.0012 of noon, constant once Nightfall is 1
#   MoonLux            MoonGain * Nightfall, constant once Nightfall is 1
#   SunColourAt        its Low term is clamped at 1 for every negative elevation
#   fog Edge           1 - |Elevation|/72, which moves 0.716 to 0.679 -- smooth, and slightly LESS fog
#   shadow handover    MoonLux > SunIntensity crosses at Nightfall about 0.076, which is around 17:53
#   sky recapture      every 0.5 s regardless of hour
#
# So nothing in the day cycle steps at 19:15, and I have stopped looking for one there.
#
# WHAT IS LEFT is geometry. The moon's pitch is +Elevation, so it CLIMBS as the night deepens -- 20.4 deg
# above the horizon at 19:10 and 23.1 at 19:25. A moon clearing a roofline, a tower or a tree would produce
# exactly this: a step rather than a curve, reproducible because the geometry does not move, and larger on
# the GROUND patch than on the whole frame because the ground is what a directional light reaches when it
# stops being blocked. The ground moved 2.6x while the frame moved 1.7x, which is the shape that predicts.
#
# THAT IS A HYPOTHESIS AND THIS JOB DOES NOT TEST IT DIRECTLY. It tests the thing that actually matters and
# that a hypothesis cannot settle: whether the step is THERE AT ALL when you stand somewhere else.
#
#   If every place steps at the same hour, it is a world-wide defect and the cause is worth hunting.
#   If only the Golden Arrival steps, then W_JOIN_1900 is a fact about my measuring position, every
#   conclusion I have drawn from that camera at that hour needs the caveat, and the world is fine.
#
# Three places, far apart, chosen from the light manifest's own districts: the arrival where every previous
# reading was taken, the densest spot in Noctis, and Tartarus on the far side of the world. The pawn is
# MOVED to each -- the practical pool follows the pawn, not the camera -- and the camera takes the same
# world-axis offset at each, so the moon's bearing relative to the view is identical at all three.
#
# Saves nothing. Restores hour. Holds exposure, span and the other lane's eye levels.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "join1900")

#: Tight around the step zzU2 localised to 19:10-19:25, with a rung either side for shape.
HOURS = (19.00, 19.10, 19.15, 19.20, 19.25, 19.35)
#: name -> (x, y). Districts taken from the manifest's own label prefixes.
PLACES = (("golden_arrival", (0.0, -1460.0)),
          ("noctis_nc02", (-65943.0, -38753.0)),
          ("tartarus_tq04", (87157.0, -50320.0)))
SPAN = 21.0
AGREE = 0.010
#: The same world-axis camera offset at every place, so moon bearing relative to the view is constant.
CAM_AHEAD = (2400.0, -2400.0)
PAWN_CH = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2


def patch(cx, cy, hw, hh):
    got = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
    if got is None:
        return None
    mean, dark, bright, sampled = got
    return {"luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 4),
            # DARK IS KEPT SEPARATELY, not folded into tails. A MEAN passes while most of the frame is
            # crushed -- a few lamp pixels lift it -- which is the error that once let a 99-per-cent-black
            # pond through the water audit on its mean, and which I reintroduced in C_GROUND after fixing it.
            "dark": round(dark, 4),
            "tails": round(min(1.0, dark + bright), 4)}


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

    L.focus_game_viewport()
    cvar("wl.Sky.DayMinutes", 0)
    cvar("wl.Sky.TwilightSpan", "%.1f" % SPAN)

    def settled():
        # Window spread, not steps: three consecutive reads must be the same reading.
        window = []
        for _ in range(24):
            yield 1.0
            now = patch(0.5, 0.5, 0.46, 0.44)
            if now is None:
                continue
            window.append(now["luma"])
            if len(window) > 3:
                window.pop(0)
            if len(window) == 3 and (max(window) - min(window)) < 0.004:
                return

    def stand(x, y):
        """Put the pawn on the ground at (x, y). Returns the traced ground z, or None.

        DELIBERATELY DOES NOT RETURN THE PAWN. A teleport can RESPAWN it, and the reference held across
        the move is then a dead actor whose get_actor_location returns (0, 0, 0). zzU4 voided on exactly
        that: the same code read 10.6 uu from target on one run and the origin, 76 km away, on the next.
        The caller re-fetches after the move instead.
        """
        pawn = unreal.GameplayStatics.get_player_pawn(live(), 0)
        if pawn is None:
            return None
        gz = None
        try:
            hit = unreal.SystemLibrary.line_trace_single(
                live(), unreal.Vector(x, y, 20000.0), unreal.Vector(x, y, -5000.0), PAWN_CH, False,
                [pawn], unreal.DrawDebugTrace.NONE, True,
                unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            if hit is not None:
                gz = float(hit.to_tuple()[4].z)
        except Exception:                                              # noqa: BLE001
            gz = None
        pawn.set_actor_location(unreal.Vector(x, y, (gz + 120.0) if gz is not None else 200.0), False, True)
        return gz

    out = {}
    RESULT["places"] = out
    placed = {}
    RESULT["placement"] = placed
    for name, (px, py) in PLACES:
        gz = stand(px, py)
        yield 2.0
        pawn = unreal.GameplayStatics.get_player_pawn(live(), 0)   # re-fetched: the move can respawn it
        if pawn is None:
            placed[name] = {"asked": [px, py], "landed": None, "offset_uu": None, "ground_z": gz}
            out[name] = []
            continue
        where = pawn.get_actor_location()
        off = round(((where.x - px) ** 2 + (where.y - py) ** 2) ** 0.5, 1)
        placed[name] = {"asked": [px, py], "landed": [round(where.x, 1), round(where.y, 1), round(where.z, 1)],
                        "offset_uu": off, "ground_z": gz}
        eye = unreal.Vector(where.x, where.y, where.z + 60.0)
        at = unreal.Vector(where.x + CAM_AHEAD[0], where.y + CAM_AHEAD[1], where.z + 20.0)
        L.pose_camera(live(), eye, at, 70.0)
        yield 2.0

        rows = []
        out[name] = rows
        for hour in HOURS:
            cvar("wl.Sky.Hour", "%.2f" % hour)
            for step in settled():
                yield step
            a = patch(0.5, 0.5, 0.46, 0.44)
            g1 = patch(0.5, 0.78, 0.30, 0.16)
            yield 1.0
            b = patch(0.5, 0.5, 0.46, 0.44)
            g2 = patch(0.5, 0.78, 0.30, 0.16)
            try:
                H.capture_viewport_jpeg(os.path.join(ROOT, "%s_h%05.2f.jpg" % (name, hour)), 1200, 85)
            except Exception:                                          # noqa: BLE001
                pass
            if a is None or b is None:
                rows.append({"hour": hour, "unmeasured": True})
                continue
            rows.append({"hour": hour,
                         "luma": round((a["luma"] + b["luma"]) / 2.0, 4),
                         "spread": round(abs(a["luma"] - b["luma"]), 4),
                         "tails": round((a["tails"] + b["tails"]) / 2.0, 4),
                         "ground_luma": round(((g1 or {}).get("luma", 0.0)
                                               + (g2 or {}).get("luma", 0.0)) / 2.0, 4) if g1 and g2 else None})

    cvar("wl.Sky.Hour", 12)
    L.release_camera(live())

    every = [r for name, _ in PLACES for r in out.get(name, []) if not r.get("unmeasured")]
    wanted = len(PLACES) * len(HOURS)

    landed_ok = [n for n, v in placed.items() if v.get("offset_uu") is not None and v["offset_uu"] <= 500.0]
    record("J_WHERE", "the pawn reached all three places, so three different surroundings were measured",
           len(landed_ok) == len(PLACES), placement=placed, reached=landed_ok,
           note="if a pawn did not arrive, that place's rows are of somewhere else and the comparison "
                "between places is meaningless")

    worst_spread = max((r["spread"] for r in every), default=None)
    record("J_NOISE", "each rung agrees with itself -- two reads of the same hour",
           worst_spread is not None and worst_spread <= AGREE and len(every) == wanted,
           worst_spread=worst_spread, tolerance=AGREE, measured=len(every), wanted=wanted)
    if len(landed_ok) != len(PLACES) or len(every) != wanted or (worst_spread or 1.0) > AGREE:
        RESULT["status"] = "voided: placement or noise"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    # ---- WHERE DOES EACH PLACE STEP, AND HOW HARD?
    summary = {}
    for name, _ in PLACES:
        rows = [r for r in out[name] if not r.get("unmeasured")]
        steps = [{"to": rows[i]["hour"], "d": round(rows[i]["luma"] - rows[i - 1]["luma"], 4)}
                 for i in range(1, len(rows))]
        mags = sorted(abs(s["d"]) for s in steps)
        worst = max(steps, key=lambda s: abs(s["d"])) if steps else None
        summary[name] = {"steps": steps,
                         "worst_step": (worst["d"] if worst else None),
                         "worst_at_hour": (worst["to"] if worst else None),
                         "median_step": (mags[len(mags) // 2] if mags else None),
                         "luma": {("%.2f" % r["hour"]): r["luma"] for r in rows},
                         "ground": {("%.2f" % r["hour"]): r.get("ground_luma") for r in rows}}
    RESULT["summary"] = summary

    # A place "has the step" if its worst step is both large in absolute terms and clearly above its own
    # ordinary movement -- the same comparison shape zzT3's S_SMOOTH used to find this in the first place.
    def stepped(name):
        s = summary[name]
        if s["worst_step"] is None or s["median_step"] is None:
            return False
        return abs(s["worst_step"]) > 0.03 and abs(s["worst_step"]) > max(3.0 * s["median_step"], 0.02)

    with_step = [n for n, _ in PLACES if stepped(n)]
    others = [n for n, _ in PLACES if n != "golden_arrival"]
    record("J_LOCAL", "the 19:15 step belongs to the Golden Arrival view and is not world-wide",
           "golden_arrival" in with_step and not any(stepped(n) for n in others),
           places_with_a_step=with_step, per_place=summary,
           note="PASS means this is a fact about where I have been measuring, every conclusion from that "
                "camera at that hour needs the caveat, and the world is fine. FAIL means either the step "
                "is everywhere -- a real defect worth hunting -- or it did not reproduce at the arrival "
                "this time, which would make zzU2's red the thing needing explanation")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
