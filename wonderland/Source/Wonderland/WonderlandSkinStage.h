// WONDERLAND — THE RELAY DOG SKIN STAGE.
//
// FOUNDER DIRECTIVE (2026-09-22): "make sure the mascot skin and a relay dog in the project brain is 3-D moving around
// looking around staying at one place but is able to switch skins when I click on each skin it should switch skins."
//
// SO THE DOG IN THE PROJECT BRAIN IS A REAL ACTOR, not a picture of one. There is one stage in the world, standing a
// kilometre above the map where nothing can walk into it; a Relay Dog stands on it, breathing and looking about; a
// camera watches it and writes what it sees into a texture; the panel draws that texture. Clicking a skin card loads a
// different figure into the SAME body, so the switch is a change of dress on a Dog that never stopped moving, which is
// what the founder asked for and what a swapped-out image could not be.
//
// IT STAYS WHERE IT IS PUT. The Dog is given no controller, so the follow logic never runs and it cannot wander; the
// only motion is its own idle -- the figure's float and head motion -- and a slow look-around this stage drives on the
// actor's yaw. "Moving around, looking around, staying at one place."
//
// IT COSTS NOTHING WHEN NOBODY IS LOOKING. A scene capture is a second render of the world, so this one is off by
// default and runs only while a surface asks for it: the panel marks the stage wanted on every paint and the stage
// stops capturing a moment after the panel goes away. The same rule the Wonder Web windows use, for the same reason.
//
// NOT THE PLAYER'S DOG. This is a mannequin in a viewing room. It carries no mission state, joins nothing, and its
// activity is fixed at IDLE: a preview that appeared to be working would be Wonderland inventing an agent.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "WonderlandSkinStage.generated.h"

class AWonderlandCompanionEmbodiment;
class UPointLightComponent;
class USceneCaptureComponent2D;
class UStaticMeshComponent;
class UTextureRenderTarget2D;

UCLASS()
class WONDERLAND_API AWonderlandSkinStage : public AActor
{
	GENERATED_BODY()

public:
	AWonderlandSkinStage();

	virtual void Tick(float DeltaSeconds) override;

	/**
	 * The world's one stage, made on first use. Returns null only when there is no world to make it in -- a caller that
	 * gets null should draw nothing rather than draw a placeholder Dog, because a placeholder here would be a Dog the
	 * player does not own in a skin nobody chose.
	 */
	static AWonderlandSkinStage* Get(UWorld* World);

	/** Dress the Dog. Loads the skin's figure into the standing body; returns false and keeps the old dress on failure. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Skins")
	bool ShowSkin(FName SkinId);

	/** What it is wearing right now. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Skins")
	FName GetShownSkinId() const { return ShownSkinId; }

	/** The texture the panel draws. Never null once the stage exists. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Skins")
	UTextureRenderTarget2D* GetRenderTarget() const { return RenderTarget; }

	/**
	 * A SURFACE IS LOOKING. Called on every paint by whoever is drawing the texture; the stage captures while this is
	 * recent and sleeps when it goes quiet, so a closed panel costs one idle actor and no render.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Skins")
	void MarkWanted();

	/** Whether a capture ran recently. For a proof that has to show the picture is live rather than a still. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Skins")
	bool IsCapturing() const { return bCapturing; }

	/** How many frames this stage has captured. A proof reads it twice and compares. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Skins")
	int32 GetFrameCount() const { return FrameCount; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Skins")
	AWonderlandCompanionEmbodiment* GetBody() const { return Body; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Skins")
	FString GetLastError() const { return LastError; }

	/** Where the stage stands. Far above the world, where nothing can wander into the shot. */
	static FVector StageOrigin() { return FVector(0.0, 0.0, 100000.0); }

