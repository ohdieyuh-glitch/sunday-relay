# Wonderland ↔ Unreal — the integration handoff

**Audience: the Wonderland World stream (Session 2).** This is written so you
never have to read Session 3's source to build the receiving side. Everything
below is either a contract you can import or a rule you can implement against.

**Status of the sending side:** the contracts exist, are tested and are
mirrored into `wonderland/Source/Wonderland/*.h`. **No live Julius mission has
ever driven any of it** — see "What is and is not real" at the end. Build
against this expecting real events later; do not describe it as connected.

---

## 0. THURSDAY: WHAT IS LEFT WHEN THE ENGINE ARRIVES

Read this first. Everything below it is the detail.

| | |
|---|---|
| BRANCH | `claude/julius-wonderland-integration-khaqs3`, continuing `relay/wonderland-integration` from `03fe982` |
| SHA | check `git log -1` — that is authoritative |
| WHAT HAS RUN LIVE | **nothing.** No provider call, no Julius mission, no Unreal build, no frame |
| OFFLINE PROOF | **1,019 executable C++ checks** across six harnesses, plus a 66-sample geometry fixture. See "The offline harnesses" below |

**The remaining work is compile, import, connect, display, drive, reconnect,
capture — not invent.** Every contract on this seam exists, is mirrored into
C++, is held by a test, and — as of 2026-09-10 — **is decoded and adopted by
real C++ that this repository compiles and runs**. What is missing is an engine
and one environment variable.

### Authorisation: BUILT. Read this before you assume otherwise.

An earlier revision of this document said a project-membership check was the
one thing not built. **It is built now**, and the shape matters to anyone
wiring a client:

| piece | where | what it is |
|---|---|---|
| the authority | `relay_wonderland.project_members` | already existed since migration 001, already used in production by `julius-tool-postgres.ts`. NOT a second membership model — reused |
| the domain | `wonderland-authorization.ts` | roles → capabilities. Holds no records and reaches nothing |
| the port | `WonderlandProjectMembershipSource` | one method, `lookup({playerId, projectId})` |
| the adapter | `wonderland-membership-postgres.ts` | the query, and it THROWS rather than returning null when it cannot answer |
| the route | `wonderland-julius-routes.ts` | asks per request, never caches into the session |

The properties a client can rely on, each held by a test:

- The player is explicit (the browser session) and the project is explicit (the
  query). **Nothing resolves a project FROM a run id** — the run is checked
  against the AUTHORISED project, never the other way round, because a run id
  is as attacker-controlled as a project id and resolving one from the other
  lets somebody pick the project they are then authorised against.
- A `projectId` in the query is **a request to be authorised, never an
  authorisation**.
- A missing run and a forbidden run give the **same** answer: 404, body
  `{"error":"permission denied"}`. No membership oracle, no project name.
- `null` from the port is a DENIAL (no such row). A port that *throws* is an
  authority that could not answer, and that is **503**, not 403 — reporting it
  as a denial sends an operator hunting permissions that were never the issue.
- An unrecognised role grants nothing. The column has no CHECK constraint, so a
  role the product starts writing before the capability table learns about it
  is denied rather than assumed.
- Changing project mid-stream re-authorises. Same session, same origin, same
  player — none of it carries a permission across a project boundary.

### The reader is built too, and the route is wired

`WonderlandJuliusReaderPostgres` (in `src/relay/persistence/`) implements the
two reads, and `server.ts` constructs it — with the membership source, from one
pool — when `DATABASE_URL` is set. **Both dependencies or neither**: a bridge
with membership and no reader answers 503 exactly like an unwired one, which is
the half-configured state that would later be "fixed" by relaxing a check
instead of supplying a reader, so the factory builds them together.

| method | what it does |
|---|---|
| `hydrate` | run state, `julius_runs.version`, `MAX(sequence)`, active tasks and pending approvals — **in ONE statement**, so all five describe the same instant |
| `events` | raw `WonderlandLedgerRow`s after a cursor plus the run's version, also one statement, anchored on the RUN and joining the events so the revision comes back even when the page is empty |

The activity fold is bounded by the position that same statement returned
(`sequence <= atSequence`), so the fold and the state describe one moment. It
covers the WHOLE run, not a window, because signals are raised AND cleared —
`context.compiled` raises `retrieving_context` and `worker.dispatched` clears
it — and a partial fold reports a signal that stopped being true an hour ago.

**What the hydration does not claim**, and each is a real limit rather than a
placeholder:

- **Usage draws UNKNOWN.** No authority attributes spend into the usage
  contract yet. Both meters, every figure.
- **No Project Brain is cited.** `julius_context_snapshots` holds almost
  exactly what a citation wants, but its kinds come from
  `julius_brain_entries.entry_kind`, whose vocabulary is NOT the citation's:
  `RESEARCH_NOTE` and `ACCEPTANCE_UPDATE` have no counterpart, and `OBJECTIVE`,
  `REQUIREMENT` and `EVIDENCE` have no source. Citing on the overlap alone
  would report a smaller retrieval than happened, as a fact. **Reconciling the
  two vocabularies is the next contract decision on this seam.**
- **The C.A.R.D. slots are NULL.** `julius_runs.card_revision` is free text
  with no foreign key and nothing in the persistence layer reads
  `card_versions`, so the revision crosses as a real opaque handle and the
  three slots say "nobody looked". `FWonderlandCardScope` now carries them as
  `FWonderlandFlag` rather than `bool` for exactly this: a zero-filled USTRUCT
  would have handed a renderer `false` — "the Coding Agent slot is empty" — for
  a run whose card nobody resolved.

### The one thing that is genuinely not built

**Nothing cloud-side.** The remaining uncertainty on this seam is ENGINE
EXECUTION: A–M below, none of which can be done without Unreal.

As of 2026-09-10 the hydration path is complete end to end — PostgreSQL →
reader → route → wire JSON → C++ decoder → subsystem adoption — and every link
is EXECUTED offline rather than described. The Project Brain kind vocabulary is
no longer an open decision: the kernel's vocabulary and the citation's differ,
an unrecognised kind is counted in the total and in no bucket, and the gap
between them is the signal. **One cloud-side decision remains and it does not
block A–M: an authority that reports usage.** Until there is one the meters draw
UNKNOWN, which is the true reading rather than a stub.

