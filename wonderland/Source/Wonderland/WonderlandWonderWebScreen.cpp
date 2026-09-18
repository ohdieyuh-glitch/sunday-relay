#include "WonderlandWonderWebScreen.h"

#include "Camera/CameraComponent.h"
#include "Camera/PlayerCameraManager.h"
#include "Engine/GameViewportClient.h"
#include "Engine/LocalPlayer.h"
#include "Framework/Application/SlateApplication.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "InputCoreTypes.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Slate/SRetainerWidget.h"
#include "Widgets/Images/SImage.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SDPIScaler.h"
#include "WonderlandWonderWebPanel.h"

namespace WonderWebScreenTuning
{
	// A WORKSPACE IN THE GARDEN, framed by the camera with the world round its edges: stood a little over three metres out
	// ahead of where the player is looking and raised above the Dog, the camera 385 uu back from the glass.
	//
	// THE WINDOW SIZE IS A MULTITASKING SIZE (founder, 2026-09-17: "a little smaller ... 2-3 active Wonder Web surfaces
	// visible simultaneously"): a window's glass is 240 uu wide at size 1 -- about 40% of the view's width -- and the
	// workspace tiles the windows in the space the HUD leaves (WonderlandUiSubsystem.cpp, TileWonderWeb).
	TAutoConsoleVariable<float> CVarWindowWidth(TEXT("wl.WonderWeb.WindowWidth"), 240.0f, TEXT("Wonder Web window: the glass's width at the multitasking size, uu."));
	TAutoConsoleVariable<float> CVarChipScale(TEXT("wl.WonderWeb.ChipScale"), 0.2f, TEXT("Wonder Web window: uu per chip pixel for a minimized window's chip."));
	TAutoConsoleVariable<float> CVarAhead(TEXT("wl.WonderWeb.ScreenAhead"), 330.0f, TEXT("Wonder Web workspace: how far ahead of the Dog it stands, along the player's view, uu."));
	TAutoConsoleVariable<float> CVarUp(TEXT("wl.WonderWeb.ScreenUp"), 150.0f, TEXT("Wonder Web workspace: how high its centre stands above the Dog, uu."));
	TAutoConsoleVariable<float> CVarViewDistance(TEXT("wl.WonderWeb.ViewDistance"), 385.0f, TEXT("Wonder Web workspace: the camera's distance back from the glass, uu."));
	TAutoConsoleVariable<float> CVarViewSide(TEXT("wl.WonderWeb.ViewSide"), -16.0f, TEXT("Wonder Web workspace: the camera's sideways offset, uu."));
	TAutoConsoleVariable<float> CVarViewLift(TEXT("wl.WonderWeb.ViewLift"), 8.0f, TEXT("Wonder Web workspace: the camera's height above the glass's centre, uu."));
	TAutoConsoleVariable<float> CVarViewFov(TEXT("wl.WonderWeb.ViewFov"), 75.0f, TEXT("Wonder Web workspace: the camera's horizontal field of view, degrees."));
	TAutoConsoleVariable<float> CVarGlideSeconds(TEXT("wl.WonderWeb.GlideSeconds"), 0.18f, TEXT("Wonder Web window: the timescale of its glide to a new place, seconds (critically damped: swift, no overshoot)."));
	TAutoConsoleVariable<float> CVarEdgeMargin(TEXT("wl.WonderWeb.EdgeMargin"), 10.0f, TEXT("Wonder Web window: how far inside the view's edge a side or corner place keeps the glass, uu."));
	TAutoConsoleVariable<float> CVarGrowSeconds(TEXT("wl.WonderWeb.GrowSeconds"), 0.3f, TEXT("Wonder Web window: seconds to open out, fold away, minimize or restore."));
	TAutoConsoleVariable<float> CVarResizeSeconds(TEXT("wl.WonderWeb.ResizeSeconds"), 0.16f, TEXT("Wonder Web window: the timescale of growing or shrinking to a new size, seconds."));
	// A BACKGROUND WINDOW KEEPS WORKING AND IS DRAWN LESS OFTEN: the focused one every frame, the others once every few.
	TAutoConsoleVariable<int32> CVarBackgroundRedrawFrames(TEXT("wl.WonderWeb.BackgroundRedrawFrames"), 4,
		TEXT("Wonder Web window: a window that is not focused is redrawn once every this many frames (1 draws it every frame)."));
}

/* ==================================================================== the workspace */

AWonderlandWonderWebWorkspace::AWonderlandWonderWebWorkspace()
{
	PrimaryActorTick.bCanEverTick = false;
	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Anchor"));
	SetRootComponent(Root);
	View = CreateDefaultSubobject<UCameraComponent>(TEXT("WonderWebView"));
	View->SetupAttachment(Root);
	View->bConstrainAspectRatio = false;
}

