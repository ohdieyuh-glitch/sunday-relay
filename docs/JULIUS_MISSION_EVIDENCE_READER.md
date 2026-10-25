# Julius mission evidence reader

**Owned by YUJI. Supplied by YUJI's PR.**

YUJI owns the server-side reader that matches the `julius-run-spent.v1` tag's `workflow_run_id` to the actual workflow run and returns completion evidence. This branch does not implement that reader. It does not call GitHub, and it does not re-derive completion from a workflow run.

The interface is `JuliusMissionEvidenceReader` in `relay-bridge/julius-mission-evidence.ts`. `createJuliusMissionEvidenceTestDouble` is a test double. It plays back a stored value. It is not YUJI's reader. Production wires no reader: `relay-bridge/server.ts` constructs the result and progress bridge without one.

Until that reader is wired, `GET /relay-api/wonderland/julius/missions/{wljRunId}/result` and `GET .../progress` report the Wonderland status projection and nothing past it. `dispatched` is the furthest state `GET /wonderland/julius/status` can show (`src/relay/integration/wonderland-admission/admission-contract.ts`, `WONDERLAND_STATUS_STATES`). Neither route reports `completed` from a dispatch, from `{ completed: true }`, or from any value that is not the shape below.

## What the reader returns

`read(wljRunId)` returns the object `acceptJuliusMissionEvidence` accepts, or null. Completion requires both:

- `juliusFinalState: "COMPLETED"` — the runtime word `JULIUS_MISSION_STATES` uses, and the archive column `julius_final_state`. This route does not compute it.
- `spendTag` — the `julius-run-spent.v1` message fields. The `run` must be the path's `wlj_` id. `spendTag.workflowRunCreatedAt` (ISO UTC) is the `created_at` of the Actions run the reader matched to `workflowRunId`. It is required: without it the read is not completion.

## Bound to the operator dispatch record

The routes read evidence only for a row whose status is `dispatched`, and then bind it to the operator claim record (`bindJuliusEvidenceToDispatch`). Completion survives only when a dispatch time is recorded, the spend tag's `workflowRunId` equals the workflow run id the claim recorded (when it recorded one; `gh workflow run` does not always print it), and the matched run was created no earlier than the recorded dispatch, compared at whole seconds. Otherwise the route stays on the status ceiling with `checkerVerdict: "NOT_RUN"`. `#446` at `041d2599` does not supply `workflowRunCreatedAt`, so its reads are not completion until it does.

A missing section is null on the completion object. Null is unknown. A missing cost is not zero. `providerMessageId` is not a field: a message id does not make a receipt `CAPTURED`.

## What PR 446 returns

`041d2599` `relay-bridge/julius-mission-evidence-reader.ts` `read` returns one object, or null. This branch does not import that file. The check in `acceptJuliusMissionEvidence` accepts the object and ignores a `traceId` on it.

`read` is non-null only for a verified completion. The `julius-run-spent.v1` tag carries the `wlj_` id, the Actions run succeeded, the completion marker matches, `live-mission.evidence.txt` has exactly one `RESULT: COMPLETED` line for that id, and `runs.tsv` is absent or agrees (that file, the `read` body above the return at lines 523–537).

| Field | What `041d2599` puts there |
|---|---|
| `spendTag` | The annotated `julius-run-spent.v1` tag. `run` is the requested `wlj_` id. |
| `juliusFinalState` | `"COMPLETED"`. |
| `spendAccounting` | `null` (line 526). No source is wired yet. |
| `coderCost` | `coderCostFrom` of the `CODING_AGENT` rows in `worker-diagnostics.tsv` (line 527). |
| `missionCost` | `missionCostFrom` of `cost-accounting.tsv` (line 528). |
| `providerReceipt` | The single `CODING_AGENT` receipt (line 529). `providerRequestId` is the `provider_request_id` column. `responseId` is the `response_id` column (`receiptFromRow`, lines 341–364, assigned at lines 348–349). The response id is kept only when the request was captured and the response string is plain. It is a different field. It is never copied from `providerRequestId`. |
| `archive` | `archiveFrom` of the `julius-live-evidence` artifact (line 530). |
| `workArtifactRefs` | `workRefsFrom` of `evidence.tsv` (line 531). |
| `projectBrainRevision` | `null` (line 532). `#454` `44a7f1e1` reads `runs.tsv` `project_brain_revision` instead. |
| `phases` | `null` (line 533). `#454` `44a7f1e1` reads `slot-events.tsv` instead. |
| `traceId` | `juliusMissionTraceId` of the admitted id (line 534). `acceptJuliusMissionEvidence` ignores this value and derives the id again. |
| `traceparent` | `null` (line 535). The mission is not a span. |

