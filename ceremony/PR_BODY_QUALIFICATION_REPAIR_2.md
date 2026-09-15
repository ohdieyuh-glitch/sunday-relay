# Julius qualification repair for attempt 5: research is metered, delivered and proven, and the tick allowance follows the mission

Frozen candidate `relay/julius-qualification-repair-2`, 4 commit(s) over trusted main `44fd503a`, authored and committed by `julius-worker[bot]`.

Repairs required by paid qualification attempt 4 (run 34774471909), plus the founder-directed paid-run archive. Attempt 5 is dispatched automatically once this lands.

Paid qualification attempt 4 (GitHub run 34774471909, main 44fd503a) was VALID paid evidence and a FAILED mission. It made 77 real provider requests, about $10.42, with all three workers calling their providers, no ESTIMATE_NO_LEDGER, and reviewer isolation proven. The run ended READY at the fixed 32-tick ceiling.

This PR has four commits by julius-worker[bot] on main 44fd503a. The first three are the qualification repair batch. The fourth is the founder-directed paid-run archive. Research delivery (commit 2) and tick capacity (commit 3) were built by the Live Lab; the byte ledger (commit 1) and the archive (commit 4) by the Formal session.

REPAIR 1 — DURABLE RESEARCH BYTE ACCOUNTING (critical root cause), commit 1
- What was wrong: the live research ledger is rebuilt from `research.retrieved` rows, and those rows carried no byte count. Every past read was replayed as unsized, so a byte-budgeted mission refused every ask after its first read as `byte_budget_unenforceable`. Attempt 4 had 11 asks: 1 served and 10 refused within milliseconds. The three-per-slot allowance could never be used.
- Fix:
  - The mediator result, the port record and the durable row carry `bytes` plus `bytesRecorded: true`.
  - `projectDurableJuliusResearchLedger` replays the exact count.
  - A row without the marker, or with an invalid count, stays unsized and fails closed, never counting as zero.
  - The dump exports both fields.
- Proof, through the real pipeline, mediator, Live Reach and projection, with a fresh mediator per serve (a restart every time):
  - Three reads by one slot are all served, each row carries its bytes, and the rebuilt meter reads counted 3, unsized 0.
  - A genuinely spent budget refuses `byte_budget_exhausted` with no fetch.
  - Attempt 4 reproduced: a legacy unsized row refuses the next read `byte_budget_unenforceable` with no fetch. Six malformed-count cases are replayed as unsized.
  - 7 mutations killed. The Lab's attempt-4 reproduction A4-2 fails on 44fd503a and passes here.

REPAIR 2 — RESEARCH DELIVERY WITH PROVENANCE, commit 2
- What was wrong: the one page attempt 4 served (www.postgresql.org /docs/current/app-psql.html, 269,680 bytes) never reached the worker.
  - The resume skipped any block over 24,000 characters and falsely said the page was "in the durable evidence record; ask again".
  - The context compiler stopped at the first oversize entry and dropped everything after it.
  - The continuation after the served read grew by only 685 characters.
  - The record could not name the page.
- Fix:
  - The worker receives the page's readable text: markup stripped, entities decoded, anchors kept. That is whole when it fits (149,000 characters for a single ask); otherwise a labelled "EXCERPT: characters a–b of m" starting at the anchor the worker named or at the top, with the anchors that reach the rest.
  - A page is never dropped silently.
  - The compiler skips an oversize entry instead of stopping.
  - Packet budget per role: architect and coder 200,000 (HTTPS body and SDK stdin); reviewer unchanged at 24,000, because its prompt travels on Hermes argv.
- New provenance on `research.retrieved`: askOrdinal, resourcePath (no query or fragment), mechanism, contentDigest, readableChars, deliveredFrom, deliveredChars, deliveryCut, deliveryAnchor, handoffTaskId, handoffEntryId. There is no page text on the row.
  - `checkpoint.verdict` names the handoff and trail entries.
  - `context.compiled` records `researchAnswerIncluded`.
  - A run-wide reviewer-visible trail entry (host, path, bytes, digest, range, continuation) reaches later packets without the page.
- Proof, e2e through assembleLiveJuliusRuntime:
  - A 269,548-character psql-shaped page with the NULL-rendering fact at byte 163,593 reaches the continuation packet. It failed on 44fd503a exactly as in the run.
  - The chain ask → row → verdict → researchAnswerIncluded=true → the reviewer's and coder's packets carry the trail and not the page.
  - An excerpt followed by an anchored re-ask gets the fact within 300 KB.
  - Replaying the same store adds no fetch or row.
  - The reviewer packet stays ≤24,000 characters with 60K of context.
  - The real app-psql.html through the real mediator delivers the fact (Lab measurement, not committed).
  - 19 mutations killed.

