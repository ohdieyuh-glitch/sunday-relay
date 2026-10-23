# J1 presentation spec

**Status: PROPOSED.** Written for Skywalker's acceptance. Nothing in this file is a frozen contract. Field names marked PROPOSED are the wrapper's current guesses; YUJI owns the real status and result names. `serverRunId` is BRIDGE's additive name for now.

The player-visible behavior below is pinned by `wonderland/Tools/j1_wrapper_kat.cpp`. Each row names the `Expect` that fails if the row drifts. The pure session is `WonderlandJuliusMissionClient`. Cosmo's logic layer is called as-is and is not modified.

An Unreal build has not been run. The subsystem, component, and PlatformCrypto call are seams around that pure session.

## What the player can be told

Fixed strings, not proposals:

| Label | When | Test |
|---|---|---|
| `no mission yet` | Idle. No pair. | session starts idle; `corrupt_save_stays_idle` |
| `sending the mission` | A dispatch request is in flight. | `dispatch_label` |
| `still waiting for the bridge` | NoAnswer, transport failure, or the resend schedule is exhausted (`StillWaitingLabel()`). | `transport_label`, `still_waiting_matches_logic_label`, `still_waiting_label_after_schedule` |
| `queued behind a running chain` | `429` `julius_dispatch_busy`, including a busy first send. | `busy_first_send_label`, `ui_busy_label` |
| `admitted, waiting for the paid run` | `202` or `200` with `data.state` `ADMISSION_HELD`. | `admit_202_label`, `ui_202_admission_held_label`, `ui_200_replay_label` |

PROPOSED strings, pinned so the UI does not invent a second wording:

| Label | When | Test |
|---|---|---|
| `the paid run is in progress` | A status body has JSON boolean `providersRunning: true`. | `running_label`, `status_providers_true_is_running` |
| `could not confirm the server run` | The admission body for this pair disagrees with the stored server run id, the id is unreadable, or `data.runId` is not the client's `wlj_` id. | `mismatch_label` |
| `could not start` | The CSPRNG could not fill 16 bytes. Nothing is minted. | `random_failure_refuses`, `random_failure_stays_idle` |
| `pending judge` | Finished artifact, digest matches, empty transform evidence. | `artifact_pending_judge` |
| `unverified` | Artifact text contains `[redacted]`. | `artifact_redacted_unverified` |
| `not qualifying` | Finished result that does not qualify. Same helper as the two labels above. | Cosmo `QualificationDisplayLabel`; wrapper does not add a pass label |
| `arrived damaged` | Result envelope or inner text failed closed. | wrapper label `LabelArrivedDamaged` |

None of the waiting labels is a refusal. The trace event `refusal_shown` is written only when `ClassifyDispatchAnswer` returns Refused (`ui_cap_refusal`, `ui_mission_cap_refusal`, `ui_disabled_503_refusal`, and `transport_is_not_a_refusal`, `busy_is_not_a_refusal`, `mismatch_is_not_a_refusal`).

The client never shows a pass. `artifact_trace_has_no_pass`, `artifact_label_has_no_pass`.

## UI state enum

`ui_state` in the trace is the player-visible label. `ui_state_enum` is one of:

`idle`, `dispatching`, `admitted_waiting`, `still_waiting`, `queued_busy`, `running`, `completed`, `refused`, `failed`.

`state_change.from` and `state_change.to` are these tokens.

A dispatch `202` is `admitted_waiting`. It is never `running`, even when that body also says `dispatched: true` or `providersRunning: true`. `dispatch_providers_running_is_not_running`, `ui_202_admission_held_not_running`.

A status body whose `state` string is `RUNNING` does not move the UI. `status_running_word_is_not_running`. `providersRunning: false` leaves the UI on `admitted_waiting`. `status_providers_false_stays_admitted`.

Only a status answer with JSON boolean `providersRunning` true moves the enum to `running`.

## HTTP to UI

`ClassifyDispatchAnswer` is used as-is. The wrapper does not keep a second refusal list. A `4xx`/`5xx` that carries an error kind is Refused, except a `429` whose kind is not one of the two cap kinds: those stay NoAnswer, which is how `julius_dispatch_busy` and an unknown `429` stay off the refusal line.

