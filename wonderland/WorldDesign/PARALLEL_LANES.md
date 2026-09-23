# Wonderland: two Unreal lanes, in parallel

Founder directive 2026-09-23: **the two Wonderland Unreal sessions must develop at the same time.** Not one
after the other. "Waiting for the other Unreal session" is a wasted lane.

Written by World Development after a day that proved the point the hard way: this lane treated the editor as a
project-wide lock and framed hours around waiting for it. It still produced 19 commits of world work in that
time, which is itself the evidence that the waiting was never necessary.

## What is actually shared, measured not assumed

Taking the two lanes' real commit histories, **they have never touched the same file**:

| Internal Development (`wonderland-proof`) | World Development (`wonderland-task3`) |
|---|---|
| `Source/Wonderland/WonderlandUiSubsystem.*` | `WorldDesign/Nations/**` |
| `Source/Wonderland/WonderlandSubAgentCubs.*` | `WorldDesign/Districts/**` |
| `Source/Wonderland/WonderlandProjectBrainPanel.*` | `WorldDesign/GoldenArrival/**`, `City/**`, `Skyline/**` |
| `Source/Wonderland/WonderlandMission*.cpp/.h` | `WorldDesign/nations.py`, `CANON/**` |
| `Source/Wonderland/WonderlandDemoFlow.cpp` | `WorldDesign/WORLD_BETA_LEDGER.md` |
| `Tools/relay_dog_skins.py` | `Tools/validate_layer_spec.py` |
| `Tools/project_avatar_figures.py` | `Tools/queue_second_band.sh` |
| `Tools/editor_jobs/zc_*.py` | `Tools/editor_jobs/` (world jobs) |

So the default is **both lanes run, always**. There is no file-level reason to serialise.

## Content ownership, by the paths that exist

`Content/` as it really is (asset counts measured 2026-09-23):

| path | assets | owner |
|---|---|---|
| `Content/UI/` | — | **INTERNAL** |
| `Content/Wonderland/` (incl. `Maps/WonderlandHub.umap`) | — | **INTERNAL** |
| `Content/WonderlandV2/Characters/` | 454 | **INTERNAL** — mascots, Relay Dog, avatars |
| `Content/WonderlandV2/VFX/`, `Data/` | 2, 7 | **INTERNAL** |
| `Content/WonderlandV2/Kit/` | 408 | **WORLD** — building modules |
| `Content/WonderlandV2/Materials/` | 183 | **WORLD** |
| `Content/WonderlandV2/Architecture/` | 46 | **WORLD** |
| `Content/WonderlandV2/Vegetation/`, `Textures/` | 34, 34 | **WORLD** |
| `Content/WonderlandV2/Props/`, `Ground/` | 31, 21 | **WORLD** |
| `Content/WonderlandV2/Mushrooms/`, `Sky/`, `Scenic/`, `Marble/`, `HLOD/` | 8,7,3,3,2 | **WORLD** |
| `Content/WonderlandV2/Maps/` | 5 | **SHARED — the only real contention** |

Source and tooling: `Source/Wonderland/**` is **INTERNAL** except where World owns a generator; `WorldDesign/**`
is **WORLD** entirely; `Tools/editor_jobs/` is shared by directory but never by file (`zc_*` is Internal).

## The one genuine conflict, and it is narrower than it looks

**`Content/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2.umap`** — 45 MB, monolithic, and both lanes place actors
in it. `world_audit` reports `world_partition: None`: despite the `_WP2` in its name **this map is not
partitioned**, so it is one non-mergeable binary file and last-save-wins.

Two aggravating facts, both measured:

1. `wonderland-proof/wonderland/Content` is a **junction onto `wonderland-task3/wonderland/Content`**. The
   worktrees are separate for source and identical for content. Ownership must therefore be by PATH, never by
   worktree — checking out a different branch does not give a lane its own assets.
2. The sibling map `WL_V2_GoldenArrival.umap` **does** use One File Per Actor — 631 files under
   `Content/__ExternalActors__/WonderlandV2/Maps/WL_V2_GoldenArrival/`. The project already knows how to do
   this. The authoritative map simply is not converted.

### The real fix, proposed not taken

**Convert `WL_V2_GoldenArrival_WP2` to World Partition / OFPA.** Each actor becomes its own file, so Internal
placing a terminal and World placing a district stop being the same write. That removes the last serialising
resource in the project, and it also clears beta-ledger row H, which currently reads BLOCKING because all
20,843 actors are permanently resident with no streaming at all.

It needs the editor and it changes the authoritative map, so it is the founder's call, not this lane's.

## Until then: the protocol that keeps both lanes moving

**Editor resource contention is not project-wide blocking.** One local editor fits in 15.7 GB (one instance sat
at 3.7 GB with 0.78 GB free at peak), so two live editors on this machine is a memory question, not a
permissions question. Everything below needs no editor at all.

**A lane never idles.** World Development keeps a queue of runnable work that touches no shared asset:

- audit and coverage passes over the 270 layer specs
- generator fixes and new district generation
- offline validation gates (`validate_layer_spec`, `audit_nation_band`, `audit_nation_detail`)
- third-band and next-district design
- Blender revisions and versioned export
- beta-ledger measurement

Only a task that must WRITE the shared `.umap` waits, and it waits alone — the lane moves to the next queue
item immediately and returns when the map is free.

**Claiming the map.** Whoever holds the editor holds the map. The channel's `heartbeat.json` already says who
is live and `apply_layer` already refuses to save over another lane's unsaved work (`map_dirty_before` must be
empty) — that guard is what proved the map was clean before the second band landed today. Nothing further is
needed beyond announcing the claim and releasing it cleanly via `handoff_editor` then `quit_editor`.
