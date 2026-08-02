# Hermes Reviewer service

A dedicated server-side process that owns the Hermes binary, the provider
credential and the per-review isolated profile. The Relay bridge talks to it
over authenticated private HTTP.

> **Status: not deployed.** These are repository artifacts only. Nothing in this
> directory has been deployed to Railway, no provider request has ever been
> made through it, and no paid Reviewer run has occurred. Repository artifacts
> existing is not a deployment.

## Why it exists

The Relay bridge used to answer "is the Reviewer ready?" by probing its **own**
container for a Hermes executable. On a developer laptop that is correct. On
Railway it is nonsense: the bridge container will never have Hermes, so the
reply — *"Install Hermes Agent and make it reachable on PATH"* — named the one
action an operator could not take. Installing Hermes on a laptop cannot satisfy
a check that runs inside a container.

Execution moved here, to a box that actually has the binary.

## Architecture

```
relay-bridge  ──authenticated private HTTP──>  hermes-reviewer
                                                    │
                                                    ├─> local Hermes executable
                                                    └─> xAI or Anthropic provider
```

The bridge is a client. In remote mode it never spawns anything and never holds
the provider key.

## API

| Route | Auth | Notes |
|---|---|---|
| `GET /healthz` | none | Liveness only. No provider contact, no model, no credential state, no path. `503` while starting or draining. |
| `GET /v1/readiness` | bearer | Offline runtime evidence. Creates no run. Credential reported as a **boolean**. |
| `POST /v1/test-connection` | bearer | Creates no run. Requested and verified identity stay separate. |
| `POST /v1/reviews` | bearer | One bounded read-only review. Idempotency key required. |
| `GET /v1/reviews/:runId` | bearer | Safe run state and evidence. |
| `POST /v1/reviews/:runId/cancel` | bearer | Requests cancellation; never reports it as completion. |

Protocol: `relay-hermes-reviewer.v1`. The bridge rejects any other value rather
than guessing.

## Configuration

All server-only. None of these may ever use a `VITE_` name.

| Variable | Required | Notes |
|---|---|---|
| `RELAY_HERMES_SERVICE_TOKEN` | yes | Shared with the bridge. The service refuses to start without it. |
| `RELAY_HERMES_PROVIDER` | yes | `xai` or `anthropic`. **Never inferred** from which key is set. |
| `RELAY_HERMES_MODEL` | yes | Exact model id. Relay chooses none. |
| `XAI_API_KEY` | when provider is `xai` | |
| `ANTHROPIC_API_KEY` | when provider is `anthropic` | |
| `RELAY_HERMES_EXECUTABLE` | no | Defaults to `hermes` on PATH. |
| `HOST` | no | Defaults to `0.0.0.0`. |
| `PORT` | platform | Railway injects it. Local default `8791`. |

Every problem is reported at startup at once, by **variable name only** — never
a value, a length or a hash.

The provider decides which variables carry the credential and the base URL, and
a caller cannot name them: an `xai` run receives `XAI_API_KEY`/`XAI_BASE_URL`
and no Anthropic variable, an `anthropic` run receives
`ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` and no xAI variable.

## Run limits — the service decides the ceiling

The service owns the provider credential and pays for every run, so it is the
trust boundary. A caller may ask for **less** than these; asking for more is
clamped, and the effective values come back on the create response.

| Limit | Service ceiling |
|---|---|
| `timeoutMs` | 600000 (10 minutes) |
| `maxOutputBytes` | 1048576 (1 MiB) |
| `maxPromptBytes` | 262144 (256 KiB) |
| `maxTurns` | **exactly 1** |

Every limit must be a positive, finite, safe integer; zero, negatives,
fractions, `NaN`, overflow and numeric strings are refused rather than coerced.

`maxTurns` is **not** a flexible budget. The adapter runs Hermes with
`-z/--oneshot` — a single prompt and a single final response — there is no
turn-limit flag, and the isolated profile pins `agent.max_turns: 1`. Any other
value is refused rather than accepted and silently ignored.

## Railway settings (dashboard, not a config file)

