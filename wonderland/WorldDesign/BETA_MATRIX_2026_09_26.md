# Wonderland — measured beta matrix, 2026-09-26

Every row is a proof run in PIE **today**, on the current build, through the entry point the founder uses.
Nothing here is inferred from a screenshot or carried over from an earlier session. Where a row is short of
green it says so and says why, because a matrix that rounds up is worth nothing.

## P0 — internal

| # | Item | Proof | Result |
|---|------|-------|--------|
| 1 | Project Brain / Wardrobe | `zc_wardrobe_pixels` | **12/12.** Every corner of the preview is the black backdrop for all five skins; the Brain stays open; the player camera is untouched. |
| 1 | Wardrobe upgrade (founder's 8 items) | `zc_wardrobe_upgrade` | **20/20.** 0.79–0.92 frame occupancy on the binding axis, nothing over the edge, centred, 360° icon starts/stops/eases back, PRIMARY and SECONDARY live on the same canonical state the Menu reads. |
| 2 | Brain + python snake | `zc_brain_sculpture` | **12/12.** Bearing rate not constant, distance to the brain varies, route not confined to one plane — an orbit fails all three. Never enters the brain mass; holds its length. |
| 3 | Relay OG = animation authority | `zc_skin_parity_all`, `zc_skin_locomotion` | **4/4 and 8/8.** Every active skin wears the Dog's pose field for field through run, stop, turns, fall, landing, body bounce and ground contact. |
| 4 | Real fire | `zc_fire_look`, `zc_fire_calibrate` | **4/4.** M_WL_Fire is ON. Against the old path at 21:00: 63% of Arden clipped to white with no mascot visible, versus a figure readable through its own fire with an orange-to-gold gradient, soft edges, taper and climbing flicker. |
| 5 | Project Avatar cost | `zc_avatar_ladder`, `zc_avatar_why`, `zc_avatar_hism` | **Diagnosed, not further optimisable without touching art.** One Large avatar costs 18.7 ms; hiding it returns 15.5, shadows 0.8, and the quadtree returns nothing measurable (14.16/14.05 vs 13.47/9.89 — gap smaller than the noise). Crowds already scale: ten avatars cost less than one. |

## P1 — customization / HUD

| # | Item | Proof | Result |
|---|------|-------|--------|
| 6 | PRIMARY / SECONDARY mascot colour | `zc_wardrobe_upgrade` U30–U34 | **PASS.** Crimson shell multiplies red-over-blue 3.8×; the ghostfire's blue is 0.4549 before and 0.4549 after — authored art untouched. Persists across close and reopen. |
| 7 | HUD three agent rows with live names | `zc_hud_agents` | **5/5.** Renaming all three agents changes the HUD; the project's own names come back. |
| 8 | Cursor customization | `zc_menu_colours` M30 | **PASS.** Choosable from the Colors tab, not only the console. |
| 9 | Julius + Companion terminal colour | `zc_menu_colours` | **8/8.** Separate accents held per terminal; theme moves accent surfaces and leaves body text alone. |

## P2 — world

| # | Item | Proof | Result |
|---|------|-------|--------|
| 10 | Believable water | `zc_water` | **5/5.** Translucent, worn by every pond, well, canal and basin, moving, and stopping when the world pauses — with the control proving the capture was still rendering while paused. |
| 11 | Shadows | `zc_shadows` | **4/4.** No two lights fight over the same shadow; bias in band; stable under a held camera. |
| 12 | Continuous time of day | `zc_night_readable` | **8/8.** Night 0.1686 luma, 0.3675 of the brightest hour against a 0.38 ceiling, 0.576 crushed against 0.72 — inside both gates with room on each side. No step jumps the exposure. |
| 13 | Beta-accessible world | `zc_beta_walk`, `zc_tartarus_walk`, `zc_beta_perf` | **Coverage and traversal PASS, streaming BLOCKING.** 113 tiles from the Arrival Gate to 1.2 km with zero empty. Tartarus axis: five points, arrived off-by-0.0 uu, none fell. Worst stand in the world 38.25 ms. |

## What is not green, stated plainly

1. **STREAMING — BLOCKING.** `zc_streaming` S01: 21,089 actors resident at every stop, spread exactly 0.
   Nothing pages. `zc_streaming_why` names the cause: World Partition pages by actor bounds, and 753 actors
   are wider than a 200 m cell and hold 44.5% of the world's instances. `BC01_BaseCourse` alone is one actor
   1,970 m wide with 4,132 instances. The remedy is to split the world-spanning material batches by tile in
   the builders, and to widen the cell past the authored tile size for the ones that miss by a metre. Not
   attempted here: both mean re-running builders and re-saving a 45 MB map on a Content junction shared with
   other worktrees, and the standing rule is that two editors must never be two writers on one .umap.
2. **Celestial Light's eyes keep 0.031 channel separation against a 0.05 floor** (`zc_eyes_glow` E03). Its
   authored eye is the palest in the lineup, (0.62, 0.88, 1.00), and its head sits inside its own halo. The
   founder's SECONDARY colour will read weakly on this one skin. Fixing it means changing authored art.
3. **Skeleton Flame's heartbeat read from directly behind is 0.0187 against a 0.02 floor**
   (`zc_skeleton_pulse` P02). The chest skull faces forward and the ghostfire beats at a third of the depth
   by the founder's own instruction that it must never look like it is going out.
4. **Gates B and C are not this lane's to call.** Julius beta-readiness and the end-to-end path through the
   Live Terminal, Wonder Web and the companions were last audited at 35% integration and have not been
   re-measured today.
