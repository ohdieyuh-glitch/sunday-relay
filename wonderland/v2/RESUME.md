# Wonderland V2 — resume point (2026-08-30, world-development phase)

## Where to pick up

| | |
|---|---|
| DATE | 2026-08-30, world-development phase (founder reopened it after locomotion closed) |
| BRANCH | `relay/wonderland-v2` |
| WORKTREE | `~/wonderland-ca-fixes` on the Chromebook — CPU work needs no Studio |
| AUTHORITATIVE MAP | `/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2` — **classic (non-WP) container** |
| CONTENT ROOT | `/Game/WonderlandV2` |
| PRIMARY REFERENCE | `v2/reference/marble-royal-garden-cam0-founder-reference.png` (the founder's cam0 view) plus the three boards in `v2/reference/boards/` |
| CAMERA SUITE | **eleven** now: the eight locked arrival cameras, plus FlankLeftCam08, FlankRightCam09, RearWorldCam10 added in PASS 09 for the new ground. None of the original eight moves. |

## The tool that decides things now

`v2/tools/gap_v2.py RENDER.png [REFERENCE.png]` — measures the six things that
decide whether a frame reads as the reference world: per-band luma/chroma/edges,
the palette split by colour family, cloud share of the sky, ground variation,
gridness, foreground tonal span and clipping. **Impressions drift; pixel
populations do not.** It is what redirected PASS 08 away from the carried gap
list, and every pass since states its predictions in these units BEFORE the
render and scores them after. The predictions and scores live in
`v2/WORLD_LEDGER.md`.

Two measured caveats are recorded in the tool: `cloud_fraction` is only
meaningful on a camera with real sky above the horizon (pale horizon haze
scores as cloud), and its whole-band figures differ from a hand-placed
rectangle — quote the tool's.

## What has happened in this phase

- **PASS 08 (`b3ec99a`) — the look.** Triplanar projection replaced a world-XY
  UV that smeared every vertical surface in Wonderland; the shadowless fill
  was cut so shade exists; the grade and sun were warmed; stone albedo came
  down; trees stopped ending outside their own leaves; clouds became lit
  geometry because VolumetricCloud has now failed twice on this runtime.
  Five of eight predictions met.
- **PASS 08b (`427438e`) — the overshoots**, sized from PASS 08's frame:
  warmth 1.36× the reference and shade 1.32×, both pulled back; the ground had
  become a brown void instead of a green one; the plaza's four tints were
  drawn from a sum of uniforms against thresholds calibrated as if uniform, so
  the grey stone meant to be a fifth of the pavement was one slab in
  twenty-seven.
- **PASS 09 (`5581796`) — the flanks and the rear world.** 305 new placements
  turning 23,300 m² of lawn into authored garden: threshold → parterre → rose
  walk → grove → landmark → boundary on each flank, and a second gate with a
  hedged avenue behind the spawn. Density 1 per 178 m² → 1 per 41.

## Three traps this phase found, worth not re-learning

1. **The gate read a different list from the builder.** `build_v2` walked a
   hand-written band list and `layout_v2.ALL` was another; PASS 09 added 305
   placements to ALL alone, the layout gate counted them and PASSED, and the
   generator placed four. One list now (`LAYOUT.BUILD_BANDS`), ALL derived.
2. **The fps harness was measuring an empty world.** `measure-fps.sh` was the
   only launcher that never forwarded `${WL_MAP_ARG}`, so it booted the empty
   World Partition container. Its numbers looked excellent because there was
   nothing in them. It now forwards the map and prints the world it measured.
3. **A threshold on a derived random variable does not mean its share.** See
   the plaza tints above.

## Build and capture (the Studio must already be on the L4)

```bash
bash wonderland/v2/tools/ship_v2.sh --ship-only          # incremental, ~30 KB
ssh wonderland-l4 'cd .../src && WLV2_REBUILD="<recipes that changed>" \
  setsid nohup bash wonderland/v2/tools/pass_chain.sh > ../run/pass.log 2>&1 &'
WL_CAMS="0 8 9 10" WL_RES_X=1280 WL_RES_Y=720 bash wonderland/v2/tools/round.sh
```

`ship_v2.sh` now bundles incrementally by asking the Studio what commit it
holds and proving locally that it is an ancestor — the full-branch bundle
stopped fitting in a ten-minute upload once the reference art landed on the
branch. `WL_STUDIO_FULL=1` forces the old behaviour.

## Permanent principles

- Wonderland **V1 is archived / read-only**; the write-guard stays.
- **Marble designs and may accelerate distant scenery; Unreal owns the
  playable world.** No raw Marble geometry in the player-facing foreground.
- Visual progress requires a **real Unreal render**. Offline traces, contact
  sheets and Python rasterisations are diagnostics, never acceptance.
- The locked cameras are a **regression system**. Fix the world, not the
  framing. A new area earns its own cameras once it has a real composition.
- **Art and navigation together**: every environment pass keeps the routes
  walkable, and clearance at a point proves nothing about the ground between
  points — only a walk does.
