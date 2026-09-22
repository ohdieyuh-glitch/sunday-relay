# The three nations' material language (prepared 2026-09-17, nothing built yet)

Canon: `NATIONS.md`. This file is the bridge from each nation's colour identity to the world's existing MATERIAL
SYSTEM, so that when a nation's first region is built nobody invents a one-off shader or mistakes a placeholder for
canon. Nothing here exists in the map yet, except where a row says it does.

## The system these must join

- One master, `M_V2_SurfaceHD`, with the parameters `TexScale`, `NormalStrength`, `DetailScale/Strength`,
  `Macro/MacroScale/MacroVary` and the per-object variation `InstVary / InstWarm / InstRoughVary`.
- Texture sets are GENERATED, not painted: `WorldDesign/Materials/hd_textures.py` holds the families (limestone,
  cobble, ivory, ivory2, ashlar, roof, gold, grass, flagstone). A new nation needs new FAMILIES there, appended to
  `SEED_ORDER` so existing sets never change, then instances of the master.
- Instances are named `MI_V2_<Thing>`. A nation's instances take its name: `MI_V2_Icarus<Thing>`, `MI_V2_Noctis…`,
  `MI_V2_Tartarus…`, so a batch, a census and a swap can all be read at a glance.
- Judge every set the way the material-realism phase judges: BEFORE capture, apply, AFTER at identical cameras,
  performance check, keep or revert. No blanket unique 4K textures; no grime -- Wonderland is maintained.

## ICARUS -- white, ivory, pearl, silver, bright glass, ethereal light

Icarus is the one nation that can start from what exists: the Golden Arrival city is already pale ivory. Its own
identity is what gets ADDED -- pearl and silver where the core uses gold, and clear bright glass where the core uses
dark glass.

| use | start from | new instance | note |
|---|---|---|---|
| wall ashlar | `MI_V2_AshlarMarblePale` (exists) | `MI_V2_IcarusAshlar` | cooler, higher value than the core's; keep IV01's calmer NormalStrength |
| carved stone | `MI_V2_IvoryStone` (exists) | `MI_V2_IcarusIvory` | the ivory2 family; IV02 showed carved pieces must read SMOOTH |
| pearl | new family | `MI_V2_IcarusPearl` | low roughness, faint iridescent warm/cool shift through `InstWarm`; for domes and inlay |
| silver | gold family, re-tinted | `MI_V2_IcarusSilver` | Metallic 0.9, Roughness ~0.45; Icarus's accent metal INSTEAD of gold |
| bright glass | `MI_V2_GlassTeal` (exists) | `MI_V2_IcarusGlass` | clear and luminous, not the city's dark sky glass (WIN01) |
| roof | roof family | `MI_V2_IcarusRoof` | pale silver-blue, so the skyline still reads as Wonderland |

## NOCTIS -- black, obsidian, dark glass, charcoal, subtle silver, luminous accents

Nothing in the world is dark-stone today. Noctis must be built so it reads CINEMATIC, never dead: dark materials with
real specular life, and emissive accents doing the drawing.

| use | new family | new instance | note |
|---|---|---|---|
| wall stone | charcoal ashlar | `MI_V2_NoctisAshlar` | dark value but NOT black: keep the joint pattern readable, or a wall becomes a silhouette |
| obsidian | polished dark | `MI_V2_NoctisObsidian` | low roughness with strong reflection; the nation's signature surface |
| dark glass | glass | `MI_V2_NoctisGlass` | for stage walls and screens |
| accent metal | gold family, re-tinted | `MI_V2_NoctisSilver` | subtle, cool, low contrast against charcoal |
| luminous accent | emissive | `MI_V2_NoctisGlow` | the light that makes it beautiful. LT01's lesson: unlit emissive needs a huge multiplier before it reads |
| roof | roof family | `MI_V2_NoctisRoof` | near-black with a sheen, so roofs still catch the sky |

Lighting is half of Noctis: a dark nation under the world's bright fantasy daylight will read grey and flat. Its
regions will need their own light treatment (`WorldDesign/Look/`), judged with the same before/after captures.

## TARTARUS -- red, crimson, dark red, warm metal, black accents, glowing red technology

