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

	/**
	 * WHAT ONE FRAME COST, unsmoothed -- the only form in which a HITCH exists.
	 *
	 * GetFrameCostMs ABOVE CANNOT SEE A HITCH, and nothing said so for the length of three measurement passes.
	 * FStatUnitData keeps two parallel sets of fields, and its own comments name them: the block holding
	 * FrameTime is "unit frame times filtered with a simple running average", and the block below it is the
	 * "raw equivalents". The filter is
	 *
	 *     FrameTime = 0.9 * FrameTime + 0.1 * RawFrameTime;
	 *
	 * applied identically to game, render and GPU -- an exponential average with a ten-frame memory. The
	 * engine's own performance snapshot assigns that field to a variable called AverageFrameTime.
	 *
	 * SO A ONE-FRAME SPIKE OF 200 ms ARRIVES AS 15 ms, and a p95 or a worst case taken from the filtered
	 * field is a percentile of a curve that has already had its peaks removed. The avatar ladder published
	 * "spawn p95" and "hitch over quiet" from it and got a NEGATIVE hitch at one and ten avatars -- spawning
	 * cheaper than standing still -- which is not a surprising result but an impossible one, and was the
	 * evidence that the instrument could not see what it was named after.
	 *
	 * The MEDIAN of the filtered field is still a fair estimate of average cost, so GetFrameCostMs keeps its
	 * callers. Use THIS for anything about extremes: p95, worst frame, spawn cost, stutter.
	 *
	 * Returns false when no viewport is running, so a missing reading is never mistaken for a cheap one.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	static bool GetRawFrameCostMs(float& OutFrameMs, float& OutGameMs, float& OutRenderMs, float& OutGpuMs);

	/**
	 * THE ENGINE'S FRAME NUMBER, so a count of READS can be turned into a count of FRAMES.
	 *
	 * A Python probe polling a stat in a tight loop gets several reads inside one frame and none inside the
	 * next. The avatar ladder reported 253 samples whose median, p95 and worst case were the same number to
	 * the hundredth -- 253 reads of a value that changed a handful of times. Percentiles over that are
	 * weighted by how often the loop happened to run, which is a property of the harness.
	 *
	 * Compare this between reads and keep the ones where it moved.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	static int64 GetEngineFrameNumber();

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

	/**
	 * THE AGENT ROWS THE USAGE HUD LAST PAINTED, "LABEL|Name" each (P1 item 7).
	 *
	 * The widget records them itself, inside the loop that emits the glyphs. This only carries them out,
	 * because a proof cannot reach the widget on its own: UMG's WidgetBlueprintLibrary has no Python binding
	 * in this engine, so there is no way to enumerate live widgets from a job. Iterating them here is three
	 * lines and needs no binding at all.
	 *
	 * Empty means no usage HUD in that world painted rows -- a real state, and the one H00 asks about.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test", meta = (WorldContext = "WorldContextObject"))
	static TArray<FString> GetPaintedAgentRows(UObject* WorldContextObject);

	/**
	 * WHICH POINTER WONDERLAND IS ACTUALLY DRAWING, and whether it is drawing one at all.
	 *
	 * FOUNDER, P1 item 8: "Add Wonderland cursor customization." Built, and evidenced only by photographs --
	 * and a screenshot of a pointer cannot distinguish a cursor the setting chose from a cursor that happens
	 * to look like it. Worse, the shape is captured into the widget at Apply() time rather than bound live,
	 * so a setting that changed without a re-apply would look right in the settings and wrong on screen.
	 *
	 * OutShape is the shape the drawn widget was built from. The return value is whether the viewport is
	 * using software cursor widgets at all -- false means the machine's own pointer is showing and
	 * Wonderland is drawing nothing, which is the failure a photograph is least likely to reveal.
	 */
	/**
	 * TWO PLAIN RETURNS RATHER THAN ONE RETURN AND AN OUT-PARAMETER.
	 *
	 * The first version was `bool GetDrawnCursor(UObject*, FString& OutShape)` and came back as None in
	 * Python -- an out-parameter's binding shape is not worth guessing at, and a proof that cannot read its
	 * own instrument proves nothing. Two functions, two ordinary values, no ambiguity.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	static FString GetDrawnCursorShape();

	/** False means the machine's own pointer is showing, whatever the settings say. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test", meta = (WorldContext = "WorldContextObject"))
	static bool IsDrawingWonderlandCursor(UObject* WorldContextObject);

	/** The Julius Connect link as a word: "Online", "Connecting", "Offline", or "" if the subsystem is absent.
	 *
	 *  ROUTED THROUGH HERE BECAUSE PYTHON CANNOT REACH A GameInstanceSubsystem. unreal.get_editor_subsystem
	 *  and get_engine_subsystem exist; there is no binding for UGameInstance::GetSubsystem, and a proof that
	 *  cannot ask the game what state it is in has to settle for photographing it. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Test", meta = (WorldContext = "WorldContextObject"))
	static FString GetJuliusLinkState(UObject* WorldContextObject);

	/** What the offline panel gives as the reason, and the command it prints to fix it. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Test", meta = (WorldContext = "WorldContextObject"))
	static FString GetJuliusLinkProblem(UObject* WorldContextObject);

	UFUNCTION(BlueprintPure, Category = "Wonderland|Test", meta = (WorldContext = "WorldContextObject"))
	static FString GetJuliusStartCommand(UObject* WorldContextObject);

};
