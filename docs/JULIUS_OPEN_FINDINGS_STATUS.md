# The open-findings list, verified against the code

The campaign heartbeat carries a list headed OPEN FINDINGS. It is stale — the
same notice still names trusted main as `482e6a05` and PR #254 as open, when
main is `9f155b91` and #254 merged at 16:32Z on 2026-09-11. This is that list
checked one by one against what the code actually does, so the next reader does
not re-investigate a finding that was repaired three landings ago.

Checked 2026-09-12 against trusted main `9f155b91` and against the
fourteen-candidate rehearsal (`ceremony/landing-order`).

| Finding | Status | Evidence |
|---|---|---|
| **G** — the reviewer's real failure mode | **Reframed and repaired.** The note's framing was wrong. | The 90 s engine timeout inside Relay's 480 s window is DELIBERATE and already tested: `DEFAULT_ANALYTICAL_MODEL.requestTimeoutSeconds` is canonical, the workflow is pinned to it, and a case asserts the engine deadline lands strictly inside Relay's — so Relay does not cut first and flatten every provider fault into one shape. The real defect was elsewhere: `review_service_unavailable` was produced only by the remote path, so on the live path a 429 or 503 was FINAL. Repaired in `relay/julius-reviewer-transient-upstream` @ `0311fcef`. |
| **D** — plan review at 93.5% of deadline | **Already repaired**, by the canonical deadline policy that Finding D itself produced. | Measured now: the derived operative timeout is 480,112 ms; the longest COMPLETED review on record is 381,880 ms = **79.5%**; the longest observation of any kind is 400,093 ms = **83.3%**. That is the 20% headroom `REVIEWER_DEADLINE_HEADROOM_RATIO` targets. The 93.5% figure was measured against the old 400,000 ms literal, before `reviewer-deadline.ts` existed. |
| **E** — architect success path carries fewer diagnostics than the failure path | **Repaired, not yet on main.** | `relay/julius-ending-diagnostics` @ `9fd7ca33`. Six `planDiagnostics` call sites now cover the success, failure and terminal branches. |
| **C** — terminal `task.failed` on the retryable path carries zero diagnostics | **Repaired, not yet on main.** | Same candidate. On the full stack the retryable-path `task.failed` facts carry `...(outcome.diagnostics ?? {})` beside `code`, `reasonCode`, `awaitingHuman`, `failureClass` and `errorRetryable`. |
| **Coder analogue of E** — a cut-off hosted run reports no usage | **Repaired, not yet on main.** | `relay/julius-coder-stream-usage` @ `78840a0d`. |
| **F** — two readers, two defaults for the architect timeout | **Already investigated and corrected.** Not a Julius bug: Julius's architect is served by the connector's 300,000 ms reader; the 90,000 ms one bounds the separate non-Julius Relay mission path. | Task #96. Do not conflate its 90 s with Finding G's ~94 s — G is the reviewer path. |

## What this means

**There is no unrepaired finding left on that list.** Everything is either
closed on main or frozen in a candidate waiting for the Codespace ceremony. The
bottleneck is the ceremony, not engineering.

## The one residual worth keeping in view

Finding D's derived deadline rests on `basis: OBSERVED_CENSORED`. The floor —
400,093 ms — comes from a review Relay CUT OFF, so its true duration was never
observed and cannot be recovered. The policy says so in its own `basis` field
rather than rounding the censored sample into a measurement. The 79.5% figure
above is therefore honest about the longest *completed* review and silent about
the censored one, which could have needed more than the current window. Only a
new observation can close that, and the policy is built to learn from one.
