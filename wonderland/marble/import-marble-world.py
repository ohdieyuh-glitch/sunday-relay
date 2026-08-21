#!/usr/bin/env python3
"""Bring a generated Marble world into UE 5.8 as a VISUAL layer only.

    <UnrealEditor> Wonderland.uproject -run=pythonscript \
        -script="wonderland/marble/import-marble-world.py --slug royal-garden"

WHAT THIS IS ALLOWED TO DO

Import geometry, place it, and write down where it went. That is all. The
architectural boundary is not a preference here, it is the thing that keeps
Wonderland a game rather than a scan viewer:

    MARBLE  -> architecture, scenery, foliage, distant detail. Appearance.
    UNREAL  -> collision, navigation, Relay Dogs, Compound Agents, multiplayer,
               interactions, quests, GVE. Everything with consequences.

So every mesh imported here is placed with collision DISABLED, and the actor
carries a tag saying so. Marble's own collider mesh is imported too — it is
free and it expires from its signed URL — but it lands as a reference asset,
not as collision, because there is no evidence it is suitable for gameplay and
"no evidence" is the reason, not a placeholder for one.

Gaussian splats are downloaded by the pipeline and are NOT imported here. UE 5.8
has no native splat renderer and nothing in this repo has demonstrated one.
Importing them would mean shipping a dependency nobody has measured.

WHAT IT DELIBERATELY DOES NOT DO

It does not delete anything. The existing generated world — gameplay anchors,
portals, interaction loci, the Dogs, the navigable plaza — is untouched. The
Marble layer is ADDED, and the actors it adds are tagged so a later pass can
find every one of them without guessing at names.

VERIFIED VS GUARDED. `unreal.AssetImportTask` and `AssetToolsHelpers` are the
documented import path. The Interchange pipeline OPTIONS below are wrapped in
try/except and logged when they do not apply, because this file was written
without an engine to check them against and a silently-ignored import option is
exactly the failure this project keeps having. If an option does not exist, the
import still happens at engine defaults and says so.
"""
import argparse
import io
import json
import os
import sys

try:
    import unreal
except ImportError:                      # running outside the editor
    unreal = None

HERE = os.path.dirname(os.path.abspath(__file__))

MARBLE_TAG = "MarbleVisualLayer"
NO_COLLISION_TAG = "MarbleNoCollision"
REFERENCE_TAG = "MarbleColliderReference"


def log(message):
    if unreal is not None:
        # Warning level on purpose: Display is filtered out of the packaged and
        # commandlet logs, and an import nobody can audit afterwards is not a
        # pipeline step, it is a rumour.
        unreal.log_warning("[marble] %s" % message)
    else:
        sys.stdout.write("[marble] %s\n" % message)


def read_manifest(slug, root=None):
    root = root or os.path.join(HERE, "worlds")
    path = os.path.join(root, slug, "manifest.json")
    if not os.path.exists(path):
        raise SystemExit(
            "no manifest at %s — run marble_cli.py poll/fetch first. Nothing "
            "was imported." % path)
    with io.open(path, encoding="utf8") as handle:
        return json.load(handle), path


def choose_mesh(manifest, world_dir):
    """The best VISUAL mesh actually on disk, and say which one and why.

    hq_mesh is the 3,500-credit textured export. full_res_mesh is vertex-coloured
    and free. Preferring hq when present and naming the fallback out loud matters
    because the two look very different and a report that says "the Marble layer
    is in" without saying which mesh is describing two different worlds.
    """
    downloaded = (manifest.get("assets") or {}).get("downloaded") or {}
    # Best first. The last entry is the important one and it was nearly missed:
    # the Royal Garden generation came back with NEITHER mesh url, and the
    # collider.glb was written off as an untextured collision hull. It is not —
    # it carries COLOR_0 as a normalized ubyte VEC4, so it renders as a coloured
    # scene at 69k triangles. With no mesh on the world it is the only real
    # geometry available without paying 3,500 credits, and refusing to import it
    # would have meant reporting "Marble cannot reach Unreal for free" when it
    # can.
    for key, why in (
            ("hq_mesh_url", "high-quality textured mesh (paid 3,500-credit export)"),
            ("full_res_mesh_url", "full-resolution vertex-coloured mesh (free)"),
            ("collider_mesh_url", "COLLIDER mesh used as the visual layer — "
                                  "vertex-coloured, no textures, LOW FIDELITY. "
                                  "This world shipped no mesh url at all.")):
        entry = downloaded.get(key)
        if not entry:
            continue
        path = os.path.join(world_dir, entry["path"])
        if os.path.exists(path):
            return path, key, why
    return None, None, None


