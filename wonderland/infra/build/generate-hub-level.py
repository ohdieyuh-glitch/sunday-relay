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

# WHERE THE GENERATED ASSETS LIVE. Textures and audio are synthesised on CPU
# before the engine ever starts and imported from disk here. The directories
# are environment-driven because the build host is not fixed: the old Vast box
# kept them at /opt/wonderland, a Lightning Studio keeps them on persistent
# storage under /teamspace, and a container sees whatever was mounted. Hardcode
# either one and the build silently imports nothing on the other — which is
# exactly what the first real Lightning run would have done.
_LEGACY_ASSET_ROOT = "/opt/wonderland"
_DEFAULT_TEX_DIR = _LEGACY_ASSET_ROOT + "/textures"
_DEFAULT_AUDIO_DIR = _LEGACY_ASSET_ROOT + "/audio"
_TEX_DIR = os.environ.get("WONDERLAND_TEXTURE_DIR", _DEFAULT_TEX_DIR)
_AUDIO_DIR = os.environ.get("WONDERLAND_AUDIO_DIR", _DEFAULT_AUDIO_DIR)

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
    # --- sky colour ------------------------------------------------
    # MEASURED AGAINST THE FOUNDER'S REFERENCE, on the bright pixels of the top
    # strip of each frame:
    #
    #     reference    RGB(143, 135, 188)     R - G = +8    lavender
    #     wonderland   RGB( 94, 140, 194)     R - G = -46   cyan blue
    #
    # Both are cooler than neutral and both peak in blue; the difference is 49
    # points of RED. The reference is a periwinkle where ours is a seaside blue,
    # and the comment beside the SkyAtmosphere has claimed "reads as bright
    # lavender sky" the whole time.
    #
    # Rayleigh scattering is the layer that decides this -- it is the sky's own
    # colour, not a grade laid over the frame. UE's physical default is roughly
    # (0.0058, 0.0136, 0.0331) per km, a ratio of 0.18 : 0.41 : 1.00, which is
    # why the sky comes out cyan.
    #
    # A KNOB, NOT A GUESS. An earlier attempt at a violet Rayleigh is recorded
    # below as having produced "a dark twilight", and that is the real risk:
    # this instrument changes brightness as well as hue, and no offline harness
    # can measure it -- the rasteriser has no atmosphere. So it sweeps from the
    # LOOK table like every other value here, and 0.0 reproduces today's sky
    # exactly. skyLavender blends the default toward an equal-R-and-G lavender.
    # AUTHOR THE PALETTE FOR A RENDERER, NOT FOR AN EYE.
    #
    # Measured, area-weighted over the visible frame, this world's own albedo
    # carries saturation 0.245 and its materials average 0.401 each. The
    # DELIVERED frame carries about 0.09. That ratio is not a defect hiding
    # somewhere -- it is what physically-based shading does: ambient arrives
    # from every direction at once, indirect light comes back off neighbours,
    # specular is white on a dielectric, and the tonemapper compresses. Every
    # one of those steps moves a surface toward the light's colour and none
    # move it back.
    #
    # The reference is an ILLUSTRATION. Its saturation is authorial: nothing
    # shaded it down, so what was drawn is what is seen. A renderer aimed at
    # that target has to be given a palette that survives being lit, which
    # means authoring PAST the target rather than at it.
    #
    # This is not the grade and it is not a cast being covered. It multiplies
    # each material's distance from its own luma, at the ALBEDO, before a
    # single light touches it -- the same move as painting the set brighter.
    # Sweep it with WONDERLAND_LOOK=paletteSaturation=1.0 to see the frame it
    # replaces.
    # CALIBRATED AFTER THE REAL CAUSE WAS FIXED, 90e8de8.
    #
    # These three were all raised to fight the same defect: 38 materials were
    # being replaced by the engine's DEFAULT GREY at draw time because the
    # master never declared bUsedWithInstancedStaticMeshes. Authoring past the
    # target, emitting a share of each surface's own colour, and pushing the
    # grade were compensations for colour that was never being drawn at all.
    #
    # MEASURED on the first frame after the fix: delivered saturation is 103%
    # of authored, not the ~33% this table asserted for weeks. The frame came
    # back 35.5% clipped, the ground at 60%. So the compensation comes off:
    # paletteSaturation 1.85 -> 1.00, selfColour 0.25 -> 0.06, grade saturation
    # 1.78 -> 1.25, and the fifteen materials re-authored "past the target"
    # revert to what they were authored as.
    #
    # No value in this palette had ever been seen through a working renderer.
    # This is the first honest look at it.
    # PER-PIXEL PROCEDURAL NOISE, now OFF by default.
    #
    # The node below it was added, in its own words, as "the single biggest step
    # away from a solid-colour graybox WITHOUT EXTERNAL TEXTURES". There are 39
    # external textures now, and the material test strip proved they draw --
    # cobblestone, gold leaf and fabric are all legible on the panels. The noise
    # is doing again, per pixel and at multi-octave cost, what the albedo map
    # already does from a texture fetch.
    #
    # It matters because the usage-flag fix moved the whole world off the
    # engine's DEFAULT material and onto this one. The old 20.5 FPS baseline was
    # measured while 38 materials drew a trivial default shader, so it was never
    # a measurement of this graph. Measured after the fix: 15/16/11 fps, GPU
    # pinned at 99%.
    #
    # >0 restores it at that strength.
    "baseNoise": 0.0,
    "paletteSaturation": 1.00,
    # How much of its OWN colour every surface emits. See the material loop:
    # thirteen refuted explanations for a correct albedo rendering grey, so the
    # palette stops depending on the lit path alone. A SHARE, not a replacement
    # -- light and shadow still read on top of it.
    # AN ACCENT, NOT A FLOOD. The founder's rule: "Emissive may accent
    # magic/gold, not flatten the whole world" and "do not use heavy
    # fog/emissive to hide bad surfaces". 0.22 gives every surface a colour
    # FLOOR so nothing reads as grey plastic, while leaving the lit response --
    # shadow, form, local light -- doing the visible work on top.
    # A colour FLOOR, kept: it costs nothing and it guarantees a surface can
    # never fall to grey even if some other path fails. Not a flood -- the lit
    # response still does the visible work.
    # MEASUREMENT ONLY, default 0. Restores the world-wide heartbeat so its cost
    # can be measured against the static world rather than asserted. See the
    # branch in build_material_library. UNTESTED as an art value because it is
    # not one.
    "animateEnvironment": 0,
    # THE CIRCLE'S GLOW, SWEEPABLE, BECAUSE GUESSING IT HAS NOW COST TWO BUILDS.
    #
    # At 11.0 it clipped through the ACES shoulder and rendered WHITE — the hue
    # was pushed so hard the three channels converged. At 2.6 it is dimmer than
    # the sunlit plaza it sits on and reads as a pale scratch. The right value
    # is between them and depends on the scene's exposure, which has moved four
    # times tonight; a literal buried in MATERIAL_SPEC cannot be swept without a
    # code edit and a full cook each time.
    #
    # WONDERLAND_LOOK=arcaneGlow=7 now costs one build instead of one edit plus
    # one build, and the value that wins can be written down with a frame behind
    # it. CHOSEN at 5.0 as the midpoint of the two that were measured wrong.
    # 5.0 -> 2.0. With the practical no longer flooding the stone, the ring does
    # not have to shout over it — and 5.0 puts the blue channel at 5.0 in linear
    # light, four stops past where the ACES shoulder starts pulling the three
    # channels together. The most violet pixel measurable anywhere in the plaza
    # band was (105, 0, 173), so the hue IS in there; it survives only where the
    # ring is dimmest. 2.0 keeps the whole ring in that range.
    "arcaneGlow": 2.0,
    # Aerial perspective, the atmosphere's depth cue. See the SkyAtmosphere
    # block. CHOSEN at 11.0 — roughly 3.4 km of air on the skyline by that
    # block's arithmetic — after 4.0 was measured to leave 80 km of distance as
    # crisp as 2 km. Sweepable with WONDERLAND_LOOK=aerialScale=.
    "aerialScale": 11.0,
    # ---- TASK 1: CINEMATIC DEPTH -------------------------------------------
    # The founder's brief, verbatim where it is a number: "Cinematic Bokeh DoF
    # focused on the foreground character", "Bloom (Intensity 1.5, threshold
    # 0.8)", "Volumetric Fog: Set high density with a soft purple/pink tint in
    # the background, making distant castles recede in haze", "golden hour
    # (warm ~4500K)".
    #
    # The hero Dog stands 1,600 uu from the arrival lens, so that is the focal
    # plane. f/6 rather than a wide-open stop: this is an ESTABLISHING shot and
    # the castle city is the thing it exists to present — the background should
    # go soft, not illegible.
    "dofFocalDistance": 1600.0,
    "dofFStop": 6.0,
    "dofFocalRegion": 900.0,
    "dofBlurAmount": 0.42,
    # Volumetric fog was tried once and "flooded the frame to min-luma 226" —
    # on a frame whose ground measured 193 and had no shade in it at all. The
    # scene is 106 now with 6.5% of it in shadow, which is the condition
    # volumetrics need to read as god rays rather than as milk.
    "volFogEnabled": 1,
    # 0.55 -> 0.22 and the distance 42,000 -> 14,000, MEASURED on the first
    # frame that had volumetrics at all. They work — there are god rays and real
    # ground shadows — and at that strength the fog REPAINTED THE SKY: the dome
    # went from blue with white cloud to a muddy purple-grey, and mean
    # saturation climbed to 0.49 against the reference's 0.43.
    #
    # That is the failure the height-fog comment two blocks down already
    # records — "any density strong enough to haze a tower also repaints the
    # sky" — arrived at from the volumetric side. The fix is the same shape:
    # let the fog own the NEAR and MID air, and leave the far sky to the
    # SkyAtmosphere's aerial perspective, which is set to 11.0 for exactly that
    # job. 14,000 uu covers the garden and the near town and stops well short of
    # the 25-80 km skyline.
    "volFogExtinction": 0.22,
    "volFogAlbedo": (0.74, 0.62, 0.92),      # the reference's lavender haze
    "volFogEmissive": (0.055, 0.030, 0.085),
    "volFogDistance": 14000.0,
    "volScatterSun": 2.4,                    # god rays through the gate and trees
    "contactShadowLength": 0.035,
    "sunTemperatureK": 4500.0,
    "lensFlare": 0.35,
    # ---- TASK 2.2: the arcane circle as line work --------------------------
    # radius in uu; the rune texture reads to its own edge, so this is the
    # circle's radius and the plane's half-side.
    "runeRadius": 560.0,
    "runeGlow": 2.4,
    "selfColour": 0.06,
    # 1 = the master renders UNLIT, so a surface shows exactly its palette and
    # no lighting path can grey it. 0 restores DefaultLit in one cook.
    # 0. UNLIT was reached for when the grey looked like a shading failure. It
    # was not: the towers were hazed, not mis-shaded, and unlit cost the Marble
    # backdrop (it rendered black) and every shadow in the world while fixing
    # nothing. Lit shading comes back now the real cause is known.
    "unlit": 0,
    "skyLavender": 0.55,
    # NEUTRALISE THE FILL. LightColor tints the SkyLight's whole captured-scene
    # contribution, and this world's captured sky is blue, so every surface the
    # sun misses was being painted with blue light and nothing else. That is the
    # lamp defect over again with the opposite colour: one dominant coloured
    # light deciding the hue of a huge share of the frame. Measured, the whole
    # world came back blue-dominant IN SHADOW regardless of albedo --
    #
    #     petal_pink   albedo (0.94, 0.40, 0.66)   shadowed rgb( 29,  30,  45)
    #     foliage      albedo (0.23, 0.46, 0.22)   shadowed rgb( 32,  28,  41)
    #
    # A shadow should be a DIMMER version of a surface, not a different colour
    # from it, and that is what the founder's reference does: the same 62.7% of
    # its pixels sit below luma 0.40 as mine, and they still carry 0.104-0.203
    # chroma where mine carried 0.063-0.093. Same darkness, different colour.
    # Warm-neutral, a touch under the key, so the shade stays cooler than the
    # sun without being made OF blue.
    "skyWarm": (1.00, 0.96, 0.93),
    # RAISED 340 -> 780 AFTER TAMING THE LANTERNS, and the two are the same
    # decision. Eighteen practicals at 14,000 lumens were not decoration, they
    # were a third of this world's lighting -- so removing their gold removed
    # the light with it: mean frame luma fell 0.321 -> 0.224 against the
    # reference's 0.327, and dark went 32.8% -> 56.2% while gold_amber fell
    # 10.2% -> 0.6% and warm_timber_stone 25.4% -> 3.2%.
    #
    # That is the right trade taken half way. The hue is now correct and the
    # level is not, so the level comes back from the KEY and the SKY, which are
    # neutral, instead of from eighteen gold lamps that were never meant to
    # light a garden.
    # 780 -> 1150. The relit frame came back at mean luma 0.346 against the
    # reference's 0.327 -- brightness solved -- and mean CHROMA 0.112 against
    # 0.177. It is bright and grey: neutral_stone went 9.5% -> 32.8% of the
    # frame, which is the classifier saying "this pixel has almost no colour
    # left". Pink materials cover 12.9% of the frame and only 2.8% of it reads
    # as pink.
    #
    # That is what a big ambient does. Sky at 9.40 and bounce at 0.58 is a lot
    # of flat light arriving from everywhere at once, and light with no
    # direction has no shading -- so a saturated surface is lit evenly, washes
    # toward its own tint of white, and loses its hue. The reference is the
    # opposite: a hard sun, deep cool shade, and colour that survives because
    # it is SHAPED.
    #
    # So the level moves from the ambient into the key.
    # 1150 -> 1420, splitting two rendered frames. Trading ambient for key
    # fixed the wash (neutral_stone 32.8% -> 24.0%) and cost the shadows
    # (dark 28.3% -> 35.2%), because a hard key with a small ambient is
    # contrasty by construction. The reference is 25.0% dark and 7.5%
    # neutral_stone, so it wants both -- which means more KEY, not more ambient.
    # 1420 -> 960. The matte build came back at mean luma 0.394 against the
    # reference's 0.327, with 21.1% of its pixels above 0.62 luma against the
    # reference's 9.9%. That is over-exposed, and over-exposure is why the
    # colour keeps vanishing: ACES desaturates as values approach white, so a
    # fifth of the frame sitting in the highlight roll-off loses its hue by
    # construction, whatever the material underneath says. It is also why every
    # attempt to fix the grey by ADDING light made it greyer.
    # 1150 -> 2600. MEASURED AGAINST THE ONE THING IN THE FRAME THAT IS NOT
    # LIT AT ALL. The Marble backdrop is an unlit painted skyline: its
    # brightness is fixed by its texture and does not move when the world's
    # lighting does. So it is a RULER. Against it, the entire lit world was
    # 1.14 stops down -- median luma 59/255 against the backdrop's 135, a 2.2x
    # gap in linear luminance.
    #
    # That single fact explains every measurement this session, including the
    # ones I read wrongly. "The lit path carries 2.4x less chroma than the
    # unlit Marble at matched luma" was true and was not a material defect:
    # the lit world was simply sitting a stop and a bit below the exposure the
    # frame was graded for, where sRGB has little room left to hold a hue. The
    # frame's own chroma curve says so -- 0.316 at luma 0.50-0.60, which BEATS
    # the founder's reference at 0.273, and 0.063 at luma 0.10-0.20 where two
    # thirds of the world was sitting.
    #
    # This holds under either answer to the metering question the file argues
    # with itself about, which is why it is the right lever: the Marble does
    # not scale with the lighting, so raising the lighting improves the RATIO
    # whether or not auto-exposure then re-meters both.
    # 2600 OVERSHOT and 1150 undershot; this is the interpolation between two
    # RENDERED frames rather than a third guess. Measured against the unlit
    # Marble ruler, which does not move when the lighting does:
    #
    #     sunLux 1150   lit median luma  71/255   +0.91 stops UNDER the backdrop
    #     sunLux 2600   lit median luma 189/255   -0.37 stops OVER  it
    #
    # and 52.6% of the 2600 frame landed in luma 0.70-0.85, where chroma falls
    # to 0.063 because a blown pixel has no hue left. Solving in log space for
    # a lit median near 0.50 puts the key here.
    #
    # The bracket also proved the thing worth keeping: at the SAME luma the
    # brighter build carried three times the chroma (0.231 against 0.077 at
    # luma 0.30-0.40). The darkness really was crushing the colour.
    # 1950 -> 3400, taking over the level that skyIntensity is giving up, but
    # as a KEY: directional, shadow-casting, one direction. At bounceRatio 0.72
    # this also puts 2,448 lux of WARM bounce into the shade, which is what the
    # earlier sky-cut attempt could not do -- at sunLux 1150 the bounce was only
    # 828 lux and cutting the sky just made the world black.
    # BRIGHT PASTEL DAYLIGHT, which is what the reference is lit by. A garden
    # at midday under a high sun: strong key, readable shadows, no dusk.
    # 5200 -> 3600. Raising the key BEFORE the colour worked pushed the whole
    # frame toward white and made the grey worse, not better. That was my error
    # and it comes back down: colour first, then brightness.
    # MEASURED 2026-08-24, 3600 -> 1150, and this is the number the whole
    # exposure problem was hiding behind.
    #
    # The experiment: capture the same package twice, once normally and once
    # with ShowFlag.DirectionalLights 0. Everything that survives the second
    # capture is emissive, skylight and atmosphere; the difference between them
    # is what the sun, fill and bounce contribute. Measured on HeroCam6:
    #
    #                       lit    no directional   reference
    #     mean luma       154.8            91.3         83.5
    #     saturation       0.32            0.47         0.43
    #     below luma 18    1.2%            6.7%         8.6%
    #     sky - ground    -19.7           +40.4         +9.2
    #
    # The frame with NO SUN AT ALL is closer to the founder reference on every
    # single axis than the lit one. The directional budget is not lighting this
    # world, it is washing it: 63 luma of flat brightness, and it takes the
    # saturation and the shadows and the sky/ground relationship with it.
    #
    # fillRatio and bounceRatio are fractions of this, so cutting here cuts all
    # three and holds the 8:1 key ratio that was just established. 1,150 lux
    # should leave the directional contribution near 20 luma instead of 63.
    #
    # It also fixes the sky the right way round. The no-directional capture kept
    # its sky band at 112 luma, so most of the sky's brightness does not come
    # from this light — taking light OFF the ground is what inverts the
    # relationship, exactly as the practicals cut predicted and did not finish.
    # 1150 -> 980, MEASURED, and this is the last lighting nudge rather than a
    # fourth guess. Sampled directly off the cycle-11 render at 1920x1080:
    #
    #     sunlit stone face   rgb (224, 217, 212)   luma 218   sat 0.05
    #     plaza stone         rgb (128, 116, 110)   luma 118   sat 0.14
    #     gold gate           rgb (181, 126,  25)   luma 130   sat 0.86
    #
    # The gold is excellent and the paving is right. What still reads as the
    # "simple white walls" the art direction names is not a material and not a
    # blockout — it is ORDINARY STONE at 218, the brightest thing in the frame,
    # desaturated to 0.05 by the tonemapper on the way up. The frame-wide
    # numbers agree from the other side: mean luma 116 against the reference's
    # 83, and only 4.6% of the frame in shadow against its 8.6%. Every one of
    # those wants the same thing.
    "sunLux": 980.0,
    # MEASURED, NOT CHOSEN. dog_body's base colour is (249,249,252) -- a white --
    # and on the streamed frame it renders (188,165,129): a ratio of
    # 1.00 : 0.88 : 0.69 on a surface facing the key. A directly-lit white
    # should read as a white. That cast is on EVERYTHING the sun touches, which
    # is why the offline preview measures the geometry at 2.7% warm_timber_stone
    # while the RENDER measures 25.3% of it -- the tan is not in the world, it is
    # applied to the world.
    #
    # The reference keeps its whites white and its pinks pink in the sun and
    # puts its colour contrast in the SHADE (cool violet), rather than washing
    # the whole frame warm. With ColorSaturation at 1.52 a warm key is not a
    # subtle choice: saturation multiplies the cast rather than the palette.
    #
    # Near-neutral key. The warmth that remains comes from the atmosphere and
    # the practicals, which is where it belongs. Sweep with
    # WONDERLAND_LOOK=sunWarm=1.0/0.94/0.84 to get the old cast back.
    # A WARM KEY IS NOT A CAST. The sun is directional and SHADOWED: it lights
    # what faces it and nothing else, so it cannot do what the lanterns did.
    # Neutralising it was tried and rendered and moved the frame 0.1 points,
    # which is how it was ruled out as the cause -- but that also means warming
    # it is cheap and safe. Late-afternoon garden light, not gold.
    # Warm gold highlights on a daylight key -- the reference's sun is warm
    # without being amber.
    "sunWarm": (1.00, 0.962, 0.905),
    "sunPitchMin": 25.0,                   # PROVEN. Flatter than this and
                                           # the long shadows swallow the plaza.
    # --- fill ------------------------------------------------------
    # MEASURED 2026-08-24, 0.50 -> 0.12. The note below is still true and it
    # was still the wrong size, which is the whole finding.
    #
    # PROVEN. A second directional at the reciprocal azimuth, shadowless.
    # Skylight and Lumen ambient do NOT reliably contribute in headless
    # -RenderOffscreen, so without this some surfaces face nothing at all.
    #
    # WHAT THE FIRST NATIVE RENDER OF THIS WORLD SHOWED. At 0.50 the fill is
    # 1,800 lux and the ground bounce another 2,592, against a 3,600 lux key:
    # 4,392 lux of SHADOWLESS directional light against 3,600 that casts. The
    # fill is 122% of the key, so every shadow the sun throws is filled back in
    # by more light than the sun provides. Measured on the frame: 0.06% of it
    # below luma 18. There are no shadows in Wonderland, and it is not a shadow
    # setting — the scene is lit so that nothing can be in shade.
    #
    # The comment above says so out loud: "Guarantees EVERY surface gets direct
    # light." That guarantee was written against a real problem and became the
    # thing destroying the image. It is the same failure as the lamp posts
    # becoming the key light, in a new place: the FILL became the key.
    #
    # 0.12 puts the key:fill ratio at 8:1, which is a cinematic key. Surfaces
    # facing away still receive light; they just stop receiving as much as the
    # ones facing the sun.
    "fillRatio": 0.12,
    "fillYawOffset": 160.0,
    "fillPitch": -45.0,
    # --- ground bounce ---------------------------------------------
    # THE BLACK IS UNDERSIDES, AND IT IS A LIGHTING PROBLEM.
    #
    # Key and fill both come from ABOVE — pitch -45 and lower — so every
    # downward-facing surface in the world receives nothing from either.
    # Lumen's bounce and the skylight do not reliably contribute in headless
    # -RenderOffscreen, which is exactly how Wonderland renders. The result is
    # that the canopy, the boughs, the arch soffits and the undersides of every
    # floating island read as pure black holes, and in the last measured frame
    # 37.7% of the pixels had no colour left to classify.
    #
    # In daylight those surfaces are lit by GROUND BOUNCE. So: one more
    # shadowless directional, aimed UP, dim and warmed by the paving it is
    # standing in for. This raises undersides only — it cannot touch anything
    # the sun already reaches, which is what makes it different from lifting
    # exposure and washing the whole frame.
    "bouncePitch": 62.0,             # AIMED UP. Positive pitch, unlike key/fill.
    # RAISED 0.22 -> 0.55 AFTER MEASURING. At 0.22 the bounce was 75 lux against
    # a 340-lux key and the streamed frame was still 40.7% below the shadow
    # threshold. Manual exposure moved that by 0.4 points — nothing — which
    # rules metering out: the black is surfaces receiving no light, and the fix
    # is the RATIO of fill to key, not the level. A ratio change is also the one
    # thing auto-exposure cannot undo, because re-metering scales both together.
    #
    # AND THEN MEASURED AGAIN, WHICH FOUND WHAT THE RATIO COST. With the bounce
    # at 0.55 the shadows stopped being black and started being BROWN. Sampling
    # the streamed frame per material, against each material's own base colour:
    #
    #     porcelain  base (244,242,237)  ->  rendered ( 80, 59, 30)
    #     stone      base (224,216,204)  ->  rendered (108, 85, 52)
    #     mush_red   base (188, 40, 66)  ->  rendered (117, 89, 42)
    #     foliage    base ( 58,117, 56)  ->  rendered ( 65, 55, 49)
    #
    # A near-WHITE material rendering dark brown is not a material problem, and
    # neither is a pink one and a green one landing on the same hue. Every one
    # of them converges on R:G:B of about 1.00 : 0.78 : 0.48 -- and when outputs
    # converge regardless of input, the cause is downstream of all of them.
    #
    # It is this light. Most surfaces in this frame face away from the key, so
    # what lights them is the bounce -- and the bounce is warm, at 55% of key,
    # while ColorSaturation is 1.52. Saturation cannot tint neutral, but it
    # multiplies a MILD warm cast into a decisive one: warm fill at 1.00/0.85/
    # 0.65 in linear, pushed 1.52x, lands almost exactly on the 1.00/0.78/0.48
    # that was measured.
    #
    # Real outdoor shadow is lit by the SKY and is COOL. The founder's reference
    # is built on that contrast -- warm sunlit faces against cool violet shade --
    # and it is why its whites stay white and its pinks stay pink in shadow.
    # Ours had warm light on both sides, so there was no contrast to carry hue.
    #
    # So the fill moves from the ground to the sky: the bounce drops back toward
    # neutral and to 0.42, and skyIntensity carries the difference. That is a
    # RATIO change, which is the one thing auto-exposure cannot undo -- the same
    # reasoning that raised the bounce in the first place, applied to its colour.
    # AND BACK UP, NOW THAT IT IS NOT WARM. Dropping the bounce to 0.42 cooled
    # the shade and cost brightness with it: dark went 29.7% -> 36.7% while
    # violet went 3.2% -> 7.2% and blue 22.4% -> 15.0%. The colour move was
    # right and the level move was not. A NEUTRAL fill can be strong without
    # tinting anything, which is the whole point of having neutralised it.
    # 0.40 -> 0.72. Replaces, in warm light, the ambient taken off skyIntensity
    # above, so the frame keeps its level while its shade stops being blue. At
    # sunLux 1150 that is 460 -> 828 lux.
    #
    # MEASURED 2026-08-24, 0.72 -> 0.10. sunLux is 3,600 now, not 1,150, so
    # 0.72 is 2,592 lux — a shadowless upward-facing light SEVENTY-TWO PERCENT
    # as strong as the key. The paragraph above sized it against a sun three
    # times dimmer and the ratio was never revisited when the sun moved. A hint
    # of light off the paving is 0.10; 0.72 is a second key aimed at the sky.
    "bounceRatio": 0.10,
    "bounceWarm": (1.00, 0.97, 0.94),  # near-neutral: the SKY tints the shade now
    "bounceEnabled": 1,
    # Was hardcoded at 1.60 beside the SkyLight. It is the instrument that
    # decides what colour this world's shadows are, so it belongs here where it
    # can be swept: WONDERLAND_LOOK=skyIntensity=1.6 restores the warm-shadow
    # frame this replaces.
    # 1.60 -> 3.10 cooled the shadows; 3.10 -> 5.20 is what lifts them. The sky
    # is now lavender (see skyLavender), so skylight is the one instrument that
    # makes shadows BRIGHTER and MORE VIOLET at the same time -- the two moves
    # the reference is furthest away on (dark 36.7% vs 25.0%, violet 7.2% vs
    # 22.4%).
    # 5.20 -> 9.40 for the same reason as sunLux, and preferentially: the sky
    # is lavender now, so it is the source that brightens shadows and pushes
    # them violet at once. violet_purple is 8.3% against the reference's 22.4%.
    # 6.20 -> 3.40. MEASURED, and this is the shadow defect. In the delivered
    # frame every shadowed surface rendered BLUE-DOMINANT regardless of its own
    # albedo -- petal_pink, base (0.94, 0.40, 0.66), came back rgb(29, 30, 45).
    # A multiplicative light cannot invert a hue like that on its own; what does
    # it is a shadow lit by ONLY ONE source. The sun reaches none of these
    # pixels, the upward bounce reaches only down-facing ones, so a blue sky was
    # the entire light budget of 64.6% of the frame, and it decided the colour of
    # all of it. Chroma there measured 0.063-0.093 against the reference's
    # 0.104-0.203 at the SAME luma -- the frames are not differently exposed
    # (64.6% of mine below luma 0.40 vs 62.7% of the reference), the shadows are
    # differently COLOURED. Halved, and the difference handed to bounceRatio,
    # which is warm and carries the ground's own colour instead of the sky's.
    # 3.40 -> 6.80, and see skyWarm. Halving it was the right diagnosis and the
    # wrong instrument: the blue lift in shadow DID drop (gold B-R +9 -> +4,
    # roof_rose +7 -> +4), which confirms the sky was choosing the hue -- but the
    # frame went DARKER (16.6% of pixels under luma 0.10, up from 10.8%) and the
    # chroma did not move, 0.112 -> 0.108. The reason is structural: the SkyLight
    # is the only OMNIDIRECTIONAL light in this world. The ground bounce is a
    # directional pointing up, so it fills down-facing surfaces and nothing else,
    # and it cannot take over the job. Turning the sky down therefore does not
    # trade blue shadow for warm shadow -- it trades blue shadow for BLACK.
    # So the amount goes back, and the COLOUR is what gets fixed instead.
    # 6.80 -> 20.0, raised HARDER than the key (2.9x against the sun's 2.3x).
    # Both ends of this frame were crushed, not one: 64.6% of it sat below luma
    # 0.40 carrying half the reference's chroma, while the brightest decile of
    # every single material had converged on near-white at saturation 0.01-0.17.
    # A wider key would deepen that. The sky is what lifts the SHADOW end, and
    # the shadow end is where most of Wonderland lives -- 59% of the foliage and
    # 73% of the leaf cards are in it. Lifting fill faster than key narrows the
    # ratio, which is the actual shape of the defect.
    # 14.0 -> 3.0. THE WORLD HAD NO SHADOW LEFT IN IT. Per material, the share
    # of pixels below the shadow threshold, on a delivered frame:
    #
    #     mush_red  1%     stone  4%     gold  4%     roof_rose  4%
    #
    # against 59-73% two builds earlier. An omnidirectional fill this strong
    # reaches every face of every object equally, so nothing turns away from
    # the light and nothing casts. That removes FORM, and form is most of what
    # makes a render read as a place rather than a pile of shapes -- the
    # reference has hard sun, real cast shadows and lit/shade sides on every
    # mushroom.
    #
    # It is also the last standing candidate for the colour. Everything else
    # has been refuted by the frame that tested it: specular, fog, the sky's
    # hue, bloom, the ACES shoulder, and the materials themselves (which a
    # runtime line now proves are bound correctly on all 147 batches).
    # A bright sky fills the shade with pastel rather than leaving it black,
    # which is how the reference's shadows stay colourful instead of dead.
    #
    # MEASURED 2026-08-24, 4.2 -> 1.5. True in principle and the third term in
    # a scene that already had no shade to fill. A SkyLight is omnidirectional,
    # so all of it is shadow-fill: stacked on 4,392 lux of shadowless
    # directional it is why the frame came back with 8.15% pure-white pixels
    # and 44% of itself above luma 224 despite -3.4 stops of exposure bias.
    # Cut with the fill and the bounce, as one change to one thing — the total
    # shadowless budget — rather than four separate tweaks.
    # MEASURED 2026-08-24, 0.85 -> 1.70. The sun cut landed the frame at mean
    # luma 94 against the reference's 83 and saturation 0.48 against 0.43 —
    # both close — but it OVERSHOT the shadows: 23.2% of the frame below luma
    # 18 where the reference has 8.6%. The directional-off control says why: with
    # the sun gone the ground band sits at 18 luma, so anything the key does not
    # reach is nearly black. A shadow in the reference is a colour, not a hole.
    # This is the term that fills them, and it is the one that was cut furthest.
    # 1.70 -> 1.45 with it. The ambient was raised to rescue a 23% shadow crush
    # and it overshot the other way: shadows are now shallower than the
    # reference's, which is the half of "cinematic lighting" that reads as
    # depth. Taking a little back deepens them without touching the key.
    "skyIntensity": 1.45,
    # --- foreground planting ---------------------------------------
    # Sweepable for the same reason the bounce is: an art change nobody can A/B
    # is an art change nobody can evaluate. WONDERLAND_LOOK=foregroundPlanting=0
    # renders the same world without it, which is how the before/after below was
    # measured on CPU with no GPU in the loop.
    "foregroundPlanting": 1,
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
    # --- practicals ------------------------------------------------
    # MEASURED. At 14000 the lantern practicals were 41x the sun's 340 and
    # shadowless, and they made every material in the midground render gold.
    # Sweep with WONDERLAND_LOOK=lampLumens=14000 to see the frame they made.
    # 2200 -> 3000. Now that the lamp colour is near-neutral (255,226,190)
    # rather than gold, a practical can carry a little more light without
    # deciding the frame's hue -- which was the actual defect, not brightness.
    # 3000 -> 4600. Still well under the 6,000 the light-budget gate refuses,
    # and now SHADOWING -- so it can carry warmth without carrying hue through
    # walls, which is the property that made 14,000 a cast rather than the
    # brightness.
    # MEASURED 2026-08-24, 4600 -> 1600. The lamps are SHADOWLESS ground-side
    # light and there are 25 of them; the sun is 3,600 lux and lights the sky as
    # well as the ground. That asymmetry is why the first native render came
    # back with the SKY BAND DARKER THAN THE GROUND BAND by 43.5 luma, which
    # does not happen outdoors in daylight and is the loudest wrong note in the
    # picture. The sky is lit by the atmosphere alone; the ground was lit by the
    # sun AND the fill AND the bounce AND the skylight AND twenty-five lamps.
    # Cutting the ground-only sources is what inverts that relationship back.
    #
    # This is the third time the practicals have been found acting as the key.
    "lampLumens": 600.0,
    # How close to the arrival camera a lantern has to be to earn its shadows.
    #
    # AT 2600 THIS CURRENTLY EXCLUDES NOTHING -- all twelve lanterns are inside
    # it, so the frame pays 12 x 6 = 72 cubemap faces rather than the 150 it
    # would at 25. That is deliberate and it is not a reduction: every lantern
    # is in the plaza, every one of them can light through a wall into the
    # arrival frame, and excluding any of them re-opens the defect for that
    # lamp. The knob is a SAFETY VALVE, not an active saving -- if the next
    # rendered frame says 72 shadow passes cost more than the frame rate can
    # afford, this is where the trade gets made, explicitly, against a measured
    # number rather than a guess.
    "lampShadowRadius": 2600.0,
    # 0.5 -> 0.0, AS A TEST WITH A REASON. Bloom is ADDITIVE and screen-wide,
    # and the arithmetic on a delivered frame says an additive WHITE term is
    # exactly what is wrong. Solving mush_red's darkest half for out = a*E + S,
    # with its probed albedo (0.74, 0.16, 0.26) and its own texture:
    #
    #     E = 0.089   diffuse contribution 0.063
    #     S = 0.258   FOUR TIMES the diffuse
    #
    # and the trend across three rendered frames points the same way: as the
    # world got brighter, mean chroma FELL, 0.108 -> 0.086 -> 0.068. A veil
    # that scales with scene brightness does that; a palette problem does not.
    #
    # The materials themselves are now RULED OUT by a direct probe of the
    # cooked assets: MI_mush_red is parent M_WLMaster, BaseColor
    # (0.740,0.160,0.260), AlbedoTex T_cap_a, Specular 0.12. Every one checked
    # was correct. The defect is downstream of the material.
    # REFUTED and restored. Turning it off moved mean chroma 0.086 -> 0.089,
    # which is nothing. Bloom was not the additive white term. It goes back
    # because a thresholded glow on gold and emissive is wanted for its own
    # sake, and it is now known to cost no colour.
    # The brief gives these two as numbers: "Bloom (Intensity 1.5, threshold
    # 0.8)". 0.5/1.5 was a threshold high enough that only true highlights
    # bloomed, which was the right call when every midtone was blown to white
    # and any bloom on them read as milk. With 0.00% of the frame clipped there
    # is nothing left to protect, and 0.8 is where the reference's gold and
    # magic actually glow.
    "bloomIntensity": 1.5,
    "bloomThreshold": 0.8,
    # --- grade (runs AFTER metering; this is the real brightness lever)
    # MEASURED AGAIN, ON A DELIVERED FRAME. 0.60/0.60/0.64 was measured against
    # a wash, and it does stop one — but the streamed frame came back with 46.2%
    # of its pixels below the palette classifier's shadow threshold, against
    # 25.7% for the founder's own reference image. Colour crushed to black is
    # not a palette problem, and saturating materials to fix it would have been
    # work in the wrong place.
    # 0.67 -> 0.82. This was set to stop a wash, and it did -- but the wash it
    # was set against was the 14,000-lumen gold lantern cast, and that was
    # found and fixed at the light. What is left for it to darken is a frame
    # that is already more than a stop under its own backdrop, so it had
    # stopped being a correction and become part of the problem. Lifted, not
    # removed: the highlight end still needs holding, and gainHighlights is the
    # instrument for that, not this.
    # 0.75 -> 0.46. THE FRAME IS RIDING THE TOP OF THE TONEMAPPER, which is
    # where ACES trades saturation for headroom. Per material, on a delivered
    # frame, the DARKEST HALF of the pixels:
    #
    #     mush_red   darkest half rgb(155,144,149)  luma 0.58  sat 0.07
    #     stone      darkest half rgb(126,117,127)  luma 0.47  sat 0.08
    #
    # mush_red has literally NO pixel below luma 70. A material whose albedo
    # is (0.74,0.16,0.26) cannot show that albedo when its darkest pixel is
    # already brighter than mid-grey.
    #
    # Against the founder's reference, which is the target: 77% of ITS pixels
    # sit below luma 0.50, against 33% of this frame's. Matching the unlit
    # Marble backdrop was the right instrument for the LIGHT and the wrong
    # target for the GRADE -- that ruler includes the bright sky.
    #
    # The light stays UP, deliberately. Like-for-like at the SAME output luma,
    # the brighter build carries two to three times the chroma of the dark one
    # (0.166 against 0.047 at luma 0.10-0.20), because shadows that get a
    # coloured bounce keep their hue and shadows that get nothing do not. So
    # the fix is to keep lighting the world and stop pushing the RESULT into
    # the shoulder. Gain runs before the tonemap curve, which is what makes it
    # the instrument here rather than exposure bias.
    # 0.46 -> 0.60, holding the frame near the reference distribution now that
    # the fill is coming down with it. 0.46 was measured against a frame lit by
    # a 14.0 sky; it is not the same frame any more.
    # Pulled down to hold a bright key out of the tonemapper's shoulder, so
    # the extra light lands as COLOUR rather than as white.
    "gain": (0.58, 0.58, 0.60),
    # RAISED 1.52 -> 1.78. Saturation was tuned while the frame carried a
    # false gold cast, and in that state it multiplied the CAST rather than the
    # palette -- which is why it was correct to be suspicious of it. The cast is
    # gone (gold_amber 10.1% -> 0.6%, warm_timber_stone 23.6% -> 3.1%), so what
    # it amplifies now is the world's own colour. This is not covering a defect;
    # the defect was found and fixed at the light.
    "saturation": (1.25, 1.25, 1.25),  # CHOSEN. Jewel tones.
    "contrast":        (1.18, 1.17, 1.16),  # CHOSEN.
    "gainHighlights":  (0.82, 0.78, 0.68),  # MEASURED. Holds the white Dog,
                                            # spires and porcelain off pure
                                            # white so they keep hue and form.
    # Lifted out of the crush, keeping the blue so the warm-near / cool-far
    # split survives. R and G below 1.0 were pulling the shadow end down twice.
    # (1.06, 1.06, 1.26) -> (1.12, 1.10, 1.10). The +0.20 on BLUE was a grade
    # deciding the hue of the frame's shadows, and it was amplifying the sky
    # cast above rather than balancing it: dividing the measured shadow pixels
    # back through it leaves them still blue-dominant, so it is the amplifier,
    # not the source. The LIFT is kept -- it is there to keep shadows out of the
    # crush, which is real -- and the tint is dropped, because a shadow's colour
    # should come from what lights it.
    # MEASURED 2026-08-24, (1.12,1.10,1.10) -> (0.94,0.94,0.98). The lift was
    # "there to keep shadows out of the crush, which is real" — and there was
    # nothing anywhere near the crush to keep out of it: 0.06% of the frame sat
    # below luma 18. A lift applied to a scene with no shadows only removes the
    # last of the contrast. It comes back below 1.0 so the shade the new key
    # ratio creates is allowed to BE shade, with a faint cool bias because
    # skylight is what fills it.
    "gainShadows":     (0.94, 0.94, 0.98),
    "gamma":           (1.0, 1.0, 1.02),    # CHOSEN.
    "whiteTemp": 6000.0,                    # CHOSEN.
    # 0.44 was CHOSEN, never measured, and a vignette that strong is pure
    # subtraction at the frame edge — the corners of every hero capture this
    # session were near-black.
    "vignette": 0.18,
    # --- local light -----------------------------------------------
    # UNTESTED. The world has exactly one kind of light actor (lantern
    # points) and otherwise relies on emissive geometry, which Lumen
    # bounces only weakly. The hero beats — the arcane circle the Dog
    # stands on, the gate's gold, the fountain — therefore glow without
    # throwing anything, and a glow that lights nothing reads as a decal.
    # These are tightly attenuated so they stay pools rather than a
    # second ambient. Set heroLights=0 to A/B them in one cook.
    "heroLights": 1,
        # 9000 -> 5200. verify-light-budget.py refuses a practical above 6,000
    # lumens, and it was right to: the hero gate light was 7,650 GOLD and
    # shadowless, the same instrument and the same colour as the eighteen
    # lanterns that turned this whole world tan. One is not eighteen, but it is
    # the brightest gold thing left in the frame.
    #
    # It can afford to come down because the KEY went up -- sunLux 340 -> 780 --
    # so the hero practicals no longer have to carry the scene to be seen. At
    # 5200 the per-light scales give 5200 / 4420 / 2860, all under the ceiling.
    # Same cut, same reason: a hero practical at 5,200 lm beside a 3,600 lux sun
    # is a second key placed at the subject.
    # 1100 -> 380, MEASURED off the cycle-12 render and this is the actual
    # reason the arcane circle has never read as violet.
    #
    # Sampled on the plaza either side of a ring:
    #
    #     stone between the rings   rgb (227, 193, 225)   sat 0.15
    #     stone away from circle    rgb (128, 116, 110)   sat 0.14
    #
    # The courtyard under the circle is EIGHTY LUMA BRIGHTER than the same
    # material six metres away, and tinted lilac. That is this practical: a
    # violet point light sitting on the circle, flooding the stone it is meant
    # to sit on. So the rings were being drawn bright-on-bright, and no amount
    # of emissive fixes that — pushing the rings harder only climbs the ACES
    # shoulder and turns them white, which is exactly what happened at 11 and
    # again at 5.
    #
    # The reference's circle is light on DARK stone. The contrast comes from the
    # surround being dim, not from the glyphs being loud. 380 lm accents the
    # ring without lighting the courtyard.
    "heroLightLumens": 380.0,
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


# ---------------------------------------------------------------- analysis hook
#
# Every visual piece the world places passes through here. It does nothing in
# the editor; the offline harnesses REPLACE it to capture the world without an
# engine.
#
# It exists because those harnesses used to capture by INJECTING a call into a
# specific line of source text and raising if that exact line was not found. A
# capture keyed to a line of code is a capture that stops working the day the
# line moves — silently, reporting an empty world as a measured one — and this
# change moves that line. A named hook can be replaced from the namespace and
# cannot be missed by accident.
def _marble_placement_mode():
    """The placement_mode of the world being imported, or None.

    Separate from _marble_shell_reach because they answer different questions:
    that one asks HOW FAR the shell reaches, this asks WHETHER it is a backdrop
    at all. Conflating them is how a metric-placed world would silently delete
    the skyline it was never meant to replace.
    """
    slug = (os.environ.get("WONDERLAND_MARBLE_IMPORT")
            or os.environ.get("WONDERLAND_MARBLE_BACKDROP_SLUG") or "").strip()
    if not slug:
        return None
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.normpath(os.path.join(here, "..", "..", "marble", "worlds", slug,
                                         "manifest.json"))
    try:
        with io.open(path, encoding="utf8") as handle:
            manifest = json.load(handle)
    except Exception:
        return None
    return ((manifest.get("transform") or {}).get("placement_mode") or "").strip() or None


def _marble_shell_reach():
    """How far the placed Marble shell actually reaches, in uu, or None.

    Read from the world's own manifest — the extent measured off the GLB and the
    scale the importer will place it at — rather than restated in a comment. The
    comment version of this number was written against the metric scale while the
    layer is placed at the backdrop scale, and was wrong by a factor of six.

    Returns the NEAREST half-extent, because that is the distance at which the
    shell first stands behind something.
    """
    slug = (os.environ.get("WONDERLAND_MARBLE_IMPORT")
            or os.environ.get("WONDERLAND_MARBLE_BACKDROP_SLUG") or "").strip()
    if not slug:
        return None
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "..", "..", "marble", "worlds", slug, "manifest.json")
    path = os.path.normpath(path)
    try:
        with io.open(path, encoding="utf8") as handle:
            manifest = json.load(handle)
    except Exception:
        return None
    transform = manifest.get("transform") or {}
    extent = transform.get("expected_unreal_extent_cm")
    if not extent:
        span = (manifest.get("source_mesh") or {}).get("span")
        scale = (transform.get("unreal_backdrop_scale")
                 or transform.get("unreal_uniform_scale"))
        if not span or not scale:
            return None
        extent = [v * scale for v in span]
    horizontal = [e for e in extent[:2] if e]
    if not horizontal:
        return None
    return min(horizontal) / 2.0

def palette_saturate(rgb):
    """Push a palette colour away from its own luma by LOOK["paletteSaturation"].

    Applied at the ALBEDO, before any light. See the LOOK entry: a rendered
    world delivers roughly a third of the saturation its materials carry, so a
    palette authored to look right on paper renders washed. Clamped, so a
    colour cannot leave the gamut and come back as something else.
    """
    try:
        k = float(LOOK["paletteSaturation"])
    except (TypeError, ValueError, KeyError):
        return tuple(rgb[:3])
    if k == 1.0:
        return tuple(rgb[:3])
    lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
    return tuple(max(0.0, min(1.0, lum + (c - lum) * k)) for c in rgb[:3])


def wl_allow_instanced_use(mat, what):
    """Declare that a material may be drawn on INSTANCED static meshes.

    THE BUG THIS EXISTS FOR, and it was the whole grey.

    UE requires a material to declare every usage domain it will be drawn in.
    A material applied to an instanced-static-mesh component without
    bUsedWithInstancedStaticMeshes is not an error and does not fail to bind --
    the engine silently SUBSTITUTES THE DEFAULT MATERIAL at draw time and logs

        Material MI_gold missing usage flag InstancedStaticMeshes!
        Default Material will be used in game.

    Wonderland draws 137,816 of its pieces as instances, so 38 materials -- the
    entire visible world -- were being replaced by the engine's grey checker
    while every check this project had said the materials were perfect:
    SetMaterial/GetMaterial agreed on 150 of 150 batches, zero mismatches, zero
    NULL slots, and the bound objects reported vivid BaseColor. All of that was
    true. The engine simply refused to USE what was correctly bound.

    That is why nothing could move it: not fourteen material hypotheses, not
    re-authoring the palette (MI_stone raised 0.54 -> 0.71 at runtime moved the
    frame 1.4%), and not nine show-flag sweeps of bloom, fog, aerial
    perspective, AO, SSR, specular, indirect, the tonemapper or the grade.

    It hides in the editor, which adds missing usage flags on demand and saves
    them. A COOKED build cannot compile a new usage variant at runtime, so the
    fallback only ever appears in the packaged game -- the one place no offline
    validator was looking.

    Set on the MASTER: instances inherit usage from their parent.
    """
    for _prop in ("used_with_instanced_static_meshes",
                  "b_used_with_instanced_static_meshes"):
        try:
            mat.set_editor_property(_prop, True)
            unreal.log_warning("USAGE FLAG: %s may now draw on instanced static "
                               "meshes (%s)" % (what, _prop))
            return True
        except Exception:
            continue
    # Never silent. A material that cannot declare this renders the engine's
    # grey checker in the packaged build and nothing else in this file can tell.
    unreal.log_warning("USAGE FLAG FAILED on %s -- it will be replaced by the "
                       "DEFAULT MATERIAL wherever it is drawn on instances, and "
                       "that is exactly the grey this was written to end." % what)
    return False


def wl_lod_primitives():
    """Give the batched primitives real LODs, which is what this world needs.

    THE MEASUREMENT THAT LEADS HERE. Isolating each subsystem through the real
    stream showed the frame is GEOMETRY-bound and nothing else:

        baseline                 15, 16, 11 fps
        Lumen off                15, 13
        virtual shadow maps off  15, 14
        r.ScreenPercentage 70    13, 14      <- HALF the pixels, no change

    ~50,285 Sphere instances at roughly 1,900 triangles each is on the order of
    95 million triangles a frame. Every one of them is drawn at LOD0 because
    /Engine/BasicShapes ships a single LOD -- there is no cheaper version to
    pick, however far away the piece is.

    WHY NOT NANITE. It was tried and measured: 5/7/8 fps against 14/15/10, for
    a visually identical frame. Nanite is built for high-poly meshes and this
    world is 137,816 instances of 12-to-1,900-triangle primitives, where its
    per-cluster overhead costs more than the triangles it saves.

    REDUCTION LODs are the right tool at this size, and they are free at
    distance: a mushroom cap 200 m away does not need 1,900 triangles. The
    engine assets cannot be edited in place, so each primitive is duplicated
    into the project and LODs are built on the copy.

    LODs ALONE DO NOTHING HERE, and that is the part worth stating: a plain
    InstancedStaticMeshComponent selects ONE LOD for the whole component, so a
    batch that spans the entire world draws every instance at LOD0 no matter
    what LODs the mesh has. Per-instance LOD selection is what
    HierarchicalInstancedStaticMeshComponent's cluster tree is FOR, so this is
    only half the fix -- see bHierarchical on the batch actor.

    Returns {key: new path} for whatever converted. Anything that fails keeps
    its original mesh: a missing mesh deletes the piece from the world, and a
    slow Wonderland beats an empty one.
    """
    eal = unreal.EditorAssetLibrary
    out = {}
    pkg = "/Game/Wonderland/Meshes"
    # Screen sizes chosen so the cheap LODs do the work: by the time a piece is
    # a few percent of the screen it is a blob, and 1,900 triangles of blob is
    # the entire problem being solved here.
    screen_sizes = [1.0, 0.28, 0.09, 0.03]
    for key, src in sorted(set(PLACEHOLDER_MESH.items())):
        name = "SM_L_" + src.rsplit("/", 1)[-1]
        dst = pkg + "/" + name
        try:
            if not eal.does_asset_exist(dst):
                if not eal.duplicate_asset(src, dst):
                    continue
            mesh = eal.load_asset(dst)
            if mesh is None:
                continue
            built = False
            # The library moved between engine versions; try each spelling
            # rather than assuming one, because guessing wrong here silently
            # leaves the mesh at a single LOD and the world unchanged.
            for libname in ("EditorStaticMeshLibrary", "StaticMeshEditorSubsystem"):
                lib = getattr(unreal, libname, None)
                if lib is None:
                    continue
                try:
                    if libname == "StaticMeshEditorSubsystem":
                        lib = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
                    opts = unreal.EditorScriptingMeshReductionOptions()
                    settings = []
                    for lvl, ss in enumerate(screen_sizes):
                        r = unreal.EditorScriptingMeshReductionSettings()
                        r.set_editor_property("percent_triangles",
                                              [1.0, 0.45, 0.18, 0.06][lvl])
                        r.set_editor_property("screen_size", ss)
                        settings.append(r)
                    opts.set_editor_property("reduction_settings", settings)
                    opts.set_editor_property("auto_compute_lod_screen_size", False)
                    lib.set_lods(mesh, opts)
                    built = True
                    break
                except Exception:
                    continue
            if not built:
                unreal.log_warning("LOD: %s could not build LODs; it keeps a "
                                   "single LOD and stays expensive at distance" % name)
                continue
            eal.save_asset(dst, only_if_is_dirty=False)
            out[key] = dst
        except Exception as _le:
            unreal.log_warning("LOD: %s not converted (%s); it keeps %s"
                               % (key, _le, src))
    if out:
        unreal.log_warning("LOD: %d primitive mesh(es) given %d LODs -- this world "
                           "is geometry-bound, proven by r.ScreenPercentage 70 "
                           "changing nothing" % (len(set(out.values())), len(screen_sizes)))
    else:
        unreal.log_warning("LOD: nothing converted; every piece still draws at "
                           "LOD0 and the world stays geometry-bound")
    return out


def wl_naniteise_primitives():
    """Give the batched primitives Nanite, because this world is GEOMETRY-bound.

    MEASURED, not assumed. On the fixed build the stream delivers 13-16 fps with
    the GPU pinned at 99%, and an isolated sweep through the real stream showed
    the cost is NOT where anyone would look first:

        baseline                 15, 16, 11 / 16, 14, 12
        Lumen off                15, 13
        virtual shadow maps off  15, 14
        r.ScreenPercentage 70    13, 14      <-- HALF the pixels, no change

    Halving the pixel work changing nothing is decisive: the frame is not
    pixel-shading bound. Counting what is actually submitted says why --

        Sphere    50,285 instances
        Cube      65,833
        Cylinder  19,307
        Cone       2,374

    and /Engine/BasicShapes/Sphere is roughly 1,900 triangles. That is on the
    order of 100 MILLION triangles per frame, at LOD0, every frame. The engine
    primitives ship with a single LOD, so neither ISM culling nor HISM's cluster
    tree can reduce it -- there is no cheaper LOD to select.

    Nanite is exactly the tool for that: it is a different geometry pipeline,
    not an LOD setting, and it does its own cluster-level detail selection. The
    engine assets cannot be edited in place, so each primitive is duplicated
    into the project and Nanite enabled on the copy. Returns {key: new path}
    for whatever actually converted; anything that fails keeps its original mesh
    rather than vanishing from the world.
    """
    eal = unreal.EditorAssetLibrary
    out = {}
    pkg = "/Game/Wonderland/Meshes"
    for key, src in sorted(set(PLACEHOLDER_MESH.items())):
        name = "SM_N_" + src.rsplit("/", 1)[-1]
        dst = pkg + "/" + name
        try:
            if not eal.does_asset_exist(dst):
                if not eal.duplicate_asset(src, dst):
                    continue
            mesh = eal.load_asset(dst)
            if mesh is None:
                continue
            ns = mesh.get_editor_property("nanite_settings")
            ns.set_editor_property("enabled", True)
            mesh.set_editor_property("nanite_settings", ns)
            eal.save_asset(dst, only_if_is_dirty=False)
            out[key] = dst
        except Exception as _ne:
            unreal.log_warning("NANITE: %s not converted (%s); it keeps %s"
                               % (key, _ne, src))
    if out:
        unreal.log_warning("NANITE: %d primitive mesh(es) converted -- this world "
                           "submits ~100M triangles a frame and is geometry-bound, "
                           "proven by r.ScreenPercentage 70 changing nothing"
                           % len(set(out.values())))
    else:
        unreal.log_warning("NANITE: nothing converted; the world keeps the engine "
                           "primitives and stays geometry-bound")
    return out


def srgb_light_color(r, g, b):
    """An 0-255 colour pick as the LINEAR colour UE's light actually wants.

    FOUND BY RUNNING IT. Every practical in this world was created with
    `set_light_color(unreal.Color(...))`, and UE 5.8 answered, four times per
    build:

        TypeError: NativizeProperty: Cannot nativize 'Color' as 'NewLightColor'
          TypeError: NativizeStructInstance: Cannot nativize 'Color' as 'LinearColor'

    The property is an FLinearColor and an FColor does not convert. The call
    threw inside a try/except that logged and continued, so every lantern and
    every hero practical was built at its DEFAULT WHITE — including
    HeroLight_Arcane, the violet key on the hero Dog, which is the one light
    whose entire job is to put the reference's violet into the frame. Nothing
    downstream noticed because a light that exists and is the wrong colour looks
    exactly like a light that exists.

    The de-gamma is not decoration. A 0-255 triple is what a person picks in a
    colour picker, which is sRGB; FLinearColor is linear. Dividing by 255 alone
    would light the plaza with a noticeably different, flatter colour than the
    number names. This is the exact sRGB transfer, the one UE uses itself.
    """
    def _lin(c):
        c = max(0.0, min(1.0, c / 255.0))
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return unreal.LinearColor(_lin(r), _lin(g), _lin(b), 1.0)


def _wl_piece_hook(mesh_key, location, scale, label, rotation, mat):
    return None


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
#
# THE ARCHITECTURE PALETTE IS CREAM, NOT GREY, AND THAT WAS THE LAST CAUSE OF
# THE COLOURLESS WORLD.
#
# After the material pipeline was fixed the live L4 render was still a
# white-plastic model. Nothing was losing the colour: `stone` was (0.44,0.42,0.40)
# — a NEUTRAL GREY — and it is the single largest architecture material in the
# hero frame at 11.5% of owned pixels, with plaza and cobble brown-grey behind
# it. Under bright light a 0.44 neutral albedo correctly tonemaps to light grey.
# The world was authored grey and was rendering exactly as authored.
#
# The founder's reference is a PALE CREAM STONE city with pink and lilac roofs.
# stone, plaza and cobble are cream now — and CREAM MEANS LOW CHROMA, not just
# warm. The first attempt used (0.82,0.75,0.63), which is a warm TAN: the grey
# collapsed from 14.5% of the frame to 1.8% and went straight into the
# warm_timber bucket instead of cream, because chroma 0.19 is far above the 0.10
# that reads as an off-white.
#
# THE NEXT SENTENCE USED TO SAY "these values sit at chroma ~0.08", AND IT WAS
# NOT TRUE OF A SINGLE ONE OF THEM. Measured from the tuples immediately below,
# as shipped:
#
#     stone      0.398        plaza      0.250
#     cobble     0.275        cobble2    0.290
#     spire_far  0.474        porcelain  0.293
#
# Three to six times the figure the prose claimed, and every one of them past
# the 0.19 the same paragraph names as "far above" off-white. So the world was
# not built of cream stone. It was built of PINK stone under a LAVENDER
# skyline, which is why the founder's material note asks for "ivory/cream
# fantasy stone" and "no giant flat pink slabs" about a world that had just
# been declared cream. The prose was right and the numbers never followed it.
#
# They do now, and the colour does not leave with the cast: in the reference
# the masonry is the QUIET part and every saturated thing in the frame is a
# roof, a rose, a mushroom or the arcane circle. That is the correct place for
# chroma to live, and those materials are untouched. spire_far keeps a faint
# blue rather than a lilac, which is what distance actually does to a pale
# wall. cobble2 stays darker so the "pale and dark checkered flagstone" the
# reference names still reads as a checker.
#
# verify-masonry-chroma.py measures the tuples directly, so this paragraph
# cannot drift away from them again.
# WHY THE COLOURED MATERIALS ARE MATTE.
#
# The world rendered GREY once its false gold light was removed, and the
# measurement that explains it is this: of every material in the frame, the
# only ones still delivering real chroma were the METALS -- gold at
# (165,137,71), spire_far at (109,70,22) -- while mush_red, whose base colour
# is (188,40,66), came back at chroma 37 out of a possible 148, and arcane,
# an EMISSIVE violet at strength 11, came back at chroma 9.
#
# A metal tints its specular reflection. A dielectric's specular is white. So
# a glossy dielectric under a strong sky reflects white sky ON TOP of its own
# diffuse colour, and the colour is what loses. Every material carrying this
# world's pink and violet was between 0.28 and 0.46 roughness -- glossy enough
# to mirror the sky -- which is why adding more pink geometry moved rendered
# pink 4.5% -> 3.9%: the new blossom washed out exactly like the old.
#
# 22 of them are now floored at 0.62. The reference's surfaces are matte voxel
# toys, so this is also what they should have been. Gloss is kept where it
# means something: a pond, glass, a gem, the Dog's visor.
MATERIAL_SPEC = {
    # Pure metal mirrors its surroundings, and around here the surroundings
    # are grass and sky — so the most golden object in the world rendered
    # olive. Slightly less metallic, slightly rougher, with a warm emissive
    # floor so it reads gold in any environment.
    # WHY THE GOLD IS DARK, AND WHY IT IS NOT A LIGHTING PROBLEM.
    #
    # attribute-dark.py measured the gold family carrying 2.01% of the arrival
    # frame as pixels below the shadow threshold -- the most prominent
    # decorative material in Wonderland, rendering black. The cause is here,
    # not in the lights: gold was metallic 0.86 and gold_glow/float_glow were
    # metallic 1.00. A metal has NO diffuse response. It shows only what its
    # environment reflects, and this world has ZERO reflection captures; the
    # only indirect specular is a real-time-capture SkyLight, which captures
    # THIS scene. A dark scene reflects darkness into the metal, which makes
    # the scene darker. Adding reflection captures would capture the same dark
    # scene, so it does not break the loop either.
    #
    # The reference image's gold is bright, saturated and reads its FORM in
    # shadow -- gilding, not polished bullion. Gilding has a diffuse response.
    # Dropping metallic to ~0.4 gives these materials one, so the key light and
    # the sky reach them directly, while low roughness keeps the sheen that
    # makes them read as metal at all.
    #
    # HONEST LIMIT: the offline rasteriser shades from base colour and emissive
    # only -- it ignores metallic and roughness entirely -- so this change
    # cannot be measured without a GPU. It is argued from the capture above and
    # from how UE lights metal, and it is listed in GPU-READY-QUEUE.md as
    # unverified.
    # MEASURED 2026-08-24 from the first native render. metallic 0.40 is the
    # canonical PLASTIC value — neither a dielectric nor a metal — and on top of
    # it this carried an authored emissive at strength 0.60, so every gold
    # surface in Wonderland was partly self-lit and could not take a highlight.
    # The founder's note names the result exactly: "gold = metallic ornamental
    # gold, not yellow plastic/emissive", and "the gold should become luminous
    # mainly because of lighting + material response, not because everything
    # glows".
    #
    # 0.90 rather than a full 1.0: a pure metal has NO diffuse at all, so its
    # entire appearance comes from reflections, and this scene's only specular
    # environment is one real-time SkyLight whose intensity was just cut. 0.90
    # is metal enough to travel a highlight across a hammered face while keeping
    # a floor of albedo if the capture is thin. The emissive goes to zero.
    "gold":        ((1.00, 0.80, 0.38), 0.90, 0.28, (0.0, 0.0, 0.0), 0.0),
    "gold_glow":   ((1.00, 0.80, 0.38), 0.45, 0.24, (1.00, 0.70, 0.25), 1.7),
    # Aged brass for crevices, undersides and the deep parts of ornament.
    # Real gilding is dark where it is sheltered and bright where it is
    # rubbed; one flat tone across every face is the "toy" read.
    "brass_deep":  ((0.42, 0.30, 0.13), 0.55, 0.52, (0.05, 0.03, 0.00), 0.10),
    "float_glow":  ((1.00, 0.80, 0.40), 0.45, 0.24, (1.00, 0.72, 0.28), 1.9),
    # ALBEDO CUT 2026-08-24, MEASURED. Cream is a HUE, not a brightness, and
    # these were authored at the brightness of fresh snow. Real dressed
    # limestone reflects about 0.55-0.65; 0.87 is paper. Measured against the
    # founder reference the whole frame sits at mean luma 159 where the
    # reference is 83, and the sky band reads 24.7 DARKER than the ground band
    # — which cannot happen outdoors and does not need more sky, it needs a
    # ground that stops reflecting more than the sky emits.
    #
    # The hue is untouched; only the level moves. Dropping the NEUTRALS and
    # leaving every chromatic material alone should also close the saturation
    # gap (0.31 against the reference's 0.43) rather than widen it, because a
    # near-white surface has no chroma to contribute in the first place.
    "cobble":      ((0.62, 0.59, 0.55), 0.0, 0.80, (0, 0, 0), 0.0),
    "cobble2":     ((0.44, 0.42, 0.40), 0.0, 0.82, (0, 0, 0), 0.0),
    "plaza":       ((0.68, 0.65, 0.61), 0.0, 0.76, (0, 0, 0), 0.0),
    "moss":        ((0.20, 0.40, 0.16), 0.0, 0.72, (0, 0, 0), 0.0),
    "ground":      ((0.17, 0.30, 0.14), 0.0, 0.86, (0, 0, 0), 0.0),
    # A MEADOW IS NOT ONE GREEN. Real turf is patchy: sun-bleached where it is
    # exposed and thin, deeper and bluer where it lies in shade or holds water.
    # Two extra tones either side of `ground` are what let large open areas read
    # as grass rather than as a coloured plane, and they cost two materials.
    "ground_sun":  ((0.29, 0.40, 0.17), 0.0, 0.88, (0, 0, 0), 0.0),
    "ground_shade":((0.11, 0.23, 0.15), 0.0, 0.84, (0, 0, 0), 0.0),
    "trunk":       ((0.38, 0.28, 0.22), 0.0, 0.78, (0, 0, 0), 0.0),
    "foliage":     ((0.23, 0.46, 0.22), 0.0, 0.72, (0, 0, 0), 0.0),
    "foliage_hi":  ((0.38, 0.57, 0.38), 0.0, 0.66, (0, 0, 0), 0.0),
    # THE RANGE THE ADDENDUM ASKS FOR: deep forest for the shadowed core of
    # a canopy, spring for the sunlit outside. A cluster built from one green
    # is a blob however many spheres it has; built from three it has an
    # inside and an outside, which is what makes it read as leaves.
    "foliage_deep":((0.09, 0.21, 0.11), 0.0, 0.80, (0, 0, 0), 0.0),
    "foliage_spr": ((0.50, 0.72, 0.34), 0.0, 0.62, (0, 0, 0), 0.0),
    "rose":        ((0.72, 0.13, 0.28), 0.0, 0.62, (0.20, 0, 0.03), 0.45),
    "rose_pink":   ((0.96, 0.42, 0.62), 0.0, 0.62, (0.10, 0.0, 0.04), 0.3),
    "petal_pink":  ((0.94, 0.40, 0.66), 0.0, 0.62, (0, 0, 0), 0.0),
    "petal_violet":((0.52, 0.28, 0.86), 0.0, 0.62, (0.09, 0.02, 0.20), 0.35),
    "petal_air":   ((0.98, 0.62, 0.82), 0.0, 0.62, (0.10, 0.02, 0.06), 0.2),
    "mush_red":    ((0.74, 0.16, 0.26), 0.0, 0.62, (0.14, 0, 0), 0.3),
    "mush_white":  ((0.98, 0.90, 0.80), 0.0, 0.42, (0, 0, 0), 0.0),
    "mush_purple": ((0.44, 0.20, 0.76), 0.0, 0.62, (0.13, 0.02, 0.22), 0.35),
    "spire":       ((0.86, 0.58, 0.90), 0.0, 0.40, (0, 0, 0), 0.0),
    "spire_pink":  ((0.98, 0.74, 0.82), 0.0, 0.62, (0, 0, 0), 0.0),
    "spire_blue":  ((0.76, 0.68, 0.98), 0.0, 0.62, (0, 0, 0), 0.0),
    "spire_teal":  ((0.66, 0.92, 0.88), 0.0, 0.62, (0, 0, 0), 0.0),
    # Roughness 0.10 is a mirror, and a mirror reflecting a dark scene is
    # dark: attribute-dark.py measured porcelain at 1.47% of the frame in
    # shadow. Real glaze has a broad highlight, not a point one.
    "porcelain":   ((0.88, 0.85, 0.80), 0.0, 0.26, (0, 0, 0), 0.0),
    "water":       ((0.16, 0.42, 0.56), 0.0, 0.05, (0.01, 0.04, 0.07), 0.15),
    # Spray and foam: near-white, barely self-lit so it stays bright against
    # the dark of a basin, and it BOBS — a jet of beads that does not move is
    # a string of pearls.
    "spray":       ((0.96, 0.98, 1.00), 0.0, 0.14, (0.30, 0.40, 0.48), 0.55),
    "magic_cyan":  ((0.20, 0.85, 1.00), 0.0, 0.62, (0.20, 0.85, 1.00), 2.2),
    # The Brain is now 72 folded lobes where it used to be 5 spheres. At the
    # bright value that is fourteen times the glowing area, and a structure
    # whose whole point is that you can read its folds becomes one cyan blob.
    # Most of it takes this; the crowns of the folds keep the bright one.
    "magic_cyan_d":((0.16, 0.62, 0.78), 0.0, 0.62, (0.14, 0.52, 0.68), 0.85),
    "magic_gold":  ((1.00, 0.84, 0.42), 0.0, 0.62, (1.00, 0.74, 0.30), 4.5),
    # Lamp glass, separately: magic_gold at 4.5 is right for a threshold disc
    # and far too hot for a lantern that also carries a real point light — at
    # eight of them down the boulevard that reads as flare, and the brief asks
    # for restrained bloom.
    "lamp_glass":  ((1.00, 0.88, 0.58), 0.0, 0.22, (1.00, 0.80, 0.42), 2.0),
    # EMISSIVE STRENGTH 11 IS WHY THE CIRCLE IS WHITE.
    #
    # The founder reference's arcane circle is unmistakably VIOLET, and it is
    # the most striking thing in its foreground. Ours renders as a pale ring.
    # The colour is right — (0.62, 0.28, 1.00) — and the strength destroys it:
    # 11 x that is 6.8, 3.1, 11.0 in linear light, and everything past about
    # 1.0 climbs the ACES shoulder, where the three channels converge. A hue
    # pushed hard enough stops being a hue and becomes white.
    #
    # This is the same class as the masonry authored at the brightness of paper:
    # a value set when the scene around it was twice as bright, never revisited
    # when the scene came down. At 2.6 the ring is still clearly the brightest
    # thing on the plaza and it is still violet.
    "arcane":      ((0.66, 0.36, 1.00), 0.0, 0.62, (0.62, 0.28, 1.00), 2.6),   # overridden by LOOK["arcaneGlow"]
    # The SPILL, not the source. Light leaking out of the arcane circle into
    # the paving has to fall off; at the ring's own radiance it stops reading
    # as a spill and becomes 78 more light sources in the near foreground.
    "arcane_dim":  ((0.60, 0.34, 0.92), 0.0, 0.62, (0.52, 0.24, 0.90), 3.2),
    "arcane_faint":((0.44, 0.30, 0.62), 0.0, 0.62, (0.20, 0.09, 0.34), 1.1),
    "crystal":     ((0.65, 0.40, 0.95), 0.1, 0.20, (0.40, 0.20, 0.80), 1.5),
    # 0.985 IS BRIGHTER THAN ANY WHITE THAT EXISTS. Titanium-white paint sits
    # near 0.85 and fresh snow at 0.90; this was authored above both, with an
    # emissive on top. The canonical Relay Dog is white and stays white — but at
    # 0.985 every one of its cubes clipped to the same 255 and the silhouette
    # went featureless, which is exactly how it came back in the first native
    # render: a white blob with the black visor barely readable. 0.88 keeps it
    # the brightest thing in the frame and leaves the facets somewhere to go.
    "dog_body":    ((0.88, 0.88, 0.89), 0.0, 0.34, (0.0, 0.0, 0.0), 0.0),
    "dog_visor":   ((0.02, 0.02, 0.03), 0.1, 0.12, (0, 0, 0), 0.0),
    # Same shoulder, and this one is IDENTITY. The canonical Relay Dog has GOLD
    # eyes; at strength 5 they clip to white and the Dog looks like it has two
    # blank lamps in its visor. 2.2 keeps them lit and keeps them gold.
    "dog_eye":     ((1.00, 0.80, 0.22), 0.0, 0.62, (1.00, 0.74, 0.18), 2.2),
    # THE CITY IS PASTEL, NOT GREY -- and a third of this frame was specified
    # neutral. Measured by area over what the arrival camera can see, 31.9% of
    # Wonderland is owned by materials whose own albedo has saturation under
    # 0.15: stone 6.0%, porcelain 5.8%, spire 2.5%, plaza, cobble, mush_white.
    # The reference has no grey stone anywhere in it -- the castle city is
    # PINK, CREAM and LILAC, which is exactly the "pastel stone city seen
    # THROUGH planting" the visual-target file already describes.
    #
    # So this is not a lighting fix and it is not chasing the rendering defect
    # that remains open. It is the part of the greyness that was simply
    # AUTHORED, and it is the one part that can be fixed with certainty.
    # (cloud and dog_body stay white on purpose: clouds are white and the
    # canonical Relay Dog's coat is its identity.)
    "stone":       ((0.74, 0.70, 0.65), 0.0, 0.90, (0, 0, 0), 0.0),
    "dog_pink":    ((0.95, 0.62, 0.78), 0.0, 0.62, (0, 0, 0), 0.0),
    # SKELETON FLAME, the founder's legendary variant. It is a SKIN: the same
    # canonical body, the same proportions, the same visor band. What changes is
    # the coat (bone rather than warm white), the eyes (blue ghostfire instead
    # of gold) and an ember accent. Nothing here can alter a silhouette.
    #
    # Authored from the founder's written description -- blue ghostfire,
    # skeletal ornament, glowing blue eyes -- because the second reference sheet
    # (Image B) did not arrive with the message. The PROPORTIONS are therefore
    # untouched by design: guessing at a colour is recoverable, guessing at a
    # silhouette is how a skin stops being the same Dog.
    "dog_bone":    ((0.90, 0.92, 0.96), 0.0, 0.44, (0.05, 0.09, 0.16), 0.35),
    "dog_eye_blue": ((0.38, 0.74, 1.00), 0.0, 0.62, (0.30, 0.72, 1.00), 2.4),
    "dog_ghostfire": ((0.30, 0.62, 0.98), 0.0, 0.70, (0.24, 0.66, 1.00), 7.5),
    "dog_gray":    ((0.56, 0.48, 0.74), 0.0, 0.40, (0, 0, 0), 0.0),
    "dog_tan":     ((0.82, 0.66, 0.42), 0.0, 0.62, (0, 0, 0), 0.0),
    "dog_brown":   ((0.50, 0.33, 0.21), 0.0, 0.62, (0, 0, 0), 0.0),
    # --- horizon + skyline (visual pass 1) -------------------------------
    # The far meadow that closes the horizon. Soft lilac-green rather than
    # grass-green: at this distance the height fog tints toward the sky, and a
    # saturated green read as a hard band instead of receding.
    "meadow_far":  ((0.46, 0.53, 0.45), 0.0, 0.94, (0, 0, 0), 0.0),
    # Distant towers, deliberately pale and low-contrast so the skyline recedes
    # behind the hero landmarks instead of competing with them.
    "spire_far":   ((0.70, 0.71, 0.78), 0.0, 0.62, (0, 0, 0), 0.0),
    # Rose and pink rooflines — the reference's skyline is warm, not gold.
    "roof_rose":   ((0.78, 0.38, 0.44), 0.0, 0.62, (0.04, 0.0, 0.01), 0.10),
    "roof_pink":   ((0.92, 0.46, 0.62), 0.0, 0.62, (0, 0, 0), 0.0),
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
    # 2.6 WAS PROVEN — on a frame whose ground was mean luma 193. The scene is
    # 115 now and falling, and a self-lit cloud does not come down with it: in
    # the current render the cumulus is the brightest thing in the sky by a
    # wide margin, which is backwards for a cloud lit by a sun that is barely
    # lighting anything else. The provenance is kept because the number was
    # honestly measured; what changed is the world under it.
    "cloud":       ((1.00, 1.00, 1.00), 0.0, 1.00, (0.94, 0.96, 1.00), 1.30),
    "cloud_warm":  ((1.00, 0.99, 0.99), 0.0, 1.00, (1.00, 0.95, 0.96), 1.30),
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
    marked looping. WAVs are read from WONDERLAND_AUDIO_DIR. Provenance:
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
        # WHERE THE WAVS ACTUALLY ARE. This was hardcoded to the old build
        # host's /opt/wonderland/audio, which exists on exactly one machine
        # that no longer runs. The directory now comes from the environment;
        # the old location remains the fallback so an existing host still works.
        t.set_editor_property("filename", os.path.join(_AUDIO_DIR, "%s.wav" % nm))
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
    outdir = os.environ.get("WONDERLAND_TEXTURE_DIR", _DEFAULT_TEX_DIR)
    gen = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gen-textures.py")
    # LOADED UNCONDITIONALLY, because its FAMILIES tuple is needed whether or
    # not the PNGs have to be written. Executing it only defines functions and
    # constants; generate() is what costs anything, and that stays behind the
    # up-to-date check.
    ns = {"__name__": "wl_gen_textures", "__file__": gen}
    try:
        with io.open(gen, encoding="utf8") as fh:
            exec(compile(fh.read(), gen, "exec"), ns)
        if not os.path.isfile(os.path.join(outdir, "T_cobble_a.png")):
            ns["generate"](outdir)
    except Exception as e:
        unreal.log_warning("texture synthesis failed (%s); world keeps flat surfaces" % e)
        return {}

    tools = unreal.AssetToolsHelpers.get_asset_tools()
    eal = unreal.EditorAssetLibrary
    names = ["flat_white", "flat_normal", "flat_grey",
             "leafcard_a", "leafcard_n", "leafcard_m"]
    # "runes_a" is NOT listed here on purpose. The family loop below derives
    # every name from gen-textures.py's FAMILIES tuple precisely so a new family
    # cannot be forgotten, and the comment beside it records the five that WERE
    # forgotten when this list was maintained by hand. Adding runes here would
    # have re-created that habit on the same day the comment was read.
    # EVERY FAMILY gen-textures.py PRODUCES, not a list retyped beside it.
    #
    # This was six names — cobble, ashlar, sward, bark, plaster, roof — while
    # gen-textures.py has generated eleven for some time. metal, glaze, cap,
    # ripple and petal were synthesised to disk on every build and never
    # imported, so FOURTEEN materials silently rendered with no map at all:
    # gold, gold_glow, brass_deep, porcelain, dog_body (the Relay Dogs' own
    # coat), all three mushrooms, water, and every petal — the last of which
    # this file's own comment calls the carrier of "most of the world's pink
    # and violet".
    #
    # It cost nothing visible in a log: the failure prints as "TEXTURE MISSING
    # for <name> (family <fam>): keeping the palette base colour", which reads
    # like a deliberate fallback rather than five whole families going missing.
    # Three of those lines have been in every build log this session.
    _families = [f[0] for f in ns.get("FAMILIES", ())]
    if not _families:
        unreal.log_warning(
            "gen-textures.py exposed no FAMILIES tuple — falling back to the "
            "six families that were hardcoded here. If new families exist they "
            "will not be imported.")
        _families = ["cobble", "ashlar", "sward", "bark", "plaster", "roof"]
    for fam in _families:
        names += ["%s_a" % fam, "%s_n" % fam, "%s_r" % fam]
    unreal.log("TEXTURE FAMILIES to import: %s" % ",".join(_families))

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
    _want_sm = getattr(unreal.MaterialShadingModel, "MSM_TWO_SIDED_FOLIAGE", None)
    try:
        # A CACHED ASSET MUST NOT OUTLIVE ITS RECIPE. The build box keeps its
        # Content directory between runs, so does_asset_exist() is True on
        # every rebuild and an edit to the graph below would never reach the
        # world -- the change would look applied and measure as if it had not.
        # If the cached material predates the current shading model, drop it.
        if eal.does_asset_exist(path) and _want_sm is not None:
            try:
                if eal.load_asset(path).get_editor_property("shading_model") != _want_sm:
                    unreal.log_warning("LEAF MATERIAL: cached M_WLLeaf predates the "
                                       "two-sided-foliage recipe - rebuilding it")
                    eal.delete_asset(path)
            except Exception:
                pass
        if eal.does_asset_exist(path):
            master = eal.load_asset(path)
            wl_allow_instanced_use(master, "M_WLLeaf (cached)")
        else:
            master = tools.create_asset("M_WLLeaf", pkg, unreal.Material,
                                        unreal.MaterialFactoryNew())
            wl_allow_instanced_use(master, "M_WLLeaf")
            # MASKED + TWO SIDED is the entire reason this material exists
            master.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
            master.set_editor_property("two_sided", True)
            # WHY THE CANOPY IS BLACK. attribute-dark.py joined the delivered
            # frame to the offline owner buffer and named the cause: foliage
            # materials carry 12.8% of the whole frame as dark pixels, and
            # individual canopy blobs measure 83-100% dark. The leaves are
            # MASKED and two-sided but lit with the default model, so a leaf
            # between the sun and the camera -- which is every leaf in a
            # backlit canopy -- has no transmission and resolves to its own
            # shadow. Real foliage glows when you look through it.
            #
            # MSM_TWO_SIDED_FOLIAGE is the correct layer for that, and it is
            # the layer the founder asked for: not fog, not exposure, not
            # bloom, not saturation. The subsurface colour below is what the
            # light becomes on its way through the leaf.
            if _want_sm is not None:
                try:
                    master.set_editor_property("shading_model", _want_sm)
                except Exception:
                    unreal.log_warning("LEAF MATERIAL: engine refused "
                                       "MSM_TWO_SIDED_FOLIAGE; canopy stays opaque")
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

            # TRANSMITTED light, derived from the albedo so each leaf variant
            # keeps its own hue instead of every tree glowing the same green.
            # Scaled well below 1 because subsurface ADDS to the lit result:
            # at full strength a backlit canopy stops reading as leaves at all.
            try:
                sss = mel.create_material_expression(
                    master, unreal.MaterialExpressionVectorParameter, -700, 900)
                sss.set_editor_property("parameter_name", "SubsurfaceColor")
                sss.set_editor_property("default_value",
                                        unreal.LinearColor(0.42, 0.72, 0.26, 1.0))
                smul = mel.create_material_expression(
                    master, unreal.MaterialExpressionMultiply, -420, 900)
                mel.connect_material_expressions(sss, "", smul, "A")
                mel.connect_material_expressions(alb, "", smul, "B")
                mel.connect_material_property(
                    smul, "", unreal.MaterialProperty.MP_SUBSURFACE_COLOR)
            except Exception:
                unreal.log_warning("LEAF MATERIAL: no subsurface input; "
                                   "backlit canopy will stay dark")
            # sunlit edge, same instrument as the opaque palette
            try:
                fres = mel.create_material_expression(master, unreal.MaterialExpressionFresnel, -700, 540)
                ra = mel.create_material_expression(
                    master, unreal.MaterialExpressionScalarParameter, -700, 640)
                ra.set_editor_property("parameter_name", "RimAmp")
                # 0.55 BY DEFAULT, ON EVERY LEAF CARD IN THE WORLD, wired to
                # emissive in a chartreuse (0.72, 0.98, 0.44). Nothing had to
                # opt in and nothing could opt out, which is how a canopy
                # authored in three greens came back as one pale mint. Zero: a
                # leaf's translucent edge is what the subsurface term above is
                # for, and that one responds to the light behind it.
                ra.set_editor_property("default_value", 0.0)
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

            # SWAY -- OFF BY DEFAULT, AND PHASE-SPREAD WHEN ON.
            #
            # This used to be four nodes wired straight into WPO with a
            # BreatheAmp DEFAULT OF 4.5, which meant every leaf card in the
            # world swayed whether or not anything asked it to, all of them
            # reaching the top of the same sine on the same frame. The founder
            # saw the result and described it exactly: the world "pulses like a
            # heartbeat". Two separate defects produced that, and a zero
            # amplitude fixes NEITHER of them:
            #
            #   1. LOCKSTEP. One global sin(Time) with no per-instance term is
            #      a metronome. Thousands of pieces breathing together read as
            #      ONE organism; the same pieces with random phase read as a
            #      breeze. `PerInstanceRandom` is the fix and it is free -- the
            #      world is already 137k ISM instances, which is what that node
            #      needs. `PhaseSpread` scales it so a multi-part object whose
            #      parts must move as ONE body can set 0 and keep them locked.
            #
            #   2. COST. A material with a live WPO output is not merely doing
            #      a little vertex maths: the renderer must treat every
            #      primitive wearing it as moving, so its virtual-shadow-map
            #      pages cannot stay cached and are re-rasterised every frame,
            #      and Nanite must take the programmable-raster path. Setting
            #      BreatheAmp to 0 leaves the output CONNECTED, so the primitive
            #      keeps paying all of that to move by zero. Only a STATIC
            #      SWITCH removes it: with `Animated` false the branch folds to
            #      a constant at compile time, the permutation has no WPO at
            #      all, and the primitive is static again.
            #
            # So the switch is the load-bearing part and the amplitude is only
            # the look. Default false: a material moves when it is named in
            # ANIMATED_MATERIALS and never by inheriting a default.
            try:
                tn = mel.create_material_expression(master, unreal.MaterialExpressionTime, -900, 860)
                spd = mel.create_material_expression(
                    master, unreal.MaterialExpressionScalarParameter, -900, 780)
                spd.set_editor_property("parameter_name", "SwaySpeed")
                spd.set_editor_property("default_value", 0.9)
                tsp = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -760, 820)
                mel.connect_material_expressions(tn, "", tsp, "A")
                mel.connect_material_expressions(spd, "", tsp, "B")
                pir = mel.create_material_expression(
                    master, unreal.MaterialExpressionPerInstanceRandom, -900, 700)
                psp = mel.create_material_expression(
                    master, unreal.MaterialExpressionScalarParameter, -900, 620)
                psp.set_editor_property("parameter_name", "PhaseSpread")
                psp.set_editor_property("default_value", 6.283185)
                pmul = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -760, 660)
                mel.connect_material_expressions(pir, "", pmul, "A")
                mel.connect_material_expressions(psp, "", pmul, "B")
                tph = mel.create_material_expression(master, unreal.MaterialExpressionAdd, -620, 780)
                mel.connect_material_expressions(tsp, "", tph, "A")
                mel.connect_material_expressions(pmul, "", tph, "B")
                sn = mel.create_material_expression(master, unreal.MaterialExpressionSine, -500, 860)
                mel.connect_material_expressions(tph, "", sn, "")
                vn = mel.create_material_expression(
                    master, unreal.MaterialExpressionVertexNormalWS, -900, 960)
                amp = mel.create_material_expression(
                    master, unreal.MaterialExpressionScalarParameter, -900, 1040)
                amp.set_editor_property("parameter_name", "BreatheAmp")
                amp.set_editor_property("default_value", 0.0)
                w1 = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -460, 900)
                mel.connect_material_expressions(vn, "", w1, "A")
                mel.connect_material_expressions(sn, "", w1, "B")
                w2 = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -300, 920)
                mel.connect_material_expressions(w1, "", w2, "A")
                mel.connect_material_expressions(amp, "", w2, "B")
                still = mel.create_material_expression(
                    master, unreal.MaterialExpressionConstant3Vector, -300, 1100)
                still.set_editor_property("constant", unreal.LinearColor(0.0, 0.0, 0.0, 1.0))
                sw = mel.create_material_expression(
                    master, unreal.MaterialExpressionStaticSwitchParameter, -150, 960)
                sw.set_editor_property("parameter_name", "Animated")
                sw.set_editor_property("default_value", False)
                mel.connect_material_expressions(w2, "", sw, "True")
                mel.connect_material_expressions(still, "", sw, "False")
                mel.connect_material_property(sw, "", unreal.MaterialProperty.MP_WORLD_POSITION_OFFSET)
            except Exception as _e:
                # NAME THE CONSEQUENCE. Without the switch the leaf master keeps
                # a live WPO output, so every leaf card stays a moving primitive
                # even at zero amplitude -- silent, and the exact regression
                # this block exists to prevent.
                unreal.log_error("LEAF SWAY GATE FAILED (%s): the leaf master has "
                                 "no Animated switch, so leaf cards remain "
                                 "WPO-animated primitives and keep their shadow "
                                 "and raster cost" % _e)

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
    _BASE_OUT = [None]
    master_path = pkg + "/M_WLMaster"
    if eal.does_asset_exist(master_path):
        master = eal.load_asset(master_path)
        # ON THE CACHED PATH TOO. A master rebuilt with the flag and a master
        # loaded without it render differently and look identical in the source.
        wl_allow_instanced_use(master, "M_WLMaster (cached)")
    else:
        master = tools.create_asset("M_WLMaster", pkg, unreal.Material, unreal.MaterialFactoryNew())
        wl_allow_instanced_use(master, "M_WLMaster")

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
            if float(LOOK["baseNoise"]) <= 0.0:
                raise RuntimeError("baseNoise=0: the albedo map carries the detail")
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
        # SPECULAR, WIRED AT LAST. This graph never touched MP_SPECULAR, so every
        # dielectric in Wonderland sat at UE's default 0.5 -- a white sheen laid
        # over its own colour from every direction the sky reaches.
        #
        # It matters here more than it would in most worlds, because the frame is
        # almost entirely SPHERES: on a sphere a large share of the visible
        # surface is at a grazing angle, where that white specular is strongest.
        # The measurement that points at it is a like-for-like one -- in a single
        # frame, at matched luma, the LIT authored geometry carries 2.4-2.7x less
        # chroma than the UNLIT Marble backdrop beside it:
        #
        #     luma 0.15-0.30   lit 0.066   unlit 0.178
        #     luma 0.30-0.45   lit 0.074   unlit 0.180
        #
        # Same tonemapper, same grade, same exposure, same frame. Whatever is
        # eating the colour is in the LIT path, and specular is the one term in
        # it that is white by definition.
        #
        # REFUTED, by the frame this change produced. At 0.12 on 33 dielectrics
        # the gap did not close -- it measured 3.99x / 1.94x / 1.53x / 1.41x
        # across four luma bands, no better than before. Specular is wired
        # because it SHOULD be (UE's silent 0.5 default is not a decision
        # anybody made here), but it was not the cause. The cause was the
        # shadow fill: see LOOK["skyIntensity"].
        sp = param(unreal.MaterialExpressionScalarParameter, "Specular", 75, 0.5)
        mel.connect_material_property(sp, "", unreal.MaterialProperty.MP_SPECULAR)
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
            # 0.30 -> 0.05. This is the DEFAULT, so it governs every material
            # the relief table does not name -- which is most of them. See the
            # relief table for why: this noise is added to the shading NORMAL,
            # and a randomised normal scatters light everywhere and averages to
            # the ambient, which is how a correct albedo renders grey.
            damp = param(unreal.MaterialExpressionScalarParameter, "DetailAmp", 560, 0.05)
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
                # Keep the FINAL base-colour node so emissive can be driven from
                # the one chain in this graph that is PROVEN to reach the pixel.
                _BASE_OUT[0] = _bt
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

            # ---- NO MORE GREY -------------------------------------------
            #
            # PROVEN, from the packaged build's own runtime log: the material
            # instances carry the right emissive and it does not reach the
            # screen.
            #
            #   MI_foliage  Emissive=set(0.116,0.542,0.098) EmisStr=0.220
            #
            # Correct values, at runtime, on the component that renders -- and
            # the frame is still grey. So the parameters are fine and this
            # graph's EMISSIVE ROUTING is not. Meanwhile MP_BASE_COLOR is
            # proven to route: verify-base-colour-wired.py walks the graph and
            # finds the BaseColor parameter 21 nodes upstream of it.
            #
            # So emissive stops being driven by a chain that does not work and
            # is driven by the chain that does. _BASE_OUT is the exact node
            # feeding MP_BASE_COLOR -- palette x noise x albedo map, everything
            # a surface's colour already is -- scaled and added on top of the
            # rim/emissive sum. A surface can now be no darker than a share of
            # its own colour, whatever the lit path does or fails to do.
            if _BASE_OUT[0] is not None:
                _sc = mel.create_material_expression(
                    master, unreal.MaterialExpressionScalarParameter, -600, 700)
                _sc.set_editor_property("parameter_name", "SelfColour")
                # 1.0 because the master is UNLIT: in unlit shading the output
                # IS the emissive, so this is the surface's whole colour.
                _sc.set_editor_property("default_value", 1.0)
                _scm = mel.create_material_expression(
                    master, unreal.MaterialExpressionMultiply, -400, 700)
                mel.connect_material_expressions(_BASE_OUT[0], "", _scm, "A")
                mel.connect_material_expressions(_sc, "", _scm, "B")
                _esum = mel.create_material_expression(
                    master, unreal.MaterialExpressionAdd, -140, 560)
                mel.connect_material_expressions(rsum, "", _esum, "A")
                mel.connect_material_expressions(_scm, "", _esum, "B")
                mel.connect_material_property(
                    _esum, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
                # ---- UNLIT, AND WHY IT IS THE RIGHT ANSWER HERE ----------
                #
                # spire_far is authored (0.82, 0.70, 0.96) -- LAVENDER -- and
                # the skyline towers made of it render GREY. Fourteen mechanisms
                # have been tested against that and the runtime log has proved,
                # on the component that renders, that the material carries the
                # right colour and the right emissive and neither reaches the
                # pixel. The lit path in this graph does not deliver colour and
                # no further theory about it is worth the founder's time.
                #
                # In UNLIT shading the output IS the emissive. Not modulated by
                # a light, not scattered by a normal, not filled by an ambient,
                # not compressed toward the ambient's hue. Emissive is now the
                # proven base-colour chain -- palette x noise x albedo map -- so
                # every surface renders exactly the colour it was authored.
                # There is no path left by which a lavender tower can be grey.
                #
                # It is also what the reference IS: a flat, vivid illustration,
                # not a photograph of a garden. Shadow and form come back from
                # the world's own tonal range -- the palette carries light and
                # dark values -- and from ambient occlusion baked into the
                # authored colours, rather than from a lighting path that has
                # been proven not to work.
                #
                # WONDERLAND_LOOK=unlit=0 restores DefaultLit in one cook if the
                # lit path is ever repaired.
                if str(LOOK["unlit"]) not in ("0", "false", "no"):
                    try:
                        master.set_editor_property(
                            "shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
                        unreal.log_warning(
                            "NO-GREY: master is UNLIT and emissive is the proven "
                            "base-colour chain at 1.0 - every surface now renders "
                            "exactly its authored palette, and no lighting path "
                            "can take it away")
                    except Exception as _ue:
                        unreal.log_error(
                            "NO-GREY: could not set MSM_UNLIT (%s) - the world "
                            "will render through the lit path that is known to "
                            "eat colour" % _ue)
                else:
                    unreal.log_warning(
                        "NO-GREY: emissive from the proven base-colour chain, "
                        "master left DefaultLit by WONDERLAND_LOOK=unlit=0")
            else:
                unreal.log_error(
                    "NO-GREY FAILED: the base-colour output was never captured, "
                    "so emissive still depends on the route that does not work "
                    "and the world will render grey again.")
        except Exception as _e:
            unreal.log_warning("rim light skipped (%s); no edge response" % _e)
        # BREATHING via World-Position-Offset, GATED BY A STATIC SWITCH.
        #
        # Vertices ride a Time->Sine along their own normal, scaled by
        # BreatheAmp. The Dogs get amp>0 so they are ALIVE with no skeletal rig
        # — "Dogs must BREATHE; breathing is ambient life."
        #
        # What changed, and why a zero amplitude was never the fix. The founder
        # reported the whole world "pulsing like a heartbeat". It was, and this
        # graph is where it came from: the breathe table named ten VEGETATION
        # materials, and 22,794 instances — 16.5% of the world, 15.2% of the
        # hero frame — inflated and deflated together on ONE global sine with no
        # per-instance phase. That is a metronome, not a garden.
        #
        # Two independent defects, and each needs its own repair:
        #
        #   LOCKSTEP -> `PerInstanceRandom * PhaseSpread` added to the sine's
        #   argument. The world is already instanced, so this costs nothing and
        #   turns one organism breathing into a breeze. PhaseSpread is a
        #   PARAMETER because a Dog is many instanced parts of ONE body: it sets
        #   0 and its parts stay locked to each other, while scattered props set
        #   the full turn and never agree.
        #
        #   COST -> `Animated`, a STATIC SWITCH, default FALSE. A live WPO
        #   output makes the renderer treat the primitive as moving: its
        #   virtual-shadow-map pages cannot stay cached and are re-rasterised
        #   every frame, and Nanite must take programmable raster. An amplitude
        #   of 0 leaves the output connected, so the primitive pays all of that
        #   to move by zero — which is why "set BreatheAmp = 0" would have
        #   removed the wobble and none of the cost. With the switch false the
        #   branch folds at compile time and the permutation has NO WPO at all.
        #
        # A material therefore moves only by being named in ANIMATED_MATERIALS.
        try:
            tnode = mel.create_material_expression(master, unreal.MaterialExpressionTime, -720, 720)
            spd = param(unreal.MaterialExpressionScalarParameter, "BreatheSpeed", 880, 1.6)
            tmul = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -540, 740)
            mel.connect_material_expressions(tnode, "", tmul, "A")
            mel.connect_material_expressions(spd, "", tmul, "B")
            pir = mel.create_material_expression(
                master, unreal.MaterialExpressionPerInstanceRandom, -720, 600)
            psp = param(unreal.MaterialExpressionScalarParameter, "PhaseSpread", 1370, 6.283185)
            pmul = mel.create_material_expression(master, unreal.MaterialExpressionMultiply, -540, 620)
            mel.connect_material_expressions(pir, "", pmul, "A")
            mel.connect_material_expressions(psp, "", pmul, "B")
            tph = mel.create_material_expression(master, unreal.MaterialExpressionAdd, -470, 700)
            mel.connect_material_expressions(tmul, "", tph, "A")
            mel.connect_material_expressions(pmul, "", tph, "B")
            sine = mel.create_material_expression(master, unreal.MaterialExpressionSine, -400, 740)
            mel.connect_material_expressions(tph, "", sine, "")
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
            # The bob rides the SAME per-instance phase. It has its own speed,
            # so sharing the offset does not correlate the two terms — and a
            # second random would make one prop's own bob and breathe disagree,
            # which reads as a broken object rather than as life.
            btph = mel.create_material_expression(master, unreal.MaterialExpressionAdd, -470, 960)
            mel.connect_material_expressions(bmul, "", btph, "A")
            mel.connect_material_expressions(pmul, "", btph, "B")
            bsine = mel.create_material_expression(master, unreal.MaterialExpressionSine, -400, 1000)
            mel.connect_material_expressions(btph, "", bsine, "")
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
            still = mel.create_material_expression(
                master, unreal.MaterialExpressionConstant3Vector, 40, 1120)
            still.set_editor_property("constant", unreal.LinearColor(0.0, 0.0, 0.0, 1.0))
            gate = mel.create_material_expression(
                master, unreal.MaterialExpressionStaticSwitchParameter, 190, 960)
            gate.set_editor_property("parameter_name", "Animated")
            gate.set_editor_property("default_value", False)
            mel.connect_material_expressions(wsum, "", gate, "True")
            mel.connect_material_expressions(still, "", gate, "False")
            mel.connect_material_property(gate, "", unreal.MaterialProperty.MP_WORLD_POSITION_OFFSET)
        except Exception as _e:
            # An ERROR, not a warning. If the switch is missing the master keeps
            # a live WPO output on EVERY material in the world and the whole
            # world is a moving primitive again — the exact condition this
            # block was written to end, and one nothing downstream can see.
            unreal.log_error("BREATHE WPO GATE FAILED (%s): the master has no "
                             "Animated switch, so every material in the world "
                             "keeps a live WPO output and stays a moving "
                             "primitive for shadows and raster" % _e)
        mel.recompile_material(master)
        eal.save_asset(master.get_path_name())
    # THE CIRCLE'S GLOW COMES FROM THE LOOK TABLE, NOT THE SPEC LITERAL, so it
    # can be swept with WONDERLAND_LOOK instead of edited and re-cooked.
    try:
        _ag = float(LOOK["arcaneGlow"])
        if "arcane" in MATERIAL_SPEC and _ag > 0.0:
            _a = MATERIAL_SPEC["arcane"]
            MATERIAL_SPEC["arcane"] = (_a[0], _a[1], _a[2], _a[3], _ag)
            unreal.log_warning("ARCANE GLOW %.2f (spec literal was %.2f)" % (_ag, _a[4]))
    except (KeyError, TypeError, ValueError) as _e:
        unreal.log_warning("arcaneGlow not applied (%s); the circle keeps the spec literal" % _e)
    mats = {}
    _SELFCOLOUR = [0]
    for name, (rgb, met, rough, emi, es) in MATERIAL_SPEC.items():
        ipath = pkg + "/MI_" + name
        # RE-APPLY THE PALETTE EVERY RUN, whether the asset is new or not.
        #
        # This used to `continue` on an existing asset, and the content
        # directory lives on persistent storage — so the FIRST run's values were
        # frozen forever and no later edit to MATERIAL_SPEC could ever reach the
        # world. It is the same trap this project hit with new_level refusing to
        # overwrite an existing .umap: a generator that silently declines to
        # regenerate looks like a generator that ran.
        #
        # Measured consequence: MI_stone, MI_rose, MI_gold and MI_spire all sat
        # at BaseColor (1,1,1) on the live L4 while the palette said otherwise,
        # and Wonderland streamed white.
        if eal.does_asset_exist(ipath):
            mi = eal.load_asset(ipath)
        else:
            mi = tools.create_asset("MI_" + name, pkg, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        mel.set_material_instance_parent(mi, master)
        _sr = palette_saturate(rgb)
        mel.set_material_instance_vector_parameter_value(mi, "BaseColor", unreal.LinearColor(_sr[0], _sr[1], _sr[2], 1))
        # ---- SELF-COLOUR, BECAUSE THE LIT PATH KEEPS EATING THE PALETTE ----
        #
        # Thirteen mechanisms have now been proposed for why a correct albedo
        # renders grey, and every one of them has been refuted by the frame that
        # tested it: specular, fog, the sky's hue, bloom, the ACES shoulder,
        # ambient wash, the batch binding, metal-vs-dielectric, the BaseColor
        # wiring, emissive defaults, the cook (a runtime probe proved the pak
        # holds MI_mush_red at (1.000, 0.003, 0.188)), warm practicals, and
        # randomised shading normals.
        #
        # So this stops asking the lit path to carry the palette and gives every
        # surface a share of its OWN colour as emission. Emissive is added after
        # shading: no light, no normal, no ambient and no tonemap decision
        # upstream of it can take it away.
        #
        # It is also correct for what this world IS. The founder's reference is
        # an ILLUSTRATION -- flat, vivid, self-coloured -- not a photograph of a
        # garden, and stylised voxel worlds routinely light themselves this way.
        # 0.30 is deliberately a SHARE, not a replacement: the surface still
        # takes light and shadow from the scene, and keeps a floor of its own
        # hue when the lit path gives it nothing.
        #
        # If the lit path is ever fixed, this is one number to turn down.
        mel.set_material_instance_scalar_parameter_value(mi, "Metallic", met)
        mel.set_material_instance_scalar_parameter_value(mi, "Roughness", rough)
        mel.set_material_instance_vector_parameter_value(mi, "Emissive", unreal.LinearColor(emi[0], emi[1], emi[2], 1))
        mel.set_material_instance_scalar_parameter_value(mi, "EmissiveStrength", es)

        # SELF-COLOUR GOES ON LAST, AND THAT IS THE WHOLE FIX.
        #
        # It was written four lines EARLIER than the generic Emissive write
        # above, which then overwrote it with the material's authored emissive
        # -- (0,0,0) for almost everything. So the only materials that kept any
        # emission were the ones that already had some authored: gold,
        # gold_glow, magic_gold. The runtime forensic log showed it exactly:
        #
        #   MI_gold       Emissive=set(0.300,0.210,0.060) EmisStr=0.600   COLOURED
        #   MI_stone      Emissive=set(0.000,0.000,0.000) EmisStr=0.000   GREY
        #   MI_foliage    Emissive=set(0.000,0.000,0.000) EmisStr=0.000   GREY
        #   MI_petal_pink Emissive=set(0.000,0.000,0.000) EmisStr=0.000   GREY
        #
        # Every coloured thing in the delivered frame was a material with
        # authored emissive, and every grey thing was one without. The counter
        # said "31 materials" and was telling the truth about a write that was
        # immediately undone.
        #
        # An ACCENT, not a flood. The founder's rule: emissive may accent magic
        # and gold, it may not flatten the world. Materials that author their
        # own emission keep it untouched; everything else gets a modest share of
        # its own palette so a surface has a colour floor, and the lit response
        # still sits on top.
        # METALS ARE EXCLUDED, and they were only excluded by accident before.
        #
        # The test is `es <= 0.0`, so a material was spared self-colour by
        # HAVING authored emissive. gold qualified because it carried 0.60 —
        # and the moment that emissive was removed for being wrong, gold would
        # have fallen straight into this branch and started emitting 0.06 of its
        # own palette instead. A metal has no diffuse term at all, so emissive
        # on one is not a colour floor, it is a glow; the founder's rule is that
        # gold reads as gold through lighting and material response.
        #
        # `met < 0.5` states the exclusion the old condition was accidentally
        # achieving, so removing an authored emissive cannot silently install a
        # replacement.
        if es <= 0.0 and met < 0.5 and name not in ("cloud", "cloud_warm", "water", "lamp_glass"):
            mel.set_material_instance_vector_parameter_value(
                mi, "Emissive", unreal.LinearColor(_sr[0], _sr[1], _sr[2], 1))
            mel.set_material_instance_scalar_parameter_value(
                mi, "EmissiveStrength", float(LOOK["selfColour"]))
            _SELFCOLOUR[0] += 1
        eal.save_asset(mi.get_path_name())
        if name in ("stone", "spire", "rose", "gold", "roof_pink"):
            unreal.log_warning("MATSET palette %s -> (%.2f,%.2f,%.2f)"
                               % (name, rgb[0], rgb[1], rgb[2]))
        mats[name] = mi
    unreal.log_warning("SELF-COLOUR: %d materials emit a %.2f share of their own "
                       "palette - the lit path kept eating it and thirteen "
                       "explanations were refuted" % (_SELFCOLOUR[0], LOOK["selfColour"]))

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
        # GOLD MUST NOT READ AS FLAT YELLOW — the art direction says so, and a
        # bare base colour gives exactly that however well it is lit. The metal
        # map carries hammer facets, a drawn grain and tarnish in the creases,
        # and its roughness variation is what makes the highlight TRAVEL across
        # a surface instead of sitting on it.
        "gold":       ("metal",   0.0090, (1.00, 1.00, 1.00)),
        "gold_glow":  ("metal",   0.0090, (1.06, 1.02, 0.94)),
        "brass_deep": ("metal",   0.0075, (0.82, 0.74, 0.62)),
        # Fine china is not white plastic and the difference is crazing: a
        # hairline network in the glaze, too fine to see as lines but enough to
        # break the highlight into something fired rather than moulded.
        "porcelain":  ("glaze",   0.0130, (1.00, 1.00, 1.00)),
        "dog_body":   ("glaze",   0.0150, (1.00, 1.00, 1.00)),
        # The mushroom cap is the LARGEST single visible object in the hero
        # frame by pixels actually owned, and it was a smooth dome of flat red —
        # the reddest possible way to look like plastic.
        "mush_red":    ("cap",    0.0170, (1.00, 1.00, 1.00)),
        "mush_purple": ("cap",    0.0170, (0.86, 0.74, 1.06)),
        "mush_white":  ("cap",    0.0190, (1.06, 1.04, 1.00)),
        # Water with a flat normal is glass, and glass in a garden reads as a
        # hole in the ground.
        "water":       ("ripple", 0.0060, (1.00, 1.00, 1.00)),
        # Petals carry most of the world's pink and violet, and flat colour on
        # one is the "candy" read the direction names: a saturated hue with no
        # surface under it is moulded plastic whatever the shape.
        "rose":        ("petal",  0.0210, (1.00, 1.00, 1.00)),
        "rose_pink":   ("petal",  0.0210, (1.00, 1.00, 1.00)),
        "petal_pink":  ("petal",  0.0240, (1.00, 1.00, 1.00)),
        "petal_violet":("petal",  0.0240, (1.00, 1.00, 1.00)),
        "petal_air":   ("petal",  0.0260, (1.00, 1.00, 1.00)),
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
                # THE TINT IS ONLY CORRECT IF A MAP ACTUALLY BOUND.
                #
                # "the map carries the colour now, so the instance tint goes to
                # roughly white" is true — and it turns a coloured material into
                # a WHITE one when the albedo texture is missing, because the
                # tint is applied unconditionally and there is then nothing for
                # it to multiply. That is what rendered the live L4 world white:
                # the palette colour was replaced by a near-white tint over no
                # texture at all.
                if texs.get("%s_a" % fam) is not None:
                    # THE TINT MULTIPLIES THE PALETTE, IT DOES NOT REPLACE IT.
                    #
                    # "the map carries the colour now" is only true of a COLOURED
                    # map. These are procedurally generated DETAIL maps — grain,
                    # crazing, ripple, petal veining — and they are essentially
                    # neutral. Setting BaseColor to a near-white tint over a
                    # neutral map therefore threw the palette away and rendered
                    # the surface grey.
                    #
                    # Measured on the live L4: MI_stone and MI_spire sat at
                    # (1.00,1.00,1.00) — the bulk of Wonderland's architecture —
                    # while MI_rose and MI_gold, whose maps happened to be
                    # MISSING, kept their palette and were the only coloured
                    # things in the frame. That is the whole grey world.
                    #
                    # So the map supplies detail and the palette supplies hue,
                    # which is what a tint is for.
                    _base = palette_saturate(
                        (MATERIAL_SPEC.get(nm) or ((1.0, 1.0, 1.0),))[0])
                    mel.set_material_instance_vector_parameter_value(
                        mi, "BaseColor",
                        unreal.LinearColor(_base[0] * tint[0],
                                           _base[1] * tint[1],
                                           _base[2] * tint[2], 1.0))
                    if nm in ("stone", "spire", "rose", "gold", "roof_pink"):
                        unreal.log_warning(
                            "MATSET textured %s base=(%.2f,%.2f,%.2f) tint=(%.2f,%.2f,%.2f)"
                            " -> (%.2f,%.2f,%.2f)"
                            % (nm, _base[0], _base[1], _base[2], tint[0], tint[1], tint[2],
                               _base[0]*tint[0], _base[1]*tint[1], _base[2]*tint[2]))
                else:
                    unreal.log_warning(
                        "TEXTURE MISSING for %s (family %s): keeping the palette "
                        "base colour instead of tinting to white over nothing."
                        % (nm, fam))
                # authored relief replaces the procedural stand-in on these
                mel.set_material_instance_scalar_parameter_value(mi, "DetailAmp", 0.06)
                eal.save_asset(mi.get_path_name())
            except Exception as _e:
                unreal.log_warning("texture binding on %s skipped: %s" % (nm, _e))
    # THE RIM IS EMISSIVE, AND TWENTY MATERIALS WERE WEARING IT.
    #
    # The comment this replaces says "that edge highlight is the difference
    # between metal and yellow paint", and it is right about metal. What it does
    # not say is that RimAmp feeds MP_EMISSIVE_COLOR — so a rim is not a
    # highlight the lighting produces, it is light the SURFACE EMITS. Two things
    # follow, and both are visible in the native render:
    #
    #   A Fresnel term is largest at GLANCING angles, and on the rounded
    #   geometry this world is built from — spheres, cylinders, foliage clusters
    #   — most of the visible surface IS glancing. So the "edge" covered the
    #   object. foliage is authored at (0.23, 0.46, 0.22), a deep green, and
    #   renders as PALE MINT. That is the rim, not the albedo.
    #
    #   Emission does not respond to light, so a surface carrying it cannot
    #   shade, cannot take a contact shadow, and cannot be exposed down. It is
    #   why cutting 4,392 lux of shadowless fill moved the frame 33 luma and
    #   every cut after it moved single digits: a large part of the frame's
    #   brightness was never coming from the lights at all.
    #
    # The founder's rule is one line: "Do not use emissive to fake material
    # quality." The rim now belongs to the things that genuinely emit — the
    # glows, the crystal, the Dog's gold eyes — and to METAL, where a travelling
    # edge highlight really is the read. Everything matte goes to zero and takes
    # its edges from the key light, which is what the new key ratio exists to
    # provide.
    rim = {"gold": (0.85, (1.00, 0.84, 0.50)), "gold_glow": (0.90, (1.00, 0.86, 0.54)),
           "float_glow": (0.85, (1.00, 0.86, 0.54)), "magic_gold": (0.70, (1.00, 0.88, 0.60)),
           "crystal": (0.80, (0.80, 0.60, 1.00)),
           "dog_eye": (0.90, (1.00, 0.90, 0.40))}
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
    # THIS IS THE GREY, AND IT IS THE NORMALS.
    #
    # DetailAmp drives a VECTOR NOISE added to the shading normal. At 0.80 the
    # normal is effectively randomised per pixel, so the surface scatters light
    # in every direction at once and averages to whatever the ambient happens
    # to be -- which is grey. The albedo is still correct underneath and never
    # gets to matter.
    #
    # The correlation is exact, and it was sitting in a table I had already
    # measured. Every material that RENDERS CORRECTLY has a near-zero DetailAmp;
    # every material that renders grey has a large one:
    #
    #     gold       0.06  ->  renders sat 0.22   CORRECT
    #     dog_body   0.05  ->  renders white      CORRECT
    #     porcelain  0.04  ->                     CORRECT
    #     foliage    0.50  ->  renders sat 0.04   GREY
    #     stone      0.80  ->  renders sat 0.02   GREY
    #     trunk      0.85  ->                     GREY
    #
    # Relief was added to stop surfaces looking like flat plastic. It does that
    # by destroying the one thing that carries colour. A stylised voxel world
    # does not need 0.8 of normal noise on its architecture -- it needs almost
    # none, and the little that is wanted is for silhouette breakup, not for
    # scattering.
    relief = {"porcelain": 0.02, "gold": 0.04, "gold_glow": 0.04, "dog_body": 0.03,
              "dog_visor": 0.02, "water": 0.02, "spire": 0.05, "spire_pink": 0.05,
              "spire_blue": 0.05, "spire_teal": 0.05, "spire_far": 0.04,
              "roof_rose": 0.05, "roof_pink": 0.05, "stone": 0.07, "meadow_far": 0.06,
              "trunk": 0.09, "foliage": 0.06, "foliage_hi": 0.06, "mush_red": 0.05,
              "mush_purple": 0.05, "mush_white": 0.05, "mush_gill": 0.05,
              "rose": 0.05, "rose_pink": 0.05, "petal_pink": 0.04, "petal_violet": 0.04}
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
    # Coloured dielectrics get a LOW specular so their own colour is what
    # reaches the camera. Left at the 0.5 default where a white sheen is the
    # point: water, glass, gems, the Dog's visor, and anything metallic (whose
    # specular is tinted by its own base colour and is supposed to dominate).
    _SPEC_KEEP = {"water", "crystal", "lamp_glass", "spray", "dog_visor",
                  "gold", "gold_glow", "brass_deep", "float_glow"}
    _spec_set = 0
    for _nm, _sp in MATERIAL_SPEC.items():
        if _nm in _SPEC_KEEP or _nm not in mats:
            continue
        try:
            _rgb = _sp[0]
            if max(_rgb) - min(_rgb) <= 0.15:      # near-neutral: leave alone
                continue
            mel.set_material_instance_scalar_parameter_value(mats[_nm], "Specular", 0.12)
            eal.save_asset(mats[_nm].get_path_name())
            _spec_set += 1
        except Exception as _e:
            unreal.log_warning("specular on %s skipped: %s" % (_nm, _e))
    unreal.log_warning("SPECULAR lowered to 0.12 on %d coloured dielectrics" % _spec_set)

    for _nm, _rv in rough_vary.items():
        if _nm in mats:
            try:
                mel.set_material_instance_scalar_parameter_value(mats[_nm], "RoughVary", _rv)
                eal.save_asset(mats[_nm].get_path_name())
            except Exception as _e:
                unreal.log_warning("rough vary on %s skipped: %s" % (_nm, _e))
    # ------------------------------------------------------------------ MOTION
    # THE COMPLETE LIST OF THINGS IN WONDERLAND THAT MOVE.
    #
    # Read this as an allow-list, not as a tuning table. `Animated` is a static
    # switch defaulting to FALSE on both masters, so a material that is not
    # named here compiles to a permutation with no world-position-offset output
    # at all: it is a static primitive, its shadow-map pages stay cached, and
    # Nanite keeps the fixed-function raster path. Adding a name here is a
    # decision to pay for motion, and it should be made object by object.
    #
    # WHY IT SHRANK. `breathe` used to name ten vegetation materials as well as
    # the Dogs. Measured: 22,794 instances -- 16.5% of the world and 15.2% of
    # the hero frame -- swelling and shrinking on ONE sine with no per-instance
    # phase. Every hedge, rose, petal and leaf in Wonderland reached its widest
    # on the same frame. The founder's words for it were that the world "pulses
    # like a heartbeat", and that is a fair description of what the code did.
    #
    # The rule now is the one the founder gave: STATIC ENVIRONMENT STAYS STATIC,
    # and motion is spent where motion means something.
    #
    #   * The Dogs breathe. They are the characters and the whole point.
    #   * Things that are AIRBORNE or LIQUID drift, because a petal hanging
    #     motionless in mid-air or a still fountain is the thing that looks
    #     broken. There are 717 of these in the world -- half a percent of it.
    #   * Nothing that is rooted in the ground moves. Not hedges, not roses,
    #     not flowerbeds, not topiary, not the tree canopies.
    #
    # PhaseSpread is the second half of the repair. Scattered props take the
    # full turn so no two agree; a Dog takes ZERO, because a Dog is many
    # instanced parts of one body and parts that disagree read as a broken
    # object rather than as a breath.
    breathe = {"dog_body": 6.5, "dog_pink": 6.0, "dog_gray": 6.0, "dog_tan": 6.0,
               "dog_brown": 6.0}
    # THE HEARTBEAT, PUT BACK ON PURPOSE, SO IT CAN BE MEASURED.
    #
    # The goal asks for the frame rate before and after removing the world-wide
    # pulse. "After" is easy — it is what builds by default. "Before" was not
    # measurable at all: the motion was removed in the first commit of the
    # session, before any render of this world existed, so there is no earlier
    # frame to compare against and no honest way to state a delta.
    #
    # WONDERLAND_LOOK=animateEnvironment=1 restores exactly the ten ROOTED
    # materials that used to carry it, at exactly their old amplitudes, so a
    # build with the knob on is the world as it was for this one property and
    # identical in every other. That is what an A/B needs and what a
    # recollection cannot give.
    #
    # Default 0. verify-static-environment reads the table below, not this
    # branch, and a knob nobody sets does not change what ships.
    # LOOK["..."], not LOOK.get(...): verify-look-table scans for the subscript
    # form and reported this key as "declared but never read - an override for
    # it would silently do nothing". It was right about the shape even though
    # the branch worked, and a knob the gate cannot see is a knob that can rot.
    if int(LOOK["animateEnvironment"]):
        breathe.update({"foliage": 3.0, "foliage_hi": 3.5, "foliage_deep": 2.4,
                        "foliage_spr": 4.0, "leaf": 3.6, "leaf_hi": 4.2,
                        "petal_pink": 2.5, "petal_violet": 2.5,
                        "rose_pink": 2.2, "rose": 2.0})
        unreal.log_warning(
            "ANIMATE ENVIRONMENT: the world-wide heartbeat is BACK ON for "
            "measurement — 22,794 rooted instances animated. This is not a "
            "shipping configuration.")
    bob = {"float_glow": 24.0, "petal_air": 22.0, "magic_cyan": 16.0,
           "water": 5.0, "spray": 19.0}
    phase_spread = {"dog_body": 0.0, "dog_pink": 0.0, "dog_gray": 0.0,
                    "dog_tan": 0.0, "dog_brown": 0.0}
    animated = set(breathe) | set(bob)
    for nm, ampv in breathe.items():
        if nm in mats:
            try:
                mel.set_material_instance_scalar_parameter_value(mats[nm], "BreatheAmp", ampv)
            except Exception as _e:
                unreal.log_warning("BreatheAmp on %s skipped: %s" % (nm, _e))
    for nm, amp in bob.items():
        if nm in mats:
            try:
                mel.set_material_instance_scalar_parameter_value(mats[nm], "BobAmp", float(amp))
            except Exception as _e:
                unreal.log_warning("BobAmp on %s skipped: %s" % (nm, _e))
    for nm, spread in phase_spread.items():
        if nm in mats:
            try:
                mel.set_material_instance_scalar_parameter_value(mats[nm], "PhaseSpread", float(spread))
            except Exception as _e:
                unreal.log_warning("PhaseSpread on %s skipped: %s" % (nm, _e))
    # The switch LAST, and only on the allow-list. Everything else keeps the
    # master's default of false and therefore has no WPO output to evaluate.
    _moved = 0
    for nm in sorted(animated):
        if nm in mats:
            try:
                mel.set_material_instance_static_switch_parameter_value(mats[nm], "Animated", True)
                _moved += 1
            except Exception as _e:
                # If this fails the material keeps the FALSE branch, so it goes
                # still rather than staying stuck in motion. Wrong, but wrong in
                # the safe direction, and said out loud.
                unreal.log_error("ANIMATED switch on %s failed (%s): it will be "
                                 "STATIC in this build" % (nm, _e))
    for nm in mats:
        try:
            eal.save_asset(mats[nm].get_path_name())
        except Exception:
            pass
    unreal.log_warning("MOTION: %d of %d materials animated; the rest compile "
                       "their WPO out and are static primitives"
                       % (_moved, len(mats)))
    return mats


def build_rune_material(texs):
    """TASK 2.2 — the magic circle as a rotating, pulsing additive plane.

    The founder's brief: "Build a Material Blueprint / Decal for the purple
    magic circle at the player's feet. Implement UV Panner nodes to slowly
    rotate outer rune rings in opposing directions. Add a Time-based Sine Wave
    to generate a soft pulsing glow effect."

    WHY THIS REPLACES GEOMETRY. The circle was built from concentric rings of
    tangent cubes, and five passes went into making that version bigger,
    thinner, brighter and dimmer without ever getting near the reference —
    because the reference's circle is engraved LINE WORK: tick marks, rune
    bars, dotted orbits, a central sigil, all at a fineness no mesh reaches at
    a sane instance count. That is a texture's job.

    ADDITIVE, not masked. The texture is drawn on black, so additive blending
    makes the black free — no opacity mask, no sorting, and the cobble
    underneath shows through untouched, which is what makes it read as light ON
    stone rather than as a decal stuck over it.

    Two samples with opposing Rotators and a radial mask between them, so the
    outer orbit turns one way and the inner sigil the other. That
    counter-rotation is most of what makes a magic circle read as ALIVE, and it
    costs one extra sample.
    """
    tex = texs.get("runes_a")
    if tex is None:
        unreal.log_warning("RUNE CIRCLE: no runes texture; the circle keeps its "
                           "geometry rings")
        return None
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    mel = unreal.MaterialEditingLibrary
    eal = unreal.EditorAssetLibrary
    pkg = "/Game/Wonderland/Materials"
    path = pkg + "/M_WLRunes"
    try:
        if eal.does_asset_exist(path):
            eal.delete_asset(path)
        mat = tools.create_asset("M_WLRunes", pkg, unreal.Material,
                                 unreal.MaterialFactoryNew())
        mat.set_editor_property("material_domain", unreal.MaterialDomain.MD_SURFACE)
        mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
        mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
        set_prop(mat, "TwoSided", False)
        set_prop(mat, "bUsedWithInstancedStaticMeshes", True)

        def node(cls, x, y):
            return mel.create_material_expression(mat, cls, x, y)

        # ---- the two counter-rotating samples --------------------------
        tc = node(unreal.MaterialExpressionTextureCoordinate, -1200, 0)
        tnode = node(unreal.MaterialExpressionTime, -1200, 200)
        samples = []
        for _i, _speed in ((0, 0.018), (1, -0.031)):
            rot = node(unreal.MaterialExpressionRotator, -1000, _i * 260)
            set_prop(rot, "CenterX", 0.5)
            set_prop(rot, "CenterY", 0.5)
            set_prop(rot, "Speed", _speed)
            mel.connect_material_expressions(tc, "", rot, "Coordinate")
            mel.connect_material_expressions(tnode, "", rot, "Time")
            smp = node(unreal.MaterialExpressionTextureSample, -800, _i * 260)
            smp.set_editor_property("texture", tex)
            mel.connect_material_expressions(rot, "", smp, "UVs")
            samples.append(smp)

        # ---- radial mask: outer sample outside, inner sample inside -----
        sub = node(unreal.MaterialExpressionSubtract, -1000, 560)
        mel.connect_material_expressions(tc, "", sub, "A")
        half = node(unreal.MaterialExpressionConstant2Vector, -1160, 620)
        half.set_editor_property("constant", unreal.LinearColor(0.5, 0.5, 0.0, 0.0))
        mel.connect_material_expressions(half, "", sub, "B")
        ln = node(unreal.MaterialExpressionDistance, -860, 560)
        zero2 = node(unreal.MaterialExpressionConstant2Vector, -1000, 700)
        zero2.set_editor_property("constant", unreal.LinearColor(0.0, 0.0, 0.0, 0.0))
        mel.connect_material_expressions(sub, "", ln, "A")
        mel.connect_material_expressions(zero2, "", ln, "B")
        edge = node(unreal.MaterialExpressionSmoothStep, -700, 560)
        set_prop(edge, "ConstMin", 0.28)
        set_prop(edge, "ConstMax", 0.36)
        mel.connect_material_expressions(ln, "", edge, "Value")
        blend = node(unreal.MaterialExpressionLinearInterpolate, -520, 130)
        mel.connect_material_expressions(samples[1], "", blend, "A")
        mel.connect_material_expressions(samples[0], "", blend, "B")
        mel.connect_material_expressions(edge, "", blend, "Alpha")

        # ---- the pulse: 0.72 + 0.28 * sin(Time * speed) ------------------
        pspd = node(unreal.MaterialExpressionScalarParameter, -1000, 900)
        pspd.set_editor_property("parameter_name", "PulseSpeed")
        pspd.set_editor_property("default_value", 1.15)
        pmul = node(unreal.MaterialExpressionMultiply, -860, 900)
        mel.connect_material_expressions(tnode, "", pmul, "A")
        mel.connect_material_expressions(pspd, "", pmul, "B")
        psin = node(unreal.MaterialExpressionSine, -720, 900)
        mel.connect_material_expressions(pmul, "", psin, "")
        pamp = node(unreal.MaterialExpressionScalarParameter, -860, 1020)
        pamp.set_editor_property("parameter_name", "PulseDepth")
        pamp.set_editor_property("default_value", 0.28)
        pm2 = node(unreal.MaterialExpressionMultiply, -580, 940)
        mel.connect_material_expressions(psin, "", pm2, "A")
        mel.connect_material_expressions(pamp, "", pm2, "B")
        pbase = node(unreal.MaterialExpressionScalarParameter, -580, 1060)
        pbase.set_editor_property("parameter_name", "PulseBase")
        pbase.set_editor_property("default_value", 0.72)
        padd = node(unreal.MaterialExpressionAdd, -420, 980)
        mel.connect_material_expressions(pm2, "", padd, "A")
        mel.connect_material_expressions(pbase, "", padd, "B")

        # ---- tint * glow * pulse -> emissive ------------------------------
        tint = node(unreal.MaterialExpressionVectorParameter, -520, 340)
        tint.set_editor_property("parameter_name", "RuneTint")
        tint.set_editor_property("default_value", unreal.LinearColor(0.72, 0.34, 1.0, 1.0))
        m1 = node(unreal.MaterialExpressionMultiply, -320, 200)
        mel.connect_material_expressions(blend, "", m1, "A")
        mel.connect_material_expressions(tint, "", m1, "B")
        glow = node(unreal.MaterialExpressionScalarParameter, -320, 420)
        glow.set_editor_property("parameter_name", "RuneGlow")
        glow.set_editor_property("default_value", float(LOOK["runeGlow"]))
        m2 = node(unreal.MaterialExpressionMultiply, -160, 260)
        mel.connect_material_expressions(m1, "", m2, "A")
        mel.connect_material_expressions(glow, "", m2, "B")
        m3 = node(unreal.MaterialExpressionMultiply, -20, 320)
        mel.connect_material_expressions(m2, "", m3, "A")
        mel.connect_material_expressions(padd, "", m3, "B")
        mel.connect_material_property(m3, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
        mel.recompile_material(mat)
        eal.save_asset(mat.get_path_name())
    except Exception as _e:
        unreal.log_error("RUNE CIRCLE MATERIAL FAILED (%s): the circle falls back "
                         "to its geometry rings" % _e)
        return None

    unreal.log_warning("RUNE MATERIAL built: additive, unlit, two counter-"
                       "rotating layers, pulsing 0.72 +/- 0.28")
    return mat


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
    # TASK 2.2. Folded in under "runes" so the circle is placed with the same
    # _part call as everything else; absent if the texture or the material did
    # not build, and every call site falls back to the geometry rings.
    _RUNE = build_rune_material(TEXS)
    if _RUNE is not None:
        MATS["runes"] = _RUNE
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

    # ---------------------------------------------------------- BATCHING
    #
    # THE MEASUREMENT THAT FORCED THIS. On a real NVIDIA L4: 1280x720, H264,
    # 18 Mb/s, 12 FPS, zero freezes, GPU utilisation ~10%, VRAM 1.6 GB, and the
    # RenderThread at 55-80% of one core. A GPU at ten per cent while the frame
    # rate is twelve is a starved GPU, not a loaded one. The cost was never
    # shading; it was submitting ~33,000 individual actors.
    #
    # So every purely VISUAL piece now becomes an instance in a batch instead of
    # an actor of its own. Nothing about the frame changes: same mesh, same
    # material, same transform, same shadow decision. What changes is that the
    # renderer is handed a hundred-odd components instead of thirty-three
    # thousand primitives.
    #
    # WHAT IS NOT BATCHED, and this is the whole care of it: markers, portals,
    # interactables, lights, cameras, the Relay Dogs and every gameplay anchor
    # stay individual actors. Actor count is not the goal. The goal is that
    # DECORATION stops costing an actor each — semantics are worth their
    # overhead and ornament is not.
    #
    # WONDERLAND_BATCH=0 restores the old one-actor-per-piece world, so the two
    # can be built and measured against each other rather than argued about.
    BATCH_VISUALS = os.environ.get("WONDERLAND_BATCH", "1") not in ("0", "false", "no")

    # WHICH MATERIALS BLOCK A PAWN.
    #
    # This was empty by default, and every build this project has ever made had
    # NO gameplay collision at all: a player flew through the castle. That was
    # left as a switch on the reasoning that it is a product decision.
    #
    # It is two decisions and only one of them is. Whether GRAVITY applies —
    # whether Wonderland is walked or flown — changes the game and belongs to
    # the founder; the pawn still uses FloatingPawnMovement and this does not
    # touch it. Whether a solid object is SOLID is not a preference: the goal
    # says "keep Unreal authoritative for collision" and lists "collision /
    # gameplay works", and a world with nothing to bump into meets neither.
    #
    # So the ground and the architecture block by default. Decoration does not:
    # collision on thirty-three thousand instances is a cost nobody has
    # measured, and petals and motes have no business stopping anyone. This set
    # is about 3,100 of 31,996 pieces — under a tenth — and
    # WonderlandWorldProof prints RUNTIME_BLOCKING_PRIMITIVES and
    # RUNTIME_GROUNDED_DOGS so the next run reports the result as a number
    # rather than an impression.
    #
    # WONDERLAND_COLLIDE= (explicitly empty) restores the old collisionless
    # world in one build, which is the escape hatch if the L4 says the cost is
    # real. An UNSET variable gets the default; an empty one is a choice.
    COLLIDE_DEFAULT = "plaza,cobble,cobble2,stone"
    COLLIDE_MATS = set(
        n.strip() for n in os.environ.get("WONDERLAND_COLLIDE", COLLIDE_DEFAULT).split(",")
        if n.strip() and n.strip().lower() != "none")
    if COLLIDE_MATS:
        unreal.log_warning("COLLIDE materials: %s" % ", ".join(sorted(COLLIDE_MATS)))

    _BATCHES = {}
    _BATCH_ORDER = []

    def _batch_key(mesh_path, mat_path, cast_shadow, collides):
        return (mesh_path, mat_path, bool(cast_shadow), bool(collides))

    def _batch_add(mesh_path, mat_path, cast_shadow, location, rotation, scale,
                   mat_obj=None, mesh_obj=None, collides=False):
        key = _batch_key(mesh_path, mat_path, cast_shadow, collides)
        entry = _BATCHES.get(key)
        if entry is None:
            entry = {"mesh": mesh_path, "mat": mat_path,
                     "shadow": bool(cast_shadow), "collides": bool(collides),
                     "xf": [],
                     "mat_obj": mat_obj, "mesh_obj": mesh_obj}
            _BATCHES[key] = entry
            _BATCH_ORDER.append(key)
        # Nine floats, in the order WonderlandInstancedBatch.cpp reads them:
        # X Y Z, Pitch Yaw Roll, ScaleX ScaleY ScaleZ. Written out rather than
        # zipped from a tuple because FRotator's field order has already
        # mis-aimed a camera and the sun in this project.
        entry["xf"].extend([
            float(location[0]), float(location[1]), float(location[2]),
            float(rotation[0]), float(rotation[1]), float(rotation[2]),
            float(scale[0]), float(scale[1]), float(scale[2]),
        ])
        return entry

    def _asset_path_of(obj):
        """The path a runtime LoadObject will resolve, or '' if unknowable."""
        if obj is None:
            return ""
        for getter in ("get_path_name", "get_full_name"):
            try:
                path = getattr(obj, getter)()
                if path:
                    return str(path)
            except Exception:
                continue
        return ""

    def emit_batches():
        """Turn the accumulated pieces into a handful of batch actors."""
        if not _BATCHES:
            return 0
        cls = unreal.load_class(None, "/Script/Wonderland.WonderlandInstancedBatch")
        if not cls:
            # LOUD, and it must not silently produce an empty world. Without the
            # C++ class there is nothing to hold the instances, and every piece
            # placed this run would simply not exist.
            unreal.log_error(
                "WonderlandInstancedBatch is not in this build — %d batches "
                "holding %d pieces CANNOT be placed. Compile the C++ module, or "
                "set WONDERLAND_BATCH=0 to generate the unbatched world."
                % (len(_BATCHES), sum(len(b["xf"]) // 9 for b in _BATCHES.values())))
            return 0
        placed = pieces = 0
        for key in _BATCH_ORDER:
            entry = _BATCHES[key]
            count = len(entry["xf"]) // 9
            if count == 0:
                continue
            name = "Batch_%s_%s%s" % (
                entry["mesh"].rsplit("/", 1)[-1].split(".")[0],
                (entry["mat"].rsplit("/", 1)[-1].split(".")[0] or "default"),
                ("" if entry["shadow"] else "_noshadow")
                + ("_solid" if entry.get("collides") else ""))
            actor = actors.spawn_actor_from_class(cls, unreal.Vector(0.0, 0.0, 0.0),
                                                  unreal.Rotator())
            if actor is None:
                unreal.log_error("batch %s failed to spawn; %d pieces lost" % (name, count))
                continue
            actor.set_actor_label(name)
            set_prop(actor, "MeshPath", entry["mesh"])
            set_prop(actor, "MaterialPath", entry["mat"])
            # HARD REFERENCES. The path strings above are a record, not a
            # reference — the cooker follows OBJECT references, so materials
            # reached only by a runtime LoadObject path were stripped and the
            # live L4 render came up with all 146 batches grey. Wiring the real
            # objects makes them cook because something points at them.
            if entry.get("mat_obj") is not None:
                set_prop(actor, "Material", entry["mat_obj"])
            if entry.get("mesh_obj") is not None:
                set_prop(actor, "Mesh", entry["mesh_obj"])
            set_prop(actor, "BatchName", unreal.Name(name))
            # HIERARCHICAL, SO THE LODs ABOVE ACTUALLY DO SOMETHING.
            #
            # A plain InstancedStaticMeshComponent picks ONE LOD for the entire
            # component. These batches span the whole world, so with ISM every
            # instance draws at LOD0 however far away it is and the reduction
            # LODs are inert. HierarchicalInstancedStaticMeshComponent's cluster
            # tree exists precisely to select LOD per instance.
            #
            # WonderlandInstancedBatch.h says bHierarchical "exists on this
            # actor so the choice can be MEASURED rather than argued about" and
            # notes the tree costs a rebuild per AddInstance. It has never been
            # measured. It is being measured now, against a world that is
            # geometry-bound with 137,816 instances at LOD0.
            set_prop(actor, "bHierarchical",
                     os.environ.get("WONDERLAND_HISM", "1") != "0")
            set_prop(actor, "bCastShadow", bool(entry["shadow"]))
            set_prop(actor, "bCollides", bool(entry.get("collides")))
            _set_float_array(actor, "Transforms", entry["xf"])
            placed += 1
            pieces += count
        _solid = sum(len(_BATCHES[k]["xf"]) // 9 for k in _BATCH_ORDER
                     if _BATCHES[k].get("collides"))
        unreal.log_warning("BATCHES=%d  INSTANCED_PIECES=%d  COLLIDING_PIECES=%d"
                           % (placed, pieces, _solid))
        return placed

    def _set_float_array(actor, cpp_name, values):
        """TArray<float> from Python, tolerating how a build exposes arrays."""
        for candidate in (values, None):
            payload = candidate
            if payload is None:
                try:
                    payload = unreal.Array(float)
                    payload.extend(values)
                except Exception:
                    return False
            if set_prop(actor, cpp_name, payload):
                return True
        return False

    # NANITE, ONCE, BEFORE THE FIRST PIECE IS PLACED. See
    # wl_naniteise_primitives: this world submits on the order of 100 million
    # triangles a frame from 137,816 instances of engine primitives that have
    # exactly one LOD, and an isolated sweep proved it is geometry-bound --
    # r.ScreenPercentage 70, half the pixel work, changed the frame rate by
    # nothing. WONDERLAND_NANITE=0 puts the engine primitives back in one cook.
    # REDUCTION LODs, ON BY DEFAULT. See wl_lod_primitives: this world is
    # geometry-bound and every piece draws at LOD0 because the engine
    # primitives ship one LOD. WONDERLAND_LODS=0 restores them in one cook.
    _LOD_MESH = {}
    if os.environ.get("WONDERLAND_LODS", "1") != "0":
        try:
            _LOD_MESH = wl_lod_primitives()
        except Exception as _le:
            unreal.log_warning("LOD: step failed (%s); the world keeps the "
                               "engine primitives and stays geometry-bound" % _le)

    _NANITE_MESH = {}
    # DEFAULT OFF, BY MEASUREMENT. Nanite was the right hypothesis for a
    # geometry-bound world and it is the WRONG TOOL FOR THIS ONE. With SM6
    # confirmed active (SF_VULKAN_SM6 in the runtime log) and five primitives
    # converted, the stream delivered 5, 7 and 8 fps against 14, 15 and 10
    # without it -- half the frame rate -- and the frame was visually identical
    # (mean |delta| 7.5 / 255).
    #
    # The reason is in the numbers this world is made of: Nanite is built for
    # high-polygon meshes, and Wonderland is 137,816 instances of primitives
    # between 12 and 1,900 triangles. Its per-cluster overhead costs more than
    # the triangles it saves at that size. GPU utilisation FELL from 99% to 42%
    # while the frame rate halved, which is the signature of the bottleneck
    # leaving the GPU rather than the work getting cheaper.
    #
    # Kept, not deleted, and switchable with WONDERLAND_NANITE=1: the mechanism
    # is correct and gated, and if Wonderland ever carries real high-poly
    # geometry this becomes the right answer. The measurement above is what
    # stops it being retried blind.
    if os.environ.get("WONDERLAND_NANITE", "0") != "0":
        try:
            _NANITE_MESH = wl_naniteise_primitives()
        except Exception as _nse:
            unreal.log_warning("NANITE: conversion step failed (%s); the world "
                               "keeps the engine primitives" % _nse)

    def static_mesh(mesh_key, location, scale, label, rotation=(0.0, 0.0, 0.0), mat=None):
        # A converted mesh if there is one, the original otherwise. Falling back
        # to the original is deliberate: a missing mesh removes the piece from
        # the world, and a slow Wonderland beats an empty one.
        path = (_NANITE_MESH.get(mesh_key) or _LOD_MESH.get(mesh_key)
                or PLACEHOLDER_MESH.get(mesh_key, UNKNOWN_MESH))
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
        # Resolve the material and the shadow decision BEFORE anything is
        # created: both are part of the batch key, and both used to be applied
        # to a component after the fact.
        m = MATS.get(mat) if isinstance(mat, str) else mat
        if m is None:
            m = MATS.get(mat_name_for(mesh_key, label))

        _lb = label or ""
        _cast_shadow = not (mat in NO_SHADOW_MATS
                            or any(_lb.startswith(_p) for _p in NO_SHADOW_PREFIX))

        # THE ANALYSIS HOOK, on every path. The offline harnesses replace this to
        # capture the world with no engine; whether the piece then becomes an
        # instance or an actor is invisible to them, which is what keeps the
        # composition preview and the draw-cost audit comparable across this
        # change.
        _wl_piece_hook(mesh_key, location, scale, label, rotation, mat)

        if BATCH_VISUALS:
            # Keyed off the material NAME the caller asked for, not the resolved
            # asset: the name is what an operator types into WONDERLAND_COLLIDE.
            _collides = isinstance(mat, str) and mat in COLLIDE_MATS
            _batch_add(path, _asset_path_of(m), _cast_shadow, location, rotation, scale,
                       mat_obj=m, mesh_obj=asset_lib.load_asset(path),
                       collides=_collides)
            return None

        actor = spawn(unreal.StaticMeshActor, location, rotation=rotation, scale=scale, label=label)
        smc = actor.get_component_by_class(unreal.StaticMeshComponent)
        # MOVABLE so the mesh is fully dynamic: with r.AllowStaticLighting=False and
        # no baked lighting, a STATIC-mobility mesh has no lightmap AND is excluded
        # from some dynamic paths -> it renders BLACK. Movable meshes receive the
        # dynamic sun/fill/sky light every frame. This is THE fix for the black Hub.
        # (The batched path keeps Movable for the same reason — see
        # WonderlandInstancedBatch.h.)
        smc.set_mobility(unreal.ComponentMobility.MOVABLE)
        smc.set_static_mesh(asset_lib.load_asset(path))
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
        if not _cast_shadow:
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
                # BARK RUNS UP. The framing tree's bole segments are three of
                # the ten most visible objects in the hero frame, and between
                # the knots they are smooth tapered cylinders. What reads as
                # bark on a trunk this size is not the taper and not the
                # texture — it is the VERTICAL RIDGE, the long shadow line
                # running the height of the segment. Six per segment, at
                # irregular spacing and varying depth, because evenly spaced
                # flutes read as a column rather than a tree.
                for _rg in range(6):
                    _ra = (_rg / 6.0) * 2.0 * math.pi + i * 0.83
                    _rd = sw * (0.94 + ((i * 7 + _rg * 5) % 5) * 0.028)
                    _part("cube", cx_ + math.cos(_ra) * _rd, cy_ + math.sin(_ra) * _rd,
                          sh_ * (i + 0.5),
                          (0.13 + ((_rg + i) % 3) * 0.05) * s,
                          (0.09 + ((_rg * 3 + i) % 3) * 0.04) * s,
                          sh_ * 1.02 / 100.0, "trunk",
                          "%s_ridge%d_%d" % (label, i, _rg),
                          rot=(0.0, 0.0, math.degrees(_ra)))
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
        # A CANOPY IS A SILHOUETTE, AND A SILHOUETTE IS A BROKEN EDGE.
        #
        # This was eleven smooth spheres, and across the five great trees it is
        # roughly a THIRD of the hero frame — by far the largest primitive read
        # left in the world. The shrubs got leaf cards a while ago and the hero
        # trees never did, which is the wrong way round: the trees are what the
        # eye lands on.
        #
        # Three things per blob, in the order the eye reads them:
        #   the DARK INTERIOR that never catches light, so the mass has depth
        #   instead of being lit evenly all the way through;
        #   the blob itself, unchanged;
        #   LEAF CARDS around its outer surface, which is the only one of the
        #   three that changes the outline. Cards sit at 0.95 of the radius so
        #   they break the edge rather than floating outside it, and lean at
        #   varying angles because a fan of parallel cards reads as a fan.
        for i, (ox, oy, cs, mat) in enumerate(blobs):
            if not giant and i > 2:
                break
            d = 2.0 * cr * cs
            bx_ = x + ox * cr
            by_ = y + oy * cr
            bz_ = th + cr * 0.30 + i * cr * 0.12
            if giant and i < 4:
                _part("sphere", bx_, by_, bz_, d * 0.72 / 100.0, d * 0.72 / 100.0,
                      d * 0.72 / 100.0, "foliage_deep", "%s_dark%d" % (label, i))
            _part("sphere", bx_, by_, bz_,
                  d / 100.0, d / 100.0, d / 100.0, mat, "%s_canopy%d" % (label, i))
            # BLOSSOM, BECAUSE THE REFERENCE'S TREES FLOWER.
            #
            # Measured against the founder's reference, pink_rose_red is 26.7%
            # of its frame and violet_purple 22.4% -- together very nearly HALF
            # of it -- while ours runs 2.1% and 3.2%. At the same time green
            # measures 0.0% in the reference against a Wonderland geometry that
            # is 12% leaf. The reference is not a green garden with pink in it;
            # its canopies are blossom and its greens are dark supporting mass.
            #
            # Pink cannot come from the leaf cards: their albedo has a real
            # green baked in, so a pink tint over it only makes mud. It comes
            # from clusters ON the canopy, in the petal materials the world
            # already has -- which is also how a cherry or a wisteria actually
            # reads, as colour sitting on top of foliage rather than replacing
            # it.
            #
            # On the OUTER blobs only (i > 0): the inner mass is what gives the
            # canopy its shadow, and flowering it flattens the tree.
            if i > 0 and "petal_pink" in MATS:
                _nb = 6 if giant else 4
                for _q in range(_nb):
                    _qa = _q * (2.0 * math.pi / _nb) + i * 0.7
                    _qr = d * 0.42
                    _part("sphere",
                          bx_ + math.cos(_qa) * _qr,
                          by_ + math.sin(_qa) * _qr,
                          bz_ + d * (0.10 + 0.16 * ((_q + i) % 3) / 2.0),
                          d * 0.30 / 100.0, d * 0.30 / 100.0, d * 0.26 / 100.0,
                          ("petal_pink", "rose_pink", "petal_violet",
                           "petal_pink")[(_q + i) % 4],
                          "%s_bloom%d_%d" % (label, i, _q))
            if "leafcard" in MATS:
                ncards = (6 if giant else 4)
                for k in range(ncards):
                    # golden-angle spiral, biased to the upper hemisphere where
                    # the light is and where the outline is actually read
                    u = (k + 0.5) / ncards
                    zc = 1.0 - u * 1.42
                    zc = max(-0.72, zc)
                    rr = math.sqrt(max(0.0, 1.0 - zc * zc))
                    aa = k * 2.39996 + (i * 0.7)
                    px_ = bx_ + math.cos(aa) * rr * d * 0.475
                    py_ = by_ + math.sin(aa) * rr * d * 0.475
                    pz_ = bz_ + zc * d * 0.475
                    cw = d * (0.0034 if giant else 0.0052) * (0.8 + ((k * 7 + i * 3) % 5) * 0.1)
                    _part("cube", px_, py_, pz_, cw, 0.02, cw * 1.15,
                          "leafcard_hi" if (k + i) % 2 else "leafcard",
                          "%s_lc%d_%d" % (label, i, k),
                          rot=(float((k * 31 + i * 17) % 54) - 27.0,
                               math.degrees(aa), float((k * 13) % 40) - 20.0))
                # a sunlit rim on the top-outer blobs: the addendum asks for
                # shadowed interiors AND sunlit edges, and only one of those
                # was here
                if giant and cs > 0.7:
                    for k in range(4):
                        aa = k * 1.5708 + 0.4
                        _part("sphere", bx_ + math.cos(aa) * d * 0.40,
                              by_ + math.sin(aa) * d * 0.40, bz_ + d * 0.30,
                              d * 0.16 / 100.0, d * 0.16 / 100.0, d * 0.13 / 100.0,
                              "foliage_spr", "%s_rim%d_%d" % (label, i, k))

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

    def kit_portrait(x, y, z, s, label):
        """An ornate framed card, not a gold slab.

        THE PRIMITIVE AUDIT NAMED THIS ONE. portrait_frame was a single
        /Engine/BasicShapes/Cube in gold — 1.25% of the arrival frame carried by
        one bare box, which is exactly the "exposed blockout geometry" the
        reference has none of. The reference's equivalent is a heart-suit card
        in a moulded frame: a mount, a bevel, corner bosses and a device.
        """
        w, h, d = 1.20 * s, 1.60 * s, 0.16 * s
        # the canvas, set back inside the frame
        _part("cube", x, y, z, d * 0.5, w, h, "porcelain" if "porcelain" in MATS else "spire",
              "%s_canvas" % label)
        # moulded frame: outer, bevel, inner lip
        _part("cube", x - d * 0.30, y, z, d * 0.30, w * 1.16, h * 1.12, "gold", "%s_frame" % label)
        _part("cube", x - d * 0.52, y, z, d * 0.18, w * 1.05, h * 1.02, "gold_glow" if "gold_glow" in MATS else "gold",
              "%s_bevel" % label)
        # corner bosses — what stops a frame reading as an outline
        for _cx in (-1, 1):
            for _cy in (-1, 1):
                _part("sphere", x - d * 0.55, y + _cx * w * 0.56, z + _cy * h * 0.54,
                      0.16 * s, 0.16 * s, 0.16 * s, "gold", "%s_boss%d%d" % (label, _cx, _cy))
        # the device: a heart, which is the motif the reference repeats
        _part("cube", x - d * 0.62, y, z + h * 0.02, 0.10 * s, w * 0.34, h * 0.30,
              "rose" if "rose" in MATS else "gold", "%s_heart" % label,
              rot=(0.0, 0.0, 45.0))
        _part("sphere", x - d * 0.62, y - w * 0.16, z + h * 0.20,
              0.30 * s, 0.30 * s, 0.30 * s, "rose" if "rose" in MATS else "gold",
              "%s_heartl" % label)
        _part("sphere", x - d * 0.62, y + w * 0.16, z + h * 0.20,
              0.30 * s, 0.30 * s, 0.30 * s, "rose" if "rose" in MATS else "gold",
              "%s_heartr" % label)

    def kit_standing_stone(x, y, s, label):
        """A carved stone with a rune, not a gold cuboid.

        Also named by the primitive audit: project_standing_stones was one bare
        box at 0.78% of the frame. A standing stone reads from its TAPER and its
        cap; a cuboid reads as a crate.
        """
        hgt = 260.0 * s
        _part("cube", x, y, hgt * 0.10, 1.30 * s, 1.30 * s, 0.20 * s, "stone", "%s_base" % label)
        _part("cube", x, y, hgt * 0.48, 1.00 * s, 0.86 * s, hgt * 0.78 / 100.0, "stone",
              "%s_shaft" % label, rot=(0.0, 0.0, 6.0))
        # taper: a narrower block above, so the silhouette is not parallel-sided
        _part("cube", x, y, hgt * 0.86, 0.74 * s, 0.66 * s, hgt * 0.22 / 100.0, "stone",
              "%s_taper" % label, rot=(0.0, 0.0, -4.0))
        _part("sphere", x, y, hgt * 1.00, 0.40 * s, 0.36 * s, 0.30 * s, "stone", "%s_cap" % label)
        # the rune, which is what makes it a standing STONE rather than a post
        _part("cube", x - 0.44 * s * 100.0 * 0.01 * 50.0, y, hgt * 0.56,
              0.06 * s, 0.34 * s, 0.34 * s,
              "magic_gold" if "magic_gold" in MATS else "gold", "%s_rune" % label)
        for _k in range(3):
            _part("sphere", x, y + (_k - 1) * 46.0 * s, hgt * (0.30 + 0.16 * _k),
                  0.11 * s, 0.11 * s, 0.11 * s,
                  "magic_gold" if "magic_gold" in MATS else "gold",
                  "%s_spark%d" % (label, _k))

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
            # FLUTING IS A REED WITH A GROOVE BESIDE IT, NOT A DARK BAR.
            #
            # This drew five cubes per face in `brass_deep` — a 0.42/0.30/0.13
            # brown — each 9 s wide on a face 88 s across, so 68% of every
            # visible face of both piers was dark brown. Probed on the hero
            # frame after the gate was moved into shot, the flutes merged into a
            # single brown COLUMN 100 px wide and 230 px tall in the right
            # third: the largest dark mass in the picture, on the one landmark
            # the district is named for. The comment called them "shallow reeds
            # ... with the shadow between them" and the code built the reeds
            # themselves out of shadow.
            #
            # Inverted, which is also how a fluted pier is actually made: the
            # REED stands proud in the pier's own dressed stone, and only the
            # narrow groove between two reeds is dark. Four reeds and three
            # grooves per face, and the grooves are a third the width they were,
            # so at any distance the pier reads pale with fine dark lines.
            for f in range(4):
                fo = (f - 1.5) * 0.30 * s * 55.0
                for fx_, fy_ in ((0.0, -1.0), (0.0, 1.0), (-1.0, 0.0), (1.0, 0.0)):
                    _part("cube", px + fx_ * 45.0 * s + (fo if fx_ == 0 else 0.0),
                          y + fy_ * 45.0 * s + (fo if fy_ == 0 else 0.0), ph * 0.52,
                          0.10 * s, 0.10 * s, ph * 0.80 / 100.0,
                          "spire" if "spire" in MATS else "gold",
                          "%s_reed%d_%d_%d" % (label, sx, f, int(fx_ * 2 + fy_)))
            for f in range(3):
                fo = (f - 1.0) * 0.30 * s * 55.0
                for fx_, fy_ in ((0.0, -1.0), (0.0, 1.0), (-1.0, 0.0), (1.0, 0.0)):
                    _part("cube", px + fx_ * 46.0 * s + (fo if fx_ == 0 else 0.0),
                          y + fy_ * 46.0 * s + (fo if fy_ == 0 else 0.0), ph * 0.52,
                          0.03 * s, 0.03 * s, ph * 0.78 / 100.0,
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
                  detail=0, roof_w=1.75, roof_h=4.4):
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
        # THE ROOF IS THE SILHOUETTE, AND IT WAS SQUAT.
        #
        # It was fixed at radius 1.9 and half-height 2.9 — 190 uu across a cone
        # 290 uu tall, so 1:1.53, on a shaft 144 uu wide. A fairy-tale spire is
        # nothing like that ratio: the reference's towers carry TALL, NARROW
        # cones, roughly 1:2.5 and steeper, and the roof is more than half the
        # tower's height. Squat cones on many towers is most of what makes a
        # skyline read as "cylinder + cone, repeated", which the art direction
        # names as the thing not to do.
        #
        # The defaults are the new proportion; both are parameters so the
        # skyline can carry SEVERAL tower shapes rather than one. The cone must
        # not shrink below the eave it sits on (br * 1.30 / 50 = 1.87 s), or the
        # roof stops covering its own drum — which is why the width moved a
        # little and the height moved a lot.
        _part("cone", x, y, bh + 210.0 * s, roof_w * s, roof_w * s, roof_h * s,
              roof_mat, "%s_roof" % label)
        # lantern under the finial
        # THE FINIAL RIDES THE APEX, WHICH IS NOW A VARIABLE. These were three
        # literals — 306, 336, 400, 470 — measured off a roof whose half-height
        # was 2.9. With a taller roof they would have sat INSIDE the cone, and a
        # finial buried in its own spire is invisible in a way nothing reports.
        _apex = bh + 210.0 * s + roof_h * 50.0 * s
        _part("cylinder", x, y, _apex + 6.0 * s, 0.26 * s, 0.26 * s, 0.30 * s, "gold", "%s_lantern" % label)
        _part("sphere", x, y, _apex + 36.0 * s, 0.32 * s, 0.32 * s, 0.32 * s, "gold_glow", "%s_finial" % label)
        if flag:
            _part("cylinder", x, y, _apex + 100.0 * s, 0.05 * s, 0.05 * s, 1.1 * s, "gold", "%s_pole" % label)
            _part("cube", x + 24.0 * s, y, _apex + 170.0 * s, 0.02 * s, 0.42 * s, 0.28 * s, roof_mat, "%s_flag" % label)

    # FOUR CASTLES, NOT ONE CASTLE SEVENTY-SIX TIMES.
    #
    # kit_castle took (x, y, s, label) and the skyline called it 76 times. Scale
    # was the ONLY thing that varied, so every silhouette on the horizon was the
    # same silhouette at a different size — which is precisely the "procedural
    # city" the art direction rules out:
    #
    #     "Do not solve the castle by repeating cylinder + cone, cylinder +
    #      cone... Create silhouette hierarchy. Towers need recognizable
    #      silhouettes: narrow spires, broad palace towers, turret clusters,
    #      domes, clock towers, bridge-connected towers."
    #
    # Each row is one archetype, and they differ in the things that survive four
    # kilometres — the height of the dominant mass, whether there is a dome at
    # all, how many towers and how they step, and how steep the roofs are.
    # Surface detail does not survive that distance and is not what varies.
    #
    #        donjon  dome   corner towers (bearing, scale)                            roof_w roof_h halls dome2
    _CASTLE_VARIANT = (
        # 0 CITADEL — the original: a dominant keep with a dome beside it.
        (1.85, 1.00, ((0.6, 1.30), (2.0, 1.05), (3.5, 1.22), (5.1, 0.95)),            1.75,  4.40,  4,   3),
        # 1 SPIRE CLUSTER — no dome, a very tall donjon and six stepped turrets
        #   of markedly unequal height. This is the reference's commonest shape.
        (2.55, 0.00, ((0.4, 1.35), (1.5, 0.90), (2.6, 1.22), (3.7, 0.78),
                      (4.8, 1.08), (5.8, 0.66)),                                      1.52,  5.80,  3,   0),
        # 2 PALACE — broad and low, a wide dome dominating, roofs shallow. The
        #   counterweight: a skyline of nothing but spires is its own repetition.
        (1.10, 1.55, ((0.9, 0.86), (2.4, 0.94), (4.1, 0.80)),                         2.15,  3.20,  5,   4),
        # 3 TWIN TOWERS — two unequal masses with the bridges between them, and
        #   sky underneath. Negative space is what separates towers at distance.
        (2.10, 0.00, ((1.1, 1.45), (4.3, 1.00)),                                      1.62,  5.20,  2,   0),
    )

    def kit_mushroom_house(x, y, s, label, cap="mush_red"):
        """A giant mushroom that people live in.

        The founder's reference does not build its skyline out of castles
        alone: several of the largest silhouettes in it are enormous red-capped
        MUSHROOMS standing among the spires, at building scale, with windows in
        the stalk and lit doorways at the foot. They are one of the most
        recognisable things in the picture and Wonderland had none of them —
        every distant silhouette was a castle, which is its own kind of
        repetition however many archetypes the castles have.

        Built on kit_mushroom, which already carries the volva, the skirt ring,
        the gills and the flecked cap, plus the things that make it a dwelling
        rather than a fungus: a lit door, two tiers of windows following the
        stalk's swell, and a lamp over the threshold."""
        kit_mushroom(x, y, s, label, cap)
        sh, sr = 150.0 * s, 24.0 * s
        # door at the foot, facing the camera's side of the world
        _part("cube", x, y - sr * 1.02, sh * 0.16, 0.16 * s, 0.05 * s, 0.30 * s,
              "dog_visor", "%s_door" % label)
        _part("cube", x, y - sr * 1.08, sh * 0.16, 0.20 * s, 0.03 * s, 0.34 * s,
              "trunk" if "trunk" in MATS else "gold", "%s_doorframe" % label)
        _part("sphere", x, y - sr * 1.10, sh * 0.34, 0.10 * s, 0.10 * s, 0.10 * s,
              "gold_glow" if "gold_glow" in MATS else "gold", "%s_doorlamp" % label)
        # windows in two tiers around the stalk, warm-lit
        for tier, tz in enumerate((sh * 0.42, sh * 0.62)):
            for i in range(5):
                a = i * (2.0 * math.pi / 5.0) + tier * 0.63
                _part("cube", x + math.cos(a) * sr * 1.02, y + math.sin(a) * sr * 1.02, tz,
                      0.11 * s, 0.11 * s, 0.15 * s,
                      "gold_glow" if "gold_glow" in MATS else "gold",
                      "%s_win%d_%d" % (label, tier, i))
        # a balcony ring on the skirt, which is what the veil ring becomes once
        # the thing is a house
        for i in range(8):
            a = i * (2.0 * math.pi / 8.0)
            _part("cube", x + math.cos(a) * sr * 1.95, y + math.sin(a) * sr * 1.95,
                  sh * 0.78, 0.09 * s, 0.09 * s, 0.14 * s, "gold",
                  "%s_rail%d" % (label, i))

    def kit_castle(x, y, s, label, variant=0, far=False):
        """The hero castle that closes the north axis. One dominant silhouette
        rather than a picket line of identical turrets: a great keep, four corner
        towers stepped in height, a curtain wall with merlons and a gatehouse.
        The reference's skyline reads as a CITY because it has a subject; a ring
        of equal towers reads as a fence.

        `variant` picks a row of _CASTLE_VARIANT. `far` drops the ornament that
        cannot resolve past about four kilometres — merlons, buttress caps,
        bridges, secondary domes — which is roughly two thirds of the parts for
        none of the silhouette. The skyline's 76 castles were carrying the full
        hero build at up to 82 km."""
        _dj, _dm, _ct, _rw, _rh, _nh, _nd2 = _CASTLE_VARIANT[variant % len(_CASTLE_VARIANT)]
        wall_r = 620.0 * s
        # curtain wall: 20 segments around a circle, with merlons on top
        for i in range(20):
            a = i * (2.0 * math.pi / 20.0)
            wx, wy = x + math.cos(a) * wall_r, y + math.sin(a) * wall_r
            _part("cube", wx, wy, 150.0 * s, 2.1 * s, 0.62 * s, 3.0 * s, "spire_far",
                  "%s_wall%d" % (label, i), rot=(0.0, 0.0, math.degrees(a) + 90.0))
            _part("cube", wx, wy, 320.0 * s, 2.1 * s, 0.74 * s, 0.34 * s, "spire_far",
                  "%s_walk%d" % (label, i), rot=(0.0, 0.0, math.degrees(a) + 90.0))
            for k in ((-1, 1) if not far else ()):
                _part("cube", wx + math.cos(a + 1.5708) * 46.0 * s * k,
                      wy + math.sin(a + 1.5708) * 46.0 * s * k, 360.0 * s,
                      0.42 * s, 0.42 * s, 0.5 * s, "spire_far",
                      "%s_merl%d_%d" % (label, i, k))
        # corner towers, stepped so the mass is not symmetrical
        for i, (ca, cs) in enumerate(_ct):
            kit_spire(x + math.cos(ca) * wall_r, y + math.sin(ca) * wall_r, s * cs,
                      "%s_ctow%d" % (label, i), body_mat="spire_far",
                      roof_mat="roof_rose" if i % 2 else "roof_pink", flag=(i % 2 == 0),
                      roof_w=_rw, roof_h=_rh)
        # gatehouse facing the plaza
        for k in (-1, 1):
            kit_spire(x + k * 190.0 * s, y - wall_r, s * 0.85, "%s_gate%d" % (label, k),
                      body_mat="spire_far", roof_mat="roof_pink", flag=False)
        # the KEEP: a broad drum, a machicolated band, a taller inner tower
        _part("cylinder", x, y, 230.0 * s, 3.6 * s, 3.6 * s, 4.6 * s, "spire_far",
              "%s_keep" % label)
        _part("cylinder", x, y, 470.0 * s, 4.1 * s, 4.1 * s, 0.42 * s, "spire_far",
              "%s_machic" % label)
        for i in range(16 if not far else 0):
            a = i * (2.0 * math.pi / 16.0)
            _part("cube", x + math.cos(a) * 195.0 * s, y + math.sin(a) * 195.0 * s,
                  520.0 * s, 0.5 * s, 0.5 * s, 0.62 * s, "spire_far",
                  "%s_kmerl%d" % (label, i))
        kit_spire(x, y, s * _dj, "%s_donjon" % label, body_mat="spire_far",
                  roof_mat="roof_rose", flag=True, roof_w=_rw, roof_h=_rh)
        # a great dome beside the donjon, so the mass is not all cones — on the
        # variants that have one. A dome on every castle is a repetition too.
        if _dm > 0.0:
            kit_dome(x - 300.0 * s, y + 210.0 * s, 460.0 * s, 300.0 * s * _dm,
                     "%s_dome" % label, mat="spire_far", rib="roof_pink")
        # flanking halls so the base is a MASS, not a stick
        for k, (hx, hy, hs, hr) in enumerate((((-1.0, -0.35, 1.6, 0.0), (1.0, -0.15, 1.9, 0.0),
                                               (-0.55, 0.75, 1.4, 0.0), (0.7, 0.8, 1.5, 0.0),
                                               (0.15, -0.95, 2.2, 0.0))[:_nh])):
            bx, by = x + hx * 380.0 * s, y + hy * 380.0 * s
            _part("cube", bx, by, 120.0 * s, hs * s, hs * 0.7 * s, 2.4 * s, "spire_far",
                  "%s_hall%d" % (label, k))
            _part("cone", bx, by, 330.0 * s, hs * 1.15 * s, hs * 0.85 * s, 1.5 * s,
                  "roof_rose" if k % 2 else "roof_pink", "%s_hallroof%d" % (label, k))

        # ---- WHAT MAKES A SKYLINE A CITY --------------------------------
        # The mass was all here — keep, dome, corner towers, halls — and it
        # still read as a CLUSTER rather than a city. What a fantasy skyline
        # has that a cluster does not is SPAN: bridges thrown between towers,
        # and the sky visible underneath them. Negative space is the thing the
        # eye uses to separate one tower from the next at a quarter-kilometre,
        # where no amount of surface detail survives.
        #
        # Each bridge is an arc of short segments rotated tangent to it, the
        # same construction as the rose arch, with piers under the span and a
        # parapet along the top. Built from the corner towers inward to the
        # keep so they cross at different heights and read as a tangle rather
        # than a wheel.
        _spans = ((0.6, 400.0, 0.30), (2.0, 330.0, 0.22),
                  (3.5, 470.0, 0.34), (5.1, 290.0, 0.18))
        # Variant 3 IS its bridges — they are its silhouette, not its ornament —
        # so it keeps them at any distance. Everything else drops them far out,
        # where a 20 uu parapet is a fifth of a pixel.
        if far and variant != 3:
            _spans = ()
        for i, (ca, bh, sag) in enumerate(_spans):
            ax_, ay_ = x + math.cos(ca) * wall_r, y + math.sin(ca) * wall_r
            # UNSCALED span. wall_r already carries s, so using it inside an
            # expression that is multiplied by s again applies the scale twice.
            # At s=12 that sent the catenary to -21,984 uu — the bridges dived
            # underground and dragged the castle's measured height from 44% of
            # frame to 93%. Same failure as the townhouse assembly: the parts
            # were scaled and the PLAN was not.
            span = 620.0
            segs = 9
            for j in range(segs):
                t = (j + 0.5) / segs
                px_ = ax_ + (x - ax_) * t
                py_ = ay_ + (y - ay_) * t
                # a shallow catenary: high at the towers, dipping in the middle
                pz_ = (bh - math.sin(t * math.pi) * span * sag) * s
                yaw = math.degrees(math.atan2(y - ay_, x - ax_))
                seg_len = span * s / 100.0 / segs * 1.25
                _part("cube", px_, py_, pz_, seg_len, 0.62 * s,
                      0.20 * s, "spire_far", "%s_span%d_%d" % (label, i, j),
                      rot=(0.0, 0.0, yaw))
                # parapet, so the bridge has a top edge against the sky
                _part("cube", px_, py_, pz_ + 26.0 * s, seg_len,
                      0.70 * s, 0.09 * s, "spire_far",
                      "%s_spanrail%d_%d" % (label, i, j), rot=(0.0, 0.0, yaw))
                # a pier from the GROUND to the span. The first version centred
                # it at half the span height with a quarter-height box, so it
                # floated with daylight under it — a pier that touches nothing
                # is a hanging block.
                if j % 3 == 1:
                    _part("cube", px_, py_, pz_ * 0.5, 0.34 * s, 0.34 * s,
                          pz_ / 100.0, "spire_far",
                          "%s_spanpier%d_%d" % (label, i, j))

        # BUTTRESSES on the keep drum. A smooth cylinder at this scale is a
        # silo; the vertical rhythm of buttresses is what gives a keep its
        # weight, and it survives distance because it is a silhouette break
        # rather than a surface treatment.
        for i in range(10 if not far else 5):
            a = i * (2.0 * math.pi / (10.0 if not far else 5.0))
            _part("cube", x + math.cos(a) * 350.0 * s, y + math.sin(a) * 350.0 * s,
                  200.0 * s, 0.46 * s, 0.92 * s, 4.0 * s, "spire_far",
                  "%s_butt%d" % (label, i), rot=(0.0, 0.0, math.degrees(a)))
            _part("cone", x + math.cos(a) * 350.0 * s, y + math.sin(a) * 350.0 * s,
                  420.0 * s, 0.52 * s, 0.52 * s, 0.7 * s,
                  "roof_pink" if i % 2 else "roof_rose", "%s_buttcap%d" % (label, i))

        # SECONDARY DOMES at other heights, so the roofline steps rather than
        # jumping straight from halls to donjon.
        _d2 = ((0.62, -0.48, 300.0, 175.0), (-0.72, 0.22, 355.0, 205.0),
               (0.18, 0.82, 265.0, 150.0), (-0.30, -0.80, 240.0, 230.0))[:(0 if far else _nd2)]
        for i, (dx_, dy_, dz_, dr_) in enumerate(_d2):
            kit_dome(x + dx_ * 430.0 * s, y + dy_ * 430.0 * s, dz_ * s, dr_ * s,
                     "%s_dome2_%d" % (label, i), mat="spire_far",
                     rib="roof_rose" if i % 2 else "roof_pink")

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

    def kit_plaza(x, y, circle=None):
        # THE CIRCLE IS NOT NECESSARILY THE PLAZA'S CENTRE, and it used not to be
        # anywhere near the Dog. Measured off this generator: the rings sat at
        # (0, 0) with an outermost radius of 320 uu and the gold studs at 300,
        # while HERO_DOG stands at (-260, -260) — 368 uu out. The Dog was
        # standing 48 uu BEYOND the rim of its own arcane circle, while the
        # comment beside HERO_DOG said "further back onto its own arcane circle
        # — which is the beat, the Dog standing on its Relay identity".
        #
        # That circle is the single most identifying element of the founder's
        # reference. It goes under the Dog.
        ccx, ccy = circle if circle else (x, y)
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
        # ONE CONVERSION, STATED ONCE. /Engine/BasicShapes/Cylinder is 100 uu
        # across, so an actor scale of s gives a RADIUS of 50s — the same
        # conversion verify-hero-composition.py uses to draw every blob in this
        # world (abs(sc) * 50.0), which is what every composition measurement
        # here rests on.
        _BED_SCALE = 13.4
        _BED_RADIUS = _BED_SCALE * 50.0        # 670 uu
        # DEFINED HERE, BESIDE THE BED, BECAUSE THE INTERSTITIAL FILL CULLS TO
        # IT AND RUNS FIRST. It used to live 60 lines further down, next to the
        # course it governs, and the fill carried its own `_BED_RADIUS * 2.0`
        # copy of the number instead — which is how the two came to disagree.
        _PAVING_RADIUS = _BED_RADIUS * 3.6     # 2,412 uu — reaches past the arch
        _part("cylinder", x, y, 1.6, _BED_SCALE, _BED_SCALE, 0.04,
              "stone" if "stone" in MATS else "plaza", "PlazaBed")
        # THE BED IS THE MOST VISIBLE SURFACE IN THE HERO FRAME.
        #
        # Measuring pixels actually owned after occlusion — rather than
        # projected boxes, which is what the report used to rank by — PlazaBed
        # comes first at 7.9% of frame. The comment above it used to say the
        # gaps between the jittered setts were too small to resolve from the
        # hero camera. That was measured with the wrong instrument and it is
        # wrong: a twelfth of the shot is bare bed showing between the stones.
        #
        # Real cobble does not leave the bed showing. It fills the interstices
        # with SMALLER stones, which is both the correct construction and
        # exactly the density the surface needs. An offset half-step grid drops
        # a smaller sett into each gap, sitting slightly lower so the courses
        # still read.
        for igx in range(-13, 14):
            for igy in range(-13, 14):
                ih = ((igx * 2654435761) ^ (igy * 40503)) & 0x7FFFFFFF
                ix = x + (igx + 0.5) * tile
                iy = y + (igy + 0.5) * tile
                # The same paving radius as the main course, by name. A second
                # literal here is a second thing to get wrong: this one and the
                # main cull were both `13.4 * 100.0`, which is not the bed.
                # THE SAME RADIUS AS THE COURSE, BY NAME. This was
                # `_BED_RADIUS * 2.0` — a second literal for the paving extent,
                # which would have stayed at 1,340 when the course widened,
                # leaving a ring of bare mortar at exactly the radius this fill
                # exists to remove.
                if math.hypot(ix - x, iy - y) > _PAVING_RADIUS:
                    continue
                isz = tile / 100.0 * (0.40 + (ih % 7) * 0.028)
                _part("cube", ix + ((ih >> 5) % 5 - 2) * 3.0,
                      iy + ((ih >> 9) % 5 - 2) * 3.0, 3.4 + (ih % 3) * 0.3,
                      isz, isz * (0.78 + (ih % 5) * 0.05), 0.048,
                      ("cobble2", "plaza", "cobble")[ih % 3],
                      "PlazaFill%d_%d" % (igx, igy),
                      rot=(0.0, 0.0, float((ih >> 13) % 25) - 12.0))
                if ih % 4 == 0:
                    _part("sphere", ix + 14.0, iy - 11.0, 5.0, 0.13, 0.13, 0.05,
                          "moss", "PlazaFillMoss%d_%d" % (igx, igy))
        stones = ("cobble", "cobble2", "plaza")
        # THE SETTS HAVE TO COVER THE BED THEY SIT ON.
        # The bed is a disc of radius 1,340 uu; the sett field ran -6..6 at 190
        # uu, reaching only 1,140. So a 200 uu ring of bare mortar showed all
        # the way round the paving, and that ring is why PlazaBed was the most
        # visible object in the hero frame at 7.9%. Filling the interstices did
        # nothing about it, because the gap was never between the stones — it
        # was outside them. Widen the field and cull to the disc.
        # AND THAT DIAGNOSIS RESTED ON A BAD NUMBER. It opens "the bed is a disc
        # of radius 1,340 uu"; the bed is drawn at scale 13.4, and 50 x 13.4 is
        # 670 — the conversion verify-hero-composition.py uses to draw every
        # blob in this world. The paving field it was widened FROM already
        # reached 1,140 uu, comfortably past a 670 uu bed, so the ring of bare
        # mortar it was widened to cover cannot have been outside the stones.
        #
        # The paving radius is left EXACTLY where it is. Halving it to match the
        # bed would halve the visible plaza, and that is an art decision for the
        # founder rather than an arithmetic correction made in passing. What
        # changes here is that the number stops calling itself the bed's radius:
        # the paving deliberately reaches twice as far as the mortar under it.
        # THE FLOOR OF THE ARRIVAL DISTRICT REACHES THE ARCH.
        #
        # 1,340 uu was the number, and measured against the hero camera it is
        # why the plaza never read however much was cleared off it. HeroCam6
        # sits 430 uu up and pitches +5 degrees, so the visible ground begins
        # 1,292 uu out: the paving started essentially at the bottom edge of the
        # frame and ended 48 uu later. Everything above that in the bottom third
        # — which spans 1,292 to 8,790 uu of depth — was GARDEN, and no amount
        # of pushing planting aside could turn garden into stone. Two passes
        # were spent measuring "walkable surface in the bottom third" and moving
        # it by tenths of a percent, because the answer was never in that band.
        #
        # In the founder's reference the cobble runs from the viewer's feet all
        # the way back to the ivy arch, with the garden either side of it. The
        # arch stands at 2,051 uu from this camera, so the stone has to reach
        # about 2,400 — and then the district has a FLOOR rather than a disc.
        _bed_r = _PAVING_RADIUS
        for gx in range(-13, 14):
            for gy in range(-13, 14):
                if math.hypot(gx * tile, gy * tile) > _bed_r + tile * 0.55:
                    continue
                hsh = (gx * 73856093) ^ (gy * 19349663)
                # A CHECKER IS A CHECKER. This block opens by calling itself
                # "Checkered cobblestone plaza floor (the reference's iconic
                # stone checker)" and then picked the tone with `stones[hsh % 3]`
                # — a hash, which is noise. Noise at this tile size reads as
                # gravel; the reference's floor reads as LAID STONE because pale
                # and dark alternate and the eye can follow the courses.
                #
                # (gx + gy) parity is the checker. The third tone stays, on a
                # sparse hash, as the occasional odd flag that stops a perfect
                # chessboard reading as lino — which is the failure the
                # irregularity pass below was already written against.
                mat = stones[2] if (hsh >> 7) % 9 == 0 else stones[(gx + gy) % 2]
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
        # ---- WHAT BLOWS ACROSS THE STONE --------------------------------
        # Measuring the hero frame per object corrected me here. I had read the
        # bottom third of the shot as featureless LAWN and dressed the turf for
        # it; the measurement says that band is PlazaBed at 15.5%, the boulevard,
        # the dais and the fountain — it is paving, and the near-field turf pass
        # placed three patches in a frame where it expected twenty-six.
        #
        # Paving wants a different kind of incident. Cobble irregularity and
        # moss are already here, but the stone reads clean and swept, and a
        # plaza in a garden city is never swept: petals come off the roses and
        # collect where the wind drops them, which is against a raised edge and
        # in the lee of anything standing. Placed by that rule, not scattered —
        # collecting against the arcane ring's outer rim, where the eye is
        # already going.
        for _pb in range(72):
            _h = (_pb * 19349663) ^ 0xC0BB1E
            _pa = (_h % 628) / 100.0
            # A PLAZA-WIDE DRIFT, and the comment here used to call it "a ring
            # of collected petals just outside the arcane circle". It is not:
            # this radius is 980-1280 uu and the circle's outermost ring is 320.
            # It stays where it is — a wide drift across the paving is a real
            # thing and looks like one — and it stays on the PLAZA centre rather
            # than following the circle, because that is what its radius is
            # tuned for. Only the description was wrong.
            _pr = 980.0 + ((_h >> 5) % 100) / 100.0 * 300.0
            _px, _py = x + math.cos(_pa) * _pr, y + math.sin(_pa) * _pr
            _part("cube", _px, _py, 5.6, 0.12 + (_h % 3) * 0.03,
                  0.10 + (_h % 3) * 0.03, 0.010,
                  ("petal_pink", "rose_pink", "petal_violet", "petal_air",
                   "leaf")[_h % 5], "PlazaPetal%d" % _pb,
                  rot=(0.0, 0.0, float((_h >> 3) % 180)))
        # Many THIN concentric rings rather than six fat bands: the reference's
        # circle reads as engraved light, and thickness is what made ours read
        # as painted vinyl.
        # ENGRAVED LIGHT ON VISIBLE STONE, NOT A STACK OF PLATES.
        #
        # The circle was built from solid discs stacked smallest-and-highest, so
        # each one covered the centre of the one below and what survived was an
        # annulus. That works, and it has a cost that only showed once the
        # circle was made big enough to read: the "gap" rings are `plaza`
        # discs — opaque, stone-coloured, sitting 5 to 19 uu ABOVE the paving —
        # so enlarging the circle paved over the cobble checker with flat
        # lavender plates. The close-up is unambiguous: the plaza around the Dog
        # reads as painted lilac, not as laid stone with light on it.
        #
        # The reference's circle is line-work: glowing rings with the courtyard
        # visible between them, and the stone is what the light is drawn ON.
        # So the rings are annuli made of tangent segments now, and there are no
        # gap discs at all — the gap is simply where no segment is, which is the
        # only kind of gap that shows what is underneath.
        #
        # 72 segments a ring at 520 uu is one every 45 uu, short enough that the
        # chord does not read as a polygon.
        # ---- TASK 2.2: THE TEXTURE REPLACES THE GEOMETRY ------------------
        #
        # When the rune material built, one additive plane carries the whole
        # circle — rings, tick marks, sixteen rune glyphs, a dotted orbit, the
        # radial spokes and the central sigil — with two counter-rotating layers
        # and a sine pulse. 504 cubes of ring geometry become 1 plane, and the
        # result is line work at a fineness the cubes never reached.
        #
        # The geometry rings stay as the FALLBACK and only as that. If the
        # texture or the material did not build, the circle is still there.
        _RUNE_PLANE = "runes" in MATS
        if _RUNE_PLANE:
            _rr = float(LOOK["runeRadius"])
            _part("plane", ccx, ccy, 6.0,
                  _rr * 2.0 / 100.0, _rr * 2.0 / 100.0, 1.0,
                  "runes", "RuneCircle")
        _ARC_SEGS = 0 if _RUNE_PLANE else 72
        for j, (rz, rr) in enumerate(((9.0, 10.4), (10.4, 9.0), (11.8, 7.6),
                                      (13.2, 6.2), (14.6, 4.8), (16.0, 3.4),
                                      (17.4, 2.0))):
            _radius = rr * 50.0
            _seglen = (2.0 * math.pi * _radius) / _ARC_SEGS * 1.28
            for _k in range(_ARC_SEGS):
                _a = _k * (2.0 * math.pi / _ARC_SEGS)
                _part("cube",
                      ccx + math.cos(_a) * _radius,
                      ccy + math.sin(_a) * _radius, rz,
                      _seglen / 100.0, 0.09, 0.030,
                      "arcane", "ArcaneRing%d_%d" % (j, _k),
                      rot=(0.0, math.degrees(_a) + 90.0, 0.0))
        # The spokes and the glyph studs are IN the texture now; keeping the
        # geometry versions would double them.
        for i in range(0 if _RUNE_PLANE else 12):
            a = (i / 12.0) * 2.0 * math.pi
            # The spokes and studs ride the ring, so they scale with it. Left
            # at 190 and 300 they would have sat inside the second band with the
            # outer half of the circle bare.
            _part("cube", ccx + math.cos(a) * 310.0, ccy + math.sin(a) * 310.0, 7.5,
                  6.2, 0.14, 0.06, "arcane", "Rune%d" % i, rot=(0.0, math.degrees(a), 0.0))
        # gold glyph studs around the rim
        for i in range(8):
            a = (i / 8.0) * 2.0 * math.pi + 0.26
            _part("cylinder", ccx + math.cos(a) * 490.0, ccy + math.sin(a) * 490.0, 20.0,
                  0.30, 0.30, 0.48, "magic_gold", "Glyph%d" % i)
        # DRIFTING CROSS-SPARKS. Small emissive plus-signs hovering over the
        # ring, on the Bob world-position-offset so they rise and fall. In the
        # reference these are what make the circle feel ALIVE rather than
        # printed on the stone.
        for i in range(26):
            a = i * 2.39996
            rr = 90.0 + 240.0 * (((i * 29) % 11) / 11.0)
            sx, sy = ccx + math.cos(a) * rr, ccy + math.sin(a) * rr
            sz = 26.0 + 66.0 * (((i * 17) % 7) / 7.0)
            _part("cube", sx, sy, sz, 0.22, 0.05, 0.05, "arcane", "Spark%dH" % i)
            _part("cube", sx, sy, sz, 0.05, 0.05, 0.22, "arcane", "Spark%dV" % i)
        _part("cylinder", ccx, ccy, 8.0, 1.2, 1.2, 0.14, "magic_gold", "ArcaneCore")

    def kit_float_key(x, y, z, label, ks=1.0):
        # ks SCALES THE WHOLE KEY. Measured on the arrival frame, the ten
        # drifting keys owned 2.94% of it in the gold family -- more than the
        # golden_gate itself, and against a reference whose gold_amber is 1.9%
        # of the ENTIRE image. A key is an accent. At that share it was set
        # dressing competing with the landmark it points at.
        # An ORNATE key, because these hang in open sky where silhouette is the
        # whole read: a ring bow with a heart at its centre, a collar, a tapered
        # shaft, and a bit with real teeth. Tilted so it never reads as a post.
        tilt = (0.0, 0.0, 22.0)
        _part("cylinder", x, y, z, 0.17 * ks, 0.17 * ks, 1.45 * ks, "gold", "%s_shaft" % label, rot=tilt)
        # bow: a ring of small spheres rather than one ball
        import math as _m
        for i in range(8):
            a = i * (2.0 * _m.pi / 8.0)
            _part("sphere", x + _m.cos(a) * 34.0 * ks, y, z + 86.0 * ks + _m.sin(a) * 34.0 * ks,
                  0.22 * ks, 0.20 * ks, 0.22 * ks, "gold", "%s_bow%d" % (label, i))
        # heart at the centre of the bow — the Wonderland motif, in gold
        _part("sphere", x - 9.0 * ks, y, z + 92.0 * ks, 0.24 * ks, 0.20 * ks, 0.24 * ks, "gold_glow", "%s_heartL" % label)
        _part("sphere", x + 9.0 * ks, y, z + 92.0 * ks, 0.24 * ks, 0.20 * ks, 0.24 * ks, "gold_glow", "%s_heartR" % label)
        _part("cone", x, y, z + 74.0 * ks, 0.34 * ks, 0.28 * ks, 0.42 * ks, "gold_glow", "%s_heartT" % label,
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
        # THE CLOCKS WERE RECTANGLES, AND THE RENDER IS WHERE THAT SHOWED.
        #
        # Every disc in this kit carried rot=(90, 0, 0). WonderlandInstancedBatch
        # reads those three floats as (pitch, yaw, roll) — it says so in a
        # comment written after FRotator's positional constructor mis-aimed a
        # camera and the sun in this project — and a cylinder's axis is +Z.
        # PITCH turns about Y, so pitch 90 lays the axis along X and the disc
        # faces east-west. The arrival camera looks up +Y, so it was seeing
        # every clock face EDGE-ON: a filled rectangle where the reference has
        # an ornate round clock, twice in the hero frame, at a size nobody could
        # miss. ROLL turns about X, which lays the axis along Y and points the
        # face at the camera.
        #
        # The kit's own markers agree and always did: they are placed at
        # (x + sin*R, z + cos*R), a ring in the X-Z plane, which is the plane of
        # a face pointing along Y. The dial was built for roll and the case was
        # given pitch.
        # AND THE SCALE HAD TO MOVE WITH THE ROTATION. Rolling to (0,0,90) was
        # right and changing only the rotation made it worse: the scale was
        # (r, d, r) — thin on the mesh's LOCAL Y — and roll sends local Y to
        # world Z, so the disc came back as a flat horizontal BAR instead of an
        # edge-on rectangle. One defect traded for another, which is this
        # project's most reliable way to lose an afternoon.
        #
        # /Engine/BasicShapes/Cylinder is a circle in local XY extruded along
        # local Z. For a face pointing at a camera that looks up +Y, the thin
        # axis must be the one roll puts there — local Z. So (r, r, d): a full
        # circle of radius r, thin along its own axis, rolled to face the lens.
        for _b, (_r, _d) in enumerate(((1.62, 0.10), (1.54, 0.14), (1.44, 0.18))):
            _part("cylinder", x, y + _b * 4.0, z, _r, _r, _d,
                  "gold" if _b % 2 == 0 else ("brass_deep" if "brass_deep" in MATS else "gold"),
                  "%s_bezel%d" % (label, _b), rot=(0, 0, 90))
        for _k in range(12):
            _a = _k * (2.0 * math.pi / 12.0)
            _part("sphere", x + math.sin(_a) * 148.0, y + 6.0, z + math.cos(_a) * 148.0,
                  0.10, 0.06, 0.10, "gold", "%s_stud%d" % (label, _k))
        finial(x, y - 4.0, z + 158.0, 0.66, "gold", "%s_crown" % label, glow="gold_glow")
        _part("cylinder", x, y, z, 1.5, 1.5, 0.16, "gold", "%s_case" % label, rot=(0, 0, 90))
        _part("cylinder", x, y - 10, z, 1.2, 1.2, 0.10, "porcelain", "%s_face" % label, rot=(0, 0, 90))
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

    _LAMP_STATS = [0, 0]        # [shadowed, dimmed-and-shadowless]

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
            # THE LANTERNS WERE LIGHTING THE WHOLE WORLD GOLD.
            #
            # This is how the "one tan material" complaint actually happened,
            # and it took measuring the BRIGHTEST decile of each material to
            # see it. Every material's brightest pixels rendered as saturated
            # gold, whatever its own colour:
            #
            #     porcelain  base (244,242,237)  ->  top decile (213,176, 69)
            #     foliage    base ( 58,117, 56)  ->  top decile (195,169,113)
            #     mush_red   base (188, 40, 66)  ->  top decile (236,190,112)
            #
            # all converging on about 1.00 : 0.83 : 0.32 -- and the one
            # exception was dog_body at (235,215,204), near-neutral, which is
            # the surface with its own practical light on it. So the cast was
            # not the key, the grade, the textures or the tints: the world was
            # being lit by something gold that did not reach the Dog.
            #
            # It was these. 14,000 lumens each, gold, CastShadows FALSE, over an
            # 1,100 uu radius -- against a SUN of 340 lux. A dozen of them, each
            # passing straight through every wall and every canopy, so nothing
            # within eleven metres of a lamp post could be any colour but theirs.
            # Neutralising the key (tried, rendered) moved the frame by 0.1
            # points, which is what finally ruled the sun out.
            #
            # A practical lights its own surroundings. It is not the key light.
            # WHAT CUTTING THESE ACTUALLY COST, measured across the session's
            # own captures rather than argued:
            #
            #     a203547  base                  frame chroma 0.1826
            #     9bdb61e                        frame chroma 0.1655
            #     f80c8c6  lamps 14000 -> 2200   frame chroma 0.0907  <-- HALVED
            #     84a66fd  head                  frame chroma 0.0835
            #
            # These lamps were carrying HALF the frame's colour. Cutting them was
            # right and stays right -- eighteen shadowless gold lights at 14,000
            # lumens against a 340-lux sun decided the hue of every material, and
            # that was measurable per material. But they were also a third of the
            # world's light, and what replaced them was a NEUTRAL sun and sky.
            # The level came back. The colour did not, and nothing measured that
            # until a whole-frame colourfulness reading was taken.
            #
            # So the warmth comes back and the CAST does not, and the difference
            # between those two is three properties, not the brightness:
            #
            #   SHADOWED. This is the one that mattered. CastShadows FALSE let
            #     every lamp light through walls and canopies, so a surface the
            #     lamp could not see was still lit by it. A shadowing lamp lights
            #     what it faces and leaves the rest to the key, which is what
            #     makes it a practical instead of a second sun.
            #   SMALL. 620 uu of reach, not 1,100. Warmth in pools.
            #   MANY AND MODERATE. Well under the 6,000-lumen ceiling
            #     verify-light-budget.py enforces -- that gate exists because of
            #     these lamps and it is not being widened for them.
            # SHADOWS ARE THE FIX AND THEY ARE NOT FREE. A shadow-casting point
            # light renders SIX cubemap faces, and this world has 25 of them --
            # up to 150 shadow passes a frame, against a frame rate that is
            # currently 58.7 fps and is one of the goal's own acceptance
            # criteria. Turning them all on would have protected the colour by
            # spending the performance, which is trading one criterion for
            # another rather than meeting both.
            #
            # So shadows go where they DO something. The defect was lamps
            # lighting through walls into the arrival frame; a lamp forty metres
            # behind the camera cannot commit it. The near ones cast; the far
            # ones stay shadowless and are dimmed to a third, which is well
            # below the level at which a shadowless lamp can decide a hue --
            # that was 14,000 lumens over an 1,100 uu reach, and this is 1,500
            # over 620.
            _lamp_d = math.hypot(x - ARRIVAL_CAM[0], y - ARRIVAL_CAM[1])
            _lamp_near = _lamp_d < LOOK["lampShadowRadius"]
            plc.set_intensity(float(LOOK["lampLumens"])
                              * (1.0 if _lamp_near else 0.33))
            plc.set_light_color(srgb_light_color(255, 214, 158))
            set_prop(plc, "AttenuationRadius", 620.0)
            set_prop(plc, "SourceRadius", 18.0)
            set_prop(plc, "CastShadows", bool(_lamp_near))
            if _lamp_near:
                # Half-resolution shadows: these are soft warm pools on a
                # blocky world, not a place anyone reads a shadow's edge.
                set_prop(plc, "ShadowResolutionScale", 0.5)
            _LAMP_STATS[0 if _lamp_near else 1] += 1
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
            # SMOTHERED, WHICH IS THE WORD THE SPAN'S OWN COMMENT USES.
            # Nine 15 uu spheres up a 430 uu post is a spiral of beads with the
            # post showing between them; the reference's arch is a solid mass of
            # ivy with the structure barely visible through it. Twenty nodes,
            # three clusters each, in three greens.
            for k in range(20):
                t = k / 19.0
                aa = t * 7.2 + sx
                for c in range(3):
                    ca = aa + c * 2.094
                    _part("sphere", x + sx * 330.0 * s + math.cos(ca) * 22.0 * s,
                          y + math.sin(ca) * 22.0 * s, 30.0 * s + t * (h - 70.0 * s),
                          0.19 * s, 0.19 * s, 0.16 * s,
                          ("foliage", "foliage_hi", "foliage_deep")[(k + c) % 3],
                          "%s_pvine%d_%d_%d" % (label, sx, k, c))
                if k % 3 == 1:
                    _part("sphere", x + sx * 330.0 * s + math.cos(aa) * 28.0 * s,
                          y + math.sin(aa) * 28.0 * s, 30.0 * s + t * (h - 70.0 * s),
                          0.15 * s, 0.15 * s, 0.15 * s, "rose" if k % 2 else "rose_pink",
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
            # A CONTINUOUS BED OF IVY ALONG THE CURVE, then flowers in it.
            # The arc was a bare 30 uu timber with a rose every other segment,
            # so the curve read as a wire with beads on it. The ivy comes first
            # and the blooms sit IN it, which is the order the eye reads.
            for c in range(3):
                _part("sphere", ax, y + (c - 1) * 22.0 * s, az + 8.0 * s,
                      0.30 * s, 0.26 * s, 0.24 * s,
                      ("foliage", "foliage_deep", "foliage_hi")[(i + c) % 3],
                      "%s_ivy%d_%d" % (label, i, c))
            # roses and leaves ON the curve, both faces
            if i % 2 == 0:
                _part("sphere", ax, y + 30.0 * s, az + 14.0 * s, 0.40 * s, 0.40 * s, 0.40 * s,
                      "rose" if i % 3 else "rose_pink", "%s_rose%d" % (label, i))
                _part("sphere", ax, y - 30.0 * s, az + 10.0 * s, 0.30 * s, 0.30 * s, 0.30 * s,
                      "petal_pink", "%s_roseb%d" % (label, i))
            # blossom hanging BELOW the span. The reference's arch drips — it is
            # what tells you the thing is planted rather than painted, and it
            # softens the hard inner edge of the opening.
            if i % 3 == 1:
                for d in range(3):
                    _part("sphere", ax + (d - 1) * 10.0 * s, y - 6.0 * s,
                          az - 28.0 * s - d * 20.0 * s,
                          (0.20 - 0.04 * d) * s, (0.20 - 0.04 * d) * s,
                          (0.23 - 0.04 * d) * s,
                          ("petal_violet", "rose_pink", "petal_pink")[(i + d) % 3],
                          "%s_drip%d_%d" % (label, i, d))
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

    _DOG_POS = []

    def stroll_dog(x, y, label, s=1.2, body="dog_body", roam=800.0, is_hero=False, accessory="none",
                   keep_out=None, attends=None, upright=0, eyes="dog_eye"):
        # Spawn the LOCOMOTION actor. The Dog's BODY is now built in C++ (BuildBody),
        # NOT attached here — that is what lets the Head and Tail be animated (idle
        # look-around + walk nod on the head, a wagging tail). The generator only
        # spawns, sizes (actor scale = s) and colours (CoatName) it. The whole Dog
        # travels + turns as one unit; the material breathe/WPO keeps it alive on top.
        # THE KEEP-OUT HAS TO MOVE THE DOG, NOT JUST DESCRIBE IT.
        #
        # keep_out was passed down and set as KeepOutCentre/KeepOutRadius on the
        # C++ actor -- runtime properties that constrain where a Dog ROAMS to.
        # The SPAWN point was never touched. So a companion authored inside the
        # arrival keep-out was still built there, and the composition report
        # measured exactly that: a companion at 350 px tall owning 7.75% of the
        # hero frame, against the hero Dog's 1.4%. The arrival shot had two
        # subjects and the larger one was not the Dog it is composed around.
        #
        # Pushed out along its own bearing from the camera, so the authored
        # arrangement -- which Dog is on which side -- survives and only the
        # distance changes. The hero passes keep_out=None and is exempt by
        # design: it is the subject, and standing it outside its own shot would
        # be the cure killing the patient.
        if keep_out is not None:
            _kc, _kr = keep_out
            _dx, _dy = x - _kc[0], y - _kc[1]
            _d = math.hypot(_dx, _dy)
            if _d < 1.0:
                _dx, _dy, _d = 0.0, 1.0, 1.0
            if _d < _kr:
                _f = _kr / _d
                x, y = _kc[0] + _dx * _f, _kc[1] + _dy * _f
                unreal.log_warning(
                    "DOG KEEP-OUT: %s was %.0f uu from the arrival camera "
                    "(minimum %.0f) - moved out along its own bearing"
                    % (label, _d, _kr))
        cls = unreal.load_class(None, "/Script/Wonderland.WonderlandStrollingDog")
        if not cls:
            # THIS BRANCH USED TO `return`, AND THAT IS HOW EIGHT RELAY DOGS
            # DISAPPEARED. load_class returns None for a class that does not
            # exist rather than raising, so a missing C++ class produced one
            # warning in a log nobody reads and a world with no Dogs in it —
            # including the hero Dog the arrival camera is composed around.
            #
            # A Dog that cannot walk is still a Dog. Placing the static body
            # means the failure is VISIBLE in the frame as a Dog that does not
            # move, instead of invisible as a Dog that is not there.
            unreal.log_error(
                "WonderlandStrollingDog is not in this build — placing %s as "
                "STATIC geometry. The Dog will be visible and will not move. "
                "Compile the C++ module; verify-generator-classes.py catches "
                "this without an engine." % label)
            kit_dog(x, y, label, s=s * 1.3, body=body)
            return
        stroller = actors.spawn_actor_from_class(cls, unreal.Vector(x, y, 0.0), unreal.Rotator())
        if stroller is None:
            unreal.log_error("spawn of %s returned nothing — placing static geometry" % label)
            kit_dog(x, y, label, s=s * 1.3, body=body)
            return
        stroller.set_actor_label(label + "_stroll")
        stroller.set_actor_scale3d(unreal.Vector(s, s, s))
        # EVERY DOG'S POSITION, RECORDED. The founder cannot see the upright
        # Dogs, and verify-visual-target agrees: relay_dogs_readable reads 2
        # against a required 3. The cause is the density that was just added --
        # 560 carpet pieces and six ornament rings went in around them and
        # buried them. A Dog the camera cannot pick out is not in the world as
        # far as anyone looking at it is concerned.
        _DOG_POS.append((float(x), float(y)))
        set_prop(stroller, "HomeLocation", unreal.Vector(x, y, 0.0))
        set_prop(stroller, "RoamRadius", float(roam))
        set_prop(stroller, "bIsHero", bool(is_hero))
        # FName properties, so they are handed unreal.Name rather than str:
        # set_prop swallows a type mismatch with a warning, and a Dog quietly
        # wearing the default white coat is exactly the kind of "it looks fine"
        # failure this file has had too many of.
        set_prop(stroller, "CoatName", unreal.Name(body))
        set_prop(stroller, "Accessory", unreal.Name(accessory))
        # WHICH DOGS STAND. WonderlandStance::EUprightRole -- 0 none, 1 hero,
        # 2 working, 3 ceremonial, 4 special skin. Zero is the default and the
        # founder's rule: quadruped CLASSIC / RELAY OG stays the canonical spawn
        # identity, so a Dog stands only where something asks for it.
        if int(upright):
            set_prop(stroller, "UprightRole", int(upright))
        # The eyes are part of the skin. Gold is canonical and stays the
        # default; only a variant that asks for something else changes them.
        if eyes and eyes != "dog_eye":
            set_prop(stroller, "EyeName", unreal.Name(eyes))
        if keep_out is not None:
            # The HERO Dog is exempt on purpose: it is the arrival composition's
            # SUBJECT and stands 927 uu from the lens by design. Excluding it
            # from its own shot would be the cure killing the patient.
            _kc, _kr = keep_out
            set_prop(stroller, "KeepOutCentre", unreal.Vector(_kc[0], _kc[1], 0.0))
            set_prop(stroller, "KeepOutRadius", float(_kr))
        if attends is not None:
            # WHICH Dogs work is decided here; WHETHER they work is decided by
            # Relay. A Dog with an Avatar still does nothing until the Avatar's
            # mission state says something is happening.
            set_prop(stroller, "AttendTarget", attends)
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
            return (-980.0, 60.0, -760.0, 66.0)
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
        return (ey + near, ex, ey, math.degrees(fov_h))

    NEAR_Y, _CAM_X, _CAM_Y, _FOV_H = _hero_ground_band()

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
        costs a few draws and misleads nobody.

        LATERAL POSITION DECIDES AS MUCH AS DEPTH, and testing only `py` cost
        the frame its authored right-edge repoussoir. The Great Framing Tree
        is a PRIMARY, sightlineHero landmark at (1300, 470) -- but 470 is
        inside NEAR_Y + 600, so a Y-only test suppressed it and the layout's
        declared "giant-tree composition" was never built at all. At its own
        depth the frame is 1052 uu wide to each side and the tree stands at
        1300: it is OUTSIDE the frame edge, which is exactly where a
        repoussoir belongs and the one place a tall object cannot block the
        view.

        So the blind foreground is now what the words mean -- close in depth
        AND in front of the lens. Anything past the frame's own half-width at
        its depth can only intrude with its canopy, which is the framing the
        composition asks for."""
        if py >= NEAR_Y + margin:
            return False
        depth = py - _CAM_Y
        if depth <= 1.0:
            return True                      # at or behind the lens
        half_w = depth * math.tan(math.radians(_FOV_H * 0.5))
        return abs(px - _CAM_X) < half_w

    # WHERE THE HERO DOG STANDS, AND THE GROUND IT STANDS ON. Nothing that
    # grows gets planted here: a subject knee-deep in blossom is not staged, it
    # is camouflaged.
    # ONE definition of where the hero Dog stands, used both to clear the
    # ground for it and to place it. These were two separate constants and
    # moving the Dog without moving its clearing would stand it in a flower bed.
    #
    # It was at (60, -760) at scale 2.1 — 75% larger than a standard Dog, 1,290
    # uu from the camera — which put it at 65.5% of frame height, dead centre,
    # covering the plaza and most of the route to the gate. The brief asks for
    # the Dog PROMINENT IN THE FOREGROUND and separately forbids a giant object
    # blocking the view, and at that staging the second was beating the first.
    # Looking at the projected frame rather than the numbers made it obvious in
    # a way three sessions of measurement had not.
    #
    # Now: further back onto its own arcane circle — which is the beat, the Dog
    # standing on its Relay identity.
    #
    # AND ON THE CAMERA AXIS. This said "off dead centre so the boulevard still
    # leads the eye past it to the gate", and that reasoning is superseded by
    # the founder's reference image, which is the arbiter here: in it the white
    # voxel Dog stands DEAD CENTRE on the violet circle and the path runs
    # BEHIND it to the arch. Measured against the arrival camera, x=-260 put the
    # Dog at 27.5% of frame width -- far enough off-axis that a companion Dog at
    # 73% read as the subject instead, at 9.9% of the frame against the hero's
    # 1.4%. The composition had two subjects and neither was the hero.
    #
    # x=-40 lands it at 48.3%: centred, with the hint of leftward offset the
    # reference itself has. The arcane circle follows automatically -- kit_plaza
    # takes HERO_DOG as its circle centre -- and so does the ground clearing.
    # AND BACK OFF THE LENS. Centring it exposed the other half of the problem:
    # at y=-260 (890 uu from the camera) at scale 1.75 the Dog stood 350 px tall
    # in a 450 px frame -- 78% of frame height, against roughly 30% in the
    # founder's reference -- so once it was centred it stopped being the subject
    # of the composition and became a wall across the middle of it. The measured
    # palette said the same thing from the other side: cream_white went 0.9% ->
    # 2.2% against the reference's 0.4%, and that is the Dog.
    #
    # In the reference the Dog stands mid-ground ON the circle with PAVING
    # visible in front of it. Depth 1600 and scale 1.40 put it at about 35% of
    # frame height and open the plaza between the camera and the Dog, which is
    # the ground the frame has never had -- 0.1% of it was bare.
    HERO_DOG = (-40.0, 450.0)
    HERO_DOG_SCALE = 1.40
    # WHERE THE WORLD OPENS FROM. HeroCam0 and HeroCam6 both stand here — the
    # Marble backdrop is anchored at this exact point, which is why the wide
    # arrival shares the position and changes only the aim. Named once because
    # two things now need it: the cameras, and the companions' keep-out.
    ARRIVAL_CAM = (0.0, -1150.0, 430.0)
    # Companions roam 1,100 uu around homes that can sit 1,350 uu from that
    # camera, so one can stand 250 uu from the lens. At that range a Relay Dog
    # is a white wall across the frame and the castle city the shot exists to
    # present is behind it — which is what every hero capture in this session
    # came back as.
    #
    # THE LAST CLAUSE OF THAT SENTENCE WAS THE BUG. It read "nothing else
    # should come closer than the plaza itself", and then set a radius of 1,150
    # — INSIDE the plaza, whose paving reaches 1,340 uu. So the rule pushed
    # every offender to a circle drawn across the middle of the courtyard and
    # called the courtyard cleared. Measured on the hero frame with the four
    # landmarks parked on that circle: the bottom third of the shot was 100.0%
    # covered by objects and 11.6% of it was walkable surface. The founder's
    # reference is a plaza; this was a hedge maze at knee height.
    #
    # Four landmarks were inside the old keep-out and all four were pushed onto
    # the same circle, which is its own failure — a ring of props at one radius
    # reads as a barricade, not as a garden. Pushing along each object's OWN
    # bearing is what stops that, and it is why the rule moves distance only.
    #
    # 2,050 uu clears the paving with room for the setts to read, and lands the
    # pushed landmarks at the plaza RIM, which is exactly where the reference
    # puts its planting: flowers and caps gathered at the edge of the stone,
    # open floor in the middle with the Dog standing on it.
    ARRIVAL_KEEP_OUT = 2050.0
    # 560 -> 860. The reference's Dog stands in CALM: a clear apron of stone
    # around it and the circle, with the planting banked beyond. Ours was
    # standing at the edge of its own keep-clear with mushroom caps and tufts
    # starting 560 uu out — inside the arcane circle's new 520 uu rim. A subject
    # is staged by what is NOT next to it.
    DOG_STAGE = (HERO_DOG[0], HERO_DOG[1], 860.0)

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
        # 2,300, matching the paving course that now reaches 2,412 uu. It was
        # 1,180 against a 1,340 uu course, so a 160 uu ring of stone was fair
        # game for planting even before the floor was widened.
        if math.hypot(gx, gy) < 2300.0:
            return True
        return abs(gx) < 300.0 and -1150.0 < gy < 1250.0

    def _off_paving(gx, gy, h=0):
        """The same rule, applied by MOVING rather than by rejecting.

        `_on_paving` was written to keep planting off the stone and three passes
        ask it. The FOREGROUND PLANTING pass — 96 beds, their shrubs and their
        mushroom clumps, the densest planting in the world and the only planting
        the hero camera sees close up — never did. So the courtyard the
        reference is a third made of was under a bed of flowers, and every
        attempt to make the plaza read failed because the plaza was never the
        thing in the way.

        Rejecting them would empty the near field, which is the other half of
        the same mistake: a rule that prevents the wrong thing does not produce
        the right one. The reference banks its flowers at the LEFT AND RIGHT
        EDGES of the stone and leaves the middle open, so this pushes each
        placement out along its own bearing to just past the paving, with a
        hash-derived margin so the result is a verge and not a ring."""
        if not _on_paving(gx, gy):
            return gx, gy
        margin = 40.0 + ((h >> 5) % 420)
        r = math.hypot(gx, gy)
        if r > 1.0 and math.hypot(gx, gy) < 2300.0:
            f = (2300.0 + margin) / r
            gx, gy = gx * f, gy * f
        # the boulevard is a straight band, so leaving it is a sideways move
        if abs(gx) < 300.0 and -1150.0 < gy < 1250.0:
            gx = math.copysign(320.0 + margin * 0.5, gx if gx else 1.0)
        return gx, gy

    def _off_paving_lateral(gx, gy, h=0):
        """Off the stone SIDEWAYS, holding depth.

        `_off_paving` pushes along the bearing from the plaza centre, which is
        right for a landmark — it preserves the authored arrangement and only
        changes the distance. It is wrong for a SCATTER. Applied to the 96
        foreground beds it moved every one of them to very nearly the same
        radius, and a hundred beds at one radius is the barricade the ornament
        rings were just rebuilt to stop being: the near field grew a hedge band
        straight across the bottom of the hero frame.

        A verge follows the edge of the paving at EVERY depth. Holding gy and
        moving gx outward does exactly that — the planting keeps the depth
        spread it was given, banks to the left and right of the walk, and
        leaves the middle of the stone open, which is the reference's
        arrangement."""
        if not _on_paving(gx, gy):
            return gx, gy
        margin = 30.0 + ((h >> 5) % 340)
        side = 1.0 if gx >= 0.0 else -1.0
        need = 0.0
        if abs(gy) < 2300.0:
            need = math.sqrt(2300.0 * 2300.0 - gy * gy)
        gx = side * (max(abs(gx), need) + margin)
        if abs(gx) < 300.0 and -1150.0 < gy < 1250.0:
            gx = side * (320.0 + margin)
        return gx, gy

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
        # A BOULDER IS FACETED. Measuring which objects actually own pixels
        # after occlusion, two rocks landed in the ten most visible things in
        # the hero frame — ahead of the gate's pillars. They were ONE squashed
        # sphere each, which is a raw primitive sitting in the near field where
        # the eye is sharpest, and no amount of work on the distant skyline
        # compensates for that.
        #
        # Rock reads by its PLANES: a boulder is a few large flat faces meeting
        # at hard edges, with the weathering in the joints rather than over the
        # whole surface. Stacked, rotated slabs give those planes; the sphere
        # stays underneath as the mass they clad.
        _part("sphere", x, y, d * 24.0, d * 0.86, d * 0.86, d * 0.58, "stone",
              "rock_%d" % i, rot=(0.0, (i * 47) % 360, (i * 23) % 26))
        for _f in range(4):
            _fa = _f * 1.5708 + (i * 0.7)
            _fr = d * 15.0 * (0.7 + ((i * 13 + _f * 7) % 5) * 0.12)
            _part("cube", x + math.cos(_fa) * _fr, y + math.sin(_fa) * _fr,
                  d * (16.0 + (_f % 3) * 7.0),
                  d * (0.52 + (_f % 3) * 0.11), d * (0.46 + (_f % 2) * 0.14),
                  d * (0.34 + (_f % 3) * 0.10), "stone",
                  "rock%d_face%d" % (i, _f),
                  rot=(float((i * 11 + _f * 23) % 34) - 17.0,
                       math.degrees(_fa) + ((i * 5) % 20),
                       float((i * 17 + _f * 13) % 28) - 14.0))
        # a capping slab, tilted, so the top is not a dome
        _part("cube", x + d * 3.0, y - d * 2.0, d * 34.0, d * 0.74, d * 0.66, d * 0.26,
              "stone", "rock%d_cap" % i,
              rot=(float((i * 29) % 22) - 11.0, float((i * 41) % 360), float((i * 7) % 18) - 9.0))
        # WEATHERING LIVES IN THE JOINTS. Moss on the shaded north side and in
        # the seams, not sprayed evenly over the stone — an evenly mossy rock
        # reads as a green rock.
        for _m in range(3 + (i % 3)):
            _ma = 2.2 + _m * 0.9 + (i * 0.3)
            _part("sphere", x + math.cos(_ma) * d * 13.0, y + math.sin(_ma) * d * 13.0,
                  d * (12.0 + (_m % 2) * 9.0), d * 0.24, d * 0.24, d * 0.12,
                  "moss", "rock%d_moss%d" % (i, _m))
        if i % 2 == 0:
            _part("cube", x + 22.0, y - 16.0, d * 18.0, d * 0.6, d * 0.6, d * 0.5, "stone",
                  "rockb_%d" % i, rot=(14.0, (i * 31) % 360, 0.0))

    def kit_vine(x, y, top_z, drop, label, i=0):
        """A hanging wisteria-and-rose cascade.

        WHAT IT WAS: one cylinder of radius 4 uu running the whole drop, four
        22 uu leaves and a single bloom at the tip. Measured in the hero frame,
        two of these were among the most visible objects in the world — 28 px
        wide and 584 px tall, a bare dark POLE standing 65% of the frame's
        height. That is the "prototype geometry" the art direction asks to have
        replaced, and no amount of material work rescues a wire.

        A real cascade is dense at the top where it springs from its host and
        thins to a point, it CURVES rather than hanging plumb, and its flowers
        are strung along it rather than tied to the end. So: overlapping leaf
        clusters on a drifting centre-line, in three greens so the strand has an
        inside and an outside, blossom trusses at intervals, and side tendrils.
        The stem survives but is thin and buried, which is what a stem does."""
        # NODE SPACING DECIDES WHETHER IT IS FOLIAGE OR A STRING OF BEADS.
        # The first rebuild used 9 nodes over a 520 uu drop — 65 uu apart, with
        # clusters 30-46 uu across — so the gaps between them were bigger than
        # the leaves and the strand read as a column of stacked discs. Sixteen
        # nodes at 35 uu with clusters half again as large overlap, and overlap
        # is the whole difference.
        n = 16
        # a lazy curve, deterministic per strand, so no two hang the same way
        sway_x = 26.0 + 16.0 * ((i * 7) % 3)
        sway_y = 14.0 * (1 if i % 2 else -1)
        prev = None
        for k in range(n):
            t = k / float(n - 1)
            # dense at the shoulder, tapering to a point: a cascade is a wedge
            grow = 1.0 - 0.62 * t
            zz = top_z - drop * t
            cx = x + math.sin(t * 2.4 + i) * sway_x * t
            cy = y + math.cos(t * 1.7 + i) * sway_y * t
            # the strand itself, a short segment leaning toward the next node
            if prev is not None:
                _part("cylinder", (cx + prev[0]) * 0.5, (cy + prev[1]) * 0.5,
                      (zz + prev[2]) * 0.5, 0.05, 0.05, drop / 100.0 / (n - 1) * 1.3,
                      "trunk" if "trunk" in MATS else "foliage",
                      "%s_stem%d" % (label, k))
            prev = (cx, cy, zz)
            # LEAF CARDS, NOT BEADS.
            #
            # This was three spheres in a rosette at every node, and in the
            # native render it reads exactly like what it is: a stack of pale
            # ellipsoids, a string of beads hanging in the air. The art
            # direction's word for that is "toy-like", and no material or light
            # rescues a form that is wrong — a leaf is FLAT and hangs at its own
            # angle, and a hundred flat things at a hundred angles is what makes
            # a cascade read as foliage.
            #
            # The leaf materials are alpha-masked (the leaf master samples
            # LeafMask and clips on it), so a thin card is a leaf-shaped hole in
            # a rectangle rather than a rectangle. Four per node, each yawed to
            # its own bearing and pitched to droop, with a small dark core so
            # the strand keeps mass where the cards overlap.
            #
            # The rotation tuple is (pitch, yaw, roll) — the order
            # WonderlandInstancedBatch reads and the one the clocks were built
            # against wrongly today. Yaw is the second slot.
            _leafmats = (("leafcard", "leafcard_hi", "leafcard_deep")
                         if "leafcard" in MATS
                         else ("foliage", "foliage_hi", "foliage_deep"))
            _part("sphere", cx, cy, zz, 0.17 * grow, 0.17 * grow, 0.15 * grow,
                  "foliage_deep", "%s_core%d" % (label, k))
            for c in range(4):
                a = c * 1.5708 + t * 3.1 + i
                _part("cube",
                      cx + math.cos(a) * 26.0 * grow,
                      cy + math.sin(a) * 26.0 * grow,
                      zz - 5.0 * c,
                      (0.36 + 0.11 * (c % 2)) * grow,
                      0.035 * grow,
                      (0.27 + 0.09 * ((c + k) % 2)) * grow,
                      _leafmats[(k + c) % 3],
                      "%s_leaf%d_%d" % (label, k, c),
                      rot=(16.0 + 15.0 * (c % 3), math.degrees(a), 0.0))
            # blossom trusses strung ALONG the strand, hanging below their node
            if k % 3 == 1:
                for b in range(3):
                    _part("sphere", cx + (b - 1) * 12.0, cy + 5.0,
                          zz - 22.0 - b * 15.0,
                          (0.22 - 0.05 * b) * grow, (0.22 - 0.05 * b) * grow,
                          (0.26 - 0.05 * b) * grow,
                          ("petal_violet", "rose_pink", "petal_pink")[(i + b) % 3],
                          "%s_truss%d_%d" % (label, k, b))
            # a tendril curling off, which is what stops a cascade reading as a
            # column of beads
            if k % 4 == 2:
                for tdl in range(3):
                    _part("sphere", cx + 30.0 + tdl * 15.0,
                          cy - 8.0 * tdl, zz - 10.0 - tdl * 16.0,
                          0.14 * grow, 0.14 * grow, 0.12 * grow,
                          "foliage_spr", "%s_tendril%d_%d" % (label, k, tdl))
        # the terminal bloom, still there, now the end of something
        _part("sphere", prev[0], prev[1], prev[2] - 14.0, 0.26, 0.26, 0.30,
              "rose" if i % 2 else "petal_pink", "%s_bloom" % label)

    # ---- THE LAYOUT DECLARES A HEIGHT. HONOUR IT. ------------------------
    # All 19 landmarks carry dimensionsUu and the generator consulted it in
    # exactly one place (golden_gate, after that gate was measured at 1.55x its
    # spec). Measuring the other eighteen the same way found the same bug
    # everywhere: rose_arch built 2.61x its declared height, overlook_terrace
    # 2.56x, clock_tower 2.00x, the Great Framing Tree 2.54x -- while the
    # teacups came out at 0.42x and the portrait at 0.48x. Oversized props
    # crowd the frame's top third; undersized ones read as clutter instead of
    # the tea-party landmarks the reference is full of.
    #
    # Each kit has a fixed height at s=1.0. Those numbers are MEASURED from the
    # offline actor dump, not guessed, and verify-landmark-scale.py re-measures
    # every one of them on each run -- so if a kit's proportions change, the
    # gate fails instead of the frame quietly going wrong again.
    _KIT_INTRINSIC_H = {
        "arch": 621.0, "clock_tower": 1940.0, "tree_giant": 2103.0,
        "pergola": 366.0, "overlook": 205.0, "topiary": 480.0,
        "teacup": 146.0, "mushroom": 237.0, "portrait": 179.0,
        "standing_stone": 259.0,
    }

    def _kit_scale(m, kit, fallback, lo=0.3, hi=3.0):
        """Scale that makes `kit` reach the height the layout declares for `m`."""
        intrinsic = _KIT_INTRINSIC_H.get(kit, 0.0)
        dims = m.get("dimensionsUu")
        if not intrinsic or not dims or len(dims) < 3:
            return fallback
        try:
            target = float(dims[2])
        except (TypeError, ValueError):
            return fallback
        if target <= 0.0:
            return fallback
        return max(lo, min(hi, target / intrinsic))

    def _push_out_of_lens(px, py, what=""):
        """Move a point out of the arrival camera's blind foreground.

        ONE RULE, because it kept being written per-call-site and then not
        written at all. It was fixed for the drifting keys, and four LANDMARKS
        were sitting inside the same keep-out unfixed:

            playing_card_sign        624 uu from the lens
            mushroom_red_a           736
            overlook_terrace        1035
            project_standing_stones 1057

        Those distances are as authored, and all four are still inside the
        keep-out — it is now 2,050 uu rather than 1,150, because 1,150 was
        inside the plaza it was supposed to clear. The belvedere over the
        overlook terrace was ALSO in the lens at 960 uu and was not asking this
        rule at all, which is the per-call-site failure the docstring opens by
        naming, committed again.

        mushroom_red_a is the one that showed. At 736 uu, built to its declared
        360 uu, it stood 1.57x the frame HEIGHT and measured 16.1% of the bottom
        38% of the frame on its own -- more than every ground material together.
        The founder's reference does have a big cap cropped by the right edge;
        it does not have one filling the plaza.

        Lateral position decides, exactly as in_camera_lap decides it: something
        past the frame's own half-width at its depth is beside the shot, not in
        front of it, and is left alone. Everything else is pushed out along its
        own bearing, so the authored arrangement survives and only the distance
        changes.
        """
        dx, dy = px - ARRIVAL_CAM[0], py - ARRIVAL_CAM[1]
        r = math.hypot(dx, dy)
        if r >= ARRIVAL_KEEP_OUT or r < 1.0:
            return px, py, False
        depth = py - ARRIVAL_CAM[1]
        if depth > 1.0:
            half_w = depth * math.tan(math.radians(_FOV_H * 0.5))
            if abs(px - ARRIVAL_CAM[0]) >= half_w:
                return px, py, False
        f = ARRIVAL_KEEP_OUT / r
        return ARRIVAL_CAM[0] + dx * f, ARRIVAL_CAM[1] + dy * f, True

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
        x, y, _moved = _push_out_of_lens(x, y, mid)
        if _moved:
            unreal.log_warning(
                "LANDMARK KEEP-OUT: %s was inside the %.0f uu arrival keep-out "
                "and was pushed out along its own bearing" % (mid, ARRIVAL_KEEP_OUT))
        sc = m.get("scale", [1, 1, 1])
        raw = max(0.6, (float(sc[0]) + float(sc[1])) / 2.0) if isinstance(sc, list) else 1.0
        norm = min(1.6, max(0.75, raw / 3.2))
        # THE LAYOUT DECLARES A HEIGHT AND THE BUILDER IGNORED IT.
        #
        # hub-layout.json gives golden_gate dimensionsUu [700, 220, 640] and a
        # note calling it "~6.4 m tall, left repoussoir of the arrival frame".
        # This call site passed a hardcoded 1.4, which builds it 994 uu — 1.55x
        # its own spec — and that difference is the top of the frame.
        #
        # kit_gate's keystone tops out near 710*s. At s=1.4 the gate reaches
        # +20.8 degrees of elevation from the arrival camera, inside the top
        # third, where it owns 10.2% of it. At the DECLARED 640 uu it tops out
        # at +9.4 degrees, the exact bottom edge of the top third. The layout
        # was right and nothing was reading it.
        if mesh == "portrait" or "portrait" in mid:
            kit_portrait(x, y, z, _kit_scale(m, "portrait", norm * 1.15), mid)
        elif mesh == "standing_stone" or "standing_stone" in mid:
            kit_standing_stone(x, y, _kit_scale(m, "standing_stone", norm * 1.1), mid)
        elif mesh == "gate" or "gate" in mid:
            _dims = m.get("dimensionsUu") or []
            _target_h = float(_dims[2]) if len(_dims) >= 3 else 640.0
            _gs = max(0.4, min(2.0, _target_h / 710.0))
            unreal.log_warning(
                "GATE %s: declared %.0f uu -> scale %.2f (hardcoded 1.4 built %.0f uu)"
                % (mid, _target_h, _gs, 710.0 * 1.4))
            kit_gate(x, y, _gs, mid)
        elif "framing_tree" in mid:
            if not in_camera_lap(x, y, 600.0):
                kit_tree(x, y, _kit_scale(m, "tree_giant", 1.7), mid, giant=True)
        elif mesh == "tree" or "tree" in mid or "topiary" in mid:
            kit_tree(x, y, norm, mid)
        elif mesh == "mushroom" or "mushroom" in mid:
            kit_mushroom(x, y, _kit_scale(m, "mushroom", min(1.4, max(0.9, norm))), mid,
                         "mush_purple" if "purple" in mid else "mush_red")
        elif mesh == "spire" or "spire" in mid or "castle" in mid:
            kit_spire(x, y, min(1.5, max(0.9, norm)), mid)
        elif "teacup" in mid:
            kit_teacup(x, y, _kit_scale(m, "teacup", norm), mid)
        elif mid == "brain_landmark" or mesh == "brain":
            kit_observatory(x, y, z, mid)
        elif mesh == "arch" or "arch" in mid:
            # WIDER, so its posts stand on the verges rather than in the way.
            # An arch frames by being something you look THROUGH; at the old
            # span its uprights were exactly where the eye wanted to travel.
            kit_arch(x, y, _kit_scale(m, "arch", 1.85), mid)
        elif "overlook" in mid or "terrace" in mid:
            kit_overlook(x, y, _kit_scale(m, "overlook", min(1.5, max(0.9, norm))), mid)
        elif "pergola" in mid:
            kit_pergola(x, y, _kit_scale(m, "pergola", min(1.5, max(0.9, norm))), mid)
        elif "teapot" in mid:
            kit_teapot(x, y, max(400.0, z), mid)
        elif "sign" in mid or "card" in mid:
            kit_sign(x, y, mid)
        elif "clock_tower" in mid or "tower" in mid:
            # 1.6 ran it out of the top of the hero frame and put it shoulder to
            # shoulder with the Golden Build Gate. A landmark that leaves the
            # frame stops being a landmark and becomes a wall.
            kit_clock_tower(x, y, _kit_scale(m, "clock_tower", 0.62), mid)
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
    # ---- TASK 1: A GOLDEN-HOUR KEY THAT THROWS RAYS AND TOUCHES DOWN --------
    #
    # Three properties this light has never had, each answering a line of the
    # brief and each visible in the reference:
    #
    #   TEMPERATURE — "golden hour (warm ~4500K tint)". A colour multiplier was
    #     doing this job approximately; the temperature control does it in
    #     Kelvin and drives the atmosphere's sun disc with it.
    #   VOLUMETRIC SCATTERING — the shafts of light through the gate and the
    #     tree canopy. Without it the volumetric fog below is a flat wash; this
    #     is what makes it a god ray.
    #   CONTACT SHADOWS — "readable contact shadows", asked for twice. A
    #     screen-space trace that puts a Dog's paws ON the stone rather than
    #     hovering a pixel above it. Cheap, and it is the single cue that most
    #     reads as "grounded".
    set_prop(sun_comp, "bUseTemperature", True)
    set_prop(sun_comp, "Temperature", float(LOOK["sunTemperatureK"]))
    set_prop(sun_comp, "VolumetricScatteringIntensity", float(LOOK["volScatterSun"]))
    set_prop(sun_comp, "ContactShadowLength", float(LOOK["contactShadowLength"]))
    set_prop(sun_comp, "bCastVolumetricShadow", True)
    set_prop(sun_comp, "DynamicShadowDistanceMovableLight", 30000.0)

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

    # --- GROUND BOUNCE ---------------------------------------------------
    # See LOOK["bouncePitch"]. Aimed UP so it reaches only what the key and fill
    # cannot: downward-facing surfaces. Shadowless and dim — a hint of the light
    # a paved plaza throws back, not a second key. Lifting exposure instead
    # would have brightened everything the sun already reaches too, which is the
    # wash the grade spent three commits climbing out of.
    if int(LOOK["bounceEnabled"]):
        bounce = spawn(unreal.DirectionalLight, (0, 0, 400), label="GroundBounce")
        _b_rot = unreal.Rotator()
        _b_rot.set_editor_property("pitch", LOOK["bouncePitch"])
        _b_rot.set_editor_property("yaw", float(atm["sunAzimuthDeg"]) + 30.0)
        _b_rot.set_editor_property("roll", 0.0)
        bounce.set_actor_rotation(_b_rot, False)
        b_comp = bounce.get_component_by_class(unreal.DirectionalLightComponent)
        b_comp.set_mobility(unreal.ComponentMobility.MOVABLE)
        b_comp.set_intensity(_lux * float(LOOK["bounceRatio"]))
        _bw = LOOK["bounceWarm"]
        b_comp.set_light_color(srgb_light_color(
            _bw[0] * 255.0, _bw[1] * 255.0, _bw[2] * 255.0))
        set_prop(b_comp, "bCastShadows", False)
        set_prop(b_comp, "CastShadows", False)
        unreal.log_warning(
            "GROUND BOUNCE on: pitch %+.0f, %.0f lux (%.0f%% of key), warm %s"
            % (LOOK["bouncePitch"], _lux * float(LOOK["bounceRatio"]),
               float(LOOK["bounceRatio"]) * 100.0, str(_bw)))

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
            # the circle the Dog stands on — violet, low, throwing UP onto it.
            # HERO_DOG, not (0, 0): the light was at the plaza centre while the
            # Dog stood 368 uu away, so the one practical whose whole job is to
            # put violet on the hero was pooling on empty paving.
            (HERO_DOG[0], HERO_DOG[1], 150.0, (176, 108, 255), 1.00, "HeroLight_Arcane"),
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
                _hc.set_light_color(srgb_light_color(*_hcol))
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
        # THE SKY WENT BLACK WHEN THE SUN CAME DOWN, and 0.0331 is why.
        #
        # It is Unreal's physical default, and a physical default is calibrated
        # for a physical sun — around 100,000 lux — with an auto-exposure that
        # adapts to it. This scene has neither: the exposure is FIXED (proven
        # today, six stops of r.AutoExposure.Bias move the frame 0.03 luma) and
        # the sun is now 1,150 lux. At that illuminance the atmosphere scatters
        # about a hundredth of what it would at noon, so the dome renders very
        # nearly black and the frame reads as NIGHT with the ground lit.
        #
        # Scattering scale is the right lever precisely because it is the ONE
        # that separates the two: it changes how much light the atmosphere sends
        # to the camera without changing how much the sun sends to the ground.
        # Raising the sun instead would blow the ground back out, which is the
        # loop this has already been round twice.
        set_prop(sac, "RayleighScatteringScale", 0.115)
        # Multiple scattering is what makes a real sky bright away from the sun
        # and fills shade with blue. At the default it contributes almost
        # nothing here for the same reason.
        set_prop(sac, "MultiScatteringFactor", 2.4)
        # LAVENDER, BY BLEND. See LOOK["skyLavender"]. The physical default is
        # kept as one end of the blend so 0.0 is exactly today's sky, and the
        # TOTAL is held near the default's sum so the sky changes hue without
        # changing how much light the atmosphere scatters -- which is what
        # turned the previous attempt into a twilight.
        try:
            _sl = max(0.0, min(1.0, float(LOOK["skyLavender"])))
        except (TypeError, ValueError):
            _sl = 0.0
        if _sl > 0.0:
            _def = (0.0058, 0.0136, 0.0331)
            _lav = (0.0225, 0.0205, 0.0331)      # R and G lifted to near-parity
            _mix = tuple(_def[i] * (1.0 - _sl) + _lav[i] * _sl for i in range(3))
            _norm = sum(_def) / max(1e-6, sum(_mix))
            _mix = tuple(c * _norm for c in _mix)
            if set_prop(sac, "RayleighScattering",
                        unreal.LinearColor(_mix[0], _mix[1], _mix[2], 1.0)):
                unreal.log_warning(
                    "SKY LAVENDER %.2f: Rayleigh (%.4f, %.4f, %.4f), total held "
                    "at the physical default" % ((_sl,) + _mix))
            else:
                unreal.log_warning(
                    "SKY LAVENDER asked for %.2f but RayleighScattering did not "
                    "take - the sky is unchanged, read it as the old blue" % _sl)
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
        # THE SCALE IS THE WHOLE POINT. This world is a few hundred metres across,
        # real air does almost nothing over that, and the honest setting produced
        # a castle exactly as crisp as a foreground mushroom. Stretching the
        # optical depth is the instrument the previous five attempts were
        # reaching for when they kept reaching for fog and kept repainting the
        # sky instead.
        #
        # THE DISTANCE IN THIS COMMENT WAS WRONG AND THE VALUE IS NOT BEING
        # CHANGED FOR IT. It said "the great castle is 420 m out ... 45x makes
        # 420 m behave like 19 km". Measured against the world that is actually
        # built: hub-layout.json puts castle_spire_1..3 at 31-32 m, and the
        # furthest thing in the world at all is the outermost procedural skyline
        # ring at 195 m. Nothing is at 420 m. So 45x is stretching 195 m to about
        # 8.8 km, not 420 m to 19 km — roughly half the haze the comment claims.
        #
        # The NUMBER stays because it was landed on by looking at frames, and
        # this session cannot look at a frame. Retuning a value that was set by
        # eye, using arithmetic, without a render, is how the last five attempts
        # went. The real distances are written down here so whoever next has a
        # GPU can judge it with them.
        # 45 -> 4. MEASURED ON A FRAME, which is what the note above says this
        # number was waiting for.
        #
        # Attributing the hero frame's tower band pixel-by-pixel to the object
        # that owns each one:
        #
        #     roof_rose   27.6% of the band   renders (155,155,170)  sat 0.09
        #     roof_pink   13.1%               renders (118,110,117)  sat 0.07
        #     spire_far    5.6%               renders (125,120,120)  sat 0.04
        #
        # roof_rose is authored (0.78, 0.38, 0.44) -- a rose, saturation 0.51 --
        # and it renders a blue-grey whose hue is the SKY's. That is not a
        # material defect. It is AERIAL PERSPECTIVE, and it applies to the scene
        # after shading, which is why making the master unlit did not rescue it
        # and why fourteen material theories could not find it.
        #
        # At 45x the skyline at 310 m behaves like roughly 14 km of atmosphere,
        # so the towers are fully faded into the sky. At 4x it is about 1.2 km:
        # distance still recedes and colour still survives the journey.
        # 4.0 -> LOOK["aerialScale"], default 11.0.
        #
        # 4.0 was chosen when the sky rendered as a dark navy band and the
        # towers were already washing out into it; more haze then meant losing
        # the skyline entirely, and the note above is an honest record of that.
        # The sky is blue now and the frame is exposed two stops lower, so the
        # constraint that set this number no longer exists.
        #
        # The founder's list asks for "atmospheric haze/fog", "distance haze"
        # and "background reduced contrast through atmosphere", and the
        # reference has all three plainly: its far castles are paler and softer
        # than its near ones, which is most of why it reads DEEP. Ours are as
        # crisp at 80 km as the gate is at 2 km.
        #
        # By this block's own arithmetic the skyline behaves like 1.2 km of air
        # at 4x; 11x makes it about 3.4 km. Sweepable, because every other
        # atmosphere value tonight has needed a second look once the exposure
        # moved under it.
        for _nm in ("AerialPespectiveViewDistanceScale",
                    "AerialPerspectiveViewDistanceScale"):
            set_prop(sac, _nm, float(LOOK["aerialScale"]))
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
            # 0.90 was chosen from a CPU trace that found the 0.42-1.15 range
            # "flat, not a cliff". That trace measured luma spread, not the
            # COUNT of pixels below the shadow threshold — and the streamed
            # frame is 40.7% below it. Ambient is what reaches surfaces the
            # sun and fill never touch, which is precisely what those pixels
            # are, so it goes up with the ground bounce.
            # See LOOK["skyIntensity"]. The sky is what makes a shadow cool,
            # and cool shadow is what lets a white stay white and a pink stay
            # pink where the sun does not reach.
            sky_comp.set_intensity(float(LOOK["skyIntensity"]))
        except Exception:
            pass
        # See LOOK["skyWarm"]. Without this the fill is whatever colour the
        # captured dome happens to be -- blue -- and since it is the only
        # omnidirectional light here, that colour lands on every shadowed
        # surface in Wonderland and overrides its albedo.
        try:
            _sw = LOOK["skyWarm"]
            sky_comp.set_light_color(srgb_light_color(
                int(round(255 * _sw[0])), int(round(255 * _sw[1])),
                int(round(255 * _sw[2]))))
            unreal.log_warning(
                "SKY FILL neutralised to (%.2f, %.2f, %.2f) at intensity %.2f"
                % (_sw[0], _sw[1], _sw[2], float(LOOK["skyIntensity"])))
        except Exception as _e:
            unreal.log_warning("sky light colour skipped: %s" % _e)
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
        # MINIMAL HAZE, by the founder's instruction. Fog is not allowed to be
        # the thing that hides a bad surface, and the reference's air is clear.
        # ---- TASK 1: VOLUMETRIC FOG, WITH THE CONDITION IT NEEDED ---------
        #
        # This was tried once and the note above records the result honestly:
        # "volumetric in-scatter previously flooded the frame to min-luma 226".
        # That was measured on a frame whose ground read 193 and which had
        # 0.06% of itself in shadow — in-scatter has nothing to scatter THROUGH
        # when every surface is already at the top of the range, so it can only
        # add. The scene is 106 now with 6.5% in shadow and a key that throws
        # rays, which is the condition volumetrics need to read as god rays
        # rather than as milk.
        #
        # The brief asks for "high density with a soft purple/pink tint in the
        # background, making distant castles recede in haze", and the reference
        # has exactly that: its far castles sit in lavender air.
        if int(LOOK["volFogEnabled"]):
            set_prop(fog_comp, "bEnableVolumetricFog", True)
            set_prop(fog_comp, "VolumetricFogExtinctionScale",
                     float(LOOK["volFogExtinction"]))
            _va = LOOK["volFogAlbedo"]
            set_prop(fog_comp, "VolumetricFogAlbedo",
                     unreal.Color(int(_va[0] * 255), int(_va[1] * 255),
                                  int(_va[2] * 255), 255))
            _ve = LOOK["volFogEmissive"]
            set_prop(fog_comp, "VolumetricFogEmissive",
                     unreal.LinearColor(_ve[0], _ve[1], _ve[2], 1.0))
            set_prop(fog_comp, "VolumetricFogDistance", float(LOOK["volFogDistance"]))
            # Forward-biased scattering: light carries ON through the medium
            # toward the viewer, which is what makes a shaft a shaft.
            set_prop(fog_comp, "VolumetricFogScatteringDistribution", 0.55)
            unreal.log_warning(
                "VOLUMETRIC FOG on: extinction %.2f, lavender albedo %s, %.0f uu"
                % (float(LOOK["volFogExtinction"]), str(_va),
                   float(LOOK["volFogDistance"])))
        set_prop(fog_comp, "FogDensity", 0.0004)
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
        # ---- TASK 1: LUMEN, DEPTH OF FIELD, LENS FLARE --------------------
        #
        # None of these were set. The frame has had no depth of field at all,
        # which is most of why a 1920x1080 render of a garden reads as a
        # diagram: every blade of grass at 80 metres is as sharp as the Dog's
        # visor at sixteen, and no photograph and no rendered reference looks
        # like that.
        #
        # The hero Dog is 1,600 uu from the lens, so that is the focal plane.
        # f/6 rather than wide open on purpose: this is the ESTABLISHING shot
        # and the castle city is what it exists to present, so the background
        # should go soft and stay legible.
        try:
            sset("DynamicGlobalIlluminationMethod", "dynamic_global_illumination_method",
                 unreal.DynamicGlobalIlluminationMethod.LUMEN)
            sset("ReflectionMethod", "reflection_method", unreal.ReflectionMethod.LUMEN)
        except Exception as _le:
            unreal.log_warning("Lumen method override unavailable (%s); the project "
                               "default decides GI and reflections" % _le)
        sset("LumenFinalGatherQuality", "lumen_final_gather_quality", 2.0)
        sset("LumenSceneLightingQuality", "lumen_scene_lighting_quality", 2.0)
        sset("DepthOfFieldFocalDistance", "depth_of_field_focal_distance",
             float(LOOK["dofFocalDistance"]))
        sset("DepthOfFieldFstop", "depth_of_field_fstop", float(LOOK["dofFStop"]))
        sset("DepthOfFieldFocalRegion", "depth_of_field_focal_region",
             float(LOOK["dofFocalRegion"]))
        sset("DepthOfFieldDepthBlurAmount", "depth_of_field_depth_blur_amount",
             float(LOOK["dofBlurAmount"]))
        # The brief asks for "subtle Lens Flare for glowing magical elements" —
        # subtle being the operative word, and the reason this is 0.35 and not
        # the engine default.
        sset("LensFlareIntensity", "lens_flare_intensity", float(LOOK["lensFlare"]))
        unreal.log_warning(
            "CINEMATIC DEPTH: Lumen GI + reflections, DoF f/%.1f focused at "
            "%.0f uu (the hero Dog), lens flare %.2f"
            % (float(LOOK["dofFStop"]), float(LOOK["dofFocalDistance"]),
               float(LOOK["lensFlare"])))
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

    # ---- MEADOW PATCHES -------------------------------------------------
    # The open ground is the largest single thing in the hero frame and it was
    # one flat green. Covering it in objects would be spam; what an open meadow
    # actually needs is TONE — broad, soft, overlapping areas of slightly
    # different grass, the way real turf goes pale where it is thin and deep
    # where it lies in shade.
    #
    # Placement clumps by design. Positions come from a low-frequency walk
    # rather than uniform sampling, so the patches gather into a few large
    # regions with clear ground between them; sampling uniformly produces an
    # even speckle, which is precisely the procedural tell this is meant to
    # remove. Sizes vary by a factor of four so no repeated element is legible.
    _mp = 0
    for _c in range(11):                       # a handful of REGIONS...
        _ca = _c * 2.39996
        _cr = 900.0 + ((_c * 37) % 11) / 11.0 * 5200.0
        _cx = math.cos(_ca) * _cr
        _cy = math.sin(_ca) * _cr + 900.0
        for _k in range(7 + (_c % 5)):         # ...each a cluster of patches
            _h = (_c * 73856093) ^ (_k * 19349663)
            _a = (_h % 628) / 100.0
            _d = ((_h >> 5) % 100) / 100.0
            _px = _cx + math.cos(_a) * _d * 1400.0
            _py = _cy + math.sin(_a) * _d * 1400.0
            # skip the plaza, which is paved and does not want turf on it
            if math.hypot(_px, _py) < 1500.0:
                continue
            _sz = 2.6 + ((_h >> 11) % 9) * 1.15
            _part("cylinder", _px, _py, 2.2, _sz, _sz * (0.66 + ((_h >> 17) % 5) * 0.10),
                  0.012, "ground_sun" if (_h >> 7) % 2 else "ground_shade",
                  "MeadowPatch%d" % _mp, rot=(0.0, 0.0, float((_h >> 3) % 180)))
            _mp += 1
            # a drift of wildflower riding the same clump, never on its own
            if (_h >> 19) % 3 == 0:
                for _f in range(3 + ((_h >> 21) % 4)):
                    _fa = _a + (((_h >> (_f + 2)) % 21) - 10) / 10.0 * 0.9
                    _fd = _d * 1400.0 * (0.5 + ((_h >> (_f + 6)) % 7) / 14.0)
                    _part("sphere", _cx + math.cos(_fa) * _fd, _cy + math.sin(_fa) * _fd,
                          16.0, 0.11, 0.11, 0.10,
                          ("petal_air", "rose_pink", "petal_violet",
                           "petal_pink")[(_h + _f) % 4], "MeadowFl%d_%d" % (_mp, _f))

    # ---- THE FOREGROUND BAND -------------------------------------------
    # Looking at the projected frame instead of the numbers: the bottom third
    # of the hero shot is empty. Flat paving, a few scattered petals, nothing
    # for the eye to rest on before it travels into the scene.
    #
    # And it is my own guard that did it. in_camera_lap() keeps TALL kits out
    # of the camera's blind foreground, which is right — a hedge in the lens is
    # what it was written for — but with a 250-400 uu margin it clears the
    # entire near band, and nothing was ever put back. A rule that prevents the
    # wrong thing does not by itself produce the right one.
    #
    # So the foreground gets deliberate LOW staging: everything here is capped
    # well under the height that would intrude, and placed to either side of
    # the sight line so the route through the plaza stays open. This is the
    # repoussoir the composition has been missing at the bottom edge, the same
    # job the framing tree does at the top.
    for _fg in range(30):
        _h = (_fg * 2654435761) & 0x7FFFFFFF
        _side = -1.0 if _fg % 2 else 1.0
        # hug the frame edges: the centre is the route the eye travels
        # THE FRAME IS NARROW THIS CLOSE. First attempt spread these from 620 to
        # 1520 uu off the axis "to hug the edges", and at ~1,100 uu from the
        # camera the frame is only about +/-714 uu wide — so 32 parts of roughly
        # 200 landed in shot and the foreground stayed empty. Near-field
        # placement has to be measured against the FRUSTUM, not against the
        # world, and the frustum is a wedge: the closer the band, the narrower
        # the room in it.
        _fx = _side * (170.0 + ((_h >> 3) % 100) / 100.0 * 520.0)

        _fy = NEAR_Y + 40.0 + ((_h >> 11) % 100) / 100.0 * 760.0
        # RESPECT THE CORRIDOR. This band spans +/-170..690 uu and the protected
        # sight line is +/-430, so the foreground staging was dropping mushrooms
        # and flower clusters straight into the one channel the composition
        # depends on. Looking at the frame, that is most of why the bottom
        # centre has no rest in it: density everywhere and a path nowhere.
        #
        # Lushness is not the same as fullness. What separates a composed garden
        # from a rash is that the full parts are full BECAUSE other parts are
        # not, and the corridor is where the eye travels from the Dog to the
        # gate. It stays open.
        if _in_corridor(_fx, _fy):
            continue
        _kind = _h % 5
        if _kind == 0:
            # a low mossy kerb stone, half-buried
            _sz = 0.9 + ((_h >> 17) % 5) * 0.22
            _part("cube", _fx, _fy, 14.0, _sz, _sz * 0.72, 0.22, "stone",
                  "FG_stone%d" % _fg,
                  rot=(float((_h >> 5) % 14) - 7.0, float((_h >> 9) % 90), 0.0))
            _part("sphere", _fx + 12.0, _fy - 9.0, 26.0, _sz * 0.34, _sz * 0.30, 0.12,
                  "moss", "FG_stonemoss%d" % _fg)
        elif _kind == 1:
            # a clump of tall grass — tall for ground cover, still knee height
            for _t in range(4 + (_h % 3)):
                _ta = _t * 1.6 + _fg
                tuft(_fx + math.cos(_ta) * 46.0, _fy + math.sin(_ta) * 46.0,
                     (_h + _t * 11) % 97)
        elif _kind == 2:
            # a low flower cluster, warm so the frame edge is not all green
            for _b in range(5 + (_h % 4)):
                _ba = _b * 1.257 + _fg * 0.4
                _br = 20.0 + ((_h >> (_b + 2)) % 40)
                _part("sphere", _fx + math.cos(_ba) * _br, _fy + math.sin(_ba) * _br,
                      30.0 + (_b % 3) * 9.0, 0.17, 0.17, 0.15,
                      ("rose", "rose_pink", "petal_violet", "petal_pink")[(_h + _b) % 4],
                      "FG_bloom%d_%d" % (_fg, _b))
                _part("cube", _fx + math.cos(_ba) * _br, _fy + math.sin(_ba) * _br,
                      15.0, 0.05, 0.05, 0.30, "foliage", "FG_stem%d_%d" % (_fg, _b))
        elif _kind == 3:
            # a small amanita group — the reference names them and the near
            # field is where their spots actually resolve
            for _m in range(2 + (_h % 2)):
                kit_mushroom(_fx + _m * 62.0 - 30.0, _fy + ((_h >> _m) % 40) - 20.0,
                             0.34 + ((_h >> (_m + 4)) % 3) * 0.07,
                             "FGMush%d_%d" % (_fg, _m),
                             "mush_red" if (_h + _m) % 3 else "mush_purple")
        else:
            # fallen leaves and petals drifted into a hollow
            for _d in range(7 + (_h % 5)):
                _da = _d * 2.39996 + _fg
                _dr = 14.0 + _d * 9.0
                _part("cube", _fx + math.cos(_da) * _dr, _fy + math.sin(_da) * _dr,
                      5.0, 0.13, 0.11, 0.012,
                      ("leaf", "leaf_hi", "petal_pink", "rose_pink")[(_h + _d) % 4],
                      "FG_drift%d_%d" % (_fg, _d),
                      rot=(0.0, 0.0, float((_h >> _d) % 180)))

    # NEAR-FIELD TURF. The radial pass above lands its patches by distance from
    # the world origin, which put every one of them near the horizon: measured,
    # 36 patches reached the frame and all sat in a 9%-tall band at depth ~3,000.
    # The bottom third of the hero frame — the ground the viewer stands closest
    # to, where flat tone is most obvious — got nothing.
    #
    # So the near band is placed against the CAMERA rather than the origin, in
    # the strip between where the frame opens onto the ground and the plaza edge,
    # and pushed off the boulevard's centre line so it dresses the verges the
    # eye travels past rather than the paving it travels along.
    for _n in range(26):
        _h = (_n * 73856093) ^ 0x5EED
        _ny = NEAR_Y + 120.0 + ((_h % 100) / 100.0) * 1750.0
        _side = -1.0 if _n % 2 else 1.0
        _nx = _CAM_X + _side * (330.0 + ((_h >> 7) % 100) / 100.0 * 1250.0)
        if math.hypot(_nx, _ny) < 1450.0:      # not on the paved plaza
            continue
        if _in_corridor(_nx, _ny):             # and not in the sight line
            continue
        _sz = 2.2 + ((_h >> 11) % 9) * 0.95
        _part("cylinder", _nx, _ny, 2.2, _sz, _sz * (0.62 + ((_h >> 17) % 5) * 0.11),
              0.012, "ground_sun" if (_h >> 5) % 2 else "ground_shade",
              "MeadowNear%d" % _n, rot=(0.0, 0.0, float((_h >> 3) % 180)))
        # a few tufts riding each near patch — close enough to the camera that
        # silhouette matters, so these are real leaf cards, not flat colour
        for _t in range(2 + ((_h >> 13) % 3)):
            _ta = ((_h >> (_t + 2)) % 628) / 100.0
            _td = ((_h >> (_t + 9)) % 100) / 100.0 * _sz * 82.0
            tuft(_nx + math.cos(_ta) * _td, _ny + math.sin(_ta) * _td,
                 (_h + _t * 17) % 97)

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
    # WHEN MARBLE SUPPLIES THE DISTANCE, STOP BUILDING IT TWICE — BUT ONLY WHERE
    # IT ACTUALLY SUPPLIES IT.
    #
    # This used to read: "The Royal Garden backdrop spans roughly 20,000 x
    # 29,000 uu at its measured scale, which is exactly where the two far rings
    # live", and it dropped both far rings on that basis. The span was right and
    # the SCALE was wrong. 20,507 x 31,283 uu is the shell at its METRIC scale;
    # it is not placed at that scale. It is placed as a BACKDROP at x6, where it
    # measures 123,039 x 187,696 uu — a nearest half-extent of 61,520 uu, which
    # is 3.2 times further out than the OUTERMOST ring at 19,500.
    #
    # So the rings are not doubling up with the shell. They are midground in
    # front of it, and suppressing them opens a hole from 7,200 uu out to
    # 61,520 uu — the opposite of the intent, and discoverable only by looking
    # at a frame on a rented GPU.
    #
    # The decision is now DERIVED from the manifest rather than asserted here. A
    # ring is dropped only if the shell actually reaches it; if the manifest
    # cannot be read, every ring stays, because keeping geometry is the safe
    # failure and deleting it is not.
    # DEFAULTED FROM THE MANIFEST, because importing a backdrop and USING one
    # were two separate switches and only the first was ever thrown.
    #
    # Measured on the L4 2026-08-22. The build ran with
    # WONDERLAND_MARBLE_IMPORT=royal-garden-backdrop, the shell imported at
    # exactly the right size and the right way up, MARBLE_ACTORS=1 in the
    # packaged world — and it was invisible from both arrival cameras, because
    # WONDERLAND_MARBLE_BACKDROP defaulted to 0 and the generator therefore kept
    # all three authored skyline rings at 7,200 / 12,800 / 19,500 uu standing in
    # front of it. A 1,580-credit castle city behind three rings of authored
    # spires.
    #
    # A world whose manifest says placement_mode = backdrop_at_camera IS a
    # backdrop; that is what the field means. So it now defaults to on for those
    # worlds, the environment variable still overrides in both directions, and
    # the nearest ring is kept regardless — the midground a player walks through
    # has to stay authored geometry because a single-viewpoint shell smears the
    # moment they move.
    _backdrop_env = os.environ.get("WONDERLAND_MARBLE_BACKDROP")
    if _backdrop_env is None or _backdrop_env == "":
        _MARBLE_BACKDROP = _marble_placement_mode() == "backdrop_at_camera"
        if _MARBLE_BACKDROP:
            unreal.log_warning(
                "MARBLE BACKDROP derived from the manifest: this world's "
                "placement_mode is backdrop_at_camera, so the far skyline rings "
                "defer to the shell. Set WONDERLAND_MARBLE_BACKDROP=0 to keep "
                "them.")
    else:
        _MARBLE_BACKDROP = _backdrop_env not in ("0", "false", "no")
    _rings = ((7200.0, 14, 11.0, "spire"),
              (12800.0, 18, 15.0, "spire_far" if "spire_far" in MATS else "spire"),
              (19500.0, 22, 20.0, "spire_far" if "spire_far" in MATS else "spire"))
    if _MARBLE_BACKDROP:
        _shell = _marble_shell_reach()
        if _shell is None:
            unreal.log_warning(
                "MARBLE BACKDROP asked for, but no readable Marble manifest says "
                "where the shell is. KEEPING every skyline ring: deleting the "
                "midground on an assumption is how the horizon acquires a hole.")
        else:
            # THE NEAREST RING IS NEVER DROPPED, whatever the arithmetic says.
            # That is not a distance question: Marble is a single-viewpoint
            # shell and it smears as soon as a player walks, so the midground
            # they actually move through has to stay authored geometry. The
            # derived test applies to the rings BEHIND it.
            _kept = (_rings[0],) + tuple(r for r in _rings[1:] if r[0] < _shell * 0.8)
            _dropped = len(_rings) - len(_kept)
            unreal.log_warning(
                "MARBLE BACKDROP: the shell reaches %.0f uu; rings at %s. "
                "Dropping %d of %d — a ring is only doubling up if the shell "
                "actually gets to it."
                % (_shell, ", ".join("%.0f" % r[0] for r in _rings),
                   _dropped, len(_rings)))
            if _dropped == 0:
                unreal.log_warning(
                    "  ...which is NONE of them. The shell is far outside every "
                    "ring, so they are midground in front of it, not a second "
                    "copy of it. This knob has nothing to remove here.")
            _rings = _kept
    for ring, (dist, count, hgt, mat) in enumerate(_rings):
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
    # THE FIRST BOUGH, same problem and the same two knobs. Between them the
    # two boughs' leaf cards were 22.2% of the whole frame — the single largest
    # colour in a shot whose reference is a pastel stone city. Lifted and
    # thinned until sky reads through the arch instead of being shut out by it.
    # verify-visual-target.py measures the result; these are the numbers to
    # move if the founder wants the canopy heavier or lighter.
    # OPEN THE SKY. THE FOUNDER'S INSTRUCTION IS EXPLICIT: "No giant geometry
    # hanging above the camera", "no world shell visibly enclosing the scene",
    # and the composition must read foreground -> path -> gates -> gardens ->
    # midground -> towers -> enormous fantasy city skyline.
    #
    # These two boughs are the geometry doing the enclosing. They were tuned to
    # be a repoussoir arch and they became a ROOF: 22.2% of the frame in leaf
    # cards, and in the founder's own screenshot they are the dark masses across
    # the entire top edge with the city shut out behind them.
    #
    # A repoussoir frames a CORNER. It does not span the frame. So the bough is
    # lifted far out of the view and thinned hard -- it still reads as a canopy
    # edge at the top-left, and the city behind it is no longer roofed over.
    BOUGH1_LIFT = 1150.0       # 320 -> 1150: out of the frame's top edge
    BOUGH1_CARDS = 3           # 9 -> 3: an edge, not a ceiling
    for _k in range(14):
        _t = (_k + 0.5) / 14.0
        _bx = _TX - _t * 1500.0
        _by = _TY - _t * 520.0
        _bz = 1180.0 + BOUGH1_LIFT + math.sin(_t * 2.1) * 190.0 - _t * _t * 260.0
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
            for _c in range(BOUGH1_CARDS):
                _ca = _c * 0.898 + _k
                # RADIUS JITTER IS WHAT MAKES A CANOPY A MASS. Cards all placed
                # at one radius sit on a ring and read as separate planes; a
                # varying radius makes them overlap in depth, which is the only
                # way a flat card stops looking flat.
                _cr = 0.62 + 0.38 * abs(math.sin(_ca * 2.3))
                _part("cube", _bx + math.cos(_ca) * 250.0 * _cr,
                      _by + math.sin(_ca) * 205.0 * _cr,
                      _bz + 20.0 + math.sin(_ca * 1.7) * 95.0,
                      1.85, 0.03, 1.85,
                      "leafcard_hi" if _c % 2 else "leafcard",
                      "TreeBranchCard%d_%d" % (_k, _c),
                      rot=(float((_c * 29) % 60) - 30.0, float((_c * 47) % 360),
                           float((_c * 17) % 40) - 20.0))
        if _k % 3 == 1:                       # hanging vines and blossom
            for _v in range(6):
                _part("sphere", _bx + 16.0, _by + 12.0, _bz - 90.0 - _v * 62.0,
                      0.30, 0.30, 0.30, "foliage" if _v % 2 else "rose_pink",
                      "TreeHang%d_%d" % (_k, _v))
    # THE TOP-RIGHT CORNER LEAKS — and then this closed it too far.
    #
    # A second bough was thrown across the top of the view to close an arch of
    # foliage, and it worked: the top third of the frame measures 89.4% covered
    # and the whole frame is 4.1% sky. The reference is a bright lavender sky
    # with soft cloud seen THROUGH a framing tree, not a shot roofed over by
    # one, and the palette says the same thing — green is 30.6% of the frame
    # and 22.2 of those points are this canopy's leaf cards.
    #
    # So the bough stays and the arch stays. What changes is that it is lifted
    # and thinned until sky reads BETWEEN the foliage, which is what a real
    # canopy does. Deleting it would trade one wrong frame for another.
    #
    # These are the two numbers to move if the founder wants more or less sky.
    # Every value they touch is measured by verify-visual-target.py, so the
    # effect is a number rather than an opinion.
    # Same as bough 1, and for the same reason: this one crosses the TOP of the
    # frame, which is precisely where the founder wants to see a fantasy city
    # skyline. Raised clear and thinned to an edge.
    BOUGH2_LIFT = 1400.0       # 260 -> 1400: fully above the hero view
    BOUGH2_CARDS = 2           # 8 -> 2
    for _k in range(11):
        _t = (_k + 0.5) / 11.0
        # ACROSS the top, toward screen-right (which is world -X when the camera
        # looks along +Y), and high enough to hang INTO the frame rather than
        # across the Observatory that closes the axis beneath it.
        _bx = _TX - 300.0 - _t * 1500.0
        _by = _TY + 120.0 + _t * 520.0
        _bz = 1300.0 + BOUGH2_LIFT + math.sin(_t * 1.9) * 90.0 - _t * _t * 140.0
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
                for _c in range(BOUGH2_CARDS):
                    _ca = _c * 1.257 + _k
                    _cr = 0.60 + 0.40 * abs(math.sin(_ca * 2.1))
                    _part("cube", _bx + math.cos(_ca) * 215.0 * _cr,
                          _by + math.sin(_ca) * 180.0 * _cr,
                          _bz + 12.0 + math.sin(_ca * 1.6) * 80.0, 1.62, 0.03, 1.62,
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
    kit_plaza(0.0, 0.0, circle=HERO_DOG)
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
    # THE HERO DOG STANDS. The founder's spec sheet draws the Relay Dog upright
    # and asks for the featured Dog of the arrival frame to be presented that
    # way -- so the one Dog the camera is aimed at is the one carrying the
    # standing body plan. Everything about its identity is unchanged: same
    # white blocky body, same black visor, same gold eyes, same tail.
    stroll_dog(HERO_DOG[0], HERO_DOG[1], "RelayDog", s=HERO_DOG_SCALE,
               is_hero=True, roam=230.0, upright=1)
    # ---- THE UPRIGHT DOGS, WHERE THE CAMERA CAN SEE THEM ----------------
    #
    # The founder looked at the live build and said: "I see no relay dogs that
    # is standing up on 2 feet I don't see it". verify-visual-target agrees --
    # relay_dogs_readable reads 2 against a required 3, where readable means
    # owning pixels after occlusion, tall enough to recognise, AND with the
    # visor and gold eyes visible.
    #
    # The upright companions were at roam radius 1100 out among six rings of
    # ornaments. Standing form or not, at that distance a Dog is a pale shape.
    # The featured Dogs of this world belong in the near-middle of the hero
    # frame, at a size that reads, flanking the hero rather than lost behind it.
    #
    # These are placed by hand rather than scattered, because "the founder can
    # see them" is a composition requirement and composition is not a scatter.
    stroll_dog(-980.0, 1180.0, "UprightReviewer", s=1.95, roam=140.0,
               upright=2, accessory="none")
    stroll_dog(980.0, 1240.0, "UprightBuilder", s=1.95, roam=140.0,
               upright=2, accessory="none")
    stroll_dog(-1560.0, 1760.0, "UprightFlame", s=2.05, roam=120.0,
               upright=4, body="dog_bone", eyes="dog_eye_blue")

    # (The travelling arrival ring is gone: with the camera fixed the Dog stands
    # on the real arcane circle, so a second one would only sit inside the first.)
    # A DRIFT OF KEYS, not three of them. They read as a current of magic moving
    # toward the Build Gate, which is where the brief wants the eye to go next.
    #
    # THE KEEP-OUT WAS NEVER APPLIED HERE. Four of these ten sit inside
    # ARRIVAL_KEEP_OUT, and FloatKey7 at (120,-560) is 6.4 m from the lens --
    # a gold prop hanging in front of the camera, measured at 5.0% of the whole
    # TOP THIRD of the frame. A key is a small object; anything that reads that
    # large is not far away, it is close. Push each one out along its own
    # horizontal bearing so the authored drift toward the Build Gate is
    # preserved and only the distance changes.
    _keys_moved = 0
    for i, (kx, ky, kz) in enumerate([(-640, 240, 430), (540, 120, 520), (240, 780, 560),
                                      (-880, 40, 610), (-1180, 250, 700), (-380, -180, 480),
                                      (760, -320, 560), (120, -560, 640), (980, 640, 690),
                                      (-160, 1150, 720)]):
        kx, ky, _mv = _push_out_of_lens(kx, ky, "FloatKey%d" % i)
        if _mv:
            _keys_moved += 1
        kit_float_key(kx, ky, kz, "FloatKey%d" % i, ks=0.62)
    if _keys_moved:
        unreal.log_warning("FLOAT KEYS  %d of 10 were inside the %.0f uu arrival keep-out "
              "and were pushed out along their own bearing"
              % (_keys_moved, ARRIVAL_KEEP_OUT))
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
    # LIFE GATHERS WHERE THE FOOD IS.
    #
    # Butterflies, motes and drifting petals were each ONE phyllotaxis spread
    # over a 1,450-1,950 uu radius — a perfectly even sprinkle across nine
    # tenths of the frame. Looking at the projected image, that is what reads
    # as confetti: hundreds of small bright dots at uniform spacing, which the
    # art direction names twice as the thing to avoid.
    #
    # Uniform is also simply WRONG about the subject. Butterflies are not
    # evenly distributed over a garden; they are over the flowers, in twos and
    # threes, with empty air between. So the airborne life is anchored to the
    # layout's own flower beds, in a few tight clusters, and the space between
    # them is left empty on purpose — the emptiness is what makes a cluster
    # read as one.
    _life_anchors = []
    for _fb in layout.get("flowerBeds", []):
        _c = _fb.get("center")
        if _c:
            _life_anchors.append((float(_c[0]), float(_c[1])))
    for _wf in layout.get("waterFeatures", []):
        _c = _wf.get("center") or _wf.get("location")
        if _c:
            _life_anchors.append((float(_c[0]), float(_c[1])))
    if not _life_anchors:
        _life_anchors = [(140.0, 420.0)]

    for _ai, (_ax, _ay) in enumerate(_life_anchors):
        scatter(_ax, _ay, 10 + (_ai % 3) * 3, 340.0, butterfly)
        scatter(_ax + 120.0, _ay - 90.0, 9 + (_ai % 2) * 4, 300.0, mote)
        scatter(_ax - 90.0, _ay + 110.0, 8 + (_ai % 3) * 3, 380.0, air_petal)
    for _f, (_fx, _fy, _fz) in enumerate(((-5200.0, 14000.0, 6200.0), (7400.0, 19000.0, 7600.0),
                                          (1800.0, 26000.0, 9000.0))):
        for _k in range(7):
            kit_bird(_fx + _k * 620.0 - (_k % 3) * 260.0,
                     _fy + _k * 420.0, _fz + (_k % 4) * 210.0, _f * 7 + _k)
    # Restrained magical motes: static emissive sparkles (gold/cyan/violet) drifting
    # over the district — the bloom pass gives them a firefly glow.
    # THE PROJECT AVATAR — the user's project, as an object in the plaza.
    #
    # Placed off the arcane circle (which is the hero Dog's) and clear of the
    # arrival keep-out, so it reads as a second subject in the arrival shot
    # rather than another thing standing in front of the city.
    _avatar = None
    _avatar_cls = unreal.load_class(None, "/Script/Wonderland.WonderlandProjectAvatarActor")
    if _avatar_cls:
        _avatar = spawn(_avatar_cls, (340.0, 210.0, 0.0), label="ProjectAvatar")
        if _avatar is not None:
            # MissionState stays 0 (Unknown) here. The generator does not know
            # what Relay is doing and must not guess: an Avatar that shipped
            # already "implementing" would be a world lying at build time.
            set_prop(_avatar, "MissionState", 0)
            set_prop(_avatar, "CompletedRuns", 0)
            set_prop(_avatar, "BaseRadius", 96.0)
            unreal.log_warning("AVATAR placed at (340,210) stage-driven, mission Unknown")
    else:
        # Same failure shape that once lost eight Relay Dogs: load_class returns
        # None rather than raising, so say it loudly.
        unreal.log_error(
            "WonderlandProjectAvatarActor is not in this build — the Project "
            "Avatar will be ABSENT. Compile the C++ module; "
            "verify-generator-classes.py catches this without an engine.")

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
        # THE HERO NEEDS TO BE THE ONLY ONE OF ITS KIND IN ITS PATCH OF FRAME.
        # Companion 2 sits at (-300,-200) and the hero now stands at (-260,-260)
        # — SEVENTY-TWO uu apart, which in the projected frame is a second white
        # Dog with a black visor standing directly against the subject. The
        # brief asks for the Relay Dog prominent, and prominence is not scale,
        # it is being unambiguous. A companion of the same silhouette at the
        # same distance costs more legibility than any amount of extra size buys.
        #
        # Displaced outward along its own bearing rather than deleted: the
        # world should still feel populated, just not doubled.
        _dxh, _dyh = cx - HERO_DOG[0], cy - HERO_DOG[1]
        _dh = math.hypot(_dxh, _dyh)
        if _dh < 900.0:
            _ba = math.atan2(_dyh, _dxh) if _dh > 1.0 else (i * 1.7)
            cx = HERO_DOG[0] + math.cos(_ba) * 1150.0
            cy = HERO_DOG[1] + math.sin(_ba) * 1150.0
        # NOT EVERY DOG STANDS -- that is the rule, not an omission. The two
        # that ATTEND an Avatar stand, because attending is work and the sheet's
        # upright form is what a working Dog is drawn in; one more stands
        # ceremonially so the plaza reads as a place where both forms live. The
        # rest stay quadruped CLASSIC, which is the canonical identity.
        _upright = 2 if i in (0, 3) else (3 if i == 5 else 0)
        # THE SKELETON FLAME DOG. The ceremonial upright Dog wears the founder's
        # legendary variant: bone coat, blue ghostfire eyes. Same body, same
        # proportions, same visor -- a skin, which is the whole rule.
        _coat, _eyes = coat, "dog_eye"
        if i == 5:
            _upright, _coat, _eyes = 4, "dog_bone", "dog_eye_blue"
        # AN UPRIGHT DOG HAS TO BE BIG ENOUGH TO READ AS ONE. At 1.05 the
        # standing form is a pale shape among a thousand props; the founder
        # looked at the live build and could not find one. The standing Dogs
        # are the featured objects of this world, so they are scaled to be
        # findable in a wide vista.
        _dsc = 1.75 if _upright else 1.05
        stroll_dog(cx, cy, "Companion%d" % i, s=_dsc, body=_coat, roam=1100.0, accessory=acc,
                   keep_out=(ARRIVAL_CAM, ARRIVAL_KEEP_OUT),
                   attends=(_avatar if i in (0, 3) else None),
                   upright=_upright, eyes=_eyes)
    # ---- FOREGROUND PLANTING ------------------------------------------
    # THE MEASUREMENT THIS ANSWERS. The last streamed arrival frame classified
    # 0.1% green and 2.1% pink, against 25% and 7.7% in the offline preview of
    # the same world. The palette exists; almost none of it was in the near
    # field, where a frame gets its colour and its depth.
    #
    # So: a band of LOW planting across the bottom of the arrival frame. Low is
    # the whole discipline — in_camera_lap exists because tall foreground has
    # vanished off the bottom edge or walled the shot three times already, and
    # nothing here is more than a metre.
    #
    # PLACED BEYOND WHERE THE FRAME ACTUALLY TOUCHES THE GROUND, and beyond it
    # for BOTH arrival cameras. HeroCam6 is pitched 16 degrees higher than
    # HeroCam0, so its bottom ray meets the ground further out; planting at
    # HeroCam0's band would put flowers under HeroCam6's frame edge — invisible
    # in the very shot they were added for.
    def _band_for(cam_pos, cam_look, fov_deg):
        ex, ey, ez = cam_pos
        tx, ty, tz = cam_look
        half_v = math.atan(math.tan(math.radians(fov_deg) * 0.5) * (9.0 / 16.0))
        run = math.hypot(tx - ex, ty - ey)
        pitch = math.atan2(tz - ez, run) if run else 0.0
        drop = half_v - pitch
        return ey + (ez / math.tan(drop) if drop > 1e-4 else 1e6)

    _FG_START = max(NEAR_Y,
                    _band_for(ARRIVAL_CAM, (0.0, 120.0, 541.0), 75.0))
    unreal.log_warning("FOREGROUND PLANTING starts at world y >= %.0f "
                       "(HeroCam0 band %.0f, HeroCam6 band %.0f)"
                       % (_FG_START, NEAR_Y, _band_for(ARRIVAL_CAM, (0.0, 120.0, 541.0), 75.0)))

    # Deterministic, like everything else placed here: a hero frame captured
    # twice must show the same flowers. Integer hashes, no RNG.
    _FG_BEDS = 0
    _FG_CAPS = 0
    _FG_SHRUBS = 0
    # 56, NOT 96. Each bed is bigger in frame now that the planting sits at the
    # plaza's verge rather than scattered across it, and the founder's note is
    # explicit that visible quality per object beats object count. Fewer beds,
    # each one readable, with stone between them.
    for _i in range(56 if int(LOOK["foregroundPlanting"]) else 0):
        _h = (_i * 2654435761) & 0xFFFFFFFF
        _t = (_i % 32) / 31.0
        # INSIDE THE FRAME. The first version spanned 3,062 uu where the frame is
        # about 2,170 uu wide at this distance, so a third of the planting was
        # never in shot. Derived from the camera rather than guessed again.
        _fy = _FG_START + 90.0 + 900.0 * _t
        _half_w = (_fy - ARRIVAL_CAM[1]) * math.tan(math.radians(75.0 * 0.5)) * 0.86
        _u = -1.0 + 2.0 * (((_h >> 3) % 1000) / 1000.0)
        # TO THE VERGES. Spread evenly across the full width, 96 beds carpet the
        # throat of the shot and the ground never reads -- the frame measured
        # 0.1% bare ground where the reference is roughly a third open paving,
        # with its flowers banked at the left and right edges. Remapping rather
        # than rejecting keeps all 96 beds and simply moves them outward, so the
        # near field stays dense where it is visible and opens where the eye
        # travels to the Dog.
        _u = math.copysign(0.52 + 0.48 * abs(_u), _u if _u else 1.0)
        _fx = _u * _half_w
        # AND NEVER ON THE STONE. This pass is the reason the plaza could not be
        # seen: it is the densest planting in the world, it is the planting the
        # hero camera looks straight at, and it was the one pass that never
        # asked _on_paving. Pushed to the verge rather than dropped, so the
        # near field stays dense exactly where the reference puts its density.
        _fx, _fy = _off_paving_lateral(_fx, _fy, _h)
        # Never on the arcane circle, and never on top of the hero Dog.
        if math.hypot(_fx - HERO_DOG[0], _fy - HERO_DOG[1]) < 420.0:
            continue
        if math.hypot(_fx, _fy) < 560.0:
            continue
        # THE COLOURS THAT WERE MISSING. Violet, rose and pink beds, so the
        # near field carries the families the classifier could not find.
        _pal = (("petal_violet", "rose_pink", "petal_pink"),
                ("rose_pink", "petal_pink", "petal_air"),
                ("petal_pink", "petal_violet", "rose"))[_i % 3]
        kit_bed(_fx, _fy, 96.0 + 46.0 * ((_h >> 7) % 4) / 3.0, "FgBed%d" % _i, palette=_pal)
        _FG_BEDS += 1
        # VERTICAL MASS. A flat bed contributes almost no frame area from a
        # camera this low; a shrub beside it does, and it is the storey this
        # world jumps straight over — ankle-high ground cover to trees with
        # nothing between. kit_shrub declines placements inside the camera's
        # blind foreground on its own.
        if _i % 4 != 3:
            kit_shrub(_fx + 118.0, _fy + 34.0,
                      0.52 + 0.26 * ((_h >> 17) % 3) / 2.0, "FgShrub%d" % _i,
                      bloom=("rose_pink" if _i % 2 else "petal_violet"))
            _FG_SHRUBS += 1
        # MUSHROOMS GATHER. THEY DO NOT CARPET.
        #
        # What was here: three caps beside two beds in three, plus a NINE-cap
        # ring around every one of the 96. Roughly 1,056 caps at scale 0.26-0.46
        # in the near band. Looking at the projected frame rather than at the
        # numbers, it is a continuous mat of overlapping domes across the whole
        # foreground — the "random clutter" and "confetti" the art direction
        # forbids by name, and it is what made the plaza disappear.
        #
        # THE COMMENT IT REPLACES SAID WHY, AND THE REASON WAS THE DEFECT. It
        # opened "verify-visual-target reads environment_density at 77.9 against
        # a target of 85" and "palette_violet reads 4.8 against 6.0", and the
        # nine caps existed to move those two numbers. They did. The founder's
        # answer to that method is worth keeping in the file:
        #
        #     "A screenshot can score better numerically and still look
        #      artistically wrong. The actual highest-level metric is visual
        #      convergence against the target."
        #
        # The reference has perhaps two dozen mushrooms in the whole frame and
        # every one of them is READABLE: a dominant cap with smaller ones at its
        # foot, gathered at the base of something, with open ground between the
        # groups. That is a grammar, not a density. So: one clump per four beds,
        # each with a real size hierarchy, placed OUTBOARD of its bed so the
        # groups bank toward the frame edges and the middle stays open for the
        # Dog. About 90 caps where there were 1,056, and each one is an object
        # instead of a pixel.
        if _i % 4 == 1:
            _cap = ("mush_red", "mush_purple", "mush_white")[(_h >> 11) % 3]
            _alt = ("mush_purple", "mush_white", "mush_red")[(_h >> 15) % 3]
            # outboard: away from the camera axis, so clumps gather at the verges
            _cx = _fx + math.copysign(160.0, _fx if _fx else 1.0)
            _cy = _fy - 40.0
            # One dominant cap and two to four subordinates. The hierarchy is
            # the whole read: five equal caps is a mat again at any count.
            _sizes = (1.05, 0.62, 0.50, 0.36, 0.29)[: 3 + ((_h >> 19) % 3)]
            # A MUSHROOM'S SIZE IS AN ANGLE, NOT A NUMBER.
            #
            # The clump scales were absolute, so a clump that landed 1,300 uu
            # from the lens drew its dominant cap more than twice the frame
            # share of an identical clump at 3,000 uu. Three clumps ended up
            # owning 9.8% of the bottom third between them — bigger than every
            # cap in the founder's reference. The frame is 0.8632 x distance
            # tall at any depth, so holding the cap to a constant SHARE of the
            # frame means scaling it with its own distance.
            _cd = math.hypot(_cx - ARRIVAL_CAM[0], _cy - ARRIVAL_CAM[1])
            _cscale = max(0.42, min(1.0, _cd / 2600.0))
            for _k, _sz in enumerate(_sizes):
                _sz *= _cscale
                _ca = (((_h >> (5 + _k)) % 360) + _k * 97) * math.pi / 180.0
                _cr = 0.0 if _k == 0 else 74.0 + _k * 30.0
                _mx = _cx + math.cos(_ca) * _cr
                _my = _cy + math.sin(_ca) * _cr
                if math.hypot(_mx - HERO_DOG[0], _my - HERO_DOG[1]) < 420.0:
                    continue
                if math.hypot(_mx, _my) < 560.0:
                    continue
                kit_mushroom(_mx, _my, _sz, "FgClump%d_%d" % (_i, _k),
                             _cap if _k % 2 == 0 else _alt)
                _FG_CAPS += 1
    unreal.log_warning("FOREGROUND PLANTING placed %d beds, %d shrubs, %d mushroom caps"
                       % (_FG_BEDS, _FG_SHRUBS, _FG_CAPS))

    # ---- MIDGROUND ARCHITECTURE ---------------------------------------
    # THE METRIC THIS ANSWERS, and why planting could not.
    #
    # visual-target asks for coverage.objects_pct >= 85 and the frame reads
    # 77.9: about seven points of it is bare ground. Nine purple caps per bed
    # moved that by NOTHING, and the reason is geometric rather than a matter of
    # taste -- a 40 uu cap forty metres out subtends almost no frame area from a
    # camera at eye height. Coverage is won by things that are BIG or NEAR, and
    # the beds already own the near field.
    #
    # So this is the storey between: waist-to-head architecture standing on the
    # ground the camera can see across. Benches, pedestals and lanterns, in
    # STONE and ROSE -- the founder's list names arches, lamps and architecture,
    # and none of them are green, which matters because foliage is already the
    # largest colour in the frame and over its own ceiling.
    #
    # Placed on an arc rather than a grid, outside the arrival keep-out and
    # clear of the hero Dog, so it reads as a garden that was laid out rather
    # than as scatter.
    _ARCH = 0
    for _a in range(14):
        _ang = -1.45 + _a * (2.9 / 13.0)
        _rad = 1180.0 + 210.0 * ((_a * 7) % 5) / 4.0
        _ax = math.cos(_ang + math.pi * 0.5) * _rad
        _ay = NEAR_Y + math.sin(_ang + math.pi * 0.5) * _rad * 0.55 + 420.0
        if math.hypot(_ax - HERO_DOG[0], _ay - HERO_DOG[1]) < 520.0:
            continue
        if in_camera_lap(_ax, _ay, 260.0):
            continue
        _kind = _a % 3
        if _kind == 0:
            kit_bench(_ax, _ay, math.degrees(_ang) + 90.0, "MgBench%d" % _a)
        elif _kind == 1:
            kit_card_pedestal(_ax, _ay, 0.62 + 0.10 * ((_a * 3) % 3), "MgPedestal%d" % _a)
        else:
            kit_lantern(_ax, _ay, 0.86 + 0.14 * ((_a * 5) % 3) / 2.0, "MgLamp%d" % _a)
        _ARCH += 1
    unreal.log_warning("LANTERNS: %d shadow-casting (near the arrival camera), "
                       "%d shadowless at a third intensity - shadows cost six "
                       "cubemap faces each and there are 25 lamps"
                       % (_LAMP_STATS[0], _LAMP_STATS[1]))
    unreal.log_warning("MIDGROUND ARCHITECTURE placed %d pieces "
                       "(benches, pedestals, lanterns) - coverage, not planting"
                       % _ARCH)

    # HERO MUSHROOMS, LEFT AND RIGHT. The reference opens on big red-and-white
    # caps flanking the frame at eye height; they are the first thing the eye
    # reads and the near band had none. Placed OUTSIDE the boulevard so they
    # frame the view instead of blocking it, and kept short enough to stay
    # under the skyline.
    #
    # THINNED AND PUSHED OUT, because "flanking" became "carpeting". Measured on
    # the offline owner buffer, mush_red owned 23.2% of the bottom 38% of the
    # frame -- twice the share of the GROUND itself, at 11.3% -- and the nearest
    # row stood about 43% of frame height. The reference has three or four big
    # caps, banked at the edges and cropped by them, over open paving. Five rows
    # a side at 60% of half-width is a hedge of mushrooms across the plaza.
    #
    # Three rows, starting at 78% of half-width: same framing device, and the
    # ground the founder's reference is a third made of can be seen again.
    # AND THE TWO SIDES WERE EXACT MIRRORS OF EACH OTHER.
    #
    # `for _side in (-1.0, 1.0)` over one row table put an identical cap at an
    # identical depth and an identical scale on both sides of the frame, three
    # times. The same loop shape does it for the lamps, the cypresses and the
    # clocks, and the result is a shot with a mirror line down the middle —
    # which is a strong "generated" cue and is nothing like the reference, where
    # the gate is on the left, the great tree is on the right, and no two edges
    # agree.
    #
    # The scale expression was dead as well: `1.5 + 0.5 * ((_r * 3) % 3) / 2.0`
    # — (_r * 3) % 3 is 0 for every _r, so all six caps were 1.5 and the
    # variation the line describes never existed.
    #
    # Each side now has its own rows: different depths, different distances out
    # from the axis, different sizes, different counts.
    _HERO_ROWS = {
        -1.0: ((250.0, 0.80, 1.85, "mush_red"), (980.0, 0.86, 1.15, "mush_purple"),
               (1760.0, 0.74, 1.55, "mush_red")),
        1.0: ((520.0, 0.88, 1.35, "mush_red"), (1420.0, 0.78, 2.05, "mush_purple")),
    }
    _HERO_CAPS = 0
    for _side, _rows in _HERO_ROWS.items():
        for _r, (_dy, _frac, _sz, _cm) in enumerate(_rows):
            _my = _FG_START + _dy
            _half = (_my - ARRIVAL_CAM[1]) * math.tan(math.radians(75.0 * 0.5))
            _mx = _side * (_half * _frac)
            if math.hypot(_mx - HERO_DOG[0], _my - HERO_DOG[1]) < 420.0:
                continue
            # SIZE IS AN ANGLE HERE TOO. Measured after the rows were split,
            # the 2.05 cap at 1,347 uu drew 33% of the frame's HEIGHT and a
            # quarter of its width — the biggest cap in the founder's reference
            # is nearer a tenth of the frame. It was also mush_white, so a
            # quarter of the frame's width was a blank pale dome. The reference's
            # big caps are RED with white flecks; white is for the small ones
            # tucked under planting, where the flecks are what you read.
            _hd = math.hypot(_mx - ARRIVAL_CAM[0], _my - ARRIVAL_CAM[1])
            kit_mushroom(_mx, _my, _sz * max(0.40, min(1.0, _hd / 3000.0)),
                         "HeroCap%d_%d" % (int(_side), _r), _cm)
            _HERO_CAPS += 1
    unreal.log_warning("HERO MUSHROOMS placed %d flanking caps" % _HERO_CAPS)

    # ---- MIDGROUND VERTICALS ------------------------------------------
    # WHERE THE FRAME ACTUALLY HAS ROOM, measured rather than assumed.
    #
    # The ground planting above came out at 0.78% of the arrival frame, all of
    # it in the bottom third, and the geometry says why: HeroCam6 sits 430 uu up
    # and pitches +5 degrees, so the visible ground begins 1,296 uu out and
    # anything lying ON it can only ever occupy a bottom sliver. More beds would
    # have bought more of almost nothing.
    #
    # The room is at MID HEIGHT — objects 300-900 uu tall standing 1,400-2,800
    # uu away, which is above the ground band and below the skyline. That is
    # also the storey this world skips: paving, then castle, with the middle
    # distance carried by nothing. Lanterns and tall flowering stalks fill it
    # without entering in_camera_lap's blind foreground, so they add depth
    # instead of walling the shot.
    _MG_LAMPS = 0
    _MG_STALKS = 0
    for _i in range(30 if int(LOOK["foregroundPlanting"]) else 0):
        _h = (_i * 40503 + 12345) & 0xFFFFFFFF
        _t = _i / 29.0
        _my = _FG_START + 1150.0 + 1500.0 * _t
        _half = (_my - ARRIVAL_CAM[1]) * math.tan(math.radians(75.0 * 0.5)) * 0.80
        _mx = -_half + 2.0 * _half * (((_h >> 5) % 1000) / 1000.0)
        # Keep the boulevard and the arcane circle clear — the eye needs a path
        # THROUGH the middle distance, not a hedge across it.
        if abs(_mx) < 190.0:
            continue
        if math.hypot(_mx - HERO_DOG[0], _my - HERO_DOG[1]) < 380.0:
            continue
        if _i % 3 == 0:
            kit_lantern(_mx, _my, 0.85 + 0.35 * ((_h >> 9) % 3) / 2.0,
                        "MgLamp%d" % _i, yaw=float((_h >> 12) % 360))
            _MG_LAMPS += 1
        else:
            # A FLOWERING SHRUB, not a stalk with three beads on it.
            #
            # This built a 0.10-wide stem carrying three 40 uu blooms, and at
            # midground distance that is worth almost no frame area at all --
            # which is why pink measured 3.8% against the reference's 26.7%
            # while the world was, on paper, full of flowers. The reference's
            # pink is carried by BIG fluffy masses banked along the midground:
            # blossom the size of a person, not the size of a fist.
            #
            # A squat foliage base with a cluster of blossom lobes over it, ~300
            # uu across. Same slot, same keep-clear rules, two orders of
            # magnitude more colour.
            _sm = ("rose_pink", "petal_violet", "petal_pink")[_i % 3]
            _sm2 = ("petal_pink", "rose_pink", "petal_violet")[(_i + 1) % 3]
            _sw = 1.30 + 0.55 * ((_h >> 15) % 4) / 3.0
            _part("sphere", _mx, _my, 46.0 * _sw, 0.86 * _sw, 0.86 * _sw, 0.52 * _sw,
                  "foliage_deep", "MgShrub%d_base" % _i)
            for _b in range(9):
                _ba = _b * 0.698 + _i * 0.7
                _br = (0.30 + 0.62 * ((_b * 7) % 5) / 4.0) * 78.0 * _sw
                _part("sphere",
                      _mx + math.cos(_ba) * _br,
                      _my + math.sin(_ba) * _br * 0.82,
                      (72.0 + 46.0 * ((_b * 3) % 4) / 3.0) * _sw,
                      0.60 * _sw, 0.58 * _sw, 0.50 * _sw,
                      _sm if _b % 2 else _sm2,
                      "MgShrub%d_bloom%d" % (_i, _b))
            _MG_STALKS += 1
    unreal.log_warning("MIDGROUND VERTICALS placed %d lanterns and %d flowering stalks"
                       % (_MG_LAMPS, _MG_STALKS))

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
    for _i, (_gx, _gy, _gs) in enumerate(((-3100.0, 2450.0, 1.05),
                                          (-4200.0, 3600.0, 1.20),
                                          (2900.0, 3400.0, 1.15),
                                          (3600.0, 4400.0, 1.10))):
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
            # SIX, NOT NINE, AND SMALLER. Measured: GreatTree2's cards alone
            # owned 18.8% of the arrival frame's top third, and the top third
            # was 76.7% covered against a reference that is roughly half sky.
            # A canopy that roofs the shot is not a frame, it is a lid.
            for _c in range(6):
                _ca = _c * 1.047 + _i
                _part("cube", _gx + math.cos(_ca) * 430.0 * _gs,
                      _gy + math.sin(_ca) * 390.0 * _gs,
                      (1180.0 * _gs) + math.sin(_ca * 1.4) * 120.0 * _gs,
                      2.0 * _gs, 0.03, 2.0 * _gs,
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
    # The two that close the axis are the SUBJECT and keep the full citadel
    # build: a dominant keep with a dome beside it, every merlon, every bridge.
    # A skyline reads as a city because it has a subject.
    kit_castle(9000.0, 66000.0, 12.0, "GreatCastle", variant=0)
    kit_castle(-30000.0, 36000.0, 8.5, "WestCastle", variant=2)

    # ---- THE ENORMOUS FANTASY CITY SKYLINE --------------------------------
    #
    # THE FOUNDER'S WORDS: "enormous fantasy city skyline", "towers", "layered
    # skyline", and the composition must read all the way out to it. Two
    # castles were closing the north axis and nothing else was; lifting the
    # framing boughs out of the frame opened the top third to 24% SKY, and an
    # empty sky is not the reference -- the reference's sky is FULL of spires.
    #
    # So the horizon gets a real city: three depth bands of castles and towers
    # spread across the whole arc the camera can see, each band smaller, paler
    # and further, which is what makes a skyline read as DEPTH rather than as a
    # row of props. All of it is instanced through the same batching path, so
    # the piece count costs draw calls it does not have.
    _SKY_CITY = 0
    _SKY_BANDS = 0
    _SKY_VARIANTS = {}
    # THE SKYLINE HAS TO OCCUPY THE SKY, not sit under it.
    #
    # environment_density is coverage.objects_pct and it stalled at 81.9 while
    # sky_present read 18.3 -- the two sum to 100, so the metric is capped by
    # how much empty sky the frame has. Adding six ornament rings and 560
    # carpet pieces moved it 0.17 points, because none of that is where the
    # empty space IS.
    #
    # The empty space is the upper third, and the reference fills it with
    # TOWERS -- spires rising past the horizon line, layered front to back.
    # So the near band gets much taller and closer, and a fourth band goes in
    # behind everything. This serves the metric and the founder's "deeper
    # skyline" with the same geometry.
    for _band, (_dist, _scale, _n, _spread) in enumerate((
            # SCALES CUT ~30% WHEN THE SPIRES GOT TALLER.
            #
            # The variant table raised the dominant mass (donjon 1.85 -> 2.55 on
            # the commonest archetype) and the roof half-height with it (2.9 ->
            # 5.8), which is a 1.39x taller tower from the same `s`. At the old
            # scales the skyline closed over the frame: SKY fell to 6.7% and the
            # top third to 19.1% sky, with three donjons owning 24% of that band
            # between them. The reference is a castle city UNDER a blue sky with
            # cumulus — the sky is one of its elements, not what is left over.
            #
            # Cutting the scale rather than the proportion keeps the silhouette
            # that was just won and gives the sky back.
            (31000.0, 5.8, 13, 2.10),     # NEAR band: tall enough to rise into the frame
            (42000.0, 5.2, 17, 2.45),
            (56000.0, 5.0, 21, 2.75),
            (82000.0, 3.8, 25, 3.05))):   # far band, a serrated horizon
        _SKY_BANDS = _band + 1
        for _i in range(_n):
            _a = (_i / float(_n - 1) - 0.5) * _spread + 1.5708
            # jitter so the band is not an arc of evenly spaced identical towers
            # 32 BITS, BECAUSE THE PICK READS BIT 17.
            #
            # This was `& 0xFFFF`. Sixteen bits, and the archetype below selects
            # with `(_h >> 17) % 10` — which is ZERO for every tower in the
            # world. So the four castle archetypes added to give the skyline
            # silhouette hierarchy were never built: all 76 towers took row 1,
            # and the mushroom hamlets never appeared at all. The frame still
            # improved, because row 1's slender roofs are a large gain over what
            # was there, which is exactly why nothing caught it.
            #
            # Same shape as `1.5 + 0.5 * ((_r * 3) % 3) / 2.0` on the hero
            # mushrooms — an expression that reads as variation and evaluates to
            # a constant. The build now counts what it actually made and says so.
            _h = (_band * 7919 + _i * 104729) & 0xFFFFFFFF
            _r = _dist * (0.88 + 0.24 * ((_h >> 3) % 100) / 100.0)
            _cx = math.cos(_a) * _r
            _cy = math.sin(_a) * _r
            # never in front of the great castle, which is the subject
            if abs(_cx - 9000.0) < 6000.0 and abs(_cy - 66000.0) < 9000.0:
                continue
            # HEIGHT VARIES MORE THAN IT DID. 0.78-1.22 is a 1.56x spread, and
            # at four kilometres that reads as one height with noise on it. A
            # skyline steps: some towers are half their neighbour.
            _cs = _scale * (0.62 + 0.86 * ((_h >> 9) % 100) / 100.0)
            # ARCHETYPE, not scale. Weighted so spire clusters dominate (the
            # reference's commonest shape), palaces punctuate, and the twin-
            # tower-and-bridge form is rare enough to stay a landmark.
            # 4 is not a castle at all — it is a cluster of giant mushroom
            # houses, which the reference stands among its spires. Two in ten,
            # so they punctuate the skyline rather than colonising it.
            _var = (1, 4, 0, 1, 2, 1, 4, 3, 1, 2)[(_h >> 17) % 10]
            # Past about four kilometres, merlons, bridge parapets and secondary
            # domes are a fraction of a pixel each. The near band keeps them
            # because it is the one that rises into the frame.
            if _var == 4:
                # a hamlet of them, unequal, with a small tower for scale
                for _m, (_mo, _ms, _mc) in enumerate(((0.0, 1.00, "mush_red"),
                                                      (1.9, 0.62, "mush_purple"),
                                                      (3.6, 0.78, "mush_red"),
                                                      (5.1, 0.45, "mush_white"))):
                    kit_mushroom_house(_cx + math.cos(_mo) * 900.0 * _cs,
                                       _cy + math.sin(_mo) * 900.0 * _cs,
                                       _cs * 0.62 * _ms,
                                       "SkyMush%d_%d_%d" % (_band, _i, _m), _mc)
                kit_spire(_cx, _cy, _cs * 0.55, "SkyMushTow%d_%d" % (_band, _i),
                          body_mat="spire_far", roof_mat="roof_pink",
                          flag=True, roof_w=1.52, roof_h=5.2)
            else:
                kit_castle(_cx, _cy, _cs, "SkyCity%d_%d" % (_band, _i),
                           variant=_var, far=(_band >= 1))
            _SKY_VARIANTS[_var] = _SKY_VARIANTS.get(_var, 0) + 1
            _SKY_CITY += 1
    # ---- THE ORNAMENTAL MIDGROUND -----------------------------------------
    #
    # THE FOUNDER'S LIST, VERBATIM: flowers, roses, mushrooms, ornamental gates,
    # arches, hedges, clocks, lamps, fountains, tea-party props, towers. "The
    # world should be visually DENSE. Every major part of the frame should feel
    # authored."
    #
    # The storey between the flower beds at the camera's feet and the city on
    # the horizon was mostly empty ground -- coverage.objects_pct reads 81.5
    # against a target of 85, and an empty middle distance is exactly what makes
    # a world read as a blockout however good its edges are.
    #
    # So the midground gets furnished, on arcs at three depths, with the props
    # the reference actually contains. Everything routes through the same
    # instanced batching path, so the piece count costs draw calls it does not
    # have.
    def _clear_of_dogs(px, py, radius=560.0):
        """Nothing may be planted close enough to bury a Relay Dog."""
        for _dx, _dy in _DOG_POS:
            if math.hypot(px - _dx, py - _dy) < radius:
                return False
        return True

    _ORN = 0
    # DENSITY, PUSHED. coverage.objects_pct read 81.8 against a target of 85
    # and the founder's instruction is explicit: "The world should be visually
    # DENSE. Every major part of the frame should feel authored." Three rings
    # became six, and each ring carries half again as many pieces -- gates,
    # arches, teacups, topiary, lanterns and beds all the way out to the
    # skyline, so there is no band of empty ground between the flowers at the
    # camera's feet and the city on the horizon.
    # GARDEN ROOMS, NOT SIX EVENLY SPACED RINGS.
    #
    # What was here: six concentric rings, 22 to 42 ornaments each, placed at
    # `(_i / _count) * 2*pi` — EXACTLY even angular spacing — cycling through
    # seven kinds by `(_i + _ring) % 7`. 192 full kits and 960 mushrooms at
    # their feet, 24,759 instanced pieces. Two things follow from that
    # construction and both are visible in the hero frame:
    #
    #   * Even spacing at even radii is a GRID in polar coordinates. It is what
    #     produces the row of identical gold lanterns marching across the shot
    #     at one height, and the identical cypress cones between them. The art
    #     direction's word for it is "procedural city look", and its rule is
    #     "DENSITY != RANDOM SCATTER... decorative props occupy intentional
    #     pockets".
    #
    #   * One kind in seven was `kit_gate`, so Wonderland had 27 golden gates
    #     standing in the flowerbeds. A gate is a THRESHOLD — it is the thing
    #     the district is named for and the reference's single most recognisable
    #     object. Twenty-seven of them in the shrubbery is the surest way to
    #     make the real one read as garden furniture. There is now exactly one.
    #
    # Replaced with composed pockets: a bearing, a depth, and three to five
    # RELATED props gathered tightly enough to read as one arrangement, with
    # open ground between the pockets. Bearings are chosen, not stepped — they
    # avoid the hero corridor, alternate sides irregularly, and the depths do
    # not line up. About 50 ornaments where there were 192.
    #
    # Bearing 0 is +X (screen LEFT, looking up +Y); pi is screen right.
    _POCKETS = (
        # bearing, radius, scale, contents
        (0.20, 1950.0, 0.95, ("teacup", "topiary", "lantern")),
        (2.92, 2150.0, 1.00, ("heart", "bed", "lantern", "topiary")),
        (0.66, 2900.0, 1.25, ("arch", "bed", "topiary")),
        (2.44, 3150.0, 1.30, ("teacup", "lantern", "topiary", "bed")),
        (1.02, 4050.0, 1.55, ("arch", "topiary", "heart")),
        (2.08, 4400.0, 1.60, ("arch", "lantern", "topiary")),
        (0.34, 5350.0, 1.95, ("topiary", "topiary", "bed")),
        (2.76, 5700.0, 2.00, ("teacup", "topiary", "lantern")),
        (1.57, 6700.0, 2.40, ("arch", "arch")),          # closes the walk
        (0.88, 7300.0, 2.40, ("topiary", "heart")),
        (2.30, 7500.0, 2.40, ("arch", "topiary")),
    )
    for _pi, (_pa, _rad, _sc, _kinds) in enumerate(_POCKETS):
        for _i, _kind in enumerate(_kinds):
            # tight cluster: the members of a pocket are one arrangement, so
            # they sit within a couple of metres of each other and turn to face
            # slightly different ways.
            _jh = (_pi * 2654435761 + _i * 40503) & 0xFFFFFFFF
            _ja = _pa + (((_jh >> 3) % 100) / 100.0 - 0.5) * 0.13
            _jr = _rad + (((_jh >> 11) % 100) / 100.0 - 0.5) * 520.0
            _ox = math.cos(_ja) * _jr
            _oy = NEAR_Y + 500.0 + math.sin(_ja) * _jr * 0.72
            if in_camera_lap(_ox, _oy, 300.0):
                continue
            if not _clear_of_dogs(_ox, _oy, 700.0):
                continue
            _lb = "Orn%d_%d" % (_pi, _i)
            if _kind == "arch":
                kit_arch(_ox, _oy, 0.80 * _sc, _lb)
            elif _kind == "heart":
                kit_heart_topiary(_ox, _oy, 0.0, 0.85 * _sc, _lb)
            elif _kind == "teacup":
                kit_teacup(_ox, _oy, 0.75 * _sc, _lb)
            elif _kind == "topiary":
                kit_topiary_form(_ox, _oy, 0.95 * _sc, _lb,
                                 form=("cone", "ball", "spiral")[(_pi + _i) % 3])
            elif _kind == "lantern":
                kit_lantern(_ox, _oy, 0.90 * _sc, _lb)
            else:
                kit_bed(_ox, _oy, 150.0 * _sc, _lb,
                        palette=("petal_violet", "rose_pink", "petal_pink"))
            _ORN += 1
            # Caps at the foot of the DOMINANT member only, so a pocket has one
            # base of planting rather than five competing rings of it.
            for _c in range(3 if _i == 0 else 0):
                _ca = _c * 2.094 + _pi
                kit_mushroom(_ox + math.cos(_ca) * 150.0 * _sc,
                             _oy + math.sin(_ca) * 150.0 * _sc,
                             0.34 + 0.20 * (_c % 3) / 2.0,
                             "%s_cap%d" % (_lb, _c),
                             ("mush_red", "mush_purple", "mush_white")[(_pi + _c) % 3])
    # ---- FLOWER CARPET -------------------------------------------------
    # The reference has NO bare ground anywhere -- every square metre carries
    # planting. Between the ornament rings there was still open floor, and open
    # floor is what makes a world read as a level under construction. This is a
    # deterministic scatter of small beds and caps across the whole visible
    # plate, thinning with distance so the near field stays richest.
    #
    # AND IT NEVER ASKED THE PAVING RULE. `_on_paving` exists so that nothing
    # which grows out of soil is scattered onto stone, and five passes ask it.
    # This one — 560 mushrooms, beds, shrubs and topiary spread over the whole
    # plate — checked the camera lap and the Dogs and nothing else, so it sowed
    # the plaza. In the native render the foreground is a carpet of pink and
    # violet caps with the cobble showing through in patches, where the
    # reference has an open stone courtyard with the Dog standing on it.
    #
    # The sentence at the top of this block is the reason it happened. "No bare
    # ground anywhere" is true of the reference's PLANTING BEDS and false of its
    # PLAZA, and a rule written from the first half covers the second.
    #
    # Pushed to the verge rather than dropped — `_off_paving_lateral` holds the
    # depth and moves outward, so the density lands along the edge of the stone
    # where the reference banks its flowers. 320 rather than 560, because each
    # one is more visible once it is not competing with the others.
    _CARPET = 0
    for _c in range(320):
        _h = (_c * 2654435761) & 0xFFFFFFFF
        _ca = (_h % 3600) / 3600.0 * 2.0 * math.pi
        _cr = 620.0 + ((_h >> 12) % 6200)
        _cx = math.cos(_ca) * _cr
        _cy = NEAR_Y + 300.0 + math.sin(_ca) * _cr * 0.78
        _cx, _cy = _off_paving_lateral(_cx, _cy, _h)
        if in_camera_lap(_cx, _cy, 220.0):
            continue
        if not _clear_of_dogs(_cx, _cy, 520.0):
            continue
        _pick = (_h >> 5) % 10
        _lb = "Carpet%d" % _c
        if _pick < 4:
            kit_mushroom(_cx, _cy, 0.26 + 0.22 * ((_h >> 9) % 3) / 2.0, _lb,
                         ("mush_red", "mush_purple", "mush_white")[(_h >> 7) % 3])
        elif _pick < 7:
            kit_bed(_cx, _cy, 86.0 + 54.0 * ((_h >> 11) % 3) / 2.0, _lb,
                    palette=(("petal_violet", "rose_pink", "petal_pink"),
                             ("rose_pink", "petal_pink", "rose"),
                             ("petal_pink", "petal_violet", "rose_pink"))[(_h >> 13) % 3])
        elif _pick < 9:
            kit_shrub(_cx, _cy, 0.42 + 0.28 * ((_h >> 15) % 3) / 2.0, _lb,
                      bloom=("rose_pink" if _pick % 2 else "petal_violet"))
        else:
            kit_topiary_form(_cx, _cy, 0.55 + 0.30 * ((_h >> 17) % 3) / 2.0, _lb,
                             form=("cone", "ball", "spiral")[(_h >> 19) % 3])
        _CARPET += 1
    unreal.log_warning("FLOWER CARPET: %d beds, caps, shrubs and topiary across "
                       "the whole visible plate - the reference has no bare "
                       "ground anywhere" % _CARPET)

    # No gates, and no rings. The rings became composed pockets and kit_gate
    # left this pass entirely, because a threshold is not garden furniture.
    unreal.log_warning("ORNAMENTAL MIDGROUND: %d arches, teacups, topiary, "
                       "lanterns and beds in %d composed pockets - the storey "
                       "between the flowers and the skyline was empty"
                       % (_ORN, len(_POCKETS)))

    # "castles across three depth bands" was true when it was written and is
    # now two errors: there are FOUR bands, and a seventh of the sites are
    # mushroom hamlets rather than castles. The line below reports what the loop
    # actually did instead of describing what it was written to do.
    unreal.log_warning("SKYLINE CITY: %d sites across %d depth bands - the "
                       "founder asked for an enormous fantasy city skyline and "
                       "the horizon held two" % (_SKY_CITY, _SKY_BANDS))
    # WHAT WAS ACTUALLY BUILT, NOT WHAT WAS ASKED FOR.
    #
    # The archetype table sat in this file for a whole pass selecting nothing,
    # because the hash it reads was masked to sixteen bits and the pick shifts
    # by seventeen. Nothing downstream could notice: the tower count was right,
    # the frame looked better, and the only wrong thing was that every silhouette
    # was the same one. So the generator now COUNTS the archetypes it emitted and
    # fails loudly if the skyline collapsed back onto one shape — an assertion
    # about the world, made by the thing that built it.
    unreal.log_warning("SKYLINE VARIANTS %s across %d sites"
                       % (sorted(_SKY_VARIANTS.items()), _SKY_CITY))
    if _SKY_CITY and len(_SKY_VARIANTS) < 3:
        unreal.log_error(
            "SKYLINE COLLAPSED TO %d ARCHETYPE(S) %s: the variant pick is not "
            "selecting. The skyline is meant to carry spire clusters, citadels, "
            "palaces, twin-tower spans and mushroom hamlets; one shape repeated "
            "76 times is the procedural-city look the art direction forbids."
            % (len(_SKY_VARIANTS), sorted(_SKY_VARIANTS)))
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
    #
    # AND IT MUST ASK THE KEEP-OUT. At (620, -190) it stands 960 uu from the
    # arrival lens, where the frame is 736 uu wide to each side — so it was
    # inside the blind foreground, in front of the camera, and it owned 12.11%
    # of the bottom third of the hero frame as a pale slab lying across the
    # plaza. Its terrace asks the rule through kit_dispatch; the belvedere on
    # top of the terrace was placed by hand here and never did, so the two
    # halves of one landmark ended up in different places.
    _bx, _by, _bmoved = _push_out_of_lens(620.0, -190.0, "OverlookBelvedere")
    if _bmoved:
        unreal.log_warning("BELVEDERE pushed out of the arrival lens to (%.0f, %.0f)"
                           % (_bx, _by))
    kit_belvedere(_bx, _by, 0.72, "OverlookBelvedere")

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
    # A CASCADE HANGS FROM SOMETHING.
    #
    # Two of these were at (+-250, -300) with a top at z=660 — open ground 850 uu
    # in front of the arrival camera, with nothing above them. So the two most
    # visible strands in the hero frame sprang out of thin air at eye height,
    # which is why they read as poles however good the foliage on them became:
    # a hanging plant with no host is not a hanging plant.
    #
    # Every strand now springs from a structure that is actually there — the
    # gate piers, the rose arch, the pergola and the great framing tree's
    # canopy, which is where the reference drapes its wisteria.
    for i, (vx, vy, vt, vd) in enumerate([(-1290, 400, 740, 520), (-810, 400, 740, 520),
                                          (-230, 820, 430, 330), (230, 820, 430, 330),
                                          (670, 460, 610, 420), (970, 460, 610, 420),
                                          (1160, 560, 980, 600), (1430, 420, 940, 560),
                                          (1300, 660, 1010, 640)]):
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
        # THE THIRD PASS THAT SOWED THE PLAZA. `_on_paving` exists so nothing
        # growing out of soil is scattered onto stone, and this one — the tufts
        # and flowers, over a thousand of each — checked the arcane circle and
        # the Dog's stage and nothing else. Grass does not grow through
        # cobblestone, and in the native render the courtyard reads as a lawn
        # with paving showing through it.
        #
        # Moved to the verge rather than dropped, so the near field keeps its
        # density exactly where the reference puts it: banked along the edge of
        # the stone, with the stone itself open.
        gx, gy = _off_paving_lateral(gx, gy, (i * 2654435761) & 0xFFFFFFFF)
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
    # `_on_stone` USED TO BE A SECOND COPY OF `_on_paving`, character for
    # character including its 1,180 literal. Two definitions of one rule that
    # must agree and can drift apart independently — the same per-call-site
    # duplication `_push_out_of_lens` opens its docstring by naming, and it
    # would have kept fungus growing on 1,120 uu of newly laid stone the moment
    # the plaza widened. Delegated, so there is one rule again.
    def _on_stone(gx, gy):
        return _on_paving(gx, gy)

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
        (0, ARRIVAL_CAM, (0.0, 120.0, 170.0), 62.0),                  # ARRIVAL_HERO — plaza onto circle + tree
        (1, (300.0, -430.0, 205.0), (0.0, 60.0, 190.0), 52.0),        # DOG_CLOSEUP — the hero Dog's visor + gold eyes
        (2, (-250.0, -380.0, 430.0), (-1010.0, 360.0, 300.0), 52.0),  # GOLDEN_GATE — ornate heart-crest gate
        (3, (1300.0, -360.0, 540.0), (1300.0, 470.0, 680.0), 64.0),   # GIANT_TREE — the great framing tree
        (4, (560.0, -980.0, 380.0), (540.0, -250.0, 150.0), 58.0),    # MISSION_OVERLOOK — overlook terrace
        (5, (760.0, -180.0, 340.0), (795.0, 410.0, 150.0), 56.0),     # AGENT_GARDEN — agent_config + pergola + flowers
        # ARRIVAL_WIDE. Same POSITION as HeroCam0 on purpose: the Marble
        # backdrop is anchored at that exact point, so every ray from it is
        # unchanged by the shell's 6x scale, and a second camera there gets the
        # backdrop for free. Only the AIM differs.
        #
        # Measured, not guessed. HeroCam0 is pitched -11.6 deg to frame the hero
        # Dog on its arcane circle, so its frame spans elevation -30.2..+7.1 --
        # and the Marble castle city sits around +21 deg. 0.9% of the skyline
        # reaches that frame: essentially none of the 1,580 credits of castle
        # city is visible in the shot the world opens on. No yaw fixes it; the
        # limit is elevation. (wonderland/marble/preview-offline.py, on CPU.)
        #
        # 75 deg at +5 deg pitch spans -18.4..+28.3, which holds the Dog at
        # -11.6 AND 29.9% of the skyline. Wider gains little: 80 deg buys 0.8
        # more points and 90 deg starts to read as a fisheye.
        (6, ARRIVAL_CAM, (0.0, 120.0, 541.0), 75.0),                  # ARRIVAL_WIDE — Dog, plaza AND the Marble skyline
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

    # ---- THE MATERIAL TEST STRIP -----------------------------------------
    #
    # WHY THIS EXISTS. The grey has now survived: a runtime probe proving every
    # batch binds its intended material with zero mismatches; an offline dump
    # proving all 59 instances are written albedo at saturation 0.49-1.00; a
    # controlled rebuild that raised MI_stone from 0.54 to 0.71 and moved the
    # frame 1.4%; and nine separate show-flag sweeps -- bloom, fog, aerial
    # perspective, AO, SSR, specular, Lumen indirect, the tonemapper and the
    # colour grade -- none of which moved delivered saturation by more than
    # 0.022. Inside a single mushroom cap NO pixel exceeds saturation 0.135
    # against an albedo of 0.536, so it is not an averaging artifact either.
    #
    # Every one of those measurements had to be ATTRIBUTED to a material, and
    # attribution is where this investigation has repeatedly gone wrong: the
    # offline owner buffer reads thin geometry as its background, and the
    # forensic trace filtered on five material names while the two that
    # actually cover the frame -- spire_far at 35,650 pieces and mush_white at
    # 27,488 -- were not among them.
    #
    # So this stops inferring. A row of large flat quads stands directly in
    # front of the hero camera, one per material, each filling hundreds of
    # pixels of a SINGLE known material. One frame then reads the delivered
    # colour of each material directly, with nothing to attribute and nothing
    # averaged across neighbours.
    #
    # OFF BY DEFAULT. It is an instrument, not scenery: WONDERLAND_TEST_STRIP=1
    # puts it in the world and nothing else does.
    if os.environ.get("WONDERLAND_TEST_STRIP", "") == "1":
        # Ordered so the two materials that dominate the frame come first.
        _strip = ["mush_white", "spire_far", "stone", "spire", "porcelain",
                  "cobble", "plaza", "mush_red", "foliage", "petal_pink",
                  "gold", "roof_rose"]
        # HeroCam6 stands at ARRIVAL_CAM looking at (0, 120, 541) -- essentially
        # straight down +Y. The strip is laid across that view at a distance
        # near enough to fill the frame and far enough not to clip the near
        # plane, low enough to sit under the skyline rather than hide it.
        _sd   = 620.0                 # uu in front of the camera
        _sy   = ARRIVAL_CAM[1] + _sd
        _sz   = ARRIVAL_CAM[2] - 96.0
        _sw   = 132.0                 # width of each panel, uu
        _n    = len(_strip)
        _x0   = -0.5 * (_n - 1) * _sw
        for _i, _mn in enumerate(_strip):
            static_mesh("cube",
                        (_x0 + _i * _sw, _sy, _sz),
                        (_sw / 105.0, 0.06, 1.05),
                        "teststrip_%02d_%s" % (_i, _mn),
                        mat=_mn)
        unreal.log_warning("TEST STRIP: %d material panels in front of HeroCam6 "
                           "(WONDERLAND_TEST_STRIP=1)" % _n)


    # ---- EMIT THE BATCHES ------------------------------------------------
    # LAST, and before the save. Every visual piece placed above went into an
    # accumulator instead of becoming an actor; this is where those become a
    # handful of AWonderlandInstancedBatch actors. It has to run before
    # save_map or the world reaches disk with its decoration missing entirely —
    # which is the one failure mode of this change, so it is stated here rather
    # than discovered on a GPU.
    _batches_placed = 0
    _pieces_placed = 0
    if BATCH_VISUALS:
        _batches_placed = emit_batches()
        _pieces_placed = sum(len(b["xf"]) // 9 for b in _BATCHES.values())
        if _BATCHES and _batches_placed == 0:
            unreal.log_error(
                "BATCHING PRODUCED NOTHING while holding %d pieces. The world "
                "about to be saved has no decoration in it. Do not cook this."
                % _pieces_placed)
            # RAISE, do not continue. Saving here writes a valid, cookable,
            # streamable map with nothing in it — and every later step reports
            # success. build-wonderland.sh also checks the printed piece count,
            # because an exception inside -run=pythonscript does not reliably
            # fail the process; two gates because one of them is unreliable and
            # neither of them is expensive.
            raise RuntimeError(
                "refusing to save a Wonderland with no decoration in it "
                "(%d pieces were held and 0 batches were placed)" % _pieces_placed)

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
    # AT WARNING LEVEL, and it names both numbers. `actors` alone stopped meaning
    # "how much world is there" the moment decoration was batched: a healthy
    # Wonderland now reports a few hundred actors carrying tens of thousands of
    # pieces, and a log line showing only the first would read as a world that
    # had collapsed. WonderlandWorldProof gates on PIECES for the same reason.
    unreal.log_warning(
        "LIFECYCLE saved=%s actors=%d batches=%d instanced_pieces=%d level=%s"
        % (saved, _n, _batches_placed, _pieces_placed, layout["level"]))
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
