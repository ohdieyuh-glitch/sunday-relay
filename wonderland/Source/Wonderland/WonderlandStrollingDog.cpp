#include "WonderlandStrollingDog.h"

#include "WonderlandProjectAvatarActor.h"

#include "Components/SceneComponent.h"
#include "WonderlandDogBody.h"
#include "WonderlandDogGait.h"
#include "WonderlandDogStance.h"
#include "Components/StaticMeshComponent.h"
#include "CollisionQueryParams.h"
#include "Engine/World.h"

namespace WonderlandDogTags
{
	const FName RelayDog(TEXT("RelayDog"));
	const FName CompoundAgent(TEXT("CompoundAgent"));
	const FName HeroRelayDog(TEXT("HeroRelayDog"));
}

AWonderlandStrollingDog::AWonderlandStrollingDog()
{
	PrimaryActorTick.bCanEverTick = true;
	Body = CreateDefaultSubobject<USceneComponent>(TEXT("Body"));
	SetRootComponent(Body);
}

void AWonderlandStrollingDog::BeginPlay()
{
	Super::BeginPlay();

	if (HomeLocation.IsNearlyZero())
	{
		HomeLocation = GetActorLocation();
	}

	// THE TAGS ARE THE PROOF'S ONLY EVIDENCE. WonderlandWorldProof counts by
	// them, and a Dog that forgot to tag itself is a Dog the founder can see and
	// the log says is not there — which is worse than either being true alone.
	Tags.AddUnique(WonderlandDogTags::RelayDog);
	if (bIsHero)
	{
		Tags.AddUnique(WonderlandDogTags::HeroRelayDog);
	}
	else
	{
		Tags.AddUnique(WonderlandDogTags::CompoundAgent);
	}

	WonderlandDogBody::FSkin Skin;
	Skin.Coat = CoatName;
	Skin.Accessory = Accessory;
	// The actor's own scale carries the size the generator asked for, so the
	// body is built at the canonical reference scale and scaled as a whole.
	// Scaling the parts instead would let a skin change proportions, which is
	// the one thing the identity rule forbids.
	Skin.Scale = WonderlandDogBody::ReferenceScale;
	Skin.FootOffset = 0.0f;
	BuiltParts = WonderlandDogBody::Build(this, Body, Skin, &Rig);

	// The configured speed IS the base to vary around. Without this a hero Dog
	// set to 110 by the generator would have PickDestination vary around the
	// class default of 90 instead, and the one Dog whose speed was deliberately
	// chosen would be the one ignoring it.
	BaseWalkSpeed = WalkSpeed;

	// HIP HEIGHT IN WORLD UNITS, ONCE. The Froude number that chooses the gait
	// is v^2/(g*h), and v is a world-space speed — so h must be too, or a Dog
	// at actor scale 1.75 breaks into a trot at the speed that suits a Dog of
	// scale 1. Taken from the rig rather than a constant, because the leg
	// length is the canonical table's to decide.
	if (Rig.Legs[0] != nullptr)
	{
		const float LocalLeg = Rig.LegRestScale[0].Z * 100.0f;
		const float ScaleZ = GetActorScale3D().Z;
		HipHeightWorld = LocalLeg * ((ScaleZ > KINDA_SMALL_NUMBER) ? ScaleZ : 1.0f);
	}
	if (Rig.Torso != nullptr)
	{
		TorsoBaseScale = Rig.Torso->GetRelativeScale3D();
	}
	// Stride scales with the Dog. Quoted against the reference skin scale so a
	// larger Dog takes proportionally longer steps instead of scurrying.
	const float SizeRatio = (WonderlandDogBody::ReferenceScale > 0.0f)
		? (Skin.Scale / WonderlandDogBody::ReferenceScale) : 1.0f;
	StrideLength *= SizeRatio;
	StrideLift *= SizeRatio;
	StrideBob *= SizeRatio;

	if (BuiltParts == 0)
	{
		// LOUD, and at Warning so it survives the packaged log's filtering. The
		// failure this class was written to end was a Dog that vanished
		// quietly; replacing it with a Dog that vanishes quietly for a
		// different reason would be no improvement.
		UE_LOG(LogTemp, Warning,
			   TEXT("RELAY DOG BODY FAILED for %s — coat '%s'. The Dog is present "
					"as an actor and INVISIBLE. Check that /Engine/BasicShapes/Cube "
					"and /Game/Wonderland/Materials/MI_%s cooked into the package."),
			   *GetName(), *CoatName.ToString(), *CoatName.ToString());
	}

	// A stable per-Dog phase from the placed position: deterministic across
	// runs, so two hero frames of the same camera are comparable.
	const FVector P = GetActorLocation();
	BreathPhase = FMath::Fmod(FMath::Abs(P.X * 0.013f + P.Y * 0.029f), 6.2831853f);
	PickDestination();
}