**One operator action remains, and it is not a code change:** set `DATABASE_URL`
on the Railway bridge. Without it `/wonderland/julius/*` answers 503, which is
correct rather than broken — see E below.

### The decode, which is BUILT — and how to run it

An earlier revision of this section said the decoder was unwritten. It is
written now: `WonderlandWireDecode.h/.cpp`, with its enum tables generated from
the same parity contract. **Read this before touching it**, because the shape of
the proof is unusual and deliberate.

| | |
|---|---|
| entry | `WonderlandDecodeDeliveryBytes` — an SSE `data:` payload, `{envelope, activity}` |
| also | `WonderlandDecodeEnvelopeBytes` for a bare envelope; the same reader underneath |
| usage | `WonderlandDecodeUsageBytes` — the HUD, for `UWonderlandUsageSubsystem::ApplyUsage` |
| **snapshot** | **`WonderlandDecodeHydrationBytes`** — what `/wonderland/julius/hydrate` answers, WHOLE: run, drawable state, both meters, the usage verdict, the folded activity, the Project Brain citation, the C.A.R.D. scope and the open human gates |
| framing | `WonderlandWireReadSseData` finds the data line; a heartbeat yields nothing, without erroring |
| run it | `npm run wonderland:wire:verify` — **327 checks over 146 generated fixtures** |

**The usage figures are the ones to be careful with.** Every one is
`{ bKnown, Value, Reason }`, and the production reading today is ALL UNKNOWN —
two tracks and no remainder, because no authority reports into the usage
contract yet. A decoder handing the widget `0.0` with `bKnown` false renders as
an empty meter, which is a claim that the founder has nothing left. Two
contradictions are refused rather than resolved: known-with-null, and
unknown-carrying-a-number. And the two meters are checked against their own
`channel`, because swapped they would draw real figures on the wrong arc.

**It parses its own JSON, and that is not an oversight.** A decoder built on
`FJsonObjectConverter` could not be executed in the environment that wrote it
and would have shipped unproven — and it would map by NAME, which is the one
thing this seam cannot do. The parser here is small, strict and dependency-free,
so the code that ships is the code the harness runs at -O0 and -O2 under ASan
and UBSan, with the two builds required to agree.

**Nothing is defaulted.** Thirteen named refusals cover malformed JSON, duplicate
keys, trailing content, wrong types, unknown tokens, non-finite and fractional
numbers, values past the exact-integer range, blank identity, and depth/size
ceilings. `false` is not unknown, `zero` is not unknown, `missing` is not
`empty`, and an empty string is a VALUE — each of those has a test. Identity is
validated before anything a subsystem could be handed.

**An unknown token is refused by name**, never left at ordinal 0. That is the
whole point: zero is `Unobserved` in every enum this reads, so a decoder that
fell back to it would make a broken client look like a silent Relay.

**The two halves of a delivery must agree about whose run it is.** Nothing
downstream compares them, so a delivery whose activity named another project
would push one run's signals onto another's world.

`wonderland/Tools/WireHarness/fixtures.tsv` and `deliveries.tsv` are GENERATED
by calling the real `wonderlandEnvelope()` and serialising it exactly as the
bridge does, then damaged one field at a time for the refusal cases. Every
visual state, every worker role and every activity signal has a fixture, so a
vocabulary that moves on one side is caught by name. Regenerate with
`npm run wonderland:wire:fixtures`; a TypeScript test holds them fresh.

### The two traps it closes, for anyone changing it

Neither announces itself, which is why the decoder is shaped the way it is:

**Absence.** TypeScript has `null`; Unreal's numerics, strings and bools do
not. Ninety fields cross as a value-or-`null` and land in a carrier —
`FWonderlandText`, `FWonderlandNumber`, `FWonderlandFlag`, each
`{ bKnown, Value }`. A decoder that maps by NAME alone leaves the carrier
zero-filled, and a zero-filled carrier reads as "Relay did not say" for a
figure Relay did say. Every real number silently becomes an unknown.

**Vocabulary.** Relay's tokens are `snake_case`, `SCREAMING_SNAKE`, and in one
case `SPACE SEPARATED`. Unreal's members are `PascalCase`. An unmatched token
leaves the ordinal at 0, and 0 in every nullable-mirroring enum here is
`Unobserved` — so a broken decoder produces a world that looks like Relay is
reporting nothing, which is the hardest possible symptom to diagnose with an
engine open and hours on the clock.

**`docs/handoffs/WONDERLAND_WIRE_CONTRACT.md` is the full mapping**: every
carrier field, every enum's token→member table, every struct that crosses. It
is GENERATED from the same parity tables that hold the headers, so it cannot
describe a seam the headers no longer have; `npm run wonderland:wire:check`
fails when it drifts. The decoder covers the ENVELOPE, the ACTIVITY READING, the
USAGE HUD **and the whole HYDRATION WRAPPER** — everything `ApplyEnvelope`,
`ApplyUsage` and `AdoptHydration` take. Nothing on this seam is left undecoded.

### The snapshot decoder, and the one thing to hold in mind

`WonderlandDecodeHydrationBytes` is ONE entry point rather than four calls you
compose, and that is deliberate: a hydration is adopted WHOLESALE — the run,
both meters, the activity, the citation, the C.A.R.D. and the gates replace
themselves in one act, and nothing arriving afterwards contradicts any of them.
So the cross-field agreement is decided BEFORE any of it is visible. Assembled
from parts, every part would decode cleanly and the assembly could still be a
mis-routed picture of somebody else's mission, with every number on it real.

Three things in it are worth knowing before you read the code:

- **`VisualState` and `bTerminal` are ON THE PAYLOAD.** `Run.State` is the
  KERNEL's word — one of thirteen — and what you DRAW is one of eleven. Do not
  map it yourself: that mapping is Relay's, an adapter may not own a mission
  verdict, and a second copy would agree until the day it did not. `bTerminal`
  cannot be recovered from the drawing either — `Blocked` and `Error` are drawn
  differently and only one is terminal.
- **`KindCounts` is INDEXED BY ORDINAL**, sized to `WonderlandBrainKindSlots`.
  `KindCounts[(int32)EWonderlandBrainKind::Finding]` is that kind's count with
  no arithmetic. Slot 0 is `Unobserved`, is not a kind, and stays zero. A kind
  the kernel learned and this build cannot name is counted in `EntryCount` and
  in NO bucket — the gap between them is the signal, not a bug.
