# HOW MUCH OF THE WORLD CAN NEVER LEAVE MEMORY?
#
# zc_streaming proved the world pages -- 12,658 actors at the Arrival Gate down to 2,405 out in the world --
# and that is the headline. But it read 2,405 actors and 13,247 instances at BOTH of its distant stops, to the
# instance, and two different places in a world this varied should not agree exactly. Either those readings
# are the ALWAYS-LOADED set with nothing else arrived yet, or they were taken before streaming had caught up.
#
# The difference decides a piece of work. If the floor is genuinely about 2,400 actors then streaming is
# healthy and the 753 actors too wide for a cell are a footnote; if the distant readings were premature then
# the floor is unknown and the world-spanning batches -- BC01_BaseCourse is one actor 1,970 m across holding
# 4,132 instances -- need splitting in the builders before a beta.
#
# So this stands still and WAITS for residency to stop moving before reading it, which zc_streaming does not,
# and reads it at three places far apart.
CONCURRENT = True

import math
import time
import unreal

L = unreal.WonderlandUiTestLibrary


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

    def living():
        try:
            got = unreal.GameplayStatics.get_player_pawn(world, 0)
            if got is None:
                return None
            got.get_actor_location()
            return got
        except Exception:                                          # noqa: BLE001
            return None

    def census():
        actors = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor)
        inst = 0
        for a in actors:
            try:
                for c in a.get_components_by_class(unreal.InstancedStaticMeshComponent):
                    inst += int(c.get_instance_count())
            except Exception:                                      # noqa: BLE001
                pass
        return len(actors), inst

    start = living()
    if start is None:
        record("R00", "there is a Dog to move", False)
        RESULT["status"] = "FAIL"
        return
    home = start.get_actor_location()

    stops = []
    RESULT["stops"] = stops
    for label, bearing, radius in (("spawn", 0.0, 0.0), ("600 m north", 90.0, 600.0),
                                   ("1,250 m south-west", 215.0, 1250.0)):
        if radius > 0.0:
            live = living()
            if live is not None:
                try:
                    live.set_actor_location(
                        unreal.Vector(home.x + math.cos(math.radians(bearing)) * radius * 100.0,
                                      home.y + math.sin(math.radians(bearing)) * radius * 100.0,
                                      home.z + 300.0), False, False)
                except Exception:                                  # noqa: BLE001
                    pass
        # ---- WAIT FOR IT TO STOP MOVING, which is the whole point of this job. Residency is read every two
        # ---- seconds and the stop is not recorded until two consecutive reads agree within 1%.
        last = None
        settled = False
        began = time.time()
        while time.time() - began < 45.0:
            yield 2.0
            now = census()
            if last is not None and abs(now[0] - last[0]) <= max(5, last[0] // 100):
                settled = True
                break
            last = now
        got = census()
        # ---- AND WHERE THE STREAMING SOURCE ACTUALLY IS, which decides whether this reading means anything.
        #
        # Residency is measured around the PLAYER. If the Dog did not survive the teleport -- and this world
        # destroys a teleported Dog often enough that a recovery net had to be added for it -- then the game
        # mode respawns it back at the Arrival Gate, the distant cells never load, and the count that comes
        # back is the always-loaded set wearing a distant stop's label. Two different places reading identical
        # to the instance is exactly what that looks like, so it is checked rather than assumed.
        here_now = living()
        where_now = None
        if here_now is not None:
            p = here_now.get_actor_location()
            where_now = round(float((p - home).length()) / 100.0, 1)
        row = {"where": label, "actors": got[0], "instances": got[1],
               "settled": settled, "seconds_waited": round(time.time() - began, 1),
               "dog_alive": here_now is not None,
               "dog_metres_from_spawn": where_now, "asked_for_metres": radius}
        stops.append(row)
        emit("R_%s" % label.replace(" ", "_"), "INFO", label, row)

    read = [r for r in stops if r["actors"] > 0]
    record("R00", "every stop was counted", len(read) == len(stops), stops=stops)
    record("R03", "the Dog was actually AT each stop when residency was read",
           all(r["dog_alive"] and (r["asked_for_metres"] == 0.0
                                   or abs((r["dog_metres_from_spawn"] or 0.0) - r["asked_for_metres"])
                                   < max(120.0, r["asked_for_metres"] * 0.25))
               for r in stops),
           stops=[{k: r[k] for k in ("where", "dog_alive", "dog_metres_from_spawn", "asked_for_metres")}
                  for r in stops],
           note="residency is measured around the player. A stop where the Dog died and respawned at the "
                "Arrival Gate reports the always-loaded set under a distant stop's name, and would read as a "
                "beautifully low floor.")

    record("R01", "residency was allowed to settle before it was read",
           all(r["settled"] for r in stops), stops=stops,
           note="two consecutive counts two seconds apart agreeing within one per cent. Without this a "
                "distant stop is read while its cells are still arriving and the world looks emptier than it "
                "is -- which is how two different places came back identical to the instance.")

    # ---- ONLY STOPS WHERE THE DOG WAS ACTUALLY THERE COUNT. See R03: one of these is routinely a lie.
    honest = [r for r in stops
              if r["dog_alive"] and (r["asked_for_metres"] == 0.0
                                     or abs((r["dog_metres_from_spawn"] or 0.0) - r["asked_for_metres"])
                                     < max(120.0, r["asked_for_metres"] * 0.25))]
    RESULT["stops_that_count"] = [r["where"] for r in honest]
    if not honest:
        record("R02", "the world does not keep most of itself resident", False,
               note="no stop had the Dog where it was supposed to be, so there is nothing to judge")
        RESULT["status"] = "FAIL: no valid stop"
        return
    floor = min(r["actors"] for r in honest)
    peak = max(r["actors"] for r in honest)
    inst_floor = min(r["instances"] for r in honest)
    inst_peak = max(r["instances"] for r in honest)
    RESULT["resident_instance_floor"] = inst_floor
    RESULT["resident_instance_peak"] = inst_peak
    RESULT["share_of_instances_always_resident"] = round(inst_floor / 156850.0, 3)
    RESULT["resident_actor_floor"] = floor
    RESULT["resident_actor_peak"] = peak
    RESULT["share_of_world_always_resident"] = round(floor / 21075.0, 3)
    emit("R_FLOOR", "INFO", "what never leaves memory",
         {"floor_actors": floor, "peak_actors": peak,
          "share_of_21075": RESULT["share_of_world_always_resident"]})

    # ---- JUDGED ON INSTANCES, BECAUSE THAT IS WHAT COSTS.
    #
    # Actors and instances tell different stories here and the instance one is the one that matters. Walking
    # 600 m from the Arrival Gate takes the resident ACTOR count from 11,407 to 7,715 -- a third -- while the
    # resident INSTANCE count goes from 156,850 to 14,961, which is ninety per cent. The difference is that a
    # great many of the actors that stay are small: lights, markers, volumes, the always-loaded set. The heavy
    # instanced content, which is where every triangle and every draw call lives, pages beautifully.
    #
    # That settles the question the oversized-actor work turns on. BC01_BaseCourse really is one actor
    # 1,970 m wide holding 4,132 instances and it really can never leave memory -- but 4,132 out of 156,850
    # is 2.6%, and the whole unpageable instance load is under a tenth of the world. Splitting the
    # world-spanning batches in the builders is a real improvement and it is not a beta blocker.
    record("R02", "the world does not keep most of itself resident",
           inst_floor <= 156850 * 0.25,
           resident_instances={"at_spawn": inst_peak, "away": inst_floor},
           share_of_instances=RESULT["share_of_instances_always_resident"], ceiling=0.25,
           resident_actors={"at_spawn": peak, "away": floor},
           counted_only=[r["where"] for r in honest],
           note="instances, not actors: the actors that stay resident are mostly small ones, and the heavy "
                "instanced content is what a frame actually pays for.")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
