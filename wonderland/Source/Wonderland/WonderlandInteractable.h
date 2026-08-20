/**
 * WONDERLAND INTERACTABLE — a place in the world where the player may RAISE AN
 * INTENT.
 *
 * Reconstructed from its call site rather than invented. WonderlandDogPawp's
 * OnInteract() has always used this class — StaticClass(), Cast<>(),
 * ProximityRadiusUu, IntentType, Locus and TryInteractWithinRange() — and the
 * header was simply never committed alongside it. Every member below exists
 * because the existing code requires it, and nothing else has been added.
 *
 * WHAT THIS IS NOT. It is not a thing that DOES anything. The pawn's own
 * comment states the rule and this class obeys it: "a REQUEST only — Relay
 * decides; the pawn never acts." An interactable carries the metadata Relay
 * needs to identify what was asked for and where, hands it to the Relay Link,
 * and reports whether the request was actually SENT. It never mutates Relay
 * state, never assumes an outcome, and never reports success it did not
 * observe.
 *
 * PRESENTATION ONLY, in the same sense as the rest of this module: Relay is
 * authoritative, Wonderland is a read-only consumer that may ask.
 */
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "WonderlandInteractable.generated.h"

UCLASS(Blueprintable)
class AWonderlandInteractable : public AActor
{
	GENERATED_BODY()

public:
	AWonderlandInteractable();

	/**
	 * How close the player must be, in unreal units, measured in 2D.
	 *
	 * 2D on purpose, and the call site already measures it that way with
	 * FVector::Dist2D: a Dog standing on the plaza beside an arch should reach
	 * it, and a Dog on a balcony directly above should not be counted as
	 * "there" merely because the horizontal distance is zero.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Interaction")
	float ProximityRadiusUu = 300.0f;

	/**
	 * What Relay would be asked to do. An opaque identifier as far as this
	 * module is concerned — Wonderland does not interpret it, validate it, or
	 * act on it. Relay owns its meaning.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Interaction")
	FString IntentType;

	/**
	 * WHERE the intent was raised, in Relay's own vocabulary — the landmark or
	 * zone this actor stands for. Carried so a request is attributable to a
	 * place rather than to a coordinate nobody can interpret later.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Interaction")
	FString Locus;

	/**
	 * Raise this interactable's intent, if the caller really is within range.
	 *
	 * RETURNS WHETHER THE REQUEST WAS SENT, and nothing more. Not whether Relay
	 * accepted it, not whether it will succeed — those are Relay's to decide
	 * and are learned later through world state, if at all. A false return
	 * means nothing left this machine.
	 *
	 * The range check is repeated here even though OnInteract() has already
	 * done it. The two callers are not the same authority: the pawn is choosing
	 * which anchors to offer, and this is the anchor deciding whether it was
	 * genuinely reached. A future caller that forgets the check does not get to
	 * raise intents from across the world.
	 */
	bool TryInteractWithinRange(const FVector& FromLocation);
};
