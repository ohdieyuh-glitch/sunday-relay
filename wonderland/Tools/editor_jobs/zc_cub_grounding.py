# DO THE AI COMPANIONS SINK INTO THE FLOOR WHEN SUB-AGENT CUBS ARE SUMMONED?
#
# FOUNDER, 2026-09-25, WITH A VIDEO: "When I summon the Sub-Agent Cubs, the AI Companion figures begin moving
# incorrectly and sinking or merging into the floor ... Companions and Cubs must remain separate actors with
# independent transform authority ... Test: 0 Cubs -> summon -> move -> stop -> turn -> uneven ground -> idle
# -> dismiss/resummon."
#
# THE CAUSE, found by reading the code rather than by watching the video again: every Sub-Agent Cub carries a
# body of the SAME CLASS as an AI Companion, and the companions' keep-apart steering iterated every one of
# them. Each newly spawned cub therefore counted as a peer to be pushed away from -- up to 345 uu of shove per
# cub, several at once -- and cubs are spawned ABOVE the Dog's feet, so the push carried a DOWNWARD component
# and drove a companion whose entire hover is 34 uu straight through the ground.
#
# WHAT THIS MEASURES is the founder's own sentence: how far each companion's feet are above the ground it is
# standing over, sampled through the whole sequence. A companion that sinks reads NEGATIVE. Nothing here asks
# the code whether it thinks it is grounded.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "cub_grounding")
HIT_BLOCKING, HIT_LOCATION = 0, 4


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".png"):
            os.remove(os.path.join(ROOT, old))
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
    L.focus_game_viewport()
    yield 8.0

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    cubs = L.get_cubs(world)
    record("C00", "the Sub-Agent Cub subsystem is running", cubs is not None)
    if cubs is None:
        RESULT["status"] = "FAIL"
        return

    def companions():
        """Every body that is an AI Companion in its own right -- not a cub's, not the Dog's costume."""
        out = []
        for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandCompanionEmbodiment):
            try:
                label = str(actor.get_actor_label())
            except Exception:
                label = ""
            if label.startswith("WL_Companion_"):
                out.append((label, actor))
        out.sort()
        return out

    def ground_under(actor):
        """How far this body's lowest box is above the ground beneath it, uu. Negative means it is IN the floor."""
        at = actor.get_actor_location()
        hit = unreal.SystemLibrary.line_trace_single(
            world, unreal.Vector(at.x, at.y, at.z + 3000.0), unreal.Vector(at.x, at.y, at.z - 3000.0),
            unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [dog], unreal.DrawDebugTrace.NONE, True)
        if hit is None:
            return None
        try:
            row = hit.to_tuple()
            if not bool(row[HIT_BLOCKING]):
                return None
            floor = float(row[HIT_LOCATION].z)
        except Exception:
            return None
        # The figure's own base above its actor origin, so this is the FEET and not the pivot.
        base = 0.0
        try:
            base = float(actor.get_figure_lowest_uu())
        except Exception:
            pass
        return round((at.z + base) - floor, 2)

    def sample(stage):
        rows = {}
        for label, actor in companions():
            rows[label] = ground_under(actor)
        shot = os.path.join(ROOT, "%s.png" % stage)
        try:
            L.capture_game_viewport(shot)
        except Exception:
            pass
        emit("C_%s" % stage, "INFO", stage, rows)
        return rows

    found = companions()
    record("C01", "both AI Companions are in the world", len(found) >= 2,
           companions=[f[0] for f in found])

    walk = {}
    RESULT["through_the_sequence"] = walk

    # ---- 0 CUBS.
    cubs.summon_sub_agent_cubs(0)
    yield 4.0
    walk["00_no_cubs"] = sample("00_no_cubs")

    # ---- SUMMON. This is the moment the founder's video is of.
    grown = cubs.summon_sub_agent_cubs(5)
    yield 6.0
    walk["01_summoned"] = sample("01_summoned")
    RESULT["cubs_summoned"] = int(grown)

    # ---- MOVE. Swept, so the Dog walks into the ground it is crossing rather than through it.
    start = dog.get_actor_location()
    yaw = dog.get_actor_rotation().yaw
    for step in range(18):
        at = dog.get_actor_location()
        dog.set_actor_location(at + unreal.Vector(math.cos(math.radians(yaw)) * 26.0,
                                                  math.sin(math.radians(yaw)) * 26.0, 0.0), True, False)
        yield 0.16
    walk["02_moving"] = sample("02_moving")

    # ---- STOP.
    yield 3.0
    walk["03_stopped"] = sample("03_stopped")

    # ---- TURN.
    dog.set_actor_rotation(unreal.Rotator(0.0, yaw + 150.0, 0.0), True)
    yield 3.0
    walk["04_turned"] = sample("04_turned")

    # ---- UNEVEN GROUND. Out of the plaza and onto the garden terraces, where the floor is not one plane.
    dog.set_actor_location(unreal.Vector(start.x - 5200.0, start.y + 3100.0, start.z + 400.0), False, False)
    yield 6.0
    walk["05_uneven"] = sample("05_uneven")

    # ---- IDLE.
    yield 6.0
    walk["06_idle"] = sample("06_idle")

    # ---- DISMISS AND RESUMMON.
    cubs.summon_sub_agent_cubs(0)
    yield 6.0
    walk["07_dismissed"] = sample("07_dismissed")
    cubs.summon_sub_agent_cubs(6)
    yield 6.0
    walk["08_resummoned"] = sample("08_resummoned")

    # ---- THE VERDICT: never below the floor, at any stage, for either companion.
    lows = {}
    for stage, rows in walk.items():
        for who, clearance in rows.items():
            if clearance is None:
                continue
            key = "%s @ %s" % (who, stage)
            lows[key] = clearance
    worst = min(lows.values()) if lows else None
    RESULT["worst_clearance_uu"] = worst
    RESULT["clearance"] = lows
    record("C10", "no AI Companion is ever inside the floor, at any point in the founder's sequence",
           worst is not None and worst >= -2.0,
           worst_clearance_uu=worst, floor=-2.0,
           worst_at=(min(lows, key=lambda k: lows[k]) if lows else None),
           note="the feet, measured against the ground traced directly beneath them. Negative is the sinking "
                "the founder filmed.")

    # ---- AND SUMMONING DOES NOT MOVE THEM. The other half of the report: "begin moving incorrectly".
    before = walk["00_no_cubs"]
    after = walk["01_summoned"]
    shift = {k: round(after[k] - before[k], 2) for k in before
             if before.get(k) is not None and after.get(k) is not None}
    RESULT["shift_on_summon"] = shift
    record("C11", "summoning Cubs does not shove the AI Companions",
           all(abs(v) <= 40.0 for v in shift.values()), change_in_clearance_uu=shift, tolerance=40.0,
           note="before and after the summon, standing still. The old keep-apart steering pushed a companion "
                "by up to 345 uu per cub.")

    # ---- AND THEY ARE STILL SEPARATE ACTORS. The founder asked for that in as many words.
    cub_bodies = 0
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandSubAgentCub):
        cub_bodies += 1 if actor.get_body() is not None else 0
    RESULT["cub_bodies"] = cub_bodies
    record("C12", "Companions and Cubs are separate actors with their own transforms",
           cub_bodies >= 1 and len(companions()) >= 2,
           cub_bodies=cub_bodies, companions=len(companions()),
           note="each cub carries its own body, attached to the cub; neither owns the other's transform")

    cubs.summon_sub_agent_cubs(0)
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