void AWonderlandWonderWebWorkspace::StandBefore(APlayerController* Controller)
{
	using namespace WonderWebScreenTuning;
	if (Controller == nullptr)
	{
		return;
	}
	// WHERE THE PLAYER IS LOOKING, AHEAD OF THE DOG: the frame stands there facing back toward them.
	const APawn* Pawn = Controller->GetPawn();
	const float Yaw = Controller->PlayerCameraManager != nullptr ? Controller->PlayerCameraManager->GetCameraRotation().Yaw : Controller->GetControlRotation().Yaw;
	const FVector Ahead = FRotator(0.0f, Yaw, 0.0f).Vector();
	const FVector From = Pawn != nullptr ? Pawn->GetActorLocation()
		: (Controller->PlayerCameraManager != nullptr ? Controller->PlayerCameraManager->GetCameraLocation() : FVector::ZeroVector);
	SetActorLocationAndRotation(From + Ahead * CVarAhead.GetValueOnGameThread() + FVector(0.0, 0.0, CVarUp.GetValueOnGameThread()),
		FRotator(0.0f, Yaw + 180.0f, 0.0f));
	// THE CAMERA STANDS IN FRONT OF THE GLASS, on +X, looking back along -X: across the view is the anchor's -Y, up is +Z.
	View->SetRelativeLocationAndRotation(
		FVector(CVarViewDistance.GetValueOnGameThread(), CVarViewSide.GetValueOnGameThread(), CVarViewLift.GetValueOnGameThread()),
		FRotator(-FMath::RadiansToDegrees(FMath::Atan2(CVarViewLift.GetValueOnGameThread(), FMath::Max(CVarViewDistance.GetValueOnGameThread(), 1.0f))), 180.0f, 0.0f));
	View->SetFieldOfView(CVarViewFov.GetValueOnGameThread());
}

FVector2D AWonderlandWonderWebWorkspace::HalfView() const
{
	using namespace WonderWebScreenTuning;
	const double Distance = FMath::Max(CVarViewDistance.GetValueOnGameThread(), 1.0f);
	const double HalfWide = Distance * FMath::Tan(FMath::DegreesToRadians(CVarViewFov.GetValueOnGameThread() * 0.5));
	double Aspect = 16.0 / 9.0;
	if (const UWorld* World = GetWorld())
	{
		if (const UGameViewportClient* ViewportClient = World->GetGameViewport())
		{
			FVector2D Size;
			ViewportClient->GetViewportSize(Size);
			if (Size.Y > 0.0)
			{
				Aspect = Size.X / Size.Y;
			}
		}
	}
	return FVector2D(HalfWide, HalfWide / Aspect);
}

/* ==================================================================== one window's place */

AWonderlandWonderWebScreen::AWonderlandWonderWebScreen()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bTickEvenWhenPaused = true;
	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);
}

void AWonderlandWonderWebScreen::Present(const FVector2D& WindowSize, const FVector2D& ChipSize, AWonderlandWonderWebWorkspace* InWorkspace)
{
	WindowPixels = WindowSize;
	ChipPixels = ChipSize;
	Workspace = InWorkspace;
	if (InWorkspace != nullptr && GetAttachParentActor() != InWorkspace)
	{
		AttachToComponent(InWorkspace->GetAnchor(), FAttachmentTransformRules::SnapToTargetNotIncludingScale);
	}
	bPresented = true;
}

void AWonderlandWonderWebScreen::Dismiss()
{
	bPresented = false;
	bDragging = false;
}

void AWonderlandWonderWebScreen::SetFocused(bool bInFocused)
{
	bFocused = bInFocused;
}

void AWonderlandWonderWebScreen::SetMinimized(bool bInMinimized)
{
	bMinimized = bInMinimized;
	if (bMinimized)
	{
		bDragging = false;
	}
}

FVector2D AWonderlandWonderWebScreen::GlassSize() const
{
	const double Width = WonderWebScreenTuning::CVarWindowWidth.GetValueOnGameThread();
	const double Aspect = WindowPixels.X > 0.0 ? WindowPixels.Y / WindowPixels.X : 2.0 / 3.0;
	return FVector2D(Width, Width * Aspect) * SizeFactor;
}

void AWonderlandWonderWebScreen::Tick(float DeltaSeconds)
{
	using namespace WonderWebScreenTuning;
	Super::Tick(DeltaSeconds);
	const float Seconds = FMath::Max(CVarGrowSeconds.GetValueOnGameThread(), 0.01f);
	Grow = FMath::Clamp(Grow + ((bPresented && !bMinimized) ? 1.0f : -1.0f) * DeltaSeconds / Seconds, 0.0f, 1.0f);
	ChipGrow = FMath::Clamp(ChipGrow + ((bPresented && bMinimized) ? 1.0f : -1.0f) * DeltaSeconds / Seconds, 0.0f, 1.0f);

	// THE SIZE, critically damped toward the target like the glide: an expanded window grows, and settles, without bounce.
	FMath::CriticallyDampedSmoothing(SizeShown, SizeRate, SizeFactor, 0.0f, FMath::Min(DeltaSeconds, 0.1f), FMath::Max(CVarResizeSeconds.GetValueOnGameThread(), 0.02f));
	if (FMath::IsNearlyEqual(SizeShown, SizeFactor, 0.002f) && FMath::Abs(SizeRate) < 0.05f)
	{
		SizeShown = SizeFactor;
		SizeRate = 0.0f;
	}

	// THE GLIDE. Critically damped toward the target, in short sub-steps so a slow frame is still a smooth curve.
	const FVector2D Limit = Reach();
	if (!bDragging)
	{
		// A window on a named place keeps to it as its size changes; one tiled or dragged stays whole in the view.
		TargetOffset = bOnGrid ? FVector2D(Cell.X * Limit.X, Cell.Y * Limit.Y)
			: FVector2D(FMath::Clamp(TargetOffset.X, -Limit.X, Limit.X), FMath::Clamp(TargetOffset.Y, -Limit.Y, Limit.Y));
	}
	const float Glide = FMath::Max(CVarGlideSeconds.GetValueOnGameThread(), 0.02f);
	float Remaining = FMath::Min(DeltaSeconds, 0.25f);
	while (Remaining > 0.0f)
	{
		const float Slice = FMath::Min(Remaining, Glide * 0.4f);
		FMath::CriticallyDampedSmoothing(Offset, OffsetRate, TargetOffset, FVector2D::ZeroVector, Slice, Glide);
		Remaining -= Slice;
	}
	// IT ARRIVES, AND THEN IT IS STILL: within two uu and nearly stopped, it lands exactly.
	if (!bDragging && FVector2D::Distance(Offset, TargetOffset) < 2.0 && OffsetRate.Size() < 30.0)
	{
		Offset = TargetOffset;
		OffsetRate = FVector2D::ZeroVector;
	}
}

