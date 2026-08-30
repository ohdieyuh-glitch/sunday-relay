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
    # THE PERMANENT CAMERA SUITE (founder, 2026-08-28): eight LOCKED cameras,
    # each with a different job, rendered on a fixed cadence so Wonderland is
    # judged as a world and not as one screenshot. Names and indices are
    # permanent; the capture tooling addresses a camera by its "HeroCamN" tag.
    # Do not move a camera to make a pass look better -- fix the world. Once
    # the founder approves the transforms they are frozen here, and
    # verify_v2_layout refuses a drift. Eye heights: 262 = the panorama's eye
    # (cinematic), 170 = a believable gameplay camera. Yaw 90 = +Y forward;
    # screen-right is -X at yaw 90 (and +X at yaw 270).
    #
    #   idx name          job
    #   0   HeroCam0      cinematic founder benchmark (unchanged since PASS 01)
    #   1   PlayerCam01   truthful gameplay POV at the arrival spawn, 5.5 m
    #                     behind the open gate, eye 1.7 m, 90 deg
    #   2   PathCam02     forward progression, 25 m along the corridor, before
    #                     the steps, looking at the arch and the castle
    #   3   ReverseCam03  backside truth test: 27.5 m in, looking back over the
    #                     garden gates to the plaza, the arrival gate, and what
    #                     lies behind it
    #   4   GardenLeft04  secondary space: inside the left garden strip between
    #                     the wall and the giant mushroom, looking up-garden
    #                     past the tree and the gold gate to the arch
    #   5   GardenRight05 object language: inside the right garden, the gold
    #                     gate, the heart terrace and the clock tree framing the
    #                     corridor arch and the towers
    #   6   SkylineCam06  world scale: 24 m up, 16.5 m behind the viewpoint,
    #                     pitched to hold plaza, gardens, castle and city in one
    #                     frame with a strip of sky
    #   7   ScaleCam07    proportion test at gameplay height: from the viewpoint
    #                     looking BACK at the arrival gate, urns and walls, with
    #                     the one canonical Relay Dog (LOOK scaleDog) standing
    #                     beside the right urn -- behind HeroCam0's field of view
    {"name": "PlayerCam01", "location": (0.0, -1460.0, 170.0), "rotation": (-3.0, 90.0, 0.0), "fov": 90.0,
     "tags": ("PlayerCam01", "HeroCam1", "HeroCam_V2_GateView")},
    {"name": "PathCam02", "location": (0.0, 2400.0, 262.0), "rotation": (-2.0, 90.0, 0.0), "fov": 90.0,
     "tags": ("PathCam02", "HeroCam2", "MARBLE_VIEW")},
    {"name": "ReverseCam03", "location": (0.0, 2600.0, 262.0), "rotation": (-2.0, 270.0, 0.0), "fov": 90.0,
     "tags": ("ReverseCam03", "HeroCam3", "MARBLE_VIEW")},
    # SUITE01 (V2_PASS_034/035) stood both garden cameras inside the side
    # beds: GardenLeft04 in SideBed_L_Hedge3 (a wall of leaves), GardenRight05
    # behind FrontWall_R2 (a coping across the bottom third). Moved onto the
    # open ground of each garden; the required landmarks below are checked
    # by verify_v2_layout from the new points.
    # Second placement (V2_PASS_042/043): (1300,300) stood behind the giant
    # mushroom's foot hedge, (-1350,1250,190) INSIDE the lavender bed (a black
    # frame). GardenLeft04 now stands in the garden's far corner looking back
    # through mushroom, tree and gold gate to the plaza and the arrival gate --
    # the secondary space with the world's depth behind it; GardenRight05
    # keeps its point at the panorama's eye height so it sees over the beds.
    {"name": "GardenLeft04", "location": (3000.0, 3000.0, 200.0), "rotation": (-3.0, 225.0, 0.0), "fov": 90.0,
     "tags": ("GardenLeft04", "HeroCam4", "MARBLE_VIEW")},
    # Third placement: (-1350,1250) at 2.7 m was boxed in by Garden_R_Hedge0
    # and the blossom cluster at (-1500,1450,260) (V2_PASS_050, leaves only).
    # The right garden's open lawn west of the clock tree: nothing within 7 m.
    {"name": "GardenRight05", "location": (-2800.0, 1500.0, 200.0), "rotation": (-3.0, 50.0, 0.0), "fov": 90.0,
     "tags": ("GardenRight05", "HeroCam5", "MARBLE_VIEW")},
    {"name": "SkylineCam06", "location": (0.0, -1800.0, 2400.0), "rotation": (-22.0, 90.0, 0.0), "fov": 90.0,
     "tags": ("SkylineCam06", "HeroCam6", "MARBLE_VIEW")},
    {"name": "ScaleCam07", "location": (0.0, -150.0, 170.0), "rotation": (-3.0, 270.0, 0.0), "fov": 90.0,
     "tags": ("ScaleCam07", "HeroCam7")},
    # ---- PASS 09: THREE CAMERAS FOR THE GROUND THAT WAS EMPTY -------------
    #
    # The eight above are the regression suite and none of them moves. But all
    # eight look at the arrival axis, which is why every render for three
    # passes has shown the same place -- and the flanks and the rear world are
    # now districts in their own right rather than lawn. The brief's rule is
    # that a new area gets its own small permanent suite once it has a real
    # composition; these three are that suite, and from here they are as
    # locked as the others.
    #
    # 8 and 9 stand at the flank's near end at eye height and look ALONG it,
    # so one frame carries the whole sequence the flank was authored as:
    # threshold, parterre, rose walk, grove, landmark. 10 stands well behind
    # the spawn looking in, which is the only view that answers "does
    # Wonderland continue behind you" -- it reads the rear gate, the avenue,
    # the arrival gate, the plaza and the castle in one line of depth.
    {"name": "FlankLeftCam08", "location": (4350.0, -1250.0, 265.0), "rotation": (-4.0, 90.0, 0.0),
     "fov": 90.0, "tags": ("FlankLeftCam08", "HeroCam8")},
    {"name": "FlankRightCam09", "location": (-4350.0, -1250.0, 265.0), "rotation": (-4.0, 90.0, 0.0),
     "fov": 90.0, "tags": ("FlankRightCam09", "HeroCam9")},
    {"name": "RearWorldCam10", "location": (0.0, -9400.0, 320.0), "rotation": (-3.0, 90.0, 0.0),
     "fov": 90.0, "tags": ("RearWorldCam10", "HeroCam10")},
    # ---- THE WORLD, not the district -------------------------------------
    #
    # SkylineCam06 pitches down 22 degrees from 24 m and its frame is filled
    # by the near district: it is the right camera for Golden Arrival's
    # composition and the wrong one for asking whether Wonderland is a world.
    # The outer quarters stand at 95-175 m and barely reach its edges. This
    # one stands high and far enough back to hold the district, the ring of
    # quarters, the roads between them and the horizon in one frame -- which
    # is the only view that answers the question the founder keeps asking.
    #
    # It does not replace SkylineCam06 and SkylineCam06 does not move. A
    # regression camera and a world camera are different instruments.
    {"name": "WorldCam11", "location": (0.0, -21000.0, 9500.0), "rotation": (-19.0, 90.0, 0.0),
     "fov": 95.0, "tags": ("WorldCam11", "HeroCam11")},
    # and one from directly above the district's shoulder, looking across the
    # ring, so the quarters read as PLACES rather than as a texture
    {"name": "WorldCam12", "location": (-13500.0, -13500.0, 6200.0), "rotation": (-16.0, 45.0, 0.0),
     "fov": 92.0, "tags": ("WorldCam12", "HeroCam12")},
    # ---- THE DISTRICTS (PASS 23) -----------------------------------------
    #
    # Golden Arrival's eight cameras are a REGRESSION SYSTEM for Golden
    # Arrival and they answer nothing about the rest of Wonderland: every one
    # of them stands inside the arrival plaza. The world now has fourteen
    # named districts, and a district that no camera has ever pointed at is a
    # district nobody has ever seen.
    #
    # These are permanent, and they are chosen from the WORLD rather than by
    # eye: each stands on the line between the district and the origin, at the
    # distance its subject needs, looking at the nearest quarter of that
    # district's signature kind. They move only if the founder asks.
    #
    # A clock tower is 11.8 m to its cornice and its spire another 6, so its
    # camera stands 46 m back and pitches UP 1.5 degrees; a water garden is
    # ground furniture and its camera pitches down.
    # RE-AIMED ONCE, after their first render, and then locked.
    #
    # The first set was computed against the site list as it stood, at 26-46 m
    # back and 2.4-3.0 m eye. Three things went wrong and the frames said all
    # three: WaterGardenCam15 pointed at a tower because the district's kinds
    # had changed under it since (the fallback chain turns a water garden into
    # a garden where there is no room); ClockQuarterCam13's clock tower was
    # behind its own quarter's edge planting at 46 m; and HamletCam17 was
    # INSIDE A BUSH -- the exact failure this project spent PASS 09-12 on and
    # recorded, reproduced by a foreground rule that put mass at 5.5 m from a
    # 2.8 m eye.
    #
    # So: aimed at the quarter of the district's SIGNATURE kind whose radius
    # is closest to the district's own seed radius (representative, not
    # innermost), 40-79 m back at 3.4-5.2 m of eye, and each one nudged to the
    # clearest spot on a 5x5 search -- the clearance is printed beside it.
    # Never inside 40 m of the origin, because a district camera standing in
    # the arrival plaza is not a district camera.
    {"name": "ClockQuarterCam13", "location": (4668.7, -2703.3, 520.0), "rotation": (2.5, -4.9, 0.0),
     "fov": 90.0, "tags": ("ClockQuarterCam13", "HeroCam13")},      # clockyard 130 m, 79 m back, 12.6 m clear
    {"name": "MushroomGroveCam14", "location": (5449.8, -6922.9, 420.0), "rotation": (2.0, -31.0, 0.0),
     "fov": 92.0, "tags": ("MushroomGroveCam14", "HeroCam14")},     # grove 155 m, 69 m back, 4.8 m clear
    {"name": "WaterGardenCam15", "location": (-4731.9, -4764.1, 420.0), "rotation": (-1.5, -121.9, 0.0),
     "fov": 90.0, "tags": ("WaterGardenCam15", "HeroCam15")},       # the LAKE at 125 m, 58 m back, 6.5 m clear
    {"name": "TeaTerraceCam16", "location": (-5401.8, -1839.1, 340.0), "rotation": (-1.0, -126.8, 0.0),
     "fov": 90.0, "tags": ("TeaTerraceCam16", "HeroCam16")},        # tea 93 m, 40 m back, 2.5 m clear
    {"name": "HamletCam17", "location": (-13093.3, -1889.8, 460.0), "rotation": (0.0, 167.1, 0.0),
     "fov": 90.0, "tags": ("HamletCam17", "HeroCam17")},            # hamlet 184 m, 54 m back, 5.0 m clear
    # ON A ROAD, at the Dog's own eye height, looking out along it to the
    # quarter it serves. The founder's test for the road network is that a
    # player believes they can keep going; this is the frame that answers it.
    {"name": "GroveRoadCam18", "location": (5000.0, -5300.0, 170.0), "rotation": (-1.5, -39.1, 0.0),
     "fov": 90.0, "tags": ("GroveRoadCam18", "HeroCam18")},
    # THE WORLD FROM BEYOND THE CASTLE, looking back: the castle plane, the
    # district behind it, and the far city over the shoulder. It is the only
    # view of the world-to-city transition the boards keep drawing.
    {"name": "WorldNorthCam19", "location": (0.0, 42000.0, 11000.0), "rotation": (-20.0, 270.0, 0.0),
     "fov": 95.0, "tags": ("WorldNorthCam19", "HeroCam19")},
    # and out past the castle's shoulder to the East Reach towers, which are
    # the first real destination BEYOND the castle rather than in front of it
    {"name": "EastReachCam20", "location": (4200.0, 19500.0, 900.0), "rotation": (-3.0, 66.0, 0.0),
     "fov": 92.0, "tags": ("EastReachCam20", "HeroCam20")},
]
#: The suite's names by index -- the filing tool and the checkpoint report use
#: them; the capture tooling uses the "HeroCamN" tags.
CAM_SUITE = ("HeroCam0", "PlayerCam01", "PathCam02", "ReverseCam03",
             "GardenLeft04", "GardenRight05", "SkylineCam06", "ScaleCam07",
             "FlankLeftCam08", "FlankRightCam09", "RearWorldCam10",
             "WorldCam11", "WorldCam12",
             "ClockQuarterCam13", "MushroomGroveCam14", "WaterGardenCam15",
             "TeaTerraceCam16", "HamletCam17", "GroveRoadCam18",
             "WorldNorthCam19", "EastReachCam20")
