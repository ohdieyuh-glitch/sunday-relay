"""P0 TEST C' -- the ACTUAL V2 map rendered from HeroCam0 through the editor
render-target path (SceneCapture2D -> export PNG). No cook, no packaged game.
Binary: if the V2 world shows here, the world is fine and the packaged/capture
path is the failing layer; if black, the V2 map/camera is at fault in the
editor too. Also logs what the loaded world contains.
"""
import os
import unreal

OUT_DIR = os.environ.get("WLV2_DIAG_OUT", "/teamspace/studios/this_studio/wonderland/proof/diag")
MAP = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival"


def log(msg):
    unreal.log_warning("DIAG " + msg)


def main():
    ok = unreal.EditorLoadingAndSavingUtils.load_map(MAP)
    world = unreal.EditorLevelLibrary.get_editor_world()
    log("load_map(%s) -> %s; world=%s" % (MAP, ok, world.get_name() if world else None))
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    alls = actors.get_all_level_actors()
    log("loaded world holds %d actors" % len(alls))
    cams = [a for a in alls if isinstance(a, unreal.CameraActor)]
    hero = None
    for a in cams:
        tags = [str(t) for t in (a.get_editor_property("tags") or [])]
        if "HeroCam0" in tags:
            hero = a
    log("cameras: %d; HeroCam0 %s" % (len(cams), "FOUND at %s rot %s" % (hero.get_actor_location(), hero.get_actor_rotation()) if hero else "MISSING"))
    # what is in front of the camera: nearest 6 actors by distance with their hidden/visible state
    if hero:
        cl = hero.get_actor_location()
        rows = []
        for a in alls:
            try:
                d = (a.get_actor_location() - cl).length()
            except Exception:
                continue
            rows.append((d, a))
        rows.sort(key=lambda t: t[0])
        for d, a in rows[:8]:
            try:
                comps = a.get_components_by_class(unreal.PrimitiveComponent)
                vis = ["%s vis=%s hidden=%s reg=%s" % (c.get_name(), c.is_visible(), c.get_editor_property("hidden_in_game"), c.is_registered()) for c in comps[:2]]
            except Exception as exc:
                vis = ["(%s)" % exc]
            log("  %.0f uu  %s (%s) hidden=%s %s" % (d, a.get_actor_label(), a.get_class().get_name(), a.is_hidden_ed(), "; ".join(vis)))
    if not os.path.isdir(OUT_DIR):
        os.makedirs(OUT_DIR)
    W, H = 640, 360
    src_loc = hero.get_actor_location() if hero else unreal.Vector(0.0, -150.0, 262.0)
    src_rot = hero.get_actor_rotation() if hero else unreal.Rotator()
    cap = actors.spawn_actor_from_class(unreal.SceneCapture2D, src_loc, src_rot)
    comp = cap.get_editor_property("capture_component2d")
    rt = unreal.RenderingLibrary.create_render_target2d(cap, W, H, unreal.TextureRenderTargetFormat.RTF_RGBA8, unreal.LinearColor(0, 0, 0, 1), False)
    comp.set_editor_property("texture_target", rt)
    comp.set_editor_property("fov_angle", 100.0)
    comp.set_editor_property("capture_source", unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR)
    comp.set_editor_property("capture_every_frame", False)
    for i in range(3):
        comp.capture_scene()
    name = "diag_v2map_herocam0_%dx%d.png" % (W, H)
    unreal.RenderingLibrary.export_render_target(cap, rt, OUT_DIR, name)
    p = os.path.join(OUT_DIR, name)
    log("EXPORTED %s (%s bytes)" % (p, os.path.getsize(p) if os.path.exists(p) else "MISSING"))
    # a second export: base colour only (no lighting/exposure) -- geometry proof
    try:
        comp.set_editor_property("capture_source", unreal.SceneCaptureSource.SCS_BASE_COLOR)
        comp.capture_scene()
        name2 = "diag_v2map_herocam0_basecolor.png"
        unreal.RenderingLibrary.export_render_target(cap, rt, OUT_DIR, name2)
        log("EXPORTED %s" % os.path.join(OUT_DIR, name2))
    except Exception as exc:
        log("base colour export failed (%s)" % exc)
    cap.destroy_actor()
    log("SUMMARY v2map editor capture done (nothing saved)")


main()
