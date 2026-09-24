# WHAT IS THE WHITE THING IN THE BRAIN WINDOW?
#
# A white voxel slab keeps appearing at the left edge of the brain window. It survived an open-fronted chamber,
# survived that chamber being enlarged, and survived the Mission Contract crystal being stood down -- so it is
# none of the things it has been guessed to be. Guessing has cost three build-and-test cycles; this names it.
#
# Every actor in the world is projected to screen space and kept if it lands inside the measured brain window
# and is NEARER than the chamber's rear wall, because those are exactly the two conditions for appearing in
# that frame in front of the backdrop.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "brain_intruder")


def job():
    os.makedirs(ROOT, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    ui = L.get_ui(world)
    L.focus_game_viewport()

    ui.toggle_project_brain()
    yield 3.0

    rect = ui.get_brain_window_rect()
    RESULT["window_rect_LTRB"] = [round(rect.x, 3), round(rect.y, 3), round(rect.z, 3), round(rect.w, 3)]
    cam = pc.player_camera_manager
    eye = cam.get_camera_location()

    art = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandBrainSculpture)
    if not art:
        RESULT["status"] = "FAIL: no sculpture"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    brain = art[0].get_actor_location()
    brain_d = ((brain.x - eye.x) ** 2 + (brain.y - eye.y) ** 2 + (brain.z - eye.z) ** 2) ** 0.5
    RESULT["brain_distance_uu"] = round(brain_d, 1)

    suspects = []
    RESULT["in_the_window"] = suspects
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        try:
            loc = a.get_actor_location()
        except Exception:
            continue
        d = ((loc.x - eye.x) ** 2 + (loc.y - eye.y) ** 2 + (loc.z - eye.z) ** 2) ** 0.5
        # Only things that could possibly be in front of the backdrop.
        if d > brain_d * 1.6 or d < 1.0:
            continue
        try:
            screen = pc.project_world_location_to_screen(loc, False)
        except Exception:
            continue
        if screen is None:
            continue
        # project_world_location_to_screen returns the Vector2D itself here, not (ok, vec).
        if isinstance(screen, tuple):
            screen = screen[-1]
        size = pc.get_viewport_size()
        vx, vy = (size[0], size[1]) if isinstance(size, tuple) else (size.x, size.y)
        if vx <= 0 or vy <= 0:
            continue
        u, v = screen.x / float(vx), screen.y / float(vy)
        if not (rect.x - 0.06 <= u <= rect.z + 0.06 and rect.y - 0.06 <= v <= rect.w + 0.06):
            continue
        suspects.append({
            "name": a.get_name(), "class": a.get_class().get_name(),
            "distance_uu": round(d, 1), "nearer_than_brain": d < brain_d,
            "screen_uv": [round(u, 3), round(v, 3)],
        })
    suspects.sort(key=lambda r: r["distance_uu"])
    RESULT["count_in_window"] = len(suspects)
    H.capture_viewport_jpeg(os.path.join(ROOT, "brain_window.jpg"), 1700, 92)
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
