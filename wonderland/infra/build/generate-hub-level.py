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

import io
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

# =====================================================================
# THE LOOK TABLE
# ---------------------------------------------------------------------
# Every number that decides how Wonderland LOOKS, in one place, with how
# each one was arrived at written next to it. They used to be scattered
# through two hundred lines of prose, which made a lighting session a
# code hunt instead of a parameter sweep — and made it impossible to see
# at a glance which values are evidence and which are taste.
#
# Provenance tags, and they matter:
#   MEASURED  fixed by inspecting a REAL streamed California frame. Do
#             not "improve" one of these from a CPU preview or from
#             reasoning about it; the offline tracer is calibrated at
#             +94% luma / -76% saturation against the real renderer, so
#             it will confidently tell you the opposite of the truth.
#   PROVEN    a structural fact about this pipeline, established by a
#             failed build or a black frame. Changing it re-breaks that.
#   CHOSEN    art direction. Sweep these freely.
#   UNTESTED  authored offline and never yet rendered. Suspect by default.
#
# Any key may be overridden at build time without editing this file:
#     WONDERLAND_LOOK="sunLux=420,vignette=0.2,heroLights=0" \
#       UnrealEditor ... -run=pythonscript ...
# which is what makes a GPU session a sweep — several looks per cook
# instead of one edit, one rebuild, one look.
# =====================================================================
LOOK = {
    # --- key light -------------------------------------------------
    # MEASURED. Physical lux. The layout's legacy unitless sunIntensity
    # (7.0) is ~moonlight in UE 5.8 units and rendered a black frame
    # under Lumen; the old build hid that behind static lighting.
    "sunLux": 340.0,
    "sunWarm": (1.0, 0.94, 0.84),          # CHOSEN. Warm daylight key.
    "sunPitchMin": 25.0,                   # PROVEN. Flatter than this and
                                           # the long shadows swallow the plaza.
    # --- fill ------------------------------------------------------
    # PROVEN. A second directional at the reciprocal azimuth, shadowless.
    # Skylight and Lumen ambient do NOT reliably contribute in headless
    # -RenderOffscreen, so without this some surfaces face nothing at all.
    "fillRatio": 0.50,
    "fillYawOffset": 160.0,
    "fillPitch": -45.0,
    # --- exposure --------------------------------------------------
    # MEASURED, and the single most expensive lesson in this file:
    # histogram auto-exposure RE-METERS the packaged frame to mid-grey,
    # so the bias barely moves the result (-3.2 and -4.2 were identical).
    # Brightness cannot be fixed here. It is fixed in the grade, which
    # runs after metering, and in the absolute light level.
    "exposureBias": -3.4,
    # --- bloom -----------------------------------------------------
    # CHOSEN. Thresholded high so only gold, emissive and true highlights
    # glow. Lower the threshold and the midtones haze into milk.
    "bloomIntensity": 0.5,
    "bloomThreshold": 1.5,
    # --- grade (runs AFTER metering; this is the real brightness lever)
    "gain":            (0.60, 0.60, 0.64),  # MEASURED. <1 to stop the wash.
    "saturation":      (1.52, 1.48, 1.60),  # CHOSEN. Jewel tones.
    "contrast":        (1.18, 1.17, 1.16),  # CHOSEN.
    "gainHighlights":  (0.82, 0.78, 0.68),  # MEASURED. Holds the white Dog,
                                            # spires and porcelain off pure
                                            # white so they keep hue and form.
    "gainShadows":     (0.88, 0.91, 1.20),  # CHOSEN. Cool-violet shadows for
                                            # the warm-near / cool-far split.
    "gamma":           (1.0, 1.0, 1.02),    # CHOSEN.
    "whiteTemp": 6000.0,                    # CHOSEN.
    "vignette": 0.44,                       # CHOSEN.
    # --- local light -----------------------------------------------
    # UNTESTED. The world has exactly one kind of light actor (lantern
    # points) and otherwise relies on emissive geometry, which Lumen
    # bounces only weakly. The hero beats — the arcane circle the Dog
    # stands on, the gate's gold, the fountain — therefore glow without
    # throwing anything, and a glow that lights nothing reads as a decal.
    # These are tightly attenuated so they stay pools rather than a
    # second ambient. Set heroLights=0 to A/B them in one cook.
    "heroLights": 1,
    "heroLightLumens": 9000.0,
    "heroLightRadius": 900.0,
}


def _look_overrides():
    """Apply WONDERLAND_LOOK=key=value,... over the table.

    Unknown keys are refused rather than ignored: a silently-dropped
    override means a sweep reports a value it never actually rendered,
    which is worse than no sweep at all."""
    raw = os.environ.get("WONDERLAND_LOOK", "").strip()
    if not raw:
        return
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        if "=" not in item:
            raise ValueError("WONDERLAND_LOOK entry %r is not key=value" % item)
        k, v = item.split("=", 1)
        k, v = k.strip(), v.strip()
        if k not in LOOK:
            raise KeyError("WONDERLAND_LOOK: unknown key %r (known: %s)"
                           % (k, ", ".join(sorted(LOOK))))
        cur = LOOK[k]
        if isinstance(cur, tuple):
            parts = [float(x) for x in v.split("/")]
            if len(parts) != len(cur):
                raise ValueError("WONDERLAND_LOOK %s wants %d values a/b/c, got %r"
                                 % (k, len(cur), v))
            LOOK[k] = tuple(parts)
        else:
            LOOK[k] = float(v)


_look_overrides()

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
    # Pure metal mirrors its surroundings, and around here the surroundings
    # are grass and sky — so the most golden object in the world rendered
    # olive. Slightly less metallic, slightly rougher, with a warm emissive
    # floor so it reads gold in any environment.
    "gold":        ((1.00, 0.80, 0.38), 0.86, 0.31, (0.30, 0.21, 0.06), 0.60),
    "gold_glow":   ((1.00, 0.80, 0.38), 1.0, 0.24, (1.00, 0.70, 0.25), 1.7),
    # Aged brass for crevices, undersides and the deep parts of ornament.
    # Real gilding is dark where it is sheltered and bright where it is
    # rubbed; one flat tone across every face is the "toy" read.
    "brass_deep":  ((0.42, 0.30, 0.13), 0.92, 0.52, (0.05, 0.03, 0.00), 0.10),
    "float_glow":  ((1.00, 0.80, 0.40), 1.0, 0.24, (1.00, 0.72, 0.28), 1.9),
    "cobble":      ((0.44, 0.37, 0.31), 0.0, 0.80, (0, 0, 0), 0.0),
    "cobble2":     ((0.50, 0.43, 0.35), 0.0, 0.82, (0, 0, 0), 0.0),
    "plaza":       ((0.47, 0.40, 0.32), 0.0, 0.76, (0, 0, 0), 0.0),
    "moss":        ((0.20, 0.40, 0.16), 0.0, 0.72, (0, 0, 0), 0.0),
    "ground":      ((0.17, 0.30, 0.14), 0.0, 0.86, (0, 0, 0), 0.0),
    "trunk":       ((0.30, 0.20, 0.13), 0.0, 0.78, (0, 0, 0), 0.0),
    "foliage":     ((0.23, 0.46, 0.22), 0.0, 0.72, (0, 0, 0), 0.0),
    "foliage_hi":  ((0.38, 0.57, 0.38), 0.0, 0.66, (0, 0, 0), 0.0),
    # THE RANGE THE ADDENDUM ASKS FOR: deep forest for the shadowed core of
    # a canopy, spring for the sunlit outside. A cluster built from one green
    # is a blob however many spheres it has; built from three it has an
    # inside and an outside, which is what makes it read as leaves.
    "foliage_deep":((0.09, 0.21, 0.11), 0.0, 0.80, (0, 0, 0), 0.0),
    "foliage_spr": ((0.50, 0.72, 0.34), 0.0, 0.62, (0, 0, 0), 0.0),
    "rose":        ((0.72, 0.13, 0.28), 0.0, 0.40, (0.20, 0, 0.03), 0.45),
    "rose_pink":   ((0.96, 0.42, 0.62), 0.0, 0.40, (0.10, 0.0, 0.04), 0.3),
    "petal_pink":  ((0.94, 0.40, 0.66), 0.0, 0.38, (0, 0, 0), 0.0),
    "petal_violet":((0.52, 0.28, 0.86), 0.0, 0.40, (0.09, 0.02, 0.20), 0.35),
    "petal_air":   ((0.98, 0.62, 0.82), 0.0, 0.36, (0.10, 0.02, 0.06), 0.2),
    "mush_red":    ((0.74, 0.16, 0.26), 0.0, 0.28, (0.14, 0, 0), 0.3),
    "mush_white":  ((0.96, 0.94, 0.90), 0.0, 0.42, (0, 0, 0), 0.0),
    "mush_purple": ((0.44, 0.20, 0.76), 0.0, 0.30, (0.13, 0.02, 0.22), 0.35),
    "spire":       ((0.94, 0.90, 0.86), 0.0, 0.40, (0, 0, 0), 0.0),
    "spire_pink":  ((0.98, 0.74, 0.82), 0.0, 0.34, (0, 0, 0), 0.0),
    "spire_blue":  ((0.74, 0.82, 0.98), 0.0, 0.34, (0, 0, 0), 0.0),
    "spire_teal":  ((0.66, 0.92, 0.88), 0.0, 0.34, (0, 0, 0), 0.0),
    "porcelain":   ((0.96, 0.95, 0.93), 0.0, 0.10, (0, 0, 0), 0.0),
    "water":       ((0.16, 0.42, 0.56), 0.0, 0.05, (0.01, 0.04, 0.07), 0.15),
    # Spray and foam: near-white, barely self-lit so it stays bright against
    # the dark of a basin, and it BOBS — a jet of beads that does not move is
    # a string of pearls.
    "spray":       ((0.96, 0.98, 1.00), 0.0, 0.14, (0.30, 0.40, 0.48), 0.55),
    "magic_cyan":  ((0.20, 0.85, 1.00), 0.0, 0.30, (0.20, 0.85, 1.00), 2.2),
    # The Brain is now 72 folded lobes where it used to be 5 spheres. At the
    # bright value that is fourteen times the glowing area, and a structure
    # whose whole point is that you can read its folds becomes one cyan blob.
    # Most of it takes this; the crowns of the folds keep the bright one.
    "magic_cyan_d":((0.16, 0.62, 0.78), 0.0, 0.36, (0.14, 0.52, 0.68), 0.85),
    "magic_gold":  ((1.00, 0.84, 0.42), 0.0, 0.28, (1.00, 0.74, 0.30), 4.5),
    # Lamp glass, separately: magic_gold at 4.5 is right for a threshold disc
    # and far too hot for a lantern that also carries a real point light — at
    # eight of them down the boulevard that reads as flare, and the brief asks
    # for restrained bloom.
    "lamp_glass":  ((1.00, 0.88, 0.58), 0.0, 0.22, (1.00, 0.80, 0.42), 2.0),
    "arcane":      ((0.66, 0.36, 1.00), 0.0, 0.30, (0.62, 0.28, 1.00), 11.0),
    # The SPILL, not the source. Light leaking out of the arcane circle into
    # the paving has to fall off; at the ring's own radiance it stops reading
    # as a spill and becomes 78 more light sources in the near foreground.
    "arcane_dim":  ((0.60, 0.34, 0.92), 0.0, 0.34, (0.52, 0.24, 0.90), 3.2),
    "arcane_faint":((0.44, 0.30, 0.62), 0.0, 0.42, (0.20, 0.09, 0.34), 1.1),
    "crystal":     ((0.65, 0.40, 0.95), 0.1, 0.20, (0.40, 0.20, 0.80), 1.5),
    "dog_body":    ((0.985, 0.985, 0.995), 0.0, 0.34, (0.02, 0.02, 0.03), 0.10),
    "dog_visor":   ((0.02, 0.02, 0.03), 0.1, 0.12, (0, 0, 0), 0.0),
    "dog_eye":     ((1.00, 0.80, 0.22), 0.0, 0.28, (1.00, 0.74, 0.18), 5.0),
    "stone":       ((0.44, 0.42, 0.40), 0.0, 0.90, (0, 0, 0), 0.0),
    "dog_pink":    ((0.95, 0.62, 0.78), 0.0, 0.35, (0, 0, 0), 0.0),
    "dog_gray":    ((0.55, 0.57, 0.60), 0.0, 0.40, (0, 0, 0), 0.0),
    "dog_tan":     ((0.82, 0.66, 0.42), 0.0, 0.40, (0, 0, 0), 0.0),
    "dog_brown":   ((0.50, 0.33, 0.21), 0.0, 0.50, (0, 0, 0), 0.0),
    # --- horizon + skyline (visual pass 1) -------------------------------
    # The far meadow that closes the horizon. Soft lilac-green rather than
    # grass-green: at this distance the height fog tints toward the sky, and a
    # saturated green read as a hard band instead of receding.
    "meadow_far":  ((0.46, 0.53, 0.45), 0.0, 0.94, (0, 0, 0), 0.0),
    # Distant towers, deliberately pale and low-contrast so the skyline recedes
    # behind the hero landmarks instead of competing with them.
    "spire_far":   ((0.88, 0.86, 0.94), 0.0, 0.62, (0, 0, 0), 0.0),
    # Rose and pink rooflines — the reference's skyline is warm, not gold.
    "roof_rose":   ((0.78, 0.38, 0.44), 0.0, 0.46, (0.04, 0.0, 0.01), 0.10),
    "roof_pink":   ((0.92, 0.46, 0.62), 0.0, 0.42, (0, 0, 0), 0.0),
    # Gills under a mushroom cap: warm shadow, never black.
    "mush_gill":   ((0.80, 0.66, 0.58), 0.0, 0.70, (0, 0, 0), 0.0),
    # Cumulus. Slightly self-lit so the shaded undersides stay soft and
    # bright rather than going grey — stylised cloud, not storm cloud.
    # 2.6 is the value that was PROVEN on a streamed frame. It went to 3.6
    # unrendered at the same time the cluster count went 28 -> 44, which
    # together is 2.2x the emissive sky area that was proven — and the
    # histogram auto-exposure meters against exactly that, which is what
    # crushed the foreground to mud once already this sprint. Back to the
    # proven radiance, spread over more sky rather than concentrated.
    "cloud":       ((1.00, 1.00, 1.00), 0.0, 1.00, (0.94, 0.96, 1.00), 2.6),
    "cloud_warm":  ((1.00, 0.99, 0.99), 0.0, 1.00, (1.00, 0.95, 0.96), 2.6),
    # A leaf card: thin, matte, and a touch deeper than the blob green so
    # the fanned cards read as separate leaves rather than one mass.
    "leaf":        ((0.30, 0.52, 0.30), 0.0, 0.74, (0, 0, 0), 0.0),
    "leaf_hi":     ((0.36, 0.56, 0.34), 0.0, 0.70, (0, 0, 0), 0.0),
}


# Which surfaces never cast a shadow. See the SHADOW BUDGET note in static_mesh:
# virtual shadow maps cost per casting object, and neither of these classes puts
# a visible shadow anywhere — one is too small, the other too far.
NO_SHADOW_MATS = frozenset((
    "cloud", "cloud_warm",          # geometry standing in for cumulus
    "meadow_far", "spire_far",      # the far meadow and the distant skyline
    "petal_air", "petal_pink", "petal_violet",
))
NO_SHADOW_PREFIX = (
    "Cloud", "Hill", "Petal", "Mote", "Bfly", "Litter", "Bird",
    "SkylineB", "BlockB", "GreatCastle", "WestCastle", "Town", "Parade",
    "Wood", "Hedge", "Cot", "Roll", "LakeRim", "MidLake", "FarMeadow",
    "MidMeadow", "castle_spire", "float_island", "distant_treeline",
)


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


def build_textures():
    """Generate (once) and import our ORIGINAL procedural PBR maps as Texture2D
    assets. Provenance: 100% synthesised by wonderland/infra/build/gen-textures.py
    from integer hashes — no third-party asset, nothing to license or attribute,
    byte-identical on every rebuild. Returns {name: Texture2D}."""
    # Overridable so the offline dry run can exercise this path; the build
    # host leaves it unset and writes where the packager expects.
    outdir = os.environ.get("WONDERLAND_TEXTURE_DIR", "/opt/wonderland/textures")
    gen = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gen-textures.py")
    try:
        if not os.path.isfile(os.path.join(outdir, "T_cobble_a.png")):
            ns = {"__name__": "wl_gen_textures", "__file__": gen}
            with io.open(gen, encoding="utf8") as fh:
                exec(compile(fh.read(), gen, "exec"), ns)
            ns["generate"](outdir)
    except Exception as e:
        unreal.log_warning("texture synthesis failed (%s); world keeps flat surfaces" % e)
        return {}

    tools = unreal.AssetToolsHelpers.get_asset_tools()
    eal = unreal.EditorAssetLibrary
    names = ["flat_white", "flat_normal", "flat_grey",
             "leafcard_a", "leafcard_n", "leafcard_m"]
    for fam in ("cobble", "ashlar", "sward", "bark", "plaster", "roof"):
        names += ["%s_a" % fam, "%s_n" % fam, "%s_r" % fam]

    out, pending = {}, []
    for nm in names:
        asset = "T_" + nm
        dst = "/Game/Wonderland/Textures/" + asset
        src = os.path.join(outdir, asset + ".png")
        if eal.does_asset_exist(dst):
            out[nm] = eal.load_asset(dst)
            continue
        if not os.path.isfile(src):
            continue
        t = unreal.AssetImportTask()
        t.set_editor_property("filename", src)
        t.set_editor_property("destination_path", "/Game/Wonderland/Textures")
        t.set_editor_property("destination_name", asset)
        t.set_editor_property("automated", True)
        t.set_editor_property("save", True)
        t.set_editor_property("replace_existing", True)
        pending.append((nm, dst, t))
    if pending:
        try:
            tools.import_asset_tasks([t for _, _, t in pending])
        except Exception as e:
            unreal.log_warning("texture import failed: %s" % e)
        for nm, dst, _ in pending:
            if eal.does_asset_exist(dst):
                out[nm] = eal.load_asset(dst)

    # COLOUR SPACE IS NOT COSMETIC HERE. A normal or roughness map read as sRGB
    # is silently wrong everywhere, and a roughness map that decodes to 0.22
    # instead of 0.5 halves the roughness of the ENTIRE palette through the
    # multiply below. Set it explicitly rather than trusting import heuristics.
    for nm, tex in out.items():
        try:
            if nm.endswith("_n") or nm == "flat_normal":
                tex.set_editor_property("srgb", False)
                tex.set_editor_property("compression_settings",
                                        unreal.TextureCompressionSettings.TC_NORMALMAP)
            elif nm.endswith("_r") or nm.endswith("_m") or nm == "flat_grey":
                tex.set_editor_property("srgb", False)
                _tcg = getattr(unreal.TextureCompressionSettings, "TC_GRAYSCALE", None)
                if _tcg is not None:
                    tex.set_editor_property("compression_settings", _tcg)
            else:
                tex.set_editor_property("srgb", True)
            eal.save_asset(tex.get_path_name())
        except Exception as e:
            unreal.log_warning("texture settings on %s skipped: %s" % (nm, e))
    unreal.log("TEXTURES %d imported: %s" % (len(out), ",".join(sorted(out.keys()))))
    return out



def build_leaf_material(texs):
    """A small dedicated MASKED master for alpha-cut foliage, plus its instances.

    Deliberately NOT a duplicate of M_WLMaster: that one projects its UVs from
    world position, which is right for ground and walls and wrong for a cut-out,
    where the mask has to line up with the card it is cutting. This one samples
    mesh UVs. It keeps only what foliage needs — tint, mask, normal, roughness,
    a rim term and the sway offset — so there is very little to go wrong, and if
    any of it does the caller falls back to the opaque leaf material.
    """
    if not texs.get("leafcard_m"):
        unreal.log_warning("no leaf mask texture; foliage stays opaque")
        return {}
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    mel = unreal.MaterialEditingLibrary
    eal = unreal.EditorAssetLibrary
    pkg = "/Game/Wonderland/Materials"
    path = pkg + "/M_WLLeaf"
    try:
        if eal.does_asset_exist(path):
            master = eal.load_asset(path)
        else:
            master = tools.create_asset("M_WLLeaf", pkg, unreal.Material,
                                        unreal.MaterialFactoryNew())
            # MASKED + TWO SIDED is the entire reason this material exists
            master.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
            master.set_editor_property("two_sided", True)
            try:
                master.set_editor_property("opacity_mask_clip_value", 0.33)
            except Exception:
                pass

            uv = mel.create_material_expression(
                master, unreal.MaterialExpressionTextureCoordinate, -900, 0)

            def sampler(pname, key, stype, py):
                sm = mel.create_material_expression(
                    master, unreal.MaterialExpressionTextureSampleParameter2D, -700, py)
                sm.set_editor_property("parameter_name", pname)
                if texs.get(key) is not None:
                    sm.set_editor_property("texture", texs[key])
                v = getattr(unreal.MaterialSamplerType, stype, None)
                if v is not None:
                    try:
                        sm.set_editor_property("sampler_type", v)
                    except Exception:
                        pass
                mel.connect_material_expressions(uv, "", sm, "UVs")
                return sm

            alb = sampler("LeafAlbedo", "leafcard_a", "SAMPLERTYPE_COLOR", -260)
            nrm = sampler("LeafNormal", "leafcard_n", "SAMPLERTYPE_NORMAL", 120)
            msk = sampler("LeafMask", "leafcard_m", "SAMPLERTYPE_LINEAR_GRAYSCALE", 380)

            tint = mel.create_material_expression(
                master, unreal.MaterialExpressionVectorParameter, -700, -420)
            tint.set_editor_property("parameter_name", "BaseColor")
            tint.set_editor_property("default_value", unreal.LinearColor(1, 1, 1, 1))
            bmul = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -420, -320)
            mel.connect_material_expressions(tint, "", bmul, "A")
            mel.connect_material_expressions(alb, "", bmul, "B")
            mel.connect_material_property(bmul, "", unreal.MaterialProperty.MP_BASE_COLOR)
            mel.connect_material_property(nrm, "", unreal.MaterialProperty.MP_NORMAL)
            mel.connect_material_property(msk, "", unreal.MaterialProperty.MP_OPACITY_MASK)

            rg = mel.create_material_expression(
                master, unreal.MaterialExpressionScalarParameter, -700, 260)
            rg.set_editor_property("parameter_name", "Roughness")
            rg.set_editor_property("default_value", 0.70)
            mel.connect_material_property(rg, "", unreal.MaterialProperty.MP_ROUGHNESS)

            # sunlit edge, same instrument as the opaque palette
            try:
                fres = mel.create_material_expression(master, unreal.MaterialExpressionFresnel, -700, 540)
                ra = mel.create_material_expression(
                    master, unreal.MaterialExpressionScalarParameter, -700, 640)
                ra.set_editor_property("parameter_name", "RimAmp")
                ra.set_editor_property("default_value", 0.55)
                rc = mel.create_material_expression(
                    master, unreal.MaterialExpressionVectorParameter, -700, 720)
                rc.set_editor_property("parameter_name", "RimColor")
                rc.set_editor_property("default_value", unreal.LinearColor(0.72, 0.98, 0.44, 1.0))
                m1 = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -460, 580)
                mel.connect_material_expressions(fres, "", m1, "A")
                mel.connect_material_expressions(ra, "", m1, "B")
                m2 = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -300, 600)
                mel.connect_material_expressions(m1, "", m2, "A")
                mel.connect_material_expressions(rc, "", m2, "B")
                mel.connect_material_property(m2, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
            except Exception as _e:
                unreal.log_warning("leaf rim skipped: %s" % _e)

            # SWAY. Foliage motion is one of the goal's named items and it costs
            # four nodes: vertices ride a sine along their own normal.
            try:
                tn = mel.create_material_expression(master, unreal.MaterialExpressionTime, -900, 860)
                sn = mel.create_material_expression(master, unreal.MaterialExpressionSine, -700, 860)
                mel.connect_material_expressions(tn, "", sn, "")
                vn = mel.create_material_expression(
                    master, unreal.MaterialExpressionVertexNormalWS, -900, 960)
                amp = mel.create_material_expression(
                    master, unreal.MaterialExpressionScalarParameter, -900, 1040)
                amp.set_editor_property("parameter_name", "BreatheAmp")
                amp.set_editor_property("default_value", 4.5)
                w1 = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -460, 900)
                mel.connect_material_expressions(vn, "", w1, "A")
                mel.connect_material_expressions(sn, "", w1, "B")
                w2 = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -300, 920)
                mel.connect_material_expressions(w1, "", w2, "A")
                mel.connect_material_expressions(amp, "", w2, "B")
                mel.connect_material_property(w2, "", unreal.MaterialProperty.MP_WORLD_POSITION_OFFSET)
            except Exception as _e:
                unreal.log_warning("leaf sway skipped: %s" % _e)

            mel.recompile_material(master)
            eal.save_asset(master.get_path_name())
    except Exception as e:
        unreal.log_warning("leaf master failed (%s); foliage stays opaque" % e)
        return {}

    out = {}
    for nm, tint in (("leafcard", (0.88, 0.96, 0.82)),
                     ("leafcard_hi", (1.10, 1.14, 0.92)),
                     ("leafcard_deep", (0.52, 0.68, 0.52))):
        ip = pkg + "/MI_" + nm
        try:
            if eal.does_asset_exist(ip):
                mi = eal.load_asset(ip)
            else:
                mi = tools.create_asset("MI_" + nm, pkg, unreal.MaterialInstanceConstant,
                                        unreal.MaterialInstanceConstantFactoryNew())
                mel.set_material_instance_parent(mi, master)
            mel.set_material_instance_vector_parameter_value(
                mi, "BaseColor", unreal.LinearColor(tint[0], tint[1], tint[2], 1.0))
            eal.save_asset(mi.get_path_name())
            out[nm] = mi
        except Exception as e:
            unreal.log_warning("leaf instance %s skipped: %s" % (nm, e))
    unreal.log("LEAF CARDS %d instances" % len(out))
    return out


