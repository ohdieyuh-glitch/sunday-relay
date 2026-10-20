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
#include "Dom/JsonObject.h"        // R16 CF-1 QA: the presence body is read back
#include "WonderlandWonderWeb.h"     // R16 CF-1 r2 QA: what counts as creating (WonderlandWonderWebShowsOwnCreation)
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

	void WorldControlOf(const FWonderlandSocialPresence& Own, FString& OutLabel, FString& OutOperationId, FString& OutSubject)
	{
		// IN A WORLD IS THE SERVER'S WORD: world.join sets the player's presence location and world.leave clears it (sunday-relay
		// social-commands.ts:674-677, :714), and the self view always carries the player's own location (social-presence.ts:210)
		// r2 (the privacy review's F6): "SHARED" -- the player stays in Golden Arrival on their own screen; what they leave is the shared
		// layer (the others stop seeing their Dog, and they the others'). Never "YOUR WORLD": that reads as a world they own (deferred).
		if (Own.bHasLocation)
		{
			OutLabel = TEXT("LEAVE SHARED WORLD");
			OutOperationId = TEXT("world.leave");
			OutSubject.Reset();
			return;
		}
		OutLabel = TEXT("REJOIN SHARED WORLD");
		OutOperationId = TEXT("world.join");
		OutSubject = TEXT("golden_arrival");
	}

	bool UnreadThroughOf(const FWonderlandSocialSnapshot& View, const FString& ConversationId, int64& OutThrough)
	{
		OutThrough = 0;
		const FWonderlandSocialConversationRow* Row = ConversationId.IsEmpty() ? nullptr
			: View.Conversations.FindByPredicate([&ConversationId](const FWonderlandSocialConversationRow& C) { return C.ConversationId == ConversationId; });
		if (Row == nullptr || Row->Unread <= 0)
		{
			return false;   // nothing unread (a muted sender's messages never count: social-conversations.ts:186-188)
		}
		if (const TArray<FWonderlandSocialMessage>* History = View.Messages.Find(ConversationId))
		{
			for (const FWonderlandSocialMessage& M : *History)
			{
				OutThrough = FMath::Max(OutThrough, M.Sequence);
			}
		}
		return OutThrough > 0;
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
	Lff = InArgs._Lff;
	OnOpenProfileView = InArgs._OnOpenProfileView;
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
	case ETab::Lff:      return TEXT("LFF");
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
	if (Text.Equals(TEXT("lff"), ESearchCase::IgnoreCase)) { Out = ETab::Lff; return true; }
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
			BodyHost->SetContent(Tab == ETab::Requests ? MakeRequests() : Tab == ETab::Recent ? MakeRecent() : Tab == ETab::Messages ? MakeMessages() : Tab == ETab::Party ? MakeParty()
				: Tab == ETab::Lff ? MakeLff() : MakeFriends());
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
	// R16 CF-2: what the player now SEES may be read (a conversation opened, a tab chosen, new messages landed in the open one)
	MarkShownConversationRead();
}

