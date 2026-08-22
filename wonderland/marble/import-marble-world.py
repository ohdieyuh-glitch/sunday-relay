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


def choose_mesh(manifest, world_dir, allow_collider=False):
    """The best VISUAL mesh actually on disk, and say which one and why.

    hq_mesh is the 3,500-credit textured export. full_res_mesh is vertex-coloured
    and free. Preferring hq when present and naming the fallback out loud matters
    because the two look very different and a report that says "the Marble layer
    is in" without saying which mesh is describing two different worlds.
    """
    downloaded = (manifest.get("assets") or {}).get("downloaded") or {}
    # THE COLLIDER IS NOT A VISUAL LAYER, and this comment exists because I
    # argued both sides of that before measuring it.
    #
    # It does carry COLOR_0, so "untextured grey hull" was wrong. But the
    # geometry is what decides, and the geometry is: 69,305 triangles over
    # 35,494 m^2 of surface — **1.95 triangles per square metre**, median edge
    # 1.25 m, longest 2.1 m. A detailed game environment runs 100+ per m^2. A
    # 1.25-metre triangle cannot represent a gate finial, a mushroom cap or a
    # roof tile; at any distance a player would stand at, it is a coloured blur.
    #
    # So it stays available and stops being automatic. Silently substituting a
    # collision proxy for the Royal Garden would ship a blob and call it the
    # founder's reference.
    for key, why in (
            ("hq_mesh_url", "high-quality textured mesh (paid 3,500-credit export)"),
            ("full_res_mesh_url", "full-resolution vertex-coloured mesh (free)")):
        entry = downloaded.get(key)
        if not entry:
            continue
        path = os.path.join(world_dir, entry["path"])
        if os.path.exists(path):
            return path, key, why
    if allow_collider:
        entry = downloaded.get("collider_mesh_url")
        if entry:
            path = os.path.join(world_dir, entry["path"])
            if os.path.exists(path):
                return path, "collider_mesh_url", (
                    "COLLIDER PROXY standing in as scenery — 1.95 triangles per "
                    "m^2, median edge 1.25 m. Explicitly requested; it is not a "
                    "substitute for the HQ mesh and will not read as the reference.")
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


def static_meshes(paths):
    """The subset of an import's assets that can actually be placed.

    MEASURED ON THE BOX. `imported_object_paths` returns EVERYTHING the import
    created — for this GLB that is a Texture2D, a MaterialInstanceConstant and
    one StaticMesh — and the first version of this file tried to spawn an actor
    from each. UE answered "SpawnActorFromObject. No actor was spawned." for the
    texture, which is correct: a texture is not a placeable.
    """
    out = []
    for path in paths:
        asset = unreal.load_asset(path)
        if asset is None:
            log("could not load %s after import" % path)
            continue
        if isinstance(asset, unreal.StaticMesh):
            out.append((path, asset))
        else:
            log("not placeable, skipping: %s (%s)"
                % (path, type(asset).__name__))
    return out


def place(asset_path, mesh, location, rotation, scale, label, tags, visible=True):
    """Spawn one static-mesh actor with collision OFF."""
    # SPAWN FROM CLASS, THEN ASSIGN THE MESH. spawn_actor_from_object returned
    # None here for a StaticMesh that had loaded fine — and
    # generate-hub-level.py, which spawns tens of thousands of actors in this
    # exact commandlet, has always used spawn_actor_from_class. Use the path
    # that is proven in this context rather than the one that reads better.
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    actor = subsystem.spawn_actor_from_class(
        unreal.StaticMeshActor, unreal.Vector(*location), unreal.Rotator())
    if actor is None:
        log("spawn failed for %s" % asset_path)
        return None
    component = actor.get_component_by_class(unreal.StaticMeshComponent)
    if component is None:
        log("spawned actor has no StaticMeshComponent for %s" % asset_path)
        return None
    # MOVABLE before the mesh is assigned: a StaticMeshActor's component is
    # Static by default and refuses the change, which is the same trap that
    # rendered this world black once already.
    component.set_mobility(unreal.ComponentMobility.MOVABLE)
    component.set_static_mesh(mesh)
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

    # THE BOUNDARY, ENFORCED IN THE LEVEL. Marble geometry never blocks a Dog,
    # never carries navigation, and never decides where a player can stand.
    # Unreal's own geometry does all of that.
    component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    component.set_collision_profile_name("NoCollision")
    actor.set_actor_hidden_in_game(not visible)
    actor.tags = [unreal.Name(t) for t in tags]
    return actor


