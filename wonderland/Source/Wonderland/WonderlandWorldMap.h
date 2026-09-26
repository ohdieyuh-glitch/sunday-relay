// WONDERLAND — the world map: developed places, and the way to each.
//
// A NAVIGATION INSTRUMENT, NOT A PROMISE. The map shows what the travel registry
// offers on this map and nothing else — a place is on it because an audit of the
// real world found authored content and a safe arrival point there. Future
// districts are not drawn as greyed-out teasers; an empty field with a label on it
// is exactly the thing this map exists to keep a visitor away from.
//
// Positions come from the anchors actually placed in the world, projected onto a
// north-up plan; the "you" marker is the pawn's real position. Nothing on it is
// decorative geography.
#pragma once

#include "CoreMinimal.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Styling/SlateTypes.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/SLeafWidget.h"
#include "WonderlandTravel.h"
#include "WonderlandTerritory.h"

class STextBlock;

/** One place as the map draws it. */
struct FWonderlandMapStop
{
	FWonderlandTravelDestination Row;
	/** Where the arrival anchor stands, world X/Y. */
	FVector2D AnchorXY = FVector2D::ZeroVector;
};

/** The plan itself: markers, labels, hover and pick. */
class WONDERLAND_API SWonderlandMapCanvas : public SLeafWidget
{
public:
	DECLARE_DELEGATE_OneParam(FOnPick, int32 /*StopIndex*/);

	SLATE_BEGIN_ARGS(SWonderlandMapCanvas) {}
		SLATE_EVENT(FOnPick, OnPick)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	void SetStops(const TArray<FWonderlandMapStop>& InStops, const FVector2D& InPlayerXY, bool bInHasPlayer, int32 InCurrent);
	void SetSelected(int32 Index);

	virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(640.0, 520.0); }
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;
	virtual FReply OnMouseMove(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual void OnMouseLeave(const FPointerEvent& MouseEvent) override;
	virtual FCursorReply OnCursorQuery(const FGeometry& MyGeometry, const FPointerEvent& CursorEvent) const override;

private:
	FVector2f ToLocal(const FVector2D& WorldXY, const FVector2f& Size) const;
	int32 StopAt(const FGeometry& Geometry, const FVector2D& ScreenPosition) const;
	void RecomputeBounds();

	TArray<FWonderlandMapStop> Stops;
	FVector2D PlayerXY = FVector2D::ZeroVector;
	bool bHasPlayer = false;
	int32 Hovered = INDEX_NONE;
	int32 Selected = INDEX_NONE;
	int32 Current = INDEX_NONE;
	FVector2D BoundsMin = FVector2D(-1000.0, -1000.0);
	FVector2D BoundsMax = FVector2D(1000.0, 1000.0);
	FOnPick OnPick;
	FSlateBrush Circle;
	FSlateRoundedBoxBrush Backdrop = FSlateRoundedBoxBrush(FLinearColor(0.004f, 0.006f, 0.014f, 0.92f), 12.0f,
		FLinearColor(0.70f, 0.37f, 0.05f, 0.30f), 1.0f);
};

/**
 * ONE TERRITORY AS THE MAP SEES IT: the canon row, plus where the player is standing in relation to it.
 *
 * The widget holds no lore of its own -- everything in Row was copied out of WorldDesign/CANON by
 * Tools/territory_registry.py and handed here through UWonderlandUiSubsystem::RefreshTerritories.
 */
struct WONDERLAND_API FWonderlandMapTerritory
{
	FWonderlandTerritory Row;
	bool bDiscovered = false;
	bool bHere = false;
	float BearingDeg = -1.0f;
	float DistanceM = -1.0f;
	FString Way;
};

class WONDERLAND_API SWonderlandWorldMap : public SCompoundWidget
{
public:
	DECLARE_DELEGATE_OneParam(FOnTravel, FName /*DestinationId*/);

