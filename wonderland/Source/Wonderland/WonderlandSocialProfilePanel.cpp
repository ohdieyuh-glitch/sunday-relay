#include "WonderlandSocialProfilePanel.h"

#include "Framework/Application/SlateApplication.h"
#include "Fonts/FontMeasure.h"
#include "Rendering/DrawElements.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Images/SImage.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SScaleBox.h"
#include "Widgets/Layout/SWrapBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandUiStyle.h"

// Named, not anonymous: the module is one unity translation unit.
namespace WonderlandSocialProfileLook
{
	FText T(const FString& S) { return FText::FromString(S); }

	/** NO SKIN-NAME TABLE HERE (founder: skins resolve through the canonical registry, never a hard-coded list). The UI subsystem
	 *  hands the registry's name in (DogSkinName); a skin this build's registry does not know shows its id as it is. */
	FString UnknownSkinLabel(const FString& SkinId)
	{
		return SkinId.IsEmpty() ? FString(TEXT("Relay Dog")) : SkinId.Replace(TEXT("_"), TEXT(" "));
	}

	FString CompanionKindLabel(const FString& Kind)
	{
		if (Kind == TEXT("LLM_COMPANION")) return TEXT("LLM COMPANION");
		if (Kind == TEXT("JHINN_AGENT")) return TEXT("JHINN AI AGENT");
		if (Kind == TEXT("SUB_AGENT_CUB")) return TEXT("SUB-AGENT CUB");
		return TEXT("AI COMPANION");
	}

	FLinearColor StateColour(const FString& OnlineState)
	{
		if (OnlineState == TEXT("ONLINE")) return WonderlandUi::Green();
		if (OnlineState == TEXT("BUSY")) return WonderlandUi::Coral();
		if (OnlineState == TEXT("AWAY")) return WonderlandUi::Gold();
		return WonderlandUi::Faint();
	}

	/** "#RRGGBB" -> colour; transparent for anything else (the skin's own colour is then shown as such). */
	bool Hex(const FString& Text, FLinearColor& Out)
	{
		if (Text.Len() != 7 || !Text.StartsWith(TEXT("#")))
		{
			return false;
		}
		Out = FLinearColor(FColor::FromHex(Text));
		return true;
	}

	FString RatingLine(const FWonderlandSocialAgentRating& R)
	{
		return FString::Printf(TEXT("%s  %.0f ± %.0f  ·  %d battle%s%s"), *R.Mode, R.Rating, R.Deviation, R.BattleCount,
			R.BattleCount == 1 ? TEXT("") : TEXT("s"), R.bProvisional ? TEXT("  ·  PROVISIONAL") : TEXT(""));
	}

	FString Initial(const FString& Name) { return Name.IsEmpty() ? FString(TEXT("?")) : Name.Left(1).ToUpper(); }
}

// ------------------------------------------------------------------------------------------------- the agent emblem

void SWonderlandSocialAgentEmblem::Construct(const FArguments& InArgs)
{
	Size = InArgs._Size;
	Kind = InArgs._Kind;
	Initial = InArgs._Initial;
}

int32 SWonderlandSocialAgentEmblem::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	// THREE RINGS, AS THE HUD DRAWS ITS AGENTS: the Compound agent outermost in green, the single agent in blue, the LLM
	// companion innermost in white -- each an open arc, so the emblem reads as the same family as the usage meter. An
	// imported system wears the same rings dimmed, with its own initial: still a Compound AI Agent, not Julius.
	const FVector2D Local = AllottedGeometry.GetLocalSize();
	const FVector2D Centre = Local * 0.5;
	const float R = static_cast<float>(FMath::Min(Local.X, Local.Y)) * 0.46f;
	const bool bJulius = Kind == TEXT("JULIUS");
	const float Fade = bJulius ? 1.0f : 0.55f;
	struct FRing { float Radius; float Start; float Sweep; float Thick; FLinearColor Colour; };
	const FRing Rings[] = {
		{R * 1.00f, 205.0f, 290.0f, 7.0f, WonderlandUi::Srgb(0x2F, 0x9E, 0x74, Fade)},
		{R * 0.80f, 215.0f, 280.0f, 6.0f, WonderlandUi::Srgb(0x3B, 0x6F, 0xD8, Fade)},
		{R * 0.62f, 225.0f, 270.0f, 4.0f, WonderlandUi::Ivory(0.92f * Fade)},
	};
	int32 Layer = LayerId;
	for (const FRing& Ring : Rings)
	{
		TArray<FVector2D> Points;
		const int32 Steps = 72;
		for (int32 I = 0; I <= Steps; ++I)
		{
			const float A = FMath::DegreesToRadians(Ring.Start + Ring.Sweep * static_cast<float>(I) / Steps);
			Points.Add(Centre + FVector2D(FMath::Cos(A), FMath::Sin(A)) * Ring.Radius);
		}
		FSlateDrawElement::MakeLines(OutDrawElements, ++Layer, AllottedGeometry.ToPaintGeometry(), Points, ESlateDrawEffect::None,
			Ring.Colour, true, Ring.Thick);
	}
	const FSlateFontInfo Font = WonderlandUi::Sans(FMath::Max(12, FMath::RoundToInt(R * 0.55f)), true);
	const FVector2D TextSize = FSlateApplication::Get().GetRenderer()->GetFontMeasureService()->Measure(Initial, Font);
	FSlateDrawElement::MakeText(OutDrawElements, ++Layer,
		AllottedGeometry.ToPaintGeometry(TextSize, FSlateLayoutTransform(Centre - TextSize * 0.5)), Initial, Font,
		ESlateDrawEffect::None, WonderlandUi::Cream(Fade));
	return Layer;
}

