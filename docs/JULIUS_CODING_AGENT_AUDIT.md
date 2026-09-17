# Julius Coding Agent — current-state audit, gaps, and the PR 3 boundary

Audited at trusted main `8f3ea7e15366124af184729553bfc6571eb197e7` (after PR #271).
Read-only mapping of the live Coding Agent path, the kernel boundary it
crosses, its continuation and durability model, and its tool authority and
failure model. Every claim below was traced to a line; the ones this PR acts on
were then reproduced by a failing test before being fixed.

The founder's rule this audit is measured against: **these are Julius roles, not
providers.** The Coding Agent may be Claude Code today and Codex or Devin
tomorrow, and nothing about mission authority, review, findings, guidance or
completion may change when it is swapped.

---

## A. What exists today

### Already right, and provider-independent

| Area | What holds | Where |
|---|---|---|
| Review cannot be skipped | `evaluateJuliusVerification` checks `reviewerRequired && !reviewCompleted` before any evidence; a review is a SUCCEEDED INDEPENDENT_REVIEWER child | `julius-verification-runtime.ts:25`, `julius-memory-store.ts:833` |
| No self-release | `releaseTaskIds` is computed by Julius from ACCEPT/COMPLETE decisions; worker output cannot name tasks to release | `julius-task-pipeline.ts` (`evaluateJuliusRelease`) |
| No self-resolution | Findings move to ADDRESSED only by Julius after a repair dispatch, and RESOLVED/SUPERSEDED only through a reviewer's `resolutions` | `markFindingsAddressed`, `applyFindingResolutions` |
| No contract edit | A coder dispatches only under a LOCKED contract; `contractProposal` is refused `contract_already_locked` | `prepareClaimedTask`, `proposeContractRevision` |
| Peer direction | `GUIDANCE_QUESTION` only CODING_AGENT → PROMPT_ARCHITECT, mediated by Julius; the coder never creates tasks | `julius-peer-channel.ts` direction table |
| Accepted guidance only | Proposals scoped to the architect task; delivery on ACCEPT only; rejected packets never reach the coder | PR #271 |
| Executor-captured evidence | `base`, `diff` and `test` run through the independent executor with signed receipts; the provider cannot author them | `live-workers.ts` hosted adapter |
| Budget ceiling | The dispatch allocation is the runtime's `maxBudgetUsd`; below one cent is refused before launch | `live-workers.ts`, `hosted-runner.ts` |
| Participation channels | Only `guidanceRequest`, `researchAsks`, `segmentResume`; any other key refuses the block | `julius-worker-participation.ts` |

### Claude-Code-specific (correctly or not)

`createLiveHostedCodingAdapter` is one function that does **both** the governed
Julius work (prompt assembly from the compiled packet, executor base/diff/test,
participation parsing, evidence shaping, failure mapping) **and** the Claude
Agent SDK execution. A Codex- or Devin-shaped adapter would have to copy the
Julius half. The hosted failure vocabulary (`coder_provider_error_after_init`,
`hosted-failure-reason.ts`) also reaches the kernel's diagnostics allowlist.

### Durable vs process-local

- **Durable:** task rows and lineage, contract bindings on `task.claimed`,
  context snapshot ids, evidence rows, decisions, findings and their lifecycle,
  guidance/peer/checkpoint/research events, brain entries (guidance request,
  segment resume, research answer, guidance proposal and answer, decisions).
- **Process-local:** the `LiveArtifactExchange` (`plan`, `diff`, `base`,
  `test-output`, keyed per RUN and overwritten per dispatch), the compiled
  snapshot cache, the raw participation channels between result acceptance and
  the pause logic, and the workspace tree itself (the only carrier of segment
  progress).

### Derived state

Architect and reviewer have projections (`STANDBY / PLANNING / … /
CHECKING_ALIGNMENT`, `STANDBY / OBSERVING / … / FINAL_REVIEW`). **The Coding
Agent has none**; it appears only as an input to the reviewer's.

---

## B. Gaps, relative to Architect and Reviewer rigor

Severity is what the gap can do on a real mission, not how hard it is to fix.

### Authority at the result boundary

1. **HIGH — evidence type and id are the worker's.** Any string is accepted as
   `type` and any `evidenceId` is kept (`julius-execution-coordinator.ts:195`).
   A coder can report `REVIEW_FINDING`, `USER_APPROVAL` or `SECURITY_SCAN`
   PASSED, which then counts toward acceptance criteria from any task, and can
   pre-empt the id a later review's evidence will need.
2. **MEDIUM — foreign-role channels vanish without a record.** A coder result
   carrying `reviewVerdict`, `architecture`, `consistency` or `rebuttal` is
   dropped by a role gate with no event; `guidance` and `contractProposal` are
   refused only by task-id shape and lock state, not by role.
3. **MEDIUM — a worker-reported FAILED status stalls the run.** The task goes
   FAILED but verification still mints a RUNNABLE review of a FAILED task that
   the claim query never offers.
4. **No authority guard on coder output** comparable to
   `guardJuliusPeerResponse` for the architect and reviewer.

### Guidance and continuation

5. **HIGH — delivery happens after release.** `appendDecision` releases the
   waiting continuation before `deliverAcceptedGuidance` runs, and delivery is
   skipped on a replayed decision. A crash between the two releases the coder
   without its answer, permanently.
6. **MEDIUM — the segment ceiling is checked after the guidance task is
   created,** so a question nobody will wait for still buys an architect
   dispatch and its review.
7. **MEDIUM — accepted guidance does not survive a repair.** Carry-forward
   follows the segment lineage only, and a repair is its own root.
8. **MEDIUM — a paused repair loses its findings.** For
   `segment:repair:X:…`, the repair context, round diff, `markFindingsAddressed`
   and resolution subjects all read the segment's parent (the repair) rather
   than the unit the findings are on.
9. **No durable record of which accepted guidance a dispatch consumed** — only
   a count on `worker.effort`, and carried copies emit nothing.
10. **Unreadable or refused guidance requests leave no reason code,** and a pause
    that creates no continuation is never told to the next packet.

### Tool, file and worktree authority

11. **HIGH — contract scope is prompt-only.** `permittedPaths`, out-of-scope
    files and `prohibitedActions` are never checked against what the coder
    actually changed; the observed `toolTargets` are unused.
12. **MEDIUM — DIFF evidence is PASSED regardless of content.** An empty diff
    passes; untracked (new) files are invisible to `git diff`; the artifact is
    keyed per run, so a failed capture in a repair round leaves the previous
    round's diff in front of the reviewer.
13. **HIGH (adapter) — no Relay-enforced confinement inside the hosted session.**
    `allowedTools` auto-approves but does not restrict; `tools`, `canUseTool`,
    `hooks`, `sandbox` and `strictMcpConfig` are unset; `HOME` is passed through.

### Provider failure model

14. **HIGH — transient provider failures end the mission.** A 429, an overload,
    a 5xx or a dropped stream after init is `WORKER_EXECUTION_FAILURE`,
    non-retryable; the coder never emits `RATE_LIMIT` or `PROVIDER_UNAVAILABLE`.
15. **MEDIUM — no class for credit exhaustion, malformed output, context
    overflow, process exit or an unavailable continuation.** Credit exhaustion
    (Attempt 5's actual failure) lands as `provider_bad_request` or
    `unclassified`.
16. **MEDIUM — a paid session followed by an executor refusal is settled at $0,**
    because the executor error carries no provider cost.
19. **LOW — a tool count the provider never reported is recorded as zero.** The
    adapter wrote `toolCalls: toolInvocations ?? 0`, so a provider with no tool
    count (a Codex-shaped task API) read as a coder that used no tools, and the
    effort parity reading counted it as measured. Found while building the
    three-peer proof.

### Adapter-internal (Claude Code), noted for the live lane

17. Coordinator deadline ignores executor time; the abort signal is not
    forwarded; the workspace is not reset between attempts.
18. The usability gate reads `is_error` only, not the result subtype or
    `terminal_reason`.

---

## C. The PR 3 boundary

**PR 3 — the Coding Agent as a governed, provider-neutral peer.** Everything
below is provider-free and provable offline. It closes gaps 1–12, 14–16 and 19.

1. **Coding Agent provider contract and result authority.** A kernel-level
   provider-neutral request and outcome contract with a typed failure taxonomy;
   evidence types checked against the producing role, evidence ids minted by
   Julius; foreign-role channels refused with an event; a FAILED status that
   cannot stall a run. The live adapter is split into a Julius-side
   **Coding Agent adapter** and a **provider port**; the hosted Claude Code
   runner becomes one implementation of that port.
2. **Scope and evidence honesty.** Julius computes the changed-path set
   (tracked and untracked) through the executor and checks it against the
   locked contract; a violation is FAILED evidence Julius authored. Empty diffs
   are not PASSED; a dispatch clears the previous diff and test output before it
   runs, so a failed capture never leaves another round's diff for the reviewer.
   (Corrected in PR 4: this line first said artifacts were keyed per task. They
   are still keyed per run; only the clearing shipped.)
3. **Guidance on the coder side.** A continuation is guaranteed its accepted
   answer before it runs, even across a crash (delivered at claim when the
   decision's own delivery was lost, once per packet); the ceiling checked
   before anything is spent; accepted guidance carried into repairs; paused
   repairs keep their findings; a durable `guidance.consumed` record per
   dispatch, and a refusal when the accepted packet would not fit; an
   unreadable request named on its checkpoint.
4. **The sustained coder.** A Coding Agent state projection derived only from
   durable facts, and an `architectureObservations` channel through which a
   coder can surface drift evidence into PR #271's consultation path without
   ever writing architecture.
5. **Swappability and the three-peer proof.** Claude-Code-shaped, Codex-shaped
   and generic Coding Agent fixtures behind the one port, and a provider-free
   mission exercising all three roles end to end under each — through the live
   composition root and the production Coding Agent adapter — including a
   provider failure during a repair, a role reaching for another's authority,
   and the effort parity reading as an observation that stops nothing.

### Deliberately NOT in PR 3

- **Hosted-session confinement (gap 13) and the adapter-internal items (17–18).**
  These change what the real Claude Agent SDK is allowed to do. They can be
  written offline but can only be *proven* against the real runtime, and a wrong
  `tools` or `canUseTool` setting fails the next paid qualification rather than
  a test. They belong in a separate adapter-hardening PR gated on a live smoke
  check. Until then, gap 11's Julius-side scope check in PR 3 is the backstop:
  whatever the session touches outside the contract is caught and failed after
  the fact.
- **A durable artifact store** for `plan`/`diff`/`test-output` (process-local
  today, and still keyed per run). Keying them per task and making them survive a new process is a
  persistence change with its own migration.
- **Telling the next packet that a pause did not continue** (gap 10, second
  half). Several refusals — direction, unroutable, in flight, ceiling — end a
  pause without a continuation, and the half-done dispatch is reviewed as it
  stands. Each refusal is on the record by name; carrying it into the next
  worker's context is a protocol change of its own.
- **Project Brain coupling.** Coder facts are shaped as ledger events and brain
  entries Project Brain can adopt later; no second memory system is introduced.

---

## D. Tests and mutations required

### Proofs

- Coder evidence of a reviewer-only or approval type is refused; ids are
  Julius-minted and cannot collide with a review's.
- Every foreign-role channel from a coder is refused with a named event.
- A worker-reported FAILED status ends in a decided state, never READY limbo.
- Each typed provider failure maps to the right code and retryability, and none
  produces SUCCEEDED, evidence, a review task or a decision.
- An edit outside the permitted paths is caught from the executor's changed-path
  set, including an untracked new file; an empty diff is not PASSED.
- A crash between decision and delivery still delivers on resume; a continuation
  never runs without its accepted answer.
- A question past the segment ceiling mints no architect work.
- Accepted guidance reaches repair rounds; a paused repair's re-review still
  sees and can resolve the original finding.
- `guidance.consumed` names exactly the entries a dispatch's packet held, and a
  replay does not duplicate it.
- The coder state projection derives each state from facts alone and survives a
  JSON round trip.
- A coder architecture observation raises the matching consultation trigger and
  records no architecture revision.
- The three-peer mission reaches the same Julius decisions, findings, guidance
  and completion under each Coding Agent fixture, and no component can act as
  another role.

### Mutation targets

Coder self-verification · rejected-guidance leakage · lost accepted guidance ·
bypassed review · wrong repair lineage · unauthorized task release · provider
failure becoming success · architecture mutation by the coder · peer-channel
bypass · stale continuation · duplicate result replay · task/evidence identity
collision · cross-mission leakage · permission/scope expansion · provider
failure class leaking into kernel authority.