bool AWonderlandWonderWebScreen::ProjectGlass(APlayerController* Controller, bool bChip, FVector2D& OutViewportMin, FVector2D& OutViewportMax, float& OutOpen) const
{
	using namespace WonderWebScreenTuning;
	const float Open = bChip ? ChipGrow : Grow;
	OutOpen = FMath::SmoothStep(0.0f, 1.0f, Open);
	if (Controller == nullptr || Open <= 0.0f || Root == nullptr)
	{
		return false;
	}
	FVector2D Centre;
	FVector2D Size;
	if (!bChip)
	{
		const double Width = CVarWindowWidth.GetValueOnGameThread() * SizeShown;
		Size = FVector2D(Width, Width * WindowPixels.Y / FMath::Max(WindowPixels.X, 1.0));
		Centre = Offset;
	}
	else
	{
		// THE CHIP, along the bottom of the view from the left.
		const FVector2D Half = Workspace.IsValid() ? Workspace->HalfView() : FVector2D(295.0, 166.0);
		Size = ChipPixels * CVarChipScale.GetValueOnGameThread();
		const double Margin = CVarEdgeMargin.GetValueOnGameThread();
		Centre = FVector2D(-Half.X + Margin + Size.X * 0.5 + DockSlot * (Size.X + 6.0), -Half.Y + Margin + Size.Y * 0.5);
	}
	const FTransform& Xf = Root->GetComponentTransform();
	FVector2D Min(TNumericLimits<double>::Max(), TNumericLimits<double>::Max());
	FVector2D Max(TNumericLimits<double>::Lowest(), TNumericLimits<double>::Lowest());
	for (int32 Corner = 0; Corner < 4; ++Corner)
	{
		const double Across = Centre.X + ((Corner & 1) ? 0.5 : -0.5) * Size.X;
		const double Up = Centre.Y + ((Corner & 2) ? 0.5 : -0.5) * Size.Y;
		FVector2D Pixel;
		if (!Controller->ProjectWorldLocationToScreen(Xf.TransformPosition(FVector(0.0, -Across, Up)), Pixel, false))
		{
			return false;
		}
		Min = FVector2D(FMath::Min(Min.X, Pixel.X), FMath::Min(Min.Y, Pixel.Y));
		Max = FVector2D(FMath::Max(Max.X, Pixel.X), FMath::Max(Max.Y, Pixel.Y));
	}
	OutViewportMin = Min;
	OutViewportMax = Max;
	return Max.X > Min.X && Max.Y > Min.Y;
}

FVector2D AWonderlandWonderWebScreen::Reach() const
{
	using namespace WonderWebScreenTuning;
	// Half the view at the glass's distance, less half the glass and a margin: the glass stays whole in every place.
	const FVector2D Half = Workspace.IsValid() ? Workspace->HalfView() : FVector2D(295.0, 166.0);
	const FVector2D Glass = GlassSize() * 0.5;
	const double Margin = CVarEdgeMargin.GetValueOnGameThread();
	return FVector2D(FMath::Max(Half.X - Glass.X - Margin, 0.0), FMath::Max(Half.Y - Glass.Y - Margin, 0.0));
}

bool AWonderlandWonderWebScreen::MoveTo(FName InPlace)
{
	const FString Name = InPlace.ToString().ToLower();
	FIntPoint To;
	if (Name == TEXT("center") || Name == TEXT("centre") || Name == TEXT("middle")) { To = FIntPoint(0, 0); }
	else if (Name == TEXT("left"))         { To = FIntPoint(-1, 0); }
	else if (Name == TEXT("right"))        { To = FIntPoint(1, 0); }
	else if (Name == TEXT("top"))          { To = FIntPoint(0, 1); }
	else if (Name == TEXT("bottom"))       { To = FIntPoint(0, -1); }
	else if (Name == TEXT("top-left"))     { To = FIntPoint(-1, 1); }
	else if (Name == TEXT("top-right"))    { To = FIntPoint(1, 1); }
	else if (Name == TEXT("bottom-left"))  { To = FIntPoint(-1, -1); }
	else if (Name == TEXT("bottom-right")) { To = FIntPoint(1, -1); }
	else { return false; }
	Cell = To;
	Place = FName(*Name);
	bDragging = false;
	bOnGrid = true;
	const FVector2D Limit = Reach();
	TargetOffset = FVector2D(To.X * Limit.X, To.Y * Limit.Y);
	return true;
}

