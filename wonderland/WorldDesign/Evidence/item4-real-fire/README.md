# P0 item 4: real fire

> **Founder:** "Arden Infernal and Skeleton Flame need believable animated Unreal fire, not plastic voxel
> flames. Use performant Niagara/material fire with flicker, emissive falloff, softness/distortion, proper
> attachment."
>
> And over a video, 2026-09-26: **"these are the flames I need back"** — tall plumes rising a head's height
> above the shoulders.

Measured 2026-09-27 late, in the **game viewport** at night with the clock stopped, on `arden_infernal`.

## I had been treating this as a decision. It is not one, and two inherited numbers were wrong.

**The premise I inherited:** the shipped flame is motionless and fully clipped — "temporal swing 0.00024,
blown 1.000". On that basis item 4 looked like a choice between a bright-but-clipped plume and a dim-but-
shaped candidate, and I had been calling it a founder decision.

**Measured over eighteen frames in the game viewport, with the knob asserted (0.0 / 1.0):**

| | flicker (relative stddev of lit area) | swing | clipped |
|---|---|---|---|
| material 0 (shipped voxel glow) | 0.1058 | 33,324 px | **0.0000** |
| material 1 (shaped `M_WL_Fire`) | 0.0771 | 18,882 px | **0.0000** |

**Both fires move and neither clips.** Frames 0 and 9 side by side are visibly different flame shapes. The
inherited numbers almost certainly came through the wardrobe's SceneCapture, which refreshes on its own
interval and blows out — so it could see neither time nor colour, and would report exactly "no flicker, fully
blown" for a flame doing neither.

## And the shaped material reaches the approved plume's height

The source's own comment left this open: `M_WL_Fire` "may yet be the right base **once it can reach that
brightness without losing its colour**". Swept at gameplay distance, measuring *reach* — which is what "tall
plumes" actually means, and which no previous instrument measured:

| rung | plume reach | over-white |
|---|---|---|
| approved voxel glow | 94.3% | 0.000 |
| shaped, gain 60 | 97.0% | 0.000 |
| shaped, gain 100 | 92.9% | 0.000 |
| shaped, gain 140 | 98.6% | 0.000 |
| shaped, gain 180 | 90.2% | 0.000 |

Every shaped rung reaches the approved height and none loses its colour. The spread is non-monotonic in gain,
so those differences are noise — the answer is "it already reaches it", not "it reaches it at gain N".

## The conclusion, from the picture rather than the numbers

**Neither option is fire.** Photographed side by side at gameplay distance, the approved voxel glow and the
shaped material at gain 60 and gain 140 are all **flat, hard-edged, saturated yellow-orange polygon shapes**.
The approved one completely hides the Dog inside it — which this project's own record already says: *"an
opaque yellow-white plume with 63% of the figure clipped to white and no mascot visible inside it at all"*.

So the founder's phrase **"plastic voxel flames" describes both options**, and item 4 was never a choice
between them. The flame is opaque hard-edged ribbon GEOMETRY, and no material assigned to hard-edged opaque
polygons will read as fire.

**What item 4 needs is the thing the founder named and I had been reading past: a Niagara system, or at
minimum a translucent soft-edged surface with alpha falloff and panning distortion** — not a material swap
and not a gain change. `Tools/editor_jobs/zc_make_fire_material.py` builds `M_WL_Fire` and is where a soft
translucent version would be authored.

## What is settled, so nobody re-measures it

- The fire **animates**. Flicker is not missing.
- Neither surface **clips** at gameplay distance at night.
- The shaped material **already reaches** the approved plume's height, at every gain from 60 to 180.
- Gain is therefore **not** the lever, and the two-material choice is **not** the question.

---

## Tried: softening the material. Necessary, and not sufficient.

`M_WL_Fire`'s `EdgeSoftness` is a **power exponent** applied to `1 - |2U - 1|` — a curve that is 1 down the
middle of the ribbon and 0 at both edges. An exponent **below** one pushes that curve *up*: uniformly bright
almost all the way across, then a drop to nothing in the last few per cent. That is a **hard edge**.

It was set to **0.85**, so the parameter was producing the opposite of its own name. `TipFalloff` at 1.45 was
mild for the same reason. Raised to 2.6 and 2.2, material rebuilt, re-captured at gameplay distance at night.

**The flame is still flat and hard-edged.** Reach is unchanged (89.9–94.0% against the approved 98.1%) and
nothing clips, but photographed side by side the softened shaped material is not visibly softer than before.

So the edge that reads as "plastic" is **not** the falloff across a ribbon face — it is the flame's own
silhouette against the background. Correcting the exponents was right (0.85 was backwards on its own terms)
and it is kept, but it does not reach the defect. It is also inert by default, since `wl.Look.FireMaterial`
ships at 0.

## What item 4 actually needs

