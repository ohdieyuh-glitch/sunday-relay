// WONDERLAND -- thin Slate for the J1 mission flow.
//
// The decisions live in WonderlandJuliusMissionFlow. This widget draws them and, on confirm,
// calls UWonderlandJuliusMissionSubsystem::DispatchMission, the same door as wl.Julius.J1.Dispatch.
// It does not mint a run id, classify a status body, or invent a result.
//
// Owned by UWonderlandUiSubsystem as EOverlay::JuliusMission (key K, or wl.Julius.J1.Panel.Open). Opening the
// overlay is using the terminal: the owner calls NotifyTerminalUsed. Escape and Close ask the owner to remove it.
// Compiled in UE 5.8.2 Win64 (wonderland/j1-inworld-e2e-20261025).
#pragma once

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"
#include "Wonderland/WonderlandJuliusMissionFlow.h"

class UWonderlandJuliusMissionSubsystem;

class WONDERLAND_API SWonderlandJuliusMissionFlow : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandJuliusMissionFlow) {}
		SLATE_ARGUMENT(TWeakObjectPtr<UWonderlandJuliusMissionSubsystem>, Session)
		/** Close button and Escape. The UI owner removes the panel; closing never cancels a dispatched run. */
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	virtual void Tick(const FGeometry& AllottedGeometry, double InCurrentTime, float InDeltaTime) override;
	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;

	/**
	 * QA door (wl.Julius.J1.Panel.*): the same handlers the buttons call, so a headless run drives the
	 * exact path a player clicks. Each returns false when that button is not on screen.
	 */
	bool QaPick(const FString& MissionId);
	bool QaConfirm();
	/** One line: step, progress line, result line. For the QA log, never the token. */
	FString QaDescribe() const;

	/** The in-world terminal calls this when the player uses it. */
	void NotifyTerminalUsed();
	void SetOffers(TArray<TPair<FString, FString>> InOffers);
	/** One line above the flow (the local-bridge pairing state); empty hides it. Never a token. */
	void SetNotice(const FString& InNotice, bool bInUntilPaired = false);
	/** Pull the wrapper and the mission reads now (opening the overlay, QA captures), not only on Slate tick. */
	void Refresh();

	/**
	 * Hands the host's result and progress response bodies to FBridgeMissionResultClient.
	 * Status 0 and an empty body mean that response was not fetched. Until the host supplies
	 * them, the panel keeps the absent reader and does not go past dispatched.
	 */
	void SetMissionResponses(int32 ResultStatus, const FString& ResultJson, int32 ProgressStatus, const FString& ProgressJson);

private:
	/** Takes the subsystem's latest /result and /progress answers when they changed. */
	void PullMissionReads();
	void PullWrapper();
	void Rebuild();
	FReply UseTerminal();
	FReply PickMission(FString MissionId);
	FReply ConfirmMission();
	FReply ReturnToChoice();
	FReply StartAgain();

	TWeakObjectPtr<UWonderlandJuliusMissionSubsystem> Session;
	FSimpleDelegate OnRequestClose;
	WonderlandJuliusMissionFlow::FMissionFlow Flow;
	TSharedPtr<class SVerticalBox> Body;
	FString ShownKey;
	bool bHaveMissionRead = false;
	WonderlandJuliusMissionFlow::FBridgeMissionResultClient MissionRead;
	FString PulledReadKey;
	FString Notice;
	bool bNoticeUntilPaired = false;
};
