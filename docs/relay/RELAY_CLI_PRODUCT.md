# Sunday Relay — Terminal Product Shell (Prompt 8.6, authoritative)

Relay has two primary interfaces projecting the SAME canonical state: the
Relay browser application (built separately) and the **Relay CLI** — the
terminal-native product for developers who supervise Relay from their
terminal. The CLI is not a second orchestration system: it consumes the
same Project Ledger, Mission Contracts, tasks, FileClaims, workspaces,
attestations, evidence, findings, repairs, CompletionPolicy, durable state
(Prompt 8.5), recovery plans, and normalized events. There is no CLI-only
project store and no CLI-side policy: the CLI never evaluates
CompletionPolicy and never creates canonical findings.

Module: `src/relay/cli/product/` — contracts (safe view models), theme
(palette + symbols + capability detection), safety (the single rendering
boundary), layout (width projection), dog (pixel mascot), projections
(canonical state → view models), renderer (pure VM → lines), app (pure
key reducer + screens), shell (raw-mode IO loop with guaranteed terminal
restoration), commands (non-interactive surface), fixtures + demo
(offline), verify-harness (contract proof).

## Visual direction

The founder-approved mockups: retro-futuristic terminal OS × Claude Code /
Codex active-task layout × pixel-art mission control. Deep black
background; warm cream primary text; muted warm gray secondary text; Sunday
gold as a RESTRAINED aged-brass signal (theme `gold` = 256-color 136, NOT
neon 178) for the RELAY wordmark, dog eyes/collar, small status squares,
active states, route/mode plates, and the current selection; a dimmer brass
(`goldDim` = 94) for structural dividers, panel borders, and the command
bar so the framework recedes and cream/gray carry the hierarchy; green ONLY
for verified/online; muted amber for waiting; coral for blocking findings;
muted cyan for the Reviewer; monospaced type; thin dim-brass dividers; sharp
panels; small status squares; route badges (`RLY / 001`); timestamped safe
activity; the
HANDOFF NETWORK footer with `[ PASS THE WORK. KEEP THE CONTEXT. ]` and
`ALL SYSTEMS GO`. The header shows the pixel-art Relay Dog logo beside the
SUNDAY RELAY wordmark; a `[>_]` badge in the top-right corner toggles the
two console views (key `V`):

- **STREAM view** (mockup 1): one gold timeline — symbol column, vertical
  rail, timestamps, colored role labels, cream primaries, gray
  secondaries, right-aligned annotations.
- **PANELS view** (mockup 2): bordered PROMPT ARCHITECT / CODING AGENT /
  RELAY SYSTEM / REVIEWER panels with ACTIVE/LIVE/WAITING badges,
  THINKING/WORKING status dots, and CREATE/MODIFY/RUN/✓ COMPLETE
  annotations.

## Commands

`relay` (bare, in a TTY) opens the product shell. Non-TTY prints the plain
home. All engineering commands remain unchanged (`relay supervised|codex|
claude|state|runs|persistence|workspace|demo|doctor`, verifiers, `relay
session` for the legacy simulated session). Product surface: `relay home`,
`relay projects`, `relay project
new|open|status|settings|workforce|research|run|terminal|tasks|findings|
evidence|history`, `relay recover [<run-ref>]`, `relay cli demo`,
`relay cli contract-verify`. Flags: `--no-color --plain --json --compact
--reduced-motion --watch --once --state-root <dir>`.

- **Home**: recent projects (durable records — never fixtures), starting
  routes, `[N]ew [O]pen [C]onnect [R]ecover [Q]uit`.
- **Project draft** (`relay project new`, interactive): safe fields only
  (name, type, objective, repo path, stack, scope, protected areas,
  production impact, workforce, mode, research preference, evidence
  requirements, runtime/call/review/repair limits) with back (`<`), skip,
  review, save, and safe cancel. Saving writes a durable draft via the
  canonical store; it never claims a mission started. The flow NEVER asks
  for passwords, API keys, tokens, cookies, or recovery codes.
- **Mission console**: updates only from normalized canonical events —
  progress is never invented from elapsed time, and an agent animates only
  when the canonical state says it is active.
- **Manual Tasks** (`relay project tasks`): first-class WAITING FOR USER
  view with why-Relay-stopped and approve/reject outcomes — never styled
  as a crash.
- **Findings/Repairs/Evidence**: bounded validated records only (severity,
  criteria, revision binding, required action, linked repair; evidence
  manifests with CURRENT/STALE and authority) — never unrestricted output
  or unvalidated reviewer claims.
- **Recovery** (`relay recover <ref>`): the Prompt-8.5 recovery service —
  validation, replay, workspace reconciliation, session readiness
  (`persisted but unverified`), call budget, and the next permitted
  action. Zero provider calls; opening the screen never launches anything;
  live calls always require explicit founder authorization.
- **Run** (`relay project run`): renders the LIVE SUPERVISED RELAY
  WORKFLOW confirmation (expected 2 / max 4 calls, retries disabled,
  fallback disabled, deployment disabled, source protected) and defers to
  the founder-confirmed `relay supervised run --confirm-live`. It launches
  nothing itself.

## Prompt Architect / Coding Agent / Relay / Reviewer activity

The four roles render only SAFE states: the Architect as a continuous
project-intelligence role (generating prompts, researching approved
topics, preparing Project Brain updates, handoff ready — with research
states RESEARCH NOT CONFIGURED / MONITORING / ACTIVE / KNOWLEDGE AWAITING
APPROVAL / PROJECT BRAIN UPDATED); the Coding Agent as an active task
surface (inspecting/reading/editing claimed files, running approved
commands, report = CLAIM PENDING VERIFICATION); Relay visibly separate
(claim vs evidence, inspection, verification, output held, finding
validated, completion evaluated); the Reviewer with NOT CONFIGURED /
WAITING / REVIEWING / CHANGES REQUIRED / RE-REVIEWING / APPROVED /
SIGN-IN REQUIRED / UNAVAILABLE.

