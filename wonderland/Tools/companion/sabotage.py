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
 ("wrong_provider_accepted", CPP, "Provider == nullptr || Provider->Text.empty() || Provider->Text != ExpectedProvider) { Fail", "Provider == nullptr) { Fail"),
 ("reply_cap_off_by_one", CPP, "Reply.size() + Text->Text.size() > ChatMaxReplyBytes", "Reply.size() + Text->Text.size() >= ChatMaxReplyBytes"),
 ("simulated_flag_ignored", CPP, "if (Simulated != nullptr && Simulated->Kind != FJsonValue::EKind::Bool) { Fail(EChatProtocolFault::MetaBadSimulated); return; }", ""),
 ("simulated_banner_hidden", CPP, "V.bShowSimulatedBanner = !bReal;", "V.bShowSimulatedBanner = false;"),
 ("display_name_hardcoded", CPP, "V.DisplayName = bReadable ? A.Descriptor.DisplayName : std::string();", "V.DisplayName = bReadable ? std::string(\"Agent One\") : std::string();"),
 ("connect_sends_api_key", CPP, "Body += \"}\";\n\t\tOut.Method = \"POST\";", "Body += \",\\\"apiKey\\\":\\\"sk-x\\\"}\";\n\t\tOut.Method = \"POST\";"),
 ("connect_sends_idempotency_key", CPP, "Out.Body = std::move(Body);\n\t\tbConnecting = true;", "Out.Body = std::move(Body);\n\t\tOut.IdempotencyKey = \"00000000-0000-4000-8000-000000000001\";\n\t\tbConnecting = true;"),
 ("connect_project_dropped", CPP, "Out.Url = Url(AgentsPath) + \"?projectId=\" + Project;", "Out.Url = Url(AgentsPath);"),
 ("answer_credential_accepted", CPP, "if (HasCredentialKey(Root)) { return FaultSlot(std::string(), EAgentSlotFault::NotObject); }", ""),
 ("answer_token_password_accepted", CPP, "{\"apikey\", \"token\", \"password\", \"key\"", "{\"apikey\", \"key\""),
 ("answer_credential_case_sensitive", CPP, "const char X = (A[I] >= 'A' && A[I] <= 'Z') ? static_cast<char>(A[I] + 32) : A[I];", "const char X = A[I];"),
 ("answer_credential_top_level_only", CPP, "\t\t\t\tif (HasCredentialKey(Member.second)) { return true; }\n", ""),
 ("answer_credential_arrays_skipped", CPP, "\t\t\t\tif (HasCredentialKey(Item)) { return true; }\n", ""),
 ("localhost_origin_accepted", CPP, "if (Origin.substr(0, 17) == \"http://127.0.0.1:\")", "if (Origin.substr(0, 17) == \"http://127.0.0.1:\" || Origin.substr(0, 17) == \"http://localhost:\")"),
 ("model_sent_by_client", CPP, "Body += \"}\";\n\t\t\treturn Body;", "Body += \",\\\"model\\\":\\\"x\\\"}\";\n\t\t\treturn Body;"),
 ("idempotency_key_reuse", CPP, "|| !bKeyFresh || Message.empty()", "|| Message.empty()"),
 ("message_cap_8001", CPP, "Units > ChatMaxMessageUtf16Units", "Units > ChatMaxMessageUtf16Units + 1"),
 ("legacy_run_id_sent", CPP, "const bool bRunOk = WljRunId.empty() || WonderlandJuliusMissionLogic::IsClientMintedRunId(WljRunId);\n\t\tif (A == nullptr", "const bool bRunOk = true;\n\t\tif (A == nullptr"),
 ("connect_run_id_unchecked", CPP, "const bool bRunOk = WljRunId.empty() || WonderlandJuliusMissionLogic::IsClientMintedRunId(WljRunId);\n\t\tconst bool bLabelOk", "const bool bRunOk = true;\n\t\tconst bool bLabelOk"),
 ("auth_failed_stays_ready", CPP, "A.bKeyRejected = true; // sticky (Q12), this agent only", "(void)0;"),
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
 ("companion_verified_when_port", CPP, "Out.bShowVerified = false; // route.ts:249", "Out.bShowVerified = bHasProvenance && !ProvenanceView.bSimulated; // route.ts:249"),
 ("mission_verified_true_accepted", CPP, "|| Verified->bBool) { return ECompanionMissionParse::BadVerified; }", ") { return ECompanionMissionParse::BadVerified; }"),
 ("mission_verified_absent_ok", CPP, "if (Verified == nullptr || Verified->Kind != FJsonValue::EKind::Bool", "if (Verified != nullptr && Verified->Kind != FJsonValue::EKind::Bool"),
 ("companion_untrusted_flag_ignored", CPP, "if (Untrusted == nullptr || Untrusted->Kind != FJsonValue::EKind::Bool || !Untrusted->bBool) { return ECompanionMissionParse::BadResult; }", ""),
 ("companion_content_accepted", CPP, "if (Artifact->Find(\"content\") != nullptr) { return ECompanionMissionParse::BadResult; } // never on this route", ""),
 ("companion_result_before_received", CPP, "if ((bHasResult || bHasProvenance) && !bResultAllowed) { return ECompanionMissionParse::ResultTooEarly; }", ""),
 ("companion_summary_cap_off", CPP, "if (S == nullptr || S->Text.size() > CompanionSummaryMaxBytes) { return ECompanionMissionParse::BadResult; }", "if (S == nullptr) { return ECompanionMissionParse::BadResult; }"),
 ("companion_no_result_missing", CPP, "{\"no_result\", ECompanionTaskState::NoResult}, ", ""),
 ("companion_no_result_not_terminal", CPP, "		case ECompanionTaskState::NoResult:\n		case ECompanionTaskState::Cancelled:\n			return true;", "		case ECompanionTaskState::Cancelled:\n			return true;\n		case ECompanionTaskState::NoResult:"),
 ("result_cap_off_by_one", CPP, "if (Body.size() > CompanionResultMaxBytes)", "if (Body.size() >= CompanionResultMaxBytes)"),
 ("result_other_run_accepted", CPP, "|| Wlj->Text != OwnWljRunId)\n		{\n			return EResultParse::RunIdMismatch;", ")\n		{\n			return EResultParse::RunIdMismatch;"),
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
 # ---- BRIDGE chat answers Q1-Q15 (2026-10-24); Q10 and Q15 retired with their routes in v0.2
 ("q1_message_id_opaque_ok", CPP, "bool IsMessageId(std::string_view Text) { return HasPrefixedUuid(Text, \"msg_\"); }", "bool IsMessageId(std::string_view Text) { return !Text.empty(); }"),
 ("q1_replay_message_id_unpinned", CPP, "if (!ExpectedMsg.empty() && Msg->Text != ExpectedMsg)", "if (false && Msg->Text != ExpectedMsg)"),
 ("q1_resend_conv_from_request_only", CPP, "FChatStreamDecoder(A->Descriptor.ProviderId, A->PendingConvSeen.empty() ? A->PendingConvSent : A->PendingConvSeen, true, A->PendingMsgSeen)", "FChatStreamDecoder(A->Descriptor.ProviderId, A->PendingConvSent, true, A->PendingMsgSeen)"),
 ("q1_resend_message_id_dropped", CPP, "FChatStreamDecoder(A->Descriptor.ProviderId, A->PendingConvSeen.empty() ? A->PendingConvSent : A->PendingConvSeen, true, A->PendingMsgSeen)", "FChatStreamDecoder(A->Descriptor.ProviderId, A->PendingConvSeen.empty() ? A->PendingConvSent : A->PendingConvSeen, true, std::string())"),
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
 ("q4_in_progress_no_backoff", CPP, "A->RetryNotBefore = NowMs + ChatInProgressBackoffMs;", "(void)0;"),
 ("q5_max_length_line_dropped", CPP, "TransientLine = Decoder.HitLengthLimit() ? LineLengthLimit : nullptr; // Q5", "TransientLine = nullptr; // Q5"),
 ("q5_max_length_word_wrong", HDR, "bool HitLengthLimit() const { return Finish_ == \"max_length\"; }", "bool HitLengthLimit() const { return Finish_ == \"length\"; }"),
 ("q6_too_large_generic", CPP, "SetError(*A, LineTooLong, \"chat_too_large\");", "SetError(*A, LineError, \"chat_too_large\");"),
 ("q6_body_invalid_untraced", CPP, "SetError(*A, LineError, \"chat_body_invalid\");", "SetError(*A, LineError, \"chat_http_error\");"),
 ("q6_request_cap_shrunk", HDR, "ChatMaxRequestBodyBytes = 64 * 1024;", "ChatMaxRequestBodyBytes = 32 * 1024;"),
 ("q7_delete_409_treated_as_done", CPP, "if (HttpStatus == 204 || HttpStatus == 404)", "if (HttpStatus == 204 || HttpStatus == 404 || HttpStatus == 409)"),
 ("q8_retry_after_zero_ok", CPP, "if (Header.empty() || Header.size() > 6 || Header[0] == '0') { return false; }", "if (Header.empty() || Header.size() > 6) { return false; }"),
 ("q8_rate_limited_no_default_wait", CPP, "A.RetryNotBefore = NowMs + (Decoder.HasRetryAfter() ? Decoder.RetryAfterMs() : DefaultRetryWaitMs); // Q8", "if (Decoder.HasRetryAfter()) { A.RetryNotBefore = NowMs + Decoder.RetryAfterMs(); }"),
 ("q8_retry_after_ms_null_ok", CPP, "|| (Retry != nullptr && !JsonToSafeUnsigned(*Retry, RetryMs)))", "|| (Retry != nullptr && !Retry->IsNull() && !JsonToSafeUnsigned(*Retry, RetryMs)))"),
 ("q9_endpoint_unchecked", CPP, "return IsLoopbackRelayOrigin(Origin) ? std::string(Origin) : std::string();", "return std::string(Origin);"),
 ("q9_trailing_slash_kept", CPP, "if (!Origin.empty() && Origin.back() == '/') { Origin.remove_suffix(1); }", ""),
 ("q11_simulated_true_accepted", CPP, "if (Simulated != nullptr && Simulated->bBool) { Fail(EChatProtocolFault::MetaSimulatedTrue); return; } // Q11", ""),
 ("q12_rejection_cleared_by_disconnect", CPP, "A.Descriptor.Connection = EAgentConnection::Disconnected; // Q12: bKeyRejected stays", "A.Descriptor.Connection = EAgentConnection::Disconnected; A.bKeyRejected = false; // Q12"),
 ("q12_rejection_not_cleared_by_put", CPP, "A->bKeyRejected = false; // Q12: the only place", "// Q12: the only place"),
 ("q13_disconnect_sends_key", CPP, "Out.Url = AgentUrl(*A, std::string_view());\n\t\tNote(\"disconnect_begin\");", "Out.Url = AgentUrl(*A, std::string_view());\n\t\tOut.IdempotencyKey = \"00000000-0000-4000-8000-000000000001\";\n\t\tNote(\"disconnect_begin\");"),
 ("connect_503_not_retry_later", CPP, "Notice = HttpStatus == 503 ? LineRetryLater : LineConnFailed;", "Notice = LineConnFailed;"),
 ("q14_refused_connect_drops_connection", CPP, "Notice = HttpStatus == 503 ? LineRetryLater : LineConnFailed;", "Notice = HttpStatus == 503 ? LineRetryLater : LineConnFailed; for (const std::unique_ptr<FAgent>& O : Agents) { O->Descriptor.Connection = EAgentConnection::Disconnected; Recompute(*O); }"),
 ("q14_notice_kept_after_message", CPP, "Notice = nullptr; // Q14: a 422 notice lasts", "// Q14: a 422 notice lasts"),
 # ---- v0.2 BYOAI agents (provider-agnostic registry)
 ("auth_failed_rejects_every_agent", CPP, "A.bKeyRejected = true; // sticky (Q12), this agent only", "for (const std::unique_ptr<FAgent>& O : Agents) { O->bKeyRejected = true; Recompute(*O); }"),
 ("wrong_provider_empty_expectation_matches", CPP, "Provider == nullptr || Provider->Text.empty() || Provider", "Provider == nullptr || Provider"),
 ("agent_id_any_prefix", CPP, "bool IsAgentId(std::string_view Text) { return HasPrefixedUuid(Text, \"agt_\"); }", "bool IsAgentId(std::string_view Text) { return Text.size() > 4 && WonderlandJuliusMissionLogic::IsCanonicalUuidV4(Text.substr(4)); }"),
 ("agent_id_unchecked", CPP, "bool IsAgentId(std::string_view Text) { return HasPrefixedUuid(Text, \"agt_\"); }", "bool IsAgentId(std::string_view Text) { return !Text.empty(); }"),
 ("capability_slash_allowed", CPP, "return bAllowDotColon && (C == '.' || C == ':');", "return bAllowDotColon && (C == '.' || C == ':' || C == '/');"),
 ("provider_id_cap_plus_one", CPP, "IsNonBlankText(Text, ProviderIdMaxUtf16Units)", "IsNonBlankText(Text, ProviderIdMaxUtf16Units + 1)"),
 ("display_name_cap_plus_one", CPP, "IsNonBlankText(Text, DisplayNameMaxUtf16Units)", "IsNonBlankText(Text, DisplayNameMaxUtf16Units + 1)"),
 ("blank_text_accepted", CPP, "if (!IsJsTrimSpace(Cp)) { return true; }\n\t\t\t\tPos += Len;\n\t\t\t}\n\t\t\treturn false;", "if (!IsJsTrimSpace(Cp)) { return true; }\n\t\t\t\tPos += Len;\n\t\t\t}\n\t\t\treturn true;"),
 ("trim_set_misses_feff", CPP, "|| Cp == 0xFEFF;", ";"),
 ("trim_set_misses_ideographic_space", CPP, "Cp == 0x205F || Cp == 0x3000", "Cp == 0x205F"),
 ("trim_set_trims_nel", CPP, "return Cp == 0x09 ||", "return Cp == 0x85 || Cp == 0x09 ||"),
 ("capability_cap_plus_one", CPP, "IsToken(Text, CapabilityMaxBytes, true)", "IsToken(Text, CapabilityMaxBytes + 1, true)"),
 ("display_name_unchecked", CPP, "(Name->IsString() && IsAgentDisplayName(Name->Text))", "Name->IsString()"),
 ("display_name_absent_ok", CPP, "if (Name == nullptr || !(Name->IsNull()", "if (Name != nullptr && !(Name->IsNull()"),
 ("kind_defaults_single", CPP, "else { return FaultSlot(AgentId, EAgentSlotFault::BadKind); }", "else { Kind = EAgentKind::Single; }"),
 ("kind_compound_ignored", CPP, "KindValue->Text == \"compound\") { Kind = EAgentKind::Compound; }", "KindValue->Text == \"compound\") { Kind = EAgentKind::Single; }"),
 ("kind_null_reads_single", CPP, "if (KindValue != nullptr && KindValue->IsNull()) { Kind = EAgentKind::Unknown; }", "if (KindValue != nullptr && KindValue->IsNull()) { Kind = EAgentKind::Single; }"),
 ("adapter_version_cap_plus_one", CPP, "IsPrintableAscii(Version->Text, 1, AdapterVersionMaxBytes)", "IsPrintableAscii(Version->Text, 1, AdapterVersionMaxBytes + 1)"),
 ("capability_dup_allowed", CPP, "|| HasCapability(Out, Item.Text)) { Out.clear(); return false; }", ") { Out.clear(); return false; }"),
 ("capability_list_cap_off", CPP, "List->Items.size() > CapabilityListMaxCount", "List->Items.size() > CapabilityListMaxCount + 1"),
 ("authorized_not_subset_ok", CPP, "if (!HasCapability(Declared, Cap)) { return FaultSlot(AgentId, EAgentSlotFault::AuthorizedNotDeclared); } // A6", "(void)Cap; // A6"),
 ("authorized_read_from_declared", CPP, "ReadCapabilities(Entry.Find(\"authorizedCapabilities\"), Authorized)", "ReadCapabilities(Entry.Find(\"declaredCapabilities\"), Authorized)"),
 ("connection_unknown_word_ok", CPP, "if (ConnWord == nullptr || !ConnectionFromWord(ConnWord->Text, Connection)) { return FaultSlot(AgentId, EAgentSlotFault::BadConnection); }", "if (ConnWord == nullptr) { return FaultSlot(AgentId, EAgentSlotFault::BadConnection); } (void)ConnectionFromWord(ConnWord->Text, Connection);"),
 ("connection_unsupported_read_as_error", CPP, "if (W == \"unsupported\") { Out = EAgentConnection::Unsupported; return true; }", "if (W == \"unsupported\") { Out = EAgentConnection::Error; return true; }"),
 ("verified_key_ignored", CPP, "if (Entry.Find(\"verified\") != nullptr) { return FaultSlot(AgentId, EAgentSlotFault::BadVerified); }", ""),
 ("verified_false_allowed", CPP, "if (Entry.Find(\"verified\") != nullptr) { return FaultSlot(AgentId, EAgentSlotFault::BadVerified); }", "{ const FJsonValue* V = Entry.Find(\"verified\"); if (V != nullptr && !(V->Kind == FJsonValue::EKind::Bool && !V->bBool)) { return FaultSlot(AgentId, EAgentSlotFault::BadVerified); } }"),
 ("inv_connected_name_optional", CPP, "(Connection == EAgentConnection::Connected && (!bHasName || Kind == EAgentKind::Unknown))", "(Connection == EAgentConnection::Connected && Kind == EAgentKind::Unknown)"),
 ("inv_connected_kind_optional", CPP, "(Connection == EAgentConnection::Connected && (!bHasName || Kind == EAgentKind::Unknown))", "(Connection == EAgentConnection::Connected && !bHasName)"),
 ("inv_hidden_kind_allowed", CPP, "(bHidden && (Kind != EAgentKind::Unknown || !Declared.empty()", "(bHidden && (!Declared.empty()"),
 ("inv_hidden_caps_allowed", CPP, "Kind != EAgentKind::Unknown || !Declared.empty() || !Authorized.empty()", "Kind != EAgentKind::Unknown"),
 ("inv_unsupported_version_allowed", CPP, "\n\t\t\t|| (Connection == EAgentConnection::Unsupported && !Version->IsNull()))", ")"),
 ("inv_error_treated_as_shown", CPP, "const bool bHidden = Connection == EAgentConnection::Unsupported || Connection == EAgentConnection::Error;", "const bool bHidden = Connection == EAgentConnection::Unsupported;"),
 ("agents_list_cap_off", CPP, "const std::size_t Count = std::min(List->Items.size(), AgentListMaxEntries);", "const std::size_t Count = List->Items.size();"),
 ("agents_too_many_dropped", CPP, "if (List->Items.size() > AgentListMaxEntries) { Out.push_back(FaultSlot(std::string(), EAgentSlotFault::TooMany)); }", ""),
 ("agents_dup_first_wins", CPP, "if (J != I && Out[J].Descriptor.AgentId == Id) { bDup = true; }", "if (J < I && Out[J].Descriptor.AgentId == Id) { bDup = true; }"),
 ("agents_dup_ignored", CPP, "if (bDup) { Out[I] = FaultSlot(Id, EAgentSlotFault::DuplicateAgentId); }", "(void)bDup;"),
 ("agents_not_array_read_as_empty", CPP, "if (List->Kind != FJsonValue::EKind::Array) { return EAgentListParse::NotArray; }", "if (List->Kind != FJsonValue::EKind::Array) { return EAgentListParse::Ok; }"),
 ("agents_one_bad_poisons_list", CPP, "for (std::size_t I = 0; I < Count; ++I) { Out.push_back(ParseAgentDescriptor(List->Items[I])); }", "for (std::size_t I = 0; I < Count; ++I) { Out.push_back(ParseAgentDescriptor(List->Items[I])); if (Out.back().Fault != EAgentSlotFault::None) { Out.clear(); return EAgentListParse::NotArray; } }"),
 ("mission_agents_not_parsed", CPP, "Out.AgentsParse = ParseAgentList(Root, Out.Agents);", "Out.AgentsParse = EAgentListParse::Absent;"),
 ("faulted_slot_read_as_good", CPP, "A.Fault = Slot.Fault;", "A.Fault = EAgentSlotFault::None;"),
 ("registry_cap_off", CPP, "if (Agents.size() >= AgentRegistryMaxSlots) { return nullptr; }", ""),
 ("unreadable_slot_not_counted", CPP, "++UnreadableSlots;\n\t\t\t\tNote(std::string(\"agent_slot_unreadable_\")", "Note(std::string(\"agent_slot_unreadable_\")"),
 ("unreadable_count_not_reset", CPP, "UnreadableSlots = 0;\n\t\tfor (const FAgentSlot& Slot : Slots)", "for (const FAgentSlot& Slot : Slots)"),
 ("agent_url_names_provider", CPP, "Out += A.Descriptor.AgentId;\n\t\tOut += Suffix;", "Out += A.Descriptor.ProviderId;\n\t\tOut += Suffix;"),
 ("decoder_expects_first_agents_provider", CPP, "A->Decoder = FChatStreamDecoder(A->Descriptor.ProviderId, A->PendingConvSent, false);", "A->Decoder = FChatStreamDecoder(Agents.front()->Descriptor.ProviderId, A->PendingConvSent, false);"),
 ("keys_not_recorded_on_send", CPP, "UsedKeys.emplace_back(IdempotencyKey);\n\t\tA->PendingMessage.assign(Message);", "A->PendingMessage.assign(Message);"),
 ("last_connected_not_set", CPP, "LastConnected = A->Descriptor.AgentId;", ""),
 ("connect_provider_substituted", CPP, "if (Slot.Descriptor.ProviderId != Requested)", "if (false)"),
 ("connect_unsupported_as_failure", CPP, "Notice = LineUnsupported; // an unknown provider", "Notice = LineConnFailed; // an unknown provider"),
 ("connect_unsupported_trace_wrong", CPP, "Note(\"connect_unsupported\");", "Note(\"connect_answer_refused\");"),
 ("unsupported_read_as_not_connected", CPP, "else if (A.Descriptor.Connection == EAgentConnection::Unsupported) { Offline(EOfflineReason::Unsupported, LineUnsupported, false); }", ""),
 ("unsupported_offers_connect", CPP, "Offline(EOfflineReason::Unsupported, LineUnsupported, false);", "Offline(EOfflineReason::Unsupported, LineUnsupported, true);"),
 ("not_connected_disconnects_every_agent", CPP, "A->Descriptor.Connection = EAgentConnection::Disconnected; // this agent only", "for (const std::unique_ptr<FAgent>& O : Agents) { O->Descriptor.Connection = EAgentConnection::Disconnected; Recompute(*O); }"),
 ("disconnect_drops_every_agent", CPP, "A.Descriptor.Connection = EAgentConnection::Disconnected; // Q12: bKeyRejected stays", "for (const std::unique_ptr<FAgent>& O : Agents) { O->Descriptor.Connection = EAgentConnection::Disconnected; Recompute(*O); }"),
 ("identity_change_overwrites", CPP, "if (!A.Descriptor.ProviderId.empty() && Slot.Descriptor.ProviderId != A.Descriptor.ProviderId)", "if (false)"),
 ("identity_change_reconnectable", CPP, "Errored(LineIdentityChanged, false);", "Errored(LineIdentityChanged, true);"),
 ("banner_shown_if_any_agent_unreal", CPP, "if (IsReal(*A)) { S.bShowSimulatedBanner = false; }", "if (!IsReal(*A)) { S.bShowSimulatedBanner = true; break; } S.bShowSimulatedBanner = false;"),
 ("chat_inferred_from_declared", CPP, "HasCapability(A.Descriptor.AuthorizedCapabilities, CapabilityChat)", "HasCapability(A.Descriptor.DeclaredCapabilities, CapabilityChat)"),
 ("chat_assumed_when_connected", CPP, "return IsReal(A) && HasCapability(A.Descriptor.AuthorizedCapabilities, CapabilityChat);", "return IsReal(A);"),
 ("declared_capabilities_shown", CPP, "V.AuthorizedCapabilities = bReal ? A.Descriptor.AuthorizedCapabilities : std::vector<std::string>();", "V.AuthorizedCapabilities = bReal ? A.Descriptor.DeclaredCapabilities : std::vector<std::string>();"),
 ("capabilities_shown_when_not_real", CPP, "V.AuthorizedCapabilities = bReal ? A.Descriptor.AuthorizedCapabilities : std::vector<std::string>();", "V.AuthorizedCapabilities = A.Descriptor.AuthorizedCapabilities;"),
 ("capability_prefix_match", CPP, "return std::find(List.begin(), List.end(), Capability) != List.end();", "return std::find_if(List.begin(), List.end(), [&](const std::string& S) { return S.compare(0, Capability.size(), Capability) == 0; }) != List.end();"),
 ("capability_case_folded", CPP, "return std::find(List.begin(), List.end(), Capability) != List.end();", "return std::find_if(List.begin(), List.end(), [&](const std::string& S) { if (S.size() != Capability.size()) { return false; } for (std::size_t I = 0; I < S.size(); ++I) { if ((S[I] | 0x20) != (Capability[I] | 0x20)) { return false; } } return true; }) != List.end();"),
 ("verified_claim_shown", CPP, "V.bVerified = false; // no descriptor", "V.bVerified = bReal; // no descriptor"),
 ("verification_switch_flipped", HDR, "inline constexpr bool bAgentVerificationAvailable = false;", "inline constexpr bool bAgentVerificationAvailable = true;"),
 ("provenance_any_source", CPP, "if (Source == nullptr || (Source->Text != \"simulated\" && Source->Text != \"companion_port\")) { return EProvenanceParse::BadSource; }", "if (Source == nullptr) { return EProvenanceParse::BadSource; }"),
 ("mission_provenance_any_source", CPP, "if (Source == nullptr || (Source->Text != \"companion_port\" && Source->Text != \"simulated\")) { return false; }", "if (Source == nullptr) { return false; }"),
 # ---- idempotency-key minter
 ("mint_fill_failure_ignored", CPP, "std::string Key = bFilled ? WonderlandJuliusMissionLogic::FormatUuidV4FromBytes(Bytes) : std::string();\n\t\tSecureZero(reinterpret_cast<char*>(Bytes), sizeof(Bytes));\n\t\tif (!bFilled || !WonderlandJuliusMissionLogic::IsCanonicalUuidV4(Key))", "std::string Key = WonderlandJuliusMissionLogic::FormatUuidV4FromBytes(Bytes); (void)bFilled;\n\t\tSecureZero(reinterpret_cast<char*>(Bytes), sizeof(Bytes));\n\t\tif (!WonderlandJuliusMissionLogic::IsCanonicalUuidV4(Key))"),
 ("mint_repeat_allowed", CPP, "if (!Issued.insert(Key).second) { return EKeyMint::RandomRepeated; }", "Issued.insert(Key);"),
 ("mint_stale_key_kept", CPP, "OutKey.clear();\n\t\tstd::uint8_t Bytes[16] = {};", "std::uint8_t Bytes[16] = {};"),
 ("mint_version_nibble_broken", CPP, "OutKey = std::move(Key);\n\t\treturn EKeyMint::Minted;", "OutKey = std::move(Key);\n\t\tOutKey[14] = 'f';\n\t\treturn EKeyMint::Minted;"),
 ("mint_variant_nibble_broken", CPP, "OutKey = std::move(Key);\n\t\treturn EKeyMint::Minted;", "OutKey = std::move(Key);\n\t\tOutKey[19] = 'c';\n\t\treturn EKeyMint::Minted;"),
 ("mint_uppercase", CPP, "OutKey = std::move(Key);\n\t\treturn EKeyMint::Minted;", "OutKey = std::move(Key);\n\t\tfor (char& C : OutKey) { if (C >= 'a' && C <= 'f') { C = static_cast<char>(C - 32); } }\n\t\treturn EKeyMint::Minted;"),
 ("mint_double_fill", CPP, "const bool bFilled = Source.Fill(Bytes);", "const bool bFilled = Source.Fill(Bytes) && Source.Fill(Bytes);"),
 ("mint_failure_not_shown", CPP, "Notice = LineNoRandom; // nothing was sent", "// nothing was sent"),
 ("v4_version_nibble_dropped", "Source/Wonderland/WonderlandJuliusMissionLogic.cpp", "Laid[6] = static_cast<std::uint8_t>((Laid[6] & 0x0Fu) | 0x40u);", "(void)0;"),
 # ---- BRIDGE 7e5e1e30 routes: connect / read / delete / project / chat gate / mission provenance
 ("connect_200_accepted", CPP, "if (HttpStatus == 201) // route.ts:319", "if (HttpStatus == 201 || HttpStatus == 200) // route.ts:319"),
 ("project_gate_off", CPP, "bProjectOk(IsQuerySafeProjectId(Project))", "bProjectOk(true)"),
 ("project_id_dropped_from_agent_urls", CPP, "Out += \"?projectId=\"; // the dispatch guard", "Out += \"?\"; // the dispatch guard"),
 ("chat_route_assumed_served", CPP, "return bChatServed && bProjectOk && IsChatAuthorized(A);", "return IsChatAuthorized(A);"),
 ("chat_not_served_offers_connect", CPP, "Offline(EOfflineReason::ChatNotServed, LineChatNotServed, false);", "Offline(EOfflineReason::ChatNotServed, LineChatNotServed, true);"),
 ("read_404_ignored", CPP, "ForceDisconnected(*A);\n\t\t\tNote(\"agent_read_not_found\");", "Note(\"agent_read_not_found\");"),
 ("read_any_status_applied", CPP, "if (HttpStatus == 200) { ApplySlot(*A, ForAgent(", "if (HttpStatus != 404) { ApplySlot(*A, ForAgent("),
 ("for_agent_mismatch_accepted", CPP, "if (Slot.Descriptor.AgentId == AgentId) { return Slot; }", "if (true) { return Slot; }"),
 ("delete_204_accepted", CPP, "if (HttpStatus == 200) // route.ts:347", "if (HttpStatus == 200 || HttpStatus == 204) // route.ts:347"),
 ("delete_404_ignored", CPP, "ForceDisconnected(*A);\n\t\t\tNote(\"disconnect_not_found\");", "Note(\"disconnect_not_found\");"),
 ("delete_200_odd_answer_keeps_connection", CPP, "&& ApplySlot(*A, Slot);\n\t\t\t// The DELETE happened either way: the agent is disconnected; an odd answer is only noted.\n\t\t\tForceDisconnected(*A);", "&& ApplySlot(*A, Slot);\n\t\t\tif (!bGood) { ApplySlot(*A, Slot); }\n\t\t\telse { ForceDisconnected(*A); }"),
 ("mission_verified_by_allowed", CPP, "if (P.Find(\"verified\") != nullptr || P.Find(\"verifiedBy\") != nullptr) { return false; }", "if (P.Find(\"verified\") != nullptr) { return false; }"),
 ("mission_provenance_verified_allowed", CPP, "if (P.Find(\"verified\") != nullptr || P.Find(\"verifiedBy\") != nullptr) { return false; }", "if (P.Find(\"verifiedBy\") != nullptr) { return false; }"),
 ("mission_sha_mismatch_allowed", CPP, "if (bHasProvenance && (!bHasResult || ProvenanceView.ResultSha256 != Sha))", "if (bHasProvenance && !bHasResult)"),
 ("mission_provenance_unchecked_against_result", CPP, "if (bHasProvenance && (!bHasResult || ProvenanceView.ResultSha256 != Sha))", "if (false)"),
 ("mission_wake_id_optional", CPP, "if (Wake == nullptr || !(Wake->IsNull()", "if (Wake != nullptr && !(Wake->IsNull()"),
 ("mission_wake_id_cap_plus_one", CPP, "Wake->Text.size() <= ProvenanceWakeIdMaxBytes)", "Wake->Text.size() <= ProvenanceWakeIdMaxBytes + 1)"),
 ("mission_wake_id_not_sanitized", CPP, "Out.WakeId = Wake->IsNull() ? std::string() : SanitizeUntrustedText(Wake->Text);", "Out.WakeId = Wake->IsNull() ? std::string() : Wake->Text;"),
 ("mission_body_digest_any_string", CPP, "(Digest->IsString() && WonderlandJuliusMissionLogic::IsLowerHex64(Digest->Text))", "Digest->IsString()"),
 ("mission_simulated_source_read_as_port", CPP, "Out.bSimulated = Source->Text == \"simulated\";\n\t\t\tOut.ResultSha256 = Content->Text;", "Out.bSimulated = false;\n\t\t\tOut.ResultSha256 = Content->Text;"),
]

