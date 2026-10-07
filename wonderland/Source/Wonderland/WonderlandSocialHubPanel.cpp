#include "WonderlandSocialHubPanel.h"

#include "Framework/Application/SlateApplication.h"
#include "HAL/IConsoleManager.h"
#include "Misc/DateTime.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SScaleBox.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/Layout/SWrapBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandSocialLive.h"   // D3 (b) QA: UNBLOCK's operation through the real dispatcher
#include "WonderlandUiStyle.h"
// F-21 QA (wl.Qa.SocialHubClicks): the hub on screen, a ticker, synthetic pointer events
#include "Containers/Ticker.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "WonderlandUiSubsystem.h"

// Named, not anonymous: the module is one unity translation unit.
namespace WonderlandSocialHubLook
{
	FText T(const FString& S) { return FText::FromString(S); }

	FString Initial(const FString& Name) { return Name.IsEmpty() ? FString(TEXT("?")) : Name.Left(1).ToUpper(); }

	/** Presence order for the list: on and free first, then busy, then away, then the rest. */
	int32 StateRank(const FString& OnlineState)
	{
		if (OnlineState == TEXT("ONLINE")) return 0;
		if (OnlineState == TEXT("BUSY")) return 1;
		if (OnlineState == TEXT("AWAY")) return 2;
		return 3;
	}

	bool IsOn(const FWonderlandSocialPresence& P)
	{
		return P.RestrictedReason.IsEmpty() && StateRank(P.OnlineState) < 3;
	}

	FLinearColor StateDot(const FWonderlandSocialPresence& P)
	{
		if (!P.RestrictedReason.IsEmpty()) return WonderlandUi::Faint(0.6f);
		if (P.OnlineState == TEXT("ONLINE")) return WonderlandUi::Green();
		if (P.OnlineState == TEXT("BUSY")) return WonderlandUi::Coral();
		if (P.OnlineState == TEXT("AWAY")) return WonderlandUi::Gold();
		return WonderlandUi::Faint();
	}

	/** "IN GVE · Tower Lane · ICARUS", "OFFLINE · seen 3 h ago", or why it is hidden -- never a guess at a withheld field. */
	FString PresenceLine(const FWonderlandSocialPresence& P);

	/** "just now", "12 min ago", "3 h ago", "2 d ago" from an ISO time; empty when it does not parse. */
	FString Ago(const FString& Iso)
	{
		FDateTime When;
		if (Iso.IsEmpty() || !FDateTime::ParseIso8601(*Iso, When))
		{
			return FString();
		}
		const double Minutes = (FDateTime::UtcNow() - When).GetTotalMinutes();
		if (Minutes < 2.0) return TEXT("just now");
		if (Minutes < 90.0) return FString::Printf(TEXT("%d min ago"), FMath::RoundToInt(Minutes));
		if (Minutes < 48.0 * 60.0) return FString::Printf(TEXT("%d h ago"), FMath::RoundToInt(Minutes / 60.0));
		return FString::Printf(TEXT("%d d ago"), FMath::RoundToInt(Minutes / 1440.0));
	}

	/** "expires in 40 min" / "expired" from an ISO time; empty when it does not parse. */
	FString ExpiresIn(const FString& Iso)
	{
		FDateTime When;
		if (Iso.IsEmpty() || !FDateTime::ParseIso8601(*Iso, When))
		{
			return FString();
		}
		const double Minutes = (When - FDateTime::UtcNow()).GetTotalMinutes();
		if (Minutes <= 0.0) return TEXT("expired");
		if (Minutes < 90.0) return FString::Printf(TEXT("expires in %d min"), FMath::Max(1, FMath::RoundToInt(Minutes)));
		return FString::Printf(TEXT("expires in %d h"), FMath::RoundToInt(Minutes / 60.0));
	}

	FString PresenceLine(const FWonderlandSocialPresence& P)
	{
		if (!P.RestrictedReason.IsEmpty())
		{
			if (P.RestrictedReason == TEXT("BLOCKED") || P.RestrictedReason == TEXT("BLOCKED_BY")) return TEXT("presence hidden");
			if (P.RestrictedReason == TEXT("FRIENDS_ONLY")) return TEXT("shares presence with friends only");
			if (P.RestrictedReason == TEXT("PRIVATE")) return TEXT("presence private");
		}
		if (StateRank(P.OnlineState) == 3)
		{
			const FString Seen = Ago(P.LastSeenIso);
			return Seen.IsEmpty() ? FString(TEXT("OFFLINE")) : FString::Printf(TEXT("OFFLINE  ·  seen %s"), *Seen);
		}
		FString Line = P.Headline.IsEmpty() ? P.OnlineState : P.Headline;
		if (P.bHasActivity && !P.ActivityLabel.IsEmpty())
		{
			// NOT THE HEADLINE TWICE: an activity label that opens with the headline ("In GVE · Tower Lane arena" under IN GVE)
			// keeps only what it adds.
			FString Label = P.ActivityLabel;
			FString First;
			FString Rest;
			if (Label.Split(TEXT(" · "), &First, &Rest) ? First.Equals(P.Headline, ESearchCase::IgnoreCase) : Label.Equals(P.Headline, ESearchCase::IgnoreCase))
			{
				Label = Rest;
			}
			if (!Label.IsEmpty())
			{
				Line += FString::Printf(TEXT("  ·  %s"), *Label);
			}
		}
		if (P.bHasLocation)
		{
			const FString Place = !P.Location.PlaceLabel.IsEmpty() ? P.Location.PlaceLabel : P.Location.ServerName;
			if (!Place.IsEmpty())
			{
				Line += FString::Printf(TEXT("  ·  %s"), *Place);
			}
			if (!P.Location.NationId.IsEmpty())
			{
				Line += FString::Printf(TEXT("  ·  %s"), *P.Location.NationId.ToUpper());
			}
		}
		if (!P.PartyId.IsEmpty())
		{
			Line += TEXT("  ·  IN PARTY");
		}
		return Line;
	}
}

SWonderlandSocialHubPanel::SWonderlandSocialHubPanel()
	: PanelBrush(WonderlandUi::Srgb(8, 10, 16, 0.94f), 16.0f, WonderlandUi::Gold(0.30f), 1.0f)
	, RailBrush(WonderlandUi::Srgb(4, 5, 8, 0.92f), 12.0f, WonderlandUi::Ivory(0.10f), 1.0f)
	, RowBrush(WonderlandUi::Srgb(14, 16, 24, 0.74f), 10.0f, WonderlandUi::Ivory(0.08f), 1.0f)
	, RowSelectedBrush(WonderlandUi::Srgb(32, 28, 16, 0.86f), 10.0f, WonderlandUi::Gold(0.70f), 1.0f)
	, MineBrush(WonderlandUi::Srgb(40, 34, 18, 0.92f), 10.0f, WonderlandUi::Gold(0.40f), 1.0f)
	, TheirsBrush(WonderlandUi::Srgb(22, 24, 34, 0.92f), 10.0f, WonderlandUi::Ivory(0.12f), 1.0f)
	, BadgeBrush(WonderlandUi::Gold(0.95f), 9.0f, WonderlandUi::Gold(0.95f), 0.0f)
	, TabNormal(WonderlandUi::Srgb(10, 12, 18, 0.0f), 8.0f, WonderlandUi::Ivory(0.0f), 1.0f)
	, TabSelected(WonderlandUi::Srgb(40, 34, 18, 0.90f), 8.0f, WonderlandUi::Gold(0.80f), 1.0f)
	, PreviewBrush(WonderlandUi::Srgb(40, 20, 14, 0.85f), 6.0f, WonderlandUi::Coral(0.80f), 1.0f)
	, ButtonNormal(WonderlandUi::Srgb(24, 26, 38, 0.92f), 7.0f, WonderlandUi::Ivory(0.24f), 1.0f)
	, ButtonHovered(WonderlandUi::Srgb(40, 34, 18, 0.96f), 7.0f, WonderlandUi::Gold(0.90f), 1.2f)
	, ButtonDisabled(WonderlandUi::Srgb(16, 17, 22, 0.70f), 7.0f, WonderlandUi::Ivory(0.08f), 1.0f)
{
}

SWonderlandSocialHubPanel::~SWonderlandSocialHubPanel()
{
	if (SlatePreTickHandle.IsValid() && FSlateApplication::IsInitialized())
	{
		FSlateApplication::Get().OnPreTick().Remove(SlatePreTickHandle);
	}
}

void SWonderlandSocialHubPanel::Construct(const FArguments& InArgs)
{
	using namespace WonderlandSocialHubLook;
	// F-21: a refresh's rebuild runs here, after the frame's input and before its layout (see FlushRebuild)
	if (FSlateApplication::IsInitialized())
	{
		SlatePreTickHandle = FSlateApplication::Get().OnPreTick().AddSP(this, &SWonderlandSocialHubPanel::HandleSlatePreTick);
	}
	Snapshot = InArgs._Snapshot;
	bConnected = InArgs._bConnected;
	SourceLine = InArgs._SourceLine;
	bDevelopmentPreview = InArgs._bDevelopmentPreview;
	Tab = InArgs._InitialTab;
	OnAction = InArgs._OnAction;
	OnOpenProfile = InArgs._OnOpenProfile;
	OnSend = InArgs._OnSend;
	Voice = InArgs._Voice;
	VoiceLabel = InArgs._VoiceLabel;
	OnVoice = InArgs._OnVoice;
	OnRequestClose = InArgs._OnRequestClose;
	SignIn = InArgs._SignIn;
	OpenConversationId = Snapshot.Conversations.Num() > 0 ? Snapshot.Conversations[0].ConversationId : FString();
	ScrimBrush.DrawAs = ESlateBrushDrawType::Image;
	ScrimBrush.TintColor = FSlateColor(WonderlandUi::Srgb(3, 4, 8, 0.70f));
	NoBrush.DrawAs = ESlateBrushDrawType::NoDrawType;
	ButtonStyle = FButtonStyle().SetNormal(ButtonNormal).SetHovered(ButtonHovered).SetPressed(ButtonHovered).SetDisabled(ButtonDisabled)
		.SetNormalPadding(FMargin(10.0f, 5.0f)).SetPressedPadding(FMargin(10.0f, 6.0f, 10.0f, 4.0f));
	QuietStyle = FButtonStyle().SetNormal(NoBrush).SetHovered(ButtonHovered).SetPressed(ButtonHovered).SetDisabled(NoBrush)
		.SetNormalPadding(FMargin(7.0f, 3.0f)).SetPressedPadding(FMargin(7.0f, 4.0f, 7.0f, 2.0f));
	TabStyle = FButtonStyle().SetNormal(TabNormal).SetHovered(ButtonHovered).SetPressed(TabSelected)
		.SetNormalPadding(FMargin(14.0f, 10.0f)).SetPressedPadding(FMargin(14.0f, 10.0f));
	TabSelectedStyle = FButtonStyle().SetNormal(TabSelected).SetHovered(TabSelected).SetPressed(TabSelected)
		.SetNormalPadding(FMargin(14.0f, 10.0f)).SetPressedPadding(FMargin(14.0f, 10.0f));

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
								SNew(STextBlock).Text(T(TEXT("WONDERLAND SOCIAL"))).Font(WonderlandUi::Sans(10, true, 260)).ColorAndOpacity(WonderlandUi::Gold(0.85f))
							]
							+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 12.0f, 0.0f)
							[
								SNew(SBorder).BorderImage(&PreviewBrush).Padding(FMargin(10.0f, 3.0f))
								.Visibility_Lambda([this]() { return bConnected && !SourceLine.IsEmpty() ? EVisibility::Visible : EVisibility::Collapsed; })
								[
									SAssignNew(SourceText, STextBlock).Text(T(SourceLine)).Font(WonderlandUi::Sans(8, true, 140)).ColorAndOpacity(WonderlandUi::Cream())
								]
							]
							+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
							[
								SNew(SButton).ButtonStyle(&ButtonStyle).IsFocusable(false)
								.OnClicked_Lambda([this]() { OnRequestClose.ExecuteIfBound(); return FReply::Handled(); })
								[
									SNew(STextBlock).Text(T(TEXT("CLOSE  Esc"))).Font(WonderlandUi::Sans(9, true, 160)).ColorAndOpacity(WonderlandUi::Cream(0.92f))
								]
							]
						]
						// ---- the rail (tabs) and the open tab
						+ SVerticalBox::Slot().FillHeight(1.0f).Padding(0.0f, 14.0f, 0.0f, 0.0f)
						[
							SNew(SHorizontalBox)
							+ SHorizontalBox::Slot().AutoWidth()
							[
								SNew(SBox).WidthOverride(230.0f)
								[
									SAssignNew(RailHost, SBorder).BorderImage(&RailBrush).Padding(10.0f)
								]
							]
							+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(16.0f, 0.0f, 0.0f, 0.0f)
							[
								SAssignNew(BodyHost, SBorder).BorderImage(&NoBrush).Padding(0.0f)
							]
						]
						// ---- the foot: the last answer from the social service
						+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)
						[
							SAssignNew(ActionLineText, STextBlock).Text(FText::GetEmpty()).Font(WonderlandUi::Sans(9, false, 60))
							.ColorAndOpacity(WonderlandUi::Cream(0.80f)).AutoWrapText(true)
						]
					]
				]
			]
		]
	];
	Rebuild();
}

