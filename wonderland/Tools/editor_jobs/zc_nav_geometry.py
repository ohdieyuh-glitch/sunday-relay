# DOES THIS WORLD'S GEOMETRY OFFER ANYTHING FOR RECAST TO BUILD ON?
#
# The invoker is registered (zc_nav_diag: has_invoker True, component NavInvoker) and after 90 seconds there
# is still no reachable point within 3,000 uu. So the question is no longer whether generation was asked for
# -- it is whether there is any geometry that navigation is allowed to see.
#
# WONDERLAND IS INSTANCED, NOT ACTORS: 174,787 instances over 3,904 instanced components. Recast builds from
# COLLISION, and an instanced component contributes nothing unless it both has collision enabled and is
# allowed to affect navigation. Either being off across the world would produce exactly what was measured --
# a navmesh actor with bounds and nothing inside them.
#
# This counts rather than assumes, because "the collision is probably off" is the kind of guess that sends
# you to rebuild a system that was already working.
CONCURRENT = True

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
    gw = ues.get_game_world()
    L.focus_game_viewport()
    yield 4.0

    total_comp = 0
    total_inst = 0
    with_collision = 0
    affect_nav = 0
    both = 0
    inst_both = 0
    samples = []
    checked = 0

    for actor in unreal.GameplayStatics.get_all_actors_of_class(gw, unreal.Actor):
        try:
            comps = actor.get_components_by_class(unreal.InstancedStaticMeshComponent)
        except Exception:
            continue
        for c in comps:
            total_comp += 1
            n = 0
            try:
                n = int(c.get_instance_count())
            except Exception:
                pass
            total_inst += n

            coll = False
            nav = False
            try:
                coll = str(c.get_collision_enabled()) not in ("CollisionEnabled.NO_COLLISION", "NO_COLLISION")
            except Exception:
                pass
            try:
                nav = bool(c.get_editor_property("can_ever_affect_navigation"))
            except Exception:
                pass
            if coll:
                with_collision += 1
            if nav:
                affect_nav += 1
            if coll and nav:
                both += 1
                inst_both += n
            if len(samples) < 12:
                samples.append({"actor": str(actor.get_name())[:34], "comp": str(c.get_name())[:28],
                                "instances": n, "collision": coll, "affects_nav": nav})
            checked += 1
            if checked % 200 == 0:
                yield 0.0

    RESULT["instanced_components"] = total_comp
    RESULT["instances"] = total_inst
    RESULT["components_with_collision"] = with_collision
    RESULT["components_affecting_nav"] = affect_nav
    RESULT["components_usable_by_recast"] = both
    RESULT["instances_usable_by_recast"] = inst_both
    RESULT["samples"] = samples

    emit("G01", "INFO", "what recast can see", {
        "instanced_components": total_comp,
        "instances": total_inst,
        "with_collision": with_collision,
        "affect_navigation": affect_nav,
        "BOTH (usable)": both,
        "instances usable": inst_both,
    })

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
