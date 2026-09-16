// WONDERLAND — HUD proof hooks that need the editor.
//
// PLAY IN A WINDOW OF A GIVEN SIZE, WITHOUT TOUCHING ANYONE'S SETTINGS. The founder asked that the HUD be proven at
// 1280x720 as well as at the development viewport. PIE in the level viewport cannot be resized from a script, and the
// saved play settings belong to whoever uses this editor, so the request carries its OWN copy of the play settings,
// sized as asked, and opens a floating window; the saved settings are never written.
#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "WonderlandHudTestLibrary.generated.h"

UCLASS()
class WONDERLAND_API UWonderlandHudTestLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** Ask for a play session in a new window of Width x Height. False outside the editor or while one is running. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	static bool RequestPlayInNewWindow(int32 Width, int32 Height);

	/**
	 * ONE FILM FRAME: the game layer -- world, HUD, terminals -- scaled to Width and written as JPEG. A frame a second of
	 * 3.4 MB PNGs cannot make a film the founder can watch; this is fast and small enough to take every tick.
	 * Width 0 keeps the viewport's own size.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	static bool CaptureViewportJpeg(const FString& FilePath, int32 Width = 1280, int32 Quality = 88);
};
