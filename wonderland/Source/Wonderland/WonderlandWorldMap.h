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
#include "Layout/SlateRect.h"
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

/**
 * The plan itself: markers, labels, hover and pick -- and, since the founder's map review of 2026-09-30, a plan that
 * does not tangle.
 *
 * FOUNDER: "The current map has too many destination labels and markers concentrated on top of each other around the
 * center ... Spread destination markers/labels apart visually. Prevent labels from overlapping each other ... Preserve
 * the truthful relative direction/location of destinations ... Dense areas should progressively reveal detail instead of
 * displaying every name simultaneously. Important destinations can remain more prominent ... Do NOT move actual
 * Wonderland locations merely to make the UI cleaner."
 *
 * The cause was geometry, not taste: the offered places span 2.5 km, the canvas is a few hundred pixels, and fifteen
 * of them stand within 150 m of the gate -- so at the one scale the map had, the whole Golden Arrival was a knot thirty
 * pixels across with fifteen names printed into it. So:
 *
 *   MARKERS NEVER MOVE. Every marker is drawn exactly where its arrival point projects (north-up, the same transform as
 *   before); only LABELS move. A label that cannot sit beside its marker is set further out on a leader line.
 *   ZOOM AND PAN. Wheel (about the cursor), drag, the + / - / FIT controls, or + - and Home on the keyboard. FIT is the
 *   old whole-world view; zooming in is how a dense district is read.
 *   CLUSTERS. Markers closer than a marker's width at the current zoom fold into the most important of them, which is
 *   drawn with a group ring and a "+N" on its label; the folded places stay visible as small dots at their true
 *   positions. Clicking a group zooms into it until it comes apart.
 *   PRIORITY. Labels are placed most-important first -- the selected and hovered place, then the arrival, the quarters,
 *   the landmarks, the districts -- each at the first of 24 candidate positions that overlaps no label, no marker and no
 *   leader line already placed. A name that fits nowhere is not drawn at this zoom; it appears as the view opens up.
 */
class WONDERLAND_API SWonderlandMapCanvas : public SLeafWidget
{
public:
	DECLARE_DELEGATE_OneParam(FOnPick, int32 /*StopIndex*/);

	SLATE_BEGIN_ARGS(SWonderlandMapCanvas) {}
		SLATE_EVENT(FOnPick, OnPick)
	SLATE_END_ARGS()

	/** One stop as it was last painted. Hit testing and the proofs both read this, never a re-derivation. */
	struct FPlaced
	{
		int32 Index = INDEX_NONE;
		int32 Tier = 3;
		FVector2f Marker = FVector2f::ZeroVector;
		float Radius = 0.0f;
		/** The glow round the marker: its visual footprint, and what every label keeps clear of. */
		float Halo = 0.0f;
		bool bOnScreen = false;
		/** Its own marker is drawn: a place standing alone, or the leader of a group. */
		bool bDrawn = false;
		/** Folded into a group: the leader it is counted under. */
		int32 Leader = INDEX_NONE;
		/** A leader: how many other places it stands for. */
		int32 Members = 0;
		bool bLabel = false;
		FSlateRect Label;
		bool bLeaderLine = false;
		FVector2f LineFrom = FVector2f::ZeroVector;
		FVector2f LineTo = FVector2f::ZeroVector;
	};

	void Construct(const FArguments& InArgs);
	void SetStops(const TArray<FWonderlandMapStop>& InStops, const FVector2D& InPlayerXY, bool bInHasPlayer, int32 InCurrent);
	void SetSelected(int32 Index);

	/** 1 is the whole world (FIT); larger is closer. Clamped to [1, MaxZoom]. Keeps the view centre. */
	void SetZoom(float InZoom);
	float GetZoom() const { return Zoom; }
	/** The whole world, as the map always opened before. */
	void FitView();
	/** Centre the view on a place, zoomed in to at least MinZoom. */
	void CentreOn(int32 Index, float MinZoom);
	/** Pan just enough that a place is on the canvas (keyboard selection of a place off the edge). */
	void EnsureVisible(int32 Index);
	/** The last painted layout as JSON: size, centre, scale (px per uu), zoom, and one row per stop. */
	FString DescribeLayout() const;

