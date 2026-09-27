# WHAT DOES THE LIGHT BUDGET BUY, AND WHAT DOES IT COST? Measured at the worst-oversubscribed spot there is.
#
# The other lane found the pool is heavily oversubscribed and I reproduced it independently from the
# manifest: 1,464 defined lights, wl.Look.PracticalCount 48, wl.Look.PracticalRadius 12,000 uu. Counting,
# for every light, how many others lie within one pool radius of it:
#
#     median neighbourhood  110      p90  158      worst  184
#     lights whose neighbourhood exceeds the pool:  1,079 of 1,464  (74 per cent)
#
# At the worst spot 184 designed lamps compete for 48 real ones, so 136 are dark however well they are
# ranked -- and it is worst exactly where the design is densest, which is the developed districts the
# founder says collapse into near-black. Ranking by significance, which landed at 88f8015d, decides WHICH
# 48 win; it cannot make 184 fit into 48. Only the budget can, and line 138 already clamps Want to 256, so
# there is headroom compiled in that nobody has priced.
#
# THE SPOT IS CHOSEN BY THE DATA, NOT BY ME: (-65943, -38753), the NC02 facade lamp in Noctis, which has
# the densest neighbourhood in the world at 184. If raising the count helps anywhere it helps here, and if
# it does not help here it will not help anywhere.
#
# TWO TRAPS THAT WOULD EACH HAVE PRODUCED A CONFIDENT WRONG ANSWER, both gated rather than trusted.
#
#   THE POOL DOES NOT REBUILD ON THE CVAR. BuildPool() is called only from Reload() and OnWorldBeginPlay,
#   never from Tick. Setting wl.Look.PracticalCount alone leaves Pool.Num() at its previous size while the
#   cvar reads back the new value perfectly -- the cvar-readback trap in a new coat, and a readback gate
#   would have sailed straight through it. Every rung issues wl.Look.PracticalReload and then COUNTS THE
#   SPAWNED ACTORS, which is the only statement of pool size that cannot lie.
#
#   THE POOL FOLLOWS THE PAWN, NOT THE CAMERA. Assign() takes its Eye from PC->GetPawn()->GetActorLocation().
#   Posing the camera at Noctis while the pawn stood at the arrival would have selected the pool twelve
#   kilometres away, shown a nearly unlit district, and supported either "Noctis has no lamps" or "raising
#   the count does nothing". So the PAWN is moved and its landed position is recorded and gated.
#
# COST IS READ FROM THE RAW ACCESSOR, deduplicated by engine frame number. GetFrameCostMs returns the
# filtered half of FStatUnitData and a budget question is a question about the TAIL: forty-eight more
# lights that cost nothing on average and stall on re-assignment are not affordable. A p95 off the filtered
# curve would have said they were.
#
# Saves nothing. Restores the count and reloads. Holds exposure, span and the other lane's eye levels.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "practical_budget")

