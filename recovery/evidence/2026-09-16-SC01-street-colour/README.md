# SC01 + LOOK02 -- the city streets stop being cold grey (2026-09-16)

## The survey that found it

`sv_a..sv_d.jpg`: 24 of the map's own review cameras, world-wide. From the air the world reads as the Bible's
enchanted city, and the hero corridor is close. **The city streets -- most of what a visitor walks -- do not**:
slate-blue cobbles, grey walls, black slot "windows", deep blue shade. That is the Bible's rejected list exactly
(grey-box, gritty, dark).

## What they are made of (`material_census.json`)

Three world-wide material instances: `MI_V2_Cobble` (the roads), `MI_V2_AshlarMarbleCool` / `AshlarMarbleShade`
(the cool grey walls), `MI_V2_WindowDark` (the black slots). And one surprise: the cobble's tint was ALREADY cream
(0.92, 0.82, 0.66) and rendered slate-blue -- so the tint was never the main cause.

## SC01: the materials (`sc01a_ab.jpg`, originals in `record.json`)

| instance | before | after |
|---|---|---|
| MI_V2_Cobble | tint (0.92,0.82,0.66), normal 1.2, detail 0.35 | tint (1.10,0.92,0.70), normal 0.85, detail 0.20, warm 0.06 |
| MI_V2_PlazaShade | (0.42,0.39,0.33) | (0.64,0.56,0.47) |
| MI_V2_AshlarMarbleCool | grey (0.69,0.69,0.72) | lavender-ivory (0.84,0.78,0.90) |
| MI_V2_AshlarMarbleShade | grey (0.56,0.56,0.58) | dusty rose (0.80,0.68,0.70) |
| MI_V2_WindowDark | near-black (0.12,0.12,0.14) | deep periwinkle glass (0.14,0.19,0.42), rough 0.18, spec 0.60 |

A modest real gain -- the windows became glass instead of holes -- but the streets stayed blue.

## LOOK02: the light was the cause (`light_rig_before.json`, `WorldDesign/Look/look02_warm_shade.json`)

Shade was lit by an unshadowed ground bounce tinted CYAN (214,244,238), a canopy fill tinted GREEN (220,236,214),
and a sky light capturing a sky LOOK01 had deliberately boosted toward blue (sky_luminance_factor 1.2/1.4/1.85),
with a black lower hemisphere. A bounce off pale cream paving is warm.

| try | what | result |
|---|---|---|
| a | fills + bounce warmed | **bluer** -- a bug, below |
| b | revert + retry | both refused, correctly -- a race, below |
| c | + sky light (255,222,190) | blue gone, but sepia, darker, hero corridor lost its brightness |
| **d** | bounce (255,238,220) x3000, fills neutral-warm, sky light (255,242,230) x2.25, lower hemisphere (0.22,0.19,0.17) | **chosen** |

`look02d_ab.jpg`: streets go from slate-blue to warm neutral, shaded walls read lavender-pink instead of cold blue,
and the hero camera and the Grand Clock keep their brightness -- nothing already approved regresses.

## Two bugs caught by the before-value check, both mine

- **`unreal.Color` positional arguments are BGRA.** Try (a) wrote `Color(255, 226, 196)` meaning warm and got BLUE,
  which is why that frame looked MORE violet. The revert found (196,226,255) where (255,226,196) had been recorded
  and refused. `apply_light_tune.py` now uses keyword arguments, with the reason written at the line.
- **Never rewrite a spec that a queued job will read.** A revert and an apply both read the file after it had been
  overwritten, compared against the wrong befores, and refused. Nothing was harmed -- which is the point of the
  check -- and transitions now go through their own scratch spec.

Map and the five material instances saved.
