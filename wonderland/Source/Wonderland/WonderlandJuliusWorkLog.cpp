#include "WonderlandJuliusWorkLog.h"

#include "Fonts/FontMeasure.h"
#include "Misc/Paths.h"
#include "Framework/Application/SlateApplication.h"
#include "Rendering/DrawElements.h"
#include "Rendering/SlateRenderer.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandUiStyle.h"

// Named, not anonymous: the module is one unity translation unit.
namespace WonderlandWorkLogDetail
{
	FLinearColor Keyword()  { return WonderlandUi::Srgb(0xC7, 0x92, 0xEA); }
	FLinearColor Function() { return WonderlandUi::Srgb(0x82, 0xAA, 0xFF); }
	FLinearColor TypeName() { return WonderlandUi::Srgb(0xFF, 0xCB, 0x6B); }
	FLinearColor Str()      { return WonderlandUi::Srgb(0xC3, 0xE8, 0x8D); }
	FLinearColor Number()   { return WonderlandUi::Srgb(0xF7, 0x8C, 0x6C); }
	FLinearColor Comment()  { return WonderlandUi::Srgb(0x67, 0x6E, 0x95); }
	FLinearColor Punct()    { return WonderlandUi::Srgb(0x89, 0xDD, 0xFF); }

	bool IsKeyword(const FString& Word)
	{
		static const TSet<FString> Words = {
			TEXT("export"), TEXT("import"), TEXT("from"), TEXT("function"), TEXT("const"), TEXT("let"), TEXT("var"),
			TEXT("return"), TEXT("if"), TEXT("else"), TEXT("for"), TEXT("while"), TEXT("await"), TEXT("async"), TEXT("new"),
			TEXT("throw"), TEXT("true"), TEXT("false"), TEXT("null"), TEXT("undefined"), TEXT("type"), TEXT("interface"),
			TEXT("class"), TEXT("extends"), TEXT("implements"), TEXT("private"), TEXT("public"), TEXT("readonly"),
			TEXT("try"), TEXT("catch"), TEXT("finally"), TEXT("typeof"), TEXT("instanceof"), TEXT("of"), TEXT("in") };
		return Words.Contains(Word);
	}

	/** "174|+|  const grant = ..." -> number, marker, code. A line that is not in that shape is all code. */
	void SplitCodeLine(const FString& Text, FString& OutNumber, TCHAR& OutMarker, FString& OutCode)
	{
		OutNumber.Reset();
		OutMarker = TEXT(' ');
		OutCode = Text;
		int32 First = INDEX_NONE;
		if (!Text.FindChar(TEXT('|'), First))
		{
			return;
		}
		const int32 Second = Text.Find(TEXT("|"), ESearchCase::CaseSensitive, ESearchDir::FromStart, First + 1);
		if (Second == INDEX_NONE)
		{
			return;
		}
		OutNumber = Text.Left(First).TrimStartAndEnd();
		const FString Marker = Text.Mid(First + 1, Second - First - 1);
		OutMarker = Marker.IsEmpty() ? TEXT(' ') : Marker[0];
		OutCode = Text.Mid(Second + 1);
	}

	TSharedRef<SWidget> Plain(const FString& Text, const FLinearColor& Color, const FSlateFontInfo& Font, float Left = 0.0f)
	{
		return SNew(SBox)
			.Padding(FMargin(Left, 0.0f, 0.0f, 0.0f))
			[
				SNew(STextBlock)
				.Text(FText::FromString(Text))
				.Font(Font)
				.ColorAndOpacity(Color)
				.AutoWrapText(true)
			];
	}
}

/* ------------------------------------------------------------ typed text */

void SWonderlandTypedText::Construct(const FArguments& InArgs)
{
	Text = InArgs._Text;
	Font = InArgs._Font;
	Reveal = -1;
	Tokenize(InArgs._Syntax, InArgs._Color);
}

