# The three seam walks, and the 78 cm wall nobody could see

## Results

| seam | route | result |
|---|---|---|
| 1. Icarus march → district | y 62600 → 64600 | **PASS** — all legs reached, z=101 throughout |
| 2. Golden Arrival → march | y 48600 → 51600 | **PASS** — z=75 on lawn, z=101 on paving, clean step up |
| 3. Golden Arrival → Noctis | bearing 210, u 49000 → 51800 | **PASS** — same clean profile |

Seam 3 was chosen by measurement, not preference: the coverage grid shows 735 instances per 100 m cell at the core
edge on the Noctis bearing dropping to 8 exactly where NC01's approach begins — the sharpest discontinuity of the
three nations.

## What seam 1 actually was

The earlier diagnosis — a 2.8 m hole where IC01 declares its causeway ends at 63600 but lays plates finishing at
63320 — was real and is fixed. The walk still stopped. The difference was the Dog now stood at **z=101, on
paving**, where before it had been at z=75 on bare slab. The ground was no longer the fault.

`floor_profile.py` (new) traces the floor straight down every 25 cm along a line **inside PIE**, where batch
collision is real — editor-world traces do not see it. It named the fault immediately:

```
y 63575 -> 63600   rise  +78 cm   SM_terrace_platform -> WL_Gatehouse_Twin
y 64200 -> 64225   rise  -78 cm   WL_Gatehouse_Twin   -> SM_terrace_platform
```

**The ceremonial gatehouse stood on a 78 cm plinth.** Unreal's default max step height is 45 cm, so it was a wall
with a doorway painted on it, on both faces. Every screenshot ever taken of that gate looked perfect.

## Two rejected fixes, and why

1. **Steps from `WL_Ground_Step_Single`.** That module is a paving tile with a kerb lip, not a stair tread.
   Scaling its height to 78 cm produced a 76 cm KERB — a thin wall across the passage — and the walk got *worse*,
   stopping 300 cm earlier. Rejected.
2. **A scaled `WL_Stair_Ceremonial`.** The right family, but it brought a 165 cm gold balustrade across the
   passage and its orientation was not what the size vector implied. Rejected rather than fought.

## The fix that was kept

**Seat the gatehouse 78 cm lower**, so its interior floor *is* the paving. One number in IC01, no new geometry,
nothing to orient. The only cost is 78 cm of plinth buried in paving — which is what happens to a real building
set into a paved street, and the approach view confirms it reads correctly.

Proof, same line re-measured afterwards: **z range 12.0 → 22.0 across the whole 18 m, zero rises over 20 cm.**

## A regression this exposed

Re-applying IC01 dropped the Dog back onto the slab at z=75. `validate_layer_spec.py` had already flagged why —
**IC01 declared ZERO colliding batches.** BR01's world sweep had turned its causeway solid months later, so the
fault was invisible until the pass was re-applied and reset it. A pass must declare its own collision; it cannot
rely on a later sweep remembering. IC01 now declares 302 of its 668 instances solid — causeway, kerbs, towers,
gatehouse masonry, balustrades — and planting and grass fringe stay walk-through.
