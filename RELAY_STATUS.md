> **SUPERSEDED — historical reference only.**
> Superseded by: `docs/relay/` (authoritative set: RELAY_MVP_SPEC.md,
> ARCHITECTURE.md, PROTOCOL.md, SECURITY_BOUNDARIES.md, TEST_STRATEGY.md,
> DECISIONS.md, CURRENT_STATE.md, SESSION_LOG.md, UI_VISION.md).
> Date: 2026-07-21. Reason: founder architecture contract (Phase 1
> Architecture Lock) reclassified the golden-path web app this document
> describes as the **Relay Protocol Prototype** — a design seed and demo
> artifact, not the Relay architecture. Statements below about scope,
> isolation, storage keys, and checkpoint status describe the prototype
> as of 2026-07-21 morning and are no longer maintained. Current truth:
> `docs/relay/CURRENT_STATE.md`.

# Sunday Relay — Build Status (YC demo, July 24)

> Living status doc for the `feature/relay-yc-demo` branch. Updated at every
> checkpoint commit. The parallel Alcatraz session should treat this file +
> `RELAY_INTEGRATION.md` as the complete interface to this branch.

## What Relay is

Sunday Relay is the mission-orchestration surface of Sunday: it relays one
engineering mission between agents with structured handoffs and verifies the
result. The YC golden path (the only scope of this branch):

1. Mission created
2. Structured Claude Code implementer handoff (Relay-generated brief)
3. Implementation report (ingested from the real implementer session)
4. Codex independent review (ingested from the real reviewer session)
5. Repair task (Relay-generated from unresolved findings)
6. Repair completion (ingested)
7. Test evidence (ingested command evidence)
8. Verified complete (computed gate — never a button that lies)

Truthfulness rules (AGENTS.md §5.3) are load-bearing: Relay never simulates an
agent or fakes progress. Briefs are genuinely generated documents; every other
artifact is ingested from a real agent session and schema-validated. The demo
seed mission is labeled **Recorded** in the UI.

## Isolation contract

- All Relay code lives in `src/relay/**` (new files only) plus the new entry
  `relay.html` at the repo root. Relay is reachable at `/relay.html` in dev
  (`npm run dev`) and in the production build.
- **Only shared file edited:** `vite.config.mts` — a `rollupOptions.input`
  block adding the `relay.html` entry (additive, ~4 lines). Nothing else
  outside `src/relay/**` is modified.
- Relay imports `src/styles/global.css` read-only for Sunday design tokens;
  Relay-specific styles are `.relay-*` prefixed in `src/relay/relay.css`.
- Relay never imports `src/fusion-engine/**`, `server/**`, or the Alcatraz
  session store (`src/state/**`). Enforced by `src/relay/relay-boundary.test.ts`.
- Relay persistence uses its own localStorage key (`sunday.relay.v1`) —
  disjoint from Alcatraz/session keys.

## Status

| Checkpoint | Commit | State |
| --- | --- | --- |
| 1. Docs scaffold (this file + RELAY_INTEGRATION.md) | 034ff92 | ✅ |
| 2. Domain: types + stage machine + tests | 4983feb | ✅ |
| 3. Brief generators + artifact parsers + tests | 550aeb4 | ✅ |
| 4. Verification gate + tests | ca7a61d | ✅ |
| 5. Relay store (zustand, isolated persistence) + tests | 0fb12a2 | ✅ |
| 6. UI (custody rail, stage panels, ledger) + `relay.html` entry | 3f8bb21 | ✅ |
| 7a. Isolation boundary test | cdab20a | ✅ |
| 7b. Recorded demo mission (real dogfood run: Relay on Relay) | — | ⏳ in progress — independent adversarial review of the gate code is running now |
| 8. Full verification (typecheck / vitest / build / backend:build) + demo script | — | not started |

## Changed files (cumulative)

- `RELAY_STATUS.md`, `RELAY_INTEGRATION.md` (new, relay-owned)
- `relay.html` (new entry page)
- `vite.config.mts` (**only shared-file edit** — additive rollup `input` block)
- `src/relay/domain/` — `types.ts`, `stages.ts`, `briefs.ts`, `ingest.ts`, `gate.ts` (+ tests)
- `src/relay/state/store.ts` (+ tests)
- `src/relay/` — `main.tsx`, `RelayApp.tsx`, `PipelineRail.tsx`, `StagePanel.tsx`, `relay.css`, `relay-boundary.test.ts`

## Tests

- 36 relay tests across 5 files (stage machine, briefs+ingestion, gate, store, isolation boundary), all green.
- `npm run typecheck` clean; `npm run build` green with relay entry chunks; `/relay.html` serves 200 on the dev server.

## Blockers

- None.

## Integration instructions

See `RELAY_INTEGRATION.md`.
