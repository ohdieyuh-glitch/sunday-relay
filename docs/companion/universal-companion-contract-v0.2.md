# Universal companion contract v0.2

**What this extends.** The v0.1 status object already served by

`GET /relay-api/wonderland/julius/missions/{wljRunId}/companion`

at `05870e5311edc416e20c7e64ef92869e24b32f9c`. v0.2 keeps every v0.1 field, with the same meaning, and adds `agents`. A client that ignores a field it does not know keeps working.

**What this is.** The one companion interface Wonderland draws. Wonderland is BYOAI. Grok Bot, ChatGPT, Claude, Gemini, and any later agent are integrations. They enter through an adapter. The route, the store, and these types do not name a provider, do not enumerate one, and do not prefer one.

**What this version implements.** The `AgentDescriptor`, the adapter registry, and `agents` on the existing GET. The agent-id routes below are the contract for that surface. No method under them is served yet.

The bridge strips `/relay-api` before the handler. The matched path is `/wonderland/...`. Neither form contains a provider id.

## v0.1 status object, unchanged

A 200 is this object. `verified` is the literal `false`. The row is not consulted for it, and an adapter session cannot set it. It stays `false` until a real provider verification exists.

| Field | Meaning |
|---|---|
| `wljRunId` | The canonical `wlj_` id the path asked for. |
| `legacyRunId` | `null`, or a `run:` id of 24 lowercase hex digits. |
| `taskId` | `null`, or `cmp_` plus a lowercase UUIDv4. |
| `companion.state` | One of `none`, `invited`, `delivered`, `delivery_failed`, `result_received`, `integrated`, `rejected`, `timed_out`, `no_result`, `cancelled`. |
| `result` | `null`, or `{ untrusted: true, summary, artifact: { kind, sha256, byteLength } }` when the state is `result_received`, `integrated`, or `rejected` and the artifact fields are present. `kind` is `text`, `patch`, or `json`. |
| `provenance` | `null`, or `{ source, wakeId, bodyDigest, contentSha256 }`. `source` is `companion_port` or `simulated`. A provenance object that carries `verified` or `verifiedBy` is not a row. |
| `updatedAt` | UTC ISO timestamp from the row. |
| `verified` | `false`. |

A body that is not 200 has no result and no `agents` array. The uniform 404 is `{ error: { kind: 'not_found', message: 'Not found.' } }`. It is the answer for an unknown `wlj_` id, a legacy `run:` id, a probe such as `preflight:`, and any other malformed id. The parser is `scripts/julius-admission-run-id.mjs`, the same one admission uses.

The peer guard is the status route's guard. A forwarded header, or a peer that is not loopback, is `403` with `error.kind` `julius_dispatch_not_loopback`. POST on this path is `405`. It is not an ingest. The route does not call out.

## The provider never appears in a URL

`providerId` is an opaque string. It is not an enum, and it is not a path segment.

These are the only companion paths:

| Path | This version |
|---|---|
| `GET /relay-api/wonderland/julius/missions/{wljRunId}/companion` | Served. v0.1 fields, plus `agents`. |
| `POST /relay-api/wonderland/companions/agents` | Not served. Documented below. |
| `/relay-api/wonderland/companions/agents/{agentId}/...` | Not served. Documented below. |

`{wljRunId}` is the mission id. `{agentId}` is the server slot id (`agt_` plus a lowercase UUIDv4). A provider name in either position is not an identifier this contract accepts. A path that puts a provider after `/companion`, or that uses a provider as `{agentId}`, is not the companion route.

## `agents`

On a 200, `agents` is an array of `AgentDescriptor`, in attachment order, for that one `wlj_` mission. Many agents may be attached to the same mission at the same time. Zero is normal.

```ts
interface AgentDescriptor {
  agentId: string;
  providerId: string;
  displayName: string | null;
  kind: 'single' | 'compound' | null;
  adapterVersion: string | null;
  declaredCapabilities: readonly string[];
  authorizedCapabilities: readonly string[];
  connection: 'connected' | 'disconnected' | 'unsupported' | 'error';
}
```

`kind` is `single` for one agent and `compound` for an agent that is itself a group. `null` means the adapter did not supply a kind. The route does not guess `single`.

`displayName` and `kind` are copied from the adapter's verified provider session. They are `null` when the slot is `unsupported` or `error`, and when a `connected` report arrived without an identity. `null` renders as Unknown. It is not a model name.

`adapterVersion` is the adapter's own version string, or `null` when no adapter was selected.

## Declared and authorized capabilities

`declaredCapabilities` is what the adapter says the provider session exposed. `authorizedCapabilities` is what that session authorized. Both come from the adapter, on the server. The client does not send either list, and the route has no capability query.

`authorizedCapabilities` is always a subset of `declaredCapabilities`, in declared order. A capability the session lists as authorized but not as declared is dropped. An empty declaration authorizes nothing.

