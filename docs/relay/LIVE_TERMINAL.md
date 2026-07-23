# Sunday Relay — Live Terminal (authoritative)

> **Implementation sync (Prompt 8.3, 2026-07-22):** during a live Codex review
> the terminal projects REAL normalized `reviewer.*` events (provenance
> `live`): Output held for independent review → RELAY → CODEX contract
> delivered → CODEX session started → inspecting the actual changed files →
> inspecting verification evidence → structured review report received →
> reviewer execution attested → blocking finding created → repair obligation
> created, output remains held. Hidden reasoning is never shown (the stream
> parser drops it; only the omission count surfaces as "Private reasoning
> omitted."), and no secrets/credentials/system prompts appear. The transport
> is still the in-process read model (production WebSocket NOT implemented).

> Added in Prompt 8.2 (2026-07-22). The Live Terminal is a **read-only
> projection of structured responsibility exchanges** over the existing
> normalized event stream — not a chat window, not a raw log, and never a
> window into hidden reasoning or secrets. Source: `src/relay/mission/
> terminal.ts` (pure) + `src/relay/ui/LiveTerminal.tsx`.

## What it shows

The terminal projects the canonical events into an ordered, attributable
feed of **responsibility exchanges** — who handed what to whom and what came
back. `buildAgentExchanges` renders structured pairs such as
`ARCHITECT → CODING AGENT` ("Responsibility contract delivered"),
`CODING AGENT → REVIEWER`, `REVIEWER → RELAY` (finding), `RELAY → CODING
AGENT` (repair). It is a governance view of the handoffs, not a transcript of
model chatter.

Each row carries provenance and a safe bounded summary. The header shows the
connection state and a filter set (Reviewer, Verification, Handoff, …).

## The terminal button

The graphical entry point is a compact button labeled `[>_]` with a status
dot: **active ●**, **waiting !**, **failure ×**. It carries the accessible
label `Open Live Terminal` (`aria-label`) and a role, so it is reachable by
keyboard and screen reader. On desktop it opens a side-panel/drawer; on mobile
it opens a full-screen page (`relay-terminal--full`).

## Transport, ordering, reconnection

`createInProcessTerminalStream(events)` is the read model:

- **`loadSince(sequence)`** returns events after a cursor, with **dedup**,
  **ordering** by sequence, and **gap detection** (a missing sequence is
  surfaced, not silently skipped).
- **connect / reconnect / disconnect** are modeled explicitly; a reconnect
  replays from the last acknowledged cursor without duplicating rows.
- The transport is **in-process only**. A production WebSocket/SSE transport
  is **NOT implemented** in this phase — the terminal reads the deterministic
  in-process projection. This is stated in the UI and in `ui/data.ts`.

## What the terminal will NEVER show

`redactTerminalText` and `projectTerminalEvent` enforce the display rules:

- No hidden chain-of-thought or private reasoning. When private reasoning is
  omitted the row shows exactly **"Private reasoning omitted."** and nothing
  more.
- No provider or platform system prompts.
- No passwords, API keys, tokens, cookies, recovery codes, secret env values,
  raw credential handles, or unredacted stack traces — secret-shaped text is
  replaced with `[redacted]`.

Render tests assert the projected feed never matches secret shapes or
"chain of thought".

## CLI

`/terminal` prints the current exchanges and connection state in the
interactive session (80-column, plain/no-color/JSON safe). The mission-control
demo renders the live-terminal frame with the structured exchanges and the
explicit "production WebSocket not implemented — in-process transport" note.

## Truthfulness — status of each part

- **Functional now:** the read model (dedup/ordering/gap detection/
  reconnect), the structured-exchange projection, redaction and reasoning
  omission, the accessible terminal button, desktop drawer + mobile
  full-screen rendering, the CLI view.
- **Uses live events:** in a live run the terminal projects real normalized
  events with truthful provenance.
- **Presentation-only / not implemented:** the production network transport
  (WebSocket/SSE) — the current transport is in-process; this is disclosed.
- **Simulated in the demo:** the demo's exchanges come from the deterministic
  competitive scenario (labeled SIMULATED; external Codex not active).
- **Unavailable until persistence:** the feed is volatile — reconnection
  replays only what the current process holds.

See MISSION_CONTROL.md for placement and SECURITY_BOUNDARIES.md for the
non-disclosure rules the terminal inherits.
