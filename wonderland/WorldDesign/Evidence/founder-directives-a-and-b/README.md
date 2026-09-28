# Founder visual corrections A and B — what was measured, 2026-09-27

Two founder corrections, both of which end with the same instruction: judge from the **rendered mascot**,
not from material values or test variables. This records what the rendered mascot actually measured, where,
and what is still open.

---

## Directive A — Relay OG eye spacing

> "The two eyes are TOO CLOSE TOGETHER and merge into one central glowing mass... there must be a clearly
> visible BLACK VISOR GAP between the eyes... Also check whether this spacing problem comes from the
> underlying eye geometry, material/emissive mask, bloom radius, or a combination. Fix the actual cause
> rather than merely reducing glow until the defect is hidden."

**The cause was a combination, and none of it was glow strength.** Three separate sites drew a halo across
the visor centreline, so even correctly spaced cores sat inside one merged bloom:

| site | what it was | what it is |
|---|---|---|
| gameplay Dog | one combined eye pane with a halo spanning the centreline | pane hidden and tagged `WL_EyeReplaced`, two cube panes of one eye's size |
| costume figure | `eyehalo` box centred on the eye gap, 2.88 wide | shifted outward, 2.04 wide, inner edge stops at the eye's inner edge |
| cub ghost | same overlap | same treatment (`cub_in` / `cub_out`) |

The spread is **solved from the geometry**, not chosen: the widest allowed value is
`(Size[Across] * 0.5 - EyeHalf) / (Size[Across] * 0.25)`, which evaluates to 1.28 here. An earlier hand-picked
1.55 pushed each eye 1.5 units off its own mesh.

**Measured on the built Dog:** `eye gap 6.38 of visor 22.80 = 28.0%` of the visor width is black between the
eyes. Glow strength was not reduced to achieve it.

**Regression caught in the same work:** `ShowCanonBody()` would have drawn THREE eyes after a costume round
trip, because it re-showed the combined pane the fix had hidden. Fixed by skipping `WL_EyeReplaced`
components; verified by `zc_eyes_after_costume` 6/6.

---

## Directive B — Skeleton Flame

> "The BLACK SKULL/FACE AREA must STAY BLACK... The EYES inside that black skull must visibly GLOW and remain
> individually readable rather than one blown-out light... the BLACK PARTS ON THE LEGS need to visibly
> GLOW... The FEET should NOT be blue... Do not broadly recolor the mascot."

### The finding that changed the whole approach

The mascot looked white in the Wardrobe. That points straight at the skin — and the skin was one edit away
from being changed. The same costume, same build, measured two ways:

| | blue-dominant | fully blown | zero-chroma |
|---|---|---|---|
| in-world (differenced against a figure-hidden control) | **0.837** | **0.000** | 0.117 |
| wardrobe preview, as shipped | 0.074 | 0.355 | 0.871 |

**The skin was already correct.** The wardrobe was not rendering it. So nothing in `relay_dog_skins.py` moved
to fix the appearance, which is what "do not broadly recolor the mascot" requires.

### What was actually wrong, and the two wrong answers on the way

The wardrobe's emissive term went from invisible to clipped with nothing in between. Two hypotheses were
tested and refuted before the real one:

1. **"The stage over-exposes bright skins."** Refuted by its own control — and the control was broken.
   `SetGlowScale` discarded any change within `0.001` while the shipped value **was** `0.001`, so "turn the
   fire off entirely" never turned anything off. Four sweeps photographed one picture. Fixed with a relative
   tolerance; an exact zero is now expressible.
2. **"Exposure is the lever."** Swept eight stops twice — once as shipped, once after enabling the capture's
   `EyeAdaptation` show flag, which a `USceneCaptureComponent2D` genuinely does ship with OFF and which does
   make `AutoExposureBias` inert. Enabling it changed nothing: luma 0.5119 / 0.5137 / 0.4849 / 0.4994 /
   0.4985 across a 256x change. Good hypothesis, wrong. The flag stays on because it is correct.

**The answer was channel arithmetic.** "Blown" means the *minimum* channel is pinned; for ghost's
`(0.22, 0.70, 1.00)` that means RED has clipped, and red clips at roughly 4.5x the level blue does. Saturated
blue therefore lives near a fifth of the shipped value — in the band the broken tolerance had made
unreachable.

| `wl.Look.PreviewGlow` | blue-dominant | blown | what it looks like |
|---|---|---|---|
| 0.0010 (old) | 0.098 | 0.076 | spectral sections white, eyes one blown disc |
| **0.0002 (shipped)** | **0.279** | **0.000** | spectral sections cyan, eyes two readable discs |
| 0.0003 | 0.323 | 0.086 | more blue, but the eyes blow out again |

0.0003 carries more colour and was **not** taken: the directive asks that the eyes "remain individually
readable rather than one blown-out light", so a rung that reintroduces clipping loses the thing the change is
for. 0.0002 is the brightest rung that blows nothing. Apollo's blown fraction falls 0.113 → 0.000 as a side
effect; Relay OG, which has no fire of its own and served as the floor control, is unmoved at luma 0.305.

### Judged from the rendered mascot, front / left / back

- **Black skull and face stay black** — the dark skull features are present and black in all three views.
- **Eyes glow and are individually readable** — two distinct discs with a clear dark gap, in all three views.
- **Blue/cyan spectral sections distinct** — unmistakably cyan after the glow correction; they were white.

### Still open

- **Whether the legs' black parts visibly glow.** `voidglow` was raised from 0.55 to 1.6 after measuring that
  0.55 emitted ~58 against ghost's ~700 — eight per cent of the spectral blue, against a leg band that is
  five-sixths lit bone. Measured by `zc_skeleton_parts`; not yet confirmed on the corrected wardrobe.
- **Whether the feet read as neutral rather than blue.** They were changed from `ghostpale`/`ghost` to
  `ash`/`void`, so they are no longer the spectral material. In the six-view sheet they read pale blue-grey
  rather than clearly neutral, which is an honest doubt rather than a measurement.

---

## The instrument lessons, because they caused the wrong answers above

Recorded in full in `Tools/editor_jobs/README.md`:

- **The panel is not the world.** Measure an approved asset somewhere else before editing it.
- **A guard whose tolerance is the whole working range of the knob it guards.** The cvar readback passed
  green at every rung while the figure wore one value throughout — an honest reading of the input with no
  connection to the output.
- **The sweep's control is the thing to verify hardest.** The zero end is exactly where a tolerance guard
  bites, and an off-arm that silently does nothing is indistinguishable from a subject that does not respond.