	static constexpr float MaxZoom = 16.0f;

	virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(640.0, 520.0); }
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;
	virtual FReply OnMouseMove(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseButtonUp(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseWheel(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual void OnMouseLeave(const FPointerEvent& MouseEvent) override;
	virtual FCursorReply OnCursorQuery(const FGeometry& MyGeometry, const FPointerEvent& CursorEvent) const override;

private:
	FVector2f ToLocal(const FVector2D& WorldXY, const FVector2f& Size) const;
	double PixelsPerUnit(const FVector2f& Size) const;
	void RecomputeBounds();
	void ClampView();
	void ZoomAbout(float NewZoom, const FVector2f& LocalPoint, const FVector2f& Size);
	/** Markers, groups and label positions for this size and view. Called by OnPaint; the result is kept in Layout. */
	void BuildLayout(const FVector2f& Size) const;
	/** The stop under a local point from the last layout: a label, then the nearest drawn marker. */
	int32 StopAtLocal(const FVector2f& Local) const;
	/** The zoom controls: 0 zoom in, 1 zoom out, 2 fit. INDEX_NONE when the point is on none of them. */
	int32 ControlAtLocal(const FVector2f& Local) const;
	FSlateRect ControlRect(int32 Which) const;
	static int32 TierOf(const FWonderlandTravelDestination& Row);

	TArray<FWonderlandMapStop> Stops;
	FVector2D PlayerXY = FVector2D::ZeroVector;
	bool bHasPlayer = false;
	int32 Hovered = INDEX_NONE;
	int32 HoveredControl = INDEX_NONE;
	int32 Selected = INDEX_NONE;
	int32 Current = INDEX_NONE;
	FVector2D BoundsMin = FVector2D(-1000.0, -1000.0);
	FVector2D BoundsMax = FVector2D(1000.0, 1000.0);
	float Zoom = 1.0f;
	FVector2D ViewCentre = FVector2D::ZeroVector;
	bool bPressed = false;
	bool bDragged = false;
	FVector2f PressLocal = FVector2f::ZeroVector;
	FVector2f LastDragLocal = FVector2f::ZeroVector;
	FOnPick OnPick;
	FSlateBrush Circle;
	FSlateRoundedBoxBrush Backdrop = FSlateRoundedBoxBrush(FLinearColor(0.004f, 0.006f, 0.014f, 0.92f), 12.0f,
		FLinearColor(0.70f, 0.37f, 0.05f, 0.30f), 1.0f);
	FSlateRoundedBoxBrush Plate = FSlateRoundedBoxBrush(FLinearColor(0.004f, 0.006f, 0.014f, 0.78f), 4.0f);
	FSlateRoundedBoxBrush ControlBrush = FSlateRoundedBoxBrush(FLinearColor(0.02f, 0.02f, 0.03f, 0.92f), 5.0f,
		FLinearColor(0.70f, 0.37f, 0.05f, 0.55f), 1.0f);

	mutable TArray<FPlaced> Layout;
	/** The player's marker and its YOU tag, placed through the same rule as every label. */
	mutable bool bYouShown = false;
	mutable bool bYouLabel = false;
	mutable bool bYouLine = false;
	mutable FVector2f YouAt = FVector2f::ZeroVector;
	mutable FSlateRect YouLabel;
	mutable FVector2f YouLineFrom = FVector2f::ZeroVector;
	mutable FVector2f YouLineTo = FVector2f::ZeroVector;
	mutable FVector2f LayoutSize = FVector2f::ZeroVector;
	mutable FVector2f LayoutAbsolute = FVector2f::ZeroVector;
	mutable float LayoutScale = 1.0f;
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

	/** The plan's zoom and view, for the keyboard, the UI subsystem and the proofs (see SWonderlandMapCanvas). */
	void SetMapZoom(float Zoom);
	float GetMapZoom() const;
	void FitMap();
	/** Centre on a place at zoom 8 at least. False for an id the map does not show. */
	bool CentreMapOn(FName Id);
	FString DescribeMapLayout() const;

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