def build_material_library(texs=None):
    """Create (once) the master material + all palette instances, saved as cookable
    assets. Idempotent: re-runs reuse existing assets. Returns name -> instance."""
    texs = texs or {}
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
        # whatever ends up driving base colour, so a later graft has one handle
        # to multiply into whether or not the noise below wired successfully
        _bc_out = bc
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
            _bc_out = bcmul
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
        _rg_out = rg
        try:
            # PER-INSTANCE STRENGTH. The breakup used to be a fixed 0.72-1.28
            # multiplier baked into the noise node, which meant the only way to
            # adjust it was to edit this file and rebuild — on a rented GPU that
            # is a whole cook per guess. RoughVary scales the noise's DEVIATION
            # from 1.0, so 1.0 reproduces the previous render exactly and each
            # material family can take as much or as little as it wants. Ceramic
            # and gold want almost none; a uniformly broken-up world is just a
            # different uniformity.
            rvary = param(unreal.MaterialExpressionScalarParameter, "RoughVary", 210, 1.0)
            rn = mel.create_material_expression(master, unreal.MaterialExpressionNoise, -820, 120)
            rn.set_editor_property("scale", 0.05)
            rn.set_editor_property("output_min", -0.28)
            rn.set_editor_property("output_max", 0.28)
            rn.set_editor_property("levels", 3)
            # roughness * (1 + RoughVary * noise)
            rdev = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -620, 120)
            mel.connect_material_expressions(rn, "", rdev, "A")
            mel.connect_material_expressions(rvary, "", rdev, "B")
            rone = mel.create_material_expression(master, unreal.MaterialExpressionConstant, -620, 200)
            rone.set_editor_property("r", 1.0)
            radd = mel.create_material_expression(master, unreal.MaterialExpressionAdd, -470, 150)
            mel.connect_material_expressions(rone, "", radd, "A")
            mel.connect_material_expressions(rdev, "", radd, "B")
            rmul = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -320, 150)
            mel.connect_material_expressions(rg, "", rmul, "A")
            mel.connect_material_expressions(radd, "", rmul, "B")
            mel.connect_material_property(rmul, "", unreal.MaterialProperty.MP_ROUGHNESS)
            _rg_out = rmul
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
        _nrm_flat = _nrm_vscaled = None
        try:
            damp = param(unreal.MaterialExpressionScalarParameter, "DetailAmp", 560, 0.30)
            vn = mel.create_material_expression(master, unreal.MaterialExpressionVectorNoise, -820, 340)
            vscaled = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -600, 360)
            mel.connect_material_expressions(vn, "", vscaled, "A")
            mel.connect_material_expressions(damp, "", vscaled, "B")
            flat = mel.create_material_expression(master, unreal.MaterialExpressionConstant3Vector, -600, 470)
            flat.set_editor_property("constant", unreal.LinearColor(0.0, 0.0, 1.0, 1.0))
            _nrm_flat, _nrm_vscaled = flat, vscaled
            nadd = mel.create_material_expression(master, unreal.MaterialExpressionAdd, -420, 400)
            mel.connect_material_expressions(flat, "", nadd, "A")
            mel.connect_material_expressions(vscaled, "", nadd, "B")
            nnorm = mel.create_material_expression(master, unreal.MaterialExpressionNormalize, -250, 400)
            mel.connect_material_expressions(nadd, "", nnorm, "")
            mel.connect_material_property(nnorm, "", unreal.MaterialProperty.MP_NORMAL)
            unreal.log("NORMAL DETAIL wired")
        except Exception as _e:
            unreal.log_warning("normal detail skipped (%s); flat shading normals" % _e)

        # ---- AUTHORED TEXTURE INPUTS ------------------------------------
        # Three parameters whose DEFAULTS ARE EXACT NO-OPS: white albedo, flat
        # normal, mid-grey roughness. Every material that does not bind a map
        # renders exactly as it did before this pass, which is the only reason
        # it is safe to touch a master that the whole world inherits.
        #
        # UVs are the world XY plane times a per-instance TexScale, so stone
        # size is authored in centimetres and does not change when a flagstone
        # is scaled or yawed. That projection is correct for ground surfaces —
        # which is where the gap was — and vertical surfaces simply do not bind
        # a map and keep the world-space noise relief below.
        _uv = None
        _alb_s = _nrm_s = _rgh_s = None
        try:
            _wp = mel.create_material_expression(master, unreal.MaterialExpressionWorldPosition, -1500, -160)
            _msk = mel.create_material_expression(master, unreal.MaterialExpressionComponentMask, -1330, -160)
            _msk.set_editor_property("r", True)
            _msk.set_editor_property("g", True)
            _msk.set_editor_property("b", False)
            _msk.set_editor_property("a", False)
            mel.connect_material_expressions(_wp, "", _msk, "")
            _tsc = param(unreal.MaterialExpressionScalarParameter, "TexScale", -420, 0.0040)
            _uv = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -1160, -160)
            mel.connect_material_expressions(_msk, "", _uv, "A")
            mel.connect_material_expressions(_tsc, "", _uv, "B")

            # ---- SIDE PROJECTION ------------------------------------------
            # A pure XY projection is right for the ground and WRONG for
            # everything standing up: a wall's UV stops changing along its own
            # height, so the map draws as vertical streaks. Blend in a second
            # projection, (x+y, z), chosen by how vertical the surface is.
            #
            # (x+y) rather than x or y because either alone smears the half of
            # the walls that face the other axis; the sum varies on both, and
            # only a wall standing at exactly 45 degrees loses it.
            try:
                _mx = mel.create_material_expression(master, unreal.MaterialExpressionComponentMask, -1330, -40)
                _mx.set_editor_property("r", True)
                _mx.set_editor_property("g", False)
                _mx.set_editor_property("b", False)
                _mx.set_editor_property("a", False)
                mel.connect_material_expressions(_wp, "", _mx, "")
                _my = mel.create_material_expression(master, unreal.MaterialExpressionComponentMask, -1330, 40)
                _my.set_editor_property("r", False)
                _my.set_editor_property("g", True)
                _my.set_editor_property("b", False)
                _my.set_editor_property("a", False)
                mel.connect_material_expressions(_wp, "", _my, "")
                _mz = mel.create_material_expression(master, unreal.MaterialExpressionComponentMask, -1330, 120)
                _mz.set_editor_property("r", False)
                _mz.set_editor_property("g", False)
                _mz.set_editor_property("b", True)
                _mz.set_editor_property("a", False)
                mel.connect_material_expressions(_wp, "", _mz, "")
                _sxy = mel.create_material_expression(master, unreal.MaterialExpressionAdd, -1180, 0)
                mel.connect_material_expressions(_mx, "", _sxy, "A")
                mel.connect_material_expressions(_my, "", _sxy, "B")
                _app = mel.create_material_expression(master, unreal.MaterialExpressionAppendVector, -1040, 40)
                mel.connect_material_expressions(_sxy, "", _app, "A")
                mel.connect_material_expressions(_mz, "", _app, "B")
                _uvs = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -900, 40)
                mel.connect_material_expressions(_app, "", _uvs, "A")
                mel.connect_material_expressions(_tsc, "", _uvs, "B")
                # how horizontal is this surface: |normal.z|, sharpened so the
                # crossover is a narrow band rather than a wide smeared belt
                _vn2 = mel.create_material_expression(master, unreal.MaterialExpressionVertexNormalWS, -1330, 220)
                _nz = mel.create_material_expression(master, unreal.MaterialExpressionComponentMask, -1180, 220)
                _nz.set_editor_property("r", False)
                _nz.set_editor_property("g", False)
                _nz.set_editor_property("b", True)
                _nz.set_editor_property("a", False)
                mel.connect_material_expressions(_vn2, "", _nz, "")
                _anz = mel.create_material_expression(master, unreal.MaterialExpressionAbs, -1040, 220)
                mel.connect_material_expressions(_nz, "", _anz, "")
                _sh1 = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -900, 220)
                mel.connect_material_expressions(_anz, "", _sh1, "A")
                mel.connect_material_expressions(_anz, "", _sh1, "B")
                _sh2 = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -800, 240)
                mel.connect_material_expressions(_sh1, "", _sh2, "A")
                mel.connect_material_expressions(_sh1, "", _sh2, "B")
                _lrp = mel.create_material_expression(master, unreal.MaterialExpressionLinearInterpolate, -760, 120)
                mel.connect_material_expressions(_uvs, "", _lrp, "A")
                mel.connect_material_expressions(_uv, "", _lrp, "B")
                mel.connect_material_expressions(_sh2, "", _lrp, "Alpha")
                _uv = _lrp
                unreal.log("SIDE PROJECTION wired")
            except Exception as _pe:
                unreal.log_warning("side projection skipped (%s); ground-only UVs" % _pe)

            def _sampler(pname, texkey, stype, px, py):
                sm = mel.create_material_expression(
                    master, unreal.MaterialExpressionTextureSampleParameter2D, px, py)
                sm.set_editor_property("parameter_name", pname)
                tx = texs.get(texkey)
                if tx is not None:
                    sm.set_editor_property("texture", tx)
                if stype is not None:
                    try:
                        sm.set_editor_property("sampler_type", stype)
                    except Exception:
                        pass
                mel.connect_material_expressions(_uv, "", sm, "UVs")
                return sm

            # Enum spellings differ across engine versions, and a bad
            # attribute here would raise while EVALUATING the call arguments —
            # taking the whole texture block down before a single node exists.
            def _stype(*candidates):
                for c in candidates:
                    v = getattr(unreal.MaterialSamplerType, c, None)
                    if v is not None:
                        return v
                return None

            _alb_s = _sampler("AlbedoTex", "flat_white",
                              _stype("SAMPLERTYPE_COLOR"), -980, -300)
            _nrm_s = _sampler("NormalTex", "flat_normal",
                              _stype("SAMPLERTYPE_NORMAL"), -980, 470)
            _rgh_s = _sampler("RoughTex", "flat_grey",
                              _stype("SAMPLERTYPE_LINEAR_GRAYSCALE",
                                     "SAMPLERTYPE_GRAYSCALE",
                                     "SAMPLERTYPE_MASKS"), -980, 60)
            unreal.log("TEXTURE INPUTS wired")
        except Exception as _e:
            unreal.log_warning("texture inputs skipped (%s); surfaces stay untextured" % _e)

        # base colour * albedo map (white default = unchanged)
        if _alb_s is not None:
            try:
                _bt = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -160, -260)
                mel.connect_material_expressions(_bc_out, "", _bt, "A")
                mel.connect_material_expressions(_alb_s, "", _bt, "B")
                mel.connect_material_property(_bt, "", unreal.MaterialProperty.MP_BASE_COLOR)
            except Exception as _e:
                unreal.log_warning("albedo map not applied: %s" % _e)

        # roughness * (map * 2) — the grey default decodes to 0.5, so *2 = 1.0
        if _rgh_s is not None:
            try:
                _r2 = mel.create_material_expression(master, unreal.MaterialExpressionConstant, -820, 20)
                _r2.set_editor_property("r", 2.0)
                _rx = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -640, 40)
                mel.connect_material_expressions(_rgh_s, "", _rx, "A")
                mel.connect_material_expressions(_r2, "", _rx, "B")
                _rf = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -180, 130)
                mel.connect_material_expressions(_rg_out, "", _rf, "A")
                mel.connect_material_expressions(_rx, "", _rf, "B")
                mel.connect_material_property(_rf, "", unreal.MaterialProperty.MP_ROUGHNESS)
            except Exception as _e:
                unreal.log_warning("roughness map not applied: %s" % _e)

        # normal map + procedural relief. The flat default IS (0,0,1), which is
        # precisely the constant the procedural chain was already adding to, so
        # substituting the sampler for that constant is a no-op until a map is
        # bound and needs no second code path.
        if _nrm_s is not None and _nrm_flat is not None:
            try:
                _na = mel.create_material_expression(master, unreal.MaterialExpressionAdd, -420, 520)
                mel.connect_material_expressions(_nrm_s, "", _na, "A")
                mel.connect_material_expressions(_nrm_vscaled, "", _na, "B")
                _nn = mel.create_material_expression(master, unreal.MaterialExpressionNormalize, -250, 520)
                mel.connect_material_expressions(_na, "", _nn, "")
                mel.connect_material_property(_nn, "", unreal.MaterialProperty.MP_NORMAL)
            except Exception as _e:
                unreal.log_warning("normal map not applied: %s" % _e)

        em = param(unreal.MaterialExpressionVectorParameter, "Emissive", 300, unreal.LinearColor(0, 0, 0, 1))
        es = param(unreal.MaterialExpressionScalarParameter, "EmissiveStrength", 450, 0.0)
        mul = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -300, 350)
        mel.connect_material_expressions(em, "", mul, "A")
        mel.connect_material_expressions(es, "", mul, "B")
        mel.connect_material_property(mul, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)

        # ---- RIM / EDGE LIGHT -------------------------------------------
        # Every surface here is lit by sun plus ambient and nothing else, so a
        # form is bright where it faces the light and flat everywhere else. It
        # has no grazing-angle response at all — which is precisely why gold
        # reads as yellow plastic and a bush reads as one green blob.
        #
        # A Fresnel term added into emissive supplies it: gold gets the edge
        # highlight that separates it from paint, foliage gets the sunlit rim
        # that separates a leaf cluster's edge from its shadowed interior, and
        # everything that does not opt in keeps RimAmp at zero and is unchanged.
        try:
            fres = mel.create_material_expression(master, unreal.MaterialExpressionFresnel, -820, 560)
            try:
                fres.set_editor_property("exponent", 3.4)
                fres.set_editor_property("base_reflect_fraction", 0.02)
            except Exception:
                pass
            rimc = param(unreal.MaterialExpressionVectorParameter, "RimColor", 640,
                         unreal.LinearColor(1.0, 0.86, 0.58, 1.0))
            rima = param(unreal.MaterialExpressionScalarParameter, "RimAmp", 700, 0.0)
            r1 = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -600, 590)
            mel.connect_material_expressions(fres, "", r1, "A")
            mel.connect_material_expressions(rima, "", r1, "B")
            r2 = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -450, 600)
            mel.connect_material_expressions(r1, "", r2, "A")
            mel.connect_material_expressions(rimc, "", r2, "B")
            rsum = mel.create_material_expression(master, unreal.MaterialExpressionAdd, -180, 420)
            mel.connect_material_expressions(mul, "", rsum, "A")
            mel.connect_material_expressions(r2, "", rsum, "B")
            mel.connect_material_property(rsum, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
            unreal.log("RIM LIGHT wired")
        except Exception as _e:
            unreal.log_warning("rim light skipped (%s); no edge response" % _e)
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
    # ---- AUTHORED SURFACES ------------------------------------------------
    # Only these opt in. TexScale is in 1/uu: 0.0038 puts one 512px sheet across
    # 263 uu, so a cobble sett lands at about 29 cm — a real one, not a tile the
    # size of a car. The tint multiplies the map, which is how three ground
    # materials stay visibly different while sharing one sheet.
    textured = {
        "cobble":     ("cobble",  0.0038, (1.06, 1.00, 0.92)),
        "cobble2":    ("cobble",  0.0031, (0.96, 0.96, 1.00)),
        "plaza":      ("cobble",  0.0044, (1.02, 0.99, 0.94)),
        "stone":      ("ashlar",  0.0026, (1.00, 1.00, 1.00)),
        "ground":     ("sward",   0.0060, (1.00, 1.00, 0.96)),
        "moss":       ("sward",   0.0110, (0.80, 1.05, 0.78)),
        # meadow_far deliberately absent: a grass map five kilometres out
        # averages to one flat saturated lime, which reads WORSE than the
        # muted sage it replaced. That surface is carried by tint and by
        # aerial perspective, not by structure the eye can never resolve.
        "trunk":      ("bark",    0.0090, (1.00, 1.00, 1.00)),
        "moss":       ("sward",   0.0110, (0.80, 1.05, 0.78)),
        "spire":      ("plaster", 0.0055, (1.00, 1.00, 1.00)),
        "spire_pink": ("plaster", 0.0055, (1.02, 0.80, 0.86)),
        "spire_blue": ("plaster", 0.0055, (0.80, 0.88, 1.04)),
        "spire_teal": ("plaster", 0.0055, (0.72, 1.00, 0.96)),
        "roof_rose":  ("roof",    0.0070, (1.00, 1.00, 1.00)),
        "roof_pink":  ("roof",    0.0070, (1.12, 1.05, 1.05)),
    }
    if texs:
        for nm, (fam, scale, tint) in textured.items():
            mi = mats.get(nm)
            if mi is None:
                continue
            try:
                for pname, key in (("AlbedoTex", "%s_a" % fam),
                                   ("NormalTex", "%s_n" % fam),
                                   ("RoughTex", "%s_r" % fam)):
                    tex = texs.get(key)
                    if tex is not None:
                        mel.set_material_instance_texture_parameter_value(mi, pname, tex)
                mel.set_material_instance_scalar_parameter_value(mi, "TexScale", scale)
                # the map carries the colour now, so the instance tint goes to
                # roughly white — otherwise base colour and albedo multiply and
                # every textured surface drops a stop and a half.
                mel.set_material_instance_vector_parameter_value(
                    mi, "BaseColor", unreal.LinearColor(tint[0], tint[1], tint[2], 1.0))
                # authored relief replaces the procedural stand-in on these
                mel.set_material_instance_scalar_parameter_value(mi, "DetailAmp", 0.06)
                eal.save_asset(mi.get_path_name())
            except Exception as _e:
                unreal.log_warning("texture binding on %s skipped: %s" % (nm, _e))
    # WHO CATCHES LIGHT ON ITS EDGES. Gold and brass most of all — that edge
    # highlight is the difference between metal and yellow paint. Foliage next,
    # in a green-gold so leaf edges look sun-through rather than outlined.
    # Ceramic a little, for glaze. Everything else stays at zero.
    rim = {"gold": (1.05, (1.00, 0.84, 0.50)), "gold_glow": (0.90, (1.00, 0.86, 0.54)),
           "float_glow": (0.85, (1.00, 0.86, 0.54)), "magic_gold": (0.70, (1.00, 0.88, 0.60)),
           "foliage": (0.60, (0.62, 0.92, 0.38)), "foliage_hi": (0.72, (0.72, 0.98, 0.44)),
           "foliage_deep": (0.40, (0.48, 0.78, 0.30)),
           "leaf": (0.66, (0.68, 0.96, 0.42)), "leaf_hi": (0.78, (0.78, 1.00, 0.48)),
           "porcelain": (0.34, (1.00, 0.97, 0.92)), "crystal": (0.80, (0.80, 0.60, 1.00)),
           "water": (0.55, (0.72, 0.92, 1.00)), "rose": (0.34, (1.00, 0.60, 0.70)),
           "rose_pink": (0.38, (1.00, 0.72, 0.82)), "mush_red": (0.30, (1.00, 0.62, 0.56)),
           "spire": (0.22, (1.00, 0.94, 0.86)), "spire_pink": (0.24, (1.00, 0.90, 0.92)),
           "stone": (0.16, (1.00, 0.96, 0.88)),
           "dog_body": (0.42, (0.92, 0.96, 1.00)), "dog_eye": (0.90, (1.00, 0.90, 0.40))}
    for _nm, (_ra, _rc) in rim.items():
        if _nm in mats:
            try:
                mel.set_material_instance_scalar_parameter_value(mats[_nm], "RimAmp", _ra)
                mel.set_material_instance_vector_parameter_value(
                    mats[_nm], "RimColor", unreal.LinearColor(_rc[0], _rc[1], _rc[2], 1.0))
                eal.save_asset(mats[_nm].get_path_name())
            except Exception as _e:
                unreal.log_warning("rim on %s skipped: %s" % (_nm, _e))

    # PER-SURFACE RELIEF. One global strength would make porcelain look
    # sandblasted and bark look shrink-wrapped.
    relief = {"porcelain": 0.04, "gold": 0.06, "gold_glow": 0.06, "dog_body": 0.05,
              "dog_visor": 0.03, "water": 0.02, "spire": 0.20, "spire_pink": 0.20,
              "spire_blue": 0.20, "spire_teal": 0.20, "spire_far": 0.10,
              "roof_rose": 0.16, "roof_pink": 0.16, "stone": 0.80, "meadow_far": 0.50,
              "trunk": 0.85, "foliage": 0.50, "foliage_hi": 0.50, "mush_red": 0.26,
              "mush_purple": 0.26, "mush_white": 0.30, "mush_gill": 0.40,
              "rose": 0.28, "rose_pink": 0.28, "petal_pink": 0.20, "petal_violet": 0.20}
    # How much each family's roughness is allowed to WANDER. Manufactured
    # surfaces are even by definition — a sandblasted teacup is a wrong teacup —
    # while stone and bark are duller where worn and cleaner where not, and it is
    # that wander which makes a highlight travel across a form instead of sitting
    # on it as a dead sheen. Unlisted materials keep the master default of 1.0.
    rough_vary = {"porcelain": 0.18, "gold": 0.30, "gold_glow": 0.30,
                  "dog_body": 0.20, "dog_visor": 0.10, "water": 0.12,
                  "spire": 0.55, "spire_pink": 0.55, "spire_blue": 0.55,
                  "spire_teal": 0.55, "spire_far": 0.35,
                  "roof_rose": 0.60, "roof_pink": 0.60,
                  "stone": 1.00, "cobble": 1.00, "cobble2": 1.00, "plaza": 0.85,
                  "trunk": 1.00, "foliage": 0.75, "foliage_hi": 0.75}
    for _nm, _dv in relief.items():
        if _nm in mats:
            try:
                mel.set_material_instance_scalar_parameter_value(mats[_nm], "DetailAmp", _dv)
                eal.save_asset(mats[_nm].get_path_name())
            except Exception as _e:
                unreal.log_warning("relief on %s skipped: %s" % (_nm, _e))
    for _nm, _rv in rough_vary.items():
        if _nm in mats:
            try:
                mel.set_material_instance_scalar_parameter_value(mats[_nm], "RoughVary", _rv)
                eal.save_asset(mats[_nm].get_path_name())
            except Exception as _e:
                unreal.log_warning("rough vary on %s skipped: %s" % (_nm, _e))
    # Bring the Dogs alive (clear breathe) + a gentle foliage sway; everything else
    # keeps BreatheAmp 0 (static). Live motion in the stream, invisible in a still.
    breathe = {"dog_body": 6.5, "dog_pink": 6.0, "dog_gray": 6.0, "dog_tan": 6.0,
               "dog_brown": 6.0, "foliage": 3.0, "foliage_hi": 3.5,
               "foliage_deep": 2.4, "foliage_spr": 4.0, "leaf": 3.6, "leaf_hi": 4.2,
               "petal_pink": 2.5,
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
    # Water is the one surface whose whole character is movement, and it had
    # none. Small on the pools (a swell, not a trampoline), large on the jets
    # and spray, where the eye reads it as flow.
    bob = {"float_glow": 24.0, "petal_air": 22.0, "magic_cyan": 16.0,
           "water": 5.0, "spray": 19.0}
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
    TEXS = build_textures()
    MATS = build_material_library(TEXS)
    _REPORT = {"textures": len(TEXS)}
    # Folded into the same name->instance map, so a kit asks for "leafcard" the
    # same way it asks for "foliage"; if the masked master did not build, the
    # names are simply absent and every call site falls back.
    _LEAF = build_leaf_material(TEXS)
    MATS.update(_LEAF)
    _REPORT["leafcards"] = len(_LEAF)
    _REPORT["materials"] = len(MATS)
    unreal.log("MATLIB %d materials ready" % len(MATS))
    # Enhanced Input is now built in C++ at runtime (WonderlandDogPawn) — no .uasset
    # authoring needed here (the Python factory API proved unreliable).

    def spawn(cls, location, rotation=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0), label=None):
        actor = actors.spawn_actor_from_class(cls, vec(location), rot3(rotation[0], rotation[1], rotation[2]))
        actor.set_actor_scale3d(vec(scale))
        if label:
            actor.set_actor_label(label)
        return actor

    _USED_LABELS = {}

    def static_mesh(mesh_key, location, scale, label, rotation=(0.0, 0.0, 0.0), mat=None):
        path = PLACEHOLDER_MESH.get(mesh_key, UNKNOWN_MESH)
        if mesh_key not in PLACEHOLDER_MESH:
            unreal.log_warning("No placeholder mesh for '%s' (%s); using fallback." % (mesh_key, label))
        # UNIQUE LABELS. Scattered kits key their label off the per-call index,
        # and scatter() restarts that index for every cluster — so 7,050 of the
        # 24,851 actors shared a name with another, `tuft_126` ten times over.
        # UE auto-uniquifies display names so nothing breaks, but the labels are
        # what any attribution of the frame reads, and ambiguous names make that
        # analysis quietly wrong.
        #
        # Done HERE rather than by changing the index, deliberately: the index
        # also seeds every colour choice and jitter in those kits, so touching it
        # would move the world. This touches only the name.
        if label in _USED_LABELS:
            _USED_LABELS[label] += 1
            label = "%s__%d" % (label, _USED_LABELS[label])
        else:
            _USED_LABELS[label] = 0
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
        # ---- SHADOW BUDGET -------------------------------------------------
        # Virtual shadow maps cost per shadow-CASTING object, and this world has
        # twenty-two thousand of them. Two whole classes gain nothing by casting:
        #
        #   things too small to cast a shadow anyone can see — petals, motes,
        #   butterflies, litter, sparkles, the flecks on a mushroom cap;
        #   things too far away for their shadow to land anywhere in frame —
        #   the skyline bands, the castles, the hills, the far meadow, and the
        #   clouds, whose geometry is a stand-in and whose shadow would be a lie.
        #
        # Everything the player can walk up to still casts normally. This is the
        # first lever to reach for if the streamed frame rate is short, and it is
        # free: none of it changes what the frame looks like.
        _lb = label or ""
        if (mat in NO_SHADOW_MATS
                or any(_lb.startswith(_p) for _p in NO_SHADOW_PREFIX)):
            try:
                smc.set_editor_property("cast_shadow", False)
            except Exception:
                pass
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


    # ---- ORNAMENT VOCABULARY -----------------------------------------------
    # Recurring architectural pieces, defined once. Every one takes a yaw so it
    # can sit on a rotated building, and every one is cheap enough to use freely
    # except `window` and `railing`, which are gated by a detail level.

    def trim_box(cx, cy, cz, sx, sy, sz, mat, label, yaw=0.0, trim=None, band=True):
        """A box with chamfered arrises and an edge band.

        A raw cube reads as a cube because its edges are a single hard line. What
        makes masonry read as masonry at any distance is the HIGHLIGHT running
        along a chamfer — a thin bright strip where the arris catches the key
        light. Four slim vertical strips at the corners plus a band top and
        bottom is six parts, and it is the cheapest possible purchase of the
        thing the brief calls "bevels, trim"."""
        t = trim or mat
        _part("cube", cx, cy, cz, sx, sy, sz, mat, label, rot=(0.0, 0.0, yaw))
        ch = min(sx, sy) * 0.13
        for ox, oy in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
            wx = cx + (ox * sx * 50.0 * math.cos(math.radians(yaw))
                       - oy * sy * 50.0 * math.sin(math.radians(yaw)))
            wy = cy + (ox * sx * 50.0 * math.sin(math.radians(yaw))
                       + oy * sy * 50.0 * math.cos(math.radians(yaw)))
            _part("cube", wx, wy, cz, ch, ch, sz * 0.99, t,
                  "%s_arris%d%d" % (label, ox, oy), rot=(0.0, 0.0, yaw + 45.0))
        if band:
            for e, zz in ((-1, cz - sz * 49.0), (1, cz + sz * 49.0)):
                _part("cube", cx, cy, zz, sx * 1.06, sy * 1.06, sz * 0.045, t,
                      "%s_band%d" % (label, e), rot=(0.0, 0.0, yaw))

    def cornice(cx, cy, cz, sx, sy, mat, label, yaw=0.0, dentils=0):
        """A projecting moulded band: three courses, each wider than the last.
        Without one a wall meets its roof in a butt joint, which is the join a
        real building never has."""
        for i, (w, h) in enumerate(((1.00, 0.055), (1.10, 0.075), (1.20, 0.045))):
            _part("cube", cx, cy, cz + i * (sx * 5.0), sx * w, sy * w, h, mat,
                  "%s_c%d" % (label, i), rot=(0.0, 0.0, yaw))
        for d in range(dentils):
            a = math.radians(yaw) + d * (2.0 * math.pi / max(dentils, 1))
            _part("cube", cx + math.cos(a) * sx * 48.0, cy + math.sin(a) * sy * 48.0,
                  cz - sx * 3.0, sx * 0.09, sy * 0.09, 0.09, mat,
                  "%s_d%d" % (label, d), rot=(0.0, 0.0, yaw))

    def railing(x0, y0, x1, y1, z, mat, label, n=7, h=64.0, rail_mat=None):
        """Cap rail, bottom rail, turned balusters. Balconies in this world
        currently have corner posts and open air between them, which reads as
        scaffolding rather than a balcony."""
        rm = rail_mat or mat
        dx, dy = x1 - x0, y1 - y0
        ln = math.hypot(dx, dy)
        if ln < 1.0:
            return
        yaw = math.degrees(math.atan2(dy, dx))
        mx, my = (x0 + x1) * 0.5, (y0 + y1) * 0.5
        for zz, th in ((z + h, 0.075), (z + h * 0.12, 0.05)):
            _part("cube", mx, my, zz, ln / 100.0, 0.12, th, rm,
                  "%s_rail%d" % (label, int(zz)), rot=(0.0, 0.0, yaw))
        for i in range(n):
            t = (i + 0.5) / n
            _part("cylinder", x0 + dx * t, y0 + dy * t, z + h * 0.55,
                  0.055, 0.055, h * 0.9 / 100.0, mat, "%s_bal%d" % (label, i))
            _part("sphere", x0 + dx * t, y0 + dy * t, z + h * 0.55,
                  0.085, 0.085, 0.10, mat, "%s_belly%d" % (label, i))

    def window(cx, cy, cz, w, h, yaw, mat, label, glass="dog_visor", arched=True):
        """Surround, sill, mullion cross, arched head. Fenestration is the cue
        the eye uses to judge a building's SIZE — a wall with no windows has no
        scale at all, which is most of why plain extrusions read as toys."""
        ca, sa = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
        def P(ox, oz, sxx, syy, szz, m, sfx, rr=0.0):
            _part("cube", cx + ox * -sa, cy + ox * ca, cz + oz, sxx, syy, szz, m,
                  "%s_%s" % (label, sfx), rot=(0.0, 0.0, yaw + rr))
        P(0.0, 0.0, w, 0.06, h, glass, "glass")
        for e in (-1, 1):                                    # jambs
            P(e * w * 52.0, 0.0, w * 0.16, 0.11, h * 1.04, mat, "jamb%d" % e)
        P(0.0, -h * 52.0, w * 1.24, 0.16, h * 0.13, mat, "sill")
        P(0.0, h * 50.0, w * 1.14, 0.11, h * 0.10, mat, "lintel")
        P(0.0, 0.0, w * 0.10, 0.09, h * 0.96, mat, "mullion")
        P(0.0, 0.0, w * 0.96, 0.09, h * 0.09, mat, "transom")
        if arched:
            for k in range(5):
                t = (k + 0.5) / 5.0
                ang = math.pi * t
                P(math.cos(math.pi - ang) * w * 52.0,
                  h * 52.0 + math.sin(ang) * w * 40.0,
                  w * 0.20, 0.11, w * 0.20, mat, "arch%d" % k,
                  rr=0.0)

    def volute(cx, cy, cz, s, mat, label, yaw=0.0, turns=2.2, flip=1.0):
        """A real logarithmic spiral. The gate's scrollwork is presently a row of
        spheres at three heights, which reads as beads on a wire; a volute is a
        curve that TIGHTENS, and the tightening is the whole ornament."""
        n = 16
        for i in range(n):
            t = i / float(n - 1)
            ang = t * turns * 2.0 * math.pi
            r = s * 34.0 * math.exp(-1.05 * t)
            px = cx + (math.cos(ang) * r * flip) * math.cos(math.radians(yaw))
            py = cy + (math.cos(ang) * r * flip) * math.sin(math.radians(yaw))
            pz = cz + math.sin(ang) * r
            d = s * (0.115 - 0.062 * t)
            _part("sphere", px, py, pz, d, d * 0.55, d, mat, "%s_v%d" % (label, i))

    def finial(cx, cy, cz, s, mat, label, glow=None):
        """Base, ball, neck, spike. A post that simply stops is a post; a post
        that terminates is architecture."""
        g = glow or mat
        _part("cylinder", cx, cy, cz, 0.20 * s, 0.20 * s, 0.10 * s, mat, "%s_fbase" % label)
        _part("sphere", cx, cy, cz + 18.0 * s, 0.26 * s, 0.26 * s, 0.26 * s, mat, "%s_fball" % label)
        _part("cylinder", cx, cy, cz + 34.0 * s, 0.09 * s, 0.09 * s, 0.16 * s, mat, "%s_fneck" % label)
        _part("cone", cx, cy, cz + 56.0 * s, 0.15 * s, 0.15 * s, 0.34 * s, g, "%s_fspike" % label)

    def ground_skirt(x, y, r, label, n=7, flowers=True):
        """Thicken the ground where something meets it.

        Grass grows longer at the base of a tree and against a rock because
        nothing crops it there, and that ring of rough growth is what stops
        an object from looking like it was dropped onto a lawn rather than
        grown out of one. A hard line where a trunk meets flat green is one
        of the loudest prototype cues there is, and it survives any amount
        of detail higher up the object.

        Relational by construction: the skirt only exists where an object
        already does, so this cannot degenerate into the uniform scatter the
        art direction warns against."""
        h = (int(x) * 73856093) ^ (int(y) * 19349663) ^ (len(label) * 83492791)
        for i in range(n):
            a = (i / float(n)) * 2.0 * math.pi + ((h >> 3) % 17) * 0.11
            # ragged: the ring wanders in and out rather than sitting true
            rr = r * (0.86 + ((h >> (i + 2)) % 9) * 0.045)
            gx, gy = x + math.cos(a) * rr, y + math.sin(a) * rr
            tuft(gx, gy, (h + i * 13) % 97)
            if flowers and (h >> (i + 6)) % 4 == 0:
                _part("sphere", gx + 6.0, gy - 4.0, 20.0, 0.10, 0.10, 0.09,
                      ("rose_pink", "petal_violet", "petal_air",
                       "petal_pink")[(h + i) % 4], "%s_skirtfl%d" % (label, i))

    def kit_tree(x, y, s, label, giant=False):
        # The GREAT FRAMING TREE towers over the district (the reference's storybook
        # tree); ordinary trees stay modest. A tapered trunk with a knotted base and a
        # deep, layered crown so it reads as a real canopy, not a lollipop.
        th = 980.0 * s if giant else 240.0 * s
        tr = 82.0 * s if giant else 28.0 * s
        ground_skirt(x, y, tr * (2.4 if giant else 2.9), label,
                     n=13 if giant else 6)
        if giant:
            # A GNARLED TRUNK, not a post. The reference's great tree frames the
            # whole shot with a trunk that LEANS, swells and twists; a single
            # straight cylinder reads as scaffolding no matter how good the
            # canopy above it is. Stack tapering segments, each nudged off-axis
            # and rotated, so the silhouette wanders the way a real bole does.
            segs = 7
            cx_, cy_ = x, y
            for i in range(segs):
                t = i / float(segs - 1)
                sw = tr * (1.35 - 0.62 * t)          # swells at the base
                sh_ = th / segs
                cx_ += math.cos(i * 1.9) * tr * 0.13
                cy_ += math.sin(i * 1.9) * tr * 0.11
                _part("cylinder", cx_, cy_, sh_ * (i + 0.5), sw / 50.0, sw / 50.0,
                      sh_ * 1.10 / 100.0, "trunk", "%s_bole%d" % (label, i),
                      rot=(math.degrees(math.sin(i * 1.3)) * 0.09, 0.0,
                           math.degrees(math.cos(i * 1.1)) * 0.09))
                # KNOTS AND BROKEN STUBS. "avoid smooth cylinders" — a bole reads
                # as bark because of where branches used to be, not because of
                # its taper.
                if i % 2 == 0:
                    ka = i * 2.1
                    _part("sphere", cx_ + math.cos(ka) * sw * 0.95,
                          cy_ + math.sin(ka) * sw * 0.95, sh_ * (i + 0.5) + 30.0 * s,
                          0.44 * s, 0.44 * s, 0.36 * s, "trunk", "%s_knot%d" % (label, i))
                    _part("sphere", cx_ + math.cos(ka) * sw * 1.02,
                          cy_ + math.sin(ka) * sw * 1.02, sh_ * (i + 0.5) + 30.0 * s,
                          0.22 * s, 0.22 * s, 0.18 * s, "brass_deep" if "brass_deep" in MATS
                          else "trunk", "%s_knothole%d" % (label, i))
                if i in (2, 4):
                    ka = i * 2.7 + 1.1
                    for st in range(3):
                        _part("cylinder", cx_ + math.cos(ka) * sw * (1.1 + st * 0.55),
                              cy_ + math.sin(ka) * sw * (1.1 + st * 0.55),
                              sh_ * (i + 0.5) + 40.0 * s + st * 26.0 * s,
                              (0.30 - st * 0.07) * s, (0.30 - st * 0.07) * s, 0.44 * s,
                              "trunk", "%s_stub%d_%d" % (label, i, st),
                              rot=(0.0, 62.0, math.degrees(ka)))
                # moss on the north side of the bole
                for m in range(2):
                    ma = 3.6 + m * 0.5
                    _part("sphere", cx_ + math.cos(ma) * sw * 0.94,
                          cy_ + math.sin(ma) * sw * 0.94, sh_ * (i + 0.25),
                          0.34 * s, 0.30 * s, 0.52 * s, "moss", "%s_bmoss%d_%d" % (label, i, m))
                # bark ridges catching the key light
                for k in range(3):
                    a = i * 1.7 + k * 2.09
                    _part("cube", cx_ + math.cos(a) * sw * 0.92, cy_ + math.sin(a) * sw * 0.92,
                          sh_ * (i + 0.5), 0.16 * s, 0.10 * s, sh_ * 0.9 / 100.0,
                          "trunk", "%s_ridge%d_%d" % (label, i, k),
                          rot=(0.0, math.degrees(a), 0.0))
            # HANGING VINES from the lower canopy — the reference's tree drips green.
            for k in range(10):
                a = k * 2.39996
                vx, vy = x + math.cos(a) * tr * 2.6, y + math.sin(a) * tr * 2.6
                drop = 150.0 + 190.0 * (((k * 13) % 5) / 5.0)
                _part("cylinder", vx, vy, th * 0.86 - drop * 0.5, 0.05 * s, 0.05 * s,
                      drop / 100.0, "foliage", "%s_vine%d" % (label, k))
                _part("sphere", vx, vy, th * 0.86 - drop, 0.22 * s, 0.22 * s, 0.30 * s,
                      "foliage_hi", "%s_vinetip%d" % (label, k))
            # A CLOCK FACE set into the bole, exactly as the reference does — it
            # is the single detail that makes the tree read as Wonderland's tree
            # rather than any large tree.
            kit_clock(x, y - tr * 1.30, th * 0.42, "%s_clock" % label)
        else:
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

    def kit_shrub(x, y, s, label, bloom=None):
        """A layered shrub — the missing storey.

        This world jumps from ankle-high ground cover straight to trees, and the
        gap is exactly where a garden's body lives. A shrub that reads is built
        in three layers: a DARK INTERIOR that never catches light, a mid mass,
        and a bright outer rim, with leaf cards breaking the silhouette. One
        sphere of one green is the blob this replaces."""
        if in_camera_lap(x, y, 120.0):
            return

        _part("sphere", x, y, 26.0 * s, 1.05 * s, 0.95 * s, 0.80 * s,
              "foliage_deep", "%s_core" % label)
        for k in range(5):
            a = k * 2.39996 + (x + y) * 0.01
            r = 34.0 * s
            _part("sphere", x + math.cos(a) * r, y + math.sin(a) * r, 40.0 * s + (k % 2) * 14.0 * s,
                  0.82 * s, 0.74 * s, 0.66 * s,
                  "foliage" if k % 2 else "foliage_hi", "%s_mass%d" % (label, k))
        for k in range(4):
            a = k * 1.9 + 0.6
            _part("sphere", x + math.cos(a) * 26.0 * s, y + math.sin(a) * 26.0 * s, 66.0 * s,
                  0.56 * s, 0.52 * s, 0.44 * s, "foliage_spr", "%s_lit%d" % (label, k))
        if "leafcard" in MATS:
            for k in range(6):
                a = k * 1.047 + (x * 0.003)
                _part("cube", x + math.cos(a) * 52.0 * s, y + math.sin(a) * 52.0 * s,
                      44.0 * s + (k % 3) * 12.0 * s, 0.72 * s, 0.02, 0.86 * s,
                      "leafcard_hi" if k % 2 else "leafcard", "%s_card%d" % (label, k),
                      rot=(float((k * 23) % 40) - 20.0, math.degrees(a), 0.0))
        if bloom:
            for k in range(5):
                a = k * 1.257 + 0.3
                _part("sphere", x + math.cos(a) * 40.0 * s, y + math.sin(a) * 40.0 * s,
                      70.0 * s, 0.20 * s, 0.20 * s, 0.19 * s, bloom, "%s_bloom%d" % (label, k))
        # a woody base, because a shrub grows out of something
        _part("cylinder", x, y, 10.0 * s, 0.10 * s, 0.10 * s, 0.22 * s, "trunk", "%s_stem" % label)

    def kit_topiary_form(x, y, s, label, form="cone"):
        """Sculpted topiary in a planter. The brief names topiary twice and this
        world has exactly one shape of it — a heart. Clipped cones, spirals and
        standards are what a formal garden is actually made of, and they read as
        DESIGNED in a way scattered planting never does."""
        if in_camera_lap(x, y, 250.0):
            return

        # planter first: moulded, trimmed, with a soil line
        _part("cylinder", x, y, 14.0 * s, 0.62 * s, 0.62 * s, 0.28 * s, "stone", "%s_pot" % label)
        _part("cylinder", x, y, 30.0 * s, 0.70 * s, 0.70 * s, 0.10 * s, "plaza", "%s_potlip" % label)
        _part("cylinder", x, y, 34.0 * s, 0.52 * s, 0.52 * s, 0.06 * s, "trunk", "%s_soil" % label)
        if form == "cone":
            for k in range(7):
                t = k / 6.0
                _part("sphere", x, y, 46.0 * s + t * 150.0 * s,
                      (0.78 - 0.62 * t) * s, (0.78 - 0.62 * t) * s, 0.42 * s,
                      "foliage_deep" if k % 3 == 0 else ("foliage" if k % 2 else "foliage_hi"),
                      "%s_c%d" % (label, k))
        elif form == "spiral":
            for k in range(14):
                t = k / 13.0
                a = t * 4.4 * math.pi
                r = (0.62 - 0.44 * t) * s * 42.0
                _part("sphere", x + math.cos(a) * r, y + math.sin(a) * r,
                      46.0 * s + t * 168.0 * s, 0.34 * s, 0.34 * s, 0.30 * s,
                      "foliage" if k % 2 else "foliage_hi", "%s_s%d" % (label, k))
            _part("cylinder", x, y, 130.0 * s, 0.08 * s, 0.08 * s, 1.7 * s, "trunk", "%s_spine" % label)
        else:                                    # standard: a ball on a clear stem
            _part("cylinder", x, y, 92.0 * s, 0.09 * s, 0.09 * s, 1.2 * s, "trunk", "%s_stem" % label)
            _part("sphere", x, y, 176.0 * s, 0.86 * s, 0.86 * s, 0.80 * s, "foliage_deep", "%s_ball" % label)
            for k in range(6):
                a = k * 1.047
                _part("sphere", x + math.cos(a) * 34.0 * s, y + math.sin(a) * 34.0 * s,
                      182.0 * s, 0.50 * s, 0.50 * s, 0.46 * s,
                      "foliage" if k % 2 else "foliage_spr", "%s_b%d" % (label, k))
        if "leafcard" in MATS:
            for k in range(4):
                a = k * 1.571 + 0.4
                _part("cube", x + math.cos(a) * 44.0 * s, y + math.sin(a) * 44.0 * s,
                      110.0 * s, 0.60 * s, 0.02, 0.72 * s,
                      "leafcard" if k % 2 else "leafcard_hi", "%s_card%d" % (label, k),
                      rot=(float((k * 31) % 34) - 17.0, math.degrees(a), 0.0))

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
            # A DECORATIVE PILLAR, not a box. Everything ornate on this gate was
            # bolted to two plain cuboids, so the eye read "box with jewellery".
            # Stone plinth, moulded base, fluted shaft, astragal, dentilled
            # capital, cornice — the standard vocabulary, because it is the
            # vocabulary the reference's architecture speaks.
            _part("cube", px, y, 26.0 * s, 1.30 * s, 1.30 * s, 0.52 * s, "stone",
                  "%s_plinth%d" % (label, sx))
            _part("cube", px, y, 58.0 * s, 1.16 * s, 1.16 * s, 0.16 * s, "stone",
                  "%s_plinthcap%d" % (label, sx))
            _part("cube", px, y, 62.0 * s, 1.14 * s, 1.14 * s, 0.24 * s, "gold",
                  "%s_pbase%d" % (label, sx))
            # WROUGHT GOLD ON STONE PIERS. Measured against the hero frame this
            # gate alone was covering 8.15% of it in solid gold — more than half
            # of all the gold in the image — because rebuilding the pillars gave
            # them plinths, shafts, capitals and cornices and made every one of
            # them metal. The brief asks for "elegant wrought-gold" with
            # "readable negative space", and wrought work is slender members
            # against a gap, not a slab.
            #
            # The shaft and plinth become dressed stone; gold stays on the trim,
            # the grille, the scrollwork, the finials and the crest. Metal read
            # against stone is also richer than metal read against metal.
            _part("cube", px, y, ph * 0.52, 0.86 * s, 0.86 * s, ph * 0.86 / 100.0,
                  "spire" if "spire" in MATS else "gold",
                  "%s_pillar%d" % (label, sx))
            # fluting: shallow reeds down each visible face, with the shadow
            # between them carried by aged brass rather than by a shadow that
            # this lighting will never actually cast at that scale
            for f in range(5):
                fo = (f - 2) * 0.30 * s * 55.0
                for fx_, fy_ in ((0.0, -1.0), (0.0, 1.0), (-1.0, 0.0), (1.0, 0.0)):
                    _part("cube", px + fx_ * 44.0 * s + (fo if fx_ == 0 else 0.0),
                          y + fy_ * 44.0 * s + (fo if fy_ == 0 else 0.0), ph * 0.52,
                          0.09 * s, 0.09 * s, ph * 0.80 / 100.0,
                          "brass_deep" if "brass_deep" in MATS else "gold",
                          "%s_flute%d_%d_%d" % (label, sx, f, int(fx_ * 2 + fy_)))
            _part("cube", px, y, ph * 0.90, 1.02 * s, 1.02 * s, 0.16 * s, "gold",
                  "%s_astrag%d" % (label, sx))
            # dentilled capital
            for d in range(8):
                da = d * (2.0 * math.pi / 8.0)
                _part("cube", px + math.cos(da) * 52.0 * s, y + math.sin(da) * 52.0 * s,
                      ph * 0.97, 0.17 * s, 0.17 * s, 0.16 * s,
                      "brass_deep" if "brass_deep" in MATS else "gold",
                      "%s_dent%d_%d" % (label, sx, d))
            _part("cube", px, y, ph + 12.0 * s, 1.22 * s, 1.22 * s, 0.13 * s, "gold",
                  "%s_cornice%d" % (label, sx))
            _part("sphere", px, y, ph + 46.0 * s, 0.62 * s, 0.62 * s, 0.62 * s, "gold",
                  "%s_ball%d" % (label, sx))
            _part("cylinder", px, y, ph + 78.0 * s, 0.30 * s, 0.30 * s, 0.16 * s, "gold",
                  "%s_neck%d" % (label, sx))
            _part("cone", px, y, ph + 118.0 * s, 0.58 * s, 0.58 * s, 1.4 * s, "gold_glow",
                  "%s_finial%d" % (label, sx))
        # grille of slender vertical bars
        for b in range(-4, 5):
            _part("cube", x + b * 52.0 * s, y, ph * 0.46, 0.08 * s, 0.14 * s, ph * 0.9 / 100.0,
                  "gold", "%s_bar%d" % (label, b))
        # scrollwork curls along the top rail
        # SCROLLWORK, properly. One row of seven blobs is a fence; ornate ironwork
        # is layered curl-work reading at several scales, so this is three rows
        # at different heights and sizes plus corner spirals that turn the eye.
        # VOLUTES, which is what scrollwork is. Rows of evenly-spaced spheres at
        # three heights read as beads threaded on a wire; a volute is a curve
        # that TIGHTENS as it turns, and the tightening is the entire ornament.
        # Paired and mirrored, the way wrought ironwork actually comes.
        for b in range(-3, 4):
            volute(x + b * 88.0 * s, y, ph * 0.80, s * 0.72,
                   "gold", "%s_scrollA%d" % (label, b), flip=1.0 if b % 2 == 0 else -1.0)
        for b in range(-2, 3):
            volute(x + b * 112.0 * s, y, ph * 0.56, s * 0.52,
                   "gold", "%s_scrollB%d" % (label, b), flip=-1.0 if b % 2 == 0 else 1.0)
        # a bigger pair springing off each pier, turning the eye back inward
        for sx in (-1, 1):
            volute(x + sx * 196.0 * s, y, ph * 0.86, s * 1.05,
                   "gold", "%s_scrollP%d" % (label, sx), flip=float(sx))
        # CLIMBING ROSES on the posts — the reference's gate is planted, not bare.
        for sx in (-1, 1):
            for k in range(9):
                t = k / 8.0
                a = t * 6.0 + (0.0 if sx < 0 else 1.7)
                _part("sphere", x + sx * 250.0 * s + math.cos(a) * 34.0 * s,
                      y + math.sin(a) * 30.0 * s, 40.0 * s + t * ph * 0.92,
                      0.30 * s, 0.30 * s, 0.30 * s, "foliage", "%s_ivy%d_%d" % (label, sx, k))
                if k % 3 == 0:
                    _part("sphere", x + sx * 250.0 * s + math.cos(a + 0.6) * 40.0 * s,
                          y + math.sin(a + 0.6) * 34.0 * s, 46.0 * s + t * ph * 0.92,
                          0.17 * s, 0.17 * s, 0.17 * s,
                          "rose_pink" if k % 2 else "rose", "%s_rose%d_%d" % (label, sx, k))
        # GATE ACTIVATION — a glowing arcane veil across the portal, drifting gold
        # glyphs, and a warm threshold ring underfoot, so the Golden Build Gate reads
        # as an ACTIVE threshold into Building rather than an inert arch.
        # NO SOLID VEIL. This was one opaque emissive slab spanning the whole
        # portal, and on an opaque master it read as a sheet of purple plastic
        # — the single ugliest object in the hero frame. The reference's gate is
        # OPEN: you see the garden through the scrollwork, and that see-through
        # depth is most of why it looks ornate rather than blocked. The
        # activation now reads as a few slender vertical shimmer bars instead,
        # which say "threshold" without walling the view off.
        for v in range(-3, 4):
            _part("cube", x + v * 62.0 * s, y + 3.0 * s, ph * 0.46,
                  0.10 * s, 0.05 * s, ph * 0.80 / 100.0, "arcane", "%s_shimmer%d" % (label, v))
        for k in range(-2, 3):
            _part("sphere", x + k * 92.0 * s, y - 10.0 * s, ph * (0.34 + 0.14 * (k % 2)),
                  0.16 * s, 0.16 * s, 0.16 * s, "float_glow", "%s_glyph%d" % (label, k))
        _part("cylinder", x, y, 5.0, 3.1 * s, 3.1 * s, 0.04, "magic_gold", "%s_threshold" % label)
        # The lintel was a solid gold slab spanning the entire portal. A
        # wrought gate carries its span on a slender rail with the ornament
        # ABOVE it, so the opening stays an opening.
        _part("cube", x, y, ph + 45.0 * s, 6.2 * s, 0.62 * s, 0.34 * s, "gold", "%s_beam" % label)
        _part("cube", x, y, ph + 68.0 * s, 6.0 * s, 0.30 * s, 0.16 * s, "gold", "%s_beamtrim" % label)
        # a glowing heart crest: two lobes + a point below the keystone
        for sx in (-1, 1):
            _part("sphere", x + sx * 44.0 * s, y, ph + 150.0 * s, 0.5 * s, 0.3 * s, 0.5 * s,
                  "rose", "%s_heartlobe%d" % (label, sx))
        _part("cube", x, y, ph + 108.0 * s, 0.62 * s, 0.3 * s, 0.62 * s, "rose", "%s_heartpt" % label,
              rot=(0.0, 0.0, 45.0))
        _part("cube", x, y, ph + 120.0 * s, 1.4 * s, 1.35 * s, 1.0 * s, "gold_glow", "%s_keystone" % label)

    def kit_spire(x, y, s, label, body_mat="spire", roof_mat="gold", flag=True,
                  detail=0):
        """detail: 0 = silhouette (the far skyline bands, sixty of them),
        1 = trimmed with a railed balcony and proper windows (near towers).
        The brief asks for near detail and far silhouette; this is where that
        distinction is actually spent, and it keeps sixty towers from each
        carrying ornament nobody can resolve."""
        # A CASTLE TURRET, not a cylinder wearing a cone. The skyline fills the
        # upper third of every wide shot, so a bare cone-on-a-tube was the single
        # most visible "prototype" cue left in the world. The reference's towers
        # read as architecture because they have four things this now has:
        #
        #   BREAK IN THE SILHOUETTE - a base plinth, a corbel band and a balcony
        #     ring, so the vertical is interrupted instead of being one extrusion;
        #   OVERHANG - the balcony is WIDER than the shaft it sits on, which is
        #     what makes a tower read as built rather than turned on a lathe;
        #   FENESTRATION - windows in a vertical rhythm, the cue the eye uses to
        #     judge a building's scale at any distance;
        #   A ROOF WITH A LIP - the eave is what stops a cone reading as a party
        #     hat, plus a lantern under the finial.
        bh, br = 440.0 * s, 72.0 * s
        # plinth
        _part("cylinder", x, y, 16.0 * s, br * 1.24 / 50.0, br * 1.24 / 50.0, 0.34 * s,
              "stone" if "stone" in MATS else body_mat, "%s_plinth" % label)
        # shaft, very slightly tapered by stacking two drums
        _part("cylinder", x, y, bh * 0.30, br / 50.0, br / 50.0, bh * 0.62 / 100.0,
              body_mat, "%s_shaft" % label)
        _part("cylinder", x, y, bh * 0.74, br * 0.92 / 50.0, br * 0.92 / 50.0, bh * 0.52 / 100.0,
              body_mat, "%s_shaft2" % label)
        # corbel band + balcony that OVERHANGS the shaft
        _part("cylinder", x, y, bh * 0.60, br * 1.10 / 50.0, br * 1.10 / 50.0, 0.16 * s,
              roof_mat, "%s_corbel" % label)
        _part("cylinder", x, y, bh + 34.0 * s, br * 1.18 / 50.0, br * 1.18 / 50.0, 0.22 * s,
              body_mat, "%s_balcony" % label)
        # merlons around the balcony rim
        for i in range(8):
            a = i * (2.0 * math.pi / 8.0)
            _part("cube", x + math.cos(a) * br * 1.10, y + math.sin(a) * br * 1.10,
                  bh + 58.0 * s, 0.17 * s, 0.17 * s, 0.30 * s, body_mat,
                  "%s_merlon%d" % (label, i), rot=(0.0, math.degrees(a), 0.0))
        if detail >= 1:
            # a railed balcony between the merlons, and a moulded corbel band —
            # posts with open air between them read as scaffolding
            for i in range(8):
                a0 = i * (2.0 * math.pi / 8.0)
                a1 = (i + 1) * (2.0 * math.pi / 8.0)
                railing(x + math.cos(a0) * br * 1.10, y + math.sin(a0) * br * 1.10,
                        x + math.cos(a1) * br * 1.10, y + math.sin(a1) * br * 1.10,
                        bh + 34.0 * s, roof_mat, "%s_rail%d" % (label, i), n=3, h=30.0 * s)
            cornice(x, y, bh * 0.60, br * 1.06 / 50.0, br * 1.06 / 50.0,
                    roof_mat, "%s_corn" % label, dentils=8)
        # windows: two tiers of four, the scale cue
        for tier, tz in enumerate((bh * 0.34, bh * 0.66)):
            for i in range(4):
                a = i * (math.pi / 2.0) + tier * 0.4
                if detail >= 1:
                    window(x + math.cos(a) * br * 0.99, y + math.sin(a) * br * 0.99, tz,
                           0.20 * s, 0.34 * s, math.degrees(a) + 90.0, body_mat,
                           "%s_w%d_%d" % (label, tier, i))
                else:
                    _part("cube", x + math.cos(a) * br * 0.99, y + math.sin(a) * br * 0.99, tz,
                          0.10 * s, 0.20 * s, 0.34 * s, "dog_visor",
                          "%s_win%d_%d" % (label, tier, i), rot=(0.0, math.degrees(a), 0.0))
        # roof with an EAVE lip, then the spire proper
        _part("cylinder", x, y, bh + 76.0 * s, br * 1.30 / 50.0, br * 1.30 / 50.0, 0.14 * s,
              roof_mat, "%s_eave" % label)
        _part("cone", x, y, bh + 210.0 * s, 1.9 * s, 1.9 * s, 2.9 * s, roof_mat, "%s_roof" % label)
        # lantern under the finial
        _part("cylinder", x, y, bh + 306.0 * s, 0.26 * s, 0.26 * s, 0.30 * s, "gold", "%s_lantern" % label)
        _part("sphere", x, y, bh + 336.0 * s, 0.32 * s, 0.32 * s, 0.32 * s, "gold_glow", "%s_finial" % label)
        if flag:
            _part("cylinder", x, y, bh + 400.0 * s, 0.05 * s, 0.05 * s, 1.1 * s, "gold", "%s_pole" % label)
            _part("cube", x + 24.0 * s, y, bh + 470.0 * s, 0.02 * s, 0.42 * s, 0.28 * s, roof_mat, "%s_flag" % label)

    def kit_castle(x, y, s, label):
        """The hero castle that closes the north axis. One dominant silhouette
        rather than a picket line of identical turrets: a great keep, four corner
        towers stepped in height, a curtain wall with merlons and a gatehouse.
        The reference's skyline reads as a CITY because it has a subject; a ring
        of equal towers reads as a fence."""
        wall_r = 620.0 * s
        # curtain wall: 20 segments around a circle, with merlons on top
        for i in range(20):
            a = i * (2.0 * math.pi / 20.0)
            wx, wy = x + math.cos(a) * wall_r, y + math.sin(a) * wall_r
            _part("cube", wx, wy, 150.0 * s, 2.1 * s, 0.62 * s, 3.0 * s, "spire_far",
                  "%s_wall%d" % (label, i), rot=(0.0, 0.0, math.degrees(a) + 90.0))
            _part("cube", wx, wy, 320.0 * s, 2.1 * s, 0.74 * s, 0.34 * s, "spire_far",
                  "%s_walk%d" % (label, i), rot=(0.0, 0.0, math.degrees(a) + 90.0))
            for k in (-1, 1):
                _part("cube", wx + math.cos(a + 1.5708) * 46.0 * s * k,
                      wy + math.sin(a + 1.5708) * 46.0 * s * k, 360.0 * s,
                      0.42 * s, 0.42 * s, 0.5 * s, "spire_far",
                      "%s_merl%d_%d" % (label, i, k))
        # four corner towers, stepped so the mass is not symmetrical
        for i, (ca, cs) in enumerate(((0.6, 1.30), (2.0, 1.05), (3.5, 1.22), (5.1, 0.95))):
            kit_spire(x + math.cos(ca) * wall_r, y + math.sin(ca) * wall_r, s * cs,
                      "%s_ctow%d" % (label, i), body_mat="spire_far",
                      roof_mat="roof_rose" if i % 2 else "roof_pink", flag=(i % 2 == 0))
        # gatehouse facing the plaza
        for k in (-1, 1):
            kit_spire(x + k * 190.0 * s, y - wall_r, s * 0.85, "%s_gate%d" % (label, k),
                      body_mat="spire_far", roof_mat="roof_pink", flag=False)
        # the KEEP: a broad drum, a machicolated band, a taller inner tower
        _part("cylinder", x, y, 230.0 * s, 3.6 * s, 3.6 * s, 4.6 * s, "spire_far",
              "%s_keep" % label)
        _part("cylinder", x, y, 470.0 * s, 4.1 * s, 4.1 * s, 0.42 * s, "spire_far",
              "%s_machic" % label)
        for i in range(16):
            a = i * (2.0 * math.pi / 16.0)
            _part("cube", x + math.cos(a) * 195.0 * s, y + math.sin(a) * 195.0 * s,
                  520.0 * s, 0.5 * s, 0.5 * s, 0.62 * s, "spire_far",
                  "%s_kmerl%d" % (label, i))
        kit_spire(x, y, s * 1.85, "%s_donjon" % label, body_mat="spire_far",
                  roof_mat="roof_rose", flag=True)
        # a great dome beside the donjon, so the mass is not all cones
        kit_dome(x - 300.0 * s, y + 210.0 * s, 460.0 * s, 300.0 * s, "%s_dome" % label,
                 mat="spire_far", rib="roof_pink")
        # flanking halls so the base is a MASS, not a stick
        for k, (hx, hy, hs, hr) in enumerate(((-1.0, -0.35, 1.6, 0.0), (1.0, -0.15, 1.9, 0.0),
                                              (-0.55, 0.75, 1.4, 0.0), (0.7, 0.8, 1.5, 0.0))):
            bx, by = x + hx * 380.0 * s, y + hy * 380.0 * s
            _part("cube", bx, by, 120.0 * s, hs * s, hs * 0.7 * s, 2.4 * s, "spire_far",
                  "%s_hall%d" % (label, k))
            _part("cone", bx, by, 330.0 * s, hs * 1.15 * s, hs * 0.85 * s, 1.5 * s,
                  "roof_rose" if k % 2 else "roof_pink", "%s_hallroof%d" % (label, k))

    def kit_teacup(x, y, s, label):
        _part("cylinder", x, y, 8.0 * s, 2.4 * s, 2.4 * s, 0.16 * s, "porcelain", "%s_saucer" % label)
        # A CUP FLARES. One straight cylinder is a mug at best and a tin can at
        # worst; the whole silhouette of fine china is the curve from a narrow
        # foot out to a wide rim. Stacked tapering courses give that curve, and
        # the eye reads the profile long before it reads the decoration.
        for _c in range(7):
            _t = _c / 6.0
            _r = (1.06 + 0.70 * (_t ** 0.72)) * s
            _part("cylinder", x, y, (30.0 + 96.0 * _t) * s, _r, _r, 0.20 * s,
                  "porcelain", "%s_body%d" % (label, _c))
        _part("cylinder", x, y, 140.0 * s, 1.72 * s, 1.72 * s, 0.12 * s, "gold", "%s_rim" % label)
        # GOLD TRIM AND PAINTED ACCENTS. Fine china is banded, footed and
        # decorated; the rim light added with the Fresnel pass supplies the
        # glaze highlight that separates porcelain from plastic.
        _part("cylinder", x, y, 24.0 * s, 1.10 * s, 1.10 * s, 0.14 * s, "gold", "%s_foot" % label)
        _part("cylinder", x, y, 104.0 * s, 1.56 * s, 1.56 * s, 0.05 * s, "gold", "%s_band" % label)
        _part("cylinder", x, y, 12.0 * s, 2.5 * s, 2.5 * s, 0.04 * s, "gold", "%s_saucertrim" % label)
        for _k in range(6):                        # painted rose sprigs
            _a = _k * (2.0 * math.pi / 6.0) + 0.9
            _part("sphere", x + math.cos(_a) * 74.0 * s, y + math.sin(_a) * 74.0 * s,
                  62.0 * s, 0.13 * s, 0.05 * s, 0.13 * s,
                  "rose_pink" if _k % 2 else "petal_violet", "%s_sprig%d" % (label, _k))
            _part("cube", x + math.cos(_a) * 74.0 * s, y + math.sin(_a) * 74.0 * s,
                  50.0 * s, 0.10 * s, 0.03 * s, 0.05 * s, "foliage",
                  "%s_sprigleaf%d" % (label, _k), rot=(0.0, 0.0, math.degrees(_a)))
        # A HANDLE IS A LOOP, and the hole in the middle is the whole read: a
        # solid slab against the cup is a lug, and reads as one from any angle.
        # Short segments around an arc, each rotated tangent, leave real negative
        # space for the light to come through.
        for _h in range(9):
            _ha = -1.30 + (_h / 8.0) * 2.60
            _part("cube", x + (84.0 + math.cos(_ha) * 34.0) * s, y,
                  (86.0 + math.sin(_ha) * 40.0) * s,
                  0.15 * s, 0.13 * s, 0.26 * s, "porcelain",
                  "%s_handle%d" % (label, _h),
                  rot=(0.0, -math.degrees(_ha), 0.0))
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
        # DENSITY IS WHAT MAKES A HEDGE. Eighteen spheres on a heart curve is a
        # dotted outline; a trimmed topiary is a SOLID mass with a crisp edge.
        # Two concentric heart curves plus an inner fill give it body, and the
        # roses go all over rather than every third node.
        n = 40
        for ring, (scale_, depth, mat) in enumerate(((1.0, 0.34, "foliage"),
                                                     (0.80, 0.30, "foliage_hi"),
                                                     (0.58, 0.26, "foliage"))):
            for i in range(n):
                t = (i / float(n)) * 2.0 * math.pi
                hx = 16.0 * math.sin(t) ** 3
                hz = (13.0 * math.cos(t) - 5.0 * math.cos(2 * t)
                      - 2.0 * math.cos(3 * t) - math.cos(4 * t))
                px = cx + hx * 11.0 * s * scale_
                pz = base_z + 170.0 * s + hz * 11.0 * s * scale_
                _part("sphere", px, cy, pz, 0.60 * s, depth * s, 0.60 * s, mat,
                      "%s_h%d_%d" % (label, ring, i))
                if ring == 0 and i % 2 == 0:
                    _part("sphere", px, cy - 20.0 * s, pz, 0.20 * s, 0.20 * s, 0.20 * s,
                          "rose" if i % 3 else "rose_pink", "%s_r%d" % (label, i))
                if ring == 0 and i % 5 == 0:
                    _part("cube", px, cy - 14.0 * s, pz, 0.26 * s, 0.05 * s, 0.30 * s,
                          "leaf" if "leaf" in MATS else "foliage", "%s_lf%d" % (label, i),
                          rot=(0.0, 0.0, float((i * 37) % 90)))
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

    def kit_observatory(x, y, z, label, K=0.60):
        """The Project Brain Observatory: the building that closes the north axis.

        This is the one landmark the hero camera looks directly at, and it was a
        plinth with five spheres balanced on it. A domed observatory gives the
        axis something to arrive at — and the Brain reads better suspended in an
        oculus than floating in open air, because the architecture around it is
        what gives it scale."""
        S = 1.0

        def _p_rail(ax, ay, bx, by, cz, lb):
            railing(x + (ax - x) * K, y + (ay - y) * K,
                    x + (bx - x) * K, y + (by - y) * K, cz * K,
                    "spire", lb, n=3, h=110.0 * K, rail_mat="stone")

        def _p_corn(cx, cy, cz, r, lb):
            cornice(x + (cx - x) * K, y + (cy - y) * K, cz * K,
                    r * K / 50.0, r * K / 50.0, "stone", lb, dentils=16)

        def _p(prim, cx, cy, cz, sx, sy, sz, mat, lb, rot=(0.0, 0.0, 0.0)):
            """Everything below is authored at full size and scaled about the
            building's own footprint. Measured against the hero frame the
            Observatory was 68% of the frame's height and 39% of its width — it
            closed the axis by swallowing the city it was supposed to stand in
            front of."""
            _part(prim, x + (cx - x) * K, y + (cy - y) * K, cz * K,
                  sx * K, sy * K, sz * K, mat, lb, rot)

        # --- stepped stylobate ------------------------------------------
        for k, (rr, hh) in enumerate(((7.4, 0.60), (6.8, 0.56), (6.2, 0.52))):
            _p("cylinder", x, y, 26.0 + k * 52.0, rr * S, rr * S, hh * S,
                  "stone", "%s_step%d" % (label, k))
        base_z = 190.0
        # --- peristyle: sixteen columns, each with base, shaft, capital --
        col_r = 520.0
        for i in range(16):
            a = i * (2.0 * math.pi / 16.0)
            cx, cy = x + math.cos(a) * col_r, y + math.sin(a) * col_r
            _p("cylinder", cx, cy, base_z + 22.0, 0.62, 0.62, 0.44, "stone",
                  "%s_cbase%d" % (label, i))
            _p("cylinder", cx, cy, base_z + 240.0, 0.44, 0.44, 4.0, "spire",
                  "%s_col%d" % (label, i))
            _p("cylinder", cx, cy, base_z + 452.0, 0.60, 0.60, 0.34, "stone",
                  "%s_ccap%d" % (label, i))
        arch_z = base_z + 490.0
        # A BALUSTRADE BETWEEN THE COLUMNS. A peristyle is a colonnade with a
        # low screen wall between its lower drums; without one you see straight
        # through the building and it reads as scaffolding holding up a dome.
        for i in range(16):
            a0 = i * (2.0 * math.pi / 16.0)
            a1 = (i + 1) * (2.0 * math.pi / 16.0)
            _p_rail(x + math.cos(a0) * col_r, y + math.sin(a0) * col_r,
                    x + math.cos(a1) * col_r, y + math.sin(a1) * col_r,
                    base_z + 30.0, "%s_peri%d" % (label, i))
        # --- architrave + frieze ring -----------------------------------
        for i in range(16):
            a = (i + 0.5) * (2.0 * math.pi / 16.0)
            ax, ay = x + math.cos(a) * col_r, y + math.sin(a) * col_r
            _p("cube", ax, ay, arch_z, 2.15, 0.78, 0.42, "stone",
                  "%s_arch%d" % (label, i), rot=(0.0, 0.0, math.degrees(a) + 90.0))
            _p("cube", ax, ay, arch_z + 54.0, 2.05, 0.66, 0.34, "gold",
                  "%s_frieze%d" % (label, i), rot=(0.0, 0.0, math.degrees(a) + 90.0))
        # a moulded cornice where the architrave meets the dome
        _p_corn(x, y, arch_z + 66.0, col_r * 1.10, "%s_cornice" % label)
        dome_z = arch_z + 88.0
        # --- ribbed dome -------------------------------------------------
        R = col_r * 1.02
        for i in range(14):
            a = i * (2.0 * math.pi / 14.0)
            for k in range(7):
                t = (k + 0.5) / 7.0
                ang = t * (math.pi * 0.46)
                rr = R * math.cos(ang)
                zz = dome_z + math.sin(ang) * R * 0.86
                _p("cube", x + math.cos(a) * rr, y + math.sin(a) * rr, zz,
                      0.30, 0.30, 0.46, "spire", "%s_rib%d_%d" % (label, i, k),
                      rot=(0.0, math.degrees(ang), math.degrees(a)))
        # dome shell between the ribs, as three latitude bands
        for b, t in enumerate((0.12, 0.40, 0.68)):
            ang = t * (math.pi * 0.46)
            rr = R * math.cos(ang)
            zz = dome_z + math.sin(ang) * R * 0.86
            for i in range(20):
                a = (i + 0.5) * (2.0 * math.pi / 20.0)
                _p("cube", x + math.cos(a) * rr, y + math.sin(a) * rr, zz,
                      rr / 300.0, 0.42, 0.44, "spire_pink" if b == 1 else "spire",
                      "%s_shell%d_%d" % (label, b, i),
                      rot=(0.0, 0.0, math.degrees(a) + 90.0))
        oc_z = dome_z + R * 0.86
        # --- gold oculus ring -------------------------------------------
        for i in range(18):
            a = i * (2.0 * math.pi / 18.0)
            _p("cube", x + math.cos(a) * 190.0, y + math.sin(a) * 190.0, oc_z,
                  0.72, 0.30, 0.26, "gold", "%s_oc%d" % (label, i),
                  rot=(0.0, 0.0, math.degrees(a) + 90.0))
        # --- THE BRAIN: folded lobes, not a bag of balls ------------------
        bz = oc_z + 230.0
        for hemi in (-1, 1):
            for g in range(4):                      # four gyri per hemisphere
                for k in range(9):
                    t = k / 8.0
                    # a folded ridge: sweeps front-to-back while it undulates
                    ang = -1.15 + t * 2.30
                    fold = math.sin(t * 9.0 + g * 1.7) * 0.24
                    rr = 210.0 * (0.62 + 0.30 * math.cos(ang * 0.9))
                    px = x + hemi * (58.0 + rr * 0.30 * abs(math.sin(ang)))
                    py = y + math.sin(ang) * rr
                    pz = bz + math.cos(ang) * rr * 0.80 + fold * 120.0 + g * 34.0 - 50.0
                    # Bright only on the crown of each fold, so the Brain reads
                    # as a folded structure lit from within rather than as one
                    # even glow — which is what 72 lobes at the bright value is.
                    _crown = (k % 3 == 1) and (g % 2 == 0)
                    _p("sphere", px, py, pz, 0.62, 0.62, 0.62,
                       "magic_cyan" if (_crown or "magic_cyan_d" not in MATS)
                       else "magic_cyan_d",
                       "%s_gyr%d_%d_%d" % (label, hemi, g, k))
        _p("cylinder", x, y, bz - 190.0, 0.5, 0.5, 1.5, "magic_cyan", "%s_stem" % label)
        # --- armillary rings turning around it ---------------------------
        for r_i, (tilt, rad, mat) in enumerate(((0.0, 430.0, "gold"),
                                                (62.0, 380.0, "gold_glow"),
                                                (118.0, 340.0, "gold"))):
            for i in range(22):
                a = i * (2.0 * math.pi / 22.0)
                ux, uy = math.cos(a) * rad, math.sin(a) * rad
                tr = math.radians(tilt)
                py = uy * math.cos(tr)
                pz = uy * math.sin(tr)
                _p("cube", x + ux, y + py, bz + pz, 0.36, 0.13, 0.13, mat,
                      "%s_arm%d_%d" % (label, r_i, i),
                      rot=(tilt, 0.0, math.degrees(a) + 90.0))
        # --- approach: flanking stairs and two obelisks -------------------
        for k in range(4):
            _p("cube", x, y - (620.0 + k * 78.0), 24.0 - k * 5.0,
                  (3.4 - k * 0.22), 0.40, 0.13, "stone", "%s_stair%d" % (label, k))
        for sx in (-1, 1):
            ox = x + sx * 840.0
            _p("cube", ox, y - 520.0, 60.0, 0.80, 0.80, 1.2, "stone", "%s_obb%d" % (label, sx))
            _p("cube", ox, y - 520.0, 340.0, 0.52, 0.52, 4.4, "spire", "%s_ob%d" % (label, sx))
            _p("cone", ox, y - 520.0, 600.0, 0.62, 0.62, 1.1, "gold", "%s_obt%d" % (label, sx))
            finial(x + (ox - x) * K, y + ((y - 520.0) - y) * K, 660.0 * K, 1.5 * K,
                   "gold", "%s_obfin%d" % (label, sx), glow="gold_glow")

    def kit_clock_tower(x, y, s, label):
        """A TOWER. The layout has specified one here from the beginning and the
        dispatcher sent it to kit_clock, which builds a floating clock FACE — so
        for every build so far there has been a disc hanging in the air where a
        tower belongs. Plinth, buttresses, three tapering stages with string
        courses, a belfry with real arched openings, four clock faces, cornice,
        octagonal spire and a weathervane."""
        w0 = 130.0 * s
        # plinth + corbelled buttresses at the corners
        _part("cube", x, y, 34.0 * s, w0 * 1.42 / 50.0, w0 * 1.42 / 50.0, 0.68 * s,
              "stone", "%s_plinth" % label)
        for cx_, cy_ in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
            for k in range(3):
                bw = (0.62 - k * 0.16) * s
                _part("cube", x + cx_ * w0 * 0.86, y + cy_ * w0 * 0.86,
                      (90.0 + k * 150.0) * s, bw, bw, 1.5 * s, "stone",
                      "%s_butt%d%d_%d" % (label, cx_, cy_, k))
        # three tapering stages with a string course between each
        zc = 70.0 * s
        for st, (ww, hh, mat) in enumerate(((1.00, 3.4, "spire"), (0.90, 3.0, "spire"),
                                            (0.82, 2.6, "spire"))):
            _part("cube", x, y, zc + hh * 50.0 * s, w0 * ww / 50.0, w0 * ww / 50.0, hh * s,
                  mat, "%s_stage%d" % (label, st))
            zc += hh * 100.0 * s
            _part("cube", x, y, zc, w0 * (ww + 0.14) / 50.0, w0 * (ww + 0.14) / 50.0, 0.20 * s,
                  "stone", "%s_course%d" % (label, st))
            # a tall lancet window on each face of each stage
            for f in range(4):
                fa = f * (math.pi / 2.0)
                _part("cube", x + math.cos(fa) * w0 * ww * 1.01, y + math.sin(fa) * w0 * ww * 1.01,
                      zc - hh * 52.0 * s, 0.16 * s, 0.30 * s, hh * 0.42 * s, "dog_visor",
                      "%s_lan%d_%d" % (label, st, f), rot=(0.0, math.degrees(fa), 0.0))
        # BELFRY: four openings that are actually arched
        bh = 3.0 * s
        _part("cube", x, y, zc + bh * 50.0 * s, w0 * 0.80 / 50.0, w0 * 0.80 / 50.0, bh * s,
              "spire", "%s_belfry" % label)
        for f in range(4):
            fa = f * (math.pi / 2.0)
            ox, oy = math.cos(fa) * w0 * 0.81, math.sin(fa) * w0 * 0.81
            for k in range(7):
                t = (k + 0.5) / 7.0
                ang = math.pi * t
                ax = math.cos(math.pi - ang) * w0 * 0.34
                az = zc + bh * 62.0 * s + math.sin(ang) * w0 * 0.30
                _part("cube", x + ox - math.sin(fa) * ax, y + oy + math.cos(fa) * ax, az,
                      0.16 * s, 0.16 * s, 0.16 * s, "stone",
                      "%s_barch%d_%d" % (label, f, k), rot=(0.0, math.degrees(fa), 0.0))
            for b in range(3):
                _part("cube", x + ox, y + oy, zc + bh * (26.0 + b * 16.0) * s,
                      0.56 * s, 0.10 * s, 0.10 * s, "trunk",
                      "%s_louvre%d_%d" % (label, f, b), rot=(0.0, math.degrees(fa), 0.0))
        zc += bh * 100.0 * s
        # CLOCK STAGE: four faces
        ch = 2.2 * s
        _part("cube", x, y, zc + ch * 50.0 * s, w0 * 0.86 / 50.0, w0 * 0.86 / 50.0, ch * s,
              "spire_pink", "%s_clockstage" % label)
        fz = zc + ch * 52.0 * s
        for f in range(4):
            fa = f * (math.pi / 2.0)
            nx, ny = math.cos(fa), math.sin(fa)
            ox, oy = nx * w0 * 0.88, ny * w0 * 0.88
            _part("cylinder", x + ox, y + oy, fz, 0.90 * s, 0.90 * s, 0.10 * s, "gold",
                  "%s_case%d" % (label, f), rot=(90.0, math.degrees(fa), 0.0))
            _part("cylinder", x + ox + nx * 6.0 * s, y + oy + ny * 6.0 * s, fz,
                  0.74 * s, 0.74 * s, 0.07 * s, "porcelain", "%s_face%d" % (label, f),
                  rot=(90.0, math.degrees(fa), 0.0))
            for m in range(12):
                ma = m * (2.0 * math.pi / 12.0)
                _part("cube", x + ox + nx * 9.0 * s - ny * math.sin(ma) * 30.0 * s,
                      y + oy + ny * 9.0 * s + nx * math.sin(ma) * 30.0 * s,
                      fz + math.cos(ma) * 30.0 * s,
                      0.06 * s, 0.06 * s, 0.11 * s if m % 3 == 0 else 0.06 * s,
                      "dog_visor", "%s_mk%d_%d" % (label, f, m), rot=(0.0, math.degrees(fa), 0.0))
            # hands, each face at its own hour so the tower reads as ornamental
            _part("cube", x + ox + nx * 11.0 * s, y + oy + ny * 11.0 * s, fz + 12.0 * s,
                  0.05 * s, 0.05 * s, 0.24 * s, "dog_visor", "%s_min%d" % (label, f),
                  rot=(float(f * 24), math.degrees(fa), 0.0))
            _part("cube", x + ox + nx * 11.0 * s - ny * 9.0 * s, y + oy + ny * 11.0 * s + nx * 9.0 * s,
                  fz, 0.18 * s, 0.05 * s, 0.05 * s, "dog_visor", "%s_hr%d" % (label, f),
                  rot=(0.0, math.degrees(fa), 0.0))
            _part("sphere", x + ox + nx * 12.0 * s, y + oy + ny * 12.0 * s, fz,
                  0.10 * s, 0.10 * s, 0.10 * s, "gold_glow", "%s_hub%d" % (label, f))
        zc += ch * 100.0 * s
        # cornice with modillions — now the moulded three-course kind
        cornice(x, y, zc + 8.0 * s, w0 * 1.10 / 50.0, w0 * 1.10 / 50.0,
                "stone", "%s_cornice" % label)
        for m in range(16):
            ma = m * (2.0 * math.pi / 16.0)
            _part("cube", x + math.cos(ma) * w0 * 1.02, y + math.sin(ma) * w0 * 1.02,
                  zc - 6.0 * s, 0.15 * s, 0.15 * s, 0.22 * s, "stone",
                  "%s_mod%d" % (label, m))
        # OCTAGONAL SPIRE
        for f in range(8):
            fa = f * (math.pi / 4.0) + 0.3927
            for k in range(5):
                t = (k + 0.5) / 5.0
                rr = w0 * 0.92 * (1.0 - t)
                _part("cube", x + math.cos(fa) * rr * 0.62, y + math.sin(fa) * rr * 0.62,
                      zc + 40.0 * s + t * 420.0 * s,
                      rr / 90.0 + 0.06, 0.20 * s, 1.0 * s,
                      "roof_rose" if f % 2 else "roof_pink",
                      "%s_sp%d_%d" % (label, f, k), rot=(0.0, 0.0, math.degrees(fa)))
        _part("cylinder", x, y, zc + 500.0 * s, 0.18 * s, 0.18 * s, 0.9 * s, "gold",
              "%s_finpole" % label)
        finial(x, y, zc + 545.0 * s, s * 1.4, "gold", "%s_fin" % label, glow="gold_glow")
        # a railed gallery around the belfry, which is what a belfry has
        for _q in range(4):
            _a0 = _q * (math.pi / 2.0) + 0.785
            _a1 = (_q + 1) * (math.pi / 2.0) + 0.785
            railing(x + math.cos(_a0) * w0 * 1.02, y + math.sin(_a0) * w0 * 1.02,
                    x + math.cos(_a1) * w0 * 1.02, y + math.sin(_a1) * w0 * 1.02,
                    zc - 34.0 * s, "stone", "%s_gallery%d" % (label, _q), n=4, h=42.0 * s)
        # weathervane
        _part("cube", x, y, zc + 610.0 * s, 1.05 * s, 0.05 * s, 0.05 * s, "gold",
              "%s_vane" % label, rot=(0.0, 0.0, 34.0))
        _part("cone", x + 46.0 * s, y + 31.0 * s, zc + 610.0 * s, 0.22 * s, 0.22 * s, 0.34 * s,
              "gold", "%s_vanetip" % label, rot=(0.0, 90.0, 34.0))
        # ivy and a door at the foot, so it is planted rather than dropped
        for k in range(10):
            t = k / 9.0
            a = t * 6.6
            _part("sphere", x + math.cos(a) * w0 * 1.06, y + math.sin(a) * w0 * 1.06,
                  40.0 * s + t * 520.0 * s, 0.30 * s, 0.30 * s, 0.30 * s,
                  "foliage" if k % 2 else "foliage_hi", "%s_ivy%d" % (label, k))
        _part("cube", x, y - w0 * 1.03, 105.0 * s, 0.50 * s, 0.12 * s, 1.6 * s, "trunk",
              "%s_door" % label)
        _part("sphere", x + 14.0 * s, y - w0 * 1.10, 105.0 * s, 0.07 * s, 0.07 * s, 0.07 * s,
              "gold", "%s_knob" % label)

    def kit_bench(x, y, yaw, label):
        """A garden bench. The placeholder was one cube, and bench_arrival sits
        ten metres from the hero camera — so the placeholder was a prominent
        white box in the most important frame in the world."""
        ry = math.radians(yaw)
        fx, fy = math.cos(ry), math.sin(ry)          # forward
        sx, sy = -fy, fx                             # sideways along the seat
        for e in (-1, 1):
            ex, ey = x + sx * 78.0 * e, y + sy * 78.0 * e
            for lz, lo in ((21.0, 0.42), (21.0, -0.42)):
                _part("cube", ex + fx * lo * 60.0, ey + fy * lo * 60.0, lz,
                      0.13, 0.13, 0.42, "trunk", "%s_leg%d_%d" % (label, e, int(lo * 10)))
            _part("cube", ex, ey, 45.0, 0.62, 0.14, 0.10, "trunk",
                  "%s_rail%d" % (label, e), rot=(0.0, 0.0, yaw))
            # arm rest
            _part("cube", ex, ey, 62.0, 0.66, 0.11, 0.09, "trunk",
                  "%s_arm%d" % (label, e), rot=(0.0, 0.0, yaw))
            _part("cube", ex + fx * 26.0, ey + fy * 26.0, 54.0, 0.10, 0.10, 0.28, "trunk",
                  "%s_armpost%d" % (label, e), rot=(0.0, 0.0, yaw))
        for k in range(4):                            # seat slats
            off = (k - 1.5) * 17.0
            _part("cube", x + fx * off, y + fy * off, 50.0, 1.62, 0.14, 0.055, "trunk",
                  "%s_seat%d" % (label, k), rot=(0.0, 0.0, yaw))
        for k in range(3):                            # back slats, leaning back
            _part("cube", x - fx * 32.0, y - fy * 32.0, 74.0 + k * 20.0, 1.62, 0.10, 0.10,
                  "trunk", "%s_back%d" % (label, k), rot=(0.0, -12.0, yaw))
        for e in (-1, 1):                             # back uprights
            _part("cube", x + sx * 74.0 * e - fx * 30.0, y + sy * 74.0 * e - fy * 30.0,
                  74.0, 0.12, 0.12, 0.80, "trunk", "%s_up%d" % (label, e),
                  rot=(0.0, -12.0, yaw))

    def kit_card_pedestal(x, y, s, label):
        """The C.A.R.D. pedestal: the Agent Garden's focus. A garden destination
        needs something to be about, and this one was about a pergola."""
        _part("cylinder", x, y, 22.0 * s, 1.5 * s, 1.5 * s, 0.44 * s, "stone", "%s_step" % label)
        _part("cylinder", x, y, 60.0 * s, 1.05 * s, 1.05 * s, 0.36 * s, "stone", "%s_base" % label)
        _part("cylinder", x, y, 150.0 * s, 0.62 * s, 0.62 * s, 1.5 * s, "spire", "%s_col" % label)
        for k in range(8):                                  # fluting
            a = k * (2.0 * math.pi / 8.0)
            _part("cube", x + math.cos(a) * 29.0 * s, y + math.sin(a) * 29.0 * s, 150.0 * s,
                  0.07 * s, 0.07 * s, 1.4 * s, "brass_deep" if "brass_deep" in MATS else "gold",
                  "%s_fl%d" % (label, k))
        _part("cylinder", x, y, 232.0 * s, 0.95 * s, 0.95 * s, 0.22 * s, "gold", "%s_cap" % label)
        # the card itself, standing on edge above the plinth, haloed
        _part("cube", x, y, 330.0 * s, 0.66 * s, 0.07 * s, 0.96 * s, "porcelain", "%s_card" % label,
              rot=(0.0, 0.0, 22.0))
        _part("cube", x, y, 330.0 * s, 0.72 * s, 0.05 * s, 1.02 * s, "gold", "%s_cardtrim" % label,
              rot=(0.0, 0.0, 22.0))
        for e in (-1, 1):
            _part("sphere", x + e * 13.0 * s, y - 6.0 * s, 348.0 * s, 0.17 * s, 0.05 * s, 0.17 * s,
                  "rose", "%s_pip%d" % (label, e))
        _part("cube", x, y - 6.0 * s, 322.0 * s, 0.22 * s, 0.05 * s, 0.22 * s, "rose",
              "%s_pippt" % label, rot=(0.0, 0.0, 45.0))
        for k in range(16):                                  # halo of glyphs
            a = k * (2.0 * math.pi / 16.0)
            _part("sphere", x + math.cos(a) * 118.0 * s, y + math.sin(a) * 118.0 * s,
                  336.0 * s + math.sin(k * 1.3) * 26.0 * s,
                  0.09 * s, 0.09 * s, 0.09 * s, "arcane", "%s_halo%d" % (label, k))

    def kit_belvedere(x, y, s, label):
        """Four columns and a canopy: the Mission Overlook's own silhouette. An
        overlook is a place you stand under something and look out from."""
        for i, (cx_, cy_) in enumerate(((-1, -1), (-1, 1), (1, -1), (1, 1))):
            px, py = x + cx_ * 150.0 * s, y + cy_ * 150.0 * s
            _part("cylinder", px, py, 22.0 * s, 0.52 * s, 0.52 * s, 0.44 * s, "stone",
                  "%s_cb%d" % (label, i))
            _part("cylinder", px, py, 200.0 * s, 0.34 * s, 0.34 * s, 3.2 * s, "stone",
                  "%s_col%d" % (label, i))
            _part("cylinder", px, py, 370.0 * s, 0.48 * s, 0.48 * s, 0.28 * s, "stone",
                  "%s_cc%d" % (label, i))
        for e in range(4):                                    # architrave
            ea = e * (math.pi / 2.0)
            _part("cube", x + math.cos(ea) * 150.0 * s, y + math.sin(ea) * 150.0 * s, 396.0 * s,
                  3.1 * s, 0.36 * s, 0.30 * s, "stone", "%s_arch%d" % (label, e),
                  rot=(0.0, 0.0, math.degrees(ea) + 90.0))
        # warm stone and a rose roof, so it is not a second white building
        # standing next to the Observatory and merging with it
        kit_dome(x, y, 410.0 * s, 178.0 * s, "%s_dome" % label, mat="roof_rose", rib="gold")
        # a real telescope on a tripod, pointed out over the plaza
        _part("cylinder", x + 90.0 * s, y - 90.0 * s, 60.0 * s, 0.10 * s, 0.10 * s, 1.2 * s,
              "gold", "%s_tripod" % label)
        for t in range(3):
            ta = t * (2.0 * math.pi / 3.0)
            _part("cylinder", x + 90.0 * s + math.cos(ta) * 26.0 * s,
                  y - 90.0 * s + math.sin(ta) * 26.0 * s, 34.0 * s,
                  0.05 * s, 0.05 * s, 0.72 * s, "gold", "%s_leg%d" % (label, t),
                  rot=(float(16), math.degrees(ta), 0.0))
        _part("cylinder", x + 90.0 * s, y - 90.0 * s, 132.0 * s, 0.20 * s, 0.20 * s, 1.05 * s,
              "gold", "%s_tube" % label, rot=(38.0, 0.0, 0.0))
        _part("cylinder", x + 90.0 * s, y - 128.0 * s, 96.0 * s, 0.26 * s, 0.26 * s, 0.22 * s,
              "brass_deep" if "brass_deep" in MATS else "gold", "%s_lens" % label, rot=(38.0, 0.0, 0.0))
        _part("cylinder", x + 90.0 * s, y - 56.0 * s, 168.0 * s, 0.14 * s, 0.14 * s, 0.20 * s,
              "crystal", "%s_eyep" % label, rot=(38.0, 0.0, 0.0))

    def kit_townhouse(x, y, yaw, s, label, body="spire", roof="roof_rose"):
        """An ornate townhouse: plinth, shopfront with an awning, a jettied upper
        storey, a balcony with balusters and flower boxes, shutters, a steep roof
        with dormers, a chimney and a lantern by the door.

        The reference's density is not foliage, it is BUILDING — close enough to
        read its trim. A block of these behind the garden is the step the
        composition was missing between planting and skyline."""
        if in_camera_lap(x, y, 400.0):
            return

        ca, sa = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))

        def P(prim, ox, oy, oz, sx, sy, sz, mat, lb, rot=(0.0, 0.0, 0.0)):
            # Place in the house's own frame so the whole thing can be rotated —
            # and scale the HORIZONTAL offsets too. Scaling the parts and the
            # heights but not the plan is a non-uniform scale of an assembly:
            # at s=1.25 the body got 25% wider while its balcony, dormers and
            # awning stayed where they were, so every house but the smallest
            # came apart. Caught reviewing my own pass, not by a test.
            wx = x + (ox * ca - oy * sa) * s
            wy = y + (ox * sa + oy * ca) * s
            _part(prim, wx, wy, oz * s, sx * s, sy * s, sz * s, mat, "%s_%s" % (label, lb),
                  rot=(rot[0], rot[1] + yaw, rot[2]))

        W_, D_ = 2.10, 1.55
        P("cube", 0, 0, 26.0, W_ * 1.06, D_ * 1.06, 0.52, "stone", "plinth")
        P("cube", 0, 0, 150.0, W_, D_, 2.4, body, "ground_floor")
        # shopfront: dark timber frame, glazing, and an awning over it
        P("cube", 0, -D_ * 50.0 - 4.0, 130.0, W_ * 0.82, 0.10, 1.7, "trunk", "shopfront")
        P("cube", 0, -D_ * 50.0 - 8.0, 140.0, W_ * 0.68, 0.06, 1.3, "dog_visor", "glazing")
        for _a in range(5):
            P("cube", (_a - 2) * 34.0, -D_ * 50.0 - 26.0, 232.0, 0.34, 0.62, 0.10,
              "rose" if _a % 2 else "porcelain", "awning%d" % _a, rot=(-26.0, 0.0, 0.0))
        P("cube", W_ * 34.0, -D_ * 50.0 - 6.0, 118.0, 0.34, 0.08, 1.5, "trunk", "door")
        P("sphere", W_ * 34.0 + 12.0, -D_ * 50.0 - 14.0, 210.0, 0.16, 0.16, 0.20,
          "lamp_glass" if "lamp_glass" in MATS else "magic_gold", "doorlamp")
        # jettied upper storey, wider than the floor below — the overhang is what
        # makes a street of these read as old and built rather than extruded
        P("cube", 0, 0, 330.0, W_ * 1.12, D_ * 1.12, 1.9, body, "upper")
        P("cube", 0, 0, 246.0, W_ * 1.16, D_ * 1.16, 0.20, "trunk", "jetty")
        for _w in range(3):
            ox = (_w - 1) * 62.0
            # world-space, because the ornament vocabulary works in world space
            # and a house may be rotated; P() exists only to spare doing this by
            # hand for the dozens of parts that need no yaw of their own
            _wx = x + (ox * ca - (-D_ * 56.0) * sa) * s
            _wy = y + (ox * sa + (-D_ * 56.0) * ca) * s
            window(_wx, _wy, 350.0 * s, 0.40 * s, 0.62 * s, yaw + 90.0,
                   "stone" if "stone" in MATS else body, "%s_win%d" % (label, _w))
            for _sh in (-1, 1):
                P("cube", ox + _sh * 30.0, -D_ * 57.0, 350.0, 0.16, 0.05, 0.64,
                  "spire_blue" if _w % 2 else "spire_teal", "shutter%d_%d" % (_w, _sh))
        # balcony with balusters and flower boxes
        P("cube", 0, -D_ * 58.0, 288.0, W_ * 1.06, 0.34, 0.10, "stone", "balcony")
        # a real balustrade rather than seven bare pins
        _bx0 = x + (-W_ * 52.0 * ca - (-D_ * 58.0) * sa) * s
        _by0 = y + (-W_ * 52.0 * sa + (-D_ * 58.0) * ca) * s
        _bx1 = x + (W_ * 52.0 * ca - (-D_ * 58.0) * sa) * s
        _by1 = y + (W_ * 52.0 * sa + (-D_ * 58.0) * ca) * s
        railing(_bx0, _by0, _bx1, _by1, 293.0 * s, "porcelain",
                "%s_balustrade" % label, n=7, h=34.0 * s, rail_mat="stone")
        P("cube", 0, -D_ * 60.0, 300.0, W_ * 0.98, 0.16, 0.16, "trunk", "flowerbox")
        for _f in range(6):
            P("sphere", (_f - 2.5) * 32.0, -D_ * 62.0, 320.0, 0.15, 0.15, 0.14,
              ("rose", "petal_violet", "petal_pink", "rose_pink")[_f % 4], "bloom%d" % _f)
        # steep roof, dormers, ridge, chimney
        cornice(x, y, 424.0 * s, W_ * 1.14 * s, D_ * 1.14 * s, "stone",
                "%s_cornice" % label, yaw=yaw)
        P("cone", 0, 0, 500.0, W_ * 1.30, D_ * 1.30, 1.7, roof, "roof")
        for _d in (-1, 1):
            P("cube", _d * 48.0, -D_ * 34.0, 452.0, 0.34, 0.34, 0.44, body, "dormer%d" % _d)
            P("cone", _d * 48.0, -D_ * 34.0, 498.0, 0.46, 0.46, 0.40, roof, "dormerroof%d" % _d)
            P("cube", _d * 48.0, -D_ * 42.0, 452.0, 0.20, 0.05, 0.24, "dog_visor",
              "dormerwin%d" % _d)
        P("cube", W_ * 30.0, D_ * 26.0, 560.0, 0.26, 0.26, 1.1, "stone", "chimney")
        P("cube", W_ * 30.0, D_ * 26.0, 618.0, 0.34, 0.34, 0.12, "brass_deep"
          if "brass_deep" in MATS else "stone", "chimneycap")
        # ivy up one flank, so the row is planted rather than dropped
        for _v in range(6):
            _t = _v / 5.0
            P("sphere", -W_ * 52.0, -D_ * 20.0 + math.sin(_t * 5.0) * 18.0,
              40.0 + _t * 420.0, 0.26, 0.26, 0.26,
              "foliage" if _v % 2 else "foliage_hi", "ivy%d" % _v)

    def kit_dome(x, y, z, r, label, mat="spire", rib="gold"):
        """A ribbed dome. The skyline reference is not all cones."""
        for i in range(10):
            a = i * (2.0 * math.pi / 10.0)
            for k in range(5):
                t = (k + 0.5) / 5.0
                ang = t * (math.pi * 0.48)
                rr = r * math.cos(ang)
                _part("cube", x + math.cos(a) * rr, y + math.sin(a) * rr,
                      z + math.sin(ang) * r * 0.90,
                      r / 300.0, r / 320.0, r / 190.0, mat,
                      "%s_dm%d_%d" % (label, i, k), rot=(0.0, math.degrees(ang), math.degrees(a)))
            _part("cube", x + math.cos(a) * r * 0.72, y + math.sin(a) * r * 0.72,
                  z + r * 0.58, r / 420.0, r / 420.0, r / 130.0, rib,
                  "%s_rib%d" % (label, i), rot=(0.0, 42.0, math.degrees(a)))
        _part("cylinder", x, y, z + r * 0.94, r / 190.0, r / 190.0, r / 260.0, rib,
              "%s_drum" % label)
        _part("cone", x, y, z + r * 1.16, r / 150.0, r / 150.0, r / 130.0, rib, "%s_tip" % label)

    def kit_towerblock(x, y, s, label, body="spire_far", roof="roof_pink"):
        """Four to six towers on a shared podium, linked by bridges, one domed.

        A ring of single spires reads as chess pieces on a board. A city reads as
        a city because its towers OVERLAP — near ones cutting across far ones,
        roofs at different heights, walls and bridges tying the mass together."""
        # podium the whole block stands on
        _part("cube", x, y, 90.0 * s, 5.4 * s, 4.4 * s, 1.8 * s, body, "%s_pod" % label,
              rot=(0.0, 0.0, float((int(x) * 7) % 40) - 20.0))
        placed = []
        n = 4 + (int(abs(x) + abs(y)) % 3)
        for i in range(n):
            a = i * 2.39996 + (x + y) * 0.0001
            rr = (60.0 + 150.0 * ((i * 13) % 4) / 4.0) * s
            tx, ty = x + math.cos(a) * rr, y + math.sin(a) * rr
            ts = s * (0.62 + 0.52 * ((i * 7) % 5) / 5.0)
            if i == 1:
                # one domed hall instead of a spire, for silhouette variety
                _part("cylinder", tx, ty, 190.0 * ts, 2.3 * ts, 2.3 * ts, 3.4 * ts, body,
                      "%s_hall%d" % (label, i))
                kit_dome(tx, ty, 360.0 * ts, 220.0 * ts, "%s_dome%d" % (label, i),
                         mat=body, rib=roof)
            else:
                kit_spire(tx, ty, ts, "%s_t%d" % (label, i), body_mat=body,
                          roof_mat=roof if i % 2 else "roof_rose", flag=(i == 0))
            placed.append((tx, ty, ts))
        # BRIDGES between the first pairs of towers: the strongest "city" cue
        for i in range(len(placed) - 1):
            ax, ay, asz = placed[i]
            bx, by, bsz = placed[i + 1]
            mx, my = (ax + bx) * 0.5, (ay + by) * 0.5
            dx, dy = bx - ax, by - ay
            ln = math.hypot(dx, dy)
            if ln < 1.0 or i > 1:
                continue
            yaw = math.degrees(math.atan2(dy, dx))
            bz = 300.0 * min(asz, bsz)
            _part("cube", mx, my, bz, ln / 200.0, 0.30 * s, 0.22 * s, body,
                  "%s_br%d" % (label, i), rot=(0.0, 0.0, yaw))
            for k in range(5):                       # bridge arcade
                t = (k + 0.5) / 5.0
                _part("cube", ax + dx * t, ay + dy * t, bz + 34.0 * s,
                      0.16 * s, 0.16 * s, 0.30 * s, body, "%s_brp%d_%d" % (label, i, k))
        # a curtain of low roofs filling the gaps between the towers
        for k in range(6):
            a = k * (2.0 * math.pi / 6.0) + 0.5
            rx, ry = x + math.cos(a) * 210.0 * s, y + math.sin(a) * 210.0 * s
            hh = (60.0 + 40.0 * ((k * 5) % 3)) * s
            _part("cube", rx, ry, hh * 0.5 + 90.0 * s, 1.5 * s, 1.1 * s, hh / 100.0, body,
                  "%s_low%d" % (label, k), rot=(0.0, 0.0, math.degrees(a)))
            _part("cone", rx, ry, hh + 130.0 * s, 1.8 * s, 1.35 * s, 1.0 * s,
                  "roof_rose" if k % 2 else roof, "%s_lowr%d" % (label, k),
                  rot=(0.0, 0.0, math.degrees(a)))

    def kit_bed(cx, cy, r, label, palette=("petal_violet", "rose_pink", "petal_pink")):
        """A landscaped garden bed with a RAISED STONE BORDER. The addendum asks
        for exactly this: planting held inside a kerb rather than scattered onto
        open lawn, which is the difference between a garden and a field."""
        n = max(10, int(r / 26.0))
        for i in range(n):
            a = i * (2.0 * math.pi / n)
            _part("cube", cx + math.cos(a) * r, cy + math.sin(a) * r, 17.0,
                  (2.0 * math.pi * r / n) / 88.0, 0.30, 0.34, "stone",
                  "%s_kerb%d" % (label, i), rot=(0.0, 0.0, math.degrees(a) + 90.0))
            if i % 3 == 0:                            # moss where kerb meets soil
                _part("sphere", cx + math.cos(a) * (r - 22.0), cy + math.sin(a) * (r - 22.0),
                      8.0, 0.22, 0.22, 0.07, "moss", "%s_moss%d" % (label, i))
        # soil, then dense planting inside it
        _part("cylinder", cx, cy, 12.0, r / 47.0, r / 47.0, 0.20, "trunk", "%s_soil" % label)
        cnt = max(9, int((r * r) / 1400.0))
        for i in range(cnt):
            a = i * 2.39996
            rr = r * 0.86 * math.sqrt((i + 0.5) / cnt)
            px, py = cx + math.cos(a) * rr, cy + math.sin(a) * rr
            hh = 26.0 + (i % 4) * 13.0
            _part("cylinder", px, py, 20.0 + hh * 0.5, 0.05, 0.05, hh / 100.0,
                  "foliage_deep" if i % 3 else "foliage", "%s_stem%d" % (label, i))
            _part("sphere", px, py, 24.0 + hh, 0.22, 0.22, 0.20,
                  palette[i % len(palette)], "%s_bloom%d" % (label, i))
            if i % 5 == 0:
                _part("sphere", px + 9.0, py - 7.0, 20.0, 0.26, 0.26, 0.12,
                      "foliage_spr", "%s_leaf%d" % (label, i))

    def kit_root(x, y, ang, length, thick, label):
        """A buttress root: an arc that leaves the trunk high, dips, and enters
        the ground. Roots breaking the surface are what stop a big tree looking
        like a cylinder standing on a lawn."""
        segs = 8
        for k in range(segs):
            t = (k + 0.5) / segs
            rr = length * t
            zz = thick * 140.0 * (1.0 - t) ** 1.7 + 6.0
            th = thick * (1.0 - 0.62 * t)
            _part("sphere", x + math.cos(ang) * rr, y + math.sin(ang) * rr, zz,
                  th * 1.5, th, th * 1.1, "trunk", "%s_r%d" % (label, k),
                  rot=(0.0, 0.0, math.degrees(ang)))
            if k % 3 == 1:                             # moss on the shaded side
                _part("sphere", x + math.cos(ang) * rr, y + math.sin(ang) * rr, zz + th * 40.0,
                      th * 0.8, th * 0.7, th * 0.3, "moss", "%s_m%d" % (label, k))

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
        # A MORTAR BED UNDER THE SETTS. Stones bedded in mortar is the correct
        # construction and this is one actor, so it stays — but the reason I
        # added it turned out to be WRONG and the comment should say so rather
        # than repeat it. I expected the irregularity pass (tiles shrunk to
        # 0.86-0.99 and nudged up to 8 uu off grid) to open gaps down to the
        # grass plane. Measuring the frame before and after, paving and lawn
        # coverage were unchanged: the gaps are too small to resolve from the
        # hero camera. Cheap insurance for a closer view, not a fix.
        _part("cylinder", x, y, 1.6, 13.4, 13.4, 0.04,
              "stone" if "stone" in MATS else "plaza", "PlazaBed")
        stones = ("cobble", "cobble2", "plaza")
        for gx in range(-6, 7):
            for gy in range(-6, 7):
                hsh = (gx * 73856093) ^ (gy * 19349663)
                mat = stones[hsh % 3]
                # IRREGULARITY IS THE WHOLE READ. Identical size, height and
                # rotation on every tile is a grid, and a grid is lino. Jittering
                # all three — and letting the gaps widen unevenly — is what makes
                # it laid stone. The offsets are hash-derived so a rebuild lays
                # the exact same courtyard.
                jz = 3.0 + (hsh % 5) * 0.6
                shrink = 0.86 + ((hsh >> 3) % 9) * 0.014
                yaw = ((hsh >> 7) % 9) - 4.0
                ox = (((hsh >> 11) % 7) - 3) * 2.6
                oy = (((hsh >> 15) % 7) - 3) * 2.6
                _part("cube", x + gx * tile + ox, y + gy * tile + oy, jz,
                      tile / 100.0 * shrink, tile / 100.0 * shrink, 0.055 + (hsh % 3) * 0.012,
                      mat, "Tile%d_%d" % (gx, gy), rot=(0.0, 0.0, yaw))
                # moss in roughly half the joints, in clumps rather than dots
                if hsh % 2 == 0:
                    for m in range(2 + (hsh % 3)):
                        _part("sphere",
                              x + gx * tile + ox + (((hsh >> (m + 2)) % 11) - 5) * 12.0,
                              y + gy * tile + oy + (((hsh >> (m + 5)) % 11) - 5) * 12.0,
                              5.5, 0.20 + (m % 3) * 0.07, 0.20 + (m % 3) * 0.07, 0.07,
                              "moss", "Moss%d_%d_%d" % (gx, gy, m))
        # Many THIN concentric rings rather than six fat bands: the reference's
        # circle reads as engraved light, and thickness is what made ours read
        # as painted vinyl.
        rings = [(9.0, 6.4, "arcane"), (9.6, 6.05, "plaza"), (10.2, 5.7, "arcane"),
                 (10.8, 5.45, "plaza"), (12.0, 5.1, "arcane"), (12.6, 4.85, "plaza"),
                 (14.0, 4.3, "arcane"), (14.6, 4.05, "plaza"), (16.0, 3.4, "arcane"),
                 (16.6, 3.15, "plaza"), (18.0, 2.5, "arcane"), (18.6, 2.25, "plaza"),
                 (20.0, 1.5, "arcane")]
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
        # DRIFTING CROSS-SPARKS. Small emissive plus-signs hovering over the
        # ring, on the Bob world-position-offset so they rise and fall. In the
        # reference these are what make the circle feel ALIVE rather than
        # printed on the stone.
        for i in range(26):
            a = i * 2.39996
            rr = 90.0 + 240.0 * (((i * 29) % 11) / 11.0)
            sx, sy = x + math.cos(a) * rr, y + math.sin(a) * rr
            sz = 26.0 + 66.0 * (((i * 17) % 7) / 7.0)
            _part("cube", sx, sy, sz, 0.22, 0.05, 0.05, "arcane", "Spark%dH" % i)
            _part("cube", sx, sy, sz, 0.05, 0.05, 0.22, "arcane", "Spark%dV" % i)
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
        """Floating ornate clock. The case was one gold disc behind the face; a
        real clock case has a bezel that PROJECTS, a moulded surround and a
        crown, which is what makes it read as an object rather than a decal."""
        for _b, (_r, _d) in enumerate(((1.62, 0.10), (1.54, 0.14), (1.44, 0.18))):
            _part("cylinder", x, y + _b * 4.0, z, _r, _d, _r,
                  "gold" if _b % 2 == 0 else ("brass_deep" if "brass_deep" in MATS else "gold"),
                  "%s_bezel%d" % (label, _b), rot=(90, 0, 0))
        for _k in range(12):
            _a = _k * (2.0 * math.pi / 12.0)
            _part("sphere", x + math.sin(_a) * 148.0, y + 6.0, z + math.cos(_a) * 148.0,
                  0.10, 0.06, 0.10, "gold", "%s_stud%d" % (label, _k))
        finial(x, y - 4.0, z + 158.0, 0.66, "gold", "%s_crown" % label, glow="gold_glow")
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
        # A SPOUT CURVES and a handle LOOPS. Straight cylinder plus solid slab
        # is the pot every prototype has; the S of the spout and the hole in the
        # handle are what make it porcelain rather than blocking-out.
        for _sp in range(6):
            _t = _sp / 5.0
            _part("cylinder", x + 62.0 + _t * 58.0, y,
                  z - 6.0 + math.sin(_t * 1.9) * 46.0,
                  0.24 - _t * 0.10, 0.24 - _t * 0.10, 0.22, "porcelain",
                  "%s_spout%d" % (label, _sp), rot=(0.0, 62.0 - _t * 34.0, 0.0))
        for _h in range(9):
            _ha = -1.35 + (_h / 8.0) * 2.70
            _part("cube", x - 68.0 - math.cos(_ha) * 30.0, y,
                  z + 6.0 + math.sin(_ha) * 44.0,
                  0.15, 0.14, 0.26, "porcelain", "%s_handle%d" % (label, _h),
                  rot=(0.0, math.degrees(_ha), 0.0))
        _part("cylinder", x, y, z + 66, 0.7, 0.7, 0.16, "gold", "%s_lid" % label)
        _part("cylinder", x, y, z - 58, 1.05, 1.05, 0.12, "gold", "%s_foot" % label)
        _part("cylinder", x, y, z + 34, 1.52, 1.52, 0.05, "gold", "%s_band" % label)
        for _k in range(5):
            _a = _k * (2.0 * math.pi / 5.0) + 0.4
            _part("sphere", x + math.cos(_a) * 128.0, y + math.sin(_a) * 128.0, z + 4,
                  0.17, 0.06, 0.17, "rose" if _k % 2 else "petal_violet",
                  "%s_sprig%d" % (label, _k))
        _part("sphere", x, y, z + 84, 0.3, 0.3, 0.3, "gold_glow", "%s_knob" % label)

    def kit_fountain(x, y, label):
        """A real fountain. The old one was five stacked cylinders, which is a
        cake stand. Water is the only reason to build a fountain: this one has a
        masonry basin with a carved rim, jets that ARC, spray where they land,
        lilies on the water and a heart-shaped upper bowl."""
        # octagonal masonry basin
        for i in range(16):
            a = i * (2.0 * math.pi / 16.0)
            _part("cube", x + math.cos(a) * 385.0, y + math.sin(a) * 385.0, 34.0,
                  1.60, 0.62, 0.68, "stone", "%s_wall%d" % (label, i),
                  rot=(0.0, 0.0, math.degrees(a) + 90.0))
            _part("cube", x + math.cos(a) * 385.0, y + math.sin(a) * 385.0, 72.0,
                  1.66, 0.80, 0.16, "stone", "%s_rim%d" % (label, i),
                  rot=(0.0, 0.0, math.degrees(a) + 90.0))
            if i % 2 == 0:                                  # carved rosettes
                _part("sphere", x + math.cos(a) * 400.0, y + math.sin(a) * 400.0, 50.0,
                      0.20, 0.12, 0.20, "gold", "%s_ros%d" % (label, i))
        _part("cylinder", x, y, 58.0, 3.62, 3.62, 0.16, "water", "%s_pool" % label)
        # lily pads and blooms on the water
        for i in range(9):
            a = i * 2.39996
            r = 120.0 + 190.0 * ((i * 7) % 5) / 5.0
            lx, ly = x + math.cos(a) * r, y + math.sin(a) * r
            _part("cylinder", lx, ly, 64.0, 0.42, 0.42, 0.02, "foliage_hi", "%s_pad%d" % (label, i))
            if i % 3 == 0:
                _part("sphere", lx + 12.0, ly, 72.0, 0.13, 0.13, 0.12, "petal_pink",
                      "%s_lily%d" % (label, i))
        # pedestal, then the heart bowl
        _part("cylinder", x, y, 120.0, 0.86, 0.86, 1.1, "stone", "%s_ped" % label)
        _part("cylinder", x, y, 182.0, 1.30, 1.30, 0.22, "stone", "%s_pedcap" % label)
        for i in range(22):
            t = (i / 22.0) * 2.0 * math.pi
            hx = 16.0 * math.sin(t) ** 3
            hz = 13.0 * math.cos(t) - 5.0 * math.cos(2 * t) - 2.0 * math.cos(3 * t) - math.cos(4 * t)
            _part("sphere", x + hx * 6.4, y + hz * 6.4, 236.0, 0.24, 0.24, 0.14, "gold",
                  "%s_heart%d" % (label, i))
        _part("cylinder", x, y, 232.0, 1.05, 1.05, 0.10, "water", "%s_bowl" % label)
        # JETS. Eight arcs of shrinking beads leaving the bowl and falling to the
        # pool — the shape of moving water is the whole read.
        for j in range(8):
            a = j * (2.0 * math.pi / 8.0)
            for k in range(9):
                t = k / 8.0
                rr = 40.0 + t * 300.0
                zz = 250.0 + math.sin(t * math.pi) * 150.0 - t * t * 120.0
                _part("sphere", x + math.cos(a) * rr, y + math.sin(a) * rr, zz,
                      (0.14 - 0.07 * t), (0.14 - 0.07 * t), (0.14 - 0.07 * t),
                      "spray" if "spray" in MATS else "porcelain",
                      "%s_jet%d_%d" % (label, j, k))
            # spray where the arc lands, and a ring of it spreading on the pool
            _part("sphere", x + math.cos(a) * 340.0, y + math.sin(a) * 340.0, 74.0,
                  0.30, 0.30, 0.12, "spray" if "spray" in MATS else "porcelain",
                  "%s_spray%d" % (label, j))
            for _f in range(3):
                _fr = 300.0 + _f * 26.0
                _part("cylinder", x + math.cos(a) * _fr, y + math.sin(a) * _fr, 66.0,
                      0.20 - 0.04 * _f, 0.20 - 0.04 * _f, 0.02,
                      "spray" if "spray" in MATS else "porcelain",
                      "%s_foam%d_%d" % (label, j, _f))
        _part("cylinder", x, y, 268.0, 0.16, 0.16, 0.30, "gold", "%s_nozzle" % label)
        _part("sphere", x, y, 300.0, 0.30, 0.30, 0.30, "gold_glow", "%s_finial" % label)

    def kit_arcane_ring(x, y, s, label):
        """A compact violet arcane circle. The hero Dog stands on the big one at
        the world origin; bringing the Dog forward into the founder's frame took
        it off its own identity, so the ring travels with it."""
        rings = [(6.2, "arcane"), (5.9, "plaza"), (5.2, "arcane"), (4.9, "plaza"),
                 (4.0, "arcane"), (3.7, "plaza"), (2.6, "arcane")]
        for k, (rr, mat) in enumerate(rings):
            _part("cylinder", x, y, 6.0 + k * 0.5, rr * s, rr * s, 0.035, mat,
                  "%s_ring%d" % (label, k))
        for i in range(12):
            a = i * (2.0 * math.pi / 12.0)
            _part("cube", x + math.cos(a) * 265.0 * s, y + math.sin(a) * 265.0 * s, 8.0,
                  0.62 * s, 0.10 * s, 0.03, "arcane", "%s_spoke%d" % (label, i),
                  rot=(0.0, 0.0, math.degrees(a)))
            _part("sphere", x + math.cos(a) * 330.0 * s, y + math.sin(a) * 330.0 * s, 11.0,
                  0.13 * s, 0.13 * s, 0.05, "gold_glow", "%s_stud%d" % (label, i))
        # rising glyphs: crosses that hang over the ring
        for i in range(7):
            a = i * 2.39996
            gx, gy = x + math.cos(a) * 190.0 * s, y + math.sin(a) * 190.0 * s
            gz = 90.0 + (i * 47) % 160
            _part("cube", gx, gy, gz, 0.20 * s, 0.05 * s, 0.05 * s, "arcane",
                  "%s_glyphA%d" % (label, i))
            _part("cube", gx, gy, gz, 0.05 * s, 0.05 * s, 0.20 * s, "arcane",
                  "%s_glyphB%d" % (label, i))

    def kit_lantern(x, y, s, label, yaw=0.0):
        """An ornate street lantern. A boulevard without lamp posts reads as a
        path across a field; with them it reads as a street in a city, and the
        warm points of light give the middle distance something to hold."""
        # stepped base + fluted column
        _part("cylinder", x, y, 12.0 * s, 0.52 * s, 0.52 * s, 0.24 * s, "stone", "%s_base" % label)
        _part("cylinder", x, y, 30.0 * s, 0.40 * s, 0.40 * s, 0.20 * s, "gold", "%s_base2" % label)
        _part("cylinder", x, y, 200.0 * s, 0.13 * s, 0.13 * s, 3.4 * s, "gold", "%s_col" % label)
        for k in range(6):                              # flutes
            a = k * (2.0 * math.pi / 6.0)
            _part("cube", x + math.cos(a) * 8.0 * s, y + math.sin(a) * 8.0 * s, 200.0 * s,
                  0.035 * s, 0.035 * s, 3.3 * s, "gold", "%s_flute%d" % (label, k))
        _part("cylinder", x, y, 372.0 * s, 0.22 * s, 0.22 * s, 0.14 * s, "gold", "%s_cap" % label)
        # scrolled brackets
        for e in (-1, 1):
            for k in range(4):
                t = k / 3.0
                _part("sphere", x + e * (14.0 + 26.0 * t) * s, y, (352.0 - 30.0 * t * t) * s,
                      (0.11 - 0.03 * t) * s, (0.08 - 0.02 * t) * s, (0.11 - 0.03 * t) * s,
                      "gold", "%s_scroll%d_%d" % (label, e, k))
        # the lantern itself: gold frame, glowing glass, a crown and a finial
        lz = 430.0 * s
        for k in range(4):
            a = k * (math.pi / 2.0) + 0.785
            _part("cube", x + math.cos(a) * 26.0 * s, y + math.sin(a) * 26.0 * s, lz,
                  0.055 * s, 0.055 * s, 0.92 * s, "gold", "%s_mull%d" % (label, k))
        _part("cube", x, y, lz, 0.46 * s, 0.46 * s, 0.86 * s,
              "lamp_glass" if "lamp_glass" in MATS else "magic_gold", "%s_glass" % label)
        _part("cone", x, y, lz + 66.0 * s, 0.46 * s, 0.46 * s, 0.50 * s, "gold", "%s_crown" % label)
        _part("sphere", x, y, lz + 104.0 * s, 0.13 * s, 0.13 * s, 0.13 * s, "gold_glow",
              "%s_fin" % label)
        _part("cylinder", x, y, lz - 52.0 * s, 0.20 * s, 0.20 * s, 0.10 * s, "gold",
              "%s_skirt" % label)
        # a real point light, so the lantern lights the paving under it
        try:
            pl = spawn(unreal.PointLight, (x, y, lz), label="%s_light" % label)
            plc = pl.get_component_by_class(unreal.PointLightComponent)
            plc.set_intensity(14000.0)
            plc.set_light_color(unreal.Color(255, 208, 140))
            set_prop(plc, "AttenuationRadius", 1100.0)
            set_prop(plc, "SourceRadius", 18.0)
            set_prop(plc, "CastShadows", False)
        except Exception as _e:
            unreal.log_warning("lantern light skipped: %s" % _e)

    def kit_garland(x0, y0, x1, y1, z0, label, sag=110.0):
        """Playing-card pennants on a catenary. The card motif the brief asks for,
        at a size the eye can read from across the plaza."""
        n = 11
        suits = ("rose", "dog_visor", "rose", "dog_visor")
        for k in range(n + 1):
            t = k / float(n)
            px = x0 + (x1 - x0) * t
            py = y0 + (y1 - y0) * t
            dip = math.sin(t * math.pi) * sag
            _part("cube", px, py, z0 - dip, 0.36, 0.03, 0.03, "trunk",
                  "%s_cord%d" % (label, k),
                  rot=(0.0, math.degrees(math.atan2(sag * math.cos(t * math.pi) * 0.02, 1.0)),
                       math.degrees(math.atan2(y1 - y0, x1 - x0))))
            if k < n:
                _part("cube", px, py, z0 - dip - 34.0, 0.30, 0.04, 0.44, "porcelain",
                      "%s_card%d" % (label, k),
                      rot=(0.0, 0.0, math.degrees(math.atan2(y1 - y0, x1 - x0))))
                _part("sphere", px, py - 4.0, z0 - dip - 30.0, 0.10, 0.03, 0.10,
                      suits[k % 4], "%s_pip%d" % (label, k))

    def butterfly(x, y, i):
        z = 90.0 + (i * 67) % 260
        col = ("petal_air", "petal_violet", "petal_pink", "rose_pink")[i % 4]
        yaw = float((i * 53) % 360)
        _part("cube", x, y, z, 0.045, 0.11, 0.012, "dog_visor", "Bfly%d_b" % i,
              rot=(0.0, 0.0, yaw))
        for w in (-1, 1):
            _part("sphere", x + math.cos(math.radians(yaw + 90 * w)) * 9.0,
                  y + math.sin(math.radians(yaw + 90 * w)) * 9.0, z + 3.0,
                  0.10, 0.075, 0.016, col, "Bfly%d_w%d" % (i, w),
                  rot=(float(26 * w), 0.0, yaw))

    def kit_bird(x, y, z, i):
        """A distant bird: two swept wings. Far enough that a silhouette is all
        there is, which is exactly all this is."""
        yaw = float((i * 71) % 360)
        for w in (-1, 1):
            _part("cube", x + math.cos(math.radians(yaw + 90 * w)) * 34.0,
                  y + math.sin(math.radians(yaw + 90 * w)) * 34.0, z,
                  0.62, 0.16, 0.06, "dog_visor", "Bird%d_w%d" % (i, w),
                  rot=(float(-18 * w), 0.0, yaw + 90 * w))

    def kit_sign(x, y, label):
        """An ornate hanging signpost. It was a dowel with a white rectangle and
        a red dot — the reference's wayfinding is wrought iron with a scrolled
        bracket, a swinging board and suit pips, and that is four more parts."""
        _part("cylinder", x, y, 8.0, 0.42, 0.42, 0.16, "stone", "%s_base" % label)
        _part("cylinder", x, y, 92.0, 0.11, 0.11, 1.72, "trunk", "%s_post" % label)
        # scrolled bracket reaching out, with the board hung from it
        volute(x + 22.0, y, 196.0, 0.62, "gold", "%s_scroll" % label)
        _part("cube", x + 34.0, y, 202.0, 0.66, 0.05, 0.05, "gold", "%s_arm" % label)
        for e in (-1, 1):
            _part("cylinder", x + 34.0 + e * 26.0, y, 186.0, 0.022, 0.022, 0.30,
                  "gold", "%s_chain%d" % (label, e))
        _part("cube", x + 34.0, y, 152.0, 0.72, 0.07, 0.52, "porcelain", "%s_card" % label)
        _part("cube", x + 34.0, y - 5.0, 152.0, 0.76, 0.03, 0.56, "gold", "%s_cardtrim" % label)
        # the suit: a heart, built rather than dotted
        for e in (-1, 1):
            _part("sphere", x + 34.0 + e * 9.0, y - 9.0, 160.0, 0.15, 0.05, 0.15,
                  "rose", "%s_lobe%d" % (label, e))
        _part("cube", x + 34.0, y - 9.0, 146.0, 0.19, 0.05, 0.19, "rose",
              "%s_pt" % label, rot=(0.0, 0.0, 45.0))
        finial(x, y, 178.0, 0.72, "gold", "%s_fin" % label, glow="gold_glow")

    def kit_arch(x, y, s, label):
        # A rose-wrapped SEE-THROUGH archway: two vine posts + a top beam you look
        # through (a foreground frame that adds depth), never a solid wall.
        # TALLER AND THINNER. At 5 uu radius in solid green these posts read as
        # two fat green columns planted in the middle of the view — the eye met a
        # wall where it should have met a frame. Slim wooden uprights wrapped in
        # vine let the plaza and the city read THROUGH the arch, which is the
        # only reason to put an arch on a sightline.
        # PROPORTION. At 760 tall against a 210 half-span this was three and a
        # half times taller than it was wide — a slot, not an arch, and narrower
        # than the Observatory it is meant to frame. A garden arch is roughly as
        # wide as it is high.
        h = 430.0 * s
        for sx in (-1, 1):
            _part("cylinder", x + sx * 330.0 * s, y, h * 0.5, 0.19 * s, 0.19 * s, h / 100.0,
                  "trunk", "%s_post%d" % (label, sx))
            for k in range(9):
                t = k / 8.0
                aa = t * 7.2 + sx
                _part("sphere", x + sx * 330.0 * s + math.cos(aa) * 21.0 * s,
                      y + math.sin(aa) * 21.0 * s, 30.0 * s + t * (h - 70.0 * s),
                      0.15 * s, 0.15 * s, 0.15 * s, "foliage" if k % 2 else "foliage_hi",
                      "%s_pvine%d_%d" % (label, sx, k))
                if k % 3 == 1:
                    _part("sphere", x + sx * 330.0 * s + math.cos(aa) * 27.0 * s,
                          y + math.sin(aa) * 27.0 * s, 30.0 * s + t * (h - 70.0 * s),
                          0.13 * s, 0.13 * s, 0.13 * s, "rose" if k % 2 else "rose_pink",
                          "%s_prose%d_%d" % (label, sx, k))
        # AN ARCH IS A CURVE. Two posts and a straight beam is a doorframe, and
        # the curve is the entire reason the shape reads as a garden arch. The
        # span is built from short segments following a semicircle, each rotated
        # to sit tangent to it, then smothered in roses and leaves.
        span, segs = 330.0 * s, 15
        for i in range(segs):
            t = (i + 0.5) / segs
            ang = math.pi * t
            ax = x + math.cos(math.pi - ang) * span
            az = h * 0.72 + math.sin(ang) * span * 0.86
            tangent = math.degrees(math.atan2(math.cos(ang) * span * 0.86,
                                              math.sin(math.pi - ang) * span))
            _part("cube", ax, y, az, 0.30 * s, 0.24 * s, 0.20 * s, "trunk",
                  "%s_arc%d" % (label, i), rot=(0.0, tangent, 0.0))
            # roses and leaves ON the curve, both faces
            if i % 2 == 0:
                _part("sphere", ax, y + 30.0 * s, az + 14.0 * s, 0.40 * s, 0.40 * s, 0.40 * s,
                      "rose" if i % 3 else "rose_pink", "%s_rose%d" % (label, i))
                _part("sphere", ax, y - 30.0 * s, az + 10.0 * s, 0.30 * s, 0.30 * s, 0.30 * s,
                      "petal_pink", "%s_roseb%d" % (label, i))
            _part("cube", ax, y + 20.0 * s, az - 12.0 * s, 0.34 * s, 0.06 * s, 0.40 * s,
                  "leaf", "%s_leaf%d" % (label, i), rot=(24.0, tangent + 40.0, 0.0))

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
        # A BALUSTRADE, not ten bare posts: a capping rail joining them, turned
        # balusters between, steps up to the deck and planting around the base.
        for i in range(10):
            a = (i / 10.0) * 2.0 * math.pi
            a2 = ((i + 0.5) / 10.0) * 2.0 * math.pi
            # cap rail segment bridging post i to post i+1
            mx = math.cos(a2) * 150.0 * s
            my = math.sin(a2) * 150.0 * s
            _part("cube", x + mx, y + my, 142.0 * s, 0.98 * s, 0.16 * s, 0.10 * s,
                  "gold", "%s_cap%d" % (label, i),
                  rot=(0.0, math.degrees(a2) + 90.0, 0.0))
            # a turned baluster between each pair
            _part("sphere", x + mx, y + my, 118.0 * s, 0.15 * s, 0.15 * s, 0.22 * s,
                  "plaza", "%s_bal%d" % (label, i))
        # steps
        for k in range(3):
            _part("cylinder", x, y - (170.0 + k * 34.0) * s, (34.0 - k * 11.0) * s,
                  (1.5 - k * 0.16) * s, 0.42 * s, 0.12 * s, "cobble", "%s_step%d" % (label, k))
        # planting around the dais so it sits IN the garden
        for i in range(12):
            a = i * 2.39996
            _part("sphere", x + math.cos(a) * 205.0 * s, y + math.sin(a) * 205.0 * s, 16.0 * s,
                  0.44 * s, 0.44 * s, 0.30 * s,
                  "foliage" if i % 2 else "foliage_hi", "%s_bush%d" % (label, i))
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
        # Cross rafters, then a smothering of climbing growth. A pergola with a
        # bare frame reads as scaffolding; the whole charm of one is being
        # buried under what grows on it.
        for i in range(7):
            rx = x + (-1.0 + i / 3.0) * 150.0 * s
            _part("cube", rx, y, 318.0 * s, 0.14 * s, 3.3 * s, 0.12 * s, "trunk",
                  "%s_rafter%d" % (label, i))
        for i in range(9):
            fx = x + (-1.0 + i * 0.25) * 150.0 * s
            _part("sphere", fx, y + math.sin(i * 1.3) * 70.0 * s, 336.0 * s,
                  1.05 * s, 1.05 * s, 0.60 * s, "foliage" if i % 2 else "foliage_hi",
                  "%s_leaf%d" % (label, i))
            _part("sphere", fx, y + 60.0 * s - math.cos(i * 1.1) * 40.0 * s, 302.0 * s,
                  0.34 * s, 0.34 * s, 0.34 * s,
                  "rose" if i % 2 else "petal_pink", "%s_bloom%d" % (label, i))
        # vines running DOWN the posts, and a bench in the shade
        for sx in (-1, 1):
            for sy in (-1, 1):
                for k in range(6):
                    t = k / 5.0
                    a = t * 5.4
                    _part("sphere", x + sx * 150.0 * s + math.cos(a) * 26.0 * s,
                          y + sy * 150.0 * s + math.sin(a) * 26.0 * s,
                          40.0 * s + t * 270.0 * s, 0.24 * s, 0.24 * s, 0.24 * s,
                          "foliage", "%s_vine%d%d_%d" % (label, sx, sy, k))
        _part("cube", x, y, 62.0 * s, 2.2 * s, 0.5 * s, 0.14 * s, "trunk", "%s_bench" % label)
        for bx in (-1, 1):
            _part("cube", x + bx * 90.0 * s, y, 34.0 * s, 0.16 * s, 0.42 * s, 0.62 * s,
                  "trunk", "%s_benchleg%d" % (label, bx))


    # ---- WHERE THE HERO FRAME ACTUALLY OPENS ONTO THE GROUND -------------
    # Derived, never guessed. Twice in this sprint foreground work was authored
    # nearer than this and vanished off the bottom edge — not small, absent.
    def _hero_ground_band():
        cams = [c for c in layout.get("heroCameras", []) if c.get("id") == "cam_arrival_hero"]
        if not cams:
            return (-980.0, 60.0, -760.0)
        c = cams[0]
        ex, ey, ez = [float(v) for v in c["location"]]
        tx, ty, tz = [float(v) for v in c["lookAt"]]
        fov_h = math.radians(float(c.get("fovDeg", 66.0)))
        # vertical half-angle for 16:9
        half_v = math.atan(math.tan(fov_h * 0.5) * (9.0 / 16.0))
        run = math.hypot(tx - ex, ty - ey)
        pitch = math.atan2(tz - ez, run) if run else 0.0
        drop = half_v - pitch                      # angle of the bottom ray below level
        near = ez / math.tan(drop) if drop > 1e-4 else 1e6
        unreal.log_warning("HERO GROUND BAND starts %.0f uu ahead (world y >= %.0f)"
                           % (near, ey + near))
        return (ey + near, ex, ey)

    NEAR_Y, _CAM_X, _CAM_Y = _hero_ground_band()

    def in_camera_lap(px, py, margin=250.0):
        """True if something TALL placed here would sit inside the hero camera's
        blind foreground.

        This has now caught three separate placements — the Great Framing Tree at
        11 m filling six frame-heights, a pair of topiary at 5 m filling 72% of
        one, and the Dog's own staging, which fell off the bottom entirely. Each
        time it was found by measuring after the fact, and each time the fix was
        the same test written again at a new call site.

        So it lives here once and the tall kits ask it. NEAR_Y is derived from
        the camera, so if the camera moves the rule moves with it. Short things
        are exempt: ground cover nearer than this is simply not in shot, which
        costs a few draws and misleads nobody."""
        return py < NEAR_Y + margin

    # WHERE THE HERO DOG STANDS, AND THE GROUND IT STANDS ON. Nothing that
    # grows gets planted here: a subject knee-deep in blossom is not staged, it
    # is camouflaged.
    DOG_STAGE = (60.0, -760.0, 560.0)

    def _on_stage(gx, gy):
        return math.hypot(gx - DOG_STAGE[0], gy - DOG_STAGE[1]) < DOG_STAGE[2]

    def _in_corridor(gx, gy, half=430.0, y0=-1450.0, y1=1500.0):
        """The hero sight-line, protected. The composition the brief asks for is
        Dog -> path -> landmarks -> skyline, and every step of that only works if
        the step behind it is visible. Nothing tall gets to stand in here."""
        return abs(gx) < half and y0 < gy < y1

    def _on_paving(gx, gy):
        """The plaza and the boulevard are STONE. Nothing that grows out of soil
        may be scattered onto them — that single rule is most of the difference
        between a planted courtyard and a rash."""
        if math.hypot(gx, gy) < 1180.0:
            return True
        return abs(gx) < 300.0 and -1150.0 < gy < 1250.0

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
        # LEAF CARDS, not a blob. One squashed sphere per plant is the single
        # reason the greenery read as bubbles; a plant's silhouette is broken and
        # spiky, and that is carried by flat cards fanned at different angles.
        d = 0.5 + (i % 3) * 0.14
        _part("sphere", x, y, 9.0, d * 0.62, d * 0.62, 0.30,
              "foliage" if i % 2 else "foliage_hi", "tuft_%d" % i)
        blades = 5 + (i % 3)
        for k in range(blades):
            a = (k / float(blades)) * 360.0 + (i * 37) % 360
            lean = 22.0 + ((i * 13 + k * 7) % 26)
            # ALPHA-CUT. A blade of grass is a shape, not a box; the mask is
            # what makes a hundred of these read as a lawn.
            _part("cube", x + math.cos(math.radians(a)) * 9.0 * d,
                  y + math.sin(math.radians(a)) * 9.0 * d, 12.0 + 14.0 * d,
                  d * 0.72, d * 0.02, d * 0.90,
                  ("leafcard" if (i + k) % 2 else "leafcard_hi") if "leafcard" in MATS
                  else ("leaf" if (i + k) % 2 else "leaf_hi"),
                  "tuft%d_leaf%d" % (i, k), rot=(lean, a, 0.0))

    def mote(x, y, i):
        z = 70.0 + (i * 53) % 540
        col = ("magic_gold", "magic_cyan", "arcane")[i % 3]
        d = 0.10 + (i % 3) * 0.045
        _part("sphere", x, y, z, d, d, d, col, "Mote_%d" % i)

    def air_petal(x, y, i):
        # A drifting petal in the air — a soft flattened rose petal riding the Bob WPO,
        # so it bobs on its own phase. Environmental motion, never a status channel.
        z = 130.0 + (i * 71) % 430
        d = 0.105 + (i % 3) * 0.032
        # A CUBE IS NOT A PETAL. At this size a flat box reads as pink confetti,
        # and a hundred of them read as litter over the whole frame. A thin
        # curved-looking ellipsoid at two-thirds the size reads as blossom.
        _part("sphere", x, y, z, d, d * 0.62, d * 0.16, "petal_air", "Petal_%d" % i,
              rot=(float((i * 37) % 360), float((i * 53) % 360), float((i * 19) % 360)))

    def rock(x, y, i):
        # A weathered boulder cluster (stone) for environmental framing.
        d = 0.85 + (i % 4) * 0.35
        ground_skirt(x, y, d * 62.0, "rock_%d" % i, n=5, flowers=False)
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
            if not in_camera_lap(x, y, 600.0):
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
            kit_observatory(x, y, z, mid)
        elif mesh == "arch" or "arch" in mid:
            # WIDER, so its posts stand on the verges rather than in the way.
            # An arch frames by being something you look THROUGH; at the old
            # span its uprights were exactly where the eye wanted to travel.
            kit_arch(x, y, 1.85, mid)
        elif "overlook" in mid or "terrace" in mid:
            kit_overlook(x, y, min(1.5, max(0.9, norm)), mid)
        elif "pergola" in mid:
            kit_pergola(x, y, min(1.5, max(0.9, norm)), mid)
        elif "teapot" in mid:
            kit_teapot(x, y, max(400.0, z), mid)
        elif "sign" in mid or "card" in mid:
            kit_sign(x, y, mid)
        elif "clock_tower" in mid or "tower" in mid:
            # 1.6 ran it out of the top of the hero frame and put it shoulder to
            # shoulder with the Golden Build Gate. A landmark that leaves the
            # frame stops being a landmark and becomes a wall.
            kit_clock_tower(x, y, 0.62, mid)
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
    _sun_rot.set_editor_property("pitch", -max(LOOK["sunPitchMin"], float(atm["sunElevationDeg"])))
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
    _lux = float(atm.get("sunIntensityLux", 0)) or LOOK["sunLux"]
    sun_comp.set_intensity(_lux)
    try:
        sun_comp.set_light_color(unreal.LinearColor(*(LOOK["sunWarm"] + (1.0,))))
    except Exception:
        pass
    set_prop(sun_comp, "bAtmosphereSunLight", True)

    # FILL light from the opposite side, no shadows. Guarantees EVERY surface gets
    # direct light (each faces toward the key or the fill), independent of skylight
    # / Lumen ambient — which do not reliably contribute in headless -RenderOffscreen.
    fill = spawn(unreal.DirectionalLight, (0, 0, 1600), label="FillLight")
    _fill_rot = unreal.Rotator()
    _fill_rot.set_editor_property("pitch", LOOK["fillPitch"])
    _fill_rot.set_editor_property("yaw", float(atm["sunAzimuthDeg"]) + LOOK["fillYawOffset"])
    _fill_rot.set_editor_property("roll", 0.0)
    fill.set_actor_rotation(_fill_rot, False)
    fill_comp = fill.get_component_by_class(unreal.DirectionalLightComponent)
    fill_comp.set_mobility(unreal.ComponentMobility.MOVABLE)
    fill_comp.set_intensity(_lux * LOOK["fillRatio"])
    set_prop(fill_comp, "bCastShadows", False)
    set_prop(fill_comp, "CastShadows", False)

    # --- HERO PRACTICALS -------------------------------------------------
    # Every glowing thing in this world glows and throws NOTHING. The arcane
    # circle, the gate's gold, the fountain — all emissive geometry, which
    # Lumen bounces only weakly, so each one reads as a decal painted on the
    # scene rather than a source sitting in it. What sells a magic circle is
    # not the circle; it is the violet on the Dog's white chest and the wet
    # violet on the stone around it.
    #
    # Three lights, tightly attenuated so they stay POOLS. A wide radius here
    # would become a second ambient and flatten the very shadows the key light
    # is there to cast, which is the usual way scenes acquire practicals and
    # get worse. Shadowless: these are bounce stand-ins, not casters, and
    # thirty shadow-casting practicals is how a stream loses its frame rate.
    #
    # UNTESTED — authored offline, never rendered. WONDERLAND_LOOK=heroLights=0
    # turns them off, so the A/B is one cook rather than two branches.
    if LOOK["heroLights"]:
        _lum, _rad = LOOK["heroLightLumens"], LOOK["heroLightRadius"]
        for _hx, _hy, _hz, _hcol, _hs, _hlabel in (
            # the circle the Dog stands on — violet, low, throwing UP onto it
            (0.0, 0.0, 150.0, (176, 108, 255), 1.00, "HeroLight_Arcane"),
            # the Golden Build Gate — warm gold, at the height of the arch
            (-1050.0, 400.0, 420.0, (255, 206, 138), 0.85, "HeroLight_Gate"),
            # the rose arch on the sight line — a soft warm pink under the span
            (0.0, 820.0, 230.0, (255, 178, 196), 0.55, "HeroLight_Arch"),
        ):
            try:
                _hl = spawn(unreal.PointLight, (_hx, _hy, _hz), label=_hlabel)
                _hc = _hl.get_component_by_class(unreal.PointLightComponent)
                _hc.set_mobility(unreal.ComponentMobility.MOVABLE)
                _hc.set_intensity(_lum * _hs)
                _hc.set_light_color(unreal.Color(*_hcol))
                set_prop(_hc, "AttenuationRadius", _rad)
                set_prop(_hc, "SourceRadius", 40.0)
                set_prop(_hc, "CastShadows", False)
            except Exception as _e:
                unreal.log_warning("hero practical %s skipped: %s" % (_hlabel, _e))

    if atm.get("skyAtmosphere"):
        sky_atm = spawn(unreal.SkyAtmosphere, (0, 0, 0), label="SkyAtmosphere")
        sac = sky_atm.get_component_by_class(unreal.SkyAtmosphereComponent)
        # BRIGHT MAGICAL DAY sky (matches the founder reference): natural blue Rayleigh
        # with a warm Mie haze near the sun for a golden horizon. The pink/purple of
        # Wonderland lives in the DISTANCE fog, the flowers and the castles — NOT the
        # whole sky. (An earlier violet Rayleigh made it a dark twilight.)
        set_prop(sac, "RayleighScatteringScale", 0.0331)
        set_prop(sac, "MieAnisotropy", 0.80)
        # ATMOSPHERIC PERSPECTIVE. Distance only reads as distance when the air
        # between takes something out of it. Height fog cannot do this job here:
        # it applies to the sky dome as well, so any density strong enough to
        # haze a tower also repaints the sky — which is exactly how the last
        # three attempts produced a navy band instead of a blue one.
        #
        # SkyAtmosphere's aerial perspective hazes GEOMETRY by depth and leaves
        # the dome alone.
        #
        # THE SCALE IS THE WHOLE POINT. This world is under a kilometre across —
        # the great castle is 420 m out, not 42 km — and real air does almost
        # nothing over 420 m, so the honest setting produced a castle exactly as
        # crisp as a foreground mushroom. Stretching the optical depth by 45x
        # makes 420 m behave like 19 km: the near ground stays clear, the town
        # cools, the castle sits back in the blue. This is the instrument the
        # previous five attempts were reaching for when they kept reaching for
        # fog and kept repainting the sky instead.
        for _nm in ("AerialPespectiveViewDistanceScale",
                    "AerialPerspectiveViewDistanceScale"):
            set_prop(sac, _nm, 45.0)
        # a little more Mie puts warm haze along the horizon where the land meets
        # the sky, which is what softens the join
        set_prop(sac, "MieScatteringScale", 0.0075)
    if atm.get("skyLight"):
        sky = spawn(unreal.SkyLight, (0, 0, 0), label="SkyLight")
        sky_comp = sky.get_component_by_class(unreal.SkyLightComponent)
        sky_comp.set_mobility(unreal.ComponentMobility.MOVABLE)
        # AMBIENT IS THE MISSING RANGE. At 0.42 the sky contributes almost
        # nothing, so anything the sun does not reach falls to near-black — and
        # once the sky and the clouds got brighter, the auto-exposure metered
        # against them and crushed the whole shadowed foreground to mud. Open-air
        # daylight has an enormous blue fill from the entire dome; restoring it
        # lifts the shadows without touching the highlights, which is precisely
        # the range the frame was missing.
        #
        # 1.15 was the first guess. A CPU trace of this exact geometry, swept at
        # 0.42 / 0.70 / 0.90 / 1.15, says the choice barely matters: luma sd moves
        # 60.3 -> 59.0 across the entire range and saturation 0.193 -> 0.185, with
        # no clipping anywhere. So this is a flat region, not a cliff, and 0.90
        # takes most of the shadow lift for almost none of the contrast.
        #
        # (Those are the CORRECTED figures. The first sweep read 54.7 -> 51.7 and
        # 0.176 -> 0.161 because the tracer was giving UE's flat Plane asset 50 uu
        # of thickness, so the ground plane engulfed the paving. Same conclusion,
        # different numbers — but a comment carrying measurements that were never
        # true is worse than one carrying none.)
        #
        # Still the first value to revisit against a real streamed frame: the
        # trace has no Lumen, so it can bound this decision and cannot settle it.
        try:
            sky_comp.set_intensity(0.90)
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
        # UE5 renamed both of these to *Luminance; the old names silently do
        # nothing, which is why the haze has never actually been tinted.
        for _fn in ("FogInscatteringLuminance", "FogInscatteringColor"):
            set_prop(fog_comp, _fn, unreal.LinearColor(0.62, 0.60, 0.78, 1.0))
        for _dn in ("DirectionalInscatteringLuminance", "DirectionalInscatteringColor"):
            set_prop(fog_comp, _dn, unreal.LinearColor(1.0, 0.72, 0.38, 1.0))
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
        sset("AutoExposureBias", "auto_exposure_bias", LOOK["exposureBias"])
        # Dreamy candy bloom, thresholded HIGH so only gold/emissive accents + true
        # highlights glow — never the midtones (which reads as milky haze).
        sset("BloomIntensity", "bloom_intensity", LOOK["bloomIntensity"])
        sset("BloomThreshold", "bloom_threshold", LOOK["bloomThreshold"])
        # SATURATED storybook-jewel grade (the reference is vivid, glossy, deep):
        #  - master GAIN < 1 darkens the whole frame post-metering (auto-exposure can't
        #    fight a post-tonemap gain), so colours stop washing to white;
        #  - HIGHLIGHT gain pulled well DOWN + warm so the white Dog/spires/porcelain
        #    stop blowing to pure white and keep their form and hue;
        #  - strong saturation + contrast for jewel tones; COOL-VIOLET shadows for the
        #    near-gold / distant-purple depth split.
        sset("ColorGain", "color_gain", unreal.Vector4(*(LOOK["gain"] + (1.0,))))
        sset("ColorSaturation", "color_saturation", unreal.Vector4(*(LOOK["saturation"] + (1.0,))))
        sset("ColorContrast", "color_contrast", unreal.Vector4(*(LOOK["contrast"] + (1.0,))))
        sset("ColorGainHighlights", "color_gain_highlights", unreal.Vector4(*(LOOK["gainHighlights"] + (1.0,))))
        sset("ColorGainShadows", "color_gain_shadows", unreal.Vector4(*(LOOK["gainShadows"] + (1.0,))))
        sset("ColorGamma", "color_gamma", unreal.Vector4(*(LOOK["gamma"] + (1.0,))))
        sset("WhiteTemp", "white_temp", LOOK["whiteTemp"])
        sset("VignetteIntensity", "vignette_intensity", LOOK["vignette"])
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

    # CUMULUS, AS GEOMETRY. UE's stock volumetric cloud material renders as a
    # flat grey sheet under this lighting, so it was disabled and the sky has
    # been empty since. Authoring a real cloud material headlessly is not
    # dependable; clusters of large soft spheres are how stylised games have
    # always done cumulus, they light correctly off the same sun, and the
    # silhouette is what the eye reads anyway.
    import math as _mc
    # ALTITUDE AND DISTANCE ARE WHAT MAKE A SPHERE READ AS A CLOUD. The first
    # version put these 50-90 m up and 90-240 m out, which is where a hill is,
    # so they rendered as grey boulders behind the town. Cumulus lives 200-450 m
    # up and half a kilometre to two kilometres away; at that remove the eye
    # reads scale before it reads geometry. More puffs per cluster, heavily
    # overlapped, so the silhouette stops showing which spheres it is made of.
    for i in range(44):
        a = i * 2.39996
        dist = 52000.0 + 168000.0 * (((i * 23) % 9) / 9.0)
        cx0 = _mc.cos(a) * dist
        cy0 = _mc.sin(a) * dist + 20000.0
        cz0 = 19000.0 + 26000.0 * (((i * 17) % 7) / 7.0)
        puffs = 11 + (i % 5)
        base = 7000.0 + 8000.0 * (((i * 13) % 5) / 5.0)
        for k in range(puffs):
            t = (k + 0.5) / float(puffs)
            lobe = _mc.sin(t * _mc.pi)
            px = cx0 + (t - 0.5) * base * 2.6
            py = cy0 + _mc.sin(k * 2.1 + i) * base * 0.42
            # flat-bottomed, domed on top: the cumulus read
            pz = cz0 + lobe * base * 0.30
            r = base * (0.34 + 0.42 * lobe) * (0.86 + 0.22 * ((k * 7 + i) % 4) / 4.0)
            static_mesh("sphere", [px, py, pz], [r / 100.0, r / 100.0, r * 0.62 / 100.0],
                        "Cloud%d_%d" % (i, k),
                        mat="cloud_warm" if (i + k) % 5 == 0 else "cloud")

    # DISTANT HILLS. A flat plane meeting the sky in a dead-straight line reads
    # as a backdrop, not a world. A ring of very wide, very shallow domes gives
    # the horizon a soft, uneven edge for the castle rooflines to sit against.
    import math as _mh
    # THE HORIZON HAS TO HAVE A SHAPE. The previous ring was fifteen metres tall
    # a kilometre out — geometrically present and visually absent, which is why
    # the meadow still met the sky in a ruled line. These are real landforms:
    # a rolling near range behind the town, and a far range of two-hundred-metre
    # ridges behind the castle that the aerial perspective turns to pale blue.
    for i in range(30):
        a = i * 2.39996
        near = (i % 2 == 1)
        d = (52000.0 + 30000.0 * ((i * 17) % 7) / 7.0 if near
             else 210000.0 + 190000.0 * ((i * 23) % 5) / 5.0)
        hx, hy = _mh.cos(a) * d, _mh.sin(a) * d + 6000.0
        if near:
            w, hz, zc = 620.0 + 240.0 * ((i * 13) % 5) / 5.0, 62.0 + 26.0 * ((i * 11) % 4) / 4.0, -2400.0
        else:
            w, hz, zc = 2600.0 + 1400.0 * ((i * 13) % 5) / 5.0, 260.0 + 150.0 * ((i * 11) % 4) / 4.0, -9000.0
        static_mesh("sphere", [hx, hy, zc], [w, w * 0.72, hz],
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
    for m in layout.get("landmarks", []):
        kit_dispatch(m)
    # THE GREAT FRAMING TREE HAS TO FRAME. It is named for the job and was doing
    # none of it: a trunk with a ball on top, standing in grass, entirely inside
    # the frame. Buttress roots break the ground it stands in, and one long
    # branch arcs across the top of the hero view carrying canopy, hanging vines
    # and a clock — the repoussoir the composition has been missing.
    _TX, _TY = 1300.0, 470.0
    for _i in range(9):
        _a = _i * (2.0 * math.pi / 9.0) + 0.3
        kit_root(_TX, _TY, _a, 430.0 + 190.0 * ((_i * 7) % 4) / 4.0,
                 0.90 + 0.34 * ((_i * 5) % 3) / 3.0, "TreeRoot%d" % _i)
    # the framing branch: out of the bole, across the frame, drooping at the end
    for _k in range(14):
        _t = (_k + 0.5) / 14.0
        _bx = _TX - _t * 1500.0
        _by = _TY - _t * 520.0
        _bz = 1180.0 + math.sin(_t * 2.1) * 190.0 - _t * _t * 260.0
        _th = 1.15 * (1.0 - 0.62 * _t)
        _part("sphere", _bx, _by, _bz, _th * 2.2, _th * 1.3, _th * 1.2, "trunk",
              "TreeBranch%d" % _k, rot=(0.0, 0.0, float(_k * 9)))
        # canopy on the branch: deep interior, spring-green outside
        if _k % 2 == 0:
            _part("sphere", _bx, _by, _bz - 40.0, 2.9, 2.5, 1.5, "foliage_deep",
                  "TreeBranchCoreA%d" % _k)
            for _j in range(4):
                _ja = _j * 1.57 + _k
                _part("sphere", _bx + math.cos(_ja) * 190.0, _by + math.sin(_ja) * 150.0,
                      _bz + 30.0 + (_j % 2) * 60.0, 2.1, 1.9, 1.2,
                      "foliage_spr" if _j % 2 else "foliage_hi",
                      "TreeBranchLeaf%d_%d" % (_k, _j))
        if _k % 2 == 0 and "leafcard" in MATS:
            # THE EDGE OF A CANOPY IS WHERE IT READS. A solid core keeps the
            # mass and its shadow; cards around the outside give it the ragged,
            # holed silhouette no arrangement of spheres can produce.
            for _c in range(7):
                _ca = _c * 0.898 + _k
                _part("cube", _bx + math.cos(_ca) * 250.0, _by + math.sin(_ca) * 205.0,
                      _bz + 20.0 + math.sin(_ca * 1.7) * 95.0,
                      3.1, 0.03, 3.1,
                      "leafcard_hi" if _c % 2 else "leafcard",
                      "TreeBranchCard%d_%d" % (_k, _c),
                      rot=(float((_c * 29) % 60) - 30.0, float((_c * 47) % 360),
                           float((_c * 17) % 40) - 20.0))
        if _k % 3 == 1:                       # hanging vines and blossom
            for _v in range(6):
                _part("sphere", _bx + 16.0, _by + 12.0, _bz - 90.0 - _v * 62.0,
                      0.30, 0.30, 0.30, "foliage" if _v % 2 else "rose_pink",
                      "TreeHang%d_%d" % (_k, _v))
    # THE TOP-RIGHT CORNER LEAKS. The tree frames the left and the gate frames
    # the right at eye level, but between them the top of the frame is open sky
    # and the eye runs out of it. A second bough, thrown the other way across
    # the top of the view, closes the arch of foliage the brief asks for.
    for _k in range(11):
        _t = (_k + 0.5) / 11.0
        # ACROSS the top, toward screen-right (which is world -X when the camera
        # looks along +Y), and high enough to hang INTO the frame rather than
        # across the Observatory that closes the axis beneath it.
        _bx = _TX - 300.0 - _t * 1500.0
        _by = _TY + 120.0 + _t * 520.0
        _bz = 1300.0 + math.sin(_t * 1.9) * 90.0 - _t * _t * 140.0
        _th = 0.92 * (1.0 - 0.58 * _t)
        _part("sphere", _bx, _by, _bz, _th * 2.0, _th * 1.25, _th * 1.1, "trunk",
              "TreeBough2_%d" % _k, rot=(0.0, 0.0, float(_k * 11)))
        if _k % 2 == 0:
            _part("sphere", _bx, _by, _bz - 34.0, 2.5, 2.2, 1.35, "foliage_deep",
                  "TreeBough2Core%d" % _k)
            for _j in range(3):
                _ja = _j * 2.1 + _k
                _part("sphere", _bx + math.cos(_ja) * 165.0, _by + math.sin(_ja) * 135.0,
                      _bz + 26.0 + (_j % 2) * 52.0, 1.85, 1.65, 1.05,
                      "foliage_spr" if _j % 2 else "foliage_hi",
                      "TreeBough2Leaf%d_%d" % (_k, _j))
            if "leafcard" in MATS:
                for _c in range(5):
                    _ca = _c * 1.257 + _k
                    _part("cube", _bx + math.cos(_ca) * 215.0, _by + math.sin(_ca) * 180.0,
                          _bz + 12.0 + math.sin(_ca * 1.6) * 80.0, 2.7, 0.03, 2.7,
                          "leafcard_hi" if _c % 2 else "leafcard",
                          "TreeBough2Card%d_%d" % (_k, _c),
                          rot=(float((_c * 31) % 56) - 28.0, float((_c * 53) % 360),
                               float((_c * 19) % 36) - 18.0))
        # wisteria hanging out of it, which is the reference's signature
        if _k % 2 == 1:
            for _v in range(7):
                _part("sphere", _bx + 12.0, _by - 10.0, _bz - 80.0 - _v * 58.0,
                      0.26, 0.26, 0.26,
                      "petal_violet" if _v % 2 else "petal_pink",
                      "Wisteria%d_%d" % (_k, _v))

    kit_clock(_TX - 980.0, _TY - 330.0, 1140.0, "BranchClock")
    kit_float_key(_TX - 1240.0, _TY - 440.0, 1010.0, "BranchKey")
    # BACKGROUND IS A DISTANCE, NOT A LABEL. The layout files these under
    # "backgroundSilhouettes" and then places them 2.5-3.4 km out at 14 m tall —
    # so they rendered at the same apparent size as the foreground props and the
    # frame had no depth at all. Pushed out and grown by the same factor they
    # keep the authored composition (which tower is where) and finally read as
    # what they were designed to be.
    _PUSH = 8.5
    for m in layout.get("backgroundSilhouettes", []):
        _lo = m["location"]
        _mid, _mesh = m.get("id", ""), m.get("mesh", "")
        _bx = float(_lo[0]) * _PUSH
        _by = (float(_lo[1]) - 300.0) * _PUSH + 300.0
        _sc = m.get("scale", [1, 1, 1])
        _sz = max(0.8, (float(_sc[0]) + float(_sc[1])) / 2.0)
        if _mesh == "spire":
            kit_spire(_bx, _by, _sz * 1.9, _mid, body_mat="spire_far",
                      roof_mat="roof_pink" if "1" in _mid or "3" in _mid else "roof_rose")
        elif _mesh == "island":
            # floating islands, kept high and pale so they sit in the sky rather
            # than on the horizon line
            # HIGH and small. At the previous altitude they cut the horizon like
            # grey slabs; a floating island only reads as magic when it is clearly
            # in the SKY, above the castle, with air underneath it.
            _iz = float(_lo[2]) * _PUSH * 1.35 + 9000.0
            static_mesh("cylinder", [_bx, _by, _iz],
                        [_sz * 5.0, _sz * 5.0, _sz * 0.9], _mid, mat="spire_far")
            static_mesh("cone", [_bx, _by, _iz - _sz * 420.0],
                        [_sz * 4.0, _sz * 4.0, _sz * 6.0], _mid + "_keel",
                        rotation=(180.0, 0.0, 0.0), mat="meadow_far")
            for _k in range(4):
                kit_spire(_bx + math.cos(_k * 1.6) * _sz * 150.0,
                          _by + math.sin(_k * 1.6) * _sz * 150.0,
                          _sz * 0.30, "%s_t%d" % (_mid, _k), body_mat="spire_far",
                          roof_mat="roof_pink", flag=False)
            _iz = _iz + _sz * 55.0
        else:
            # the treeline: a long low band of canopy, not one stretched tree
            for _k in range(46):
                _tx = _bx + (_k - 23) * 1450.0
                static_mesh("sphere", [_tx, _by + math.sin(_k * 1.7) * 1800.0, 620.0],
                            [11.0 + 3.0 * ((_k * 7) % 4), 9.0, 7.0 + 2.0 * ((_k * 5) % 3)],
                            "%s_%d" % (_mid, _k), mat="meadow_far")

    # Arrival plaza + glowing arcane circle (the Dog's home / Relay identity) in
    # front of the arrival camera, plus a few floating magical keys for whimsy.
    kit_plaza(0.0, 0.0)
    # THE NORTH GARDENS. Measured on the hero frame, bare lawn covered 22% of it
    # and paving 1.6% — and extending the boulevard barely moved either, because
    # the lawn is not the corridor, it is the open ground either SIDE of it
    # between the plaza and the town. That band is a third of the middle of the
    # frame and the reference has garden there, not a field.
    #
    # Beds with their own kerbs, clipped hedge runs to give the beds edges, and
    # planted verges — all outside the protected sight-line so the Observatory
    # still closes the axis through the gap.
    _ng = 0
    for _i, (_bx, _by, _br) in enumerate((
            (-980.0, 1450.0, 250.0), (-1500.0, 1950.0, 210.0), (-820.0, 2350.0, 230.0),
            (960.0, 1500.0, 240.0), (1480.0, 2000.0, 220.0), (800.0, 2400.0, 200.0),
            (-1750.0, 1350.0, 190.0), (1700.0, 1300.0, 190.0))):
        if _in_corridor(_bx, _by):
            continue
        kit_bed(_bx, _by, _br, "NorthBed%d" % _i,
                palette=(("rose", "rose_pink", "petal_violet") if _i % 2
                         else ("petal_pink", "petal_violet", "petal_air")))
        _ng += 1
    # clipped hedge runs, which are what give beds an edge and a lawn a shape
    for _h, (_hx, _hy, _ang, _len) in enumerate((
            (-1250.0, 1700.0, 78.0, 9), (1250.0, 1750.0, 102.0, 9),
            (-700.0, 2600.0, 6.0, 7), (700.0, 2620.0, 174.0, 7),
            (-1900.0, 1700.0, 92.0, 6), (1900.0, 1650.0, 88.0, 6))):
        for _k in range(_len):
            _ox = _hx + math.cos(math.radians(_ang)) * (_k - _len / 2.0) * 190.0
            _oy = _hy + math.sin(math.radians(_ang)) * (_k - _len / 2.0) * 190.0
            if _in_corridor(_ox, _oy):
                continue
            _part("cube", _ox, _oy, 74.0, 1.02, 0.68, 1.46, "foliage_deep",
                  "NorthHedge%d_%d" % (_h, _k), rot=(0.0, 0.0, _ang))
            _part("cube", _ox, _oy, 142.0, 1.06, 0.74, 0.22, "foliage_spr",
                  "NorthHedgeTop%d_%d" % (_h, _k), rot=(0.0, 0.0, _ang))
            if _k % 3 == 0:
                _part("sphere", _ox, _oy - 40.0, 130.0, 0.20, 0.20, 0.20,
                      "rose" if _k % 2 else "rose_pink", "NorthHedgeRose%d_%d" % (_h, _k))
            _ng += 2
    # planted verges filling what is left, in colonies rather than a wash
    def north_colony(cx, cy, i):
        if _in_corridor(cx, cy) or _on_paving(cx, cy) or cy < 1250.0:
            return
        for k in range(5 + (i % 4)):
            a = k * 2.39996 + i
            rr = 40.0 + 110.0 * math.sqrt((k + 0.4) / 8.0)
            px_, py_ = cx + math.cos(a) * rr, cy + math.sin(a) * rr
            if _in_corridor(px_, py_):
                continue
            (tuft if (i + k) % 3 else flower)(px_, py_, i * 11 + k)

    scatter(0.0, 1900.0, 44, 2100.0, north_colony)
    unreal.log("NORTH GARDENS %d elements" % _ng)

    # A PAVED FORECOURT under the Observatory, so the way north arrives at
    # something rather than dissolving into grass. Measured: lawn covered 21.8%
    # of the hero frame against the plaza's 1.6%, which is the opposite of the
    # reference, where the middle distance is a paved approach.
    for _r in range(9):
        _rr = 240.0 + _r * 170.0
        _n = max(24, int(_rr / 34.0))
        for _i in range(_n):
            _a = _i * (2.0 * math.pi / _n)
            _fx = math.cos(_a) * _rr
            _fy = 1560.0 + math.sin(_a) * _rr * 0.78
            _h = (int(_fx) * 73856093) ^ (int(_fy) * 19349663)
            _part("cube", _fx, _fy, 4.0,
                  (2.0 * math.pi * _rr / _n) / 92.0, 0.62, 0.04,
                  ("plaza", "cobble", "cobble2")[_h % 3], "Forecourt%d_%d" % (_r, _i),
                  rot=(0.0, 0.0, math.degrees(_a) + 90.0))
        if _r == 8:                                  # a kerb closing it
            for _i in range(_n):
                _a = _i * (2.0 * math.pi / _n)
                _part("cube", math.cos(_a) * (_rr + 40.0),
                      1560.0 + math.sin(_a) * (_rr + 40.0) * 0.78, 14.0,
                      (2.0 * math.pi * _rr / _n) / 90.0, 0.34, 0.28, "stone",
                      "ForecourtKerb%d" % _i, rot=(0.0, 0.0, math.degrees(_a) + 90.0))

    # A CEREMONIAL EDGE. The plaza was a paved disc lying on grass with a hard
    # boundary; the reference's arrival space is HELD — a raised kerb all the way
    # round, steps down at each approach, and planting tight against the stone.
    _PR = 1230.0
    for i in range(64):
        a = i * (2.0 * math.pi / 64.0)
        kx, ky = math.cos(a) * _PR, math.sin(a) * _PR
        _part("cube", kx, ky, 16.0, 1.30, 0.44, 0.34, "stone", "PlazaKerb%d" % i,
              rot=(0.0, 0.0, math.degrees(a) + 90.0))
        _part("cube", kx, ky, 34.0, 1.34, 0.52, 0.10, "plaza", "PlazaCap%d" % i,
              rot=(0.0, 0.0, math.degrees(a) + 90.0))
        if i % 8 == 0:                                  # piers with lanterns' scale
            # a trimmed pier with a terminated cap, and a balustrade running to
            # the next one — "ceremonial and expensive" is a continuous edge, not
            # a ring of separate posts
            trim_box(kx, ky, 52.0, 0.56, 0.56, 0.92, "stone", "PlazaPier%d" % i,
                     yaw=math.degrees(a), trim="plaza")
            finial(kx, ky, 104.0, 0.85, "gold", "PlazaPierFin%d" % i, glow="gold_glow")
            _a2 = (i + 8) * (2.0 * math.pi / 64.0)
            railing(kx, ky, math.cos(_a2) * _PR, math.sin(_a2) * _PR, 34.0,
                    "plaza", "PlazaBal%d" % i, n=5, h=62.0, rail_mat="stone")
        if i % 3 == 0:                                  # moss at the transition
            _part("sphere", math.cos(a) * (_PR + 34.0), math.sin(a) * (_PR + 34.0), 7.0,
                  0.30, 0.30, 0.09, "moss", "PlazaMoss%d" % i)
    # steps down at the four approaches
    for q, (dx, dy) in enumerate(((0.0, 1.0), (0.0, -1.0), (1.0, 0.0), (-1.0, 0.0))):
        for k in range(3):
            _part("cube", dx * (_PR + 40.0 + k * 46.0), dy * (_PR + 40.0 + k * 46.0),
                  12.0 - k * 5.0, 3.6 if dx == 0 else 0.46, 0.46 if dx == 0 else 3.6, 0.12,
                  "cobble", "PlazaStep%d_%d" % (q, k))
    # SHRUB BANKS AND TOPIARY, placed rather than scattered. The brief asks for
    # intentional clusters and explicitly not spam, so these sit where a
    # gardener would put them: a bank of shrubs behind each bed to give it a
    # back, and clipped standards flanking the four approaches like gateposts.
    for _i, _ba in enumerate((0.5, 1.6, 2.7, 3.8, 4.9, 5.9)):
        for _k in range(5):
            _sa = _ba + (_k - 2) * 0.11
            _sr = _PR + 560.0 + (_k % 2) * 70.0
            _shx, _shy = math.cos(_sa) * _sr, math.sin(_sa) * _sr
            if _shy < NEAR_Y + 120.0:
                continue
            kit_shrub(_shx, _shy,
                      0.95 + 0.22 * ((_i + _k) % 3),
                      "PlazaShrub%d_%d" % (_i, _k),
                      bloom=("rose" if (_i + _k) % 3 == 0 else
                             "petal_violet" if (_i + _k) % 3 == 1 else None))
    for _q, (_dx, _dy) in enumerate(((0.0, 1.0), (0.0, -1.0), (1.0, 0.0), (-1.0, 0.0))):
        for _side in (-1, 1):
            _tx = _dx * (_PR + 300.0) + (-_dy) * _side * 300.0
            _ty = _dy * (_PR + 300.0) + _dx * _side * 300.0
            # NOT IN THE CAMERA'S LAP. The south approach sits 5 m in front of
            # the hero eye; a 2 m topiary there is 72% of the frame's height and
            # is precisely the "giant object blocking view" the brief rules out.
            # NEAR_Y is where the frame opens onto the ground, derived from the
            # camera — anything nearer is either invisible or in the way, and a
            # tall object is the second one.
            if _ty < NEAR_Y + 250.0:
                continue
            kit_topiary_form(_tx, _ty, 1.15,
                             "PlazaTopiary%d_%d" % (_q, _side),
                             form=("spiral" if _q % 3 == 0 else
                                   "standard" if _q % 3 == 1 else "cone"))

    # LANDSCAPED BEDS just outside the kerb, each with its own border
    for i, (ba, br) in enumerate(((0.5, 250.0), (1.6, 200.0), (2.7, 260.0),
                                  (3.8, 210.0), (4.9, 240.0), (5.9, 190.0))):
        kit_bed(math.cos(ba) * (_PR + 330.0), math.sin(ba) * (_PR + 330.0), br, "Bed%d" % i,
                palette=(("petal_violet", "rose_pink", "petal_pink") if i % 2
                         else ("rose", "petal_pink", "petal_air")))
    # A CEREMONIAL PAVEMENT. The largest area of the founder's first frame was
    # carrying texture and no DESIGN: real ceremonial ground has order laid into
    # it, and order at this scale is what separates "expensive" from "paved".
    #
    # A banded border inside the kerb, gold inlay radiating from the circle, a
    # compass rose where the axes cross, and contrasting stone marking the four
    # approaches — all of it flat, so it enriches the foreground without putting
    # anything in front of the subject standing on it.
    for _b, (_br, _bw, _bm) in enumerate(((1120.0, 0.30, "stone"), (1080.0, 0.16, "gold"),
                                          (1040.0, 0.26, "cobble2"))):
        _n = max(40, int(_br / 14.0))
        for _i in range(_n):
            _a = _i * (2.0 * math.pi / _n)
            _part("cube", math.cos(_a) * _br, math.sin(_a) * _br, 7.2,
                  (2.0 * math.pi * _br / _n) / 92.0, _bw, 0.03, _bm,
                  "PaveBand%d_%d" % (_b, _i), rot=(0.0, 0.0, math.degrees(_a) + 90.0))
    # gold inlay radiating out of the circle to the border
    for _i in range(24):
        _a = _i * (2.0 * math.pi / 24.0)
        for _k in range(9):
            _t = (_k + 0.5) / 9.0
            _rr = 380.0 + _t * 640.0
            _part("cube", math.cos(_a) * _rr, math.sin(_a) * _rr, 7.3,
                  0.42, 0.045 + 0.03 * (1.0 - _t), 0.028,
                  "gold" if _i % 2 else "brass_deep", "PaveRay%d_%d" % (_i, _k),
                  rot=(0.0, 0.0, math.degrees(_a)))
        # a lozenge where each ray meets the border
        _part("cube", math.cos(_a) * 1005.0, math.sin(_a) * 1005.0, 7.4,
              0.26, 0.26, 0.03, "porcelain" if _i % 3 else "rose",
              "PaveStud%d" % _i, rot=(0.0, 0.0, math.degrees(_a) + 45.0))
    # contrasting stone marking the four ways in
    for _q, (_dx, _dy) in enumerate(((0.0, 1.0), (0.0, -1.0), (1.0, 0.0), (-1.0, 0.0))):
        for _k in range(7):
            _rr = 560.0 + _k * 86.0
            _part("cube", _dx * _rr, _dy * _rr, 7.1,
                  1.05 if _dx == 0 else 0.34, 0.34 if _dx == 0 else 1.05, 0.026,
                  "cobble2" if _k % 2 else "plaza", "PaveWay%d_%d" % (_q, _k))

    # CRACKS in the paving, glowing violet where the arcane circle runs under it.
    # "occasional cracks" and "purple magical spill near arcane areas" in one
    # element: the magic is IN the ground rather than painted on top of it.
    for i in range(26):
        a = i * 2.39996
        r0 = 330.0 + (i % 5) * 60.0
        for k in range(7):
            t = (k + 0.5) / 7.0
            rr = r0 + t * 520.0
            wob = math.sin(t * 6.0 + i) * 0.16
            _part("cube", math.cos(a + wob) * rr, math.sin(a + wob) * rr, 7.4,
                  0.34, 0.055, 0.02,
                  # A GRADIENT, because that is what a spill is: the ring's own
                  # radiance at the lip, falling through two dimmer steps into
                  # an unlit crack. Flat-bright to 45% of the run put 78 strips
                  # at peak radiance across the plaza right in front of the
                  # camera, which is a second light source, not a leak.
                  ("arcane" if t < 0.16 else
                   "arcane_dim" if (t < 0.34 and "arcane_dim" in MATS) else
                   "arcane_faint" if (t < 0.55 and "arcane_faint" in MATS) else
                   "dog_visor"), "Crack%d_%d" % (i, k),
                  rot=(0.0, 0.0, math.degrees(a + wob) + 4.0))
    # flowers and mushrooms taking hold at the path edges
    for i in range(40):
        a = i * 2.39996
        rr = _PR + 60.0 + (i % 4) * 40.0
        px, py = math.cos(a) * rr, math.sin(a) * rr
        if _on_stage(px, py):
            continue
        flower(px, py, i)
        if i % 5 == 0:
            kit_mushroom(px + 26.0, py - 18.0, 0.24 + 0.10 * (i % 3), "EdgeCap%d" % i,
                         "mush_purple" if i % 3 else "mush_red")
    # Cobblestone boulevard (N-S) + radial paths from the plaza to the gate and the
    # great tree — the premium walkable spine of the district.
    kit_path(0, -1450, 0, 1250, 470, "BLVD")
    kit_path(0, 0, -1050, 400, 340, "PATH_gate")
    kit_path(0, 0, 1300, 470, 340, "PATH_tree")
    kit_path(-1150, 0, 1150, 0, 300, "PATH_cross")
    # The Wandering Relay Dog, on the arcane circle, facing the arrival camera.
    # THE DOG IS THE SUBJECT. At the world origin it stands 26 m from the hero
    # camera and subtends about three degrees — a detail, not a foreground
    # character. On the arrival plaza it is 10 m out and reads as the figure the
    # frame is about, which is what PASS 8 asks for. Slightly off the centre
    # line so the composition is not a bullseye, and roaming a short leash so it
    # stays in frame while it lives.
    # ON THE CIRCLE, AND IN FRAME. Forward of it the Dog fell below the bottom
    # edge; at the world origin it was 26 m away and read as a detail. On the
    # southern arc of the arcane circle it is about 13 m out, a quarter of the
    # frame's height, and standing on the violet ring that is its Relay identity
    # — which is exactly the foreground the brief describes.
    stroll_dog(60.0, -760.0, "RelayDog", s=2.1, is_hero=True, roam=230.0)
    # (The travelling arrival ring is gone: with the camera fixed the Dog stands
    # on the real arcane circle, so a second one would only sit inside the first.)
    # A DRIFT OF KEYS, not three of them. They read as a current of magic moving
    # toward the Build Gate, which is where the brief wants the eye to go next.
    for i, (kx, ky, kz) in enumerate([(-640, 240, 430), (540, 120, 520), (240, 780, 560),
                                      (-880, 40, 610), (-1180, 250, 700), (-380, -180, 480),
                                      (760, -320, 560), (120, -560, 640), (980, 640, 690),
                                      (-160, 1150, 720)]):
        kit_float_key(kx, ky, kz, "FloatKey%d" % i)
    # LAMP POSTS + GARLANDS down the boulevard. Vertical rhythm, warm light in
    # the middle distance, and the card motif at a readable size.
    # OUT OF THE FRAME'S THROAT. At x = +/-430 these sat fifteen degrees off the
    # hero axis with the nearest pair 16 m from the camera — they fenced the
    # boulevard instead of framing it. Pushed to the verges, shrunk, and the
    # nearest pair deleted entirely so the first thing the eye meets is the Dog.
    _lamp_y = (-520.0, 40.0, 620.0, 1200.0)
    for _e in (-1, 1):
        for _i, _ly in enumerate(_lamp_y):
            kit_lantern(_e * 660.0, _ly, 0.82, "Lamp%d_%d" % (_e, _i))
            # garlands on alternate spans only: strung between every pair they
            # read as one continuous band of confetti across the middle of the
            # frame rather than as bunting
            if _i and _i % 2 == 1:
                kit_garland(_e * 660.0, _lamp_y[_i - 1], _e * 660.0, _ly, 352.0,
                            "Garl%d_%d" % (_e, _i), sag=78.0)
    # BUTTERFLIES over the planting, BIRDS in the sky. Both ride the bob offset,
    # so they live in the stream and vanish in a still — ambient life, never a
    # status channel.
    scatter(140.0, 420.0, 34, 1450.0, butterfly)
    for _f, (_fx, _fy, _fz) in enumerate(((-5200.0, 14000.0, 6200.0), (7400.0, 19000.0, 7600.0),
                                          (1800.0, 26000.0, 9000.0))):
        for _k in range(7):
            kit_bird(_fx + _k * 620.0 - (_k % 3) * 260.0,
                     _fy + _k * 420.0, _fz + (_k % 4) * 210.0, _f * 7 + _k)
    # Restrained magical motes: static emissive sparkles (gold/cyan/violet) drifting
    # over the district — the bloom pass gives them a firefly glow.
    scatter(0.0, 350.0, 38, 1950.0, mote)
    scatter(0.0, 300.0, 34, 1500.0, air_petal)   # drifting petals overhead — living air
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
    # THE DISTANCE LADDER. Four bands, each further, larger and paler than the
    # last, so the eye can measure the world by comparing them. The previous
    # skyline put every tower between 2 km and 3.6 km at a uniform 14 m — one
    # band, no ladder, and therefore no depth however good the materials were.
    #
    # A band is kept OUT of the near arc behind the camera: a tower at the
    # player's back is invisible in every framing and still costs a draw.
    castle_bodies = ("spire_pink", "spire", "spire_blue", "spire", "spire_teal", "spire_pink")
    castle_roofs = ("roof_pink", "gold", "roof_rose", "spire_teal", "gold", "roof_pink")
    for band, (d0, d1, count, s0, s1, body) in enumerate((
            (9000.0, 13000.0, 15, 1.7, 2.9, None),
            (22000.0, 30000.0, 19, 4.0, 6.6, "spire_far"),
            (62000.0, 84000.0, 21, 11.0, 19.0, "spire_far"))):
        for i in range(count):
            a = i * 2.39996 + band * 0.83
            t = ((i * 29 + band * 7) % 11) / 11.0
            dist = d0 + (d1 - d0) * t
            bx = math.cos(a) * dist
            by = math.sin(a) * dist + 2000.0
            if by < 3000.0:
                continue
            # A tower standing alone on grass is a lollipop. Low roofs around
            # its foot are what make a skyline read as a TOWN the towers belong
            # to, and they cost four boxes each.
            if band < 2:
                for _h in range(5):
                    _ha = a + (_h - 2) * 0.055
                    _hd = dist * (0.985 + 0.006 * ((_h * 7 + i) % 5))
                    _hx, _hy = math.cos(_ha) * _hd, math.sin(_ha) * _hd + 2000.0
                    _hs = (s0 + (s1 - s0) * t) * (34.0 + 12.0 * ((_h * 5 + i) % 4))
                    _part("cube", _hx, _hy, _hs * 0.5, _hs / 90.0, _hs / 110.0, _hs / 100.0,
                          "spire_far", "TownB%dS%dH%d" % (band, i, _h))
                    _part("cone", _hx, _hy, _hs * 1.32, _hs / 62.0, _hs / 78.0, _hs / 88.0,
                          "roof_rose" if (_h + i) % 2 else "roof_pink",
                          "TownB%dS%dR%d" % (band, i, _h))
            # OVERLAP IS WHAT MAKES A SKYLINE DENSE. Every third position is a
            # BLOCK of towers on a shared podium with bridges and a dome rather
            # than one spire, so near towers cut across far ones instead of
            # standing apart from them like chess pieces.
            _bs = s0 + (s1 - s0) * t
            if i % 3 == 0:
                kit_towerblock(bx, by, _bs * 0.78, "BlockB%dS%d" % (band, i),
                               body=body or castle_bodies[i % len(castle_bodies)],
                               roof=castle_roofs[i % len(castle_roofs)])
            else:
                kit_spire(bx, by, _bs, "SkylineB%dS%d" % (band, i), detail=(1 if band == 0 else 0),
                          body_mat=body or castle_bodies[i % len(castle_bodies)],
                          roof_mat=castle_roofs[i % len(castle_roofs)] if body is None
                          else ("roof_pink" if i % 3 else "roof_rose"),
                          flag=(i % 3 == 0))
    # A CANOPY LAYER, not one tree. The reference is full of huge enchanted
    # trees; this world had exactly one, so everything but the left edge of the
    # frame sat under open sky with nothing at canopy scale in it. These are
    # deliberately smaller than the Great Framing Tree so it keeps its job, and
    # each is placed to do something the composition needs rather than to fill
    # space: two closing the right beyond the gate, one massing behind the Agent
    # Garden, one over the Project Field.
    _greats = 0
    # Positions measured, not guessed. The first attempt put one of these 11 m
    # from the hero camera, where a giant tree is six times the frame's height
    # and is exactly the "giant object blocking view" the brief rules out, and
    # another entirely outside the frustum. Nothing of canopy scale belongs
    # inside the near band; these sit 20-35 m out, flanking.
    for _i, (_gx, _gy, _gs) in enumerate(((-1950.0, 1250.0, 0.95),
                                          (-2750.0, 2300.0, 1.10),
                                          (1650.0, 1850.0, 1.05),
                                          (2250.0, 2750.0, 1.00))):
        if _in_corridor(_gx, _gy) or _on_stage(_gx, _gy):
            continue
        if in_camera_lap(_gx, _gy, 600.0):
            continue
        kit_tree(_gx, _gy, _gs, "GreatTree%d" % _i, giant=True)
        # buttress roots, the thing that stops a big trunk reading as a post
        for _r in range(7):
            _a = _r * (2.0 * math.pi / 7.0) + _i
            kit_root(_gx, _gy, _a, (300.0 + 130.0 * ((_r * 5) % 3)) * _gs,
                     (0.62 + 0.20 * ((_r * 3) % 2)) * _gs, "GreatRoot%d_%d" % (_i, _r))
        # a ring of alpha-cut cards around the crown, so its edge is ragged
        if "leafcard" in MATS:
            for _c in range(9):
                _ca = _c * 0.698 + _i
                _part("cube", _gx + math.cos(_ca) * 330.0 * _gs,
                      _gy + math.sin(_ca) * 300.0 * _gs,
                      (980.0 * _gs) + math.sin(_ca * 1.4) * 120.0 * _gs,
                      3.4 * _gs, 0.03, 3.4 * _gs,
                      "leafcard_hi" if _c % 2 else "leafcard",
                      "GreatTreeCard%d_%d" % (_i, _c),
                      rot=(float((_c * 37) % 60) - 30.0, float((_c * 61) % 360),
                           float((_c * 23) % 40) - 20.0))
        # something hanging in each, the way the hero tree carries its clock
        if _i % 2 == 0:
            kit_float_key(_gx + 190.0 * _gs, _gy - 150.0 * _gs, 820.0 * _gs,
                          "GreatTreeKey%d" % _i)
        else:
            kit_teapot(_gx - 210.0 * _gs, _gy + 130.0 * _gs, 800.0 * _gs,
                       "GreatTreePot%d" % _i)
        _greats += 1
    unreal.log("GREAT TREES %d" % _greats)

    # THE NEAR QUARTER. Two terraces of townhouses standing 30-60 m out, well
    # clear of the hero sight-line, so the eye steps garden -> street -> town ->
    # skyline instead of jumping from planting to a horizon. Close enough that
    # their trim reads, which is the whole point: this is the band where
    # ornament is still legible and the far bands are silhouette.
    _bodies = ("spire", "spire_pink", "spire_blue", "spire_teal", "spire")
    _roofs = ("roof_rose", "roof_pink", "roof_rose", "gold", "roof_pink")
    _quarter = 0
    for _side in (-1, 1):
        for _i in range(9):
            _hx = _side * (2050.0 + 250.0 * ((_i * 5) % 3))
            _hy = 900.0 + _i * 640.0
            if abs(_hx) < 1500.0:
                continue
            kit_townhouse(_hx, _hy, (90.0 if _side > 0 else -90.0) + ((_i * 17) % 13) - 6.0,
                          1.05 + 0.24 * ((_i * 7) % 4) / 4.0,
                          "Town%d_%d" % (_side, _i),
                          body=_bodies[(_i + (_side > 0)) % len(_bodies)],
                          roof=_roofs[_i % len(_roofs)])
            _quarter += 1
    # a short parade facing the boulevard at the far end, closing the street
    for _i in range(5):
        kit_townhouse((_i - 2) * 700.0, 6100.0, 180.0 + ((_i * 23) % 11) - 5.0,
                      1.25 + 0.18 * (_i % 3),
                      "Parade%d" % _i, body=_bodies[_i % len(_bodies)],
                      roof=_roofs[(_i + 2) % len(_roofs)])
        _quarter += 1
    unreal.log("NEAR QUARTER %d townhouses" % _quarter)

    # THE SUBJECT. One great castle closing the north axis, slightly off centre
    # so the composition is not a bullseye, at a distance that makes it 130 m of
    # architecture rather than another turret.
    kit_castle(9000.0, 66000.0, 12.0, "GreatCastle")
    kit_castle(-30000.0, 36000.0, 8.5, "WestCastle")
    # Gentle rolling terrain: large low ground mounds sunk into the plane so only
    # their crowns show, breaking the dead-flat floor at the district edges.
    for i, (mx, my, mr) in enumerate([(-1650, -650, 8.0), (1750, -450, 7.0), (-2050, 1500, 9.0),
                                      (2150, 1300, 8.0), (0, -1980, 6.0)]):
        _part("sphere", mx, my, 100.0 - 21.0 * mr, mr, mr, mr * 0.42, "ground", "Mound%d" % i)
    # Signature Wonderland props: rose-heart topiaries flanking the deeper garden, a
    # giant Queen-of-Hearts teacup you could sit in, a fountain, floating clocks + a
    # teapot — the storybook furniture of the reference.
    # THE AGENT GARDEN AS A DESTINATION. Terrace, clipped hedge walls, a rose
    # walk leading in, and the C.A.R.D. pedestal as the thing it is all about.
    _GX, _GY = 820.0, 360.0
    for _k, (_rr, _hh, _mt) in enumerate(((5.6, 0.34, "stone"), (5.1, 0.30, "plaza"))):
        _part("cylinder", _GX, _GY, 18.0 + _k * 22.0, _rr, _rr, _hh, _mt, "GardenTerr%d" % _k)
    for _i in range(40):
        _a = _i * (2.0 * math.pi / 40.0)
        if math.cos(_a) < -0.55:                     # leave the entrance open
            continue
        # and never let the west arc of the hedge cross the hero sight-line
        if _GX + math.cos(_a) * 560.0 < 460.0:
            continue
        _part("cube", _GX + math.cos(_a) * 560.0, _GY + math.sin(_a) * 560.0, 92.0,
              0.95, 0.62, 1.80, "foliage_deep", "GardenHedge%d" % _i,
              rot=(0.0, 0.0, math.degrees(_a) + 90.0))
        _part("cube", _GX + math.cos(_a) * 560.0, _GY + math.sin(_a) * 560.0, 176.0,
              0.99, 0.68, 0.28, "foliage_spr", "GardenHedgeTop%d" % _i,
              rot=(0.0, 0.0, math.degrees(_a) + 90.0))
        if _i % 4 == 0:
            _part("sphere", _GX + math.cos(_a) * 585.0, _GY + math.sin(_a) * 585.0, 150.0,
                  0.20, 0.20, 0.20, "rose" if _i % 8 else "rose_pink", "GardenHedgeRose%d" % _i)
    for _k in range(3):                              # the rose walk in, from the
        kit_arch(_GX + 60.0, _GY - 620.0 - _k * 300.0, 0.62, "GardenArch%d" % _k)
    kit_card_pedestal(_GX, _GY, 1.25, "CardPedestal")
    for _b, _ba in enumerate((0.9, 2.2, 4.1, 5.3)):
        kit_bed(_GX + math.cos(_ba) * 350.0, _GY + math.sin(_ba) * 350.0, 130.0,
                "GardenBed%d" % _b,
                palette=("rose", "rose_pink", "petal_violet") if _b % 2
                else ("petal_pink", "petal_air", "petal_violet"))
    for _t, (_ta, _tf) in enumerate(((0.6, "cone"), (1.9, "spiral"), (3.4, "standard"),
                                     (4.7, "cone"), (5.6, "spiral"))):
        kit_topiary_form(_GX + math.cos(_ta) * 430.0, _GY + math.sin(_ta) * 430.0,
                         1.0, "GardenTop%d" % _t, form=_tf)
    for _t in range(7):
        _ta = _t * 0.898 + 0.3
        kit_shrub(_GX + math.cos(_ta) * 620.0, _GY + math.sin(_ta) * 620.0,
                  1.05, "GardenShrub%d" % _t,
                  bloom="rose_pink" if _t % 2 else "petal_violet")
    kit_heart_topiary(_GX - 300.0, _GY + 430.0, 40.0, 0.85, "GardenTopiaryA")
    kit_heart_topiary(_GX + 300.0, _GY + 430.0, 40.0, 0.85, "GardenTopiaryB")
    # THE MISSION OVERLOOK'S OWN SILHOUETTE, over the terrace it already has.
    kit_belvedere(620.0, -190.0, 0.72, "OverlookBelvedere")

    kit_heart_topiary(1180, 1150, 70.0, 1.5, "HeartTopiaryR")
    kit_heart_topiary(-1240, 1200, 70.0, 1.35, "HeartTopiaryL")
    # further back and smaller: at 35% of the frame it was competing with
    # the Observatory that closes the axis
    kit_teacup(1760, 900, 1.85, "GiantTeacup")
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
    def low_mat(x, y, i):
        """Mat-forming cover: wide, low, dark. Sits in the very front of the
        frame where anything upright would block the subject, and gives the
        first few metres a texture to read."""
        d = 0.34 + (i % 4) * 0.11
        _part("sphere", x, y, 5.0, d * 1.7, d * 1.5, 0.14,
              "foliage_deep" if i % 3 else "moss", "mat_%d" % i,
              rot=(0.0, 0.0, float((i * 47) % 360)))
        for k in range(3):
            a = (i * 37 + k * 120) % 360
            _part("cube", x + math.cos(math.radians(a)) * 13.0 * d,
                  y + math.sin(math.radians(a)) * 13.0 * d, 9.0,
                  d * 0.5, d * 0.06, d * 0.22,
                  "leaf" if (i + k) % 2 else "foliage", "mat%d_l%d" % (i, k),
                  rot=(74.0, float(a), 0.0))
        if i % 6 == 0:
            _part("sphere", x + 8.0, y - 6.0, 16.0, 0.13, 0.13, 0.12,
                  "petal_air" if i % 12 else "petal_violet", "mat%d_b" % i)

    def ground_cover(gx, gy, i):
        if math.hypot(gx, gy - 40.0) < 320.0:      # keep the Dog's arcane circle clear
            return
        if _on_stage(gx, gy):
            return
        # LAYERS, NOT THINNING. Emptying the near field stopped it walling off
        # the subject and cost the depth in the first ten metres. What the
        # reference actually has is a gradient of HEIGHT: mat-forming cover
        # nearest the camera, mid shrubs behind it, tall planting only past the
        # subject. Depth in the foreground, and still a clear view through.
        if gy < -1750.0:
            low_mat(gx, gy, i)
            return
        if gy < -1150.0:
            (low_mat if i % 2 else tuft)(gx, gy, i)
            return
        (flower if i % 3 else tuft)(gx, gy, i)
    # DRIFTS, NOT A CARPET. Phyllotaxis spreads perfectly evenly, which is the
    # most artificial distribution there is — it is why the foreground read as
    # confetti rather than as planting. Real colonies clump, with bare ground
    # between them, and the bare ground is what makes the clumps read. Same
    # total count, gathered: a scatter of COLONY CENTRES, each filled locally.
    def colony(cx, cy, i):
        n = 5 + (i % 6)
        for k in range(n):
            a = k * 2.39996 + i
            rr = 34.0 + 92.0 * math.sqrt((k + 0.4) / n)
            ground_cover(cx + math.cos(a) * rr, cy + math.sin(a) * rr, i * 7 + k)

    scatter(0.0, 300.0, 46, 1900.0, colony)
    scatter(120.0, 500.0, 28, 1500.0, colony)
    scatter(-140.0, 250.0, 18, 1150.0, colony)
    # AMANITAS GROW IN SOIL, IN FAMILIES, AT THE FOOT OF THINGS. Scattering
    # them by even phyllotaxis over the whole district put fungus on the paving
    # and gave the foreground a rash of identical caps — clutter, which the brief
    # names as the thing to avoid. Half as many, each one a family of three to
    # five around a dominant cap, and none of them on stone.
    def _on_stone(gx, gy):
        # the paved plaza, and the boulevard corridor running north
        if math.hypot(gx, gy) < 1180.0:
            return True
        return abs(gx) < 300.0 and -1150.0 < gy < 1250.0

    def mushroom_family(gx, gy, i):
        if _on_stone(gx, gy) or _in_corridor(gx, gy) or _on_stage(gx, gy):
            return
        cap = "mush_purple" if i % 4 == 0 else "mush_red"
        # smaller near the camera: a foreground cap at hero scale competes
        # with the subject standing next to it
        big = (0.52 + 0.26 * (i % 3)) * (0.62 if gy < NEAR_Y + 700.0 else 1.0)
        kit_mushroom(gx, gy, big, "GM%d" % i, cap)
        for k in range(2 + (i % 3)):
            a = (i * 2.39996 + k * 1.9)
            r = 42.0 + 30.0 * ((i + k) % 3) * big
            fx, fy = gx + math.cos(a) * r * big, gy + math.sin(a) * r * big
            if _on_stone(fx, fy):
                continue
            kit_mushroom(fx, fy, big * (0.34 + 0.14 * (k % 3)), "GM%d_%d" % (i, k), cap)

    # ...and pushed OUT of the near field. Fungus at the district edge frames
    # the plaza; fungus across the plaza floor is a rash in front of the subject.
    scatter(0.0, 900.0, 18, 2350.0,
            lambda gx, gy, i: None if (math.hypot(gx, gy + 700.0) < 1500.0
                                       or _on_stage(gx, gy))
            else mushroom_family(gx, gy, i))


    # ================= THE LAND BETWEEN ==================================
    # The middle third of every wide shot was an empty plane. Depth is not two
    # layers with a gap; it is continuous. Courtyard -> gardens -> fields and
    # woods and water -> town -> castle -> hills, each cooled a little more by
    # the aerial perspective than the last.
    #
    # Everything here is deliberately COARSE. It lives 40 m to 600 m out, where
    # a canopy is a few pixels across, so it is built from the cheapest forms
    # that carry the right silhouette and nothing else. Detail spent here would
    # be invisible and would cost the frame rate that keeps the stream usable.
    _land = 0
    # a green mid-meadow over the pale far plane, so the ground the town stands
    # on is grass rather than haze
    # THREE KILOMETRES, not 750 m. At the smaller size the plane's own edge
    # sat inside the haze gradient and showed as a step from green to pale —
    # a ruled line across the middle of the frame. Past 1.5 km the haze has
    # taken enough out of it that no edge is legible.
    static_mesh("plane", [0.0, 60000.0, -9.0], [3000.0, 3000.0, 1.0], "MidMeadow",
                mat="ground" if "ground" in MATS else "foliage")
    # rolling ground: wide shallow domes so the plane is never a plane
    for i in range(52):
        a = i * 2.39996
        d = 5200.0 + 46000.0 * (((i * 19) % 13) / 13.0) ** 0.7
        mx, my = math.cos(a) * d, math.sin(a) * d + 4000.0
        if my < 2600.0:
            continue
        w = 34.0 + 26.0 * ((i * 11) % 5) / 5.0
        static_mesh("sphere", [mx, my, -w * 34.0],
                    [w, w * 0.78, w * 0.42], "Roll%d" % i,
                    mat="ground" if "ground" in MATS else "foliage")
        _land += 1
    # WOODS. Groves read as woodland; evenly spread single trees read as an
    # orchard, and an orchard is what a scatter gives you unless you cluster.
    for i in range(30):
        a = i * 2.39996 + 0.4
        d = 6500.0 + 40000.0 * (((i * 23) % 11) / 11.0) ** 0.8
        gx, gy = math.cos(a) * d, math.sin(a) * d + 4200.0
        if gy < 3000.0:
            continue
        sc = 4.2 + 3.4 * ((i * 7) % 5) / 5.0
        for k in range(6 + (i % 4)):
            ka = k * 2.39996 + i
            kr = (26.0 + 62.0 * ((k * 13 + i) % 7) / 7.0) * sc
            tx, ty = gx + math.cos(ka) * kr, gy + math.sin(ka) * kr
            th = (170.0 + 90.0 * ((k * 5 + i) % 4) / 4.0) * sc
            static_mesh("cylinder", [tx, ty, th * 0.42], [sc * 0.24, sc * 0.24, th * 0.9 / 100.0],
                        "Wood%d_%d" % (i, k), mat="trunk")
            static_mesh("sphere", [tx, ty, th], [sc * 1.30, sc * 1.16, sc * 1.05],
                        "Wood%d_%dc" % (i, k),
                        mat="foliage" if (i + k) % 3 else "foliage_hi")
            _land += 2
    # HEDGEROWS. Fields need edges; the edges are what tell the eye how big the
    # ground is, which is most of how a landscape communicates distance.
    for i in range(16):
        a = i * 2.39996 + 1.1
        d = 9000.0 + 30000.0 * (((i * 17) % 9) / 9.0)
        hx, hy = math.cos(a) * d, math.sin(a) * d + 5000.0
        if hy < 3400.0:
            continue
        ang = (i * 47) % 180
        for k in range(14):
            ox = math.cos(math.radians(ang)) * (k - 7) * 640.0
            oy = math.sin(math.radians(ang)) * (k - 7) * 640.0
            static_mesh("cube", [hx + ox, hy + oy, 90.0], [6.6, 2.0, 1.9],
                        "Hedge%d_%d" % (i, k),
                        mat="foliage" if k % 2 else "foliage_hi", rotation=(0.0, 0.0, float(ang)))
            _land += 1
    # COTTAGES on the approach roads, so the town does not begin abruptly
    for i in range(16):
        a = i * 2.39996 + 2.2
        d = 7000.0 + 12000.0 * (((i * 29) % 7) / 7.0)
        cx, cy = math.cos(a) * d, math.sin(a) * d + 4000.0
        if cy < 3200.0:
            continue
        w = 3.0 + 1.4 * ((i * 13) % 4) / 4.0
        static_mesh("cube", [cx, cy, w * 46.0], [w, w * 0.74, w * 0.92], "Cot%d" % i,
                    mat="spire", rotation=(0.0, 0.0, float((i * 61) % 360)))
        static_mesh("cone", [cx, cy, w * 128.0], [w * 1.22, w * 0.96, w * 0.86], "Cot%dr" % i,
                    mat="roof_rose" if i % 2 else "roof_pink",
                    rotation=(0.0, 0.0, float((i * 61) % 360)))
        static_mesh("cube", [cx + w * 22.0, cy, w * 150.0], [w * 0.16, w * 0.16, w * 0.5],
                    "Cot%dch" % i, mat="stone")
        _land += 3
    # A LAKE, because water is the one surface that hands the sky back to the
    # ground and it is how the middle distance stops being one flat green.
    static_mesh("plane", [-19000.0, 27000.0, 40.0], [190.0, 130.0, 1.0], "MidLake", mat="water")
    for i in range(22):
        a = i * (2.0 * math.pi / 22.0)
        static_mesh("sphere", [-19000.0 + math.cos(a) * 9800.0, 27000.0 + math.sin(a) * 6700.0, 60.0],
                    [22.0, 22.0, 5.0], "LakeRim%d" % i, mat="ground")
        _land += 1
    unreal.log("LANDSCAPE %d mid-distance elements" % _land)


    # ================= NEAR FIELD =========================================
    # A third of the hero frame is the first fifteen metres, and it had emptied
    # to bare ground once the sight corridor and the Dog's stage were protected.
    # Everything here is deliberately LOW — under knee height — so it enriches
    # the foreground without becoming something the eye has to climb over.
    def near_ok(px, py):
        return (not _on_stage(px, py)) and (not _on_paving(px, py)) \
            and (not _in_corridor(px, py, half=330.0, y0=-1400.0, y1=1500.0))

    _near = 0
    # MOSSY BOULDER GROUPS. Rock is the cheapest way to give ground structure,
    # and moss on the shaded side is what stops it reading as a grey ball.
    # Placed relative to NEAR_Y, so they sit in the first few metres of ground
    # the frame can actually see rather than under it.
    for i, (bx, _byo, bs) in enumerate(((-1250.0, 40.0, 1.5), (-1620.0, 300.0, 1.1),
                                        (1300.0, 20.0, 1.4), (1680.0, 330.0, 1.0),
                                        (-880.0, 480.0, 0.9), (980.0, 520.0, 1.2))):
        by = NEAR_Y + _byo
        for k in range(4):
            a = k * 1.9 + i
            rx = bx + math.cos(a) * 70.0 * bs
            ry = by + math.sin(a) * 70.0 * bs
            rs = bs * (0.55 + 0.34 * ((k * 7 + i) % 4) / 4.0)
            _part("sphere", rx, ry, rs * 26.0, rs * 1.5, rs * 1.25, rs * 0.72, "stone",
                  "NearRock%d_%d" % (i, k), rot=(0.0, float((i * 31 + k * 47) % 360),
                                                 float((k * 23) % 22)))
            _part("sphere", rx - rs * 18.0, ry + rs * 14.0, rs * 44.0,
                  rs * 0.80, rs * 0.66, rs * 0.20, "moss", "NearMoss%d_%d" % (i, k))
            _near += 2
        for k in range(5):                       # ferns tucked against the rock
            a = k * 1.3 + i * 0.7
            tuft(bx + math.cos(a) * 130.0 * bs, by + math.sin(a) * 130.0 * bs, i * 11 + k)
            _near += 1

    # ROOT RUNS breaking the surface, as the addendum asks for. They also tie the
    # foreground to the great tree the eye has just travelled past.
    for i in range(7):
        a = 2.1 + i * 0.42
        rx = math.cos(a) * (1350.0 + 220.0 * (i % 3))
        ry = NEAR_Y + 120.0 + 190.0 * (i % 4)
        if not near_ok(rx, ry):
            continue
        kit_root(rx, ry, a + 1.6, 300.0 + 120.0 * (i % 3), 0.42 + 0.12 * (i % 2),
                 "NearRoot%d" % i)
        _near += 8

    # FALLEN PETALS AND LEAVES lying flat on the ground. Almost free, and it is
    # what makes ground read as ground that things grow over rather than a plane.
    def litter(px, py, i):
        if not near_ok(px, py):
            return
        col = ("petal_pink", "petal_air", "rose_pink", "leaf", "leaf_hi",
               "petal_violet")[i % 6]
        _part("sphere", px, py, 3.4, 0.15, 0.09, 0.012, col, "Litter%d" % i,
              rot=(0.0, 0.0, float((i * 53) % 360)))

    scatter(0.0, NEAR_Y + 420.0, 210, 1350.0, litter)
    _near += 190

    # COLONIES filling the near corners, outside the corridor and the stage
    def near_colony(cx, cy, i):
        if not near_ok(cx, cy):
            return
        for k in range(4 + (i % 5)):
            a = k * 2.39996 + i
            rr = 30.0 + 84.0 * math.sqrt((k + 0.4) / 8.0)
            px, py = cx + math.cos(a) * rr, cy + math.sin(a) * rr
            if not near_ok(px, py):
                continue
            (low_mat if (i + k) % 3 else flower)(px, py, i * 9 + k)

    scatter(0.0, NEAR_Y + 380.0, 40, 1300.0, near_colony)
    _near += 34

    # FLOWERS IN THE JOINTS. "flowers between stones" — they take hold at the
    # edge of the paving where the mortar has given way.
    for i in range(54):
        a = i * 2.39996
        rr = 1180.0 + 46.0 * (i % 3)
        px, py = math.cos(a) * rr, math.sin(a) * rr
        if _in_corridor(px, py, half=300.0) or _on_stage(px, py):
            continue
        _part("cylinder", px, py, 12.0, 0.035, 0.035, 0.22, "foliage_deep",
              "JointStem%d" % i)
        _part("sphere", px, py, 26.0, 0.13, 0.13, 0.12,
              ("petal_violet", "petal_air", "rose_pink")[i % 3], "JointBloom%d" % i)
        _near += 2

    # REPOUSSOIR at the extreme frame edges, well outside the sight corridor:
    # tall grasses and ferns that the eye reads as "near" and never has to see
    # past, which is what gives a wide shot its sense of standing somewhere.
    # AT THE FRAME EDGE, WHICH IS NARROWER THAN IT LOOKS. 1,100 uu ahead the
    # frame is only about 715 uu wide either side of the axis, so grasses at
    # |x| = 1500 were as absent as the ones that were under the bottom edge.
    # Derived from the same camera the ground band comes from.
    _edge_x = (NEAR_Y - _CAM_Y) * math.tan(math.radians(33.0))
    for e in (-1, 1):
        for k in range(9):
            gx = e * (_edge_x * (0.88 + 0.07 * (k % 3)))
            gy = NEAR_Y + 30.0 + 90.0 * k
            for b in range(7):
                ba = b * 0.9 + k
                _part("cube", gx + math.cos(ba) * 26.0, gy + math.sin(ba) * 26.0, 96.0,
                      0.10, 0.028, 1.9, "foliage_deep" if b % 2 else "foliage",
                      "EdgeGrass%d_%d_%d" % (e, k, b),
                      rot=(float(9 + (b * 7) % 16), float((b * 51) % 360), 0.0))
            _near += 7
    unreal.log("NEAR FIELD %d elements" % _near)

    # --- Water features ---------------------------------------------------
    for w in layout.get("waterFeatures", []):
        s = scale_for_radius(w.get("radiusUu", 100))
        static_mesh(w.get("mesh", "water_plane"), w["center"], [s, s, 1.0], "WATER_%s" % w["id"])
        # STILL WATER IS A MIRROR. What makes a pool read as water is the
        # disturbance at its edge: a stone rim, foam where it meets the stone,
        # and ripple rings spreading across the surface.
        _wc = w["center"]
        _wr = float(w.get("radiusUu", 100))
        for _i in range(30):
            _a = _i * (2.0 * math.pi / 30.0)
            _part("cube", _wc[0] + math.cos(_a) * _wr, _wc[1] + math.sin(_a) * _wr,
                  float(_wc[2]) + 16.0, (2.0 * math.pi * _wr / 30.0) / 92.0, 0.44, 0.36,
                  "stone", "%s_rim%d" % (w["id"], _i), rot=(0.0, 0.0, math.degrees(_a) + 90.0))
            _part("sphere", _wc[0] + math.cos(_a) * (_wr - 26.0),
                  _wc[1] + math.sin(_a) * (_wr - 26.0), float(_wc[2]) + 6.0,
                  0.34, 0.28, 0.05, "spray" if "spray" in MATS else "porcelain",
                  "%s_foam%d" % (w["id"], _i))
        for _r in range(4):
            _rr = _wr * (0.30 + 0.17 * _r)
            for _i in range(24):
                _a = _i * (2.0 * math.pi / 24.0)
                _part("cube", _wc[0] + math.cos(_a) * _rr, _wc[1] + math.sin(_a) * _rr,
                      float(_wc[2]) + 3.0, (2.0 * math.pi * _rr / 24.0) / 105.0, 0.10, 0.012,
                      "spray" if "spray" in MATS else "porcelain",
                      "%s_ripple%d_%d" % (w["id"], _r, _i),
                      rot=(0.0, 0.0, math.degrees(_a) + 90.0))
        for _i in range(11):                       # lilies on the reflecting pool
            _a = _i * 2.39996
            _lr = _wr * 0.78 * math.sqrt((_i + 0.5) / 11.0)
            _lx, _ly = _wc[0] + math.cos(_a) * _lr, _wc[1] + math.sin(_a) * _lr
            _part("cylinder", _lx, _ly, float(_wc[2]) + 5.0, 0.60, 0.60, 0.02,
                  "foliage_hi", "%s_pad%d" % (w["id"], _i))
            if _i % 2 == 0:
                _part("sphere", _lx + 18.0, _ly, float(_wc[2]) + 14.0, 0.17, 0.17, 0.16,
                      "petal_air" if _i % 4 else "petal_violet", "%s_lily%d" % (w["id"], _i))

    # --- Benches (dressing; placeholder cube, facing baked from data) -----
    for b in layout.get("benchPoints", []):
        _bl = b["location"]
        kit_bench(float(_bl[0]), float(_bl[1]), float(b.get("facingYawDeg", 0.0)),
                  "BENCH_%s" % b["id"])

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
                scatter(ctr[0], ctr[1], min(n, 220), rad,
                        lambda x, y, i: (low_mat if _in_corridor(x, y) else tuft)(x, y, i),
                        keep_clear=PLAZA_CLEAR)
            elif key == "flowerBeds":
                n = int(c.get("count", 0)) or int(26 * area)
                scatter(ctr[0], ctr[1], min(n, 200), rad, flower,
                        keep_clear=PLAZA_CLEAR)
            else:
                n = int(c.get("count", 0)) or int(10 * area)
                scatter(ctr[0], ctr[1], min(n, 70), rad,
                        lambda x, y, i: None if (_on_paving(x, y) or _in_corridor(x, y)) else
                        kit_mushroom(x, y, 0.30 + 0.13 * (i % 4),
                                     "mini%d" % i, "mush_purple" if i % 2 else "mush_red"),
                        keep_clear=PLAZA_CLEAR)

    # --- Paths: one locator per point (real splines/nav are M2) -----------
    def place_path(path, prefix, width=170.0, paved=True):
        pts = path.get("points", [])
        for i, pt in enumerate(pts):
            marker(pt, "%s_%s_%02d" % (prefix, path.get("id", "path"), i), tags=[path.get("id")])
        if not paved:
            return
        # LAY REAL STONE. The paths existed only as invisible locators, so the
        # plaza had no route through it and nothing led the eye toward the city.
        # A paved way running from the foreground into the distance is most of
        # where the reference gets its depth. Flags are laid along each segment,
        # alternating tone, with an edging kerb and moss in the joints.
        for i in range(len(pts) - 1):
            ax, ay = float(pts[i][0]), float(pts[i][1])
            bx, by = float(pts[i + 1][0]), float(pts[i + 1][1])
            dx, dy = bx - ax, by - ay
            seg = math.hypot(dx, dy)
            if seg < 1.0:
                continue
            yaw = math.degrees(math.atan2(dy, dx))
            steps = max(1, int(seg / (width * 0.62)))
            for k in range(steps):
                t = (k + 0.5) / steps
                px, py = ax + dx * t, ay + dy * t
                hsh = (int(px) * 73856093) ^ (int(py) * 19349663) ^ (i * 83492791)
                mat = ("cobble", "cobble2", "plaza")[hsh % 3]
                jitter = 0.90 + ((hsh >> 4) % 7) * 0.018
                _part("cube", px, py, 4.5, width / 100.0 * jitter,
                      width * 0.60 / 100.0 * jitter, 0.05, mat,
                      "%s_flag_%d_%d" % (prefix, i, k), rot=(0.0, 0.0, yaw + ((hsh >> 9) % 7) - 3.0))
                # kerb stones either side, and moss where they meet
                for sgn in (-1, 1):
                    kx = px + math.cos(math.radians(yaw + 90.0)) * width * 0.60 * sgn
                    ky = py + math.sin(math.radians(yaw + 90.0)) * width * 0.60 * sgn
                    _part("cube", kx, ky, 6.5, 0.30, 0.22, 0.09,
                          "stone" if "stone" in MATS else mat,
                          "%s_kerb_%d_%d_%d" % (prefix, i, k, sgn), rot=(0.0, 0.0, yaw))
                    if hsh % 3 == 0:
                        _part("sphere", kx, ky, 7.0, 0.16, 0.16, 0.06, "moss",
                              "%s_kmoss_%d_%d_%d" % (prefix, i, k, sgn))

                # ---- VERGE DRESSING ---------------------------------
                # The ground is about forty per cent of the hero frame and
                # was carrying almost no incident: smooth rolls, smooth
                # lawn, smooth paving. That is the "huge featureless lawn"
                # the art direction names, and the tempting fix — scatter
                # ten thousand small things uniformly — produces the OTHER
                # thing it names, obvious procedural repetition. Uniform
                # noise reads as noise at any density.
                #
                # So the dressing is RELATIONAL: it derives from the path's
                # own geometry and clumps where a real one would. Petals
                # and leaves drift against a kerb rather than lying evenly
                # across a lawn; grass thickens where mowing cannot reach;
                # puddles sit in the low spots of worn paving. Placement
                # is hash-driven from world position, so a rebuild lays
                # the identical mess.
                _nx = math.cos(math.radians(yaw + 90.0)) * sgn
                _ny = math.sin(math.radians(yaw + 90.0)) * sgn

                # a DRIFT of fallen petals and leaves piled against the kerb
                if (hsh >> 17) % 3 == 0:
                    _n = 6 + ((hsh >> 19) % 5)
                    for _d in range(_n):
                        # tight to the kerb, thinning outward — a drift, not a disc
                        _out = 14.0 + (_d / float(_n)) ** 1.7 * 96.0
                        _along = ((((hsh >> (_d + 3)) % 23) - 11) / 11.0) * 74.0
                        _px = kx + _nx * _out + math.cos(math.radians(yaw)) * _along
                        _py = ky + _ny * _out + math.sin(math.radians(yaw)) * _along
                        _m = ("petal_pink", "petal_violet", "rose_pink",
                              "leaf", "leaf_hi")[(hsh + _d) % 5]
                        _part("cube", _px, _py, 5.0 + (_d % 2) * 0.6,
                              0.12 + (_d % 3) * 0.03, 0.10 + (_d % 3) * 0.03, 0.012,
                              _m, "%s_drift_%d_%d_%d_%d" % (prefix, i, k, sgn, _d),
                              rot=(0.0, 0.0, float(((hsh >> _d) * 37) % 180)))

                # grass thickening where a mower cannot reach — hard against
                # the stone, never out in the open where it would read as spam
                if (hsh >> 21) % 2 == 0:
                    for _g in range(2 + ((hsh >> 23) % 3)):
                        _go = 8.0 + ((hsh >> (_g + 5)) % 13) * 2.2
                        _ga = ((((hsh >> (_g + 9)) % 17) - 8) / 8.0) * 62.0
                        tuft(kx + _nx * _go + math.cos(math.radians(yaw)) * _ga,
                             ky + _ny * _go + math.sin(math.radians(yaw)) * _ga,
                             (hsh + _g) % 97)

                # a puddle in a worn hollow, with the darker wet stone around
                # it — one of the few things that puts SKY into the ground
                if sgn == 1 and (hsh >> 13) % 9 == 0:
                    _pd = 0.30 + ((hsh >> 25) % 5) * 0.06
                    _part("cylinder", px, py, 5.4, _pd * 1.55, _pd * 1.25, 0.010,
                          "stone", "%s_wet_%d_%d" % (prefix, i, k))
                    _part("cylinder", px, py, 5.9, _pd, _pd * 0.80, 0.012,
                          "water", "%s_pool_%d_%d" % (prefix, i, k))

    paths = layout.get("paths", {})
    if isinstance(paths.get("main"), dict):
        place_path(paths["main"], "PATH", width=210.0)
    for s in paths.get("secondary", []):
        place_path(s, "TRAIL", width=120.0)
    if isinstance(paths.get("hidden"), dict):
        place_path(paths["hidden"], "HIDDEN", paved=False)

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
    # ---- WORLD REPORT ------------------------------------------------
    # Logged at warning level on purpose: LogPython Display is filtered out of
    # the packaged build log, so anything logged at Display is invisible
    # afterwards. Builds here are expensive and rare enough that the log has to
    # answer "did the texture inputs wire, did the masked foliage master build,
    # where does the frame open onto the ground" without needing a capture to
    # infer it from.
    try:
        _mp = "/Game/Wonderland/Materials/"
        _has = unreal.EditorAssetLibrary.does_asset_exist
        unreal.log_warning(
            "WORLD REPORT textures=%d materials=%d leafcards=%d master=%s leafmaster=%s "
            "ground_band_y=%.0f"
            % (_REPORT.get("textures", -1), _REPORT.get("materials", -1),
               _REPORT.get("leafcards", -1),
               "yes" if _has(_mp + "M_WLMaster") else "MISSING",
               "yes" if _has(_mp + "M_WLLeaf") else "no",
               NEAR_Y))
    except Exception as _re:
        unreal.log_warning("world report failed: %s" % _re)

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
