// WONDERLAND — WONDER WEB STANDS IN THE WORLD, AS A WORKSPACE OF WINDOWS.
//
// "Wonder Web is INSIDE Wonderland" (founder, 2026-09-17). The workspace is a frame standing in the garden ahead of the
// Relay Dog; the camera glides to it with the world still round its edges, and closing it glides back to the Dog.
//
// A WORKSPACE, NOT ONE GIANT BROWSER (founder, 2026-09-17: "2-3 active Wonder Web surfaces can be visible simultaneously
// ... multitasking workspace"). AWonderlandWonderWebWorkspace is the frame: one anchor in the world and the one camera on
// it. Each AWonderlandWonderWebScreen is one window's place in that frame -- a running creation, Julius Connect, and
// whatever comes next -- with its own offset, size, focus and minimized state, gliding and growing on critically damped
// curves. Windows are views under the one Julius; a window never owns authority.
//
// HOW A WINDOW IS DRAWN (editor 83). Where each window's glass stands is worked out in the world, and the window itself is
// drawn by Slate exactly over that place, after the frame is rendered. Drawn INTO the world, a window's text went through
// the temporal upscaler, and every line that changed smeared for most of a second -- on a window that changes every few
// seconds while Julius works. Drawn over its place, the text is crisp the frame it changes, and the window takes the mouse
// and keyboard as any Slate widget does. The HUD is never under a window: the workspace tiles around it.
//
// PERFORMANCE: the focused window is drawn every frame; a background window through a retainer, a few times a second; a
// minimized one is not drawn at all -- only its small chip. The work behind a window never pauses for how it is drawn.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Widgets/Layout/SConstraintCanvas.h"
#include "Widgets/SCompoundWidget.h"
#include "WonderlandWonderWebScreen.generated.h"

class SBox;
class SDPIScaler;
class SRetainerWidget;
class UCameraComponent;

/** The frame the windows stand in: an anchor in the world and the camera that looks at it. */
UCLASS()
class WONDERLAND_API AWonderlandWonderWebWorkspace : public AActor
{
	GENERATED_BODY()

public:
	AWonderlandWonderWebWorkspace();

	/** Stand the frame ahead of where the player is looking, facing back toward them, with the camera set on it. */
	void StandBefore(APlayerController* Controller);

	UCameraComponent* GetView() const { return View; }
	USceneComponent* GetAnchor() const { return Root; }
	/** Half the view's width and height at the plane the windows stand in, uu. */
	FVector2D HalfView() const;

private:
	UPROPERTY()
	TObjectPtr<USceneComponent> Root;

	UPROPERTY()
	TObjectPtr<UCameraComponent> View;
};

/** One Wonder Web window's place in the workspace. */
UCLASS()
class WONDERLAND_API AWonderlandWonderWebScreen : public AActor
{
	GENERATED_BODY()

public:
	AWonderlandWonderWebScreen();

	/** Stand this window in the workspace at its design size (and its chip's), and open it out. */
	void Present(const FVector2D& WindowSize, const FVector2D& ChipSize, AWonderlandWonderWebWorkspace* Workspace);
	/** Fold it away. */
	void Dismiss();
	bool IsPresented() const { return bPresented; }

	// ---------------------------------------------------------------- the window's state in the workspace
	void SetFocused(bool bInFocused);
	bool IsFocused() const { return bFocused; }
	/** Minimized: the window folds to its chip along the bottom of the view; its work goes on. */
	void SetMinimized(bool bInMinimized);
	bool IsMinimized() const { return bMinimized; }
	/** Which chip slot along the bottom it takes when minimized, from the left. */
	void SetDockSlot(int32 Slot) { DockSlot = Slot; }
	/** 1 is the multitasking size; a focused window may be expanded larger. The glass grows or shrinks to it smoothly. */
	void SetSizeFactor(float Factor) { SizeFactor = FMath::Clamp(Factor, 0.3f, 2.0f); }
	float GetSizeFactor() const { return SizeFactor; }
	/** The size factor as drawn this frame, on its way to the target. */
	float GetShownSizeFactor() const { return SizeShown; }
	/** The window's size on the glass, uu, at its target size factor. */
	FVector2D GlassSize() const;
	/** How far open the window (or its chip) is, 0 folded to 1 open. */
	float GetOpen() const { return Grow; }
	float GetChipOpen() const { return ChipGrow; }

