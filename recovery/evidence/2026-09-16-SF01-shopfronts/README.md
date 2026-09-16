# SF01 -- shopfronts and awnings on the city's street-facing ground floors (2026-09-16)

After SC01 warmed the streets and SD01 planted them, the largest grey-box signal at street level was the buildings:
blank walls at a visitor's eye height. SF01 puts the forge's WL_House_Shopfront (three glazed bays on columns under
a fascia) with a WL_Market_Awning above it on 81 street-facing ground-floor walls in ten districts.

## Where, computed

Walls are generator batch instances with no editor collision, so building_census.py (new) reports every castle hall,
facade panel and tower as an oriented box, and a box's vertical faces are its walls. A face qualifies when its base is
at street level, it faces back across a real street edge, it is wide enough for a shop, and it stands between -4.5 m
and +12 m of the edge -- measured, after the first band (-0.3..3 m) found 9 facades in 619 edges because buildings
overlap their street or stand behind a green verge.

## Four previews, and a manifest that is mirrored

| preview | result |
|---|---|
| sf01a | amber glass facing the street -- but every shop stood 72 cm off its wall on the lawn |
| sf01b | "corrected" to the kit manifest and the forge source (+Y projection): grey backs to the street |
| sf01c | a lit glass material; the glass showed only from cameras BEHIND a shop |
| **sf01d** | flush, facing the street, warm lit windows, lilac awnings -- **kept** |

`kit_bounds_in_unreal.json`: the imported WL_House_Shopfront_glass sits at Y -94..-86 and the awning reaches Y -256.
**kit_modules.json and the forge source describe modules in Blender's right-handed space; the FBX import mirrors Y.**
Any asymmetric kit module placed from the manifest's extent faces into its wall. Measure the imported mesh first.

The kit's GlassAmber (roughness 0.09, specular 0.85) mirrored grey walls at eye level, so shop glass uses a new
MI_V2_ShopGlow: rough, warm, lit from inside.

## Street planting re-applied

SD01 now leaves planters off the edges a shop fronts (a planter does not stand between a street and a shop window),
and what stands at a position is a hash of the position rather than a running sequence -- the sequence form made the
clearance answers drift twice. Re-probed and re-applied: 707 pieces, 222 lamps.

81 shops x ~6 parts is about 600 instances, far below the scale that needs a cost measurement. Map saved.
