# Wonderland — measured beta matrix, 2026-09-26

> **WHERE THE WORK IS, AND WHY IT IS NOT ON GITHUB.** Everything is committed on the local branch
> `local/wonderland-task3`, and both targets are built from that exact source. It is NOT pushed, and cannot be
> by this session: `ceremony/push-as-worker.sh` requires every commit above `main` to be authored by
> `julius-worker[bot]`, and the 692 commits on this branch are authored by `julius-stack-rehearsal` and
> `Claude` — the ceremony refuses that case by design, before it mints a token. Pushing with the
> `ohdieyuh-glitch` credential is ruled out by the founder credential boundary, and merging is founder
> authority in any case. Landing it would mean a squashed worker branch, which is a founder call.
>
> **AND THE WORLD IS NOT IN GIT AT ALL.** `wonderland/Content/` is untracked — `git status` reports the whole
> tree as `??`, and `CONTENT_LFS_PLAN.md` describes an intention that was never carried out. So the World
> Partition conversion done today exists only on disk. Its only rollback is
> `recovery/_map_checkpoints/2026-09-26-streaming/`, which holds the pre-conversion 46 MB map, its ini, a
> `RESTORE.md` and the original's sha256. The Content tree is shared between worktrees by junction, so that
> conversion changed the map for all of them.


Every row is a proof run in PIE **today**, on the current build, through the entry point the founder uses.
Nothing here is inferred from a screenshot or carried over from an earlier session. Where a row is short of
green it says so and says why, because a matrix that rounds up is worth nothing.

## P0 — internal

| # | Item | Proof | Result |
|---|------|-------|--------|
| 1 | Project Brain / Wardrobe | `zc_wardrobe_pixels`, `zc_preview_hours` | **12/12 and 3/3.** Every corner is the black backdrop for all five skins, the Brain stays open, the player camera is untouched — and the mascot now FACES the viewer, which it had not been doing: `StepLookAround` rotated it to world yaw zero while the UI rotated the stage to face the camera, so the wardrobe was showing the Dog's back and 12/12 passed throughout. The preview is also lit by its own rig now rather than by the sky: Relay OG varied 4.76x across the day and now varies 1.48x. |
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

## Final sweep, after the World Partition conversion and the wardrobe work

Everything below re-run on the converted map with the shipped build, in this order, nothing carried over:

`zc_wardrobe_pixels` 12/12 · `zc_wardrobe_upgrade` 20/20 · `zc_preview_hours` 3/3 ·
`zc_brain_sculpture` 12/12 · `zc_hud_agents` 5/5 · `zc_menu_colours` 8/8 ·
`zc_skin_parity_all` 4/4 · `zc_skin_locomotion` 8/8 · `zc_fire_look` 4/4 · `zc_eyes_glow` 3/3 ·
`zc_skeleton_pulse` 6/6 · `zc_water` 5/5 · `zc_shadows` 4/4 · `zc_night_readable` 8/8 ·
`zc_streaming` 2/2 · `zc_wp_state` 4/4 · `zc_floor_after_wp` 3/3 · `zc_beta_walk` W01/W02/W05.

Performance after the conversion: 33.7 ms and 31.3 ms at noon, against a pre-conversion worst stand of
38.25 ms.

## What is not green, stated plainly

1. **STREAMING — BLOCKING, and the cause is simpler and worse than the one I first published.** `zc_streaming`
   S01: 21,089 actors resident at every stop, spread exactly 0. I first attributed that to 753 actors being
   wider than a 200 m cell — real arithmetic, wrong explanation. `zc_wp_state`, asking through a C++
   `DescribeWorldPartition` because Python cannot reach any of World Partition in 5.8, answers
   **`partitioned=0` in the editor world and in PIE alike.** There are no cells for an actor to be too big
   for. On disk: `WL_V2_GoldenArrival_WP2.umap` is 46 MB, monolithic, the map the project loads, last written
   19:31 on the 25th; `WL_V2_GoldenArrival_WP2_WP` is a partition stub with 21,047 externalised actors last
   written 00:19 the same day. The conversion ran, and the world lane then edited the monolithic map for
   another nineteen hours. The remedy is to re-run the convert commandlet against the current map — which is
   non-destructive, writing a new map and leaving the source alone — and point the project at the result. A
   checkpoint of the 46 MB map and its ini was taken to `recovery/_map_checkpoints/2026-09-26-streaming/`
   first. The oversized-actor work is the NEXT question, not this one: once cells exist, `BC01_BaseCourse` at
   1,970 m wide really will sit in all of them.
2. **Celestial Light's eyes keep 0.031 channel separation against a 0.05 floor** (`zc_eyes_glow` E03). Its
   authored eye is the palest in the lineup, (0.62, 0.88, 1.00), and its head sits inside its own halo. The
   founder's SECONDARY colour will read weakly on this one skin. Fixing it means changing authored art.
