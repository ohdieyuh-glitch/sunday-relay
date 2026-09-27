# DOES THE EYE PANE RENDER AT ALL? One skin, one question, answered by swapping the pane's material for one that
# is known to draw and photographing both.
#
# The Dog's eye pane carries an unlit material whose emissive is its Color parameter, set to (18, 13, 3), and it
# photographs BLACK. Either the material is not being rendered as authored (VRAM exhaustion substitutes materials,
# and the banner was on screen), or the pane is not being rendered at all (occluded, hidden, culled), and those
# need opposite fixes. So: raise the texture pool so the banner is gone; frame the head from a three-quarter
# angle so no wall is in the way; photograph the pane as it is; put the HEAD's own material on the pane -- the
# cream that is plainly drawing in every capture -- and photograph again; then put the eye material back.
# If the cream pane shows, the pane renders and the material is the problem. If it does not, the pane is hidden.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "eye_probe")


def luma(c):
    return round(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, 4)


def job():
    os.makedirs(ROOT, exist_ok=True)
    RESULT["status"] = "running"
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
    unreal.SystemLibrary.execute_console_command(world, "r.Streaming.PoolSize 1400")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.0")
    yield 8.0
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    ui = L.get_ui(world)
    ui.wear_relay_skin("relay_og")
    yield 5.0

    eye = None
    head = None
    for comp in dog.get_components_by_class(unreal.StaticMeshComponent):
        n = comp.get_name().lower()
        if n == "mesh_head_eye":
            eye = comp
        elif n == "mesh_head" or (n.startswith("mesh_head") and "visor" not in n and "eye" not in n and head is None):
            head = comp
    RESULT["found"] = {"eye": eye.get_name() if eye else None, "head": head.get_name() if head else None,
                       "eye_visible": bool(eye.is_visible()) if eye else None,
                       "eye_world_bounds": str(eye.get_local_bounds()) if eye else None}
    if eye is None:
        RESULT["status"] = "FAIL: no Mesh_head_eye"
        return

    def frame(tag):
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw + 35.0
        cam = unreal.Vector(here.x + math.cos(math.radians(yaw)) * 260.0, here.y + math.sin(math.radians(yaw)) * 260.0, here.z + 70.0)
        L.pose_camera(world, cam, unreal.Vector(here.x, here.y, here.z + 62.0), 32.0)
        yield 1.5
        # the pane's centre on screen, read straight off the component
        b = eye.get_local_bounds()
        centre = eye.get_component_transform().transform_location((b[0] + b[1]) * 0.5)
        size = pc.get_viewport_size()
        got = unreal.GameplayStatics.project_world_to_screen(pc, centre, False)
        read = None
        if got is not None and size and size[0] > 0:
            cx, cy = float(got.x) / size[0], float(got.y) / size[1]
            r = L.read_screen_rect(cx - 0.012, cy - 0.012, cx + 0.012, cy + 0.012)
            read = {"cx": round(cx, 3), "cy": round(cy, 3), "luma": luma(r[0]) if r else None, "bright": round(float(r[2]), 3) if r else None}
        try:
            L.capture_game_viewport(os.path.join(ROOT, "%s.png" % tag))
        except Exception:                                          # noqa: BLE001
            pass
        L.release_camera(world)
        RESULT.setdefault("reads", {})[tag] = read
        emit("P_" + tag, "INFO", tag, read)

    yield from frame("01_eye_material_as_driven")
    original = eye.get_material(0)
    if head is not None and head.get_material(0) is not None:
        eye.set_material(0, head.get_material(0))
        yield 0.5
        yield from frame("02_eye_pane_in_head_material")
        eye.set_material(0, original)
    # and the visor's, which is the black we suspect we are seeing
    for comp in dog.get_components_by_class(unreal.StaticMeshComponent):
        if comp.get_name().lower() == "mesh_head_visor":
            RESULT["visor_visible"] = bool(comp.is_visible())
            comp.set_visibility(False, False)
            yield 0.5
            yield from frame("03_visor_hidden")
            comp.set_visibility(True, False)
            break
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "probed"
    yield 1.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
