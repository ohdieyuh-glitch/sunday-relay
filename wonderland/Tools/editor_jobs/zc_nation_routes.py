# CAN A PLAYER WALK EACH NATION'S GATE TO ITS SECOND BAND?
#
# FOUNDER, P2 item 13: "Walk-test every major region." And gate D: the world beta-complete.
#
# WHY THIS EXISTS RATHER THAN THREE COPIES OF THE TARTARUS JOB. zc_tartarus_route was written because the
# ledger had a complaint about Tartarus, and it retracted that complaint -- the "3.5 m elevation step" is flat
# ground, and the "unaccounted generator surface" is TQ01's palace dome. But proving the one corridor somebody
# complained about is the weakest possible reading of "every major region": the other two were never walked
# with an instrument that could fail, so their silence means nothing.
#
# So the same measurement runs on all three. ICARUS at 90 degrees, NOCTIS at 210, TARTARUS at 330 -- the
# bearings the nation passes were authored on.
#
# HOW IT MEASURES, and why each part is the way it is -- every one of these was a wrong answer first:
#
#   GROUND IS TRACED FROM 4 m, NOT FROM 40. A trace from high up hits ROOFS, and an axis profile built that
#   way reported twenty-metre terrain "cliffs" that were building tops.
#
#   THE CAPSULE IS THE DOG'S OWN, AND IT IS LIFTED. Swept flush with the floor it grazes the floor, and the
#   first run reported TQ01_Road as blocking the walk down the road.
#
#   A FLOOR IS NOT AN OBSTACLE. The impact normal decides: mostly-up is ground or a ramp, mostly-sideways is
#   a wall. Without that a kerb reads like a palace.
#
#   AND LANES, NOT A LINE. A built district blocks most straight lines -- that is what buildings are. The
#   corridor is walkable if ANY parallel lane is clean, which is what "can you get there" means.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "nation_routes")

#: The nations, on the bearings their own passes were authored on.
NATIONS = (("ICARUS", 90.0), ("NOCTIS", 210.0), ("TARTARUS", 330.0))

#: The gate outward. ARRIVAL IS NOT A FIXED DISTANCE -- it is the first step that stands on the nation's own
#: second band, which each nation reaches at its own radius. A fixed 1,000 m cutoff measured ICARUS and NOCTIS
#: as blocked by IC03_Palace_Pavilion_stone at 985 m and NC03_Palace_Wing_stone at 990 m: their palaces simply
#: begin a few metres inside the line I had drawn. Walking into a palace is architecture, not a traversal
#: fault, and the corridor's job is to get you TO the band -- after that you walk its streets.
FROM_M, TO_M, ALONG_STEP_M = 600.0, 1060.0, 10.0
#: Nine lanes at 16 m, not nineteen at 8. The fine version was ~5,200 sample points across three
#: nations and it outran the channel's 14-minute timeout twice, so the run kept reporting a RESTORED previous
#: result -- which is worse than slow, because it looks like a result. 16 m is still well inside the width of
#: an avenue, and the Dog's capsule is 0.36 m.
OFFSETS_M = tuple(float(o) for o in range(-64, 65, 16))

#: HitResult's field order, measured by zc_hit_shape. This engine's Python gives the struct NO named
#: attributes -- location, blocking_hit, component and get_editor_property for each all raise.
HIT_BLOCKING, HIT_LOCATION, HIT_IMPACT_NORMAL, HIT_ACTOR = 0, 4, 7, 9
WALL_NORMAL_Z = 0.7

_STEP = {"uu": 30.0}


def trace_down(world, x, y, top):
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
    """The floor a walker stands on -- from below the rooflines, falling back to the sky trace on open ground."""
    near = trace_down(world, x, y, 400.0)
    return near if near is not None else trace_down(world, x, y, 2500.0)


