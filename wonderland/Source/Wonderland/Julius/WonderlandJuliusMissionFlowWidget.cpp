#include "WonderlandJuliusMissionFlowWidget.h"

#include "Wonderland/WonderlandJuliusMissionFlow.h"
#include "WonderlandJuliusMissionSubsystem.h"

#include "Styling/CoreStyle.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
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
	OnRequestClose = InArgs._OnRequestClose;
	ChildSlot
	.HAlign(HAlign_Center)
	.VAlign(VAlign_Center)
	[
		SNew(SBox)
		.WidthOverride(620.0f)
		[
			SNew(SBorder)
			.BorderImage(FCoreStyle::Get().GetBrush(TEXT("GenericWhiteBox")))
			.BorderBackgroundColor(FLinearColor(0.02f, 0.03f, 0.05f, 0.94f))
			.ForegroundColor(FLinearColor::White)
			.Padding(FMargin(24.0f, 18.0f))
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 8.0f)
				[
					SNew(STextBlock)
					.Text(FText::FromString(TEXT("JULIUS MISSION TERMINAL")))
					.Font(FCoreStyle::GetDefaultFontStyle("Bold", 16))
				]
				+ SVerticalBox::Slot().AutoHeight()
				[
					SAssignNew(Body, SVerticalBox)
				]
				// IN-WONDERLAND START (founder P0 2026-10-25): built ONCE, shown only while the start is offered.
				+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)
				[
					SNew(SBorder)
					.Visibility_Lambda([this]() { const UWonderlandJuliusMissionSubsystem* Live = Session.Get(); return Live != nullptr && Live->IsStartOffered() ? EVisibility::Visible : EVisibility::Collapsed; })
					.BorderImage(FCoreStyle::Get().GetBrush(TEXT("GenericWhiteBox")))
					.BorderBackgroundColor(FLinearColor(0.35f, 0.04f, 0.04f, 0.92f))
					.Padding(FMargin(12.0f, 10.0f))
					[
						SNew(SVerticalBox)
						+ SVerticalBox::Slot().AutoHeight()
						[
							SNew(STextBlock).Font(FCoreStyle::GetDefaultFontStyle("Bold", 13))
							.Text(FText::FromString(TEXT("START THE PAID MISSION")))
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 4.0f)
						[
							SNew(STextBlock).AutoWrapText(true)
							.Text(FText::FromString(TEXT("Mission julius-inworld-data-1, lane lab. This starts the real paid Julius run: at most $30 of provider spend and up to 3 repair cycles, enforced by the bridge and the paid workflow. It runs once for this admission. Type RUN LIVE MISSION, then press Start.")))
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 6.0f)
						[
							SAssignNew(StartConfirmBox, SEditableTextBox)
							.HintText(FText::FromString(TEXT("RUN LIVE MISSION")))
							.OnTextChanged_Lambda([this](const FText& Text) { StartTyped = Text.ToString(); })
						]
						+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Left)
						[
							SNew(SButton)
							.IsEnabled_Lambda([this]() { return WonderlandJuliusMissionFlow::StartConfirmTextOk(TCHAR_TO_UTF8(*StartTyped)); })
							.OnClicked(this, &SWonderlandJuliusMissionFlow::StartPaidMission)
							[
								SNew(STextBlock).Text(FText::FromString(TEXT("Start")))
							]
						]
					]
				]
				+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f)
				[
					SNew(STextBlock).AutoWrapText(true)
					.Visibility_Lambda([this]() { const UWonderlandJuliusMissionSubsystem* Live = Session.Get(); return Live != nullptr && !Live->StartStatusLine().IsEmpty() ? EVisibility::Visible : EVisibility::Collapsed; })
					.Text_Lambda([this]() { const UWonderlandJuliusMissionSubsystem* Live = Session.Get(); return FText::FromString(Live != nullptr ? Live->StartStatusLine() : FString()); })
				]
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Right).Padding(0.0f, 12.0f, 0.0f, 0.0f)
				[
					SNew(SButton)
					.OnClicked_Lambda([this]() { OnRequestClose.ExecuteIfBound(); return FReply::Handled(); })
					[
						SNew(STextBlock).Text(FText::FromString(TEXT("Close (Esc)")))
					]
				]
			]
		]
	];
	Rebuild();
}

