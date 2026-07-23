# Project Settings — RLY / CONFIG

The click-first project configurator between the Relay Entry Home and the
Active Relay Project Workspace.

```
Sunday Alcatraz → Relay Entry Home → PROJECT SETTINGS → Active Project Workspace
```

Module: `src/relay/ui/project-settings/` · Preview: `#/relay/project-settings`

## Interaction model (founder-directed)

**A normal Relay project is configured entirely by clicking.** Every setting
is a selectable row, radio plate, segmented control, multi-select chip,
toggle switch, preset button, or bounded stepper — all built on native
semantic inputs (radio/checkbox), never div-based controls.

### Typing policy

Freeform typing exists ONLY behind explicit actions:

1. **CUSTOM NAME** — project names are generated deterministically from the
   Project Brief (`suggestProjectNames`); a small input appears only after
   pressing CUSTOM NAME.
2. **CUSTOM choices** — a focused input/path selector may appear only after
   an explicit CUSTOM/OTHER selection (the scope CUSTOM preset defers to the
   future repository-connected path selector).
3. **Repository path/URL** — only through `onConnectRepository` (future
   focused picker).
4. **Ask Relay chat** (on the Home screen) — conversational by nature.
5. **Project Brief editing** — happens before Project Settings, prefilled.

Tests enforce that no normal section renders a visible text input or
textarea by default, and that a full configuration + START PROJECT happens
without any typing.

## Sections (numbered rail, one focused section at a time)

01 PROJECT (brief summary, selectable generated names, stage, source) ·
02 PROJECT TYPE (multi-select plates + RELAY RECOMMENDS) · 03 PLATFORM
(target platforms, device priority, deployment target) · 04 TECHNOLOGY
(chips per category — frontend/backend/database/hosting/testing, each with a
"Relay recommends" option; no Gemini/Google anywhere) · 05 WORKFORCE
(below) · 06 MODE (segmented GUIDED/SEMI/AUTONOMOUS, one description at a
time, clickable permission presets) · 07 RESEARCH (mode, topic chips,
source policy, Project Brain update policy, stale-information cadence — no
research runs from this screen) · 08 PROJECT MEMORY (source chips with
truthful statuses; Obsidian NOT CONFIGURED, OpenKnowledge COMING LATER) ·
09 SCOPE (presets, protected-area chips, file access) · 10 PERMISSIONS
(segmented rows for dependencies/commands/network/deployment/destructive;
approved session handles only — never credential values; no ACCESS
EVERYTHING) · 11 VERIFICATION (test + inspection chips, review requirement,
STRICT/BALANCED/CUSTOM completion rule) · 12 LIMITS (preset + stepper for
runtime/calls/spend/review/repair cycles, no-progress policy) ·
13 NOTIFICATIONS (event + channel toggles, honest channel availability, no
real delivery) · 14 REVIEW AND START.

Desktop: narrow numbered left rail + persistent compact summary column.
Mobile (≤980px): horizontal stepped rail, one full-screen section, sticky
BACK / SAVE DRAFT / NEXT actions.

## 05 — Workforce selection

Each role is chosen from **visible selectable option rows** — the developer
never types an agent name. Every option shows name, provider, truthful
availability, role description, strengths, plan requirement, and the
recommendation reason. Statuses are honest per this repository:

| Option | Availability |
| --- | --- |
| Sunday Alcatraz (architect) | RECOMMENDED |
| Claude Code (coding) | CONNECTED — the only connected agent (real local adapter) |
| Codex (reviewer) | AVAILABLE (real reviewer adapter) |
| Codex (coding) | NOT CONFIGURED — **separate** from reviewer availability |
| Claude / GPT / Kimi / GLM | SIGN-IN or API CONNECTION REQUIRED / NOT CONFIGURED |
| Hermes / OpenClaw / Ophiuchus | COMING LATER (disabled) |
| Manual Architect / Coding / Reviewer | AVAILABLE |
| Security / Specialist Reviewer | COMING LATER |

No Gemini or Google models exist in the catalog (test-enforced). Reviewer
policy is segmented (NEVER / SUBSTANTIVE / SECURITY-SENSITIVE / EVERY
MISSION). The independence indicator warns when the Reviewer shares a
provider with the Coding Agent — the UI explains, never silently decides.
The workforce preview (Architect ↓ Coding ↓ Reviewer ↓ Relay Verified
Result) updates instantly with each click.

## Validation and START

`validateSettingsDraft` (pure) returns blockers (missing architect/coding
agent/source/type/name, reviewer required by policy but unselected,
unavailable agent selected) and warnings (sign-in needed, reviewer not
independent, repository not connected, autonomous caveats). START PROJECT
stays disabled while blockers exist and never claims execution — it invokes
`onStartProject(draft)` with the fully-typed `ProjectSettingsDraft`.

## Contracts

`contracts.ts` defines `AgentAvailability`, `AgentOption`,
`RelayWorkforceSelection`, and the full `ProjectSettingsDraft` — every
selectable setting has a typed union value; labels are never policy
identifiers. Deterministic recommendation/prefill logic lives in
`defaults.ts` (brief → draft) and remains explainable (WHY lines). No
provider call, no persistence, no store — state is local UI state reported
through callbacks.
