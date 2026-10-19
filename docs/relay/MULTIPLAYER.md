# Multiplayer — the founder definition

**Status: DEFINED. NOT BUILT. 0 files, 0 mentions of `collaborator` or actor
attribution exist in this repository as of 2026-08-08.**

Recorded from the founder on 2026-08-08. Multiplayer previously had no
specification at all, and "multiplayer" names at least three different products
with three different security models — so it was blocking rather than merely
unbuilt.

---

## What multiplayer means, for this goal

**Multiple authenticated HUMAN collaborators sharing and operating the same
Relay project / Compound PSP Agent.**

Humans. Not agents — Relay already runs several of those per Mission, and that is
a different thing with a different name.

## Required for Wave 0

- A **Project Leader** can invite collaborators.
- **At most 5 human collaborators per project.**
- Five explicit roles: **Project Leader · Editor · Developer · Reviewer ·
  Viewer**.
- Collaborators operate on the **same authoritative project state** — one Project
  Brain, one Mission history and status, one view of agent activity and
  verification state. Not copies that reconcile.
- **Permissions decide** who may view or edit project information, create, edit
  or start Missions, approve actions, change configuration, or perform other
  protected operations.
- **Every human action retains actor attribution.** Who did it is part of the
  record, always.
- **Invitation, removal and role change take effect safely, and access does not
  leak after removal.**

## The line that must not be crossed

**A human Reviewer does not replace or weaken Relay's independent Harnessing
Reviewer.** They are different roles that share a word. One is a person with
permissions; the other is the automated independent review a Mission must pass.
Letting the first satisfy the second would turn a verification gate into a
social one — the single most damaging thing multiplayer could do to this
product.

**Relay remains authoritative** for permissions, Mission state, Project Brain
truth, verification, budgets and compute limits, and completion. Collaborators
operate the product; they do not become a second source of truth inside it.

## Explicitly NOT required for Wave 0

Google-Docs-style CRDT collaborative editing · simultaneous cursors or presence
· voice, video or chat · public social and community features · the **Guest**
role (it may arrive after Wave 0) · organizations and enterprise administration
· more than 5 collaborators per project.

These are named so they are visibly out of scope rather than quietly missing.
Building any of them is overbuilding against this definition.

---

## Where this stands

Nothing is built. The nearest existing pieces are `src/relay/psp/` (the Compound
PSP Agent identity a collaborator would share) and
`src/relay/mission/agent-operating/` (AGENT roles — `prompt_architect`,
`coding_agent`, `reviewer` — which are **not** these human roles and must not be
conflated with them; a collision on the word "reviewer" is exactly the hazard the
line above describes).
