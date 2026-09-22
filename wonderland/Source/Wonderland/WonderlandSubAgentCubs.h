// WONDERLAND — RELAY DOG CUB GHOSTS: the primary Compound AI Agent's regular sub-agents, made visible.
//
// WHAT THEY ARE, in the founder's own correction (2026-09-22): "RELAY DOG CUB GHOSTS = REGULAR SUB-AGENTS. They are
// NOT: /MAS clones, full temporary Compound AI Agent clones, alternate Julius instances, mission authorities."
//
// So a cub is a lightweight delegated helper working under the primary Relay Dog. It holds no mission authority, it
// is not a second Julius, and nothing here may suggest otherwise. /MAS is a separate capability for full Compound
// clones and is untouched by any of this; the two must never be combined visually or technically.
//
// HOW MANY THERE ARE IS NOT THIS FILE'S DECISION. "The actual authorized sub-agent count must come from the real
// agent/runtime state. Wonderland should not visually invent active sub-agents that do not exist." So the flock is
// sized by what Julius reports -- FWonderlandJuliusActivity::ActiveSubagents, which is raised and cleared by real
// events -- clamped by a capacity that is a parameter rather than a constant. With nothing reported, no cubs.
//
// HOW THEY MOVE IS THE FOUNDER'S RULE, verbatim: "The Cubs cannot move stiff they have to move smoothly just like the
// AI companions do and they can move around the relay dog like swirl around it's body that's OK that's only when a
// relay dog isn't moving", and earlier: "they need to be flying above the relay dog not around above."
//
// Which gives exactly two station-keeping modes, chosen by whether the Dog is moving and CROSS-FADED between:
//
//   FLIGHT  the Dog is moving  -> hold station in a dome ABOVE it, out of its way
//   SWIRL   the Dog is at rest -> orbit around its body, at body height
//
// AND THE EASING IS SINE, NEVER LINEAR. A constant-speed orbit is the single thing that most reads as mechanical:
// twelve cubs going round at a fixed rate is a clock face. Every cub's orbit speeds up and slows down on its own
// phase, its radius and height breathe, and it eases toward its station rather than tracking it exactly -- so the
// flock is never a formation of identical objects on one clock.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Subsystems/WorldSubsystem.h"
#include "WonderlandSubAgentCubs.generated.h"

class AWonderlandCompanionEmbodiment;

/**
 * WHAT A CUB IS DOING, for presentation only.
 *
 * THESE ARE SUB-AGENT PRESENTATION STATES AND NOTHING MORE. They do not map to /MAS clone lifecycle semantics, they
 * confer nothing, and a cub in any of them has exactly as much authority as a cub in any other: none.
 */
UENUM(BlueprintType)
enum class EWonderlandSubAgentCubState : uint8
{
	/** Emerging from the primary Dog. The only state a cub may be created in. */
	Spawning,
	/** Present and unassigned. */
	Idle,
	/** Given a piece of work, not yet started. */
	Assigned,
	Working,
	Researching,
	Implementing,
	Verifying,
	/** Blocked on something outside itself. */
	Waiting,
	/** Coming back to the primary Dog. */
	Returning,
	/** Folding its work back into the primary Dog's. */
	Merging,
	/** Fading out. A cub in this state is on its way to not existing. */
	Despawning
};

WONDERLAND_API const TCHAR* WonderlandSubAgentCubStateName(EWonderlandSubAgentCubState State);

/**
 * WHERE THE ACTIVE COUNT CAME FROM.
 *
 * The founder's rule is that `wl.Cubs.Report` stays a development command and "must not become production truth", so
 * the two paths are distinct here and the difference is visible wherever a count is shown. Julius always wins: the
 * first real report takes the flock off a development count immediately.
 */
UENUM(BlueprintType)
enum class EWonderlandCubCountSource : uint8
{
	/** Nothing has reported. Not the same as a report of zero, and shown differently. */
	NotReported,
	/** Julius said so. The only production truth. */
	Julius,
	/** A proof or the console said so. Always labelled. */
	Development
};

