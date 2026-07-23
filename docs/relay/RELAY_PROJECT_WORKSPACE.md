# Active Relay Project Workspace

The main operating screen for a configured, intentionally started Relay
project — the deployed **browser application** version of Relay shown in the
founder-provided desktop and mobile screenshots.

```
Sunday Alcatraz
  → Relay Entry Home
    → Project Settings              (integration boundary in this branch)
      → ACTIVE RELAY PROJECT WORKSPACE   (this screen)
```

Module: `src/relay/ui/project-workspace/` · Preview: `src/relay/ui/preview/`
· Shared dog: `src/relay/ui/pixel-dog/`

## This is NOT the CLI

The Relay CLI (`src/relay/cli/`) is a separate operator tool. The workspace
is a polished frontend **projection of safe normalized Relay activity**. It
never renders shell prompts, raw commands, raw stdout/stderr, provider
streams, hidden reasoning/chain-of-thought, internal prompt bodies, session
identifiers, environment values, or credentials — and the test suite
enforces this against every fixture. The UI cannot launch agents, decide
permissions or completion, validate findings, generate canonical events, or
mutate Relay Core: **all execution state enters through props; all intent
leaves through callbacks.**

## Differences at a glance

| Surface | Purpose |
| --- | --- |
| Entry Home | Pre-project: explore, ask, draft a Project Brief. |
| Project Settings | Configure identity/scope/workforce/permissions/limits/evidence. |
| **Workspace** | Supervise the running project: activity, evidence, review, Manual Tasks, completion. |
| Relay CLI | Operator terminal; not this screen. |

## Screen anatomy (founder-screenshot structure)

One framed system interface — never a dashboard of floating cards:

1. **Top frame** — pixel dog mark + letterspaced SUNDAY RELAY (cream/gold),
   center: project name + outlined `[ ● RLY / 001 ]` chip + state, right:
   PROJECT SETTINGS, `>_ LIVE TERMINAL`, `MT / n`, notifications, profile.
2. **Workforce strip** — one continuous horizontal strip with thin
   dividers, compact labels, gold ■ status squares: PROMPT ARCHITECT ·
   CODING AGENT · REVIEWER · MODE · PHASE. No rounded role cards.
3. **RELAY CONSOLE** — the dominant chamfered gold-outlined surface:
   `>_ RELAY CONSOLE` title, "Safe project activity and verified
   coordination", LIVE/STANDBY indicator, and the chronological timeline —
   icon column (● system · ✓ evidence · → claim · ◆ review · ! user) with a
   thin gold connector, muted `HH:MM:SS`, gold role labels, cream activity
   text, small truth tags. No message bubbles ever.
4. **Project Conversation dock** — directly beneath the console frame:
   recent exchange rows, decision APPROVE/REJECT, the `>_ Ask Relay about
   this project…` input with SEND, and quick actions (What is happening? ·
   Why is Relay waiting? · Explain the Reviewer finding · …).
5. **Status rail** — ONE supporting panel with thin dividers: phase rail,
   Relay verification, independent review (findings + repairs), research,
   Project Brain. Manual Tasks and the completion banner sit above the
   console when present.
6. **System floor** — the pixel Relay Dog on the glowing perspective grid.
7. **Footer bar** — outlined: ● HANDOFF NETWORK / ONLINE · `[ PASS THE
   WORK. KEEP THE CONTEXT. ]` · ALL SYSTEMS GO (green, only when truly calm)
   or the truthful state label.
8. **Live Terminal full view** — the same console opened as a drawer
   (desktop) / full screen (mobile), `role="dialog"` with focus management.

## Project Conversation vs Live Terminal

**PROJECT CHANNEL (interactive)** — developer ↔ Relay about the active
project: status questions, clarifications, approve/reject decisions
(`onApproveDecision` / `onRejectDecision` with a decision id), added
context, research requests, Manual Task responses. Input:
"Ask Relay about this project…" (deliberately project-specific — not the
generic "Ask Relay anything…"). It never displays hidden reasoning, raw
prompts, raw output, or secrets, never presents agent text as verified
evidence, and cannot bypass Project Settings permissions.

**LIVE TERMINAL (observational)** — safe normalized coordination events
only, one per row: `HH:MM:SS` timestamp, category tag (RELAY, PROMPT
ARCHITECT, RESEARCH, CODING AGENT, WORKSPACE INSPECTION, VERIFICATION,
REVIEWER, REPAIR, MANUAL TASK, COMPLETION ENGINE, SECURITY, SYSTEM),
headline, optional detail, and a **truth badge**. Empty state: "No mission
is running." Nothing is fabricated.

## Event truthfulness

Every event carries an `EventTruthClass`, rendered with visibly different
weight (`projections.TRUTH_BADGE`):

| Class | Badge | Meaning |
| --- | --- | --- |
| `agent_claim` | CLAIM — PENDING VERIFICATION (amber) | An agent reported something; Relay has not verified it. |
| `relay_evidence` | VERIFIED EVIDENCE (green) | Relay independently inspected or tested. |
| `review_verdict` | INDEPENDENT REVIEW (gold) | A validated Reviewer decision. |
| `user_action_required` | WAITING FOR USER (amber) | Relay cannot continue without the developer. |
| `system_notice` | SYSTEM (dim) | Neutral coordination notice. |

## Phase rail

`PLAN → RESEARCH → BUILD → VERIFY → REVIEW → REPAIR → COMPLETE`
(`projections.phaseRailSteps`). Exactly one phase is active; earlier phases
are ✓ complete; research/repair show OPTIONAL when unused; future phases
stay subdued; **COMPLETE is locked (⊘) while any blocker is open** and is
never complete by default.

