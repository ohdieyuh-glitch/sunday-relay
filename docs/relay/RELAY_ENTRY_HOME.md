# Relay Entry Home

The authenticated in-product screen a developer sees immediately after
switching from Sunday Alcatraz into Sunday Relay — before any project is
selected or configured.

```
Sunday Alcatraz
  → RELAY ENTRY HOME          (this screen)
    → Project Settings        (integration boundary in this branch)
      → Active Relay Project Workspace / execution console
```

It is **not** a marketing website, not a landing page, not the execution
console, and not Project Settings. The user is already signed in and inside
the product.

Module: `src/relay/ui/entry-home/` · Preview shell: `src/relay/ui/preview/`
· Shared dog: `src/relay/ui/pixel-dog/`

## Position in the product flow

| Screen | Role |
| --- | --- |
| Sunday Alcatraz | The product the user switches from (product switcher, top-left). |
| **Relay Entry Home** | Understand Relay, form an idea, build a Project Brief Draft, continue. |
| Project Settings | Confirms identity/scope/workforce/permissions/limits/evidence. Next step. |
| Execution console (Mission Control) | After a mission starts. Reachable in preview at `#/relay/console`. |

The Home screen never shows fake active execution: no agent claims work, no
tests claim to pass, no reviews claim to occur, no terminal events are
fabricated. The Relay Dog is READY / WAITING / WANDERING only; the handoff
network is STANDBY; the project state is UNCONFIGURED or DRAFT.

## What the screen contains

1. **Product header** — Pixel Relay Dog mark, SUNDAY RELAY, product switcher
   (ALCATRAZ ⇄ RELAY, Relay active), status cells `PROJECT / UNCONFIGURED`,
   `RLY / HOME`, `HANDOFF NETWORK / STANDBY`, `[ >_ ] OPEN LIVE TERMINAL`,
   PROJECT SETTINGS, notifications, profile. No marketing navigation.
2. **Primary start area** — `RELAY HOME / ROUTE 000`, "What are we
   building?", PROJECT OBJECTIVE textarea, BUILD PROJECT BRIEF,
   CONNECT EXISTING PROJECT, OPEN PROJECT SETTINGS, readiness indicator.
   Entering text never begins execution.
3. **Relay Dog** — system guide + handoff indicator (pixel art, perspective
   grid floor). Not a customer-service chatbot.
4. **Project routes** — six numbered primary routes (01–06) + ten secondary
   routes behind VIEW MORE PROJECT ROUTES. Selection prefills the objective
   and category and recomputes workforce/research/evidence recommendations —
   deterministically, in `recommendations.ts`. Never starts execution.
5. **Recommended workforce** — Prompt Architect (Sunday Alcatraz,
   RECOMMENDED) → Coding Agent (Claude Code, CONNECTED) → Reviewer (Codex,
   AVAILABLE) → Relay (verified result). Statuses are truthful; only agents
   with a real adapter may read CONNECTED.
6. **Project research preview** — always NOT CONFIGURED here. Typed fields
   only; no research occurs in this phase.
7. **Ask Relay** — guidance chat (below).
8. **Project Brief Draft** — the editable structured beginning prompt
   (below).
9. **Recent projects** — empty and populated states with truthful project
   states; CONTINUE fires `onOpenRecentProject(projectId)`.
10. **System footer** — HANDOFF NETWORK / STANDBY · "Pass the work. Keep the
    context."

## Ask Relay — purpose and restrictions

Ask Relay exists ONLY to (1) answer questions about how Relay works — modes,
roles, setup, permissions, verification, safety — and (2) help the developer
shape an idea into the beginning Project Brief Draft.

It is **not** the execution console, not the Prompt Architect's active
project conversation, not a coding terminal. It cannot modify files, launch
agents, or start a mission — there is no code path from the chat to any
execution surface; messages leave through `onSendMessage` only. No provider
is called from the browser. Preview fixture messages are labeled `FIXTURE`
in both the data (`fixture: true`) and the rendered UI.

The real integration layer will later connect `onSendMessage` /
`onSelectSuggestedQuestion` to an approved Relay product-guidance service.

## Project Brief Draft

Built deterministically by `buildProjectBriefDraft(objective, route)` in
`project-brief.ts`. Fields: working title, project type, category, problem,
intended users, desired result, core functionality, existing/new, technical
context, preferred stack, visual direction, constraints, security
sensitivity, production impact, research topics, unknowns, knowledge gaps,
suggested Architect/Coding Agent/Reviewer/mode, evidence requirements,
completion criteria, open questions.

The developer can edit every field (list fields are one-item-per-line
textareas), copy a plain-text export (`formatProjectBriefDraft`), clear the
draft, and press **SEND TO PROJECT SETTINGS**, which invokes
`onContinueToProjectSettings(projectBriefDraft)` with the full typed object.