def blocked(world, ax, ay, az, bx, by, bz, radius, half_height, ignore):
    """What would actually stop a walker between two points: a surface standing up in front of them."""
    lift = half_height + max(_STEP["uu"], 1.0)
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
    try:
        if abs(float(t[HIT_IMPACT_NORMAL].z)) >= WALL_NORMAL_Z:
            return None
    except Exception:
        pass
    actor = t[HIT_ACTOR]
    name = ""
    if actor is not None:
        try:
            name = str(actor.get_actor_label())
        except Exception:
            name = str(actor.get_name())
    return {"by": name[:40], "normal_z": round(float(t[HIT_IMPACT_NORMAL].z), 3)}


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
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

    dogs = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.RelayDogCharacter)
    dog = dogs[0] if dogs else None
    radius, half_height = 34.0, 88.0
    if dog is not None:
        try:
            _STEP["uu"] = float(dog.character_movement.get_editor_property("max_step_height"))
        except Exception:
            pass
        try:
            caps = dog.capsule_component
            radius = float(caps.get_unscaled_capsule_radius())
            half_height = float(caps.get_unscaled_capsule_half_height())
        except Exception:
            pass
    RESULT["dog_limits"] = {"max_step_height_uu": _STEP["uu"], "capsule_radius_uu": round(radius, 1),
                            "capsule_half_height_uu": round(half_height, 1)}
    ignore = [dog] if dog is not None else []

    findings = {}
    RESULT["nations"] = findings

    for nation, degrees in NATIONS:
        bearing = math.radians(degrees)
        band_tag = {"ICARUS": "IC03", "NOCTIS": "NC03", "TARTARUS": "TQ03"}[nation]
        px, py = math.cos(bearing + math.pi / 2.0), math.sin(bearing + math.pi / 2.0)
        lanes, best, ticks = {}, None, 0
        for off in OFFSETS_M:
            hits, tall, no_ground, samples = [], [], 0, 0
            arrived_at = None
            metres, prev = FROM_M, None
            while metres <= TO_M and arrived_at is None:
                x = math.cos(bearing) * metres * 100.0 + px * off * 100.0
                y = math.sin(bearing) * metres * 100.0 + py * off * 100.0
                g = ground_at(world, x, y)
                if g is None:
                    no_ground += 1
                    prev = None
                else:
                    samples += 1
                    # ARRIVED. The nation's second band is the destination, and its own surfaces say when the
                    # corridor has reached it -- IC03 / NC03 / TQ03. Everything after this point is inside the
                    # band, where a wall is a building rather than a hole in the world.
                    if band_tag in (g["on"] or ""):
                        arrived_at = round(metres, 1)
                        break
                    if prev is not None:
                        if abs(g["z"] - prev[2]) > _STEP["uu"]:
                            tall.append({"at_m": round(metres, 1),
                                         "rise_uu": round(abs(g["z"] - prev[2]), 1),
                                         "from": prev[3], "to": g["on"]})
                        who = blocked(world, prev[0], prev[1], prev[2], x, y, g["z"],
                                      radius, half_height, ignore)
                        if who:
                            hits.append({"at_m": round(metres, 1), **who})
                    prev = (x, y, g["z"], g["on"])
                metres += ALONG_STEP_M
                ticks += 1
                if ticks % 25 == 0:
                    yield 0.0
            lane = {"offset_m": off, "samples": samples, "no_ground": no_ground,
                    "arrived_at_m": arrived_at,
                    "steps_too_tall": len(tall), "blocked_segments": len(hits),
                    "blockers": hits[:3], "tall_steps": tall[:3]}
            lanes["%+d" % int(off)] = lane
            # A lane that ARRIVES beats one that merely has few blockers; among arrivals, fewest obstacles.
            key = (0 if lane["arrived_at_m"] else 1, lane["blocked_segments"],
                   lane["steps_too_tall"], lane["no_ground"])
            best_key = None if best is None else (0 if best["arrived_at_m"] else 1,
                                                  best["blocked_segments"], best["steps_too_tall"],
                                                  best["no_ground"])
            if best_key is None or key < best_key:
                best = lane
        clean = [k for k, v in lanes.items()
                 if v["arrived_at_m"] and v["blocked_segments"] == 0
                 and v["steps_too_tall"] == 0 and v["no_ground"] == 0]
        findings[nation] = {"bearing": degrees, "best": best, "clean_lanes": clean,
                            "lanes_tried": len(OFFSETS_M)}

        # A look down the lane that works, or down the least-bad one if none does.
        if best is not None:
            mid = (FROM_M + TO_M) / 2.0
            x = math.cos(bearing) * mid * 100.0 + px * best["offset_m"] * 100.0
            y = math.sin(bearing) * mid * 100.0 + py * best["offset_m"] * 100.0
            g = ground_at(world, x, y)
            if g is not None:
                if dog is not None:
                    dog.set_actor_location(unreal.Vector(x, y, g["z"] + half_height + 20.0), False, False)
                    yield 0.8
                L.pose_camera(world, unreal.Vector(x - 2400.0, y + 1600.0, g["z"] + 1000.0),
                              unreal.Vector(x, y, g["z"]), 62.0)
                yield 1.0
                H.capture_viewport_jpeg(os.path.join(ROOT, "%s_best_lane.jpg" % nation.lower()), 1500, 90)
                L.release_camera(world)

        record("R_%s" % nation, "%s: a corridor from the gate to the band is walkable end to end" % nation,
               best is not None and best["arrived_at_m"] is not None
               and best["blocked_segments"] == 0
               and best["steps_too_tall"] == 0 and best["no_ground"] == 0,
               bearing=degrees, best_offset_m=best["offset_m"] if best else None,
               arrived_at_m=best["arrived_at_m"] if best else None,
               blocked_segments=best["blocked_segments"] if best else None,
               steps_too_tall=best["steps_too_tall"] if best else None,
               clean_lanes=len(clean), of=len(OFFSETS_M),
               worst_blockers=best["blockers"] if best else None,
               worst_steps=best["tall_steps"] if best else None,
               note="swept with the Dog's own capsule over %d parallel lanes, %d-%d m" % (
                   len(OFFSETS_M), int(FROM_M), int(TO_M)))

    every = all(t["pass"] for t in tests)
    record("R_ALL", "every nation has a walkable gate-to-band corridor", every,
           nations=[n for n, _ in NATIONS],
           clean_lanes={n: len(v["clean_lanes"]) for n, v in findings.items()},
           note="the founder's 'walk-test every major region', asked of all three rather than of the one "
                "that had a complaint")

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
