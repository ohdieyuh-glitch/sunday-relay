# Wonderland — Hub level generator (data-driven). AUTHORED, NOT RUN.
#
# Reads the WORLD DESIGN DATA at wonderland/WorldDesign/hub-layout.json (Hub
# Design 3.0, schema wonderland-hub-layout.v2) and builds the level ENTIRELY from
# it. The DATA (composition, landmarks, zones, cameras, paths, water, VFX/audio,
# foliage) is separate from this generator IMPLEMENTATION, so artists swap the
# data — and later real assets — without rewriting systems. There is NO hardcoded
# coordinate below: every position, scale, camera and tag is read from the JSON.
#
# Runs on the UE 5.8 build host inside the Editor:
#   UnrealEditor-Cmd Wonderland.uproject -run=pythonscript \
#     -script="wonderland/infra/build/generate-hub-level.py"
#
# MILESTONE 1 (a real frame to stream): every element uses an engine BasicShape
# placeholder, mapped by its `mesh` name below. MILESTONE 2 swaps those for real
# Nanite art in-Editor per docs/relay/WONDERLAND_ASSET_MANIFEST.md and grades
# against docs/relay/WONDERLAND_VISUAL_ACCEPTANCE.md. Foliage/flower/mushroom
# CLUSTERS drop a single tagged locator each (where + how dense) rather than fake
# instances — the real scatter is M2 Editor foliage work.
#
# NOTHING HERE HAS EXECUTED. This box has no Unreal Engine; `import unreal`
# resolves only inside the Editor. The design of this file is documented in
# docs/relay/wonderland/HUB_DESIGN.md.

import json
import math
import os

try:
    import unreal  # resolves ONLY inside the UE 5.8 Editor
except ImportError:
    # Off-engine (this repo / CI): the module still imports, so its pure placement
    # logic and mesh mapping can be validated without an Editor. It builds NOTHING
    # here — the guard at the bottom only runs when `unreal` is real.
    unreal = None

HERE = os.path.dirname(os.path.abspath(__file__))
LAYOUT_PATH = os.path.normpath(os.path.join(HERE, "..", "..", "WorldDesign", "hub-layout.json"))

# M1 placeholder meshes, keyed by the design data's `mesh` field. M2 replaces the
# right-hand side with real assets (or the whole map with a Fab/Megascans lookup).
# Every `mesh` string that appears anywhere in hub-layout.json must have a key
# here; UNKNOWN_MESH is the visible fallback so a missing mapping is obvious in
# the viewport rather than silent.
UNKNOWN_MESH = "/Engine/BasicShapes/Cube"
PLACEHOLDER_MESH = {
    # Raw primitives the kitbash builders compose richer forms from.
    "cube": "/Engine/BasicShapes/Cube",
    "cylinder": "/Engine/BasicShapes/Cylinder",
    "cone": "/Engine/BasicShapes/Cone",
    "sphere": "/Engine/BasicShapes/Sphere",
    "plane": "/Engine/BasicShapes/Plane",
    "water_plane": "/Engine/BasicShapes/Plane",
    "gate": "/Engine/BasicShapes/Cube",
    "arch": "/Engine/BasicShapes/Cube",
    "sign": "/Engine/BasicShapes/Cube",
    "terrace": "/Engine/BasicShapes/Cube",
    "pergola": "/Engine/BasicShapes/Cube",
    "portrait": "/Engine/BasicShapes/Cube",
    "standing_stone": "/Engine/BasicShapes/Cube",
    "bench": "/Engine/BasicShapes/Cube",
    "topiary": "/Engine/BasicShapes/Cube",
    "tree": "/Engine/BasicShapes/Cylinder",
    "teacup": "/Engine/BasicShapes/Cylinder",
    "clock": "/Engine/BasicShapes/Cylinder",
    "pool_rim": "/Engine/BasicShapes/Cylinder",
    "island": "/Engine/BasicShapes/Cylinder",
    "mushroom": "/Engine/BasicShapes/Cone",
    "spire": "/Engine/BasicShapes/Cone",
    "brain": "/Engine/BasicShapes/Sphere",
    "teapot": "/Engine/BasicShapes/Sphere",
}


def vec(xyz):
    return unreal.Vector(float(xyz[0]), float(xyz[1]), float(xyz[2]))


def ground(xy, z=0.0):
    """A ground-plane point [x, y] (roaming polygons, nav bounds) as a Vector."""
    return unreal.Vector(float(xy[0]), float(xy[1]), float(z))


def look_at_rotation(location, target):
    """Pitch/Yaw (roll 0) so an actor at `location` faces `target`. Pure math —
    used to aim the hero framing cameras from their `lookAt` in the data."""
    dx = float(target[0]) - float(location[0])
    dy = float(target[1]) - float(location[1])
    dz = float(target[2]) - float(location[2])
    yaw = math.degrees(math.atan2(dy, dx))
    pitch = math.degrees(math.atan2(dz, math.hypot(dx, dy)))
    return (pitch, yaw, 0.0)


def rot3(pitch, yaw, roll=0.0):
    """Build an FRotator via NAMED fields. unreal.Rotator's POSITIONAL constructor
    order is ambiguous in UE 5.8 Python and silently mis-mapped pitch/yaw here — it
    aimed the arrival hero camera STRAIGHT UP (pitch 90, looking at empty sky) and,
    before it was fixed the same way, the sun at the sky. Every rotation in this
    generator now goes through here so (pitch, yaw, roll) lands exactly as intended."""
    r = unreal.Rotator()
    r.set_editor_property("pitch", float(pitch))
    r.set_editor_property("yaw", float(yaw))
    r.set_editor_property("roll", float(roll))
    return r


def scale_for_radius(radius_uu):
    """BasicShapes Plane/Cylinder are ~100 uu across at scale 1; convert a design
    radius into a placeholder scale so water/island discs read at roughly the
    intended footprint."""
    return max(0.1, (float(radius_uu) * 2.0) / 100.0)


def _snake(name):
    return "".join("_" + c.lower() if c.isupper() else c for c in name).lstrip("_")


def set_prop(actor, cpp_name, value):
    """Set a UPROPERTY by its C++ name, tolerating UE 5.8's Python name mapping.
    Tries the C++ name and snake_case variants (incl. the `b`-prefixed bool form);
    on total failure it warns and CONTINUES rather than aborting the whole build."""
    variants = [cpp_name, _snake(cpp_name), cpp_name.lower()]
    if cpp_name[:1] == "b" and cpp_name[1:2].isupper():
        variants.append(_snake(cpp_name[1:]))  # bRequiresControl -> requires_control
    for n in dict.fromkeys(variants):
        try:
            actor.set_editor_property(n, value)
            return True
        except Exception:
            continue
    try:
        who = actor.get_actor_label()
    except Exception:
        try:
            who = actor.get_name()
        except Exception:
            who = str(actor)
    unreal.log_warning("could not set '%s' on %s (tried %s)" % (cpp_name, who, variants))
    return False


# --- Material library -----------------------------------------------------
# ORIGINAL Wonderland palette authored as PBR material instances off one master
# (BaseColor/Metallic/Roughness/Emissive params). No external/ripped assets — every
# look is a tuned solid-PBR instance, cooked from /Game/Wonderland/Materials. This
# is what turns the engine checker graybox into a warm-gold, jewel-toned world.
# name -> (baseRGB, metallic, roughness, emissiveRGB, emissiveStrength)
MATERIAL_SPEC = {
    "gold":        ((1.00, 0.78, 0.34), 1.0, 0.26, (0, 0, 0), 0.0),
    "gold_glow":   ((1.00, 0.80, 0.38), 1.0, 0.24, (1.00, 0.70, 0.25), 1.7),
    "float_glow":  ((1.00, 0.80, 0.40), 1.0, 0.24, (1.00, 0.72, 0.28), 1.9),
    "cobble":      ((0.44, 0.37, 0.31), 0.0, 0.80, (0, 0, 0), 0.0),
    "cobble2":     ((0.50, 0.43, 0.35), 0.0, 0.82, (0, 0, 0), 0.0),
    "plaza":       ((0.47, 0.40, 0.32), 0.0, 0.76, (0, 0, 0), 0.0),
    "moss":        ((0.20, 0.40, 0.16), 0.0, 0.72, (0, 0, 0), 0.0),
    "ground":      ((0.17, 0.30, 0.14), 0.0, 0.86, (0, 0, 0), 0.0),
    "trunk":       ((0.30, 0.20, 0.13), 0.0, 0.78, (0, 0, 0), 0.0),
    "foliage":     ((0.16, 0.38, 0.17), 0.0, 0.72, (0, 0, 0), 0.0),
    "foliage_hi":  ((0.27, 0.52, 0.24), 0.0, 0.66, (0, 0, 0), 0.0),
    "rose":        ((0.82, 0.10, 0.22), 0.0, 0.42, (0.18, 0, 0.03), 0.4),
    "rose_pink":   ((0.96, 0.42, 0.62), 0.0, 0.40, (0.10, 0.0, 0.04), 0.3),
    "petal_pink":  ((0.94, 0.40, 0.66), 0.0, 0.38, (0, 0, 0), 0.0),
    "petal_violet":((0.60, 0.30, 0.90), 0.0, 0.40, (0.08, 0.02, 0.16), 0.3),
    "petal_air":   ((0.98, 0.62, 0.82), 0.0, 0.36, (0.10, 0.02, 0.06), 0.2),
    "mush_red":    ((0.82, 0.09, 0.12), 0.0, 0.28, (0.14, 0, 0), 0.3),
    "mush_white":  ((0.96, 0.94, 0.90), 0.0, 0.42, (0, 0, 0), 0.0),
    "mush_purple": ((0.56, 0.24, 0.76), 0.0, 0.30, (0.12, 0.02, 0.18), 0.3),
    "spire":       ((0.94, 0.90, 0.86), 0.0, 0.40, (0, 0, 0), 0.0),
    "spire_pink":  ((0.98, 0.74, 0.82), 0.0, 0.34, (0, 0, 0), 0.0),
    "spire_blue":  ((0.74, 0.82, 0.98), 0.0, 0.34, (0, 0, 0), 0.0),
    "spire_teal":  ((0.66, 0.92, 0.88), 0.0, 0.34, (0, 0, 0), 0.0),
    "porcelain":   ((0.96, 0.95, 0.93), 0.0, 0.10, (0, 0, 0), 0.0),
    "water":       ((0.06, 0.20, 0.34), 0.0, 0.06, (0, 0.02, 0.05), 0.1),
    "magic_cyan":  ((0.20, 0.85, 1.00), 0.0, 0.30, (0.20, 0.85, 1.00), 2.2),
    "magic_gold":  ((1.00, 0.82, 0.40), 0.0, 0.30, (1.00, 0.72, 0.28), 2.2),
    "arcane":      ((0.60, 0.30, 0.95), 0.0, 0.35, (0.58, 0.26, 1.00), 3.0),
    "crystal":     ((0.65, 0.40, 0.95), 0.1, 0.20, (0.40, 0.20, 0.80), 1.5),
    "dog_body":    ((0.92, 0.92, 0.90), 0.0, 0.30, (0, 0, 0), 0.0),
    "dog_visor":   ((0.02, 0.02, 0.03), 0.1, 0.12, (0, 0, 0), 0.0),
    "dog_eye":     ((1.00, 0.78, 0.25), 0.0, 0.30, (1.00, 0.72, 0.20), 2.6),
    "stone":       ((0.44, 0.42, 0.40), 0.0, 0.90, (0, 0, 0), 0.0),
    "dog_pink":    ((0.95, 0.62, 0.78), 0.0, 0.35, (0, 0, 0), 0.0),
    "dog_gray":    ((0.55, 0.57, 0.60), 0.0, 0.40, (0, 0, 0), 0.0),
    "dog_tan":     ((0.82, 0.66, 0.42), 0.0, 0.40, (0, 0, 0), 0.0),
    "dog_brown":   ((0.50, 0.33, 0.21), 0.0, 0.50, (0, 0, 0), 0.0),
    # --- horizon + skyline (visual pass 1) -------------------------------
    # The far meadow that closes the horizon. Soft lilac-green rather than
    # grass-green: at this distance the height fog tints toward the sky, and a
    # saturated green read as a hard band instead of receding.
    "meadow_far":  ((0.42, 0.52, 0.40), 0.0, 0.92, (0, 0, 0), 0.0),
    # Distant towers, deliberately pale and low-contrast so the skyline recedes
    # behind the hero landmarks instead of competing with them.
    "spire_far":   ((0.88, 0.86, 0.94), 0.0, 0.62, (0, 0, 0), 0.0),
    # Rose and pink rooflines — the reference's skyline is warm, not gold.
    "roof_rose":   ((0.85, 0.30, 0.42), 0.0, 0.44, (0.05, 0.0, 0.01), 0.15),
    "roof_pink":   ((0.96, 0.58, 0.70), 0.0, 0.42, (0, 0, 0), 0.0),
    # Gills under a mushroom cap: warm shadow, never black.
    "mush_gill":   ((0.80, 0.66, 0.58), 0.0, 0.70, (0, 0, 0), 0.0),
}


