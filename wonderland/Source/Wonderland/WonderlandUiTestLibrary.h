// WONDERLAND — hooks the automated PIE checks drive the UI through.
//
// KEYS GO THROUGH SLATE, NOT AROUND IT. PressKey and TypeText hand key and
// character events to FSlateApplication exactly as the platform layer would, so a
// check that "Ctrl+T opens the terminal" exercises the same route a real keyboard
// takes: Slate focus, the game viewport, the player controller's input stack, and
// the binding. Calling ToggleLiveTerminal directly would prove the function works
// and nothing about the key.
//
// THE USAGE FIXTURE IS SIMULATED AND SAYS SO. It pushes the same canonical
// scenes the HUD preview renders (scripts/wonderland-hud-preview.tsx) through the
// real usage subsystem, with every meter marked Simulated. It exists so the arcs can
// be seen moving in PIE before a usage authority reports; it is never a stand-in
// for one, and nothing in the product path calls it.
#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "WonderlandUiTestLibrary.generated.h"

class UWonderlandUiSubsystem;

UCLASS()
class WONDERLAND_API UWonderlandUiTestLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** The local player's UI subsystem in the world of the context object. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test", meta = (WorldContext = "WorldContextObject"))
	static UWonderlandUiSubsystem* GetUi(UObject* WorldContextObject);

	/**
	 * SPAWN ONE VOXEL FIGURE, standing where it is put, following nobody. Used by the Project Avatar progression proof:
	 * the six forms are text files, so a founder's correction is a regeneration rather than a rebuild.
	 *
	 * Test-only, and it says so: this is how a proof builds a comparison scene in PIE. It is not how a Project Avatar
	 * comes to be attached to a project.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test", meta = (WorldContext = "WorldContextObject"))
	static class AWonderlandCompanionEmbodiment* SpawnFigureActor(UObject* WorldContextObject, FVector Location, const FString& FigurePath, const FString& Label);

	/**
	 * Put the view where a proof needs it: one camera, posed, looking at a point. The same camera for every form in a
	 * family, because a progression judged from three different angles is not a progression anyone can judge.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test", meta = (WorldContext = "WorldContextObject"))
	static bool PoseCamera(UObject* WorldContextObject, FVector Location, FVector LookAt, float FieldOfView = 55.0f);

	/** Give the view back to the player. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test", meta = (WorldContext = "WorldContextObject"))
	static bool ReleaseCamera(UObject* WorldContextObject);

	/** Press and release one key through Slate, optionally with Control held. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	static bool PressKey(FName KeyName, bool bControl);

	/** Hold (true) or release (false) one key through Slate. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	static bool SetKeyHeld(FName KeyName, bool bDown);

	/** Type characters through Slate: key down, character, key up, for each. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	static bool TypeText(const FString& Text);

	/** Give keyboard focus to the game viewport, as clicking into the game would. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	static void FocusGameViewport();

	/**
	 * Save what the player sees -- the rendered world with the HUD and any open panel
	 * over it -- to a PNG, read back from the game viewport's own Slate layer. A scene
	 * capture would prove the world rendered and nothing about the UI drawn over it.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	static bool CaptureGameViewport(const FString& FilePath, int32& OutWidth, int32& OutHeight);

	/**
	 * Push a canonical usage scene through the real subsystem, marked Simulated.
	 * Scenes: typical, nearly_spent, untouched. bLargeTier picks the longer tier.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test", meta = (WorldContext = "WorldContextObject"))
	static bool ApplySimulatedUsageScene(UObject* WorldContextObject, FName Scene, bool bLargeTier);

	/**
	 * Editor only: register the editor's own ShouldDisableCPUThrottling hook for this session
	 * ("Use Less CPU when in Background" is neither visible to Python nor settable with `set` in
	 * the editor). Nothing is written to the user's settings. False outside the editor.
	 *
	 * MEASURED 2026-09-13: this is NOT enough for frame-time work. With the hook on, PIE behind
	 * another window still ran at 2.5-3.1 fps, and at 18-27 fps the moment the editor held the
	 * foreground -- another background cap applies. Frame rates are only measurements when the
	 * editor is in the foreground (beta_tour / beta_probe record that per sample).
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	static bool SetBackgroundThrottleSuspended(bool bSuspended);
};
