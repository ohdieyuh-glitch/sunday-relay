# THE HEARTLAND GARDEN WALKS, PROVEN IN PLAY: can the Dog stand along each walk, is the walk clear end to end,
# and can every garden room be entered through a door?
#
# Reads the sidecars WorldDesign/Wedges/<id>_walk.json that sector_fill.py writes beside each spec: the walk as a
# world polyline (every 5 m) and every group with its centre and door points. Three instruments, as in the W270
# proof, and streaming GATED ON WORLD PARTITION ITSELF (is_world_partition_streaming_complete, Core's wrapper of
# 2026-09-28) after a flush -- not on a fixed wait, which has been fooled three ways this week:
#   S  STANDS every ~60 m of walk: the Dog is dropped 9 m above the surface traced from 5 m over the ground (so a
#      hedge or trunk standing ON the walk reads as a surface and fails), and read once it has LANDED. Pass = the
#      feet within 8 cm of that surface AND the surface is ground: lawn (-14) or paving (+12), +/-15 cm.
#   C  CLEARANCE: a Dog-sized capsule swept along the walk at the local floor, against WORLD STATIC and WORLD
#      DYNAMIC only (what a pawn collides with).
#   R  ROOMS: from each door point a capsule is swept to 3 m inside the room; a room passes if a door admits it.
# PIE-owning: CONCURRENT is False. Restores wl.Sky.DayMinutes on every exit.
CONCURRENT = False
import json
import math
import os
import time

L = unreal.WonderlandUiTestLibrary
PROOFS = globals().get("PROOFS", [os.path.join(r"C:\dev\iwonder\wonderland-task3\wonderland\WorldDesign\Wedges", f)
                                  for f in ("ht356_walk.json", "hn181_walk.json", "hn238_walk.json",
                                            "hi057_walk.json", "ht308_walk.json")])
CAPSULE_R, CAPSULE_HH = 45.0, 89.0
GROUND = (-14.0, 12.0)


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    found = unreal.SystemLibrary.get_console_variable_float_value("wl.Sky.DayMinutes")
    RESULT["day_minutes_found"] = found
    RESULT["status"] = "running"
    try:
        yield from _prove(ues, les)
    finally:
        unreal.SystemLibrary.execute_console_command(ues.get_editor_world(), "wl.Sky.DayMinutes %s" % found)
        RESULT["day_minutes_restored"] = unreal.SystemLibrary.get_console_variable_float_value("wl.Sky.DayMinutes")
        if ues.get_game_world() is not None:
            les.editor_request_end_play()