void SWonderlandSocialHubPanel::MarkShownConversationRead()
{
	// ONLY A LIVE HUB, ON MESSAGES, SHOWING A CONVERSATION: the preview's people are not read, and a hidden tab is not looking
	if (!bConnected || bDevelopmentPreview || Tab != ETab::Messages)
	{
		return;
	}
	int64 Through = 0;
	if (!WonderlandSocialHubLook::UnreadThroughOf(Snapshot, OpenConversationId, Through))
	{
		return;
	}
	// ONCE PER NEWEST MESSAGE: a refresh that changes nothing asks nothing, a new message asks again (a refused read is not repeated for
	// the same message; opening the hub again, or the conversation again after another, asks once more)
	if (ReadAskedConversationId == OpenConversationId && Through <= ReadAskedThrough)
	{
		return;
	}
	ReadAskedConversationId = OpenConversationId;
	ReadAskedThrough = Through;
	OnAction.ExecuteIfBound(TEXT("messages.read"), OpenConversationId);
}

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeRail()
{
	using namespace WonderlandSocialHubLook;
	const int32 Waiting = Snapshot.IncomingRequests.Num() + Snapshot.PartyInvites.Num();
	// R16 CF-3: SHARED WORLD, beside YOUR STATUS and drawn by the same rule (a live sign-in only)
	const EVisibility SignedInLive = bConnected && !bDevelopmentPreview && SignIn.State == EWonderlandSignInState::SignedIn ? EVisibility::Visible : EVisibility::Collapsed;
	FString WorldLabel;
	FString WorldOperation;
	FString WorldSubject;
	WorldControlOf(Snapshot.Self.Presence, WorldLabel, WorldOperation, WorldSubject);
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
		// LFF, THE LOOKING FOR FEED: a sixth tab, last -- content in the existing hub, no count (it is read only while it is shown)
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f)
		[
			MakeTabButton(ETab::Lff, TEXT("LFF"), FString())
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
		// SHARED WORLD (R16 CF-3, B34: the CONTEXT's leave and rejoin by the player's own click). Content in the existing rail, under YOUR
		// STATUS and in its style -- no new HUD panel, no anchor or size changed (memory: preserve HUD layout). LEAVE SHARED WORLD takes the
		// player out of the shared layer (the others see their Dog go); REJOIN SHARED WORLD joins the public world again, as signing in does.
		// Quiet, as SIGN OUT is (r2): in this rail the plain style means "the chosen one" (YOUR STATUS).
		+ SVerticalBox::Slot().AutoHeight().Padding(4.0f, 8.0f, 4.0f, 2.0f)
		[
			SNew(STextBlock).Visibility(SignedInLive).Text(T(TEXT("SHARED WORLD"))).Font(WonderlandUi::Sans(8, true, 120)).ColorAndOpacity(WonderlandUi::Dim())
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 1.0f)
		[
			SNew(SBox).Visibility(SignedInLive)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth()[ MakeButton(WorldLabel, WorldOperation, WorldSubject, true, true) ]
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

TSharedRef<SWidget> SWonderlandSocialHubPanel::MakeLff()
{
	if (!Lff.IsValid())
	{
		return MakeEmpty(TEXT("The Looking For Feed is not available here."));
	}
	// THE SAME VIEW ACROSS REBUILDS (the audit's risk 5): a live refresh rebuilds this hub every 2 s while anything happens, and a new view
	// would drop the keyboard focus and the cursor of whatever the player is typing. Only its context is updated; the model it draws (the
	// social subsystem's) holds the drafts for a hub opened again.
	if (!LffView.IsValid())
	{
		SAssignNew(LffView, SWonderlandSocialLffView).Model(Lff).ViewerId(Snapshot.ViewerId).bDevelopmentPreview(bDevelopmentPreview)
			.OnAction(OnAction).OnOpenProfileView(OnOpenProfileView);
	}
	else
	{
		LffView->SetContext(Snapshot.ViewerId, bDevelopmentPreview);
	}
	// THE TAB IS BEING SHOWN: its first read (or one it missed while hidden) starts now, not only at the view's first tick
	Lff->NoteOnScreen(FPlatformTime::Seconds());
	return LffView.ToSharedRef();
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
	// THE LFF TAB adds its model's state: ids and states only, never a post's text (the 10-07 log rule)
	const FString LffPart = Tab == ETab::Lff ? FString::Printf(TEXT(" | lff %s"), Lff.IsValid() ? *Lff->Describe() : TEXT("not available")) : FString();
	return FString::Printf(TEXT("tab %s | %s | friends %d (%d on) | requests in %d out %d | party invites %d | recent %d | conversations %d (unread %d) | open %s (%d messages) | party %s (%d members%s) | visible parties %d | voice %s%s | rows %s | action: %s | signin %s%s%s"),
		TabName(Tab), bConnected ? (bDevelopmentPreview ? TEXT("DEVELOPMENT PREVIEW") : TEXT("connected")) : TEXT("NOT CONNECTED"),
		Snapshot.Friends.Num(), CountOn(), Snapshot.IncomingRequests.Num(), Snapshot.OutgoingRequests.Num(), Snapshot.PartyInvites.Num(),
		Snapshot.RecentPlayers.Num(), Snapshot.Conversations.Num(), CountUnread(), OpenConversationId.IsEmpty() ? TEXT("none") : *OpenConversationId,
		History != nullptr ? History->Num() : 0,
		Snapshot.bHasParty ? *Snapshot.Party.Name : TEXT("none"), Snapshot.bHasParty ? Snapshot.Party.Members.Num() : 0,
		Snapshot.bHasParty ? *FString::Printf(TEXT(", leader %s%s"), *Snapshot.Party.LeaderId, Snapshot.Party.bViewerIsLeader ? TEXT(" (you)") : TEXT("")) : TEXT(""),
		Snapshot.VisibleParties.Num(), Voice.Connection.IsEmpty() ? TEXT("UNAVAILABLE") : *Voice.Connection,
		VoiceLabel.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" [%s]"), *VoiceLabel), ShownRows.Num() > 0 ? *FString::Join(ShownRows, TEXT(",")) : TEXT("none"), *LastActionLine,
		FWonderlandSocialSignIn::StateName(SignIn.State), SignIn.State == EWonderlandSignInState::Waiting ? *FString::Printf(TEXT(" (code %d chars)"), SignIn.UserCode.Len()) : TEXT(""),
		*LffPart);
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

namespace WonderlandSocialR16ClientQa
{
	/** R16 CF-1..CF-4 CLIENT QA (2026-10-13, r2): offline. A fake clock, fed snapshots, surfaces and world answers, off-screen hubs that are
	 *  never drawn (no synthetic people on screen), and throwaway live services on a dead loopback port (127.0.0.1:9: nothing listens, never
	 *  a real server; no answer is waited for or read). It proves the PURE logic and the dispatch decisions; it does not drive the live
	 *  wiring (TickActivity, SendPresence's 429, the UI's messages.read branch) or read a request's path or body -- the two-client run does.
	 *    PA1-PA10   CF-1 the presence reporter: exploring held after movement; nothing re-sent unchanged; the 3 s gap (control); nothing in
	 *               flight; a 429's Retry-After; a party change re-reports (control); the details; a flapping input inside the budget;
	 *               a LOST answer re-sends the current state (control: a 4xx refusal does not)
	 *    PB1-PB3    CF-1 the presence body: never inGveBattle / inPrivateServer / juliusWorking, never inParty; the detail or null (PB3: the
	 *               check FAILS a forged body)
	 *    WW1-WW4    CF-1 CREATING only on the player's OWN tab with a creation being built or opened; controls: the idle page, a sample
	 *               peer's tab, a failed build or an unobservable surface are NOT creating
	 *    RD1-RD9    CF-2 read when a conversation is shown with unread messages, once per newest message; controls: nothing unread,
	 *               another tab, a preview hub; RD8/RD9: the service sends a read for a held conversation and refuses an unknown one
	 *               (RD9's invalid id and empty subject are generic guards, not CF-2 controls)
	 *    LW1-LW6    CF-3 the rail's control follows the server's location (control); LEAVE and REJOIN dispatch; a leave is not undone
	 *               by a 404; a report answered after the leave is dropped (control: the same answer to a player who wants the world is
	 *               applied); LW5's invalid place and preview refusals are generic guards, not CF-3 controls
	 *    PO1-PO5    CF-4 "WLWORLD population <n>" on a change only (control: repeats say nothing), said again after a world is left; PO5 is
	 *               a format guard
	 *    SN1-SN2    CF-4 the snapshot line's exact form with the recent count; SN2: the line still matches the judge's STRUCT catch-all
	 *               form (control: an insertion before the party would not) -- it does NOT test any reader's party capture
	 *  WLQA R16C lines, then WLQA R16C END pass=<n> fail=<n> (r2: 39 checks). */
	FAutoConsoleCommand GQaSocialR16Client(
		TEXT("wl.Qa.SocialR16Client"),
		TEXT("QA (R16 CF-1..CF-4): presence on change (debounced, honest, never GVE/private server/Julius), read on open, LEAVE / REJOIN SHARED WORLD, ")
		TEXT("the population and recent evidence lines -- offline: a fake clock, fed views, off-screen hubs, a dead loopback port."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			int32 Passed = 0;
			int32 Failed = 0;
			auto Check = [&Passed, &Failed](const FString& Id, bool bOk, const FString& What)
			{
				(bOk ? Passed : Failed) += 1;
				UE_LOG(LogTemp, Display, TEXT("WLQA R16C %s %s -- %s"), *Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *What);
			};

			// ---- CF-1: THE REPORTER, on a fake clock (T0 is any time; the reporter only compares)
			const double T0 = 1000.0;
			FWonderlandPresenceReporter Reporter(T0);
			FWonderlandActivitySample Still;
			FWonderlandActivitySample OnlyCreating;
			OnlyCreating.bCreating = true;
			FWonderlandActivitySample SimMission;
			SimMission.bRunningMission = true;
			SimMission.bMissionSimulated = true;

			// PA1: the arrival is exploring (what the connect report says), and the first report is due
			const FWonderlandPresenceSignals Arrived = Reporter.Want(Still, T0 + 1.0);
			Check(TEXT("PA1"), Arrived.bExploring && !Arrived.bCreating && !Arrived.bRunningMission && Arrived.Detail.IsEmpty() && Reporter.IsDue(Arrived, FString(), T0 + 1.0),
				FString::Printf(TEXT("arrival reads exploring, nothing accepted yet: due (%s)"), *Arrived.Describe()));
			Reporter.NoteSent(Arrived, FString(), T0 + 1.0);
			Reporter.NoteAnswered(true, 0, T0 + 1.2);
			// PA2: nothing changed: nothing is due, however much time passes inside the hold
			Check(TEXT("PA2"), !Reporter.IsDue(Reporter.Want(Still, T0 + 6.0), FString(), T0 + 6.0),
				TEXT("unchanged signals, the gap long past: nothing is re-sent"));
			// PA3: still for the whole hold: exploring at 7.9 s, not at 8.1 s -- and that change is due
			const FWonderlandPresenceSignals AtEdge = Reporter.Want(Still, T0 + 7.9);
			const FWonderlandPresenceSignals PastEdge = Reporter.Want(Still, T0 + 8.1);
			Check(TEXT("PA3"), AtEdge.bExploring && !PastEdge.bExploring && Reporter.IsDue(PastEdge, FString(), T0 + 8.1),
				FString::Printf(TEXT("exploring holds %.0f s after the last movement, then stops and is reported (%s -> %s)"),
					FWonderlandPresenceReporter::ExploringHoldSeconds, *AtEdge.Describe(), *PastEdge.Describe()));
			Reporter.NoteSent(PastEdge, FString(), T0 + 8.1);
			Reporter.NoteAnswered(true, 0, T0 + 8.2);
			// PA4: a change 0.9 s after the last report waits for the gap; CONTROL: the same change past the gap is due (the wait is the gap's)
			const bool bInGap = Reporter.IsDue(Reporter.Want(OnlyCreating, T0 + 9.0), FString(), T0 + 9.0);
			const FWonderlandPresenceSignals CreatingWanted = Reporter.Want(OnlyCreating, T0 + 11.2);
			const bool bPastGap = Reporter.IsDue(CreatingWanted, FString(), T0 + 11.2);
			Check(TEXT("PA4"), !bInGap && bPastGap,
				FString::Printf(TEXT("debounce: 0.9 s after a report the change waits (due %d); control: 3.1 s after, the same change is due (%d)"), bInGap ? 1 : 0, bPastGap ? 1 : 0));
			Reporter.NoteSent(CreatingWanted, FString(), T0 + 11.2);
			// PA5: nothing while a report is in flight, even past the gap; its answer accepted, the next change is due
			const bool bWhileFlying = Reporter.IsDue(Reporter.Want(SimMission, T0 + 15.0), FString(), T0 + 15.0);
			Reporter.NoteAnswered(true, 0, T0 + 15.1);
			const FWonderlandPresenceSignals MissionWanted = Reporter.Want(SimMission, T0 + 15.2);
			Check(TEXT("PA5"), !bWhileFlying && Reporter.IsDue(MissionWanted, FString(), T0 + 15.2) && Reporter.GetAccepted().bCreating,
				TEXT("in flight: nothing more is sent; once the creation report is accepted, the mission is due"));
			// PA6: refused with 429 Retry-After 20: not before it (though the gap and the 6 s retry have passed), due after; the server still holds creating
			Reporter.NoteSent(MissionWanted, FString(), T0 + 15.2);
			Reporter.NoteAnswered(false, 20, T0 + 15.3);
			const bool bEarly = Reporter.IsDue(Reporter.Want(SimMission, T0 + 30.0), FString(), T0 + 30.0);
			const bool bLater = Reporter.IsDue(Reporter.Want(SimMission, T0 + 35.4), FString(), T0 + 35.4);
			Check(TEXT("PA6"), !bEarly && bLater && Reporter.GetAccepted().bCreating && !Reporter.GetAccepted().bRunningMission,
				FString::Printf(TEXT("a 429 waits its Retry-After (due at +14.7 s: %d, at +20.1 s: %d); the accepted state is unchanged until accepted"), bEarly ? 1 : 0, bLater ? 1 : 0));
			Reporter.NoteSent(MissionWanted, FString(), T0 + 35.4);
			Reporter.NoteAnswered(true, 0, T0 + 35.5);
			// PA7: joining a party re-reports the SAME signals (the authority re-derives IN PARTY only on a report); CONTROL: no party change, nothing due
			const FWonderlandPresenceSignals SameSignals = Reporter.Want(SimMission, T0 + 40.0);
			Check(TEXT("PA7"), Reporter.IsDue(SameSignals, TEXT("qa-party"), T0 + 40.0) && !Reporter.IsDue(SameSignals, FString(), T0 + 40.0),
				TEXT("a party joined re-reports; control: the same signals and no party change are not re-sent"));
			// PA8: the honest details: a mission (simulated) over creating; creating alone; a REAL mission carries none of the client's words
			FWonderlandPresenceReporter Fresh(T0);
			FWonderlandActivitySample Both = SimMission;
			Both.bCreating = true;
			FWonderlandActivitySample RealMission;
			RealMission.bRunningMission = true;
			RealMission.bMissionSimulated = false;
			const FString DetailBoth = Fresh.Want(Both, T0).Detail;
			const FString DetailCreating = Fresh.Want(OnlyCreating, T0).Detail;
			const FString DetailReal = Fresh.Want(RealMission, T0).Detail;
			const FString DetailNone = Fresh.Want(Still, T0).Detail;
			Check(TEXT("PA8"), DetailBoth.Equals(WonderlandPresenceDetail::SimulatedMission(), ESearchCase::CaseSensitive)
				&& DetailCreating.Equals(WonderlandPresenceDetail::SimulatedCreation(), ESearchCase::CaseSensitive)
				&& DetailBoth.Contains(TEXT("simulated")) && DetailCreating.Contains(TEXT("simulated")) && DetailReal.IsEmpty() && DetailNone.IsEmpty()
				&& DetailBoth != DetailCreating,
				FString::Printf(TEXT("details: mission+creating '%s', creating '%s', real mission '%s', nothing '%s'"), *DetailBoth, *DetailCreating, *DetailReal, *DetailNone));
			// PA9: 60 s of a window flipping every 0.25 s tick (and the Dog twitching), each report accepted at once: at most one per 3 s
			FWonderlandPresenceReporter Flapping(T0);
			int32 Sends = 0;
			int32 Changes = 0;
			FWonderlandPresenceSignals Previous;
			for (int32 Step = 0; Step < 240; ++Step)
			{
				const double At = T0 + Step * 0.25;
				FWonderlandActivitySample Flip;
				Flip.bCreating = (Step % 2) == 0;
				Flip.bMoving = (Step % 3) == 0;
				const FWonderlandPresenceSignals FlipWanted = Flapping.Want(Flip, At);
				Changes += (Step > 0 && FlipWanted != Previous) ? 1 : 0;
				Previous = FlipWanted;
				if (Flapping.IsDue(FlipWanted, FString(), At))
				{
					Flapping.NoteSent(FlipWanted, FString(), At);
					Flapping.NoteAnswered(true, 0, At);
					Sends += 1;
				}
			}
			Check(TEXT("PA9"), Sends >= 2 && Sends <= 21 && Changes > 100,
				FString::Printf(TEXT("a flapping input: %d reports for %d changes in 60 s (<= 21: one per %.0f s, a third of the write budget's 1 a second)"),
					Sends, Changes, FWonderlandPresenceReporter::MinGapSeconds));
			// PA10 (r2, the correctness review's F3): the creation report's answer is LOST (no answer, a 5xx), so the server may hold CREATING;
			// the player closes the window, which is the last ACCEPTED state again -- it is still sent, after the retry wait. CONTROL: the same
			// report REFUSED (a 4xx: the server holds what it held) re-sends nothing unchanged
			FWonderlandPresenceReporter LostAnswer(T0);
			FWonderlandPresenceReporter RefusedAnswer(T0);
			const FWonderlandPresenceSignals IdleWanted = LostAnswer.Want(Still, T0 + 9.0);
			const FWonderlandPresenceSignals OpenedWanted = LostAnswer.Want(OnlyCreating, T0 + 13.0);
			const FWonderlandPresenceSignals ClosedWanted = LostAnswer.Want(Still, T0 + 14.0);
			LostAnswer.NoteSent(IdleWanted, FString(), T0 + 9.0);
			LostAnswer.NoteAnswered(true, 0, T0 + 9.1);
			LostAnswer.NoteSent(OpenedWanted, FString(), T0 + 13.0);
			LostAnswer.NoteAnswered(false, 0, T0 + 13.2, true);
			RefusedAnswer.NoteSent(IdleWanted, FString(), T0 + 9.0);
			RefusedAnswer.NoteAnswered(true, 0, T0 + 9.1);
			RefusedAnswer.NoteSent(OpenedWanted, FString(), T0 + 13.0);
			RefusedAnswer.NoteAnswered(false, 0, T0 + 13.2, false);
			const bool bLostInWait = LostAnswer.IsDue(ClosedWanted, FString(), T0 + 16.0);
			const bool bLostAfterWait = LostAnswer.IsDue(ClosedWanted, FString(), T0 + 19.3);
			const bool bRefusedAfterWait = RefusedAnswer.IsDue(ClosedWanted, FString(), T0 + 19.3);
			Check(TEXT("PA10"), ClosedWanted == IdleWanted && !bLostInWait && bLostAfterWait && !bRefusedAfterWait,
				FString::Printf(TEXT("a lost answer: the unchanged state is re-sent after the %.0f s wait (in it %d, after %d); control: a 4xx refusal re-sends nothing unchanged (%d)"),
					FWonderlandPresenceReporter::RetrySeconds, bLostInWait ? 1 : 0, bLostAfterWait ? 1 : 0, bRefusedAfterWait ? 1 : 0));

			// ---- CF-1: THE BODY
			auto NeverClaims = [](const TSharedPtr<FJsonObject>& Flags)
			{
				bool bGve = true;
				bool bPrivate = true;
				bool bJulius = true;
				return Flags.IsValid() && Flags->TryGetBoolField(TEXT("inGveBattle"), bGve) && !bGve && Flags->TryGetBoolField(TEXT("inPrivateServer"), bPrivate) && !bPrivate
					&& Flags->TryGetBoolField(TEXT("juliusWorking"), bJulius) && !bJulius && !Flags->HasField(TEXT("inParty"));
			};
			{
				FWonderlandPresenceSignals Creating;
				Creating.bCreating = true;
				Creating.Detail = WonderlandPresenceDetail::SimulatedCreation();
				const TSharedRef<FJsonObject> CreatingBody = WonderlandPresenceBody(true, Creating);
				const TSharedPtr<FJsonObject>* CreatingFlags = nullptr;
				FString CreatingKind;
				FString CreatingDetail;
				bool bConnectedSaid = false;
				const bool bShape = CreatingBody->TryGetObjectField(TEXT("signals"), CreatingFlags) && CreatingFlags != nullptr
					&& (*CreatingFlags)->TryGetStringField(TEXT("creating"), CreatingKind) && CreatingBody->TryGetStringField(TEXT("activityDetail"), CreatingDetail)
					&& CreatingBody->TryGetBoolField(TEXT("connected"), bConnectedSaid);
				Check(TEXT("PB1"), bShape && NeverClaims(*CreatingFlags) && CreatingKind.Equals(TEXT("SOFTWARE"), ESearchCase::CaseSensitive)
					&& CreatingDetail.Equals(TEXT("simulated sample (development preview)"), ESearchCase::CaseSensitive) && bConnectedSaid,
					FString::Printf(TEXT("creating: connected, creating %s, detail '%s'; GVE, private server and Julius said false; no inParty"), *CreatingKind, *CreatingDetail));
				FWonderlandPresenceSignals Plain;
				Plain.bExploring = true;
				const TSharedRef<FJsonObject> PlainBody = WonderlandPresenceBody(true, Plain);
				const TSharedPtr<FJsonValue> PlainDetail = PlainBody->TryGetField(TEXT("activityDetail"));
				const TSharedPtr<FJsonObject>* PlainFlags = nullptr;
				const bool bPlainFlags = PlainBody->TryGetObjectField(TEXT("signals"), PlainFlags) && PlainFlags != nullptr;
				const TSharedPtr<FJsonValue> PlainCreating = bPlainFlags ? (*PlainFlags)->TryGetField(TEXT("creating")) : nullptr;
				Check(TEXT("PB2"), PlainDetail.IsValid() && PlainDetail->IsNull() && PlainCreating.IsValid() && PlainCreating->IsNull() && bPlainFlags && NeverClaims(*PlainFlags),
					TEXT("exploring: the detail is SENT as null (an earlier activity's words are cleared), creating null, the three never claimed"));
				// PB3 CONTROL: the same predicate FAILS a body that claims Julius at work
				TSharedPtr<FJsonObject> Forged = MakeShared<FJsonObject>();
				Forged->SetBoolField(TEXT("inGveBattle"), false);
				Forged->SetBoolField(TEXT("inPrivateServer"), false);
				Forged->SetBoolField(TEXT("juliusWorking"), true);
				Check(TEXT("PB3"), !NeverClaims(Forged), TEXT("control: the never-claims check FAILS a body with juliusWorking true"));
			}

			// ---- CF-1 r2 (the privacy review's F1): CREATING only on the player's OWN tab with a creation being built or opened
			auto WebSurface = [](EWonderWebViewportKind Kind)
			{
				FWonderWebSurface Made;
				Made.bValid = true;
				FWonderWebTab Mine;
				Mine.UserId = TEXT("qa-me");
				Mine.Label = TEXT("MY VIEW");
				Mine.bIsSelf = true;
				Mine.Access = EWonderWebAccess::Control;
				FWonderWebTab Peer;
				Peer.UserId = TEXT("qa-peer");
				Peer.Label = TEXT("Sample peer");
				Peer.Access = EWonderWebAccess::Observe;
				Made.Tabs.Add(Mine);
				Made.Tabs.Add(Peer);
				Made.Viewport.Kind = Kind;
				return Made;
			};
			{
				const bool bWorking = WonderlandWonderWebShowsOwnCreation(WebSurface(EWonderWebViewportKind::Working), 0);
				const bool bOpened = WonderlandWonderWebShowsOwnCreation(WebSurface(EWonderWebViewportKind::Creation), 0);
				Check(TEXT("WW1"), bWorking && bOpened,
					FString::Printf(TEXT("the player's own tab, a creation being built (%d) or opened (%d): creating"), bWorking ? 1 : 0, bOpened ? 1 : 0));
				const bool bIdle = WonderlandWonderWebShowsOwnCreation(WebSurface(EWonderWebViewportKind::Idle), 0);
				Check(TEXT("WW2"), !bIdle, TEXT("control: Wonder Web open on its idle page (OPEN SAMPLE CREATION not pressed) is NOT creating"));
				const bool bPeerObserved = WonderlandWonderWebShowsOwnCreation(WebSurface(EWonderWebViewportKind::Observed), 1);
				const bool bPeerCreationKind = WonderlandWonderWebShowsOwnCreation(WebSurface(EWonderWebViewportKind::Creation), 1);
				Check(TEXT("WW3"), !bPeerObserved && !bPeerCreationKind,
					TEXT("control: a sample PEER's tab is NOT creating -- observed, and even with a creation view (the tab decides, not only the view)"));
				FWonderWebSurface UnobservedSurface = WebSurface(EWonderWebViewportKind::Creation);
				UnobservedSurface.UnavailableReason = TEXT("qa: could not be observed");
				FWonderWebSurface NeverRead = WebSurface(EWonderWebViewportKind::Working);
				NeverRead.bValid = false;
				const bool bFailedBuild = WonderlandWonderWebShowsOwnCreation(WebSurface(EWonderWebViewportKind::Failed), 0);
				const bool bOutOfRange = WonderlandWonderWebShowsOwnCreation(WebSurface(EWonderWebViewportKind::Creation), 5);
				Check(TEXT("WW4"), !bFailedBuild && !WonderlandWonderWebShowsOwnCreation(UnobservedSurface, 0) && !WonderlandWonderWebShowsOwnCreation(NeverRead, 0) && !bOutOfRange,
					TEXT("control: a failed build, an unobservable surface, a surface never read and a tab out of range are NOT creating"));
			}

			// ---- CF-2: READ ON OPEN, on an off-screen hub fed an inbox (never drawn)
			auto Message = [](const FString& ConversationId, int64 Sequence, const FString& SenderId)
			{
				FWonderlandSocialMessage M;
				M.MessageId = FString::Printf(TEXT("qa-msg-%s-%lld"), *ConversationId, Sequence);
				M.ConversationId = ConversationId;
				M.Sequence = Sequence;
				M.SenderId = SenderId;
				M.Kind = TEXT("TEXT");
				M.Body = TEXT("qa");
				return M;
			};
			auto Conversation = [](const FString& ConversationId, const FString& Title, int32 Unread)
			{
				FWonderlandSocialConversationRow Row;
				Row.ConversationId = ConversationId;
				Row.Kind = TEXT("DIRECT");
				Row.Title = Title;
				Row.OtherUserId = FString::Printf(TEXT("qa-%s"), *Title.ToLower());
				Row.Unread = Unread;
				return Row;
			};
			FWonderlandSocialSnapshot Inbox;
			Inbox.bDevelopmentPreview = false;
			Inbox.ViewerId = TEXT("qa-me");
			Inbox.Conversations.Add(Conversation(TEXT("qa-conv-a"), TEXT("Amy"), 2));
			Inbox.Conversations.Add(Conversation(TEXT("qa-conv-b"), TEXT("Bo"), 1));
			TArray<FWonderlandSocialMessage> HistoryA;
			HistoryA.Add(Message(TEXT("qa-conv-a"), 1, TEXT("qa-me")));
			HistoryA.Add(Message(TEXT("qa-conv-a"), 2, TEXT("qa-amy")));
			HistoryA.Add(Message(TEXT("qa-conv-a"), 3, TEXT("qa-amy")));
			TArray<FWonderlandSocialMessage> HistoryB;
			HistoryB.Add(Message(TEXT("qa-conv-b"), 1, TEXT("qa-bo")));
			Inbox.Messages.Add(TEXT("qa-conv-a"), HistoryA);
			Inbox.Messages.Add(TEXT("qa-conv-b"), HistoryB);
			{
				TArray<FString> Asked;
				const TSharedRef<SWonderlandSocialHubPanel> ReadHub = SNew(SWonderlandSocialHubPanel).Snapshot(Inbox).bConnected(true).bDevelopmentPreview(false)
					.InitialTab(SWonderlandSocialHubPanel::ETab::Messages)
					.OnAction_Lambda([&Asked](const FString& Operation, const FString& Subject) { Asked.Add(FString::Printf(TEXT("%s %s"), *Operation, *Subject)); });
				const FString Joined1 = FString::Join(Asked, TEXT(" | "));
				Check(TEXT("RD1"), Asked.Num() == 1 && Asked[0] == TEXT("messages.read qa-conv-a"),
					FString::Printf(TEXT("the hub opened on MESSAGES shows Amy's conversation (2 unread): one read asked [%s]"), *Joined1));
				ReadHub->SetSnapshot(Inbox, true, FString(), false);
				ReadHub->FlushRebuild();
				Check(TEXT("RD2"), Asked.Num() == 1, FString::Printf(TEXT("a refresh that changes nothing asks nothing more (%d asked)"), Asked.Num()));
				FWonderlandSocialSnapshot NewMessage = Inbox;
				NewMessage.Conversations[0].Unread = 3;
				NewMessage.Messages[TEXT("qa-conv-a")].Add(Message(TEXT("qa-conv-a"), 4, TEXT("qa-amy")));
				ReadHub->SetSnapshot(NewMessage, true, FString(), false);
				ReadHub->FlushRebuild();
				Check(TEXT("RD3"), Asked.Num() == 2 && Asked.Last() == TEXT("messages.read qa-conv-a"),
					FString::Printf(TEXT("a new message landing in the open conversation asks again (%d asked)"), Asked.Num()));
				FWonderlandSocialSnapshot Cleared = NewMessage;
				Cleared.Conversations[0].Unread = 0;
				Cleared.Messages[TEXT("qa-conv-a")].Add(Message(TEXT("qa-conv-a"), 5, TEXT("qa-amy")));   // e.g. from a muted sender: not unread
				ReadHub->SetSnapshot(Cleared, true, FString(), false);
				ReadHub->FlushRebuild();
				Check(TEXT("RD4"), Asked.Num() == 2, FString::Printf(TEXT("control: a newer message with NOTHING unread asks nothing (%d asked)"), Asked.Num()));
				ReadHub->OpenConversation(TEXT("qa-conv-b"));
				Check(TEXT("RD5"), Asked.Num() == 3 && Asked.Last() == TEXT("messages.read qa-conv-b"),
					FString::Printf(TEXT("opening Bo's conversation (1 unread) asks for it (%s)"), Asked.Num() > 0 ? *Asked.Last() : TEXT("none")));
				// RD6 CONTROL: on another tab nothing is read, though a message lands in the conversation; opening MESSAGES again reads it
				ReadHub->SetTab(SWonderlandSocialHubPanel::ETab::Friends);
				FWonderlandSocialSnapshot Away = Cleared;
				Away.Conversations[1].Unread = 2;
				Away.Messages[TEXT("qa-conv-b")].Add(Message(TEXT("qa-conv-b"), 2, TEXT("qa-bo")));
				ReadHub->SetSnapshot(Away, true, FString(), false);
				ReadHub->FlushRebuild();
				const int32 OnFriends = Asked.Num();
				ReadHub->SetTab(SWonderlandSocialHubPanel::ETab::Messages);
				Check(TEXT("RD6"), OnFriends == 3 && Asked.Num() == 4 && Asked.Last() == TEXT("messages.read qa-conv-b"),
					FString::Printf(TEXT("control: on FRIENDS nothing is read (%d asked); back on MESSAGES the open one is (%d asked)"), OnFriends, Asked.Num()));
			}
			{
				// RD7 CONTROL: a DEVELOPMENT PREVIEW hub (synthetic people) never reads, with the same unread inbox
				int32 PreviewAsked = 0;
				const TSharedRef<SWonderlandSocialHubPanel> PreviewHub = SNew(SWonderlandSocialHubPanel).Snapshot(Inbox).bConnected(true).bDevelopmentPreview(true)
					.InitialTab(SWonderlandSocialHubPanel::ETab::Messages)
					.OnAction_Lambda([&PreviewAsked](const FString&, const FString&) { PreviewAsked += 1; });
				PreviewHub->FlushRebuild();
				Check(TEXT("RD7"), PreviewAsked == 0, FString::Printf(TEXT("control: a preview hub with the same unread inbox asks nothing (%d)"), PreviewAsked));
			}
			{
				// RD8 / RD9: the live service's dispatch -- read up to the newest message ITS view holds; refused before sending otherwise
				TUniquePtr<FWonderlandSocialLiveService> ReadProbe = MakeUnique<FWonderlandSocialLiveService>(TEXT("http://127.0.0.1:9"), TEXT("qa-read"));
				ReadProbe->QaSetSnapshot(Inbox);
				const FWonderlandSocialActionResult Known = ReadProbe->Request(TEXT("messages.read"), TEXT("qa-conv-a"));
				Check(TEXT("RD8"), Known.bOk && Known.bPending,
					FString::Printf(TEXT("messages.read on a held conversation is sent (pending: %s) -- its path and sequence body are not read here"), *Known.Reason));
				const FWonderlandSocialActionResult Unknown = ReadProbe->Request(TEXT("messages.read"), TEXT("qa-conv-none"));
				const FWonderlandSocialActionResult BadId = ReadProbe->Request(TEXT("messages.read"), TEXT("bad id!"));
				const FWonderlandSocialActionResult NoSubject = ReadProbe->Request(TEXT("messages.read"), FString());
				Check(TEXT("RD9"), !Unknown.bOk && !Unknown.bPending && !BadId.bOk && !NoSubject.bOk,
					FString::Printf(TEXT("a conversation this view does not hold is refused by CF-2 ('%s'); guards: an invalid id ('%s', the generic safe-id rule) and none ('%s')"),
						*Unknown.Reason, *BadId.Reason, *NoSubject.Reason));
				ReadProbe.Reset();   // cancels what it started (to a dead port)
			}

			// A world report's answer, as the server sends it (the CF-3 and CF-4 checks feed it)
			auto WorldAnswer = [](const FString& ContextId, int32 Population)
			{
				TSharedPtr<FJsonObject> Made = MakeShared<FJsonObject>();
				Made->SetArrayField(TEXT("avatars"), TArray<TSharedPtr<FJsonValue>>());
				TSharedPtr<FJsonObject> Context = MakeShared<FJsonObject>();
				Context->SetStringField(TEXT("contextId"), ContextId);
				Context->SetStringField(TEXT("kind"), TEXT("PUBLIC_WORLD"));
				Context->SetStringField(TEXT("serverName"), TEXT("Golden Arrival"));
				Context->SetNumberField(TEXT("population"), Population);
				Context->SetNumberField(TEXT("capacity"), 32);
				Made->SetObjectField(TEXT("context"), Context);
				return Made;
			};

			// ---- CF-3: LEAVE / REJOIN SHARED WORLD
			{
				FWonderlandSocialPresence InWorld;
				InWorld.bHasLocation = true;
				InWorld.Location.ServerId = TEXT("pub_qa");
				FWonderlandSocialPresence OutOfWorld;
				FString InLabel, InOperation, InSubject, OutLabel, OutOperation, OutSubject;
				WonderlandSocialHubLook::WorldControlOf(InWorld, InLabel, InOperation, InSubject);
				WonderlandSocialHubLook::WorldControlOf(OutOfWorld, OutLabel, OutOperation, OutSubject);
				Check(TEXT("LW1"), InLabel.Equals(TEXT("LEAVE SHARED WORLD"), ESearchCase::CaseSensitive) && InOperation == TEXT("world.leave") && InSubject.IsEmpty(),
					FString::Printf(TEXT("in a world (the server's location): %s -> %s"), *InLabel, *InOperation));
				Check(TEXT("LW2"), OutLabel.Equals(TEXT("REJOIN SHARED WORLD"), ESearchCase::CaseSensitive) && OutOperation == TEXT("world.join")
					&& OutSubject == TEXT("golden_arrival") && OutLabel != InLabel,
					FString::Printf(TEXT("control, no location: %s -> %s %s (the control reads the location, not a constant)"), *OutLabel, *OutOperation, *OutSubject));
				TUniquePtr<FWonderlandSocialLiveService> WorldProbe = MakeUnique<FWonderlandSocialLiveService>(TEXT("http://127.0.0.1:9"), TEXT("qa-world-leave"));
				FWonderlandWorldView GoldenView;
				GoldenView.bInWorld = true;
				GoldenView.ContextId = TEXT("pub_qa");
				GoldenView.Kind = TEXT("PUBLIC_WORLD");
				GoldenView.ServerName = TEXT("Golden Arrival");
				WorldProbe->QaSetWorld(GoldenView, true);
				const FWonderlandSocialActionResult LeaveAnswer = WorldProbe->Request(InOperation, InSubject);
				Check(TEXT("LW3"), LeaveAnswer.bOk && LeaveAnswer.bPending && !WorldProbe->GetWorldView().bInWorld && !WorldProbe->QaAutoJoinPlan().bPending,
					TEXT("LEAVE SHARED WORLD: world.leave is sent, the world view is gone at once, no automatic join is planned"));
				// LW4: a leave is not undone: the server forgetting the world (404) plans no quiet rejoin for a player who chose to leave
				WorldProbe->QaFeedWorldReport(404, nullptr, TEXT("Join a world first"));
				Check(TEXT("LW4"), !WorldProbe->QaAutoJoinPlan().bPending && !WorldProbe->GetWorldView().bInWorld,
					TEXT("after LEAVE SHARED WORLD a 404 world answer plans no automatic join (the player chose to leave)"));
				// LW6 (r2, the correctness review's F1): a report sent BEFORE the leave and answered after it is dropped -- the view stays out of the
				// world, no population line, no join planned (no frozen Dogs, no false "appeared"). CONTROL: the same answer to a player who wants
				// the world IS applied (in the world, one population line)
				const int32 LinesBeforeStale = WorldProbe->QaPopulationLines();
				WorldProbe->QaFeedWorldReport(200, WorldAnswer(TEXT("pub_qa"), 2), FString());
				const bool bStaleDropped = !WorldProbe->GetWorldView().bInWorld && WorldProbe->QaPopulationLines() == LinesBeforeStale
					&& !WorldProbe->QaAutoJoinPlan().bPending;
				TUniquePtr<FWonderlandSocialLiveService> StayProbe = MakeUnique<FWonderlandSocialLiveService>(TEXT("http://127.0.0.1:9"), TEXT("qa-world-stay"));
				StayProbe->QaSetWorld(GoldenView, true);
				StayProbe->QaFeedWorldReport(200, WorldAnswer(TEXT("pub_qa"), 2), FString());
				const bool bWantedApplied = StayProbe->GetWorldView().bInWorld && StayProbe->QaPopulationLines() == 1;
				StayProbe.Reset();
				Check(TEXT("LW6"), bStaleDropped && bWantedApplied,
					FString::Printf(TEXT("a world answer landing after the leave is dropped (dropped %d); control: the same answer to a player in the world is applied (%d)"),
						bStaleDropped ? 1 : 0, bWantedApplied ? 1 : 0));
				const FWonderlandSocialActionResult BackAnswer = WorldProbe->Request(OutOperation, OutSubject);
				const FWonderlandSocialActionResult BadPlace = WorldProbe->Request(TEXT("world.join"), TEXT("bad place!"));
				FWonderlandSocialPreviewService NotLive;
				const FWonderlandSocialActionResult PreviewLeave = NotLive.Request(TEXT("world.leave"), FString());
				Check(TEXT("LW5"), BackAnswer.bOk && BackAnswer.bPending && WorldProbe->QaAutoJoinPlan().bJoinInFlight && !BadPlace.bOk && !PreviewLeave.bOk,
					FString::Printf(TEXT("REJOIN SHARED WORLD: the player's own PUBLIC join leaves (in flight); guards, not CF-3 controls: an invalid place ('%s', the safe-id rule) and the preview ('%s', refuses every op)"),
						*BadPlace.Reason, *PreviewLeave.Reason));
				WorldProbe.Reset();
			}

			// ---- CF-4: THE EVIDENCE LINES
			{
				TUniquePtr<FWonderlandSocialLiveService> CountProbe = MakeUnique<FWonderlandSocialLiveService>(TEXT("http://127.0.0.1:9"), TEXT("qa-population"));
				FWonderlandWorldView Entering;
				Entering.bInWorld = true;
				Entering.ContextId = TEXT("pub_qa");
				CountProbe->QaSetWorld(Entering, true);
				CountProbe->QaFeedWorldReport(200, WorldAnswer(TEXT("pub_qa"), 2), FString());
				const int32 AfterFirst = CountProbe->QaPopulationLines();
				const FString FirstLine = CountProbe->QaLastPopulationLine();
				Check(TEXT("PO1"), AfterFirst == 1 && FirstLine.Equals(TEXT("WLWORLD population 2 in pub_qa (Golden Arrival)"), ESearchCase::CaseSensitive),
					FString::Printf(TEXT("the first answer in a world says its population: '%s'"), *FirstLine));
				for (int32 Repeat = 0; Repeat < 4; ++Repeat)
				{
					CountProbe->QaFeedWorldReport(200, WorldAnswer(TEXT("pub_qa"), 2), FString());
				}
				Check(TEXT("PO2"), CountProbe->QaPopulationLines() == 1,
					FString::Printf(TEXT("control: four more answers with the same population say nothing (%d line)"), CountProbe->QaPopulationLines()));
				CountProbe->QaFeedWorldReport(200, WorldAnswer(TEXT("pub_qa"), 1), FString());
				Check(TEXT("PO3"), CountProbe->QaPopulationLines() == 2 && CountProbe->QaLastPopulationLine().StartsWith(TEXT("WLWORLD population 1 in pub_qa")),
					FString::Printf(TEXT("a player gone from this view: '%s'"), *CountProbe->QaLastPopulationLine()));
				CountProbe->QaFeedWorldReport(404, nullptr, TEXT("Join a world first"));
				const int32 AfterForgotten = CountProbe->QaPopulationLines();
				CountProbe->QaClearPendingJoin();
				CountProbe->QaFeedWorldReport(200, WorldAnswer(TEXT("pub_qa"), 1), FString());
				Check(TEXT("PO4"), AfterForgotten == 2 && CountProbe->QaPopulationLines() == 3,
					FString::Printf(TEXT("out of the world nothing is said (%d); back in it the same population is said again (%d)"), AfterForgotten, CountProbe->QaPopulationLines()));
				const FString Said = CountProbe->QaLastPopulationLine();
				Check(TEXT("PO5"), Said.StartsWith(TEXT("WLWORLD population ")) && !Said.StartsWith(TEXT("WLWORLD joined")) && !Said.StartsWith(TEXT("WLWORLD player")),
					TEXT("format guard: the line is its own prefix, never one of the structured WLWORLD forms an evidence judge parses (joined / player)"));
				CountProbe.Reset();

				FWonderlandSocialSnapshot Counted;
				Counted.ViewerId = TEXT("qa-me");
				Counted.RecentPlayers.AddDefaulted(2);
				const FString SnapshotSaid = WonderlandSocialSnapshotLine(Counted);
				Check(TEXT("SN1"), SnapshotSaid.Equals(TEXT("WLSOCIAL live snapshot: qa-me, 0 friends, 0 requests in, 0 conversations, party none | recent 2"), ESearchCase::CaseSensitive),
					FString::Printf(TEXT("the snapshot line says the recent count: '%s'"), *SnapshotSaid));
				// SN2, THE STRUCT FORM: the line still matches the judge's catch-all STRUCT form ("…, <n> conversations, party .*"); CONTROL: had the
				// count gone before the party, it would not. It does NOT test a reader's party CAPTURE: that capture must split on the LAST " | recent "
				auto EarlierFormReads = [](const FString& Text)
				{
					return Text.StartsWith(TEXT("WLSOCIAL live snapshot: ")) && Text.Contains(TEXT(" conversations, party "));
				};
				const FString Inserted = TEXT("WLSOCIAL live snapshot: qa-me, 0 friends, 0 requests in, 0 conversations, 2 recent, party none");
				Check(TEXT("SN2"), EarlierFormReads(SnapshotSaid) && !EarlierFormReads(Inserted),
					TEXT("STRUCT form: the line still matches the catch-all form '<n> conversations, party '; control: a count inserted before the party FAILS it (a reader's party capture is not tested here)"));
			}
			UE_LOG(LogTemp, Display, TEXT("WLQA R16C END pass=%d fail=%d"), Passed, Failed);
		}));
}
