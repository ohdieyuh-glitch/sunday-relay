# Wonderland V2 — the world design system (from the reference package)

**Authority order:** the original Marble royal-garden panorama
(`marble-royal-garden-backdrop-panorama.png`, world `ae83acaa-df79-4e92-b31f-53af690d5deb`, measured in
`ANALYSIS.md` / `VISUAL_SPEC.md`) → the founder's three boards (`boards/BOARD_1..3`, filed 2026-08-28) →
the approved Unreal foundation (`renders/V2_FIRST_VISIBLE_APPROVED_FOUNDATION_cam0_720p.png`) → judgement.
The boards explain and extend the panorama's grammar; where a generated board and the panorama disagree,
the panorama wins. This document is the extracted GRAMMAR — not a list of motifs to sprinkle.

## 1. What the three boards agree on (the shared grammar)

| layer | the rule the references share |
|---|---|
| **light** | bright fantasy daylight: high warm-white sun, big soft cumulus, blue sky, SOFT shadows with sky fill, atmospheric haze that cools and lightens every depth layer; nothing blown out, nothing grey. Golden hour / evening / lantern night are secondary states, never the default. |
| **stone** | PALE ROYAL STONE: warm ivory / cream / pale grey masonry; large flagstones and slabs; carved edging, balustrades, coping, steps with nosings; visible but tight joints; gentle wear; radial and axial motifs in plazas. |
| **gold** | AGED, ORNAMENTAL gold: wrought gates, finials, clock cases, railings, urn rims — warm, matte-satin, patinated in recesses; never neon, never chrome; used where it rewards the eye (thresholds, landmarks, edges), not on every surface. |
| **architecture** | layered storybook facades: PRIMARY mass (drum / tower / block) → SECONDARY (roof hierarchy: onion dome, cone, turret, tiered caps in soft pink / rose / lavender / turquoise) → TERTIARY (arched windows with trim, balconies, columns, cornices, gold finials, vines). Silhouettes are vertical, clustered, and readable at 200 m. |
| **gardens** | FORMAL and layered, never scattered: ground cover → flower beds (pink roses, lavender, purples, whites) → shrubs and clipped hedges → topiary (spheres, spirals, tiers, hearts, arches) and cypress-like verticals → ornamental trees and giant mushrooms; all held by structure: kerbs, low walls, planters, urns, arches. |
| **landmarks** | golden gates (thresholds), giant mushrooms with clocks in their stems, clock towers / timepieces, heart topiary arches, floral arches, floating islands / keys / teapots high in the sky. Placed by hand, few, readable at distance. |
| **objects** | keys, pocket-watches, teapots and cups, lanterns, urns, books, banners — as sculpture, signage, furniture and storytelling, used selectively (a key over a gate, a clock in a mushroom, cups on a garden table). Never literal kitsch everywhere. |
| **composition** | a strong ARRIVAL AXIS: spawn → path → threshold (gate/arch) → gardens with landmarks either side → city/castle skyline → the world beyond; the eye is pulled deeper by the path, framing landmarks, and depth layers. |
| **scale** | four coexisting scales: Dog-scale (steps, doors, urns), landmark-scale (gates, clocks, 5–20 m mushrooms), district-scale (palace, garden axes, plazas), world-scale (skyline, floating structures, distance haze). |
| **mood** | whimsical, grand, elegant, lush, playful, mysterious, inviting, timeless — SOPHISTICATED, not theme-park. |
| **never** | grey box / blockout; gritty realism; cyber / neon; gothic / grim; low-detail mobile look; bland empty spaces; global pulsing; uniform repetition; cheap procedural look; plastic materials. |

## 2. Palette (named, from boards 2 and 3; measured values in VISUAL_SPEC.md)

Primary: **Pale Stone**, **Warm Ivory**, **Cream Stucco**, **Soft Pink stone**, **Muted Rose**, **Lavender**,
**Sage Green**, **Topiary Green**, **Gold / Brass / Aged Bronze**, **Sky Blue**, **Cloud White**.
Accents: **Mushroom Red** (red cap, white spots, cream stem, gold rim), **Deep Purple**, **Vines Green**,
turquoise/teal roofs (sparingly), terracotta roof tile.
Rule: ivory/cream/pale-stone carry ≥ 60 % of built surface; pink/rose/lavender are ROOFS and trims; gold is
edges and thresholds; green is structured mass; red is a landmark accent.

## 3. Material language

| material | response |
|---|---|
| pale stone / slab | roughness 0.65–0.8 with variation, 3–6 % tonal variation per stone, chamfered worn edges, tight dark joints, no gloss |
| cream stucco | smooth-matte, faint blotch, warm |
| soft pink stone / roof tile | matte, slight coursing, pink ↔ rose variation between tiles |
| aged gold | metallic 0.85–0.95, roughness 0.35–0.5, patina in recesses, warm (never yellow-green) |
| carved stone | as pale stone + relief; AO in the carving |
| topiary / hedge | dense leaf mass, leaf-scale normal detail, mid-dark green, subsurface hint; never fluorescent |
| flower beds | mixed pink / rose / lavender / white heads over green; clustered, not sprinkled |
| mushroom cap | red-terracotta with white spots, slight sheen; stem cream with fibrous roughness; gold rim optional |
| clock / brass | brass metallic with enamel faces; black numerals; glass sparingly |
| wood | warm, grained, worn (doors, benches, signs) |

## 4. Architecture grammar (the kit to build)

