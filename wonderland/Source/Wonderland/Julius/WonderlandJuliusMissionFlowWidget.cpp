#include "WonderlandJuliusMissionFlowWidget.h"

#include "Wonderland/WonderlandJuliusMissionFlow.h"
#include "WonderlandJuliusMissionSubsystem.h"

#include "Widgets/Input/SButton.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"

namespace
{
	FString MissionFlowUtf8(const char* Text)
	{
		if (Text == nullptr) { return FString(); }
		return UTF8_TO_TCHAR(Text);
	}

	/** The wrapper's status line carries wlj_run_id. A miss stays unknown; nothing is invented. */
	FString MissionFlowWljRunId(const FString& StatusLine)
	{
		const FString Key = TEXT("\"wlj_run_id\":");
		const int32 At = StatusLine.Find(Key);
		if (At == INDEX_NONE) { return FString(); }
		int32 Cursor = At + Key.Len();
		if (!StatusLine.IsValidIndex(Cursor) || StatusLine[Cursor] != TCHAR('"')) { return FString(); }
		++Cursor;
		const int32 End = StatusLine.Find(TEXT("\""), ESearchCase::CaseSensitive, ESearchDir::FromStart, Cursor);
		if (End == INDEX_NONE) { return FString(); }
		return StatusLine.Mid(Cursor, End - Cursor);
	}
}

void SWonderlandJuliusMissionFlow::Construct(const FArguments& InArgs)
{
	Session = InArgs._Session;
	ChildSlot
	[
		SAssignNew(Body, SVerticalBox)
	];
	Rebuild();
}

void SWonderlandJuliusMissionFlow::Tick(const FGeometry& AllottedGeometry, double InCurrentTime, float InDeltaTime)
{
	SCompoundWidget::Tick(AllottedGeometry, InCurrentTime, InDeltaTime);
	PullWrapper();
	Rebuild();
}

void SWonderlandJuliusMissionFlow::NotifyTerminalUsed()
{
	Flow.InteractWithTerminal();
	Rebuild();
}

void SWonderlandJuliusMissionFlow::SetOffers(TArray<TPair<FString, FString>> InOffers)
{
	std::vector<WonderlandJuliusMissionFlow::FMissionOffer> Next;
	Next.reserve(static_cast<std::size_t>(InOffers.Num()));
	for (const TPair<FString, FString>& Offer : InOffers)
	{
		WonderlandJuliusMissionFlow::FMissionOffer Row;
		Row.Id = TCHAR_TO_UTF8(*Offer.Key);
		Row.Title = TCHAR_TO_UTF8(*Offer.Value);
		Next.push_back(std::move(Row));
	}
	Flow.SetOffers(std::move(Next));
	Rebuild();
}

void SWonderlandJuliusMissionFlow::SetMissionResponses(
	int32 ResultStatus,
	const FString& ResultJson,
	int32 ProgressStatus,
	const FString& ProgressJson)
{
	bHaveMissionRead = ResultStatus != 0 || ProgressStatus != 0 || !ResultJson.IsEmpty() || !ProgressJson.IsEmpty();
	MissionRead.Clear();
	if (bHaveMissionRead)
	{
		if (ResultStatus != 0 || !ResultJson.IsEmpty())
		{
			MissionRead.SetResultResponse(ResultStatus, TCHAR_TO_UTF8(*ResultJson));
		}
		if (ProgressStatus != 0 || !ProgressJson.IsEmpty())
		{
			MissionRead.SetProgressResponse(ProgressStatus, TCHAR_TO_UTF8(*ProgressJson));
		}
	}
	PullWrapper();
	Rebuild();
}

void SWonderlandJuliusMissionFlow::PullWrapper()
{
	UWonderlandJuliusMissionSubsystem* Live = Session.Get();
	if (Live != nullptr)
	{
		Flow.NoteWrapperToken(TCHAR_TO_UTF8(*Live->UiStateToken()));
		Flow.NoteClientRunId(TCHAR_TO_UTF8(*MissionFlowWljRunId(Live->StatusLine())));
	}
	if (!bHaveMissionRead)
	{
		Flow.NoteResult(WonderlandJuliusMissionFlow::FAbsentResultReader{});
		return;
	}
	Flow.NoteResult(MissionRead);
}

FReply SWonderlandJuliusMissionFlow::UseTerminal()
{
	NotifyTerminalUsed();
	return FReply::Handled();
}

FReply SWonderlandJuliusMissionFlow::PickMission(FString MissionId)
{
	Flow.ChooseMission(TCHAR_TO_UTF8(*MissionId));
	Rebuild();
	return FReply::Handled();
}

