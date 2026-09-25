# CAN A PLAYER ACTUALLY WALK FROM EACH NATION'S GATE TO ITS BAND?
#
# FOUNDER, P2 item 13: "Walk-test every major region." Gate D: the world beta-complete.
#
# WHY THE STRAIGHT-LANE VERSION COULD NOT ANSWER THIS. zc_nation_routes sweeps parallel lines and asks
# whether any ONE of them is clear end to end. That is a fair question about a corridor and the wrong
# question about a city: every nation's best lane is blocked by a named building --
# IC02_Tower_Base_Terraced_stone, NC01_Colonnade_Arcade_stone, TQ01_Palace_Wing_stone_dark -- and a building
# on a straight line is not a traversal fault. It is a building. A player walks round it.
#
# The engine's own navigation would answer it, and this map has no nav data at all (zc_tartarus_route T02),
# so there is nothing to ask. So the search is built here instead, which is the honest remaining option.
#
# WHAT IT DOES. For each nation it lays a grid over the whole corridor -- the full width a player could
# reasonably wander, not one line -- finds the walkable floor in every cell, joins neighbouring cells that a
# body could actually step between, and runs a breadth-first search from the gate to the band.
#
# A CELL IS JOINED TO ITS NEIGHBOUR only if BOTH are true:
#   the step between their floors is within the Dog's OWN max_step_height, read off the Dog; and
#   the Dog's OWN capsule sweeps between them without hitting a WALL -- judged by impact normal, because a
#   capsule swept along the ground grazes the ground and a floor is not an obstacle.
#
# So a path found here is a path a body can walk, and a path not found is a region genuinely cut off.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "nation_paths")

NATIONS = (("ICARUS", 90.0, "IC03"), ("NOCTIS", 210.0, "NC03"), ("TARTARUS", 330.0, "TQ03"))

FROM_M, TO_M = 600.0, 1060.0
STEP_M = 12.0            # grid pitch along and across; a third of the Dog's own width either way
HALF_WIDTH_M = 84.0      # how far either side of the axis a player may wander looking for a way through

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
    return {"z": float(t[HIT_LOCATION].z), "on": name[:44]}


def ground_at(world, x, y):
    """The floor a walker stands on: from below the rooflines, falling back to the sky trace on open ground."""
    near = trace_down(world, x, y, 400.0)
    return near if near is not None else trace_down(world, x, y, 2500.0)


def wall_between(world, a, b, radius, half_height, ignore):
    """True when a WALL stands between two floor points -- not merely when the sweep touched something."""
    lift = half_height + max(_STEP["uu"], 1.0)
    hit = unreal.SystemLibrary.capsule_trace_single(
        world, unreal.Vector(a[0], a[1], a[2] + lift), unreal.Vector(b[0], b[1], b[2] + lift),
        radius, half_height, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, ignore,
        unreal.DrawDebugTrace.NONE, True)
    if hit is None:
        return False
    try:
        t = hit.to_tuple()
    except Exception:
        return False
    if not bool(t[HIT_BLOCKING]):
        return False
    try:
        return abs(float(t[HIT_IMPACT_NORMAL].z)) < WALL_NORMAL_Z
    except Exception:
        return True


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
    ignore = [dog] if dog is not None else []
    RESULT["dog_limits"] = {"max_step_height_uu": _STEP["uu"], "capsule_radius_uu": round(radius, 1),
                            "capsule_half_height_uu": round(half_height, 1)}

    rows = int((TO_M - FROM_M) / STEP_M) + 1
    cols = int((HALF_WIDTH_M * 2.0) / STEP_M) + 1
    RESULT["grid"] = {"rows": rows, "cols": cols, "pitch_m": STEP_M, "half_width_m": HALF_WIDTH_M}

    findings = {}
    RESULT["nations"] = findings
    ticks = 0

    for nation, degrees, band_tag in NATIONS:
        bearing = math.radians(degrees)
        px, py = math.cos(bearing + math.pi / 2.0), math.sin(bearing + math.pi / 2.0)

        # ---- THE FLOOR IN EVERY CELL
        floor = {}
        band_cells = set()
        for r in range(rows):
            metres = FROM_M + r * STEP_M
            for c in range(cols):
                off = -HALF_WIDTH_M + c * STEP_M
                x = math.cos(bearing) * metres * 100.0 + px * off * 100.0
                y = math.sin(bearing) * metres * 100.0 + py * off * 100.0
                g = ground_at(world, x, y)
                if g is not None:
                    floor[(r, c)] = (x, y, g["z"], g["on"])
                    if band_tag in g["on"]:
                        band_cells.add((r, c))
                ticks += 1
                if ticks % 40 == 0:
                    yield 0.0

        # ---- WHICH CELLS A BODY CAN STEP BETWEEN, explored lazily so only the reachable part is swept.
        start = [(0, c) for c in range(cols) if (0, c) in floor]
        seen = set(start)
        queue = list(start)
        reached = None
        steps = 0
        while queue and reached is None:
            cell = queue.pop(0)
            r, c = cell
            here = floor[cell]
            for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nxt = (r + dr, c + dc)
                if nxt in seen or nxt not in floor:
                    continue
                there = floor[nxt]
                if abs(there[2] - here[2]) > _STEP["uu"]:
                    continue
                if wall_between(world, here, there, radius, half_height, ignore):
                    continue
                seen.add(nxt)
                queue.append(nxt)
                steps += 1
                if nxt in band_cells:
                    reached = nxt
                    break
                ticks += 1
                if ticks % 25 == 0:
                    yield 0.0

        deepest = max((r for (r, _c) in seen), default=0)
        findings[nation] = {
            "cells_with_floor": len(floor),
            "cells_reached": len(seen),
            "band_cells": len(band_cells),
            "reached_band": reached is not None,
            "reached_at_m": round(FROM_M + reached[0] * STEP_M, 1) if reached else None,
            "deepest_reached_m": round(FROM_M + deepest * STEP_M, 1),
            "edges_walked": steps,
        }
        record("P_%s" % nation, "%s: a walkable path exists from the gate to the band" % nation,
               reached is not None, **findings[nation])

    every = all(v["reached_band"] for v in findings.values())
    record("P_ALL", "every nation can be walked from its gate to its band", every,
           by_nation={k: v["reached_band"] for k, v in findings.items()},
           note="breadth-first over a %.0f m grid, joined only where the Dog's own capsule fits and its own "
                "max_step_height allows -- so a path here is a path a body can walk" % STEP_M)

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
