// WONDERLAND — THE PROJECT BRAIN, ALIVE, AND THE PYTHON THAT WEAVES AROUND IT.
//
// FOUNDER (2026-09-23): "Create a 3D BRAIN that feels alive and active ... continuous subtle organic movement."
// And for the snake: "DO NOT make the snake simply rotate around the brain on a generic circular orbit. I do NOT
// want brain + snake mesh + constant RotateAroundActor(). That will look artificial."
//
// SO THE SNAKE HAS NO ORBIT IN IT AT ALL. There is no angle being incremented and no axis being rotated about.
// The head chases a WANDERING TARGET over an invisible shell around the brain, and the body is not animated: it
// is the head's own route, replayed. That single rule -- be where the head was, this far back along its path --
// is what produces the lateral wave, the overshoot through a turn and the follow-through when the head changes
// its mind, none of which has to be authored.
//
// The target moves by smoothed noise on two angles and a radius, so the route is never the same twice, changes
// elevation, passes over and behind the mass, and occasionally reverses.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "WonderlandBrainSculpture.generated.h"

class UInstancedStaticMeshComponent;
class UStaticMeshComponent;
class UProceduralMeshComponent;
class UMaterialInstanceDynamic;

/**
 * A LIVING PROJECT BRAIN with a python weaving around it, built from instanced boxes the way every other
 * Wonderland figure is -- no imported mesh, no Content asset, so it exists wherever the module does.
 */
UCLASS()
class WONDERLAND_API AWonderlandBrainSculpture : public AActor
{
	GENERATED_BODY()

public:
	AWonderlandBrainSculpture();

	virtual void PostInitializeComponents() override;
	virtual void Tick(float DeltaSeconds) override;

	/** Overall size, uu, from the centre to the widest point of the brain. Everything scales off this. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Brain")
	float BrainRadiusUU = 120.0f;

	/** How many segments the python has. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Brain")
	int32 SnakeSegments = 46;

	/**
	 * THE GAP BETWEEN ONE SEGMENT AND THE NEXT, MEASURED ALONG THE PATH -- so the animal has a fixed length.
	 *
	 * THIS USED TO BE A DELAY IN SECONDS, AND THAT WAS WRONG. Lagging each segment by a fixed TIME makes the
	 * body's length proportional to however fast the head happens to be moving. Simulated over a forty-second
	 * run the head's speed ranged from 2 to 284 uu/s and the snake's length ranged from 29 to 390 uu with it:
	 * it inflated into a python and collapsed into a bead every few seconds. Spacing by DISTANCE instead holds
	 * the length constant whatever the head does -- measured 617 to 647 uu in steady state, a swing of 4%.
	 *
	 * Default is a fraction of the brain, so 46 segments make a python about 650 uu long: two thirds of the way
	 * around the shell it swims on.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Brain")
	float SegmentSpacingUU = 14.4f;

	/* ------------------------------------------------ what a proof reads, so the motion can be argued about */

	/** Where the head is now, actor-local space. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Brain")
	FVector GetSnakeHeadLocation() const { return HeadWorld; }

	/** How far the head is from the brain's centre; a proof checks this never enters the mass. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Brain")
	float GetHeadRadiusUU() const;

	/** The closest any segment comes to the brain centre this frame -- the anti-clipping guarantee, measured. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Brain")
	float GetClosestSegmentRadiusUU() const;

	/**
	 * The python's actual length this frame, summed gap by gap. A proof reads it repeatedly: an animal whose
	 * length changes is the defect this design exists to remove, so it must come back very nearly constant.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Brain")
	float GetBodyLengthUU() const;

	/** How much the brain is currently swollen by its own breathing, 0..1 of the pulse's range. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Brain")
	float GetBreath() const { return Breath; }

	/**
	 * THE PROOF THAT IT IS NOT AN ORBIT. A circular orbit visits every bearing at a constant rate and returns a
	 * near-zero spread; a wandering route does not. This reports the standard deviation, in degrees, of the
	 * bearing change per second over the last eight seconds.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Brain")
	float GetBearingRateSpreadDeg() const;

	/**
	 * WHY CAN I NOT SEE IT. Actor exists, transforms update, materials are made -- and the window is empty. This
	 * reports the things that actually decide whether a pixel is drawn: how many instances each component really
	 * holds, whether it has a mesh and a material at all, where the actor is, and whether it is hidden.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Brain")
	FString DescribeRendering() const;

private:
	void BuildBrain();
	void BuildSnake();
	/** Move the wandering target, then the head toward it, and record the path at a fixed arc length. */
	void AdvanceHead(float FixedStep);
	void AdvanceBody();
	void Breathe(float DeltaSeconds);