The draft is **never called a Mission Contract**. The Mission Contract is
created later by Relay and the Prompt Architect after Project Settings is
confirmed. Nothing on this screen claims to be saved — there is no
persistence in this frontend phase.

## Prompt Architect — expanded archetype

The product language presents the Prompt Architect as a continuous
project-intelligence role, never merely a prompt writer:

> Plans the mission, continuously researches the project, expands the
> Project Brain, and prepares every Coding Agent handoff.

Responsibilities represented in the UI: mission planning, prompt generation,
continuous project research, Project Brain development, Coding Agent
handoffs. Research on this screen is a *preview* with typed configuration
fields; Project Settings later controls enablement, topics, sources,
cadence, permissions, cost limits, citations, Project Brain approval,
sensitive-topic restrictions, notifications, and stale-information
detection.

## Readiness

`computeHomeReadiness` yields `IDEA REQUIRED` → `PROJECT BRIEF READY` →
`READY FOR PROJECT SETTINGS`. The page never labels anything READY TO
EXECUTE — execution readiness exists only after Project Settings and the
Mission Contract.

## Layout

- **Desktop**: header → start zone (left: dog + objective; right: workforce
  + research + next step, separated by a thin gold structural line) →
  project routes grid → Ask Relay + Project Brief Draft side by side →
  recent projects → footer. No permanent sidebar.
- **Mobile** (≤640px): fully stacked in the same order; single-column
  routes/brief; terminal label collapses to the `>_` glyph. No horizontal
  overflow at 320px (`overflow-x: hidden` + single-column at ≤360px).

Visual language: deep near-black (`#07080b`), technical grid + restrained
scanlines (decorative, `pointer-events: none`), warm cream text, Sunday
signal gold hairlines, chamfered corners (`clip-path`), hard rectangular
geometry, monospaced system type (Fira Code) with a large editorial sans
headline, pixel Relay Dog on a perspective grid floor, small status squares,
route numbers. Green appears only for genuinely positive states.

## Accessibility

Semantic buttons and labels everywhere; `aria-pressed` on toggles;
`aria-current="page"` on the active product; visible `:focus-visible`
outlines; `role="status"` + `aria-live="polite"` for the guide status;
reduced-motion kills all animation; statuses carry text labels (never color
alone); touch targets ≥ 28–44px; text scales with relative layout.

## Functional behavior (this frontend phase)

Implemented: local component interaction, route selection, form state,
draft editing, copy via callback, settings-handoff callback, responsive
layouts, deterministic recommendations, fixture recent projects, fixture
guide conversation, visual states.

**Not** implemented (by design): provider calls, research calls, repository
connection, persistence, credential storage, mission/agent execution,
notifications, billing, deployment, fake completion, fake live events, fake
research results.

## Preview

`relay.html` → `src/relay/main.tsx` → `RelayPreviewApp`
(`src/relay/ui/preview/`). Hash routes (no server rewrites, no shared
router changes):

| Route | Screen |
| --- | --- |
| `#/relay` | Relay Entry Home (default) |
| `#/relay/project-settings` | Project Settings integration boundary — displays the received draft JSON |
| `#/relay/project/:projectId` | Active Project Workspace (placeholder until that phase lands) |
| `#/relay/console` | Existing execution console (Mission Control, Prompt 8.2) |

The fixed bottom-right DEV PREVIEW switcher (screens, MOBILE frame at 390px,
recent-projects empty/fixtures toggle) is a development tool only and is not
part of any production component contract. Run with `npm run dev` and open
`/relay.html`.

## Future integration points

- `onContinueToProjectSettings(draft)` → real Project Settings screen.
- `onAskRelay` / guide messages → approved Relay product-guidance service.
- `onConnectExistingProject` → repository/source selection integration.
- `onOpenRecentProject` → Project Ledger-backed project list (the fixture
  list is display-only; the UI owns no second ledger or store).
- `onOpenTerminal` → the existing Live Terminal read-model stream.
- Research fields → Project Settings research configuration + Project Brain.

## Files requiring merge reconciliation after Prompt 8.5

This branch touches exactly one shared file: `src/relay/main.tsx` (entry now
renders `RelayPreviewApp`; Mission Control remains reachable at
`#/relay/console`). Everything else is new under `src/relay/ui/entry-home/`,
`src/relay/ui/pixel-dog/`, `src/relay/ui/preview/`, and this document.

Recommended merge order: land Prompt 8.5 (persistence) first, then this
branch; re-apply the `main.tsx` render-target change if 8.5 touched it.
No Relay Core, adapter, supervised-workflow, persistence, or policy file is
modified here.
