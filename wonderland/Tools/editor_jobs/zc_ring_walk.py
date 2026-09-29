# THE RING ROADS, WALKED: does the Dog stand on the paving of RR01 / RR02 all the way round, in play?
#
# Built 2026-09-28 (CORE C2 proof). The rings are colliding SM_terrace_platform floor with its top at +12, laid on
# the -14 lawn; a stand that lands at -14 means the road is not there in play (streaming, a gap, a refused plate)
# and the walker is on grass beside it. The procedure is the WORLD session's W270 proof, which was wrong once and
# fixed: the Dog is HELD above the stand with movement off while World Partition streams the cell in -- waited on
# World Partition itself (IsWorldPartitionStreamingComplete, not a delay) -- the surface is traced only then, the
# Dog is dropped from 9 m over it, and it must come to rest walking with its feet within 8 cm of the plate top
# (paving +12 vs lawn -14 is 26 cm). Stands are real plate centres read from the applied specs, spread evenly by
# bearing round each ring. Two stands per ring are photographed from behind the Dog.
#
# PIE-owning: CONCURRENT is False. Restores wl.Sky.DayMinutes on every exit. No map edit, no save.
CONCURRENT = False

import json
import math
import os
import time
import unreal

L = unreal.WonderlandUiTestLibrary
ROOT = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "Tools", "captures", "zc", "ring_walk_0928")
SPECS = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "WorldDesign", "Rings")
PER_RING = 16
FEET = 89.2                 # capsule half-height: landed actor z minus this is the feet (W270 proof)


def _stands():
    out = []
    for ring, name in (("RR01", "rr01_march_ring.json"), ("RR02", "rr02_outer_ring.json")):
        spec = json.load(open(os.path.join(SPECS, name), encoding="utf-8"))
        plates = [i for b in spec["batches"] if "_Plate_" in b["id"] for i in b["instances"]]
        plates.sort(key=lambda p: math.atan2(p[1], p[0]) % (2 * math.pi))
        step = len(plates) / float(PER_RING)
        for k in range(PER_RING):
            p = plates[int(k * step)]
            top = p[2] + 140.0                     # plate pivot + its own height = the walking surface
            out.append(("%s_%02d_%03.0fdeg" % (ring, k, math.degrees(math.atan2(p[1], p[0])) % 360.0),
                        p[0], p[1], top, k in (3, 11)))
    return out


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    found = unreal.SystemLibrary.get_console_variable_float_value("wl.Sky.DayMinutes")
    RESULT["status"] = "running"
    try:
        yield from _walk(ues, les)
    finally:
        unreal.SystemLibrary.execute_console_command(ues.get_editor_world(), "wl.Sky.DayMinutes %s" % found)
        if ues.get_game_world() is not None:
            try:
                L.release_camera(ues.get_game_world())
            except Exception:                                          # noqa: BLE001
                pass
            les.editor_request_end_play()


def _walk(ues, les):
    os.makedirs(ROOT, exist_ok=True)
    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    L.focus_game_viewport()
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

    def down(x, y, z_top, z_bot, ignore):
        try:
            hit = unreal.SystemLibrary.line_trace_single(
                world(), unreal.Vector(x, y, z_top), unreal.Vector(x, y, z_bot),
                unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [ignore] if ignore else [],
                unreal.DrawDebugTrace.NONE, True, unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        except Exception:                                              # noqa: BLE001
            return None
        if hit is None:
            return None
        t = hit.to_tuple()
        return float(t[4].z) if t[0] else None

    rows = []
    RESULT["stands"] = rows
    for (name, x, y, top, photo) in _stands():
        p = pawn()
        if p is None:
            RESULT["died_at"] = name
            break
        try:
            p.character_movement.disable_movement()
            p.set_actor_location(unreal.Vector(x, y, top + 2500.0), False, True)
            p.character_movement.set_editor_property("velocity", unreal.Vector(0, 0, 0))
        except Exception:                                              # noqa: BLE001
            pass
        yield 0.4
        unreal.SystemLibrary.execute_console_command(world(), "FlushLevelStreaming")
        complete = [False]

        def streamed():
            w = world()
            complete[0] = w is not None and L.is_world_partition_streaming_complete(w)
            return complete[0]

        try:
            yield (streamed, 20.0)
        except TimeoutError:
            pass
        yield 0.5
        p = pawn()
        if p is None:
            RESULT["died_at"] = name
            break
        # traced from 5 m over the plate top, so a canopy or a lantern arm overhead is not read as the floor
        surf = down(x, y, top + 500.0, top - 3000.0, p)
        mc = p.character_movement
        try:
            p.set_actor_location(unreal.Vector(x, y, (surf if surf is not None else top) + 900.0), False, True)
            mc.set_editor_property("velocity", unreal.Vector(0, 0, 0))
            mc.set_movement_mode(unreal.MovementMode.MOVE_FALLING)
        except Exception:                                              # noqa: BLE001
            pass
        t0, last, landed, mode = time.time(), None, False, None
        while time.time() - t0 < 10.0:
            yield 0.25
            p = pawn()
            if p is None:
                break
            z = float(p.get_actor_location().z)
            mode = str(p.character_movement.get_editor_property("movement_mode"))
            walking = "WALKING" in mode.upper()
            if walking and last is not None and abs(z - last) < 2.0:
                landed = True
                break
            last = z if walking else None
        p = pawn()
        feet = (float(p.get_actor_location().z) - FEET) if p else None
        ok = landed and feet is not None and abs(feet - top) <= 8.0
        row = {"stand": name, "x": round(x), "y": round(y), "plate_top": round(top, 1),
               "streaming_complete": complete[0], "surface_traced": None if surf is None else round(surf, 1),
               "landed": landed, "feet_z": None if feet is None else round(feet, 1), "pass": ok}
        if photo and p is not None and ok:
            here = p.get_actor_location()
            yaw = math.degrees(math.atan2(y, x)) + 90.0          # look along the ring
            eye = unreal.Vector(here.x - math.cos(math.radians(yaw)) * 1400.0,
                                here.y - math.sin(math.radians(yaw)) * 1400.0, here.z + 450.0)
            L.pose_camera(world(), eye, unreal.Vector(here.x, here.y, here.z), 60.0)
            yield 1.5
            unreal.GameplayStatics.set_game_paused(world(), True)
            yield 0.4
            shot = os.path.join(ROOT, "%s.png" % name)
            L.capture_game_viewport(shot)
            unreal.GameplayStatics.set_game_paused(world(), False)
            L.release_camera(world())
            row["shot"] = os.path.basename(shot) if os.path.isfile(shot) else None
        rows.append(row)
        emit(name, "PASS" if ok else "FAIL", row)
    passed = sum(1 for r in rows if r["pass"])
    RESULT["verdict"] = {"stands": len(rows), "pass": passed,
                         "streaming_complete": sum(1 for r in rows if r["streaming_complete"])}
    RESULT["status"] = "proved" if rows and passed == len(rows) else "FAIL: %d of %d stands" % (passed, len(rows))
