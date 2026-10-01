// WONDERLAND — THE PROJECT BRAIN PANEL. Opened with B, over the world.
//
// DRAWN TO THE FOUNDER'S FRAME (2026-09-15): "PROJECT BRAIN — MEMORY x REASONING x CONTINUITY x A HIGHER YOU";
// three glass panels down the left -- 01 MEMORY CORE (semantic, episodic, procedural memory), 02 PROJECT BRAIN
// SYSTEMS, 03 LARGE LANGUAGE MODEL COMPONENTS -- wired by glowing connectors into a holographic brain on a
// platform of light, with the chakra rank it glows in. A fourth strip, 04 MISSION CONTEXT, carries the brain
// scope's own vocabulary (objective, requirements, constraints, decisions, evidence, evaluations, trace,
// governance), laid into the frame's empty lower band so the frame itself is unchanged.
//
// A NATIVE WONDERLAND SURFACE, NOT A DASHBOARD. One thing is inspected at a time: choosing a memory, a system or
// a component opens it over the brain, with who may change it stated first -- YOURS, REVIEW or SYSTEM (locked) --
// and the one action that access allows. Progressive disclosure is the web Project Brain view's rule too.
//
// IT SAYS WHAT IT IS. Everything drawn comes from UWonderlandProjectBrainSubsystem's presentation model; in the
// development preview that is sample data and the panel says so at the top. Additions and review decisions are
// proposals, recorded in this session only and marked NOT SAVED.
#pragma once

#include "CoreMinimal.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Styling/SlateTypes.h"
#include "Widgets/SCompoundWidget.h"
#include "WonderlandProjectBrain.h"
#include "WonderlandRelaySkins.h"

class SEditableTextBox;
class SVerticalBox;
enum class EWonderlandBrainGlyph : uint8;

class WONDERLAND_API SWonderlandProjectBrainPanel : public SCompoundWidget
{
public:
	DECLARE_DELEGATE_TwoParams(FOnPropose, FName /*SurfaceId*/, const FString& /*Text*/);
	DECLARE_DELEGATE_ThreeParams(FOnReview, FName /*SurfaceId*/, int32 /*LineIndex*/, bool /*bAccept*/);
	/** A skin card was clicked. The panel never equips anything itself; the registry decides and the world follows. */
	DECLARE_DELEGATE_OneParam(FOnChooseSkin, FName /*SkinId*/);

	SLATE_BEGIN_ARGS(SWonderlandProjectBrainPanel)
		: _HologramBrush(nullptr)
	{}
		/** The brain hologram art, or null to draw the frame without it. Owned by the caller. */
		SLATE_ARGUMENT(const FSlateBrush*, HologramBrush)
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
		SLATE_EVENT(FSimpleDelegate, OnRequestTerminal)
		SLATE_EVENT(FSimpleDelegate, OnRequestMap)
		/** Open this project's Wonder Web: the in-world browser for what the project built. */
		SLATE_EVENT(FSimpleDelegate, OnRequestWonderWeb)
		SLATE_EVENT(FOnPropose, OnPropose)
		SLATE_EVENT(FOnReview, OnReview)
		/**
		 * THE LIVE RELAY DOG. A brush over the skin stage's render target -- a real actor in the world, breathing and
		 * looking about on a plinth a kilometre above the map (WonderlandSkinStage.h). Null draws the view without it
		 * and says the preview is unavailable, rather than drawing a still that pretends to be live.
		 */
		SLATE_ARGUMENT(const FSlateBrush*, SkinPreviewBrush)
		/** The skins to list, in registry order. */
		SLATE_ARGUMENT(TArray<FWonderlandRelaySkin>, Skins)
		/** Which one is worn right now, read every frame so a change from anywhere shows here. */
		SLATE_ATTRIBUTE(FName, EquippedSkin)
		SLATE_EVENT(FOnChooseSkin, OnChooseSkin)
		/** Raised on every paint of the preview, so the stage knows somebody is looking and keeps capturing. */
		SLATE_EVENT(FSimpleDelegate, OnSkinPreviewPainted)
		/**
		 * THE 360 BUTTON, in the preview square's top-right corner (founder, 2026-09-25).
		 *
		 * The panel owns the BUTTON and nothing else: the figure that turns is an actor in the world, so the
		 * subsystem is told to start or stop the turn and reports back through IsInspecting whether it did.
		 * The panel never holds a second opinion about whether the mascot is rotating.
		 */
		SLATE_EVENT(FSimpleDelegate, OnToggleInspect)
		SLATE_ATTRIBUTE(bool, IsInspecting)
	SLATE_END_ARGS()