	/** Where the head was, this far back ALONG ITS OWN PATH. Interpolated between stored points. */
	FVector SamplePath(float DistanceBackUU) const;
	/** The k-th newest stored path point, k = 0 being the newest. */
	FVector PathPoint(int32 StepsBack) const;
	/** How finely the path is stored. A quarter of a segment gap, so sampling between points stays smooth. */
	float PathResolution() const;
	/** Stands the dark chamber wall behind the brain, from wherever the founder is actually looking. */
	void StandTheChamber();

	/**
	 * THE BRAIN AS A SURFACE, built once.
	 *
	 * FOUNDER: "organic, polished, realistic, not Roblox/blocky." A brain made of instanced cubes cannot be any
	 * of those however fine the voxel gets -- at the size it is framed the silhouette is stepped and the folds
	 * read as terracing. This lays down a real skinned ovoid: gyri raised and sulci cut by layered noise, a
	 * longitudinal fissure down the midline, and smooth shared vertex normals so the light runs over it.
	 */
	void BuildBrainSurface();
	/** THE PYTHON AS A TUBE swept along the very path the segments already follow, rebuilt each frame. */
	void RebuildSnakeSurface();

	/** Smooth per-vertex normals from the faces that share each vertex. */
	static void SmoothNormals(const TArray<FVector>& Verts, const TArray<int32>& Tris, TArray<FVector>& OutNormals);

	/**
	 * THE DARK CHAMBER THE BRAIN STANDS IN -- the same trick the wardrobe already uses and which the founder
	 * asked not to be broken. Cutting the night field open lets the sculpture through, but it also lets the
	 * GARDEN through, and a brain floating over mushrooms is not a brain framed in a window. This wall stands
	 * behind it and gives the hole something black to be a window onto.
	 */
	UPROPERTY() TObjectPtr<UStaticMeshComponent> Backdrop = nullptr;
	/**
	 * THE REST OF THE CHAMBER.
	 *
	 * A back wall alone cannot hide what stands in FRONT of the brain, and photographed in PIE a white voxel
	 * prop from the plaza was doing exactly that -- poking into the top-left of the brain window, past a
	 * backdrop that was doing its job faithfully several hundred uu further away. Five panels make an
	 * open-fronted box around the sculpture, so the only things that can intrude are the ones already inside it.
	 */
	UPROPERTY() TObjectPtr<UStaticMeshComponent> ChamberTop = nullptr;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> ChamberFloor = nullptr;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> ChamberLeft = nullptr;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> ChamberRight = nullptr;
	/** The real geometry. The instanced boxes below are kept only for the eyes, which are specks. */
	UPROPERTY() TObjectPtr<UProceduralMeshComponent> BrainSurface = nullptr;
	UPROPERTY() TObjectPtr<UProceduralMeshComponent> SnakeSurface = nullptr;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> BrainSurfaceMid = nullptr;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> SnakeSurfaceMid = nullptr;
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> BrainMesh = nullptr;
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> BrainFold = nullptr;
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> SnakeMesh = nullptr;
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> SnakeBelly = nullptr;
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> SnakeHead = nullptr;
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> SnakeEyes = nullptr;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> BrainMid = nullptr;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> FoldMid = nullptr;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> SnakeMid = nullptr;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> BellyMid = nullptr;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> HeadMid = nullptr;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> EyeMid = nullptr;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> BackdropMid = nullptr;

	/**
	 * BLACK SNOW, FALLING TOP TO BOTTOM, CONTINUOUSLY (founder, 2026-09-25).
	 *
	 * One instanced component holding every flake. It falls in the CAMERA'S frame rather than the world's,
	 * because the chamber is built from the lens every frame and the founder is looking through one face of
	 * it: snow that fell along world -Z would drift diagonally across the window whenever the camera turned,
	 * and would fall sideways if the camera ever looked up.
	 */
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> Snow = nullptr;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> SnowMid = nullptr;

