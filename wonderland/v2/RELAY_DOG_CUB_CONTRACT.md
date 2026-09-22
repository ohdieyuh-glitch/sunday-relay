# RELAY DOG SUB-AGENT CUB GHOST — integration contract

**For the Wonderland Internal Development session.** The world/asset lane owns the body; Internal
Development owns spawn, movement, lifetime and every runtime decision. This is the seam between them.

Founder terminology, corrected 2026-09-22 and binding: these are **regular sub-agent cubs**. Not /MAS
clones, not Compound AI Agent clones, not swarm agents, not alternate Julius bodies. /MAS is a
separate system and nothing here belongs to it. Approved names: `RelayDog_SubAgentCub`,
`RelayDog_CubGhost`, `SA_CubGhost`. Never `MAS_Cub`, `SwarmCub`, `CompoundCloneCub`. A sweep of both
checkouts before the first file was written found zero occurrences of the old terminology, so nothing
needed renaming — the correction arrived before any dependency existed.

Built against the founder's own reference plate,
`recovery/evidence/2026-09-22-founder-reference-plates/RELAY_DOG_CUBS_sub_agents.jpg`.

---

## What a Cub is

**A floating head.** Not a miniature of the standing mascot. The first build had a shortened torso
and two articulated arms with elbow hinges; the plate shows eight cubs and none of them has a body,
so all of it was deleted. A Cub is:

- the Relay Dog head, pearl white, rounded at every edge, self-lit
- two short **ear spurs** canted outward from the top corners, bases sunk into the skull
- a black **visor** with warm gold **eyes**, and the eye SHAPE varies per cub — that is how a
  creature with no face has an expression
- two **ball hands**, small white spheres floating free either side, fully detached — no arm, no
  shoulder, no linkage
- a **ghost tail**: a smooth swept tube that drops and curls behind, not a stack of blocks

**Why it is unmistakably a Relay Dog**: `cub_canon` imports `dog_canon` and re-bases the Dog's actual
head boxes — brow, jaw, frame, back, visor recess. The visor geometry is the canonical numbers, not a
copy of them. Change the Dog's head and the Cub's head changes with it.

## Asset paths (exact)

| What | Path |
|---|---|
| Blueprint | `/Game/WonderlandV2/Characters/RelayDogCub/BP_RelayDogCub` |
| Folder | `/Game/WonderlandV2/Characters/RelayDogCub/` |
| Body material | `…/MI_RelayDogCub_Pearl` |
| Visor material | `…/MI_RelayDogCub_Visor` |
| Eye material | `…/MI_RelayDogCub_Eye` |
| Ghost material | `…/MI_RelayDogCub_Ghost` |
| Translucent master (NEW) | `/Game/WonderlandV2/Materials/Master/M_V2_Ghost` |
| Meshes | `…/SM_RelayDogCub_<joint>_<surface>` |
| Eye variants | `…/SM_RelayDogCub_eyes_flat`, `…_eyes_arc`, `…_eyes_slant` |

`M_V2_Ghost` is new to this project: every existing V2 master (Surface, Portal, Foliage) is
`BLEND_OPAQUE`, so there was no translucent material to build a ghost out of. It is **translucent,
unlit, two-sided**, and the Bee skin's wings ride the same master.

**Generators are the source of truth, not the .uasset**: `wonderland/v2/cub_canon.py` (geometry as
data) and `wonderland/v2/cub_ghost_v2.py` (the builder), on the forge branch; run by
`wonderland/Tools/editor_jobs/build_cub_ghost.py`. Regenerating is the supported way to change a Cub.

## Rig: joints and hierarchy

```
Body (SceneComponent, actor origin = CENTRE OF THE HEAD)
├── Pivot_head      → Mesh_head_pearl, Mesh_head_visor, Mesh_head_eye
├── Pivot_handLeft  → Mesh_handLeft_pearl        (a detached sphere)
├── Pivot_handRight → Mesh_handRight_pearl
└── Pivot_tail      → Mesh_tail_ghost
```

`head` and `tail` are spelled exactly as `dog_canon` spells them, so animation that drives
`Pivot_head` or `Pivot_tail` on a Relay Dog drives the same names here. `handLeft` / `handRight` are
their own joints precisely because the hands are detached — bob them independently.

**The origin is the centre of the head**, because a floating head has no feet. The tail hangs below
it and the hands float beside it.

## Eye expression

Three interchangeable eye meshes: `flat` (bars), `arc` (a smile, three stepped bars), `slant`
(wedges). Swap the mesh on `Mesh_head_eye` to change a Cub's expression. The plate draws different
eyes on different cubs in the same shot, so variety across a group is the intended look, not an
accident.

## Placement — Cubs FLY ABOVE the Dog

**Founder, 2026-09-22: "They need to be flying above the relay dog not around above."** Cubs hold
station overhead in a loose dome, not in a ring at the Dog's feet. `cub_canon.FLIGHT` carries the
numbers, expressed in multiples of the DOG's height (174 cm at its canonical `W_UU = 60`) so they
scale with whoever is being escorted:

