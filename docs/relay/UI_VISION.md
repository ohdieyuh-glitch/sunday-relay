# Sunday Relay — UI Vision (permanent direction)

> Status: **visual direction locked; production UI NOT built.** This document
> records the founder's UI contract and the two visual-reference images
> (desktop + mobile, received 2026-07-21) so any future implementation phase
> can build the interface without re-deriving the direction. Per the current
> phase restriction, this phase delivers architecture, domain boundaries,
> protocol design, and documentation only.

## 1. Core direction

Relay's interface is a **calm, terminal-centered mission console** — a refined
combination of Claude Code's terminal simplicity, Hermes' agentic terminal
experience, Sunday's black-and-gold identity, and a retro-futuristic
handoff-network aesthetic. It is simple, fast, keyboard-first on desktop,
touch-friendly on mobile, and visually distinctive without becoming a
dashboard.

Relay must NOT look like: a crowded analytics dashboard; a traditional IDE
with permanent panels; an overwhelming multi-agent control room; a chat app
with agent buttons; a screen of charts/cards/metrics; a fake cinematic AI
interface; a clone of Claude Code or Hermes.

## 2. Visual identity (extracted from the reference images)

**Palette**
- Near-black background with a faint technical grid (thin rules, route
  markings, a subtle perspective "grid floor" on mobile).
- Warm Sunday gold for accents: role labels, borders, active markers, the
  primary action. Restrained glow only.
- Bone-white primary text; muted warm gray secondary text.
- Green appears only as a truthful status accent (LIVE dot, passing check).
- **Gold is never the only status indicator** (shape/glyph/text always
  accompany color).

