# CORE copy of the integration lane's zzJ01_ga_walk.py (Bug2 navigator, positive control), with MOVE_WALKING set
# before the actuator probe. Original: C:/dev/iwonder/_julius_playtest/jobs/zzJ01_ga_walk.py (hash in its manifest).
# ZZJ01 -- GOLDEN ARRIVAL, WALKED BY THE DOG. Julius independent play-test lane (founder directive 2026-09-29).
#
# READ-ONLY. This job never saves, never edits, never spawns into the editor world. It begins PIE, walks the Dog
# under its own power, measures, and ends the PIE it began. CONCURRENT is deliberately NOT declared: a job that
# begins and ends play must never run beside another (channel-concurrent-pie-jobs).
#
# WHAT IT PROVES, AND HOW IT COULD FAIL.
#   * Locomotion is the builders' proven actuator (zc_nation_walk): every tick the Dog is given forced movement
#     input toward the next waypoint. A waypoint is reached when the Dog's own position is within ARRIVE. No
#     teleport ever counts as traversal; teleports only place the Dog at a leg's start.
#   * STUCK is "no 20 cm gained for STUCK_S seconds". Before giving up the Dog tries up to three sidesteps toward
#     the clearer side (a gate pier or a topiary is not a blocked route). A route still blocked after that is
#     reported with where the Dog stood, the floor under it and the first colliding thing in front of it.
#   * A POSITIVE CONTROL runs first: the Dog is driven straight at a garden wall of the arrival gate with sidesteps
#     disabled. If it gets through, the stuck detector (or the wall) cannot be trusted and every walk clause is
#     WITHHELD rather than passed.
#   * An ACTUATOR PROBE runs before any route is judged: a Dog that never moves is a harness fault, not a route
#     fault, and is reported as BLOCKED.
#   * Every stand asks World Partition itself (is_world_partition_streaming_complete), then counts the world's own
#     content (batch instances + static mesh actors, never characters) in a 20 m box in PLAY and compares it with
#     the same box counted in the EDITOR, re-reading until two readings a second apart agree.
#   * Every reading re-fetches the world and the pawn (a stale PIE returns empty lists that look like data).
#   * Every clause is declared up front; one that never ran fails J99.
import json
import math
import os
import time

L = unreal.WonderlandUiTestLibrary
H = getattr(unreal, "WonderlandHudTestLibrary", None)
BATCH = getattr(unreal, "WonderlandInstancedBatch", None)
OUT = r"C:/dev/iwonder/_julius_playtest/results/zc_core_ga_walk_nav"
PAWN_TRACE = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2

ARRIVE = 150.0        # uu: "there"
GAIN = 20.0           # uu of progress that resets the stuck clock
STUCK_S = 5.0         # seconds without GAIN -> try a sidestep
SIDESTEPS = 3         # sidesteps before a route is declared blocked
SIDESTEP_S = 1.6      # seconds per sidestep
TICK = 0.05
STAND_HALF = 1000.0   # 20 m box for the residency count
RESIDENT_MIN = 0.90
JUDGE_MIN = 10        # a box with fewer authored pieces is not judged for residency
HIGH_ABOVE = 400.0    # floor more than 4 m above the leg's ground reference = standing on a structure

# ---- THE ROUTES. Golden Arrival's main axis runs along +Y (approach -64 m, arrival plaza 0, promenade, garden gate
# +32 m, clock-plaza threshold and steps +45 m, heart garden, palace walk, palace entrance ~+95 m). Positions come
# from the GA specs and the 2026-09-13 obstacle exports (gate piers at +-260/300, leaves at x -183/+217, fountain
# basin r 4.2 m at (0, 5400), topiaries at x +-620). Each waypoint: (name, x, y, kind); kind "stand" is measured.
LEGS = [
    {"id": "axis", "clause": "J06", "ground": 0.0,
     "name": "main axis, approach gate to palace entrance, on foot",
     "points": [("approach_south", 0, -6300, "stand"), ("approach_gate", 0, -5800, "via"),
                ("processional", 0, -3000, "stand"), ("approach_end", 0, -1300, "via"),
                ("arrival_gate", 20, -840, "via"), ("arrival_plaza", 0, 0, "stand"),
                ("promenade", 0, 1500, "stand"), ("garden_gate", 0, 3250, "stand"),
                ("garden_path_end", 0, 4250, "via"), ("threshold_steps", 0, 4700, "via"),
                # The basin (r 4.2 m) reaches y ~4979 and the topiary cones stand at x +-620 (r ~2 m), so the
                # way round the fountain is outside the topiaries, at x -950.
                ("clock_plaza", 0, 4850, "stand"), ("fountain_sw", -950, 4900, "via"),
                ("fountain_nw", -950, 5950, "via"), ("heart_garden", 0, 6350, "stand"),
                ("medallion", 150, 7300, "stand"), ("palace_walk", 250, 8200, "stand"),
                ("palace_approach", 300, 9200, "via"), ("palace_entrance", 300, 9650, "stand")]},
    {"id": "rear", "clause": "J09", "ground": 0.0,
     "name": "the rear world beyond the palace, on foot from the palace entrance",
     "points": [("palace_entrance", 300, 9650, "start"), ("palace_east", 1900, 9700, "via"),
                ("palace_east_far", 1900, 12600, "via"), ("rear_world", 300, 13400, "stand")]},
    {"id": "west", "clause": "J07", "ground": 0.0,
     "name": "west flank garden, in through its side arch and back to the axis",
     "points": [("arrival_plaza", 0, 0, "start"), ("west_inner", -1500, 400, "via"),
                ("west_arch", -2650, 400, "via"), ("west_flank", -3300, 400, "stand"),
                ("west_flank_north", -3000, 5400, "via"), ("west_clock_arch", -2300, 5400, "via"),
                ("clock_plaza_west", -900, 5400, "stand")]},
    {"id": "east", "clause": "J08", "ground": 0.0,
     "name": "east flank garden, in through its side arch and back to the axis",
     "points": [("arrival_plaza", 0, 0, "start"), ("east_inner", 1500, 400, "via"),
                ("east_arch", 2650, 400, "via"), ("east_flank", 3300, 400, "stand"),
                ("east_flank_north", 3000, 5400, "via"), ("east_clock_arch", 2300, 5400, "via"),
                ("clock_plaza_east", 900, 5400, "stand")]},
]
# The control, in order of preference: a garden wall of the arrival gate (SM_garden_wall at (580, -910), 2.6 m
# tall), then the clock-plaza fountain basin (r 4.2 m at (0, 5400)). A candidate is used only if a chest-height
# trace along its path first FINDS the blocker; then the Dog is driven at it head-on with sidesteps disabled and
# must NOT reach the far side.
CONTROLS = [{"name": "arrival garden wall", "start": (580.0, -1500.0), "target": (580.0, -300.0), "line": -910.0,
             "seconds": 9.0},
            {"name": "clock plaza fountain basin", "start": (0.0, 4950.0), "target": (0.0, 5850.0), "line": 5400.0,
             "seconds": 9.0},
            # the palace's castle hall (SM_castle_hall, r ~13 m, 17 m tall, centred (300, 11500)): the Dog must
            # not reach the hall's centre line from the palace entrance
            {"name": "palace castle hall", "start": (300.0, 9650.0), "target": (300.0, 12800.0), "line": 11500.0,
             "seconds": 14.0}]