# The ratio band. Wide on purpose: it is not a placement check, it is a UNIT
# check, and the unit errors this project actually makes are factors of 100.
SCALE_BAND = (0.25, 4.0)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import placement as _placement
except Exception as _pexc:  # pragma: no cover - only if the file is missing
    _placement = None
    log("placement.py unavailable (%s) — the ORIENTATION gate will not run" % _pexc)


def check_orientation(centre_cm, transform, manifest, extent_cm=None):
    """Refuse a layer that came in FLIPPED, which no extent check can see.

    check_scale below compares SORTED extents on purpose, so that an axis swap
    is not misreported as a size error. The price of that is that it cannot see
    orientation at all, and a 180-degree flip changes no extent whatsoever. A
    flipped shell shipped exactly once that way: one actor placed, right size,
    level saved, clean cook, every gate green, and a kilometre of castle city
    hanging underneath the plaza.

    The signed quantity that does see it is where the geometry's bounding-box
    centre sits relative to the actor origin. This mesh's own accessor bounds
    run z = -0.94 .. +80.49 — it is overwhelmingly above its pivot, because the
    pivot is the reconstruction viewpoint standing on the floor. Land it upside
    down and that offset points down instead. The manifest already carries
    everything needed to predict it, so this costs nothing but a comparison.
    """
    if _placement is None:
        return
    try:
        predicted = _placement.predicted_centre_offset_cm(manifest)
    except Exception as exc:
        log("could not predict the centre offset (%s) — orientation NOT checked" % exc)
        return
    origin = [float(v) for v in transform.get("unreal_origin_cm", [0.0, 0.0, 0.0])]
    measured = [centre_cm[i] - origin[i] for i in range(3)]
    log("orientation check: centre offset measured %s cm vs predicted %s cm"
        % ([round(v) for v in measured], [round(v) for v in predicted]))
    # PER AXIS, AGAINST ITS OWN SIZE. This used to compare every axis against
    # 5% of the LARGEST one, and that is exactly how a mirrored axis got through:
    # Y disagreed by 2,227 cm, in sign, and 2,227 is under 5% of Z's 50,464. The
    # gate printed the disagreement on its own report line and then declined to
    # act on it.
    #
    # An axis is checkable when the prediction is far enough from zero that a
    # sign means something at all — judged against that axis's own extent, with
    # an absolute floor so a thin axis cannot make noise significant.
    wrong = []
    for i in range(3):
        p_i, m_i = predicted[i], measured[i]
        span = abs(extent_cm[i]) if extent_cm and i < len(extent_cm) else abs(p_i)
        floor = max(100.0, 0.01 * span)
        if abs(p_i) < floor or abs(m_i) < floor:
            continue
        if p_i * m_i < 0:
            wrong.append(i)
    if not wrong:
        return
    axis = "XYZ"
    raise SystemExit(
        "the imported layer is FLIPPED on %s. The geometry's centre should sit "
        "%s cm from the actor origin and it sits %s cm.\n"
        "This is the failure mode that has no symptom until a person looks at a "
        "frame on metered GPU time: every extent is identical either way, so the "
        "scale gate passes. Check transform.axis_correction_deg against the GLB's "
        "node rotation — R_x(+90) sends +Z to MINUS Y, so a node carrying it "
        "CREATES a Y-down convention rather than cancelling one, and the "
        "correction that undoes it is a 180-degree ROLL.\n"
        "The actors are in the level but the map has NOT been saved, so nothing "
        "was shipped."
        % ("".join(axis[i] for i in wrong),
           [round(v) for v in predicted], [round(v) for v in measured]))



