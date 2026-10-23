// WONDERLAND -- J1 client wrapper known-answer tests. No Unreal, no network, no secrets that leave the process.
//
//   g++ -std=c++17 -Wall -Wextra -Werror -pedantic -I wonderland/Source/Wonderland
//       wonderland/Tools/j1_wrapper_kat.cpp
//       wonderland/Source/Wonderland/WonderlandJuliusMissionClient.cpp
//       wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.cpp
//       -o j1_wrapper_kat && ./j1_wrapper_kat
//
//   cl /std:c++17 /EHsc /W4 /WX /I wonderland\Source\Wonderland
//       wonderland\Tools\j1_wrapper_kat.cpp
//       wonderland\Source\Wonderland\WonderlandJuliusMissionClient.cpp
//       wonderland\Source\Wonderland\WonderlandJuliusMissionLogic.cpp
//
// The scratch directory uses std::filesystem, std::chrono and std::thread. Those three cover
// POSIX and Windows, so this file has no unistd.h, no direct _WIN32 branch, and no mkdir.
//
// Each Expect name is the test the presentation spec cites.
#include "WonderlandJuliusMissionClient.h"

#include <array>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <map>
#include <sstream>
#include <string>
#include <system_error>
#include <thread>
#include <vector>

namespace
{
	using namespace WonderlandJuliusMissionClient;
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

	bool Contains(const std::string& Hay, const std::string& Needle)
	{
		return Hay.find(Needle) != std::string::npos;
	}

	class FScriptRandom final : public IRandomBytes16
	{
	public:
		int Fills = 0;
		void Add(std::uint8_t Seed)
		{
			std::uint8_t Bytes[16];
			for (int Index = 0; Index < 16; ++Index) { Bytes[Index] = static_cast<std::uint8_t>(Seed + Index * 3); }
			Script.emplace_back();
			std::memcpy(Script.back().data(), Bytes, 16);
		}
		bool Fill(std::uint8_t (&OutBytes)[16]) override
		{
			++Fills;
			if (Cursor >= Script.size()) { return false; }
			std::memcpy(OutBytes, Script[Cursor].data(), 16);
			++Cursor;
			return true;
		}
	private:
		std::vector<std::array<std::uint8_t, 16>> Script;
		std::size_t Cursor = 0;
	};

	class FClock final : public IUtcClock
	{
	public:
		std::uint64_t Now = 1700000000000ull;
		bool bNtp = false;
		std::int64_t Ntp = 0;
		std::uint64_t NowUtcMs() const override { return Now; }
		bool NtpOffsetMs(std::int64_t& Out) const override
		{
			if (!bNtp) { return false; }
			Out = Ntp;
			return true;
		}
	};

	class FMemTrace final : public ITraceSink
	{
	public:
		std::string Root = "/saved";
		std::map<std::string, std::vector<std::string>> Lines;
		bool Append(std::string_view RunId, std::string_view Line) override
		{
			Lines[std::string(RunId)].emplace_back(Line);
			return true;
		}
		std::string PathFor(std::string_view RunId) const override { return JuliusTraceFilePath(Root, RunId); }
		std::size_t LineCount(std::string_view RunId) const override
		{
			const auto Found = Lines.find(std::string(RunId));
			return Found == Lines.end() ? 0 : Found->second.size();
		}
		std::string All(std::string_view RunId) const
		{
			std::string Out;
			const auto Found = Lines.find(std::string(RunId));
			if (Found == Lines.end()) { return Out; }
			for (const std::string& Line : Found->second) { Out += Line; }
			return Out;
		}
		int CountEvent(std::string_view RunId, const char* Event) const
		{
			int Count = 0;
			const std::string Needle = std::string("\"event\":\"") + Event + "\"";
			const auto Found = Lines.find(std::string(RunId));
			if (Found == Lines.end()) { return 0; }
			for (const std::string& Line : Found->second)
			{
				if (Contains(Line, Needle)) { ++Count; }
			}
			return Count;
		}
	};

	class FMemStore final : public ITextStore
	{
	public:
		std::string Text;
		bool Write(std::string_view In) override { Text.assign(In.data(), In.size()); return true; }
		bool Read(std::string& Out) override
		{
			if (Text.empty()) { return false; }
			Out = Text;
			return true;
		}
	};

	struct FRig
	{
		FScriptRandom Random;
		FClock Clock;
		FMemTrace Trace;
		FMemStore Store;
		FJuliusMissionSession Session;
		explicit FRig(int Mints)
			: Session(Random, Clock, Trace, Store)
		{
			for (int Index = 0; Index < Mints; ++Index)
			{
				Random.Add(static_cast<std::uint8_t>(1 + Index * 17));
				Random.Add(static_cast<std::uint8_t>(80 + Index * 17));
				Random.Add(static_cast<std::uint8_t>(160 + Index * 11));
			}
			Session.SetProjectId("proj-1");
			Session.SetNativeSessionToken("SECRET_TOKEN_VALUE");
			Session.SetPlayerNetId("player-9");
			Session.SetBuildIdentity("abc123def", "pkg-1");
			Session.SetExpectedResultMode("fake");
		}
	};