FReply SWonderlandJuliusMissionFlow::OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	if (InKeyEvent.GetKey() == EKeys::Escape || InKeyEvent.GetKey() == EKeys::K)
	{
		OnRequestClose.ExecuteIfBound();
		return FReply::Handled();
	}
	return SCompoundWidget::OnKeyDown(MyGeometry, InKeyEvent);
}

bool SWonderlandJuliusMissionFlow::QaPick(const FString& MissionId)
{
	PullMissionReads();
	PullWrapper();
	if (!Flow.View().bShowChoice) { return false; }
	PickMission(MissionId);
	return Flow.View().bShowConfirm;
}

bool SWonderlandJuliusMissionFlow::QaStart(const FString& Typed)
{
	PullMissionReads();
	PullWrapper();
	const UWonderlandJuliusMissionSubsystem* Live = Session.Get();
	if (Live == nullptr || !Live->IsStartOffered()) { return false; }
	StartTyped = Typed;
	if (StartConfirmBox.IsValid()) { StartConfirmBox->SetText(FText::FromString(Typed)); }
	StartPaidMission();
	return true;
}

FReply SWonderlandJuliusMissionFlow::StartPaidMission()
{
	UWonderlandJuliusMissionSubsystem* Live = Session.Get();
	if (Live != nullptr) { (void)Live->StartPaidMission(StartTyped); }
	StartTyped.Reset();
	if (StartConfirmBox.IsValid()) { StartConfirmBox->SetText(FText::GetEmpty()); }
	Rebuild();
	return FReply::Handled();
}

bool SWonderlandJuliusMissionFlow::QaConfirm()
{
	if (!Flow.View().bShowConfirm) { return false; }
	ConfirmMission();
	return true;
}

FString SWonderlandJuliusMissionFlow::QaDescribe() const
{
	const WonderlandJuliusMissionFlow::FFlowView View = Flow.View();
	const UWonderlandJuliusMissionSubsystem* Live = Session.Get();
	FString Progress = MissionFlowUtf8(View.Progress.Line);
	if (View.Progress.bUsesWrapperLabel && Live != nullptr) { Progress = Live->PlayerLabel(); }
	FString Lines;
	for (const std::string& Line : View.Result.Lines)
	{
		if (!Lines.IsEmpty()) { Lines += TEXT(" / "); }
		Lines += MissionFlowUtf8(Line.c_str());
	}
	bool bLive = false;
	FString LiveHeader;
	TArray<FString> LiveLines;
	if (Live != nullptr) { (void)Live->LatestLivePanel(bLive, LiveHeader, LiveLines); }
	return FString::Printf(
		TEXT("start_offered=%d start=\"%s\" julius=%s step=%d choice=%d confirm=%d progress=%d result=%d finished=%d verified=%d wlj=%s progress_line=\"%s\" result_line=\"%s\" result_lines=\"%s\" live=%d live_header=\"%s\" live_lines=\"%s\""),
		Live != nullptr && Live->IsStartOffered() ? 1 : 0,
		Live != nullptr ? *Live->StartStatusLine() : TEXT(""),
		Live == nullptr ? TEXT("none") : Live->HasNativeSession() ? TEXT("connected") : TEXT("not_connected"),
		static_cast<int32>(View.Step),
		View.bShowChoice ? 1 : 0,
		View.bShowConfirm ? 1 : 0,
		View.bShowProgress ? 1 : 0,
		View.bShowResult ? 1 : 0,
		View.Result.bFinished ? 1 : 0,
		View.Result.bVerified ? 1 : 0,
		Live != nullptr ? *Live->ClientRunId() : TEXT(""),
		*Progress,
		*MissionFlowUtf8(View.Result.Line),
		*Lines,
		bLive ? 1 : 0,
		*LiveHeader,
		*FString::Join(LiveLines, TEXT(" / ")));
}

void SWonderlandJuliusMissionFlow::Tick(const FGeometry& AllottedGeometry, double InCurrentTime, float InDeltaTime)
{
	SCompoundWidget::Tick(AllottedGeometry, InCurrentTime, InDeltaTime);
	PullMissionReads();
	PullWrapper();
	Rebuild();
	// The close after an accepted start lives in UWonderlandUiSubsystem::TickLiveJulius (a ticker, not this paint tick).
}

