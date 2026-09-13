#include "WonderlandTravel.h"

#include "Camera/PlayerCameraManager.h"
#include "CollisionQueryParams.h"
#include "Components/ArrowComponent.h"
#include "Components/CapsuleComponent.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Character.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "WorldPartition/WorldPartitionSubsystem.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandTravel, Log, All);

/* ------------------------------------------------------------- registry */

const FWonderlandTravelDestination* UWonderlandTravelSettings::FindDestination(FName Id) const
{
	return Destinations.FindByPredicate([Id](const FWonderlandTravelDestination& Row) { return Row.Id == Id; });
}

static bool IsOfferedStatus(EWonderlandTravelStatus Status)
{
	return Status == EWonderlandTravelStatus::Developed || Status == EWonderlandTravelStatus::Available;
}

/* --------------------------------------------------------------- anchor */

AWonderlandTravelAnchor::AWonderlandTravelAnchor()
{
	PrimaryActorTick.bCanEverTick = false;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));

	// The capsule is a picture of the visitor, not a body: it must never block,
	// be walked on, or show in a game frame.
	CapsulePreview = CreateDefaultSubobject<UCapsuleComponent>(TEXT("CapsulePreview"));
	CapsulePreview->SetupAttachment(RootComponent);
	CapsulePreview->InitCapsuleSize(42.0f, 96.0f);
	CapsulePreview->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	CapsulePreview->SetHiddenInGame(true);
	CapsulePreview->ShapeColor = FColor(217, 164, 65);
	CapsulePreview->SetRelativeLocation(FVector(0.0, 0.0, 96.0));

	Facing = CreateDefaultSubobject<UArrowComponent>(TEXT("Facing"));
	Facing->SetupAttachment(RootComponent);
	Facing->SetHiddenInGame(true);
	Facing->ArrowColor = FColor(217, 164, 65);
	Facing->SetRelativeLocation(FVector(0.0, 0.0, 96.0));
}

/* ------------------------------------------------------------ subsystem */

bool UWonderlandTravelSubsystem::ShouldCreateSubsystem(UObject* Outer) const
{
	if (!Super::ShouldCreateSubsystem(Outer))
	{
		return false;
	}
	const UWorld* World = Cast<UWorld>(Outer);
	return World != nullptr && (World->WorldType == EWorldType::Game || World->WorldType == EWorldType::PIE);
}

void UWonderlandTravelSubsystem::Deinitialize()
{
	SetStreamingRegistered(false);
	RestoreInput();
	Super::Deinitialize();
}

bool UWonderlandTravelSubsystem::IsTickable() const
{
	return Phase != EPhase::Idle;
}

TStatId UWonderlandTravelSubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UWonderlandTravelSubsystem, STATGROUP_Tickables);
}

APlayerController* UWonderlandTravelSubsystem::LocalController() const
{
	const UWorld* World = GetWorld();
	return World != nullptr ? World->GetFirstPlayerController() : nullptr;
}

AWonderlandTravelAnchor* UWonderlandTravelSubsystem::FindAnchor(FName DestinationId) const
{
	UWorld* World = GetWorld();
	if (World == nullptr || DestinationId.IsNone())
	{
		return nullptr;
	}
	for (TActorIterator<AWonderlandTravelAnchor> It(World); It; ++It)
	{
		if (It->DestinationId == DestinationId)
		{
			return *It;
		}
	}
	return nullptr;
}

TArray<FWonderlandTravelDestination> UWonderlandTravelSubsystem::GetOfferedDestinations() const
{
	TArray<FWonderlandTravelDestination> Offered;
	const UWorld* World = GetWorld();
	if (World == nullptr)
	{
		return Offered;
	}
	// PIE worlds live in a UEDPIE_N_ package; the registry names the real map.
	const FString MapPackage = UWorld::RemovePIEPrefix(World->GetOutermost()->GetName());
	for (const FWonderlandTravelDestination& Row : GetDefault<UWonderlandTravelSettings>()->Destinations)
	{
		if (!IsOfferedStatus(Row.Status))
		{
			continue;
		}
		if (!Row.MapPackage.IsEmpty() && Row.MapPackage != MapPackage)
		{
			continue;
		}
		// No anchor, no offer: a place nobody has stood a visitor in is not a destination yet.
		if (FindAnchor(Row.Id) == nullptr)
		{
			continue;
		}
		Offered.Add(Row);
	}
	return Offered;
}

