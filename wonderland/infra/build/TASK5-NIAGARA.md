# Task 5 — Niagara, and what already does its job without it

The founder's brief asks for two Niagara systems and for "detailed step-by-step
node connection steps". This file is the node-by-node spec, and it opens with
the part that is easy to get wrong: **some of Task 5 already exists**, built a
different way, and duplicating it would double the effect rather than improve
it.

Everything else in the five-task brief was implementable from the generator's
Python. Niagara is not: emitters are asset graphs the editor authors, and the
Python API cannot build them. So this is instructions rather than code, which is
the one place in the brief where that is a limitation and not a choice.

---

## What already exists, and how

| Brief asks for | Wonderland already has | Built as |
|---|---|---|
| "floating golden keys" | `float_glow` props on the Bob WPO, 90 instances | instanced geometry, vertical sine offset in `M_WLMaster` |
| "glowing dust motes" | `mote` — magic_gold / magic_cyan / arcane spheres above the plaza | instanced geometry |
| "soft teacup/sparks drifting through the air" | `petal_air` drifting petals, 362 instances | instanced geometry, Bob WPO |
| "floating cross/star particles rising upwards around the player" | the cross-sparks over the arcane ring, 26 of them | instanced geometry, Bob WPO |

All of it rides `PerInstanceRandom * PhaseSpread`, so no two agree — the fix for
the lockstep that the founder called a heartbeat.

**The honest reading:** the *effect* is present and the *technique* is not. What
Niagara buys over instanced geometry here is real and worth having — GPU
simulation instead of a vertex offset, spawn/kill over lifetime instead of a
fixed population, curl noise instead of one sine, collision, and light emission
per particle. What it does not buy is the thing being visible at all.

So do **2 (Magic Aura FX) first**: the vertical beam and rising ring have no
equivalent in the world at all, and that is a gap rather than a duplication.
When 1 (Ambient World Particles) is built, **delete the geometry it replaces** —
the four rows above name exactly what to remove.

---

## System 1 — `NS_WonderlandAmbient`

Emitter A — **golden keys**

1. New Niagara System → template **Empty**, add an Emitter, rename `Keys`.
2. Emitter Properties → Sim Target **CPUSim** (the keys need to be sparse and
   large; GPU sim buys nothing at 90 particles and loses the sorting).
3. Emitter Update → **Spawn Rate** 0.6.
4. Particle Spawn:
   - **Initialize Particle** → Lifetime 26–40, Sprite/Mesh Size 1.0,
     Colour `(1.0, 0.80, 0.38)` to match `MATERIAL_SPEC["gold"]`.
   - **Shape Location** → Shape **Box**, Extents `(6000, 6000, 900)`,
     Offset Z 700 — the band above the garden and below the skyline.
   - **Add Velocity in Cone** → Cone Angle 12, Velocity 8–18, Cone Axis `(0,0,1)`.
5. Particle Update:
   - **Curl Noise Force** → Noise Strength 40, Noise Frequency 0.06. This is the
     drift a sine cannot do.
   - **Drag** 0.9.
   - **Scale Colour** → curve fading alpha in over the first 8% of life and out
     over the last 15%, so keys arrive and leave rather than popping.
