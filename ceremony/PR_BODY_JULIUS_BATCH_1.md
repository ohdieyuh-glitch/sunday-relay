# Julius development batch 1: the second repair reaches the executor, refusals say why, anchored docs are fetched

Frozen candidate `relay/julius-batch-1`, 3 commit(s) over trusted main `2110e2c5`, authored and committed by `julius-worker[bot]`.

Julius development batch 1: three improvements from paid qualification attempt 2 (run 34757974058), one logical commit each, per the founder's batch cadence.

This batch has three improvements, one commit each. All three come from paid qualification attempt 2: GitHub run 34757974058 on main 2110e2c5.

That run was valid paid evidence, but the mission did not complete. All three workers made real provider calls: 31 requests and about $2.71 in total. The Architect used gpt-5.6-sol, the Coding Agent claude-fable-5, and the Reviewer grok-build-0.1 through Hermes, isolated at 480 s. No allocation fell back to ESTIMATE_NO_LEDGER. The mission failed at tick 13 of 32.

Runs B and C of the campaign have not run yet. The Live Lab's paid dispatch is waiting on a founder permission decision in that session.

IMPROVEMENT 1: a second coder repair reaches the executor (commit 1)
- What was wrong: the second coder repair failed before reaching a provider. Its task id was `repair:repair:run:…:build:1:task:2:task`, and the base-revision tool effect's invocation id came to 70 characters. The executor builds `invocationId:dispatchGeneration:sandboxId`, with the invocation id as the sandbox id, which gave 143 characters. The executor refuses identifiers over 128. The error was `INVALID_REQUEST:execution_envelope_invalid:executionIdentity`. Task ids grow with every repair, so every mission that needs a second coder repair failed the same way.
- Evidence: bundle `executor-diagnostics.txt`; the `tool-invocations.tsv` row stuck in DISPATCHING; `failures.tsv` sequence 170.
- Fix: `executorInvocationId`. An id that fits the derived bound of 58 characters is issued unchanged. A longer one becomes `x-` plus 128 bits of SHA-256 over the full key, then the step and lease. This is deterministic, so dispatch deduplication is unchanged. The executor's 128-character limit is not raised, and the full task id stays bound in the durable row and the signed request.
- Tests: the real executor client and shell port run against the real envelope validator. The old id for the failed task is refused, which reproduces the paid failure. The fixed id passes for chains deeper than any mission allows. Ids that already fit are unchanged. Three mutations are killed.

IMPROVEMENT 2: a refusal is recorded as what it was, whether the executor or the research policy refused (commit 2)
- What was wrong, executor side: the executor's refusal reached the durable record as WORKER_EXECUTION_FAILURE with no class and no diagnostics. The client raises an untyped Error, and a 400 is reported as `EXECUTOR_UNAVAILABLE:…`.
- What was wrong, research side: all four research asks came back `policy_refused` within 6–13 ms, with an empty reason and no target. The mediator knew `host_not_allowed` and the other reasons, and the port dropped them.
- Evidence: `failures.tsv` shows `failureClass` null; `research.tsv` shows 4 rows with empty `reason_code`.
- Fix, executor side (Formal session): `classifyExecutorRefusal` maps every executor answer onto a closed class. The durable row now carries three allowlisted fields: `executorStep` (base/diff/test), `executorRefusal`, and `executorRefusalField` (for example `execution_identity`). The dump exports them.
- Fix, research side (Live Lab): the port record carries Relay's refusal code, Live Reach's own refusal code, and the requested source, capability and host name. The host name is the only part of the URL kept; no path, query or purpose is recorded. The dump exports them.
- Codes, retryability and outcomes are unchanged. This changes the record only.
- Tests: the paid run's exact 400 becomes `executor_identity_invalid` on the base step. Thirteen executor answers are classified, and the allowlist refuses values posing as classes. Every research refusal path runs through the real mediator and port, and the pipeline rows are checked, including that no path, query or purpose leaks. Mutations are killed on both sides: 5 executor, 8 research.

IMPROVEMENT 3: a granted documentation page cited with its anchor is fetched, not refused (commit 3)
- What was wrong: `authorizeJuliusResearch` passed the worker's URL to Live Reach with its `#fragment`. Live Reach's URL policy refuses any URL with a fragment. So a granted page cited as `…/app-psql.html#…` came back `policy_refused`, and the worker was told the mission had not authorized it. It opens no socket and returns in milliseconds, which matches all four refusals in the run. Commit 2 is what lets the next run confirm this was the cause.
- Fix: the fragment is dropped from the authorized URL. The query is kept, the host check is unchanged, and the observation keeps the worker's original reference.
- Tests: reproduced on main through the real mediator and Live Reach before the repair. After it, an anchored granted page is observed, an anchored host off the grant is still refused, and the query survives. Mutations are killed.

COMBINED
- Overlap: improvements 1 and 2 share `executor-effects.ts`, and improvement 2 names the refusal that improvement 1 removes. Improvements 2 and 3 share the research mediator and policy tests. The only file all three touch is the evidence dump, where they edit different queries.
- Proven at each position: typecheck and tests at commit 1 on main 2110e2c5, at commit 2, and at the head. At the head 329 of 329 targeted tests pass, the boundary scan passes, `git diff --check` is clean, and the harness manifest is regenerated. Key mutations were re-killed at the head.
- Semantics change: only improvement 3, which now fetches and charges an anchored URL on a granted host like the same page without its anchor.
- Migration or config: none.
- Rollback: revert the commit. Each commit is independent in behaviour.

No provider, Docker daemon or database was contacted by these proofs.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
