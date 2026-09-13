# Julius qualification repair: a valid fixture for attempt 4, deep repair tasks reach the executor, and pauses stop forking repairs

Frozen candidate `relay/julius-qualification-repair`, 4 commit(s) over trusted main `9fc999f7`, authored and committed by `julius-worker[bot]`.

Amended in place for PR #268: the Live Lab's repair fan-out fix (parts 1 and 2) added before approval. The PR already exists, so this opener will refuse; the pins record what the founder approves.

Four worker-authored commits on main 9fc999f7. All four are required by paid qualification attempt 3: run 34766115321, VALID paid evidence, 114 real requests, about $11.87, stalled at 32 ticks. Attempt 4 is dispatched automatically once this lands.

CRITICAL BLOCKER: a deep repair task reaches the executor, and any executor refusal says what it was (commit 1)
- What was wrong: the coder repair task `repair:segment:repair:repair:repair:segment:repair:run:…:1:task` is 134 characters. The executor validates task ids to 128 and refused its sandbox with `INVALID_REQUEST:executor_operation_invalid:identity.taskId`. The durable failure row had no class, again.
- Fix, task id: `executorTaskId` passes an id that fits through unchanged. A longer id becomes `t-` plus 128 bits of SHA-256, and only the executor sees that form. Julius's rows keep the full task id.
- Fix, refusals: executor refusals map onto a closed class. The durable row carries the step, the class and the field the executor named (for example `identity_task_id`), and the evidence dump exports them.
- Proof: the real executor client and shell port run against the real executor validators. Attempt 3's exact task id is refused at create before the fix, and after it the task creates, prepares and executes. 27/27 tests pass, and mutations were killed.

FIXTURE CORRECTION, founder-directed: the qualification's one unanswerable question becomes a research question (commit 2)
- What was wrong: nothing reachable could establish how the exporter renders a NULL. The exporter is outside the slice in a private repository, nothing said it uses psql, and PostgreSQL's docs give opposite answers for psql versus COPY. Ten reviews blocked on a criterion nobody could meet.
- Fix: one requirement states the verified invocation, `psql -A -F $'\t' -c "<query>"`, and nothing about NULL rendering. The worker must research that on www.postgresql.org and cite it. Research allowance rises to 3 retrievals per slot (9 for the mission), with bytes in proportion.
- Unchanged: every acceptance criterion, the specification, the host, the capability and the roles.
- Proof: exactly one requirement names the invocation, and it matches the real exporter. Nothing visible states the answer (pset, unaligned, COPY's \N, or a rendering phrase). The adversarial readers still fail the specification, and the real checker accepts the contract. 17/17 tests pass, and 5 mutations were killed.

REPAIR FAN-OUT, part 1: a dispatch that paused to ask is not reviewed as finished work (commit 3, built by the Live Lab)
- What was wrong: a dispatch that yielded for guidance or research started its continuation segment, and was ALSO sent to review as if finished. The review returned changes_required, which minted a repair round, so every pause forked into two successors. Attempt 3 had 10 pauses, 10 REPAIR decisions, 15 repair tasks and 14 segments.
- Fix: a yielded dispatch is not verified. Its review obligation passes to its continuation, the last segment of the unit. Release follows the continuation.

REPAIR FAN-OUT, part 2: the repair bound counts the whole unit, through every pause (commit 4, built by the Live Lab)
- What was wrong: repair rounds were counted only through `repair:` ancestry, so a `segment:` restarted the count. The contract's `repairCycles: 3` ran five independent chains. That contradicts JULIUS_PAID_RUN_34037313976_REPAIRS.md: "`repairCycles` bounds the lineage, not each hop".
- Fix: repair rounds count across the whole unit, segments included.
- Proof: a coder that pauses every round, against a reviewer that refuses every finished segment, with a limit of 2, gets exactly 2 repairs, 1 repair_round_limit, and no yield reviewed. 10 of 10 mutations killed across the two commits.
- Why in this PR: the corrected fixture gives workers research authority and 3 retrievals, so they pause more. Without these two commits, attempt 4 would fork the same way attempt 3 did.
- Not in this PR: making a terminal HALT mark the run FAILED instead of idle. With parts 1 and 2 a halted unit has nothing runnable left, so it spends nothing; the record will still show the run as not failed. That fix follows separately.

PROOF AT HEAD 650e8107 (independent, this session)
- Typecheck clean on all projects.
- Repository boundary PASS, and `git diff --check` clean.
- All Julius kernel suites: 1148/1149. The one failure, a slot-envelope e2e timeout under full-directory load, passes alone and on clean main.
- 505/507 across peer-qualification e2e, the qualification fixture, first-live-mission, executor-identity, research-authority, live-composition, research-mediator, ci-test-accounting and paid-dispatch.
  - `julius-research-authority` 22 fails identically on clean main on this Windows host.
  - The harness manifest was stale, and is now regenerated at each position where it changed.
- At the fan-out part 1 position: the continuous-lifecycle e2e passes 67/67 with the harness test, and typecheck is clean.

No provider, Docker daemon or database was contacted by these proofs.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