void SWonderlandTypedText::Tokenize(bool bSyntax, const FLinearColor& Plain)
{
	using namespace WonderlandWorkLogDetail;
	Tokens.Reset();
	if (!bSyntax)
	{
		Tokens.Add({ 0, Text.Len(), Plain });
		return;
	}
	const int32 Len = Text.Len();
	int32 I = 0;
	while (I < Len)
	{
		const TCHAR C = Text[I];
		FToken Token;
		Token.Start = I;
		if (C == TEXT('/') && I + 1 < Len && Text[I + 1] == TEXT('/'))
		{
			Token.Length = Len - I;
			Token.Color = Comment();
		}
		else if (C == TEXT('\'') || C == TEXT('"') || C == TEXT('`'))
		{
			int32 J = I + 1;
			while (J < Len && Text[J] != C)
			{
				++J;
			}
			Token.Length = FMath::Min(J + 1, Len) - I;
			Token.Color = Str();
		}
		else if (FChar::IsDigit(C))
		{
			int32 J = I;
			while (J < Len && (FChar::IsDigit(Text[J]) || Text[J] == TEXT('.')))
			{
				++J;
			}
			Token.Length = J - I;
			Token.Color = Number();
		}
		else if (FChar::IsAlpha(C) || C == TEXT('_') || C == TEXT('$'))
		{
			int32 J = I;
			while (J < Len && (FChar::IsAlnum(Text[J]) || Text[J] == TEXT('_') || Text[J] == TEXT('$')))
			{
				++J;
			}
			const FString Word = Text.Mid(I, J - I);
			int32 K = J;
			while (K < Len && Text[K] == TEXT(' '))
			{
				++K;
			}
			Token.Length = J - I;
			if (IsKeyword(Word))
			{
				Token.Color = Keyword();
			}
			else if (K < Len && Text[K] == TEXT('('))
			{
				Token.Color = Function();
			}
			else if (FChar::IsUpper(C))
			{
				Token.Color = TypeName();
			}
			else
			{
				Token.Color = WonderlandUi::Cream();
			}
		}
		else if (FChar::IsWhitespace(C))
		{
			int32 J = I;
			while (J < Len && FChar::IsWhitespace(Text[J]))
			{
				++J;
			}
			Token.Length = J - I;
			Token.Color = WonderlandUi::Cream();
		}
		else
		{
			Token.Length = 1;
			Token.Color = Punct();
		}
		Tokens.Add(Token);
		I += FMath::Max(Token.Length, 1);
	}
}

FVector2D SWonderlandTypedText::ComputeDesiredSize(float LayoutScaleMultiplier) const
{
	if (!FSlateApplication::IsInitialized())
	{
		return FVector2D(Text.Len() * 7.0f, 13.0f);
	}
	const TSharedRef<FSlateFontMeasure> Measure = FSlateApplication::Get().GetRenderer()->GetFontMeasureService();
	const FVector2D Size = Measure->Measure(Text.IsEmpty() ? FString(TEXT(" ")) : Text, Font);
	return FVector2D(Size.X + 8.0, FMath::Max(Size.Y, static_cast<double>(Measure->GetMaxCharacterHeight(Font))));
}

int32 SWonderlandTypedText::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	const TSharedRef<FSlateFontMeasure> Measure = FSlateApplication::Get().GetRenderer()->GetFontMeasureService();
	const int32 Shown = Reveal < 0 ? Text.Len() : FMath::Clamp(Reveal, 0, Text.Len());
	float X = 0.0f;
	const float Height = static_cast<float>(AllottedGeometry.GetLocalSize().Y);
	for (const FToken& Token : Tokens)
	{
		if (Token.Start >= Shown)
		{
			break;
		}
		const FString Part = Text.Mid(Token.Start, FMath::Min(Token.Length, Shown - Token.Start));
		const float Width = static_cast<float>(Measure->Measure(Part, Font).X);
		if (!Part.TrimStartAndEnd().IsEmpty())
		{
			FSlateDrawElement::MakeText(OutDrawElements, LayerId,
				AllottedGeometry.ToPaintGeometry(FVector2f(Width + 2.0f, Height), FSlateLayoutTransform(FVector2f(X, 0.0f))),
				Part, Font, ESlateDrawEffect::None, Token.Color);
		}
		X += Width;
	}
	// THE CURSOR, while the line is still arriving.
	if (Reveal >= 0 && Reveal < Text.Len())
	{
		const double Now = FSlateApplication::Get().GetCurrentTime();
		if (FMath::Frac(Now * 1.8) < 0.62)
		{
			const float CharWidth = static_cast<float>(Measure->Measure(TEXT("M"), Font).X);
			FSlateDrawElement::MakeBox(OutDrawElements, LayerId + 1,
				AllottedGeometry.ToPaintGeometry(FVector2f(CharWidth * 0.8f, Height * 0.86f), FSlateLayoutTransform(FVector2f(X + 1.0f, Height * 0.07f))),
				FCoreStyle::Get().GetBrush("WhiteBrush"), ESlateDrawEffect::None, WonderlandUi::Gold(0.85f));
		}
	}
	return LayerId + 1;
}

