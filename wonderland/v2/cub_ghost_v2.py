"""THE RELAY DOG SUB-AGENT CUB GHOST, BUILT IN UNREAL -- from cub_canon's numbers.

Runs inside the UE 5.8 editor (the world lane's channel job build_cub_ghost.py calls build_all()).
It builds, in order:

  1. M_V2_Ghost -- a TRANSLUCENT UNLIT master, which this project did not have. Every V2 master
     (Surface, Portal, Foliage) is BLEND_OPAQUE, measured 2026-09-22, so there was no way to make a
     translucent lower body out of what existed. Unlit is a deliberate choice, not a shortcut: a
     ghost is light rather than a lit surface, it removes this creature's most-drawn material from
     every shadow and lighting pass, and twelve of them at once is the stated target.
  2. MI_RelayDogCub_{Pearl,Visor,Eye,Ghost} -- pearl/visor/eye on the same masters the canonical Dog
     uses, with the Dog's own visor and eye values.
  3. SM_RelayDogCub_<joint>_<surface> -- one mesh per joint per surface, boxes merged in the JOINT'S
     OWN frame, so a joint rotates its part about the canonical pivot exactly as the Dog's does.
  4. BP_RelayDogCub -- an AActor (deliberately not a Character: a Cub floats, is presentation, and
     must never carry a movement capsule or collide) whose hierarchy is
     Root -> Pivot_<joint> -> Mesh_<joint>_<surface>, plus the VFX_* sockets from cub_canon.

COLLISION, STATED ONCE: nothing this file builds collides with anything. Meshes are saved with
collision=False and every component is set NoCollision. Internal Development asked for exactly this
-- Cubs are floating presentation actors -- and the world lane's BR01 collision pass cannot reach
them either, since it only touches WonderlandInstancedBatch actors.

SPAWN AND RUNTIME ARE NOT HERE. Where a Cub appears, when it emerges, how it follows and when it
dissolves belong to Internal Development. This file delivers the body, the pivots, the sockets and
the materials they drive.
"""
import os
import sys

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import cub_canon as C   # noqa: E402
import gs               # noqa: E402

CONTENT_ROOT = "/Game/WonderlandV2"
CUB_FOLDER = CONTENT_ROOT + "/Characters/RelayDogCub"
MASTER_FOLDER = CONTENT_ROOT + "/Materials/Master"
GHOST_MASTER = MASTER_FOLDER + "/M_V2_Ghost"
BP_NAME = "BP_RelayDogCub"

#: One HEAD_WIDTH in centimetres. 26 makes the Cub 63 cm tall against the Dog's 174 -- a third of
#: its height, floating at about the Dog's hip. "Clearly smaller than the primary Relay Dog", which
#: is the founder's wording, and still large enough that the visor and eyes read in a group shot.
W_UU = float(os.environ.get("WL_CUB_HEAD_WIDTH_UU", "26"))
#: How far above the floor the runtime should hover the actor's origin. The wisp hangs ~4 cm below
#: the origin, so anything under ~10 cm buries the tip.
HOVER_UU = 30.0


#: Filled in by build_ghost_master so a caller can report what actually got wired.
GHOST_WIRING = {}


def LOG(msg):
    unreal.log_warning("CUB " + str(msg))


def lin(hex_colour, a=1.0):
    r, g, b = __import__("dog_canon").srgb_to_linear(hex_colour)
    return unreal.LinearColor(r, g, b, a)