- **`HumanGates` may be empty and may NOT be absent.** An empty list beside a
  KNOWN `Run.PendingApprovals` of zero is "nothing is gated"; the nullable
  count beside it is what carries "nobody counted".

### The Unreal proof checklist (A–M)

Nothing on this list can be done cloud-side. **Each item is a thing to SEE**,
and none of it may be described as done from a screenshot of a fixture. The
lettering matches the founder's evidence chain; the detail under each is what
this stream can tell you about it.

| | step | what proves it |
|---|---|---|
| **A** | the module compiles | `wonderland/Source/Wonderland/*` against real UE headers. Expect UHT to want `.generated.h` files that are one-line stubs here. Build log, zero errors |
| **B** | the widget compiles | `WonderlandUsageHudWidget.cpp` is **the only file on this seam never compiled against real UMG**. The Slate calls are the unproven part; the geometry underneath them is proven numerically (66 samples, worst deviation 1e-6) |
| **C** | the world launches | editor opens, PIE enters the hub, the Dog is the default pawn by construction (`AWonderlandHubGameMode`) |
| **D** | the transport connects | point the client at a running Bridge; SSE opens, the heartbeat arrives. The decode is BUILT — `WonderlandDecodeDeliveryBytes` — so this step is wiring a socket to it, not writing one |
| **E** | the project session authenticates | redeem a pairing grant, then call `/wonderland/julius/hydrate?projectId=…&runId=…`. **A 503 here means the reader is still unwired, not that you did it wrong** |
| **F** | a Julius mission runs | a real run, not a fixture. This is the first moment anything on this seam has been REAL |
| **G** | the dog animates from a phase | push envelopes through `UWonderlandJuliusSubsystem::ApplyEnvelope` and watch the clip follow the visual state |
| **H** | an accent rides on top | an activity reading with `AwaitingApproval` — the base clip must NOT change. Accent and phase are two axes and the second must not overwrite the first |
| **I** | both meters draw | top left, GREEN Compound outside, BLUE Single nested behind. A bigger tier is a **LONGER track**, not a differently-shaded one: push two `FWonderlandUsageHud`s with different `ReferenceCapacityUnits` and watch the arc's physical length change. A default one draws tracks with no remainder and **no zero** |
| **J** | disconnect and reconnect | drop the link mid-run and let Julius progress while it is down |
| **K** | rehydration is proven | `WonderlandDecodeHydrationBytes` then `UWonderlandJuliusSubsystem::AdoptHydration` — ONE call, not four — then replay the tail from `GetResumeAfterSequence()` and land on the right state **without replaying the transcript**. Watch the event count: a reconnect costs one hydration plus the events after `atSequence`, and a run with four thousand events must not cost four thousand deliveries. `AdoptHydration` returns FALSE when it refused; nothing is partly applied |
| **K2** | **a cold join draws, and a gated run says so** | hydrate a run that has already COMPLETED — it sends no further events, so this is the only thing that can ever draw it — and separately one with an open approval. The second must show the activity accent AND `GetHumanGates()` naming the operation C.A.R.D. gated. Both come from the hydration alone, with no envelope behind them |
| **L** | the three endings drive | COMPLETE, BLOCKED and ERROR each reached and drawn. Note that `blocked` is drawn by BOTH a resumable PAUSED run and a terminal CANCELLED one — `terminal` comes from the kernel, never from the picture |
| **M** | the evidence is captured | screenshots and video into `docs/relay/WONDERLAND_SLICE_EVIDENCE.md`, with hashes of the media files |

Two more that are cheap while the engine is in front of you:

- **A foreign push changes nothing.** Send another project's envelope and watch
  the counters move while the world does not.
- **The animation vocabulary holds.** Every accent is an INTENT
  (`awaiting_input`, `strained`, `reattempting`, `accompanied`, `recalling`) —
  if a renderer needed a word this seam does not have, that is a finding worth
  bringing back, not a thing to work around locally.

**Until A–M actually happen, every engine-facing claim in this repository
stays UNPROVEN, and this document says so in three places on purpose.**

### What to wire, in order

```
1. WonderlandProjectMembership          BUILT — WonderlandMembershipPostgres.
2. WonderlandJuliusReader               BUILT — WonderlandJuliusReaderPostgres.
3. server.ts                            WIRED — set DATABASE_URL on the bridge
                                        and both are constructed from one pool.
                                        Without it the route answers 503, which
                                        is the only safe thing an unconfigured
                                        authorisation can do.
4. UWonderlandJuliusSubsystem::BindProject
     then, ON JOIN OR RECONNECT:
       WonderlandDecodeHydrationBytes -> AdoptHydration   (one act; false = refused)
     then, PER EVENT:
       WonderlandDecodeDeliveryBytes  -> ApplyEnvelope
   AdoptSnapshot remains for a bare `inspectRun` answer and needs an embodiment
   you build; AdoptHydration does not, because the payload carries the drawable
   state.
5. UWonderlandUsageSubsystem::BindProject / ApplyUsage
     the hydration's `Usage` and `UsageStatus` are the same shapes ApplyUsage
     takes — decode once, feed both subsystems from the one payload.
6. bind the HUD widget to OnUsageChanged
7. read UWonderlandJuliusSubsystem::GetHumanGates() wherever a run can stop and
   ask. A worker never commands the user: Julius owns the gate and the resume,
   and this is the world REPORTING one, never requesting it.
```

### The offline harnesses, and what each one already proves

Run all of these before you conclude the engine broke something. Every one
COMPILES AND EXECUTES the real C++ at -O0 and -O2 under ASan/UBSan, and the two
builds are required to agree:

| command | proves | checks |
|---|---|---|
| `npm run wonderland:cpp:syntax` | every source file parses | per-file, against a baseline |
| `npm run wonderland:wire:verify` | the whole decoder, over fixtures the server generated | 327 |
| `npm run wonderland:julius:verify` | the run subsystem: ordering, reconnect, adoption, project switch | 90 |
| `npm run wonderland:usage:verify` | the usage subsystem: refusals, held state, snapshot adoption | 152 |
| `npm run wonderland:ordering:verify` | the ordering rule, replayed from a TypeScript-generated table | 450 over 26 cases |
| `npm run wonderland:geometry:verify` | the HUD sampler against the TypeScript, numerically | 66 samples, worst 1e-6 |