A completion object with those three nulls is still completion. A null `read()` is not. After a recorded dispatch the route stays `dispatched`.

## What PR 454 returns

`44a7f1e1` is stacked on `#446` at `b46ea104`. This branch does not import that stack. `read(wljRunId: string): Promise<unknown>` is unchanged. A non-null return still requires the same verified completion: the spend tag, a succeeded Actions run, the completion marker, one `RESULT: COMPLETED` line, and `runs.tsv` absent or in agreement. An in-progress or failed run is still a null `read()`, and these routes do not invent phases for it.

`spendAccounting` stays `null` (`julius-mission-evidence-reader.ts:623`). Phase `spanId` and `traceparent` stay `null` (`:546-547` and the mission `traceparent` at `:632`).

`phases` is `projectJuliusSlotViews` of `slot-events.tsv` (`phasesFrom`, assigned at `:630`). A missing file, the word `unavailable`, or a malformed table is `null`. A header and no rows is three phases, `PROMPT_ARCHITECT`, `CODING_AGENT`, `INDEPENDENT_REVIEWER`, each `NEVER_DISPATCHED`, `knownUsdMicros: 0`, `costComplete: true`, `stage: null`, `attempt: null`. Those zeros are the projection. They are not a stand-in for a missing list.

`projectBrainRevision` is the integer in `runs.tsv` column `project_brain_revision` (`brainRevision`, assigned at `:629`). `0` is the stored counter. An empty cell or a non-integer is `null`. `0` is not written when the cell is missing.

The objects those tests expect are copied in `relay-bridge/julius-mission-evidence.conformance.test.ts` from `44a7f1e1` `relay-bridge/julius-mission-evidence-reader.test.ts:382-415` (a present projection and revision `0`), `:417` (revision `4`), `:434-438` (header-only), `:446-452` and `:486-488` (missing or malformed slots, phases `null`), and `:503-508` (revision `null`).

`acceptJuliusMissionEvidence` keeps a phase list only when it is that three-phase shape, including `spanId: null` and `traceparent: null`. Any other list is `null`. It does not derive a span id to fill the gap. `projectBrainRevision` is kept when it is a non-negative safe integer, and `0` stays `0`. A string, a fraction, or a negative number is `null`. Phases and the revision are published only when the spend tag and `juliusFinalState: "COMPLETED"` both hold.

`/result` and `/progress` both include `phases` and `projectBrainRevision`. Null stays null in the JSON. That is absent. It is not `[]`, not `0`, and not a phase list built from the trace module. The website's word for a null is Unknown. These routes return the null.

`traceId` and `traceparent` are on this shape. The bridge fills them from `scripts/julius-mission-trace.mjs` using the admitted `wlj_` id. A `traceId`, `traceparent`, or `spanId` on the reader payload is ignored. The paid workflow derives the same values from the admitted `JULIUS_RUN_ID` by importing that module. Dispatch does not send a trace id. A trace id supplied by dispatch is never trusted. See `docs/JULIUS_MISSION_TRACE.md`.

The table below is the field inventory those names were read from. `#446` does not fill `spendAccounting`, `phases`, or `projectBrainRevision` from those rows. It returns null for each, and accept keeps the null.