WonderlandPose::EWork AWonderlandStrollingDog::DesiredWork() const
{
	// NO AVATAR MEANS NO WORK. A Dog does not invent a job to look busy, and
	// the Avatar's own state module already refuses to turn "we have not heard
	// from Relay" into something plausible — so this is a single hop with no
	// place for a default to creep in.
	const AWonderlandProjectAvatarActor* const Avatar =
		Cast<AWonderlandProjectAvatarActor>(AttendTarget);
	if (Avatar == nullptr)
	{
		return WonderlandPose::EWork::None;
	}
	return WonderlandAvatar::WorkForMission(Avatar->Mission());
}

void AWonderlandStrollingDog::PoseUpright(float Blend, WonderlandPose::EWork Work)
{
	if (Blend <= 0.0f)
	{
		return;   // the gait's pose stands, untouched
	}
	const float LegLen = (Rig.Legs[0] != nullptr) ? Rig.LegRestScale[0].Z * 100.0f : 119.6f;
	const WonderlandPose::FUprightPose Up =
		WonderlandPose::UprightPose(Blend, LegLen, WorkPhase, Work);

	for (int32 i = 0; i < 4; ++i)
	{
		UStaticMeshComponent* const Leg = Rig.Legs[i];
		if (Leg == nullptr) { continue; }
		// ADDED to whatever the gait left, not replacing it — so a Dog that
		// rises mid-stride rises FROM where its legs actually were.
		Leg->SetRelativeLocation(Leg->GetRelativeLocation()
			+ FVector(0.0f, Up.LegSpread[i], Up.LegRise[i]));
		Leg->SetRelativeRotation(Leg->GetRelativeRotation()
			+ FRotator(Up.LegPitchDeg[i], 0.0f, 0.0f));
		// THE HIND LEGS SPAN THE RAISED HIP. Without this the body leaves its
		// own legs as it rears — measured at 52% of a leg length before the
		// pose was corrected, and the stretch is the half of the fix that has
		// to reach the actual components.
		if (i < 2 && Up.HindStretch != 1.0f)
		{
			const FVector Rest = Rig.LegRestScale[i];
			Leg->SetRelativeScale3D(FVector(Rest.X, Rest.Y, Rest.Z * Up.HindStretch));
		}
	}
	if (Rig.Torso != nullptr)
	{
		Rig.Torso->SetRelativeLocation(Rig.Torso->GetRelativeLocation()
			+ FVector(0.0f, 0.0f, Up.TorsoRise));
		Rig.Torso->SetRelativeRotation(FRotator(Up.TorsoPitchDeg, 0.0f, 0.0f));
	}
	if (Rig.Head != nullptr)
	{
		Rig.Head->SetRelativeLocation(Rig.Head->GetRelativeLocation()
			+ FVector(0.0f, 0.0f, Up.HeadRise + Up.TorsoRise));
		Rig.Head->SetRelativeRotation(FRotator(Up.HeadPitchDeg, 0.0f, 0.0f));
	}
}

