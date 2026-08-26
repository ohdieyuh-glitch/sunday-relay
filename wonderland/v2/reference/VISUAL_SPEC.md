# Wonderland V2 — visual specification (the world bible)

**Foundation:** the Marble-generated world `ae83acaa-df79-4e92-b31f-53af690d5deb`
(`marble-royal-garden-backdrop-panorama.png`, this directory). Not inspiration:
the starting universe. Every future district inherits this grammar unless the
founder establishes a deliberate new biome.

## Measured from the source (see ANALYSIS.md)

| quantity | value |
|---|---|
| eye height | 2.62 m; camera LEVEL (horizon at mid-frame) |
| sun | azimuth +79° (viewer's right-front), elevation +58°; warm-white |
| plaza | ~16 m wide, large pale slabs ~1.3 m in a loose cream/grey checker, wide seams, petals only |
| central path | dark stone, 4.4 m wide at 9 m, narrowing; three low steps at 15 m; rises gently |
| side walls | 0.85 m cream retaining walls at ±8 m, raised beds behind |
| rose cones | 3.8 m wide × 5.7 m, at ±8.5 m, on the beds |
| the gate | ONE gate 4.2 m wide, ~9 m tall, 9.3 m behind the viewpoint, gold leaves, cream piers |
| giant mushroom | ~20 m cap, underside ~11 m up, ~22 m away at −63°; clock on the stem; ivy on the cap |
| clock tree | ~12 m, 33 m away at +61° |
| heart topiary | ~5 m, ~35 m away at +22°, on a terrace |
| towers | white drums with dark navy conical caps, 55–70 m |
| city | 90–170 m and beyond; recedes into pale haze |

## Palette (measured by pixel population)

| role | sRGB (lit) | V2 albedo instance |
|---|---|---|
| plaza cream slab | (196,184,160) | `MI_V2_PlazaCream` (0.70,0.66,0.57) |
| plaza grey slab | (150,152,144) | `MI_V2_PlazaGrey` (0.50,0.52,0.48) |
| path stone | (96,92,86) | `MI_V2_PathStone` (0.30,0.29,0.27) |
| cream masonry | (214,205,186) | `MI_V2_IvoryStone` (0.74,0.70,0.62) |
| gold | (196,150,80) | `MI_V2_Gold` (0.92,0.70,0.36) metallic 0.9, rough 0.42 |
| roof pink | (176,118,120) | `MI_V2_RoofPink` (0.64,0.40,0.42) |
| roof navy cap | (44,46,72) | `MI_V2_RoofNavy` (0.10,0.12,0.24) |
| foliage | (60,92,44) mid | `MI_V2_LeafMid` (0.14,0.26,0.10) |
| mushroom cap | (168,84,72) | `MI_V2_MushTerracotta` (0.60,0.30,0.24) |
| sky | bright blue, large soft white clouds | the panorama itself above +8° |

Primary: CREAM · PALE STONE · GREEN · MUTED PINK · GOLD. Secondary: red/pink
flowers, soft purple, dark green, pale blue. Never: neon pink, pure white,
neon gold, purple global light, saturated vegetation.

## Composition rules

1. The centre stays OPEN and traversable: plaza → dark path → steps → corridor → arch → city.
2. Density lives in organised BANDS at the sides: wall → bed → hedge → topiary/roses → trees. Balanced, never mirrored.
3. Landmarks are placed by hand: the giant mushroom (left), the clock tree (right), the heart (right, terrace), the towers, the arch. PCG never places them.
4. The plaza carries slabs and a few petals. Nothing else.
5. The city is DEPTH: five layers, each softer and cooler than the last. Not clutter.
6. Magic is restrained: a small rune disc, low glow, floating keys/teapot high and few.

## Lighting rules

Bright late-morning fantasy daylight: sun 60,000 lux at el 58°, 5600 K; sky
light real-time; clear pale haze (fog density 0.005, pale blue-white); neutral
grade; bloom 0.35 at threshold 1.2; auto-exposure with extended range. No
golden-hour orange, no purple shadows, no emissive surfaces beyond the disc.

## Material rules

Stone: subtle normals, roughness variation, seams, warm variation, never
white. Gold: metallic, varied roughness, darker recesses, never emissive.
Foliage: readable leaves, subsurface, restrained wind. Mushrooms: organic
roughness, cap/stem differentiation, subtle colour breakup. Roofs: visible
tile/shingle, muted pink or navy, real shadows.

## Permanently rejected (V1 language)

Voxel/cube vegetation, sphere trees, cylinder+cone towers, stacked-cube
palaces, flat colours, pure-white block architecture, neon plastic roofs,
yellow emissive gold, primitive mushrooms, random clutter, a synchronised
world pulse, asset count or instance count as quality. If an asset looks like
V1: delete or replace it. Do not polish it.