STATE = {"began": False}

CLAUSES = [("J00", "the stuck detector sees a wall: driven at the arrival garden wall, the Dog does not pass it"),
           ("J01", "the harness can drive the Dog (actuator probe at the spawn)"),
           ("J02", "the Dog survived every leg (never destroyed, world never torn down)"),
           ("J03", "World Partition reported streaming complete at every stand"),
           ("J04", "what is authored at each stand is resident in play (>= 90% of the editor count)"),
           ("J05", "every stand was reached on foot and stands on a walking surface, not on a structure"),
           ("J06", LEGS[0]["name"]), ("J07", LEGS[2]["name"]), ("J08", LEGS[3]["name"]),
           ("J09", LEGS[1]["name"]),
           ("J99", "every declared clause ran")]


def job():
    found = unreal.SystemLibrary.get_console_variable_float_value("wl.Sky.DayMinutes")
    RESULT["day_minutes_found"] = found
    RESULT["lane"] = "julius-independent-playtest"
    RESULT["read_only"] = True
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    STATE["began"] = False
    try:
        yield from _walk(les, ues)
    finally:
        editor_world = ues.get_editor_world()
        unreal.SystemLibrary.execute_console_command(editor_world, "wl.Sky.DayMinutes %s" % found)
        RESULT["day_minutes_restored"] = unreal.SystemLibrary.get_console_variable_float_value("wl.Sky.DayMinutes")
        # END ONLY THE PIE THIS JOB BEGAN -- on every exit path, exceptions included. Someone else's play session
        # is never ended from here.
        if STATE["began"] and ues.get_game_world() is not None:
            les.editor_request_end_play()
            RESULT["pie_ended_by_job"] = True


