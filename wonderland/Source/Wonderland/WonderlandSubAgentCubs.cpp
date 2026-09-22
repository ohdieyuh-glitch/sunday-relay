#include "WonderlandSubAgentCubs.h"

#include "Engine/Engine.h"
#include "Engine/World.h"
#include "HAL/IConsoleManager.h"
#include "Misc/Paths.h"
#include "WonderlandCompanionEmbodiment.h"

namespace
{
	/** The three expressions the founder's plate gives its cubs. A flock of one face is a flock of copies. */
	const TCHAR* const CubFigures[] = { TEXT("CubGhost_Flat.wlvox"), TEXT("CubGhost_Arc.wlvox"), TEXT("CubGhost_Slant.wlvox") };

	/** Above this the Dog counts as moving and the flock takes to the dome. Smoothed before it is compared. */
	constexpr float MovingSpeedUU = 55.0f;

	/** How quickly FLIGHT and SWIRL cross-fade. Slow on purpose: a flock that switches modes instantly is a switch. */
	constexpr float ModeBlendRate = 0.9f;

	/** The ascension's shape, in seconds from the start. */
	constexpr float AscendPause = 0.55f;    // the Dog stops
	constexpr float AscendRise = 1.70f;     // and lifts
	constexpr float AscendGlow = 1.15f;     // and turns luminous
	constexpr float AscendPerCub = 0.42f;   // one cub at a time, never two
	constexpr float AscendSettle = 1.30f;   // and the Dog comes back

	float EaseInOut(float T)
	{
		T = FMath::Clamp(T, 0.0f, 1.0f);
		return T * T * (3.0f - 2.0f * T);
	}
}

const TCHAR* WonderlandSubAgentCubStateName(EWonderlandSubAgentCubState State)
{
	switch (State)
	{
	case EWonderlandSubAgentCubState::Spawning:     return TEXT("SPAWNING");
	case EWonderlandSubAgentCubState::Idle:         return TEXT("IDLE");
	case EWonderlandSubAgentCubState::Assigned:     return TEXT("ASSIGNED");
	case EWonderlandSubAgentCubState::Working:      return TEXT("WORKING");
	case EWonderlandSubAgentCubState::Researching:  return TEXT("RESEARCHING");
	case EWonderlandSubAgentCubState::Implementing: return TEXT("IMPLEMENTING");
	case EWonderlandSubAgentCubState::Verifying:    return TEXT("VERIFYING");
	case EWonderlandSubAgentCubState::Waiting:      return TEXT("WAITING");
	case EWonderlandSubAgentCubState::Returning:    return TEXT("RETURNING");
	case EWonderlandSubAgentCubState::Merging:      return TEXT("MERGING");
	case EWonderlandSubAgentCubState::Despawning:   return TEXT("DESPAWNING");
	}
	return TEXT("UNKNOWN");
}

const FWonderlandCubStation& WonderlandCubFlightStation()
{
	// THE DOG IS MOVING: a dome ABOVE it. The founder corrected an earlier build for putting them around the Dog
	// while it walked -- "they need to be flying above the relay dog not around above" -- so the ring is tight and
	// the height is well clear of the Dog's own silhouette.
	static const FWonderlandCubStation Flight = []()
	{
		FWonderlandCubStation S;
		S.RadiusDogHeights = 0.62f;
		S.HeightDogHeights = 1.55f;
		S.OrbitSeconds = 14.0f;
		S.OrbitEase = 0.30f;
		S.BobSeconds = 3.6f;
		S.BobDogHeights = 0.09f;
		S.Jitter = 0.20f;
		// Brisker than SWIRL: a flock trailing far behind a walking Dog looks abandoned rather than relaxed.
		S.FollowRate = 3.1f;
		return S;
	}();
	return Flight;
}

const FWonderlandCubStation& WonderlandCubSwirlStation()
{
	// THE DOG IS AT REST: around its body, at body height. "they can move around the relay dog like swirl around
	// it's body that's OK that's only when a relay dog isn't moving."
	static const FWonderlandCubStation Swirl = []()
	{
		FWonderlandCubStation S;
		S.RadiusDogHeights = 0.92f;
		S.HeightDogHeights = 0.58f;
		S.OrbitSeconds = 9.5f;
		// The strongest ease of the two: at rest there is nothing else going on, so a constant-speed ring would be
		// the most obvious mechanical thing on the screen.
		S.OrbitEase = 0.46f;
		S.BobSeconds = 4.6f;
		S.BobDogHeights = 0.13f;
		S.Jitter = 0.26f;
		S.FollowRate = 1.9f;
		return S;
	}();
	return Swirl;
}

