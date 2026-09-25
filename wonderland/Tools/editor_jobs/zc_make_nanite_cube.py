# GIVE THE VOXEL FIGURES A CUBE THE GPU CAN CULL.
#
# MEASURED FIRST, 2026-09-24 (zc_avatar_cost): ten Project Avatars standing BEHIND the camera cost nothing at
# all -- 32.36 ms against a 32.37 ms baseline. The same ten turned to FACE the camera cost 202.6 ms, and 193.46
# of that is the RENDER THREAD while the GPU sits at 42.97 ms on 6,338 draw calls. Low draw calls, low GPU, huge
# render thread: that is not shading and it is not draw submission, it is the CPU walking 314,020 instances.
#
# WHY THEY ARE ENGINE CUBES. Every .wlvox figure is built from instances of /Engine/BasicShapes/Cube, and the
# Nanite pass that took the world from 114.95 to 55.54 ms deliberately left the engine's own meshes alone --
# correctly, because they are shared editor furniture and this project does not own them. The avatars were the
# one place that decision cost something.
#
# So this makes the project its OWN cube and turns Nanite on for that. Nothing engine-side is touched, nothing
# is deleted, and the runtime falls back to the engine cube if this asset is ever missing.
import unreal

SRC = "/Engine/BasicShapes/Cube.Cube"
DST_DIR = "/Game/Wonderland/Meshes"
DST_NAME = "SM_WL_VoxelCube"
DST = DST_DIR + "/" + DST_NAME


def job():
    RESULT["status"] = "running"
    lib = unreal.EditorAssetLibrary

    if lib.does_asset_exist(DST):
        RESULT["already_existed"] = True
    else:
        if not lib.duplicate_asset(SRC, DST):
            RESULT["status"] = "FAIL: could not duplicate the engine cube"
            yield 0.1
            return
        RESULT["already_existed"] = False

    mesh = unreal.load_asset(DST)
    if mesh is None:
        RESULT["status"] = "FAIL: the duplicated cube would not load"
        yield 0.1
        return

    settings = mesh.get_editor_property("nanite_settings")
    RESULT["nanite_before"] = bool(settings.enabled)
    settings.enabled = True
    mesh.set_editor_property("nanite_settings", settings)

    # A cube has twelve triangles and nothing to simplify, so the fallback is the mesh itself; what is wanted
    # here is Nanite's INSTANCE culling, which is GPU-side, not its triangle simplification.
    unreal.EditorAssetLibrary.save_loaded_asset(mesh)
    reread = unreal.load_asset(DST)
    RESULT["nanite_after"] = bool(reread.get_editor_property("nanite_settings").enabled)
    RESULT["asset"] = DST
    RESULT["triangles"] = int(reread.get_num_triangles(0)) if hasattr(reread, "get_num_triangles") else None
    RESULT["status"] = "built" if RESULT["nanite_after"] else "FAIL: Nanite did not stick"
    yield 0.1