def build_niagara():
    """REAL Niagara, not emissive-sphere stand-ins. Headless Python cannot AUTHOR a
    Niagara graph (no NiagaraEditorLibrary, no emitter-add API — proven), but it CAN
    DUPLICATE a shipped engine system template into our content and place it. These
    are complete, cookable, sprite-rendering particle systems. Returns {name: asset}.
    """
    eal = unreal.EditorAssetLibrary
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    out = {}
    srcs = {
        # continuous upward sprite fountain -> rising arcane sparkles at the circle
        "NS_ArcaneFountain": "/Niagara/DefaultAssets/Templates/Systems/FountainLightweight",
        # radial burst reused for a periodic pop at magical foci
        "NS_Motes": "/Niagara/DefaultAssets/Templates/Systems/RadialBurst",
    }
    for name, src in srcs.items():
        try:
            dst = "/Game/Wonderland/VFX/" + name
            if eal.does_asset_exist(dst):
                eal.delete_asset(dst)  # refresh each run
            # Template systems live under /Niagara/... but are NOT in the asset
            # registry, so does_asset_exist(src) is False — load by PATH instead,
            # then duplicate the in-memory object with AssetTools (proven to work).
            src_obj = unreal.load_asset(src)
            if src_obj is None:
                unreal.log_warning("niagara source unloadable: %s" % src)
                continue
            nd = tools.duplicate_asset(name, "/Game/Wonderland/VFX", src_obj)
            if nd is not None:
                eal.save_asset(nd.get_path_name())
                out[name] = nd
        except Exception as e:
            unreal.log_warning("niagara dup %s skipped: %s" % (name, e))
    unreal.log("NIAGARA %d systems ready: %s" % (len(out), ",".join(out.keys())))
    return out


def build_audio():
    """Import our PROCEDURAL Wonderland audio (created by us with gen-audio.py — no
    third-party license) as SoundWaves and return {name: SoundWave}. Ambient loops are
    marked looping. WAVs live at /opt/wonderland/audio on the build host. Provenance:
    100% procedurally synthesised in-repo (noise/sine/envelope), CC0-equivalent."""
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    eal = unreal.EditorAssetLibrary
    out = {}
    loops = {"amb_wind", "amb_water", "amb_magic"}
    names = ["amb_wind", "amb_water", "amb_magic", "sfx_footstep", "sfx_gate", "sfx_verified", "sfx_error"]
    pending = []
    for nm in names:
        dst = "/Game/Wonderland/Audio/" + nm
        if eal.does_asset_exist(dst):
            out[nm] = eal.load_asset(dst)
            continue
        t = unreal.AssetImportTask()
        t.set_editor_property("filename", "/opt/wonderland/audio/%s.wav" % nm)
        t.set_editor_property("destination_path", "/Game/Wonderland/Audio")
        t.set_editor_property("destination_name", nm)
        t.set_editor_property("automated", True)
        t.set_editor_property("save", True)
        t.set_editor_property("replace_existing", True)
        pending.append((nm, dst, t))
    if pending:
        try:
            tools.import_asset_tasks([t for _, _, t in pending])
        except Exception as e:
            unreal.log_warning("audio import failed: %s" % e)
        for nm, dst, _ in pending:
            if eal.does_asset_exist(dst):
                out[nm] = eal.load_asset(dst)
    for nm in loops:
        sw = out.get(nm)
        if sw is not None:
            try:
                sw.set_editor_property("looping", True)
                eal.save_asset(sw.get_path_name())
            except Exception as _le:
                unreal.log_warning("audio loop flag on %s skipped: %s" % (nm, _le))
    unreal.log("AUDIO %d sounds ready: %s" % (len(out), ",".join(out.keys())))
    return out


