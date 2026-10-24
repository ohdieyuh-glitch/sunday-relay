# Julius mission trace id

One trace id per admitted `wlj_` mission. It is compatible with W3C trace-context. It is derived, not stored, so admission, the Julius runtime, the paid-run archive, and the Wonderland client compute the same value from the run id. Frozen PR 407 does not change.

The derivation lives in `scripts/julius-mission-trace.mjs`. That file imports only `node:crypto`. It is the copy a drift test can take byte for byte. The paid workflow derives `traceId` and `spanId` itself from the admitted `JULIUS_RUN_ID` by calling this module. Dispatch does not send a trace id. A trace id supplied by dispatch is never trusted: the admitted run id is the only input.

`traceId` is a correlation id. It is not a secret, and it is not proof that a run spent money. The `julius-run-spent.v1` tag stays the spend record.

## traceId

For a lowercase `wlj_` UUIDv4, the same grammar as `WLJ_RUN_ID_PATTERN`:

1. `digest` is the lowercase hex SHA-256 of the UTF-8 string `julius-trace.v1:` concatenated with the `wlj_` id. SHA-256 is 64 hex characters.
2. `traceId` is the first 32 hex characters.
3. When that window is 32 zeros, `traceId` is the last 32 hex characters of the same digest.
4. When both windows are zero, repeat the walk on SHA-256 of the same label with one trailing U+0000.
5. When that digest is also all zeros, `traceId` is 31 zeros and a final `1`.

A legacy `run:` plus 24 hex, a `preflight:` id, and any other string have no trace id. The functions return null. They do not invent one.

W3C forbids an all-zero trace id, which is why step 5 exists. An all-zero SHA-256 of these labels is not a value anyone has produced. The rule is there so the id still cannot be all zeros.

## Span id

A phase span id is 16 hex characters, the same window rule at width 16, over SHA-256 of:

```text
julius-span.v1:<wljRunId>:<role>:<stage>:<attempt>
```

`role` is `PROMPT_ARCHITECT`, `CODING_AGENT`, or `INDEPENDENT_REVIEWER`. `stage` is `plan`, `build`, `repair:plan`, or `repair:build`. `attempt` is a safe integer greater than or equal to zero, written in decimal with no leading zeros. Any other combination returns null.

`repair:plan` and `repair:build` contain a colon. The inputs are the closed sets above, so the label is still one span.

## traceparent

`juliusMissionTraceparent(traceId, spanId)` returns `00-<traceId>-<spanId>-01` when both ids are lowercase hex of the right length and neither is all zeros. The flag `01` means sampled. Anything else returns null.

The mission record carries `traceId` and is not itself a span, so its `traceparent` is null. Each phase that has a role, a stage, and an attempt carries `spanId` and that phase's `traceparent`.

## Known answers

| `wlj_` id | traceId | span | spanId |
|---|---|---|---|
| `wlj_01234567-89ab-4cde-8fab-0123456789ab` | `192b1fbb866790da0ba590b4a8f45144` | `CODING_AGENT` `build` attempt 1 | `3e314a67b8845836` |
| `wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d` | `0ef34f0df7cf2cf89b844dcfa5fe084f` | `PROMPT_ARCHITECT` `plan` attempt 1 | `20d74ea3e2204340` |

The traceparent for the first row is `00-192b1fbb866790da0ba590b4a8f45144-3e314a67b8845836-01`.

Further span ids for `wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d`:

| phase | spanId |
|---|---|
| `CODING_AGENT` `build` attempt 1 | `6bc1bfe65ed9e64b` |
| `CODING_AGENT` `build` attempt 2 | `2bb96ae1748df063` |
| `INDEPENDENT_REVIEWER` `repair:plan` attempt 1 | `4d4c5030f6bc2dbc` |

`run:0123456789abcdef01234567` and `preflight:abc` both return null.

## Where it is served

`GET /relay-api/wonderland/julius/missions/{wljRunId}/result` and `GET .../progress` include `traceId`. A phase list from the evidence reader carries `spanId: null` and `traceparent: null`. These routes do not fill a span id onto that list.

The companion `GET` on `bridge/wonderland-julius-companion-route-20261024` is not in this branch. Adding `traceId` there is a follow-up on that branch. This change does not edit it.

YUJI's runtime, coder receipt, reviewer receipt, and paid-run archive should record the `traceId` and `spanId` this module returns for the admitted `JULIUS_RUN_ID`. This branch does not edit those PRs or the workflow files.
