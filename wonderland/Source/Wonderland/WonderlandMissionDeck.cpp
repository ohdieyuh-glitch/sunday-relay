#include "WonderlandMissionDeck.h"

#include "Widgets/Layout/SBorder.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandUiStyle.h"

// Named, not anonymous: the module is one unity translation unit.
namespace WonderlandMissionDeckDetail
{
	/** What a status means, by colour: at rest, working, delivered, or dealing with a fault. */
	FLinearColor StatusColour(const FString& Status)
	{
		if (Status == TEXT("STANDBY") || Status == TEXT("WAITING") || Status == TEXT("PAUSED"))
		{
			return WonderlandUi::Dim();
		}
		if (Status == TEXT("RETURNED") || Status == TEXT("DONE") || Status == TEXT("SUBMITTED") || Status == TEXT("COMPLETE"))
		{
			return WonderlandUi::Sage();
		}
		if (Status == TEXT("REPAIRING") || Status == TEXT("CHALLENGING") || Status == TEXT("RE-REVIEW"))
		{
			return WonderlandUi::Coral();
		}
		return WonderlandUi::Gold();
	}

	struct FStyle
	{
		const TCHAR* Prefix;
		FLinearColor Colour;
	};

	FStyle StyleFor(EWonderlandRoleLineKind Kind)
	{
		using K = EWonderlandRoleLineKind;
		switch (Kind)
		{
		case K::Section:     return { TEXT(""),        WonderlandUi::Gold(0.95f) };
		case K::Command:     return { TEXT(""),        WonderlandUi::Sky(0.95f) };
		case K::Preview:     return { TEXT("| "),      WonderlandUi::Cream(0.92f) };
		case K::PreviewRule: return { TEXT(""),        WonderlandUi::Faint() };
		case K::File:        return { TEXT(""),        WonderlandUi::Gold(0.85f) };
		case K::DiffAdd:     return { TEXT("+ "),      WonderlandUi::Green() };
		case K::DiffRemove:  return { TEXT("- "),      WonderlandUi::Coral(0.95f) };
		case K::Pass:        return { TEXT("PASS  "),  WonderlandUi::Green() };
		case K::Fail:        return { TEXT("FAIL  "),  WonderlandUi::Coral() };
		case K::CheckDone:   return { TEXT("● "), WonderlandUi::Sage() };
		case K::CheckOpen:   return { TEXT("○ "), WonderlandUi::Dim() };
		case K::Finding:     return { TEXT("! "),      WonderlandUi::Coral() };
		case K::State:       return { TEXT(""),        WonderlandUi::Ivory() };
		case K::Wait:        return { TEXT("… "), WonderlandUi::Dim() };
		default: break;
		}
		return { TEXT("> "), WonderlandUi::Cream(0.80f) };
	}
}

SWonderlandRoleConsole::SWonderlandRoleConsole()
	: FrameBrush(WonderlandUi::Srgb(8, 10, 14, 0.80f), 8.0f, WonderlandUi::GoldDim(), 1.0f)
{
}