// ------------------------------------------------------------------------------------------------------- the avatar

void SWonderlandSocialAvatar::Construct(const FArguments& InArgs)
{
	Size = InArgs._Size;
	Seed = InArgs._Seed;
	Initial = InArgs._Initial;
	Ring = InArgs._Ring;
}

int32 SWonderlandSocialAvatar::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	// A disc whose hue comes from the user id, so the same person always looks the same and nothing is fetched.
	const uint32 Hash = GetTypeHash(Seed);
	const FLinearColor Fill = FLinearColor::MakeFromHSV8(static_cast<uint8>(Hash & 0xFF), 120, 120);
	const FVector2D Local = AllottedGeometry.GetLocalSize();
	const float D = static_cast<float>(FMath::Min(Local.X, Local.Y));
	const FSlateRoundedBoxBrush Disc(Fill, D * 0.5f, Ring, 2.0f);
	// THE FILL IS THE TINT: MakeBox draws a rounded box in the colour it is handed, not the brush's own (measured: every avatar
	// drew white, its initial cream on white). The outline keeps the brush's ring colour.
	FSlateDrawElement::MakeBox(OutDrawElements, LayerId, AllottedGeometry.ToPaintGeometry(FVector2D(D, D), FSlateLayoutTransform()), &Disc, ESlateDrawEffect::None, Fill);
	const FSlateFontInfo Font = WonderlandUi::Sans(FMath::Max(10, FMath::RoundToInt(D * 0.38f)), true);
	const FVector2D TextSize = FSlateApplication::Get().GetRenderer()->GetFontMeasureService()->Measure(Initial, Font);
	FSlateDrawElement::MakeText(OutDrawElements, LayerId + 1,
		AllottedGeometry.ToPaintGeometry(TextSize, FSlateLayoutTransform(FVector2D(D, D) * 0.5 - TextSize * 0.5)), Initial, Font,
		ESlateDrawEffect::None, WonderlandUi::Cream());
	return LayerId + 1;
}

// -------------------------------------------------------------------------------------------------------- the panel

SWonderlandSocialProfilePanel::SWonderlandSocialProfilePanel()
	: PanelBrush(WonderlandUi::Srgb(8, 10, 16, 0.94f), 16.0f, WonderlandUi::Gold(0.30f), 1.0f)
	, CardBrush(WonderlandUi::Srgb(4, 5, 8, 0.92f), 14.0f, WonderlandUi::Ivory(0.14f), 1.0f)
	, SectionBrush(WonderlandUi::Srgb(14, 16, 24, 0.74f), 10.0f, WonderlandUi::Ivory(0.08f), 1.0f)
	, TileBrush(WonderlandUi::Srgb(18, 20, 30, 0.80f), 9.0f, WonderlandUi::Gold(0.26f), 1.0f)
	, PreviewBrush(WonderlandUi::Srgb(40, 20, 14, 0.85f), 6.0f, WonderlandUi::Coral(0.80f), 1.0f)
	, ButtonNormal(WonderlandUi::Srgb(24, 26, 38, 0.92f), 7.0f, WonderlandUi::Ivory(0.24f), 1.0f)
	, ButtonHovered(WonderlandUi::Srgb(40, 34, 18, 0.96f), 7.0f, WonderlandUi::Gold(0.90f), 1.2f)
	, ButtonDisabled(WonderlandUi::Srgb(16, 17, 22, 0.70f), 7.0f, WonderlandUi::Ivory(0.08f), 1.0f)
{
}

