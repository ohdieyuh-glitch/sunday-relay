# DID THE FIVE TERRITORY CHECKPOINTS LAND AS PLACES A PLAYER CAN USE?
#
# CP01-CP05 build an orientation court at each of the five checkpoints the territory registry declares. A
# count of instances applied proves none of what matters about them, so this asks the four questions that
# can actually fail, and one of them is the reason this job exists at all.
#
#   IS THERE FLOOR ON THE COURT PLATE          -- traced on the channel a CHARACTER collides with, never the
#                                                 one a camera sees through. A plate you can see and fall
#                                                 through is what a wrong ground height produces.
#   IS THE APRON FLUSH WITH THE GROUND         -- the gate that would have caught this pass's own bug. CP05
#                                                 was first authored at z = 0 because DF01 plants its trees
#                                                 there; the frontier floor is -14, so the clearing would
#                                                 have been a 14 cm lip all the way round. The number came
#                                                 from another lane's walk before it shipped, and a build
#                                                 that depends on someone remembering is not gated. Both the
#                                                 declared ground and the REAL ground beside the court are
#                                                 compared against the traced court floor.
#   IS THE MARCH STILL WALKABLE                -- the bays widen a road that people walk down. If anything
#                                                 this pass placed has crept into the carriageway, the
#                                                 checkpoint has cost more than it gave. Swept with the
#                                                 Dog's own capsule (r=36, h=87) rather than eyeballed.
#   DOES THE LANDMARK ACTUALLY RISE            -- the tower is the answer to "poor landmark visibility", and
#                                                 a tower that failed its socket stack or got refused by the
#                                                 occupancy guard leaves a checkpoint with no silhouette and
#                                                 no error. Traced from 120 m up, downward, so the reading is
#                                                 the top of what is there rather than the inside of it.
#   AND IT IS READ AT MIDNIGHT AS WELL AS NOON -- the founder's requirement is that a checkpoint stays
#                                                 readable at night without the night becoming day.
#
# THE POINTS ARE NOT TYPED IN HERE. `territory_checkpoints.py` writes `cp_proof_points.json` as it builds,
# and this reads that. A gate carrying its own copy of a layout measures bare ground the first time a bay
# moves, finds a floor, and passes.
import json
import math
import os

import unreal

L = unreal.WonderlandUiTestLibrary

POINTS = r"C:/dev/iwonder/wonderland-task3/wonderland/WorldDesign/Districts/cp_proof_points.json"
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "checkpoints")

