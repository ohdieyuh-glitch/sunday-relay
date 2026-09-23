# TWO WONDERLAND UNREAL SESSIONS, RUNNING AT THE SAME TIME

Founder rule, 2026-09-23, permanent:

> DO NOT SERIALIZE THE TWO UNREAL ENGINE DEVELOPMENT SESSIONS. The default state is INTERNAL || WORLD, and when
> Blender is needed, INTERNAL || WORLD || BLENDER. "Another Wonderland session is currently working" is not by
> itself a reason to wait.

This file is the contract both lanes work against. It exists so neither has to ask the other for permission to
start something.

## THE TWO LANES AND WHAT EACH OWNS

Paths below are the real ones in this project, not invented.

**LANE A — UNREAL INTERNAL DEVELOPMENT** (this file's author)
- `wonderland/Source/Wonderland/` — all runtime C++: Julius Terminal, Mission Contracts, companion terminals,
  HUD, Relay Dog runtime, mascot runtime, Wonder Web, Project Brain integration
- `wonderland/RelaySkins/`, `wonderland/RelayCubs/`, `wonderland/ProjectAvatars/` — mascot and avatar figures
- `wonderland/Tools/` — generators and editor jobs
- `Content/WonderlandV2/Characters/` — character-side assets

**LANE B — UNREAL WORLD DEVELOPMENT + BLENDER**
- `Content/WonderlandV2/` — `Maps/`, `Architecture/`, `Ground/`, `Kit/`, `Props/`, `Scenic/`, `Vegetation/`,
  `Mushrooms/`, `Marble/`, `Sky/`, `Materials/`, `Textures/`, `VFX/`, `HLOD/`
- `wonderland/WorldDesign/` — layer specs
- `wonderland/art/blender/` — the Blender forge

**The overlap is small and known:** `Characters/` (A) sits inside `Content/WonderlandV2/` (B). Treat
`Characters/` as Lane A's; everything else under `WonderlandV2/` is Lane B's.

## WHAT ACTUALLY BLOCKS, AND WHAT ONLY LOOKS LIKE IT DOES

**A real block is one file or one non-mergeable binary asset that both lanes must write at the same time** — the
same `.umap`, the same Blueprint, the same Data Asset. That is rare, and even then only THAT TASK blocks, never
the lane.

**These are NOT blocks, and neither lane should wait on them:**
- the other lane is editing unrelated C++ while this one edits a map, or vice versa
- the other lane has the Unreal Editor open
- the other lane is mid-commit on its own paths

**LOCAL EDITOR RESOURCE CONTENTION IS NOT PROJECT-WIDE BLOCKING**, and conflating the two is what cost this
project time. Two genuine constraints exist on this machine and neither stops development:

1. **One editor at a time.** `wonderland-proof/wonderland/Content` is a directory junction onto
   `wonderland-task3/wonderland/Content` — one physical Content tree and one `.umap`. Two editors are two
   writers on that map. Also the box is 15.7 GB and an editor is ~4 GB.
2. **An editor-target link needs every editor closed.** UBT refuses machine-wide while any editor with the Live
   Coding module is running — measured 2026-09-23: a world-lane editor on `task3` blocked an editor build for
   `proof`, a different worktree with its own `Binaries`. Killing the LiveCodingConsole helper does NOT lift it.

**What to do instead of waiting for the editor:** source edits, figure generation, Blueprint/asset preparation,
tests, analysis, import preparation, automation, validation, commits. A GAME-target compile check works with an
editor running (adaptive build compiles changed files standalone and never links), so C++ can be verified
without the editor at all.

## DEPENDENCY-AWARE SCHEDULING

Every task is INDEPENDENT (run it now), SHARED DEPENDENCY (freeze the interface, both continue against it), or
BLOCKED (record it, take the next runnable task). Keep a queue so one blocked task never idles a lane. Genuinely
waiting should be rare enough to be worth reporting when it happens.

## THE BLENDER -> UNREAL HANDOFF

Versioned, so neither end waits for the other to finish:

```
BLENDER  builds WORLD_Rn  ->  validates  ->  publishes Rn
UNREAL WORLD             integrates Rn   while BLENDER already builds Rn+1
UNREAL INTERNAL          never waits for either
```

Unreal consumes the latest VALIDATED revision; Blender moves to the next the moment one is published. Integration
happens at chosen boundaries, not continuously.

## COMMITS

Each lane commits its own coherent work on its own branch — Internal on `local/wonderland-companions`, World on
`local/wonderland-task3`. Small integration boundaries. Neither lane stages the other's paths; never `git add -A`
in a tree the other lane also writes.

## SHARED FILES THE INTERNAL LANE HAS TOUCHED

`Source/Wonderland/Wonderland.Build.cs` — `bEnableExceptions = true`, 2026-09-23.

WHY IT MATTERS TO THE WORLD LANE TOO. `WonderlandWireDecode.cpp` parses numbers with `std::stod` inside a
try/catch. UnrealBuildTool turns exceptions on for EDITOR builds and off for GAME builds, so the editor compiled
that happily while every game-target build of this module died with C4530 in the unity file holding it — before
reaching whatever file was actually being checked. Any `Build.bat Wonderland Win64` compile-check either lane ran
was failing for that reason and not for the change under test. The flag makes the two targets agree.