void SWonderlandSocialProfilePanel::Construct(const FArguments& InArgs)
{
	using namespace WonderlandSocialProfileLook;
	View = InArgs._View;
	NamesById = InArgs._NamesById;
	SourceLine = InArgs._SourceLine;
	bDevelopmentPreview = InArgs._bDevelopmentPreview;
	DogBrush = InArgs._DogBrush;
	DogSkinName = InArgs._DogSkinName;
	OnDogPainted = InArgs._OnDogPainted;
	OnAction = InArgs._OnAction;
	OnOpenProfile = InArgs._OnOpenProfile;
	OnRequestClose = InArgs._OnRequestClose;
	ScrimBrush.DrawAs = ESlateBrushDrawType::Image;
	ScrimBrush.TintColor = FSlateColor(WonderlandUi::Srgb(3, 4, 8, 0.70f));
	ButtonStyle = FButtonStyle().SetNormal(ButtonNormal).SetHovered(ButtonHovered).SetPressed(ButtonHovered).SetDisabled(ButtonDisabled)
		.SetNormalPadding(FMargin(12.0f, 6.0f)).SetPressedPadding(FMargin(12.0f, 7.0f, 12.0f, 5.0f));

	ChildSlot
	[
		SNew(SOverlay)
		+ SOverlay::Slot()[SNew(SBorder).BorderImage(&ScrimBrush)]
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center).Padding(28.0f)
		[
			SNew(SScaleBox).Stretch(EStretch::ScaleToFit).StretchDirection(EStretchDirection::DownOnly)
			[
				SNew(SBox).WidthOverride(1240.0f).HeightOverride(760.0f)
				[
					SNew(SBorder).BorderImage(&PanelBrush).Padding(FMargin(22.0f, 18.0f))
					[
						SNew(SVerticalBox)
						// ---- the bar: what this is, where it comes from, and the way out
						+ SVerticalBox::Slot().AutoHeight()
						[
							SNew(SHorizontalBox)
							+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
							[
								SNew(STextBlock).Text(T(TEXT("WONDERLAND PROFILE"))).Font(WonderlandUi::Sans(10, true, 260)).ColorAndOpacity(WonderlandUi::Gold(0.85f))
							]
							+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 12.0f, 0.0f)
							[
								SNew(SBorder).BorderImage(&PreviewBrush).Padding(FMargin(10.0f, 3.0f))
								.Visibility(bDevelopmentPreview ? EVisibility::Visible : EVisibility::Collapsed)
								[
									SNew(STextBlock).Text(T(SourceLine)).Font(WonderlandUi::Sans(8, true, 140)).ColorAndOpacity(WonderlandUi::Cream())
								]
							]
							+ SHorizontalBox::Slot().AutoWidth()
							[
								SNew(SButton).ButtonStyle(&ButtonStyle).IsFocusable(false)
								.OnClicked_Lambda([this]() { OnRequestClose.ExecuteIfBound(); return FReply::Handled(); })
								[
									SNew(STextBlock).Text(T(TEXT("CLOSE   Esc"))).Font(WonderlandUi::Sans(9, true, 200)).ColorAndOpacity(WonderlandUi::Cream(0.85f))
								]
							]
						]
						+ SVerticalBox::Slot().FillHeight(1.0f).Padding(0.0f, 14.0f, 0.0f, 0.0f)
						[
							SNew(SHorizontalBox)
							// ---- LEFT: the AI identity -- the Compound AI Agent above, the Relay Dog below
							+ SHorizontalBox::Slot().AutoWidth()
							[
								SNew(SBox).WidthOverride(430.0f)
								[
									SNew(SVerticalBox)
									+ SVerticalBox::Slot().FillHeight(0.46f)[MakeAgentCard()]
									+ SVerticalBox::Slot().FillHeight(0.54f).Padding(0.0f, 12.0f, 0.0f, 0.0f)[MakeDogCard()]
								]
							]
							// ---- RIGHT: the player
							+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(20.0f, 0.0f, 0.0f, 0.0f)
							[
								SNew(SVerticalBox)
								+ SVerticalBox::Slot().AutoHeight()[MakeHeader()]
								+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 0.0f)[MakeProgressionTiles()]
								+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 0.0f)[MakeLoadout()]
								+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 0.0f)[MakeSocialStatus()]
								+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)[MakeActions()]
								+ SVerticalBox::Slot().FillHeight(1.0f).Padding(0.0f, 14.0f, 0.0f, 0.0f)[MakeStatsAndMutuals()]
							]
						]
					]
				]
			]
		]
	];
}