// =================================================================================================== one cub

AWonderlandSubAgentCub::AWonderlandSubAgentCub()
{
	PrimaryActorTick.bCanEverTick = true;
	SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("Root")));
	SetCanBeDamaged(false);
}

void AWonderlandSubAgentCub::Prepare(const FString& FigurePath, int32 InSlot, int32 InCount, int32 Seed)
{
	Slot = InSlot;
	Count = FMath::Max(InCount, 1);
	// DRAWN ONCE, AND NEVER RE-ROLLED. A cub whose character changes as the flock resizes is not the same cub.
	const FRandomStream Stream(Seed * 7919 + Slot * 104729);
	JitterA = Stream.FRandRange(-1.0f, 1.0f);
	JitterB = Stream.FRandRange(-1.0f, 1.0f);
	JitterC = Stream.FRandRange(0.0f, 1.0f);

	UWorld* World = GetWorld();
	if (World != nullptr && Body == nullptr)
	{
		FActorSpawnParameters Params;
		Params.Owner = this;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		Body = World->SpawnActor<AWonderlandCompanionEmbodiment>(
			AWonderlandCompanionEmbodiment::StaticClass(), FTransform(GetActorLocation()), Params);
		if (Body != nullptr)
		{
			Body->DisplayName = FString::Printf(TEXT("CUB %d"), Slot + 1);
			// WHAT IT IS, WRITTEN ON IT. Never "clone", never "MAS": a label is how a reader learns the boundary.
			Body->ClassLabel = TEXT("SUB-AGENT CUB");
			Body->AttachToActor(this, FAttachmentTransformRules::SnapToTargetIncludingScale);
#if WITH_EDITOR
			Body->SetActorLabel(FString::Printf(TEXT("WL_SubAgentCub_%02d"), Slot), false);
#endif
			Body->LoadFigure(FigurePath);
			Body->SetRuntimeActivity(TEXT("IDLE"));
		}
	}
}

void AWonderlandSubAgentCub::SetSlot(int32 InSlot, int32 InCount)
{
	Slot = InSlot;
	Count = FMath::Max(InCount, 1);
}

void AWonderlandSubAgentCub::SetLeader(const AActor* InLeader, float LeaderHeightUU, bool bLeaderMoving)
{
	Leader = InLeader;
	LeaderHeight = FMath::Max(LeaderHeightUU, 40.0f);
	// CROSS-FADED, NEVER SWITCHED. The Dog taking one step must not teleport the whole flock from a ring around its
	// body to a dome over its head; the blend is what makes the two modes read as one behaviour.
	const float Want = bLeaderMoving ? 1.0f : 0.0f;
	FlightBlend = FMath::FInterpTo(FlightBlend, Want, GetWorld() != nullptr ? GetWorld()->GetDeltaSeconds() : 0.016f, ModeBlendRate);
}

void AWonderlandSubAgentCub::SetCubState(EWonderlandSubAgentCubState InState)
{
	State = InState;
	if (Body == nullptr)
	{
		return;
	}
	// The body's own motion follows what the cub is doing, through the channel that already exists for exactly this.
	switch (State)
	{
	case EWonderlandSubAgentCubState::Working:
	case EWonderlandSubAgentCubState::Implementing:
		Body->SetRuntimeActivity(TEXT("WORKING"));
		break;
	case EWonderlandSubAgentCubState::Researching:
	case EWonderlandSubAgentCubState::Verifying:
		Body->SetRuntimeActivity(TEXT("THINKING"));
		break;
	case EWonderlandSubAgentCubState::Waiting:
		Body->SetRuntimeActivity(TEXT("WAITING_FOR_AUTH"));
		break;
	default:
		Body->SetRuntimeActivity(TEXT("IDLE"));
		break;
	}
}