	SWonderlandProjectBrainPanel();
	void Construct(const FArguments& InArgs);

	/** Take the subsystem's current model. Keeps the selection when the surface still exists. */
	void Refresh(const FWonderlandBrainModel& InModel);

	/** Inspect one surface, or NAME_None to close the inspector. */
	void Select(FName SurfaceId);
	FName GetSelected() const { return Selected; }

	/** The same path the inspector's input takes: a proposal on the selected surface. */
	bool ProposeToSelected(const FString& Text);

	/** Open or shut the RELAY DOG skin view, which stands where the inspector stands: over the brain. */
	void SetSkinsOpen(bool bOpen);

	/**
	 * TOLD WHENEVER THE WARDROBE OPENS OR SHUTS, BY ANY ROUTE, and this exists because it did not.
	 *
	 * Standing the brain sculpture down and framing the Dog into the window lives in
	 * UWonderlandUiSubsystem::SetBrainSkinsOpen. The panel's own SWITCH SKIN button called SetSkinsOpen on the
	 * WIDGET, so a player clicking it opened the wardrobe with the brain still staged and the Dog never framed
	 * -- which is why the preview showed the brain chamber, white background and black snow and all.
	 *
	 * Every proof went through the subsystem and passed. The player goes through the button. Two doors into one
	 * feature, and only one of them did the work. The subsystem binds this so there is now only one.
	 */
	TFunction<void(bool)> OnSkinsOpenChanged;

	/**
	 * WHERE THE PREVIEW WINDOW IS ON SCREEN, as a fraction of the viewport: centre and size. False until the
	 * wardrobe has painted once. The camera framing reads this rather than assuming a layout, so a resize or a
	 * different font does not put the Dog behind the skin list.
	 */
	bool GetSkinPreviewRect(FVector2D& OutCentre, FVector2D& OutSize) const;
	bool IsSkinsOpen() const { return bSkinsOpen; }

	/**
	 * WHERE THE BRAIN ITSELF IS DRAWN, in the same fractions. The living sculpture is framed into this rectangle the
	 * way the Dog is framed into the wardrobe's, so the brain on screen is a real breathing actor rather than art.
	 * False while the wardrobe is open, because the lens cannot serve two windows at once.
	 */
	bool GetBrainSculptureRect(FVector2D& OutCentre, FVector2D& OutSize) const;

	/** Tell the panel the living brain is on screen, so it stops drawing the still one over the top of it. */
	void SetSculptureLive(bool bLive);
	bool IsSculptureLive() const { return bSculptureLive; }

	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;

private:
	TSharedRef<SWidget> MakeGlassPanel(const TCHAR* Number, EWonderlandBrainGlyph Glyph, const TCHAR* Title, const TCHAR* Subtitle, TSharedRef<SWidget> Body);
	TSharedRef<SWidget> MakeMemoryCard(EWonderlandBrainGlyph Glyph, const TCHAR* Title, std::initializer_list<const TCHAR*> SurfaceIds);
	TSharedRef<SWidget> MakeTile(EWonderlandBrainGlyph Glyph, FName SurfaceId, float Height);
	TSharedRef<SWidget> MakeChip(EWonderlandBrainGlyph Glyph, FName SurfaceId);
	TSharedRef<SWidget> MakeSelectable(FName SurfaceId, const FSlateBrush* RestBrush, TSharedRef<SWidget> Content);
	TSharedRef<SWidget> MakeSkinTile();
	TSharedRef<SWidget> MakeSkinsView();
	TSharedRef<SWidget> MakeSkinCard(const FWonderlandRelaySkin& Skin);
	void RebuildInspector();
	FText SurfaceLabel(FName SurfaceId) const;
	FText ChipLabel(FName SurfaceId) const;
	const FWonderlandBrainSurface* Surface(FName SurfaceId) const;

