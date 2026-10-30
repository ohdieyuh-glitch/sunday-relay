// WONDERLAND -- J1 client wrapper known-answer tests. No Unreal, no network, no secrets that leave the process.
//
//   g++ -std=c++17 -Wall -Wextra -Werror -Wshadow -pedantic -I wonderland/Source/Wonderland -I wonderland/Source
//       wonderland/Tools/j1_wrapper_kat.cpp
//       wonderland/Source/Wonderland/WonderlandJuliusMissionClient.cpp
//       wonderland/Source/Wonderland/WonderlandJuliusMissionProgress.cpp
//       wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.cpp
//       -o j1_wrapper_kat && ./j1_wrapper_kat
//
//   clang++ -std=c++17 -Wall -Wextra -Werror -Wshadow -pedantic -I wonderland/Source/Wonderland -I wonderland/Source
//       wonderland/Tools/j1_wrapper_kat.cpp
//       wonderland/Source/Wonderland/WonderlandJuliusMissionClient.cpp
//       wonderland/Source/Wonderland/WonderlandJuliusMissionProgress.cpp
//       wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.cpp
//       -o j1_wrapper_kat && ./j1_wrapper_kat
//
//   cl /std:c++17 /EHsc /W4 /WX /we4458 /we4456 /we4457 /I wonderland\Source\Wonderland /I wonderland\Source
//       wonderland\Tools\j1_wrapper_kat.cpp
//       wonderland\Source\Wonderland\WonderlandJuliusMissionClient.cpp
//       wonderland\Source\Wonderland\WonderlandJuliusMissionProgress.cpp
//       wonderland\Source\Wonderland\WonderlandJuliusMissionLogic.cpp
//
// -I wonderland/Source is the Unreal include root. Julius/ names a module-root header as
// Wonderland/<Header>.h, so this file includes those paths too and the check below rejects a bare name.
//
// The scratch directory uses std::filesystem, std::chrono and std::thread. Those three cover
// POSIX and Windows, so this file has no unistd.h, no direct _WIN32 branch, and no mkdir.
//
// Each Expect name is the test the presentation spec cites.
#include "WonderlandJuliusMissionClient.h"
#include "Wonderland/WonderlandJuliusMissionClient.h"
#include "Wonderland/Julius/WonderlandJuliusRandomBytes.h"

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

	std::string BridgeStatusBody(const std::string& RunId, const char* State, const char* ServerRun, const char* DispatchedAt, const char* Cause)
	{
		// Contract v0.1 status route: top-level. A run: server id is the legacy pin; a wlj_ server id
		// (this client's own) carries legacyRunId null.
		const bool bLegacyServer = std::strncmp(ServerRun, "run:", 4) == 0;
		std::string Body = "{\"wljRunId\":\"";
		Body += RunId;
		Body += "\",\"serverRunId\":\"";
		Body += ServerRun;
		Body += "\",\"legacyRunId\":";
		if (bLegacyServer)
		{
			Body += "\"";
			Body += ServerRun;
			Body += "\"";
		}
		else
		{
			Body += "null";
		}
		Body += ",\"workflowRunId\":null,\"state\":\"";
		Body += State;
		Body += "\",\"dispatchedAt\":";
		if (DispatchedAt != nullptr)
		{
			Body += "\"";
			Body += DispatchedAt;
			Body += "\"";
		}
		else
		{
			Body += "null";
		}
		if (Cause != nullptr)
		{
			Body += ",\"cause\":\"";
			Body += Cause;
			Body += "\"";
		}
		Body += "}";
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

	// Quoted include of a header that lives directly in Source/Wonderland. A slash is a path
	// (Wonderland/<Header>.h). Angle-bracket includes are the engine or the standard library.
	bool JuliusBareModuleRootInclude(std::string_view Line, std::string& Header)
	{
		std::size_t Start = 0;
		while (Start < Line.size() && (Line[Start] == ' ' || Line[Start] == '\t')) { ++Start; }
		const std::string_view Rest = Line.substr(Start);
		const std::string_view Key = "#include";
		if (Rest.size() < Key.size() || Rest.substr(0, Key.size()) != Key) { return false; }
		std::size_t Cursor = Key.size();
		while (Cursor < Rest.size() && (Rest[Cursor] == ' ' || Rest[Cursor] == '\t')) { ++Cursor; }
		if (Cursor >= Rest.size() || Rest[Cursor] != '"') { return false; }
		++Cursor;
		const std::size_t End = Rest.find('"', Cursor);
		if (End == std::string_view::npos) { return false; }
		const std::string_view Name = Rest.substr(Cursor, End - Cursor);
		if (Name.empty() || Name.find('/') != std::string_view::npos || Name.find('\\') != std::string_view::npos)
		{
			return false;
		}
		Header.assign(Name.begin(), Name.end());
		return true;
	}

	/** The UE subsystem's source text (it cannot be compiled here; a few founder rules are checked as text). */
	std::string SubsystemSource()
	{
		namespace fs = std::filesystem;
		for (fs::path Dir = fs::current_path();; Dir = Dir.parent_path())
		{
			const fs::path File = Dir / "wonderland/Source/Wonderland/Julius/WonderlandJuliusMissionSubsystem.cpp";
			if (fs::is_regular_file(File))
			{
				std::ifstream In(File);
				return std::string((std::istreambuf_iterator<char>(In)), std::istreambuf_iterator<char>());
			}
			if (!Dir.has_parent_path() || Dir.parent_path() == Dir) { return std::string(); }
		}
	}

	/**
	 * Founder ruling 2026-10-30 (no automatic resend path): in the Julius subsystem the Start request is built in ONE
	 * place, StartPaidMission, and nothing in the subsystem calls StartPaidMission (only the founder's click, from the
	 * widget, does). A reconcile, poll, tick or restore that re-sent a Start would break this.
	 */
	bool CheckNoAutomaticStartResend()
	{
		const std::string Text = SubsystemSource();
		if (Text.empty()) { std::printf("START RESEND CHECK FAIL: subsystem source not found\n"); return false; }
		auto Count = [&Text](const std::string& Needle)
		{
			int N = 0;
			for (std::size_t At = Text.find(Needle); At != std::string::npos; At = Text.find(Needle, At + 1)) { ++N; }
			return N;
		};
		const std::size_t Def = Text.find("bool UWonderlandJuliusMissionSubsystem::StartPaidMission(");
		const std::size_t End = Def == std::string::npos ? std::string::npos : Text.find("\n}\n", Def);
		const std::size_t Send = Text.find("StartRequest(");
		const bool bOk = Def != std::string::npos && End != std::string::npos && Count("StartRequest(") == 1 && Send > Def && Send < End
			&& Count("StartPaidMission(") == 1;
		if (!bOk) { std::printf("START RESEND CHECK FAIL: a Start is built or sent outside the founder's click\n"); }
		return bOk;
	}

	/**
	 * C3 (founder ruling 2026-10-30): a resync request from the live feed (seq gap or reset:true) makes the subsystem read
	 * /status at once and restart the stream read, inside CompleteLiveRead, and never sends a Start there.
	 */
	bool CheckLiveResyncReadsStatus()
	{
		const std::string Text = SubsystemSource();
		const std::size_t Def = Text.find("void UWonderlandJuliusMissionSubsystem::CompleteLiveRead(");
		const std::size_t End = Def == std::string::npos ? std::string::npos : Text.find("\n}\n", Def);
		const std::size_t Take = Text.find("TakeResyncRequest()", Def == std::string::npos ? 0 : Def);
		if (Def == std::string::npos || End == std::string::npos || Take == std::string::npos || Take > End)
		{
			std::printf("LIVE RESYNC CHECK FAIL: CompleteLiveRead does not take the resync request\n");
			return false;
		}
		const std::string Body = Text.substr(Take, End - Take);
		const std::size_t Close = Body.find("\n\t}");
		const std::string Branch = Body.substr(0, Close);
		const bool bOk = Branch.find("NextStatusReadAtUtcMs = 0;") != std::string::npos && Branch.find("bStatusStopped = false;") != std::string::npos
			&& Branch.find("NextLiveReadAtUtcMs = 0;") != std::string::npos && Branch.find("StartPaidMission(") == std::string::npos && Branch.find("StartRequest(") == std::string::npos;
		if (!bOk) { std::printf("LIVE RESYNC CHECK FAIL: a resync does not re-read /status and the stream at once\n"); }
		return bOk;
	}

	/**
	 * YUJI M-b 2026-10-30: a new-key Start replaces the earlier intent, so the same logical Start reuses the persisted
	 * key and clientTriggerId: each is minted only when empty, and the key is dropped only when the run changes.
	 */
	bool CheckStartKeyReused()
	{
		const std::string Text = SubsystemSource();
		auto Count = [&Text](const std::string& Needle)
		{
			int N = 0;
			for (std::size_t At = Text.find(Needle); At != std::string::npos; At = Text.find(Needle, At + 1)) { ++N; }
			return N;
		};
		auto GuardedBy = [&Text](const std::string& Assign, const std::string& Guard)
		{
			// The assignment sits inside the block the guard opens (before that block closes).
			const std::size_t If = Text.find(Guard);
			const std::size_t At = Text.find(Assign);
			const std::size_t Close = If == std::string::npos ? std::string::npos : Text.find("\n\t}", If);
			return If != std::string::npos && At != std::string::npos && Close != std::string::npos && At > If && At < Close;
		};
		const std::size_t Sync = Text.find("void UWonderlandJuliusMissionSubsystem::SyncStartRecord()");
		const std::size_t SyncEnd = Sync == std::string::npos ? std::string::npos : Text.find("\n}\n", Sync);
		const std::size_t Reset = Text.find("StartKey.Reset();");
		const bool bOk = Count("StartKey = ToF(Minted);") == 1 && GuardedBy("StartKey = ToF(Minted);", "if (StartKey.IsEmpty())")
			&& Count("StartTriggerId = ToF(Minted);") == 1 && GuardedBy("StartTriggerId = ToF(Minted);", "if (StartTriggerId.IsEmpty())")
			&& Count("StartKey.Reset();") == 1 && Reset > Sync && Reset < SyncEnd;
		if (!bOk) { std::printf("START KEY REUSE CHECK FAIL: a Start key or trigger is minted while one is held\n"); }
		return bOk;
	}

	/**
	 * C5 (Skywalker 2026-10-30, founder, YUJI): the contract is driven by backend state only. Every Start gate passes
	 * through RecordedReplayGate (R1: a recorded replay refuses Start); the success beat is gated by this run's /status
	 * before the cursor advances; the stage is cleared only on suspend, an ending, or outcome-unknown (never for grading,
	 * never blank); and no timer drives the presentation.
	 */
	bool CheckEndingsFollowBackendState()
	{
		const std::string Text = SubsystemSource();
		auto CountIn = [](const std::string& Hay, const std::string& Needle)
		{
			int N = 0;
			for (std::size_t At = Hay.find(Needle); At != std::string::npos; At = Hay.find(Needle, At + 1)) { ++N; }
			return N;
		};
		const std::size_t Def = Text.find("void UWonderlandJuliusMissionSubsystem::SyncMissionContract()");
		const std::size_t End = Def == std::string::npos ? std::string::npos : Text.find("\n}\n", Def);
		if (Def == std::string::npos || End == std::string::npos) { std::printf("ENDINGS CHECK FAIL: SyncMissionContract not found\n"); return false; }
		const std::string Body = Text.substr(Def, End - Def);
		const std::size_t View = Body.find("ExecutionViewFor(Host->LiveFeed");
		const std::size_t Gated = Body.find("View.Phase = SuccessGatedByStatus(View.Phase,");
		const std::size_t Advance = Body.find("ContractCursor->Advance(View)");
		const bool bGates = CountIn(Text, "StartGateFor(") >= 1 && CountIn(Text, "StartGateFor(") == CountIn(Text, "RecordedReplayGate(");
		const bool bSuccess = View != std::string::npos && Gated != std::string::npos && Advance != std::string::npos && View < Gated && Gated < Advance
			&& CountIn(Body, "SuccessGatedByStatus(") == 1;
		const bool bReleases = CountIn(Body, "ReleaseRealRunBeat()") == 3 && Body.find("bGradingReleased") == std::string::npos;
		const bool bNoTimer = Body.find("SetTimer") == std::string::npos && Body.find("FTimerHandle") == std::string::npos;
		if (!bGates) { std::printf("ENDINGS CHECK FAIL: a Start gate is not refused during a recorded replay\n"); }
		if (!bSuccess) { std::printf("ENDINGS CHECK FAIL: the success beat is not gated by the verified /status\n"); }
		if (!bReleases) { std::printf("ENDINGS CHECK FAIL: the stage is released outside suspend / ending / outcome-unknown\n"); }
		if (!bNoTimer) { std::printf("ENDINGS CHECK FAIL: a timer drives the presentation\n"); }
		return bGates && bSuccess && bReleases && bNoTimer;
	}

	/**
	 * C6: the evidence lines are written where the state is decided -- the status_read line after an accepted /status
	 * read, the resync line inside the resync branch, and the beat line for every beat the cursor emits.
	 */
	bool CheckEvidenceLogs()
	{
		const std::string Text = SubsystemSource();
		auto Within = [&Text](const std::string& Func, const std::string& From, const std::string& Needle)
		{
			const std::size_t Def = Text.find(Func);
			const std::size_t End = Def == std::string::npos ? std::string::npos : Text.find("\n}\n", Def);
			const std::size_t After = Def == std::string::npos ? std::string::npos : Text.find(From, Def);
			const std::size_t At = After == std::string::npos ? std::string::npos : Text.find(Needle, After);
			return End != std::string::npos && At != std::string::npos && At < End;
		};
		const bool bStatus = Within("void UWonderlandJuliusMissionSubsystem::CompleteStatusRead(", "Host->LastStatus = Read;", "FormatStatusReadLog(ToStd(ForRunId), Read)");
		const bool bResync = Within("void UWonderlandJuliusMissionSubsystem::CompleteLiveRead(", "TakeResyncRequest()", "FormatResyncLog(")
			&& !Within("void UWonderlandJuliusMissionSubsystem::CompleteLiveRead(", "else if (!Read.SkippedSeqs.empty())", "FormatResyncLog(");
		const std::size_t Loop = Text.find("for (const FContractBeat& Beat : ContractCursor->Advance(View))");
		const std::size_t LoopEnd = Loop == std::string::npos ? std::string::npos : Text.find("\n\t}", Loop);
		const std::size_t BeatLog = Loop == std::string::npos ? std::string::npos : Text.find("FormatBeatLog(ToStd(Run), Beat.Type, View.Phase, Host->LiveFeed.LastSeenSeq()", Loop);
		const bool bBeat = LoopEnd != std::string::npos && BeatLog != std::string::npos && BeatLog < LoopEnd;
		if (!bStatus) { std::printf("EVIDENCE LOG CHECK FAIL: no status_read line for an accepted /status read\n"); }
		if (!bResync) { std::printf("EVIDENCE LOG CHECK FAIL: no resync line in the resync branch\n"); }
		if (!bBeat) { std::printf("EVIDENCE LOG CHECK FAIL: a beat is applied without its beat line\n"); }
		return bStatus && bResync && bBeat;
	}

	bool CheckJuliusModuleRootIncludes()
	{
		namespace fs = std::filesystem;
		fs::path Root;
		for (fs::path Dir = fs::current_path();; Dir = Dir.parent_path())
		{
			if (fs::is_directory(Dir / "wonderland/Source/Wonderland/Julius"))
			{
				Root = Dir;
				break;
			}
			if (!Dir.has_parent_path() || Dir.parent_path() == Dir) { break; }
		}
		if (Root.empty())
		{
			std::printf("JULIUS INCLUDE CHECK FAIL: wonderland/Source/Wonderland/Julius not found from the working directory\n");
			return false;
		}
		const fs::path Module = Root / "wonderland/Source/Wonderland";
		int Bad = 0;
		for (const fs::directory_entry& Entry : fs::directory_iterator(Module / "Julius"))
		{
			if (!Entry.is_regular_file()) { continue; }
			const std::string Ext = Entry.path().extension().string();
			if (Ext != ".h" && Ext != ".cpp") { continue; }
			std::ifstream In(Entry.path());
			std::string Line;
			int Number = 0;
			while (std::getline(In, Line))
			{
				++Number;
				std::string Header;
				if (!JuliusBareModuleRootInclude(Line, Header)) { continue; }
				std::error_code Exists;
				if (!fs::is_regular_file(Module / Header, Exists)) { continue; }
				const fs::path Shown = fs::relative(Entry.path(), Root);
				std::printf("JULIUS INCLUDE CHECK FAIL %s:%d includes module-root header \"%s\" by bare name\n",
					Shown.generic_string().c_str(), Number, Header.c_str());
				++Bad;
			}
		}
		if (Bad != 0) { return false; }
		std::printf("JULIUS INCLUDE CHECK PASS\n");
		return true;
	}

	// Drop // and /* */ comments. Newlines stay so a later line scan still matches the source.
	std::string WithoutComments(const std::string& Source)
	{
		std::string Out;
		Out.reserve(Source.size());
		bool LineComment = false;
		bool BlockComment = false;
		for (std::size_t Index = 0; Index < Source.size(); ++Index)
		{
			const char Here = Source[Index];
			const char Next = Index + 1 < Source.size() ? Source[Index + 1] : '\0';
			if (LineComment)
			{
				if (Here == '\n')
				{
					LineComment = false;
					Out.push_back('\n');
				}
				continue;
			}
			if (BlockComment)
			{
				if (Here == '*' && Next == '/')
				{
					BlockComment = false;
					++Index;
				}
				else if (Here == '\n')
				{
					Out.push_back('\n');
				}
				continue;
			}
			if (Here == '/' && Next == '/')
			{
				LineComment = true;
				++Index;
				continue;
			}
			if (Here == '/' && Next == '*')
			{
				BlockComment = true;
				++Index;
				continue;
			}
			Out.push_back(Here);
		}
		return Out;
	}

	// IPlatformCrypto.h only forward-declares EPlatformCryptoResult. Using an enumerator
	// needs the definition in PlatformCryptoTypes.h, and that include has to come first.
	bool CheckPlatformCryptoTypesInclude()
	{
		namespace fs = std::filesystem;
		fs::path Root;
		for (fs::path Dir = fs::current_path();; Dir = Dir.parent_path())
		{
			if (fs::is_directory(Dir / "wonderland/Source/Wonderland/Julius"))
			{
				Root = Dir;
				break;
			}
			if (!Dir.has_parent_path() || Dir.parent_path() == Dir) { break; }
		}
		if (Root.empty())
		{
			std::printf("PLATFORM CRYPTO TYPES CHECK FAIL: wonderland/Source/Wonderland/Julius not found from the working directory\n");
			return false;
		}
		const fs::path Julius = Root / "wonderland/Source/Wonderland/Julius";
		const std::string Enumerator = "EPlatformCryptoResult::";
		int Bad = 0;
		for (const fs::directory_entry& Entry : fs::directory_iterator(Julius))
		{
			if (!Entry.is_regular_file()) { continue; }
			const std::string Ext = Entry.path().extension().string();
			if (Ext != ".h" && Ext != ".cpp") { continue; }
			std::ifstream In(Entry.path());
			std::stringstream Buffer;
			Buffer << In.rdbuf();
			const std::string Source = WithoutComments(Buffer.str());
			int IncludeLine = 0;
			int UseLine = 0;
			int Number = 0;
			std::size_t Cursor = 0;
			while (Cursor <= Source.size())
			{
				const std::size_t End = Source.find('\n', Cursor);
				const std::string Line = Source.substr(Cursor, End == std::string::npos ? std::string::npos : End - Cursor);
				++Number;
				std::string Header;
				if (JuliusBareModuleRootInclude(Line, Header) && Header == "PlatformCryptoTypes.h")
				{
					if (IncludeLine == 0) { IncludeLine = Number; }
				}
				if (UseLine == 0 && Line.find(Enumerator) != std::string::npos) { UseLine = Number; }
				if (End == std::string::npos) { break; }
				Cursor = End + 1;
			}
			if (UseLine == 0) { continue; }
			const fs::path Shown = fs::relative(Entry.path(), Root);
			if (IncludeLine == 0 || IncludeLine > UseLine)
			{
				std::printf("PLATFORM CRYPTO TYPES CHECK FAIL %s:%d uses EPlatformCryptoResult:: without including PlatformCryptoTypes.h first\n",
					Shown.generic_string().c_str(), UseLine);
				++Bad;
			}
		}
		if (Bad != 0) { return false; }
		std::printf("PLATFORM CRYPTO TYPES CHECK PASS\n");
		return true;
	}
}

