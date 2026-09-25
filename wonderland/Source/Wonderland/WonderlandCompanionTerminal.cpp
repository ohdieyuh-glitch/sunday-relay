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
	// THE THEME'S ACCENT, NOT A SECOND GOLD.
	//
	// These were two hard-coded hexes a shade apart from WonderlandUi::Gold(), which meant the founder's theme
	// moved the Julius terminal and every accent on the HUD while the two companion terminals stayed gold --
	// photographed in PIE, exactly that happened. They are shades OF the accent now, so one value moves all
	// three terminals together.
	FLinearColor CompanionFrameGold(float Alpha = 1.0f)
	{
		const FLinearColor A = WonderlandUi::Gold();
		return FLinearColor(FMath::Min(A.R * 1.06f, 1.0f), A.G * 1.01f, A.B * 0.96f, Alpha);
	}
	FLinearColor CompanionTitleGold()
	{
		const FLinearColor A = WonderlandUi::Gold();
		return FLinearColor(FMath::Min(A.R * 1.14f, 1.0f), FMath::Min(A.G * 1.06f, 1.0f), A.B * 0.96f, 1.0f);
	}
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

	// THE i.WONDER MARK ITSELF, IN YELLOW, AND NOTHING ELSE.
	//
	// FOUNDER: "The emblem is the i.Wonder logo. It must be YELLOW. ONLY THE LOGO. Remove: gray outline, black
	// outline, colored background plate, gray plate, black plate, border, decorative frame... I do NOT want
	// yellow logo inside gray shape."
	//
	// Content/UI/iWonderActivity.png cannot give him that: it is a BLACK emblem baked onto a GRAY PLATE, so
	// tinting it yellow tints the plate too. Drawn instead -- a ring, the twin facing curves, and the wave
	// beneath -- in one yellow, on nothing. No plate, no border, no backing. It scales without a texture and
	// there is no background for a frame to be.
	const FLinearColor Gold(1.00f, 0.78f, 0.16f);
	FLinearColor Ink = Gold * (0.62f + 0.38f * Bright);
	Ink.A = 0.72f + 0.28f * Bright;
	const float Thick = FMath::Max(Radius * 0.13f, 1.2f) * (0.9f + 0.2f * Env);
	int32 Layer = LayerId;

	auto Stroke = [&](const TArray<FVector2D>& Points)
	{
		FSlateDrawElement::MakeLines(OutDrawElements, ++Layer, AllottedGeometry.ToPaintGeometry(), Points,
			ESlateDrawEffect::None, Ink, true, Thick);
	};
	auto Arc = [&](float Cx, float Cy, float R, float FromDeg, float ToDeg, int32 Steps)
	{
		TArray<FVector2D> Points;
		for (int32 S = 0; S <= Steps; ++S)
		{
			const float Deg = FMath::Lerp(FromDeg, ToDeg, static_cast<float>(S) / Steps);
			const float Rad = FMath::DegreesToRadians(Deg);
			Points.Add(Centre + FVector2D(Cx + FMath::Cos(Rad) * R, Cy + FMath::Sin(Rad) * R));
		}
		Stroke(Points);
	};

	// the ring
	Arc(0.0f, 0.0f, Radius, 0.0f, 360.0f, 40);
	// the twin curves, facing each other, joined across the middle
	const float Eye = Radius * 0.30f;
	const float Gap = Radius * 0.34f;
	Arc(-Gap, -Radius * 0.12f, Eye, 300.0f, 60.0f, 18);
	Arc(Gap, -Radius * 0.12f, Eye, 120.0f, 240.0f, 18);
	Stroke({Centre + FVector2D(-Gap + Eye * 0.5f, -Radius * 0.12f),
			Centre + FVector2D(Gap - Eye * 0.5f, -Radius * 0.12f)});
	// the wave beneath
	{
		TArray<FVector2D> Wave;
		for (int32 S = 0; S <= 24; ++S)
		{
			const float T = static_cast<float>(S) / 24.0f;
			Wave.Add(Centre + FVector2D(FMath::Lerp(-Radius * 0.62f, Radius * 0.62f, T),
				Radius * 0.40f + FMath::Sin(T * PI * 4.0f) * Radius * 0.10f));
		}
		Stroke(Wave);
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
	Title = InArgs._Title;
	Accent = InArgs._Accent;
	OnSubmit = InArgs._OnSubmit;
	BrushAccent = WonderlandUi::Gold();
	// TWICE A SECOND, not every frame: a theme changes when the founder changes it and never on its own.
	RegisterActiveTimer(0.5f, FWidgetActiveTimerDelegate::CreateSP(this, &SWonderlandCompanionTerminal::FollowTheme));
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
			// THE i.WONDER PULSE, ON ITS OWN ROW, ABOVE THE RULE, anchored bottom-left.
			//
			// FOUNDER, 2026-09-25: "the symbol/logo at the bottom left must be ABOVE the horizontal divider
			// line. Fix the placement cleanly. No overlap." It was below the rule, sitting in the same band as
			// the command line, so the divider read as separating the transcript from a strip that held both
			// the mark and the input. Now the order down the panel is transcript, mark, rule, input -- the
			// mark belongs to the companion's side of the line, and the rule closes it off from what the
			// founder types.
			//
			// IT USED TO LIVE INSIDE THE COMMAND LINE before that, in the same horizontal box as the chevron
			// and the editable text, so it read as part of the input control -- as though the companion's
			// words came out of the box the founder types into. They come from the companion.
			//
			// ITS OWN SLOT IS WHAT KEEPS IT OUT, and is also why there is no overlap to fix: a row of its own
			// cannot be pushed back inside the text field when the terminal is resized, which an AutoWidth
			// slot sharing a box with a FillWidth text control eventually would be.
			+ SVerticalBox::Slot()
			.AutoHeight()
			.HAlign(HAlign_Left)
			.Padding(12.0f, 4.0f, 0.0f, 4.0f)
			[
				SAssignNew(Pulse, SWonderlandPulseMark)
				.Size(24.0f)
				.Beating_Lambda([this]() { return IsPulsing(); })
			]
			// THE RULE, edge to edge inside the frame, BELOW the mark and above the input.
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

EActiveTimerReturnType SWonderlandCompanionTerminal::FollowTheme(double InCurrentTime, float InDeltaTime)
{
	const FLinearColor Now = WonderlandUi::Gold();
	if (!BrushAccent.Equals(Now, 0.002f))
	{
		BrushAccent = Now;
		FrameBrush = FSlateRoundedBoxBrush(WonderlandUi::Srgb(4, 4, 6, 0.93f), 8.0f, CompanionFrameGold(), 2.5f);
		RuleBrush = FSlateRoundedBoxBrush(CompanionFrameGold(0.9f), 0.0f);
		Invalidate(EInvalidateWidgetReason::Paint | EInvalidateWidgetReason::Layout);
	}
	return EActiveTimerReturnType::Continue;
}
