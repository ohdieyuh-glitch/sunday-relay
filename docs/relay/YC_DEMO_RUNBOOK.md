# YC Demo Runbook — Sunday Relay (July 24, 2026)

## 1. Pre-recording checklist
- [ ] `cd /home/kaisinrogodfree5/sunday-relay` (the `../sunday-relay` worktree)
- [ ] `git status` clean, branch `feature/relay-yc-demo`
- [ ] `npm run relay:yc:verify` → **VERIFICATION PASSED** (run it twice)
- [ ] Terminal: dark background, **100×32** window (demo is safe at 80 cols)
- [ ] Font: 16–18 pt monospace (Fira Code matches the brand)
- [ ] Notifications off; no other terminal tabs visible
- [ ] Shell prompt short (`PS1='> '` if needed)

## 2. Commands
- Build: `npm run relay:build`
- Verify (before every take): `npm run relay:yc:verify`
- **Live demonstration (primary): `npm run relay:yc`** (~40 s paced)
- Backup instant run: `npm run relay -- demo yc --pace 0`
- Optional follow-ups: `npm run relay -- demo checkpoint` ·
  `npm run relay -- demo duplicate` · `npm run relay -- doctor`

## 3. Expected progression (in order)
SUNDAY RELAY banner → SIMULATED + VOLATILE disclosure → OBJECTIVE →
PROJECT BRAIN (canonical context) → PLAN (Blueprint V1) → TASK OWNER →
HANDOFF PACKAGE (responsibility, pins, "never a transcript") → ATTEMPT 1 →
RELAY VERIFICATION (12 passed, **[FAIL] anonymous spend-control proof**) →
INDEPENDENT REVIEW (Anonymous spend-boundary bypass) → RELAY DECISION (one
bounded repair, same session) → RE-VERIFICATION (13 passed, 0 failed) →
INDEPENDENT REVIEW approved → FINAL AUDIT → **RELAY COMPLETE** screen
(five [PASS] lines, mission summary, SIMULATED provenance). Exit code 0.

## 4. Recovery if the terminal closes mid-take
Session storage is **volatile** — there is nothing to resume and no
recovery command. Simply reopen the terminal and run `npm run relay:yc`
again; the scenario is deterministic and will reproduce the same
progression (ids/timestamps differ; semantics identical — that is what
`relay:yc:verify` proves).

## 5. Backup prerecorded procedure
Before the session, record one clean take of `npm run relay:yc` end-to-end
(e.g. QuickTime/OBS screen recording). Keep the recording OUTSIDE the
repository (e.g. `~/Recordings/`) — never commit captures. If the live run
misbehaves on stage, play the backup.

## 6. Simulation disclosure language (say this on camera)
"What you're watching is Relay's real orchestration engine — the state
machine, verification, review, and audit are all real. The agents
themselves are deterministic simulators for this demo; the terminal labels
every step SIMULATED, and no repository files are modified."

## 7. Do NOT run during recording
- Any command in the parent Sunday repo (deploys, migrations, live tests)
- `npm run relay -- demo budget-stop` mid-take (nonzero exit reads as a crash)
- `git` mutations, `npm install`, or editor windows over the terminal
- Anything requiring credentials — the demo needs none

## 8. Final recording checklist
- [ ] `npm run relay:yc:verify` passed immediately before the take
- [ ] One uninterrupted `npm run relay:yc` run captured
- [ ] Final RELAY COMPLETE screen held ≥ 3 seconds
- [ ] SIMULATED disclosure visible in-frame at the start and the end
- [ ] Narration matches docs/relay/YC_VIDEO_SCRIPT.md

## 9. OPTIONAL live Claude proof (Prompt 8 — separate segment, separate label)
The guaranteed product demo remains `npm run relay:yc` (simulated agents,
full Architect → Claude → independent Codex → review → repair → audit).
Optionally open the video with a short LIVE proof of one real Claude Code
agent inside Relay's isolated worktree:

```bash
cd /home/kaisinrogodfree5/sunday-relay
npm run relay:claude:live        # REAL Claude call — separate terminal, own segment
```

Rules for the live segment:
- Run it in its OWN terminal (nested Claude-in-Claude is not assumed safe).
- Label it clearly as the LIVE proof, distinct from the SIMULATED workflow.
- It shows: real Claude session, isolated worktree, one real edit, Relay
  independent inspection, Relay-run verification, live audit.
- On camera the audit says "Independent reviewer: not required by the
  low-risk policy" — never claim Codex reviewed the live result.
- `relay claude doctor` is a safe truthful pre-check (no model call).
- If the live proof stops safely, that is an honest outcome — do not retry
  the provider call repeatedly on stage.

## 10. `relay:claude:live` vs `relay:competitive` — say which is which

Two distinct proofs. Label them separately on camera; never conflate them.

**`npm run relay:claude:live` — the REAL agent proof (Prompt 8):**
- Real Claude Code, its own local subscription, an isolated Git worktree.
- One real edit to one claimed file; Relay independently inspects and runs
  the verification itself.
- NO independent Reviewer (the low-risk fixture does not require one — the
  audit says so explicitly).
- Run it in its own terminal (nested Claude is not assumed safe).

**`npm run relay:competitive` — the WORKFORCE orchestration proof (Prompt 8.1):**
- Deterministic full mission: Mission Contract, Claude Implementer, Codex
  Independent Reviewer, a high-severity finding, a scope-locked repair,
  evidence, and a Relay VERIFIED COMPLETE verdict.
- The Claude Implementer and Codex Reviewer are deterministic SIMULATIONS in
  this presentation; the EXTERNAL CODEX CONNECTION IS NOT ACTIVE.
- No provider call; instant with `--pace 0`, paced (~2.5s/frame) on a TTY.

On-camera framing: "This (competitive) is the full workforce Relay governs —
mission, specialized agents, independent review, repair, evidence, and a
Relay verdict, shown deterministically. And this (claude:live) is one of
those agents running for real inside Relay's isolated boundary. The agents
are replaceable; the mission, governance, and evidence stay with Relay."
Do NOT claim Codex is connected, and do NOT run `relay:claude:live` during
the deterministic segment.
