# Julius: the tool-less reviewer failed the paid qualification, and the record could not say why or what it bought

Frozen candidate `relay/julius-reviewer-failure-truth`, 1 commit(s) over trusted main `8afb872d`, authored and committed by `julius-worker[bot]`.

Repair after paid qualification run 34753589938 failed at the tool-less Independent Reviewer. One worker-authored commit on accepted main `8afb872d` (#264). The paid qualification reruns as attempt 2 immediately after this lands.

Paid qualification 34753589938 (main 8afb872d) ran for real and failed at its plan
review. The Prompt Architect succeeded on gpt-5.6-sol (2,527 in / 3,998 out / 516
reasoning tokens), allocation v3 granted every dispatch $21.00 from the shared pool
— the live ledger held — and then the Independent Reviewer, freshly proven to hold
no tool, timed out once on the engine's own 90 s request deadline, was re-asked
inside its window, and exited 0 with 111 bytes carrying no JSON and no HTTP status.
That classified as `review_json_absent`, non-retryable; the mission failed and the
Coding Agent never dispatched.

Three defects made that failure unreadable. This repairs all three and removes one
likely cause.

1. HERMES GIVES UP IN ITS OWN SENTENCES, WITH EXIT STATUS 0. At the pinned commit
`agent/conversation_loop.py` returns fixed final responses for an invalid tool
call, exhausted credits, an output or context ceiling, and an API call it already
retried. Each read as a model that "wrote prose". `classifyEngineGiveUp` names them
as closed shapes — `review_engine_invalid_tool_call`, `_billing_exhausted`,
`_output_limit`, `_context_exceeded`, `_gave_up` — by fixed prefix, only at the
start of the answer, only where no verdict-bearing object exists, after timeouts
and HTTP statuses. No text is persisted.

2. A FAILED REVIEW DISCARDED ITS USAGE. Hermes writes its usage file on failure
too; this path read it only on success, so the run could not prove whether a paid
provider was asked. The failure path now reads it before the scratch directory is
removed, and the durable row carries the engine's tokens, the served model and a new
`engineApiCalls` (allowlisted, dumped as `engine_api_calls`). Absent stays null.

3. THE REVIEWER WAS NEVER TOLD IT HAS NO TOOLS. Isolation removed every toolset; a
model trained to look things up and not told so may try one, and the engine answers
that by giving up. Every review prompt now says so in one sentence, and an invalid
tool call is a correctable shape: the one bounded re-ask names the absence of tools
and never quotes what the model tried.

Codes: exhausted credits and an engine that gave up are PROVIDER_UNAVAILABLE, final;
a context ceiling is INVALID_REQUEST; an uncorrected tool call or an output ceiling
is WORKER_EXECUTION_FAILURE. None is re-asked blindly.

NOT CHANGED, deliberately: the 90 s engine request timeout and the reviewer deadline
derivation. A tool-less review is one long request, and attempt one did outrun 90 s,
but the second attempt's 111 bytes were not a timeout and the evidence could not say
what they were. The next paid run will, and the deadline is re-derived from that
observation rather than from a guess. The Architect's research ask on the same run
was `policy_refused` with no reason recorded; that gap is the research-outcome
candidate's, queued separately.

Ten proofs drive the real runner over a fake engine that writes a usage report the
way Hermes does, and the real reviewer adapter over it. Five mutations killed: the
give-up branch removed, the failure usage dropped, the no-tools sentence removed,
the tool-call correction removed, and exhausted credits made retryable.

No provider was contacted by these proofs.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