FVector AWonderlandSubAgentCub::SolveStation(float TimeSeconds) const
{
	const AActor* Dog = Leader.Get();
	if (Dog == nullptr)
	{
		return GetActorLocation();
	}
	const FVector Centre = Dog->GetActorLocation();

	const auto Solve = [&](const FWonderlandCubStation& S) -> FVector
	{
		const float Vary = 1.0f + S.Jitter * JitterA;
		// EVERY PERIOD IS THIS CUB'S OWN. Twelve cubs sharing one period is a clock face however well each one eases.
		const float Orbit = FMath::Max(S.OrbitSeconds * (1.0f + S.Jitter * JitterB), 1.0f);
		const float Bob = FMath::Max(S.BobSeconds * (1.0f + S.Jitter * JitterA), 0.6f);
		const float Base = 2.0f * PI * (static_cast<float>(Slot) / FMath::Max(Count, 1)) + JitterC * 2.0f * PI * 0.12f;
		// SINE EASING, NEVER LINEAR. The angle advances at a rate that rises and falls over each turn, so a cub
		// drifts round rather than being driven round -- which is the whole of the founder's "not stiff" here.
		const float Turn = 2.0f * PI * TimeSeconds / Orbit;
		const float Angle = Base + Turn + S.OrbitEase * FMath::Sin(Turn + JitterC * 6.28f);
		const float Radius = LeaderHeight * S.RadiusDogHeights * Vary;
		const float Height = LeaderHeight * (S.HeightDogHeights
			+ S.BobDogHeights * FMath::Sin(2.0f * PI * TimeSeconds / Bob + JitterC * 6.28f));
		return Centre + FVector(FMath::Cos(Angle) * Radius, FMath::Sin(Angle) * Radius, Height);
	};

	const FVector Flight = Solve(WonderlandCubFlightStation());
	const FVector Swirl = Solve(WonderlandCubSwirlStation());
	FVector Station = FMath::Lerp(Swirl, Flight, EaseInOut(FlightBlend));

	// BEFORE IT HAS EMERGED, a cub's station is inside the primary Dog. The ascension eases this to 1 and the cub
	// travels out to its place under its own follow rate, which is what makes the emergence read as separation
	// rather than as an object appearing.
	if (Emergence < 1.0f)
	{
		const FVector Inside = Centre + FVector(0.0, 0.0, LeaderHeight * 0.55);
		Station = FMath::Lerp(Inside, Station, EaseInOut(Emergence));
	}
	return Station;
}

void AWonderlandSubAgentCub::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const UWorld* World = GetWorld();
	if (World == nullptr || !Leader.IsValid())
	{
		return;
	}
	const float Now = World->GetTimeSeconds();
	const FVector Station = SolveStation(Now);
	const FVector Here = GetActorLocation();

	// A CUB CHASES ITS STATION, IT DOES NOT OCCUPY IT. Tracking the solved point exactly would make the flock a rig:
	// perfect circles at a perfect radius. The follow rate blends with the mode, so the flock is brisker in the air
	// behind a walking Dog and looser when it is swirling round a standing one.
	const float Rate = FMath::Lerp(WonderlandCubSwirlStation().FollowRate,
		WonderlandCubFlightStation().FollowRate, EaseInOut(FlightBlend)) * (1.0f + 0.22f * JitterB);
	const FVector Want = (Station - Here) * Rate;
	// A little momentum, so it overshoots slightly and settles rather than arriving dead on the point.
	Velocity = FMath::VInterpTo(Velocity, Want, DeltaSeconds, 3.4f);
	SetActorLocation(Here + Velocity * DeltaSeconds);
	StationErrorUU = static_cast<float>(FVector::Dist(GetActorLocation(), Station));

	// It faces where it is going, leaning into the turn, and never snaps round.
	if (!Velocity.IsNearlyZero(1.0f))
	{
		const FRotator Want2 = Velocity.Rotation();
		const FRotator Lean(Want2.Pitch * 0.35f, Want2.Yaw, FMath::Clamp(-Velocity.Size2D() * 0.012f, -16.0f, 16.0f) * FMath::Sign(JitterA));
		SetActorRotation(FMath::RInterpTo(GetActorRotation(), Lean, DeltaSeconds, 2.6f));
	}
}

// =================================================================================================== the flock

void UWonderlandSubAgentCubSubsystem::SetPrimaryRelayDog(AActor* Dog, float DogHeightUU)
{
	PrimaryDog = Dog;
	PrimaryDogHeightUU = FMath::Max(DogHeightUU, 40.0f);
	bHasDogSpot = false;
}

FString UWonderlandSubAgentCubSubsystem::CubFigurePath(int32 Slot) const
{
	const int32 Which = FMath::Abs(Slot) % UE_ARRAY_COUNT(CubFigures);
	return FPaths::ConvertRelativePathToFull(FPaths::ProjectDir() / TEXT("RelayCubs") / CubFigures[Which]);
}

