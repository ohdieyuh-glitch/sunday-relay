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

	/**
	 * THE TERMINAL'S LETTERING -- the founder's Terminal SECONDARY. FOUNDER, 2026-09-28 (correction pass):
	 * "SECONDARY must control the terminal's intended LETTER/TEXT color ... Do not merely recolor background,
	 * border, glow, panel, decoration while leaving the letters unchanged."
	 *
	 * These rows are what the four sections actually draw. The previous hook coloured SWonderlandLiveTerminal's
	 * JuliusBody, a widget that is built and never placed in the window, so the Live Terminal's letters could not
	 * respond at all. Bound at paint time rather than baked, because rows are written once and stay on screen.
	 * Status colours (pass, fail, findings), syntax colours and the accent-coloured structure keep their own.
	 */
	TAttribute<FSlateColor> Words()
	{
		return TAttribute<FSlateColor>::CreateLambda([]() { return FSlateColor(WonderlandUi::JuliusText()); });
	}

	/** The same lettering at the dimmed level the resting lines and sub-lines have always had. */
	TAttribute<FSlateColor> WordsDim()
	{
		return TAttribute<FSlateColor>::CreateLambda([]() { return FSlateColor(WonderlandUi::JuliusTextDim()); });
	}

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

}

/* ------------------------------------------------------------ typed text */

void SWonderlandTypedText::Construct(const FArguments& InArgs)
{
	Text = InArgs._Text;
	Font = InArgs._Font;
	Reveal = -1;
	bFollowText = InArgs._FollowText;
	Tokenize(InArgs._Syntax, InArgs._Color);
}

void SWonderlandTypedText::Tokenize(bool bSyntax, const FLinearColor& Plain)
{
	using namespace WonderlandWorkLogDetail;
	Tokens.Reset();
	if (!bSyntax)
	{
		Tokens.Add({ 0, Text.Len(), Plain, true });
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
				Token.bPlain = true;
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
			Token.bPlain = true;
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
			// plain letters follow the terminal's Secondary as it is NOW; syntax colours keep their own
			const FLinearColor Colour = (bFollowText && Token.bPlain) ? WonderlandUi::JuliusText() : Token.Color;
			FSlateDrawElement::MakeText(OutDrawElements, LayerId,
				AllottedGeometry.ToPaintGeometry(FVector2f(Width + 2.0f, Height), FSlateLayoutTransform(FVector2f(X, 0.0f))),
				Part, Font, ESlateDrawEffect::None, Colour);
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

/* ------------------------------------------------------------ the rolling log */

SWonderlandWorkLog::SWonderlandWorkLog()
	: AddBrush(WonderlandUi::Srgb(0x6F, 0xBF, 0x73, 0.13f), 2.0f)
	, RemoveBrush(WonderlandUi::Srgb(0xE2, 0x5B, 0x45, 0.14f), 2.0f)
{
}

void SWonderlandWorkLog::Construct(const FArguments& InArgs)
{
	RestingText = InArgs._RestingText;
	// THE BODY EASES TO ITS HEIGHT, and shows the newest rows at its foot while it grows or shrinks.
	ChildSlot
	[
		SNew(SBox)
		.HeightOverride_Lambda([this]() { return FOptionalSize(ShownHeight); })
		.VAlign(VAlign_Bottom)
		.Clipping(EWidgetClipping::ClipToBounds)
		[
			SAssignNew(Root, SVerticalBox)
		]
	];
	Reset();
}

float SWonderlandWorkLog::GetTargetHeight() const
{
	return static_cast<float>(FMath::Min(GetRowCount(), VisibleRows)) * RowHeight;
}

void SWonderlandWorkLog::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	SCompoundWidget::Tick(AllottedGeometry, InCurrentTime, InDeltaTime);
	const float Target = GetTargetHeight();
	const float Alpha = 1.0f - FMath::Exp(-FMath::Clamp(InDeltaTime, 0.0f, 0.2f) * 7.0f);
	ShownHeight = FMath::Abs(Target - ShownHeight) < 0.3f ? Target : FMath::Lerp(ShownHeight, Target, Alpha);
}

void SWonderlandWorkLog::Reset()
{
	RowSeqs.Reset();
	RowSlots.Reset();
	VisibleFromSeq = 0;
	JuliusDetailSeq = INDEX_NONE;
	Typers.Reset();
	Written.Reset();
	NewestText.Reset();
	LineCount = 0;
	if (Root.IsValid())
	{
		Root->ClearChildren();
		Root->AddSlot().AutoHeight()
		[
			TextRow(RestingText, WonderlandWorkLogDetail::WordsDim())
		];
	}
}

TSharedRef<SWidget> SWonderlandWorkLog::TextRow(const FString& Text, const TAttribute<FSlateColor>& Color, bool bBold, float Indent)
{
	return SNew(SBox)
		.HeightOverride(RowHeight)
		.VAlign(VAlign_Center)
		.Padding(FMargin(Indent, 0.0f, 0.0f, 0.0f))
		[
			SNew(STextBlock)
			.Text(FText::FromString(Text))
			.Font(bBold ? WonderlandUi::Sans(8, true, 80) : WonderlandUi::Mono(9))
			.ColorAndOpacity(Color)
			.OverflowPolicy(ETextOverflowPolicy::Ellipsis)
		];
}

TSharedRef<SWidget> SWonderlandWorkLog::CodeRow(const FString& Number, TCHAR Marker, const FString& Code, TSharedPtr<SWonderlandTypedText>& OutTyper)
{
	const bool bAdd = Marker == TEXT('+');
	const bool bRemove = Marker == TEXT('-');
	static FSlateNoResource NoTint;
	return SNew(SBox)
		.HeightOverride(RowHeight)
		[
			SNew(SBorder)
			.BorderImage(bAdd ? static_cast<const FSlateBrush*>(&AddBrush) : (bRemove ? static_cast<const FSlateBrush*>(&RemoveBrush) : static_cast<const FSlateBrush*>(&NoTint)))
			.Padding(FMargin(0.0f))
			.VAlign(VAlign_Center)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					SNew(SBox)
					.WidthOverride(26.0f)
					[
						SNew(STextBlock)
						.Text(FText::FromString(Number))
						.Font(WonderlandUi::Mono(8))
						.ColorAndOpacity(WonderlandUi::Faint())
						.Justification(ETextJustify::Right)
					]
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(4.0f, 0.0f, 4.0f, 0.0f)
				[
					SNew(STextBlock)
					.Text(FText::FromString(FString::Chr(Marker)))
					.Font(WonderlandUi::Mono(9))
					.ColorAndOpacity(bAdd ? WonderlandUi::Green() : (bRemove ? WonderlandUi::Coral() : WonderlandUi::Faint()))
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SAssignNew(OutTyper, SWonderlandTypedText)
					.Text(Code)
					.Font(WonderlandUi::Mono(9))
					.Syntax(true)
					.FollowText(true)
				]
			]
		];
}