TSharedRef<SWidget> SWonderlandSocialProfilePanel::MakeAgentCard()
{
	using namespace WonderlandSocialProfileLook;
	const FWonderlandSocialProfile& P = View.Profile;
	TSharedRef<SVerticalBox> Ratings = SNew(SVerticalBox);
	if (P.bHasPrimaryAgent)
	{
		for (const FWonderlandSocialAgentRating& R : P.PrimaryAgent.Ratings)
		{
			Ratings->AddSlot().AutoHeight().Padding(0.0f, 2.0f)[SNew(STextBlock).Text(T(RatingLine(R))).Font(WonderlandUi::Mono(9)).ColorAndOpacity(WonderlandUi::Dim())];
		}
		if (P.PrimaryAgent.Ratings.Num() == 0)
		{
			Ratings->AddSlot().AutoHeight()[SNew(STextBlock).Text(T(TEXT("No arena record yet"))).Font(WonderlandUi::Sans(9)).ColorAndOpacity(WonderlandUi::Faint())];
		}
	}
	return SNew(SBorder).BorderImage(&CardBrush).Padding(FMargin(18.0f, 14.0f))
	[
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight()
		[
			SNew(STextBlock).Text(T(TEXT("PRIMARY COMPOUND AI AGENT"))).Font(WonderlandUi::Sans(9, true, 220)).ColorAndOpacity(WonderlandUi::Gold(0.85f))
		]
		+ SVerticalBox::Slot().FillHeight(1.0f).Padding(0.0f, 8.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
			[
				SNew(SWonderlandSocialAgentEmblem).Size(176.0f)
				.Kind(P.bHasPrimaryAgent ? P.PrimaryAgent.Kind : FString(TEXT("IMPORTED")))
				.Initial(P.bHasPrimaryAgent ? Initial(P.PrimaryAgent.DisplayName) : FString(TEXT("?")))
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center).Padding(16.0f, 0.0f, 0.0f, 0.0f)
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(STextBlock).Text(T(P.bHasPrimaryAgent ? P.PrimaryAgent.DisplayName : FString(TEXT("None shown"))))
					.Font(WonderlandUi::Sans(26, true, 40)).ColorAndOpacity(WonderlandUi::Cream())
				]
				+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f, 0.0f, 10.0f)
				[
					SNew(STextBlock).Text(T(P.bHasPrimaryAgent ? P.PrimaryAgent.SystemLabel : FString()))
					.Font(WonderlandUi::Sans(10)).ColorAndOpacity(WonderlandUi::Dim()).AutoWrapText(true)
				]
				+ SVerticalBox::Slot().AutoHeight()[Ratings]
			]
		]
	];
}

