// WONDERLAND — WONDER WEB STANDS IN THE WORLD, AS A WORKSPACE OF WINDOWS.
//
// "Wonder Web is INSIDE Wonderland" (founder, 2026-09-17). The windows are not pasted over the screen: they stand in the
// garden ahead of the Relay Dog, the camera glides to them with the world still round their edges, and closing the
// workspace glides back to the Dog exactly where it was.
//
// A WORKSPACE, NOT ONE GIANT BROWSER (founder, 2026-09-17: "2-3 active Wonder Web surfaces can be visible simultaneously
// ... multitasking workspace"). AWonderlandWonderWebWorkspace is the frame: one anchor in the world and the one camera on
// it. Each AWonderlandWonderWebScreen is one window standing in that frame -- a running creation, Julius Connect, and
// whatever comes next -- with its own place, size, focus and minimized state. Windows are views under the one Julius; a
// window never owns authority.
//
// PERFORMANCE: the focused window redraws every frame, a visible background window a dozen times a second, a minimized one
// only as a small live chip. The work behind a window never pauses for how it is drawn.
//
// USING THEM WITH THE MOUSE AND KEYBOARD. While the workspace is open the UI subsystem holds UI input, like every panel, with
// an invisible full-viewport layer (SWonderlandWonderWebInputLayer). That layer turns the cursor into a ray, finds the
// front-most window (or chip) it meets, focuses it on a press, and hands the point to that window's own widget interaction
// as a custom hit; typing goes to the focused window. Each window has its own virtual Slate user, so one window's keyboard
// focus can never type into another.
#pragma once

#include "CoreMinimal.h"
#include "Components/WidgetInteractionComponent.h"
#include "GameFramework/Actor.h"
#include "Widgets/SCompoundWidget.h"
#include "WonderlandWonderWebScreen.generated.h"

class UCameraComponent;
class UWidgetComponent;

/** The engine's widget interaction, with the pointer's hover re-found on demand rather than only on its own tick. */
UCLASS()
class WONDERLAND_API UWonderlandWonderWebInteraction : public UWidgetInteractionComponent
{
	GENERATED_BODY()

public:
	/** Re-find what is under the pointer now, so a press that follows an aim lands on the widget just aimed at. */
	void RefreshHover() { SimulatePointerMovement(); }
};

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

/** One Wonder Web window standing in the workspace. */
UCLASS()
class WONDERLAND_API AWonderlandWonderWebScreen : public AActor
{
	GENERATED_BODY()

public:
	AWonderlandWonderWebScreen();

	/** The window's virtual Slate user; set before the actor finishes spawning so its interaction gets a user of its own. */
	void SetVirtualUser(int32 Index);

	/** Stand this window in the workspace, showing this window widget (and this chip when minimized), and grow it in. */
	void Present(const TSharedRef<SWidget>& Window, const FVector2D& WindowSize, const TSharedRef<SWidget>& Chip, const FVector2D& ChipSize, AWonderlandWonderWebWorkspace* Workspace);
	/** Fold it away. It hides itself when it is gone. */
	void Dismiss();
	bool IsPresented() const { return bPresented; }

	UWidgetComponent* GetScreen() const { return Screen; }
	UWidgetComponent* GetChip() const { return Chip; }
	UWonderlandWonderWebInteraction* GetInteraction() const { return Interaction; }

	// ---------------------------------------------------------------- the window's state in the workspace
	void SetFocused(bool bInFocused);
	bool IsFocused() const { return bFocused; }
	/** Minimized: the window folds to its chip along the bottom of the view; its work goes on. */
	void SetMinimized(bool bInMinimized);
	bool IsMinimized() const { return bMinimized; }
	/** Which chip slot along the bottom it takes when minimized, from the left. */
	void SetDockSlot(int32 Slot) { DockSlot = Slot; }
	/** 1 is the multitasking size; a focused window may be expanded larger. The glass grows or shrinks to it smoothly. */
	void SetSizeFactor(float Factor) { SizeFactor = FMath::Clamp(Factor, 0.5f, 2.0f); }
	float GetSizeFactor() const { return SizeFactor; }
	/** The size factor as drawn this frame, on its way to the target. */
	float GetShownSizeFactor() const { return SizeShown; }
	/** The window's size on the glass, uu, at its current size factor. */
	FVector2D GlassSize() const;