# ------------------------------------------------------------------ the ghost master
def build_ghost_master(rebuild=True):
    """A translucent, unlit, two-sided material: emissive is a core-to-rim gradient driven by
    fresnel, opacity is that same fresnel plus a vertical fade down the wisp. Returns the asset.

    rebuild=False REUSES an existing master. Deleting and recreating a MASTER material invalidates
    every permutation that referenced it: one rebuild cost 1,871 seconds of shader thread time and
    440 Nanite rasterizer compiles. The look is tuned on the INSTANCE, so only a change to the graph
    itself needs the expensive path."""
    eal = unreal.EditorAssetLibrary
    mel = unreal.MaterialEditingLibrary
    if not rebuild and eal.does_asset_exist(GHOST_MASTER):
        LOG("GHOST MASTER reused (no graph change, no shader recompile)")
        return eal.load_asset(GHOST_MASTER)
    if eal.does_asset_exist(GHOST_MASTER):
        eal.delete_asset(GHOST_MASTER)
    mat = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        "M_V2_Ghost", MASTER_FOLDER, unreal.Material, unreal.MaterialFactoryNew())
    if mat is None:
        raise RuntimeError("M_V2_Ghost was not created")
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    mat.set_editor_property("two_sided", True)
    for prop, val in (("cast_dynamic_shadow_as_masked", False), ("allow_translucent_custom_depth_writes", True)):
        try:
            mat.set_editor_property(prop, val)
        except Exception:
            pass

    def E(cls, x, y):
        return mel.create_material_expression(mat, cls, x, y)

    def scalar(name, value, x, y):
        e = E(unreal.MaterialExpressionScalarParameter, x, y)
        e.set_editor_property("parameter_name", unreal.Name(name))
        e.set_editor_property("default_value", float(value))
        return e

    def vector(name, hex_colour, x, y):
        e = E(unreal.MaterialExpressionVectorParameter, x, y)
        e.set_editor_property("parameter_name", unreal.Name(name))
        e.set_editor_property("default_value", lin(hex_colour))
        return e

    def const(value, x, y):
        e = E(unreal.MaterialExpressionConstant, x, y)
        e.set_editor_property("r", float(value))
        return e

    # EVERY CONNECTION IS CHECKED. The first build set the blend mode, the shading model and all six
    # parameters correctly -- the probe confirmed every one of them -- and still rendered a dark
    # dithered cone, because an unlit material whose Emissive input is connected to NOTHING emits
    # black and nobody had looked at a single return value. connect_material_expressions answers
    # True or False; ignoring that answer is what cost a render.
    wiring = {"ok": [], "failed": []}

    def link(a, a_out, b, b_in):
        ok = False
        try:
            ok = bool(mel.connect_material_expressions(a, a_out, b, b_in))
        except Exception as exc:
            wiring["failed"].append("%s -> %s.%s raised %s" % (a.get_class().get_name(), b.get_class().get_name(), b_in, exc))
            return False
        (wiring["ok"] if ok else wiring["failed"]).append(
            "%s -> %s.%s" % (a.get_class().get_name(), b.get_class().get_name(), b_in))
        return ok

    def to_property(expr, prop, label):
        ok = False
        try:
            ok = bool(mel.connect_material_property(expr, "", prop))
        except Exception as exc:
            wiring["failed"].append("%s raised %s" % (label, exc))
            return False
        (wiring["ok"] if ok else wiring["failed"]).append(label)
        return ok

    g = C.MATERIALS["ghost"]
    # --- the rim. A ghost is brightest where you see through the most of it.
    rim_power = scalar("RimPower", g["rim_power"], -1500, 40)
    fresnel = E(unreal.MaterialExpressionFresnel, -1200, 40)
    link(rim_power, "", fresnel, "ExponentIn")

    # --- emissive: core colour at the face, rim colour at the edge, times brightness
    core = vector("GhostCore", g["core"], -1500, -260)
    rim = vector("GhostRim", g["rim"], -1500, -140)
    grad = E(unreal.MaterialExpressionLinearInterpolate, -1000, -200)
    link(core, "", grad, "A")
    link(rim, "", grad, "B")
    link(fresnel, "", grad, "Alpha")
    bright = scalar("GhostBrightness", g["brightness"], -1000, -60)
    emissive = E(unreal.MaterialExpressionMultiply, -700, -200)
    link(grad, "", emissive, "A")
    link(bright, "", emissive, "B")
    to_property(emissive, unreal.MaterialProperty.MP_EMISSIVE_COLOR, "EmissiveColor")

    # --- opacity: a floor plus the fresnel edge, scaled by the instance's own opacity
    edge_gain = E(unreal.MaterialExpressionMultiply, -1000, 140)
    link(fresnel, "", edge_gain, "A")
    link(const(0.65, -1200, 220), "", edge_gain, "B")
    edge = E(unreal.MaterialExpressionAdd, -820, 140)
    link(edge_gain, "", edge, "A")
    link(const(0.35, -1000, 260), "", edge, "B")
    opacity_p = scalar("GhostOpacity", g["opacity"], -1000, 360)
    op = E(unreal.MaterialExpressionMultiply, -620, 180)
    link(edge, "", op, "A")
    link(opacity_p, "", op, "B")

    # --- the vertical fade down the wisp. LOCAL position keeps the fade with the mesh however the
    #     actor is turned; if this build has no Local Position node the material still works and the
    #     log says the fade was dropped rather than leaving a silent difference.
    # THE FADE CHAIN USES ONLY NAMED PINS. The first version asked for ComponentMask.Input and
    # Clamp.Input; both are unnamed pins in UE 5.8 and both connections silently returned False, so
    # the clamp fed 0 into the fade, the fade collapsed to FadeFloor, and the wisp rendered at about
    # 5% opacity -- which is exactly what "a dark dithered cone" looks like. A dot product against
    # (0,0,1) reads local Z through the named A/B pins instead of a mask, and the renderer's own
    # clamp on Opacity replaces the Clamp node, so nothing here depends on an unnamed pin.
    fade_used = "none"
    try:
        lp_cls = getattr(unreal, "MaterialExpressionLocalPosition", None)
        if lp_cls is None:
            raise RuntimeError("MaterialExpressionLocalPosition is not exposed in this build")
        before = len(wiring["failed"])
        lp = E(lp_cls, -1500, 560)
        up = E(unreal.MaterialExpressionConstant3Vector, -1500, 690)
        up.set_editor_property("constant", unreal.LinearColor(0.0, 0.0, 1.0, 0.0))
        local_z = E(unreal.MaterialExpressionDotProduct, -1240, 600)
        link(lp, "", local_z, "A")
        link(up, "", local_z, "B")
        fade_range = scalar("FadeRange", C.PLUME_LEN * W_UU, -1500, 820)
        div = E(unreal.MaterialExpressionDivide, -1020, 620)
        link(local_z, "", div, "A")
        link(fade_range, "", div, "B")
        raised = E(unreal.MaterialExpressionAdd, -840, 620)
        link(div, "", raised, "A")
        link(const(1.0, -1020, 760), "", raised, "B")
        floor_p = scalar("FadeFloor", 1.0 - C.MATERIALS["ghost"]["fade_strength"], -840, 760)
        fade = E(unreal.MaterialExpressionLinearInterpolate, -560, 620)
        link(floor_p, "", fade, "A")
        link(const(1.0, -760, 800), "", fade, "B")
        link(raised, "", fade, "Alpha")
        faded = E(unreal.MaterialExpressionMultiply, -340, 320)
        link(op, "", faded, "A")
        link(fade, "", faded, "B")
        if len(wiring["failed"]) > before:
            # A half-wired fade is worse than none: it multiplies opacity by whatever the dead pin
            # happens to feed. Drop it rather than ship an invisible ghost again.
            raise RuntimeError("fade links failed: " + "; ".join(wiring["failed"][before:]))
        op = faded
        fade_used = "LocalPosition dot Z"
    except Exception as exc:
        LOG("GHOST MASTER: vertical fade dropped (%s) -- fresnel opacity only" % exc)
        fade_used = "none (%s)" % exc

    to_property(op, unreal.MaterialProperty.MP_OPACITY, "Opacity")
    # A ghost that emits nothing is not a ghost, so this is fatal rather than logged.
    if "EmissiveColor" in wiring["failed"] or "Opacity" in wiring["failed"]:
        raise RuntimeError("M_V2_Ghost wiring failed: %s" % ", ".join(wiring["failed"]))
    # UE 5.8's Python does not expose PostEditChange on Material (measured 2026-09-22: it cost a
    # 5-minute shader compile and then threw). recompile_material is the supported route.
    mel.recompile_material(mat)
    eal.save_asset(GHOST_MASTER, only_if_is_dirty=False)
    LOG("GHOST MASTER %s translucent unlit two-sided, fade=%s, links ok=%d failed=%d %s"
        % (GHOST_MASTER, fade_used, len(wiring["ok"]), len(wiring["failed"]),
           ("FAILED: " + "; ".join(wiring["failed"])) if wiring["failed"] else ""))
    GHOST_WIRING.clear()
    GHOST_WIRING.update({"fade": fade_used, "ok": len(wiring["ok"]), "failed": wiring["failed"]})
    return mat