/* ------------------------------------------------------------ the work log */

SWonderlandWorkLog::SWonderlandWorkLog()
	: PromptBrush(WonderlandUi::Srgb(20, 16, 10, 0.78f), 5.0f, WonderlandUi::Gold(0.55f), 1.0f)
	, FindingBrush(WonderlandUi::Srgb(26, 10, 9, 0.80f), 5.0f, WonderlandUi::Coral(0.75f), 1.0f)
	, AddBrush(WonderlandUi::Srgb(0x6F, 0xBF, 0x73, 0.13f), 2.0f)
	, RemoveBrush(WonderlandUi::Srgb(0xE2, 0x5B, 0x45, 0.14f), 2.0f)
	, SummaryBrush(WonderlandUi::Srgb(14, 16, 22, 0.70f), 3.0f, WonderlandUi::GoldDim(), 1.0f)
{
}

void SWonderlandWorkLog::Construct(const FArguments& InArgs)
{
	RestingText = InArgs._RestingText;
	ChildSlot
	[
		SAssignNew(Root, SVerticalBox)
	];
	Reset();
}

void SWonderlandWorkLog::Reset()
{
	Episodes.Reset();
	OpenPrompt.Reset();
	Typers.Reset();
	Written.Reset();
	Newest.Reset();
	NewestText.Reset();
	LineCount = 0;
	++ChangeSerial;
	if (Root.IsValid())
	{
		Root->ClearChildren();
		Root->AddSlot().AutoHeight()
		[
			WonderlandWorkLogDetail::Plain(RestingText, WonderlandUi::Dim(), WonderlandUi::Mono(9))
		];
	}
}

void SWonderlandWorkLog::EnsureEpisode()
{
	if (Episodes.Num() == 0)
	{
		BeginEpisode(FString());
	}
}

FString SWonderlandWorkLog::EpisodeSummaryText(const FEpisode& Episode) const
{
	if (!Episode.Summary.IsEmpty())
	{
		return Episode.Summary;
	}
	if (Episode.Added > 0 || Episode.Removed > 0)
	{
		return FString::Printf(TEXT("%s  +%d / -%d"), Episode.File.IsEmpty() ? TEXT("changes") : *Episode.File, Episode.Added, Episode.Removed);
	}
	return TEXT("done");
}

void SWonderlandWorkLog::BeginEpisode(const FString& Title)
{
	if (!Root.IsValid())
	{
		return;
	}
	if (LineCount == 0 && Episodes.Num() == 0)
	{
		// The resting line gives way to the first work.
		Root->ClearChildren();
	}
	OpenPrompt.Reset();
	// THE WORK BEFORE COLLAPSES, and stays: one line that a click opens again.
	for (const TSharedPtr<FEpisode>& Previous : Episodes)
	{
		Previous->bCollapsed = true;
	}
	TSharedPtr<FEpisode> Episode = MakeShared<FEpisode>();
	Episode->Title = Title;
	Episodes.Add(Episode);
	const TWeakPtr<FEpisode> Weak = Episode;
	const TWeakPtr<FEpisode> Latest = Episode;

	TSharedRef<SVerticalBox> Body = SNew(SVerticalBox)
		.Visibility_Lambda([Weak]()
		{
			const TSharedPtr<FEpisode> Pinned = Weak.Pin();
			return Pinned.IsValid() && Pinned->bCollapsed ? EVisibility::Collapsed : EVisibility::Visible;
		});
	Episode->Body = Body;

	// The header: the title while it is the work in hand; a clickable summary once it is history.
	Root->AddSlot().AutoHeight().Padding(0.0f, Episodes.Num() > 1 ? 3.0f : 0.0f, 0.0f, 0.0f)
	[
		SNew(SBorder)
		.BorderImage_Lambda([this, Weak]() -> const FSlateBrush*
		{
			const TSharedPtr<FEpisode> Pinned = Weak.Pin();
			static FSlateNoResource None;
			return Pinned.IsValid() && Pinned->bCollapsed ? static_cast<const FSlateBrush*>(&SummaryBrush) : static_cast<const FSlateBrush*>(&None);
		})
		.Padding(FMargin(3.0f, 1.0f))
		.Visibility_Lambda([Weak]()
		{
			const TSharedPtr<FEpisode> Pinned = Weak.Pin();
			return Pinned.IsValid() && (Pinned->bCollapsed || !Pinned->Title.IsEmpty()) ? EVisibility::Visible : EVisibility::Collapsed;
		})
		.OnMouseButtonDown_Lambda([Weak](const FGeometry&, const FPointerEvent&)
		{
			if (const TSharedPtr<FEpisode> Pinned = Weak.Pin())
			{
				Pinned->bCollapsed = !Pinned->bCollapsed;
				return FReply::Handled();
			}
			return FReply::Unhandled();
		})
		[
			SNew(STextBlock)
			.Font(WonderlandUi::Sans(8, true, 90))
			.ColorAndOpacity_Lambda([Weak]()
			{
				const TSharedPtr<FEpisode> Pinned = Weak.Pin();
				return FSlateColor(Pinned.IsValid() && Pinned->bCollapsed ? WonderlandUi::Dim() : WonderlandUi::Gold(0.9f));
			})
			.Text_Lambda([this, Weak]()
			{
				const TSharedPtr<FEpisode> Pinned = Weak.Pin();
				if (!Pinned.IsValid())
				{
					return FText::GetEmpty();
				}
				if (Pinned->bCollapsed)
				{
					return FText::FromString(FString::Printf(TEXT("▸ %s  ·  %s"),
						Pinned->Title.IsEmpty() ? TEXT("EARLIER WORK") : *Pinned->Title, *EpisodeSummaryText(*Pinned)));
				}
				return FText::FromString(FString::Printf(TEXT("▾ %s"), *Pinned->Title));
			})
		]
	];
	Root->AddSlot().AutoHeight()
	[
		Body
	];
	++ChangeSerial;
}