def check_scale(measured, transform):
    """Refuse a backdrop that came in at the wrong ORDER OF MAGNITUDE.

    The trap: glTF counts metres and Unreal counts centimetres, and whether an
    importer has already applied that 100x before the actor's own scale is not
    something you can read off the documentation with confidence. Get it wrong
    and the shell is either a speck at the origin or a kilometre-wide wall
    through the plaza — and both cook, package and stream perfectly, so the
    first thing that notices is a person looking at a browser on metered GPU
    time. The manifest carries the expected extent computed from the mesh's own
    accessor bounds, so this can be settled here for free.
    """
    expected = transform.get("expected_unreal_extent_cm")
    if not expected:
        log("no expected_unreal_extent_cm in the manifest — the import scale was "
            "NOT checked. Add the mesh's measured span to get this gate.")
        return
    # SORTED, so the comparison is permutation-invariant. glTF is Y-up and
    # Unreal is Z-up, node transforms and the importer's own conversion can
    # land the three extents in a different ORDER than the accessor bounds were
    # read in, and an axis swap is not a size error. Comparing sorted extents
    # asks only the question this gate is for: is the thing the right size.
    ratios = [m / e for m, e in zip(sorted(measured), sorted(expected)) if e]
    if not ratios:
        return
    worst = max(ratios + [1.0 / r for r in ratios if r])
    log("scale check: measured %s cm vs expected %s cm (worst ratio %.3g)"
        % ([round(v) for v in measured], [round(v) for v in expected], worst))
    if not (SCALE_BAND[0] <= min(ratios) and max(ratios) <= SCALE_BAND[1]):
        raise SystemExit(
            "the imported layer is the wrong SIZE by a factor of about %.3g.\n"
            "  measured %s cm\n  expected %s cm\n"
            "Almost always the metre/centimetre conversion: if the ratio is near "
            "100, the importer already converted and transform.unreal_uniform_"
            "scale should not multiply by 100 again; if it is near 0.01, it did "
            "not. Fix the manifest rather than the frame — the actors are in the "
            "level but the map has NOT been saved, so nothing was shipped."
            % (worst, [round(v) for v in measured], [round(v) for v in expected]))


def default_level(manifest):
    return (manifest.get("unreal_destination") or {}).get(
        "level", "/Game/Wonderland/Maps/WonderlandHub")


def load_target_level(level_path):
    """Open the map the Marble layer is being ADDED TO, and refuse if it is not there.

    THIS IS THE STEP WHOSE ABSENCE MAKES THE WHOLE SCRIPT A LIE. Under
    `-run=pythonscript` the editor starts on an empty transient world. Importing
    assets into that succeeds, spawning actors into it succeeds, every log line
    reads like a success — and then the process exits and every actor is
    discarded, because they were never in WonderlandHub. The assets survive (the
    import task saves them), so afterwards the Content Browser shows the Marble
    mesh sitting there and the level does not contain it, which reads as a
    placement bug and gets debugged as one.

    So: load first, fail closed, and say which level.
    """
    subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if subsystem is None:
        raise SystemExit(
            "no LevelEditorSubsystem — cannot open %s, so anything imported "
            "would land in a transient world and be discarded at exit. "
            "Nothing was imported." % level_path)
    if not unreal.EditorAssetLibrary.does_asset_exist(level_path):
        raise SystemExit(
            "level %s does not exist. Generate the world first "
            "(generate-hub-level.py); the Marble layer is added to Wonderland, "
            "it does not create it. Nothing was imported." % level_path)
    if not subsystem.load_level(level_path):
        raise SystemExit(
            "load_level(%s) returned false. Refusing to import into whatever "
            "world happens to be open. Nothing was imported." % level_path)
    log("level opened: %s" % level_path)
    return subsystem


def save_target_level(subsystem, level_path):
    """Persist the map, and report the outcome as a fact rather than an assumption."""
    world = None
    try:
        world = unreal.get_editor_subsystem(
            unreal.UnrealEditorSubsystem).get_editor_world()
    except Exception as exc:
        log("could not reach the editor world (%s)" % exc)
    saved = False
    try:
        if world is not None:
            saved = unreal.EditorLoadingAndSavingUtils.save_map(world, level_path)
        else:
            saved = subsystem.save_current_level()
    except Exception as exc:
        log("save_map failed (%s); trying save_current_level()" % exc)
        try:
            saved = subsystem.save_current_level()
        except Exception as exc2:
            log("save_current_level also failed: %s" % exc2)
    log("MARBLE_LEVEL_SAVED=%d  (%s)" % (1 if saved else 0, level_path))
    return bool(saved)


def read_two_sided(material):
    """True / False / None. None means NOT KNOWN, and it is never False.

    MEASURED. The first version called get_editor_property("two_sided") and got
    "Failed to find property 'two_sided' ... on 'MaterialInstanceConstant'". A
    glTF import produces a material INSTANCE, and an instance does not carry
    two_sided directly — it carries base_property_overrides, and only when the
    matching override flag is on. When it is off the value is INHERITED and the
    honest answer comes from the parent.

    The reason this matters more than the API detail: the old code turned an
    unreadable property into "single-sided" and printed EVERY MARBLE MATERIAL IS
    SINGLE-SIDED, which is a claim about the asset made from a failure to look
    at it.
    """
    try:
        return bool(material.get_editor_property("two_sided"))
    except Exception:
        pass
    try:
        overrides = material.get_editor_property("base_property_overrides")
        if bool(overrides.get_editor_property("override_two_sided")):
            return bool(overrides.get_editor_property("two_sided"))
    except Exception:
        return None
    # Not overridden: inherited from the parent, so ask the parent.
    try:
        parent = material.get_editor_property("parent")
        if parent is not None:
            return read_two_sided(parent)
    except Exception:
        pass
    return None