def import_glb(source, destination, label, enable_nanite):
    """One import task. Returns the imported asset paths."""
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", source)
    task.set_editor_property("destination_path", destination)
    task.set_editor_property("destination_name", label)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)

    # NANITE. A Marble mesh is dense, static, opaque and has no world-position
    # offset — the shape Nanite exists for, and the opposite of the engine
    # primitives the rest of this world is built from, where Nanite's per-mesh
    # overhead would be pure loss. Guarded: if the option is not on this
    # engine's pipeline the import proceeds without it and says so, rather than
    # leaving a caller believing Nanite is on.
    if enable_nanite:
        try:
            options = unreal.InterchangeGenericAssetsPipeline()
            mesh_pipeline = options.get_editor_property("mesh_pipeline")
            mesh_pipeline.set_editor_property("build_nanite", True)
            task.set_editor_property("options", options)
            log("nanite requested via InterchangeGenericAssetsPipeline")
        except Exception as exc:
            log("NANITE NOT APPLIED (%s) — importing at engine defaults. The "
                "mesh will be a normal static mesh; enable Nanite on the asset "
                "by hand or in a later pass." % exc)

    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    imported = list(task.get_editor_property("imported_object_paths") or [])
    if not imported:
        log("IMPORT PRODUCED NOTHING for %s. This is a failure, not an empty "
            "world." % source)
    return imported


