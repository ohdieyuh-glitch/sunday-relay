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
| `relay workspace doctor` | isolated-worktree capability checks (live local) | 0 / 8 |
| `relay workspace verify` | deterministic workspace security verification on a throwaway fixture repo | 0 / 8 |
| `relay claude doctor` | truthful Claude Code capability + auth report (no model call) | 0 / 8 |
| `relay claude contract-verify` | offline adapter proof against a fake Claude (no provider call) | 0 / 8 |
| `relay claude run --fixture safe-edit --confirm-live` | REAL Claude Code live proof (explicit) | 0 / 3 / 5 |
| `relay claude inspect` / `relay claude cancel` | live-run inspection / cancellation (volatile, process-local) | 0 |
| `relay demo competitive` | Mission Contract + Claude Implementer + Codex Reviewer + finding + repair + verified completion (SIMULATED) | 0 |
| `relay version` / `relay help` | identity / usage | 0 |

Global options: `--json` (clean machine JSON, no ANSI, no mascot),
`--no-color`, `--plain`, `--quiet`. `NO_COLOR` and non-TTY output disable
color automatically; everything works in pure ASCII.

Scenarios: `direct, repair, checkpoint, duplicate, stale, failure,
budget-warning, budget-stop, pause-resume, cancel, manual, yc` (mapped 1:1
onto the scenario configurations — the CLI holds no scenario logic).

**Exit codes:** 0 completed · 1 internal · 2 usage · 3 failed · 4 blocked ·
5 checkpoint_required · 6 cancelled · 7 budget stop · 8 doctor failure ·
9 protocol failure. 0 is never used for incomplete work.

## Interactive commands

`/help /start /step /continue /status /events /project /task /ownership
/blueprint /handoff /evidence /review /usage /checkpoint /manual /audit
/approve /reject <reason> /done /manual-help /cannot-complete [note]
/pause /resume /cancel /scenario [name] /mascot on|off
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

**Competitive proof (Prompt 8.1):** `npm run relay:competitive` (=
`relay demo competitive`) runs the deterministic mission-control proof
through the REAL orchestrator: Mission Contract locked (revision 1, 5
requirements, 6 blocking criteria, Claude Implementer, Codex Independent
Reviewer) → implementation CLAIMED COMPLETE → Relay verification → the
independent Codex review finds the IPv6 /128 rotation bypass (CHANGES
REQUIRED) → finding F-1 + repair R-1 (scope-locked) → repair claim (finding
stays open) → Relay verification 6/6 PASS → Codex re-review approves → the
completion engine reaches MISSION VERDICT: VERIFIED COMPLETE. The Claude
Implementer and Codex Reviewer are deterministic SIMULATIONS in this
presentation; no external Codex is connected; the real Claude path stays
`npm run relay:claude:live`. Interactive inspection: `/mission`,
`/attestation`, `/findings`, `/repairs`, `/verdict`, `/timeline`. JSON mode
returns the serializable mission bundle (no ANSI/mascot/secrets). See
MISSION_CONTRACT.md, EXECUTION_ATTESTATION.md, REVIEW_REPAIR_LEDGER.md,
COMPETITIVE_FEATURE_COVERAGE.md.

**Manual Tasks (Prompt 6.1):** when a validated checkpoint carries a Manual
Task, the CLI shows it automatically (title · why Relay stopped · three-to-
six simple steps · what Relay will do next). `/manual` re-displays it;
`/done`, `/manual-help`, `/cannot-complete [note]` issue the real
`respond-manual-task` command, and `/cancel` stays the canonical run
cancellation. While the task prompt is active, the single letters `D` `H`
`N` `C` answer it (inert everywhere else). Done is recorded as a claim;
Relay runs the configured verification and Relay Core alone decides whether
the run resumes. When no verification exists, the CLI says so and operator
`/approve` confirms. JSON mode returns the serializable Manual Task read
model (no ANSI, no mascot, no secret values).

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

## Manual Task demonstration (Prompt 6.1 — separate from the YC demo)

`npm run relay:manual` (equivalently `relay demo manual`) — a deterministic
Manual Task scenario through the REAL core: the simulated agent requests a
protected-setting approval → Relay validates the untrusted request →
`checkpoint_required` with a canonical Manual Task → simple instructions →
demo choreography answers "Done" (honestly labeled) → Relay verification
passes → the run resumes and completes (exit 0). Instant by default;
`--pace 0` accepted. `npm run relay:manual:verify` runs it twice and checks
semantic acceptance (completed, task completed + verified, 3–6 short steps,
checkpoint association, no agent dispatch while stopped, event ordering,
clean JSON, no secrets, no repo modifications). The main `npm run relay:yc`
demonstration is unchanged.

## Workspace foundation (Prompt 7 — live local, separate from the demos)

`npm run relay:workspace:verify` (equivalently `relay workspace verify`)
proves the isolated-worktree security foundation end to end against a
throwaway fixture repository under the OS temp dir: pinned-revision
worktree isolation, idempotent reuse, source-worktree immutability,
allowlist-only shell-free command execution (push/shells rejected),
claimed vs protected change detection, timeout + cancellation with honest
termination reporting, conservative cleanup, live secret-free evidence,
and full fixture removal. `relay workspace doctor` reports capabilities
truthfully (agent execution and all provider adapters remain UNAVAILABLE).
This is REAL local infrastructure (`provenance: live`) — it is not part of
the recorded YC simulation and does not alter any demo scenario. See
WORKSPACE_SECURITY.md.

## Live Claude Code adapter (Prompt 8 — live local, explicit approval)

`relay claude doctor` reports installed capabilities + a safe auth
classification (no model call, no secrets). `npm run relay:claude:contract-
verify` (= `relay claude contract-verify`) proves the ENTIRE adapter offline
against a deterministic fake Claude — stream parsing, session capture +
explicit resume, workspace inspection, Relay verification, cancellation,
timeout, hidden-reasoning omission — with no provider call. `npm run
relay:claude:live` (= `relay claude run --fixture safe-edit --confirm-live`)
makes a REAL Claude Code call: it builds a throwaway fixture, runs Claude in
an isolated worktree, inspects the result independently, runs `node --test`
itself, and produces a live Final Audit ("Independent reviewer: not required
by the low-risk policy" — never a Codex claim). The live command is NOT part
of any test, build, doctor, verification, or CI, and requires
`--confirm-live` (approval is never inferred from a TTY). Uses the local
Claude subscription; never reads or stores credentials; strips API-key env.
See CLAUDE_CODE_ADAPTER.md and LIVE_CLAUDE_DEMO.md.

## July 24 demonstration sequence

```bash
npm run relay:yc                  # THE YC demo (presentation mode, exit 0)
npm run relay:yc:verify           # acceptance verification (run before takes)
npm run relay:manual              # supporting demo: Manual Task stop → Done → verified resume (exit 0)
npm run relay -- demo repair      # golden path: 1 failing check → review →
                                  # ONE same-session repair → approval → audit (exit 0)
npm run relay -- demo checkpoint  # unsafe repair → Guided stop (exit 5)
npm run relay -- demo duplicate   # equivalent task denied pre-dispatch, agent never invoked (exit 5)
npm run relay -- doctor           # truthful capability report (DEFERRED items labeled)
```

Optionally: `demo failure` (honest failure — never completes), `demo
budget-stop` (exit 7), and the interactive session for blueprint approval.

## Exact next phase

**Real Claude Code Local Adapter** — a live coding-agent adapter executing
inside the Prompt-7 workspace boundary, per CURRENT_STATE.md. (Durable
local persistence remains queued behind it.)