TSharedRef<SWidget> SWonderlandSocialProfilePanel::MakeDogCard()
{
	using namespace WonderlandSocialProfileLook;
	const FWonderlandSocialRelayDog& Dog = View.Profile.RelayDog;
	TSharedRef<SHorizontalBox> Swatches = SNew(SHorizontalBox);
	bool bAnyChosen = false;
	const TPair<const TCHAR*, FString> Chosen[] = {{TEXT("PRIMARY"), Dog.Primary}, {TEXT("SECONDARY"), Dog.Secondary}, {TEXT("FLAME"), Dog.Flame}};
	for (const TPair<const TCHAR*, FString>& Pair : Chosen)
	{
		FLinearColor Colour;
		if (!Hex(Pair.Value, Colour))
		{
			continue;
		}
		bAnyChosen = true;
		Swatches->AddSlot().AutoWidth().Padding(0.0f, 0.0f, 12.0f, 0.0f).VAlign(VAlign_Center)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
			[
				SNew(SBox).WidthOverride(14.0f).HeightOverride(14.0f)[SNew(SImage).Image(FCoreStyle::Get().GetBrush("WhiteBrush")).ColorAndOpacity(Colour)]
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(5.0f, 0.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Text(T(Pair.Key)).Font(WonderlandUi::Sans(8, true, 140)).ColorAndOpacity(WonderlandUi::Dim())
			]
		];
	}
	return SNew(SBorder).BorderImage(&CardBrush).Padding(FMargin(18.0f, 14.0f))
	[
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight()
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().FillWidth(1.0f)
			[
				SNew(STextBlock).Text(T(TEXT("PRIMARY RELAY DOG"))).Font(WonderlandUi::Sans(9, true, 220)).ColorAndOpacity(WonderlandUi::Gold(0.85f))
			]
			+ SHorizontalBox::Slot().AutoWidth()
			[
				SNew(STextBlock).Text(T((DogSkinName.IsEmpty() ? UnknownSkinLabel(Dog.SkinId) : DogSkinName).ToUpper())).Font(WonderlandUi::Sans(10, true, 160)).ColorAndOpacity(WonderlandUi::Cream())
			]
		]
		+ SVerticalBox::Slot().FillHeight(1.0f).Padding(0.0f, 8.0f)
		[
			SNew(SScaleBox).Stretch(EStretch::ScaleToFit)
			[
				SNew(SBox).WidthOverride(320.0f).HeightOverride(400.0f)
				[
					// THE LIVE FIGURE, from the profile stage: their skin, idling as Relay OG does. The brush is the stage's
					// render target, and painting it tells the stage somebody is looking (so it only renders while shown).
					SNew(SImage)
					.Image(DogBrush)
					.Visibility(DogBrush != nullptr ? EVisibility::HitTestInvisible : EVisibility::Collapsed)
					.ColorAndOpacity_Lambda([this]() { OnDogPainted.ExecuteIfBound(); return FSlateColor(FLinearColor::White); })
				]
			]
		]
		+ SVerticalBox::Slot().AutoHeight()[Swatches]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 0.0f)
		[
			// HONEST ABOUT THE COLOURS: the figure is drawn in the skin's designed colours until the body can wear somebody
			// else's colourway; their chosen colours are the swatches above.
			SNew(STextBlock)
			.Text(T(bAnyChosen ? FString(TEXT("Shown in the skin's designed colours · their chosen colours above")) : FString(TEXT("Wears the skin's designed colours"))))
			.Font(WonderlandUi::Sans(8)).ColorAndOpacity(WonderlandUi::Faint())
		]
	];
}

TSharedRef<SWidget> SWonderlandSocialProfilePanel::MakeHeader()
{
	using namespace WonderlandSocialProfileLook;
	const FWonderlandSocialProfile& P = View.Profile;
	const FWonderlandSocialPresence& S = View.Presence;
	FString Where = S.bHasLocation
		? (S.Location.PlaceLabel.IsEmpty() ? S.Location.ServerName : FString::Printf(TEXT("%s · %s"), *S.Location.ServerName, *S.Location.PlaceLabel))
		: (S.OnlineState == TEXT("OFFLINE") ? FString() : FString(TEXT("Location hidden")));
	FString Identity = P.Handle;
	if (!P.NationId.IsEmpty())
	{
		Identity += FString::Printf(TEXT("   ·   %s"), *P.NationId);
	}
	if (!P.ClanName.IsEmpty())
	{
		Identity += FString::Printf(TEXT("   ·   %s"), *P.ClanName);
	}
	return SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
		[
			SNew(SWonderlandSocialAvatar).Size(88.0f).Seed(P.UserId).Initial(Initial(P.DisplayName)).Ring(StateColour(S.OnlineState))
		]
		+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center).Padding(16.0f, 0.0f, 0.0f, 0.0f)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(STextBlock).Text(T(P.DisplayName)).Font(WonderlandUi::Sans(30, true, 30)).ColorAndOpacity(WonderlandUi::Cream())
			]
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(STextBlock).Text(T(Identity)).Font(WonderlandUi::Sans(10, false, 80)).ColorAndOpacity(WonderlandUi::Dim())
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 8.0f, 0.0f, 0.0f)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					SNew(SBox).WidthOverride(10.0f).HeightOverride(10.0f)[SNew(SImage).Image(FCoreStyle::Get().GetBrush("WhiteBrush")).ColorAndOpacity(StateColour(S.OnlineState))]
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(8.0f, 0.0f, 14.0f, 0.0f)
				[
					SNew(STextBlock).Text(T(S.Headline)).Font(WonderlandUi::Sans(11, true, 180)).ColorAndOpacity(StateColour(S.OnlineState))
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(T(S.bHasActivity ? S.ActivityLabel : FString())).Font(WonderlandUi::Sans(11)).ColorAndOpacity(WonderlandUi::Cream(0.85f))
				]
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 3.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Text(T(Where)).Font(WonderlandUi::Sans(9)).ColorAndOpacity(WonderlandUi::Dim())
			]
		];
}

