// wl.Qa.FollowRemote. Developer sessions only. Logs WLFOLLOW. Never moves the observer pawn.
#include "CoreMinimal.h"
#include "Camera/CameraActor.h"
#include "Containers/Ticker.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "WonderlandBeta.h"
#include "WonderlandCompanionEmbodiment.h"
#include "WonderlandFollowMath.h"

#include <string>
#include <vector>

#if !UE_BUILD_SHIPPING

namespace WonderlandFollowQa
{
	struct FFollow
	{
		TWeakObjectPtr<UWorld> World;
		TWeakObjectPtr<ACameraActor> Camera;
		TWeakObjectPtr<AWonderlandCompanionEmbodiment> Body;
		FTSTicker::FDelegateHandle Handle;
		WonderlandFollow::EFollowAsk Ask = WonderlandFollow::EFollowAsk::Invalid;
		std::string Want;
		FString LastId;
		bool bTicker = false;
		bool bActive = false;
		bool bHadBody = false;
		bool bViewSet = false;
		bool bLoggedWait = false;
	};

	FFollow GFollow;

	void LogState(const char* State, const FString& UserId)
	{
		const std::string Line = WonderlandFollow::FollowLogLine(State, TCHAR_TO_UTF8(*UserId));
		UE_LOG(LogTemp, Display, TEXT("%s"), *FString(UTF8_TO_TCHAR(Line.c_str())));
	}

	void ReleaseView(const char* State)
	{
		UWorld* World = GFollow.World.Get();
		APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		APawn* Pawn = PC != nullptr ? PC->GetPawn() : nullptr;
		if (Pawn != nullptr)
		{
			const FVector Loc = Pawn->GetActorLocation();
			const FRotator Rot = Pawn->GetActorRotation();
			PC->SetViewTargetWithBlend(Pawn, 0.0f);
			check(Pawn->GetActorLocation().Equals(Loc, 0.0));
			check(Pawn->GetActorRotation().Equals(Rot, 0.0f));
		}
		if (ACameraActor* Cam = GFollow.Camera.Get())
		{
			Cam->Destroy();
		}
		LogState(State, GFollow.LastId);
		GFollow.Camera.Reset();
		GFollow.Body.Reset();
		GFollow.bHadBody = false;
		GFollow.bViewSet = false;
		GFollow.bLoggedWait = false;
		GFollow.bActive = false;
		GFollow.LastId.Reset();
	}

	AWonderlandCompanionEmbodiment* FindBody(UWorld* World)
	{
		std::vector<AWonderlandCompanionEmbodiment*> Found;
		std::vector<std::string> Displays;
		std::vector<std::string> Logs;
		for (TActorIterator<AWonderlandCompanionEmbodiment> It(World); It; ++It)
		{
			if (It->ClassLabel != TEXT("WONDERLAND PLAYER"))
			{
				continue;
			}
			Found.push_back(*It);
			Displays.emplace_back(TCHAR_TO_UTF8(*It->DisplayName));
			Logs.emplace_back(TCHAR_TO_UTF8(*It->LogName));
		}
		std::vector<WonderlandFollow::FBodyId> Ids(Found.size());
		for (std::size_t Index = 0; Index < Found.size(); ++Index)
		{
			Ids[Index].Display = Displays[Index].c_str();
			Ids[Index].LogName = Logs[Index].c_str();
		}
		const int Picked = WonderlandFollow::PickBody(Ids.data(), static_cast<int>(Ids.size()), GFollow.Ask, GFollow.Want.c_str());
		return Picked >= 0 ? Found[static_cast<std::size_t>(Picked)] : nullptr;
	}

