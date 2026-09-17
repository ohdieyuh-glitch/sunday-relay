# Julius PR 4: completion truth — an unresolved finding, a colliding identity or a failed review research can no longer let a run claim what the record does not say

The smallest coherent provider-free PR from the post-#275 residual audit: the
three HIGH-severity truth defects, and nothing else. Each was **reproduced on
main `5c53cb93`** with a provider-free probe before it was fixed.

No provider was called, no credential was read, and there was no Anthropic,
OpenAI or xAI spend of any kind. No qualification setting changed.

---

## 1 · A finding the lifecycle says is unresolved never lets a run complete

**Reproduced:** build rejected → repaired → re-review passes and says nothing
about the finding → repair accepted → run `COMPLETED` with the finding
`ADDRESSED`.

- **One source of truth.** The ledger lifecycle decides. The finding row is
  written `OPEN` and never updated, and verification read it. Every reader now
  reads `juliusEffectiveFindings` (the row with its status replaced by the
  lifecycle's); the pipeline reads finding rows only to fold them, held by a
  structural test.
- `OPEN` and `ADDRESSED` are unresolved; `RESOLVED` is resolved; `SUPERSEDED`
  is resolved only when the replacement it names is a finding the run recorded.
- **Silence is not resolution.** A repair's re-review is charged with every
  unresolved blocking finding of its unit. One it leaves `ADDRESSED` is refused
  by name (`review.verdict.refused` · `review_resolution_missing`, once), stays
  unresolved, and the repair is `HALT`ed with `FINDINGS_UNRESOLVED` rather than
  accepted. One it says is still `OPEN` buys the next repair round.
- **The whole unit, every round.** A repair and its re-review are shown,
  charged with and address every unresolved finding of the unit — not only the
  round directly repaired. Without this, a finding raised on round one and
  answered "still open" was never shown again, and any multi-round repair would
  have stranded under the new rule.
- **The run loop's gate.** A run with an unresolved blocking finding never
  becomes `COMPLETED`; where it stops `VERIFYING` or `BLOCKED` for a generic
  reason, the recorded reason is `FINDINGS_UNRESOLVED`. It can only hold.
- **Found on the way — the live reviewer could not answer at all.** The domain
  charter told reviewers to answer findings in `resolutions`, but the Hermes
  reviewer's JSON schema had no such field and `hermesReviewVerdict` carried
  none, so no finding could ever be resolved on the live path. Under this PR's
  rule that would have halted every live mission with a repair. The schema, the
  parser and every verdict shape now carry `resolutions`; the prior-findings
  heading asks for them by id and says what silence costs.

## 2 · Two runs in one database never share an architecture identity

**Reproduced:** two runs in one store → run 2's pre-completion check task
(`architecture:arch:PRE_COMPLETION_CHECK:r1:run:task`) collides → recorded
`served:false` → read by the gate as unroutable → run 2 `COMPLETED` with no
assessment. `brain:architecture:r1` collided the same way on the global
`entry_id` key, so run 2's workers were never shown its design.

- `architecture:<runId>:<triggerId>:task` and `brain:architecture:<runId>:r<N>`.
- **A storage fact is not a routing fact.** The gate passes only a genuinely
  unroutable check; a routable check that was not created holds as
  `ARCHITECTURE_CHECK_NOT_CREATED`. A replay that finds its own task already
  minted records the trigger served (`created:false`).
- Proven on the **real PostgreSQL** schema in the existing `first-live-topology`
  job, including that the pre-PR-4 shapes really do collide there.

## 3 · A review whose research failed is not a review

**Reproduced:** reviewer approves-and-asks → research continuation fails → the
paused dispatch counts as a completed review → plan `ACCEPT`ed with no verdict
applied, contract locked, Coding Agent dispatched and paid → run fails.

- `juliusReviewConclusionOf` reads the task rows: `CONCLUDED`, `PENDING`,
  `RESEARCH_FAILED`, `FAILED`, `NONE`. The pipeline and `canStillBeAccepted`
  share it; the store's `reviewCompletedFor`, which counted any succeeded
  reviewer child, is removed from the port, the memory store and PostgreSQL.
- `RESEARCH_FAILED`: no decision, no acceptance, no release of dependents, no
  verdict fabricated, `review_research_continuation_failed` written once, and
  the run fails rather than waiting for a review that can never come.

---

## Proofs

Three commits, all authored and committed by julius-worker[bot]:

1. **The three fixes**, the live reviewer's `resolutions`, unit-wide finding
   charging, the `answerFindings` fixture, and the proofs below.
2. **What the mutants found** — including one more defect: a crash between
   refusing a silent re-review and writing the HALT was resumed by verifying the
   repair *itself*, which skipped the charge and wrote `ACCEPT` beside the later
   `HALT`. The charge now belongs to the repair's concluded review, whichever
   task a verification entered through.
3. **The repair-loop capability drill's reviewer answers the finding it raised.**
   CI's `first-live-topology` job runs the REPAIR LOOP drill against real
   PostgreSQL, and at the first head it failed exactly as it should: its
   scripted re-review was silent, so Julius held the mission `FINDINGS_UNRESOLVED`.
   The drill proves a repair loop, not a silent reviewer; its reviewer now
   answers by id and the mission completes through the repair. Nothing the drill
   checks was relaxed.

**`julius-completion-truth.e2e.test.ts` (13)** — silent re-review held
(`BLOCKED`/`VERIFYING`, never `COMPLETED`, reason `FINDINGS_UNRESOLVED`, refusal
by name, dependents unreleased); explicit `RESOLVED` completes; maintained
`OPEN` is repaired again then resolved; a legitimate supersession names its
replacement, which must itself be resolved; a round-one finding is shown to and
answered by round three's review and repair; replay and restart write nothing
more; a crash between refusal and decision refuses once and decides once; two
runs in one store each get their own check, assessment and architecture entry
and run B's coder is shown run B's design; a crash between minting and recording
the check replays as served; a failed review research decides nothing, dispatches
no coder, fails the run and names why once; a pending one resumes nothing; a
successful one decides as before.

**Units** — lifecycle unresolved/supersession rules, the projection in both
directions, the completion gate (forged supersession, JSON round trip); every
review conclusion from task rows and liveness agreeing with it; run-scoped ids;
`NOT_CREATED` vs `UNROUTABLE`; Hermes asks for and carries `resolutions` on every
verdict shape; a structural proof that the pipeline reads finding rows only to
fold them.

**Real PostgreSQL** — `julius-run-scoped-identity.real-postgres.test.ts`, run as
a new step of the existing `first-live-topology` job: runs A and B each create
their check task and architecture entry, and the pre-PR-4 shapes really do
collide on that schema, so the proof is not vacuous.

**Existing proofs** — the 33 whose re-reviews were silent now answer by id
(`answerFindings`); no other assertion in them changed.

## Mutation testing

| Set | Run | Killed | Equivalent |
|---|---|---|---|
| PR 4 — the founder's eight targets and every guard around them | 24 | 23 | 1 (removed) |
| PR 1 + PR 2 + PR 3 regression, at this head (6 re-anchored, none skipped) | 133 | 131 | 2 |
| **Total** | **157** | **154** | **3** |

- **P4-M11 — equivalent, and the code removed.** Excluding findings a re-review
  itself raised from its charge could never change a decision: such a finding is
  `OPEN` on the work under review, so the evaluator already repairs over it, and
  the charge only overrides an `ACCEPT`.
- **C3-M16 and P3-M15** — the equivalents documented at #270 and #275.
- First runs killed 19/23 (PR 4) and 130/133 (regression). Closed by proofs:
  P4-M08, P4-M10 (whose proof found the crash defect; P4-M24 added and killed),
  P4-M21 (with the outright-failed-review proof in its list), and PR 1's C2-M17,
  which PR 4's single review rule had turned from a wrong decision into silent
  duplicate work — now proven absent.

## Gates at the frozen head

Frozen head `d0a4715e0373597552897e1a0800a23c0454371a`, tree
`b499cd86f64c6009880ff7409ca2bf9607b5076a`, on trusted main
`c6ffff10c176dcd42e768d6db66a60d5492a40a9`.

- `npm run typecheck` (four passes) — exit 0
- `julius:harness:check` — OK, manifest unchanged; `git diff --check` — clean
- `relay-repository-boundary.mjs`, `build`, `relay:build`, `relay:bridge:build`,
  `relay:hermes:build`, `relay-parity-gate.mjs`, `relay:surface-parity:check` and
  `:strict`, `relay:yc-demo:check`, `relay:cli:contract-verify` — all exit 0
- Julius kernel, bridge, hosted, Hermes reviewer, harness and bundle-export
  suites — 113 files, 2503 tests, 0 failed
- Broad `vitest run` in twelve shards on this Windows workstation, compared
  failure by failure against trusted main in a separate worktree: 11 814 tests;
  147 failing on the branch against 156 on main. The one branch-only failure
  (`ci-test-accounting`: an early `return` in the new PostgreSQL proof's
  `afterAll`) is fixed at this head; the ten main-only failures are load-sensitive
  git/worktree tests that passed on the branch. Everything else fails identically
  on both (Windows file modes, `ps`, provenance CLI stubs).

CI at this head: **Verify Relay**, **first-live-topology** (both receipt
transports — including the new real-PostgreSQL identity step and the three
capability drills), **sibling-control-plane** and Vercel — all green. The
workstation gates above ran at the second commit; the third changes only the
drill script, and its typecheck and drill tests pass here.

## Not in this PR (future boundaries, unchanged)

Hosted Claude Code tool confinement (`canUseTool`, `strictMcpConfig`, `HOME`),
live SDK cancellation, Coding Agent workspace reset, lease renewal, a durable
artifact store, drift-to-repair routing, generic failed peer-dispatch recovery,
pause-truth cleanup, Project Brain coupling and cross-mission architecture
memory.

**A live consequence to know about:** a live repair now completes only if the
reviewer answers each finding by id. The Hermes reviewer is now asked to and
able to; whether real reviewer runs comply reliably can only be observed on a
paid run.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
