# Editor job: check what the PROJECT AVATAR build actually produced, in the engine, against what it claimed.
#
# WHY. avatars_v2 measures the body offline and bakes a scale factor in; the contract then states a height to the
# centimetre. That is a claim about geometry the builder never re-read. This job spawns each BP_Avatar_* in the
# editor world, asks the ENGINE for its bounds and its component list, compares them with the canon's own numbers,
# and destroys it again. If the two disagree, the contract is wrong and the disagreement is the finding.
#
# It also takes a tag census of the authored world passes, because a pass that was regenerated but never
# re-applied looks exactly like a pass that is fine.
#
# NOTHING IS SAVED. Every actor it spawns is destroyed in a finally block.
# Globals: FORGE, OUT, TOLERANCE_CM.
import importlib
import json
import sys

FORGE = globals().get("FORGE", r"C:/dev/iwonder/wonderland-blender-forge/wonderland/v2")
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/avatar_verify.json")
TOLERANCE_CM = float(globals().get("TOLERANCE_CM", 2.0))
PASS_TAGS = ("WL_PASS_BC01", "WL_PASS_IC01", "WL_PASS_IC02", "WL_PASS_NC01", "WL_PASS_TR01",
             "WL_PASS_BR01", "WL_AUTHORED", "WL_AVATAR_REVIEW")


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    if FORGE not in sys.path:
        sys.path.insert(0, FORGE)
    import avatar_common, ten_tails_canon, cherubim_canon, seraph_canon   # noqa: E401
    for mod in (avatar_common, ten_tails_canon, cherubim_canon, seraph_canon):
        importlib.reload(mod)
    A = sys.modules["avatar_common"]
    mods = {"TenTails": sys.modules["ten_tails_canon"],
            "Cherubim": sys.modules["cherubim_canon"],
            "Seraph": sys.modules["seraph_canon"]}
    titles = {"small": "Small", "medium": "Medium", "large": "Large"}

    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    eal = unreal.EditorAssetLibrary
    rows, problems, spawned = [], [], []
    try:
        y = 200000.0                       # far from anything authored; these live for one frame each
        for family in sorted(mods):
            mod = mods[family]
            for stage in list(A.STAGES):
                path = "/Game/WonderlandV2/Characters/Avatars/%s/%s/BP_Avatar_%s_%s" % (
                    family, titles[stage], family, titles[stage])
                asset = eal.load_asset(path)
                if asset is None:
                    problems.append("missing blueprint: " + path)
                    continue
                cls = asset.generated_class() if hasattr(asset, "generated_class") else asset
                actor = eas.spawn_actor_from_class(cls, unreal.Vector(0.0, y, 0.0), unreal.Rotator())
                spawned.append(actor)
                y += 4000.0
                origin, extent = actor.get_actor_bounds(False)
                comps = actor.get_components_by_class(unreal.StaticMeshComponent)
                # get_actor_bounds came back LARGER than the geometry on every avatar -- and by the same
                # 256.0 cm on all three SMALL forms, which no real geometry would do. So measure the union of
                # the MESH ASSETS' own bounds instead: if that matches the canon, the actor-level number is
                # padding (a bounds floor, or a component that carries no geometry) and the assets are fine;
                # if it does not, the meshes really are bigger than they claim and culling distances and LOD
                # screen sizes are wrong along with them.
                #
                # Asked the mesh, not the component: StaticMeshComponent exposes no 'bounds' editor property in
                # 5.8 Python (that was this job's own crash), while StaticMesh.get_bounding_box() does, and the
                # asset's box in its own space is the honest thing to compare a canon part list against.
                clo = [float("inf")] * 3
                chi = [float("-inf")] * 3
                for c in comps:
                    sm = c.get_editor_property("static_mesh")
                    if sm is None:
                        continue
                    box = sm.get_bounding_box()
                    xf = c.get_world_transform()
                    bmin, bmax = box.min, box.max
                    for cx in (bmin.x, bmax.x):
                        for cy in (bmin.y, bmax.y):
                            for cz in (bmin.z, bmax.z):
                                w = xf.transform_location(unreal.Vector(cx, cy, cz))
                                for i, v in enumerate((w.x, w.y, w.z)):
                                    clo[i] = min(clo[i], v)
                                    chi[i] = max(chi[i], v)
                comp_height = (chi[2] - clo[2]) if chi[2] > clo[2] else 0.0
                scenes = actor.get_components_by_class(unreal.SceneComponent)
                no_mat = [c.get_name() for c in comps if c.get_material(0) is None]
                colliding = [c.get_name() for c in comps
                             if c.get_collision_enabled() != unreal.CollisionEnabled.NO_COLLISION]
                # the canon's own claim, recomputed here rather than trusted from the build report
                raw = mod.parts(stage)
                p = A.lift(raw, A.deck_offset(raw))
                lo, hi = A.extents(p)
                k = A.fit_scale(p, A.TARGET_METRES[stage])
                claim_h = (hi[1] - lo[1]) * k
                engine_h = extent.z * 2.0
                cap_r, cap_half, _cy = mod.collision_capsule(stage)
                row = {"family": family, "stage": stage,
                       "claimed_height_cm": round(claim_h, 1),
                       "engine_height_cm": round(engine_h, 1),
                       "component_union_height_cm": round(comp_height, 1),
                       "delta_cm": round(engine_h - claim_h, 1),
                       "target_cm": A.TARGET_METRES[stage] * 100.0,
                       "engine_width_cm": round(extent.y * 2.0, 1),
                       "engine_depth_cm": round(extent.x * 2.0, 1),
                       "mesh_components": len(comps),
                       "scene_components": len(scenes),
                       "components_without_material": no_mat[:6],
                       "components_that_collide": colliding[:6],
                       "capsule_cm": [round(cap_r * k, 1), round(cap_half * k, 1)]}
                rows.append(row)
                if abs(comp_height - claim_h) > TOLERANCE_CM:
                    problems.append("%s/%s MESH height: components %.1f vs claimed %.1f cm"
                                    % (family, stage, comp_height, claim_h))
                elif abs(engine_h - claim_h) > TOLERANCE_CM:
                    problems.append("%s/%s actor bounds %.1f exceed the geometry %.1f cm (padding, not geometry)"
                                    % (family, stage, engine_h, comp_height))
                if abs(claim_h - A.TARGET_METRES[stage] * 100.0) > TOLERANCE_CM:
                    problems.append("%s/%s off target: %.1f vs %.1f cm"
                                    % (family, stage, claim_h, A.TARGET_METRES[stage] * 100.0))
                if no_mat:
                    problems.append("%s/%s has %d components with no material" % (family, stage, len(no_mat)))
                if colliding:
                    problems.append("%s/%s has %d components that collide" % (family, stage, len(colliding)))
                yield 0.2
    finally:
        for a in spawned:
            try:
                eas.destroy_actor(a)
            except Exception:
                pass

    census = dict.fromkeys(PASS_TAGS, 0)
    for a in eas.get_all_level_actors():
        for t in a.tags:
            name = str(t)
            if name in census:
                census[name] += 1
    dirty = [p for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    out = {"avatars": rows, "problems": problems, "pass_census": census,
           "dirty_map_packages": [p.get_name() for p in dirty]}
    with open(OUT, "w", newline="\n") as f:
        json.dump(out, f, indent=1)
    RESULT["checked"] = len(rows)
    RESULT["problems"] = problems[:12]
    RESULT["pass_census"] = census
    RESULT["dirty_map_packages"] = out["dirty_map_packages"]
    RESULT["status"] = "done"
