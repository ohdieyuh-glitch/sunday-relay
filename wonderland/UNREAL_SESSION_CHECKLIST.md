# Wonderland — the first Unreal-capable session

Everything below was prepared on a machine that CANNOT run Unreal (ChromeOS
container: Celeron N4020, ~2.7 GiB, no GPU). The blocker is recorded as
**EXTERNAL_UNREAL_EXECUTION_ENVIRONMENT_REQUIRED**, and nothing in this
repository claims playability. This checklist maps the founder's evidence chain
to the artifact that proves each step, so the paid session spends its hours on
proof rather than on setup.

Machine bar: UE 5.4, ~32 GB RAM, dedicated GPU, ~200 GB free disk.

| # | Step | Command / action | Evidence to capture |
|---|---|---|---|
| 1 | Unreal available | install UE 5.4 | `UnrealEditor -version` output |
| 2 | Project generated | right-click `Wonderland.uproject` → Generate project files | generated build files listed |
| 3 | C++ compiled | build `WonderlandEditor` (Development) | full build log, zero errors |
| 4 | Linked | same build | `UnrealEditor-Wonderland.dll`/`.so` exists, size logged |
| 5 | Launches | open the project | editor screenshot with the project name visible |
| 6 | Map loads | author `/Game/Wonderland/Maps/WonderlandHub` (the .umap cannot be honestly authored off-editor), set as startup | PIE launches into it, log line captured |
| 7 | Dog spawns | PIE — `AWonderlandHubGameMode.DefaultPawnClass` is the Dog in C++ | screenshot of the pawn; `showdebug pawn` output |
| 8 | Controllable | author the Input assets (`IMC_Wonderland`, `IA_Move/IA_Look/IA_Jump`), assign on the pawn | video clip of movement |
| 9 | Assets render | hub blockout with the founder's art direction (violet arcane circle, voxel Dogs, glossy HD) | 4K screenshot |
| 10 | Relay integration | point the Bridge sync layer at a running Relay Bridge; `RelayWorldState` populates | side-by-side: Relay mission state and the in-world terminal showing the same facts |
| 11 | GVE interaction | the representative GVE reads real Relay execution/verification | video of the interaction + the Relay-side record it reflects |
| 12 | Evidence captured | collect 1–11 into `docs/relay/WONDERLAND_SLICE_EVIDENCE.md` | the document, with hashes of the media files |

## What cannot be prepared here, and why

- **`.umap` / `.uasset` binaries** — editor-authored formats; writing them by
  hand would be fabricating assets.
- **Input action/mapping-context assets** — same. The ini declares Enhanced
  Input as the input classes; the assets bind on the paid machine (step 8).
- **Any screenshot or log claiming steps 1–12** — the machine cannot produce
  them truthfully.

## What IS prepared

- `Wonderland.uproject` (module + EnhancedInput plugin), `Target.cs` pair,
  `Build.cs` with every dependency the C++ actually uses.
- `Config/DefaultEngine.ini` (startup map, Lumen/VSM, the hub GameMode),
  `DefaultInput.ini` (Enhanced Input classes), `DefaultGame.ini` (identity).
- `AWonderlandHubGameMode` — the C++ that makes step 7 true by construction:
  the mode's default pawn IS the Dog. The config named this class before it
  existed; checking config against source caught it here instead of as a launch
  failure on the paid machine.
- All C++ syntax-checked against stubbed engine types (2 of 3 translation units
  parse clean; the residue is UHT-generated symbols). That is NOT compilation
  and is claimed nowhere as such.
