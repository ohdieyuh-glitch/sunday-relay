# Relay Browser Application — Architecture, Flow & Demo

The Sunday Relay browser application: a continuous, refresh-safe product flow
from the Entry Home to a mission, backed by a typed domain store behind a
replaceable adapter boundary. **Two adapters** implement that boundary:

- **demo** (default) — deterministic, fully offline. No provider is ever called.
- **live** (`VITE_RELAY_LIVE=1`) — a REAL two-connector mission driven by the
  Relay bridge: **Sunday Alcatraz** (Prompt Architect) → **Claude Code**
  (Coding Agent), independently verified by Relay. Every provider call happens
  server-side; the browser holds no credentials and only polls a normalized
  read-model.

```
Entry Home → Ask Relay → Project Brief → Project Settings →
Active Workspace → Relay Console → Mission progression
```

## Layers (strict, top consumes down)

1. **Domain contracts** — `src/relay/ui/app/contracts.ts`. Single source of
   truth for `RelayProject`, `StoredProjectBrief`, `StoredProjectSettings`,
   `ProjectBrain`, `RelayMission`, `RelayEvent`, `RelayAppData`, and the
   `RelayApplicationAdapter` boundary. Reuses the existing screen contracts
   (`ProjectBriefDraft`, `ProjectSettingsDraft`) rather than duplicating them.
2. **Application services + store** — `src/relay/ui/app/store.ts`. The
   `RelayAppStore` is the only place domain mutations happen; every confirmed
   mutation writes through the persistence adapter. Services: project, brief,
   settings, brain, mission. Business rules (duplicate prevention, mission
   machine, completion authority) live here, never in components.
3. **Persistence adapter** — `src/relay/ui/app/persistence.ts`. Versioned
   localStorage envelope with a migration seam, malformed/foreign-data
   recovery, and idempotent init. No credentials are ever stored (test-locked).
4. **Demo adapter** — `src/relay/ui/app/demo-adapter.ts`. Deterministic,
   offline `RelayApplicationAdapter` (`kind: 'demo'`). Transparent rule-based
   brief generation (reuses `buildProjectBriefDraft`) and a fixed mission
   script. Never implies a live provider; demo events can never enter a
   non-demo mission.
5. **Projection** — `src/relay/ui/app/projection.ts`. `deriveMissionProjection`
   maps the persisted records to the approved workspace props. The renderer
   receives only this projection and can never invent completion, findings,
   or verification.
6. **View components** — the existing approved screens
   (`RelayEntryHome`, `RelayProjectSettings`, `RelayProjectWorkspace`,
   `RelayConsole`, `RelayLiveTerminalPanel`) plus the additive
   `RelayMissionPlayback` control. The app shell `RelayPreviewApp` wires the
   store to the screens across the routes.

State subscription uses React 18's `useSyncExternalStore`
(`app/useRelayAppState.ts`) — no extra state library is introduced.

## Routes (hash-based; direct-load & refresh safe)

| Route | Screen |
| --- | --- |
| `#/relay` | Entry Home + Ask Relay |
| `#/relay/project/:id/settings` | Project Settings |
| `#/relay/project/:id` | Active Project Workspace |
| `#/relay/project/:id/terminal` | full-screen Live Terminal |
| `#/relay/console` | Mission Control (execution console) |

Behavior: invalid id → safe not-found (never a stack trace); a `draft`
project (no confirmed settings) → guided back to settings; `rly-001` remains
the labeled design fixture (unchanged) so the approved screenshots keep
working; created projects are `rly-002+`, fully store-backed. The bare
`#/relay/project-settings` route resolves to the active draft for
back-compat.

## Mission state machine

`configured → ready → architect_working → handoff_ready → coding →
claim_submitted → relay_verifying → reviewer_reviewing → repair_required →
repair_in_progress → re_verifying → approved → verified_complete`

Truth model, enforced by the machine + projection:

- an **agent report is a claim** (`agent_claim`) — pending verification;
- a **test result is evidence** (`relay_evidence`) — only after Relay
  verification;
- **reviewer approval** is separate from Relay verification;
- **VERIFIED COMPLETE** is the final state and derives from the completion
  policy — no component can assign it. It only appears after claim →
  verification → finding → repair → re-verification → approval → policy.

`RelayMissionPlayback` (the DEMO MISSION control) only dispatches
ADVANCE/RESTART; restart is demo-only. Route remounts and refreshes never
duplicate events or spawn a second mission (idempotent, id-keyed events).

## Persistence

Key `sunday-relay.app.v1`, schema version 1. Persists projects, briefs,
settings, brains, active project, missions, mission events, and colorway.
Recovers cleanly from malformed or foreign payloads. Reset via the DEV
switcher **RESET** button or `store.resetAll()`.

## Security boundaries

No provider keys, no provider calls, no command execution, no network calls,
no `eval`/dynamic code, no credential persistence, no raw HTML from event
content (events are plain strings, sanitized by construction), no stack
traces surfaced to the user. Demo state cannot contaminate non-demo state.

## Live two-connector mission (real Alcatraz + real Claude Code)

```
browser  →  relay-bridge (Node, server-side)
              ├─ Prompt Architect: POST {FUSION_BASE_URL}/api/fusion/run   ← real Sunday Alcatraz
              ├─ compiled handoff (architect objective + plan, Relay safety envelope)
              ├─ Coding Agent: createClaudeCodeAdapter().invoke()          ← real Claude Code CLI
              ├─ Relay-INDEPENDENT workspace inspection + Relay-run tests
              └─ completion policy
          ←  normalized, redacted mission view (polled every ~1.2s)
```