#: The densest neighbourhood in the manifest -- 184 lights within one pool radius. Chosen by counting.
SPOT = (-65943.0, -38753.0)
#: 48 is shipped. 256 is the compiled ceiling at line 138, so 192 leaves headroom rather than testing a wall.
COUNTS = (48, 96, 144, 192)
#: Deep enough to be unambiguously night, and on the flat part zzT3 measured (0.0053 drift over 4.5 hours).
HOUR = 23.0
SPAN = 21.0
AGREE = 0.010
#: How long to watch frames at each rung. Long enough for several pool re-assignments, which run every 0.25 s.
COST_SECONDS = 6.0


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

    def command(text):
        unreal.SystemLibrary.execute_console_command(live(), text)

    world = live()
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)

    # ---- FIND THE GROUND UNDER THE DENSEST SPOT, then stand the pawn on it.
    #
    # Traced rather than assumed. This project's shelves sit at road +12, ground beside it -14 and frontier
    # -14, and a declared z has been wrong often enough that the ledger has a note about it.
    sky = unreal.Vector(SPOT[0], SPOT[1], 20000.0)
    floor_v = unreal.Vector(SPOT[0], SPOT[1], -5000.0)
    ground_z = None
    try:
        # TRACE_TYPE_QUERY2 is the pawn channel this tree traces the floor on, and index 4 is where this
        # engine's Python puts the impact point -- established once in zc_hit_shape and used at eighteen
        # call sites since. Neither is guessed here.
        hit = unreal.SystemLibrary.line_trace_single(
            world, sky, floor_v, unreal.TraceTypeQuery.TRACE_TYPE_QUERY2, False,
            [p for p in (pawn,) if p is not None], unreal.DrawDebugTrace.NONE, True,
            unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        if hit is not None:
            ground_z = float(hit.to_tuple()[4].z)
    except Exception as bad:                               # noqa: BLE001
        RESULT["ground_trace_error"] = str(bad)[:200]
    RESULT["ground_trace_z"] = ground_z
    stand_z = (ground_z + 120.0) if ground_z is not None else 200.0
    pawn.set_actor_location(unreal.Vector(SPOT[0], SPOT[1], stand_z), False, True)
    yield 2.0

    # RE-FETCH THE PAWN. A teleport can RESPAWN it -- this tree's traversal job already documents that as
    # the behaviour -- and the old reference is then a dead actor whose get_actor_location returns
    # (0, 0, 0). The first run of this job read 10.6 uu from target off a surviving pawn and the second
    # read the origin, 76 km away, off a destroyed one: same code, different luck. B_WHERE caught it both
    # times, which is the only reason this was visible at all.
    pawn = unreal.GameplayStatics.get_player_pawn(live(), 0)
    if pawn is None:
        RESULT["status"] = "voided: there is no player pawn after the teleport"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    where = pawn.get_actor_location()
    off = round(((where.x - SPOT[0]) ** 2 + (where.y - SPOT[1]) ** 2) ** 0.5, 1)
    RESULT["pawn_asked"] = list(SPOT)
    RESULT["pawn_landed"] = [round(where.x, 1), round(where.y, 1), round(where.z, 1)]
    record("B_WHERE", "the pawn is standing at the densest spot, which is what selects the pool",
           off <= 500.0, asked=list(SPOT), landed=RESULT["pawn_landed"], horizontal_offset_uu=off,
           ground_trace_z=ground_z,
           note="Assign() takes its Eye from the PAWN, not the camera. If the pawn did not arrive, every "
                "reading below is of a pool selected somewhere else and none of it means anything")
    if off > 500.0:
        RESULT["status"] = "voided: the pawn did not reach the measurement spot"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    L.focus_game_viewport()
    cvar("wl.Sky.DayMinutes", 0)
    cvar("wl.Sky.TwilightSpan", "%.1f" % SPAN)
    cvar("wl.Sky.Hour", "%.2f" % HOUR)
    # Eye height on the pawn, looking level along the street rather than down at it.
    eye = unreal.Vector(where.x, where.y, where.z + 60.0)
    at = unreal.Vector(where.x + 3000.0, where.y + 1200.0, where.z + 40.0)
    L.pose_camera(world, eye, at, 70.0)
    # STAT UNIT, OR THERE IS NO FRAME INSTRUMENT AT ALL. FStatUnitData only advances while the overlay is
    # actually drawing. The first run of this job read every cost cell as None for exactly this reason: I
    # went looking for the raw accessor's tail without turning the counter on. It is re-issued per rung
    # below as well, because left alone it hands back one frozen snapshot over and over.
    command("stat unit")
    RESULT["camera_eye"] = [round(eye.x, 1), round(eye.y, 1), round(eye.z, 1)]
    RESULT["camera_at"] = [round(at.x, 1), round(at.y, 1), round(at.z, 1)]
    yield 3.0

    def pool_now():
        """Pool size and how many are actually LIT, by counting actors. The only account that cannot lie."""
        try:
            lights = unreal.GameplayStatics.get_all_actors_of_class(live(), unreal.PointLight)
        except Exception:                                  # noqa: BLE001
            return None, None
        total, lit = 0, 0
        for a in lights:
            if a is None:
                continue
            name = ""
            try:
                name = str(a.get_actor_label())
            except Exception:                              # noqa: BLE001
                pass
            if name and not name.startswith("WL_Practical"):
                continue                                   # someone else's light, not the pool
            total += 1
            try:
                comp = a.point_light_component
                if comp is not None and comp.is_visible():
                    lit += 1
            except Exception:                              # noqa: BLE001
                pass
        return total, lit

    def raw_frame_ms():
        """This frame's unfiltered cost, once per rendered frame. None when the frame has not advanced."""
        try:
            now = int(H.get_engine_frame_number())
        except Exception:                                  # noqa: BLE001
            now = None
        if now is not None and now == globals().get("_LAST_FRAME"):
            return None
        try:
            raw = H.get_raw_frame_cost_ms()
        except Exception:                                  # noqa: BLE001
            return None
        if raw is None or float(raw[0]) <= 0.01:
            return None
        globals()["_LAST_FRAME"] = now
        return float(raw[0])

    def settled():
        # THE WINDOW'S SPREAD, NOT ITS STEPS. This asked whether three consecutive STEPS were each inside
        # the tolerance, and steps compound: three steps of 0.0039 walk the window 0.0117 downhill while
        # every pair passes, which is wider than the 0.010 these jobs call agreement. The other lane
        # demonstrated it on [200, 60, 66, 61, 50, 49, 48.5], where a step test returns on the 60 with a
        # fifth of the fall still to come -- the pair test's hole, one read wider, on exactly the
        # oscillating case the three-read version was written to catch.
        #
        # Max minus min across the last three reads asks the question actually being asked -- are these
        # three the same reading -- and carries no assumption about direction, rate or shape. That is what
        # killed the previous four versions: each fixed the last one's form and kept its assumption.
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
        # Fell through without settling. Said by NOT trimming anything: the rung's own two-read spread then
        # reports the damage and the noise gate voids the run, rather than a tidy number from the tail.

    rows = []
    RESULT["budget"] = rows
    for count in COUNTS:
        cvar("wl.Look.PracticalCount", "%d" % count)
        command("wl.Look.PracticalReload")                 # WITHOUT THIS THE POOL DOES NOT CHANGE SIZE
        yield 2.0
        # ---- WAIT FOR THE POOL TO STOP MOVING BEFORE LOOKING AT IT.
        #
        # Reload() destroys and respawns up to 192 point lights and sets LastNight = -1 to force a
        # re-assign, and Assign() runs on its own 0.25 s timer. The first run of this job sampled inside
        # that window and recorded 31 lit out of a pool of 48, then 96 of 96, then 31 of 144, then 184 of
        # 192 -- an impossible saturation curve, which is what a transient state looks like when it is
        # read as a result. The luma settle below could not catch it because the picture can be steady
        # while the assignment underneath it is not.
        #
        # So the LIT COUNT has to be the same three reads running before anything is measured. Same test
        # as the luma settle and for the same reason: a window that is not moving, rather than steps that
        # happen to be small.
        seen = []
        for _ in range(40):
            yield 0.5
            _t, _l = pool_now()
            seen.append(_l)
            if len(seen) > 3:
                seen.pop(0)
            if len(seen) == 3 and len(set(seen)) == 1 and seen[0] is not None:
                break
        command("stat unit")                               # re-issued: the counter freezes if left alone
        for step in settled():
            yield step
        total, lit = pool_now()
        a = patch(0.5, 0.5, 0.46, 0.44)
        g1 = patch(0.5, 0.78, 0.30, 0.16)
        # ---- frame cost, raw and per-frame, across several pool re-assignments
        frames = []
        spent = 0.0
        while spent < COST_SECONDS:
            v = raw_frame_ms()
            if v is not None:
                frames.append(v)
            yield 0.0
            spent += 0.01
        yield 1.0
        b = patch(0.5, 0.5, 0.46, 0.44)
        g2 = patch(0.5, 0.78, 0.30, 0.16)
        try:
            H.capture_viewport_jpeg(os.path.join(ROOT, "count%03d.jpg" % count), 1200, 85)
        except Exception:                                  # noqa: BLE001
            pass
        if a is None or b is None:
            rows.append({"count": count, "unmeasured": True})
            continue
        frames.sort()
        rows.append({
            "count": count,
            "pool_actors": total, "lit_actors": lit,
            # The last three lit-counts before measuring. Three equal values means the assignment had
            # stopped moving; anything else means it had not and the row should be read as suspect.
            "lit_settled_on": list(seen),
            "luma": round((a["luma"] + b["luma"]) / 2.0, 4),
            "spread": round(abs(a["luma"] - b["luma"]), 4),
            "tails": round((a["tails"] + b["tails"]) / 2.0, 4),
            "ground_luma": round(((g1 or {}).get("luma", 0.0) + (g2 or {}).get("luma", 0.0)) / 2.0, 4)
            if g1 and g2 else None,
            "raw_frames": len(frames),
            "raw_median_ms": round(frames[len(frames) // 2], 2) if frames else None,
            "raw_p95_ms": round(frames[min(len(frames) - 1, int(len(frames) * 0.95))], 2) if frames else None,
            "raw_worst_ms": round(frames[-1], 2) if frames else None})

    cvar("wl.Look.PracticalCount", "48")
    command("wl.Look.PracticalReload")
    cvar("wl.Sky.Hour", 12)
    L.release_camera(live())

    good = [r for r in rows if not r.get("unmeasured")]

    worst_spread = max((r["spread"] for r in good), default=None)
    record("B_NOISE", "each rung agrees with itself -- two reads of the same setting",
           worst_spread is not None and worst_spread <= AGREE and len(good) == len(COUNTS),
           worst_spread=worst_spread, tolerance=AGREE, measured=len(good), wanted=len(COUNTS))
    if not good or len(good) != len(COUNTS) or (worst_spread or 1.0) > AGREE:
        RESULT["status"] = "voided: the rungs do not agree with themselves"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    # ---- DID THE POOL ACTUALLY CHANGE SIZE? Counted, not asked.
    built = {r["count"]: r["pool_actors"] for r in good}
    took = [c for c in COUNTS if built.get(c) is not None and abs(built[c] - c) <= 2]
    record("B_POOL", "the pool was actually rebuilt to each size asked for, counted from spawned actors",
           len(took) == len(COUNTS), asked=list(COUNTS), counted=built, matched=took,
           note="BuildPool runs only from Reload and OnWorldBeginPlay, never from Tick. If these do not "
                "track, wl.Look.PracticalReload is not doing what this job assumes and every reading below "
                "is of one pool size measured four times")
    if len(took) != len(COUNTS):
        RESULT["status"] = "voided: the pool did not rebuild to the sizes asked for"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    # ---- IS THE POOL SATURATED? If every light in the pool is lit at 48, the budget is the binding limit.
    saturation = {r["count"]: {"pool": r["pool_actors"], "lit": r["lit_actors"]} for r in good}
    base = next((r for r in good if r["count"] == 48), None)
    record("B_SATURATED", "at the shipped budget every light in the pool is already lit -- the cap binds here",
           base is not None and base["lit_actors"] is not None and base["pool_actors"] is not None
           and base["lit_actors"] >= base["pool_actors"] - 2,
           at_48=saturation.get(48), all_counts=saturation,
           manifest_within_radius=184, manifest_total=1464,
           note="184 defined lights lie within one pool radius of this spot. If 48 of 48 are lit then the "
                "pool is the constraint and not the placement, which is the question this job exists for")

    # ---- WHAT DOES THE EXTRA BUDGET BUY?
    top = good[-1]
    gain_luma = (round(top["luma"] - base["luma"], 4) if base else None)
    gain_ground = (round((top.get("ground_luma") or 0.0) - (base.get("ground_luma") or 0.0), 4)
                   if base else None)
    record("B_LIGHT", "raising the budget actually lights more of the district",
           gain_luma is not None and gain_luma > AGREE,
           luma_by_count={str(r["count"]): r["luma"] for r in good},
           ground_by_count={str(r["count"]): r.get("ground_luma") for r in good},
           gain_luma=gain_luma, gain_ground=gain_ground, tolerance=AGREE,
           note="if this is red the budget is not what is dark here and adding lights is the wrong fix, "
                "whatever the saturation count says")

    # ---- AND WHAT DOES IT COST, on the tail rather than the average.
    cost = {str(r["count"]): {"median": r["raw_median_ms"], "p95": r["raw_p95_ms"],
                              "worst": r["raw_worst_ms"], "frames": r["raw_frames"]} for r in good}
    readable = all(r["raw_median_ms"] is not None and r["raw_frames"] >= 30 for r in good)
    p95_rise = (round(top["raw_p95_ms"] - base["raw_p95_ms"], 2)
                if readable and base and top["raw_p95_ms"] and base["raw_p95_ms"] else None)
    record("B_COST", "the frame cost of the larger budget is reported from the RAW accessor, per frame",
           readable, by_count=cost, p95_rise_48_to_top=p95_rise,
           frames_needed=30,
           note="INFORMATIONAL: this publishes the curve rather than passing or failing it, because what "
                "is affordable is a founder call and not mine. Red here means the frames could not be "
                "read at all, which would make the cost column meaningless rather than expensive")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