void SWonderlandRoleConsole::Construct(const FArguments& InArgs)
{
	Title = InArgs._Title;
	Subtitle = InArgs._Subtitle;
	MaxLines = FMath::Clamp(InArgs._MaxLines, 3, 60);
	LineSize = FMath::Clamp(InArgs._LineSize, 7, 14);
	SAssignNew(Body, SVerticalBox);

	const TSharedRef<SWidget> Content =
		SNew(SVerticalBox)
		// THE HEADER: the role in gold, what it is doing now at the right, coloured by what that means.
		+ SVerticalBox::Slot()
		.AutoHeight()
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot()
			.AutoWidth()
			.VAlign(VAlign_Center)
			.Padding(0.0f, 0.0f, 6.0f, 0.0f)
			[
				SNew(STextBlock)
				.Text(FText::FromString(TEXT("●")))
				.Font(WonderlandUi::Mono(7))
				.ColorAndOpacity_Lambda([this]() { return FSlateColor(WonderlandMissionDeckDetail::StatusColour(Status)); })
			]
			+ SHorizontalBox::Slot()
			.FillWidth(1.0f)
			.VAlign(VAlign_Center)
			[
				SNew(STextBlock)
				.Text(FText::FromString(Title))
				.Font(WonderlandUi::Sans(InArgs._TitleSize, true, 120))
				.ColorAndOpacity(WonderlandUi::Gold())
			]
			+ SHorizontalBox::Slot()
			.AutoWidth()
			.VAlign(VAlign_Center)
			.Padding(8.0f, 0.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock)
				.Text_Lambda([this]() { return FText::FromString(TEXT("STATUS · ") + Status); })
				.Font(WonderlandUi::Mono(FMath::Max(InArgs._TitleSize - 1, 7)))
				.ColorAndOpacity_Lambda([this]() { return FSlateColor(WonderlandMissionDeckDetail::StatusColour(Status)); })
			]
		]
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(13.0f, 1.0f, 0.0f, 4.0f)
		[
			SNew(STextBlock)
			.Visibility(Subtitle.IsEmpty() ? EVisibility::Collapsed : EVisibility::HitTestInvisible)
			.Text(FText::FromString(Subtitle))
			.Font(WonderlandUi::Sans(7, true, 110))
			.ColorAndOpacity(WonderlandUi::Coral(0.85f))
		]
		+ SVerticalBox::Slot()
		.FillHeight(1.0f)
		[
			Body.ToSharedRef()
		];

	if (InArgs._bFramed)
	{
		ChildSlot
		[
			SNew(SBorder)
			.BorderImage(&FrameBrush)
			.Padding(FMargin(10.0f, 8.0f))
			[
				Content
			]
		];
	}
	else
	{
		ChildSlot
		[
			Content
		];
	}
}

TSharedRef<SWidget> SWonderlandRoleConsole::MakeRow(const FWonderlandRoleLine& Line) const
{
	const WonderlandMissionDeckDetail::FStyle Style = WonderlandMissionDeckDetail::StyleFor(Line.Kind);
	const bool bSection = Line.Kind == EWonderlandRoleLineKind::Section;
	return SNew(STextBlock)
		.Text(FText::FromString(FString(Style.Prefix) + Line.Text))
		.Font(bSection ? WonderlandUi::Sans(LineSize - 1, true, 130) : WonderlandUi::Mono(LineSize))
		.ColorAndOpacity(Style.Colour)
		.OverflowPolicy(ETextOverflowPolicy::Ellipsis);
}

void SWonderlandRoleConsole::AddLine(const FWonderlandRoleLine& Line)
{
	++Written;
	Lines.Add(Line);
	const bool bSection = Line.Kind == EWonderlandRoleLineKind::Section;
	const TSharedRef<SWidget> Row = MakeRow(Line);
	Body->AddSlot()
		.AutoHeight()
		.Padding(0.0f, bSection ? 4.0f : 0.0f, 0.0f, 0.0f)
		[
			Row
		];
	Rows.Add(Row);
	while (Rows.Num() > MaxLines)
	{
		Body->RemoveSlot(Rows[0]);
		Rows.RemoveAt(0);
		Lines.RemoveAt(0);
	}
}

FString SWonderlandRoleConsole::GetLatestKind() const
{
	if (Lines.Num() == 0)
	{
		return FString();
	}
	static const TCHAR* const Names[] = { TEXT("Log"), TEXT("Section"), TEXT("Command"), TEXT("Preview"), TEXT("PreviewRule"),
		TEXT("File"), TEXT("DiffAdd"), TEXT("DiffRemove"), TEXT("Pass"), TEXT("Fail"), TEXT("CheckDone"), TEXT("CheckOpen"),
		TEXT("Finding"), TEXT("State"), TEXT("Wait") };
	const int32 Index = static_cast<int32>(Lines.Last().Kind);
	return Index >= 0 && Index < UE_ARRAY_COUNT(Names) ? FString(Names[Index]) : FString();
}

void SWonderlandRoleConsole::Clear()
{
	Body->ClearChildren();
	Rows.Reset();
	Lines.Reset();
	Written = 0;
	Status = TEXT("STANDBY");
}
