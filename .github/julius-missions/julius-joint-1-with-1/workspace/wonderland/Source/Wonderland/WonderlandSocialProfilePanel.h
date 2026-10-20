// WONDERLAND SOCIAL — another player's profile: a CHARACTER + AI LOADOUT, not an account page.
//
// FOUNDER, 2026-10-01: "On the LEFT side of the profile display the user's PRIMARY: COMPOUND AI AGENT and RELAY DOG. These
// should be major visual identity elements, not tiny icons … The primary Compound AI Agent and Relay Dog should make the
// profile immediately recognizable as a WONDERLAND profile."
//
// LEFT: two big identity cards -- the primary Compound AI Agent (its emblem drawn in the HUD's own ring language, its
// name, its system, its public arena record marked provisional) and the primary Relay Dog (the live figure in their skin,
// idling as Relay OG does, from a profile stage like the wardrobe's).
// RIGHT: who they are and what they are doing (through the ONE presence authority's view), rank and level as PENDING, the
// active AI Companion, the other public Compound AI Agents and AI Companions, party status, what you can do, statistics and
// mutual friends.
//
// It draws views and decides nothing (WonderlandSocialTypes.h). Every action asks the social service, which in a
// DEVELOPMENT PREVIEW refuses with the reason -- and the panel says DEVELOPMENT PREVIEW on its face.
#pragma once

#include "CoreMinimal.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Styling/SlateBrush.h"
#include "Styling/SlateTypes.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/SLeafWidget.h"
#include "WonderlandSocialTypes.h"

struct FSlateBrush;

/** User id -> display name. An alias because a comma inside SLATE_ARGUMENT splits the macro (TMap<FString, FString>). */
using FWonderlandSocialNames = TMap<FString, FString>;

DECLARE_DELEGATE_TwoParams(FOnWonderlandSocialAction, const FString& /*OperationId*/, const FString& /*SubjectUserId*/);
DECLARE_DELEGATE_OneParam(FOnWonderlandSocialOpenProfile, const FString& /*UserId*/);

class WONDERLAND_API SWonderlandSocialProfilePanel : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandSocialProfilePanel) {}
		SLATE_ARGUMENT(FWonderlandSocialProfileView, View)
		/** Display names for chips (mutual friends), by user id. */
		SLATE_ARGUMENT(FWonderlandSocialNames, NamesById)
		/** "DEVELOPMENT PREVIEW · synthetic people · not connected", or the live service's line. */
		SLATE_ARGUMENT(FString, SourceLine)
		SLATE_ARGUMENT(bool, bDevelopmentPreview)
		/** The profile stage's live render of their Relay Dog. Null shows the skin's name only. */
		SLATE_ARGUMENT(const FSlateBrush*, DogBrush)
		/** Their skin's name from this build's skin registry ("Shadow Flame"); empty falls back to the id's own name. */
		SLATE_ARGUMENT(FString, DogSkinName)
		SLATE_EVENT(FSimpleDelegate, OnDogPainted)
		SLATE_EVENT(FOnWonderlandSocialAction, OnAction)
		SLATE_EVENT(FOnWonderlandSocialOpenProfile, OnOpenProfile)
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
	SLATE_END_ARGS()

	SWonderlandSocialProfilePanel();
	void Construct(const FArguments& InArgs);

	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;

	/** The status line under the actions: the last refusal or confirmation, for a person and for QA. */
	FString GetLastActionLine() const { return LastActionLine; }
	/** The social service's answer to an action this panel asked for, shown under the actions. */
	void ShowActionResult(const FString& Line);
	const FWonderlandSocialProfileView& GetView() const { return View; }

	/** What the panel shows in its identity column, for QA: "<agent> | <dog skin>". */
	FString DescribeIdentityColumn() const;

private:
	TSharedRef<SWidget> MakeAgentCard();
	TSharedRef<SWidget> MakeDogCard();
	TSharedRef<SWidget> MakeHeader();
	TSharedRef<SWidget> MakeProgressionTiles();
	TSharedRef<SWidget> MakeLoadout();
	TSharedRef<SWidget> MakeSocialStatus();
	TSharedRef<SWidget> MakeActions();
	TSharedRef<SWidget> MakeStatsAndMutuals();
	TSharedRef<SWidget> ActionButton(const FString& Label, const FString& OperationId, const FString& Subject, bool bAllowed);

	FWonderlandSocialProfileView View;
	TMap<FString, FString> NamesById;
	FString SourceLine;
	bool bDevelopmentPreview = true;
	const FSlateBrush* DogBrush = nullptr;
	FString DogSkinName;
	FSimpleDelegate OnDogPainted;
	FOnWonderlandSocialAction OnAction;
	FOnWonderlandSocialOpenProfile OnOpenProfile;
	FSimpleDelegate OnRequestClose;
	FString LastActionLine;
	TSharedPtr<class STextBlock> ActionLineText;

	// Built once, as the other panels' are (see SWonderlandWalletPanel).
	FSlateRoundedBoxBrush PanelBrush;
	FSlateRoundedBoxBrush CardBrush;
	FSlateRoundedBoxBrush SectionBrush;
	FSlateRoundedBoxBrush TileBrush;
	FSlateRoundedBoxBrush PreviewBrush;
	FSlateRoundedBoxBrush ButtonNormal;
	FSlateRoundedBoxBrush ButtonHovered;
	FSlateRoundedBoxBrush ButtonDisabled;
	FSlateBrush ScrimBrush;
	FButtonStyle ButtonStyle;
};

/** The Compound AI Agent's emblem, drawn in the usage HUD's ring language (Compound green, Single blue, LLM white). */
class WONDERLAND_API SWonderlandSocialAgentEmblem : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandSocialAgentEmblem) : _Size(220.0f), _Kind(TEXT("JULIUS")) {}
		SLATE_ARGUMENT(float, Size)
		SLATE_ARGUMENT(FString, Kind)
		SLATE_ARGUMENT(FString, Initial)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(Size, Size); }
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;

private:
	float Size = 220.0f;
	FString Kind;
	FString Initial;
};

/** A generated avatar: a disc in a colour from the user id, and their initial. Never a fetched image. */
class WONDERLAND_API SWonderlandSocialAvatar : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandSocialAvatar) : _Size(84.0f) {}
		SLATE_ARGUMENT(float, Size)
		SLATE_ARGUMENT(FString, Seed)
		SLATE_ARGUMENT(FString, Initial)
		SLATE_ARGUMENT(FLinearColor, Ring)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(Size, Size); }
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;

private:
	float Size = 84.0f;
	FString Seed;
	FString Initial;
	FLinearColor Ring = FLinearColor::White;
};
