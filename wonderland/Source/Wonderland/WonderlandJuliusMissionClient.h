// WONDERLAND -- J1 in-world mission: the client WRAPPER's pure logic. Standard C++17, no Unreal include.
//
// This is the layer Cosmo left for the wrapper (WonderlandJuliusMissionLogic.h, notes 1-7). It calls that logic
// as-is: ClassifyDispatchAnswer, FDispatchAttemptTracker, NextResend, ClassifyArtifactQualification,
// DisplayQualification. It does not mint run ids itself except through MintAttempt, and only when the tracker
// allows a new pair. It does not call a provider and it does not start a paid workflow.
//
// SERVER CONTRACT. POST {base}/relay-api/wonderland/julius/dispatch with a native session
// (Authorization: Relay-Session <token>, never Bearer, never an Origin header), a wlj_ run id, and
// x-relay-idempotency-key. Loopback hosts only. The admission route also requires clientTriggerId,
// clientLogSha256 (sha256 of the dispatch_requested trace line written BEFORE the request) and clientUiActionUtc.
// A first admission is 202, state ADMISSION_HELD, dispatched false. A same-pair resend is 200 with no error.
// ClassifyDispatchAnswer is used as-is. A 429 refuses only for julius_dispatch_cap_reached and
// julius_dispatch_mission_cap_reached; any other 429 is NoAnswer. A 4xx/5xx that carries an error
// kind is Refused (503 julius_dispatch_disabled is a refusal). Bare 5xx, transport, and unparsed
// bodies are NoAnswer.
//
// serverRunId (BRIDGE, additive, the name for now). The 202 and the 200 may carry data.serverRunId. Read it when
// it is a non-empty string. JSON null or a missing field is ignored, not an error and not a fabricated id.
// Persist it with the open pair. After the first admission response for the pair, every trace event includes
// server_run_id (the string, or null when the server omitted it). wl.Julius.J1.Status prints it. A later admission
// response for the SAME pair that carries a different serverRunId is an error: the attempt fails closed, the
// trace records error, and nothing is minted.
//
// STATUS POLL (PROPOSED path, not mounted by the admission adapter yet):
//   GET {base}/relay-api/wonderland/julius/status?runId=&projectId=
// Only a status body with JSON boolean providersRunning true moves the UI to running. A dispatch 202 never does,
// even if that body also says dispatched true or state RUNNING. YUJI owns the real status field names; the names
// below are PROPOSED.
//
// PROPOSED J1 RESPONSE FIELDS (YUJI has not agreed these; do not treat them as a frozen contract):
//   providersRunning    JSON boolean. Only true means providers are running.
//   progressPct         JSON number or null. Absent and null are Unknown, never 0.
//   progressStep        JSON string or null.
//   providerRequestId   JSON string or null. Trace key provider_request_id.
//   modelId             JSON string or null. Trace key model_id.
//   artifactId          JSON string or null.
//   mime                JSON string or null.
// Result bodies that already match Cosmo's resultText contract (runId, missionId, mode, state, failure,
// artifactSha256, artifactText, outer resultSha256) are read under those existing names.
//
// TRACE. One JSON object per line, keyed by the wlj_ run id:
//   {ProjectSavedDir}/Logs/JuliusTrace/<runId>.jsonl
// The run id already begins with wlj_, so the file is wlj_<uuid>.jsonl. Events before a run id exists go to
// Logs/JuliusTrace/_unminted.jsonl. Secrets, session tokens and idempotency keys are never written.
// ui_state is the exact player-visible label. ui_state_enum is the token (idle, dispatching, admitted_waiting,
// still_waiting, queued_busy, running, completed, refused, failed, operator_started, dispatch_unconfirmed,
// not_started). not_started is neutral: the operator did not start the run, and it is not a failure.
//
// UI LABELS that are fixed (not proposals):
//   still waiting for the bridge          NoAnswer and StillWaiting
//   queued behind a running chain         429 julius_dispatch_busy (including a busy first send)
//   admitted, waiting for the paid run    202/200 ADMISSION_HELD
// None of those is a refusal. running is unreachable until a status answer says providers are running.
// Artifact text is shown only through DisplayQualification: pending judge, unverified, not qualifying.
//
// RESEND. NextResend decides the wait. Only the open pair is resent. StillWaiting is terminal and never mints.
// A definitive cap refusal is the only admission outcome that may be followed by a later mint, and only when
// the player dispatches again. Randomness failure refuses the dispatch and mints nothing.
//
// OBSERVER. This layer does not replicate. NoteObserverReceipt writes client_role=observer under the same
// wlj_ run id when FORGE delivers a replicated observation. See J1_PRESENTATION_SPEC.md.
#pragma once

