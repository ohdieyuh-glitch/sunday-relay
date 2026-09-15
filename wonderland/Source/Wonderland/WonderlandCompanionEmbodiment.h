// WONDERLAND — A COMPANION, EMBODIED. The imported companion floating beside the Relay Dog.
//
// THE FOUNDER'S DISTINCTION, 2026-09-15, and the reason this is an actor and not a widget: an imported
// LLM Companion and an imported Jhinn AI Agent are PHYSICALLY PRESENT in the world beside the Compound
// Agent's Dog. Their terminals are separate on-screen panels (SWonderlandCompanionTerminal), owned by the
// UI subsystem; this body is owned by the world. A panel can close without a body vanishing, and a body
// can drift off-screen without its console following it.
//
// WHAT IT DOES, and nothing else:
//
//   BUILDS a body from a figure file (WonderlandCompanionFigure.h): one scene pivot per part, one
//   instanced-mesh component per part and material, runtime material instances only. No asset is
//   created or modified, and no shared material instance is ever touched.
//
//   FOLLOWS the player's pawn -- whichever body the controller wears, so a replaced pawn is followed
//   too -- floating at an offset in the pawn's yaw frame, trailing it with an exponential lag, and
//   snapping after a teleport rather than streaking across the map. Idle, it turns to look at the
//   camera, the way a companion looks back at you; moving, it faces where the Dog is going.
//
//   ANIMATES its parts BOUNDED and ASYNCHRONOUS, the rules UWonderlandHoverComponent set for the few
//   things in Wonderland that float: every pose is computed absolutely from rest, so nothing drifts,
//   and each companion's phase is hashed from its name, so two companions never breathe in step.
//
// NO COLLISION, NO NAVIGATION, NO INPUT. It is a presence, not a physics body, and it cannot block the
// Dog, a camera trace or a travel landing.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "WonderlandCompanionFigure.h"
#include "WonderlandCompanionEmbodiment.generated.h"

class APlayerController;
class UInstancedStaticMeshComponent;
class UMaterialInstanceDynamic;
class UMaterialInterface;

UCLASS(NotBlueprintable)
class WONDERLAND_API AWonderlandCompanionEmbodiment : public AActor
{
	GENERATED_BODY()

public:
	AWonderlandCompanionEmbodiment();

	virtual void Tick(float DeltaSeconds) override;

	/**
	 * Build the body from a figure file. Returns false -- and leaves any body already standing untouched --
	 * when the file cannot be read or does not parse; the reason is logged and kept in GetLastError().
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	bool LoadFigure(const FString& FilePath);

	/** Rebuild from the file this body was last built from. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	bool ReloadFigure();

	/** Follow whatever pawn this controller is wearing, now and after it changes. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void SetFollowController(APlayerController* Controller);

	/** Jump to the follow position immediately instead of gliding there. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void SnapToTarget();

	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	APawn* GetFollowPawn() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	int32 GetBoxCount() const { return BoxCount; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	int32 GetPartCount() const { return PartPivots.Num(); }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	FString GetLastError() const { return LastError; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	FString GetFigurePath() const { return FigurePath; }

	/** The presentation name, e.g. "GPT 6 Astra". */
	UPROPERTY(VisibleAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	FString DisplayName;

	/** What kind of import this is, e.g. "LLM COMPANION" or "JHINN AI AGENT". */
	UPROPERTY(VisibleAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	FString ClassLabel;

	/** Where to float, in the pawn's yaw frame: X forward, Y right, uu. Z is added to HoverHeightUU. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	FVector FollowOffset = FVector(-40.0, -135.0, 0.0);

	/** Height of the figure's origin (its tail tip) above the pawn's feet, uu. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float HoverHeightUU = 34.0f;

	/** Vertical travel either side of the hover height, uu. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float HoverAmplitudeUU = 6.0f;

	/** Seconds for one rise and fall. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float HoverPeriodSeconds = 3.8f;

	/** Time constant of the follow, seconds: how far behind a running Dog the companion trails. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float FollowLagSeconds = 0.30f;

	/** Uniform scale on top of the figure's own voxel size. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float FigureScale = 1.0f;

	/** Turn to face the camera once the pawn has stood still this long. Negative never does. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float FaceCameraAfterIdleSeconds = 1.2f;

	/** Farther than this from the follow position and the companion snaps rather than glides: a teleport. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float SnapDistanceUU = 1800.0f;

	/** Radius of the sphere kept clear of walls around the companion's body, uu. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float BodyClearanceRadiusUU = 38.0f;

	/** Height of the body's centre above the figure origin (its tail tip), where the wall sweep aims, uu. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float BodyClearanceHeightUU = 80.0f;

private:
	/** A part's animation state. Parallel to PartPivots; plain data, never serialised. */
	struct FPartMotion
	{
		EWonderlandCompanionMotion Motion = EWonderlandCompanionMotion::None;
		float A = 0.0f;
		float B = 0.0f;
		FVector RestLocation = FVector::ZeroVector;
	};

	/** A glowing material's rest colour, so a pulse is computed from rest and never accumulates. */
	struct FGlowMaterial
	{
		int32 MaterialIndex = INDEX_NONE;
		FName Parameter;
		FLinearColor Rest = FLinearColor::White;
	};

	UMaterialInterface* ParentFor(EWonderlandCompanionMaterialKind Kind) const;
	void ClearBody();
	FVector DesiredLocation(const APawn* Pawn) const;
	void Animate(float TimeSeconds);

	UPROPERTY(VisibleAnywhere, Category = "Wonderland|Companion")
	TObjectPtr<USceneComponent> Root;

	/** Everything the figure builds hangs from this; the hover moves it, so parts animate on top of the float. */
	UPROPERTY(VisibleAnywhere, Category = "Wonderland|Companion")
	TObjectPtr<USceneComponent> FloatRoot;

	UPROPERTY(Transient)
	TArray<TObjectPtr<USceneComponent>> PartPivots;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UInstancedStaticMeshComponent>> PartMeshes;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UMaterialInstanceDynamic>> MaterialInstances;

	TArray<FPartMotion> Motions;
	TArray<FGlowMaterial> GlowMaterials;
	TWeakObjectPtr<APlayerController> FollowController;
	FString FigurePath;
	FString LastError;
	int32 BoxCount = 0;
	float Phase = 0.0f;
	float IdleSeconds = 0.0f;
	bool bHasSnapped = false;
};
