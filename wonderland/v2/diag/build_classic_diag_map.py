"""ONE-STEP TEST: a tiny CLASSIC (non World Partition) diagnostic map, SAVED and
REOPENED before anything is cooked.

/Game/WonderlandV2/Diag/WL_V2_RenderDiagnosticClassic
  - one CameraActor at (0,0,200) looking +Y (tags HeroCam0, arrival_hero_view)
  - one /Engine/BasicShapes/Cube scaled 20x4x20 (20 m x 4 m x 20 m) at (0,600,200)
    wearing the existing M_DiagUnlitMagenta (unchanged; recompiled so its shaders exist)
  - nothing else: no Wonderland assets, no Marble, no WP, no Data Layers, no PCG, no PPV
Prints a DIAG PROOF block: saved, bytes on disk, reopened actor list, WP status,
camera/cube transforms and the dot product proving the cube is in front.
"""
import os
import unreal

MAP = "/Game/WonderlandV2/Diag/WL_V2_RenderDiagnosticClassic"
MAT = "/Game/WonderlandV2/Diag/M_DiagUnlitMagenta"


def log(msg):
    unreal.log_warning("DIAG " + msg)


def rot(pitch, yaw, roll=0.0):
    r = unreal.Rotator()
    r.set_editor_property("pitch", float(pitch))
    r.set_editor_property("yaw", float(yaw))
    r.set_editor_property("roll", float(roll))
    return r


def umap_path():
    cdir = str(unreal.Paths.project_content_dir())
    return os.path.join(cdir, "WonderlandV2", "Diag", "WL_V2_RenderDiagnosticClassic.umap")


def main():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    eal = unreal.EditorAssetLibrary
    mel = unreal.MaterialEditingLibrary
    util = unreal.EditorLoadingAndSavingUtils
    if not eal.does_asset_exist(MAT):
        raise RuntimeError("M_DiagUnlitMagenta is missing -- the material must be the one that already rendered magenta")
    mat = eal.load_asset(MAT)
    mel.recompile_material(mat)          # shaders exist before any capture; the material itself is unchanged
    if eal.does_asset_exist(MAP):
        eal.delete_asset(MAP)
    ok = les.new_level(MAP, False)
    log("new_level(%s, is_partitioned_world=False) -> %s" % (MAP, ok))
    world = unreal.EditorLevelLibrary.get_editor_world()
    cube = eal.load_asset("/Engine/BasicShapes/Cube")
    a = actors.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(0.0, 600.0, 200.0), rot(0, 0))
    a.static_mesh_component.set_static_mesh(cube)
    a.set_actor_scale3d(unreal.Vector(20.0, 4.0, 20.0))
    a.static_mesh_component.set_material(0, mat)
    a.set_actor_label("DIAG_MagentaCube")
    a.static_mesh_component.set_mobility(unreal.ComponentMobility.STATIC)
    cam = actors.spawn_actor_from_class(unreal.CameraActor, unreal.Vector(0.0, 0.0, 200.0), rot(0.0, 90.0))
    cam.set_actor_label("DIAG_Camera")
    cam.set_editor_property("tags", [unreal.Name("HeroCam0"), unreal.Name("arrival_hero_view"), unreal.Name("DIAG")])
    try:
        cam.get_camera_component().set_editor_property("field_of_view", 90.0)
    except Exception as exc:
        log("fov not set (%s)" % exc)
    # SAVE, with every route this engine has answered to, then prove it on disk
    saved = []
    for name, fn in (("LevelEditorSubsystem.save_current_level", lambda: les.save_current_level()),
                     ("EditorLoadingAndSavingUtils.save_map", lambda: util.save_map(unreal.EditorLevelLibrary.get_editor_world(), MAP)),
                     ("EditorLevelLibrary.save_current_level", lambda: unreal.EditorLevelLibrary.save_current_level()),
                     ("save_packages([world package], only_dirty=False)", lambda: util.save_packages([unreal.EditorLevelLibrary.get_editor_world().get_outermost()], False))):
        try:
            r = fn()
        except Exception as exc:
            r = "EXC %s" % exc
        saved.append("%s -> %s" % (name, r))
        p = umap_path()
        if os.path.isfile(p) and os.path.getsize(p) > 12000:
            break
    util.save_dirty_packages(True, True)
    p = umap_path()
    size = os.path.getsize(p) if os.path.isfile(p) else 0
    log("SAVE ATTEMPTS: " + " | ".join(saved))
    log("MAP ON DISK: %s %d bytes" % (p, size))
    # REOPEN: load another map first so the reload is a real reopen, then this one
    util.load_map("/Engine/Maps/Entry")
    ok2 = util.load_map(MAP)
    world = unreal.EditorLevelLibrary.get_editor_world()
    alls = actors.get_all_level_actors()
    names = ["%s(%s)" % (x.get_actor_label(), x.get_class().get_name()) for x in alls]
    wp = "unknown"
    try:
        wps = world.get_world_settings().get_editor_property("world_partition")
        wp = "YES" if wps is not None else "NO"
    except Exception as exc:
        wp = "no property (%s)" % exc
    cam2 = next((x for x in alls if isinstance(x, unreal.CameraActor)), None)
    cube2 = next((x for x in alls if x.get_actor_label() == "DIAG_MagentaCube"), None)
    if cam2 and cube2:
        cl, ol = cam2.get_actor_location(), cube2.get_actor_location()
        fwd = cam2.get_actor_forward_vector()
        d = ol - cl
        dist = d.length()
        dot = (d.x * fwd.x + d.y * fwd.y + d.z * fwd.z) / max(dist, 1e-6)
        m0 = cube2.static_mesh_component.get_material(0)
        log("REOPENED: load_map -> %s; world=%s; actors=%d %s" % (ok2, world.get_name(), len(alls), names))
        log("PROOF: MAP SAVED=%s (%d bytes) | MAP REOPENS=YES | WORLD PARTITION=%s | CAMERA EXISTS=YES at %s rot %s fov 90 | CUBE EXISTS=YES at %s scale %s | MATERIAL=%s | CUBE IN FRONT: dist %.0f uu, dot(fwd)=%.3f -> %s"
            % ("YES" if size > 12000 else "NO", size, wp, cl, cam2.get_actor_rotation(), ol, cube2.get_actor_scale3d(),
               m0.get_path_name() if m0 else None, dist, dot, "YES" if dot > 0.9 else "NO"))
    else:
        log("REOPENED: load_map -> %s; actors=%d %s; camera %s cube %s -- FAILED" % (ok2, len(alls), names, bool(cam2), bool(cube2)))
    log("SUMMARY classic diag map saved=%s bytes=%d reopened=%s" % (size > 12000, size, bool(cam2 and cube2)))


main()