def set_two_sided(material):
    """Turn two-sidedness on, handling an instance's override struct."""
    try:
        material.set_editor_property("two_sided", True)
        unreal.EditorAssetLibrary.save_loaded_asset(material)
        return True
    except Exception:
        pass
    overrides = material.get_editor_property("base_property_overrides")
    overrides.set_editor_property("override_two_sided", True)
    overrides.set_editor_property("two_sided", True)
    material.set_editor_property("base_property_overrides", overrides)
    unreal.EditorAssetLibrary.save_loaded_asset(material)
    return True


def apply_unlit_gain(material, gain):
    """Multiply the unlit base colour so the backdrop sits in the LIT world's range.

    THE PROBLEM THIS SOLVES, measured on the L4 2026-08-22. The shell is placed
    correctly, oriented correctly, is double-sided and is genuinely unlit -- and
    renders near-black in a streamed frame. Three captures located it:

        ShowFlag.PostProcessing 0   the castle city is RIGHT THERE, and the
                                    authored world blows out to white
        ShowFlag.EyeAdaptation 0    everything blows out; Marble washes to grey
        (default)                   authored world correct, Marble dark navy

    So it is neither occluded nor missing. Marble's texture is an already-
    exposed photograph, roughly 0..1, while the authored world is lit with
    values far above that. Auto-exposure can satisfy one scale or the other and
    it satisfies the world, which is most of the frame. Nothing is broken; two
    things are simply measured in different units.

    BaseColorFactor is the lever, and it is the engine's own: a vector parameter
    on /InterchangeAssets/gltf/M_Unlit, which the imported instance parents to.
    Asked for by name rather than assumed -- probe-marble-material.py lists it.

    A gain of 1.0 changes nothing, and that is the default, so a world whose
    manifest says nothing about this imports exactly as it did before.
    """
    if gain is None or abs(float(gain) - 1.0) < 1e-6:
        return None
    value = float(gain)
    lib = unreal.MaterialEditingLibrary
    try:
        # THE RETURN VALUE IS NOT THE ANSWER, and trusting it cost a build.
        # set_material_instance_vector_parameter_value returns False here while
        # setting the parameter perfectly well — readback after a False return
        # shows 6.0. Whatever that boolean means, it is not "did this work", so
        # the check is a READBACK: set it, read it, compare. An API contract
        # nobody has verified is a guess with a type signature.
        lib.set_material_instance_vector_parameter_value(
            material, "BaseColorFactor", unreal.LinearColor(value, value, value, 1.0))
    except Exception as exc:
        log("unlit gain %.3g could NOT be applied (%s). The backdrop keeps the "
            "brightness the exporter gave it." % (value, exc))
        return False
    try:
        back = lib.get_material_instance_vector_parameter_value(material, "BaseColorFactor")
        got = (back.r, back.g, back.b)
    except Exception as exc:
        log("unlit gain %.3g was written and could NOT be read back (%s). Read the "
            "frame as unverified brightness." % (value, exc))
        return False
    if max(abs(c - value) for c in got) > 1e-3:
        log("BaseColorFactor did not take: asked for %.4g, reads back %s. Nothing "
            "was faked — the backdrop keeps the brightness the exporter gave it."
            % (value, [round(c, 4) for c in got]))
        return False
    unreal.EditorAssetLibrary.save_loaded_asset(material)
    log("MARBLE_UNLIT_GAIN=%.4g applied to BaseColorFactor and read back as %.4g"
        % (value, got[0]))
    return True


