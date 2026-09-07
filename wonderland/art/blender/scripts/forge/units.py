"""The unit and axis contract between Blender and Unreal.

WHY THIS FILE IS SEPARATE. Every scale bug this project has had was an
arithmetic slip nobody could point at afterwards -- `fountain_grand`'s
docstring records a radius read as a diameter, and the world tools now read
bounding boxes rather than tables because of it. So the conversion lives in
exactly one place, is named, and is asserted by `validate_assets.py` against
the geometry that actually came out of the exporter.

THE CONTRACT
------------
Authoring space (this repository's .py, and the .blend it produces):

    METRES. 1 Blender unit = 1 m. Z is up. +X is the module's FRONT --
    the axis a gate faces down, the axis an arch spans across, the axis a
    bridge runs along. Y is the module's width axis.

Unreal space (`wonderland/v2/*`, `layout_v2.ALL`, every number in
`WORLD_LEDGER.md`):

    UNREAL UNITS. 1 uu = 1 cm. Z is up. Placements are authored with the
    asset's BASE AT z = 0, which is `assets_v2.py`'s stated rule and the one
    every layout call site assumes.

So `UU_PER_METRE = 100.0`, and a module authored 42 m tall is 4200 uu tall in
the world. `meta.height_uu` in the manifest is the MEASURED height of the
exported geometry times that constant -- never a number typed by hand.

WHY BASE AT z = 0 AND NOT CENTRED. `meshkit`'s own docstring explains that
`/Engine/BasicShapes` are origin-centred and "eleven thousand lines of layout
arithmetic assume it", so `fit_box()` centres HD meshes to stay drop-in. That
reasoning is about REPLACING a primitive. These modules replace nothing: they
stack, and a stack is only expressible if the join is at a known z. Every
module here therefore sits with its footing on z = 0 and publishes a `top`
socket at its own measured height. `origin_rule` in the manifest states this
per asset so the Unreal side never has to guess.

WHAT IS PROVEN HERE AND WHAT IS NOT
-----------------------------------
Proven in this environment: the geometry, its dimensions, its triangle count,
its normals, and that the exporter wrote a file whose re-imported bounding box
matches the authored one. `validate_assets.py` does all of that with real
Blender.

NOT proven in this environment: that Unreal reads these files at the scale and
orientation described. No Unreal Engine binary exists on this host. The FBX
numbers below are the standard Blender->Unreal recipe and the exporter's own
behaviour is verified by round-trip, but the Unreal end of it is a claim for
the world session to check, and `WONDERLAND_BLENDER_CURRENT.md` says so.
"""

#: 1 metre in Unreal units. Unreal's world unit is the centimetre.
UU_PER_METRE = 100.0

# --------------------------------------------------------------------------
# the FBX scale question, settled by measurement rather than by lore
# --------------------------------------------------------------------------
#
# An FBX carries BOTH raw vertex numbers and a `UnitScaleFactor` saying what
# those numbers mean. Importers disagree about which to trust, and the usual
# "my Blender export came into Unreal 100x too small" is exactly that
# disagreement. Rather than pick a side, this pipeline writes a file where
# BOTH READINGS GIVE THE SAME ANSWER.
#
# Four export configurations were built and the resulting binary FBX decoded
# (`UnitScaleFactor` property and the raw `Vertices` double array), for a probe
# box authored 10 m tall:
#
#   authoring     scene unit   UnitScaleFactor   stored Z    honours USF   assumes cm
#   ------------  -----------  ---------------   ---------   -----------   ----------
#   metres        1.0          100               0 .. 10       10.00 m       0.10 m   <- ambiguous
#   baked cm      1.0          100               0 .. 1000   1000.00 m      10.00 m   <- ambiguous
#   BAKED CM      0.01         1                 0 .. 1000     10.00 m      10.00 m   <- AGREES
#
# So the third row is the contract: the mesh is scaled by UU_PER_METRE and the
# scale applied into the vertex data, the scene declares 1 unit = 1 cm, and the
# file then says centimetres in both of the ways a reader might ask. Unreal's
# "Import Uniform Scale" stays at its default 1.0 and a 10 m module lands as
# 1000 uu.
#
# `export.py` performs the bake; `validate_assets.py` re-decodes every written
# FBX and fails the build if either reading drifts from the authored height.

#: The scene unit scale set before an FBX is written, so UnitScaleFactor is 1.
FBX_SCENE_UNIT_SCALE = 0.01

#: What the FBX exporter is asked for, once the geometry is already in cm.
FBX_EXPORT = {
    "global_scale": 1.0,
    "apply_unit_scale": True,
    "apply_scale_options": "FBX_SCALE_UNITS",
    "axis_forward": "X",
    "axis_up": "Z",
    "use_space_transform": True,
    "bake_space_transform": False,
    "object_types": {"MESH"},
    "use_mesh_modifiers": True,
    "mesh_smooth_type": "FACE",
    "use_tspace": False,
    "add_leaf_bones": False,
    "path_mode": "COPY",
    "embed_textures": False,
    "use_custom_props": False,
}

#: glTF is metres and Y-up by specification; the exporter converts from
#: Blender's Z-up itself. This is the format `wonderland/marble` already
#: imports through `import_glb`, which is why it is written as well as FBX.
GLTF_EXPORT = {
    "export_format": "GLB",
    "export_yup": True,
    "export_apply": True,
    "export_texcoords": True,
    "export_normals": True,
    "export_materials": "EXPORT",
    "export_cameras": False,
    "export_lights": False,
    "export_animations": False,
    "export_skins": False,
    "export_morph": False,
}


def m_to_uu(metres):
    """Metres -> Unreal units. The only place this multiplication happens."""
    return float(metres) * UU_PER_METRE


def uu_to_m(uu):
    return float(uu) / UU_PER_METRE
