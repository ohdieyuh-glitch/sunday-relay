#include "WonderlandWorldPresence.h"

#include "Camera/PlayerCameraManager.h"
#include "Components/TextRenderComponent.h"
#include "Engine/World.h"
#include "HAL/IConsoleManager.h"
#include "GameFramework/PlayerController.h"
#include "WonderlandCompanionEmbodiment.h"

// Named, not anonymous: the module is one unity translation unit.
namespace WonderlandWorldPresenceDetail
{
	/** How quickly a figure closes on its latest report (reports arrive ~5 a second): fast enough to keep up, slow enough
	 *  that a late report reads as a stride, not a jump. */
	constexpr float EaseRate = 9.0f;
	/** Further than this from its report, a figure is placed rather than eased (a teleport, a transition). */
	constexpr float SnapDistanceUu = 1500.0f;
	constexpr float LabelHeightUu = 215.0f;
	/** DEAD RECKONING: a figure is steered toward where its player should be by now (the last report plus Speed along the heading of
	 *  the last two reports), never further ahead than this: a stop or a turn can only ever be this far wrong. XY only; Z is as reported. */
	constexpr double MaxExtrapolationSeconds = 0.3;
	/** Below this a report is "standing"; above this a hostile or broken Speed is not believed. */
	constexpr float MinMovingSpeedUu = 10.0f;
	constexpr float MaxTrustedSpeedUu = 1200.0f;
	/** Fewer uu than this between two reports is not a heading. */
	constexpr float MinHeadingStepUu = 5.0f;
	/** 1 = steer toward the dead-reckoned point (default), 0 = the old chase of the last report (rollback without a rebuild). */
	TAutoConsoleVariable<int32> CVarRemoteDeadReckon(TEXT("wl.Remote.DeadReckon"), 1,
		TEXT("Remote players: 1 steers toward the dead-reckoned position (capped), 0 chases the last report as before."));
}

FWonderlandRemoteAvatars::~FWonderlandRemoteAvatars()
{
	Clear();
}

void FWonderlandRemoteAvatars::Remove(FRemote& Remote)
{
	if (AWonderlandCompanionEmbodiment* Body = Remote.Body.Get())
	{
		Body->Destroy();
	}
	Remote.Body.Reset();
	Remote.Label.Reset();
}

void FWonderlandRemoteAvatars::Clear()
{
	for (TPair<FString, FRemote>& Pair : Remotes)
	{
		Remove(Pair.Value);
	}
	Remotes.Reset();
}

