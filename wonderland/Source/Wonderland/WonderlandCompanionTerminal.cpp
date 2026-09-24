#include "WonderlandCompanionTerminal.h"
#include "Rendering/DrawElements.h"

#include "Framework/Application/SlateApplication.h"
#include "HAL/IConsoleManager.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Images/SImage.h"
#include "Styling/SlateBrush.h"
#include "Brushes/SlateDynamicImageBrush.h"
#include "HAL/FileManager.h"
#include "Misc/Paths.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandPixelText.h"
#include "WonderlandUiStyle.h"

namespace
{
	// Named for this file alone: the module is one unity translation unit (see WonderlandCompanionHud.cpp).
	TAutoConsoleVariable<float> CVarCompanionTerminalTitleCell(
		TEXT("wl.Companion.TitleCell"), 3.4f,
		TEXT("Slate units per cell of the companion terminal titles' pixel type."));

	// The frame's gold is warmer and brighter than the Julius window's hairline: in the founder's frame these panels
	// sit at the screen's edge over bright stone and carry a heavy amber border.
	FLinearColor CompanionFrameGold(float Alpha = 1.0f) { return WonderlandUi::Srgb(0xE3, 0xA5, 0x3E, Alpha); }
	FLinearColor CompanionTitleGold() { return WonderlandUi::Srgb(0xF4, 0xAA, 0x3E); }
}

void SWonderlandPulseMark::Construct(const FArguments& InArgs)
{
	Size = InArgs._Size;
	Beating = InArgs._Beating;
	SetVisibility(EVisibility::HitTestInvisible);
}

float SWonderlandPulseMark::GetEnvelope() const
{
	if (!Beating.Get(false))
	{
		return 0.0f;
	}
	// A HEARTBEAT, NOT A SINE: a sharp rise to the first beat, a slower fall, a smaller second beat, then rest.
	// 1.15 s per cycle, which is a resting pulse and reads as alive rather than busy.
	const double T = FMath::Fmod(FSlateApplication::Get().GetCurrentTime(), 1.15);
	auto Beat = [](double Local, double Rise, double Fall, double Peak)
	{
		if (Local < 0.0) return 0.0;
		if (Local < Rise) return Peak * FMath::Sin((Local / Rise) * HALF_PI);
		if (Local < Rise + Fall) return Peak * FMath::Cos(((Local - Rise) / Fall) * HALF_PI);
		return 0.0;
	};
	return static_cast<float>(FMath::Max(Beat(T, 0.12, 0.30, 1.0), Beat(T - 0.36, 0.10, 0.28, 0.55)));
}

int32 SWonderlandPulseMark::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	const float Env = GetEnvelope();
	const bool bAlive = Beating.Get(false);
	// The mark grows with the beat and brightens with it; still, it sits small and dim so a resting terminal is quiet.
	const float Scale = (bAlive ? 0.86f : 0.72f) + 0.18f * Env;
	const float Bright = (bAlive ? 0.55f : 0.28f) + 0.45f * Env;
	const FVector2D Local = AllottedGeometry.GetLocalSize();
	const FVector2D Centre = Local * 0.5;
	const float Radius = FMath::Min(Local.X, Local.Y) * 0.5f * Scale;

	// THREE NESTED ARCS, open at the lower right, green outside, blue in the middle, white at the heart -- the
	// HUD's own i.Wonder mark. Each is a polyline so it scales without a texture.
	struct FArc { FLinearColor Colour; float R; float From; float To; float Thick; };
	const FArc Arcs[] = {
		{ FLinearColor(0.20f, 0.82f, 0.60f), 1.00f, 300.0f, 30.0f, 3.2f },
		{ FLinearColor(0.32f, 0.56f, 1.00f), 0.68f, 290.0f, 40.0f, 2.6f },
		{ FLinearColor(0.98f, 0.98f, 1.00f), 0.38f, 280.0f, 55.0f, 2.0f },
	};
	int32 Layer = LayerId;
	for (const FArc& Arc : Arcs)
	{
		TArray<FVector2D> Points;
		const float Span = 360.0f - Arc.From + Arc.To;
		const int32 Steps = 28;
		for (int32 S = 0; S <= Steps; ++S)
		{
			const float Deg = Arc.From + Span * (static_cast<float>(S) / Steps);
			const float Rad = FMath::DegreesToRadians(Deg);
			Points.Add(Centre + FVector2D(FMath::Cos(Rad), FMath::Sin(Rad)) * Radius * Arc.R);
		}
		FLinearColor Colour = Arc.Colour * Bright;
		Colour.A = 0.55f + 0.45f * Bright;
		FSlateDrawElement::MakeLines(OutDrawElements, ++Layer, AllottedGeometry.ToPaintGeometry(), Points,
			ESlateDrawEffect::None, Colour, true, Arc.Thick * (0.85f + 0.3f * Env));
	}
	return Layer;
}