void SWonderlandJuliusMissionFlow::PullMissionReads()
{
	UWonderlandJuliusMissionSubsystem* Live = Session.Get();
	if (Live == nullptr) { return; }
	int32 ResultStatus = 0;
	int32 ProgressStatus = 0;
	FString ResultJson;
	FString ProgressJson;
	if (!Live->LatestMissionReads(ResultStatus, ResultJson, ProgressStatus, ProgressJson))
	{
		if (!PulledReadKey.IsEmpty())
		{
			// The run changed or ended: drop the old run's answers, back to the absent reader.
			PulledReadKey.Reset();
			bHaveMissionRead = false;
			MissionRead.Clear();
		}
		return;
	}
	const FString Key = FString::Printf(TEXT("%s|%d|%d|%s|%s"), *Live->ClientRunId(), ResultStatus, ProgressStatus, *ResultJson, *ProgressJson);
	if (Key == PulledReadKey) { return; }
	PulledReadKey = Key;
	bHaveMissionRead = ResultStatus != 0 || ProgressStatus != 0 || !ResultJson.IsEmpty() || !ProgressJson.IsEmpty();
	MissionRead.Clear();
	if (ResultStatus != 0 || !ResultJson.IsEmpty()) { MissionRead.SetResultResponse(ResultStatus, TCHAR_TO_UTF8(*ResultJson)); }
	if (ProgressStatus != 0 || !ProgressJson.IsEmpty()) { MissionRead.SetProgressResponse(ProgressStatus, TCHAR_TO_UTF8(*ProgressJson)); }
}

void SWonderlandJuliusMissionFlow::NotifyTerminalUsed()
{
	Flow.InteractWithTerminal();
	Rebuild();
}

void SWonderlandJuliusMissionFlow::Refresh()
{
	PullMissionReads();
	PullWrapper();
	Rebuild();
}