This repository's boundary scanner **hard-fails on committed deployment
configuration**, so there is deliberately no `railway.json` here — the existing
Relay bridge is configured the same way. Set these in the Railway service:

| Setting | Value |
|---|---|
| Build command | `npm ci && npm run relay:hermes:build` |
| Start command | `npm run relay:hermes:start` |
| Healthcheck path | `/healthz` |
| Restart policy | on failure |

`nixpacks.toml` in this directory is a **build recipe** (it installs the Node
and Python toolchain Hermes needs), not deployment configuration, and passes
the scanner.

> **The recipe does not install Hermes.** It provisions the toolchain Hermes
> needs and builds this service — nothing in it vendors or fetches the Hermes
> binary. Getting Hermes into the execution environment is a separate step that
> **has not been performed**, and `RELAY_HERMES_EXECUTABLE` must then point the
> service at it. Until then the service starts, answers `/healthz`, and fails
> every review at discovery. That is the truthful outcome, not a defect — and
> claiming the artifact installs Hermes would recreate the exact class of bug
> this milestone exists to remove.

Nothing here hardcodes a Railway project id, service id, private domain, the
public bridge URL, a provider credential or the service token.

## Build and run

```sh
npm run relay:hermes:build    # -> dist-relay-hermes/main.cjs
npm run relay:hermes:start    # runs the built artifact, not TypeScript
npm run relay:hermes:test
```

## Verification limits, stated honestly

- **xAI can be verified for free.** Listing models costs no tokens, so a
  requested model can be confirmed against the authenticated account.
- **Anthropic cannot.** Relay will not invent an endpoint, and the only
  alternative is a paid inference request — which a readiness or
  test-connection path must never make. An Anthropic-backed Reviewer therefore
  reports its credential present, its runtime ready, and its model
  `provider_unverified` until a real review runs. This is a real limitation,
  represented in the evidence model rather than hidden.

Credential presence is not provider verification. A configured model name is
not a verified model identity. Runtime availability is not model availability.

## Isolation

Each review gets a **freshly generated** Relay-owned `HERMES_HOME`. It inherits
no personal memories, sessions, skills, `SOUL.md`, MCP servers, plugins, hooks
or fallback providers, because none of those exist in the home it is given. All
known toolsets are disabled, execution is one-shot with `shell: false`, and the
prompt, output, turn count and wall-clock are all bounded. On timeout or
cancellation the whole process **group** is terminated.

A persistent Railway volume may hold the service installation. It must never
hold a per-review profile.

## Shutdown

On `SIGTERM`/`SIGINT` the service stops accepting new reviews immediately,
reports `shutting_down` on `/healthz`, asks every live run to cancel, waits a
bounded 10s, and exits. A review interrupted this way is never reported as
completed and never yields a verdict — a platform restarting a container must
not be able to manufacture an approval.

## Restart loss

Run state is held in memory. A restart loses it, and the service says so rather
than inventing durable state. Durable review records live in Relay Core, which
remains the single source of run truth; this service is an execution boundary,
not a second Relay.

### Idempotency is NOT restart-safe — and that gates the first paid Mission

The idempotency map lives in the same memory. Within one process life it is
honoured exactly: a replayed key returns the existing run and starts no second
process, and a key replayed for a **materially different** request (different
run id, prompt or effective limits) is refused as a conflict rather than
silently answered with some other run's identity. A run record is never
replaced, so a duplicate run id cannot orphan a live process group.

**Across a restart none of that survives.** A same-key request arriving after a
restart is indistinguishable from a new one, and would start another run — a
second *paid* run, once a real provider is attached.

What stands between that and a duplicate charge today is deliberate, and stays
deliberate: **there is no automatic retry anywhere in Relay**, and the only
retry path requires fresh explicit authorization (`/reviewer/retry` answers
`403 authorization_required` without it, because a retry is a new paid call and
prior authorization does not carry over).

Durable idempotency belongs in Relay Core, which already owns run truth;
inventing a second durable store here would create exactly the competing
source of truth this service exists to avoid. It is therefore an explicit
**post-merge, pre-paid milestone**, and until it lands this service must not be
described as restart-safe.
