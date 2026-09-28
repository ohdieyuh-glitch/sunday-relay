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
