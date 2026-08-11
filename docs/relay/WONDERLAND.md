# Wonderland

**Relay is where you build your Compound AI Agent. Wonderland is where it lives.
Ship on Sunday is where its ecosystem trades.**

Wonderland is a real-time visual and world layer over **actual Relay state**. It
is not a game backend, and it holds no truth of its own. Relay remains
authoritative for missions, loops, the Project Brain, PSPs, permissions,
verification, the marketplace and every durable record. Unreal visualizes and
controls experiences, and asks Relay for things.

> **Nothing in this document has been compiled.** No Unreal Engine binary exists
> in this environment. See [What is unproven](#what-is-unproven) — it is specific,
> and it is the first thing to read before trusting any claim here.

---

## 1. The authority boundary

| Concern | Owner |
|---|---|
| Mission contracts, verdicts, findings, repairs | **Relay** |
| Loop contracts, loop runtime state, cron | **Relay** |
| Project Brain: memory, operations, evidence | **Relay** |
| Permissions, entitlements, skill authorization | **Relay** |
| Verification, review, attestation | **Relay** |
| Durable persistence, recovery, spend | **Relay** |
| World rendering, camera, input, animation playback | **Unreal** |
| Level geometry, lighting, materials, hub layout | **Unreal** |
| Requesting a mission | **Unreal asks. Relay decides.** |

The boundary is enforced by shape, not by convention:

- The projection functions take observations and return a document. None of them
  mutates its input, appends an event, touches evidence, or reaches a provider.
- The only outbound type is `WonderlandMissionRequest`, whose `authority` field
  is stamped to the constant `relay_decides`. **There is no field in any struct
  on either side of the seam that could express "Wonderland approved this."** A
  test asserts no key of a request matches `/approv|authoriz|decision|granted/i`.
- `AWonderlandDogPawn::ApplyWorldState` takes a `const FWonderlandWorld&` and
  returns `void`. The pawn has no method that starts a mission, advances a loop,
  records evidence, or changes a verdict.

---

## 2. The Relay↔Unreal contract

### Where it lives

| Side | Path |
|---|---|
| TypeScript, pure domain | `src/relay/mission/wonderland/` |
| C++ structs and enums | `wonderland/Source/Wonderland/WonderlandTypes.h`, `RelayWorldState.h` |
| Parity test | `src/relay/mission/wonderland/wonderland-cpp-parity.test.ts` |

`src/relay/mission/wonderland/` follows the repository's pure-domain rules: no
Node, no network, no clock. The observation instant is an injected ISO string,
passed as the second positional argument to `projectWonderlandWorld(input, observedAtIso)`
and echoed onto the document — the same convention as
`projectOperations(record, asOf)` and `refreshBrainDocument({ generatedAt })`.

Schema version: `relay-wonderland-world.v1`
(`WONDERLAND_WORLD_SCHEMA_V1`, with `SUPPORTED_WONDERLAND_WORLD_SCHEMA_VERSIONS`
beside it, as the loop, worktree and durable records do).

### The document

`WonderlandWorld` / `FWonderlandWorld`, fifteen sections:

```
schemaVersion  observedAtIso  revision  provenance  simulated  provenanceLabel
agent  loops  missions  entities  brain  terminal  gve  classes  replication
```

Nothing in it is invented. Every section is projected from a module that already
owns the fact:

| Section | Read from |
|---|---|
| `missions` | `mission/contracts` (`MISSION_STATUSES`, `MISSION_VERDICTS`) and `mission/status/status-model` (all four Aquala dimensions) |
| `loops` | `mission/loop/runtime` — `RELAY_LOOP_RUNTIME_STATES`, `isActiveLoopState`, `isWaitingLoopState`, `isTerminalLoopState` |
| `agent` | `shared/official-relay-dog-states` — `officialRelayDogViewForState`, the same call the website and the CLI make |
| `terminal` | `mission/terminal` — `RelayTerminalReadModel`, whose events `projectTerminalEvent` already redacted |
| `brain` | `shared/llmops` — `RelayOperationsView`, `RelayFigure`, `RELAY_HEALTH_STATES` |
| `classes` | `mission/skills` — `RELAY_SKILLS` is the skill-id catalogue |
| `entities` | verified mission evidence only (see §5) |

### How the two sides are held together

Two mechanically checked links, because either alone is defeatable.

**Link 1 — `tsc`, inside `wonderland-contracts.ts`.** Every struct's field names
exist as a runtime array built by `exactKeys<T>()`, a helper whose parameter type
fails to accept the literal if a key is missing *or* extra, naming the missing key
in the error. `nullableKeys<T>()` does the same for the set of fields whose type
admits `null`, derived from the interface with a mapped type. So a field added to
an interface, or a field that stops being nullable, breaks the build.

**Link 2 — `wonderland-cpp-parity.test.ts`.** It reads the real `.h` files as text
and compares them against those arrays. Without link 1 this test would compare C++
against a manifest that had itself drifted and report agreement.

The test's precondition discipline exists because a regex that matches nothing
reports perfect agreement for an empty set. It asserts, before comparing anything:
the directory exists; headers were found; every Wonderland source file is tracked
by `git ls-files` (naming `git add -N` in the failure message); every struct and
enum in the table was found; every parsed struct has ≥1 field; every parsed enum
has ≥1 member. It also asserts field and member **counts**, so a duplicated name
cannot hide a missing one, and that no two C++ fields normalize to the same
TypeScript name.

It is bidirectional, following `UNMOUNTED_WEBSITE_SURFACES` in
`scripts/relay-surface-parity.mjs`: a struct or enum in the headers that is absent
from the parity table fails; and an allowlist entry naming something the headers no
longer declare, or something that *is* mirrored, fails too.

### Name mapping

| C++ | TypeScript |
|---|---|
| `bKnown`, `bAttested`, `bObserved` | `known`, `attested`, `observed` |
| `MissionId`, `BlockingFindingsOpen` | `missionId`, `blockingFindingsOpen` |
| `VerifiedComplete`, `ProviderCallExhausted` | `verified_complete`, `provider_call_exhausted` |
| `LiveLocal` | `LIVE LOCAL` |
| `Game3dShooter` | `game_3d_shooter` |

Both mappers have their own unit tests, including the traps: a real field starting
with a capital `B`, and the digit boundary that makes `Game3dShooter` and
`game_3d_shooter` agree.

### The four rules, and how each is made structural

**1. Unknown is never zero and never a default.**

- A mission Relay has not observed projects as `observed: false`, all four status
  dimensions `null`, `verdict: null`, and `blockingFindingsOpen` as
  `{ known: false, value: null, reason: 'not_observed' }` — never `0`.
- `observed` is *evidenced*, not taken from the caller: it is true only when at
  least one state fact arrived. Knowing a mission's id is not knowing its state.
- `WonderlandFigure` is `RelayFigure` flattened for a USTRUCT, and `value` is
  `null` whenever `known` is false, so there is still no numeric field readable
  without checking the flag.
- On the C++ side, **ordinal 0 is load-bearing.** Unreal cannot hold a null enum
  and a default-constructed USTRUCT zero-fills, so whatever sits first is what a
  renderer sees before anything is assigned. Every enum's ordinal 0 is the value
  that means "Relay has not said": `Unobserved` for a nullable vocabulary,
  `Unknown` for health, `Dormant` for animation, `FoggedUnknown` for entity form,
  `Unavailable` for GVE phase, `Simulated` for provenance. The parity test asserts
  the first member of every enum against a declared `zeroMember` column.
- Nullable strings cross as `FWonderlandText` (a `bKnown` flag beside a value)
  and not as `FString`, because an empty string is a string. Nullable numbers use
  `FWonderlandNumber`, nullable booleans `FWonderlandFlag`. The parity test
  requires an approved carrier for every nullable field, with two documented
  exemptions whose mechanism is named and whose continued necessity is checked.
- Every scalar `UPROPERTY` in the world structs must carry an explicit `=`
  initializer; the test enumerates them.

**2. The projection is read-only over Relay truth.** Covered in §1.

**3. Nothing simulated may render as real.** `provenance` is Relay's own
`Provenance`, `simulated` sits beside it, and `provenanceLabel` is a full sentence
for all four values — a one-word badge is what lets a simulated world get mistaken
for a live one at a glance. `FWonderlandWorld` defaults to
`Provenance = Simulated` and `bSimulated = true`, so a zero-filled world claims
nothing.

**4. Field parity.** The two links above.

---

## 3. The in-world live Compound Agent terminal

`WonderlandTerminalPanel` / `FWonderlandTerminalPanel` — small, wide, minimal,
transparent, beneath the Dog. Six lines
(`WONDERLAND_TERMINAL_MAX_LINES`), newest last.

It **reuses the existing truthful terminal projection** rather than adding a
second one. Each line's `headline` and `detail` are copied from a
`RelayTerminalEvent` produced by `projectTerminalEvent` in
`src/relay/mission/terminal.ts` — which is where secret redaction and the exact
`"Private reasoning omitted."` substitution already happen. There is no branch in
the Wonderland projection that can produce a headline Relay did not produce, and
`redactionsApplied` and `omittedPrivateReasoning` travel with each line so the
panel can say something was removed without knowing what it was.

**Why `mission/terminal.ts` and not `src/relay/ui/project-workspace/coding-terminal.ts`.**
The direction named the UI module. It cannot be used: `src/relay/mission` may not
import from `src/relay/ui` — "UI is a consumer. Nothing outside `src/relay/ui` may
import something inside it" — and that boundary is structurally tested.
`mission/terminal.ts` is the pure-domain projection of the same event stream,
documented in `docs/relay/LIVE_TERMINAL.md` as the source both surfaces render,
so reusing it satisfies the intent without inverting the layering. The
`coding-terminal.ts` view remains the website's own projection of the coding-agent
run; if Wonderland ever needs its specific fields, the domain should declare the
shape it needs and a composition root should wire the two, as the connectors do.

Absence is a state the panel **shows**: with no read model, `present` is false and
`unavailableReason` says *"…because there is nothing to show, not because the
system is quiet."* Truncation is reported (`truncatedFrom`), because a window
presented as a whole is the same class of lie as a percentile from three samples.

---

## 4. The Relay Dog: third-person, customizable, and driven by Relay

### Identity is preserved, not re-decided

The Dog is the compact **front-facing voxel companion**: upright rectangular ears,
block head, dark charcoal visor band with two square amber eyes inside it, short
squared muzzle, compact chest, **short block legs**, short limbs, four paws, gold
collar, and a tail. Canonical grid **18 × 14**, and **one uniform scale factor
drives both axes** — independent width and height scaling distorts the body and is
prohibited.

`FWonderlandDogProportions` carries those constants plus the row bands
(rows 0–5 head, 6–10 body, 11–13 legs), `LegCount = 4`, `bUniformScaleOnly = true`
and a single `UniformScale` float. There is deliberately no `FVector` scale and no
separate width or height property.

### Skins transform, they never replace

`WonderlandDogSkin` recolours **eyes and collar only**, through the existing
`chakraDogPalette` seam (the sprite's own `y` and `c` palette letters). Body,
shading and visor come from `OFFICIAL_RELAY_DOG_PALETTE` and a skin has no field
that could change them. `gridWidth` and `gridHeight` are **stamped** from
`OFFICIAL_RELAY_DOG_WIDTH` / `OFFICIAL_RELAY_DOG_HEIGHT`, so a change to the
canonical grid moves the 3D dog with the 2D one. `WonderlandSkinRequest` has no
width, height, pose or mesh field: the forbidden change is unrepresentable rather
than policed. An unrecognised progression tier resolves to the untiered default,
never to the first tier.

The parity test compares the C++ **values** as well as the shapes here: it reads
the `GridWidth` / `GridHeight` initializers on `FWonderlandDogProportions` and
asserts they equal `OFFICIAL_RELAY_DOG_WIDTH` / `OFFICIAL_RELAY_DOG_HEIGHT`, that
the head/body/leg row bands account for every row of the grid, and that
`LegCount` is 4. A shape-only check would have passed a header declaring
`GridWidth = 20`, and the proportions are the identity.

Default skin id is `official-cream` — the colorway id the PSP fixtures already
use.

### Animation comes from Relay, never from a timer

The chain is: Relay's `dogState` → `officialRelayDogViewForState` →
`{ activity, pose, motion }` → `WONDERLAND_MOTION_ANIMATION[motion]` → clip.

- The clip is a function of the observed motion and nothing else. No elapsed time,
  no random source, no token rate, no "looks busy" heuristic. The pawn sets
  `PrimaryActorTick.bCanEverTick = false`.
- `WONDERLAND_MOTION_ANIMATION` is total over `OfficialRelayDogMotion`, so adding
  a motion to the shared identity module fails `tsc` until Wonderland has a clip.
- `WONDERLAND_DOG_MOTIONS` is **derived** from that map rather than restated. This
  matters: `OfficialRelayDogMotion` is a type-only union with no runtime array, and
  `OFFICIAL_RELAY_DOG_ACTIVITY_MOTION` does not cover it — `work_scratch` is
  retained for the `reaching` pose and no activity selects it any more. A list
  derived from *that* map would have silently dropped a motion the C++ enum needs,
  and the parity test would have called the smaller set agreement.
- **The C++ case table is compared clip-for-clip against the TypeScript map**, not
  merely for coverage, so the 3D dog and the 2D sprite cannot show different
  behaviour for the same Relay state.
- **Unobserved is not idle.** A null motion resolves to `dormant`, and
  `ObservedAnimation()` returns `Dormant` until a snapshot has been applied. An
  unrecognised `dogState` string also resolves to unobserved: the shared
  `officialRelayDogViewForState` falls back to `idle` so a 2D surface always has
  something safe to draw, and in a world-state document that fallback would convert
  "Relay said nothing" into "the Agent is idling". `KNOWN_DOG_STATES` is the guard,
  checked *before* the call.

### The meditation hover is additive

The founder's example — a meditation hover while a `/loop` executes — is an
**overlay**, not a clip replacement: `WonderlandDogOverlay` is a separate field,
and `WonderlandOverlayIsAdditive()` states it as a testable fact. A replacement
would give Wonderland a silhouette the website never shows.

The hover is driven by `FWonderlandLoopSignal::bExecuting`, which is Relay's own
`isActiveLoopState` and **deliberately excludes every wait state**: a loop blocked
on approval, budget or a rate limit is making no progress, and animating it would
be a claim of activity once a frame.

### The pawn

`AWonderlandDogPawn` (`WonderlandDogPawn.h/.cpp`): a static-mesh root, a
`USpringArmComponent` boom (arm length 420, socket offset +90 Z, pawn control
rotation on, collision test on) and a `UCameraComponent`. Enhanced Input mapping
context and Move/Look actions are `EditDefaultsOnly` properties bound in a
Blueprint subclass. `ApplyWorldState`, `ObservedAnimation`, `ObservedOverlay` and
`HasObservedActivity` are the whole Relay surface.

### The hub / starter zone

`WonderlandHubLevel.h` — `UWonderlandHubDescription`, a `UDataAsset` holding
`FWonderlandHubZone` entries so the zone list is editable in the editor *and*
diffable in the repository. Zone kinds: `Arrival`, `AgentGrounds`, `ProjectField`,
`Observatory`, `ChaseGate`, `Atrium`, `Passage`. A zone may name the
`FWonderlandWorld` section it presents, and it must read that section from the
applied snapshot rather than compute a substitute.

Zones carry **no product meaning**. A player standing somewhere changes no Relay
state — walking is where the Dog happens to be standing, exactly as idle patrol is
on the 2D Stage.

**Aesthetic direction.** An original whimsical surreal fantasy world: lush fantasy
paths and forests, a whimsical city, giant mushrooms, strange clocks, ornate
gates, impossible architecture, roses, teacups, magical objects, glossy materials,
bright cinematic lighting, strong depth and atmosphere, crisp high-resolution
presentation. Alice-in-Wonderland influence affects **atmosphere and world logic
only**; no protected character, name, likeness or design from any existing work is
reproduced, and no zone name is taken from one.

---

## 5. Project → world entity

Form is chosen by project **category**, never by repository size. The map is total
over `WonderlandProjectCategory`, so adding a category without deciding what it
looks like fails `tsc`, and a test asserts no two categories share a silhouette.

| Category | Form |
|---|---|
| `game_3d_shooter` | `war_creature` — a giant spider/scorpion war creature |
| `database_platform` | `data_vessel` — an enormous data vessel carrying its own weather |
| `ai_system` | `mythic_organism` — an intelligent mythical organism that watches back |
| `devtool` | `clockwork_entity` — gears, escapements, strange dials |
| `cloud_system` | `sky_carrier` — a floating carrier-continent creature |
| `web_application` | `glass_pavilion` — impossible galleries |
| `mobile_application` | `wanderer_caravan` — a walking caravan that folds |
| `research_codebase` | `library_landmark` — half garden, half archive |
| `unknown` / absent | `fogged_unknown` |

### Evolution requires verified meaningful development

**There is no commit count in the input, the output, or the arithmetic.** That is
structural rather than policed: a field that existed would eventually be read by
something that needed a number to go up.

A mission moves the world only when **all four** hold —
`verdict === 'verified_complete'`, an execution attestation exists, the required
independent review approved, and at least one evidence reference is cited. These
are the same facts `evaluateMissionVerdict` requires; the implementer's own report
is deliberately not an input, because it is a claim.

Unverified work arrives as `unverifiedActivityCount`, is **shown**, and cannot
reach `stage`. A test drives 500 unverified activities and asserts
`stage === 0` and `evolutionEvidenceCount === 0`; another walks each of the five
ways a mission can fall short, one at a time.

Stage thresholds are cumulative counts of qualifying missions: `[1, 3, 6, 10]`.
`stage` is `null` for a project Relay has never observed — **zero is a real
measurement**, reserved for a project Relay watched that verified nothing.

---

## 6. The one real GVE

Three classes: **PROJECT** (improves the actual software), **AGENT** (improves the
Compound Agent, its PSP, its skills), **HYBRID** (both). One GVE is built.

### `runaway_dog_research_chase` — class HYBRID

The user chases a runaway Relay Dog through Wonderland while Relay runs a real
multi-step research Loop over the project or the Agent. Capturing the Dog reveals
evidence-backed recommendations and selectable Missions.

Phases, in precedence order: `abandoned` (the player's decision outranks machine
state) → `unavailable` (no backing Loop) → `resolved` / `captured` → `capture_ready`
→ `backend_running` → `chase_active`.

Two places this could have become a lie, and what stops each:

**The reward has to land.** A chase that ends with nothing feels broken, which is
exactly the pressure that produces invented copy. A recommendation citing no
evidence is **withheld**: `headline` is replaced by
`WONDERLAND_WITHHELD_HEADLINE`, `withheldReason` says why, and the original text
is not carried anywhere the projected value can reach — a test serialises the
result and asserts the uncited text is absent. A recommendation whose freshness
verdict this build cannot read is withheld too, with its citations kept
inspectable. The chase is allowed to end disappointingly; it is not allowed to end
with invented copy.

**Capturing feels like completing.** It is not. `captureUnlocked` requires the
backing Loop to have reached `completed` — the Loop Engine's only successful
terminal state. A test walks every `RELAY_LOOP_RUNTIME_STATES` value and asserts
no other one unlocks capture, and that each exhaustion's reason names the state
that stopped it. A caught Dog with incomplete research is `captured` and reveals
nothing.

Selectable Missions are `WonderlandMissionRequest`s, `authority: 'relay_decides'`.

---

## 7. Multiplayer-ready architecture (foundation only)

`WonderlandReplication` / `FWonderlandReplication` declares: `authority` is
`relay`, `clientRole` is `presentational`, a monotonic `revision` a client must
not render backwards over, and which document sections are owner-only versus
world-visible.

| Owner-only | World-visible |
|---|---|
| `agent`, `loops`, `missions`, `terminal`, `gve`, `classes` | `entities`, `brain`, `replication`, and the document header (`schemaVersion`, `observedAtIso`, `revision`, `provenance`, `simulated`, `provenanceLabel`) |

A test proves the two lists are disjoint and together account for **every**
section of `WonderlandWorld` exactly once — a section in neither list would be
replicated in whichever direction the engine happened to default, which is not a
decision anybody would have made.

**Explicitly NOT built**, and documented as planned rather than implied: clans,
Battle Pass, Coliseum, boss economies, the marketplace surface, and large world
scale. None of them appears in any type on either side.

---

## 8. Skills and classes (foundation only)

Seven classes: `agentic_engineer`, `ai_engineer`, `forward_deployed_engineer`,
`software_engineer`, `game_developer`, `research_engineer`,
`systems_infrastructure_engineer`.

**Users are multi-class, structurally.** `projectWonderlandClassStandings` returns
a standing for every class, always, and there is no primary-class field anywhere
for a later feature to start reading — a test asserts no standing key matches
`/primary|main|selected|active/i`.

**A badge is verified mastery.** `WonderlandBadge.evidenceMissionId` is required
by the type, so a badge without a mission behind it is unrepresentable. A candidate
whose mission is not verified increments `unverifiedClaimCount` instead; the count
and the badge list are separate fields with different types, so no aggregation can
merge them.

**A Skill Plugin is a real Relay capability.** `skillPluginIds` are validated
against `RELAY_SKILLS` from `src/relay/mission/skills`. An unrecognised id is
dropped **and reported** in `unknownSkillPluginIds`, because silently dropping it
is how a capability that resolves to nothing survives.

**Not built:** levelling curves, XP, prestige, class-gated content, badge artwork,
trading.

---

## 9. Opening the project in Unreal

```
wonderland/
  Wonderland.uproject            EngineAssociation 5.4, EnhancedInput enabled
  Source/
    Wonderland.Target.cs
    WonderlandEditor.Target.cs
    Wonderland/
      Wonderland.Build.cs        Core, CoreUObject, Engine, InputCore,
                                 EnhancedInput, HTTP, Json, JsonUtilities,
                                 DeveloperSettings, UMG, Slate, SlateCore
      WonderlandModule.cpp       IMPLEMENT_PRIMARY_GAME_MODULE
      WonderlandTypes.h          carriers, enums, link state
      RelayWorldState.h          the mirrored world-state structs
      WonderlandDogAnimation.h/.cpp
      WonderlandDogPawn.h/.cpp
      WonderlandHubLevel.h
```

1. Install Unreal Engine **5.4**.
2. Right-click `wonderland/Wonderland.uproject` → *Generate project files*
   (or `Engine/Build/BatchFiles/GenerateProjectFiles`).
3. Build the `WonderlandEditor` target, then open the `.uproject`.
4. There is **no `.umap`**. Create a level, add a Blueprint subclass of
   `AWonderlandDogPawn`, assign its `InputContext` / `MoveAction` / `LookAction`,
   and create a `UWonderlandHubDescription` data asset from the zone list in §4.

### Feeding it real state

There is **no transport yet**. `ApplyWorldState(const FWonderlandWorld&)` is the
entry point; nothing calls it. The intended path is the Relay Bridge's existing
read contract over HTTPS (the `HTTP` and `Json` module dependencies are declared
for it), with the browser-pairing security shape described in
`docs/relay/SECURITY_BOUNDARIES.md`: one operator credential that never reaches a
client, and a read-only origin-bound session for anything presentational.
`FWonderlandLinkStatus` models the client's side of that link and is deliberately
**not** part of the world document, so a lost connection can never be mistaken for
a mission result. `Stale` keeps the last snapshot and dims the world; it never
pretends a dead link is a live one, and never blanks the scene either.

---

## 10. What is built

| Deliverable | State |
|---|---|
| Versioned typed pure-domain projection, `src/relay/mission/wonderland/` | Built |
| Matching C++ structs and enums | Built (not compiled) |
| TS↔C++ parity test, both directions, with precondition proofs | Built |
| In-world terminal panel, reusing `mission/terminal.ts` | Built |
| Third-person pawn + spring-arm camera | Built (not compiled) |
| Skin/customization model preserving Dog proportions | Built |
| Animation driven by the projection's activity field | Built, TS and C++ tables cross-checked |
| Hub zone description (`UDataAsset`) | Built (not compiled) |
| Project→entity form by category | Built |
| Evolution gated on verified mission evidence | Built |
| One real GVE (`runaway_dog_research_chase`) | Built |
| Replication header + authority boundary | Built (foundation) |
| Seven engineer classes, badges, skill plugins | Built (foundation) |

**98 tests** across five files in `src/relay/mission/wonderland/`.

## 11. What is deferred

Nothing below is started. Each is listed because a reader could otherwise assume
it from the surrounding work.

- **A level.** No `.umap`, no geometry, lighting, materials, foliage, meshes,
  animation assets, audio, or VFX. The visual target in §4 is direction, not
  content.
- **The transport.** No HTTP client, no polling, no snapshot cache, no
  authentication code. `ApplyWorldState` has no caller.
- **A Bridge endpoint** that serves `WonderlandWorld`. The projection exists;
  nothing hosts it.
- **Actual replication.** No `UPROPERTY(Replicated)`, no `GetLifetimeReplicatedProps`,
  no server travel, no session code. The header declares the boundary; the engine
  work is not done.
- **The `gve` request path.** `WonderlandMissionRequest` is a shape. No code sends
  one, and no Relay route accepts one.
- **UMG for the terminal panel.** The projection produces lines; no widget draws
  them.
- **A 3D Dog rig.** Proportions and animation states are declared; no skeletal
  mesh, no animation blueprint, no clips exist.
- **Skin persistence.** `resolveWonderlandDogSkin` is pure. Nothing stores a
  choice, and the identity docs already record that PSP dog customization is not
  implemented.
- **Multiplayer product systems:** clans, Battle Pass, Coliseum, boss economies,
  marketplace, world scale.
- **Class progression:** levelling, XP, prestige, gated content, badge artwork,
  trading.
- **More GVEs.** One, deliberately.
- **A UI or CLI surface.** `src/relay/mission/wonderland` is **not** re-exported
  through `src/relay/mission/index.ts`: nothing consumes it yet, and that barrel is
  reachable from the browser entry point — adding an unused surface to that import
  graph is how `role-slots` put server configuration names into the bundle. When a
  surface needs Wonderland it imports the path directly, and that edge gets
  reviewed then.

## 12. What is unproven

**No Unreal Engine binary exists in this environment. None of the C++ has been
compiled, linked, loaded, or run.** What that specifically leaves unproven:

1. **It may not compile.** Syntax, includes, and UE API signatures
   (`USpringArmComponent::SocketName`, `ULocalPlayer::GetSubsystem`,
   `SetRelativeScale3D`, `UDataAsset`) are written from knowledge of UE 5.4 and
   have not been checked by a compiler.
2. **UnrealHeaderTool may reject the reflection.** `USTRUCT`/`UENUM`/`UCLASS`
   macros, the `.generated.h` includes, `BlueprintType` on every enum, `int64` and
   `double` as `UPROPERTY` types, and `TObjectPtr` usage are unverified by UHT.
   The parity test reads these files as **text**; it proves the shapes agree with
   TypeScript, and proves nothing about whether UE accepts them.
3. **The zero-fill argument is reasoned, not observed.** That a default-constructed
   `FWonderlandWorld` reads as unobserved follows from the declared initializers and
   from ordinal 0, and has not been asserted by a running program.
4. **The `WONDERLAND_API` macro** is assumed to be generated by UBT for a module
   named `Wonderland`. Not verified.
5. **The pawn has never moved.** Camera framing, boom length, collision, and input
   binding are untested; no Blueprint subclass exists to bind the actions.
6. **Nothing has rendered.** No screenshot, no frame, no visual evidence of any
   kind exists for any claim in §4.
7. **`Wonderland.Build.cs` module dependencies are unresolved.** `HTTP`, `Json`,
   `JsonUtilities` and `DeveloperSettings` are declared for a transport that does
   not exist; whether the set links is unverified.
8. **No end-to-end path has run.** Real Relay state has never reached a
   `FWonderlandWorld` in a running engine, because there is no transport and no
   engine.

What *is* proven, by commands that ran in this environment: the TypeScript
projection's behaviour (98 tests), that the two sides' field and enum sets agree
and that the agreement check fails when either side is mutated (17 header
mutations), that the field manifests cannot drift from their interfaces (5 `tsc`
mutations), and that the behavioural rules fail when the code enforcing them is
changed (19 source mutations) — 41 in all. The full list is in the commit message.