void SWonderlandWorkLog::SetEpisodeSummary(const FString& Summary)
{
	EnsureEpisode();
	Episodes.Last()->Summary = Summary;
}

TSharedRef<SWidget> SWonderlandWorkLog::MakeCodeRow(const FString& Number, TCHAR Marker, const FString& Code, TSharedPtr<SWonderlandTypedText>& OutTyper)
{
	const bool bAdd = Marker == TEXT('+');
	const bool bRemove = Marker == TEXT('-');
	static FSlateNoResource StaticNone;
	return SNew(SBorder)
		.BorderImage(bAdd ? static_cast<const FSlateBrush*>(&AddBrush) : (bRemove ? static_cast<const FSlateBrush*>(&RemoveBrush) : static_cast<const FSlateBrush*>(&StaticNone)))
		.Padding(FMargin(2.0f, 0.0f))
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
			[
				SNew(SBox)
				.WidthOverride(28.0f)
				[
					SNew(STextBlock)
					.Text(FText::FromString(Number))
					.Font(WonderlandUi::Mono(8))
					.ColorAndOpacity(WonderlandUi::Faint())
					.Justification(ETextJustify::Right)
				]
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(5.0f, 0.0f, 5.0f, 0.0f)
			[
				SNew(STextBlock)
				.Text(FText::FromString(FString::Chr(Marker == TEXT(' ') ? TEXT(' ') : Marker)))
				.Font(WonderlandUi::Mono(9))
				.ColorAndOpacity(bAdd ? WonderlandUi::Green() : (bRemove ? WonderlandUi::Coral() : WonderlandUi::Faint()))
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
			[
				SAssignNew(OutTyper, SWonderlandTypedText)
				.Text(Code)
				.Font(WonderlandUi::Mono(9))
				.Syntax(true)
			]
		];
}

TSharedRef<SWidget> SWonderlandWorkLog::MakeLineWidget(EWonderlandRoleLineKind Kind, const FString& Text, TSharedPtr<SWonderlandTypedText>& OutTyper)
{
	using namespace WonderlandWorkLogDetail;
	using K = EWonderlandRoleLineKind;
	const FSlateFontInfo MonoFont = WonderlandUi::Mono(9);
	switch (Kind)
	{
	case K::Section:
		return SNew(SBox).Padding(FMargin(0.0f, 3.0f, 0.0f, 0.0f))
			[
				SNew(STextBlock).Text(FText::FromString(Text)).Font(WonderlandUi::Sans(8, true, 110)).ColorAndOpacity(WonderlandUi::Gold(0.85f))
			];
	case K::Command:
		return Plain(TEXT("$ ") + Text, WonderlandUi::Sky(), MonoFont);
	case K::File:
	case K::CodeFile:
		return SNew(SBox).Padding(FMargin(0.0f, 3.0f, 0.0f, 1.0f))
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 6.0f, 0.0f)
				[
					SNew(STextBlock).Text(INVTEXT("FILE")).Font(WonderlandUi::Sans(7, true, 120)).ColorAndOpacity(WonderlandUi::Dim())
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(FText::FromString(Text)).Font(MonoFont).ColorAndOpacity(WonderlandUi::Ivory()).AutoWrapText(true)
				]
			];
	case K::CodeLine:
	{
		FString Number;
		TCHAR Marker = TEXT(' ');
		FString Code;
		SplitCodeLine(Text, Number, Marker, Code);
		return MakeCodeRow(Number, Marker, Code, OutTyper);
	}
	case K::DiffAdd:
		return MakeCodeRow(FString(), TEXT('+'), Text, OutTyper);
	case K::DiffRemove:
		return MakeCodeRow(FString(), TEXT('-'), Text, OutTyper);
	case K::DiffStat:
		return Plain(Text, WonderlandUi::Green(0.9f), MonoFont, 38.0f);
	case K::Preview:
	case K::PromptLine:
		return SNew(SBox).Padding(FMargin(4.0f, 0.0f, 0.0f, 0.0f))
			[
				SAssignNew(OutTyper, SWonderlandTypedText).Text(Text).Font(MonoFont).Syntax(false).Color(WonderlandUi::Cream())
			];
	case K::PromptHeading:
		return SNew(SBox).Padding(FMargin(4.0f, 3.0f, 0.0f, 0.0f))
			[
				SNew(STextBlock).Text(FText::FromString(Text)).Font(WonderlandUi::Sans(8, true, 60)).ColorAndOpacity(WonderlandUi::Gold())
			];
	case K::PreviewRule:
		return SNew(SBox).HeightOverride(4.0f);
	case K::Pass:
		return Plain(TEXT("PASS  ") + Text, WonderlandUi::Green(), MonoFont);
	case K::Fail:
		return Plain(TEXT("FAIL  ") + Text, WonderlandUi::Coral(), MonoFont);
	case K::CheckDone:
		return Plain(TEXT("✓ ") + Text, WonderlandUi::Sage(), MonoFont);
	case K::CheckOpen:
		return Plain(TEXT("○ ") + Text, WonderlandUi::Dim(), MonoFont);
	case K::Finding:
		return Plain(TEXT("! ") + Text, WonderlandUi::Coral(), MonoFont);
	case K::FindingCard:
	{
		TArray<FString> Parts;
		Text.ParseIntoArray(Parts, TEXT("|"), false);
		const FString Id = Parts.IsValidIndex(0) ? Parts[0] : FString();
		const FString Severity = Parts.IsValidIndex(1) ? Parts[1] : FString();
		const FString Message = Parts.IsValidIndex(2) ? Parts[2] : FString();
		const FString Where = Parts.IsValidIndex(3) ? Parts[3] : FString();
		return SNew(SBox).Padding(FMargin(0.0f, 3.0f, 0.0f, 3.0f))
			[
				SNew(SBorder)
				.BorderImage(&FindingBrush)
				.Padding(FMargin(8.0f, 5.0f))
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(STextBlock)
						.Text(FText::FromString(FString::Printf(TEXT("FINDING %s   ·   SEVERITY · %s"), *Id, *Severity)))
						.Font(WonderlandUi::Sans(8, true, 90))
						.ColorAndOpacity(WonderlandUi::Coral())
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f, 0.0f, 0.0f)
					[
						Plain(Message, WonderlandUi::Cream(), MonoFont)
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f, 0.0f, 0.0f)
					[
						Plain(TEXT("FILE  ") + Where, WonderlandUi::Dim(), WonderlandUi::Mono(8))
					]
				]
			];
	}
	case K::State:
		return Plain(Text, WonderlandUi::Gold(), MonoFont);
	case K::Wait:
		return Plain(TEXT("… ") + Text, WonderlandUi::Dim(), MonoFont);
	case K::Blank:
		return SNew(SBox).HeightOverride(5.0f);
	default:
		break;
	}
	// Log, and anything this build draws as a plain operational line.
	return Plain(TEXT("> ") + Text, WonderlandUi::Cream(), MonoFont);
}