**Typography**
- Monospaced terminal type everywhere (the repo's Fira Code family fits).
- Wordmark "SUNDAY RELAY" in wide letter-spaced caps; SUNDAY bone-white,
  RELAY gold (mobile reverses weight, same pairing).
- Small uppercase letter-spaced technical labels for metadata.

**Layout — desktop reference**
- Header: pixel-dog mascot + wordmark + tagline; run identity chip `RLY / 001`
  (gold-bordered); right-aligned roster: `ARCHITECT:`, `CODING AGENT:`,
  `MODE:` values, with the mode echoed as a gold-bordered chip (`GUIDED`).
- Main surface: one bordered console frame (thin gold border, one clipped
  corner — a signature detail), containing a chronological event feed:
  status glyph (● / ✓ / →) + gold role tag (RELAY, ARCHITECT, CODING AGENT,
  TESTS, REVIEW) + timestamp + one-line bone-white message.
- Below the feed, inside the frame: a single prompt line
  `> Ask Relay anything...` with `⌘↵ SEND`.
- Footer strip: signal glyph + `HANDOFF NETWORK / ONLINE`, centered slogan in
  gold brackets `[ PASS THE WORK. KEEP THE CONTEXT. ]`, right status
  (`ALL SYSTEMS GO` + paw glyph in the mock).

**Layout — mobile reference**
- Same structure, vertical: header (mascot + wordmark, `RLY / 001` chip),
  three-column roster strip (ARCHITECT / CODING AGENT / MODE with gold square
  bullets), `>_ RELAY CONSOLE` frame with `LIVE ●` indicator, the same
  role-tagged event feed connected by a thin timeline rule, rounded input with
  gold send button, `HANDOFF NETWORK / ONLINE` line, mascot standing on the
  grid floor, slogan bar at the bottom.
- One-hand readable, vertically scrollable, zero horizontal overflow.
  Mobile is mission supervision, not code editing.

**Restrained label vocabulary** (use sparingly, never all at once):
`RLY / 001` · `HANDOFF NETWORK / ONLINE` · `ROUTE ACTIVE` · `SIGNAL 100%` ·
`PASS THE WORK. KEEP THE CONTEXT.` · `ARCHITECT` · `CODING AGENT` · `REVIEW`
· `EVIDENCE` · `CHECKPOINT`.

## 3. The mascot

A small pixel-art robotic dog (white/gray body, gold collar and eyes) is a
permanent Relay identity element. It may appear in the header, beside the
terminal intro, near the terminal bottom, in empty/loading states, during
handoffs, at checkpoints, and at completion. It must never obstruct terminal
output, replace controls, eat screen space, become a game, or distract from
engineering work.

Mascot states map to REAL Relay Core states only: idle, listening, architect
working, carrying a handoff, coding agent working, tests running, waiting for
approval, blocked, completed, failed safely. Reduced-motion and
static-mascot preferences are honored.

## 4. Truthfulness constraints (binding, from AGENTS.md §5.3)

The reference images contain **design fiction**: example agent names
("Sonnet 4.5", "Claude 4", "Architect Twin", "Build Agent"), scripted console
lines, `SIGNAL 100%`, `ALL SYSTEMS GO`, and mock timestamps. These are visual
direction, not content:

- The console renders **only normalized events emitted by Relay Core** — no
  fake terminal events, no timer-driven stage fiction, ever.
- Agent identities are **configuration/artifact data**, never hardcoded copy.
- Status labels (`ONLINE`, `SIGNAL`, `ALL SYSTEMS GO`) appear only when backed
  by a real measured state, otherwise they are omitted.
- The UI never implies an action succeeded before Relay Core confirms it.
- No hidden chain-of-thought is displayed — safe action summaries, decisions,
  evidence, files, commands, results, and status only.

## 5. Progressive disclosure

Default terminal shows: current activity, important decisions, agent changes,
tests, failures, checkpoints, completion evidence, cost warnings.

Detail views open on request, each with a simple back action: Blueprint ·
Project Brain (the Canonical Project Ledger, presented with verified fact /
accepted decision / agent claim / unverified finding / historical /
superseded clearly distinguished — never one giant Markdown blob) · Agent
Handoff Package (the responsibility contract: target agent, role, objective,
context supplied, allowed/protected files, acceptance criteria, required
evidence, budget, stopping condition, package version — every restriction
shown WITH its true enforcement level, Enforced / Advisory / Unsupported,
never implying technical enforcement the adapter does not provide) ·
Files Changed ·
Diff · Commands · Test Evidence (Passed / Failed / Pending / Unavailable /
Unverified / Requires approval, visually distinct) · Independent Review ·
Cost & Usage · Task Ownership · Failure Recovery · Disagreement Record ·
Final Audit.

Navigation stays minimal — desktop: Terminal, Project Brain, Tasks, Evidence,
Usage, Settings; mobile: Relay, Runs, Project Brain, Settings. Internal
subsystem names (Coordination Engine, Handoff Compiler, Routing Engine,
Ledger Repository…) never appear in user-facing navigation.

## 6. UI-facing data contracts (the boundary this phase reserves)

The CLI, desktop UI, and Sunday mobile UI are **clients of the same Relay
Core**; none maintains its own workflow logic. The interface is event-driven
over normalized Relay events.

Event stream (conceptual shape — final names land in PROTOCOL.md):

```
RelayEvent {
  eventId, runId, taskId?, at,
  source: relay | architect | coding-agent | reviewer | tests | system,
  kind,          // plan-locked, handoff-sent, report-received, tests, review,
                 // checkpoint, failure, completion, cost-warning, ...
  message,       // one terminal line, pre-sanitized, no hidden reasoning
  refs           // ledger version, evidence ids, package ids
}
```

State reads the UI needs: run state · task state · agent state + current
owner · handoff status · current ledger version · current context version ·
latest event · progress evidence · budget/usage status · checkpoint state ·
failure state · review state · final audit state.

Commands the UI issues (all confirmed by Relay Core before the UI reflects
them; destructive ones require explicit confirmation): create run · submit
objective · pause · resume · cancel · approve/reject checkpoint · inspect
task/handoff/evidence/diff · open Project Brain · change budget · change
agent assignment · answer unresolved question · approve final completion.

## 7. Accessibility (quality floor)

Keyboard navigation, visible focus, screen-reader labels, sufficient
contrast, non-color status indicators, reduced motion, scalable text,
mobile-safe touch targets, terminal output readable without animation, and a
plain-text CLI fallback.

## 8. UI MVP (when a UI phase is authorized — not now)

Only: Relay header · mascot · project/run identity · Architect + Coding Agent
identity · Guided Mode indicator · live terminal events · objective input ·
pause/resume/cancel · current checkpoint · basic cost usage · Project Brain
summary · final report · mobile-responsive layout.

Explicitly not initially: full IDE, permanent multi-panels, advanced Digital
Twins, visual workflow editor, complex task graphs, usage charts,
parallel-agent visualization, agent marketplace, Autopilot interface,
enterprise administration, collaboration.

## 9. Intentional differences from the references (recorded per contract)

1. Model/agent names shown in the mocks are placeholders; production shows
   the actually configured adapters.
2. Mock status badges render only when backed by real measurements (§4).
3. The desktop mock's macOS window chrome implies the future desktop app;
   the web/PWA client uses the same layout without fake window chrome.
4. The existing `relay.html` custody-rail prototype UI (built earlier on this
   branch) does **not** represent this direction; it is superseded and parked
   — kept only as a working protocol demonstration until the terminal UI
   phase, at the founder's discretion.

## 10. Current phase restriction (binding)

Do not build the production UI, fake terminal events, dashboard dependencies,
mascot animation, Digital Twins, or an IDE. This phase only documents the UI
architecture, identifies the UI-facing data contracts above, confirms
normalized events can power the interface, confirms all clients share one
Relay Core, and reserves clean boundaries for future implementation.

## 11. Manual Task placement (added Prompt 6.1, 2026-07-22 — future UI only)

Manual Task is the user-facing form of a checkpoint that needs a human
action. The CLI ships it now; this section reserves the graphical placement
(still not built, per §10).

**Desktop** — near the primary run controls:

```
[ Manual Task · 1 ]  [ Pause ]  [ Cancel ]
```

- Quiet or disabled when no task exists.
- Restrained Sunday-gold outline when a task is active (never the only
  indicator — the label carries the state, per §2).
- Opens ONE focused task sheet; no permanent dashboard panel.
- The `· 1` count badge is reserved for the future; the MVP exposes exactly
  one active Manual Task per run.

**Mobile** — a sticky action near the bottom of the active Relay run:

```
MANUAL TASK
```

**The Manual Task sheet/screen contains only:** title · why Relay stopped ·
steps · expected result · security notice when needed · what Relay will do
next · Done · I need help · I cannot do this · Cancel run.

**Never placed on the Manual Task surface:** the full Blueprint, the entire
Ledger, agent transcripts, the full event feed, large code diffs, or
internal protocol data. It is a task card for a person, not a console.
