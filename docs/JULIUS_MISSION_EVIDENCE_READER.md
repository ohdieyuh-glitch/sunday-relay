# Julius mission evidence reader

**Owned by YUJI. Supplied by YUJI's PR.**

YUJI owns the server-side reader that matches the `julius-run-spent.v1` tag's `workflow_run_id` to the actual workflow run and returns completion evidence. This branch does not implement that reader. It does not call GitHub, and it does not re-derive completion from a workflow run.

The interface is `JuliusMissionEvidenceReader` in `relay-bridge/julius-mission-evidence.ts`. `createJuliusMissionEvidenceTestDouble` is a test double. It plays back a stored value. It is not YUJI's reader. Production wires no reader: `relay-bridge/server.ts` constructs the result and progress bridge without one.

Until that reader is wired, `GET /relay-api/wonderland/julius/missions/{wljRunId}/result` and `GET .../progress` report the Wonderland status projection and nothing past it. `dispatched` is the furthest state `GET /wonderland/julius/status` can show (`src/relay/integration/wonderland-admission/admission-contract.ts`, `WONDERLAND_STATUS_STATES`). Neither route reports `completed` from a dispatch, from `{ completed: true }`, or from any value that is not the shape below.

## What the reader returns

`read(wljRunId)` returns the object `acceptJuliusMissionEvidence` accepts, or null. Completion requires both:

- `juliusFinalState: "COMPLETED"` — the runtime word `JULIUS_MISSION_STATES` uses, and the archive column `julius_final_state`. This route does not compute it.
- `spendTag` — the `julius-run-spent.v1` message fields. The `run` must be the path's `wlj_` id.

A missing section is null on the completion object. Null is unknown. A missing cost is not zero. `providerMessageId` is not a field: a message id does not make a receipt `CAPTURED`.

`traceId` and `traceparent` are on this shape. The bridge fills them from `scripts/julius-mission-trace.mjs` using the admitted `wlj_` id. A `traceId`, `traceparent`, or `spanId` on the reader payload is ignored. The paid workflow derives the same values from the admitted `JULIUS_RUN_ID` by importing that module. Dispatch does not send a trace id. A trace id supplied by dispatch is never trusted. See `docs/JULIUS_MISSION_TRACE.md`.