The founder named it in their first sentence and it is not a tuning job: **Niagara, or camera-facing soft
translucent cards**. A flame built from opaque geometry has a polygon outline, and no amount of shading
*within* those polygons removes it. Every lever available from code — two materials, a gain from 60 to 180,
and now the shaping exponents — has been measured and none of them touches the silhouette.

That is asset authoring rather than a parameter, and it is the honest remaining scope for this item.

---

## Re-tested on a material that was actually softened — the conclusion holds

The first softening attempt did not reach the material. Read back off the asset **and** off the instance the
dressed figure wears:

```
first rebuild    EdgeSoftness 0.85 (unchanged)   TipFalloff 2.2 (took)
second rebuild   EdgeSoftness 2.60               TipFalloff 2.2
```

Both parameters are written by the same helper in the same way, and only one took on the first run. So the
"softened" flame originally photographed had its edge falloff exactly as it always was, and that comparison
was between two pictures of the same material. **The conclusion was withdrawn and re-tested.**

With `EdgeSoftness` verified at 2.6 in the asset *and* in the drawn instance, re-captured at gameplay
distance at night:

| rung | reach | over-white |
|---|---|---|
| approved voxel glow | 95.15% | 0.000 |
| shaped, gain 60 | 95.72% | 0.000 |
| shaped, gain 140 | 90.35% | 0.000 |

**The flames are still flat, hard-edged, saturated yellow polygons.** No visible softening, reach unchanged,
nothing clips.

So the conclusion stands and is now earned: **the edge that reads as "plastic" is the ribbon's own silhouette
against the background, not the falloff across its faces.** Shading within a polygon cannot remove that
polygon's outline. Every lever reachable from code — two materials, gain 60→180, and now verified softening
exponents — has been measured and none of them touches it.

`wl.Look.FireMaterial` still ships at 0, so the corrected exponents are inert by default. They are kept
because 0.85 was backwards on its own terms.

## And downward too, because the arithmetic said the upward sweep could not have worked

The ribbon's UVs run 0→1 **across its width** (`Pile.UVs` takes `(0, Up)` and `(1, Up)`), so the verified
`EdgeSoftness` of 2.6 really is fading each ribbon's left and right edges. The reason that is invisible at
gain 60 is that the emissive is far over white: a falloff applied to a value many times white leaves most of
the ribbon saturated, and the edge you *see* is the hard line where the curve finally crosses white — not the
gradient below it.

So a soft edge needs the flame **dimmer**, and every gain swept until now was 60 or above. Swept down:

| gain | reach | over-white |
|---|---|---|
| 10 | 98.54% | 0.000 |
| 20 | 90.25% | 0.000 |
| 35 | 96.35% | 0.000 |
| 60 | 96.82% | 0.000 |

**Still flat, still hard-edged, at every one.** Photographed side by side with the approved plume, gain 10
through 35 are the same saturated yellow polygons.

## Item 4's diagnosis, closed

The hard edge survives **every lever reachable from code**:

- both fire surfaces (voxel glow and `M_WL_Fire`)
- gain from **10 to 180**, swept in both directions
- `EdgeSoftness` 0.85 → 2.6 and `TipFalloff` 1.45 → 2.2, **verified in the asset and in the drawn instance**

It is not a tuning problem. A flame built from opaque ribbon geometry has a polygon outline, and shading
*within* those polygons cannot remove it. **Item 4 needs Niagara or camera-facing soft translucent cards** —
the thing the founder named in their first sentence — and that is asset and geometry work, not a parameter.

---

## Implemented: a translucent, noise-cut edge

**Everything above established what would not work.** The falloff across the ribbon is real and verified —
`EdgeSoftness` 2.6 in the asset *and* in the drawn instance, multiplying straight into `MP_EMISSIVE_COLOR` —
and it is invisible at gain 10→180 in both directions and at tongue counts 8, 4, 2 and **1**. At one tongue,
with nothing left to overlap it, the flame was still a flat hard-edged mass.

**An additive surface has no opacity channel.** It only ever *adds* light, so its silhouette is wherever its
contribution stops mattering against the background — and a smooth ramp only moves that line rather than
removing it. That is why every parameter sweep failed, and it is why the founder's word for the result is
"plastic".

**Fire has a ragged edge, and the way to get one is to cut the surface, not fade it.** `M_WL_Fire` is now:

- **`BLEND_TRANSLUCENT`** instead of additive, so it has an opacity channel at all
- a **`MaterialExpressionNoise`** (scale 6, 3 levels, turbulent) sampled on `(U, V + time·FlowSpeed)`, so the
  grain **scrolls up the tongue** with the existing flicker bands rather than sitting still
- opacity = `clamp((shape × noise) ^ EdgeBite)`, `EdgeBite` exposed at 0.55

Photographed against the approved plume: the silhouette is **no longer one solid blob**. It breaks into
separate tongues with torn tips and notched sides, and the Dog reads through the fire. That is the founder's
"softness/distortion" appearing for the first time from a parameter this project controls.