void FWonderlandRemoteAvatars::Apply(UWorld* World, const FWonderlandWorldView& View, TFunctionRef<FString(const FString&)> FigurePathFor, float BodyHeightUu)
{
	if (World == nullptr || !View.bInWorld)
	{
		Clear();
		return;
	}
	// THE DEPARTED: left, went silent, or no longer visible (a block either way removes them from the view itself).
	TSet<FString> Present;
	for (const FWonderlandRemoteAvatar& A : View.Avatars)
	{
		Present.Add(A.UserId);
	}
	for (auto It = Remotes.CreateIterator(); It; ++It)
	{
		if (!Present.Contains(It.Key()) || !It.Value().Body.IsValid())
		{
			// R16 EVIDENCE: a figure leaving this player's world is said once, by id (a leave, a silence, or a block).
			UE_LOG(LogTemp, Display, TEXT("WLWORLD player %s left this view (%s)"), *It.Key(),
				Present.Contains(It.Key()) ? TEXT("figure lost") : TEXT("no longer in the view"));
			Remove(It.Value());
			It.RemoveCurrent();
		}
	}
	for (const FWonderlandRemoteAvatar& A : View.Avatars)
	{
		FRemote& Remote = Remotes.FindOrAdd(A.UserId);
		if (!A.Location.Equals(Remote.Target, 0.01))
		{
			// WLREMOTE: a view that carries a new position is a new report; one that repeats it is not.
			Remote.RecvAt = FPlatformTime::Seconds();
			Remote.RecvAgeMs = static_cast<float>(A.AgeMs);
		}
		{
			using namespace WonderlandWorldPresenceDetail;
			// A view that repeats the last position is not a new report (it must not restart the extrapolation clock).
			const bool bMoved = !Remote.bDrHasReport || !A.Location.Equals(Remote.Target, 0.5);
			if (bMoved)
			{
				if (Remote.bDrHasReport)
				{
					const FVector Step(A.Location.X - Remote.Target.X, A.Location.Y - Remote.Target.Y, 0.0);
					if (Step.Size() >= MinHeadingStepUu)
					{
						Remote.DrHeading = Step.GetSafeNormal();
					}
				}
				Remote.bDrHasReport = true;
				Remote.DrReceivedAt = FPlatformTime::Seconds();
				Remote.DrAgeSeconds = static_cast<float>(A.AgeMs * 0.001);
			}
			Remote.DrSpeed = FMath::Clamp(A.Speed, 0.0f, MaxTrustedSpeedUu);
		}
		Remote.Target = A.Location;
		Remote.TargetYaw = A.Yaw;
		Remote.DisplayName = A.DisplayName;
		AWonderlandCompanionEmbodiment* Body = Remote.Body.Get();
		if (Body == nullptr)
		{
			FActorSpawnParameters Params;
			Params.ObjectFlags |= RF_Transient;
			Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			Body = World->SpawnActor<AWonderlandCompanionEmbodiment>(AWonderlandCompanionEmbodiment::StaticClass(),
				FTransform(FRotator(0.0, A.Yaw, 0.0), A.Location), Params);
			if (Body == nullptr)
			{
				continue;
			}
			Body->DisplayName = A.DisplayName;
			Body->ClassLabel = TEXT("WONDERLAND PLAYER");
			// THE MASCOT, as every player's Dog is: its colourway, its gait, Relay OG's height (the HARD rule).
			Body->SetBodyRole(EWonderlandBodyRole::Mascot);
			Body->SetRuntimeActivity(TEXT("IDLE"));
			Body->SetPlantedNoFloat(true);   // a remote player is drawn planted, not hovering (founder 2026-09-25: skins "remain planted")
			Body->TargetBodyHeightUU = BodyHeightUu;
			UTextRenderComponent* Label = NewObject<UTextRenderComponent>(Body, MakeUniqueObjectName(Body, UTextRenderComponent::StaticClass(), TEXT("PlayerName")));
			Label->SetupAttachment(Body->GetRootComponent());
			Label->RegisterComponent();
			Body->AddInstanceComponent(Label);
			Label->SetRelativeLocation(FVector(0.0, 0.0, WonderlandWorldPresenceDetail::LabelHeightUu));
			Label->SetHorizontalAlignment(EHTA_Center);
			Label->SetVerticalAlignment(EVRTA_TextBottom);
			Label->SetWorldSize(18.0f);
			Label->SetTextRenderColor(FColor(236, 231, 221));
			Label->SetText(FText::FromString(A.DisplayName));
			Label->SetCastShadow(false);
			Remote.Body = Body;
			Remote.Label = Label;
			Remote.SkinId.Reset();
			// R16 EVIDENCE: another player's Dog drawn in this player's world, said once, by id and place.
			UE_LOG(LogTemp, Display, TEXT("WLWORLD player %s (%s) appeared at (%.0f, %.0f, %.0f)"), *A.UserId, *A.DisplayName,
				A.Location.X, A.Location.Y, A.Location.Z);
		}
		// THEIR SKIN, THROUGH THE REGISTRY: a skin this build does not know keeps the figure it has.
		if (Remote.SkinId != A.SkinId)
		{
			const FString Figure = FigurePathFor(A.SkinId);
			if (!Figure.IsEmpty() && Body->LoadFigure(Figure))
			{
				Remote.SkinId = A.SkinId;
			}
			else
			{
				UE_LOG(LogTemp, Warning, TEXT("WLWORLD %s wears '%s', which this build cannot draw"), *A.UserId, *A.SkinId);
				Remote.SkinId = A.SkinId;   // not retried every report
			}
		}
		if (UTextRenderComponent* Label = Remote.Label.Get())
		{
			Label->SetText(FText::FromString(A.DisplayName));
		}
	}
}