#include "WonderlandJuliusMissionLogic.h"
#include "WonderlandJuliusMissionProgress.h"

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace WonderlandJuliusMissionClient
{
	inline constexpr const char* DefaultBridgeBaseUrl = "http://127.0.0.1:8790";
	inline constexpr const char* DispatchRelativePath = "/relay-api/wonderland/julius/dispatch";
	/** PROPOSED. The admission adapter does not mount this path yet. */
	inline constexpr const char* StatusRelativePath = "/relay-api/wonderland/julius/status";
	inline constexpr std::uint64_t HeartbeatPeriodMs = 5000;
	inline constexpr std::uint64_t StatusPollPeriodMs = 5000;
	inline constexpr const char* UnmintedTraceName = "_unminted";

	inline constexpr const char* LabelIdle = "no mission yet";
	inline constexpr const char* LabelDispatching = "sending the mission";
	inline constexpr const char* LabelStillWaiting = "still waiting for the bridge";
	inline constexpr const char* LabelQueuedBusy = "queued behind a running chain";
	inline constexpr const char* LabelAdmitted = "admitted, waiting for the paid run";
	/** PROPOSED player-visible copy for the running enum. Pinned by the wrapper KAT. */
	inline constexpr const char* LabelRunning = "the paid run is in progress";
	/** PROPOSED. Used when a resend's serverRunId disagrees with the one already stored. */
	inline constexpr const char* LabelServerRunMismatch = "could not confirm the server run";
	inline constexpr const char* LabelRandomUnavailable = "could not start";
	inline constexpr const char* LabelArrivedDamaged = "arrived damaged";

	enum class EJuliusUiState : std::uint8_t
	{
		Idle,
		Dispatching,
		AdmittedWaiting,
		StillWaiting,
		QueuedBusy,
		Running,
		Completed,
		Refused,
		Failed,
		/** Cosmo's OperatorStarted. Not a running paid mission. */
		OperatorStarted,
		/** Cosmo's DispatchUnconfirmed. The hold window is still open. */
		DispatchUnconfirmed,
		/** Cosmo's NotStarted. Neutral: the operator did not start the run. Not a failure. */
		NotStarted,
	};

	const char* UiStateToken(EJuliusUiState State);

	/** True for http:// and https:// hosts 127.0.0.1, localhost and [::1], optional port, no userinfo. */
	bool IsLoopbackBaseUrl(std::string_view Url);

	/**
	 * `{savedDir}/Logs/JuliusTrace/{runId}.jsonl` when runId is a strict wlj_ id or `_unminted`.
	 * Empty when the name is not one of those, so a trace cannot escape the directory.
	 */
	std::string JuliusTraceFilePath(std::string_view ProjectSavedDir, std::string_view RunId);

	/** UTC `YYYY-MM-DDTHH:MM:SS.mmmZ` from an epoch millisecond clock. */
	std::string FormatIso8601UtcMs(std::uint64_t UtcMs);

	class IUtcClock
	{
	public:
		virtual ~IUtcClock() = default;
		virtual std::uint64_t NowUtcMs() const = 0;
		/** False when no NTP offset is available. Out is untouched. Never invents 0. */
		virtual bool NtpOffsetMs(std::int64_t& OutOffsetMs) const = 0;
	};

	class ITraceSink
	{
	public:
		virtual ~ITraceSink() = default;
		virtual bool Append(std::string_view RunId, std::string_view LineWithNewline) = 0;
		virtual std::string PathFor(std::string_view RunId) const = 0;
		virtual std::size_t LineCount(std::string_view RunId) const = 0;
	};

	/** Local save for the open pair. The text is the pure format from SerializeSession; no secrets. */
	class ITextStore
	{
	public:
		virtual ~ITextStore() = default;
		virtual bool Write(std::string_view Text) = 0;
		virtual bool Read(std::string& OutText) = 0;
	};

	struct FWireRequest
	{
		std::string Method;
		std::string Url;
		std::vector<std::pair<std::string, std::string>> Headers;
		std::string Body;
		std::string RunId;
		std::string RequestId;
		bool bResend = false;
		bool bStatusPoll = false;
	};

	struct FCommandOutcome
	{
		bool bSent = false;
		/** Set when a request must not be sent. Detail never contains a token or an idempotency key. */
		std::string Detail;
		FWireRequest Request;
	};

	struct FHttpResult
	{
		int Status = 0;
		bool bTransportError = false;
		std::string Body;
		std::uint64_t LatencyMs = 0;
		/** True when this response belongs to a resend of the open pair, not the first send. */
		bool bResend = false;
	};

	struct FTickOutcome
	{
		bool bSend = false;
		FWireRequest Request;
	};

	/**
	 * What an observer learned from replicated mission state. Replication itself is FORGE's; this is only the log hook.
	 * ServerRunId is optional: set bServerRunIdKnown only when the replicated payload actually carried one.
	 */
	struct FObserverReceipt
	{
		std::string RunId;
		std::string PlayerNetId;
		std::string UiStateToken;
		std::string UiLabel;
		std::string ServerRunId;
		bool bServerRunIdKnown = false;
	};

	/**
	 * One player session. The random source, clock, trace sink and save are injected so tests need no engine.
	 * The native session token is memory-only: Load/Save never persist it, and no trace line contains it.
	 */
	class FJuliusMissionSession
	{
	public:
		FJuliusMissionSession(WonderlandJuliusMissionLogic::IRandomBytes16& Random, IUtcClock& Clock, ITraceSink& Trace, ITextStore& Store);

		/**
		 * False when Url is not loopback. A rejected URL clears the endpoint: dispatch, resend and status
		 * send nothing until a loopback URL is accepted. There is no fallback to the previous host.
		 */
		bool SetBaseUrl(std::string_view BaseUrl);
		void SetProjectId(std::string_view ProjectId);
		void SetPlayerNetId(std::string_view PlayerNetId);
		void SetBuildIdentity(std::string_view BuildSha, std::string_view PackageId);
		void SetExpectedResultMode(std::string_view Mode);
		void SetNativeSessionToken(std::string_view Token);
		/** `Source` is "ntp" or "system". Pass Known false when no offset exists. */
		void SetClockOffset(bool bKnown, std::int64_t OffsetMs, std::string_view Source);

		/** False when the save is missing, empty, or corrupt. A corrupt save leaves the session idle and mints nothing. */
		bool Load();

		FCommandOutcome Dispatch(std::string_view MissionId, std::string_view PairId);
		/** Resends the open pair only. Never mints. A closed, refused, or StillWaiting pair sends nothing. */
		FCommandOutcome Resend();
		FTickOutcome Tick();

		void OnDispatchHttp(const FHttpResult& Http);
		void OnStatusHttp(const FHttpResult& Http);
		void NoteObserverReceipt(const FObserverReceipt& Receipt);

		EJuliusUiState UiState() const { return Ui; }
		const std::string& PlayerLabel() const { return Label; }
		const std::string& ArtifactLabel() const { return ArtifactQualification; }
		/** First 12 hex digits of a verified artifact digest. Empty unless the result completed the digest check. */
		const std::string& ArtifactDigest12() const { return Digest12; }
		const std::string& RunId() const { return CurrentRunId; }
		const std::string& ServerRunId() const { return CurrentServerRunId; }
		bool HasServerRunId() const { return bServerRunIdKnown; }
		bool IsFailClosed() const { return bFailClosed; }
		bool IsAdmitted() const { return bAdmitted; }

		/** One JSON object, no newline. Includes server_run_id. Never includes the token or the idempotency key. */
		std::string StatusJson() const;
		std::string TraceLocation() const;

		/** The save document that was last written. Tests use this for the round trip. */
		const std::string& SavedText() const { return LastSaved; }

		struct FAdmissionView
		{
			bool bParsed = false;
			bool bHasError = false;
			std::string ErrorKind;
			bool bHasData = false;
			std::string DataState;
			bool bDispatchedPresent = false;
			bool bDispatched = false;
			bool bServerRunIdPresent = false;
			/** True when the field is present but not a string and not null. The attempt fails closed. */
			bool bServerRunIdInvalid = false;
			std::string ServerRunId;
			std::string DataRunId;
			bool bDataRunIdPresent = false;
			std::string DispatchedAt;
			std::string Cause;
		};

		struct FStatusView
		{
			bool bParsed = false;
			bool bHasError = false;
			std::string ErrorKind;
			bool bProvidersRunningPresent = false;
			bool bProvidersRunning = false;
			bool bProgressPctPresent = false;
			double ProgressPct = 0;
			bool bProgressStepPresent = false;
			std::string ProgressStep;
			bool bProviderRequestIdPresent = false;
			std::string ProviderRequestId;
			bool bModelIdPresent = false;
			std::string ModelId;
			bool bArtifactIdPresent = false;
			std::string ArtifactId;
			bool bMimePresent = false;
			std::string Mime;
			std::string DataState;
			std::string DataMode;
			std::string DataRunId;
			std::string ServerRunId;
			/** Status route `dispatchedAt`. Empty when the field is absent. */
			std::string DispatchedAt;
			/** Status route `cause`. Empty when the field is absent. */
			std::string Cause;
			std::string ResultText;
			std::string ResultSha256;
			bool bHasResult = false;
		};

	private:
		void Persist();
		FCommandOutcome SendOpenPair(bool bFromSchedule);
		void MaybeHeartbeat(std::uint64_t NowMs);
		void RememberServerRun(const FAdmissionView& View, bool& bMismatch, std::string& Conflicting);
		void FailClosedMismatch(const std::string& Conflicting, const FHttpResult& Http, const FAdmissionView& View);
		void ApplyDispatchClassification(const FHttpResult& Http, const FAdmissionView& View);
		void ApplyFinishedResult(const FStatusView& Status);
		void SetUi(EJuliusUiState Next, std::string_view NextLabel);
		void EnsureProgress();
		void NoteDispatchProgress(const FHttpResult& Http, const FAdmissionView& View, WonderlandJuliusMissionLogic::EDispatchAnswer Answer);
		void NoteStatusProgress(const FHttpResult& Http, const FStatusView& Status);
		void PublishProgress(std::size_t From);
		void ApplyProgressUi();
		/** Arms the next status poll from Cosmo's NextPollStep (hold, dispatch, then run budgets). */
		void ArmPoll(std::uint64_t NowMs);
		bool ProgressOwnsPoll() const;
		void TouchActivity(std::uint64_t NowMs);
		std::uint64_t WaitedMs(std::uint64_t NowMs) const;
		bool BlocksMint() const;
		void WriteTrace(std::string_view Event, std::string_view ExtraJson);
		std::string BaseTracePrefix(std::string_view Event) const;
		bool IncludeServerRunOnTrace() const;
		FWireRequest MakeDispatchRequest(bool bResend, std::string_view LogHash, std::string_view RequestId) const;
		FWireRequest MakeStatusRequest() const;
		std::string ClientLogHashFor(std::string_view LineWithNewline) const;

		WonderlandJuliusMissionLogic::IRandomBytes16& Random;
		IUtcClock& Clock;
		ITraceSink& Trace;
		ITextStore& Store;
		WonderlandJuliusMissionLogic::FDispatchAttemptTracker Tracker;
		std::optional<WonderlandJuliusMissionLogic::FMissionProgressTracker> Progress;
		std::uint64_t AdmittedAtUtcMs = 0;

		std::string BaseUrl = DefaultBridgeBaseUrl;
		std::string ProjectId;
		std::string PlayerNetId;
		std::string BuildSha;
		std::string PackageId;
		std::string ExpectedMode;
		std::string SessionToken;
		std::string PairId;
		bool bClockOffsetKnown = false;
		std::int64_t ClockOffsetMs = 0;
		std::string ClockOffsetSource;

		EJuliusUiState Ui = EJuliusUiState::Idle;
		std::string Label = LabelIdle;
		std::string ArtifactQualification;
		std::string Digest12;

		std::string CurrentRunId;
		std::string CurrentKey;
		std::string MissionId;
		std::string CurrentServerRunId;
		bool bServerRunIdKnown = false;
		bool bSawAdmissionResponse = false;

		std::uint32_t AttemptCount = 0;
		std::uint32_t ResendsSent = 0;
		std::uint64_t FirstSentUtcMs = 0;
		std::uint64_t NextResendAtUtcMs = 0;
		std::uint64_t NextPollAtUtcMs = 0;
		std::uint64_t NextHeartbeatAtUtcMs = 0;

		bool bPairOpen = false;
		bool bAdmitted = false;
		bool bStillWaiting = false;
		bool bFailClosed = false;
		bool bInFlight = false;
		bool bRefused = false;
		bool bFinished = false;
		bool bRunning = false;

		std::string InFlightRequestId;
		std::string LastSaved;
	};
}