**Nothing approved changed.** `wl.Look.FireMaterial` still ships at 0, so this surface is reachable but not
live, and the voxel-glow plume the founder's footage approved is untouched.

### What is still short

The interior is still flat — the torn edge is there, the hot-core-to-tip colour gradient is not reading at
this gain. The next lever is the colour ramp rather than the silhouette, and that is now the only part of the
founder's sentence ("flicker, emissive falloff, softness/distortion") without a measured answer: flicker is
measured (relative stddev 0.106), falloff and distortion are now in the surface.

## And the colour ramp, so the interior is not poster paint

The colour was multiplied in flat — one hue over the whole tongue — so the interior read as paint however
torn the edge became. `M_WL_Fire` now ramps it: `lerp(deep, hot, fade)`, where `fade` is already
`(1 - V) ^ TipFalloff` (1 at the foot, 0 at the tip), so the flame is pale and hot where it leaves the body
and deepens as it rises.

**Both ends are derived from the figure's own `Color`, not from new parameters.** The embodiment, the
colourway, the heartbeat and the wardrobe's glow scale all dress flames through
`SetVectorParameterValue("Color")`; a second authored colour would have to be written by every one of them or
default to something wrong. Deriving means Skeleton Flame's blue ghostfire gets a pale-blue core and a
deep-blue tip for free, and Arden's ember gets gold and crimson, with nothing else to set. `HotCore` (0.55)
and `TipShade` (0.45) are exposed.

## Where item 4 stands

All three properties the founder named are now in the surface:

| | |
|---|---|
| **flicker** | measured — relative stddev **0.1058**, swing 33,324 px over 18 frames |
| **emissive falloff** | hot-core → deep-tip ramp, derived from the figure's own colour |
| **softness / distortion** | translucent with a scrolling turbulent noise cutting the silhouette |

And the silhouette is visibly no longer one solid blob.

**It is still not shipped, deliberately.** `wl.Look.FireMaterial` stays at 0. The founder approved the current
plume explicitly, on video — *"these are the flames I need back"* — and swapping an explicitly approved look
for an alternative they have not seen is their call, not mine. The alternative is one console variable away
and the captures are in `Tools/captures/zc/fire_reach/`.

**The honest limitation:** at the gain that gives the approved plume's prominence, much of the ramp still
clips. That is the same tension the previous author recorded — a bright plume and a shaped one pull against
each other — and it is the reason the founder's own comparison matters more than another sweep of mine.

---

# Shipped and verified, 2026-09-28

> **Founder, 2026-09-28:** "I approved the real fire."

`wl.Look.FireMaterial` now defaults to **1**. That is the whole of what was outstanding: the material had been
built, measured and left behind a console variable defaulting to 0, so a founder booting the game still saw the
plume it was meant to replace. **Implemented is not shipped**, and I had been reporting item 4 against the
former.

## `zc_fire_shipped` — 6/6, status `measured`

| clause | result |
|---|---|
| F00 the approved surface is still what is on disk | PASS — `BLEND_TRANSLUCENT`, EdgeSoftness **2.6**, TipFalloff **2.2** |
| F01 a fresh session already has it on, nobody typing anything | PASS — `wl.Look.FireMaterial` reads **1** before the job writes it |
| F02 every flame mascot draws it at the shipped default | PASS — Arden Infernal and Skeleton Flame, 2 live instances each |
| F03 with the knob forced off the fire material is **gone** *(control)* | PASS — count drops to **0** for both |
| F04 the drawn instance carries the approved shaping | PASS — EdgeSoftness 2.6 / TipFalloff 2.2 on `MID_M_WL_Fire_*` |
| F_RESTORE Relay OG back, shipped setting restored | PASS |

**F03 is why the run was worth doing.** "A material with Fire in its name was found on the figure" proves
nothing on its own — if such a surface were present in both states, F02 would be satisfied by a figure that
ignores the setting entirely. The count going to zero when the knob is forced off is what makes the positive
reading mean something.

**F04 guards the other silent failure.** A material instance can override its parent's scalars, so the approved
*name* can render un-approved *shaping*. The softness and falloff are read off the `MID` the component actually
wears, not off the asset.

## The tension left standing, not tuned away

The default has moved twice for different reasons, and the reasons are not interchangeable. It went to 0 on
2026-09-26 on the strength of founder footage — *"these are the flames I need back"* — showing tall bright
plumes; before that I had shipped this material on the strength of a side-by-side where it merely **clipped
less**, which was not what was being asked for.

What changed now is neither the material nor my reading of that video: **the founder has seen this surface and
approved it.** So it ships exactly as approved, unretuned.

The honest caveat: shaping a flame is precisely what takes prominence out of it. If it reads dim on the lawn,
the gain is `wl.Look.FlameDim` and that is one word from the founder — not a licence for me to pre-emptively
alter what they just signed off.