void AWonderlandWonderWebScreen::PlaceAt(const FVector2D& AcrossUp)
{
	bDragging = false;
	bOnGrid = false;
	Place = TEXT("tiled");
	TargetOffset = AcrossUp;
	const FVector2D Limit = Reach();
	Cell = FIntPoint(Limit.X > 1.0 ? FMath::Clamp(FMath::RoundToInt(AcrossUp.X / Limit.X), -1, 1) : 0, Limit.Y > 1.0 ? FMath::Clamp(FMath::RoundToInt(AcrossUp.Y / Limit.Y), -1, 1) : 0);
}

void AWonderlandWonderWebScreen::Step(int32 Across, int32 Up)
{
	static const TCHAR* Names[3][3] = {
		{ TEXT("bottom-left"), TEXT("left"), TEXT("top-left") },
		{ TEXT("bottom"), TEXT("center"), TEXT("top") },
		{ TEXT("bottom-right"), TEXT("right"), TEXT("top-right") } };
	const int32 X = FMath::Clamp(Cell.X + FMath::Sign(Across), -1, 1);
	const int32 Y = FMath::Clamp(Cell.Y + FMath::Sign(Up), -1, 1);
	MoveTo(Names[X + 1][Y + 1]);
}

bool AWonderlandWonderWebScreen::RayOnPlane(APlayerController* Controller, const FVector2D& ViewportPixel, FVector2D& OutAcrossUp) const
{
	FVector Origin;
	FVector Direction;
	if (Controller == nullptr || !Controller->DeprojectScreenPositionToWorld(ViewportPixel.X, ViewportPixel.Y, Origin, Direction))
	{
		return false;
	}
	const FTransform& RootXf = Root->GetComponentTransform();
	const FPlane Glass(RootXf.GetLocation(), RootXf.GetUnitAxis(EAxis::X));
	if (FMath::IsNearlyZero(FVector::DotProduct(Direction, Glass.GetNormal())))
	{
		return false;
	}
	const FVector Local = RootXf.InverseTransformPositionNoScale(FMath::RayPlaneIntersection(Origin, Direction, Glass));
	OutAcrossUp = FVector2D(-Local.Y, Local.Z);
	return true;
}

bool AWonderlandWonderWebScreen::BeginDrag(APlayerController* Controller, const FVector2D& ViewportPixel)
{
	FVector2D Held;
	if (!bPresented || bMinimized || !RayOnPlane(Controller, ViewportPixel, Held))
	{
		return false;
	}
	bDragging = true;
	// Where on the glass it was taken hold of, so it moves with the pointer rather than jumping its centre to it.
	DragGrip = Held - Offset;
	Place = TEXT("free");
	bOnGrid = false;
	return true;
}

void AWonderlandWonderWebScreen::DragTo(APlayerController* Controller, const FVector2D& ViewportPixel)
{
	FVector2D Held;
	if (bDragging && RayOnPlane(Controller, ViewportPixel, Held))
	{
		const FVector2D Limit = Reach();
		const FVector2D Want = Held - DragGrip;
		TargetOffset = FVector2D(FMath::Clamp(Want.X, -Limit.X, Limit.X), FMath::Clamp(Want.Y, -Limit.Y, Limit.Y));
	}
}

void AWonderlandWonderWebScreen::EndDrag()
{
	if (!bDragging)
	{
		return;
	}
	bDragging = false;
	// The nearest place on the grid is remembered for the next keyboard step; the glass stays exactly where it was left.
	const FVector2D Limit = Reach();
	Cell = FIntPoint(Limit.X > 1.0 ? FMath::RoundToInt(TargetOffset.X / Limit.X) : 0, Limit.Y > 1.0 ? FMath::RoundToInt(TargetOffset.Y / Limit.Y) : 0);
}

/* ==================================================================== the layer: drawing the windows, and input */

/**
 * A NOTICE, IN THE WORKSPACE'S OWN VOICE. Black ground, one yellow line, the words, and gone. It is deliberately not a
 * modal: the founder asked for "a clean Wonderland-native message", and a box that must be dismissed to carry on is the
 * opposite of that. It takes no input, blocks nothing, and fades by itself.
 */