**1,019 executable checks, plus the geometry fixture.** If one of these fails
after you touch a header, the header moved and the generated artefact did not:
`npm run wonderland:wire:export`, `:wire:fixtures`, `:geometry:export`,
`:ordering:export` regenerate them, and a TypeScript test holds each fresh.

---

## 1. The event schema

One shape crosses the boundary: `WonderlandEnvelope`, in
`src/relay/mission/wonderland/wonderland-envelope.ts`.

| field | type | note |
|---|---|---|
| `schemaVersion` | `'relay-wonderland-envelope.v1'` | bump = breaking change |
| `eventId` | string | stable; the same delivery twice carries the same id |
| `projectId` | string | **the only never-null identifier** |
| `worldSessionId` | string \| null | the viewing session |
| `juliusInstanceId` | string \| null | WHICH Julius |
| `missionId` | string \| null | |
| `runId` | string \| null | the ordering scope — see §4 |
| `taskId` | string \| null | |
| `workerRole` | enum \| null | see below |
| `state` | `JuliusVisualState` | one of 11, see §2 |
| `stateSource` | enum | `julius_run_state` \| `relay_phase` \| `event_type` |
| `sourceState` | string \| null | the upstream word, so the collapse loses nothing |
| `terminal` | boolean | set only by a real ending |
| `sequence` | number | per **run**, monotonic |
| `revision` | number | `julius_runs.version`, per run |
| `occurredAt` | ISO string | |
| `metadata` | `Record<string, string\|number\|boolean\|null>` | sanitised, bounded |
| `metadataDropped` | number | entries removed; never what they were |

**`workerRole`** is `PROMPT_ARCHITECT` \| `CODING_AGENT` \| `INDEPENDENT_REVIEWER`
\| `SPECIALIST` \| null. The first three are derived from Julius's own
`JULIUS_DEFAULT_ROLES`. A specialist's run-time NAME never crosses — Julius
names specialists freely and letting the name through would make it a de-facto
vocabulary.

**Nothing else crosses.** `metadata` admits primitives only, ≤120 chars per
string, ≤16 entries, with secret-shaped keys dropped. A prompt, a completion, a
stack trace and an API key are structurally unable to travel. **Do not add a
field for provider output.**

---

## 2. The state enum

`JuliusVisualState`, 11 members, mirrored as `EWonderlandJuliusState` in
`WonderlandJuliusState.h` with `Unobserved` at ordinal 0:

`idle` · `attention` · `prompt_architect` · `coding` · `handoff` ·
`independent_review` · `repair` · `verifying` · `complete` · `blocked` · `error`

**Ordinal 0 is `Unobserved`, not `Idle`.** A zero-filled struct means Relay has
not spoken. Never render it as an idle agent.

Each maps to exactly one `EWonderlandDogActivity` (a bijection), then to one
motion, then to one clip. `WonderlandAnimationForJuliusState` composes the
chain — do not add a fourth table.

---

## 2b. The second axis — WHAT ELSE IS TRUE

`EWonderlandJuliusState` answers "which phase", and there is exactly one answer:
a run is coding or reviewing or repairing, never two. **That is not enough to
describe a run**, and the directive is explicit that the answer must not collapse
into one loading boolean. A Coding Agent can be retrying while a subagent swarm
runs and an approval sits open, and a vocabulary with room for one of those would
have to pick — with the pick made by whichever event arrived last.

So there is a second, orthogonal vocabulary. `FWonderlandActivityReading` carries
a SET, not a value.

| signal | raised by | cleared by |
|---|---|---|
| `AwaitingApproval` | `approval.requested` | `approval.decided` |
| `ProviderDegraded` | `provider.failure` | `worker.completed` |
| `Recovering` | `recovery.action` | `worker.completed`, `task.claimed` |
| `Retrying` | `retry.scheduled` | `worker.dispatched`, `worker.completed` |
| `SwitchingWorker` | `reroute.selected`, `fallback.selected` | `worker.dispatched` |
| `Swarming` | `subagent.spawned` | the COUNT reaching zero |
| `RetrievingContext` | `context.compiled` | `worker.dispatched` |

Rules a receiver must not break:

- **Signals are raised and cleared by events and by nothing else.** No signal
  expires on a timer or a guess. One stuck on is a stream that stopped — a fact
  worth seeing, not one to tidy away.
- **An empty set means NOTHING WAS REPORTED**, never that the run is calm.
  `Idle` is a visual STATE and is a different claim.
- **`Swarming` follows the count, not the last event.** Two subagents spawning
  and one completing leaves one running.
- **A run that ends keeps its signals.** A run that completed with an approval
  outstanding still had one outstanding.
- **`ProviderDegraded` is not `Error`.** A provider failed and the run carried
  on; the visual state says whether it stopped.
- Signals are collected **per worker as well as per run**, so three concurrent
  Compound clones are three entries. Nothing assumes one agent.

### What the founder asked to see that Julius does not yet say

Recorded in `JULIUS_ACTIVITY_NOT_YET_EMITTED`, and **do not render these**: a
signal derived from something that does not mean it — "the run is coding, so it
is probably using a tool" — is indistinguishable from knowledge until the guess
is wrong in front of the founder.

| asked for | why it cannot be shown | what would fix it |
|---|---|---|
| tool usage | no event reports a tool call at all. `worker.dispatched` and `worker.completed` bracket the work and everything between is silent | a tool-level event pair |
| research | nothing reports a worker reading outside the workspace | the same tool-level events |
| interpreting | nothing marks the gap between a mission arriving and a worker being selected; a run queued behind another would render as interpreting for as long as it waited | an explicit event |
| planning | the Prompt Architect phase is visible; nothing distinguishes planning from having planned | an `architect.planning` / `architect.planned` pair |
| Project Brain vs memory | `context.compiled` says context was assembled, not from where | a fact on the existing event naming the source — no new type needed |

That table is the ask for whoever owns the kernel. It is not something this layer
can supply, and a test fails if an entry is listed as missing while a signal
covers it.

---

## 3. Legal transitions

`JULIUS_VISUAL_TRANSITIONS` in `wonderland-visual-transitions.ts` is **derived
from Julius's own guard**, not declared. The rules you can rely on:

- `complete` → nothing. `error` → nothing.
- **`blocked` → `complete` is NOT reachable.** A blocked run must be observed
  recovering (→ `coding`, `repair` or `handoff`) and then verified.
- No kernel state maps to `idle` at all. A Julius *run* is never idle; a
  *mission* is. `idle` arrives only from the Relay phase `ready`.
