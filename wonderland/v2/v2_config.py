"""Names, paths and the locked hero camera for Wonderland V2."""

import os

CONTENT_ROOT = "/Game/WonderlandV2"
MAP_DIR = CONTENT_ROOT + "/Maps"
MAP_NAME = "WL_V2_GoldenArrival"
MAP_PATH = MAP_DIR + "/" + MAP_NAME
OPEN_WORLD_TEMPLATE = "/Engine/Maps/Templates/OpenWorld"

FOLDERS = {
    "castle": CONTENT_ROOT + "/Architecture/Castle",
    "gates": CONTENT_ROOT + "/Architecture/Gates",
    "bridges": CONTENT_ROOT + "/Architecture/Bridges",
    "stairs": CONTENT_ROOT + "/Architecture/Stairs",
    "garden_arch": CONTENT_ROOT + "/Architecture/Garden",
    "paths": CONTENT_ROOT + "/Ground/Paths",
    "terrain": CONTENT_ROOT + "/Ground/Terrain",
    "cobble": CONTENT_ROOT + "/Ground/Cobblestone",
    "trees": CONTENT_ROOT + "/Vegetation/Trees",
    "shrubs": CONTENT_ROOT + "/Vegetation/Shrubs",
    "flowers": CONTENT_ROOT + "/Vegetation/Flowers",
    "roses": CONTENT_ROOT + "/Vegetation/Roses",
    "vines": CONTENT_ROOT + "/Vegetation/Vines",
    "ivy": CONTENT_ROOT + "/Vegetation/Ivy",
    "topiary": CONTENT_ROOT + "/Vegetation/Topiary",
    "mush_small": CONTENT_ROOT + "/Mushrooms/Small",
    "mush_medium": CONTENT_ROOT + "/Mushrooms/Medium",
    "mush_landmark": CONTENT_ROOT + "/Mushrooms/Landmark",
    "tea": CONTENT_ROOT + "/Props/Tea",
    "clocks": CONTENT_ROOT + "/Props/Clocks",
    "keys": CONTENT_ROOT + "/Props/Keys",
    "garden_props": CONTENT_ROOT + "/Props/Garden",
    "mat_master": CONTENT_ROOT + "/Materials/Master",
    "mat_functions": CONTENT_ROOT + "/Materials/Functions",
    "mat_instances": CONTENT_ROOT + "/Materials/Instances",
    "textures": CONTENT_ROOT + "/Materials/Textures",
    "vfx_portal": CONTENT_ROOT + "/VFX/Portal",
    "vfx_ambient": CONTENT_ROOT + "/VFX/Ambient",
    "pcg": CONTENT_ROOT + "/PCG",
    "data": CONTENT_ROOT + "/Data",
    "sky": CONTENT_ROOT + "/Sky",
}

DATA_LAYERS = ("V2_Arrival", "V2_Garden", "V2_Castle", "V2_Skyline",
               "V2_Vegetation", "V2_Props", "V2_VFX")

# ---- THE HERO CAMERA, LOCKED ------------------------------------------------
#
# Framed against the reference and not inherited from V1. The world's origin
# is the CENTRE OF THE PORTAL; the camera stands 9 m behind it at 3.8 m,
# looking along +Y, pitched 5 degrees down. With an 82-degree horizontal field
# (vertical ~52 at 16:9) the bottom ray meets the ground 6.3 m out, so the
# portal's near rim falls below the frame and the circle is cut by the bottom
# edge exactly as the reference cuts it; the horizon sits at ~44% from the top
# where the castle bases sit; the castle tops reach the top edge.
#
# SCREEN HANDEDNESS: looking along +Y, screen-right is -X. Every "left"/"right"
# in layout_v2.py is the screen's.
HERO_CAM = {
    "name": "HeroCam_V2_Arrival",
    "location": (0.0, -900.0, 380.0),
    "rotation": (-5.0, 90.0, 0.0),      # pitch, yaw, roll
    "fov": 82.0,
    "tags": ("HeroCam_V2_Arrival", "HeroCam0"),   # HeroCam0 = the capture path's default
}

#: Env knobs. WONDERLAND_TEXTURE_DIR is shared with V1's texture synthesiser.
TEXTURE_DIR = os.environ.get("WONDERLAND_TEXTURE_DIR", "/opt/wonderland/textures")
MARBLE_PANO = os.environ.get("WLV2_MARBLE_PANO", "")   # set by v2-build.sh
MARBLE_GLB = os.environ.get("WLV2_MARBLE_GLB", "")     # the 3,500-credit textured mesh, on the Studio
LOOK = {
    # PHYSICAL LIGHT UNITS, ON PURPOSE. V1 lit its world with a ~1,000-lux sun
    # because its exposure was inert, and then fought a black sky (the
    # atmosphere is calibrated for a real sun) and emissives that climbed the
    # tonemapper. V2 uses a golden-hour sun of 40,000 lux, a real-time-captured
    # sky light, histogram auto-exposure with an extended luminance range, and
    # emissive/light values in the same physical regime -- self-consistent,
    # and every one of them a knob for the first render to correct.
    "sunPitch": -30.0, "sunYaw": 215.0, "sunLux": 40000.0, "sunTemperatureK": 5200.0,
    "skyLightIntensity": 1.0, "exposureBias": 0.0,
    "fogDensity": 0.012, "fogFalloff": 0.20, "fogStartDistance": 2500.0,
    "fogInscattering": (0.62, 0.55, 0.84),
    "volumetricFog": 1, "fogScattering": 0.35,
    "portalGlow": 6000.0, "portalLightIntensity": 60000.0, "skyGain": 9000.0, "skyFlipV": 0.0,
    "bloomIntensity": 0.55, "bloomThreshold": 1.0,
    "gradeShadows": (1.02, 0.96, 1.10), "gradeMidtones": (1.03, 1.00, 0.96),
    "gradeHighlights": (1.04, 1.00, 0.93),
    "skyDome": 1, "castleKit": 1, "nanite": 1,
    # ---- THE MARBLE WORLD ---------------------------------------------------
    # marbleWorld 1 = place the Marble HQ mesh (if v2-build.sh found it) as the
    # scenery and build only the V2 FOREGROUND in front of it; 0 = the full V2
    # kit (courtyard, garden, palace) with no Marble. kitWithMarble 1 = both,
    # which doubles the gate/heart/arch/tea and is for comparison only.
    # marbleScale 2.1145 = TRUE METRIC (measured: UE's glTF import already
    # converts metres); 12.687 = V1's 6x backdrop lever for roam tolerance.
    # marbleGain = the unlit shell's BaseColorFactor; V1 measured 100 under a
    # 1,000-lux sun; V2 lights at 40,000 lux so it starts at the sky dome's gain.
    "marbleWorld": 1, "kitWithMarble": 0, "marbleScale": 2.1145339, "marbleGain": 9000.0,
    "marbleRollDeg": 180.0, "marbleYawDeg": 180.0, "marbleGroundOffsetM": 1.2398534,
}


def _overrides():
    raw = os.environ.get("WONDERLAND_V2_LOOK", "").strip()
    if not raw:
        return
    for kv in raw.split(","):
        if "=" not in kv:
            continue
        k, v = kv.split("=", 1)
        k = k.strip()
        if k not in LOOK:
            raise ValueError("WONDERLAND_V2_LOOK: unknown key %r" % k)
        cur = LOOK[k]
        if isinstance(cur, tuple):
            LOOK[k] = tuple(float(x) for x in v.split("/"))
        else:
            LOOK[k] = float(v)


_overrides()