def place(asset_path, location, rotation, scale, label, tags, visible=True):
    """Spawn one static-mesh actor with collision OFF."""
    mesh = unreal.load_asset(asset_path)
    if mesh is None:
        log("could not load %s after import" % asset_path)
        return None
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    actor = subsystem.spawn_actor_from_object(
        mesh, unreal.Vector(*location), unreal.Rotator())
    if actor is None:
        log("spawn failed for %s" % asset_path)
        return None
    actor.set_actor_label(label)
    actor.set_actor_scale3d(unreal.Vector(scale, scale, scale))
    rot = unreal.Rotator()
    # Named fields, never the positional constructor: unreal.Rotator(*tuple)
    # mis-maps pitch and yaw, and this project has already aimed a hero camera
    # at the sky that way.
    rot.set_editor_property("roll", float(rotation[0]))
    rot.set_editor_property("pitch", float(rotation[1]))
    rot.set_editor_property("yaw", float(rotation[2]))
    actor.set_actor_rotation(rot, False)

    component = actor.get_component_by_class(unreal.StaticMeshComponent)
    if component is not None:
        # THE BOUNDARY, ENFORCED IN THE LEVEL. Marble geometry never blocks a
        # Dog, never carries navigation, and never decides where a player can
        # stand. Unreal's own geometry does all of that.
        component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
        component.set_collision_profile_name("NoCollision")
    actor.set_actor_hidden_in_game(not visible)
    actor.tags = [unreal.Name(t) for t in tags]
    return actor


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--root", default=None)
    parser.add_argument("--no-nanite", action="store_true",
                        help="import as a normal static mesh")
    parser.add_argument("--import-collider", action="store_true", default=True,
                        help="also import Marble's collider mesh as a hidden reference")
    # Deliberately long and ugly. Promoting Marble geometry to gameplay
    # collision is a decision with consequences for every Dog in the world, and
    # it should be impossible to do by accident or by habit.
    parser.add_argument("--promote-marble-collision-i-have-evidence",
                        action="store_true",
                        help=argparse.SUPPRESS)
    args = parser.parse_args(argv if argv is not None else _script_args())

    manifest, manifest_path = read_manifest(args.slug, args.root)
    world_dir = os.path.dirname(manifest_path)

    if unreal is None:
        raise SystemExit(
            "this runs inside the Unreal editor (-run=pythonscript). Outside it "
            "there is no importer, and pretending otherwise would report a "
            "success that never happened.")

    destination = (manifest.get("unreal_destination") or {}).get(
        "content_path") or ("/Game/Wonderland/Marble/%s" % args.slug)
    transform = manifest.get("transform") or {}
    scale = transform.get("unreal_uniform_scale")
    if not scale:
        # Marble reports metres; Unreal counts centimetres. With no reported
        # scale factor the honest default is the unit conversion alone, said
        # out loud, rather than a guess dressed as a measurement.
        scale = 100.0
        log("no metric_scale_factor in the manifest — using the bare metre->cm "
            "conversion of 100.0. The layer may be the wrong size; check it.")
    origin = transform.get("unreal_origin_cm") or [0.0, 0.0, 0.0]
    rotation = transform.get("unreal_rotation_deg") or [0.0, 0.0, 0.0]
    ground = transform.get("ground_plane_offset_m")
    if isinstance(ground, (int, float)):
        # Marble reports where IT thinks the ground is. Lifting the layer by the
        # negative of that puts its floor on Wonderland's z=0 plaza instead of
        # wherever the generator happened to reconstruct it.
        origin = [origin[0], origin[1], origin[2] - ground * 100.0]
        log("ground plane offset %.3f m applied -> z origin %.1f cm"
            % (ground, origin[2]))

    source, key, why = choose_mesh(manifest, world_dir)
    if not source:
        raise SystemExit(
            "no mesh has been downloaded for %r. Run `marble_cli.py fetch %s` "
            "(free) first. Nothing was imported." % (args.slug, args.slug))
    log("visual mesh: %s (%s)" % (os.path.basename(source), why))
    if key == "collider_mesh_url":
        log("NOTE: this is the collider standing in as scenery. It is honest "
            "geometry from the real generation and it is free, but it has no "
            "textures. The 3,500-credit HQ mesh export is what replaces it.")

    imported = import_glb(source, destination, "SM_Marble_%s" % args.slug,
                          enable_nanite=not args.no_nanite)
    placed = []
    for path in imported:
        actor = place(path, origin, rotation, scale,
                      "MarbleVisualLayer_%s" % args.slug,
                      [MARBLE_TAG, NO_COLLISION_TAG])
        if actor is not None:
            placed.append(actor)
    log("placed %d visual actor(s) at scale %.2f" % (len(placed), scale))

    collider_imported = []
    # If the collider IS the visual layer there is nothing to import a second
    # time — a hidden duplicate of the same geometry costs memory and confuses
    # anyone reading the outliner.
    if args.import_collider and key != "collider_mesh_url":
        entry = ((manifest.get("assets") or {}).get("downloaded") or {}).get(
            "collider_mesh_url")
        if entry:
            collider_source = os.path.join(world_dir, entry["path"])
            if os.path.exists(collider_source):
                collider_imported = import_glb(
                    collider_source, destination + "/Collision",
                    "SM_MarbleCollider_%s" % args.slug, enable_nanite=False)
                for path in collider_imported:
                    place(path, origin, rotation, scale,
                          "MarbleColliderReference_%s" % args.slug,
                          [MARBLE_TAG, REFERENCE_TAG], visible=False)
                log("collider mesh imported as a HIDDEN REFERENCE. It is not "
                    "collision. Unreal's own geometry remains the authority.")
        else:
            log("no collider mesh was downloaded for this world")

    if args.promote_marble_collision_i_have_evidence:
        log("REFUSED: promoting Marble geometry to gameplay collision is not "
            "implemented, because no evidence has been recorded that a "
            "reconstructed mesh is suitable for it. Record the evidence first.")

    # Write back what actually happened, including the real bounds. A manifest
    # that describes the request rather than the result is how a layer ends up
    # a hundred times too small with a document swearing it is correct.
    manifest["unreal_destination"] = {
        "content_path": destination,
        "level": (manifest.get("unreal_destination") or {}).get(
            "level", "/Game/Wonderland/Maps/WonderlandHub"),
        "actor_label": "MarbleVisualLayer_%s" % args.slug,
        "imported_assets": imported,
        "collider_assets": collider_imported,
        "nanite_requested": not args.no_nanite,
    }
    manifest["transform"]["unreal_uniform_scale"] = scale
    manifest["transform"]["unreal_origin_cm"] = origin
    if placed:
        try:
            box = placed[0].get_actor_bounds(False)
            centre, extent = box[0], box[1]
            manifest["bounds"] = {
                "source": "measured in Unreal after import",
                "min_cm": [centre.x - extent.x, centre.y - extent.y, centre.z - extent.z],
                "max_cm": [centre.x + extent.x, centre.y + extent.y, centre.z + extent.z],
            }
            log("bounds %.0f x %.0f x %.0f cm"
                % (extent.x * 2, extent.y * 2, extent.z * 2))
        except Exception as exc:
            log("could not measure bounds: %s" % exc)
    with io.open(manifest_path, "w", encoding="utf8") as handle:
        json.dump(manifest, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    log("manifest updated: %s" % manifest_path)
    log("MARBLE_VISUAL_ACTORS=%d  MARBLE_COLLIDER_REFERENCES=%d"
        % (len(placed), len(collider_imported)))
    return 0


def _script_args():
    """Arguments after the script name when run under -run=pythonscript."""
    argv = sys.argv[1:]
    return [a for a in argv if not a.lower().endswith(".py")]


if __name__ == "__main__":
    sys.exit(main())