FName UWonderlandTravelSubsystem::GetNearestOfferedDestination(double MaxDistanceUU) const
{
	const APlayerController* PC = LocalController();
	const APawn* Pawn = PC != nullptr ? PC->GetPawn() : nullptr;
	if (Pawn == nullptr)
	{
		return NAME_None;
	}
	FName Best = NAME_None;
	double BestDistance = MaxDistanceUU;
	for (const FWonderlandTravelDestination& Row : GetOfferedDestinations())
	{
		if (const AWonderlandTravelAnchor* Anchor = FindAnchor(Row.Id))
		{
			const double Distance = FVector::Dist2D(Anchor->GetActorLocation(), Pawn->GetActorLocation());
			if (Distance <= BestDistance)
			{
				BestDistance = Distance;
				Best = Row.Id;
			}
		}
	}
	return Best;
}

bool UWonderlandTravelSubsystem::RequestTravel(FName DestinationId, FText& OutRefusal)
{
	if (Phase != EPhase::Idle)
	{
		OutRefusal = INVTEXT("Already travelling.");
		return false;
	}
	const UWonderlandTravelSettings* Settings = GetDefault<UWonderlandTravelSettings>();
	const FWonderlandTravelDestination* Destination = Settings->FindDestination(DestinationId);
	if (Destination == nullptr)
	{
		OutRefusal = FText::Format(INVTEXT("'{0}' is not a Wonderland destination."), FText::FromName(DestinationId));
		return false;
	}
	if (!IsOfferedStatus(Destination->Status))
	{
		OutRefusal = FText::Format(INVTEXT("{0} is not ready to visit yet."), Destination->DisplayName);
		return false;
	}
	const AWonderlandTravelAnchor* Anchor = FindAnchor(DestinationId);
	if (Anchor == nullptr)
	{
		OutRefusal = FText::Format(INVTEXT("{0} has no arrival point placed in this world."), Destination->DisplayName);
		return false;
	}
	APlayerController* PC = LocalController();
	APawn* Pawn = PC != nullptr ? PC->GetPawn() : nullptr;
	if (Pawn == nullptr)
	{
		OutRefusal = INVTEXT("There is no one to move.");
		return false;
	}

	Controller = PC;
	TravelId = DestinationId;
	AnchorTransform = Anchor->GetActorTransform();
	OriginTransform = Pawn->GetActorTransform();
	bPlaced = false;
	bArrivedResult = false;
	GroundFrames = 0;
	PhaseSeconds = 0.0f;
	Phase = EPhase::FadingOut;

	if (PC->PlayerCameraManager != nullptr)
	{
		PC->PlayerCameraManager->StartCameraFade(0.0f, 1.0f, Settings->FadeOutSeconds, FLinearColor::Black, false, true);
	}
	if (!bInputIgnored)
	{
		PC->SetIgnoreMoveInput(true);
		PC->SetIgnoreLookInput(true);
		bInputIgnored = true;
	}
	LastReport = FString::Printf(TEXT("Travelling to %s."), *Destination->DisplayName.ToString());
	UE_LOG(LogWonderlandTravel, Log, TEXT("WLTRAVEL start '%s' from (%.0f, %.0f, %.0f)"),
		*DestinationId.ToString(), OriginTransform.GetLocation().X, OriginTransform.GetLocation().Y, OriginTransform.GetLocation().Z);
	return true;
}

