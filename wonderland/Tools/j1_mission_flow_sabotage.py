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
        "secret_shown",
        "Out.bEchoSecret = false; // FLOW_SECRET_NOT_DISPLAYED",
        "Out.bEchoSecret = true; // FLOW_SECRET_NOT_DISPLAYED",
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
]


def main():
    cxx = os.environ.get("CXX", "g++")
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
            build = subprocess.run(
                [
                    cxx, "-std=c++17", "-O0", "-w",
                    "-I", os.path.join(tmp, "wonderland/Source/Wonderland"),
                    os.path.join(tmp, "wonderland/Tools/j1_mission_flow_kat.cpp"),
                    os.path.join(tmp, FLOW),
                    os.path.join(tmp, "wonderland/Source/Wonderland/WonderlandJuliusMissionProgress.cpp"),
                    os.path.join(tmp, "wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.cpp"),
                    "-o", exe,
                ],
                capture_output=True, text=True,
            )
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