## Reviewer, findings, repairs

Reviewer states: NOT CONFIGURED, NOT REQUIRED, WAITING, REVIEWING (read-only
access noted), CHANGES REQUIRED, RE-REVIEWING, APPROVED, UNAVAILABLE,
SIGN-IN REQUIRED. Findings show ID / severity / affected criterion /
evidence summary / required action / status; repairs show ID → finding,
assignee, authorized files, status, verification. Bounded evidence only —
Reviewer reasoning is never exposed.

## Manual Tasks

First-class controlled handoff points — never styled as errors. Each shows
WHAT Relay needs, WHY it stopped, YOUR ACTION, AFTERWARD, and the safe state
(STOPPED SAFELY / WAITING), with REVIEW REQUEST / APPROVE / KEEP BLOCKED
controls (`onOpenManualTask` / `onApproveManualTask` /
`onRejectManualTask`).

## Completion behavior

The workspace shows **VERIFIED COMPLETE only when the CompletionPolicy
verdict arrives as `verified_complete` AND no visible blocker contradicts
it** (`projections.completionDisplay` — display-only defense-in-depth; the
UI is never the completion authority). An agent finishing shows nothing.
Open/validated findings, unverified repairs, and missing/unfinished review
each hold completion; a contradicted verdict renders as COMPLETION HELD with
the blockers listed. The verified banner lists the evidence: acceptance
criteria, required tests, required review, no blocking findings, protected
paths unchanged, source repository protected.

## Prompt Architect and research

The command strip + research panel represent the Architect as a continuous
role: planning, prompt generation, handoffs, **continuous research
automation**, and Project Brain expansion. Research states are truthful:
NOT CONFIGURED → MONITORING APPROVED TOPICS → RESEARCHING → NEW KNOWLEDGE
AWAITING APPROVAL. Topic requests flow through `onRequestResearch(topic)` —
no research runs in the browser. The Project Brain panel shows approved
entries, last update, and pending approvals.

## Relay Dog states

Prop-driven (`dogState` → `projections.DOG_PRESENTATION` → shared
`RelayPixelDog`): WANDERING, TROTTING, RUNNING, SPRINTING, CARRYING HANDOFF,
RESEARCHING, VERIFYING, REVIEWING, REPAIRING, WAITING FOR USER, STOPPED
SAFELY, and COMPLETE — which appears **only** with verified completion. The
browser never invents dog state from animation timing; motion is disabled
under reduced motion.

## Layouts

**Desktop** (per the desktop screenshot): framed application window on the
technical grid — header, workforce strip, 7:4 grid (conversation + mission
left; dog, phase rail, verification, review, research, brain right), footer;
terminal as a right drawer. **Mobile** (per the mobile screenshot): stacked
vertical composition, scrollable workforce strip, full-screen terminal, no
permanent sidebar, no horizontal overflow at 320px, reachable input.

Design details: gold active borders, cream content text, muted-gray
timestamps, green only for genuinely verified/online states, red/coral for
blocking findings, amber for user action, muted cyan/violet only as small
role indicators, perspective floor under the dog, low-opacity scanlines,
chamfered console corners, monospaced event labels, minimal rounding.

## Accessibility

Semantic buttons/labels; `role="dialog"` + focus-to-close on terminal open;
`aria-live="polite"` for the event feed and workspace status;
`aria-current="step"` on the active phase; visible focus everywhere; state
never communicated by color alone; reduced-motion honored; touch-safe
controls; full-screen mobile terminal has an explicit close control.

## Fixture states (frontend-only)

`fixtures.ts` ships seven clearly-labeled scenarios — IMPLEMENTING,
VERIFYING, REVIEWING, REVISION REQUIRED, WAITING FOR USER, RESEARCHING,
VERIFIED COMPLETE. Every event/message carries `fixture: true` and renders a
FIXTURE tag; preview acknowledgments say "fixture only — nothing executed."
No fixture implies live activity.

## Preview

`#/relay/project/rly-001` (workspace) and `#/relay/project/rly-001/terminal`
(full-screen terminal), plus HOME / SETTINGS / CONSOLE routes. The DEV
PREVIEW switcher gains a fixture picker on the workspace screen and a
MOBILE frame toggle (390px). The switcher is a development tool only — not
part of the production component contract.

## Future Relay Core bindings

- `terminalEvents` ← the existing Live Terminal read-model stream
  (`createInProcessTerminalStream` → network transport later). The workspace
  renders events; it will never own a second event authority.
- `dogState` ← `computeDogActivity` (Relay Core) mapped to
  `WorkspaceDogState`.
- `outputState` / `completionState` ← CompletionPolicy + output-visibility
  read models.
- `manualTasks`, `findings`, `repairs`, `verificationSummary` ← mission
  projection bundle.
- Project Conversation ← approved Relay supervisory service (no direct
  provider calls from the browser).
- Research/Project Brain ← Prompt Architect research pipeline after Project
  Settings enables it.

## Merge-risk files & recommended order

Shared-file deltas on this branch: `src/relay/main.tsx` (renders the
preview shell; imports the new CSS). Everything else is new under
`src/relay/ui/{entry-home,project-workspace,pixel-dog,preview}/` and
`docs/relay/`. Recommended order: land Prompt 8.5 persistence first, then
this frontend branch, re-applying the small `main.tsx` delta if needed.
