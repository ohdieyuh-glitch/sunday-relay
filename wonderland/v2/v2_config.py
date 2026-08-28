"""Names, paths and the locked hero camera for Wonderland V2."""

import os

CONTENT_ROOT = "/Game/WonderlandV2"
MAP_DIR = CONTENT_ROOT + "/Maps"
#: WLV2_MAP_NAME builds the same world into another map (the World Partition
#: recovery builds a classic staging map and converts THAT, leaving the broken
#: WL_V2_GoldenArrival untouched as a forensic archive).
MAP_NAME = os.environ.get("WLV2_MAP_NAME", "WL_V2_GoldenArrival")
MAP_PATH = MAP_DIR + "/" + MAP_NAME
OPEN_WORLD_TEMPLATE = "/Engine/Maps/Templates/OpenWorld"
OPEN_WORLD_TEMPLATES = ("/Engine/Maps/Templates/OpenWorld", "/Engine/Maps/Templates/OpenWorld/OpenWorld",
                        "/Engine/Maps/Templates/Template_Default")

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
    "hlod": CONTENT_ROOT + "/HLOD",
    "vfx_portal": CONTENT_ROOT + "/VFX/Portal",
    "vfx_ambient": CONTENT_ROOT + "/VFX/Ambient",
    "pcg": CONTENT_ROOT + "/PCG",
    "data": CONTENT_ROOT + "/Data",
    "sky": CONTENT_ROOT + "/Sky",
}

DATA_LAYERS = ("V2_Arrival", "V2_Garden", "V2_Castle", "V2_Skyline",
               "V2_Vegetation", "V2_Props", "V2_VFX")

# ---- THE HERO CAMERAS, LOCKED -------------------------------------------
#
# Reconstructed from the Marble panorama (v2/reference/ANALYSIS.md). The
# world origin is the panorama's VIEWPOINT; eye height 2.62 m (1.24 native
# units x the measured metric scale); the horizon sits at mid-frame, so the
# camera is LEVEL. The panorama's "gates at both edges" are one gate 9.3 m
# BEHIND the viewpoint (the equirect seam), so two cameras are built and the
# founder chooses:
#
#   HeroCam_V2_MarbleReference  1.5 m behind the viewpoint, 100 deg
#       horizontal -- the widest a hero frame carries without fisheye. From
#       there (computed from layout_v2, checked by verify_v2_layout): giant
#       mushroom centre 60 deg left with its cap's inner edge at 40, clock
#       tree 45 right (trunk inner edge 40), heart 18 right, steps/path/arch
#       on the axis; the two rose cones sit at 83 left / 63 right -- OUTSIDE
#       the frame, exactly as in the panorama (-93 / +72 from the viewpoint).
#       (An earlier comment here said the cones were at +/-47: a derived
#       number nobody had computed.)
#   HeroCam_V2_GateView  5.5 m behind the gate, looking through its open
#       leaves -- the flattened panorama's framing, with a coherent world.
#
# SCREEN HANDEDNESS: looking along +Y, screen-right is -X.
HERO_CAMS = [
    {"name": "HeroCam_V2_MarbleReference", "location": (0.0, -150.0, 262.0),
     "rotation": (-2.0, 90.0, 0.0), "fov": 100.0,
     "tags": ("HeroCam_V2_MarbleReference", "HeroCam0")},
    {"name": "HeroCam_V2_GateView", "location": (0.0, -1460.0, 262.0),
     "rotation": (-3.0, 90.0, 0.0), "fov": 95.0,
     "tags": ("HeroCam_V2_GateView", "HeroCam1")},
    # ADDITIONAL VIEWS OF THE SAME WORLD (founder, 2026-08-26): rendered in
    # Unreal from the Marble mesh we already own (WL_EXTRA_ARGS="-WLShowTags=
    # MARBLE_REFERENCE_ONLY -WLHideTags=UNREAL_PRODUCTION") and, with the kit
    # visible, from the reconstruction -- zero Marble credits. Yaw 90 = +Y
    # forward; screen-right is -X, so the LEFT garden is yaw > 90.
    {"name": "MarbleView_Forward", "location": (0.0, 1500.0, 262.0), "rotation": (-2.0, 90.0, 0.0), "fov": 90.0,
     "tags": ("MarbleView_Forward", "HeroCam2", "MARBLE_VIEW")},
    {"name": "MarbleView_LeftGarden", "location": (0.0, -150.0, 262.0), "rotation": (-3.0, 145.0, 0.0), "fov": 90.0,
     "tags": ("MarbleView_LeftGarden", "HeroCam3", "MARBLE_VIEW")},
    {"name": "MarbleView_RightGarden", "location": (0.0, -150.0, 262.0), "rotation": (-3.0, 35.0, 0.0), "fov": 90.0,
     "tags": ("MarbleView_RightGarden", "HeroCam4", "MARBLE_VIEW")},
    {"name": "MarbleView_Elevated", "location": (0.0, -900.0, 1600.0), "rotation": (-28.0, 90.0, 0.0), "fov": 90.0,
     "tags": ("MarbleView_Elevated", "HeroCam5", "MARBLE_VIEW")},
    {"name": "MarbleView_CastleApproach", "location": (0.0, 4200.0, 300.0), "rotation": (-1.0, 90.0, 0.0), "fov": 90.0,
     "tags": ("MarbleView_CastleApproach", "HeroCam6", "MARBLE_VIEW")},
    {"name": "MarbleView_Reverse", "location": (0.0, 900.0, 262.0), "rotation": (-2.0, 270.0, 0.0), "fov": 90.0,
     "tags": ("MarbleView_Reverse", "HeroCam7", "MARBLE_VIEW")},
]
HERO_CAM = HERO_CAMS[0]

