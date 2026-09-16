# FD01 -- balconies on the street walls (2026-09-16)

Gap (after WIN01): the street cameras still read as flat ashlar boxes with window grids from the shopfronts to the
roof; the Bible's streets are made of projections. The forge already had two flat-backed wall clip-ons, imported:
WL_Detail_Balcony_Bracket and WL_Detail_Oriel_Bay.

Placement is computed from the city's own windows (pane_census.py: 14,744 SM_glass_screen_panes actors): a pane on a
building face (building_census) whose normal looks onto a street tile, at least a storey up (the first-storey band at
~3.1 m would put corbels at head height and into SF01's awnings). A balcony stands under its window.

| preview | what | judgement |
|---|---|---|
| fd01a (4 districts) | 136 balconies + 117 oriels | balconies read as real balconies; EVERY oriel is a blank grey box on a cone -- the forge module's glazing prism sits inside its solid stone prism (fd01_close.jpg) |
| fd01b (all 14) | 235 balconies, oriels off | good; one balcony found under a 3.3x gold balustrade band |
| fd01c (all 14) | 245 balconies; raised-prop clearance (z-overlap >= 80 uu), a failed window hands its turn to the next | kept |

Skips in the final run: 293 another building in front, 85 corner clash, 32 over a shop, 5 raised prop in the way,
654 windows on faces left plain (35% of faces, by position hash, for rhythm).
Cost: 245 instances of a 2,090-tri module, culled at 120 m -- not measured; well below the passes that were.

Saving: the first save (09:17, save_map) returned False with no dirty map listed, the machine rebooted at 09:28, and
the layer was lost. Re-applied on editor 57 and saved with save_current_level (umap 10:05:44).

Open: WL_Detail_Oriel_Bay needs its glazing on the outside of the stone before oriels can join this pass.