def _walk(les, ues):
    os.makedirs(OUT, exist_ok=True)
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests
    RESULT["legs"] = {}
    RESULT["stands"] = []
    ran = set()

    def record(tid, ok, **detail):
        name = dict(CLAUSES).get(tid, tid)
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        ran.add(tid)
        emit(tid, "PASS" if ok else "FAIL", name, json.dumps(detail, default=str)[:600])

    def withhold(tid, why):
        tests.append({"id": tid, "name": dict(CLAUSES).get(tid, tid), "pass": False, "withheld": True,
                      "detail": {"withheld": why}})
        ran.add(tid)
        emit(tid, "WITHHELD", why)

    # ---- NEVER TAKE SOMEONE ELSE'S PIE. Wait (10 min cap) for no play session, rather than ending one.
    t_wait = time.time()
    try:
        yield (lambda: ues.get_game_world() is None, 600)
    except TimeoutError:
        RESULT["status"] = "BLOCKED: another PIE session held the editor for 10 minutes; nothing was measured"
        for tid, _ in CLAUSES:
            if tid not in ran:
                withhold(tid, "PIE was never free")
        return False
    RESULT["waited_for_free_pie_s"] = round(time.time() - t_wait, 1)

    # ---- AUTHORED, COUNTED IN THE EDITOR WORLD over the same boxes the stands will count in play.
    editor_world = ues.get_editor_world()
    stand_pts = {}
    for leg in LEGS:
        for (nm, x, y, kind) in leg["points"]:
            # placed starts are measured too (rings measure every arc start): count their authored content, or
            # J04 cannot judge them (jq_ring_arc_1 judged 0 for exactly this reason)
            if kind in ("stand", "start"):
                stand_pts[nm] = (float(x), float(y))
    authored = _count_boxes(editor_world, stand_pts)
    RESULT["authored_per_stand"] = authored
    # THE ROUTE'S OWN PAVING, for legs that name it (a mesh-name filter). Non-colliding paving is invisible to a floor
    # trace (ground shelves: road +12, beside it -14), so a lane's stones are COUNTED in play against the editor, never
    # inferred from the floor (JUJU, 2026-09-29). Empty for every job whose legs name no paving.
    paving_filter = next((lg["paving_filter"] for lg in LEGS if lg.get("paving_filter")), None)
    pave_pts = {}
    for leg in LEGS:
        if leg.get("paving_filter"):
            for wp in leg["points"]:
                if wp[3] in ("stand", "start", "nav"):
                    pave_pts[wp[0]] = (float(wp[1]), float(wp[2]))
    paving_authored = _count_boxes(editor_world, pave_pts, mesh_filter=paving_filter) if pave_pts else {}
    if pave_pts:
        RESULT["paving_authored_per_stand"] = {"filter": paving_filter, "counts": paving_authored}

    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    STATE["began"] = True
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    L.set_background_throttle_suspended(True)
    L.focus_game_viewport()
    yield 4.0
    unreal.SystemLibrary.execute_console_command(ues.get_game_world(), "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(ues.get_game_world(), "wl.Sky.Hour 12")
    yield 1.0

    def live():
        return ues.get_game_world()

    def pawn():
        w = ues.get_game_world()
        if w is None:
            return None
        try:
            return unreal.GameplayStatics.get_player_pawn(w, 0)
        except Exception:                                             # noqa: BLE001
            return None

    def why_gone():
        if ues.get_game_world() is None:
            return "world", "PIE was torn down (harness or a neighbouring job), not the route"
        if pawn() is None:
            return "pawn", "the world is up and the DOG is gone: destroyed, not stuck"
        return "neither", "both present when re-checked"

    def trace(a, b, dog):
        try:
            hit = unreal.SystemLibrary.line_trace_single(
                live(), a, b, PAWN_TRACE, False, [dog] if dog is not None else [], unreal.DrawDebugTrace.NONE,
                True, unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        except Exception:                                             # noqa: BLE001
            return None
        return None if hit is None else hit.to_tuple()

    def floor_under(dog):
        """The floor a walker uses: traced from 1 m above the Dog's feet, never from 40 m (roofs)."""
        if dog is None:
            return None
        loc = dog.get_actor_location()
        t = trace(unreal.Vector(loc.x, loc.y, loc.z + 100.0), unreal.Vector(loc.x, loc.y, loc.z - 1200.0), dog)
        return None if t is None else float(t[4].z)

    def floor_from(x, y, top):
        t = trace(unreal.Vector(x, y, top), unreal.Vector(x, y, top - 3000.0), pawn())
        return None if t is None else float(t[4].z)

    def ahead(dog, heading_deg, dist=180.0):
        loc = dog.get_actor_location()
        h = math.radians(heading_deg)
        a = unreal.Vector(loc.x, loc.y, loc.z + 40.0)
        b = unreal.Vector(loc.x + math.cos(h) * dist, loc.y + math.sin(h) * dist, loc.z + 40.0)
        t = trace(a, b, dog)
        if t is None:
            return dist, None
        d = math.hypot(float(t[4].x) - loc.x, float(t[4].y) - loc.y)
        actor = t[9] if len(t) > 9 else None
        try:
            label = str(actor.get_actor_label()) if actor is not None else "something"
        except Exception:                                             # noqa: BLE001
            label = "something"
        return d, label

    def place(x, y, ground):
        """Stand the Dog at a leg start: floor traced from 4 m above the leg's ground (never a roof)."""
        dog = pawn()
        if dog is None:
            return False, "no pawn"
        top = ground + 400.0
        z = None
        t0 = time.time()
        dog.set_actor_location(unreal.Vector(x, y, top + 500.0), False, True)
        while z is None and time.time() - t0 < 20.0:
            yield 0.5
            z = floor_from(x, y, top)
        if z is None:
            return False, "no floor traced under the leg start within 20 s"
        dog = pawn()
        if dog is None:
            return False, "the Dog did not survive being moved to the leg start"
        dog.set_actor_location(unreal.Vector(x, y, z + 100.0), False, True)
        yield 1.5
        dog = pawn()
        if dog is None:
            return False, "the Dog did not survive standing at the leg start"
        loc = dog.get_actor_location()
        err = math.hypot(loc.x - x, loc.y - y)
        if err > 300.0:
            return False, "the Dog is %.1f m from the leg start" % (err / 100.0)
        return True, "placed on floor z=%.0f" % z

    def drive_to(x, y, budget_s, allow_sidesteps=True):
        """Walk to (x, y) under the Dog's own power. Returns a dict with status ARRIVED / STUCK / TIMEOUT /
        DOG_GONE, the path's floor classes and the highest floor walked on."""
        out = {"target": [x, y], "sidesteps": 0, "max_floor": None, "min_floor": None, "samples": 0}
        t0 = time.time()
        dog = pawn()
        if dog is None:
            out["status"], out["why"] = "DOG_GONE", why_gone()
            return out
        loc = dog.get_actor_location()
        best = math.hypot(x - loc.x, y - loc.y)
        last_gain = time.time()
        last_sample = 0.0
        side_until, side_vec = 0.0, None
        while True:
            dog = pawn()
            if dog is None:
                out["status"], out["why"] = "DOG_GONE", why_gone()
                return out
            loc = dog.get_actor_location()
            dx, dy = x - loc.x, y - loc.y
            dist = math.hypot(dx, dy)
            now = time.time()
            if now - last_sample > 0.5:
                last_sample = now
                fz = floor_under(dog)
                out["samples"] += 1
                if fz is not None:
                    out["max_floor"] = fz if out["max_floor"] is None else max(out["max_floor"], fz)
                    out["min_floor"] = fz if out["min_floor"] is None else min(out["min_floor"], fz)
            if dist <= ARRIVE:
                out["status"] = "ARRIVED"
                out["seconds"] = round(now - t0, 1)
                out["at"] = [round(loc.x), round(loc.y), round(loc.z)]
                return out
            if dist < best - GAIN:
                best = dist
                last_gain = now
            if now - t0 > budget_s:
                # OUT OF TIME IS NOT BLOCKED. A heavy editor runs PIE at a fraction of real time, so a Dog still
                # gaining ground when the budget ends is SLOW (a harness/performance fact, re-run it), never STUCK.
                progressing = (now - last_gain) < STUCK_S
                out["status"] = "SLOW" if progressing else "TIMEOUT"
                out["at"] = [round(loc.x), round(loc.y), round(loc.z)]
                out["left_m"] = round(dist / 100.0, 1)
                out["seconds"] = round(now - t0, 1)
                return out
            if side_vec is None and now - last_gain > STUCK_S:
                heading = math.degrees(math.atan2(dy, dx))
                if not allow_sidesteps or out["sidesteps"] >= SIDESTEPS:
                    free, what = ahead(dog, heading)
                    out["status"] = "STUCK"
                    out["at"] = [round(loc.x), round(loc.y), round(loc.z)]
                    out["left_m"] = round(dist / 100.0, 1)
                    out["ahead"] = {"free_uu": round(free), "blocker": what}
                    out["floor_here"] = floor_under(dog)
                    out["seconds"] = round(now - t0, 1)
                    return out
                out["sidesteps"] += 1
                swing = [70.0, 110.0, 150.0][out["sidesteps"] - 1]
                left, _ = ahead(dog, heading + swing, 300.0)
                right, _ = ahead(dog, heading - swing, 300.0)
                h = math.radians(heading + (swing if left >= right else -swing))
                side_vec = (math.cos(h), math.sin(h))
                side_until = now + SIDESTEP_S
            if side_vec is not None:
                vx, vy = side_vec
                if now > side_until:
                    side_vec = None
                    last_gain = now
                    loc2 = dog.get_actor_location()
                    best = math.hypot(x - loc2.x, y - loc2.y)
            else:
                n = dist or 1.0
                vx, vy = dx / n, dy / n
            try:
                dog.add_movement_input(unreal.Vector(vx, vy, 0.0), 1.0, True)
            except Exception as err:                                  # noqa: BLE001
                out["status"], out["why"] = "DOG_GONE", ("input", str(err)[:120])
                return out
            yield TICK

    def sweep_free(dog, heading_deg, dist):
        """Free distance along a heading: three chest-height rays (centre and +-30 uu, so a gap narrower than the
        72 uu capsule reads as closed) and one knee-height ray (a wall too tall to step over). Returns
        (free_uu, blocker label)."""
        loc = dog.get_actor_location()
        h = math.radians(heading_deg)
        cx, cy = math.cos(h), math.sin(h)
        px, py = -cy, cx
        best, who = dist, None
        for (off, dz) in ((0.0, 40.0), (30.0, 40.0), (-30.0, 40.0), (0.0, -45.0)):
            a = unreal.Vector(loc.x + px * off, loc.y + py * off, loc.z + dz)
            b = unreal.Vector(a.x + cx * dist, a.y + cy * dist, a.z)
            t = trace(a, b, dog)
            if t is None:
                continue
            d = math.hypot(float(t[4].x) - a.x, float(t[4].y) - a.y)
            if d < best:
                best = d
                actor = t[9] if len(t) > 9 else None
                try:
                    who = str(actor.get_actor_label()) if actor is not None else "something"
                except Exception:                                     # noqa: BLE001
                    who = "something"
        return best, who

    def navigate_to(x, y, budget_s, arrive=ARRIVE):
        """BUG2 ON THE WORLD'S OWN COLLISION, under the Dog's own power. Head for the goal. On a blocker, follow
        its boundary with the wall on the right until the goal is in view again from a point closer than where
        the wall was met. Coming back round to the hit point means the goal cannot be reached from here:
        UNREACHABLE is a finding about the world, where the greedy walker's STUCK was only a limit of the
        walker. The walker's sidestep could never take a Dog round a 50 m castle."""
        out = {"target": [x, y], "mode_switches": 0, "hits": [], "navigator": "bug2"}
        t0 = time.time()
        mode, hit, heading, max_away = "GO", None, None, 0.0
        since_hit, last, last_move_t, tick = 0.0, None, time.time(), 0
        while True:
            dog = pawn()
            if dog is None:
                out["status"], out["why"] = "DOG_GONE", why_gone()
                return out
            loc = dog.get_actor_location()
            now = time.time()
            if last is not None:
                step = math.hypot(loc.x - last[0], loc.y - last[1])
                if mode == "FOLLOW":
                    since_hit += step
                if step > 3.0:
                    last_move_t = now
            last = (loc.x, loc.y)
            dgoal = math.hypot(x - loc.x, y - loc.y)
            here = [round(loc.x), round(loc.y), round(loc.z)]
            if dgoal <= arrive:
                out.update(status="ARRIVED", seconds=round(now - t0, 1), at=here, follow_m=round(since_hit / 100.0, 1))
                return out
            if now - t0 > budget_s:
                out.update(status="SLOW" if now - last_move_t < STUCK_S else "TIMEOUT", at=here,
                           left_m=round(dgoal / 100.0, 1), seconds=round(now - t0, 1))
                return out
            if now - last_move_t > 2.0 * STUCK_S:
                free, who = sweep_free(dog, heading if heading is not None else 0.0, 180.0)
                out.update(status="STUCK", at=here, left_m=round(dgoal / 100.0, 1),
                           ahead={"free_uu": round(free), "blocker": who}, seconds=round(now - t0, 1))
                return out
            gh = math.degrees(math.atan2(y - loc.y, x - loc.x))
            if tick % 4 == 0 or heading is None:                      # sense every ~0.2 s
                if mode == "GO":
                    free, who = sweep_free(dog, gh, 200.0)
                    if free >= min(200.0, dgoal):
                        heading = gh
                    else:
                        mode = "FOLLOW"
                        out["mode_switches"] += 1
                        hit = (loc.x, loc.y, dgoal)
                        since_hit = 0.0
                        max_away = 0.0
                        heading = gh + 90.0                           # turn left: the wall on the right
                        out["hits"].append({"at": here[:2], "blocker": who})
                else:
                    free_g, _ = sweep_free(dog, gh, 200.0)
                    away = math.hypot(loc.x - hit[0], loc.y - hit[1])
                    max_away = max(max_away, away)
                    if free_g >= min(200.0, dgoal) and dgoal < hit[2] - 100.0:
                        mode = "GO"
                        out["mode_switches"] += 1
                        heading = gh
                    else:
                        # WALL ON THE RIGHT, HELD AT ~1 m. The first version chose the first free heading from
                        # "hard right": met from 1.8 m, the wall was never within its 1.5 m probe, so it turned
                        # right every step and circled on the spot -- and the circle tripped the loop test (walk_sim).
                        ahead_free, _ = sweep_free(dog, heading, 200.0)
                        right_free, _ = sweep_free(dog, heading - 90.0, 300.0)
                        if ahead_free < 120.0:
                            heading += 60.0                           # wall ahead: turn left
                        elif right_free < 70.0:
                            heading += 20.0                           # too close: veer left
                        elif right_free > 250.0:
                            heading -= 35.0                           # the wall fell away: round the corner right
                        # else: follow
                        boxed = all(sweep_free(dog, heading + k, 120.0)[0] < 120.0 for k in (0.0, 90.0, 180.0, 270.0))
                        if boxed:
                            out.update(status="STUCK", at=here, left_m=round(dgoal / 100.0, 1),
                                       ahead={"free_uu": 0, "blocker": "boxed in"}, seconds=round(now - t0, 1))
                            return out
                        # a LOOP is coming back to the hit point after having been well away from it; dithering
                        # beside the hit point is not a loop
                        if since_hit > 1500.0 and max_away > 500.0 and away < 150.0:
                            out.update(status="UNREACHABLE", at=here, left_m=round(dgoal / 100.0, 1),
                                       loop_m=round(since_hit / 100.0, 1), seconds=round(now - t0, 1),
                                       why="followed the boundary back round to where it was met")
                            return out
            tick += 1
            h = math.radians(heading)
            try:
                dog.add_movement_input(unreal.Vector(math.cos(h), math.sin(h), 0.0), 1.0, True)
            except Exception as err:                                  # noqa: BLE001
                out["status"], out["why"] = "DOG_GONE", ("input", str(err)[:120])
                return out
            yield TICK

    def measure_stand(name, x, y, leg, arrived):
        st = {"stand": name, "leg": leg["id"], "reached_on_foot": arrived, "target": [x, y]}
        RESULT["stands"].append(st)
        dog = pawn()
        if dog is None:
            st["error"] = why_gone()
            return
        yield 0.4
        began_s = time.time()
        st["streaming_complete"] = None
        while time.time() - began_s < 20.0:
            try:
                st["streaming_complete"] = bool(L.is_world_partition_streaming_complete(live()))
            except Exception as exc:                                  # noqa: BLE001
                st["streaming_error"] = repr(exc)[:160]
                break
            if st["streaming_complete"]:
                break
            yield 0.25
        st["streaming_wait_s"] = round(time.time() - began_s, 1)
        dog = pawn()
        if dog is None:
            st["error"] = why_gone()
            return
        loc = dog.get_actor_location()
        st["dog_at"] = [round(loc.x), round(loc.y), round(loc.z)]
        fz = floor_under(dog)
        st["floor_z"] = None if fz is None else round(fz, 1)
        try:
            mv = dog.character_movement
            st["movement_mode"] = str(mv.movement_mode)
            st["falling"] = bool(mv.is_falling())
        except Exception:                                             # noqa: BLE001
            st["movement_mode"] = "unreadable"
        if fz is None:
            st["surface"] = "NO FLOOR"
        elif fz > leg["ground"] + HIGH_ABOVE:
            st["surface"] = "STRUCTURE (%.1f m above the leg's ground)" % ((fz - leg["ground"]) / 100.0)
        else:
            st["surface"] = "walking surface"
        # RESIDENCY: two readings a second apart must agree before the count is believed (8 s cap).
        want = authored.get(name)
        st["authored"] = want
        prev, got, agreed = None, None, False
        t1 = time.time()
        while time.time() - t1 < 8.0:
            got = _count_boxes(live(), {name: (x, y)}).get(name)
            if prev is not None and got == prev:
                agreed = True
                break
            prev = got
            yield 1.0
        st["resident"] = got
        st["resident_settled"] = agreed
        pwant = paving_authored.get(name)
        if pwant is not None:
            pprev, pgot, pagreed = None, None, False
            t2 = time.time()
            while time.time() - t2 < 8.0:
                pgot = _count_boxes(live(), {name: (x, y)}, mesh_filter=paving_filter).get(name)
                if pprev is not None and pgot == pprev:
                    pagreed = True
                    break
                pprev = pgot
                yield 1.0
            st["paving"] = {"filter": paving_filter, "authored": pwant, "resident": pgot, "settled": pagreed}
        if want is not None and got is not None and want >= JUDGE_MIN:
            st["resident_ratio"] = round(got / float(want), 3)
        if H is not None:
            try:
                path = os.path.join(OUT, "%02d_%s.jpg" % (len(RESULT["stands"]), name))
                H.capture_viewport_jpeg(path, 1280, 85)
                st["capture"] = path
            except Exception as exc:                                  # noqa: BLE001
                st["capture_error"] = repr(exc)[:120]

    # ---- J01: CAN THE HARNESS DRIVE THIS DOG AT ALL?
    dog = pawn()
    if dog is None:
        RESULT["status"] = "BLOCKED: no pawn after PIE began"
        for tid, _ in CLAUSES:
            if tid not in ran:
                withhold(tid, "no pawn")
        return True
    # CORE 2026-09-29: put the Dog in MOVE_WALKING before probing, as zc_trail_walk does after its placement. That
    # job drove the Dog at a full 229 cm/s with the editor in the background, while this probe (at spawn, straight
    # after PIE began) failed three times in the same state: the arrival flow can leave movement held until the
    # viewport has focus. Recorded either way, so the change is visible in the result.
    try:
        RESULT["movement_mode_at_spawn"] = str(dog.character_movement.movement_mode)
        dog.character_movement.set_movement_mode(unreal.MovementMode.MOVE_WALKING)
        RESULT["movement_mode_set"] = str(dog.character_movement.movement_mode)
    except Exception as exc:                                              # noqa: BLE001
        RESULT["movement_mode_error"] = repr(exc)[:120]
    yield 1.0
    dog = pawn() or dog
    spawn = dog.get_actor_location()
    RESULT["spawn"] = [round(spawn.x), round(spawn.y), round(spawn.z)]
    moved_after, nonzero, t, peak = None, 0, 0.0, 0.0
    t_probe = time.time()
    while t < 8.0:
        d = pawn()
        if d is None:
            break
        try:
            d.add_movement_input(unreal.Vector(0.0, 1.0, 0.0), 1.0, True)
            v = d.get_velocity()
            peak = max(peak, math.hypot(v.x, v.y))
            if math.hypot(v.x, v.y) > 1.0:
                nonzero += 1
                moved_after = round(t, 2) if moved_after is None else moved_after
        except Exception:                                             # noqa: BLE001
            break
        yield 0.05
        t += 0.05
        # STOP ON DISTANCE, NOT ON A SAMPLE COUNT. Breaking after 12 moving samples (0.6 s) demanded full walking
        # speed: at a heavy editor's 30% the Dog had covered ~41 uu and the probe failed a Dog that walks
        # (found by walk_sim's slow_editor scenario). Drive until it has covered 100 uu, up to 8 s.
        d2 = pawn()
        if d2 is not None and nonzero >= 12 and math.hypot(d2.get_actor_location().x - spawn.x,
                                                           d2.get_actor_location().y - spawn.y) >= 100.0:
            break
    d = pawn()
    moved = math.hypot(d.get_actor_location().x - spawn.x, d.get_actor_location().y - spawn.y) if d else 0.0
    actuator_ok = moved >= 100.0 and nonzero >= 12
    probe_wall_s = max(0.05, time.time() - t_probe)
    # WAS THE EDITOR THE FOREGROUND WINDOW? jq_ring_arc_1's probe failed (2 moving samples in 8 s) while a
    # diagnostic 17 minutes later drove the Dog at a full 230 uu/s: the condition is transient, so every run
    # records it beside the probe.
    try:
        import ctypes
        from ctypes import wintypes
        fg_pid = wintypes.DWORD()
        ctypes.windll.user32.GetWindowThreadProcessId(ctypes.windll.user32.GetForegroundWindow(), ctypes.byref(fg_pid))
        RESULT["editor_foreground_at_probe"] = int(fg_pid.value) == os.getpid()
        # MINIMIZED runs the channel at ~3 ticks/s against ~31 restored (CORE, 2026-09-29): recorded per run
        found = []
        proc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

        def _each(h, _l):
            pid = wintypes.DWORD()
            ctypes.windll.user32.GetWindowThreadProcessId(h, ctypes.byref(pid))
            if int(pid.value) == os.getpid() and (ctypes.windll.user32.IsWindowVisible(h) or ctypes.windll.user32.IsIconic(h)):
                found.append(h)
            return True
        ctypes.windll.user32.EnumWindows(proc(_each), 0)
        RESULT["editor_minimized_at_probe"] = any(bool(ctypes.windll.user32.IsIconic(h)) for h in found)
    except Exception as exc:                                          # noqa: BLE001
        RESULT["editor_foreground_at_probe"] = "unreadable: %s" % str(exc)[:60]
    RESULT["dog_speed"] = {"peak_uu_s": round(peak, 1), "effective_uu_s": round(moved / probe_wall_s, 1),
                           "note": "effective = distance over WALL time; a heavy editor runs PIE slower than real time"}
    record("J01", actuator_ok, moved_uu=round(moved), samples_with_speed=nonzero, moved_after_s=moved_after,
           peak_speed_uu_s=round(peak, 1), effective_speed_uu_s=round(moved / probe_wall_s, 1))

    # ---- A CRAWLING EDITOR IS NOT A WORLD FINDING. Minimized, the editor ran PIE at ~10% of real time (07:3x,
    # 2026-09-29: jq_ring_arc_1 crawled; restored and in the foreground it walked 224 uu/s). Every leg would then
    # time out over half an hour of the shared editor and prove nothing. Stop at once, judge nothing, say why.
    # A heavy but restored editor (walk_sim slow_editor, 30%: ~67 uu/s) stays well above the limit.
    crawl_uu_s = 40.0
    effective = moved / probe_wall_s
    if actuator_ok and (RESULT.get("editor_minimized_at_probe") is True or effective < crawl_uu_s):
        why = ("the editor is crawling (minimized=%s, effective %.0f uu/s; healthy ~224, limit %.0f): restore the "
               "editor window and re-run. Nothing was judged" % (RESULT.get("editor_minimized_at_probe"), effective,
                                                                 crawl_uu_s))
        RESULT["status"] = "BLOCKED: " + why
        for tid, _ in CLAUSES:
            if tid not in ran:
                withhold(tid, why)
        return True

    # ---- J00: THE POSITIVE CONTROL. A walk verdict from a detector that cannot see a wall is not a verdict.
    control_ok = None
    tried = []
    if actuator_ok:
        for c in CONTROLS:
            ok, why = yield from place(c["start"][0], c["start"][1], 0.0)
            if not ok:
                tried.append({"control": c["name"], "skipped": "not placed: %s" % why})
                continue
            d = pawn()
            if d is None:
                tried.append({"control": c["name"], "skipped": "no pawn"})
                continue
            here = d.get_actor_location()
            path_len = math.hypot(c["target"][0] - here.x, c["target"][1] - here.y)
            heading = math.degrees(math.atan2(c["target"][1] - here.y, c["target"][0] - here.x))
            free, blocker = ahead(d, heading, path_len)
            if blocker is None:
                tried.append({"control": c["name"], "skipped": "no blocker traced on its path; not a control"})
                continue
            # TIME TO MEET THE WALL AT A SLOW EDITOR'S SPEED, then the stuck window: a fixed 9 s ran out while a
            # 30%-speed Dog was still walking toward the wall (walk_sim slow_editor), and the control failed on a
            # detector that was never given the chance to see the wall.
            r = yield from drive_to(c["target"][0], c["target"][1],
                                    max(c["seconds"], path_len / 30.0 + STUCK_S + 10.0), False)
            d = pawn()
            y_now = d.get_actor_location().y if d is not None else None
            passed = (r.get("status") == "ARRIVED") or (y_now is not None and y_now > c["line"] + 60.0)
            control_ok = (not passed) and r.get("status") in ("STUCK", "TIMEOUT")
            record("J00", control_ok, control=c["name"], traced_blocker=blocker, traced_free_uu=round(free),
                   walk=r, dog_y=None if y_now is None else round(y_now), tried=tried)
            break
        if control_ok is None:
            withhold("J00", "no control candidate had a traced blocker: %s" % json.dumps(tried, default=str))
    else:
        withhold("J00", "the actuator probe failed; the control cannot run")

    trust_walks = bool(actuator_ok and control_ok)
    gone = []
    # ---- THE LEGS.
    for leg in LEGS:
        row = {"name": leg["name"], "reached": [], "failed_at": None}
        RESULT["legs"][leg["id"]] = row
        pts = leg["points"]
        first = pts[0]
        ok, why = yield from place(float(first[1]), float(first[2]), leg["ground"])
        row["placed"] = why
        if not ok:
            row["failed_at"] = {"waypoint": first[0], "status": "NOT_PLACED", "why": why}
            # A DOG THAT DIED BETWEEN LEGS IS STILL A DEAD DOG. Found by the offline sim: a Dog destroyed while
            # being placed was recorded only as "not placed", and J02 passed on a world with no Dog in it.
            gw = why_gone()
            if gw[0] != "neither":
                gone.append((leg["id"], first[0], gw))
            continue
        if first[3] == "stand":
            # PLACED, NOT WALKED: measured for streaming, residency and surface, never counted as reached on foot.
            yield from measure_stand(first[0], float(first[1]), float(first[2]), leg, "placed")
        for (nm, x, y, kind) in pts[1:]:
            here = pawn()
            if here is None:
                row["failed_at"] = {"waypoint": nm, "status": "DOG_GONE", "why": why_gone()}
                gone.append((leg["id"], nm, why_gone()))
                break
            loc = here.get_actor_location()
            if kind == "nav":
                # A FAR TARGET THROUGH BUILT GROUND: the Bug2 navigator, not the greedy walker. UNREACHABLE (a
                # boundary followed all the way round) is a world finding; the greedy walker's STUCK was not.
                r = yield from navigate_to(float(x), float(y), 420.0 + math.hypot(x - loc.x, y - loc.y) / 30.0,
                                           locals().get("arrive", ARRIVE))
                r["waypoint"] = nm
                if r["status"] != "ARRIVED":
                    row["failed_at"] = row["failed_at"] or r
                    if r["status"] == "DOG_GONE":
                        gone.append((leg["id"], nm, r.get("why")))
                    break
                row["reached"].append({"waypoint": nm, "seconds": r.get("seconds"), "sidesteps": 0,
                                       "navigator": "bug2", "follow_m": r.get("follow_m"), "hits": r.get("hits")})
                yield from measure_stand(nm, float(x), float(y), leg, True)
                continue
            budget = math.hypot(x - loc.x, y - loc.y) / 30.0 + 60.0   # down to 0.3 m/s: a slow editor is not a blocked route
            r = yield from drive_to(float(x), float(y), budget)
            r["waypoint"] = nm
            if r["status"] != "ARRIVED":
                row["failed_at"] = r
                if r["status"] == "DOG_GONE":
                    gone.append((leg["id"], nm, r.get("why")))
                if kind == "stand":
                    yield from measure_stand(nm, float(x), float(y), leg, False)
                break
            row["reached"].append({"waypoint": nm, "seconds": r.get("seconds"), "sidesteps": r["sidesteps"],
                                   "max_floor": r.get("max_floor"), "min_floor": r.get("min_floor")})
            if kind == "stand":
                yield from measure_stand(nm, float(x), float(y), leg, True)

    # ---- THE CLAUSES.
    gw = why_gone()
    if gw[0] != "neither":
        gone.append(("end_of_walk", None, gw))
    record("J02", not gone, destroyed_or_torn=gone)
    stands = RESULT["stands"]
    measured = [s for s in stands if "error" not in s]
    no_stream = [s["stand"] for s in measured if s.get("streaming_complete") is not True]
    record("J03", bool(measured) and not no_stream, stands=len(measured), not_complete=no_stream)
    judged = [s for s in measured if "resident_ratio" in s]
    short = [(s["stand"], s["resident"], s["authored"]) for s in judged
             if s["resident_ratio"] < RESIDENT_MIN or not s.get("resident_settled")]
    record("J04", bool(judged) and not short, judged=len(judged), short=short,
           note="a stand with fewer than %d authored pieces in its 20 m box is not judged" % JUDGE_MIN)
    off_foot = [s["stand"] for s in stands if s.get("reached_on_foot") is False]
    high = [(s["stand"], s.get("surface")) for s in measured if s.get("surface") != "walking surface"]
    record("J05", bool(stands) and not off_foot and not high, stands=len(stands), not_on_foot=off_foot,
           not_walking_surface=high)
    for leg in LEGS:
        row = RESULT["legs"][leg["id"]]
        if not trust_walks:
            withhold(leg["clause"], "actuator ok=%s, control ok=%s: a walk verdict needs both" % (actuator_ok, control_ok))
            continue
        misses = row.get("gaps") or ([row["failed_at"]] if row.get("failed_at") else [])
        if misses and all(m.get("status") == "SLOW" for m in misses):
            # OUT OF TIME WHILE STILL GAINING GROUND is the editor's speed, not the world's: never a FAIL. Only when
            # EVERY miss on the leg is SLOW; a real blockage elsewhere on the leg still fails it.
            withhold(leg["clause"], "SLOW at %s: the Dog was still gaining ground when the budget ended; re-run with "
                     "the editor restored" % [m.get("waypoint") for m in misses])
            continue
        record(leg["clause"], row["failed_at"] is None, reached=[p["waypoint"] for p in row["reached"]],
               failed_at=row["failed_at"])
    # ---- THE FOUNDER'S WALK CLASS, per leg (2026-09-29): SELF-POWERED / MIXED / NOT WALKED, and how it started.
    for lid, row in RESULT["legs"].items():
        mid = [g.get("waypoint") for g in (row.get("gaps") or [])
               if g.get("placed_past_gap") or g.get("placed_past_gap_at")]
        fa = row.get("failed_at") or {}
        if fa.get("status") == "NOT_PLACED":
            row["walk_class"] = "NOT WALKED"
        elif mid:
            row["walk_class"] = "MIXED"
            row["placed_mid_leg_at"] = mid
        else:
            row["walk_class"] = "SELF-POWERED"
        row["start_placed_by"] = "the game's travel" if (row.get("travel") or {}).get("arrived") else "teleport"
    RESULT["walk_class_rule"] = ("SELF-POWERED: after the start placement every metre was walked by movement input. "
                                 "MIXED: the Dog was placed past a gap mid-leg (named). The start of every leg is "
                                 "placed: a teleport, or the game's own travel.")
    missing = [tid for tid, _ in CLAUSES if tid != "J99" and tid not in ran]
    record("J99", not missing, missing=missing)
    fails = [t["id"] for t in tests if not t["pass"]]
    RESULT["status"] = "walked: %d clauses, %d not passing (%s)" % (len(tests), len(fails), ",".join(fails))
    with open(os.path.join(OUT, "zzJ01_result_copy.json"), "w", encoding="utf-8") as f:
        json.dump(RESULT, f, indent=1, default=str)
    return True


def _mesh_name(comp):
    for get in (lambda c: c.get_editor_property("static_mesh"), lambda c: c.static_mesh):
        try:
            m = get(comp)
            return m.get_name() if m is not None else ""
        except Exception:                                             # noqa: BLE001
            continue
    return None


def _count_boxes(world, boxes, mesh_filter=None):
    """For each named (x, y), the world's own content in a 20 m box: static mesh actors by location plus the
    instances of WonderlandInstancedBatch components whose bounds touch the box. Characters are never counted.
    With mesh_filter, only meshes whose name contains it (a lane's own stones); an unreadable mesh is not counted."""
    out = {name: 0 for name in boxes}
    if world is None:
        return {name: None for name in boxes}
    rects = {name: (x - STAND_HALF, x + STAND_HALF, y - STAND_HALF, y + STAND_HALF) for name, (x, y) in boxes.items()}
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.StaticMeshActor):
        try:
            v = a.get_actor_location()
        except Exception:                                             # noqa: BLE001
            continue
        if mesh_filter is not None:
            try:
                mn = _mesh_name(a.static_mesh_component)
            except Exception:                                         # noqa: BLE001
                mn = None
            if not mn or mesh_filter not in mn:
                continue
        for name, (lx, hx, ly, hy) in rects.items():
            if lx <= v.x < hx and ly <= v.y < hy:
                out[name] += 1
    if BATCH is None:
        return {name: None for name in boxes}
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, BATCH):
        try:
            comps = a.get_components_by_class(unreal.InstancedStaticMeshComponent)
        except Exception:                                             # noqa: BLE001
            continue
        for comp in comps:
            if mesh_filter is not None:
                mn = _mesh_name(comp)
                if not mn or mesh_filter not in mn:
                    continue
            try:
                o, e = unreal.SystemLibrary.get_component_bounds(comp)[:2]
            except Exception:                                         # noqa: BLE001
                continue
            touching = [name for name, (lx, hx, ly, hy) in rects.items()
                        if not (o.x + e.x < lx or o.x - e.x >= hx or o.y + e.y < ly or o.y - e.y >= hy)]
            if not touching:
                continue
            try:
                count = int(comp.get_instance_count())
            except Exception:                                         # noqa: BLE001
                continue
            for i in range(count):
                try:
                    v = comp.get_instance_transform(i, world_space=True).translation
                except Exception:                                     # noqa: BLE001
                    break
                for name in touching:
                    lx, hx, ly, hy = rects[name]
                    if lx <= v.x < hx and ly <= v.y < hy:
                        out[name] += 1
    return out
