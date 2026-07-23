# Sunday Relay — Live Supervised Workflow (Prompt 8.4, authoritative)

The supervised workflow closes the workforce loop against REAL agents: one
live Claude Code implementer and one live Codex independent reviewer,
composed by Relay over the Prompt-7 isolated workspace, the Prompt-8.1/8.2
Finding/Repair ledger + reviewer release gate, and the CompletionPolicy.

Module: `src/relay/connectors/supervised/` — a composition over the two
approved live adapters. It spawns no process itself, writes no file into any
workspace, and never decides a verdict: every review verdict is the parsed
`RELAY_REVIEW_REPORT_V1` from the reviewer's own session, and every gate,
independence, finding, repair, visibility, and completion decision is made
by Relay Core surfaces (`evaluateReviewerGate`, `evaluateCompletionPolicy`).

## The workflow

```
real Claude implementation (isolated worktree, attempt 1)
  → Relay inspection            (claimed-only changes; protected paths intact)
  → Relay-controlled verification (Relay runs node --test itself)
  → OUTPUT HELD FOR REVIEW
  → real independent Codex review (read-only, exact contract, attested)
  → either
    PATH A — Codex genuinely approves
      → CompletionPolicy (requires the independent review) passes
      → VERIFIED COMPLETE (exit 0)
    PATH B — Codex returns a genuine validated finding
      → Relay creates Finding F-1 + Repair R-1 (linked, scope-locked)
      → the EXACT original Claude session resumes (one bounded repair)
      → Relay re-inspects + re-verifies
      → the EXACT original Codex session resumes (re-review)
      → VERIFIED COMPLETE only after a genuine approving re-review
```

Honest stops (output held, never RELAY COMPLETE): failing verification
before review (exit 3, no review is dispatched for a failing
implementation), `needs_human` (Manual-Task stop, exit 3), `blocked`
(exit 3), an unapproving re-review (exit 3 — the single Guided repair is
never exceeded), and every integrity rejection (exit 5): unclaimed/protected
implementer changes, reviewer file modification, session-identity mismatch
on either resume, invalid reports, failed attestation, failed independence.

## Permanent prohibitions

The workflow NEVER: plants a defect, writes deliberately incorrect code,
injects a controlled fault, emits a `demo.fault_injected` event, mutates
correct code to force a review failure, manufactures a Reviewer finding,
forces a `changes_required` verdict, forces a repair cycle, misattributes
work, or instructs any agent to make a mistake. These are boundary-tested
(`relay-core-boundary.test.ts` — Prompt-8.4 suite) and source-tested
(`supervised.test.ts`): the runner contains no workspace write, no seeded
defect reference, and no fault-injection event anywhere in Relay production
sources.

Offline fake adapters (the deterministic fake executables) may simulate
`approved` and `changes_required` outcomes ONLY to test orchestration
behavior. They call no provider and mutate no real implementation code; the
fake Claude writes the CORRECT reference implementation into the throwaway
fixture, and the scripted fake finding is labeled a SIMULATED reviewer
outcome that asserts no real defect.

## The fixture

The live fixture is the genuine Prompt-8 `safe-edit` task (implement
`normalizeProjectName` in a throwaway temp Git repository) — it contains NO
seeded defect. Whether the live Codex review approves (PATH A) or finds
something real (PATH B) is entirely the reviewer's genuine judgment; both
paths are first-class, fully implemented outcomes. The Sunday repository is
never used as a live workspace.

## Commands

- `npm run relay:supervised:contract-verify`
  (= `relay supervised contract-verify`) — Gate A: the offline proof of the
  ENTIRE workflow with deterministic fake executables for BOTH agents
  (PATH A, PATH B, repair limit, needs_human, blocked, reviewer
  modification, unclaimed changes, wrong-session rejections). NO provider
  call. Passes with `READY FOR LIVE SUPERVISED WORKFLOW`.
- `npm run relay:supervised:live`
  (= `relay supervised run --fixture safe-edit --confirm-live`) — Gate B:
  the explicit REAL supervised loop. FOUNDER-INITIATED ONLY: it is never
  run by any test, build, doctor, verification, or CI path, and requires
  `--confirm-live` (approval is never inferred from a TTY). Expected live
  calls: 2 (implementation + review); up to 4 when the reviewer genuinely
  requires the one bounded repair cycle.

Prerequisites compose both adapters' gates unweakened: Claude installed +
approved subscription sign-in + clean settings, Codex installed + local
login (never an API key) + read-only sandbox + clean config, and the single
explicit `--confirm-live`. Any failure surfaces as the same Manual-Task
shape used by the individual live commands (exit 5, no live call).

## Safety boundaries (unchanged, unweakened)

Isolated worktree only; source repository protected (verified before
completion); deployment disabled; git push prohibited; credential-free core
(both adapters strip provider keys; no credential is read, stored, or
printed); no fallback for either agent; read-only reviewer sandbox with
before/after workspace inspection; bounded runtime/output; hidden reasoning
omitted; secret-shaped output rejected; spend controls per Decision 1
(subscription/local-login sessions only — an API-key source is a Manual
Task, never a billed call).

## Status

- **Gate A (offline contract verification): PASSED** — 47/47 checks, twice,
  2026-07-22; typecheck, relay suite 462/462, full suite 2051/2051, all
  builds green; no provider call.
- **Gate B (live supervised run): PASSED via PATH A, 2026-07-22
  (founder-run).** The first `npm run relay:supervised:live` completed the
  full loop with exactly TWO live calls: the real Claude implementer
  correctly implemented the fixture on its first attempt (one claimed file,
  zero protected changes, source untouched), Relay independently ran the
  fixture tests (passed), output was held, and the real Codex reviewer
  GENUINELY returned `approved` on first review — verified-complete,
  repairs used 0 of 1, `RELAY COMPLETE`. No finding, repair, or resume
  occurred, and none is claimed. **The PATH-B conditional repair /
  exact-session re-review branch therefore remains OFFLINE
  contract-proven, not live-proven** — it runs live only if a future
  founder-authorized run genuinely elicits a blocking finding.
- **Accidental second invocation (audited):** a queued terminal line
  (`npm run relay:supervised:live cd …` — npm appends stray positionals,
  which the CLI ignores) executed immediately after the first run and ran
  to completion as a SECOND full PATH-A live run (2 additional live calls;
  its own Claude session + Codex rollout artifacts, cleaned up normally).
  It is NOT Gate-B evidence and is recorded only for call accounting. A
  further queued third invocation never executed (stopped by Ctrl+C — no
  npm invocation record, no artifacts), and an earlier typo'd
  `relay:supervised:live~` was rejected by npm (zero calls). Total live
  calls in the Gate-B window: 4 (2 authoritative + 2 accidental-complete);
  no uncertain calls.
- Durable cross-process session recovery remains unavailable (persistence
  is still queued); both exact-session resumes are in-process capabilities
  of a single live run.