	std::filesystem::path MakeScratchDirectory()
	{
		std::error_code Error;
		const std::filesystem::path Temp = std::filesystem::temp_directory_path(Error);
		if (Error) { return {}; }
		const auto Stamp = std::chrono::duration_cast<std::chrono::nanoseconds>(
			std::chrono::steady_clock::now().time_since_epoch()).count();
		std::ostringstream ThreadId;
		ThreadId << std::this_thread::get_id();
		std::string Token;
		for (const unsigned char C : ThreadId.str())
		{
			if ((C >= '0' && C <= '9') || (C >= 'A' && C <= 'Z') || (C >= 'a' && C <= 'z'))
			{
				Token.push_back(static_cast<char>(C));
			}
		}
		if (Token.empty()) { Token = "thread"; }
		const std::filesystem::path Directory = Temp / ("j1-wrapper-kat-" + std::to_string(Stamp) + "-" + Token);
		std::filesystem::create_directories(Directory, Error);
		if (Error) { return {}; }
		return Directory;
	}

	std::string Header(const FWireRequest& Request, const char* Name)
	{
		for (const std::pair<std::string, std::string>& Item : Request.Headers)
		{
			if (Item.first == Name) { return Item.second; }
		}
		return {};
	}

	std::string AdmissionBody(const std::string& RunId, const char* State, const char* ServerRun, bool bDispatched, bool bProviders)
	{
		std::string Body = "{\"data\":{\"runId\":\"";
		Body += RunId;
		Body += "\",\"state\":\"";
		Body += State;
		Body += "\",\"dispatched\":";
		Body += bDispatched ? "true" : "false";
		if (bProviders) { Body += ",\"providersRunning\":true"; }
		if (ServerRun != nullptr)
		{
			Body += ",\"serverRunId\":";
			if (std::strcmp(ServerRun, "null") == 0) { Body += "null"; }
			else if (std::strcmp(ServerRun, "number") == 0) { Body += "12"; }
			else
			{
				Body.push_back('"');
				Body += ServerRun;
				Body.push_back('"');
			}
		}
		Body += "}}";
		return Body;
	}

	FHttpResult Http(int Status, const std::string& Body, bool bResend, bool bTransport = false)
	{
		FHttpResult Result;
		Result.Status = Status;
		Result.Body = Body;
		Result.bResend = bResend;
		Result.bTransportError = bTransport;
		Result.LatencyMs = 15;
		return Result;
	}
}