# ------------------------------------------------------------------ material instances
def build_materials(rebuild_master=True):
    eal = unreal.EditorAssetLibrary
    mel = unreal.MaterialEditingLibrary
    ghost_master = build_ghost_master(rebuild_master)
    surface = eal.load_asset(MASTER_FOLDER + "/M_V2_Surface")
    portal = eal.load_asset(MASTER_FOLDER + "/M_V2_Portal")
    if surface is None or portal is None:
        raise RuntimeError("V2 masters missing under " + MASTER_FOLDER)
    white = eal.load_asset("/Engine/EngineResources/WhiteSquareTexture")
    flat_normal = eal.load_asset("/Engine/EngineMaterials/DefaultNormal")
    plan = (("pearl", "MI_RelayDogCub_Pearl", surface), ("visor", "MI_RelayDogCub_Visor", surface),
            ("eye", "MI_RelayDogCub_Eye", portal), ("ghost", "MI_RelayDogCub_Ghost", ghost_master))
    out = {}
    for surf, name, master in plan:
        path = CUB_FOLDER + "/" + name
        if eal.does_asset_exist(path):
            eal.delete_asset(path)
        mi = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
            name, CUB_FOLDER, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        if mi is None:
            raise RuntimeError("material instance %s was not created" % name)
        try:
            mel.set_material_instance_parent(mi, master)
        except Exception:
            mi.set_editor_property("parent", master)
        spec = C.MATERIALS[surf]
        if surf == "ghost":
            mel.set_material_instance_vector_parameter_value(mi, "GhostCore", lin(spec["core"]))
            mel.set_material_instance_vector_parameter_value(mi, "GhostRim", lin(spec["rim"]))
            for pname, val in (("GhostOpacity", spec["opacity"]), ("RimPower", spec["rim_power"]),
                               ("GhostBrightness", spec["brightness"]),
                               ("FadeFloor", 1.0 - spec["fade_strength"]), ("FadeRange", C.PLUME_LEN * W_UU)):
                mel.set_material_instance_scalar_parameter_value(mi, pname, float(val))
        else:
            # The V2 masters multiply an albedo TEXTURE by the tint and sample through world-projected
            # UVs, so a white texture at TexScale 0 is what makes a flat canon colour -- the same
            # trick the canonical Dog uses, and for the same reason (its first studio capture had the
            # plaster normal streaking every vertical face).
            for pname, tex in (("Albedo", white), ("RoughnessMap", white), ("Normal", flat_normal)):
                if tex is not None:
                    mel.set_material_instance_texture_parameter_value(mi, pname, tex)
            mel.set_material_instance_scalar_parameter_value(mi, "TexScale", 0.0)
            mel.set_material_instance_vector_parameter_value(mi, "BaseColor", lin(spec["color"]))
            mel.set_material_instance_scalar_parameter_value(mi, "Roughness", float(spec["roughness"]))
            mel.set_material_instance_scalar_parameter_value(mi, "RoughVary", 0.0)
            mel.set_material_instance_scalar_parameter_value(mi, "Metallic", float(spec["metalness"]))
            mel.set_material_instance_scalar_parameter_value(mi, "Specular", 0.5 if surf != "visor" else 0.2)
            if spec.get("emissive"):
                hex_e, intensity = spec["emissive"]
                mel.set_material_instance_vector_parameter_value(mi, "Emissive", lin(hex_e))
                mel.set_material_instance_scalar_parameter_value(mi, "EmissiveStrength", float(intensity) * 600.0)
        try:
            mel.recompile_material(mi)
        except Exception as exc:
            LOG("recompile %s: %s" % (name, exc))
        eal.save_asset(path, only_if_is_dirty=False)
        out[surf] = mi
        LOG("MATERIAL %s parent=%s" % (name, master.get_name()))
    return out