REPAIR 3 — MISSION-AWARE TICK CAPACITY, commit 3
- What was wrong: the workflow and drive hard-coded 32 ticks, sized for a 6-task graph. Attempt 4 (33 tasks, 39 checkpoints) hit it at 44 minutes of a 120-minute job, inside every contract bound. The run stayed READY and nothing said why.
- Fix: `planJuliusTickBudget` derives the budget from the mission's own structure, with no new constant.
  - planned = Σ units × (repairCycles+1) × lineage (architect S+1, coder 3S+1) + 1; for julius-continuous-1, 73.
  - hard_max is every permitted path at its attempt bound: 1,729.
  - `juliusTickAllowance` recomputes the allowance each tick from the run's rows. It grows only for paused review/guidance continuations, repaired guidance and retries. A fan-out buys no ticks.
  - An operator `max_ticks` only tightens.
  - Exhaustion moves the run to FAILED with one `run.failed` row, `tick_budget_exhausted`, carrying planned, allowance, consumed, hard max, retries and override.
  - The entrypoint prints planned_tick_budget / hard_max / wall-clock deadline before dispatch, and consumed / allowance / remaining after.
  - The workflow's `max_ticks` defaults to `derived`, and MAX_ALLOWED=32 is removed.
- Proof:
  - Attempt 4's 33 real rows: allowance 73, beyond-main-path 0; a decision was reachable by tick 47.
  - Attempt 3's rows: fan-out adds no allowance.
  - E2e attempt-4 shape: fixed 32 → READY; derived → COMPLETED at tick 35; tightened to 20 → FAILED with every number; override 5,000 cannot loosen 73; a retry adds exactly one.
  - Workflow gate cases.
  - 15 mutations killed.
- Wall clock, kept distinct: attempt 4's median tick was 80.8 s, so 73 ticks ≈ 100 min fits the 120-min job; attempt 3's pace would not. The expected qualification path is ≈47 ticks (≈63 min). The 280-minute job budget (Lab 3556ea01) is NOT included: this derivation does not justify it.

COMMIT 4 — PAID-RUN ARCHIVE (founder directive; not a qualification repair)
- The workflow uploads `julius-live-evidence` with 90-day retention, not 14. A new step after upload and before teardown writes PAID_RUN_ARCHIVE_EXPORTED only when the bundle really uploaded; otherwise PAID_RUN_ARCHIVE_FAILED with an error annotation.
- `scripts/julius-paid-run-archive.mjs import|list|show|scan` imports into local `julius-postgres` (named volume `julius-postgres-data`), database `julius_archive`, schema `paid_runs`.
  - Keyed on workflow_run_id and workflow_run_attempt.
  - Credential-shaped content refused before persistence.
  - Duplicates are a no-op; conflicting artifacts are refused.
  - Qualification attempts 1–4 are already imported locally, and survived a restart and a container recreate; the scan is clean.

INDEPENDENCE AND COMBINED PROOF
- Repair 1 alone on 44fd503a: its suites pass (10 new tests, 537/538 related; the one failure is Windows noise also on clean main).
- Repair 3 alone on 44fd503a: applies clean, typecheck clean, 192/192 (tick unit, tick e2e, first-live-mission, harness export).
- Repair 2 is NOT independent of Repair 1: its provenance fields extend Repair 1's durable row and port record, and it does not apply without it. It was proven at its stacked position: 549/549 across delivery e2e, byte ledger, research, runtime, live-composition, peer-qualification, mission-slice, qualification fixture and first-live-mission. Its delivery behaviour does not depend on the byte count.
- Archive alone on 44fd503a: 15/15, boundary PASS.
- Interactions: Repair 3 touches neither the pipeline nor research. Repairs 1 and 2 share the `research.retrieved` row, and the projection reads only `bytes`/`bytesRecorded`. Delivery working reduces re-asks and so ticks.
- Full stack at head, verified independently by the Formal session:
  - The commit trees are identical to the Lab's proven trees.
  - Typecheck clean (4 projects); repository boundary PASS; `git diff --check` clean.
  - All Julius kernel suites 1174/1174.
  - 608/609 across tick e2e, delivery e2e, byte ledger, mediator, live-composition, peer-qualification e2e, timeline binding, research authority, first-live-mission, qualification fixture, mission slice, harness export, test accounting, archive, paid dispatch, paid workflow and preflight gates. The one failure, `julius-research-authority` 22, fails identically on clean main on this Windows host.

KNOWN RESIDUALS, NOT IN THIS PR
- A very large diff plus test log can exceed Hermes's argv limit. This is pre-existing and not introduced here; the review-packet file transport (Lab 2859a6fe) addresses it in the M6 batch.
- A reviewer's own research answer is cut at 8,000 characters. Attempts 3 and 4 had zero reviewer asks.
- Architect cost stays booked at the synthetic 300,000 µ$ hold until truthful peer settlement lands in the M6 batch.
- The terminal-halt fix (Lab 462aa41f) is excluded: attempt 4 did not exercise it.

COST NOTE: with delivery working, a research continuation adds about $0.16 for the architect and about $0.66 for the coder at list prices, so about $0.80 per mission is expected.

ATTEMPT 5 dispatch will pass no `--max-ticks`, so the derived allowance governs.

No provider was contacted by these proofs.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
