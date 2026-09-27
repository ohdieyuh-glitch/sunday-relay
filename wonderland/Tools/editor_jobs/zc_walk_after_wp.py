# IS THERE STILL GROUND UNDER THE WORLD, NOW THAT IT PAGES?
#
# The one question the World Partition conversion actually puts at risk. Coverage already survives it
# unchanged -- zc_beta_walk re-measured 113 tiles from the Arrival Gate to 1.2 km with no holes -- but a
# converted map could have lost collision, and a streamed cell that never arrives is a hole that only appears
# at runtime.
#
# WHY THIS EXISTS RATHER THAN THE BIG WALK. zc_beta_walk answers this as part of a much larger job, and under
# streaming that job stopped finishing: it enumerates every mesh actor in a world that is now paging in and
# out underneath it, and twice ran into the channel's thirty-minute cap having recorded nothing at all. A
# purpose-built instrument that answers one question in two minutes is worth more than a thorough one that
# never returns.
#
# THE METHOD, and every part of it is there because a simpler version failed.
#   * The Dog is teleported to the tile and HELD there, position and velocity both reset every tick, while a
#     downward trace asks whether the ground has arrived. Holding is necessary because the destination cell is
#     not loaded at the moment of the teleport -- it only begins streaming because the player just became a
#     streaming source there.
#   * Velocity is reset as well as position. Re-placing alone does not stop the Dog ACCELERATING; after ten
#     seconds it carries about 9,800 uu/s and one tick moves it past KillZ.
#   * The timeout is wall-clock. World time does not advance while the world is paused, so a timeout measured
#     in world seconds can never fire -- that is what burned thirty minutes.
#   * Every touch of the pawn is guarded, and a stand where the Dog did not survive is recorded as UNMEASURED
#     rather than as a pass. A destroyed pawn's wrapper is not None; it throws on first use.
CONCURRENT = True

import math
import time
import unreal

L = unreal.WonderlandUiTestLibrary

