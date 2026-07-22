# Sunday Relay CLI (Prompt 5) — simulation demo surface

> **What is real:** the Relay Core workflow — protocol, run state machine,
> ledger, ownership, eligibility, Handoff Compiler, Relay-controlled
> verification, CompletionPolicy, claim promotion, Final Audit Report.
> **What is simulated:** every agent (Architect / Coding Agent / Reviewer /
> Verification runner). No repository file is read or modified, no real
> command runs, no provider is called, nothing is billed. Every output is
> labeled `SIMULATED`; the audit carries a mandatory simulation notice.
> **Storage is VOLATILE:** state lives only while the CLI process runs.
> There is no durable resume; the CLI never pretends otherwise.

## Build & run

```bash
npm run relay:build          # esbuild → dist-relay/cli.cjs
npm run relay -- help        # or: node dist-relay/cli.cjs help
npm run relay -- demo repair
npm run relay:test           # relay vitest suite
```

## Commands

| Command | Purpose | Exit |
| --- | --- | --- |
| `relay` | interactive session (objective → run → step/continue) | 0 on /exit |
| `relay demo <scenario>` | one deterministic scenario to its stop | final-state code |
| `relay run --objective "<t>" [--scenario s] [--max-cost n] [--until-stopped] [--auto-accept-blueprint]` | custom displayed objective over a simulation profile | final-state code |
| `relay doctor` | read-only truthful environment checks | 0 / 8 |
| `relay version` / `relay help` | identity / usage | 0 |

Global options: `--json` (clean machine JSON, no ANSI, no mascot),
`--no-color`, `--plain`, `--quiet`. `NO_COLOR` and non-TTY output disable
color automatically; everything works in pure ASCII.

Scenarios: `direct, repair, checkpoint, duplicate, stale, failure,
budget-warning, budget-stop, pause-resume, cancel` (mapped 1:1 onto the
Prompt-4 scenario configurations — the CLI holds no scenario logic).

**Exit codes:** 0 completed · 1 internal · 2 usage · 3 failed · 4 blocked ·
5 checkpoint_required · 6 cancelled · 7 budget stop · 8 doctor failure ·
9 protocol failure. 0 is never used for incomplete work.

## Interactive commands

`/help /start /step /continue /status /events /project /task /ownership
/blueprint /handoff /evidence /review /usage /checkpoint /audit /approve
/reject <reason> /pause /resume /cancel /scenario [name] /mascot on|off
/color on|off /json on|off /clear /exit` — plain text before a run starts
becomes the objective. All state changes go through Relay Core commands;
the CLI contains zero workflow logic (boundary-tested).

**Blueprint approval (Guided Mode):** interactively, the Architect's
blueprint stops the run with `AWAITING APPROVAL`; `/blueprint` shows it,
`/approve` issues the canonical `accept-blueprint` command, `/reject
<reason>` cancels the run canonically. `--auto-accept-blueprint` (and the
demo commands) record a system-actor acceptance instead — honestly labeled.

**Checkpoints:** `checkpoint_required` renders the reason and options;
`/approve` / `/reject` issue the real `respond-checkpoint` command — Relay
Core decides what approval permits.

**Mascot:** a 3-line ASCII pixel dog whose label (`LISTENING`, `AGENT
WORKING`, `CHECKPOINT`, `COMPLETE`, …) derives from the real run state;
off in JSON/plain/non-TTY modes and via `/mascot off`.

## YC presentation preset (Prompt 6)

`npm run relay:yc` — the authoritative July 24 demonstration: the `yc`
scenario (golden path, product-relevant presentation content) rendered in
presentation mode (milestone frames, ~2.5 s pacing on a TTY, ~40 s total).
`relay demo yc --presentation --pace <ms>` controls pacing; `--pace 0` for
instant/CI runs; `--json` stays clean machine output. Presentation is
RENDERER-ONLY: filtering and pacing never change state, sequencing,
outcomes, or exit codes. `npm run relay:yc:verify` runs the bundled demo
twice and checks semantic acceptance (completed, exit 0, exactly one
repair, same-session resume, independent reviewer, audit + simulation
notice, clean JSON, stable milestone ordering, no repo modifications).
See YC_DEMO_RUNBOOK.md and YC_VIDEO_SCRIPT.md.

## July 24 demonstration sequence

```bash
npm run relay:yc                  # THE YC demo (presentation mode, exit 0)
npm run relay:yc:verify           # acceptance verification (run before takes)
npm run relay -- demo repair      # golden path: 1 failing check → review →
                                  # ONE same-session repair → approval → audit (exit 0)
npm run relay -- demo checkpoint  # unsafe repair → Guided stop (exit 5)
npm run relay -- demo duplicate   # equivalent task denied pre-dispatch, agent never invoked (exit 5)
npm run relay -- doctor           # truthful capability report (DEFERRED items labeled)
```

Optionally: `demo failure` (honest failure — never completes), `demo
budget-stop` (exit 7), and the interactive session for blueprint approval.

## Exact next phase

Prompt 6 — durable local persistence (relay-storage file-backed
repositories + real cross-process resume), per CURRENT_STATE.md.