TSharedRef<SWidget> SWonderlandSocialProfilePanel::MakeProgressionTiles()
{
	using namespace WonderlandSocialProfileLook;
	// RANK AND LEVEL, PROMINENT AND PENDING (founder): no progression system has been designed, so the tiles say so instead of
	// showing a number -- and nothing cosmetic (the Dog's chakra accent) or an agent's arena rating stands in for them.
	const auto Tile = [this](const TCHAR* Label)
	{
		return SNew(SBorder).BorderImage(&TileBrush).Padding(FMargin(16.0f, 10.0f))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(T(Label)).Font(WonderlandUi::Sans(9, true, 240)).ColorAndOpacity(WonderlandUi::Gold(0.85f))]
			+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(T(TEXT("PENDING"))).Font(WonderlandUi::Sans(20, true, 60)).ColorAndOpacity(WonderlandUi::Cream(0.78f))]
			+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(T(TEXT("Player progression is not designed yet"))).Font(WonderlandUi::Sans(8)).ColorAndOpacity(WonderlandUi::Faint())]
		];
	};
	return SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().FillWidth(1.0f)[Tile(TEXT("RANK"))]
		+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(12.0f, 0.0f, 0.0f, 0.0f)[Tile(TEXT("LEVEL"))];
}

TSharedRef<SWidget> SWonderlandSocialProfilePanel::MakeLoadout()
{
	using namespace WonderlandSocialProfileLook;
	const FWonderlandSocialProfile& P = View.Profile;
	TSharedRef<SWrapBox> Agents = SNew(SWrapBox).UseAllottedSize(true).InnerSlotPadding(FVector2D(10.0, 8.0));
	for (const FWonderlandSocialAgent& A : P.ShowcaseAgents)
	{
		Agents->AddSlot()
		[
			SNew(SBorder).BorderImage(&SectionBrush).Padding(FMargin(10.0f, 6.0f))
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[SNew(SWonderlandSocialAgentEmblem).Size(34.0f).Kind(A.Kind).Initial(Initial(A.DisplayName))]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(8.0f, 0.0f, 0.0f, 0.0f)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(T(A.DisplayName)).Font(WonderlandUi::Sans(10, true)).ColorAndOpacity(WonderlandUi::Cream())]
					+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(T(A.Ratings.Num() > 0 ? RatingLine(A.Ratings[0]) : A.SystemLabel)).Font(WonderlandUi::Sans(8)).ColorAndOpacity(WonderlandUi::Dim())]
				]
			]
		];
	}
	if (P.ShowcaseAgents.Num() == 0)
	{
		Agents->AddSlot()[SNew(STextBlock).Text(T(TEXT("No other public agents"))).Font(WonderlandUi::Sans(9)).ColorAndOpacity(WonderlandUi::Faint())];
	}
	TSharedRef<SWrapBox> Companions = SNew(SWrapBox).UseAllottedSize(true).InnerSlotPadding(FVector2D(10.0, 8.0));
	const auto CompanionChip = [this](const FWonderlandSocialCompanion& C, bool bActive)
	{
		return SNew(SBorder).BorderImage(bActive ? &TileBrush : &SectionBrush).Padding(FMargin(10.0f, 6.0f))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(T(C.DisplayName)).Font(WonderlandUi::Sans(10, true)).ColorAndOpacity(WonderlandUi::Cream())]
			+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(T(FString::Printf(TEXT("%s%s"), *CompanionKindLabel(C.Kind), bActive ? TEXT("  ·  ACTIVE") : TEXT(""))))
				.Font(WonderlandUi::Sans(8, true, 120)).ColorAndOpacity(bActive ? WonderlandUi::Gold(0.85f) : WonderlandUi::Dim())]
		];
	};
	if (P.bHasActiveCompanion)
	{
		Companions->AddSlot()[CompanionChip(P.ActiveCompanion, true)];
	}
	for (const FWonderlandSocialCompanion& C : P.ShowcaseCompanions)
	{
		Companions->AddSlot()[CompanionChip(C, false)];
	}
	return SNew(SBorder).BorderImage(&SectionBrush).Padding(FMargin(14.0f, 10.0f))
	[
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(T(TEXT("AI COMPANIONS"))).Font(WonderlandUi::Sans(9, true, 220)).ColorAndOpacity(WonderlandUi::Gold(0.85f))]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 10.0f)[Companions]
		+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(T(TEXT("COMPOUND AI AGENTS"))).Font(WonderlandUi::Sans(9, true, 220)).ColorAndOpacity(WonderlandUi::Gold(0.85f))]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f)[Agents]
	];
}

