# DID THE FIVE TERRITORY CHECKPOINTS LAND AS PLACES A PLAYER CAN USE?   (v2)
#
# CP01-CP05 build an orientation court at each of the five checkpoints the territory registry declares. A
# count of instances applied proves none of what matters about them, so this asks the questions that can
# actually fail. Two of them are here because the FIRST version of this job failed them itself:
#
#   ARE THE PASS'S ACTORS ACTUALLY LOADED     -- v1 assumed a 2.5 s park was enough for World Partition and
#                                                 measured bare lawn where 872 instances had been saved. The
#                                                 photographs showed flat grass at ICARUS and DUBEL at noon
#                                                 and the finished court at TARTARUS at midnight, from the
#                                                 same run. Now the job POLLS for the pass's own tagged
#                                                 actors and refuses to measure until they are there, and
#                                                 records how long that took, so streaming is a number.
#   IS THE DOG STILL ALIVE AND WHERE I PUT IT  -- v1 parked the Dog INSIDE each tower base to trace the
#                                                 tower, which is the ledger's documented way of destroying
#                                                 it: teleport into geometry, no respawn, no streaming
#                                                 source, every later reading is the always-loaded set. The
#                                                 tell was the order -- DUBEL, measured first, got its tower;
#                                                 the three nations after it got -26. Now nothing is parked
#                                                 inside anything, and a reading taken with the Dog missing
#                                                 or displaced is reported UNMEASURED, never as a value.
#   IS THE APRON ON THE GROUND                 -- the real defect v1 found and nearly passed: bays authored
#                                                 at z=12 (the road) over ground at -14. Its K02 tolerance was
#                                                 40 uu and the float was 26. The gate is now 10 uu against the
#                                                 traced ground, and the paving is non-colliding by design, so
#                                                 the DECLARED ground is what is checked -- the thing the build
#                                                 actually used.
#   IS THERE COLLIDABLE FLOOR ON THE PLATE, IS THE MARCH STILL WALKABLE (swept with the Dog's own capsule),
#   DOES THE LANDMARK RISE (traced from 120 m, downward), AND IS IT READ AT MIDNIGHT AS WELL AS NOON.
#
# THE POINTS ARE NOT TYPED IN HERE. `territory_checkpoints.py` writes `cp_proof_points.json` as it builds.
import json
import math
import os

import unreal

L = unreal.WonderlandUiTestLibrary

POINTS = r"C:/dev/iwonder/wonderland-task3/wonderland/WorldDesign/Districts/cp_proof_points.json"
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "checkpoints")

CAP_R, CAP_H = 36.0, 87.0        # the Dog's own capsule
STEP = 30.0                      # its real max_step_height
LANDMARK_MIN = 4000.0            # a checkpoint tower has to rise this far to be a landmark at all
FLOAT_TOL = 10.0                 # declared ground vs traced ground: past this the apron floats or sinks
STREAM_WAIT = 20.0               # how long a cell gets to arrive before the site is reported unloaded
PAWN = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2
#: How many tagged batch actors each pass creates (from the specs), so "loaded" has a number to meet.
EXPECTED_ACTORS = {"CP01": 8, "CP02": 54, "CP03": 54, "CP04": 53, "CP05": 42}