	/**
	 * Where the window's glass (or its chip) stands on the screen this frame, in viewport pixels -- the rectangle its Slate
	 * window is drawn over -- and how far open it is. False when it cannot be seen.
	 */
	bool ProjectGlass(APlayerController* Controller, bool bChip, FVector2D& OutViewportMin, FVector2D& OutViewportMax, float& OutOpen) const;

	// ---------------------------------------------------------------- moving it
	// A WONDER WEB GOES WHERE IT IS NEEDED, SWIFTLY AND SMOOTHLY (founder, 2026-09-17): to a named place in the view, one
	// step across a 3 x 3 grid, or dragged by its title bar, on a critically damped glide -- quick to leave, no overshoot.

	/** Glide to a named place: center (or middle), left, right, top, bottom, top-left, top-right, bottom-left, bottom-right. False for an unknown name. */
	bool MoveTo(FName Place);
	/** Glide to an exact offset in the view (across, up, uu) -- where the workspace tiles it. Kept whole in the view. */
	void PlaceAt(const FVector2D& AcrossUp);
	/** One step across the 3 x 3 grid of places (-1, 0 or 1 each way; up is +1). */
	void Step(int32 Across, int32 Up);
	FVector2D GetOffset() const { return Offset; }
	FVector2D GetTargetOffset() const { return TargetOffset; }
	FName GetPlace() const { return Place; }
	bool IsGliding() const { return !Offset.Equals(TargetOffset, 0.5) || OffsetRate.SizeSquared() > 1.0; }

	bool BeginDrag(APlayerController* Controller, const FVector2D& ViewportPixel);
	void DragTo(APlayerController* Controller, const FVector2D& ViewportPixel);
	void EndDrag();
	bool IsDragging() const { return bDragging; }

	virtual void Tick(float DeltaSeconds) override;

private:
	/** The furthest the glass can go across and up while staying whole in the view. */
	FVector2D Reach() const;
	bool RayOnPlane(APlayerController* Controller, const FVector2D& ViewportPixel, FVector2D& OutAcrossUp) const;

	UPROPERTY()
	TObjectPtr<USceneComponent> Root;

	TWeakObjectPtr<AWonderlandWonderWebWorkspace> Workspace;
	FVector2D WindowPixels = FVector2D(1536.0, 1024.0);
	FVector2D ChipPixels = FVector2D(560.0, 96.0);
	bool bPresented = false;
	bool bFocused = false;
	bool bMinimized = false;
	int32 DockSlot = 0;
	float SizeFactor = 1.0f;
	float SizeShown = 1.0f;
	float SizeRate = 0.0f;
	/** On a named place of the grid (its offset follows the window's size), rather than tiled or left where it was dragged. */
	bool bOnGrid = true;
	float Grow = 0.0f;
	float ChipGrow = 0.0f;
	FVector2D Offset = FVector2D::ZeroVector;
	FVector2D OffsetRate = FVector2D::ZeroVector;
	FVector2D TargetOffset = FVector2D::ZeroVector;
	FIntPoint Cell = FIntPoint(0, 0);
	FName Place = TEXT("center");
	bool bDragging = false;
	FVector2D DragGrip = FVector2D::ZeroVector;
};

/**
 * The layer that owns the Wonder Web workspace on screen while it is open. It draws every window's Slate content over
 * the place its glass stands, and its chip when minimized; a press focuses the window it lands in; a press on a window's
 * bare title bar picks the window up; Ctrl+arrows step the focused window across the view; Escape returns to the world.
 * Everything inside a window -- its buttons, its text boxes, its scrolling -- is ordinary Slate input.
 */
