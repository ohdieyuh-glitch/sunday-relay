# Relay Dog skin roster — 2026-09-29: Jack Flame and Baal replace Arden Infernal and Apollo

## The founder's order

> REMOVE / REPLACE: 1. Arden Infernal 2. Apollo. REPLACE THEM WITH: 1. JACK FLAME RELAY DOG 2. BAAL RELAY DOG.
> These are replacements, NOT additional roster slots.

The premium roster is now:
1. Relay OG
2. Celestial Light
3. Skeleton Flame
4. Jack Flame
5. Baal

Skeleton Flame keeps its V1 twin (`skeleton_flame_v1`, from the 09-27 "keep V1 and V2" instruction). It was left in
place because the order says not to disturb Skeleton Flame. **OPEN FOR THE FOUNDER:** whether the Wardrobe should show
exactly five cards, which would drop the Skeleton Flame V1 twin.

**Reference sheets (the visual authority):**
- `RelaySkins/_reference/JackFlame_reference_2026-09-29.png`
- `RelaySkins/_reference/Baal_reference_2026-09-29.jpg`

## The canonical rule

> Every skin must preserve the canonical Relay Dog body type. The skin is a costume/material/accessory transformation
> wrapped around the Relay Dog.

Both new builders call `base_dog()` first, like every skin, and `main()` refuses any skin not built on it.
- **Jack Flame:** dress only.
- **Baal:** dress plus a mask on the canonical head. The mask carries the Dog's own status eyes forward to the skull's
  sockets, at the same size, height and spacing.
- **Tails:** both carry the simple single-line tail (`simple_tail()`); Jack's has a flame at its end.

## What changed

| where | what |
|---|---|
| `Source/Wonderland/WonderlandRelaySkins.cpp` | Roster in the founder's order: `relay_og`, `celestial_light`, `skeleton_flame_v1`, `skeleton_flame`, `jack_flame`, `baal`. Arden Infernal (V1/V2) and Apollo (V1/V2) unregistered. `MigrateRetired()` is applied to the remembered file (rewritten once), `EquipSkin` and `ApplyRemoteSkin`. |
| `Source/Wonderland/WonderlandRelaySkins.h` | `MigrateLegacySkinId` (BlueprintPure), for the proof job; SHADOW family. |
| `Tools/relay_dog_skins.py` | `jack_flame()`, `baal()`, `simple_tail()`, `pinstripe_block()`; cub dress for both; `CUB_SKINS` entries **appended** (a cub's seed is its index). |
| `RelaySkins/JackFlame.wlvox`, `RelaySkins/Baal.wlvox` | New figures: 1,825 / 2,185 boxes, 19 / 22 parts, 10 / 11 materials, 5.78 uu voxel (same scale as every skin). |
| `RelayCubs/CubGhost_{JackFlame,Baal}_{Flat,Arc,Slant}.wlvox` | New cubs. The cub subsystem picks them by the figure file's stem, so no code change. |
| `Tools/editor_jobs/zc_skin_parity_all.py` and 11 other roster-listing jobs | Roster lists updated. |
| `Tools/editor_jobs/zc_skin_roster_0929.py` | New proof: registry, migration mapping, equip-by-retired-id, remembered-skin migration, every roster skin equips. |

**Migration.** The only persisted state in this build is the equipped skin id in `Saved/Wonderland/RelaySkin.txt`.
There is no ownership store: every premium skin is a DEVELOPMENT PREVIEW, and no account authority grants anything
yet.

| retired id | becomes |
|---|---|
| `arden_infernal` | `jack_flame` |
| `arden_infernal_v1` | `jack_flame` |
| `apollo` | `baal` |
| `apollo_v1` | `baal` |

The map applies wherever an id enters the registry: the remembered file, a remote report, and an equip from the
console, the Wardrobe or `/skin`.

**Not changed:**
- Relay OG, Celestial Light and Skeleton Flame. All 25 of their existing figure and cub files regenerate
  byte-identical after the change (sha256, same run).
- Thumbnails and icons: none exist as assets; the Wardrobe renders each figure live.
- Arden Infernal and Apollo are unregistered, not deleted (the Bee/Hagoromo precedent). Their builders and `.wlvox`
  files stay on disk.

## Verification status (2026-09-29, DLL 09:47 from commit 9045214a)

**Build:** `WonderlandEditor Win64 Development` Succeeded (67 s) and `Wonderland Win64 Development` (game target)
Succeeded (73 s); the game-target guard is green.

| proof | result |
|---|---|
| `zzS04` zc_skin_roster_0929 | **PASS 4/4.** `wl.Skins.List` = relay_og, celestial_light, skeleton_flame_v1, skeleton_flame, jack_flame, baal (no retired id). Wearing arden_infernal / arden_infernal_v1 draws Jack Flame; apollo / apollo_v1 draws Baal. A remembered `arden_infernal` and `apollo` come up drawn as Jack Flame / Baal in a fresh session, with the file rewritten. Every skin draws a distinct figure over a living Dog. The player's own remembered skin was restored. |
| `zzS07` zc_skin_parity_all | **PASS 6/6.** Every skin, Jack Flame and Baal included, wears the canonical Dog's pose field for field (0 mismatches) and performs the Mission Contract act. Relay OG is the reference body. |
| `zzS08` zc_skin_sheet | **PASS.** 36/36 views exported, every figure in the founder's band, none pinned white. |

**Visual evidence:**
- `Tools/captures/zc/skin_sheet/JackFlame_reference_vs_engine.jpg`
- `Tools/captures/zc/skin_sheet/Baal_reference_vs_engine.jpg`

Each is the reference, then the in-engine front and 3/4, then flat SIDE and REAR renders of the geometry.

**Caveat:** the wardrobe stage's orbit views all show the front, because the costume turns to face the camera after
idling. The in-engine side and rear frames are therefore not side and rear views, and are not presented as such.

**Colour pass after the first in-engine look:** the engine's real-fire surfaces lift a flame's colour toward white.
- Jack's orange rendered yellow, and his heart a yellow slab.
- Baal's blue rendered ice.
Both were authored deeper, as a text regeneration with no rebuild.

**Not yet judged:** resemblance to the sheets is the founder's call, from the pictures.