- **Tower family:** drum bodies (cream) with tiered caps (pink onion, rose cone, lavender turret, navy accent) + gold finial; window bays with arched trim; balconies; a base plinth.
- **Palace mass:** a central bulk with an arcade, domes, flanking towers; terraces and stairs down to gardens.
- **Thresholds:** gold gates between cream piers with urns; stone gateways / arches with keystones; floral arches over paths.
- **Edges:** balustrades, kerbs, copings, low retaining walls with beds behind, planters, urn finials at path mouths.
- **Circulation:** axial path → steps → plaza; side terraces; bridges/walkways later.
- **Clock integration:** in mushroom stems, over gates, as plaza monuments, on towers.

## 5. Vegetation grammar

Ground: lawn/sward + ground cover + tiny flowers. Beds: roses (pink/red), lavender spikes, hydrangea-like
mounds, white/purple mixes, in ORGANISED beds with kerbs. Structure: clipped hedges (block, mass),
topiary (ball, cone, spiral, tiered, heart, arch), cypress verticals. Canopy: ornamental trees with clean
trunks, giant mushrooms (3 scales: 2–4 m accents, 5–10 m landmarks, 20 m+ monuments). Vines on walls and
arches, ivy on mushroom caps. Variation rule: no two adjacent instances identical (rotation + scale +
variant); density peaks at bed centres and fades to kerbs; NEGATIVE SPACE is designed (plaza clean).

## 6. Skyline and depth

Foreground landmarks (mushroom L, clock tree R, heart, gate) → midground palace masses and towers →
thin distant spires → floating elements → clouds; every layer lighter and cooler (haze); occlusion between
layers; no flat row of equal towers; the axis lands on the palace.

## 7. The Golden Arrival — target hierarchy (board 3 "arrival experience flow")

1. APPROACH (spawn plaza, pale slabs, urns) → 2. GOLDEN GATE (threshold) → 3. GARDEN PATH (kerbed flags,
beds, hedges, topiary) → 4. CLOCK PLAZA (a clock landmark) → 5. HEART GARDEN (heart topiary, floral arch)
→ 6. PALACE VIEW (castle skyline). HeroCam0 sees 1 → 3 → 5 → 6 in one frame.

---

# Gap analysis — current HeroCam0 (`V2_VEGETATION_PASS_HEROCAM0_720p.png`, 2026-08-28) vs the references

Whole-frame: render luma 0.33 / chroma 0.07 / bright 42 % vs Marble 0.16 / 0.105 / 20 %.

### CRITICAL (destroys the intended impression)
- **C1 Plaza / path read as debug tiles.** A regular grid of identical ~1.3 m slabs with 8 uu seams on a strict diagonal cream/grey checker; the path is a field of 58 cm domed cobbles with wide joints ("dots"). Reference: large flagstones of mixed sizes in running bond, tight dark joints, worn chamfers, subtle tonal variation, kerbed edges, a proper flight of steps.
- **C2 Exposure.** Histogram auto-exposure meters the frame to mid-grey and the 60 k-lux sun blows the slabs to white; an on-screen engine warning (`r.EyeAdaptation.CachedLightingPreExposure`, "Exposure: 12.5") shows the cached-lighting pre-exposure disagrees with the scene. Reference: controlled exposure, ivory at ~80 % white, soft sky-filled shadows.
- **C3 Vegetation has no colour layers.** Every bed is a dark-green leaf-fur mass; no roses/lavender/purples/whites, no ground cover, no layering; canopies are dark clumps; hanging vines read as bead strings. Reference: layered beds with pink/rose/lavender heads over green, clipped hedges, topiary silhouettes.

### HIGH (major missing world-design component)
- **H1 No threshold in frame.** The gate is behind the camera by design; the frame has no ornamental gate/arch of gold — the floral arch is a green blob arch. Reference frames put a gold gate and a floral/heart arch inside the view.
- **H2 Landmarks are primitive.** The giant mushroom reads as a small cone-on-cylinder with no clock, no underside, no gold rim; no clock landmark; the heart is not readable.
- **H3 Architecture lacks tertiary detail and hierarchy.** Towers are drums with cone/onion caps and no windows/trim/balconies/arches; the skyline is a flat row of similar heights; no floating elements; no haze layering.
- **H4 Edges are boxes.** Kerbs, side steps and walls are plain blocks; pedestals are simple; no balustrades, copings or nosings.

### MEDIUM (noticeable quality gap)
- **M1 Flat materials.** One tint per surface family with little roughness/colour variation; gold flat.
- **M2 Sky.** A plain gradient — the panorama dome's clouds are not visible above the skyline; no cumulus depth.
- **M3 Props.** No lanterns, no urns with flowers, no benches, no signage.
- **M4 Vines / ivy** read as bead strings on the mushroom cap and at the frame top.

### LOW (polish)
- **L1** Pixel-streaming UI icons and the portal ring in the capture; **L2** plaza petals invisible; **L3** portal disc styling.

## First bounded pass — PATH / PLAZA (+ the exposure prerequisite)

Fixes C1 and C2 only, at HeroCam0, one render: mixed-size running-bond plaza slabs (1.3 m, 0.9 m, 2.0×1.0 m)
with 4 uu joints, three tints in a noise-driven distribution (cream / warm cream / pale grey), worn chamfers
and ±0.8 uu height jitter; the path relaid as large irregular flags (0.9–1.3 m, tight joints, warm dark
grey) with cream kerb stones; steps with nosings; exposure PINNED (histogram min = max = EV100 14.3, the
cached-lighting pre-exposure matched) so every later pass is comparable. Acceptance: the plaza and path
no longer read as tiles/dots; ivory sits at ~70–80 % white with readable shadows; the warning is gone
from a capture that does NOT disable screen messages. Then C3 (garden colour layers) → H1/H2 → H3/H4.
