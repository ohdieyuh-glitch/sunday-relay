# Wonderland canon: the three nations (founder directive, 2026-09-17)

These names are PERMANENT CANON and supersede every earlier placeholder nation name.

| Nation | Colour | Specialisation |
|---|---|---|
| **ICARUS** | WHITE | Video game development |
| **NOCTIS** | BLACK | Content creation |
| **TARTARUS** | RED | Software + application creation |

Wonderland is ONE connected world divided into three major nations, roughly as three large sectors of a circle.
They are not three separate games. Players travel between them.

## Hierarchy

    WONDERLAND -> NATION -> REGION / CITY / DISTRICT -> CLAN -> PLAYER / CREATION

A clan is NOT a nation. Clans live inside nations; a nation will hold many. The nation carries the larger cultural and
geographic identity; the clan is the player's smaller social organisation inside it. Example: nation ICARUS, clan
Dreamforge, specialisation multiplayer game development.

## Nations are centres of expertise, not restrictions

No player is locked to one kind of creation. A user may build an AI application in Tartarus, take it to Icarus and turn
it into an interactive game, then go to Noctis for its trailer, soundtrack, promotional campaign and livestream
content. Design for that journey: one project may use all three.

    TARTARUS  build the software
    ICARUS    build the interactive world / game
    NOCTIS    build the content and media around it

## ICARUS -- the white nation

**Video game development:** game creation, Unreal-style development, world building, level design, character creation,
gameplay systems, game AI, NPC behaviour, animation, physics, multiplayer, game mechanics, simulation, procedural
worlds.

**Visual identity:** white, ivory, pearl, silver, bright glass, ethereal light. Majestic, magical, luminous, highly
advanced. NOT plain white -- it needs material depth and architectural personality.

**GVE spaces:** physics simulation, multiplayer testing, combat/gameplay simulation, level-design evaluation, NPC
behaviour testing, animation testing, procedural generation, performance testing, game-world validation.

**NPC specialists:** WORLDsmith, Level Architect, Mechanist, Creature / Character Specialist, Simulation Guide,
Animation Specialist, Multiplayer Specialist.

## NOCTIS -- the black nation

**Content creation,** meaning any creator work: films, short films, YouTube content, livestreams, social content,
advertisements, music, podcasts, digital art, animation, documentaries, books and stories, virtual productions,
trailers, promotional content -- made for oneself or commissioned by other Wonderland users.

**Visual identity:** black, obsidian, dark glass, charcoal, subtle silver, luminous accents. Cinematic and beautiful,
never gloomy or dead: a premium creator civilisation, a fantasy production capital.

**GVE spaces:** virtual film stages, cinematography simulations, lighting studios, editing environments, sound stages,
music environments, virtual camera systems, motion capture spaces, audience/content testing, storytelling
environments, creator performance spaces.

**NPC specialists:** Director, Cinematographer, Editor, Story Specialist, Sound Specialist, Music Specialist, Virtual
Production Specialist, Creative Director.

## TARTARUS -- the red nation

**Software and application creation:** websites, mobile applications, SaaS, AI applications, APIs, developer tools,
agentic software, backend systems, frontend systems, databases, internal tools, cloud software, automation,
enterprise applications.

**Visual identity:** red, crimson, dark red, warm metal, black accents, glowing red technology and magic. Wonderland's
great engineering and invention civilisation: powerful, ambitious, technologically advanced. NOT evil because it is
red.

**GVE spaces:** application testing, API simulation, architecture validation, security testing, deployment simulation,
infrastructure simulation, load testing, database testing, agent testing, software reliability evaluation.

**NPC specialists:** Appwright, System Architect, Interface Specialist, Protocol / API Specialist, Database
Specialist, Deployment Specialist, Security Specialist, Agentic System Specialist.

These NPCs are Wonderland-native specialised helpers. They do not replace Julius.

## The map rule

The larger map should eventually show that Wonderland holds three civilisations. It must NOT be bought by destroying
or rebuilding Golden Arrival. Golden Arrival stays the universal, neutral arrival and crossroads. Nation identity
grows OUTWARD from the established core; new regions are placed deliberately inside Icarus, Noctis or Tartarus
instead of becoming generic territory.

DUBEL, if it stays outside the three-nation division, is preserved as an exception, not forced into a nation.

## Where the sectors fall (PROPOSED -- geometry, not identity)

Identity above is canon. The bearings below are this lane's proposal, chosen from what the map actually holds today
(`nations.json` carries the numbers; `WorldDesign/nations.py` is the one place that answers "which nation is this
point in?"):

- **The neutral core** is everything within 500 m of the world origin. Measured on 2026-09-17, every built district
  of the Golden Arrival world lies inside 400 m, so nothing standing has to move or change hands.
- **Beyond 500 m the map is nearly empty** -- 104 distant skyline buildings spread evenly around the ring and almost
  no props -- so each nation gets open ground to be built into.
- Three 120-degree sectors, measured as compass bearings from the origin in the map's own coordinates:
  - **ICARUS** 30 deg to 150 deg (north). It grows out of the existing pale ivory city, so the palette continues.
  - **TARTARUS** -90 deg to 30 deg (east and south-east).
  - **NOCTIS** 150 deg to -90 deg (west and south-west).
- 500-650 m is each nation's MARCH: the approach where its identity begins, still reading as Wonderland.

Sectors are a starting frame for placement. Moving a boundary is a data change in `nations.json`; the three
identities are not up for change.

## What this lane does next

Per the founder's priority: lock the canon, prepare the model, document the visual language, and make future
world-building passes nation-aware -- without interrupting higher-priority implementation work. Mass-building the
three civilisations comes later, progressively.

Material note for whoever builds first: Icarus can be built from the kit's existing pale family (MI_V2_IvoryStone,
the Ashlar marbles, GoldAged, the glass set). Noctis and Tartarus need new material instances -- obsidian, dark
glass, charcoal, silver; crimson, dark red, warm metal, black -- and new roof and glass colours. They do not exist
yet; `nations.json` lists them as `materials_needed` so nobody assumes a placeholder is canon.
