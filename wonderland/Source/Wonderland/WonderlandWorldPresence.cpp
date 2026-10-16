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
	TAutoConsoleVariable<float> CVarRemoteInterpDelay(TEXT("wl.Remote.InterpDelay"), 0.35f,
		TEXT("Remote players: seconds a figure is drawn behind its player in Interp mode (must exceed about two report periods)."));
	TAutoConsoleVariable<int32> CVarRemoteInterpAdaptive(TEXT("wl.Remote.InterpAdaptive"), 1,
		TEXT("Remote players, Interp mode: 1 sets the draw delay from the recent worst-case age of the newest report (+ InterpMargin, between InterpDelayMin and Max), slewed slowly; 0 uses the fixed wl.Remote.InterpDelay."));
	TAutoConsoleVariable<float> CVarRemoteInterpDelayMin(TEXT("wl.Remote.InterpDelayMin"), 0.12f, TEXT("Remote players: lowest adaptive draw delay (seconds)."));
	TAutoConsoleVariable<float> CVarRemoteInterpDelayMax(TEXT("wl.Remote.InterpDelayMax"), 0.60f, TEXT("Remote players: highest adaptive draw delay (seconds)."));
	TAutoConsoleVariable<float> CVarRemoteInterpMargin(TEXT("wl.Remote.InterpMargin"), 0.03f, TEXT("Remote players: seconds added to the worst-case report age for the adaptive delay."));
	TAutoConsoleVariable<float> CVarRemoteInterpCatchUp(TEXT("wl.Remote.InterpCatchUp"), 0.0f,
		TEXT("Remote players, Interp mode: the fastest a figure may close on its target after a late report, as a multiple of the player's reported speed (0 = no limit)."));
	TAutoConsoleVariable<float> CVarRemoteInterpEase(TEXT("wl.Remote.InterpEase"), 10.0f,
		TEXT("Remote players: chase rate toward the interpolated point in Interp mode (high = tight; lower smooths frame hitches)."));
	TAutoConsoleVariable<int32> CVarRemoteRetime(TEXT("wl.Remote.InterpRetime"), 1,
		TEXT("Remote players, Interp mode: 1 re-times a steady-motion segment from distance / reported speed (immune to report-delivery jitter), pulled back to the real clock; 0 trusts arrival - age."));
	TAutoConsoleVariable<float> CVarRemoteRetimePull(TEXT("wl.Remote.InterpRetimePull"), 0.2f,
		TEXT("Remote players: fraction of the (arrival - age) clock error pulled back into a re-timed sample (keeps the timeline from drifting)."));
	TAutoConsoleVariable<float> CVarRemoteInterpExtrap(TEXT("wl.Remote.InterpExtrap"), 0.2f,
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
					S.Raw = FPlatformTime::Seconds() - A.AgeMs * 0.001;
					S.T = S.Raw;
					S.V = FMath::Clamp(A.Speed, 0.0f, MaxTrustedSpeedUu);
					S.P = A.Location;
					if (Remote.Samples.Num() > 0)
					{
						const FRemote::FSample Last = Remote.Samples.Last();   // a COPY: Samples grows below
						if (FVector::Dist(Last.P, S.P) > SnapDistanceUu)
						{
							Remote.Samples.Reset();   // a teleport is placed, never swept across
						}
						else
						{
							const double DRaw = S.Raw - Last.Raw;
							{
								// HOW OLD the newest report was when its successor arrived = the draw delay that would just have avoided a hold. Measured here, at
								// arrival, so a player who stands still (no new reports) does not inflate it; a stand/start gap (> 0.6 s) is not a delivery gap.
								const double Avail = FPlatformTime::Seconds() - Last.T;
								if (Avail > 0.0 && Avail <= 0.6)
								{
									Remote.PeakAge = FMath::Max(Remote.PeakAge, Avail);
								}
							}
							if (S.Raw - Last.Raw > 0.4)
							{
								// stood still, then moved: hold the old place until just before the move, do not slide across the whole gap
								FRemote::FSample Hold = Last;
								Hold.T = S.T - 0.1;
								Hold.Raw = S.Raw - 0.1;
								Remote.Samples.Add(Hold);
							}
							else if (CVarRemoteRetime.GetValueOnGameThread() != 0 && DRaw > 0.02)
							{
								// STEADY MOTION: the time between two reports is the distance covered over the reported speed. Delivery jitter (frames, HTTP)
								// moves arrival - age by tens of ms but cannot change this. Not for a stop, a start or a turn (the speed does not describe
								// the displacement there): those keep the measured time. Bounded to [0.5, 1.7] x the measured gap, then pulled to the clock.
								const FVector2D Seg(S.P.X - Last.P.X, S.P.Y - Last.P.Y);
								const double Dist = Seg.Size();
								const double VAvg = 0.5 * (static_cast<double>(Last.V) + static_cast<double>(S.V));
								bool bSteady = VAvg >= MinMovingSpeedUu && Dist >= MinHeadingStepUu && Last.V >= MinMovingSpeedUu && S.V >= MinMovingSpeedUu
									&& FMath::Abs(static_cast<double>(S.V) - static_cast<double>(Last.V)) <= 0.25 * VAvg;
								if (bSteady && Remote.Samples.Num() >= 2)
								{
									const FVector2D Prev(Last.P.X - Remote.Samples[Remote.Samples.Num() - 2].P.X, Last.P.Y - Remote.Samples[Remote.Samples.Num() - 2].P.Y);
									bSteady = Prev.Size() >= MinHeadingStepUu && (Prev.GetSafeNormal() | Seg.GetSafeNormal()) > 0.8;   // within ~37 deg: not a turn
								}
								if (bSteady)
								{
									const double DUse = FMath::Clamp(Dist / VAvg, 0.5 * DRaw, 1.7 * DRaw);
									S.T = Last.T + DUse;
									S.T += static_cast<double>(CVarRemoteRetimePull.GetValueOnGameThread()) * (S.Raw - S.T);
								}
							}
							if (S.T <= Last.T)
							{
								S.T = Last.T + 0.001;
							}
						}
					}
					Remote.Samples.Add(S);
					UE_LOG(LogTemp, Display, TEXT("WLREMOTE rep fig=%s p=(%.1f,%.1f,%.1f) age=%.0fms n=%d v=%.0f retimeShiftMs=%.0f"), *A.UserId, A.Location.X, A.Location.Y, A.Location.Z, static_cast<double>(A.AgeMs), Remote.Samples.Num(), static_cast<double>(S.V), (S.T - S.Raw) * 1000.0);
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
		double DelayUsed = 0.0;
		if (CVarRemoteInterp.GetValueOnGameThread() != 0 && R.Samples.Num() > 0)
		{
			// DRAWN IN THE PAST, between the sender's own report times: a turn is a turn and a stop is a stop, never guessed ahead.
			const TArray<FRemote::FSample>& Ss = R.Samples;
			double Delay = static_cast<double>(CVarRemoteInterpDelay.GetValueOnGameThread());
			if (CVarRemoteInterpAdaptive.GetValueOnGameThread() != 0)
			{
				// The delay must cover how old the NEWEST report can be at any tick (the sender's report gap + the time until this client's own next
				// answer carries it), or the figure catches up with it, holds, and jumps. A leaky peak of that age (+ a margin) is the smallest safe delay.
				// It RISES at most 10 percent of real time and FALLS at most 5 percent, so a change never reads as a speed change.
				const double Dt = FMath::Clamp(static_cast<double>(DeltaSeconds), 0.0, 0.25);
				R.PeakAge = FMath::Max(0.0, R.PeakAge - 0.05 * Dt);   // raised on report arrival (see the sample insertion); only decays here
				const double Target = FMath::Clamp(R.PeakAge + static_cast<double>(CVarRemoteInterpMargin.GetValueOnGameThread()),
					static_cast<double>(CVarRemoteInterpDelayMin.GetValueOnGameThread()), static_cast<double>(CVarRemoteInterpDelayMax.GetValueOnGameThread()));
				if (R.AdaptDelay < 0.0)
				{
					R.AdaptDelay = FMath::Max(Delay, Target);   // start safe: the fixed delay, or more if the first reports are already older
				}
				const double Step = (Target > R.AdaptDelay ? 0.10 : 0.05) * Dt;
				R.AdaptDelay += FMath::Clamp(Target - R.AdaptDelay, -Step, Step);
				Delay = R.AdaptDelay;
			}
			DelayUsed = Delay;
			const double RT = NowSeconds - Delay;
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
						// velocity decaying linearly to zero over Cap: the distance carried is v * (a - a^2 / 2Cap), at most v * Cap / 2 (30 uu at 300 uu/s, Cap 0.2)
						const double Ahead = FMath::Min(RT - Ss.Last().T, Cap);
						const double Eff = Ahead - Ahead * Ahead / (2.0 * Cap);
						Aim.X += (Ss.Last().P.X - Prev.P.X) / Span * Eff;
						Aim.Y += (Ss.Last().P.Y - Prev.P.Y) / Span * Eff;
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
			// XY eased at InterpEase (smooths the report-rate speed ripple); the HEIGHT follows the floor at its own, fast rate so contact is not delayed.
			// EXPONENTIAL, so the lag is the same at any frame rate: VInterpTo's linear step snaps to the target when a frame takes >= 1/rate (a slow frame
			// = a jump, the next fast ones = lag: measured as 0.18-0.27 shown-speed CV where the interpolated path itself is 0.02-0.08).
			const double Dt = FMath::Max(0.0, static_cast<double>(DeltaSeconds));
			const double AlphaXY = 1.0 - FMath::Exp(-static_cast<double>(Rate) * Dt);
			const double AlphaZ = 1.0 - FMath::Exp(-static_cast<double>(CVarRemoteInterpEaseZ.GetValueOnGameThread()) * Dt);
			Next = FVector(Now.X + (Aim.X - Now.X) * AlphaXY, Now.Y + (Aim.Y - Now.Y) * AlphaXY, Now.Z + (Aim.Z - Now.Z) * AlphaZ);
			// CATCH-UP LIMIT: after a late report the target jumps ahead; the figure may close on it at most CatchUp x the player's own reported speed
			// (a visible surge is worse than a short extra lag). Standing / unknown speed: no limit beyond a generous 900 uu/s.
			const double CatchUp = static_cast<double>(CVarRemoteInterpCatchUp.GetValueOnGameThread());
			if (CatchUp > 0.0)
			{
				const double Vmax = (R.DrSpeed >= MinMovingSpeedUu ? static_cast<double>(R.DrSpeed) * CatchUp : 900.0) * Dt;
				const FVector2D Step(Next.X - Now.X, Next.Y - Now.Y);
				const double Len = Step.Size();
				if (Len > Vmax && Len > 1e-6)
				{
					Next.X = Now.X + Step.X * (Vmax / Len);
					Next.Y = Now.Y + Step.Y * (Vmax / Len);
				}
			}
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
			UE_LOG(LogTemp, Display, TEXT("WLREMOTE fig=%s recv=(%.1f,%.1f,%.1f) age=%.0fms applied=(%.1f,%.1f,%.1f) lagUu=%.1f lagXYUu=%.1f worn=%d floatZ=%.2f lowestUu=%.2f aim=(%.1f,%.1f) dtMs=%.1f nowXY=(%.1f,%.1f) interp=%d delayMs=%.0f"),
				*Pair.Key, R.Target.X, R.Target.Y, R.Target.Z,
				(NowSeconds - R.RecvAt) * 1000.0 + R.RecvAgeMs,
				Next.X, Next.Y, Next.Z,
				FVector::Dist(R.Target, Next), FVector::Dist2D(R.Target, Next),
				Body->IsWornPoseValid() ? 1 : 0, Body->GetFloatRootRelativeZ(), Body->GetFigureLowestUu(),
				Aim.X, Aim.Y, static_cast<double>(DeltaSeconds) * 1000.0, Now.X, Now.Y, bInterp ? 1 : 0, DelayUsed * 1000.0);
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
