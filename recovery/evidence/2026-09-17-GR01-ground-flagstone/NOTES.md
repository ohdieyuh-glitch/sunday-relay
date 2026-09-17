# GR01 -- the city's flat paving tiles laid in flagstones (2026-09-17)

Founder material-realism phase, ground first.

Survey (ground_census.json, ground_survey_before.jpg: downward traces in front of 12 gameplay cameras):
- the HD cobble streets and the authored slab fields already read as stone;
- the lawn (MI_V2_Moss / Lawn / Meadow) is about half of all visible ground and reads as flat carpet -- MQ09's grass
  texture was rejected, so it is a separate, later target;
- the 196 SM_terrace_platform tile ACTORS under the city's plazas, sidewalks and paths (terrace_tiles.json: PlazaShade
  35 / 53,435 m2, PathWarm 66 / 19,380, PathStone 69 / 12,111, PlazaCream 20 / 1,089, PlazaWarm 6 / 241) wore the
  seamless limestone, so a 9-40 m tile read as one poured slab: the "giant block" look.

Material: a new 'flagstone' family in hd_textures.py -- random-ashlar stones, recessed ~1 cm joints with a little dirt
settled along them, bevelled and lightly chipped arrises, per-stone tone / warmth / roughness and tilt, fine grain and
sparse pits; clean and maintained. Three shaded previews: 1 read as even tile courses (flagstone_preview1_rejected),
2 had stain-like cloud blotches across stones (preview2_rejected), 3 kept.

Application, without touching anything else: the paving instances are SHARED (paving_users.json -- PlazaCream also
dresses 371 garden arches; all of them cover kerbs and the forge's real flagstone and slab meshes). So five TWINS
MI_V2_GroundFlag_<name> (copies on M_V2_SurfaceHD, same colour and tuning, flagstone maps; plazas TexScale 0.0025,
paths 0.0033 for smaller stones), and only the 196 tile actors point at them (apply_actor_materials.py,
gr01_ground_swaps.json: 196 changed, 0 refused; REVERT restores every before).

Judgement (gr01_down.jpg, gr01_normal.jpg; identical cameras, before/after): clearly better where the tiles are --
FillE51 and East58 turn from a poured slab into laid flagstones that sit naturally beside the cobble, and read as
paving at gameplay distance. Cloister and Clock plaza ground unchanged (not these tiles). No regressions.
Performance: not measured in PIE. Same master shader, same-size texture set, no geometry: shader cost unchanged,
~3 additional 2048 px maps in memory. Kept. Saved: zzAJ95_save_gr01.json.
