# WIN01 -- the city's windows stop reading as royal-blue glitter tiles (2026-09-16)

Survey sv4 (24 cameras) against BOARD_1/BOARD_2: the gardens and hero avenue hold; the least Wonderland-like views are
the eight street cameras, where every facade is covered in saturated royal-blue, sparkling window shapes. Census: they
are SM_glass_screen_panes StaticMeshActors -- 12,187 on MI_V2_WindowDark, 1,279 on PaneAmber, 1,262 on PaneTeal.
WindowDark was BaseColor (0.14, 0.19, 0.42), Roughness 0.18, TexScale 0.005: a bright blue that LOOK01's saturation
lifts further, glittering in the sun.

Variants, same session, MI in memory only (record.json keeps the original for REVERT):

| id | treatment | judgement |
|---|---|---|
| wa | near-black slate (0.06, 0.065, 0.09), rough 0.30 | punched black holes; facades look burnt |
| wb | muted slate-blue (0.10, 0.14, 0.20), rough 0.26 | reads as glass, still glittery |
| wc | warm amber interior, emissive 500 | panes read as gold panels, windows lose definition |
| **wd** | slate-blue (0.10, 0.14, 0.20), rough 0.12, spec 0.6, TexScale 0.0002 | **chosen**: dark glass reflecting the sky, like the Bible's blue glass in cream/gold frames |
| we | as wd, rough 0.35 | matte grey; windows fade into the wall |

Applied and saved: wd. PaneAmber / PaneTeal untouched (they already read as warm and green-teal accents).
Not solved by a material: the pane mesh's small off-grid fragments around the window grids (geometry).
