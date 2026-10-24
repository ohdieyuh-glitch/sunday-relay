// WONDERLAND -- the player-facing J1 mission flow. Standard C++17, no Unreal include.
//
// The wrapper (WonderlandJuliusMissionClient) mints the wlj_ id, posts admission, and polls.
// This layer only decides which screen the player is on, and which words that screen may show.
// It does not mint, it does not parse status JSON, and it does not infer spend or completion.
//
// PROGRESS. The words are WonderlandJuliusMissionLogic::ProgressDisplayLabel, or the wrapper's own
// player label when the wrapper has not published a progress meaning yet. `dispatched` (the status
// route, OperatorStarted) is the furthest progress this flow will show until BRIDGE's result route
// exists. Julius states past that, and the wrapper tokens "running" and "completed", stay at that
// ceiling. They are not a finished mission.
//
// RESULT. A separate reader. FBridgeMissionResultClient parses the JSON bodies of
// GET /relay-api/wonderland/julius/missions/{wljRunId}/result and /progress
// (relay-bridge/wonderland-mission-result-route.ts at 7e71a122). It does not fetch them and it does
// not derive a trace id, a cost, or an artifact reference. An unplugged reader reports nothing, and
// the panel says "No result reported yet". dispatched stays the furthest progress until a read verifies.
//
// WINDOWS. The bridge's operator window is 360 minutes from acceptance. The client hold is 362
// minutes (that window plus one slow poll). PollDispatchWatchMs is also 360 minutes, but it starts
// at dispatchedAt. It is not the operator window and it is not the hold.
#pragma once

