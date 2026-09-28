# P0 item 3: one canonical Relay Dog behaviour stack

**Founder:** "Observe Relay OG in PIE and make every active skin copy its exact idle stance, walk, run, stop,
turns, jump, fall, landing, body bounce, and ground contact ... Same for Mission Contract: start, planning,
implementing, verifying, completion, props, return to idle. One canonical Relay Dog behavior stack; skins are
cosmetic."

Measured 2026-09-27 on branch `local/wonderland-task3`, build `1bc2131f`.

## What was measured

The Dog publishes `FWonderlandWornPose` every frame through `GetCanonicalWornPose`. Each costume exposes
`GetWornPose` and `IsGaitDrivenExternally`. So "is one canonical stack driving every skin" is a field-by-field
comparison of two structs read in the same tick, across 23 fields: stride phase, gait weight, speed, bob, sway,
lift, body and head angles, tail angles, airborne weight, stillness, and hip, knee, shoulder and elbow angles
for both sides.

| | result |
| --- | --- |
| `zzAK1_pose` — gait | 5/5. Every costume wears the canonical pose field for field, standing and walking. |
| `zzAL2_pose_mission` — mission lifecycle | 6/6. The same, through NONE, PREPARATION, RESEARCH, IMPLEMENTATION, REVIEW, REPAIR and VERIFICATION. |

Zero fields differ on any skin, at a tolerance of 0.001.

## Why the controls matter more than the verdicts

**The first gait run also passed every comparison, and meant nothing.** The Dog was standing still. A gait pose
at rest is a constant, and two frozen structs agree perfectly. `W02` caught it: stride phase moved 0.0000
across six samples. The passing run has stride phase moving 0.55 to 0.85 with the Dog under movement input
applied every frame, and top speeds of 14 to 26 uu/s.

The mission job carries two controls for the same reason. `M02` requires the Dog's ACT to change across the
fixture, and `M03` requires the pose to move with it, because acts can change while the pose stays put.

## What this does not say

Whether the canonical pose LOOKS right is the founder's judgement. Jump, fall and landing are not covered —
the fixture does not produce them. And seven earlier versions tried to answer this from rendered silhouettes
before it became clear that no silhouette measure separates "stands differently" from "is dressed
differently": every costume changes what touches the ground.

---

## Where "they still stand weird" actually lives, measured 2026-09-27 late

> **Founder:** "They still stand/walk weird: fix the skeleton/AnimBP/retarget/**root-pose** cause, not
> cosmetic offsets."

Two candidate causes are now eliminated by measurement, and a third is found.

### Not the pose

`zc_pose_authority` and `zc_pose_mission`: every costume wears the canon body's published pose **field for
field** — 23 fields, standing, walking, and through a full Mission Contract lifecycle, with the Dog's stride
phase demonstrably advancing.

**But that measures the input.** The pose struct is what the costume is *told*; where its geometry ends up is
a different question, and the founder is reporting the second one. Quoting a field-equality pass at a
geometry complaint is what I did for most of a day.

### Not the root

`zc_stance_ground`, four costumes on a Dog that never moved: the attachment offset is `[0, 0, -87.07]` for
**every skin, identically** — spread in z of **0.0**. A uniform offset is the rig (the Dog's origin sits at
capsule centre, the costume hangs from the feet). The founder's "root-pose cause" would look like *one* skin
offset differently, and none is.

*(Relay OG produced no costume at all: it is the Dog's own canon body via `ShowCanonBody`, not an attached
embodiment. That is what "every skin copies Relay OG" means — the other four are costumes over the same body.)*

### It is the figures' own authoring, and it is Apollo

Read out of the `.wlvox` files with the part hierarchy resolved — no engine, no camera, no machine load:

| skin | lowest leg geometry |
|---|---|
| relay_og | **136.1 uu** |
| arden_infernal | 136.1 uu |
| skeleton_flame | 136.1 uu |
| celestial_light | 136.1 uu (`leg_*_shin` 135.1) |
| **apollo** | **130.0 uu** |

**Apollo's legs extend 6.18 uu below every other skin's**, and since the costume attaches at an identical
offset for all of them, Apollo stands that much sunk into the ground.

The specific geometry: a `golddeep` box on the `leg_l` / `leg_r` parts at part-z 3.025, size 0.750, so its
bottom is **2.650** against the canon foot's **3.720** — a 1.07 part-unit overhang, which at this figure's
voxel scale of 5.7763 is the 6.18 uu. `base_dog(figure)` is called identically by every skin, so the canon
foot is shared and this is an Apollo-only addition sitting below the shared foot plane.

**Why this is not the "cosmetic offset" the founder warned against.** Raising that sole to the canon foot
plane is not hiding a rig fault with a fudge — the rig is proven uniform above. It is correcting art that was
authored below the plane every other skin shares.