SWonderlandCompanionTerminal::SWonderlandCompanionTerminal()
	: FrameBrush(WonderlandUi::Srgb(4, 4, 6, 0.93f), 8.0f, CompanionFrameGold(), 2.5f)
	, RuleBrush(CompanionFrameGold(0.9f), 0.0f)
{
}

void SWonderlandCompanionTerminal::Construct(const FArguments& InArgs)
{
	// THE CANONICAL i.WONDER LOGO, not a drawn stand-in. The founder asked for the real mark; the world lane had
	// already imported it to Content/UI/iWonderActivity.png. It goes in the slot the pulse mark already owns --
	// its own row, bottom-left, above the command line -- so the placement rule is unchanged and only the artwork
	// improves. If the file is ever missing the drawn mark still renders, so the terminal cannot lose its pulse.
	const FString LogoPath = FPaths::ProjectContentDir() / TEXT("UI/iWonderActivity.png");
	if (IFileManager::Get().FileExists(*LogoPath))
	{
		LogoBrush = MakeShared<FSlateDynamicImageBrush>(FName(*LogoPath), FVector2D(24.0f, 24.0f));
	}
	Title = InArgs._Title;
	Accent = InArgs._Accent;
	OnSubmit = InArgs._OnSubmit;
	OnRequestClose = InArgs._OnRequestClose;

	FSlateBrush NoBackground;
	NoBackground.DrawAs = ESlateBrushDrawType::NoDrawType;
	InputStyle = FCoreStyle::Get().GetWidgetStyle<FEditableTextBoxStyle>("NormalEditableTextBox");
	InputStyle.SetBackgroundImageNormal(NoBackground)
		.SetBackgroundImageHovered(NoBackground)
		.SetBackgroundImageFocused(NoBackground)
		.SetFont(WonderlandUi::Mono(11))
		.SetForegroundColor(FSlateColor(WonderlandUi::Cream()))
		.SetFocusedForegroundColor(FSlateColor(WonderlandUi::Cream()))
		.SetPadding(FMargin(2.0f, 3.0f));

	SAssignNew(Log, SVerticalBox);
	RebuildLog();

	const TAttribute<float> TitleCell = TAttribute<float>::CreateLambda([]() { return CVarCompanionTerminalTitleCell.GetValueOnGameThread(); });
	FSlateFontInfo IntroFont = WonderlandUi::Mono(12);
	IntroFont.LetterSpacing = 90;
	const FSlateFontInfo RowFont = WonderlandUi::Mono(11);

	ChildSlot
	[
		SNew(SBorder)
		.BorderImage(&FrameBrush)
		.Padding(FMargin(2.5f))
		[
			SNew(SVerticalBox)
			// THE TITLE: the chevron and the name in gold pixel type, WAITING at the right.
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(16.0f, 14.0f, 14.0f, 0.0f)
			[
				// CLIPPED, so a long name can never draw over the state at the right. A companion called "Claude Code
				// Fable 5" is wider than one called "Astra", and the state is the part that must stay readable.
				SNew(SHorizontalBox)
				.Clipping(EWidgetClipping::ClipToBounds)
				+ SHorizontalBox::Slot()
				.AutoWidth()
				.VAlign(VAlign_Center)
				.Padding(0.0f, 0.0f, 12.0f, 0.0f)
				[
					SNew(SWonderlandPixelText)
					.Text(TEXT(">"))
					.CellSize(TitleCell)
					.Color(CompanionTitleGold())
				]
				+ SHorizontalBox::Slot()
				.FillWidth(1.0f)
				.HAlign(HAlign_Left)
				.VAlign(VAlign_Center)
				[
					SNew(SWonderlandPixelText)
					.Text(Title.ToUpper())
					.CellSize(TitleCell)
					.Color(CompanionTitleGold())
				]
				+ SHorizontalBox::Slot()
				.AutoWidth()
				.VAlign(VAlign_Top)
				.Padding(10.0f, 1.0f, 0.0f, 0.0f)
				[
					SNew(STextBlock)
					// STREAMING while words are arriving; otherwise the runtime's own state, never a made-up one.
					.Text_Lambda([this]() { return FText::FromString(GetShownStatus()); })
					.Font(WonderlandUi::Mono(10))
					// Waiting in the frame's gold; working in the companion's own colour, so it is plain which is live.
					.ColorAndOpacity_Lambda([this]() { return FSlateColor(Status == TEXT("WAITING") ? CompanionFrameGold() : Accent); })
				]
			]
			// THE COMPANION'S LINE, in wide cream capitals -- while it waits. Taking part, the space goes to its work.
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(16.0f, 13.0f, 14.0f, 0.0f)
			[
				SNew(STextBlock)
				.Visibility_Lambda([this]() { return Status == TEXT("WAITING") ? EVisibility::HitTestInvisible : EVisibility::Collapsed; })
				.Text(FText::FromString(InArgs._Intro.ToUpper()))
				.Font(IntroFont)
				.ColorAndOpacity(WonderlandUi::Cream())
				.LineHeightPercentage(1.2f)
			]
			// A JOINED COMPANION HERE IS A SIMULATION, and says so first.
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(16.0f, 9.0f, 14.0f, 0.0f)
			[
				SNew(STextBlock)
				.Visibility_Lambda([this]() { return Status == TEXT("WAITING") ? EVisibility::Collapsed : EVisibility::HitTestInvisible; })
				.Text(FText::FromString(TEXT("DEVELOPMENT PREVIEW · SIMULATED /JOIN IN")))
				.Font(WonderlandUi::Sans(8, true, 140))
				.ColorAndOpacity(WonderlandUi::Coral())
			]
			// THE LOG: open until a line is recorded.
			+ SVerticalBox::Slot()
			.FillHeight(1.0f)
			.Padding(16.0f, 8.0f, 14.0f, 6.0f)
			[
				Log.ToSharedRef()
			]
			// THE RULE, edge to edge inside the frame.
			+ SVerticalBox::Slot()
			.AutoHeight()
			[
				SNew(SBox)
				.HeightOverride(1.5f)
				[
					SNew(SBorder)
					.BorderImage(&RuleBrush)
					.Padding(0.0f)
				]
			]
			// THE i.WONDER PULSE, ON ITS OWN ROW ABOVE THE INPUT, anchored bottom-left.
			//
			// IT USED TO LIVE INSIDE THE COMMAND LINE, in the same horizontal box as the chevron and the editable
			// text -- so it read as part of the input control, and the companion's words looked like they were
			// coming out of the box the founder types into. They are not: they come from the companion. The mark
			// belongs between the transcript and the input, with the answer building upward above it.
			//
			// ITS OWN SLOT IS ALSO WHAT KEEPS IT OUT. A row of its own cannot be pushed back inside the text
			// field when the terminal is resized, which an AutoWidth slot sharing a box with a FillWidth text
			// control eventually would be.
			+ SVerticalBox::Slot()
			.AutoHeight()
			.HAlign(HAlign_Left)
			.Padding(12.0f, 2.0f, 0.0f, 3.0f)
			[
				SNew(SOverlay)
				+ SOverlay::Slot()
				[
					SAssignNew(Pulse, SWonderlandPulseMark)
					.Size(24.0f)
					.Beating_Lambda([this]() { return IsPulsing(); })
					.Visibility(LogoBrush.IsValid() ? EVisibility::Collapsed : EVisibility::HitTestInvisible)
				]
				+ SOverlay::Slot()
				[
					SNew(SBox).WidthOverride(24.0f).HeightOverride(24.0f)
					.Visibility(LogoBrush.IsValid() ? EVisibility::HitTestInvisible : EVisibility::Collapsed)
					[
						SAssignNew(LogoImage, SImage).Image(LogoBrush.Get())
						// IT PULSES ON THE SAME HEARTBEAT as the drawn mark it replaces -- the same 1.15 s
						// envelope, so swapping the artwork did not quietly swap the behaviour the founder
						// asked for. It rests at a readable opacity and lifts on the beat rather than
						// blinking, which is what "gently pulse" means.
						.ColorAndOpacity_Lambda([this]()
						{
							const float Beat = Pulse.IsValid() ? Pulse->GetEnvelope() : 0.0f;
							return FSlateColor(FLinearColor(1.0f, 1.0f, 1.0f, 0.62f + 0.38f * Beat));
						})
					]
				]
			]
			// THE COMMAND LINE: chevron and input, then Send and its chord ruled off at the right.
			+ SVerticalBox::Slot()
			.AutoHeight()
			[
				SNew(SBox)
				.HeightOverride(38.0f)
				[
					SNew(SHorizontalBox)
					// the chevron leads the row now that the mark has moved out, so it takes the mark's left margin
					+ SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					.Padding(14.0f, 0.0f, 6.0f, 0.0f)
					[
						SNew(STextBlock)
						.Text(INVTEXT(">"))
						.Font(WonderlandUi::Mono(12))
						.ColorAndOpacity(WonderlandUi::Cream())
					]
					+ SHorizontalBox::Slot()
					.FillWidth(1.0f)
					.VAlign(VAlign_Center)
					.Padding(0.0f, 0.0f, 8.0f, 0.0f)
					[
						SAssignNew(Input, SEditableTextBox)
						.Style(&InputStyle)
						.ClearKeyboardFocusOnCommit(false)
						.RevertTextOnEscape(false)
						.SelectAllTextWhenFocused(false)
						.OnKeyDownHandler(this, &SWonderlandCompanionTerminal::HandleInputKeyDown)
					]
					+ SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Fill)
					[
						SNew(SBox)
						.WidthOverride(1.5f)
						[
							SNew(SBorder)
							.BorderImage(&RuleBrush)
							.Padding(0.0f)
						]
					]
					+ SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					.Padding(16.0f, 0.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock)
						.Text(INVTEXT("Send"))
						.Font(RowFont)
						.ColorAndOpacity(WonderlandUi::Cream())
					]
					+ SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					.Padding(14.0f, 0.0f, 16.0f, 0.0f)
					[
						SNew(STextBlock)
						.Text(INVTEXT("Ctrl+Enter"))
						.Font(RowFont)
						.ColorAndOpacity(WonderlandUi::Cream())
					]
				]
			]
		]
	];
}

