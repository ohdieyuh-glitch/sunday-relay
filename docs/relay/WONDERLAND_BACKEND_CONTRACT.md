# Wonderland authoritative backend contract (v1)

Wonderland is Relay's multiplayer RPG and software-development visualization. Relay is authoritative; Unreal requests and renders. A client never decides identity, project or C.A.R.D. ownership, battle participation, score, verification, winner, spend, rewards, or Project Avatar progression. C.A.R.D. is the only name for a Compound AI Agent configuration. GVE means **Gamified Verification Environment**.

## Authentication and isolation

All `/relay-api/wonderland/*` routes require an origin-bound Relay browser control session. The bridge resolves `playerId` from that server-side session; request bodies do not contain an authoritative player identity. Membership, Agent ownership, C.A.R.D. ownership, and battle participation are checked against Relay state. Goal competitors receive distinct opaque workspace keys and immutable C.A.R.D. snapshots. Implementations of the execution port must map each key to an isolated workspace, filesystem, credentials, process, output, and tool authorization boundary.

Visibility is `OWNER`, `PARTICIPANTS`, or `PUBLIC`. `PARTICIPANTS` is battle membership, not general project membership. Payloads are recursively redacted before durable append. Never send chain-of-thought, system/private prompts, secrets, credentials, bearer tokens, private Project Brain fields, or unrestricted opponent source.

## Routes

| Method | Route | Meaning |
|---|---|---|
| `GET` | `/relay-api/wonderland/events?projectId=…&cursor=…&battleId=…` | authenticated SSE replay plus live stream |
| `POST` | `/relay-api/wonderland/presence/join` | join with `commandId`, `projectId`, and availability |
| `POST` | `/relay-api/wonderland/presence/heartbeat` | extend the authenticated session's presence lease |
| `POST` | `/relay-api/wonderland/presence/leave` | leave explicitly |
| `POST` | `/relay-api/wonderland/challenges` | create Goal or Eval challenge; ownership resolved server-side |
| `POST` | `/relay-api/wonderland/challenges/:id/accept` | challenged player accepts and atomically creates locked contract/battle/events |
| `POST` | `/relay-api/wonderland/battles/:id/swarm` | activate the bounded real execution-port swarm |
| `GET` | `/relay-api/wonderland/battles/:id/result` | participant-only evidence-backed result |
| `GET` | `/relay-api/wonderland/projects/:id/brain` | member-only Project Brain read model — answered by the ONE durable Project Brain (`relay-project-brain.v1`), never the in-memory battle state; see [PROJECT_BRAIN.md](PROJECT_BRAIN.md) |
| `GET` | `/relay-api/wonderland/brain?projectId=…` · `/brain/events` | the existing panel's surfaces from the durable Project Brain, and its live feed |
| `POST` | `/relay-api/wonderland/brain/proposals` · `/reviews` · `/mutations` | the panel's Propose and Accept/Decline, saved with provenance, idempotent, version-checked |
| `POST` | `/relay-api/wonderland/native/pair` · `/session` · `/revoke` | pair a desktop client for one project from the signed-in website |
| `POST` | `/relay-api/wonderland/social/commands` | one social command as the session's player — friends, blocks, parties, private servers, presence, messages; idempotent by `commandId` — see [WONDERLAND_SOCIAL.md](WONDERLAND_SOCIAL.md) |
| `GET` | `/relay-api/wonderland/social/me` · `/roster` · `/instances` · `/presence/:id` · `/conversations/:id` · `/servers/:id` | the player's social world, every answer a privacy-wall projection (P1–P5, party, DM, no inference) |
| `GET` | `/relay-api/wonderland/eos/client-config` | the game client's minimum EOS configuration, at runtime, `no-store`; never the trusted server's credentials — see [WONDERLAND_VOICE.md](WONDERLAND_VOICE.md) |
| `POST` | `/relay-api/wonderland/voice/identity` · `/voice/join` | bind the EOS PUID the player proves (a verified Connect ID token); voice-room tokens for exactly the rooms the privacy wall's plan gives them |

Every mutating request carries a globally unique `commandId`. Retrying the same command returns its first result and does not duplicate a Mission, battle, worker set, reward, or Avatar progression.

