# GIVE THE GROUND SLAB A TEXTURE THAT CAN ACTUALLY BE SEEN
#
# MEASURED FIRST, in zc_slab_measure: V2_GroundSlab is an engine Cube scaled 3000 x 3000 -- three kilometres
# across -- wearing MI_V2_Moss at TexScale 0.009. A Cube's UVs run 0..1 across the face however large it is
# scaled, so that is 0.009 of one tile spread over three kilometres: a single flat colour. SM_garden_lawn
# looks like grass at the same 0.009 only because it is unwrapped at world scale, where 0.009 tiles about
# once a metre. The material was never the problem; the UVs under it were.
#
# 300,000 uu * 0.009 per uu = 2700 tiles, which puts the slab at the lawn's own density.
#
# NOTHING SHARED IS EDITED. MI_V2_Moss is worn by other surfaces that are unwrapped properly and look right,
# and raising TexScale on it would wreck every one of them to fix this slab. A child instance is created for
# the slab alone, so the fix reaches exactly the surface that is broken.
CONCURRENT = True

import unreal

SOURCE = "/Game/WonderlandV2/Materials/Instances/MI_V2_Moss"
CHILD = "/Game/WonderlandV2/Materials/Instances/MI_V2_MossSlab"

#: A DELIBERATE PROBE, not a final value. 2700 was derived from treating TexScale as a multiplier on 0..1
#: cube UVs, and it changed the render not at all -- while the PIE trace confirmed the slab really was
#: wearing the new instance. That rules the model out: if TexScale multiplied UVs, 2700 across three
#: kilometres would have been unmistakable. It is far more likely WORLD-SPACE, in which case 0.009 already
#: tiles about every 111 uu and 2700 tiles so densely it mips to a flat average -- the same flat green, for
#: the opposite reason. 0.05 would be a tile every 20 cm: obvious under the world-space model, and still
#: flat under the UV model. Either way the answer is in the next capture.
TEX_SCALE = 0.03
#: MacroScale is the slow large-scale variation and is in the same UV space, so it is carried by the same
#: factor -- 0.0002 * 300000 -- or the macro blotches would be the new flat colour.
MACRO_SCALE = 0.0009


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)

    # ---- THE CHILD INSTANCE
    made = False
    if not unreal.EditorAssetLibrary.does_asset_exist(CHILD):
        ok = unreal.EditorAssetLibrary.duplicate_asset(SOURCE, CHILD)
        made = ok is not None
    mat = unreal.EditorAssetLibrary.load_asset(CHILD)
    if mat is None:
        record("S00", "a slab-only material instance exists", False, note="could not create or load %s" % CHILD)
        RESULT["status"] = "FAIL"
        return

    before = {}
    for n in ("TexScale", "MacroScale"):
        try:
            before[n] = round(float(
                unreal.MaterialEditingLibrary.get_material_instance_scalar_parameter_value(mat, n)), 5)
        except Exception:
            before[n] = None
    unreal.MaterialEditingLibrary.set_material_instance_scalar_parameter_value(mat, "TexScale", TEX_SCALE)
    unreal.MaterialEditingLibrary.set_material_instance_scalar_parameter_value(mat, "MacroScale", MACRO_SCALE)
    # BREAK THE REPETITION. At a 20 cm tile the ground read as ground but showed a regular grid at middle
    # distance, which is what tiling always does when nothing varies across it. MacroVary is the parent
    # material's own knob for exactly this -- a slow large-scale modulation laid over the tile -- so it is
    # raised from the moss default of 0.18 rather than a new mechanism being invented for it.
    unreal.MaterialEditingLibrary.set_material_instance_scalar_parameter_value(mat, "MacroVary", 0.30)
    try:
        unreal.MaterialEditingLibrary.update_material_instance(mat)
    except Exception:
        pass
    unreal.EditorAssetLibrary.save_asset(CHILD)
    after = {}
    for n in ("TexScale", "MacroScale"):
        try:
            after[n] = round(float(
                unreal.MaterialEditingLibrary.get_material_instance_scalar_parameter_value(mat, n)), 5)
        except Exception:
            after[n] = None
    RESULT["child_created"] = made
    RESULT["before"] = before
    RESULT["after"] = after
    record("S00", "a slab-only material carries the corrected tiling",
           after.get("TexScale") == TEX_SCALE, created=made, before=before, after=after,
           note="MI_V2_Moss itself is untouched; other surfaces wearing it are unwrapped properly and "
                "raising its TexScale would break every one of them")
    yield 1.0

    # ---- AND ONTO THE SLAB, which is the only place it goes.
    world = ues.get_editor_world()
    dressed = []
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        try:
            label = str(actor.get_actor_label())
        except Exception:
            continue
        if "GroundSlab" not in label:
            continue
        for c in actor.get_components_by_class(unreal.StaticMeshComponent):
            worn = []
            try:
                for i in range(int(c.get_num_materials())):
                    m = c.get_material(i)
                    worn.append(str(m.get_name()) if m is not None else None)
            except Exception:
                pass
            if any(w == "MI_V2_Moss" for w in worn):
                for i, w in enumerate(worn):
                    if w == "MI_V2_Moss":
                        c.set_material(i, mat)
                dressed.append({"actor": label, "component": str(c.get_name())[:36], "slots": len(worn)})
        yield 0.0
    RESULT["dressed"] = dressed
    record("S01", "the ground slab wears it", len(dressed) > 0, dressed=dressed)

    yield 1.0
    try:
        les.save_current_level()
    except Exception as err:                                       # noqa: BLE001
        RESULT["save_error"] = str(err)[:200]
    yield 3.0

    # ---- READ IT BACK OFF THE ACTOR, because setting a material and having it stick are different things.
    confirmed = []
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        try:
            label = str(actor.get_actor_label())
        except Exception:
            continue
        if "GroundSlab" not in label:
            continue
        for c in actor.get_components_by_class(unreal.StaticMeshComponent):
            try:
                for i in range(int(c.get_num_materials())):
                    m = c.get_material(i)
                    confirmed.append(str(m.get_name()) if m is not None else None)
            except Exception:
                pass
    RESULT["slab_wears_now"] = confirmed
    record("S02", "and still wears it after the level was saved",
           any(w == "MI_V2_MossSlab" for w in confirmed), worn=confirmed)

    RESULT["status"] = "measured"
