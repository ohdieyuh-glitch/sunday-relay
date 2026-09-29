# THE REAR SEAM, PROVEN IN PLAY: can the Dog stand on every new place, and is the way continuous end to end?
#
# Three independent instruments, because each answers a different question and each has fooled this project
# before when used alone:
#   S  STANDS -- the Dog dropped 9 m above the traced top surface and read only once it has LANDED (WALKING and
#      still across a wait; zc_beta_walk's rule). Pass = it came to rest within 40 cm of the floor it was
#      dropped on. A stand is the only one of the three that uses the character's own collision.
#   F  FLOOR -- a downward trace every 2 m along the way's centreline, 504 m to 1,118 m. A gap (no floor) or a
#      step of more than 45 cm between neighbours fails. This is the walk the founder asked for, without the
#      walk harness whose distances do not repeat on this machine.
#   C  CLEARANCE -- a Dog-sized capsule swept along the same line, 1 m above the floor, against WORLD STATIC and
#      WORLD DYNAMIC objects only: what a pawn actually collides with. Grass and flowers without collision are
#      not walls, and a visibility trace would have called them walls.
# Condition 5 of Core's hedge-gate approval is F and C through 850-1,040 m plus the gate stands (G*).
#
# PIE-owning: CONCURRENT is False. Restores wl.Sky.DayMinutes on every exit. Asserts world and pawn before
# every reading and records where it died rather than emitting constants.
import math
import time

L = unreal.WonderlandUiTestLibrary
CAPSULE_R, CAPSULE_HH = 45.0, 89.0
PAVING_TOP_Z = 12.0          # the way's paving top; the floor profile traces from 5 m above it
STANDS = [
    # name, x, y, expected floor z (+12 paving, -14 lawn)
    ("S01_rear_path", -720.0, -52500.0, 12.0),
    ("S02_march_plaza", 0.0, -64500.0, 12.0),
    ("S03_noctis_court_A", -5000.0, -71500.0, 12.0),
    ("S04_tartarus_court_A", 5000.0, -71500.0, 12.0),
    ("S05_clock_plaza", -2000.0, -78500.0, 12.0),
    ("S06_noctis_street", -5140.0, -80500.0, 12.0),
    ("S07_tartarus_street", 5140.0, -80500.0, 12.0),
    ("S08_exchange_plaza", -2200.0, -105500.0, 12.0),
    ("S09_noctis_court_B", -6480.0, -107500.0, 12.0),
    ("S10_tartarus_court_B", 6480.0, -107500.0, 12.0),
    ("S11_frontier_end", 0.0, -111300.0, 12.0),
    ("S12_noctis_garden_lawn", -12400.0, -73500.0, -14.0),
    ("S13_tartarus_meadow_lawn", 22000.0, -79000.0, -14.0),
    ("G01_gate_entry", 0.0, -85500.0, 12.0),
    ("G02_gate_a", 0.0, -89000.0, 12.0),
    ("G03_gate_b", 0.0, -93800.0, 12.0),
    ("G04_gate_c", 720.0, -99000.0, 12.0),
    ("G05_gate_exit", 0.0, -103000.0, 12.0),
]