| Response | Enum | Label | Refusal | Test prefix |
|---|---|---|---|---|
| `202` `ADMISSION_HELD` | `admitted_waiting` | `admitted, waiting for the paid run` | no | `ui_202_admission_held` |
| `200` `ADMISSION_HELD` (same pair) | `admitted_waiting` | `admitted, waiting for the paid run` | no | `ui_200_replay` |
| `429` `julius_dispatch_busy` | `queued_busy` | `queued behind a running chain` | no | `ui_busy` |
| `429` `julius_dispatch_cap_reached` | `refused` | `julius_dispatch_cap_reached` | yes | `ui_cap` |
| `429` `julius_dispatch_mission_cap_reached` | `refused` | `julius_dispatch_mission_cap_reached` | yes | `ui_mission_cap` |
| `429` any other kind | `still_waiting` | `still waiting for the bridge` | no | `ui_unknown_429` |
| bare `500` (no error kind) | `still_waiting` | `still waiting for the bridge` | no | `ui_bare_500` |
| transport / timeout | `still_waiting` | `still waiting for the bridge` | no | `ui_transport` |
| `503` `julius_dispatch_disabled` | `refused` | `julius_dispatch_disabled` | yes | `ui_disabled_503` |

Admission is not a paid workflow. The wrapper does not call a provider and does not add a spend path.

After Accepted, the idempotency key is dropped from the save (`admitted_save_drops_key`) and further news comes from the status poll. The poll interval is 5000 ms, separate from the resend schedule.

The status route is PROPOSED and not mounted by the admission adapter:

`GET {base}/relay-api/wonderland/julius/status?runId=&projectId=`

`Relay-Session` header, no idempotency key, no body. A `404` or a transport failure on that poll does not mean the providers are running.

## Server run id

Admission `202` and same-pair `200` may carry `data.serverRunId`.

- Missing, JSON `null`, or empty string: ignore. Not an error, and not a fabricated id. `server_run_id_absent_ignored`, `absent_resend_keeps_server_run_id`.
- First non-empty string: store it, including when the first `202` omitted it and a later `200` supplies it. `server_run_id_stored_when_first_seen`, `server_run_id_arriving_later_is_not_a_mismatch`.
- A later admission response for the same pair with a different id: trace event `error` with `reason` `server_run_id_mismatch` and `conflicting_server_run_id`. UI `failed`, label `could not confirm the server run`. The first id is kept. `mismatch_keeps_first_server_run_id`, `status_keeps_first_server_run_id`.
- A non-string, non-null value, a control character, or a string longer than 128: `server_run_id_unreadable`. Fail closed. `server_run_id_unreadable_fail_closed`.
- `data.runId` present and different from the client `wlj_` id: `admission_run_mismatch`. That body's `serverRunId` is not stored.

Fail closed does not call `RecordAnswer(Refused)` or `RecordAnswer(Accepted)`. The tracker stays open, so a later `Dispatch` does not mint. `mismatch_does_not_mint`, `mismatch_fill_count_unchanged`. Resend and poll timers are cleared. The attempt is not a `refusal_shown`.

The id is persisted with the open pair (`persist_server_run_id_with_open_pair`) and printed by `wl.Julius.J1.Status` as `server_run_id` (`status_shows_server_run_id`). Before the first admission response, trace events omit `server_run_id` (`trace_no_server_run_id_before_admission`). After that response, every sender trace event includes it: the string, or JSON `null` when the server has not given one (`trace_server_run_id_null_after_admission`, `trace_server_run_id_after_admission`).

## Resend

`NextResend` decides the wait: 2 seconds, doubling, cap 30 seconds, at most 8 resends, 180 seconds total. Only the open pair is resent. `resend_count_matches_next_resend`, `resend_tick_same_run`.

`StillWaiting` is terminal. It never mints. `still_waiting_never_mints`. A manual `wl.Julius.J1.Resend` after that sends nothing. `manual_resend_after_still_waiting_sends_nothing`.

