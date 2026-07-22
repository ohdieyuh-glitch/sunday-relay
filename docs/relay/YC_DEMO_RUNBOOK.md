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