# Bearings and radii chosen to cross all three nation axes and both the built core and the frontier.
STANDS = ((0.0, 120.0), (-30.0, 520.0), (90.0, 700.0), (210.0, 880.0), (150.0, 1050.0), (45.0, 1180.0))
HOLD_CAP_S = 14.0


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

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
    yield 8.0

    RESULT["partition"] = str(L.describe_world_partition(world))
    emit("K_WP", "INFO", "what the running world says about partition", {"partition": RESULT["partition"]})

    def living():
        try:
            got = unreal.GameplayStatics.get_player_pawn(world, 0)
            if got is None:
                return None
            got.get_actor_location()
            return got
        except Exception:                                          # noqa: BLE001
            return None

    def mover(who):
        try:
            return who.character_movement
        except Exception:                                          # noqa: BLE001
            return None

    start = living()
    if start is None:
        record("K00", "there is a Dog to walk", False)
        RESULT["status"] = "FAIL"
        return
    home = start.get_actor_location()
    record("K00", "there is a Dog to walk", True,
           home=[round(home.x), round(home.y), round(home.z)])

    stands = []
    RESULT["stands"] = stands
    for bearing, radius in STANDS:
        x = home.x + math.cos(math.radians(bearing)) * radius * 100.0
        y = home.y + math.sin(math.radians(bearing)) * radius * 100.0
        # ---- THE HOLD HEIGHT COMES FROM THE DESTINATION, NOT FROM WHERE THE DOG STARTED.
        #
        # THE LAST HYPOTHESIS STANDING for what destroys the Dog part-way through this tour. It has been ruled
        # out as falling through unloaded ground, as a cell that never arrives, as the pawn being paged with
        # its cell, as position, and as unpossession -- it is genuinely destroyed, with zero RelayDogCharacter
        # actors left and the controller still alive. What is left is a capsule PLACED INSIDE SOLID GEOMETRY,
        # which is the one thing only an instant move can do and which the engine resolves by ejecting.
        #
        # This tour was inviting exactly that: every stand held the Dog at the SPAWN's height plus seven
        # metres, and Wonderland is not flat. At 880 m on the Tartarus axis the ledger records a 20.7 m hall,
        # so "seven metres above the Arrival Gate" is several metres INSIDE its masonry.
        #
        # So the roof is found first, from far above, and the Dog is held a little over whatever is actually
        # there. If it now survives every stand, the hypothesis is confirmed and the fault was the harness
        # teleporting into walls rather than anything in the world.
        ceiling = None
        try:
            probe = unreal.SystemLibrary.line_trace_single(
                world, unreal.Vector(x, y, home.z + 6000.0), unreal.Vector(x, y, home.z - 3000.0),
                unreal.TraceTypeQuery.TRACE_TYPE_QUERY2, False, [living()] if living() else [],
                unreal.DrawDebugTrace.NONE, True,
                unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            if probe is not None:
                ceiling = float(probe.to_tuple()[4].z)
        except Exception:                                          # noqa: BLE001
            ceiling = None
        hold_z = (ceiling + 250.0) if ceiling is not None else (home.z + 700.0)
        hold_at = unreal.Vector(x, y, hold_z)

        # The clearance sweep that used to live here has moved BELOW the cell wait. See it there.

        began = time.time()
        arrived = False
        floor_z = None
        while True:
            live = living()
            if live is not None:
                try:
                    live.set_actor_location(hold_at, False, False)
                    mc = mover(live)
                    if mc is not None:
                        mc.set_editor_property("velocity", unreal.Vector(0.0, 0.0, 0.0))
                except Exception:                                  # noqa: BLE001
                    pass
            try:
                hit = unreal.SystemLibrary.line_trace_single(
                    world, hold_at, unreal.Vector(x, y, hold_at.z - 5000.0),
                    unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [live] if live else [],
                    unreal.DrawDebugTrace.NONE, True,
                    unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            except Exception:                                      # noqa: BLE001
                hit = None
            if hit is not None:
                arrived = True
                try:
                    floor_z = round(float(hit.to_tuple()[4].z))     # location is field 4; see the traps note
                except Exception:                                  # noqa: BLE001
                    floor_z = None
                break
            if time.time() - began > HOLD_CAP_S:
                break
            yield 0.25

        # ---- NOW THAT THE CELL IS HERE, CHECK THE SPOT IS CLEAR -- AND NOT BEFORE.
        #
        # This sweep was originally done before the teleport and it moved the failure around instead of fixing
        # it: one stand died per run, a different one each time. The reason is the whole point of a streaming
        # world. A capsule sweep asks the geometry whether a spot is occupied, and before the destination cell
        # has loaded there IS no geometry to ask -- so it answers "clear", the player is placed, and the
        # building arrives around them.
        #
        # That is not a quirk of this harness. It is the rule any fast travel, checkpoint warp or mission
        # placement in Wonderland will have to obey: make the destination a streaming source, WAIT for it, and
        # only then decide where the player can stand. Validating first is validating nothing.
        for nudge in range(6):
            try:
                blocked = unreal.SystemLibrary.capsule_trace_single(
                    world, hold_at, hold_at, 42.0, 96.0,
                    unreal.TraceTypeQuery.TRACE_TYPE_QUERY2, False, [living()] if living() else [],
                    unreal.DrawDebugTrace.NONE, True,
                    unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            except Exception:                                      # noqa: BLE001
                blocked = None
            if blocked is None:
                break
            step = 220.0 * (nudge + 1)
            hold_at = unreal.Vector(x + math.cos(math.radians(bearing)) * step,
                                    y + math.sin(math.radians(bearing)) * step, hold_at.z)
            moved = living()
            if moved is not None:
                try:
                    moved.set_actor_location(hold_at, False, False)
                except Exception:                                  # noqa: BLE001
                    pass
            yield 0.3
        row_nudged = nudge

        # Let it down onto whatever arrived.
        live = living()
        if live is not None:
            mc = mover(live)
            if mc is not None:
                try:
                    mc.set_movement_mode(unreal.MovementMode.MOVE_FALLING)
                except Exception:                                  # noqa: BLE001
                    pass
        yield 2.5

        live = living()
        row = {"bearing_deg": bearing, "radius_metres": radius,
               "cell_arrived": arrived, "traced_floor_z": floor_z,
               "held_at_z": round(hold_z), "surface_below_z": None if ceiling is None else round(ceiling),
               "seconds_waiting_for_the_cell": round(time.time() - began, 1)}
        if live is None:
            row["unmeasured"] = "the Dog did not survive the stand"
            # ---- WHICH KIND OF "GONE" IS IT? Destroyed and unpossessed look identical from
            # ---- get_player_pawn, and they have completely different causes: something calling Destroy, or
            # ---- the controller letting go of a pawn that still exists. Three runs have died on this without
            # ---- anyone asking which.
            try:
                pc = unreal.GameplayStatics.get_player_controller(world, 0)
                row["controller_exists"] = pc is not None
            except Exception:                                      # noqa: BLE001
                row["controller_exists"] = "threw"
            try:
                dogs = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.RelayDogCharacter)
                row["relay_dogs_in_world"] = len(dogs)
                if dogs:
                    at2 = dogs[0].get_actor_location()
                    row["first_dog_at"] = [round(at2.x), round(at2.y), round(at2.z)]
            except Exception as err:                               # noqa: BLE001
                row["relay_dogs_in_world"] = "?" + str(err)[:60]
        else:
            at = live.get_actor_location()
            row["landed_z"] = round(float(at.z))
            row["fell_through"] = bool(float(at.z) < home.z - 4000.0)
        stands.append(row)
        emit("K_%04d" % int(radius), "INFO", "%d m on bearing %d" % (radius, bearing), row)

    unmeasured = [v for v in stands if v.get("unmeasured")]
    record("K01", "every stand was actually measured", len(unmeasured) == 0,
           unmeasured=len(unmeasured), of=len(stands),
           note="a stand where the Dog was destroyed proves nothing about whether ground is there, and must "
                "not be counted as a pass")

    never = [v for v in stands if not v["cell_arrived"]]
    RESULT["cells_that_never_arrived"] = len(never)
    record("K02", "every cell streamed in when the player stood in it",
           len(never) == 0, never_arrived=[v["radius_metres"] for v in never], cap_seconds=HOLD_CAP_S,
           waits=[v["seconds_waiting_for_the_cell"] for v in stands],
           note="the conversion's own risk: a cell that does not arrive is a hole that exists only at "
                "runtime, and would not show in any count of what the map contains")

    fell = [v for v in stands if v.get("fell_through")]
    record("K03", "the Dog stands on ground at every stand, now that the world pages",
           len(fell) == 0 and len(unmeasured) == 0,
           fell_through=[v["radius_metres"] for v in fell], stands=stands)

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