def line_x(u):
    """Where a walker goes at distance u (cm): the west column to the march plaza, then the axis; round the
    WEST side of the two centrepieces that stand on the axis by design (the pocket watch at 800 m, the pavilion
    at 1,075 m -- walked round, not through, so they must not read as walls); and the east column past the
    third hedge (971-1,014 m), where the west column is refused."""
    if u < 61500.0:
        return -720.0
    if 77200.0 <= u <= 82800.0 or 104600.0 <= u <= 110400.0:
        return -2000.0
    if 97100.0 <= u <= 101400.0:
        return 720.0
    return 0.0


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

    def down(x, y, z_top=3000.0, z_bot=-3000.0, ignore=None):
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
        return float(t[4].z)

    # THE FIRST RUN OF THIS PROOF REPORTED "proved", 18/18, AND WAS WRONG. It traced each stand BEFORE moving
    # the Dog there, so a cell World Partition had not yet streamed in read as the lawn at -14; the Dog was
    # dropped from there and fell past paving that arrived too late; and a 40 cm tolerance passed feet at -14
    # against paving at +12 -- 26 cm apart. Three fixes: the Dog is HELD above the point while
    # FlushLevelStreaming drains the queue, the surface is traced only after that, and the tolerance is 8 cm.
    def hold_and_flush(x, y, z):
        p = pawn()
        if p is None:
            return None
        try:
            p.character_movement.disable_movement()
            p.set_actor_location(unreal.Vector(x, y, z), False, True)
            p.character_movement.set_editor_property("velocity", unreal.Vector(0, 0, 0))
        except Exception:                                              # noqa: BLE001
            pass
        return pawn()

    def flush():
        # after the teleport has been SEEN (a frame has passed, so the streaming source has moved)
        unreal.SystemLibrary.execute_console_command(world(), "FlushLevelStreaming")

    # ---- S / G: stands
    stands = []
    for (name, x, y, floor) in STANDS:
        p = hold_and_flush(x, y, floor + 2500.0)
        if p is None:
            RESULT["died_at"] = name
            break
        yield 0.3
        flush()
        yield 0.7
        p = pawn()
        if p is None:
            RESULT["died_at"] = name
            break
        surf = down(x, y, ignore=p)
        drop = (surf if surf is not None else floor) + 900.0
        mc = p.character_movement
        try:
            p.set_actor_location(unreal.Vector(x, y, drop), False, True)
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
        z = float(p.get_actor_location().z) if p else None
        feet = (z - 89.2) if z is not None else None
        ok = landed and feet is not None and abs(feet - floor) <= 8.0     # paving +12 vs lawn -14 is 26 cm
        stands.append({"name": name, "x": x, "y": y, "surface_traced": surf, "landed": landed,
                       "feet_z": round(feet, 1) if feet is not None else None, "floor_expected": floor, "pass": ok,
                       "mode": mode})
        emit(name, "PASS" if ok else "FAIL", stands[-1])
    RESULT["stands"] = stands

    # ---- F and C, advancing: the Dog is held over each 60 m stretch while streaming is flushed, and only then
    # is that stretch traced and swept. A stretch the pawn is not near may not be loaded, and an unloaded
    # stretch of paving reads as lawn -- which the first run could not tell from paving.
    floor, gaps, unpaved, steps, blocked = [], [], [], [], []
    objs = [unreal.ObjectTypeQuery.OBJECT_TYPE_QUERY1, unreal.ObjectTypeQuery.OBJECT_TYPE_QUERY2]
    prev = None
    seg = 50400.0 + 740.0
    while seg < 111800.0:
        p = hold_and_flush(line_x(seg + 3000.0), -(seg + 3000.0), 3000.0)
        if p is None:
            RESULT["died_at"] = "floor %.0f m" % (seg / 100.0)
            break
        yield 0.3
        flush()
        yield 0.5
        p = pawn()
        if p is None:
            RESULT["died_at"] = "floor %.0f m" % (seg / 100.0)
            break
        # THE FLOOR IS TRACED FROM 5 m ABOVE THE PAVING, NOT FROM 30 m. From 30 m the trace met the CROWNS of
        # the arches the way passes under (the rose arches at 845 and 1,025 m, 13.8 m; the ceremonial arch at
        # 907-913 m, 25.8 m) and zzW15 logged them as 7 "steps" in a floor a walker never leaves.
        # AND THE STRETCH IS READ UNTIL IT HOLDS STILL: zzW15 read 511-561 m as lawn, straight after the jump
        # back from 1,030 m, while its own stand S01 at 525 m stood on the paving. Two readings a second apart
        # that agree, or six tries.
        us = []
        u = seg
        while u < min(seg + 6000.0, 111800.0):
            us.append(u)
            u += 200.0
        reading, settled = None, False
        for _ in range(6):
            again = [down(line_x(uu), -uu, z_top=PAVING_TOP_Z + 500.0, ignore=p) for uu in us]
            if again == reading:
                settled = True
                break
            reading = again
            yield 1.0
        if not settled:
            RESULT.setdefault("floor_unsettled_m", []).append(round(seg / 100.0))
        for u, z in zip(us, reading):
            x = line_x(u)
            floor.append((round(u / 100.0, 1), None if z is None else round(z, 1)))
            if z is None or z < -1000.0:
                gaps.append(round(u / 100.0, 1))
            else:
                if z < 5.0:                                        # the way is paved at +12; -14 is lawn
                    unpaved.append((round(u / 100.0, 1), round(z, 1)))
                if prev is not None and abs(z - prev) > 45.0:
                    steps.append((round(u / 100.0, 1), round(prev, 1), round(z, 1)))
                prev = z
                if u + 200.0 < 111800.0:
                    x1 = line_x(u + 200.0)
                    a = unreal.Vector(x, -u, z + CAPSULE_HH + 60.0)
                    b = unreal.Vector(x1, -(u + 200.0), z + CAPSULE_HH + 60.0)
                    try:
                        hit = unreal.SystemLibrary.capsule_trace_single_for_objects(
                            world(), a, b, CAPSULE_R, CAPSULE_HH, objs, False, [p],
                            unreal.DrawDebugTrace.NONE, True, unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
                    except Exception as exc:                            # noqa: BLE001
                        RESULT["capsule_error"] = repr(exc)
                        hit = None
                    if hit is not None:
                        t = hit.to_tuple()
                        blocked.append((round(u / 100.0, 1), t[9].get_actor_label() if t[9] is not None else "?"))
        seg += 6000.0
    RESULT["floor_samples"] = len(floor)
    RESULT["floor_gaps_m"] = gaps
    RESULT["floor_unpaved"] = unpaved[:80]
    RESULT["floor_unpaved_count"] = len(unpaved)
    RESULT["floor_steps"] = steps
    RESULT["floor_profile_every_10m"] = floor[::5]
    RESULT["capsule_blocked"] = blocked[:80]
    RESULT["capsule_blocked_count"] = len(blocked)

    gate_stands = [s for s in stands if s["name"].startswith("G")]
    in_gate = lambda m: 830.0 <= m <= 1040.0                              # noqa: E731
    RESULT["verdict"] = {
        "stands_pass": sum(1 for s in stands if s["pass"]), "stands": len(stands),
        "gate_stands_pass": sum(1 for s in gate_stands if s["pass"]), "gate_stands": len(gate_stands),
        "floor_gaps": len(gaps), "floor_unpaved": len(unpaved), "floor_steps_over_45cm": len(steps),
        "capsule_blocks": len(blocked),
        "GATE_OPEN": (not [g for g in gaps if in_gate(g)] and not [u_ for u_, _ in unpaved if in_gate(u_)]
                      and not [b for b in blocked if in_gate(b[0])]
                      and all(s["pass"] for s in gate_stands)),
    }
    RESULT["status"] = "proved" if (RESULT["verdict"]["stands_pass"] == len(stands) and not gaps and not unpaved
                                    and not steps and not blocked) else "measured (see verdict)"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
