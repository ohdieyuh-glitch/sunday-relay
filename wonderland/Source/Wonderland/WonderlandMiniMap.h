// WONDERLAND — the mini-map: the ground around the Dog, from above, as it is right now.
//
// A LIVE PICTURE, NOT A PAINTED ONE. A small orthographic scene capture hangs over the player and photographs the
// world straight down a few times a second; the map draws that photograph through a circular window. It therefore
// shows whatever is actually built around the visitor today -- and this world is rebuilt district by district,
// so a map baked once would be wrong by the next re-offer. Nothing on it is decorative geography.
//
// THE SAME PLAN AS THE WORLD MAP. North is +Y and screen-right is -X, exactly as SWonderlandMapCanvas draws it,
// so a visitor who opens the big map sees the little one enlarged rather than mirrored or turned.
//
// PLACES AND NAMES COME FROM THE TRAVEL REGISTRY. The district under the title is the nearest place the registry
// OFFERS -- audited, developed, with an arrival anchor in this world -- so the map can never name a district that
// is not there. Between districts it says which way the nearest one lies instead of inventing a name for the gap.
//
// IT COSTS NOTHING WHILE IT CANNOT BE SEEN. The capture runs only while the widget has painted recently, so a
// full-screen panel over the map stops the camera.
#pragma once

#include "CoreMinimal.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Containers/Ticker.h"
#include "Engine/DeveloperSettings.h"
#include "Styling/SlateBrush.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/SLeafWidget.h"
#include "WonderlandTravel.h"
#include "WonderlandMiniMap.generated.h"

class AActor;
class APlayerController;
class USceneCaptureComponent2D;
class UTextureRenderTarget2D;

/** Project Settings > Game > Wonderland Mini-Map, stored in DefaultGame.ini. */
UCLASS(Config = Game, DefaultConfig, meta = (DisplayName = "Wonderland Mini-Map"))
class WONDERLAND_API UWonderlandMiniMapSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	/** The title line. The world's name, not a district's. */
	UPROPERTY(Config, EditAnywhere, Category = "Label")
	FString WorldName = TEXT("WONDERLAND");

	/** How far from the Dog the edge of the disc reaches, uu. */
	UPROPERTY(Config, EditAnywhere, Category = "Map", meta = (ClampMin = "500.0"))
	float ViewRadiusUU = 3600.0f;

	/** Width of the ground each photograph covers, uu. Wider than the disc so it can slide between captures. */
	UPROPERTY(Config, EditAnywhere, Category = "Capture", meta = (ClampMin = "1000.0"))
	float CaptureWidthUU = 10000.0f;

	/** How far above the Dog the camera hangs, uu. Canopies higher than this are left out of the picture. */
	UPROPERTY(Config, EditAnywhere, Category = "Capture", meta = (ClampMin = "200.0"))
	float CaptureHeightUU = 3000.0f;

	/** Photographs per second while the map is on screen. */
	UPROPERTY(Config, EditAnywhere, Category = "Capture", meta = (ClampMin = "1.0", ClampMax = "30.0"))
	float CaptureHz = 4.0f;

	UPROPERTY(Config, EditAnywhere, Category = "Capture", meta = (ClampMin = "128", ClampMax = "1024"))
	int32 RenderTargetSize = 512;

	/** Shadows give the ground relief and cost a shadow pass per photograph. Off by default. */
	UPROPERTY(Config, EditAnywhere, Category = "Capture")
	bool bCaptureShadows = false;

	/** A place counts as the district you are IN within this distance of its anchor, uu. */
	UPROPERTY(Config, EditAnywhere, Category = "Label", meta = (ClampMin = "500.0"))
	float RegionRadiusUU = 7000.0f;

	virtual FName GetCategoryName() const override { return TEXT("Game"); }
};