- `repair` is its own state, so a repaired run never looks like one that never
  failed.

**Only readings whose `stateSource` is `julius_run_state` are held to that
table.** The other two sources are coarser and legitimately produce e.g. `error`
mid-run without the kernel being FAILED.

Two rules hold at every source and you should implement them too, as belt and
braces: nothing un-completes a completed mission, and a second *different*
ending never replaces the first.

---

## 4. Ordering — read this before writing a receiver

**`sequence` is per RUN, not per project.** `stream_id` is the run id on every
Julius write path, so two runs in one project both count 1, 2, 3. **A
project-wide cursor is wrong**, not merely imprecise.

Two axes, and neither subsumes the other:

- `sequence` orders **events** within one run.
- `revision` orders **states**. Several events share one revision; a snapshot
  carries a revision and no sequence at all.

`wonderlandOrderingVerdict` checks in this order, and the order matters:

1. `foreign_project` — another world. Not late, misrouted.
2. `foreign_julius` — a different Julius instance. Never merge two streams.
3. `foreign_run` — a run this cursor is not following.
4. `malformed` — unusable sequence/revision/eventId.
5. `duplicate` — the same `eventId` again.
6. `stale_revision` — **checked before sequence.** A stale replica can deliver
   an event whose sequence is genuinely ahead on its own stream while the run
   has moved on; the sequence check alone would accept it and the world would go
   backwards.
7. `stale_sequence`.

Count each refusal **separately**. Forty stale sequences is a chatty replay and
is fine; one `foreign_project` is a routing bug and is not.

---

## 5. Rehydration — joining mid-mission

Take the **snapshot first**, then replay. Never the other way round.

1. `inspectRun` → state + `revision`. **Set** the visual state from it. Do not
   replay the transitions that led there; they happened while nobody was
   watching and performing them now is theatre presented as observation.
2. Then ask the timeline for **everything** (`afterSequence: 0`). A snapshot has
   no sequence, so any other cursor would either skip events or claim to have
   applied events never seen.

That full replay is safe **because** every event carries its revision and
anything below the snapshot's is refused. The world holds COMPLETE and watches
its whole history arrive without moving.

**One subtlety you must implement:** an event at the snapshot's *own* revision
is also stale. A snapshot is the run's row at that revision and is strictly
newer than any event of its generation. Without this, a replayed revision-6
CODING event overwrites a COMPLETE recovered at revision 6. Two *events* at one
revision are peers; a snapshot outranks its generation. `revisionFromSnapshot`
on the cursor carries this, and an accepted event clears it.

---

## 5b. PROJECT BRAIN — WHAT YOU MAY KNOW, AND WHAT YOU MAY NOT

**The client is not the database of record.** A `JuliusBrainEntry` carries free
TEXT and a sensitivity of PUBLIC, INTERNAL or SECRET. Relay filters SECRET out
and redacts key-shaped substrings, and what survives is still the substance of
somebody's work — objectives, constraints, decisions, findings. A game client is
the wrong place for it: the least trusted process in the system, the one a
player can attach a debugger to, and the one with no business holding the copy
that outlives the run.

**So no text crosses.** Not truncated, not summarised, not "just the
objectives". `FWonderlandBrainCitation` carries counts, revisions and flags:

| field | what it tells you |
|---|---|
| `BrainRevision` | which revision the context came from — "it read the brief" and "it read the brief three revisions ago" differ |
| `EntryCount` | how many entries reached the packet. Not which |
| `KindCounts` | per kind, all nine present, so a zero is a REPORTED zero |
| `CharacterCount` | a size, never the characters |
| `RedactionCount` | something was removed, and how much. Never what |
| `bTruncated` | the budget cut it short: a worker that did not see everything, and a candidate explanation for whatever happens next |
| `ContentHash` | opaque, and useful because it is — two retrievals with the same hash read the same thing |

Rules a receiver must not break:

- **`ContentHash` empty means NOBODY REPORTED.** A citation is mostly zeroes, so
  this is the field that tells "a retrieval found nothing" from "no retrieval was
  ever reported". Check it before rendering "0 entries".
- **An entry of a kind you do not know is counted in `EntryCount` and in no
  bucket.** The disagreement between the total and the sum of the buckets is the
  signal that the kernel's vocabulary moved — do not paper over it.
- **Do not add a field.** The narrowness is the guarantee, and it is checked from
  both ends: the parity table holds the field list, and a TypeScript test
  compiles a real packet from entries whose text is a canary and asserts the
  canary appears nowhere in the citation.

**Sensitivity is deliberately absent.** Reporting "this retrieval touched SECRET
material" would tell anyone watching the world that secret material exists and
roughly when it is read, which is most of what a side channel is worth.
`RedactionCount` covers the honest need without naming the class of thing.

**Bounded by construction**, which §13 requires: the shape is O(kinds), so a
brain with a million entries produces the same struct as one with three. There
is no HUD change that can pull a payload across, because there is no payload.

---

## 6. Transport

Use the smallest seam that exists; do not build a second one.

- `GET /wonderland/events` (`relay-bridge/wonderland-routes.ts`) — SSE,
  `?projectId&cursor`, replays then subscribes, `id: <sequence>` per frame.
- **There are no Julius HTTP routes on the bridge.** `JuliusRuntimeApi` is not
  mounted anywhere. Snapshot access needs that route to be added — it is not
  yours or mine unilaterally; raise it with the Julius stream.
- **The replay query does not filter `event_type`.** Julius rows land in the
  same table prefixed `julius.`. Use `readWonderlandLedgerBatch`
  (`wonderland-ledger-adapter.ts`) — it refuses non-Julius rows by default and
  handles **both** persisted payload shapes. Reading the rows directly will
  silently lose run-state precision; see §9.

Reconnect backoff: double from 1s to a 30s ceiling, no jitter
(`wonderlandReconnectDelayMs`).

---

## 6b. THE PATH, END TO END — what carries what, and who owns it

Added the session a Julius event first became an envelope. Before it, the chain
was built from both ends and never joined: `wonderlandEnvelope()` had NO
production caller, so every layer below was waiting for events nothing produced.

