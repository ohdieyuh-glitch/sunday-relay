// MINIMAL UNREAL STUB — enough to PARSE, never enough to run.
//
// The Slate types are declared rather than modelled. Nothing in this repository
// can execute a paint, so a stub that pretended to draw would invite a test to
// believe it had seen one. What this buys is that the widget's own structure —
// its overrides, its members, its bindings — is parsed rather than assumed.
#pragma once

#include "CoreMinimal.h"

class FPaintArgs;
class FSlateRect;
class FSlateWindowElementList;
class FWidgetStyle;
class FSlateResourceHandle;

struct FGeometry
{
	FVector2D GetLocalSize() const { return FVector2D(0, 0); }
};

class UWidget : public UObject {};

class UUserWidget : public UWidget
{
public:
	virtual void NativeConstruct() {}
	virtual void NativeDestruct() {}
	virtual int32 NativePaint(
		const FPaintArgs& Args,
		const FGeometry& AllottedGeometry,
		const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements,
		int32 LayerId,
		const FWidgetStyle& InWidgetStyle,
		bool bParentEnabled) const { return LayerId; }

	class UGameInstance* GetGameInstance() const { return nullptr; }
};
