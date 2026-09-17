// WONDERLAND — WONDER WEB STANDS IN THE WORLD.
//
// "Wonder Web is INSIDE Wonderland" (founder, 2026-09-17). So the window is not pasted over the screen: it is a screen
// standing in the garden in front of the Relay Dog, the camera glides to it with the world still around its edges, and
// closing it glides back to the Dog exactly where it was. The window itself is the Slate widget
// (WonderlandWonderWebPanel.h), rendered onto a world-space widget component at its design size.
//
// USING IT WITH THE MOUSE AND KEYBOARD. While it is open the UI subsystem holds UI input, like every panel, with an
// invisible full-viewport layer (SWonderlandWonderWebInputLayer) that owns the keyboard. That layer turns the cursor
// into a ray, meets the screen's plane, and hands the point to a widget interaction component as a custom hit, so a
// click, a scroll or a typed character reaches the in-world window at the pixel under the cursor -- the same path the
// proof job drives with real Slate events.
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

UCLASS()
class WONDERLAND_API AWonderlandWonderWebScreen : public AActor
{
	GENERATED_BODY()

public:
	AWonderlandWonderWebScreen();

	/** Stand the screen at this place (X out of the glass toward the viewer) and grow it in, showing this window. */
	void Present(const TSharedRef<SWidget>& Window, const FVector& Centre, const FRotator& Facing);
	/** Shrink it away. It hides itself when it is gone. */
	void Dismiss();
	bool IsPresented() const { return bPresented; }

	UCameraComponent* GetView() const { return View; }
	UWidgetComponent* GetScreen() const { return Screen; }
	UWonderlandWonderWebInteraction* GetInteraction() const { return Interaction; }

	/** Point the interaction at the screen pixel under this viewport pixel. False when the cursor is off the screen. */
	bool AimAtViewportPixel(APlayerController* Controller, const FVector2D& ViewportPixel);
	/** The world position of a window pixel on the screen. */
	FVector WindowPixelToWorld(const FVector2D& WindowPixel) const;
	/** The window pixel the last aim landed on, (-1, -1) before any. */
	FVector2D GetLastAimPixel() const { return LastAimPixel; }

	// ---------------------------------------------------------------- moving it
	// A WONDER WEB GOES WHERE IT IS NEEDED, SWIFTLY AND SMOOTHLY (founder, 2026-09-17: "from right to left to middle ...
	// right corner, left, wherever it needs to go"). Julius will stand several at once, so each screen slides within the
	// view it is framed in -- to a named place, one step across a 3 x 3 grid, or dragged by its title bar -- on a
	// critically damped glide: quick to leave, no overshoot, no snap.

	/** Glide to a named place: center (or middle), left, right, top, bottom, top-left, top-right, bottom-left, bottom-right. False for an unknown name. */
	bool MoveTo(FName Place);
	/** One step across the 3 x 3 grid of places (-1, 0 or 1 each way; up is +1). */
	void Step(int32 Across, int32 Up);
	/** Where it is and where it is going, in uu across (right) and up the view; and the place it was sent to ("free" after a drag). */
	FVector2D GetOffset() const { return Offset; }
	FVector2D GetTargetOffset() const { return TargetOffset; }
	FName GetPlace() const { return Place; }
	bool IsGliding() const { return !Offset.Equals(TargetOffset, 0.5) || OffsetRate.SizeSquared() > 1.0; }

	/** Drag by the title bar: the glass point the pointer held, then wherever the pointer's ray now meets the glass's plane. */
	bool BeginDrag(APlayerController* Controller, const FVector2D& ViewportPixel);
	void DragTo(APlayerController* Controller, const FVector2D& ViewportPixel);
	void EndDrag();
	bool IsDragging() const { return bDragging; }

	virtual void Tick(float DeltaSeconds) override;

private:
	UPROPERTY()
	TObjectPtr<USceneComponent> Root;

	UPROPERTY()
	TObjectPtr<UWidgetComponent> Screen;

	UPROPERTY()
	TObjectPtr<UWonderlandWonderWebInteraction> Interaction;

	UPROPERTY()
	TObjectPtr<UCameraComponent> View;

	TSharedPtr<SWidget> Shown;
	bool bPresented = false;
	float Grow = 0.0f;
	/** The furthest the glass can go across and up while staying whole in the view. */
	FVector2D Reach() const;
	/** Where the pointer's ray meets the plane the glass lies in, in (across, up) uu from the root. */
	bool RayOnPlane(APlayerController* Controller, const FVector2D& ViewportPixel, FVector2D& OutAcrossUp) const;
	FVector2D Offset = FVector2D::ZeroVector;
	FVector2D OffsetRate = FVector2D::ZeroVector;
	FVector2D TargetOffset = FVector2D::ZeroVector;
	FIntPoint Cell = FIntPoint(0, 0);
	FName Place = TEXT("center");
	bool bDragging = false;
	FVector2D DragGrip = FVector2D::ZeroVector;
	float AppliedBrightness = -1.0f;
	FVector2D LastAimPixel = FVector2D(-1.0, -1.0);
};

/**
 * The invisible layer that owns input while Wonder Web is open: every click, scroll and keystroke over the viewport
 * goes to the in-world screen, Escape closes.
 */
class WONDERLAND_API SWonderlandWonderWebInputLayer : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandWonderWebInputLayer) {}
		SLATE_ARGUMENT(TWeakObjectPtr<AWonderlandWonderWebScreen>, Screen)
		SLATE_ARGUMENT(TWeakObjectPtr<APlayerController>, Controller)
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	void SetScreen(TWeakObjectPtr<AWonderlandWonderWebScreen> InScreen) { Screen = InScreen; }

	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseButtonUp(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseMove(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseWheel(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnKeyChar(const FGeometry& MyGeometry, const FCharacterEvent& InCharacterEvent) override;
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;
	virtual FReply OnKeyUp(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;

	virtual FReply OnMouseButtonDoubleClick(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override { return OnMouseButtonDown(MyGeometry, MouseEvent); }

	/** Clicks that reached the screen through this layer, for the proof job. */
	int32 GetForwardedClicks() const { return ForwardedClicks; }
	int32 GetForwardedCharacters() const { return ForwardedCharacters; }

private:
	bool Aim(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent);
	bool ToViewportPixel(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent, FVector2D& OutPixel) const;
	static bool IsEditingKey(const FKey& Key);

	TWeakObjectPtr<AWonderlandWonderWebScreen> Screen;
	TWeakObjectPtr<APlayerController> Controller;
	FSimpleDelegate OnRequestClose;
	int32 ForwardedClicks = 0;
	int32 ForwardedCharacters = 0;
};