void AWonderlandStrollingDog::PoseStanding(float Blend, float Travelled,
                                           float DeltaSeconds)
{
	if (Blend <= 0.0f)
	{
		return;   // the quadruped, untouched -- the canonical default
	}
	const float LegLen = (Rig.Legs[0] != nullptr)
		? Rig.LegRestScale[0].Z * 100.0f : 119.6f;
	const float TorsoLen = (Rig.Torso != nullptr)
		? Rig.Torso->GetRelativeScale3D().X * 100.0f : LegLen * 1.6f;

	const WonderlandStance::FStandingPose Stand =
		WonderlandStance::StandingPose(Blend, LegLen, TorsoLen);

	// THE BIPED WALK RIDES ON TOP OF THE STANDING POSE, scaled by how far into
	// it the Dog is -- so a Dog rising mid-stride keeps walking through the
	// transition instead of stopping to stand and starting again.
	const WonderlandGait::FGaitParams Gait =
		WonderlandGait::GaitForSpeed(CurrentSpeed, HipHeightWorld);
	const float Stride = (Gait.StrideLength > 1.0f) ? Gait.StrideLength : StrideLength;
	const float Phase = Travelled / Stride;
	const float Moving = FMath::Clamp(CurrentSpeed / FMath::Max(1.0f, HipHeightWorld), 0.0f, 1.0f);
	const float Walk = Blend * Moving;

	const WonderlandStance::FCarriage Carry =
		WonderlandStance::Carriage(Phase, Gait.BobHeight * 1.6f * Walk,
		                           LegLen * 0.06f * Walk);
	const WonderlandStance::FIdleSway Idle =
		WonderlandStance::IdleSway(LifeSeconds + BreathPhase, LegLen);
	const float ArmAmp = WonderlandStance::ArmAmplitudeFor(CurrentSpeed, LegLen) * Walk;

	for (int32 i = 0; i < 4; ++i)
	{
		UStaticMeshComponent* const Limb = Rig.Legs[i];
		if (Limb == nullptr) { continue; }

		FVector Loc = Limb->GetRelativeLocation()
			+ FVector(0.0f, Stand.LegSpread[i], Stand.LegRise[i]);
		FRotator Rot = Limb->GetRelativeRotation()
			+ FRotator(Stand.LegPitchDeg[i], 0.0f, 0.0f);

		if (i < 2)
		{
			// A STANDING LEG. Same foot-lock contract as the quadruped gait:
			// while planted its world position does not change, which is the
			// one thing that has to be exact for a walk not to slide.
			const WonderlandStance::FStepPose Step =
				WonderlandStance::StepPose(Phase + WonderlandStance::LegPhaseOffset(i),
				                           Stride, Gait.LiftHeight);
			const float HipUU = LegLen * Stand.LegStretch;
			const WonderlandStance::FLimbSwing Swing =
				WonderlandStance::LimbSwing(Step, HipUU);
			Loc.X += Step.Forward * Walk;
			Loc.Z += Step.Lift * Walk + Carry.PelvisRise;
			Loc.Y += Carry.PelvisSway;
			Rot.Pitch += Swing.PitchDeg * Walk;
			const FVector RestScale = Rig.LegRestScale[i];
			Limb->SetRelativeScale3D(FVector(RestScale.X, RestScale.Y,
				RestScale.Z * FMath::Lerp(1.0f, Stand.LegStretch * Swing.Stretch, Blend)));
		}
		else
		{
			// AN ARM. Contralateral to its own-side leg and trailing it, both
			// proven in WonderlandDogStance.test.cpp -- getting either wrong is
			// instantly readable as "concentrating on not falling over".
			const int32 Side = i - 2;
			const WonderlandStance::FArmSwing Arm =
				WonderlandStance::ArmSwing(Phase + WonderlandStance::LegPhaseOffset(Side),
				                           ArmAmp);
			Loc.Z += Carry.PelvisRise * 0.9f;
			Loc.Y += Carry.PelvisSway * 0.7f;
			Rot.Pitch += Arm.PitchDeg;
			Rot.Roll += (Stand.ArmOutDeg[Side] + Arm.OutDeg * ((Side == 0) ? -1.0f : 1.0f));
		}
		Limb->SetRelativeLocation(Loc);
		Limb->SetRelativeRotation(Rot);
	}

	if (Rig.Torso != nullptr)
	{
		Rig.Torso->SetRelativeLocation(Rig.Torso->GetRelativeLocation()
			+ FVector(0.0f, Carry.PelvisSway, Stand.TorsoRise + Carry.PelvisRise + Idle.Breath * Blend));
		Rig.Torso->SetRelativeRotation(FRotator(Stand.TorsoPitchDeg,
			Carry.TorsoYawDeg, Carry.TorsoRollDeg + Idle.SwayDeg * Blend));
	}
	if (Rig.Head != nullptr)
	{
		// THE HEAD HOLDS ITS GAZE. It rides the standing torso but counters the
		// pelvis, because the visor and the gold eyes ARE the identity and a
		// head that bobs with the hips throws them around the frame.
		Rig.Head->SetRelativeLocation(Rig.Head->GetRelativeLocation()
			+ FVector(0.0f, Carry.PelvisSway * 0.4f,
			          Stand.HeadRise + Carry.PelvisRise + Carry.HeadRise));
		Rig.Head->SetRelativeRotation(FRotator(Stand.HeadPitchDeg,
			Carry.HeadYawDeg + Idle.HeadYawDeg * Blend, Carry.HeadRollDeg));
	}
}