const TCHAR* SWonderlandSocialHubPanel::TabName(ETab Which)
{
	switch (Which)
	{
	case ETab::Requests: return TEXT("REQUESTS");
	case ETab::Recent:   return TEXT("RECENT");
	case ETab::Messages: return TEXT("MESSAGES");
	case ETab::Party:    return TEXT("PARTY");
	default:             return TEXT("FRIENDS");
	}
}

bool SWonderlandSocialHubPanel::ParseTab(const FString& Text, ETab& Out)
{
	if (Text.Equals(TEXT("friends"), ESearchCase::IgnoreCase)) { Out = ETab::Friends; return true; }
	if (Text.Equals(TEXT("requests"), ESearchCase::IgnoreCase)) { Out = ETab::Requests; return true; }
	if (Text.Equals(TEXT("recent"), ESearchCase::IgnoreCase)) { Out = ETab::Recent; return true; }
	if (Text.Equals(TEXT("messages"), ESearchCase::IgnoreCase)) { Out = ETab::Messages; return true; }
	if (Text.Equals(TEXT("party"), ESearchCase::IgnoreCase)) { Out = ETab::Party; return true; }
	return false;
}

void SWonderlandSocialHubPanel::SetTab(ETab Which)
{
	// A PLAYER'S TAB CHANGE, said once (CORE 10-06, R7 on the final RC): only the hub's own buttons call this, so a real-input drive
	// proves each tab click by the game's own line ("WLSOCIAL hub tab PARTY"), not by a frame alone.
	UE_LOG(LogTemp, Display, TEXT("WLSOCIAL hub tab %s"), TabName(Which));
	Tab = Which;
	Rebuild();
}

void SWonderlandSocialHubPanel::RequestRebuild()
{
	bRebuildPending = true;
}

void SWonderlandSocialHubPanel::HandleSlatePreTick(float DeltaTime)
{
	if (bRebuildPending)
	{
		Rebuild();
	}
}

void SWonderlandSocialHubPanel::FlushRebuild()
{
	if (bRebuildPending)
	{
		Rebuild();
	}
}

bool SWonderlandSocialHubPanel::QaTabCentre(ETab Which, FVector2D& OutScreen) const
{
	const int32 Index = static_cast<int32>(Which);
	const TSharedPtr<SWidget> Button = Index >= 0 && Index < UE_ARRAY_COUNT(TabButtonWidgets) ? TabButtonWidgets[Index].Pin() : nullptr;
	if (!Button.IsValid())
	{
		return false;
	}
	// DESKTOP space, as pointer events and the hit-test grid use it (SWidget::Paint stores it beside the window-space paint geometry;
	// the first HUBCLICK run used the paint space and clicked beside the game: HC2 failed and HC4 passed for nothing, 2026-10-07)
	const FGeometry& OnDesktop = Button->GetTickSpaceGeometry();
	if (OnDesktop.GetLocalSize().X <= 0.0f || OnDesktop.GetLocalSize().Y <= 0.0f)
	{
		return false;
	}
	OutScreen = FVector2D(OnDesktop.GetAbsolutePositionAtCoordinates(FVector2D(0.5, 0.5)));
	return true;
}

FString SWonderlandSocialHubPanel::QaReplyText() const
{
	return ReplyBox.IsValid() ? ReplyBox->GetText().ToString() : FString();
}

bool SWonderlandSocialHubPanel::QaSetReplyText(const FString& Typed)
{
	if (!ReplyBox.IsValid())
	{
		return false;
	}
	ReplyBox->SetText(FText::FromString(Typed));
	return true;
}

void SWonderlandSocialHubPanel::Rebuild()
{
	bRebuildPending = false;
	// F-21: WHAT THE PLAYER IS TYPING SURVIVES A REBUILD. Every refresh used to build an empty reply box and drop its keyboard
	// focus, so the rest of a message went to the game. Kept for the same conversation only.
	const TSharedPtr<SEditableTextBox> OldReplyBox = ReplyBox;
	const FText KeptDraft = OldReplyBox.IsValid() ? OldReplyBox->GetText() : FText::GetEmpty();
	const bool bKeptFocus = OldReplyBox.IsValid() && OldReplyBox->HasAnyUserFocusOrFocusedDescendants();
	const FString KeptFor = ReplyDraftConversationId;
	ShownRows.Reset();
	if (RailHost.IsValid())
	{
		RailHost->SetContent(MakeRail());
	}
	if (BodyHost.IsValid())
	{
		if (!bConnected)
		{
			BodyHost->SetContent(MakeNotConnected());
		}
		else
		{
			BodyHost->SetContent(Tab == ETab::Requests ? MakeRequests() : Tab == ETab::Recent ? MakeRecent() : Tab == ETab::Messages ? MakeMessages() : Tab == ETab::Party ? MakeParty() : MakeFriends());
		}
	}
	if (ReplyBox.IsValid() && ReplyBox != OldReplyBox && KeptFor == OpenConversationId)
	{
		if (!KeptDraft.IsEmpty())
		{
			ReplyBox->SetText(KeptDraft);
		}
		if (bKeptFocus && FSlateApplication::IsInitialized())
		{
			FSlateApplication::Get().SetKeyboardFocus(ReplyBox, EFocusCause::SetDirectly);
		}
	}
	ReplyDraftConversationId = OpenConversationId;
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeRail()
{
	using namespace WonderlandSocialHubLook;
	const int32 Waiting = Snapshot.IncomingRequests.Num() + Snapshot.PartyInvites.Num();
	return SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().Padding(4.0f, 2.0f, 4.0f, 12.0f)
		[
			SNew(STextBlock).Text(T(bConnected ? FString::Printf(TEXT("%d of %d friends on"), CountOn(), Snapshot.Friends.Num()) : FString(TEXT("not connected"))))
			.Font(WonderlandUi::Sans(9, false, 60)).ColorAndOpacity(WonderlandUi::Dim())
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f)
		[
			MakeTabButton(ETab::Friends, TEXT("FRIENDS"), bConnected ? FString::FromInt(Snapshot.Friends.Num()) : FString())
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f)
		[
			MakeTabButton(ETab::Party, TEXT("PARTY"), bConnected && Snapshot.bHasParty ? FString::FromInt(Snapshot.Party.Members.Num()) : FString())
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f)
		[
			MakeTabButton(ETab::Messages, TEXT("MESSAGES"), bConnected && CountUnread() > 0 ? FString::FromInt(CountUnread()) : FString())
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f)
		[
			MakeTabButton(ETab::Requests, TEXT("REQUESTS"), bConnected && Waiting > 0 ? FString::FromInt(Waiting) : FString())
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f)
		[
			MakeTabButton(ETab::Recent, TEXT("RECENT PLAYERS"), bConnected && Snapshot.RecentPlayers.Num() > 0 ? FString::FromInt(Snapshot.RecentPlayers.Num()) : FString())
		]
		// SIGNED IN AS A REAL PERSON: who, and the way out. Shown only for a live sign-in, never over the preview.
		+ SVerticalBox::Slot().AutoHeight().Padding(4.0f, 18.0f, 4.0f, 2.0f)
		[
			SNew(STextBlock).Visibility(bConnected && !bDevelopmentPreview && SignIn.State == EWonderlandSignInState::SignedIn ? EVisibility::Visible : EVisibility::Collapsed)
			.Text(T(SignIn.bTestIdentity ? FString::Printf(TEXT("TEST IDENTITY @%s (not a real GitHub account)"), *SignIn.Login)
				: FString::Printf(TEXT("signed in as @%s"), *SignIn.Login))).Font(WonderlandUi::Sans(8, false, 60)).ColorAndOpacity(WonderlandUi::Dim())
		]
		// THE PLAYER'S OWN PRESENCE (founder 10-04: "a small presence control", content in the existing hub, no redesign): the four
		// choices the authority knows. The chosen one is the plain button, the others quiet; what OTHERS see is decided by the server.
		+ SVerticalBox::Slot().AutoHeight().Padding(4.0f, 8.0f, 4.0f, 2.0f)
		[
			SNew(STextBlock).Visibility(bConnected && !bDevelopmentPreview && SignIn.State == EWonderlandSignInState::SignedIn ? EVisibility::Visible : EVisibility::Collapsed)
			.Text(T(TEXT("YOUR STATUS"))).Font(WonderlandUi::Sans(8, true, 120)).ColorAndOpacity(WonderlandUi::Dim())
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 1.0f)
		[
			SNew(SBox).Visibility(bConnected && !bDevelopmentPreview && SignIn.State == EWonderlandSignInState::SignedIn ? EVisibility::Visible : EVisibility::Collapsed)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth()[ MakeButton(TEXT("AVAILABLE"), TEXT("presence.set"), TEXT("AVAILABLE"), true, OwnAvailability() != TEXT("AVAILABLE")) ]
				+ SHorizontalBox::Slot().AutoWidth()[ MakeButton(TEXT("AWAY"), TEXT("presence.set"), TEXT("AWAY"), true, OwnAvailability() != TEXT("AWAY")) ]
			]
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 1.0f)
		[
			SNew(SBox).Visibility(bConnected && !bDevelopmentPreview && SignIn.State == EWonderlandSignInState::SignedIn ? EVisibility::Visible : EVisibility::Collapsed)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth()[ MakeButton(TEXT("BUSY"), TEXT("presence.set"), TEXT("BUSY"), true, OwnAvailability() != TEXT("BUSY")) ]
				+ SHorizontalBox::Slot().AutoWidth()[ MakeButton(TEXT("APPEAR OFFLINE"), TEXT("presence.set"), TEXT("APPEAR_OFFLINE"), true, OwnAvailability() != TEXT("APPEAR_OFFLINE")) ]
			]
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 2.0f)
		[
			SNew(SBox).Visibility(bConnected && !bDevelopmentPreview && SignIn.State == EWonderlandSignInState::SignedIn ? EVisibility::Visible : EVisibility::Collapsed)
			[
				MakeButton(TEXT("SIGN OUT"), TEXT("signin.out"), FString(), true, true)
			]
		];
}

