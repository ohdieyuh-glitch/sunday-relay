# Wonderland Marble Inspector

A browser-side inspection surface for Marble worlds. Runs on a laptop, needs no
GPU, no Lightning Studio and no Unreal.

    python3 wonderland/marble/placement_contract.py \
      --out wonderland/web/inspector/placement-contract.json
    npm install three          # once
    python3 -m http.server 8000            # from the REPO ROOT
    # then open http://localhost:8000/wonderland/web/inspector/

The import map resolves `three` out of `node_modules`, so there is no bundler
and no build step. Serving from the repo root is what makes that work.

## What it is not

Unreal Engine 5.8 remains authoritative for collision, navigation, the Relay
Dogs, Compound Agents, multiplayer, interactions, GVE and the final render.
Relay remains authoritative for mission execution. Nothing here is gameplay, and
nothing here decides what ships.

Relay Dogs are authored Unreal assets. This tool does not render them and must
never substitute a generic three.js dog for one.

## Why it exists

Every fault below has cost this project a metered L4 session, and every one of
them is answerable from geometry plus a placement contract:

| Fault | How it is caught |
|---|---|
| Wrong scale | measured extent vs the extent the engine measured, component by component |
| Upside down / 180° flip | the SIGNED centre offset from the origin — no extent check can see a flip |
| Wrong origin | where the mesh origin actually lands vs the anchor camera |
| Bad camera elevation | the camera's frame span vs the measured skyline elevation |
| Backdrop outside the frustum | sampled vertices tested against the real frustum |
| Visual/collider misregistration | bounding-box centres compared as a fraction of span |

## One source of truth

`wonderland/marble/placement.py` composes the placement chain and is the only
thing that does. `placement_contract.py` writes down its RESULT — basis, scale,
origin, offset, already multiplied out — plus the hero-camera table parsed out
of the level generator. `placement.js` turns those numbers into a matrix and
performs no placement arithmetic of its own.

That is deliberate and it is the whole design. A JavaScript reimplementation of
the chain would agree with Python right up until one of them was the bug, and
then the tool built to catch flipped imports would reproduce the flip.

`parity.test.mjs` runs both sides over the same points and compares them; they
agree to under 1e-7 cm.

## Formats

| Loader | Status |
|---|---|
| `GLTFLoader` | used — World Labs exports `.glb` |
| `DRACOLoader` | wired, unexercised: no current Marble export is Draco-compressed |
| `KTX2Loader` | wired, unexercised: the texture is an 8192² PNG |
| `MeshoptDecoder` | wired, unexercised |

The three "wired, unexercised" loaders are attached so a future compressed
export loads instead of failing with a message about an extension nobody read.
They have not been proven against a real asset, and this table says so rather
than implying coverage.

Gaussian splats (`.spz` / `.ply`) are **not** loaded. See `SPLATS.md` — that is
an investigation, not a dependency.

## Tests

    bash wonderland/web/inspector/test.sh

`parity.test.mjs` (21) proves the browser and Unreal place a point identically.
`diagnostics.test.mjs` (21) proves each verdict FIRES against a world broken on
purpose — a 100× scale, a flip that changes no extent, an origin off the anchor,
an arrival camera that cannot reach the skyline, a displaced collider — and that
absent input reads `pending`, never a pass.
