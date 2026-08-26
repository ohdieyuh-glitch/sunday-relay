# Wonderland V1 — LEGACY / ARCHIVE (permanent founder directive, 2026-08-25)

The old Wonderland world is finished as an active development world. It is
preserved on `relay/wonderland-hd-rebuild` (@ `667fbf9`) and
`relay/wonderland-marble` (@ `7188ed7`) and its files still exist on the V2
branch so the shared engineering they carry keeps working — but its VISUAL
CONTENT is READ-ONLY. `tools/v1_guard.py` enforces this: on any
`relay/wonderland-v2*` branch a commit that touches a path below is refused
unless `WONDERLAND_V1_OVERRIDE="<reason>"` is set, and the reason is recorded
in the commit.

## LEGACY VISUAL CONTENT — READ-ONLY

| path | what it is |
|---|---|
| `wonderland/infra/build/generate-hub-level.py` | the V1 world generator (11,500 lines: layout, kits, scatter, materials, lighting of the OLD world) |
| `wonderland/WorldDesign/hub-layout.json` | the V1 layout |
| `wonderland/WorldDesign/visual-target.json` | the V1 palette targets |
| `wonderland/infra/build/hd/assets.py` | the V1-era authored asset library (58 meshes) |
| `wonderland/infra/build/hd/arrival.py` | the V1 arrival-district reset |
| `wonderland/infra/build/verify-hero-*.py`, `verify-landmark-*.py`, `verify-static-environment.py`, `verify-light-budget.py`, `verify-sky-fill.py`, `verify-leaf-material.py`, `verify-colourfulness.py`, `verify-palette-saturation.py`, `verify-material-usage-flags.py`, `verify-base-colour-wired.py`, `verify-no-placeholder-materials.py`, `verify-texture-families.py`, `verify-canonical-dog.py`, `verify-dog-proxy.py`, `verify-hero-motif.py` | V1 visual gates — they measure the OLD world |
| `wonderland/infra/build/measure-*.py`, `compare-*.py`, `attribute-dark.py`, `palette.py`, `hero_shots.py`, `render-*-strip.py`, `emit-dog-body.py`, `TASK5-NIAGARA.md`, `GPU-READY-QUEUE.md`, `HANDOVER.md` | V1 measurement / documentation of the old world |
| `wonderland/infra/build/gen-textures.py` → **SHARED** (see below) |  |
| `wonderland/marble/worlds/**` | the Marble generations — V2's SOURCE; read-only for a different reason: provenance |
| `/Game/Wonderland/**` (in-engine) | the V1 content root: never loaded, cooked or referenced by V2 |

## SHARED ENGINEERING — may be migrated / refactored

`Source/Wonderland/**` (player controller, game mode, Relay link, Dog pawn
and animation, instanced batch, hover component, interactable, project
avatar, world proof), `Config/**`, `Wonderland.uproject`,
`infra/lightning/**` (build/cook/capture), `infra/build/build-wonderland.sh`,
`infra/build/gen-textures.py` (texture synthesiser), `infra/build/hd/meshkit.py`,
`hd/ue_bridge.py`, `hd/layout_tools.py`, `hd/border.py`, `hd/validate.py`,
`hd/render_sheet.py`, `marble/*.py` (Marble pipeline + import tool),
`rendering/**`, `tests/**`, `proof/**`, `web/**`, `verify-local-includes.py`,
`verify-gameplay-classes.py`, `verify-generator-classes.py`,
`verify-blueprint-parents.py`, `verify-uproperty-access.py`,
`verify-target-config.py`, `verify-pixelstreaming-plugin.py`, `verify-docs.py`,
`verify-look-table.py`, `verify-knobs-forwarded.py`, `verify-lod-pipeline.py`,
`verify-nanite-*.py`, `verify-generator-dryrun.py` (its stub engine is
migrated), `make-blueprints.py`, `gauntlet-check.py`, `GAUNTLET.md`.

Migration rule: understand → move to a neutral location where appropriate →
remove legacy-environment assumptions → test against V2 → leave V1 untouched.

## V2 CONTENT — ACTIVE

`wonderland/v2/**`, `/Game/WonderlandV2/**` (in-engine),
`infra/lightning/v2-*.sh`.