A cap refusal is the admission outcome that may be followed by a later mint, and only when the player dispatches again. `cap_allows_a_later_mint`, `cap_mints_a_fresh_run`, `cap_mints_a_fresh_key`.

A failed trace write does not send. The pair stays open and is not replaced. `trace_write_failure_does_not_send`, `trace_write_failure_does_not_mint`.

## Randomness

Production bytes come from `IPlatformCrypto::Get().CreateContext()->CreateRandomBytes`, and only `EPlatformCryptoResult::Success` counts. There is no fallback to `CreatePseudoRandomBytes`, `RAND_bytes`, `FGuid`, or `FMath`. If the fill fails, the dispatch is refused and nothing is minted. `random_failure_refuses`.

The Unreal call is `wonderland/Source/Wonderland/Julius/WonderlandJuliusRandomBytes.cpp`. It has not been compiled by UBT in this environment. The signature assumed is the experimental PlatformCrypto plugin: `TUniquePtr<FEncryptionContext> CreateContext()` and `CreateRandomBytes(TArrayView<uint8>)`.

## Endpoint

Shipping always uses `http://127.0.0.1:8790`. `wl.Julius.J1.Endpoint` is compiled out of Shipping (`#if !UE_BUILD_SHIPPING`) and, in every build, a host other than `127.0.0.1`, `localhost`, or `[::1]` refuses the dispatch and sends nothing.

A rejected `SetBaseUrl` clears the endpoint. It does not fall back to the previous host. `public_endpoint_refused`, `public_endpoint_does_not_mint`, `loopback_override_accepted`, `loopback_override_can_send`.

Accepted shapes: `loopback_ipv4`, `loopback_localhost`, `loopback_ipv6`. Rejected: `loopback_rejects_public`, `loopback_rejects_suffix`, `loopback_rejects_userinfo`.

The dispatch URL is `{base}/relay-api/wonderland/julius/dispatch?projectId=` with `Authorization: Relay-Session <token>`, `x-relay-idempotency-key`, and no `Origin` header. `dispatch_url`, `dispatch_native_session`, `dispatch_has_no_origin`. `clientLogSha256` is the sha256 of the `dispatch_requested` JSONL line, including its trailing newline, written before the request. `client_log_hash_is_the_dispatch_line`.

## Trace

One JSON object per line:

`<ProjectSavedDir>/Logs/JuliusTrace/<runId>.jsonl`

The run id already starts with `wlj_`, so the file is `wlj_<uuid>.jsonl`. Events before a run id exists go to `Logs/JuliusTrace/_unminted.jsonl`. `trace_path_run_id`, `trace_path_unminted`, `trace_path_rejects_escape`.

The same line is logged under category `LogJuliusJ1` at Display verbosity. The Unreal log call is in the file sink, which the pure session does not include.

Every event carries `ts_utc_ms` (epoch milliseconds, never uptime), `client_role` (`sender` or `observer`), `player_net_id`, `build_sha`, `package_id`, `wlj_run_id`, `event`, `ui_state`, `ui_state_enum`. Empty identity fields are JSON `null`, not `""`. `trace_epoch_clock`, `trace_player`, `trace_build_sha`, `trace_package`.

`server_run_id` is included only after the first admission response, as described above.

Event names: `dispatch_requested`, `http_response`, `state_change`, `poll`, `progress`, `result_received`, `artifact_shown`, `refusal_shown`, `error`, `heartbeat`.

`http_response` also carries `http_status`, `code`, `latency_ms`, `classified_answer` (`Accepted`, `Refused`, or `NoAnswer`), `request_id`, `resend`.

`progress` carries `pct` and `step`. `progressPct` null or absent emits no progress event and is not stored as 0. `progress_null_is_not_zero`, `progress_pct`, `progress_step`.

Provider events also carry `provider_request_id`, `model_id`, and `provider_fields` with the literal `PROPOSED`. `proposed_provider_request_id`, `proposed_model_id`, `provider_fields_marked_proposed`.

