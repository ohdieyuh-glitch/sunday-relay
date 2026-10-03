// WONDERLAND SOCIAL — the Social Hub: where a player finds the people they play with.
//
// FOUNDER, 2026-10-02: "WONDERLAND IS MULTIPLAYER BEFORE LAUNCH." The hub is the client's home for it. The FRIENDS tab has
// the list with presence: who is on, what they are doing, where, and what you may do with them. REQUESTS holds friend
// requests both ways (accept / decline / cancel) and party invitations. RECENT is the people you played with. MESSAGES is
// the inbox (unread counts, each conversation's history, a reply box). PARTY is the viewer's party (members, leader controls,
// rules, invites) or, without one, CREATE and friends' parties to join -- beside PARTY VOICE, drawn from the one voice
// service (WonderlandVoice.h), which says VOICE TRANSPORT PENDING until a provider is chosen.
//
// Like the profile, it draws views and decides nothing (WonderlandSocialTypes.h). Every row's actions are the ones the
// social authority allowed for that viewer (FWonderlandSocialActions); every press asks the social service, by the
// authority's own operation id (relay-bridge/wonderland-social-scope.ts), and shows its answer. Without a service it says
// Social is not connected -- it never invents people.
#pragma once

#include "CoreMinimal.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Styling/SlateBrush.h"
#include "Styling/SlateTypes.h"
#include "Widgets/SCompoundWidget.h"
#include "WonderlandSocialProfilePanel.h"
#include "WonderlandSocialSignIn.h"
#include "WonderlandSocialTypes.h"

class SBorder;
class SEditableTextBox;
class STextBlock;

DECLARE_DELEGATE_TwoParams(FOnWonderlandSocialSend, const FString& /*ConversationId*/, const FString& /*Body*/);
/** A voice command: "connect", "disconnect", "mic.mute", "mic.unmute", "local.mute" / "local.unmute" (subject: the member), "preview.step". */
DECLARE_DELEGATE_TwoParams(FOnWonderlandVoiceCommand, const FString& /*Command*/, const FString& /*SubjectUserId*/);

class WONDERLAND_API SWonderlandSocialHubPanel : public SCompoundWidget
{
public:
	enum class ETab : uint8 { Friends, Requests, Recent, Messages, Party };

	SLATE_BEGIN_ARGS(SWonderlandSocialHubPanel) : _bConnected(false), _bDevelopmentPreview(true), _InitialTab(ETab::Friends) {}
		SLATE_ARGUMENT(FWonderlandSocialSnapshot, Snapshot)
		/** False when there is no social service at all: the hub says so and lists nobody. */
		SLATE_ARGUMENT(bool, bConnected)
		/** "DEVELOPMENT PREVIEW · synthetic people · not connected", or the live service's line. */
		SLATE_ARGUMENT(FString, SourceLine)
		SLATE_ARGUMENT(bool, bDevelopmentPreview)
		SLATE_ARGUMENT(ETab, InitialTab)
		SLATE_EVENT(FOnWonderlandSocialAction, OnAction)
		SLATE_EVENT(FOnWonderlandSocialOpenProfile, OnOpenProfile)
		/** SEND in a conversation: the body goes to the social service, which answers like any action. */
		SLATE_EVENT(FOnWonderlandSocialSend, OnSend)
		/** The voice service's state on opening, and its preview label (empty for a real provider). */
		SLATE_ARGUMENT(FWonderlandVoiceState, Voice)
		SLATE_ARGUMENT(FString, VoiceLabel)
		SLATE_EVENT(FOnWonderlandVoiceCommand, OnVoice)
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
		/** The player's sign-in, shown when there is no live service: SIGN IN, the GitHub code, CANCEL; SIGN OUT when live. Its
		 *  buttons go through OnAction as "signin.start" / "signin.open" / "signin.cancel" / "signin.out". */
		SLATE_ARGUMENT(FWonderlandSignInView, SignIn)
	SLATE_END_ARGS()

	SWonderlandSocialHubPanel();
	void Construct(const FArguments& InArgs);

	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;

	void SetTab(ETab Tab);
	ETab GetTab() const { return Tab; }
	/** Messages: show this conversation (the inbox's first when empty or unknown). */
	void OpenConversation(const FString& ConversationId);
	/** Messages: what SEND does with the reply box's text, for a person and for QA. False when there is nothing to send. */
	bool SendReply(const FString& Body);
	/** The voice service's state changed (a command, a provider event, the preview's stepper): redraw the voice column. */
	void SetVoice(const FWonderlandVoiceState& State, const FString& Label);
	/** The sign-in changed (a code arrived, it was approved, it failed, the session ended). Stored only: the caller's
	 *  SetSnapshot, which always follows it, redraws once. */
	void SetSignIn(const FWonderlandSignInView& InView);
	/** The service's view changed (a live update): redraw on the same tab, the same conversation if it is still there. */
	void SetSnapshot(const FWonderlandSocialSnapshot& InSnapshot, bool bInConnected, const FString& InSourceLine, bool bInPreview);
	/** The social service's answer to an action this hub asked for, shown at the foot. */
	void ShowActionResult(const FString& Line);
	FString GetLastActionLine() const { return LastActionLine; }
	/** For QA: "tab FRIENDS | friends 6 (4 on) | requests in 1 out 0 | party invites 1 | recent 0 | rows <ids> | action: …". */
	FString Describe() const;

