# Marble — World Labs as an optional Wonderland environment generator

**Status: SPECIFIED and IMPLEMENTED. Not compiled into Unreal, not rendered,
not streamed, not proven.** 47 unit tests pass. A passing unit test says the
domain behaves as designed; it says nothing about whether a Marble world has
ever appeared in Wonderland, because none has.

---

## Three owners, one boundary

| | owns |
|---|---|
| **Relay** | C.A.R.D.s, Compound Agents, Projects, Project Brain, missions, permissions, generation requests, provenance, verification, durable state |
| **Unreal 5.8** | gameplay, Relay Dogs, movement, collision, cameras, multiplayer, Niagara, lighting, Pixel Streaming |
| **Marble** | generated environment appearance, world generation, reference-style lifting, landscape/architecture, optional Project Realm environments |

**Marble is never the source of truth for Relay state.** A generated world is an
artifact Relay recorded — it carries what was asked for, what was approved, and
what came back, and Relay can be re-derived without it.

The authored Wonderland layout stays authoritative for landmark placement, the
hero camera, player spawn, the Relay Dog and anything traversable. Marble adds
richness *around* that structure. `decideRegionBinding` refuses a binding that
would displace any anchor the region declares authoritative.

---

## Where the code is

`src/relay/mission/marble/` — pure domain, matching the repository's rule that
domain modules have no Node, no network and no clock.

| file | holds |
|---|---|
| `marble-contracts.ts` | World Labs wire types + Relay's own types and events |
| `marble-operations.ts` | state machine, dedupe, validation, manifest reading |
| `marble-gate.ts` | feature flag, approval, concurrency, secret hygiene |
| `marble-provider.ts` | the provider seam + the non-billable mock |
| `marble-region.ts` | region binding, the renderer seam, import staging |

The HTTP client is deliberately **not** here. Adapters may not import
`/mission`, so the domain declares `MarbleProvider` and a connector implements
it, wired by a composition root. That also keeps the credential out of any
module the browser can reach.

Not re-exported through `src/relay/mission/index.ts` — that barrel is reachable
from the browser entry point, and this module names credential-adjacent
concepts.

---

## API surface — transcribed, not invented

From the official documentation at `docs.worldlabs.ai/api`, read 2026-08-19:

- Base `https://api.worldlabs.ai`, auth header `WLT-Api-Key`
- `POST /marble/v1/worlds:generate` — `display_name`, `model`, `world_prompt`
  (`type` ∈ text | image | multi-image | video)
- `GET /marble/v1/operations/{operation_id}` — `operation_id`, `done`, `error`,
  `metadata.world_id`, `metadata.progress.status` ∈ `IN_PROGRESS` | `SUCCEEDED`,
  `response.world`
- `GET /marble/v1/worlds/{world_id}` — `assets.splats.spz_urls` keyed
  `100k`/`500k`/`full_res`, `assets.splats.semantics_metadata`
  (`metric_scale_factor`, `ground_plane_offset`), `assets.mesh.collider_mesh_url`,
  `assets.imagery.pano_url`, `assets.thumbnail_url`, `assets.caption`
- `POST /marble/v1/worlds/{id}:export` — `{asset_type, format}`
- `POST /marble/v1/media-assets:prepare_upload`

Models: `marble-1.1`, `marble-1.1-plus`.

Every asset field is modelled **optional**. A world with no collider is a real
outcome, and typing it as required would make the type system assert something
the network does not guarantee.

---

## Cost and security

Default in every direction is **no**, and each gate is fail-closed:

- `MARBLE_ENABLED` must be exactly `"true"`. `1`, `yes`, `TRUE` all read as off —
  a guard whose cheapest bypass is a plausible typo is not a guard.
- `MARBLE_LIVE_GENERATION_ALLOWED` is **separate** from `MARBLE_ENABLED`. The
  feature being available and real money being spendable are different
  decisions, and collapsing them is how a dry run becomes a bill.
- A credential must be configured server-side. Relay records *that* one exists,
  never its value.
- The operation must be explicitly approved, by a named identity. "Approved"
  with nobody attached is the audit hole the gate exists to close.
