# Relay Dog locomotion — work ledger

Founder goal (2026-08-29): the canonical Relay Dog alive and polished at idle, walk, jog and
run **inside the real Golden Arrival**, iterating build → run → inspect → repair. Start state:
`relay/wonderland-v2` HEAD 2d7c262, Studio package a75b0cb, PASS 07 environment complete, GPU on.
Out of scope this loop: world polish, clouds, combat, Djinn, backend, flight.

## Ground truth this is built from

- **The canon is the web Dog.** `wonderland/v2/dog_canon.py` transcribes `relay-dog.ts`
  (product repo, commit f91c1d4). Proportions are identity; nothing here may change one.
- **The personality reference is the landing rig**, `src/relay/ui/landing/three/dog-rig.ts` at
  f91c1d4, and beat 8 of `choreography.ts` is `{state: 'IDLE', yaw: 0, tracksPointer: true}` —
  the Dog faces the viewer, idles, and tracks the pointer through an ADDITIVE look layer inside
  a narrow cone (yaw 0.22 rad, pitch 0.09 rad) on critically-damped springs (0.45 / 0.5 s), with
  a 1.15 attentiveness boost while looking. Idle is three incommensurate frequencies so the loop
  never reads as a loop. Those numbers are ported, not reinvented.
- **Foot lock is the one property that decides whether a walk reads as walking**
  (`WonderlandDogGait.h`, V1): while a foot is planted it must not move in WORLD space, so the
  stride phase is driven by DISTANCE TRAVELLED, never by a clock. Reused, for a biped.

## Ledger

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Recon: Dog build (rigid joint hierarchy), V1 C++ prior art, landing rig + beat 8, capture tooling | done | this file |
| 2 | Canon: real elbow + knee seams (`ELBOW_Y` 1.3083 W, `KNEE_Y` 0.5125 W), hinge blocks, `PARENTS` | done | `verify_dog_canon.py` PASS — hinges provably hidden at rest, leg halves re-tile exactly |
| 3 | Engine-free locomotion core + offline tests (g++ on the laptop) | done | `RelayDogStride.test.cpp` 46/46; foot lock 0.001 uu/frame, IK error 0.2 uu, continuity by refinement |
| 4 | UE layer: `ARelayDogCharacter` — joint binding by name, foot ground traces (reusing V1 `PawGroundOffset`), spring-arm camera, player input, capture route | done, awaiting compile | |
| 5 | Generator: nested pivots, C++ parent class, ground collision, the Dog walks and is player-possessed | done, awaiting cook | |
| 6 | **Founder playtest** (added 2026-08-29 by founder): full rebuild, cook, Pixel Streaming URL | in progress | |
| 7 | Capture video, inspect, repair, acceptance | | |

## Decisions

- **Elbows/knees are joints, not new geometry in the silhouette.** The web canon already draws
  the arm as upper + forearm + hand with an exact shared plane at 1.3083 W; the split happens
  there, so total arm length, width and shoulder position are untouched. Each seam carries a
  hinge block narrower and shallower than both limbs, centred on the seam plane: invisible while
  straight (gated), a real geometric pivot the moment it bends. The leg, drawn as one block, is
  cut at its own centre and the halves re-tile it exactly.
- **The Dog is rigid blocks, so locomotion is procedural transforms, not a skeleton.** No
  skinning exists to hide a joint, which is why the seam blocks matter and why swing angles stay
  within what a block pivot can carry.

## Founder playtest gate (added by the founder mid-loop, 2026-08-29)

The founder has never entered Wonderland V2. That is now an acceptance gate and it comes
BEFORE the video deliverables: the real Golden Arrival (PASS 07), the canonical ivory Dog, the
current camera and collision, controlled live. What it needed that the capture path did not:

- **A floor that exists from load.** The flagstone batches already carry collision, but they are
  instanced components built at `BeginPlay`, so a Character spawning in the same frame falls past
  them — which is exactly why the scale Dog was frozen (movement None, gravity 0) in SUITE01.
  The 400 m ground slab now collides, so the world is walkable the instant it loads.
- **The Dog as a real Character again**: gravity and walking restored, possessed by player 0.
  One Dog — the founder's avatar and ScaleCam07's scale reference are the same animal.
- **Input that survives cooking.** Explicit `BindAxisKey`/`BindKey` with real `FKeys`, which is
  what `AWonderlandDogPawn` learned the hard way on this streamed build: config axis mappings and
  Enhanced Input assets did not cook reliably here.
