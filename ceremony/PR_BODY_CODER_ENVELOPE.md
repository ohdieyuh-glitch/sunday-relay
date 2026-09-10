Paid Mission 5 (run `34485676189`, durable `run:cecba99c779c967f128dd58c`) reached
the Coding Agent with everything upstream verified — architect accepted, plan
independently reviewed, `ACCEPT / TASK_VERIFIED`, contract **LOCKED** at revision
2 — then died on capacity twice, for **$2.936176**:

```
attempt 1  timed_out=true, 12 tool calls              -> aborted at ~363 s
attempt 2  result_subtype=error_max_turns, num_turns=13, 16 tool calls
```

**It had already done the work.** All five throw sites removed, `+246/-15` in
`julius-context-integrity.ts`, `+13/-3` in the snapshot, `+34/-3` in the runtime.
It ran out of envelope before it could run the tests and signal completion —
hence `implementation_present=false`, and two `base` executor calls with no
`diff` and no `test`. An execution-envelope defect, not a Context Integrity one.

Base `bc32385eb3536c451b29be98d8bd2139a124f0a1` · Head `9b973117084c992d9c9252fc98ab224764df95b6` · Tree `31fc89bd6c550e81a141ef91930d516ea6eeeabf` · 1 commit

## It was not only the constant

`DEFAULT_HOSTED_LIMITS` was `maxTurns: 12` / `maxRuntimeMs: 6 * 60_000`. Reading
the enforcement path instead of assuming it:

| field | who enforces it | binds? |
|---|---|---|
| `limits.maxRuntimeMs` | `hosted-runner.ts:127`, the abort timer | yes |
| `limits.maxCostCents` | `hosted-runner.ts:143` `maxBudgetUsd` | yes |
| **`limits.maxTurns`** | **nothing** | **no** |

The SDK's turn ceiling comes from `HostedEnvelope.maxTurns`, and the runner
compiled the envelope **without passing its limits**:

```ts
const limits = input.limits ?? DEFAULT_HOSTED_LIMITS;
const envelope = compileHostedEnvelope({ workspacePath, requestedModel });  // no limits
```

so `compileHostedEnvelope` read the default directly. **`HostedLimits.maxTurns`
was decorative** — a caller could raise it to forty and still stop at twelve.
Third appearance of this shape after `JuliusWorker.timeoutMs` and the coder's
declared `600_000`, which is why this is a canonical source and not a bigger
number.

## The derivation

```
turns    floor 13 (CENSORED: error_max_turns bounds from BELOW only)
         x2.0 headroom -> 26, under an absolute ceiling of 32
runtime  floor max(363000 observed, 26 x 23538 pace-implied = 611988)
         +20% -> 734386, under the job-owed ceiling of 900000
basis    OBSERVED_CENSORED    worst case 2 x 734386 = 24.5 min of a 30 min share
```

- **Censored means censored.** A timed-out hosted run reports no usage at all,
  so attempt 1's cost is `null` — we paid and cannot say how much.
- **Cost per turn is evidence, not a law.** The only rate derived is
  *milliseconds* per turn, used solely to keep the runtime large enough to reach
  the turns it grants; a turn ceiling the clock can never reach is not a ceiling.
  It never bounds spend.
- **Money is independent and did not move.** `maxCostCents` stays what
  `hostedLimitsForAllocation` computes from the reservation, and a test forbids
  the policy module from setting or computing it. That independence is why
  doubling turns is safe. Spend was never the constraint: $2.94 of a $7.50 share.
- **It refuses rather than clamps**, naming both numbers and both levers.

`JOB_BUDGET_MS` 90 → 120 because the coder now has a share of its own; a test
proves reviewers (50 min), coder (30 min), the architect's own ceiling and a
stated 15-minute infrastructure allowance fit inside it, and the workflow's
`timeout-minutes` is pinned to it.

## Proof

**Mutation-tested seven ways**, each failing only its intended tests: envelope
ignoring its limits (2 fail), runner not passing them (1), a turn literal
restored (3), the policy touching cost (1), the exhausted run relabelled a
measurement (2), runtime ignoring the turns it grants (1), the workflow budget
unpinned (1). The reviewer policy's own mirror guard caught the `JOB_BUDGET_MS`
drift into `julius-reviewer-deadline.mjs` before the suite did.

`npm test` **513 files / 9,917 passed / 0 failed** (3 skipped, 30 todo) ·
four-pass typecheck · `build`, `relay:build`, `relay:bridge:build` ·
repository boundary PASS · parity gate PASS · surface-parity strict · yc-demo ·
cli contract-verify · harness `--check` current · `git diff --check` clean ·
four drills PASS · contract check OK for all five missions.

Mission 5's contract, adversarial specification and $30 / 3-cycle ceiling are
**untouched**. The capability bar is unchanged.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TqJcJuQiraGDnFnjA4gyUc