#: The Dog's own capsule, so "can a player get through" is asked with the player's shape.
CAP_R, CAP_H = 36.0, 87.0
#: A step the Dog can climb. A court floor further than this from the ground beside it is a lip, not a kerb.
STEP = 30.0
#: How far a checkpoint tower must rise to be a landmark at all. The three nation chains stack to 52-74 m.
LANDMARK_MIN = 4000.0
PAWN = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2


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
    RESULT["plan_sites"] = sorted(plan)

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
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)

    def floor_at(x, y, top):
        """The collidable floor under (x, y), or None. Traced from well above whatever is there."""
        try:
            hit = unreal.SystemLibrary.line_trace_single(
                world, unreal.Vector(x, y, top), unreal.Vector(x, y, top - 20000.0),
                PAWN, False, [dog], unreal.DrawDebugTrace.NONE, True,
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
        """True if the Dog's capsule cannot pass from a to b.

        THE CAPSULE IS LIFTED BY A FULL STEP HEIGHT, and that is the whole correctness of this check. A
        capsule centred at floor + half-height has its bottom exactly ON the floor and hits the road at
        every sample, which would have reported all three marches impassable and sent me looking for an
        obstruction this pass never placed. Lifting the bottom to floor + STEP also makes the test mean the
        right thing: what it hits is what the Dog cannot step over.
        """
        try:
            hit = unreal.SystemLibrary.capsule_trace_single(
                world, unreal.Vector(a[0], a[1], z + STEP + CAP_H),
                unreal.Vector(b[0], b[1], z + STEP + CAP_H),
                CAP_R, CAP_H, PAWN, False, [dog], unreal.DrawDebugTrace.NONE, True,
                unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        except Exception:                                             # noqa: BLE001
            return None
        return hit is not None

    def court_floor(cx, cy, g):
        """The floor ON the court plate, read AROUND the fingerpost rather than through it.

        The obelisk stands at the court centre and is 11.7 m tall, so a downward trace at (cx, cy) reads the
        TOP OF THE OBELISK and calls it the floor -- a court that would have reported as sitting 11 m above
        the ground it is laid on. Four reads at 5 m out: clear of the obelisk (radius 1.7 m) and still well
        inside the medallion (7.2 m). All four are returned so a tilted or half-laid apron shows up as a
        spread rather than being averaged away.
        """
        got = []
        for i in range(4):
            t = math.pi * 0.5 * i + math.pi * 0.25
            z = floor_at(cx + 500.0 * math.cos(t), cy + 500.0 * math.sin(t), g + 1500.0)
            if z is not None:
                got.append(z)
        if not got:
            return None, []
        got.sort()
        return got[len(got) // 2], got

    def park(x, y, z):
        """Put the player near a point so its cell streams in. A streaming source, never a measurement.

        The ledger records that repeated teleporting eventually destroys the Dog in a paging world, so this
        never depends on it surviving -- it re-fetches, and every reading is a trace.
        """
        nonlocal dog
        try:
            dog.set_actor_location(unreal.Vector(x, y, z + 400.0), False, False)
        except Exception:                                             # noqa: BLE001
            dog = unreal.GameplayStatics.get_player_pawn(world, 0)

    def patch(cx, cy, hw, hh):
        got = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
        if got is None:
            return None
        mean, dark, bright, sampled = got
        return {"luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 5),
                "dark": round(dark, 4), "bright": round(bright, 4), "samples": int(sampled)}

    for name in sorted(plan):
        spec = plan[name]
        cx, cy = spec["court"]
        g = float(spec["ground_z"])
        park(cx, cy, g)
        yield 2.5

        row = {"declared_ground_z": g, "bearing": spec["bearing"]}
        sites[name] = row
        row["court_floor"], row["court_reads"] = court_floor(cx, cy, g)
        # 15 m, not 40: a trace started high enough to clear a tower will happily land on a canopy or a
        # roof and report it as ground. The pawn channel ignores non-colliding foliage, and a low ceiling
        # covers the case where something solid does overhang.
        row["outside_floor"] = floor_at(spec["outside"][0], spec["outside"][1], g + 1500.0)

        # THE MARCH, swept with the Dog's capsule through the checkpoint. Only the three nation sites have
        # a road; the arrival plaza and the forest clearing are not carriageways and are not swept.
        if name in ("ICARUS", "NOCTIS", "TARTARUS"):
            a, b = spec["road_in"], spec["road_out"]
            steps, blocked, nofloor = 12, [], []
            for i in range(steps):
                t0, t1 = i / float(steps), (i + 1) / float(steps)
                p0 = (a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0)
                p1 = (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)
                fz = floor_at(p0[0], p0[1], g + 1500.0)
                if fz is None:
                    nofloor.append([round(p0[0]), round(p0[1])])
                    continue
                if blocked_between(p0, p1, fz):
                    blocked.append([round(p0[0]), round(p0[1])])
            row["road_segments"] = steps
            row["road_blocked"] = blocked
            row["road_without_floor"] = nofloor

        # THE LANDMARK, read from above so the number is its top and not its inside.
        if spec.get("tower"):
            tx, ty = spec["tower"]
            park(tx, ty, g)
            yield 1.5
            top = floor_at(tx, ty, g + 12000.0)
            row["tower_top_z"] = top
            row["tower_rise"] = None if top is None else round(top - g, 1)
            row["tower_expected_rise"] = spec.get("tower_top_z")

        emit("C_%s" % name, "INFO", name,
             {"court_floor": row["court_floor"], "outside_floor": row["outside_floor"],
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
            park(cx, cy, g)
            yield 1.5
            bearing = math.radians(float(spec["bearing"]))
            # Stand back down the road and look INTO the court, which is how a visitor meets it.
            eye = unreal.Vector(cx - math.cos(bearing) * 2600.0, cy - math.sin(bearing) * 2600.0, g + 900.0)
            look = unreal.Vector(cx, cy, g + 300.0)
            L.pose_camera(world, eye, look, 70.0)
            yield 4.0
            shot = os.path.join(ROOT, "%s_%s.png" % (name.lower(), label))
            try:
                L.capture_game_viewport(shot)
            except Exception:                                         # noqa: BLE001
                pass
            shots.setdefault(name, {})[label] = {
                "file": os.path.basename(shot),
                "frame": patch(0.5, 0.5, 0.46, 0.44),
                "court": patch(0.5, 0.62, 0.16, 0.14),
            }
        L.release_camera(world)

    # ---------------------------------------------------------------- the gates
    want = ("arrival", "ICARUS", "NOCTIS", "TARTARUS", "DUBEL")
    read = [n for n in want if sites.get(n, {}).get("court_floor") is not None
            and sites[n].get("outside_floor") is not None]
    record("K00", "every checkpoint was reached and its court and its surrounding ground both traced",
           len(read) == len(want), read=read, wanted=list(want), partition=RESULT["partition"],
           note="an instrument that cannot read one side cannot compare the two, and a half-read site "
                "would otherwise fall through the flatness gate as a pass")

    solid = [n for n in want if sites.get(n, {}).get("court_floor") is not None]
    record("K01", "there is collidable floor on every checkpoint's court plate",
           len(solid) == len(want), solid=solid,
           missing=[n for n in want if n not in solid])

    lip = {n: round(sites[n]["court_floor"] - sites[n]["declared_ground_z"], 1)
           for n in solid if sites[n]["court_floor"] is not None}
    record("K02", "the court sits where the build said the ground was",
           all(abs(v) <= STEP + 10.0 for v in lip.values()), offsets=lip, tolerance=STEP + 10.0,
           note="the paving modules are 6 cm proud of their placement z, so a correct court reads a few "
                "centimetres high; tens of centimetres means the pass was authored against the wrong floor")

    step = {n: round(sites[n]["court_floor"] - sites[n]["outside_floor"], 1)
            for n in read}
    record("K03", "the court is flush with the ground beside it -- no lip a player trips on",
           all(abs(v) <= STEP for v in step.values()), steps=step, max_step=STEP,
           note="compared against the REAL floor outside the bay, not against the number the build assumed")

    roads = [n for n in ("ICARUS", "NOCTIS", "TARTARUS") if n in sites]
    bad = {n: sites[n].get("road_blocked", []) for n in roads if sites[n].get("road_blocked")}
    holes = {n: sites[n].get("road_without_floor", []) for n in roads
             if sites[n].get("road_without_floor")}
    record("K04", "the march is still walkable through every checkpoint",
           not bad and not holes and len(roads) == 3, blocked=bad, without_floor=holes, roads=roads,
           note="swept 60 m of carriageway per nation with the Dog's own capsule; the bays are supposed to "
                "widen the road, not narrow it")

    towered = [n for n in want if plan.get(n, {}).get("tower")]
    risen = {n: sites[n].get("tower_rise") for n in towered}
    record("K05", "every checkpoint that was given a landmark actually has one standing",
           bool(towered) and all(v is not None and v >= LANDMARK_MIN for v in risen.values()),
           rise_uu=risen, floor_uu=LANDMARK_MIN,
           expected={n: plan[n]["tower_top_z"] for n in towered},
           note="read downward from 120 m. A tower whose socket stack raised or whose site was refused "
                "leaves no error behind, only a checkpoint with no silhouette")

    night = {n: (shots.get(n, {}).get("midnight") or {}).get("court") for n in want}
    lit = {n: (v or {}).get("luma") for n, v in night.items()}
    crushed = {n: (v or {}).get("dark") for n, v in night.items()}
    record("K06", "every checkpoint is still readable at midnight",
           all(v is not None and v >= 0.05 for v in lit.values())
           and all(v is not None and v <= 0.72 for v in crushed.values()),
           court_luma=lit, floor=0.05, crushed_fraction=crushed, ceiling=0.72,
           note="the same two gates the night proof uses, read on the court patch rather than the whole "
                "frame, because the requirement is that the CHECKPOINT reads after dark")

    noon = {n: (shots.get(n, {}).get("noon") or {}).get("court", {}).get("luma") for n in want}
    RESULT["court_luma_noon"] = noon
    RESULT["court_luma_midnight"] = lit
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