FReply SWonderlandJuliusMissionFlow::ConfirmMission()
{
	const WonderlandJuliusMissionFlow::FDispatchIntent Intent = Flow.Confirm();
	if (!Intent.bSend) { return FReply::Handled(); }
	UWonderlandJuliusMissionSubsystem* Live = Session.Get();
	const bool bAccepted = Live != nullptr && Live->DispatchMission(UTF8_TO_TCHAR(Intent.MissionId.c_str()), FString());
	Flow.NoteDispatchHandedToWrapper(bAccepted);
	PullWrapper();
	Rebuild();
	return FReply::Handled();
}

FReply SWonderlandJuliusMissionFlow::ReturnToChoice()
{
	Flow.BackToChoice();
	Rebuild();
	return FReply::Handled();
}

void SWonderlandJuliusMissionFlow::Rebuild()
{
	const WonderlandJuliusMissionFlow::FFlowView View = Flow.View();
	UWonderlandJuliusMissionSubsystem* Live = Session.Get();
	const FString WrapperLabel = Live != nullptr ? Live->PlayerLabel() : FString();
	FString ProgressLine = MissionFlowUtf8(View.Progress.Line);
	if (View.Progress.bUsesWrapperLabel)
	{
		ProgressLine = WrapperLabel;
	}
	FString Reported;
	for (const std::string& Line : View.Result.Lines)
	{
		Reported += MissionFlowUtf8(Line.c_str());
		Reported += TEXT("\n");
	}
	const FString Key = FString::Printf(
		TEXT("%d|%d%d%d%d|%s|%s|%s|%d|%d|%s"),
		static_cast<int32>(View.Step),
		View.bShowChoice ? 1 : 0,
		View.bShowConfirm ? 1 : 0,
		View.bShowProgress ? 1 : 0,
		View.bShowResult ? 1 : 0,
		*ProgressLine,
		*MissionFlowUtf8(View.Result.Line),
		*MissionFlowUtf8(View.PaidOnDispatch),
		View.Result.bShowsArtifact ? 1 : 0,
		View.Result.bFinished ? 1 : 0,
		*Reported);
	if (Key == ShownKey) { return; }
	ShownKey = Key;

	Body->ClearChildren();
	auto AddText = [this](const FString& Text)
	{
		Body->AddSlot().AutoHeight().Padding(0.0f, 4.0f)
		[
			SNew(STextBlock).Text(FText::FromString(Text))
		];
	};

	if (View.Step == WonderlandJuliusMissionFlow::EFlowStep::AtTerminal)
	{
		AddText(TEXT("An in-world terminal. Nothing has been sent."));
		Body->AddSlot().AutoHeight()
		[
			SNew(SButton)
			.OnClicked(this, &SWonderlandJuliusMissionFlow::UseTerminal)
			[
				SNew(STextBlock).Text(FText::FromString(TEXT("Use terminal")))
			]
		];
		return;
	}

	if (View.bShowChoice)
	{
		AddText(TEXT("Choose a mission."));
		for (const WonderlandJuliusMissionFlow::FMissionOffer& Offer : Flow.Offers())
		{
			const FString Id = MissionFlowUtf8(Offer.Id.c_str());
			const FString Title = MissionFlowUtf8(Offer.Title.c_str());
			Body->AddSlot().AutoHeight().Padding(0.0f, 2.0f)
			[
				SNew(SButton)
				.OnClicked_Lambda([this, Id]() { return PickMission(Id); })
				[
					SNew(STextBlock).Text(FText::FromString(Title.IsEmpty() ? Id : Title))
				]
			];
		}
		if (Flow.Offers().empty())
		{
			AddText(TEXT("No mission is offered."));
		}
	}

	if (View.bShowConfirm)
	{
		AddText(MissionFlowUtf8(View.PaidNature));
		AddText(MissionFlowUtf8(View.PaidOnDispatch));
		AddText(MissionFlowUtf8(View.BridgeWindow));
		AddText(MissionFlowUtf8(View.ClientHold));
		Body->AddSlot().AutoHeight()
		[
			SNew(SButton)
			.OnClicked(this, &SWonderlandJuliusMissionFlow::ConfirmMission)
			[
				SNew(STextBlock).Text(FText::FromString(TEXT("Confirm")))
			]
		];
		Body->AddSlot().AutoHeight()
		[
			SNew(SButton)
			.OnClicked(this, &SWonderlandJuliusMissionFlow::ReturnToChoice)
			[
				SNew(STextBlock).Text(FText::FromString(TEXT("Back")))
			]
		];
	}

	if (View.bShowProgress)
	{
		AddText(TEXT("Progress"));
		AddText(ProgressLine);
	}

	if (View.bShowResult)
	{
		AddText(TEXT("Result"));
		AddText(MissionFlowUtf8(View.Result.Line));
		for (const std::string& Line : View.Result.Lines)
		{
			AddText(MissionFlowUtf8(Line.c_str()));
		}
	}
}
