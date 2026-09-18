# GQ01: the grass (SAVED 2026-09-17)

Founder: the grass reads smooth, glossy, flat, pixelated at some distances, and insufficiently defined across large
lawns. Fix the material itself and find the actual cause of the pixelation rather than hiding it behind props.

## The diagnosis (diagnosis_before.json)
Read off the assets, not guessed:
- **The lawn's textures are 256 x 256.** `T_V2_sward_a/_n/_r`, tiled every 55 cm: about 460 texels per metre. A
  player standing on the lawn out-resolves that, which is exactly the "pixelated at some distances" complaint. No
  number of grass tufts can fix a 256 px texture.
- **The lawn was on `M_V2_Surface`**, which has no detail scale, no macro input and no per-instance variation --
  every lever the founder asks for (micro normal, restrained macro, distance response) lives on `M_V2_SurfaceHD`.
- Roughness 0.86 with Specular 0.15 on a fibrous surface: the sheen the founder calls glossy.

## What was made
`hd_textures.sward`, 2048 px and tiling: blades are FIBRE -- white noise smeared along one axis so each stroke is a
blade a couple of centimetres wide at a 1 m tile -- in two lengths that follow the same local lie, with the lie
changing in patches of about 20 cm, so the lawn reads mown in strokes. Over it a fine tip speckle; under it clumps
and a slow ground swell. Each stroke is sharpened (a blurred copy taken back) so blades keep their edges.

Two earlier cuts are in the family's history and both were wrong in a way worth remembering: the first made blades
2-4 px wide and read as **velvet**; the second crossed the two fibre directions in the same place and read as
**woven linen**. Grass in one patch has to lie one way.

**Macro variation is carried by DIRECTION, not tone.** GS01's tonal macro breakup was invisible and the founder
asked not to repeat it; the mown-stroke patches do that work instead, with MacroVary at 0.035 as a whisper.

## The material now
The three lawn instances (Lawn, Meadow, Moss) on `M_V2_SurfaceHD`: TexScale 0.009 (a 1.1 m tile, so 1,860 texels per
metre -- four times the old density from an eight-times bigger texture), NormalStrength 1.0, DetailScale 4 with
DetailStrength 0.33 for micro structure inside 30 cm, Roughness 0.95 / RoughVary 0.2 / **Specular 0.06** to kill the
sheen, InstVary 0.02 and InstWarm 0.01 (restrained), Macro at ~60 m with MacroVary 0.035. Colour is LW01's deeper,
less acid green, unchanged.

## Judged, three states, identical cameras (`gq01_poses.json`)
`gq02_three_way_close.jpg` and `gq02_three_way_street.jpg`: before / first cut / kept cut.
- **Very close and close:** before is a smooth plane with faint banding; the kept cut shows dense blade fibre with no
  dark patches. The first cut had visible clump blotches, which is the "dirty, noisy" failure the founder warned
  about -- the clump field was made finer and its contrast roughly halved.
- **Down at the lawn:** fine even grain, no tiling seam visible.
- **SW_StreetGate46, Mushroom Grove, Colonnade (street distance):** the lawn now has grain where it was a flat green
  sheet; not busier, just defined.
- **Hero view and WorldCam12 (aerial):** unchanged, no shimmer, no noise.

## Performance -- it is FASTER
`zzDY00`, `zzDY20`, `zzDY40`: three PIE windows in one session, new / old / new, four cameras each, median frame ms.

| state | mean | Lantern Lane | Mushroom Grove | StreetGate | aerial |
|---|---|---|---|---|---|
| new sward on SurfaceHD | 40.93 | 37.59 | 35.16 | 35.51 | 55.46 |
| old 256 px on M_V2_Surface | 62.89 | 72.66 | 69.78 | 47.64 | 61.49 |
| new sward again | 44.37 | 39.01 | 31.42 | 40.62 | 66.42 |

About 20 ms faster at the lawn cameras, and the ordering (new, old, new) rules out drift. The likely reason is that
`M_V2_Surface` synthesises its detail procedurally per pixel -- the same procedural noise GL01 had to escape to stop
glass glittering -- while `M_V2_SurfaceHD` samples textures. A bigger texture bought a cheaper shader.

## Saved
The three instances are saved assets; the map was not touched. `record.json` holds every prior value, and
`reparent_mi.py REVERT` restores parent, parameters and textures exactly.