void UWonderlandTravelSubsystem::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	const UWonderlandTravelSettings* Settings = GetDefault<UWonderlandTravelSettings>();
	PhaseSeconds += DeltaTime;

	APlayerController* PC = Controller.Get();
	APawn* Pawn = PC != nullptr ? PC->GetPawn() : nullptr;
	if (Pawn == nullptr)
	{
		SetStreamingRegistered(false);
		RestoreInput();
		Phase = EPhase::Idle;
		LastReport = TEXT("Travel stopped: the player left before arriving.");
		OnTravelFinished.Broadcast(TravelId, false);
		return;
	}

	switch (Phase)
	{
	case EPhase::FadingOut:
		// The pawn has not moved yet. Only once the screen is fully black does anything change.
		if (PhaseSeconds >= Settings->FadeOutSeconds)
		{
			Phase = EPhase::Loading;
			PhaseSeconds = 0.0f;
			SetStreamingRegistered(true);
		}
		break;

	case EPhase::Loading:
	{
		const UWorld* World = GetWorld();
		const UWorldPartitionSubsystem* Streaming = World != nullptr ? World->GetSubsystem<UWorldPartitionSubsystem>() : nullptr;
		// A classic map has everything loaded; a World Partition map must finish streaming the destination first.
		const bool bStreamed = !bStreamingRegistered || (Streaming != nullptr && Streaming->IsStreamingCompleted(this));

		if (bStreamed && !bPlaced)
		{
			FVector Spot;
			if (FindSafeSpot(Pawn, AnchorTransform, Spot))
			{
				const FRotator Facing(0.0, AnchorTransform.Rotator().Yaw, 0.0);
				Pawn->TeleportTo(Spot, Facing, false, false);
				if (ACharacter* Character = Cast<ACharacter>(Pawn))
				{
					Character->GetCharacterMovement()->StopMovementImmediately();
				}
				PC->SetControlRotation(FRotator(-6.0, Facing.Yaw, 0.0));
				bPlaced = true;
				GroundFrames = 0;
			}
		}
		if (bPlaced)
		{
			GroundFrames = GroundUnder(Pawn) ? GroundFrames + 1 : 0;
			if (GroundFrames >= Settings->GroundFramesRequired)
			{
				const FWonderlandTravelDestination* Destination = Settings->FindDestination(TravelId);
				BeginFadeIn(true, FString::Printf(TEXT("Arrived at %s."),
					Destination != nullptr ? *Destination->DisplayName.ToString() : *TravelId.ToString()));
				break;
			}
		}
		if (PhaseSeconds >= Settings->MaxBlackSeconds)
		{
			// Never leave a visitor somewhere that did not prove safe: put them back.
			if (bPlaced)
			{
				Pawn->TeleportTo(OriginTransform.GetLocation(), OriginTransform.Rotator(), false, true);
			}
			BeginFadeIn(false, FString::Printf(TEXT("Could not land safely at %s; returned to where you were."), *TravelId.ToString()));
		}
		break;
	}

	case EPhase::FadingIn:
		if (PhaseSeconds >= Settings->FadeInSeconds)
		{
			RestoreInput();
			Phase = EPhase::Idle;
			UE_LOG(LogWonderlandTravel, Log, TEXT("WLTRAVEL done '%s' arrived=%d at (%.0f, %.0f, %.0f): %s"),
				*TravelId.ToString(), bArrivedResult ? 1 : 0,
				Pawn->GetActorLocation().X, Pawn->GetActorLocation().Y, Pawn->GetActorLocation().Z, *LastReport);
			OnTravelFinished.Broadcast(TravelId, bArrivedResult);
		}
		break;

	default:
		break;
	}
}

bool UWonderlandTravelSubsystem::FindSafeSpot(APawn* Pawn, const FTransform& Anchor, FVector& OutLocation) const
{
	UWorld* World = GetWorld();
	if (World == nullptr)
	{
		return false;
	}
	float Radius = 42.0f;
	float HalfHeight = 96.0f;
	if (const UCapsuleComponent* Capsule = Pawn->FindComponentByClass<UCapsuleComponent>())
	{
		Radius = Capsule->GetScaledCapsuleRadius();
		HalfHeight = Capsule->GetScaledCapsuleHalfHeight();
	}
	FCollisionQueryParams Params(SCENE_QUERY_STAT(WonderlandTravel), false, Pawn);
	const FCollisionShape Shape = FCollisionShape::MakeCapsule(Radius, HalfHeight);
	const FVector Base = Anchor.GetLocation();

	// The anchor first, then a small ring around it: an anchor audited clear can
	// still be crowded by something placed since, and a step aside beats refusing.
	static const FVector2D Offsets[] = {
		{0.0, 0.0}, {70.0, 0.0}, {-70.0, 0.0}, {0.0, 70.0}, {0.0, -70.0},
		{120.0, 120.0}, {-120.0, 120.0}, {120.0, -120.0}, {-120.0, -120.0},
		{200.0, 0.0}, {-200.0, 0.0}, {0.0, 200.0}, {0.0, -200.0},
	};
	for (const FVector2D& Offset : Offsets)
	{
		const FVector Top(Base.X + Offset.X, Base.Y + Offset.Y, Base.Z + HalfHeight + 250.0);
		const FVector Bottom(Base.X + Offset.X, Base.Y + Offset.Y, Base.Z - 3000.0);
		FHitResult Hit;
		if (!World->SweepSingleByChannel(Hit, Top, Bottom, FQuat::Identity, ECC_Pawn, Shape, Params))
		{
			continue;
		}
		if (Hit.bStartPenetrating || Hit.ImpactNormal.Z < 0.7)
		{
			continue;   // started inside something, or landed on a wall rather than a floor
		}
		const FVector Spot = Hit.Location + FVector(0.0, 0.0, 4.0);
		if (World->OverlapBlockingTestByChannel(Spot, FQuat::Identity, ECC_Pawn, Shape, Params))
		{
			continue;
		}
		OutLocation = Spot;
		return true;
	}
	return false;
}

