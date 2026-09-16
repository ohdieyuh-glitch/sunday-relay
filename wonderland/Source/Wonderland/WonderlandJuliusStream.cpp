#include "WonderlandJuliusStream.h"

#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandUiStyle.h"

// Named, not anonymous: the module is one unity translation unit.
namespace WonderlandJuliusStreamDetail
{
	/** Each component's own colour for its tag, so a reader can follow one component down the stream. */
	FLinearColor RoleColour(EWonderlandJuliusRole Role)
	{
		switch (Role)
		{
		case EWonderlandJuliusRole::PromptArchitect:     return WonderlandUi::Sky();
		case EWonderlandJuliusRole::CodingAgent:         return WonderlandUi::Green();
		case EWonderlandJuliusRole::IndependentReviewer: return WonderlandUi::Coral();
		default: break;
		}
		return WonderlandUi::Gold();
	}

	const TCHAR* ShortName(EWonderlandJuliusRole Role)
	{
		switch (Role)
		{
		case EWonderlandJuliusRole::PromptArchitect:     return TEXT("ARCHITECT");
		case EWonderlandJuliusRole::CodingAgent:         return TEXT("CODER");
		case EWonderlandJuliusRole::IndependentReviewer: return TEXT("REVIEWER");
		default: break;
		}
		return TEXT("JULIUS");
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
		case K::Section:     return { TEXT(""),        WonderlandUi::Gold(0.80f) };
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

	const TCHAR* KindName(EWonderlandRoleLineKind Kind)
	{
		static const TCHAR* const Names[] = { TEXT("Log"), TEXT("Section"), TEXT("Command"), TEXT("Preview"), TEXT("PreviewRule"),
			TEXT("File"), TEXT("DiffAdd"), TEXT("DiffRemove"), TEXT("Pass"), TEXT("Fail"), TEXT("CheckDone"), TEXT("CheckOpen"),
			TEXT("Finding"), TEXT("State"), TEXT("Wait") };
		const int32 Index = static_cast<int32>(Kind);
		return Index >= 0 && Index < UE_ARRAY_COUNT(Names) ? Names[Index] : TEXT("");
	}
}

void SWonderlandJuliusStream::Construct(const FArguments& InArgs)
{
	MaxLines = FMath::Clamp(InArgs._MaxLines, 20, 400);
	LineSize = FMath::Clamp(InArgs._LineSize, 7, 14);
	for (FString& Status : Statuses)
	{
		Status = TEXT("STANDBY");
	}
	SAssignNew(Body, SVerticalBox);

	const TSharedRef<SHorizontalBox> StatusLine = SNew(SHorizontalBox);
	for (int32 Index = 0; Index < WonderlandJuliusRoleCount; ++Index)
	{
		const EWonderlandJuliusRole Role = static_cast<EWonderlandJuliusRole>(Index);
		StatusLine->AddSlot()
			.FillWidth(1.0f)
			.Padding(0.0f, 0.0f, 6.0f, 0.0f)
			[
				SNew(STextBlock)
				.Text_Lambda([this, Index, Role]()
				{
					return FText::FromString(FString::Printf(TEXT("%s · %s"), WonderlandJuliusStreamDetail::ShortName(Role), *Statuses[Index]));
				})
				.Font(WonderlandUi::Mono(FMath::Max(LineSize - 1, 7)))
				.ColorAndOpacity(WonderlandJuliusStreamDetail::RoleColour(Role))
				.OverflowPolicy(ETextOverflowPolicy::Ellipsis)
			];
	}

	ChildSlot
	[
		SNew(SVerticalBox)
		// WHAT ALL FOUR ARE DOING NOW, in one line: the simultaneity the stream itself can only show one line at a time.
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(0.0f, 0.0f, 0.0f, 3.0f)
		[
			StatusLine
		]
		+ SVerticalBox::Slot()
		.FillHeight(1.0f)
		[
			SAssignNew(Scroll, SScrollBox)
			.ScrollBarVisibility(EVisibility::Visible)
			.ScrollBarThickness(FVector2D(3.0f, 3.0f))
			+ SScrollBox::Slot()
			[
				Body.ToSharedRef()
			]
		]
	];
}

void SWonderlandJuliusStream::AddRow(const FString& Text, const FLinearColor& Colour, bool bTag)
{
	const TSharedRef<SWidget> Row = SNew(STextBlock)
		.Text(FText::FromString(Text))
		.Font(bTag ? WonderlandUi::Sans(LineSize, true, 110) : WonderlandUi::Mono(LineSize))
		.ColorAndOpacity(Colour)
		.OverflowPolicy(ETextOverflowPolicy::Ellipsis);
	Body->AddSlot()
		.AutoHeight()
		.Padding(0.0f, bTag ? 5.0f : 0.0f, 0.0f, 0.0f)
		[
			Row
		];
	Rows.Add(Row);
	while (Rows.Num() > MaxLines)
	{
		Body->RemoveSlot(Rows[0]);
		Rows.RemoveAt(0);
	}
	// FOLLOW THE NEWEST LINE. The history stays above it, a scroll away.
	if (Scroll.IsValid())
	{
		Scroll->ScrollToEnd();
	}
}

void SWonderlandJuliusStream::AddRoleLine(EWonderlandJuliusRole Role, const FWonderlandRoleLine& Line)
{
	const int32 Index = static_cast<int32>(Role);
	if (Index < 0 || Index >= WonderlandJuliusRoleCount)
	{
		return;
	}
	// THE TAG, when the stream turns to another component or that component's status has changed since it last spoke.
	if (!LastRole.IsSet() || LastRole.GetValue() != Role || LastStatusTagged[Index] != Statuses[Index])
	{
		AddRow(FString::Printf(TEXT("[%s]  STATUS · %s"), WonderlandJuliusRoleTitle(Role), *Statuses[Index]),
			WonderlandJuliusStreamDetail::RoleColour(Role), true);
		LastRole = Role;
		LastStatusTagged[Index] = Statuses[Index];
	}
	const WonderlandJuliusStreamDetail::FStyle Style = WonderlandJuliusStreamDetail::StyleFor(Line.Kind);
	AddRow(FString(TEXT("  ")) + Style.Prefix + Line.Text, Style.Colour, false);
	++Written[Index];
	Latest[Index] = Line;
}

void SWonderlandJuliusStream::SetRoleStatus(EWonderlandJuliusRole Role, const FString& Status)
{
	const int32 Index = static_cast<int32>(Role);
	if (Index >= 0 && Index < WonderlandJuliusRoleCount)
	{
		Statuses[Index] = Status;
	}
}

const FString& SWonderlandJuliusStream::GetRoleStatus(EWonderlandJuliusRole Role) const
{
	static const FString None;
	const int32 Index = static_cast<int32>(Role);
	return Index >= 0 && Index < WonderlandJuliusRoleCount ? Statuses[Index] : None;
}

int32 SWonderlandJuliusStream::GetRoleWrittenCount(EWonderlandJuliusRole Role) const
{
	const int32 Index = static_cast<int32>(Role);
	return Index >= 0 && Index < WonderlandJuliusRoleCount ? Written[Index] : 0;
}

FString SWonderlandJuliusStream::GetRoleLatestText(EWonderlandJuliusRole Role) const
{
	const int32 Index = static_cast<int32>(Role);
	return Index >= 0 && Index < WonderlandJuliusRoleCount ? Latest[Index].Text : FString();
}

FString SWonderlandJuliusStream::GetRoleLatestKind(EWonderlandJuliusRole Role) const
{
	const int32 Index = static_cast<int32>(Role);
	return Index >= 0 && Index < WonderlandJuliusRoleCount && Written[Index] > 0
		? FString(WonderlandJuliusStreamDetail::KindName(Latest[Index].Kind)) : FString();
}

void SWonderlandJuliusStream::Clear()
{
	Body->ClearChildren();
	Rows.Reset();
	LastRole.Reset();
	for (int32 Index = 0; Index < WonderlandJuliusRoleCount; ++Index)
	{
		Statuses[Index] = TEXT("STANDBY");
		LastStatusTagged[Index].Reset();
		Written[Index] = 0;
		Latest[Index] = FWonderlandRoleLine();
	}
}