#: HeroCam0's frozen transform (the founder benchmark) -- verify_v2_layout
#: refuses a drift of the entry above from these values.
HERO_CAM0_FROZEN = ((0.0, -150.0, 262.0), (-2.0, 90.0, 0.0), 100.0)

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
    # PASS 08 (2026-08-30): TEMPERATURE. Measured on HeroCam0 against the
    # founder reference at matched regions: every non-sky surface in the
    # reference is WARM and ours is not -- paving R-B +21 against +36, the
    # left canopy (66,96,57) against (83,68,39), and in the whole-frame
    # palette the warm arc holds 26.7% of the reference and 1.6% of ours
    # while the neutral-pale arc holds 2.7% of the reference and 27.5% of
    # ours. The same surface is warm stone there and near-white here. 5600 K
    # is neutral daylight; the reference reads as a warm late-morning sun, so
    # the KEY carries the warmth (a lit surface warms, sky-lit shade stays
    # cool) rather than a grade painting it on flat.
    # PASS 08b: 5150 K OVERSHOT. Measured on the PASS 08 frame against the
    # same reference: the warm arc went from 1.6% to 36.2% of the frame where
    # the reference holds 26.7%, and foreground chroma landed at 1.67x the
    # reference. The direction was right and the amount was not. 5350 K.
    "sunPitch": -58.0, "sunYaw": -11.0, "sunLux": 60000.0, "sunTemperatureK": 5350.0,
    # PASS 08: THE LIGHT BUDGET, not the exposure. Nothing in the frame
    # clips (0.01% above sRGB 240, the reference 0.00%) so the world is not
    # over-exposed -- it is UNSHADED: 9.9% of our pixels sit below sRGB 40
    # against the reference's 25.7%. The sun is 60,000 lux and the
    # shadowless fill (a real-time sky capture at 1.0 with the atmosphere's
    # luminance doubled, plus the 6,000-lux upward bounce below) is most of
    # the key again -- the third time this class has cost Wonderland its
    # shade (see the light-budget memory). 0.45 pulls the hemisphere back to
    # roughly a clear day's true sky/sun ratio. The sky's own APPEARANCE is
    # skyLuminanceFactor's job and is already correct (upper sky p50
    # (109,141,173) against (95,118,171)), so the two are separated here
    # instead of one knob moving both.
    # PASS 08b: 0.45 OVERSHOT too -- deep pixels went from 7.6% to 30.4%
    # against the reference's 23.0%, and on ReverseCam03 the foreground hedge
    # mass dropped from median 82 to 46. Shade that deep stops being shade and
    # becomes the "dark masses swallowing architecture" the brief warns about.
    # 0.58 keeps most of the shadow structure PASS 08 recovered.
    # 0.72. The founder reports the right side reading "excessively dark" and
    # the measurement agrees: the dark arc holds 39.4% of the flank frame
    # against the reference's 23.0% (1.71x) and the foreground sits at p50 39
    # against 151. PASS 08 cut the shadowless fill from a budget where it was
    # most of the key, PASS 08b put a little back, and the vegetation added
    # since has been compounding shade on shade. Shadow STRUCTURE is worth
    # keeping -- it is what PASS 08 bought and the frame was flat without it --
    # so this lifts the hemisphere rather than flattening the sun.
    "skyLightIntensity": 0.72, "exposureBias": 0.0,
    # PASS 05 (2026-08-28, gated WLV2_PASS05=1 like the earlier passes): the
    # vegetation's black interiors. V2_PASS_024 measured the canopies at luma
    # p10 0 / p50 3-12 against the reference's 17-19 / 40-63 WITH the sky dome
    # finally right, so ambient from above is not what is missing: what the
    # camera sees under a canopy is leaf UNDERSIDES, and a real-time-capture
    # SkyLight is SKY-ONLY -- its lower hemisphere holds the atmosphere's dark
    # ground, so a downward-facing surface receives nothing, and no bounce
    # shows up to replace it (a 200 fps frame is not a frame Lumen is doing
    # much in). "scene" was REFUTED by V2_PASS_026: the one-shot scene capture
    # delivered LESS than the sky-only capture (hedges p50 27/46 -> 18/20,
    # undersides still 0) -- in the packaged Vulkan SM5 game the movable sky
    # light either never captured or captured black. "realtime" stays.
    "skyLightCapture": "realtime",
    # PASS 05b (gated WLV2_PASS05=1): GROUND BOUNCE AS A LIGHT. The plaza is
    # ~0.33 albedo under 60,000 lux, i.e. it radiates ~6,000 nits upward; a
    # leaf underside 5-8 m above it receives a few thousand lux of warm cream
    # from below in reality, and here receives nothing (sky-only capture, no
    # bounce). A shadowless DirectionalLight pointing straight UP supplies it:
    # 10% of the sun, the plaza's colour, no atmosphere role, no volumetrics.
    # Expected on HeroCam0: canopy undersides from p50 ~5 to the reference's
    # 40-63 (albedo 0.26 x 6,000 lux / pi ~ 500 nits ~ sRGB 55).
    # PASS 08: the bounce stays, at a fifth of its strength, and UNGATED.
    # It was sized in PASS 05b for leaf undersides that read p50 1 -- and
    # PASS 05f then fixed the leaf albedo, which is what actually lit them;
    # its own note says "the bounce light stays for this render (one
    # change)" and nobody came back to it. 6,000 shadowless lux against a
    # 60,000-lux key is 10% of the budget arriving in every shadow with no
    # occlusion at all. 1,200 keeps a downward face off zero and lets the
    # shade read. Ungated because a build's LOOK must not depend on an env
    # var that the capture path sets and the playtest path does not.
    "bounceLight": 1,
    "bounceLux": 1200.0, "bounceColor": (255, 235, 200), "bouncePitch": 90.0,
    # PASS 05c (gated WLV2_PASS05=1): the bounce light WORKS (V2_PASS_027: the
    # mushroom cap's underside p50 1 -> 26) but the canopy faces HeroCam0 sees
    # are SHADOW SIDES -- both trees are backlit, the sun sits ahead-right-
    # high -- and an upward light cannot reach a vertical face. What lights a
    # shadow side is the SKY, and the sky light demonstrably works: an ivory
    # post's camera-facing shadow face reads sRGB 118 while a leaf face two
    # metres away reads 2. Same light, same orientation; the difference is
    # that the leaf cloud OCCLUDES THE SKY ON ITSELF -- its mesh distance
    # field is a solid blob (r.DistanceFieldAO=1 and Lumen's DF traces are
    # both live in the packaged log). 0: foliage meshes no longer affect
    # distance-field lighting, i.e. they neither self-occlude nor darken
    # their neighbours; the architecture keeps its contact shading. Python
    # reaches the canopies (plain StaticMeshActors); the batched hedges and
    # beds need the same flag on the batch actor (C++), which follows once
    # the canopies prove the mechanism.
    # PASS 08: RESTORED to 1, and ungated. PASS 05c turned this off to stop
    # foliage self-occluding when the canopies read p50 2 against the
    # reference's 37; PASS 05d then measured that it moved them only to 6
    # and recorded the hypothesis as refuted. The albedo fix that followed
    # overshot the other way (its own note: canopy p50 85 against 37), so
    # the world now needs that self-occlusion back -- a canopy with a dark
    # interior is most of the reference's 25.7% of deep pixels.
    "foliageDistanceFieldLighting": 1,
    # PASS 05d (gated WLV2_PASS05=1): excluding the canopies from distance-
    # field lighting moved the dense right canopy only from p50 2 to 6
    # (V2_PASS_028; reference 37) -- the DF hypothesis is refuted for the
    # canopies. What fits every measurement is Lumen's SCREEN-SPACE traces:
    # from a leaf pixel nearly every ray hits a neighbouring leaf on screen,
    # so the sky is counted as occluded; an ivory post's face traces off into
    # the sky (118), the hedges' shadow parts, seen from above, escape partly
    # (their p50 tracks every skyGain change), and the cap's underside takes
    # the DIRECT bounce light (26). Distance-field flags cannot touch screen
    # traces. The engine's knob for exactly this symptom is the post-process
    # LumenSkylightLeaking: a fraction of the sky light applied without
    # occlusion ("to keep areas from going fully black"). 0.5 is the single
    # value tested; the dense right-canopy region (950-1250, 120-300) must move
    # from p50 6 toward the reference's 37. If it does not move, Lumen is not
    # the occluder and the leaf material is next.
    # PASS 05f: with the albedo fixed (V2_PASS_030: canopy p50 85 vs the
    # reference's 37, hedges 94/98 vs 75/32) the leak is inflating every
    # occluded area (castle eave 84 -> 113 in V2_PASS_029). Non-physical knob,
    # cause gone: 0. The bounce light stays for this render (one change).
    "lumenSkylightLeaking": 0.0,
    # PASS 01 (2026-08-28): exposure PINNED. Histogram auto-exposure metered
    # the frame to mid-grey and blew the ivory plaza to white (luma 0.33 vs the
    # reference's 0.16 at the engine's reported EV 12.5). min == max fixes
    # EV100; 13.5 is one stop darker than what the metering chose, the measured
    # correction. None restores auto-exposure.
    "exposurePinEV100": 13.5,
    # a clear bright day with subtle haze -- pale blue-white, NOT lavender
    # PASS 06: atmospheric perspective is what separates the castle focal
    # plane (95-130 m) from the beyond (185-420 m). 0.005 left the far
    # towers as crisp as the near ones; 0.009 is the single value tested, the
    # inscattering stays the pale sky-blue the dome's haze band uses.
    "fogDensity": 0.009, "fogFalloff": 0.18, "fogStartDistance": 4000.0,
    "fogInscattering": (0.74, 0.80, 0.92),
    # PASS 06: 3D CLOUDS. The dome now shows no architecture (skyHaze*), so the
    # low sky that HeroCam0 sees (5-35 deg of elevation) would be a bare
    # gradient; a VolumetricCloud actor with the engine's default cloud
    # material puts real, lit, 3D cumulus there. Tuned by measurement after
    # the first render (coverage lives in the material instance).
    # PASS 06b: the engine's default instance is an OVERCAST LID -- HeroCam0's
    # sky went from blue (p50 108) to grey-white (183) and SkylineCam06's
    # horizon to a dark grey band. The material exposes Cloud_GlobalCoverage,
    # Cloud_GlobalDensity and Cloud_AlbedoColor (read from the .uasset); the
    # layer gets its own instance: sparse cumulus over blue sky, a thinner
    # layer so the sun and the panorama's zenith stay visible.
    # PASS 06d: the physical sky (V2_PASS_053) is a deep clear blue, sky
    # top-centre p50 76 against the reference's 107 and a navy band at the
    # horizon, and no cumulus showed at 3.5 km. SkyLuminanceFactor scales
    # the atmosphere's sky luminance ((107/76)^2.2 = 2.1 -> 2.0), a larger
    # Mie scale pales the horizon into haze, and the cloud layer drops to
    # 2-4.5 km so cumulus sit in the 5-35 deg of elevation HeroCam0 sees.
    "skyLuminanceFactor": 2.0, "mieScatteringScale": 0.006,
    "volumetricClouds": 1, "cloudLayerBottomKm": 2.0, "cloudLayerHeightKm": 2.5,
    "cloudCoverage": 0.42, "cloudDensity": 0.55,
    # PASS 08 (2026-08-30): MESH CLOUDS, because the volumetric ones do not
    # arrive. Measured on HeroCam0: 1.3% of the sky band is cloud against the
    # reference's 12.4%, while the build log says the VolumetricCloud actor
    # spawned, MI_V2_Clouds took coverage 0.42, and the shadermap compiled --
    # the second failure of the feature on this Vulkan SM5 runtime after PASS
    # 06d moved the layer from 3.5 km to 2.0 km and changed nothing. The
    # volumetric actor STAYS (it costs nothing while it renders nothing, and
    # it is the thing to re-test on a future engine or driver); the sky the
    # player actually sees is geometry. Sizes are the real thing: cumulus 0.7
    # to 1.6 km across with bases at 1.3-2.3 km, which is what puts them in
    # the 5-32 deg of elevation HeroCam0 frames. They cast no shadow -- a
    # kilometre of shadow-mapped cloud is a cost with an unpredictable effect
    # on a world whose light budget was just measured.
    "meshClouds": 1, "cloudCount": 38,
    "cloudRingKm": (2.6, 13.5), "cloudAltKm": (1.30, 2.30), "cloudScale": (5.0, 12.0),
    "cloudVeilCount": 8, "cloudVeilRingKm": (5.0, 17.0), "cloudVeilAltKm": (3.2, 4.4),
    "cloudVeilScale": (14.0, 26.0),
    "volumetricFog": 1, "fogScattering": 0.20,
    # restrained magic: a small rune disc at the viewpoint, low glow
    "portal": 1, "portalRadius": 250.0, "portalGlow": 1200.0, "portalLightIntensity": 8000.0,
    # bloom low. PASS 08: the grade stops being a no-op. It was (1.00, 1.00,
    # 1.02)/(1.01, 1.00, 0.99)/(1.02, 1.00, 0.98) -- neutral to three
    # decimal places -- while the reference is warm across every non-sky
    # surface it has. These are colour GAINS: the shadows also come down in
    # level, because deepening shade is the measured gap (9.9% against
    # 25.7% below sRGB 40) and a gain is the one lever that reaches the
    # shadows without touching the sky, which already matches. Warm here is
    # a shift of about 12% R over B, not a sepia wash -- the failure mode to
    # watch is the whole world reading as one tan material (memory:
    # the-lamp-posts-were-the-key-light), and the check for it is each
    # material's BRIGHTEST decile, not the frame mean.
    "bloomIntensity": 0.35, "bloomThreshold": 1.2,
    # PASS 08b: half the warm gain. See sunTemperatureK above -- the grade and
    # the sun were both moved warm in PASS 08 and together they overshot.
    "gradeShadows": (1.02, 0.98, 0.94), "gradeMidtones": (1.035, 1.00, 0.955),
    "gradeHighlights": (1.015, 1.00, 0.975),
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
    # sampled from skyNearFills at the same v, cross-faded by colour. PASS 04e
    # (2026-08-28) took the columns BESIDE the objects (u 0.06-0.245 and
    # 0.805-0.94) because their luma p10 was 91/92 -- and V2_PASS_025 painted
    # the panorama's near pastel towers (the one at u 0.87 spans v 0.25-0.5)
    # behind our castle and its rose beds behind the mushroom: a luma
    # percentile cannot tell a bright tower from a cloud. PASS 04f: a skyline
    # scan (per 0.02-u bin, first 6-row block >= 30% non-sky, sky = cool AND
    # bright) finds ONE span with far content only, the far-castle direction
    # u 0.438-0.520: 0-5% content at v 0.30 and 0.36, its towers begin at
    # v ~0.38. PASS 04f mapped each band linearly onto that span -- which is
    # a 2.5x / 1.8x STRETCH (a 0.082 span over a 0.21 band), and V2_PASS_026
    # smeared the far castle across the left of the frame. PASS 04g mirror-
    # repeats the span at 1:1 instead (a triangle wave in u), so the gaps show
    # the distant skyline and clouds at their true size, 2.5x / 1.8x copies
    # with continuous seams. skyGain 14000: 9000 rendered the sky at sRGB p50
    # 79 and 18000 at 128 against the reference's 107 at the same pixels;
    # interpolated, and V2_PASS_026 measured 105.
    # PASS 06 (founder: "beyond the castle ... not a flat cheat"): the dome
    # paints NO architecture any more. From skyHazeV0 (elevation 36 deg) to
    # skyHazeV1 (25 deg) its colour blends into skyHazeColor -- the
    # panorama's own horizon sky, in texture units before skyGain -- and
    # stays haze down to the true horizon, where the ground slab takes over.
    # The panorama's tower ring, far castle and near objects all lie below
    # v 0.36; only sky and cloud remain above. What stands at the horizon is
    # 3D: the city layers, fog-softened.
    "skyHazeV0": 0.30, "skyHazeV1": 0.36, "skyHazeColor": (0.20, 0.27, 0.50),
    # PASS 06c (2026-08-28): THE DOME IS RETIRED. Two measurements: (1) the
    # haze band rendered near-white -- (0.56,0.64,0.80) x skyGain is ~9,000
    # nits at EV 13.5, while the panorama's own low sky is ~(0.20,0.27,0.50)
    # -- and (2) the volumetric clouds never showed at all: a cloud layer at
    # 3.5 km sits behind an opaque dome at 450 m. The sky is now PHYSICAL:
    # SkyAtmosphere (blue zenith, pale horizon by scattering) + 3D cumulus,
    # which is also what the founder asked for -- nothing painted. The
    # panorama stays the visual reference; skyDome=1 puts it back for a
    # comparison render.
    "skyDome": 0, "skyGain": 14000.0, "skyFlipV": 0.0, "skyHorizonV": 0.5,
    "skyYawOffset": 90.0, "skyNearBands": ((0.235, 0.445), (0.515, 0.665)),
    "skyNearFills": ((0.438, 0.520), (0.438, 0.520)),
    "castleKit": 1, "nanite": 1,
    # ONE canonical Relay Dog as ScaleCam07's scale reference (founder,
    # 2026-08-28: "one Dog only for scale; do not populate"). The approved,
    # frozen BP_RelayDog (174 cm) stands beside the right urn on the plaza,
    # BEHIND HeroCam0 (dy < 0) and just outside PlayerCam01's half-fov
    # (bearing 50.6 deg). Capsule half-height 87.1 puts its feet on z = 0.
    "scaleDog": 1, "scaleDogClass": "/Game/WonderlandV2/Characters/RelayDog/BP_RelayDog.BP_RelayDog_C",
    # (-560,-1000) stood 0.9 m BEHIND the gate's flanking wall (y = -910):
    # two ScaleCam07 renders without a Dog. Now inside the plaza, beside the
    # right urn, 6 m from ScaleCam07 at bearing 33 deg; the same wall hides
    # it from PlayerCam01, and HeroCam0 looks the other way.
    "scaleDogPos": (-330.0, -650.0, 87.1), "scaleDogYaw": 56.0,
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