```
relay_wonderland.events row
  │   readWonderlandLedgerRow           row → JuliusOperationalEvent
  │                                     handles BOTH persisted payload shapes
  ▼
JuliusOperationalEvent
  │   ingestWonderlandRows              THE TRANSPORT BOUNDARY
  │     ├─ SCOPE     is this session granted this project's run?
  │     ├─ DECODE    readable as a Julius event?
  │     ├─ VALIDATE  produceWonderlandEnvelope → phase, or a named refusal
  │     ├─ ORDER     applyWonderlandOrdering → revision then sequence
  │     └─ FOLD      wonderlandJuliusActivity → the second axis
  ▼
WonderlandDelivery { envelope, activity }
  │   GET /wonderland/julius/events     SSE, replay-from-cursor, heartbeat
  ▼
UWonderlandJuliusSubsystem::ApplyEnvelope(envelope, embodiment, activity)
```

and, once on join and once per reconnect:

```
JuliusRunView + usage authority + brain citation + C.A.R.D. record
  │   wonderlandHydration               assembles and NARROWS. Computes nothing
  ▼
WonderlandHydration
  │   GET /wonderland/julius/hydrate
  ▼
UWonderlandJuliusSubsystem::AdoptSnapshot   sets revision AND position
UWonderlandUsageSubsystem::ApplyUsage       the meters, already projected
```

### Two shapes, and why usage is not on the envelope

**INCREMENTAL** is the envelope: one event, lean, ordered by sequence, carrying
a phase and its identity and nothing more, because it arrives constantly and
anything on it is paid for every time.

**SNAPSHOT** is the hydration: usage, Project Brain, C.A.R.D. and activity, sent
once on join and once per reconnect. Capacity does not change per event — a
meter reading on every transition would send the same two numbers thousands of
times and still be stale in between, because usage moves on its own schedule.

### The defect this session found, because it matters for reconnect

**Only a state TRANSITION bumps `julius_runs.version`.** `review.started`,
`finding.recorded` and both subagent writers do not — verified in the
persistence layer. So a snapshot at revision 10 and a burst of genuinely new
review activity, also at revision 10 because the run's state had not moved,
collided: the revision tie-break refused every one and **the world went deaf
until the run happened to change state.**

`WonderlandRunSnapshot.atSequence` closes it. With a position the cursor moves
there and everything at or before it is refused on SEQUENCE — precise, because
a pre-snapshot replay is behind and new work is ahead whatever the revision is.
Without one the conservative tie-break stands, which refuses some genuinely new
events and is the safer error when position is unknown.

**A reader must therefore read `MAX(sequence)` in the same pass as the run row.**
A revision from one moment and a sequence from another describe a run that never
existed.

---

## 7. Animation intents

`planWonderlandAnimation` (`wonderland-julius-animation.ts`) returns a
`WonderlandAnimationPlan`, mirrored as `FWonderlandAnimationPlan`:

| transition | blend | when |
|---|---|---|
| `Hold` | 0 | same clip — **do not restart it** |
| `Wake` | 260ms | from `Dormant` |
| `CrossFade` | 180ms | ordinary work → work |
| `Interrupt` | **0 — a cut** | a state that needs a human |
| `Settle` | 420ms | into a real ending |
| `Dormant` | 520ms | back to no observation |

**The one rule that is not aesthetic: a state that needs a human CUTS.** A
failure that is also an ending still cuts — the person outranks the ceremony.
Ordinal 0 is `Hold`, so a zero-filled plan says "keep playing".

Eleven states need **nine clips plus `dormant`** — ten slots total
(`WONDERLAND_REQUIRED_CLIPS`). There is no smaller honest first set: a state
shown by a clip that means something else is worse than a placeholder.
`attention`, `verifying` and `complete` all share `stand_still`, which is why
`terminal` and `attentionRequired` travel *with* the plan and must not be read
off the clip.

---

## 8. HUD bindings — THE GEOMETRY IS FROZEN, AND THE HUD IS BUILT

**This HUD is an Unreal surface. It is mounted on no web page.** Both meters
report what a Compound Agent is spending *while it works*, so they live where
the work happens. The website's landing is an arrival and its Relay stage is
where an agent is named before it has done anything; a meter on either would be
furniture. The React component in `src/relay/ui/wonderland-hud/` exists only as
the REFERENCE rendering — it pins the geometry by digest and drives the preview
harness (`npm run wonderland:hud:preview`), and
`wonderland-hud-placement.test.tsx` fails if any production surface mounts it.

**The Unreal side now exists.** What is in the client, and what each piece is:

| file | what it is |
|---|---|
| `WonderlandUsageGeometry.h/.cpp` | the arc-length poly-Bézier sampler, the draw plan, the ribbon strip, the band builder |
| `WonderlandUsageGeometry.canonical.cpp` | **GENERATED** — the control points, the palette in linear, the viewport crop |
| `WonderlandUsageGeometry.golden.tsv` | **GENERATED** — 66 samples of the TypeScript sampler |
| `WonderlandUsageSubsystem.h/.cpp` | the GameInstance subsystem that holds the reading. The only authoritative client-side state |
| `WonderlandUsageHudWidget.h/.cpp` | the `UUserWidget` that paints both meters. Owns nothing |
| `WonderlandOrdering.h/.cpp` | the ordering rule — **the one thing that had to be written twice** |
| `WonderlandOrdering.cases.cpp` | **GENERATED** — what the real TypeScript rule did over a matrix of cursors and envelopes |
| `WonderlandJuliusSubsystem.h/.cpp` | the cursor, the embodiment and the activity. Holds the stream; owns no reduction |

Regenerate the two generated files with `npm run wonderland:geometry:export`;
`npm run wonderland:geometry:check` fails when they are stale. **Never hand-edit
them** — the control points are founder-frozen and digest-pinned on the
TypeScript side, so a hand-kept copy would drift while that digest went on
passing.

Three commands verify it without an engine, and it is worth knowing what each
one does and does not claim:

| command | proves | does not prove |
|---|---|---|
| `wonderland:cpp:syntax` | every header and translation unit parses | that anything behaves |
| `wonderland:geometry:verify` | the C++ sampler computes the same curve as the TypeScript, to 1e-4 (observed 1e-6) | that a widget draws |
| `wonderland:usage:verify` | 152 checks over the usage subsystem's refusals, the draw plan, the bands and the composition | that a widget draws |
| `wonderland:ordering:verify` | the C++ ordering rule against 26 cases generated from the real TypeScript — 450 checks over the verdict AND the whole folded cursor | anything about transport |
| `wonderland:julius:verify` | 61 checks over the run subsystem: snapshot adoption in both modes, the tail replay after a reconnect, a dropped link, a project switch | anything about transport |

