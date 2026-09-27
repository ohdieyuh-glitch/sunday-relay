# A SOFT LIGHT FOR THE EYES, BECAUSE A HARD-EDGED PANE IS A PLATE AND NOT A GLOW.
#
# FOUNDER, P0 2026-09-27: "THE MASCOT EYES ARE STILL NOT GLOWING." Round 3 lit every eye in its own colour at
# the world's white and photographed it (EYES_round3_day_night.png): a bright saturated square, and around it
# the three additive halo rings -- rendered as three concentric OLIVE FRAMES, because M_WL_VoxelAdditive draws
# a flat Color across the whole face of its cube. A hard step at 0.30 of the level, another at 0.12, another
# at 0.05, and nothing in between. The founder's own words for that picture were "still gone": a light reads
# as a light because its colour spills off it and FADES, and nothing in round 3 faded.
#
# This is that spill. Additive, unlit, one parameter named "Color" like every glow surface in the project, and
# a radial falloff read from the cube's own face UVs (the engine cube maps 0..1 across every face): full over
# the eye itself, then falling to nothing at the edge of the pane. On the Dog's halo cubes and on the "eyehalo"
# boxes the generator lays behind every costume's eyes it draws a soft blob of the eye's colour whose centre
# adds to the core -- the hot centre of a lamp -- and whose edge dies out over the visor. No bloom cloud, no
# whole-face emissive, no white rectangle: the eye's own colour, brightest at the eye, gone a little way off it.
#
#   Inner    how much of the pane, from the centre, is at full brightness (0.45 = the eye's own footprint on a
#            pane 2.4x the eye)
#   Falloff  the exponent of the fade from Inner to the edge; above 1 the tail is soft, below 1 it is a disc
CONCURRENT = True

import unreal

