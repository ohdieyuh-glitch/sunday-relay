# Landing the Unreal Content tree: an LFS plan, not yet executed

**The risk, stated plainly.** `wonderland/Content` has **never been tracked in this repository's history — zero
commits, across every branch.** It is 2,049 files and 649.7 MB living on one laptop. `.gitignore` line 37 says
it is *deliberately not ignored* — "the hub map and the engine configuration are source, and the map is the one
asset the startup path depends on" — so the intent was always to track it and nobody ever has.

Every world change this project has ever made, including the authoritative 43.6 MB Golden Arrival map, exists
in exactly one place. A disk failure loses all of it.

**Protected first.** A verified checkpoint now exists at
`C:/dev/iwonder/recovery/checkpoints/Content-20260923-worldrun` — 2,049 files, 650 MB, and the authoritative
map's SHA-256 matches the live one byte for byte. That is a same-disk copy: it protects against a bad edit or
a destructive migration, **not** against drive loss. It is a seatbelt, not a backup.

## Inventory, measured 2026-09-23

| ext | files | MB | share |
|---|---|---|---|
| `.uasset` | 2,042 | 604.7 | 93.1% |
| `.umap` | 6 | 43.7 | 6.7% |
| `.png` | 1 | 1.3 | 0.2% |
| **total** | **2,049** | **649.7** | |

Three files exceed 50 MB — GitHub warns above 50 and hard-blocks above 100 without LFS:

```
75.7 MB  Wonderland/Marble/RoyalGardenBackdrop/mesh_hq/Textures/texture_image.uasset
75.7 MB  WonderlandV2/Scenic/Marble/mesh_hq/Textures/texture_image.uasset
75.7 MB  WonderlandV2/Marble/mesh_hq/Textures/texture_image.uasset
```

They are **not** byte-identical despite identical size and name — `.uasset` embeds its own package path and
GUIDs, so three imports of the same source art are three distinct blobs. LFS will store three copies. Whether
the project wants three copies of an 75.7 MB marble texture is a separate art question worth asking.

## The `.gitattributes` candidate

Not installed. Proposed at `wonderland/.gitattributes` so it governs the Unreal tree only:

```gitattributes
# Unreal binary assets. Always LFS, never diffed, never merged: a .uasset or .umap
# has no line-based merge and a textual merge silently corrupts it.
*.uasset filter=lfs diff=lfs merge=lfs -text
*.umap   filter=lfs diff=lfs merge=lfs -text

# Large source art that may land beside it later.
*.fbx    filter=lfs diff=lfs merge=lfs -text
*.blend  filter=lfs diff=lfs merge=lfs -text
*.exr    filter=lfs diff=lfs merge=lfs -text
*.hdr    filter=lfs diff=lfs merge=lfs -text
*.tga    filter=lfs diff=lfs merge=lfs -text
*.psd    filter=lfs diff=lfs merge=lfs -text
```

`merge=lfs` matters as much as `filter=lfs`: two lanes saving the same map is a binary conflict, and without
it git will attempt a textual merge and produce an unopenable map. This project already has two lanes sharing
one Content tree through a junction, so that case is not hypothetical.

## Why this is an ADD, not a history rewrite

Content has never been tracked, so there is no history to rewrite. `git lfs migrate` is unnecessary and its
risk is unwarranted. The whole operation is:

1. `git lfs install` in the worktree
2. commit `wonderland/.gitattributes` **alone**, first, so the filter exists before any asset is staged
3. `git add wonderland/Content` — LFS captures the blobs as pointers because the attributes are already in place
4. commit and push to a branch, never to main

Step 2 before step 3 is the whole trick. Staging assets first writes them into ordinary git history, and *then*
the migration does become a rewrite.

## Verification, before anyone trusts it

- `git lfs ls-files | wc -l` returns 2,049
- `git cat-file -p HEAD:wonderland/Content/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2.umap` shows an LFS
  pointer (three short lines), not 43 MB of binary
- a fresh `git clone` followed by `git lfs pull` into a scratch directory reproduces the map with a SHA-256
  matching the live file
- the editor opens that clone's map and the world contains DF01, XM01/XM02, AP01, GF01/GF02 and the bands

Until that last check passes, the checkpoint copy remains the thing that is actually protecting the work.

## Rollback

Before pushing: `git reset --soft HEAD~2` unstages both commits and nothing has left the machine. After
pushing: delete the remote branch; main is never touched. The checkpoint at
`recovery/checkpoints/Content-20260923-worldrun` is independent of git entirely and is the floor under all of
it.

## Storage implications, so the decision is informed

650 MB of initial LFS payload. GitHub's free LFS allowance is 1 GB of storage and 1 GB/month of bandwidth, so
this repository will need a paid data pack almost immediately, and every future map save adds another ~44 MB
version. A world saved ten times a day is ~440 MB of LFS growth per day. That is the real cost of tracking a
monolithic map, and it is one more argument for the World Partition / OFPA migration: per-actor files change
only where the edit happened, so a day's work becomes kilobytes instead of a fresh 44 MB blob each save.

**Not executed.** This is the plan and the candidate `.gitattributes`. Landing it is the founder's call.