FString SWonderlandSocialHubPanel::OwnAvailability() const
{
	// the player's OWN choice, exactly as the server keeps it (snapshot.self.presence.availability, the self view only). NOT onlineState:
	// the server shows a player ONLINE to themselves even while they appear offline, and OFFLINE when not connected (Second's review of
	// 9aab89c2) -- a map from it would show the wrong choice. Absent (an older backend): no button is selected.
	return Snapshot.Self.Presence.Availability;
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeTabButton(ETab Which, const FString& Label, const FString& Count)
{
	using namespace WonderlandSocialHubLook;
	const bool bSelected = Which == Tab;
	TSharedPtr<SButton> TabButton;
	TSharedRef<SWidget> Made = SAssignNew(TabButton, SButton).ButtonStyle(bSelected ? &TabSelectedStyle : &TabStyle).IsFocusable(false)
		.OnClicked_Lambda([this, Which]() { SetTab(Which); return FReply::Handled(); })
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
			[
				SNew(STextBlock).Text(T(Label)).Font(WonderlandUi::Sans(10, true, 180)).ColorAndOpacity(WonderlandUi::Cream(bSelected ? 1.0f : 0.70f))
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
			[
				SNew(STextBlock).Text(T(Count)).Font(WonderlandUi::Sans(10, true)).ColorAndOpacity(WonderlandUi::Gold(bSelected ? 1.0f : 0.70f))
			]
		];
	TabButtonWidgets[static_cast<int32>(Which)] = TabButton;
	return Made;
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeNotConnected()
{
	using namespace WonderlandSocialHubLook;
	if (SignIn.State == EWonderlandSignInState::NoServer)
	{
		return SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)
			[
				SNew(STextBlock).Text(T(FString::Printf(TEXT("Social is not connected in this build.\n%s"), *SignIn.Message)))
				.Font(WonderlandUi::Sans(12, false, 40)).ColorAndOpacity(WonderlandUi::Cream(0.80f)).Justification(ETextJustify::Center).AutoWrapText(true)
			];
	}
	return MakeSignIn();
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeSignIn()
{
	using namespace WonderlandSocialHubLook;
	const bool bWaiting = SignIn.State == EWonderlandSignInState::Waiting;
	const bool bStarting = SignIn.State == EWonderlandSignInState::Starting;
	const FString Headline = bWaiting ? FString(TEXT("Enter this code at GitHub"))
		: bStarting ? FString(TEXT("Signing in…"))
		: FString(TEXT("Sign in to see your friends, messages and party"));
	const FString Lead = bWaiting
		? FString::Printf(TEXT("1. OPEN GITHUB below (or go to %s)\n2. Enter the code and approve Wonderland\n3. Come back: this page updates by itself"), *SignIn.VerificationUri)
		: bStarting ? FString()
		: FString(TEXT("Wonderland signs you in with your GitHub account. Your password never touches the game."));
	TSharedRef<SHorizontalBox> Buttons = SNew(SHorizontalBox);
	if (bWaiting)
	{
		Buttons->AddSlot().AutoWidth()[MakeButton(TEXT("OPEN GITHUB"), TEXT("signin.open"), FString(), true)];
		Buttons->AddSlot().AutoWidth()[MakeButton(TEXT("CANCEL"), TEXT("signin.cancel"), FString(), true, true)];
	}
	else if (bStarting)
	{
		Buttons->AddSlot().AutoWidth()[MakeButton(TEXT("CANCEL"), TEXT("signin.cancel"), FString(), true, true)];
	}
	else
	{
		Buttons->AddSlot().AutoWidth()[MakeButton(TEXT("SIGN IN WITH GITHUB"), TEXT("signin.start"), FString(), true)];
	}
	return SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center).MaxDesiredWidth(560.0f)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 0.0f, 0.0f, 10.0f)
			[
				SNew(STextBlock).Text(T(Headline)).Font(WonderlandUi::Sans(14, true, 60)).ColorAndOpacity(WonderlandUi::Cream(0.92f))
				.Justification(ETextJustify::Center).AutoWrapText(true)
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 4.0f, 0.0f, 12.0f)
			[
				SNew(STextBlock).Visibility(bWaiting ? EVisibility::Visible : EVisibility::Collapsed)
				.Text(T(SignIn.UserCode)).Font(WonderlandUi::Mono(30)).ColorAndOpacity(WonderlandUi::Gold())
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 0.0f, 0.0f, 12.0f)
			[
				SNew(STextBlock).Visibility(Lead.IsEmpty() ? EVisibility::Collapsed : EVisibility::Visible)
				.Text(T(Lead)).Font(WonderlandUi::Sans(10, false, 40)).ColorAndOpacity(WonderlandUi::Cream(0.80f)).Justification(ETextJustify::Center).AutoWrapText(true)
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 0.0f, 0.0f, 10.0f)
			[
				Buttons
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
			[
				SNew(STextBlock).Visibility(SignIn.Message.IsEmpty() || bWaiting ? EVisibility::Collapsed : EVisibility::Visible)
				.Text(T(SignIn.Message)).Font(WonderlandUi::Sans(9, false, 40)).ColorAndOpacity(WonderlandUi::Dim()).Justification(ETextJustify::Center).AutoWrapText(true)
			]
		];
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeSectionTitle(const FString& Title, int32 Count)
{
	using namespace WonderlandSocialHubLook;
	return SNew(STextBlock).Text(T(FString::Printf(TEXT("%s  —  %d"), *Title, Count))).Font(WonderlandUi::Sans(9, true, 220))
		.ColorAndOpacity(WonderlandUi::Gold(0.80f));
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeEmpty(const FString& Line)
{
	using namespace WonderlandSocialHubLook;
	return SNew(SBox).Padding(FMargin(4.0f, 6.0f, 4.0f, 14.0f))
		[
			SNew(STextBlock).Text(T(Line)).Font(WonderlandUi::Sans(10, false, 40)).ColorAndOpacity(WonderlandUi::Dim())
		];
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeButton(const FString& Label, const FString& OperationId, const FString& Subject, bool bAllowed, bool bQuiet)
{
	using namespace WonderlandSocialHubLook;
	return SNew(SBox).Padding(FMargin(3.0f, 0.0f))
		[
			SNew(SButton).ButtonStyle(bQuiet ? &QuietStyle : &ButtonStyle).IsFocusable(false).IsEnabled(bAllowed)
			.ToolTipText(T(bAllowed ? (bDevelopmentPreview ? FString(TEXT("DEVELOPMENT PREVIEW: shows the action, changes nothing")) : FString()) : FString(TEXT("Not available to you"))))
			.OnClicked_Lambda([this, OperationId, Subject]()
			{
				OnAction.ExecuteIfBound(OperationId, Subject);
				return FReply::Handled();
			})
			[
				SNew(STextBlock).Text(T(Label)).Font(WonderlandUi::Sans(bQuiet ? 8 : 9, true, 150))
				.ColorAndOpacity(bQuiet ? WonderlandUi::Dim(bAllowed ? 1.0f : 0.35f) : WonderlandUi::Cream(bAllowed ? 0.92f : 0.35f))
			]
		];
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeProfileButton(const FString& UserId)
{
	using namespace WonderlandSocialHubLook;
	// A PROFILE OPENS ONLY IF THE AUTHORITY GAVE ONE: a person the viewer may not see is absent from Profiles, not redacted.
	const bool bOpenable = UserId == Snapshot.ViewerId || Snapshot.Profiles.Contains(UserId);
	return SNew(SBox).Padding(FMargin(3.0f, 0.0f))
		[
			SNew(SButton).ButtonStyle(&ButtonStyle).IsFocusable(false).IsEnabled(bOpenable)
			.OnClicked_Lambda([this, UserId]() { OnOpenProfile.ExecuteIfBound(UserId); return FReply::Handled(); })
			[
				SNew(STextBlock).Text(T(TEXT("PROFILE"))).Font(WonderlandUi::Sans(9, true, 150)).ColorAndOpacity(WonderlandUi::Cream(bOpenable ? 0.92f : 0.35f))
			]
		];
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakePersonRow(const FWonderlandSocialPersonRow& Person, const FString& Second, const TSharedRef<SWidget>& Actions)
{
	using namespace WonderlandSocialHubLook;
	ShownRows.Add(Person.UserId);
	const FWonderlandSocialPresence& P = Person.Presence;
	return SNew(SBox).Padding(FMargin(0.0f, 3.0f))
		[
			SNew(SBorder).BorderImage(&RowBrush).Padding(FMargin(12.0f, 9.0f))
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 12.0f, 0.0f)
				[
					SNew(SWonderlandSocialAvatar).Size(46.0f).Seed(Person.UserId).Initial(Initial(Person.DisplayName)).Ring(StateDot(P))
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Bottom)
						[
							SNew(STextBlock).Text(T(Person.DisplayName)).Font(WonderlandUi::Sans(12, true)).ColorAndOpacity(WonderlandUi::Cream())
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Bottom).Padding(8.0f, 0.0f, 0.0f, 1.0f)
						[
							SNew(STextBlock).Text(T(Person.Handle.IsEmpty() || Person.Handle.StartsWith(TEXT("@")) ? Person.Handle : FString::Printf(TEXT("@%s"), *Person.Handle)))
							.Font(WonderlandUi::Sans(9, false, 40)).ColorAndOpacity(WonderlandUi::Dim())
						]
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 3.0f, 0.0f, 0.0f)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 6.0f, 0.0f)
						[
							SNew(STextBlock).Text(T(TEXT("●"))).Font(WonderlandUi::Sans(9)).ColorAndOpacity(StateDot(P))
						]
						+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
						[
							SNew(STextBlock).Text(T(PresenceLine(P))).Font(WonderlandUi::Sans(9, true, 80)).ColorAndOpacity(WonderlandUi::Cream(0.78f))
						]
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock).Text(T(Second)).Font(WonderlandUi::Sans(9, false, 40)).ColorAndOpacity(WonderlandUi::Dim())
						.Visibility(Second.IsEmpty() ? EVisibility::Collapsed : EVisibility::Visible)
					]
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(10.0f, 0.0f, 0.0f, 0.0f)
				[
					Actions
				]
			]
		];
}

TArray<const FWonderlandSocialPersonRow*> SWonderlandSocialHubPanel::SortedFriends() const
{
	using namespace WonderlandSocialHubLook;
	TArray<const FWonderlandSocialPersonRow*> Out;
	for (const FWonderlandSocialPersonRow& Row : Snapshot.Friends)
	{
		Out.Add(&Row);
	}
	Out.StableSort([](const FWonderlandSocialPersonRow& A, const FWonderlandSocialPersonRow& B)
	{
		const int32 RA = A.Presence.RestrictedReason.IsEmpty() ? StateRank(A.Presence.OnlineState) : 3;
		const int32 RB = B.Presence.RestrictedReason.IsEmpty() ? StateRank(B.Presence.OnlineState) : 3;
		return RA != RB ? RA < RB : A.DisplayName.Compare(B.DisplayName, ESearchCase::IgnoreCase) < 0;
	});
	return Out;
}

