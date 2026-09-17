# WB01: the city's walls stand on a plinth course (SAVED 2026-09-17)

## Gap
Founder material-realism phase, contact depth. A contact survey of street-level wall bases (CT_base_0..5) found
every generator wall meeting the paving on one hard line: no base course, no shadow line, a box set down on a floor.

## Three cuts, same session, identical cameras
Poses: `wb01_poses.json` (CT_base_0..5 plus six street cameras) and `ee54_poses.json` (two close views).

| cut | what | result |
|---|---|---|
| 1 (tagged PL01) | `WL_Detail_Plinth_Run`: a 4 m jointless band with a dark foot strip, on census box faces (3,904 instances) | Grounded walls at close range, but read as a poured concrete kerb, and ran straight across an arch and gate (CT_base_2). Removed and saved clean before editor 84 closed. `cut1_run_*.jpg` |
| 2 | Forge `WL_Detail_Plinth_Block` (5a9e5b4d): one 1 m block, 36 tris, chamfered top and ends so butted blocks meet in a V-joint. Laid at 0.8-1.25 m per block, seeded per face. Skips 210 arch, gate, pier, gatehouse and steps spans. | Reads as stone blocks and stops at the gate. But at CT_base_0 the course stood half a metre out from a recessed facade, like an empty trough. `cut2_*.jpg` |
| 3 | The same blocks seated on each mesh's real outline at its foot, with ground heights from traces | Tight to the wall at every contact camera; no troughs. `cut3_*.jpg` |

The pass was first tagged PL01, which an older, saved castle pass already uses (5 palace-wing batches). Removal was exact
because tags are `WL_PASS_<pass>`. The rename to WB01 keeps the two apart.

## Why cut 2 floated: census box face is not the wall
The generator walls are batch instances with no editor collision. `wall_contact_probe.py` hit a wall at 31 of 5,944
points, so traces can't find them. `mesh_sections.py` slices each mesh horizontally instead (`wall_sections.json`):
- **SM_castle_hall:** bounds ±630 × -430..438, but the wall is ±600 × ±400 from the foot to 8 m. Only the cornice
  reaches the bounds.
- **SM_facade_panel:** bounds -86..37 in Y, but the front wall is at -30. Pilasters reach -50 from 20 cm up, and
  balconies reach -86.
- **SM_castle_tower_square:** the bounds are the wall.

Each face is now seated on the foot section: mean depth 31 cm behind the box face, and the span is the true wall
length. Ground: 535 blocks stand on moss-covered `Cube` ground 26 cm below the street tile's top. A ground trace per
block (`wb01_contact.json`, rerun on the seated positions) sets 5,447 of 5,457 heights.

Final layer: 20 `wb01_<prefix>.json` files, 650 faces, 5,457 blocks, one `MI_V2_IvoryStone` batch per prefix, no
collision, cull at 60 m.

## Judgement (cut 3)
- **CT_base_1 and CT_base_4:** a jointed stone course, each block its own tone. The walls now stand on something.
- **CT_base_2:** the course stops at the gate pier.
- **CT_base_0 and CT_base_5:** tight to the wall in shade.
- **City_FillEE54:** a subtle pale course; the close views show it jointed, with sill shadows falling on it.
- **Street and far cameras** (FillE51, South34, NarrowStreet43): no visible change and no noise.

Better at contact range and neutral elsewhere, with no defect found. KEPT.

## Performance
`perf_remove_ab.json`: PIE, same session, 20 batch actors destroyed, median frame ms. There is now a WARM pass
before ON, so the ON-first warm-up bias FD03 showed is gone.

| camera | R1 on | R1 off | R1 off2 | R2 on | R2 off | R2 off2 |
|---|---|---|---|---|---|---|
| City_FillEE54 | 27.73 | 31.52 | 29.15 | 30.20 | 27.33 | 27.72 |
| South_StreetHero34 | 28.12 | 28.75 | 30.60 | 30.66 | 31.41 | 28.33 |
| City_FillNE48 | 27.83 | 30.25 | 29.34 | 33.62 | 30.11 | 27.75 |
| City_FillW52 | 60.29 | 59.89 | 60.90 | 58.59 | 59.93 | 58.74 |

Mean ON 37.1, OFF 37.4, OFF-again 36.6. The difference is inside the ±3 ms noise between the two OFF windows: no
measurable cost.

## Saved
Map saved with `save_current_level` at 09:45; the umap mtime changed, and no dirty maps or content remained. Editor
86 reloaded 20 WB01 actors and 5,457 instances.
