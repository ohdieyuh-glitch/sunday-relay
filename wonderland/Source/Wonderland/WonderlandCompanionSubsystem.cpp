#include "WonderlandCompanionSubsystem.h"

#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Misc/Paths.h"
#include "UObject/UObjectIterator.h"
#include "WonderlandCompanionEmbodiment.h"
#include "WonderlandSidekicks.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandCompanionPreview, Log, All);

namespace
{
	TAutoConsoleVariable<FString> CVarFigureDir(
		TEXT("wl.Companion.FigureDir"), TEXT(""),
		TEXT("Directory to read companion figure files from, overriding the Companion Preview setting. Empty uses the setting."));

	FAutoConsoleCommand CmdReloadFigures(
		TEXT("wl.Companion.Reload"),
		TEXT("Re-read the companion figure files and rebuild every companion embodiment in place."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			for (TObjectIterator<UWonderlandCompanionSubsystem> It; It; ++It)
			{
				if (!It->HasAnyFlags(RF_ClassDefaultObject | RF_ArchetypeObject))
				{
					It->ReloadFigures();
				}
			}
		}));
}

bool UWonderlandCompanionSubsystem::IsPreviewEnabled()
{
#if UE_BUILD_SHIPPING
	return false;
#else
	const UWonderlandCompanionPreviewSettings* Settings = GetDefault<UWonderlandCompanionPreviewSettings>();
	return Settings != nullptr && Settings->bShowCompanionPreview;
#endif
}

FString UWonderlandCompanionSubsystem::ResolveFigurePath(const FString& FileName)
{
	if (!FPaths::IsRelative(FileName))
	{
		return FileName;
	}
	FString Directory = CVarFigureDir.GetValueOnGameThread();
	if (Directory.IsEmpty())
	{
		const UWonderlandCompanionPreviewSettings* Settings = GetDefault<UWonderlandCompanionPreviewSettings>();
		Directory = Settings != nullptr ? Settings->FigureDirectory : FString(TEXT("Companions"));
	}
	if (FPaths::IsRelative(Directory))
	{
		Directory = FPaths::Combine(FPaths::ProjectDir(), Directory);
	}
	return FPaths::ConvertRelativePathToFull(FPaths::Combine(Directory, FileName));
}

void UWonderlandCompanionSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	if (ULocalPlayer* LocalPlayer = GetLocalPlayer<ULocalPlayer>())
	{
		ControllerChangedHandle = LocalPlayer->OnPlayerControllerChanged().AddUObject(this, &UWonderlandCompanionSubsystem::HandlePlayerControllerChanged);
		if (LocalPlayer->PlayerController != nullptr)
		{
			HandlePlayerControllerChanged(LocalPlayer->PlayerController);
		}
	}
}

void UWonderlandCompanionSubsystem::Deinitialize()
{
	Despawn();
	BoundController.Reset();
	if (ULocalPlayer* LocalPlayer = GetLocalPlayer<ULocalPlayer>())
	{
		LocalPlayer->OnPlayerControllerChanged().Remove(ControllerChangedHandle);
	}
	Super::Deinitialize();
}

void UWonderlandCompanionSubsystem::HandlePlayerControllerChanged(APlayerController* NewController)
{
	if (NewController == BoundController.Get())
	{
		return;
	}
	Despawn();
	BoundController.Reset();
	if (NewController == nullptr || NewController->GetWorld() == nullptr || !NewController->GetWorld()->IsGameWorld())
	{
		return;
	}
	if (!IsPreviewEnabled())
	{
		UE_LOG(LogWonderlandCompanionPreview, Log, TEXT("WLCOMPANION preview off (Wonderland Companion Preview setting); no embodiments spawned"));
		return;
	}
	BoundController = NewController;
	Spawn(NewController);
}

