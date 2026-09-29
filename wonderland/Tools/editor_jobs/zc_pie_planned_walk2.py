# PIE-PLANNED WALK v2 (CORE 2026-09-29, the avenues): A* on PLAY-WORLD collision with a Character-faithful clearance
# test, then a SELF-POWERED walk of the plan -- and, when the Dog stops, a diagnosis of what stopped it.
#
# v1 (zc_pie_planned_walk) compared the floor z of neighbouring 0.5 m cells against 45 cm and tested a capsule 4 cm
# above the floor. Three faults showed on the avenues:
#   * a target inside an obstacle (AV01's paved line runs through CP02's 15 m stone ring base) could never be planned;
#   * the floor trace started at z 2500, so an arch or a gate over the way read as a wall;
#   * one 45 cm step check lets a 31-45 cm ledge into the plan (BP_RelayDog_C's MaxStepHeight is 30).
# v2:
#   * floor(x, y, zref) traces from zref + 200 down to zref - 400: the surface the Dog would stand on, not a roof.
#   * a cell is free when a Pawn-profile capsule whose bottom sits STEP cm above that floor overlaps nothing -- what
#     CharacterMovement's step-up allows (anything lower than MaxStepHeight is stepped onto).
#   * a move between neighbours also samples the floor at its midpoint, and each half may rise (and, SYMMETRIC, fall)
#     no more than STEP: a ledge the Dog could only drop off is not a connection.
#   * a blocked target snaps to the nearest free cell within SNAP cm (recorded as goal_snapped_cm).
#   * A* with an octile heuristic; a pair that fails is retried once in a wider box.
#   * the walk: ONE placement per leg, then forced input along the plan (SELF-POWERED). If the Dog stops gaining for
#     STUCK game-seconds the stop is DIAGNOSED -- a 10 cm floor profile ahead (z and surface owner at every change) and
#     eight Pawn-profile sweeps round the Dog, naming the instance hit -- and, with RESUME, the Dog is placed at the plan
#     point 10 m on. A leg with a stop is NOT a proof (it is then MIXED); the stop list is the verdict, and one run
#     finds every stop on the leg instead of only the first.
# v2.1 (after the first nation run, 13:43): the Noctis walk snagged at a narrow arcade gap the plan had squeezed
# through diagonally, and a resume set the Dog down on top of a 3 m glass screen. Now: a diagonal move needs both of
# its orthogonal cells free (no corner cutting); cells are cleared for PLAN_RADIUS (48 cm, the Dog's 36 + 12) so a plan
# keeps off walls; the midpoint of every move is cleared too; failing pairs retry in an 80 m box; and every plan
# point carries its planned floor z, which a resume placement uses instead of tracing down onto whatever is highest.
# Globals: LEGS = [{"id": str, "points": [[x, y], ...]}, ...]; RESUME (True). PIE-owning: CONCURRENT is False.
CONCURRENT = False
import heapq
import math

L = unreal.WonderlandUiTestLibrary
LEGS = globals().get("LEGS", [])
RESUME = globals().get("RESUME", True)
CELL = globals().get("CELL", 50.0)
MARGIN = globals().get("MARGIN", 1500.0)
MARGIN_WIDE = globals().get("MARGIN_WIDE", 8000.0)
SNAP = globals().get("SNAP", 1200.0)
MAX_EXPAND = globals().get("MAX_EXPAND", 200000)
MAX_STOPS = globals().get("MAX_STOPS", 12)
RADIUS, HALF = 36.0, 87.0            # BP_RelayDog_C's capsule, measured in PIE (zc2E_11): 35.9 / 87.1
PLAN_RADIUS = globals().get("PLAN_RADIUS", 48.0)   # planning clearance: the Dog's radius + 12 cm off every wall
STEP = globals().get("STEP", 30.0)   # BP_RelayDog_C MaxStepHeight (zc2E_11)
SYMMETRIC = globals().get("SYMMETRIC", True)
ARRIVE = 80.0
STUCK = 6.0
PAWN = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2
NB8 = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1))


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    found = unreal.SystemLibrary.get_console_variable_float_value("wl.Sky.DayMinutes")
    RESULT["status"] = "running"
    RESULT["proof_class"] = ("SELF-POWERED per leg with no stop (one placement, route planned on play-world "
                             "collision); a leg with a stop was resumed by placement and is MIXED")
    L.set_background_throttle_suspended(True)
    try:
        yield from _run(ues, les)
    finally:
        unreal.SystemLibrary.execute_console_command(ues.get_editor_world(), "wl.Sky.DayMinutes %s" % found)
        if ues.get_game_world() is not None:
            les.editor_request_end_play()
            while ues.get_game_world() is not None:
                yield 1.0