#: Env knobs. WONDERLAND_TEXTURE_DIR is shared with V1's texture synthesiser.
TEXTURE_DIR = os.environ.get("WONDERLAND_TEXTURE_DIR", "/opt/wonderland/textures")
MARBLE_PANO = os.environ.get("WLV2_MARBLE_PANO", "")   # set by v2-build.sh
MARBLE_GLB = os.environ.get("WLV2_MARBLE_GLB", "")     # the 3,500-credit textured mesh, on the Studio
LOOK = {
    # THE IMAGE CONTROLS LIGHTING. Sun measured in the panorama at azimuth +79
    # (viewer's right-front) and elevation +58: a high, warm-white late-morning
    # sun, not golden hour. Light TRAVELS from it: yaw -11 in the UE frame
    # (sun bearing +79 with screen-right = -X -> the light's forward is -11),
    # pitch -58 = minus the measured elevation. (This carried -55 with a
    # comment saying +58: a derived number that did not match its source.)
    # Physical units, histogram auto-exposure, extended range.
    "sunPitch": -58.0, "sunYaw": -11.0, "sunLux": 60000.0, "sunTemperatureK": 5600.0,
    "skyLightIntensity": 1.0, "exposureBias": 0.0,
    # PASS 01 (2026-08-28): exposure PINNED. Histogram auto-exposure metered
    # the frame to mid-grey and blew the ivory plaza to white (luma 0.33 vs the
    # reference's 0.16 at the engine's reported EV 12.5). min == max fixes
    # EV100; 13.5 is one stop darker than what the metering chose, the measured
    # correction. None restores auto-exposure.
    "exposurePinEV100": 13.5,
    # a clear bright day with subtle haze -- pale blue-white, NOT lavender
    "fogDensity": 0.005, "fogFalloff": 0.18, "fogStartDistance": 4000.0,
    "fogInscattering": (0.74, 0.80, 0.92),
    "volumetricFog": 1, "fogScattering": 0.20,
    # restrained magic: a small rune disc at the viewpoint, low glow
    "portal": 1, "portalRadius": 250.0, "portalGlow": 1200.0, "portalLightIntensity": 8000.0,
    # bloom low; grade NEUTRAL (the reference is not purple-shadowed)
    "bloomIntensity": 0.35, "bloomThreshold": 1.2,
    "gradeShadows": (1.0, 1.0, 1.02), "gradeMidtones": (1.01, 1.0, 0.99),
    "gradeHighlights": (1.02, 1.0, 0.98),
    # the panorama dome supplies the SKY: the lookup is computed from the view
    # direction (PASS 04d, 2026-08-28), so u = 0.5 faces yaw skyYawOffset
    # (90 = +Y, HeroCam0's forward) and the mesh's own UVs are irrelevant.
    # skyFlipV 0: PASS 04c's flip painted the panorama's GROUND across the sky
    # -- the vertical had been right all along, the "ground" read in
    # V2_PASS_022 was the panorama's giant mushroom, rotated and compressed by
    # the mesh UVs. skyHorizonV 0.5: masked at the true horizon; the near
    # objects that used to justify +8 deg are handled by skyNearBands: inside
    # those two bands of u (the panorama's giant mushroom 0.245-0.435, its big
    # tree 0.525-0.655, each widened by the 0.01 cross-fade) the panorama is
    # sampled from the clean sky columns beside them, skyNearFills, at the same
    # v (measured on the panorama, v 0.19-0.36: luma p10 91 / 92, blue-
    # dominant; the mushroom's band is p10 21, the tree's p10 27). PASS 04e
    # (2026-08-28): 04d stretched the zenith rows down instead, which smeared
    # the clouds and swept a white column through the tower-ring rows at the
    # band edge. skyGain 18000: V2_PASS_024 measured the sky at sRGB p50 79
    # against the reference's 107 at the same pixels with the plaza already
    # brighter than the reference's, i.e. the sky sat ~1 stop too dark
    # relative to the sunlit geometry ((107/79)^2.2 = 1.95x).
    "skyDome": 1, "skyGain": 18000.0, "skyFlipV": 0.0, "skyHorizonV": 0.5,
    "skyYawOffset": 90.0, "skyNearBands": ((0.235, 0.445), (0.515, 0.665)),
    "skyNearFills": ((0.06, 0.245), (0.805, 0.94)),
    "castleKit": 1, "nanite": 1,
    # secondary dressing (the PCG-equivalent): garden zones only, after the authored layout
    "dressing": 1, "dressingDensity": 1.0,
    # ---- THE MARBLE WORLD -----------------------------------------------------
    # marbleWorld: "scaffold" = import and place the HQ mesh HIDDEN in game
    # (composition/proportion scaffold in the editor; it is not the final
    # world); "visible" = show it (backdrop mode, for comparison); "off".
    # Registration from V1's live measurement; scale 2.1145 = true metric.
    "marbleWorld": 1, "marbleVisible": 0, "marbleScale": 2.1145339, "marbleGain": 9000.0,
    "marbleRollDeg": 180.0, "marbleYawDeg": 180.0, "marbleGroundOffsetM": 1.2398534,
    # MARBLE CUT-OUTS: regions of the Marble mesh cut out in-editor as
    # standalone meshes and placed VISIBLE where the kit is weakest. For the
    # hero camera at the reconstruction viewpoint they ARE the reference.
    # 1 = place them and skip the authored kit versions of those landmarks;
    # 0 = kit only. Per-landmark boxes are in build_v2.MARBLE_CUTOUTS.
    # Cut-outs are Band A/B landmarks made of generated geometry -- OFF since
    # the 2026-08-26 pipeline correction (kept as an opt-in reference tool).
    "marbleCutouts": 0,
    # The Band C experiment: the Marble world beyond this radius, visible. The
    # Marble world itself reaches only ~170 m (ANALYSIS: city 90-170 m), so a
    # 200 m radius left an EMPTY ring and an engine error that failed the build;
    # 90 m is where the Marble skyline begins -- Band B/C overlap, judged by
    # the render and removed with marbleDistant=0 if it fails.
    "marbleDistant": 1, "marbleDistantRadiusM": 90.0,
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