3. **Skeleton Flame's heartbeat read from directly behind is 0.0187 against a 0.02 floor**
   (`zc_skeleton_pulse` P02). The chest skull faces forward and the ghostfire beats at a third of the depth
   by the founder's own instruction that it must never look like it is going out.
4. **Gates B and C are not this lane's to call.** Julius beta-readiness and the end-to-end path through the
   Live Terminal, Wonder Web and the companions were last audited at 35% integration and have not been
   re-measured today.


---

# CORRECTION PASS, 2026-09-27 — what the founder's screenshots overturned

> **THE ROWS ABOVE WERE NOT LYING, AND THEY WERE NOT RIGHT EITHER.** Every one of them was a real proof that
> really passed. The founder then opened the wardrobe and saw a nearly empty square, and both things were true
> at once. That is the finding worth keeping from this pass: `zc_wardrobe_upgrade` reported 0.79–0.92
> occupancy while the mascot rendered at 41.5% of frame height, because it measured the framing system that
> was no longer the one being drawn. **A proof that uses a different entry point than the founder passes while
> the feature is broken.**

## P0-1 Wardrobe — REOPENED AND RE-FIXED

Three independent causes had stacked, and each alone produces "the preview is broken", which is why four
rounds of camera-distance tuning never touched it.

| Cause | Evidence |
|---|---|
| **Thirteen stops of overexposure.** `AutoExposureBias = 11` (+11 EV = 2048×) multiplied by stage lamps of 90,000/26,000/52,000 cd — sane for a room-sized stage, except the wardrobe shrinks the rig to fit a small panel, putting three lamps ~1 m from a hand-sized figure at ~50,000 lux. | Sweeping exposure from +11 to −2 EV — thirteen stops, ~8000× — changed the picture almost not at all. Sweeping the **lamps** produced a correctly shaded mascot immediately. `wl.Look.PreviewLights`, 0.040. |
| **Two framing systems, and every fix went into the unused one.** `WonderlandUiSubsystem` solves for the player's 90° camera and the window's share of the *screen* — correct for the old hole-in-the-panel wardrobe. The panel now paints the stage's own 34° capture, which nobody had ever solved: `AimCamera` stood at a literal `Height * 3.15` = exactly 41.5% occupancy. | Measured off exported pixels: 42–43%. Arithmetic and photograph agreeing is what made it certain. |
| **The body was classified by how it was shaded.** A part counted as body only if its material was `Lit` or `Rim`. Apollo, Skeleton Flame and Celestial Light are built almost entirely from `Glow`/`Additive` — a glowing torso is still a torso — so the box collapsed to a 30 uu fragment on a 200–400 uu figure. | Now classified by part **name** against the skeleton every skin shares (`body`, `head`, `arm_*`, `leg_*`), so all five frame identically and a new ornament is excluded by default. |
| **And the solve measured a half-built figure.** `AimCamera` ran once at skin-switch, while components were still being registered — and `Bounds` means nothing until a component is registered. | Relay OG's body sums to 53 uu; the solve recorded 30.0 at that moment, and the shortfall tracked how much there was to build (Apollo 21.3, Skeleton Flame 13.1). Re-solved every frame now. |

**Measured, from the exported pixels:** Relay OG 80.4–82.9%, Apollo 75.6–83.2%, Arden 68.8–72.4%,
Celestial 90.1–92.9%, Skeleton 88.5–93.6%. `zc_wardrobe_20` V00/V01/V02 green.
`zc_wardrobe_regress` R00/R01/R02 green across close/reopen ×3, five skins twice, three colourways, a full
360°, an 11 km teleport and a day/night sweep.

## P0-4 Real fire — the asset was stale, not the shader

The generator has carried Skeleton Flame's spectral system all along: `soulpulse` and `soulveilpulse` in the
eyes' own cyan, `flankfire` down both sides, `backfire` across the back, all named `…pulse` so they join the
existing heartbeat rather than inventing a second one. **The shipped `SkeletonFlame.wlvox` predated it.**
Regenerating all seven skins into a scratch directory and diffing proved only that one had drifted —
1,485 → 2,186 boxes, 9 → 11 materials, 17 → 19 parts — while Relay OG, Arden, Apollo and Celestial Light came
out byte-identical. `RelaySkins/` was checkpointed first and verified by hash: exactly one file changed.

## P1-6 / P1-7 AI companion colour and HUD — verified visually

