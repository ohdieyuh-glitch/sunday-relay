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

| Checkpoint | State |
| --- | --- |
| 1. Docs scaffold (this file + RELAY_INTEGRATION.md) | ✅ done |
| 2. Domain: types + stage machine + tests | ⏳ next |
| 3. Brief generators + artifact parsers + tests | not started |
| 4. Verification gate + tests | not started |
| 5. Relay store (zustand, isolated persistence) + tests | not started |
| 6. UI (pipeline rail, stage panels, ledger) + `relay.html` entry | not started |
| 7. Recorded demo mission seed + isolation boundary test | not started |
| 8. Full verification gate (typecheck / vitest / build / backend:build) | not started |

## Changed files (cumulative)

- `RELAY_STATUS.md` (new)
- `RELAY_INTEGRATION.md` (new)

## Tests

- None yet (domain tests land with checkpoint 2).

## Blockers

- None.

## Integration instructions

See `RELAY_INTEGRATION.md`.