int32 SWonderlandSocialHubPanel::CountOn() const
{
	int32 On = 0;
	for (const FWonderlandSocialPersonRow& Row : Snapshot.Friends)
	{
		On += WonderlandSocialHubLook::IsOn(Row.Presence) ? 1 : 0;
	}
	return On;
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeFriends()
{
	using namespace WonderlandSocialHubLook;
	const TArray<const FWonderlandSocialPersonRow*> Rows = SortedFriends();
	const int32 On = CountOn();
	TSharedRef<SScrollBox> List = SNew(SScrollBox);
	List->AddSlot().Padding(0.0f, 0.0f, 0.0f, 6.0f)[MakeSectionTitle(TEXT("ON NOW"), On)];
	if (On == 0)
	{
		List->AddSlot()[MakeEmpty(Rows.Num() == 0 ? FString(TEXT("No friends yet. Add people from Recent Players or from a profile.")) : FString(TEXT("Nobody is on right now.")))];
	}
	bool bOffHeader = false;
	for (const FWonderlandSocialPersonRow* Row : Rows)
	{
		const FWonderlandSocialPresence& P = Row->Presence;
		const FWonderlandSocialActions& Can = P.Can;
		if (!IsOn(P) && !bOffHeader)
		{
			bOffHeader = true;
			List->AddSlot().Padding(0.0f, 14.0f, 0.0f, 6.0f)[MakeSectionTitle(TEXT("OFFLINE"), Rows.Num() - On)];
		}
		// JOIN: their party if the authority says it is joinable to this viewer, else their server if that is allowed.
		const bool bJoinParty = Can.bJoinParty && !P.PartyId.IsEmpty();
		TSharedRef<SWidget> Actions = SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Right)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth()[MakeProfileButton(Row->UserId)]
				+ SHorizontalBox::Slot().AutoWidth()
				[
					// AN EXISTING CONVERSATION OPENS HERE; a new one is the service's to open.
					FindDirect(Row->UserId) != nullptr
						? StaticCastSharedRef<SWidget>(SNew(SBox).Padding(FMargin(3.0f, 0.0f))
						[
							SNew(SButton).ButtonStyle(&ButtonStyle).IsFocusable(false).IsEnabled(Can.bMessage)
							.OnClicked_Lambda([this, Id = FindDirect(Row->UserId)->ConversationId]() { Tab = ETab::Messages; OpenConversation(Id); return FReply::Handled(); })
							[
								SNew(STextBlock).Text(T(TEXT("MESSAGE"))).Font(WonderlandUi::Sans(9, true, 150)).ColorAndOpacity(WonderlandUi::Cream(Can.bMessage ? 0.92f : 0.35f))
							]
						])
						: MakeButton(TEXT("MESSAGE"), TEXT("conversations.open"), Row->UserId, Can.bMessage)
				]
				+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("INVITE"), TEXT("parties.invite"), Row->UserId, Can.bInviteToParty)]
				+ SHorizontalBox::Slot().AutoWidth()
				[
					MakeButton(TEXT("JOIN"), bJoinParty ? FString(TEXT("parties.join")) : FString(TEXT("server.join")),
						bJoinParty ? P.PartyId : Row->UserId, bJoinParty || Can.bJoinServer)
				]
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Right).Padding(0.0f, 4.0f, 0.0f, 0.0f)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("REMOVE"), TEXT("friends.remove"), Row->UserId, Can.bRemoveFriend, true)]
				+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("MUTE"), TEXT("mutes.set"), Row->UserId, Can.bMute, true)]
				+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("BLOCK"), TEXT("blocks.add"), Row->UserId, Can.bBlock, true)]
				+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("REPORT"), TEXT("reports.file"), Row->UserId, Can.bReport, true)]
			];
		List->AddSlot()[MakePersonRow(*Row, FString(), Actions)];
	}
	// BLOCKED BY YOU (founder D3 = (b), 10-06): the players this viewer blocked, each with UNBLOCK; drawn only when there is one.
	const TArray<FWonderlandSocialPersonRow> Blocked = WonderlandSocialBlocked::BlockedByViewer(Snapshot);
	if (Blocked.Num() > 0)
	{
		List->AddSlot().Padding(0.0f, 14.0f, 0.0f, 6.0f)[MakeSectionTitle(TEXT("BLOCKED BY YOU"), Blocked.Num())];
		for (const FWonderlandSocialPersonRow& Row : Blocked)
		{
			List->AddSlot()[MakePersonRow(Row, FString(TEXT("You are hidden from each other. UNBLOCK undoes it.")),
				MakeButton(TEXT("UNBLOCK"), TEXT("blocks.remove"), Row.UserId, true, true))];
		}
	}
	return List;
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeRequests()
{
	using namespace WonderlandSocialHubLook;
	TSharedRef<SScrollBox> List = SNew(SScrollBox);
	// FRIEND REQUESTS TO YOU: the request is the subject of accept / decline, never the person.
	List->AddSlot().Padding(0.0f, 0.0f, 0.0f, 6.0f)[MakeSectionTitle(TEXT("FRIEND REQUESTS"), Snapshot.IncomingRequests.Num())];
	if (Snapshot.IncomingRequests.Num() == 0)
	{
		List->AddSlot()[MakeEmpty(TEXT("No friend requests waiting."))];
	}
	for (const FWonderlandSocialRequestRow& Request : Snapshot.IncomingRequests)
	{
		TSharedRef<SWidget> Actions = SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth()[MakeProfileButton(Request.Person.UserId)]
			+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("ACCEPT"), TEXT("requests.accept"), Request.RequestId, true)]
			+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("DECLINE"), TEXT("requests.decline"), Request.RequestId, true)]
			+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("BLOCK"), TEXT("blocks.add"), Request.Person.UserId, Request.Person.Presence.Can.bBlock, true)];
		List->AddSlot()[MakePersonRow(Request.Person, TEXT("wants to be friends"), Actions)];
	}
	List->AddSlot().Padding(0.0f, 14.0f, 0.0f, 6.0f)[MakeSectionTitle(TEXT("PARTY INVITES"), Snapshot.PartyInvites.Num())];
	if (Snapshot.PartyInvites.Num() == 0)
	{
		List->AddSlot()[MakeEmpty(TEXT("No party invitations."))];
	}
	for (const FWonderlandSocialPartyInviteRow& Invite : Snapshot.PartyInvites)
	{
		const FString Expiry = ExpiresIn(Invite.ExpiresAtIso);
		const bool bLive = Expiry != TEXT("expired");
		TSharedRef<SWidget> Actions = SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("ACCEPT"), TEXT("party_invites.accept"), Invite.InviteId, bLive)]
			+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("DECLINE"), TEXT("party_invites.decline"), Invite.InviteId, true)];
		const FString Second = FString::Printf(TEXT("invites you to %s%s"), Invite.PartyName.IsEmpty() ? TEXT("their party") : *FString::Printf(TEXT("\"%s\""), *Invite.PartyName),
			Expiry.IsEmpty() ? TEXT("") : *FString::Printf(TEXT("  ·  %s"), *Expiry));
		List->AddSlot()[MakePersonRow(Invite.From, Second, Actions)];
	}
	List->AddSlot().Padding(0.0f, 14.0f, 0.0f, 6.0f)[MakeSectionTitle(TEXT("SENT BY YOU"), Snapshot.OutgoingRequests.Num())];
	if (Snapshot.OutgoingRequests.Num() == 0)
	{
		List->AddSlot()[MakeEmpty(TEXT("No requests waiting on anyone."))];
	}
	for (const FWonderlandSocialRequestRow& Request : Snapshot.OutgoingRequests)
	{
		TSharedRef<SWidget> Actions = SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth()[MakeProfileButton(Request.Person.UserId)]
			+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("CANCEL"), TEXT("requests.cancel"), Request.RequestId, true)];
		List->AddSlot()[MakePersonRow(Request.Person, TEXT("request sent"), Actions)];
	}
	return List;
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeRecent()
{
	using namespace WonderlandSocialHubLook;
	TSharedRef<SScrollBox> List = SNew(SScrollBox);
	List->AddSlot().Padding(0.0f, 0.0f, 0.0f, 6.0f)[MakeSectionTitle(TEXT("PLAYED WITH RECENTLY"), Snapshot.RecentPlayers.Num())];
	if (Snapshot.RecentPlayers.Num() == 0)
	{
		List->AddSlot()[MakeEmpty(TEXT("Nobody yet. People you play with in GvE, missions and servers appear here."))];
	}
	for (const FWonderlandSocialRecentRow& Recent : Snapshot.RecentPlayers)
	{
		const FWonderlandSocialActions& Can = Recent.Person.Presence.Can;
		TSharedRef<SWidget> Actions = SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Right)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth()[MakeProfileButton(Recent.Person.UserId)]
				+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("ADD FRIEND"), TEXT("requests.send"), Recent.Person.UserId, Can.bSendFriendRequest)]
				+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("INVITE"), TEXT("parties.invite"), Recent.Person.UserId, Can.bInviteToParty)]
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Right).Padding(0.0f, 4.0f, 0.0f, 0.0f)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("MUTE"), TEXT("mutes.set"), Recent.Person.UserId, Can.bMute, true)]
				+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("BLOCK"), TEXT("blocks.add"), Recent.Person.UserId, Can.bBlock, true)]
				+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("REPORT"), TEXT("reports.file"), Recent.Person.UserId, Can.bReport, true)]
			];
		const FString Where = Recent.ContextLabel.IsEmpty() ? Recent.Context : Recent.ContextLabel;
		const FString When = Ago(Recent.MetAtIso);
		const FString Second = Where.IsEmpty() ? When : (When.IsEmpty() ? Where : FString::Printf(TEXT("%s  ·  %s"), *Where, *When));
		List->AddSlot()[MakePersonRow(Recent.Person, Second, Actions)];
	}
	return List;
}

const FWonderlandSocialConversationRow* SWonderlandSocialHubPanel::FindDirect(const FString& UserId) const
{
	return Snapshot.Conversations.FindByPredicate([&UserId](const FWonderlandSocialConversationRow& C) { return C.Kind == TEXT("DIRECT") && C.OtherUserId == UserId; });
}

int32 SWonderlandSocialHubPanel::CountUnread() const
{
	int32 Unread = 0;
	for (const FWonderlandSocialConversationRow& C : Snapshot.Conversations)
	{
		Unread += C.Unread;
	}
	return Unread;
}

FString SWonderlandSocialHubPanel::NameOf(const FString& UserId) const
{
	if (UserId == Snapshot.ViewerId)
	{
		return TEXT("You");
	}
	// NOBODY THIS VIEWER MAY SEE: the server sends an empty id where the block wall hides somebody (a party's leaderId);
	// "led by " with nothing after it would itself say somebody is there.
	if (UserId.IsEmpty())
	{
		return TEXT("—");
	}
	const FString* Name = Snapshot.NamesById.Find(UserId);
	return Name != nullptr ? *Name : UserId;
}

void SWonderlandSocialHubPanel::OpenConversation(const FString& ConversationId)
{
	const bool bKnown = Snapshot.Conversations.ContainsByPredicate([&ConversationId](const FWonderlandSocialConversationRow& C) { return C.ConversationId == ConversationId; });
	OpenConversationId = bKnown ? ConversationId : (Snapshot.Conversations.Num() > 0 ? Snapshot.Conversations[0].ConversationId : FString());
	Rebuild();
}

