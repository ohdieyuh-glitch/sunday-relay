# PROJECT AVATAR — asset contract

**Lane:** world / asset. **Owner of everything below:** this lane.
**Not in this document, and not built by it:** growth logic, hover, gait, spawning, multiplayer replication,
Brain integration, or any decision about *when* an avatar becomes a bigger one. Those are Internal Development's.
This is the body, the joints, the materials and the measurements.

Built by `wonderland/Tools/editor_jobs/build_avatars.py` → `wonderland/v2/avatars_v2.py` (forge branch), from three
canon modules of pure numbers: `ten_tails_canon.py`, `cherubim_canon.py`, `seraph_canon.py`, over the shared part
system in `avatar_common.py`.

---

## 1. Three families, three silhouettes — and why that was the first constraint

Three families are only worth having if a player can tell them apart at distance with no colour and no detail.
So each one answers "what shape is it" differently, and the table in §3 is the proof rather than the intention:

| | Ten Tails | Cherubim | Seraph |
|---|---|---|---|
| posture | quadruped, on the ground | radial, hovering, never touches the floor | vertical column |
| read from | the side | any angle | any angle |
| built of | hide, plate, bone | rings, spokes, vanes | robe, pinion, fire |
| W/H at LARGE | 0.99 | 1.14 | **0.78** |
| D/H at LARGE | **1.78** | 0.99 | 0.84 |

Ten Tails is the long one, the Cherubim is the round one, the Seraph is the tall one. Measured, not asserted.

## 2. What actually grows between stages

The founder's rule was explicit: do not make one model and scale it three times. Nothing below is a multiplier.

**Ten Tails** — tails **3 → 6 → 10**; tail-tip eyes **none → all → all**; total eyes **1 → 9 → 17**; horns
**0 → 2 → 6** (a pair, then a crown); teeth **0 → 8 → 14**; spine crest **0 → 5 → 9**; body chunks **3 → 4 → 5**,
so a LARGE trunk is a longer *articulated* body rather than a stretched one; claws **0 → 3 → 4**; crag plating
**0 → 0.35 → 0.80**; and the leg-to-body ratio crosses over, so SMALL squats and LARGE stands.

**Cherubim** — rings **1 → 2 → 3**, and on *perpendicular axes*, so the silhouette changes class at each stage
(disc → gyroscope → wheel within a wheel); vanes **2 → 4 → 6** at **1 → 2 → 4** blades each; eyes **1 → 4 → 12**,
distributed onto all three rings at LARGE rather than crowded on one; spokes **0 → 4 → 8**; core shell plates
**0 → 4 → 8**; halo **absent → thin → crowned**; and at LARGE, **six shards orbiting free of the frame** — the
stage's real tell, where the construct stops being one object and becomes a system holding itself together.

**Seraph** — wing pairs arrive in the order the source gives them, not as a rising count:
**flight → flight+face → flight+face+feet**. Blades per wing **1 → 3 → 5**; veil plates **0 → 5 → 9**;
eyes **1 → 3 → 7**; radiant spines **0 → 4 → 10**; train strands **3 → 6 → 10**; sleeves and girdle appear at
MEDIUM. SMALL can move but cannot yet hide itself.

## 3. Measured specification — every number read back off the built asset

| family | stage | height | W x D | meshes = draw calls | triangles | mat. slots | joints | sockets | eyes | capsule r / half-h / centre |
|---|---|---|---|---|---|---|---|---|---|---|
| Ten Tails | SMALL | **1.15 m** | 0.68 x 1.99 m | 28 | **2,080** | 5 | 22 | 10 | 1 | 31 / 49 / 47 cm |
| Ten Tails | MEDIUM | **2.70 m** | 2.17 x 5.05 m | 60 | **11,336** | 10 | 25 | 13 | 9 | 49 / 90 / 102 cm |
| Ten Tails | LARGE | **5.60 m** | 5.56 x 9.96 m | 76 | **20,080** | 10 | 29 | 17 | 17 | 87 / 175 / 197 cm |
| Cherubim | SMALL | **1.15 m** | 1.36 x 1.15 m | 11 | **2,728** | 7 | 7 | 4 | 1 | 28 / 51 / 58 cm |
| Cherubim | MEDIUM | **2.70 m** | 2.59 x 2.25 m | 22 | **7,840** | 8 | 13 | 8 | 4 | 57 / 103 / 117 cm |
| Cherubim | LARGE | **5.60 m** | 6.39 x 5.57 m | 40 | **16,912** | 9 | 24 | 17 | 12 | 116 / 211 / 236 cm |
| Seraph | SMALL | **1.15 m** | 0.82 x 0.51 m | 16 | **2,370** | 9 | 14 | 9 | 1 | 19 / 50 / 58 cm |
| Seraph | MEDIUM | **2.70 m** | 2.10 x 2.18 m | 36 | **4,800** | 10 | 24 | 14 | 3 | 44 / 122 / 139 cm |
| Seraph | LARGE | **5.60 m** | 4.38 x 4.69 m | 47 | **8,804** | 10 | 32 | 20 | 7 | 84 / 252 / 283 cm |