void UWonderlandSubAgentCubSubsystem::ReportActiveSubAgents(int32 ActiveSubAgentCubCount)
{
	bHasReport = true;
	// CLAMPED, NEVER INVENTED. A report above capacity draws capacity and says so in the log rather than drawing
	// what it was told; a negative report draws nothing.
	const int32 Ceiling = FMath::Min(Capacity.MaxSubAgentCubCount, Capacity.CeilingSubAgentCubCount);
	const int32 Wanted = FMath::Clamp(ActiveSubAgentCubCount, 0, Ceiling);
	if (ActiveSubAgentCubCount > Ceiling)
	{
		UE_LOG(LogTemp, Warning, TEXT("WLCUB Julius reports %d sub-agents; capacity is %d, drawing %d"),
			ActiveSubAgentCubCount, Ceiling, Wanted);
	}
	WantedCount = Wanted;
}

bool UWonderlandSubAgentCubSubsystem::SetMaxSubAgentCubCountForDevelopment(int32 Max)
{
	const int32 Clamped = FMath::Clamp(Max, 0, Capacity.CeilingSubAgentCubCount);
	Capacity.MaxSubAgentCubCount = Clamped;
	// SAID OUT LOUD. A capacity raised by hand must never read as one a progression granted.
	Capacity.Source = EWonderlandCubCapacitySource::Development;
	WantedCount = FMath::Min(WantedCount, Clamped);
	return Clamped == Max;
}

void UWonderlandSubAgentCubSubsystem::Grow(int32 To)
{
	UWorld* World = GetWorld();
	if (World == nullptr)
	{
		return;
	}
	const FVector From = PrimaryDog.IsValid()
		? PrimaryDog->GetActorLocation() + FVector(0.0, 0.0, PrimaryDogHeightUU * 0.55)
		: FVector::ZeroVector;
	while (Cubs.Num() < To)
	{
		FActorSpawnParameters Params;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		AWonderlandSubAgentCub* Cub = World->SpawnActor<AWonderlandSubAgentCub>(
			AWonderlandSubAgentCub::StaticClass(), FTransform(From), Params);
		if (Cub == nullptr)
		{
			break;
		}
		const int32 Slot = Cubs.Num();
		Cub->Prepare(CubFigurePath(Slot), Slot, To, Slot + 1);
		Cub->SetCubState(EWonderlandSubAgentCubState::Spawning);
		Cubs.Add(Cub);
	}
	for (int32 Index = 0; Index < Cubs.Num(); ++Index)
	{
		if (Cubs[Index] != nullptr)
		{
			Cubs[Index]->SetSlot(Index, Cubs.Num());
		}
	}
	// THE ASCENSION PLAYS WHENEVER CUBS ARRIVE. It is how the founder asked for them to appear, and an appearance
	// without it is a pop-in.
	AscensionSeconds = 0.0f;
	AscensionEmerged = 0;
	OnFlockChanged.Broadcast(Cubs.Num());
}

void UWonderlandSubAgentCubSubsystem::Shrink(int32 To)
{
	while (Cubs.Num() > FMath::Max(To, 0))
	{
		AWonderlandSubAgentCub* Cub = Cubs.Pop();
		if (Cub != nullptr)
		{
			// Marked DESPAWNING before it goes, so anything watching sees it leave rather than vanish.
			Cub->SetCubState(EWonderlandSubAgentCubState::Despawning);
			if (AWonderlandCompanionEmbodiment* Body = Cub->GetBody())
			{
				Body->Destroy();
			}
			Cub->Destroy();
		}
	}
	for (int32 Index = 0; Index < Cubs.Num(); ++Index)
	{
		if (Cubs[Index] != nullptr)
		{
			Cubs[Index]->SetSlot(Index, Cubs.Num());
		}
	}
	OnFlockChanged.Broadcast(Cubs.Num());
}