void AWonderlandStrollingDog::PickDestination()
{
	// Deterministic wander: the destination is a function of the Dog's home and
	// how long it has been alive. No RNG, because a hero frame captured twice
	// must frame the same Dogs in the same places.
	const float Angle = FMath::Fmod(BreathPhase + LifeSeconds * 0.37f, 6.2831853f);
	const float Radius = RoamRadius * (0.35f + 0.5f * FMath::Abs(FMath::Sin(LifeSeconds * 0.11f + BreathPhase)));
	Destination = HomeLocation + FVector(FMath::Cos(Angle) * Radius,
										 FMath::Sin(Angle) * Radius, 0.0f);
	Destination = PushOutOfKeepOut(Destination);

	// A DISTRICT WHERE EVERY DOG MOVES AT EXACTLY ONE SPEED READS AS A CAROUSEL.
	// The gait is derived from speed, so varying the speed per leg of the wander
	// is all it takes to have some Dogs strolling and others trotting across the
	// same plaza — which is what makes the walk/trot distinction visible at all
	// rather than merely implemented. Deterministic, like the destination: a
	// hero frame captured twice must frame the same Dogs doing the same thing.
	const float Pick = FMath::Abs(FMath::Sin(BreathPhase * 2.7f + LifeSeconds * 0.13f));
	WalkSpeed = FMath::Lerp(BaseWalkSpeed, BaseWalkSpeed * 3.4f, Pick * Pick);
}

FVector AWonderlandStrollingDog::PushOutOfKeepOut(const FVector& Where) const
{
	if (KeepOutRadius <= 0.0f)
	{
		return Where;
	}
	// Flat: the exclusion is a COLUMN, not a sphere. A Dog on a terrace above
	// the camera is still in the shot. Pushed OUT along its own bearing rather
	// than reflected or clamped home, so the world still reads as populated
	// instead of as a ring with a hole punched in it.
	//
	// The arithmetic lives in WonderlandGait so it can be proven with g++ on a
	// laptop. A second copy here is how the leg table drifted.
	float OutX = 0.0f, OutY = 0.0f;
	WonderlandGait::PushOutOfColumn(Where.X, Where.Y, KeepOutCentre.X, KeepOutCentre.Y,
	                                KeepOutRadius, OutX, OutY);
	return FVector(OutX, OutY, Where.Z);
}