class SWonderWebNotice : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderWebNotice) {}
	SLATE_END_ARGS()

	void Construct(const FArguments&)
	{
		Ground = FSlateRoundedBoxBrush(WonderWebLook::Ink(0.92f), 18.0f, WonderWebLook::Line(), 2.5f);
		Rule.DrawAs = ESlateBrushDrawType::Image;
		Rule.TintColor = FSlateColor(WonderWebLook::Line());
		// A NOTICE IS NOT A QUESTION: it never takes the pointer or the keyboard.
		SetVisibility(EVisibility::HitTestInvisible);
		SetCanTick(true);
		ChildSlot
		[
			SNew(SBorder).BorderImage(&Ground).Padding(FMargin(34.0f, 22.0f))
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(STextBlock).Font(WonderWebLook::Sans(22, true, 190)).ColorAndOpacity(WonderWebLook::Line())
					.Text_Lambda([this]() { return FText::FromString(Title); })
				]
				+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 12.0f, 0.0f, 12.0f)
				[
					SNew(SBox).HeightOverride(2.5f)[SNew(SImage).Image(&Rule)]
				]
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(STextBlock).Font(WonderWebLook::Sans(30, true, 120)).ColorAndOpacity(WonderWebLook::Line())
					.Text_Lambda([this]() { return FText::FromString(Line); })
				]
				+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)
				[
					SNew(STextBlock).Font(WonderWebLook::Sans(17)).ColorAndOpacity(WonderWebLook::Line(0.72f)).AutoWrapText(true)
					.Text_Lambda([this]() { return FText::FromString(Detail); })
				]
			]
		];
	}

	void Show(const FString& InTitle, const FString& InLine, const FString& InDetail, float Seconds)
	{
		Title = InTitle;
		Line = InLine;
		Detail = InDetail;
		Until = Now + static_cast<double>(FMath::Max(Seconds, 0.5f));
		Opacity = 1.0f;
	}

	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override
	{
		SCompoundWidget::Tick(AllottedGeometry, InCurrentTime, InDeltaTime);
		Now = InCurrentTime;
		// Held, then faded over the last second, so it leaves quietly instead of blinking out.
		const double Left = Until - Now;
		Opacity = Left <= 0.0 ? 0.0f : static_cast<float>(FMath::Clamp(Left, 0.0, 1.0));
		SetRenderOpacity(Opacity);
		SetVisibility(Opacity <= 0.01f ? EVisibility::Collapsed : EVisibility::HitTestInvisible);
	}

	bool IsShowing() const { return Opacity > 0.01f; }

private:
	FString Title;
	FString Line;
	FString Detail;
	double Now = 0.0;
	double Until = 0.0;
	float Opacity = 0.0f;
	FSlateBrush Ground;
	FSlateBrush Rule;
};

void SWonderlandWonderWebInputLayer::Construct(const FArguments& InArgs)
{
	Controller = InArgs._Controller;
	GetScreens = InArgs._GetScreens;
	OnFocus = InArgs._OnFocus;
	OnRequestClose = InArgs._OnRequestClose;
	OnRequestSpawn = InArgs._OnRequestSpawn;
	SetVisibility(EVisibility::Visible);
	ChildSlot
	[
		SAssignNew(Canvas, SConstraintCanvas)
	];
	// The notice sits above every window, near the top of the workspace, and is collapsed until there is something to say.
	Canvas->AddSlot()
		.Anchors(FAnchors(0.5f, 0.12f, 0.5f, 0.12f))
		.Alignment(FVector2D(0.5, 0.0))
		.AutoSize(true)
		.ZOrder(500)
		[
			SAssignNew(Notice, SWonderWebNotice)
		];
	Notice->SetVisibility(EVisibility::Collapsed);
}

void SWonderlandWonderWebInputLayer::ShowNotice(const FString& Title, const FString& Line, const FString& Detail, float Seconds)
{
	if (Notice.IsValid())
	{
		Notice->Show(Title, Line, Detail, Seconds);
	}
}

void SWonderlandWonderWebInputLayer::Present(AWonderlandWonderWebScreen* Screen, const TSharedRef<SWidget>& Content, const FVector2D& ContentSize,
	const TSharedRef<SWidget>& Chip, const FVector2D& ChipSize)
{
	if (Screen == nullptr || FindEntry(Screen) != nullptr || !Canvas.IsValid())
	{
		return;
	}
	TUniquePtr<FEntry> Entry = MakeUnique<FEntry>();
	Entry->Screen = Screen;
	Entry->ContentSize = ContentSize;
	Entry->ChipSize = ChipSize;
	Canvas->AddSlot()
		.Anchors(FAnchors(0.0f, 0.0f))
		.Alignment(FVector2D(0.0, 0.0))
		.AutoSize(false)
		.Offset(FMargin(0.0f, 0.0f, 1.0f, 1.0f))
		.ZOrder(1.0f)
		.Expose(Entry->Slot)
	[
		SAssignNew(Entry->Frame, SBox)
		.Visibility(EVisibility::Collapsed)
		.RenderTransformPivot(FVector2D(0.5, 0.5))
		[
			// The retainer is transparent while the window is focused; behind, it redraws the window only every few frames.
			SAssignNew(Entry->Retainer, SRetainerWidget)
			.RenderOnPhase(true)
			.RenderOnInvalidation(false)
			.Phase(0)
			.PhaseCount(1)
			[
				SAssignNew(Entry->Scaler, SDPIScaler)
				.DPIScale(1.0f)
				[
					SNew(SBox).WidthOverride(ContentSize.X).HeightOverride(ContentSize.Y)
					[
						Content
					]
				]
			]
		]
	];
	Entry->Retainer->SetRetainedRendering(false);
	Canvas->AddSlot()
		.Anchors(FAnchors(0.0f, 0.0f))
		.Alignment(FVector2D(0.0, 0.0))
		.AutoSize(false)
		.Offset(FMargin(0.0f, 0.0f, 1.0f, 1.0f))
		.ZOrder(5.0f)
		.Expose(Entry->ChipSlot)
	[
		SAssignNew(Entry->ChipFrame, SBox)
		.Visibility(EVisibility::Collapsed)
		.RenderTransformPivot(FVector2D(0.5, 0.5))
		[
			SAssignNew(Entry->ChipScaler, SDPIScaler)
			.DPIScale(1.0f)
			[
				SNew(SBox).WidthOverride(ChipSize.X).HeightOverride(ChipSize.Y)
				[
					Chip
				]
			]
		]
	];
	Entries.Add(MoveTemp(Entry));
}