Heights are **exact**: each body is authored in its own units, measured, and fitted once by
`avatar_common.fit_scale` to `project_avatar_figures.py`'s existing `TARGET_METRES`
(`small 1.15 / medium 2.70 / large 5.60`). A LARGE avatar dropped at spawn **is** 5.60 m and needs no shrinking
to fit a showcase — which was the founder's one hard requirement on scale.

## 4. LOD and performance — the honest version

**Triangles are not the problem here; draw calls are.** These bodies are cheap in triangles (2.1k–20.1k, where a
single kit building in this world is heavier) but each is assembled from one static mesh *per joint per surface*,
and every one of those is a component and a draw call. That is the price of a body a rig can drive at all, and
the table above states it plainly rather than burying it.

What the numbers mean in practice:

* **LARGE is a showcase form.** Ten Tails LARGE is 76 draw calls. One near spawn is fine. Twelve of them at once
  is not, and no LOD setting fixes a draw call.
* **SMALL is the crowd form** — 11 to 28 draw calls, 2.1k–2.7k triangles. If many avatars are ever on screen
  together they should be SMALL, and that is a *spawning* decision, so it belongs to Internal Development.
* **LODs are on** (`lods=True`) and **Nanite is off** (`nanite=False`). Nanite is for the static world; these are
  small props whose components move every frame, and the Cub family already settled that call for this project.
* **Shadow casting is off for every emissive surface** (`eye`, `core`, `ember`). Seventeen glowing eyes each
  casting a shadow buys nothing and costs a shadow pass per eye.
* **Transparency cost is zero.** Nothing in any of the three families is translucent — the glow is *emissive on an
  opaque surface*, which is why these can stand in daylight without the sorting cost the Cub Ghost pays. Emissive
  values are in SCENE units (56,000–61,000) against this world's EV100 13.5 daylight; the "2.2" an artist expects
  renders black here, which this project measured the hard way.
* **Eye cost was deliberately reduced.** A full eye is three spheres (rim, iris, pupil) on three different
  surfaces, so it costs three meshes on its joint. Secondary eyes — Ten Tails tail tips and brow, Cherubim outer
  rings, Seraph veil and chest — drop the rim, whose silhouette is under a pixel at any distance a player sees it
  from. That alone removed 10 draw calls from Ten Tails LARGE (86 → 76).

## 5. Collision

**Every mesh is saved `collision=False`, and every component is set `NO_COLLISION`.** A creature built from 11 to
76 convex pieces would otherwise carry 11 to 76 collision primitives while moving, for no gain: what blocks a
player is one capsule, not the creature's eyelashes.

Each family therefore declares its own capsule around its **core mass**, and the table gives it per stage. These
are deliberately *not* derived from the mesh bounds — a LARGE Ten Tails is 8.84 m deep because ten tails fan
behind it, and a bounds-derived capsule would stop a player nearly five metres short of a body one metre wide.
The head reaches forward above capsule height (normal for a quadruped), the Cherubim's vanes are thin and open
with gaps worth walking through, and a Seraph is passed under rather than walked around.

`collision_capsule(stage)` on each canon returns `(radius, half_height, centre_y)`; the build report gives the
same three numbers already in centimetres, ready to set on the spawned actor.

## 6. What Internal Development receives, per family and stage

```
/Game/WonderlandV2/Characters/Avatars/<Family>/MI_Avatar_<Family>_<Surface>     (shared by all 3 stages)
/Game/WonderlandV2/Characters/Avatars/<Family>/<Stage>/SM_Avatar_<Family>_<Stage>_<joint>_<surface>
/Game/WonderlandV2/Characters/Avatars/<Family>/<Stage>/BP_Avatar_<Family>_<Stage>
```

`BP_Avatar_*` is an **AActor**, not an ACharacter — deliberately, so it brings no movement component and no
collision capsule to an asset that is collision-free by contract. Its hierarchy is:

```
Body (SceneComponent, root)
└── Pivot_<joint>              nested exactly as the canon's parents() declares
    ├── Mesh_<joint>_<surface> StaticMeshComponent, material already assigned
    └── VFX_<name>             SceneComponent, an effect anchor
```

