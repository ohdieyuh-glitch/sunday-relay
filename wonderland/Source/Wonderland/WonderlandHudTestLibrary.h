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

	/**
	 * WHAT A FRAME ACTUALLY COSTS, from the engine's own unit counters rather than from the world's delta.
	 *
	 * THE MEASUREMENT THIS REPLACES WAS VOID. The first Project Avatar pass timed frames with
	 * GetWorldDeltaSeconds and reported 349 ms mean / 400 ms worst -- WITH NO AVATARS SPAWNED AT ALL. 400.00 is
	 * UE's max-delta clamp, not a reading, and an unfocused PIE window throttles into it, so every number in
	 * that run described the editor's throttle rather than the cost of anything.
	 *
	 * FStatUnitData is what the stat unit overlay itself draws: frame, game thread, render thread and GPU, each
	 * measured where it happens. Returns false when no viewport is running, so a missing reading is never
	 * mistaken for a cheap one.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	static bool GetFrameCostMs(float& OutFrameMs, float& OutGameMs, float& OutRenderMs, float& OutGpuMs);

	/** Draw calls and primitives the renderer issued for the last frame. Zero for both means it was not counted. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	static bool GetDrawCallCount(int32& OutDrawCalls, int32& OutPrimitives);

	/**
	 * A SCENE CAPTURE IN THE RUNNING WORLD, so a proof can READ the picture instead of photographing it.
	 *
	 * WHY THIS IS HERE. Two of the founder's items can only be settled by comparing one frame against
	 * another: shadows must hold still while the world does (P2-11), and water must NOT (P2-10). A JPEG
	 * capture cannot answer either -- nothing in the toolchain can read one back -- and a person looking at
	 * two screenshots of a pond cannot tell a slow ripple from a still one.
	 *
	 * A render target can be read a pixel at a time, so the comparison becomes a number. The capture is
	 * transient, manual (it captures when asked, not every frame, so the proof controls exactly when each
	 * frame is taken), and spawned by the test library rather than by the game: nothing in Wonderland
	 * creates or needs one.
	 *
	 * Returns null when there is no world to spawn into, which is a real state a proof must handle rather
	 * than a failure to hide.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test", meta = (WorldContext = "WorldContextObject"))
	static class ASceneCapture2D* SpawnSceneCapture(UObject* WorldContextObject, FVector Location,
		FRotator Rotation, class UTextureRenderTarget2D* Target);

};
