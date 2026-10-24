#!/usr/bin/env python3
"""Sabotage check: each mutation breaks one rule in a temp copy; the KAT must then FAIL (exit non-zero).
Every target string must occur exactly once, so a mutation can never silently miss. Production code has no hooks."""
import os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, "..", ".."))  # wonderland/ (this script lives in wonderland/Tools/companion/)
# Only the files the KAT builds from are copied, not the whole wonderland/ tree.
NEEDED = ["Tools/j1_companion_kat.cpp"] + ["Source/Wonderland/" + n for n in (
    "WonderlandCompanionLogic.h", "WonderlandCompanionLogic.cpp", "WonderlandJuliusMissionLogic.h", "WonderlandJuliusMissionLogic.cpp",
    "WonderlandJuliusMissionProgress.h", "WonderlandJuliusMissionProgress.cpp")]
CPP = "Source/Wonderland/WonderlandCompanionLogic.cpp"
HDR = "Source/Wonderland/WonderlandCompanionLogic.h"
PH = "Source/Wonderland/WonderlandJuliusMissionProgress.h"

M = [
 ("crlf_split_counts_twice", CPP, "if (Byte == '\\n' && bAfterCr)", "if (false && Byte == '\\n' && bAfterCr)"),
 ("multiline_data_joined_without_lf", CPP, "Data.push_back('\\n');\n\t\t\tbHaveDataField = true;", "Data.push_back(' ');\n\t\t\tbHaveDataField = true;"),
 ("no_line_cap", CPP, "if (Line.size() >= MaxLineBytes)", "if (false && Line.size() >= MaxLineBytes)"),
 ("comment_parsed_as_field", CPP, "if (Line[0] == ':')", "if (false && Line[0] == ':')"),
 ("bom_not_stripped", CPP, "if (Byte == Bom[BomPending.size()])", "if (false && Byte == Bom[BomPending.size()])"),
 ("event_cap_off", CPP, "if (Data.size() + Value.size() + 1 > MaxEventDataBytes)", "if (false)"),
 ("dup_json_keys_allowed", CPP, "if (Out.Find(Key) != nullptr) { return false; }", ""),
 ("bidi_not_stripped", CPP, "|| (Cp >= 0x202A && Cp <= 0x202E) || (Cp >= 0x2066 && Cp <= 0x2069)", ""),
 ("unknown_event_ignored", CPP, "Fail(EChatProtocolFault::UnknownEvent); // Q2", "return; // Q2"),
 ("truncated_stream_accepted", CPP, "if (State == EChatStreamOutcome::Open) { Fail(EChatProtocolFault::Truncated); }", "if (State == EChatStreamOutcome::Open) { State = EChatStreamOutcome::Done; }"),
 ("wrong_provider_accepted", CPP, "Provider == nullptr || Provider->Text != \"openai\") { Fail", "Provider == nullptr) { Fail"),
 ("reply_cap_off_by_one", CPP, "Reply.size() + Text->Text.size() > ChatMaxReplyBytes", "Reply.size() + Text->Text.size() >= ChatMaxReplyBytes"),
 ("simulated_flag_ignored", CPP, "if (Simulated != nullptr && Simulated->Kind != FJsonValue::EKind::Bool) { Fail(EChatProtocolFault::MetaBadSimulated); return; }", ""),
 ("simulated_banner_hidden", CPP, "V.bShowSimulatedBanner = !bReal;", "V.bShowSimulatedBanner = false;"),
 ("label_hardcoded", CPP, "V.ProviderLabel = LabelFor(\"openai\", \"api_key\");", "V.ProviderLabel = \"ChatGPT via your OpenAI key\";"),
 ("key_in_trace", CPP, "Note(\"connect_begin\");", "Note(\"connect_begin \" + std::string(Field.Buffer + Begin, End - Begin));"),
 ("key_field_not_wiped", CPP, "~FWipeOnExit() { F.Wipe(); }", "~FWipeOnExit() {}"),
 ("handoff_not_wiped", CPP, "void FKeyHandoff::MarkSent() { Wipe(); }", "void FKeyHandoff::MarkSent() {}"),
 ("key_echo_accepted", CPP, "if (Root.Find(Name) != nullptr) { bOk = false; }", "(void)Name;"),
 ("localhost_origin_accepted", CPP, "if (Origin.substr(0, 17) == \"http://127.0.0.1:\")", "if (Origin.substr(0, 17) == \"http://127.0.0.1:\" || Origin.substr(0, 17) == \"http://localhost:\")"),
 ("model_sent_by_client", CPP, "Body += \"}\";\n\t\t\treturn Body;", "Body += \",\\\"model\\\":\\\"x\\\"}\";\n\t\t\treturn Body;"),
 ("idempotency_key_reuse", CPP, "|| !bKeyFresh || Message.empty()", "|| Message.empty()"),
 ("message_cap_8001", CPP, "Units > ChatMaxMessageUtf16Units", "Units > ChatMaxMessageUtf16Units + 1"),
 ("legacy_run_id_sent", CPP, "const bool bRunOk = WljRunId.empty() || WonderlandJuliusMissionLogic::IsClientMintedRunId(WljRunId);", "const bool bRunOk = true;"),
 ("auth_failed_stays_ready", CPP, "bKeyRejected = true;\n\t\t\t\tConnState = \"invalid\";", ""),
 ("retry_after_ignored", CPP, "RetryNotBefore = NowMs + WaitMs;", "RetryNotBefore = 0; (void)WaitMs;"),
 ("delete_history_not_retried", CPP, "if (HttpStatus == 204 || HttpStatus == 404)", "if (true)"),
 ("history_cap_21", HDR, "HistoryMaxTurns = 20;", "HistoryMaxTurns = 21;"),
 ("status_prefers_server_no_check", CPP, "if (Server != Legacy) { return EStatusParse::RunIdsDisagree; } // Q21 rule 3, non-null legacyRunId", ""),
 ("status_null_legacy_server_unchecked", CPP, "else if (Server != Wlj->Text) { return EStatusParse::RunIdsDisagree; } // Q21 rule 3, null legacyRunId", ""),
 ("status_interim_also_when_legacy_null", CPP, "else if (!bLegacyPresent && WonderlandJuliusMissionLogic::IsServerRunId(Server))", "else if (WonderlandJuliusMissionLogic::IsServerRunId(Server))"),
 ("status_server_shape_unchecked", CPP, "if (!bServerShapeOk) { return EStatusParse::BadServerRunId; }", "if (!ServerSlot->IsString()) { return EStatusParse::BadServerRunId; }"),
 ("status_data_wrapper_accepted", CPP, "if (Root.Find(\"data\") != nullptr || Root.Find(\"phase\") != nullptr) { return EStatusParse::BadPhase; }", "if (Root.Find(\"phase\") != nullptr) { return EStatusParse::BadPhase; }"),
 ("status_phase_key_accepted", CPP, "if (Root.Find(\"data\") != nullptr || Root.Find(\"phase\") != nullptr) { return EStatusParse::BadPhase; }", "if (Root.Find(\"data\") != nullptr) { return EStatusParse::BadPhase; }"),
 ("status_running_accepted", CPP, "{\"dispatch_failed\", EStatusState::DispatchFailed}, {\"already_spent\", EStatusState::AlreadySpent},", "{\"dispatch_failed\", EStatusState::DispatchFailed}, {\"already_spent\", EStatusState::AlreadySpent}, {\"running\", EStatusState::Dispatched},"),
 ("status_expired_accepted", CPP, "{\"dispatch_failed\", EStatusState::DispatchFailed}, {\"already_spent\", EStatusState::AlreadySpent},", "{\"dispatch_failed\", EStatusState::DispatchFailed}, {\"already_spent\", EStatusState::AlreadySpent}, {\"expired\", EStatusState::Failed},"),
 ("status_old_cause_spelling_accepted", CPP, "{\"AWAITING_OPERATOR_EXPIRED\", EStatusCause::AwaitingOperatorExpired},", "{\"AWAITING_OPERATOR_EXPIRED\", EStatusCause::AwaitingOperatorExpired}, {\"operator_window_expired\", EStatusCause::AwaitingOperatorExpired},"),
 ("status_expiry_cause_on_any_state", CPP, "if (Cause == EStatusCause::AwaitingOperatorExpired && State != EStatusState::Failed) { return EStatusParse::BadCause; }", ""),
 ("status_dispatched_at_unchecked", CPP, "if (WonderlandJuliusMissionLogic::ParseBridgeUtcTimestampMs(Dispatched->Text, DispatchedAt)) { bHasDispatchedAt = true; }", "if (true) { (void)WonderlandJuliusMissionLogic::ParseBridgeUtcTimestampMs(Dispatched->Text, DispatchedAt); bHasDispatchedAt = true; }"),
 ("dispatched_at_fraction_faults", CPP, "				DispatchedAt = 0;\n				bDispatchedAtUnconfirmed = true;", "				return EStatusParse::BadDispatchedAt;"),
 ("dispatched_at_nonstring_accepted", CPP, "if (!Dispatched->IsString()) { return EStatusParse::BadDispatchedAt; }", "if (!Dispatched->IsString()) { return EStatusParse::Ok; }"),
 ("dispatched_at_unconfirmed_flag_dropped", CPP, "				bDispatchedAtUnconfirmed = true;", "				bDispatchedAtUnconfirmed = false;"),
 ("dispatched_at_unconfirmed_not_copied", CPP, "		Out.bDispatchedAtUnconfirmed = bDispatchedAtUnconfirmed;\n", "		(void)bDispatchedAtUnconfirmed;\n"),
 ("dispatched_at_unconfirmed_meaning_ignored", CPP, "return Status.bHasDispatchedAt ? EStatusMeaning::DispatchedNotReported : EStatusMeaning::DispatchUnconfirmed;", "return EStatusMeaning::DispatchedNotReported;"),
 ("dispatched_absent_reads_confirmed", CPP, "return Status.bHasDispatchedAt ? EStatusMeaning::DispatchedNotReported : EStatusMeaning::DispatchUnconfirmed;", "return (Status.bHasDispatchedAt || !Status.bDispatchedAtUnconfirmed) ? EStatusMeaning::DispatchedNotReported : EStatusMeaning::DispatchUnconfirmed;"),
 ("dispatched_meaning_inverted", CPP, "return Status.bHasDispatchedAt ? EStatusMeaning::DispatchedNotReported : EStatusMeaning::DispatchUnconfirmed;", "return Status.bHasDispatchedAt ? EStatusMeaning::DispatchUnconfirmed : EStatusMeaning::DispatchedNotReported;"),
 ("dispatched_at_null_faults", CPP, "if (const FJsonValue* Dispatched = Root.Find(\"dispatchedAt\"); Dispatched != nullptr && !Dispatched->IsNull())", "if (const FJsonValue* Dispatched = Root.Find(\"dispatchedAt\"); Dispatched != nullptr)"),
 ("pin_missing_becomes_confirmed", CPP, "const bool bKeepDispatchedAt = bHaveAny && Current.bHasDispatchedAt && !Status.bHasDispatchedAt;", "const bool bKeepDispatchedAt = bHaveAny && !Status.bHasDispatchedAt;"),
 ("pin_good_time_never_confirms", CPP, "		const bool bKeepDispatchedAt = bHaveAny && Current.bHasDispatchedAt && !Status.bHasDispatchedAt;\n		const std::uint64_t KeptDispatchedAt = Current.DispatchedAtMs;\n		Current = Status;", "		const bool bKeepDispatchedAt = bHaveAny && Current.bHasDispatchedAt && !Status.bHasDispatchedAt;\n		const std::uint64_t KeptDispatchedAt = Current.DispatchedAtMs;\n		const bool bHadTime = Current.bHasDispatchedAt || !bHaveAny;\n		Current = Status;\n		if (!bHadTime) { Current.bHasDispatchedAt = false; }"),
 ("dispatched_at_unconfirmed_label_claims_run", CPP, "case EStatusMeaning::DispatchUnconfirmed: return \"Can't confirm when the run was started \\xE2\\x80\\x94 still checking with the bridge\";", "case EStatusMeaning::DispatchUnconfirmed: return \"Dispatched; run started\";"),
 ("pin_unconfirmed_flag_kept", CPP, "			Current.bDispatchedAtUnconfirmed = false; // the recorded dispatch time stands", "			(void)0; // the recorded dispatch time stands"),
 ("pin_unconfirmed_moves_dispatched_at", CPP, "const bool bKeepDispatchedAt = bHaveAny && Current.bHasDispatchedAt && !Status.bHasDispatchedAt;", "const bool bKeepDispatchedAt = bHaveAny && Current.bHasDispatchedAt && !Status.bHasDispatchedAt && !Status.bDispatchedAtUnconfirmed;"),
 ("terminal_missing_ledger_unwritten", CPP, "		case EStatusState::LedgerUnwritten:\n		case EStatusState::Interrupted:\n		case EStatusState::Failed:\n		case EStatusState::DispatchFailed:\n		case EStatusState::AlreadySpent:\n			return true;\n		case EStatusState::Held:", "		case EStatusState::Interrupted:\n		case EStatusState::Failed:\n		case EStatusState::DispatchFailed:\n		case EStatusState::AlreadySpent:\n			return true;\n		case EStatusState::LedgerUnwritten:\n		case EStatusState::Held:"),
 ("terminal_includes_unknown", CPP, "		case EStatusState::Dispatched:\n		case EStatusState::Unknown:\n			return false;", "		case EStatusState::Unknown:\n			return true;\n		case EStatusState::Dispatched:\n			return false;"),
 ("meaning_expiry_shown_as_failure", CPP, "return Status.Cause == EStatusCause::AwaitingOperatorExpired ? EStatusMeaning::NotStartedOperatorWindowExpired", "return Status.Cause == EStatusCause::AwaitingOperatorExpired ? EStatusMeaning::AdmissionEnded"),
 ("status_request_any_origin", CPP, "if (!IsLoopbackRelayOrigin(RelayOrigin) || !bRunIdOk || !IsQuerySafeProjectId(ProjectId)) { return Out; }", "if (!bRunIdOk || !IsQuerySafeProjectId(ProjectId)) { return Out; }"),
 ("pin_any_wlj_accepted", CPP, "if (Status.WljRunId != Own || !WonderlandJuliusMissionLogic::IsAcceptedServerRunId(Status.WljRunId, Own))", "if (!WonderlandJuliusMissionLogic::IsClientMintedRunId(Status.WljRunId))"),
 ("pin_legacy_change_ok", CPP, "if (bHaveAny && Status.LegacyRunId != Current.LegacyRunId)", "if (false)"),
 ("pin_stale_applied", CPP, "if (bHaveAny && Status.UpdatedAtMs < Current.UpdatedAtMs) { return EPinVerdict::Stale; }", ""),
 ("pin_equal_instant_dropped", CPP, "if (bHaveAny && Status.UpdatedAtMs < Current.UpdatedAtMs) { return EPinVerdict::Stale; }", "if (bHaveAny && Status.UpdatedAtMs <= Current.UpdatedAtMs) { return EPinVerdict::Stale; }"),
 ("pin_terminal_not_sticky", CPP, "if (bHaveAny && IsTerminalState(Current.State)) { return EPinVerdict::Stale; }", ""),
 ("pin_unknown_overwrites", CPP, "if (bHaveAny && Status.State == EStatusState::Unknown && Current.State != EStatusState::Unknown) { return EPinVerdict::Stale; }", ""),
 ("pin_admission_after_dispatch", CPP, "if (bHaveAny && Current.State == EStatusState::Dispatched && Status.State != EStatusState::Dispatched", "if (false && Current.State == EStatusState::Dispatched && Status.State != EStatusState::Dispatched"),
 ("pin_dispatched_at_moves", CPP, "bMismatch = true; // dispatchedAt is written once and never moves (v0.1 4.2)\n			return EPinVerdict::Mismatch;", "// moved\n			(void)0;"),
 ("pin_dispatched_at_erased", CPP, "Current.bHasDispatchedAt = true; // a later answer without the key does not erase a recorded dispatch time", "Current.bHasDispatchedAt = false;"),
 ("companion_non200_shown", CPP, "if (HttpStatus != 200) { return ECompanionMissionParse::NotOk; }", "if (HttpStatus >= 500) { return ECompanionMissionParse::NotOk; }"),
 ("companion_legacy_id_route", CPP, "if (!IsLoopbackRelayOrigin(RelayOrigin) || !WonderlandJuliusMissionLogic::IsClientMintedRunId(WljRunId) || !IsQuerySafeProjectId(ProjectId))", "if (!IsLoopbackRelayOrigin(RelayOrigin) || WljRunId.empty() || !IsQuerySafeProjectId(ProjectId))"),
 ("companion_project_id_unescaped", CPP, "|| C == '_' || C == '-';", "|| C == '_' || C == '-' || C == ' ' || C == '&';"),
 ("companion_other_run_shown", CPP, "if (Wlj == nullptr || !WonderlandJuliusMissionLogic::IsClientMintedRunId(OwnWljRunId) || Wlj->Text != OwnWljRunId)\n		{\n			return ECompanionMissionParse::RunIdMismatch;", "if (Wlj == nullptr)\n		{\n			return ECompanionMissionParse::RunIdMismatch;"),
 ("companion_verified_without_round_trip", CPP, "Out.bShowVerified = bHasProvenance && !ProvenanceView.bSimulated && ProvenanceView.bVerifiedByTokenRoundTrip;", "Out.bShowVerified = bHasProvenance && !ProvenanceView.bSimulated;"),
 ("companion_verified_when_simulated", CPP, "Out.bShowVerified = bHasProvenance && !ProvenanceView.bSimulated && ProvenanceView.bVerifiedByTokenRoundTrip;", "Out.bShowVerified = bHasProvenance;"),
 ("companion_untrusted_flag_ignored", CPP, "if (Untrusted == nullptr || Untrusted->Kind != FJsonValue::EKind::Bool || !Untrusted->bBool) { return ECompanionMissionParse::BadResult; }", ""),
 ("companion_content_accepted", CPP, "if (Artifact->Find(\"content\") != nullptr) { return ECompanionMissionParse::BadResult; } // never on this route", ""),
 ("companion_result_before_received", CPP, "if ((bHasResult || bHasProvenance) && !bResultAllowed) { return ECompanionMissionParse::ResultTooEarly; }", ""),
 ("companion_summary_cap_off", CPP, "if (S == nullptr || S->Text.size() > CompanionSummaryMaxBytes) { return ECompanionMissionParse::BadResult; }", "if (S == nullptr) { return ECompanionMissionParse::BadResult; }"),
 ("companion_no_result_missing", CPP, "{\"no_result\", ECompanionTaskState::NoResult}, ", ""),
 ("companion_no_result_not_terminal", CPP, "		case ECompanionTaskState::NoResult:\n		case ECompanionTaskState::Cancelled:\n			return true;", "		case ECompanionTaskState::Cancelled:\n			return true;\n		case ECompanionTaskState::NoResult:"),
 ("grok_cap_off_by_one", CPP, "if (Body.size() > CompanionResultMaxBytes)", "if (Body.size() >= CompanionResultMaxBytes)"),
 ("grok_other_run_accepted", CPP, "|| Wlj->Text != OwnWljRunId)\n		{\n			return EResultParse::RunIdMismatch;", ")\n		{\n			return EResultParse::RunIdMismatch;"),
 ("simulated_verified_allowed", CPP, "if (Simulated->bBool && bHasVerifiedBy) { return EProvenanceParse::SimulatedVerified; }", ""),
 ("status_legacy_switch_ignored", CPP, "if (!bLegacyPresent && bRequireLegacyRunId) { return EStatusParse::BadLegacyRunId; }", ""),
 ("status_legacy_switch_forced_on", CPP, "if (!bLegacyPresent && bRequireLegacyRunId)", "if (!bLegacyPresent)"),
 ("status_legacy_switch_flipped_shared", PH, "inline constexpr bool bStatusRouteRequiresLegacyRunId = false;", "inline constexpr bool bStatusRouteRequiresLegacyRunId = true;"),
 ("status_two_arg_ignores_switch", CPP, "return ParseMissionStatus(Body, Out, WonderlandJuliusMissionLogic::bStatusRouteRequiresLegacyRunId);", "return ParseMissionStatus(Body, Out, true);"),
 ("workflow_check_off", CPP, "if (!bWorkflowOk) { return EStatusParse::BadWorkflowRunId; }", ""),
 ("workflow_cap_plus_one", CPP, "Workflow->Text.size() <= WonderlandJuliusMissionLogic::StatusRouteWorkflowRunIdMaxBytes;", "Workflow->Text.size() <= WonderlandJuliusMissionLogic::StatusRouteWorkflowRunIdMaxBytes + 1;"),
 ("workflow_cap_minus_one", CPP, "Workflow->Text.size() <= WonderlandJuliusMissionLogic::StatusRouteWorkflowRunIdMaxBytes;", "Workflow->Text.size() < WonderlandJuliusMissionLogic::StatusRouteWorkflowRunIdMaxBytes;"),
 ("workflow_space_allowed", CPP, "bWorkflowOk = Byte >= 0x21 && Byte <= 0x7E;", "bWorkflowOk = Byte >= 0x20 && Byte <= 0x7E;"),
 ("workflow_non_ascii_allowed", CPP, "bWorkflowOk = Byte >= 0x21 && Byte <= 0x7E;", "bWorkflowOk = Byte >= 0x21;"),
 ("workflow_empty_allowed", CPP, "bool bWorkflowOk = Workflow->IsString() && !Workflow->Text.empty()", "bool bWorkflowOk = Workflow->IsString()"),
 ("workflow_number_allowed", CPP, "bool bWorkflowOk = Workflow->IsString() && !Workflow->Text.empty()", "bool bWorkflowOk = (Workflow->IsString() || !Workflow->IsString()) && (!Workflow->IsString() || !Workflow->Text.empty())"),
 ("workflow_present_is_fault", CPP, "Workflow != nullptr && !Workflow->IsNull())\n\t\t{\n\t\t\tbool bWorkflowOk = ", "Workflow != nullptr && !Workflow->IsNull())\n\t\t{\n\t\t\tbool bWorkflowOk = false && "),
 ("workflow_null_is_fault", CPP, "Workflow != nullptr && !Workflow->IsNull())", "Workflow != nullptr)"),
 # ---- BRIDGE chat answers Q1-Q15 (2026-10-24)
 ("q1_message_id_opaque_ok", CPP, "bool IsMessageId(std::string_view Text) { return HasPrefixedUuid(Text, \"msg_\"); }", "bool IsMessageId(std::string_view Text) { return !Text.empty(); }"),
 ("q1_replay_message_id_unpinned", CPP, "if (!ExpectedMsg.empty() && Msg->Text != ExpectedMsg)", "if (false && Msg->Text != ExpectedMsg)"),
 ("q1_resend_conv_from_request_only", CPP, "FChatStreamDecoder(PendingConvSeen.empty() ? PendingConvSent : PendingConvSeen, true, PendingMsgSeen)", "FChatStreamDecoder(PendingConvSent, true, PendingMsgSeen)"),
 ("q1_resend_message_id_dropped", CPP, "FChatStreamDecoder(PendingConvSeen.empty() ? PendingConvSent : PendingConvSeen, true, PendingMsgSeen)", "FChatStreamDecoder(PendingConvSeen.empty() ? PendingConvSent : PendingConvSeen, true, std::string())"),
 ("q2_sse_field_in_event_allowed", CPP, "if (Event.bHadIdOrRetry) { Fail(EChatProtocolFault::ForbiddenSseField); return; } // Q2", ""),
 ("q2_sse_field_count_ignored", CPP, "if (State == EChatStreamOutcome::Open && (Sse.IdFieldCount() != 0 || Sse.RetryFieldCount() != 0))", "if (false)"),
 ("q2_retry_field_unflagged", CPP, "++RetryFields;\n\t\t\tbIdOrRetryInEvent = true;", "++RetryFields;\n\t\t\t(void)0;"),
 ("q2_id_field_unflagged", CPP, "++IdFields;\n\t\t\tbIdOrRetryInEvent = true;", "++IdFields;\n\t\t\t(void)0;"),
 ("q3_meta_optional", CPP, "if (!bHaveMeta) { Fail(EChatProtocolFault::MetaMissing); return; } // Q3", "if (!bHaveMeta && !bReplay) { Fail(EChatProtocolFault::MetaMissing); return; } // Q3"),
 ("q3_replayed_on_fresh_ok", CPP, "if (bMetaReplayed && !bReplay) { Fail(EChatProtocolFault::MetaBadReplayed); return; }", ""),
 ("q3_replayed_non_bool_ok", CPP, "if (Replayed != nullptr && Replayed->Kind != FJsonValue::EKind::Bool) { Fail(EChatProtocolFault::MetaBadReplayed); return; }", ""),
 ("q3_replay_two_deltas_ok", CPP, "if (bReplayed && Deltas != 0) { Fail(EChatProtocolFault::ReplaySequence); return; } // Q3: one stored delta", ""),
 ("q3_replay_no_delta_ok", CPP, "if (bReplayed && Deltas != 1)", "if (bReplayed && Deltas > 1)"),
 ("q3_replay_delta_then_error_ok", CPP, "if (bReplayed && Deltas != 0) { Fail(EChatProtocolFault::ReplaySequence); return; } // Q3: meta, error", ""),
 ("q4_in_progress_no_backoff", CPP, "RetryNotBefore = NowMs + ChatInProgressBackoffMs;", "(void)0;"),
 ("q5_max_length_line_dropped", CPP, "TransientLine = Decoder.HitLengthLimit() ? LineLengthLimit : nullptr; // Q5", "TransientLine = nullptr; // Q5"),
 ("q5_max_length_word_wrong", HDR, "bool HitLengthLimit() const { return Finish_ == \"max_length\"; }", "bool HitLengthLimit() const { return Finish_ == \"length\"; }"),
 ("q6_too_large_generic", CPP, "else if (HttpStatus == 413) { SetError(LineTooLong, \"chat_too_large\"); }", "else if (HttpStatus == 413) { SetError(LineError, \"chat_too_large\"); }"),
 ("q6_body_invalid_untraced", CPP, "SetError(LineError, \"chat_body_invalid\");", "SetError(LineError, \"chat_http_error\");"),
 ("q6_request_cap_shrunk", HDR, "ChatMaxRequestBodyBytes = 64 * 1024;", "ChatMaxRequestBodyBytes = 32 * 1024;"),
 ("q7_delete_409_treated_as_done", CPP, "if (HttpStatus == 204 || HttpStatus == 404)", "if (HttpStatus == 204 || HttpStatus == 404 || HttpStatus == 409)"),
 ("q8_retry_after_zero_ok", CPP, "if (Header.empty() || Header.size() > 6 || Header[0] == '0') { return false; }", "if (Header.empty() || Header.size() > 6) { return false; }"),
 ("q8_rate_limited_no_default_wait", CPP, "RetryNotBefore = NowMs + (Decoder.HasRetryAfter() ? Decoder.RetryAfterMs() : DefaultRetryWaitMs); // Q8", "if (Decoder.HasRetryAfter()) { RetryNotBefore = NowMs + Decoder.RetryAfterMs(); }"),
 ("q8_retry_after_ms_null_ok", CPP, "|| (Retry != nullptr && !JsonToSafeUnsigned(*Retry, RetryMs)))", "|| (Retry != nullptr && !Retry->IsNull() && !JsonToSafeUnsigned(*Retry, RetryMs)))"),
 ("q9_endpoint_unchecked", CPP, "return IsLoopbackRelayOrigin(Origin) ? std::string(Origin) : std::string();", "return std::string(Origin);"),
 ("q9_trailing_slash_kept", CPP, "if (!Origin.empty() && Origin.back() == '/') { Origin.remove_suffix(1); }", ""),
 ("q10_deprecated_label_read", CPP, "const FJsonValue* ModeLabel = Mode.IsString() ? FindString(*LabelMap, Mode.Text) : nullptr;", "const FJsonValue* ModeLabel = FindString(Entry, \"label\") != nullptr ? FindString(Entry, \"label\") : (Mode.IsString() ? FindString(*LabelMap, Mode.Text) : nullptr);"),
 ("q10_missing_mode_label_skipped", CPP, "bEntryOk = Mode.IsString() && IsSnakeKind(Mode.Text) && ModeLabel != nullptr && IsDisplayLabel(ModeLabel->Text);", "if (ModeLabel == nullptr) { continue; }\n\t\t\t\tbEntryOk = Mode.IsString() && IsSnakeKind(Mode.Text) && IsDisplayLabel(ModeLabel->Text);"),
 ("q10_duplicate_mode_ok", CPP, "if (bEntryOk && Seen.first == Mode.Text) { bEntryOk = false; }", "(void)Seen;"),
 ("q10_label_wrong_mode", CPP, "V.ProviderLabel = LabelFor(\"openai\", \"api_key\");", "V.ProviderLabel = LabelFor(\"openai\", \"siwc_plan\");"),
 ("q11_simulated_true_accepted", CPP, "if (Simulated != nullptr && Simulated->bBool) { Fail(EChatProtocolFault::MetaSimulatedTrue); return; } // Q11", ""),
 ("q12_rejection_cleared_by_disconnect", CPP, "ConnState = \"not_connected\"; // Q12", "ConnState = \"not_connected\"; bKeyRejected = false; // Q12"),
 ("q12_rejection_not_cleared_by_put", CPP, "bKeyRejected = false; // Q12: the only place", "// Q12: the only place"),
 ("q13_disconnect_sends_key", CPP, "Out.Url = Url(\"/companions/connections/openai\");\n\t\tNote(\"disconnect_begin\");", "Out.Url = Url(\"/companions/connections/openai\");\n\t\tOut.IdempotencyKey = \"00000000-0000-4000-8000-000000000001\";\n\t\tNote(\"disconnect_begin\");"),
 ("q14_credential_rejected_generic", CPP, "ConnectNotice = LineRejected; // Q14", "ConnectNotice = LineConnFailed; // Q14"),
 ("q14_credential_rejected_drops_connection", CPP, "ConnectNotice = LineRejected; // Q14: not stored", "ConnectNotice = LineRejected; ConnState = \"not_connected\"; // Q14: not stored"),
 ("q14_notice_hidden_when_ready", CPP, "&& (V.State == ECompanionState::Offline || (V.State == ECompanionState::Ready && V.StatusLine.empty())))", "&& V.State == ECompanionState::Offline)"),
 ("q14_notice_kept_after_message", CPP, "ConnectNotice = nullptr; // Q14: a 422 notice lasts", "// Q14: a 422 notice lasts"),
 ("q14_verified_at_unchecked", CPP, "((State->Text == \"connected\" && bVerifiedUtc) || (State->Text == \"connected_unverified\" && bVerifiedNull))", "(State->Text == \"connected\" || State->Text == \"connected_unverified\")"),
 ("q14_connected_at_unchecked", CPP, "&& bConnectedAtOk && ((State", "&& ((State"),
 ("q15_unknown_word_shown", CPP, "if (Kind == \"delivery_failed\") { return LineDeliveryFailed; }\n\t\t\treturn nullptr;", "if (Kind == \"delivery_failed\") { return LineDeliveryFailed; }\n\t\t\treturn LineError;"),
 ("q15_last_error_ignored", CPP, "LastErrorLine = Found == \"error\" ? nullptr : FoundErrorLine;", "LastErrorLine = nullptr; (void)FoundErrorLine;"),
 ("q15_quota_line_wrong", CPP, "if (Kind == \"provider_quota_exhausted\") { return LineOutOfCredit; }", "if (Kind == \"provider_quota_exhausted\") { return LineRetryLater; }"),
 ("q15_delivery_failed_unmapped", CPP, "if (Kind == \"delivery_failed\") { return LineDeliveryFailed; }", ""),
 ("q15_unknown_word_faults", CPP, "if (FoundErrorLine == nullptr) { Note(\"connections_last_error_unknown\"); }", "if (FoundErrorLine == nullptr) { Found = \"error\"; }"),
 ("q15_not_cleared_by_disconnect", CPP, "ConnState = \"not_connected\"; // Q12: bKeyRejected stays: only a successful PUT clears it\n\t\t\tLastErrorLine = nullptr;", "ConnState = \"not_connected\"; // Q12: bKeyRejected stays: only a successful PUT clears it"),
 # ---- idempotency-key minter
 ("mint_fill_failure_ignored", CPP, "std::string Key = bFilled ? WonderlandJuliusMissionLogic::FormatUuidV4FromBytes(Bytes) : std::string();\n\t\tSecureZero(reinterpret_cast<char*>(Bytes), sizeof(Bytes));\n\t\tif (!bFilled || !WonderlandJuliusMissionLogic::IsCanonicalUuidV4(Key))", "std::string Key = WonderlandJuliusMissionLogic::FormatUuidV4FromBytes(Bytes); (void)bFilled;\n\t\tSecureZero(reinterpret_cast<char*>(Bytes), sizeof(Bytes));\n\t\tif (!WonderlandJuliusMissionLogic::IsCanonicalUuidV4(Key))"),
 ("mint_repeat_allowed", CPP, "if (!Issued.insert(Key).second) { return EKeyMint::RandomRepeated; }", "Issued.insert(Key);"),
 ("mint_stale_key_kept", CPP, "OutKey.clear();\n\t\tstd::uint8_t Bytes[16] = {};", "std::uint8_t Bytes[16] = {};"),
 ("mint_version_nibble_broken", CPP, "OutKey = std::move(Key);\n\t\treturn EKeyMint::Minted;", "OutKey = std::move(Key);\n\t\tOutKey[14] = 'f';\n\t\treturn EKeyMint::Minted;"),
 ("mint_variant_nibble_broken", CPP, "OutKey = std::move(Key);\n\t\treturn EKeyMint::Minted;", "OutKey = std::move(Key);\n\t\tOutKey[19] = 'c';\n\t\treturn EKeyMint::Minted;"),
 ("mint_uppercase", CPP, "OutKey = std::move(Key);\n\t\treturn EKeyMint::Minted;", "OutKey = std::move(Key);\n\t\tfor (char& C : OutKey) { if (C >= 'a' && C <= 'f') { C = static_cast<char>(C - 32); } }\n\t\treturn EKeyMint::Minted;"),
 ("mint_double_fill", CPP, "const bool bFilled = Source.Fill(Bytes);", "const bool bFilled = Source.Fill(Bytes) && Source.Fill(Bytes);"),
 ("mint_failure_not_shown", CPP, "SetError(LineNoRandom, \"key_mint_failed\");", "Note(\"key_mint_failed\");"),
 ("v4_version_nibble_dropped", "Source/Wonderland/WonderlandJuliusMissionLogic.cpp", "Laid[6] = static_cast<std::uint8_t>((Laid[6] & 0x0Fu) | 0x40u);", "(void)0;"),
]

