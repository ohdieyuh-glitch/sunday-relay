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
// proposals, recorded in this session and marked NOT SYNCED.
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
	bool IsSkinsOpen() const { return bSkinsOpen; }

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
	const FSlateBrush* SkinPreviewBrush = nullptr;
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
	FSlateBrush ClearBrush;
	FButtonStyle SelectableStyle;
	FButtonStyle ActionStyle;
	FEditableTextBoxStyle InputStyle;
};
