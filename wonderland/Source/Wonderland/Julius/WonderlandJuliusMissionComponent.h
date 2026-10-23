// WONDERLAND -- thin UMG-facing handle on the J1 subsystem.
//
// StartMission is the player action. The label, the state token, and the
// artifact label are the strings the pure session already chose. This
// component does not classify, mint, or talk to HTTP itself.

#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "WonderlandJuliusMissionComponent.generated.h"

UCLASS(ClassGroup = (Wonderland), meta = (BlueprintSpawnableComponent))
class UWonderlandJuliusMissionComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UWonderlandJuliusMissionComponent();

	/** PairId is the optional non-secret correlation id. Empty is fine. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Julius")
	bool StartMission(const FString& MissionId, const FString& PairId);

	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	FString GetPlayerLabel() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	FString GetUiStateToken() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	FString GetArtifactLabel() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	FString GetServerRunId() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	bool HasServerRunId() const;

private:
	class UWonderlandJuliusMissionSubsystem* Resolve() const;
};