def _run(ues, les):
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    t = 0.0
    while ues.get_game_world() is None and t < 60.0:
        yield 1.0
        t += 1.0
    world = lambda: ues.get_game_world()

    def pawn():
        w = world()
        if w is None:
            return None
        try:
            p = unreal.GameplayStatics.get_player_pawn(w, 0)
            if p is not None:
                p.get_actor_location()
            return p
        except Exception:                                              # noqa: BLE001
            return None
    t = 0.0
    while pawn() is None and t < 30.0:
        yield 0.5
        t += 0.5
    if pawn() is None:
        RESULT["status"] = "BLOCKED: no pawn"
        return
    unreal.SystemLibrary.execute_console_command(world(), "wl.Sky.DayMinutes 0")
    ignore = lambda: [p for p in (pawn(),) if p is not None]

    def trace_down(x, y, top, bottom):
        hit = unreal.SystemLibrary.line_trace_single(world(), unreal.Vector(x, y, top), unreal.Vector(x, y, bottom),
                                                     PAWN, False, ignore(), unreal.DrawDebugTrace.NONE, True,
                                                     unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        return None if hit is None else hit.to_tuple()

    fcache, ccache = {}, {}

    def floor(x, y, zref):
        key = (round(x), round(y), int(math.floor((zref + 50.0) / 100.0)))
        if key not in fcache:
            t_ = trace_down(x, y, zref + 200.0, zref - 400.0)
            fcache[key] = None if t_ is None else float(t_[4].z)
        return fcache[key]

    def blocker(x, y, z, bottom_above=STEP + 1.0, radius=PLAN_RADIUS):
        """None when a Pawn capsule standing on z (bottom bottom_above cm up) overlaps nothing, else what it hits."""
        c = z + bottom_above + HALF
        hit = unreal.SystemLibrary.capsule_trace_single_by_profile(world(), unreal.Vector(x, y, c),
                                                                  unreal.Vector(x, y, c + 1.0), radius, HALF, "Pawn",
                                                                  False, ignore(), unreal.DrawDebugTrace.NONE, True,
                                                                  unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        if hit is None:
            return None
        t_ = hit.to_tuple()
        return t_[9].get_actor_label() if t_[9] is not None else "?"

    def free(x, y, z):
        key = (round(x), round(y), round(z))
        if key not in ccache:
            ccache[key] = blocker(x, y, z) is None
        return ccache[key]

    def step_ok(za, zb):
        rise = zb - za
        return rise <= STEP and (-rise <= STEP if SYMMETRIC else -rise <= 400.0)

    def instance_of(t_):
        """Name the thing a hit tuple struck: actor label, and for an instanced component the instance's mesh + spot."""
        out = {"actor": t_[9].get_actor_label() if t_[9] is not None else None}
        comp = t_[10]
        try:
            out["component"] = comp.get_name() if comp is not None else None
            if comp is not None and isinstance(comp, unreal.InstancedStaticMeshComponent):
                item = int(t_[13])
                tr = comp.get_instance_transform(item, True)
                sm = comp.get_editor_property("static_mesh")
                out["instance"] = item
                out["mesh"] = sm.get_name() if sm is not None else None
                out["at"] = [round(tr.translation.x), round(tr.translation.y), round(tr.translation.z)]
                out["yaw"] = round(tr.rotation.rotator().yaw, 1)
            elif comp is not None and isinstance(comp, unreal.StaticMeshComponent):
                sm = comp.get_editor_property("static_mesh")
                out["mesh"] = sm.get_name() if sm is not None else None
        except Exception as exc:                                       # noqa: BLE001
            out["name_error"] = repr(exc)[:80]
        return out

    def diagnose(dog, heading):
        loc = dog.get_actor_location()
        feet = loc.z - HALF
        h = math.radians(heading)
        prof, last = [], None
        for k in range(0, 41):
            d = k * 10.0
            x, y = loc.x + math.cos(h) * d, loc.y + math.sin(h) * d
            t_ = trace_down(x, y, feet + 200.0, feet - 400.0)
            z = None if t_ is None else round(float(t_[4].z), 1)
            lab = None if t_ is None or t_[9] is None else t_[9].get_actor_label()
            if last is None or z is None or last[0] is None or abs(z - last[0]) > 3.0 or lab != last[1]:
                prof.append([d, z, lab])
            last = (z, lab)
        fan = []
        for a in range(0, 360, 45):
            ha = math.radians(heading + a)
            s = unreal.Vector(loc.x, loc.y, loc.z + 2.0)
            e = unreal.Vector(loc.x + math.cos(ha) * 100.0, loc.y + math.sin(ha) * 100.0, loc.z + 2.0)
            hit = unreal.SystemLibrary.capsule_trace_single_by_profile(world(), s, e, RADIUS - 1.0, HALF - 1.0, "Pawn",
                                                                      False, ignore(), unreal.DrawDebugTrace.NONE, True,
                                                                      unreal.LinearColor.RED, unreal.LinearColor.GREEN,
                                                                      0.0)
            if hit is None:
                continue
            t_ = hit.to_tuple()
            row = {"rel_deg": a, "dist": round(float(t_[3]), 1), "start_pen": bool(t_[1]),
                   "impact_z": round(float(t_[5].z), 1), "normal_z": round(float(t_[7].z), 2)}
            row.update(instance_of(t_))
            fan.append(row)
        return {"feet_z": round(feet, 1), "heading": round(heading, 1), "profile": prof, "fan": fan,
                "movement_mode": str(dog.character_movement.movement_mode)}

    def plan(a, b, zhint, margin):
        """A* from a to b on a CELL grid inside the pair's box +/- margin. Returns a dict (path or failure facts)."""
        x0, x1 = min(a[0], b[0]) - margin, max(a[0], b[0]) + margin
        y0, y1 = min(a[1], b[1]) - margin, max(a[1], b[1]) + margin
        nx, ny = int((x1 - x0) / CELL) + 1, int((y1 - y0) / CELL) + 1
        ij = lambda p: (int(round((p[0] - x0) / CELL)), int(round((p[1] - y0) / CELL)))
        xy = lambda c: (x0 + c[0] * CELL, y0 + c[1] * CELL)
        inside = lambda c: 0 <= c[0] < nx and 0 <= c[1] < ny

        def snap(c, zref):
            """The nearest free cell to c within SNAP (rings outward), with its floor z; None if there is none."""
            for rr in range(0, int(SNAP / CELL) + 1):
                ring = [(c[0] + di, c[1] + dj) for di in range(-rr, rr + 1) for dj in range(-rr, rr + 1)
                        if max(abs(di), abs(dj)) == rr]
                ring.sort(key=lambda q: math.hypot(q[0] - c[0], q[1] - c[1]))
                for q in ring:
                    if not inside(q):
                        continue
                    z = floor(*xy(q), zref)
                    if z is not None and free(*xy(q), z):
                        return q, z
            return None
        yield 0.0
        got_s = snap(ij(a), zhint)
        if got_s is None:
            return {"ok": False, "why": "no free cell near the start", "at": [round(a[0]), round(a[1])]}
        s, zs = got_s
        got_g = snap(ij(b), zs)
        if got_g is None:
            return {"ok": False, "why": "no free cell near the goal", "at": [round(b[0]), round(b[1])]}
        g = got_g[0]
        hd = lambda c: (max(abs(c[0] - g[0]), abs(c[1] - g[1])) + 0.41421356 * min(abs(c[0] - g[0]), abs(c[1] - g[1])))
        openh = [(hd(s), 0.0, s)]
        gcost, prev, zc, closed = {s: 0.0}, {s: None}, {s: zs}, set()
        best, n = (hd(s), s), 0
        while openh:
            f, gc, c = heapq.heappop(openh)
            if c in closed:
                continue
            closed.add(c)
            if c == g:
                break
            if hd(c) < best[0]:
                best = (hd(c), c)
            n += 1
            if n > MAX_EXPAND:
                break
            if n % 300 == 0:
                yield 0.0
            xa, ya = xy(c)
            za = zc[c]

            def open_cell(q):
                if not inside(q):
                    return False
                zq = floor(*xy(q), za)
                return zq is not None and abs(zq - za) <= STEP and free(*xy(q), zq)
            for di, dj in NB8:
                nb = (c[0] + di, c[1] + dj)
                if nb in closed or not inside(nb):
                    continue
                if di and dj and not (open_cell((c[0] + di, c[1])) and open_cell((c[0], c[1] + dj))):
                    continue                                         # no corner cutting
                xb, yb = xy(nb)
                zb = floor(xb, yb, za)
                if zb is None or not free(xb, yb, zb):
                    continue
                xm, ym = (xa + xb) * 0.5, (ya + yb) * 0.5
                zm = floor(xm, ym, za)
                if zm is None or not step_ok(za, zm) or not step_ok(zm, zb) or not free(xm, ym, zm):
                    continue
                ng = gc + (1.41421356 if di and dj else 1.0)
                if ng < gcost.get(nb, 1e18):
                    gcost[nb], prev[nb], zc[nb] = ng, c, zb
                    heapq.heappush(openh, (ng + hd(nb), ng, nb))
        out = {"expanded": n, "start_snapped_cm": round(math.hypot(xy(s)[0] - a[0], xy(s)[1] - a[1])),
               "goal_snapped_cm": round(math.hypot(xy(g)[0] - b[0], xy(g)[1] - b[1]))}
        if g not in prev:
            fb = xy(best[1])
            near = {}
            for di in range(-6, 7):
                for dj in range(-6, 7):
                    q = (best[1][0] + di, best[1][1] + dj)
                    if not inside(q):
                        continue
                    z = floor(*xy(q), zc.get(best[1], zs))
                    if z is None:
                        near["(no floor)"] = near.get("(no floor)", 0) + 1
                        continue
                    lab = blocker(*xy(q), z)
                    if lab is not None:
                        near[lab] = near.get(lab, 0) + 1
            out.update({"ok": False, "why": "no way within the box" if n <= MAX_EXPAND else "expansion cap",
                        "frontier": [round(fb[0]), round(fb[1]), round(zc.get(best[1], zs))],
                        "frontier_to_goal_m": round(best[0] * CELL / 100.0, 1),
                        "blockers_near_frontier": sorted(near.items(), key=lambda kv: -kv[1])[:6]})
            return out
        cells, c = [], g
        while c is not None:
            cells.append(c)
            c = prev[c]
        cells.reverse()
        # keep every corner and at least one point per 3 m, so the walk never cuts a corner the plan went round
        keep = [cells[0]]
        for k in range(1, len(cells) - 1):
            d_in = (cells[k][0] - cells[k - 1][0], cells[k][1] - cells[k - 1][1])
            d_out = (cells[k + 1][0] - cells[k][0], cells[k + 1][1] - cells[k][1])
            far = math.hypot(cells[k][0] - keep[-1][0], cells[k][1] - keep[-1][1]) * CELL >= 300.0
            if d_in != d_out or far:
                keep.append(cells[k])
        keep.append(cells[-1])
        out.update({"ok": True, "path": [xy(q) + (zc[q],) for q in keep], "z_end": zc[g],
                    "length_m": round(sum(math.hypot(cells[k][0] - cells[k - 1][0], cells[k][1] - cells[k - 1][1])
                                          for k in range(1, len(cells))) * CELL / 100.0, 1)})
        return out

    hover_at = [None]

    def hover(x, y):
        """Hold the Dog (movement off, 25 m up) over x, y until World Partition streaming there is complete: the Dog
        is the streaming source, and planning 500 m from where it stands would trace unloaded ground."""
        dog = pawn()
        dog.character_movement.disable_movement()
        dog.set_actor_location(unreal.Vector(x, y, 2500.0), False, True)
        unreal.SystemLibrary.execute_console_command(world(), "FlushLevelStreaming")
        t_ = 0.0
        while t_ < 30.0:
            yield 0.25
            t_ += 0.25
            try:
                if L.is_world_partition_streaming_complete(world()):
                    break
            except Exception:                                          # noqa: BLE001
                break
        hover_at[0] = (x, y)
        fcache.clear()                                               # a trace made before the load may be of nothing
        ccache.clear()

    def place(x, y, zhint, planned=False):
        """THE placement: over x, y with streaming complete, then set down on the floor and handed to the walker.
        A planned point's zhint IS its floor: trace from just above it, never down onto a roof or a screen top."""
        yield from hover(x, y)
        dog = pawn()
        if planned:
            t_ = trace_down(x, y, zhint + 60.0, zhint - 200.0)
            z = zhint if t_ is None else float(t_[4].z)
        else:
            z = floor(x, y, zhint)
        dog.set_actor_location(unreal.Vector(x, y, (z if z is not None else zhint) + HALF + 30.0), False, True)
        dog.character_movement.set_movement_mode(unreal.MovementMode.MOVE_WALKING)

    legs_out = []
    RESULT["legs"] = legs_out
    for leg in LEGS:
        pts = [tuple(p) for p in leg["points"]]
        rec = {"id": leg["id"], "targets": len(pts), "planned_pairs": 0, "pairs": []}
        legs_out.append(rec)
        route, zhint = [pts[0]], globals().get("ZHINT", 0.0)
        for a, b in zip(pts, pts[1:]):
            mx, my = (route[-1][0] + b[0]) * 0.5, (route[-1][1] + b[1]) * 0.5
            if hover_at[0] is None or math.hypot(mx - hover_at[0][0], my - hover_at[0][1]) > 10000.0:
                yield from hover(mx, my)
            res = yield from plan(route[-1], b, zhint, MARGIN)
            if not res.get("ok"):
                res2 = yield from plan(route[-1], b, zhint, MARGIN_WIDE)
                res2["retried_wide"] = True
                res2["narrow"] = {k: res[k] for k in ("why", "frontier", "frontier_to_goal_m", "expanded") if k in res}
                res = res2
            prow = {"to": [round(b[0]), round(b[1])]}
            prow.update({k: v for k, v in res.items() if k != "path"})
            rec["pairs"].append(prow)
            if res.get("ok"):
                if len(route) == 1:
                    route[0] = res["path"][0]                        # the planned (snapped) start, with its z
                route.extend(res["path"][1:])
                zhint = res["z_end"]
                rec["planned_pairs"] += 1
            else:
                route.append(b)
            yield 0.0
        rec["route_points"] = len(route)
        rec["route"] = [[round(p[0]), round(p[1])] + ([round(p[2])] if len(p) == 3 else []) for p in route]
        emit("PLAN", leg["id"], "%d/%d pairs planned" % (rec["planned_pairs"], len(pts) - 1), len(route))
        # THE WALK: ONE placement at the first plan point, then forced input along the plan
        if len(route[0]) == 3:
            yield from place(route[0][0], route[0][1], route[0][2], planned=True)
        else:
            yield from place(route[0][0], route[0][1], globals().get("ZHINT", 0.0))
        yield 1.0
        wp, best_d, since, walked, last = 1, None, 0.0, 0.0, None
        stops = []
        rec["stops"] = stops
        g_prev = unreal.GameplayStatics.get_time_seconds(world())
        g_start = g_prev
        budget = (sum(math.hypot(route[k][0] - route[k - 1][0], route[k][1] - route[k - 1][1])
                      for k in range(1, len(route))) / 100.0 + 120.0)
        while wp < len(route):
            dog = pawn()
            if dog is None:
                rec["dog_destroyed"] = True
                break
            g_now = unreal.GameplayStatics.get_time_seconds(world())
            dt, g_prev = max(0.0, g_now - g_prev), g_now
            if g_now - g_start > budget + 20.0 * len(stops):
                rec["timed_out"] = True
                break
            loc = dog.get_actor_location()
            if last is not None:
                walked += math.hypot(loc.x - last[0], loc.y - last[1])
            last = (loc.x, loc.y)
            tx, ty = route[wp][0], route[wp][1]
            dx, dy = tx - loc.x, ty - loc.y
            d = math.hypot(dx, dy)
            if d <= ARRIVE:
                wp, best_d, since = wp + 1, None, 0.0
                continue
            if best_d is None or d < best_d - 20.0:
                best_d, since = d, 0.0
            else:
                since += dt
                if since >= STUCK:
                    heading = math.degrees(math.atan2(dy, dx))
                    stop = {"at": [round(loc.x), round(loc.y), round(loc.z)], "waypoint": wp,
                            "radius_m": round(math.hypot(loc.x, loc.y) / 100.0, 1),
                            "streaming_complete": bool(L.is_world_partition_streaming_complete(world()))}
                    stop.update(diagnose(dog, heading))
                    stops.append(stop)
                    emit("STOP", leg["id"], stop["at"], stop["radius_m"], [f.get("actor") for f in stop["fan"]][:3])
                    if not RESUME or len(stops) >= MAX_STOPS:
                        break
                    k = wp
                    while k < len(route) - 1 and math.hypot(route[k][0] - loc.x, route[k][1] - loc.y) < 1000.0:
                        k += 1
                    if len(route[k]) == 3:
                        yield from place(route[k][0], route[k][1], route[k][2], planned=True)
                    else:
                        yield from place(route[k][0], route[k][1], loc.z - HALF)
                    yield 1.0
                    wp, best_d, since, last = k + 1, None, 0.0, None
                    continue
            ctrl = dog.get_controller()
            if ctrl is not None:
                ctrl.set_control_rotation(unreal.Rotator(0.0, math.degrees(math.atan2(dy, dx)), 0.0))
            dog.add_movement_input(unreal.Vector(dx / d, dy / d, 0.0), 1.0, True)
            yield 0.0
        rec["arrived"] = wp >= len(route) and not stops
        rec["reached_end"] = wp >= len(route)
        rec["waypoints_reached"] = wp
        rec["walked_m"] = round(walked / 100.0, 1)
        rec["seconds"] = round(unreal.GameplayStatics.get_time_seconds(world()) - g_start, 1)
        emit("LEG", leg["id"], "ARRIVED" if rec["arrived"] else "NOT ARRIVED (%d stops)" % len(stops))
    RESULT["all_arrived"] = all(r.get("arrived") for r in legs_out)
    RESULT["status"] = "walked"