bool SWonderlandSocialHubPanel::SendReply(const FString& Body)
{
	const FString Text = Body.TrimStartAndEnd();
	if (Text.IsEmpty() || OpenConversationId.IsEmpty())
	{
		return false;
	}
	OnSend.ExecuteIfBound(OpenConversationId, Text);
	return true;
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeConversationRow(const FWonderlandSocialConversationRow& Row)
{
	using namespace WonderlandSocialHubLook;
	ShownRows.Add(Row.ConversationId);
	const bool bOpen = Row.ConversationId == OpenConversationId;
	const FString Id = Row.ConversationId;
	const FString When = Ago(Row.LastMessageAtIso);
	return SNew(SBox).Padding(FMargin(0.0f, 3.0f))
		[
			SNew(SButton).ButtonStyle(&QuietStyle).IsFocusable(false).ContentPadding(0.0f)
			.OnClicked_Lambda([this, Id]() { OpenConversation(Id); return FReply::Handled(); })
			[
				SNew(SBorder).BorderImage(bOpen ? &RowSelectedBrush : &RowBrush).Padding(FMargin(10.0f, 8.0f))
				[
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 10.0f, 0.0f)
					[
						SNew(SWonderlandSocialAvatar).Size(36.0f).Seed(Row.OtherUserId.IsEmpty() ? Row.ConversationId : Row.OtherUserId)
						.Initial(Initial(Row.Title)).Ring(WonderlandUi::Ivory(0.30f))
					]
					+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
					[
						SNew(SVerticalBox)
						+ SVerticalBox::Slot().AutoHeight()
						[
							SNew(SHorizontalBox)
							+ SHorizontalBox::Slot().FillWidth(1.0f)
							[
								SNew(STextBlock).Text(T(Row.Title)).Font(WonderlandUi::Sans(11, Row.Unread > 0)).ColorAndOpacity(WonderlandUi::Cream())
							]
							+ SHorizontalBox::Slot().AutoWidth()
							[
								SNew(STextBlock).Text(T(When)).Font(WonderlandUi::Sans(8, false, 40)).ColorAndOpacity(WonderlandUi::Dim())
							]
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f, 0.0f, 0.0f)
						[
							SNew(STextBlock).Text(T(Row.LastMessagePreview)).Font(WonderlandUi::Sans(9, false, 20))
							.ColorAndOpacity(WonderlandUi::Cream(Row.Unread > 0 ? 0.88f : 0.55f))
						]
					]
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(8.0f, 0.0f, 0.0f, 0.0f)
					[
						SNew(SBorder).BorderImage(&BadgeBrush).Padding(FMargin(7.0f, 1.0f))
						.Visibility(Row.Unread > 0 ? EVisibility::Visible : EVisibility::Collapsed)
						[
							SNew(STextBlock).Text(T(FString::FromInt(Row.Unread))).Font(WonderlandUi::Sans(9, true)).ColorAndOpacity(WonderlandUi::Srgb(8, 10, 16))
						]
					]
				]
			]
		];
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeHistory()
{
	using namespace WonderlandSocialHubLook;
	const FWonderlandSocialConversationRow* Row = Snapshot.Conversations.FindByPredicate([this](const FWonderlandSocialConversationRow& C) { return C.ConversationId == OpenConversationId; });
	if (Row == nullptr)
	{
		return MakeEmpty(TEXT("No conversations yet. MESSAGE a friend from the Friends tab."));
	}
	const TArray<FWonderlandSocialMessage>* History = Snapshot.Messages.Find(Row->ConversationId);
	TSharedRef<SScrollBox> Lines = SNew(SScrollBox);
	if (History == nullptr || History->Num() == 0)
	{
		Lines->AddSlot()[MakeEmpty(TEXT("No messages yet."))];
	}
	else
	{
		for (const FWonderlandSocialMessage& M : *History)
		{
			// YOURS ON THE RIGHT, in gold; THEIRS ON THE LEFT -- with who and when on every line, never guessed.
			const bool bMine = M.SenderId == Snapshot.ViewerId;
			const FString Meta = FString::Printf(TEXT("%s  ·  %s"), *NameOf(M.SenderId), *Ago(M.SentAtIso));
			Lines->AddSlot().Padding(0.0f, 4.0f).HAlign(bMine ? HAlign_Right : HAlign_Left)
			[
				SNew(SBox).MaxDesiredWidth(560.0f)
				[
					SNew(SBorder).BorderImage(bMine ? &MineBrush : &TheirsBrush).Padding(FMargin(12.0f, 7.0f))
					[
						SNew(SVerticalBox)
						+ SVerticalBox::Slot().AutoHeight()
						[
							// A FIXED WRAP WIDTH: AutoWrapText inside a right-aligned scroll slot wrapped two-word lines ("hello from / kai").
							SNew(STextBlock).Text(T(M.Body)).Font(WonderlandUi::Sans(11)).ColorAndOpacity(WonderlandUi::Cream()).WrapTextAt(520.0f)
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 3.0f, 0.0f, 0.0f).HAlign(bMine ? HAlign_Right : HAlign_Left)
						[
							SNew(STextBlock).Text(T(Meta)).Font(WonderlandUi::Sans(8, false, 40)).ColorAndOpacity(WonderlandUi::Dim())
						]
					]
				]
			];
		}
		Lines->ScrollToEnd();
	}
	const FString With = Row->OtherUserId;
	return SNew(SVerticalBox)
		// the conversation's bar: who it is with, and their profile
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 8.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
			[
				SNew(STextBlock).Text(T(Row->Title)).Font(WonderlandUi::Sans(13, true)).ColorAndOpacity(WonderlandUi::Cream())
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
			[
				With.IsEmpty() ? StaticCastSharedRef<SWidget>(SNew(SBox)) : MakeProfileButton(With)
			]
		]
		+ SVerticalBox::Slot().FillHeight(1.0f)
		[
			SNew(SBorder).BorderImage(&RailBrush).Padding(12.0f)
			[
				Lines
			]
		]
		// the reply: the service sends it, or says why not
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 8.0f, 0.0f, 0.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
			[
				SAssignNew(ReplyBox, SEditableTextBox)
				.HintText(T(bDevelopmentPreview ? FString(TEXT("DEVELOPMENT PREVIEW: replies are refused")) : FString::Printf(TEXT("Message %s"), *Row->Title)))
				.Font(WonderlandUi::Sans(11))
				.OnTextCommitted_Lambda([this](const FText& Text, ETextCommit::Type How)
				{
					if (How == ETextCommit::OnEnter && SendReply(Text.ToString()) && ReplyBox.IsValid())
					{
						ReplyBox->SetText(FText::GetEmpty());
					}
				})
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(8.0f, 0.0f, 0.0f, 0.0f)
			[
				SNew(SButton).ButtonStyle(&ButtonStyle).IsFocusable(false)
				.OnClicked_Lambda([this]()
				{
					if (ReplyBox.IsValid() && SendReply(ReplyBox->GetText().ToString()))
					{
						ReplyBox->SetText(FText::GetEmpty());
					}
					return FReply::Handled();
				})
				[
					SNew(STextBlock).Text(T(TEXT("SEND"))).Font(WonderlandUi::Sans(9, true, 150)).ColorAndOpacity(WonderlandUi::Cream(0.92f))
				]
			]
		];
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeMessages()
{
	using namespace WonderlandSocialHubLook;
	TSharedRef<SScrollBox> Inbox = SNew(SScrollBox);
	Inbox->AddSlot().Padding(0.0f, 0.0f, 0.0f, 6.0f)[MakeSectionTitle(TEXT("CONVERSATIONS"), Snapshot.Conversations.Num())];
	if (Snapshot.Conversations.Num() == 0)
	{
		Inbox->AddSlot()[MakeEmpty(TEXT("Nothing here yet."))];
	}
	for (const FWonderlandSocialConversationRow& Row : Snapshot.Conversations)
	{
		Inbox->AddSlot()[MakeConversationRow(Row)];
	}
	return SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().AutoWidth()
		[
			SNew(SBox).WidthOverride(330.0f)[Inbox]
		]
		+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(14.0f, 0.0f, 0.0f, 0.0f)
		[
			MakeHistory()
		];
}

const FWonderlandSocialPresence* SWonderlandSocialHubPanel::PresenceOf(const FString& UserId) const
{
	if (const FWonderlandSocialPersonRow* Friend = Snapshot.Friends.FindByPredicate([&UserId](const FWonderlandSocialPersonRow& R) { return R.UserId == UserId; }))
	{
		return &Friend->Presence;
	}
	if (const FWonderlandSocialProfileView* Profile = Snapshot.Profiles.Find(UserId))
	{
		return &Profile->Presence;
	}
	return UserId == Snapshot.ViewerId ? &Snapshot.Self.Presence : nullptr;
}

void SWonderlandSocialHubPanel::SetSnapshot(const FWonderlandSocialSnapshot& InSnapshot, bool bInConnected, const FString& InSourceLine, bool bInPreview)
{
	Snapshot = InSnapshot;
	bConnected = bInConnected;
	SourceLine = InSourceLine;
	bDevelopmentPreview = bInPreview;
	if (SourceText.IsValid())
	{
		SourceText->SetText(FText::FromString(SourceLine));
	}
	if (!Snapshot.Conversations.ContainsByPredicate([this](const FWonderlandSocialConversationRow& C) { return C.ConversationId == OpenConversationId; }))
	{
		OpenConversationId = Snapshot.Conversations.Num() > 0 ? Snapshot.Conversations[0].ConversationId : FString();
	}
	RequestRebuild();   // F-21: never at once from a refresh (FlushRebuild says why)
}

void SWonderlandSocialHubPanel::SetSignIn(const FWonderlandSignInView& InView)
{
	SignIn = InView;
}

void SWonderlandSocialHubPanel::SetVoice(const FWonderlandVoiceState& State, const FString& Label)
{
	Voice = State;
	VoiceLabel = Label;
	if (Tab == ETab::Party)
	{
		RequestRebuild();   // F-21: every talking on/off lands here; a rebuild at once could eat MUTE MIC
	}
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeVoiceButton(const FString& Label, const FString& Command, const FString& Subject, bool bAllowed, bool bQuiet)
{
	using namespace WonderlandSocialHubLook;
	return SNew(SBox).Padding(FMargin(3.0f, 0.0f))
		[
			SNew(SButton).ButtonStyle(bQuiet ? &QuietStyle : &ButtonStyle).IsFocusable(false).IsEnabled(bAllowed)
			.OnClicked_Lambda([this, Command, Subject]() { OnVoice.ExecuteIfBound(Command, Subject); return FReply::Handled(); })
			[
				SNew(STextBlock).Text(T(Label)).Font(WonderlandUi::Sans(bQuiet ? 8 : 9, true, 150))
				.ColorAndOpacity(bQuiet ? WonderlandUi::Dim(bAllowed ? 1.0f : 0.35f) : WonderlandUi::Cream(bAllowed ? 0.92f : 0.35f))
			]
		];
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeMemberRow(const FWonderlandSocialPartyMember& Member)
{
	using namespace WonderlandSocialHubLook;
	const FWonderlandSocialParty& P = Snapshot.Party;
	const bool bSelf = Member.UserId == Snapshot.ViewerId;
	const bool bLeader = Member.Role == TEXT("LEADER");
	FWonderlandSocialPersonRow Row;
	Row.UserId = Member.UserId;
	Row.DisplayName = NameOf(Member.UserId);
	if (const FWonderlandSocialPresence* Presence = PresenceOf(Member.UserId))
	{
		Row.Presence = *Presence;
	}
	const FString Second = FString::Printf(TEXT("%s%s"), bLeader ? TEXT("LEADER") : TEXT("MEMBER"), Member.bSelfMuted ? TEXT("  ·  MIC OFF") : TEXT(""));
	// LEADER CONTROLS on everyone but the leader themself; the authority re-checks every one of them.
	const bool bControl = P.bViewerIsLeader && !bSelf;
	TSharedRef<SWidget> Actions = SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().AutoWidth()[MakeProfileButton(Member.UserId)]
		+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("PROMOTE"), TEXT("parties.promote"), Member.UserId, bControl, true)]
		+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("REMOVE"), TEXT("parties.remove_member"), Member.UserId, bControl, true)];
	return MakePersonRow(Row, Second, Actions);
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeVisiblePartyRow(const FWonderlandSocialParty& Party)
{
	using namespace WonderlandSocialHubLook;
	ShownRows.Add(Party.PartyId);
	TArray<FString> Names;
	for (const FWonderlandSocialPartyMember& M : Party.Members)
	{
		Names.Add(NameOf(M.UserId));
	}
	// JOIN only where the leader's rule lets a friend in; an invite-only party says so rather than offering a button that
	// would only be refused.
	const bool bOpen = Party.Privacy == TEXT("OPEN_TO_FRIENDS");
	return SNew(SBox).Padding(FMargin(0.0f, 3.0f))
		[
			SNew(SBorder).BorderImage(&RowBrush).Padding(FMargin(12.0f, 9.0f))
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(STextBlock).Text(T(Party.Name)).Font(WonderlandUi::Sans(12, true)).ColorAndOpacity(WonderlandUi::Cream())
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 3.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock).Text(T(FString::Printf(TEXT("led by %s  ·  %d in party: %s  ·  %s"), *NameOf(Party.LeaderId), Party.Members.Num(),
							*FString::Join(Names, TEXT(", ")), bOpen ? TEXT("open to friends") : TEXT("invite only"))))
						.Font(WonderlandUi::Sans(9, false, 40)).ColorAndOpacity(WonderlandUi::Dim())
					]
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					MakeButton(TEXT("JOIN"), TEXT("parties.join"), Party.PartyId, bOpen && !Party.bViewerIsMember)
				]
			]
		];
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeVoice()
{
	using namespace WonderlandSocialHubLook;
	const FString& C = Voice.Connection;
	const FLinearColor Dot = C == TEXT("CONNECTED") ? WonderlandUi::Green() : (C == TEXT("CONNECTING") || C == TEXT("RECONNECTING")) ? WonderlandUi::Gold()
		: C == TEXT("FAILED") ? WonderlandUi::Coral() : WonderlandUi::Faint();
	const bool bPreview = !VoiceLabel.IsEmpty();
	const bool bConnectedish = C == TEXT("CONNECTED") || C == TEXT("CONNECTING") || C == TEXT("RECONNECTING");
	const FWonderlandVoiceParticipant* Me = Voice.Participants.FindByPredicate([this](const FWonderlandVoiceParticipant& V) { return V.UserId == Snapshot.ViewerId; });
	const bool bMicMuted = Me != nullptr && Me->bMicMuted;
	TSharedRef<SVerticalBox> People = SNew(SVerticalBox);
	for (const FWonderlandVoiceParticipant& V : Voice.Participants)
	{
		// WHAT EACH CHIP SAYS is what the provider reported, never inferred: SPEAKING, MIC OFF, MUTED BY YOU, not connected.
		TArray<FString> Chips;
		if (!V.bConnected) Chips.Add(TEXT("not connected"));
		if (V.bSpeaking) Chips.Add(TEXT("SPEAKING"));
		if (V.bMicMuted) Chips.Add(TEXT("MIC OFF"));
		if (V.bMutedLocally) Chips.Add(TEXT("MUTED BY YOU"));
		const bool bSelf = V.UserId == Snapshot.ViewerId;
		People->AddSlot().AutoHeight().Padding(0.0f, 3.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 8.0f, 0.0f)
			[
				SNew(SWonderlandSocialAvatar).Size(30.0f).Seed(V.UserId).Initial(Initial(NameOf(V.UserId)))
				.Ring(V.bSpeaking ? WonderlandUi::Gold() : WonderlandUi::Ivory(V.bConnected ? 0.30f : 0.10f))
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(STextBlock).Text(T(NameOf(V.UserId))).Font(WonderlandUi::Sans(10, true)).ColorAndOpacity(WonderlandUi::Cream(V.bConnected ? 1.0f : 0.55f))
				]
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(STextBlock).Text(T(FString::Join(Chips, TEXT("  ·  ")))).Font(WonderlandUi::Sans(8, true, 80))
					.ColorAndOpacity(V.bSpeaking ? WonderlandUi::Gold() : WonderlandUi::Dim())
				]
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
			[
				bSelf ? StaticCastSharedRef<SWidget>(SNew(SBox))
					: MakeVoiceButton(V.bMutedLocally ? TEXT("UNMUTE") : TEXT("MUTE"), V.bMutedLocally ? TEXT("local.unmute") : TEXT("local.mute"), V.UserId, bConnectedish, true)
			]
		];
	}
	if (Voice.Participants.Num() == 0)
	{
		People->AddSlot().AutoHeight()[MakeEmpty(TEXT("Nobody in voice."))];
	}
	return SNew(SBorder).BorderImage(&RailBrush).Padding(12.0f)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()[MakeSectionTitle(TEXT("PARTY VOICE"), Voice.Participants.Num())]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 8.0f, 0.0f, 0.0f)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 6.0f, 0.0f)
				[
					SNew(STextBlock).Text(T(TEXT("●"))).Font(WonderlandUi::Sans(10)).ColorAndOpacity(Dot)
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(T(C.IsEmpty() ? FString(TEXT("UNAVAILABLE")) : C)).Font(WonderlandUi::Sans(11, true, 120)).ColorAndOpacity(WonderlandUi::Cream())
				]
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 3.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Text(T(FString::Printf(TEXT("%s%s"), Voice.ProviderId.IsEmpty() ? TEXT("no voice provider") : *FString::Printf(TEXT("provider: %s"), *Voice.ProviderId),
					Voice.Detail.IsEmpty() ? TEXT("") : *FString::Printf(TEXT("  ·  %s"), *Voice.Detail))))
				.Font(WonderlandUi::Sans(9, false, 40)).ColorAndOpacity(WonderlandUi::Dim()).AutoWrapText(true)
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 0.0f)
			[
				SNew(SBorder).BorderImage(&PreviewBrush).Padding(FMargin(8.0f, 3.0f)).Visibility(bPreview ? EVisibility::Visible : EVisibility::Collapsed)
				[
					SNew(STextBlock).Text(T(VoiceLabel)).Font(WonderlandUi::Sans(8, true, 100)).ColorAndOpacity(WonderlandUi::Cream()).AutoWrapText(true)
				]
			]
			+ SVerticalBox::Slot().FillHeight(1.0f).Padding(0.0f, 10.0f, 0.0f, 0.0f)
			[
				SNew(SScrollBox) + SScrollBox::Slot()[People]
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 8.0f, 0.0f, 0.0f).HAlign(HAlign_Right)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth()
				[
					// a room HELD after a refused leave still offers LEAVE VOICE (Second's RC13 review C1: FAILED showed JOIN VOICE, which the
					// held room refused -- a dead instruction)
					(bConnectedish || Voice.bRoomHeld) ? MakeVoiceButton(TEXT("LEAVE VOICE"), TEXT("disconnect"), FString(), true)
						: MakeVoiceButton(TEXT("JOIN VOICE"), TEXT("connect"), Snapshot.Party.PartyId, Snapshot.bHasParty)
				]
				+ SHorizontalBox::Slot().AutoWidth()
				[
					MakeVoiceButton(bMicMuted ? TEXT("UNMUTE MIC") : TEXT("MUTE MIC"), bMicMuted ? TEXT("mic.unmute") : TEXT("mic.mute"), FString(), bConnectedish)
				]
				+ SHorizontalBox::Slot().AutoWidth()
				[
					SNew(SBox).Visibility(bPreview ? EVisibility::Visible : EVisibility::Collapsed)
					[
						MakeVoiceButton(TEXT("NEXT EXAMPLE"), TEXT("preview.step"), FString(), true, true)
					]
				]
			]
		];
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeParty()
{
	using namespace WonderlandSocialHubLook;
	TSharedRef<SScrollBox> List = SNew(SScrollBox);
	if (Snapshot.bHasParty)
	{
		const FWonderlandSocialParty& P = Snapshot.Party;
		ShownRows.Add(P.PartyId);
		const bool bOpen = P.Privacy == TEXT("OPEN_TO_FRIENDS");
		List->AddSlot().Padding(0.0f, 0.0f, 0.0f, 4.0f)
		[
			SNew(STextBlock).Text(T(P.Name.IsEmpty() ? FString(TEXT("YOUR PARTY")) : P.Name)).Font(WonderlandUi::Sans(16, true)).ColorAndOpacity(WonderlandUi::Cream())
		];
		List->AddSlot().Padding(0.0f, 0.0f, 0.0f, 10.0f)
		[
			SNew(STextBlock).Text(T(FString::Printf(TEXT("%s  ·  %s  ·  %s"), P.bViewerIsLeader ? TEXT("you lead") : *FString::Printf(TEXT("led by %s"), *NameOf(P.LeaderId)),
				bOpen ? TEXT("open to friends") : TEXT("invite only"), P.InvitePermission == TEXT("ANY_MEMBER") ? TEXT("anyone may invite") : TEXT("the leader invites"))))
			.Font(WonderlandUi::Sans(9, true, 80)).ColorAndOpacity(WonderlandUi::Dim())
		];
		List->AddSlot().Padding(0.0f, 0.0f, 0.0f, 6.0f)[MakeSectionTitle(TEXT("MEMBERS"), P.Members.Num())];
		for (const FWonderlandSocialPartyMember& Member : P.Members)
		{
			List->AddSlot()[MakeMemberRow(Member)];
		}
		// THE PARTY'S CONTROLS: leave (anyone), the rules (the leader).
		List->AddSlot().Padding(0.0f, 10.0f, 0.0f, 0.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("LEAVE PARTY"), TEXT("parties.leave"), P.PartyId, true)]
			+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("OPEN TO FRIENDS"), TEXT("parties.rules"), TEXT("OPEN_TO_FRIENDS"), P.bViewerIsLeader && !bOpen, true)]
			+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("INVITE ONLY"), TEXT("parties.rules"), TEXT("INVITE_ONLY"), P.bViewerIsLeader && bOpen, true)]
		];
		// INVITE FRIENDS who are not in it yet, if this viewer may invite at all.
		TArray<const FWonderlandSocialPersonRow*> Outside;
		for (const FWonderlandSocialPersonRow* Row : SortedFriends())
		{
			if (!P.Members.ContainsByPredicate([Row](const FWonderlandSocialPartyMember& M) { return M.UserId == Row->UserId; }))
			{
				Outside.Add(Row);
			}
		}
		List->AddSlot().Padding(0.0f, 16.0f, 0.0f, 6.0f)[MakeSectionTitle(TEXT("INVITE FRIENDS"), Outside.Num())];
		if (!P.bViewerMayInvite)
		{
			List->AddSlot()[MakeEmpty(TEXT("Only the leader invites in this party."))];
		}
		for (const FWonderlandSocialPersonRow* Row : Outside)
		{
			List->AddSlot()[MakePersonRow(*Row, FString(), MakeButton(TEXT("INVITE"), TEXT("parties.invite"), Row->UserId, P.bViewerMayInvite && Row->Presence.Can.bInviteToParty))];
		}
	}
	else
	{
		List->AddSlot().Padding(0.0f, 0.0f, 0.0f, 8.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
			[
				SNew(STextBlock).Text(T(TEXT("You are not in a party."))).Font(WonderlandUi::Sans(13, true)).ColorAndOpacity(WonderlandUi::Cream())
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[MakeButton(TEXT("CREATE PARTY"), TEXT("parties.create"), FString(), true)]
		];
		if (Snapshot.PartyInvites.Num() > 0)
		{
			List->AddSlot().Padding(0.0f, 0.0f, 0.0f, 8.0f)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(T(FString::Printf(TEXT("%d party invitation%s waiting"), Snapshot.PartyInvites.Num(), Snapshot.PartyInvites.Num() == 1 ? TEXT("") : TEXT("s"))))
					.Font(WonderlandUi::Sans(10, false, 40)).ColorAndOpacity(WonderlandUi::Gold())
				]
				+ SHorizontalBox::Slot().AutoWidth()
				[
					SNew(SButton).ButtonStyle(&QuietStyle).IsFocusable(false)
					.OnClicked_Lambda([this]() { SetTab(ETab::Requests); return FReply::Handled(); })
					[
						SNew(STextBlock).Text(T(TEXT("SEE REQUESTS"))).Font(WonderlandUi::Sans(8, true, 150)).ColorAndOpacity(WonderlandUi::Dim())
					]
				]
			];
		}
		List->AddSlot().Padding(0.0f, 10.0f, 0.0f, 6.0f)[MakeSectionTitle(TEXT("FRIENDS' PARTIES"), Snapshot.VisibleParties.Num())];
		if (Snapshot.VisibleParties.Num() == 0)
		{
			List->AddSlot()[MakeEmpty(TEXT("None of your friends is in a party you can see."))];
		}
		for (const FWonderlandSocialParty& Party : Snapshot.VisibleParties)
		{
			List->AddSlot()[MakeVisiblePartyRow(Party)];
		}
	}
	return SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().FillWidth(1.0f)[List]
		+ SHorizontalBox::Slot().AutoWidth().Padding(14.0f, 0.0f, 0.0f, 0.0f)
		[
			SNew(SBox).WidthOverride(340.0f)[MakeVoice()]
		];
}