PACKAGE = "/Game/Wonderland/Materials"
NAME = "M_WL_EyeHalo"
PATH = PACKAGE + "/" + NAME
ME = unreal.MaterialEditingLibrary


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    # NOT DURING PLAY. Asset creation is refused while any PIE session runs ("LogUtils: Error: The Editor is
    # currently in a play mode", 10:52 -- the first run of this job, queued beside the World session's sweep,
    # failed on exactly that). Concurrent with other jobs is fine; concurrent with PIE is not, so wait it out.
    waited = 0.0
    while waited < 900.0:
        try:
            pie = unreal.EditorLevelLibrary.get_pie_worlds(False)
        except Exception:                                          # noqa: BLE001
            pie = []
        if not pie:
            break
        yield 5.0
        waited += 5.0
    RESULT["waited_for_pie_seconds"] = waited
    if waited >= 900.0:
        record("H00", "the project has its own eye halo material", False, path=PATH,
               note="PIE never ended in fifteen minutes; nothing was created")
        RESULT["status"] = "FAIL"
        return

    made = False
    if not unreal.EditorAssetLibrary.does_asset_exist(PATH):
        tools = unreal.AssetToolsHelpers.get_asset_tools()
        created = tools.create_asset(NAME, PACKAGE, unreal.Material, unreal.MaterialFactoryNew())
        made = created is not None
    mat = unreal.EditorAssetLibrary.load_asset(PATH)
    if mat is None:
        record("H00", "the project has its own eye halo material", False, path=PATH)
        RESULT["status"] = "FAIL"
        return
    RESULT["created"] = made

    try:
        ME.delete_all_material_expressions(mat)
    except Exception:
        pass
    yield 0.3

    props = {}
    for prop, value in (("blend_mode", unreal.BlendMode.BLEND_ADDITIVE),
                        ("shading_model", unreal.MaterialShadingModel.MSM_UNLIT),
                        ("two_sided", False),
                        # THE COSTUME HALOS ARE INSTANCES. Without this flag the figures' instanced components
                        # draw the default grey material in a cooked build, silently.
                        ("used_with_instanced_static_meshes", True),
                        ("used_with_static_lighting", False)):
        try:
            mat.set_editor_property(prop, value)
            props[prop] = True
        except Exception as err:                                   # noqa: BLE001
            props[prop] = str(err)[:90]
    RESULT["properties"] = props
    yield 0.3

    def node(kind, x, y):
        return ME.create_material_expression(mat, kind, x, y)

    def scalar(name, value, x, y):
        n = node(unreal.MaterialExpressionScalarParameter, x, y)
        n.set_editor_property("parameter_name", name)
        n.set_editor_property("default_value", value)
        return n

    def const(value, x, y):
        n = node(unreal.MaterialExpressionConstant, x, y)
        n.set_editor_property("r", value)
        return n

    def const2(r, g, x, y):
        n = node(unreal.MaterialExpressionConstant2Vector, x, y)
        n.set_editor_property("r", r)
        n.set_editor_property("g", g)
        return n

    def link(a, ao, b, bi):
        ME.connect_material_expressions(a, ao, b, bi)

    # ---- HOW FAR FROM THE CENTRE OF THE FACE, 0 at the middle, 1 at the middle of an edge.
    uv = node(unreal.MaterialExpressionTextureCoordinate, -1500, 0)
    centre = const2(0.5, 0.5, -1500, 120)
    dist = node(unreal.MaterialExpressionDistance, -1330, 40)
    link(uv, "", dist, "A")
    link(centre, "", dist, "B")
    radius = node(unreal.MaterialExpressionMultiply, -1180, 40)
    link(dist, "", radius, "A")
    link(const(2.0, -1330, 140), "", radius, "B")

    # ---- FULL OUT TO Inner, THEN A FADE TO NOTHING AT THE EDGE: 1 - (r - Inner) / (1 - Inner), clamped.
    inner = scalar("Inner", 0.45, -1330, 240)
    past = node(unreal.MaterialExpressionSubtract, -1040, 40)
    link(radius, "", past, "A")
    link(inner, "", past, "B")
    span = node(unreal.MaterialExpressionOneMinus, -1180, 240)
    link(inner, "", span, "")
    frac = node(unreal.MaterialExpressionDivide, -900, 60)
    link(past, "", frac, "A")
    link(span, "", frac, "B")
    fade = node(unreal.MaterialExpressionOneMinus, -760, 60)
    link(frac, "", fade, "")
    held = node(unreal.MaterialExpressionClamp, -620, 60)
    link(fade, "", held, "")
    soft = node(unreal.MaterialExpressionPower, -480, 60)
    link(held, "", soft, "Base")
    link(scalar("Falloff", 1.3, -620, 160), "", soft, "Exp")

    # ---- IN THE EYE'S OWN COLOUR, which every writer already sets as "Color".
    colour = node(unreal.MaterialExpressionVectorParameter, -480, -120)
    colour.set_editor_property("parameter_name", "Color")
    colour.set_editor_property("default_value", unreal.LinearColor(1.0, 0.72, 0.16, 1.0))
    out = node(unreal.MaterialExpressionMultiply, -300, -20)
    link(colour, "", out, "A")
    link(soft, "", out, "B")
    ME.connect_material_property(out, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    yield 0.4

    ME.recompile_material(mat)
    unreal.EditorAssetLibrary.save_asset(PATH)
    yield 1.0

    names, scalars = [], []
    try:
        names = [str(n) for n in ME.get_vector_parameter_names(mat)]
        scalars = [str(n) for n in ME.get_scalar_parameter_names(mat)]
    except Exception:
        pass
    RESULT["vector_parameters"] = names
    RESULT["scalar_parameters"] = scalars
    record("H00", "the project has its own eye halo material", True, path=PATH, created=made)
    record("H01", "it is additive, unlit and usable on instanced meshes",
           props.get("blend_mode") is True and props.get("shading_model") is True
           and props.get("used_with_instanced_static_meshes") is True, properties=props)
    record("H02", 'it exposes the "Color" parameter the eye drive writes', "Color" in names, vector_parameters=names)
    wired = None
    how = []
    for attempt in ("emissive_color", "EmissiveColor"):
        try:
            got = mat.get_editor_property(attempt)
            expr = None
            for field in ("expression", "Expression"):
                try:
                    expr = got.get_editor_property(field)
                    break
                except Exception:
                    continue
            wired = expr is not None
            how.append("%s -> %s" % (attempt, type(expr).__name__ if expr is not None else "none"))
            if wired:
                break
        except Exception as err:                                   # noqa: BLE001
            how.append("%s failed: %s" % (attempt, str(err)[:70]))
    record("H03", "something is plugged into the material's emissive output", wired is True, probe=how)
    record("H04", "the plateau and the fade are tunable without a rebuild",
           all(p in scalars for p in ("Inner", "Falloff")), scalar_parameters=scalars)
    RESULT["status"] = "measured"
