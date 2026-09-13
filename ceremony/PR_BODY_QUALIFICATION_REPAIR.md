# Julius qualification repair: a valid fixture for attempt 4, and deep repair tasks reach the executor

Frozen candidate `relay/julius-qualification-repair`, 2 commit(s) over trusted main `9fc999f7`, authored and committed by `julius-worker[bot]`.

Required by paid qualification attempt 3 (run 34766115321). Attempt 4 is dispatched automatically once this lands.

Two worker-authored commits on main 9fc999f7. Both are required by paid qualification attempt 3: run 34766115321, VALID paid evidence, 114 real requests, about $11.87, stalled at 32 ticks. Attempt 4 is dispatched automatically once this lands.

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

NOT IN THIS PR: the Live Lab's repair fan-out fix (a pause at a barrier forks a review, and segments reset the repair count). It is proven in part and is not required for a valid attempt 4. It lands next if attempt 4 shows the fan-out again.

PROOF AT HEAD
- Typecheck clean.
- Repository boundary PASS, and `git diff --check` clean.
- 327/328 across the qualification, first-live-mission, research-authority, paid-dispatch, paid-slot, paid-workflow, executor-identity, harness-export and ci-test-accounting suites.
- Research protocol 57/57.
- The one failure, `julius-research-authority` 22, fails identically on clean main on this Windows host.

No provider, Docker daemon or database was contacted by these proofs.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