def build_material_library():
    """Create (once) the master material + all palette instances, saved as cookable
    assets. Idempotent: re-runs reuse existing assets. Returns name -> instance."""
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    mel = unreal.MaterialEditingLibrary
    eal = unreal.EditorAssetLibrary
    pkg = "/Game/Wonderland/Materials"
    # Rebuild materials FRESH each run so master-graph edits (e.g. the noise nodes)
    # actually take effect — create_asset can't overwrite, so a stale cached master
    # would silently ignore new nodes. The cook recompiles shaders regardless.
    try:
        if eal.does_directory_exist(pkg):
            eal.delete_directory(pkg)
    except Exception as _e:
        unreal.log_warning("material rebuild wipe skipped: %s" % _e)
    master_path = pkg + "/M_WLMaster"
    if eal.does_asset_exist(master_path):
        master = eal.load_asset(master_path)
    else:
        master = tools.create_asset("M_WLMaster", pkg, unreal.Material, unreal.MaterialFactoryNew())

        def param(cls, name, y, val):
            e = mel.create_material_expression(master, cls, -600, y)
            e.set_editor_property("parameter_name", name)
            e.set_editor_property("default_value", val)
            return e

        bc = param(unreal.MaterialExpressionVectorParameter, "BaseColor", -200, unreal.LinearColor(0.8, 0.6, 0.3, 1))
        # Procedural world-space NOISE modulates base-colour brightness so every
        # surface has organic variation instead of dead-flat plastic — the single
        # biggest step away from a solid-colour graybox without external textures.
        try:
            noise = mel.create_material_expression(master, unreal.MaterialExpressionNoise, -460, -360)
            noise.set_editor_property("scale", 0.010)
            noise.set_editor_property("output_min", 0.80)
            noise.set_editor_property("output_max", 1.16)
            noise.set_editor_property("levels", 2)
            bcmul = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -300, -240)
            mel.connect_material_expressions(bc, "", bcmul, "A")
            mel.connect_material_expressions(noise, "", bcmul, "B")
            mel.connect_material_property(bcmul, "", unreal.MaterialProperty.MP_BASE_COLOR)
        except Exception as _e:
            unreal.log_warning("material noise skipped (%s); flat base colour" % _e)
            mel.connect_material_property(bc, "", unreal.MaterialProperty.MP_BASE_COLOR)
        mt = param(unreal.MaterialExpressionScalarParameter, "Metallic", 0, 0.0)
        mel.connect_material_property(mt, "", unreal.MaterialProperty.MP_METALLIC)
        rg = param(unreal.MaterialExpressionScalarParameter, "Roughness", 150, 0.6)
        # ROUGHNESS BREAKUP, minimally. A flat roughness scalar is half of why
        # these surfaces read as plastic: a real surface is duller where it is
        # worn and cleaner where it is not, and that variation is what makes a
        # highlight TRAVEL across a form instead of sitting on it.
        #
        # Deliberately two nodes. A previous attempt wired nine (clamp, constant,
        # add, vector-noise, normalize) in one go and compiled to a BROKEN master:
        # every instance fell back to default, the world went monochrome brown and
        # the Dog rendered the missing-material checkerboard. The noise emits its
        # multiplier range directly so no add/clamp is needed at all.
        _rough_wired = False
        try:
            rn = mel.create_material_expression(master, unreal.MaterialExpressionNoise, -820, 120)
            rn.set_editor_property("scale", 0.05)
            rn.set_editor_property("output_min", 0.72)
            rn.set_editor_property("output_max", 1.28)
            rn.set_editor_property("levels", 3)
            rmul = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -320, 150)
            mel.connect_material_expressions(rg, "", rmul, "A")
            mel.connect_material_expressions(rn, "", rmul, "B")
            mel.connect_material_property(rmul, "", unreal.MaterialProperty.MP_ROUGHNESS)
            _rough_wired = True
        except Exception as _e:
            unreal.log_warning("roughness breakup skipped (%s)" % _e)
        if not _rough_wired:
            mel.connect_material_property(rg, "", unreal.MaterialProperty.MP_ROUGHNESS)
        # PROCEDURAL NORMAL DETAIL. The master had no normal input at all, so
        # every surface was geometrically perfect — the strongest "prototype"
        # cue left after silhouette. A gradient vector-noise field perturbs the
        # shading normal so stone, bark and plaster catch the key light with
        # real micro-relief. No textures, so nothing to license or ship.
        #
        # Wired ALONE and last: an earlier attempt landed this together with a
        # clamp/constant roughness chain and took the whole master down with it.
        # If VectorNoise is unavailable on this engine build the except leaves
        # the graph exactly as it was.
        try:
            damp = param(unreal.MaterialExpressionScalarParameter, "DetailAmp", 560, 0.30)
            vn = mel.create_material_expression(master, unreal.MaterialExpressionVectorNoise, -820, 340)
            vscaled = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -600, 360)
            mel.connect_material_expressions(vn, "", vscaled, "A")
            mel.connect_material_expressions(damp, "", vscaled, "B")
            flat = mel.create_material_expression(master, unreal.MaterialExpressionConstant3Vector, -600, 470)
            flat.set_editor_property("constant", unreal.LinearColor(0.0, 0.0, 1.0, 1.0))
            nadd = mel.create_material_expression(master, unreal.MaterialExpressionAdd, -420, 400)
            mel.connect_material_expressions(flat, "", nadd, "A")
            mel.connect_material_expressions(vscaled, "", nadd, "B")
            nnorm = mel.create_material_expression(master, unreal.MaterialExpressionNormalize, -250, 400)
            mel.connect_material_expressions(nadd, "", nnorm, "")
            mel.connect_material_property(nnorm, "", unreal.MaterialProperty.MP_NORMAL)
            unreal.log("NORMAL DETAIL wired")
        except Exception as _e:
            unreal.log_warning("normal detail skipped (%s); flat shading normals" % _e)

        em = param(unreal.MaterialExpressionVectorParameter, "Emissive", 300, unreal.LinearColor(0, 0, 0, 1))
        es = param(unreal.MaterialExpressionScalarParameter, "EmissiveStrength", 450, 0.0)
        mul = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -300, 350)
        mel.connect_material_expressions(em, "", mul, "A")
        mel.connect_material_expressions(es, "", mul, "B")
        mel.connect_material_property(mul, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
        # BREATHING via World-Position-Offset: vertices pulse along their normal on a
        # Time->Sine wave, scaled by a per-instance BreatheAmp (default 0 = static).
        # The Dogs (and foliage) get amp>0 so they are ALIVE with no skeletal rig —
        # "Dogs must BREATHE; breathing is ambient life." Live motion, not a still.
        try:
            tnode = mel.create_material_expression(master, unreal.MaterialExpressionTime, -720, 720)
            spd = param(unreal.MaterialExpressionScalarParameter, "BreatheSpeed", 880, 1.6)
            tmul = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -540, 740)
            mel.connect_material_expressions(tnode, "", tmul, "A")
            mel.connect_material_expressions(spd, "", tmul, "B")
            sine = mel.create_material_expression(master, unreal.MaterialExpressionSine, -400, 740)
            mel.connect_material_expressions(tmul, "", sine, "")
            nrm = mel.create_material_expression(master, unreal.MaterialExpressionVertexNormalWS, -540, 860)
            amp = param(unreal.MaterialExpressionScalarParameter, "BreatheAmp", 1010, 0.0)
            b1 = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -240, 780)
            mel.connect_material_expressions(nrm, "", b1, "A")
            mel.connect_material_expressions(sine, "", b1, "B")
            b2 = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -110, 800)
            mel.connect_material_expressions(b1, "", b2, "A")
            mel.connect_material_expressions(amp, "", b2, "B")
            # A vertical BOB term added on top: float3(0,0,1) * sin(Time*BobSpeed) *
            # BobAmp, so floating props (magical keys) drift up and down. BobAmp is 0
            # by default, so only props opted-in move; the Dogs still only breathe.
            bspd = param(unreal.MaterialExpressionScalarParameter, "BobSpeed", 1120, 1.1)
            bmul = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -540, 1000)
            mel.connect_material_expressions(tnode, "", bmul, "A")
            mel.connect_material_expressions(bspd, "", bmul, "B")
            bsine = mel.create_material_expression(master, unreal.MaterialExpressionSine, -400, 1000)
            mel.connect_material_expressions(bmul, "", bsine, "")
            up = mel.create_material_expression(master, unreal.MaterialExpressionConstant3Vector, -540, 1120)
            up.set_editor_property("constant", unreal.LinearColor(0.0, 0.0, 1.0, 1.0))
            bamp = param(unreal.MaterialExpressionScalarParameter, "BobAmp", 1240, 0.0)
            bv1 = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -240, 1060)
            mel.connect_material_expressions(up, "", bv1, "A")
            mel.connect_material_expressions(bsine, "", bv1, "B")
            bv2 = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -110, 1080)
            mel.connect_material_expressions(bv1, "", bv2, "A")
            mel.connect_material_expressions(bamp, "", bv2, "B")
            wsum = mel.create_material_expression(master, unreal.MaterialExpressionAdd, 40, 900)
            mel.connect_material_expressions(b2, "", wsum, "A")
            mel.connect_material_expressions(bv2, "", wsum, "B")
            mel.connect_material_property(wsum, "", unreal.MaterialProperty.MP_WORLD_POSITION_OFFSET)
        except Exception as _e:
            unreal.log_warning("breathe WPO skipped: %s" % _e)
        mel.recompile_material(master)
        eal.save_asset(master.get_path_name())
    mats = {}
    for name, (rgb, met, rough, emi, es) in MATERIAL_SPEC.items():
        ipath = pkg + "/MI_" + name
        if eal.does_asset_exist(ipath):
            mats[name] = eal.load_asset(ipath)
            continue
        mi = tools.create_asset("MI_" + name, pkg, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        mel.set_material_instance_parent(mi, master)
        mel.set_material_instance_vector_parameter_value(mi, "BaseColor", unreal.LinearColor(rgb[0], rgb[1], rgb[2], 1))
        mel.set_material_instance_scalar_parameter_value(mi, "Metallic", met)
        mel.set_material_instance_scalar_parameter_value(mi, "Roughness", rough)
        mel.set_material_instance_vector_parameter_value(mi, "Emissive", unreal.LinearColor(emi[0], emi[1], emi[2], 1))
        mel.set_material_instance_scalar_parameter_value(mi, "EmissiveStrength", es)
        eal.save_asset(mi.get_path_name())
        mats[name] = mi
    # PER-SURFACE RELIEF. One global strength would make porcelain look
    # sandblasted and bark look shrink-wrapped.
    relief = {"porcelain": 0.04, "gold": 0.06, "gold_glow": 0.06, "dog_body": 0.05,
              "dog_visor": 0.03, "water": 0.02, "spire": 0.20, "spire_pink": 0.20,
              "spire_blue": 0.20, "spire_teal": 0.20, "spire_far": 0.10,
              "roof_rose": 0.16, "roof_pink": 0.16, "stone": 0.80, "meadow_far": 0.50,
              "trunk": 0.85, "foliage": 0.50, "foliage_hi": 0.50, "mush_red": 0.26,
              "mush_purple": 0.26, "mush_white": 0.30, "mush_gill": 0.40,
              "rose": 0.28, "rose_pink": 0.28, "petal_pink": 0.20, "petal_violet": 0.20}
    for _nm, _dv in relief.items():
        if _nm in mats:
            try:
                mel.set_material_instance_scalar_parameter_value(mats[_nm], "DetailAmp", _dv)
                eal.save_asset(mats[_nm].get_path_name())
            except Exception as _e:
                unreal.log_warning("relief on %s skipped: %s" % (_nm, _e))
    # Bring the Dogs alive (clear breathe) + a gentle foliage sway; everything else
    # keeps BreatheAmp 0 (static). Live motion in the stream, invisible in a still.
    breathe = {"dog_body": 6.5, "dog_pink": 6.0, "dog_gray": 6.0, "dog_tan": 6.0,
               "dog_brown": 6.0, "foliage": 3.0, "foliage_hi": 3.5, "petal_pink": 2.5,
               "petal_violet": 2.5, "rose_pink": 2.2, "rose": 2.0}
    for nm, ampv in breathe.items():
        if nm in mats:
            try:
                mel.set_material_instance_scalar_parameter_value(mats[nm], "BreatheAmp", ampv)
                eal.save_asset(mats[nm].get_path_name())
            except Exception as _e:
                unreal.log_warning("BreatheAmp on %s skipped: %s" % (nm, _e))
    # WORLD LIFE — things that DRIFT up/down on the Bob WPO: the magical keys, the
    # air's drifting petals, and the Project-Brain lobes (so the Brain slowly
    # "thinks"). Static gold accents (dog tags, gate keystone) keep BobAmp 0 and stay put.
    bob = {"float_glow": 24.0, "petal_air": 22.0, "magic_cyan": 16.0}
    for nm, amp in bob.items():
        if nm in mats:
            try:
                mel.set_material_instance_scalar_parameter_value(mats[nm], "BobAmp", float(amp))
                eal.save_asset(mats[nm].get_path_name())
            except Exception as _e:
                unreal.log_warning("BobAmp on %s skipped: %s" % (nm, _e))
    return mats


def build_input_assets():
    """Create the Enhanced Input assets the player pawn loads by path: IMC_Wonderland
    + IA_Move (Axis2D) + IA_Look (Axis2D), with WASD/arrows -> planar move and mouse
    -> look. This is the real fix for 'no input in the stream' — the pawn had a
    LoadObject fallback but the assets never existed. Cooked into /Game/Wonderland/Input."""
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    eal = unreal.EditorAssetLibrary
    pkg = "/Game/Wonderland/Input"
    try:
        if eal.does_directory_exist(pkg):
            eal.delete_directory(pkg)
    except Exception as _e:
        unreal.log_warning("input dir wipe skipped: %s" % _e)

    def mk_ia(name, vt):
        ia = tools.create_asset(name, pkg, unreal.InputAction, unreal.InputActionFactory())
        ia.set_editor_property("value_type", vt)
        eal.save_asset(ia.get_path_name())
        return ia

    ia_move = mk_ia("IA_Move", unreal.InputActionValueType.AXIS2D)
    ia_look = mk_ia("IA_Look", unreal.InputActionValueType.AXIS2D)
    imc = tools.create_asset("IMC_Wonderland", pkg, unreal.InputMappingContext, unreal.InputMappingContextFactory())

    def mod(cls):
        return unreal.new_object(cls, imc)

    def fkey(keyname):
        k = unreal.Key()
        k.set_editor_property("key_name", keyname)
        return k

    def km(action, keyname, mods):
        m = unreal.EnhancedActionKeyMapping()
        m.set_editor_property("action", action)
        m.set_editor_property("key", fkey(keyname))
        if mods:
            m.set_editor_property("modifiers", mods)
        return m

    # A bool key yields 1.0 on the X axis; SwizzleAxis (default YXZ) routes it to Y
    # (forward/back), Negate flips sign. Mouse2D feeds look directly.
    mappings = [
        km(ia_move, "W", [mod(unreal.InputModifierSwizzleAxis)]),
        km(ia_move, "S", [mod(unreal.InputModifierSwizzleAxis), mod(unreal.InputModifierNegate)]),
        km(ia_move, "A", [mod(unreal.InputModifierNegate)]),
        km(ia_move, "D", None),
        km(ia_move, "Up", [mod(unreal.InputModifierSwizzleAxis)]),
        km(ia_move, "Down", [mod(unreal.InputModifierSwizzleAxis), mod(unreal.InputModifierNegate)]),
        km(ia_move, "Left", [mod(unreal.InputModifierNegate)]),
        km(ia_move, "Right", None),
        km(ia_look, "Mouse2D", None),
    ]
    imc.set_editor_property("mappings", mappings)
    eal.save_asset(imc.get_path_name())
    unreal.log("INPUT assets built: IMC_Wonderland + IA_Move + IA_Look (%d mappings)" % len(mappings))


def mat_name_for(mesh_key, label):
    """Map a design element (by label/id + placeholder mesh) to a palette material."""
    l = (label or "").lower()
    rules = [
        ("golden_gate", "gold"), ("gate", "gold"), ("clock", "gold"),
        ("portrait", "gold"), ("standing", "gold"), ("pergola", "gold"), ("terrace", "gold"),
        ("framing_tree", "foliage"), ("tree", "foliage"), ("topiary", "foliage"), ("heart", "foliage"),
        ("mushroom_purple", "mush_purple"), ("mushroom", "mush_red"),
        ("spire", "spire"), ("castle", "spire"), ("island", "spire"), ("distant", "spire"),
        ("teacup", "porcelain"), ("teapot", "porcelain"), ("card", "porcelain"), ("sign", "porcelain"),
        ("brain", "magic_cyan"), ("rose", "rose"), ("arch", "rose"),
        ("bench", "trunk"), ("water", "water"), ("ground", "ground"),
    ]
    for key, name in rules:
        if key in l:
            return name
    if mesh_key in ("plane", "water_plane"):
        return "plaza"
    return "plaza"


def build(layout):
    level_editor = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    asset_lib = unreal.EditorAssetLibrary
    MATS = build_material_library()
    unreal.log("MATLIB %d materials ready" % len(MATS))
    # Enhanced Input is now built in C++ at runtime (WonderlandDogPawn) — no .uasset
    # authoring needed here (the Python factory API proved unreliable).

    def spawn(cls, location, rotation=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0), label=None):
        actor = actors.spawn_actor_from_class(cls, vec(location), rot3(rotation[0], rotation[1], rotation[2]))
        actor.set_actor_scale3d(vec(scale))
        if label:
            actor.set_actor_label(label)
        return actor

    def static_mesh(mesh_key, location, scale, label, rotation=(0.0, 0.0, 0.0), mat=None):
        path = PLACEHOLDER_MESH.get(mesh_key, UNKNOWN_MESH)
        if mesh_key not in PLACEHOLDER_MESH:
            unreal.log_warning("No placeholder mesh for '%s' (%s); using fallback." % (mesh_key, label))
        actor = spawn(unreal.StaticMeshActor, location, rotation=rotation, scale=scale, label=label)
        smc = actor.get_component_by_class(unreal.StaticMeshComponent)
        # MOVABLE so the mesh is fully dynamic: with r.AllowStaticLighting=False and
        # no baked lighting, a STATIC-mobility mesh has no lightmap AND is excluded
        # from some dynamic paths -> it renders BLACK. Movable meshes receive the
        # dynamic sun/fill/sky light every frame. This is THE fix for the black Hub.
        smc.set_mobility(unreal.ComponentMobility.MOVABLE)
        smc.set_static_mesh(asset_lib.load_asset(path))
        # Replace the engine checker with a palette material (by name or auto-mapped).
        m = MATS.get(mat) if isinstance(mat, str) else mat
        if m is None:
            m = MATS.get(mat_name_for(mesh_key, label))
        if m is not None:
            smc.set_material(0, m)
        return actor

    def marker(location, label, tags=(), rotation=(0.0, 0.0, 0.0)):
        """A tagged empty (TargetPoint) so gameplay code and the Relay<->Unreal
        intent bridge can bind to it by id/kind/intent. Placement only — a marker
        never carries behaviour."""
        a = spawn(unreal.TargetPoint, location, rotation=rotation, label=label)
        clean = [unreal.Name(t) for t in tags if t]
        if clean:
            a.set_editor_property("tags", clean)
        return a

    # --- Kitbash builders -------------------------------------------------
    # ORIGINAL Wonderland forms composed from BasicShape primitives (all ~100uu,
    # centered) + palette materials. No external/ripped assets. Sizes are in uu; a
    # part H tall sitting on ground z0 has scale_z=H/100 at centre z0+H/2.
    def _part(prim, cx, cy, cz, sx, sy, sz, mat, label, rot=(0.0, 0.0, 0.0)):
        return static_mesh(prim, [cx, cy, cz], [sx, sy, sz], label, rotation=rot, mat=mat)

    def kit_tree(x, y, s, label, giant=False):
        # The GREAT FRAMING TREE towers over the district (the reference's storybook
        # tree); ordinary trees stay modest. A tapered trunk with a knotted base and a
        # deep, layered crown so it reads as a real canopy, not a lollipop.
        th = 980.0 * s if giant else 240.0 * s
        tr = 82.0 * s if giant else 28.0 * s
        _part("cylinder", x, y, th * 0.5, tr / 50.0, tr / 50.0, th / 100.0, "trunk", "%s_trunk" % label)
        if giant:
            # flared roots + a couple of boughs reaching out under the crown
            for k in range(5):
                a = k * (2.0 * math.pi / 5.0)
                _part("cube", x + math.cos(a) * tr * 1.1, y + math.sin(a) * tr * 1.1, tr * 0.5,
                      0.7 * s, 0.4 * s, 0.7 * s, "trunk", "%s_root%d" % (label, k),
                      rot=(0.0, math.degrees(a), 24.0))
            for k, (bx, by, bz) in enumerate([(0.7, 0.2, 0.62), (-0.65, 0.3, 0.68), (0.2, -0.7, 0.58)]):
                _part("cylinder", x + bx * tr * 2.2, y + by * tr * 2.2, th * bz,
                      0.28 * s, 0.28 * s, 2.6 * s, "trunk", "%s_bough%d" % (label, k),
                      rot=(58.0, math.degrees(math.atan2(by, bx)), 0.0))
        cr = 440.0 * s if giant else 150.0 * s
        blobs = [(0, 0, 1.0, "foliage"), (0.55, 0.25, 0.82, "foliage_hi"), (-0.5, 0.35, 0.78, "foliage"),
                 (0.30, -0.5, 0.72, "foliage_hi"), (-0.35, -0.4, 0.68, "foliage"), (0.05, 0.15, 0.6, "foliage_hi"),
                 (0.62, -0.28, 0.66, "foliage"), (-0.6, -0.18, 0.62, "foliage_hi"), (0.0, 0.55, 0.7, "foliage"),
                 (0.28, 0.42, 0.56, "foliage_hi"), (-0.28, 0.02, 0.9, "foliage")]
        for i, (ox, oy, cs, mat) in enumerate(blobs):
            if not giant and i > 2:
                break
            d = 2.0 * cr * cs
            _part("sphere", x + ox * cr, y + oy * cr, th + cr * 0.30 + i * cr * 0.12,
                  d / 100.0, d / 100.0, d / 100.0, mat, "%s_canopy%d" % (label, i))

    def kit_mushroom(x, y, s, label, cap_mat):
        # A HERO AMANITA, not a lollipop. The reference's mushrooms carry whole
        # corners of the frame, so this builds the parts the eye actually reads:
        # a stem that swells at the base, a deep cap with a rolled rim, a gill
        # ring in shadow beneath it, and an irregular scatter of white flecks
        # (evenly-spaced dots look printed; these are placed on a drifting angle).
        sh, sr, cap = 150.0 * s, 24.0 * s, 92.0 * s
        _part("cylinder", x, y, sh * 0.52, sr / 50.0, sr / 50.0, sh / 100.0, "mush_white", "%s_stem" % label)
        # bulbous volva at the base
        _part("sphere", x, y, sr * 0.55, sr * 2.1 / 100.0, sr * 2.1 / 100.0, sr * 1.5 / 100.0,
              "mush_white", "%s_volva" % label)
        # skirt ring where the veil tore
        _part("cylinder", x, y, sh * 0.74, sr * 1.9 / 100.0, sr * 1.9 / 100.0, 0.06 * s,
              "mush_white", "%s_ring" % label)
        # gills: a darker disc tucked under the cap
        _part("cylinder", x, y, sh + cap * 0.02, cap * 1.62 / 100.0, cap * 1.62 / 100.0, 0.10 * s,
              "mush_gill" if "mush_gill" in MATS else "mush_white", "%s_gills" % label)
        # the cap itself, domed and slightly wider than tall
        _part("sphere", x, y, sh + cap * 0.24, cap * 2.05 / 100.0, cap * 2.05 / 100.0, cap * 1.30 / 100.0,
              cap_mat, "%s_cap" % label)
        # rolled rim so the silhouette is not a bare hemisphere
        _part("cylinder", x, y, sh + cap * 0.10, cap * 1.92 / 100.0, cap * 1.92 / 100.0, 0.16 * s,
              cap_mat, "%s_rim" % label)
        # white flecks, drifting so they never look stamped on
        import math as _m
        for i in range(11):
            a = i * 2.39996 + (x + y) * 0.01
            rr = (0.22 + 0.62 * ((i * 37) % 11) / 11.0)
            _part("sphere",
                  x + _m.cos(a) * cap * rr, y + _m.sin(a) * cap * rr,
                  sh + cap * 0.46 - (rr * rr) * cap * 0.20,
                  (0.20 - 0.07 * rr) * s, (0.20 - 0.07 * rr) * s, (0.11 - 0.03 * rr) * s,
                  "mush_white", "%s_dot%d" % (label, i))

    def kit_gate(x, y, s, label):
        # An ORNATE wrought-gold gate (the reference): two pillars with ball finials,
        # a grille of slender vertical bars between them, curling scrollwork, and a
        # glowing HEART crest over the keystone.
        ph = 540.0 * s
        for sx in (-1, 1):
            px = x + sx * 250.0 * s
            _part("cube", px, y, ph * 0.5, 0.95 * s, 0.95 * s, ph / 100.0, "gold", "%s_pillar%d" % (label, sx))
            _part("sphere", px, y, ph + 40.0 * s, 0.7 * s, 0.7 * s, 0.7 * s, "gold", "%s_ball%d" % (label, sx))
            _part("cone", px, y, ph + 95.0 * s, 0.7 * s, 0.7 * s, 1.5 * s, "gold_glow", "%s_finial%d" % (label, sx))
        # grille of slender vertical bars
        for b in range(-4, 5):
            _part("cube", x + b * 52.0 * s, y, ph * 0.46, 0.08 * s, 0.14 * s, ph * 0.9 / 100.0,
                  "gold", "%s_bar%d" % (label, b))
        # scrollwork curls along the top rail
        for b in range(-3, 4):
            _part("sphere", x + b * 74.0 * s, y, ph * 0.86, 0.28 * s, 0.16 * s, 0.28 * s,
                  "gold", "%s_curl%d" % (label, b))
        # GATE ACTIVATION — a glowing arcane veil across the portal, drifting gold
        # glyphs, and a warm threshold ring underfoot, so the Golden Build Gate reads
        # as an ACTIVE threshold into Building rather than an inert arch.
        _part("cube", x, y + 3.0 * s, ph * 0.46, 4.5 * s, 0.05 * s, ph * 0.84 / 100.0,
              "arcane", "%s_veil" % label)
        for k in range(-2, 3):
            _part("sphere", x + k * 92.0 * s, y - 10.0 * s, ph * (0.34 + 0.14 * (k % 2)),
                  0.16 * s, 0.16 * s, 0.16 * s, "float_glow", "%s_glyph%d" % (label, k))
        _part("cylinder", x, y, 5.0, 3.1 * s, 3.1 * s, 0.04, "magic_gold", "%s_threshold" % label)
        _part("cube", x, y, ph + 45.0 * s, 6.2 * s, 1.15 * s, 0.85 * s, "gold", "%s_beam" % label)
        # a glowing heart crest: two lobes + a point below the keystone
        for sx in (-1, 1):
            _part("sphere", x + sx * 44.0 * s, y, ph + 150.0 * s, 0.5 * s, 0.3 * s, 0.5 * s,
                  "rose", "%s_heartlobe%d" % (label, sx))
        _part("cube", x, y, ph + 108.0 * s, 0.62 * s, 0.3 * s, 0.62 * s, "rose", "%s_heartpt" % label,
              rot=(0.0, 0.0, 45.0))
        _part("cube", x, y, ph + 120.0 * s, 1.4 * s, 1.35 * s, 1.0 * s, "gold_glow", "%s_keystone" % label)

    def kit_spire(x, y, s, label, body_mat="spire", roof_mat="gold", flag=True):
        # A candy-castle turret: tall glossy tower, a mid tier, a tall conical roof,
        # a gold ball finial and (optionally) a little flag — the pink/white/blue
        # spired castles of the reference skyline.
        bh, br = 440.0 * s, 72.0 * s
        _part("cylinder", x, y, bh * 0.5, br / 50.0, br / 50.0, bh / 100.0, body_mat, "%s_body" % label)
        _part("cylinder", x, y, bh + 60.0 * s, br * 0.72 / 50.0, br * 0.72 / 50.0, 1.2 * s, body_mat, "%s_tier" % label)
        _part("cone", x, y, bh + 210.0 * s, 1.9 * s, 1.9 * s, 2.9 * s, roof_mat, "%s_roof" % label)
        _part("sphere", x, y, bh + 330.0 * s, 0.32 * s, 0.32 * s, 0.32 * s, "gold_glow", "%s_finial" % label)
        if flag:
            _part("cylinder", x, y, bh + 400.0 * s, 0.05 * s, 0.05 * s, 1.1 * s, "gold", "%s_pole" % label)
            _part("cube", x + 24.0 * s, y, bh + 470.0 * s, 0.02 * s, 0.42 * s, 0.28 * s, roof_mat, "%s_flag" % label)

    def kit_teacup(x, y, s, label):
        _part("cylinder", x, y, 8.0 * s, 2.4 * s, 2.4 * s, 0.16 * s, "porcelain", "%s_saucer" % label)
        _part("cylinder", x, y, 78.0 * s, 1.5 * s, 1.5 * s, 1.3 * s, "porcelain", "%s_body" % label)
        _part("cylinder", x, y, 140.0 * s, 1.72 * s, 1.72 * s, 0.12 * s, "gold", "%s_rim" % label)
        _part("cube", x + 88.0 * s, y, 80.0 * s, 0.22 * s, 0.5 * s, 0.62 * s, "porcelain", "%s_handle" % label)
        # painted red HEARTS around the cup (the reference's Queen-of-Hearts teacup)
        for k in range(4):
            a = k * (math.pi / 2.0) + 0.4
            hx, hy = x + math.cos(a) * 78.0 * s, y + math.sin(a) * 78.0 * s
            for sx in (-1, 1):
                _part("sphere", hx + sx * 12.0 * s, hy, 92.0 * s, 0.16 * s, 0.06 * s, 0.16 * s,
                      "rose", "%s_heart%d_%d" % (label, k, sx))

    def kit_heart_topiary(cx, cy, base_z, s, label):
        # A hedge trimmed into a HEART, studded with roses, on a short trunk — the
        # reference's rose-heart topiary. Built in an upright plane facing the plaza.
        _part("cylinder", cx, cy, base_z * 0.5, 0.5 * s, 0.5 * s, base_z / 100.0, "trunk", "%s_trunk" % label)
        n = 18
        for i in range(n):
            t = (i / float(n)) * 2.0 * math.pi
            hx = 16.0 * math.sin(t) ** 3
            hz = 13.0 * math.cos(t) - 5.0 * math.cos(2 * t) - 2.0 * math.cos(3 * t) - math.cos(4 * t)
            px = cx + hx * 11.0 * s
            pz = base_z + 170.0 * s + hz * 11.0 * s
            _part("sphere", px, cy, pz, 0.66 * s, 0.34 * s, 0.66 * s, "foliage", "%s_h%d" % (label, i))
            if i % 3 == 0:
                _part("sphere", px, cy - 20.0 * s, pz, 0.22 * s, 0.22 * s, 0.22 * s,
                      "rose" if i % 2 else "rose_pink", "%s_r%d" % (label, i))
        for k, (fx, fz) in enumerate([(0.0, 0.2), (0.32, 0.42), (-0.32, 0.42), (0.0, 0.72)]):
            _part("sphere", cx + fx * 60.0 * s, cy + 8.0 * s, base_z + 170.0 * s + fz * 60.0 * s,
                  0.72 * s, 0.34 * s, 0.72 * s, "foliage_hi", "%s_fill%d" % (label, k))

    def kit_brain(x, y, z, label):
        # A short ornate gold plinth + a floating cluster of glowing cyan lobes — a
        # focal BACKDROP landmark, never a tall pole blocking the plaza.
        ped = 250.0
        _part("cylinder", x, y, ped * 0.5, 0.9, 0.9, ped / 100.0, "gold", "%s_plinth" % label)
        _part("cylinder", x, y, ped + 12.0, 1.5, 1.5, 0.18, "gold", "%s_cap" % label)
        bz = ped + 170.0
        for i, (ox, oy, oz, d) in enumerate([(0, 0, 0, 300), (0.5, 0.2, 0.1, 220), (-0.45, 0.25, 0.15, 200),
                                             (0.2, -0.4, 0.2, 210), (-0.2, -0.3, 0.28, 180)]):
            _part("sphere", x + ox * 180, y + oy * 180, bz + oz * 180, d / 100.0, d / 100.0, d / 100.0,
                  "magic_cyan", "%s_lobe%d" % (label, i))

    def kit_plaza(x, y):
        # The Dog's Relay-identity stage: a glowing VIOLET arcane circle of concentric
        # emissive rings (each a bright disc capped by a plaza disc to leave a ring)
        # with radiating rune spokes + gold glyph studs — it should genuinely radiate.
        # Checkered cobblestone plaza floor (the reference's iconic stone checker).
        tile = 190.0
        # Warm irregular COBBLESTONE (the reference is a mossy stone courtyard, not a
        # chessboard): three close warm-stone tones chosen by a deterministic hash,
        # each tile slightly inset with a hair of height jitter so the seams read as
        # laid stone, and a scatter of moss creeping in the gaps.
        stones = ("cobble", "cobble2", "plaza")
        for gx in range(-6, 7):
            for gy in range(-6, 7):
                hsh = (gx * 73856093) ^ (gy * 19349663)
                mat = stones[hsh % 3]
                jz = 3.0 + (hsh % 5) * 0.5
                _part("cube", x + gx * tile, y + gy * tile, jz,
                      tile / 100.0 * 0.97, tile / 100.0 * 0.97, 0.055, mat, "Tile%d_%d" % (gx, gy))
                if hsh % 7 == 0:  # moss creeping between stones
                    _part("sphere", x + gx * tile + 40.0, y + gy * tile - 30.0, 6.0,
                          0.30, 0.30, 0.10, "moss", "Moss%d_%d" % (gx, gy))
        rings = [(9.0, 6.2, "arcane"), (12.0, 5.6, "plaza"), (14.0, 4.6, "arcane"),
                 (17.0, 4.0, "plaza"), (19.0, 3.0, "arcane"), (22.0, 2.4, "plaza")]
        for j, (rz, rr, mat) in enumerate(rings):
            _part("cylinder", x, y, rz, rr, rr, 0.10, mat, "ArcaneRing%d" % j)
        # radiating rune spokes (thin emissive bars from centre to rim)
        for i in range(12):
            a = (i / 12.0) * 2.0 * math.pi
            _part("cube", x + math.cos(a) * 190.0, y + math.sin(a) * 190.0, 7.5,
                  3.8, 0.12, 0.06, "arcane", "Rune%d" % i, rot=(0.0, math.degrees(a), 0.0))
        # gold glyph studs around the rim
        for i in range(8):
            a = (i / 8.0) * 2.0 * math.pi + 0.26
            _part("cylinder", x + math.cos(a) * 300.0, y + math.sin(a) * 300.0, 20.0,
                  0.26, 0.26, 0.42, "magic_gold", "Glyph%d" % i)
        _part("cylinder", x, y, 8.0, 1.2, 1.2, 0.14, "magic_gold", "ArcaneCore")

    def kit_float_key(x, y, z, label):
        # An ORNATE key, because these hang in open sky where silhouette is the
        # whole read: a ring bow with a heart at its centre, a collar, a tapered
        # shaft, and a bit with real teeth. Tilted so it never reads as a post.
        tilt = (0.0, 0.0, 22.0)
        _part("cylinder", x, y, z, 0.17, 0.17, 1.45, "gold", "%s_shaft" % label, rot=tilt)
        # bow: a ring of small spheres rather than one ball
        import math as _m
        for i in range(8):
            a = i * (2.0 * _m.pi / 8.0)
            _part("sphere", x + _m.cos(a) * 34.0, y, z + 86.0 + _m.sin(a) * 34.0,
                  0.22, 0.20, 0.22, "gold", "%s_bow%d" % (label, i))
        # heart at the centre of the bow — the Wonderland motif, in gold
        _part("sphere", x - 9.0, y, z + 92.0, 0.24, 0.20, 0.24, "gold_glow", "%s_heartL" % label)
        _part("sphere", x + 9.0, y, z + 92.0, 0.24, 0.20, 0.24, "gold_glow", "%s_heartR" % label)
        _part("cone", x, y, z + 74.0, 0.34, 0.28, 0.42, "gold_glow", "%s_heartT" % label,
              rot=(180.0, 0.0, 0.0))
        # collar
        _part("cylinder", x, y, z + 34.0, 0.30, 0.30, 0.10, "gold", "%s_collar" % label, rot=tilt)
        # bit and two teeth
        _part("cube", x + 16.0, y, z - 58.0, 0.34, 0.10, 0.30, "gold", "%s_bit" % label, rot=tilt)
        _part("cube", x + 30.0, y, z - 44.0, 0.16, 0.09, 0.14, "gold", "%s_tooth0" % label, rot=tilt)
        _part("cube", x + 30.0, y, z - 70.0, 0.16, 0.09, 0.14, "gold", "%s_tooth1" % label, rot=tilt)

    def kit_clock(x, y, z, label):
        # Floating ornate clock: gold case + pale face + two hands, facing -Y.
        _part("cylinder", x, y, z, 1.5, 0.16, 1.5, "gold", "%s_case" % label, rot=(90, 0, 0))
        _part("cylinder", x, y - 10, z, 1.2, 0.10, 1.2, "porcelain", "%s_face" % label, rot=(90, 0, 0))
        _part("cube", x, y - 18, z + 34, 0.07, 0.07, 0.66, "dog_visor", "%s_min" % label)
        _part("cube", x + 26, y - 18, z + 4, 0.5, 0.07, 0.07, "dog_visor", "%s_hr" % label)
        _part("sphere", x, y - 20, z, 0.14, 0.1, 0.14, "gold_glow", "%s_hub" % label)
        # twelve gold markers so it reads as a CLOCK at distance, not a disc
        import math as _m
        for i in range(12):
            a = i * (2.0 * _m.pi / 12.0)
            _part("cube", x + _m.sin(a) * 108.0, y - 16, z + _m.cos(a) * 108.0,
                  0.09, 0.06, 0.09 if i % 3 else 0.15, "gold", "%s_mark%d" % (label, i))

    def kit_teapot(x, y, z, label):
        # Original teapot prop: porcelain body + spout + handle + gold lid & knob.
        _part("sphere", x, y, z, 1.6, 1.6, 1.28, "porcelain", "%s_body" % label)
        _part("cylinder", x + 78, y, z + 8, 0.24, 0.24, 0.9, "porcelain", "%s_spout" % label, rot=(0, 52, 0))
        _part("cube", x - 76, y, z + 4, 0.16, 0.5, 0.5, "porcelain", "%s_handle" % label)
        _part("cylinder", x, y, z + 66, 0.7, 0.7, 0.16, "gold", "%s_lid" % label)
        _part("sphere", x, y, z + 84, 0.3, 0.3, 0.3, "gold_glow", "%s_knob" % label)

    def kit_fountain(x, y, label):
        # Tiered stone fountain with water discs + a glowing finial.
        _part("cylinder", x, y, 22.0, 3.8, 3.8, 0.44, "stone", "%s_basin" % label)
        _part("cylinder", x, y, 46.0, 3.4, 3.4, 0.10, "water", "%s_pool" % label)
        _part("cylinder", x, y, 120.0, 0.7, 0.7, 1.5, "stone", "%s_column" % label)
        _part("cylinder", x, y, 205.0, 1.9, 1.9, 0.40, "stone", "%s_tier" % label)
        _part("cylinder", x, y, 228.0, 1.6, 1.6, 0.10, "water", "%s_tierpool" % label)
        _part("sphere", x, y, 258.0, 0.55, 0.55, 0.55, "gold_glow", "%s_finial" % label)

    def kit_sign(x, y, label):
        # Playing-card style sign on a post: white card + a red heart.
        _part("cylinder", x, y, 62.0, 0.12, 0.12, 1.24, "trunk", "%s_post" % label)
        _part("cube", x, y, 158.0, 1.0, 0.12, 1.5, "porcelain", "%s_card" % label)
        _part("sphere", x, y - 10.0, 168.0, 0.4, 0.14, 0.4, "rose", "%s_heart" % label)

    def kit_arch(x, y, s, label):
        # A rose-wrapped SEE-THROUGH archway: two vine posts + a top beam you look
        # through (a foreground frame that adds depth), never a solid wall.
        h = 560.0 * s
        for sx in (-1, 1):
            _part("cylinder", x + sx * 210.0 * s, y, h * 0.5, 0.5 * s, 0.5 * s, h / 100.0,
                  "foliage", "%s_post%d" % (label, sx))
        _part("cube", x, y, h + 15.0 * s, 4.8 * s, 0.7 * s, 0.7 * s, "foliage", "%s_top" % label)
        for i in range(9):
            t = i / 8.0
            rx = x + (-1.0 + 2.0 * t) * 210.0 * s
            rz = 130.0 * s + math.sin(t * math.pi) * (h - 60.0 * s)
            _part("sphere", rx, y + 34.0 * s, rz, 0.52 * s, 0.52 * s, 0.52 * s,
                  "rose" if i % 3 else "petal_pink", "%s_rose%d" % (label, i))

    def kit_dog(x, y, label, s=1.4, fy=-1.0, body="dog_body", tag="gold_glow"):
        # The canonical Relay Dog BODY TYPE (founder reference): a compact voxel body
        # raised on FOUR SLENDER LEGS with clear gaps, a cube head with two SQUARE
        # EARS, a FLAT FACE (no snout) carrying the BLACK VISOR + GOLD GLOWING EYES,
        # and an up-tail. Lean and elegant. `body` varies the coat for companions.
        # Returns its parts so a strolling-dog actor can adopt them.
        parts = []

        def P(*a, **k):
            parts.append(_part(*a, **k))
        leg_h = 100.0 * s
        # four slender legs at the corners — a clear gap under the body
        for sx in (-1, 1):
            for sy in (-1, 1):
                P("cube", x + sx * 30.0 * s, y + sy * 48.0 * s, leg_h * 0.5,
                  0.19 * s, 0.19 * s, leg_h / 100.0, body, "%s_leg%d%d" % (label, sx, sy))
        # compact body sitting on the legs
        bz = leg_h + 34.0 * s
        P("cube", x, y, bz, 0.86 * s, 1.28 * s, 0.66 * s, body, "%s_body" % label)
        # head at the FRONT (-Y), raised; flat face, no snout
        hx, hy, hz = x, y + fy * 78.0 * s, bz + 50.0 * s
        P("cube", hx, hy, hz, 0.82 * s, 0.80 * s, 0.80 * s, body, "%s_head" % label)
        # two square ears on the head's top corners
        for sx in (-1, 1):
            P("cube", hx + sx * 26.0 * s, hy + fy * 6.0 * s, hz + 46.0 * s,
              0.2 * s, 0.24 * s, 0.40 * s, body, "%s_ear%d" % (label, sx))
        # black visor band across the flat face + gold glowing eyes
        vy = hy + fy * 40.0 * s
        P("cube", hx, vy, hz + 6.0 * s, 0.86 * s, 0.18 * s, 0.30 * s, "dog_visor", "%s_visor" % label)
        for sx in (-1, 1):
            P("cube", hx + sx * 21.0 * s, vy + fy * 6.0 * s, hz + 2.0 * s,
              0.22 * s, 0.1 * s, 0.13 * s, "dog_eye", "%s_eye%d" % (label, sx))
        # small gold identity tag at the chest
        P("cube", x, y + fy * 60.0 * s, bz - 2.0 * s, 0.26 * s, 0.12 * s, 0.26 * s, tag, "%s_tag" % label)
        # up-tail at the back
        P("cube", x, y - fy * 74.0 * s, bz + 24.0 * s, 0.18 * s, 0.44 * s, 0.20 * s, body, "%s_tail" % label, rot=(38, 0, 0))
        return parts

    def stroll_dog(x, y, label, s=1.2, body="dog_body", roam=800.0, is_hero=False, accessory="none"):
        # Spawn the LOCOMOTION actor. The Dog's BODY is now built in C++ (BuildBody),
        # NOT attached here — that is what lets the Head and Tail be animated (idle
        # look-around + walk nod on the head, a wagging tail). The generator only
        # spawns, sizes (actor scale = s) and colours (CoatName) it. The whole Dog
        # travels + turns as one unit; the material breathe/WPO keeps it alive on top.
        cls = unreal.load_class(None, "/Script/Wonderland.WonderlandStrollingDog")
        if not cls:
            unreal.log_warning("WonderlandStrollingDog missing — build C++; Dog stays static.")
            return
        stroller = actors.spawn_actor_from_class(cls, unreal.Vector(x, y, 0.0), unreal.Rotator())
        stroller.set_actor_label(label + "_stroll")
        stroller.set_actor_scale3d(unreal.Vector(s, s, s))
        set_prop(stroller, "HomeLocation", unreal.Vector(x, y, 0.0))
        set_prop(stroller, "RoamRadius", float(roam))
        set_prop(stroller, "bIsHero", bool(is_hero))
        set_prop(stroller, "CoatName", body)
        set_prop(stroller, "Accessory", accessory)
        if is_hero:
            set_prop(stroller, "WalkSpeed", 110.0)

    def kit_path(x0, y0, x1, y1, width, label):
        # One flat cobble slab per straight segment (long axis rotated onto the path).
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy)
        yaw = math.degrees(math.atan2(dy, dx))
        _part("cube", (x0 + x1) * 0.5, (y0 + y1) * 0.5, 3.0,
              length / 100.0, width / 100.0, 0.10, "cobble", label, rot=(0.0, yaw, 0.0))

    def kit_overlook(x, y, s, label):
        # MISSION OVERLOOK: a raised circular stone dais with a gold rail ring and a
        # central gold viewpoint marker.
        _part("cylinder", x, y, 45.0 * s, 3.2 * s, 3.2 * s, 0.9 * s, "plaza", "%s_dais" % label)
        _part("cylinder", x, y, 92.0 * s, 3.0 * s, 3.0 * s, 0.12 * s, "cobble", "%s_deck" % label)
        for i in range(10):
            a = (i / 10.0) * 2.0 * math.pi
            _part("cylinder", x + math.cos(a) * 150.0 * s, y + math.sin(a) * 150.0 * s, 120.0 * s,
                  0.14 * s, 0.14 * s, 0.5 * s, "gold", "%s_rail%d" % (label, i))
        _part("cylinder", x, y, 150.0 * s, 0.28 * s, 0.28 * s, 1.1 * s, "gold", "%s_scope" % label, rot=(24, 0, 0))

    def kit_pergola(x, y, s, label):
        # AGENT GARDEN: a wooden pergola (4 posts + cross beams) draped with foliage
        # and roses, a shaded garden node for Configure Agent.
        for sx in (-1, 1):
            for sy in (-1, 1):
                _part("cylinder", x + sx * 150.0 * s, y + sy * 150.0 * s, 150.0 * s,
                      0.24 * s, 0.24 * s, 3.0 * s, "trunk", "%s_post%d%d" % (label, sx, sy))
        for sy in (-1, 1):
            _part("cube", x, y + sy * 150.0 * s, 305.0 * s, 3.4 * s, 0.22 * s, 0.16 * s, "trunk", "%s_beamx%d" % (label, sy))
        for i in range(5):
            fx = x + (-1.0 + i * 0.5) * 150.0 * s
            _part("sphere", fx, y, 330.0 * s, 1.2 * s, 1.2 * s, 0.7 * s, "foliage", "%s_leaf%d" % (label, i))
            _part("sphere", fx, y + 60.0 * s, 300.0 * s, 0.4 * s, 0.4 * s, 0.4 * s,
                  "rose" if i % 2 else "petal_pink", "%s_bloom%d" % (label, i))

    def scatter(cx, cy, count, radius, fn, keep_clear=0.0, clear_at=(0.0, 0.0)):
        # Deterministic phyllotaxis spread (golden angle) — no RNG, so regen is
        # reproducible. fn(x, y, i) places one element.
        #
        # KEEP-CLEAR is the composition rule. Phyllotaxis fills from the cluster
        # centre outward, and the core cluster sits near the world origin, so
        # planting grew straight over the arcane circle and right up under the
        # camera. The reference does the opposite: an OPEN plaza with the Dog
        # legible on the circle, and the density beginning further out. Anything
        # inside the clear radius is skipped rather than nudged, so the plaza
        # edge stays an edge instead of becoming a dense ring.
        for i in range(count):
            a = math.radians(i * 137.508)
            r = radius * math.sqrt((i + 0.5) / max(1, count))
            px, py = cx + math.cos(a) * r, cy + math.sin(a) * r
            if keep_clear > 0.0:
                dx, dy = px - clear_at[0], py - clear_at[1]
                if (dx * dx + dy * dy) < (keep_clear * keep_clear):
                    continue
            fn(px, py, i)

    def flower(x, y, i):
        h = 24.0 + (i % 3) * 9.0
        _part("cylinder", x, y, h * 0.5, 0.055, 0.055, h / 100.0, "foliage", "flw_stem_%d" % i)
        # Lavender + violet + rose fields (the reference is dominated by purple flowers
        # and roses). Every sixth is a fuller ROSE BUSH — a little cluster of blooms.
        col = ("petal_violet", "petal_pink", "rose", "petal_violet", "rose_pink", "mush_purple")[i % 6]
        if i % 6 == 2:
            for k, (ox, oy, oz) in enumerate([(0, 0, 0.0), (0.16, 0.05, -0.04), (-0.13, 0.10, -0.03),
                                              (0.05, -0.16, -0.02)]):
                _part("sphere", x + ox * 40.0, y + oy * 40.0, h + 7.0 + oz * 40.0,
                      0.19, 0.19, 0.18, "rose" if k % 2 else "rose_pink", "rose_%d_%d" % (i, k))
        else:
            _part("sphere", x, y, h + 7.0, 0.28, 0.28, 0.26, col, "flw_%d" % i)

    def tuft(x, y, i):
        d = 0.5 + (i % 3) * 0.14
        _part("sphere", x, y, 12.0, d, d, 0.55, "foliage" if i % 2 else "foliage_hi", "tuft_%d" % i)

    def mote(x, y, i):
        z = 70.0 + (i * 53) % 540
        col = ("magic_gold", "magic_cyan", "arcane")[i % 3]
        d = 0.10 + (i % 3) * 0.045
        _part("sphere", x, y, z, d, d, d, col, "Mote_%d" % i)

    def air_petal(x, y, i):
        # A drifting petal in the air — a soft flattened rose petal riding the Bob WPO,
        # so it bobs on its own phase. Environmental motion, never a status channel.
        z = 130.0 + (i * 71) % 430
        d = 0.16 + (i % 3) * 0.05
        _part("cube", x, y, z, d, d * 0.34, d * 0.9, "petal_air", "Petal_%d" % i,
              rot=(float((i * 37) % 360), float((i * 53) % 360), float((i * 19) % 360)))

    def rock(x, y, i):
        # A weathered boulder cluster (stone) for environmental framing.
        d = 0.85 + (i % 4) * 0.35
        _part("sphere", x, y, d * 24.0, d, d, d * 0.68, "stone", "rock_%d" % i,
              rot=(0.0, (i * 47) % 360, (i * 23) % 26))
        if i % 2 == 0:
            _part("cube", x + 22.0, y - 16.0, d * 18.0, d * 0.6, d * 0.6, d * 0.5, "stone",
                  "rockb_%d" % i, rot=(14.0, (i * 31) % 360, 0.0))

    def kit_vine(x, y, top_z, drop, label, i=0):
        # A hanging rose-vine strand: thin foliage stem + leaves + a bloom at the tip.
        _part("cylinder", x, y, top_z - drop * 0.5, 0.08, 0.08, drop / 100.0, "foliage", "%s_stem" % label)
        for k in range(4):
            zz = top_z - drop * (0.18 + k * 0.22)
            _part("sphere", x + (13.0 if k % 2 else -13.0), y + 6.0, zz, 0.22, 0.22, 0.22,
                  "foliage_hi", "%s_leaf%d" % (label, k))
        _part("sphere", x, y, top_z - drop, 0.3, 0.3, 0.3,
              "rose" if i % 2 else "petal_pink", "%s_bloom" % label)

    def kit_dispatch(m):
        # The kitbash builders already produce sensibly-sized forms (in uu) at s=1;
        # the layout's authored scales (3-5x, tuned for a single 100uu primitive)
        # must NOT multiply them or every landmark becomes gigantic. Normalise the
        # authored scale into a gentle [0.75, 1.6] size factor, and give the two
        # heroes fixed sizes.
        mid = m.get("id", "")
        mesh = m.get("mesh", "")
        loc = m["location"]
        x, y, z = float(loc[0]), float(loc[1]), float(loc[2])
        sc = m.get("scale", [1, 1, 1])
        raw = max(0.6, (float(sc[0]) + float(sc[1])) / 2.0) if isinstance(sc, list) else 1.0
        norm = min(1.6, max(0.75, raw / 3.2))
        if mesh == "gate" or "gate" in mid:
            kit_gate(x, y, 1.4, mid)
        elif "framing_tree" in mid:
            kit_tree(x, y, 1.7, mid, giant=True)
        elif mesh == "tree" or "tree" in mid or "topiary" in mid:
            kit_tree(x, y, norm, mid)
        elif mesh == "mushroom" or "mushroom" in mid:
            kit_mushroom(x, y, min(1.4, max(0.9, norm)), mid, "mush_purple" if "purple" in mid else "mush_red")
        elif mesh == "spire" or "spire" in mid or "castle" in mid:
            kit_spire(x, y, min(1.5, max(0.9, norm)), mid)
        elif "teacup" in mid:
            kit_teacup(x, y, norm, mid)
        elif mid == "brain_landmark" or mesh == "brain":
            kit_brain(x, y, z, mid)
        elif mesh == "arch" or "arch" in mid:
            kit_arch(x, y, 1.2, mid)
        elif "overlook" in mid or "terrace" in mid:
            kit_overlook(x, y, min(1.5, max(0.9, norm)), mid)
        elif "pergola" in mid:
            kit_pergola(x, y, min(1.5, max(0.9, norm)), mid)
        elif "teapot" in mid:
            kit_teapot(x, y, max(400.0, z), mid)
        elif "sign" in mid or "card" in mid:
            kit_sign(x, y, mid)
        elif "clock" in mid:
            kit_clock(x, y, max(240.0, z), mid)
        else:
            static_mesh(mesh, loc, sc, mid)  # materialed primitive (respects its z)

    # ROBUST REGENERATION. new_level(path) REFUSES when the asset already exists,
    # so after the first-ever generation every re-run spawned into a throwaway
    # world and save_current_level() never overwrote WonderlandHub.umap — the level
    # was FROZEN at its first generation (stale sun=7lux, static meshes, camera
    # pointing up) while newer generator fixes silently never reached disk. Instead:
    # make a blank in-memory map every run (never refused), then save_map() it
    # EXPLICITLY to the target package so re-runs actually overwrite the .umap.
    editor_world = None
    try:
        editor_world = unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
    except Exception as _e:
        unreal.log_warning("new_blank_map failed (%s); falling back to new_level()" % _e)
        level_editor.new_level(layout["level"])

    # WONDERLAND IS FULLY DYNAMIC / LUMEN — force NO precomputed lighting on this
    # level so it never requires a Lightmass build. Belt-and-suspenders with the
    # project-level r.AllowStaticLighting=False (DefaultEngine.ini). Best-effort:
    # if the editor API name differs on this engine, the project setting alone
    # already removes every unbuilt-lighting requirement.
    try:
        _ew = editor_world or unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
        _ws = _ew.get_world_settings()
        set_prop(_ws, "bForceNoPrecomputedLighting", True)
    except Exception as _e:
        unreal.log_warning("WorldSettings force-no-precomputed-lighting skipped: %s" % _e)

    # --- Atmosphere -------------------------------------------------------
    atm = layout["atmosphere"]
    sun = spawn(unreal.DirectionalLight, (0, 0, 1600), label="Sun")
    # Point the sun DOWN via NAMED rotator fields. unreal.Rotator() positional-arg
    # order is a known ambiguity; a mis-ordered rotation aimed the sun at the sky
    # and lit nothing (black frame) once we went fully dynamic — the old build hid
    # this behind the direction-independent static-lighting preview.
    _sun_rot = unreal.Rotator()
    _sun_rot.set_editor_property("pitch", -max(25.0, float(atm["sunElevationDeg"])))
    _sun_rot.set_editor_property("yaw", float(atm["sunAzimuthDeg"]))
    _sun_rot.set_editor_property("roll", 0.0)
    sun.set_actor_rotation(_sun_rot, False)
    # DYNAMIC sun (Movable) so it lights the runtime level with NO baked lighting.
    sun_comp = sun.get_component_by_class(unreal.DirectionalLightComponent)
    sun_comp.set_mobility(unreal.ComponentMobility.MOVABLE)
    # UE 5.8 uses PHYSICAL light units (lux). The layout's `sunIntensity` (7.0) was
    # authored as a legacy unitless value, which in lux is ~moonlight and leaves a
    # fully-dynamic (Lumen) scene black. Scale it to a warm-daylight lux value so
    # the scene is actually lit. Warm gold to match the Wonderland art direction.
    # Auto-exposure does NOT converge in the packaged/streamed build (a bias-0
    # histogram still read 254/255 avg), so the exposure is effectively FIXED and the
    # absolute light level directly sets frame brightness. Use a restrained sun so
    # the bright placeholder materials land in range instead of blowing to white.
    # The legacy unitless `sunIntensity` (7) is ignored.
    # Lighting is the ONLY brightness lever that renders in the packaged headless
    # Pixel Streaming path — post-process exposure/grade overrides (level PPV AND
    # camera component) were proven not to reach the stream. So the storybook mood
    # is dialed in HERE: a dimmer warm key so the bright candy materials stop
    # blowing to milky white and the colours read jewel-rich like the reference.
    # The working exposure control is the launch cvar r.AutoExposure.Bias (set in
    # run-stream.sh) — it reaches the packaged Pixel Streaming render where the
    # PostProcessVolume/camera grade did NOT. A NEGATIVE bias holds the auto-exposed
    # frame down from milky mid-grey into jewel-rich colour, and the emissive arcane
    # circle glows against it (the reference's hero moment). Lighting here just sets a
    # BRIGHT day so the SkyAtmosphere reads as bright lavender sky and shadows fill;
    # the bias does the richness. Full sun; a generous sky fill so nothing crushes.
    # Raised from 240: the reference is a bright midday garden, not the
    # late-afternoon key this scene was tuned for. The auto-exposure bias
    # (launch cvar) still does the final richness pass.
    _lux = float(atm.get("sunIntensityLux", 0)) or 340.0
    sun_comp.set_intensity(_lux)
    try:
        sun_comp.set_light_color(unreal.LinearColor(1.0, 0.94, 0.84, 1.0))
    except Exception:
        pass
    set_prop(sun_comp, "bAtmosphereSunLight", True)

    # FILL light from the opposite side, no shadows. Guarantees EVERY surface gets
    # direct light (each faces toward the key or the fill), independent of skylight
    # / Lumen ambient — which do not reliably contribute in headless -RenderOffscreen.
    fill = spawn(unreal.DirectionalLight, (0, 0, 1600), label="FillLight")
    _fill_rot = unreal.Rotator()
    _fill_rot.set_editor_property("pitch", -45.0)
    _fill_rot.set_editor_property("yaw", float(atm["sunAzimuthDeg"]) + 160.0)
    _fill_rot.set_editor_property("roll", 0.0)
    fill.set_actor_rotation(_fill_rot, False)
    fill_comp = fill.get_component_by_class(unreal.DirectionalLightComponent)
    fill_comp.set_mobility(unreal.ComponentMobility.MOVABLE)
    fill_comp.set_intensity(_lux * 0.5)
    set_prop(fill_comp, "bCastShadows", False)
    set_prop(fill_comp, "CastShadows", False)

    if atm.get("skyAtmosphere"):
        sky_atm = spawn(unreal.SkyAtmosphere, (0, 0, 0), label="SkyAtmosphere")
        sac = sky_atm.get_component_by_class(unreal.SkyAtmosphereComponent)
        # BRIGHT MAGICAL DAY sky (matches the founder reference): natural blue Rayleigh
        # with a warm Mie haze near the sun for a golden horizon. The pink/purple of
        # Wonderland lives in the DISTANCE fog, the flowers and the castles — NOT the
        # whole sky. (An earlier violet Rayleigh made it a dark twilight.)
        set_prop(sac, "RayleighScatteringScale", 0.0331)
        set_prop(sac, "MieScatteringScale", 0.0030)
        set_prop(sac, "MieAnisotropy", 0.80)
    if atm.get("skyLight"):
        sky = spawn(unreal.SkyLight, (0, 0, 0), label="SkyLight")
        sky_comp = sky.get_component_by_class(unreal.SkyLightComponent)
        sky_comp.set_mobility(unreal.ComponentMobility.MOVABLE)
        # Gentle ambient fill so shadowed sides read without flooding the frame.
        try:
            sky_comp.set_intensity(0.42)
        except Exception:
            pass
        # Real-time captured sky ambient — needs no lighting build.
        set_prop(sky_comp, "bRealTimeCapture", True)
        try:
            sky_comp.set_editor_property("source_type", unreal.SkyLightSourceType.SLS_CAPTURED_SCENE)
        except Exception:
            pass
    if atm.get("volumetricCloud", True):
        # Fat storybook cumulus. Layer kept low and thin so the castle
        # skyline still reads through it rather than being swallowed.
        try:
            cloud = spawn(unreal.VolumetricCloud, (0, 0, 0), label="WonderlandClouds")
            cc = cloud.get_component_by_class(unreal.VolumetricCloudComponent)
            set_prop(cc, "LayerBottomAltitude", 6.0)
            set_prop(cc, "LayerHeight", 5.0)
            set_prop(cc, "TracingMaxDistance", 40.0)
        except Exception as _e:
            unreal.log_warning("volumetric cloud skipped: %s" % _e)
    if atm.get("volumetricFog"):
        fog = spawn(unreal.ExponentialHeightFog, (0, 0, 250), label="AtmosphereFog")
        fog_comp = fog.get_component_by_class(unreal.ExponentialHeightFogComponent)
        # Atmospheric DEPTH, not a white-out: NON-volumetric height fog (volumetric
        # in-scatter previously flooded the frame to min-luma 226). Distant geometry
        # fades toward pink-purple; the halo around the sun stays warm gold. Near/mid
        # geometry reads clear thanks to StartDistance.
        # SOFTENED for the bright-reference pass. At 0.0035 with a 1700uu start the
        # fog was greying the sky itself into a navy band, which is most of why the
        # dome read as dusk while the ground read as midday. Thinner, starting
        # further out, and tinted a light lilac rather than a deep violet: distance
        # still recedes, the sky stays sky.
        set_prop(fog_comp, "FogDensity", 0.0011)
        set_prop(fog_comp, "FogHeightFalloff", 0.09)
        set_prop(fog_comp, "StartDistance", 3200.0)
        set_prop(fog_comp, "FogInscatteringColor", unreal.LinearColor(0.66, 0.56, 0.82, 1.0))
        set_prop(fog_comp, "DirectionalInscatteringColor", unreal.LinearColor(1.0, 0.66, 0.30, 1.0))
        set_prop(fog_comp, "DirectionalInscatteringExponent", 4.0)
        # CAP THE FOG ON THE SKY. Height fog applies to the sky dome at full
        # strength, so even a thin fog repaints the whole sky its inscattering
        # colour — which is why the dome read as flat lilac-grey instead of the
        # reference's blue. Capping max opacity lets the SkyAtmosphere show
        # through while distant GEOMETRY still hazes normally.
        set_prop(fog_comp, "FogMaxOpacity", 0.30)
        set_prop(fog_comp, "bEnableVolumetricFog", False)

    # Auto-exposure (histogram) on an unbound PPV. Auto-exposure's job is to drive
    # the average scene toward mid-grey, so a LIT scene can never end up black — it
    # boosts until the frame reads correctly. (A fixed MANUAL EV was fragile and,
    # mis-set to a daylight value while the sun was still 7 lux, rendered the whole
    # frame black.) A small positive bias keeps the Wonderland Hub bright and warm.
    try:
        ppv = spawn(unreal.PostProcessVolume, (0, 0, 300), label="HubGrade")
        ppv.set_editor_property("unbound", True)
        pps = ppv.get_editor_property("settings")

        def sset(over_cpp, snake_name, val):
            # Resilient override: a wrong property name warns and continues instead of
            # aborting the rest of the grade (UE Python names vary by build).
            try:
                pps.set_editor_property("bOverride_" + over_cpp, True)
                pps.set_editor_property(snake_name, val)
            except Exception as e:
                unreal.log_warning("PPS %s skipped: %s" % (snake_name, e))

        # Exposure: auto-exposure does NOT converge in the packaged build, so treat it
        # as fixed and hold the bright placeholder materials in range with a negative
        # bias (a bias-0 histogram read avg 254/255 white).
        sset("AutoExposureMethod", "auto_exposure_method", unreal.AutoExposureMethod.AEM_HISTOGRAM)
        # Auto-exposure (histogram) actively re-meters the packaged frame to mid-grey,
        # so the exposure BIAS barely moves the result — proven by -3.2 vs -4.2 looking
        # identical. The real richness controls therefore live in the color GRADE, which
        # runs AFTER metering and so cannot be undone by auto-exposure. Bias stays near
        # neutral; the grade below pulls the blown whites down and deepens the colour.
        sset("AutoExposureBias", "auto_exposure_bias", -3.4)
        # Dreamy candy bloom, thresholded HIGH so only gold/emissive accents + true
        # highlights glow — never the midtones (which reads as milky haze).
        sset("BloomIntensity", "bloom_intensity", 0.5)
        sset("BloomThreshold", "bloom_threshold", 1.5)
        # SATURATED storybook-jewel grade (the reference is vivid, glossy, deep):
        #  - master GAIN < 1 darkens the whole frame post-metering (auto-exposure can't
        #    fight a post-tonemap gain), so colours stop washing to white;
        #  - HIGHLIGHT gain pulled well DOWN + warm so the white Dog/spires/porcelain
        #    stop blowing to pure white and keep their form and hue;
        #  - strong saturation + contrast for jewel tones; COOL-VIOLET shadows for the
        #    near-gold / distant-purple depth split.
        sset("ColorGain", "color_gain", unreal.Vector4(0.60, 0.60, 0.64, 1.0))
        sset("ColorSaturation", "color_saturation", unreal.Vector4(1.52, 1.48, 1.60, 1.0))
        sset("ColorContrast", "color_contrast", unreal.Vector4(1.18, 1.17, 1.16, 1.0))
        sset("ColorGainHighlights", "color_gain_highlights", unreal.Vector4(0.82, 0.78, 0.68, 1.0))
        sset("ColorGainShadows", "color_gain_shadows", unreal.Vector4(0.88, 0.91, 1.20, 1.0))
        sset("ColorGamma", "color_gamma", unreal.Vector4(1.0, 1.0, 1.02, 1.0))
        sset("WhiteTemp", "white_temp", 6000.0)
        sset("VignetteIntensity", "vignette_intensity", 0.44)
        ppv.set_editor_property("settings", pps)
    except Exception as _e:
        unreal.log_warning("grade PPV skipped: %s" % _e)

    # --- Ground -----------------------------------------------------------
    g = layout["ground"]
    static_mesh(g["mesh"], g["location"], g["scale"], "HubGround")

    # THE HORIZON. The plaza's own ground is 4,200uu across — about forty metres
    # — and past its edge the SkyAtmosphere's PLANET GROUND was showing through
    # as a dark navy band sitting right where the reference has bright sky and a
    # receding city. It read as dusk in an otherwise midday scene, and no amount
    # of fog or exposure tuning could fix it, because it was never haze: it was
    # the edge of the world.
    #
    # A far meadow closes it. Deliberately enormous, slightly below the plaza so
    # it never z-fights the flagstone, and in a soft lilac-green that the height
    # fog then carries toward the sky colour.
    static_mesh("plane", [0.0, 2000.0, -12.0], [5200.0, 5200.0, 1.0], "FarMeadow",
                mat="meadow_far" if "meadow_far" in MATS else "foliage")

    # DISTANT HILLS. A flat plane meeting the sky in a dead-straight line reads
    # as a backdrop, not a world. A ring of very wide, very shallow domes gives
    # the horizon a soft, uneven edge for the castle rooflines to sit against.
    import math as _mh
    for i in range(26):
        a = i * 2.39996
        d = 26000.0 + 9000.0 * ((i * 17) % 7) / 7.0
        hx, hy = _mh.cos(a) * d, _mh.sin(a) * d + 3000.0
        w = 90.0 + 40.0 * ((i * 13) % 5) / 5.0
        static_mesh("sphere", [hx, hy, -1400.0], [w, w, 15.0 + 9.0 * ((i * 11) % 4) / 4.0],
                    "Hill%d" % i, mat="meadow_far" if "meadow_far" in MATS else "foliage")

    # LAYERED SKYLINE. The reference's depth comes from castle rooflines at
    # several distances, each smaller and hazier than the last. The layout ships
    # eight spires on one ring; these are the extra rings behind them, placed on
    # an irrational angular step so the towers never line up in a visible lattice.
    import math as _m
    for ring, (dist, count, hgt, mat) in enumerate((
            (7200.0, 14, 11.0, "spire"),
            (12800.0, 18, 15.0, "spire_far" if "spire_far" in MATS else "spire"),
            (19500.0, 22, 20.0, "spire_far" if "spire_far" in MATS else "spire"))):
        for i in range(count):
            a = i * 2.39996 + ring * 0.7
            bx = _m.cos(a) * dist
            by = _m.sin(a) * dist + 1200.0
            if by < 900.0:
                continue            # keep the ring out of the player's back yard
            jitter = 0.72 + 0.56 * (((i * 37 + ring * 11) % 13) / 13.0)
            kit_spire(bx, by, jitter * (1.0 + ring * 0.28), "SkylineR%dS%d" % (ring, i),
                      roof_mat="roof_pink" if (i + ring) % 3 else "roof_rose",
                      flag=(i % 4 == 0))

    # --- Spawn: player + wandering Dog ------------------------------------
    sp = layout["spawn"]
    spawn(unreal.PlayerStart, sp["player"], (0.0, float(sp.get("playerFacingYawDeg", 90.0)), 0.0), label="PlayerStart")
    dog_cls = unreal.load_class(None, "/Script/Wonderland.WonderlandDogPawn")
    if dog_cls:
        spawn(dog_cls, sp["dog"], label="WanderingRelayDog")
    else:
        unreal.log_warning("WonderlandDogPawn not found — build the C++ module first.")

    # --- Hero meshes + background silhouettes (kitbashed forms) ------------
    for m in layout.get("landmarks", []) + layout.get("backgroundSilhouettes", []):
        kit_dispatch(m)

    # Arrival plaza + glowing arcane circle (the Dog's home / Relay identity) in
    # front of the arrival camera, plus a few floating magical keys for whimsy.
    kit_plaza(0.0, 0.0)
    # Cobblestone boulevard (N-S) + radial paths from the plaza to the gate and the
    # great tree — the premium walkable spine of the district.
    kit_path(0, -1450, 0, 1250, 470, "BLVD")
    kit_path(0, 0, -1050, 400, 340, "PATH_gate")
    kit_path(0, 0, 1300, 470, 340, "PATH_tree")
    kit_path(-1150, 0, 1150, 0, 300, "PATH_cross")
    # The Wandering Relay Dog, on the arcane circle, facing the arrival camera.
    stroll_dog(0.0, 40.0, "RelayDog", s=1.5, is_hero=True, roam=560.0)
    for i, (kx, ky, kz) in enumerate([(-640, 240, 430), (540, 120, 520), (240, 780, 560)]):
        kit_float_key(kx, ky, kz, "FloatKey%d" % i)
    # Restrained magical motes: static emissive sparkles (gold/cyan/violet) drifting
    # over the district — the bloom pass gives them a firefly glow.
    scatter(0.0, 350.0, 64, 1950.0, mote)
    scatter(0.0, 300.0, 110, 1800.0, air_petal)   # drifting petals overhead — living air
    # Ambient companions: voxel dogs of varied coats gathered AROUND the plaza (never
    # on the arcane circle — that is the hero Dog's). Matches the reference's plaza
    # full of creatures; a real wander behaviour animates them in a later pass.
    # Companions in varied coats; a few wear a top hat or a little crown (the
    # reference's Mad-Tea-Party dogs) — the headwear rides the animated head.
    for i, (cx, cy, coat, acc) in enumerate([(-380, 330, "dog_pink", "tophat"),
                                             (410, 270, "dog_gray", "crown"),
                                             (-300, -200, "dog_tan", "none"),
                                             (330, -150, "dog_brown", "tophat"),
                                             (150, 560, "dog_gray", "none"),
                                             (-620, -120, "dog_pink", "crown"),
                                             (640, 40, "dog_tan", "tophat")]):
        stroll_dog(cx, cy, "Companion%d" % i, s=1.05, body=coat, roam=1100.0, accessory=acc)
    # Candy-castle skyline in TWO layers fading into the violet haze — a real city
    # edge of pink / white / blue / teal spired turrets with flags (the reference).
    castle_bodies = ("spire_pink", "spire", "spire_blue", "spire", "spire_teal", "spire_pink")
    castle_roofs = ("spire_blue", "gold", "spire_pink", "spire_teal", "gold", "spire_blue")
    far = [(-1950, 3000, 1.4), (-1250, 3300, 1.15), (-600, 3550, 1.5), (60, 3650, 1.3),
           (720, 3450, 1.6), (1420, 3250, 1.2), (2050, 3000, 1.4), (-2450, 2600, 1.1),
           (2500, 2500, 1.25), (-3050, 2100, 1.2), (3050, 2000, 1.3)]
    near = [(-1650, 2350, 1.7), (-820, 2500, 1.35), (240, 2600, 1.9), (1050, 2450, 1.5),
            (1780, 2300, 1.7), (-2300, 2000, 1.4)]
    for i, (sx, sy, ss) in enumerate(far + near):
        kit_spire(sx, sy, ss, "Skyline%d" % i,
                  body_mat=castle_bodies[i % len(castle_bodies)],
                  roof_mat=castle_roofs[i % len(castle_roofs)])
    # Gentle rolling terrain: large low ground mounds sunk into the plane so only
    # their crowns show, breaking the dead-flat floor at the district edges.
    for i, (mx, my, mr) in enumerate([(-1650, -650, 8.0), (1750, -450, 7.0), (-2050, 1500, 9.0),
                                      (2150, 1300, 8.0), (0, -1980, 6.0)]):
        _part("sphere", mx, my, 100.0 - 21.0 * mr, mr, mr, mr * 0.42, "ground", "Mound%d" % i)
    # Signature Wonderland props: rose-heart topiaries flanking the deeper garden, a
    # giant Queen-of-Hearts teacup you could sit in, a fountain, floating clocks + a
    # teapot — the storybook furniture of the reference.
    kit_heart_topiary(1180, 1150, 70.0, 1.5, "HeartTopiaryR")
    kit_heart_topiary(-1240, 1200, 70.0, 1.35, "HeartTopiaryL")
    kit_teacup(1320, 250, 3.4, "GiantTeacup")
    kit_fountain(900, -560, "Fountain")
    for i, (cx, cy, cz) in enumerate([(-540, 300, 610), (700, 560, 680)]):
        kit_clock(cx, cy, cz, "Clock%d" % i)
    kit_teapot(-380, 760, 600, "SkyTeapot")

    # AGENT GARDEN — where a new C.A.R.D. is configured (the agent_config anchor). Read
    # it as a distinct, tended garden: a glowing gold pedestal + orb on a small arcane
    # glyph ring, encircled by a dense flower bed and a few red mushrooms.
    ax, ay = 760.0, 320.0
    _part("cylinder", ax, ay, 6.0, 3.4, 3.4, 0.05, "arcane", "AgentGlyphRing")
    _part("cylinder", ax, ay, 44.0, 0.7, 0.7, 0.86, "gold", "AgentPedestal")
    _part("cylinder", ax, ay, 90.0, 1.05, 1.05, 0.12, "gold_glow", "AgentPedestalCap")
    _part("sphere", ax, ay, 128.0, 0.5, 0.5, 0.5, "magic_gold", "AgentPedestalOrb")
    scatter(ax, ay, 64, 360.0, flower)
    scatter(ax, ay, 9, 320.0,
            lambda gx, gy, i: kit_mushroom(gx, gy, 0.5, "AgM%d" % i, "mush_red"))

    # REAL NIAGARA — duplicated shipped engine systems (NS_ArcaneFountain), placed as
    # NiagaraActors at the arcane circle, the Project-Brain plinth and the Golden Gate,
    # cooked into the level and set to auto-activate. NOTE (proven 2026-08-15): these
    # DO NOT render in the headless `-RenderOffscreen` Pixel-Streaming server — sprite
    # particles are not drawn offscreen (same render-path class as the post-process
    # bypass), verified with placements up to a scale-8 fountain high in clear sky plus
    # Niagara quality/cull cvars. The systems are genuine and render on a full
    # (windowed) client; the streamed VFX the player sees remain the emissive-mesh
    # motes. Kept in the level so a non-headless client shows real particles.
    try:
        NIAG = build_niagara()
        fountain = NIAG.get("NS_ArcaneFountain")
        if fountain is not None:
            placed = 0
            for i, (fx, fy, fz, fs) in enumerate([(0.0, 40.0, 30.0, 2.0),
                                                  (0.0, 350.0, 260.0, 1.4),
                                                  (-950.0, 300.0, 60.0, 1.2)]):
                na = spawn(unreal.NiagaraActor, (fx, fy, fz), scale=(fs, fs, fs),
                           label="ArcaneNiagara%d" % i)
                nc = na.get_component_by_class(unreal.NiagaraComponent)
                if nc is not None:
                    nc.set_asset(fountain)
                    try:
                        nc.set_editor_property("auto_activate", True)
                    except Exception:
                        pass
                    placed += 1
            unreal.log("NIAGARA placed %d fountain actors" % placed)
    except Exception as _ne:
        unreal.log_warning("niagara placement skipped: %s" % _ne)

    # --- SPATIAL AUDIO (procedural, our own) ------------------------------
    # A global wind bed (non-spatial), spatial water at the fountain, and magical
    # ambience over the arcane circle. The launch drops -nosound so Pixel Streaming
    # captures the game submix into the WebRTC audio track. Cues (gate/verified/
    # error) are imported for the interaction layer to trigger.
    try:
        AUD = build_audio()

        def ambient_at(name, x, y, z, volume, spatial):
            snd = AUD.get(name)
            if snd is None:
                return
            a = spawn(unreal.AmbientSound, (x, y, z), label="Ambient_%s" % name)
            ac = a.get_component_by_class(unreal.AudioComponent)
            if ac is None:
                return
            ac.set_sound(snd)
            try:
                ac.set_editor_property("volume_multiplier", float(volume))
                ac.set_editor_property("allow_spatialization", bool(spatial))
                if not spatial:
                    ac.set_editor_property("attenuation_settings", None)
            except Exception as _ae:
                unreal.log_warning("ambient cfg %s skipped: %s" % (name, _ae))

        ambient_at("amb_wind", 0.0, 0.0, 400.0, 0.55, False)   # global wind bed
        ambient_at("amb_magic", 0.0, 40.0, 120.0, 0.7, True)   # arcane circle
        ambient_at("amb_water", 900.0, -560.0, 70.0, 1.1, True)  # the fountain
        unreal.log("AUDIO ambients placed")
    except Exception as _ae:
        unreal.log_warning("audio placement skipped: %s" % _ae)
    # Boulders ringing the district (environmental framing) + hanging rose-vines
    # draped on the gate pillars, rose arch and pergola.
    for i in range(26):
        a = math.radians(i * 137.508)
        r = 900.0 + 1150.0 * ((i + 0.5) / 26.0)
        rock(math.cos(a) * r, 320.0 + math.sin(a) * r, i)
    for i, (vx, vy, vt, vd) in enumerate([(-1290, 400, 740, 520), (-810, 400, 740, 520),
                                          (-250, -300, 660, 470), (250, -300, 660, 470),
                                          (670, 460, 610, 420), (970, 460, 610, 420)]):
        kit_vine(vx, vy, vt, vd, "Vine%d" % i, i)

    # LUSH GROUND COVER — the reference world is densely PLANTED, so carpet the whole
    # district with flowers + grass tufts + more scattered mushrooms. Deterministic
    # phyllotaxis; a hole is left over the arcane circle so it stays clear.
    def ground_cover(gx, gy, i):
        if math.hypot(gx, gy - 40.0) < 320.0:      # keep the Dog's arcane circle clear
            return
        (flower if i % 3 else tuft)(gx, gy, i)
    # Dense carpet: three overlapping phyllotaxis passes for a lush, un-gridded
    # spread of lavender + rose (the reference's flowering courtyard).
    scatter(0.0, 300.0, 280, 1900.0, ground_cover)
    scatter(120.0, 500.0, 170, 1500.0, ground_cover)
    scatter(-140.0, 250.0, 110, 1150.0, ground_cover)
    # Classic red-and-white spotted mushrooms scattered thick (red-dominant, 2:1).
    scatter(0.0, 380.0, 44, 2050.0,
            lambda gx, gy, i: None if math.hypot(gx, gy - 40.0) < 360.0
            else kit_mushroom(gx, gy, 0.4 + 0.28 * (i % 3), "GM%d" % i, "mush_purple" if i % 3 == 0 else "mush_red"))

    # --- Water features ---------------------------------------------------
    for w in layout.get("waterFeatures", []):
        s = scale_for_radius(w.get("radiusUu", 100))
        static_mesh(w.get("mesh", "water_plane"), w["center"], [s, s, 1.0], "WATER_%s" % w["id"])

    # --- Benches (dressing; placeholder cube, facing baked from data) -----
    for b in layout.get("benchPoints", []):
        static_mesh("bench", b["location"], [1.6, 0.5, 0.5], "BENCH_%s" % b["id"],
                    rotation=(0.0, float(b.get("facingYawDeg", 0.0)), 0.0))

    # --- Hub zones: tagged empties at each centre -------------------------
    # Tag by kind + the world section it presents (or 'presents_none'), so a
    # layout/streaming pass and the projection binder can find zones by data.
    for z in layout.get("hubZones", []):
        marker(
            z["center"],
            "ZONE_%s" % z["id"],
            tags=[z["id"], z.get("kind"), z.get("streamGroup"),
                  "presents_%s" % (z.get("presentsWorldSection") or "none")],
        )

    # --- Interaction anchors ---------------------------------------------
    # An anchor that carries an intent becomes an AWonderlandInteractable: the ONE
    # in-world caller of the Relay Link's SubmitIntent. Proximity raises NOTHING;
    # only an explicit interact submits, and the intent is a REQUEST Relay may
    # refuse. An anchor with no intent (the survey vista) stays a plain marker.
    ix_cls = unreal.load_class(None, "/Script/Wonderland.WonderlandInteractable")
    if not ix_cls:
        unreal.log_warning("WonderlandInteractable not found — build the C++ module first; anchors fall back to inert markers.")
    for p in layout.get("interactionAnchors", []):
        intent = p.get("intent")
        if intent and ix_cls:
            a = spawn(ix_cls, p["location"], label="IX_%s" % p["id"])
            set_prop(a, "IntentType", intent)
            set_prop(a, "Locus", p.get("target") or p["id"])
            set_prop(a, "bRequiresControl", bool(p.get("requiresControl")))
            set_prop(a, "ProximityRadiusUu", float(p.get("proximityRadiusUu", 240)))
        else:
            marker(p["location"], "IX_%s" % p["id"], tags=[p["id"], p.get("kind"), "presents_none"])

    # --- VFX + audio anchors ---------------------------------------------
    for v in layout.get("vfxAnchors", []):
        marker(v["location"], "VFX_%s" % v["id"], tags=[v.get("kind"), "ambient_only"])
    for a in layout.get("audioZones", []):
        marker(a["center"], "AUDIO_%s" % a["id"], tags=[a.get("sound")])

    # --- Roaming zones: nav hints for ambient wandering Dogs --------------
    for r in layout.get("roamingZones", []):
        if "center" in r:
            centre = r["center"]
        else:
            poly = r.get("polygon", [[0, 0]])
            centre = [sum(v[0] for v in poly) / len(poly), sum(v[1] for v in poly) / len(poly), 0]
        marker(centre if len(centre) == 3 else [centre[0], centre[1], 0], "ROAM_%s" % r["id"], tags=[r["id"]])

    # --- Foliage / mushroom / flower CLUSTERS -----------------------------
    # One locator per cluster (centre + density in the tags). Real scatter is a
    # Milestone 2 Editor-foliage task; this does not fabricate instances.
    for key, prefix in (("foliageClusters", "FOLIAGE"),
                        ("mushroomClusters", "MUSHROOM"),
                        ("flowerBeds", "FLOWERS")):
        for c in layout.get(key, []):
            ctr = [c["center"][0], c["center"][1], c["center"][2] if len(c["center"]) > 2 else 0]
            marker(ctr, "%s_%s" % (prefix, c["id"]), tags=[c["id"], "density_%s" % c.get("density", "na")])
            # Real scattered instances (not fake — deterministic phyllotaxis) so the
            # clusters read as dense planting rather than a single locator.
            rad = float(c.get("radiusUu", 320))
            # COUNTS COME FROM THE DATA NOW. These were hardcoded at 24/18/7, so
            # every density and count field in hub-layout.json was decorative —
            # raising them in the layout changed nothing on screen, which is a
            # convincing way to believe you have increased density when you have
            # not. Density scales the count with the cluster's own area so a big
            # bed reads as full rather than as the same handful spread thinner.
            area = max(1.0, (rad / 320.0) ** 2)
            # THE ARRIVAL PLAZA STAYS OPEN. 620uu around the origin is the circle
            # plus reading room; the reference's charm needs somewhere to stand.
            PLAZA_CLEAR = 620.0
            if key == "foliageClusters":
                n = int(28 * area * (float(c.get("density", 0.55)) / 0.55))
                scatter(ctr[0], ctr[1], min(n, 220), rad, tuft,
                        keep_clear=PLAZA_CLEAR)
            elif key == "flowerBeds":
                n = int(c.get("count", 0)) or int(26 * area)
                scatter(ctr[0], ctr[1], min(n, 200), rad, flower,
                        keep_clear=PLAZA_CLEAR)
            else:
                n = int(c.get("count", 0)) or int(10 * area)
                scatter(ctr[0], ctr[1], min(n, 90), rad,
                        lambda x, y, i: kit_mushroom(x, y, 0.30 + 0.13 * (i % 4),
                                                     "mini%d" % i, "mush_purple" if i % 2 else "mush_red"),
                        keep_clear=PLAZA_CLEAR)

    # --- Paths: one locator per point (real splines/nav are M2) -----------
    def place_path(path, prefix):
        for i, pt in enumerate(path.get("points", [])):
            marker(pt, "%s_%s_%02d" % (prefix, path.get("id", "path"), i), tags=[path.get("id")])

    paths = layout.get("paths", {})
    if isinstance(paths.get("main"), dict):
        place_path(paths["main"], "PATH")
    for s in paths.get("secondary", []):
        place_path(s, "TRAIL")
    if isinstance(paths.get("hidden"), dict):
        place_path(paths["hidden"], "HIDDEN")

    # --- Hero framing cameras (aimed from their lookAt) -------------------
    for cam in layout.get("heroCameras", []):
        rot = look_at_rotation(cam["location"], cam["lookAt"])
        cam_actor = spawn(unreal.CameraActor, cam["location"], rotation=rot, label="CAM_%s" % cam["id"])
        cam_actor.get_component_by_class(unreal.CameraComponent).set_field_of_view(float(cam.get("fovDeg", 68.0)))
        # The ARRIVAL hero camera auto-activates as player 0's initial view target,
        # so the FIRST streamed frame is the intended arrival composition (Dog +
        # circle, gate + tree framing) rather than a spectator/void view. Also
        # tagged so the player controller can re-target it explicitly if needed.
        if cam.get("id") == "cam_arrival_hero":
            # Tag it so the C++ player controller can SetViewTarget to it, AND
            # auto-activate it for player 0 so the opening streamed frame is the
            # intended ARRIVAL_HERO composition regardless of possession timing. The
            # Dog pawn is still possessed underneath for later input.
            set_prop(cam_actor, "tags", [unreal.Name("arrival_hero_view")])
            try:
                set_prop(cam_actor, "auto_activate_for_player", unreal.AutoReceiveInput.PLAYER0)
            except Exception as _e:
                unreal.log_warning("arrival camera auto-activate skipped: %s" % _e)

    # --- Named HERO SHOT cameras (HeroCam0..5) ---------------------------
    # Aimed for the six founder hero shots and selected at launch by the player
    # controller under -CinematicView -HeroCam=N (relaunch per shot; no re-cook).
    # Positions/targets derive from the real landmark coordinates in this layout.
    hero_shots = [
        (0, (0.0, -1150.0, 430.0), (0.0, 120.0, 170.0), 62.0),        # ARRIVAL_HERO — plaza onto circle + tree
        (1, (300.0, -430.0, 205.0), (0.0, 60.0, 190.0), 52.0),        # DOG_CLOSEUP — the hero Dog's visor + gold eyes
        (2, (-250.0, -380.0, 430.0), (-1010.0, 360.0, 300.0), 52.0),  # GOLDEN_GATE — ornate heart-crest gate
        (3, (1300.0, -360.0, 540.0), (1300.0, 470.0, 680.0), 64.0),   # GIANT_TREE — the great framing tree
        (4, (560.0, -980.0, 380.0), (540.0, -250.0, 150.0), 58.0),    # MISSION_OVERLOOK — overlook terrace
        (5, (760.0, -180.0, 340.0), (795.0, 410.0, 150.0), 56.0),     # AGENT_GARDEN — agent_config + pergola + flowers
    ]
    for hn, hpos, hlook, hfov in hero_shots:
        hrot = look_at_rotation(hpos, hlook)
        hcam = spawn(unreal.CameraActor, hpos, rotation=hrot, label="HeroCam%d" % hn)
        try:
            hcam.get_component_by_class(unreal.CameraComponent).set_field_of_view(float(hfov))
        except Exception as _hce:
            unreal.log_warning("hero cam %d fov skipped: %s" % (hn, _hce))
        set_prop(hcam, "tags", [unreal.Name("HeroCam%d" % hn)])
    unreal.log("HERO CAMS placed: %d" % len(hero_shots))

    # SAVE EXPLICITLY to the target package so a re-run actually overwrites the map
    # (see the new_blank_map note above). Log the result + actor count as evidence
    # the regeneration reached disk — a silent no-op here is what froze the level.
    saved = False
    try:
        if editor_world is not None:
            saved = unreal.EditorLoadingAndSavingUtils.save_map(editor_world, layout["level"])
        else:
            saved = level_editor.save_current_level()
    except Exception as _e:
        unreal.log_warning("save_map failed (%s); trying save_current_level()" % _e)
        try:
            saved = level_editor.save_current_level()
        except Exception as _e2:
            unreal.log_warning("save_current_level also failed: %s" % _e2)
    _n = len(actors.get_all_level_actors())
    unreal.log("LIFECYCLE saved=%s actors=%d level=%s" % (saved, _n, layout["level"]))
    unreal.log("WonderlandHub generated from %s (Hub Design 3.0, M1 placeholder composition)." % LAYOUT_PATH)


# The UE 5.8 build host runs this file as a script:
#   UnrealEditor-Cmd Wonderland.uproject -run=pythonscript -script="…/generate-hub-level.py"
# There `import unreal` resolves, `unreal` is real, and the level is built. OFF
# ENGINE (this repo, CI, the graybox contract test) the import failed, `unreal` is
# None, and importing this module builds NOTHING — so the placement logic and the
# mesh mapping are validated without an Editor. `unreal is not None` is the only
# reliable "am I inside the Editor?" signal, so the trigger keys on it.
if unreal is not None:
    with open(LAYOUT_PATH, "r") as handle:
        build(json.load(handle))
