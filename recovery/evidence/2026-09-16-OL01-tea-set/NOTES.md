# OL01 -- the world's tea things become porcelain (2026-09-16)

Gap: after TP01 the Tea Terraces' teapot is porcelain, and every generator tea cup, small cup, saucer and pot around
the world was still faceted one-material plaster. tea_census.py: 46 -- 12 cups, 9 small cups, 19 saucers, 6 pots, in
8 groups (FlankL/R at the arrival, S01, S15, C18, D04, Way0396, and the teapot's own cup and saucer).

Assets (forge 20983a25 / 4ea003a4, imported in kit_import.json with the banner, lanterns, windows and tower oriel:
21 parts, 0 failed): WL_Object_TeaCup (open thin wall, gold rim and foot, handle, rose band), WL_Object_TeaSaucer
(well, gold well line and edge); pots use the TP01 WL_Object_TeapotPavilion scaled down.

Pass (ol01_tea_set.py): each old actor sunk 60 m by a recorded actor trim (trim_result.json: 46 changed, 0 refused;
REVERT restores); its replacement at the same x, y, yaw, scaled to the old one's size (cups and pots by height,
saucers by width), standing on the old bounds' bottom -- the generator's pots have pivots 0.9-2.9 m up, so placing at
the pivot floated them. Duplicate stacks (S15 Saucer0/Saucer4 at one spot) are replaced once. A cup on a saucer sits in
its well. 43 pieces, 144 actors.

Judgement: ol01_ab.jpg (TeapotCam24 + group close-ups; C18 / S01 / Way0396 poses were blocked by walls) and
ol01_elevated.jpg (two elevated views per group): porcelain sets with rims and roses everywhere the camera reaches;
teapots on their plinths, nothing floating or buried. A shrub grows through one FlankR cup where the plaster cup
also stood -- it reads as a teacup planter. Kept. Saved: saved.json.
