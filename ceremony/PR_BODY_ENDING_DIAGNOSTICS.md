# Julius: what a paid run leaves behind when it ends

Findings C and E, which are the same sentence twice: facts a boundary already
had in hand did not reach the rows a reader opens afterwards.

No provider was contacted. No mission spent anything.

---

## 1. The terminal row could not say why (C)

`JuliusExecutionOutcome`'s failure arm was `{status, code, failureClass?}`. The
coordinator flattened the adapter's diagnostics onto its **own**
`retry.scheduled` and then had nowhere to put them — so when a run's autonomy
declined a retry, `julius-task-pipeline` wrote the terminal `task.failed`, the
row that **ends** the task, with five fields and nothing about the provider.

Not an omission at the call site. The type gave the pipeline nothing to write.

What was lost is what the next decision needs:

| in the diagnostics | on the terminal row, before |
|---|---|
| `costUsdMicros` — a coder that times out has usually already spent money | — |
| `servedModel`, `responseId` | — |
| `inputTokens`, `outputTokens`, `costBasis` | — |
| `failureReason` beneath the code | — |

All of it sat one event earlier, under a different type, where a reader asking
*why did this paid mission end* does not look.

The arm now carries `diagnostics`, already flattened and sanitised, and the
pipeline spreads it onto that row. The key is **absent** when the boundary
reported none — absent and empty are different claims, and an always-present
`{}` would also change the shape of every outcome with nothing to say. The
`diag_` prefix is what makes the spread safe: no carried key can collide with
`code`, `reasonCode`, `awaitingHuman`, `failureClass` or `errorRetryable`, which
are Julius's own and not an adapter's to overwrite.

## 2. The successful run left thinner evidence than the failed one (E)

`planDiagnostics` takes eighteen optional fields and six call sites each chose a
subset by hand. Only **one** — the connector-failure path — passed the whole
provider picture.

| site | tokens | `elapsedMs` | `providerStatus` | `maxOutputTokens` |
|---|:--:|:--:|:--:|:--:|
| connector failure | ✓ | ✓ | ✓ | ✓ |
| unparseable JSON | — | — | — | — |
| guidance invalid | — | — | — | — |
| plan invalid | — | — | — | — |
| guidance success | partial | — | — | — |
| plan success | partial | — | — | — |

The three **refusal** sites made a provider call and threw the answer away while
recording nothing about what it cost. Both **success** sites omitted the elapsed
time, the provider's status, the total and reasoning tokens, and the ceiling in
force. That is the wrong way round: the paid proof reads the run that worked.

One constructor, `providerFacts`, now builds every fact the provider's own
answer carries, and all six sites spread it. **Nothing here is new
information** — every field was already on the outcome and already in scope at
every site. What was missing was a reason a site could not quietly report a
subset.

## 3. Cached input was read and never recorded, anywhere

`GptUsage.cachedInputTokens` has always been populated from
`input_tokens_details.cached_tokens` and reached no diagnostic on any path.
Cached input is billed at a different rate, so a row carrying `inputTokens`
alone reports a quantity at one price when part of it was bought at another.

Adding the column upstream turned out to be one **third** of the repair. A
diagnostic reaches a reader through three layers, and this field was missing
from two of them:

| layer | where | what a gap costs |
|---|---|---|
| emit | `live-workers.ts` | the fact is never built |
| admit | `safeReviewDiagnostics` allowlist | built, then dropped on the way to the durable record, without a word |
| export | `julius-live-evidence-dump.sh` | written durably, then destroyed with the database |

**Each gap was caught by a guard rather than by inspection.** The allowlist gap
fell out of these proofs: the success case reads the adapter's return *directly*
and passed, while the refusal cases read it back through `JuliusDispatchError` —
which sanitises — and did not. The export gap was caught by the completeness
guard the previous evidence repair installed, which is the first time that guard
has refused a change other than its own.

## 4. Deliberately unchanged

- A call that **never reached the provider** still reports `null` for every
  provider number, never `0`. Nothing was observed, and the one kind of unknown
  this system may not manufacture is the kind it created by discarding an answer.
- A success still reports `incompleteReason: null`. A success is by definition
  not incomplete, and saying otherwise would be a sentence the provider never
  said.
- The trajectory row's shape. The finding is about the event that ends the task.

## 5. Evidence

- **12 proofs**, provider-free — the connector is replaced by a scripted
  outcome, so nothing is contacted and nothing is spent:
  - **1–6** drive the real architect adapter through every ending it has:
    validated, unparseable, invalid, and a call that never landed. Every usage
    number in the fixture is **distinct**, so a row populated from the wrong
    member of `usage` cannot pass by coincidence. Proof 5 holds the
    never-reached case to `null` rather than `0`, and proof 6 holds a success to
    `incompleteReason: null`.
  - **7–8** structural: every `planDiagnostics` call spreads the constructor,
    and the constructor reads each token from its own field.
  - **9–12** the coordinator-to-pipeline hand-off: the failure outcome carries
    the flattened facts on all three failure returns, absent when there are
    none, spread onto the terminal row, and the `diag_` prefix that makes that
    safe.
- The structural guard is **brace-matched, not pattern-guessed**. A capped
  `[\s\S]{0,400}?` regex found four of the six sites and stopped, because the
  two longest arguments outran the cap — a guard silently covering less than it
  claimed, the same fault as the vacuous `toContain` that shipped in the last
  evidence repair. It now counts braces and asserts the exact site count, so
  adding or removing a site fails here rather than quietly covering fewer.
- **13 adversarial mutations, 13 killed, 0 survivors**: a success site and a
  refusal site each dropping the spread; `cachedInputTokens` read off
  `inputTokens` and `totalTokens` off `outputTokens`; a success claiming an
  incomplete reason; `providerStatus` never reported; a call that never landed
  reporting `0` instead of `null`; `cachedInputTokens` dropped from the
  allowlist; the coordinator dropping the carried facts on the retry return; an
  empty set reported as `{}` rather than absent; the pipeline dropping the
  spread; the `diag_` prefix removed so a carried key can collide; and the
  export column removed, so an allowlisted key is written durably and dies with
  the database.
- Full suite on the frozen tree: **10,347 passed, 0 failed**, 530 files passed
  (3 skipped files, 30 todo). Four-pass typecheck, `build`, `relay:build`,
  `relay:bridge:build`, repository boundary, parity, strict surface parity,
  `julius:harness:check`, six drills and `git diff --check` — all clean.
