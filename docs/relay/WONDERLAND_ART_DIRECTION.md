# Wonderland — art direction

**The founder supplied a reference image on 2026-08-11 and said Wonderland should
look "exactly like this — glossy HD 4K polished", and that they want the Relay
Dogs to "move around like it's breathing in and out".**

This document exists because "whimsical surreal fantasy, premium, glossy" is the
same direction stated so vaguely that two people could build different worlds
from it. What follows is the reference decomposed into things that can actually
be built and checked. Where a claim here is enforced by a test, the test is
named; where it is a judgement call for whoever models the asset, it says so.

---

## 1. The Relay Dogs — the reference CONFIRMS the identity, it does not change it

Everything visible in the reference matches `OFFICIAL_RELAY_DOG_IDENTITY.md`
already. That is worth stating plainly, because the temptation on seeing a new
reference is to treat it as a redesign:

- small stylized **voxel** figures, blocky bodies
- **short legs, short limbs**
- upright squared ears, recognizable tail
- a single horizontal **black visor bar** for eyes

One white/cream Dog is the hero of the shot, standing on the ground at centre.
Around it are roughly eight **skinned** Dogs, and every one preserves the
silhouette: the skin transforms the surface and the accessories, never the
proportions. Observed in the reference:

| Skin | What changes | What does not |
|---|---|---|
| pink poodle | curly voxel fleece over head, chest, tail tuft | body block, leg length, visor |
| grey-and-black with top hat | palette, hat, collar | everything else |
| bronze lion | mane ring around the head | head block underneath |
| purple kirin / dragon | horns, spined back, tail fin | stance, leg count |
| red-orange tiger | stripe pattern, small hat | proportions |
| tan with monocle | palette, monocle | visor bar still present |
| small white-and-blue | palette, bandana | proportions |

This is exactly the founder's standing rule — *skins transform the Relay Dog;
they do not replace it with an unrelated humanoid* — shown rather than described.
`FWonderlandDogProportions` is the machine-readable form of it, and
`wonderland-cpp-parity.test.ts` asserts the grid, the row bands and `LegCount = 4`
against the shared sprite module.

## 2. The hero motif: the arcane circle

A glowing **violet/magenta summoning circle** on the ground beneath the hero Dog:
concentric runic rings, with small cross/plus glyphs rising and fading around it.
This is the single most identifying element of the reference and should be
treated as the Dog's spawn/idle ground effect in the hub, not as decoration
placed once.

**It must not encode Relay state.** The circle is the same reasoning as the
breath below: a ground effect that brightened when a mission was running would be
a status channel a viewer cannot read correctly. Relay state reaches the world
through the projection and the in-world terminal, which say what they mean in
words.

## 3. The world — Alice-INSPIRED, original, never copied

Atmosphere and world logic, never protected characters or designs. Present in the
reference, and the buildable list for the hub zone:

- an ornate **gold gate** with heart finials, ivy-wrapped
- a **heart-shaped topiary** hedge
- giant red-and-white spotted mushrooms, and purple ones, at several scales
- **floating gold keys**, slowly drifting
- a **floating white teapot**
- giant **stacked teacups** with heart patterning, used as landmarks
- **ornate clocks**: one freestanding tower, one set into a tree trunk
- a pale/dark **checkered flagstone** path — the strongest ground read in the shot
- a **rose arch** over the path
- pink/white/blue whimsical **castle spires** in the far background, on floating
  and mushroom-capped islands
- a heart-emblazoned **playing-card sign**
- lush purple and pink flowers, wisteria, foreground petals
- a huge gnarled **framing tree** at the right carrying an oval portrait frame

## 4. Light and finish

Bright cinematic daylight. Lavender sky with soft cloud. High saturation. Glossy
materials throughout. Strong foreground → midground → background depth, with the
foreground flowers reading as close focus. Crisp high-resolution presentation —
the founder's words are "HD 4K polished".

**Unproven:** none of this has been rendered. No Unreal Engine binary exists in
this environment, so every statement in this section is a target, not an
observation. See `WONDERLAND.md` § "What is unproven".

---

## 5. The breath — BUILT, and deliberately meaningless

The founder asked for the Dogs to move as though breathing in and out. That is
implemented, and the interesting part is what it is *not*.

Three layers, and only the first two say anything:

| Layer | Driven by | Carries information |
|---|---|---|
| the CLIP | the motion Relay observed | **yes** |
| the OVERLAY | an executing Loop, additively | **yes** |
| the BREATH | elapsed seconds, nothing else | **no** |

A breath that quickened while a mission was busy would be a second status
channel, and an untruthful one: a viewer could not tell whether a fast breath
meant "Relay is working" or "the animation is simply fast". So:

- `wonderlandBreathAt` / `WonderlandBreathAt` take **elapsed seconds and nothing
  else**. There is no state parameter and there must never be one. That absence
  is the guarantee; a comment promising it would not be.
- Period **4s**, peak swell **1.5%**, mirrored between TypeScript and C++ and
  compared by value, so the 3D Dog and the 2D sprite cannot breathe at different
  rates.
- The curve is `(1 - cos)/2`, not a raw sine, so the exhale returns the Dog to
  its own size and never below it. A sine would make it smaller than itself for
  half of every cycle, which reads as deflating.
- It swells **uniformly**. Independent height scaling is prohibited by the
  identity contract because it distorts the body into a humanoid.
- It runs before a snapshot arrives. An unobserved Agent is still alive; only its
  activity is unknown, and a Dog that stood perfectly still until Relay spoke
  would read as broken rather than as waiting.

**A vertical rise was drafted and removed.** Nothing could apply it — the pawn
does not know its own grid-unit-to-world size, and inventing a constant to
convert it would have put a fabricated number in an identity contract. The choice
was a dead field carrying a comment describing behaviour nothing performed, or
one honest swell.

**The pawn's tick had to be enabled**, and its constructor had said
`bCanEverTick = false` for a good reason: *"a tick here would be the first place a
timer started pretending to be an activity."* That concern is answered by
construction rather than by abstinence — the Tick advances one float and touches
nothing Relay wrote, asserted by a test that strips comments before reading the
body.

Tests: `src/relay/mission/wonderland/wonderland-breath.test.ts`, 15 assertions,
8 mutation proofs (raw sine, a state parameter added, a bad clock accumulated, the
amplitude turned into a pulse, the C++ period drifting, the pawn not applying the
swell, the Tick reading a snapshot, the tick disabled again).