# ------------------------------------------------------------------ meshes
def build_meshes(ctx, eyes=None):
    """One mesh per (joint, surface). The Cub is no longer all boxes: the head and spurs are
    chamfered boxes, the hands are spheres, and the ghost tail is a TUBE swept along a curve --
    the plate draws a smooth flowing wisp, and the first build's stack of ten blocks read as a
    drill bit the moment the material was bright enough to see."""
    eal = unreal.EditorAssetLibrary
    built, report = {}, []
    eyes = eyes or C.DEFAULT_EYES
    for (joint, surface), parts in C.parts(W_UU, eyes).items():
        key = "RelayDogCub_%s_%s" % (joint, surface)
        m = ctx.mesh(key)
        for _name, kind, payload in parts:
            if kind == "box":
                centre, dims, rot, chamfer = payload
                if chamfer:
                    m.box(dims[0], dims[1], dims[2], at=centre, rot=rot, chamfer=chamfer)
                else:
                    m.box(dims[0], dims[1], dims[2], at=centre, rot=rot)
            elif kind == "sphere":
                centre, radius = payload
                m.sphere(radius, at=centre, steps=14)
            elif kind == "tube":
                path, radii, sides = payload
                m.tube(path, radii, sides=sides)
            else:
                raise RuntimeError("unknown part kind: " + str(kind))
        # collision=False is the contract, not an oversight: a Cub is presentation and never blocks.
        path = m.to_asset(CUB_FOLDER, key, nanite=False, collision=False, lods=True)
        if path is None or not eal.does_asset_exist(path):
            raise RuntimeError("static mesh %s was not saved" % key)
        tris = m.tri_count() if hasattr(m, "tri_count") else None
        report.append({"joint": joint, "surface": surface, "parts": len(parts), "tris": tris, "asset": path})
        LOG("PART %s parts=%d tris=%s asset=%s" % (key, len(parts), tris, path))
        built[(joint, surface)] = eal.load_asset(path)
    return built, report


