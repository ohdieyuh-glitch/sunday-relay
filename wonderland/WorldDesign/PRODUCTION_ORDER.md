# Wonderland production order

Founder ruling, 2026-09-13. This is the order work is done in until the founder changes it.

**WORLD FIRST. PRIVATE-BETA READINESS FIRST. SECONDARY SYSTEMS AFTER THE WORLD FOUNDATION IS STRONG.**

## 1. Now: the private-beta world

Substantial Unreal + Blender world development on `WL_V2_GoldenArrival_WP2`, judged against the
Wonderland Bible (`VISUAL_AUTHORITY.md`). The loop:

capture → compare against the Bible → largest visual / private-beta gap → implement → PIE test →
walk test → performance check → capture again → continue.

Biggest remaining gaps first; small decorative passes do not count as progress on their own.

| Area | What private beta needs |
|---|---|
| Golden Arrival | a finished hero arrival: gate / garden / clock / heart / palace composition, authored royal paths, dense but controlled gardens, major landmarks, obvious direction, strong identity |
| City scale | a substantially denser skyline -- towers, domes, spires, layered palace/city architecture, distant depth, believable scale from ground level |
| Floating world | islands, skyline landmarks, clouds, distant structures, strong silhouettes |
| Blender kit | reusable architecture modules, ornament, hero props, bridges, balconies, gates, columns, roofs, towers, clocks, landmarks, garden structures |
| Materials | ivory / pale stone, warm gold, soft pink, lavender / periwinkle, controlled greens; no grey blockout feeling |
| Lighting | bright enchanted daylight, readable architecture, no directional-light conflicts, exposure / Lumen fixed where needed |
| Vegetation | lush, intentional, authored; frames architecture, never hides it; gardens read as designed |
| Traversal | no dead ends, no collision traps, important areas reachable, strong flow, teleport map works, anchors extend safely |
| World Partition | correct editor vs PIE behaviour, stable loading, no missing runtime pieces, no surprise density changes, acceptable performance |
| HUD | green Compound AI swoop, blue Single AI swoop behind it, development 100% preview, larger percentages at the next rebuild, terminal and map coexist |
| Julius terminal | Ctrl+T, no duplicate widgets, truthful backend state, stable input focus |

## 2. The private-beta world gate

Secondary systems are not recommended because one district looks attractive. The transition is
recommended only when all twelve are substantially true, with evidence:

1. Golden Arrival feels substantially finished rather than like a blockout.
2. The skyline communicates a large enchanted city.
3. Core traversal works reliably.
4. World Partition behaviour is understood and stable.
5. The major hero corridor is polished.
6. Materials and lighting are coherent.
7. Blender → Unreal asset production is repeatable.
8. Important visual references from the Wonderland Bible are represented.
9. HUD / terminal / map function reliably.
10. Performance is acceptable on the founder's current laptop.
11. No major grey / empty / unfinished district dominates the immediate player experience.
12. The private-beta route gives a player enough world to explore and understand the vision.

When they are, the report is: **"WONDERLAND WORLD FOUNDATION READY FOR NEXT PRODUCTION PHASE"**.
Status is tracked with evidence in `PRIVATE_BETA_GATE.md`; an item without a measurement is not met.

## 3. Later: approved future systems -- NOT BUILT YET

Preserved here as roadmap and canon only. None of the following is implemented, stubbed, or
placed in the world before the gate above is met: trading, player economy, ownership systems,
marketplace UI, exchange booths, trade networking, Jhin importing, a Jhin creation framework, a
teleport marketplace flow.

### The Wonder Exchange (working name)

A floating-island trade district players teleport to, to trade or exchange: Compound Agent
configurations, Single AI Agent / Jhin configurations, Wonderland-created software, games, rare
Project Avatar skins, rare mascot cosmetics, rare Jhin cosmetics, rare earned items, transferable
agent templates, and other ownership / progression items.

**What this means for the world now.** The floating islands in the skyline (SKY03) are world art
today and may become the Exchange later, so they are developed to keep that possible:
- stable, recorded locations (layer JSON, not scatter);
- good silhouettes;
- room for future traversal and possible teleport anchors;
- groups that can be expanded.

No placeholder trading booths or marketplace logic are put on them.

### Jhin provenance -- future canon

Julius is the **Compound AI Agent**. Jhins are **Single AI Agents**. A user may eventually operate
Julius plus one or more compatible Jhins at the same time; a Jhin never replaces Julius, and the
two concepts are never collapsed together.

Every Jhin manifests in the canonical Jhin mascot language: white / ivory physical form, dark face
/ visor, warm glowing eyes, a spectral lower body. The spectral lower body carries provenance:

| Provenance | Spectral lower body | User may recolour it? |
|---|---|---|
| **Imported** -- an existing compatible agent or agentic runtime brought into Wonderland (for example Claude Code, Hermes, other compatible harnesses, user-built agents) | the imported-agent **cyan-blue crystalline** colour, visibly distinct from Throat-chakra blue | **No** -- immutable; it says *this agent came from outside Wonderland* |
| **Wonderland-born** -- a Single AI Agent a player creates inside Wonderland | the creator's earned **chakra** colour: Root red, Sacral orange, Solar Plexus yellow, Heart green, Throat blue, Third Eye indigo, Crown violet / purple | it is the creator's earned colour |

Users may customise clothing, armour, accessories and approved silhouette / preset choices; never
the imported soul colour.

### Jhin creation -- future canon

The Jhin specification belongs to Wonderland and is provider / framework independent. Initial
adapters may include the Claude Agent SDK and LangGraph, with other runtimes later; they are
implementations underneath the Wonderland Jhin definition, never the definition itself.

### Also after the gate

Deeper social systems, player economy, advanced multiplayer, broader secondary gameplay loops.
