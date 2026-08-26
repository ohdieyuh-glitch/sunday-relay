"""Structural validation of a V2 map, CPU only. WLV2_CHECK_MAP names it.

Prints one VALIDATE block: world partition object, actor counts by class,
production tag count, external actor packages on disk, umap size, the hero
camera, and five representative production actors with their mesh, material,
visibility and registration. Nothing is modified.
"""
import os
import unreal

MAP = os.environ.get("WLV2_CHECK_MAP", "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival")


def log(msg):
    unreal.log_warning("VALIDATE " + msg)


def main():
    util = unreal.EditorLoadingAndSavingUtils
    util.load_map("/Engine/Maps/Entry")
    w = util.load_map(MAP)
    world = unreal.EditorLevelLibrary.get_editor_world()
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    alls = actors.get_all_level_actors()
    log("map=%s world=%s actors=%d" % (MAP, world.get_name() if world else None, len(alls)))
    wp = None
    try:
        wp = world.get_world_settings().get_editor_property("world_partition")
    except Exception as exc:
        log("world_partition property unavailable (%s)" % exc)
    log("WORLD PARTITION OBJECT: %s" % ("YES " + wp.get_name() if wp is not None else "NO"))
    classes, prod, cams, ext_in_pkg = {}, 0, [], 0
    for a in alls:
        cn = a.get_class().get_name()
        classes[cn] = classes.get(cn, 0) + 1
        tags = [str(t) for t in (a.get_editor_property("tags") or [])]
        if "UNREAL_PRODUCTION" in tags:
            prod += 1
        if isinstance(a, unreal.CameraActor):
            cams.append((a.get_actor_label(), tags, a.get_actor_location(), a.get_actor_rotation()))
        try:
            if "__ExternalActors__" in a.get_outermost().get_name():
                ext_in_pkg += 1
        except Exception:
            pass
    log("classes: %s" % sorted(classes.items(), key=lambda kv: -kv[1])[:8])
    log("PRODUCTION TAG COUNT: %d | actors in external packages: %d | cameras: %d" % (prod, ext_in_pkg, len(cams)))
    for nm, tags, loc, r in cams:
        log("  camera %s tags=%s loc=%s rot=%s" % (nm, tags, loc, r))
    cdir = str(unreal.Paths.project_content_dir())
    name = MAP.rsplit("/", 1)[-1]
    umap = os.path.join(cdir, MAP.replace("/Game/", "").rsplit("/", 1)[0], name + ".umap")
    ext_dir = os.path.join(cdir, "__ExternalActors__", MAP.replace("/Game/", "").rsplit("/", 1)[0], name)
    n_ext = 0
    for _r, _d, files in os.walk(ext_dir):
        n_ext += sum(1 for f in files if f.endswith(".uasset"))
    log("ON DISK: umap %s = %d bytes | external actor packages under %s = %d"
        % (umap, os.path.getsize(umap) if os.path.isfile(umap) else -1, ext_dir, n_ext))
    shown = 0
    for a in alls:
        tags = [str(t) for t in (a.get_editor_property("tags") or [])]
        if "UNREAL_PRODUCTION" not in tags or shown >= 5:
            continue
        shown += 1
        try:
            comps = a.get_components_by_class(unreal.StaticMeshComponent)
            c = comps[0] if comps else None
            mesh = c.get_editor_property("static_mesh") if c else None
            mat = c.get_material(0) if c else None
            log("  actor %-22s %-22s loc=%s vis=%s reg=%s mesh=%s mat=%s"
                % (a.get_actor_label(), a.get_class().get_name(), a.get_actor_location(),
                   c.is_visible() if c else None, c.is_registered() if c else None,
                   mesh.get_name() if mesh else None, mat.get_name() if mat else None))
        except Exception as exc:
            log("  actor %s inspect failed (%s)" % (a.get_actor_label(), exc))
    log("SUMMARY map=%s wp=%s actors=%d production=%d cameras=%d external_packages=%d"
        % (name, "YES" if wp is not None else "NO", len(alls), prod, len(cams), n_ext))


main()