const SWonderlandWonderWebInputLayer::FEntry* SWonderlandWonderWebInputLayer::FindEntry(const AWonderlandWonderWebScreen* Screen) const
{
	for (const TUniquePtr<FEntry>& Entry : Entries)
	{
		if (Screen != nullptr && Entry->Screen.Get() == Screen)
		{
			return Entry.Get();
		}
	}
	return nullptr;
}

void SWonderlandWonderWebInputLayer::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	SCompoundWidget::Tick(AllottedGeometry, InCurrentTime, InDeltaTime);
	APlayerController* Player = Controller.Get();
	FVector2D ViewportSize(0.0, 0.0);
	if (Player != nullptr)
	{
		if (const ULocalPlayer* LocalPlayer = Player->GetLocalPlayer())
		{
			if (LocalPlayer->ViewportClient != nullptr)
			{
				LocalPlayer->ViewportClient->GetViewportSize(ViewportSize);
			}
		}
	}
	const FVector2D LocalSize = AllottedGeometry.GetLocalSize();
	const bool bCanProject = Player != nullptr && ViewportSize.X > 0.0 && ViewportSize.Y > 0.0 && LocalSize.X > 0.0;
	const int32 BackgroundFrames = FMath::Max(WonderWebScreenTuning::CVarBackgroundRedrawFrames.GetValueOnGameThread(), 1);

	for (const TUniquePtr<FEntry>& Pointer : Entries)
	{
		FEntry& Entry = *Pointer;
		AWonderlandWonderWebScreen* Screen = Entry.Screen.Get();
		FVector2D ViewportMin;
		FVector2D ViewportMax;
		float Open = 0.0f;

		// THE WINDOW, over where its glass stands this frame: the whole rectangle, scaled from its design size, opening out
		// from a line across its middle.
		Entry.bShown = bCanProject && Screen != nullptr && Screen->ProjectGlass(Player, false, ViewportMin, ViewportMax, Open) && Open > 0.001f;
		if (Entry.bShown)
		{
			const FVector2D Min = ViewportMin / ViewportSize * LocalSize;
			const FVector2D Max = ViewportMax / ViewportSize * LocalSize;
			const float Scale = static_cast<float>((Max.X - Min.X) / FMath::Max(Entry.ContentSize.X, 1.0));
			const FVector2D Size = Entry.ContentSize * Scale;
			const FVector2D Centre = (Min + Max) * 0.5;
			Entry.Min = Centre - Size * 0.5;
			Entry.Max = Centre + Size * 0.5;
			Entry.Slot->SetOffset(FMargin(static_cast<float>(Entry.Min.X), static_cast<float>(Entry.Min.Y), static_cast<float>(Size.X), static_cast<float>(Size.Y)));
			// The focused window is in front of the others.
			Entry.Slot->SetZOrder(Screen->IsFocused() ? 2.0f : 1.0f);
			Entry.Scaler->SetDPIScale(Scale);
			Entry.Frame->SetRenderTransform(Open < 0.999f ? TOptional<FSlateRenderTransform>(FSlateRenderTransform(FScale2D(1.0f, FMath::Max(Open, 0.01f)))) : TOptional<FSlateRenderTransform>());
			// Visible the moment it is drawn -- never toggled through hit-test-invisible while it opens, which left the
			// window's own widgets out of the hit test once it had opened (editor 84: every click reached the window and
			// no button in it).
			if (Entry.Frame->GetVisibility() != EVisibility::Visible)
			{
				Entry.Frame->SetVisibility(EVisibility::Visible);
			}
			// DRAWN AS OFTEN AS IT IS LOOKED AT; worked on regardless.
			const int32 Retain = Screen->IsFocused() ? 0 : BackgroundFrames;
			if (Retain != Entry.Retained)
			{
				if (Retain <= 1)
				{
					Entry.Retainer->SetRetainedRendering(false);
				}
				else
				{
					Entry.Retainer->SetRenderingPhase(0, Retain);
					Entry.Retainer->SetRetainedRendering(true);
				}
				Entry.Retained = Retain;
			}
		}
		else if (Entry.Frame.IsValid() && Entry.Frame->GetVisibility() != EVisibility::Collapsed)
		{
			// MINIMIZED OR CLOSED, IT IS NOT DRAWN AT ALL.
			Entry.Frame->SetVisibility(EVisibility::Collapsed);
		}

		float ChipOpen = 0.0f;
		Entry.bChipShown = bCanProject && Screen != nullptr && Screen->ProjectGlass(Player, true, ViewportMin, ViewportMax, ChipOpen) && ChipOpen > 0.001f;
		if (Entry.bChipShown)
		{
			const FVector2D Min = ViewportMin / ViewportSize * LocalSize;
			const FVector2D Max = ViewportMax / ViewportSize * LocalSize;
			const float Scale = static_cast<float>((Max.X - Min.X) / FMath::Max(Entry.ChipSize.X, 1.0));
			Entry.ChipMin = Min;
			Entry.ChipMax = Min + Entry.ChipSize * Scale;
			Entry.ChipSlot->SetOffset(FMargin(static_cast<float>(Min.X), static_cast<float>(Min.Y), static_cast<float>(Entry.ChipSize.X * Scale), static_cast<float>(Entry.ChipSize.Y * Scale)));
			Entry.ChipScaler->SetDPIScale(Scale);
			Entry.ChipFrame->SetRenderTransform(ChipOpen < 0.999f ? TOptional<FSlateRenderTransform>(FSlateRenderTransform(FScale2D(1.0f, FMath::Max(ChipOpen, 0.01f)))) : TOptional<FSlateRenderTransform>());
			if (Entry.ChipFrame->GetVisibility() != EVisibility::Visible)
			{
				Entry.ChipFrame->SetVisibility(EVisibility::Visible);
			}
		}
		else if (Entry.ChipFrame.IsValid() && Entry.ChipFrame->GetVisibility() != EVisibility::Collapsed)
		{
			Entry.ChipFrame->SetVisibility(EVisibility::Collapsed);
		}
	}
}

