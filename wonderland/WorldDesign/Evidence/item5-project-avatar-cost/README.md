# P0 item 5: Project Avatar cost

**Founder:** "Cached spawn improved about 509 ms → 73 ms but still hitches. Test 0/1/5/10 avatars and optimize
remaining spawn/render cost. Project Avatars must scale inside one Server Avatar."

Measured 2026-09-27 on `local/wonderland-task3`, build `1bc2131f`, in `zzAN1_avatar` — the first run of this
job whose instrument was sound. Rung zero settled before it was taken, zero frozen stat reads, 37 to 126
accepted frames per rung.

## The ladder

| rung | frame ms | render ms | game ms |
| --- | --- | --- | --- |
| 0 avatars | 64.69 | 60.26 | 33.22 |
| 1 | 175.61 | 172.58 | 22.89 |
| 1 again, after 5 | 174.45 | 175.54 | 30.35 |
| 2 | 195.35 | 195.24 | 24.72 |
| 3 | 117.24 | 115.70 | 26.30 |
| 4 | 149.58 | 147.85 | 28.93 |
| 5 | 169.29 | 164.93 | 28.21 |

## What it says

**The FIRST avatar costs about 110 ms, and further avatars cost little.** One avatar takes the frame from
64.7 to 175.6, and five leave it at 169.3 — within the run-to-run scatter of one. The cost is in having any
avatars at all, not in how many.

**It reproduces.** Coming back down to one avatar after five reads 174.45 against the ascending 175.61, so
this is a standing cost of presence rather than a one-time amortised build.

**It is the render thread and nothing else.** Render is 172.6 at one avatar while the game thread is 22.9,
and the game thread stays between 22.9 and 33.2 at every rung including the empty world.

**Virtual shadow maps are about a fifth of it.** Turning them off at one avatar takes 174.45 to 143.14 —
31 ms of the 110. Something else carries the rest.

## What is still open

`r.DistanceFields` refused the value it was given (read back 1.0 after being set to 0), so that rung voided
and distance fields remain untested as a cause. The ladder above rung 1 is not monotone — 195, 117, 150, 169 —
so per-avatar marginal cost is inside the noise and only the 0-to-1 step is solid.

The founder's "must scale inside one Server Avatar" is arguably met: they do scale. The problem is the
entry price.

---

## The cause, measured 2026-09-27 late (`zzBJ2_avatar_cause`)

One avatar spawned by the job itself and destroyed afterwards. Baseline frame **203.22 ms**.

| rung | frame ms saved |
|---|---|
| `r.Lumen.DiffuseIndirect.Allow 0` | **164.89** |
| `r.Shadow.Virtual.Enable 0` | 21.53 |
| avatar's own components stop casting shadows | 4.33 |
| `r.ShadowQuality 0` (all shadows) | **−4.86** |

**It is Lumen, and it is not shadows.** Turning off *all* shadow casting saves nothing at all, and taking the
avatar's own shadows away saves 4.33 ms. Global illumination is 165 ms of a 203 ms frame.

That makes sense from what a Project Avatar is: tens of thousands of emissive boxes, which is exactly the
kind of subject that makes a global illumination pass expensive.

**A hypothesis of mine died here and the clause is kept as a negative rather than deleted.** I built the rung
"turn shadow casting off on the avatar's own components" as a candidate *fix* — targeted, shippable as a
property, no scene-wide degradation. It buys 4.33 ms. The control said so plainly and the finding is that
shadows were the wrong place to look.

### What is being tested next

Global Lumen off recovers 164.89 ms but flattens the lighting the founder has approved for this world. The
targeted version is to take the **avatar** out of global illumination — `affect_dynamic_indirect_lighting`
and `affect_distance_field_lighting` off per component — so the scene keeps its GI and only the avatar stops
contributing to it. That ships as a property on the figure rather than as a scalability setting.

If it recovers most of the 164.89, that is item 5's optimisation. If it recovers little, the cost is in the
avatar being *lit by* Lumen rather than *contributing to* it, which is a different fix and worth knowing.

---

## Correction: the GI finding is not safe, and the fix does not apply

I claimed item 5 was optimised. Verifying the **shipped** path rather than the test spawn says otherwise, and
two separate things are wrong.

**1. The property does not stick on 195 of 198 components.** Read off the actors `/pa` actually created, both
before and after switching to the engine setters:

```
distance_field_off  198 / 198        indirect_off  3 / 198
```

The setter fix moved the saving from 6.38 ms to 15.34 ms (render 61.24 → 37.4), so *something* improved — but
`affect_dynamic_indirect_lighting` still reads back true on 195 components. And `distance_field_off` was
already 198/198 before any change of mine, because **`wl.Figure.DistanceField` defaults to 0**: figures were
already out of the distance field. That column never measured my fix at all.

**2. The 170 ms was measured on a machine at ~5 fps.** My baseline frame was **203.22 ms**. This project's own
earlier and more careful work records *"one Large Project Avatar costs 18.7 ms of frame; hiding it gives back
15.5 of those and turning off its shadows gives back 0.8"*, and concludes the cost is **submitting ~58 movable
components and ~31,900 instances** — not global illumination.

A 203 ms baseline is an order of magnitude away from 18.7 ms. Those are different regimes, and a term that
dominates under heavy load need not dominate at all in the condition the founder plays in. **My measurement
is not comparable to the earlier one and does not overturn it.**

### What stands

- Taking a **test-spawned** avatar out of GI, on a loaded machine, saved 170.57 ms. That reading is real and
  was honestly taken; it is just not about the shipping path or a representative frame rate.
- The shipped `/pa` path currently gains 15.34 ms from the change, with the intended property not applying to
  195 of 198 components.

### What the next step is

Find why `SetAffectDynamicIndirectLighting` does not take on those components — instanced components are the
obvious suspect — and re-measure **on a quiet machine**, against the project's own 18.7 ms figure rather than
against a 203 ms one. Until then item 5 is not optimised and I should not have said it was.