void FWonderlandRemoteAvatars::Tick(UWorld* World, float DeltaSeconds)
{
	using namespace WonderlandWorldPresenceDetail;
	const APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
	const FVector Camera = PC != nullptr && PC->PlayerCameraManager != nullptr ? PC->PlayerCameraManager->GetCameraLocation() : FVector::ZeroVector;
	const double NowSeconds = FPlatformTime::Seconds();
	const bool bDeadReckon = CVarRemoteDeadReckon.GetValueOnGameThread() != 0;
	for (TPair<FString, FRemote>& Pair : Remotes)
	{
		FRemote& R = Pair.Value;
		AWonderlandCompanionEmbodiment* Body = R.Body.Get();
		if (Body == nullptr)
		{
			continue;
		}
		const FVector Now = Body->GetActorLocation();
		// WHERE THEY SHOULD BE BY NOW: the report plus constant velocity (Speed along the last two reports' heading) for the time since
		// it was taken (its age at the backend plus the time held here), capped. A standing report, a first report, or no heading: the report.
		FVector Aim = R.Target;
		if (bDeadReckon && R.DrSpeed >= MinMovingSpeedUu && !R.DrHeading.IsNearlyZero())
		{
			const double Ahead = FMath::Clamp((NowSeconds - R.DrReceivedAt) + R.DrAgeSeconds, 0.0, MaxExtrapolationSeconds);
			Aim += R.DrHeading * (R.DrSpeed * Ahead);
		}
		// EASED, so its gait (driven by the distance it covers) reads the movement as walking and running. The snap is still judged on the report.
		const bool bSnap = FVector::Dist(Now, R.Target) > SnapDistanceUu;
		const FVector Next = bSnap ? R.Target : FMath::VInterpTo(Now, Aim, DeltaSeconds, EaseRate);
		const FRotator Facing = FMath::RInterpTo(Body->GetActorRotation(), FRotator(0.0, R.TargetYaw, 0.0), DeltaSeconds, EaseRate);
		Body->SetActorLocationAndRotation(Next, Facing);
		// WLREMOTE: diagnostics only (a snap is said at once; otherwise one line a second per figure). Cheap: no allocation.
		if (bSnap)
		{
			UE_LOG(LogTemp, Display, TEXT("WLREMOTE snap fig=%s from=(%.1f,%.1f,%.1f) to=(%.1f,%.1f,%.1f)"), *Pair.Key,
				Now.X, Now.Y, Now.Z, R.Target.X, R.Target.Y, R.Target.Z);
		}
		if (NowSeconds >= R.LogNextAt)
		{
			R.LogNextAt = NowSeconds + 1.0;
			UE_LOG(LogTemp, Display, TEXT("WLREMOTE fig=%s recv=(%.1f,%.1f,%.1f) age=%.0fms applied=(%.1f,%.1f,%.1f) lagUu=%.1f lagXYUu=%.1f worn=%d floatZ=%.2f lowestUu=%.2f"),
				*Pair.Key, R.Target.X, R.Target.Y, R.Target.Z,
				(NowSeconds - R.RecvAt) * 1000.0 + R.RecvAgeMs,
				Next.X, Next.Y, Next.Z,
				FVector::Dist(R.Target, Next), FVector::Dist2D(R.Target, Next),
				Body->IsWornPoseValid() ? 1 : 0, Body->GetFloatRootRelativeZ(), Body->GetFigureLowestUu());
		}
		if (UTextRenderComponent* Label = R.Label.Get())
		{
			// FACING THE CAMERA: a name is read, not seen edge-on.
			const FVector ToCamera = Camera - Label->GetComponentLocation();
			Label->SetWorldRotation(FRotator(0.0, ToCamera.Rotation().Yaw, 0.0));
		}
	}
}

FString FWonderlandRemoteAvatars::Describe() const
{
	TArray<FString> Parts;
	for (const TPair<FString, FRemote>& Pair : Remotes)
	{
		const AWonderlandCompanionEmbodiment* Body = Pair.Value.Body.Get();
		Parts.Add(FString::Printf(TEXT("%s@%s %s"), *Pair.Key, Body != nullptr ? *Body->GetActorLocation().ToCompactString() : TEXT("(gone)"), *Pair.Value.SkinId));
	}
	return Parts.Num() > 0 ? FString::Join(Parts, TEXT(" | ")) : FString(TEXT("none"));
}