FReply SWonderlandSocialHubPanel::OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	if (InKeyEvent.GetKey() == EKeys::Escape)
	{
		OnRequestClose.ExecuteIfBound();
		return FReply::Handled();
	}
	return SCompoundWidget::OnKeyDown(MyGeometry, InKeyEvent);
}

void SWonderlandSocialHubPanel::ShowActionResult(const FString& Line)
{
	LastActionLine = Line;
	if (ActionLineText.IsValid())
	{
		ActionLineText->SetText(FText::FromString(Line));
	}
}

FString SWonderlandSocialHubPanel::Describe() const
{
	const TArray<FWonderlandSocialMessage>* History = Snapshot.Messages.Find(OpenConversationId);
	return FString::Printf(TEXT("tab %s | %s | friends %d (%d on) | requests in %d out %d | party invites %d | recent %d | conversations %d (unread %d) | open %s (%d messages) | party %s (%d members%s) | visible parties %d | voice %s%s | rows %s | action: %s | signin %s%s"),
		TabName(Tab), bConnected ? (bDevelopmentPreview ? TEXT("DEVELOPMENT PREVIEW") : TEXT("connected")) : TEXT("NOT CONNECTED"),
		Snapshot.Friends.Num(), CountOn(), Snapshot.IncomingRequests.Num(), Snapshot.OutgoingRequests.Num(), Snapshot.PartyInvites.Num(),
		Snapshot.RecentPlayers.Num(), Snapshot.Conversations.Num(), CountUnread(), OpenConversationId.IsEmpty() ? TEXT("none") : *OpenConversationId,
		History != nullptr ? History->Num() : 0,
		Snapshot.bHasParty ? *Snapshot.Party.Name : TEXT("none"), Snapshot.bHasParty ? Snapshot.Party.Members.Num() : 0,
		Snapshot.bHasParty ? *FString::Printf(TEXT(", leader %s%s"), *Snapshot.Party.LeaderId, Snapshot.Party.bViewerIsLeader ? TEXT(" (you)") : TEXT("")) : TEXT(""),
		Snapshot.VisibleParties.Num(), Voice.Connection.IsEmpty() ? TEXT("UNAVAILABLE") : *Voice.Connection,
		VoiceLabel.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" [%s]"), *VoiceLabel), ShownRows.Num() > 0 ? *FString::Join(ShownRows, TEXT(",")) : TEXT("none"), *LastActionLine,
		FWonderlandSocialSignIn::StateName(SignIn.State), SignIn.State == EWonderlandSignInState::Waiting ? *FString::Printf(TEXT(" (code %d chars)"), SignIn.UserCode.Len()) : TEXT(""));
}