void SWonderlandCompanionTerminal::RebuildLog()
{
	if (!Log.IsValid())
	{
		return;
	}
	Log->ClearChildren();
	// Two lines under the intro while waiting; four while taking part, where the intro gives up its space.
	const int32 Shown = Status == TEXT("WAITING") ? 2 : 4;
	for (int32 Index = FMath::Max(0, Lines.Num() - Shown); Index < Lines.Num(); ++Index)
	{
		const FLine& Line = Lines[Index];
		Log->AddSlot()
		.AutoHeight()
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot()
			.AutoWidth()
			.VAlign(VAlign_Center)
			.Padding(0.0f, 0.0f, Line.Speaker.IsEmpty() ? 0.0f : 6.0f, 0.0f)
			[
				SNew(STextBlock)
				.Text(FText::FromString(Line.Speaker.IsEmpty() ? FString() : Line.Speaker + TEXT(":")))
				.Font(WonderlandUi::Mono(10))
				.ColorAndOpacity(Accent)
			]
			+ SHorizontalBox::Slot()
			.FillWidth(1.0f)
			.VAlign(VAlign_Center)
			[
				SNew(STextBlock)
				.Text(FText::FromString(Line.Text))
				.Font(WonderlandUi::Mono(10))
				.ColorAndOpacity(Line.bDim ? WonderlandUi::Dim() : WonderlandUi::Cream())
				.OverflowPolicy(ETextOverflowPolicy::Ellipsis)
			]
		];
	}
}