void AWonderlandStrollingDog::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	LifeSeconds += DeltaSeconds;

	// A frame that took no time, or an absurd one after a hitch, must not be
	// integrated: it produces a zero-length step or a teleport, and both read
	// as the snapping the founder saw.
	const float Dt = FMath::Clamp(DeltaSeconds, 0.0f, 0.1f);

	// THE BREATH. Ambient life, never state: it depends on LifeSeconds and the
	// placed position and on nothing Relay has ever said. Applied to the TORSO
	// now rather than to the root — scaling the root scaled the legs and their
	// stride with it, so the whole Dog pulsed instead of breathing.
	if (Rig.Torso != nullptr)
	{
		const float Breath = 1.0f + 0.02f * FMath::Sin(LifeSeconds * 1.4f + BreathPhase);
		Rig.Torso->SetRelativeScale3D(TorsoBaseScale * Breath);
	}

	if (PauseSeconds > 0.0f)
	{
		PauseSeconds -= Dt;
		// Settle to a stand: the paws ease back to rest rather than freezing
		// mid-stride, which is what made a stopping Dog look like a dropped
		// prop.
		// Bleed the speed off rather than zeroing it, so the gait relaxes down
		// through its bands instead of the Dog stopping dead and the legs
		// jumping to a walk pattern from a trot one.
		CurrentSpeed = FMath::FInterpConstantTo(CurrentSpeed, 0.0f, Dt, DecelUUPerSec2);
		PoseLegs(DistanceWalked, FMath::Clamp(PauseSeconds * 2.0f, 0.0f, 1.0f));
		return;
	}

	// WHAT RELAY IS ACTUALLY DOING decides whether this Dog works at all. No
	// Avatar, or an Avatar with nothing happening, and it simply wanders — the
	// world must not stage a performance for work that is not occurring.
	const WonderlandPose::EWork Work = DesiredWork();
	CurrentWorkName = FName(ANSI_TO_TCHAR(WonderlandPose::WorkName(Work)));
	const bool bWantsWork = (Work != WonderlandPose::EWork::None);

	const FVector Here = GetActorLocation();

	if (bWantsWork)
	{
		// Walk to the Avatar's attendance point, then rise. The Dog only stands
		// once it has ARRIVED: rising while still crossing the plaza is a Dog
		// hopping along on its hind legs.
		const AWonderlandProjectAvatarActor* const Avatar =
			Cast<AWonderlandProjectAvatarActor>(AttendTarget);
		const FVector Post = Avatar->AttendancePoint();
		FVector ToPost = Post - Here;
		ToPost.Z = 0.0f;
		const float PostDist = ToPost.Size();

		if (PostDist < 90.0f)
		{
			// AT THE POST. Settle the gait, rise, and work.
			CurrentSpeed = FMath::FInterpConstantTo(CurrentSpeed, 0.0f, Dt, DecelUUPerSec2);
			const float Target = WonderlandPose::UprightTargetFor(Work);
			UprightBlend = WonderlandPose::ApproachBlend(UprightBlend, Target, Dt);
			WorkPhase = FMath::Fmod(WorkPhase + Dt * 0.55f, 1.0f);
			PoseLegs(DistanceWalked, 1.0f);
			PoseUpright(UprightBlend, Work);
			// Face the Avatar while working, or the performance is aimed at
			// nothing.
			const FVector ToAvatar = Avatar->GetActorLocation() - Here;
			const FRotator Face(0.0f,
				FMath::RadiansToDegrees(FMath::Atan2(ToAvatar.Y, ToAvatar.X)), 0.0f);
			SetActorRotation(FMath::RInterpTo(GetActorRotation(), Face, Dt, 5.0f));
			return;
		}
		Destination = Post;
	}
	else if (UprightBlend > 0.0f)
	{
		// WORK ENDED. Come back down before walking off — dropping to all fours
		// in one frame is the same teleport as rising in one.
		UprightBlend = WonderlandPose::ApproachBlend(UprightBlend, 0.0f, Dt);
		CurrentSpeed = FMath::FInterpConstantTo(CurrentSpeed, 0.0f, Dt, DecelUUPerSec2);
		PoseLegs(DistanceWalked, 1.0f);
		PoseUpright(UprightBlend, WonderlandPose::EWork::None);
		return;
	}

	FVector ToTarget = Destination - Here;
	ToTarget.Z = 0.0f;
	const float Distance = ToTarget.Size();
	if (Distance < 25.0f)
	{
		// A pause at each waypoint: a Dog that walks a perfect loop reads as a
		// machine on a track. The length is a function of the phase, so it is
		// still deterministic.
		PauseSeconds = 1.5f + 2.0f * FMath::Abs(FMath::Sin(BreathPhase * 3.1f));
		PickDestination();
		return;
	}

	const FVector Direction = ToTarget / Distance;

	// TURN FIRST, THEN WALK. The heading is interpolated toward the target, so
	// a Dog that has just picked a waypoint behind it spends the best part of a
	// second travelling in a direction it is not facing — which is sideways
	// motion with a walk cycle playing over it, and it is exactly what "sliding"
	// looks like. Gating the step on alignment turns it on the spot instead.
	//
	// This costs nothing to get right elsewhere: the gait advances with
	// DistanceWalked, so a step of zero holds the paws planted by construction.
	// A Dog pivoting on four planted paws is a small lie; a Dog gliding
	// sideways at full stride is a large one.
	const float Align = FVector::DotProduct(GetActorForwardVector(), Direction);
	const float Gate = FMath::Clamp((Align - 0.25f) / 0.55f, 0.0f, 1.0f);

	// ACCELERATE, NEVER ASSIGN. The step used to be WalkSpeed * Dt outright, so
	// a Dog leaving a waypoint went from nothing to full stride in one frame
	// and back to nothing in one more. Easing the SPEED eases everything
	// downstream, because the gait is derived from it: stride, duty, lift, bob
	// and the footfall pattern all ramp with the Dog instead of snapping on.
	//
	// Also eased DOWN as the target nears, so arriving is a deceleration rather
	// than a stop, and decel is brisker than accel — animals stop faster than
	// they start.
	const float Approach = FMath::Clamp(Distance / 260.0f, 0.0f, 1.0f);
	const float TargetSpeed = WalkSpeed * Gate * Approach;
	const float Rate = (TargetSpeed > CurrentSpeed) ? AccelUUPerSec2 : DecelUUPerSec2;
	CurrentSpeed = FMath::FInterpConstantTo(CurrentSpeed, TargetSpeed, Dt, Rate);

	const float StepLength = CurrentSpeed * Dt;
	FVector Next = Here + Direction * StepLength;

	// GROUND. The old step forced Z to zero and left the Dog at its spawn
	// height forever, so on anything but flat ground it floated or sank. Trace
	// down for the floor and ease onto it — eased, because a hard snap to a
	// traced height is itself a jitter.
	if (const UWorld* const W = GetWorld())
	{
		FHitResult Hit;
		FCollisionQueryParams Params(SCENE_QUERY_STAT(WonderlandDogGround), false, this);
		const FVector From = Next + FVector(0.0f, 0.0f, 220.0f);
		const FVector To = Next - FVector(0.0f, 0.0f, 600.0f);
		if (W->LineTraceSingleByChannel(Hit, From, To, ECC_WorldStatic, Params))
		{
			GroundZ = bHaveGround ? FMath::FInterpTo(GroundZ, Hit.Location.Z, Dt, 12.0f)
			                      : Hit.Location.Z;
			bHaveGround = true;
		}
	}
	if (bHaveGround)
	{
		Next.Z = GroundZ;
	}
	// THE DESTINATION BEING OUTSIDE IS NOT ENOUGH. A Dog whose home and target
	// both sit outside the zone can still walk a chord straight through it, and
	// a Dog placed inside one would never leave. Every step is checked.
	Next = PushOutOfKeepOut(Next);
	SetActorLocation(Next);

	// The gait advances with the DISTANCE covered, so the paws and the body are
	// the same quantity and cannot disagree at any speed.
	DistanceWalked += StepLength;
	// WHICH BODY PLAN. Quadruped unless this Dog was given a standing role;
	// blended by half-life either way, so the change of plan is a movement and
	// never a swap.
	const WonderlandStance::EUprightRole Role =
		static_cast<WonderlandStance::EUprightRole>(UprightRole);
	const bool bStands = WonderlandStance::RoleStandsUpright(Role);
	StanceBlend = WonderlandStance::Approach(StanceBlend, bStands ? 1.0f : 0.0f,
	                                         Dt, 0.45f);
	CurrentStanceName = FName(bStands ? ANSI_TO_TCHAR(WonderlandStance::RoleName(Role))
	                                  : TEXT("quadruped"));

	if (StanceBlend > 0.001f)
	{
		// A standing Dog's legs are not doing the quadruped gait, so the gait
		// is settled to rest and the biped walk is applied over it.
		PoseLegs(DistanceWalked, StanceBlend);
		PoseStanding(StanceBlend, DistanceWalked, Dt);
		return;
	}
	PoseLegs(DistanceWalked, 0.0f);

	// Turn toward travel. The body faces +X, so the yaw of the step is the yaw
	// the whole Dog wants — interpolated so it banks into a turn rather than
	// snapping, which is what made the earlier Dogs read as sliding props.
	const FRotator Want(0.0f, FMath::RadiansToDegrees(FMath::Atan2(Direction.Y, Direction.X)), 0.0f);
	// Faster than it was. At 3.0 a half-turn took most of a second, and the
	// alignment gate above now holds the Dog still for all of it — a long pause
	// facing the wrong way is its own kind of wrong.
	SetActorRotation(FMath::RInterpTo(GetActorRotation(), Want, Dt, 6.0f));
}