/** One offered place as the mini-map knows it. Plain data: parity-safe, and resolvable without a world. */
struct FWonderlandMiniMapPlace
{
	FName Id;
	FString Name;
	/** The registry's District grouping. Empty for a place that is its own district. */
	FString Region;
	EWonderlandTravelKind Kind = EWonderlandTravelKind::District;
	FVector2D XY = FVector2D::ZeroVector;
};

/** The two lines under the disc. */
struct FWonderlandMiniMapLabel
{
	FString World;
	FString Region;
	FName RegionPlaceId;
	double RegionDistanceUU = -1.0;
	bool bInsideRegion = false;
};

/**
 * Which district the player is in. The nearest place that names a region -- any arrival, district or quarter, or
 * a landmark the registry files under a district -- within RegionRadiusUU; beyond that, "TOWARD" the nearest one.
 * A landmark with no district of its own never names the region: standing at the Grand Clock you are still in
 * whatever district holds it.
 */
WONDERLAND_API FWonderlandMiniMapLabel WonderlandResolveMiniMapLabel(const TArray<FWonderlandMiniMapPlace>& Places,
	const FVector2D& PlayerXY, double RegionRadiusUU, const FString& WorldName);

/** World XY to pixels from the disc centre, north-up: +Y is up the screen and -X is right. */
inline FVector2D WonderlandMiniMapOffset(const FVector2D& WorldXY, const FVector2D& PlayerXY, double UUPerPixel)
{
	const double K = FMath::Max(UUPerPixel, 1e-3);
	return FVector2D((PlayerXY.X - WorldXY.X) / K, (PlayerXY.Y - WorldXY.Y) / K);
}

/** A world yaw as a screen angle on the same plan, degrees, 0 = screen-right, 90 = screen-down. */
inline double WonderlandMiniMapScreenAngle(double YawDeg)
{
	const double Rad = FMath::DegreesToRadians(YawDeg);
	return FMath::RadiansToDegrees(FMath::Atan2(-FMath::Sin(Rad), -FMath::Cos(Rad)));
}

/** Everything the disc needs for one paint. */
struct FWonderlandMiniMapFrame
{
	bool bHasPlayer = false;
	FVector2D PlayerXY = FVector2D::ZeroVector;
	double PawnYawDeg = 0.0;
	double CameraYawDeg = 0.0;
	bool bHasCapture = false;
	FVector2D CaptureCentreXY = FVector2D::ZeroVector;
	double CaptureWidthUU = 10000.0;
	double ViewRadiusUU = 3600.0;
	TArray<FWonderlandMiniMapPlace> NearbyPlaces;
	FWonderlandMiniMapLabel Label;
};

/** Keeps the camera over the Dog and the frame current. Owned by the UI subsystem, one per attached player. */
UCLASS()
class WONDERLAND_API UWonderlandMiniMapDriver : public UObject
{
	GENERATED_BODY()

public:
	void Start(APlayerController* InController);
	void Stop();

	/** The widget calls this from OnPaint: the camera runs only while the map has been drawn recently. */
	void NotePainted() const { LastPaintSeconds = FPlatformTime::Seconds(); }

	const FWonderlandMiniMapFrame& GetFrame() const { return Frame; }
	const FSlateBrush* GetCaptureBrush() const { return Target != nullptr ? &CaptureBrush : nullptr; }
	int32 GetCaptureCount() const { return CaptureCount; }
	bool IsCaptureInWorld() const;

private:
	bool Tick(float DeltaTime);
	bool EnsureCapture(UWorld* World);
	void RefreshPlaces(UWorld* World);
	void ApplyCaptureSettings();

	UPROPERTY(Transient)
	TObjectPtr<UTextureRenderTarget2D> Target;

