# Sunday Relay — Mission Control (authoritative)

> Added in Prompt 8.2 (2026-07-22). Mission Control is the **graphical
> product surface**: a compact operator view that projects Relay Core state
> (mode, dog, terminal, reviewer gate, access) into the Relay visual
> identity. It is a **projection layer only** — it renders canonical state and
> submits commands; it never owns a decision. Source: `src/relay/ui/`.

## What it is

The React surface a founder or operator uses to watch and steer a mission. It
is deliberately **compact** — not a sprawling dashboard — and uses
**progressive disclosure** (`<details>` sections: Mission Contract, Review &
Repair, Reviewer & Release Gate, …) so the default view is small and detail is
one click away. It renders on desktop (side panel/drawer for the terminal) and
mobile (full-screen terminal page), and is accessible (aria labels, aria-live
announcement of the run state, keyboard-reachable controls, reduced motion).

## Identity

Relay's restrained visual language: near-black background, bone-white text, a
single restrained Sunday-gold accent, terminal density. Styles live in
`src/relay/ui/mission-control.css` with responsive `@media (max-width: 640px)`
and `prefers-reduced-motion` support. The relay entry point
(`src/relay/main.tsx`) renders `<MissionControl />`.

## What it composes

Mission Control brings the Prompt-8.2 systems together over one real Relay
Core run (`buildMissionControlData` in `ui/data.ts` runs the competitive
scenario in-process and projects the bundle):

- **Modes** (MODES.md) — mode controls; selecting autonomous shows the
  consent screen. The UI **submits** a mode command; Relay Core decides.
- **Relay Dog** (RELAY_DOG.md) — the deterministic activity indicator with its
  `Relay Dog: <STATE>` aria-label and reduced-motion support.
- **Live Terminal** (LIVE_TERMINAL.md) — the `[>_]` terminal button (labeled
  "Open Live Terminal") opening the structured-exchange feed.
- **Reviewer & Release Gate** (REVIEWER_GATE.md) — entitlement, reviewer
  availability/independence, and the output-visibility state.
- **Secure Access** — the credential-handle summary (names/scopes only, never
  values — SECURITY_BOUNDARIES.md).

## Boundary discipline

`src/relay/ui/` is browser-safe and projects only. Boundary tests assert the
UI never imports `node:` builtins, `child_process`, the Node workspace, or the
Claude adapter, and never leaks hidden reasoning or secrets. It reads Relay
Core / mission projections and submits serializable commands — there is no
second engine and no client-side workflow logic. The parked Prompt-1 web
prototype (`RelayApp`) is untouched and remains separately labeled.

## Running it

- **Graphical:** the relay Vite entry renders Mission Control; `npm run build`
  bundles it (browser-safe — the build proves no Node import leaked in).
- **Demo (terminal):** `npm run relay:mission-control` /
  `relay demo mission-control` renders the deterministic projection of every
  surface (modes, consent, reviewer gate, exchanges, terminal, dog) at
  80 columns, no ANSI, clean JSON, exit 0.
- **Interactive:** `/mode`, `/dog`, `/terminal`, `/reviewer`, `/access`.

## Truthfulness — status of each part

- **Functional now:** the graphical projection of mode/dog/terminal/reviewer/
  access, progressive disclosure, desktop + mobile layouts, accessibility and
  reduced motion, the demo and interactive CLIs. All render from real Relay
  Core state with **no provider call**.
- **Simulated in the demo:** the underlying run is the deterministic
  competitive scenario; the Reviewer is a simulation and **external Codex is
  not active** (labeled SIMULATED throughout).
- **Presentation-only / not implemented:** the production network transport
  for the terminal (in-process only this phase); no billing/Stripe behind
  entitlements.
- **Unavailable until persistence:** all state shown is **volatile** — mode
  history, consent, dog history, terminal feed, and visibility state live for
  the process only. Durable state arrives with the relay-storage phase.
- **Future — encrypted credential vault:** Secure Access stores **credential
  handles that never hold a value** (SECURITY_BOUNDARIES.md); a full encrypted
  credential vault is explicitly **deferred** to a later phase, and MFA
  remains a Manual Task.

See MODES.md, RELAY_DOG.md, LIVE_TERMINAL.md, REVIEWER_GATE.md for the
individual systems, and UI_VISION.md for the permanent visual direction.