TArray<FWonderlandSocialPersonRow> WonderlandSocialBlocked::BlockedByViewer(const FWonderlandSocialSnapshot& Snapshot)
{
	TArray<FWonderlandSocialPersonRow> Out;
	for (const TPair<FString, FWonderlandSocialProfileView>& Entry : Snapshot.Profiles)
	{
		const FWonderlandSocialProfileView& View = Entry.Value;
		if (View.Relationship != TEXT("BLOCKED"))
		{
			continue;   // BLOCKED_BY, FRIEND, NONE...: not this list (who blocked the viewer is never shown)
		}
		FWonderlandSocialPersonRow Row;
		Row.UserId = View.Profile.UserId.IsEmpty() ? Entry.Key : View.Profile.UserId;
		Row.DisplayName = View.Profile.DisplayName;
		Row.Handle = View.Profile.Handle;
		Row.AvatarRef = View.Profile.AvatarRef;
		// NOTHING THE SERVER SENT ABOUT THEIR PRESENCE IS SHOWN: the wall hides each from the other, so the row says "presence hidden".
		Row.Presence = FWonderlandSocialPresence();
		Row.Presence.RestrictedReason = TEXT("BLOCKED");
		Out.Add(MoveTemp(Row));
	}
	Out.StableSort([](const FWonderlandSocialPersonRow& A, const FWonderlandSocialPersonRow& B)
	{
		const int32 ByName = A.DisplayName.Compare(B.DisplayName, ESearchCase::IgnoreCase);
		return ByName != 0 ? ByName < 0 : A.UserId < B.UserId;
	});
	return Out;
}

namespace WonderlandSocialBlockedQa
{
	/** D3 (b) QA, the founder's "fail-capable client test" (10-06). The BLOCKED BY YOU list holds exactly the players the viewer blocked;
	 *  UB2 is a control: BLOCKED_BY is fed and must not appear. The list hides their presence, and UNBLOCK's operation is one the client
	 *  dispatches; UB5's control: an unknown op is refused. UB6 and UB7 prove the checks themselves can FAIL: the same predicates read
	 *  FAIL on a deliberately wrong list and on a row that leaks ONLINE. Fed snapshots, a throwaway service on a dead loopback port.
	 *  WLQA UNBLOCK lines. */
	FAutoConsoleCommand GQaSocialBlocked(
		TEXT("wl.Qa.SocialBlocked"),
		TEXT("QA: the FRIENDS tab's BLOCKED BY YOU list and UNBLOCK's operation -- fed snapshots, with fail-capable controls."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			int32 Passed = 0;
			int32 Failed = 0;
			auto Check = [&Passed, &Failed](const FString& Id, bool bOk, const FString& What)
			{
				(bOk ? Passed : Failed) += 1;
				UE_LOG(LogTemp, Display, TEXT("WLQA UNBLOCK %s %s -- %s"), *Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *What);
			};
			auto Person = [](const TCHAR* Id, const TCHAR* Name, const TCHAR* Relationship)
			{
				FWonderlandSocialProfileView View;
				View.Profile.UserId = Id;
				View.Profile.DisplayName = Name;
				View.Relationship = Relationship;
				View.Presence.OnlineState = TEXT("ONLINE");   // what a careless server might send: it must never reach the row
				return View;
			};
			auto ListIsRight = [](const TArray<FString>& List)
			{
				return FString::Join(List, TEXT(",")) == TEXT("qa-amy,qa-zed") && !List.Contains(TEXT("qa-blocker"));
			};
			auto Hidden = [](const FWonderlandSocialPersonRow& R)
			{
				return R.Presence.RestrictedReason == TEXT("BLOCKED") && R.Presence.OnlineState.IsEmpty();
			};
			FWonderlandSocialSnapshot Fed;
			Fed.Profiles.Add(TEXT("qa-friend"), Person(TEXT("qa-friend"), TEXT("Fern"), TEXT("FRIEND")));
			Fed.Profiles.Add(TEXT("qa-zed"), Person(TEXT("qa-zed"), TEXT("zed"), TEXT("BLOCKED")));
			Fed.Profiles.Add(TEXT("qa-amy"), Person(TEXT("qa-amy"), TEXT("Amy"), TEXT("BLOCKED")));
			Fed.Profiles.Add(TEXT("qa-blocker"), Person(TEXT("qa-blocker"), TEXT("Bea"), TEXT("BLOCKED_BY")));
			Fed.Profiles.Add(TEXT("qa-none"), Person(TEXT("qa-none"), TEXT("Nia"), TEXT("NONE")));
			const TArray<FWonderlandSocialPersonRow> Rows = WonderlandSocialBlocked::BlockedByViewer(Fed);
			TArray<FString> Ids;
			for (const FWonderlandSocialPersonRow& R : Rows) { Ids.Add(R.UserId); }
			const FString Got = FString::Join(Ids, TEXT(","));
			Check(TEXT("UB1"), ListIsRight(Ids), FString::Printf(TEXT("the viewer's two blocks, by name (Amy, zed): got [%s]"), *Got));
			Check(TEXT("UB2"), !Ids.Contains(TEXT("qa-blocker")) && !Ids.Contains(TEXT("qa-friend")) && !Ids.Contains(TEXT("qa-none")),
				TEXT("control: BLOCKED_BY (fed) never appears, nor a friend or a stranger"));
			bool bHidden = Rows.Num() > 0;
			for (const FWonderlandSocialPersonRow& R : Rows) { bHidden = bHidden && Hidden(R); }
			Check(TEXT("UB3"), bHidden, TEXT("every row's presence is hidden (RestrictedReason BLOCKED, no online state), though ONLINE was fed"));
			Check(TEXT("UB4"), WonderlandSocialBlocked::BlockedByViewer(FWonderlandSocialSnapshot()).Num() == 0, TEXT("no blocks: no rows (the list is not drawn)"));
			TUniquePtr<FWonderlandSocialLiveService> Probe = MakeUnique<FWonderlandSocialLiveService>(TEXT("http://127.0.0.1:9"), TEXT("qa-unblock"));
			const FWonderlandSocialActionResult Known = Probe->Request(TEXT("blocks.remove"), TEXT("qa-zed"));
			const FWonderlandSocialActionResult Unknown = Probe->Request(TEXT("blocks.nonsense"), TEXT("qa-zed"));
			Check(TEXT("UB5"), Known.bOk && Known.bPending && !Unknown.bOk && Unknown.Reason.Contains(TEXT("not a social action")),
				FString::Printf(TEXT("UNBLOCK's blocks.remove is dispatched (pending); control: an unknown op is refused ('%s')"), *Unknown.Reason));
			Probe.Reset();
			// UB6 / UB7 THE CHECKS CAN FAIL: a predicate that passed everything would pass the wrong inputs here too
			TArray<FString> Wrong = Ids;
			Wrong.Add(TEXT("qa-blocker"));
			Check(TEXT("UB6"), ListIsRight(Ids) && !ListIsRight(Wrong), TEXT("control: the list check passes the right list and FAILS a wrong one (BLOCKED_BY added)"));
			FWonderlandSocialPersonRow Leaky;
			Leaky.Presence.OnlineState = TEXT("ONLINE");
			Check(TEXT("UB7"), !Hidden(Leaky), TEXT("control: the presence check FAILS a row that shows ONLINE"));
			UE_LOG(LogTemp, Display, TEXT("WLQA UNBLOCK END pass=%d fail=%d"), Passed, Failed);
		}));
}

namespace WonderlandSocialHubClicksQa
{
	/** F-21 QA (2026-10-07), fail-capable, through Slate's own routing (the path a real click takes). A refresh that lands just
	 *  before a click must not eat it:
	 *    HC0 the hub opens on REQUESTS (a player session: NOT CONNECTED still draws its tabs);
	 *    HCP the probe's own control: with nothing rebuilt, its click on FRIENDS LANDS (HC4 counts only when it does);
	 *    HC1 the real refresh path (HandleSocialChanged, as every live snapshot calls it) DEFERS the rebuild;
	 *    HC2 a click on FRIENDS routed right after that refresh, before any paint, LANDS;
	 *    HC3 a refresh with no click after it: Slate's pre-tick runs its rebuild BY ITSELF, frames later (the hook is wired);
	 *    HC4 CONTROL: a rebuild AT ONCE (SetSnapshot before F-21), then the same click: it is LOST. So the probe can fail, and this
	 *        is how the 2026-10-07 drive lost its FRIENDS click;
	 *    HC5 the voice path (SetVoice on PARTY, which every talking on/off calls) defers too;
	 *    HC6 on an OFF-SCREEN panel fed one conversation, a draft in the reply box survives a refresh's rebuild;
	 *    HC7 control: the draft is not carried to ANOTHER conversation.
	 *  The core ticker runs this AFTER the frame's paint, exactly where HTTP answers and EOS callbacks land. The ticker sends
	 *  synthetic pointer events only (no OS input) and does not quit. WLQA HUBCLICK lines. */
	struct FHubClickRun
	{
		TWeakObjectPtr<UWorld> World;
		int32 Phase = 0;
		double At = 0.0;
		int32 Passed = 0;
		int32 Failed = 0;
		/** HC3: was a rebuild pending right after the refresh (before Slate's pre-tick had a chance)? */
		bool bRefreshPending = false;
		/** HCP: the probe lands a click when nothing is rebuilt (without it, HC4's "lost" proves nothing). */
		bool bProbeLands = false;
	};
	TSharedPtr<FHubClickRun> GHubClickRun;

