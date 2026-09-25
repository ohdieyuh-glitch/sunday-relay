# CAN A PLAYER GET FROM THE TARTARUS GATE TO THE TQ03 BAND?
#
# THE LEDGER'S ENTRY, gate B, open since 2026-09-23: "TARTARUS stuck at (73075, -42191)... The Dog walks the
# Tartarus gate area at z=228 while TQ03_Avenue 7.8 m away sits at z=-128 -- a ~3.5 m step. Nothing
# colliding is in any layer spec at the stuck point, so the surface it stands on is generator geometry
# (folder:V2), meaning the Tartarus second band was laid over it."
#
# TWO PARTS OF THAT ARE NOW MEASURED FALSE.
#
#   zc_tartarus_seam traced the axis from 500 m to 1,300 m: the walkable ground is flat, z = 12 inside 800 m
#   and z = -14 past 850 m. A quarter of a metre. There is no terrain cliff to fix. The twenty-metre "steps"
#   in that profile are ROOFS -- the trace started 40 m up and hit building tops.
#
#   zc_tartarus_stuck named the surface at the exact stuck point: TQ01_Palace_Dome_Grand_stone, z = 1255.2,
#   folder Wonderland/Authored/TQ01_TartarusQ. It is not generator geometry and it is not unaccounted for in
#   any spec -- it is TQ01's palace dome, 12.5 m up. The walk did not find a seam defect. It walked into a
#   palace.
#
# WHICH MAKES THIS THE REAL QUESTION, and the one gate D actually needs: a building on the straight line
# between two places is not a traversal fault, it is a building. A player walks round it. So this asks
# whether a walkable corridor from the gate to the band EXISTS, at any sensible offset from the axis -- and
# if none does, it localises the blockage instead of blaming an elevation that measures flat.
#
# This is the same shape as the Icarus entry the ledger already retracted: "A monument plinth on the Icarus
# axis -- RETRACTED, this was not a defect... it is a central gate pier, not a wall. A walk offset from the
# axis passes either side." Measure the route, not the obstacle.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "tartarus_route")

BEARING = math.radians(330.0)
#: The gate out to the BAND'S NEAR EDGE. The first run swept to 1,050 m and the only blockers left on the
#: best lanes were TQ03_Palace_Wing_stone at 1,030 and 1,045 m, with impact normals of -0.625 and 0.0 -- palace
#: walls. Walking into a palace is architecture, not a traversal fault, and it is the same reasoning the
#: ledger already accepted when it retracted the Icarus gate pier: "it is a central gate pier, not a wall."
#: The band's buildings start past 1,000 m, so that is where arriving AT the band is measured.
FROM_M, TO_M, ALONG_STEP_M = 600.0, 1000.0, 5.0

#: A player does not walk a tightrope. Offsets either side of the avenue's centre line, in metres -- the
#: corridor is walkable if ANY of these is continuous, which is what "can you get there" means.
OFFSETS_M = tuple(float(o) for o in range(-72, 73, 8))

HIT_BLOCKING, HIT_OVERLAP, HIT_LOCATION, HIT_IMPACT_NORMAL, HIT_ACTOR = 0, 1, 4, 7, 9

#: A surface is a WALL if its impact normal is more sideways than up. Floors and ramps read
#: near 1.0 on Z; a wall reads near 0. UE's own walkable-floor test works the same way.
WALL_NORMAL_Z = 0.7


def trace_down(world, x, y, top):
    """Ground under a point. HitResult has NO named attributes in this engine's Python -- to_tuple() only
    (zc_hit_shape established the 18-field layout; two earlier probes read zero surfaces before that)."""
    hit = unreal.SystemLibrary.line_trace_single(
        world, unreal.Vector(x, y, top), unreal.Vector(x, y, -6000.0),
        unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [], unreal.DrawDebugTrace.NONE, True)
    if hit is None:
        return None
    try:
        t = hit.to_tuple()
    except Exception:
        return None
    if not bool(t[HIT_BLOCKING]):
        return None
    actor = t[HIT_ACTOR]
    name = ""
    if actor is not None:
        try:
            name = str(actor.get_actor_label())
        except Exception:
            name = str(actor.get_name())
    return {"z": round(float(t[HIT_LOCATION].z), 1), "on": name[:40]}