void SWonderlandJuliusMissionFlow::SetNotice(const FString& InNotice, bool bInUntilPaired)
{
	Notice = InNotice;
	bNoticeUntilPaired = bInUntilPaired;
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
	if (Live != nullptr && !Live->ClientRunId().IsEmpty() && !Live->CanStartNewMission() && !Flow.View().bDispatchHanded)
	{
		// A LIVE run restored from the save after a restart: watch it, never offer a second paid Confirm over it.
		// A terminal saved run is not resumed (REVIEW M4): an old result is never shown as the current mission.
		Flow.ResumeWatching(TCHAR_TO_UTF8(*Live->CurrentMissionId()));
	}
	if (Live != nullptr && bNoticeUntilPaired && Live->HasNativeSession())
	{
		// The pairing hint is done once the J1 subsystem holds the paired session.
		Notice.Reset();
		bNoticeUntilPaired = false;
	}
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
	// REVIEW M4 (#456): after a terminal run the player can start again; while a run is live they cannot.
	const bool bCanStartAgain = View.Step == WonderlandJuliusMissionFlow::EFlowStep::Watching && Live != nullptr && Live->CanStartNewMission();
	const FString WrapperLabel = Live != nullptr ? Live->PlayerLabel() : FString();
	FString ProgressLine = MissionFlowUtf8(View.Progress.Line);
	if (View.Progress.bUsesWrapperLabel)
	{
		ProgressLine = WrapperLabel;
	}
	// LIVE RUN VIEW: worded by the flow core from the bridge's /events feed; LIVE only on the server's live flag.
	// JULIUS CONNECTION (founder blocker 2026-10-25): an admitted run with no paired session is not watched.
	FString JuliusLine;
	if (View.bShowProgress && Live != nullptr && !Live->ClientRunId().IsEmpty())
	{
		if (Live->HasNativeSession())
		{
			JuliusLine = FString::Printf(TEXT("Julius: connected to the mission bridge (%s)."), *Live->EndpointBase());
		}
		else if (!Live->CanStartNewMission())
		{
			// REVIEW LOW: "still admitted" only while the run is live; a terminal run is not described as admitted.
			JuliusLine = TEXT("Julius: NOT CONNECTED. This mission is still admitted and nothing is re-sent. To watch it, open the terminal (Ctrl+T) and type /brain pair <code>.");
		}
		else
		{
			JuliusLine = TEXT("Julius: not connected to the mission bridge.");
		}
	}
	bool bLiveRun = false;
	FString LiveHeader;
	TArray<FString> LiveLines;
	const bool bShowLive = View.bShowProgress && Live != nullptr && Live->LatestLivePanel(bLiveRun, LiveHeader, LiveLines);
	bool bStatusSuccess = false;
	FString StatusHeader;
	TArray<FString> StatusLines;
	const bool bShowStatus = (View.bShowProgress || View.bShowResult) && Live != nullptr && Live->LatestStatusPanel(bStatusSuccess, StatusHeader, StatusLines);
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
		*Reported) + TEXT("|") + Notice + (bCanStartAgain ? TEXT("|again") : TEXT(""))
		+ TEXT("|") + JuliusLine
		+ (bShowLive ? FString::Printf(TEXT("|live%d|%s|%s"), bLiveRun ? 1 : 0, *LiveHeader, *FString::Join(LiveLines, TEXT("\n"))) : FString())
		+ (bShowStatus ? FString::Printf(TEXT("|status%d|%s|%s"), bStatusSuccess ? 1 : 0, *StatusHeader, *FString::Join(StatusLines, TEXT("\n"))) : FString());
	if (Key == ShownKey) { return; }
	ShownKey = Key;

	Body->ClearChildren();
	auto AddText = [this](const FString& Text)
	{
		Body->AddSlot().AutoHeight().Padding(0.0f, 4.0f)
		[
			SNew(STextBlock).Text(FText::FromString(Text)).AutoWrapText(true)
		];
	};
	if (!Notice.IsEmpty())
	{
		AddText(Notice);
	}

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

	if (!JuliusLine.IsEmpty())
	{
		AddText(JuliusLine);
	}

	if (View.bShowProgress)
	{
		AddText(TEXT("Progress"));
		AddText(ProgressLine);
	}

	if (bShowStatus)
	{
		// The bridge's /status (A-9) decides the state; lines are only what it emitted (no model, no cost).
		AddText(StatusHeader);
		for (const FString& Line : StatusLines) { AddText(Line); }
	}

	if (bShowLive)
	{
		// Red only for the server's LIVE; amber for anything else (recorded, finished, unavailable).
		const FLinearColor Badge = bLiveRun ? FLinearColor(0.75f, 0.05f, 0.05f, 1.0f) : FLinearColor(0.55f, 0.38f, 0.02f, 1.0f);
		Body->AddSlot().AutoHeight().Padding(0.0f, 8.0f, 0.0f, 2.0f)
		[
			SNew(SBorder)
			.BorderImage(FCoreStyle::Get().GetBrush(TEXT("GenericWhiteBox")))
			.BorderBackgroundColor(Badge)
			.ForegroundColor(FLinearColor::White)
			.Padding(FMargin(8.0f, 4.0f))
			[
				SNew(STextBlock)
				.Text(FText::FromString(LiveHeader))
				.Font(FCoreStyle::GetDefaultFontStyle("Bold", 12))
				.AutoWrapText(true)
			]
		];
		for (const FString& Line : LiveLines)
		{
			Body->AddSlot().AutoHeight().Padding(0.0f, 1.0f)
			[
				SNew(STextBlock).Text(FText::FromString(Line)).Font(FCoreStyle::GetDefaultFontStyle("Regular", 10)).AutoWrapText(true)
			];
		}
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

	if (bCanStartAgain)
	{
		Body->AddSlot().AutoHeight().Padding(0.0f, 8.0f, 0.0f, 0.0f)
		[
			SNew(SButton)
			.OnClicked(this, &SWonderlandJuliusMissionFlow::StartAgain)
			[
				SNew(STextBlock).Text(FText::FromString(TEXT("New mission")))
			]
		];
	}
}

FReply SWonderlandJuliusMissionFlow::StartAgain()
{
	UWonderlandJuliusMissionSubsystem* Live = Session.Get();
	if (Live != nullptr && Live->CanStartNewMission() && Flow.StartAgain())
	{
		PulledReadKey.Reset();
		bHaveMissionRead = false;
		MissionRead.Clear();
	}
	Rebuild();
	return FReply::Handled();
}
