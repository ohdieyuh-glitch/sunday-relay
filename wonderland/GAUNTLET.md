# The Claude ↔ Aura gauntlet

How two agents work on one Unreal project without writing over each other.
Claude Code is the lead technical orchestrator; Aura (tryaura.dev, Ramen) is
the Unreal-native executor/verifier. The founder's reference image is the final
artistic authority, and nothing is frozen on tests, counts or metrics.

## Where each agent runs, and why

| agent | machine | engine | why |
|---|---|---|---|
| Claude Code | the Chromebook + the Lightning Studio (Linux, CPU/L4) | Epic's Linux docker image `ghcr.io/epicgames/unreal-engine:dev-5.8`, editor as commandlet | generator, C++, config, cook/package, capture |
| Aura | **a Windows machine with launcher UE 5.8** | Epic Launcher binary engine | Aura ships a Windows-only installer and a prebuilt-DLL plugin, requires the app and the UE process on one machine, and does not support source-built engines on the public plan. It cannot run in the Linux image on the Studio. |

Both machines hold a checkout of **`relay/wonderland-hd-rebuild`**. Git is
the only channel between them and the only reliable revert.

## Ownership (enforced by `infra/build/gauntlet-check.py`)

| owner | paths |
|---|---|
| Claude | `wonderland/infra/**`, `wonderland/Source/**`, `wonderland/Config/**`, `wonderland/WorldDesign/**`, `wonderland/Wonderland.uproject`, `wonderland/GAUNTLET.md` |
| Aura | `wonderland/Content/Wonderland/Aura/**`, `wonderland/Saved/.Aura/Skills/**` |

Aura's C++ agent stays **off** for Wonderland (Accept-only, no YOLO mode):
`Source/` is Claude's, and Aura's Python editor agent has no revert of its own.
Aura never writes under generator-owned asset paths (`/Game/Wonderland/Maps`,
`/Game/Wonderland/Materials`, `/Game/Wonderland/FX`, `/Game/Wonderland/Textures`)
— the generator REGENERATES those on every build and would overwrite them.

## The lock

`wonderland/.gauntlet-lock` is one line: `writer=<claude|aura> step=<N> since=<ISO date>`.
Read it at HEAD before any write. If it names the other agent, stop. A handoff
is a commit that flips it. `gauntlet-check.py` refuses a diff whose paths cross
the writer's ownership.

## One step, one commit

Every Aura step is exactly one commit — `aura: step N — <what>` — touching
only Aura's subtree plus the lock flip. Revert is `git revert <sha>`, never
editor undo (Aura's own undo is documented as inconsistent for level-design
geometry and absent for Python edits).

## The loop

1. Claude audits and specifies ONE coherent asset family (what, where it
   stands in HeroCam6, size, palette, what it replaces) → commits the spec and
   flips the lock to `aura`.
2. Aura executes the Unreal-native part on the Windows machine, in its own
   subtree, and validates in-editor (loads, compiles, no missing refs).
3. Aura commits `aura: step N — …`, flips the lock to `claude`, pushes.
4. Claude reviews the diff: `gauntlet-check.py` (ownership); every new binary
   is in LFS; the generator still places without a path collision; every new
   asset loads by path from Python (`load_asset` non-None).
5. Studio ON CPU: cook + package in docker; grep the log for `LogMaterial`
   usage-flag warnings and missing-asset errors.
6. **GPU ON** — HeroCam6 capture — **GPU OFF**.
7. `compare-before-after.sh` against the reference; Claude names the five
   largest remaining visible mismatches.
8. Repeat on those. An asset family is frozen only when Claude's technical
   checks pass AND the founder accepts it on the rendered frame.

## Source control facts that shape this

- This repo tracks **no** `.uasset`/`.umap` today; all Content is regenerated
  from Python. Aura will commit binary Content for the first time. Decide
  **git-LFS** before its first asset lands (`*.uasset *.umap` filter=lfs).
- UE transient directories are ignored here (`Binaries/`, `Intermediate/`,
  `DerivedDataCache/`, `Saved/` except `Saved/.Aura/Skills/`).
- Aura writes `Saved/.Aura/plans/*.md` and `project_memory.txt`; those stay
  local to the Windows machine.

## Not yet verified

- Aura's public build with UE **5.8**: stated in its v14/v15 release notes,
  absent from its compatibility page. Unknown until tried on the Windows box.
- Two agents on one project: Aura publishes no guidance. The lock and the
  ownership check are ours.
