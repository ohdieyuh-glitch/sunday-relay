# THE WORLD CENSUS: every placement in the EDITOR world, with a footprint, for area-based audits.
#
# WHY. "A camera shows what it points at; an audit shows where the world isn't" (the forge's emptiness lesson).
# Placement COUNTS mislead too. The 400-600 m ring holds ~1,473 placements per 200 m tile, which sounds dense,
# but most are grass and flower runs, and one road can hold them all while the rest of the tile is bare. An
# emptiness audit needs WHERE each thing stands and HOW MUCH ground it covers, for the whole world at once.
#
# WHY THE EDITOR WORLD AND NOT PIE. PIE at spawn is a streaming snapshot: zzV4 saw 7,220 StaticMeshActors
# where the fully resident world of 2026-09-25 held 16,803. With every World Partition region loaded in the
# editor (Core's zc_wp_regions, 2026-09-28: 21,543 level actors, every spatially-loaded descriptor live) the
# editor world IS the complete population. The job checks that claim instead of assuming it: it counts the
# World Partition actor descriptors, and anything described but not loaded is written out from its
# descriptor bounds and flagged, so a partial load shows up as a number rather than as empty ground.
#
# READ-ONLY. No PIE, no map change, no save. CONCURRENT because it only reads.
#
# OUTPUT: captures/zc/census/world_census.csv.gz, one row per placement:
#     kind, x, y, z, ex, ey, ez, yaw, mesh, owner
#   kind   SMA (StaticMeshActor), ISM (instance), UNLOADED (descriptor only), OTHER (any other actor)
#   e*     half-extent in cm, from the mesh's own bounds times the instance scale (not rotated)
#   owner  the actor label, so a batch can be traced back to its pass
# Coordinates are cm and rounded to the centimetre. SINK_UU trims (z ~ -100000) are kept; readers skip them.
CONCURRENT = True

import gzip
import math
import os
import time

OUT_DIR = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "census")
OUT = os.path.join(OUT_DIR, "world_census.csv.gz")
YIELD_EVERY = 4000


