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
        'if (!LiveWord(Field(Node, "role"), Event.Role) || !LiveRole(Event.Role)) { return Out; } // FLOW_LIVE_ROLES_ARE_CLOSED',
        'if (!LiveWord(Field(Node, "role"), Event.Role)) { return Out; } // FLOW_LIVE_ROLES_ARE_CLOSED',
    ),
    (
        'live_task_types_open',
        'Event.TaskType) || !LiveTaskType(Event.TaskType)) { return Out; }',
        'Event.TaskType)) { return Out; }',
    ),
    (
        'live_task_states_open',
        'Event.State) || !LiveTaskState(Event.State)) { return Out; }',
        'Event.State)) { return Out; }',
    ),
    (
        'live_repair_cycle_unbounded',
        'Event.RepairCycle)) { return Out; } // FLOW_LIVE_REPAIR_CYCLE_BOUND',
        'Event.RepairCycle) && false) { return Out; } // FLOW_LIVE_REPAIR_CYCLE_BOUND',
    ),
    (
        'live_phases_not_samples',
        'if (!LiveBool(Field(Node, "sampled"), bSampled) || !bSampled) { return Out; } // FLOW_LIVE_PHASES_ARE_SAMPLES',
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
]


def main():
    cxx = os.environ.get("CXX", "g++").strip()
    source = open(os.path.join(ROOT, FLOW), encoding="utf-8").read()
    for name, old, _new in MUTATIONS:
        count = source.count(old)
        if count != 1:
            print(f"SABOTAGE TARGET BROKEN {name}: found {count} times")
            return 2
    survived = []
    for name, old, new in MUTATIONS:
        tmp = tempfile.mkdtemp(prefix="j1-flow-sab-")
        try:
            for needed in NEEDED:
                src = os.path.join(ROOT, needed)
                dst = os.path.join(tmp, needed)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(src, dst)
            path = os.path.join(tmp, FLOW)
            text = open(path, encoding="utf-8").read()
            open(path, "w", encoding="utf-8").write(text.replace(old, new, 1))
            exe = os.path.join(tmp, "kat")
            sources = [
                os.path.join(tmp, "wonderland/Tools/j1_mission_flow_kat.cpp"),
                os.path.join(tmp, FLOW),
                os.path.join(tmp, "wonderland/Source/Wonderland/WonderlandJuliusMissionProgress.cpp"),
                os.path.join(tmp, "wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.cpp"),
            ]
            include = os.path.join(tmp, "wonderland/Source/Wonderland")
            if os.path.splitext(os.path.basename(cxx))[0].lower() == "cl":
                # MSVC (CXX=cl from a VS developer prompt): the box that builds UE has no g++.
                exe += ".exe"
                command = [cxx, "/nologo", "/std:c++17", "/EHsc", "/Od", "/w", "/I", include] + sources + [
                    "/Fe" + exe, "/Fo" + tmp + os.sep]
            else:
                command = [cxx, "-std=c++17", "-O0", "-w", "-I", include] + sources + ["-o", exe]
            build = subprocess.run(command, capture_output=True, text=True)
            if build.returncode != 0:
                survived.append(name)
                print(f"SABOTAGE COMPILE FAIL {name}: not a catch")
                print(build.stderr[:400])
                continue
            run = subprocess.run([exe], capture_output=True, text=True, timeout=60)
            if run.returncode == 0:
                survived.append(name)
                print(f"SABOTAGE SURVIVED {name}")
            else:
                print(f"SABOTAGE CAUGHT {name}")
        finally:
            shutil.rmtree(tmp)
    if survived:
        print(f"SABOTAGE RESULT FAIL survived={len(survived)}: {' '.join(survived)}")
        return 1
    print(f"SABOTAGE RESULT PASS caught={len(MUTATIONS)}/{len(MUTATIONS)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
