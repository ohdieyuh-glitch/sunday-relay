# WHY IS ARDEN INFERNAL FILLING THE PREVIEW SQUARE WITH FIRE?
#
# The framing maths says the mannequin should subtend 0.86 of the window for every skin, and the photograph
# says Arden fills several times that and the lens is inside its mane. One of those is wrong about the world.
# This asks the world: where the preview body actually is, how big it actually is, how far the lens actually
# is from it, and what angle that works out to -- measured from the actors, not from the code that placed them.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

SKINS = ["relay_og", "jack_flame", "celestial_light"]


def job():
    RESULT["status"] = "running"
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if ues.get_game_world() is None:
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 300)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
        yield 6.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    ui = L.get_ui(world)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)

    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    if not ui.is_brain_skins_open():
        ui.press_switch_skin()
    yield 4.0

    rect = ui.get_skin_preview_rect()
    RESULT["window"] = None if rect is None else {
        "centre": [round(rect[0].x, 4), round(rect[0].y, 4)],
        "size": [round(rect[1].x, 4), round(rect[1].y, 4)]}

    rows = {}
    RESULT["per_skin"] = rows
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 6.0
        body = None
        for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
            try:
                if str(actor.get_actor_label()) == "WL_SkinStage_Dog":
                    body = actor
                    break
            except Exception:
                pass
        if body is None:
            rows[skin] = {"error": "no preview body in the world"}
            continue
        origin, extent = body.get_actor_bounds(False)
        scale = body.get_actor_scale3d()
        where = body.get_actor_location()
        eye = pc.player_camera_manager.get_camera_location()
        away = math.sqrt((eye.x - origin.x) ** 2 + (eye.y - origin.y) ** 2 + (eye.z - origin.z) ** 2)
        fov = pc.player_camera_manager.get_fov_angle()
        tan_h = math.tan(math.radians(fov * 0.5))
        size = pc.get_viewport_size()
        aspect = (float(size[0]) / float(size[1])) if size and size[1] else 1.778
        tan_v = tan_h / aspect
        # What fraction of the whole viewport this body subtends, by its own measured bounds.
        across = (extent.y * 2.0) / max(2.0 * away * tan_h, 1e-3)
        upright = (extent.z * 2.0) / max(2.0 * away * tan_v, 1e-3)
        rows[skin] = {
            "scale": round(scale.x, 4),
            "bounds_extent": [round(extent.x, 1), round(extent.y, 1), round(extent.z, 1)],
            "origin_z": round(origin.z, 1),
            "actor_z": round(where.z, 1),
            "away_from_lens": round(away, 1),
            "fov": round(fov, 1),
            "subtends_across_viewport": round(across, 4),
            "subtends_up_viewport": round(upright, 4),
            "as_fraction_of_window_across": round(across / max(rect[1].x, 1e-3), 3) if rect else None,
            "as_fraction_of_window_up": round(upright / max(rect[1].y, 1e-3), 3) if rect else None,
        }
        emit("G_%s" % skin, "INFO", "preview geometry for %s" % skin, rows[skin])

    ui.press_switch_skin()
    yield 1.0
    ui.toggle_project_brain()
    RESULT["status"] = "measured"
    yield 1.0