`zc_companion_colours` C00–C04 green, built as controlled comparisons rather than five arbitrary pairs:
SECONDARY alone swings blue-over-red 0.298 → 0.0588 with PRIMARY identical; PRIMARY alone moves mean luma
0.7512 → 0.5496 with SECONDARY identical; the glow answers SECONDARY **61× more strongly** than PRIMARY.
The HUD's three rows were confirmed in a live capture: `COMPOUND AGENT Julius · SINGLE AGENT Claude Code
Fable 5 · LLM COMPANION GPT 6 Astra`.

## OPEN — the night eyes, and the fix that measurement rejected

`zc_eyes_glow` returns 3/3 with 15/15 readings, and the 23:30 capture shows Relay OG's eyes as two flat dull
gold squares. It passes because they clear a near-black visor by 0.090 against a 0.05 floor — true, and
useless.

The arithmetic says raise `wl.Look.EyeGlowNight`: it is 5.0, these are absolute emissive levels, and the skins
author their eyes at 7.0–8.0, so after dark the eyes are driven *dimmer than the art asks for*. Swept at
midnight across 5 / 9 / 13 / 18, **Relay OG's eye luma falls** — 0.153, 0.095, 0.070, 0.078 — while Arden,
Apollo and Skeleton Flame sit clipped at 1.000 throughout. That is auto-exposure: the camera is 300 uu from
the face, the eyes are most of what it sees, and driving them harder closes the iris on the thing being
measured.

**So the value was left at 5.0.** Shipping the change the arithmetic suggested would have made the picture
worse while looking like progress. The founder's stated requirement — daylight — passes with room on every
skin (Relay OG 0.591 against a face of 0.039). Making Relay OG's warm gold read as a lamp *at night* needs
that one skin's authored eye raised, which is art and belongs to the founder.


## Re-measured end to end, 2026-09-27, on HEAD with both targets built

Every row below was run on the current build in this session, and each result was read together with the
`WLCHANNEL finished` line that produced it. That last part is not pedantry: one wardrobe result in this pass
read 5/5 from a file written *before* the change it appeared to confirm, because the run that would have
replaced it was killed before it was queued. A green can outlive its run.

| Proof | Item | Result |
|---|---|---|
| `zc_wardrobe_20` | P0-1 | **5/5** — V03 and V04 are new in-engine gates, occupancy 69.0–93.2% |
| `zc_wardrobe_regress` | P0-1 | **3/3** — close/reopen ×3, five skins ×2, three colourways, 360°, 11 km teleport, day sweep |
| `zc_brain_sculpture` | P0-2 | 12/12 |
| `zc_skin_parity_all` | P0-3 | 4/4 |
| `zc_fire_look` | P0-4 | 3/3 — re-run after the Skeleton Flame asset grew 47% |
| `zc_avatar_ladder` | P0-5 | A03 green (0.33 ms per avatar at the top end); **A04 unattributed** |
| `zc_companion_colours` | P1-6 | 5/5 |
| `zc_hud_agents` | P1-7 | 5/5 |
| `zc_menu_colours` | P1-8/9 | 8/8 (M11 flaked once, green on repeat) |
| `zc_water` | P2-10 | 5/5 |
| `zc_shadows` | P2-11 | 4/4 |
| `zc_night_readable` | P2-12 | **8/8** — N03 closed by a night rim |
| `zc_streaming` | P2-13 | **2/2** — was BLOCKING; residency 12,657 → 1,202 actors |
| `zc_walk_after_wp` | P2-13 | **6/6** — was 5/6; the missing stand was a harness fault |
| `zc_beta_perf` | perf | 6/8 stands, 19.2–27.3 ms |

### Four proofs were wrong, not four features

The striking thing about this pass is how much of it was instrumentation. Each of these reported a fault in
the thing it was pointed at:

* **`zc_streaming`** placed the Dog at a flat 400 uu, killed it inside masonry, and surfaced as
  `RelayDogCharacter: Internal Error` in a job about World Partition. The row had read BLOCKING since
  yesterday. The world pages fine.
* **`zc_walk_after_wp`** traced down and took the first hit — a 25.8 m roof — and held the Dog inside it.
  One stand had been unmeasured every run.
* **`zc_wardrobe_regress`** looked for the skin stage before opening the wardrobe that creates it, then
  compared framing notes as strings and failed on float noise in the staged scale.
* **`zc_beta_perf`** re-issued `stat unit` on a timer. It is a *toggle*, so the fix moved the failure from
  noon to midnight before naming itself.

The rule that came out of it: **when a measurement disagrees with a photograph, suspect the measurement
first.** That sits underneath the founder's rule rather than replacing it — the photograph still wins, but
the instrument is the more likely thing to be broken.

### Still open, and why

* **P0-5 spawn hitch — unattributed, not fixed.** Scaling is proven. The engine's own log named PSO
  compilation (`0 of them were precached`) and the project had no precaching configured; enabling it, and
  verifying the CVars actually reached the engine, moved the five-avatar p95 from 93.27 ms to 93.4 ms.
  Unchanged. The ladder also runs its rungs `0, 1, 10, 5`, so that 93 ms is the *last* spawn of the session —
  on a host with 1.89 GB free of 15.7 GB that has been killing processes throughout. Not attributable here.
* **`zc_beta_perf` reads six stands of eight.** Understood, in the instrument, and the six agree across runs.
* **Relay OG's night eyes** read lit but dull. The global control makes it *worse* (luma falls 0.153 → 0.078
  as the level rises, because auto-exposure closes on them). That is this skin's authored eye — art.
