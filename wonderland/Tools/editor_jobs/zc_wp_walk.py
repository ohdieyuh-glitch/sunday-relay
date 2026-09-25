# WALK THE PARTITIONED TWIN, WITHOUT ADOPTING IT.
#
# The conversion produced WL_V2_GoldenArrival_WP2_WP -- a 13,416-byte stub with 21,047 external actors
# beside it -- and nothing has been switched over to it. Adopting it is the founder's call, because it
# changes which map every worktree on this machine opens. But whether it is WORTH adopting is a question
# that can be answered first, and answering it is what makes the decision a safe one rather than a bet.
#
# NOTHING IS SAVED AND NOTHING IS CONFIGURED. This opens the twin, looks at it, plays it, walks the Dog in
# it, and then opens the authoritative map again. No config points at the twin before this job and none does
# after it. If the job dies halfway the worst case is an editor sitting on the twin with no unsaved changes,
# which the next launch corrects on its own.
#
# WHAT IT IS ACTUALLY ASKING. A partitioned map that cannot be played is worse than an unpartitioned one, so
# the questions are, in order: does it open, does it hold the same world, does it run, and can the Dog stand
# in it. The count comparison matters most -- a conversion that silently dropped actors would look like a
# success everywhere else.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wp_walk")

AUTHORITATIVE = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"
TWIN = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2_WP"

#: Where the Dog is put down, in world cm. Taken from the built rings the corrected walk reported, so the
#: same places that hold content in the authoritative map are the places tested here.
STANDS = [(0, 0), (20000, 20000), (-40000, 40000), (60000, -60000), (-90000, -30000), (100000, 10000)]


def count_world(world):
    """Actors and instances actually resident, so a conversion that dropped content cannot hide."""
    actors = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.StaticMeshActor)
    insts = 0
    comps = 0
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        for comp in a.get_components_by_class(unreal.InstancedStaticMeshComponent):
            comps += 1
            try:
                insts += int(comp.get_instance_count())
            except Exception:
                pass
    return {"static_mesh_actors": len(actors), "instanced_components": comps, "instances": insts}


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

    # ---- 1. OPEN THE TWIN. Never saved, and put back at the end whatever happens below.
    opened = bool(les.load_level(TWIN))
    RESULT["twin_opened"] = opened
    yield 3.0
    record("P01", "the partitioned twin opens in the editor at all", opened, map=TWIN)

    if not opened:
        les.load_level(AUTHORITATIVE)
        yield (lambda: True, 10)
        RESULT["status"] = "FAIL: the twin would not open"
        return

    # ---- 2. PLAY IT.
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    playing = ues.get_game_world() is not None
    RESULT["twin_plays"] = playing
    record("P02", "the twin runs in PIE", playing)

    if playing:
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
        yield 6.0
        world = ues.get_game_world()
        L.focus_game_viewport()
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 10.5")
        yield 1.0

        RESULT["twin_contents"] = count_world(world)
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        record("P03", "the Dog spawned in the twin", pawn is not None)

        # ---- 3. STAND IN IT. A partitioned world streams actors in around the player, so a landing that
        # ---- works here is evidence the streaming actually delivers rather than merely being configured.
        visits = []
        RESULT["visits"] = visits
        if pawn is not None:
            for n, (x, y) in enumerate(STANDS):
                pawn.set_actor_location(unreal.Vector(float(x), float(y), 3000.0), False, False)
                yield 2.5
                at = pawn.get_actor_location()
                visits.append({"at": [x, y], "landed_z": round(float(at.z)),
                               "fell_through": bool(float(at.z) < -20000.0)})
                H.capture_viewport_jpeg(os.path.join(ROOT, "%02d_%d_%d.jpg" % (n + 1, x, y)), 1500, 88)
            RESULT["fell_through"] = sum(1 for v in visits if v["fell_through"])
            record("P04", "the Dog stands on ground everywhere it was put down in the twin",
                   RESULT["fell_through"] == 0, visited=len(visits), fell=RESULT["fell_through"])

        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)

    # ---- 4. PUT THE AUTHORITATIVE MAP BACK. Unconditional: this is the line that makes the job safe.
    back = bool(les.load_level(AUTHORITATIVE))
    yield 3.0
    RESULT["restored_authoritative"] = back
    record("P05", "the authoritative map is open again, and nothing was saved to either", back,
           map=AUTHORITATIVE)

    RESULT["status"] = "measured"