TSharedRef<SWidget> SWonderlandSocialProfilePanel::MakeSocialStatus()
{
	using namespace WonderlandSocialProfileLook;
	FString Relationship = View.Relationship;
	Relationship = Relationship == TEXT("FRIEND") ? TEXT("FRIEND") : Relationship == TEXT("SELF") ? TEXT("YOU")
		: Relationship == TEXT("REQUEST_SENT") ? TEXT("FRIEND REQUEST SENT") : Relationship == TEXT("REQUEST_RECEIVED") ? TEXT("WANTS TO BE FRIENDS")
		: Relationship == TEXT("BLOCKED") ? TEXT("BLOCKED") : TEXT("NOT FRIENDS");
	const FString Party = !View.bInParty ? FString(TEXT("Not in a party you can see"))
		: View.PartyMemberCount > 0 ? FString::Printf(TEXT("In a party of %d%s"), View.PartyMemberCount, View.bPartyJoinable ? TEXT("  ·  JOINABLE") : TEXT(""))
		: FString(TEXT("In a party"));
	return SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
		[
			SNew(STextBlock).Text(T(Relationship)).Font(WonderlandUi::Sans(10, true, 200)).ColorAndOpacity(WonderlandUi::Cream(0.9f))
		]
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(18.0f, 0.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Text(T(Party)).Font(WonderlandUi::Sans(10)).ColorAndOpacity(WonderlandUi::Dim())
		];
}

TSharedRef<SWidget> SWonderlandSocialProfilePanel::ActionButton(const FString& Label, const FString& OperationId, bool bAllowed)
{
	using namespace WonderlandSocialProfileLook;
	const FString Subject = View.Profile.UserId;
	return SNew(SButton).ButtonStyle(&ButtonStyle).IsFocusable(false).IsEnabled(bAllowed)
		.ToolTipText(T(bAllowed ? (bDevelopmentPreview ? FString(TEXT("DEVELOPMENT PREVIEW: shows the action, changes nothing")) : FString()) : FString(TEXT("Not available to you"))))
		.OnClicked_Lambda([this, OperationId, Subject]()
		{
			OnAction.ExecuteIfBound(OperationId, Subject);
			return FReply::Handled();
		})
		[
			SNew(STextBlock).Text(T(Label)).Font(WonderlandUi::Sans(9, true, 160)).ColorAndOpacity(WonderlandUi::Cream(bAllowed ? 0.92f : 0.35f))
		];
}

TSharedRef<SWidget> SWonderlandSocialProfilePanel::MakeActions()
{
	using namespace WonderlandSocialProfileLook;
	const FWonderlandSocialActions& Can = View.Presence.Can;
	const bool bSelf = View.Relationship == TEXT("SELF");
	TSharedRef<SWrapBox> Row = SNew(SWrapBox).UseAllottedSize(true).InnerSlotPadding(FVector2D(8.0, 8.0));
	if (!bSelf)
	{
		Row->AddSlot()[ActionButton(TEXT("MESSAGE"), TEXT("messages.send"), Can.bMessage)];
		Row->AddSlot()[ActionButton(TEXT("INVITE TO PARTY"), TEXT("parties.invite"), Can.bInviteToParty)];
		Row->AddSlot()[ActionButton(TEXT("JOIN PARTY"), TEXT("parties.join"), Can.bJoinParty)];
		Row->AddSlot()[ActionButton(TEXT("JOIN SERVER"), TEXT("server.join"), Can.bJoinServer)];
		Row->AddSlot()[ActionButton(TEXT("INVITE TO SERVER"), TEXT("server.invite"), Can.bInviteToServer)];
		if (Can.bRemoveFriend)
		{
			Row->AddSlot()[ActionButton(TEXT("REMOVE FRIEND"), TEXT("friends.remove"), true)];
		}
		else
		{
			Row->AddSlot()[ActionButton(TEXT("ADD FRIEND"), TEXT("requests.send"), Can.bSendFriendRequest)];
		}
		Row->AddSlot()[ActionButton(TEXT("MUTE"), TEXT("mutes.set"), Can.bMute)];
		Row->AddSlot()[ActionButton(TEXT("BLOCK"), TEXT("blocks.add"), Can.bBlock)];
		Row->AddSlot()[ActionButton(TEXT("REPORT"), TEXT("reports.file"), Can.bReport)];
	}
	return SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight()[Row]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f)
		[
			SAssignNew(ActionLineText, STextBlock).Text(T(LastActionLine)).Font(WonderlandUi::Sans(9)).ColorAndOpacity(WonderlandUi::Coral(0.9f))
		];
}

