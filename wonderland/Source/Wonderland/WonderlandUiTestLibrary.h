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
	 * THE MISSION TASK SET AND THE MISSION SUBSYSTEM, for a proof that has to read them.
	 *
	 * Both are LocalPlayerSubsystems, and this build's Python exposes no route to one: `PlayerController.Player` is
	 * protected, `LocalPlayer` has no `get_subsystem`, and `SubsystemBlueprintLibrary` is not reflected here. Rather
	 * than have every job rediscover that, the test library hands them over the same way it already hands over the
	 * UI subsystem.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Test", meta = (WorldContext = "WorldContextObject"))
	static class UWonderlandMissionTaskSubsystem* GetMissionTasks(UObject* WorldContextObject);

	UFUNCTION(BlueprintPure, Category = "Wonderland|Test", meta = (WorldContext = "WorldContextObject"))
	static class UWonderlandMissionSubsystem* GetMission(UObject* WorldContextObject);

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
	 * THE WORLD SUBSYSTEMS A PROOF HAS TO DRIVE, handed over in C++ because Python cannot reach them.
	 *
	 * UWorld has no get_subsystem on the Python surface in this build, which is what stopped the sub-agent and
	 * Wonder Web demonstration dead. This is the smallest honest way round it: two accessors that hand back the
	 * real subsystems, so the demo exercises the actual runtime rather than a fixture standing in for it.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Test", meta = (WorldContext = "WorldContextObject"))
	static class UWonderlandDemoSubsystem* GetDemo(UObject* WorldContextObject);

	UFUNCTION(BlueprintPure, Category = "Wonderland|Test", meta = (WorldContext = "WorldContextObject"))
	static class UWonderlandSubAgentCubSubsystem* GetCubs(UObject* WorldContextObject);

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

	/**
	 * WHAT IS ACTUALLY ON THE SCREEN INSIDE A RECTANGLE -- read from the same back buffer the founder photographs.
	 *
	 * FOUNDER, 2026-09-25: "The screenshot is ground truth ... PIE test the visible pixels/content of the preview
	 * for every skin", and "my screenshots/video override a proof that says a visibly broken feature is complete."
	 *
	 * Every wardrobe proof this project has written asked the PANEL whether it was open and the CAMERA where it
	 * was pointing, and every one of them passed while the preview window showed the brain chamber. Neither
	 * instrument can see a picture. This one can: the rectangle is given in fractions of the viewport (0-1), the
	 * pixels inside it are read back, and what comes out is the mean colour, how much of it is nearly black and
	 * how much is nearly white -- which is exactly the difference between a black preview with a figure standing
	 * on it and a white brain chamber with snow falling through it.
	 *
	 * Sampled on a grid rather than every pixel: the answer is a proportion, and 10,000 samples settle it.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	static bool ReadScreenRect(float MinX, float MinY, float MaxX, float MaxY,
		FLinearColor& OutMean, float& OutDarkFraction, float& OutBrightFraction, int32& OutSampled);

	/**
	 * PRESS A COLOUR SWATCH, exactly as the Wardrobe's and the Menu's own swatches press it.
	 *
	 * Both of those write the canonical settings and then call WonderlandMascotStyle::SaveAndApply, and so does
	 * this -- one line each, so a proof cannot pass through a path the player does not use. That is the mistake
	 * the wardrobe made for a week.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	static bool PickMascotColour(bool bPrimary, FLinearColor Colour);

	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	static bool PickCompanionColour(bool bPrimary, FLinearColor Colour);

	/** What the canonical state holds right now, so a proof can check the Wardrobe and the Menu agree. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Test")
	static FLinearColor GetMascotColour(bool bPrimary);

	UFUNCTION(BlueprintPure, Category = "Wonderland|Test")
	static FLinearColor GetCompanionColour(bool bPrimary);

	/** Put every customisable colour back to the one its art was designed in. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	static bool ResetAllColours();
};