/** Where a capacity figure came from. A limit with no provenance is a limit nobody can check. */
UENUM(BlueprintType)
enum class EWonderlandCubCapacitySource : uint8
{
	/** This build's own defaults: the founder's entry progression. */
	BuiltIn,
	/** Reported by an account or progression authority. Nothing does this yet. */
	Account,
	/** Raised or lowered by hand for a proof. Always visible as such. */
	Development
};

/**
 * HOW MANY CUBS MAY EXIST AT ONCE.
 *
 * FOUNDER PROGRESSION (2026-09-22): entry approximately 4-5, higher approximately 8-9, max target approximately 12,
 * and "Architect this as parameterized capacity. Do not hard-code the final progression economy yet."
 *
 * So this is the entry figure and a ceiling, both replaceable, and neither is a price list. Nothing above the entry
 * tier is implemented, because nothing above it is required yet; what exists is the seam.
 */
USTRUCT(BlueprintType)
struct WONDERLAND_API FWonderlandCubCapacity
{
	GENERATED_BODY()

	/** What this account may run concurrently right now. The founder's entry figure. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Cubs")
	int32 MaxSubAgentCubCount = 5;

	/** The most the progression is ever expected to reach. Wonderland will not draw more than this whatever it is told. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Cubs")
	int32 CeilingSubAgentCubCount = 12;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Cubs")
	EWonderlandCubCapacitySource Source = EWonderlandCubCapacitySource::BuiltIn;
};

/**
 * HOW THE FLOCK HOLDS STATION. One set of numbers per mode, in multiples of the DOG's height so they scale with
 * whoever is being escorted rather than with a plaza.
 *
 * Mirrors the parameter shape the world lane's cub_canon uses, so the two descriptions of the same motion cannot
 * drift: radius, height, periods, jitter, and a turn rate.
 */
USTRUCT(BlueprintType)
struct WONDERLAND_API FWonderlandCubStation
{
	GENERATED_BODY()

	/** Orbit radius, in Dog heights. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Cubs")
	float RadiusDogHeights = 0.85f;

	/** Height above the Dog's feet, in Dog heights. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Cubs")
	float HeightDogHeights = 0.55f;

	/** Seconds for one turn of the orbit. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Cubs")
	float OrbitSeconds = 11.0f;

	/**
	 * HOW MUCH THE ORBIT SPEEDS UP AND SLOWS DOWN over one turn, 0 to 1. Zero is a constant-speed orbit, which is
	 * exactly what reads as stiff, so zero is never the right answer here.
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Cubs")
	float OrbitEase = 0.38f;

	/** Seconds for one rise and fall. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Cubs")
	float BobSeconds = 4.3f;

	/** How far it rises and falls, in Dog heights. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Cubs")
	float BobDogHeights = 0.10f;

	/** Per-cub variation applied to radius, height and every period, 0 to 1. Without it, twelve cubs are a clock face. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Cubs")
	float Jitter = 0.22f;

	/** How briskly a cub closes on its station. Lower is looser and heavier; nothing here ever snaps. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Cubs")
	float FollowRate = 2.4f;
};

/** The two modes, and the rule that picks between them. */
WONDERLAND_API const FWonderlandCubStation& WonderlandCubFlightStation();
WONDERLAND_API const FWonderlandCubStation& WonderlandCubSwirlStation();

/**
 * ONE CUB GHOST IN THE WORLD.
 *
 * It carries no mission state and decides nothing. Its position is solved from the primary Dog's, its state is set
 * from outside, and it can neither create nor destroy itself.
 */
UCLASS()
class WONDERLAND_API AWonderlandSubAgentCub : public AActor
{
	GENERATED_BODY()

public:
	AWonderlandSubAgentCub();

	virtual void Tick(float DeltaSeconds) override;

	/** Build the body and take a place in the flock. Slot and Count decide where in the ring this one flies. */
	void Prepare(const FString& FigurePath, int32 InSlot, int32 InCount, int32 Seed);

	/** Which of the flock this is, and how many there are. Re-solved whenever the flock changes size. */
	void SetSlot(int32 InSlot, int32 InCount);