def _prove(ues, les):
    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0

    def world():
        return ues.get_game_world()

    def pawn():
        try:
            p = unreal.GameplayStatics.get_player_pawn(world(), 0)
            if p is None:
                return None
            p.get_actor_location()
            return p
        except Exception:                                              # noqa: BLE001
            return None

    unreal.SystemLibrary.execute_console_command(world(), "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world(), "wl.Sky.Hour 11.0")
    objs = [unreal.ObjectTypeQuery.OBJECT_TYPE_QUERY1, unreal.ObjectTypeQuery.OBJECT_TYPE_QUERY2]

    def down(x, y, ignore=None, z_top=500.0):
        try:
            hit = unreal.SystemLibrary.line_trace_single(
                world(), unreal.Vector(x, y, z_top), unreal.Vector(x, y, -3000.0),
                unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [ignore] if ignore else [],
                unreal.DrawDebugTrace.NONE, True, unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        except Exception:                                              # noqa: BLE001
            return None
        return None if hit is None else float(hit.to_tuple()[4].z)

    def sweep(a, b, ignore):
        try:
            hit = unreal.SystemLibrary.capsule_trace_single_for_objects(
                world(), a, b, CAPSULE_R, CAPSULE_HH, objs, False, [ignore] if ignore else [],
                unreal.DrawDebugTrace.NONE, True, unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        except Exception as exc:                                       # noqa: BLE001
            RESULT["capsule_error"] = repr(exc)
            return None
        if hit is None:
            return None
        t = hit.to_tuple()
        return t[9].get_actor_label() if t[9] is not None else "?"

    def settle_at(x, y):
        """Hold the Dog 25 m over (x, y), flush, and wait until World Partition says streaming is complete."""
        p = pawn()
        if p is None:
            return None, False
        try:
            p.character_movement.disable_movement()
            p.set_actor_location(unreal.Vector(x, y, 2500.0), False, True)
            p.character_movement.set_editor_property("velocity", unreal.Vector(0, 0, 0))
        except Exception:                                              # noqa: BLE001
            pass
        yield 0.3
        unreal.SystemLibrary.execute_console_command(world(), "FlushLevelStreaming")
        t0 = time.time()
        done = False
        while time.time() - t0 < 20.0:
            yield 0.25
            try:
                done = bool(L.is_world_partition_streaming_complete(world()))
            except Exception as exc:                                   # noqa: BLE001
                RESULT["streaming_query_error"] = repr(exc)
                done = False
                break
            if done:
                break
        return pawn(), done

    regions = []
    for path in PROOFS:
        side = json.load(open(path, encoding="utf-8"))
        walk = side["walk"]
        rep = {"pass": side["pass"], "walk_points": len(walk), "stands": [], "blocked": [], "rooms": [],
               "streaming_incomplete": 0}
        if len(walk) < 2:
            rep["error"] = "no walk in the sidecar"
            regions.append(rep)
            continue
        # ---- S and C, in stretches of 12 points (~60 m): settle over the stretch's middle, then stand and sweep
        k = 0
        while k < len(walk) - 1:
            stretch = walk[k:min(len(walk), k + 13)]
            mx, my = stretch[len(stretch) // 2]
            p, done = yield from settle_at(mx, my)
            if p is None:
                rep["died_at"] = k
                break
            if not done:
                rep["streaming_incomplete"] += 1
            # the stand, at the stretch's first point
            x, y = stretch[0]
            surf = down(x, y, ignore=p)
            try:
                p.set_actor_location(unreal.Vector(x, y, (surf if surf is not None else -14.0) + 900.0), False, True)
                p.character_movement.set_editor_property("velocity", unreal.Vector(0, 0, 0))
                p.character_movement.set_movement_mode(unreal.MovementMode.MOVE_FALLING)
            except Exception:                                          # noqa: BLE001
                pass
            t0, last, landed = time.time(), None, False
            while time.time() - t0 < 10.0:
                yield 0.25
                p = pawn()
                if p is None:
                    break
                z = float(p.get_actor_location().z)
                walking = "WALKING" in str(p.character_movement.get_editor_property("movement_mode")).upper()
                if walking and last is not None and abs(z - last) < 2.0:
                    landed = True
                    break
                last = z if walking else None
            p = pawn()
            feet = (float(p.get_actor_location().z) - 89.2) if p else None
            is_ground = surf is not None and any(abs(surf - gz) <= 15.0 for gz in GROUND)
            ok = landed and feet is not None and surf is not None and abs(feet - surf) <= 8.0 and is_ground
            rep["stands"].append({"at": [round(x), round(y)], "surface": None if surf is None else round(surf, 1),
                                  "feet": None if feet is None else round(feet, 1), "landed": landed,
                                  "ground": is_ground, "pass": ok})
            # hold the Dog up out of the way for the sweeps
            try:
                p.character_movement.disable_movement()
                p.set_actor_location(unreal.Vector(mx, my, 2500.0), False, True)
            except Exception:                                          # noqa: BLE001
                pass
            for q in range(len(stretch) - 1):
                (x0, y0), (x1, y1) = stretch[q], stretch[q + 1]
                z0 = down(x0, y0, ignore=p)
                if z0 is None:
                    continue
                zc = z0 + CAPSULE_HH + 60.0
                who = sweep(unreal.Vector(x0, y0, zc), unreal.Vector(x1, y1, zc), p)
                if who is not None:
                    rep["blocked"].append({"at": [round(x0), round(y0)], "by": who})
            k += 12
            yield 0.0
        # ---- R: every garden room through a door
        for gdef in side["groups"]:
            if gdef["kind"] not in ("room", "quarter_room"):
                continue
            cx, cy = gdef["centre"]
            p, done = yield from settle_at(cx, cy)
            if p is None:
                rep["died_at"] = "room"
                break
            if not done:
                rep["streaming_incomplete"] += 1
            admitted = []
            for (dx, dy) in gdef["doors"]:
                vx, vy = cx - dx, cy - dy
                n = math.hypot(vx, vy) or 1.0
                ix, iy = cx - vx / n * 300.0, cy - vy / n * 300.0       # 3 m inside, short of the centre rose
                z0 = down(dx, dy, ignore=p)
                if z0 is None:
                    continue
                zc = z0 + CAPSULE_HH + 60.0
                who = sweep(unreal.Vector(dx, dy, zc), unreal.Vector(ix, iy, zc), p)
                admitted.append(who is None)
            rep["rooms"].append({"centre": [round(cx), round(cy)], "kind": gdef["kind"],
                                 "doors_open": sum(1 for a in admitted if a), "doors": len(admitted),
                                 "pass": any(admitted)})
            yield 0.0
        rep["verdict"] = {"stands_pass": sum(1 for s in rep["stands"] if s["pass"]), "stands": len(rep["stands"]),
                          "walk_blocks": len(rep["blocked"]),
                          "rooms_enterable": sum(1 for r in rep["rooms"] if r["pass"]), "rooms": len(rep["rooms"]),
                          "streaming_incomplete": rep["streaming_incomplete"]}
        emit(side["pass"], rep["verdict"])
        regions.append(rep)
    RESULT["regions"] = regions
    ok = all(r.get("verdict") and r["verdict"]["stands_pass"] == r["verdict"]["stands"]
             and r["verdict"]["walk_blocks"] == 0 and r["verdict"]["rooms_enterable"] == r["verdict"]["rooms"]
             and r["verdict"]["streaming_incomplete"] == 0 for r in regions)
    RESULT["status"] = "proved" if ok else "measured (see regions)"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
