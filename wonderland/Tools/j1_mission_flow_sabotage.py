#!/usr/bin/env python3
"""Each mutation flips one mission-flow rule. The KAT must then fail.

A mutation that does not compile is a failure, not a catch. The KAT never saw it.
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
FLOW = "wonderland/Source/Wonderland/WonderlandJuliusMissionFlow.cpp"
NEEDED = [
    "wonderland/Tools/j1_mission_flow_kat.cpp",
    FLOW,
    "wonderland/Source/Wonderland/WonderlandJuliusMissionProgress.cpp",
    "wonderland/Source/Wonderland/WonderlandJuliusMissionProgress.h",
    "wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.cpp",
    "wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.h",
    "wonderland/Source/Wonderland/WonderlandJuliusMissionFlow.h",
]

MUTATIONS = [
    (
        "unknown_shown_finished",
        "Out.bFinished = false; // FLOW_UNKNOWN_NOT_FINISHED",
        "Out.bFinished = true; // FLOW_UNKNOWN_NOT_FINISHED",
    ),
    (
        "expired_shown_succeeded",
        "ProgressDisplayLabel(EMissionProgress::NotStarted); // FLOW_EXPIRED_SHOWS_NOT_STARTED",
        "ProgressDisplayLabel(EMissionProgress::Succeeded); // FLOW_EXPIRED_SHOWS_NOT_STARTED",
    ),
    (
        "status_completed_shown_finished",
        "Out.bFinished = false; // FLOW_STATUS_COMPLETED_NOT_FINISHED",
        "Out.bFinished = true; // FLOW_STATUS_COMPLETED_NOT_FINISHED",
    ),
    (
        "route_unknown_shown_finished",
        "Out.bFinished = false; // FLOW_ROUTE_UNKNOWN_NOT_FINISHED",
        "Out.bFinished = true; // FLOW_ROUTE_UNKNOWN_NOT_FINISHED",
    ),
    (
        "route_unknown_read_finished",
        "Out.bFinished = false; // FLOW_ROUTE_UNKNOWN_READ_NOT_FINISHED",
        "Out.bFinished = true; // FLOW_ROUTE_UNKNOWN_READ_NOT_FINISHED",
    ),
    (
        "route_unknown_shown_verified",
        "bVerified = false; // FLOW_ROUTE_UNKNOWN_NOT_VERIFIED",
        "bVerified = true; // FLOW_ROUTE_UNKNOWN_NOT_VERIFIED",
    ),
    (
        "route_expired_shown_succeeded",
        "ProgressDisplayLabel(EMissionProgress::NotStarted); // FLOW_ROUTE_EXPIRED_SHOWS_NOT_STARTED",
        "ProgressDisplayLabel(EMissionProgress::Succeeded); // FLOW_ROUTE_EXPIRED_SHOWS_NOT_STARTED",
    ),
    (
        "route_expired_shown_finished",
        "Out.bFinished = false; // FLOW_ROUTE_EXPIRED_NOT_FINISHED",
        "Out.bFinished = true; // FLOW_ROUTE_EXPIRED_NOT_FINISHED",
    ),
    (
        "expired_shown_verified",
        "bVerified = false; // FLOW_EXPIRED_NOT_VERIFIED",
        "bVerified = true; // FLOW_EXPIRED_NOT_VERIFIED",
    ),
    (
        "expired_read_shown_finished",
        "Out.bFinished = false; // FLOW_EXPIRED_READ_NOT_FINISHED",
        "Out.bFinished = true; // FLOW_EXPIRED_READ_NOT_FINISHED",
    ),
    (
        "null_completion_shown_verified",
        "bVerified = false; // FLOW_NULL_COMPLETION_NOT_VERIFIED",
        "bVerified = true; // FLOW_NULL_COMPLETION_NOT_VERIFIED",
    ),
    (
        "dispatched_state_counts_as_completed",
        'if (!IsExactString(State, "completed")) { return false; } // FLOW_STATE_COMPLETED_REQUIRED',
        'if (!IsExactString(State, "dispatched")) { return false; } // FLOW_STATE_COMPLETED_REQUIRED',
    ),
    (
        "executing_counts_as_completed",
        'if (!IsExactString(FinalState, "COMPLETED")) { return false; } // FLOW_JULIUS_FINAL_STATE_REQUIRED',
        'if (!IsExactString(FinalState, "EXECUTING")) { return false; } // FLOW_JULIUS_FINAL_STATE_REQUIRED',
    ),
    (
        "missing_spend_tag_counts",
        "if (Tag == nullptr || Tag->Kind != EJsonKind::Object) { return false; } // FLOW_SPEND_TAG_REQUIRED",
        "if (Tag == nullptr || Tag->Kind != EJsonKind::Object) { return true; } // FLOW_SPEND_TAG_REQUIRED",
    ),
    (
        "wrong_spend_schema_counts",
        'if (!IsExactString(Schema, "julius-run-spent.v1")) { return false; } // FLOW_SPEND_SCHEMA_REQUIRED',
        'if (!IsExactString(Schema, "julius-run-spent.v1")) { return true; } // FLOW_SPEND_SCHEMA_REQUIRED',
    ),
    (
        "wrong_spend_run_counts",
        "if (!Run.bKnown || !SameText(Run.Text, WljRunId)) { return false; } // FLOW_SPEND_RUN_REQUIRED",
        "if (!Run.bKnown || !SameText(Run.Text, WljRunId)) { return true; } // FLOW_SPEND_RUN_REQUIRED",
    ),
    (
        "infer_coder_cost_from_reservation",
        'Out.CoderCostUsdMicros = ReadInt(Coder, "costUsdMicros"); // FLOW_COST_AS_REPORTED',
        'Out.CoderCostUsdMicros = ReadInt(Coder, "costUsdMicros"); if (!Out.CoderCostUsdMicros.bKnown) { Out.CoderCostUsdMicros = Out.ReservedUsdMicros; } // FLOW_COST_AS_REPORTED',
    ),
    (
        "infer_digest_from_file",
        "constexpr bool bInferDigestFromFile = false;",
        "constexpr bool bInferDigestFromFile = true;",
    ),
    (
        "unverified_artifact_shown",
        "const bool bArtifactAllowed = Read.bVerified; // FLOW_ARTIFACT_ONLY_IF_VERIFIED",
        "const bool bArtifactAllowed = true; // FLOW_ARTIFACT_ONLY_IF_VERIFIED",
    ),
    (
        "dropped_trace_id",
        'Out.Lines.push_back(std::string("traceId: ") + Read.TraceId.Text); // FLOW_TRACE_ID_AS_REPORTED',
        "(void)Read.TraceId.Text; // FLOW_TRACE_ID_AS_REPORTED",
    ),
    (
        "null_cost_shown_as_zero",
        'Lines.push_back(std::string(Name) + ": Unknown"); // FLOW_NULL_COST_IS_UNKNOWN',
        'Lines.push_back(std::string(Name) + ": 0"); // FLOW_NULL_COST_IS_UNKNOWN',
    ),
    (
        "message_id_shown_as_receipt",
        "Out.bEchoProviderMessageId = false; // FLOW_MESSAGE_ID_IS_NOT_A_RECEIPT",
        "Out.bEchoProviderMessageId = true; // FLOW_MESSAGE_ID_IS_NOT_A_RECEIPT",
    ),
    (
        "non_200_shown_as_result",
        "if (ResultStatus != 200) { return FResultRead{}; } // FLOW_NON_200_IS_NO_READ",
        "if (ResultStatus != 200 && ResultStatus != 404) { return FResultRead{}; } // FLOW_NON_200_IS_NO_READ",
    ),
    (
        "bare_completed_bool_counts",
        "constexpr bool bAcceptBareCompleted = false; // FLOW_BARE_COMPLETED_IS_NOT_EVIDENCE",
        "constexpr bool bAcceptBareCompleted = true; // FLOW_BARE_COMPLETED_IS_NOT_EVIDENCE",
    ),
    (
        "phases_count_as_completion",
        "constexpr bool bAcceptPhasesAsCompletion = false; // FLOW_PHASES_ARE_NOT_COMPLETION",
        "constexpr bool bAcceptPhasesAsCompletion = true; // FLOW_PHASES_ARE_NOT_COMPLETION",
    ),
    (
        "progress_state_completed_counts",
        "constexpr bool bAcceptProgressStateCompleted = false; // FLOW_PROGRESS_STATE_IS_NOT_EVIDENCE",
        "constexpr bool bAcceptProgressStateCompleted = true; // FLOW_PROGRESS_STATE_IS_NOT_EVIDENCE",
    ),
    (
        "error_body_shown_as_result",
        'if (Field(Root, "error") != nullptr) { return FResultRead{}; } // FLOW_ERROR_BODY_IS_NOT_A_RESULT',
        "if (false) { return FResultRead{}; } // FLOW_ERROR_BODY_IS_NOT_A_RESULT",
    ),
    (
        "wlj_mismatch_shown",
        "if (!BodyRun.bKnown || !SameText(BodyRun.Text, WljRunId)) { return FResultRead{}; } // FLOW_WLJ_MISMATCH_NO_READ",
        "if (false) { return FResultRead{}; } // FLOW_WLJ_MISMATCH_NO_READ",
    ),
    (
        "traceparent_computed",
        "constexpr bool bSynthesizeTraceparent = false; // FLOW_TRACEPARENT_NOT_COMPUTED",
        "constexpr bool bSynthesizeTraceparent = true; // FLOW_TRACEPARENT_NOT_COMPUTED",
    ),
    (
        "unverified_completed_shown_finished",
        "Out.Progress.bFinished = false; // FLOW_UNVERIFIED_COMPLETED_STAYS_DISPATCHED",
        "Out.Progress.bFinished = true; // FLOW_UNVERIFIED_COMPLETED_STAYS_DISPATCHED",
    ),
    (
        "unplugged_dispatched_shown_finished",
        "Out.Progress.bFinished = false; // FLOW_UNPLUGGED_NOT_FINISHED",
        "Out.Progress.bFinished = true; // FLOW_UNPLUGGED_NOT_FINISHED",
    ),
    (
        "split_state_shown_verified",
        "if (bProgressParsed && ProgressState != Out.State) { bVerified = false; } // FLOW_SPLIT_STATE_NOT_VERIFIED",
        "if (false) { bVerified = false; } // FLOW_SPLIT_STATE_NOT_VERIFIED",
    ),
    (
        "phases_shown_unverified",
        "if (!Read.bVerified) { return; } // FLOW_PHASES_ONLY_IF_VERIFIED",
        "// FLOW_PHASES_ONLY_IF_VERIFIED",
    ),
    (
        "safe_integer_unchecked",
        "if (Node->Int > MaxSafeInteger) { return false; } // FLOW_SAFE_INTEGER_ONLY",
        "// FLOW_SAFE_INTEGER_ONLY",
    ),
    (
        "revision_null_reads_zero",
        "{ Out.bNull = true; return Out; } // FLOW_REVISION_NULL_NOT_ZERO",
        "{ Out.bKnown = true; Out.Value = 0; return Out; } // FLOW_REVISION_NULL_NOT_ZERO",
    ),
    (
        "revision_zero_dropped",
        "if (SafeCount(Node, Out.Value)) { Out.bKnown = true; return Out; } // FLOW_REVISION_ZERO_KEPT",
        "if (SafeCount(Node, Out.Value) && Out.Value != 0) { Out.bKnown = true; return Out; } // FLOW_REVISION_ZERO_KEPT",
    ),
    (
        "revision_malformed_reads_zero",
        "bMalformed = true; // FLOW_REVISION_MALFORMED_IS_UNKNOWN",
        "bMalformed = true; Out.bKnown = true; Out.Value = 0; // FLOW_REVISION_MALFORMED_IS_UNKNOWN",
    ),
    (
        "revision_not_parsed",
        "Out.ProjectBrainRevision = ReadRevision(&Root, Out.bRevisionMalformed);",
        "Out.bRevisionMalformed = false;",
    ),
    (
        "phases_not_parsed",
        "Out.Phases = ReadPhases(&Root, Out.PhaseSlots);",
        "Out.Phases = EPhaseList::Absent;",
    ),
    (
        "phase_state_open",
        'return S == "NEVER_DISPATCHED" || S == "ACTIVE" || S == "IDLE" || S == "FAILED"; // FLOW_PHASE_STATE_CLOSED',
        "return !S.empty(); // FLOW_PHASE_STATE_CLOSED",
    ),
    (
        "phase_stage_open",
        'return S == "plan" || S == "build" || S == "repair:plan" || S == "repair:build"; // FLOW_PHASE_STAGE_CLOSED',
        "return !S.empty(); // FLOW_PHASE_STAGE_CLOSED",
    ),
    (
        "phase_role_order_ignored",
        'if (!IsExactString(Field(Node, "role"), Role)) { return false; } // FLOW_PHASES_ROLE_ORDER',
        'if (Field(Node, "role") == nullptr) { return false; } // FLOW_PHASES_ROLE_ORDER',
    ),
    (
        "phase_stage_key_optional",
        "if (Stage == nullptr) { return false; } // FLOW_PHASE_STAGE_KEY_REQUIRED",
        "static const FJson Missing; if (Stage == nullptr) { Stage = &Missing; } // FLOW_PHASE_STAGE_KEY_REQUIRED",
    ),
    (
        "phase_attempt_key_optional",
        "if (Attempt == nullptr) { return false; } // FLOW_PHASE_ATTEMPT_KEY_REQUIRED",
        "static const FJson Missing; if (Attempt == nullptr) { Attempt = &Missing; } // FLOW_PHASE_ATTEMPT_KEY_REQUIRED",
    ),
    (
        "phase_attempt_unchecked",
        "else { return false; } // FLOW_PHASE_ATTEMPT_SAFE",
        "else { Out.Attempt.bKnown = true; } // FLOW_PHASE_ATTEMPT_SAFE",
    ),
    (
        "phase_span_id_kept",
        "if (Span == nullptr || Span->Kind != EJsonKind::Null) { return false; } // FLOW_PHASE_SPAN_ID_NULL",
        "if (Span == nullptr) { return false; } // FLOW_PHASE_SPAN_ID_NULL",
    ),
    (
        "phase_span_id_optional",
        "if (Span == nullptr || Span->Kind != EJsonKind::Null) { return false; } // FLOW_PHASE_SPAN_ID_NULL",
        "if (Span != nullptr && Span->Kind != EJsonKind::Null) { return false; } // FLOW_PHASE_SPAN_ID_NULL",
    ),
    (
        "phase_traceparent_kept",
        "if (Parent == nullptr || Parent->Kind != EJsonKind::Null) { return false; } // FLOW_PHASE_TRACEPARENT_NULL",
        "if (Parent == nullptr) { return false; } // FLOW_PHASE_TRACEPARENT_NULL",
    ),
    (
        "phase_cost_optional",
        'if (!SafeCount(Field(Node, "knownUsdMicros"), Out.KnownUsdMicros)) { return false; } // FLOW_PHASE_COST_REQUIRED',
        '(void)SafeCount(Field(Node, "knownUsdMicros"), Out.KnownUsdMicros); // FLOW_PHASE_COST_REQUIRED',
    ),
    (
        "phase_cost_complete_any",
        "if (Complete == nullptr || Complete->Kind != EJsonKind::Bool) { return false; } // FLOW_PHASE_COST_COMPLETE_BOOL",
        "if (Complete == nullptr) { return false; } // FLOW_PHASE_COST_COMPLETE_BOOL",
    ),
    (
        "phases_any_length",
        "Node->Array.size() != 3) { return EPhaseList::Malformed; } // FLOW_PHASES_EXACTLY_THREE",
        "Node->Array.size() < 3) { return EPhaseList::Malformed; } // FLOW_PHASES_EXACTLY_THREE",
    ),
    (
        "phases_empty_is_projection",
        "if (Node->Kind != EJsonKind::Array || Node->Array.size() != 3) { return EPhaseList::Malformed; } // FLOW_PHASES_EXACTLY_THREE",
        "if (Node->Kind == EJsonKind::Array && Node->Array.empty()) { return EPhaseList::Projection; } if (Node->Kind != EJsonKind::Array || Node->Array.size() != 3) { return EPhaseList::Malformed; } // FLOW_PHASES_EXACTLY_THREE",
    ),
    (
        "one_bad_slot_keeps_list",
        "if (!ReadPhaseSlot(Node->Array[I], PhaseRoles[I], Slots[I])) { return EPhaseList::Malformed; } // FLOW_ONE_BAD_SLOT_NULLS_LIST",
        "(void)ReadPhaseSlot(Node->Array[I], PhaseRoles[I], Slots[I]); // FLOW_ONE_BAD_SLOT_NULLS_LIST",
    ),
    (
        "null_phases_invented",
        'Lines.push_back("phases: Unknown"); // FLOW_NULL_PHASES_NOT_INVENTED',
        'for (const char* Role : PhaseRoles) { Lines.push_back(std::string("phase ") + Role + ": NEVER_DISPATCHED, stage Unknown, attempt Unknown, knownUsdMicros 0, costComplete true"); } // FLOW_NULL_PHASES_NOT_INVENTED',
    ),
    (
        "zero_phase_cost_shown_unknown",
        "std::to_string(Slot.KnownUsdMicros) // FLOW_ZERO_COST_IS_ZERO",
        '(Slot.KnownUsdMicros == 0 ? std::string("Unknown") : std::to_string(Slot.KnownUsdMicros)) // FLOW_ZERO_COST_IS_ZERO',
    ),
    (
        "completion_phases_split_ignored",
        "Out.bPhasesSplit = true; // FLOW_COMPLETION_PHASES_AGREE",
        "(void)0; // FLOW_COMPLETION_PHASES_AGREE",
    ),
    (
        "progress_phases_split_ignored",
        "Out.bPhasesSplit = true; // FLOW_PROGRESS_PHASES_AGREE",
        "(void)0; // FLOW_PROGRESS_PHASES_AGREE",
    ),
    (
        "completion_revision_split_ignored",
        "Out.bRevisionSplit = true; // FLOW_COMPLETION_REVISION_AGREES",
        "(void)0; // FLOW_COMPLETION_REVISION_AGREES",
    ),
    (
        "progress_revision_split_ignored",
        "Out.bRevisionSplit = true; // FLOW_PROGRESS_REVISION_AGREES",
        "(void)0; // FLOW_PROGRESS_REVISION_AGREES",
    ),
    (
        "split_phases_kept",
        "Out.Phases = EPhaseList::Malformed; // FLOW_SPLIT_PHASES_ARE_UNKNOWN",
        "(void)0; // FLOW_SPLIT_PHASES_ARE_UNKNOWN",
    ),
    (
        "split_revision_kept",
        "Out.ProjectBrainRevision = FReportedInt64{}; // FLOW_SPLIT_REVISION_IS_UNKNOWN",
        "(void)0; // FLOW_SPLIT_REVISION_IS_UNKNOWN",
    ),
    (
        "null_spend_accounting_shown_zero",
        'Out.Lines.push_back("spendAccounting: Unknown"); // FLOW_NULL_SPEND_ACCOUNTING_IS_UNKNOWN',
        'Out.Lines.push_back("spendAccounting.knownUsdMicros: 0"); // FLOW_NULL_SPEND_ACCOUNTING_IS_UNKNOWN',
    ),
    (
        "null_spend_accounting_not_flagged",
        "Out.bSpendAccountingNull = Accounting != nullptr && Accounting->Kind == EJsonKind::Null; // #454 reader :623",
        "Out.bSpendAccountingNull = false; // #454 reader :623",
    ),
    (
        "null_spend_accounting_settles",
        "constexpr bool bAcceptNullAccountingAsSettled = false; // FLOW_NULL_SPEND_ACCOUNTING_NOT_COMPLETION",
        "constexpr bool bAcceptNullAccountingAsSettled = true; // FLOW_NULL_SPEND_ACCOUNTING_NOT_COMPLETION",
    ),
    (
        "resume_after_handoff",
        "if (bDispatchHanded || MissionId.empty()) { return false; } // FLOW_RESUME_ONLY_BEFORE_A_HANDOFF",
        "if (MissionId.empty()) { return false; } // FLOW_RESUME_ONLY_BEFORE_A_HANDOFF",
    ),
    (
        "resume_unoffered_mission",
        "if (!bOffered) { return false; } // FLOW_RESUME_ONLY_AN_OFFER",
        "(void)bOffered; // FLOW_RESUME_ONLY_AN_OFFER",
    ),
    (
        "checker_open_set",
        'Out.Checker = Verdict.Text == "PASS" ? ECheckerVerdict::Pass',
        'Out.Checker = Verdict.Text != "FAIL" ? ECheckerVerdict::Pass',
    ),
    (
        "checker_fail_shown_verified",
        "Out.bVerified = false; // FLOW_CHECKER_FAIL_NOT_VERIFIED",
        "Out.bVerified = Read.bVerified; // FLOW_CHECKER_FAIL_NOT_VERIFIED",
    ),
    (
        "completed_without_pass",
        "Out.Line = Read.Checker == ECheckerVerdict::Pass && !Read.bCheckerUnbound ? CopyStateCompletedChecked : CopyStateCompleted; // FLOW_COMPLETED_ONLY_ON_PASS",
        "Out.Line = CopyStateCompletedChecked; // FLOW_COMPLETED_ONLY_ON_PASS",
    ),
    (
        "pass_unbound_accepted",
        "Out.bCheckerUnbound = true; // FLOW_PASS_MUST_NAME_JUDGED_SHA",
        "Out.bCheckerUnbound = false; // FLOW_PASS_MUST_NAME_JUDGED_SHA",
    ),
    (
        "digest_prefix_unchecked",
        "Out.bCheckerUnbound = true; // FLOW_PASS_DIGEST_MATCHES_JUDGED",
        "Out.bCheckerUnbound = Out.bCheckerUnbound; // FLOW_PASS_DIGEST_MATCHES_JUDGED",
    ),
    (
        "checker_hex_unchecked",
        "if (!((Ch >= '0' && Ch <= '9') || (Ch >= 'a' && Ch <= 'f'))) { return Out; } // FLOW_CHECKER_HEX_ONLY",
        "// FLOW_CHECKER_HEX_ONLY",
    ),
    (
        "start_again_from_any_step",
        "if (Step != EFlowStep::Watching) { return false; } // FLOW_START_AGAIN_ONLY_FROM_WATCHING",
        "// FLOW_START_AGAIN_ONLY_FROM_WATCHING",
    ),
    (
        'live_plain_text_unchecked',
        'if (Ch < 0x20 || Ch > 0x7E) { return false; } // FLOW_LIVE_PLAIN_TEXT_ONLY',
        '// FLOW_LIVE_PLAIN_TEXT_ONLY',
    ),
    (
        'live_other_runs_events',
        'if (!Run.bKnown || !SameText(Run.Text, WljRunId)) { return Out; } // FLOW_LIVE_OWN_RUN_ONLY',
        '// FLOW_LIVE_OWN_RUN_ONLY',
    ),
    (
        'live_from_unbound_source',
        'if (Read.bLive && Read.Source != ELiveSource::GithubActions) { return Out; } // FLOW_LIVE_ONLY_FROM_A_BOUND_RUN',
        '// FLOW_LIVE_ONLY_FROM_A_BOUND_RUN',
    ),
    (
        'live_finished_run_live',
        'if (Read.bLive && Read.Run == ELiveRunStatus::Completed) { return Out; } // a finished run is never live',
        '// a finished run is never live',
    ),
    (
        'live_without_workflow_run',
        'if (Read.Source != ELiveSource::None && Read.WorkflowRunId.empty()) { return Out; } // FLOW_LIVE_NEEDS_A_REAL_RUN',
        '// FLOW_LIVE_NEEDS_A_REAL_RUN',
    ),
    (
        'live_roles_open',
        'if (!LiveWord(Field(Node, "role"), Event.Role) || !LiveRole(Event.Role)) { return false; } // FLOW_LIVE_ROLES_ARE_CLOSED',
        'if (!LiveWord(Field(Node, "role"), Event.Role)) { return false; } // FLOW_LIVE_ROLES_ARE_CLOSED',
    ),
    (
        'live_task_types_open',
        'Event.TaskType) || !LiveTaskType(Event.TaskType)) { return false; }',
        'Event.TaskType)) { return false; }',
    ),
    (
        'live_task_states_open',
        'Event.State) || !LiveTaskState(Event.State)) { return false; }',
        'Event.State)) { return false; }',
    ),
    (
        'live_repair_cycle_unbounded',
        'Event.RepairCycle)) { return false; } // FLOW_LIVE_REPAIR_CYCLE_BOUND',
        'Event.RepairCycle) && false) { return false; } // FLOW_LIVE_REPAIR_CYCLE_BOUND',
    ),
    (
        'live_phases_not_samples',
        'if (!LiveBool(Field(Node, "sampled"), bSampled) || !bSampled) { return false; } // FLOW_LIVE_PHASES_ARE_SAMPLES',
        '// FLOW_LIVE_PHASES_ARE_SAMPLES',
    ),
    (
        'live_resume_duplicates',
        'if (Event.Seq <= LastSeq) { continue; } // FLOW_LIVE_RESUME_WITHOUT_DUPLICATES',
        '// FLOW_LIVE_RESUME_WITHOUT_DUPLICATES',
    ),
    (
        'live_runs_merged',
        '*this = FLiveFeed(); // a different workflow run is never merged into this one',
        '// a different workflow run is never merged into this one',
    ),
    (
        'live_recorded_called_live',
        'Out.Header = "RECORDED RUN, NOT LIVE" + RunRef; // FLOW_RECORDED_IS_NEVER_LIVE',
        'Out.Header = "LIVE" + RunRef; // FLOW_RECORDED_IS_NEVER_LIVE',
    ),
    (
        'live_stale_hidden',
        'Out.Header += " -- connection to GitHub lost, reconnecting";',
        'Out.Header += "";',
    ),
    (
        "live_markers_open",
        'if (!IsExactString(Marker, "idle") && !IsExactString(Marker, "ended")) { return false; } // FLOW_LIVE_MARKERS_ARE_CLOSED',
        "// FLOW_LIVE_MARKERS_ARE_CLOSED",
    ),
    (
        "live_reset_appends",
        "*this = FLiveFeed(); // FLOW_LIVE_RESET_CLEARS_LATCHES",
        "// reset keeps the old events (FLOW_LIVE_RESET_CLEARS_LATCHES)",
    ),
    (
        "live_now_running_hidden",
        'else if (E.Status == "in_progress") { Running.push_back(&E); }',
        "else if (false) { Running.push_back(&E); }",
    ),
    (
        "live_page_uses_shared_json_caps",
        "ParseJson(Json, Root, LiveMaxEventsPerPage, LiveJsonNodeLimit)",
        "ParseJson(Json, Root)",
    ),
    (
        "start_without_click",
        "if (!bExplicitClick) { Out.Why = \"waiting for the founder\"; return Out; } // FLOW_START_ONLY_ON_CLICK",
        "// FLOW_START_ONLY_ON_CLICK",
    ),
    (
        "start_after_dispatch",
        "if (bHasWorkflowRun) { Out.Why = \"this run already has a GitHub Actions run\"; return Out; } // FLOW_START_NEVER_AFTER_DISPATCH",
        "// FLOW_START_NEVER_AFTER_DISPATCH",
    ),
    (
        "start_recorded_twice",
        "Out.Why = \"this run was already started or refused\";\n\t\t\treturn Out; // FLOW_START_RECORDED_ONCE",
        "Out.Why = \"this run was already started or refused\"; // FLOW_START_RECORDED_ONCE",
    ),
    (
        "start_while_not_awaiting",
        "if (WrapperToken != \"admitted_waiting\") { Out.Why = \"the run is not waiting for the operator\"; return Out; } // FLOW_START_ONLY_WHILE_AWAITING",
        "// FLOW_START_ONLY_WHILE_AWAITING",
    ),
    (
        "start_confirm_loose",
        "return Typed == StartConfirmPhrase; // FLOW_START_CONFIRM_EXACT",
        "return !Typed.empty(); // FLOW_START_CONFIRM_EXACT",
    ),
    (
        "start_other_runs_answer",
        "if (!Run.bKnown || !SameText(Run.Text, WljRunId)) { return Out; } // FLOW_START_OWN_RUN_ONLY",
        "// FLOW_START_OWN_RUN_ONLY",
    ),
    (
        "exec_gates_count_as_execution",
        "Out.Phase = Feed.AttemptRecorded() ? EExecutionPhase::Committing : EExecutionPhase::Starting; // FLOW_EXEC_GATES_ARE_NOT_EXECUTION",
        "Out.Phase = EExecutionPhase::Executing; // FLOW_EXEC_GATES_ARE_NOT_EXECUTION",
    ),
    (
        "exec_gate_failure_called_julius_failure",
        "Out.Phase = EExecutionPhase::DidNotStart; // FLOW_EXEC_NO_LIVE_STEP_IS_DID_NOT_START",
        "Out.Phase = EExecutionPhase::Failed; // FLOW_EXEC_NO_LIVE_STEP_IS_DID_NOT_START",
    ),
    (
        "exec_success_without_verified_completion",
        "if (Verdict == ECheckerVerdict::Pass && bHasCompletion) { Out.Phase = EExecutionPhase::Completed; Out.CauseSource = \"result\"; Out.CauseSeq = -1; return Out; } // FLOW_EXEC_SUCCESS_ONLY_FROM_RESULT",
        "if (Verdict == ECheckerVerdict::Pass || Feed.RunConclusion() == \"success\") { Out.Phase = EExecutionPhase::Completed; Out.CauseSource = \"result\"; Out.CauseSeq = -1; return Out; } // FLOW_EXEC_SUCCESS_ONLY_FROM_RESULT",
    ),
    (
        "exec_binds_any_run",
        "if (!bSource || Feed.Mode() != ELiveMode::Paid || !bBoundRun) { return Out; } // FLOW_EXEC_BIND_PAID_BOUND_RUN_ONLY",
        "// FLOW_EXEC_BIND_PAID_BOUND_RUN_ONLY",
    ),
    (
        "contract_moves_on_stale",
        "if (View.bStale || View.Phase == EExecutionPhase::None || bEnded) { return Out; } // FLOW_CONTRACT_STALE_MOVES_NOTHING",
        "if (View.Phase == EExecutionPhase::None || bEnded) { return Out; } // FLOW_CONTRACT_STALE_MOVES_NOTHING",
    ),
    # Retargeted by client lane C5 (Skywalker 2026-10-30): failure now plays run.failed; outcome-unknown releases.
    (
        "contract_unknown_does_not_clear",
        "bReleased = true; // FLOW_CONTRACT_UNKNOWN_PLAYS_NO_ENDING",
        "bReleased = false; // FLOW_CONTRACT_UNKNOWN_PLAYS_NO_ENDING",
    ),
    (
        "contract_presents_before_execution",
        "return Out; // FLOW_CONTRACT_NOTHING_BEFORE_EXECUTION",
        "break; // FLOW_CONTRACT_NOTHING_BEFORE_EXECUTION",
    ),
    (
        "contract_uncertainty_ignored",
        "return bStale || !bHasSession || (bEverRead && MsSinceLastGoodRead > LiveNoReadAfterMs); // FLOW_CONTRACT_UNCERTAIN_SUSPENDS",
        "return false; // FLOW_CONTRACT_UNCERTAIN_SUSPENDS",
    ),
    (
        "exec_live_failure_not_interrupting",
        'bLiveStepInterrupted = Event.Conclusion == "failure" || Event.Conclusion == "cancelled" || Event.Conclusion == "timed_out"; // FLOW_EXEC_LIVE_FAILURE_INTERRUPTS',
        "bLiveStepInterrupted = false; // FLOW_EXEC_LIVE_FAILURE_INTERRUPTS",
    ),
    (
        "exec_ended_without_live_success_not_failed",
        "Out.Phase = EExecutionPhase::Failed; // FLOW_EXEC_ENDED_WITHOUT_LIVE_SUCCESS",
        "Out.Phase = EExecutionPhase::Grading; // FLOW_EXEC_ENDED_WITHOUT_LIVE_SUCCESS",
    ),
    (
        "exec_no_verdict_yet_is_failure",
        "Out.Phase = Read.bNoVerdictIsFinal ? EExecutionPhase::FailedUnverified : EExecutionPhase::Grading; // FLOW_EXEC_NO_VERDICT_YET_IS_GRADING",
        "Out.Phase = EExecutionPhase::FailedUnverified; // FLOW_EXEC_NO_VERDICT_YET_IS_GRADING",
    ),
    (
        "exec_no_verdict_never_final",
        "Out.Phase = Read.bNoVerdictIsFinal ? EExecutionPhase::FailedUnverified : EExecutionPhase::Grading; // FLOW_EXEC_NO_VERDICT_YET_IS_GRADING",
        "Out.Phase = EExecutionPhase::Grading; // FLOW_EXEC_NO_VERDICT_YET_IS_GRADING",
    ),
    (
        "exec_outcome_unknown_ignored",
        "Out.Phase = EExecutionPhase::OutcomeUnknown; // FLOW_EXEC_OUTCOME_UNKNOWN_INTERRUPTS",
        "Out.Phase = EExecutionPhase::Grading; // FLOW_EXEC_OUTCOME_UNKNOWN_INTERRUPTS",
    ),
    (
        "result_outcome_unknown_not_read",
        "Out.bOutcomeUnknown = true; // FLOW_OUTCOME_UNKNOWN_ANY_OBJECT",
        "Out.bOutcomeUnknown = false; // FLOW_OUTCOME_UNKNOWN_ANY_OBJECT",
    ),
    (
        "contract_repair_required_never_shown",
        'Out.push_back(FContractBeat{"review.repair_required", View.Role, Round}); // FLOW_CONTRACT_REPAIR_REQUIRED_ON_ROUND_START',
        'Out.push_back(FContractBeat{"repair.started", View.Role, Round}); // FLOW_CONTRACT_REPAIR_REQUIRED_ON_ROUND_START',
    ),
    (
        "contract_reconnect_shows_late_repair_required",
        "const bool bRoundOpensHere = bRepair && !bInRepairRound && bSawTask;",
        "const bool bRoundOpensHere = bRepair && !bInRepairRound;",
    ),
    (
        "contract_verifying_on_unreported_cycle",
        'View.TaskType == "repair_audit" || View.RepairCycle > 0)) // FLOW_CONTRACT_VERIFYING_NEEDS_A_REPORTED_CYCLE',
        'View.TaskType == "repair_audit" || View.RepairCycle != 0)) // FLOW_CONTRACT_VERIFYING_NEEDS_A_REPORTED_CYCLE',
    ),
    (
        "task_restored_row_performs",
        "return !bBoundToJuliusRun || bJuliusConfirmedThisSession; // FLOW_TASK_RESTORED_ROW_IS_INERT",
        "return true; // FLOW_TASK_RESTORED_ROW_IS_INERT",
    ),
    (
        "task_unmapped_report_confirms",
        "return bRowConfirmedThisSession; // FLOW_TASK_UNMAPPED_REPORT_NEVER_CONFIRMS",
        "return true; // FLOW_TASK_UNMAPPED_REPORT_NEVER_CONFIRMS",
    ),
    (
        "result_reads_stop_at_the_interrupt",
        "return bStoppedAfterExecution && !bOutcomeUnknownSeen && (!bRunCompletedSeen || MsSinceRunCompleted < GraceMs); // FLOW_RESULT_READ_AFTER_STOP",
        "return false; // FLOW_RESULT_READ_AFTER_STOP",
    ),
    (
        "result_reads_ignore_the_grace",
        "return bStoppedAfterExecution && !bOutcomeUnknownSeen && (!bRunCompletedSeen || MsSinceRunCompleted < GraceMs); // FLOW_RESULT_READ_AFTER_STOP",
        "return bStoppedAfterExecution && !bOutcomeUnknownSeen; // FLOW_RESULT_READ_AFTER_STOP",
    ),
    (
        "admission_ends_while_run_going",
        "return bRunCompletedSeen && bTerminalNonSuccess && !bAwaitingVerdict; // FLOW_ADMISSION_ENDS_WITH_WORKFLOW",
        "return bTerminalNonSuccess && !bAwaitingVerdict; // FLOW_ADMISSION_ENDS_WITH_WORKFLOW",
    ),
    (
        "admission_ends_while_awaiting",
        "return bRunCompletedSeen && bTerminalNonSuccess && !bAwaitingVerdict; // FLOW_ADMISSION_ENDS_WITH_WORKFLOW",
        "return bRunCompletedSeen && bTerminalNonSuccess; // FLOW_ADMISSION_ENDS_WITH_WORKFLOW",
    ),
    (
        "task_new_run_keeps_old_state",
        "return !bRowHadRun || RowRunId != NewRunId; // FLOW_TASK_NEW_RUN_STARTS_QUEUED",
        "return !bRowHadRun; // FLOW_TASK_NEW_RUN_STARTS_QUEUED",
    ),
    (
        "contract_research_shown_as_architect",
        'else if (View.TaskType == "research") { Out.push_back(FContractBeat{"research.requested", View.Role, Round}); } // FLOW_CONTRACT_RESEARCH_ONLY_WHEN_REPORTED',
        'else if (View.TaskType == "research") { Out.push_back(FContractBeat{"architect.started", View.Role, Round}); } // FLOW_CONTRACT_RESEARCH_ONLY_WHEN_REPORTED',
    ),
    (
        "contract_guidance_shown_as_repair",
        'else if (View.TaskType == "repair_guidance") { Out.push_back(FContractBeat{"architect.guidance", View.Role, Round}); } // FLOW_CONTRACT_GUIDANCE_ONLY_WHEN_REPORTED',
        'else if (View.TaskType == "repair_guidance") { Out.push_back(FContractBeat{"repair.started", View.Role, Round}); } // FLOW_CONTRACT_GUIDANCE_ONLY_WHEN_REPORTED',
    ),
    (
        "contract_verifying_shown_as_review",
        'Out.push_back(FContractBeat{"repair.completed", View.Role, Round}); // FLOW_CONTRACT_VERIFYING_IS_REVIEWER_ON_REPAIR',
        'Out.push_back(FContractBeat{"review.started", View.Role, Round}); // FLOW_CONTRACT_VERIFYING_IS_REVIEWER_ON_REPAIR',
    ),
    # CLIENT LANE C1 (A-9 ack, outcome-unknown, no auto-retry).
    (
        "c1_ack_treated_as_dispatched",
        "Out.Outcome = EStartOutcome::Acknowledged; // FLOW_START_ACK_IS_NOT_DISPATCH",
        "Out.Outcome = EStartOutcome::Accepted; // FLOW_START_ACK_IS_NOT_DISPATCH",
    ),
    (
        "c1_ack_record_is_started",
        "case EStartOutcome::Acknowledged: return EStartRecord::Accepted; // FLOW_START_ACK_RECORD_IS_NOT_STARTED",
        "case EStartOutcome::Acknowledged: return EStartRecord::Started; // FLOW_START_ACK_RECORD_IS_NOT_STARTED",
    ),
    (
        "c1_dispatching_binds_as_started",
        "Out.Outcome = EStartOutcome::Uncertain; // FLOW_START_DISPATCHING_IS_UNCERTAIN",
        "Out.Outcome = EStartOutcome::Accepted; // FLOW_START_DISPATCHING_IS_UNCERTAIN",
    ),
    (
        "c1_key_reused_is_a_refusal",
        "if (HttpStatus == 409 && Kind == \"julius_start_key_reused\") { Out.Outcome = EStartOutcome::Uncertain; return Out; } // FLOW_START_KEY_REUSED_IS_UNCERTAIN",
        "// FLOW_START_KEY_REUSED_IS_UNCERTAIN",
    ),
    (
        "c1_in_progress_is_a_refusal",
        "if (HttpStatus == 409 && Kind == \"julius_start_in_progress\") { Out.Outcome = EStartOutcome::InProgress; return Out; } // FLOW_START_IN_PROGRESS_POLLS_STATUS",
        "// FLOW_START_IN_PROGRESS_POLLS_STATUS",
    ),
    (
        "c1_lost_answer_reoffers_start",
        "return HttpStatus == 401 || HttpStatus == 503 ? EStartRecord::NotStarted : EStartRecord::Sending; // FLOW_START_LOST_ANSWER_BLOCKS",
        "return EStartRecord::NotStarted; // FLOW_START_LOST_ANSWER_BLOCKS",
    ),
    (
        "c1_uncertain_reoffers_start",
        "default: return EStartRecord::Sending; // FLOW_START_UNCERTAIN_BLOCKS",
        "default: return EStartRecord::NotStarted; // FLOW_START_UNCERTAIN_BLOCKS",
    ),
    (
        "c1_unreconciled_start_offered",
        "Out.Why = \"the last Start is not reconciled yet; waiting for the bridge's /status\";\n\t\t\treturn Out; // FLOW_START_UNRECONCILED_BLOCKS",
        "Out.Why = \"the last Start is not reconciled yet; waiting for the bridge's /status\"; // FLOW_START_UNRECONCILED_BLOCKS",
    ),
    (
        "c1_accepted_start_offered",
        "Out.Why = \"the bridge accepted the Start request; waiting for /status to report the dispatch\";\n\t\t\treturn Out; // FLOW_START_ACCEPTED_NOT_REOFFERED",
        "Out.Why = \"the bridge accepted the Start request; waiting for /status to report the dispatch\"; // FLOW_START_ACCEPTED_NOT_REOFFERED",
    ),
    # CLIENT LANE C2 (A-9 /status, founder ruling: outcome-unknown keeps Start blocked).
    (
        'c2_status_schema_unchecked',
        "if (!IsExactString(Field(Root, \"schema\"), MissionStatusSchema)) { return StatusRefused(Out, \"schema\"); } // FLOW_STATUS_SCHEMA_EXACT",
        "// FLOW_STATUS_SCHEMA_EXACT",
    ),
    (
        'c2_status_any_run',
        "if (!Run.bKnown || !SameText(Run.Text, WljRunId)) { return StatusRefused(Out, \"other_run\"); } // FLOW_STATUS_OWN_RUN_ONLY",
        "// FLOW_STATUS_OWN_RUN_ONLY",
    ),
    (
        'c2_status_phase_open_set',
        "if (!bPhaseKnown) { return StatusRefused(Out, \"phase\"); } // FLOW_STATUS_PHASE_CLOSED_SET",
        "// FLOW_STATUS_PHASE_CLOSED_SET",
    ),
    (
        'c2_status_terminal_unchecked',
        "if (Out.bTerminal != StatusPhaseTerminal(Out.Phase)) { return StatusRefused(Out, \"terminal_mismatch\"); } // FLOW_STATUS_TERMINAL_MATCHES_PHASE",
        "// FLOW_STATUS_TERMINAL_MATCHES_PHASE",
    ),
    (
        'c2_status_unreadable_outcome_is_known',
        "if (!LiveBool(Field(*Result, \"outcomeUnknown\"), Out.bOutcomeUnknown)) { bResultOk = false; Out.bOutcomeUnknown = true; } // FLOW_STATUS_UNREADABLE_OUTCOME_IS_UNKNOWN",
        "if (!LiveBool(Field(*Result, \"outcomeUnknown\"), Out.bOutcomeUnknown)) { bResultOk = false; Out.bOutcomeUnknown = false; } // FLOW_STATUS_UNREADABLE_OUTCOME_IS_UNKNOWN",
    ),
    (
        'c2_status_bad_field_drops_page',
        "Out.Skipped.push_back(\"progress\"); // FLOW_STATUS_BAD_FIELD_KEEPS_PAGE",
        "return StatusRefused(Out, \"progress\"); // FLOW_STATUS_BAD_FIELD_KEEPS_PAGE",
    ),
    (
        'c2_reconcile_claim_without_record_offered',
        "|| (Current == R::None && Status.bRequested) // FLOW_RECONCILE_CLAIM_WITHOUT_RECORD",
        "// FLOW_RECONCILE_CLAIM_WITHOUT_RECORD",
    ),
    (
        'c2_reconcile_dispatch_not_started',
        "Out.Record = R::Started; // FLOW_RECONCILE_DISPATCH_IS_STARTED",
        "Out.Record = Waiting; // FLOW_RECONCILE_DISPATCH_IS_STARTED",
    ),
    (
        'c2_outcome_unknown_releases_start',
        "Out.Record = Waiting; // FLOW_RECONCILE_UNKNOWN_STAYS_BLOCKED",
        "Out.Record = R::NotStarted; // FLOW_RECONCILE_UNKNOWN_STAYS_BLOCKED",
    ),
    (
        'c2_interrupted_reoffers_start',
        "Out.Record = R::Refused; // FLOW_RECONCILE_INTERRUPTED_IS_REFUSED",
        "Out.Record = R::NotStarted; // FLOW_RECONCILE_INTERRUPTED_IS_REFUSED",
    ),
    (
        'c2_terminal_without_dispatch_reoffers',
        "Out.Record = R::Refused; // FLOW_RECONCILE_TERMINAL_WITHOUT_DISPATCH_IS_REFUSED",
        "Out.Record = R::NotStarted; // FLOW_RECONCILE_TERMINAL_WITHOUT_DISPATCH_IS_REFUSED",
    ),
    (
        'c2_live_request_releases_start',
        "Out.Record = R::Accepted; // FLOW_RECONCILE_LIVE_REQUEST_BLOCKS",
        "Out.Record = R::NotStarted; // FLOW_RECONCILE_LIVE_REQUEST_BLOCKS",
    ),
    (
        'c2_claim_releases_start',
        "Out.Record = Waiting; // FLOW_RECONCILE_CLAIM_BLOCKS",
        "Out.Record = R::NotStarted; // FLOW_RECONCILE_CLAIM_BLOCKS",
    ),
    (
        'c2_nothing_held_never_releases',
        "Out.Record = R::NotStarted; // FLOW_RECONCILE_NOTHING_HELD_RELEASES",
        "Out.Record = Waiting; // FLOW_RECONCILE_NOTHING_HELD_RELEASES",
    ),
    # YUJI M-b 2026-10-30 (bridge restart: only start.request reveals a saved intent).
    (
        "mb_request_without_record_ignored",
        "|| (Current == R::None && !Status.RequestState.empty()) // FLOW_RECONCILE_REQUEST_WITHOUT_RECORD",
        "// FLOW_RECONCILE_REQUEST_WITHOUT_RECORD",
    ),
    (
        "mb_retry_start_safe_releases",
        "else if (Status.RequestState == \"accepted\" || Status.RequestState == \"claiming\")",
        "else if (Status.bRequested && (Status.RequestState == \"accepted\" || Status.RequestState == \"claiming\"))",
    ),
    (
        "mb_interrupted_not_shown",
        "Out.Lines.push_back(\"Start request interrupted -- nothing was dispatched; it is never re-sent automatically\"); // FLOW_STATUS_PANEL_INTERRUPTED_IS_EXPLICIT",
        "// FLOW_STATUS_PANEL_INTERRUPTED_IS_EXPLICIT",
    ),
    # CLIENT LANE C4 (founder rulings + YUJI: percent only verified, workflow steps labelled, completed is not success).
    (
        "c4_success_any_verdict",
        "&& Status.CheckerVerdict == \"PASS\" // FLOW_SUCCESS_NEEDS_PASS",
        "// FLOW_SUCCESS_NEEDS_PASS",
    ),
    (
        "c4_success_without_verified_completion",
        "&& Status.ProgressBasis == \"verified_completion\" && Status.ProgressPercent == 100 // FLOW_SUCCESS_NEEDS_VERIFIED_COMPLETION",
        "// FLOW_SUCCESS_NEEDS_VERIFIED_COMPLETION",
    ),
    (
        "c4_success_before_completed",
        "return Status.bOk && Status.Phase == EMissionStatusPhase::Completed // FLOW_SUCCESS_NEEDS_COMPLETED",
        "return Status.bOk // FLOW_SUCCESS_NEEDS_COMPLETED",
    ),
    (
        "c4_completed_worded_as_success",
        "Out.Header = \"Mission run finished -- not a success (checker verdict: \" + Verdict + \")\"; // FLOW_STATUS_PANEL_COMPLETED_IS_NOT_SUCCESS",
        "Out.Header = \"Mission completed\"; // FLOW_STATUS_PANEL_COMPLETED_IS_NOT_SUCCESS",
    ),
    (
        "c4_unknown_unlabelled",
        "Out.Header = \"Outcome unknown -- needs reconciliation (operator)\"; // FLOW_STATUS_PANEL_UNKNOWN_IS_LABELLED",
        "Out.Header = \"Mission status: unknown\"; // FLOW_STATUS_PANEL_UNKNOWN_IS_LABELLED",
    ),
    (
        "c4_percent_from_any_progress",
        "if (Out.bSuccess) // FLOW_STATUS_PANEL_PERCENT_GATE",
        "if (Status.ProgressPercent >= 0) // FLOW_STATUS_PANEL_PERCENT_GATE",
    ),
    (
        "c4_status_steps_unlabelled",
        "Out.Lines.push_back(std::string(WorkflowProgressLabel) + \": \" + std::to_string(Status.WorkflowStepsCompleted)",
        "Out.Lines.push_back(std::string(\"steps: \") + std::to_string(Status.WorkflowStepsCompleted)",
    ),
    (
        "c4_live_steps_unlabelled",
        "Out.Lines.push_back(std::string(WorkflowProgressLabel) + \": \" + std::to_string(Finished)",
        "Out.Lines.push_back(std::string(\"steps: \") + std::to_string(Finished)",
    ),
    # CLIENT LANE C3 (founder ruling 2026-10-30: a seq gap or reset:true clears the latches and resyncs from /status;
    # never a stale "running"; live_view_unconfigured is a known reason; one bad event field never drops the page).
    (
        "c3_bad_event_drops_page",
        "else { Read.SkippedSeqs.push_back(Event.Seq); } // FLOW_LIVE_BAD_EVENT_SKIPPED_NOT_PAGE",
        "else { return Out; } // FLOW_LIVE_BAD_EVENT_SKIPPED_NOT_PAGE",
    ),
    (
        "c3_unconfigured_reason_refused",
        "|| S == \"live_view_unconfigured\"; // FLOW_LIVE_REASON_VIEW_UNCONFIGURED",
        "; // FLOW_LIVE_REASON_VIEW_UNCONFIGURED",
    ),
    (
        "c3_reset_keeps_latches",
        "*this = FLiveFeed(); // FLOW_LIVE_RESET_CLEARS_LATCHES",
        "EventList.clear(); LastSeq = -1; CursorNow.clear(); // FLOW_LIVE_RESET_CLEARS_LATCHES",
    ),
    (
        "c3_gap_not_detected",
        "if (Seq != NextSeq) { bGap = true; break; } // FLOW_LIVE_SEQ_GAP_DETECTED",
        "if (Seq != NextSeq) { NextSeq = Seq + 1; continue; } // FLOW_LIVE_SEQ_GAP_DETECTED",
    ),
    (
        "c3_gap_keeps_latches",
        "*this = FLiveFeed(); // FLOW_LIVE_GAP_CLEARS_LATCHES",
        "EventList.clear(); CursorNow.clear(); // FLOW_LIVE_GAP_CLEARS_LATCHES",
    ),
    (
        "c3_resync_shows_old_stream",
        "return Out; // FLOW_LIVE_RESYNC_SHOWS_NOTHING_OLD",
        "// FLOW_LIVE_RESYNC_SHOWS_NOTHING_OLD",
    ),
    (
        "c3_stale_is_live",
        "Out.bLive = Feed.IsLive() && !bStaleView; // FLOW_LIVE_STALE_IS_NEVER_LIVE",
        "Out.bLive = Feed.IsLive(); // FLOW_LIVE_STALE_IS_NEVER_LIVE",
    ),
    (
        "c3_silence_not_stale",
        "const bool bStaleView = Feed.IsStale() || (Feed.IsLive() && MsSinceLastRead > LiveNoReadAfterMs); // FLOW_LIVE_SILENCE_IS_STALE",
        "const bool bStaleView = Feed.IsStale(); // FLOW_LIVE_SILENCE_IS_STALE",
    ),
    (
        "c3_finished_silence_is_stale",
        "const bool bStaleView = Feed.IsStale() || (Feed.IsLive() && MsSinceLastRead > LiveNoReadAfterMs); // FLOW_LIVE_SILENCE_IS_STALE",
        "const bool bStaleView = Feed.IsStale() || MsSinceLastRead > LiveNoReadAfterMs; // FLOW_LIVE_SILENCE_IS_STALE",
    ),
    # CLIENT LANE C5 (Skywalker ruling 2, founder, YUJI steering 1, R1): endings follow backend state only.
    (
        "c5_failure_plays_no_ending",
        'Out.push_back(FContractBeat{"run.failed", std::string(), 0}); // FLOW_CONTRACT_FAILURE_PLAYS_ENDING',
        "bReleased = true; // FLOW_CONTRACT_FAILURE_PLAYS_ENDING",
    ),
    (
        "c5_unknown_plays_failure_ending",
        "bReleased = true; // FLOW_CONTRACT_UNKNOWN_PLAYS_NO_ENDING",
        'Out.push_back(FContractBeat{"run.failed", std::string(), 0}); // FLOW_CONTRACT_UNKNOWN_PLAYS_NO_ENDING',
    ),
    (
        "c5_grading_is_blank_wait",
        'case EExecutionPhase::Grading: return "verification"; // FLOW_CONTRACT_GRADING_IS_VERIFICATION (never a blank beat)',
        'case EExecutionPhase::Grading: return "waiting"; // FLOW_CONTRACT_GRADING_IS_VERIFICATION (never a blank beat)',
    ),
    (
        "c5_unknown_shown_as_failed",
        'case EExecutionPhase::OutcomeUnknown: return "waiting"; // FLOW_CONTRACT_UNKNOWN_IS_NEITHER',
        'case EExecutionPhase::OutcomeUnknown: return "failed"; // FLOW_CONTRACT_UNKNOWN_IS_NEITHER',
    ),
    (
        "c5_success_not_gated_by_status",
        "return StatusIsVerifiedSuccess(*Status) ? Phase : EExecutionPhase::Grading; // FLOW_SUCCESS_GATED_BY_STATUS",
        "return Phase; // FLOW_SUCCESS_GATED_BY_STATUS",
    ),
    (
        "c5_completed_word_is_success",
        "return StatusIsVerifiedSuccess(*Status) ? Phase : EExecutionPhase::Grading; // FLOW_SUCCESS_GATED_BY_STATUS",
        "return Status->Phase == EMissionStatusPhase::Completed ? Phase : EExecutionPhase::Grading; // FLOW_SUCCESS_GATED_BY_STATUS",
    ),
    (
        "c5_recorded_replay_sends",
        "Out.bSend = false; // FLOW_RECORDED_REPLAY_REFUSES_START",
        "Out.bSend = Gate.bSend; // FLOW_RECORDED_REPLAY_REFUSES_START",
    ),
    # CLIENT LANE C6: evidence logs carry only what was read; absent is null; success only when verified.
    (
        "c6_log_absent_is_zero",
        'std::string LogIntOrNull(std::int64_t Value) { return Value < 0 ? std::string("null") : std::to_string(Value); } // FLOW_LOG_ABSENT_IS_NULL',
        'std::string LogIntOrNull(std::int64_t Value) { return std::to_string(Value < 0 ? 0 : Value); } // FLOW_LOG_ABSENT_IS_NULL',
    ),
    (
        "c6_log_success_is_completed_word",
        'Out += ",\\"verified_success\\":"; Out += LogBool(StatusIsVerifiedSuccess(Status)); // FLOW_LOG_SUCCESS_IS_VERIFIED',
        'Out += ",\\"verified_success\\":"; Out += LogBool(Status.Phase == EMissionStatusPhase::Completed); // FLOW_LOG_SUCCESS_IS_VERIFIED',
    ),
    (
        "c6_beat_log_drops_seq",
        'Out += ",\\"source_seq\\":" + LogIntOrNull(Beat.SourceSeq); // FLOW_LOG_BEAT_CARRIES_SEQ',
        'Out += ""; // FLOW_LOG_BEAT_CARRIES_SEQ',
    ),
    (
        "c6_resync_log_drops_reason",
        '"{\\"event\\":\\"resync\\",\\"wlj_run_id\\":" + LogString(WljRunId) + ",\\"reason\\":" + LogStringOrNull(Why) // FLOW_LOG_RESYNC_REASON',
        '"{\\"event\\":\\"resync\\",\\"wlj_run_id\\":" + LogString(WljRunId) + ",\\"reason\\":null" + LogStringOrNull(std::string_view()) // FLOW_LOG_RESYNC_REASON',
    ),
    (
        "c6_log_does_not_escape",
        "if (C == '\"' || C == '\\\\') { Out += '\\\\'; Out += C; } // FLOW_LOG_ESCAPES",
        "if (false) { Out += C; } // FLOW_LOG_ESCAPES",
    ),
    # FIX COMMIT 2026-10-30 (YUJI M1/M2/m4/m6, Skywalker F1/F4/F5/F10).
    (
        'm1_503_any_body_is_not_started',
        'Out.Outcome = bNotStarted ? EStartOutcome::Retryable : EStartOutcome::Uncertain; // FLOW_START_503_READS_THE_BODY',
        'Out.Outcome = EStartOutcome::Retryable; (void)bNotStarted; // FLOW_START_503_READS_THE_BODY',
    ),
    (
        'm1_503_not_read',
        'if (HttpStatus == 0 || HttpStatus == 401 || HttpStatus == 502 || HttpStatus == 504)',
        'if (HttpStatus == 0 || HttpStatus == 401 || HttpStatus == 502 || HttpStatus == 503 || HttpStatus == 504)',
    ),
    (
        'm1_503_unavailable_kind_alone',
        '|| (Kind == "julius_start_unavailable" && bSaysNothingClaimed);',
        '|| (Kind == "julius_start_unavailable" && (bSaysNothingClaimed || true));',
    ),
    (
        'm2_corrupt_record_parses_as_none',
        'Bad.Record = EStartRecord::Unreadable; // FLOW_SAVED_RECORD_UNREADABLE_BLOCKS',
        'Bad.Record = EStartRecord::None; Bad.Read = ESavedStartRead::Absent; // FLOW_SAVED_RECORD_UNREADABLE_BLOCKS',
    ),
    (
        'm2_truncated_record_accepted',
        "if (!bLoaded || Text.empty() || Text.back() != '\\n') { return Bad; }",
        'if (!bLoaded || Text.empty()) { return Bad; }',
    ),
    (
        'm2_unreadable_record_offers_start',
        'if (Record == EStartRecord::Unreadable)\n\t\t{',
        'if (false)\n\t\t{',
    ),
    (
        'm2_unreadable_record_released',
        'Out.Record = bDispatchSeen ? R::Started : R::Unreadable; // FLOW_RECONCILE_UNREADABLE_NEVER_RELEASES',
        'Out.Record = bDispatchSeen ? R::Started : R::NotStarted; // FLOW_RECONCILE_UNREADABLE_NEVER_RELEASES',
    ),
    (
        'f1_no_status_keeps_result_success',
        'if (Status == nullptr || !Status->bOk) { return EExecutionPhase::Grading; } // FLOW_SUCCESS_FAILS_CLOSED_WITHOUT_STATUS',
        'if (Status == nullptr || !Status->bOk) { return Phase; } // FLOW_SUCCESS_FAILS_CLOSED_WITHOUT_STATUS',
    ),
    (
        'f5_m08_requested_without_request_releases',
        'else if (Status.bRequested || Status.bClaimKeyHashPresent || Ph != P::Admitted)',
        'else if (Ph != P::Admitted)',
    ),
    (
        'f10_settled_releases',
        '&& Status.RequestState.empty() && !Status.bRequestUnreadable // no saved intent of any state',
        '&& (Status.RequestState.empty() || Status.RequestState == "settled") && !Status.bRequestUnreadable // no saved intent of any state',
    ),
    (
        'f10_ack_off_releases',
        'return Status.bOk && Status.bRequestFieldPresent // ACK on and readable',
        'return Status.bOk // ACK on and readable',
    ),
    (
        'f10_claim_key_hash_ignored',
        '&& !Status.bRequested && !Status.bClaimKeyHashPresent // no claim, no Start in flight',
        '&& !Status.bRequested // no claim, no Start in flight',
    ),
    (
        'f10_release_rule_skipped',
        'else if (bBlocking && !StatusShowsNothingAtAll(Status))',
        'else if (false)',
    ),
    (
        'f10_request_unreadable_releases',
        '&& Status.RequestState.empty() && !Status.bRequestUnreadable // no saved intent of any state',
        '&& Status.RequestState.empty() // no saved intent of any state',
    ),
    (
        'm6_status_terminal_plays_no_ending',
        'Out.Phase = Ph == P::Interrupted ? E::Failed : E::DidNotStart; // FLOW_STATUS_TERMINAL_PLAYS_FAILURE_ENDING',
        'Out.Phase = View.Phase; // FLOW_STATUS_TERMINAL_PLAYS_FAILURE_ENDING',
    ),
    (
        'm6_outcome_unknown_plays_ending',
        'if (Status == nullptr || !Status->bOk || Status->bOutcomeUnknown) { return View; } // unknown plays no ending',
        'if (Status == nullptr || !Status->bOk) { return View; } // unknown plays no ending',
    ),
    (
        'm6_unknown_view_overridden',
        '|| View.Phase == E::Cancelled || View.Phase == E::OutcomeUnknown;',
        '|| View.Phase == E::Cancelled;',
    ),
    (
        'f4_cause_seq_is_newest',
        'Out.CauseSeq = Feed.TaskPhaseSeen() ? Feed.LastTaskPhase().Seq : Feed.LiveStepSeq() >= 0 ? Feed.LiveStepSeq() : Feed.LastSeenSeq(); // FLOW_EXEC_CAUSE_SEQ',
        'Out.CauseSeq = Feed.LastSeenSeq(); // FLOW_EXEC_CAUSE_SEQ',
    ),
    (
        'f4_beat_role_always_actor',
        'Out += ",\\"role\\":"; Out += Beat.bActor ? "\\"actor\\"" : "\\"observer\\""; // FLOW_LOG_BEAT_CARRIES_ROLE',
        'Out += ",\\"role\\":\\"actor\\""; // FLOW_LOG_BEAT_CARRIES_ROLE',
    ),
    (
        'f4_beat_drops_time',
        'Out += ",\\"client_utc_ms\\":" + std::to_string(Beat.ClientUtcMs); // FLOW_LOG_BEAT_CARRIES_TIME',
        'Out += ",\\"client_utc_ms\\":0"; // FLOW_LOG_BEAT_CARRIES_TIME',
    ),
]


# CLIENT MUTATIONS (REVIEW c573b54e, item 6): flip one rule in the J1 client wrapper; the WRAPPER KAT must then fail.
CLIENT = "wonderland/Source/Wonderland/WonderlandJuliusMissionClient.cpp"
CLIENT_MUTATIONS = [
    (
        "client_polls_without_a_session",
        "NowMs >= NextPollAtUtcMs && bSessionReady) // CLIENT_NO_POLL_WITHOUT_SESSION",
        "NowMs >= NextPollAtUtcMs) // CLIENT_NO_POLL_WITHOUT_SESSION",
    ),
    (
        "client_concludes_any_run",
        "if (!bAdmitted || bFinished || bRefused || bFailClosed || RunId.empty() || RunId != CurrentRunId) { return false; } // CLIENT_CONCLUDE_ONLY_THIS_ADMITTED_RUN",
        "if (bFinished) { return false; } // CLIENT_CONCLUDE_ONLY_THIS_ADMITTED_RUN",
    ),
    # CLIENT LANE C1: a same-key resend reuses the persisted clientTriggerId.
    (
        "c1_client_trigger_minted_per_send",
        "Body += JsonString(ClientTriggerId); // CLIENT_START_TRIGGER_IS_THE_PERSISTED_ONE",
        "std::uint8_t Fresh[16] = {}; (void)Random.Fill(Fresh); Body += JsonString(HexOf(Fresh, 16)); // CLIENT_START_TRIGGER_IS_THE_PERSISTED_ONE",
    ),
    (
        "c1_client_trigger_unchecked",
        "if (!bTriggerOk) { Outcome.Detail = \"client trigger id is malformed\"; return Outcome; } // CLIENT_START_TRIGGER_WELL_FORMED",
        "(void)bTriggerOk; // CLIENT_START_TRIGGER_WELL_FORMED",
    ),
    # CLIENT LANE C2: the client polls the A-9 /status route.
    (
        "c2_client_status_wrong_route",
        'Outcome.Request.Url += "/status?projectId="; // CLIENT_STATUS_ROUTE',
        'Outcome.Request.Url += "/progress?projectId="; // CLIENT_STATUS_ROUTE',
    ),
]

# SUBSYSTEM MUTATIONS (client lane C2, founder ruling 2026-10-30): the UE subsystem is not compiled here; the wrapper
# KAT's source check is what must fail when a status read (or anything else in the subsystem) re-sends a Start.
SUBSYSTEM = "wonderland/Source/Wonderland/Julius/WonderlandJuliusMissionSubsystem.cpp"
SUBSYSTEM_MUTATIONS = [
    (
        "c2_status_read_auto_resends_start",
        "if (!SaveStartRecord()) // SUBSYSTEM_STATUS_READ_NEVER_SENDS",
        "if (StartRecord == 4) { (void)StartPaidMission(TEXT(\"RUN LIVE MISSION\")); } if (!SaveStartRecord()) // SUBSYSTEM_STATUS_READ_NEVER_SENDS",
    ),
    (
        "mb_new_key_per_start",
        "if (StartKey.IsEmpty()) // SUBSYSTEM_START_KEY_REUSED",
        "if (true) // SUBSYSTEM_START_KEY_REUSED",
    ),
    (
        "mb_new_trigger_per_start",
        "if (StartTriggerId.IsEmpty()) // SUBSYSTEM_START_TRIGGER_REUSED",
        "if (true) // SUBSYSTEM_START_TRIGGER_REUSED",
    ),
    (
        "c3_resync_does_not_read_status",
        "NextStatusReadAtUtcMs = 0; // SUBSYSTEM_RESYNC_READS_STATUS",
        "// SUBSYSTEM_RESYNC_READS_STATUS",
    ),
    # CLIENT LANE C5: the UE contract follows backend state only (source-checked by julius_endings_follow_backend_state).
    (
        "c5_subsystem_recorded_replay_allows_start",
        "const FStartGate Gate = RecordedReplayGate(StartGateFor(ToStd(UiStateToken()), HasNativeSession(), bHasWorkflow, static_cast<EStartRecord>(StartRecord), true, TypedStd), bRecordedReplay); // SUBSYSTEM_RECORDED_REPLAY_REFUSES_START",
        "(void)bRecordedReplay; const FStartGate Gate = StartGateFor(ToStd(UiStateToken()), HasNativeSession(), bHasWorkflow, static_cast<EStartRecord>(StartRecord), true, TypedStd); // SUBSYSTEM_RECORDED_REPLAY_REFUSES_START",
    ),
    (
        "c5_subsystem_success_not_gated",
        "View.Phase = SuccessGatedByStatus(View.Phase, StatusRunId == Run && Host->LastStatus.bOk ? &Host->LastStatus : nullptr); // SUBSYSTEM_SUCCESS_GATED_BY_STATUS",
        "// SUBSYSTEM_SUCCESS_GATED_BY_STATUS",
    ),
    (
        "c5_subsystem_grading_releases_blank",
        '{ Contract->ReleaseRealRunBeat(); } // SUBSYSTEM_ENDING_ON_CLEARED_STAGE',
        '{ Contract->ReleaseRealRunBeat(); } if (View.Phase == EExecutionPhase::Grading) { Contract->ReleaseRealRunBeat(); } // SUBSYSTEM_ENDING_ON_CLEARED_STAGE',
    ),
    (
        "c5_subsystem_timer_drives_ending",
        "Contract->ReleaseRealRunBeat(); // SUBSYSTEM_UNKNOWN_PLAYS_NO_ENDING",
        "Contract->ReleaseRealRunBeat(); FTimerHandle Later; (void)Later; // SUBSYSTEM_UNKNOWN_PLAYS_NO_ENDING",
    ),
    # CLIENT LANE C6: the evidence lines are written where the state is decided (source-checked by julius_evidence_logs).
    (
        "c6_subsystem_no_status_read_log",
        "UE_LOG(LogJuliusJ1, Display, TEXT(\"%s\"), UTF8_TO_TCHAR(FormatStatusReadLog(ToStd(ForRunId), Read).c_str())); // SUBSYSTEM_LOGS_STATUS_READ (C6 evidence, E4)",
        "// SUBSYSTEM_LOGS_STATUS_READ (C6 evidence, E4)",
    ),
    (
        "c6_subsystem_no_resync_log",
        "UE_LOG(LogJuliusJ1, Display, TEXT(\"%s\"), UTF8_TO_TCHAR(FormatResyncLog(ToStd(ForRunId), Resync, Feed.SkippedEvents(), Feed.LastSeenSeq()).c_str())); // SUBSYSTEM_LOGS_RESYNC",
        "(void)Resync; // SUBSYSTEM_LOGS_RESYNC",
    ),
    (
        "c6_subsystem_beat_log_without_seq",
        "UE_LOG(LogJuliusJ1, Display, TEXT(\"%s\"), UTF8_TO_TCHAR(FormatBeatLog(Evidence).c_str())); // SUBSYSTEM_LOGS_BEAT",
        "(void)Evidence; // SUBSYSTEM_LOGS_BEAT",
    ),
    # FIX COMMIT 2026-10-30 (YUJI M2/m4/m6, Skywalker F3/F4): source-checked by julius_start_record_saved_before_send,
    # julius_status_failure_ending and julius_evidence_logs.
    (
        'm2_send_when_save_failed',
        'if (!SaveStartRecord()) // SUBSYSTEM_SAVE_BEFORE_SEND',
        'if (!SaveStartRecord() && false) // SUBSYSTEM_SAVE_BEFORE_SEND',
    ),
    (
        'm2_y19_no_save_before_send',
        'if (!SaveStartRecord()) // SUBSYSTEM_SAVE_BEFORE_SEND',
        'if (false) // SUBSYSTEM_SAVE_BEFORE_SEND',
    ),
    (
        'm2_save_result_ignored_after_answer',
        '\tif (!SaveStartRecord())\n\t{\n\t\t// The disk still says',
        '\tSaveStartRecord(); if (false)\n\t{\n\t\t// The disk still says',
    ),
    (
        'm2_record_written_in_place',
        'if (!FFileHelper::SaveStringToFile(FString(UTF8_TO_TCHAR(Text.c_str())), *Temp)) { return false; } // SUBSYSTEM_START_RECORD_WRITES_TEMP_FIRST',
        'return FFileHelper::SaveStringToFile(FString(UTF8_TO_TCHAR(Text.c_str())), *Path); // SUBSYSTEM_START_RECORD_WRITES_TEMP_FIRST',
    ),
    (
        'm2_rename_skipped',
        'return IFileManager::Get().Move(*Path, *Temp, true, true); // SUBSYSTEM_START_RECORD_RENAMED_INTO_PLACE',
        'return true; // SUBSYSTEM_START_RECORD_RENAMED_INTO_PLACE',
    ),
    (
        'm2_unreadable_record_overwritten',
        'if (StartRecord == static_cast<uint8>(EStartRecord::Unreadable)) { return false; }',
        'if (false) { return false; }',
    ),
    (
        'm2_corrupt_record_resets_to_none',
        'StartRecord = static_cast<uint8>(EStartRecord::Unreadable); // SUBSYSTEM_CORRUPT_RECORD_BLOCKS',
        'StartRecord = 0; // SUBSYSTEM_CORRUPT_RECORD_BLOCKS',
    ),
    (
        'm2_temp_record_not_recovered',
        'Files.FileExists(*Path) ? Path : Files.FileExists(*Temp) ? Temp : FString();',
        'Files.FileExists(*Path) ? Path : FString();',
    ),
    (
        'f3_duplicate_status_read_line',
        'TEXT("{\\"event\\":\\"status_reconcile\\",',
        'TEXT("{\\"event\\":\\"status_read\\",',
    ),
    (
        'f4_subsystem_beat_seq_is_newest',
        'Evidence.SourceSeq = View.CauseSeq; // SUBSYSTEM_BEAT_SEQ_IS_THE_CAUSE',
        'Evidence.SourceSeq = Host->LiveFeed.LastSeenSeq(); // SUBSYSTEM_BEAT_SEQ_IS_THE_CAUSE',
    ),
    (
        'f4_subsystem_role_always_actor',
        'Evidence.bActor = bStartAcceptedHere; // SUBSYSTEM_BEAT_ROLE',
        'Evidence.bActor = true; // SUBSYSTEM_BEAT_ROLE',
    ),
    (
        'f4_subsystem_beat_without_time',
        'Evidence.ClientUtcMs = Host->Clock.NowUtcMs(); // SUBSYSTEM_BEAT_TIME',
        '// SUBSYSTEM_BEAT_TIME',
    ),
    (
        'f4_subsystem_beat_without_offset',
        'Host->Session.ClockOffset(Evidence.bClockOffsetKnown, Evidence.ClockOffsetMs);',
        '(void)0;',
    ),
    (
        'm6_subsystem_status_ending_dropped',
        'View = StatusFailureEnding(View, RunStatus); // SUBSYSTEM_STATUS_TERMINAL_PLAYS_FAILURE_ENDING',
        '// SUBSYSTEM_STATUS_TERMINAL_PLAYS_FAILURE_ENDING',
    ),
    (
        'm6_subsystem_unknown_enters_contract',
        '&& !RunStatus->bOutcomeUnknown',
        '&& true',
    ),
    (
        'm6_subsystem_refused_never_enters',
        '|| (StartRecord == static_cast<uint8>(EStartRecord::Refused) && bStatusFailureEnding); // SUBSYSTEM_STATUS_TERMINAL_ENTERS_CONTRACT',
        '|| false; // SUBSYSTEM_STATUS_TERMINAL_ENTERS_CONTRACT',
    ),
    (
        'm6_subsystem_status_ending_waits_for_reads',
        'if (!bStatusFailureEnding && !bStartAcceptedHere &&',
        'if (!bStartAcceptedHere &&',
    ),
]

TARGETS = {
    # target: (mutated file, KAT source, extra sources, include dirs, copy the whole module tree)
    "flow": (FLOW, "wonderland/Tools/j1_mission_flow_kat.cpp",
             [FLOW, "wonderland/Source/Wonderland/WonderlandJuliusMissionProgress.cpp",
              "wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.cpp"],
             ["wonderland/Source/Wonderland"], False),
    # The wrapper KAT reads wonderland/Source/Wonderland/Julius from its working directory, so the module tree is copied
    # and the KAT runs from the copy's root.
    "client": (CLIENT, "wonderland/Tools/j1_wrapper_kat.cpp",
               [CLIENT, "wonderland/Source/Wonderland/WonderlandJuliusMissionProgress.cpp",
                "wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.cpp"],
               ["wonderland/Source/Wonderland", "wonderland/Source"], True),
    "subsystem": (SUBSYSTEM, "wonderland/Tools/j1_wrapper_kat.cpp",
                  [CLIENT, "wonderland/Source/Wonderland/WonderlandJuliusMissionProgress.cpp",
                   "wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.cpp"],
                  ["wonderland/Source/Wonderland", "wonderland/Source"], True),
}


# KNOWN BASELINE FAILURES (client lane 2026-10-30): the wrapper KAT already fails these at e9a2d7a0, before any
# client-lane change, and they are out of the lane's scope. The baseline must fail EXACTLY these names; a mutation is a
# catch only when the KAT fails a name NOT in this set. Never add a name here to make a mutation "pass".
KNOWN_BASELINE_FAILURES = {
    "flow": set(),
    "client": {"restore_held_server_expiry_is_not_started", "restore_late_server_dispatch_wins"},
    "subsystem": {"restore_held_server_expiry_is_not_started", "restore_late_server_dispatch_wins"},
}


def fail_names(output):
    return {line[5:].strip() for line in output.splitlines() if line.startswith("FAIL ")}


# SAFETY (Skywalker ruling 5): no KAT, script or tool here may name the console commands that start, dispatch or
# resend for real. The names are assembled so this file does not contain them either.
FORBIDDEN_COMMANDS = ["wl.Julius.J1.Panel." + verb for verb in ("Start", "Dispatch", "Resend")]


def safety_scan():
    hits = []
    tools = os.path.join(ROOT, "wonderland/Tools")
    for name in sorted(os.listdir(tools)):
        path = os.path.join(tools, name)
        if not os.path.isfile(path):
            continue
        text = open(path, encoding="utf-8", errors="replace").read()
        hits += [f"{name}: {cmd}" for cmd in FORBIDDEN_COMMANDS if cmd in text]
    return hits


def build_and_run(cxx, target, old, new):
    """Returns (built, kat_exit_code, kat_stdout)."""
    mutated, kat, sources, includes, whole_tree = TARGETS[target]
    tmp = tempfile.mkdtemp(prefix="j1-sab-")
    try:
        if whole_tree:
            shutil.copytree(os.path.join(ROOT, "wonderland/Source/Wonderland"), os.path.join(tmp, "wonderland/Source/Wonderland"))
        for needed in NEEDED + [kat, mutated]:
            dst = os.path.join(tmp, needed)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(os.path.join(ROOT, needed), dst)
        if old is not None:
            path = os.path.join(tmp, mutated)
            text = open(path, encoding="utf-8").read()
            open(path, "w", encoding="utf-8").write(text.replace(old, new, 1))
        exe = os.path.join(tmp, "kat")
        files = [os.path.join(tmp, kat)] + [os.path.join(tmp, f) for f in sources]
        if os.path.splitext(os.path.basename(cxx))[0].lower() == "cl":
            # MSVC (CXX=cl from a VS developer prompt): the box that builds UE has no g++.
            exe += ".exe"
            command = [cxx, "/nologo", "/std:c++17", "/EHsc", "/Od", "/w"]
            for inc in includes:
                command += ["/I", os.path.join(tmp, inc)]
            command += files + ["/Fe" + exe, "/Fo" + tmp + os.sep]
        else:
            command = [cxx, "-std=c++17", "-O0", "-w"]
            for inc in includes:
                command += ["-I", os.path.join(tmp, inc)]
            command += files + ["-o", exe]
        build = subprocess.run(command, capture_output=True, text=True)
        if build.returncode != 0:
            return False, build.stdout[-400:] + build.stderr[-400:], ""
        run = subprocess.run([exe], capture_output=True, text=True, timeout=120, cwd=tmp)
        return True, run.returncode, run.stdout
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    cxx = os.environ.get("CXX", "g++").strip()
    hits = safety_scan()
    if hits:
        print(f"SABOTAGE SAFETY FAIL: {'; '.join(hits)}")
        return 2
    print("SABOTAGE SAFETY PASS no start/dispatch/resend console command in Tools")
    plan = ([("flow", m) for m in MUTATIONS] + [("client", m) for m in CLIENT_MUTATIONS]
            + [("subsystem", m) for m in SUBSYSTEM_MUTATIONS])
    for target, (name, old, _new) in plan:
        source = open(os.path.join(ROOT, TARGETS[target][0]), encoding="utf-8").read()
        count = source.count(old)
        if count != 1:
            print(f"SABOTAGE TARGET BROKEN {name}: found {count} times")
            return 2
    # J1_SABOTAGE_ONLY=prefix[,prefix]: run only the mutations whose names start with a prefix (all targets are still
    # checked above, and every baseline still runs).
    only = [p for p in os.environ.get("J1_SABOTAGE_ONLY", "").split(",") if p]
    if only:
        plan = [(t, m) for t, m in plan if any(m[0].startswith(p) for p in only)]
    # A baseline per target: the unmutated copy must build and PASS (or fail exactly its known names), or every
    # "catch" below would be meaningless.
    for target in TARGETS:
        built, code, out = build_and_run(cxx, target, None, None)
        known = KNOWN_BASELINE_FAILURES[target]
        if not built or (code != 0 and fail_names(out) != known) or (code == 0 and known):
            print(f"SABOTAGE BASELINE FAIL {target}: built={built} result={code} fails={sorted(fail_names(out)) if built else code}")
            return 2
        print(f"SABOTAGE BASELINE PASS {target}" + (f" (known failures: {' '.join(sorted(known))})" if known else ""))
    survived = []
    for target, (name, old, new) in plan:
        built, code, out = build_and_run(cxx, target, old, new)
        if not built:
            survived.append(name)
            print(f"SABOTAGE COMPILE FAIL {name}: not a catch")
            print(code)
        elif code == 0 or not (fail_names(out) - KNOWN_BASELINE_FAILURES[target]):
            survived.append(name)
            print(f"SABOTAGE SURVIVED {name}")
        else:
            print(f"SABOTAGE CAUGHT {name}")
    if survived:
        print(f"SABOTAGE RESULT FAIL survived={len(survived)}: {' '.join(survived)}")
        return 1
    print(f"SABOTAGE RESULT PASS caught={len(plan)}/{len(plan)}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