	/** Per-flake constants: X across, Y its starting height, Z depth into the chamber, W its fall rate. */
	TArray<FVector4> SnowSeeds;
	/** Per-flake size in engine-cube units, and a sway phase so no two drift together. */
	TArray<FVector2D> SnowShape;

	/** Re-place every flake for this frame, in the chamber's own basis. */
	void DriftTheSnow();

	/**
	 * THE CHAMBER'S OWN TWO LIGHTS, a key and a fill.
	 *
	 * The sculpture never had a light. It did not need one while it was built out of the panel's own
	 * blue-black: a near-black mass on a near-black wall reads by silhouette alone. A RED brain on a WHITE
	 * wall does not -- the chamber is a closed box, the sun barely reaches inside it, and without a light of
	 * its own the brain photographed as a black blob in a beige room.
	 *
	 * Placed from the lens every frame like the panels are, so the key always falls from the founder's upper
	 * left and the folds read the same way from any angle the sculpture is viewed at.
	 */
	UPROPERTY() TObjectPtr<class UPointLightComponent> KeyLight = nullptr;
	UPROPERTY() TObjectPtr<class UPointLightComponent> FillLight = nullptr;

	/**
	 * THE HEAD'S PATH, RESAMPLED AT A FIXED ARC LENGTH, in a ring that never reallocates. Storing one sample per
	 * frame would make the body's shape depend on the frame rate; storing one per fixed TIME still ties its
	 * length to the head's speed. One per fixed DISTANCE ties it to neither.
	 *
	 * IT IS FILLED AT BIRTH, not left to grow. An empty path makes every far segment fall back on the oldest
	 * point it has, which stacks the whole tail on one spot: measured, the snake spent its first ten seconds
	 * between 48 and 640 uu long while the buffer filled. Laying a starting route down the shell behind the head
	 * means the animal is its full length on the first frame anyone sees it.
	 */
	TArray<FVector> Path;
	int32 PathWrite = 0;
	int32 PathCount = 0;
	FVector LastPathPoint = FVector::ZeroVector;
	/** Arc length from the newest stored point up to where the head is right now. */
	float SinceLastPoint = 0.0f;
	float StepAccumulator = 0.0f;

	/** Girth of each segment, uu, decided once at build time. */
	TArray<float> SegmentGirth;
	/** Scratch for a tick's segment positions, so neighbours can be read while transforms are written. */
	TArray<FVector> SegmentSpot;

	/**
	 * THE HEAD IS KEPT AS A DIRECTION AND A DISTANCE, not as a point.
	 *
	 * WHY, MEASURED. The first version chased a target POINT: when the target crossed to the far side of the brain
	 * the straight-line chase cut through the middle and the minimum-radius clamp had to shove the head back out.
	 * Simulated over six runs, the head's smallest radius came out at EXACTLY the clamp every single time -- the
	 * safety net was doing the steering, which is both ugly and fragile. Springing a direction over the shell and a
	 * radius in and out separately puts the head outside the brain BY CONSTRUCTION; the clamp then never fires
	 * (smallest radius measured 151.6 uu against a 139.2 floor) and goes back to being a thing that cannot happen.
	 */
	FVector HeadDir = FVector::ForwardVector;
	/** Tangent to the shell: the direction's own momentum, which is what gives the turn its overshoot. */
	FVector HeadSwing = FVector::ZeroVector;
	float HeadRadius = 0.0f;
	float RadiusVel = 0.0f;
	/** Where that lands in actor space. Derived every substep; never integrated directly. */
	FVector HeadWorld = FVector::ZeroVector;

	/** The wandering target, in the shell's own spherical coordinates. */
	float TargetYaw = 0.0f;
	float TargetPitch = 0.0f;
	float TargetRadius = 0.0f;
	/** Noise clocks, at unrelated rates so the route never repeats on a short cycle. */
	float YawSeed = 0.0f;
	float PitchSeed = 0.0f;
	float RadiusSeed = 0.0f;
	/** Seconds until the route is allowed to change its mind again. */
	float ReconsiderIn = 0.0f;

	float Elapsed = 0.0f;
	float Breath = 0.0f;
	float ClosestThisFrame = 0.0f;
	float BodyLengthThisFrame = 0.0f;

	/** Bearing samples, for the not-an-orbit proof. */
	TArray<float> BearingRates;
	int32 BearingWrite = 0;
	float LastBearingDeg = 0.0f;
};
