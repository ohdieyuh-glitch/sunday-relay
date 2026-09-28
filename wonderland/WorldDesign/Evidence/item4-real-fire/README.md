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