#include "WonderlandJuliusMissionProgress.h"

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace WonderlandJuliusMissionFlow
{
	/** 360 minutes from acceptance. Not PollHoldWatchMs, and not the dispatchedAt watch. */
	inline constexpr std::uint64_t BridgeOperatorWindowMs = 360ull * 60ull * 1000ull;
	static_assert(BridgeOperatorWindowMs + static_cast<std::uint64_t>(WonderlandJuliusMissionLogic::PollSlowDelayMs)
		== WonderlandJuliusMissionLogic::PollHoldWatchMs);
	static_assert(BridgeOperatorWindowMs != WonderlandJuliusMissionLogic::PollHoldWatchMs);

	inline constexpr const char* CopyPaidNature =
		"This is a paid Julius mission. The bridge is what charges for it.";
	inline constexpr const char* CopyPaidOnDispatch =
		"A run is only paid once the bridge reports dispatch.";
	inline constexpr const char* CopyBridgeWindow =
		"The bridge gives the operator 360 minutes from acceptance.";
	inline constexpr const char* CopyClientHold =
		"This client keeps the watch for 362 minutes: the bridge window plus one slow poll.";
	inline constexpr const char* CopyNoResultYet = "No result reported yet";
	/** The result route's state word, copied onto the panel only after the completion evidence verifies. */
	inline constexpr const char* CopyStateCompleted = "state: completed";

	enum class EFlowStep : std::uint8_t
	{
		AtTerminal,
		Choosing,
		Confirming,
		Watching,
	};

	enum class EFlowPanel : std::uint8_t
	{
		None,
		MissionChoice,
		Confirm,
		Progress,
		Result,
	};

	struct FMissionOffer
	{
		std::string Id;
		std::string Title;
	};

	struct FProgressPanel
	{
		EFlowPanel Panel = EFlowPanel::Progress;
		/** A ProgressDisplayLabel, or null when the wrapper's own player label is shown instead. */
		const char* Line = nullptr;
		bool bFinished = false;
		/** True only when the progress meaning is OperatorStarted: the bridge reported dispatch. */
		bool bPaid = false;
		bool bUnconfirmed = false;
		bool bNotStarted = false;
		/** "running" or "completed" from the server, or the wrapper tokens of those names. */
		bool bFault = false;
		/** The meaning is past the status-route dispatched word, so the line is held at that ceiling. */
		bool bHeldAtDispatched = false;
		/** The wrapper published a label this flow does not replace. */
		bool bUsesWrapperLabel = false;
	};

	struct FResultPanel
	{
		EFlowPanel Panel = EFlowPanel::Result;
		const char* Line = CopyNoResultYet;
		bool bShowsArtifact = false;
		bool bVerified = false;
		bool bReported = false;
		/** True only when the result route's state is completed and the completion evidence verified. */
		bool bFinished = false;
		/** Reported fields, in display order. Empty when that field was null, absent, or not verified. */
		std::vector<std::string> Lines;
	};

	/**
	 * A field as the JSON body reported it. bKnown means a value was present. bNull means the key was
	 * present and null. Neither is zero, and neither is a value this client computed.
	 */
	struct FReportedString
	{
		bool bKnown = false;
		bool bNull = false;
		std::string Text;
	};

	struct FReportedInt64
	{
		bool bKnown = false;
		bool bNull = false;
		std::int64_t Value = 0;
	};

	struct FReportedBool
	{
		bool bKnown = false;
		bool bNull = false;
		bool bValue = false;
	};

	/**
	 * One parse of BRIDGE's result and progress bodies.
	 *
	 * Field names, from bridge/wonderland-julius-mission-result-20261024 @ 7e71a122fe03a2538904ab4b8651e034dcf2c1f3:
	 *   relay-bridge/wonderland-mission-result-route.ts (blob 4e34e0d6fab93b6ba4f7183ac6bfb02ece3ea6f1)
	 *     shared body 137-144: wljRunId, serverRunId, legacyRunId, traceId, state, updatedAt
	 *     progress 150: phases
	 *     result 154-162: cause (only when state is not completed and cause is non-null), dispatchedAt, completion
	 *     state is "completed" only when evidence.completion !== null (136). Otherwise ceilingState (187-189).
	 *   relay-bridge/julius-mission-evidence.ts (blob af82258f94e0df0637622e5da7afb9bb298f5a67)
	 *     spendTag 52-60, spendAccounting 63-68, coderCost 71-76, missionCost 79-83
	 *     archive 104-112 (artifactName, artifactDigest), workArtifactRefs 330-337
	 *     completion 135-156, including juliusFinalState "COMPLETED", traceId, traceparent null
	 *     acceptJuliusMissionEvidence 380-404
	 *   docs/JULIUS_MISSION_EVIDENCE_READER.md (blob 4f1ab222a8519635b9b9cc4c0073c3266ee7a99a)
	 *     13-18: completion requires juliusFinalState "COMPLETED" and spendTag.run equal to the path wlj_ id.
	 *     A missing cost is null, not zero. 77: this route does not recompute JuliusMissionResultView.verified.
	 *     63-67: traceId and spanId are derived on the bridge. This client displays the strings the body carried.
	 */
	struct FResultRead
	{
		bool bParsed = false;
		bool bReported = false;
		/** state "completed" and the completion object carries the spend-tag evidence. */
		bool bVerified = false;
		bool bFinished = false;
		/** state "unknown", or a state word this client will not treat as a ceiling it understands. */
		bool bUnknownState = false;
		/** state "failed" and cause "AWAITING_OPERATOR_EXPIRED". Stays NotStarted. */
		bool bExpired = false;
		/** state "dispatched" and completion did not verify. The furthest unplugged progress. */
		bool bDispatchedCeiling = false;
		std::string State;
		FReportedString Cause;
		FReportedString TraceId;
		FReportedString CompletionTraceId;
		FReportedString CompletionTraceparent;
		FReportedString ArtifactName;
		FReportedString ArtifactDigest;
		std::vector<std::string> WorkArtifactRefs;
		bool bSpendTagPresent = false;
		FReportedInt64 ReservedUsdMicros;
		bool bSpendAccountingPresent = false;
		FReportedInt64 SpendAccountingKnownUsdMicros;
		bool bCoderCostPresent = false;
		FReportedInt64 CoderCostUsdMicros;
		FReportedString CoderCostBasis;
		bool bMissionCostPresent = false;
		FReportedInt64 MissionKnownUsdMicros;
		FReportedInt64 MissionUnknownComponents;
		FReportedBool MissionCostComplete;
		FReportedString ProviderMessageId;
		FReportedString SecretText;
		/** Honest parse leaves both false. They exist so a display flip is observable. */
		bool bEchoProviderMessageId = false;
		bool bEchoSecret = false;
	};

	class IMissionResultReader
	{
	public:
		virtual ~IMissionResultReader() = default;
		/** No result when the route is absent or has not reported one. Never a synthesized body. */
		virtual FResultRead Read(std::string_view WljRunId) const = 0;
	};

	class FAbsentResultReader final : public IMissionResultReader
	{
	public:
		FResultRead Read(std::string_view) const override { return {}; }
	};

	/**
	 * Parses the result and progress response bodies. It does not open a connection. Status 0 and an
	 * empty body mean that response was not supplied. While neither response is supplied, Read matches
	 * FAbsentResultReader: nothing is reported, and dispatched stays the furthest progress.
	 */
	class FBridgeMissionResultClient final : public IMissionResultReader
	{
	public:
		void Clear();
		void SetResultResponse(int Status, std::string_view Json);
		void SetProgressResponse(int Status, std::string_view Json);
		FResultRead Read(std::string_view WljRunId) const override;

	private:
		bool bHaveResult = false;
		int ResultStatus = 0;
		std::string ResultJson;
		bool bHaveProgress = false;
		int ProgressStatus = 0;
		std::string ProgressJson;
	};

	/**
	 * Fail-closed parse of the two bodies. ProgressJson may be empty when that response was not supplied.
	 * A non-200 result, an error object, a wljRunId other than WljRunId, or evidence short of the spend
	 * tag is not completion.
	 */
	FResultRead ParseBridgeMissionResponses(
		std::string_view WljRunId,
		int ResultStatus,
		std::string_view ResultJson,
		int ProgressStatus,
		std::string_view ProgressJson);

	FProgressPanel PanelForProgress(WonderlandJuliusMissionLogic::EMissionProgress Meaning);
	FProgressPanel PanelForStatusRouteWord(std::string_view Word);
	/** Wrapper ui_state tokens from WonderlandJuliusMissionClient::UiStateToken. */
	FProgressPanel PanelForWrapperToken(std::string_view Token);
	FResultPanel ResultPanelFor(const FResultRead& Read);

	struct FDispatchIntent
	{
		bool bSend = false;
		std::string MissionId;
	};

	struct FFlowView
	{
		EFlowStep Step = EFlowStep::AtTerminal;
		bool bShowChoice = false;
		bool bShowConfirm = false;
		bool bShowProgress = false;
		bool bShowResult = false;
		const char* PaidNature = CopyPaidNature;
		const char* PaidOnDispatch = CopyPaidOnDispatch;
		const char* BridgeWindow = CopyBridgeWindow;
		const char* ClientHold = CopyClientHold;
		FProgressPanel Progress;
		FResultPanel Result;
		std::string MissionId;
		std::string ClientRunId;
		bool bRunIdOk = false;
		bool bDispatchHanded = false;
	};

	class FMissionFlow
	{
	public:
		void SetOffers(std::vector<FMissionOffer> InOffers);
		const std::vector<FMissionOffer>& Offers() const { return OfferList; }

		void InteractWithTerminal();
		bool ChooseMission(std::string_view MissionId);
		void BackToChoice();
		/** Does not send. The host hands MissionId to the wrapper, then calls NoteDispatchHandedToWrapper. */
		FDispatchIntent Confirm() const;
		void NoteDispatchHandedToWrapper(bool bAccepted);

		void NoteClientRunId(std::string_view WljRunId);
		void NoteProgress(WonderlandJuliusMissionLogic::EMissionProgress Meaning);
		void NoteStatusRouteWord(std::string_view Word);
		void NoteWrapperToken(std::string_view Token);
		void NoteResult(const IMissionResultReader& Reader);

		FFlowView View() const;

	private:
		std::vector<FMissionOffer> OfferList;
		EFlowStep Step = EFlowStep::AtTerminal;
		std::string ChosenId;
		bool bDispatchHanded = false;
		std::string ClientRunId;
		bool bRunIdOk = false;
		bool bHaveMeaning = false;
		WonderlandJuliusMissionLogic::EMissionProgress Meaning = WonderlandJuliusMissionLogic::EMissionProgress::Waiting;
		bool bHaveWord = false;
		std::string StatusWord;
		bool bHaveToken = false;
		std::string WrapperToken;
		FResultPanel Result;
		FResultRead RouteRead;
	};
}