| Interface field | Source field | Where it was read |
|---|---|---|
| `spendTag.schema` | `julius-run-spent.v1` | `#445` `da345243` `.github/workflows/julius-first-live-mission.yml:274` |
| `spendTag.run` | `run=` | same line |
| `spendTag.namespace` | `namespace=` | same line |
| `spendTag.reservedUsdMicros` | `reservedUsdMicros=` | same line. This is the reservation, not the settled bill. |
| `spendTag.workflowRunId` | `workflow_run_id=` | same line. GitHub Actions run id. Not an application trace id. |
| `spendTag.workflowRunAttempt` | `workflow_run_attempt=` | same line |
| `spendTag.headSha` | `head_sha=` | same line |
| `spendTag.workflowRunCreatedAt` | the matched run's `created_at` | the reader's own read of the Actions run. Not in `041d2599`. Required by this bridge. |
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
| `providerReceipt.responseId` | `response_id` | `#446` `041d2599` `relay-bridge/julius-mission-evidence-reader.ts:348`. Kept only when the request id was captured and this string is plain. Never copied from `providerRequestId`. Absent is null. |
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
| `projectBrainRevision` | `runs.tsv` `project_brain_revision` | `#454` `44a7f1e1` `relay-bridge/julius-mission-evidence-reader.ts:629`. A non-negative integer. `0` is a real counter. Missing or not an integer is null. |
| `phases[].role` | `PROMPT_ARCHITECT` \| `CODING_AGENT` \| `INDEPENDENT_REVIEWER` | `JuliusSlotView.role`, `julius-runtime-api.ts` `JULIUS_DEFAULT_ROLES` |
| `phases[].state` | `NEVER_DISPATCHED` \| `ACTIVE` \| `IDLE` \| `FAILED` | `julius-runtime-api.ts:239` |
| `phases[].stage` | `plan` \| `build` \| `repair:plan` \| `repair:build` | `julius-router.ts:224`. Repair is a stage on the parent role. |
| `phases[].knownUsdMicros` | `JuliusSlotView.knownUsdMicros` | `julius-runtime-api.ts:244`. A floor when `costComplete` is false. |
| `phases[].costComplete` | `JuliusSlotView.costComplete` | same slot view |
| `juliusFinalState` | `julius_final_state` / `JuliusMissionState` | archive column; `julius-runtime.ts` `JULIUS_MISSION_STATES` includes `COMPLETED` |
| `traceId` | derived, not stored | `scripts/julius-mission-trace.mjs` `juliusMissionTraceId`. First 32 hex of SHA-256 of `julius-trace.v1:` plus the `wlj_` id. |
| `traceparent` | null | Mission scope is null. `#454` `44a7f1e1` also leaves each phase `traceparent` null. |
| `phases[].attempt` | decimal attempt, no padding | The last attempt the slot ledger recorded, or null. |
| `phases[].spanId` | null | `#454` `44a7f1e1` `julius-mission-evidence-reader.ts:546`. Not derived onto the projection. |
| `phases[].traceparent` | null | `#454` `44a7f1e1` `julius-mission-evidence-reader.ts:547`. |

`#404` `0c2ac2a9` pins the same spent-tag bytes as `#434`. `#440` `e01a1df8` `relay-bridge/julius-companion-evidence.ts` is a different row (companion wire state, untrusted summary, content hash). It is not this completion record, and this route does not read it.

## Trace id

No stored `traceId` turned up on the Julius run view, the coder or reviewer receipt, the paid-run archive, or `julius-first-live-mission.yml` at `da345243`. The id in this interface is derived. YUJI's runtime, the coder receipt, the reviewer receipt, and the paid-run archive should record `traceId` and `spanId` by calling `scripts/julius-mission-trace.mjs` with the admitted `JULIUS_RUN_ID`. The workflow does that derivation itself. Dispatch sends no trace id, and a dispatch-supplied trace id is never trusted.

`workflow_run_id` remains a GitHub Actions run id. The provider receipt id remains `providerRequestId`. `traceId` is a correlation id. It is not a secret and it is not proof of spend. The spend tag stays authoritative.

`JuliusMissionResultView.verified` (`julius-runtime-api.ts:132`) is the runtime's own flag, true only when that runtime has already reached `COMPLETED`. This route does not recompute it. YUJI's reader reports `juliusFinalState`.

`providerMessageId` is recorded beside the request id and is not accepted as a receipt.

## Routes

Both routes are loopback-only and use the shared `wlj_` parser. A legacy `run:` id, a `preflight:` id, a malformed id, and an unknown id are `404 { error: { kind: "not_found", message: "Not found." } }`. Any other peer is `403` `julius_dispatch_not_loopback`.

`/result` returns the status identity, the derived `traceId`, `phases`, `projectBrainRevision`, and `completion: null`, or `state: "completed"` and the evidence object when the reader returns the shape above. The completion object carries the same derived `traceId`. Its `traceparent` is null.

`/progress` returns that same ceiling or `completed`, the same `traceId`, the same `phases`, and the same `projectBrainRevision`. A phase list is rendered only when the verified completion carries the three-phase projection. `spanId` and `traceparent` on those phases stay null. `projectBrainRevision: 0` is rendered as `0`. A null revision stays null and is not rendered as `0`. `#446` supplies `phases: null` and `projectBrainRevision: null`, and both routes return those nulls. A null `read()`, and a read that is not a verified completion, leaves `state` on the status ceiling and both fields null.