bool UWonderlandTravelSubsystem::ProbeArrival(FVector Location, FVector& OutStandLocation) const
{
	const APlayerController* PC = LocalController();
	APawn* Pawn = PC != nullptr ? PC->GetPawn() : nullptr;
	if (Pawn == nullptr)
	{
		return false;
	}
	return FindSafeSpot(Pawn, FTransform(Location), OutStandLocation);
}

bool UWonderlandTravelSubsystem::UsesWorldPartition() const
{
	const UWorld* World = GetWorld();
	return World != nullptr && World->GetWorldPartition() != nullptr;
}

bool UWonderlandTravelSubsystem::GroundUnder(APawn* Pawn) const
{
	const UWorld* World = GetWorld();
	if (World == nullptr)
	{
		return false;
	}
	float HalfHeight = 96.0f;
	if (const UCapsuleComponent* Capsule = Pawn->FindComponentByClass<UCapsuleComponent>())
	{
		HalfHeight = Capsule->GetScaledCapsuleHalfHeight();
	}
	FCollisionQueryParams Params(SCENE_QUERY_STAT(WonderlandTravelGround), false, Pawn);
	FHitResult Hit;
	const FVector From = Pawn->GetActorLocation();
	const FVector To = From - FVector(0.0, 0.0, HalfHeight + 80.0);
	return World->LineTraceSingleByChannel(Hit, From, To, ECC_WorldStatic, Params);
}

void UWonderlandTravelSubsystem::BeginFadeIn(bool bArrived, const FString& Report)
{
	SetStreamingRegistered(false);
	bArrivedResult = bArrived;
	LastReport = Report;
	if (bArrived)
	{
		LastArrived = TravelId;
	}
	if (APlayerController* PC = Controller.Get())
	{
		if (PC->PlayerCameraManager != nullptr)
		{
			PC->PlayerCameraManager->StartCameraFade(1.0f, 0.0f, GetDefault<UWonderlandTravelSettings>()->FadeInSeconds,
				FLinearColor::Black, false, false);
		}
	}
	Phase = EPhase::FadingIn;
	PhaseSeconds = 0.0f;
}

void UWonderlandTravelSubsystem::SetStreamingRegistered(bool bRegister)
{
	UWorld* World = GetWorld();
	if (World == nullptr || World->GetWorldPartition() == nullptr)
	{
		bStreamingRegistered = false;   // classic map: nothing streams, nothing to register
		return;
	}
	UWorldPartitionSubsystem* Streaming = World->GetSubsystem<UWorldPartitionSubsystem>();
	if (Streaming == nullptr || bRegister == bStreamingRegistered)
	{
		return;
	}
	if (bRegister)
	{
		Streaming->RegisterStreamingSourceProvider(this);
	}
	else
	{
		Streaming->UnregisterStreamingSourceProvider(this);
	}
	bStreamingRegistered = bRegister;
}

bool UWonderlandTravelSubsystem::GetStreamingSource(FWorldPartitionStreamingSource& OutSource) const
{
	if (Phase != EPhase::Loading)
	{
		return false;
	}
	OutSource = FWorldPartitionStreamingSource(TEXT("WonderlandTravel"), AnchorTransform.GetLocation(), AnchorTransform.Rotator(),
		EStreamingSourceTargetState::Activated, false, EStreamingSourcePriority::High, false);
	return true;
}

void UWonderlandTravelSubsystem::RestoreInput()
{
	if (!bInputIgnored)
	{
		return;
	}
	if (APlayerController* PC = Controller.Get())
	{
		PC->SetIgnoreMoveInput(false);
		PC->SetIgnoreLookInput(false);
	}
	bInputIgnored = false;
}