void UWonderlandSubAgentCubSubsystem::StepAscension(float DeltaSeconds)
{
	if (AscensionSeconds < 0.0f)
	{
		// No ascension: the primary Dog is itself, and every cub is fully out.
		PrimaryLuminance = FMath::FInterpTo(PrimaryLuminance, 0.0f, DeltaSeconds, 3.0f);
		PrimaryLiftUU = FMath::FInterpTo(PrimaryLiftUU, 0.0f, DeltaSeconds, 3.0f);
		for (AWonderlandSubAgentCub* Cub : Cubs)
		{
			if (Cub != nullptr)
			{
				Cub->SetEmergence(1.0f);
			}
		}
		return;
	}
	AscensionSeconds += DeltaSeconds;
	const float T = AscensionSeconds;

	// 1-3. THE PRIMARY DOG PAUSES, LIFTS, AND LOOKS LIKE IT IS ASCENDING.
	const float Rise = EaseInOut((T - AscendPause) / AscendRise);
	// 4. ITS BODY TURNS COMPLETELY LUMINOUS WHITE for a few seconds.
	const float GlowIn = EaseInOut((T - AscendPause - AscendRise * 0.55f) / AscendGlow);

	// 5. THE CUBS EMERGE ONE BY ONE. Never two at once: the founder asked for one at a time and a pair leaving
	// together is the difference between a creature splitting and a spawner emitting.
	const float FirstOut = AscendPause + AscendRise + AscendGlow;
	int32 Emerged = 0;
	for (int32 Index = 0; Index < Cubs.Num(); ++Index)
	{
		const float Starts = FirstOut + Index * AscendPerCub;
		const float Out = EaseInOut((T - Starts) / AscendPerCub);
		if (Cubs[Index] != nullptr)
		{
			Cubs[Index]->SetEmergence(Out);
			if (Out > 0.0f)
			{
				Cubs[Index]->SetCubState(Out >= 1.0f ? EWonderlandSubAgentCubState::Idle : EWonderlandSubAgentCubState::Spawning);
			}
		}
		if (Out >= 1.0f)
		{
			++Emerged;
		}
	}
	AscensionEmerged = Emerged;

	// 7. AND THE PRIMARY RELAY DOG RETURNS TO NORMAL.
	const float LastOut = FirstOut + Cubs.Num() * AscendPerCub;
	const float Back = EaseInOut((T - LastOut) / AscendSettle);
	PrimaryLuminance = GlowIn * (1.0f - Back);
	PrimaryLiftUU = PrimaryDogHeightUU * 0.34f * Rise * (1.0f - Back);
	if (T > LastOut + AscendSettle)
	{
		AscensionSeconds = -1.0f;
	}
}

void UWonderlandSubAgentCubSubsystem::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	const UWorld* World = GetWorld();
	if (World == nullptr)
	{
		return;
	}

	// IS THE DOG MOVING? Measured from its own travel and smoothed, because the choice between the two modes must
	// not flicker while it shuffles.
	AActor* Dog = PrimaryDog.Get();
	if (Dog != nullptr)
	{
		const FVector Here = Dog->GetActorLocation();
		if (bHasDogSpot && DeltaTime > KINDA_SMALL_NUMBER)
		{
			DogSpeedUU = FMath::FInterpTo(DogSpeedUU, static_cast<float>(FVector::Dist2D(Here, LastDogSpot)) / DeltaTime, DeltaTime, 3.0f);
		}
		LastDogSpot = Here;
		bHasDogSpot = true;
	}
	else
	{
		// NO DOG, NO FLOCK. Cubs hold station on the primary agent; with nothing to escort they are not a formation,
		// they are litter.
		if (Cubs.Num() > 0)
		{
			Shrink(0);
		}
		return;
	}

	// NOTHING REPORTED IS NOT THE SAME AS NOTHING RUNNING, but it is the only honest thing to draw: no cubs.
	const int32 Want = bHasReport ? WantedCount : 0;
	if (Cubs.Num() < Want)
	{
		Grow(Want);
	}
	else if (Cubs.Num() > Want)
	{
		Shrink(Want);
	}

	StepAscension(DeltaTime);

	const bool bMoving = DogSpeedUU > MovingSpeedUU;
	for (AWonderlandSubAgentCub* Cub : Cubs)
	{
		if (Cub != nullptr)
		{
			Cub->SetLeader(Dog, PrimaryDogHeightUU, bMoving);
		}
	}
}

TStatId UWonderlandSubAgentCubSubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UWonderlandSubAgentCubSubsystem, STATGROUP_Tickables);
}

void UWonderlandSubAgentCubSubsystem::Deinitialize()
{
	Shrink(0);
	Super::Deinitialize();
}

bool UWonderlandSubAgentCubSubsystem::SetCubState(int32 Slot, EWonderlandSubAgentCubState State)
{
	if (!Cubs.IsValidIndex(Slot) || Cubs[Slot] == nullptr)
	{
		return false;
	}
	Cubs[Slot]->SetCubState(State);
	return true;
}

