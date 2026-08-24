# Relay ↔ Wonderland client contract v1

Unreal and web clients consume `WonderlandEvent` from `src/relay/wonderland/types.ts`. They must not infer Relay internals.

## Subscription

1. Persist `sequence` only after applying an event.
2. Subscribe with `afterSequence=<last applied sequence>` (use `0` for a new client).
3. Apply events in ascending sequence. Ignore any sequence at or below the local cursor.
4. On disconnect, show a disconnected state, reconnect with backoff, and resubscribe with that cursor. Never poll state.
5. Use `correlationId` to connect a battle/Mission trace and `causationId` for a direct causal edge.

Every envelope contains `eventId`, `schemaVersion`, `occurredAt`, `projectId`, nullable `sessionId`, `playerId`, `agentId`, `missionId`, and `battleId`, `eventType`, safe `payload`, `visibility`, `correlationId`, nullable `causationId`, and monotonic `sequence`.

## Event vocabulary

- Mission: `mission.created`, `mission.started`, `mission.stage_changed`, `mission.completed`, `mission.failed`.
- Agent: `agent.researching`, `agent.planning`, `agent.implementing`, `agent.handoff`, `agent.reviewing`, `agent.verifying`, `agent.repairing`, `agent.approval_required`, `agent.complete`, `agent.error`.
- Sub-agent: `subagent.spawned`, `subagent.started`, `subagent.progress`, `subagent.completed`, `subagent.failed`.
- Project Avatar: `project_avatar.progress`, `project_avatar.stage_changed`, `project_avatar.evolved`.
- GVE: `verification.started`, `verification.finding`, `verification.failed`, `verification.passed`.
- Battle: `battle.created`, `battle.accepted`, `battle.started`, `battle.telemetry`, `battle.swarm_activated`, `battle.finding`, `battle.completed`.
- Presence: `presence.joined`, `presence.updated`, `presence.left`.

Payloads are additive within schema v1. Clients must ignore unknown payload keys and unknown future event types only after negotiating a newer schema. `agent.verifying` is the stable statement “Agent entered VERIFYING”; clients do not need to know which Relay evaluator caused it.

## Visibility

`OWNER` telemetry may include bounded command/test/file metadata belonging to its owner. `PARTICIPANTS` is safe for both competitors. `PUBLIC` is safe for spectators. None may contain chain-of-thought, system prompts, credentials, unrestricted source, or private Project Brain material. The backend applies redaction; clients must still enforce visibility authorization before rendering.

## Commands

Every mutation requires an idempotency key unique to the user intent. A retry with the same key returns the original result and emits no duplicate event, swarm, battle, Mission, or reward. The client supplies intent, never authorization, score, XP, winner, spend approval, or reward eligibility.

## Hosted Relay bridge

- Authenticate with an operator `Authorization: Bearer …` credential or a deployment-provided participant session. The authenticated principal—not JSON fields—determines `playerId`, project roles, Agent IDs, and C.A.R.D. access.
- Subscribe using `GET /relay-api/wonderland/events?projectId=<id>&after=<sequence>` with `Accept: text/event-stream`. A successful stream begins with `event: connected`, including schema version and heartbeat interval. Event frames use `event: wonderland` and the sequence as SSE `id`.
- Create a challenge with `POST /relay-api/wonderland/challenges` and `{ projectId, opponentId, mode, agentId, cardVersionId, objective, acceptanceCriteria, constraints, verificationRequirements, idempotencyKey }`. `objective` is required for Goal Mode. Agent and C.A.R.D. ownership are checked against the authenticated principal.
- Inspect a participating battle with `GET /relay-api/wonderland/battles/<battleId>` and its completed result with `GET /relay-api/wonderland/battles/<battleId>/result`.
- Accept, decline, or cancel with `POST /relay-api/wonderland/battles/<battleId>/accept|decline|cancel`. Acceptance supplies only the authenticated player's `agentId`, `cardVersionId`, and an idempotency key; the server creates and locks the common Mission Contract.
- Activate a bounded real swarm with `POST /relay-api/wonderland/battles/<battleId>/swarm` and `{ projectId, roles, idempotencyKey }`. The server derives the parent Agent and C.A.R.D. limits.
- Renew presence with `POST /relay-api/wonderland/presence/heartbeat` and `{ projectId, sessionId, idempotencyKey }`.
- Read an authorized Project Brain with `GET /relay-api/wonderland/brain?projectId=<id>`.
- Treat HTTP `401` as unauthenticated, `403` as unauthorized, `409` as a refused domain command, `422` as malformed intent, and `429` as subscription pressure. On SSE loss, show disconnected state and reconnect from the last applied cursor; never start a polling loop.

Unreal mappings: `battle.started` enters combat; `agent.implementing` starts the Relay Dog work/combat animation; `subagent.spawned` creates a mini-terminal; `battle.swarm_activated` begins the special cinematic; `battle.finding` shows Eval hit/finding feedback; `verification.failed` drives stagger/failure feedback; `battle.completed` starts the results sequence; and `project_avatar.evolved` drives visual evolution. Payload additions must not drive authorization decisions. Unreal never computes identity, score, reward, or spend authority.