**The ordering rule is the one piece a client genuinely re-implements**, because
only the receiver can decide which of several envelopes arriving over a real
network to apply — Relay is not in the process. So it is held to the TypeScript
numerically rather than by review: `WonderlandOrdering.cases.cpp` is generated by
RUNNING `applyWonderlandOrdering` over a matrix, and the C++ is replayed through
every case. Regenerate with `npm run wonderland:ordering:export`;
`wonderland:ordering:check` fails when it is stale, and a diff in that file is a
change to how a world decides what it has seen — **read it before committing it**.

**The Slate calls in `WonderlandUsageHudWidget.cpp` are proven by nothing.**
There is no Unreal Engine in this repository; that file has never been compiled
against real UMG headers or seen to put a pixel on a screen. It is the part that
still needs you.


The founder has settled the usage HUD and declared it permanent. **Do not
redesign it, do not reintroduce the crossing variant, do not change its
geometry.** `wonderland-hud-canon.test.ts` pins every control point by digest.

- GREEN = Compound AI Agent. BLUE = single agent. Top-left.
- Green is the outer ring/swoop; blue is the concentric inner hook at ~⅔ radius.
- **Zero overlap, zero occlusion.** Blue is readable across its whole range.
- Tail rises to the right. Viewport `{x:0, y:0.06, w:1, h:0.88}`, derived from
  the measured extent of both strokes.

Data bindings per channel: `current` (the **remainder**, never the spend),
`maximum`, `reference` (per-channel ladder ceiling), `tierId`, `tierLabel`,
`unitLabel`. Readings: `not_reported` (ordinal 0) · `known` · `stale` ·
`unavailable`.

**UNKNOWN IS NOT ZERO.** Every figure is a carrier (`known`/`value`/`reason`),
never a bare number. Never draw a missing authority as an empty valid meter.

Accounting rule (`wonderland-usage-accounting.ts`): **attribution follows the
orchestrator, not the worker.** Every worker slot's spend inside a run is
COMPOUND. An agent working alone is SINGLE. Anything unattributable is reported
and never assigned, and makes the account `partial` — in which case **both**
channels read UNKNOWN rather than showing subtotals whose meaning depends on
what was left out.

---

## 8b. WHO IS AUTHORITATIVE FOR WHAT

The one table to read before adding a field anywhere. Every row names the system
that DECIDES the thing; everything downstream of it holds a copy and may not
argue with it.

| the fact | decided by | held by | never decided by |
|---|---|---|---|
| units spent | Julius / the usage authority | the subsystem's `FWonderlandUsageHud` | the client, the widget, a fixture |
| capacity for this tier | the usage authority | same | the client |
| subscription-tier maximum (`ReferenceCapacityUnits`) | the usage authority | same | the client — it is a billing fact, not a display constant |
| how much to believe the figures (`Reading`) | the usage authority | `FWonderlandUsageAuthorityStatus`, verbatim | the client. A dropped link is reported in the LINK status beside it, never by editing this |
| whether this client's socket is alive | **the client** | `FWonderlandLinkStatus` | Relay — it cannot see the world's socket |
| which reading this client currently holds | **the client** | the subsystem's revision + counters | Relay — pushes arrive out of order and only the receiver knows what it has |
| mission state | the Julius kernel's guarded machine | `FWonderlandJuliusEmbodiment.VisualState` | the world. A renderer may not move a run |
| which visual state a mission state maps to | `wonderland-julius-state.ts`, derived from the kernel | same | the widget |
| Compound Agent state / Single Agent state | Julius | the embodiment | the HUD. The meters report SPEND, not activity |
| the active agent | Julius | the embodiment's `AgentId` | the client, which must render `Unknown` when none travelled |
| the curve, the palette, the crop | the contract (`wonderland-usage-meter.ts`) | generated into `WonderlandUsageGeometry.canonical.cpp` | either renderer |
| the arithmetic from a reading to arcs | `wonderlandMeterDrawPlan`, mirrored as `WonderlandMeterDrawPlan` | both renderers, identically | either renderer alone |
| where the two meters sit relative to each other | the palette's `Emphasis` | both renderers | a Z-order or a canvas ordering |

### The chain, end to end

```
Julius kernel                    run state, revision, operational events
  │                              julius-runtime-api.ts · julius-state-path.ts
  ▼
integration layer (pure TS)      normalize → order → rehydrate → visual state
  │                              wonderland-{normalizer,ordering,rehydration,
  │                              visual-transitions,session}.ts
  │                              usage: wonderland-usage-authority.ts projects
  │                              the meters and says how current they are
  ▼
envelope                         wonderland-envelope.ts — the ONLY shape that
  │                              crosses. No provider payload ever does
  ▼
transport                        the Bridge. See §6
  ▼
UWonderlandUsageSubsystem        RUNTIME STATE. Accepts or refuses the push,
  │                              holds one reading, counts what it refused,
  │                              broadcasts on change. Owns no arithmetic
  ▼
WonderlandMeterDrawPlan          the mirrored arithmetic: reading → arcs
  │
  ▼
WonderlandBuildMeterBands        arcs → unit-space vertex strips
  │
  ▼
UWonderlandUsageHudWidget        PRESENTATION. Scales to the widget, paints,
                                 decides nothing, keeps nothing
```

Read it as a one-way street. Nothing below a line may write to anything above
it, and the two places that could be tempted are the two the rules name
loudest: the widget may not hold a figure, and the client may not edit the
authority's verdict about its own numbers.

### What the layering means for /MAS

The swarm is not built and this document does not describe it. What matters
here is that nothing above **forecloses** it:

- Usage attribution already distinguishes `compound_orchestrated` from
  `single_agent`, and the rule is that attribution follows the ORCHESTRATOR.
  Two or three Compound clones spending under one primary all land in the
  Compound channel without a contract change.
- `EWonderlandWorkerRole` carries a `Specialist` token rather than a fixed list,
  so a spawned specialist has a slot the day it exists.
- The subsystem is keyed by PROJECT, not by agent, so more than one active
  agent inside a project needs no re-binding.

What would foreclose it, and is therefore not done anywhere: collapsing agent
activity into a single boolean, keying runtime state by "the" agent, or letting
the HUD assume exactly one worker.

---