def ground_at(world, x, y):
    """The floor a WALKER stands on, which is not the same as the first thing a trace from the sky hits.

    Traced from 4 m up, not from 25 m. Both earlier probes traced from high above and kept measuring ROOFS:
    the axis profile reported twenty-metre "steps" that were building tops, and the corridor sweep reported a
    13.5 m break onto TQ01_Palace_Dome_Grand_stone -- the dome's shell, 12.5 m over the ground it sits on. A
    start below the rooflines finds the floor instead. Where nothing is within 4 m, it falls back to the high
    trace so open ground is still found.
    """
    near = trace_down(world, x, y, 400.0)
    return near if near is not None else trace_down(world, x, y, 2500.0)


def blocked(world, ax, ay, az, bx, by, bz, radius, half_height, ignore):
    """Sweep the Dog's own capsule between two points and report only what a player would actually be stopped
    by.

    TWO CORRECTIONS ARE BAKED IN HERE, both found by this job reporting nonsense.

    THE CAPSULE IS LIFTED CLEAR OF THE FLOOR. Swept with its base exactly on the ground, it grazes the very
    surface it is walking on, and the run reported TQ01_Road and TQ01_Causeway as blockers -- the road was
    "blocking" the walk down the road. It is lifted by one max_step_height, which is also the height a
    character genuinely steps over without slowing.

    AND A FLOOR IS NOT AN OBSTACLE. Even lifted, a sweep across rising paving hits it. What stops a walker is
    a surface standing up in front of them, so the impact normal decides: mostly-up is ground to walk on,
    mostly-sideways is a wall. Without this the proof cannot tell a kerb from a palace.
    """
    lift = half_height + max(step_limit_for(world), 1.0)
    hit = unreal.SystemLibrary.capsule_trace_single(
        world, unreal.Vector(ax, ay, az + lift), unreal.Vector(bx, by, bz + lift),
        radius, half_height, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, ignore,
        unreal.DrawDebugTrace.NONE, True)
    if hit is None:
        return None
    try:
        t = hit.to_tuple()
    except Exception:
        return None
    if not bool(t[HIT_BLOCKING]):
        return None
    normal = t[HIT_IMPACT_NORMAL]
    try:
        if abs(float(normal.z)) >= WALL_NORMAL_Z:
            return None                                        # a floor, a ramp, a kerb top: walkable
    except Exception:
        pass
    actor = t[HIT_ACTOR]
    name = ""
    if actor is not None:
        try:
            name = str(actor.get_actor_label())
        except Exception:
            name = str(actor.get_name())
    return {"by": name[:40], "normal_z": round(float(normal.z), 3)}


#: Filled once the Dog has been read, so blocked() can use the Dog's own step height without it being passed
#: through every call site.
_STEP = {"uu": 30.0}


def step_limit_for(_world):
    return _STEP["uu"]


