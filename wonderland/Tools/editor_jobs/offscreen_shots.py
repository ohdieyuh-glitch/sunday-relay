# Editor job: captures that do not need a visible editor window.
#
# camera_shots.py reads the PIE game viewport back, which fails while the editor is minimized (the founder working in
# another window, 2026-09-15: every shot ok=False). This job renders the EDITOR world through a transient
# SceneCapture2D into a render target and writes it to PNG, so passes can still be judged. The editor world draws the
# batches through their editor previews, which match PIE (beta_probe). Nothing is saved: the capture actor is destroyed.
# Globals: POSES [(name, x, y, z, pitch, yaw, fov; negative fov = ortho width)], TAG, WIDTH, HEIGHT, SETTLE, EV100, CAPTURES.
import os

POSES = globals().get("POSES", [])
TAG = globals().get("TAG", "off")
WIDTH = globals().get("WIDTH", 1600)
HEIGHT = globals().get("HEIGHT", 900)
SETTLE = globals().get("SETTLE", 2.0)
EV100 = globals().get("EV100", 13.5)
CAPTURES = globals().get("CAPTURES", 12)
EXPOSURE_BRIGHTEN = globals().get("EXPOSURE_BRIGHTEN", 0.4)
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "passes")


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    os.makedirs(SHOTS, exist_ok=True)
    world = ues.get_editor_world()
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    rt = unreal.RenderingLibrary.create_render_target2d(world, WIDTH, HEIGHT, unreal.TextureRenderTargetFormat.RTF_RGBA8_SRGB)
    cap = eas.spawn_actor_from_class(unreal.SceneCapture2D, unreal.Vector(0.0, 0.0, 0.0), unreal.Rotator(0.0, 0.0, 0.0), transient=True)
    comp = cap.get_editor_property("capture_component2d")
    comp.set_editor_property("texture_target", rt)
    comp.set_editor_property("capture_source", unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR)
    # capture_every_frame stays on (the default): with it off, twelve capture_scene calls alone came out white
    # (mq07off2); the working diagnostic (offexpo) left it on, so the view keeps temporal history between calls.
    # A fresh capture has no eye-adaptation history: histogram exposure came out white even pinned (offtest2/3), so the
    # capture uses manual exposure with physical camera exposure off; bias -EV100 matches the world's pinned EV100 13.5
    # (offexpo: -13.5 lit, -10 and 0 white). EXPOSURE_BRIGHTEN lifts it toward the PIE grade.
    pp = comp.get_editor_property("post_process_settings")
    for prop, value in (("override_auto_exposure_method", True), ("auto_exposure_method", unreal.AutoExposureMethod.AEM_MANUAL),
                        ("override_auto_exposure_apply_physical_camera_exposure", True), ("auto_exposure_apply_physical_camera_exposure", False),
                        ("override_auto_exposure_bias", True), ("auto_exposure_bias", -EV100 + EXPOSURE_BRIGHTEN)):
        pp.set_editor_property(prop, value)
    comp.set_editor_property("post_process_settings", pp)
    comp.set_editor_property("post_process_blend_weight", 1.0)
    shots = []
    try:
        for (name, x, y, z, pitch, yaw, fov) in POSES:
            cap.set_actor_location_and_rotation(unreal.Vector(x, y, z), unreal.Rotator(roll=0.0, pitch=pitch, yaw=yaw), False, True)
            if fov < 0:                                   # a negative fov is an orthographic plan |fov| cm wide
                comp.set_editor_property("projection_type", unreal.CameraProjectionMode.ORTHOGRAPHIC)
                comp.set_editor_property("ortho_width", -fov)
            else:
                comp.set_editor_property("projection_type", unreal.CameraProjectionMode.PERSPECTIVE)
                comp.set_editor_property("fov_angle", fov)
            # a few captures let Lumen and the shadow caches settle on the new view
            for _ in range(CAPTURES):
                comp.capture_scene()
                yield SETTLE / CAPTURES
            fname = "%s__%s.png" % (name, TAG)
            unreal.RenderingLibrary.export_render_target(world, rt, SHOTS, fname)
            path = os.path.join(SHOTS, fname)
            shots.append({"camera": name, "path": path, "ok": os.path.exists(path)})
    finally:
        cap.destroy_actor()
    RESULT["shots"] = shots
    RESULT["status"] = "done"
