# HOW BIG IS THE GROUND SLAB, AND WHAT TEXSCALE WOULD MATCH THE LAWN?
#
# MI_V2_Moss and MI_V2_Lawn share a parent and an identical TexScale of 0.009, yet the lawn reads as grass
# and the slab reads as flat green. The difference is not the material, it is the UVs underneath it:
# SM_garden_lawn is unwrapped at world scale, so 0.009 tiles about once a metre, while V2_GroundSlab is an
# engine Cube whose UVs run 0..1 across the whole face however large it is scaled. 0.009 of one tile spread
# across the world is a single colour, which is exactly what the founder is looking at.
#
# So the number I need is the slab's real size, and nothing gets changed until I have it -- the correction
# is a ratio, and a ratio guessed from a screenshot would be a texture either invisible or crawling.
CONCURRENT = True

import unreal


def job():
    RESULT["status"] = "running"
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    world = ues.get_editor_world()

    slabs = []
    RESULT["slabs"] = slabs
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        label = ""
        try:
            label = str(actor.get_actor_label())
        except Exception:
            continue
        if "GroundSlab" not in label:
            continue
        row = {"label": label}
        try:
            s = actor.get_actor_scale3d()
            row["scale"] = [round(float(s.x), 2), round(float(s.y), 2), round(float(s.z), 2)]
        except Exception:
            pass
        try:
            origin, extent = actor.get_actor_bounds(False)
            row["extent_uu"] = [round(float(extent.x), 1), round(float(extent.y), 1), round(float(extent.z), 1)]
            row["across_m"] = round(float(extent.x) * 2.0 / 100.0, 1)
        except Exception as err:                                   # noqa: BLE001
            row["bounds_error"] = str(err)[:100]
        comps = []
        try:
            for c in actor.get_components_by_class(unreal.StaticMeshComponent):
                entry = {"name": str(c.get_name())[:40]}
                try:
                    m = c.get_editor_property("static_mesh")
                    entry["mesh"] = str(m.get_name()) if m is not None else None
                except Exception:
                    pass
                mats = []
                try:
                    for i in range(int(c.get_num_materials())):
                        mm = c.get_material(i)
                        mats.append(str(mm.get_name()) if mm is not None else None)
                except Exception:
                    pass
                entry["materials"] = mats
                comps.append(entry)
        except Exception as err:                                   # noqa: BLE001
            row["component_error"] = str(err)[:100]
        row["components"] = comps
        slabs.append(row)
        emit(label, "INFO", "ground slab", row)
        yield 0.0

    # WHAT THE CORRECTION WOULD BE. A Cube's UVs are 0..1 across the face, so to tile at the lawn's density
    # the scale has to carry the whole width: tiles wanted = width in uu * the lawn's own 0.009 per uu.
    if slabs:
        across = slabs[0].get("extent_uu", [0, 0, 0])[0] * 2.0
        RESULT["slab_width_uu"] = round(across, 1)
        RESULT["texscale_to_match_lawn"] = round(across * 0.009, 1)
        emit("PLAN", "INFO", "what would match the lawn",
             {"slab_width_uu": RESULT["slab_width_uu"],
              "lawn_texscale_per_uu": 0.009,
              "texscale_for_a_0_to_1_uv_cube": RESULT["texscale_to_match_lawn"]})

    RESULT["status"] = "measured"