class WONDERLAND_API SWonderlandWonderWebInputLayer : public SCompoundWidget
{
public:
	DECLARE_DELEGATE_RetVal(TArray<AWonderlandWonderWebScreen*>, FGetScreens);
	DECLARE_DELEGATE_OneParam(FOnFocus, AWonderlandWonderWebScreen*);

	SLATE_BEGIN_ARGS(SWonderlandWonderWebInputLayer) {}
		SLATE_ARGUMENT(TWeakObjectPtr<APlayerController>, Controller)
		/** Every window standing in the workspace. */
		SLATE_EVENT(FGetScreens, GetScreens)
		SLATE_EVENT(FOnFocus, OnFocus)
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	/** Draw this window's content (and its chip) over where its glass stands. Once per window; its widgets stay here. */
	void Present(AWonderlandWonderWebScreen* Screen, const TSharedRef<SWidget>& Content, const FVector2D& ContentSize, const TSharedRef<SWidget>& Chip, const FVector2D& ChipSize);
	/** The window's (or chip's) rectangle on screen, in Slate absolute space, as drawn this frame. False when not drawn. */
	bool GetWindowRect(const AWonderlandWonderWebScreen* Screen, bool bChip, FSlateRect& OutRect) const;
	/** A point in a window's design pixels, in Slate absolute space. */
	bool WindowPixelToAbsolute(const AWonderlandWonderWebScreen* Screen, const FVector2D& WindowPixel, FVector2D& OutAbsolute) const;

	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;
	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnPreviewMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseButtonUp(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseMove(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;

	/** Presses that landed in a window, for the proof job. */
	int32 GetForwardedClicks() const { return ForwardedClicks; }
	int32 GetForwardedCharacters() const { return ForwardedCharacters; }

private:
	struct FEntry
	{
		TWeakObjectPtr<AWonderlandWonderWebScreen> Screen;
		FVector2D ContentSize = FVector2D(1536.0, 1024.0);
		FVector2D ChipSize = FVector2D(560.0, 96.0);
		TSharedPtr<SBox> Frame;
		TSharedPtr<SDPIScaler> Scaler;
		TSharedPtr<SRetainerWidget> Retainer;
		SConstraintCanvas::FSlot* Slot = nullptr;
		TSharedPtr<SBox> ChipFrame;
		TSharedPtr<SDPIScaler> ChipScaler;
		SConstraintCanvas::FSlot* ChipSlot = nullptr;
		/** Layer-local rectangles as laid out this frame. */
		FVector2D Min = FVector2D::ZeroVector;
		FVector2D Max = FVector2D::ZeroVector;
		FVector2D ChipMin = FVector2D::ZeroVector;
		FVector2D ChipMax = FVector2D::ZeroVector;
		bool bShown = false;
		bool bChipShown = false;
		int32 Retained = -1;
	};

	bool ToViewportPixel(const FGeometry& MyGeometry, const FVector2D& ScreenPosition, FVector2D& OutPixel) const;
	/** The front-most window (or chip) under a layer-local point. */
	const FEntry* EntryAt(const FVector2D& Local, bool& bOutChip) const;
	const FEntry* FindEntry(const AWonderlandWonderWebScreen* Screen) const;
	AWonderlandWonderWebScreen* FocusedScreen() const;

	TWeakObjectPtr<APlayerController> Controller;
	FGetScreens GetScreens;
	FOnFocus OnFocus;
	FSimpleDelegate OnRequestClose;
	TSharedPtr<SConstraintCanvas> Canvas;
	/** Stable addresses: slots and weak pointers refer into these. */
	TArray<TUniquePtr<FEntry>> Entries;
	/** The window a press went to, which receives its release and its drag. */
	TWeakObjectPtr<AWonderlandWonderWebScreen> Pressed;
	int32 ForwardedClicks = 0;
	int32 ForwardedCharacters = 0;
};