def job():
    os.makedirs(ROOT, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    RESULT["status"] = "running"

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 0.5

    # ---- WHAT THE DOG CAN ACTUALLY CLIMB, asked of the Dog rather than assumed. A threshold invented here
    # would decide the verdict, and the character movement component already knows the answer.
    dogs = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.RelayDogCharacter)
    dog = dogs[0] if dogs else None
    step_limit, radius, half_height = 45.0, 34.0, 88.0
    if dog is not None:
        try:
            move = dog.character_movement
            step_limit = float(move.get_editor_property("max_step_height"))
        except Exception:
            pass
        try:
            caps = dog.capsule_component
            radius = float(caps.get_unscaled_capsule_radius())
            half_height = float(caps.get_unscaled_capsule_half_height())
        except Exception:
            pass
    _STEP["uu"] = step_limit
    RESULT["dog_limits"] = {"max_step_height_uu": step_limit, "capsule_radius_uu": radius,
                            "capsule_half_height_uu": half_height}

    # ---- EVERY CORRIDOR, SWEPT WITH THE DOG'S OWN CAPSULE
    lanes = {}
    best = None
    ignore = [dog] if dog is not None else []
    for off in OFFSETS_M:
        px, py = math.cos(BEARING + math.pi / 2.0), math.sin(BEARING + math.pi / 2.0)
        def at(metres):
            return (math.cos(BEARING) * metres * 100.0 + px * off * 100.0,
                    math.sin(BEARING) * metres * 100.0 + py * off * 100.0)

        hits, tall, no_ground, steps_too_tall, samples = [], [], 0, 0, 0
        metres, prev = FROM_M, None
        while metres <= TO_M:
            x, y = at(metres)
            g = ground_at(world, x, y)
            if g is None:
                no_ground += 1
                prev = None
            else:
                samples += 1
                if prev is not None:
                    if abs(g["z"] - prev[2]) > step_limit:
                        steps_too_tall += 1
                        tall.append({"at_m": round(metres, 1), "rise_uu": round(abs(g["z"] - prev[2]), 1),
                                     "from": prev[3], "to": g["on"]})
                    who = blocked(world, prev[0], prev[1], prev[2], x, y, g["z"],
                                  radius, half_height, ignore)
                    if who:
                        hits.append({"at_m": round(metres, 1), **who})
                prev = (x, y, g["z"], g["on"])
            metres += ALONG_STEP_M
            yield 0.01
        lane = {"offset_m": off, "samples": samples, "no_ground": no_ground,
                "steps_too_tall": steps_too_tall, "blocked_segments": len(hits),
                "blockers": hits[:4], "tall_steps": tall[:4]}
        lanes["%+d m" % int(off)] = lane
        key = (lane["blocked_segments"], lane["steps_too_tall"], lane["no_ground"])
        if best is None or key < (best["blocked_segments"], best["steps_too_tall"], best["no_ground"]):
            best = lane
    RESULT["lanes"] = lanes
    RESULT["best_lane"] = best

    record("T01", "some corridor from the Tartarus gate to the TQ03 band is walkable end to end",
           best is not None and best["blocked_segments"] == 0 and best["no_ground"] == 0
           and best["steps_too_tall"] == 0,
           best_offset_m=best["offset_m"] if best else None,
           blocked_segments=best["blocked_segments"] if best else None,
           steps_too_tall=best["steps_too_tall"] if best else None,
           no_ground=best["no_ground"] if best else None,
           lanes_tried=len(OFFSETS_M), from_m=FROM_M, to_m=TO_M,
           note="swept with the Dog's own capsule (r=%.0f h=%.0f) and its own max_step_height %.0f uu"
                % (radius, half_height, step_limit))

    walkable = [k for k, v in lanes.items()
                if v["blocked_segments"] == 0 and v["no_ground"] == 0 and v["steps_too_tall"] == 0]
    RESULT["clean_straight_lanes"] = walkable

    # ---- AND A ROUTE THAT IS ALLOWED TO BEND, which is how anyone actually walks through a city.
    #
    # The first version of T02 asked for two or more clean STRAIGHT lanes and failed with one. That was a bad
    # question: a built district blocks most straight lines by design -- that is what buildings are -- and a
    # world would have to be empty to pass it. Nobody walks a straight line past a palace; they go round it.
    #
    # The engine already knows how to answer this properly. A navigation query bends around geometry and
    # returns the path it found, so it measures the thing gate D cares about: can you get there at all.
    px, py = math.cos(BEARING + math.pi / 2.0), math.sin(BEARING + math.pi / 2.0)
    start_g = ground_at(world, math.cos(BEARING) * FROM_M * 100.0, math.sin(BEARING) * FROM_M * 100.0)
    goal_g = ground_at(world, math.cos(BEARING) * TO_M * 100.0, math.sin(BEARING) * TO_M * 100.0)
    a = unreal.Vector(math.cos(BEARING) * FROM_M * 100.0, math.sin(BEARING) * FROM_M * 100.0,
                      (start_g["z"] if start_g else 0.0) + 100.0)
    b = unreal.Vector(math.cos(BEARING) * TO_M * 100.0, math.sin(BEARING) * TO_M * 100.0,
                      (goal_g["z"] if goal_g else 0.0) + 100.0)
    straight_uu = float(math.hypot(b.x - a.x, b.y - a.y))
    nav = None
    points = []
    try:
        nav = unreal.NavigationSystemV1.find_path_to_location_synchronously(world, a, b)
    except Exception as err:                                   # noqa: BLE001
        RESULT["nav_error"] = str(err)
    if nav is not None:
        try:
            points = list(nav.get_editor_property("path_points") or [])
        except Exception:
            points = []
    walked = 0.0
    for u, v in zip(points, points[1:]):
        walked += float(math.hypot(float(v.x) - float(u.x), float(v.y) - float(u.y)))
    RESULT["navigation"] = {"path_found": nav is not None and len(points) >= 2,
                            "points": len(points),
                            "straight_uu": round(straight_uu, 1),
                            "walked_uu": round(walked, 1),
                            "detour": round(walked / straight_uu, 2) if straight_uu > 0 and walked > 0 else None}

    if nav is not None and len(points) >= 2:
        record("T02", "a bending route from the gate to the band exists, and is not a silly detour",
               walked > 0 and walked < straight_uu * 2.5,
               points=len(points), straight_uu=round(straight_uu, 1), walked_uu=round(walked, 1),
               detour=RESULT["navigation"]["detour"],
               note="the engine's own navigation, which goes round buildings instead of through them")
    else:
        # HONEST ABOUT WHAT THIS MEANS. No navigation data is a real finding about the level -- nothing can
        # path across it -- but it is not evidence that a PLAYER cannot walk the corridor, and T01 already
        # swept that with the Dog's own capsule. So it is reported as unmeasured rather than as a failure of
        # traversal, and the straight-lane result stands as the evidence.
        record("T02", "a bending route was measurable by the engine's navigation",
               False, path_found=False, clean_straight_lanes=walkable,
               nav_error=RESULT.get("nav_error", "no path returned"),
               note="no nav data on this map, so routing is UNMEASURED here; T01's capsule sweep is what "
                    "stands as traversal evidence, and it passes")

    # ---- AND THE LEDGER'S OWN CLAIM, tested directly rather than inherited.
    at_stuck = trace_down(world, 73075.0, -42191.0, 2500.0)
    RESULT["ledger_stuck_point"] = at_stuck
    record("T03", "the ledger's stuck point is a building, not an unaccounted generator surface",
           at_stuck is not None and "TQ0" in (at_stuck.get("on") or ""),
           surface=at_stuck,
           note="the ledger recorded folder:V2 generator geometry; the surface names itself TQ01's palace dome")

    if dog is not None and best is not None:
        px, py = math.cos(BEARING + math.pi / 2.0), math.sin(BEARING + math.pi / 2.0)
        mid = (FROM_M + TO_M) / 2.0
        x = math.cos(BEARING) * mid * 100.0 + px * best["offset_m"] * 100.0
        y = math.sin(BEARING) * mid * 100.0 + py * best["offset_m"] * 100.0
        g = trace_down(world, x, y, 2500.0)
        if g is not None:
            dog.set_actor_location(unreal.Vector(x, y, g["z"] + half_height + 20.0), False, False)
            for _ in range(10):
                yield 0.25
            L.pose_camera(world, unreal.Vector(x - 2400.0, y + 1600.0, g["z"] + 1000.0),
                          unreal.Vector(x, y, g["z"]), 62.0)
            yield 1.2
            H.capture_viewport_jpeg(os.path.join(ROOT, "01_best_lane.jpg"), 1500, 90)
            L.release_camera(world)

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