`artifact_shown` carries `artifact_id`, `sha256`, `mime`. `artifact_shown_event`, `artifact_shown_sha256`, `artifact_id_proposed`, `artifact_mime_proposed`.

The session token and the idempotency key are never written. `trace_omits_token`, `trace_omits_key`, `status_omits_token`, `status_omits_key`, `save_omits_token`, `unminted_trace_omits_token`.

`--pair` on `wl.Julius.J1.Dispatch` is `pair_id` in the trace. It is not the key and not the token. `trace_pair`.

### PROPOSED J1 response fields

Read from `data` only. YUJI has not agreed these names.

| JSON field | Trace / use |
|---|---|
| `providersRunning` | JSON boolean. Only `true` means running. |
| `progressPct` | number or null. The raw number token is echoed. Absent and null are Unknown. |
| `progressStep` | string or null. |
| `providerRequestId` | `provider_request_id` |
| `modelId` | `model_id` |
| `artifactId` | `artifact_id` |
| `mime` | `mime` |
| `serverRunId` | `server_run_id`. BRIDGE's current additive name, not a guess. |

Result bodies that already match Cosmo's `resultText` contract are read under those existing names: `runId`, `missionId`, `mode`, `state`, `failure`, `artifactSha256`, `artifactText`, and outer `resultSha256`.

`clientOffsetMs` is sent on the dispatch body only when an offset is known. It is never invented as 0.

## Heartbeat

Every 5000 ms while a session is active, including fail-closed. The first beat is 5000 ms after activity starts, not immediately. `heartbeat_not_before_5s`, `heartbeat_at_5s`.

Each beat carries `ts_utc_ms` and `system_clock_utc_ms` (the same epoch reading). `ntp_offset_ms` is a number only when the offset source is `ntp` and the offset is known. Otherwise it is JSON `null`. `heartbeat_ntp_unknown_is_null`, `heartbeat_ntp_offset`, `heartbeat_system_clock`.

## Save

`<ProjectSavedDir>/SaveGames/JuliusJ1/open-pair.v1`, document `WJ1OPEN 1`. The open pair (run id, key, attempt count, waited ms, server run id) is restored on startup. `persist_open_pair_round_trip_loads`, `persist_round_trip_run`, `resend_after_restore`, `resend_same_key`.

The key is kept only while the pair is open and not admitted, fail-closed, refused, or finished. The token is never in the save. A missing or corrupt save stays idle and mints nothing. `missing_save_is_not_a_pair`, `corrupt_save_fails_closed`, `corrupt_save_does_not_mint`.

## Console

| Command | Behavior |
|---|---|
| `wl.Julius.J1.Dispatch <missionId> [--pair <id>]` | Starts one attempt. `--pair` is the correlation id. |
| `wl.Julius.J1.Resend` | Resends the open pair under `NextResend`. Never mints. `manual_resend_sends`, `manual_resend_same_run`. |
| `wl.Julius.J1.Status` | One JSON line, including `server_run_id`. |
| `wl.Julius.J1.DumpTrace` | Prints the JSONL file for the current run. |

`wl.Julius.J1.Endpoint` is the non-Shipping cvar described above.

## Observer

This client does not replicate. FORGE calls `NotifyReplicatedMissionObserved` when replicated state arrives. That writes one line under the same `wlj_` run id with `client_role` `observer`. It does not change the sender's label, does not send HTTP, and does not mint. `observer_role`, `observer_same_run`, `observer_does_not_change_sender`, `observer_does_not_mint`. `server_run_id` is included only when the receipt says the replicated payload carried one. `observer_server_run_id`. A run id that is not a strict `wlj_` id is dropped. `observer_rejects_bad_run`.

## Artifact display

`ClassifyArtifactQualification` then `DisplayQualification`, with empty `FTransformEvidence` (R4-F). The mission id must be the mission the player triggered. The expected result mode must be set or the result fails closed (`ModeMismatch`). Lone surrogates in JSON `\u` escapes become U+FFFD before the digest check. The digest prefix shown to the player is 12 hex digits. `artifact_digest12`.
