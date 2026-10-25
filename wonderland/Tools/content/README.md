# Wonderland world content outside git

The startup map `/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2`, its World Partition actors, and the rest of the world
content are **not tracked by git**. A clean checkout compiles and even cooks, but the packaged client then fails at launch
with `Failed to enter /Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2`. Every Private Beta package was cooked from one
working tree, `C:\dev\iwonder\wonderland-task3`, which until 2026-10-25 held the only copy of this content.

## What is untracked

`untracked_manifest.csv` lists every file (path, bytes, sha256) as found in `wonderland-task3` at `aa930c26`:

| Folder under `wonderland/Content` | Files | Size |
|---|---:|---:|
| `WonderlandV2` | 1,257 | 499.8 MB |
| `__ExternalActors__` | 31,332 | 153.9 MB |
| `Wonderland` | 151 | 130.4 MB |
| `UI` | 2 | 2.4 MB |
| `__ExternalObjects__` | 480 | 1.0 MB |
| **Total** | **33,222** | **0.79 GB** |

Origin: no licence, EULA, or marketplace marker files are present, and none of the 33,222 assets contains a Megascans,
Quixel, Fab, Marketplace, StarterContent, Paragon, InfinityBlade, or MetaHumans origin string. This is project-made
content. That scan is evidence, not a legal clearance.

## Where the copies are (verified 2026-10-25)

1. `C:\dev\iwonder\wonderland-task3\wonderland\Content`: the original working tree.
2. `C:\dev\iwonder\_pilot_qa\wl_build_qa\wonderland\Content`: the J1 build tree. All 33,222 files match the manifest
   by sha256.
3. `OneDrive\KaisinArchive\wonderland_content\task3_untracked_content_aa930c26.zip`
   - sha256 `05fa7b7c4093b24655289dd73b5635d27ad2f72a87d69b8cc3bda44bbe0c5d7a`, 699,654,700 bytes
   - Restored into an empty folder and checked against the manifest: 33,222 files OK.
   - It counts as a backup only once OneDrive shows it as synced.

## Restore into a checkout

```
# from the repository root (the folder that holds wonderland/)
certutil -hashfile task3_untracked_content_aa930c26.zip SHA256   # must equal the sha256 above
tar -xf task3_untracked_content_aa930c26.zip                    # writes wonderland/Content/...
python -I wonderland/Tools/content/check_cook_content.py --full  # must print COOK CONTENT CHECK PASS
```

## Before every cook

```
python -I wonderland/Tools/content/check_cook_content.py
```

The check fails, before any cook starts, if any of the following is missing or differs in size:

- a configured map (`GameDefaultMap`, `EditorStartupMap`, `MapsToCook`);
- a World Partition map's `__ExternalActors__` folder;
- a `/Game` `DirectoriesToAlwaysCook` entry;
- any manifest file.

`--full` also compares sha256. The package script used for the J1 client (`cl_package.ps1`) runs this check and refuses
to cook on failure.

## Changing world content

Edit the content in a tree that has it. Regenerate the manifest with `inventory.py` (the evidence folder
`C:\dev\iwonder\_pilot_qa\content_inventory`). Commit the new manifest and archive a new zip with its sha256 next to it.
Moving this content into Git LFS on the client line is the longer-term option. It needs LFS storage on the GitHub plan;
until then, the manifest and the verified archive are the source of truth.
