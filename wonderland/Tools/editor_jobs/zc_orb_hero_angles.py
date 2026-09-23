# WHICH WAY SHOULD THE PROOF CAMERA FACE? Surveyed, then chosen.
#
# The orbs themselves now film correctly -- RED / GRAY / RED, touching -- but the LLM Companion's embodiment stands
# a few metres from the player and filled the right third of the hero frame. That is not a falsification, it is the
# product's own companion standing where it lives; it is simply a bad photograph of a good result.
#
# SO THE CAMERA MOVES, AND NOTHING ELSE DOES. No actor is hidden, nothing is destroyed, no state is touched. This
# stages the founder's RED / GRAY / RED once and photographs it from a ring of azimuths, tracing each camera spot
# first so a viewpoint inside a wall is rejected rather than filmed -- a side camera 760 uu out landed in stone
# once already and photographed the inside of the plaza.
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "orb_hero_angles")
AZIMUTHS = [0, 45, 90, 135, 180, 225, 270, 315]


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 6.0
        world = ues.get_game_world()
        ui, tasks, mission = L.get_ui(world), L.get_mission_tasks(world), L.get_mission(world)
        if not (ui and tasks and mission):
            RESULT["status"] = "failed"
            RESULT["why"] = "no ui / task / mission subsystem"
            return
        L.focus_game_viewport()
        # A CLEAN BOARD, BECAUSE CONTRACTS NOW SURVIVE A RESTART. Without this a run inherits the last one's
        # contracts and measures a set it did not build, which is how a green suite starts lying.
        tasks.clear_all_tasks_for_development()
        yield 0.5

        ui.press_add_task()
        yield 1.0
        tasks.submit_draft(tasks.get_task_list()[0].local_id, "Survey the arrival plaza and report its condition")
        yield 1.5
        ui.press_add_task()                       # the GRAY draft, left empty on purpose
        yield 1.0
        ui.press_add_task()
        yield 1.0
        tasks.submit_draft(tasks.get_task_list()[2].local_id, "Inspect the garden arches for clearance")
        yield 2.5
        RESULT["stack"] = [str(s) for s in mission.describe_orb_stack()]

        spots = sorted([[a.get_actor_location().x, a.get_actor_location().y, a.get_actor_location().z]
                        for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandMissionOrb)],
                       key=lambda p: p[2])
        cx, cy = spots[0][0], spots[0][1]
        cz = (spots[0][2] + spots[-1][2]) * 0.5
        span = max(spots[-1][2] - spots[0][2], 120.0)
        back = span * 1.9 + 250.0
        centre = unreal.Vector(cx, cy, cz)

        # WHERE EVERYTHING ELSE IS STANDING, so a frame can be scored rather than merely looked at.
        others = []
        for cls in ("WonderlandCompanionEmbodiment", "RelayDogCharacter"):
            kind = getattr(unreal, cls, None)
            if kind is None:
                continue
            for a in unreal.GameplayStatics.get_all_actors_of_class(world, kind):
                v = a.get_actor_location()
                others.append((str(a.get_name()), v.x, v.y))
        RESULT["others"] = [[n, round(x), round(y)] for n, x, y in others]

        rows = []
        for deg in AZIMUTHS:
            rad = math.radians(deg)
            ex, ey = cx + math.cos(rad) * back, cy + math.sin(rad) * back
            eye = unreal.Vector(ex, ey, cz + span * 0.15)
            # IS THE VIEW CLEAR? A trace from the camera to the stack: anything solid between them means this
            # azimuth photographs a wall, so it is recorded as blocked and skipped rather than filmed.
            hit = unreal.SystemLibrary.line_trace_single(
                world, eye, centre, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [],
                unreal.DrawDebugTrace.NONE, True, unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            blocked = bool(hit)
            # HOW CLOSE IS THE NEAREST COMPANION TO THE LENS AXIS, in degrees. A big figure 30 degrees off axis
            # fills a frame edge; one 90 degrees off is behind the shoulder and out of it.
            view = unreal.Vector(cx - ex, cy - ey, 0.0)
            vlen = math.hypot(view.x, view.y) or 1.0
            worst = 180.0
            for name, ox, oy in others:
                to = (ox - ex, oy - ey)
                tlen = math.hypot(*to) or 1.0
                dot = (view.x * to[0] + view.y * to[1]) / (vlen * tlen)
                worst = min(worst, math.degrees(math.acos(max(-1.0, min(1.0, dot)))))
            row = {"azimuth": deg, "blocked": blocked, "nearest_figure_off_axis_deg": round(worst, 1)}
            rows.append(row)
            if blocked:
                continue
            L.pose_camera(world, eye, centre, 52.0)
            yield 1.2
            H.capture_viewport_jpeg(os.path.join(ROOT, "az_%03d.jpg" % deg), 1900, 96)
        RESULT["angles"] = rows
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "angles.json"), "w", encoding="utf-8") as fh:
            json.dump({k: RESULT.get(k) for k in ("status", "stack", "angles", "others")}, fh, indent=1)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLANGLE could not end play: %s" % exc)
