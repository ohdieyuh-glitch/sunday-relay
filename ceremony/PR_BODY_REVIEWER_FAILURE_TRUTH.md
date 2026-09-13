# Julius: the engine killed the tool-less reviewer at 12 s, and the record could not say why or what it bought

Frozen candidate `relay/julius-reviewer-failure-truth`, 1 commit(s) over trusted main `8afb872d`, authored and committed by `julius-worker[bot]`.

Amended in place for PR #265: the stream-watchdog and request-timeout repair added after the zero-cost reproduction. The PR already exists, so this opener will refuse; the pins record what the founder approves.

Paid qualification 34753589938 (main 8afb872d) ran for real and failed at its plan
review. The Prompt Architect succeeded on gpt-5.6-sol (2,527 in / 3,998 out / 516
reasoning tokens), allocation v3 granted every dispatch $21.00 from the shared pool
— the live ledger held — and then the Independent Reviewer, freshly proven to hold
no tool, timed out once on the engine's own 90 s request deadline, was re-asked
inside its window, and exited 0 with 111 bytes carrying no JSON and no HTTP status.
That classified as `review_json_absent`, non-retryable; the mission failed and the
Coding Agent never dispatched.

Three defects made that failure unreadable, and a fourth caused it. This repairs all four.

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

4. THE ENGINE KILLED A SILENT, REASONING REVIEWER AT 12 S, AND CAPPED A WHOLE
REVIEW AT 90 S. Reproduced at zero cost on the pinned Hermes (2ea39dae, network
closed, a local fake xAI Responses SSE endpoint, the run's 27,374-byte prompt through
the real wrapper and isolated profile): for a responses-mode stream the engine has
two watchdogs beside the request timeout. No SSE event for
HERMES_CODEX_EVENT_STALE_TIMEOUT_SECONDS after the first byte — unset, a size-scaled
default of 12 s below ~10k tokens — ends the request with "API call failed after 1
retries: Codex stream produced no SSE events for 12s after first byte", exit 0, which
is the re-ask's 111 bytes. And `stale_timeout_seconds` is an elapsed cap from call
start that events do not extend, which is attempt one's ~94 s.

A tool-less review is ONE request that reasons and then writes the whole verdict;
90 s was sized against a loop of short tool calls. The request timeout becomes 480 s
— the longest review ever watched (400,093 ms, cut off still running) and a fifth
beside it — and the bootstrap writes both codex watchdogs (event-stale and
first-byte) into the profile .env at that same number, so silence is allowed exactly
as long as a request and never longer. The isolation proof now records both as the
constructed agent sees them and refuses the dispatch when either is unset or
differs. The watchdogs' own sentences, which say neither "timed out" nor "timeout",
classify as `review_timeout`.

The reviewer deadline is re-derived, not re-guessed: one request per review at
480 s + 180 s overhead = 660,000 ms, +20% = 792,000 ms operative — unchanged,
because it was already sized for the longest review. The job share and the
three-attempt worst case (2,376,000 ms) are unchanged. What changes: a review that
times out a full request no longer has a floor's worth of window left, so it is not
re-asked in the adapter; a fast transient failure still is.

Measured on that rig: with only the .env line, a stream silent for 20 s then
answering completed (25.5 s; without it, killed at 12 s). With the config at 240 and
no .env line, events every 5 s for 110 s completed (115.9 s; at 90, killed at
95.6 s). Both together at 240: both streams completed with api_calls 1, completed
true, model and tokens recorded.

Eleven proofs drive the real runner over a fake engine that writes a usage report
the way Hermes does, and the real reviewer adapter over it; the isolation, envelope
and deadline suites pin the rest. Ten mutations killed: the give-up branch removed,
the failure usage dropped, the no-tools sentence removed, the tool-call correction
removed, exhausted credits made retryable, the watchdog fields dropped from the
isolation verdict, a watchdog sentence no longer a timeout, the bootstrap's .env
watchdog line removed, the hook ignoring the environment, and the request timeout
lowered to 240.

The research ask's `policy_refused` with no reason recorded is the research-outcome
candidate's, queued separately.

No provider was contacted by these proofs.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