def build_eye_variants(ctx):
    """The plate gives each cub a different eye shape -- flat bars, curved arcs, slanted wedges --
    which is how a creature with no face has an expression. Each set is its own small mesh the
    runtime can swap on the head's eye component."""
    eal = unreal.EditorAssetLibrary
    made = []
    for name in sorted(C.EYE_SETS):
        key = "RelayDogCub_eyes_%s" % name
        m = ctx.mesh(key)
        for _n, kind, payload in C.parts(W_UU, name).get(("head", "eye"), []):
            centre, dims, rot, chamfer = payload
            m.box(dims[0], dims[1], dims[2], at=centre, rot=rot)
        path = m.to_asset(CUB_FOLDER, key, nanite=False, collision=False, lods=False)
        if path is None or not eal.does_asset_exist(path):
            raise RuntimeError("eye variant %s was not saved" % key)
        made.append({"eyes": name, "asset": path})
        LOG("EYES %s -> %s" % (name, path))
    return made


# ------------------------------------------------------------------ blueprint
def build_blueprint(meshes, mats):
    eal = unreal.EditorAssetLibrary
    path = CUB_FOLDER + "/" + BP_NAME
    if eal.does_asset_exist(path):
        eal.delete_asset(path)
    factory = unreal.BlueprintFactory()
    # AActor, NOT ACharacter. A Cub floats and never walks: a Character would bring a movement
    # component and a collision capsule to something the integration lane has explicitly asked to
    # keep collision-free.
    factory.set_editor_property("parent_class", unreal.Actor)
    bp = unreal.AssetToolsHelpers.get_asset_tools().create_asset(BP_NAME, CUB_FOLDER, None, factory)
    if bp is None:
        raise RuntimeError("blueprint was not created")
    sds = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
    lib = unreal.SubobjectDataBlueprintFunctionLibrary
    handles = sds.k2_gather_subobject_data_for_blueprint(context=bp)
    if not handles:
        raise RuntimeError("no subobject handles")

    def add(parent, cls, name):
        params = unreal.AddNewSubobjectParams(parent_handle=parent, new_class=cls, blueprint_context=bp)
        handle, why = sds.add_new_subobject(params)
        data = sds.k2_find_subobject_data_from_handle(handle)
        ok = False
        try:
            ok = bool(lib.is_valid(data))
        except Exception:
            ok = data is not None
        if not ok:
            raise RuntimeError("add_new_subobject %s: %s" % (name, why))
        sds.rename_subobject(handle, unreal.Text(name))
        obj = lib.get_object(data)
        if obj is None:
            raise RuntimeError("subobject %s has no template" % name)
        return handle, obj

    root_h, _ = add(handles[0], unreal.SceneComponent, "Body")
    pivots = C.pivots_unreal(W_UU)
    joint_h = {"root": root_h}
    made = {"pivots": 0, "meshes": 0, "sockets": 0}
    for joint in C.JOINTS:
        if joint == "root":
            parent_h = root_h
        else:
            parent_joint = C.PARENTS[joint]
            base_h = joint_h.get(parent_joint)
            if base_h is None:
                raise RuntimeError("joint %s wants parent %s, not built yet" % (joint, parent_joint))
            parent_h, pivot_obj = add(base_h, unreal.SceneComponent, "Pivot_" + joint)
            here = pivots[joint]
            there = pivots.get(parent_joint, (0.0, 0.0, 0.0)) if parent_joint != "root" else (0.0, 0.0, 0.0)
            pivot_obj.set_editor_property("relative_location", unreal.Vector(
                here[0] - there[0], here[1] - there[1], here[2] - there[2]))
            joint_h[joint] = parent_h
            made["pivots"] += 1
        for surface in C.SURFACES:
            sm = meshes.get((joint, surface))
            if sm is None:
                continue
            _, comp = add(parent_h, unreal.StaticMeshComponent, "Mesh_%s_%s" % (joint, surface))
            comp.set_editor_property("static_mesh", sm)
            comp.set_material(0, mats[surface])
            comp.set_editor_property("relative_location", unreal.Vector(0, 0, 0))
            try:
                comp.set_collision_profile_name("NoCollision")
                comp.set_editor_property("generate_overlap_events", False)
            except Exception:
                pass
            if surface == "ghost":
                # A wisp of light should not cast a shadow, and translucent shadows are the most
                # expensive thing this creature could ask for at twelve at a time.
                comp.set_editor_property("cast_shadow", False)
            made["meshes"] += 1
    for joint, name, loc in C.sockets_unreal(W_UU):
        _, sock = add(joint_h[joint], unreal.SceneComponent, name)
        sock.set_editor_property("relative_location", unreal.Vector(*loc))
        made["sockets"] += 1
    unreal.BlueprintEditorLibrary.compile_blueprint(bp)
    eal.save_asset(path, only_if_is_dirty=False)
    LOG("BLUEPRINT %s pivots=%d meshes=%d sockets=%d" % (path, made["pivots"], made["meshes"], made["sockets"]))
    return path, made


def build_all():
    ctx = gs.Context(unreal, LOG)
    mats = build_materials()
    meshes, report = build_meshes(ctx)
    bp_path, made = build_blueprint(meshes, mats)
    m = C.measurements()
    out = {"blueprint": bp_path, "folder": CUB_FOLDER, "ghost_master": GHOST_MASTER,
           "head_width_uu": W_UU, "hover_uu": HOVER_UU,
           "height_cm": round(C.height() * W_UU, 1), "parts": report,
           "tris_total": sum(p["tris"] for p in report if isinstance(p["tris"], int)),
           "components_per_cub": made["pivots"] + made["meshes"] + made["sockets"] + 1,
           "made": made, "measurements": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in m.items()}}
    LOG("BUILT height=%.1f cm tris=%s components=%d" % (out["height_cm"], out["tris_total"],
                                                        out["components_per_cub"]))
    return out