def job():
    t0 = time.time()
    RESULT["status"] = "running"
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    world = ues.get_editor_world()
    if world is None:
        RESULT["status"] = "void: no editor world"
        return
    os.makedirs(OUT_DIR, exist_ok=True)
    tmp = OUT + ".tmp"

    bounds_cache = {}

    def mesh_extent(mesh):
        """Half-extent of a static mesh at scale 1, cached per mesh."""
        if mesh is None:
            return None
        key = mesh.get_path_name()
        got = bounds_cache.get(key)
        if got is None:
            try:
                b = mesh.get_bounds()
                e = b.box_extent
                got = (float(e.x), float(e.y), float(e.z))
            except Exception:                                          # noqa: BLE001
                got = (0.0, 0.0, 0.0)
            bounds_cache[key] = got
        return got

    counts = {"SMA": 0, "ISM": 0, "UNLOADED": 0, "OTHER": 0}
    other_classes = {}
    per_mesh = {}
    loaded_names = set()
    n_rows = 0

    with gzip.open(tmp, "wt", encoding="utf-8", newline="") as out:
        out.write("kind,x,y,z,ex,ey,ez,yaw,mesh,owner\n")

        def row(kind, loc, ext, scale, yaw, mesh_name, owner):
            sx, sy, sz = (abs(scale.x), abs(scale.y), abs(scale.z)) if scale is not None else (1.0, 1.0, 1.0)
            ex, ey, ez = ext if ext is not None else (0.0, 0.0, 0.0)
            out.write("%s,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,%s,%s\n" % (
                kind, loc.x, loc.y, loc.z, ex * sx, ey * sy, ez * sz, yaw,
                mesh_name.replace(",", ";"), owner.replace(",", ";")))

        actors = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor)
        RESULT["actors_in_editor_world"] = len(actors)
        done_since_yield = 0
        for a in actors:
            try:
                loaded_names.add(a.get_name())
                label = a.get_actor_label()
            except Exception:                                          # noqa: BLE001
                continue
            wrote_any = False
            try:
                comps = a.get_components_by_class(unreal.StaticMeshComponent)
            except Exception:                                          # noqa: BLE001
                comps = []
            for comp in comps:
                try:
                    mesh = comp.static_mesh
                except Exception:                                      # noqa: BLE001
                    mesh = None
                if mesh is None:
                    continue
                ext = mesh_extent(mesh)
                mname = mesh.get_name()
                if isinstance(comp, unreal.InstancedStaticMeshComponent):
                    try:
                        count = int(comp.get_instance_count())
                    except Exception:                                  # noqa: BLE001
                        count = 0
                    for i in range(count):
                        try:
                            t = comp.get_instance_transform(i, world_space=True)
                        except Exception:                              # noqa: BLE001
                            break
                        row("ISM", t.translation, ext, t.scale3d, t.rotation.rotator().yaw, mname, label)
                        counts["ISM"] += 1
                        n_rows += 1
                        done_since_yield += 1
                        if done_since_yield >= YIELD_EVERY:
                            done_since_yield = 0
                            yield 0.0
                    per_mesh[mname] = per_mesh.get(mname, 0) + count
                else:
                    try:
                        t = comp.get_world_transform()
                    except Exception:                                  # noqa: BLE001
                        continue
                    row("SMA", t.translation, ext, t.scale3d, t.rotation.rotator().yaw, mname, label)
                    counts["SMA"] += 1
                    per_mesh[mname] = per_mesh.get(mname, 0) + 1
                    n_rows += 1
                wrote_any = True
            if not wrote_any:
                cls = a.get_class().get_name()
                other_classes[cls] = other_classes.get(cls, 0) + 1
                try:
                    row("OTHER", a.get_actor_location(), None, None, 0.0, cls, label)
                    counts["OTHER"] += 1
                    n_rows += 1
                except Exception:                                      # noqa: BLE001
                    pass
            done_since_yield += 1
            if done_since_yield >= YIELD_EVERY:
                done_since_yield = 0
                yield 0.0

        # ---- IS THE POPULATION COMPLETE? Every World Partition descriptor not matched by a loaded actor is
        # written from its descriptor bounds and counted, so a partial region load reads as UNLOADED rows.
        # The binding's return shape (array, or (bool, array)) is read rather than assumed; anything else is
        # recorded and the census still lands, because the loaded population is the part that matters most.
        descs = None
        try:
            got = unreal.WorldPartitionBlueprintLibrary.get_actor_descs()
            RESULT["descriptor_api_shape"] = type(got).__name__
            if isinstance(got, tuple):
                got = next((g for g in got if hasattr(g, "__len__") and not isinstance(g, str)), None)
            if got is not None and hasattr(got, "__len__") and not isinstance(got, (str, bool)):
                descs = got
        except Exception as exc:                                       # noqa: BLE001
            RESULT["descriptor_error"] = repr(exc)
        if descs is not None:
            RESULT["descriptors"] = len(descs)
            for d in descs:
                # Matched on the actor's OBJECT NAME, which FActorDesc carries as `Name` and which is unique
                # within the level -- a set lookup, because 21k descriptors against 21k actors by string
                # search would hold the game thread for minutes.
                try:
                    if str(d.get_editor_property("name")) in loaded_names:
                        continue
                except Exception:                                      # noqa: BLE001
                    continue
                try:
                    box = d.get_editor_property("bounds")
                    c = (box.min + box.max) * 0.5
                    e = (box.max - box.min) * 0.5
                    label = str(d.get_editor_property("label"))
                    cls = str(d.get_editor_property("native_class"))
                except Exception:                                      # noqa: BLE001
                    continue
                row("UNLOADED", c, (e.x, e.y, e.z), None, 0.0, cls, label)
                counts["UNLOADED"] += 1
                n_rows += 1

    os.replace(tmp, OUT)
    RESULT["rows"] = n_rows
    RESULT["counts"] = counts
    RESULT["other_classes_top"] = sorted(other_classes.items(), key=lambda kv: -kv[1])[:25]
    RESULT["meshes"] = len(per_mesh)
    RESULT["per_mesh_top"] = sorted(per_mesh.items(), key=lambda kv: -kv[1])[:40]
    RESULT["output"] = OUT
    RESULT["seconds_in_job"] = round(time.time() - t0, 1)
    # "census" alone means COMPLETE AND CHECKED. A census whose completeness could not be checked says so,
    # rather than reading as complete because nothing contradicted it.
    if descs is None:
        RESULT["status"] = "census: completeness UNCHECKED (descriptor API gave %s)" % RESULT.get(
            "descriptor_api_shape", "an error")
    elif counts["UNLOADED"]:
        RESULT["status"] = "census: %d UNLOADED actors (written from descriptor bounds)" % counts["UNLOADED"]
    else:
        RESULT["status"] = "census"
