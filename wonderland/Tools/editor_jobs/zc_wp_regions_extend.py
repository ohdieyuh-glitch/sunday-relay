# EXTEND THE EDITOR REGIONS TO THE WHOLE RUNTIME WORLD (+/-1.5 km), now that batches have real bounds.
#
# The 16 regions zc_wp_regions loaded on 2026-09-28 were planned while every WonderlandInstancedBatch's descriptor
# was a point at the origin (fixed in f97ba360), so their union stops at about +/-1 km and still "contained" every
# batch. With real bounds, a batch beyond the union -- DF01 at 1.23-1.48 km, the W270 Exchange at 1,075 m, the
# outer ring -- would not load in the editor after the next restart, and a layer re-apply (which deletes its old
# actors by scanning LOADED actors) would duplicate it. Four strips close the frame between the union and the
# runtime bounds. Everything is already resident in this session, so loading them costs little; the point is
# that they persist (EditorPerProjectUserSettings) for the next start. No map edit, no save.
CONCURRENT = False
import unreal

Z0, Z1 = -110000.0, 60000.0
STRIPS = (
    (-150000.0, 104000.0, 150000.0, 150000.0),     # north
    (-150000.0, -150000.0, 150000.0, -97000.0),    # south
    (-150000.0, -97000.0, -100000.0, 104000.0),    # west
    (96000.0, -97000.0, 150000.0, 104000.0),       # east
)


def job():
    L = unreal.WonderlandUiTestLibrary
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        RESULT["status"] = "refused: PIE is running"
        return
    world = ues.get_editor_world()
    RESULT["before"] = L.describe_editor_regions(world)
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    RESULT["actors_before"] = len(eas.get_all_level_actors())
    boxes = []
    for (x0, y0, x1, y1) in STRIPS:
        box = unreal.Box()
        box.set_editor_property("min", unreal.Vector(x0, y0, Z0))
        box.set_editor_property("max", unreal.Vector(x1, y1, Z1))
        boxes.append(box)
    RESULT["load"] = L.load_editor_regions(world, boxes)
    yield 5.0
    RESULT["after"] = L.describe_editor_regions(ues.get_editor_world())
    RESULT["actors_after"] = len(eas.get_all_level_actors())
    RESULT["dirty"] = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()][:10]
    RESULT["status"] = "done"
