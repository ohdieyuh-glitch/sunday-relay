# MQ09 -- a grass texture for the lawns: built, judged worse, reverted (2026-09-16)

The city census put lawn at 48% of everything visible, read as one flat green sheet. MQ08 fixed the colour; this
tried to fix the flatness with a `grass` family on the HD master. **It did not work, and it is not in the world.**

| try | result |
|---|---|
| grass family v1 | `grass_ab.jpg`: tufted up close, but a visible **checkerboard** repeated across every lawn at mid-distance -- 14-140 cm lush/dry patches inside a 1.4 m tile repeat every 1.4 m |
| v2, patches removed | `grass_ab2.jpg`: checkerboard gone, but the lawn now reads **softer and flatter** than the V2 lawn it replaced |
| verdict | the V2 lawn texture already has directional blade streaks that read as grass up close. v2 was not better. Reverted. |

`grass_revert.jpg`: after revert, pixel-identical to before; MQ08's colour kept.

## Left behind on purpose

- `hd_textures.py` keeps the grass family, labelled rejected, for reference.
- The three twin instances MI_V2HD_Lawn/Meadow/Moss are **deleted**, and their plan entries removed.
  `apply_hd_materials.py` applies every twin it finds by default, so leaving either would quietly bring the
  rejected grass back on the next full apply.

## What would actually fix flat lawns

Not a texture. The V2 texture is fine at the scale a texture works at. What the Bible's lawns have and ours lack is
geometry above the ground plane: flowers, clover, tufts standing up out of it. That is a scatter pass, and it needs
a performance measurement before it is anything else.
