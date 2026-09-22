# Editor job: give the world's STREET FURNITURE collision, and leave its ornament alone. Reversible.
#
# WHY (the gap left open by BR01, 2026-09-22). BR01 made architecture and ground solid and deliberately left 861
# batches classified "other" untouched, noting that "a lamp post a player walks through is a smaller fault than a
# building, but it is on the list." This is that list. The audit shows what is actually in it:
#
#   SM_waymarker_lamp 144, SM_waymarker 129   <- lamp posts and waymarkers, at head height, in every street
#   SM_planter_box 28, SM_fountain_basin 22, SM_garden_bench 17, SM_gear_monument 15, SM_clock_ornate 19
#   SM_roof_cone_steep 71, SM_roof_bell 58, SM_roof_hip 51, SM_roof_ogee 42   <- roofs, metres above any player
#   WL_Detail_Banner_Blade_* 124, WL_Detail_Window_* 78, WL_Detail_Oriel_Bay_* 52, SM_balcony_ring 50
#
# THE RULE IS SIZE AND PLACE, NOT A LIST OF NAMES. A name list would have to be maintained forever and would get
# Wonderland's giant teacups wrong -- they are landmarks here, not tableware. So a batch collides if the thing is
# big enough to walk into (its mesh is at least MIN_HEIGHT tall) AND its instances actually sit near the ground
# (median instance z below MAX_Z). Roofs, banners, oriels and balcony rings fail the second test because they live
# in the air; a waymarker lamp passes both.
#
# ORNAMENT WORDS are still excluded outright, because some of it is large AND low: a banner blade hangs down a
# wall, and a window sits in one. Nobody should be stopped by either.
# Globals: RECORD, REVERT, SAVE, MIN_HEIGHT, MAX_Z, MAX_INSTANCES.
import json
import os

RECORD = globals().get("RECORD")
REVERT = globals().get("REVERT", False)
SAVE = globals().get("SAVE", False)
MIN_HEIGHT = float(globals().get("MIN_HEIGHT", 60.0))     # shorter than this and a player steps over it
MAX_Z = float(globals().get("MAX_Z", 260.0))              # higher than this and it is above a player's head
MAX_INSTANCES = int(globals().get("MAX_INSTANCES", 4000))
ORNAMENT = ("roof", "banner", "window", "oriel", "balcony", "bracket", "finial", "swag", "hanging", "cloud",
            "sky", "spire", "pinnacle", "crenel", "veg_anchor", "glass", "gold", "petal", "bloom", "leaf")
ARCH = ("castle", "facade", "tower", "hall", "house", "gatehouse", "cloister", "arcade", "wall", "gate", "bridge",
        "stair", "step", "pavilion", "screen", "column", "balustrade", "pier", "plinth")
GROUND = ("terrace_platform", "plaza_slab", "path_flag", "cobble", "kerb", "garden_lawn", "ground", "medallion")
FOLIAGE = ("tree", "canopy", "shrub", "hedge", "topiary", "rose", "flower", "lavender", "blossom", "grass", "ivy",
           "vine", "mushroom", "leaf", "petal", "tuft")


def kind_of(name):
    low = name.lower()
    for words, kind in ((GROUND, "ground"), (FOLIAGE, "foliage"), (ARCH, "architecture")):
        if any(w in low for w in words):
            return kind
    return "other"


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    world = ues.get_editor_world()
    record = json.load(open(RECORD)) if (RECORD and os.path.exists(RECORD)) else {}

    changed, instances, skipped, chosen = 0, 0, {}, []
    n = 0
    for b in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        n += 1
        if n % 300 == 0:
            yield None
        mesh = b.get_editor_property("mesh")
        ism = b.get_component_by_class(unreal.InstancedStaticMeshComponent)
        if mesh is None or ism is None:
            continue
        name = b.get_name()
        if REVERT:
            if name not in record:
                continue
            b.set_editor_property("collides", record[name]["before"])
            changed += 1
            continue
        mesh_name = mesh.get_name()
        if kind_of(mesh_name) != "other":
            continue
        if bool(b.get_editor_property("collides")):
            skipped["already"] = skipped.get("already", 0) + 1
            continue
        low = mesh_name.lower()
        if any(w in low for w in ORNAMENT):
            skipped["ornament"] = skipped.get("ornament", 0) + 1
            continue
        count = ism.get_instance_count()
        if count == 0 or count > MAX_INSTANCES:
            skipped["count"] = skipped.get("count", 0) + 1
            continue
        try:
            height = mesh.get_bounds().box_extent.z * 2.0
        except Exception:
            height = 0.0
        if height < MIN_HEIGHT:
            skipped["too short (%d cm)" % MIN_HEIGHT] = skipped.get("too short (%d cm)" % MIN_HEIGHT, 0) + 1
            continue
        # where do its instances actually sit? the median, so one outlier cannot decide it
        zs = []
        for i in range(0, count, max(1, count // 24)):
            xf = ism.get_instance_transform(i, True)
            if xf is not None:
                zs.append(xf.translation.z)
        if not zs:
            continue
        zs.sort()
        median_z = zs[len(zs) // 2]
        if median_z > MAX_Z:
            skipped["above head (z>%d)" % MAX_Z] = skipped.get("above head (z>%d)" % MAX_Z, 0) + 1
            continue
        record.setdefault(name, {"label": b.get_actor_label(), "mesh": mesh_name, "before": False,
                                 "instances": count, "height_cm": round(height, 1),
                                 "median_z": round(median_z, 1)})
        b.set_editor_property("collides", True)
        changed += 1
        instances += count
        if len(chosen) < 24:
            chosen.append("%s (%d, %.0f cm, z %.0f)" % (mesh_name, count, height, median_z))

    if RECORD and not REVERT:
        os.makedirs(os.path.dirname(RECORD), exist_ok=True)
        with open(RECORD, "w", newline="\n") as f:
            json.dump(record, f, indent=1)
    RESULT["batches_changed"] = changed
    RESULT["instances_affected"] = instances
    RESULT["skipped"] = skipped
    RESULT["examples"] = chosen
    yield 1.0
    if SAVE:
        RESULT["saved"] = bool(unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level())
    RESULT["status"] = "done"