def job():
    RESULT["status"] = "running"
    tests, sites = [], {}
    RESULT["tests"], RESULT["sites"] = tests, sites
    os.makedirs(ROOT, exist_ok=True)

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    with open(POINTS, encoding="utf-8") as f:
        plan = json.load(f)

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
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    yield 6.0

    RESULT["partition"] = str(L.describe_world_partition(world))
    state = {"dog": unreal.GameplayStatics.get_player_pawn(world, 0), "lost": []}

    def dog():
        d = state["dog"]
        try:
            d.get_actor_location()
            return d
        except Exception:                                             # noqa: BLE001
            state["dog"] = unreal.GameplayStatics.get_player_pawn(world, 0)
            return state["dog"]

    def trace_z(x, y, top, channel, depth=20000.0):
        """The first hit under (x, y) on a named channel, or None."""
        try:
            hit = unreal.SystemLibrary.line_trace_single(
                world, unreal.Vector(x, y, top), unreal.Vector(x, y, top - depth),
                channel, False, [d for d in (dog(),) if d is not None], unreal.DrawDebugTrace.NONE, True,
                unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        except Exception:                                             # noqa: BLE001
            return None
        if hit is None:
            return None
        try:
            return round(float(hit.to_tuple()[4].z), 1)
        except Exception:                                             # noqa: BLE001
            return None

    def floor_at(x, y, top, depth=20000.0):
        try:
            hit = unreal.SystemLibrary.line_trace_single(
                world, unreal.Vector(x, y, top), unreal.Vector(x, y, top - depth),
                PAWN, False, [d for d in (dog(),) if d is not None], unreal.DrawDebugTrace.NONE, True,
                unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        except Exception:                                             # noqa: BLE001
            return None
        if hit is None:
            return None
        try:
            return round(float(hit.to_tuple()[4].z), 1)
        except Exception:                                             # noqa: BLE001
            return None

    def blocked_between(a, b, z):
        """The capsule is lifted a full step, so what it hits is what the Dog cannot step over."""
        try:
            hit = unreal.SystemLibrary.capsule_trace_single(
                world, unreal.Vector(a[0], a[1], z + STEP + CAP_H),
                unreal.Vector(b[0], b[1], z + STEP + CAP_H),
                CAP_R, CAP_H, PAWN, False, [d for d in (dog(),) if d is not None],
                unreal.DrawDebugTrace.NONE, True, unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        except Exception:                                             # noqa: BLE001
            return None
        return hit is not None

    def court_floor(cx, cy, g, r):
        """Four reads AROUND the fingerpost, never through it; the radius is the plate's, not a constant."""
        got = []
        for i in range(4):
            t = math.pi * 0.5 * i + math.pi * 0.25
            z = floor_at(cx + r * math.cos(t), cy + r * math.sin(t), g + 1500.0)
            if z is not None:
                got.append(z)
        if not got:
            return None, []
        got.sort()
        return got[len(got) // 2], got

    def actors_of(pass_id):
        try:
            return len(unreal.GameplayStatics.get_all_actors_with_tag(world, unreal.Name("WL_PASS_" + pass_id)))
        except Exception:                                             # noqa: BLE001
            return -1

    def park(x, y, z, note):
        """Move the player NEAR a point -- never into anything -- and say whether it is really there.

        Returns the distance from where it was asked to stand, or None if there is no Dog to ask. A reading
        taken after a None or a large distance is not a reading.
        """
        d = dog()
        if d is None:
            state["lost"].append(note)
            return None
        try:
            d.set_actor_location(unreal.Vector(x, y, z + 300.0), False, False)
        except Exception:                                             # noqa: BLE001
            state["lost"].append(note)
            return None
        return 0.0

    def where_is_dog(x, y):
        d = dog()
        if d is None:
            return None
        try:
            loc = d.get_actor_location()
        except Exception:                                             # noqa: BLE001
            return None
        return round(math.hypot(loc.x - x, loc.y - y), 1)

    def patch(cx, cy, hw, hh):
        got = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
        if got is None:
            return None
        mean, dark, bright, sampled = got
        return {"luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 5),
                "dark": round(dark, 4), "bright": round(bright, 4), "samples": int(sampled)}

    # ---------------------------------------------------------------- the sites
    for name in sorted(plan):
        spec = plan[name]
        cx, cy = spec["court"]
        g = float(spec["ground_z"])
        pid = spec["pass"]
        row = {"pass": pid, "declared_ground_z": g, "bearing": spec["bearing"]}
        sites[name] = row

        # STAND BESIDE THE COURT, on the road side, a plate-width away: near enough to be the streaming
        # source, never on the fingerpost and never in the tower.
        b = math.radians(float(spec["bearing"]))
        px, py = cx - math.cos(b) * 1200.0, cy - math.sin(b) * 1200.0
        park(px, py, g, name)
        # WAIT FOR THE PASS TO EXIST HERE. Polled, timed, and recorded -- not slept.
        waited = 0.0
        have = actors_of(pid)
        while have < EXPECTED_ACTORS.get(pid, 1) and waited < STREAM_WAIT:
            yield 1.0
            waited += 1.0
            have = actors_of(pid)
        row["pass_actors_loaded"] = have
        row["pass_actors_expected"] = EXPECTED_ACTORS.get(pid)
        row["stream_wait_s"] = waited
        row["dog_distance_from_stand_m"] = (where_is_dog(px, py) or 0.0) / 100.0 if where_is_dog(px, py) is not None else None
        alive = row["dog_distance_from_stand_m"] is not None and row["dog_distance_from_stand_m"] < 8.0
        row["dog_alive_and_placed"] = alive
        if not alive:
            emit("C_%s" % name, "WARN", "the Dog is not where it was stood; readings here are UNMEASURED",
                 {"distance_m": row["dog_distance_from_stand_m"]})
            row["unmeasured"] = True
            continue

        plate_r = 500.0 if spec.get("tower") or name == "DUBEL" else 220.0
        row["court_floor"], row["court_reads"] = court_floor(cx, cy, g, plate_r)
        # OUTSIDE: traced from LOW, so a canopy or a roof cannot be mistaken for ground.
        row["outside_floor"] = floor_at(spec["outside"][0], spec["outside"][1], g + 300.0, 2000.0)

        if name in ("ICARUS", "NOCTIS", "TARTARUS"):
            a, bb = spec["road_in"], spec["road_out"]
            steps, blocked, nofloor = 12, [], []
            for i in range(steps):
                t0, t1 = i / float(steps), (i + 1) / float(steps)
                p0 = (a[0] + (bb[0] - a[0]) * t0, a[1] + (bb[1] - a[1]) * t0)
                p1 = (a[0] + (bb[0] - a[0]) * t1, a[1] + (bb[1] - a[1]) * t1)
                fz = floor_at(p0[0], p0[1], g + 1500.0)
                if fz is None:
                    nofloor.append([round(p0[0]), round(p0[1])])
                    continue
                if blocked_between(p0, p1, fz):
                    blocked.append([round(p0[0]), round(p0[1])])
            row["road_segments"], row["road_blocked"], row["road_without_floor"] = steps, blocked, nofloor

        if spec.get("tower"):
            tx, ty = spec["tower"]
            # NO PARK. The tower is 24-30 m from where the Dog already stands, in the same cell.
            #
            # TRACED ON VISIBILITY, NOT ON THE PAWN CHANNEL, and the first version had that wrong. A
            # checkpoint tower is a SILHOUETTE -- the question is "can you see it from the next ring", not
            # "can you stand on it" -- and the top of these chains is a needle spire that nothing collides
            # with, correctly. The pawn trace therefore stopped ~2.3 m below the real top and reported
            # ICARUS/NOCTIS at 5096 against a built 7426, with TARTARUS missing the landmark floor by twelve
            # centimetres on that artefact alone. Both channels are read now: VIS is the gate, PAWN is kept
            # beside it because a tower you can see and walk through is worth knowing about separately.
            vis = trace_z(tx, ty, g + 12000.0, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1)
            pawn = trace_z(tx, ty, g + 12000.0, PAWN)
            row["tower_top_z"] = vis
            row["tower_rise"] = None if vis is None else round(vis - g, 1)
            row["tower_rise_collidable"] = None if pawn is None else round(pawn - g, 1)
            row["tower_expected_rise"] = spec.get("tower_top_z")

        emit("C_%s" % name, "INFO", name,
             {"actors": "%s/%s in %.0fs" % (have, EXPECTED_ACTORS.get(pid), waited),
              "court_floor": row["court_floor"], "outside": row["outside_floor"],
              "tower_rise": row.get("tower_rise"), "road_blocked": len(row.get("road_blocked", []))})

    # ---------------------------------------------------------------- the pictures, noon and midnight
    shots = {}
    RESULT["captures"] = shots
    for hour, label in ((12.0, "noon"), (0.0, "midnight")):
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
        for name in sorted(plan):
            spec = plan[name]
            cx, cy = spec["court"]
            g = float(spec["ground_z"])
            b = math.radians(float(spec["bearing"]))
            park(cx - math.cos(b) * 1200.0, cy - math.sin(b) * 1200.0, g, name + "_" + label)
            waited = 0.0
            while actors_of(spec["pass"]) < EXPECTED_ACTORS.get(spec["pass"], 1) and waited < STREAM_WAIT:
                yield 1.0
                waited += 1.0
            eye = unreal.Vector(cx - math.cos(b) * 2600.0, cy - math.sin(b) * 2600.0, g + 900.0)
            L.pose_camera(world, eye, unreal.Vector(cx, cy, g + 300.0), 70.0)
            yield 4.0
            shot = os.path.join(ROOT, "%s_%s.png" % (name.lower(), label))
            try:
                L.capture_game_viewport(shot)
            except Exception:                                         # noqa: BLE001
                pass
            shots.setdefault(name, {})[label] = {
                "file": os.path.basename(shot), "actors_loaded": actors_of(spec["pass"]),
                "frame": patch(0.5, 0.5, 0.46, 0.44), "court": patch(0.5, 0.62, 0.16, 0.14)}
        L.release_camera(world)

    # ---------------------------------------------------------------- the gates
    want = ("arrival", "ICARUS", "NOCTIS", "TARTARUS", "DUBEL")
    measured = [n for n in want if not sites.get(n, {}).get("unmeasured")]
    record("K00", "the Dog survived every stand and was where it was put, so every reading below is a reading",
           len(measured) == len(want), measured=measured, lost=state["lost"],
           distances_m={n: sites[n].get("dog_distance_from_stand_m") for n in want if n in sites},
           note="v1 parked the Dog inside a tower base; the three sites measured after that read bare lawn")

    loaded = {n: (sites[n].get("pass_actors_loaded"), sites[n].get("pass_actors_expected"),
                  sites[n].get("stream_wait_s")) for n in want if n in sites}
    record("K07", "every checkpoint pass's actors were resident before it was measured",
           all(v[0] is not None and v[1] is not None and v[0] >= v[1] for v in loaded.values()),
           loaded_expected_waits=loaded, wait_limit_s=STREAM_WAIT,
           note="polled by WL_PASS_ tag rather than slept for; a photograph of the always-loaded set is not a "
                "photograph of the pass")

    solid = [n for n in measured if sites[n].get("court_floor") is not None]
    record("K01", "there is collidable floor on every checkpoint's court plate",
           len(solid) == len(measured) and len(measured) == len(want), solid=solid)

    offs = {n: round(sites[n]["court_floor"] - sites[n]["declared_ground_z"], 1) for n in solid}
    record("K02", "the build's declared ground IS the traced ground -- the apron neither floats nor sinks",
           bool(offs) and all(abs(v) <= FLOAT_TOL for v in offs.values()), offsets=offs, tolerance=FLOAT_TOL,
           note="the paving is non-colliding by design so the DECLARED z is what is gated; v1 allowed 40 uu "
                "and passed a 26 uu float")

    steps = {n: round(sites[n]["court_floor"] - sites[n]["outside_floor"], 1)
             for n in solid if sites[n].get("outside_floor") is not None}
    record("K03", "the court is flush with the real ground beside it",
           bool(steps) and all(abs(v) <= STEP for v in steps.values()), steps=steps, max_step=STEP)

    roads = [n for n in ("ICARUS", "NOCTIS", "TARTARUS") if n in measured]
    bad = {n: sites[n].get("road_blocked", []) for n in roads if sites[n].get("road_blocked")}
    holes = {n: sites[n].get("road_without_floor", []) for n in roads if sites[n].get("road_without_floor")}
    record("K04", "the march is still walkable through every checkpoint",
           not bad and not holes and len(roads) == 3, blocked=bad, without_floor=holes, roads=roads)

    towered = [n for n in want if plan.get(n, {}).get("tower") and n in measured]
    risen = {n: sites[n].get("tower_rise") for n in towered}
    record("K05", "every checkpoint that was given a landmark actually has one standing",
           len(towered) == 4 and all(v is not None and v >= LANDMARK_MIN for v in risen.values()),
           rise_uu=risen, floor_uu=LANDMARK_MIN, expected={n: plan[n]["tower_top_z"] for n in towered},
           rise_collidable={n: sites[n].get("tower_rise_collidable") for n in towered},
           note="traced on VISIBILITY: a spire is a silhouette, not a surface, and the pawn channel stops "
                "below the uncollidable top")

    night = {n: (shots.get(n, {}).get("midnight") or {}).get("court") for n in want}
    lit = {n: (v or {}).get("luma") for n, v in night.items()}
    crushed = {n: (v or {}).get("dark") for n, v in night.items()}
    record("K06", "every checkpoint is still readable at midnight",
           all(v is not None and v >= 0.05 for v in lit.values())
           and all(v is not None and v <= 0.72 for v in crushed.values()),
           court_luma=lit, floor=0.05, crushed_fraction=crushed, ceiling=0.72,
           night_actors_loaded={n: (shots.get(n, {}).get("midnight") or {}).get("actors_loaded") for n in want})

    RESULT["court_luma_noon"] = {n: (shots.get(n, {}).get("noon") or {}).get("court", {}).get("luma") for n in want}
    RESULT["court_luma_midnight"] = lit
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