	/** Where to hold station: the Dog, its height in uu, and whether the Dog is moving. */
	void SetLeader(const AActor* InLeader, float LeaderHeightUU, bool bLeaderMoving);

	UFUNCTION(BlueprintCallable, Category = "Wonderland|Cubs")
	void SetCubState(EWonderlandSubAgentCubState InState);

	UFUNCTION(BlueprintPure, Category = "Wonderland|Cubs")
	EWonderlandSubAgentCubState GetCubState() const { return State; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Cubs")
	FString GetCubStateName() const { return WonderlandSubAgentCubStateName(State); }

	/** 0 fully SWIRL, 1 fully FLIGHT. Read by a proof to show the two modes cross-fade rather than snap. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Cubs")
	float GetFlightBlend() const { return FlightBlend; }

	/** How far this cub is from the station it is aiming at, uu. Never zero: a cub that tracks exactly is a rig. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Cubs")
	float GetStationErrorUu() const { return StationErrorUU; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Cubs")
	int32 GetSlot() const { return Slot; }

	/**
	 * THE ASCENSION. 0 while the cub is still inside the primary Dog, 1 once it has taken its place. The sequence
	 * drives this; the cub only reads it, so a cub can never advance its own emergence.
	 */
	void SetEmergence(float InEmergence) { Emergence = FMath::Clamp(InEmergence, 0.0f, 1.0f); }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Cubs")
	float GetEmergence() const { return Emergence; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Cubs")
	AWonderlandCompanionEmbodiment* GetBody() const { return Body; }

private:
	FVector SolveStation(float TimeSeconds) const;

	UPROPERTY(Transient)
	TObjectPtr<AWonderlandCompanionEmbodiment> Body;

	TWeakObjectPtr<const AActor> Leader;
	float LeaderHeight = 180.0f;
	int32 Slot = 0;
	int32 Count = 1;
	/** Per-cub variation, drawn once at Prepare and never re-rolled: a cub that changes its character is not a cub. */
	float JitterA = 0.0f;
	float JitterB = 0.0f;
	float JitterC = 0.0f;
	float FlightBlend = 1.0f;
	float StationErrorUU = 0.0f;
	float Emergence = 0.0f;
	FVector Velocity = FVector::ZeroVector;
	EWonderlandSubAgentCubState State = EWonderlandSubAgentCubState::Spawning;
};

DECLARE_MULTICAST_DELEGATE_OneParam(FOnWonderlandCubFlockChanged, int32 /*ActiveCount*/);

/**
 * THE FLOCK.
 *
 * A world subsystem, because cubs are creatures in a level rather than a property of the session: leaving the level
 * ends them, and none of them should survive it.
 */
UCLASS()
class WONDERLAND_API UWonderlandSubAgentCubSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;
	virtual void Deinitialize() override;

	/** The Dog the flock escorts. Without one there is nothing to hold station on and the flock stays empty. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Cubs")
	void SetPrimaryRelayDog(AActor* Dog, float DogHeightUU);

	/**
	 * HOW MANY ORDINARY SUB-AGENTS JULIUS SAYS ARE RUNNING. Production truth, and the only way the flock grows in a
	 * shipped build. Called from the Julius subsystem's own change notification, never guessed at here.
	 *
	 * Clamped to capacity, never invented, and zero when nothing has been reported -- because "Wonderland should not
	 * visually invent active sub-agents that do not exist", and an empty report is not the same as a full one.
	 *
	 * ORDINARY SUB-AGENTS, NOT /MAS. FWonderlandActivityReading::ActiveSubagents counts workers Julius spawned and
	 * has not reported complete. /MAS is a separate capability and nothing here is connected to it.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Cubs")
	void ReportActiveSubAgents(int32 ActiveSubAgentCubCount);

	/**
	 * THE SAME, FROM A PROOF OR THE CONSOLE, AND MARKED AS SUCH. Separate from the Julius path on the founder's
	 * instruction, so a development count can never be mistaken for -- or outlive -- production truth: the next real
	 * report from Julius replaces it without ceremony.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Cubs")
	void ReportActiveSubAgentsForDevelopment(int32 ActiveSubAgentCubCount);

	/** Where the current count came from. A surface showing cubs must be able to say. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Cubs")
	EWonderlandCubCountSource GetCountSource() const { return CountSource; }

	/** True once Julius has reported at least once. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Cubs")
	bool IsDrivenByJulius() const { return CountSource == EWonderlandCubCountSource::Julius; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Cubs")
	int32 GetActiveSubAgentCubCount() const { return Cubs.Num(); }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Cubs")
	int32 GetMaxSubAgentCubCount() const { return Capacity.MaxSubAgentCubCount; }

	const FWonderlandCubCapacity& GetCapacity() const { return Capacity; }

	/** Raise or lower the capacity for a proof. Marks the source DEVELOPMENT; never above the ceiling. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Cubs")
	bool SetMaxSubAgentCubCountForDevelopment(int32 Max);

	/** Give one cub something to be doing. Presentation only. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Cubs")
	bool SetCubState(int32 Slot, EWonderlandSubAgentCubState State);

	UFUNCTION(BlueprintPure, Category = "Wonderland|Cubs")
	TArray<AWonderlandSubAgentCub*> GetCubs() const;

	/** Whether the ascension is playing right now, and how far through it is. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Cubs")
	bool IsAscending() const { return AscensionSeconds >= 0.0f; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Cubs")
	float GetAscensionSeconds() const { return FMath::Max(AscensionSeconds, 0.0f); }

	/** How luminous the primary Dog should be drawn right now, 0 to 1. The ascension's own curve. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Cubs")
	float GetPrimaryLuminance() const { return PrimaryLuminance; }

	/** How far the primary Dog is lifted during the ascension, uu. Zero at every other moment. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Cubs")
	float GetPrimaryLiftUu() const { return PrimaryLiftUU; }

	/** The flock as lines, for a proof and for `wl.Cubs.Status`. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Cubs")
	TArray<FString> DescribeFlock() const;

	FOnWonderlandCubFlockChanged OnFlockChanged;

private:
	void Grow(int32 To);
	void Shrink(int32 To);
	void StepRetiring(float DeltaSeconds);
	/** Listen to Julius, once there is a Julius to listen to. */
	void EnsureJuliusBound();

	/**
	 * JULIUS SAID SOMETHING CHANGED. Reads ActiveSubagents and tells the flock -- the whole of the live connection.
	 * A UFUNCTION because the notification is a dynamic multicast.
	 */
	UFUNCTION()
	void HandleJuliusChanged();
	void StepAscension(float DeltaSeconds);
	FString CubFigurePath(int32 Slot) const;

	UPROPERTY(Transient)
	TArray<TObjectPtr<AWonderlandSubAgentCub>> Cubs;

	TWeakObjectPtr<AActor> PrimaryDog;
	float PrimaryDogHeightUU = 180.0f;
	FVector LastDogSpot = FVector::ZeroVector;
	bool bHasDogSpot = false;
	/** Smoothed, so the flock does not switch modes every time the Dog twitches. */
	float DogSpeedUU = 0.0f;

	FWonderlandCubCapacity Capacity;
	int32 WantedCount = 0;
	bool bHasReport = false;
	EWonderlandCubCountSource CountSource = EWonderlandCubCountSource::NotReported;
	bool bBoundToJulius = false;
	/** What Julius last said, so a redundant notification does not restart the ascension. */
	int32 LastJuliusReport = -1;

	/** A cub on its way out: RETURNING, then MERGING, then gone. How long it has been leaving. */
	struct FRetiringCub
	{
		TObjectPtr<AWonderlandSubAgentCub> Cub;
		float Seconds = 0.0f;
	};
	TArray<FRetiringCub> Retiring;

	/** Negative when no ascension is playing. */
	float AscensionSeconds = -1.0f;
	int32 AscensionEmerged = 0;
	float PrimaryLuminance = 0.0f;
	float PrimaryLiftUU = 0.0f;
};
