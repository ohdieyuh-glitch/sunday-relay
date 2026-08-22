// Tune the Marble backdrop's brightness from a console command, not a rebuild.
//
// WHY THIS EXISTS
//
// transform.unlit_gain is applied at IMPORT, so every candidate value costs a
// full rebuild: twelve minutes to move one number. The value is not known — the
// backdrop is unlit and its texture is an already-exposed photograph, while the
// authored world is lit far above that scale, and the shell is a large enough
// part of the frame to feed back into auto-exposure. That is an unknown to
// search for, and a twelve-minute step is the wrong loop to search it in.
//
// With this, a candidate costs one launch:
//
//     WL_EXEC_CMDS="wonderland.MarbleGain 40" bash .../capture-hero-shots.sh
//
// It reports what it actually achieved, by READBACK. The editor-side setter for
// this same parameter returns false while succeeding, which cost a build to
// discover; nothing here trusts a return value where it can read the result.
//
// This tunes only. The value that ships is still transform.unlit_gain in the
// world manifest, applied at import, so a packaged build never depends on
// somebody having typed a console command.
#include "CoreMinimal.h"

#include "Components/PrimitiveComponent.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Actor.h"
#include "HAL/IConsoleManager.h"
#include "Materials/MaterialInstanceDynamic.h"

#include "WonderlandWorldProof.h"

namespace
{
	const TCHAR* const MarbleVisualTag = TEXT("MarbleVisualLayer");
	const TCHAR* const BaseColorFactor = TEXT("BaseColorFactor");

	void ApplyMarbleGain(const TArray<FString>& Args, UWorld* World)
	{
		if (World == nullptr)
		{
			UE_LOG(LogWonderlandProof, Warning,
				   TEXT("MARBLE_RUNTIME_GAIN_FAILED=no-world"));
			return;
		}
		const float Gain = (Args.Num() > 0) ? FCString::Atof(*Args[0]) : 1.0f;

		int32 Actors = 0;
		int32 Confirmed = 0;
		int32 Attempted = 0;
		for (TActorIterator<AActor> It(World); It; ++It)
		{
			AActor* Actor = *It;
			if (Actor == nullptr || !Actor->ActorHasTag(FName(MarbleVisualTag)))
			{
				continue;
			}
			++Actors;
			TArray<UPrimitiveComponent*> Components;
			Actor->GetComponents<UPrimitiveComponent>(Components);
			for (UPrimitiveComponent* Component : Components)
			{
				if (Component == nullptr)
				{
					continue;
				}
				const int32 NumMaterials = Component->GetNumMaterials();
				for (int32 Index = 0; Index < NumMaterials; ++Index)
				{
					++Attempted;
					UMaterialInstanceDynamic* Dynamic =
						Component->CreateAndSetMaterialInstanceDynamic(Index);
					if (Dynamic == nullptr)
					{
						continue;
					}
					Dynamic->SetVectorParameterValue(
						FName(BaseColorFactor), FLinearColor(Gain, Gain, Gain, 1.0f));
					// READ IT BACK. A parameter the master does not expose is set
					// without complaint and changes nothing, which looks exactly
					// like a working tune until someone reads the frame.
					const FLinearColor Back =
						Dynamic->K2_GetVectorParameterValue(FName(BaseColorFactor));
					if (FMath::IsNearlyEqual(Back.R, Gain, 0.001f))
					{
						++Confirmed;
					}
				}
			}
		}

		UE_LOG(LogWonderlandProof, Warning,
			   TEXT("MARBLE_RUNTIME_GAIN=%.4g ACTORS=%d MATERIALS=%d CONFIRMED=%d"),
			   Gain, Actors, Attempted, Confirmed);
		if (Actors == 0)
		{
			UE_LOG(LogWonderlandProof, Warning,
				   TEXT("MARBLE_RUNTIME_GAIN_FAILED=no actor tagged \"%s\" in this "
						"world. Read the frame as unchanged brightness."),
				   MarbleVisualTag);
		}
		else if (Confirmed == 0)
		{
			UE_LOG(LogWonderlandProof, Warning,
				   TEXT("MARBLE_RUNTIME_GAIN_FAILED=%s did not read back on any "
						"material. The gain did NOT take; the frame shows the "
						"brightness the exporter gave it."),
				   BaseColorFactor);
		}
	}

	FAutoConsoleCommandWithWorldAndArgs GMarbleGainCommand(
		TEXT("wonderland.MarbleGain"),
		TEXT("Multiply the Marble backdrop's unlit BaseColorFactor. One argument: "
			 "the gain. Reports what it achieved by readback. Tuning only — the "
			 "shipped value is transform.unlit_gain in the world manifest."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateStatic(&ApplyMarbleGain));
}