	void HubClickCheck(FHubClickRun& ClickRun, const TCHAR* Id, bool bOk, const FString& What)
	{
		(bOk ? ClickRun.Passed : ClickRun.Failed) += 1;
		UE_LOG(LogTemp, Display, TEXT("WLQA HUBCLICK %s %s -- %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *What);
	}

	/** The pointer arrives over a spot and rests there, as a player's cursor does before they click. */
	void HubClickHover(const FVector2D& ClickSpot)
	{
		const FPointerEvent PointerArrive(0, FSlateApplicationBase::CursorPointerIndex, ClickSpot, ClickSpot, TSet<FKey>(), FKey(), 0.0f, FModifierKeysState());
		FSlateApplication::Get().ProcessMouseMoveEvent(PointerArrive);
	}

	/** The press and the release, routed by Slate through the hit-test grid of the LAST paint, as a real click is. */
	void HubClickPress(const FVector2D& ClickSpot)
	{
		TSet<FKey> HeldButtons;
		HeldButtons.Add(EKeys::LeftMouseButton);
		const FPointerEvent PointerPress(0, FSlateApplicationBase::CursorPointerIndex, ClickSpot, ClickSpot, HeldButtons, EKeys::LeftMouseButton, 0.0f, FModifierKeysState());
		FSlateApplication::Get().ProcessMouseButtonDownEvent(nullptr, PointerPress);
		const FPointerEvent PointerRelease(0, FSlateApplicationBase::CursorPointerIndex, ClickSpot, ClickSpot, TSet<FKey>(), EKeys::LeftMouseButton, 0.0f, FModifierKeysState());
		FSlateApplication::Get().ProcessMouseButtonUpEvent(PointerRelease);
	}

	UWonderlandUiSubsystem* HubClickUi(UWorld* World)
	{
		APlayerController* ClickController = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		ULocalPlayer* ClickPlayer = ClickController != nullptr ? ClickController->GetLocalPlayer() : nullptr;
		return ClickPlayer != nullptr ? ClickPlayer->GetSubsystem<UWonderlandUiSubsystem>() : nullptr;
	}

	void HubClickEnd()
	{
		if (GHubClickRun.IsValid())
		{
			UE_LOG(LogTemp, Display, TEXT("WLQA HUBCLICK END pass=%d fail=%d"), GHubClickRun->Passed, GHubClickRun->Failed);
		}
		GHubClickRun.Reset();
	}

	bool HubClickTick(float)
	{
		if (!GHubClickRun.IsValid())
		{
			return false;
		}
		FHubClickRun& ClickRun = *GHubClickRun;
		UWonderlandUiSubsystem* ClickUi = HubClickUi(ClickRun.World.Get());
		const double ClickSince = FPlatformTime::Seconds() - ClickRun.At;
		const auto NextPhase = [&ClickRun](int32 NewPhase) { ClickRun.Phase = NewPhase; ClickRun.At = FPlatformTime::Seconds(); };
		if (ClickUi == nullptr || !FSlateApplication::IsInitialized())
		{
			if (ClickSince > 120.0)
			{
				HubClickCheck(ClickRun, TEXT("HC0"), false, TEXT("no world, UI or Slate within 120 s"));
				HubClickEnd();
				return false;
			}
			return true;
		}
		const TSharedPtr<SWonderlandSocialHubPanel> ClickHub = ClickUi->GetOpenSocialHubForQa();
		if (ClickRun.Phase > 0 && !ClickHub.IsValid())
		{
			HubClickCheck(ClickRun, TEXT("HC0"), false, FString::Printf(TEXT("the hub closed under the test (phase %d)"), ClickRun.Phase));
			HubClickEnd();
			return false;
		}
		const SWonderlandSocialHubPanel::ETab TabFriends = SWonderlandSocialHubPanel::ETab::Friends;
		const SWonderlandSocialHubPanel::ETab TabRequests = SWonderlandSocialHubPanel::ETab::Requests;
		switch (ClickRun.Phase)
		{
		case 0:
			if (ClickSince >= 8.0)
			{
				ClickUi->DismissWelcome();
				ClickUi->CloseOverlay();
				const bool bClickHubOpened = ClickUi->OpenSocialHub(TEXT("requests"));
				const TSharedPtr<SWonderlandSocialHubPanel> OpenedHub = ClickUi->GetOpenSocialHubForQa();
				HubClickCheck(ClickRun, TEXT("HC0"), bClickHubOpened && OpenedHub.IsValid() && OpenedHub->GetTab() == TabRequests,
					FString::Printf(TEXT("the hub opened on REQUESTS: %s"), *ClickUi->DescribeOpenSocialHub()));
				if (!OpenedHub.IsValid())
				{
					HubClickEnd();
					return false;
				}
				NextPhase(10);
			}
			break;
		case 10:
			// HCP, the probe's own control: with NOTHING rebuilt, the probe's click on FRIENDS must land; then back to REQUESTS
			if (ClickSince >= 1.0)
			{
				FVector2D FriendsTabSpot;
				const bool bTabPainted = ClickHub->QaTabCentre(TabFriends, FriendsTabSpot);
				HubClickHover(FriendsTabSpot);
				HubClickPress(FriendsTabSpot);
				ClickRun.bProbeLands = bTabPainted && ClickHub->GetTab() == TabFriends;
				HubClickCheck(ClickRun, TEXT("HCP"), ClickRun.bProbeLands,
					FString::Printf(TEXT("control: the probe's click at %.0f,%.0f lands when nothing is rebuilt (tab now %s; SetTab's own line above)"),
						FriendsTabSpot.X, FriendsTabSpot.Y, SWonderlandSocialHubPanel::TabName(ClickHub->GetTab())));
				ClickHub->SetTab(TabRequests);
				NextPhase(1);
			}
			break;
		case 1:
			// HC1 + HC2: painted; the pointer rests on FRIENDS; a refresh lands; then the press and release, before any paint
			if (ClickSince >= 1.0)
			{
				FVector2D FriendsTabSpot;
				const bool bTabPainted = ClickHub->QaTabCentre(TabFriends, FriendsTabSpot);
				HubClickHover(FriendsTabSpot);
				ClickUi->RefreshOpenSocialHubForQa();
				const bool bRefreshDeferred = ClickHub->QaRebuildPending();
				HubClickPress(FriendsTabSpot);
				HubClickCheck(ClickRun, TEXT("HC1"), bTabPainted && bRefreshDeferred,
					FString::Printf(TEXT("a refresh (HandleSocialChanged, as every live snapshot calls it) left the rebuild for Slate's pre-tick (painted %s, pending %s)"),
						bTabPainted ? TEXT("yes") : TEXT("NO"), bRefreshDeferred ? TEXT("yes") : TEXT("NO")));
				HubClickCheck(ClickRun, TEXT("HC2"), bTabPainted && ClickHub->GetTab() == TabFriends,
					FString::Printf(TEXT("a click on FRIENDS at %.0f,%.0f right after that refresh LANDS (tab now %s)"), FriendsTabSpot.X, FriendsTabSpot.Y,
						SWonderlandSocialHubPanel::TabName(ClickHub->GetTab())));
				NextPhase(2);
			}
			break;
		case 2:
			// HC3, part one: a refresh with no click after it; nothing here flushes it (DescribeOpenSocialHub would)
			if (ClickSince >= 0.3)
			{
				ClickUi->RefreshOpenSocialHubForQa();
				ClickRun.bRefreshPending = ClickHub->QaRebuildPending();
				NextPhase(3);
			}
			break;
		case 3:
			// HC3, part two: some frames later Slate's pre-tick has run that rebuild by itself
			if (ClickSince >= 0.3)
			{
				const bool bRanByItself = ClickRun.bRefreshPending && !ClickHub->QaRebuildPending();
				const FString StillPending = ClickHub->QaRebuildPending() ? TEXT("STILL") : TEXT("no");
				HubClickCheck(ClickRun, TEXT("HC3"), bRanByItself && ClickUi->DescribeOpenSocialHub().StartsWith(TEXT("tab FRIENDS")),
					FString::Printf(TEXT("a refresh's rebuild runs by itself at Slate's pre-tick, frames later (pending after the refresh %s, now %s): %s"),
						ClickRun.bRefreshPending ? TEXT("yes") : TEXT("NO"), *StillPending, *ClickUi->DescribeOpenSocialHub()));
				ClickHub->SetTab(TabRequests);
				NextPhase(4);
			}
			break;
		case 4:
			// HC4 CONTROL: the pre-F-21 rebuild AT ONCE, then the same click
			if (ClickSince >= 1.0)
			{
				FVector2D FriendsTabSpot;
				const bool bTabPainted = ClickHub->QaTabCentre(TabFriends, FriendsTabSpot);
				HubClickHover(FriendsTabSpot);
				ClickHub->QaRebuildNow();
				HubClickPress(FriendsTabSpot);
				HubClickCheck(ClickRun, TEXT("HC4"), bTabPainted && ClickRun.bProbeLands && ClickHub->GetTab() == TabRequests,
					FString::Printf(TEXT("control: after a rebuild AT ONCE (SetSnapshot before F-21) the same click is LOST (tab still %s; the probe lands clicks: %s)"),
						SWonderlandSocialHubPanel::TabName(ClickHub->GetTab()), ClickRun.bProbeLands ? TEXT("yes") : TEXT("NO, so this proves nothing")));
				NextPhase(5);
			}
			break;
		case 5:
			if (ClickSince >= 0.3)
			{
				// HC5: the voice path defers too
				ClickHub->SetTab(SWonderlandSocialHubPanel::ETab::Party);
				ClickHub->SetVoice(FWonderlandVoiceState(), FString());
				const bool bVoiceDeferred = ClickHub->QaRebuildPending();
				ClickHub->FlushRebuild();
				HubClickCheck(ClickRun, TEXT("HC5"), bVoiceDeferred && !ClickHub->QaRebuildPending(),
					TEXT("a voice change on PARTY (SetVoice, which every talking on/off calls) leaves its rebuild for the pre-tick; FlushRebuild runs it"));
				// HC6 / HC7: an OFF-SCREEN panel fed two conversations (never drawn: no synthetic people on screen)
				FWonderlandSocialSnapshot FedInbox;
				FWonderlandSocialConversationRow InboxFirst;
				InboxFirst.ConversationId = TEXT("qa-conv-a");
				InboxFirst.Kind = TEXT("DIRECT");
				InboxFirst.Title = TEXT("Amy");
				FWonderlandSocialConversationRow InboxSecond = InboxFirst;
				InboxSecond.ConversationId = TEXT("qa-conv-b");
				InboxSecond.Title = TEXT("Bo");
				FedInbox.Conversations.Add(InboxFirst);
				FedInbox.Conversations.Add(InboxSecond);
				const TSharedRef<SWonderlandSocialHubPanel> OffScreenHub = SNew(SWonderlandSocialHubPanel)
					.Snapshot(FedInbox).bConnected(true).bDevelopmentPreview(false).InitialTab(SWonderlandSocialHubPanel::ETab::Messages);
				OffScreenHub->OpenConversation(TEXT("qa-conv-a"));
				const bool bDraftTyped = OffScreenHub->QaSetReplyText(TEXT("on my way"));
				OffScreenHub->SetSnapshot(FedInbox, true, FString(), false);   // a refresh lands while the player types
				OffScreenHub->FlushRebuild();
				const FString KeptDraftText = OffScreenHub->QaReplyText();
				HubClickCheck(ClickRun, TEXT("HC6"), bDraftTyped && KeptDraftText == TEXT("on my way"),
					FString::Printf(TEXT("a draft in the reply box survives a refresh's rebuild (typed %s, after: '%s')"), bDraftTyped ? TEXT("yes") : TEXT("NO"), *KeptDraftText));
				OffScreenHub->OpenConversation(TEXT("qa-conv-b"));
				HubClickCheck(ClickRun, TEXT("HC7"), bDraftTyped && OffScreenHub->QaReplyText().IsEmpty(),
					FString::Printf(TEXT("control: the draft is not carried to ANOTHER conversation (after: '%s')"), *OffScreenHub->QaReplyText()));
				ClickUi->CloseOverlay();
				HubClickEnd();
				return false;
			}
			break;
		default:
			break;
		}
		return true;
	}

	FAutoConsoleCommandWithWorldAndArgs GQaSocialHubClicks(
		TEXT("wl.Qa.SocialHubClicks"),
		TEXT("QA (F-21): a click survives a refresh that lands just before it (HC1-HC3), the old rebuild-at-once loses it (HC4, the control), ")
		TEXT("voice changes defer too (HC5), a reply's draft survives a rebuild (HC6, HC7 control). Synthetic pointer events through Slate; no OS input; does not quit."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GHubClickRun.IsValid())
			{
				return;
			}
			GHubClickRun = MakeShared<FHubClickRun>();
			GHubClickRun->World = World;
			GHubClickRun->At = FPlatformTime::Seconds();
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&HubClickTick), 0.1f);
			UE_LOG(LogTemp, Display, TEXT("WLQA HUBCLICK armed"));
		}));
}
