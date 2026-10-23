// WONDERLAND -- J1 mission PROGRESS logic: KNOWN-ANSWER TEST. No Unreal, no network, no clock, no randomness.
//
// Build and run from the repository root (any C++17 compiler):
//   g++ -std=c++17 -O2 -Wall -Wextra -Werror -pedantic -I wonderland/Source/Wonderland
//       wonderland/Tools/j1_progress_kat.cpp wonderland/Source/Wonderland/WonderlandJuliusMissionProgress.cpp
//       wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.cpp -o j1_progress_kat
//   (one command line, wrapped here)
//   ./j1_progress_kat     -> prints "J1 PROGRESS KAT PASS ..." and exits 0, or names every failure and exits 1.
//
// WHERE THE EXPECTED VALUES COME FROM. The status vocabularies are BRIDGE's #407 at dd0153a0
// (src/relay/integration/wonderland-admission/admission-store.ts AdmissionState) and src/relay/mission/julius/julius-runtime.ts
// JULIUS_MISSION_STATES. src/relay/mission/wonderland/wonderland-j1-progress.test.ts parses every table below
// (KAT-...-BEGIN/END), restates the rules of WonderlandJuliusMissionProgress.h independently, and checks each expected
// value, so a value here cannot be edited without that test failing, and the C++ cannot drift without this failing.
//
// THE SCRIPT LANGUAGE of KAT-PROGRESS-SCRIPT. Steps are separated by one space, fields by commas:
//   D,<http>,<err>,<client>,<server>,<state>   a dispatch answer, classified by r2's ClassifyDispatchAnswer
//   D0                                          a dispatch POST with no HTTP answer (status 0)
//   P,<http>,<err>,<vocab>,<client>,<server>,<state>   a status poll's answer
//   P0                                          a poll with no HTTP answer
//   N,<watchedMs>                               the wrapper asks NextPollStep
// err: "-" no error object, "~" an error object without a kind, anything else the kind. client: ok (this tracker's
// wlj_ id), other (another wlj_ id), none (absent), nodata (no data object at all). server: S1, S2 (two well-formed
// run: ids), bad (S1 with upper-case hex), short, jkey (Julius's own run:<idempotencyKey> name, never the pinned id), none. vocab: A Admission, J JuliusRun, U Unknown. state "-" is empty.
// Expected: the final state, the last trace event, the pinned server run id, and DispatchSendAllowed().
#include "WonderlandJuliusMissionProgress.h"

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace
{
	using namespace WonderlandJuliusMissionLogic;

	int Failures = 0;

	void Expect(bool bOk, const std::string& What)
	{
		if (!bOk)
		{
			++Failures;
			std::printf("FAIL %s\n", What.c_str());
		}
	}

	template <typename T, std::size_t N>
	constexpr std::size_t CountOf(const T (&)[N]) { return N; }

	const char* const ClientOk = "wlj_0b1f3c2a-5d4e-4f60-8a71-92b3c4d5e6f7";
	const char* const ClientOther = "wlj_7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918";
	const char* const KeyOk = "6c2d9e1f-3a4b-4c5d-9e6f-7a8b9c0d1e2f";
	const char* const ServerS1 = "run:0123456789abcdef01234567";
	const char* const ServerS2 = "run:89abcdef0123456789abcdef";
	const char* const ServerBad = "run:0123456789ABCDEF01234567";
	const char* const ServerShort = "run:0123";
	// What Julius bootstrap names a run today (run:${idempotencyKey}, relay-bridge/julius/bootstrap.ts): NOT serverRunId.
	const char* const ServerJuliusKey = "run:6c2d9e1f-3a4b-4c5d-9e6f-7a8b9c0d1e2f";

	struct FStatusRow { const char* Label; EStatusVocabulary Vocabulary; const char* Status; EMissionProgress Expected; };
	const FStatusRow StatusRows[] = {
	// KAT-PROGRESS-STATUS-BEGIN
	{ "admission_reserved", EStatusVocabulary::Admission, "RESERVED", EMissionProgress::AdmittedHeld },
	{ "admission_admission_held", EStatusVocabulary::Admission, "ADMISSION_HELD", EMissionProgress::AdmittedHeld },
	{ "admission_ledger_unwritten", EStatusVocabulary::Admission, "LEDGER_UNWRITTEN", EMissionProgress::AdmittedHeld },
	{ "admission_interrupted", EStatusVocabulary::Admission, "INTERRUPTED", EMissionProgress::DispatchFailed },
	{ "admission_failed", EStatusVocabulary::Admission, "FAILED", EMissionProgress::DispatchFailed },
	{ "julius_created", EStatusVocabulary::JuliusRun, "CREATED", EMissionProgress::Dispatched },
	{ "julius_planning", EStatusVocabulary::JuliusRun, "PLANNING", EMissionProgress::Dispatched },
	{ "julius_ready", EStatusVocabulary::JuliusRun, "READY", EMissionProgress::Dispatched },
	{ "julius_executing", EStatusVocabulary::JuliusRun, "EXECUTING", EMissionProgress::Running },
	{ "julius_waiting", EStatusVocabulary::JuliusRun, "WAITING", EMissionProgress::Running },
	{ "julius_reviewing", EStatusVocabulary::JuliusRun, "REVIEWING", EMissionProgress::Running },
	{ "julius_repairing", EStatusVocabulary::JuliusRun, "REPAIRING", EMissionProgress::Running },
	{ "julius_verifying", EStatusVocabulary::JuliusRun, "VERIFYING", EMissionProgress::Running },
	{ "julius_blocked", EStatusVocabulary::JuliusRun, "BLOCKED", EMissionProgress::Paused },
	{ "julius_paused", EStatusVocabulary::JuliusRun, "PAUSED", EMissionProgress::Paused },
	{ "julius_failed", EStatusVocabulary::JuliusRun, "FAILED", EMissionProgress::Failed },
	{ "julius_completed", EStatusVocabulary::JuliusRun, "COMPLETED", EMissionProgress::Succeeded },
	{ "julius_cancelled", EStatusVocabulary::JuliusRun, "CANCELLED", EMissionProgress::Failed },
	{ "admission_julius_completed", EStatusVocabulary::Admission, "COMPLETED", EMissionProgress::Waiting },
	{ "admission_julius_executing", EStatusVocabulary::Admission, "EXECUTING", EMissionProgress::Waiting },
	{ "admission_julius_cancelled", EStatusVocabulary::Admission, "CANCELLED", EMissionProgress::Waiting },
	{ "admission_lowercase", EStatusVocabulary::Admission, "admission_held", EMissionProgress::Waiting },
	{ "admission_padded", EStatusVocabulary::Admission, " ADMISSION_HELD", EMissionProgress::Waiting },
	{ "admission_trailing", EStatusVocabulary::Admission, "FAILED ", EMissionProgress::Waiting },
	{ "admission_empty", EStatusVocabulary::Admission, "", EMissionProgress::Waiting },
	{ "admission_dispatched_word", EStatusVocabulary::Admission, "DISPATCHED", EMissionProgress::Waiting },
	{ "admission_running_word", EStatusVocabulary::Admission, "RUNNING", EMissionProgress::Waiting },
	{ "julius_admission_held", EStatusVocabulary::JuliusRun, "ADMISSION_HELD", EMissionProgress::Waiting },
	{ "julius_reserved", EStatusVocabulary::JuliusRun, "RESERVED", EMissionProgress::Waiting },
	{ "julius_interrupted", EStatusVocabulary::JuliusRun, "INTERRUPTED", EMissionProgress::Waiting },
	{ "julius_lowercase_completed", EStatusVocabulary::JuliusRun, "completed", EMissionProgress::Waiting },
	{ "julius_mixed_case", EStatusVocabulary::JuliusRun, "Completed", EMissionProgress::Waiting },
	{ "julius_succeeded_word", EStatusVocabulary::JuliusRun, "SUCCEEDED", EMissionProgress::Waiting },
	{ "julius_running_word", EStatusVocabulary::JuliusRun, "RUNNING", EMissionProgress::Waiting },
	{ "julius_prefix", EStatusVocabulary::JuliusRun, "COMPLETED_WITH_ERRORS", EMissionProgress::Waiting },
	{ "julius_empty", EStatusVocabulary::JuliusRun, "", EMissionProgress::Waiting },
	{ "julius_free_text", EStatusVocabulary::JuliusRun, "the run completed", EMissionProgress::Waiting },
	{ "unknown_completed", EStatusVocabulary::Unknown, "COMPLETED", EMissionProgress::Waiting },
	{ "unknown_failed", EStatusVocabulary::Unknown, "FAILED", EMissionProgress::Waiting },
	{ "unknown_admission_held", EStatusVocabulary::Unknown, "ADMISSION_HELD", EMissionProgress::Waiting },
	{ "unknown_executing", EStatusVocabulary::Unknown, "EXECUTING", EMissionProgress::Waiting },
	{ "unknown_empty", EStatusVocabulary::Unknown, "", EMissionProgress::Waiting },
	// KAT-PROGRESS-STATUS-END
	};

	struct FDisplayRow { const char* Name; EMissionProgress State; const char* Label; int bTerminal; int bSendAllowed; };
	const FDisplayRow DisplayRows[] = {
	// KAT-PROGRESS-DISPLAY-BEGIN
	{ "awaiting_dispatch_answer", EMissionProgress::AwaitingDispatchAnswer, "Sent \xE2\x80\x94 waiting for the bridge to answer", 0, 1 },
	{ "admitted_held", EMissionProgress::AdmittedHeld, "Admitted \xE2\x80\x94 waiting for the paid run", 0, 0 },
	{ "dispatched", EMissionProgress::Dispatched, "Handed to Julius \xE2\x80\x94 waiting for it to start", 0, 0 },
	{ "running", EMissionProgress::Running, "Julius is working on the mission", 0, 0 },
	{ "paused", EMissionProgress::Paused, "Julius has paused the mission \xE2\x80\x94 waiting", 0, 0 },
	{ "waiting", EMissionProgress::Waiting, "Waiting for the bridge \xE2\x80\x94 no status it recognises yet", 0, 0 },
	{ "succeeded", EMissionProgress::Succeeded, "Julius reports the mission finished \xE2\x80\x94 checking the result", 1, 0 },
	{ "failed", EMissionProgress::Failed, "Julius reports the mission did not finish", 1, 0 },
	{ "refused", EMissionProgress::Refused, "The bridge refused the request \xE2\x80\x94 nothing was started", 1, 0 },
	{ "dispatch_failed", EMissionProgress::DispatchFailed, "The bridge ended this request before Julius reported a run", 1, 0 },
	{ "run_id_mismatch", EMissionProgress::RunIdMismatch, "Stopped \xE2\x80\x94 the bridge named a different run; nothing will be resent", 1, 0 },
	{ "answer_invalid", EMissionProgress::AnswerInvalid, "Stopped \xE2\x80\x94 the bridge's answer could not be checked; nothing will be resent", 1, 0 },
	{ "poll_limit_reached", EMissionProgress::PollLimitReached, "Stopped checking \xE2\x80\x94 the mission may still be going; ask the bridge", 1, 0 },
	// KAT-PROGRESS-DISPLAY-END
	};

	// P5. Budgets: Admission 21,600,000 ms (360 min), Run 19,800,000 ms (330 min); 120,000 ms waits from 1,800,000 ms
	// (30 min) into a phase. These come from .github/workflows/julius-first-live-mission.yml at this tree: the paid-slot
	// job's timeout-minutes: 350 (line 140) and the first-live-mission job's timeout-minutes: 300 (line 256, worst case
	// 17516316 ms = 291.9 min with 3 repair cycles, lines 245-252). wonderland-j1-progress.test.ts reads that file and
	// fails if either budget falls below it. There is no poll-count cap.
	struct FPollRow { const char* Label; std::uint32_t PollsSent; EPollPhase Phase; std::uint64_t WatchedMs; EPollStep Step; std::uint32_t DelayMs; };
	const FPollRow PollRows[] = {
	// KAT-POLL-BEGIN
	{ "schedule_0", 0, EPollPhase::Admission, 0, EPollStep::WaitThenPoll, 5000 },
	{ "schedule_1", 1, EPollPhase::Admission, 0, EPollStep::WaitThenPoll, 10000 },
	{ "schedule_2", 2, EPollPhase::Admission, 0, EPollStep::WaitThenPoll, 20000 },
	{ "schedule_3", 3, EPollPhase::Admission, 0, EPollStep::WaitThenPoll, 40000 },
	{ "cap_reached_4", 4, EPollPhase::Admission, 0, EPollStep::WaitThenPoll, 60000 },
	{ "cap_holds_5", 5, EPollPhase::Admission, 0, EPollStep::WaitThenPoll, 60000 },
	{ "cap_holds_100", 100, EPollPhase::Admission, 0, EPollStep::WaitThenPoll, 60000 },
	{ "no_count_cap_240", 240, EPollPhase::Admission, 0, EPollStep::WaitThenPoll, 60000 },
	{ "no_count_cap_far", 4294967295, EPollPhase::Admission, 0, EPollStep::WaitThenPoll, 60000 },
	{ "no_count_cap_far_run", 4294967295, EPollPhase::Run, 0, EPollStep::WaitThenPoll, 60000 },
	{ "fast_until_30_minutes", 10, EPollPhase::Admission, 1799999, EPollStep::WaitThenPoll, 60000 },
	{ "slow_at_30_minutes", 10, EPollPhase::Admission, 1800000, EPollStep::WaitThenPoll, 120000 },
	{ "slow_at_30_minutes_first_poll", 0, EPollPhase::Admission, 1800000, EPollStep::WaitThenPoll, 120000 },
	{ "admission_paid_slot_wait_350_min", 10, EPollPhase::Admission, 21000000, EPollStep::WaitThenPoll, 120000 },
	{ "admission_fits_exactly", 10, EPollPhase::Admission, 21480000, EPollStep::WaitThenPoll, 120000 },
	{ "admission_would_overrun", 10, EPollPhase::Admission, 21480001, EPollStep::Stop, 0 },
	{ "admission_at_limit", 0, EPollPhase::Admission, 21600000, EPollStep::Stop, 0 },
	{ "admission_past_limit", 0, EPollPhase::Admission, 21600001, EPollStep::Stop, 0 },
	{ "admission_far_past", 3, EPollPhase::Admission, 9007199254740991, EPollStep::Stop, 0 },
	{ "admission_old_three_hour_cap_gone", 10, EPollPhase::Admission, 10800000, EPollStep::WaitThenPoll, 120000 },
	{ "run_schedule_0", 0, EPollPhase::Run, 0, EPollStep::WaitThenPoll, 5000 },
	{ "run_backoff_continues", 3, EPollPhase::Run, 0, EPollStep::WaitThenPoll, 40000 },
	{ "run_fast_until_30_minutes", 10, EPollPhase::Run, 1799999, EPollStep::WaitThenPoll, 60000 },
	{ "run_slow_at_30_minutes", 10, EPollPhase::Run, 1800000, EPollStep::WaitThenPoll, 120000 },
	{ "run_live_job_worst_case_291_9_min", 10, EPollPhase::Run, 17516316, EPollStep::WaitThenPoll, 120000 },
	{ "run_live_job_timeout_300_min", 10, EPollPhase::Run, 18000000, EPollStep::WaitThenPoll, 120000 },
	{ "run_fits_exactly", 10, EPollPhase::Run, 19680000, EPollStep::WaitThenPoll, 120000 },
	{ "run_would_overrun", 10, EPollPhase::Run, 19680001, EPollStep::Stop, 0 },
	{ "run_at_limit", 0, EPollPhase::Run, 19800000, EPollStep::Stop, 0 },
	{ "run_past_limit", 0, EPollPhase::Run, 19800001, EPollStep::Stop, 0 },
	{ "run_budget_is_not_admission_budget", 10, EPollPhase::Run, 20000000, EPollStep::Stop, 0 },
	{ "admission_budget_is_not_run_budget", 10, EPollPhase::Admission, 20000000, EPollStep::WaitThenPoll, 120000 },
	{ "run_far_past", 3, EPollPhase::Run, 9007199254740991, EPollStep::Stop, 0 },
	// KAT-POLL-END
	};

	// P5: a wrapper that asks NextPollStep, waits its delay, polls (the poll takes RequestMs), records the answer, and
	// asks again. Answer "held" is a readable ADMISSION_HELD for the pinned run; "fail" is no answer. From poll
	// JuliusFromPoll on (1-based; 0 = never) every answer is instead a readable JuliusRun EXECUTING for the pinned run,
	// which opens the Run phase. It must reach PollLimitReached after exactly these polls and this much watched time.
	struct FPollRunRow { const char* Label; const char* Answer; std::uint32_t RequestMs; std::uint32_t JuliusFromPoll; std::uint32_t ExpectedPolls; std::uint64_t ExpectedWatchedMs; };
	const FPollRunRow PollRunRows[] = {
	// KAT-POLL-RUN-BEGIN
	{ "instant_held_admission_exhausted", "held", 0, 0, 197, 21495000 },
	{ "one_second_held_admission_exhausted", "held", 1000, 0, 196, 21571000 },
	{ "instant_failures_admission_exhausted", "fail", 0, 0, 197, 21495000 },
	{ "timeout_30s_failures", "fail", 30000, 0, 154, 21615000 },
	{ "timeout_60s_failures", "fail", 60000, 0, 126, 21495000 },
	{ "ten_minute_polls", "held", 600000, 0, 31, 21995000 },
	{ "one_poll_took_the_whole_watch", "fail", 21600000, 0, 1, 21605000 },
	{ "julius_from_first_poll", "held", 0, 1, 182, 19695000 },
	{ "julius_from_first_poll_one_second", "held", 1000, 1, 181, 19756000 },
	{ "julius_after_three_hours_held", "held", 0, 108, 288, 30615000 },
	{ "julius_after_paid_slot_wait", "held", 0, 193, 373, 40815000 },
	{ "julius_at_last_admission_poll", "held", 0, 197, 377, 41295000 },
	{ "julius_after_failures", "fail", 30000, 40, 180, 24315000 },
	// KAT-POLL-RUN-END
	};

	struct FScriptRow { const char* Label; const char* Script; EMissionProgress Final; const char* LastEvent; const char* Pinned; int bSendAllowed; };
	const FScriptRow ScriptRows[] = {
	// KAT-PROGRESS-SCRIPT-BEGIN
	{ "start_only", "", EMissionProgress::AwaitingDispatchAnswer, "started", "none", 1 },
	{ "no_answer_transport", "D0", EMissionProgress::AwaitingDispatchAnswer, "dispatch_unanswered", "none", 1 },
	{ "no_answer_busy_429", "D,429,julius_dispatch_busy,none,none,-", EMissionProgress::AwaitingDispatchAnswer, "dispatch_unanswered", "none", 1 },
	{ "no_answer_bare_500", "D,500,-,none,none,-", EMissionProgress::AwaitingDispatchAnswer, "dispatch_unanswered", "none", 1 },
	{ "no_answer_kind_on_200", "D,200,julius_dispatch_busy,ok,S1,ADMISSION_HELD", EMissionProgress::AwaitingDispatchAnswer, "dispatch_unanswered", "none", 1 },
	{ "poll_before_accepted", "P,200,-,J,none,S1,EXECUTING", EMissionProgress::AwaitingDispatchAnswer, "poll_failed", "none", 1 },
	{ "next_poll_before_accepted", "N,0", EMissionProgress::AwaitingDispatchAnswer, "started", "none", 1 },
	{ "refused_already_dispatched_409", "D,409,julius_dispatch_already_dispatched,none,none,-", EMissionProgress::Refused, "dispatch_refused", "none", 0 },
	{ "refused_key_reused_409", "D,409,julius_dispatch_key_reused,none,none,-", EMissionProgress::Refused, "dispatch_refused", "none", 0 },
	{ "refused_founder_only_403", "D,403,julius_dispatch_founder_only,none,none,-", EMissionProgress::Refused, "dispatch_refused", "none", 0 },
	{ "refused_disabled_503", "D,503,julius_dispatch_disabled,none,none,-", EMissionProgress::Refused, "dispatch_refused", "none", 0 },
	{ "refused_cap_429", "D,429,julius_dispatch_cap_reached,none,none,-", EMissionProgress::Refused, "dispatch_refused", "none", 0 },
	{ "refused_after_no_answer", "D0 D,409,julius_dispatch_key_reused,none,none,-", EMissionProgress::Refused, "dispatch_refused", "none", 0 },
	{ "accepted_held_202", "D,202,-,ok,S1,ADMISSION_HELD", EMissionProgress::AdmittedHeld, "admitted", "S1", 0 },
	{ "accepted_reserved_200", "D,200,-,ok,S1,RESERVED", EMissionProgress::AdmittedHeld, "admitted", "S1", 0 },
	{ "accepted_ledger_unwritten_202", "D,202,-,ok,S1,LEDGER_UNWRITTEN", EMissionProgress::AdmittedHeld, "admitted", "S1", 0 },
	{ "accepted_interrupted", "D,200,-,ok,S1,INTERRUPTED", EMissionProgress::DispatchFailed, "admitted", "S1", 0 },
	{ "accepted_failed", "D,200,-,ok,S1,FAILED", EMissionProgress::DispatchFailed, "admitted", "S1", 0 },
	{ "accepted_unknown_state", "D,202,-,ok,S1,QUEUED", EMissionProgress::Waiting, "admitted", "S1", 0 },
	{ "accepted_lowercase_state", "D,202,-,ok,S1,admission_held", EMissionProgress::Waiting, "admitted", "S1", 0 },
	{ "accepted_padded_state", "D,202,-,ok,S1,ADMISSION_HELD_", EMissionProgress::Waiting, "admitted", "S1", 0 },
	{ "accepted_empty_state", "D,202,-,ok,S1,-", EMissionProgress::Waiting, "admitted", "S1", 0 },
	{ "accepted_julius_word_is_not_admission", "D,202,-,ok,S1,EXECUTING", EMissionProgress::Waiting, "admitted", "S1", 0 },
	{ "accepted_julius_completed_is_not_admission", "D,202,-,ok,S1,COMPLETED", EMissionProgress::Waiting, "admitted", "S1", 0 },
	{ "accepted_no_data", "D,202,-,nodata,none,-", EMissionProgress::AnswerInvalid, "answer_rejected", "none", 0 },
	{ "accepted_no_server_run_id", "D,202,-,ok,none,ADMISSION_HELD", EMissionProgress::AnswerInvalid, "answer_rejected", "none", 0 },
	{ "accepted_upper_hex_server_run_id", "D,202,-,ok,bad,ADMISSION_HELD", EMissionProgress::AnswerInvalid, "answer_rejected", "none", 0 },
	{ "accepted_short_server_run_id", "D,202,-,ok,short,ADMISSION_HELD", EMissionProgress::AnswerInvalid, "answer_rejected", "none", 0 },
	{ "accepted_no_client_run_id", "D,202,-,none,S1,ADMISSION_HELD", EMissionProgress::AnswerInvalid, "answer_rejected", "none", 0 },
	{ "accepted_other_client_run_id", "D,202,-,other,S1,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "run_id_mismatched", "none", 0 },
	{ "accepted_after_no_answer", "D0 D,200,-,ok,S1,ADMISSION_HELD", EMissionProgress::AdmittedHeld, "admitted", "S1", 0 },
	{ "accepted_after_busy", "D,429,julius_dispatch_busy,none,none,- D,200,-,ok,S1,RESERVED", EMissionProgress::AdmittedHeld, "admitted", "S1", 0 },
	{ "held_to_held_admission", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,A,ok,S1,ADMISSION_HELD", EMissionProgress::AdmittedHeld, "status_applied", "S1", 0 },
	{ "held_to_reserved_admission", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,A,ok,S1,RESERVED", EMissionProgress::AdmittedHeld, "status_applied", "S1", 0 },
	{ "held_to_dispatched_created", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED", EMissionProgress::Dispatched, "status_applied", "S1", 0 },
	{ "held_to_dispatched_planning", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,PLANNING", EMissionProgress::Dispatched, "status_applied", "S1", 0 },
	{ "held_to_dispatched_ready", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,READY", EMissionProgress::Dispatched, "status_applied", "S1", 0 },
	{ "held_to_running_executing", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "held_to_running_waiting", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,WAITING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "held_to_running_reviewing", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,REVIEWING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "held_to_running_repairing", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,REPAIRING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "held_to_running_verifying", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,VERIFYING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "held_to_paused_blocked", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED", EMissionProgress::Paused, "status_applied", "S1", 0 },
	{ "held_to_paused_paused", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,PAUSED", EMissionProgress::Paused, "status_applied", "S1", 0 },
	{ "held_to_waiting_unknown", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "held_to_waiting_lowercase", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,completed", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "held_to_waiting_unknown_vocabulary", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,U,none,S1,COMPLETED", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "held_to_waiting_admission_word_in_julius", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,ADMISSION_HELD", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "held_to_succeeded_completed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,COMPLETED", EMissionProgress::Succeeded, "status_applied", "S1", 0 },
	{ "held_to_failed_failed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,FAILED", EMissionProgress::Failed, "status_applied", "S1", 0 },
	{ "held_to_failed_cancelled", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CANCELLED", EMissionProgress::Failed, "status_applied", "S1", 0 },
	{ "held_to_dispatch_failed_interrupted", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,A,ok,S1,INTERRUPTED", EMissionProgress::DispatchFailed, "status_applied", "S1", 0 },
	{ "held_to_dispatch_failed_failed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,A,ok,S1,FAILED", EMissionProgress::DispatchFailed, "status_applied", "S1", 0 },
	{ "held_poll_transport_failure", "D,202,-,ok,S1,ADMISSION_HELD P0", EMissionProgress::AdmittedHeld, "poll_failed", "S1", 0 },
	{ "held_poll_bare_500", "D,202,-,ok,S1,ADMISSION_HELD P,500,-,J,none,none,-", EMissionProgress::AdmittedHeld, "poll_failed", "S1", 0 },
	{ "held_poll_run_not_found_404", "D,202,-,ok,S1,ADMISSION_HELD P,404,run_not_found,J,none,none,-", EMissionProgress::AdmittedHeld, "poll_failed", "S1", 0 },
	{ "held_poll_operator_required_401", "D,202,-,ok,S1,ADMISSION_HELD P,401,operator_required,J,none,none,-", EMissionProgress::AdmittedHeld, "poll_failed", "S1", 0 },
	{ "held_poll_state_unavailable_503", "D,202,-,ok,S1,ADMISSION_HELD P,503,julius_state_unavailable,J,none,none,-", EMissionProgress::AdmittedHeld, "poll_failed", "S1", 0 },
	{ "held_poll_already_dispatched_409", "D,202,-,ok,S1,ADMISSION_HELD P,409,julius_dispatch_already_dispatched,A,none,none,-", EMissionProgress::AdmittedHeld, "poll_failed", "S1", 0 },
	{ "held_poll_error_without_kind_on_200", "D,202,-,ok,S1,ADMISSION_HELD P,200,~,J,none,S1,COMPLETED", EMissionProgress::AdmittedHeld, "poll_failed", "S1", 0 },
	{ "held_poll_kind_on_200", "D,202,-,ok,S1,ADMISSION_HELD P,200,julius_dispatch_busy,J,none,S1,COMPLETED", EMissionProgress::AdmittedHeld, "poll_failed", "S1", 0 },
	{ "held_poll_302", "D,202,-,ok,S1,ADMISSION_HELD P,302,-,J,none,S1,COMPLETED", EMissionProgress::AdmittedHeld, "poll_failed", "S1", 0 },
	{ "held_poll_no_data", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,nodata,none,-", EMissionProgress::AdmittedHeld, "poll_failed", "S1", 0 },
	{ "held_poll_no_server_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,none,COMPLETED", EMissionProgress::AdmittedHeld, "poll_failed", "S1", 0 },
	{ "held_poll_admission_without_client_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,A,none,S1,FAILED", EMissionProgress::AdmittedHeld, "poll_failed", "S1", 0 },
	{ "held_mismatch_server_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S2,EXECUTING", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "held_mismatch_server_run_id_case", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,bad,COMPLETED", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "held_mismatch_client_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,A,other,S1,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "held_mismatch_on_julius_client_field", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,other,S1,COMPLETED", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "held_late_replay", "D,202,-,ok,S1,ADMISSION_HELD D,200,-,ok,S1,RESERVED", EMissionProgress::AdmittedHeld, "dispatch_replayed", "S1", 0 },
	{ "held_late_replay_interrupted", "D,202,-,ok,S1,ADMISSION_HELD D,200,-,ok,S1,INTERRUPTED", EMissionProgress::DispatchFailed, "dispatch_replayed", "S1", 0 },
	{ "held_late_replay_other_server_run_id", "D,202,-,ok,S1,ADMISSION_HELD D,200,-,ok,S2,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "held_late_replay_other_client_run_id", "D,202,-,ok,S1,ADMISSION_HELD D,200,-,other,S1,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "held_late_replay_no_data", "D,202,-,ok,S1,ADMISSION_HELD D,200,-,nodata,none,-", EMissionProgress::AdmittedHeld, "late_dispatch_answer_ignored", "S1", 0 },
	{ "held_late_no_answer", "D,202,-,ok,S1,ADMISSION_HELD D0", EMissionProgress::AdmittedHeld, "late_dispatch_answer_ignored", "S1", 0 },
	{ "held_late_busy", "D,202,-,ok,S1,ADMISSION_HELD D,429,julius_dispatch_busy,none,none,-", EMissionProgress::AdmittedHeld, "late_dispatch_answer_ignored", "S1", 0 },
	{ "held_late_refusal", "D,202,-,ok,S1,ADMISSION_HELD D,409,julius_dispatch_already_dispatched,none,none,-", EMissionProgress::AdmittedHeld, "late_dispatch_answer_ignored", "S1", 0 },
	{ "held_next_poll_in_budget", "D,202,-,ok,S1,ADMISSION_HELD N,0", EMissionProgress::AdmittedHeld, "admitted", "S1", 0 },
	{ "held_next_poll_over_budget", "D,202,-,ok,S1,ADMISSION_HELD N,21600000", EMissionProgress::PollLimitReached, "poll_limit_reached", "S1", 0 },
	{ "dispatched_to_held_admission", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,A,ok,S1,ADMISSION_HELD", EMissionProgress::Dispatched, "admission_answer_logged", "S1", 0 },
	{ "dispatched_to_reserved_admission", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,A,ok,S1,RESERVED", EMissionProgress::Dispatched, "admission_answer_logged", "S1", 0 },
	{ "dispatched_to_dispatched_created", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,S1,CREATED", EMissionProgress::Dispatched, "status_applied", "S1", 0 },
	{ "dispatched_to_dispatched_planning", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,S1,PLANNING", EMissionProgress::Dispatched, "status_applied", "S1", 0 },
	{ "dispatched_to_dispatched_ready", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,S1,READY", EMissionProgress::Dispatched, "status_applied", "S1", 0 },
	{ "dispatched_to_running_executing", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,S1,EXECUTING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "dispatched_to_running_waiting", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,S1,WAITING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "dispatched_to_running_reviewing", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,S1,REVIEWING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "dispatched_to_running_repairing", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,S1,REPAIRING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "dispatched_to_running_verifying", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,S1,VERIFYING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "dispatched_to_paused_blocked", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,S1,BLOCKED", EMissionProgress::Paused, "status_applied", "S1", 0 },
	{ "dispatched_to_paused_paused", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,S1,PAUSED", EMissionProgress::Paused, "status_applied", "S1", 0 },
	{ "dispatched_to_waiting_unknown", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,S1,DONE", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "dispatched_to_waiting_lowercase", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,S1,completed", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "dispatched_to_waiting_unknown_vocabulary", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,U,none,S1,COMPLETED", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "dispatched_to_waiting_admission_word_in_julius", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,S1,ADMISSION_HELD", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "dispatched_to_succeeded_completed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,S1,COMPLETED", EMissionProgress::Succeeded, "status_applied", "S1", 0 },
	{ "dispatched_to_failed_failed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,S1,FAILED", EMissionProgress::Failed, "status_applied", "S1", 0 },
	{ "dispatched_to_failed_cancelled", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,S1,CANCELLED", EMissionProgress::Failed, "status_applied", "S1", 0 },
	{ "dispatched_to_dispatch_failed_interrupted", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,A,ok,S1,INTERRUPTED", EMissionProgress::Dispatched, "admission_answer_logged", "S1", 0 },
	{ "dispatched_to_dispatch_failed_failed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,A,ok,S1,FAILED", EMissionProgress::Dispatched, "admission_answer_logged", "S1", 0 },
	{ "dispatched_poll_transport_failure", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P0", EMissionProgress::Dispatched, "poll_failed", "S1", 0 },
	{ "dispatched_poll_bare_500", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,500,-,J,none,none,-", EMissionProgress::Dispatched, "poll_failed", "S1", 0 },
	{ "dispatched_poll_run_not_found_404", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,404,run_not_found,J,none,none,-", EMissionProgress::Dispatched, "poll_failed", "S1", 0 },
	{ "dispatched_poll_operator_required_401", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,401,operator_required,J,none,none,-", EMissionProgress::Dispatched, "poll_failed", "S1", 0 },
	{ "dispatched_poll_state_unavailable_503", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,503,julius_state_unavailable,J,none,none,-", EMissionProgress::Dispatched, "poll_failed", "S1", 0 },
	{ "dispatched_poll_already_dispatched_409", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,409,julius_dispatch_already_dispatched,A,none,none,-", EMissionProgress::Dispatched, "poll_failed", "S1", 0 },
	{ "dispatched_poll_error_without_kind_on_200", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,~,J,none,S1,COMPLETED", EMissionProgress::Dispatched, "poll_failed", "S1", 0 },
	{ "dispatched_poll_kind_on_200", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,julius_dispatch_busy,J,none,S1,COMPLETED", EMissionProgress::Dispatched, "poll_failed", "S1", 0 },
	{ "dispatched_poll_302", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,302,-,J,none,S1,COMPLETED", EMissionProgress::Dispatched, "poll_failed", "S1", 0 },
	{ "dispatched_poll_no_data", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,nodata,none,-", EMissionProgress::Dispatched, "poll_failed", "S1", 0 },
	{ "dispatched_poll_no_server_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,none,COMPLETED", EMissionProgress::Dispatched, "poll_failed", "S1", 0 },
	{ "dispatched_poll_admission_without_client_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,A,none,S1,FAILED", EMissionProgress::Dispatched, "poll_failed", "S1", 0 },
	{ "dispatched_mismatch_server_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,S2,EXECUTING", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "dispatched_mismatch_server_run_id_case", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,none,bad,COMPLETED", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "dispatched_mismatch_client_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,A,other,S1,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "dispatched_mismatch_on_julius_client_field", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED P,200,-,J,other,S1,COMPLETED", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "dispatched_late_replay", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED D,200,-,ok,S1,RESERVED", EMissionProgress::Dispatched, "admission_answer_logged", "S1", 0 },
	{ "dispatched_late_replay_interrupted", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED D,200,-,ok,S1,INTERRUPTED", EMissionProgress::Dispatched, "admission_answer_logged", "S1", 0 },
	{ "dispatched_late_replay_other_server_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED D,200,-,ok,S2,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "dispatched_late_replay_other_client_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED D,200,-,other,S1,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "dispatched_late_replay_no_data", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED D,200,-,nodata,none,-", EMissionProgress::Dispatched, "late_dispatch_answer_ignored", "S1", 0 },
	{ "dispatched_late_no_answer", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED D0", EMissionProgress::Dispatched, "late_dispatch_answer_ignored", "S1", 0 },
	{ "dispatched_late_busy", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED D,429,julius_dispatch_busy,none,none,-", EMissionProgress::Dispatched, "late_dispatch_answer_ignored", "S1", 0 },
	{ "dispatched_late_refusal", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED D,409,julius_dispatch_already_dispatched,none,none,-", EMissionProgress::Dispatched, "late_dispatch_answer_ignored", "S1", 0 },
	{ "dispatched_next_poll_in_budget", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED N,0", EMissionProgress::Dispatched, "status_applied", "S1", 0 },
	{ "dispatched_next_poll_over_budget", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED N,0 N,19800000", EMissionProgress::PollLimitReached, "poll_limit_reached", "S1", 0 },
	{ "running_to_held_admission", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,A,ok,S1,ADMISSION_HELD", EMissionProgress::Running, "admission_answer_logged", "S1", 0 },
	{ "running_to_reserved_admission", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,A,ok,S1,RESERVED", EMissionProgress::Running, "admission_answer_logged", "S1", 0 },
	{ "running_to_dispatched_created", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,S1,CREATED", EMissionProgress::Dispatched, "status_applied", "S1", 0 },
	{ "running_to_dispatched_planning", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,S1,PLANNING", EMissionProgress::Dispatched, "status_applied", "S1", 0 },
	{ "running_to_dispatched_ready", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,S1,READY", EMissionProgress::Dispatched, "status_applied", "S1", 0 },
	{ "running_to_running_executing", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,S1,EXECUTING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "running_to_running_waiting", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,S1,WAITING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "running_to_running_reviewing", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,S1,REVIEWING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "running_to_running_repairing", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,S1,REPAIRING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "running_to_running_verifying", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,S1,VERIFYING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "running_to_paused_blocked", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,S1,BLOCKED", EMissionProgress::Paused, "status_applied", "S1", 0 },
	{ "running_to_paused_paused", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,S1,PAUSED", EMissionProgress::Paused, "status_applied", "S1", 0 },
	{ "running_to_waiting_unknown", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,S1,DONE", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "running_to_waiting_lowercase", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,S1,completed", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "running_to_waiting_unknown_vocabulary", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,U,none,S1,COMPLETED", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "running_to_waiting_admission_word_in_julius", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,S1,ADMISSION_HELD", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "running_to_succeeded_completed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,S1,COMPLETED", EMissionProgress::Succeeded, "status_applied", "S1", 0 },
	{ "running_to_failed_failed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,S1,FAILED", EMissionProgress::Failed, "status_applied", "S1", 0 },
	{ "running_to_failed_cancelled", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,S1,CANCELLED", EMissionProgress::Failed, "status_applied", "S1", 0 },
	{ "running_to_dispatch_failed_interrupted", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,A,ok,S1,INTERRUPTED", EMissionProgress::Running, "admission_answer_logged", "S1", 0 },
	{ "running_to_dispatch_failed_failed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,A,ok,S1,FAILED", EMissionProgress::Running, "admission_answer_logged", "S1", 0 },
	{ "running_poll_transport_failure", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P0", EMissionProgress::Running, "poll_failed", "S1", 0 },
	{ "running_poll_bare_500", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,500,-,J,none,none,-", EMissionProgress::Running, "poll_failed", "S1", 0 },
	{ "running_poll_run_not_found_404", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,404,run_not_found,J,none,none,-", EMissionProgress::Running, "poll_failed", "S1", 0 },
	{ "running_poll_operator_required_401", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,401,operator_required,J,none,none,-", EMissionProgress::Running, "poll_failed", "S1", 0 },
	{ "running_poll_state_unavailable_503", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,503,julius_state_unavailable,J,none,none,-", EMissionProgress::Running, "poll_failed", "S1", 0 },
	{ "running_poll_already_dispatched_409", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,409,julius_dispatch_already_dispatched,A,none,none,-", EMissionProgress::Running, "poll_failed", "S1", 0 },
	{ "running_poll_error_without_kind_on_200", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,~,J,none,S1,COMPLETED", EMissionProgress::Running, "poll_failed", "S1", 0 },
	{ "running_poll_kind_on_200", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,julius_dispatch_busy,J,none,S1,COMPLETED", EMissionProgress::Running, "poll_failed", "S1", 0 },
	{ "running_poll_302", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,302,-,J,none,S1,COMPLETED", EMissionProgress::Running, "poll_failed", "S1", 0 },
	{ "running_poll_no_data", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,nodata,none,-", EMissionProgress::Running, "poll_failed", "S1", 0 },
	{ "running_poll_no_server_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,none,COMPLETED", EMissionProgress::Running, "poll_failed", "S1", 0 },
	{ "running_poll_admission_without_client_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,A,none,S1,FAILED", EMissionProgress::Running, "poll_failed", "S1", 0 },
	{ "running_mismatch_server_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,S2,EXECUTING", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "running_mismatch_server_run_id_case", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,bad,COMPLETED", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "running_mismatch_client_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,A,other,S1,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "running_mismatch_on_julius_client_field", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,other,S1,COMPLETED", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "running_late_replay", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING D,200,-,ok,S1,RESERVED", EMissionProgress::Running, "admission_answer_logged", "S1", 0 },
	{ "running_late_replay_interrupted", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING D,200,-,ok,S1,INTERRUPTED", EMissionProgress::Running, "admission_answer_logged", "S1", 0 },
	{ "running_late_replay_other_server_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING D,200,-,ok,S2,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "running_late_replay_other_client_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING D,200,-,other,S1,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "running_late_replay_no_data", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING D,200,-,nodata,none,-", EMissionProgress::Running, "late_dispatch_answer_ignored", "S1", 0 },
	{ "running_late_no_answer", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING D0", EMissionProgress::Running, "late_dispatch_answer_ignored", "S1", 0 },
	{ "running_late_busy", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING D,429,julius_dispatch_busy,none,none,-", EMissionProgress::Running, "late_dispatch_answer_ignored", "S1", 0 },
	{ "running_late_refusal", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING D,409,julius_dispatch_already_dispatched,none,none,-", EMissionProgress::Running, "late_dispatch_answer_ignored", "S1", 0 },
	{ "running_next_poll_in_budget", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING N,0", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "running_next_poll_over_budget", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING N,0 N,19800000", EMissionProgress::PollLimitReached, "poll_limit_reached", "S1", 0 },
	{ "paused_to_held_admission", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,A,ok,S1,ADMISSION_HELD", EMissionProgress::Paused, "admission_answer_logged", "S1", 0 },
	{ "paused_to_reserved_admission", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,A,ok,S1,RESERVED", EMissionProgress::Paused, "admission_answer_logged", "S1", 0 },
	{ "paused_to_dispatched_created", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,S1,CREATED", EMissionProgress::Dispatched, "status_applied", "S1", 0 },
	{ "paused_to_dispatched_planning", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,S1,PLANNING", EMissionProgress::Dispatched, "status_applied", "S1", 0 },
	{ "paused_to_dispatched_ready", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,S1,READY", EMissionProgress::Dispatched, "status_applied", "S1", 0 },
	{ "paused_to_running_executing", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,S1,EXECUTING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "paused_to_running_waiting", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,S1,WAITING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "paused_to_running_reviewing", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,S1,REVIEWING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "paused_to_running_repairing", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,S1,REPAIRING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "paused_to_running_verifying", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,S1,VERIFYING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "paused_to_paused_blocked", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,S1,BLOCKED", EMissionProgress::Paused, "status_applied", "S1", 0 },
	{ "paused_to_paused_paused", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,S1,PAUSED", EMissionProgress::Paused, "status_applied", "S1", 0 },
	{ "paused_to_waiting_unknown", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,S1,DONE", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "paused_to_waiting_lowercase", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,S1,completed", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "paused_to_waiting_unknown_vocabulary", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,U,none,S1,COMPLETED", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "paused_to_waiting_admission_word_in_julius", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,S1,ADMISSION_HELD", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "paused_to_succeeded_completed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,S1,COMPLETED", EMissionProgress::Succeeded, "status_applied", "S1", 0 },
	{ "paused_to_failed_failed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,S1,FAILED", EMissionProgress::Failed, "status_applied", "S1", 0 },
	{ "paused_to_failed_cancelled", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,S1,CANCELLED", EMissionProgress::Failed, "status_applied", "S1", 0 },
	{ "paused_to_dispatch_failed_interrupted", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,A,ok,S1,INTERRUPTED", EMissionProgress::Paused, "admission_answer_logged", "S1", 0 },
	{ "paused_to_dispatch_failed_failed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,A,ok,S1,FAILED", EMissionProgress::Paused, "admission_answer_logged", "S1", 0 },
	{ "paused_poll_transport_failure", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P0", EMissionProgress::Paused, "poll_failed", "S1", 0 },
	{ "paused_poll_bare_500", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,500,-,J,none,none,-", EMissionProgress::Paused, "poll_failed", "S1", 0 },
	{ "paused_poll_run_not_found_404", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,404,run_not_found,J,none,none,-", EMissionProgress::Paused, "poll_failed", "S1", 0 },
	{ "paused_poll_operator_required_401", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,401,operator_required,J,none,none,-", EMissionProgress::Paused, "poll_failed", "S1", 0 },
	{ "paused_poll_state_unavailable_503", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,503,julius_state_unavailable,J,none,none,-", EMissionProgress::Paused, "poll_failed", "S1", 0 },
	{ "paused_poll_already_dispatched_409", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,409,julius_dispatch_already_dispatched,A,none,none,-", EMissionProgress::Paused, "poll_failed", "S1", 0 },
	{ "paused_poll_error_without_kind_on_200", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,~,J,none,S1,COMPLETED", EMissionProgress::Paused, "poll_failed", "S1", 0 },
	{ "paused_poll_kind_on_200", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,julius_dispatch_busy,J,none,S1,COMPLETED", EMissionProgress::Paused, "poll_failed", "S1", 0 },
	{ "paused_poll_302", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,302,-,J,none,S1,COMPLETED", EMissionProgress::Paused, "poll_failed", "S1", 0 },
	{ "paused_poll_no_data", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,nodata,none,-", EMissionProgress::Paused, "poll_failed", "S1", 0 },
	{ "paused_poll_no_server_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,none,COMPLETED", EMissionProgress::Paused, "poll_failed", "S1", 0 },
	{ "paused_poll_admission_without_client_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,A,none,S1,FAILED", EMissionProgress::Paused, "poll_failed", "S1", 0 },
	{ "paused_mismatch_server_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,S2,EXECUTING", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "paused_mismatch_server_run_id_case", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,none,bad,COMPLETED", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "paused_mismatch_client_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,A,other,S1,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "paused_mismatch_on_julius_client_field", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED P,200,-,J,other,S1,COMPLETED", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "paused_late_replay", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED D,200,-,ok,S1,RESERVED", EMissionProgress::Paused, "admission_answer_logged", "S1", 0 },
	{ "paused_late_replay_interrupted", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED D,200,-,ok,S1,INTERRUPTED", EMissionProgress::Paused, "admission_answer_logged", "S1", 0 },
	{ "paused_late_replay_other_server_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED D,200,-,ok,S2,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "paused_late_replay_other_client_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED D,200,-,other,S1,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "paused_late_replay_no_data", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED D,200,-,nodata,none,-", EMissionProgress::Paused, "late_dispatch_answer_ignored", "S1", 0 },
	{ "paused_late_no_answer", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED D0", EMissionProgress::Paused, "late_dispatch_answer_ignored", "S1", 0 },
	{ "paused_late_busy", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED D,429,julius_dispatch_busy,none,none,-", EMissionProgress::Paused, "late_dispatch_answer_ignored", "S1", 0 },
	{ "paused_late_refusal", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED D,409,julius_dispatch_already_dispatched,none,none,-", EMissionProgress::Paused, "late_dispatch_answer_ignored", "S1", 0 },
	{ "paused_next_poll_in_budget", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED N,0", EMissionProgress::Paused, "status_applied", "S1", 0 },
	{ "paused_next_poll_over_budget", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,BLOCKED N,0 N,19800000", EMissionProgress::PollLimitReached, "poll_limit_reached", "S1", 0 },
	{ "waiting_to_held_admission", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,A,ok,S1,ADMISSION_HELD", EMissionProgress::Waiting, "admission_answer_logged", "S1", 0 },
	{ "waiting_to_reserved_admission", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,A,ok,S1,RESERVED", EMissionProgress::Waiting, "admission_answer_logged", "S1", 0 },
	{ "waiting_to_dispatched_created", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,S1,CREATED", EMissionProgress::Dispatched, "status_applied", "S1", 0 },
	{ "waiting_to_dispatched_planning", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,S1,PLANNING", EMissionProgress::Dispatched, "status_applied", "S1", 0 },
	{ "waiting_to_dispatched_ready", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,S1,READY", EMissionProgress::Dispatched, "status_applied", "S1", 0 },
	{ "waiting_to_running_executing", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,S1,EXECUTING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "waiting_to_running_waiting", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,S1,WAITING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "waiting_to_running_reviewing", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,S1,REVIEWING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "waiting_to_running_repairing", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,S1,REPAIRING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "waiting_to_running_verifying", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,S1,VERIFYING", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "waiting_to_paused_blocked", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,S1,BLOCKED", EMissionProgress::Paused, "status_applied", "S1", 0 },
	{ "waiting_to_paused_paused", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,S1,PAUSED", EMissionProgress::Paused, "status_applied", "S1", 0 },
	{ "waiting_to_waiting_unknown", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,S1,DONE", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "waiting_to_waiting_lowercase", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,S1,completed", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "waiting_to_waiting_unknown_vocabulary", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,U,none,S1,COMPLETED", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "waiting_to_waiting_admission_word_in_julius", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,S1,ADMISSION_HELD", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "waiting_to_succeeded_completed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,S1,COMPLETED", EMissionProgress::Succeeded, "status_applied", "S1", 0 },
	{ "waiting_to_failed_failed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,S1,FAILED", EMissionProgress::Failed, "status_applied", "S1", 0 },
	{ "waiting_to_failed_cancelled", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,S1,CANCELLED", EMissionProgress::Failed, "status_applied", "S1", 0 },
	{ "waiting_to_dispatch_failed_interrupted", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,A,ok,S1,INTERRUPTED", EMissionProgress::Waiting, "admission_answer_logged", "S1", 0 },
	{ "waiting_to_dispatch_failed_failed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,A,ok,S1,FAILED", EMissionProgress::Waiting, "admission_answer_logged", "S1", 0 },
	{ "waiting_poll_transport_failure", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P0", EMissionProgress::Waiting, "poll_failed", "S1", 0 },
	{ "waiting_poll_bare_500", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,500,-,J,none,none,-", EMissionProgress::Waiting, "poll_failed", "S1", 0 },
	{ "waiting_poll_run_not_found_404", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,404,run_not_found,J,none,none,-", EMissionProgress::Waiting, "poll_failed", "S1", 0 },
	{ "waiting_poll_operator_required_401", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,401,operator_required,J,none,none,-", EMissionProgress::Waiting, "poll_failed", "S1", 0 },
	{ "waiting_poll_state_unavailable_503", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,503,julius_state_unavailable,J,none,none,-", EMissionProgress::Waiting, "poll_failed", "S1", 0 },
	{ "waiting_poll_already_dispatched_409", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,409,julius_dispatch_already_dispatched,A,none,none,-", EMissionProgress::Waiting, "poll_failed", "S1", 0 },
	{ "waiting_poll_error_without_kind_on_200", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,~,J,none,S1,COMPLETED", EMissionProgress::Waiting, "poll_failed", "S1", 0 },
	{ "waiting_poll_kind_on_200", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,julius_dispatch_busy,J,none,S1,COMPLETED", EMissionProgress::Waiting, "poll_failed", "S1", 0 },
	{ "waiting_poll_302", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,302,-,J,none,S1,COMPLETED", EMissionProgress::Waiting, "poll_failed", "S1", 0 },
	{ "waiting_poll_no_data", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,nodata,none,-", EMissionProgress::Waiting, "poll_failed", "S1", 0 },
	{ "waiting_poll_no_server_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,none,COMPLETED", EMissionProgress::Waiting, "poll_failed", "S1", 0 },
	{ "waiting_poll_admission_without_client_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,A,none,S1,FAILED", EMissionProgress::Waiting, "poll_failed", "S1", 0 },
	{ "waiting_mismatch_server_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,S2,EXECUTING", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "waiting_mismatch_server_run_id_case", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,none,bad,COMPLETED", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "waiting_mismatch_client_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,A,other,S1,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "waiting_mismatch_on_julius_client_field", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,J,other,S1,COMPLETED", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "waiting_late_replay", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE D,200,-,ok,S1,RESERVED", EMissionProgress::Waiting, "admission_answer_logged", "S1", 0 },
	{ "waiting_late_replay_interrupted", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE D,200,-,ok,S1,INTERRUPTED", EMissionProgress::Waiting, "admission_answer_logged", "S1", 0 },
	{ "waiting_late_replay_other_server_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE D,200,-,ok,S2,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "waiting_late_replay_other_client_run_id", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE D,200,-,other,S1,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "waiting_late_replay_no_data", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE D,200,-,nodata,none,-", EMissionProgress::Waiting, "late_dispatch_answer_ignored", "S1", 0 },
	{ "waiting_late_no_answer", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE D0", EMissionProgress::Waiting, "late_dispatch_answer_ignored", "S1", 0 },
	{ "waiting_late_busy", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE D,429,julius_dispatch_busy,none,none,-", EMissionProgress::Waiting, "late_dispatch_answer_ignored", "S1", 0 },
	{ "waiting_late_refusal", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE D,409,julius_dispatch_already_dispatched,none,none,-", EMissionProgress::Waiting, "late_dispatch_answer_ignored", "S1", 0 },
	{ "waiting_next_poll_in_budget", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE N,0", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "waiting_next_poll_over_budget", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE N,0 N,19800000", EMissionProgress::PollLimitReached, "poll_limit_reached", "S1", 0 },
	{ "sticky_succeeded_then_accepted", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,COMPLETED D,202,-,ok,S1,ADMISSION_HELD", EMissionProgress::Succeeded, "ignored_after_terminal", "S1", 0 },
	{ "sticky_succeeded_then_accepted_other_run", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,COMPLETED D,200,-,ok,S2,RESERVED", EMissionProgress::Succeeded, "ignored_after_terminal", "S1", 0 },
	{ "sticky_succeeded_then_no_answer", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,COMPLETED D0", EMissionProgress::Succeeded, "ignored_after_terminal", "S1", 0 },
	{ "sticky_succeeded_then_refusal", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,COMPLETED D,409,julius_dispatch_already_dispatched,none,none,-", EMissionProgress::Succeeded, "ignored_after_terminal", "S1", 0 },
	{ "sticky_succeeded_then_running", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,COMPLETED P,200,-,J,none,S1,EXECUTING", EMissionProgress::Succeeded, "ignored_after_terminal", "S1", 0 },
	{ "sticky_succeeded_then_completed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,COMPLETED P,200,-,J,none,S1,COMPLETED", EMissionProgress::Succeeded, "ignored_after_terminal", "S1", 0 },
	{ "sticky_succeeded_then_admission_held", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,COMPLETED P,200,-,A,ok,S1,ADMISSION_HELD", EMissionProgress::Succeeded, "ignored_after_terminal", "S1", 0 },
	{ "sticky_succeeded_then_other_run", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,COMPLETED P,200,-,J,none,S2,FAILED", EMissionProgress::Succeeded, "ignored_after_terminal", "S1", 0 },
	{ "sticky_succeeded_then_poll_failure", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,COMPLETED P0", EMissionProgress::Succeeded, "ignored_after_terminal", "S1", 0 },
	{ "sticky_succeeded_then_everything", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,COMPLETED N,0 D,202,-,ok,S1,ADMISSION_HELD D0 P,200,-,J,none,S1,EXECUTING N,0 P0", EMissionProgress::Succeeded, "ignored_after_terminal", "S1", 0 },
	{ "sticky_failed_then_accepted", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CANCELLED D,202,-,ok,S1,ADMISSION_HELD", EMissionProgress::Failed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_failed_then_accepted_other_run", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CANCELLED D,200,-,ok,S2,RESERVED", EMissionProgress::Failed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_failed_then_no_answer", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CANCELLED D0", EMissionProgress::Failed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_failed_then_refusal", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CANCELLED D,409,julius_dispatch_already_dispatched,none,none,-", EMissionProgress::Failed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_failed_then_running", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CANCELLED P,200,-,J,none,S1,EXECUTING", EMissionProgress::Failed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_failed_then_completed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CANCELLED P,200,-,J,none,S1,COMPLETED", EMissionProgress::Failed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_failed_then_admission_held", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CANCELLED P,200,-,A,ok,S1,ADMISSION_HELD", EMissionProgress::Failed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_failed_then_other_run", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CANCELLED P,200,-,J,none,S2,FAILED", EMissionProgress::Failed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_failed_then_poll_failure", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CANCELLED P0", EMissionProgress::Failed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_failed_then_everything", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CANCELLED N,0 D,202,-,ok,S1,ADMISSION_HELD D0 P,200,-,J,none,S1,EXECUTING N,0 P0", EMissionProgress::Failed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_dispatch_failed_then_accepted", "D,202,-,ok,S1,INTERRUPTED D,202,-,ok,S1,ADMISSION_HELD", EMissionProgress::DispatchFailed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_dispatch_failed_then_accepted_other_run", "D,202,-,ok,S1,INTERRUPTED D,200,-,ok,S2,RESERVED", EMissionProgress::DispatchFailed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_dispatch_failed_then_no_answer", "D,202,-,ok,S1,INTERRUPTED D0", EMissionProgress::DispatchFailed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_dispatch_failed_then_refusal", "D,202,-,ok,S1,INTERRUPTED D,409,julius_dispatch_already_dispatched,none,none,-", EMissionProgress::DispatchFailed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_dispatch_failed_then_running", "D,202,-,ok,S1,INTERRUPTED P,200,-,J,none,S1,EXECUTING", EMissionProgress::DispatchFailed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_dispatch_failed_then_completed", "D,202,-,ok,S1,INTERRUPTED P,200,-,J,none,S1,COMPLETED", EMissionProgress::DispatchFailed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_dispatch_failed_then_admission_held", "D,202,-,ok,S1,INTERRUPTED P,200,-,A,ok,S1,ADMISSION_HELD", EMissionProgress::DispatchFailed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_dispatch_failed_then_other_run", "D,202,-,ok,S1,INTERRUPTED P,200,-,J,none,S2,FAILED", EMissionProgress::DispatchFailed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_dispatch_failed_then_poll_failure", "D,202,-,ok,S1,INTERRUPTED P0", EMissionProgress::DispatchFailed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_dispatch_failed_then_everything", "D,202,-,ok,S1,INTERRUPTED N,0 D,202,-,ok,S1,ADMISSION_HELD D0 P,200,-,J,none,S1,EXECUTING N,0 P0", EMissionProgress::DispatchFailed, "ignored_after_terminal", "S1", 0 },
	{ "sticky_refused_then_accepted", "D,409,julius_dispatch_key_reused,none,none,- D,202,-,ok,S1,ADMISSION_HELD", EMissionProgress::Refused, "ignored_after_terminal", "none", 0 },
	{ "sticky_refused_then_accepted_other_run", "D,409,julius_dispatch_key_reused,none,none,- D,200,-,ok,S2,RESERVED", EMissionProgress::Refused, "ignored_after_terminal", "none", 0 },
	{ "sticky_refused_then_no_answer", "D,409,julius_dispatch_key_reused,none,none,- D0", EMissionProgress::Refused, "ignored_after_terminal", "none", 0 },
	{ "sticky_refused_then_refusal", "D,409,julius_dispatch_key_reused,none,none,- D,409,julius_dispatch_already_dispatched,none,none,-", EMissionProgress::Refused, "ignored_after_terminal", "none", 0 },
	{ "sticky_refused_then_running", "D,409,julius_dispatch_key_reused,none,none,- P,200,-,J,none,S1,EXECUTING", EMissionProgress::Refused, "ignored_after_terminal", "none", 0 },
	{ "sticky_refused_then_completed", "D,409,julius_dispatch_key_reused,none,none,- P,200,-,J,none,S1,COMPLETED", EMissionProgress::Refused, "ignored_after_terminal", "none", 0 },
	{ "sticky_refused_then_admission_held", "D,409,julius_dispatch_key_reused,none,none,- P,200,-,A,ok,S1,ADMISSION_HELD", EMissionProgress::Refused, "ignored_after_terminal", "none", 0 },
	{ "sticky_refused_then_other_run", "D,409,julius_dispatch_key_reused,none,none,- P,200,-,J,none,S2,FAILED", EMissionProgress::Refused, "ignored_after_terminal", "none", 0 },
	{ "sticky_refused_then_poll_failure", "D,409,julius_dispatch_key_reused,none,none,- P0", EMissionProgress::Refused, "ignored_after_terminal", "none", 0 },
	{ "sticky_refused_then_everything", "D,409,julius_dispatch_key_reused,none,none,- N,0 D,202,-,ok,S1,ADMISSION_HELD D0 P,200,-,J,none,S1,EXECUTING N,0 P0", EMissionProgress::Refused, "ignored_after_terminal", "none", 0 },
	{ "sticky_run_id_mismatch_then_accepted", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S2,EXECUTING D,202,-,ok,S1,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "S1", 0 },
	{ "sticky_run_id_mismatch_then_accepted_other_run", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S2,EXECUTING D,200,-,ok,S2,RESERVED", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "S1", 0 },
	{ "sticky_run_id_mismatch_then_no_answer", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S2,EXECUTING D0", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "S1", 0 },
	{ "sticky_run_id_mismatch_then_refusal", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S2,EXECUTING D,409,julius_dispatch_already_dispatched,none,none,-", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "S1", 0 },
	{ "sticky_run_id_mismatch_then_running", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S2,EXECUTING P,200,-,J,none,S1,EXECUTING", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "S1", 0 },
	{ "sticky_run_id_mismatch_then_completed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S2,EXECUTING P,200,-,J,none,S1,COMPLETED", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "S1", 0 },
	{ "sticky_run_id_mismatch_then_admission_held", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S2,EXECUTING P,200,-,A,ok,S1,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "S1", 0 },
	{ "sticky_run_id_mismatch_then_other_run", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S2,EXECUTING P,200,-,J,none,S2,FAILED", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "S1", 0 },
	{ "sticky_run_id_mismatch_then_poll_failure", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S2,EXECUTING P0", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "S1", 0 },
	{ "sticky_run_id_mismatch_then_everything", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S2,EXECUTING N,0 D,202,-,ok,S1,ADMISSION_HELD D0 P,200,-,J,none,S1,EXECUTING N,0 P0", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "S1", 0 },
	{ "sticky_run_id_mismatch_first_then_accepted", "D,202,-,other,S1,ADMISSION_HELD D,202,-,ok,S1,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "none", 0 },
	{ "sticky_run_id_mismatch_first_then_accepted_other_run", "D,202,-,other,S1,ADMISSION_HELD D,200,-,ok,S2,RESERVED", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "none", 0 },
	{ "sticky_run_id_mismatch_first_then_no_answer", "D,202,-,other,S1,ADMISSION_HELD D0", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "none", 0 },
	{ "sticky_run_id_mismatch_first_then_refusal", "D,202,-,other,S1,ADMISSION_HELD D,409,julius_dispatch_already_dispatched,none,none,-", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "none", 0 },
	{ "sticky_run_id_mismatch_first_then_running", "D,202,-,other,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "none", 0 },
	{ "sticky_run_id_mismatch_first_then_completed", "D,202,-,other,S1,ADMISSION_HELD P,200,-,J,none,S1,COMPLETED", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "none", 0 },
	{ "sticky_run_id_mismatch_first_then_admission_held", "D,202,-,other,S1,ADMISSION_HELD P,200,-,A,ok,S1,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "none", 0 },
	{ "sticky_run_id_mismatch_first_then_other_run", "D,202,-,other,S1,ADMISSION_HELD P,200,-,J,none,S2,FAILED", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "none", 0 },
	{ "sticky_run_id_mismatch_first_then_poll_failure", "D,202,-,other,S1,ADMISSION_HELD P0", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "none", 0 },
	{ "sticky_run_id_mismatch_first_then_everything", "D,202,-,other,S1,ADMISSION_HELD N,0 D,202,-,ok,S1,ADMISSION_HELD D0 P,200,-,J,none,S1,EXECUTING N,0 P0", EMissionProgress::RunIdMismatch, "ignored_after_terminal", "none", 0 },
	{ "sticky_answer_invalid_then_accepted", "D,202,-,ok,bad,ADMISSION_HELD D,202,-,ok,S1,ADMISSION_HELD", EMissionProgress::AnswerInvalid, "ignored_after_terminal", "none", 0 },
	{ "sticky_answer_invalid_then_accepted_other_run", "D,202,-,ok,bad,ADMISSION_HELD D,200,-,ok,S2,RESERVED", EMissionProgress::AnswerInvalid, "ignored_after_terminal", "none", 0 },
	{ "sticky_answer_invalid_then_no_answer", "D,202,-,ok,bad,ADMISSION_HELD D0", EMissionProgress::AnswerInvalid, "ignored_after_terminal", "none", 0 },
	{ "sticky_answer_invalid_then_refusal", "D,202,-,ok,bad,ADMISSION_HELD D,409,julius_dispatch_already_dispatched,none,none,-", EMissionProgress::AnswerInvalid, "ignored_after_terminal", "none", 0 },
	{ "sticky_answer_invalid_then_running", "D,202,-,ok,bad,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING", EMissionProgress::AnswerInvalid, "ignored_after_terminal", "none", 0 },
	{ "sticky_answer_invalid_then_completed", "D,202,-,ok,bad,ADMISSION_HELD P,200,-,J,none,S1,COMPLETED", EMissionProgress::AnswerInvalid, "ignored_after_terminal", "none", 0 },
	{ "sticky_answer_invalid_then_admission_held", "D,202,-,ok,bad,ADMISSION_HELD P,200,-,A,ok,S1,ADMISSION_HELD", EMissionProgress::AnswerInvalid, "ignored_after_terminal", "none", 0 },
	{ "sticky_answer_invalid_then_other_run", "D,202,-,ok,bad,ADMISSION_HELD P,200,-,J,none,S2,FAILED", EMissionProgress::AnswerInvalid, "ignored_after_terminal", "none", 0 },
	{ "sticky_answer_invalid_then_poll_failure", "D,202,-,ok,bad,ADMISSION_HELD P0", EMissionProgress::AnswerInvalid, "ignored_after_terminal", "none", 0 },
	{ "sticky_answer_invalid_then_everything", "D,202,-,ok,bad,ADMISSION_HELD N,0 D,202,-,ok,S1,ADMISSION_HELD D0 P,200,-,J,none,S1,EXECUTING N,0 P0", EMissionProgress::AnswerInvalid, "ignored_after_terminal", "none", 0 },
	{ "sticky_poll_limit_then_accepted", "D,202,-,ok,S1,ADMISSION_HELD N,21600000 D,202,-,ok,S1,ADMISSION_HELD", EMissionProgress::PollLimitReached, "ignored_after_terminal", "S1", 0 },
	{ "sticky_poll_limit_then_accepted_other_run", "D,202,-,ok,S1,ADMISSION_HELD N,21600000 D,200,-,ok,S2,RESERVED", EMissionProgress::PollLimitReached, "ignored_after_terminal", "S1", 0 },
	{ "sticky_poll_limit_then_no_answer", "D,202,-,ok,S1,ADMISSION_HELD N,21600000 D0", EMissionProgress::PollLimitReached, "ignored_after_terminal", "S1", 0 },
	{ "sticky_poll_limit_then_refusal", "D,202,-,ok,S1,ADMISSION_HELD N,21600000 D,409,julius_dispatch_already_dispatched,none,none,-", EMissionProgress::PollLimitReached, "ignored_after_terminal", "S1", 0 },
	{ "sticky_poll_limit_then_running", "D,202,-,ok,S1,ADMISSION_HELD N,21600000 P,200,-,J,none,S1,EXECUTING", EMissionProgress::PollLimitReached, "ignored_after_terminal", "S1", 0 },
	{ "sticky_poll_limit_then_completed", "D,202,-,ok,S1,ADMISSION_HELD N,21600000 P,200,-,J,none,S1,COMPLETED", EMissionProgress::PollLimitReached, "ignored_after_terminal", "S1", 0 },
	{ "sticky_poll_limit_then_admission_held", "D,202,-,ok,S1,ADMISSION_HELD N,21600000 P,200,-,A,ok,S1,ADMISSION_HELD", EMissionProgress::PollLimitReached, "ignored_after_terminal", "S1", 0 },
	{ "sticky_poll_limit_then_other_run", "D,202,-,ok,S1,ADMISSION_HELD N,21600000 P,200,-,J,none,S2,FAILED", EMissionProgress::PollLimitReached, "ignored_after_terminal", "S1", 0 },
	{ "sticky_poll_limit_then_poll_failure", "D,202,-,ok,S1,ADMISSION_HELD N,21600000 P0", EMissionProgress::PollLimitReached, "ignored_after_terminal", "S1", 0 },
	{ "sticky_poll_limit_then_everything", "D,202,-,ok,S1,ADMISSION_HELD N,21600000 N,0 D,202,-,ok,S1,ADMISSION_HELD D0 P,200,-,J,none,S1,EXECUTING N,0 P0", EMissionProgress::PollLimitReached, "ignored_after_terminal", "S1", 0 },
	{ "m2_running_admission_poll_no_regression", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,A,ok,S1,ADMISSION_HELD", EMissionProgress::Running, "admission_answer_logged", "S1", 0 },
	{ "m2_running_admission_poll_no_dispatch_failed_interrupted", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,A,ok,S1,INTERRUPTED", EMissionProgress::Running, "admission_answer_logged", "S1", 0 },
	{ "m2_running_admission_poll_no_dispatch_failed_failed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,A,ok,S1,FAILED", EMissionProgress::Running, "admission_answer_logged", "S1", 0 },
	{ "m2_running_late_replay_no_dispatch_failed_interrupted", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING D,200,-,ok,S1,INTERRUPTED", EMissionProgress::Running, "admission_answer_logged", "S1", 0 },
	{ "m2_running_late_replay_no_dispatch_failed_failed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING D,200,-,ok,S1,FAILED", EMissionProgress::Running, "admission_answer_logged", "S1", 0 },
	{ "m2_running_late_replay_no_regression", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING D,200,-,ok,S1,ADMISSION_HELD", EMissionProgress::Running, "admission_answer_logged", "S1", 0 },
	{ "m2_julius_unknown_word_then_admission_failed_logged", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE P,200,-,A,ok,S1,FAILED", EMissionProgress::Waiting, "admission_answer_logged", "S1", 0 },
	{ "m2_julius_terminal_word_still_applies_after_logged", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,A,ok,S1,INTERRUPTED P,200,-,J,none,S1,COMPLETED", EMissionProgress::Succeeded, "status_applied", "S1", 0 },
	{ "m2_admission_mismatch_after_julius_fails_closed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,A,other,S1,ADMISSION_HELD", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "m2_late_replay_mismatch_after_julius_fails_closed", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING D,200,-,ok,S2,INTERRUPTED", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "m2_pre_julius_waiting_to_dispatch_failed", "D,202,-,ok,S1,QUEUED P,200,-,A,ok,S1,INTERRUPTED", EMissionProgress::DispatchFailed, "status_applied", "S1", 0 },
	{ "m2_pre_julius_waiting_late_replay_dispatch_failed", "D,202,-,ok,S1,QUEUED D,200,-,ok,S1,FAILED", EMissionProgress::DispatchFailed, "dispatch_replayed", "S1", 0 },
	{ "m2_pre_julius_waiting_to_held", "D,202,-,ok,S1,QUEUED P,200,-,A,ok,S1,ADMISSION_HELD", EMissionProgress::AdmittedHeld, "status_applied", "S1", 0 },
	{ "m2_unknown_vocabulary_is_not_julius", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,U,none,S1,EXECUTING P,200,-,A,ok,S1,FAILED", EMissionProgress::DispatchFailed, "status_applied", "S1", 0 },
	{ "runid_julius_own_name_is_not_applied", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,jkey,COMPLETED", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "runid_julius_own_name_while_running", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING P,200,-,J,none,jkey,FAILED", EMissionProgress::RunIdMismatch, "run_id_mismatched", "S1", 0 },
	{ "phase_held_admission_budget_fits", "D,202,-,ok,S1,ADMISSION_HELD N,21480000", EMissionProgress::AdmittedHeld, "admitted", "S1", 0 },
	{ "phase_held_admission_budget_exhausted", "D,202,-,ok,S1,ADMISSION_HELD N,21480001", EMissionProgress::PollLimitReached, "poll_limit_reached", "S1", 0 },
	{ "phase_held_past_old_three_hour_cap", "D,202,-,ok,S1,ADMISSION_HELD N,10800000", EMissionProgress::AdmittedHeld, "admitted", "S1", 0 },
	{ "phase_unknown_vocabulary_keeps_admission_budget", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,U,none,S1,COMPLETED N,21600000", EMissionProgress::PollLimitReached, "poll_limit_reached", "S1", 0 },
	{ "phase_admission_word_keeps_admission_budget", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,A,ok,S1,RESERVED N,21600000", EMissionProgress::PollLimitReached, "poll_limit_reached", "S1", 0 },
	{ "phase_julius_opens_fresh_window", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING N,21600000 N,41280000", EMissionProgress::Running, "status_applied", "S1", 0 },
	{ "phase_julius_fresh_window_exhausted", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,EXECUTING N,21600000 N,41280001", EMissionProgress::PollLimitReached, "poll_limit_reached", "S1", 0 },
	{ "phase_julius_unknown_word_opens_fresh_window", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,DONE N,21600000 N,41000000", EMissionProgress::Waiting, "status_applied", "S1", 0 },
	{ "phase_window_starts_at_first_ask_only", "D,202,-,ok,S1,ADMISSION_HELD P,200,-,J,none,S1,CREATED N,0 P,200,-,J,none,S1,EXECUTING N,19800000", EMissionProgress::PollLimitReached, "poll_limit_reached", "S1", 0 },
	// KAT-PROGRESS-SCRIPT-END
	};

	std::vector<std::string> Split(const std::string& Text, char Separator)
	{
		std::vector<std::string> Parts;
		std::string Part;
		for (const char Character : Text)
		{
			if (Character == Separator) { Parts.push_back(Part); Part.clear(); }
			else { Part.push_back(Character); }
		}
		Parts.push_back(Part);
		return Parts;
	}

	/** Owns the strings an FStatusAnswer points at. */
	struct FAnswerHolder
	{
		std::string Kind, Client, Server, Status;
		FStatusAnswer Answer;
	};

	std::string ServerFor(const std::string& Tag)
	{
		if (Tag == "S1") { return ServerS1; }
		if (Tag == "S2") { return ServerS2; }
		if (Tag == "bad") { return ServerBad; }
		if (Tag == "short") { return ServerShort; }
		if (Tag == "jkey") { return ServerJuliusKey; }
		return "";
	}

	bool Fill(FAnswerHolder& Holder, const std::string& Http, const std::string& Err, const std::string& Vocab,
		const std::string& Client, const std::string& Server, const std::string& Status)
	{
		FStatusAnswer& Answer = Holder.Answer;
		Answer.HttpStatus = std::stoi(Http);
		Answer.bHasError = Err != "-";
		Holder.Kind = (Err == "-" || Err == "~") ? "" : Err;
		Answer.bHasData = Client != "nodata";
		if (Vocab == "A") { Answer.Vocabulary = EStatusVocabulary::Admission; }
		else if (Vocab == "J") { Answer.Vocabulary = EStatusVocabulary::JuliusRun; }
		else if (Vocab == "U") { Answer.Vocabulary = EStatusVocabulary::Unknown; }
		else { return false; }
		Holder.Client = Client == "ok" ? ClientOk : Client == "other" ? ClientOther : "";
		Holder.Server = Answer.bHasData ? ServerFor(Server) : "";
		Holder.Status = (Status == "-" || !Answer.bHasData) ? "" : Status;
		Answer.ErrorKind = Holder.Kind;
		Answer.ClientRunId = Holder.Client;
		Answer.ServerRunId = Holder.Server;
		Answer.Status = Holder.Status;
		return true;
	}

	/** Runs one script. False when the script itself is malformed. */
	bool RunScript(const std::string& Script, FMissionProgressTracker& Tracker)
	{
		if (Script.empty()) { return true; }
		for (const std::string& Step : Split(Script, ' '))
		{
			const std::vector<std::string> F = Split(Step, ',');
			FAnswerHolder Holder;
			if (Step == "D0")
			{
				Holder.Answer.Vocabulary = EStatusVocabulary::Admission;
				Tracker.RecordDispatchAnswer(ClassifyDispatchAnswer(0, false, ""), Holder.Answer);
			}
			else if (Step == "P0")
			{
				Tracker.RecordPollAnswer(Holder.Answer);
			}
			else if (F.size() == 6 && F[0] == "D")
			{
				if (!Fill(Holder, F[1], F[2], "A", F[3], F[4], F[5])) { return false; }
				const FStatusAnswer& A = Holder.Answer;
				Tracker.RecordDispatchAnswer(ClassifyDispatchAnswer(A.HttpStatus, A.bHasError, A.ErrorKind), A);
			}
			else if (F.size() == 7 && F[0] == "P")
			{
				if (!Fill(Holder, F[1], F[2], F[3], F[4], F[5], F[6])) { return false; }
				Tracker.RecordPollAnswer(Holder.Answer);
			}
			else if (F.size() == 2 && F[0] == "N")
			{
				Tracker.NextPollStep(std::stoull(F[1]));
			}
			else
			{
				return false;
			}
		}
		return true;
	}

	FStatusAnswer HeldPoll()
	{
		FStatusAnswer Answer;
		Answer.HttpStatus = 200;
		Answer.bHasData = true;
		Answer.Vocabulary = EStatusVocabulary::Admission;
		Answer.ClientRunId = ClientOk;
		Answer.ServerRunId = ServerS1;
		Answer.Status = "ADMISSION_HELD";
		return Answer;
	}

	FStatusAnswer RunningPoll()
	{
		FStatusAnswer Answer;
		Answer.HttpStatus = 200;
		Answer.bHasData = true;
		Answer.Vocabulary = EStatusVocabulary::JuliusRun;
		Answer.ServerRunId = ServerS1;
		Answer.Status = "EXECUTING";
		return Answer;
	}

	FMissionProgressTracker AdmittedTracker()
	{
		FMissionProgressTracker Tracker(ClientOk);
		FStatusAnswer Answer = HeldPoll();
		Answer.HttpStatus = 202;
		Tracker.RecordDispatchAnswer(EDispatchAnswer::Accepted, Answer);
		return Tracker;
	}
}

int main()
{
	const EMissionProgress AllStates[] = {
		EMissionProgress::AwaitingDispatchAnswer, EMissionProgress::AdmittedHeld, EMissionProgress::Dispatched,
		EMissionProgress::Running, EMissionProgress::Paused, EMissionProgress::Waiting, EMissionProgress::Succeeded,
		EMissionProgress::Failed, EMissionProgress::Refused, EMissionProgress::DispatchFailed,
		EMissionProgress::RunIdMismatch, EMissionProgress::AnswerInvalid, EMissionProgress::PollLimitReached};

	// The server run id rule.
	Expect(IsServerRunId(ServerS1) && IsServerRunId(ServerS2), "server run id: well-formed");
	Expect(!IsServerRunId(ServerBad) && !IsServerRunId(ServerShort) && !IsServerRunId("") && !IsServerRunId("run:")
		&& !IsServerRunId("RUN:0123456789abcdef01234567") && !IsServerRunId("run:0123456789abcdef012345678")
		&& !IsServerRunId("run_0123456789abcdef01234567") && !IsServerRunId(" run:0123456789abcdef0123456")
		&& !IsServerRunId("run:0123456789abcdef0123456g") && !IsServerRunId(ClientOk), "server run id: malformed");

	// Status: exact bytes, inside its own vocabulary.
	for (const FStatusRow& Row : StatusRows)
	{
		const EMissionProgress Got = ProgressFromStatus(Row.Vocabulary, Row.Status);
		Expect(Got == Row.Expected, std::string("status ") + Row.Label + ": got " + ProgressStateName(Got));
		Expect(Got != EMissionProgress::AwaitingDispatchAnswer && Got != EMissionProgress::Refused
			&& Got != EMissionProgress::RunIdMismatch && Got != EMissionProgress::AnswerInvalid
			&& Got != EMissionProgress::PollLimitReached, std::string("status never says ") + ProgressStateName(Got));
		if (Row.Vocabulary == EStatusVocabulary::Admission)
		{
			Expect(Got == EMissionProgress::AdmittedHeld || Got == EMissionProgress::Waiting || Got == EMissionProgress::DispatchFailed,
				std::string("P7 an admission status is never running: ") + Row.Label);
		}
	}

	// Display words and terminal flags; every state has a row.
	Expect(CountOf(DisplayRows) == CountOf(AllStates), "display: one row per state");
	for (std::size_t Index = 0; Index < CountOf(DisplayRows); ++Index)
	{
		const FDisplayRow& Row = DisplayRows[Index];
		Expect(Row.State == AllStates[Index], std::string("display order ") + Row.Name);
		Expect(std::strcmp(ProgressDisplayLabel(Row.State), Row.Label) == 0, std::string("display ") + Row.Name + ": " + ProgressDisplayLabel(Row.State));
		Expect(std::strcmp(ProgressStateName(Row.State), Row.Name) == 0, std::string("state name ") + Row.Name);
		Expect(IsTerminalProgress(Row.State) == (Row.bTerminal != 0), std::string("terminal ") + Row.Name);
		const std::string Label = ProgressDisplayLabel(Row.State);
		for (const char* Forbidden : {"PASS", "pass", "Pass", "spent", "spend", "cost", "$", "qualif", "verified", "success", "paid for", "charged"})
		{
			Expect(Label.find(Forbidden) == std::string::npos, std::string("P6 display ") + Row.Name + " says " + Forbidden);
		}
	}
	Expect(std::strcmp(ProgressDisplayLabel(EMissionProgress::AdmittedHeld), "Admitted \xE2\x80\x94 waiting for the paid run") == 0,
		"display: the admitted words");

	// The poll schedule.
	for (const FPollRow& Row : PollRows)
	{
		const FPollDecision Got = NextPoll(Row.PollsSent, Row.Phase, Row.WatchedMs);
		Expect(Got.Step == Row.Step && Got.DelayMs == Row.DelayMs, std::string("poll ") + Row.Label + ": delay " + std::to_string(Got.DelayMs));
	}
	Expect(PollBaseDelayMs == 5000 && PollGrowthFactor == 2 && PollMaxDelayMs == 60000 && PollSlowAfterMs == 1800000
		&& PollSlowDelayMs == 120000 && PollAdmissionWatchMs == 21600000 && PollRunWatchMs == 19800000, "poll constants");
	// The workflow's own numbers (julius-first-live-mission.yml at this tree; the .ts test reads the file itself).
	Expect(PollAdmissionWatchMs >= 350ull * 60000ull, "admission budget >= paid-slot timeout-minutes 350");
	Expect(PollRunWatchMs >= 300ull * 60000ull && PollRunWatchMs >= 17516316ull, "run budget >= live job timeout-minutes 300 and its 291.9 min worst case");

	// P4, P5: bounded polling that never dispatches, whatever the polls answer.
	for (const FPollRunRow& Row : PollRunRows)
	{
		FMissionProgressTracker Tracker = AdmittedTracker();
		const bool bFail = std::strcmp(Row.Answer, "fail") == 0;
		std::uint64_t Watched = 0;
		std::uint32_t Polls = 0;
		bool bEverAllowed = false;
		for (std::uint32_t Guard = 0; Guard < 100000; ++Guard)
		{
			const FPollDecision Decision = Tracker.NextPollStep(Watched);
			if (Decision.Step == EPollStep::Stop) { break; }
			Watched += Decision.DelayMs + Row.RequestMs;
			const bool bJulius = Row.JuliusFromPoll != 0 && Polls + 1 >= Row.JuliusFromPoll;
			Tracker.RecordPollAnswer(bJulius ? RunningPoll() : bFail ? FStatusAnswer{} : HeldPoll());
			++Polls;
			bEverAllowed = bEverAllowed || Tracker.DispatchSendAllowed();
		}
		Expect(Tracker.JuliusStatusSeen() == (Row.JuliusFromPoll != 0), std::string("poll run phase ") + Row.Label);
		Expect(Polls == Row.ExpectedPolls && Watched == Row.ExpectedWatchedMs,
			std::string("poll run ") + Row.Label + ": polls " + std::to_string(Polls) + " watched " + std::to_string(Watched));
		Expect(Tracker.Current() == EMissionProgress::PollLimitReached, std::string("poll run ends at the limit ") + Row.Label);
		Expect(!bEverAllowed && !Tracker.DispatchSendAllowed(), std::string("P4 poll run never allows a dispatch ") + Row.Label);
		Expect(Tracker.NextPollStep(0).Step == EPollStep::Stop, std::string("poll limit is sticky ") + Row.Label);
		Expect(Tracker.PinnedServerRunId() == ServerS1, std::string("poll run keeps the pin ") + Row.Label);
	}

	// The transition scripts.
	for (const FScriptRow& Row : ScriptRows)
	{
		FMissionProgressTracker Tracker(ClientOk);
		Expect(RunScript(Row.Script, Tracker), std::string("script parses ") + Row.Label);
		const std::string Pinned = Tracker.PinnedServerRunId();
		const std::string ExpectedPinned = std::strcmp(Row.Pinned, "none") == 0 ? std::string() : ServerFor(Row.Pinned);
		Expect(Tracker.Current() == Row.Final, std::string("script ") + Row.Label + ": got " + ProgressStateName(Tracker.Current()));
		Expect(std::strcmp(ProgressEventName(Tracker.Trace().back().Event), Row.LastEvent) == 0,
			std::string("script ") + Row.Label + ": last event " + ProgressEventName(Tracker.Trace().back().Event));
		Expect(Pinned == ExpectedPinned, std::string("script ") + Row.Label + ": pinned " + Pinned);
		Expect(Tracker.DispatchSendAllowed() == (Row.bSendAllowed != 0), std::string("script ") + Row.Label + ": send allowed");
		// Every trace event: the pin never changes once set, after admission every event carries it, and nothing
		// ever goes back to AwaitingDispatchAnswer or out of a terminal state.
		bool bAdmitted = false;
		for (const FProgressTrace& Event : Tracker.Trace())
		{
			if (Event.Event == EProgressEvent::Admitted) { bAdmitted = true; }
			if (bAdmitted)
			{
				Expect(Event.ServerRunId == Pinned && !Pinned.empty(), std::string("trace carries server_run_id ") + Row.Label);
				Expect(FormatProgressTrace(Event).find(std::string(" server_run_id=") + Pinned + " ") != std::string::npos,
					std::string("trace line carries server_run_id ") + Row.Label);
			}
			else
			{
				Expect(Event.ServerRunId.empty(), std::string("no server_run_id before admission ") + Row.Label);
			}
			Expect(Event.To != EMissionProgress::AwaitingDispatchAnswer || Event.From == EMissionProgress::AwaitingDispatchAnswer,
				std::string("P1 never back to awaiting ") + Row.Label);
			Expect(!IsTerminalProgress(Event.From) || Event.To == Event.From, std::string("P3 sticky ") + Row.Label);
			Expect(Event.ClientRunId == ClientOk, std::string("trace carries client_run_id ") + Row.Label);
		}
	}

	// P1 with r2's tracker: the wrapper sends only when both allow. After Accepted, r2 alone would admit a fresh
	// pair; the progress tracker is what stops it.
	{
		FDispatchAttemptTracker Attempts;
		FMissionProgressTracker Progress(ClientOk);
		const FDispatchAttempt Pair{ClientOk, KeyOk};
		const FDispatchAttempt Fresh{ClientOther, "1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a"};
		int Sends = 0;
		const auto TrySend = [&](const FDispatchAttempt& Attempt) {
			if (Progress.DispatchSendAllowed() && Attempts.BeginAttempt(Attempt) == EAttemptVerdict::Admitted) { ++Sends; return true; }
			return false;
		};
		Expect(TrySend(Pair), "P1 first send");
		FStatusAnswer None;
		Attempts.RecordAnswer(EDispatchAnswer::NoAnswer);
		Progress.RecordDispatchAnswer(EDispatchAnswer::NoAnswer, None);
		Expect(TrySend(Pair), "P1 identical resend after no answer");
		FStatusAnswer Accepted = HeldPoll();
		Accepted.HttpStatus = 202;
		Attempts.RecordAnswer(EDispatchAnswer::Accepted);
		Progress.RecordDispatchAnswer(EDispatchAnswer::Accepted, Accepted);
		Expect(!TrySend(Pair), "P1 no identical resend after Accepted");
		FDispatchAttemptTracker R2Only = Attempts;
		Expect(R2Only.BeginAttempt(Fresh) == EAttemptVerdict::Admitted, "r2 alone would admit a fresh pair after Accepted");
		Expect(!TrySend(Fresh), "P1 no fresh pair after Accepted");
		for (int Poll = 0; Poll < 300; ++Poll)
		{
			Progress.RecordPollAnswer(FStatusAnswer{});
			Expect(!TrySend(Pair) && !TrySend(Fresh), "P4 no dispatch after a failed poll");
		}
		Progress.NextPollStep(PollAdmissionWatchMs);
		Expect(!TrySend(Pair) && !TrySend(Fresh), "P1 no dispatch after the poll limit");
		Expect(Sends == 2, "P1 exactly the first send and one identical resend: " + std::to_string(Sends));
		Expect(Progress.PollsRecorded() == 300, "every poll after Accepted is counted, with no count cap");
	}

	// P4: a poll before the first Accepted answer is not counted (Skywalker's S22).
	{
		FMissionProgressTracker Tracker(ClientOk);
		for (int Poll = 0; Poll < 3; ++Poll)
		{
			Tracker.RecordPollAnswer(RunningPoll());
			Tracker.RecordPollAnswer(FStatusAnswer{});
		}
		Expect(Tracker.PollsRecorded() == 0, "P4 polls before Accepted are not counted: " + std::to_string(Tracker.PollsRecorded()));
		Expect(Tracker.Trace().back().PollIndex == 0 && !Tracker.JuliusStatusSeen(), "P4 a poll before Accepted applies nothing");
		FStatusAnswer Accepted = HeldPoll();
		Accepted.HttpStatus = 202;
		Tracker.RecordDispatchAnswer(EDispatchAnswer::Accepted, Accepted);
		Expect(Tracker.PollsRecorded() == 0, "P4 still 0 at Accepted");
		Tracker.RecordPollAnswer(HeldPoll());
		Expect(Tracker.PollsRecorded() == 1 && Tracker.Trace().back().PollIndex == 1, "P4 the first poll after Accepted is poll 1");
	}

	// P2: keyed only on serverRunId. A status naming any other id (Julius's own run:<idempotencyKey> name included)
	// is never applied: the state it reports is not reached, the pin does not change, and the watch fails closed.
	for (const char* Status : {"COMPLETED", "FAILED", "EXECUTING", "CREATED"})
	{
		FMissionProgressTracker Tracker = AdmittedTracker();
		FStatusAnswer Other = RunningPoll();
		Other.ServerRunId = ServerJuliusKey;
		Other.Status = Status;
		Tracker.RecordPollAnswer(Other);
		Expect(Tracker.Current() == EMissionProgress::RunIdMismatch, std::string("P2 other run id fails closed ") + Status);
		Expect(Tracker.PinnedServerRunId() == ServerS1 && !Tracker.JuliusStatusSeen(), std::string("P2 other run id changes no pin, no phase ") + Status);
		for (const FProgressTrace& Event : Tracker.Trace())
		{
			Expect(Event.Event != EProgressEvent::StatusApplied, std::string("P2 other run id is never applied ") + Status);
		}
	}

	// P5: no count cap. A wrapper whose clock never moves keeps polling (the clock, not a counter, ends the watch).
	{
		FMissionProgressTracker Tracker = AdmittedTracker();
		for (int Poll = 0; Poll < 1000; ++Poll)
		{
			Tracker.RecordPollAnswer(HeldPoll());
		}
		Expect(Tracker.NextPollStep(0).Step == EPollStep::WaitThenPoll && Tracker.PollsRecorded() == 1000, "P5 no poll-count cap");
	}

	// P5: the workflow's legal worst case is still being watched. Julius first reports at 350 min (the paid-slot
	// job's whole timeout), then the live job runs its 300 min timeout: the client must still be polling at the end.
	{
		FMissionProgressTracker Tracker = AdmittedTracker();
		std::uint64_t Watched = 0;
		bool bStopped = false;
		while (Watched < 350ull * 60000ull && !bStopped)
		{
			const FPollDecision Decision = Tracker.NextPollStep(Watched);
			bStopped = Decision.Step == EPollStep::Stop;
			Watched += Decision.DelayMs;
			Tracker.RecordPollAnswer(HeldPoll());
		}
		Expect(!bStopped && Tracker.Current() == EMissionProgress::AdmittedHeld, "P5 still watching through the 350 min paid-slot wait");
		const std::uint64_t JuliusAt = Watched;
		Tracker.RecordPollAnswer(RunningPoll());
		while (Watched < JuliusAt + 300ull * 60000ull && !bStopped)
		{
			const FPollDecision Decision = Tracker.NextPollStep(Watched);
			bStopped = Decision.Step == EPollStep::Stop;
			Watched += Decision.DelayMs;
			Tracker.RecordPollAnswer(RunningPoll());
		}
		Expect(!bStopped && Tracker.Current() == EMissionProgress::Running, "P5 still watching through the 300 min live job after it");
	}

	// P8, run step by step over every script: DispatchFailed is entered only before any Julius status and only from
	// AwaitingDispatchAnswer (the Accepted answer itself), AdmittedHeld or Waiting; after a Julius status nothing goes
	// back to AdmittedHeld; admission_answer_logged appears only after a Julius status and never moves the state.
	for (const FScriptRow& Row : ScriptRows)
	{
		if (std::strlen(Row.Script) == 0) { continue; }
		FMissionProgressTracker Tracker(ClientOk);
		for (const std::string& Step : Split(Row.Script, ' '))
		{
			const bool bJuliusBefore = Tracker.JuliusStatusSeen();
			const std::size_t Before = Tracker.Trace().size();
			Expect(RunScript(Step, Tracker), std::string("P8 step parses ") + Row.Label);
			for (std::size_t Index = Before; Index < Tracker.Trace().size(); ++Index)
			{
				const FProgressTrace& Event = Tracker.Trace()[Index];
				if (Event.To == EMissionProgress::DispatchFailed && Event.From != EMissionProgress::DispatchFailed)
				{
					Expect(!bJuliusBefore && (Event.From == EMissionProgress::AwaitingDispatchAnswer
						|| Event.From == EMissionProgress::AdmittedHeld || Event.From == EMissionProgress::Waiting),
						std::string("P8 DispatchFailed only before Julius ") + Row.Label);
				}
				if (bJuliusBefore)
				{
					Expect(Event.To != EMissionProgress::AdmittedHeld, std::string("P8 never back to admitted after Julius ") + Row.Label);
				}
				if (Event.Event == EProgressEvent::AdmissionAnswerLogged)
				{
					Expect(bJuliusBefore && Event.To == Event.From, std::string("P8 logged only after Julius, no move ") + Row.Label);
				}
			}
			Expect(!bJuliusBefore || Tracker.JuliusStatusSeen(), std::string("P8 Julius seen is sticky ") + Row.Label);
		}
	}

	// Trace line format, exactly.
	{
		FMissionProgressTracker Tracker = AdmittedTracker();
		FStatusAnswer Running;
		Running.HttpStatus = 200;
		Running.bHasData = true;
		Running.Vocabulary = EStatusVocabulary::JuliusRun;
		Running.ServerRunId = ServerS1;
		Running.Status = "EXECUTING";
		Tracker.RecordPollAnswer(Running);
		FStatusAnswer Free = Running;
		Free.Status = "the run is going fine";
		Tracker.RecordPollAnswer(Free);
		const std::vector<FProgressTrace>& Trace = Tracker.Trace();
		Expect(Trace.size() == 4, "trace length");
		Expect(FormatProgressTrace(Trace[0]) == std::string("j1_progress event=started from=awaiting_dispatch_answer to=awaiting_dispatch_answer client_run_id=")
			+ ClientOk + " server_run_id=- http=0 poll=0 status=-", "trace line: started " + FormatProgressTrace(Trace[0]));
		Expect(FormatProgressTrace(Trace[1]) == std::string("j1_progress event=admitted from=awaiting_dispatch_answer to=admitted_held client_run_id=")
			+ ClientOk + " server_run_id=" + ServerS1 + " http=202 poll=0 status=ADMISSION_HELD", "trace line: admitted " + FormatProgressTrace(Trace[1]));
		Expect(FormatProgressTrace(Trace[2]) == std::string("j1_progress event=status_applied from=admitted_held to=running client_run_id=")
			+ ClientOk + " server_run_id=" + ServerS1 + " http=200 poll=1 status=EXECUTING", "trace line: running " + FormatProgressTrace(Trace[2]));
		Expect(FormatProgressTrace(Trace[3]) == std::string("j1_progress event=status_applied from=running to=waiting client_run_id=")
			+ ClientOk + " server_run_id=" + ServerS1 + " http=200 poll=2 status=-", "trace line: free text never echoed " + FormatProgressTrace(Trace[3]));
	}

	if (Failures != 0)
	{
		std::printf("J1 PROGRESS KAT FAIL failures=%d\n", Failures);
		return 1;
	}
	std::printf("J1 PROGRESS KAT PASS status=%zu display=%zu poll=%zu poll_run=%zu script=%zu\n",
		CountOf(StatusRows), CountOf(DisplayRows), CountOf(PollRows), CountOf(PollRunRows), CountOf(ScriptRows));
	return 0;
}