	/**
	 * THE PREVIEW'S FIXED EXPOSURE, in EV.
	 *
	 * WHY IT HAS TO BE FIXED AT ALL. SCS_FinalColorLDR runs the whole post chain, auto-exposure included, and this
	 * room is a thousand metres above the world with almost nothing in it. Auto-exposure adapted to that emptiness
	 * and drove every frame to pure white -- the founder's "the large WHITE preview area is blank" was not a blank
	 * panel at all, it was a correctly captured photograph of a blown-out sky.
	 *
	 * AND WRITEABLE, so the value is found by sweeping it in a live session and looking, the same way the Mission
	 * Contract orb's exposure was. Guessing a photometric constant and rebuilding to test it costs a cycle a try.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Skins")
	float PreviewExposureEv = 11.0f;

	/** Re-apply the exposure and show flags after PreviewExposureEv is changed. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Skins")
	void ApplyPreviewExposure();

	/**
	 * BRING THE PREVIEW DOG INTO THE WORLD, where the founder can simply look at it.
	 *
	 * WHY THE PICTURE MOVED INSTEAD OF THE PANEL. The wardrobe's mirror was a SceneCaptureComponent2D writing to a
	 * render target, and in this build that capture writes pure white: measured across ten configurations -- stage
	 * lights at full, at a hundredth and at a ten-thousandth; post processing disabled; SceneColorHDR instead of
	 * tonemapped LDR; exposure swept from EV -10 to +15; an 8-bit and a 16-bit float target; moved down into the
	 * fully loaded plaza; engine-driven every-frame capture; and bAlwaysPersistRenderingState on. A capture that
	 * ignores the scene, the lights, the tonemapper and its own location is not photographing anything.
	 *
	 * SO THE DOG COMES TO THE FOUNDER. Everything else about this stage was already proven working -- it spawns a
	 * real body, dresses it from the registry, keeps it in one place and idles its head, arms, legs and spine --
	 * and none of that needed the capture. Standing it in front of the player is live 3D by construction: there is
	 * no image to be stale, and nothing that could be faked with a screenshot.
	 *
	 * THE BACKDROP AND PLINTH GO WITH IT, but the backdrop is hidden: a dark wall floating in the arrival plaza
	 * would read as broken scenery. The plinth stays, because a figure standing on something reads as staged
	 * rather than as an actor that wandered in.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Skins")
	void SetInWorldPreview(bool bOn, FVector Where, FRotator Facing);

	UFUNCTION(BlueprintPure, Category = "Wonderland|Skins")
	bool IsInWorldPreview() const { return bInWorldPreview; }

	/**
	 * 360 DEGREE INSPECTION, AND ONLY WHEN ASKED.
	 *
	 * FOUNDER, 2026-09-25: "Do NOT make the mascot rotate continuously by default. Normal Wardrobe state:
	 * STATIC. The mascot should ONLY begin rotating when the player presses the 360 button ... Press again:
	 * stop. If stopped midway, it can smoothly return to the canonical front-facing preview orientation."
	 *
	 * Off, the figure holds the canonical front -- and EASES back to it rather than snapping, so stopping
	 * halfway round is a turn home and not a jump cut. Its own float and head motion continue underneath:
	 * "static" is about the turntable, not about making a statue of it.
	 */
	void SetInspectSpin(bool bOn);

	bool IsInspectSpinning() const { return bSpinning; }

	/** The figure's yaw right now, degrees, so a proof can say which face it was photographing. */
	float GetInspectYaw() const { return Yaw; }

protected:
	virtual void BeginPlay() override;

private:
	void EnsureBody();
	void AimCamera();
	void StepLookAround(float DeltaSeconds);

	UPROPERTY(Transient)
	TObjectPtr<USceneComponent> StageRoot;

	UPROPERTY(Transient)
	TObjectPtr<USceneCaptureComponent2D> Capture;

	UPROPERTY(Transient)
	TObjectPtr<UTextureRenderTarget2D> RenderTarget;

	UPROPERTY(Transient)
	TObjectPtr<UStaticMeshComponent> Backdrop;

	UPROPERTY(Transient)
	TObjectPtr<UStaticMeshComponent> Plinth;

	UPROPERTY(Transient)
	TObjectPtr<UPointLightComponent> KeyLight;

	UPROPERTY(Transient)
	TObjectPtr<UPointLightComponent> FillLight;

	UPROPERTY(Transient)
	TObjectPtr<UPointLightComponent> RimLight;

	UPROPERTY(Transient)
	TObjectPtr<AWonderlandCompanionEmbodiment> Body;

	FName ShownSkinId;
	FString LastError;

	/** Seconds since a surface last asked for a frame. */
	float SinceWanted = 1000.0f;
	float SinceCapture = 0.0f;
	bool bCapturing = false;

	/** True while the preview body is standing in the world rather than in the viewing room. */
	bool bInWorldPreview = false;
	int32 FrameCount = 0;

	/** The look-around: where the head is pointed, where it is going, and how long it waits before choosing again. */
	/** True while the player is holding the 360 button on: the only state in which the figure turns. */
	bool bSpinning = false;
	float Yaw = 0.0f;
	float YawTarget = 0.0f;
	float HoldRemaining = 1.2f;
};
