# Julius: the architect's declared deadline was never resolved from the environment

One environment variable, two architects, and a deadline declared from the
fallback rather than from the answer.

No provider was contacted. No mission spent anything. No default value changes.

---

## 1. Two readers, two opinions

`RELAY_PROMPT_ARCHITECT_TIMEOUT_MS` and `RELAY_PROMPT_ARCHITECT_MAX_TOKENS` are
each read by **two** modules, which disagreed about what an unset environment
means:

| reader | serves | timeout | output tokens |
|---|---|---|---|
| `src/relay/connectors/gpt-architect/config.ts` | Julius's three-role paid path | 300 s | 4,000 |
| `relay-bridge/openai-architect.ts` | the Relay demo mission | 90 s | 1,200 |

Both pairs arrived in one commit (`97106c56`) and neither referenced the other.

The **values** are defensible: the connector asks for a full plan, the bridge
path for one compact handoff, and a smaller answer needs less wall clock. So
this PR keeps both and pins both. What was not defensible is that nothing said
so, nothing tested it, and three things downstream were built on the wrong one.

## 2. The declaration that was one step short

`ARCHITECT_WORKER.timeoutMs` read the connector's `DEFAULT_TIMEOUT_MS`. The
number that actually cuts the call off is `readGptArchitectConfig(env).timeoutMs`
— `runGptArchitect` hands it straight to the OpenAI client's `timeout` — and the
variable moves it.

So the declared and the operative deadline agreed under the empty environment
and under no other. That is exactly the declared-versus-operative drift
`reviewer-deadline.ts` was written to end, surviving one role over, underneath
a comment claiming it had been ended:

> *"DERIVED, not restated. This read `300_000`, which happened to equal the
> connector's `DEFAULT_TIMEOUT_MS` — the number that actually bounds the call."*

The first half was true. The second was not.

`ARCHITECT_WORKER` becomes `architectWorker(env)` — a function of the
environment, exactly as `reviewerWorker` is a function of the provider — and
`resolveLiveWorkers` builds **one** worker object for both the registration and
the adapter, so two resolutions of one environment cannot drift either.

## 3. The job budget was built on the same fallback

`coder-envelope.test.ts` modelled the architect's worst-case share as
`DEFAULT_TIMEOUT_MS * 2`: the fallback, times a literal attempt count. Setting
the variable in the workflow would have raised the real worst case while the
proof that the four shares fit inside `JOB_BUDGET_MS` stayed where it was and
kept passing — the reviewer's Mission 4 failure in miniature.

The share now comes from `architectWorstCaseSpendMs(env)`, resolved from the
workflow's own `env:` block through the same resolver the adapter uses, times
the worker's own `maxRetries + 1`.

## 4. `.env.example` was handing Julius the demo path's envelope

This one was not hypothetical. The file **set** both variables:

```
RELAY_PROMPT_ARCHITECT_MAX_TOKENS=1200
RELAY_PROMPT_ARCHITECT_TIMEOUT_MS=90000
```

Those are the bridge demo path's numbers, for variables both paths read. Any
environment copied from this repository's own example therefore ran **Julius's**
architect on a 1,200-token ceiling and a 90 s deadline, silently. A plan
truncated at 1,200 tokens is the incomplete-plan failure that has already cost
one paid run — the reason `incompleteReason` is in the architect diagnostics at
all.

Both lines are now commented out, with both envelopes stated beside them, so
each path uses its own default unless an operator deliberately moves both.

## 5. And the two disagreed about malformed input

`architectPreflight` refused a non-positive bound and named the variable. The
connector coerced it to the default and said nothing — an operator who asked for
something got something else in silence, which is the same defect as answering
an unknown with a zero.

`GptArchitectConfig` now carries `unusable`: the **names** of variables set to
something unusable, never their values, so the config still never exposes a
value. `evaluateReadiness` refuses and names them, the fail-closed-and-named
contract `live-composition.ts` states at its top. **Absence is still not a
fault** — nobody asked for anything, so nothing was ignored — and the resolved
bound stays usable either way, so nothing downstream ever receives a zero.

## 6. Deliberately not changed

- **The four default values.** They are proportionate to two different answers.
- **The configuration surface.** Splitting the variable so one path can be tuned
  without the other is a real option, but it is a config change and is not
  smuggled in on a consistency repair. The coupling is instead stated at both
  definitions and in `.env.example`, and proof 7 shows one variable moving both
  paths so nobody can believe it is scoped to one.

## 7. Evidence

- **13 proofs** in `relay-bridge/architect-envelope.test.ts`:
  - **1–4** the declaration against the operative bound, **swept over
    environments that actually SET the variable** — because under the empty one
    every broken version of this code is indistinguishable from a correct one,
    which is exactly how the previous repair of `reviewer-deadline.test.ts`
    shipped an architect assertion that could never have observed the drift it
    was named after. Proof 4 forbids the fallback constant returning to the
    declaration.
  - **5–7** both envelopes pinned as named constants, no bare literal at either
    read site, and the coupling asserted: one variable moves both paths.
  - **8** every reader of both variables, enumerated across `git ls-files` and
    pinned, so a third reader with a fourth default cannot appear unnoticed.
  - **9–13** an unusable bound refused by name on both paths, absence still not
    a fault, the resolved bound still usable, and `.env.example` documenting
    both variables while setting neither.
- **13 adversarial mutations, 13 killed, 0 survivors** — including the
  declaration back to the fallback and back to a literal, the composition
  resolving twice, each of the four defaults silently unified, a third
  production reader, the connector defaulting an unusable bound again, absence
  treated as a fault, and `.env.example` setting the demo envelope again.
- **4 differential pairs** for two mutations that are *equivalent* under a
  workflow setting no architect deadline (hardcoding the budget share;
  loosening the workflow reader to match a commented-out line). Each pair holds
  one configuration with and without the repair. All four behaved as specified:
  a workflow that over-allocates the architect fails the budget proof, the
  hardcoded share is caught too, a commented value is ignored, and a reader
  loosened to match it is not.
- Full suite on the frozen tree: **10,349 passed, 0 failed**, 530 files passed
  (3 skipped files, 30 todo). Four-pass typecheck, `build`, `relay:build`,
  `relay:bridge:build`, repository boundary, parity, strict surface parity,
  `julius:harness:check`, six drills and `git diff --check` — all clean.