- Duplicates are refused and name the existing world to reuse.
- Concurrency is capped.

**The mock provider is the default, not a fallback.** `MockMarbleProvider`
reports `billable: false` and the entire pipeline runs against it.

### Retry never becomes a second bill

`operationId` is `null` until the API has accepted the request. That single
distinction carries the safety: a record with no operation id has provably not
started; one with an id must be **polled**, never resubmitted. `markSubmitted`
throws on a record that already has one, and the gate refuses with
`already_submitted` and the words "poll it, do not resend".

The refusal *order* matters and a test caught it: checking approval first
reports a submitted operation as `not_approved`, which is true of the state
machine and would send someone to approve and resend — causing the exact
double-spend being guarded against.

### Credentials

`redactMarbleSecrets` and `leaksMarbleSecret` match on credential **shape**, not
on variable names, because the leak that matters is a key echoed in a provider
error body and that never arrives labelled. Events redact on construction, so a
leaky error cannot become a permanent record of a key.

---

## Unreal integration — designed, nothing selected

Three things kept separate, because collapsing them is wrong in both
directions — a splat is the wrong thing to walk on, and a collider is the wrong
thing to look at:

- **appearance** — the Marble splat, drawn, never collided with
- **collision** — the exported collider GLB, collided with, never drawn
- **interaction** — native Unreal actors; neither generated nor replaceable

**No splat renderer has been selected, and that is deliberate.** Several UE
plugins exist; none has been evaluated against this project's constraints.
Picking one because it appeared in a search is how a renderer becomes
load-bearing before anyone checked it packages on Linux.

`SplatRendererCandidate` starts every capability as `null` — meaning *unknown*,
not false and not "probably fine". `RENDERER_BLOCKING_CRITERIA` are UE 5.8
compatibility, Linux packaging, Pixel Streaming, and **opaque occluder support**.
That last one is on the list for a specific reason: the Relay Dog must render in
front of the environment and be occluded by it correctly. A renderer that cannot
depth-sort against ordinary meshes makes the hero subject float, and no amount
of environmental beauty survives that.

Until one is evaluated, `decideRegionBinding` refuses to bind and says why.

---

## Hero district spike — scoped, not run

Target region: the Arrival Plaza / Golden Build Gate / Great Framing Tree /
Castle City corridor. **Not the whole world.**

Pipeline: authored structure + reference art + region spec → generation →
validation → Unreal import → collision binding → region → rendered verification.

`backdrop_only` is a real and useful binding outcome, not a failure: a world
with no collider can still carry the horizon behind the authored plaza, as long
as nothing tries to walk on it. Saying so explicitly is what keeps a missing
collider from becoming a player falling through the floor.

---

## Project Realms

`MarbleWorldRegion` is the seam a Project Realm will bind through. Marble is
**not** mandatory for Project Avatars and nothing here makes it so. Agent
territories, Coliseum arenas and Wonderland districts reuse the same region
concept when they arrive; none is built now.

---

## What is actually proven

```
SPECIFIED  ✓   IMPLEMENTED  ✓   COMPILED  ✓ (typecheck)   RUNNING  ✗
RENDERED   ✗   STREAMED     ✗   PROVEN    ✗
```

47 unit tests, repo typecheck clean, all four architecture boundary suites pass.

**No World Labs API call has ever been made. No credit has been spent. No
Marble world exists. Nothing has been imported into Unreal.**

---

## Next founder action

None required, and nothing is waiting on you. Marble stays entirely
non-billable until you decide otherwise; the Lightning UE path is untouched.

When you do want a real generation, it needs three deliberate things:
`MARBLE_ENABLED=true`, `MARBLE_LIVE_GENERATION_ALLOWED=true`, and a
server-side `WORLDLABS_API_KEY` — plus an explicit per-request approval. Do not
paste the key into a conversation; it belongs in the server environment only.

The honest sequencing recommendation: get the **current** hero frame rendering
on Lightning first. Without it there is no baseline to compare a Marble-assisted
frame against, and comparison against the reference is the whole point.