	void PlaceCamera(UWorld* World, AWonderlandCompanionEmbodiment* Body)
	{
		APlayerController* PC = World->GetFirstPlayerController();
		APawn* Pawn = PC != nullptr ? PC->GetPawn() : nullptr;
		const FVector PawnLoc = Pawn != nullptr ? Pawn->GetActorLocation() : FVector::ZeroVector;
		const FRotator PawnRot = Pawn != nullptr ? Pawn->GetActorRotation() : FRotator::ZeroRotator;
		const FVector At = Body->GetActorLocation();
		const WonderlandFollow::FPoint Where = WonderlandFollow::CameraLocation(At.X, At.Y, At.Z, Body->GetActorRotation().Yaw);
		const FVector CamAt(Where.X, Where.Y, Where.Z);
		ACameraActor* Cam = GFollow.Camera.Get();
		if (Cam == nullptr)
		{
			FActorSpawnParameters Params;
			Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			Cam = World->SpawnActor<ACameraActor>(CamAt, FRotator::ZeroRotator, Params);
			GFollow.Camera = Cam;
			GFollow.bViewSet = false;
		}
		if (Cam == nullptr)
		{
			return;
		}
		Cam->SetActorLocationAndRotation(CamAt, (At - CamAt).Rotation());
		if (PC != nullptr && !GFollow.bViewSet)
		{
			PC->SetViewTargetWithBlend(Cam, 0.0f);
			GFollow.bViewSet = true;
		}
		if (Pawn != nullptr)
		{
			check(Pawn->GetActorLocation().Equals(PawnLoc, 0.0));
			check(Pawn->GetActorRotation().Equals(PawnRot, 0.0f));
		}
	}

	bool TickFollow(float)
	{
		if (!GFollow.bActive)
		{
			GFollow.bTicker = false;
			return false;
		}
		UWorld* World = GFollow.World.Get();
		if (World == nullptr)
		{
			GFollow.bTicker = false;
			return false;
		}
		AWonderlandCompanionEmbodiment* Body = GFollow.Body.Get();
		if (Body == nullptr)
		{
			if (GFollow.bHadBody)
			{
				ReleaseView("lost");
				GFollow.bTicker = false;
				return false;
			}
			Body = FindBody(World);
			if (Body == nullptr)
			{
				if (!GFollow.bLoggedWait)
				{
					LogState("waiting", FString());
					GFollow.bLoggedWait = true;
				}
				return true;
			}
			GFollow.Body = Body;
			GFollow.bHadBody = true;
			GFollow.LastId = Body->LogName;
			LogState("following", GFollow.LastId);
		}
		PlaceCamera(World, Body);
		return true;
	}

	FAutoConsoleCommandWithWorldAndArgs GQaFollowRemote(
		TEXT("wl.Qa.FollowRemote"),
		TEXT("Developer session only. Camera-follow a remote player: first, a display name, a user id, or off. Not in shipping builds."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (!WonderlandBeta::IsDeveloperSession())
			{
				LogState("refused", FString());
				return;
			}
			const std::string Arg = Args.Num() > 0 ? std::string(TCHAR_TO_UTF8(*Args[0])) : std::string();
			const WonderlandFollow::EFollowAsk Ask = WonderlandFollow::ClassifyFollowAsk(Arg.c_str());
			if (Ask == WonderlandFollow::EFollowAsk::Off)
			{
				ReleaseView("off");
				if (GFollow.bTicker)
				{
					FTSTicker::GetCoreTicker().RemoveTicker(GFollow.Handle);
					GFollow.bTicker = false;
				}
				return;
			}
			if (Ask != WonderlandFollow::EFollowAsk::First && Ask != WonderlandFollow::EFollowAsk::Named)
			{
				LogState("usage", FString());
				return;
			}
			GFollow.World = World;
			GFollow.Ask = Ask;
			GFollow.Want = Arg;
			GFollow.Body.Reset();
			GFollow.bHadBody = false;
			GFollow.bLoggedWait = false;
			GFollow.bActive = true;
			if (!GFollow.bTicker)
			{
				GFollow.Handle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&TickFollow), 0.0f);
				GFollow.bTicker = true;
			}
		}));
}

#endif