def run_one(cxx, name, rel, old, new):
    """Returns (name, verdict, detail); verdict is caught, survived, broken or nocompile."""
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
            return name, "broken", f"found {n} times"
        open(path, "w", encoding="utf-8").write(text.replace(old, new))
        d = os.path.join(dst, "Source/Wonderland")
        exe = os.path.join(tmp, "kat")
        b = subprocess.run([cxx, "-std=c++17", "-O0", "-w", "-I", d, os.path.join(dst, "Tools/j1_companion_kat.cpp"),
                            os.path.join(d, "WonderlandCompanionLogic.cpp"), os.path.join(d, "WonderlandJuliusMissionProgress.cpp"),
                            os.path.join(d, "WonderlandJuliusMissionLogic.cpp"), "-o", exe], capture_output=True, text=True)
        if b.returncode != 0:
            return name, "nocompile", b.stderr[:400]
        r = subprocess.run([exe], capture_output=True, text=True, timeout=180)
        fails = [l for l in r.stdout.splitlines() if l.startswith("FAIL")]
        if r.returncode == 0:
            return name, "survived", ""
        return name, "caught", f"{len(fails)} failing checks, first: {fails[0] if fails else r.stdout[-200:]}"
    finally:
        shutil.rmtree(tmp)

def main():
    from concurrent.futures import ThreadPoolExecutor
    cxx = os.environ.get("CXX", "g++")
    jobs = int(os.environ.get("SABOTAGE_JOBS", "4"))
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        results = list(pool.map(lambda m: run_one(cxx, *m), M))
    survived, broken = [], []
    for name, verdict, detail in results:  # printed in list order, whatever finished first
        if verdict == "broken":
            broken.append(name); print(f"SABOTAGE TARGET BROKEN {name}: {detail}")
        elif verdict == "nocompile":
            # A mutation that does not compile proves nothing about the KAT: treated as a broken target.
            broken.append(name); print(f"SABOTAGE TARGET DOES NOT COMPILE {name}\n{detail}")
        elif verdict == "survived":
            survived.append(name); print(f"SABOTAGE SURVIVED {name}")
        else:
            print(f"SABOTAGE CAUGHT {name}: {detail}")
    if broken:
        print(f"SABOTAGE RESULT BROKEN targets={len(broken)}: {' '.join(broken)}"); return 2
    if survived:
        print(f"SABOTAGE RESULT FAIL survived={len(survived)}: {' '.join(survived)}"); return 1
    print(f"SABOTAGE RESULT PASS caught={len(M)}/{len(M)}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