int main()
{
	Expect(FormatIso8601UtcMs(0) == "1970-01-01T00:00:00.000Z", "iso_epoch");
	Expect(FormatIso8601UtcMs(1700000000000ull) == "2023-11-14T22:13:20.000Z", "iso_known_instant");
	Expect(IsLoopbackBaseUrl("http://127.0.0.1:8790"), "loopback_ipv4");
	Expect(!IsLoopbackBaseUrl("http://localhost"), "localhost_is_not_a_literal_loopback");
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
		// REVIEW #74: an admitted run whose workflow completed without Julius finishing it ends locally, so a NEW mission
		// can be offered -- only for exactly this admitted run, never sending anything, never minting by itself.
		Expect(!Rig.Session.CanStartNewAttempt(), "admitted_unfinished_blocks_new_mission");
		const int FillsBefore = Rig.Random.Fills;
		Expect(!Rig.Session.ConcludeAfterWorkflowEnded("wlj_not_this_run", "DID_NOT_START"), "conclude_refuses_another_run");
		Expect(!Rig.Session.CanStartNewAttempt(), "another_run_changes_nothing");
		Expect(Rig.Session.ConcludeAfterWorkflowEnded(Rig.Session.RunId(), "DID_NOT_START"), "conclude_this_admitted_run");
		Expect(Rig.Session.CanStartNewAttempt(), "concluded_run_permits_a_new_mission");
		Expect(Rig.Random.Fills == FillsBefore, "conclude_never_mints_or_resends");
		Expect(Contains(Rig.Session.SavedText(), "finished 1"), "conclude_is_persisted");
		Expect(!Rig.Session.ConcludeAfterWorkflowEnded(Rig.Session.RunId(), "DID_NOT_START"), "conclude_is_once");
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
		(void)Rig.Session.SetBaseUrl("http://example.com");
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

	{
		const char* const Server = "run:0123456789abcdef01234567";
		FRig Rig(1);
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "l6_dispatch");
		const std::string Run = Rig.Session.RunId();
		Rig.Session.OnDispatchHttp(Http(202, AdmissionBody(Run, "ADMISSION_HELD", Server, false, false), false));
		Expect(Rig.Session.PlayerLabel() == LabelAdmitted, "l6_admission_keeps_paid_run_label");
		Expect(Rig.Session.UiState() == EJuliusUiState::AdmittedWaiting, "l6_admission_stays_admitted_waiting");

		Rig.Session.OnStatusHttp(Http(200, BridgeStatusBody(Run, "awaiting_operator", Server, nullptr, nullptr), false));
		Expect(Rig.Session.UiState() == EJuliusUiState::AdmittedWaiting, "l6_awaiting_operator_token");
		Expect(Rig.Session.PlayerLabel() == ProgressDisplayLabel(EMissionProgress::AdmittedHeld), "l6_awaiting_operator_uses_logic_label");
		Expect(Rig.Session.UiState() != EJuliusUiState::Failed, "l6_awaiting_operator_is_not_failed");

		Rig.Session.OnStatusHttp(Http(200, BridgeStatusBody(Run, "dispatched", Server, "not-a-timestamp", nullptr), false));
		Expect(Rig.Session.UiState() == EJuliusUiState::DispatchUnconfirmed, "l6_bad_dispatched_at_token");
		Expect(Rig.Session.PlayerLabel() == ProgressDisplayLabel(EMissionProgress::DispatchUnconfirmed), "l6_bad_dispatched_at_uses_logic_label");
		Expect(Rig.Session.IsFailClosed() == false, "l6_unconfirmed_is_not_fail_closed");
		Expect(Rig.Session.UiState() != EJuliusUiState::Failed, "l6_unconfirmed_is_not_failed");
	}

	{
		const char* const Server = "run:0123456789abcdef01234567";
		FRig Rig(1);
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "l6_started_dispatch");
		const std::string Run = Rig.Session.RunId();
		Rig.Session.OnDispatchHttp(Http(202, AdmissionBody(Run, "ADMISSION_HELD", Server, false, false), false));
		const std::string When = FormatIso8601UtcMs(Rig.Clock.Now);
		Rig.Session.OnStatusHttp(Http(200, BridgeStatusBody(Run, "dispatched", Server, When.c_str(), nullptr), false));
		Expect(Rig.Session.UiState() == EJuliusUiState::OperatorStarted, "l6_dispatched_at_token");
		Expect(Rig.Session.PlayerLabel() == ProgressDisplayLabel(EMissionProgress::OperatorStarted), "l6_dispatched_at_uses_logic_label");
		Expect(Rig.Session.UiState() != EJuliusUiState::Running, "l6_operator_started_is_not_running");
		Expect(Rig.Session.UiState() != EJuliusUiState::Failed, "l6_operator_started_is_not_failed");
		Rig.Clock.Now += PollDispatchWatchMs + 1;
		const FTickOutcome Tick = Rig.Session.Tick();
		Expect(!Tick.bSend, "l6_dispatch_window_does_not_send");
		Expect(Rig.Trace.CountEvent(Run, "poll_limit_reached") == 1, "l6_dispatch_window_uses_poll_dispatch_budget");
		Expect(Rig.Session.UiState() == EJuliusUiState::OperatorStarted, "l6_dispatch_window_does_not_become_not_started");
		Expect(Rig.Trace.CountEvent(Run, "hold_window_expired") == 0, "l6_dispatch_window_is_not_the_hold");
	}

	{
		const char* const Server = "run:fedcba9876543210fedcba98";
		FRig Rig(1);
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "l6_cause_dispatch");
		const std::string Run = Rig.Session.RunId();
		Rig.Session.OnDispatchHttp(Http(202, AdmissionBody(Run, "ADMISSION_HELD", Server, false, false), false));
		Rig.Session.OnStatusHttp(Http(200, BridgeStatusBody(Run, "failed", Server, nullptr, "AWAITING_OPERATOR_EXPIRED"), false));
		Expect(Rig.Session.UiState() == EJuliusUiState::NotStarted, "l6_operator_window_expired_token");
		Expect(UiStateToken(Rig.Session.UiState()) == std::string("not_started"), "l6_not_started_token_is_neutral");
		Expect(Rig.Session.PlayerLabel() == ProgressDisplayLabel(EMissionProgress::NotStarted), "l6_not_started_uses_logic_label");
		Expect(Rig.Session.UiState() != EJuliusUiState::Failed, "l6_not_started_is_not_failed");
		Expect(Rig.Session.UiState() != EJuliusUiState::Refused, "l6_not_started_is_not_refused");
		Expect(!Rig.Session.IsFailClosed(), "l6_not_started_is_not_fail_closed");
	}

	{
		FRig Rig(1);
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "l6_wlj_server_dispatch");
		const std::string Run = Rig.Session.RunId();
		Rig.Session.OnDispatchHttp(Http(202, AdmissionBody(Run, "ADMISSION_HELD", Run.c_str(), false, false), false));
		Rig.Session.OnStatusHttp(Http(200, BridgeStatusBody(Run, "awaiting_operator", Run.c_str(), nullptr, nullptr), false));
		Expect(Rig.Session.UiState() == EJuliusUiState::AdmittedWaiting, "l6_wlj_server_run_id_is_held");
		Expect(Rig.Session.PlayerLabel() == ProgressDisplayLabel(EMissionProgress::AdmittedHeld), "l6_wlj_server_run_id_uses_logic_label");
		Expect(PollHoldWatchMs == 21720000ull, "l6_hold_window_is_six_hours_plus_one_slow_wait");
	}

	{
		const char* const Server = "run:00112233445566778899aabb";
		FRig Rig(1);
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "l6_hold_dispatch");
		const std::string Run = Rig.Session.RunId();
		Rig.Session.OnDispatchHttp(Http(202, AdmissionBody(Run, "ADMISSION_HELD", Server, false, false), false));
		Rig.Clock.Now += PollHoldWatchMs + 1;
		const FTickOutcome Tick = Rig.Session.Tick();
		Expect(!Tick.bSend, "l6_hold_window_does_not_send");
		Expect(Rig.Trace.CountEvent(Run, "hold_window_expired") == 1, "l6_hold_window_expired_event");
		Expect(Rig.Session.UiState() == EJuliusUiState::NotStarted, "l6_hold_window_token");
		Expect(Rig.Session.PlayerLabel() == ProgressDisplayLabel(EMissionProgress::NotStarted), "l6_hold_window_uses_logic_label");
		Expect(Rig.Session.UiState() != EJuliusUiState::Failed, "l6_hold_window_is_not_failed");
		Expect(!Rig.Session.IsFailClosed(), "l6_hold_window_is_not_fail_closed");
	}

	// RESTORED HELD (REVIEW, 2026-10-25): after a restart the status route's state is authoritative. The local hold window
	// (PollHoldWatchMs) is only the no-answer fallback; it never decides a run the bridge has answered for.
	{
		const char* const Server = "run:0a1b2c3d4e5f60718293a4b5";
		FRig Rig(1);
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "restore_held_dispatch");
		const std::string Run = Rig.Session.RunId();
		Rig.Session.OnDispatchHttp(Http(202, AdmissionBody(Run, "ADMISSION_HELD", Server, false, false), false));
		Rig.Session.OnStatusHttp(Http(200, BridgeStatusBody(Run, "awaiting_operator", Server, nullptr, nullptr), false));
		Expect(Rig.Session.UiState() == EJuliusUiState::AdmittedWaiting, "restore_held_before_restart");

		// The bridge expired the hold while the client was closed: its answer, not the local clock, ends the run.
		FRig Expired(1);
		Expired.Store.Text = Rig.Store.Text;
		Expired.Clock.Now = Rig.Clock.Now + 10ull * 60ull * 1000ull;
		Expect(Expired.Session.Load(), "restore_held_loads");
		Expect(Expired.Session.RunId() == Run && Expired.Session.IsAdmitted(), "restore_held_same_admitted_run");
		Expect(Expired.Session.UiState() != EJuliusUiState::NotStarted, "restore_held_not_decided_by_load");
		Expired.Session.OnStatusHttp(Http(200, BridgeStatusBody(Run, "failed", Server, nullptr, "AWAITING_OPERATOR_EXPIRED"), false));
		Expect(Expired.Session.UiState() == EJuliusUiState::NotStarted, "restore_held_server_expiry_is_not_started");
		Expect(Expired.Trace.CountEvent(Run, "hold_window_expired") == 0, "restore_held_expiry_is_the_servers_not_the_local_timer");
		Expect(Expired.Session.UiState() != EJuliusUiState::Failed && !Expired.Session.IsFailClosed(), "restore_held_expiry_is_neutral");

		// The local clock is already past the fallback, but the bridge answers first that the operator dispatched: the answer wins.
		FRig Late(1);
		Late.Store.Text = Rig.Store.Text;
		Late.Clock.Now = Rig.Clock.Now + PollHoldWatchMs + 60000ull;
		Expect(Late.Session.Load(), "restore_late_loads");
		const std::string When = FormatIso8601UtcMs(Late.Clock.Now - 1000ull);
		Late.Session.OnStatusHttp(Http(200, BridgeStatusBody(Run, "dispatched", Server, When.c_str(), nullptr), false));
		Expect(Late.Session.UiState() == EJuliusUiState::OperatorStarted, "restore_late_server_dispatch_wins");
		Expect(Late.Trace.CountEvent(Run, "hold_window_expired") == 0, "restore_late_no_local_expiry_over_an_answer");
	}

	{
		// FOUNDER BLOCKER 2026-10-25: a run restored after a restart has no native session until the player pairs. The
		// status poll must wait (no empty "Relay-Session " header into a 401), then go out for the SAME run once paired.
		const char* const Server = "run:0123456789abcdef01234567";
		FRig Rig(1);
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "nosession_dispatch");
		const std::string Run = Rig.Session.RunId();
		Rig.Session.OnDispatchHttp(Http(202, AdmissionBody(Run, "ADMISSION_HELD", Server, false, false), false));
		FRig Restored(0);
		Restored.Store.Text = Rig.Store.Text;
		Restored.Clock.Now = Rig.Clock.Now + 1000;
		Restored.Session.SetNativeSessionToken("");
		Expect(Restored.Session.Load(), "nosession_restore_loads");
		Expect(!Restored.Session.HasSessionToken(), "nosession_restored_holds_no_token");
		bool bSentWithoutSession = false;
		for (int Step = 0; Step < 6; ++Step)
		{
			Restored.Clock.Now += 5000;
			const FTickOutcome Tick = Restored.Session.Tick();
			if (Tick.bSend) { bSentWithoutSession = true; }
		}
		Expect(!bSentWithoutSession, "nosession_no_status_poll_without_a_session");
		Restored.Session.SetNativeSessionToken("PAIRED_AGAIN");
		const FTickOutcome Paired = Restored.Session.Tick();
		Expect(Paired.bSend && Paired.Request.bStatusPoll, "nosession_polls_on_the_first_tick_after_pairing");
		Expect(Contains(Paired.Request.Url, "runId=" + Run), "nosession_same_wlj_after_pairing");
		Expect(Contains(Paired.Request.Url, "/status?"), "nosession_status_not_dispatch");
		Expect(Restored.Session.RunId() == Run && Restored.Random.Fills == 0, "nosession_nothing_minted");
	}

	{
		// LIVE RUN VIEW: /events under the current run, the paired project, and the bridge's cursor; nothing else.
		FRig Rig(1);
		Expect(!Rig.Session.LiveEventsRequest("").bSent, "live_events_need_a_run");
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "live_events_dispatch");
		const std::string Run = Rig.Session.RunId();
		const FCommandOutcome First = Rig.Session.LiveEventsRequest("");
		Expect(First.bSent && First.Request.Method == "GET", "live_events_first_read");
		Expect(Contains(First.Request.Url, "/relay-api/wonderland/julius/missions/" + Run + "/events?projectId=proj-1"), "live_events_route");
		Expect(!Contains(First.Request.Url, "after="), "live_events_first_read_has_no_cursor");
		const FCommandOutcome Next = Rig.Session.LiveEventsRequest("c7:abc");
		Expect(Next.bSent && Contains(Next.Request.Url, "&after=c7%3Aabc"), "live_events_cursor_encoded");
		Expect(!Rig.Session.LiveEventsRequest("c7 x").bSent, "live_events_cursor_with_space_refused");
		Rig.Session.SetNativeSessionToken("");
		Expect(!Rig.Session.LiveEventsRequest("").bSent, "live_events_need_a_session");
		Rig.Session.SetNativeSessionToken("SECRET_TOKEN_VALUE");
		Expect(!Rig.Session.LiveEventsRequest(std::string(65, 'a')).bSent, "live_events_cursor_too_long_refused");
		(void)Rig.Session.SetBaseUrl("http://example.com");
		Expect(!Rig.Session.LiveEventsRequest("").bSent, "live_events_loopback_only");
	}

	{
		// A-9 /status: a GET under the current run, with the same refusals as every read.
		FRig Rig(3);
		Expect(!Rig.Session.MissionStatusRequest().bSent, "status_needs_a_run");
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "status_dispatch");
		const std::string Run = Rig.Session.RunId();
		const FCommandOutcome Status = Rig.Session.MissionStatusRequest();
		Expect(Status.bSent && Status.Request.Method == "GET" && Status.Request.Body.empty(), "status_is_a_get");
		Expect(Contains(Status.Request.Url, "/relay-api/wonderland/julius/missions/" + Run + "/status?projectId=proj-1"), "status_route");
		Rig.Session.SetNativeSessionToken("");
		Expect(!Rig.Session.MissionStatusRequest().bSent, "status_needs_a_session");
		Rig.Session.SetNativeSessionToken("SECRET_TOKEN_VALUE");
		(void)Rig.Session.SetBaseUrl("http://example.com");
		Expect(!Rig.Session.MissionStatusRequest().bSent, "status_loopback_only");
	}

	{
		// IN-WONDERLAND START: the request carries only the authorisation; nothing about spend or dispatch targets.
		FRig Rig(3);
		std::string Key;
		Expect(Rig.Session.Dispatch("demo-mission", "").bSent, "start_dispatch");
		const std::string Run = Rig.Session.RunId();
		Expect(Rig.Session.MintStartKey(Key) && IsCanonicalUuidV4(Key), "start_key_is_uuidv4");
		std::string Trigger;
		Expect(Rig.Session.MintClientTriggerId(Trigger) && Trigger.size() == 32 && Trigger.find_first_not_of("0123456789abcdef") == std::string::npos, "start_trigger_is_32_lower_hex");
		Expect(!Rig.Session.StartRequest("run live mission", Key, Trigger).bSent, "start_needs_exact_phrase");
		Expect(!Rig.Session.StartRequest("RUN LIVE MISSION", "not-a-uuid", Trigger).bSent, "start_needs_canonical_key");
		Expect(!Rig.Session.StartRequest("RUN LIVE MISSION", Key, "").bSent, "start_needs_a_trigger_id");
		Expect(!Rig.Session.StartRequest("RUN LIVE MISSION", Key, std::string(32, 'G')).bSent, "start_trigger_must_be_hex");
		Expect(!Rig.Session.StartRequest("RUN LIVE MISSION", Key, Trigger.substr(0, 31)).bSent, "start_trigger_must_be_32");
		const FCommandOutcome Start = Rig.Session.StartRequest("RUN LIVE MISSION", Key, Trigger);
		// A-9 RESEND: the same key re-sends the SAME clientTriggerId (the bridge digests it); a new random id would be
		// 409 julius_start_key_reused. The time stamp may differ; the digest does not cover it.
		Rig.Clock.Now += 5000;
		const FCommandOutcome Again = Rig.Session.StartRequest("RUN LIVE MISSION", Key, Trigger);
		Expect(Contains(Start.Request.Body, "\"clientTriggerId\":\"" + Trigger + "\""), "start_sends_the_persisted_trigger");
		Expect(Again.bSent && Contains(Again.Request.Body, "\"clientTriggerId\":\"" + Trigger + "\""), "start_resend_reuses_the_trigger");
		Expect(Start.bSent && Start.Request.Method == "POST", "start_is_a_post");
		Expect(Contains(Start.Request.Url, "/relay-api/wonderland/julius/missions/" + Run + "/start?projectId=proj-1"), "start_route");
		Expect(Contains(Start.Request.Body, "\"confirm\":\"RUN LIVE MISSION\"") && Contains(Start.Request.Body, "\"wljRunId\":\"" + Run + "\""), "start_body_binding");
		for (const char* Forbidden : {"lane", "budget", "repo", "\"ref\"", "mission_id", "missionId", "usd", "cycles"})
		{
			Expect(!Contains(Start.Request.Body, Forbidden), "start_body_has_no_spend_or_target_fields");
		}
		bool bKeyHeader = false;
		for (const auto& Header : Start.Request.Headers) { if (Header.first == "x-relay-idempotency-key" && Header.second == Key) { bKeyHeader = true; } }
		Expect(bKeyHeader, "start_key_header");
		Rig.Session.SetNativeSessionToken("");
		Expect(!Rig.Session.StartRequest("RUN LIVE MISSION", Key, Trigger).bSent, "start_needs_a_session");
		Rig.Session.SetNativeSessionToken("SECRET_TOKEN_VALUE");
		(void)Rig.Session.SetBaseUrl("http://example.com");
		Expect(!Rig.Session.StartRequest("RUN LIVE MISSION", Key, Trigger).bSent, "start_loopback_only");
	}

	Expect(CheckJuliusModuleRootIncludes(), "julius_no_bare_module_root_include");
	Expect(CheckNoAutomaticStartResend(), "julius_no_automatic_start_resend");
	Expect(CheckLiveResyncReadsStatus(), "julius_live_resync_reads_status");
	Expect(CheckStartKeyReused(), "julius_start_key_and_trigger_reused");
	Expect(CheckEndingsFollowBackendState(), "julius_endings_follow_backend_state");
	Expect(CheckEvidenceLogs(), "julius_evidence_logs");
	Expect(CheckPlatformCryptoTypesInclude(), "platform_crypto_result_includes_types");

	if (Failures == 0)
	{
		std::printf("J1 WRAPPER KAT PASS\n");
		return 0;
	}
	std::printf("J1 WRAPPER KAT FAIL %d\n", Failures);
	return 1;
}