- **`relay-bridge/`** (outside `src/relay/**`, so the boundary tests stay green)
  exposes `GET /relay-api/health`, `POST /relay-api/mission/start`,
  `GET /relay-api/mission/:id`, `POST /relay-api/mission/:id/cancel|retry`.
- **Idempotent by mission id** — a repeat start returns the existing mission; a
  duplicate click, a route remount, and a refresh never dispatch twice.
- **Claim vs evidence** — the coding agent's report is an `agent_claim`; only
  Relay's own inspection + test run emit `relay_evidence`. The report can never
  override the inspection gate.
- **Honest provenance** — the architect is labelled `Sunday Alcatraz · live`
  only when the Fusion backend reports live providers enabled; otherwise
  `Sunday Alcatraz engine · offline models (no provider key on host)`.
- **Never a fake success** — a failed connector fails the mission with a safe
  message and a bounded retry. There is no fallback to demo data.
- **Controlled sandbox** — the coding leg runs against a throwaway git fixture
  in a temp dir (auto-removed). The founder's repositories are never touched.
- The live projection derives findings/verification/completion from REAL events
  only; the demo's sample F-1/R-1 overlays are gated on `mission.demo`.

## Environment

Demo mode needs no configuration. Live mode uses non-secret frontend flags plus
server-side configuration — see `.env.example` for the full list:

| Where | Variable | Purpose |
| --- | --- | --- |
| browser | `VITE_RELAY_LIVE=1` | use the live adapter (else demo) |
| browser | `VITE_RELAY_BRIDGE_URL` | optional; default same-origin `/relay-api` |
| bridge | `RELAY_BRIDGE_PORT` | bridge port (default 8790) |
| bridge | `FUSION_BASE_URL` | the Alcatraz backend (default `:3000`) |
| bridge | `RELAY_BRIDGE_CONFIRM_LIVE=1` | required for a REAL Claude Code run |
| bridge | `RELAY_BRIDGE_FAKE_CLAUDE=1` | keyless offline pipeline (no spend) |
| Alcatraz | `FUSION_ENABLE_LIVE_PROVIDERS=true` + a provider key | required for a live architect |

No provider key ever reaches the browser or the bridge's own config: Alcatraz
owns its key, and Claude Code uses the local CLI subscription login (an
`ANTHROPIC_API_KEY` in the environment would *block* the live coding run).

## Mobile

Every route is verified at 320–768px: no horizontal overflow, gold MENU
header, touch-safe controls, safe-area insets, linear console stream. The
Relay Dog and header mark are inline SVG — no `<img>` exists anywhere, so a
broken-image icon is impossible (test-locked).

## Founder demo

- **Dev command:** `npm run dev`
- **Local URL:** `http://localhost:5173/` (`/relay.html` redirects here)
- **Entry route:** `#/relay`
- **Flow:** type a request in Ask Relay → BUILD PROJECT BRIEF → SEND TO
  PROJECT SETTINGS → confirm click-first settings (defaults: Sunday Alcatraz
  / Claude Code / Codex, Guided, research + brain + verification + review on)
  → START PROJECT → workspace at `#/relay/project/<id>` → step **DEMO
  MISSION** to VERIFIED COMPLETE.
- **Refresh/direct route:** reload `#/relay/project/<id>` — project and
  mission restore exactly.
- **Reset procedure:** DEV switcher → **RESET** (wipes browser-demo state).
- **Recovery:** malformed storage recovers to a clean empty state on next
  load; nothing crashes.
- **Production preview:** `npm run build` then `npx vite preview --port 4173`,
  open `http://localhost:4173/`.

## Founder commands — live two-connector demo

```bash
# 1. Sunday Alcatraz (Prompt Architect). Omit the key + flag to run the engine
#    with offline models (the handoff is then labelled honestly).
npm run backend:build
FUSION_ENABLE_LIVE_PROVIDERS=true ANTHROPIC_API_KEY=<key> PORT=3000 npm run backend:start

# 2. Relay bridge (Coding Agent = local Claude Code subscription; no API key).
RELAY_BRIDGE_CONFIRM_LIVE=1 FUSION_BASE_URL=http://localhost:3000 npm run relay:bridge

# 3. Frontend in LIVE mode
VITE_RELAY_LIVE=1 npm run dev          # http://localhost:5173/

# Health checks
curl -s localhost:3000/health            # Alcatraz: liveProvidersEnabled?
curl -s localhost:8790/relay-api/health  # bridge: claudeMode / confirmLive
```

Swap `RELAY_BRIDGE_CONFIRM_LIVE=1` for `RELAY_BRIDGE_FAKE_CLAUDE=1` to exercise
the identical pipeline with zero spend and no model call.

## Still deferred

- Independent reviewer (Codex) in the browser loop — the local `codex` CLI
  reports unavailable, so the minimum demo runs architect + coding only and
  says so. The low-risk completion policy genuinely requires no review.
- Arbitrary (non-sandbox) project targets — the coding leg is scoped to the
  controlled throwaway fixture.
- Server-side project ledger + durable mission store (the bridge registry is
  in-memory, so a bridge restart stops tracking an in-flight mission; the
  browser then shows the last known state honestly instead of re-dispatching).
