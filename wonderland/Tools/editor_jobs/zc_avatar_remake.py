# PROJECT AVATARS, BEFORE AND AFTER: the old figure and the remade one, side by side on open paving, from the
# founder's five views -- front, three-quarter, side, rear, player distance -- at every stage.
#
# FOUNDER'S WORKFLOW: "1. Render the current version. 2. Explicitly identify why it looks primitive. 3. Create a
# new silhouette ... 11. Reject it if it still looks LEGO-like. 12. Iterate." Steps 1 and 5 are this job; steps
# 2 and 11 are done by looking at what it produces, not by anything it computes.
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "avatar_remake")
NEW_DIR = "C:/dev/iwonder/wonderland-proof/wonderland/ProjectAvatars"
OLD_DIR = "C:/dev/iwonder/wonderland-proof/wonderland/ProjectAvatars/_old"
FAMILIES = ["Cherubim", "Seraph"]
STAGES = ["Small", "Medium", "Large"]
STAGE_AT = (-330.0, -420.0)
FACING = 40.0
VIEWS = [("front", 0.0, 1.9, 0.42, 42.0, 0.55), ("three_quarter", 40.0, 1.9, 0.42, 42.0, 0.58),
         ("side", 90.0, 1.9, 0.42, 42.0, 0.52), ("rear", 180.0, 1.9, 0.42, 42.0, 0.55),
         ("player_distance", 25.0, 4.2, 0.35, 55.0, 0.32)]


def job():
    os.makedirs(ROOT, exist_ok=True)
    # ONLY THIS RUN'S FAMILIES ARE CLEARED. A whole-folder sweep here deleted the Ten Tails renders the moment
    # the Cherubim run started, before they had been judged.
    for old in os.listdir(ROOT):
        if old.endswith((".jpg", ".png")) and any(old.startswith(f + "_") for f in FAMILIES):
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
        yield 5.0
        world = ues.get_game_world()
        L.focus_game_viewport()
        gx, gy = STAGE_AT
        hit = unreal.SystemLibrary.line_trace_single(
            world, unreal.Vector(gx, gy, 600.0), unreal.Vector(gx, gy, -300.0),
            unreal.TraceTypeQuery.TRACE_TYPE_QUERY2, False, [], unreal.DrawDebugTrace.NONE, True,
            unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        gz = float(hit.to_tuple()[4].z) if hit and hasattr(hit, "to_tuple") else 17.6
        RESULT["ground_z"] = round(gz, 1)
        face = math.radians(FACING)
        rows = []
        for family in FAMILIES:
            for stage in STAGES:
                for version, folder in (("old", OLD_DIR), ("new", NEW_DIR)):
                    path = "%s/%s_%s.wlvox" % (folder, family, stage)
                    if not os.path.exists(path):
                        rows.append({"family": family, "stage": stage, "version": version, "error": "no file"})
                        continue
                    body = L.spawn_figure_actor(world, unreal.Vector(gx, gy, gz), path, "%s %s %s" % (family, stage, version))
                    yield 2.0
                    if body is None:
                        rows.append({"family": family, "stage": stage, "version": version, "error": "did not spawn"})
                        continue
                    body.set_actor_rotation(unreal.Rotator(0.0, 0.0, FACING), False)
                    yield 1.0
                    h = max(float(body.get_figure_height_uu()), 80.0)
                    at = body.get_actor_location()
                    # THE FEET ON THE GROUND. Both generators fit height from the boxes; the lowest box may sit above
                    # or below the origin, so the actor is lifted by its own measured overhang rather than assumed.
                    lowest = None
                    for c in body.get_components_by_class(unreal.InstancedStaticMeshComponent):
                        for i in range(min(c.get_instance_count(), 4000)):
                            t = c.get_instance_transform(i, True)
                            z = t.translation.z
                            lowest = z if lowest is None else min(lowest, z)
                    if lowest is not None:
                        body.set_actor_location(unreal.Vector(at.x, at.y, at.z + (gz - lowest)), False, False)
                        yield 0.5
                        at = body.get_actor_location()
                    # WHAT THE CAMERA HAS TO FIT IS NOT THE HEIGHT. Every distance here was a multiple of height, and
                    # the LARGE forms are far wider than they are tall -- Cherubim's ring span and Seraph's radial
                    # wings both ran off both edges of the frame, so front and three-quarter could not be judged at
                    # all. Framing is driven by the larger of height and width, which leaves every form that really
                    # is taller than wide (all of Small and Medium) at exactly the distance it had.
                    span = h
                    try:
                        _, extent = body.get_actor_bounds(False)
                        span = max(h, 2.0 * max(float(extent.x), float(extent.y)))
                    except Exception as exc:
                        unreal.log_warning("WLAVATAR no bounds, framing on height: %s" % exc)
                    taken = []
                    for view, bearing, dist_h, look_h, fov, eye_h in VIEWS:
                        rad = face + math.radians(bearing)
                        dist = span * dist_h
                        look = unreal.Vector(at.x, at.y, gz + h * look_h)
                        eye = unreal.Vector(at.x + math.cos(rad) * dist, at.y + math.sin(rad) * dist, gz + h * eye_h)
                        # NOTHING SOLID BETWEEN THE CAMERA AND THE CREATURE. At 4.2x height the LARGE stage puts the
                        # eye 23 m out, which in this garden is INSIDE a wall: all three Large player_distance frames
                        # came back flat brown -- the inside face of world geometry -- and only their file size
                        # (240 KB against 420-460 KB) ever showed it. A picture of the inside of a wall is not the
                        # silhouette check the founder asked for. The eye is still placed at full player distance and
                        # pulled in ONLY when something blocks, so an open shot keeps its distance and a blocked one
                        # gets the nearest clear view. The avatar is excluded, or its own body is the obstruction.
                        blocked = unreal.SystemLibrary.line_trace_single(
                            world, look, eye, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [body],
                            unreal.DrawDebugTrace.NONE, True, unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
                        if blocked and hasattr(blocked, "to_tuple"):
                            hp = blocked.to_tuple()[4]
                            # STOP SHORT OF THE WALL, not at it: a camera exactly on the surface still renders its face.
                            clear = max(span * 1.6, math.hypot(hp.x - look.x, hp.y - look.y) - 90.0)
                            eye = unreal.Vector(look.x + math.cos(rad) * clear, look.y + math.sin(rad) * clear,
                                                gz + h * eye_h)
                        L.pose_camera(world, eye, look, fov)
                        yield 1.1
                        name = "%s_%s_%s_%s.jpg" % (family, stage, version, view)
                        H.capture_viewport_jpeg(os.path.join(ROOT, name), 1900, 95)
                        taken.append(name)
                    rows.append({"family": family, "stage": stage, "version": version, "height_uu": round(h, 1), "span_uu": round(span, 1),
                                 "boxes": int(body.get_box_count()), "lowest_z": None if lowest is None else round(lowest, 1),
                                 "shots": taken})
                    body.destroy_actor()
                    yield 0.5
        L.release_camera(world)
        RESULT["renders"] = rows
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "remake.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLAVATAR could not end play: %s" % exc)
