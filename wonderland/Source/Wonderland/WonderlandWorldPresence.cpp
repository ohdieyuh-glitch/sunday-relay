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
	// r16reh16c: A/B switches so ONE binary can be measured with and without each change (defaults = the new behaviour).
	TAutoConsoleVariable<int32> CVarRemoteNoHover(TEXT("wl.Remote.NoHover"), 1,
		TEXT("Remote players: 1 draws a remote figure planted (no FloatRoot hover, no Float-part bob), 0 restores the old hover. Read when a figure spawns."));
	TAutoConsoleVariable<int32> CVarRemoteInterp(TEXT("wl.Remote.Interp"), 1,
		TEXT("Remote players: 1 draws a figure InterpDelay seconds in the past, interpolated between the sender's report times (no overshoot); 0 uses the dead-reckoned chase."));
	TAutoConsoleVariable<float> CVarRemoteInterpDelay(TEXT("wl.Remote.InterpDelay"), 0.25f,
		TEXT("Remote players: seconds a figure is drawn behind its player in Interp mode (must exceed about two report periods)."));
	TAutoConsoleVariable<float> CVarRemoteInterpEase(TEXT("wl.Remote.InterpEase"), 30.0f,
		TEXT("Remote players: chase rate toward the interpolated point in Interp mode (high = tight; lower smooths frame hitches)."));
	TAutoConsoleVariable<float> CVarRemoteInterpExtrap(TEXT("wl.Remote.InterpExtrap"), 0.15f,
		TEXT("Remote players: in Interp mode, seconds a figure may continue at the last segment's velocity when it has caught up with its newest report (0 = hold)."));
	TAutoConsoleVariable<float> CVarRemoteInterpEaseZ(TEXT("wl.Remote.InterpEaseZ"), 30.0f,
		TEXT("Remote players: chase rate of the height (floor contact) in Interp mode; XY uses wl.Remote.InterpEase."));
	TAutoConsoleVariable<float> CVarRemoteEaseRate(TEXT("wl.Remote.EaseRate"), 9.0f,
		TEXT("Remote players: chase rate toward the report / dead-reckoned point when Interp is 0."));
	TAutoConsoleVariable<float> CVarRemoteDrCap(TEXT("wl.Remote.DrCap"), 0.3f,
		TEXT("Remote players: dead-reckoning cap in seconds when Interp is 0."));
	TAutoConsoleVariable<float> CVarRemoteLogPeriod(TEXT("wl.Remote.LogPeriod"), 1.0f,
		TEXT("Remote players: seconds between the per-figure WLREMOTE log lines (default 1; a dev measurement can set 0.1)."));
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
				{
					// the sender's time of this report: arrival here minus the backend's age; kept strictly increasing
					FRemote::FSample S;
					S.T = FPlatformTime::Seconds() - A.AgeMs * 0.001;
					S.P = A.Location;
					if (Remote.Samples.Num() > 0)
					{
						const FRemote::FSample& Last = Remote.Samples.Last();
						if (FVector::Dist(Last.P, S.P) > SnapDistanceUu)
						{
							Remote.Samples.Reset();   // a teleport is placed, never swept across
						}
						else
						{
							if (S.T <= Last.T)
							{
								S.T = Last.T + 0.001;
							}
							if (S.T - Last.T > 0.4)
							{
								// stood still, then moved: hold the old place until just before the move, do not slide across the whole gap
								FRemote::FSample Hold;
								Hold.T = S.T - 0.1;
								Hold.P = Last.P;
								Remote.Samples.Add(Hold);
							}
						}
					}
					Remote.Samples.Add(S);
					UE_LOG(LogTemp, Display, TEXT("WLREMOTE rep fig=%s p=(%.1f,%.1f,%.1f) age=%.0fms n=%d"), *A.UserId, A.Location.X, A.Location.Y, A.Location.Z, static_cast<double>(A.AgeMs), Remote.Samples.Num());
					if (Remote.Samples.Num() > 24)
					{
						Remote.Samples.RemoveAt(0, Remote.Samples.Num() - 24, EAllowShrinking::No);
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
			Body->SetPlantedNoFloat(WonderlandWorldPresenceDetail::CVarRemoteNoHover.GetValueOnGameThread() != 0);   // a remote player is drawn planted, not hovering (founder 2026-09-25: skins "remain planted")
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
			const double Ahead = FMath::Clamp((NowSeconds - R.DrReceivedAt) + R.DrAgeSeconds, 0.0, static_cast<double>(CVarRemoteDrCap.GetValueOnGameThread()));
			Aim += R.DrHeading * (R.DrSpeed * Ahead);
		}
		// EASED, so its gait (driven by the distance it covers) reads the movement as walking and running. The snap is still judged on the report.
		const bool bSnap = FVector::Dist(Now, R.Target) > SnapDistanceUu;
		float Rate = CVarRemoteEaseRate.GetValueOnGameThread();
		bool bInterp = false;
		if (CVarRemoteInterp.GetValueOnGameThread() != 0 && R.Samples.Num() > 0)
		{
			// DRAWN IN THE PAST, between the sender's own report times: a turn is a turn and a stop is a stop, never guessed ahead.
			const double RT = NowSeconds - static_cast<double>(CVarRemoteInterpDelay.GetValueOnGameThread());
			const TArray<FRemote::FSample>& Ss = R.Samples;
			if (RT <= Ss[0].T)
			{
				Aim = Ss[0].P;
			}
			else if (RT >= Ss.Last().T)
			{
				Aim = Ss.Last().P;
				// CAUGHT UP with the newest report (a late one): carry on at the last segment's velocity for a short, capped time (XY only) instead of stalling
				const double Cap = static_cast<double>(CVarRemoteInterpExtrap.GetValueOnGameThread());
				if (Cap > 0.0 && Ss.Num() >= 2)
				{
					const FRemote::FSample& Prev = Ss[Ss.Num() - 2];
					const double Span = Ss.Last().T - Prev.T;
					if (Span > 0.02 && Span < 0.4)
					{
						const double Ahead = FMath::Min(RT - Ss.Last().T, Cap);
						Aim.X += (Ss.Last().P.X - Prev.P.X) / Span * Ahead;
						Aim.Y += (Ss.Last().P.Y - Prev.P.Y) / Span * Ahead;
					}
				}
			}
			else
			{
				int32 I = Ss.Num() - 2;
				while (I > 0 && Ss[I].T > RT)
				{
					--I;
				}
				const double Span = Ss[I + 1].T - Ss[I].T;
				const double F = Span > 1e-6 ? FMath::Clamp((RT - Ss[I].T) / Span, 0.0, 1.0) : 1.0;
				Aim = FMath::Lerp(Ss[I].P, Ss[I + 1].P, F);
			}
			Rate = CVarRemoteInterpEase.GetValueOnGameThread();
			bInterp = true;
		}
		FVector Next;
		if (bSnap)
		{
			Next = R.Target;
		}
		else if (bInterp)
		{
			// XY eased at InterpEase (smooths the report-rate speed ripple); the HEIGHT follows the floor at its own, fast rate so contact is not delayed
			const FVector2D Flat = FMath::Vector2DInterpTo(FVector2D(Now.X, Now.Y), FVector2D(Aim.X, Aim.Y), DeltaSeconds, Rate);
			Next = FVector(Flat.X, Flat.Y, FMath::FInterpTo(static_cast<float>(Now.Z), static_cast<float>(Aim.Z), DeltaSeconds, CVarRemoteInterpEaseZ.GetValueOnGameThread()));
		}
		else
		{
			Next = FMath::VInterpTo(Now, Aim, DeltaSeconds, Rate);
		}
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
			R.LogNextAt = NowSeconds + FMath::Max(0.02, static_cast<double>(CVarRemoteLogPeriod.GetValueOnGameThread()));
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
