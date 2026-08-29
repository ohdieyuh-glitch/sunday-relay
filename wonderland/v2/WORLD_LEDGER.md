# Golden Arrival as a place — world development ledger

Founder sequencing correction (2026-08-29): after the locomotion loop and its playtest, the next
phase is **world development, not combat**. The target is that walking the Dog around Golden Arrival
reads as *"this is already Wonderland"* rather than *"this is the test area where Wonderland will go"*.
No fighting system starts until this phase is approved. V1 stays legacy and read-only; PASS 07's
castle massing, garden structure, gate, skyline hierarchy and camera suite are preserved.

## The audit, measured before anything was built

Done from `layout_v2` on a laptop — path clearance and emptiness are geometry, and geometry does not
need a GPU. (The gameplay traversal itself follows on the next build, as the founder asked; this is
what could be established first.)

**Traversal works.** Every waypoint of the exploration circuit has room for the Dog: the tightest
clearance on the whole route is 330 uu (3.3 m) at the spawn, against a 36 uu capsule. No dead end, no
blocked gate, no wall across a route. 32 actors in the district actually block a walker — steps,
retaining walls, balustrades and hedge blocks — and none of them sit on a route.

**The emptiness is the problem, and it is not subtle.**

| Ground | Actors | Area | Density |
|---|---|---|---|
| Plaza and surrounds (\|x\| < 25 m, y −15…17 m) | 108 | 1,600 m² | **one per 15 m²** |
| Castle approach (\|x\| < 25 m, y 17…90 m) | **0** | 3,650 m² | — |
| Castle approach (\|x\| < 40 m) | 5, all on the flanks | 5,840 m² | one per 1,168 m² |

The approach a participant walks toward the hero building is **246× emptier** than the plaza they
just crossed, and the first 25 m either side of the axis contains nothing whatsoever. Across the
whole sampled district, 59% of ground is more than 12 m from any actor.

That is the founder's "empty lawn between garden gates and castle", quantified, and it is why the
castle currently reads as *the last object at the edge of a set* rather than a gateway into more
Wonderland.

## The plan, gap-ranked

One hypothesis per pass, in this order. Each pass renders HeroCam0 + PlayerCam01 + the cameras it
actually touches, plus the exploration video at the checkpoints.

| Pass | Hypothesis | Why first |
|---|---|---|
| **W1 — the approach becomes a place** | The 3,650 m² of nothing becomes an authored sequence: paired hedge and topiary masses defining the avenue, a fountain court at the midpoint as a pause and a landmark, flower beds and low walls stepping the width down, and the ground broken into rooms rather than filled with props. Large masses → medium structure → small detail. | It is the single measured hole in the district, it is on the primary route, and it is what makes the castle a gateway rather than an endpoint. |
| **W2 — the two garden routes become real destinations** | The left and right garden rooms get a reason to be entered and a way back out: a path that leads somewhere, a landmark at the end, and a loop rather than a cul-de-sac. | Secondary routes exist geometrically but lead to open ground; the founder asked for wandering that does not hit dead scenery. |
| **W3 — plaza material and exposure** | Authored stone variation, believable seams, less obvious grid, and the ~1.3× brightness against the reference corrected — elegant, never dirty. | Known HIGH from PASS 07, and it is the surface the player spends most time looking at. |
| **W4 — near-field architecture** | Credibility at gameplay distance on the walls, stairs, tower bases, trims, arches, railings, plinths and the stone/gold/planting transitions a walker actually passes. | Only reachable once the routes that bring a player close to them exist. |
| **W5 — landmarks and world continuation** | Signature Wonderland objects placed for navigation and identity, and a legible answer to "where does Wonderland continue from here". | Depends on W1–W2 establishing where the eye travels. |

Clouds stay where PASS 07 left them: desirable, unproven on this Vulkan runtime, and explicitly not
worth destabilising the world for. They get one bounded attempt after W3, and a documented refusal
if the runtime still will not carry them.

## Ledger

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Static traversal + emptiness audit | done | above; no dead ends, 246× density gap on the approach |
| 2 | Exploration route in the Dog (`-wlexplore`) | done, awaiting cook | `6d482bd` |
| 3 | Gameplay traversal video + founder playtest of the fixed build | pending the cook | |
| 4 | W1 — the approach becomes a place | | |