int main()
{
	Expect(FormatIso8601UtcMs(0) == "1970-01-01T00:00:00.000Z", "iso_epoch");
	Expect(FormatIso8601UtcMs(1700000000000ull) == "2023-11-14T22:13:20.000Z", "iso_known_instant");
	Expect(IsLoopbackBaseUrl("http://127.0.0.1:8790"), "loopback_ipv4");
	Expect(IsLoopbackBaseUrl("http://localhost"), "loopback_localhost");
	Expect(IsLoopbackBaseUrl("https://[::1]:8790"), "loopback_ipv6");
	Expect(!IsLoopbackBaseUrl("http://example.com"), "loopback_rejects_public");
	Expect(!IsLoopbackBaseUrl("http://127.0.0.1.evil.com"), "loopback_rejects_suffix");
	Expect(!IsLoopbackBaseUrl("http://user@127.0.0.1"), "loopback_rejects_userinfo");
	Expect(JuliusTraceFilePath("/saved/", "wlj_00000000-0000-4000-8000-000000000000")
		== "/saved/Logs/JuliusTrace/wlj_00000000-0000-4000-8000-000000000000.jsonl", "trace_path_run_id");
	Expect(JuliusTraceFilePath("/saved", "_unminted") == "/saved/Logs/JuliusTrace/_unminted.jsonl", "trace_path_unminted");
	Expect(JuliusTraceFilePath("/saved", "../etc/passwd").empty(), "trace_path_rejects_escape");

	{
		FRig Rig(2);
		const FCommandOutcome Started = Rig.Session.Dispatch("demo-mission", "pair-7");
		Expect(Started.bSent, "dispatch_sends");
		Expect(Started.Request.Method == "POST", "dispatch_post");
		Expect(Contains(Started.Request.Url, "http://127.0.0.1:8790/relay-api/wonderland/julius/dispatch?projectId=proj-1"), "dispatch_url");
		Expect(Header(Started.Request, "Authorization") == "Relay-Session SECRET_TOKEN_VALUE", "dispatch_native_session");
		Expect(Header(Started.Request, "Origin").empty(), "dispatch_has_no_origin");
		const std::string Key = Header(Started.Request, "x-relay-idempotency-key");
		Expect(IsCanonicalUuidV4(Key), "dispatch_key_is_uuid");
		Expect(IsStrictRunId(Rig.Session.RunId()), "dispatch_run_is_strict");
		const std::string Trace = Rig.Trace.All(Rig.Session.RunId());
		Expect(!Contains(Trace, "SECRET_TOKEN_VALUE"), "trace_omits_token");
		Expect(!Contains(Trace, Key), "trace_omits_key");
		Expect(!Contains(Rig.Session.StatusJson(), Key), "status_omits_key");
		Expect(!Contains(Rig.Session.StatusJson(), "SECRET_TOKEN_VALUE"), "status_omits_token");
		Expect(!Contains(Rig.Session.SavedText(), "SECRET_TOKEN_VALUE"), "save_omits_token");
		Expect(Contains(Rig.Session.SavedText(), Key), "persist_open_pair_keeps_key");
		Expect(Contains(Rig.Session.SavedText(), "attempt_count 1"), "persist_attempt_count");
		Expect(Contains(Rig.Session.SavedText(), Rig.Session.RunId()), "persist_run_id");
		Expect(Rig.Trace.CountEvent(Rig.Session.RunId(), "dispatch_requested") == 1, "trace_dispatch_requested");
		Expect(!Contains(Rig.Trace.Lines[Rig.Session.RunId()][0], "server_run_id"), "trace_no_server_run_id_before_admission");
		const std::string& First = Rig.Trace.Lines[Rig.Session.RunId()][0];
		Expect(Contains(Started.Request.Body, Sha256Hex(First)), "client_log_hash_is_the_dispatch_line");
		Expect(Contains(First, "\"ui_state\":\"sending the mission\""), "dispatch_label");
		Expect(Contains(First, "\"player_net_id\":\"player-9\""), "trace_player");
		Expect(Contains(First, "\"build_sha\":\"abc123def\""), "trace_build_sha");
		Expect(Contains(First, "\"package_id\":\"pkg-1\""), "trace_package");
		Expect(Contains(First, "\"pair_id\":\"pair-7\""), "trace_pair");
		Expect(Contains(First, "\"ts_utc_ms\":1700000000000"), "trace_epoch_clock");

		const int FillsAfterDispatch = Rig.Random.Fills;
		Rig.Session.OnDispatchHttp(Http(0, "", false, true));
		Expect(Rig.Session.UiState() == EJuliusUiState::StillWaiting, "transport_is_still_waiting");
		Expect(Rig.Session.PlayerLabel() == LabelStillWaiting, "transport_label");
		Expect(Rig.Trace.CountEvent(Rig.Session.RunId(), "refusal_shown") == 0, "transport_is_not_a_refusal");
		Expect(std::string(StillWaitingLabel()) == LabelStillWaiting, "still_waiting_matches_logic_label");

		FRig Restored(1);
		Restored.Store.Text = Rig.Store.Text;
		Restored.Clock.Now = Rig.Clock.Now;
		Expect(Restored.Session.Load(), "persist_open_pair_round_trip_loads");
		Expect(Restored.Session.RunId() == Rig.Session.RunId(), "persist_round_trip_run");
		Expect(Contains(Restored.Session.SavedText(), Key), "persist_round_trip_key");
		Restored.Clock.Now += 2000;
		const FTickOutcome Tick = Restored.Session.Tick();
		Expect(Tick.bSend, "resend_after_restore");
		Expect(Tick.Request.RunId == Rig.Session.RunId(), "resend_same_run");
		Expect(Header(Tick.Request, "x-relay-idempotency-key") == Key, "resend_same_key");
		Expect(Restored.Random.Fills == 1, "resend_does_not_mint");
		Expect(FillsAfterDispatch == 3, "dispatch_used_three_fills");
	}

	{
		FRig Rig(1);
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "busy_dispatch");
		const std::string Body = std::string("{\"error\":{\"kind\":\"julius_dispatch_busy\",\"message\":\"queued\"},\"data\":{\"serverRunId\":\"run:held\"}}");
		Rig.Session.OnDispatchHttp(Http(429, Body, false));
		Expect(Rig.Session.UiState() == EJuliusUiState::QueuedBusy, "busy_first_send_state");
		Expect(Rig.Session.PlayerLabel() == LabelQueuedBusy, "busy_first_send_label");
		Expect(Rig.Trace.CountEvent(Rig.Session.RunId(), "refusal_shown") == 0, "busy_is_not_a_refusal");
		Expect(Rig.Session.HasServerRunId(), "server_run_id_on_open_pair");
		Expect(Contains(Rig.Session.SavedText(), "server_run_id run:held"), "persist_server_run_id_with_open_pair");
		Expect(Contains(Rig.Session.SavedText(), "key "), "open_pair_still_has_key");
		Expect(Contains(Rig.Session.StatusJson(), "\"server_run_id\":\"run:held\""), "status_shows_server_run_id");
		const std::string Trace = Rig.Trace.All(Rig.Session.RunId());
		Expect(Contains(Trace, "\"server_run_id\":\"run:held\""), "trace_server_run_id_after_admission");
	}

	{
		FRig Rig(1);
		const FCommandOutcome Started = Rig.Session.Dispatch("demo-mission", "");
		Expect(Started.bSent, "admit_dispatch");
		const std::string Body = AdmissionBody(Rig.Session.RunId(), "ADMISSION_HELD", nullptr, false, false);
		Rig.Session.OnDispatchHttp(Http(202, Body, false));
		Expect(Rig.Session.UiState() == EJuliusUiState::AdmittedWaiting, "admit_202_state");
		Expect(Rig.Session.PlayerLabel() == LabelAdmitted, "admit_202_label");
		Expect(!Rig.Session.HasServerRunId(), "server_run_id_absent_ignored");
		Expect(Contains(Rig.Session.StatusJson(), "\"server_run_id\":null"), "status_server_run_id_null");
		Expect(Contains(Rig.Trace.All(Rig.Session.RunId()), "\"server_run_id\":null"), "trace_server_run_id_null_after_admission");
		const std::string Key = Header(Started.Request, "x-relay-idempotency-key");
		Expect(!Contains(Rig.Session.SavedText(), Key), "admitted_save_drops_key");
		const int Fills = Rig.Random.Fills;
		const std::string Later = AdmissionBody(Rig.Session.RunId(), "ADMISSION_HELD", "run:later", false, false);
		Rig.Session.OnDispatchHttp(Http(200, Later, true));
		Expect(!Rig.Session.IsFailClosed(), "server_run_id_arriving_later_is_not_a_mismatch");
		Expect(Rig.Session.ServerRunId() == "run:later", "server_run_id_stored_when_first_seen");
		Expect(Rig.Random.Fills == Fills, "later_server_run_id_does_not_mint");
		Rig.Session.OnDispatchHttp(Http(200, AdmissionBody(Rig.Session.RunId(), "ADMISSION_HELD", "null", false, false), true));
		Expect(Rig.Session.ServerRunId() == "run:later", "absent_resend_keeps_server_run_id");
		Expect(!Rig.Session.IsFailClosed(), "absent_resend_is_not_an_error");
	}

	{
		FRig Rig(2);
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "mismatch_dispatch");
		Rig.Session.OnDispatchHttp(Http(202, AdmissionBody(Rig.Session.RunId(), "ADMISSION_HELD", "run:one", false, true), false));
		Expect(Rig.Session.UiState() == EJuliusUiState::AdmittedWaiting, "dispatch_providers_running_is_not_running");
		Expect(Rig.Session.PlayerLabel() == LabelAdmitted, "dispatch_202_label_even_with_providers_flag");
		const int Fills = Rig.Random.Fills;
		Rig.Session.OnDispatchHttp(Http(200, AdmissionBody(Rig.Session.RunId(), "ADMISSION_HELD", "run:one", false, false), true));
		Expect(!Rig.Session.IsFailClosed(), "server_run_id_same_on_resend");
		Rig.Session.OnDispatchHttp(Http(200, AdmissionBody(Rig.Session.RunId(), "ADMISSION_HELD", "run:two", false, false), true));
		Expect(Rig.Session.IsFailClosed(), "server_run_id_mismatch_fail_closed");
		Expect(Rig.Session.UiState() == EJuliusUiState::Failed, "mismatch_ui_failed");
		Expect(Rig.Session.PlayerLabel() == LabelServerRunMismatch, "mismatch_label");
		Expect(Rig.Session.ServerRunId() == "run:one", "mismatch_keeps_first_server_run_id");
		const std::string Trace = Rig.Trace.All(Rig.Session.RunId());
		Expect(Contains(Trace, "\"event\":\"error\""), "mismatch_error_event");
		Expect(Contains(Trace, "server_run_id_mismatch"), "mismatch_reason");
		Expect(Contains(Trace, "\"conflicting_server_run_id\":\"run:two\""), "mismatch_conflicting_id");
		Expect(Rig.Trace.CountEvent(Rig.Session.RunId(), "refusal_shown") == 0, "mismatch_is_not_a_refusal");
		Expect(!Rig.Session.Dispatch("demo-mission", "").bSent, "mismatch_does_not_mint");
		Expect(Rig.Random.Fills == Fills, "mismatch_fill_count_unchanged");
		Expect(Contains(Rig.Session.StatusJson(), "\"server_run_id\":\"run:one\""), "status_keeps_first_server_run_id");
		Expect(Contains(Rig.Session.StatusJson(), "\"fail_closed\":true"), "status_fail_closed");
	}

	{
		FRig Rig(1);
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "invalid_server_run_dispatch");
		const int Fills = Rig.Random.Fills;
		Rig.Session.OnDispatchHttp(Http(202, AdmissionBody(Rig.Session.RunId(), "ADMISSION_HELD", "number", false, false), false));
		Expect(Rig.Session.IsFailClosed(), "server_run_id_unreadable_fail_closed");
		Expect(!Rig.Session.Dispatch("other-mission", "").bSent, "unreadable_does_not_mint");
		Expect(Rig.Random.Fills == Fills, "unreadable_fill_count");
	}

	struct FUiRow
	{
		const char* Name;
		int Status;
		const char* Kind;
		bool bTransport;
		const char* Token;
		const char* Label;
		bool bRefusal;
	};
	const FUiRow Rows[] = {
		{ "ui_202_admission_held", 202, "ADMISSION_HELD", false, "admitted_waiting", LabelAdmitted, false },
		{ "ui_200_replay", 200, "ADMISSION_HELD", false, "admitted_waiting", LabelAdmitted, false },
		{ "ui_busy", 429, "julius_dispatch_busy", false, "queued_busy", LabelQueuedBusy, false },
		{ "ui_cap", 429, "julius_dispatch_cap_reached", false, "refused", "julius_dispatch_cap_reached", true },
		{ "ui_mission_cap", 429, "julius_dispatch_mission_cap_reached", false, "refused", "julius_dispatch_mission_cap_reached", true },
		{ "ui_unknown_429", 429, "julius_dispatch_kind_nobody_named", false, "still_waiting", LabelStillWaiting, false },
		{ "ui_bare_500", 500, "", false, "still_waiting", LabelStillWaiting, false },
		{ "ui_transport", 0, "", true, "still_waiting", LabelStillWaiting, false },
		{ "ui_disabled_503", 503, "julius_dispatch_disabled", false, "refused", "julius_dispatch_disabled", true },
	};
	for (const FUiRow& Row : Rows)
	{
		FRig Rig(1);
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, std::string(Row.Name) + "_send");
		std::string Body;
		if (Row.bTransport || Row.Kind[0] == '\0') { Body.clear(); }
		else if (std::strcmp(Row.Kind, "ADMISSION_HELD") == 0) { Body = AdmissionBody(Rig.Session.RunId(), "ADMISSION_HELD", "run:row", false, false); }
		else
		{
			Body = std::string("{\"error\":{\"kind\":\"") + Row.Kind + "\",\"message\":\"x\"}}";
		}
		Rig.Session.OnDispatchHttp(Http(Row.Status, Body, false, Row.bTransport));
		Expect(std::string(UiStateToken(Rig.Session.UiState())) == Row.Token, std::string(Row.Name) + "_token");
		Expect(Rig.Session.PlayerLabel() == Row.Label, std::string(Row.Name) + "_label");
		const bool bRefusal = Rig.Trace.CountEvent(Rig.Session.RunId(), "refusal_shown") == 1;
		Expect(bRefusal == Row.bRefusal, std::string(Row.Name) + "_refusal");
		if (!Row.bRefusal)
		{
			Expect(Rig.Session.PlayerLabel() != "julius_dispatch_cap_reached", std::string(Row.Name) + "_not_cap_label");
		}
		Expect(std::string(UiStateToken(Rig.Session.UiState())) != "running", std::string(Row.Name) + "_not_running");
	}

	{
		FRig Rig(1);
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "status_dispatch");
		Rig.Session.OnDispatchHttp(Http(202, AdmissionBody(Rig.Session.RunId(), "ADMISSION_HELD", "run:status", false, false), false));
		const std::string Run = Rig.Session.RunId();
		Rig.Session.OnStatusHttp(Http(200, std::string("{\"data\":{\"runId\":\"") + Run + "\",\"state\":\"RUNNING\"}}", false));
		Expect(Rig.Session.UiState() == EJuliusUiState::AdmittedWaiting, "status_running_word_is_not_running");
		Rig.Session.OnStatusHttp(Http(200, "{\"data\":{\"providersRunning\":false,\"state\":\"RUNNING\"}}", false));
		Expect(Rig.Session.UiState() == EJuliusUiState::AdmittedWaiting, "status_providers_false_stays_admitted");
		Rig.Session.OnStatusHttp(Http(200, "{\"data\":{\"progressPct\":null}}", false));
		Expect(Rig.Trace.CountEvent(Run, "progress") == 0, "progress_null_is_not_zero");
		Rig.Session.OnStatusHttp(Http(200, "{\"data\":{\"providersRunning\":true,\"providerRequestId\":\"req_1\",\"modelId\":\"gpt-test\",\"progressPct\":40,\"progressStep\":\"plan\"}}", false));
		Expect(Rig.Session.UiState() == EJuliusUiState::Running, "status_providers_true_is_running");
		Expect(Rig.Session.PlayerLabel() == LabelRunning, "running_label");
		const std::string Trace = Rig.Trace.All(Run);
		Expect(Contains(Trace, "\"pct\":40"), "progress_pct");
		Expect(Contains(Trace, "\"step\":\"plan\""), "progress_step");
		Expect(Contains(Trace, "\"provider_request_id\":\"req_1\""), "proposed_provider_request_id");
		Expect(Contains(Trace, "\"model_id\":\"gpt-test\""), "proposed_model_id");
		Expect(Contains(Trace, "\"provider_fields\":\"PROPOSED\""), "provider_fields_marked_proposed");
		Expect(Contains(Trace, "\"server_run_id\":\"run:status\""), "status_trace_keeps_server_run_id");
	}

	{
		FRig Rig(1);
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "artifact_dispatch");
		const std::string Run = Rig.Session.RunId();
		Rig.Session.OnDispatchHttp(Http(202, AdmissionBody(Run, "ADMISSION_HELD", "run:art", false, false), false));
		const std::string ArtifactSha = "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19";
		const std::string Inner = std::string("{\"runId\":\"") + Run
			+ "\",\"missionId\":\"demo-mission\",\"mode\":\"fake\",\"state\":\"COMPLETED\",\"failure\":null,\"artifactSha256\":\""
			+ ArtifactSha + "\",\"artifactText\":\"x y\"}";
		std::string Escaped;
		for (const char C : Inner)
		{
			if (C == '"') { Escaped += "\\\""; }
			else { Escaped.push_back(C); }
		}
		const std::string Outer = std::string("{\"data\":{\"runId\":\"") + Run
			+ "\",\"state\":\"COMPLETED\",\"mode\":\"fake\",\"resultSha256\":\"" + Sha256Hex(Inner)
			+ "\",\"resultText\":\"" + Escaped + "\",\"artifactId\":\"art-1\",\"mime\":\"text/plain\"}}";
		Rig.Session.OnStatusHttp(Http(200, Outer, false));
		Expect(Rig.Session.UiState() == EJuliusUiState::Completed, "artifact_completed_state");
		Expect(Rig.Session.PlayerLabel() == "pending judge", "artifact_pending_judge");
		Expect(Rig.Session.ArtifactLabel() == "pending judge", "artifact_label");
		Expect(Rig.Session.ArtifactDigest12() == "887fcea6a803", "artifact_digest12");
		const std::string Trace = Rig.Trace.All(Run);
		Expect(Contains(Trace, "\"event\":\"artifact_shown\""), "artifact_shown_event");
		Expect(Contains(Trace, ArtifactSha), "artifact_shown_sha256");
		Expect(Contains(Trace, "\"artifact_id\":\"art-1\""), "artifact_id_proposed");
		Expect(Contains(Trace, "\"mime\":\"text/plain\""), "artifact_mime_proposed");
		Expect(!Contains(Trace, "\"pass\""), "artifact_trace_has_no_pass");
		Expect(Rig.Session.PlayerLabel().find("pass") == std::string::npos, "artifact_label_has_no_pass");
	}

	{
		FRig Rig(1);
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "redacted_dispatch");
		const std::string Run = Rig.Session.RunId();
		Rig.Session.OnDispatchHttp(Http(202, AdmissionBody(Run, "ADMISSION_HELD", nullptr, false, false), false));
		const std::string Text = "hello [redacted]";
		const std::string ArtifactSha = Sha256Hex(Text);
		const std::string Inner = std::string("{\"runId\":\"") + Run
			+ "\",\"missionId\":\"demo-mission\",\"mode\":\"fake\",\"state\":\"COMPLETED\",\"failure\":null,\"artifactSha256\":\""
			+ ArtifactSha + "\",\"artifactText\":\"" + Text + "\"}";
		std::string Escaped;
		for (const char C : Inner)
		{
			if (C == '"') { Escaped += "\\\""; }
			else { Escaped.push_back(C); }
		}
		const std::string Outer = std::string("{\"data\":{\"runId\":\"") + Run
			+ "\",\"state\":\"COMPLETED\",\"mode\":\"fake\",\"resultSha256\":\"" + Sha256Hex(Inner)
			+ "\",\"resultText\":\"" + Escaped + "\"}}";
		Rig.Session.OnStatusHttp(Http(200, Outer, false));
		Expect(Rig.Session.PlayerLabel() == "unverified", "artifact_redacted_unverified");
		Expect(Rig.Session.PlayerLabel() != "pending judge", "redacted_is_not_pending_judge");
	}

	{
		FRig Rig(1);
		for (int Extra = 0; Extra < 8; ++Extra) { Rig.Random.Add(static_cast<std::uint8_t>(30 + Extra)); }
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "resend_schedule_dispatch");
		const std::string Run = Rig.Session.RunId();
		const int FillsAtStart = Rig.Random.Fills;
		Rig.Session.OnDispatchHttp(Http(0, "", false, true));
		int Resends = 0;
		while (Resends < 8)
		{
			const FResendDecision Decision = NextResend(static_cast<std::uint32_t>(Resends), Rig.Clock.Now - 1700000000000ull);
			if (Decision.Step != EResendStep::WaitThenResend) { break; }
			Rig.Clock.Now += Decision.DelayMs;
			const FTickOutcome Tick = Rig.Session.Tick();
			Expect(Tick.bSend, std::string("resend_tick_") + std::to_string(Resends));
			if (!Tick.bSend) { break; }
			Expect(Tick.Request.RunId == Run, "resend_tick_same_run");
			Expect(Tick.Request.bResend, "resend_tick_marked");
			Rig.Session.OnDispatchHttp(Http(0, "", true, true));
			++Resends;
		}
		Expect(Resends == 8, "resend_count_matches_next_resend");
		Expect(Rig.Session.UiState() == EJuliusUiState::StillWaiting, "still_waiting_after_schedule");
		Expect(Rig.Session.PlayerLabel() == LabelStillWaiting, "still_waiting_label_after_schedule");
		const int Fills = Rig.Random.Fills;
		Expect(Fills == FillsAtStart + 8, "schedule_resends_do_not_mint");
		Expect(!Rig.Session.Dispatch("demo-mission", "").bSent, "still_waiting_never_mints");
		Expect(Rig.Random.Fills == Fills, "still_waiting_fill_count");
		Expect(!Rig.Session.Resend().bSent, "manual_resend_after_still_waiting_sends_nothing");
		Expect(Rig.Random.Fills == Fills, "manual_resend_after_limit_does_not_mint");
	}

	{
		FRig Rig(1);
		Rig.Random.Add(41);
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "manual_resend_dispatch");
		const std::string Run = Rig.Session.RunId();
		const std::string Key = Header(Rig.Session.Dispatch("ignored", "").Request, "x-relay-idempotency-key");
		Expect(Key.empty(), "second_dispatch_blocked_while_open");
		Rig.Session.OnDispatchHttp(Http(0, "", false, true));
		const int Fills = Rig.Random.Fills;
		const FCommandOutcome Again = Rig.Session.Resend();
		Expect(Again.bSent, "manual_resend_sends");
		Expect(Again.Request.RunId == Run, "manual_resend_same_run");
		Expect(Again.Request.bResend, "manual_resend_flag");
		Expect(Rig.Random.Fills == Fills + 1, "manual_resend_only_request_id");
	}

	{
		FRig Rig(2);
		const FCommandOutcome FirstSend = Rig.Session.Dispatch("demo-mission", "");
		Expect(FirstSend.bSent, "cap_dispatch");
		const std::string First = Rig.Session.RunId();
		const std::string FirstKey = Header(FirstSend.Request, "x-relay-idempotency-key");
		Rig.Session.OnDispatchHttp(Http(429, "{\"error\":{\"kind\":\"julius_dispatch_cap_reached\",\"message\":\"cap\"}}", false));
		Expect(Rig.Session.UiState() == EJuliusUiState::Refused, "cap_refused");
		const FCommandOutcome Next = Rig.Session.Dispatch("demo-mission", "");
		Expect(Next.bSent, "cap_allows_a_later_mint");
		Expect(Next.Request.RunId != First, "cap_mints_a_fresh_run");
		Expect(Header(Next.Request, "x-relay-idempotency-key") != FirstKey, "cap_mints_a_fresh_key");
	}

	{
		FRig Rig(1);
		Rig.Session.SetBaseUrl("http://example.com");
		Expect(!Rig.Session.Dispatch("demo-mission", "").bSent, "public_endpoint_refused");
		Expect(Rig.Random.Fills == 0, "public_endpoint_does_not_mint");
		Expect(Rig.Session.SetBaseUrl("http://127.0.0.1:9"), "loopback_override_accepted");
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "loopback_override_can_send");
		Expect(Contains(Rig.Session.StatusJson(), "127.0.0.1:9") == false, "status_does_not_need_the_url");
	}

	{
		FScriptRandom Random;
		FClock Clock;
		FMemTrace Trace;
		FMemStore Store;
		FJuliusMissionSession Session(Random, Clock, Trace, Store);
		Session.SetProjectId("proj-1");
		Session.SetNativeSessionToken("SECRET_TOKEN_VALUE");
		Expect(!Session.Dispatch("demo-mission", "").bSent, "random_failure_refuses");
		Expect(Session.UiState() == EJuliusUiState::Idle, "random_failure_stays_idle");
		Expect(Trace.CountEvent("_unminted", "error") == 1, "random_failure_error_event");
		Expect(!Contains(Trace.All("_unminted"), "SECRET_TOKEN_VALUE"), "unminted_trace_omits_token");
	}

	{
		FRig Rig(1);
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "heartbeat_dispatch");
		const std::string Run = Rig.Session.RunId();
		Rig.Clock.Now += 4999;
		Rig.Session.Tick();
		Expect(Rig.Trace.CountEvent(Run, "heartbeat") == 0, "heartbeat_not_before_5s");
		Rig.Clock.Now += 1;
		Rig.Session.Tick();
		Expect(Rig.Trace.CountEvent(Run, "heartbeat") == 1, "heartbeat_at_5s");
		const std::string Beat = Rig.Trace.Lines[Run].back();
		Expect(Contains(Beat, "\"system_clock_utc_ms\":"), "heartbeat_system_clock");
		Expect(Contains(Beat, "\"ntp_offset_ms\":null"), "heartbeat_ntp_unknown_is_null");
		Expect(Contains(Beat, "\"ts_utc_ms\":"), "heartbeat_epoch");
		Rig.Session.SetClockOffset(true, 250, "ntp");
		Rig.Clock.Now += 5000;
		Rig.Session.Tick();
		Expect(Contains(Rig.Trace.Lines[Run].back(), "\"ntp_offset_ms\":250"), "heartbeat_ntp_offset");
		Expect(Contains(Rig.Trace.Lines[Run].back(), "\"clock_offset_source\":\"ntp\""), "heartbeat_ntp_source");
	}

	{
		FRig Rig(1);
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "observer_dispatch");
		const std::string Run = Rig.Session.RunId();
		const std::string Before = Rig.Session.PlayerLabel();
		FObserverReceipt Receipt;
		Receipt.RunId = Run;
		Receipt.PlayerNetId = "observer-2";
		Receipt.UiStateToken = "admitted_waiting";
		Receipt.UiLabel = LabelAdmitted;
		Receipt.bServerRunIdKnown = true;
		Receipt.ServerRunId = "run:obs";
		Rig.Session.NoteObserverReceipt(Receipt);
		Expect(Rig.Session.PlayerLabel() == Before, "observer_does_not_change_sender");
		const std::string Line = Rig.Trace.Lines[Run].back();
		Expect(Contains(Line, "\"client_role\":\"observer\""), "observer_role");
		Expect(Contains(Line, "\"wlj_run_id\":\"" + Run + "\""), "observer_same_run");
		Expect(Contains(Line, "\"server_run_id\":\"run:obs\""), "observer_server_run_id");
		Expect(Contains(Line, "\"player_net_id\":\"observer-2\""), "observer_player");
		Expect(Rig.Random.Fills == 3, "observer_does_not_mint");
		FObserverReceipt Bad;
		Bad.RunId = "not-a-run";
		Rig.Session.NoteObserverReceipt(Bad);
		Expect(Rig.Trace.LineCount("not-a-run") == 0, "observer_rejects_bad_run");
	}

	{
		const std::filesystem::path Scratch = MakeScratchDirectory();
		Expect(!Scratch.empty(), "temp_dir");
		if (!Scratch.empty())
		{
			class FDirTrace final : public ITraceSink
			{
			public:
				std::string Root;
				explicit FDirTrace(std::string InRoot) : Root(std::move(InRoot)) {}
				bool Append(std::string_view RunId, std::string_view Line) override
				{
					const std::filesystem::path File(PathFor(RunId));
					std::error_code Error;
					std::filesystem::create_directories(File.parent_path(), Error);
					if (Error) { return false; }
					std::ofstream Out(File, std::ios::app | std::ios::binary);
					Out << std::string(Line);
					return static_cast<bool>(Out);
				}
				std::string PathFor(std::string_view RunId) const override { return JuliusTraceFilePath(Root, RunId); }
				std::size_t LineCount(std::string_view RunId) const override
				{
					std::ifstream In(PathFor(RunId));
					std::size_t Count = 0;
					std::string Line;
					while (std::getline(In, Line)) { ++Count; }
					return Count;
				}
			};
			class FFileStore final : public ITextStore
			{
			public:
				std::string Path;
				explicit FFileStore(std::string InPath) : Path(std::move(InPath)) {}
				bool Write(std::string_view Text) override
				{
					const std::filesystem::path File(Path);
					std::error_code Error;
					std::filesystem::create_directories(File.parent_path(), Error);
					if (Error) { return false; }
					std::ofstream Out(File, std::ios::binary | std::ios::trunc);
					Out << std::string(Text);
					return static_cast<bool>(Out);
				}
				bool Read(std::string& OutText) override
				{
					std::ifstream In(Path, std::ios::binary);
					if (!In) { return false; }
					OutText.assign(std::istreambuf_iterator<char>(In), std::istreambuf_iterator<char>());
					return !OutText.empty();
				}
			};
			FScriptRandom Random;
			Random.Add(9); Random.Add(99); Random.Add(199);
			Random.Add(11);
			FClock Clock;
			FDirTrace Trace(Scratch.string());
			FFileStore Store((Scratch / "open-pair.v1").string());
			FJuliusMissionSession Session(Random, Clock, Trace, Store);
			Session.SetProjectId("proj-1");
			Session.SetNativeSessionToken("SECRET_TOKEN_VALUE");
			Session.SetExpectedResultMode("fake");
			Expect(Session.Dispatch("demo-mission", "").bSent, "file_dispatch");
			Session.OnDispatchHttp(Http(0, "", false, true));
			const std::string Run = Session.RunId();
			Expect(Trace.LineCount(Run) >= 2, "trace_file_appended");
			std::ifstream In(Trace.PathFor(Run));
			std::string File;
			File.assign(std::istreambuf_iterator<char>(In), std::istreambuf_iterator<char>());
			Expect(!Contains(File, "SECRET_TOKEN_VALUE"), "trace_file_omits_token");
			Expect(Contains(Store.Path, "open-pair.v1"), "save_path_set");
			FScriptRandom Random2;
			Random2.Add(21);
			FFileStore Store2(Store.Path);
			FDirTrace Trace2(Scratch.string());
			FJuliusMissionSession Session2(Random2, Clock, Trace2, Store2);
			Expect(Session2.Load(), "file_save_round_trip");
			Expect(Session2.RunId() == Run, "file_save_same_run");
			std::string Disk;
			Expect(Store2.Read(Disk), "file_save_reads");
			Expect(Contains(Disk, Run), "file_save_has_run");
			Expect(!Contains(Disk, "SECRET_TOKEN_VALUE"), "file_save_omits_token");
			std::error_code Removed;
			std::filesystem::remove_all(Scratch, Removed);
		}
	}

	{
		FRig Empty(0);
		Expect(!Empty.Session.Load(), "missing_save_is_not_a_pair");
		Empty.Store.Text = "WJ1OPEN 1\nphase open\n";
		Expect(!Empty.Session.Load(), "corrupt_save_fails_closed");
		Expect(Empty.Session.UiState() == EJuliusUiState::Idle, "corrupt_save_stays_idle");
		Expect(Empty.Random.Fills == 0, "corrupt_save_does_not_mint");
	}

	{
		class FDenyTrace final : public ITraceSink
		{
		public:
			bool Append(std::string_view, std::string_view) override { return false; }
			std::string PathFor(std::string_view RunId) const override { return JuliusTraceFilePath("/saved", RunId); }
			std::size_t LineCount(std::string_view) const override { return 0; }
		};
		FScriptRandom Random;
		Random.Add(1);
		Random.Add(2);
		Random.Add(3);
		FClock Clock;
		FDenyTrace Trace;
		FMemStore Store;
		FJuliusMissionSession Session(Random, Clock, Trace, Store);
		Session.SetProjectId("proj-1");
		Session.SetNativeSessionToken("SECRET_TOKEN_VALUE");
		Session.SetExpectedResultMode("fake");
		const FCommandOutcome Denied = Session.Dispatch("demo-mission", "");
		Expect(!Denied.bSent, "trace_write_failure_does_not_send");
		Expect(Denied.Detail == "trace was not written", "trace_write_failure_detail");
		Expect(!Session.RunId().empty(), "trace_write_failure_keeps_pair");
		Expect(Contains(Session.SavedText(), "key "), "trace_write_failure_persists_key");
		const int Fills = Random.Fills;
		Expect(!Session.Dispatch("other-mission", "").bSent, "trace_write_failure_does_not_mint");
		Expect(Random.Fills == Fills, "trace_write_failure_fill_count");
	}

	if (Failures == 0)
	{
		std::printf("J1 WRAPPER KAT PASS\n");
		return 0;
	}
	std::printf("J1 WRAPPER KAT FAIL %d\n", Failures);
	return 1;
}