Powerful and inventive, never evil. The trap is a red that reads as blood or as danger UI; the fix is depth of
material -- crimson STONE with real grain, warm metal, black accents -- rather than saturated flat red.

| use | new family | new instance | note |
|---|---|---|---|
| wall stone | crimson ashlar | `MI_V2_TartarusAshlar` | deep red stone with visible courses and per-block tone |
| dark red stone | crimson ashlar, darker | `MI_V2_TartarusStoneDark` | bases, undercrofts, the foot of every wall |
| warm metal | gold family, re-tinted | `MI_V2_TartarusMetal` | copper/bronze warmth, Metallic 0.85 |
| black accent | charcoal (shared with Noctis) | `MI_V2_TartarusAccent` | trim, frames, machine housings |
| red glow | emissive | `MI_V2_TartarusGlow` | the "technology and magic" light; use it for working machines, not decoration |
| roof | roof family | `MI_V2_TartarusRoof` | dark red, cooler than the walls so the silhouette separates |

## Rules that carry over from the phase already done

1. **Ground first.** GR01/GR02 moved the image more than any facade pass: a nation's paving decides how real it looks.
2. **A new texture alone is invisible** if a normal is wrong (IV01/IV02). Fix the response, then the map.
3. **Macro tone breakup on a big flat surface does nothing** (GS01). Geometry -- edges, courses, tufts -- does.
4. **Contact is what sells scale** (WB01): a wall must stand ON something, seated on the real wall plane.
5. Measure the cost of anything instanced in the same session, with a warm-up window (`perf_remove_ab.py WARM=True`).

---

## 2026-09-22 — all three nations now have their own materials

Until today NOCTIS and TARTARUS listed `materials_existing: []`. A nation with no materials cannot be built without
tinting at placement time, which is the exact trap `make_nation_materials.py` exists to avoid: the moment a tint
lives in a placement pass, every later pass has to remember it. So the sets were built the way Icarus's were —
each instance copies a source instance's already-earned tuning and overrides only what makes it the nation's own.

| nation | instance | from | what changed |
|---|---|---|---|
| ICARUS | `MI_V2_IcarusGlass` | `MI_V2_GlassTeal` | pale cool white-blue at roughness 0.075 — Icarus's canon signature is BRIGHT glass, and IC01 had to borrow teal because nothing paler existed |
| NOCTIS | `MI_V2_NoctisObsidian` | `MI_V2_Stone` | near-black, roughness 0.17, specular 0.78 — **polished**, so it catches light and reads as black glass rather than a dark hole |
| NOCTIS | `MI_V2_NoctisCharcoal` | `MI_V2_AshlarMarbleShade` | dark matte ashlar, the nation's workaday masonry |
| NOCTIS | `MI_V2_NoctisGlass` | `MI_V2_GlassViolet` | smoked dark glass |
| NOCTIS | `MI_V2_NoctisSilver` | `MI_V2_Gold` | cool silver at metallic 0.92 — Noctis's accent metal where the core uses gold |
| NOCTIS | `MI_V2_NoctisLuminous` | `MI_V2_Stone` | cool blue-white emissive at 2600 — the canon's "luminous details" |
| TARTARUS | `MI_V2_TartarusCrimson` | `MI_V2_AshlarMarbleBlush` | deep warm red masonry |
| TARTARUS | `MI_V2_TartarusRoof` | `MI_V2_RoofRose` | dark red roof |
| TARTARUS | `MI_V2_TartarusMetal` | `MI_V2_Bronze` | warm worked metal at metallic 0.86 |
| TARTARUS | `MI_V2_TartarusBlack` | `MI_V2_Stone` | black accent stone |
| TARTARUS | `MI_V2_TartarusEmber` | `MI_V2_Stone` | forge-glow emissive at 2300 |

**The founder's two warnings are built into the values.** Noctis is cinematic, not gloomy — which is why its
obsidian is polished rather than matte, and why it ships a luminous accent at all. Tartarus is engineering, not
demonic — which is why its accent is a forge ember at 2300 rather than a hellfire, and its metal is worked bronze
rather than something molten.

Emissive strengths are in SCENE units against Wonderland's physically-based sun. The same lesson the Cub Ghost's
ghost material taught at 55,000 applies here at a smaller scale: an emissive authored on a 0..1 artistic scale
renders black in this world.
