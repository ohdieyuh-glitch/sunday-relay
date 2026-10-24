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
// RESULT. A separate reader. Until the B3 result route exists, the reader reports nothing and the
// panel says "No result reported yet". A verified:false read is shown as verified:false. An artifact
// is shown only when a read says verified. This file does not name the route's fields.
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
	inline constexpr const char* CopyVerifiedFalse = "verified: false";
	inline constexpr const char* CopyVerifiedTrue = "verified: true";

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
	};

	/**
	 * TODO(B3): BRIDGE's result route, keyed by the client's wlj_ id, returns completion, an artifact
	 * reference, cost, and trace ids from the spend tag and the run record. Those field names belong to
	 * the B3 contract. They are not declared here. bReported is whether a read exists at all.
	 * bVerified is the route's verified flag; false must be shown as false.
	 */
	struct FResultRead
	{
		bool bReported = false;
		bool bVerified = false;
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
	};
}
