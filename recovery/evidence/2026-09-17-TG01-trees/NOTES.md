# TG01: groves in the open lawn (SAVED 2026-09-17)

## Gap
After GC01 planted borders and garden groups, a 16-camera survey still showed one thing above all: a hero street view
(SW_StreetGate46) whose entire foreground is an unbroken green plane, with the same emptiness behind the south and
west quarters. Beds and shrubs sit at ankle height. What those views lacked was SILHOUETTE -- something standing up
in the middle distance and casting shade.

## Measured, not invented
The world already grows trees: 412 trunks and 850 canopies. `tree_pairs.json` samples them and pairs each trunk with
its canopy, so this pass copies the world's own composition:
- slender trunk (13.0 m) carries a medium canopy; mature trunk (19.4 m) carries a large one;
- the canopy sits at 0.77 (slender) / 0.67 (mature) of the scaled trunk height;
- its scale is ~1.15-1.30 of the trunk's;
- leaf colours follow the world's mix (LeafMid, LeafLight, LeafDark, LeafCream), with occasional blossom.

## Placed
89 trees (53 slender, 36 mature) in loose groves of two to four, on open lawn only, clear of paving by 7 m, of
buildings by 5 m, and of every existing prop by its own radius.

**A tree may not eat a view.** Nothing is placed within 15 m of a gameplay camera's standing point, nor inside an
18-degree cone of what that camera looks at within 40 m: 576 candidates were refused on that rule alone, and 1,059
for want of room. The Golden Arrival hero shot is pixel-identical before and after, which is the check that matters.

## Judgement (identical cameras, one session; `tg01_poses.json`)
- `SW_StreetGate46`: a mature tree now stands in the middle distance with its shadow across the grass. The plane is
  broken and the view has depth.
- `SW_PlazaHero41`, `South_Market35`, `HamletCam17`: a tree each in the middle ground; the quarters read planted.
- `HeroCam_GoldenArrivalBible`: unchanged, as intended.
- `WorldCam12` (aerial): a little more green mass, no noise.

## Performance
`perf_remove_ab.json`, PIE, same session, WARM window, 66 pass actors destroyed: mean ON 66.7 ms, OFF 67.7,
OFF-again 73.3. ON is the lowest of the three. The numbers drift upward across the run (OFF-again is worst at three
of four cameras), so this window says only "no measurable cost" -- it is not precise enough to say more.

## Saved
178 instances (89 trunks + 89 canopies) confirmed in the map, umap mtime changed, nothing left dirty.
