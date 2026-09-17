# LL02 -- the strange lanterns keep their shape and lose the rust (2026-09-17)

Gap: at LanternLaneCam27 the 25 SM_lantern_strange landmarks read cheap and rusty -- streaked bronze cages, beige
barrel glass. LL01 (replacement with a formal gold standard) was rejected for tangling the Hamlets' cluster, losing the
Mushroom Grove's teal and the whimsy (8db397c0).

LL02 changes MATERIALS ONLY, on these actors only (apply_actor_materials.py, ll02_lantern_swaps.json: 50 slots,
every before recorded, REVERT restores):
- body -> MI_V2_LanternBrass (from MI_V2_Gold: warm brass 1.10/0.74/0.34, metallic 0.85, roughness 0.32, flattened
  detail) -- MI_V2_Bronze is also shop and market metal and is untouched;
- glass -> luminous jewel glass (from MI_V2_GlassAmber, emissive 2400): MI_V2_LanternGlassTeal for the Mushroom Grove
  and waypoints (14), MI_V2_LanternGlassRose (5) / MI_V2_LanternGlassLavender (6) by position in the Lantern Hamlets.
Geometry, positions, count and silhouette untouched: one lantern per existing position.
Materials: zzAD00_make_lantern_materials.json (4 created and saved). Swap: zzAD20_ll02_swap.json (50 changed, 0 refused).

Judgement (ll02_ab.jpg: LanternLaneCam27, Hamlets gameplay-distance and close, Mushroom Grove close, waypoint views):
clearly better. The rust and beige barrels are gone -- clean warm brass cages with glowing rose, lavender and teal
glass -- while the sculptural silhouette, the tight Hamlets cluster, the Grove's teal identity and the whimsy all
remain. Kept. Saved: zzAF00_save_ll02.json (lantern materials verified in the level before the save).