int32 SWonderlandWorkLog::AddRow(TSharedRef<SWidget> Row)
{
	if (!Root.IsValid())
	{
		return INDEX_NONE;
	}
	if (RowSeqs.Num() == 0)
	{
		// The resting line gives way to the first work.
		Root->ClearChildren();
	}
	const int32 Seq = NextSeq++;
	// ONLY THE NEWEST ROWS ARE LAID OUT: older ones collapse, so the body never has to scroll.
	TSharedRef<SWidget> Wrapper = SNew(SBox)
		.Visibility_Lambda([this, Seq]()
		{
			return Seq >= VisibleFromSeq ? EVisibility::Visible : EVisibility::Collapsed;
		})
		[
			Row
		];
	Root->AddSlot().AutoHeight()
	[
		Wrapper
	];
	RowSeqs.Add(Seq);
	RowSlots.Add(Wrapper);
	UpdateVisibleFrom();
	return Seq;
}

void SWonderlandWorkLog::RemoveRow(int32 Seq)
{
	const int32 Index = RowSeqs.IndexOfByKey(Seq);
	if (Index == INDEX_NONE || !Root.IsValid())
	{
		return;
	}
	Root->RemoveSlot(RowSlots[Index]);
	RowSeqs.RemoveAt(Index);
	RowSlots.RemoveAt(Index);
	UpdateVisibleFrom();
}

void SWonderlandWorkLog::UpdateVisibleFrom()
{
	VisibleFromSeq = RowSeqs.Num() > VisibleRows ? RowSeqs[RowSeqs.Num() - VisibleRows] : TNumericLimits<int32>::Min();
}

void SWonderlandWorkLog::AddJuliusRow(const FString& Time, const FString& Role, const FString& Headline, const FString& Detail)
{
	// The sub-line belongs to the newest row only, as it always has.
	if (JuliusDetailSeq != INDEX_NONE)
	{
		RemoveRow(JuliusDetailSeq);
		JuliusDetailSeq = INDEX_NONE;
	}
	++LineCount;
	NewestText = Headline;
	Written.Add(FString::Printf(TEXT("%s: %s"), *Role, *Headline));
	AddRow(SNew(SBox)
		.HeightOverride(RowHeight)
		.VAlign(VAlign_Center)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 5.0f, 0.0f)
			[
				SNew(STextBlock).Text(FText::FromString(TEXT("\u25CF"))).Font(WonderlandUi::Mono(6)).ColorAndOpacity(WonderlandUi::Gold())
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 7.0f, 0.0f)
			[
				SNew(STextBlock).Text(FText::FromString(Time)).Font(WonderlandUi::Mono(9)).ColorAndOpacity(WonderlandUi::Gold())
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 5.0f, 0.0f)
			[
				SNew(STextBlock).Text(FText::FromString(Role + TEXT(":"))).Font(WonderlandUi::Mono(9)).ColorAndOpacity(WonderlandUi::Gold(0.9f))
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
			[
				SNew(STextBlock).Text(FText::FromString(Headline)).Font(WonderlandUi::Mono(9))
				.ColorAndOpacity(WonderlandWorkLogDetail::Words())
				.OverflowPolicy(ETextOverflowPolicy::Ellipsis)
			]
		]);
	if (!Detail.IsEmpty())
	{
		JuliusDetailSeq = AddRow(TextRow(Detail, WonderlandWorkLogDetail::WordsDim(), false, 18.0f));
	}
}