bool SWonderlandWonderWebInputLayer::GetWindowRect(const AWonderlandWonderWebScreen* Screen, bool bChip, FSlateRect& OutRect) const
{
	const FEntry* Entry = FindEntry(Screen);
	if (Entry == nullptr || !(bChip ? Entry->bChipShown : Entry->bShown))
	{
		return false;
	}
	const FGeometry& Geometry = GetTickSpaceGeometry();
	OutRect = FSlateRect(Geometry.LocalToAbsolute(bChip ? Entry->ChipMin : Entry->Min), Geometry.LocalToAbsolute(bChip ? Entry->ChipMax : Entry->Max));
	return true;
}

bool SWonderlandWonderWebInputLayer::WindowPixelToAbsolute(const AWonderlandWonderWebScreen* Screen, const FVector2D& WindowPixel, FVector2D& OutAbsolute) const
{
	const FEntry* Entry = FindEntry(Screen);
	FSlateRect Rect;
	if (Entry == nullptr || !GetWindowRect(Screen, false, Rect))
	{
		return false;
	}
	OutAbsolute = Rect.GetTopLeft() + WindowPixel * (Rect.GetSize() / Entry->ContentSize);
	return true;
}

bool SWonderlandWonderWebInputLayer::ToViewportPixel(const FGeometry& MyGeometry, const FVector2D& ScreenPosition, FVector2D& OutPixel) const
{
	APlayerController* Player = Controller.Get();
	if (Player == nullptr)
	{
		return false;
	}
	// Slate units to viewport pixels: the layer fills the game viewport.
	const FVector2D Local = MyGeometry.AbsoluteToLocal(ScreenPosition);
	const FVector2D LocalSize = MyGeometry.GetLocalSize();
	FVector2D ViewportSize(0.0, 0.0);
	if (const ULocalPlayer* LocalPlayer = Player->GetLocalPlayer())
	{
		if (LocalPlayer->ViewportClient != nullptr)
		{
			LocalPlayer->ViewportClient->GetViewportSize(ViewportSize);
		}
	}
	if (LocalSize.X <= 0.0 || LocalSize.Y <= 0.0 || ViewportSize.X <= 0.0)
	{
		return false;
	}
	OutPixel = Local / LocalSize * ViewportSize;
	return true;
}

const SWonderlandWonderWebInputLayer::FEntry* SWonderlandWonderWebInputLayer::EntryAt(const FVector2D& Local, bool& bOutChip) const
{
	const auto Inside = [&Local](const FVector2D& Min, const FVector2D& Max) { return Local.X >= Min.X && Local.Y >= Min.Y && Local.X <= Max.X && Local.Y <= Max.Y; };
	bOutChip = true;
	for (const TUniquePtr<FEntry>& Entry : Entries)
	{
		if (Entry->bChipShown && Inside(Entry->ChipMin, Entry->ChipMax))
		{
			return Entry.Get();
		}
	}
	bOutChip = false;
	// The focused window is in front.
	for (const TUniquePtr<FEntry>& Entry : Entries)
	{
		if (Entry->bShown && Entry->Screen.IsValid() && Entry->Screen->IsFocused() && Inside(Entry->Min, Entry->Max))
		{
			return Entry.Get();
		}
	}
	for (const TUniquePtr<FEntry>& Entry : Entries)
	{
		if (Entry->bShown && Inside(Entry->Min, Entry->Max))
		{
			return Entry.Get();
		}
	}
	return nullptr;
}