def main():
    cxx = os.environ.get("CXX", "g++")
    survived = []
    for name, rel, old, new in M:
        tmp = tempfile.mkdtemp(prefix="sab-")
        try:
            dst = os.path.join(tmp, "wonderland")
            for rel_needed in NEEDED:
                os.makedirs(os.path.dirname(os.path.join(dst, rel_needed)), exist_ok=True)
                shutil.copy2(os.path.join(SRC, rel_needed), os.path.join(dst, rel_needed))
            path = os.path.join(dst, rel)
            text = open(path, encoding="utf-8").read()
            n = text.count(old)
            if n != 1:
                print(f"SABOTAGE TARGET BROKEN {name}: found {n} times"); return 2
            open(path, "w", encoding="utf-8").write(text.replace(old, new))
            d = os.path.join(dst, "Source/Wonderland")
            exe = os.path.join(tmp, "kat")
            b = subprocess.run([cxx, "-std=c++17", "-O0", "-w", "-I", d, os.path.join(dst, "Tools/j1_companion_kat.cpp"),
                                os.path.join(d, "WonderlandCompanionLogic.cpp"), os.path.join(d, "WonderlandJuliusMissionProgress.cpp"),
                                os.path.join(d, "WonderlandJuliusMissionLogic.cpp"), "-o", exe], capture_output=True, text=True)
            if b.returncode != 0:
                print(f"SABOTAGE {name}: does not compile (counts as caught)\n{b.stderr[:400]}")
                continue
            r = subprocess.run([exe], capture_output=True, text=True, timeout=120)
            fails = [l for l in r.stdout.splitlines() if l.startswith("FAIL")]
            if r.returncode == 0:
                survived.append(name); print(f"SABOTAGE SURVIVED {name}")
            else:
                print(f"SABOTAGE CAUGHT {name}: {len(fails)} failing checks, first: {fails[0] if fails else r.stdout[-200:]}")
        finally:
            shutil.rmtree(tmp)
    if survived:
        print(f"SABOTAGE RESULT FAIL survived={len(survived)}: {' '.join(survived)}"); return 1
    print(f"SABOTAGE RESULT PASS caught={len(M)}/{len(M)}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
