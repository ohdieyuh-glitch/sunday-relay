# Editor job: what stands along the Golden Arrival corridor today, and how the generator used the
# hero meshes elsewhere (scale, materials), so new authored pieces match the world's own conventions.
import math

BOX = (-3000.0, 3000.0, -3500.0, 12000.0)   # x0, x1, y0, y1
HERO_MESHES = ("SM_gate_arch_gold", "SM_gate_pier", "SM_gate_leaf", "SM_gate_finial_heart", "SM_gate_finial_ball",
               "SM_heart_topiary", "SM_mushroom_giant", "SM_mushroom_landmark", "SM_mushroom_medium", "SM_floral_arch",
               "SM_floral_arch_trellis", "SM_garden_arch_stone", "SM_fountain_grand", "SM_fountain_basin", "SM_clock_grand",
               "SM_clock_ornate", "SM_flower_bed_base_0", "SM_flower_bed_blooms_0", "SM_rose_bush", "SM_lavender_stems",
               "SM_topiary_spiral", "SM_topiary_cone_roses", "SM_topiary_ball", "SM_key_ornate", "SM_key_colossal",
               "SM_balustrade", "SM_planter_box", "SM_garden_urn", "SM_lantern_swag", "SM_waymarker_lamp", "SM_tea_heart")


def mesh_name(path):
    return path.split("/")[-1].split(".")[0] if path else ""


def job():
    yield 0.2
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    actors = eas.get_all_level_actors()
    x0, x1, y0, y1 = BOX
    corridor = []
    hero_uses = {m: [] for m in HERO_MESHES}
    mesh_bounds = {}
    for a in actors:
        if isinstance(a, unreal.StaticMeshActor):
            smc = a.static_mesh_component
            sm = smc.static_mesh if smc else None
            mp = sm.get_path_name() if sm else ""
            mn = mesh_name(mp)
            loc = a.get_actor_location()
            mats = [m.get_name() if m else None for m in smc.get_editor_property("override_materials")] if smc else []
            rec = {"label": a.get_actor_label(), "mesh": mn, "loc": [round(loc.x), round(loc.y), round(loc.z)],
                   "yaw": round(a.get_actor_rotation().yaw, 1), "scale": [round(v, 3) for v in a.get_actor_scale3d().to_tuple()],
                   "mats": mats, "folder": str(a.get_folder_path())}
            if x0 <= loc.x <= x1 and y0 <= loc.y <= y1:
                origin, extent = a.get_actor_bounds(False)
                rec["ext"] = [round(extent.x), round(extent.y), round(extent.z)]
                corridor.append(rec)
            if mn in hero_uses and len(hero_uses[mn]) < 12:
                hero_uses[mn].append(rec)
            if mn in HERO_MESHES and mn not in mesh_bounds and sm is not None:
                b = sm.get_bounds()
                mesh_bounds[mn] = {"origin": [round(v) for v in b.origin.to_tuple()], "extent": [round(v) for v in b.box_extent.to_tuple()],
                                   "materials": [s.material_interface.get_name() if s.material_interface else None for s in sm.static_materials]}
    batches = []
    for b in actors:
        if not isinstance(b, unreal.WonderlandInstancedBatch):
            continue
        mesh = b.get_editor_property("mesh")
        mn = mesh.get_name() if mesh else mesh_name(b.get_editor_property("mesh_path"))
        tr = list(b.get_editor_property("transforms"))
        tf = b.get_actor_transform()
        inside = 0
        sample = None
        for i in range(0, len(tr) - 8, 9):
            p = tf.transform_location(unreal.Vector(tr[i], tr[i + 1], tr[i + 2]))
            if x0 <= p.x <= x1 and y0 <= p.y <= y1:
                inside += 1
                if sample is None:
                    sample = [round(p.x), round(p.y), round(p.z), round(tr[i + 6], 2)]
        mat = b.get_editor_property("material")
        if inside:
            batches.append({"batch": str(b.get_editor_property("batch_name")), "mesh": mn, "material": mat.get_name() if mat else None,
                            "in_corridor": inside, "total": len(tr) // 9, "sample": sample, "collides": b.get_editor_property("collides")})
        if mn in hero_uses and len(hero_uses[mn]) < 12:
            hero_uses[mn].append({"batch": str(b.get_editor_property("batch_name")), "count": len(tr) // 9,
                                  "material": mat.get_name() if mat else None,
                                  "first": [round(v, 2) for v in tr[:9]] if tr else None})
        if mn in HERO_MESHES and mn not in mesh_bounds and mesh is not None:
            bb = mesh.get_bounds()
            mesh_bounds[mn] = {"origin": [round(v) for v in bb.origin.to_tuple()], "extent": [round(v) for v in bb.box_extent.to_tuple()],
                               "materials": [s.material_interface.get_name() if s.material_interface else None for s in mesh.static_materials]}
    corridor.sort(key=lambda r: (r["loc"][1], r["loc"][0]))
    batches.sort(key=lambda r: -r["in_corridor"])
    RESULT["corridor_actors"] = corridor
    RESULT["corridor_batches"] = batches
    RESULT["hero_uses"] = hero_uses
    RESULT["mesh_bounds"] = mesh_bounds
    RESULT["status"] = "done"
    emit("corridor actors", len(corridor), "batches", len(batches))
