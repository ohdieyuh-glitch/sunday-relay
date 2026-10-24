// WONDERLAND -- thin Slate for the J1 mission flow.
//
// The decisions live in WonderlandJuliusMissionFlow. This widget draws them and, on confirm,
// calls UWonderlandJuliusMissionSubsystem::DispatchMission, the same door as wl.Julius.J1.Dispatch.
// It does not mint a run id, classify a status body, or invent a result.
//
// NOT VERIFIED IN UNREAL. This file was written where UE 5.8 is not installed. Still to compile there:
//   - UMG bindings, if a Blueprint wraps this Slate (there is no UCLASS here)
//   - the in-world terminal's input, which must call NotifyTerminalUsed
//   - adding the widget to the viewport from the existing UI owner
//   - focus and the close chord beside the companion terminal and the live terminal
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
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	virtual void Tick(const FGeometry& AllottedGeometry, double InCurrentTime, float InDeltaTime) override;

	/** The in-world terminal calls this when the player uses it. */
	void NotifyTerminalUsed();
	void SetOffers(TArray<TPair<FString, FString>> InOffers);

	/**
	 * Hands the host's result and progress response bodies to FBridgeMissionResultClient.
	 * Status 0 and an empty body mean that response was not fetched. Until the host supplies
	 * them, the panel keeps the absent reader and does not go past dispatched.
	 */
	void SetMissionResponses(int32 ResultStatus, const FString& ResultJson, int32 ProgressStatus, const FString& ProgressJson);

private:
	void PullWrapper();
	void Rebuild();
	FReply UseTerminal();
	FReply PickMission(FString MissionId);
	FReply ConfirmMission();
	FReply ReturnToChoice();

	TWeakObjectPtr<UWonderlandJuliusMissionSubsystem> Session;
	WonderlandJuliusMissionFlow::FMissionFlow Flow;
	TSharedPtr<class SVerticalBox> Body;
	FString ShownKey;
	bool bHaveMissionRead = false;
	WonderlandJuliusMissionFlow::FBridgeMissionResultClient MissionRead;
};