	static const TCHAR* TabName(ETab Tab);
	static bool ParseTab(const FString& Text, ETab& Out);

private:
	void Rebuild();
	TSharedRef<SWidget> MakeRail();
	TSharedRef<SWidget> MakeTabButton(ETab Which, const FString& Label, const FString& Count);
	TSharedRef<SWidget> MakeFriends();
	TSharedRef<SWidget> MakeRequests();
	TSharedRef<SWidget> MakeRecent();
	TSharedRef<SWidget> MakeMessages();
	TSharedRef<SWidget> MakeParty();
	TSharedRef<SWidget> MakeVoice();
	TSharedRef<SWidget> MakeMemberRow(const FWonderlandSocialPartyMember& Member);
	TSharedRef<SWidget> MakeVisiblePartyRow(const FWonderlandSocialParty& Party);
	TSharedRef<SWidget> MakeVoiceButton(const FString& Label, const FString& Command, const FString& Subject, bool bAllowed, bool bQuiet = false);
	/** A person's presence from what the authority sent (a friend row, else their profile); null when it sent none. */
	const FWonderlandSocialPresence* PresenceOf(const FString& UserId) const;
	TSharedRef<SWidget> MakeConversationRow(const FWonderlandSocialConversationRow& Row);
	TSharedRef<SWidget> MakeHistory();
	/** The DIRECT conversation with this person, if the inbox has one. */
	const FWonderlandSocialConversationRow* FindDirect(const FString& UserId) const;
	int32 CountUnread() const;
	FString NameOf(const FString& UserId) const;
	TSharedRef<SWidget> MakeNotConnected();
	/** SIGN IN, by state: the button, the code to enter at GitHub, the wait, the failure. */
	TSharedRef<SWidget> MakeSignIn();
	TSharedRef<SWidget> MakeSectionTitle(const FString& Title, int32 Count);
	TSharedRef<SWidget> MakeEmpty(const FString& Line);
	/** One person: avatar, name and handle, the presence line, a second line (context), and the row's actions. */
	TSharedRef<SWidget> MakePersonRow(const FWonderlandSocialPersonRow& Person, const FString& Second, const TSharedRef<SWidget>& Actions);
	TSharedRef<SWidget> MakeButton(const FString& Label, const FString& OperationId, const FString& Subject, bool bAllowed, bool bQuiet = false);
	TSharedRef<SWidget> MakeProfileButton(const FString& UserId);

	/** Friends in presence order: ONLINE, BUSY, AWAY, then everyone else; by name within each. */
	TArray<const FWonderlandSocialPersonRow*> SortedFriends() const;
	int32 CountOn() const;

	FWonderlandSocialSnapshot Snapshot;
	bool bConnected = false;
	FString SourceLine;
	bool bDevelopmentPreview = true;
	ETab Tab = ETab::Friends;
	FOnWonderlandSocialAction OnAction;
	FOnWonderlandSocialOpenProfile OnOpenProfile;
	FOnWonderlandSocialSend OnSend;
	FSimpleDelegate OnRequestClose;
	FString OpenConversationId;
	TSharedPtr<SEditableTextBox> ReplyBox;
	FWonderlandVoiceState Voice;
	FString VoiceLabel;
	FOnWonderlandVoiceCommand OnVoice;
	FString LastActionLine;
	FWonderlandSignInView SignIn;

	TSharedPtr<SBorder> RailHost;
	TSharedPtr<SBorder> BodyHost;
	TSharedPtr<STextBlock> ActionLineText;
	TSharedPtr<STextBlock> SourceText;
	/** What the open tab lists, by id, in order: for QA and for a person reading the log. */
	TArray<FString> ShownRows;

	// Built once, as the profile's are.
	FSlateRoundedBoxBrush PanelBrush;
	FSlateRoundedBoxBrush RailBrush;
	FSlateRoundedBoxBrush RowBrush;
	FSlateRoundedBoxBrush RowSelectedBrush;
	FSlateRoundedBoxBrush MineBrush;
	FSlateRoundedBoxBrush TheirsBrush;
	FSlateRoundedBoxBrush BadgeBrush;
	FSlateRoundedBoxBrush TabNormal;
	FSlateRoundedBoxBrush TabSelected;
	FSlateRoundedBoxBrush PreviewBrush;
	FSlateRoundedBoxBrush ButtonNormal;
	FSlateRoundedBoxBrush ButtonHovered;
	FSlateRoundedBoxBrush ButtonDisabled;
	FSlateBrush ScrimBrush;
	FSlateBrush NoBrush;
	FButtonStyle ButtonStyle;
	FButtonStyle QuietStyle;
	FButtonStyle TabStyle;
	FButtonStyle TabSelectedStyle;
};