## SSE, cursor, and reconnect

The durable event log is the source of truth. Mutation and event append occur in one backend transaction. The SSE transport first returns all visible events with `sequence > cursor`, then attaches to the live fan-out. Every event uses its monotonic sequence as SSE `id`. Clients persist the greatest fully applied sequence and reconnect with it as `cursor`. They discard an event whose `eventId` or sequence was already applied. A comment heartbeat keeps proxies alive; it does not read state and is not polling. On disconnect the server removes the listener and heartbeat. A malformed cursor fails closed. Slow-client socket backpressure is handled by Node's response stream; production fan-out adapters should bound per-subscriber queues and force reconnect rather than drop durable truth.

For multiple instances, persist the transactional snapshot/event/outbox in a shared database, publish committed outbox rows to pub/sub, and keep cursor replay against the shared durable log. Pub/sub is only acceleration; reconnect repairs gaps from the log.

## Event envelope

Schema is `relay-wonderland-event.v1`: `eventId`, `schemaVersion`, ISO timestamp, project/session/player/Agent/Mission/battle IDs, typed event name, safe payload, visibility, correlation and causation IDs, and monotonic sequence. Unsupported GVE categories are recorded as `supported: false` with no invented score.

## Visual mappings

- `battle.started` → combat starts
- `agent.planning` → planning animation
- `agent.implementing` → implementation animation
- `agent.reviewing` → review animation
- `agent.verifying` → verification animation
- `agent.repairing` → repair animation
- `battle.swarm_activated` → special cinematic
- `subagent.spawned` → a mini-terminal for that actual worker
- `battle.finding` → Eval attack feedback
- `verification.failed` → stagger/failure feedback
- `battle.completed` → result sequence
- `project_avatar.evolved` → Project Avatar evolution

Terminal lines report observable research, plans, code operations, tools, tests, review, verification, repairs, artifacts, swarm work, findings, and Mission stages. They are evidence/telemetry, never private reasoning.

## Goal and Eval truth

Goal Mode locks one canonical Mission Contract and gives both competitors identical rules. GVE uses only supported evidence; speed cannot overcome an invalid result. Finalization persists explanations, C.A.R.D. evolution recommendations (never automatic C.A.R.D. mutation), idempotent rewards, Project Brain lessons, and evidence-backed Project Avatar XP.

Eval Mode stores structured findings, evidence, confidence, remediation, verification, and rebuttal. A target may submit rebuttal evidence. Only GVE-verified and unrebutted findings materially reduce a result. Swarm workers are real bounded execution-port calls with lifecycle, telemetry, evidence, artifacts, permissions, budgets, and terminal state.

## Relay transition adapter

A production execution adapter publishes observed Relay transitions, never timers: `prompt_architect_working` → `agent.planning`; `coding_agent_starting|coding` → `agent.implementing`; `reviewer_starting|reviewer_working` → `agent.reviewing`; `relay_verifying` → `agent.verifying`; `verification_failed` → `verification.failed` and repair where applicable; `verified_complete` → `mission.completed`; `budget_exhausted` → `agent.error`.

## Operational signals

Instrument active subscriptions, reconnect/replay counts, lifecycle transitions, GVE, provider usage, permission/budget denials, reward grants, worker failures, and backpressure. Carry `correlationId` into OpenTelemetry-compatible spans and structured logs. Never log secrets or unredacted payloads.

## Eval runtime and competitive representation

Hosted Eval orchestration uses `relay-competitive-agent.v1`. The representation is a server-built allowlist containing public Agent identity, a competition-safe C.A.R.D. subset, public statistics/verification metrics, competition-scoped telemetry, and battle evidence. Prompt bodies, model routing, runtime configuration, credentials, Project Brain, private source, and hidden reasoning are never copied.

Eval runtime proceeds through `CREATED → PREPARING → EVALUATING → REBUTTAL_WINDOW → ADJUDICATING → FINALIZING → COMPLETE`. Findings are proposals until GVE adjudicates claim and rebuttal evidence. Only verified, unrebutted findings affect the authoritative result. Provider-backed evaluator launch remains unavailable when no execution adapter is configured; clients must not synthesize evaluator activity.