void UWonderlandCompanionSubsystem::Spawn(APlayerController* Controller)
{
	UWorld* World = Controller->GetWorld();
	const UWonderlandCompanionPreviewSettings* Settings = GetDefault<UWonderlandCompanionPreviewSettings>();
	if (World == nullptr || Settings == nullptr)
	{
		return;
	}

	struct FSpec
	{
		FString Name;
		const TCHAR* Label;
		FString Figure;
		FVector Offset;
	};
	// THE ORDER IS THE CONTRACT the tests and the terminals read: 0 is the LLM Companion, on the Dog's left;
	// 1 is the Jhinn AI Agent, on its right.
	const FSpec Specs[] = {
		{Settings->LlmCompanionName, TEXT("LLM COMPANION"), Settings->LlmCompanionFigure, Settings->LlmCompanionOffset},
		{Settings->AgentName, TEXT("JHINN AI AGENT"), Settings->AgentFigure, Settings->AgentOffset},
	};

	const APawn* Pawn = Controller->GetPawn();
	const FTransform SpawnAt = Pawn != nullptr ? Pawn->GetActorTransform() : FTransform::Identity;
	for (const FSpec& Spec : Specs)
	{
		FActorSpawnParameters Params;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		Params.ObjectFlags |= RF_Transient;
		AWonderlandCompanionEmbodiment* Body = World->SpawnActor<AWonderlandCompanionEmbodiment>(
			AWonderlandCompanionEmbodiment::StaticClass(), SpawnAt, Params);
		if (Body == nullptr)
		{
			UE_LOG(LogWonderlandCompanionPreview, Error, TEXT("WLCOMPANION could not spawn %s"), *Spec.Name);
			continue;
		}
		Body->DisplayName = Spec.Name;
		Body->ClassLabel = Spec.Label;
		Body->FollowOffset = Spec.Offset;
#if WITH_EDITOR
		Body->SetActorLabel(FString::Printf(TEXT("WL_Companion_%s"), *Spec.Name.Replace(TEXT(" "), TEXT(""))), false);
#endif
		Body->SetFollowController(Controller);
		// A refused figure leaves an empty body standing and says why (GetLastError); the other companion
		// still builds. Neither failure hides the other.
		Body->LoadFigure(ResolveFigurePath(Spec.Figure));
		Embodiments.Add(Body);
	}
	UE_LOG(LogWonderlandCompanionPreview, Log, TEXT("WLCOMPANION preview: %d embodiments beside %s"), Embodiments.Num(), *Controller->GetName());

	// WHAT EACH BODY IS DOING COMES FROM THE RUNTIME, and changes when the runtime changes.
	if (UGameInstance* Instance = Controller->GetGameInstance())
	{
		if (UWonderlandSidekickSubsystem* Runtime = Instance->GetSubsystem<UWonderlandSidekickSubsystem>())
		{
			SidekicksChangedHandle = Runtime->OnChanged.AddUObject(this, &UWonderlandCompanionSubsystem::PushRuntimeActivity);
			PushRuntimeActivity();
		}
	}
}

void UWonderlandCompanionSubsystem::PushRuntimeActivity()
{
	const APlayerController* Controller = BoundController.Get();
	UGameInstance* Instance = Controller != nullptr ? Controller->GetGameInstance() : nullptr;
	const UWonderlandSidekickSubsystem* Runtime = Instance != nullptr ? Instance->GetSubsystem<UWonderlandSidekickSubsystem>() : nullptr;
	if (Runtime == nullptr)
	{
		return;
	}
	for (int32 Index = 0; Index < Embodiments.Num(); ++Index)
	{
		AWonderlandCompanionEmbodiment* Body = Embodiments[Index].Get();
		const FWonderlandSidekick* Sidekick = Runtime->ByIndex(Index);
		if (Body == nullptr)
		{
			continue;
		}
		// NOTHING BEHIND IT IS NOT A MOOD. With no runtime, or no companion of that index, the body is DISCONNECTED and
		// nearly still -- it does not keep drifting as though something were thinking.
		const FString Activity = Sidekick == nullptr || Runtime->GetLink() != EWonderlandSidekickLink::Online
			? FString(TEXT("DISCONNECTED"))
			: Runtime->MascotStateOf(Sidekick->SidekickId);
		Body->SetRuntimeActivity(FName(*Activity));
	}
}

void UWonderlandCompanionSubsystem::Despawn()
{
	if (SidekicksChangedHandle.IsValid())
	{
		const APlayerController* Controller = BoundController.Get();
		UGameInstance* Instance = Controller != nullptr ? Controller->GetGameInstance() : nullptr;
		if (UWonderlandSidekickSubsystem* Runtime = Instance != nullptr ? Instance->GetSubsystem<UWonderlandSidekickSubsystem>() : nullptr)
		{
			Runtime->OnChanged.Remove(SidekicksChangedHandle);
		}
		SidekicksChangedHandle.Reset();
	}
	for (const TWeakObjectPtr<AWonderlandCompanionEmbodiment>& Weak : Embodiments)
	{
		if (AWonderlandCompanionEmbodiment* Body = Weak.Get())
		{
			Body->Destroy();
		}
	}
	Embodiments.Reset();
}

int32 UWonderlandCompanionSubsystem::GetEmbodimentCount() const
{
	int32 Count = 0;
	for (const TWeakObjectPtr<AWonderlandCompanionEmbodiment>& Weak : Embodiments)
	{
		Count += Weak.IsValid() ? 1 : 0;
	}
	return Count;
}

AWonderlandCompanionEmbodiment* UWonderlandCompanionSubsystem::GetEmbodiment(int32 Index) const
{
	return Embodiments.IsValidIndex(Index) ? Embodiments[Index].Get() : nullptr;
}

int32 UWonderlandCompanionSubsystem::ReloadFigures()
{
	const UWonderlandCompanionPreviewSettings* Settings = GetDefault<UWonderlandCompanionPreviewSettings>();
	int32 Rebuilt = 0;
	for (int32 Index = 0; Index < Embodiments.Num(); ++Index)
	{
		AWonderlandCompanionEmbodiment* Body = Embodiments[Index].Get();
		if (Body == nullptr || Settings == nullptr)
		{
			continue;
		}
		// Resolved again rather than reusing the old path, so a changed `wl.Companion.FigureDir` takes effect.
		const FString& File = Index == 0 ? Settings->LlmCompanionFigure : Settings->AgentFigure;
		Rebuilt += Body->LoadFigure(ResolveFigurePath(File)) ? 1 : 0;
	}
	UE_LOG(LogWonderlandCompanionPreview, Log, TEXT("WLCOMPANION reload: %d of %d rebuilt"), Rebuilt, Embodiments.Num());
	return Rebuilt;
}
