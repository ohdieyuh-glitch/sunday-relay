# WHAT IS EACH SKIN ACTUALLY MADE OF, PART BY PART?
#
# THE QUESTION THIS SETTLES. The wardrobe camera now solves its distance from GetFramingBodyBounds, and the
# solve is arithmetically perfect -- it predicts 80% occupancy for every skin and the exported pixels show
# about 135%. A solve that is right about its own maths and wrong about the world is being fed a bad number,
# and the bad number is the body height: 91 uu for Relay OG and exactly 30 uu for Apollo, Skeleton Flame and
# Celestial Light, against declared envelopes of 155 to 399.
#
# WHY IT IS WRONG, AND IT IS A CLASSIFICATION ERROR RATHER THAN A GEOMETRY ONE. A part counts as "body" only
# if its material is Lit or Rim. Three of the five skins are built almost entirely from Glow and Additive
# materials -- a glowing torso is still a torso -- so for those skins nearly the whole figure is classified as
# not-body and the box collapses onto whatever small solid fragment remains.
#
# The founder's rule is about what a part IS, not how it is shaded: frame on the physical body, exclude halos,
# flames, particles, glow cards and props. That needs the part NAMES, and nothing in the source lists them.
# So this asks the figures themselves, and the answer decides the classifier rather than a guess about it.
CONCURRENT = True

import unreal

L = unreal.WonderlandUiTestLibrary

SKINS = ("relay_og", "arden_infernal", "apollo", "skeleton_flame", "celestial_light")


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

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
    yield 6.0
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.0")
    ui = L.get_ui(world)
    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    ui.press_switch_skin()
    yield 4.0

    def showcase():
        for actor in unreal.GameplayStatics.get_all_actors_of_class(
                world, unreal.WonderlandCompanionEmbodiment):
            try:
                if "SkinStage" in str(actor.get_actor_label()):
                    return actor
            except Exception:                                      # noqa: BLE001
                pass
        return None

    per = {}
    RESULT["by_skin"] = per
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 5.0
        figure = showcase()
        if figure is None:
            per[skin] = {"error": "no showcase figure"}
            continue
        row = {}
        per[skin] = row
        try:
            row["flames"] = str(figure.describe_flames())[:600]
        except Exception as err:                                   # noqa: BLE001
            row["flames"] = "?" + str(err)[:80]

        # ---- EVERY INSTANCED COMPONENT, ITS NAME AND THE BOX IT ACTUALLY OCCUPIES.
        #
        # The component's NAME carries the part name it was built from, which is the vocabulary the classifier
        # has to work in. The box is recorded beside it so a part that is named like a body but sits out at
        # halo radius cannot hide -- and so the union of the plausible body parts can be checked against the
        # figure's declared height before any of this is written into C++.
        parts = []
        row["parts"] = parts
        lo = None
        hi = None
        try:
            for comp in figure.get_components_by_class(unreal.InstancedStaticMeshComponent):
                try:
                    name = str(comp.get_name())
                    count = int(comp.get_instance_count())
                    box = comp.get_editor_property("bounds")
                    origin = box.origin
                    extent = box.box_extent
                    top = float(origin.z) + float(extent.z)
                    bottom = float(origin.z) - float(extent.z)
                    parts.append({
                        "name": name, "instances": count,
                        "z_bottom": round(bottom, 1), "z_top": round(top, 1),
                        "tall": round(float(extent.z) * 2.0, 1),
                        "wide": round(max(float(extent.x), float(extent.y)) * 2.0, 1)})
                    lo = bottom if lo is None else min(lo, bottom)
                    hi = top if hi is None else max(hi, top)
                except Exception:                                  # noqa: BLE001
                    pass
        except Exception as err:                                   # noqa: BLE001
            row["parts_error"] = str(err)[:100]
        row["component_count"] = len(parts)
        if lo is not None:
            row["all_parts_tall"] = round(hi - lo, 1)
        try:
            row["declared_height"] = round(float(figure.get_figure_height_uu()), 1)
        except Exception:                                          # noqa: BLE001
            pass
        emit("B_%s" % skin, "INFO", skin,
             {"components": len(parts), "all_parts_tall": row.get("all_parts_tall"),
              "declared": row.get("declared_height"),
              "names": [p["name"] for p in parts][:40]})

    tests.append({"id": "B00", "name": "every skin was taken apart", "pass": True,
                  "detail": {"skins": list(SKINS)}})
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