TSharedRef<SWidget> SWonderlandSocialProfilePanel::MakeStatsAndMutuals()
{
	using namespace WonderlandSocialProfileLook;
	const FWonderlandSocialProfile& P = View.Profile;
	TSharedRef<SVerticalBox> Stats = SNew(SVerticalBox);
	for (const FWonderlandSocialStat& S : P.Stats)
	{
		if (S.Source == TEXT("PENDING"))
		{
			continue;
		}
		Stats->AddSlot().AutoHeight().Padding(0.0f, 2.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().FillWidth(1.0f)[SNew(STextBlock).Text(T(S.Label)).Font(WonderlandUi::Sans(10)).ColorAndOpacity(WonderlandUi::Dim())]
			+ SHorizontalBox::Slot().AutoWidth()[SNew(STextBlock).Text(T(S.Value)).Font(WonderlandUi::Mono(10)).ColorAndOpacity(WonderlandUi::Cream())]
		];
	}
	if (Stats->NumSlots() == 0)
	{
		Stats->AddSlot().AutoHeight()[SNew(STextBlock).Text(T(TEXT("No public statistics yet"))).Font(WonderlandUi::Sans(9)).ColorAndOpacity(WonderlandUi::Faint())];
	}
	TSharedRef<SWrapBox> Mutuals = SNew(SWrapBox).UseAllottedSize(true).InnerSlotPadding(FVector2D(6.0, 6.0));
	for (const FString& Id : View.MutualFriendIds)
	{
		const FString* Name = NamesById.Find(Id);
		Mutuals->AddSlot()
		[
			SNew(SButton).ButtonStyle(&ButtonStyle).IsFocusable(false)
			.OnClicked_Lambda([this, Id]() { OnOpenProfile.ExecuteIfBound(Id); return FReply::Handled(); })
			[
				SNew(STextBlock).Text(T(Name != nullptr ? *Name : Id)).Font(WonderlandUi::Sans(9, true, 80)).ColorAndOpacity(WonderlandUi::Cream(0.9f))
			]
		];
	}
	if (View.MutualFriendIds.Num() == 0)
	{
		Mutuals->AddSlot()[SNew(STextBlock).Text(T(TEXT("No mutual friends"))).Font(WonderlandUi::Sans(9)).ColorAndOpacity(WonderlandUi::Faint())];
	}
	return SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().FillWidth(1.0f)
		[
			SNew(SBorder).BorderImage(&SectionBrush).Padding(FMargin(14.0f, 10.0f))
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(T(TEXT("STATISTICS"))).Font(WonderlandUi::Sans(9, true, 220)).ColorAndOpacity(WonderlandUi::Gold(0.85f))]
				+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f)[Stats]
			]
		]
		+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(12.0f, 0.0f, 0.0f, 0.0f)
		[
			SNew(SBorder).BorderImage(&SectionBrush).Padding(FMargin(14.0f, 10.0f))
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(T(TEXT("MUTUAL FRIENDS"))).Font(WonderlandUi::Sans(9, true, 220)).ColorAndOpacity(WonderlandUi::Gold(0.85f))]
				+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f)[Mutuals]
			]
		];
}

FReply SWonderlandSocialProfilePanel::OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	if (InKeyEvent.GetKey() == EKeys::Escape)
	{
		OnRequestClose.ExecuteIfBound();
		return FReply::Handled();
	}
	return SCompoundWidget::OnKeyDown(MyGeometry, InKeyEvent);
}

void SWonderlandSocialProfilePanel::ShowActionResult(const FString& Line)
{
	LastActionLine = Line;
	if (ActionLineText.IsValid())
	{
		ActionLineText->SetText(FText::FromString(Line));
	}
}

FString SWonderlandSocialProfilePanel::DescribeIdentityColumn() const
{
	const FWonderlandSocialProfile& P = View.Profile;
	return FString::Printf(TEXT("agent=%s (%s) | dog=%s | dogRendered=%d | rank=%s | level=%s | companion=%s"),
		P.bHasPrimaryAgent ? *P.PrimaryAgent.DisplayName : TEXT("none"), P.bHasPrimaryAgent ? *P.PrimaryAgent.Kind : TEXT("-"),
		*P.RelayDog.SkinId, DogBrush != nullptr ? 1 : 0, *P.ProgressionSource, *P.ProgressionSource,
		P.bHasActiveCompanion ? *P.ActiveCompanion.DisplayName : TEXT("none"));
}