	FWonderlandBrainModel Model;
	FName Selected;
	const FSlateBrush* HologramBrush = nullptr;

	bool bSkinsOpen = false;
	/** True while a real sculpture is being framed in the hologram window; the still art stands down for it. */
	bool bSculptureLive = false;
	const FSlateBrush* SkinPreviewBrush = nullptr;
	/** The hole in the panel the world shows through. */
	TSharedPtr<SWidget> SkinPreviewWindow;
	/** The rectangle the brain is drawn in, measured rather than assumed. */
	TSharedPtr<SWidget> HologramWindow;
	TArray<FWonderlandRelaySkin> Skins;
	TAttribute<FName> EquippedSkin;
	FOnChooseSkin OnChooseSkin;
	FSimpleDelegate OnSkinPreviewPainted;

	FSimpleDelegate OnRequestClose;
	FSimpleDelegate OnRequestTerminal;
	FSimpleDelegate OnRequestMap;
	FSimpleDelegate OnRequestWonderWeb;
	FOnPropose OnPropose;
	FOnReview OnReview;

	TSharedPtr<SWidget> InspectorRoot;
	TSharedPtr<SVerticalBox> InspectorBody;
	TSharedPtr<SEditableTextBox> ProposalInput;

	FSlateRoundedBoxBrush PanelBrush;
	FSlateRoundedBoxBrush CardBrush;
	FSlateRoundedBoxBrush SelectedBrush;
	FSlateRoundedBoxBrush InspectorBrush;
	FSlateRoundedBoxBrush YoursBadge;
	FSlateRoundedBoxBrush ReviewBadge;
	FSlateRoundedBoxBrush SystemBadge;
	FSlateRoundedBoxBrush InputBrush;
	FSlateRoundedBoxBrush ButtonBrush;
	FSlateRoundedBoxBrush ButtonHoverBrush;
	FSlateRoundedBoxBrush RuleBrush;
	FSlateRoundedBoxBrush StatusBrush;
	/** An outline with no fill: the preview window's frame. */
	FSlateRoundedBoxBrush SkinWindowFrameBrush;
	FSlateRoundedBoxBrush SkinPanelFrameBrush;
	FSlateRoundedBoxBrush SkinPanelSolidBrush;
	/** The 360 pill in the preview's corner: an outline that fills faintly under the pointer, and nothing more. */
	FSlateRoundedBoxBrush InspectBrush;
	FSlateRoundedBoxBrush InspectHoverBrush;
	FSlateRoundedBoxBrush InspectOnBrush;
	FButtonStyle InspectStyle;
	/** One white rounded chip, tinted per swatch, and one ring drawn over whichever swatch is chosen. */
	FSlateRoundedBoxBrush SwatchBrush;
	FSlateRoundedBoxBrush SwatchRingBrush;
	FButtonStyle SwatchStyle;

	FSimpleDelegate OnToggleInspect;
	TAttribute<bool> IsInspecting;

	/** The PRIMARY / SECONDARY swatch strip that lives under the preview. See MakeColourStrip. */
	TSharedRef<SWidget> MakeColourStrip();
	TSharedRef<SWidget> MakeSwatchRow(bool bPrimary);
	FSlateBrush ClearBrush;
	FButtonStyle SelectableStyle;
	FButtonStyle ActionStyle;
	FEditableTextBoxStyle InputStyle;
};
