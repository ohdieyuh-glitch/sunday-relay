# DID THE SOFTNESS CHANGE ACTUALLY REACH THE FLAME THAT IS DRAWN?
#
# FOUNDER, P0 item 4: "believable animated Unreal fire, not plastic voxel flames... with flicker, emissive
# falloff, softness/distortion."
#
# I RAISED M_WL_Fire's EdgeSoftness FROM 0.85 TO 2.6 AND TipFalloff FROM 1.45 TO 2.2, rebuilt the material,
# re-captured, saw no visible change, and concluded that the hardness is the ribbon's own silhouette rather
# than its falloff -- so item 4 needs Niagara or soft cards rather than a material tune.
#
# THAT CONCLUSION RESTS ON AN UNCHECKED ASSUMPTION, and it is the one this evening has punished four separate
# times: that a value I set is a value that arrived. I have not read back what the drawn flame is actually
# using. If the figures' material instances were created before the rebuild, or if the runtime overrides
# these scalars, then the picture I judged was the OLD material and the conclusion is premature.
#
# So this reads the parameters off three places and compares them:
#
#   THE ASSET     M_WL_Fire's own scalar defaults, which is what the rebuild wrote.
#   THE INSTANCE  the MID a dressed figure is actually wearing, which is what gets drawn.
#   THE RUNTIME   whether anything in C++ sets these names at all, answered by the instance disagreeing
#                 with the asset.
#
# IF THE INSTANCE MATCHES THE ASSET at 2.6 and 2.2, the softening genuinely reached the pixels and did not
# help, and item 4's conclusion stands on evidence rather than on assumption. IF IT DOES NOT, the comparison
# I drew was between two pictures of the same old material and has to be redone.
#
# EITHER ANSWER IS WORTH THE RUN. The first closes item 4's diagnosis honestly; the second retracts a
# conclusion before it gets built on.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import unreal

L = unreal.WonderlandUiTestLibrary

WANT = {"EdgeSoftness": 2.6, "TipFalloff": 2.2}
MATERIAL = "/Game/Wonderland/Materials/M_WL_Fire.M_WL_Fire"
SKIN = "arden_infernal"


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    # ---- THE ASSET, read without PIE.
    asset = None
    try:
        asset = unreal.load_asset(MATERIAL)
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["load"] = str(err)[:140]
    on_disk = {}
    for name, want in WANT.items():
        got = None
        try:
            got = float(unreal.MaterialEditingLibrary.get_material_default_scalar_parameter_value(
                asset, unreal.Name(name)))
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})["asset/%s" % name] = str(err)[:140]
        on_disk[name] = got
    RESULT["asset_defaults"] = on_disk
    record("P00", "the rebuilt material carries the softer values on disk",
           all(on_disk.get(k) is not None and abs(on_disk[k] - v) < 0.01 for k, v in WANT.items()),
           wanted=WANT, on_disk=on_disk,
           note="this is what zc_make_fire_material wrote. If it is still 0.85 the rebuild did not take and "
                "nothing downstream can be right.")

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

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    ui = L.get_ui(world)
    if ui is None or dog is None:
        RESULT["status"] = "VOID: no UI subsystem or no pawn"
        return

    unreal.SystemLibrary.execute_console_command(world, "wl.Look.FireMaterial 1")
    yield 2.0
    try:
        ui.wear_relay_skin(SKIN)
    except Exception as err:                                        # noqa: BLE001
        RESULT["status"] = "VOID: could not wear %s (%s)" % (SKIN, str(err)[:90])
        return
    yield 7.0

    # ---- THE INSTANCE THE DRESSED FIGURE IS WEARING.
    costume = None
    for actor in unreal.GameplayStatics.get_all_actors_of_class(
            world, unreal.WonderlandCompanionEmbodiment):
        if actor.get_attach_parent_actor() == dog:
            costume = actor
            break
    record("P01", "the costume on the Dog was found", costume is not None)
    if costume is None:
        RESULT["status"] = "VOID: no costume"
        return

    worn = {}
    seen_materials = []
    for comp in costume.get_components_by_class(unreal.PrimitiveComponent):
        try:
            count = comp.get_num_materials()
        except Exception:                                           # noqa: BLE001
            continue
        for slot in range(count):
            mat = None
            try:
                mat = comp.get_material(slot)
            except Exception:                                       # noqa: BLE001
                continue
            if mat is None:
                continue
            name = mat.get_name()
            if "Fire" not in name:
                continue
            seen_materials.append(name)
            for pname in WANT:
                try:
                    val = float(mat.get_scalar_parameter_value(unreal.Name(pname)))
                    worn.setdefault(pname, []).append(round(val, 4))
                except Exception:                                   # noqa: BLE001
                    pass
    RESULT["materials_seen"] = sorted(set(seen_materials))[:6]
    RESULT["worn_values"] = {k: sorted(set(v)) for k, v in worn.items()}
    record("P02", "a flame material instance was found on the dressed figure",
           bool(seen_materials), materials=RESULT["materials_seen"],
           note="the ribbons wear a MID of M_WL_Fire when wl.Look.FireMaterial is 1. If none is found the "
                "figure is not drawing that surface and the comparison was never about it.")

    agrees = all(
        worn.get(k) and all(abs(v - WANT[k]) < 0.01 for v in worn[k]) for k in WANT)
    record("P03", "the flame being DRAWN is using the softer values, not the old ones",
           agrees, wanted=WANT, worn=RESULT["worn_values"], asset=on_disk,
           note="THE QUESTION. Item 4's conclusion -- that softening the material changed nothing visible, "
                "so the hardness is the ribbon's silhouette and the fix is Niagara -- assumes the softer "
                "material is what I photographed. If these disagree with the asset, I compared two pictures "
                "of the OLD material and that conclusion has to be withdrawn.")

    unreal.SystemLibrary.execute_console_command(world, "wl.Look.FireMaterial 0")
    yield 1.5
    try:
        ui.wear_relay_skin("relay_og")
    except Exception:                                               # noqa: BLE001
        pass
    yield 3.0
    record("P_SKIN", "Relay OG was put back and the fire knob restored",
           "relay_og" in str(dog.get_worn_skin_id()).lower(),
           worn=str(dog.get_worn_skin_id()),
           fire_material=unreal.SystemLibrary.get_console_variable_float_value("wl.Look.FireMaterial"))

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
