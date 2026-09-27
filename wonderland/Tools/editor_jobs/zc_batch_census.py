# HOW IS THE WORLD'S INSTANCING ACTUALLY DISTRIBUTED?
#
# The world is 174,787 instances across 3,904 instanced components -- about 45 each on average, which is a
# suspiciously low number for a system whose whole purpose is to submit many copies of one thing at once.
# An average hides a tail: if most components carry a handful of instances, the world is paying component
# overhead over and over for batches that are barely batches, and consolidating the ones that share a mesh
# and a material would cut real work.
#
# That is the same shape of finding as the avatars' 123 groups against 25 -- and the same trap, because there
# the fix bought 5% and the theory turned out to be wrong. So this only COUNTS. What the distribution is
# worth comes after, from a measurement, not from the census looking suggestive.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import collections
import unreal

L = unreal.WonderlandUiTestLibrary


def job():
    RESULT["status"] = "running"
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 5.0

    counts = []
    by_mesh_material = collections.Counter()
    components = 0
    instances = 0
    checked = 0

    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        try:
            comps = actor.get_components_by_class(unreal.InstancedStaticMeshComponent)
        except Exception:
            continue
        for c in comps:
            n = 0
            try:
                n = int(c.get_instance_count())
            except Exception:
                pass
            components += 1
            instances += n
            counts.append(n)
            mesh = None
            try:
                m = c.get_editor_property("static_mesh")
                mesh = str(m.get_name()) if m is not None else "none"
            except Exception:
                mesh = "unreadable"
            mat = "none"
            try:
                if int(c.get_num_materials()) > 0:
                    mm = c.get_material(0)
                    mat = str(mm.get_name()) if mm is not None else "none"
            except Exception:
                mat = "unreadable"
            by_mesh_material[(mesh, mat)] += 1
            checked += 1
            if checked % 250 == 0:
                yield 0.0

    counts.sort()
    RESULT["components"] = components
    RESULT["instances"] = instances
    RESULT["instances_per_component_mean"] = round(instances / max(components, 1), 1)
    RESULT["instances_per_component_median"] = counts[len(counts) // 2] if counts else 0
    for cut in (1, 2, 5, 10, 25, 50):
        RESULT["components_with_%d_or_fewer" % cut] = sum(1 for n in counts if n <= cut)

    # THE PRIZE, IF THERE IS ONE: distinct mesh+material pairs. Every component sharing a pair with another
    # is, in principle, a batch that did not have to be its own component.
    RESULT["distinct_mesh_material_pairs"] = len(by_mesh_material)
    RESULT["components_that_could_merge"] = components - len(by_mesh_material)
    worst = by_mesh_material.most_common(8)
    RESULT["most_split_pairs"] = [{"mesh": k[0][:34], "material": k[1][:28], "components": v} for k, v in worst]

    emit("C01", "INFO", "the world's instancing, counted", {
        "components": components,
        "instances": instances,
        "mean_per_component": RESULT["instances_per_component_mean"],
        "median_per_component": RESULT["instances_per_component_median"],
        "with_1_or_fewer": RESULT["components_with_1_or_fewer"],
        "with_5_or_fewer": RESULT["components_with_5_or_fewer"],
        "distinct_mesh_material_pairs": RESULT["distinct_mesh_material_pairs"],
        "components_that_could_merge": RESULT["components_that_could_merge"],
    })

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
