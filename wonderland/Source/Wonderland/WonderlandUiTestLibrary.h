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
};
