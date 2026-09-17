# GS01 -- lawn breakup on the HD master: tried, NOT KEPT (2026-09-17)

Gap: the lawns (MI_V2_Lawn / Meadow / Moss, ~half of all visible ground) read as one uniform carpet at Lantern Lane,
the Teapot and the gardens. They sit on M_V2_Surface with the V2 sward texture (lawn_mis_before.json), so they have
no macro (~60 m) colour breakup and no per-instance variation. MQ09's grass texture was rejected on 09-16.

Tried (reparent_mi.py, now able to set texture parameters): the three lawn instances on M_V2_SurfaceHD, keeping their
sward maps and colour, adding T_HD_macro and per-instance tone:
| s1 | MacroVary 0.10, InstVary 0.05, InstWarm 0.02, NormalStrength 1.2, DetailStrength 0.4 |
| s2 | MacroVary 0.22, InstVary 0.08, InstWarm 0.05, NormalStrength 1.5, DetailStrength 0.6 |
(gs01_sets.json; 9 identical cameras, gs01_ab1.jpg / gs01_ab2.jpg)

Judgement: no visible gain at any camera -- near and far the lawns read the same; the macro map's low contrast is
swamped by the sward's own pattern, and a stronger breakup risks the noise the founder warned against.
Reverted (reverted.json: all three restored). Nothing saved.

The lawn is a geometry / density problem more than a material one: a later pass should try grass tufts or a cheap
grass-card layer at the lawn edges and near the hero paths, measured for cost.