A client shows `authorizedCapabilities` only. It does not show a declared capability as if it were granted, and it does not infer a capability the array does not contain.

`unsupported` and `error` publish both arrays empty. A failed adapter does not contribute a capability.

## Session context and the authorization boundary

The session context the adapter is given is the mission and the slot:

```ts
interface CompanionSessionContext {
  wljRunId: string;
  agentId: string;
}
```

The adapter's verified session may also carry a `providerSessionRef`. That ref stays inside the adapter boundary. It is not a field of `AgentDescriptor`, and it is not a credential.

The authorization boundary for a slot is:

- `credentialOwner` is `user`.
- `relayFundedFallback` is `false`.
- The capability lists are the clamped lists above.
- The provider session ref is present only when the adapter verified one.

BYOAI credentials are always user-owned. There is no i.Wonder-funded fallback, no house key, and no default provider account. If the user did not connect a provider, the slot is not secretly connected as someone else.

## One mission, many agents

A `wlj_` mission holds zero or more slots. Two slots may name different `providerId` strings, or the same string twice with different `agentId`s. Each slot is described on its own. The status object's v0.1 fields are the mission's local result row; they are not rewritten per agent.

The registry may be empty. The GET still returns the v0.1 object and `agents: []`. No adapter is required to start the route, and the server registers none.

## Connecting, later

`POST /relay-api/wonderland/companions/agents` is the connect route. It is not implemented. When it is, the body carries the binding, and the provider is not in the path:

```json
{ "wljRunId": "wlj_<uuidv4>", "providerId": "<opaque string>" }
```

The server selects the adapter by exact `providerId`. The caller does not select an adapter module, and does not send a model name to be used as the agent. The response is the `AgentDescriptor` for the new slot.

An unknown `providerId` still creates a slot. Its `connection` is `unsupported`, its identity fields are `null`, and its capability arrays are empty. That is not an error, and it is not a 5xx. A thrown adapter is that slot's `connection: "error"` and does not change the status of the read or of any other slot.

The same loopback guard applies. A non-loopback peer is `403 julius_dispatch_not_loopback` and learns nothing about the slots.

## Per-agent surface, later

`/relay-api/wonderland/companions/agents/{agentId}/...` is the per-agent surface. It is not implemented. `{agentId}` is the slot id minted by the server. A string that is not `agt_` plus a UUIDv4 is not used as an agent id, including a string that names a provider. The server mints an id instead of keeping that string.

No method under this prefix is mounted in v0.2. A request there is not the mission companion GET.

## Envelopes

These are the common shapes an adapter will exchange. v0.2 does not serve them. They carry slot ids and the mission id. They do not carry a provider name, a credential, or a model id.

**Message**

```ts
interface CompanionMessageEnvelope {
  wljRunId: string;
  agentId: string;
  messageId: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  createdAt: string;
}
```

**Task participation**

```ts
interface CompanionTaskParticipationEnvelope {
  wljRunId: string;
  agentId: string;
  taskId: string;
  participation: 'assigned' | 'working' | 'handed_off' | 'done' | 'declined';
}
```

**Handoff**

```ts
interface CompanionHandoffEnvelope {
  wljRunId: string;
  fromAgentId: string;
  toAgentId: string;
  taskId: string | null;
  summary: string;
}
```

**Shared context**

```ts
interface CompanionSharedContextEnvelope {
  wljRunId: string;
  contextId: string;
  agentIds: readonly string[];
  text: string;
}
```

A handoff names two slots on the same mission. It does not name a provider, and it does not retarget the mission onto a generic model.

## Connection, isolated

Each slot has one connection:

| Value | When |
|---|---|
| `connected` | The selected adapter returned a verified session whose `providerId` is that slot's id, with a display name and a kind. |
| `disconnected` | The adapter was selected and has no verified session, or it reported `disconnected`. |
| `unsupported` | No adapter is registered for that opaque `providerId`. |
| `error` | The adapter threw, the session's `providerId` did not match the adapter, or a connected report had no identity. |

Describing one slot cannot fail the GET and cannot change another slot. A source that throws while listing slots yields `agents: []` and still returns the v0.1 status with `verified: false`. The local result row is independent of every adapter.

## Identity

The route never substitutes a generic model and presents it as the user's agent. `displayName`, `kind`, and the capability lists are taken from the adapter's verified provider session, or they are null and empty. A session whose `providerId` differs from the adapter that was selected is `error`, and its display name is discarded. The route has no model table to fall back on.

## What stays loopback

Dispatch, status, and this companion read are loopback-only. The future connect and per-agent routes are loopback-only as well. A browser origin, an operator bearer used as the companion caller, and a non-local store stay refused by the same guard the status route uses. This contract does not open a public provider callback.