| Key | Value | Meaning |
|---|---|---|
| `base_over_dog` | 0.25 | the lowest cub clears the Dog's ear line by this × dog height |
| `spread` | 0.95 | extra height between lowest and highest cub |
| `radius_min` / `radius_max` | 0.15 / 0.75 | horizontal offset from the Dog's axis |

In practice, for a 174 cm Dog on level ground: Cubs occupy **z ≈ 237 cm to 388 cm**, within about
26–130 cm of the Dog's vertical axis. Read `FLIGHT` rather than hard-coding these.

## VFX sockets

`SceneComponent`s on the joint named, ready for Niagara. The world lane owns where they are;
Internal Development owns what plays there.

| Socket | Joint | For |
|---|---|---|
| `VFX_Core` | head | inside the head — the emergence flash |
| `VFX_Visor` | head | visor sheen / attention flare |
| `VFX_Halo` | head | above the spurs — status, selection, thinking |
| `VFX_EyeLeft` / `VFX_EyeRight` | head | per-eye accents |
| `VFX_TailTip` | tail | the sparkle trail the plate shows, and the dissolve anchor |
| `VFX_TailMid` | tail | secondary trail |
| `VFX_HandLeft` / `VFX_HandRight` | hands | the hands glow on the plate |

## Collision — stated once, and it is none

Every mesh is saved with `collision=False`, every component is `NoCollision`, overlap events off. The
Blueprint's parent is **`AActor`, not `ACharacter`** — a Character would bring a movement component
and a capsule to something that floats and is presentation only. This answers Internal Development's
standing request directly. The world lane's BR01 collision pass also cannot reach Cubs: it enumerates
only `WonderlandInstancedBatch` actors whose mesh name matches the architecture or ground word lists.

If selection or proximity is ever needed, add a single **overlap-only** sphere on the root. Never a
blocking primitive.

## Spawn, ascension and dissolve — what the body supports

The founder's sequence: the primary Relay Dog is grounded → floats upward → becomes completely
luminous white → Sub-Agent Cubs emerge one at a time → Cubs move outward and upward → the primary Dog
returns to normal. This is a **sub-agent spawning presentation**, not /MAS activation.

- **Emerge**: spawn at the Dog's chest at small uniform scale, grow to 1.0. `GhostOpacity` is an
  instance scalar, so a dynamic material instance can fade the tail in independently of the head.
- **Travel to station**: move the actor up to its `FLIGHT` slot; the tail is its own joint, so a
  runtime sway on `Pivot_tail` reads as drag with no animation asset.
- **Return / dissolve**: drive `GhostOpacity` toward 0 and scale down; `VFX_TailTip` and `VFX_Core`
  are the dissolve anchors.

**Sockets the PRIMARY DOG needs for its half of the sequence** (offsets in its own root frame, at the
Dog's `W_UU = 60`): chest `(0, 0, 105)`, halo `(0, 0, 182)`, ground ring `(0, 0, 0)`. I have **not**
modified `BP_RelayDog` — that asset is shared and the integration lane drives it. Say the word and I
will add them to `dog_v2.py` so they are generated rather than hand-placed.

## Performance

| Measure | Value |
|---|---|
| Triangles, whole Cub | ~1,630 (the swept tail and two spheres cost more than boxes did, and are worth it) |
| Components per Cub | 20 (1 root + 4 pivots + 6 meshes + 9 sockets) |
| Meshes drawn | 6 per Cub; 1 of them translucent unlit |
| Shadows | the ghost tail is `cast_shadow = False` — a wisp of light should not cast one, and translucent shadows are the most expensive thing 12 of these could ask for |
| LODs | generated; honestly a minor lever at this triangle count — component count and cull distance matter more |

At twelve: 12 × 20 = 240 components, 72 mesh draws. If that ever bites, the order of value is
(1) cull distance on the tail, (2) merge the two hand meshes into the head mesh for distant Cubs,
(3) an instanced path beyond the nearest few.

## Two traps already paid for

1. **Per-instance material overrides do not survive on a Blueprint actor.** The construction script
   re-runs after spawn and resets them. This silently invalidated a whole A/B round here — three
   "brightness variants" and a control wearing a completely different material all rendered
   identically, and the job correctly reported it had set every one of them. To change a Cub's look
   at runtime, swap the referenced asset or create a dynamic material instance. Never set a
   per-instance override on a BP and trust it.
2. **The ghost material is UNLIT, so brightness is in SCENE units.** Authored at 2.2 it renders pure
   black against Wonderland's daylight. The value that reads as a soft luminous wisp was found by
   sweeping four instances side by side: **opacity 0.46, brightness 62000**.

## What is NOT here

Spawn logic, following behaviour, lifetime, count policy, and any binding to real sub-agent state —
`FWonderlandJuliusActivity::ActiveSubagents` is the honest source for how many Cubs to draw. Those
are Internal Development's. This is a body, a rig, sockets and materials.