## 9. Failure behaviour you must reproduce

| situation | required behaviour |
|---|---|
| duplicate event | refused, counted, state unchanged |
| late / out-of-order | refused on sequence, counted |
| stale replica ahead on sequence | refused on **revision** |
| wrong project / run / Julius | refused, counted **separately** |
| unknown event type | ignored, counted; never rendered |
| disconnect mid-CODING/REVIEW/REPAIR | state unchanged, `terminal` unchanged, usage figures unchanged, cursor unchanged. **A disconnection is never a completion.** |
| reconnect after COMPLETE | recover COMPLETE; replay moves nothing |
| usage source stale | `stale` + last-reported figures, labelled |
| usage source unavailable | `unavailable` + the reason; figures UNKNOWN |
| blocked / error | never silently become COMPLETE |

---

## 10. Acceptance tests

The sending side's suites are the specification. Mirror their intent:

| suite | proves |
|---|---|
| `wonderland-envelope.test.ts` | no provider payload can cross |
| `wonderland-ordering.test.ts` | a stale CODING event cannot overwrite COMPLETE |
| `wonderland-rehydration.test.ts` | reconnect-after-COMPLETE replays nothing |
| `wonderland-visual-transitions.test.ts` | `blocked`/`error` never reach `complete` |
| `wonderland-usage-accounting.test.ts` | the arithmetic closes; partial ⇒ UNKNOWN |
| `wonderland-ledger-adapter.test.ts` | both persisted payload shapes read correctly |
| `wonderland-hud-canon.test.ts` | the frozen geometry, by digest |
| `wonderland-cpp-parity.test.ts` | every struct and enum, bidirectionally |

`wonderland-cpp-parity.test.ts` walks the real `.h` files, so **a field you add
on the C++ side without a TypeScript counterpart fails the suite**, and vice
versa. That is deliberate: it is how the two sides stay honest without a
meeting.

---

## 10b. The composed fold — start here

`wonderland-session.ts` is the one place the layers compose, and a receiver
should mirror its shape rather than re-composing them differently.

```
openWonderlandSession({ projectId })
  → recoverWonderlandSession(session, snapshot)   // sets the state, no plan
  → applyWonderlandEnvelope(session, envelope)    // ordering → legality → plan
```

`applyWonderlandEnvelope` returns `{ session, ordering, legality, plan, reason }`.

- `plan` is **null** when nothing was applied — not a `hold`. A hold is a real
  instruction ("keep playing, do not restart"); returning one for a refused
  event would say a decision was made about it.
- Recovery returns **no plan** either: arriving at a state you were never
  watching is not a transition, and a `wake` into the middle of a mission would
  perform an entrance that never happened. Show the clip; do not play into it.
- A refusal at any stage leaves the visual state exactly where it was.

**Two paths that are not what you would guess**, both enforced by the derived
table:

- `prompt_architect → coding` is **not** a move. Planning hands off first
  (PLANNING → READY → EXECUTING), so the real path passes through `handoff`.
- `coding → complete` is **not** a move. Verification stands between them.

And one consequence worth knowing before you tune blends: **`settle` never fires
on a kernel-path completion.** `complete`'s only kernel predecessor is
VERIFYING, and both draw `stand_still`, so the plan holds. The ending is told by
the readout and `terminal`, not by the body.

---

## 11. Recorded-real samples

**None exist.** No real Julius event has ever been captured
(`wonderland-evidence.ts` enforces this: `verifyWonderlandCapture` cannot return
`real` for any input, by construction).

The machinery to grade one is built and waiting. When a live run happens,
`wonderlandCapture({ origin: 'recorded_from_live_run', sourceRunId,
capturedAtIso, events })` produces a capture that can be graded. **A capture
claiming a live origin without both a run id and a capture time is silently
downgraded to `synthesised`** — at construction, so a file on disk cannot sit
there lying.

Until then, the only Julius event stream in the repository is
`WONDERLAND_JULIUS_DEV_SCRIPT`, hard-labelled `DEVELOPMENT FIXTURE · NOT A
MISSION`.

---

## What is and is not real

| level | what is at it |
|---|---|
| REAL — a live run drove the world | **nothing** |
| RECORDED-EVENT VERIFIED | **nothing** — no capture has ever been taken |
| INTEGRATION-READY | the envelope, ordering, rehydration, state machine, ledger adapter, accounting, animation plan, entry contract, HUD contract |
| BUILT AND VERIFIED WITHOUT AN ENGINE | the usage geometry, both subsystems, the draw plan, the bands, the composition, the ordering rule — 663 C++ checks (152 usage + 61 run + 450 ordering), a 66-sample geometry fixture and a 26-case ordering table, both generated from the TypeScript |
| BUILT AND VERIFIED IN TYPESCRIPT | the envelope producer, the hydration snapshot, the ingress boundary, the Julius routes, the activity→animation contract and the world-session binding — every one mutation-verified |
| BUILT AND WAITING ON ONE PORT | `/wonderland/julius/hydrate` and `/wonderland/julius/events`. They answer 503 until a project-membership check exists, which is the only safe thing an unconfigured authorisation can do |
| BUILT AND UNVERIFIED | the Slate paint in `WonderlandUsageHudWidget.cpp`. It parses; nothing here can run it |
| SIMULATED | the dev script |
| NOT BUILT | a world-snapshot route, the dog renderer, the swarm, every widget other than the usage HUD |

**Do not describe this as "Julius is connected."** The usage receiver now
exists and is tested; nothing has ever been sent to it, no provider call has
ever been made, and no real Julius event has ever been captured. The sending
side is ready for events it has never seen, and the receiving side is ready for
a push it has never had.

---

## 12. C.A.R.D., and the word it replaced

**C.A.R.D. is the vocabulary. Never PSP.** All new integration work uses it,
and `wonderland-card-vocabulary.test.ts` enforces that the Wonderland layer and
the Unreal client stay clean — a build failure, not a review comment.

The historical surface — `src/relay/psp/`,
`src/relay/ui/psp-import/` and their callers — predates the rename, is
load-bearing, and is **deliberately not renamed**: it would touch persisted
formats, boundary allowlists and a UI import flow for no behavioural gain. The
same test holds it at a counted ceiling so the old surface cannot grow, and the
ceiling is meant to be lowered whenever something legitimately migrates. Four
prose occurrences inside the new layer were migrated when the gate went in;
what remains is identifiers and paths.