void SWonderlandCompanionTerminal::AddLine(const FString& Speaker, const FString& Text, bool bDim)
{
	if (Speaker.IsEmpty() || bDim)
	{
		// A NOTE IS THE RUNTIME TALKING ABOUT THE COMPANION, not the companion talking. It lands whole.
		Lines.Add({Speaker, Text, bDim});
		RebuildLog();
		return;
	}
	const double Now = FSlateApplication::IsInitialized() ? FSlateApplication::Get().GetCurrentTime() : 0.0;
	if (IsStreaming())
	{
		// One voice at a time: a second line waits for the first to finish arriving.
		Reveal.Queue.Add(TPair<FString, FString>(Speaker, Text));
		return;
	}
	StartReveal(Speaker, Text, Now);
}

void SWonderlandCompanionTerminal::StartReveal(const FString& Speaker, const FString& Text, double Now)
{
	Text.ParseIntoArray(Reveal.Pending, TEXT(" "), true);
	Reveal.Revealed = 0;
	Reveal.LineIndex = Lines.Add({Speaker, FString(), false});
	Reveal.NextWordAt = Now;
	RebuildLog();
}

void SWonderlandCompanionTerminal::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	SCompoundWidget::Tick(AllottedGeometry, InCurrentTime, InDeltaTime);
	if (!IsStreaming())
	{
		if (Reveal.Queue.Num() > 0)
		{
			// THE NEXT LINE WAITS A BEAT, so the mark shows between two lines: think, speak, think, speak.
			if (Reveal.NextWordAt <= 0.0) { Reveal.NextWordAt = InCurrentTime + 0.75; }
			if (InCurrentTime >= Reveal.NextWordAt)
			{
				const TPair<FString, FString> Next = Reveal.Queue[0];
				Reveal.Queue.RemoveAt(0);
				StartReveal(Next.Key, Next.Value, InCurrentTime);
			}
		}
		return;
	}
	if (InCurrentTime < Reveal.NextWordAt || !Lines.IsValidIndex(Reveal.LineIndex))
	{
		return;
	}
	// WORDS, NOT CHARACTERS. A character-at-a-time reveal reads as a typewriter; words arriving in small bursts
	// with the odd longer gap is what a response arriving from somewhere actually looks like.
	const FString& Word = Reveal.Pending[Reveal.Revealed];
	FString& Text = Lines[Reveal.LineIndex].Text;
	Text += (Text.IsEmpty() ? TEXT("") : TEXT(" ")) + Word;
	++Reveal.Revealed;
	if (Reveal.Revealed >= Reveal.Pending.Num())
	{
		Reveal.Pending.Reset();
		Reveal.Revealed = 0;
		Reveal.NextWordAt = 0.0;
	}
	else
	{
		// Cadence: 55-95 ms a word, a pause of a few hundred at punctuation, as speech has.
		const bool bPause = Word.EndsWith(TEXT(".")) || Word.EndsWith(TEXT(",")) || Word.EndsWith(TEXT(":")) || Word.EndsWith(TEXT(";"));
		Reveal.NextWordAt = InCurrentTime + (bPause ? 0.34 : 0.055 + 0.04 * FMath::Frac(InCurrentTime * 7.31));
	}
	RebuildLog();
}

