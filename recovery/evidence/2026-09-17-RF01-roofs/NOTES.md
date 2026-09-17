# RF01 -- one roof family: blue and navy roofs join the HD master (2026-09-17)

Material-realism phase, roofs. Census (tower_census.json): 491 generator roof pieces, almost all SM_roof_cone_steep
and SM_roof_ogee, on Rose 163, Pink 130, Lilac 68, Blue 61, Terracotta 48, Navy 21.

Survey (rf01_survey.jpg, 5 gameplay/skyline cameras + a close elevated look at one low roof per colour): the fish-scale
roof tiles already read up close, so the roof texture is not the gap. What was wrong is consistency (roof_mis_before.json):
Rose / Pink / Lilac are on M_V2_SurfaceHD with the HD roof set (per-instance tone, macro breakup, detail normal), but
Blue and Navy were still on the old M_V2_Surface with the V2 roof texture at a different scale -- one roof family
rendering two ways. The cones' low-poly faceting is geometry, not material (a Blender candidate).

Fix: apply_hd_materials.py ONLY [MI_V2_RoofBlue, MI_V2_RoofNavy] -- each takes its MQ01 HD twin's values and maps on
the HD master (applied.json; record hd_apply_record.json, REVERT restores; the job saves as it applies).

Judgement (rf01_ab.jpg): the navy cone and blue onion dome read as larger overlapping fish-scale tiles with per-tile
tone and overlap shadow instead of a fine repeat; no change at city distance, no regressions. Kept.
Performance: same master family as the other roofs, no geometry.