TArray<AWonderlandSubAgentCub*> UWonderlandSubAgentCubSubsystem::GetCubs() const
{
	TArray<AWonderlandSubAgentCub*> Out;
	Out.Reserve(Cubs.Num());
	for (const TObjectPtr<AWonderlandSubAgentCub>& Cub : Cubs)
	{
		Out.Add(Cub.Get());
	}
	return Out;
}

TArray<FString> UWonderlandSubAgentCubSubsystem::DescribeFlock() const
{
	TArray<FString> Lines;
	const TCHAR* Source =
		Capacity.Source == EWonderlandCubCapacitySource::Account ? TEXT("ACCOUNT") :
		Capacity.Source == EWonderlandCubCapacitySource::Development ? TEXT("DEVELOPMENT") : TEXT("BUILT-IN");
	Lines.Add(FString::Printf(TEXT("SUB-AGENT CUBS  %d of %d (ceiling %d, capacity %s)  julius reported: %s"),
		Cubs.Num(), Capacity.MaxSubAgentCubCount, Capacity.CeilingSubAgentCubCount, Source,
		bHasReport ? *FString::FromInt(WantedCount) : TEXT("nothing")));
	Lines.Add(FString::Printf(TEXT("primary dog speed %.0f uu/s -> %s"), DogSpeedUU,
		DogSpeedUU > MovingSpeedUU ? TEXT("FLIGHT (dome above)") : TEXT("SWIRL (around the body)")));
	for (const TObjectPtr<AWonderlandSubAgentCub>& Cub : Cubs)
	{
		if (Cub != nullptr)
		{
			Lines.Add(FString::Printf(TEXT("  cub %02d  %-13s blend %.2f  station error %5.1f uu  emerged %.2f"),
				Cub->GetSlot(), *Cub->GetCubStateName(), Cub->GetFlightBlend(), Cub->GetStationErrorUu(), Cub->GetEmergence()));
		}
	}
	return Lines;
}

// ---------------------------------------------------------------------------------------------------------------
// Console. These report what Julius reported and let a proof drive the flock; none of them grants a cub any
// authority, because a cub has none to grant.

namespace
{
	UWonderlandSubAgentCubSubsystem* FlockFor(UWorld* World)
	{
		return World != nullptr ? World->GetSubsystem<UWonderlandSubAgentCubSubsystem>() : nullptr;
	}

	FAutoConsoleCommandWithWorldAndArgs GCubStatus(
		TEXT("wl.Cubs.Status"),
		TEXT("The sub-agent cub flock: how many, from what report, in which mode."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
		{
			UWonderlandSubAgentCubSubsystem* Flock = FlockFor(World);
			if (Flock == nullptr)
			{
				UE_LOG(LogTemp, Warning, TEXT("WLCUB no flock subsystem"));
				return;
			}
			for (const FString& Line : Flock->DescribeFlock())
			{
				UE_LOG(LogTemp, Display, TEXT("WLCUB %s"), *Line);
			}
		}));

	FAutoConsoleCommandWithWorldAndArgs GCubReport(
		TEXT("wl.Cubs.Report"),
		TEXT("Stand in for Julius's sub-agent report, for a proof: wl.Cubs.Report 5"),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			UWonderlandSubAgentCubSubsystem* Flock = FlockFor(World);
			if (Flock == nullptr || Args.Num() < 1)
			{
				UE_LOG(LogTemp, Warning, TEXT("WLCUB usage: wl.Cubs.Report <active sub-agents>"));
				return;
			}
			Flock->ReportActiveSubAgents(FCString::Atoi(*Args[0]));
			UE_LOG(LogTemp, Display, TEXT("WLCUB reported %s active sub-agents"), *Args[0]);
		}));

	FAutoConsoleCommandWithWorldAndArgs GCubCapacity(
		TEXT("wl.Cubs.MaxCubs"),
		TEXT("Raise or lower the cub capacity for a proof. Marks the source DEVELOPMENT."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			UWonderlandSubAgentCubSubsystem* Flock = FlockFor(World);
			if (Flock == nullptr || Args.Num() < 1)
			{
				UE_LOG(LogTemp, Warning, TEXT("WLCUB usage: wl.Cubs.MaxCubs <n>"));
				return;
			}
			const int32 Want = FCString::Atoi(*Args[0]);
			UE_LOG(LogTemp, Display, TEXT("WLCUB capacity %d: %s"), Want,
				Flock->SetMaxSubAgentCubCountForDevelopment(Want) ? TEXT("set") : TEXT("CLAMPED to the ceiling"));
		}));
}