	SLATE_BEGIN_ARGS(SWonderlandWorldMap) {}
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
		SLATE_EVENT(FOnTravel, OnTravel)
		/** Ctrl+T pressed over the map: the visitor wants the terminal instead. */
		SLATE_EVENT(FSimpleDelegate, OnRequestTerminal)
	SLATE_END_ARGS()

	SWonderlandWorldMap();
	void Construct(const FArguments& InArgs);

	/** Refill from the travel subsystem. Keeps the selection when the place is still offered. */
	void Refresh(const TArray<FWonderlandMapStop>& InStops, FName CurrentId, const FVector2D& InPlayerXY, bool bInHasPlayer, const FString& Notice);

	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;

	/**
	 * THE TERRITORIES, AND WHY THEY LIVE IN THE MAP.
	 *
	 * FOUNDER, 2026-09-25: "Integrate this into the existing navigation/UI rather than creating a second
	 * competing system ... A player should be able to answer: Where am I? Where is ICARUS? Where is NOCTIS?
	 * Where is TARTARUS? What is that territory for? How do I get there?"
	 *
	 * The world map is where a player already goes to ask every one of those, so this is a strip along the
	 * bottom of it rather than a panel somewhere else. Selecting a territory answers the last four questions in
	 * the detail column; the strip itself answers the first, because the one you are standing in says HERE.
	 */
	void RefreshTerritories(const TArray<FWonderlandMapTerritory>& InTerritories);

	FName GetSelectedTerritory() const { return SelectedTerritory; }
	int32 GetTerritoryCount() const { return Territories.Num(); }

	/** Select a territory by id, exactly as clicking its chip does. False for one the registry does not hold. */
	bool SelectTerritory(FName Id);

	/** What the detail column is showing for the selected territory, "|"-joined, for a proof to read. */
	FString DescribeTerritoryPanel() const;

	FName GetSelectedId() const;
	int32 GetStopCount() const { return Stops.Num(); }
	void SelectById(FName Id);

private:
	void Select(int32 Index);
	FReply HandleTeleportClicked();
	FString KindLabel(const FWonderlandTravelDestination& Row) const;

	TArray<FWonderlandMapStop> Stops;
	int32 SelectedIndex = INDEX_NONE;
	FName CurrentId;
	FVector2D PlayerXY = FVector2D::ZeroVector;
	bool bHasPlayer = false;

	TSharedPtr<SWonderlandMapCanvas> Canvas;
	TSharedPtr<STextBlock> KindText;
	TSharedPtr<STextBlock> NameText;
	TSharedPtr<STextBlock> StatusText;
	TSharedPtr<STextBlock> DescriptionText;
	TSharedPtr<STextBlock> DistanceText;
	TSharedPtr<STextBlock> NoticeText;
	TSharedPtr<class SHorizontalBox> TerritoryStrip;
	TSharedPtr<class SVerticalBox> TerritoryDetail;
	TArray<FWonderlandMapTerritory> Territories;
	FName SelectedTerritory;
	void RebuildTerritoryStrip();
	void ShowTerritory(FName Id);

	FSimpleDelegate OnRequestClose;
	FSimpleDelegate OnRequestTerminal;
	FOnTravel OnTravel;

	FSlateRoundedBoxBrush PanelBrush;
	FSlateRoundedBoxBrush CardBrush;
	FSlateRoundedBoxBrush ChipBrush;
	FSlateRoundedBoxBrush ButtonNormal;
	FSlateRoundedBoxBrush ButtonHovered;
	FSlateRoundedBoxBrush ButtonPressed;
	FSlateRoundedBoxBrush RuleBrush;
	FSlateBrush ScrimBrush;
	FButtonStyle TeleportStyle;
	FSlateRoundedBoxBrush TerritoryChip;
	FSlateRoundedBoxBrush TerritoryChipOn;
	FButtonStyle TerritoryChipStyle;
};