6. Render → **Mesh Renderer**, mesh = the key static mesh, Facing Mode
   *Velocity*. Material: the existing `MI_gold` (metallic 0.90, emissive 0 —
   the founder's rule is that gold glows from lighting, not from being emissive).

Emitter B — **dust motes**

1. Add Emitter, rename `Motes`. Sim Target **GPUCompute**, Fixed Bounds
   `(-8000,-8000,0)` to `(8000,8000,3000)` — GPU sim needs them stated.
2. Emitter Update → Spawn Rate 220.
3. Particle Spawn → Lifetime 6–14; **Shape Location** Box, Extents
   `(7000, 7000, 1400)`, Offset Z 500; Colour from a *Random Range*: gold
   `(1.0,0.80,0.38)`, cyan `(0.20,0.85,1.0)`, arcane `(0.66,0.36,1.0)` — the
   three `MATERIAL_SPEC` magic colours, so the motes belong to the world's
   palette and not to Niagara's default white.
4. Particle Update → **Curl Noise Force** strength 18, frequency 0.12; **Drag**
   1.6; **Scale Sprite Size** by a curve peaking at 40% of life.
5. Render → **Sprite Renderer**, Alignment *Camera Position*, Material: an
   **Additive, Unlit** sprite material with a soft radial falloff. Additive, for
   the same reason `M_WLRunes` is: black is free and nothing needs sorting.

---

## System 2 — `NS_ArcaneAura`

This is the one with no existing equivalent. It sits on the arcane circle at
`HERO_DOG`, whose radius is `LOOK["runeRadius"]`.

Emitter A — **the rising ring**

1. New System, Emitter `Ring`, Sim Target **GPUCompute**.
2. Emitter Update → Spawn Rate 90.
3. Particle Spawn:
   - **Initialize Particle** → Lifetime 2.4–3.6, Colour `(0.66, 0.36, 1.0)` at
     intensity 2.0. *Not* higher: emissive past about 1.0 climbs the ACES
     shoulder and the three channels converge, which is exactly how the arcane
     circle rendered white at strength 11 and again at 5.
   - **Shape Location** → Shape **Ring**, Radius = the rune radius, Ring
     Thickness 20, Distribute Evenly *false*.
   - **Add Velocity** → `(0, 0, 60–140)`.
4. Particle Update:
   - **Vortex Force** → Vortex Axis `(0,0,1)`, Force 55. The particles should
     spiral as they rise, not go straight up — the circle's two texture layers
     already counter-rotate and the aura should agree with one of them.
   - **Scale Colour** → alpha out over the last 40% of life.
   - **Scale Sprite Size** → shrink to 0.3 by end of life.
5. Render → **Sprite Renderer**, additive, the cross/star sprite.

Emitter B — **the vertical beam**

1. Emitter `Beam`, Sim Target **CPUSim**, Spawn **Burst Instantaneous** 1 at
   time 0, Lifetime 99999 (a persistent single particle).
2. Particle Spawn → **Initialize Particle** Size `(runeRadius * 0.5, 900)`.
3. Render → **Ribbon Renderer** or a Mesh Renderer on a cylinder, with an
   additive material whose opacity falls off toward the top and whose emissive
   is driven by the **same** `PulseSpeed`/`PulseDepth` values as `M_WLRunes`
   (1.15 and 0.28). Two magic effects pulsing at different rates in the same
   two metres reads as two effects; matched, it reads as one thing breathing.

---

## Placement

Both systems want spawning from the generator, alongside everything else:

```python
ns = unreal.load_asset("/Game/Wonderland/FX/NS_ArcaneAura")
a = spawn(unreal.NiagaraActor, (HERO_DOG[0], HERO_DOG[1], 8.0), label="ArcaneAura")
a.get_component_by_class(unreal.NiagaraComponent).set_asset(ns)
```

`unreal.NiagaraActor` and `set_asset` are both reachable from Python — it is
only the emitter *graph* that is not. So once the two systems exist as assets,
placing them is ordinary generator work and belongs in `build()` with the rest.

---

## Two traps, both already paid for in this world

**Emissive strength.** Anything above roughly 1.0 in linear light climbs the
tonemapper's shoulder and desaturates toward white. The arcane circle was
authored violet at strength 11 and rendered as a white ring; at 5 it was still
pale. Particles are emissive by definition, so start at 2.0 and measure.

**Motion in lockstep.** Every animated thing in Wonderland carries
`PerInstanceRandom * PhaseSpread` because 22,794 instances moving on one shared
sine is what the founder described as the world pulsing like a heartbeat.
Niagara gives each particle its own age for free — do not add a shared
`Time`-driven term on top of it.
