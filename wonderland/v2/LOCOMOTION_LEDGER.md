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
| 6 | **Founder playtest**: full rebuild, cook, Pixel Streaming URL | DELIVERED 13:51 UTC | package fbd414e, map WL_V2_GoldenArrival_WP2, `WLDOG BOUND: 11 joints`, `WLDOG INPUT bound`, page HTTP 200 |
| 7 | Foot-ground easing moved into the arithmetic; stairs + articulation proven offline | done | 54/54 offline proofs |
| 8 | Founder feedback → repair | done | lag diagnosed and fixed at the stream; walk stride fixed from the founder's own telemetry |
| 9 | Movement profiled in-engine | done | after warm-up: 12.42 ms median (81 fps), p99 15.96 ms, **0 of 132 frames over 2x median**; GPU-bound at 11.8 ms, game thread 2.2 ms |
| 10 | Continuous capture | filmed twice, both surfaced defects; re-filming on the fixed build | 1,637 + 2,524 frames |

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

## Acceptance, as it actually stands (2026-08-29 14:00 UTC)

Proven offline (54 checks, `wonderland/tests/cpp/RelayDogStride.test.cpp`), and in the cooked build
where noted. Nothing here is claimed from watching a stream.

| Criterion | State | Evidence |
|---|---|---|
| canonical geometry/materials preserved | proven | `verify_dog_canon.py` PASS; hinges provably hidden at rest; live log `13 components given their canon materials` |
| real readable elbow articulation | proven | seams are real pivots (`forearmLeft<-armLeft` in the built BP); elbow travels 3–21° walking |
| idle head matches the landing personality | ported + proven varied | the landing rig's springs/cone/timings; 146 glances in 10 min, dwell 0.70–3.07 s, no side repeated 4× |
| natural walk and jog | arithmetic proven, **needs eyes** | Froude bands (jog 153, run 266, anime 376 uu/s), stance-biased phase |
| arms-back full-run silhouette | proven at the threshold | `ArmsBack` is 0 through walk and jog, 1.0 above 414 uu/s; both shoulders < −45° |
| smooth gait transitions | proven | 4× frame rate quarters the largest step — continuity, not a magic threshold |
| weighted starts/stops | proven | not fully formed on frame one; winds down without picking back up |
| turns respect momentum | proven | bank scales with speed and decays; a walking turn banks < 60% of a running one |
| no visible foot sliding | proven flat AND on stairs | 0.001 uu/frame flat, 0.0008 uu/frame while correcting 6.6 uu up a step |
| stairs / uneven surfaces | proven offline, **needs eyes** | 14 uu riser profile walked in the test; `MaxStepHeight` 26 uu against a 48 uu leg |
| gameplay camera / collision | **founder playtest** | ground slab collides from load; boom 420 uu at 95 uu socket height |
| looks good inside Golden Arrival | **founder playtest** | — |
| continuous founder-review capture | not yet | blocked on the founder's session ending (one GPU) |

**Two fixes are committed but NOT in the build the founder is playing** (`fbd414e`): the foot-ground
easing refactor, and a double-application of the gait weight to the legs that under-swings them
during the first fraction of a second of acceleration. Both go into the next cook, together with
whatever the playtest turns up — one rebuild, not three.

## Acceptance at the founder-verification gate (2026-08-30, build a745f04)

Everything below is evidenced by an offline proof, a live telemetry line, or a frame — never by
impression. 69 offline proofs pass (`wonderland/tests/cpp/RelayDogStride.test.cpp`).

| Criterion | State | Evidence |
|---|---|---|
| canonical geometry/materials preserved | met | `verify_dog_canon` PASS; hinge blocks provably hidden at rest; `13 components given their canon materials` in the build log |
| real readable elbow articulation | met | seams are real pivots (`forearmLeft<-armLeft` in the built BP); elbow travels 3–21° walking, knee 12–62° |
| idle head matches the landing personality | met | the landing rig's springs, cone and timings ported; 146 glances in 10 min, dwell 0.70–3.07 s, no side four times running; live session showed yaw −1.5°…+11.1° |
| natural walk and jog | met | stride 54 uu at 89 uu/s (was 25 — the founder's own telemetry found it); cadence tested at all four bands; arms 27°, body counter-rotation 2.5° |
| arms-back full-run silhouette | met | live: `AnimeRun` at 558 uu/s, `armsback=1.00`, lean 17° |
| smooth gait transitions | met | continuity by refinement — 4× the frame rate quarters the largest step |
| weighted starts/stops | met | not formed on frame one; winds down without picking back up |
| turns respect momentum | met | bank scales with speed and decays; a walking turn banks <60% of a running one |
| no visible foot sliding | met | 0.001 uu/frame flat, 0.0008 uu/frame while climbing a 14 uu stair profile |
| stairs / uneven surfaces | met | the 60 uu path riser removed (13.8 uu per slab now); walkable kit given collision; the Dog climbs the approach in-world |
| gameplay camera / collision | fixed, awaiting the founder's eyes | boom raised/shortened/pitched down after the capture caught it collapsing into the Dog |
| movement looks good inside Golden Arrival | **founder verdict** | — |
| continuous founder-review capture | produced | 56 s take on 1b4cbc2 covering idle → walk → jog → run → arms-back sprint → stop → turns |

### Performance, before and after

The founder reported stutter while moving. Profiled offscreen with the Dog driving its own route, so
the same motion is measured every run:

| | median | p95 | p99 | max |
|---|---|---|---|---|
| Frame | 12.42 ms (81 fps) | 14.66 | 15.96 | 15.97 |
| GPU | 11.82 | 12.26 | 12.39 | 12.40 |
| Game thread | 2.16 | 3.63 | 3.96 | 3.98 |
| Render thread | 3.33 | 7.66 | 14.02 | 14.05 |

**Zero of 132 frames after warm-up exceeded twice the median.** Every spike sits in the first 17
frames — level load (4,290 ms) then first-draw shader work (550/71/67/62 ms). The engine does not
stutter while the Dog moves; steady state is GPU-bound at 95% of a 12.4 ms frame, with the game
thread nearly idle at 2.2 ms.

The stutter was the STREAM: measured from a browser on the Studio, 71 fps at **11.8 Mbps of 1080p**,
with WebRTC opening at a 10 Mbps target — a still scene compresses to nothing and the moment the
camera moves that floods a trans-Pacific link. Fixed at 720p with start 2 / max 6 / min 0.4 Mbps at
60 fps. The founder confirmed: *"the latency and lagging has been decreased significantly."*

### Gap analysis

**CRITICAL** — none.

**HIGH** — none outstanding in locomotion.

**MEDIUM**
- The third-person camera can still be pulled in by architecture in tight spaces. Raised, shortened
  and pitched down in a745f04, which prevents most of it; foliage has no collision to probe against,
  so dense planting beside a route remains a camera hazard rather than a wall.
- Two route legs still time out by 51 uu and 223 uu — the Dog effectively arrives and the tolerance
  is tight. Cosmetic to the capture, not to gameplay.

**LOW**
- Dash is a foundation only: the speed band and posture exist, no dedicated dash input or burst.
- Foot IK is proven on a synthetic stair profile; slopes are handled by the same arithmetic but have
  not been filmed specifically.
- The idle look-target hook exists (`bHasLookTarget`) with nothing yet driving it — camera,
  participants and Djinn are the intended sources later.