void AWonderlandStrollingDog::PoseLegs(float Travelled, float SettleAlpha)
{
	// Frame time for the paw easing. Taken from the world rather than passed,
	// because every caller of PoseLegs already has a clamped Dt and threading a
	// fourth argument through them all to say the same thing invites two of them
	// to say different things.
	const float PawDt = (GetWorld() != nullptr)
		? FMath::Clamp(GetWorld()->GetDeltaSeconds(), 0.0f, 0.1f) : (1.0f / 60.0f);
	// SettleAlpha 1 means "stand": the paws blend back to their rest pose. A
	// Dog that stops mid-stride and freezes is the snapping the founder saw.
	const float Blend = 1.0f - FMath::Clamp(SettleAlpha, 0.0f, 1.0f);

	// THE GAIT IS DERIVED FROM THE SPEED, EVERY TICK. Stride, duty, lift, bob
	// and the footfall pattern all come from here, so they cannot disagree with
	// how fast the Dog is actually travelling — which is what "the animation
	// does not match the movement" means, and it used to be guaranteed by three
	// constants that never changed.
	const WonderlandGait::FGaitParams Gait =
		WonderlandGait::GaitForSpeed(CurrentSpeed, HipHeightWorld);
	CurrentGaitName = FName(WonderlandGait::GaitName(Gait.Gait));

	const float Stride = (Gait.StrideLength > 1.0f) ? Gait.StrideLength : StrideLength;
	const float Lift = Gait.LiftHeight;
	const float Bob = Gait.BobHeight;

	// The body's carriage is needed BEFORE the legs, because the hip rides it.
	// A hip that stays put while the torso rises opens a gap at the shoulder.
	const WonderlandGait::FBodyPose BodyPose =
		WonderlandGait::BodyPose(Travelled / Stride, Bob);

	int32 Grounded = 0;
	for (int32 i = 0; i < 4; ++i)
	{
		UStaticMeshComponent* const Leg = Rig.Legs[i];
		if (Leg == nullptr)
		{
			continue;
		}
		const float Phase = Travelled / Stride + Gait.LegOffset[i];
		WonderlandGait::FLegPose Pose =
			WonderlandGait::LegPose(Phase, Stride, Lift, Gait.DutyFactor);
		// Settling blends the TARGET, not the result, so the swing angle and
		// the stretch both fall to rest with it rather than being faded on top
		// of a limb still held at an angle.
		Pose.Forward *= Blend;
		Pose.Lift *= Blend;

		// THE LIMB SWINGS FROM THE HIP RATHER THAN SLIDING. This used to set a
		// relative location and nothing else: the leg cube was translated
		// forward and back with the paw in the right place and nothing about it
		// pivoting, which reads as a box on a rail. See WonderlandDogGait.h for
		// why the answer is a stretching limb and not a knee.
		const FVector Rest = Rig.LegRest[i];
		const float LegLen = Rig.LegRestScale[i].Z * 100.0f;   // Cube is 100 uu at scale 1
		if (LegLen <= KINDA_SMALL_NUMBER)
		{
			Leg->SetRelativeLocation(FVector(Rest.X + Pose.Forward, Rest.Y, Rest.Z + Pose.Lift));
			continue;
		}
		const float HipZ = Rest.Z + LegLen * 0.5f + BodyPose.Bob * Blend;
		const float HipUU = LegLen + BodyPose.Bob * Blend;
		const WonderlandGait::FLegSwing Swing = WonderlandGait::LegSwing(Pose, HipUU);
		const float Reach = HipUU * Swing.Stretch;
		// UE pitch rotates +X toward +Z, so a component's local -Z — the
		// direction the leg hangs — maps to (sin p, 0, -cos p). Positive pitch
		// therefore carries the paw forward, which is what LegSwing means by it.
		const float Rad = FMath::DegreesToRadians(Swing.PitchDeg);
		// PER-PAW GROUNDING. Trace from the paw's own world position, so on a
		// slope the uphill paws rise and the downhill ones reach down, instead
		// of every paw sitting at the height the ROOT trace chose for the body.
		//
		// Only the planted ones are placed: gluing a swinging paw to the terrain
		// cancels its arc and the Dog shuffles. WonderlandGait::PawGroundOffset
		// holds that rule, the clamp and the easing — all of it proven with g++.
		float Grounding = 0.0f;
		{
			const FVector PawLocal(Rest.X + Reach * FMath::Sin(Rad), Rest.Y,
			                       HipZ - Reach * FMath::Cos(Rad));
			const FVector PawWorld = GetActorTransform().TransformPosition(PawLocal);
			float Delta = 0.0f;
			if (const UWorld* const W = GetWorld())
			{
				FHitResult Hit;
				FCollisionQueryParams Params(SCENE_QUERY_STAT(WonderlandPaw), false, this);
				if (W->LineTraceSingleByChannel(Hit, PawWorld + FVector(0, 0, 120.0f),
				                                PawWorld - FVector(0, 0, 260.0f),
				                                ECC_WorldStatic, Params))
				{
					Delta = Hit.Location.Z - PawWorld.Z;
				}
			}
			PawGroundOffsets[i] = WonderlandGait::PawGroundOffset(
				PawGroundOffsets[i], Delta, Pose.bStance, MaxPawGroundOffset, PawDt);
			Grounding = PawGroundOffsets[i] * Blend;
			if (Pose.bStance && FMath::Abs(PawGroundOffsets[i]) > 0.5f) { ++Grounded; }
		}

		Leg->SetRelativeRotation(FRotator(Swing.PitchDeg, 0.0f, 0.0f));
		Leg->SetRelativeScale3D(FVector(Rig.LegRestScale[i].X, Rig.LegRestScale[i].Y,
		                                Rig.LegRestScale[i].Z * (Reach / LegLen)));
		Leg->SetRelativeLocation(FVector(Rest.X + Reach * 0.5f * FMath::Sin(Rad),
		                                 Rest.Y,
		                                 HipZ - Reach * 0.5f * FMath::Cos(Rad) + Grounding));
	}

	if (Rig.Torso != nullptr)
	{
		Rig.Torso->SetRelativeLocation(FVector(Rig.TorsoRest.X, Rig.TorsoRest.Y,
		                                       Rig.TorsoRest.Z + BodyPose.Bob * Blend));
	}
	PawsGrounded = Grounded;
	if (Rig.Head != nullptr)
	{
		// The head counter-bobs: a walking dog holds its head steadier than its
		// shoulders, and without this the whole Dog pogos.
		Rig.Head->SetRelativeLocation(FVector(Rig.HeadRest.X, Rig.HeadRest.Y,
		                                       Rig.HeadRest.Z + BodyPose.Bob * 0.35f * Blend));
	}
}
