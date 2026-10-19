# Sunday Relay — Live Codex Review (Gate B runbook)

> Added in Prompt 8.3 (2026-07-22). The explicit, founder-approved REAL Codex
> independent review. It proves Relay can assign an implementer's work to a
> DIFFERENT live provider as an independent reviewer, inside a read-only
> isolated worktree, and correctly HOLD the output when the reviewer finds a
> real defect. The successful proof ends STOPPED SAFELY — never RELAY COMPLETE.
> Not part of any test, build, doctor, demo, mission-control, or contract
> verification. Do NOT run during YC-demo recording.

## What it does

`npm run relay:codex:live` (`relay codex run --fixture review-defect
--confirm-live`) performs the full live review flow on a **throwaway fixture**
(never the Sunday repository):

1. Build a throwaway git fixture with a seeded behavioral defect and commit the
   clean baseline.
2. Create an isolated Relay worktree from the baseline; seed the implementer's
   change (the defect) into the worktree (labeled FIXTURE INPUT, standing in
   for a live Claude implementation).
3. Confirm only the claimed file (`src/dispatch.js`) differs.
4. Build the Mission Contract + a fixture Implementer attestation.
5. Relay-run the existing (incomplete) fixture tests — they PASS with the
   defect, which is exactly why an independent reviewer is required.
6. Transition output to **held_for_review**.
7. Compile the Codex Reviewer handoff; show the explicit live-approval screen.
8. Launch REAL Codex read-only; verify initialization; capture the session id;
   stream safe reviewer activity.
9. Receive the structured review-report CLAIM.
10. Re-inspect the workspace — the reviewer must have changed ZERO files.
11. Build + validate the Reviewer Execution Attestation; validate independence;
    validate the report.
12. Create the blocking finding + linked repair; transition output to
    **revision_required**; keep findings open.
13. Confirm the source fixture is unchanged; clean the workspace.

## The seeded defect

Mission requirement: provider dispatch must be blocked when EITHER the actor is
rate-limited OR the global spending breaker is active. The seeded implementer
change blocks only when BOTH are true (`&& ` instead of `||`). The included
tests cover only neither-active (allowed) and both-active (denied) — they pass
while leaving a real behavioral + test-coverage gap. Expected reviewer verdict:
**changes_required**, one high/critical blocking finding tied to acceptance
criterion AC-1, required action bounded to changing `&&` to `||` and adding the
missing single-condition tests, no unrelated redesign. The reviewer output is
**not** hardcoded — the live smoke succeeds only when the REAL Codex report
validates and contains an actionable blocking finding.

## Exact Gate-B command (separate terminal)

Run in a NORMAL terminal (nested agent execution is not assumed safe):

```bash
cd /home/kaisinrogodfree5/sunday-relay
npm run relay:codex:live
```

The approval screen states: uses your existing local Codex account; role
Independent Coding Reviewer; workspace isolated Relay worktree; access read
only; files Codex may modify: none; source repository will not be modified;
deployment disabled; git push prohibited; fallback reviewer disabled; expected
live calls: 1. In non-interactive mode `--confirm-live` is required; approval
is never inferred from a TTY.

## Prerequisite: sign in to Codex first

The local Codex must be **signed in** (`codex_local_login`). If it is not, the
command stops with a "Sign in to Codex" Manual Task and makes **no** call:

```bash
codex            # complete the sign-in, then close Codex
codex login status   # should report signed in
```

Note: `codex login status` prints `Logged in using ChatGPT` on **stderr**
(exit 0). Relay's canonical preflight probe reads **both** stdout and stderr
and requires exit 0, so a stored ChatGPT login is recognized. Doctor, the
Gate-B preflight, live-launch eligibility, and the Manual Task recheck all use
this same probe.

Relay never asks you to paste an API key. An explicit API-key environment
source causes Relay to stop rather than launch.

## Expected successful output (abridged)

```
SUNDAY RELAY — LIVE INDEPENDENT REVIEW
[LIVE] LIVE CODEX REVIEWER / READ-ONLY WORKSPACE / INDEPENDENT FROM IMPLEMENTER
SOURCE REPOSITORY PROTECTED / DEPLOYMENT DISABLED / GIT PUSH PROHIBITED / FALLBACK DISABLED
RELAY VERIFICATION  [PASS] Existing fixture tests ... [PASS] Source-worktree protection
OUTPUT  HELD FOR REVIEW
CODEX REVIEWER  Structured review received. This is a claim pending Relay validation.
RELAY ATTESTATION  Requested/Actual Reviewer: Codex · Launch verified: Yes · Sandbox: Read only · Fallback: None
INDEPENDENT REVIEW  CHANGES REQUIRED
REPAIR LEDGER  Finding F-1 created. Repair R-1 created. Output remains held.
RELAY STOPPED SAFELY  The implementation requires repair and re-review before release.
```

Exit-code contract: **3** = review executed and output correctly HELD (the
successful Gate-B outcome for the seeded defect); **5** = rejected / prereq
failure / reviewer modified files / independence failure / invalid report;
**0** = review approved AND released (not the seeded-defect case). A
changes-required review never prints RELAY COMPLETE — the proof succeeds
because Relay correctly BLOCKS release after finding a real defect.

## Limits + safety

Maximum live reviewer calls this phase: 2 (expected 1). Runtime ≤ 6 min,
stdout ≤ 1 MiB, stderr ≤ 256 KiB, ≤ 20 findings. Network disabled; file writes
prohibited; no automatic retry; repair execution is not part of this phase. If
the first review fails, Relay preserves safe diagnostics, identifies one root
cause, and applies at most one focused repair — asking before a second live
call.

## What this proves (and what it does not)

- Proven: Relay assigns work to a DIFFERENT live provider as an independent,
  read-only reviewer; Relay (not Codex) decides launch verification, report
  validity, independence, whether findings block, and whether output stays
  held; the reviewer changes zero files and never touches the source; no
  fallback, no deployment, no push.
- Not yet: durable cross-process reviewer recovery (needs persistence); the
  live Claude repair + Codex re-review loop (Prompt 8.4). The Reviewer is real
  Codex here — not a simulation.

## Gate-B result (2026-07-22): PASSED

Gate B **passed on the second command attempt** with exactly **one** live
Codex call (codex-cli 0.145.0, founder-run in a separate terminal). The first
attempt stopped BEFORE any provider launch and consumed no call: the login
probe read only stdout, but `codex login status` prints `Logged in using
ChatGPT` on **stderr** (exit 0), so a real login classified `not_ready` and
incorrectly raised the "Sign in to Codex" Manual Task (exit 5). That probe
defect was repaired (canonical both-streams probe, above) before the passing
attempt.

Observed live proof: real Codex reviewer started; requested & actual reviewer
both Codex; launch verified; read-only sandbox; no fallback; verdict
**changes_required**; blocking finding "Single active safety control does not
block dispatch" (the seeded defect, tied to AC-1); Finding F-1 and Repair R-1
created; output remained held; RELAY STOPPED SAFELY; no RELAY COMPLETE claim.
No repair or re-review was performed in Prompt 8.3 — that loop is Prompt 8.4.
Durable Reviewer recovery remains unavailable (needs persistence).