## Safe rendering boundary (what is never rendered)

Every string passes `safety.ts` before it can enter a view model, and
free-text fields are re-sanitized at render time: ANSI/OSC terminal-control
injection stripped, control characters removed, newlines bounded, secret
shapes redacted, UUID session identifiers masked (`[session-ref]`), emails
masked, hidden-reasoning-shaped text replaced, provider-stream-shaped
payloads rejected outright, and paths shortened with an explicit ellipsis.
The CLI never displays: chain-of-thought, raw provider event streams, full
system prompts, credentials, cookies, recovery codes, authorization
headers, account emails, provider profile details, raw environment values,
internal session IDs, or unrestricted stdout/stderr.

## TTY / non-TTY, widths, accessibility

Interactive TTY: dynamic panels, keyboard navigation (arrows/J/K, Enter,
Esc, Tab, Ctrl+C graceful, Q back/quit, `?` help, single-letter routes,
`V` view toggle), incremental safe-event rendering, color. Non-TTY/pipe:
deterministic plain text, no cursor movement, no spinners. JSON mode emits
safe normalized view models only. Widths: 120+ full multi-panel; 80–119
stacked; 60–79 compact; <60 a safe linear stream — finding IDs, task IDs,
project state, verdicts, and safety information are never truncated;
paths shorten with explicit ellipsis. Color is enhancement only: every
symbol (● ✓ ! × → ■) has a text equivalent, `NO_COLOR` and `--no-color`
are honored, `--reduced-motion` freezes all animation, and the terminal is
always restored on exit (including Ctrl+C and errors).

## Relay Dog

The header logo is a FOUR-LEGGED, side-facing half-block pixel dog (never
an upright humanoid): a big boxy head with two ears, a dark visor band with
two Sunday-gold eyes, a gold collar, a long horizontal body, a raised tail,
and four legs — LARGE at full width, a SMALL variant at stacked/compact
width, and a horizontal ASCII dog (still four-legged, never humanoid) when
Unicode/color is off. The footer shows the canonical `RELAY DOG · <STATE>`
label plus a paw that WALKS along a track — a pure function of (canonical
dog state, tick) — only for moving states (WANDERING/TROTTING/RUNNING/
SPRINTING/CARRYING HANDOFF); VERIFYING/REVIEWING/WAITING FOR USER/STOPPED
SAFELY/COMPLETE render static. Reduced-motion/non-TTY always static.
Animation never implies unverified work, and the renderer never decides the
dog state — it only chooses the safe visual for the canonical state.

## Offline demo + verification

`npm run relay:cli:demo` — the OFFLINE VISUAL SIMULATION: isolated
temporary state root, fake adapters, ZERO provider calls, labeled
`OFFLINE DEMO · VISUAL SIMULATION · FAKE ADAPTERS · NO PROVIDER CALLS` on
every screen. It opens on an **activation splash** (`OFFLINE VISUAL
SIMULATION · FAKE ADAPTERS · NO PROVIDER CALLS · NO REAL FILE CHANGES`, with
the four-legged dog and start keys). `ENTER` steps into the live PANELS
console (paused on the first event); `P` starts playback and **plays the
fixture mission in real time** — revealing one
canonical fixture event at a paced cadence (~2.1s/row at 1×, ≈42s total) so the
founder can watch each role work: Prompt Architect generating → researching →
Project Brain → handoff; Coding Agent inspecting → editing → running tests →
reporting; Relay receiving the claim → inspecting → verifying → holding;
Reviewer reviewing → Finding F-1 → Repair R-1 → re-verify → re-review →
APPROVED → VERIFIED COMPLETE. The currently-active event is marked; the footer
HANDOFF NETWORK status and the Relay Dog progress through the phases. Controls
(no natural-language chat in this phase — Ask Relay is honestly declined):
`ENTER` start · `P`/`​/play` play · `/pause` · `N`/`​/next` step one event ·
`R`/`​/restart` · `1`/`2`/`3` or `/speed 2x` · `V`/`​/panels`/`​/stream` toggle ·
`/status`·`/findings`·`/evidence`·`/tasks`·`/research` · `Q`/`ESC` quit.
Playback advances ONLY through the pure `reduceTick`; real missions never set
`playing` and derive activity only from canonical events. The demo also carries
a Manual Task fixture, evidence, and a simulated-restart recovery view. Demo
fixtures never appear in normal project lists. `npm run relay:cli:demo:plain`
prints the deterministic non-interactive walkthrough (including the splash and
a mid-playback snapshot). `npm run relay:cli:contract-verify` proves
the 17 required categories (boot, home, draft, project home, the four
panels, tasks, findings, evidence, recovery, responsiveness 140→40,
accessibility, security, persistence-across-restart, regression).

## Remaining limitations

Ask Relay (natural-language CLI input) is NOT configured — input is
answered honestly, never routed to a hidden provider call. The Prompt
Architect activity shown for live missions awaits a real Architect
service; research states are configuration-driven projections. Live
mission events are not yet streamed into the CLI console from a running
supervised process (the console shows scripted demo missions and durable
state); real cross-process provider resume remains gated on the future
founder-authorized phase. Width math is East-Asian-Wide aware (CJK/Kana/
Hangul/fullwidth count two columns; combining marks zero) so the
no-line-exceeds-width guarantee holds for non-ASCII project names. An
escape sequence split at the exact stdin chunk boundary is treated as a
single benign Escape (there is no cross-chunk key buffering).
