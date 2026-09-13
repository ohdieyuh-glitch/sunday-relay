// A GENTLE HOVER FOR THE FEW THINGS THAT FLOAT.
//
// The founder's Phase V: a reusable, bounded, asynchronous, low-cost hover for
// keys, teapots and selected magical props — and NOTHING else. Not the
// architecture, not the ground, not the mushrooms, not the trees. The world had
// a synchronised heartbeat once (22,794 instances on one shared sine) and the
// founder named it as the thing to stop; this component is the opposite design:
//
//   BOUNDED     it moves an actor between BaseLocation - Amplitude and
//               BaseLocation + Amplitude and can never drift, because every tick
//               sets an absolute position from the stored base rather than
//               accumulating an offset;
//   ASYNCHRONOUS the phase is hashed from the base location, so two keys a metre
//               apart are at different points of their cycle with no shared
//               clock and no per-instance bookkeeping;
//   LOW-COST    one sine and one cosine per prop per frame. A dozen props is
//               nothing; a thousand would be a design mistake, which is why it
//               is a component you attach and not a material every mesh wears.
//
// It attaches to any actor. The generator attaches it to the sky keys and the
// teapot through AWonderlandHoverProp, which exists only so Python can spawn
// one class and set four properties, the same way it drives the batch actor.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "WonderlandHoverComponent.generated.h"

UCLASS(ClassGroup = (Wonderland), meta = (BlueprintSpawnableComponent))
class UWonderlandHoverComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UWonderlandHoverComponent();

	/** Vertical travel either side of the rest position, in uu. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Hover")
	float AmplitudeUu = 9.0f;

	/** Seconds for one full rise-and-fall. Slow on purpose. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Hover")
	float PeriodSeconds = 6.5f;

	/** Degrees of slow yaw sway either side of the rest yaw. 0 disables. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Hover")
	float SwayDeg = 2.5f;

	/**
	 * Phase in cycles (0..1). Negative means "derive from the base location",
	 * which is the default and the reason no two props agree.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Hover")
	float Phase = -1.0f;

	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType,
							   FActorComponentTickFunction* ThisTickFunction) override;

private:
	FVector BaseLocation = FVector::ZeroVector;
	FRotator BaseRotation = FRotator::ZeroRotator;
	float ResolvedPhase = 0.0f;
};