int32 SWonderlandWorkLog::AddLine(EWonderlandRoleLineKind Kind, const FString& Text)
{
	using namespace WonderlandWorkLogDetail;
	using K = EWonderlandRoleLineKind;
	if (!Root.IsValid())
	{
		return INDEX_NONE;
	}
	// Lines that direct the feed rather than being drawn.
	if (Kind == K::Status || Kind == K::Pause || Kind == K::Summary || Kind == K::PromptEnd || Kind == K::PreviewRule || Kind == K::Blank)
	{
		return INDEX_NONE;
	}
	++LineCount;
	NewestText = Text;
	Written.Add(Text);

	TSharedPtr<SWonderlandTypedText> Typer;
	switch (Kind)
	{
	case K::Episode:
	case K::Section:
		AddRow(TextRow(TEXT("[") + Text + TEXT("]"), WonderlandUi::Gold(0.85f), true));
		break;
	case K::Command:
		AddRow(TextRow(TEXT("$ ") + Text, WonderlandUi::Sky()));
		break;
	case K::File:
	case K::CodeFile:
		AddRow(TextRow(TEXT("FILE  ") + Text, WonderlandUi::Ivory()));
		break;
	case K::CodeLine:
	case K::DiffAdd:
	case K::DiffRemove:
	{
		FString Number;
		TCHAR Marker = TEXT(' ');
		FString Code;
		SplitCodeLine(Text, Number, Marker, Code);
		if (Kind == K::DiffAdd) Marker = TEXT('+');
		if (Kind == K::DiffRemove) Marker = TEXT('-');
		AddRow(CodeRow(Number, Marker, Code, Typer));
		break;
	}
	case K::DiffStat:
		AddRow(TextRow(Text, WonderlandUi::Green(0.9f), false, 34.0f));
		break;
	case K::PromptBegin:
		AddRow(TextRow(TEXT("OUTBOUND PROMPT  →  ") + Text, WonderlandUi::Gold(), true));
		break;
	case K::PromptHeading:
		AddRow(TextRow(Text, WonderlandUi::Gold(0.9f), true, 10.0f));
		break;
	case K::Preview:
	case K::PromptLine:
		AddRow(SNew(SBox)
			.HeightOverride(RowHeight)
			.VAlign(VAlign_Center)
			.Padding(FMargin(10.0f, 0.0f, 0.0f, 0.0f))
			[
				SAssignNew(Typer, SWonderlandTypedText).Text(Text).Font(WonderlandUi::Mono(9)).Syntax(false).Color(WonderlandUi::Cream()).FollowText(true)
			]);
		break;
	case K::Pass:
		AddRow(TextRow(TEXT("PASS  ") + Text, WonderlandUi::Green()));
		break;
	case K::Fail:
		AddRow(TextRow(TEXT("FAIL  ") + Text, WonderlandUi::Coral()));
		break;
	case K::CheckDone:
		AddRow(TextRow(TEXT("✓ ") + Text, WonderlandUi::Sage()));
		break;
	case K::CheckOpen:
		AddRow(TextRow(TEXT("○ ") + Text, WordsDim()));
		break;
	case K::Finding:
		AddRow(TextRow(TEXT("! ") + Text, WonderlandUi::Coral()));
		break;
	case K::FindingCard:
	{
		TArray<FString> Parts;
		Text.ParseIntoArray(Parts, TEXT("|"), false);
		AddRow(TextRow(FString::Printf(TEXT("FINDING %s  ·  SEVERITY %s"),
			Parts.IsValidIndex(0) ? *Parts[0] : TEXT(""), Parts.IsValidIndex(1) ? *Parts[1] : TEXT("")), WonderlandUi::Coral(), true));
		AddRow(TextRow(Parts.IsValidIndex(2) ? Parts[2] : FString(), Words(), false, 10.0f));
		AddRow(TextRow(TEXT("FILE  ") + (Parts.IsValidIndex(3) ? Parts[3] : FString()), WordsDim(), false, 10.0f));
		break;
	}
	case K::State:
		AddRow(TextRow(Text, WonderlandUi::Gold()));
		break;
	case K::Wait:
		AddRow(TextRow(TEXT("… ") + Text, WordsDim()));
		break;
	default:
		AddRow(TextRow(TEXT("> ") + Text, Words()));
		break;
	}
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
