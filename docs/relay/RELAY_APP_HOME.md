# Relay Application Home

## Product role

Relay Application Home is an authenticated, in-product starting surface. It
is the first Relay screen shown after a signed-in user switches from Sunday
Alcatraz. It is not a marketing landing page, public product-description
page, waitlist, pricing page, or analytics dashboard.

The empty state says `NO PROJECT SELECTED` and lets the user begin with either
an objective or an existing project. Entering text never starts execution.
`START PROJECT` is an intentional, readiness-gated action.

## Home experience

- The project composer captures the desired result.
- Six numbered Starting Routes prefill an editable objective, evidence
  requirements, and a deterministic local workforce recommendation.
- Quick Start exposes New Project, Connect Project, and Project Settings.
- Relay Dog is `READY` and wandering or waiting. It represents movement of
  context and responsibility; it is not a support chatbot.
- Recommended Workforce previews architect → coding agent → reviewer → Relay.
  It is explicitly a preview and never claims execution.
- Relay policy recommendations are deterministic local rules. No model is
  called and no personalization is claimed.
- Project Readiness checks objective, workforce, mode, and confirmed
  boundaries. All four must pass before Start Project is enabled.
- Recent Projects accepts optional fixture/integration data. Its empty state
  does not invent activity.
- Live Terminal invokes `onOpenTerminal`. Before a mission exists it states
  that no mission is running and creates no second event stream.

## Project Settings

The right-side desktop workspace becomes a full-screen mobile flow. It covers:

1. project identity and source;
2. scope, protected areas, and action boundaries;
3. Prompt Architect;
4. Coding Agent;
5. Reviewer and substantive-work requirement;
6. Guided, Semi, or Autonomous mode;
7. explicitly named access, permissions, limits, and consent expiry;
8. project memory sources;
9. tests, builds, reviews, evidence, and completion rule;
10. runtime, call, spend, review, repair, and no-progress limits;
11. notification preferences only.

Availability labels come from `connectionStatuses`. The UI accepts named
tools, services, and opaque authenticated-session references only. It has no
fields for passwords, API keys, tokens, cookies, recovery codes, or secret
values and no “access everything” control. Obsidian and OpenKnowledge are
shown as unavailable (`COMING LATER`).

## Responsive and accessible behavior

Desktop uses a compact header, central objective environment, Dog surface,
numbered routes, and a right-side workforce preview without a permanent
sidebar. At mobile widths the Dog precedes the composer, routes scroll
horizontally, workforce becomes vertical, settings fill the screen, and a
sticky Start Project action remains visible. Rules specifically cover widths
below 360px and avoid horizontal page overflow.

Controls are semantic buttons/inputs, mode options expose radio semantics and
descriptions, status changes use live regions, settings expose a validation
summary, focus is visible, touch targets are at least 44px, and reduced-motion
preferences disable mechanical animation.

## Functional components and UI-only placeholders

`RelayHomePage` owns only ephemeral display state (selected route, settings
visibility, and a controlled draft mirror). Pure functions in
`recommendations.ts` implement local recommendations and readiness. Props and
callbacks own persistence, project creation, repository connection, opening
projects, terminal integration, and settings integration.

Current UI-only placeholders are the product/project selector menus,
notification and profile controls, connection status fixtures, recent-project
fixtures, memory integrations, notification delivery, and terminal overlay.
None claim a live integration.

## Future integration points

After the parallel Relay architecture work is committed and integrated, wire:

- Project Ledger to `recentProjects`, `onOpenProject`, and persisted drafts;
- Project Brain and memory adapters to the Project Memory choices;
- Mission Contract compilation to the accepted project draft;
- mode policy to the selected mode and approved boundaries;
- real agent-connection probes to `connectionStatuses`;
- Reviewer entitlement to reviewer availability;
- Relay Dog projection to `dogState`;
- the existing Live Terminal surface to `onOpenTerminal`;
- persistence/navigation to create, connect, settings-save, and project-open
  callbacks.

The likely integration files are the eventual Relay client composition root,
Project Ledger/Brain adapters, Mission Contract mapper, connection projection,
Dog projection, and Live Terminal host. Do not move policy into this UI and do
not import provider adapters or headless Relay Core internals into it.