AWonderlandWonderWebScreen* SWonderlandWonderWebInputLayer::FocusedScreen() const
{
	if (!GetScreens.IsBound())
	{
		return nullptr;
	}
	for (AWonderlandWonderWebScreen* Candidate : GetScreens.Execute())
	{
		if (Candidate != nullptr && Candidate->IsFocused())
		{
			return Candidate;
		}
	}
	return nullptr;
}

FReply SWonderlandWonderWebInputLayer::OnPreviewMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	// FIRST, BEFORE THE WINDOW'S OWN WIDGETS: a press focuses the window it lands in. The press itself goes on to them.
	bool bChip = false;
	const FEntry* Hit = EntryAt(MyGeometry.AbsoluteToLocal(MouseEvent.GetScreenSpacePosition()), bChip);
	Pressed = Hit != nullptr ? Hit->Screen : nullptr;
	if (Hit != nullptr && Hit->Screen.IsValid())
	{
		++ForwardedClicks;
		OnFocus.ExecuteIfBound(Hit->Screen.Get());
		UE_LOG(LogTemp, Log, TEXT("WLWEB press at (%.0f, %.0f) in %s%s"), MouseEvent.GetScreenSpacePosition().X, MouseEvent.GetScreenSpacePosition().Y,
			*Hit->Screen->GetName(), bChip ? TEXT(" (chip)") : TEXT(""));
	}
	return FReply::Unhandled();
}

FReply SWonderlandWonderWebInputLayer::OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	// Reached only when nothing inside a window took the press.
	FSlateApplication::Get().SetKeyboardFocus(SharedThis(this), EFocusCause::Mouse);
	bool bChip = false;
	const FVector2D Local = MyGeometry.AbsoluteToLocal(MouseEvent.GetScreenSpacePosition());
	const FEntry* Hit = EntryAt(Local, bChip);
	AWonderlandWonderWebScreen* Screen = Hit != nullptr ? Hit->Screen.Get() : nullptr;
	if (Screen != nullptr && !bChip && MouseEvent.GetEffectingButton() == EKeys::LeftMouseButton)
	{
		// TAKEN BY THE TITLE BAR: a left press on the bar's bare space picks the window up. It moves with the pointer until release.
		const double Scale = (Hit->Max.X - Hit->Min.X) / FMath::Max(Hit->ContentSize.X, 1.0);
		FVector2D Pixel;
		if (Local.Y - Hit->Min.Y < SWonderlandWonderWebPanel::TitleBarHeight() * Scale
			&& ToViewportPixel(MyGeometry, MouseEvent.GetScreenSpacePosition(), Pixel) && Screen->BeginDrag(Controller.Get(), Pixel))
		{
			Pressed = Screen;
			UE_LOG(LogTemp, Log, TEXT("WLWEB title bar of %s taken"), *Screen->GetName());
			return FReply::Handled().CaptureMouse(SharedThis(this));
		}
	}
	return FReply::Handled();
}

FReply SWonderlandWonderWebInputLayer::OnMouseButtonUp(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	AWonderlandWonderWebScreen* Target = Pressed.Get();
	if (Target != nullptr && Target->IsDragging())
	{
		Target->EndDrag();
		Pressed.Reset();
		return FReply::Handled().ReleaseMouseCapture();
	}
	Pressed.Reset();
	return FReply::Unhandled();
}

FReply SWonderlandWonderWebInputLayer::OnMouseMove(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	AWonderlandWonderWebScreen* Target = Pressed.Get();
	FVector2D Pixel;
	if (Target != nullptr && Target->IsDragging() && ToViewportPixel(MyGeometry, MouseEvent.GetScreenSpacePosition(), Pixel))
	{
		Target->DragTo(Controller.Get(), Pixel);
		return FReply::Handled();
	}
	return FReply::Unhandled();
}

FReply SWonderlandWonderWebInputLayer::OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	const FKey Key = InKeyEvent.GetKey();
	if (Key == EKeys::Escape)
	{
		OnRequestClose.ExecuteIfBound();
		return FReply::Handled();
	}
	// CTRL+W IS WONDERLAND'S OWN. Caught here, before any window or any page inside one sees it, so the canonical
	// shortcut means the same thing wherever the keyboard happens to be pointing (founder, 2026-09-17: "Do not let a
	// website steal the canonical Wonderland shortcut").
	if (InKeyEvent.IsControlDown() && Key == EKeys::W)
	{
		OnRequestSpawn.ExecuteIfBound();
		return FReply::Handled();
	}
	AWonderlandWonderWebScreen* Target = FocusedScreen();
	// CTRL + ARROWS: the focused window steps across the view's grid of places; CTRL + HOME back to the middle.
	if (InKeyEvent.IsControlDown() && Target != nullptr)
	{
		const int32 Across = Key == EKeys::Left ? -1 : (Key == EKeys::Right ? 1 : 0);
		const int32 Up = Key == EKeys::Up ? 1 : (Key == EKeys::Down ? -1 : 0);
		if (Across != 0 || Up != 0)
		{
			Target->Step(Across, Up);
			return FReply::Handled();
		}
		if (Key == EKeys::Home)
		{
			Target->MoveTo(TEXT("center"));
			return FReply::Handled();
		}
	}
	return FReply::Unhandled();
}