def two_sided_report(meshes, want_two_sided, repair):
    """Answer the shell's one silent failure at IMPORT time, where it is free.

    A single-viewpoint reconstruction is a shell seen FROM THE INSIDE. If the
    material lands single-sided, every check upstream passes — the actor is
    placed, the size is right, the level saves, the cook is clean — and the
    frame is empty. Finding that out from a browser costs a GPU session.

    The source glTF for this world declares `doubleSided: true`, so restoring it
    is preserving what the file says, not overriding it.

    Returns (checked, two_sided, repaired, unknown).
    """
    checked = two_sided = repaired = unknown = 0
    for path, mesh in meshes:
        try:
            slots = mesh.get_editor_property("static_materials") or []
        except Exception as exc:
            log("could not read materials on %s (%s)" % (path, exc))
            unknown += 1
            continue
        for slot in slots:
            try:
                material = slot.get_editor_property("material_interface")
            except Exception:
                material = getattr(slot, "material_interface", None)
            if material is None:
                continue
            checked += 1
            state = read_two_sided(material)
            if state is True:
                two_sided += 1
                continue
            if state is None:
                unknown += 1
                log("two-sidedness of %s is UNKNOWN — the property could not be "
                    "read. That is not the same as single-sided and is not "
                    "reported as one." % material.get_name())
                continue
            log("%s imported SINGLE-SIDED while the source declares doubleSided"
                % material.get_name())
            if not (want_two_sided and repair):
                continue
            try:
                set_two_sided(material)
                repaired += 1
                two_sided += 1
                log("  restored two-sided on %s and saved it" % material.get_name())
            except Exception as exc:
                log("  COULD NOT restore two-sided (%s). The backdrop may be "
                    "invisible from inside; set Two Sided on the material by "
                    "hand before spending GPU time." % exc)
    log("MARBLE_MATERIALS_CHECKED=%d  MARBLE_TWO_SIDED=%d  "
        "MARBLE_TWO_SIDED_REPAIRED=%d  MARBLE_TWO_SIDED_UNKNOWN=%d"
        % (checked, two_sided, repaired, unknown))
    if checked and two_sided == 0 and unknown == 0:
        log("EVERY Marble material is single-sided. A shell viewed from inside "
            "renders nothing. This import is placed correctly and will show an "
            "empty frame.")
    elif unknown:
        log("two-sidedness could not be established for %d material(s). The "
            "frame is the only remaining evidence — if the backdrop is missing, "
            "this is the first thing to check by hand." % unknown)
    return checked, two_sided, repaired, unknown


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    # NOT `required=True`, and the reason is the transport. Under
    # `-run=pythonscript` the arguments ride inside the -script= string, and
    # this project has no measurement showing that survives on UE 5.8. The
    # environment variable always survives, so it is the belt and --slug is the
    # braces; whichever supplied the value is logged.
    parser.add_argument("--slug", default=None)
    parser.add_argument("--root", default=None)
    parser.add_argument("--allow-collider-as-visual", action="store_true",
                        help="use the collision proxy as scenery when the world has "
                             "no mesh. 1.95 triangles per m2 — a coloured blur, not "
                             "the Royal Garden. Opt-in on purpose.")
    parser.add_argument("--no-nanite", action="store_true",
                        help="import as a normal static mesh")
    parser.add_argument("--no-two-sided-repair", action="store_true",
                        help="report single-sided Marble materials but do not fix "
                             "them. The default restores two-sidedness when the "
                             "source glTF declared it, because a shell viewed from "
                             "inside renders nothing without it.")
    parser.add_argument("--level", default=None,
                        help="the map to add the Marble layer to. Defaults to the "
                             "manifest's recorded level.")
    parser.add_argument("--no-save", action="store_true",
                        help="import and place but do not save the map. For "
                             "inspecting a placement by hand; a build that uses "
                             "this ships a level without the Marble layer in it.")
    parser.add_argument("--import-collider", action="store_true", default=True,
                        help="also import Marble's collider mesh as a hidden reference")
    # Deliberately long and ugly. Promoting Marble geometry to gameplay
    # collision is a decision with consequences for every Dog in the world, and
    # it should be impossible to do by accident or by habit.
    parser.add_argument("--promote-marble-collision-i-have-evidence",
                        action="store_true",
                        help=argparse.SUPPRESS)
    args = parser.parse_args(argv if argv is not None else _script_args())
    if args.slug:
        log("slug %s (from --slug)" % args.slug)
    else:
        args.slug = os.environ.get("WONDERLAND_MARBLE_SLUG") or None
        if not args.slug:
            raise SystemExit(
                "no world to import: pass --slug or set WONDERLAND_MARBLE_SLUG. "
                "Nothing was imported.")
        log("slug %s (from WONDERLAND_MARBLE_SLUG — the -script= arguments did "
            "not reach argparse)" % args.slug)
    if not args.root:
        args.root = os.environ.get("WONDERLAND_MARBLE_ROOT") or None

    manifest, manifest_path = read_manifest(args.slug, args.root)
    world_dir = os.path.dirname(manifest_path)

    if unreal is None:
        raise SystemExit(
            "this runs inside the Unreal editor (-run=pythonscript). Outside it "
            "there is no importer, and pretending otherwise would report a "
            "success that never happened.")

    level_path = args.level or default_level(manifest)
    level_subsystem = load_target_level(level_path)

    destination = (manifest.get("unreal_destination") or {}).get(
        "content_path") or ("/Game/Wonderland/Marble/%s" % args.slug)
    transform = manifest.get("transform") or {}
    # BACKDROP SCALE. A single-viewpoint shell at native scale tolerates 1.7 m
    # of player movement before its nearest tenth smears — measured, not
    # guessed. Parallax error falls linearly with distance and the imagery
    # subtends the same angle, so scaling the shell up and pushing it out costs
    # nothing visually from the arrival point and buys proportional roam. x6
    # gives ~10 m, which is a plaza a player can actually walk around.
    #
    # This is why the field exists rather than a bare unreal_uniform_scale: the
    # honest scale for a backdrop is NOT the world's metric scale.
    mode = transform.get("placement_mode")
    scale = None
    if (mode == "backdrop_at_camera"
            and transform.get("unreal_backdrop_scale")):
        scale = transform["unreal_backdrop_scale"]
        policy = transform.get("backdrop_policy") or {}
        log("BACKDROP SCALE %.1f (x%s of the world's metric scale). Player roam "
            "radius about %s m at a %s-degree tolerance; authored geometry owns "
            "everything inside it and provides all ground."
            % (scale, transform.get("backdrop_scale_multiplier"),
               policy.get("recommended_roam_radius_m"), policy.get("tolerance_deg")))
    if scale is None:
        scale = transform.get("unreal_uniform_scale")
    if not scale:
        # Marble reports metres; Unreal counts centimetres. With no reported
        # scale factor the honest default is the unit conversion alone, said
        # out loud, rather than a guess dressed as a measurement.
        scale = 100.0
        log("no metric_scale_factor in the manifest — using the bare metre->cm "
            "conversion of 100.0. The layer may be the wrong size; check it.")
    origin = transform.get("unreal_origin_cm") or [0.0, 0.0, 0.0]
    rotation = list(transform.get("unreal_rotation_deg") or [0.0, 0.0, 0.0])
    # THE AXIS CORRECTION IS NOT OPTIONAL AND IT IS NOT COSMETIC.
    #
    # Marble's collider export is Y-DOWN; UE's glTF import assumes Y-UP and
    # converts on that basis. Without the correction the world arrives INVERTED
    # — sky below, plaza overhead — which reads as a lighting or a normals
    # failure and gets debugged as one, on a paid GPU. It is applied here, from
    # a measured value in the manifest, rather than left for someone to notice.
    correction = transform.get("axis_correction_deg") or [0.0, 0.0, 0.0]
    if any(abs(v) > 1e-6 for v in correction):
        rotation = [rotation[i] + correction[i] for i in range(3)]
        log("axis correction applied: roll/pitch/yaw %s -> %s  (%s)"
            % (correction, rotation,
               (transform.get("axis_correction_why") or "").split(".")[0]))
    ground = transform.get("ground_plane_offset_m")
    if isinstance(ground, (int, float)):
        if mode == "backdrop_at_camera":
            # DELIBERATELY NOT APPLIED, and this is the whole reason the backdrop
            # lever is free. The mesh origin IS the reconstruction viewpoint, so
            # anchoring the actor origin at the camera makes every ray from that
            # camera identical no matter what uniform scale is applied — a point
            # at direction d and distance r moves to 6r in the same direction and
            # lands on the same pixel. Lifting the shell by its ground offset
            # translates it, which is NOT a scaling, and it is the one operation
            # that breaks that identity: the horizon slides and the reference
            # composition the shell was generated for stops matching.
            #
            # The shell's own ground ends up 6x further below the camera than
            # reality. That is correct and it is invisible, because Wonderland's
            # authored plaza owns every metre a player can stand on and occludes
            # the shell's near geometry (backdrop_policy.authored_ownership).
            log("ground plane offset %.3f m NOT applied: in backdrop_at_camera "
                "the origin is the reconstruction viewpoint and translating it "
                "would break the scale-invariance the backdrop depends on."
                % ground)
        else:
            # THE SIGN, DERIVED FROM THE DATA RATHER THAN GUESSED. A POSITIVE
            # ground_plane_offset_m means the ground plane lies that far BELOW
            # the mesh origin. Checked against this world: 1.2399 m over a
            # metric_scale_factor of 2.1145 is 0.586 raw units, the raw z range
            # is -0.941..80.492, so the ground sits at raw z = -0.586 with 0.355
            # units of skirt beneath it — a reconstruction viewpoint at eye
            # height above its own floor.
            #
            # To seat that floor on Wonderland's z=0 the mesh must be RAISED by
            # the offset. This subtracted it, pushing the layer further down and
            # doubling the error it was there to remove. It is latent — the only
            # world in the repo is a backdrop, and the backdrop branch returns
            # above without applying any offset — which is exactly why nothing
            # caught it.
            origin = [origin[0], origin[1], origin[2] + ground * 100.0]
            log("ground plane offset %.3f m: the floor is that far BELOW the "
                "mesh origin, so the layer is RAISED -> z origin %.1f cm"
                % (ground, origin[2]))

    source, key, why = choose_mesh(manifest, world_dir,
                                   allow_collider=args.allow_collider_as_visual)
    if not source:
        raise SystemExit(
            "no usable visual mesh for %r.\n"
            "This world may have shipped splats and a collider only — that is what "
            "the Royal Garden generation did. Options:\n"
            "  * export the HQ mesh (3,500 credits):\n"
            "      marble_cli.py export %s --asset-type mesh --format glb "
            "--confirm-credits 3500\n"
            "  * import the collision proxy anyway (free, 1.95 tri/m2, a blur):\n"
            "      --allow-collider-as-visual\n"
            "  * run `marble_cli.py fetch %s` if nothing has been downloaded yet.\n"
            "Nothing was imported." % (args.slug, args.slug, args.slug))
    log("visual mesh: %s (%s)" % (os.path.basename(source), why))
    if key == "collider_mesh_url":
        log("NOTE: this is the COLLISION PROXY standing in as scenery. Measured: "
            "1.95 triangles per m2, median edge 1.25 m. It is real geometry from "
            "the real generation and it is free, and it will not read as the "
            "founder's reference at any distance. The 3,500-credit HQ mesh "
            "export is what delivers that.")

    imported = import_glb(source, destination, "SM_Marble_%s" % args.slug,
                          enable_nanite=not args.no_nanite)
    placeable = static_meshes(imported)
    log("imported %d asset(s), %d of them placeable static mesh(es)"
        % (len(imported), len(placeable)))
    placed = []
    for path, mesh in placeable:
        actor = place(path, mesh, origin, rotation, scale,
                      "MarbleVisualLayer_%s" % args.slug,
                      [MARBLE_TAG, NO_COLLISION_TAG])
        if actor is not None:
            placed.append(actor)
    if mode == "backdrop_at_camera":
        log("placed as a BACKDROP anchored to %s at %s. This is a "
            "single-viewpoint shell — it is correct from that camera and smears "
            "if a player walks away from it. Not a walkable environment."
            % (transform.get("anchor_camera"), origin))
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
            if not os.path.exists(collider_source):
                # Said out loud. The manifest listing an asset and the file
                # being on disk are different facts — these live outside the
                # checkout and are linked in — and a step that quietly does
                # nothing is indistinguishable from one that worked.
                log("the manifest lists a collider mesh but %s is not on disk — "
                    "no reference imported" % collider_source)
            if os.path.exists(collider_source):
                collider_imported = import_glb(
                    collider_source, destination + "/Collision",
                    "SM_MarbleCollider_%s" % args.slug, enable_nanite=False)
                for path, mesh in static_meshes(collider_imported):
                    place(path, mesh, origin, rotation, scale,
                          "MarbleColliderReference_%s" % args.slug,
                          [MARBLE_TAG, REFERENCE_TAG], visible=False)
                log("collider mesh imported as a HIDDEN REFERENCE. It is not "
                    "collision. Unreal's own geometry remains the authority.")
        else:
            log("no collider mesh was downloaded for this world")

    two_sided_report(
        placeable,
        want_two_sided=bool((manifest.get("source_mesh") or {}).get("double_sided")),
        repair=not args.no_two_sided_repair)

    # Brightness, on the same pass as two-sidedness and for the same reason:
    # both are material facts that decide whether the backdrop is VISIBLE, and
    # both are free to settle here and expensive to settle from a frame.
    gain = transform.get("unlit_gain")
    if gain is None:
        log("MARBLE_UNLIT_GAIN=1 (none requested) — the backdrop keeps the "
            "brightness the exporter gave it")
    else:
        applied_any = False
        for _path, mesh in placeable:
            try:
                slots = mesh.get_editor_property("static_materials") or []
            except Exception:
                continue
            for slot in slots:
                # Same two-step the two-sided pass uses: the editor property
                # first, the attribute as a fallback. A MaterialSlot does not
                # always expose one of them.
                try:
                    material = slot.get_editor_property("material_interface")
                except Exception:
                    material = getattr(slot, "material_interface", None)
                if material is None:
                    continue
                if apply_unlit_gain(material, gain):
                    applied_any = True
        if not applied_any:
            log("MARBLE_UNLIT_GAIN_APPLIED=0 — the gain was asked for and did "
                "NOT take. Read the frame as unchanged brightness, not as a "
                "tuned one.")

    log("MARBLE_VISUAL_ACTORS=%d  MARBLE_COLLIDER_REFERENCES=%d"
        % (len(placed), len(collider_imported)))
    if not placed:
        raise SystemExit(
            "no Marble visual actor reached the level. The import reported %d "
            "asset(s); spawning or loading them failed. Reporting this as a "
            "success is how a build ships an empty backdrop. The map was not "
            "saved." % len(imported))

    # MEASURE, THEN GATE, THEN SAVE — in that order, so a layer that came in at
    # the wrong order of magnitude never reaches disk and never reaches a cook.
    bounds_block = None
    try:
        box = placed[0].get_actor_bounds(False)
        centre, extent = box[0], box[1]
        bounds_block = {
            "source": "measured in Unreal after import",
            "min_cm": [centre.x - extent.x, centre.y - extent.y, centre.z - extent.z],
            "max_cm": [centre.x + extent.x, centre.y + extent.y, centre.z + extent.z],
        }
        measured = [extent.x * 2, extent.y * 2, extent.z * 2]
        log("bounds %.0f x %.0f x %.0f cm" % tuple(measured))
        bounds_block["measured_extent_cm"] = [round(v, 1) for v in measured]
        bounds_block["measured_centre_cm"] = [round(centre.x, 1), round(centre.y, 1),
                                              round(centre.z, 1)]
        check_orientation([centre.x, centre.y, centre.z], transform, manifest, measured)
        check_scale(measured, transform)
    except Exception as exc:
        log("could not measure bounds (%s) — the scale gate did NOT run" % exc)

    if args.no_save:
        log("--no-save: the map was NOT written. The Marble actors exist only in "
            "this editor session and will be gone when it exits.")
        level_saved = False
    else:
        level_saved = save_target_level(level_subsystem, level_path)
        if not level_saved:
            raise SystemExit(
                "the Marble layer was imported and placed but %s could not be "
                "saved. A cook from here would package a world without it, so "
                "this is a failure and not a warning." % level_path)

    if args.promote_marble_collision_i_have_evidence:
        log("REFUSED: promoting Marble geometry to gameplay collision is not "
            "implemented, because no evidence has been recorded that a "
            "reconstructed mesh is suitable for it. Record the evidence first.")

    # Write back what actually happened, including the real bounds. A manifest
    # that describes the request rather than the result is how a layer ends up
    # a hundred times too small with a document swearing it is correct.
    manifest["unreal_destination"] = {
        "content_path": destination,
        "level": level_path,
        "level_saved": level_saved,
        "actor_label": "MarbleVisualLayer_%s" % args.slug,
        "imported_assets": imported,
        "collider_assets": collider_imported,
        "nanite_requested": not args.no_nanite,
    }
    # WRITE THE APPLIED SCALE TO ITS OWN FIELD. This used to overwrite
    # unreal_uniform_scale — the METRIC scale — with whatever was applied, so a
    # backdrop import silently replaced the metric figure with the backdrop one
    # and the next run's arithmetic started from the wrong number.
    manifest["transform"]["unreal_applied_scale"] = scale
    manifest["transform"]["unreal_origin_cm"] = origin
    if bounds_block is not None:
        manifest["bounds"] = bounds_block
    with io.open(manifest_path, "w", encoding="utf8") as handle:
        json.dump(manifest, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    log("manifest updated: %s" % manifest_path)
    return 0


def _script_args():
    """Arguments after the script name when run under -run=pythonscript."""
    argv = sys.argv[1:]
    return [a for a in argv if not a.lower().endswith(".py")]


if __name__ == "__main__":
    sys.exit(main())
