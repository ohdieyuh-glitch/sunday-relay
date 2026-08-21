# ADR-017 — Marble supplies the backdrop; Unreal owns everything with consequences

**Status:** Accepted and implemented (2026-08-21) on `relay/wonderland-marble`.
Not merged: the goal holds every visual change behind founder visual approval.

## Context

Wonderland needs to look like the founder's reference image — a dense
Alice-inspired garden plaza under a pastel castle city — and authoring that by
hand is not a thing this project can do. World Labs Marble generates it from a
reference image in minutes, for credits.

What Marble returns is not a level. It is a **single-viewpoint reconstruction**:
a shell of geometry radiating from one camera, with the lighting baked into an
unlit texture. Measured on the Royal Garden export, the reconstruction's own
depth statistics give a hard limit — a player who steps `w` metres shifts a
feature at depth `D` by `atan(w/D)`, and past about 3° a single-viewpoint shell
visibly smears because it cannot reveal what was hidden from the viewpoint it
was reconstructed from. At native scale that allows **1.7 m of movement**. That
is not an open world.

The credits are finite (13,250 at the start of the goal) and a generation cannot
be un-bought.

## Decision

**1. Marble is a visual layer and nothing else.**

    MARBLE  -> architecture, scenery, foliage, distant detail. Appearance.
    UNREAL  -> collision, navigation, Relay Dogs, Compound Agents, multiplayer,
               interactions, quests, GVE. Everything with consequences.

Every mesh imported from Marble is placed with collision **disabled** and tagged
`MarbleVisualLayer` / `MarbleNoCollision`. The importer refuses to promote Marble
geometry to gameplay collision; the flag that would do it is deliberately long,
hidden from `--help`, and implemented as a refusal.

**2. It is placed as a BACKDROP anchored at the arrival camera, not as a world.**

The mesh origin is the reconstruction viewpoint. Anchoring the actor origin on
`HeroCam0` makes every ray from that camera identical under any uniform scale — a
point at direction `d` and distance `r` moves to `6r` in the same direction and
lands on the same pixel. So the shell is scaled ×6 and pushed out: the image from
the arrival camera is unchanged and the tolerable roam radius grows from 1.7 m to
about 10 m. Authored Unreal geometry owns everything inside that radius and
provides all ground; where they overlap the authored plaza occludes the shell.

A consequence that follows from the same algebra: the reconstruction's
ground-plane offset is **not** applied in backdrop mode. Lifting the shell is a
translation, and translation is the one operation that breaks the scale
invariance the whole lever depends on.

**3. Marble never generates Relay Dogs.**

Not as a rule in a document — the rule was already written and was broken.
Generation `47928d7e` cost 1,580 credits and was discarded because Marble
reproduced the Dogs out of the reference image while the text prompt said NO
DOGS. Image conditioning beat the negative, and a second negative would not have
helped.

So `reference/ATTESTED.json` is a gate: an image may condition a paid generation
only if a person has attested it dog-free and the bytes still hash to what they
looked at. An unlisted image is refused rather than assumed innocent. The
founder's full reference is listed too — as containing Dogs, so that it is
actively refused. The text is checked only where it **asks** for something; a
negated mention passes and is reported as **inert**, because the evidence says
the text was never the variable.

**4. Splats are downloaded and not imported.**

UE 5.8 has no native Gaussian-splat renderer and nothing in this repository has
demonstrated one. Importing them would mean shipping a dependency nobody has
measured.

**5. Nothing is trusted that was not measured.**

The import step reads `MARBLE_VISUAL_ACTORS` and `MARBLE_LEVEL_SAVED` out of the
editor log rather than an exit code, because a Python exception under
`-run=pythonscript` does not reliably fail the process. The layer's size is
gated against the mesh's own accessor bounds, on **sorted** extents so an axis
swap is not mistaken for a unit error. The packaged world reports
`MARBLE_ACTORS`, whether the shell is two-sided, and whether any Marble
component blocks.

## Consequences

**Accepted.** The far distance stops being authored primitives. The 3° parallax
limit is real and permanent: a player who walks far enough will see the backdrop
smear, and the answer is more authored geometry, never a larger shell.

**Accepted.** A single-viewpoint shell is correct from one camera. Hero cameras
1–5 look at it off-axis and will not be as convincing as HeroCam0.

**Accepted.** The shell is unlit — its lighting is baked. It will not respond to
Wonderland's sun, which is what a backdrop wants and is worth knowing before
someone tries to light it.

**Watch.** The shell is a surface seen from INSIDE. If its material imports
single-sided, every gate passes and the frame is empty. The importer restores
two-sidedness when the source glTF declared it, and the packaged proof reports
it. This is the failure mode most likely to look like a placement bug.

**Rejected alternative — regenerate all of Wonderland from Marble.** It would
delete the ~33k-piece world's gameplay anchors, portals, navigation and agent
infrastructure, and replace a walkable place with a shell that tolerates 1.7 m
of movement.

**Rejected alternative — use Marble's collision proxy as the visual layer.**
Measured: 69,305 triangles over 35,494 m², **1.95 triangles per m²**, median edge
1.25 m. A detailed environment runs 100+ per m². It is free and it is a coloured
blur; it stays available behind `--allow-collider-as-visual` and is never
automatic.

## What this does not decide

Whether Wonderland is **walked or flown**. Measured separately and recorded in
the same branch: the world currently has no gameplay collision at all, because
every visual piece is an instance in a NoCollision batch and the player pawn uses
`FloatingPawnMovement`. `WONDERLAND_COLLIDE` makes the other choice testable in
one build. That is a product decision and is the founder's.

## Evidence

- `wonderland/marble/` — client, pipeline, importer, attestation, ledger, and
  four offline suites (`test.sh`).
- `wonderland/marble/worlds/royal-garden-backdrop/manifest.json` — the accepted
  world, its measured mesh bounds, and the placement derived from them.
- `Source/Wonderland/WonderlandWorldProof.cpp` — what the packaged world reports.
- `wonderland/infra/build/build-wonderland.sh` §3b — the build step and its gates.