bool SWonderlandCompanionTerminal::IsPulsing() const
{
	if (IsStreaming())
	{
		return false;
	}
	// THE RUNTIME'S OWN WORKING STATES, and only those. WAITING, OFFLINE and COMPLETE do not beat.
	static const TCHAR* const Working[] = {
		TEXT("WORKING"), TEXT("ANALYSING"), TEXT("SEARCHING"), TEXT("THINKING"), TEXT("RUNNING"),
		TEXT("RESEARCHING"), TEXT("REVIEWING"), TEXT("VERIFYING"), TEXT("ACTIVE"), TEXT("ACTIVE \u00B7 JOINED"),
		TEXT("PREPARING"), TEXT("IMPLEMENTING"), TEXT("PLANNING") };
	for (const TCHAR* State : Working)
	{
		if (Status.StartsWith(State)) { return true; }
	}
	return Reveal.Queue.Num() > 0;
}

FString SWonderlandCompanionTerminal::GetShownStatus() const
{
	return IsStreaming() ? TEXT("STREAMING") : Status;
}

void SWonderlandCompanionTerminal::SetStatus(const FString& InStatus)
{
	if (Status != InStatus)
	{
		Status = InStatus;
		// How many lines show depends on the state, so the log is redrawn with it.
		RebuildLog();
	}
}

void SWonderlandCompanionTerminal::ClearLines()
{
	Lines.Reset();
	LatestActivity.Reset();
	NarratedBeat = NAME_None;
	RebuildLog();
}

TSharedPtr<SWidget> SWonderlandCompanionTerminal::GetFocusTarget() const
{
	return Input;
}

FString SWonderlandCompanionTerminal::GetInputText() const
{
	return Input.IsValid() ? Input->GetText().ToString() : FString();
}

void SWonderlandCompanionTerminal::Submit()
{
	if (!Input.IsValid())
	{
		return;
	}
	const FString Trimmed = Input->GetText().ToString().TrimStartAndEnd();
	if (Trimmed.IsEmpty())
	{
		return;
	}
	Input->SetText(FText::GetEmpty());
	OnSubmit.ExecuteIfBound(Trimmed);
	if (FSlateApplication::IsInitialized())
	{
		FSlateApplication::Get().SetKeyboardFocus(Input, EFocusCause::SetDirectly);
	}
}

FReply SWonderlandCompanionTerminal::HandleInputKeyDown(const FGeometry& Geometry, const FKeyEvent& KeyEvent)
{
	const FKey Key = KeyEvent.GetKey();
	// Enter sends, and so does the Ctrl+Enter the panel advertises. Handled here, first, so the text box never
	// also commits the same line.
	if (Key == EKeys::Enter)
	{
		Submit();
		return FReply::Handled();
	}
	// The Live Terminal's close chords, so a companion line being typed never traps the keyboard.
	if (Key == EKeys::Escape || (Key == EKeys::T && KeyEvent.IsControlDown()))
	{
		OnRequestClose.ExecuteIfBound();
		return FReply::Handled();
	}
	return FReply::Unhandled();
}