| Interface field | Source field | Where it was read |
|---|---|---|
| `spendTag.schema` | `julius-run-spent.v1` | `#445` `da345243` `.github/workflows/julius-first-live-mission.yml:274` |
| `spendTag.run` | `run=` | same line |
| `spendTag.namespace` | `namespace=` | same line |
| `spendTag.reservedUsdMicros` | `reservedUsdMicros=` | same line. This is the reservation, not the settled bill. |
| `spendTag.workflowRunId` | `workflow_run_id=` | same line. GitHub Actions run id. Not an application trace id. |
| `spendTag.workflowRunAttempt` | `workflow_run_attempt=` | same line |
| `spendTag.headSha` | `head_sha=` | same line |
| `spendAccounting.knownUsdMicros` | `priorRuns[].knownUsdMicros` | `#434` `d9b9e04e` `src/relay/mission/julius/julius-spent-tag-contract.test.ts` (verified tag: equals the reserved micros) |
| `spendAccounting.unknownCostComponents` | `unknownCostComponents` | same test. `0` on a verified tag, `1` on the legacy `server_run_id` body. |
| `spendAccounting.unverifiableApiSpend` | `unverifiableApiSpend` | same test |
| `spendAccounting.spendVerified` | `spendVerified` | same test |
| `coderCost.costUsdMicros` | `costUsdMicros` | `#445` `da345243` `relay-bridge/julius/claude-code-coding-provider.ts` `hostedCoderCost`. Null when no bill was reported. |
| `coderCost.costBasis` | `PROVIDER_REPORTED` \| `UNKNOWN` \| `NOT_APPLICABLE` | same function |
| `coderCost.executionCostUsdMicros` | `executionCostUsdMicros` | same function |
| `coderCost.billingPath` | `SUBSCRIPTION` \| `API_BILLED` | same function |
| `missionCost.knownUsdMicros` | `cost.knownUsdMicros` | `#445` `da345243` `src/relay/mission/julius/julius-runtime-api.ts:188` |
| `missionCost.unknownComponents` | `cost.unknownComponents` | same `cost` object |
| `missionCost.complete` | `cost.complete` | same `cost` object. False means the total is a floor. |
| `providerReceipt.providerRequestId` | `providerRequestId` | `#445` `da345243` `relay-bridge/julius/claude-code-coding-provider.ts` `anthropicProviderIds`; enforced again in `src/relay/mission/julius/julius-router.ts:216` |
| `providerReceipt.responseId` | `responseId` | same. Set only when the request id survived. |
| `providerReceipt.providerRequestAvailability` | `CAPTURED` \| `UNAVAILABLE` | same. `CAPTURED` means the provider `request_id` survived. Reviewer side: `relay-bridge/reviewer-harness/hermes/runner.ts:43` (`#438` `ddb8d92b`, ancestor of `#445`). |
| `providerReceipt.providerRequestUnavailableReason` | `provider_request_id_not_reported`, `provider_request_id_credential_shaped`, `provider_request_id_unusable`, or the adapter's own token | `claude-code-coding-provider.ts` and `julius-router.ts` |
| `archive.artifactName` | `artifact_name` (`julius-live-evidence`) | `#445` `da345243` `scripts/julius-paid-run-archive.mjs:45` and the `paid_runs.runs` column |
| `archive.artifactDigest` | `artifact_digest` | same schema, 64 lowercase hex |
| `archive.fileCount` | `file_count` | same schema |
| `archive.totalBytes` | `total_bytes` | same schema |
| `archive.conclusion` | `conclusion` | `githubRun()` in that file, from the Actions run |
| `archive.failedSteps` | `failed_steps` | `githubRun()` maps each failed step to `` `${job.name}: ${step.name}` `` |
| `archive.files[].path` | `paid_runs.files.path` | same schema |
| `archive.files[].sha256` | `paid_runs.files.sha256` | same schema |
| `archive.files[].kind` | `table` \| `text` | same schema |
| `workArtifactRefs` | `artifact:` + `julius-work-artifact.v1` | `#445` `da345243` `src/relay/mission/julius/julius-work-artifact.ts:94` `juliusWorkArtifactRef`. Kinds at line 34: `PLAN`, `GUIDANCE`, `DIFF`, `TEST_OUTPUT`, `BASE_REVISION`, `REVIEW_PACKET`, `RESEARCH`. |
| `projectBrainRevision` | `projectBrainRevision` | `#445` `da345243` `src/relay/mission/julius/julius-runtime-api.ts:93` `JuliusRunView` |
| `phases[].role` | `PROMPT_ARCHITECT` \| `CODING_AGENT` \| `INDEPENDENT_REVIEWER` | `JuliusSlotView.role`, `julius-runtime-api.ts` `JULIUS_DEFAULT_ROLES` |
| `phases[].state` | `NEVER_DISPATCHED` \| `ACTIVE` \| `IDLE` \| `FAILED` | `julius-runtime-api.ts:239` |
| `phases[].stage` | `plan` \| `build` \| `repair:plan` \| `repair:build` | `julius-router.ts:224`. Repair is a stage on the parent role. |
| `phases[].knownUsdMicros` | `JuliusSlotView.knownUsdMicros` | `julius-runtime-api.ts:244`. A floor when `costComplete` is false. |
| `phases[].costComplete` | `JuliusSlotView.costComplete` | same slot view |
| `juliusFinalState` | `julius_final_state` / `JuliusMissionState` | archive column; `julius-runtime.ts` `JULIUS_MISSION_STATES` includes `COMPLETED` |
| `traceId` | derived, not stored | `scripts/julius-mission-trace.mjs` `juliusMissionTraceId`. First 32 hex of SHA-256 of `julius-trace.v1:` plus the `wlj_` id. |
| `traceparent` | `00-<traceId>-<spanId>-01` on a phase | Mission scope is null. Each phase with a role, stage, and attempt carries its own header. |
| `phases[].attempt` | decimal attempt, no padding | Reader-supplied safe integer `>= 0`. Absent is null, and then `spanId` is null. |
| `phases[].spanId` | derived, not stored | First 16 hex of SHA-256 of `julius-span.v1:<wlj>:<role>:<stage>:<attempt>`. |
| `phases[].traceparent` | W3C traceparent | `juliusMissionTraceparent(traceId, spanId)`. |

`#404` `0c2ac2a9` pins the same spent-tag bytes as `#434`. `#440` `e01a1df8` `relay-bridge/julius-companion-evidence.ts` is a different row (companion wire state, untrusted summary, content hash). It is not this completion record, and this route does not read it.

## Trace id

No stored `traceId` turned up on the Julius run view, the coder or reviewer receipt, the paid-run archive, or `julius-first-live-mission.yml` at `da345243`. The id in this interface is derived. YUJI's runtime, the coder receipt, the reviewer receipt, and the paid-run archive should record `traceId` and `spanId` by calling `scripts/julius-mission-trace.mjs` with the admitted `JULIUS_RUN_ID`. The workflow does that derivation itself. Dispatch sends no trace id, and a dispatch-supplied trace id is never trusted.

`workflow_run_id` remains a GitHub Actions run id. The provider receipt id remains `providerRequestId`. `traceId` is a correlation id. It is not a secret and it is not proof of spend. The spend tag stays authoritative.

`JuliusMissionResultView.verified` (`julius-runtime-api.ts:132`) is the runtime's own flag, true only when that runtime has already reached `COMPLETED`. This route does not recompute it. YUJI's reader reports `juliusFinalState`.

`providerMessageId` is recorded beside the request id and is not accepted as a receipt.

## Routes

Both routes are loopback-only and use the shared `wlj_` parser. A legacy `run:` id, a `preflight:` id, a malformed id, and an unknown id are `404 { error: { kind: "not_found", message: "Not found." } }`. Any other peer is `403` `julius_dispatch_not_loopback`.

`/result` returns the status identity, the derived `traceId`, and `completion: null`, or `state: "completed"` and the evidence object when the reader returns the shape above. The completion object carries the same derived `traceId`.

`/progress` returns that same ceiling or `completed`, the same `traceId`, and `phases` from the same object. Each phase includes `spanId` when role, stage, and attempt are all present. No phase list from the reader is `phases: null`.