	TWeakObjectPtr<AActor> CaptureActor;
	TWeakObjectPtr<USceneCaptureComponent2D> Capture;
	TWeakObjectPtr<APlayerController> Controller;
	FTSTicker::FDelegateHandle TickHandle;
	FSlateBrush CaptureBrush;
	FWonderlandMiniMapFrame Frame;
	TArray<FWonderlandMiniMapPlace> Places;
	double LastCaptureSeconds = -1.0;
	double LastPlacesSeconds = -1.0;
	mutable double LastPaintSeconds = -1.0;
	int32 CaptureCount = 0;
};

/** The disc: photograph, places, the Dog's arrow, the camera's view and the compass ring. */
class WONDERLAND_API SWonderlandMiniMapDisc : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandMiniMapDisc) : _Diameter(196.0f) {}
		SLATE_ARGUMENT(TWeakObjectPtr<UWonderlandMiniMapDriver>, Driver)
		SLATE_ARGUMENT(float, Diameter)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(Diameter, Diameter); }
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;

	// WHAT WAS DRAWN, recorded by the paint itself, so a test reads the picture's own numbers.
	double GetDrawnArrowAngleDeg() const { return DrawnArrowAngleDeg; }
	double GetDrawnViewAngleDeg() const { return DrawnViewAngleDeg; }
	double GetDrawnUUPerPixel() const { return DrawnUUPerPixel; }
	bool DidDrawCapture() const { return bDrewCapture; }
	int32 GetPaintCount() const { return PaintCount; }
	/** Pixels from the disc centre of a place's marker on the last paint; false when it was not on the disc. */
	bool GetDrawnMarkerOffset(FName PlaceId, FVector2D& OutOffset) const;

private:
	TWeakObjectPtr<UWonderlandMiniMapDriver> Driver;
	float Diameter = 196.0f;
	// No default constructor on a rounded box brush: placeholders here, the real ones sized in Construct.
	FSlateRoundedBoxBrush Shadow = FSlateRoundedBoxBrush(FLinearColor::Transparent, 1.0f, FLinearColor::Transparent, 0.0f);
	FSlateRoundedBoxBrush Fill = FSlateRoundedBoxBrush(FLinearColor::Transparent, 1.0f, FLinearColor::Transparent, 0.0f);
	FSlateRoundedBoxBrush Ring = FSlateRoundedBoxBrush(FLinearColor::Transparent, 1.0f, FLinearColor::Transparent, 0.0f);
	FSlateRoundedBoxBrush OuterRing = FSlateRoundedBoxBrush(FLinearColor::Transparent, 1.0f, FLinearColor::Transparent, 0.0f);
	FSlateRoundedBoxBrush NorthPill = FSlateRoundedBoxBrush(FLinearColor::Transparent, 1.0f, FLinearColor::Transparent, 0.0f);

	mutable double DrawnArrowAngleDeg = 0.0;
	mutable double DrawnViewAngleDeg = 0.0;
	mutable double DrawnUUPerPixel = 0.0;
	mutable bool bDrewCapture = false;
	mutable int32 PaintCount = 0;
	mutable TMap<FName, FVector2D> DrawnMarkers;

public:
	/** Draw mode 4 only: the render target's resource proxy region, or "proxy none". For isolating the white disc. */
	mutable FString LastProxyNote;
};

/** The disc with its two lines of title beneath, as the reference frames it. */
class WONDERLAND_API SWonderlandMiniMap : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandMiniMap) {}
		SLATE_ARGUMENT(TWeakObjectPtr<UWonderlandMiniMapDriver>, Driver)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	TSharedPtr<SWonderlandMiniMapDisc> GetDisc() const { return Disc; }
	FString GetWorldLine() const;
	FString GetRegionLine() const;

private:
	TWeakObjectPtr<UWonderlandMiniMapDriver> Driver;
	TSharedPtr<SWonderlandMiniMapDisc> Disc;
	FSlateRoundedBoxBrush LabelBrush = FSlateRoundedBoxBrush(FLinearColor(0.02f, 0.025f, 0.045f, 0.55f), 8.0f, FLinearColor::Transparent, 0.0f);
};
