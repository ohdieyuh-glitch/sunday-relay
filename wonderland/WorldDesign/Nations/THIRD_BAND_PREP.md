# Third band — prepared offline, 2026-09-23

Written while Internal Development held the editor. Nothing here is applied, and nothing here needs new art.

The founder's constraint on this expansion was explicit: **do not make every band a copy of avenue + six towers
+ plaza + gate.** The world needs increasingly differentiated districts. So the first question was not "what
should the third band contain" but "what does the world already own that it has never used".

## The finding that decides the third band

**83 of the kit's 129 modules have never been placed by any nation pass.** The first and second bands together
draw on 50. The unused 64% is not a random remainder — it clusters into coherent district vocabularies that the
world has simply never opened:

| vocabulary | unused modules | what it unlocks |
|---|---|---|
| **Water** | `Water_Canal_Run`, `Water_Canal_Crossing`, `Water_Cascade_Stair`, `Water_Pavilion`, `Water_Sunken_Pool`, `Water_Spillway_Wall`, `Hero_Water_Court` | An entire water district. Wonderland currently has no water in any nation. |
| **Vertical circulation** | `Stair_Curved`, `Stair_HalfTurn`, `Stair_Quarter_Landing`, `Stair_Straight_T2`, `Stair_Straight_T3`, `Wall_Stair_Flight`, `Ramp_Terrace`, `Garden_Overlook` | Multi-level districts, and the only honest way to make the sky bridges real. |
| **Landmark / hierarchy** | `Hero_Gate_Royal`, `Hero_GreatSpire`, `Hero_Water_Court`, `Spire_Cluster`, `Spire_Ringed`, `Spire_Barbed`, `Wall_Mural_Tower`, `Tower_Crown_Ribbed`, `Tower_Crown_Pavilion`, `Tower_Crown_Cap` | Skyline hierarchy and recognisable navigation cues — the founder's "thousands of modular buildings with no hierarchy" problem, answerable with no new art. |
| **Fortification / edge** | `Wall_Curtain_Run`, `Wall_Corner_Bastion`, `Wall_Postern_Gate`, `Gatehouse_Twin__aged` | District edges that read as edges, and secondary entrances so a district is not one-way. |
| **Market / covered street** | `Market_Arcade_Insert`, `Market_Awning`, `Market_Covered_Passage`, `Market_Hanging_Sign` | Covered and semi-interior street, which no band currently has. |
| **Bridges at grade** | `Bridge_Arc`, `Bridge_Flying` | Crossings a player can actually walk, unlike the current sky bridges. |
| **Ground articulation** | `Ground_Flagstone_A/B/C`, `Ground_Steps_Broad`, `Ground_Step_Single`, `Ground_Kerb_Corner`, `Ground_Verge_Run`, `Ground_Tree_Grate` | Directly answers the standing note that the floor must not read as a flat procedural sheet. |
| **Garden / retaining** | `Garden_Retaining_Run`/`_Curved`/`_Corner_In`/`_Corner_Out`, `Garden_Planter_Wall`, `Garden_Gate_Threshold`, `Flower_Rose_Run`, `Flower_Lavender_Run`, `Flower_Daisy_Run` | Elevation transitions and planted edges. |

Two families are deliberately excluded from nation work: the Wonderland-flavour objects (`Object_TeapotPavilion`,
`TeaCup`, `TeaSaucer`, `PocketClock`, the mushrooms) read as Golden Arrival's character, not a nation's, and
`Sky_Island_*` is a world-scale decision rather than a district one.

## Proposed third band, differentiated by nation

Each nation gets district classes drawn from its own canonical identity, and **each gets a different structural
idea** so the bands stop rhyming. These are world-development readings of canon, inventing no new lore.

**ICARUS — video game development.** Structural idea: **terraced levels**. Icarus is the elevated, ethereal
nation and its towers already reach highest (74.5 m vs 52.7 / 51.5). Use the stair and ramp vocabulary to make a
band that is genuinely multi-level rather than a taller flat plan.
- *Engine district* — deep arcaded blocks, `Colonnade_Arcade`, covered passage.
- *Simulation campus* — courts around a `Hero_Water_Court`, the nation's landmark anchor.
- *GVE arena district* — the six existing Icarus GVE anchors given architectural rooms rather than medallions.

**NOCTIS — content creation.** Structural idea: **the covered and the lit**. Noctis is the one nation whose
signature accent `MI_V2_NoctisLuminous` is used zero times anywhere (see `WORLD_BETA_LEDGER.md`, row F). A band
built around covered passages, sound stages and screening halls is where controlled luminance belongs.
- *Film district* — `Market_Covered_Passage` and `Market_Awning` as stage frontage.
- *Music / audio district* — enclosed courts, few windows, luminous thresholds.
- *Media archive* — `Wall_Mural_Tower` as the landmark silhouette.

**TARTARUS — software and application development.** Structural idea: **water as infrastructure**. Crimson and
bronze against canal and spillway reads as a working technical city rather than a demonic one, and it opens the
water vocabulary without inventing lore.
- *Application district* — dense work blocks on a canal grid.
- *Infrastructure quarter* — `Water_Spillway_Wall`, `Water_Cascade_Stair` as visible working systems.
- *Deployment / operations district* — `Wall_Curtain_Run` and `Wall_Postern_Gate` edges, `Hero_GreatSpire` anchor.

## Two things the third band must fix, not repeat

1. **The 800–900 m seam.** That ring is the thinnest in all three nations at once (852 / 715 / 1,060 against
   1,300–2,600 either side) and it is exactly where band one meets band two. A third band laid at 1,155 m will
   create a second seam at the same radius offset unless the joint is designed as a district in its own right
   rather than as the edge of two.
2. **Sky bridges.** They currently do not collide, which is correct only because nothing reaches them. The
   unused stair vocabulary is what would make tower chains climbable — and **the moment any third-band pass
   gives a tower chain stairs, the sky-bridge collision decision must change in the same commit**, or the first
   player to reach a tower top walks into a bridge that is not there.

## Needs a founder decision before generation

- **How much luminance Noctis carries**, and where. The material is canon and exists; the amount is a visual
  call, and the risk named by the founder was drift toward generic gothic in one direction and neon in the other.
- **Whether Tartarus gets water at all.** It is the strongest differentiator available, but it is also the
  largest single change to a nation's character proposed here.
- **Whether the third band extends outward (1,155 → ~1,500 m) or thickens inward** to repair the 800–900 m seam
  first. Coverage says the seam is the real weakness; ambition says outward.
