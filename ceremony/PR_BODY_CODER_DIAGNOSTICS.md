Paid Mission 5's rerun (run `34504244415`, durable `run:cecba99c779c967f128dd58c`)
proved the envelope repair and then failed one hop later, and **nothing in the
bundle could say why**.

The repair loop ran on a paid run for the first time: three `repair:plan` rounds
on the Prompt Architect, each independently reviewed, `REPAIR / REPAIR / REPAIR /
ACCEPT`, plan 25,805 → 31,691 → 38,952 → 40,484 chars, contract revision 5. The
coder was **not** capacity-bound this time — 6 turns of 26, 81 s of 734 s. It
changed nothing, spent **$0.885661**, and the entire durable record of the cause
was:

```
failure_class          coder_provider_error_after_init
is_error               true
num_turns              6      tool_use_count 5
output_bytes_observed  25
implementation_present false
```

`coder_provider_error_after_init` names the BOUNDARY, not the cause. The cause
was in an exception thrown by the SDK stream, which `hosted-runner.ts` discards
on purpose — *"A provider error can quote the request, which can quote the
credential — so only a fixed sentence leaves this function either way."* That
reasoning is right and **this PR does not relax it**. The consequence was that
the answer was destroyed at the moment it was produced.

Base `5909ae004f11ad88269159f0c30d505c8ca491ea` · Head `6fb24609f17f565e2ebb2b20cad293a68d28c100` · Tree `341e0a1363ebb198f646276b7b7a155fa78a1d46` · 2 commits

## 1. Classify, never forward

`relay-bridge/hosted-coding-agent/hosted-failure-reason.ts` matches the text
against a pattern table and returns a **constant of its own**, one of eleven:

```
rate_limited  context_length_exceeded  content_filtered  provider_overloaded
provider_auth_rejected  provider_bad_request  provider_server_error
stream_interrupted  execution_error  unclassified  no_message
```

No capture group, no interpolation, no `return` that mentions the input — all
three asserted structurally as well as behaviourally. The thrown error is
classified **inside the catch block** and dropped on the next line; the fixed
sentences remain the only text that leaves.

This is deliberately **not** what #247 did for the architect. `safeReasonToken`
*passes through* a value the provider already gave as an enum
(`response.status`, `incomplete_details.reason`). The hosted SDK gives no such
enum — it gives prose, and passing prose through a shape test would be a
credential-exfiltration hazard wearing a regex.

**So the domain admits this field by MEMBERSHIP, not shape.**
`JULIUS_HOSTED_FAILURE_REASONS` lives in `julius-router.ts` and the allowlist
uses `safeEnum`. `sk_ant_api03_…` satisfies `safeReasonCode` *and* `safeToken`;
it does not satisfy membership, and a test asserts exactly that. The adapter
keeps its own copy because it may not import the mission projection, and a
parity test fails if the two drift.

Two sources feed it, in order: the runner's classification of the **thrown
error** — strictly better evidence, because on this path the runtime threw
*instead of* finishing — falling back to the runtime's own `finalText`. Null on
success, always: classifying a healthy summary would read "0 errors" as a
failure.

## 2. Five of #247's six diagnostics never reached a bundle

Found while wiring the first half. Repair #247 added six architect diagnostics to
the `safeReviewDiagnostics` allowlist. **Five were never added to any query:**

```
providerStatus  incompleteReason  reasoningTokens  maxOutputTokens  totalTokens
```

They reach the durable event ledger and are then destroyed with the database,
because `.github/julius-live-evidence-dump.sh` is the only hop that survives the
job and it did not select them. Paid Mission 4's bundle carries **zero** of those
columns.

The existing test pins four *named* cost facts, which is exactly how a
half-wiring of six other facts shipped past it: pinning specific columns proves
those columns exist and says nothing about completeness. The new guard runs from
the allowlist outward — every key `safeReviewDiagnostics` admits must have a
column, or an `EXPORT_EXEMPT` entry giving a written reason (empty today). It
also refuses the reverse (a column no key feeds is permanently null), refuses
duplicate aliases, refuses a stale exemption, and **fails if its own parse of the
allowlist returns implausibly few keys** — a structural test that reads source
must break loudly when its parse stops working, not pass over an empty set.

All six columns now export: **62 allowlisted keys, 62 columns.**

## Proof

**Mutation-tested seventeen ways**, each failing only its intended tests:

| | |
|---|---|
| export completeness (6) | drop one column · drop #247's five exactly as they shipped · add a column no key feeds · duplicate an alias · keep a stale exemption · break the allowlist parse |
| vocabulary (2) | admit by shape instead of membership · drift the two copies apart |
| classifier (1) | forward the provider's own words |
| wiring (8) | classify on the success path · record a constant · ignore the runner's answer · return the raw message · drop the classification from the after-init refusal · drop it from a launch failure · classify a cancellation · ignore the runner's classification |

One more thing the repository taught me: `relay-repository-boundary.mjs`
refused the credential-shaped test fixtures, correctly and with no exception for
tests. Shortening them until the tripwire tolerated them would also have
shortened them past what they exist to prove, so they are **assembled at run
time** — the values are exactly as credential-shaped as the real thing, the
source contains no such literal — and a test asserts the assembled values still
match the three shapes the scanner refuses, so a later edit cannot quietly
shrink one.

`npm test` **514 files / 9,943 passed / 0 failed** (3 skipped, 30 todo) ·
four-pass typecheck · `build`, `relay:build`, `relay:bridge:build` ·
repository boundary PASS · parity gate PASS · surface-parity strict · yc-demo ·
CLI contract-verify · harness `--check` current · `git diff --check` clean ·
four drills PASS. Each of the two commits was verified green on its own tree
before the next was made.

`hosted-runner.ts`'s fixed sentences, `maxCostCents`, mission spend governance,
Mission 5's contract and its adversarial tests are all **untouched**. The
capability bar is unchanged.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TqJcJuQiraGDnFnjA4gyUc