	// ---------------------------------------------------------------- aiming the pointer at it
	/**
	 * Where the pointer's ray at this viewport pixel meets this window's glass (or its chip when minimized): the distance
	 * along the ray, and the window pixel. False when it misses.
	 */
	bool HitTest(APlayerController* Controller, const FVector2D& ViewportPixel, double& OutDistance, FVector2D& OutPixel) const;
	/** Point the interaction at the viewport pixel (true), or tell it the pointer is elsewhere (false). */
	bool AimAtViewportPixel(APlayerController* Controller, const FVector2D& ViewportPixel);
	void AimElsewhere();
	/** The world position of a window pixel on the glass. */
	FVector WindowPixelToWorld(const FVector2D& WindowPixel) const;
	/** The window pixel the last aim landed on, (-1, -1) before any. */
	FVector2D GetLastAimPixel() const { return LastAimPixel; }

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
	bool HitComponent(const UWidgetComponent* Component, APlayerController* Controller, const FVector2D& ViewportPixel, double& OutDistance, FVector2D& OutPixel, FVector& OutHit) const;

	UPROPERTY()
	TObjectPtr<USceneComponent> Root;

	UPROPERTY()
	TObjectPtr<UWidgetComponent> Screen;

	UPROPERTY()
	TObjectPtr<UWidgetComponent> Chip;

	UPROPERTY()
	TObjectPtr<UWonderlandWonderWebInteraction> Interaction;

	TWeakObjectPtr<AWonderlandWonderWebWorkspace> Workspace;
	TSharedPtr<SWidget> Shown;
	TSharedPtr<SWidget> ShownChip;
	FVector2D WindowPixels = FVector2D(1200.0, 800.0);
	FVector2D ChipPixels = FVector2D(420.0, 64.0);
	bool bPresented = false;
	bool bFocused = false;
	bool bMinimized = false;
	int32 DockSlot = 0;
	float SizeFactor = 1.0f;
	float SizeShown = 1.0f;
	float SizeRate = 0.0f;
	/** On a named place of the grid (its offset follows the window's size), rather than left where it was dragged. */
	bool bOnGrid = true;
	float Grow = 0.0f;
	float ChipGrow = 0.0f;
	float AppliedBrightness = -1.0f;
	float AppliedRedraw = -1.0f;
	FVector2D Offset = FVector2D::ZeroVector;
	FVector2D OffsetRate = FVector2D::ZeroVector;
	FVector2D TargetOffset = FVector2D::ZeroVector;
	FIntPoint Cell = FIntPoint(0, 0);
	FName Place = TEXT("center");
	bool bDragging = false;
	FVector2D DragGrip = FVector2D::ZeroVector;
	FVector2D LastAimPixel = FVector2D(-1.0, -1.0);
};

/**
 * The invisible layer that owns input while the Wonder Web workspace is open: a click focuses and reaches the front-most
 * window under the pointer, a press on a bare title bar picks that window up, typing goes to the focused window, Ctrl+arrows
 * step it across the view, Escape returns to the world.
 */
class WONDERLAND_API SWonderlandWonderWebInputLayer : public SCompoundWidget
{
public:
	DECLARE_DELEGATE_RetVal(TArray<AWonderlandWonderWebScreen*>, FGetScreens);
	DECLARE_DELEGATE_OneParam(FOnFocus, AWonderlandWonderWebScreen*);

	SLATE_BEGIN_ARGS(SWonderlandWonderWebInputLayer) {}
		SLATE_ARGUMENT(TWeakObjectPtr<APlayerController>, Controller)
		/** Every window standing in the workspace, front to back does not matter: the nearest hit wins. */
		SLATE_EVENT(FGetScreens, GetScreens)
		SLATE_EVENT(FOnFocus, OnFocus)
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseButtonUp(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseMove(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseWheel(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnKeyChar(const FGeometry& MyGeometry, const FCharacterEvent& InCharacterEvent) override;
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;
	virtual FReply OnKeyUp(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;
	virtual FReply OnMouseButtonDoubleClick(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override { return OnMouseButtonDown(MyGeometry, MouseEvent); }

	/** Clicks and characters that reached a window through this layer, for the proof job. */
	int32 GetForwardedClicks() const { return ForwardedClicks; }
	int32 GetForwardedCharacters() const { return ForwardedCharacters; }

private:
	bool ToViewportPixel(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent, FVector2D& OutPixel) const;
	/** The front-most window under the pointer, aimed at; every other window is told the pointer is elsewhere. */
	AWonderlandWonderWebScreen* AimFrontMost(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent);
	AWonderlandWonderWebScreen* FocusedScreen() const;
	static bool IsEditingKey(const FKey& Key);

	TWeakObjectPtr<APlayerController> Controller;
	FGetScreens GetScreens;
	FOnFocus OnFocus;
	FSimpleDelegate OnRequestClose;
	/** The window a press went to, which receives its release and its drag. */
	TWeakObjectPtr<AWonderlandWonderWebScreen> Pressed;
	int32 ForwardedClicks = 0;
	int32 ForwardedCharacters = 0;
};