Rotate `Pivot_<joint>` and the geometry turns about the right point: every mesh is merged in **its own joint's
frame**, with the pivot subtracted before the geometry is built. That is the whole reason the meshes are split
this way.

**Sockets** are named, not guessed: `VFX_Maw`, `VFX_Brow`, `VFX_Chest`, `VFX_Paw_*`, `VFX_TailTip_*` (Ten Tails);
`VFX_Core`, `VFX_Ring_*`, `VFX_Halo`, `VFX_WingTip_*`, `VFX_Shard_*` (Cherubim); `VFX_Crown`, `VFX_Veil`,
`VFX_Heart`, `VFX_Hem`, `VFX_WingTip_*`, `VFX_TrainTip_*` (Seraph).

## 7. Two traps this lane already paid for

1. **The frame.** Canon positions and sizes are in the web frame (X right, Y up, Z forward); `rot` is **already an
   Unreal Rotator**. Both aiming helpers (`aim_x`, `aim_z`) were verified numerically against the Rotator's own
   roll→pitch→yaw order on nine directions before a single part used them — the first verification *matrix* had
   the pitch sign backwards, which is precisely the bug that ends with wings on backwards and three plausible
   sign conventions to argue about.
2. **The deck.** Every body is levelled so its lowest geometry sits at exactly y=0, by one shared
   `deck_offset`/`lift` pair rather than by three families each nearly getting their own centre right. A lowered
   wing pair dipped 5.8 units below the Cherubim's hub before this existed.

## 8. Not done here, on purpose

Growth transitions, hover height, gait, spawn rules, LOD *selection*, replication, and anything that decides which
stage is shown. Also: no `/MAS` asset was built, redesigned or touched — the Sub-Agent Cub family is a separate
asset line with its own contract (`RELAY_DOG_CUB_CONTRACT.md`) and is unrelated to Project Avatars.

## 9. What three rounds of actually looking at it changed

The founder's loop is capture before, implement, capture after, compare, keep or reject. Every defect below was
invisible in the numbers and obvious in a render, which is the entire argument for the loop.

**Round 1 — the cameras were behind the creatures.** Every pose was generated at azimuth 232-268 for figures
staged at yaw 90, which is the far side of a creature facing +Y. Three families were photographed from directly
behind, and the shot named `LargeFace` had no face in it. Nothing was wrong with the assets; the audit was
pointed the wrong way. *A camera shows what it points at.*

**Round 2 — two real defects, found only because the cameras were fixed.**

* *Vanes and pinions rendered as splinters.* With `roll=0` a blade's width axis comes out horizontal, so a
  viewer standing on the ground sees it edge-on however wide it is. Every Cherubim vane and every Seraph pinion
  was a white toothpick. `roll=90` turned them into the broad plates they were always meant to be. This is the
  Bee's wing lesson in a new disguise, and it is now written down where the next person will hit it.
* *The Ten Tails had no head.* Front-on, the LARGE form was a black slab on stilts under a fan of whips. The
  head was built and in the right place by its own numbers — a gold pinprick of eye proves it — but it sat level
  with the roots of ten tails with more than half the skull inside the shoulder mass. The SMALL form read
  correctly in the same frame, which is the tell: the fault was in how the head is *carried* as the body grows,
  not in the head. `head_rise` is now per stage and negative at LARGE, so the head drops below the backline and
  reaches 72 cm clear of the chest, the way an animal's does.

**Round 3 — the same failure three times, finally named.** The Cherubim's twelve eyes came back as twelve black
beads on a gold wheel. `eye()` placed the rim sphere *concentric* with the iris at 1.18x its radius, so an opaque
rim completely enclosed the glowing iris it was supposed to frame. The Ten Tails' tail bulb was doing it to its
tail eyes, and the Seraph's hood was doing it to its head. Three separate parts, one mistake:

> In this project, a bigger opaque thing around a smaller bright thing always wins, and it always looks like the
> bright thing was never built.

That is the Cub Ghost's sheath, the Bee's invisible wings and the tail bulb, all the same shape of error. `eye()`
now takes the direction it looks and stacks rim, iris and pupil *along* it; the Cherubim's shell was pushed out
clear of its core; the Seraph's hood sits behind its head instead of around it.

**Rejected, not kept:** nothing in this family was rolled back, but the first Seraph arrangement was measured out
rather than argued about — a 6.6 m wingspan on a 5.6 m body made the "vertical one" wider than it was tall, so
the flight pair was raised and the column lengthened until the width-to-height ratio came to 0.71-0.77 across all
three stages.