int32 SWonderlandWorkLog::AddLine(EWonderlandRoleLineKind Kind, const FString& Text)
{
	using K = EWonderlandRoleLineKind;
	if (!Root.IsValid())
	{
		return INDEX_NONE;
	}
	// Lines that direct the log rather than being drawn.
	if (Kind == K::Episode)
	{
		BeginEpisode(Text);
		return INDEX_NONE;
	}
	if (Kind == K::Summary)
	{
		SetEpisodeSummary(Text);
		return INDEX_NONE;
	}
	if (Kind == K::Status || Kind == K::Pause)
	{
		return INDEX_NONE;
	}
	EnsureEpisode();
	FEpisode& Episode = *Episodes.Last();

	if (Kind == K::PromptBegin)
	{
		// AN OUTBOUND PROMPT, IN A BOX OF ITS OWN, with who it is for.
		TSharedPtr<SVerticalBox> Inner;
		Episode.Body->AddSlot().AutoHeight().Padding(0.0f, 3.0f, 0.0f, 3.0f)
		[
			SNew(SBorder)
			.BorderImage(&PromptBrush)
			.Padding(FMargin(8.0f, 5.0f))
			[
				SAssignNew(Inner, SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
					[
						SNew(STextBlock).Text(INVTEXT("OUTBOUND PROMPT PREVIEW")).Font(WonderlandUi::Sans(8, true, 110)).ColorAndOpacity(WonderlandUi::Gold())
					]
					+ SHorizontalBox::Slot().FillWidth(1.0f)
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
					[
						SNew(STextBlock).Text(FText::FromString(TEXT("TARGET · ") + Text)).Font(WonderlandUi::Sans(8, true, 90)).ColorAndOpacity(WonderlandUi::Cream())
					]
				]
			]
		];
		OpenPrompt = Inner;
		Newest = Inner;
		NewestText = TEXT("PROMPT → ") + Text;
		Written.Add(NewestText);
		++LineCount;
		++ChangeSerial;
		return INDEX_NONE;
	}
	if (Kind == K::PromptEnd)
	{
		OpenPrompt.Reset();
		return INDEX_NONE;
	}

	if (Kind == K::CodeFile || Kind == K::File)
	{
		Episode.File = FPaths::GetCleanFilename(Text);
	}
	if (Kind == K::CodeLine || Kind == K::DiffAdd || Kind == K::DiffRemove)
	{
		FString Number;
		TCHAR Marker = TEXT(' ');
		FString Code;
		WonderlandWorkLogDetail::SplitCodeLine(Text, Number, Marker, Code);
		if (Kind == K::DiffAdd) Marker = TEXT('+');
		if (Kind == K::DiffRemove) Marker = TEXT('-');
		Episode.Added += Marker == TEXT('+') ? 1 : 0;
		Episode.Removed += Marker == TEXT('-') ? 1 : 0;
	}

	TSharedPtr<SWonderlandTypedText> Typer;
	const TSharedRef<SWidget> Line = MakeLineWidget(Kind, Text, Typer);
	const bool bInPrompt = OpenPrompt.IsValid() && (Kind == K::PromptLine || Kind == K::PromptHeading || Kind == K::Preview || Kind == K::PreviewRule);
	(bInPrompt ? OpenPrompt : Episode.Body)->AddSlot().AutoHeight()
	[
		Line
	];
	Newest = Line;
	NewestText = Text;
	Written.Add(Text);
	++LineCount;
	++ChangeSerial;
	if (!Typer.IsValid())
	{
		return INDEX_NONE;
	}
	Typer->SetReveal(0);
	return Typers.Add(Typer);
}

void SWonderlandWorkLog::SetReveal(int32 LineId, int32 Chars)
{
	if (Typers.IsValidIndex(LineId) && Typers[LineId].IsValid())
	{
		Typers[LineId]->SetReveal(Chars);
		++ChangeSerial;
	}
}

int32 SWonderlandWorkLog::GetLineLength(int32 LineId) const
{
	return Typers.IsValidIndex(LineId) && Typers[LineId].IsValid() ? Typers[LineId]->GetLength() : 0;
}

FString SWonderlandWorkLog::DescribeLines(int32 MaxLines) const
{
	const int32 First = FMath::Max(0, Written.Num() - FMath::Max(MaxLines, 1));
	TArray<FString> Last;
	for (int32 Index = First; Index < Written.Num(); ++Index)
	{
		Last.Add(Written[Index]);
	}
	return FString::Join(Last, TEXT("\n"));
}
